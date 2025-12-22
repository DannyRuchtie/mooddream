import path from "node:path";

export function repoDataDir() {
  // In dev, Next.js runs with cwd = web/
  return path.resolve(process.cwd(), "..", "data");
}

export function projectDir(projectId: string) {
  return path.join(repoDataDir(), "projects", projectId);
}

export function projectAssetsDir(projectId: string) {
  return path.join(projectDir(projectId), "assets");
}

export function projectThumbsDir(projectId: string) {
  return path.join(projectDir(projectId), "thumbs");
}

export function assetDiskPath(projectId: string, filename: string) {
  return path.join(projectAssetsDir(projectId), filename);
}

export function thumbDiskPath(projectId: string, filename: string) {
  return path.join(projectThumbsDir(projectId), filename);
}

export function assetUrlPath(projectId: string, filename: string) {
  return `/files/projects/${projectId}/assets/${filename}`;
}

export function thumbUrlPath(projectId: string, filename: string) {
  return `/files/projects/${projectId}/thumbs/${filename}`;
}


