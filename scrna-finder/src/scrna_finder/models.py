from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any


@dataclass
class PaperRecord:
    pmid: str
    title: str
    pubdate: str
    journal: str
    year: int | None
    url: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class DatasetRecord:
    source: str
    accession: str
    title: str
    summary: str
    organism: str
    pubdate: str
    n_samples: int | None
    relevance_score: float
    geo_url: str
    supplementary_dir: str
    user_query: str
    paper_ids: str = ""
    paper_count: int | None = None
    latest_paper_year: int | None = None
    latest_paper_pmid: str = ""
    latest_paper_url: str = ""
    latest_paper_title: str = ""
    cell_type_hits: str = ""
    annotation_methods: str = ""
    annotation_evidence: str = ""
    annotation_tcell_detail: str = ""
    annotation_signal_sources: str = ""
    annotation_confidence: float = 0.0
    annotation_quality_tier: str = "low"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "DatasetRecord":
        raw_n = value.get("n_samples")
        n_samples: int | None
        if raw_n in ("", None):
            n_samples = None
        else:
            try:
                n_samples = int(raw_n)
            except (TypeError, ValueError):
                n_samples = None

        raw_score = value.get("relevance_score", 0.0)
        try:
            score = float(raw_score)
        except (TypeError, ValueError):
            score = 0.0

        raw_paper_count = value.get("paper_count")
        paper_count: int | None
        if raw_paper_count in ("", None):
            paper_count = None
        else:
            try:
                paper_count = int(raw_paper_count)
            except (TypeError, ValueError):
                paper_count = None

        raw_latest_year = value.get("latest_paper_year")
        latest_paper_year: int | None
        if raw_latest_year in ("", None):
            latest_paper_year = None
        else:
            try:
                latest_paper_year = int(raw_latest_year)
            except (TypeError, ValueError):
                latest_paper_year = None

        raw_annotation_confidence = value.get("annotation_confidence", 0.0)
        try:
            annotation_confidence = float(raw_annotation_confidence)
        except (TypeError, ValueError):
            annotation_confidence = 0.0

        return cls(
            source=str(value.get("source", "GEO")),
            accession=str(value.get("accession", "")),
            title=str(value.get("title", "")),
            summary=str(value.get("summary", "")),
            organism=str(value.get("organism", "")),
            pubdate=str(value.get("pubdate", "")),
            n_samples=n_samples,
            relevance_score=score,
            geo_url=str(value.get("geo_url", "")),
            supplementary_dir=str(value.get("supplementary_dir", "")),
            user_query=str(value.get("user_query", "")),
            paper_ids=str(value.get("paper_ids", "")),
            paper_count=paper_count,
            latest_paper_year=latest_paper_year,
            latest_paper_pmid=str(value.get("latest_paper_pmid", "")),
            latest_paper_url=str(value.get("latest_paper_url", "")),
            latest_paper_title=str(value.get("latest_paper_title", "")),
            cell_type_hits=str(value.get("cell_type_hits", "")),
            annotation_methods=str(value.get("annotation_methods", "")),
            annotation_evidence=str(value.get("annotation_evidence", "")),
            annotation_tcell_detail=str(value.get("annotation_tcell_detail", "")),
            annotation_signal_sources=str(value.get("annotation_signal_sources", "")),
            annotation_confidence=annotation_confidence,
            annotation_quality_tier=str(value.get("annotation_quality_tier", "low")),
        )
