import { getDb } from "./db";

function nowIso() {
  return new Date().toISOString();
}

export function getAppState(key: string): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM app_state WHERE key = ?")
    .get(key) as { value?: string } | undefined;
  return row?.value ?? null;
}

export function setAppState(key: string, value: string | null) {
  const db = getDb();
  if (value === null) {
    db.prepare("DELETE FROM app_state WHERE key = ?").run(key);
    return;
  }
  db.prepare(
    `INSERT INTO app_state (key, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       value=excluded.value,
       updated_at=excluded.updated_at`
  ).run(key, value, nowIso());
}

const LAST_PROJECT_KEY = "last_project_id";

export function getLastOpenedProjectId(): string | null {
  return getAppState(LAST_PROJECT_KEY);
}

export function setLastOpenedProjectId(projectId: string) {
  setAppState(LAST_PROJECT_KEY, projectId);
}

export function clearLastOpenedProjectId() {
  setAppState(LAST_PROJECT_KEY, null);
}


