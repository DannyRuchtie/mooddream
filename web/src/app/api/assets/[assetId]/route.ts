import { getAsset } from "@/server/db/assets";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ assetId: string }> }
) {
  const { assetId } = await ctx.params;
  const asset = getAsset(assetId);
  if (!asset) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ asset });
}


