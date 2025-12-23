"use client";

import { useEffect, useMemo, useState } from "react";

import type { AssetWithAi } from "@/server/db/types";

type Segment = {
  tag: string;
  svg: string | null;
  bboxJson: string | null;
  updatedAt: string;
};

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

export function AssetLightbox(props: {
  projectId: string;
  asset: AssetWithAi;
  onClose: () => void;
}) {
  const { asset, projectId, onClose } = props;
  const [entered, setEntered] = useState(false);
  const [segments, setSegments] = useState<Segment[] | null>(null);

  const tags = useMemo(() => safeParseTagsJson(asset.ai_tags_json), [asset.ai_tags_json]);

  useEffect(() => {
    const t = window.setTimeout(() => setEntered(true), 0);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setSegments(null);
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

  return (
    <div
      className={
        "fixed inset-0 z-[9999] bg-black transition-opacity duration-200 " +
        (entered ? "opacity-100" : "opacity-0")
      }
      onClick={() => onClose()}
      aria-modal="true"
      role="dialog"
    >
      <div
        className={
          "flex h-full w-full flex-col md:flex-row md:gap-0 transition-transform duration-200 ease-out " +
          (entered ? "scale-100" : "scale-[0.985]")
        }
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center p-4 md:p-8">
          <div className="relative h-full w-full max-w-[min(1100px,100%)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset.storage_url}
              alt={asset.original_name || "asset"}
              className="h-full w-full object-contain"
              draggable={false}
            />
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
              onClick={() => onClose()}
              className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-zinc-200 hover:bg-black/50"
            >
              Close
            </button>
          </div>

          <div className="max-h-[45vh] overflow-auto p-4 md:max-h-none md:h-[calc(100%-57px)]">
            <div className="space-y-5">
              <section>
                <div className="text-xs font-medium text-zinc-300">Moondream</div>
                <div className="mt-2 space-y-2 text-sm text-zinc-100">
                  <div className="text-zinc-200">
                    <span className="text-zinc-400">Status:</span>{" "}
                    {asset.ai_status ?? "—"}
                    {asset.ai_model_version ? (
                      <span className="text-zinc-500"> · {asset.ai_model_version}</span>
                    ) : null}
                  </div>
                  {asset.ai_caption ? (
                    <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-100">
                      {asset.ai_caption}
                    </div>
                  ) : null}
                  {tags.length ? (
                    <div className="flex flex-wrap gap-2">
                      {tags.slice(0, 64).map((t) => (
                        <div
                          key={t}
                          className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-xs text-zinc-200"
                        >
                          {t}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </section>

              <section>
                <div className="text-xs font-medium text-zinc-300">Segments</div>
                <div className="mt-2">
                  {segments === null ? (
                    <div className="text-xs text-zinc-500">Loading…</div>
                  ) : segments.length ? (
                    <div className="flex flex-wrap gap-2">
                      {segments.slice(0, 80).map((s) => (
                        <div
                          key={s.tag}
                          className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-xs text-zinc-200"
                          title={s.updatedAt}
                        >
                          {s.tag}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-500">No cached segments.</div>
                  )}
                </div>
              </section>

              <section>
                <div className="text-xs font-medium text-zinc-300">File</div>
                <div className="mt-2 space-y-2 text-xs text-zinc-300">
                  <div className="break-all">
                    <span className="text-zinc-500">Asset ID:</span> {asset.id}
                  </div>
                  <div className="break-all">
                    <span className="text-zinc-500">SHA256:</span> {asset.sha256}
                  </div>
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


