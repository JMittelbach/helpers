from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Iterable

from .models import DatasetRecord


def _ensure_parent(path: Path) -> None:
    if path.parent and not path.parent.exists():
        path.parent.mkdir(parents=True, exist_ok=True)


def write_records(path: str, records: Iterable[DatasetRecord]) -> None:
    p = Path(path)
    _ensure_parent(p)
    rows = [r.to_dict() for r in records]

    if p.suffix.lower() == ".json":
        p.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
        return

    fieldnames = [
        "source",
        "accession",
        "title",
        "summary",
        "organism",
        "pubdate",
        "n_samples",
        "relevance_score",
        "geo_url",
        "supplementary_dir",
        "user_query",
        "paper_ids",
        "paper_count",
        "latest_paper_year",
        "latest_paper_title",
        "cell_type_hits",
    ]
    with p.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for row in rows:
            w.writerow(row)


def read_records(path: str) -> list[DatasetRecord]:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(path)

    if p.suffix.lower() == ".json":
        items = json.loads(p.read_text(encoding="utf-8"))
        return [DatasetRecord.from_dict(x) for x in items]

    with p.open("r", newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    return [DatasetRecord.from_dict(x) for x in rows]


def write_manifest(path: str, rows: list[dict[str, str]]) -> None:
    p = Path(path)
    _ensure_parent(p)

    if p.suffix.lower() == ".json":
        p.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
        return

    fieldnames = ["source", "accession", "title", "file_name", "file_url"]
    with p.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        for row in rows:
            w.writerow(row)


def read_manifest(path: str) -> list[dict[str, str]]:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(path)

    if p.suffix.lower() == ".json":
        return json.loads(p.read_text(encoding="utf-8"))

    with p.open("r", newline="", encoding="utf-8") as f:
        return [dict(x) for x in csv.DictReader(f)]
