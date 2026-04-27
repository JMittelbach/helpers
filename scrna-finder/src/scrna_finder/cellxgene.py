from __future__ import annotations

import re
from typing import Any

from .http_client import HttpClientError, http_get_json
from .models import DatasetRecord
from .scoring import score_scrna_relevance

CELLXGENE_API = "https://api.cellxgene.cziscience.com"
CELLXGENE_DATASETS_PAGE = "https://cellxgene.cziscience.com/datasets"


def _json_get(path: str, timeout: int = 90) -> Any:
    url = f"{CELLXGENE_API}{path}"
    try:
        return http_get_json(url=url, timeout=timeout)
    except HttpClientError as e:
        raise RuntimeError(f"CELLxGENE request failed at {url}: {e}") from e


def _json_get_with_fallback(paths: list[str], timeout: int = 90) -> Any:
    errors: list[str] = []
    for path in paths:
        try:
            return _json_get(path, timeout=timeout)
        except RuntimeError as e:
            errors.append(str(e))
    joined = " | ".join(errors) if errors else "unknown error"
    raise RuntimeError(joined)


def _flatten_ontology_labels(value: Any) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        labels: list[str] = []
        for item in value:
            if isinstance(item, dict):
                label = str(item.get("label", "")).strip()
                if label:
                    labels.append(label)
            elif isinstance(item, str):
                labels.append(item.strip())
        return [x for x in labels if x]
    return []


def _first_year_from_timestamp(ts: Any) -> str:
    if ts in (None, ""):
        return ""
    try:
        import datetime

        dt = datetime.datetime.fromtimestamp(float(ts), datetime.UTC)
        return str(dt.year)
    except Exception:
        text = str(ts)
        m = re.search(r"\b(19|20)\d{2}\b", text)
        return m.group(0) if m else ""


def _contains_query_tokens(text: str, user_query: str) -> bool:
    if not user_query.strip():
        return True
    tokens = [t.lower() for t in re.findall(r"[A-Za-z0-9\-\+]+", user_query) if len(t) >= 3]
    if not tokens:
        return True
    lowered = text.lower()
    # Relaxed gate: at least one query token must match to avoid dropping useful results.
    return any(t in lowered for t in tokens)


def search_cellxgene_datasets(
    user_query: str,
    max_results: int = 100,
    scrna_only: bool = True,
) -> list[DatasetRecord]:
    rows = _json_get_with_fallback(paths=["/dp/v1/datasets/index", "/v1/datasets/index"])
    if not isinstance(rows, list):
        raise RuntimeError("Unexpected CELLxGENE datasets/index response format.")

    records: list[DatasetRecord] = []
    for item in rows:
        if not isinstance(item, dict):
            continue

        dataset_id = str(item.get("id", "")).strip()
        if not dataset_id:
            continue

        title = str(item.get("name", "")).strip()
        assay = ", ".join(_flatten_ontology_labels(item.get("assay")))
        tissues = ", ".join(_flatten_ontology_labels(item.get("tissue")))
        diseases = ", ".join(_flatten_ontology_labels(item.get("disease")))
        organisms = ", ".join(_flatten_ontology_labels(item.get("organism")))
        cell_types = ", ".join(_flatten_ontology_labels(item.get("cell_type")))
        summary = f"assay: {assay}; tissue: {tissues}; disease: {diseases}; cell_type: {cell_types}"
        pubdate = _first_year_from_timestamp(item.get("published_at") or item.get("revised_at"))

        score = score_scrna_relevance(title=title, summary=summary, user_query=user_query)
        if scrna_only and score < 0.35:
            continue

        full_text = f"{title}\n{summary}\n{organisms}"
        if not _contains_query_tokens(full_text, user_query):
            continue

        n_samples = item.get("cell_count")
        try:
            n_samples_int = int(n_samples) if n_samples is not None else None
        except (TypeError, ValueError):
            n_samples_int = None

        explorer_url = str(item.get("explorer_url", "")).strip()
        dataset_url = explorer_url or f"https://cellxgene.cziscience.com/e/{dataset_id}.cxg"
        records.append(
            DatasetRecord(
                source="CELLXGENE",
                accession=dataset_id,
                title=title or dataset_id,
                summary=summary,
                organism=organisms,
                pubdate=pubdate,
                n_samples=n_samples_int,
                relevance_score=score,
                geo_url=dataset_url,
                supplementary_dir=f"cellxgene://{dataset_id}",
                user_query=user_query,
                paper_ids="",
                paper_count=0,
            )
        )

    ranked = sorted(records, key=lambda x: x.relevance_score, reverse=True)
    return ranked[:max_results]


def fetch_cellxgene_dataset_assets(dataset_id: str, timeout: int = 90) -> list[dict[str, str]]:
    assets_payload = _json_get_with_fallback(
        paths=[
            f"/dp/v1/datasets/{dataset_id}/assets",
            f"/v1/datasets/{dataset_id}/assets",
        ],
        timeout=timeout,
    )
    assets = assets_payload.get("assets", []) if isinstance(assets_payload, dict) else []

    out: list[dict[str, str]] = []
    for asset in assets:
        if not isinstance(asset, dict):
            continue
        asset_id = str(asset.get("id", "")).strip()
        filename = str(asset.get("filename", "")).strip() or f"{dataset_id}.bin"
        filetype = str(asset.get("filetype", "")).strip()
        if not asset_id:
            continue

        download_payload = _json_get_with_fallback(
            paths=[
                f"/dp/v1/datasets/{dataset_id}/asset/{asset_id}",
                f"/v1/datasets/{dataset_id}/asset/{asset_id}",
            ],
            timeout=timeout,
        )
        if not isinstance(download_payload, dict):
            continue
        file_url = str(download_payload.get("url", "")).strip()
        if not file_url:
            continue
        out.append(
            {
                "dataset_id": dataset_id,
                "asset_id": asset_id,
                "file_name": filename,
                "file_type": filetype,
                "file_url": file_url,
                "source_url": CELLXGENE_DATASETS_PAGE,
            }
        )

    return out
