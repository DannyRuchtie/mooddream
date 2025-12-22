import fs from "node:fs";
import { Readable } from "node:stream";

import { thumbDiskPath } from "@/server/storage/paths";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ projectId: string; filename: string }> }
) {
  const { projectId, filename } = await ctx.params;
  const abs = thumbDiskPath(projectId, filename);

  if (!fs.existsSync(abs)) {
    return new Response("Not found", { status: 404 });
  }

  const stat = fs.statSync(abs);
  const stream = fs.createReadStream(abs);

  return new Response(Readable.toWeb(stream) as any, {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}


