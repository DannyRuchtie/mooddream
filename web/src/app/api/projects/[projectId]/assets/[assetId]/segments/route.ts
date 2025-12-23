import { z } from "zod";

import { getProject } from "@/server/db/projects";
import { getAsset } from "@/server/db/assets";
import { getAssetSegment, listAssetSegments } from "@/server/db/ai";

export const runtime = "nodejs";

const SegmentsQuery = z.object({
  term: z.string().min(1),
});

export async function GET(
  req: Request,
  ctx: { params: Promise<{ projectId: string; assetId: string }> }
) {
  const { projectId, assetId } = await ctx.params;
  const project = getProject(projectId);
  if (!project) return Response.json({ error: "Not found" }, { status: 404 });

  const asset = getAsset(assetId);
  if (!asset || asset.project_id !== projectId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const termParam = url.searchParams.get("term") ?? "";
  const termRaw = termParam.trim().toLowerCase();

  // Backwards compatible:
  // - When term is provided, return that segment (existing behavior used by the command palette highlight).
  // - When term is omitted/empty, return all cached segments for this asset.
  if (!termRaw) {
    const segments = listAssetSegments(assetId).map((s) => ({
      tag: s.tag,
      svg: s.svg,
      bboxJson: s.bbox_json,
      updatedAt: s.updated_at,
    }));
    return Response.json({ projectId, assetId, segments });
  }

  const parsed = SegmentsQuery.safeParse({ term: termRaw });
  if (!parsed.success) return Response.json({ error: "Invalid query" }, { status: 400 });

  const term = parsed.data.term;
  const seg = getAssetSegment({ assetId, tag: term });
  if (!seg) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({
    projectId,
    assetId,
    term,
    svg: seg.svg,
    bboxJson: seg.bbox_json,
    updatedAt: seg.updated_at,
  });
}


