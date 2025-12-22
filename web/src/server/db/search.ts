import { getDb } from "./db";
import type { AssetWithAi } from "./types";

function buildFtsQuery(raw: string) {
  const tokens = raw
    .trim()
    .split(/\s+/g)
    .map((t) => t.replace(/["']/g, "").trim())
    .filter(Boolean);
  if (tokens.length === 0) return "";
  // Prefix match each token for a more forgiving UX.
  return tokens.map((t) => `${t}*`).join(" ");
}

export function upsertAssetSearchRow(args: {
  projectId: string;
  assetId: string;
  originalName: string;
  caption?: string | null;
  tags?: string[] | null;
}) {
  const db = getDb();
  const tagsText = (args.tags ?? []).filter(Boolean).join(" ");

  const deleteStmt = db.prepare("DELETE FROM asset_search WHERE asset_id = ?");
  const insertStmt = db.prepare(
    `INSERT INTO asset_search (asset_id, project_id, original_name, caption, tags)
     VALUES (?, ?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    deleteStmt.run(args.assetId);
    insertStmt.run(
      args.assetId,
      args.projectId,
      args.originalName,
      args.caption ?? "",
      tagsText
    );
  });
  tx();
}

export function searchAssets(args: {
  projectId: string;
  query: string;
  limit?: number;
}): AssetWithAi[] {
  const db = getDb();
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
  const q = buildFtsQuery(args.query);

  if (!q) {
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
        LIMIT ?`
      )
      .all(args.projectId, limit) as AssetWithAi[];
  }

  return db
    .prepare(
      `SELECT
        a.*,
        ai.caption AS ai_caption,
        ai.tags_json AS ai_tags_json,
        ai.status AS ai_status,
        ai.model_version AS ai_model_version,
        ai.updated_at AS ai_updated_at
      FROM asset_search s
      JOIN assets a ON a.id = s.asset_id
      LEFT JOIN asset_ai ai ON ai.asset_id = a.id
      WHERE s.project_id = ? AND asset_search MATCH ?
      ORDER BY rank
      LIMIT ?`
    )
    .all(args.projectId, q, limit) as AssetWithAi[];
}


