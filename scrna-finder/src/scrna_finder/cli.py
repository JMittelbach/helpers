from __future__ import annotations

import argparse
import os
from pathlib import Path

from .celltypes import canonical_cell_type_names
from .downloader import download_from_manifest
from .filtering import filter_records
from .geo import fetch_supplementary_files, search_geo_series
from .io_utils import read_manifest, read_records, write_manifest, write_records


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


def _print_search_overview(args: argparse.Namespace, total_hits: int, filtered_hits: int) -> None:
    print("")
    print("=== Search Overview ===")
    print("Databases: GEO Series (NCBI GDS)")
    if args.search_literature:
        print("Literature: Linked PubMed papers for each GEO dataset (via NCBI E-utilities)")
    else:
        print("Literature: disabled")
    print(f"Query: {args.query}")
    print(f"Raw hits: {total_hits}")
    print(f"After filters: {filtered_hits}")
    print(f"Organism filter: {args.organism or '-'}")
    print(f"Year >= : {args.since_year if args.since_year is not None else '-'}")
    print(f"Min scRNA score: {args.min_score:.2f}")
    print(f"Cell types: {', '.join(args.cell_type) if args.cell_type else '-'}")
    print(f"Cell mode: {args.cell_mode if args.cell_type else '-'}")
    print("")


def _print_results(records: list, limit: int = 20) -> None:
    if not records:
        print("No matching datasets.")
        return

    shown = records[:limit]
    header = f"{'#':>3}  {'Accession':<11} {'Score':>6} {'Samples':>7} {'Papers':>10}  {'Cell Hits':<22} {'Organism':<20} Title"
    print(header)
    print("-" * len(header))
    for idx, r in enumerate(shown, start=1):
        cell_hits = _shorten(r.cell_type_hits or "-", 22)
        organism = _shorten(r.organism or "-", 20)
        title = _shorten(r.title, 68)
        print(
            f"{idx:>3}  {r.accession:<11} {r.relevance_score:>6.3f} "
            f"{_format_int(r.n_samples):>7} {_paper_preview(r):>10}  "
            f"{cell_hits:<22} {organism:<20} {title}"
        )


def run_search(args: argparse.Namespace) -> int:
    api_key = args.api_key or os.getenv("NCBI_API_KEY")
    all_records = search_geo_series(
        user_query=args.query,
        max_results=args.max_results,
        email=args.email,
        api_key=api_key,
        scrna_only=(not args.no_scrna_clause),
        include_literature=args.search_literature,
        papers_per_dataset=args.papers_per_dataset,
    )
    filtered = filter_records(
        all_records,
        organism=args.organism,
        since_year=args.since_year,
        must_contain=args.must_contain,
        exclude=args.exclude,
        min_score=args.min_score,
        cell_types=args.cell_type,
        cell_mode=args.cell_mode,
    )

    _print_search_overview(args=args, total_hits=len(all_records), filtered_hits=len(filtered))
    _print_results(filtered, limit=args.preview)

    if args.out:
        write_records(args.out, filtered)
        print(f"Saved: {args.out}")
    if args.show_cell_catalog:
        print("")
        print("Known cell-type canonical labels:")
        print(", ".join(canonical_cell_type_names()))
    return 0


def run_list_files(args: argparse.Namespace) -> int:
    records = read_records(args.input)
    if args.max_datasets > 0:
        records = records[: args.max_datasets]

    include = [x.lower() for x in args.include]
    exclude = [x.lower() for x in args.exclude]
    rows: list[dict[str, str]] = []

    for r in records:
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


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="scrna-finder",
        description="Search, filter, and download scRNA-seq datasets from public GEO records.",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    search = sub.add_parser("search", help="Search GEO Series and filter results.")
    search.add_argument("--query", required=True, help="Text query, e.g. 'lung cancer'.")
    search.add_argument("--max-results", type=int, default=100, help="Maximum records from GEO.")
    search.add_argument("--organism", default=None, help="Keep only records containing this organism string.")
    search.add_argument("--since-year", type=int, default=None, help="Keep records with pub year >= this year.")
    search.add_argument(
        "--cell-type",
        action="append",
        default=[],
        help="Cell type to filter on (repeatable). Accepts aliases like 'T-cell', 'CD8+ T', 'fibroblast'.",
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
    search.add_argument("--email", default=None, help="Optional email for NCBI requests.")
    search.add_argument("--api-key", default=None, help="NCBI API key (or set NCBI_API_KEY env var).")
    search.add_argument("--no-scrna-clause", action="store_true", help="Disable built-in scRNA-focused query clause.")
    search.add_argument(
        "--search-literature",
        action="store_true",
        help="Fetch linked PubMed metadata for each GEO dataset.",
    )
    search.add_argument(
        "--papers-per-dataset",
        type=int,
        default=5,
        help="Maximum number of linked PMIDs to inspect per dataset when --search-literature is enabled.",
    )
    search.add_argument(
        "--show-cell-catalog",
        action="store_true",
        help="Print the known canonical cell-type labels after the search.",
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

    return p


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except RuntimeError as e:
        print(f"ERROR: {e}")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
