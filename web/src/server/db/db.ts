import fs from "node:fs";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";

import { ensureMigrations } from "./migrate";

declare global {
  // eslint-disable-next-line no-var
  var __moondreamDb: any | undefined;
}

function defaultDbPath() {
  // Default to repo-root /data so both Next.js and the Python worker can share it.
  return path.resolve(process.cwd(), "..", "data", "moondream.sqlite3");
}

export function getDb() {
  if (!globalThis.__moondreamDb) {
    const dbPath = process.env.MOONDREAM_DB_PATH || defaultDbPath();
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    const db: any = new (BetterSqlite3 as any)(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 5000");
    globalThis.__moondreamDb = db;
  }

  // Always ensure migrations. In dev, the DB connection can be cached across hot reloads
  // and new migrations would otherwise not run until a full process restart.
  ensureMigrations(globalThis.__moondreamDb);
  return globalThis.__moondreamDb;
}


