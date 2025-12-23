"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as PIXI from "pixi.js";

import type { AssetWithAi, CanvasObjectRow } from "@/server/db/types";

function uuid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function smoothstep01(t: number) {
  const x = clamp(t, 0, 1);
  // Make the zoom easing a bit "faster" near the ends by never going all the way to 0.
  // (We still clamp zoom, so this won't overshoot.)
  const y = x * x * (3 - 2 * x);
  return 0.12 + 0.88 * y;
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
  onObjectsChange?: (objects: CanvasObjectRow[]) => void;
  onFocusRequest?: (fn: (objectId: string) => void) => void;
  onViewportCenterRequest?: (fn: () => { x: number; y: number }) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const worldRef = useRef<PIXI.Container | null>(null);
  const spritesByObjectIdRef = useRef<Map<string, PIXI.Sprite>>(new Map());
  const textureCacheRef = useRef<Map<string, PIXI.Texture>>(new Map());
  const texturePromiseRef = useRef<Map<string, Promise<PIXI.Texture>>>(new Map());
  const selectedIdsRef = useRef<string[]>([]);
  const selectionLayerRef = useRef<PIXI.Container | null>(null);
  const selectionBoxRef = useRef<PIXI.Graphics | null>(null);
  const handleRefs = useRef<Record<string, PIXI.Graphics>>({});
  const multiSelectionRef = useRef<PIXI.Graphics | null>(null);
  const minimapRef = useRef<{
    container: PIXI.Container;
    bg: PIXI.Graphics;
    items: PIXI.Container;
    spriteById: Map<string, PIXI.Sprite>;
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

  const [objects, setObjects] = useState<CanvasObjectRow[]>(props.initialObjects);
  const [assets, setAssets] = useState<AssetWithAi[]>(props.initialAssets);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dropError, setDropError] = useState<string | null>(null);

  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  useEffect(() => setAssets(props.initialAssets), [props.initialAssets]);
  useEffect(() => {
    setObjects(props.initialObjects);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.projectId]);

  // Debounced canvas persistence
  const saveTimer = useRef<number | null>(null);
  const viewSaveTimer = useRef<number | null>(null);
  const emitTimerRef = useRef<number | null>(null);
  const emitLatestRef = useRef<CanvasObjectRow[] | null>(null);

  // Avoid React warning: do not synchronously update parent state from inside Pixi event updates.
  // Coalesce into a future macrotask.
  const scheduleEmitObjectsChange = (next: CanvasObjectRow[]) => {
    if (!props.onObjectsChange) return;
    emitLatestRef.current = next;
    if (emitTimerRef.current) return;
    emitTimerRef.current = window.setTimeout(() => {
      emitTimerRef.current = null;
      const latest = emitLatestRef.current;
      emitLatestRef.current = null;
      if (latest) props.onObjectsChange?.(latest);
    }, 0);
  };

  const scheduleSave = (nextObjects: CanvasObjectRow[]) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      await fetch(`/api/projects/${props.projectId}/canvas`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objects: nextObjects }),
      }).catch(() => {});
    }, 250);
  };

  const scheduleViewSave = (view: { world_x: number; world_y: number; zoom: number }) => {
    if (viewSaveTimer.current) window.clearTimeout(viewSaveTimer.current);
    viewSaveTimer.current = window.setTimeout(async () => {
      await fetch(`/api/projects/${props.projectId}/view`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(view),
      }).catch(() => {});
    }, 250);
  };

  const assetById = useMemo(() => {
    const m = new Map<string, AssetWithAi>();
    for (const a of assets) m.set(a.id, a);
    return m;
  }, [assets]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const primarySelectedId = selectedIds.length === 1 ? selectedIds[0] : null;

  // Keyboard delete/backspace to remove selected objects from canvas + DB (via canvas save).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Backspace" && e.key !== "Delete") return;
      // Don't intercept when typing.
      const el = document.activeElement as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          (el as any).isContentEditable)
      ) {
        return;
      }
      const ids = selectedIdsRef.current;
      if (!ids || ids.length === 0) return;
      e.preventDefault();
      setSelectedIds([]);
      setObjects((prev) => {
        const remove = new Set(ids);
        const next = prev.filter((o) => !remove.has(o.id));
        scheduleEmitObjectsChange(next);
        scheduleSave(next);
        return next;
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
      await app.init({
        resizeTo: host,
        background: "#0a0a0a",
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
      });
      host.appendChild(app.canvas);

      const world = new PIXI.Container();
      world.sortableChildren = true;
      worldRef.current = world;
      app.stage.addChild(world);

      // Restore last viewport for this project (pan + zoom)
      if (props.initialView) {
        world.position.set(props.initialView.world_x, props.initialView.world_y);
        world.scale.set(props.initialView.zoom);
      }

      // Minimap overlay (screen-space)
      const minimapW = 220;
      const minimapH = 160;
      const minimapMargin = 12;
      const minimapContainer = new PIXI.Container();
      minimapContainer.eventMode = "none";
      minimapContainer.visible = false;
      minimapContainer.alpha = 0;
      app.stage.addChild(minimapContainer);

      const minimapBg = new PIXI.Graphics();
      minimapBg.roundRect(0, 0, minimapW, minimapH, 10);
      // Higher contrast minimap background.
      minimapBg.fill({ color: 0x09090b, alpha: 0.88 });
      minimapBg.stroke({ color: 0x52525b, width: 1, alpha: 0.95 });
      minimapContainer.addChild(minimapBg);

      // Clip (overflow hidden) so the viewport outline can't render outside the minimap box.
      const minimapClipMask = new PIXI.Graphics();
      minimapClipMask.roundRect(0, 0, minimapW, minimapH, 10);
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
      // 2) overlay (optional outlines)
      // 3) viewport border
      const minimapItems = new PIXI.Container();
      minimapClipLayer.addChild(minimapItems);

      const minimapOverlay = new PIXI.Graphics();
      minimapClipLayer.addChild(minimapOverlay);

      const minimapViewport = new PIXI.Graphics();
      minimapClipLayer.addChild(minimapViewport);

      minimapRef.current = {
        container: minimapContainer,
        bg: minimapBg,
        items: minimapItems,
        spriteById: new Map(),
        overlay: minimapOverlay,
        viewport: minimapViewport,
        showUntilMs: 0,
        targetAlpha: 0,
      };

      // Selection overlay layer
      const selectionLayer = new PIXI.Container();
      selectionLayer.zIndex = 1_000_000_000;
      selectionLayerRef.current = selectionLayer;
      world.addChild(selectionLayer);

      const selectionBox = new PIXI.Graphics();
      selectionBoxRef.current = selectionBox;
      selectionLayer.addChild(selectionBox);

      const multiSel = new PIXI.Graphics();
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
        app.canvas.setPointerCapture(e.pointerId);
        last = screenToRendererPoint(e.clientX, e.clientY);
        const hit = app.renderer.events.rootBoundary.hitTest(last.x, last.y) as any;

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
          return;
        }

        // Background pan
        if (!(e as PointerEvent).shiftKey) setSelectedIds([]);
        activeGestureRef.current = { kind: "pan", last };
      });

      app.canvas.addEventListener("pointermove", (e) => {
        const gesture = activeGestureRef.current;
        if (!gesture) return;
        const cur = screenToRendererPoint(e.clientX, e.clientY);

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
          for (const [, sp] of sprites) {
            sp.position.x += dx * inv;
            sp.position.y += dy * inv;
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

      app.canvas.addEventListener("pointerup", () => {
        activeGestureRef.current = null;
      });

      app.canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        showMinimap();
        const mouse = screenToRendererPoint(e.clientX, e.clientY);
        const before = screenToWorld(mouse);
        const direction = e.deltaY > 0 ? -1 : 1;
        const factor = direction > 0 ? 1.1 : 0.9;
        // Ease into zoom limits (rubber-band resistance near the ends).
        // Max zoom-in is 100% (1.0). Allow zooming out to 5% (0.05).
        const minZoom = 0.05;
        const maxZoom = 1.0;
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
      }, { passive: false });

      // Disable context menu on canvas
      app.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

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

        // Draw box in local coords, so it matches sprite transform.
        selectionBox.clear();
        selectionBox.rect(-baseW / 2, -baseH / 2, baseW, baseH);
        selectionBox.stroke({ width: 2 / Math.max(0.0001, sprite.scale.x), color: 0x60a5fa, alpha: 0.9 });

        const handleSize = 10 / Math.max(0.0001, sprite.scale.x);
        const pts = handleLocalPoints(baseW, baseH);
        for (const key of ["tl", "tr", "br", "bl"] as const) {
          const h = handles[key] as PIXI.Graphics | undefined;
          if (!h) continue;
          h.clear();
          h.rect(pts[key].x - handleSize / 2, pts[key].y - handleSize / 2, handleSize, handleSize);
          h.fill(0xf8fafc);
          h.stroke({ width: 1 / Math.max(0.0001, sprite.scale.x), color: 0x1f2937, alpha: 0.9 });
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
        g.clear();
        g.lineStyle(strokeW, 0x60a5fa, 0.9);
        for (const id of selected) {
          const sp = spritesByObjectIdRef.current.get(id);
          if (!sp) continue;
          const w = sp.texture?.orig?.width ?? 0;
          const h = sp.texture?.orig?.height ?? 0;
          if (w <= 0 || h <= 0) continue;
          const bw = w * sp.scale.x;
          const bh = h * sp.scale.y;
          g.drawRect(sp.position.x - bw / 2, sp.position.y - bh / 2, bw, bh);
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

        const pad = 10;
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

        // Draw viewport rectangle (visible world region)
        mm.viewport.clear();
        const vx0 = wxToMx(topLeftWorld.x);
        const vy0 = wyToMy(topLeftWorld.y);
        const vx1 = wxToMx(bottomRightWorld.x);
        const vy1 = wyToMy(bottomRightWorld.y);
        const rx = Math.min(vx0, vx1);
        const ry = Math.min(vy0, vy1);
        const rw = Math.abs(vx1 - vx0);
        const rh = Math.abs(vy1 - vy0);
        // High-contrast viewport indicator (blue border)
        mm.viewport.lineStyle(3, 0x38bdf8, 1);
        mm.viewport.drawRect(rx, ry, rw, rh);
      };

      app.ticker.add(() => {
        updateSelectionOverlay();
        updateMultiSelection();
        updateMinimap();
      });

      // Initial render
      rebuildWorldSprites(world);
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
      // Center the object in view.
      world.position.x = app.renderer.width / 2 - p.x * world.scale.x;
      world.position.y = app.renderer.height / 2 - p.y * world.scale.y;
      setSelectedIds([objectId]);
      scheduleViewSave({
        world_x: world.position.x,
        world_y: world.position.y,
        zoom: world.scale.x,
      });
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
      }
    }

    for (const o of objects) {
      if (spritesByObjectIdRef.current.has(o.id)) {
        const d = spritesByObjectIdRef.current.get(o.id) as PIXI.Sprite;
        d.position.set(o.x, o.y);
        d.scale.set(o.scale_x, o.scale_y);
        d.rotation = o.rotation;
        d.zIndex = o.z_index;
        continue;
      }

      if (o.type === "image" && o.asset_id) {
        const a = assetById.get(o.asset_id);
        if (!a) continue;
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

        const rawUrl = a.storage_url;
        const absUrl = rawUrl.startsWith("http")
          ? rawUrl
          : new URL(rawUrl, window.location.href).toString();

        const cached = textureCacheRef.current.get(absUrl);
        if (cached) {
          sp.texture = cached;
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
          if (cur) cur.texture = tex;
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
    const worldPoint = world.toLocal(new PIXI.Point(rx, ry));

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

    setObjects((prev) => {
      const next = [...prev];
      let z = prev.reduce((m, o) => Math.max(m, o.z_index), 0) + 1;
      for (const a of uploaded) {
        next.push({
          id: uuid(),
          project_id: props.projectId,
          type: "image",
          asset_id: a.id,
          x: worldPoint.x,
          y: worldPoint.y,
          scale_x: 1,
          scale_y: 1,
          rotation: 0,
          width: a.width ?? null,
          height: a.height ?? null,
          z_index: z++,
          props_json: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
      scheduleEmitObjectsChange(next);
      scheduleSave(next);
      return next;
    });
  };

  return (
    <div
      ref={containerRef}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="h-full w-full"
    >
      {dropError ? (
        <div className="pointer-events-none absolute left-1/2 top-10 -translate-x-1/2 rounded-lg border border-red-900/50 bg-red-950/60 px-3 py-2 text-xs text-red-200">
          {dropError}
        </div>
      ) : null}
    </div>
  );
}


