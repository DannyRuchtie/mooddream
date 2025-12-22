import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { NextApiRequest, NextApiResponse } from "next";
import Busboy from "busboy";
import sharp from "sharp";

import { getProject } from "@/server/db/projects";
import {
  findAssetByProjectSha,
  getAsset,
  insertAsset,
  upsertAssetAi,
} from "@/server/db/assets";
import {
  assetDiskPath,
  assetUrlPath,
  projectAssetsDir,
  projectThumbsDir,
  thumbDiskPath,
  thumbUrlPath,
} from "@/server/storage/paths";

export const config = {
  api: {
    bodyParser: false,
  },
};

function isLikelyImage(mimeType: string) {
  return mimeType.startsWith("image/");
}

function safeExt(originalName: string, mimeType: string) {
  const extFromName = path.extname(originalName || "").toLowerCase();
  if (extFromName && extFromName.length <= 10) return extFromName;
  if (mimeType === "image/jpeg") return ".jpg";
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  if (mimeType === "image/heic") return ".heic";
  return "";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const projectId = req.query.projectId;
  if (typeof projectId !== "string" || !projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const project = getProject(projectId);
  if (!project) {
    return res.status(404).json({ error: "Project not found" });
  }

  fs.mkdirSync(projectAssetsDir(projectId), { recursive: true });
  fs.mkdirSync(projectThumbsDir(projectId), { recursive: true });

  // IMPORTANT: Next.js logs (and can sometimes abort) if the handler resolves before sending a response.
  // Wrap Busboy lifecycle in a Promise and await it.
  await new Promise<void>((resolve) => {
    const busboy = Busboy({ headers: req.headers });

    const created: any[] = [];
    const errors: string[] = [];

    const pendingWrites: Promise<void>[] = [];

    const safeRespond = (status: number, body: any) => {
      if (res.headersSent) return;
      res.status(status).json(body);
    };

    busboy.on("file", (_fieldname, file, info) => {
      const originalName = info.filename || "upload";
      const mimeType = info.mimeType || "application/octet-stream";

      const hash = crypto.createHash("sha256");
      let byteSize = 0;

      const tmpName = `${crypto.randomUUID()}.uploading`;
      const tmpPath = assetDiskPath(projectId, tmpName);
      const out = fs.createWriteStream(tmpPath);

      const p = new Promise<void>((fileDone) => {
        file.on("data", (chunk: Buffer) => {
          byteSize += chunk.length;
          hash.update(chunk);
        });
        file.pipe(out);

        out.on("finish", async () => {
          const sha256 = hash.digest("hex");

          const existing = findAssetByProjectSha(projectId, sha256);
          if (existing) {
            try {
              fs.unlinkSync(tmpPath);
            } catch {
              // ignore
            }
            created.push(getAsset(existing.id));
            return fileDone();
          }

          const ext = safeExt(originalName, mimeType);
          const finalFilename = `${sha256}${ext}`;
          const finalPath = assetDiskPath(projectId, finalFilename);

          try {
            fs.renameSync(tmpPath, finalPath);
          } catch {
            // If rename fails (e.g. cross-device), copy+unlink.
            fs.copyFileSync(tmpPath, finalPath);
            fs.unlinkSync(tmpPath);
          }

          let width: number | null = null;
          let height: number | null = null;
          let thumbPath: string | null = null;
          let thumbUrl: string | null = null;

          if (isLikelyImage(mimeType)) {
            try {
              const meta = await sharp(finalPath).metadata();
              width = meta.width ?? null;
              height = meta.height ?? null;

              const thumbFilename = `${sha256}.webp`;
              const thumbAbs = thumbDiskPath(projectId, thumbFilename);
              await sharp(finalPath)
                .resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true })
                .webp({ quality: 80 })
                .toFile(thumbAbs);
              thumbPath = thumbAbs;
              thumbUrl = thumbUrlPath(projectId, thumbFilename);
            } catch {
              errors.push(`thumb_failed:${originalName}`);
            }
          }

          const assetId = crypto.randomUUID();
          insertAsset({
            id: assetId,
            project_id: projectId,
            original_name: originalName,
            mime_type: mimeType,
            byte_size: byteSize,
            sha256,
            storage_path: finalPath,
            storage_url: assetUrlPath(projectId, finalFilename),
            thumb_path: thumbPath,
            thumb_url: thumbUrl,
            width,
            height,
            created_at: "", // ignored by insertAsset
          } as any);

          if (isLikelyImage(mimeType)) {
            upsertAssetAi({
              assetId,
              status: "pending",
              caption: null,
              tagsJson: JSON.stringify([]),
              modelVersion: null,
            });
          }

          created.push(getAsset(assetId));
          fileDone();
        });

        out.on("error", () => {
          errors.push(`write_failed:${originalName}`);
          try {
            fs.unlinkSync(tmpPath);
          } catch {
            // ignore
          }
          fileDone();
        });
      });

      pendingWrites.push(p);
    });

    busboy.on("error", () => {
      safeRespond(500, { error: "Upload parse failed" });
      resolve();
    });

    busboy.on("finish", async () => {
      await Promise.all(pendingWrites);
      safeRespond(200, { projectId, assets: created.filter(Boolean), errors });
      resolve();
    });

    req.on("aborted", () => resolve());
    req.pipe(busboy);
  });
}


