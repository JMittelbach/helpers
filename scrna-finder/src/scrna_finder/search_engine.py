from __future__ import annotations

from dataclasses import dataclass

from .annotation import annotate_record
from .cellxgene import search_cellxgene_datasets
from .geo import search_geo_series
from .literature import enrich_records_with_pubmed
from .models import DatasetRecord
from .sra import search_sra_projects

SUPPORTED_SOURCES = ("geo", "sra", "cellxgene")


@dataclass
class SearchReport:
    records: list[DatasetRecord]
    warnings: list[str]


def _network_hint(warnings: list[str]) -> str:
    merged = " ".join(warnings).lower()
    network_signals = [
        "network error",
        "nodename nor servname",
        "temporary failure in name resolution",
        "name or service not known",
        "connection refused",
        "timeout",
    ]
    if any(signal in merged for signal in network_signals):
        return (
            " Network/DNS access appears unavailable. "
            "Check internet connectivity and firewall/proxy settings, then retry."
        )
    return ""


def normalize_sources(sources: list[str] | None) -> list[str]:
    if not sources:
        return list(SUPPORTED_SOURCES)

    out: list[str] = []
    seen: set[str] = set()
    for raw in sources:
        key = raw.strip().lower()
        if not key:
            continue
        if key not in SUPPORTED_SOURCES:
            allowed = ", ".join(SUPPORTED_SOURCES)
            raise RuntimeError(f"Unsupported source '{raw}'. Allowed: {allowed}")
        if key not in seen:
            seen.add(key)
            out.append(key)
    return out or list(SUPPORTED_SOURCES)


def search_datasets(
    user_query: str,
    max_results: int = 100,
    email: str | None = None,
    api_key: str | None = None,
    scrna_only: bool = True,
    sources: list[str] | None = None,
    include_literature: bool = False,
    papers_per_dataset: int = 5,
) -> list[DatasetRecord]:
    report = search_datasets_report(
        user_query=user_query,
        max_results=max_results,
        email=email,
        api_key=api_key,
        scrna_only=scrna_only,
        sources=sources,
        include_literature=include_literature,
        papers_per_dataset=papers_per_dataset,
    )
    return report.records


def search_datasets_report(
    user_query: str,
    max_results: int = 100,
    email: str | None = None,
    api_key: str | None = None,
    scrna_only: bool = True,
    sources: list[str] | None = None,
    include_literature: bool = False,
    papers_per_dataset: int = 5,
) -> SearchReport:
    selected = normalize_sources(sources)
    records: list[DatasetRecord] = []
    warnings: list[str] = []

    if "geo" in selected:
        try:
            records.extend(
                search_geo_series(
                    user_query=user_query,
                    max_results=max_results,
                    email=email,
                    api_key=api_key,
                    scrna_only=scrna_only,
                )
            )
        except RuntimeError as e:
            warnings.append(f"GEO failed: {e}")
    if "sra" in selected:
        try:
            records.extend(
                search_sra_projects(
                    user_query=user_query,
                    max_results=max_results,
                    email=email,
                    api_key=api_key,
                    scrna_only=scrna_only,
                )
            )
        except RuntimeError as e:
            warnings.append(f"SRA failed: {e}")
    if "cellxgene" in selected:
        try:
            records.extend(
                search_cellxgene_datasets(
                    user_query=user_query,
                    max_results=max_results,
                    scrna_only=scrna_only,
                )
            )
        except RuntimeError as e:
            warnings.append(f"CELLxGENE failed: {e}")

    if include_literature:
        try:
            enrich_records_with_pubmed(
                records=records,
                email=email,
                api_key=api_key,
                papers_per_dataset=papers_per_dataset,
            )
        except RuntimeError as e:
            warnings.append(f"Literature enrichment failed: {e}")

    for record in records:
        annotate_record(record)

    if not records and warnings:
        raise RuntimeError("All selected sources failed. " + " | ".join(warnings) + _network_hint(warnings))

    sorted_records = sorted(records, key=lambda x: x.relevance_score, reverse=True)
    return SearchReport(records=sorted_records, warnings=warnings)
