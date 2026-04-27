from __future__ import annotations

import re

from .models import DatasetRecord


ANNOTATION_METHOD_KEYWORDS: dict[str, list[str]] = {
    "seurat": ["seurat", "label transfer", "transfer anchors"],
    "singler": ["singler", "single r"],
    "celltypist": ["celltypist"],
    "azimuth": ["azimuth"],
    "scanvi": ["scanvi", "sc anvi", "scvi", "scvi-tools"],
    "scmap": ["scmap"],
    "garnett": ["garnett"],
    "cellassign": ["cellassign"],
    "sctype": ["sctype", "sc type"],
    "scpred": ["scpred", "single cell prediction"],
    "clustifyr": ["clustifyr"],
    "scnym": ["scnym"],
    "ingest": ["scanpy ingest", "ingest"],
    "harmony": ["harmony integration", "harmony"],
    "cell_ontology": ["cell ontology", "cl ontology"],
    "marker_based": ["marker gene", "canonical marker", "marker-based", "manual annotation"],
    "lab_manual": [
        "manual annotation",
        "manual curation",
        "expert curated",
        "expert review",
        "manual gating",
        "flow cytometry",
        "facs",
        "facs sorted",
        "cell sorting",
        "sorted cells",
        "immunophenotyping",
        "marker validated",
        "hand curated",
        "curated annotation",
        "ground truth",
    ],
}

ANNOTATION_QUALITY_KEYWORDS = [
    "cell ontology",
    "expert curated",
    "manual curation",
    "validated",
    "consensus annotation",
    "reference atlas",
    "flow cytometry",
    "facs",
    "manual gating",
    "expert review",
    "double checked",
    "cross validation",
    "benchmark",
    "ground truth",
    "immunophenotyping",
    "cell sorting",
    "facs sorted",
    "marker validated",
    "hand curated",
]

FINE_TCELL_KEYWORDS = [
    "naive cd4",
    "naive cd8",
    "effector memory",
    "central memory",
    "treg",
    "regulatory t",
    "th1",
    "th17",
    "tfh",
    "follicular helper t",
    "exhausted t",
    "cytotoxic t",
    "mait",
    "gamma delta t",
    "gd t",
]


def _normalize(text: str) -> str:
    lowered = text.lower()
    lowered = lowered.replace("+", " plus ")
    lowered = re.sub(r"[\/_\-]+", " ", lowered)
    lowered = re.sub(r"[^a-z0-9\s]", " ", lowered)
    lowered = re.sub(r"\s+", " ", lowered).strip()
    return lowered


def _contains_phrase(normalized_text: str, phrase: str) -> bool:
    p = _normalize(phrase)
    if not p:
        return False
    return f" {p} " in f" {normalized_text} "


def _has_generic_annotation_hint(text: str) -> bool:
    normalized = _normalize(text)
    return "cell type" in normalized and ("annotat" in normalized or "label" in normalized)


def analyze_annotation_text(text: str) -> dict[str, object]:
    normalized = _normalize(text)

    method_hits: list[str] = []
    evidence_hits: list[str] = []
    for method, keywords in ANNOTATION_METHOD_KEYWORDS.items():
        for keyword in keywords:
            if _contains_phrase(normalized, keyword):
                method_hits.append(method)
                evidence_hits.append(keyword)
                break

    quality_hits = [k for k in ANNOTATION_QUALITY_KEYWORDS if _contains_phrase(normalized, k)]
    fine_t_hits = [k for k in FINE_TCELL_KEYWORDS if _contains_phrase(normalized, k)]

    score = 0.0
    score += min(0.55, 0.18 * len(method_hits))
    score += min(0.25, 0.07 * len(quality_hits))
    score += min(0.20, 0.05 * len(fine_t_hits))
    if _has_generic_annotation_hint(normalized):
        score += 0.1
    score = min(1.0, round(score, 3))

    if score >= 0.7:
        tier = "high"
    elif score >= 0.35:
        tier = "medium"
    else:
        tier = "low"

    return {
        "methods": sorted(set(method_hits)),
        "evidence": sorted(set(evidence_hits + quality_hits)),
        "fine_t_hits": sorted(set(fine_t_hits)),
        "confidence": score,
        "quality_tier": tier,
    }


def annotate_record(record: DatasetRecord) -> None:
    parts = [
        ("title", record.title or ""),
        ("summary", record.summary or ""),
        ("paper_title", record.latest_paper_title or ""),
    ]
    merged_methods: set[str] = set()
    merged_evidence: set[str] = set()
    merged_tcell: set[str] = set()
    signal_sources: list[str] = []
    max_conf = 0.0

    for source_name, text in parts:
        if not text.strip():
            continue
        analysis = analyze_annotation_text(text)
        merged_methods.update(str(x) for x in analysis["methods"])
        merged_evidence.update(str(x) for x in analysis["evidence"])
        merged_tcell.update(str(x) for x in analysis["fine_t_hits"])
        max_conf = max(max_conf, float(analysis["confidence"]))

        has_signal = bool(analysis["methods"] or analysis["evidence"] or analysis["fine_t_hits"] or _has_generic_annotation_hint(text))
        if has_signal:
            signal_sources.append(source_name)

    joined = "\n".join(text for _, text in parts if text.strip())
    full = analyze_annotation_text(joined)
    conf = max(float(full["confidence"]), max_conf)
    if len(signal_sources) > 1:
        conf = min(1.0, conf + 0.05 * (len(signal_sources) - 1))
    conf = round(conf, 3)

    if conf >= 0.7:
        tier = "high"
    elif conf >= 0.35:
        tier = "medium"
    else:
        tier = "low"

    record.annotation_methods = "; ".join(sorted(merged_methods))
    record.annotation_evidence = "; ".join(sorted(merged_evidence))
    record.annotation_tcell_detail = "; ".join(sorted(merged_tcell))
    record.annotation_signal_sources = "; ".join(signal_sources)
    record.annotation_confidence = conf
    record.annotation_quality_tier = tier
