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
    // Redacted on GET; only included on PUT when user changes it.
    hfToken?: string | null;
  };
};

type AiProgress = {
  counts: { pending: number; processing: number; done: number; failed: number; total: number };
  worker: {
    logAvailable: boolean;
    lastLogAt: string | null;
    currentAssetId: string | null;
    currentFile: string | null;
    recentLines: string[];
  };
};

type StationStatus = {
  endpoint: string;
  host: string;
  port: number;
  reachable: boolean;
  installed: boolean;
  startedByApp: boolean;
  logPath: string;
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

  const [aiProgress, setAiProgress] = useState<AiProgress | null>(null);
  const [station, setStation] = useState<StationStatus | null>(null);
  const [stationBusy, setStationBusy] = useState(false);
  const [stationErr, setStationErr] = useState<string | null>(null);

  const [settings, setSettings] = useState<Settings>({
    storage: { mode: "local" },
    ai: { provider: "local_station" },
  });
  const [defaults, setDefaults] = useState<{
    icloudDir: string | null;
    moondreamEndpoint: string;
    hfEndpointUrl: string;
    hfTokenSet: boolean;
  }>({
    icloudDir: null,
    moondreamEndpoint: "http://localhost:2023/v1",
    hfEndpointUrl: "https://api-inference.huggingface.co/models/moondream/moondream3-preview",
    hfTokenSet: false,
  });
  const [hfTokenInput, setHfTokenInput] = useState("");

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
        defaults: { icloudDir: string | null; moondreamEndpoint: string; hfEndpointUrl: string; hfTokenSet: boolean };
      };
      if (cancelled) return;
      // Prefill the Local Station endpoint so the field doesn't look "unsaved" when empty.
      // This does NOT write anything to disk until the user clicks Save.
      const nextSettings: Settings = {
        ...data.settings,
        ai: {
          ...data.settings.ai,
          endpoint:
            data.settings.ai.provider === "local_station"
              ? (data.settings.ai.endpoint?.trim() || data.defaults.moondreamEndpoint)
              : data.settings.ai.endpoint,
        },
      };
      setSettings(nextSettings);
      setDefaults(data.defaults);
      setLoaded(true);
    })().catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const tauriInvoke = async <T,>(cmd: string, args?: Record<string, unknown>): Promise<T> => {
    const w = window as any;
    if (!w?.__TAURI__?.invoke) throw new Error("Tauri API not available (not running in desktop app).");
    return (await w.__TAURI__.invoke(cmd, args ?? {})) as T;
  };

  // Desktop-only: Moondream Station status (auto-refresh).
  useEffect(() => {
    const w = window as any;
    if (!w?.__TAURI__?.invoke) return;

    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const endpoint =
          settings.ai.provider === "local_station"
            ? (settings.ai.endpoint?.trim() || defaults.moondreamEndpoint)
            : defaults.moondreamEndpoint;
        const st = await tauriInvoke<StationStatus>("station_status", { endpoint });
        if (cancelled) return;
        setStation(st);
      } catch {
        // ignore (desktop only)
      } finally {
        if (cancelled) return;
        timer = window.setTimeout(tick, 2500);
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.ai.provider, settings.ai.endpoint, defaults.moondreamEndpoint]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const res = await fetch("/api/ai/progress", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as AiProgress;
        if (cancelled) return;
        setAiProgress(data);
      } catch {
        // ignore
      } finally {
        if (cancelled) return;
        timer = window.setTimeout(tick, 2000);
      }
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
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

  const saveAll = async (opts?: { clearHfToken?: boolean }) => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const provider = settings.ai.provider;
      const endpoint = settings.ai.endpoint?.trim() || undefined;
      const hfToken = hfTokenInput.trim();

      const payload: Settings = {
        storage: {
          mode: settings.storage.mode,
          icloudPath:
            settings.storage.mode === "icloud"
              ? (settings.storage.icloudPath?.trim() || undefined)
              : undefined,
        },
        ai: {
          provider,
          endpoint,
          ...(opts?.clearHfToken
            ? { hfToken: null }
            : hfToken.length > 0
              ? { hfToken }
              : {}),
        },
      };
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      setSaved(true);
      if (opts?.clearHfToken) {
        setDefaults((d) => ({ ...d, hfTokenSet: false }));
        setHfTokenInput("");
      } else if (hfToken.length > 0) {
        setDefaults((d) => ({ ...d, hfTokenSet: true }));
        setHfTokenInput("");
      }
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
              onClick={() => saveAll()}
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
              <div className="mb-2 text-xs text-zinc-500">Provider</div>
              <div className="space-y-2">
                <label className="flex items-start gap-3 rounded-lg border border-zinc-900 bg-zinc-950 px-3 py-3">
                  <input
                    type="radio"
                    name="ai_provider"
                    checked={settings.ai.provider === "local_station"}
                    onChange={() => setSettings((s) => ({ ...s, ai: { ...s.ai, provider: "local_station" } }))}
                    className="mt-1"
                  />
                  <div>
                    <div className="text-sm text-zinc-200">Local Station</div>
                    <div className="text-xs text-zinc-500">Uses Moondream Station running on your machine.</div>
                  </div>
                </label>

                <label className="flex items-start gap-3 rounded-lg border border-zinc-900 bg-zinc-950 px-3 py-3">
                  <input
                    type="radio"
                    name="ai_provider"
                    checked={settings.ai.provider === "huggingface"}
                    onChange={() =>
                      setSettings((s) => ({
                        ...s,
                        ai: {
                          ...s.ai,
                          provider: "huggingface",
                          endpoint: (s.ai.endpoint || "").trim() ? s.ai.endpoint : defaults.hfEndpointUrl,
                        },
                      }))
                    }
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-zinc-200">Hugging Face Endpoint</div>
                    <div className="text-xs text-zinc-500">
                      Uses a Hugging Face Inference Endpoint (requires endpoint URL + API token).
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs text-zinc-500">
                {settings.ai.provider === "huggingface" ? "Hugging Face endpoint URL" : "Moondream Station endpoint"}
              </div>
              <input
                value={settings.ai.endpoint ?? ""}
                onChange={(e) => setSettings((s) => ({ ...s, ai: { ...s.ai, endpoint: e.target.value } }))}
                placeholder={
                  settings.ai.provider === "huggingface"
                    ? defaults.hfEndpointUrl
                    : defaults.moondreamEndpoint
                }
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 outline-none"
              />
              <div className="mt-2 text-[11px] text-zinc-600">
                {settings.ai.provider === "huggingface" ? (
                  <>Paste the full endpoint URL for your Hugging Face Inference Endpoint.</>
                ) : (
                  <>
                    Examples: <span className="text-zinc-400">http://127.0.0.1:2021/v1</span> or{" "}
                    <span className="text-zinc-400">http://localhost:2023/v1</span> (the worker accepts both and
                    normalizes). If <span className="text-zinc-400">localhost</span> gives issues, prefer{" "}
                    <span className="text-zinc-400">127.0.0.1</span>.
                  </>
                )}
              </div>
            </div>

            {settings.ai.provider === "huggingface" ? (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <div className="text-xs text-zinc-500">Hugging Face API token</div>
                  {defaults.hfTokenSet ? <div className="text-[11px] text-zinc-500">Token saved</div> : null}
                </div>
                <input
                  value={hfTokenInput}
                  onChange={(e) => setHfTokenInput(e.target.value)}
                  placeholder={defaults.hfTokenSet ? "•••••••••• (leave blank to keep existing)" : "hf_..."}
                  type="password"
                  autoComplete="off"
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 outline-none"
                />
                <div className="mt-2 text-[11px] text-zinc-600">
                  Stored locally in your app settings. The worker uses it as a Bearer token.
                </div>
                {defaults.hfTokenSet ? (
                  <div className="mt-2">
                    <button
                      disabled={!loaded || saving}
                      onClick={() => saveAll({ clearHfToken: true })}
                      className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
                    >
                      Clear saved token
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex items-center gap-3">
              <button
                disabled={!loaded || saving}
                onClick={() => saveAll()}
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

            <div className="mt-6 rounded-lg border border-zinc-900 bg-zinc-950 px-3 py-3">
              <div className="text-xs font-medium text-zinc-200">Worker activity</div>
              <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-zinc-500">
                <div>
                  Pending: <span className="text-zinc-200">{aiProgress ? aiProgress.counts.pending : "—"}</span>
                </div>
                <div>
                  Processing: <span className="text-zinc-200">{aiProgress ? aiProgress.counts.processing : "—"}</span>
                </div>
                <div>
                  Done: <span className="text-zinc-200">{aiProgress ? aiProgress.counts.done : "—"}</span>
                </div>
                <div>
                  Failed: <span className="text-zinc-200">{aiProgress ? aiProgress.counts.failed : "—"}</span>
                </div>
              </div>

              <div className="mt-2 text-xs text-zinc-500">
                {aiProgress?.worker.currentFile ? (
                  <>
                    Currently processing: <span className="text-zinc-200">{aiProgress.worker.currentFile}</span>
                  </>
                ) : aiProgress?.worker.logAvailable ? (
                  <>Worker is idle (no “processing …” line in recent logs).</>
                ) : (
                  <>Worker log not found (desktop-only; this is expected in some dev setups).</>
                )}
              </div>

              {aiProgress?.worker.lastLogAt ? (
                <div className="mt-1 text-[11px] text-zinc-600">
                  Last worker output: <span className="text-zinc-400">{aiProgress.worker.lastLogAt}</span>
                </div>
              ) : null}

              {aiProgress?.worker.logAvailable ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">
                    Recent worker log
                  </summary>
                  <pre className="mt-2 max-h-56 overflow-auto rounded-md border border-zinc-900 bg-black/40 p-2 text-[11px] leading-relaxed text-zinc-300">
                    {(aiProgress?.worker.recentLines || []).join("\n")}
                  </pre>
                </details>
              ) : null}
            </div>

            {(window as any)?.__TAURI__?.invoke ? (
              <div className="mt-4 rounded-lg border border-zinc-900 bg-zinc-950 px-3 py-3">
                <div className="text-xs font-medium text-zinc-200">Moondream Station</div>
                <div className="mt-1 text-xs text-zinc-500">
                  If you normally run Station from Terminal, the desktop app can start it for you.
                </div>

                <div className="mt-2 text-xs text-zinc-500">
                  Endpoint:{" "}
                  <span className="text-zinc-200">
                    {(settings.ai.provider === "local_station"
                      ? (settings.ai.endpoint?.trim() || defaults.moondreamEndpoint)
                      : defaults.moondreamEndpoint
                    ).trim()}
                  </span>
                </div>

                <div className="mt-2 flex items-center gap-3">
                  <button
                    disabled={stationBusy}
                    onClick={async () => {
                      setStationErr(null);
                      setStationBusy(true);
                      try {
                        const endpoint =
                          settings.ai.provider === "local_station"
                            ? (settings.ai.endpoint?.trim() || defaults.moondreamEndpoint)
                            : defaults.moondreamEndpoint;
                        const st = await tauriInvoke<StationStatus>("station_start", { endpoint });
                        setStation(st);
                      } catch (e) {
                        setStationErr((e as Error).message);
                      } finally {
                        setStationBusy(false);
                      }
                    }}
                    className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
                  >
                    {stationBusy ? "Starting…" : "Start Station"}
                  </button>

                  <button
                    disabled={stationBusy}
                    onClick={async () => {
                      setStationErr(null);
                      setStationBusy(true);
                      try {
                        const st = await tauriInvoke<StationStatus>("station_stop");
                        setStation(st);
                      } catch (e) {
                        setStationErr((e as Error).message);
                      } finally {
                        setStationBusy(false);
                      }
                    }}
                    className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
                  >
                    Stop (if started by app)
                  </button>
                </div>

                <div className="mt-2 text-xs text-zinc-500">
                  Status:{" "}
                  <span className={station?.reachable ? "text-emerald-300" : "text-zinc-300"}>
                    {station?.reachable ? "Reachable" : "Not reachable"}
                  </span>
                  {station?.installed === false ? (
                    <>
                      {" "}
                      <span className="text-amber-300">(`moondream-station` not found)</span>
                    </>
                  ) : null}
                </div>

                {station?.logPath ? (
                  <div className="mt-1 text-[11px] text-zinc-600">
                    Station logs: <span className="text-zinc-400">{station.logPath}</span>
                  </div>
                ) : null}

                {!station?.installed ? (
                  <div className="mt-2 text-[11px] text-zinc-600">
                    Install (once):{" "}
                    <span className="text-zinc-400">python3 -m pip install --user moondream-station</span>
                  </div>
                ) : null}

                {stationErr ? <div className="mt-2 text-xs text-red-400">{stationErr}</div> : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}


