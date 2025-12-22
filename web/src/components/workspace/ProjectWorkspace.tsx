"use client";

import { useState } from "react";

import type { AssetWithAi, CanvasObjectRow, ProjectRow, ProjectViewRow } from "@/server/db/types";
import { PixiWorkspace } from "@/components/canvas/PixiWorkspace";
import { AssetCommandPalette } from "@/components/command/AssetCommandPalette";
import { ProjectDropdown } from "@/components/projects/ProjectDropdown";

function clientUuid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export function ProjectWorkspace(props: {
  project: ProjectRow;
  initialAssets: AssetWithAi[];
  initialObjects: CanvasObjectRow[];
  initialView: ProjectViewRow | null;
}) {
  const { project } = props;
  const [objects, setObjects] = useState<CanvasObjectRow[]>(props.initialObjects);
  const [focusFn, setFocusFn] = useState<((objectId: string) => void) | null>(null);
  const [viewportCenterFn, setViewportCenterFn] = useState<
    (() => { x: number; y: number }) | null
  >(null);

  // We intentionally keep the UI minimal (Figma-like): just canvas + a tiny top bar.

  return (
    <div className="h-screen w-screen bg-zinc-950 text-zinc-50 overflow-hidden">
      <PixiWorkspace
        projectId={project.id}
        initialAssets={props.initialAssets}
        initialObjects={objects}
        initialView={props.initialView}
        onObjectsChange={setObjects}
        onFocusRequest={(fn) => setFocusFn(() => fn)}
        onViewportCenterRequest={(fn) => setViewportCenterFn(() => fn)}
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 h-14 bg-gradient-to-b from-black/50 to-transparent" />
      <div className="absolute left-1/2 top-3 z-50 -translate-x-1/2">
        <ProjectDropdown currentProjectId={project.id} variant="text" align="center" />
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
      />
    </div>
  );
}


