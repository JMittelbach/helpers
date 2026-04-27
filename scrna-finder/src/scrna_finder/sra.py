from __future__ import annotations

import re
from typing import Any

from .models import DatasetRecord
from .ncbi import esearch_ids, esummary_result, extract_pubmed_ids, to_int
from .scoring import score_scrna_relevance


def build_sra_query(user_query: str, scrna_only: bool = True) -> str:
    base = user_query.strip()
    if not scrna_only:
        return base if base else "transcriptome"

    sc_clause = (
        '"single cell"[All Fields] OR "single-cell"[All Fields] OR '
        '"single nucleus"[All Fields] OR "scRNA-seq"[All Fields] OR '
        '"snRNA-seq"[All Fields]'
    )
    if base:
        return f"({base}) AND ({sc_clause})"
    return sc_clause


def _pick(item: dict[str, Any], keys: list[str]) -> str:
    for key in keys:
        value = item.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _parse_n_samples(item: dict[str, Any], summary: str) -> int | None:
    for key in ("n_samples", "sample_count", "samples", "n_runs", "runs"):
        value = to_int(item.get(key))
        if value is not None:
            return value

    m = re.search(r"\b(\d{1,6})\s+(?:samples?|runs?)\b", summary.lower())
    if m:
        return to_int(m.group(1))
    return None


def search_sra_projects(
    user_query: str,
    max_results: int = 100,
    email: str | None = None,
    api_key: str | None = None,
    scrna_only: bool = True,
) -> list[DatasetRecord]:
    query = build_sra_query(user_query=user_query, scrna_only=scrna_only)
    ids = esearch_ids(db="sra", term=query, retmax=max_results, email=email, api_key=api_key)
    result = esummary_result(db="sra", ids=ids, email=email, api_key=api_key)
    uids = result.get("uids", [])

    records: list[DatasetRecord] = []
    for uid in uids:
        item = result.get(uid, {})
        accession = _pick(item, ["accession", "caption", "uid"]).upper()
        if not accession:
            continue

        title = _pick(item, ["title", "description", "desc", "name"])
        summary = _pick(item, ["summary", "description", "desc", "expxml"])
        organism = _pick(item, ["taxon", "organism", "species"])
        pubdate = _pick(item, ["createdate", "updatedate", "pubdate"])
        n_samples = _parse_n_samples(item, summary=summary)
        pmids = extract_pubmed_ids(item)
        first_pmid = pmids[0] if pmids else ""

        score = score_scrna_relevance(title=title, summary=summary, user_query=user_query)
        url = f"https://www.ncbi.nlm.nih.gov/sra/?term={accession}"
        records.append(
            DatasetRecord(
                source="SRA",
                accession=accession,
                title=title,
                summary=summary,
                organism=organism,
                pubdate=pubdate,
                n_samples=n_samples,
                relevance_score=score,
                geo_url=url,
                supplementary_dir="",
                user_query=user_query,
                paper_ids=",".join(pmids),
                paper_count=len(pmids),
                latest_paper_pmid=first_pmid,
                latest_paper_url=f"https://pubmed.ncbi.nlm.nih.gov/{first_pmid}/" if first_pmid else "",
            )
        )
    return records
