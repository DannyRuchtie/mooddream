import type { CanvasObjectRow } from "./types";
import { getDb } from "./db";
import type { ProjectSyncRow, ProjectViewRow } from "./types";

export function getProjectSync(projectId: string): ProjectSyncRow {
  const db = getDb();
  const row =
    (db
      .prepare("SELECT * FROM project_sync WHERE project_id = ?")
      .get(projectId) as ProjectSyncRow | undefined) ?? null;
  if (row) return row;

  // Ensure a row exists so callers have stable defaults.
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO project_sync (project_id, canvas_rev, view_rev, canvas_updated_at, view_updated_at)
     VALUES (?, 0, 0, ?, ?)
     ON CONFLICT(project_id) DO NOTHING`
  ).run(projectId, now, now);
  return (
    (db
      .prepare("SELECT * FROM project_sync WHERE project_id = ?")
      .get(projectId) as ProjectSyncRow | undefined) ?? {
      project_id: projectId,
      canvas_rev: 0,
      view_rev: 0,
      canvas_updated_at: now,
      view_updated_at: now,
    }
  );
}

export function getCanvasObjects(projectId: string): CanvasObjectRow[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT * FROM canvas_objects
       WHERE project_id = ?
       ORDER BY z_index ASC, created_at ASC`
    )
    .all(projectId) as CanvasObjectRow[];
}

export function replaceCanvasObjects(args: {
  projectId: string;
  objects: Array<
    Omit<CanvasObjectRow, "project_id" | "created_at" | "updated_at"> & {
      project_id?: string;
      created_at?: string;
      updated_at?: string;
    }
  >;
}) {
  const db = getDb();
  const now = new Date().toISOString();

  const del = db.prepare("DELETE FROM canvas_objects WHERE project_id = ?");
  const ins = db.prepare(
    `INSERT INTO canvas_objects (
      id, project_id, type, asset_id, x, y, scale_x, scale_y, rotation,
      width, height, z_index, props_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const bump = db.prepare(
    `INSERT INTO project_sync (project_id, canvas_rev, view_rev, canvas_updated_at, view_updated_at)
     VALUES (?, 1, 0, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       canvas_rev = canvas_rev + 1,
       canvas_updated_at = excluded.canvas_updated_at`
  );

  const tx = db.transaction(() => {
    del.run(args.projectId);
    for (const o of args.objects) {
      ins.run(
        o.id,
        args.projectId,
        o.type,
        o.asset_id ?? null,
        o.x,
        o.y,
        o.scale_x,
        o.scale_y,
        o.rotation,
        o.width ?? null,
        o.height ?? null,
        o.z_index,
        o.props_json ?? null,
        now,
        now
      );
    }
    // Keep a lightweight revision counter for conflict detection.
    bump.run(args.projectId, now, now);
  });
  tx();
}

export function getProjectView(projectId: string): ProjectViewRow | null {
  const db = getDb();
  return (
    (db
      .prepare("SELECT * FROM project_view WHERE project_id = ?")
      .get(projectId) as ProjectViewRow | undefined) ?? null
  );
}

export function upsertProjectView(args: {
  projectId: string;
  world_x: number;
  world_y: number;
  zoom: number;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT INTO project_view (project_id, world_x, world_y, zoom, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       world_x=excluded.world_x,
       world_y=excluded.world_y,
       zoom=excluded.zoom,
       updated_at=excluded.updated_at`
  );
  const bump = db.prepare(
    `INSERT INTO project_sync (project_id, canvas_rev, view_rev, canvas_updated_at, view_updated_at)
     VALUES (?, 0, 1, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       view_rev = view_rev + 1,
       view_updated_at = excluded.view_updated_at`
  );
  const tx = db.transaction(() => {
    upsert.run(args.projectId, args.world_x, args.world_y, args.zoom, now);
    bump.run(args.projectId, now, now);
  });
  tx();
}


