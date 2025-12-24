"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as PIXI from "pixi.js";

import type { AssetWithAi, CanvasObjectRow } from "@/server/db/types";
import { AssetLightbox } from "@/components/lightbox/AssetLightbox";
import { getProjectDraft, patchProjectDraft } from "@/lib/offlineDrafts";

type RippleUniformValues = {
  uTime: number;
  uCenter: PIXI.Point;
  uAmplitude: number;
  uFrequency: number;
  uSpeed: number;
  uWidth: number;
  uDecay: number;
  uAspect: number;
  uShapeAspect: number;
  uShapeRotation: number;
  uDuration: number;
};

type RippleUniformGroup = PIXI.UniformGroup & { uniforms: RippleUniformValues };

// Theme color used for the *viewport region* indicator inside the minimap.
// Keep this aligned with the app's visual language (matches the existing selection blue).
const THEME_ACCENT = 0x60a5fa; // blue-400
const IMAGE_CORNER_RADIUS = 22; // in texture pixels at scale=1 (scales with zoom)

const WORKSPACE_BG_HEX = 0x0a0a0a; // slightly-off black
const WORKSPACE_BG_CSS = "#0a0a0a";

type MinimapTheme = {
  bgHex: number;
  bgAlpha: number;
  strokeHex: number;
  strokeAlpha: number;
  shadeAlpha: number;
};

const MINIMAP_W = 220;
const MINIMAP_H = 160;
const MINIMAP_MARGIN = 12;
const MINIMAP_RADIUS = 10;
const MINIMAP_PAD = 10;

const MINIMAP_THEME: MinimapTheme = {
  bgHex: 0x09090b,
  bgAlpha: 0.88,
  strokeHex: 0xffffff,
  strokeAlpha: 0.1,
  shadeAlpha: 0.28,
};

// Softer, subtler "card" shadow settings. These are in *texture pixels* at scale=1.
// We animate between base↔lifted rather than snapping.
const SHADOW_BASE_ALPHA = 0.10;
const SHADOW_LIFT_ALPHA = 0.16;
const SHADOW_BASE_OFFSET = 6;
const SHADOW_LIFT_OFFSET = 10;
const SHADOW_BASE_SPREAD = 18;
const SHADOW_LIFT_SPREAD = 28;
const SHADOW_LAYERS = 8;
const SHADOW_ANIM_SMOOTHING = 0.12; // 0..1, higher = snappier

function uuid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function isVideoMime(mimeType: string | null | undefined) {
  return !!mimeType && mimeType.startsWith("video/");
}

function extractHtmlVideoElementFromTexture(tex: PIXI.Texture | null | undefined): HTMLVideoElement | null {
  const tAny = tex as any;
  const candidates: any[] = [
    tAny?.source?.resource,
    tAny?.source?.resource?.source,
    tAny?.source?.resource?.domElement,
    tAny?.baseTexture?.resource,
    tAny?.baseTexture?.resource?.source,
    tAny?.baseTexture?.resource?.domElement,
    tAny?.baseTexture?.source?.resource,
    tAny?.baseTexture?.source?.resource?.source,
  ];

  for (const c of candidates) {
    if (!c) continue;
    if (typeof HTMLVideoElement !== "undefined" && c instanceof HTMLVideoElement) return c;
    if (typeof HTMLVideoElement !== "undefined" && c?.source instanceof HTMLVideoElement) return c.source;
    if (typeof HTMLVideoElement !== "undefined" && c?.domElement instanceof HTMLVideoElement) return c.domElement;
    if (typeof HTMLVideoElement !== "undefined" && c?.element instanceof HTMLVideoElement) return c.element;
  }
  return null;
}

function redrawMinimapBackground(
  g: PIXI.Graphics,
  theme: { bgHex: number; bgAlpha: number; strokeHex: number; strokeAlpha: number }
) {
  g.clear();
  g.roundRect(0, 0, MINIMAP_W, MINIMAP_H, MINIMAP_RADIUS);
  g.fill({ color: theme.bgHex, alpha: theme.bgAlpha });
  g.stroke({ color: theme.strokeHex, width: 1, alpha: theme.strokeAlpha });
}

// Viewport zoom limits:
// - Max zoom-in is 100% (1.0)
// - Allow zooming out to 1% (0.01)
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 1.0;

// Interaction tuning:
// - Double click should only open the fullscreen/lightbox view when reasonably zoomed in.
const TAP_MAX_MOVE_PX = 6; // renderer-space px
const FULLSCREEN_DBLCLICK_FIT_FACTOR = 0.75; // fraction of "fit zoom" considered "zoomed in"

// When focusing an image via the command palette, zoom so the image occupies most of the viewport.
// Keep a bit of padding so it doesn't feel edge-to-edge.
const FOCUS_FIT_SCREEN_FRACTION = 0.88;

function fitZoomForSprite(
  sp: PIXI.Sprite,
  viewportW: number,
  viewportH: number,
  fraction: number
): number | null {
  const texW = sp.texture?.orig?.width ?? 0;
  const texH = sp.texture?.orig?.height ?? 0;
  if (texW <= 0 || texH <= 0) return null;
  if (viewportW <= 0 || viewportH <= 0) return null;

  // Sprite scale is already the object scale (independent of world zoom).
  const w = Math.abs(texW * (sp.scale?.x ?? 1));
  const h = Math.abs(texH * (sp.scale?.y ?? 1));
  if (w <= 0 || h <= 0) return null;

  // Include rotation by computing the axis-aligned bounding box of the rotated rect.
  const r = sp.rotation ?? 0;
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const effW = c * w + s * h;
  const effH = s * w + c * h;
  if (effW <= 0 || effH <= 0) return null;

  const frac = clamp(fraction, 0.1, 0.98);
  const fit = Math.min((viewportW * frac) / effW, (viewportH * frac) / effH);
  return clamp(fit, MIN_ZOOM, MAX_ZOOM);
}

function ensureRoundedSpriteMask(sp: PIXI.Sprite) {
  const w = sp.texture?.orig?.width ?? 0;
  const h = sp.texture?.orig?.height ?? 0;
  if (w <= 0 || h <= 0) return;

  const r = Math.min(IMAGE_CORNER_RADIUS, w / 2, h / 2);
  let g = (sp as any).__roundMask as PIXI.Graphics | undefined;
  if (!g) {
    g = new PIXI.Graphics();
    g.eventMode = "none";
    // Keep visible=true; in Pixi v8 masks can stop working when visible=false.
    g.visible = true;
    (sp as any).__roundMask = g;
    sp.addChild(g);
    sp.mask = g;
  }

  g.clear();
  g.roundRect(-w / 2, -h / 2, w, h, r);
  g.fill(0xffffff);
}

function drawSoftShadow(g: PIXI.Graphics, w: number, h: number, r: number, lift: number) {
  g.clear();
  const tLift = clamp(lift, 0, 1);
  const alpha = lerp(SHADOW_BASE_ALPHA, SHADOW_LIFT_ALPHA, tLift);
  const offset = lerp(SHADOW_BASE_OFFSET, SHADOW_LIFT_OFFSET, tLift);
  const spread = lerp(SHADOW_BASE_SPREAD, SHADOW_LIFT_SPREAD, tLift);
  const layers = SHADOW_LAYERS;

  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    // Wider pads + a faster falloff makes the edge feel softer without getting too dark.
    const pad = spread * (0.2 + 1.05 * t);
    const falloff = (1 - t) * (1 - t);
    const a = alpha * falloff * 0.45;
    const rr = Math.min(r + pad, (w + pad * 2) / 2, (h + pad * 2) / 2);
    g.roundRect(-w / 2 - pad + offset, -h / 2 - pad + offset, w + pad * 2, h + pad * 2, rr);
    g.fill({ color: 0x000000, alpha: a });
  }
}

function smoothstep01(t: number) {
  const x = clamp(t, 0, 1);
  // Make the zoom easing a bit "faster" near the ends by never going all the way to 0.
  // (We still clamp zoom, so this won't overshoot.)
  const y = x * x * (3 - 2 * x);
  return 0.12 + 0.88 * y;
}

function easeInOut01(t: number) {
  const x = clamp(t, 0, 1);
  // Smoothstep: ease-in-out with zero slope at both ends.
  return x * x * (3 - 2 * x);
}

function normalizeZOrder(
  prev: CanvasObjectRow[],
  bringToFrontIds: string[]
): CanvasObjectRow[] {
  if (!bringToFrontIds.length) return prev;
  const front = new Set(bringToFrontIds);

  const ordered = [...prev].sort((a, b) => {
    if (a.z_index !== b.z_index) return a.z_index - b.z_index;
    return a.id.localeCompare(b.id);
  });

  const back = ordered.filter((o) => !front.has(o.id));
  const frontItems = ordered.filter((o) => front.has(o.id));
  const nextOrdered = [...back, ...frontItems];

  // Reassign z-index densely: others become lower, selected become highest.
  const now = new Date().toISOString();
  return nextOrdered.map((o, idx) =>
    o.z_index === idx ? o : { ...o, z_index: idx, updated_at: now }
  );
}

export function PixiWorkspace(props: {
  projectId: string;
  initialAssets: AssetWithAi[];
  initialObjects: CanvasObjectRow[];
  initialView?: { world_x: number; world_y: number; zoom: number } | null;
  highlightOverlay?: {
    assetId: string;
    term: string;
    svg: string | null;
    bboxJson: string | null;
  } | null;
  onObjectsChange?: (objects: CanvasObjectRow[]) => void;
  onFocusRequest?: (fn: (objectId: string) => void) => void;
  onViewportCenterRequest?: (fn: () => { x: number; y: number }) => void;
}) {
  const projectId = props.projectId;
  const initialObjects = props.initialObjects;
  const initialView = props.initialView ?? null;
  const onObjectsChange = props.onObjectsChange;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const worldRef = useRef<PIXI.Container | null>(null);
  const worldRootRef = useRef<PIXI.Container | null>(null);
  const spritesByObjectIdRef = useRef<Map<string, PIXI.Sprite>>(new Map());
  const shadowsByObjectIdRef = useRef<Map<string, PIXI.Graphics>>(new Map());
  const textureCacheRef = useRef<Map<string, PIXI.Texture>>(new Map());
  const texturePromiseRef = useRef<Map<string, Promise<PIXI.Texture>>>(new Map());
  const videoElByObjectIdRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const videoObjectIdsRef = useRef<Set<string>>(new Set());
  const videoHoverOverlayByObjectIdRef = useRef<Map<string, PIXI.Graphics>>(new Map());
  const hoveredVideoObjectIdRef = useRef<string | null>(null);
  const canvasHoverRef = useRef(false);
  const playingSelectedVideoObjectIdRef = useRef<string | null>(null);
  const selectedVideoPlayAttemptAtMsRef = useRef<Map<string, number>>(new Map()); // id -> ms
  const selectedIdsRef = useRef<string[]>([]);
  const highlightOverlayByObjectIdRef = useRef<Map<string, PIXI.Container>>(new Map());
  const shadowLiftByObjectIdRef = useRef<Map<string, { current: number; target: number }>>(new Map());
  const animatingShadowIdsRef = useRef<Set<string>>(new Set());
  const rippleRef = useRef<{
    filter: PIXI.Filter;
    uniforms: RippleUniformGroup;
    active: boolean;
    timeSec: number;
  } | null>(null);
  const lastRippleCenter01Ref = useRef<PIXI.Point>(new PIXI.Point(0.5, 0.5));
  // Drop ripple should only start once the dropped image is actually present on-canvas.
  // We store the renderer-space drop point + the newly created object id, then trigger
  // the ripple the moment that object's texture becomes available.
  const pendingDropRippleRef = useRef<null | { objectId: string; rx: number; ry: number; fired: boolean }>(
    null
  );
  const previewRef = useRef<{
    rt: PIXI.RenderTexture;
    root: PIXI.Container;
    content: PIXI.Container;
    spriteById: Map<string, PIXI.Sprite>;
  } | null>(null);
  const selectionLayerRef = useRef<PIXI.Container | null>(null);
  const selectionBoxRef = useRef<PIXI.Graphics | null>(null);
  const handleRefs = useRef<Record<string, PIXI.Graphics>>({});
  const multiSelectionRef = useRef<PIXI.Graphics | null>(null);
  const minimapRef = useRef<{
    container: PIXI.Container;
    bg: PIXI.Graphics;
    items: PIXI.Container;
    spriteById: Map<string, PIXI.Sprite>;
    shade: PIXI.Graphics;
    overlay: PIXI.Graphics;
    viewport: PIXI.Graphics;
    showUntilMs: number;
    targetAlpha: number;
  } | null>(null);
  const activeGestureRef = useRef<
    | null
    | { kind: "pan"; last: PIXI.Point }
    | { kind: "move"; objectIds: string[]; last: PIXI.Point }
    | {
        kind: "resize";
        objectId: string;
        corner: "tl" | "tr" | "br" | "bl";
        fixedWorld: PIXI.Point;
        localFixed: PIXI.Point;
        localHandle: PIXI.Point;
        baseW: number;
        baseH: number;
      }
  >(null);

  // Click/tap detection for "zoom in on click when zoomed out".
  const tapCandidateRef = useRef<null | {
    pointerId: number;
    button: number;
    startRx: number;
    startRy: number;
    moved: boolean;
    objectId: string | null;
    isHandle: boolean;
    shift: boolean;
  }>(null);

  const viewAnimRef = useRef<null | {
    startMs: number;
    durationMs: number;
    from: { x: number; y: number; zoom: number };
    to: { x: number; y: number; zoom: number };
    onComplete?: () => void;
  }>(null);

  const cancelViewAnimation = () => {
    viewAnimRef.current = null;
  };

  const animateViewTo = (
    to: { x: number; y: number; zoom: number },
    opts?: { durationMs?: number; onComplete?: () => void }
  ) => {
    const world = worldRef.current;
    if (!world) return false;
    const from = { x: world.position.x, y: world.position.y, zoom: world.scale.x || 1 };
    const durationMs = clamp(opts?.durationMs ?? 280, 80, 1200);

    // If it's already effectively at the target, apply immediately.
    if (
      Math.abs(from.x - to.x) < 0.01 &&
      Math.abs(from.y - to.y) < 0.01 &&
      Math.abs(from.zoom - to.zoom) < 1e-6
    ) {
      world.position.set(to.x, to.y);
      world.scale.set(to.zoom);
      opts?.onComplete?.();
      return true;
    }

    viewAnimRef.current = {
      startMs: performance.now(),
      durationMs,
      from,
      to,
      onComplete: opts?.onComplete,
    };
    return true;
  };

  const viewDistance = (a: { x: number; y: number; zoom: number }, b: { x: number; y: number; zoom: number }) => {
    // Combine pan distance (px) + zoom distance (scaled into px-ish) into a single heuristic.
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = (a.zoom - b.zoom) * 650;
    return Math.hypot(dx, dy, dz);
  };

  const [objects, setObjects] = useState<CanvasObjectRow[]>(initialObjects);
  const [assets, setAssets] = useState<AssetWithAi[]>(props.initialAssets);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dropError, setDropError] = useState<string | null>(null);
  const [lightboxAssetId, setLightboxAssetId] = useState<string | null>(null);
  const initialViewOverrideRef = useRef<{ world_x: number; world_y: number; zoom: number } | null>(null);
  const [booting, setBooting] = useState(true);
  const [showBootUi, setShowBootUi] = useState(false);
  const [syncUi, setSyncUi] = useState(() => ({
    // IMPORTANT: keep the initial render deterministic so SSR and client hydration match.
    // We update this from `navigator.onLine` inside a useEffect after mount.
    online: true,
    dirtyCanvas: false,
    dirtyView: false,
    syncing: false,
  }));

  const focusZoomInOnSprite = (sp: PIXI.Sprite) => {
    const app = appRef.current;
    const world = worldRef.current;
    if (!app || !world) return false;

    const currentZoom = world.scale.x || 1;
    const fitZoom = fitZoomForSprite(sp, app.renderer.width, app.renderer.height, FOCUS_FIT_SCREEN_FRACTION) ?? null;
    // Match Spacebar behavior: always feel like a zoom-in.
    const nextZoom = clamp(Math.max(currentZoom * 1.6, fitZoom ?? 0, currentZoom), MIN_ZOOM, MAX_ZOOM);
    const p = sp.position;
    const endX = app.renderer.width / 2 - p.x * nextZoom;
    const endY = app.renderer.height / 2 - p.y * nextZoom;

    cancelViewAnimation();
    animateViewTo(
      { x: endX, y: endY, zoom: nextZoom },
      {
        durationMs: 320,
        onComplete: () => {
          const w2 = worldRef.current;
          if (!w2) return;
          scheduleViewSave({
            world_x: w2.position.x,
            world_y: w2.position.y,
            zoom: w2.scale.x,
          });
          schedulePreviewSave();
        },
      }
    );
    return true;
  };
  const dirtyRef = useRef<{ canvas: boolean; view: boolean }>({ canvas: false, view: false });
  const flushInFlightRef = useRef<Promise<void> | null>(null);
  const localCanvasDraftTimer = useRef<number | null>(null);
  const localViewDraftTimer = useRef<number | null>(null);
  const [lightboxOriginRect, setLightboxOriginRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const triggerRippleAtRendererPoint = (
    rx: number,
    ry: number,
    opts?: { shapeAspect?: number; shapeRotation?: number }
  ) => {
    const app = appRef.current;
    const worldRoot = worldRootRef.current;
    const ripple = rippleRef.current;
    if (!app || !worldRoot || !ripple) return;

    const w = Math.max(1, app.renderer.width);
    const h = Math.max(1, app.renderer.height);
    const x01 = clamp(rx / w, 0, 1);
    const y01 = clamp(ry / h, 0, 1);

    lastRippleCenter01Ref.current.set(x01, y01);

    ripple.active = true;
    ripple.timeSec = 0;
    ripple.uniforms.uniforms.uTime = 0;
    ripple.uniforms.uniforms.uCenter.set(x01, y01);
    ripple.uniforms.uniforms.uAspect = w / h;
    ripple.uniforms.uniforms.uShapeAspect = clamp(
      Number(opts?.shapeAspect ?? 1) || 1,
      0.05,
      20
    );
    ripple.uniforms.uniforms.uShapeRotation = Number(opts?.shapeRotation ?? 0) || 0;

    if (!worldRoot.filters || worldRoot.filters.length === 0) {
      worldRoot.filters = [ripple.filter];
    } else if (!worldRoot.filters.includes(ripple.filter)) {
      worldRoot.filters = [ripple.filter, ...worldRoot.filters];
    }
  };

  const maybeTriggerPendingDropRipple = (objectId: string, tex: PIXI.Texture | null | undefined) => {
    const pending = pendingDropRippleRef.current;
    if (!pending || pending.fired) return;
    if (pending.objectId !== objectId) return;
    const w = Number(tex?.orig?.width ?? 0);
    const h = Number(tex?.orig?.height ?? 0);
    if (!(w > 0 && h > 0)) return;
    pending.fired = true;
    triggerRippleAtRendererPoint(pending.rx, pending.ry, { shapeAspect: w / h, shapeRotation: 0 });
  };

  const objectsRef = useRef<CanvasObjectRow[]>(initialObjects);
  useEffect(() => {
    objectsRef.current = objects;
  }, [objects]);

  const minimapThemeRef = useRef<MinimapTheme>(MINIMAP_THEME);
  const minimapShadeAlphaRef = useRef<number>(MINIMAP_THEME.shadeAlpha);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  useEffect(() => setAssets(props.initialAssets), [props.initialAssets]);
  useEffect(() => {
    setObjects(initialObjects);
    initialViewOverrideRef.current = null;
    dirtyRef.current = { canvas: false, view: false };
    setBooting(true);
    setSyncUi((s) => ({ ...s, dirtyCanvas: false, dirtyView: false, syncing: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Avoid flashing a loader if boot is fast, but also avoid showing a "flaky" canvas while
  // drafts are being restored / a quick sync is happening.
  useEffect(() => {
    if (!booting) {
      setShowBootUi(false);
      return;
    }
    const id = window.setTimeout(() => setShowBootUi(true), 150);
    return () => window.clearTimeout(id);
  }, [booting, projectId]);

  const setDirtyCanvas = (v: boolean) => {
    if (dirtyRef.current.canvas === v) return;
    dirtyRef.current.canvas = v;
    setSyncUi((s) => ({ ...s, dirtyCanvas: v }));
  };
  const setDirtyView = (v: boolean) => {
    if (dirtyRef.current.view === v) return;
    dirtyRef.current.view = v;
    setSyncUi((s) => ({ ...s, dirtyView: v }));
  };

  useEffect(() => {
    const updateOnline = () => setSyncUi((s) => ({ ...s, online: navigator.onLine }));
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let shouldTryQuickSync = false;
      try {
        const draft = await getProjectDraft(projectId);
        if (cancelled) return;
        if (!draft) {
          setDirtyCanvas(false);
          setDirtyView(false);
          // Seed a baseline snapshot so a previously visited project can restore from IndexedDB
          // even if the backend is temporarily unavailable later.
          void patchProjectDraft(projectId, {
            canvas: initialObjects,
            view: initialView,
            dirtyCanvas: false,
            dirtyView: false,
          }).catch(() => {});
          return;
        }

        setDirtyCanvas(!!draft.dirtyCanvas);
        setDirtyView(!!draft.dirtyView);
        shouldTryQuickSync =
          (draft.dirtyCanvas || draft.dirtyView) &&
          typeof navigator !== "undefined" &&
          navigator.onLine;

        const initialNewestMs = Math.max(
          0,
          ...initialObjects
            .map((o) => Date.parse(o.updated_at || o.created_at || ""))
            .filter((n) => Number.isFinite(n))
        );

        if (draft.canvas && (draft.dirtyCanvas || draft.updatedAt > initialNewestMs)) {
          setObjects(draft.canvas);
          onObjectsChange?.(draft.canvas);
        }

        if (draft.view) {
          initialViewOverrideRef.current = draft.view;
          const world = worldRef.current;
          if (world) {
            world.position.set(draft.view.world_x, draft.view.world_y);
            const z = Number.isFinite(draft.view.zoom) ? draft.view.zoom : 1;
            world.scale.set(clamp(z, MIN_ZOOM, MAX_ZOOM));
          }
        }
      } catch {
        // ignore
      } finally {
        // If we have unsynced local changes and we're online, it's usually fast to flush.
        // Waiting briefly avoids showing a "Syncing…" flash on initial load.
        if (!cancelled && shouldTryQuickSync) {
          try {
            const waitMs = 250;
            await Promise.race([
              flushDraftToServer(),
              new Promise<void>((resolve) => window.setTimeout(resolve, waitMs)),
            ]);
          } catch {
            // ignore
          }
        }
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, initialObjects, onObjectsChange]);

  const flushDraftToServer = async () => {
    if (flushInFlightRef.current) return flushInFlightRef.current;
    const isOnline = typeof navigator !== "undefined" ? navigator.onLine : syncUi.online;
    if (!isOnline) return;

    const p = (async () => {
      setSyncUi((s) => ({ ...s, syncing: true }));
      try {
        const draft = await getProjectDraft(projectId);
        if (!draft) return;

        let dirtyCanvas = !!draft.dirtyCanvas;
        let dirtyView = !!draft.dirtyView;

        if (dirtyCanvas && draft.canvas) {
          try {
            const res = await fetch(`/api/projects/${projectId}/canvas`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ objects: draft.canvas }),
            });
            if (!res.ok) throw new Error(`canvas_sync_failed:${res.status}`);
            dirtyCanvas = false;
            await patchProjectDraft(projectId, { canvas: draft.canvas, dirtyCanvas: false }).catch(() => {});
          } catch {
            // keep dirtyCanvas=true
          }
        }

        if (dirtyView && draft.view) {
          try {
            const res = await fetch(`/api/projects/${projectId}/view`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(draft.view),
            });
            if (!res.ok) throw new Error(`view_sync_failed:${res.status}`);
            dirtyView = false;
            await patchProjectDraft(projectId, { view: draft.view, dirtyView: false }).catch(() => {});
          } catch {
            // keep dirtyView=true
          }
        }

        setDirtyCanvas(dirtyCanvas);
        setDirtyView(dirtyView);
      } finally {
        setSyncUi((s) => ({ ...s, syncing: false }));
        flushInFlightRef.current = null;
      }
    })();

    flushInFlightRef.current = p;
    return p;
  };

  useEffect(() => {
    if (!syncUi.online) return;
    if (!syncUi.dirtyCanvas && !syncUi.dirtyView) return;
    void flushDraftToServer();
    const id = window.setInterval(() => void flushDraftToServer(), 3000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, syncUi.online, syncUi.dirtyCanvas, syncUi.dirtyView]);

  // Debounced canvas persistence
  const saveTimer = useRef<number | null>(null);
  const viewSaveTimer = useRef<number | null>(null);
  const previewSaveTimer = useRef<number | null>(null);
  const emitTimerRef = useRef<number | null>(null);
  const emitLatestRef = useRef<CanvasObjectRow[] | null>(null);

  // Avoid React warning: do not synchronously update parent state from inside Pixi event updates.
  // Coalesce into a future macrotask.
  const scheduleEmitObjectsChange = (next: CanvasObjectRow[]) => {
    if (!onObjectsChange) return;
    emitLatestRef.current = next;
    if (emitTimerRef.current) return;
    emitTimerRef.current = window.setTimeout(() => {
      emitTimerRef.current = null;
      const latest = emitLatestRef.current;
      emitLatestRef.current = null;
      if (latest) onObjectsChange?.(latest);
    }, 0);
  };

  const scheduleSave = (nextObjects: CanvasObjectRow[]) => {
    if (localCanvasDraftTimer.current) window.clearTimeout(localCanvasDraftTimer.current);
    localCanvasDraftTimer.current = window.setTimeout(() => {
      void patchProjectDraft(projectId, { canvas: nextObjects, dirtyCanvas: true }).catch(() => {});
    }, 40);
    setDirtyCanvas(true);

    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/projects/${props.projectId}/canvas`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ objects: nextObjects }),
        });
        if (!res.ok) throw new Error(`canvas_save_failed:${res.status}`);
        void patchProjectDraft(projectId, { canvas: nextObjects, dirtyCanvas: false }).catch(() => {});
        setDirtyCanvas(false);
      } catch {
        setDirtyCanvas(true);
      }
    }, 250);
    schedulePreviewSave();
  };

  const saveNow = async (nextObjects: CanvasObjectRow[]) => {
    if (localCanvasDraftTimer.current) {
      window.clearTimeout(localCanvasDraftTimer.current);
      localCanvasDraftTimer.current = null;
    }
    void patchProjectDraft(projectId, { canvas: nextObjects, dirtyCanvas: true }).catch(() => {});
    setDirtyCanvas(true);

    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    try {
      const res = await fetch(`/api/projects/${props.projectId}/canvas`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objects: nextObjects }),
      });
      if (!res.ok) throw new Error(`canvas_save_failed:${res.status}`);
      void patchProjectDraft(projectId, { canvas: nextObjects, dirtyCanvas: false }).catch(() => {});
      setDirtyCanvas(false);
    } catch {
      setDirtyCanvas(true);
    }
  };

  const scheduleViewSave = (view: { world_x: number; world_y: number; zoom: number }) => {
    if (localViewDraftTimer.current) window.clearTimeout(localViewDraftTimer.current);
    localViewDraftTimer.current = window.setTimeout(() => {
      void patchProjectDraft(projectId, { view, dirtyView: true }).catch(() => {});
    }, 60);
    setDirtyView(true);

    if (viewSaveTimer.current) window.clearTimeout(viewSaveTimer.current);
    viewSaveTimer.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/projects/${props.projectId}/view`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(view),
        });
        if (!res.ok) throw new Error(`view_save_failed:${res.status}`);
        void patchProjectDraft(projectId, { view, dirtyView: false }).catch(() => {});
        setDirtyView(false);
      } catch {
        setDirtyView(true);
      }
    }, 250);
  };

  const schedulePreviewSave = () => {
    if (previewSaveTimer.current) window.clearTimeout(previewSaveTimer.current);
    previewSaveTimer.current = window.setTimeout(async () => {
      const app = appRef.current;
      const preview = previewRef.current;
      if (!app) return;
      if (!preview) return;

      // Build a preview of the *entire board* (like the minimap), not just the current viewport.
      const outSize = 256;
      const content = preview.content;
      const spriteById = preview.spriteById;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (const sp of spritesByObjectIdRef.current.values()) {
        const w = sp.texture?.orig?.width ?? 0;
        const h = sp.texture?.orig?.height ?? 0;
        if (w <= 0 || h <= 0) continue;
        const hw = (w / 2) * sp.scale.x;
        const hh = (h / 2) * sp.scale.y;
        minX = Math.min(minX, sp.position.x - hw);
        maxX = Math.max(maxX, sp.position.x + hw);
        minY = Math.min(minY, sp.position.y - hh);
        maxY = Math.max(maxY, sp.position.y + hh);
      }

      // If nothing is on the board yet, skip preview upload.
      if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        return;
      }

      const w0 = Math.max(1, maxX - minX);
      const h0 = Math.max(1, maxY - minY);
      const size0 = Math.max(w0, h0);
      const pad = Math.max(24, size0 * 0.08);
      const size = size0 + pad * 2;
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;

      // Sync preview sprites
      const seen = new Set<string>();
      for (const sp of spritesByObjectIdRef.current.values()) {
        const id = (sp as any).__objectId as string | undefined;
        if (!id) continue;
        const tex = sp.texture;
        const tw = tex?.orig?.width ?? 0;
        const th = tex?.orig?.height ?? 0;
        if (tw <= 0 || th <= 0) continue;
        seen.add(id);

        let psp = spriteById.get(id);
        if (!psp) {
          psp = new PIXI.Sprite(tex);
          psp.anchor.set(0.5);
          psp.eventMode = "none";
          content.addChild(psp);
          spriteById.set(id, psp);
        } else if (psp.texture !== tex) {
          psp.texture = tex;
        }

        psp.position.copyFrom(sp.position);
        psp.scale.copyFrom(sp.scale);
        psp.rotation = sp.rotation;
        psp.alpha = 1;
      }

      for (const [id, psp] of spriteById.entries()) {
        if (seen.has(id)) continue;
        psp.destroy({ children: true, texture: false });
        spriteById.delete(id);
      }

      // Fit board bounds into a square texture
      const s = outSize / size;
      content.scale.set(s);
      content.position.set(outSize / 2 - cx * s, outSize / 2 - cy * s);

      // Render to offscreen texture and extract. This avoids the "black canvas" WebGL readback issue.
      app.renderer.render({
        container: preview.root,
        target: preview.rt,
        clear: true,
        clearColor: WORKSPACE_BG_HEX,
      });

      const cAny = app.renderer.extract.canvas({ target: preview.rt }) as any;
      let finalBlob: Blob | null = null;
      if (cAny?.convertToBlob) {
        finalBlob = await cAny.convertToBlob({ type: "image/webp", quality: 0.75 }).catch(() => null);
        if (!finalBlob) finalBlob = await cAny.convertToBlob({ type: "image/png" }).catch(() => null);
      } else if (cAny?.toBlob) {
        finalBlob =
          (await new Promise<Blob | null>((resolve) => cAny.toBlob(resolve, "image/webp", 0.75))) ??
          (await new Promise<Blob | null>((resolve) => cAny.toBlob(resolve, "image/png")));
      }
      if (!finalBlob) return;

      const buf = await finalBlob.arrayBuffer();
      await fetch(`/api/projects/${props.projectId}/preview`, {
        method: "PUT",
        headers: { "Content-Type": finalBlob.type || "image/webp" },
        body: buf,
      }).catch(() => {});
    }, 1200);
  };

  const assetById = useMemo(() => {
    const m = new Map<string, AssetWithAi>();
    for (const a of assets) m.set(a.id, a);
    return m;
  }, [assets]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const primarySelectedId = selectedIds.length === 1 ? selectedIds[0] : null;

  const setHoveredVideoObjectId = (next: string | null) => {
    const prev = hoveredVideoObjectIdRef.current;
    if (prev === next) return;
    hoveredVideoObjectIdRef.current = next;

    if (prev) {
      const gPrev = videoHoverOverlayByObjectIdRef.current.get(prev);
      if (gPrev) gPrev.visible = false;
    }

    if (next) {
      const gNext = videoHoverOverlayByObjectIdRef.current.get(next);
      if (gNext) gNext.visible = true;
    }
  };

  const clearHighlightOverlays = () => {
    for (const [objectId, c] of highlightOverlayByObjectIdRef.current.entries()) {
      try {
        c.destroy({ children: true });
      } catch {
        // ignore
      }
      highlightOverlayByObjectIdRef.current.delete(objectId);
    }
  };

  const parseBoxesFromBboxJson = (bboxJson: string | null) => {
    if (!bboxJson) return [] as Array<{ x: number; y: number; w: number; h: number }>;
    try {
      const parsed = JSON.parse(bboxJson) as any;
      const boxes = parsed?.boxes;
      if (!Array.isArray(boxes)) return [];
      return boxes
        .map((b: any) => ({
          x: Number(b?.x ?? 0),
          y: Number(b?.y ?? 0),
          w: Number(b?.w ?? 0),
          h: Number(b?.h ?? 0),
        }))
        .filter((b) => Number.isFinite(b.x) && Number.isFinite(b.y) && b.w > 0 && b.h > 0);
    } catch {
      return [];
    }
  };

  const setShadowLiftTarget = (objectIds: string[], target: number) => {
    const t = clamp(target, 0, 1);
    for (const id of objectIds) {
      const state = shadowLiftByObjectIdRef.current.get(id) ?? { current: 0, target: 0 };
      state.target = t;
      shadowLiftByObjectIdRef.current.set(id, state);
      animatingShadowIdsRef.current.add(id);
    }
  };

  const applyHighlightToObject = (objectId: string, assetId: string) => {
    const sp = spritesByObjectIdRef.current.get(objectId);
    if (!sp) return;

    const overlay = props.highlightOverlay;
    if (!overlay || overlay.assetId !== assetId) return;

    // Determine base image dimensions in local sprite space.
    let baseW = sp.texture?.orig?.width ?? 0;
    let baseH = sp.texture?.orig?.height ?? 0;
    if ((baseW <= 0 || baseH <= 0) && assetById.get(assetId)) {
      const a = assetById.get(assetId)!;
      baseW = a.width ?? 0;
      baseH = a.height ?? 0;
    }
    if (baseW <= 0 || baseH <= 0) return;

    const c = new PIXI.Container();
    c.eventMode = "none";

    // SVG overlay (preferred): render as tinted sprite stretched to image bounds.
    if (overlay.svg && overlay.svg.trim().startsWith("<svg")) {
      const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(overlay.svg)}`;
      const tex = PIXI.Texture.from(svgDataUrl);
      const svgSp = new PIXI.Sprite(tex);
      svgSp.anchor.set(0.5);
      svgSp.width = baseW;
      svgSp.height = baseH;
      svgSp.alpha = 0.22;
      svgSp.tint = THEME_ACCENT;
      svgSp.blendMode = "screen";
      c.addChild(svgSp);
    }

    // BBox fallback/augmentation: draw translucent rectangles.
    const boxes = parseBoxesFromBboxJson(overlay.bboxJson);
    if (boxes.length) {
      const normalized = boxes.every(
        (b) =>
          b.x >= 0 &&
          b.y >= 0 &&
          b.x <= 1.5 &&
          b.y <= 1.5 &&
          b.w > 0 &&
          b.h > 0 &&
          b.w <= 1.5 &&
          b.h <= 1.5
      );
      const g = new PIXI.Graphics();
      g.eventMode = "none";
      for (const b of boxes) {
        const xPx = normalized ? b.x * baseW : b.x;
        const yPx = normalized ? b.y * baseH : b.y;
        const wPx = normalized ? b.w * baseW : b.w;
        const hPx = normalized ? b.h * baseH : b.h;
        const lx = -baseW / 2 + xPx;
        const ly = -baseH / 2 + yPx;
        g.rect(lx, ly, wPx, hPx);
        g.fill({ color: THEME_ACCENT, alpha: 0.10 });
        g.stroke({ color: THEME_ACCENT, alpha: 0.85, width: 3 });
      }
      c.addChild(g);
    }

    sp.addChild(c);
    highlightOverlayByObjectIdRef.current.set(objectId, c);
  };

  // Apply/clear highlights when the requested overlay changes or when objects are (re)built.
  useEffect(() => {
    clearHighlightOverlays();
    const overlay = props.highlightOverlay;
    if (!overlay) return;
    for (const o of objects) {
      if (o.type !== "image" || !o.asset_id) continue;
      if (o.asset_id !== overlay.assetId) continue;
      applyHighlightToObject(o.id, o.asset_id);
    }
    return () => {
      clearHighlightOverlays();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.highlightOverlay, objects, assetById]);

  // Keyboard delete/backspace to remove selected objects from canvas + DB (via canvas save).
  useEffect(() => {
    const resetZoomToTenPercent = () => {
      const app = appRef.current;
      const world = worldRef.current;
      if (!app || !world) return;

      // Keep the current viewport center pinned while zooming out.
      const center = new PIXI.Point(app.renderer.width / 2, app.renderer.height / 2);
      const centerWorld = world.toLocal(center);
      const nextZoom = clamp(0.1, MIN_ZOOM, MAX_ZOOM);
      const endX = center.x - centerWorld.x * nextZoom;
      const endY = center.y - centerWorld.y * nextZoom;

      cancelViewAnimation();
      animateViewTo(
        { x: endX, y: endY, zoom: nextZoom },
        {
          durationMs: 260,
          onComplete: () => {
            const w2 = worldRef.current;
            if (!w2) return;
            scheduleViewSave({
              world_x: w2.position.x,
              world_y: w2.position.y,
              zoom: w2.scale.x,
            });
            schedulePreviewSave();
          },
        }
      );
    };

    const focusToggle = (opts: { requireHover: boolean }) => {
      const app = appRef.current;
      const world = worldRef.current;
      if (!app || !world) return;

      if (opts.requireHover && !canvasHoverRef.current) return;

      const selectedId = selectedIdsRef.current.length === 1 ? selectedIdsRef.current[0] : null;
      if (!selectedId) return;
      const sp = spritesByObjectIdRef.current.get(selectedId) as PIXI.Sprite | undefined;
      if (!sp) return;

      const currentZoom = world.scale.x || 1;
      const fitZoom =
        fitZoomForSprite(sp, app.renderer.width, app.renderer.height, FOCUS_FIT_SCREEN_FRACTION) ?? null;
      // Space should feel like "zoom in", so never zoom out when focusing.
      const nextZoom = clamp(Math.max(currentZoom * 1.6, fitZoom ?? 0, currentZoom), MIN_ZOOM, MAX_ZOOM);
      const p = sp.position;
      const endX = app.renderer.width / 2 - p.x * nextZoom;
      const endY = app.renderer.height / 2 - p.y * nextZoom;

      const currentView = { x: world.position.x, y: world.position.y, zoom: world.scale.x || 1 };
      const focusView = { x: endX, y: endY, zoom: nextZoom };

      // Compute the exact same zoom-out target as pressing "0": 10% zoom,
      // keeping the current viewport center pinned in world space.
      const center = new PIXI.Point(app.renderer.width / 2, app.renderer.height / 2);
      const centerWorld = world.toLocal(center);
      const outZoom = clamp(0.1, MIN_ZOOM, MAX_ZOOM);
      const outView = {
        x: center.x - centerWorld.x * outZoom,
        y: center.y - centerWorld.y * outZoom,
        zoom: outZoom,
      };

      // Decide which direction to toggle based on which endpoint we are closer to.
      const dFocus = viewDistance(currentView, focusView);
      const dOut = viewDistance(currentView, outView);
      const goingTo = dFocus <= dOut ? outView : focusView;

      cancelViewAnimation();
      animateViewTo(
        goingTo,
        {
          durationMs: 320,
          onComplete: () => {
            const w2 = worldRef.current;
            if (!w2) return;
            scheduleViewSave({
              world_x: w2.position.x,
              world_y: w2.position.y,
              zoom: w2.scale.x,
            });
            schedulePreviewSave();
          },
        }
      );
    };

    const deleteSelection = async () => {
      const ids = selectedIdsRef.current;
      if (!ids || ids.length === 0) return;

      // Confirmation: only prompt when deleting images from the board.
      const currentObjects = objectsRef.current ?? [];
      const removeSet = new Set(ids);
      const selectedImageObjects = currentObjects.filter((o) => removeSet.has(o.id) && o.type === "image");
      if (selectedImageObjects.length > 0) {
        const removedAssetIds = new Set<string>();
        for (const o of selectedImageObjects) {
          if (o.asset_id) removedAssetIds.add(o.asset_id);
        }
        const remainingAssetIds = new Set<string>();
        for (const o of currentObjects) {
          if (removeSet.has(o.id)) continue;
          if (o.type !== "image") continue;
          if (!o.asset_id) continue;
          remainingAssetIds.add(o.asset_id);
        }
        const assetsThatWouldBeDeleted = [...removedAssetIds].filter((id) => !remainingAssetIds.has(id));

        const msg =
          assetsThatWouldBeDeleted.length > 0
            ? `Delete ${selectedImageObjects.length} image(s) from the board?\n\nThis will also permanently delete ${assetsThatWouldBeDeleted.length} asset(s) from the project because nothing else is using them.`
            : `Delete ${selectedImageObjects.length} image(s) from the board?`;
        if (!window.confirm(msg)) return;
      }

      setSelectedIds([]);
      let nextObjects: CanvasObjectRow[] | null = null;
      let assetsToDelete: string[] = [];
      setObjects((prev) => {
        const remove = new Set(ids);
        const next = prev.filter((o) => !remove.has(o.id));

        // Determine which underlying assets can be deleted safely:
        // only delete an asset if ALL objects referencing it are being removed.
        const removedAssetIds = new Set<string>();
        for (const o of prev) {
          if (!remove.has(o.id)) continue;
          if (o.type !== "image") continue;
          if (!o.asset_id) continue;
          removedAssetIds.add(o.asset_id);
        }

        const remainingAssetIds = new Set<string>();
        for (const o of next) {
          if (o.type !== "image") continue;
          if (!o.asset_id) continue;
          remainingAssetIds.add(o.asset_id);
        }

        assetsToDelete = [...removedAssetIds].filter((id) => !remainingAssetIds.has(id));
        nextObjects = next;

        scheduleEmitObjectsChange(next);
        return next;
      });

      window.setTimeout(async () => {
        if (!nextObjects) return;
        await saveNow(nextObjects);
        schedulePreviewSave();

        if (assetsToDelete.length) {
          for (const assetId of assetsToDelete) {
            await fetch(`/api/assets/${assetId}`, { method: "DELETE" }).catch(() => {});
          }
          setAssets((prev) => prev.filter((a) => !assetsToDelete.includes(a.id)));
        }
      }, 0);
    };

    const navigateSelection = (dir: "left" | "right" | "up" | "down") => {
      const app = appRef.current;
      const world = worldRef.current;
      if (!app || !world) return;

      const selectedId = selectedIdsRef.current.length === 1 ? selectedIdsRef.current[0] : null;
      if (!selectedId) return;

      const currentSprite = spritesByObjectIdRef.current.get(selectedId) as PIXI.Sprite | undefined;
      if (!currentSprite) return;

      const curX = currentSprite.position.x;
      const curY = currentSprite.position.y;
      const EPS = 1e-6;

      const objects = objectsRef.current ?? [];
      let bestId: string | null = null;
      let bestScore = Number.POSITIVE_INFINITY;

      for (const o of objects) {
        if (o.id === selectedId) continue;
        const sp = spritesByObjectIdRef.current.get(o.id) as PIXI.Sprite | undefined;
        if (!sp) continue;

        const dx = sp.position.x - curX;
        const dy = sp.position.y - curY;

        // Direction filter.
        if (dir === "left" && !(dx < -EPS)) continue;
        if (dir === "right" && !(dx > EPS)) continue;
        if (dir === "up" && !(dy < -EPS)) continue;
        if (dir === "down" && !(dy > EPS)) continue;

        // Score: prioritize movement along primary axis, penalize sideways drift.
        // This feels like "nearest in that direction" rather than strict angle matching.
        const primary = dir === "left" || dir === "right" ? Math.abs(dx) : Math.abs(dy);
        const secondary = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx);
        const score = primary + secondary * 0.45;

        if (score < bestScore) {
          bestScore = score;
          bestId = o.id;
        }
      }

      if (!bestId) return;

      const targetSprite = spritesByObjectIdRef.current.get(bestId) as PIXI.Sprite | undefined;
      if (!targetSprite) return;

      setSelectedIds([bestId]);

      // Animate pan to center selected, keep current zoom.
      const zoom = world.scale.x || 1;
      const p = targetSprite.position;
      const endX = app.renderer.width / 2 - p.x * zoom;
      const endY = app.renderer.height / 2 - p.y * zoom;
      cancelViewAnimation();
      animateViewTo(
        { x: endX, y: endY, zoom },
        {
          durationMs: 220,
          onComplete: () => {
            const w2 = worldRef.current;
            if (!w2) return;
            scheduleViewSave({
              world_x: w2.position.x,
              world_y: w2.position.y,
              zoom: w2.scale.x,
            });
            schedulePreviewSave();
          },
        }
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing.
      const el = document.activeElement as HTMLElement | null;
      const isTyping =
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          (el as any).isContentEditable);

      // Trigger ripple for testing with "r".
      if (!isTyping && (e.key === "r" || e.key === "R")) {
        const app = appRef.current;
        const world = worldRef.current;
        if (!app) return;
        e.preventDefault();

        // Prefer triggering from the currently selected image (if exactly one is selected).
        const selectedId = selectedIdsRef.current.length === 1 ? selectedIdsRef.current[0] : null;
        if (selectedId && world) {
          const sp = spritesByObjectIdRef.current.get(selectedId);
          if (sp) {
            const p = sp.getGlobalPosition(new PIXI.Point());
            const tw = sp.texture?.orig?.width ?? 0;
            const th = sp.texture?.orig?.height ?? 0;
            const sx = Math.abs(sp.scale.x) || 1;
            const sy = Math.abs(sp.scale.y) || 1;
            const shapeAspect =
              tw > 0 && th > 0 ? (tw * sx) / Math.max(1e-6, th * sy) : 1;
            triggerRippleAtRendererPoint(p.x, p.y, {
              shapeAspect,
              shapeRotation: sp.rotation,
            });
            return;
          }
        }

        // Fallback: use the last ripple origin (defaults to center if none).
        triggerRippleAtRendererPoint(app.renderer.width / 2, app.renderer.height / 2);
        return;
      }

      // Reset zoom to 10% with "0".
      if (!isTyping && (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0")) {
        e.preventDefault();
        resetZoomToTenPercent();
        return;
      }

      // Focus toggle with Space:
      // - toggles between focusing the selected element and the same zoom-out target as pressing "0"
      // NOTE: Space is a common "page scroll" key, so only trigger when pointer is over the canvas.
      if (!isTyping && canvasHoverRef.current && (e.code === "Space" || e.key === " " || e.key === "Spacebar")) {
        e.preventDefault();
        focusToggle({ requireHover: true });
        return;
      }

      if (isTyping) return;

      // Arrow-key navigation between objects (requires exactly 1 selected).
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const dir =
          e.key === "ArrowLeft"
            ? "left"
            : e.key === "ArrowRight"
              ? "right"
              : e.key === "ArrowUp"
                ? "up"
                : "down";
        navigateSelection(dir);
        return;
      }

      if (e.key !== "Backspace" && e.key !== "Delete") return;
      e.preventDefault();
      void deleteSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    const onResetZoom = () => resetZoomToTenPercent();
    const onFocusToggle = () => focusToggle({ requireHover: false });
    const onDeleteSelection = () => void deleteSelection();
    window.addEventListener("moondream:canvas:reset-zoom", onResetZoom as EventListener);
    window.addEventListener("moondream:canvas:focus-toggle", onFocusToggle as EventListener);
    window.addEventListener("moondream:canvas:delete-selection", onDeleteSelection as EventListener);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("moondream:canvas:reset-zoom", onResetZoom as EventListener);
      window.removeEventListener("moondream:canvas:focus-toggle", onFocusToggle as EventListener);
      window.removeEventListener("moondream:canvas:delete-selection", onDeleteSelection as EventListener);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initialize Pixi
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    if (appRef.current) return;

    const app = new PIXI.Application();
    appRef.current = app;

    (async () => {
      // Ensure the DOM behind the canvas matches the Pixi clear color.
      host.style.backgroundColor = WORKSPACE_BG_CSS;

      await app.init({
        resizeTo: host,
        background: WORKSPACE_BG_CSS,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      });
      host.appendChild(app.canvas);

      // Root container for the world. This stays in screen-space so we can apply screen-space
      // filters (like ripple) without having filter bounds explode due to panning/zooming.
      const worldRoot = new PIXI.Container();
      worldRootRef.current = worldRoot;
      // Constrain filter work to the visible viewport (renderer/screen space).
      worldRoot.filterArea = app.screen;
      app.stage.addChild(worldRoot);

      const world = new PIXI.Container();
      world.sortableChildren = true;
      worldRef.current = world;
      worldRoot.addChild(world);

      // WebGL ripple filter (triggered on drop + "r" shortcut).
      // Note: We only provide the WebGL program. If Pixi ever runs via WebGPU here, this effect will be skipped.
      const rippleVertex = `in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;

    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}`;

      const rippleFragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;

uniform float uTime;
uniform vec2 uCenter;     // 0..1 within filterArea (screen-space)
uniform float uAmplitude; // UV offset scale
uniform float uFrequency; // wave frequency
uniform float uSpeed;     // ring expansion speed (in UV/sec)
uniform float uWidth;     // ring thickness (in UV)
uniform float uDecay;     // spatial decay
uniform float uAspect;    // width/height
uniform float uShapeAspect;   // image aspect (w/h) for elliptical ripples
uniform float uShapeRotation; // radians (align ellipse to image rotation)
uniform float uDuration;  // seconds

float heightAt(float dist, float radius, float w, float timeFade, float distFade)
{
    float x = dist - radius;

    // Front band: a smooth "impact ring".
    float frontBand = exp(-(x * x) / (w * w));

    // Behind band: trailing ripples that decay behind the front.
    float behindBand = step(x, 0.0) * exp(x / (w * 2.0));

    // Ahead of the front, fade out quickly.
    float aheadFade = smoothstep(w * 3.0, 0.0, x);

    float band = (0.25 * frontBand + 0.75 * behindBand) * aheadFade;

    // Two harmonics reads as "watery" vs a single sine.
    float phase = x * uFrequency;
    float wave = sin(phase) + 0.35 * sin(phase * 2.15 + 1.3);

    // Global gain (keeps the effect subtle even with higher frequency content).
    return wave * band * timeFade * distFade * 0.35;
}

void main()
{
    vec2 uv = vTextureCoord;
    vec2 pUv = uv - uCenter;
    // Convert to screen-corrected space (so circles are circles on screen).
    vec2 pScreen = pUv;
    pScreen.x *= uAspect;

    // Rotate into the image-aligned frame.
    float cs = cos(uShapeRotation);
    float sn = sin(uShapeRotation);
    mat2 rot = mat2(cs, -sn, sn, cs);
    vec2 pr = rot * pScreen;

    // Elliptical metric based on the image aspect ratio (w/h).
    float sAspect = max(uShapeAspect, 0.0001);
    vec2 pm = vec2(pr.x / sAspect, pr.y);
    float dist = length(pm);

    float timeFade = clamp(1.0 - (uTime / max(uDuration, 0.001)), 0.0, 1.0);
    float distFade = exp(-uDecay * dist);

    float radius = uTime * uSpeed;
    float w = max(uWidth, 0.0005);

    // Radial direction in UV space for an ellipse:
    // - compute direction in metric space (pm), then map back to UV.
    vec2 dm = dist > 0.00001 ? (pm / dist) : vec2(0.0, 0.0);
    vec2 dr = vec2(dm.x * sAspect, dm.y); // undo metric scaling (back to rotated screen space)
    mat2 rotInv = mat2(cs, sn, -sn, cs);
    vec2 dScreen = rotInv * dr;
    vec2 dir = dScreen;
    dir.x /= max(uAspect, 0.00001);
    float dirLen = length(dir);
    dir = dirLen > 0.00001 ? (dir / dirLen) : vec2(0.0, 0.0);

    // Finite-difference slope -> "refraction normal" feel.
    float eps = 0.004;
    float h0 = heightAt(dist, radius, w, timeFade, distFade);
    float h1 = heightAt(dist + eps, radius, w, timeFade, distFade);
    float h2 = heightAt(max(0.0, dist - eps), radius, w, timeFade, distFade);
    float dh = (h1 - h2) / (2.0 * eps);
    float dhClamped = clamp(dh, -1.0, 1.0);
    float hClamped = clamp(h0, -1.0, 1.0);

    // Refraction: use slope + a tiny rotational component.
    vec2 perp = vec2(-dir.y, dir.x);
    vec2 disp = (dir * dhClamped + perp * (hClamped * 0.08)) * uAmplitude;

    vec2 uv2 = uv + disp;
    uv2 = clamp(uv2, vec2(0.0), vec2(1.0));

    finalColor = texture(uTexture, uv2);
}`;

      const rippleUniforms = new PIXI.UniformGroup({
        uTime: { value: 0, type: "f32" },
        uCenter: { value: new PIXI.Point(0.5, 0.5), type: "vec2<f32>" },
        // Slower + smoother: softer refraction, lower-frequency waves, wider ring band.
        uAmplitude: { value: 0.0026, type: "f32" },
        uFrequency: { value: 28.0, type: "f32" },
        uSpeed: { value: 0.36, type: "f32" },
        uWidth: { value: 0.18, type: "f32" },
        uDecay: { value: 1.4, type: "f32" },
        uAspect: { value: 1.0, type: "f32" },
        uShapeAspect: { value: 1.0, type: "f32" },
        uShapeRotation: { value: 0.0, type: "f32" },
        uDuration: { value: 1.85, type: "f32" },
      }) as unknown as RippleUniformGroup;

      const rippleFilter = new PIXI.Filter({
        glProgram: PIXI.GlProgram.from({
          vertex: rippleVertex,
          fragment: rippleFragment,
          name: "workspace-ripple-filter",
        }),
        resources: {
          rippleUniforms,
        },
        padding: 0,
      });

      rippleRef.current = {
        filter: rippleFilter,
        uniforms: rippleUniforms,
        active: false,
        timeSec: 0,
      };

      // Offscreen preview renderer state (used for project thumbnails)
      const previewRoot = new PIXI.Container();
      const previewContent = new PIXI.Container();
      previewRoot.addChild(previewContent);
      const rt = PIXI.RenderTexture.create({ width: 256, height: 256, resolution: 1 });
      previewRef.current = { rt, root: previewRoot, content: previewContent, spriteById: new Map() };

      // Restore last viewport for this project (pan + zoom)
      const iv = initialViewOverrideRef.current ?? initialView;
      if (iv) {
        world.position.set(iv.world_x, iv.world_y);
        const z = Number.isFinite(iv.zoom) ? iv.zoom : 1;
        world.scale.set(clamp(z, MIN_ZOOM, MAX_ZOOM));
      }

      // Minimap overlay (screen-space)
      const minimapW = MINIMAP_W;
      const minimapH = MINIMAP_H;
      const minimapMargin = MINIMAP_MARGIN;
      const minimapContainer = new PIXI.Container();
      minimapContainer.eventMode = "none";
      minimapContainer.visible = false;
      minimapContainer.alpha = 0;
      app.stage.addChild(minimapContainer);

      const minimapBg = new PIXI.Graphics();
      redrawMinimapBackground(minimapBg, minimapThemeRef.current);
      minimapContainer.addChild(minimapBg);

      // Clip (overflow hidden) so the viewport outline can't render outside the minimap box.
      const minimapClipMask = new PIXI.Graphics();
      minimapClipMask.roundRect(0, 0, minimapW, minimapH, MINIMAP_RADIUS);
      minimapClipMask.fill(0xffffff);
      // NOTE: In Pixi v8, `visible=false` on a geometry mask can prevent the mask from applying.
      // Keep it visible; it won't show up as a drawable layer, but it will correctly clip children.
      minimapClipMask.visible = true;
      minimapContainer.addChild(minimapClipMask);

      const minimapClipLayer = new PIXI.Container();
      minimapClipLayer.mask = minimapClipMask;
      minimapContainer.addChild(minimapClipLayer);

      // Layer order inside the minimap:
      // 1) item sprites (preview)
      // 2) shade outside viewport (helps show what is visible)
      // 3) overlay (optional outlines)
      // 4) viewport border
      const minimapItems = new PIXI.Container();
      minimapClipLayer.addChild(minimapItems);

      const minimapShade = new PIXI.Graphics();
      minimapClipLayer.addChild(minimapShade);

      const minimapOverlay = new PIXI.Graphics();
      minimapClipLayer.addChild(minimapOverlay);

      const minimapViewport = new PIXI.Graphics();
      minimapClipLayer.addChild(minimapViewport);

      minimapRef.current = {
        container: minimapContainer,
        bg: minimapBg,
        items: minimapItems,
        spriteById: new Map(),
        shade: minimapShade,
        overlay: minimapOverlay,
        viewport: minimapViewport,
        showUntilMs: 0,
        targetAlpha: 0,
      };

      // Ensure the minimap background matches the configured theme.
      redrawMinimapBackground(minimapBg, minimapThemeRef.current);

      // Selection overlay layer
      const selectionLayer = new PIXI.Container();
      selectionLayer.zIndex = 1_000_000_000;
      selectionLayerRef.current = selectionLayer;
      world.addChild(selectionLayer);

      const selectionBox = new PIXI.Graphics();
      selectionBoxRef.current = selectionBox;
      selectionLayer.addChild(selectionBox);

      const multiSel = new PIXI.Graphics();
      multiSel.eventMode = "none";
      // Ensure multi-select outlines render above sprites (but below single-select handles).
      multiSel.zIndex = 999_999_999;
      multiSelectionRef.current = multiSel;
      world.addChild(multiSel);

      const makeHandle = (corner: "tl" | "tr" | "br" | "bl") => {
        const g = new PIXI.Graphics();
        g.eventMode = "static";
        g.cursor = "nwse-resize";
        (g as any).__handle = { corner };
        selectionLayer.addChild(g);
        return g;
      };
      handleRefs.current = {
        tl: makeHandle("tl"),
        tr: makeHandle("tr"),
        br: makeHandle("br"),
        bl: makeHandle("bl"),
      };

      // Basic pan/zoom controls + move/resize gestures
      let last = new PIXI.Point(0, 0);

      const screenToRendererPoint = (clientX: number, clientY: number) => {
        const rect = app.canvas.getBoundingClientRect();
        const x = ((clientX - rect.left) * app.renderer.width) / rect.width;
        const y = ((clientY - rect.top) * app.renderer.height) / rect.height;
        return new PIXI.Point(x, y);
      };

      const screenToWorld = (p: PIXI.Point) => {
        return world.toLocal(p);
      };

      const handleLocalPoints = (w: number, h: number) => ({
        tl: new PIXI.Point(-w / 2, -h / 2),
        tr: new PIXI.Point(w / 2, -h / 2),
        br: new PIXI.Point(w / 2, h / 2),
        bl: new PIXI.Point(-w / 2, h / 2),
      });

      const oppositeCorner = (c: "tl" | "tr" | "br" | "bl") => {
        if (c === "tl") return "br";
        if (c === "tr") return "bl";
        if (c === "br") return "tl";
        return "tr";
      };

      app.canvas.addEventListener("pointerdown", (e) => {
        canvasHoverRef.current = true;
        cancelViewAnimation();
        app.canvas.setPointerCapture(e.pointerId);
        // Avoid hover-preview sticking while dragging/gesturing.
        setHoveredVideoObjectId(null);
        last = screenToRendererPoint(e.clientX, e.clientY);
        const hit = app.renderer.events.rootBoundary.hitTest(last.x, last.y) as any;
        tapCandidateRef.current = {
          pointerId: e.pointerId,
          button: (e as PointerEvent).button ?? 0,
          startRx: last.x,
          startRy: last.y,
          moved: false,
          objectId: hit && !hit.__handle && hit.__objectId ? (hit.__objectId as string) : null,
          isHandle: !!(hit && hit.__handle),
          shift: (e as PointerEvent).shiftKey,
        };

        // Resize handle hit?
        const selectedId = selectedIdsRef.current.length === 1 ? selectedIdsRef.current[0] : null;
        if (hit && hit.__handle && selectedId) {
          const corner = hit.__handle.corner as "tl" | "tr" | "br" | "bl";
          const sp = spritesByObjectIdRef.current.get(selectedId);
          const baseW = sp?.texture?.orig?.width ?? 0;
          const baseH = sp?.texture?.orig?.height ?? 0;
          if (sp && baseW > 0 && baseH > 0) {
            const pts = handleLocalPoints(baseW, baseH);
            const fixedCorner = oppositeCorner(corner);
            const localHandle = pts[corner];
            const localFixed = pts[fixedCorner];
            const fixedWorld = new PIXI.Point(
              sp.position.x + sp.scale.x * localFixed.x,
              sp.position.y + sp.scale.y * localFixed.y
            );
            activeGestureRef.current = {
              kind: "resize",
              objectId: selectedId,
              corner,
              fixedWorld,
              localFixed,
              localHandle,
              baseW,
              baseH,
            };
            return;
          }
        }

        // Object hit?
        if (hit && hit.__objectId) {
          const objectId = hit.__objectId as string;
          const shift = (e as PointerEvent).shiftKey;

          // Compute the next selection immediately so we can also update z-order deterministically.
          const currentSel = selectedIdsRef.current ?? [];
          let nextSel: string[];
          if (shift) {
            const set = new Set(currentSel);
            if (set.has(objectId)) set.delete(objectId);
            else set.add(objectId);
            nextSel = Array.from(set);
          } else {
            nextSel = [objectId];
          }
          setSelectedIds(nextSel);

          // Bring selected to front: selected get highest z_index, everyone else shifts down.
          setObjects((prev) => {
            const next = normalizeZOrder(prev, nextSel);
            scheduleEmitObjectsChange(next);
            scheduleSave(next);
            return next;
          });

          // Move all selected items (or just this one if none selected yet).
          const ids = selectedIdsRef.current;
          const moveIds =
            ids && ids.length > 0 && (shift ? true : ids.includes(objectId))
              ? ids.includes(objectId)
                ? ids
                : [objectId]
              : [objectId];
          activeGestureRef.current = { kind: "move", objectIds: nextSel.length ? nextSel : moveIds, last };
          // Lift the "card" shadow while dragging (animated smoothly in the ticker).
          setShadowLiftTarget(nextSel.length ? nextSel : moveIds, 1);
          return;
        }

        // Background pan
        if (!(e as PointerEvent).shiftKey) setSelectedIds([]);
        activeGestureRef.current = { kind: "pan", last };
      });

      app.canvas.addEventListener("pointermove", (e) => {
        canvasHoverRef.current = true;
        const cur = screenToRendererPoint(e.clientX, e.clientY);
        const cand = tapCandidateRef.current;
        if (cand && cand.pointerId === e.pointerId && !cand.moved) {
          const dx = cur.x - cand.startRx;
          const dy = cur.y - cand.startRy;
          if (Math.hypot(dx, dy) > TAP_MAX_MOVE_PX) cand.moved = true;
        }
        const gesture = activeGestureRef.current;
        if (!gesture) {
          const hit = app.renderer.events.rootBoundary.hitTest(cur.x, cur.y) as any;
          if (hit && hit.__handle) {
            setHoveredVideoObjectId(null);
            return;
          }
          const objectId = (hit && hit.__objectId ? (hit.__objectId as string) : null) ?? null;
          if (objectId && videoObjectIdsRef.current.has(objectId)) {
            setHoveredVideoObjectId(objectId);
          } else {
            setHoveredVideoObjectId(null);
          }
          return;
        }

        if (gesture.kind === "pan") {
          showMinimap();
          const dx = cur.x - gesture.last.x;
          const dy = cur.y - gesture.last.y;
          world.position.x += dx;
          world.position.y += dy;
          activeGestureRef.current = { kind: "pan", last: cur };
          scheduleViewSave({
            world_x: world.position.x,
            world_y: world.position.y,
            zoom: world.scale.x,
          });
          return;
        }

        if (gesture.kind === "move") {
          const sprites = gesture.objectIds
            .map((id) => [id, spritesByObjectIdRef.current.get(id)] as const)
            .filter(([, sp]) => !!sp) as Array<[string, PIXI.Sprite]>;
          if (sprites.length === 0) return;
          const dx = cur.x - gesture.last.x;
          const dy = cur.y - gesture.last.y;
          const inv = 1 / (world.scale.x || 1);
          for (const [id, sp] of sprites) {
            sp.position.x += dx * inv;
            sp.position.y += dy * inv;

            const sh = shadowsByObjectIdRef.current.get(id);
            if (sh) {
              sh.position.x = sp.position.x;
              sh.position.y = sp.position.y;
            }
          }
          activeGestureRef.current = { kind: "move", objectIds: gesture.objectIds, last: cur };

          setObjects((prev) => {
            const byId = new Map<string, PIXI.Sprite>(sprites);
            const next = prev.map((o) => {
              const sp = byId.get(o.id);
              if (!sp) return o;
              return {
                ...o,
                x: sp.position.x,
                y: sp.position.y,
                updated_at: new Date().toISOString(),
              };
            });
            scheduleEmitObjectsChange(next);
            scheduleSave(next);
            return next;
          });
          return;
        }

        if (gesture.kind === "resize") {
          const sprite = spritesByObjectIdRef.current.get(gesture.objectId);
          if (!sprite) return;
          const worldPoint = screenToWorld(cur);
          const deltaWorldX = worldPoint.x - gesture.fixedWorld.x;
          const deltaWorldY = worldPoint.y - gesture.fixedWorld.y;
          const deltaLocalX = gesture.localHandle.x - gesture.localFixed.x;
          const deltaLocalY = gesture.localHandle.y - gesture.localFixed.y;

          let newScaleX = deltaWorldX / deltaLocalX;
          let newScaleY = deltaWorldY / deltaLocalY;

          // For images, keep aspect ratio (uniform scale) like a simple Figma corner drag.
          const s = Math.max(Math.abs(newScaleX), Math.abs(newScaleY));
          newScaleX = s;
          newScaleY = s;

          const minScale = 0.05;
          newScaleX = Math.max(minScale, newScaleX);
          newScaleY = Math.max(minScale, newScaleY);

          sprite.scale.set(newScaleX, newScaleY);
          // Keep fixed corner stable: fixedWorld = pos + scale * localFixed
          sprite.position.x = gesture.fixedWorld.x - newScaleX * gesture.localFixed.x;
          sprite.position.y = gesture.fixedWorld.y - newScaleY * gesture.localFixed.y;

          setObjects((prev) => {
            const next = prev.map((o) =>
              o.id === gesture.objectId
                ? {
                    ...o,
                    x: sprite.position.x,
                    y: sprite.position.y,
                    scale_x: sprite.scale.x,
                    scale_y: sprite.scale.y,
                    width: gesture.baseW * sprite.scale.x,
                    height: gesture.baseH * sprite.scale.y,
                    updated_at: new Date().toISOString(),
                  }
                : o
            );
            scheduleEmitObjectsChange(next);
            scheduleSave(next);
            return next;
          });
        }
      });

      app.canvas.addEventListener("pointerup", (e) => {
        // Drop shadow back to normal when releasing a drag.
        const g = activeGestureRef.current;
        if (g && g.kind === "move") {
          setShadowLiftTarget(g.objectIds, 0);
        }
        activeGestureRef.current = null;
        schedulePreviewSave();

        const cand = tapCandidateRef.current;
        tapCandidateRef.current = null;
        if (!cand) return;
        if (cand.moved) return;
        if (cand.button !== 0) return;
        if (cand.shift) return;
        if (!cand.objectId) return;
      });

      app.canvas.addEventListener("wheel", (e) => {
        canvasHoverRef.current = true;
        cancelViewAnimation();
        e.preventDefault();
        showMinimap();
        const mouse = screenToRendererPoint(e.clientX, e.clientY);
        const before = screenToWorld(mouse);
        const direction = e.deltaY > 0 ? -1 : 1;

        // Faster zoom, but still smooth:
        // - scale factor based on scroll intensity (trackpad vs wheel)
        // - easing near min/max is handled below via smoothstep01(t)
        const deltaY =
          e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
        const step = clamp(Math.abs(deltaY) / 100, 0.35, 6);
        const zoomBase = 1.16; // increase for faster zoom out/in
        const factor = Math.pow(zoomBase, direction * step);
        // Ease into zoom limits (rubber-band resistance near the ends).
        // Max zoom-in is 100% (1.0). Allow zooming out to 1% (0.01).
        const minZoom = MIN_ZOOM;
        const maxZoom = MAX_ZOOM;
        const current = world.scale.x;
        const desired = current * factor;
        const range = Math.max(1e-6, maxZoom - minZoom);

        const t =
          factor > 1
            ? (maxZoom - current) / range // zooming in: remaining distance to max
            : (current - minZoom) / range; // zooming out: remaining distance to min
        const eased = smoothstep01(t);
        const nextScale = clamp(current + (desired - current) * eased, minZoom, maxZoom);
        world.scale.set(nextScale);
        const after = screenToWorld(mouse);
        world.position.x += (after.x - before.x) * world.scale.x;
        world.position.y += (after.y - before.y) * world.scale.y;
        scheduleViewSave({
          world_x: world.position.x,
          world_y: world.position.y,
          zoom: world.scale.x,
        });
        schedulePreviewSave();
      }, { passive: false });

      // Disable context menu on canvas
      app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

      // If cursor leaves the canvas entirely, stop any hover previews.
      app.canvas.addEventListener("pointerenter", () => {
        canvasHoverRef.current = true;
      });
      app.canvas.addEventListener("pointerleave", () => {
        canvasHoverRef.current = false;
        setHoveredVideoObjectId(null);
      });

      // Double click on an image => open fullscreen viewer with metadata.
      // We keep this lightweight and non-invasive: it doesn't change selection or z-order.
      app.canvas.addEventListener("dblclick", (e) => {
        // Avoid opening while a gesture is active (e.g. drag/resize).
        if (activeGestureRef.current) return;

        const p = screenToRendererPoint(e.clientX, e.clientY);
        const hit = app.renderer.events.rootBoundary.hitTest(p.x, p.y) as any;
        if (!hit) return;
        if (hit.__handle) return;
        const objectId = hit.__objectId as string | undefined;
        if (!objectId) return;

        const o = objectsRef.current.find((x) => x.id === objectId);
        if (!o || o.type !== "image" || !o.asset_id) return;

        // Only open fullscreen when already reasonably zoomed in; otherwise treat dblclick as a focus-zoom.
        const world = worldRef.current;
        const currentZoom = world?.scale.x || 1;
        const sp = spritesByObjectIdRef.current.get(objectId);
        const fitZoom = sp
          ? fitZoomForSprite(sp, app.renderer.width, app.renderer.height, FOCUS_FIT_SCREEN_FRACTION) ?? null
          : null;
        const openThreshold = fitZoom ? clamp(fitZoom * FULLSCREEN_DBLCLICK_FIT_FACTOR, 0.25, 0.75) : 0.35;
        if (currentZoom < openThreshold) {
          // Don't auto-zoom on double click when zoomed out.
          // Zooming in is done explicitly via Space (focus toggle) to avoid surprising jumps.
          return;
        }

        // Compute the clicked sprite rect in *CSS pixels* so the lightbox can do a FLIP transition.
        const rect = app.canvas.getBoundingClientRect();
        let origin: { left: number; top: number; width: number; height: number } | null = null;
        if (sp && rect.width > 0 && rect.height > 0 && app.renderer.width > 0 && app.renderer.height > 0) {
          try {
            // `getBounds()` returns global (stage) bounds in renderer coordinates.
            const b = sp.getBounds();
            const left = rect.left + (b.x / app.renderer.width) * rect.width;
            const top = rect.top + (b.y / app.renderer.height) * rect.height;
            const width = (b.width / app.renderer.width) * rect.width;
            const height = (b.height / app.renderer.height) * rect.height;
            if (
              Number.isFinite(left) &&
              Number.isFinite(top) &&
              Number.isFinite(width) &&
              Number.isFinite(height) &&
              width > 2 &&
              height > 2
            ) {
              origin = { left, top, width, height };
            }
          } catch {
            origin = null;
          }
        }

        setLightboxOriginRect(origin);
        setLightboxAssetId(o.asset_id);
      });

      const updateSelectionOverlay = () => {
        const selectionLayer = selectionLayerRef.current;
        const selectionBox = selectionBoxRef.current;
        if (!selectionLayer || !selectionBox) return;
        const handles = handleRefs.current as any;

        const selected = selectedIdsRef.current;
        const selectedId = selected.length === 1 ? selected[0] : null;
        const sprite = selectedId ? spritesByObjectIdRef.current.get(selectedId) : null;
        const baseW = sprite?.texture?.orig?.width ?? 0;
        const baseH = sprite?.texture?.orig?.height ?? 0;
        if (!sprite || baseW <= 0 || baseH <= 0) {
          selectionLayer.visible = false;
          return;
        }

        selectionLayer.visible = true;
        selectionLayer.position.set(sprite.position.x, sprite.position.y);
        selectionLayer.rotation = sprite.rotation;
        selectionLayer.scale.set(sprite.scale.x, sprite.scale.y);

        // Make the selection affordances readable when zoomed out:
        // - Compute a desired thickness in *screen px* that grows as you zoom out.
        // - Convert that into local stroke widths by dividing out world zoom and sprite scale.
        const world = worldRef.current;
        const worldZoom = world?.scale?.x || 1;
        const safeWorldZoom = Math.max(0.0001, worldZoom);
        const safeSpriteScale = Math.max(0.0001, Math.abs(sprite.scale.x) || 1);
        // Subtle scaling: a *small* boost only when very zoomed out.
        // Map zoom ∈ [0.06 .. 0.18] to t ∈ [1 .. 0], then lerp sizes.
        const t = clamp((0.18 - safeWorldZoom) / (0.18 - 0.06), 0, 1);
        const strokePx = lerp(2.2, 3.2, t);
        const handlePx = lerp(9, 11, t);

        // Draw box in local coords, so it matches sprite transform.
        selectionBox.clear();
        selectionBox.rect(-baseW / 2, -baseH / 2, baseW, baseH);
        selectionBox.stroke({
          width: strokePx / (safeSpriteScale * safeWorldZoom),
          color: 0x60a5fa,
          alpha: 0.9,
        });

        const handleSize = handlePx / (safeSpriteScale * safeWorldZoom);
        const pts = handleLocalPoints(baseW, baseH);
        for (const key of ["tl", "tr", "br", "bl"] as const) {
          const h = handles[key] as PIXI.Graphics | undefined;
          if (!h) continue;
          h.clear();
          h.rect(pts[key].x - handleSize / 2, pts[key].y - handleSize / 2, handleSize, handleSize);
          h.fill(0xf8fafc);
          h.stroke({ width: 1.25 / (safeSpriteScale * safeWorldZoom), color: 0x1f2937, alpha: 0.9 });
          (h as any).__handle = { corner: key };
        }
      };

      const updateMultiSelection = () => {
        const g = multiSelectionRef.current;
        if (!g) return;
        const selected = selectedIdsRef.current;
        if (!selected || selected.length <= 1) {
          g.clear();
          return;
        }
        const worldScale = world.scale.x || 1;
        const strokeW = 2 / Math.max(0.0001, worldScale);
        const glowW = 6 / Math.max(0.0001, worldScale);
        const pad = 2 / Math.max(0.0001, worldScale);
        g.clear();
        for (const id of selected) {
          const sp = spritesByObjectIdRef.current.get(id);
          if (!sp) continue;
          const w = sp.texture?.orig?.width ?? 0;
          const h = sp.texture?.orig?.height ?? 0;
          if (w <= 0 || h <= 0) continue;
          const hw = (w * sp.scale.x) / 2 + pad;
          const hh = (h * sp.scale.y) / 2 + pad;

          const cos = Math.cos(sp.rotation);
          const sin = Math.sin(sp.rotation);
          const rot = (x: number, y: number) => ({
            x: sp.position.x + x * cos - y * sin,
            y: sp.position.y + x * sin + y * cos,
          });

          const p1 = rot(-hw, -hh);
          const p2 = rot(hw, -hh);
          const p3 = rot(hw, hh);
          const p4 = rot(-hw, hh);

          // Glow stroke
          g.lineStyle(glowW, THEME_ACCENT, 0.22);
          g.moveTo(p1.x, p1.y);
          g.lineTo(p2.x, p2.y);
          g.lineTo(p3.x, p3.y);
          g.lineTo(p4.x, p4.y);
          g.lineTo(p1.x, p1.y);

          // Main stroke
          g.lineStyle(strokeW, THEME_ACCENT, 0.98);
          g.moveTo(p1.x, p1.y);
          g.lineTo(p2.x, p2.y);
          g.lineTo(p3.x, p3.y);
          g.lineTo(p4.x, p4.y);
          g.lineTo(p1.x, p1.y);
        }
      };

      const showMinimap = () => {
        const mm = minimapRef.current;
        if (!mm) return;
        const now = performance.now();
        mm.showUntilMs = now + 2500;
        mm.targetAlpha = 1;
        mm.container.visible = true;
      };

      const updateMinimap = () => {
        const mm = minimapRef.current;
        if (!mm) return;

        // Position in screen space (renderer coordinates)
        mm.container.position.set(
          app.renderer.width - minimapW - minimapMargin,
          app.renderer.height - minimapH - minimapMargin
        );

        const now = performance.now();
        if (now > mm.showUntilMs) mm.targetAlpha = 0;

        // Fade in/out smoothly.
        const fadeSpeed = 0.18;
        mm.container.alpha += (mm.targetAlpha - mm.container.alpha) * fadeSpeed;
        if (mm.container.alpha < 0.02 && mm.targetAlpha === 0) {
          mm.container.visible = false;
          return;
        }
        if (!mm.container.visible) return;

        const topLeftWorld = world.toLocal(new PIXI.Point(0, 0));
        const bottomRightWorld = world.toLocal(
          new PIXI.Point(app.renderer.width, app.renderer.height)
        );
        // Minimap bounds are always viewport + objects union.
        let minX = Math.min(topLeftWorld.x, bottomRightWorld.x);
        let maxX = Math.max(topLeftWorld.x, bottomRightWorld.x);
        let minY = Math.min(topLeftWorld.y, bottomRightWorld.y);
        let maxY = Math.max(topLeftWorld.y, bottomRightWorld.y);

        for (const sp of spritesByObjectIdRef.current.values()) {
          const w = sp.texture?.orig?.width ?? 0;
          const h = sp.texture?.orig?.height ?? 0;
          if (w <= 0 || h <= 0) continue;
          const hw = (w / 2) * sp.scale.x;
          const hh = (h / 2) * sp.scale.y;
          minX = Math.min(minX, sp.position.x - hw);
          maxX = Math.max(maxX, sp.position.x + hw);
          minY = Math.min(minY, sp.position.y - hh);
          maxY = Math.max(maxY, sp.position.y + hh);
        }

        const pad = MINIMAP_PAD;
        const innerW = minimapW - pad * 2;
        const innerH = minimapH - pad * 2;

        // Add a little world padding so dots and viewport aren't flush to edges.
        const worldPad = Math.max(10, Math.max(maxX - minX, maxY - minY) * 0.06);
        minX -= worldPad;
        maxX += worldPad;
        minY -= worldPad;
        maxY += worldPad;

        const worldW = Math.max(1, maxX - minX);
        const worldH = Math.max(1, maxY - minY);

        const s = Math.min(innerW / worldW, innerH / worldH);
        const offsetX = pad + (innerW - worldW * s) / 2;
        const offsetY = pad + (innerH - worldH * s) / 2;

        const wxToMx = (x: number) => offsetX + (x - minX) * s;
        const wyToMy = (y: number) => offsetY + (y - minY) * s;

        // Draw items as a scaled preview of the canvas (same textures, scaled to match world size).
        const seen = new Set<string>();
        const selected = new Set(selectedIdsRef.current ?? []);
        for (const sp of spritesByObjectIdRef.current.values()) {
          const id = (sp as any).__objectId as string | undefined;
          if (!id) continue;
          const tex = sp.texture;
          const w = tex?.orig?.width ?? 0;
          const h = tex?.orig?.height ?? 0;
          if (w <= 0 || h <= 0) continue;
          seen.add(id);

          let mini = mm.spriteById.get(id);
          if (!mini) {
            mini = new PIXI.Sprite(tex);
            mini.anchor.set(0.5);
            mini.eventMode = "none";
            mm.items.addChild(mini);
            mm.spriteById.set(id, mini);
          } else if (mini.texture !== tex) {
            mini.texture = tex;
          }

          mini.position.set(wxToMx(sp.position.x), wyToMy(sp.position.y));
          mini.scale.set(sp.scale.x * s, sp.scale.y * s);
          mini.rotation = sp.rotation;
          mini.alpha = selected.has(id) ? 1 : 0.92;
        }

        // Remove minimap sprites for deleted objects
        for (const [id, mini] of mm.spriteById.entries()) {
          if (seen.has(id)) continue;
          mini.destroy({ children: false });
          mm.spriteById.delete(id);
        }

        // Optional overlay for selection outlines (helps when thumbnails are similar)
        mm.overlay.clear();
        if (selected.size > 0) {
          mm.overlay.lineStyle(2, 0xfbbf24, 0.95);
          for (const id of selected) {
            const sp = spritesByObjectIdRef.current.get(id);
            if (!sp) continue;
            const tex = sp.texture;
            const w = tex?.orig?.width ?? 0;
            const h = tex?.orig?.height ?? 0;
            if (w <= 0 || h <= 0) continue;
            const bw = w * sp.scale.x * s;
            const bh = h * sp.scale.y * s;
            const cx = wxToMx(sp.position.x);
            const cy = wyToMy(sp.position.y);
            mm.overlay.drawRect(cx - bw / 2, cy - bh / 2, bw, bh);
          }
        }

        // Draw viewport indication (what is visible)
        mm.viewport.clear();
        const vx0 = wxToMx(topLeftWorld.x);
        const vy0 = wyToMy(topLeftWorld.y);
        const vx1 = wxToMx(bottomRightWorld.x);
        const vy1 = wyToMy(bottomRightWorld.y);
        const rxRaw = Math.min(vx0, vx1);
        const ryRaw = Math.min(vy0, vy1);
        const rwRaw = Math.abs(vx1 - vx0);
        const rhRaw = Math.abs(vy1 - vy0);

        // Constrain viewport rect to the minimap inner bounds so stroke doesn't get clipped away.
        const innerX0 = pad;
        const innerY0 = pad;
        const innerX1 = pad + innerW;
        const innerY1 = pad + innerH;
        const x0 = clamp(rxRaw, innerX0, innerX1);
        const y0 = clamp(ryRaw, innerY0, innerY1);
        const x1 = clamp(rxRaw + rwRaw, innerX0, innerX1);
        const y1 = clamp(ryRaw + rhRaw, innerY0, innerY1);
        const rx = Math.min(x0, x1);
        const ry = Math.min(y0, y1);
        const rw = Math.max(0, Math.abs(x1 - x0));
        const rh = Math.max(0, Math.abs(y1 - y0));

        // Shade everything outside the viewport (makes the visible area obvious).
        mm.shade.clear();
        mm.shade.beginFill(0x000000, minimapShadeAlphaRef.current);
        // top
        mm.shade.drawRect(innerX0, innerY0, innerW, Math.max(0, ry - innerY0));
        // bottom
        mm.shade.drawRect(innerX0, ry + rh, innerW, Math.max(0, innerY1 - (ry + rh)));
        // left
        mm.shade.drawRect(innerX0, ry, Math.max(0, rx - innerX0), rh);
        // right
        mm.shade.drawRect(rx + rw, ry, Math.max(0, innerX1 - (rx + rw)), rh);
        mm.shade.endFill();

        // Theme-tinted visible area + theme border (square corners).
        mm.viewport.beginFill(THEME_ACCENT, 0.07);
        mm.viewport.drawRect(rx, ry, rw, rh);
        mm.viewport.endFill();

        // Thin border (1–2px) with a subtle glow. Draw inset so it doesn't get clipped by the mask.
        const stroke = 2;
        const glowStroke = stroke + 4;
        const glowInset = glowStroke / 2;
        const inset = stroke / 2;

        const glowW = Math.max(0, rw - glowStroke);
        const glowH = Math.max(0, rh - glowStroke);
        if (glowW > 0 && glowH > 0) {
          mm.viewport.lineStyle(glowStroke, THEME_ACCENT, 0.22);
          mm.viewport.drawRect(rx + glowInset, ry + glowInset, glowW, glowH);
        }

        const mainW = Math.max(0, rw - stroke);
        const mainH = Math.max(0, rh - stroke);
        if (mainW > 0 && mainH > 0) {
          mm.viewport.lineStyle(stroke, THEME_ACCENT, 1);
          mm.viewport.drawRect(rx + inset, ry + inset, mainW, mainH);
        }
      };

      app.ticker.add((ticker) => {
        // Drive ripple shader if active.
        const ripple = rippleRef.current;
        if (ripple && ripple.active) {
          ripple.timeSec += (ticker.deltaMS ?? 16.6667) / 1000;
          ripple.uniforms.uniforms.uTime = ripple.timeSec;
          ripple.uniforms.uniforms.uAspect =
            app.renderer.width / Math.max(1, app.renderer.height);

          const duration = Number(ripple.uniforms.uniforms.uDuration) || 1.0;
          if (ripple.timeSec >= duration) {
            ripple.active = false;
            ripple.timeSec = 0;
            // Remove the filter when inactive to preserve existing performance.
            if (worldRoot.filters && worldRoot.filters.includes(ripple.filter)) {
              worldRoot.filters = worldRoot.filters.filter((f) => f !== ripple.filter);
            }
            if (worldRoot.filters && worldRoot.filters.length === 0) {
              worldRoot.filters = [];
            }
          }
        }

        // Smooth view animation (used for focus/zoom shortcuts).
        const viewAnim = viewAnimRef.current;
        if (viewAnim) {
          const now = performance.now();
          const t = viewAnim.durationMs > 0 ? (now - viewAnim.startMs) / viewAnim.durationMs : 1;
          const e = easeInOut01(t);
          const nextZoom = lerp(viewAnim.from.zoom, viewAnim.to.zoom, e);
          world.scale.set(nextZoom);
          world.position.x = lerp(viewAnim.from.x, viewAnim.to.x, e);
          world.position.y = lerp(viewAnim.from.y, viewAnim.to.y, e);

          if (t >= 1) {
            viewAnimRef.current = null;
            viewAnim.onComplete?.();
          }
        }

        // Subtle shadow lift animation (card feels "alive" but not distracting).
        const animIds = animatingShadowIdsRef.current;
        if (animIds.size) {
          for (const id of [...animIds]) {
            const st = shadowLiftByObjectIdRef.current.get(id);
            if (!st) {
              animIds.delete(id);
              continue;
            }
            const diff = st.target - st.current;
            st.current += diff * SHADOW_ANIM_SMOOTHING;
            if (Math.abs(diff) < 0.001) {
              st.current = st.target;
              animIds.delete(id);
            }

            const sp = spritesByObjectIdRef.current.get(id);
            const sh = shadowsByObjectIdRef.current.get(id);
            if (!sp || !sh) continue;
            const w = sp.texture?.orig?.width ?? 0;
            const h = sp.texture?.orig?.height ?? 0;
            if (w <= 0 || h <= 0) continue;
            const r = Math.min(IMAGE_CORNER_RADIUS, w / 2, h / 2);
            drawSoftShadow(sh, w, h, r, st.current);
          }
        }

        updateSelectionOverlay();
        updateMultiSelection();
        updateMinimap();

        // Selected video playback: only the selected video plays, and it loops.
        const selectedId = selectedIdsRef.current.length === 1 ? selectedIdsRef.current[0] : null;
        const wantPlayId =
          selectedId && videoObjectIdsRef.current.has(selectedId) ? selectedId : null;
        const prevPlayId = playingSelectedVideoObjectIdRef.current;

        if (prevPlayId !== wantPlayId) {
          // Pause the previous selected video (if any).
          if (prevPlayId) {
            const vPrev = videoElByObjectIdRef.current.get(prevPlayId);
            if (vPrev) vPrev.pause();
          }
          playingSelectedVideoObjectIdRef.current = wantPlayId;
        }

        if (wantPlayId) {
          const v = videoElByObjectIdRef.current.get(wantPlayId) ?? null;
          if (v) {
            v.loop = true;
            // Throttle play() attempts to avoid spamming if the element isn't ready yet.
            const now = Date.now();
            const lastAttempt = Number(selectedVideoPlayAttemptAtMsRef.current.get(wantPlayId) ?? 0);
            if (v.paused && now - lastAttempt > 250) {
              selectedVideoPlayAttemptAtMsRef.current.set(wantPlayId, now);
              v.play().catch(() => {});
            }
          }
        }

        // Hover video preview: progress bar overlay while hovered.
        const hvId = hoveredVideoObjectIdRef.current;
        if (hvId) {
          const sp = spritesByObjectIdRef.current.get(hvId);
          const g = videoHoverOverlayByObjectIdRef.current.get(hvId);
          if (sp && g) {
            const w = Number(sp.texture?.orig?.width ?? 0);
            const h = Number(sp.texture?.orig?.height ?? 0);
            if (w > 0 && h > 0) {
              const v = videoElByObjectIdRef.current.get(hvId) ?? null;

              const dur = v && Number.isFinite(v.duration) ? Number(v.duration) : 0;
              const cur = v && Number.isFinite(v.currentTime) ? Number(v.currentTime) : 0;
              const ratio = dur > 0 ? clamp(cur / dur, 0, 1) : 0;

              const minDim = Math.min(w, h);
              const inset = clamp(minDim * 0.065, 10, 22);
              const barH = clamp(minDim * 0.045, 4, 10);
              const barW = Math.max(10, w - inset * 2);
              const x = -barW / 2;
              const y = h / 2 - inset - barH;
              const r = Math.min(barH / 2, 6);

              g.visible = true;
              g.clear();
              g.roundRect(x, y, barW, barH, r);
              g.fill({ color: 0x000000, alpha: 0.42 });
              g.roundRect(x, y, barW, barH, r);
              g.stroke({ width: 1, color: 0xffffff, alpha: 0.10 });

              const fillW = barW * ratio;
              if (fillW > 0.75) {
                const rFill = Math.min(r, fillW / 2);
                g.roundRect(x, y, fillW, barH, rFill);
                g.fill({ color: THEME_ACCENT, alpha: 0.92 });
              }
            } else {
              g.visible = false;
            }
          }
        }
      });

      // Initial render
      rebuildWorldSprites(world);
      // Seed a preview shortly after first paint.
      schedulePreviewSave();
    })();

    return () => {
      // Intentionally no destroy in MVP; Next dev fast-refresh can be noisy.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.projectId]);

  // Allow parent (cmdk) to request focus by object id.
  useEffect(() => {
    props.onFocusRequest?.((objectId: string) => {
      const world = worldRef.current;
      const app = appRef.current;
      if (!world || !app) return;
      const d = spritesByObjectIdRef.current.get(objectId) as PIXI.Sprite | undefined;
      if (!d) return;
      const p = d.position;
      // Zoom to fit (when possible), then center the object in view.
      const nextZoom =
        fitZoomForSprite(d, app.renderer.width, app.renderer.height, FOCUS_FIT_SCREEN_FRACTION) ??
        world.scale.x;
      setSelectedIds([objectId]);

      const endX = app.renderer.width / 2 - p.x * nextZoom;
      const endY = app.renderer.height / 2 - p.y * nextZoom;
      cancelViewAnimation();
      animateViewTo(
        { x: endX, y: endY, zoom: nextZoom },
        {
          durationMs: 340,
          onComplete: () => {
            const w2 = worldRef.current;
            if (!w2) return;
            scheduleViewSave({
              world_x: w2.position.x,
              world_y: w2.position.y,
              zoom: w2.scale.x,
            });
            schedulePreviewSave();
          },
        }
      );
    });

    props.onViewportCenterRequest?.(() => {
      const world = worldRef.current;
      const app = appRef.current;
      if (!world || !app) return { x: 0, y: 0 };
      const center = new PIXI.Point(app.renderer.width / 2, app.renderer.height / 2);
      const p = world.toLocal(center);
      return { x: p.x, y: p.y };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.projectId]);

  // Keep sprites in sync when objects/assets change
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;
    rebuildWorldSprites(world);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, assetById]);

  const rebuildWorldSprites = (world: PIXI.Container) => {
    const keep = new Set(objects.map((o) => o.id));
    for (const [id, display] of spritesByObjectIdRef.current.entries()) {
      if (!keep.has(id)) {
        display.destroy({ children: true });
        spritesByObjectIdRef.current.delete(id);
        videoElByObjectIdRef.current.delete(id);
        videoObjectIdsRef.current.delete(id);
        videoHoverOverlayByObjectIdRef.current.delete(id);
        shadowLiftByObjectIdRef.current.delete(id);
        animatingShadowIdsRef.current.delete(id);
      }
    }
    for (const [id, sh] of shadowsByObjectIdRef.current.entries()) {
      if (!keep.has(id)) {
        sh.destroy({ children: true });
        shadowsByObjectIdRef.current.delete(id);
        videoElByObjectIdRef.current.delete(id);
        videoObjectIdsRef.current.delete(id);
        videoHoverOverlayByObjectIdRef.current.delete(id);
        shadowLiftByObjectIdRef.current.delete(id);
        animatingShadowIdsRef.current.delete(id);
      }
    }

    for (const o of objects) {
      if (spritesByObjectIdRef.current.has(o.id)) {
        const d = spritesByObjectIdRef.current.get(o.id) as PIXI.Sprite;
        d.position.set(o.x, o.y);
        d.scale.set(o.scale_x, o.scale_y);
        d.rotation = o.rotation;
        d.zIndex = o.z_index;
        ensureRoundedSpriteMask(d);

        const sh = shadowsByObjectIdRef.current.get(o.id);
        if (sh) {
          sh.position.set(o.x, o.y);
          sh.scale.set(o.scale_x, o.scale_y);
          sh.rotation = o.rotation;
          sh.zIndex = o.z_index - 0.25;
          if (!shadowLiftByObjectIdRef.current.has(o.id)) {
            shadowLiftByObjectIdRef.current.set(o.id, { current: 0, target: 0 });
          }
        }
        continue;
      }

      if (o.type === "image" && o.asset_id) {
        const a = assetById.get(o.asset_id);
        if (!a) continue;

        // Shadow (sibling behind the sprite so the sprite's rounded mask doesn't clip it).
        const sh = new PIXI.Graphics();
        sh.eventMode = "none";
        sh.position.set(o.x, o.y);
        sh.scale.set(o.scale_x, o.scale_y);
        sh.rotation = o.rotation;
        sh.zIndex = o.z_index - 0.25;
        (sh as any).__objectId = o.id;
        shadowsByObjectIdRef.current.set(o.id, sh);
        shadowLiftByObjectIdRef.current.set(o.id, { current: 0, target: 0 });
        world.addChild(sh);

        const sp = new PIXI.Sprite(PIXI.Texture.EMPTY);
        sp.eventMode = "static";
        sp.cursor = "move";
        sp.anchor.set(0.5);
        sp.position.set(o.x, o.y);
        sp.scale.set(o.scale_x, o.scale_y);
        sp.rotation = o.rotation;
        sp.zIndex = o.z_index;
        (sp as any).__objectId = o.id;
        spritesByObjectIdRef.current.set(o.id, sp);
        world.addChild(sp);

        // Hover video preview: show progress bar while hovered.
        if (isVideoMime(a.mime_type)) {
          videoObjectIdsRef.current.add(o.id);

          const g = new PIXI.Graphics();
          g.eventMode = "none";
          g.visible = false;
          videoHoverOverlayByObjectIdRef.current.set(o.id, g);
          sp.addChild(g);
        } else {
          videoObjectIdsRef.current.delete(o.id);
        }

        const rawUrl = a.storage_url;
        const absUrl = rawUrl.startsWith("http")
          ? rawUrl
          : new URL(rawUrl, window.location.href).toString();

        const cached = textureCacheRef.current.get(absUrl);
        if (cached) {
          sp.texture = cached;
          ensureRoundedSpriteMask(sp);
          const v = extractHtmlVideoElementFromTexture(sp.texture);
          if (v) {
            videoElByObjectIdRef.current.set(o.id, v);
            // IMPORTANT: Never allow videos to autoplay just because they were loaded.
            // Only the selected video is allowed to play (handled in the ticker).
            try {
              const selectedId = selectedIdsRef.current.length === 1 ? selectedIdsRef.current[0] : null;
              if (selectedId !== o.id) {
                v.pause();
                // Best-effort reset to first frame (helps if the browser started playback briefly).
                if (Number.isFinite(v.currentTime) && v.currentTime !== 0) v.currentTime = 0;
                v.loop = false;
              }
            } catch {
              // ignore
            }
          } else {
            videoElByObjectIdRef.current.delete(o.id);
          }
          const w = sp.texture?.orig?.width ?? 0;
          const h = sp.texture?.orig?.height ?? 0;
          if (w > 0 && h > 0) {
            const r = Math.min(IMAGE_CORNER_RADIUS, w / 2, h / 2);
            drawSoftShadow(sh, w, h, r, shadowLiftByObjectIdRef.current.get(o.id)?.current ?? 0);
          }
          maybeTriggerPendingDropRipple(o.id, sp.texture);
          continue;
        }

        const existingPromise = texturePromiseRef.current.get(absUrl);
        const p =
          existingPromise ??
          PIXI.Assets.load(absUrl)
            .then((asset) => {
              // pixi assets can return different types; images should be Texture.
              const tex = asset as PIXI.Texture;
              textureCacheRef.current.set(absUrl, tex);
              return tex;
            })
            .catch((err) => {
              console.error("pixi_texture_load_failed", absUrl, err);
              throw err;
            })
            .finally(() => {
              texturePromiseRef.current.delete(absUrl);
            });

        texturePromiseRef.current.set(absUrl, p);
        p.then((tex) => {
          // Object might have been deleted; ensure sprite still exists.
          const cur = spritesByObjectIdRef.current.get(o.id);
          if (cur) {
            cur.texture = tex;
            ensureRoundedSpriteMask(cur);
            const v = extractHtmlVideoElementFromTexture(cur.texture);
            if (v) {
              videoElByObjectIdRef.current.set(o.id, v);
              // IMPORTANT: Never allow videos to autoplay just because they were loaded.
              // Only the selected video is allowed to play (handled in the ticker).
              try {
                const selectedId = selectedIdsRef.current.length === 1 ? selectedIdsRef.current[0] : null;
                if (selectedId !== o.id) {
                  v.pause();
                  if (Number.isFinite(v.currentTime) && v.currentTime !== 0) v.currentTime = 0;
                  v.loop = false;
                }
              } catch {
                // ignore
              }
            } else {
              videoElByObjectIdRef.current.delete(o.id);
            }
            const w = cur.texture?.orig?.width ?? 0;
            const h = cur.texture?.orig?.height ?? 0;
            if (w > 0 && h > 0) {
              const r = Math.min(IMAGE_CORNER_RADIUS, w / 2, h / 2);
              const shCur = shadowsByObjectIdRef.current.get(o.id);
              const lift = shadowLiftByObjectIdRef.current.get(o.id)?.current ?? 0;
              if (shCur) drawSoftShadow(shCur, w, h, r, lift);
            }
            maybeTriggerPendingDropRipple(o.id, cur.texture);
          }
        }).catch(() => {
          // leave placeholder; error already logged
        });
      }
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropError(null);
    const app = appRef.current;
    const world = worldRef.current;
    if (!app || !world) return;

    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;

    const rect = app.canvas.getBoundingClientRect();
    const rx = ((e.clientX - rect.left) * app.renderer.width) / rect.width;
    const ry = ((e.clientY - rect.top) * app.renderer.height) / rect.height;
    // Place dropped items in screen-space so stacking looks consistent regardless of zoom level.
    const STACK_STEP_PX = 28; // slight overlap while still revealing edges
    const STACK_GROUP_SIZE = 12; // prevent huge diagonal drift when dropping many files
    const STACK_GROUP_SHIFT_PX = 40; // shift each group so later items are still visible near the drop point
    const stepRx = (STACK_STEP_PX * app.renderer.width) / rect.width;
    const stepRy = (STACK_STEP_PX * app.renderer.height) / rect.height;
    const groupShiftRx = (STACK_GROUP_SHIFT_PX * app.renderer.width) / rect.width;
    const groupShiftRy = (STACK_GROUP_SHIFT_PX * app.renderer.height) / rect.height;

    const form = new FormData();
    for (const f of files) form.append("files", f, f.name);

    let res: Response;
    try {
      res = await fetch(`/api/projects/${props.projectId}/assets/upload`, {
        method: "POST",
        body: form,
      });
    } catch (err) {
      console.error("upload_failed(fetch)", err);
      setDropError("Upload failed (network). If you restarted dev server, refresh the page.");
      return;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("upload_failed(response)", res.status, text);
      setDropError(`Upload failed (${res.status}).`);
      return;
    }

    const data = (await res.json()) as { assets: AssetWithAi[] };
    const uploaded = data.assets || [];
    setAssets((prev) => {
      const next = [...uploaded, ...prev];
      // de-dupe by id
      const seen = new Set<string>();
      return next.filter((a) => {
        if (seen.has(a.id)) return false;
        seen.add(a.id);
        return true;
      });
    });

    const newIds = uploaded.map(() => uuid());
    if (newIds.length > 0) {
      pendingDropRippleRef.current = { objectId: newIds[0], rx, ry, fired: false };
    }
    const nowIso = new Date().toISOString();
    setObjects((prev) => {
      const next = [...prev];
      let z = prev.reduce((m, o) => Math.max(m, o.z_index), 0) + 1;
      for (let i = 0; i < uploaded.length; i++) {
        const a = uploaded[i]!;
        const idxInGroup = i % STACK_GROUP_SIZE;
        const group = Math.floor(i / STACK_GROUP_SIZE);
        const p = world.toLocal(
          new PIXI.Point(
            rx + idxInGroup * stepRx + group * groupShiftRx,
            ry + idxInGroup * stepRy + group * groupShiftRy,
          ),
        );
        next.push({
          id: newIds[i]!,
          project_id: props.projectId,
          type: "image",
          asset_id: a.id,
          x: p.x,
          y: p.y,
          scale_x: 1,
          scale_y: 1,
          rotation: 0,
          width: a.width ?? null,
          height: a.height ?? null,
          z_index: z++,
          props_json: null,
          created_at: nowIso,
          updated_at: nowIso,
        });
      }
      scheduleEmitObjectsChange(next);
      scheduleSave(next);
      return next;
    });
  };

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="relative h-full w-full"
    >
      <div
        ref={containerRef}
        className={
          "absolute inset-0 " + (booting ? "opacity-0 pointer-events-none" : "opacity-100")
        }
      />
      {showBootUi ? (
        <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center">
          <div className="rounded-xl border border-white/10 bg-black/60 px-4 py-3 text-sm text-zinc-200 backdrop-blur">
            {"Loading…"}
          </div>
        </div>
      ) : null}
      {!syncUi.online ? (
        <div className="pointer-events-none absolute right-4 top-4 z-50">
          <div
            className={
              "rounded-full border px-3 py-1 text-[11px] font-medium " +
              (!syncUi.online
                ? "border-red-900/50 bg-red-950/50 text-red-200"
                : "border-amber-900/40 bg-amber-950/35 text-amber-200")
            }
          >
            {"Offline"}
          </div>
        </div>
      ) : null}
      {dropError ? (
        <div className="pointer-events-none absolute left-1/2 top-10 -translate-x-1/2 rounded-lg border border-red-900/50 bg-red-950/60 px-3 py-2 text-xs text-red-200">
          {dropError}
        </div>
      ) : null}
      {lightboxAssetId && assetById.get(lightboxAssetId) ? (
        <AssetLightbox
          projectId={props.projectId}
          asset={assetById.get(lightboxAssetId)!}
          originRect={lightboxOriginRect}
          onClose={() => setLightboxAssetId(null)}
        />
      ) : null}
    </div>
  );
}


