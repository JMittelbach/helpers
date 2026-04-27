from __future__ import annotations

from .models import DatasetRecord, PaperRecord
from .ncbi import chunk, esearch_ids, esummary_result, extract_year


def fetch_pubmed_summaries(
    pmids: list[str],
    email: str | None = None,
    api_key: str | None = None,
) -> dict[str, dict[str, str | int | None]]:
    if not pmids:
        return {}

    out: dict[str, dict[str, str | int | None]] = {}
    for part in chunk(pmids, 150):
        result = esummary_result(db="pubmed", ids=part, email=email, api_key=api_key)
        uids = result.get("uids", [])
        for uid in uids:
            item = result.get(uid, {})
            title = str(item.get("title", "")).strip()
            pubdate = str(item.get("pubdate", "")).strip()
            year = extract_year(pubdate)
            journal = str(item.get("fulljournalname") or item.get("source") or "").strip()
            out[str(uid)] = {"title": title, "pubdate": pubdate, "year": year, "journal": journal}
    return out


def enrich_records_with_pubmed(
    records: list[DatasetRecord],
    email: str | None = None,
    api_key: str | None = None,
    papers_per_dataset: int = 5,
) -> None:
    all_pmids: set[str] = set()
    for r in records:
        pmids = [x.strip() for x in r.paper_ids.split(",") if x.strip()]
        if papers_per_dataset > 0:
            pmids = pmids[:papers_per_dataset]
        all_pmids.update(pmids)

    if not all_pmids:
        return

    metadata = fetch_pubmed_summaries(sorted(all_pmids), email=email, api_key=api_key)
    for r in records:
        pmids = [x.strip() for x in r.paper_ids.split(",") if x.strip()]
        if papers_per_dataset > 0:
            pmids = pmids[:papers_per_dataset]
        best_year: int | None = None
        best_pmid = ""
        best_title = ""

        for pmid in pmids:
            entry = metadata.get(pmid)
            if not entry:
                continue
            year = entry.get("year")
            title = str(entry.get("title", ""))
            if not best_pmid:
                best_pmid = pmid
                best_title = title
            if isinstance(year, int) and (best_year is None or year > best_year):
                best_year = year
                best_pmid = pmid
                best_title = title

        r.paper_count = len(pmids)
        if best_pmid:
            r.latest_paper_year = best_year
            r.latest_paper_pmid = best_pmid
            r.latest_paper_url = f"https://pubmed.ncbi.nlm.nih.gov/{best_pmid}/"
            r.latest_paper_title = best_title


def build_pubmed_query(user_query: str, scrna_only: bool = True) -> str:
    base = user_query.strip()
    if not scrna_only:
        return base if base else "single cell rna"

    scrna_clause = (
        '"single-cell"[Title/Abstract] OR "single cell"[Title/Abstract] OR '
        '"scRNA-seq"[Title/Abstract] OR "single-cell RNA"[Title/Abstract] OR '
        '"snRNA-seq"[Title/Abstract]'
    )
    if base:
        return f"({base}) AND ({scrna_clause})"
    return scrna_clause


def search_recent_pubmed(
    user_query: str,
    max_results: int = 10,
    email: str | None = None,
    api_key: str | None = None,
    scrna_only: bool = True,
) -> list[PaperRecord]:
    query = build_pubmed_query(user_query=user_query, scrna_only=scrna_only)
    ids = esearch_ids(
        db="pubmed",
        term=query,
        retmax=max_results,
        email=email,
        api_key=api_key,
        sort="pub+date",
    )
    result = esummary_result(db="pubmed", ids=ids, email=email, api_key=api_key)
    uids = result.get("uids", [])
    papers: list[PaperRecord] = []
    for uid in uids:
        item = result.get(uid, {})
        title = str(item.get("title", "")).strip()
        pubdate = str(item.get("pubdate", "")).strip()
        year = extract_year(pubdate)
        journal = str(item.get("fulljournalname") or item.get("source") or "").strip()
        papers.append(
            PaperRecord(
                pmid=str(uid),
                title=title,
                pubdate=pubdate,
                journal=journal,
                year=year,
                url=f"https://pubmed.ncbi.nlm.nih.gov/{uid}/",
            )
        )
    return papers
