"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";

import type { ProjectRow } from "@/server/db/types";
import { ROUTE_FADE_MS, dispatchRouteFadeStart } from "@/lib/routeFade";

function Portal(props: { children: React.ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(props.children, document.body);
}

type Rect = { left: number; top: number; width: number; height: number };
function rectFromEl(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

export function ProjectDropdown(props: {
  currentProjectId: string;
  variant?: "button" | "text";
  align?: "left" | "center" | "right";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionsFor, setActionsFor] = useState<ProjectRow | null>(null);
  const [triggerRect, setTriggerRect] = useState<Rect | null>(null);
  const [actionsRect, setActionsRect] = useState<Rect | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const actionsBtnRef = useRef<HTMLButtonElement | null>(null);
  const [isMac, setIsMac] = useState(false);

  const [dialog, setDialog] = useState<
    | null
    | { type: "new"; name: string }
    | { type: "rename"; project: ProjectRow; name: string }
    | { type: "delete"; project: ProjectRow }
  >(null);

  const current = useMemo(
    () => projects.find((p) => p.id === props.currentProjectId) ?? null,
    [projects, props.currentProjectId]
  );

  const refresh = async () => {
    const res = await fetch("/api/projects");
    if (!res.ok) return;
    const data = (await res.json()) as { projects: ProjectRow[] };
    setProjects(data.projects ?? []);
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    setIsMac(navigator.platform.toLowerCase().includes("mac"));
  }, []);

  useLayoutEffect(() => {
    if (open && triggerRef.current) setTriggerRect(rectFromEl(triggerRef.current));
  }, [open]);
  useLayoutEffect(() => {
    if (actionsFor && actionsBtnRef.current) setActionsRect(rectFromEl(actionsBtnRef.current));
  }, [actionsFor]);

  const createNew = async () => {
    if (!dialog || dialog.type !== "new") return;
    const name = dialog.name.trim();
    if (!name) return;
    setBusyId("new");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { project: ProjectRow };
      await refresh();
      setOpen(false);
      setActionsFor(null);
      setDialog(null);
      router.push(`/projects/${data.project.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const rename = async (project: ProjectRow) => {
    if (!dialog || dialog.type !== "rename" || dialog.project.id !== project.id) return;
    const name = dialog.name.trim();
    if (!name) return;
    setBusyId(project.id);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return;
      await refresh();
      setActionsFor(null);
      setDialog(null);
    } finally {
      setBusyId(null);
    }
  };

  const del = async (project: ProjectRow) => {
    if (!dialog || dialog.type !== "delete" || dialog.project.id !== project.id) return;
    setBusyId(project.id);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) return;
      await refresh();
      setOpen(false);
      setActionsFor(null);
      setDialog(null);
      if (project.id === props.currentProjectId) {
        router.push("/");
      }
    } finally {
      setBusyId(null);
    }
  };

  const menuWidth = 340;
  const calcMenuLeft = (rect: Rect) => {
    const align = props.align ?? "right";
    if (align === "center") return rect.left + rect.width / 2 - menuWidth / 2;
    if (align === "left") return rect.left;
    return rect.left + rect.width - menuWidth;
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => {
          setOpen((v) => !v);
          setActionsFor(null);
        }}
        className={
          props.variant === "text"
            ? "inline-flex items-center gap-2 px-2 py-1 text-sm font-medium text-zinc-200 hover:text-zinc-50"
            : "inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
        }
      >
        <span className="max-w-[220px] truncate">{current?.name ?? "Select project"}</span>
        <span aria-hidden className="text-current">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            className="h-4 w-4"
          >
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      <Portal>
        {open && triggerRect ? (
          <>
            <div
              className="fixed inset-0 z-[9998]"
              onMouseDown={() => {
                setOpen(false);
                setActionsFor(null);
              }}
            />
            <div
              className="fixed z-[9999] w-[340px] rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
              style={{
                left: Math.max(8, Math.min(window.innerWidth - menuWidth - 8, calcMenuLeft(triggerRect))),
                top: triggerRect.top + triggerRect.height + 8,
              }}
            >
              <div className="flex items-center justify-between border-b border-zinc-900 px-3 py-2">
                <div className="text-xs uppercase tracking-wide text-zinc-500">Projects</div>
                <button
                  onClick={() => setDialog({ type: "new", name: "New project" })}
                  disabled={busyId === "new"}
                  className="rounded-md bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-950 disabled:opacity-60"
                >
                  New
                </button>
              </div>

              <div className="max-h-[360px] overflow-auto">
                {projects.map((p) => {
                  const isCurrent = p.id === props.currentProjectId;
                  const isBusy = busyId === p.id;

                  return (
                    <div
                      key={p.id}
                      className={`flex items-center gap-2 px-3 py-2 text-sm ${
                        isCurrent ? "bg-zinc-900/60" : "hover:bg-zinc-900"
                      }`}
                    >
                      <button
                        disabled={isBusy}
                        onClick={() => {
                          setOpen(false);
                          setActionsFor(null);
                          router.push(`/projects/${p.id}`);
                        }}
                        className="min-w-0 flex-1 text-left flex items-center gap-3"
                      >
                        <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-zinc-900">
                          <img
                            src={`/files/projects/${p.id}/preview`}
                            alt=""
                            className="h-full w-full object-cover"
                            onError={(e) => {
                              // Hide broken image icon; keep placeholder background.
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                            }}
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-zinc-200">{p.name}</div>
                        </div>
                      </button>

                      <button
                        ref={actionsFor?.id === p.id ? actionsBtnRef : null}
                        disabled={isBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActionsFor((cur) => (cur?.id === p.id ? null : p));
                        }}
                        className="rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                        title="Project actions"
                      >
                        ⋯
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="border-t border-zinc-900 p-2">
                <button
                  onClick={() => {
                    setOpen(false);
                    setActionsFor(null);
                    window.dispatchEvent(new Event("moondream:command-palette:toggle"));
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
                >
                  <span>Search board</span>
                  <span className="rounded border border-zinc-800 bg-zinc-900/40 px-1.5 py-0.5 text-[10px] text-zinc-400">
                    {isMac ? "⌘K" : "Ctrl+K"}
                  </span>
                </button>
                <button
                  onClick={() => {
                    setOpen(false);
                    setActionsFor(null);
                    dispatchRouteFadeStart();
                    window.setTimeout(() => {
                      router.push(`/settings?projectId=${encodeURIComponent(props.currentProjectId)}`);
                    }, ROUTE_FADE_MS);
                  }}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
                >
                  <span>Settings</span>
                  <span className="inline-flex items-center gap-1">
                    <span className="rounded border border-zinc-800 bg-zinc-900/40 px-1.5 py-0.5 text-[10px] text-zinc-400">
                      {isMac ? "⌘." : "Ctrl+."}
                    </span>
                    <span className="rounded border border-zinc-800 bg-zinc-900/40 px-1.5 py-0.5 text-[10px] text-zinc-400">
                      .
                    </span>
                  </span>
                </button>
              </div>
            </div>
          </>
        ) : null}

        {actionsFor && actionsRect ? (
          <>
            <div className="fixed inset-0 z-[9999]" onMouseDown={() => setActionsFor(null)} />
            <div
              className="fixed z-[10000] w-40 rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl overflow-hidden"
              style={{
                left: Math.min(window.innerWidth - 168, actionsRect.left + actionsRect.width - 160),
                top: actionsRect.top + actionsRect.height + 6,
              }}
            >
              <button
                onClick={() => setDialog({ type: "rename", project: actionsFor, name: actionsFor.name })}
                className="block w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-900"
              >
                Rename…
              </button>
              <button
                onClick={() => setDialog({ type: "delete", project: actionsFor })}
                className="block w-full px-3 py-2 text-left text-sm text-red-300 hover:bg-zinc-900"
              >
                Delete…
              </button>
            </div>
          </>
        ) : null}

        {dialog ? (
          <div className="fixed inset-0 z-[10001]">
            <div className="absolute inset-0 bg-black/50" onMouseDown={() => setDialog(null)} />
            <div className="absolute left-1/2 top-28 w-[420px] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-2xl">
              {dialog.type === "delete" ? (
                <>
                  <div className="text-sm text-zinc-200">Delete project?</div>
                  <div className="mt-1 text-xs text-zinc-500">{dialog.project.name}</div>
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      onClick={() => setDialog(null)}
                      className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => del(dialog.project)}
                      disabled={busyId === dialog.project.id}
                      className="rounded-md bg-red-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                      Delete
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-sm text-zinc-200">
                    {dialog.type === "new" ? "New project" : "Rename project"}
                  </div>
                  <input
                    autoFocus
                    value={dialog.name}
                    onChange={(e) => {
                      const v = e.target.value;
                      setDialog((d) => {
                        if (!d) return d;
                        if (d.type === "new") return { ...d, name: v };
                        if (d.type === "rename") return { ...d, name: v };
                        return d;
                      });
                    }}
                    className="mt-3 w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-600"
                    placeholder="Project name"
                  />
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      onClick={() => setDialog(null)}
                      className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        if (dialog.type === "new") createNew();
                        if (dialog.type === "rename") rename(dialog.project);
                      }}
                      disabled={busyId === "new" || (dialog.type === "rename" && busyId === dialog.project.id)}
                      className="rounded-md bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-950 disabled:opacity-60"
                    >
                      Save
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}
      </Portal>
    </div>
  );
}


