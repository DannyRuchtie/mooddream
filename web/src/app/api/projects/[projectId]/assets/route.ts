import { z } from "zod";

import { getProject } from "@/server/db/projects";
import { listAssets } from "@/server/db/assets";

export const runtime = "nodejs";

const ListAssetsQuery = z.object({
  limit: z.coerce.number().int().optional(),
  offset: z.coerce.number().int().optional(),
});

export async function GET(
  req: Request,
  ctx: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await ctx.params;
  const project = getProject(projectId);
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });

  const url = new URL(req.url);
  const parsed = ListAssetsQuery.safeParse({
    limit: url.searchParams.get("limit"),
    offset: url.searchParams.get("offset"),
  });
  if (!parsed.success) {
    return Response.json({ error: "Invalid query" }, { status: 400 });
  }

  const assets = listAssets({
    projectId,
    limit: parsed.data.limit,
    offset: parsed.data.offset,
  });
  return Response.json({ projectId, assets });
}


