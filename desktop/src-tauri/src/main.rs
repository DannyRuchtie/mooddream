#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::{io, io::ErrorKind};
use std::{fs::OpenOptions};
use std::time::{Duration, Instant};
use std::io::{Read, Write};

use serde::{Deserialize, Serialize};
use tauri::Manager;
use tauri::{AboutMetadata, CustomMenuItem, Menu, MenuItem, Submenu};

struct ServerState {
  port: Mutex<Option<u16>>,
  child: Mutex<Option<Child>>,
  worker: Mutex<Option<Child>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, Default)]
struct AppSettings {
  storage: Option<StorageSettings>,
  ai: Option<AiSettings>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct StorageSettings {
  mode: Option<String>, // "local" | "icloud"
  #[serde(alias = "icloudPath")]
  icloud_path: Option<String>,
  migration: Option<MigrationSettings>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct MigrationSettings {
  from: String,
  to: String,
  #[serde(alias = "requestedAt")]
  requested_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
struct AiSettings {
  provider: Option<String>, // "local_station" | "huggingface"
  endpoint: Option<String>,
}

#[derive(Clone, Serialize)]
struct ServerInfo {
  port: u16,
}

#[tauri::command]
fn server_port(state: tauri::State<ServerState>) -> Option<u16> {
  *state.port.lock().unwrap()
}

fn pick_free_port() -> u16 {
  // Bind to port 0 to let the OS pick an available port, then release it.
  TcpListener::bind("127.0.0.1:0")
    .ok()
    .and_then(|l| l.local_addr().ok().map(|a| a.port()))
    .unwrap_or(3210)
}

fn http_get_200(host: &str, port: u16, path: &str, timeout: Duration) -> bool {
  let addr = format!("{}:{}", host, port);
  let start = Instant::now();
  while start.elapsed() < timeout {
    if let Ok(mut stream) = TcpStream::connect(addr.as_str()) {
      let _ = stream.set_read_timeout(Some(Duration::from_millis(250)));
      let _ = stream.set_write_timeout(Some(Duration::from_millis(250)));
      let req = format!(
        "GET {} HTTP/1.1\r\nHost: {}:{}\r\nConnection: close\r\n\r\n",
        path, host, port
      );
      if stream.write_all(req.as_bytes()).is_ok() {
        let mut buf = [0u8; 512];
        if let Ok(n) = stream.read(&mut buf) {
          let s = String::from_utf8_lossy(&buf[..n]);
          if s.contains(" 200 ") {
            return true;
          }
        }
      }
    }
    std::thread::sleep(Duration::from_millis(150));
  }
  false
}

fn resource_path(app: &tauri::AppHandle, rel: &str) -> Option<PathBuf> {
  app
    .path_resolver()
    .resource_dir()
    // We bundle assets under `Contents/Resources/resources/...` (mirrors `src-tauri/resources/...`).
    .map(|d| d.join("resources").join(rel))
}

fn default_icloud_dir() -> Option<PathBuf> {
  let home = std::env::var("HOME").ok()?;
  Some(
    PathBuf::from(home)
      .join("Library")
      .join("Mobile Documents")
      .join("com~apple~CloudDocs")
      .join("Moondream"),
  )
}

fn read_settings(config_root: &PathBuf) -> AppSettings {
  let p = config_root.join("settings.json");
  let data = std::fs::read_to_string(p);
  if let Ok(s) = data {
    serde_json::from_str::<AppSettings>(&s).unwrap_or_default()
  } else {
    AppSettings::default()
  }
}

fn write_settings(config_root: &PathBuf, settings: &AppSettings) {
  let p = config_root.join("settings.json");
  if let Ok(s) = serde_json::to_string_pretty(settings) {
    let _ = std::fs::write(p, s);
  }
}

fn is_dir_empty(p: &PathBuf) -> bool {
  match std::fs::read_dir(p) {
    Ok(mut it) => it.next().is_none(),
    Err(_) => true,
  }
}

fn copy_dir_all(from: &PathBuf, to: &PathBuf) -> io::Result<()> {
  std::fs::create_dir_all(to)?;
  for entry in std::fs::read_dir(from)? {
    let entry = entry?;
    let ft = entry.file_type()?;
    let src = entry.path();
    let dst = to.join(entry.file_name());
    if ft.is_dir() {
      copy_dir_all(&src, &dst)?;
    } else if ft.is_file() {
      std::fs::create_dir_all(dst.parent().unwrap_or(to))?;
      std::fs::copy(&src, &dst)?;
    }
  }
  Ok(())
}

fn move_dir(from: &PathBuf, to: &PathBuf) -> io::Result<()> {
  // Fast path: same volume rename.
  if std::fs::rename(from, to).is_ok() {
    return Ok(());
  }
  // Fallback: recursive copy + delete.
  copy_dir_all(from, to)?;
  std::fs::remove_dir_all(from)?;
  Ok(())
}

fn apply_pending_migration(config_root: &PathBuf, settings: &mut AppSettings) -> Option<PathBuf> {
  let mig = settings.storage.as_ref().and_then(|s| s.migration.as_ref())?;
  let from = PathBuf::from(mig.from.clone());
  let to = PathBuf::from(mig.to.clone());
  if from == to {
    // Nothing to do.
    if let Some(st) = settings.storage.as_mut() {
      st.migration = None;
    }
    write_settings(config_root, settings);
    return None;
  }

  // If source doesn't exist, clear and continue.
  if !from.exists() {
    if let Some(st) = settings.storage.as_mut() {
      st.migration = None;
    }
    write_settings(config_root, settings);
    return None;
  }

  // If destination exists and is not empty, back it up before moving in.
  if to.exists() && !is_dir_empty(&to) {
    let ts = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap_or_else(|_| Duration::from_secs(0))
      .as_secs();
    let name = to
      .file_name()
      .and_then(|s| s.to_str())
      .unwrap_or("data")
      .to_string();
    let backup = to
      .parent()
      .unwrap_or(config_root)
      .join(format!("{}-backup-{}", name, ts));
    let _ = std::fs::rename(&to, &backup);
  }

  if let Some(parent) = to.parent() {
    let _ = std::fs::create_dir_all(parent);
  }

  match move_dir(&from, &to) {
    Ok(()) => {
      if let Some(st) = settings.storage.as_mut() {
        st.migration = None;
      }
      write_settings(config_root, settings);
      None
    }
    Err(_) => {
      // Migration failed; keep using the old location for this run so the library isn't "missing".
      Some(from)
    }
  }
}

fn resolve_data_dir(config_root: &PathBuf, settings: &AppSettings) -> PathBuf {
  let mode = settings
    .storage
    .as_ref()
    .and_then(|s| s.mode.as_deref())
    .unwrap_or("local")
    .to_lowercase();

  if mode == "icloud" {
    let p = settings
      .storage
      .as_ref()
      .and_then(|s| s.icloud_path.as_ref())
      .map(PathBuf::from)
      .or_else(default_icloud_dir);
    if let Some(p) = p {
      return p;
    }
  }
  config_root.join("data")
}

fn spawn_next_server(
  app: &tauri::AppHandle,
  port: u16,
  config_root: &PathBuf,
  data_dir: &PathBuf,
  settings: &AppSettings,
) -> io::Result<Child> {
  let next_dir = resource_path(app, "next")
    .ok_or_else(|| io::Error::new(ErrorKind::NotFound, "Missing resource_dir"))?;
  let server_js = next_dir.join("server.js");
  if !server_js.exists() {
    return Err(io::Error::new(
      ErrorKind::NotFound,
      format!("Missing Next server bundle at {}", server_js.display()),
    ));
  }

  // Require bundled Node so the desktop app is truly standalone.
  let node = resource_path(app, "bin/node").ok_or_else(|| {
    io::Error::new(ErrorKind::NotFound, "Missing resource_dir (bin/node)")
  })?;
  if !node.exists() {
    return Err(io::Error::new(
      ErrorKind::NotFound,
      format!("Missing bundled Node at {}", node.display()),
    ));
  }

  std::fs::create_dir_all(&data_dir)?;

  // Log server output so "server not ready" errors are debuggable in standalone builds.
  let log_dir = config_root.join("logs");
  std::fs::create_dir_all(&log_dir)?;
  let server_log_path = log_dir.join("next-server.log");
  let log_file = OpenOptions::new()
    .create(true)
    .append(true)
    .open(&server_log_path)?;
  let log_file_err = log_file.try_clone()?;

  let mut cmd = Command::new(node);
  cmd
    .current_dir(&next_dir)
    .arg("server.js")
    .env("HOSTNAME", "127.0.0.1")
    .env("PORT", port.to_string())
    .env("NODE_ENV", "production")
    .env("NEXT_TELEMETRY_DISABLED", "1")
    .env("MOONDREAM_DATA_DIR", &data_dir)
    .env("MOONDREAM_APP_CONFIG_DIR", config_root)
    .env("MOONDREAM_SETTINGS_PATH", config_root.join("settings.json"))
    // Pass AI config through so the UI (and server routes, if needed) can read it.
    .env(
      "MOONDREAM_PROVIDER",
      settings
        .ai
        .as_ref()
        .and_then(|a| a.provider.as_ref())
        .map(|s| s.as_str())
        .unwrap_or("local_station"),
    )
    .env(
      "MOONDREAM_ENDPOINT",
      settings
        .ai
        .as_ref()
        .and_then(|a| a.endpoint.as_ref())
        .map(|s| s.as_str())
        .unwrap_or("http://127.0.0.1:2020"),
    )
    // Ensure the Node server and the Python worker (if used) can share the same DB file.
    .env("MOONDREAM_DB_PATH", data_dir.join("moondream.sqlite3"))
    .stdin(Stdio::null())
    .stdout(Stdio::from(log_file))
    .stderr(Stdio::from(log_file_err));

  cmd.spawn()
}

fn spawn_worker(
  app: &tauri::AppHandle,
  db_path: &PathBuf,
  config_root: &PathBuf,
  settings: &AppSettings,
) -> io::Result<Child> {
  let worker = resource_path(app, "bin/moondream-worker")
    .ok_or_else(|| io::Error::new(ErrorKind::NotFound, "Missing resource_dir (bin/moondream-worker)"))?;
  if !worker.exists() {
    return Err(io::Error::new(
      ErrorKind::NotFound,
      format!("Missing bundled worker at {}", worker.display()),
    ));
  }

  // Log worker output
  let log_dir = config_root.join("logs");
  std::fs::create_dir_all(&log_dir)?;
  let log_path = log_dir.join("moondream-worker.log");
  let out = OpenOptions::new().create(true).append(true).open(&log_path)?;
  let err = out.try_clone()?;

  let endpoint = settings
    .ai
    .as_ref()
    .and_then(|a| a.endpoint.as_ref())
    .cloned()
    .unwrap_or_else(|| "http://127.0.0.1:2020".to_string());
  let provider = settings
    .ai
    .as_ref()
    .and_then(|a| a.provider.as_ref())
    .cloned()
    .unwrap_or_else(|| "local_station".to_string());

  let mut cmd = Command::new(worker);
  cmd
    .env("PYTHONUNBUFFERED", "1")
    .env("MOONDREAM_DB_PATH", db_path)
    .env("MOONDREAM_PROVIDER", provider)
    .env("MOONDREAM_ENDPOINT", endpoint)
    .env("MOONDREAM_POLL_SECONDS", std::env::var("MOONDREAM_POLL_SECONDS").unwrap_or_else(|_| "1.0".to_string()))
    // Retry old failures automatically (useful if Station wasn't running on first launch).
    .env("MOONDREAM_RETRY_FAILED", std::env::var("MOONDREAM_RETRY_FAILED").unwrap_or_else(|_| "1".to_string()))
    .env("MOONDREAM_APP_CONFIG_DIR", config_root)
    .stdin(Stdio::null())
    .stdout(Stdio::from(out))
    .stderr(Stdio::from(err));

  cmd.spawn()
}

fn dispatch_web_event(window: &tauri::Window, event_name: &str) {
  // Fire a CustomEvent in the webview so the Next.js UI can react.
  // Note: this runs after the webview has navigated to http://127.0.0.1:<port>/.
  let js = format!(
    "window.dispatchEvent(new CustomEvent({:?}));",
    event_name
  );
  let _ = window.eval(&js);
}

fn main() {
  let settings = CustomMenuItem::new("settings".to_string(), "Settings").accelerator("CmdOrCtrl+,");
  let command_palette =
    CustomMenuItem::new("command_palette".to_string(), "Command Palette").accelerator("CmdOrCtrl+K");
  // Mirrors the in-app shortcut (Cmd/Ctrl+F) used to open the command palette search.
  let find_assets =
    CustomMenuItem::new("find_assets".to_string(), "Find…").accelerator("CmdOrCtrl+F");
  // Project-context Settings shortcut used in the UI (Cmd/Ctrl+.).
  let project_settings =
    CustomMenuItem::new("project_settings".to_string(), "Project Settings…").accelerator("CmdOrCtrl+.");
  // On macOS, users expect ⌘⌫ ("Command+Delete") as the "delete selection" shortcut.
  // Avoid CmdOrCtrl+Backspace because Ctrl+Backspace is a common text-editing shortcut on Windows/Linux.
  let delete_accel = if cfg!(target_os = "macos") {
    "Cmd+Backspace"
  } else {
    "Backspace"
  };
  let delete_selection =
    CustomMenuItem::new("delete_selection".to_string(), "Delete Selection").accelerator(delete_accel);
  let reset_zoom = CustomMenuItem::new("reset_zoom".to_string(), "Reset Zoom (10%)").accelerator("CmdOrCtrl+0");
  let focus_toggle = CustomMenuItem::new("focus_toggle".to_string(), "Focus Toggle").accelerator("Space");

  let app_menu = Menu::new()
    .add_native_item(MenuItem::About("Moondream".to_string(), AboutMetadata::default()))
    .add_native_item(MenuItem::Separator)
    .add_item(settings.clone())
    .add_native_item(MenuItem::Separator)
    .add_native_item(MenuItem::Hide)
    .add_native_item(MenuItem::HideOthers)
    .add_native_item(MenuItem::ShowAll)
    .add_native_item(MenuItem::Separator)
    .add_native_item(MenuItem::Quit);

  let file_menu = Menu::new()
    .add_item(project_settings.clone())
    .add_item(settings.clone())
    .add_native_item(MenuItem::Separator)
    .add_native_item(MenuItem::CloseWindow);

  let edit_menu = Menu::new()
    .add_native_item(MenuItem::Undo)
    .add_native_item(MenuItem::Redo)
    .add_native_item(MenuItem::Separator)
    .add_native_item(MenuItem::Cut)
    .add_native_item(MenuItem::Copy)
    .add_native_item(MenuItem::Paste)
    .add_native_item(MenuItem::SelectAll)
    .add_native_item(MenuItem::Separator)
    .add_item(find_assets.clone());

  let view_menu = Menu::new()
    .add_item(command_palette.clone())
    .add_item(reset_zoom.clone())
    .add_item(focus_toggle.clone())
    .add_item(delete_selection.clone())
    .add_native_item(MenuItem::Separator)
    .add_native_item(MenuItem::EnterFullScreen);

  let window_menu = Menu::new()
    .add_native_item(MenuItem::Minimize)
    .add_native_item(MenuItem::Zoom);

  // macOS requires submenus for top-level items.
  let menu = Menu::new()
    .add_submenu(Submenu::new("Moondream", app_menu))
    .add_submenu(Submenu::new("File", file_menu))
    .add_submenu(Submenu::new("Edit", edit_menu))
    .add_submenu(Submenu::new("View", view_menu))
    .add_submenu(Submenu::new("Window", window_menu));

  tauri::Builder::default()
    .manage(ServerState {
      port: Mutex::new(None),
      child: Mutex::new(None),
      worker: Mutex::new(None),
    })
    .menu(menu)
    .on_menu_event(|event| {
      let id = event.menu_item_id();
      match id {
        "settings" => {
          // Navigate within the Next.js app.
          let _ = event.window().eval("window.location.href = '/settings';");
        }
        "project_settings" => {
          // Navigate with a fade, and include projectId when we're currently in /projects/:id.
          //
          // Mirrors the in-app shortcut logic:
          // - "." opens Settings (project context)
          // - Cmd+. / Ctrl+. also opens Settings (project context)
          //
          // Note: we do this here (rather than relying only on a web listener) so it still works
          // even if the project page hasn't mounted its listeners yet.
          let js = r#"
            (function () {
              try { window.dispatchEvent(new Event("moondream:route-fade:start")); } catch (_) {}
              var m = (window.location && window.location.pathname || "").match(/^\/projects\/([^\/?#]+)/);
              var pid = m && m[1] ? decodeURIComponent(m[1]) : null;
              var url = pid ? ("/settings?projectId=" + encodeURIComponent(pid)) : "/settings";
              window.setTimeout(function () { window.location.href = url; }, 220);
            })();
          "#;
          let _ = event.window().eval(js);
        }
        "command_palette" => {
          dispatch_web_event(event.window(), "moondream:command-palette:toggle");
        }
        "find_assets" => {
          dispatch_web_event(event.window(), "moondream:command-palette:open");
        }
        "delete_selection" => {
          dispatch_web_event(event.window(), "moondream:canvas:delete-selection");
        }
        "reset_zoom" => {
          dispatch_web_event(event.window(), "moondream:canvas:reset-zoom");
        }
        "focus_toggle" => {
          dispatch_web_event(event.window(), "moondream:canvas:focus-toggle");
        }
        _ => {}
      }
    })
    .invoke_handler(tauri::generate_handler![server_port])
    .setup(|app| {
      // In dev, Tauri points at the running Next dev server (http://localhost:3000).
      if cfg!(debug_assertions) {
        return Ok(());
      }

      let port = pick_free_port();
      {
        let state = app.state::<ServerState>();
        *state.port.lock().unwrap() = Some(port);
      }

      let handle = app.handle();
      let config_root = app
        .path_resolver()
        .app_data_dir()
        .ok_or_else(|| io::Error::new(ErrorKind::NotFound, "Missing app_data_dir"))?;
      std::fs::create_dir_all(&config_root)?;

      let settings = read_settings(&config_root);
      let mut settings = settings;
      let override_data_dir = apply_pending_migration(&config_root, &mut settings);
      let data_dir = override_data_dir.unwrap_or_else(|| resolve_data_dir(&config_root, &settings));
      std::fs::create_dir_all(&data_dir)?;

      let child = spawn_next_server(&handle, port, &config_root, &data_dir, &settings)?;
      {
        let state = app.state::<ServerState>();
        *state.child.lock().unwrap() = Some(child);
      }

      // Ensure the DB schema exists before starting the worker (so it won't crash on a fresh DB).
      // Hitting /api/projects forces `getDb()` + migrations.
      let _ = http_get_200("127.0.0.1", port, "/api/projects", Duration::from_secs(8));

      // Start the bundled worker automatically (best-effort). It will talk to a local Moondream Station.
      // If Station is not running, the worker will log errors and keep retrying.
      let db_path = data_dir.join("moondream.sqlite3");
      if let Ok(w) = spawn_worker(&handle, &db_path, &config_root, &settings) {
        let state = app.state::<ServerState>();
        *state.worker.lock().unwrap() = Some(w);
      }

      // Nudge the internal loading page so it can redirect as soon as health is ready.
      if let Some(window) = app.get_window("main") {
        // The initial `ui/index.html` is plain HTML and does not import @tauri-apps/api.
        // Provide the chosen port via a global so the page can poll `/api/health` and redirect
        // without relying on `window.__TAURI__.invoke(...)` being present.
        let _ = window.eval(&format!("window.__MOONDREAM_PORT__ = {};", port));
        // Helpful for debugging if the local server never becomes ready.
        let _ = window.eval(
          &format!(
            "window.__MOONDREAM_LOG_HINT__ = \"~/Library/Application Support/{}/logs/next-server.log\";",
            "com.moondream.desktop"
          )
        );

        // Keep emitting too (useful if we later switch to a JS listener).
        let _ = window.emit("moondream://server-ready", ServerInfo { port });
      }

      Ok(())
    })
    .on_window_event(|event| {
      if let tauri::WindowEvent::CloseRequested { api, .. } = event.event() {
        api.prevent_close();

        // Best-effort: stop the local server on app close.
        let state = event.window().state::<ServerState>();
        if let Some(mut child) = state.child.lock().unwrap().take() {
          let _ = child.kill();
        }
        if let Some(mut worker) = state.worker.lock().unwrap().take() {
          let _ = worker.kill();
        }

        let _ = event.window().close();
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}


