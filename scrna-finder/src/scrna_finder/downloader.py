from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

import requests


def _pick_file_name(url: str) -> str:
    path = urlparse(url).path
    name = Path(path).name
    return name or "download.bin"


def _allowed(name: str, include: list[str], exclude: list[str]) -> bool:
    lowered = name.lower()
    if include and not any(p.lower() in lowered for p in include):
        return False
    if exclude and any(p.lower() in lowered for p in exclude):
        return False
    return True


def download_from_manifest(
    manifest_rows: list[dict[str, str]],
    destination: str,
    include: list[str] | None = None,
    exclude: list[str] | None = None,
    max_files: int = 0,
    dry_run: bool = False,
    timeout: int = 120,
) -> tuple[int, int]:
    include = include or []
    exclude = exclude or []
    dest = Path(destination)
    dest.mkdir(parents=True, exist_ok=True)

    downloaded = 0
    skipped = 0

    for row in manifest_rows:
        url = row.get("file_url", "").strip()
        accession = row.get("accession", "unknown").strip() or "unknown"
        if not url:
            skipped += 1
            continue

        name = row.get("file_name", "").strip() or _pick_file_name(url)
        if not _allowed(name=name, include=include, exclude=exclude):
            skipped += 1
            continue

        folder = dest / accession
        folder.mkdir(parents=True, exist_ok=True)
        output = folder / name

        if output.exists():
            skipped += 1
            continue

        if dry_run:
            print(f"[dry-run] {url} -> {output}")
            downloaded += 1
        else:
            with requests.get(url, stream=True, timeout=timeout) as r:
                r.raise_for_status()
                with output.open("wb") as f:
                    for chunk in r.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            f.write(chunk)
            print(f"[ok] {output}")
            downloaded += 1

        if max_files > 0 and downloaded >= max_files:
            break

    return downloaded, skipped
