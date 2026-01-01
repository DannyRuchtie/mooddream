import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "..", "..");

// IMPORTANT:
// This script ONLY deletes build artifacts (not user data).
// User data lives under ~/Library/Application Support/<bundle-id>/... at runtime.
const targets = [
  path.join(repoRoot, "desktop", "src-tauri", "target"),
  path.join(repoRoot, "desktop", "src-tauri", "resources", "next"),
  path.join(repoRoot, "web", ".next"),
  path.join(repoRoot, "worker", "build"),
  path.join(repoRoot, "worker", "dist"),
];

function rm(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

console.log("[desktop] clean: removing build artifacts...");
for (const p of targets) {
  rm(p);
  console.log(`[desktop] clean: removed ${p}`);
}
console.log("[desktop] clean: done.");


