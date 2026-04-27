from __future__ import annotations

import re
from typing import Any

from .http_client import HttpClientError, http_get_json

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"


def request_json(endpoint: str, params: dict[str, Any], timeout: int = 60) -> dict[str, Any]:
    url = f"{EUTILS}/{endpoint}"
    try:
        data = http_get_json(url=url, params=params, timeout=timeout)
        return data if isinstance(data, dict) else {}
    except HttpClientError as e:
        raise RuntimeError(f"Network error while calling NCBI E-utilities ({endpoint}): {e}") from e


def esearch_ids(
    db: str,
    term: str,
    retmax: int,
    email: str | None = None,
    api_key: str | None = None,
    sort: str | None = None,
) -> list[str]:
    params: dict[str, Any] = {"db": db, "term": term, "retmode": "json", "retmax": retmax}
    if email:
        params["email"] = email
    if api_key:
        params["api_key"] = api_key
    if sort:
        params["sort"] = sort

    data = request_json("esearch.fcgi", params=params)
    return data.get("esearchresult", {}).get("idlist", [])


def esummary_result(
    db: str,
    ids: list[str],
    email: str | None = None,
    api_key: str | None = None,
) -> dict[str, Any]:
    if not ids:
        return {"uids": []}
    params: dict[str, Any] = {"db": db, "id": ",".join(ids), "retmode": "json"}
    if email:
        params["email"] = email
    if api_key:
        params["api_key"] = api_key
    data = request_json("esummary.fcgi", params=params)
    return data.get("result", {})


def to_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def extract_year(text: str) -> int | None:
    m = re.search(r"\b(19|20)\d{2}\b", text or "")
    if not m:
        return None
    return int(m.group(0))


def chunk(items: list[str], n: int) -> list[list[str]]:
    return [items[i : i + n] for i in range(0, len(items), n)]


def extract_numeric_tokens(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        out: list[str] = []
        for x in value:
            out.extend(extract_numeric_tokens(x))
        return out
    if isinstance(value, dict):
        out: list[str] = []
        for x in value.values():
            out.extend(extract_numeric_tokens(x))
        return out

    text = str(value)
    return re.findall(r"\b\d{5,10}\b", text)


def extract_pubmed_ids(summary_item: dict[str, Any]) -> list[str]:
    ids: set[str] = set()
    for key, value in summary_item.items():
        k = key.lower()
        if "pubmed" in k or k.endswith("pmid"):
            for token in extract_numeric_tokens(value):
                ids.add(token)
    return sorted(ids)
