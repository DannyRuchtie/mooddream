(()=>{var a={};a.id=650,a.ids=[650],a.modules={261:a=>{"use strict";a.exports=require("next/dist/shared/lib/router/utils/app-paths")},10846:a=>{"use strict";a.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},29294:a=>{"use strict";a.exports=require("next/dist/server/app-render/work-async-storage.external.js")},42911:(a,b,c)=>{"use strict";c.d(b,{L:()=>p});var d=c(73024),e=c.n(d),f=c(76760),g=c.n(f),h=c(87550),i=c.n(h);let j=`PRAGMA foreign_keys = ON;

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
`;function p(){if(!globalThis.__moondreamDb){let a,b=process.env.MOONDREAM_DB_PATH||((a=(process.env.MOONDREAM_DATA_DIR||"").trim())?g().resolve(a,"moondream.sqlite3"):g().resolve(process.cwd(),"..","data","moondream.sqlite3"));e().mkdirSync(g().dirname(b),{recursive:!0});let c=new(i())(b);c.pragma("journal_mode = WAL"),c.pragma("busy_timeout = 5000"),globalThis.__moondreamDb=c}var a=globalThis.__moondreamDb;a.pragma("foreign_keys = ON");let b=a.prepare("PRAGMA user_version").get(),c=b?.user_version??0;if(c<1){a.exec("BEGIN");try{a.exec(j),a.exec("PRAGMA user_version = 1"),a.exec("COMMIT")}catch(b){throw a.exec("ROLLBACK"),b}c=1}if(c<2){a.exec("BEGIN");try{a.exec(k),a.exec("PRAGMA user_version = 2"),a.exec("COMMIT")}catch(b){throw a.exec("ROLLBACK"),b}c=2}if(c<3){a.exec("BEGIN");try{a.exec(l),a.exec("PRAGMA user_version = 3"),a.exec("COMMIT")}catch(b){throw a.exec("ROLLBACK"),b}c=3}if(c<4){a.exec("BEGIN");try{a.exec(m),a.exec("PRAGMA user_version = 4"),a.exec("COMMIT")}catch(b){throw a.exec("ROLLBACK"),b}}if(c<5){a.exec("BEGIN");try{a.exec(n),a.exec("PRAGMA user_version = 5"),a.exec("COMMIT")}catch(b){throw a.exec("ROLLBACK"),b}}if(c<6){a.exec("BEGIN");try{a.exec(o),a.exec("PRAGMA user_version = 6"),a.exec("COMMIT")}catch(b){throw a.exec("ROLLBACK"),b}}return globalThis.__moondreamDb}},44870:a=>{"use strict";a.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},63033:a=>{"use strict";a.exports=require("next/dist/server/app-render/work-unit-async-storage.external.js")},71996:(a,b,c)=>{"use strict";c.r(b),c.d(b,{handler:()=>J,patchFetch:()=>I,routeModule:()=>E,serverHooks:()=>H,workAsyncStorage:()=>F,workUnitAsyncStorage:()=>G});var d={};c.r(d),c.d(d,{GET:()=>D,dynamic:()=>C,runtime:()=>B});var e=c(19225),f=c(84006),g=c(8317),h=c(99373),i=c(34775),j=c(24235),k=c(261),l=c(54365),m=c(90771),n=c(73461),o=c(67798),p=c(92280),q=c(62018),r=c(45696),s=c(47929),t=c(86439),u=c(37527),v=c(73024),w=c.n(v),x=c(76760),y=c.n(x),z=c(74946),A=c(42911);let B="nodejs",C="force-dynamic";async function D(){let a=(0,A.L)().prepare(`SELECT status, COUNT(*) as count
       FROM asset_ai
       GROUP BY status`).all(),b={pending:0,processing:0,done:0,failed:0,total:0};for(let c of a){let a=(c.status||"").toLowerCase(),d=Number(c.count||0);"pending"===a?b.pending+=d:"processing"===a?b.processing+=d:"done"===a?b.done+=d:"failed"===a&&(b.failed+=d),b.total+=d}let c=(0,z.CR)(),d=y().join(c,"logs","moondream-worker.log"),e=!1,f=null,g=[],h=null,i=null;try{if(w().existsSync(d)){e=!0;let a=w().statSync(d);f=new Date(a.mtimeMs).toISOString(),g=function(a,b){let c=Math.max(1024,b?.maxBytes??65536),d=Math.max(1,b?.maxLines??50),e=w().statSync(a).size,f=Math.max(0,e-c),g=e-f,h=w().openSync(a,"r");try{let a=Buffer.alloc(g);return w().readSync(h,a,0,g,f),a.toString("utf8").split(/\r?\n/g).filter(Boolean).slice(-d)}finally{try{w().closeSync(h)}catch{}}}(d,{maxBytes:98304,maxLines:40});let b=function(a){for(let b=a.length-1;b>=0;b--){let c=(a[b]||"").match(/^\[worker\]\s+processing\s+asset=([^\s]+)\s+file=(.+)$/);if(c)return{assetId:c[1]??null,file:(c[2]??"").trim()||null}}return{assetId:null,file:null}}(g);h=b.assetId,i=b.file}}catch{}return Response.json({counts:b,worker:{logAvailable:e,lastLogAt:f,currentAssetId:h,currentFile:i,recentLines:g}})}let E=new e.AppRouteRouteModule({definition:{kind:f.RouteKind.APP_ROUTE,page:"/api/ai/progress/route",pathname:"/api/ai/progress",filename:"route",bundlePath:"app/api/ai/progress/route"},distDir:".next",relativeProjectDir:"",resolvedPagePath:"/Users/dannyruchtie/Documents/moondream/web/src/app/api/ai/progress/route.ts",nextConfigOutput:"standalone",userland:d}),{workAsyncStorage:F,workUnitAsyncStorage:G,serverHooks:H}=E;function I(){return(0,g.patchFetch)({workAsyncStorage:F,workUnitAsyncStorage:G})}async function J(a,b,c){E.isDev&&(0,h.addRequestMeta)(a,"devRequestTimingInternalsEnd",process.hrtime.bigint());let d="/api/ai/progress/route";"/index"===d&&(d="/");let e=await E.prepare(a,b,{srcPage:d,multiZoneDraftMode:!1});if(!e)return b.statusCode=400,b.end("Bad Request"),null==c.waitUntil||c.waitUntil.call(c,Promise.resolve()),null;let{buildId:g,params:v,nextConfig:w,parsedUrl:x,isDraftMode:y,prerenderManifest:z,routerServerContext:A,isOnDemandRevalidate:B,revalidateOnlyGenerated:C,resolvedPathname:D,clientReferenceManifest:F,serverActionsManifest:G}=e,H=(0,k.normalizeAppPath)(d),I=!!(z.dynamicRoutes[H]||z.routes[D]),J=async()=>((null==A?void 0:A.render404)?await A.render404(a,b,x,!1):b.end("This page could not be found"),null);if(I&&!y){let a=!!z.routes[D],b=z.dynamicRoutes[H];if(b&&!1===b.fallback&&!a){if(w.experimental.adapterPath)return await J();throw new t.NoFallbackError}}let K=null;!I||E.isDev||y||(K="/index"===(K=D)?"/":K);let L=!0===E.isDev||!I,M=I&&!L;G&&F&&(0,j.setManifestsSingleton)({page:d,clientReferenceManifest:F,serverActionsManifest:G});let N=a.method||"GET",O=(0,i.getTracer)(),P=O.getActiveScopeSpan(),Q={params:v,prerenderManifest:z,renderOpts:{experimental:{authInterrupts:!!w.experimental.authInterrupts},cacheComponents:!!w.cacheComponents,supportsDynamicResponse:L,incrementalCache:(0,h.getRequestMeta)(a,"incrementalCache"),cacheLifeProfiles:w.cacheLife,waitUntil:c.waitUntil,onClose:a=>{b.on("close",a)},onAfterTaskError:void 0,onInstrumentationRequestError:(b,c,d,e)=>E.onRequestError(a,b,d,e,A)},sharedContext:{buildId:g}},R=new l.NodeNextRequest(a),S=new l.NodeNextResponse(b),T=m.NextRequestAdapter.fromNodeNextRequest(R,(0,m.signalFromNodeResponse)(b));try{let e=async a=>E.handle(T,Q).finally(()=>{if(!a)return;a.setAttributes({"http.status_code":b.statusCode,"next.rsc":!1});let c=O.getRootSpanAttributes();if(!c)return;if(c.get("next.span_type")!==n.BaseServerSpan.handleRequest)return void console.warn(`Unexpected root span type '${c.get("next.span_type")}'. Please report this Next.js issue https://github.com/vercel/next.js`);let e=c.get("next.route");if(e){let b=`${N} ${e}`;a.setAttributes({"next.route":e,"http.route":e,"next.span_name":b}),a.updateName(b)}else a.updateName(`${N} ${d}`)}),g=!!(0,h.getRequestMeta)(a,"minimalMode"),j=async h=>{var i,j;let k=async({previousCacheEntry:f})=>{try{if(!g&&B&&C&&!f)return b.statusCode=404,b.setHeader("x-nextjs-cache","REVALIDATED"),b.end("This page could not be found"),null;let d=await e(h);a.fetchMetrics=Q.renderOpts.fetchMetrics;let i=Q.renderOpts.pendingWaitUntil;i&&c.waitUntil&&(c.waitUntil(i),i=void 0);let j=Q.renderOpts.collectedTags;if(!I)return await (0,p.I)(R,S,d,Q.renderOpts.pendingWaitUntil),null;{let a=await d.blob(),b=(0,q.toNodeOutgoingHttpHeaders)(d.headers);j&&(b[s.NEXT_CACHE_TAGS_HEADER]=j),!b["content-type"]&&a.type&&(b["content-type"]=a.type);let c=void 0!==Q.renderOpts.collectedRevalidate&&!(Q.renderOpts.collectedRevalidate>=s.INFINITE_CACHE)&&Q.renderOpts.collectedRevalidate,e=void 0===Q.renderOpts.collectedExpire||Q.renderOpts.collectedExpire>=s.INFINITE_CACHE?void 0:Q.renderOpts.collectedExpire;return{value:{kind:u.CachedRouteKind.APP_ROUTE,status:d.status,body:Buffer.from(await a.arrayBuffer()),headers:b},cacheControl:{revalidate:c,expire:e}}}}catch(b){throw(null==f?void 0:f.isStale)&&await E.onRequestError(a,b,{routerKind:"App Router",routePath:d,routeType:"route",revalidateReason:(0,o.c)({isStaticGeneration:M,isOnDemandRevalidate:B})},!1,A),b}},l=await E.handleResponse({req:a,nextConfig:w,cacheKey:K,routeKind:f.RouteKind.APP_ROUTE,isFallback:!1,prerenderManifest:z,isRoutePPREnabled:!1,isOnDemandRevalidate:B,revalidateOnlyGenerated:C,responseGenerator:k,waitUntil:c.waitUntil,isMinimalMode:g});if(!I)return null;if((null==l||null==(i=l.value)?void 0:i.kind)!==u.CachedRouteKind.APP_ROUTE)throw Object.defineProperty(Error(`Invariant: app-route received invalid cache entry ${null==l||null==(j=l.value)?void 0:j.kind}`),"__NEXT_ERROR_CODE",{value:"E701",enumerable:!1,configurable:!0});g||b.setHeader("x-nextjs-cache",B?"REVALIDATED":l.isMiss?"MISS":l.isStale?"STALE":"HIT"),y&&b.setHeader("Cache-Control","private, no-cache, no-store, max-age=0, must-revalidate");let m=(0,q.fromNodeOutgoingHttpHeaders)(l.value.headers);return g&&I||m.delete(s.NEXT_CACHE_TAGS_HEADER),!l.cacheControl||b.getHeader("Cache-Control")||m.get("Cache-Control")||m.set("Cache-Control",(0,r.getCacheControlHeader)(l.cacheControl)),await (0,p.I)(R,S,new Response(l.value.body,{headers:m,status:l.value.status||200})),null};P?await j(P):await O.withPropagatedContext(a.headers,()=>O.trace(n.BaseServerSpan.handleRequest,{spanName:`${N} ${d}`,kind:i.SpanKind.SERVER,attributes:{"http.method":N,"http.target":a.url}},j))}catch(b){if(b instanceof t.NoFallbackError||await E.onRequestError(a,b,{routerKind:"App Router",routePath:H,routeType:"route",revalidateReason:(0,o.c)({isStaticGeneration:M,isOnDemandRevalidate:B})},!1,A),I)throw b;return await (0,p.I)(R,S,new Response(null,{status:500})),null}}},73024:a=>{"use strict";a.exports=require("node:fs")},74946:(a,b,c)=>{"use strict";c.d(b,{_B:()=>n,CR:()=>o,X9:()=>q,KS:()=>r,bR:()=>s,wi:()=>t});var d=c(73024),e=c.n(d);let f=require("node:os");var g=c.n(f),h=c(76760),i=c.n(h),j=c(434),k=c(86239);let l=j.k5n(["local","icloud"]),m=j.k5n(["local_station","huggingface"]),n=j.Ikc({storage:j.Ikc({mode:l.default("local"),icloudPath:j.YjP().min(1).optional(),migration:j.Ikc({from:j.YjP().min(1),to:j.YjP().min(1),requestedAt:j.YjP().min(1)}).optional()}).default({mode:"local"}),ai:j.Ikc({provider:m.default("local_station"),endpoint:j.YjP().min(1).optional(),hfToken:j.YjP().optional().nullable()}).default({provider:"local_station"})});function o(){let a=(process.env.MOONDREAM_APP_CONFIG_DIR||"").trim();return a?i().resolve(a):(0,k.u)()}function p(){let a=(process.env.MOONDREAM_SETTINGS_PATH||"").trim();return a?i().resolve(a):i().join(o(),"settings.json")}function q(){let a=process.env.HOME||g().homedir()||"";if(!a)return null;let b=i().join(a,"Library","Mobile Documents","com~apple~CloudDocs"),c=i().join(b,"Reference"),d=i().join(b,"Moondream");return e().existsSync(d)&&!e().existsSync(c)?d:c}function r(){return i().join(o(),"data")}function s(){let a=p();try{let b=e().readFileSync(a,"utf8"),c=n.safeParse(JSON.parse(b));if(c.success)return c.data}catch{}return n.parse({})}function t(a){let b=o();e().mkdirSync(b,{recursive:!0});let c=p();e().writeFileSync(c,JSON.stringify(a,null,2),"utf8")}},76760:a=>{"use strict";a.exports=require("node:path")},78335:()=>{},86239:(a,b,c)=>{"use strict";c.d(b,{LX:()=>m,Ns:()=>l,i8:()=>k,qk:()=>j,sB:()=>i,tY:()=>g,u:()=>f});var d=c(76760),e=c.n(d);function f(){let a=(process.env.MOONDREAM_DATA_DIR||"").trim();return a?e().resolve(a):e().resolve(process.cwd(),"..","data")}function g(a){return e().join(f(),"projects",a)}function h(a){return e().join(g(a),"trash")}function i(a){return e().join(h(a),"assets")}function j(a){return e().join(h(a),"thumbs")}function k(a){return e().join(g(a),"preview.webp")}function l(a,b){return e().join(e().join(g(a),"assets"),b)}function m(a,b){return e().join(e().join(g(a),"thumbs"),b)}},86439:a=>{"use strict";a.exports=require("next/dist/shared/lib/no-fallback-error.external")},87550:a=>{"use strict";a.exports=require("better-sqlite3")},96487:()=>{}};var b=require("../../../../webpack-runtime.js");b.C(a);var c=b.X(0,[741,877],()=>b(b.s=71996));module.exports=c})();