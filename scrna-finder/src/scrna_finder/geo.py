from __future__ import annotations

import re
from urllib.parse import urljoin

from .http_client import HttpClientError, http_get_text
from .models import DatasetRecord
from .ncbi import esearch_ids, esummary_result, extract_pubmed_ids, to_int
from .scoring import score_scrna_relevance


def build_geo_query(user_query: str, scrna_only: bool = True) -> str:
    query = user_query.strip()
    type_clause = "gse[ETYP]"

    if not scrna_only:
        return f"({query}) AND {type_clause}" if query else type_clause

    sc_clause = (
        '"single cell"[All Fields] OR "single-cell"[All Fields] OR '
        '"scrna-seq"[All Fields] OR "single-cell rna"[All Fields] OR '
        '"snrna-seq"[All Fields]'
    )
    if query:
        return f"(({query}) AND ({sc_clause})) AND {type_clause}"
    return f"({sc_clause}) AND {type_clause}"


def geo_series_supplementary_dir(accession: str) -> str:
    m = re.fullmatch(r"GSE(\d+)", accession.upper())
    if not m:
        return ""

    digits = m.group(1)
    bucket_prefix = digits[:-3]
    bucket = f"{bucket_prefix}nnn"
    return f"https://ftp.ncbi.nlm.nih.gov/geo/series/GSE{bucket}/{accession.upper()}/suppl/"


def esummary_records(ids: list[str], user_query: str = "", email: str | None = None, api_key: str | None = None) -> list[DatasetRecord]:
    result = esummary_result(db="gds", ids=ids, email=email, api_key=api_key)
    uids = result.get("uids", [])
    records: list[DatasetRecord] = []

    for uid in uids:
        item = result.get(uid, {})
        accession = str(item.get("accession", "")).upper()
        if not accession.startswith("GSE"):
            continue

        title = str(item.get("title", "")).strip()
        summary = str(item.get("summary", "")).strip()
        organism = item.get("taxon", "")
        if isinstance(organism, list):
            organism_txt = "; ".join(str(x) for x in organism if x)
        else:
            organism_txt = str(organism)
        pubdate = str(item.get("PDAT") or item.get("pdat") or "")
        n_samples = to_int(item.get("n_samples"))
        pmids = extract_pubmed_ids(item)
        first_pmid = pmids[0] if pmids else ""

        score = score_scrna_relevance(title, summary, user_query=user_query)
        geo_url = f"https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc={accession}"
        supp_dir = geo_series_supplementary_dir(accession)

        records.append(
            DatasetRecord(
                source="GEO",
                accession=accession,
                title=title,
                summary=summary,
                organism=organism_txt,
                pubdate=pubdate,
                n_samples=n_samples,
                relevance_score=score,
                geo_url=geo_url,
                supplementary_dir=supp_dir,
                user_query=user_query,
                paper_ids=",".join(pmids),
                paper_count=len(pmids),
                latest_paper_pmid=first_pmid,
                latest_paper_url=f"https://pubmed.ncbi.nlm.nih.gov/{first_pmid}/" if first_pmid else "",
            )
        )

    return records


def search_geo_series(
    user_query: str,
    max_results: int = 100,
    email: str | None = None,
    api_key: str | None = None,
    scrna_only: bool = True,
) -> list[DatasetRecord]:
    query = build_geo_query(user_query=user_query, scrna_only=scrna_only)
    ids = esearch_ids(db="gds", term=query, retmax=max_results, email=email, api_key=api_key)
    return esummary_records(ids=ids, user_query=user_query, email=email, api_key=api_key)


def fetch_supplementary_files(supplementary_dir: str, timeout: int = 30) -> list[str]:
    if not supplementary_dir:
        return []

    try:
        html = http_get_text(url=supplementary_dir, timeout=timeout)
    except HttpClientError as e:
        raise RuntimeError(f"Network error while listing supplementary files at {supplementary_dir}: {e}") from e

    hrefs = re.findall(r'href="([^"]+)"', html, flags=re.IGNORECASE)

    urls: list[str] = []
    for href in hrefs:
        href = href.strip()
        if not href or href in ("/", "../"):
            continue
        if href.endswith("/"):
            continue
        if href.startswith("?"):
            continue
        urls.append(urljoin(supplementary_dir, href))

    return sorted(set(urls))
