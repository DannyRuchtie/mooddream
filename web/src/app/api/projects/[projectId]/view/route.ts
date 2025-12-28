import { z } from "zod";

import { getProject } from "@/server/db/projects";
import { getProjectSync, getProjectView, upsertProjectView } from "@/server/db/canvas";

export const runtime = "nodejs";

const ViewBody = z.object({
  world_x: z.number(),
  world_y: z.number(),
  zoom: z.number(),
  baseViewRev: z.number().int().min(0).optional(),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await ctx.params;
  const project = getProject(projectId);
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });
  const view = getProjectView(projectId);
  const sync = getProjectSync(projectId);
  return Response.json({
    projectId,
    view,
    viewRev: sync.view_rev,
    viewUpdatedAt: sync.view_updated_at,
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
  const parsed = ViewBody.safeParse(json);
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });

  const current = getProjectSync(projectId);
  const base = parsed.data.baseViewRev;
  if (typeof base === "number" && base !== current.view_rev) {
    return Response.json(
      {
        error: "Conflict: view is newer on disk",
        viewRev: current.view_rev,
        viewUpdatedAt: current.view_updated_at,
      },
      { status: 409 }
    );
  }

  upsertProjectView({ projectId, world_x: parsed.data.world_x, world_y: parsed.data.world_y, zoom: parsed.data.zoom });
  const next = getProjectSync(projectId);
  return Response.json({
    ok: true,
    viewRev: next.view_rev,
    viewUpdatedAt: next.view_updated_at,
  });
}


