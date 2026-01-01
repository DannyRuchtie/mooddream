## Bundling Node (optional, for a truly standalone desktop build)

The Tauri app will try to launch the Next.js server using:

1) `resources/bin/node` (bundled Node binary), if present  
2) `node` from PATH (system Node), as a fallback

To bundle Node:

- Download a Node.js macOS distribution matching your target architecture (arm64 or x64)
- Copy the `node` binary here:

```text
desktop/src-tauri/resources/bin/node
```

- Mark it executable:

```bash
chmod +x desktop/src-tauri/resources/bin/node
```

Notes:
- You will need to bundle the appropriate Node binary per-arch if you ship universal builds.
- The desktop app bundles the Next server code under `resources/next/` (built by `desktop/scripts/prepare-next.mjs`).


