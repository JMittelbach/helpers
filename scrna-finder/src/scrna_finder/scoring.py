from __future__ import annotations

import math
import re


POSITIVE_KEYWORDS = {
    "single-cell profiling": 2.1,
    "single cell profiling": 2.1,
    "single-cell": 1.4,
    "single cell": 1.4,
    "scrna-seq": 3.0,
    "scrnaseq": 3.0,
    "single cell rna": 3.2,
    "single-cell rna": 3.2,
    "single cell transcript": 2.8,
    "single-cell transcript": 2.8,
    "snrna-seq": 2.8,
    "single nucleus rna": 2.8,
    "single-nucleus rna": 2.8,
    "10x genomics": 1.5,
    "drop-seq": 1.0,
    "smart-seq": 1.0,
    "cellranger": 0.8,
}

NEGATIVE_KEYWORDS = {
    "microarray": -3.2,
    "bulk rna": -2.8,
    "bulk rna-seq": -3.0,
    "transcriptome sequencing": -1.2,
    "transcriptome sequencing data": -1.2,
    "rna sequencing of patient samples": -0.8,
    "chip-seq": -2.0,
    "atac-seq": -1.3,
    "proteomics": -1.5,
}


def _tokenize_query(text: str) -> list[str]:
    words = re.findall(r"[A-Za-z0-9\-]+", text.lower())
    return [w for w in words if len(w) >= 3]


def score_scrna_relevance(title: str, summary: str, user_query: str = "") -> float:
    blob = f"{title} {summary}".lower()
    raw = 0.0
    positive_hits = 0

    for k, w in POSITIVE_KEYWORDS.items():
        if k in blob:
            raw += w
            positive_hits += 1

    for k, w in NEGATIVE_KEYWORDS.items():
        if k in blob:
            raw += w

    for token in _tokenize_query(user_query):
        if token in blob:
            raw += 0.2

    # Guardrail: avoid over-scoring generic transcriptomics without clear single-cell evidence.
    if positive_hits == 0:
        raw -= 0.9

    # Smooth normalization to [0, 1].
    score = 1.0 / (1.0 + math.exp(-raw / 3.0))
    return round(score, 4)
