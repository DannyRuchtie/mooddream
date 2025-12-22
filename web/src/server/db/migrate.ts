import fs from "node:fs";
import path from "node:path";

function readSqlFile(relativePathFromHere: string) {
  // In Next.js dev, `process.cwd()` is the `web/` directory.
  // We keep migrations in source so they can be inspected and edited easily.
  const abs = path.resolve(process.cwd(), "src/server/db", relativePathFromHere);
  return fs.readFileSync(abs, "utf8");
}

export function ensureMigrations(db: any) {
  db.pragma("foreign_keys = ON");

  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  let current = row?.user_version ?? 0;

  if (current < 1) {
    const sql = readSqlFile("./migrations/001_init.sql");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.exec("PRAGMA user_version = 1");
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    current = 1;
  }

  if (current < 2) {
    const sql = readSqlFile("./migrations/002_project_view.sql");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.exec("PRAGMA user_version = 2");
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}


