import {
  AppSettingsSchema,
  defaultIcloudDir,
  defaultLocalDataDir,
  readAppSettings,
  writeAppSettings,
} from "@/server/appConfig";

export const runtime = "nodejs";

function withTimeout(ms: number) {
  // AbortSignal.timeout is not available in all Node versions that Next may run under.
  const anySignal = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal };
  if (typeof anySignal.timeout === "function") return anySignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms).unref?.();
  return c.signal;
}

async function endpointReachable(url: string, timeoutMs: number) {
  try {
    // We don't require 200 here; some servers don't implement GET /v1 and may 404.
    // Any HTTP response indicates "something is listening" (good enough for a default).
    const res = await fetch(url, { method: "GET", signal: withTimeout(timeoutMs) });
    return !!res;
  } catch {
    return false;
  }
}

export async function GET() {
  const settings = readAppSettings();
  const hfTokenSet = !!(settings.ai?.hfToken && String(settings.ai.hfToken).trim().length > 0);

  // Prefer env (desktop sets MOONDREAM_ENDPOINT from saved settings).
  // Otherwise, probe common local endpoints and pick the first reachable.
  const envEndpoint = (process.env.MOONDREAM_ENDPOINT || "").trim();
  const candidate = "http://localhost:2023/v1";
  const fallback = "http://127.0.0.1:2020";
  const moondreamEndpoint = envEndpoint
    ? envEndpoint
    : (await endpointReachable(candidate, 600))
      ? candidate
      : fallback;

  return Response.json({
    // Don't send the token back to the client by default (avoid leaking secrets).
    settings: {
      ...settings,
      ai: {
        ...settings.ai,
        hfToken: undefined,
      },
    },
    defaults: {
      icloudDir: defaultIcloudDir(),
      moondreamEndpoint,
      // Default HF Inference API endpoint for the Moondream 3 Preview model:
      // https://huggingface.co/moondream/moondream3-preview
      hfEndpointUrl: "https://api-inference.huggingface.co/models/moondream/moondream3-preview",
      hfTokenSet,
    },
  });
}

export async function PUT(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = AppSettingsSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const current = readAppSettings();
  const next = parsed.data;

  // Normalize / merge secrets:
  // - If client omits hfToken (undefined), keep existing token.
  // - If client sends null, clear the token.
  // - If client sends a string, trim and store (empty -> keep existing).
  if (next.ai) {
    const incoming = next.ai.hfToken;
    if (incoming === undefined) {
      next.ai.hfToken = current.ai?.hfToken ?? undefined;
    } else if (incoming === null) {
      next.ai.hfToken = undefined;
    } else {
      const trimmed = String(incoming).trim();
      if (!trimmed) {
        next.ai.hfToken = current.ai?.hfToken ?? undefined;
      } else {
        next.ai.hfToken = trimmed;
      }
    }

    // Trim endpoint (applies to either local_station host or HF endpoint URL).
    const ep = (next.ai.endpoint || "").trim();
    next.ai.endpoint = ep || undefined;
  }

  // Trim iCloud path.
  if (next.storage && next.storage.mode === "icloud") {
    const p = (next.storage.icloudPath || "").trim();
    next.storage.icloudPath = p || undefined;
  }

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


