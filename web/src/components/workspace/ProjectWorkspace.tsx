"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { AssetWithAi, CanvasObjectRow, ProjectRow, ProjectViewRow } from "@/server/db/types";
import { PixiWorkspace } from "@/components/canvas/PixiWorkspace";
import { AssetCommandPalette } from "@/components/command/AssetCommandPalette";
import { ProjectDropdown } from "@/components/projects/ProjectDropdown";
import { ROUTE_FADE_MS, dispatchRouteFadeEnd, dispatchRouteFadeStart } from "@/lib/routeFade";

function clientUuid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function isEditableTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toLowerCase?.() ?? "";
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  // Handles nested contenteditable, e.g. editors that wrap the actual editable node.
  if (typeof el.closest === "function" && el.closest('[contenteditable="true"]')) return true;
  return false;
}

export function ProjectWorkspace(props: {
  project: ProjectRow;
  initialAssets: AssetWithAi[];
  initialObjects: CanvasObjectRow[];
  initialView: ProjectViewRow | null;
  initialSync?: { canvasRev: number; viewRev: number } | null;
}) {
  const { project } = props;
  const router = useRouter();
  const [objects, setObjects] = useState<CanvasObjectRow[]>(props.initialObjects);
  const [highlight, setHighlight] = useState<{
    assetId: string;
    term: string;
    svg: string | null;
    bboxJson: string | null;
  } | null>(null);
  const [focusFn, setFocusFn] = useState<((objectId: string) => void) | null>(null);
  const [viewportCenterFn, setViewportCenterFn] = useState<
    (() => { x: number; y: number }) | null
  >(null);

  // We intentionally keep the UI minimal (Figma-like): just canvas + a tiny top bar.

  useEffect(() => {
    // If we're arriving from a fade transition (e.g. closing Settings), reveal the board.
    dispatchRouteFadeEnd();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") return;
      if (isEditableTarget(e.target)) return;
      if (e.repeat) return;

      const isMac = navigator.platform.toLowerCase().includes("mac");
      const mod = isMac ? e.metaKey : e.ctrlKey;

      // "." opens Settings (inside a project context).
      // Also support Cmd+. / Ctrl+. (matches existing desktop convention).
      if (e.key === "." && !e.altKey && (!e.metaKey && !e.ctrlKey ? true : mod)) {
        e.preventDefault();
        dispatchRouteFadeStart();
        window.setTimeout(() => {
          router.push(`/settings?projectId=${encodeURIComponent(project.id)}`);
        }, ROUTE_FADE_MS);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [project.id, router]);

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-50 overflow-hidden">
      <PixiWorkspace
        projectId={project.id}
        initialAssets={props.initialAssets}
        initialObjects={objects}
        initialView={props.initialView}
        initialSync={props.initialSync ?? null}
        highlightOverlay={highlight}
        onObjectsChange={setObjects}
        onFocusRequest={(fn) => setFocusFn(() => fn)}
        onViewportCenterRequest={(fn) => setViewportCenterFn(() => fn)}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 h-14" />
      <div className="absolute left-3 top-3 z-50">
        <ProjectDropdown currentProjectId={project.id} variant="text" align="left" />
      </div>

      <AssetCommandPalette
        projectId={project.id}
        objects={objects}
        onFocusObjectId={(objectId) => focusFn?.(objectId)}
        onPlaceAssetAtViewportCenter={async (assetId) => {
          const center = viewportCenterFn?.() ?? { x: 0, y: 0 };
          // Place at viewport center by reusing the canvas save flow:
          const next: CanvasObjectRow[] = [
            ...objects,
            {
              id: clientUuid(),
              project_id: project.id,
              type: "image",
              asset_id: assetId,
              x: center.x,
              y: center.y,
              scale_x: 1,
              scale_y: 1,
              rotation: 0,
              width: null,
              height: null,
              z_index: objects.reduce((m, o) => Math.max(m, o.z_index), 0) + 1,
              props_json: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ];
          setObjects(next);
          await fetch(`/api/projects/${project.id}/canvas`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ objects: next }),
          });
        }}
        onHighlightAsset={(payload) => setHighlight(payload)}
      />
    </div>
  );
}


