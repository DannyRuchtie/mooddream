import fs from "node:fs";
import path from "node:path";

import { configRootDir } from "@/server/appConfig";
import { getDb } from "@/server/db/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readTailLines(filePath: string, opts?: { maxBytes?: number; maxLines?: number }) {
  const maxBytes = Math.max(1024, opts?.maxBytes ?? 64 * 1024);
  const maxLines = Math.max(1, opts?.maxLines ?? 50);

  const st = fs.statSync(filePath);
  const size = st.size;
  const start = Math.max(0, size - maxBytes);
  const toRead = size - start;

  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(toRead);
    fs.readSync(fd, buf, 0, toRead, start);
    const text = buf.toString("utf8");
    const lines = text.split(/\r?\n/g).filter(Boolean);
    return lines.slice(-maxLines);
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore
    }
  }
}

function parseCurrentFromLog(lines: string[]) {
  // Example:
  // [worker] processing asset=<id> file=<original_name>
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i] || "";
    const m = line.match(/^\[worker\]\s+processing\s+asset=([^\s]+)\s+file=(.+)$/);
    if (m) return { assetId: m[1] ?? null, file: (m[2] ?? "").trim() || null };
  }
  return { assetId: null, file: null };
}

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) as count
       FROM asset_ai
       GROUP BY status`
    )
    .all() as { status: string; count: number }[];

  const counts = { pending: 0, processing: 0, done: 0, failed: 0, total: 0 };
  for (const r of rows) {
    const s = (r.status || "").toLowerCase();
    const n = Number(r.count || 0);
    if (s === "pending") counts.pending += n;
    else if (s === "processing") counts.processing += n;
    else if (s === "done") counts.done += n;
    else if (s === "failed") counts.failed += n;
    counts.total += n;
  }

  const root = configRootDir();
  const logPath = path.join(root, "logs", "moondream-worker.log");

  let logAvailable = false;
  let lastLogAt: string | null = null;
  let recentLines: string[] = [];
  let currentAssetId: string | null = null;
  let currentFile: string | null = null;

  try {
    if (fs.existsSync(logPath)) {
      logAvailable = true;
      const st = fs.statSync(logPath);
      lastLogAt = new Date(st.mtimeMs).toISOString();
      recentLines = readTailLines(logPath, { maxBytes: 96 * 1024, maxLines: 40 });
      const parsed = parseCurrentFromLog(recentLines);
      currentAssetId = parsed.assetId;
      currentFile = parsed.file;
    }
  } catch {
    // ignore (best-effort diagnostics only)
  }

  return Response.json({
    counts,
    worker: {
      logAvailable,
      lastLogAt,
      currentAssetId,
      currentFile,
      recentLines,
    },
  });
}


