PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS project_view (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  world_x REAL NOT NULL DEFAULT 0,
  world_y REAL NOT NULL DEFAULT 0,
  zoom REAL NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);


