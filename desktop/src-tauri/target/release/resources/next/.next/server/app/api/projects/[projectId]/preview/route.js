(()=>{var a={};a.id=62,a.ids=[62],a.modules={261:a=>{"use strict";a.exports=require("next/dist/shared/lib/router/utils/app-paths")},10846:a=>{"use strict";a.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},19225:(a,b,c)=>{"use strict";a.exports=c(44870)},21613:(a,b,c)=>{"use strict";c.r(b),c.d(b,{handler:()=>G,patchFetch:()=>F,routeModule:()=>B,serverHooks:()=>E,workAsyncStorage:()=>C,workUnitAsyncStorage:()=>D});var d={};c.r(d),c.d(d,{PUT:()=>A,runtime:()=>z});var e=c(19225),f=c(84006),g=c(8317),h=c(99373),i=c(34775),j=c(24235),k=c(261),l=c(54365),m=c(90771),n=c(73461),o=c(67798),p=c(92280),q=c(62018),r=c(45696),s=c(47929),t=c(86439),u=c(37527),v=c(73024),w=c.n(v),x=c(92233),y=c(86239);let z="nodejs";async function A(a,b){let{projectId:c}=await b.params;if(!(0,x.U1)(c))return Response.json({error:"Not found"},{status:404});if(!(a.headers.get("content-type")||"").startsWith("image/"))return Response.json({error:"Expected image/* body"},{status:400});let d=Buffer.from(await a.arrayBuffer());return d.byteLength>3e6?Response.json({error:"Preview too large"},{status:413}):(w().mkdirSync((0,y.tY)(c),{recursive:!0}),w().writeFileSync((0,y.i8)(c),d),Response.json({ok:!0}))}let B=new e.AppRouteRouteModule({definition:{kind:f.RouteKind.APP_ROUTE,page:"/api/projects/[projectId]/preview/route",pathname:"/api/projects/[projectId]/preview",filename:"route",bundlePath:"app/api/projects/[projectId]/preview/route"},distDir:".next",relativeProjectDir:"",resolvedPagePath:"/Users/dannyruchtie/Documents/moondream/web/src/app/api/projects/[projectId]/preview/route.ts",nextConfigOutput:"standalone",userland:d}),{workAsyncStorage:C,workUnitAsyncStorage:D,serverHooks:E}=B;function F(){return(0,g.patchFetch)({workAsyncStorage:C,workUnitAsyncStorage:D})}async function G(a,b,c){B.isDev&&(0,h.addRequestMeta)(a,"devRequestTimingInternalsEnd",process.hrtime.bigint());let d="/api/projects/[projectId]/preview/route";"/index"===d&&(d="/");let e=await B.prepare(a,b,{srcPage:d,multiZoneDraftMode:!1});if(!e)return b.statusCode=400,b.end("Bad Request"),null==c.waitUntil||c.waitUntil.call(c,Promise.resolve()),null;let{buildId:g,params:v,nextConfig:w,parsedUrl:x,isDraftMode:y,prerenderManifest:z,routerServerContext:A,isOnDemandRevalidate:C,revalidateOnlyGenerated:D,resolvedPathname:E,clientReferenceManifest:F,serverActionsManifest:G}=e,H=(0,k.normalizeAppPath)(d),I=!!(z.dynamicRoutes[H]||z.routes[E]),J=async()=>((null==A?void 0:A.render404)?await A.render404(a,b,x,!1):b.end("This page could not be found"),null);if(I&&!y){let a=!!z.routes[E],b=z.dynamicRoutes[H];if(b&&!1===b.fallback&&!a){if(w.experimental.adapterPath)return await J();throw new t.NoFallbackError}}let K=null;!I||B.isDev||y||(K="/index"===(K=E)?"/":K);let L=!0===B.isDev||!I,M=I&&!L;G&&F&&(0,j.setManifestsSingleton)({page:d,clientReferenceManifest:F,serverActionsManifest:G});let N=a.method||"GET",O=(0,i.getTracer)(),P=O.getActiveScopeSpan(),Q={params:v,prerenderManifest:z,renderOpts:{experimental:{authInterrupts:!!w.experimental.authInterrupts},cacheComponents:!!w.cacheComponents,supportsDynamicResponse:L,incrementalCache:(0,h.getRequestMeta)(a,"incrementalCache"),cacheLifeProfiles:w.cacheLife,waitUntil:c.waitUntil,onClose:a=>{b.on("close",a)},onAfterTaskError:void 0,onInstrumentationRequestError:(b,c,d,e)=>B.onRequestError(a,b,d,e,A)},sharedContext:{buildId:g}},R=new l.NodeNextRequest(a),S=new l.NodeNextResponse(b),T=m.NextRequestAdapter.fromNodeNextRequest(R,(0,m.signalFromNodeResponse)(b));try{let e=async a=>B.handle(T,Q).finally(()=>{if(!a)return;a.setAttributes({"http.status_code":b.statusCode,"next.rsc":!1});let c=O.getRootSpanAttributes();if(!c)return;if(c.get("next.span_type")!==n.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${c.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let e=c.get("next.route");if(e){let b=`${N} ${e}`;a.setAttributes({"next.route":e,"http.route":e,"next.span_name":b}),a.updateName(b)}else a.updateName(`${N} ${d}`)}),g=!!(0,h.getRequestMeta)(a,"minimalMode"),j=async h=>{var i,j;let k=async({previousCacheEntry:f})=>{try{if(!g&&C&&D&&!f)return b.statusCode=404,b.setHeader("x-nextjs-cache","REVALIDATED"),b.end("This page could not be found"),null;let d=await e(h);a.fetchMetrics=Q.renderOpts.fetchMetrics;let i=Q.renderOpts.pendingWaitUntil;i&&c.waitUntil&&(c.waitUntil(i),i=void 0);let j=Q.renderOpts.collectedTags;if(!I)return await (0,p.I)(R,S,d,Q.renderOpts.pendingWaitUntil),null;{let a=await d.blob(),b=(0,q.toNodeOutgoingHttpHeaders)(d.headers);j&&(b[s.NEXT_CACHE_TAGS_HEADER]=j),!b["content-type"]&&a.type&&(b["content-type"]=a.type);let c=void 0!==Q.renderOpts.collectedRevalidate&&!(Q.renderOpts.collectedRevalidate>=s.INFINITE_CACHE)&&Q.renderOpts.collectedRevalidate,e=void 0===Q.renderOpts.collectedExpire||Q.renderOpts.collectedExpire>=s.INFINITE_CACHE?void 0:Q.renderOpts.collectedExpire;return{value:{kind:u.CachedRouteKind.APP_ROUTE,status:d.status,body:Buffer.from(await a.arrayBuffer()),headers:b},cacheControl:{revalidate:c,expire:e}}}}catch(b){throw(null==f?void 0:f.isStale)&&await B.onRequestError(a,b,{routerKind:"App Router",routePath:d,routeType:"route",revalidateReason:(0,o.c)({isStaticGeneration:M,isOnDemandRevalidate:C})},!1,A),b}},l=await B.handleResponse({req:a,nextConfig:w,cacheKey:K,routeKind:f.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:z,isRoutePPREnabled:!1,isOnDemandRevalidate:C,revalidateOnlyGenerated:D,responseGenerator:k,waitUntil:c.waitUntil,isMinimalMode:g});if(!I)return null;if((null==l||null==(i=l.value)?void 0:i.kind)!==u.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==l||null==(j=l.value)?void 0:j.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});g||b.setHeader("x-nextjs-cache",C?"REVALIDATED":l.isMiss?"MISS":l.isStale?"STALE":"HIT"),y&&b.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let m=(0,q.fromNodeOutgoingHttpHeaders)(l.value.headers);return g&&I||m.delete(s.NEXT_CACHE_TAGS_HEADER),!l.cacheControl||b.getHeader("Cache-Control")||m.get("Cache-Control")||m.set("Cache-Control",(0,r.getCacheControlHeader)(l.cacheControl)),await (0,p.I)(R,S,new Response(l.value.body,{headers:m,status:l.value.status||200})),null};P?await j(P):await O.withPropagatedContext(a.headers,()=>O.trace(n.BaseServerSpan.handleRequest,{spanName:`${N} ${d}`,kind:i.SpanKind.SERVER,attributes:{"http.method":N,"http.target":a.url}},j))}catch(b){if(b instanceof t.NoFallbackError||await B.onRequestError(a,b,{routerKind:"App Router",routePath:H,routeType:"route",revalidateReason:(0,o.c)({isStaticGeneration:M,isOnDemandRevalidate:C})},!1,A),I)throw b;return await (0,p.I)(R,S,new Response(null,{status:500})),null}}},29294:a=>{"use strict";a.exports=require("next/dist/server/app-render/work-async-storage.external.js")},31421:a=>{"use strict";a.exports=require("node:child_process")},42911:(a,b,c)=>{"use strict";c.d(b,{L:()=>p});var d=c(73024),e=c.n(d),f=c(76760),g=c.n(f),h=c(87550),i=c.n(h);let j=`PRAGMA foreign_keys = ON;

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
`;function p(){if(!globalThis.__moondreamDb){let a,b=process.env.MOONDREAM_DB_PATH||((a=(process.env.MOONDREAM_DATA_DIR||"").trim())?g().resolve(a,"moondream.sqlite3"):g().resolve(process.cwd(),"..","data","moondream.sqlite3"));e().mkdirSync(g().dirname(b),{recursive:!0});let c=new(i())(b);c.pragma("journal_mode = WAL"),c.pragma("busy_timeout = 5000"),globalThis.__moondreamDb=c}var a=globalThis.__moondreamDb;a.pragma("foreign_keys = ON");let b=a.prepare("PRAGMA user_version").get(),c=b?.user_version??0;if(c<1){a.exec("BEGIN");try{a.exec(j),a.exec("PRAGMA user_version = 1"),a.exec("COMMIT")}catch(b){throw a.exec("ROLLBACK"),b}c=1}if(c<2){a.exec("BEGIN");try{a.exec(k),a.exec("PRAGMA user_version = 2"),a.exec("COMMIT")}catch(b){throw a.exec("ROLLBACK"),b}c=2}if(c<3){a.exec("BEGIN");try{a.exec(l),a.exec("PRAGMA user_version = 3"),a.exec("COMMIT")}catch(b){throw a.exec("ROLLBACK"),b}c=3}if(c<4){a.exec("BEGIN");try{a.exec(m),a.exec("PRAGMA user_version = 4"),a.exec("COMMIT")}catch(b){throw a.exec("ROLLBACK"),b}}if(c<5){a.exec("BEGIN");try{a.exec(n),a.exec("PRAGMA user_version = 5"),a.exec("COMMIT")}catch(b){throw a.exec("ROLLBACK"),b}}if(c<6){a.exec("BEGIN");try{a.exec(o),a.exec("PRAGMA user_version = 6"),a.exec("COMMIT")}catch(b){throw a.exec("ROLLBACK"),b}}return globalThis.__moondreamDb}},44870:a=>{"use strict";a.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},59598:(a,b,c)=>{"use strict";c.d(b,{GU:()=>i,J3:()=>h,gy:()=>g,sc:()=>f,sy:()=>k});var d=c(42911),e=c(31421);function f(a){let b=(0,d.L)(),c=(a.tags??[]).filter(Boolean).join(" "),e=b.prepare("DELETE FROM asset_search WHERE asset_id = ?"),f=b.prepare(`INSERT INTO asset_search (asset_id, project_id, original_name, caption, tags)
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
      ORDER BY CASE a.id ${n} ELSE 999999 END`).all(...k,...k.flatMap((a,b)=>[a,b]))}({projectId:a.projectId,query:a.query,limit:b});if("vector"===a.mode)return c.length?c:i({projectId:a.projectId,query:a.query,limit:b});let f=i({projectId:a.projectId,query:a.query,limit:b}),g=new Set,h=[];for(let a of c)if(!g.has(a.id)&&(g.add(a.id),h.push(a),h.length>=b))return h;for(let a of f)if(!g.has(a.id)&&(g.add(a.id),h.push(a),h.length>=b))break;return h}},63033:a=>{"use strict";a.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},73024:a=>{"use strict";a.exports=require("node:fs")},76760:a=>{"use strict";a.exports=require("node:path")},78335:()=>{},86239:(a,b,c)=>{"use strict";c.d(b,{LX:()=>m,Ns:()=>l,i8:()=>k,qk:()=>j,sB:()=>i,tY:()=>g,u:()=>f});var d=c(76760),e=c.n(d);function f(){let a=(process.env.MOONDREAM_DATA_DIR||"").trim();return a?e().resolve(a):e().resolve(process.cwd(),"..","data")}function g(a){return e().join(f(),"projects",a)}function h(a){return e().join(g(a),"trash")}function i(a){return e().join(h(a),"assets")}function j(a){return e().join(h(a),"thumbs")}function k(a){return e().join(g(a),"preview.webp")}function l(a,b){return e().join(e().join(g(a),"assets"),b)}function m(a,b){return e().join(e().join(g(a),"thumbs"),b)}},86439:a=>{"use strict";a.exports=require("next/dist/shared/lib/no-fallback-error.external")},87550:a=>{"use strict";a.exports=require("better-sqlite3")},92233:(a,b,c)=>{"use strict";c.d(b,{gA:()=>h,xx:()=>l,U1:()=>i,hF:()=>j,oB:()=>k});let d=require("node:crypto");var e=c.n(d),f=c(42911),g=c(59598);function h(a){let b=(0,f.L)(),c=e().randomUUID(),d=new Date().toISOString();return b.prepare(`INSERT INTO projects (id, name, created_at, updated_at)
     VALUES (?, ?, ?, ?)`).run(c,a,d,d),i(c)}function i(a){return(0,f.L)().prepare("SELECT * FROM projects WHERE id = ?").get(a)??null}function j(){return(0,f.L)().prepare("SELECT * FROM projects ORDER BY updated_at DESC, created_at DESC").all()}function k(a,b){let c=(0,f.L)(),d=new Date().toISOString();return 0===c.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?").run(b,d,a).changes?null:i(a)}function l(a){let b=(0,f.L)();return b.transaction(()=>((0,g.J3)(a),b.prepare("DELETE FROM projects WHERE id = ?").run(a).changes>0))()}},92280:(a,b,c)=>{"use strict";Object.defineProperty(b,"I",{enumerable:!0,get:function(){return g}});let d=c(28208),e=c(47617),f=c(62018);async function g(a,b,c,g){if((0,d.isNodeNextResponse)(b)){var h;b.statusCode=c.status,b.statusMessage=c.statusText;let d=["set-cookie","www-authenticate","proxy-authenticate","vary"];null==(h=c.headers)||h.forEach((a,c)=>{if("x-middleware-set-cookie"!==c.toLowerCase())if("set-cookie"===c.toLowerCase())for(let d of(0,f.splitCookiesString)(a))b.appendHeader(c,d);else{let e=void 0!==b.getHeader(c);(d.includes(c.toLowerCase())||!e)&&b.appendHeader(c,a)}});let{originalResponse:i}=b;c.body&&"HEAD"!==a.method?await (0,e.pipeToNodeResponse)(c.body,i,g):i.end()}}},96487:()=>{}};var b=require("../../../../../webpack-runtime.js");b.C(a);var c=b.X(0,[741],()=>b(b.s=21613));module.exports=c})();