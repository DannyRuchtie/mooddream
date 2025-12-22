import { z } from "zod";

import { getProject } from "@/server/db/projects";
import { searchAssets } from "@/server/db/search";

export const runtime = "nodejs";

const SearchQuery = z.object({
  q: z.string().optional(),
  limit: z.coerce.number().int().optional(),
});

export async function GET(
  req: Request,
  ctx: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await ctx.params;
  const project = getProject(projectId);
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });

  const url = new URL(req.url);
  const parsed = SearchQuery.safeParse({
    q: url.searchParams.get("q") ?? "",
    limit: url.searchParams.get("limit"),
  });
  if (!parsed.success) {
    return Response.json({ error: "Invalid query" }, { status: 400 });
  }

  const assets = searchAssets({
    projectId,
    query: parsed.data.q ?? "",
    limit: parsed.data.limit,
  });
  return Response.json({ projectId, assets });
}


