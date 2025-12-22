import { spawn } from "node:child_process";

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

console.log(`[dev] starting: ${nextCmd}`);
console.log(`[dev] starting: ${stationCmd}`);

const next = spawnCmd("next", nextCmd);
const station = spawnCmd("moondream-station", stationCmd);

// If station command isn't available, it will typically exit quickly with non-zero.
// Keep next running, but surface a helpful message.
let stationExited = false;
station.on("exit", (code) => {
  stationExited = true;
  if (code && code !== 0) {
    console.log(
      `[dev] moondream-station failed to start. Ensure it's installed and on PATH.\n` +
        `      You can also override via MOONDREAM_STATION_CMD.\n` +
        `      Example: MOONDREAM_STATION_CMD=\"${stationCmd}\" npm run dev`
    );
  }
});

function shutdown() {
  try {
    next.kill("SIGINT");
  } catch {}
  try {
    if (!stationExited) station.kill("SIGINT");
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


