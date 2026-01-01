import { getProject, listProjects } from "@/server/db/projects";
import { listAssets } from "@/server/db/assets";
import { getCanvasObjects, getProjectSync, getProjectView } from "@/server/db/canvas";
import { clearLastOpenedProjectId, setLastOpenedProjectId } from "@/server/db/appState";
import { ProjectWorkspace } from "@/components/workspace/ProjectWorkspace";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

export const runtime = "nodejs";

export async function generateMetadata(
  props: { params: Promise<{ projectId: string }> }
): Promise<Metadata> {
  const { projectId } = await props.params;
  const project = getProject(projectId);
  return {
    title: project?.name ? project.name : "Project",
  };
}

export default async function ProjectPage(props: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await props.params;

  const project = getProject(projectId);
  if (!project) {
    const projects = listProjects();
    const fallback = projects[0]?.id ?? null;
    if (fallback) {
      // Avoid getting stuck on a deleted project (desktop launch redirects via last_project_id).
      setLastOpenedProjectId(fallback);
      redirect(`/projects/${fallback}`);
    }

    // No projects exist. Clear last_project_id so "/" doesn't keep redirecting here.
    clearLastOpenedProjectId();
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-50 p-8">
        <div className="mx-auto max-w-2xl">
          <div className="text-lg font-semibold">Project not found</div>
          <div className="mt-2 text-sm text-zinc-400">
            It looks like this project was deleted. Create a new project to get started.
          </div>
          <div className="mt-6">
            <Link
              href="/?choose=1"
              className="inline-flex items-center justify-center rounded-lg bg-zinc-50 px-4 py-2 text-sm font-medium text-zinc-950"
            >
              Go to projects
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Persist last-opened project so the desktop app can reopen where you left off.
  // (Stored in SQLite, so it survives desktop port changes across launches.)
  setLastOpenedProjectId(projectId);

  const assets = listAssets({ projectId, limit: 200, offset: 0 });
  const objects = getCanvasObjects(projectId);
  const view = getProjectView(projectId);
  const sync = getProjectSync(projectId);

  return (
    <ProjectWorkspace
      project={project}
      initialAssets={assets}
      initialObjects={objects}
      initialView={view}
      initialSync={{ canvasRev: sync.canvas_rev, viewRev: sync.view_rev }}
    />
  );
}


