from __future__ import annotations

from dataclasses import dataclass

from .celltypes import match_cell_types
from .scoring import score_scrna_relevance


@dataclass
class EvalCase:
    name: str
    title: str
    summary: str
    expected_scrna: bool
    query: str = ""
    expected_cell_type: str = ""


BENCHMARK_CASES: list[EvalCase] = [
    EvalCase(
        name="scrna_lung_tumor",
        title="Single-cell RNA-seq atlas of lung adenocarcinoma",
        summary="10x genomics data with CD8+ T cells and fibroblasts",
        expected_scrna=True,
        query="lung adenocarcinoma",
        expected_cell_type="t cell",
    ),
    EvalCase(
        name="snrna_brain",
        title="snRNA-seq profiling in Alzheimer cortex",
        summary="single nucleus RNA sequencing identifies microglia states",
        expected_scrna=True,
        query="alzheimer",
        expected_cell_type="microglia",
    ),
    EvalCase(
        name="bulk_rna_false_positive_guard",
        title="Bulk RNA-seq and microarray of breast cancer cohorts",
        summary="Expression profiling of bulk tissue only",
        expected_scrna=False,
        query="breast cancer",
        expected_cell_type="",
    ),
    EvalCase(
        name="ambiguous_transcriptome",
        title="Tumor transcriptome sequencing",
        summary="RNA sequencing of patient samples",
        expected_scrna=False,
        query="tumor",
        expected_cell_type="",
    ),
    EvalCase(
        name="tcell_alias_compact",
        title="Immune microenvironment single-cell profiling",
        summary="Expanded tcell populations and activated cytotoxic T cells",
        expected_scrna=True,
        query="immune",
        expected_cell_type="t-cell",
    ),
]


def run_benchmark(score_threshold: float = 0.5) -> dict[str, object]:
    rows: list[dict[str, object]] = []
    correct_scrna = 0
    correct_celltype = 0
    with_cell_expectation = 0

    for case in BENCHMARK_CASES:
        score = score_scrna_relevance(case.title, case.summary, user_query=case.query)
        predicted_scrna = score >= score_threshold
        scrna_ok = predicted_scrna == case.expected_scrna
        if scrna_ok:
            correct_scrna += 1

        cell_ok = True
        hits: list[str] = []
        if case.expected_cell_type:
            with_cell_expectation += 1
            matched, hits = match_cell_types(
                text=f"{case.title}\n{case.summary}",
                requested_terms=[case.expected_cell_type],
                mode="any",
            )
            cell_ok = matched
            if cell_ok:
                correct_celltype += 1

        rows.append(
            {
                "name": case.name,
                "score": score,
                "expected_scrna": case.expected_scrna,
                "predicted_scrna": predicted_scrna,
                "scrna_ok": scrna_ok,
                "expected_cell_type": case.expected_cell_type,
                "cell_ok": cell_ok,
                "cell_hits": "; ".join(hits),
            }
        )

    total = len(BENCHMARK_CASES)
    scrna_acc = correct_scrna / total if total else 0.0
    cell_acc = (correct_celltype / with_cell_expectation) if with_cell_expectation else 1.0
    return {
        "score_threshold": score_threshold,
        "n_cases": total,
        "scrna_accuracy": scrna_acc,
        "celltype_accuracy": cell_acc,
        "rows": rows,
    }
