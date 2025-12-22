import { z } from "zod";

import { getProject } from "@/server/db/projects";
import { getProjectView, upsertProjectView } from "@/server/db/canvas";

export const runtime = "nodejs";

const ViewBody = z.object({
  world_x: z.number(),
  world_y: z.number(),
  zoom: z.number(),
});

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await ctx.params;
  const project = getProject(projectId);
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });
  const view = getProjectView(projectId);
  return Response.json({ projectId, view });
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

  upsertProjectView({ projectId, ...parsed.data });
  return Response.json({ ok: true });
}


