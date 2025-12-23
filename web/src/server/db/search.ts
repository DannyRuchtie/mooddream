import { getDb } from "./db";
import type { AssetWithAi } from "./types";
import { execFileSync } from "node:child_process";

function buildFtsQuery(raw: string) {
  const tokens = raw
    .trim()
    .split(/\s+/g)
    .map((t) => t.replace(/["']/g, "").trim())
    // FTS5 query syntax is picky (e.g. dots in filenames can error).
    // Keep only alphanumerics/underscore; treat the rest as separators.
    .map((t) => t.replace(/[^a-zA-Z0-9_]+/g, "").trim())
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

export function deleteAssetSearchRow(assetId: string) {
  const db = getDb();
  db.prepare("DELETE FROM asset_search WHERE asset_id = ?").run(assetId);
}

export function deleteAssetSearchRowsByProject(projectId: string) {
  const db = getDb();
  db.prepare("DELETE FROM asset_search WHERE project_id = ?").run(projectId);
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

function vectorEnabled() {
  if (process.env.VERCEL) return false; // keep Vercel/serverless safe by default
  const mode = (process.env.MOONDREAM_VECTOR_MODE || "off").toLowerCase();
  return mode !== "off" && mode !== "0" && mode !== "false";
}

function embedQueryWithPython(query: string): { model: string; dim: number; vec: number[] } | null {
  if (!vectorEnabled()) return null;
  const python = process.env.MOONDREAM_PYTHON || "python3";
  const model = process.env.MOONDREAM_EMBEDDING_MODEL || "sentence-transformers/all-MiniLM-L6-v2";
  const script = `
import json, os, sys
from sentence_transformers import SentenceTransformer
model = SentenceTransformer(os.environ.get("MOONDREAM_EMBEDDING_MODEL") or ${JSON.stringify(model)})
q = sys.stdin.read() or ""
vec = model.encode([q], normalize_embeddings=True)[0]
print(json.dumps({"model": os.environ.get("MOONDREAM_EMBEDDING_MODEL") or ${JSON.stringify(
    model
  )}, "dim": int(len(vec)), "vec": [float(x) for x in vec]}))
`.trim();

  try {
    const out = execFileSync(python, ["-c", script], {
      input: query,
      env: { ...process.env, MOONDREAM_EMBEDDING_MODEL: model },
      maxBuffer: 10 * 1024 * 1024,
    }).toString("utf8");
    const parsed = JSON.parse(out) as { model: string; dim: number; vec: number[] };
    if (!parsed?.vec?.length || !parsed?.dim) return null;
    return parsed;
  } catch {
    return null;
  }
}

function dot(a: Float32Array, b: Float32Array) {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function getEmbeddingsForProject(projectId: string) {
  const db = getDb();
  return db
    .prepare(
      `SELECT e.asset_id AS asset_id, e.model AS model, e.dim AS dim, e.embedding AS embedding
       FROM asset_embeddings e
       JOIN assets a ON a.id = e.asset_id
       WHERE a.project_id = ? AND e.embedding IS NOT NULL`
    )
    .all(projectId) as Array<{ asset_id: string; model: string; dim: number; embedding: Buffer }>;
}

function getAssetsByIdsPreserveOrder(assetIds: string[]): AssetWithAi[] {
  if (!assetIds.length) return [];
  const db = getDb();
  const placeholders = assetIds.map(() => "?").join(", ");
  const orderCase = assetIds.map(() => "WHEN ? THEN ?").join(" ");
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
      WHERE a.id IN (${placeholders})
      ORDER BY CASE a.id ${orderCase} ELSE 999999 END`
    )
    .all(...assetIds, ...assetIds.flatMap((id, idx) => [id, idx])) as AssetWithAi[];
}

function searchAssetsVector(args: { projectId: string; query: string; limit: number }): AssetWithAi[] {
  const q = args.query.trim();
  if (!q) return [];
  const qEmb = embedQueryWithPython(q);
  if (!qEmb) return [];

  const rows = getEmbeddingsForProject(args.projectId).filter((r) => r.model === qEmb.model);
  if (!rows.length) return [];

  const qVec = new Float32Array(qEmb.vec);
  const scored: Array<{ assetId: string; score: number }> = [];
  for (const r of rows) {
    const buf = r.embedding;
    const f32 = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
    if (f32.length !== qVec.length) continue;
    scored.push({ assetId: r.asset_id, score: dot(qVec, f32) });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, args.limit).map((s) => s.assetId);
  return getAssetsByIdsPreserveOrder(top);
}

export async function searchAssetsAdvanced(args: {
  projectId: string;
  query: string;
  limit?: number;
  mode: "vector" | "hybrid";
}): Promise<AssetWithAi[]> {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);

  // If vectors are disabled/unavailable, fall back to FTS (preserve current behavior).
  if (!vectorEnabled()) {
    return searchAssets({ projectId: args.projectId, query: args.query, limit });
  }

  const vec = searchAssetsVector({ projectId: args.projectId, query: args.query, limit });
  if (args.mode === "vector") {
    return vec.length ? vec : searchAssets({ projectId: args.projectId, query: args.query, limit });
  }

  // hybrid: start with vector, then fill with FTS results
  const fts = searchAssets({ projectId: args.projectId, query: args.query, limit });
  const seen = new Set<string>();
  const merged: AssetWithAi[] = [];
  for (const a of vec) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    merged.push(a);
    if (merged.length >= limit) return merged;
  }
  for (const a of fts) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    merged.push(a);
    if (merged.length >= limit) return merged;
  }
  return merged;
}


