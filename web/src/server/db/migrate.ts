// NOTE: Migrations are intentionally embedded as strings so they still work when
// the app is packaged (e.g. Next `output: 'standalone'`), where source files
// like `src/server/db/migrations/*.sql` are not available at runtime.
import type { Database } from "better-sqlite3";

const MIGRATION_001 = `PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  storage_url TEXT NOT NULL,
  thumb_path TEXT,
  thumb_url TEXT,
  width INTEGER,
  height INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS assets_project_sha256_uq ON assets(project_id, sha256);
CREATE INDEX IF NOT EXISTS assets_project_id_idx ON assets(project_id);

CREATE TABLE IF NOT EXISTS asset_ai (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  caption TEXT,
  tags_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  model_version TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS canvas_objects (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  asset_id TEXT REFERENCES assets(id) ON DELETE SET NULL,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  scale_x REAL NOT NULL DEFAULT 1,
  scale_y REAL NOT NULL DEFAULT 1,
  rotation REAL NOT NULL DEFAULT 0,
  width REAL,
  height REAL,
  z_index INTEGER NOT NULL DEFAULT 0,
  props_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS canvas_objects_project_id_idx ON canvas_objects(project_id);

-- Full-text search across filename + AI caption + tags
CREATE VIRTUAL TABLE IF NOT EXISTS asset_search USING fts5(
  asset_id UNINDEXED,
  project_id UNINDEXED,
  original_name,
  caption,
  tags
);
`;

const MIGRATION_002 = `PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS project_view (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  world_x REAL NOT NULL DEFAULT 0,
  world_y REAL NOT NULL DEFAULT 0,
  zoom REAL NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const MIGRATION_003 = `PRAGMA foreign_keys = ON;

-- Store caption embeddings for semantic/vector search.
-- We keep this schema portable so it can be migrated to Supabase/pgvector later.
CREATE TABLE IF NOT EXISTS asset_embeddings (
  asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dim INTEGER NOT NULL,
  embedding BLOB,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Store per-tag segmentation results so searches like "apple" can highlight on-image regions.
-- One row per (asset_id, tag).
CREATE TABLE IF NOT EXISTS asset_segments (
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  svg TEXT,
  bbox_json TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (asset_id, tag)
);

CREATE INDEX IF NOT EXISTS asset_segments_tag_idx ON asset_segments(tag);
`;

const MIGRATION_004 = `PRAGMA foreign_keys = ON;

-- Small key/value store for local app state (desktop + local-first web).
-- Used for "reopen last project" on launch.
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

const MIGRATION_005 = `PRAGMA foreign_keys = ON;

-- Soft-delete assets (Trash) so deletes are reversible.
ALTER TABLE assets ADD COLUMN deleted_at TEXT;
ALTER TABLE assets ADD COLUMN trashed_storage_path TEXT;
ALTER TABLE assets ADD COLUMN trashed_thumb_path TEXT;

-- Allow re-uploading a file after trashing it by enforcing uniqueness only for non-deleted assets.
DROP INDEX IF EXISTS assets_project_sha256_uq;
CREATE UNIQUE INDEX IF NOT EXISTS assets_project_sha256_uq
  ON assets(project_id, sha256)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS assets_deleted_at_idx ON assets(deleted_at);
`;

const MIGRATION_006 = `PRAGMA foreign_keys = ON;

-- Track per-project revision counters so clients can detect stale writes (helps multi-device + iCloud scenarios).
CREATE TABLE IF NOT EXISTS project_sync (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  canvas_rev INTEGER NOT NULL DEFAULT 0,
  view_rev INTEGER NOT NULL DEFAULT 0,
  canvas_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  view_updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export function ensureMigrations(db: Database) {
  db.pragma("foreign_keys = ON");

  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  let current = row?.user_version ?? 0;

  if (current < 1) {
    const sql = MIGRATION_001;
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
    const sql = MIGRATION_002;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.exec("PRAGMA user_version = 2");
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    current = 2;
  }

  if (current < 3) {
    const sql = MIGRATION_003;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.exec("PRAGMA user_version = 3");
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    current = 3;
  }

  if (current < 4) {
    const sql = MIGRATION_004;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.exec("PRAGMA user_version = 4");
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  if (current < 5) {
    const sql = MIGRATION_005;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.exec("PRAGMA user_version = 5");
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  if (current < 6) {
    const sql = MIGRATION_006;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.exec("PRAGMA user_version = 6");
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}


