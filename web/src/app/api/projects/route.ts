import { z } from "zod";

import { createProject, listProjects } from "@/server/db/projects";

export const runtime = "nodejs";

const CreateProjectBody = z.object({
  name: z.string().min(1).max(200),
});

export async function GET() {
  const projects = listProjects();
  return Response.json({ projects });
}

export async function POST(req: Request) {
  const json = await req.json().catch(() => null);
  const parsed = CreateProjectBody.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const project = createProject(parsed.data.name);
  return Response.json({ project });
}


