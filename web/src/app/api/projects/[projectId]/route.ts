import { z } from "zod";

import { deleteProject, getProject, renameProject } from "@/server/db/projects";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await ctx.params;
  const project = getProject(projectId);
  if (!project) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ project });
}

const RenameBody = z.object({
  name: z.string().min(1).max(200),
});

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await ctx.params;
  const json = await req.json().catch(() => null);
  const parsed = RenameBody.safeParse(json);
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });

  const updated = renameProject(projectId, parsed.data.name);
  if (!updated) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ project: updated });
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await ctx.params;
  const ok = deleteProject(projectId);
  if (!ok) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ ok: true });
}


