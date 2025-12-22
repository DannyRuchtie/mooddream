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
  const selectedObjectIdRef = useRef<string | null>(null);
  const selectionLayerRef = useRef<PIXI.Container | null>(null);
  const selectionBoxRef = useRef<PIXI.Graphics | null>(null);
  const handleRefs = useRef<Record<string, PIXI.Graphics>>({});
  const minimapRef = useRef<{
    container: PIXI.Container;
    bg: PIXI.Graphics;
    content: PIXI.Graphics;
    viewport: PIXI.Graphics;
    hideAtMs: number;
    visible: boolean;
  } | null>(null);
  const activeGestureRef = useRef<
    | null
    | { kind: "pan"; last: PIXI.Point }
    | { kind: "move"; objectId: string; last: PIXI.Point }
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
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);

  useEffect(() => {
    selectedObjectIdRef.current = selectedObjectId;
  }, [selectedObjectId]);

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
      minimapContainer.alpha = 0.95;
      app.stage.addChild(minimapContainer);

      const minimapBg = new PIXI.Graphics();
      minimapBg.roundRect(0, 0, minimapW, minimapH, 10);
      minimapBg.fill({ color: 0x050505, alpha: 0.65 });
      minimapBg.stroke({ color: 0x27272a, width: 1, alpha: 0.9 });
      minimapContainer.addChild(minimapBg);

      // Clip (overflow hidden) so the viewport outline can't render outside the minimap box.
      const minimapClipMask = new PIXI.Graphics();
      minimapClipMask.roundRect(0, 0, minimapW, minimapH, 10);
      minimapClipMask.fill(0xffffff);
      minimapClipMask.visible = false;
      minimapContainer.addChild(minimapClipMask);

      const minimapClipLayer = new PIXI.Container();
      minimapClipLayer.mask = minimapClipMask;
      minimapContainer.addChild(minimapClipLayer);

      const minimapContent = new PIXI.Graphics();
      minimapClipLayer.addChild(minimapContent);

      const minimapViewport = new PIXI.Graphics();
      minimapClipLayer.addChild(minimapViewport);

      minimapRef.current = {
        container: minimapContainer,
        bg: minimapBg,
        content: minimapContent,
        viewport: minimapViewport,
        hideAtMs: 0,
        visible: false,
      };

      // Selection overlay layer
      const selectionLayer = new PIXI.Container();
      selectionLayer.zIndex = 1_000_000_000;
      selectionLayerRef.current = selectionLayer;
      world.addChild(selectionLayer);

      const selectionBox = new PIXI.Graphics();
      selectionBoxRef.current = selectionBox;
      selectionLayer.addChild(selectionBox);

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
        const selectedId = selectedObjectIdRef.current;
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
          setSelectedObjectId(objectId);
          activeGestureRef.current = { kind: "move", objectId, last };
          return;
        }

        // Background pan
        setSelectedObjectId(null);
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
          const sprite = spritesByObjectIdRef.current.get(gesture.objectId);
          if (!sprite) return;
          const dx = cur.x - gesture.last.x;
          const dy = cur.y - gesture.last.y;
          const inv = 1 / (world.scale.x || 1);
          sprite.position.x += dx * inv;
          sprite.position.y += dy * inv;
          activeGestureRef.current = { kind: "move", objectId: gesture.objectId, last: cur };

          setObjects((prev) => {
            const next = prev.map((o) =>
              o.id === gesture.objectId
                ? {
                    ...o,
                    x: sprite.position.x,
                    y: sprite.position.y,
                    updated_at: new Date().toISOString(),
                  }
                : o
            );
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

        const selectedId = selectedObjectIdRef.current;
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

      const showMinimap = () => {
        const mm = minimapRef.current;
        if (!mm) return;
        const now = performance.now();
        mm.hideAtMs = now + 1000; // hide after 1s idle
        if (!mm.visible) {
          mm.visible = true;
          mm.container.visible = true;
        }
      };

      const updateMinimap = () => {
        const mm = minimapRef.current;
        if (!mm) return;

        // Position in screen space (renderer coordinates)
        mm.container.position.set(
          app.renderer.width - minimapW - minimapMargin,
          app.renderer.height - minimapH - minimapMargin
        );

        if (!mm.visible) return;
        const now = performance.now();
        if (now > mm.hideAtMs) {
          mm.visible = false;
          mm.container.visible = false;
          return;
        }

        // Compute world bounds from sprites
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

        if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
          // Nothing to show yet
          mm.content.clear();
          mm.viewport.clear();
          return;
        }

        const pad = 10;
        const innerW = minimapW - pad * 2;
        const innerH = minimapH - pad * 2;

        const worldW = Math.max(1, maxX - minX);
        const worldH = Math.max(1, maxY - minY);

        const s = Math.min(innerW / worldW, innerH / worldH);
        const offsetX = pad + (innerW - worldW * s) / 2;
        const offsetY = pad + (innerH - worldH * s) / 2;

        const wxToMx = (x: number) => offsetX + (x - minX) * s;
        const wyToMy = (y: number) => offsetY + (y - minY) * s;

        // Draw objects as rectangles
        mm.content.clear();
        mm.content.stroke({ color: 0x3f3f46, width: 1, alpha: 0.9 });
        mm.content.fill({ color: 0x0f172a, alpha: 0.35 });

        for (const sp of spritesByObjectIdRef.current.values()) {
          const w = sp.texture?.orig?.width ?? 0;
          const h = sp.texture?.orig?.height ?? 0;
          if (w <= 0 || h <= 0) continue;
          const bw = w * sp.scale.x;
          const bh = h * sp.scale.y;
          const x0 = wxToMx(sp.position.x - bw / 2);
          const y0 = wyToMy(sp.position.y - bh / 2);
          mm.content.rect(x0, y0, bw * s, bh * s);
        }
        mm.content.fill();

        // Draw viewport rectangle (visible world region)
        mm.viewport.clear();
        const topLeftWorld = world.toLocal(new PIXI.Point(0, 0));
        const bottomRightWorld = world.toLocal(
          new PIXI.Point(app.renderer.width, app.renderer.height)
        );
        const vx0 = wxToMx(topLeftWorld.x);
        const vy0 = wyToMy(topLeftWorld.y);
        const vx1 = wxToMx(bottomRightWorld.x);
        const vy1 = wyToMy(bottomRightWorld.y);
        const vw = vx1 - vx0;
        const vh = vy1 - vy0;
        mm.viewport.rect(vx0, vy0, vw, vh);
        mm.viewport.stroke({ color: 0x60a5fa, width: 2, alpha: 0.95 });
      };

      app.ticker.add(() => {
        updateSelectionOverlay();
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
      setSelectedObjectId(objectId);
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


