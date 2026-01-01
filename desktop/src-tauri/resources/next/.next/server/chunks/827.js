exports.id=827,exports.ids=[827],exports.modules={42911:(a,b,c)=>{"use strict";c.d(b,{L:()=>p});var d=c(73024),e=c.n(d),f=c(76760),g=c.n(f),h=c(87550),i=c.n(h);let j=`PRAGMA foreign_keys = ON;

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
`,k=`PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS project_view (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  world_x REAL NOT NULL DEFAULT 0,
  world_y REAL NOT NULL DEFAULT 0,
  zoom REAL NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`,l=`PRAGMA foreign_keys = ON;

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
`,m=`PRAGMA foreign_keys = ON;

-- Small key/value store for local app state (desktop + local-first web).
-- Used for "reopen last project" on launch.
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`,n=`PRAGMA foreign_keys = ON;

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
`,o=`PRAGMA foreign_keys = ON;

-- Track per-project revision counters so clients can detect stale writes (helps multi-device + iCloud scenarios).
CREATE TABLE IF NOT EXISTS project_sync (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  canvas_rev INTEGER NOT NULL DEFAULT 0,
  view_rev INTEGER NOT NULL DEFAULT 0,
  canvas_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  view_updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;function p(){if(!globalThis.__moondreamDb){let a,b=process.env.MOONDREAM_DB_PATH||((a=(process.env.MOONDREAM_DATA_DIR||"").trim())?g().resolve(a,"moondream.sqlite3"):g().resolve(process.cwd(),"..","data","moondream.sqlite3"));e().mkdirSync(g().dirname(b),{recursive:!0});let c=new(i())(b);c.pragma("journal_mode = WAL"),c.pragma("busy_timeout = 5000"),globalThis.__moondreamDb=c}var a=globalThis.__moondreamDb;a.pragma("foreign_keys = ON");let b=a.prepare("PRAGMA user_version").get(),c=b?.user_version??0;if(c<1){a.exec("BEGIN");try{a.exec(j),a.exec("PRAGMA user_version = 1"),a.exec("COMMIT")}catch(b){throw a.exec("ROLLBACK"),b}c=1}if(c<2){a.exec("BEGIN");try{a.exec(k),a.exec("PRAGMA user_version = 2"),a.exec("COMMIT")}catch(b){throw a.exec("ROLLBACK"),b}c=2}if(c<3){a.exec("BEGIN");try{a.exec(l),a.exec("PRAGMA user_version = 3"),a.exec("COMMIT")}catch(b){throw a.exec("ROLLBACK"),b}c=3}if(c<4){a.exec("BEGIN");try{a.exec(m),a.exec("PRAGMA user_version = 4"),a.exec("COMMIT")}catch(b){throw a.exec("ROLLBACK"),b}}if(c<5){a.exec("BEGIN");try{a.exec(n),a.exec("PRAGMA user_version = 5"),a.exec("COMMIT")}catch(b){throw a.exec("ROLLBACK"),b}}if(c<6){a.exec("BEGIN");try{a.exec(o),a.exec("PRAGMA user_version = 6"),a.exec("COMMIT")}catch(b){throw a.exec("ROLLBACK"),b}}return globalThis.__moondreamDb}},59598:(a,b,c)=>{"use strict";c.d(b,{GU:()=>i,J3:()=>h,gy:()=>g,sc:()=>f,sy:()=>k});var d=c(42911),e=c(31421);function f(a){let b=(0,d.L)(),c=(a.tags??[]).filter(Boolean).join(" "),e=b.prepare("DELETE FROM asset_search WHERE asset_id = ?"),f=b.prepare(`INSERT INTO asset_search (asset_id, project_id, original_name, caption, tags)
     VALUES (?, ?, ?, ?, ?)`);b.transaction(()=>{e.run(a.assetId),f.run(a.assetId,a.projectId,a.originalName,a.caption??"",c)})()}function g(a){(0,d.L)().prepare("DELETE FROM asset_search WHERE asset_id = ?").run(a)}function h(a){(0,d.L)().prepare("DELETE FROM asset_search WHERE project_id = ?").run(a)}function i(a){let b,c=(0,d.L)(),e=Math.min(Math.max(a.limit??50,1),200),f=0===(b=a.query.trim().split(/\s+/g).map(a=>a.replace(/["']/g,"").trim()).map(a=>a.replace(/[^a-zA-Z0-9_]+/g,"").trim()).filter(Boolean)).length?"":b.map(a=>`${a}*`).join(" ");return f?c.prepare(`SELECT
        a.*,
        ai.caption AS ai_caption,
        ai.tags_json AS ai_tags_json,
        ai.status AS ai_status,
        ai.model_version AS ai_model_version,
        ai.updated_at AS ai_updated_at
      FROM asset_search s
      JOIN assets a ON a.id = s.asset_id
      LEFT JOIN asset_ai ai ON ai.asset_id = a.id
      WHERE s.project_id = ? AND a.deleted_at IS NULL AND asset_search MATCH ?
      ORDER BY rank
      LIMIT ?`).all(a.projectId,f,e):c.prepare(`SELECT
          a.*,
          ai.caption AS ai_caption,
          ai.tags_json AS ai_tags_json,
          ai.status AS ai_status,
          ai.model_version AS ai_model_version,
          ai.updated_at AS ai_updated_at
        FROM assets a
        LEFT JOIN asset_ai ai ON ai.asset_id = a.id
        WHERE a.project_id = ? AND a.deleted_at IS NULL
        ORDER BY a.created_at DESC
        LIMIT ?`).all(a.projectId,e)}function j(){if(process.env.VERCEL)return!1;let a=(process.env.MOONDREAM_VECTOR_MODE||"off").toLowerCase();return"off"!==a&&"0"!==a&&"false"!==a}async function k(a){let b=Math.min(Math.max(a.limit??50,1),200);if(!j())return i({projectId:a.projectId,query:a.query,limit:b});let c=function(a){let b=a.query.trim();if(!b)return[];let c=function(a){if(!j())return null;let b=process.env.MOONDREAM_PYTHON||"python3",c=process.env.MOONDREAM_EMBEDDING_MODEL||"sentence-transformers/all-MiniLM-L6-v2",d=`
import json, os, sys
from sentence_transformers import SentenceTransformer
model = SentenceTransformer(os.environ.get("MOONDREAM_EMBEDDING_MODEL") or ${JSON.stringify(c)})
q = sys.stdin.read() or ""
vec = model.encode([q], normalize_embeddings=True)[0]
print(json.dumps({"model": os.environ.get("MOONDREAM_EMBEDDING_MODEL") or ${JSON.stringify(c)}, "dim": int(len(vec)), "vec": [float(x) for x in vec]}))
`.trim();try{let f=(0,e.execFileSync)(b,["-c",d],{input:a,env:{...process.env,MOONDREAM_EMBEDDING_MODEL:c},maxBuffer:0xa00000}).toString("utf8"),g=JSON.parse(f);if(!g?.vec?.length||!g?.dim)return null;return g}catch{return null}}(b);if(!c)return[];let f=(i=a.projectId,(0,d.L)().prepare(`SELECT e.asset_id AS asset_id, e.model AS model, e.dim AS dim, e.embedding AS embedding
       FROM asset_embeddings e
       JOIN assets a ON a.id = e.asset_id
       WHERE a.project_id = ? AND a.deleted_at IS NULL AND e.embedding IS NOT NULL`).all(i)).filter(a=>a.model===c.model);if(!f.length)return[];let g=new Float32Array(c.vec),h=[];for(let a of f){let b=a.embedding,c=new Float32Array(b.buffer,b.byteOffset,Math.floor(b.byteLength/4));c.length===g.length&&h.push({assetId:a.asset_id,score:function(a,b){let c=Math.min(a.length,b.length),d=0;for(let e=0;e<c;e++)d+=a[e]*b[e];return d}(g,c)})}h.sort((a,b)=>b.score-a.score);var i,k=h.slice(0,a.limit).map(a=>a.assetId);if(!k.length)return[];let l=(0,d.L)(),m=k.map(()=>"?").join(", "),n=k.map(()=>"WHEN ? THEN ?").join(" ");return l.prepare(`SELECT
        a.*,
        ai.caption AS ai_caption,
        ai.tags_json AS ai_tags_json,
        ai.status AS ai_status,
        ai.model_version AS ai_model_version,
        ai.updated_at AS ai_updated_at
      FROM assets a
      LEFT JOIN asset_ai ai ON ai.asset_id = a.id
      WHERE a.deleted_at IS NULL AND a.id IN (${m})
      ORDER BY CASE a.id ${n} ELSE 999999 END`).all(...k,...k.flatMap((a,b)=>[a,b]))}({projectId:a.projectId,query:a.query,limit:b});if("vector"===a.mode)return c.length?c:i({projectId:a.projectId,query:a.query,limit:b});let f=i({projectId:a.projectId,query:a.query,limit:b}),g=new Set,h=[];for(let a of c)if(!g.has(a.id)&&(g.add(a.id),h.push(a),h.length>=b))return h;for(let a of f)if(!g.has(a.id)&&(g.add(a.id),h.push(a),h.length>=b))break;return h}},78335:()=>{},84623:(a,b,c)=>{"use strict";c.d(b,{VX:()=>l,fr:()=>h,jm:()=>j,km:()=>i,p_:()=>g,qs:()=>f,th:()=>k});var d=c(42911),e=c(59598);function f(a){let b=(0,d.L)(),c=Math.min(Math.max(a.limit??50,1),200),e=Math.max(a.offset??0,0);return b.prepare(`SELECT
        a.*,
        ai.caption AS ai_caption,
        ai.tags_json AS ai_tags_json,
        ai.status AS ai_status,
        ai.model_version AS ai_model_version,
        ai.updated_at AS ai_updated_at
      FROM assets a
      LEFT JOIN asset_ai ai ON ai.asset_id = a.id
      WHERE a.project_id = ? AND a.deleted_at IS NULL
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?`).all(a.projectId,c,e)}function g(a){return(0,d.L)().prepare(`SELECT
          a.*,
          ai.caption AS ai_caption,
          ai.tags_json AS ai_tags_json,
          ai.status AS ai_status,
          ai.model_version AS ai_model_version,
          ai.updated_at AS ai_updated_at
        FROM assets a
        LEFT JOIN asset_ai ai ON ai.asset_id = a.id
        WHERE a.id = ? AND a.deleted_at IS NULL`).get(a)??null}function h(a){return(0,d.L)().prepare(`SELECT
          a.*,
          ai.caption AS ai_caption,
          ai.tags_json AS ai_tags_json,
          ai.status AS ai_status,
          ai.model_version AS ai_model_version,
          ai.updated_at AS ai_updated_at
        FROM assets a
        LEFT JOIN asset_ai ai ON ai.asset_id = a.id
        WHERE a.id = ?`).get(a)??null}function i(a){let b=(0,d.L)().prepare("SELECT COUNT(1) AS c FROM canvas_objects WHERE asset_id = ?").get(a);return b?.c??0}function j(a){let b=(0,d.L)(),c=b.prepare("UPDATE assets SET deleted_at = ?, trashed_storage_path = ?, trashed_thumb_path = ? WHERE id = ? AND deleted_at IS NULL");return b.transaction(()=>{(0,e.gy)(a.assetId);let b=c.run(a.deletedAt,a.trashedStoragePath,a.trashedThumbPath,a.assetId);return(b?.changes??0)>0})()}function k(a){let b=(0,d.L)(),c=b.prepare("UPDATE assets SET deleted_at = NULL, trashed_storage_path = NULL, trashed_thumb_path = NULL WHERE id = ? AND deleted_at IS NOT NULL");return b.transaction(()=>{let b=c.run(a);return(b?.changes??0)>0})()}function l(a){let b=h(a);if(!b)return;let c=[];try{c=b.ai_tags_json?JSON.parse(b.ai_tags_json):[]}catch{c=[]}(0,e.sc)({projectId:b.project_id,assetId:b.id,originalName:b.original_name,caption:b.ai_caption,tags:c})}},96487:()=>{}};