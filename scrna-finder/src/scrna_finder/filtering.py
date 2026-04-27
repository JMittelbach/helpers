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


def _split_tokens(field: str) -> list[str]:
    return [t.strip().lower() for t in field.split(";") if t.strip()]


ALL_CELL_TYPE_FILTER_TOKENS = {"all", "all cell types", "all cells", "any", "no filter", "none", "*", "alle"}

ANNOTATION_METHOD_ALIASES: dict[str, set[str]] = {
    "seurat": {"seurat"},
    "singler": {"singler"},
    "single r": {"singler"},
    "celltypist": {"celltypist"},
    "azimuth": {"azimuth"},
    "scanvi": {"scanvi"},
    "scvi": {"scanvi"},
    "scvi tools": {"scanvi"},
    "scmap": {"scmap"},
    "garnett": {"garnett"},
    "cellassign": {"cellassign"},
    "sctype": {"sctype"},
    "scpred": {"scpred"},
    "clustifyr": {"clustifyr"},
    "scnym": {"scnym"},
    "ingest": {"ingest"},
    "harmony": {"harmony"},
    "cell ontology": {"cell_ontology"},
    "marker based": {"marker_based"},
    "marker": {"marker_based"},
    "marker gene": {"marker_based"},
    "manual annotation": {"marker_based", "lab_manual"},
    "manual": {"marker_based", "lab_manual"},
    "lab": {"marker_based", "lab_manual"},
    "lab based": {"marker_based", "lab_manual"},
    "lab manual": {"marker_based", "lab_manual"},
    "expert curated": {"lab_manual"},
    "manual curation": {"lab_manual"},
    "manual gating": {"lab_manual"},
    "flow cytometry": {"lab_manual"},
    "facs": {"lab_manual"},
    "ground truth": {"lab_manual"},
}
MANUAL_LAB_METHODS = {"marker_based", "lab_manual"}
SOFTWARE_ANNOTATION_METHODS = {
    "seurat",
    "singler",
    "celltypist",
    "azimuth",
    "scanvi",
    "scmap",
    "garnett",
    "cellassign",
    "sctype",
    "scpred",
    "clustifyr",
    "scnym",
    "ingest",
    "harmony",
    "cell_ontology",
}


def _normalize_phrase(text: str) -> str:
    lowered = (text or "").strip().lower()
    lowered = re.sub(r"[/_\-]+", " ", lowered)
    lowered = re.sub(r"\s+", " ", lowered).strip()
    return lowered


def _expand_annotation_method_token(token: str) -> set[str]:
    normalized = _normalize_phrase(token)
    if not normalized:
        return set()
    alias_hits = ANNOTATION_METHOD_ALIASES.get(normalized)
    if alias_hits:
        return set(alias_hits)
    return {normalized.replace(" ", "_")}


def _normalize_requested_annotation_methods(methods: list[str]) -> set[str]:
    out: set[str] = set()
    for token in methods:
        out.update(_expand_annotation_method_token(token))
    return out


def _record_method_hits(record: DatasetRecord) -> set[str]:
    out: set[str] = set()
    for token in _split_tokens(record.annotation_methods):
        out.update(_expand_annotation_method_token(token))
    for token in _split_tokens(record.annotation_evidence):
        out.update(_expand_annotation_method_token(token))
    return out


def _normalize_cell_type_filters(cell_types: list[str]) -> list[str]:
    out: list[str] = []
    for raw in cell_types:
        cleaned = raw.strip()
        if not cleaned:
            continue
        if _normalize_phrase(cleaned) in ALL_CELL_TYPE_FILTER_TOKENS:
            return []
        out.append(cleaned)
    return out


def filter_records(
    records: Iterable[DatasetRecord],
    organism: str | None = None,
    since_year: int | None = None,
    must_contain: list[str] | None = None,
    exclude: list[str] | None = None,
    min_score: float = 0.0,
    cell_types: list[str] | None = None,
    cell_mode: str = "any",
    require_annotation: bool = False,
    min_annotation_confidence: float = 0.0,
    annotation_methods: list[str] | None = None,
    require_fine_tcell: bool = False,
    manual_lab_only: bool = False,
) -> list[DatasetRecord]:
    must_contain = must_contain or []
    exclude = exclude or []
    cell_types = _normalize_cell_type_filters(cell_types or [])
    annotation_methods = annotation_methods or []
    request_all_annotation_methods = any(_normalize_phrase(x) in {"all", "any", "*", "none", "no filter"} for x in annotation_methods)
    requested_annotation_methods = (
        set() if request_all_annotation_methods else _normalize_requested_annotation_methods(annotation_methods)
    )
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
        if require_annotation and r.annotation_confidence < max(0.3, min_annotation_confidence):
            continue
        if r.annotation_confidence < min_annotation_confidence:
            continue
        methods = _record_method_hits(r) if (requested_annotation_methods or manual_lab_only) else set()
        if requested_annotation_methods and not methods.intersection(requested_annotation_methods):
            continue
        if manual_lab_only:
            if not methods.intersection(MANUAL_LAB_METHODS):
                continue
            if methods.intersection(SOFTWARE_ANNOTATION_METHODS):
                continue
        if require_fine_tcell and not r.annotation_tcell_detail:
            continue

        out.append(r)

    return sorted(out, key=lambda x: x.relevance_score, reverse=True)
