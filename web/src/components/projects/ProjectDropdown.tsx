"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { ProjectRow } from "@/server/db/types";

export function ProjectDropdown(props: {
  currentProjectId: string;
  variant?: "button" | "text";
  align?: "left" | "center" | "right";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

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
    const onDown = (e: MouseEvent) => {
      const el = popoverRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setOpen(false);
        setMenuFor(null);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  const createNew = async () => {
    const name = window.prompt("New project name", "New project");
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
      setMenuFor(null);
      router.push(`/projects/${data.project.id}`);
    } finally {
      setBusyId(null);
    }
  };

  const rename = async (project: ProjectRow) => {
    const name = window.prompt("Rename project", project.name);
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
      setMenuFor(null);
    } finally {
      setBusyId(null);
    }
  };

  const del = async (project: ProjectRow) => {
    const ok = window.confirm(`Delete project "${project.name}"? This will remove its assets + canvas.`);
    if (!ok) return;
    setBusyId(project.id);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) return;
      await refresh();
      setOpen(false);
      setMenuFor(null);
      if (project.id === props.currentProjectId) {
        router.push("/");
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={
          props.variant === "text"
            ? "inline-flex items-center gap-2 px-2 py-1 text-sm font-medium text-zinc-200 hover:text-zinc-50"
            : "inline-flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
        }
      >
        <span className="max-w-[220px] truncate">{current?.name ?? "Select project"}</span>
        <span className="text-zinc-500">▾</span>
      </button>

      {open ? (
        <div
          className={
            "absolute mt-2 w-[340px] rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden " +
            (props.align === "center"
              ? "left-1/2 -translate-x-1/2"
              : props.align === "left"
                ? "left-0"
                : "right-0")
          }
        >
          <div className="flex items-center justify-between border-b border-zinc-900 px-3 py-2">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Projects</div>
            <button
              onClick={createNew}
              disabled={busyId === "new"}
              className="rounded-md bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-950 disabled:opacity-60"
            >
              {busyId === "new" ? "Creating…" : "New"}
            </button>
          </div>

          <div className="max-h-[360px] overflow-auto">
            {projects.map((p) => {
              const isCurrent = p.id === props.currentProjectId;
              const isBusy = busyId === p.id;
              const menuOpen = menuFor === p.id;

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
                      setMenuFor(null);
                      router.push(`/projects/${p.id}`);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-zinc-200">{p.name}</div>
                    <div className="truncate text-xs text-zinc-500">{p.id}</div>
                  </button>

                  <div className="relative">
                    <button
                      disabled={isBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuFor((curId) => (curId === p.id ? null : p.id));
                      }}
                      className="rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                      title="Project actions"
                    >
                      ⋯
                    </button>

                    {menuOpen ? (
                      <div className="absolute right-0 mt-2 w-40 rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl overflow-hidden">
                        <button
                          onClick={() => rename(p)}
                          className="block w-full px-3 py-2 text-left text-sm text-zinc-200 hover:bg-zinc-900"
                        >
                          Rename…
                        </button>
                        <button
                          onClick={() => del(p)}
                          className="block w-full px-3 py-2 text-left text-sm text-red-300 hover:bg-zinc-900"
                        >
                          Delete…
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}


