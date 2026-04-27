from __future__ import annotations

import re
from typing import Iterable

from .celltypes import match_cell_types
from .models import DatasetRecord


def _extract_year(date_text: str) -> int | None:
    m = re.search(r"\b(19|20)\d{2}\b", date_text or "")
    if not m:
        return None
    return int(m.group(0))


def _contains_all(text: str, tokens: list[str]) -> bool:
    lowered = text.lower()
    return all(t.lower() in lowered for t in tokens)


def _contains_any(text: str, tokens: list[str]) -> bool:
    lowered = text.lower()
    return any(t.lower() in lowered for t in tokens)


def filter_records(
    records: Iterable[DatasetRecord],
    organism: str | None = None,
    since_year: int | None = None,
    must_contain: list[str] | None = None,
    exclude: list[str] | None = None,
    min_score: float = 0.0,
    cell_types: list[str] | None = None,
    cell_mode: str = "any",
) -> list[DatasetRecord]:
    must_contain = must_contain or []
    exclude = exclude or []
    cell_types = cell_types or []
    out: list[DatasetRecord] = []

    for r in records:
        text_blob = f"{r.title}\n{r.summary}\n{r.organism}"
        r.cell_type_hits = ""

        if organism and organism.lower() not in r.organism.lower():
            continue
        if since_year is not None:
            y = _extract_year(r.pubdate)
            if y is not None and y < since_year:
                continue
        if cell_types:
            matched, hits = match_cell_types(text_blob, requested_terms=cell_types, mode=cell_mode)
            if not matched:
                continue
            r.cell_type_hits = "; ".join(hits)
        if must_contain and not _contains_all(text_blob, must_contain):
            continue
        if exclude and _contains_any(text_blob, exclude):
            continue
        if r.relevance_score < min_score:
            continue

        out.append(r)

    return sorted(out, key=lambda x: x.relevance_score, reverse=True)
