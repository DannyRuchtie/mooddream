#!/usr/bin/env python3
"""
Moondream asset worker.

Polls the shared SQLite DB for assets with asset_ai.status='pending' and writes back:
- caption
- tags_json (best-effort)
- status transitions: pending -> processing -> done/failed

Supports providers:
- local_station: Moondream Station REST API (default http://127.0.0.1:2020/v1)
- huggingface: a Hugging Face endpoint (URL + token), via a small adapter

This is intentionally simple for MVP: single-process polling, no Redis.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import requests
from requests import RequestException

_EMBEDDER = None
_EMBEDDER_MODEL_NAME = None


def repo_root_from_here() -> str:
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def default_db_path() -> str:
    return os.path.join(repo_root_from_here(), "data", "moondream.sqlite3")


@dataclass
class Job:
    asset_id: str
    project_id: str
    original_name: str
    mime_type: str
    storage_path: str
    sha256: str


class ProviderError(Exception):
    pass


class MoondreamProvider:
    def caption(self, image_path: str, length: str = "normal") -> str:
        raise NotImplementedError

    def detect(self, image_path: str, obj: str) -> Any:
        raise NotImplementedError

    def segment(self, image_path: str, obj: str) -> Any:
        raise NotImplementedError

    def query(self, image_path: str, question: str) -> str:
        raise NotImplementedError

    def model_version(self) -> str:
        return "unknown"


class LocalStationProvider(MoondreamProvider):
    def __init__(self, endpoint: str):
        # Allow either base host (http://localhost:2021) or an already versioned
        # endpoint (http://localhost:2021/v1). We normalize to the base host.
        e = endpoint.rstrip("/")
        if e.endswith("/v1"):
            e = e[:-3]
        self.endpoint = e

    def _encode_image_data_url(self, image_path: str) -> str:
        """
        Send images as a data: URL (Station supports this).

        IMPORTANT: Some images can time out if we send the full-resolution bytes.
        We therefore downscale + JPEG-encode by default for speed and reliability.
        """
        import base64
        import io
        import mimetypes

        # Allow opting out for debugging.
        raw_mode = (os.getenv("MOONDREAM_RAW_IMAGE_BYTES", "0") or "0").lower() in ("1", "true", "yes")
        if raw_mode:
            mime, _ = mimetypes.guess_type(image_path)
            if not mime:
                mime = "image/png"
            with open(image_path, "rb") as f:
                data = base64.b64encode(f.read()).decode("ascii")
            return f"data:{mime};base64,{data}"

        max_side = int(os.getenv("MOONDREAM_MAX_IMAGE_SIDE", "1024") or "1024")
        jpeg_quality = int(os.getenv("MOONDREAM_JPEG_QUALITY", "85") or "85")

        try:
            from PIL import Image  # type: ignore

            with Image.open(image_path) as im:
                im = im.convert("RGB")
                w, h = im.size
                if max_side > 0 and max(w, h) > max_side:
                    scale = max_side / float(max(w, h))
                    nw = max(1, int(round(w * scale)))
                    nh = max(1, int(round(h * scale)))
                    resample = getattr(Image, "Resampling", Image).LANCZOS
                    im = im.resize((nw, nh), resample=resample)

                buf = io.BytesIO()
                im.save(buf, format="JPEG", quality=jpeg_quality, optimize=True)
                data = base64.b64encode(buf.getvalue()).decode("ascii")
                return f"data:image/jpeg;base64,{data}"
        except Exception:
            # Fallback: raw bytes in a data URL.
            mime, _ = mimetypes.guess_type(image_path)
            if not mime:
                mime = "image/png"
            with open(image_path, "rb") as f:
                data = base64.b64encode(f.read()).decode("ascii")
            return f"data:{mime};base64,{data}"

    def caption(self, image_path: str, length: str = "normal") -> str:
        url = f"{self.endpoint}/v1/caption"
        body = {"stream": False, "length": length, "image_url": self._encode_image_data_url(image_path)}
        try:
            r = requests.post(url, json=body, timeout=180)
        except RequestException as exc:
            raise ProviderError(f"station caption request failed: {exc}") from exc
        if r.status_code >= 400:
            raise ProviderError(f"station caption failed: {r.status_code} {r.text}")
        data = r.json()
        if isinstance(data, dict) and (data.get("error") or data.get("status") in ("rejected", "timeout")):
            raise ProviderError(f"station caption error: {data}")
        caption = (data.get("caption") or data.get("text") or "").strip()
        if not caption:
            caption = json.dumps(data)
        return caption

    def detect(self, image_path: str, obj: str) -> Any:
        url = f"{self.endpoint}/v1/detect"
        body = {"stream": False, "object": obj, "image_url": self._encode_image_data_url(image_path)}
        try:
            r = requests.post(url, json=body, timeout=180)
        except RequestException as exc:
            raise ProviderError(f"station detect request failed: {exc}") from exc
        if r.status_code >= 400:
            raise ProviderError(f"station detect failed: {r.status_code} {r.text}")
        data = r.json()
        if isinstance(data, dict) and (data.get("error") or data.get("status") in ("rejected", "timeout")):
            raise ProviderError(f"station detect error: {data}")
        return data

    def segment(self, image_path: str, obj: str) -> Any:
        url = f"{self.endpoint}/v1/segment"
        body = {"stream": False, "object": obj, "image_url": self._encode_image_data_url(image_path)}
        try:
            r = requests.post(url, json=body, timeout=180)
        except RequestException as exc:
            raise ProviderError(f"station segment request failed: {exc}") from exc
        if r.status_code >= 400:
            raise ProviderError(f"station segment failed: {r.status_code} {r.text}")
        data = r.json()
        if isinstance(data, dict) and (data.get("error") or data.get("status") in ("rejected", "timeout")):
            raise ProviderError(f"station segment error: {data}")
        return data

    def query(self, image_path: str, question: str) -> str:
        url = f"{self.endpoint}/v1/query"
        body = {"stream": False, "question": question, "image_url": self._encode_image_data_url(image_path)}
        try:
            r = requests.post(url, json=body, timeout=180)
        except RequestException as exc:
            raise ProviderError(f"station query request failed: {exc}") from exc
        if r.status_code >= 400:
            raise ProviderError(f"station query failed: {r.status_code} {r.text}")
        data = r.json()
        if isinstance(data, dict) and (data.get("error") or data.get("status") in ("rejected", "timeout")):
            raise ProviderError(f"station query error: {data}")
        text = (data.get("answer") or data.get("text") or data.get("caption") or "").strip()
        if not text:
            text = json.dumps(data)
        return text

    def model_version(self) -> str:
        return "moondream_station"


class HuggingFaceProvider(MoondreamProvider):
    def __init__(self, endpoint_url: str, token: str):
        self.endpoint_url = endpoint_url
        self.token = token

    def caption(self, image_path: str, length: str = "normal") -> str:
        # This is intentionally generic; different HF endpoints have different schemas.
        # You can adapt this to your specific endpoint contract.
        with open(image_path, "rb") as f:
            img_bytes = f.read()

        headers = {"Authorization": f"Bearer {self.token}"}
        r = requests.post(self.endpoint_url, headers=headers, data=img_bytes, timeout=180)
        if r.status_code >= 400:
            raise ProviderError(f"hf failed: {r.status_code} {r.text}")
        data: Any = r.json()

        # Best-effort parsing:
        if isinstance(data, dict):
            caption = (
                data.get("caption")
                or data.get("generated_text")
                or data.get("text")
                or data.get("answer")
                or ""
            )
            caption = str(caption).strip()
        elif isinstance(data, list) and data and isinstance(data[0], dict):
            caption = str(data[0].get("generated_text") or data[0].get("text") or "").strip()
        else:
            caption = str(data).strip()

        if not caption:
            caption = json.dumps(data)
        return caption

    def detect(self, image_path: str, obj: str) -> Any:
        raise ProviderError("detect is not supported for the huggingface provider in this worker")

    def segment(self, image_path: str, obj: str) -> Any:
        raise ProviderError("segment is not supported for the huggingface provider in this worker")

    def query(self, image_path: str, question: str) -> str:
        raise ProviderError("query is not supported for the huggingface provider in this worker")

    def model_version(self) -> str:
        return "huggingface_endpoint"


def get_provider() -> MoondreamProvider:
    provider = os.getenv("MOONDREAM_PROVIDER", "local_station")
    if provider == "local_station":
        endpoint = os.getenv("MOONDREAM_ENDPOINT", "http://127.0.0.1:2020")
        return LocalStationProvider(endpoint=endpoint)
    if provider == "huggingface":
        url = os.environ["HF_ENDPOINT_URL"]
        token = os.environ["HF_TOKEN"]
        return HuggingFaceProvider(endpoint_url=url, token=token)
    raise RuntimeError(f"Unknown MOONDREAM_PROVIDER={provider}")


def connect(db_path: str) -> sqlite3.Connection:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA busy_timeout = 5000")
    # Best-effort schema ensure so the worker can run before the Next.js app has applied migrations.
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS asset_embeddings (
          asset_id TEXT PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
          model TEXT NOT NULL,
          dim INTEGER NOT NULL,
          embedding BLOB,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS asset_segments (
          asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
          tag TEXT NOT NULL,
          svg TEXT,
          bbox_json TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (asset_id, tag)
        )
        """
    )
    con.execute("CREATE INDEX IF NOT EXISTS asset_segments_tag_idx ON asset_segments(tag)")
    return con


def fetch_next_job(con: sqlite3.Connection) -> Optional[Job]:
    row = con.execute(
        """
        SELECT a.id AS asset_id, a.project_id, a.original_name, a.mime_type, a.storage_path, a.sha256
        FROM assets a
        JOIN asset_ai ai ON ai.asset_id = a.id
        WHERE ai.status IN ('pending', 'processing') AND a.mime_type LIKE 'image/%'
        ORDER BY ai.updated_at ASC
        LIMIT 1
        """
    ).fetchone()
    if not row:
        return None
    return Job(
        asset_id=row["asset_id"],
        project_id=row["project_id"],
        original_name=row["original_name"],
        mime_type=row["mime_type"],
        storage_path=row["storage_path"],
        sha256=row["sha256"],
    )


def set_status(con: sqlite3.Connection, asset_id: str, status: str) -> None:
    con.execute(
        "UPDATE asset_ai SET status = ?, updated_at = datetime('now') WHERE asset_id = ?",
        (status, asset_id),
    )


def write_results(
    con: sqlite3.Connection,
    asset_id: str,
    caption: str,
    tags: List[str],
    status: str,
    model_version: str,
) -> None:
    con.execute(
        """
        UPDATE asset_ai
        SET caption = ?,
            tags_json = ?,
            status = ?,
            model_version = ?,
            updated_at = datetime('now')
        WHERE asset_id = ?
        """,
        (caption, json.dumps(tags), status, model_version, asset_id),
    )


def update_search_index(con: sqlite3.Connection, asset_id: str) -> None:
    row = con.execute(
        """
        SELECT a.id, a.project_id, a.original_name, ai.caption, ai.tags_json
        FROM assets a
        LEFT JOIN asset_ai ai ON ai.asset_id = a.id
        WHERE a.id = ?
        """,
        (asset_id,),
    ).fetchone()
    if not row:
        return
    tags_text = ""
    try:
        tags = json.loads(row["tags_json"] or "[]")
        if isinstance(tags, list):
            tags_text = " ".join([str(t) for t in tags if t])
    except Exception:
        tags_text = ""

    # Keep parity with TS: delete then insert.
    con.execute("DELETE FROM asset_search WHERE asset_id = ?", (asset_id,))
    con.execute(
        """
        INSERT INTO asset_search (asset_id, project_id, original_name, caption, tags)
        VALUES (?, ?, ?, ?, ?)
        """,
        (row["id"], row["project_id"], row["original_name"], row["caption"] or "", tags_text),
    )

def _tokenize_candidates(text: str) -> List[str]:
    # Very lightweight candidate extraction (MVP). We keep it deterministic and cheap.
    # Note: detect will be the filter/ground-truth.
    stop = {
        "the",
        "and",
        "with",
        "without",
        "from",
        "into",
        "over",
        "under",
        "near",
        "behind",
        "front",
        "left",
        "right",
        "top",
        "bottom",
        "this",
        "that",
        "these",
        "those",
        "there",
        "here",
        "image",
        "photo",
        "picture",
        "view",
        "scene",
        "very",
        "more",
        "most",
        "some",
        "many",
        "few",
        "one",
        "two",
        "three",
    }
    raw = (
        text.lower()
        .replace("\n", " ")
        .replace("\t", " ")
        .replace("/", " ")
        .replace("\\", " ")
    )
    tokens = []
    buf = []
    for ch in raw:
        if "a" <= ch <= "z" or ch == " ":
            buf.append(ch)
        else:
            buf.append(" ")
    for t in "".join(buf).split():
        if len(t) < 3:
            continue
        if t in stop:
            continue
        tokens.append(t)
    # Preserve rough relevance by first occurrence order, but de-dupe.
    seen = set()
    out = []
    for t in tokens:
        if t in seen:
            continue
        seen.add(t)
        out.append(t)
    return out


def _extract_detect_boxes(detect_response: Any) -> List[Dict[str, Any]]:
    """
    Normalize Moondream detect responses into a list of boxes.
    We keep this tolerant because response shapes can vary by model/version.
    """
    if not detect_response:
        return []
    data = detect_response
    # Common shapes we attempt:
    # - { "objects": [ {x,y,w,h,score?} ] }
    # - { "detections": [ {box:{x,y,w,h}, score} ] }
    # - { "boxes": [ [x1,y1,x2,y2], ... ] }
    # - { "result": { ... } }
    if isinstance(data, dict) and "result" in data:
        data = data.get("result")
    if isinstance(data, dict):
        for key in ("objects", "detections", "boxes"):
            if key in data:
                data = data.get(key)
                break
    boxes: List[Dict[str, Any]] = []
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                if all(k in item for k in ("x", "y", "w", "h")):
                    boxes.append(
                        {
                            "x": float(item.get("x")),
                            "y": float(item.get("y")),
                            "w": float(item.get("w")),
                            "h": float(item.get("h")),
                            "score": item.get("score"),
                        }
                    )
                    continue
                if "box" in item and isinstance(item["box"], dict):
                    b = item["box"]
                    if all(k in b for k in ("x", "y", "w", "h")):
                        boxes.append(
                            {
                                "x": float(b.get("x")),
                                "y": float(b.get("y")),
                                "w": float(b.get("w")),
                                "h": float(b.get("h")),
                                "score": item.get("score"),
                            }
                        )
                        continue
            if isinstance(item, (list, tuple)) and len(item) == 4:
                x1, y1, x2, y2 = item
                try:
                    x1f = float(x1)
                    y1f = float(y1)
                    x2f = float(x2)
                    y2f = float(y2)
                    boxes.append({"x": x1f, "y": y1f, "w": x2f - x1f, "h": y2f - y1f})
                except Exception:
                    continue
    return [b for b in boxes if b.get("w") and b.get("h") and b.get("w") > 0 and b.get("h") > 0]


def _extract_segment_svg(segment_response: Any) -> Optional[str]:
    if not segment_response:
        return None
    if isinstance(segment_response, str):
        return segment_response.strip() or None
    if isinstance(segment_response, dict):
        for key in ("svg", "mask_svg", "result", "output"):
            val = segment_response.get(key)
            if isinstance(val, str) and val.strip().startswith("<svg"):
                return val.strip()
        # Sometimes nested: {result:{svg:"<svg ..."}}
        if isinstance(segment_response.get("result"), dict):
            r = segment_response["result"]
            if isinstance(r.get("svg"), str) and r["svg"].strip().startswith("<svg"):
                return r["svg"].strip()
    return None


def upsert_segment_row(
    con: sqlite3.Connection, asset_id: str, tag: str, svg: Optional[str], bbox_json: Optional[str]
) -> None:
    con.execute(
        """
        INSERT INTO asset_segments (asset_id, tag, svg, bbox_json, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(asset_id, tag) DO UPDATE SET
          svg=excluded.svg,
          bbox_json=excluded.bbox_json,
          updated_at=excluded.updated_at
        """,
        (asset_id, tag, svg, bbox_json),
    )

def upsert_embedding_row(
    con: sqlite3.Connection,
    asset_id: str,
    model: str,
    dim: int,
    embedding_blob: Optional[bytes],
) -> None:
    con.execute(
        """
        INSERT INTO asset_embeddings (asset_id, model, dim, embedding, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(asset_id) DO UPDATE SET
          model=excluded.model,
          dim=excluded.dim,
          embedding=excluded.embedding,
          updated_at=excluded.updated_at
        """,
        (asset_id, model, dim, embedding_blob),
    )


def _get_embedder() -> Tuple[Optional[Any], Optional[str]]:
    """
    Lazily initialize sentence-transformers embedding model.
    If deps are missing, return (None, None) and continue without vector search.
    """
    global _EMBEDDER, _EMBEDDER_MODEL_NAME
    model_name = os.getenv("MOONDREAM_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    if _EMBEDDER is not None and _EMBEDDER_MODEL_NAME == model_name:
        return _EMBEDDER, _EMBEDDER_MODEL_NAME
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore

        _EMBEDDER = SentenceTransformer(model_name)
        _EMBEDDER_MODEL_NAME = model_name
        return _EMBEDDER, _EMBEDDER_MODEL_NAME
    except Exception as exc:
        print(f"[worker] embeddings disabled (sentence-transformers not available): {exc}")
        _EMBEDDER = None
        _EMBEDDER_MODEL_NAME = None
        return None, None


def embed_text_to_f32_blob(text: str) -> Tuple[Optional[str], Optional[int], Optional[bytes]]:
    emb, model_name = _get_embedder()
    if emb is None or model_name is None:
        return None, None, None
    try:
        import numpy as np  # type: ignore

        vec = emb.encode([text], normalize_embeddings=True)[0]
        arr = np.asarray(vec, dtype=np.float32)
        return model_name, int(arr.shape[0]), arr.tobytes()
    except Exception as exc:
        print(f"[worker] embedding failed: {exc}")
        return None, None, None


def delete_segments_not_in(con: sqlite3.Connection, asset_id: str, keep_tags: List[str]) -> None:
    if not keep_tags:
        con.execute("DELETE FROM asset_segments WHERE asset_id = ?", (asset_id,))
        return
    placeholders = ",".join(["?"] * len(keep_tags))
    con.execute(
        f"DELETE FROM asset_segments WHERE asset_id = ? AND tag NOT IN ({placeholders})",
        [asset_id, *keep_tags],
    )


def _slugify_filename_base(text: str) -> str:
    raw = (text or "").strip().lower()
    # Keep it filesystem-friendly.
    out: List[str] = []
    dash = False
    for ch in raw:
        if "a" <= ch <= "z" or "0" <= ch <= "9":
            out.append(ch)
            dash = False
        else:
            if not dash:
                out.append("-")
                dash = True
    slug = "".join(out).strip("-")
    slug = "-".join([p for p in slug.split("-") if p])
    # Reasonable length for filenames.
    return slug[:64]


def _pick_extension(job: Job) -> str:
    ext = os.path.splitext(job.storage_path or "")[1]
    if ext:
        return ext
    ext2 = os.path.splitext(job.original_name or "")[1]
    return ext2 or ""


def maybe_rename_asset(con: sqlite3.Connection, job: Job, caption: str, provider: MoondreamProvider) -> None:
    """
    Generate a nicer name via Moondream and:
    - update assets.original_name (display/search)
    - create a named alias file on disk (symlink) without touching the content-addressed storage file
    """
    if (os.getenv("MOONDREAM_GENERATE_NAMES", "1") or "1") in ("0", "false", "False"):
        return

    # Ask Moondream for a concise title for the image.
    prompt = (
        "Give a short descriptive title for this image suitable as a filename. "
        "Respond with ONLY the title words (no punctuation, no quotes), max 6 words."
    )
    title = ""
    try:
        title = provider.query(job.storage_path, prompt).strip()
    except Exception:
        title = ""

    # Fallback: derive from caption if query fails.
    if not title:
        title = (caption or "").strip()
    if not title:
        return

    base = _slugify_filename_base(title)
    if not base:
        return

    ext = _pick_extension(job)
    sha8 = (job.sha256 or "")[:8]
    suffix = f"--{sha8}" if sha8 else ""
    pretty = f"{base}{suffix}{ext}"

    # Update DB display name.
    con.execute("UPDATE assets SET original_name = ? WHERE id = ?", (pretty, job.asset_id))

    # Create a friendly alias on disk (symlink) so the user has a readable filename too.
    if (os.getenv("MOONDREAM_CREATE_NAMED_ALIAS", "1") or "1") in ("0", "false", "False"):
        return

    try:
        # storage_path: .../data/projects/<projectId>/assets/<sha>.ext
        project_root = os.path.dirname(os.path.dirname(job.storage_path))
        named_dir = os.path.join(project_root, "named")
        os.makedirs(named_dir, exist_ok=True)

        link_path = os.path.join(named_dir, pretty)

        # Best-effort cleanup of prior aliases for this asset (same sha8 + ext).
        if sha8 and ext:
            for fn in os.listdir(named_dir):
                if fn.endswith(f"--{sha8}{ext}") and fn != pretty:
                    try:
                        os.unlink(os.path.join(named_dir, fn))
                    except Exception:
                        pass

        if os.path.islink(link_path) or os.path.exists(link_path):
            try:
                os.unlink(link_path)
            except Exception:
                pass

        os.symlink(job.storage_path, link_path)
    except Exception:
        # Don't fail the whole job on filesystem alias issues.
        return


def main() -> int:
    db_path = os.getenv("MOONDREAM_DB_PATH", default_db_path())
    poll = float(os.getenv("MOONDREAM_POLL_SECONDS", "1.0"))

    provider = get_provider()
    print(f"[worker] db={db_path}")
    print(f"[worker] provider={provider.__class__.__name__} model={provider.model_version()}")

    while True:
        con = connect(db_path)
        try:
            job = fetch_next_job(con)
            if not job:
                con.close()
                time.sleep(poll)
                continue

            print(f"[worker] processing asset={job.asset_id} file={job.original_name}")
            con.execute("BEGIN")
            set_status(con, job.asset_id, "processing")
            con.execute("COMMIT")

            try:
                caption = provider.caption(job.storage_path, length="long")

                # Candidate tags are filtered by detect; we only store detect-confirmed tags.
                max_tags = int(os.getenv("MOONDREAM_SEGMENT_TOP_N", "8"))
                candidates = _tokenize_candidates(caption)

                kept_tags: List[str] = []
                bbox_by_tag: Dict[str, Any] = {}

                # Probe a few more candidates than we plan to keep, then stop once we have enough.
                for cand in candidates[: max(24, max_tags * 3)]:
                    if len(kept_tags) >= max_tags:
                        break
                    try:
                        detect_resp = provider.detect(job.storage_path, cand)
                        boxes = _extract_detect_boxes(detect_resp)
                        if not boxes:
                            continue
                        kept_tags.append(cand)
                        bbox_by_tag[cand] = {
                            "tag": cand,
                            "boxes": boxes,
                            "raw": detect_resp,
                        }
                    except Exception:
                        continue

                # Segment the kept tags (best-effort).
                segments: Dict[str, Optional[str]] = {}
                for tag in kept_tags:
                    try:
                        seg_resp = provider.segment(job.storage_path, tag)
                        segments[tag] = _extract_segment_svg(seg_resp)
                    except Exception:
                        segments[tag] = None

                # Compute caption embedding for semantic search (best-effort).
                emb_model, emb_dim, emb_blob = embed_text_to_f32_blob(caption)

                con.execute("BEGIN")
                write_results(
                    con,
                    job.asset_id,
                    caption=caption,
                    tags=kept_tags,
                    status="done",
                    model_version=provider.model_version(),
                )

                # Generate a nicer filename + create a named alias file (best-effort).
                maybe_rename_asset(con, job, caption=caption, provider=provider)

                if emb_model and emb_dim and emb_blob:
                    upsert_embedding_row(
                        con,
                        asset_id=job.asset_id,
                        model=emb_model,
                        dim=emb_dim,
                        embedding_blob=emb_blob,
                    )

                # Store per-tag segment + bbox payloads for highlight overlays.
                for tag in kept_tags:
                    bbox_json = None
                    try:
                        bbox_json = json.dumps(bbox_by_tag.get(tag))
                    except Exception:
                        bbox_json = None
                    upsert_segment_row(
                        con,
                        asset_id=job.asset_id,
                        tag=tag,
                        svg=segments.get(tag),
                        bbox_json=bbox_json,
                    )
                delete_segments_not_in(con, job.asset_id, kept_tags)

                update_search_index(con, job.asset_id)
                con.execute("COMMIT")
                print(f"[worker] done asset={job.asset_id}")
            except ProviderError as exc:
                # Treat station-side queue/timeouts as transient; re-queue with a small backoff.
                msg = str(exc).lower()
                transient = any(k in msg for k in ("queue is full", "rejected", "timeout", "timed out"))
                con.execute("BEGIN")
                if transient:
                    # Re-queue without poisoning the caption field.
                    write_results(
                        con,
                        job.asset_id,
                        caption="",
                        tags=[],
                        status="pending",
                        model_version=provider.model_version(),
                    )
                    delete_segments_not_in(con, job.asset_id, [])
                    update_search_index(con, job.asset_id)
                    con.execute("COMMIT")
                    sleep_s = float(os.getenv("MOONDREAM_RETRY_BACKOFF_SECONDS", "5.0"))
                    print(f"[worker] transient error; re-queued asset={job.asset_id}: {exc} (sleep {sleep_s}s)")
                    time.sleep(sleep_s)
                else:
                    write_results(
                        con,
                        job.asset_id,
                        caption="",
                        tags=[],
                        status="failed",
                        model_version=provider.model_version(),
                    )
                    delete_segments_not_in(con, job.asset_id, [])
                    update_search_index(con, job.asset_id)
                    con.execute("COMMIT")
                    print(f"[worker] failed asset={job.asset_id}: {exc}")
            except Exception as exc:
                con.execute("BEGIN")
                write_results(
                    con,
                    job.asset_id,
                    caption="",
                    tags=[],
                    status="failed",
                    model_version=provider.model_version(),
                )
                delete_segments_not_in(con, job.asset_id, [])
                update_search_index(con, job.asset_id)
                con.execute("COMMIT")
                print(f"[worker] failed asset={job.asset_id}: {exc}")
        finally:
            try:
                con.close()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())


