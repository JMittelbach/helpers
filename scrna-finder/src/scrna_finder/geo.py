from __future__ import annotations

import re
from typing import Any
from urllib.parse import urljoin

import requests

from .models import DatasetRecord
from .scoring import score_scrna_relevance

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"


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


def _request_json(url: str, params: dict[str, Any], timeout: int = 60) -> dict[str, Any]:
    try:
        r = requests.get(url, params=params, timeout=timeout)
        r.raise_for_status()
        return r.json()
    except requests.RequestException as e:
        raise RuntimeError(f"Network error while calling NCBI E-utilities: {e}") from e


def _to_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _extract_year(text: str) -> int | None:
    m = re.search(r"\b(19|20)\d{2}\b", text or "")
    if not m:
        return None
    return int(m.group(0))


def _extract_numeric_tokens(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        out: list[str] = []
        for x in value:
            out.extend(_extract_numeric_tokens(x))
        return out
    if isinstance(value, dict):
        out: list[str] = []
        for x in value.values():
            out.extend(_extract_numeric_tokens(x))
        return out

    text = str(value)
    return re.findall(r"\b\d{5,10}\b", text)


def _extract_pubmed_ids(summary_item: dict[str, Any]) -> list[str]:
    ids: set[str] = set()
    for key, value in summary_item.items():
        if "pubmed" in key.lower() or key.lower().endswith("pmid"):
            for token in _extract_numeric_tokens(value):
                ids.add(token)
    return sorted(ids)


def _chunk(items: list[str], n: int) -> list[list[str]]:
    return [items[i : i + n] for i in range(0, len(items), n)]


def fetch_pubmed_summaries(
    pmids: list[str],
    email: str | None = None,
    api_key: str | None = None,
) -> dict[str, dict[str, str | int | None]]:
    if not pmids:
        return {}

    out: dict[str, dict[str, str | int | None]] = {}
    for part in _chunk(pmids, 150):
        params: dict[str, Any] = {"db": "pubmed", "id": ",".join(part), "retmode": "json"}
        if email:
            params["email"] = email
        if api_key:
            params["api_key"] = api_key

        data = _request_json(f"{EUTILS}/esummary.fcgi", params=params)
        result = data.get("result", {})
        uids = result.get("uids", [])
        for uid in uids:
            item = result.get(uid, {})
            title = str(item.get("title", "")).strip()
            pubdate = str(item.get("pubdate", "")).strip()
            year = _extract_year(pubdate)
            out[str(uid)] = {"title": title, "pubdate": pubdate, "year": year}
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
        best_title = ""

        for pmid in pmids:
            entry = metadata.get(pmid)
            if not entry:
                continue
            year = entry.get("year")
            title = str(entry.get("title", ""))
            if isinstance(year, int) and (best_year is None or year > best_year):
                best_year = year
                best_title = title

        r.paper_count = len(pmids)
        r.latest_paper_year = best_year
        r.latest_paper_title = best_title


def esearch_ids(term: str, retmax: int, email: str | None = None, api_key: str | None = None) -> list[str]:
    params: dict[str, Any] = {"db": "gds", "term": term, "retmode": "json", "retmax": retmax}
    if email:
        params["email"] = email
    if api_key:
        params["api_key"] = api_key

    data = _request_json(f"{EUTILS}/esearch.fcgi", params=params)
    return data.get("esearchresult", {}).get("idlist", [])


def esummary_records(ids: list[str], user_query: str = "", email: str | None = None, api_key: str | None = None) -> list[DatasetRecord]:
    if not ids:
        return []

    params: dict[str, Any] = {"db": "gds", "id": ",".join(ids), "retmode": "json"}
    if email:
        params["email"] = email
    if api_key:
        params["api_key"] = api_key

    data = _request_json(f"{EUTILS}/esummary.fcgi", params=params)
    result = data.get("result", {})
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
        n_samples = _to_int(item.get("n_samples"))
        pmids = _extract_pubmed_ids(item)

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
            )
        )

    return records


def search_geo_series(
    user_query: str,
    max_results: int = 100,
    email: str | None = None,
    api_key: str | None = None,
    scrna_only: bool = True,
    include_literature: bool = False,
    papers_per_dataset: int = 5,
) -> list[DatasetRecord]:
    query = build_geo_query(user_query=user_query, scrna_only=scrna_only)
    ids = esearch_ids(term=query, retmax=max_results, email=email, api_key=api_key)
    records = esummary_records(ids=ids, user_query=user_query, email=email, api_key=api_key)
    if include_literature:
        enrich_records_with_pubmed(
            records=records,
            email=email,
            api_key=api_key,
            papers_per_dataset=papers_per_dataset,
        )
    return records


def fetch_supplementary_files(supplementary_dir: str, timeout: int = 30) -> list[str]:
    if not supplementary_dir:
        return []

    try:
        r = requests.get(supplementary_dir, timeout=timeout)
    except requests.RequestException as e:
        raise RuntimeError(f"Network error while listing supplementary files at {supplementary_dir}: {e}") from e

    if r.status_code != 200:
        raise RuntimeError(f"Unexpected HTTP status {r.status_code} for {supplementary_dir}")

    html = r.text
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
