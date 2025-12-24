import {
  AppSettingsSchema,
  defaultIcloudDir,
  defaultLocalDataDir,
  readAppSettings,
  writeAppSettings,
} from "@/server/appConfig";

export const runtime = "nodejs";

export async function GET() {
  const settings = readAppSettings();
  return Response.json({
    settings,
    defaults: {
      icloudDir: defaultIcloudDir(),
      moondreamEndpoint: "http://127.0.0.1:2020",
    },
  });
}

export async function PUT(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = AppSettingsSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const next = parsed.data;

  const currentDataDir = ((process.env.MOONDREAM_DATA_DIR || "") || "").trim();
  const targetDataDir =
    next.storage.mode === "icloud"
      ? ((next.storage.icloudPath || defaultIcloudDir() || "") || "").trim()
      : defaultLocalDataDir();
  const resolvedTarget = targetDataDir ? (await import("node:path")).resolve(targetDataDir) : "";
  const resolvedCurrent = currentDataDir ? (await import("node:path")).resolve(currentDataDir) : "";

  // If switching to iCloud, ensure the folder exists so the user doesn't have to create it manually.
  if (next.storage.mode === "icloud") {
    const p = (next.storage.icloudPath || defaultIcloudDir() || "").trim();
    if (!p) {
      return Response.json(
        { error: "Could not determine default iCloud Drive folder. Please enter a path." },
        { status: 400 }
      );
    }
    const fs = await import("node:fs");
    fs.mkdirSync(p, { recursive: true });
  }

  // If the storage location changed, schedule a library migration for next launch.
  // We do the actual move on desktop startup (before DB is opened) for SQLite safety.
  if (resolvedCurrent && resolvedTarget && resolvedCurrent !== resolvedTarget) {
    const fs = await import("node:fs");
    const hasDb = fs.existsSync((await import("node:path")).join(resolvedCurrent, "moondream.sqlite3"));
    const hasProjects = fs.existsSync((await import("node:path")).join(resolvedCurrent, "projects"));
    if (hasDb || hasProjects) {
      next.storage.migration = {
        from: resolvedCurrent,
        to: resolvedTarget,
        requestedAt: new Date().toISOString(),
      };
    } else {
      next.storage.migration = undefined;
    }
  } else {
    next.storage.migration = undefined;
  }

  writeAppSettings(next);

  return Response.json({ ok: true, settings: next });
}


