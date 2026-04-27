from __future__ import annotations

import argparse
import os
from collections import Counter
from pathlib import Path

from .celltypes import canonical_cell_type_names, canonical_to_display_name
from .cellxgene import fetch_cellxgene_dataset_assets
from .downloader import download_from_manifest
from .evaluation import run_benchmark
from .filtering import filter_records
from .geo import fetch_supplementary_files
from .io_utils import read_manifest, read_records, write_manifest, write_records
from .literature import search_recent_pubmed
from .search_engine import SUPPORTED_SOURCES, normalize_sources, search_datasets_report


DEFAULT_EASY_RESULTS = "search_results.csv"
DEFAULT_EASY_MANIFEST = "files_manifest.csv"
ALL_CELL_TYPE_INPUTS = {
    "all",
    "all cell types",
    "all cells",
    "any",
    "no filter",
    "none",
    "*",
    "alle",
}
YES_NO_INPUTS = {"y", "yes", "j", "ja", "n", "no", "nein"}
ORGANISM_NO_FILTER_INPUTS = {"all", "any", "none", "no filter", "*", "-"}


def _shorten(text: str, width: int) -> str:
    clean = text.replace("\t", " ").replace("\n", " ").strip()
    if len(clean) <= width:
        return clean
    if width <= 3:
        return clean[:width]
    return f"{clean[: width - 3]}..."


def _format_int(value: int | None) -> str:
    return "-" if value is None else str(value)


def _paper_preview(record: object) -> str:
    paper_count = getattr(record, "paper_count", None)
    latest_year = getattr(record, "latest_paper_year", None)
    if paper_count in (None, 0):
        return "-"
    if latest_year is None:
        return str(paper_count)
    return f"{paper_count}@{latest_year}"


def _paper_link_preview(record: object) -> str:
    pmid = str(getattr(record, "latest_paper_pmid", "") or "").strip()
    if pmid:
        return pmid
    url = str(getattr(record, "latest_paper_url", "") or "").strip()
    if not url:
        return "-"
    if "pubmed.ncbi.nlm.nih.gov/" in url:
        maybe = url.rstrip("/").split("/")[-1]
        if maybe.isdigit():
            return maybe
    return _shorten(url, 18)


def _annotation_preview(record: object) -> str:
    methods = str(getattr(record, "annotation_methods", "") or "")
    conf = float(getattr(record, "annotation_confidence", 0.0) or 0.0)
    if not methods:
        return f"{conf:.2f}|-"
    method_short = methods.replace(";", ",")
    if len(method_short) > 18:
        method_short = f"{method_short[:15]}..."
    return f"{conf:.2f}|{method_short}"


def _source_counts(records: list) -> dict[str, int]:
    c = Counter((r.source or "UNKNOWN") for r in records)
    return dict(sorted(c.items(), key=lambda x: x[0]))


def _print_search_overview(args: argparse.Namespace, selected_sources: list[str], total_hits: int, filtered_hits: int, records: list) -> None:
    source_counts = _source_counts(records)
    source_labels = ", ".join(s.upper() for s in selected_sources)
    counts_label = ", ".join(f"{k}:{v}" for k, v in source_counts.items()) if source_counts else "-"

    print("")
    print("=== Search Overview ===")
    print(f"Databases: {source_labels}")
    print(f"Hit distribution: {counts_label}")
    if args.search_literature:
        print("Dataset-linked literature: enabled (PubMed IDs linked in source metadata)")
    else:
        print("Dataset-linked literature: disabled")
    if args.literature_global:
        print(f"Global recent literature: enabled (Top {args.literature_top} PubMed hits)")
    else:
        print("Global recent literature: disabled")
    print(f"Query: {args.query}")
    print(f"Raw hits: {total_hits}")
    print(f"After filters: {filtered_hits}")
    print(f"Organism filter: {args.organism or '-'}")
    print(f"Year >= : {args.since_year if args.since_year is not None else '-'}")
    print(f"Min scRNA score: {args.min_score:.2f}")
    print(f"Annotation required: {'yes' if args.require_annotation else 'no'}")
    print(f"Min annotation conf: {args.min_annotation_confidence:.2f}")
    print(f"Annotation methods: {', '.join(args.annotation_method) if args.annotation_method else '-'}")
    print(f"Manual/lab only annotation mode: {'yes' if getattr(args, 'manual_lab_only', False) else 'no'}")
    print(f"Require fine T-cell annotation: {'yes' if args.require_fine_tcell else 'no'}")
    print(f"Cell types: {', '.join(args.cell_type) if args.cell_type else 'all (no filter)'}")
    print(f"Cell mode: {args.cell_mode if args.cell_type else '-'}")
    print("")


def _print_results(records: list, limit: int = 20) -> None:
    if not records:
        print("No matching datasets.")
        return

    shown = records[:limit]
    header = (
        f"{'#':>3}  {'Src':<9} {'Accession':<11} {'Score':>6} {'Anno':<22} {'Samples':>7} "
        f"{'Papers':>10} {'PMID':<10} {'T-detail':<16} {'Cell Hits':<18} {'Organism':<16} Title"
    )
    print(header)
    print("-" * len(header))
    for idx, r in enumerate(shown, start=1):
        anno = _shorten(_annotation_preview(r), 22)
        t_detail = _shorten(r.annotation_tcell_detail or "-", 16)
        cell_hits = _shorten(r.cell_type_hits or "-", 18)
        organism = _shorten(r.organism or "-", 16)
        title = _shorten(r.title, 54)
        source = _shorten(r.source or "-", 9)
        pmid = _shorten(_paper_link_preview(r), 10)
        print(
            f"{idx:>3}  {source:<9} {r.accession:<11} {r.relevance_score:>6.3f} "
            f"{anno:<22} {_format_int(r.n_samples):>7} {_paper_preview(r):>10} "
            f"{pmid:<10} {t_detail:<16} {cell_hits:<18} {organism:<16} {title}"
        )


def _print_annotation_details(records: list, limit: int = 20) -> None:
    candidates = [r for r in records if (r.annotation_methods or r.annotation_evidence or r.annotation_tcell_detail)]
    if not candidates:
        print("")
        print("No annotation evidence detected in current result set.")
        return

    shown = candidates[:limit]
    print("")
    print("=== Annotation Details ===")
    header = (
        f"{'#':>3}  {'Accession':<11} {'Methods':<20} {'Signal Src':<18} "
        f"{'Evidence':<30} {'PMID':<10} {'T-detail':<20}"
    )
    print(header)
    print("-" * len(header))
    for idx, r in enumerate(shown, start=1):
        methods = _shorten(r.annotation_methods or "-", 20)
        signal_src = _shorten(r.annotation_signal_sources or "-", 18)
        evidence = _shorten(r.annotation_evidence or "-", 30)
        pmid = _shorten(_paper_link_preview(r), 10)
        t_detail = _shorten(r.annotation_tcell_detail or "-", 20)
        print(
            f"{idx:>3}  {r.accession:<11} {methods:<20} {signal_src:<18} "
            f"{evidence:<30} {pmid:<10} {t_detail:<20}"
        )


def _print_recent_papers(papers: list, limit: int) -> None:
    if not papers:
        return
    shown = papers[:limit]
    print("")
    print("=== Recent PubMed (Query-based) ===")
    header = f"{'#':>3}  {'Year':>4} {'PMID':<10} {'Journal':<24} Title"
    print(header)
    print("-" * len(header))
    for idx, p in enumerate(shown, start=1):
        year = "-" if p.year is None else str(p.year)
        journal = _shorten(p.journal or "-", 24)
        title = _shorten(p.title or "-", 80)
        print(f"{idx:>3}  {year:>4} {p.pmid:<10} {journal:<24} {title}")


def _print_zero_match_diagnostics(args: argparse.Namespace, all_records: list) -> None:
    if not all_records:
        return

    print("")
    print("=== Zero-Match Diagnostics ===")
    print("Your filters are currently too strict for this result set.")

    def _count_with_overrides(**overrides: object) -> int:
        return len(
            filter_records(
                all_records,
                organism=overrides.get("organism", args.organism),
                since_year=overrides.get("since_year", args.since_year),
                must_contain=overrides.get("must_contain", args.must_contain),
                exclude=overrides.get("exclude", args.exclude),
                min_score=overrides.get("min_score", args.min_score),
                cell_types=overrides.get("cell_types", args.cell_type),
                cell_mode=overrides.get("cell_mode", args.cell_mode),
                require_annotation=overrides.get("require_annotation", args.require_annotation),
                min_annotation_confidence=overrides.get("min_annotation_confidence", args.min_annotation_confidence),
                annotation_methods=overrides.get("annotation_methods", args.annotation_method),
                require_fine_tcell=overrides.get("require_fine_tcell", args.require_fine_tcell),
                manual_lab_only=overrides.get("manual_lab_only", getattr(args, "manual_lab_only", False)),
            )
        )

    if args.organism:
        print(f"- Without organism filter: {_count_with_overrides(organism=None)} matches")
    if args.require_fine_tcell:
        print(f"- Without fine T-cell requirement: {_count_with_overrides(require_fine_tcell=False)} matches")
    if args.annotation_method:
        print(f"- Without annotation-method constraint: {_count_with_overrides(annotation_methods=[])} matches")
    if args.min_annotation_confidence > 0.0:
        print(f"- With annotation confidence >= 0.0: {_count_with_overrides(min_annotation_confidence=0.0)} matches")
    if args.require_annotation:
        print(
            "- Without annotation constraints (method/confidence/fine T-cell): "
            f"{_count_with_overrides(require_annotation=False, min_annotation_confidence=0.0, annotation_methods=[], require_fine_tcell=False)} matches"
        )
    if getattr(args, "manual_lab_only", False):
        print(f"- Without manual/lab-only mode: {_count_with_overrides(manual_lab_only=False)} matches")


def _print_benchmark(results: dict[str, object]) -> None:
    print("")
    print("=== Internal Evaluation ===")
    print(f"Cases: {results['n_cases']}")
    print(f"Score threshold: {results['score_threshold']}")
    print(f"scRNA classification accuracy: {float(results['scrna_accuracy']):.3f}")
    print(f"Cell-type alias accuracy: {float(results['celltype_accuracy']):.3f}")
    print("")
    header = f"{'Case':<34} {'Score':>6} {'scRNA':>7} {'Cell':>6} Hits"
    print(header)
    print("-" * len(header))
    for row in results["rows"]:
        print(
            f"{str(row['name']):<34} {float(row['score']):>6.3f} "
            f"{'ok' if row['scrna_ok'] else 'fail':>7} "
            f"{'ok' if row['cell_ok'] else 'fail':>6} {row['cell_hits']}"
        )


def _print_section(title: str) -> None:
    print("")
    print(title)
    print("-" * len(title))


def _prompt_text(prompt: str, default: str | None = None) -> str:
    suffix = f" [{default}]" if default not in (None, "") else ""
    value = input(f"{prompt}{suffix}: ").strip()
    if not value and default is not None:
        return default
    return value


def _prompt_yes_no(prompt: str, default_yes: bool = False) -> bool:
    default = "y" if default_yes else "n"
    while True:
        raw = _prompt_text(f"{prompt} (y/n)", default=default).strip().lower()
        if raw in {"j", "ja", "y", "yes"}:
            return True
        if raw in {"n", "nein", "no"}:
            return False
        print("Please enter 'y' or 'n'.")


def _prompt_choice(prompt: str, options: list[tuple[str, str]], default_key: str) -> str:
    labels = ", ".join(f"{key}={label}" for key, label in options)
    while True:
        raw = _prompt_text(f"{prompt} ({labels})", default=default_key).strip().lower()
        for key, _label in options:
            if raw == key.lower():
                return key
        print("Please choose a valid option.")


def _parse_csv_tokens(text: str) -> list[str]:
    if not text.strip():
        return []
    return [part.strip() for part in text.split(",") if part.strip()]


def _normalize_cell_type_filters(tokens: list[str]) -> list[str]:
    parsed: list[str] = []
    for token in tokens:
        parsed.extend(_parse_csv_tokens(token))
    if not parsed:
        return []
    lowered = {token.strip().lower() for token in parsed if token.strip()}
    if lowered.intersection(ALL_CELL_TYPE_INPUTS):
        return []
    return parsed


def _parse_cell_types_input(text: str) -> list[str]:
    return _normalize_cell_type_filters([text])


def _sanitize_organism_filter(raw: str | None) -> tuple[str | None, bool]:
    if raw is None:
        return None, False
    cleaned = raw.strip()
    if not cleaned:
        return None, False
    lowered = cleaned.lower()
    if lowered in ORGANISM_NO_FILTER_INPUTS:
        return None, False
    if lowered in YES_NO_INPUTS:
        return None, True
    return cleaned, False


def _prompt_organism(default: str | None) -> str | None:
    default_value = default if default not in (None, "") else None
    while True:
        raw = _prompt_text(
            "Organism (e.g. Homo sapiens; type 'none' for no organism filter)",
            default=default_value,
        )
        organism, looks_like_yes_no = _sanitize_organism_filter(raw)
        if looks_like_yes_no:
            print("Please enter an organism name (e.g. Homo sapiens), not yes/no.")
            continue
        return organism


def _parse_sources_input(text: str) -> list[str]:
    lowered = text.strip().lower()
    if not lowered or lowered in {"all", "alle", "*", "1,2,3"}:
        return list(SUPPORTED_SOURCES)

    aliases = {
        "geo": "geo",
        "g": "geo",
        "1": "geo",
        "sra": "sra",
        "s": "sra",
        "2": "sra",
        "cellxgene": "cellxgene",
        "cxg": "cellxgene",
        "cell": "cellxgene",
        "c": "cellxgene",
        "3": "cellxgene",
    }
    out: list[str] = []
    seen: set[str] = set()
    for token in _parse_csv_tokens(lowered):
        mapped = aliases.get(token)
        if not mapped:
            continue
        if mapped not in seen:
            out.append(mapped)
            seen.add(mapped)
    return out or list(SUPPORTED_SOURCES)


def _prompt_int(prompt: str, default: int, allow_empty: bool = True) -> int | None:
    while True:
        raw = _prompt_text(prompt, default=str(default) if default is not None else None).strip()
        if not raw and allow_empty:
            return None
        try:
            return int(raw)
        except ValueError:
            print("Please enter an integer.")


def _prompt_year(prompt: str, default: str = "") -> int | None:
    while True:
        raw = _prompt_text(prompt, default=default).strip()
        if not raw:
            return None
        try:
            year = int(raw)
        except ValueError:
            print("Please enter a year as a number, e.g. 2021.")
            continue
        if year < 1990 or year > 2100:
            print("Please enter a reasonable year between 1990 and 2100.")
            continue
        return year


def _prompt_float_01(prompt: str, default: float) -> float:
    while True:
        raw = _prompt_text(prompt, default=str(default)).strip()
        try:
            value = float(raw)
        except ValueError:
            print("Please enter a value between 0 and 1.")
            continue
        if value < 0.0 or value > 1.0:
            print("Please enter a value between 0 and 1.")
            continue
        return value


def _easy_preset_defaults(key: str) -> dict[str, object]:
    if key == "1":
        return {
            "label": "PBMC Quick Start",
            "query": "pbmc immune atlas",
            "sources": ["geo", "sra", "cellxgene"],
            "organism": "Homo sapiens",
            "since_year": 2019,
            "cell_types": ["T-cell"],
            "require_annotation": False,
            "min_annotation_confidence": 0.0,
            "annotation_methods": [],
            "require_fine_tcell": False,
            "search_literature": True,
            "literature_global": False,
        }
    if key == "2":
        return {
            "label": "PBMC + Fine T-cell (Strict)",
            "query": "pbmc t cell atlas",
            "sources": ["cellxgene", "geo", "sra"],
            "organism": "Homo sapiens",
            "since_year": 2020,
            "cell_types": ["T-cell", "CD4 T", "CD8 T"],
            "require_annotation": True,
            "min_annotation_confidence": 0.55,
            "annotation_methods": ["seurat", "singler"],
            "require_fine_tcell": True,
            "search_literature": True,
            "literature_global": True,
        }
    return {
        "label": "Custom Search",
        "query": "",
        "sources": ["geo", "sra", "cellxgene"],
        "organism": "Homo sapiens",
        "since_year": None,
        "cell_types": [],
        "require_annotation": True,
        "min_annotation_confidence": 0.45,
        "annotation_methods": [],
        "require_fine_tcell": False,
        "search_literature": True,
        "literature_global": False,
    }


def _print_easy_summary(args: argparse.Namespace, preset_label: str) -> None:
    _print_section("Summary")
    print(f"Preset: {preset_label}")
    print(f"Query: {args.query}")
    print(f"Databases: {', '.join(str(x).upper() for x in args.source)}")
    print(f"Organism: {args.organism or '-'}")
    print("Year filter: off")
    print(f"Cell types: {', '.join(args.cell_type) if args.cell_type else 'all (no filter)'}")
    print("Annotation confidence filter: off")
    print("Annotation method prompt: off")
    print(f"Manual/lab only annotation mode: {'yes' if args.manual_lab_only else 'no'}")
    print(f"Require fine T-cell detail: {'yes' if args.require_fine_tcell else 'no'}")
    print(f"Dataset-linked literature: {'yes' if args.search_literature else 'no'}")
    print(f"Global literature: {'yes' if args.literature_global else 'no'}")
    print(f"Preview rows: {args.preview}")
    print(f"Output file: {args.out}")


def _build_search_args_for_easy() -> argparse.Namespace:
    _print_section("Interactive Search Mode")
    print("Answer a few questions and the rest is configured for you.")
    print("Press Ctrl+C any time to cancel.")

    preset_key = _prompt_choice(
        "Choose a start mode",
        options=[("1", "PBMC Quick Start"), ("2", "PBMC + Fine T-cell (Strict)"), ("3", "Custom Search")],
        default_key="1",
    )
    preset = _easy_preset_defaults(preset_key)

    query_default = str(preset["query"])
    query = _prompt_text("What do you want to search? (e.g. pbmc immune atlas)", default=query_default).strip()
    while not query:
        print("A query is required.")
        query = _prompt_text("What do you want to search?", default=query_default).strip()

    source_default = ",".join(str(x) for x in preset["sources"])
    source_text = _prompt_text(
        "Which databases? (all or 1,2,3 or geo,sra,cellxgene)",
        default=source_default,
    )
    sources = _parse_sources_input(source_text)

    cell_types = _parse_cell_types_input(
        _prompt_text(
            "Cell types (comma-separated, or 'all' for no cell-type filter)",
            default=",".join(str(x) for x in preset["cell_types"]),
        )
    )
    organism = "Homo sapiens"
    since_year = None
    require_annotation = False
    min_annotation_confidence = 0.0
    annotation_methods: list[str] = []
    require_fine_tcell = True
    manual_lab_only = True

    search_literature = _prompt_yes_no(
        "Search dataset-linked literature?",
        default_yes=bool(preset["search_literature"]),
    )
    literature_global = _prompt_yes_no(
        "Also show recent query-based PubMed papers?",
        default_yes=bool(preset["literature_global"]),
    )
    show_annotation_details = _prompt_yes_no("Show annotation details table?", default_yes=True)
    preview = _prompt_int("How many rows to show in the console?", default=20, allow_empty=False) or 20
    out = _prompt_text("Output file", default=DEFAULT_EASY_RESULTS).strip() or DEFAULT_EASY_RESULTS

    args = argparse.Namespace(
        query=query,
        max_results=100,
        source=sources,
        organism=organism,
        since_year=since_year,
        cell_type=cell_types,
        cell_mode="any",
        must_contain=[],
        exclude=[],
        min_score=0.45,
        require_annotation=require_annotation,
        min_annotation_confidence=min_annotation_confidence,
        annotation_method=annotation_methods,
        require_fine_tcell=require_fine_tcell,
        manual_lab_only=manual_lab_only,
        email=None,
        api_key=None,
        no_scrna_clause=False,
        search_literature=search_literature,
        papers_per_dataset=5,
        literature_global=literature_global,
        literature_top=5,
        show_cell_catalog=False,
        show_annotation_details=show_annotation_details,
        out=out,
        preview=preview,
    )
    _print_easy_summary(args=args, preset_label=str(preset["label"]))
    if not _prompt_yes_no("Start search now?", default_yes=True):
        raise KeyboardInterrupt
    return args


def _run_easy_followup(args: argparse.Namespace) -> int:
    if not args.out:
        return 0
    _print_section("Next Steps")
    if not _prompt_yes_no("Resolve downloadable files for matched datasets now?", default_yes=False):
        return 0

    manifest_out = _prompt_text("Manifest output file", default=DEFAULT_EASY_MANIFEST).strip() or DEFAULT_EASY_MANIFEST
    include_tokens = _parse_csv_tokens(_prompt_text("Include filename tokens (e.g. .h5ad,.mtx)", default=".h5ad"))
    list_args = argparse.Namespace(
        input=args.out,
        out=manifest_out,
        max_datasets=20,
        include=include_tokens,
        exclude=[],
    )
    run_list_files(list_args)

    if not _prompt_yes_no("Download files from manifest now?", default_yes=False):
        return 0

    dest = _prompt_text("Download destination folder", default="./downloads").strip() or "./downloads"
    max_files_raw = _prompt_text("Maximum files (0 = all)", default="20").strip()
    try:
        max_files = int(max_files_raw)
    except ValueError:
        max_files = 20
    dl_args = argparse.Namespace(
        manifest=manifest_out,
        dest=dest,
        include=[],
        exclude=[],
        max_files=max_files,
        dry_run=False,
    )
    run_download(dl_args)
    return 0


def run_easy(args: argparse.Namespace | None = None) -> int:
    try:
        search_args = _build_search_args_for_easy()
        code = run_search(search_args)
        if code != 0:
            return code
        return _run_easy_followup(search_args)
    except (EOFError, KeyboardInterrupt):
        print("")
        print("Cancelled.")
        return 130


def run_search(args: argparse.Namespace) -> int:
    args.cell_type = _normalize_cell_type_filters(args.cell_type or [])
    args.manual_lab_only = bool(getattr(args, "manual_lab_only", False))
    args.organism, organism_yes_no_guard = _sanitize_organism_filter(args.organism)
    if organism_yes_no_guard:
        print("Warning: organism filter looked like yes/no and was ignored.")
    api_key = args.api_key or os.getenv("NCBI_API_KEY")
    selected_sources = normalize_sources(args.source)
    report = search_datasets_report(
        user_query=args.query,
        max_results=args.max_results,
        email=args.email,
        api_key=api_key,
        scrna_only=(not args.no_scrna_clause),
        sources=selected_sources,
        include_literature=args.search_literature,
        papers_per_dataset=args.papers_per_dataset,
    )
    all_records = report.records
    filtered = filter_records(
        all_records,
        organism=args.organism,
        since_year=args.since_year,
        must_contain=args.must_contain,
        exclude=args.exclude,
        min_score=args.min_score,
        cell_types=args.cell_type,
        cell_mode=args.cell_mode,
        require_annotation=args.require_annotation,
        min_annotation_confidence=args.min_annotation_confidence,
        annotation_methods=args.annotation_method,
        require_fine_tcell=args.require_fine_tcell,
        manual_lab_only=args.manual_lab_only,
    )

    _print_search_overview(
        args=args,
        selected_sources=selected_sources,
        total_hits=len(all_records),
        filtered_hits=len(filtered),
        records=all_records,
    )
    _print_results(filtered, limit=args.preview)
    if not filtered and all_records:
        _print_zero_match_diagnostics(args, all_records)
    if args.show_annotation_details:
        _print_annotation_details(filtered, limit=args.preview)

    if report.warnings:
        print("")
        print("Warnings:")
        for warning in report.warnings:
            print(f"- {warning}")

    if args.literature_global:
        papers = search_recent_pubmed(
            user_query=args.query,
            max_results=args.literature_top,
            email=args.email,
            api_key=api_key,
            scrna_only=(not args.no_scrna_clause),
        )
        _print_recent_papers(papers, limit=args.literature_top)

    if args.out:
        write_records(args.out, filtered)
        print(f"Saved: {args.out}")
    if args.show_cell_catalog:
        print("")
        print("Known cell-type canonical labels:")
        print(", ".join(canonical_to_display_name(x) for x in canonical_cell_type_names()))
    return 0


def run_list_files(args: argparse.Namespace) -> int:
    records = read_records(args.input)
    if args.max_datasets > 0:
        records = records[: args.max_datasets]

    include = [x.lower() for x in args.include]
    exclude = [x.lower() for x in args.exclude]
    rows: list[dict[str, str]] = []
    skipped_no_supp = 0

    for r in records:
        source = (r.source or "").upper()
        if source == "CELLXGENE":
            assets = fetch_cellxgene_dataset_assets(r.accession)
            for asset in assets:
                file_name = asset["file_name"]
                lowered = file_name.lower()
                if include and not any(p in lowered for p in include):
                    continue
                if exclude and any(p in lowered for p in exclude):
                    continue
                rows.append(
                    {
                        "source": r.source,
                        "accession": r.accession,
                        "title": r.title,
                        "file_name": file_name,
                        "file_url": asset["file_url"],
                    }
                )
            continue

        if not r.supplementary_dir:
            skipped_no_supp += 1
            continue
        urls = fetch_supplementary_files(r.supplementary_dir)
        for url in urls:
            file_name = Path(url).name
            lowered = file_name.lower()
            if include and not any(p in lowered for p in include):
                continue
            if exclude and any(p in lowered for p in exclude):
                continue
            rows.append(
                {
                    "source": r.source,
                    "accession": r.accession,
                    "title": r.title,
                    "file_name": file_name,
                    "file_url": url,
                }
            )

    write_manifest(args.out, rows)
    print(f"Manifest entries: {len(rows)}")
    if skipped_no_supp > 0:
        print(f"Skipped records without supplementary directory: {skipped_no_supp}")
    print(f"Saved: {args.out}")
    return 0


def run_download(args: argparse.Namespace) -> int:
    rows = read_manifest(args.manifest)
    downloaded, skipped = download_from_manifest(
        manifest_rows=rows,
        destination=args.dest,
        include=args.include,
        exclude=args.exclude,
        max_files=args.max_files,
        dry_run=args.dry_run,
    )
    print(f"Downloaded: {downloaded}")
    print(f"Skipped: {skipped}")
    return 0


def run_evaluate(args: argparse.Namespace) -> int:
    results = run_benchmark(score_threshold=args.score_threshold)
    _print_benchmark(results)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="scrna-finder",
        description="Search, filter, and download scRNA-seq datasets from GEO, SRA, and CELLxGENE.",
    )
    sub = p.add_subparsers(dest="cmd", required=False)

    easy = sub.add_parser("easy", help="Interactive wizard: step-by-step prompts for your search.")
    easy.set_defaults(func=run_easy)

    search = sub.add_parser("search", help="Search GEO/SRA/CELLxGENE datasets and filter results.")
    search.add_argument("--query", required=True, help="Text query, e.g. 'lung cancer'.")
    search.add_argument("--max-results", type=int, default=100, help="Maximum records per selected source.")
    search.add_argument(
        "--source",
        action="append",
        choices=list(SUPPORTED_SOURCES),
        default=[],
        help="Data source to include (repeatable). Default: all sources.",
    )
    search.add_argument("--organism", default=None, help="Keep only records containing this organism string.")
    search.add_argument("--since-year", type=int, default=None, help="Keep records with pub year >= this year.")
    search.add_argument(
        "--cell-type",
        action="append",
        default=[],
        help="Cell type to filter on (repeatable). Use 'all' to disable cell-type filtering.",
    )
    search.add_argument(
        "--cell-mode",
        choices=["any", "all"],
        default="any",
        help="How repeated --cell-type terms are combined.",
    )
    search.add_argument("--must-contain", action="append", default=[], help="Must appear in title/summary (repeatable).")
    search.add_argument("--exclude", action="append", default=[], help="Exclude if token appears (repeatable).")
    search.add_argument("--min-score", type=float, default=0.45, help="Minimum scRNA relevance score (0-1).")
    search.add_argument(
        "--require-annotation",
        action="store_true",
        help="Keep only datasets with annotation evidence above a baseline confidence threshold.",
    )
    search.add_argument(
        "--min-annotation-confidence",
        type=float,
        default=0.0,
        help="Minimum annotation confidence (0-1) inferred from metadata and linked paper title.",
    )
    search.add_argument(
        "--annotation-method",
        action="append",
        default=[],
        help="Require at least one annotation method hit (repeatable), e.g. seurat, singler, celltypist, lab, manual.",
    )
    search.add_argument(
        "--manual-lab-only",
        action="store_true",
        help="Keep only datasets with manual/lab annotation signals and exclude software-annotated datasets.",
    )
    search.add_argument(
        "--require-fine-tcell",
        action="store_true",
        help="Require signals of fine-grained T-cell annotation (naive/memory/Treg/exhausted/etc.).",
    )
    search.add_argument("--email", default=None, help="Optional email for NCBI requests.")
    search.add_argument("--api-key", default=None, help="NCBI API key (or set NCBI_API_KEY env var).")
    search.add_argument("--no-scrna-clause", action="store_true", help="Disable built-in scRNA-focused query clause.")
    search.add_argument(
        "--search-literature",
        action="store_true",
        help="Fetch linked PubMed metadata for each dataset where PMIDs are available.",
    )
    search.add_argument(
        "--papers-per-dataset",
        type=int,
        default=5,
        help="Maximum linked PMIDs to inspect per dataset when --search-literature is enabled.",
    )
    search.add_argument(
        "--literature-global",
        action="store_true",
        help="Also run a query-based PubMed search for recent scRNA papers.",
    )
    search.add_argument(
        "--literature-top",
        type=int,
        default=5,
        help="Number of recent PubMed papers to display when --literature-global is enabled.",
    )
    search.add_argument(
        "--show-cell-catalog",
        action="store_true",
        help="Print the known canonical cell-type labels after the search.",
    )
    search.add_argument(
        "--show-annotation-details",
        action="store_true",
        help="Print detailed annotation evidence table (methods, evidence keywords, and signal sources).",
    )
    search.add_argument("--out", default=None, help="Output file (.csv or .json).")
    search.add_argument("--preview", type=int, default=20, help="Rows shown in terminal preview.")
    search.set_defaults(func=run_search)

    lf = sub.add_parser("list-files", help="Resolve supplementary file URLs from search output.")
    lf.add_argument("--input", required=True, help="Search output file (.csv/.json).")
    lf.add_argument("--out", required=True, help="Manifest output (.csv/.json).")
    lf.add_argument("--max-datasets", type=int, default=20, help="Max datasets to resolve (0 = all).")
    lf.add_argument("--include", action="append", default=[], help="Keep file names containing token (repeatable).")
    lf.add_argument("--exclude", action="append", default=[], help="Drop file names containing token (repeatable).")
    lf.set_defaults(func=run_list_files)

    dl = sub.add_parser("download", help="Download files from manifest.")
    dl.add_argument("--manifest", required=True, help="Manifest file from list-files (.csv/.json).")
    dl.add_argument("--dest", required=True, help="Destination folder.")
    dl.add_argument("--include", action="append", default=[], help="Keep file names containing token (repeatable).")
    dl.add_argument("--exclude", action="append", default=[], help="Drop file names containing token (repeatable).")
    dl.add_argument("--max-files", type=int, default=0, help="Limit files to download (0 = all).")
    dl.add_argument("--dry-run", action="store_true", help="Show actions without downloading.")
    dl.set_defaults(func=run_download)

    ev = sub.add_parser("evaluate", help="Run internal benchmark cases for relevance and cell-type matching.")
    ev.add_argument(
        "--score-threshold",
        type=float,
        default=0.5,
        help="Threshold used to classify relevance score as scRNA-positive.",
    )
    ev.set_defaults(func=run_evaluate)

    return p


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if not hasattr(args, "func"):
        # No command provided -> interactive user-friendly mode.
        return run_easy()
    try:
        return args.func(args)
    except RuntimeError as e:
        print(f"ERROR: {e}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
