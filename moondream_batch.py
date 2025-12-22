#!/usr/bin/env python3
"""Batch helper for Moondream Station.

Drop one or more image paths (or directories) on the command line and this script
will call the running Moondream Station REST API for each image and print/save
responses. Start Moondream Station separately before using this helper.
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import sys
from pathlib import Path
from typing import Dict, Iterable, List

import requests

DEFAULT_ENDPOINT = "http://127.0.0.1:2020"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp", ".heic"}


def find_images(inputs: Iterable[str]) -> List[Path]:
    files: List[Path] = []
    seen = set()
    for raw in inputs:
        path = Path(raw).expanduser()
        if not path.exists():
            print(f"[warn] skipping missing path: {path}")
            continue

        if path.is_file() and path.suffix.lower() in IMAGE_EXTS:
            resolved = path.resolve()
            if resolved not in seen:
                files.append(resolved)
                seen.add(resolved)
            continue

        if path.is_dir():
            for candidate in sorted(path.rglob("*")):
                if candidate.is_file() and candidate.suffix.lower() in IMAGE_EXTS:
                    resolved = candidate.resolve()
                    if resolved not in seen:
                        files.append(resolved)
                        seen.add(resolved)
            continue

        print(f"[warn] not an image: {path}")

    return files


def encode_image(path: Path) -> str:
    mime, _ = mimetypes.guess_type(path.name)
    if not mime:
        mime = "image/png"
    data = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{data}"


def call_station(
    endpoint: str,
    function: str,
    image: Path,
    payload: Dict[str, str],
    timeout: float,
) -> Dict:
    body: Dict[str, str] = {"stream": False, **payload}
    body["image_url"] = encode_image(image)
    url = endpoint.rstrip("/") + f"/v1/{function}"

    try:
        response = requests.post(url, json=body, timeout=timeout)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as exc:
        raise RuntimeError(f"request failed for {image.name}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"invalid JSON response for {image.name}: {response.text}"
        ) from exc


def parse_params(pairs: Iterable[str]) -> Dict[str, str]:
    params: Dict[str, str] = {}
    for pair in pairs:
        if "=" not in pair:
            raise ValueError(f"invalid param '{pair}', expected key=value")
        key, value = pair.split("=", 1)
        params[key.strip()] = value.strip()
    return params


def pick_primary_text(result: Dict) -> str:
    """Extract a readable string from the API response for printing/saving."""
    preferred_keys = [
        "caption",
        "answer",
        "text",
        "output",
        "result",
        "response",
    ]
    for key in preferred_keys:
        value = result.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()

    string_chunks = [
        str(value).strip()
        for value in result.values()
        if isinstance(value, str) and value.strip()
    ]
    if string_chunks:
        return "\n\n".join(string_chunks)

    return json.dumps(result, indent=2)


def run() -> int:
    parser = argparse.ArgumentParser(description="Batch Moondream Station helper")
    parser.add_argument(
        "inputs",
        nargs="+",
        help="Image files or directories to process",
    )
    parser.add_argument(
        "--endpoint",
        default=DEFAULT_ENDPOINT,
        help="Base URL for the running Moondream Station service",
    )
    parser.add_argument(
        "--function",
        default="caption",
        help="Model function to call (e.g. caption, query, detect)",
    )
    parser.add_argument(
        "--question",
        help="Text prompt/question (sets both 'question' and 'object')",
    )
    parser.add_argument(
        "--length",
        choices=["short", "normal", "long"],
        help="Caption length hint when using the caption function",
    )
    parser.add_argument(
        "--param",
        action="append",
        default=[],
        help="Additional key=value pairs to add to the JSON payload",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Optional directory to store one .txt file per image",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=120.0,
        help="HTTP timeout in seconds for each request",
    )
    args = parser.parse_args()

    images = find_images(args.inputs)
    if not images:
        print("No images found. Nothing to do.")
        return 1

    try:
        extra = parse_params(args.param)
    except ValueError as exc:
        print(exc)
        return 1

    if args.question:
        extra.setdefault("question", args.question)
        extra.setdefault("object", args.question)
    if args.length:
        extra["length"] = args.length

    output_dir = args.output_dir
    if output_dir:
        output_dir.mkdir(parents=True, exist_ok=True)

    for image in images:
        print(f"\n=== {image} ===")
        try:
            result = call_station(
                args.endpoint, args.function, image, extra, args.timeout
            )
        except RuntimeError as exc:
            print(exc)
            continue

        text = pick_primary_text(result)
        print(text)

        stats = result.get("_stats") or result.get("stats")
        if stats:
            token_info = []
            if "tokens" in stats:
                token_info.append(f"tokens={stats['tokens']}")
            if "tokens_per_sec" in stats:
                token_info.append(f"tok/s={stats['tokens_per_sec']}")
            if token_info:
                print("(" + ", ".join(token_info) + ")")

        if output_dir:
            out_file = output_dir / f"{image.stem}-{args.function}.txt"
            out_file.write_text(text)
            print(f"saved → {out_file}")

    return 0


if __name__ == "__main__":
    sys.exit(run())
