import crypto from "node:crypto";

import { getDb } from "./db";
import type { ProjectRow } from "./types";

export function createProject(name: string): ProjectRow {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO projects (id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`
  ).run(id, name, now, now);

  return getProject(id)!;
}

export function getProject(id: string): ProjectRow | null {
  const db = getDb();
  return (
    (db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined) ??
    null
  );
}

export function listProjects(): ProjectRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM projects ORDER BY updated_at DESC, created_at DESC")
    .all() as ProjectRow[];
}

export function renameProject(id: string, name: string): ProjectRow | null {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db
    .prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?")
    .run(name, now, id);
  if (result.changes === 0) return null;
  return getProject(id);
}

export function deleteProject(id: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  return result.changes > 0;
}


