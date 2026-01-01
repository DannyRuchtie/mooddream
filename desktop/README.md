# Desktop (macOS) wrapper — Option A (Tauri + local Next.js server)

This folder adds a **standalone desktop app** wrapper around the existing Next.js + PixiJS app by:

- Bundling the built Next.js server output (`next.config.ts` uses `output: "standalone"`)
- Launching it locally on `127.0.0.1:<random_port>` at app start
- Loading the UI in a Tauri webview
- Storing all data under a writable per-user directory via `MOONDREAM_DATA_DIR` (configurable via in-app Settings)

## Prereqs (local machine)

- Node.js 20+
- Rust toolchain (stable): `rustup` + Xcode command line tools

## Dev flow

Run the web app as usual:

```bash
cd web
npm run dev
```

Then in another terminal:

```bash
cd desktop
npm install
npm run dev
```

In dev mode, the Tauri window points at `http://localhost:3000` and does **not** spawn a bundled server.

## Production build (desktop app)

### 0) Install system prereqs (one time)

On macOS:

```bash
xcode-select --install
```

Install Rust (stable) via rustup (recommended):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Restart your terminal so `cargo` is on PATH.

### 1) Bundle Node (Apple Silicon only)

This desktop build is intended to be **truly standalone** (users do not need Node installed).

Copy a macOS **arm64** Node binary into:

```text
desktop/src-tauri/resources/bin/node
```

Quick way (uses your current Node installation):

```bash
cp "$(command -v node)" desktop/src-tauri/resources/bin/node
chmod +x desktop/src-tauri/resources/bin/node
```

(Recommended) Better way: download a Node.js macOS arm64 release (v20) and copy its `bin/node` here.

### 2) Build the app

```bash
cd desktop
npm install
npm run build
```

`npm run build` will:

1. Build the Next.js app in `../web`
2. Copy the Next standalone output into `desktop/src-tauri/resources/next`
3. Build the Tauri app bundle

### Updating the app icon

Tauri bundles icons from `desktop/src-tauri/icons/` (not `desktop/icon.png` directly). If you change `desktop/icon.png`, regenerate the Tauri icon set and rebuild:

```bash
cd /Users/dannyruchtie/Documents/moondream/desktop/src-tauri
npx --no-install tauri icon ../icon.png
```

```bash
cd /Users/dannyruchtie/Documents/moondream/desktop
npx --no-install tauri build
```

### Output location

After a successful build, the `.app` bundle is written to:

```text
desktop/src-tauri/target/release/bundle/macos/Reference.app
```

### Optional: create a simple DMG (recommended, reliable)

Tauri's "fancy" DMG bundling (Finder layout AppleScript) can occasionally fail to unmount on macOS.
This creates a simple DMG that works reliably:

```bash
APP="/Users/$USER/Documents/moondream/desktop/src-tauri/target/release/bundle/macos/Reference.app"
OUT="/Users/$USER/Documents/moondream/desktop/src-tauri/target/release/bundle/dmg/Reference_aarch64-simple.dmg"
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
hdiutil create -volname "Reference" -srcfolder "$APP" -ov -format UDZO "$OUT"
echo "DMG written to: $OUT"
```

### Data location (desktop)

By default (Local mode), all local-first data lives under:

```text
~/Library/Application Support/com.moondream.desktop/data/
```

- `.../moondream.sqlite3` (DB)
- `.../projects/<projectId>/assets/` (images)
- `.../projects/<projectId>/thumbs/` (thumbnails)

### Settings + iCloud Drive storage

The desktop app has a Settings screen at:

- `Settings` button (top-right) when inside a project

Settings are stored at:

```text
~/Library/Application Support/com.moondream.desktop/settings.json
```

If you switch Storage to **iCloud Drive**, the app will (on next launch) store the entire data folder (DB + assets + thumbs) under:

```text
~/Library/Mobile Documents/com~apple~CloudDocs/Reference/
```

Compatibility note: if you previously used the old iCloud folder, the app will continue using it unless you explicitly migrate.

Important: iCloud Drive sync is file-based. Avoid opening the app on multiple Macs at the same time when using iCloud storage (SQLite WAL files can conflict).

## Bundled Python worker (auto-start)

The desktop build bundles the Python worker as an executable and starts it automatically on launch:

- Worker binary: `desktop/src-tauri/resources/bin/moondream-worker`
- Worker logs: `~/Library/Application Support/com.moondream.desktop/logs/moondream-worker.log`

The Next.js server logs are written to:

```text
~/Library/Application Support/com.moondream.desktop/logs/next-server.log
```

The worker expects the local AI station to be running (default `http://127.0.0.1:2020`).
You can override via environment variables when launching the app:

- `MOONDREAM_ENDPOINT` (default `http://127.0.0.1:2020`)
- `MOONDREAM_PROVIDER` (default `local_station`)

If Station is not running, the worker will keep assets in a retry/pending state and back off.

### Bundling Node (for a truly standalone app)

The build will fail unless `desktop/src-tauri/resources/bin/node` exists and is executable.

See `desktop/src-tauri/resources/bin/README.md` for details.


