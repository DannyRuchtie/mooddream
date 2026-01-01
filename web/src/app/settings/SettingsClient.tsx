"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { ROUTE_FADE_MS, dispatchRouteFadeEnd, dispatchRouteFadeStart } from "@/lib/routeFade";

type StorageMode = "local" | "icloud";
type AiProvider = "local_station" | "huggingface";

type Settings = {
  storage: {
    mode: StorageMode;
    icloudPath?: string;
  };
  ai: {
    provider: AiProvider;
    endpoint?: string;
  };
};

export default function SettingsClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const projectId = sp?.get("projectId") ?? null;

  const [transitionState, setTransitionState] = useState<"enter" | "entered" | "exit">("enter");
  const exitTimerRef = useRef<number | null>(null);
  const isExitingRef = useRef(false);
  const projectIdRef = useRef<string | null>(projectId);

  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryMsg, setRetryMsg] = useState<string | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);

  const [settings, setSettings] = useState<Settings>({
    storage: { mode: "local" },
    ai: { provider: "local_station" },
  });
  const [defaults, setDefaults] = useState<{ icloudDir: string | null; moondreamEndpoint: string }>({
    icloudDir: null,
    moondreamEndpoint: "http://127.0.0.1:2020",
  });

  const effectiveIcloudPath = useMemo(() => {
    if (settings.storage.mode !== "icloud") return null;
    return settings.storage.icloudPath || defaults.icloudDir;
  }, [settings.storage.mode, settings.storage.icloudPath, defaults.icloudDir]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/settings");
      if (!res.ok) return;
      const data = (await res.json()) as {
        settings: Settings;
        defaults: { icloudDir: string | null; moondreamEndpoint: string };
      };
      if (cancelled) return;
      setSettings(data.settings);
      setDefaults(data.defaults);
      setLoaded(true);
    })().catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  // If we arrived via a route fade (e.g. opening Settings from the board), allow the overlay to fade away.
  useEffect(() => {
    dispatchRouteFadeEnd();
  }, []);

  // Fade in on mount.
  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setTransitionState("entered"));
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const navigateBack = () => {
    const pid = projectIdRef.current;
    const back = pid ? `/projects/${pid}` : "/";
    router.push(back);
  };

  const requestExit = () => {
    if (isExitingRef.current) return;
    isExitingRef.current = true;
    dispatchRouteFadeStart();
    setTransitionState("exit");
    if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
    exitTimerRef.current = window.setTimeout(() => {
      exitTimerRef.current = null;
      navigateBack();
    }, ROUTE_FADE_MS);
  };

  // Cleanup (unmount) only: don't cancel our exit timer just because state changes.
  useEffect(() => {
    return () => {
      if (exitTimerRef.current) window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    };
  }, []);

  // Allow closing via Escape with the same fade-out.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      requestExit();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const saveAll = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const payload: Settings = {
        storage: {
          mode: settings.storage.mode,
          icloudPath:
            settings.storage.mode === "icloud"
              ? (settings.storage.icloudPath?.trim() || undefined)
              : undefined,
        },
        ai: {
          provider: settings.ai.provider,
          endpoint: settings.ai.endpoint?.trim() || undefined,
        },
      };
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 overflow-auto text-zinc-50">
      {/* Backdrop */}
      <div
        className={`pointer-events-none fixed inset-0 bg-black transition-opacity duration-200 ease-out motion-reduce:transition-none ${
          transitionState === "entered" || transitionState === "exit" ? "opacity-100" : "opacity-0"
        }`}
      />

      <div
        className={`relative mx-auto max-w-3xl px-6 py-10 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
          transitionState === "entered" ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1"
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Settings</div>
            <div className="mt-1 text-sm text-zinc-500">Desktop settings apply after restart.</div>
          </div>
          <button
            onClick={() => {
              requestExit();
            }}
            className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900"
          >
            Back
          </button>
        </div>

        <div className="mt-8 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <div className="text-sm font-medium">Storage</div>
          <div className="mt-1 text-xs text-zinc-500">
            Default is local. Switching storage will move your library (DB + assets) on next app launch.
            iCloud sync is convenient but SQLite can misbehave if you open the app on two Macs at the same time.
          </div>

          <div className="mt-4 space-y-2">
            <label className="flex items-start gap-3 rounded-lg border border-zinc-900 bg-zinc-950 px-3 py-3">
              <input
                type="radio"
                name="storage"
                checked={settings.storage.mode === "local"}
                onChange={() => setSettings((s) => ({ ...s, storage: { ...s.storage, mode: "local" } }))}
                className="mt-1"
              />
              <div>
                <div className="text-sm text-zinc-200">Local (recommended)</div>
                <div className="text-xs text-zinc-500">Stores data in Application Support on this Mac.</div>
              </div>
            </label>

            <label className="flex items-start gap-3 rounded-lg border border-zinc-900 bg-zinc-950 px-3 py-3">
              <input
                type="radio"
                name="storage"
                checked={settings.storage.mode === "icloud"}
                onChange={() => {
                  setSettings((s) => ({
                    ...s,
                    storage: {
                      ...s.storage,
                      mode: "icloud",
                      // Prefill to the default iCloud folder so users don't have to type anything.
                      icloudPath: (s.storage.icloudPath ?? defaults.icloudDir ?? undefined) || undefined,
                    },
                  }));
                }}
                className="mt-1"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-zinc-200">iCloud Drive</div>
                <div className="text-xs text-zinc-500">
                  Stores data in iCloud Drive for syncing between Macs (avoid running on two Macs concurrently).
                </div>

                <div className="mt-3">
                  <div className="text-xs text-zinc-500 mb-1">iCloud path</div>
                  <input
                    disabled={settings.storage.mode !== "icloud"}
                    value={settings.storage.icloudPath ?? ""}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        storage: { ...s.storage, icloudPath: e.target.value },
                      }))
                    }
                    placeholder={defaults.icloudDir ?? "iCloud Drive path"}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 outline-none disabled:opacity-60"
                  />
                  <div className="mt-2 text-[11px] text-zinc-600">
                    Leave blank to use the default: <span className="text-zinc-400">{defaults.icloudDir ?? "N/A"}</span>
                  </div>
                </div>
              </div>
            </label>
          </div>

          {error ? <div className="mt-4 text-sm text-red-400">{error}</div> : null}
          {saved ? (
            <div className="mt-4 rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-sm text-amber-200">
              Saved. Close and reopen the app to apply storage changes (and move your library if you changed storage).
            </div>
          ) : null}

          <div className="mt-4 flex items-center gap-3">
            <button
              disabled={!loaded || saving}
              onClick={saveAll}
              className="rounded-lg bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>

            {settings.storage.mode === "icloud" && effectiveIcloudPath ? (
              <div className="text-xs text-zinc-500">
                Effective path: <span className="text-zinc-300">{effectiveIcloudPath}</span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
          <div className="text-sm font-medium">AI</div>
          <div className="mt-1 text-xs text-zinc-500">
            Configure the AI endpoint used by the bundled worker. If you see “failed”, it often means the app couldn’t
            reach the endpoint at the time.
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <div className="mb-1 text-xs text-zinc-500">AI endpoint</div>
              <input
                value={settings.ai.endpoint ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, ai: { ...s.ai, endpoint: e.target.value } }))}
                placeholder={defaults.moondreamEndpoint}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 outline-none"
              />
              <div className="mt-2 text-[11px] text-zinc-600">
                Examples: <span className="text-zinc-400">http://127.0.0.1:2021/v1</span> or{" "}
                <span className="text-zinc-400">http://127.0.0.1:2020</span> (the worker accepts both and normalizes).
                If <span className="text-zinc-400">localhost</span> gives issues, prefer{" "}
                <span className="text-zinc-400">127.0.0.1</span>.
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                disabled={!loaded || saving}
                onClick={saveAll}
                className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save endpoint"}
              </button>
            <button
              disabled={!projectId}
              onClick={async () => {
                if (!projectId) return;
                setError(null);
                  setRetryMsg(null);
                  setRetryBusy(true);
                try {
                  const res = await fetch(`/api/projects/${projectId}/ai/retry`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({}),
                  });
                    if (!res.ok) throw new Error("Retry failed");
                    const data = (await res.json().catch(() => null)) as { changes?: number } | null;
                    const changes = data?.changes ?? 0;
                    setRetryMsg(changes > 0 ? `Retried ${changes} asset(s).` : "No failed assets to retry.");
                } catch (e) {
                  setError((e as Error).message);
                  } finally {
                    setRetryBusy(false);
                }
              }}
              className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
            >
                {retryBusy ? "Retrying…" : "Retry failed AI (this project)"}
            </button>
            {!projectId ? (
              <div className="text-xs text-zinc-600">Open Settings from inside a project to enable this.</div>
            ) : null}
            </div>
            {retryMsg ? <div className="text-xs text-zinc-500">{retryMsg}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}


