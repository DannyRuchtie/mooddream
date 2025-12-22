import fs from "node:fs";
import { Readable } from "node:stream";

import { assetDiskPath } from "@/server/storage/paths";

export const runtime = "nodejs";

function contentTypeFromFilename(filename: string) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ projectId: string; filename: string }> }
) {
  const { projectId, filename } = await ctx.params;
  const abs = assetDiskPath(projectId, filename);

  if (!fs.existsSync(abs)) {
    return new Response("Not found", { status: 404 });
  }

  const stat = fs.statSync(abs);
  const stream = fs.createReadStream(abs);

  return new Response(Readable.toWeb(stream) as any, {
    headers: {
      "Content-Type": contentTypeFromFilename(filename),
      "Content-Length": String(stat.size),
      // Content-addressed files (sha256) are safe to cache aggressively.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}


