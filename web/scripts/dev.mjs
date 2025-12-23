import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function spawnCmd(name, cmd, { env = process.env } = {}) {
  const child = spawn(cmd, {
    stdio: "inherit",
    shell: true,
    env,
  });
  child.on("exit", (code, signal) => {
    if (code === 0) return;
    console.log(`[dev] ${name} exited`, { code, signal });
  });
  return child;
}

const stationCmd = process.env.MOONDREAM_STATION_CMD || "moondream-station";
const nextCmd = process.env.NEXT_DEV_CMD || "next dev --webpack";
const startWorker = (process.env.MOONDREAM_START_WORKER ?? "1") !== "0";
// Default off: Moondream Station is interactive and may require a real TTY.
// Run it separately (recommended), or set MOONDREAM_START_STATION=1.
const startStation = (process.env.MOONDREAM_START_STATION ?? "0") !== "0";

const repoRoot = path.resolve(process.cwd(), "..");
const defaultDbPath = path.resolve(repoRoot, "data", "moondream.sqlite3");
const workerPy = path.resolve(repoRoot, "worker", "moondream_worker.py");
const workerVenvPy = path.resolve(
  repoRoot,
  "worker",
  ".venv",
  "bin",
  process.platform === "win32" ? "python.exe" : "python"
);
const workerCmd =
  process.env.MOONDREAM_WORKER_CMD ||
  (fs.existsSync(workerVenvPy)
    ? `"${workerVenvPy}" -u "${workerPy}"`
    : `python3 -u "${workerPy}"`);

function parseEndpoint(input) {
  try {
    const u = new URL(input);
    const port = Number(u.port || "80");
    return { protocol: u.protocol, host: u.hostname, port };
  } catch {
    return { protocol: "http:", host: "127.0.0.1", port: 2020 };
  }
}

async function isHealthyStation(baseUrl) {
  const url = `${baseUrl.replace(/\/$/, "")}/health`;
  try {
    const r = await fetch(url, { method: "GET" });
    return r.ok;
  } catch {
    return false;
  }
}

async function checkCaptionReadyOnce(baseUrl) {
  // Single-shot readiness probe (do not poll; it can contribute to queue pressure).
  const enabled = (process.env.MOONDREAM_REQUIRE_STATION_READY ?? "0") === "1";
  if (!enabled) return true;
  const probeUrl = `${baseUrl.replace(/\/$/, "")}/v1/caption`;
  const body = {
    stream: false,
    length: "short",
    image_url:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBAO6b0tQAAAAASUVORK5CYII=",
  };
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    const r = await fetch(probeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    }).finally(() => clearTimeout(t));
    if (!r.ok) return false;
    const data = await r.json().catch(() => null);
    if (!data || typeof data !== "object") return false;
    if (data.error || data.status === "timeout" || data.status === "rejected") return false;
    const text = (data.caption || data.text || "").toString().trim();
    return Boolean(text);
  } catch {
    return false;
  }
}

async function findStationEndpoint({ timeoutMs = 60000 } = {}) {
  const raw = process.env.MOONDREAM_ENDPOINT || "http://127.0.0.1:2020";
  const { protocol, host, port } = parseEndpoint(raw);
  const portsToTry = [
    port,
    // Common fallback if default port is occupied:
    port + 1,
    port + 2,
    port + 3,
    2020,
    2021,
    2022,
  ].filter((p, i, a) => a.indexOf(p) === i);

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const p of portsToTry) {
      const base = `${protocol}//${host}:${p}`;
      // eslint-disable-next-line no-await-in-loop
      if (await isHealthyStation(base)) return base;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 600));
  }
  return null;
}

async function waitForStationHealth({ timeoutMs = 60000 } = {}) {
  const start = Date.now();
  const raw = process.env.MOONDREAM_ENDPOINT || "http://127.0.0.1:2020";
  const url = `${raw.replace(/\/$/, "")}/health`;
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(url, { method: "GET" });
      if (r.ok) return true;
    } catch {
      // ignore
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  return false;
}

console.log(`[dev] starting: ${nextCmd}`);
if (startStation) console.log(`[dev] starting: ${stationCmd}`);
if (startWorker) console.log(`[dev] will start worker after station is reachable: ${workerCmd}`);

const next = spawnCmd("next", nextCmd);
let station = null;
let stationEndpointResolved = null;

// If a station is already running (common when it was started manually), don't spawn another.
(async () => {
  stationEndpointResolved = await findStationEndpoint({ timeoutMs: 1500 });
  if (stationEndpointResolved) {
    console.log(`[dev] detected existing moondream-station at ${stationEndpointResolved}`);
    return;
  }
  if (!startStation) return;
  station = spawnCmd("moondream-station", stationCmd);
})();

// If station command isn't available, it will typically exit quickly with non-zero.
// Keep next running, but surface a helpful message.
let stationExited = false;
function attachStationExit(child) {
  if (!child) return;
  child.on("exit", (code) => {
  stationExited = true;
  if (code && code !== 0) {
    console.log(
      `[dev] moondream-station failed to start. Ensure it's installed and on PATH.\n` +
        `      You can also override via MOONDREAM_STATION_CMD.\n` +
        `      Example: MOONDREAM_STATION_CMD=\"${stationCmd}\" npm run dev`
    );
  }
  });
}
attachStationExit(station);

let worker = null;
let workerExited = false;
(async () => {
  if (!startWorker) return;
  // Keep trying to find Station; user may start it after `npm run dev`.
  // (Also handles port shifts like 2020 -> 2021.)
  let lastWarnAt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    stationEndpointResolved =
      stationEndpointResolved ?? (await findStationEndpoint({ timeoutMs: 2000 }));
    if (stationEndpointResolved) break;
    const now = Date.now();
    if (now - lastWarnAt > 15000) {
      lastWarnAt = now;
      console.log(
        `[dev] waiting for moondream-station... ` +
          `Start it (or set MOONDREAM_ENDPOINT), then the worker will auto-start.`
      );
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 1500));
  }
  // Optional single-shot readiness check; by default we rely on worker retry/backoff.
  // (Polling caption can create queue pressure and cause 'Queue is full'.)
  // eslint-disable-next-line no-await-in-loop
  const captionReady = await checkCaptionReadyOnce(stationEndpointResolved);
  if (!captionReady) {
    console.log(
      `[dev] station reachable but caption probe not ready yet; worker will retry/backoff.\n` +
        `      If this persists, open Moondream Station and ensure the model service is running.`
    );
  }

  if (!fs.existsSync(workerPy)) {
    console.log(`[dev] worker not started: missing ${workerPy}`);
    return;
  }

  console.log(
    `[dev] starting worker (db=${defaultDbPath} endpoint=${stationEndpointResolved})`
  );
  worker = spawnCmd("worker", workerCmd, {
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      MOONDREAM_DB_PATH: process.env.MOONDREAM_DB_PATH || defaultDbPath,
      MOONDREAM_ENDPOINT: stationEndpointResolved,
      MOONDREAM_POLL_SECONDS: process.env.MOONDREAM_POLL_SECONDS || "1.0",
    },
  });
  worker.on("exit", () => {
    workerExited = true;
  });
})();

function shutdown() {
  try {
    next.kill("SIGINT");
  } catch {}
  try {
    if (station && !stationExited) station.kill("SIGINT");
  } catch {}
  try {
    if (worker && !workerExited) worker.kill("SIGINT");
  } catch {}
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

next.on("exit", (code) => {
  shutdown();
  process.exit(code ?? 0);
});


