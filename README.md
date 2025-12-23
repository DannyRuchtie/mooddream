## Moondream Invite Canvas

High‑performance, Figma‑like canvas for building layouts by dropping images onto an infinite board, arranging them with fast transforms (move/resize/rotate), and keeping everything **local‑first**.

- **Frontend**: Next.js + PixiJS (WebGL)
- **DB**: SQLite (with FTS5 search)
- **Storage**: local filesystem under `data/`
- **AI (optional)**: Moondream Station (local) or Hugging Face endpoint (worker)


<img src="screen-4.jpg" alt="Workspace selection and transforms" width="860" />

   <img src="screen-1.jpg" alt="Asset lightbox with AI caption/tags and segments" width="860" />

   <img src="screen-3.jpg" alt="Asset lightbox with AI caption/tags and segments" width="860" />

## What this is

This repo is an MVP for a fast, responsive design surface:

- Drop images onto the canvas (drag & drop)
- Pan/zoom an infinite board (with a minimap)
- Select / multi‑select, move, resize, delete
- Persist canvas layout and viewport per project
- Store assets + thumbnails on disk
- Search assets (filename + AI caption/tags)
- Optional background worker to caption/tag images via Moondream

## Core concepts (how the app thinks)

- **Project**: A workspace (and a folder on disk) that contains assets + a saved canvas layout.
- **Asset**: An imported image stored on disk with metadata in SQLite (name, size, dimensions, thumbnails).
- **Canvas object**: A placed instance of an asset with transform state (x/y/scale/rotation/z-index) persisted to the DB.
- **Viewport**: The current pan/zoom; persisted per project so you reopen exactly where you left off.
- **Search**: SQLite FTS5 over filename + AI caption/tags so you can find “dog”, “desert”, etc., not just `IMG_1234`.
- **AI enrichment (optional)**: A background worker fills in `asset_ai.caption`, `asset_ai.tags_json`, and (optionally) embeddings + segmentation rows.

## How it works (high level)

1. You import an image → it’s copied under `data/projects/{projectId}/...` and indexed in SQLite.
2. You place it on the canvas → a `canvas_objects` row stores transform + z-index so the layout is durable.
3. You search → SQLite FTS returns assets using filename and (optionally) AI metadata.
4. Optionally, the worker enriches assets → captions/tags (and optional embeddings/segments) are written back to SQLite.

## Quickstart (run the app)

Requirements:

- Node.js 20+
- Python 3.10+ (only needed for Moondream / worker)

Install and run:

```bash
cd web
npm install
npm run dev
```

Then open `http://localhost:3000`.

> `npm run dev` starts both Next.js and `moondream-station` (if installed). You may need to type `start` inside the Moondream Station REPL to start the REST API.

## Install Moondream Station (local)

Install the `moondream-station` CLI so it’s available on your PATH.

Recommended (via pipx):

```bash
python3 -m pip install --user pipx
python3 -m pipx ensurepath
pipx install moondream-station
```

Or (via pip):

```bash
python3 -m pip install --user moondream-station
```

Run it:

```bash
moondream-station
```

Inside the REPL:

- `models list`
- `models switch <name>`
- `start` (defaults to `http://127.0.0.1:2020/v1`)

Sanity check:

```bash
curl -s http://127.0.0.1:2020/health
```

## Optional: run the Moondream worker (caption/tags + embeddings)

The worker polls the shared SQLite DB (`data/moondream.sqlite3`) for images with `asset_ai.status = 'pending'` and writes back:

- `asset_ai.caption`
- `asset_ai.tags_json` (best‑effort)
- optional: caption embeddings + segmentation rows (schema exists)

Setup:

```bash
cd worker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python moondream_worker.py
```

Environment variables (examples):

```bash
# Local Moondream Station
export MOONDREAM_PROVIDER=local_station
export MOONDREAM_ENDPOINT=http://127.0.0.1:2020

# Hugging Face endpoint (generic adapter)
# export MOONDREAM_PROVIDER=huggingface
# export HF_ENDPOINT_URL="https://your-hf-endpoint"
# export HF_TOKEN="..."
```

## Repository structure

- `web/`: Next.js app (canvas UI, API routes, DB access layer)
- `worker/`: Python worker for asynchronous Moondream processing
- `moondream_batch.py`: standalone batch helper to hit a running Moondream Station REST API
- `data/`: local dev data (SQLite DB + per-project assets/thumbs/previews)

## Mermaid: database schema (SQLite)

```mermaid
erDiagram
  projects {
    TEXT id PK
    TEXT name
    TEXT created_at
    TEXT updated_at
  }

  assets {
    TEXT id PK
    TEXT project_id FK
    TEXT original_name
    TEXT mime_type
    INTEGER byte_size
    TEXT sha256
    TEXT storage_path
    TEXT storage_url
    TEXT thumb_path
    TEXT thumb_url
    INTEGER width
    INTEGER height
    TEXT created_at
  }

  asset_ai {
    TEXT asset_id PK, FK
    TEXT caption
    TEXT tags_json
    TEXT status
    TEXT model_version
    TEXT updated_at
  }

  canvas_objects {
    TEXT id PK
    TEXT project_id FK
    TEXT type
    TEXT asset_id FK
    REAL x
    REAL y
    REAL scale_x
    REAL scale_y
    REAL rotation
    REAL width
    REAL height
    INTEGER z_index
    TEXT props_json
    TEXT created_at
    TEXT updated_at
  }

  project_view {
    TEXT project_id PK, FK
    REAL world_x
    REAL world_y
    REAL zoom
    TEXT updated_at
  }

  asset_search {
    TEXT asset_id
    TEXT project_id
    TEXT original_name
    TEXT caption
    TEXT tags
  }

  asset_embeddings {
    TEXT asset_id PK, FK
    TEXT model
    INTEGER dim
    BLOB embedding
    TEXT updated_at
  }

  asset_segments {
    TEXT asset_id FK
    TEXT tag
    TEXT svg
    TEXT bbox_json
    TEXT updated_at
  }

  projects ||--o{ assets : has
  assets ||--|| asset_ai : has
  projects ||--o{ canvas_objects : has
  assets ||--o{ canvas_objects : referenced_by
  projects ||--|| project_view : has
  projects ||--o{ asset_search : indexes
  assets ||--|| asset_embeddings : embeds
  assets ||--o{ asset_segments : segments
```

## Mermaid: app architecture

```mermaid
flowchart LR
  U["Browser"] -->|HTTP| N["Next.js (web)"];
  N --> UI["PixiJS Canvas UI"];
  N --> API["API Routes"];
  API --> DB[("SQLite: data/moondream.sqlite3")];
  API --> FS[("Filesystem: data/projects/{projectId}/...")];
  W["worker/moondream_worker.py"] --> DB;
  W -->|HTTP| MS["Moondream Station (127.0.0.1:2020)"];
  W -->|optional HTTP| HF["Hugging Face Endpoint"];
```
