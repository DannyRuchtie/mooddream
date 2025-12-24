"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AssetWithAi } from "@/server/db/types";

type Segment = {
  tag: string;
  svg: string | null;
  bboxJson: string | null;
  updatedAt: string;
};

type OriginRect = { left: number; top: number; width: number; height: number };

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function safeParseTagsJson(tagsJson: string | null): string[] {
  if (!tagsJson) return [];
  try {
    const parsed = JSON.parse(tagsJson) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((t) => String(t)).filter(Boolean);
  } catch {
    return [];
  }
}

function parseBoxesFromBboxJson(bboxJson: string | null) {
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
}

export function AssetLightbox(props: {
  projectId: string;
  asset: AssetWithAi;
  originRect?: OriginRect | null;
  onClose: () => void;
}) {
  const { asset, projectId, onClose } = props;
  const isVideo = !!asset.mime_type && asset.mime_type.startsWith("video/");
  const [entered, setEntered] = useState(false);
  const [animating, setAnimating] = useState<boolean>(!!props.originRect);
  const closingRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const openFinishTimerRef = useRef<number | null>(null);
  const [segments, setSegments] = useState<Segment[] | null>(null);
  const [selectedSegmentTag, setSelectedSegmentTag] = useState<string | null>(null);
  const [ghostStyle, setGhostStyle] = useState<React.CSSProperties | null>(null);
  const [ghostTransform, setGhostTransform] = useState<string>("translate(0px,0px) scale(1,1)");
  const targetRectRef = useRef<OriginRect | null>(null);

  const tags = useMemo(() => safeParseTagsJson(asset.ai_tags_json), [asset.ai_tags_json]);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imageFit, setImageFit] = useState<{
    // Pixel rect of the drawn image inside the <img> element box (object-fit: contain)
    offsetX: number;
    offsetY: number;
    drawW: number;
    drawH: number;
    scale: number;
  } | null>(null);

  const selectedSegment = useMemo(() => {
    if (!selectedSegmentTag) return null;
    return segments?.find((s) => s.tag === selectedSegmentTag) ?? null;
  }, [segments, selectedSegmentTag]);

  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 0);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      if (openFinishTimerRef.current) window.clearTimeout(openFinishTimerRef.current);
    };
  }, []);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;

    // Prevent the "open" finish timer from clobbering our close animation if the user closes quickly.
    if (openFinishTimerRef.current) {
      window.clearTimeout(openFinishTimerRef.current);
      openFinishTimerRef.current = null;
    }

    // Start fade/scale-out immediately.
    setEntered(false);

    const origin = props.originRect ?? null;

    // If we don't have an origin rect, keep existing behavior (fade out then unmount).
    if (!origin) {
      onClose();
      return;
    }

    const measureTarget = (): OriginRect | null => {
      const el = document.querySelector("[data-asset-lightbox-target='true']") as HTMLElement | null;
      if (!el) return targetRectRef.current;
      const r = el.getBoundingClientRect();
      if (!(r.width > 2 && r.height > 2)) return targetRectRef.current;
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    };

    const target = measureTarget();
    if (!target) {
      onClose();
      return;
    }

    // Hide the "real" image while we animate the ghost back.
    setAnimating(true);

    setGhostStyle({
      position: "fixed",
      left: target.left,
      top: target.top,
      width: target.width,
      height: target.height,
      zIndex: 10000,
      pointerEvents: "none",
      transition: "transform 240ms cubic-bezier(0.2, 0.9, 0.2, 1), opacity 140ms ease-out",
      transformOrigin: "center center",
      opacity: 1,
    });

    // Start at target.
    setGhostTransform("translate(0px, 0px) scale(1, 1)");

    const ocx = origin.left + origin.width / 2;
    const ocy = origin.top + origin.height / 2;
    const tcx = target.left + target.width / 2;
    const tcy = target.top + target.height / 2;
    const dx = ocx - tcx;
    const dy = ocy - tcy;
    const sx = origin.width / target.width;
    const sy = origin.height / target.height;

    // Then transition to origin transform on next frame.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setGhostTransform(`translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`));
    });

    // Unmount after the flip finishes (leave a small buffer vs CSS duration).
    closeTimerRef.current = window.setTimeout(() => onClose(), 260);
  }, [onClose, props.originRect]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [requestClose]);

  useEffect(() => {
    let cancelled = false;
    setSegments(null);
    setSelectedSegmentTag(null);
    fetch(`/api/projects/${projectId}/assets/${asset.id}/segments`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        const segs = (data?.segments as Segment[] | undefined) ?? null;
        setSegments(Array.isArray(segs) ? segs : []);
      })
      .catch(() => {
        if (cancelled) return;
        setSegments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [asset.id, projectId]);

  const recomputeImageFit = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;

    const cw = img.clientWidth;
    const ch = img.clientHeight;
    const nw = img.naturalWidth || asset.width || 0;
    const nh = img.naturalHeight || asset.height || 0;
    if (!(cw > 2 && ch > 2 && nw > 2 && nh > 2)) {
      setImageFit(null);
      return;
    }

    const s = Math.min(cw / nw, ch / nh);
    const drawW = nw * s;
    const drawH = nh * s;
    const offsetX = (cw - drawW) / 2;
    const offsetY = (ch - drawH) / 2;
    setImageFit({ offsetX, offsetY, drawW, drawH, scale: s });
  }, [asset.height, asset.width]);

  useEffect(() => {
    recomputeImageFit();
    const onResize = () => recomputeImageFit();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [recomputeImageFit]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img) return;
    const ro = new ResizeObserver(() => recomputeImageFit());
    ro.observe(img);
    return () => ro.disconnect();
  }, [recomputeImageFit]);

  // FLIP animation: animate from the clicked image rect -> final image container rect using CSS transitions.
  useEffect(() => {
    const origin = props.originRect ?? null;
    if (!origin) {
      setAnimating(false);
      setGhostStyle(null);
      return;
    }

    // Delay 1 tick so layout has painted and we can measure the final target.
    const t = window.setTimeout(() => {
      const el = document.querySelector("[data-asset-lightbox-target='true']") as HTMLElement | null;
      if (!el) {
        setAnimating(false);
        return;
      }
      const tr = el.getBoundingClientRect();
      if (!(tr.width > 2 && tr.height > 2)) {
        setAnimating(false);
        return;
      }

      const target: OriginRect = { left: tr.left, top: tr.top, width: tr.width, height: tr.height };
      targetRectRef.current = target;

      // Create a ghost layer *at the target position*, then transform it so it visually matches origin,
      // then transition transform back to identity.
      setGhostStyle({
        position: "fixed",
        left: target.left,
        top: target.top,
        width: target.width,
        height: target.height,
        zIndex: 10000,
        pointerEvents: "none",
        transition: "transform 240ms cubic-bezier(0.2, 0.9, 0.2, 1), opacity 140ms ease-out",
        transformOrigin: "center center",
        opacity: 1,
      });

      const ocx = origin.left + origin.width / 2;
      const ocy = origin.top + origin.height / 2;
      const tcx = target.left + target.width / 2;
      const tcy = target.top + target.height / 2;
      const dx = ocx - tcx;
      const dy = ocy - tcy;
      const sx = origin.width / target.width;
      const sy = origin.height / target.height;

      // Start at origin.
      setGhostTransform(`translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`);

      // Then transition to identity on next frame.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setGhostTransform("translate(0px, 0px) scale(1, 1)"));
      });

      // End animation.
      openFinishTimerRef.current = window.setTimeout(() => {
        setAnimating(false);
        setGhostStyle(null);
        openFinishTimerRef.current = null;
      }, 260);
    }, 0);

    return () => window.clearTimeout(t);
  }, [props.originRect, asset.id]);

  return (
    <div
      className={
        "fixed inset-0 z-[9999] bg-black transition-opacity duration-200 " +
        (entered ? "opacity-100" : "opacity-0")
      }
      onClick={() => requestClose()}
      aria-modal="true"
      role="dialog"
    >
      {ghostStyle ? (
        <div style={{ ...ghostStyle, transform: ghostTransform }}>
          {isVideo ? (
            <video
              src={asset.storage_url}
              className="h-full w-full object-contain"
              muted
              playsInline
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.storage_url}
              alt=""
              className="h-full w-full object-contain"
              draggable={false}
            />
          )}
        </div>
      ) : null}

      <div
        className={
          "flex h-full w-full flex-col md:flex-row md:gap-0 transition-transform duration-200 ease-out " +
          (entered ? "scale-100" : "scale-[0.985]")
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center p-4 md:p-8">
          <div className="relative h-full w-full max-w-[min(1100px,100%)]">
            {isVideo ? (
              <video
                data-asset-lightbox-target="true"
                src={asset.storage_url}
                controls
                playsInline
                className={"h-full w-full object-contain " + (animating ? "opacity-0" : "opacity-100")}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                data-asset-lightbox-target="true"
                ref={imgRef}
                src={asset.storage_url}
                alt={asset.original_name || "asset"}
                className={"h-full w-full object-contain " + (animating ? "opacity-0" : "opacity-100")}
                draggable={false}
                onLoad={() => recomputeImageFit()}
              />
            )}

            {/* Segment overlay (SVG preferred, bbox fallback) */}
            {!animating && selectedSegment && imageFit ? (
              <div className="pointer-events-none absolute inset-0">
                {selectedSegment.svg && selectedSegment.svg.trim().startsWith("<svg") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    alt=""
                    draggable={false}
                    src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(
                      selectedSegment.svg
                    )}`}
                    style={{
                      position: "absolute",
                      left: imageFit.offsetX,
                      top: imageFit.offsetY,
                      width: imageFit.drawW,
                      height: imageFit.drawH,
                      opacity: 0.22,
                      mixBlendMode: "screen",
                      filter: "drop-shadow(0px 0px 10px rgba(124, 58, 237, 0.65))",
                    }}
                  />
                ) : null}

                {parseBoxesFromBboxJson(selectedSegment.bboxJson).map((b, idx) => {
                  const normalized =
                    b.x >= 0 &&
                    b.y >= 0 &&
                    b.x <= 1.5 &&
                    b.y <= 1.5 &&
                    b.w > 0 &&
                    b.h > 0 &&
                    b.w <= 1.5 &&
                    b.h <= 1.5;
                  const xPx = normalized ? b.x * imageFit.drawW : b.x * imageFit.scale;
                  const yPx = normalized ? b.y * imageFit.drawH : b.y * imageFit.scale;
                  const wPx = normalized ? b.w * imageFit.drawW : b.w * imageFit.scale;
                  const hPx = normalized ? b.h * imageFit.drawH : b.h * imageFit.scale;
                  return (
                    <div
                      key={`${selectedSegment.tag}-${idx}`}
                      style={{
                        position: "absolute",
                        left: imageFit.offsetX + xPx,
                        top: imageFit.offsetY + yPx,
                        width: wPx,
                        height: hPx,
                      }}
                      className="rounded-sm border-2 border-violet-400/90 bg-violet-500/10 shadow-[0_0_18px_rgba(124,58,237,0.55)]"
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        <aside className="w-full shrink-0 border-t border-white/10 bg-zinc-950/60 backdrop-blur md:w-[420px] md:border-l md:border-t-0">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-zinc-100">{asset.original_name}</div>
              <div className="truncate text-xs text-zinc-400">
                {asset.width && asset.height ? `${asset.width}×${asset.height}` : ""}
                {asset.mime_type ? (asset.width && asset.height ? ` · ${asset.mime_type}` : asset.mime_type) : ""}
                {Number.isFinite(asset.byte_size) ? ` · ${formatBytes(asset.byte_size)}` : ""}
              </div>
            </div>
            <button
              onClick={() => requestClose()}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/30 text-zinc-200 hover:bg-black/50 focus:outline-none focus:ring-2 focus:ring-violet-400/50"
              aria-label="Close"
            >
              <span aria-hidden="true" className="text-lg leading-none">
                ×
              </span>
            </button>
          </div>

          <div className="max-h-[45vh] overflow-auto p-4 md:max-h-none md:h-[calc(100%-57px)]">
            <div className="space-y-5">
              <section>
                <div className="mt-2 space-y-2 text-sm text-zinc-100">
                  {asset.ai_caption ? (
                    <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-100">
                      {asset.ai_caption}
                    </div>
                  ) : null}
                  {/* Note: we keep `asset.ai_tags_json` for search, but we intentionally don't show these
                      generic tags in the fullscreen UI (segments are shown below). */}
                </div>
              </section>

              {segments?.length ? (
                <section>
                  <div className="text-xs font-medium text-zinc-300">Segments</div>
                  <div className="mt-2">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="text-xs text-zinc-500">
                        Click a tag to highlight it on the image.
                      </div>
                      {selectedSegmentTag ? (
                        <button
                          onClick={() => setSelectedSegmentTag(null)}
                          className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-zinc-200 hover:bg-black/50"
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {segments.slice(0, 80).map((s) => {
                        const selected = s.tag === selectedSegmentTag;
                        return (
                          <button
                            type="button"
                            key={s.tag}
                            onClick={() => setSelectedSegmentTag((cur) => (cur === s.tag ? null : s.tag))}
                            className={
                              "rounded-full border px-2 py-1 text-xs " +
                              (selected
                                ? "border-violet-400/60 bg-violet-500/15 text-zinc-100"
                                : "border-white/10 bg-black/20 text-zinc-200 hover:bg-black/30")
                            }
                            title={s.updatedAt}
                          >
                            {s.tag}
                          </button>
                        );
                      })}
                    </div>
                    {selectedSegmentTag &&
                    !selectedSegment?.svg &&
                    !parseBoxesFromBboxJson(selectedSegment?.bboxJson ?? null).length ? (
                      <div className="mt-2 text-xs text-zinc-500">
                        No overlay data cached for{" "}
                        <span className="text-zinc-300">{selectedSegmentTag}</span>.
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <section>
                <div className="text-xs font-medium text-zinc-300">File</div>
                <div className="mt-2 space-y-2 text-xs text-zinc-300">
                  <div className="break-all">
                    <span className="text-zinc-500">Created:</span> {asset.created_at}
                  </div>
                  {asset.ai_updated_at ? (
                    <div className="break-all">
                      <span className="text-zinc-500">AI Updated:</span> {asset.ai_updated_at}
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}


