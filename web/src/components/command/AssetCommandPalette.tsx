"use client";

import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";

import type { AssetWithAi, CanvasObjectRow } from "@/server/db/types";

export function AssetCommandPalette(props: {
  projectId: string;
  objects: CanvasObjectRow[];
  onFocusObjectId: (objectId: string) => void;
  onPlaceAssetAtViewportCenter: (assetId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<AssetWithAi[]>([]);

  const objectIdByAssetId = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of props.objects) {
      if (o.type === "image" && o.asset_id) m.set(o.asset_id, o.id);
    }
    return m;
  }, [props.objects]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(async () => {
      const res = await fetch(
        `/api/projects/${props.projectId}/assets/search?q=${encodeURIComponent(search)}&limit=50`
      );
      if (!res.ok) return;
      const data = (await res.json()) as { assets: AssetWithAi[] };
      setResults(data.assets ?? []);
    }, 120);
    return () => window.clearTimeout(t);
  }, [open, search, props.projectId]);

  const items = open ? results : [];

  return (
    <>
      {open ? (
        <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setOpen(false)} />
      ) : null}
      <div
        className={
          open
            ? "fixed left-1/2 top-16 z-50 w-[720px] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
            : "hidden"
        }
      >
        <Command
          value={search}
          onValueChange={setSearch}
          className="flex flex-col overflow-hidden"
        >
          <div className="border-b border-zinc-900 p-3">
            <Command.Input
              autoFocus
              placeholder="Search assets…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-600"
            />
          </div>

          <Command.List className="max-h-[420px] overflow-auto p-2">
            <Command.Empty className="p-3 text-sm text-zinc-500">
              No results.
            </Command.Empty>

            {items.map((a) => {
              const onCanvas = objectIdByAssetId.get(a.id);
              const subtitle =
                a.ai_status === "done" ? a.ai_caption : a.ai_status ? a.ai_status : "";
              return (
                <Command.Item
                  key={a.id}
                  value={`${a.original_name} ${a.ai_caption ?? ""}`}
                  onSelect={() => {
                    setOpen(false);
                    if (onCanvas) props.onFocusObjectId(onCanvas);
                    else props.onPlaceAssetAtViewportCenter(a.id);
                  }}
                  className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-200 aria-selected:bg-zinc-900"
                >
                  <div className="h-10 w-10 shrink-0 rounded bg-zinc-900 overflow-hidden">
                    {a.thumb_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.thumb_url} alt="" className="h-full w-full object-contain" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{a.original_name}</div>
                    {subtitle ? (
                      <div className="truncate text-xs text-zinc-500">{subtitle}</div>
                    ) : null}
                  </div>
                  <div className="text-xs text-zinc-500">{onCanvas ? "focus" : "place"}</div>
                </Command.Item>
              );
            })}
          </Command.List>

          <div className="border-t border-zinc-900 p-2 text-xs text-zinc-500" />
        </Command>
      </div>
    </>
  );
}


