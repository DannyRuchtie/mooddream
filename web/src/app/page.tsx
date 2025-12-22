"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { ProjectRow } from "@/server/db/types";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("My invite project");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);

  const refresh = async () => {
    const res = await fetch("/api/projects");
    if (!res.ok) return;
    const data = (await res.json()) as { projects: ProjectRow[] };
    setProjects(data.projects ?? []);
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="mt-8 rounded-xl border border-zinc-800 bg-zinc-950">
          <div className="flex items-center justify-between border-b border-zinc-900 px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Projects</div>
            <button
              onClick={refresh}
              className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-900"
            >
              Refresh
            </button>
          </div>
          <div className="max-h-[360px] overflow-auto p-2">
            {projects.length === 0 ? (
              <div className="p-3 text-sm text-zinc-500">No projects yet.</div>
            ) : (
              projects.map((p) => (
                <button
                  key={p.id}
                  onClick={() => router.push(`/projects/${p.id}`)}
                  className="block w-full rounded-lg px-3 py-2 text-left hover:bg-zinc-900"
                >
                  <div className="text-sm text-zinc-200">{p.name}</div>
                  <div className="text-xs text-zinc-500">{p.id}</div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-zinc-600"
            placeholder="Project name"
          />

          {error ? <div className="mt-2 text-sm text-red-400">{error}</div> : null}

          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const res = await fetch("/api/projects", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ name }),
                });
                if (!res.ok) throw new Error("Failed to create project");
                const data = (await res.json()) as { project: { id: string } };
                await refresh();
                router.push(`/projects/${data.project.id}`);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-950 disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create project"}
          </button>
        </div>
      </div>
    </div>
  );
}
