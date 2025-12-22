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


class ProviderError(Exception):
    pass


class MoondreamProvider:
    def caption_and_tags(self, image_path: str) -> Tuple[str, List[str]]:
        raise NotImplementedError

    def model_version(self) -> str:
        return "unknown"


class LocalStationProvider(MoondreamProvider):
    def __init__(self, endpoint: str):
        self.endpoint = endpoint.rstrip("/")

    def _encode_image_data_url(self, image_path: str) -> str:
        # Mirror moondream_batch.py behavior: image_url is a data: URL.
        import base64
        import mimetypes

        mime, _ = mimetypes.guess_type(image_path)
        if not mime:
            mime = "image/png"
        with open(image_path, "rb") as f:
            data = base64.b64encode(f.read()).decode("ascii")
        return f"data:{mime};base64,{data}"

    def caption_and_tags(self, image_path: str) -> Tuple[str, List[str]]:
        url = f"{self.endpoint}/v1/caption"
        body = {"stream": False, "length": "normal", "image_url": self._encode_image_data_url(image_path)}
        r = requests.post(url, json=body, timeout=180)
        if r.status_code >= 400:
            raise ProviderError(f"station caption failed: {r.status_code} {r.text}")
        data = r.json()
        caption = (data.get("caption") or data.get("text") or "").strip()
        if not caption:
            caption = json.dumps(data)
        # MVP heuristic tags: split caption into keywords (very simple).
        tags = [t.strip(" ,.!?;:()[]\"'").lower() for t in caption.split() if len(t) >= 4]
        tags = sorted(list({t for t in tags if t}))
        return caption, tags[:25]

    def model_version(self) -> str:
        return "moondream_station"


class HuggingFaceProvider(MoondreamProvider):
    def __init__(self, endpoint_url: str, token: str):
        self.endpoint_url = endpoint_url
        self.token = token

    def caption_and_tags(self, image_path: str) -> Tuple[str, List[str]]:
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

        tags = [t.strip(" ,.!?;:()[]\"'").lower() for t in caption.split() if len(t) >= 4]
        tags = sorted(list({t for t in tags if t}))
        return caption, tags[:25]

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
    return con


def fetch_next_job(con: sqlite3.Connection) -> Optional[Job]:
    row = con.execute(
        """
        SELECT a.id AS asset_id, a.project_id, a.original_name, a.mime_type, a.storage_path
        FROM assets a
        JOIN asset_ai ai ON ai.asset_id = a.id
        WHERE ai.status = 'pending' AND a.mime_type LIKE 'image/%'
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
                caption, tags = provider.caption_and_tags(job.storage_path)
                con.execute("BEGIN")
                write_results(
                    con,
                    job.asset_id,
                    caption=caption,
                    tags=tags,
                    status="done",
                    model_version=provider.model_version(),
                )
                update_search_index(con, job.asset_id)
                con.execute("COMMIT")
                print(f"[worker] done asset={job.asset_id}")
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


