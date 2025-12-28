import { z } from "zod";

import { getProject } from "@/server/db/projects";
import { getCanvasObjects, getProjectSync, replaceCanvasObjects } from "@/server/db/canvas";

export const runtime = "nodejs";

const CanvasObject = z.object({
  id: z.string().min(1),
  type: z.enum(["image", "text", "shape", "group"]),
  asset_id: z.string().nullable().optional(),
  x: z.number(),
  y: z.number(),
  scale_x: z.number(),
  scale_y: z.number(),
  rotation: z.number(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  z_index: z.number().int(),
  props_json: z.string().nullable().optional(),
});

const SaveCanvasBody = z.object({
  objects: z.array(CanvasObject),
  baseCanvasRev: z.number().int().min(0).optional(),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await ctx.params;
  const project = getProject(projectId);
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });

  const objects = getCanvasObjects(projectId);
  const sync = getProjectSync(projectId);
  return Response.json({
    projectId,
    objects,
    canvasRev: sync.canvas_rev,
    canvasUpdatedAt: sync.canvas_updated_at,
  });
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await ctx.params;
  const project = getProject(projectId);
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });

  const json = await req.json().catch(() => null);
  const parsed = SaveCanvasBody.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const current = getProjectSync(projectId);
  const base = parsed.data.baseCanvasRev;
  if (typeof base === "number" && base !== current.canvas_rev) {
    return Response.json(
      {
        error: "Conflict: canvas is newer on disk",
        canvasRev: current.canvas_rev,
        canvasUpdatedAt: current.canvas_updated_at,
      },
      { status: 409 }
    );
  }

  const normalized = parsed.data.objects.map((o) => ({
    ...o,
    asset_id: o.asset_id ?? null,
    width: o.width ?? null,
    height: o.height ?? null,
    props_json: o.props_json ?? null,
  }));

  replaceCanvasObjects({ projectId, objects: normalized });
  const next = getProjectSync(projectId);
  return Response.json({
    ok: true,
    canvasRev: next.canvas_rev,
    canvasUpdatedAt: next.canvas_updated_at,
  });
}


