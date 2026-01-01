import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

import { repoDataDir } from "@/server/storage/paths";

const StorageMode = z.enum(["local", "icloud"]);
const AiProvider = z.enum(["local_station", "huggingface"]);

export const AppSettingsSchema = z.object({
  storage: z
    .object({
      mode: StorageMode.default("local"),
      icloudPath: z.string().min(1).optional(),
      migration: z
        .object({
          from: z.string().min(1),
          to: z.string().min(1),
          requestedAt: z.string().min(1),
        })
        .optional(),
    })
    .default({ mode: "local" }),
  ai: z
    .object({
      provider: AiProvider.default("local_station"),
      // For local_station: http://127.0.0.1:2020 or http://127.0.0.1:2021/v1
      endpoint: z.string().min(1).optional(),
    })
    .default({ provider: "local_station" }),
});

export type AppSettings = z.infer<typeof AppSettingsSchema>;

export function configRootDir() {
  const env = (process.env.MOONDREAM_APP_CONFIG_DIR || "").trim();
  if (env) return path.resolve(env);
  // Dev fallback: keep settings in repo data dir.
  return repoDataDir();
}

export function settingsFilePath() {
  const p = (process.env.MOONDREAM_SETTINGS_PATH || "").trim();
  if (p) return path.resolve(p);
  return path.join(configRootDir(), "settings.json");
}

export function defaultIcloudDir() {
  const home = process.env.HOME || os.homedir() || "";
  if (!home) return null;
  const root = path.join(
    home,
    "Library",
    "Mobile Documents",
    "com~apple~CloudDocs"
  );
  const next = path.join(root, "Reference");
  const old = path.join(root, "Moondream");
  // Branding change: default to "Reference", but keep compatibility with existing installs.
  if (fs.existsSync(old) && !fs.existsSync(next)) return old;
  return next;
}

export function defaultLocalDataDir() {
  return path.join(configRootDir(), "data");
}

export function readAppSettings(): AppSettings {
  const file = settingsFilePath();
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = AppSettingsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // ignore
  }
  return AppSettingsSchema.parse({});
}

export function writeAppSettings(next: AppSettings) {
  const root = configRootDir();
  fs.mkdirSync(root, { recursive: true });
  const file = settingsFilePath();
  fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
}


