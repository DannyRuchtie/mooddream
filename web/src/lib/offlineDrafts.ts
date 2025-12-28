import type { CanvasObjectRow } from "@/server/db/types";

export type ProjectDraft = {
  projectId: string;
  updatedAt: number; // epoch ms
  canvas: CanvasObjectRow[] | null;
  view: { world_x: number; world_y: number; zoom: number } | null;
  dirtyCanvas: boolean;
  dirtyView: boolean;
  // Last server revisions we've successfully synced against.
  serverCanvasRev?: number;
  serverViewRev?: number;
};

const DB_NAME = "moondream";
const DB_VERSION = 1;
const STORE = "projectDrafts";

const memCache = new Map<string, ProjectDraft>();
const idbHydrated = new Set<string>();

let dbPromise: Promise<IDBDatabase> | null = null;
function getDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "projectId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      const err = req.error ?? new Error("indexedDB.open failed");
      dbPromise = null;
      reject(err);
    };
  });
  return dbPromise;
}

function txDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IDB transaction aborted"));
  });
}

export async function getProjectDraft(projectId: string): Promise<ProjectDraft | null> {
  const cached = memCache.get(projectId) ?? null;
  if (idbHydrated.has(projectId)) return cached;

  // Hydrate from IndexedDB once per projectId, then rely on the in-memory cache for speed.
  // If the user starts interacting before hydration finishes, we merge: in-memory fields
  // (canvas/view when non-null) win, but we avoid dropping persisted canvas/view data.
  const db = await getDb();
  const tx = db.transaction(STORE, "readonly");
  const store = tx.objectStore(STORE);
  const req = store.get(projectId);
  const fromIdb = await new Promise<ProjectDraft | null>((resolve, reject) => {
    req.onsuccess = () => resolve((req.result as ProjectDraft | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("IDB get failed"));
  });
  await txDone(tx);
  idbHydrated.add(projectId);

  if (!fromIdb) return cached;
  if (!cached) {
    memCache.set(projectId, fromIdb);
    return fromIdb;
  }

  const merged = mergeDrafts(fromIdb, cached);
  memCache.set(projectId, merged);
  return merged;
}

export async function upsertProjectDraft(next: ProjectDraft): Promise<void> {
  memCache.set(next.projectId, next);
  const db = await getDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(next);
  await txDone(tx);
}

function defaultDraft(projectId: string): ProjectDraft {
  return {
    projectId,
    updatedAt: 0,
    canvas: null,
    view: null,
    dirtyCanvas: false,
    dirtyView: false,
    serverCanvasRev: 0,
    serverViewRev: 0,
  };
}

function mergeDrafts(base: ProjectDraft, overlay: ProjectDraft): ProjectDraft {
  const canvas = overlay.canvas ?? base.canvas;
  const view = overlay.view ?? base.view;
  return {
    ...base,
    ...overlay,
    projectId: overlay.projectId,
    updatedAt: Math.max(base.updatedAt, overlay.updatedAt),
    canvas,
    view,
    // If overlay doesn't have canvas/view yet, keep base dirty flags for those domains.
    dirtyCanvas: overlay.canvas === null ? base.dirtyCanvas : overlay.dirtyCanvas,
    dirtyView: overlay.view === null ? base.dirtyView : overlay.dirtyView,
    serverCanvasRev:
      typeof overlay.serverCanvasRev === "number" ? overlay.serverCanvasRev : base.serverCanvasRev ?? 0,
    serverViewRev: typeof overlay.serverViewRev === "number" ? overlay.serverViewRev : base.serverViewRev ?? 0,
  };
}

// Queue/coalesce IndexedDB writes so frequent canvas/view updates don't steal time from
// pointer handling. We update an in-memory cache immediately and persist opportunistically.
type PendingWrite = {
  next: ProjectDraft;
  timeoutMs: number;
  scheduled: boolean;
  inFlight: boolean;
  promise: Promise<ProjectDraft>;
  resolve: (d: ProjectDraft) => void;
  reject: (e: unknown) => void;
};
const pendingByProjectId = new Map<string, PendingWrite>();

type IdleDeadlineLike = { didTimeout: boolean; timeRemaining: () => number };
type IdleHandle = number | ReturnType<typeof globalThis.setTimeout>;
type RequestIdleCallbackFn = (
  cb: (d: IdleDeadlineLike) => void,
  opts?: { timeout: number }
) => IdleHandle;

const globalWithIdle = globalThis as unknown as {
  requestIdleCallback?: RequestIdleCallbackFn;
};

const requestIdle: (
  cb: (d: IdleDeadlineLike) => void,
  opts?: { timeout: number }
) => IdleHandle =
  globalWithIdle.requestIdleCallback ??
  ((cb, opts) =>
    globalThis.setTimeout(
      () => cb({ didTimeout: true, timeRemaining: () => 0 }),
      Math.max(0, opts?.timeout ?? 200)
    ));

async function flushQueued(projectId: string) {
  const pending = pendingByProjectId.get(projectId);
  if (!pending || pending.inFlight) return;
  pending.inFlight = true;

  try {
    const toWrite = pending.next;
    await upsertProjectDraft(toWrite);
    pending.inFlight = false;

    // If nothing changed while writing, we're done.
    if (pending.next === toWrite) {
      pending.resolve(toWrite);
      pendingByProjectId.delete(projectId);
      return;
    }

    // Otherwise schedule another idle flush; do NOT spin in a tight loop while the user is interacting.
    if (!pending.scheduled) {
      pending.scheduled = true;
      requestIdle(
        () => {
          const p2 = pendingByProjectId.get(projectId);
          if (!p2) return;
          p2.scheduled = false;
          void flushQueued(projectId);
        },
        { timeout: pending.timeoutMs }
      );
    }
  } catch (e) {
    pending.inFlight = false;
    pending.reject(e);
    pendingByProjectId.delete(projectId);
  }
}

export function queueProjectDraftPatch(
  projectId: string,
  patch: Partial<ProjectDraft> & { updatedAt?: number },
  opts?: { timeoutMs?: number }
): Promise<ProjectDraft> {
  const current = memCache.get(projectId) ?? defaultDraft(projectId);
  const next: ProjectDraft = {
    ...current,
    ...patch,
    projectId,
    updatedAt: patch.updatedAt ?? Date.now(),
  };
  memCache.set(projectId, next);

  let pending = pendingByProjectId.get(projectId);
  if (!pending) {
    let resolve!: (d: ProjectDraft) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<ProjectDraft>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    pending = {
      next,
      timeoutMs: opts?.timeoutMs ?? 300,
      scheduled: false,
      inFlight: false,
      promise,
      resolve,
      reject,
    };
    pendingByProjectId.set(projectId, pending);
  } else {
    pending.next = next;
    pending.timeoutMs = opts?.timeoutMs ?? pending.timeoutMs;
  }

  if (!pending.scheduled && !pending.inFlight) {
    pending.scheduled = true;
    requestIdle(
      () => {
        // If we got cancelled (rare), this will no-op.
        pending = pendingByProjectId.get(projectId);
        if (pending) pending.scheduled = false;
        void flushQueued(projectId);
      },
      { timeout: pending.timeoutMs }
    );
  }

  return pending.promise;
}

export async function patchProjectDraft(
  projectId: string,
  patch: Partial<ProjectDraft> & { updatedAt?: number }
): Promise<ProjectDraft> {
  // "Immediate" patch: still goes through the queue so frequent calls coalesce,
  // but callers awaiting this will resolve after persistence.
  return await queueProjectDraftPatch(projectId, patch, { timeoutMs: 300 });
}


