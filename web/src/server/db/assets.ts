import type { AssetRow, AssetWithAi } from "./types";
import { getDb } from "./db";
import { upsertAssetSearchRow } from "./search";

export function findAssetByProjectSha(projectId: string, sha256: string): AssetRow | null {
  const db = getDb();
  return (
    (db
      .prepare("SELECT * FROM assets WHERE project_id = ? AND sha256 = ?")
      .get(projectId, sha256) as AssetRow | undefined) ?? null
  );
}

export function insertAsset(row: Omit<AssetRow, "created_at">): AssetRow {
  const db = getDb();
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO assets (
      id, project_id, original_name, mime_type, byte_size, sha256,
      storage_path, storage_url, thumb_path, thumb_url, width, height, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.project_id,
    row.original_name,
    row.mime_type,
    row.byte_size,
    row.sha256,
    row.storage_path,
    row.storage_url,
    row.thumb_path,
    row.thumb_url,
    row.width,
    row.height,
    createdAt
  );

  upsertAssetSearchRow({
    projectId: row.project_id,
    assetId: row.id,
    originalName: row.original_name,
    caption: null,
    tags: [],
  });

  return getAsset(row.id)!;
}

export function upsertAssetAi(args: {
  assetId: string;
  status: "pending" | "processing" | "done" | "failed";
  caption?: string | null;
  tagsJson?: string | null;
  modelVersion?: string | null;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO asset_ai (asset_id, caption, tags_json, status, model_version, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(asset_id) DO UPDATE SET
       caption=excluded.caption,
       tags_json=excluded.tags_json,
       status=excluded.status,
       model_version=excluded.model_version,
       updated_at=excluded.updated_at`
  ).run(
    args.assetId,
    args.caption ?? null,
    args.tagsJson ?? null,
    args.status,
    args.modelVersion ?? null,
    now
  );

  const joined = getAsset(args.assetId);
  if (joined) {
    let tags: string[] = [];
    try {
      tags = joined.ai_tags_json ? (JSON.parse(joined.ai_tags_json) as string[]) : [];
    } catch {
      tags = [];
    }
    upsertAssetSearchRow({
      projectId: joined.project_id,
      assetId: joined.id,
      originalName: joined.original_name,
      caption: joined.ai_caption,
      tags,
    });
  }
}

export function listAssets(args: {
  projectId: string;
  limit?: number;
  offset?: number;
}): AssetWithAi[] {
  const db = getDb();
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const offset = Math.max(args.offset ?? 0, 0);

  return db
    .prepare(
      `SELECT
        a.*,
        ai.caption AS ai_caption,
        ai.tags_json AS ai_tags_json,
        ai.status AS ai_status,
        ai.model_version AS ai_model_version,
        ai.updated_at AS ai_updated_at
      FROM assets a
      LEFT JOIN asset_ai ai ON ai.asset_id = a.id
      WHERE a.project_id = ?
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?`
    )
    .all(args.projectId, limit, offset) as AssetWithAi[];
}

export function getAsset(assetId: string): AssetWithAi | null {
  const db = getDb();
  return (
    (db
      .prepare(
        `SELECT
          a.*,
          ai.caption AS ai_caption,
          ai.tags_json AS ai_tags_json,
          ai.status AS ai_status,
          ai.model_version AS ai_model_version,
          ai.updated_at AS ai_updated_at
        FROM assets a
        LEFT JOIN asset_ai ai ON ai.asset_id = a.id
        WHERE a.id = ?`
      )
      .get(assetId) as AssetWithAi | undefined) ?? null
  );
}


