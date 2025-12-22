import { getProject } from "@/server/db/projects";
import { listAssets } from "@/server/db/assets";
import { getCanvasObjects, getProjectView } from "@/server/db/canvas";
import { ProjectWorkspace } from "@/components/workspace/ProjectWorkspace";
import type { Metadata } from "next";

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
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-50 p-8">
        <div className="text-sm text-zinc-300">Project not found.</div>
      </div>
    );
  }

  const assets = listAssets({ projectId, limit: 200, offset: 0 });
  const objects = getCanvasObjects(projectId);
  const view = getProjectView(projectId);

  return (
    <ProjectWorkspace
      project={project}
      initialAssets={assets}
      initialObjects={objects}
      initialView={view}
    />
  );
}


