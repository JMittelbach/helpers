# scRNA Finder

CLI tool to search, filter, and download scRNA-seq datasets from public repositories, with robust cell-type filtering and optional linked-paper enrichment.

## Install

```bash
cd /Users/jannes/Github/helpers/scrna-finder
python3 -m pip install -e . --no-build-isolation
```

## 1) Search + Filter (including Cell Types)

```bash
scrna-finder search \
  --query "lung adenocarcinoma" \
  --organism "Homo sapiens" \
  --since-year 2019 \
  --cell-type "T-cell" \
  --cell-type "fibroblast" \
  --cell-mode any \
  --must-contain "tumor" \
  --exclude "microarray" \
  --min-score 0.55 \
  --search-literature \
  --papers-per-dataset 5 \
  --out results.csv
```

The search output now includes:
- databases currently queried
- whether linked literature lookup is active
- active filters
- a readable table with score, sample count, linked-paper stats, and matched cell-type hits

## 2) Resolve Supplementary Files

```bash
scrna-finder list-files \
  --input results.csv \
  --max-datasets 15 \
  --include ".h5ad" \
  --include "matrix.mtx" \
  --out files.csv
```

## 3) Download

```bash
scrna-finder download \
  --manifest files.csv \
  --dest ./downloads \
  --max-files 20
```

## What Is Searched

- GEO Series metadata via NCBI E-utilities (`db=gds`)
- GEO FTP supplementary file listings for file discovery
- Optional: linked PubMed metadata for each GEO dataset (`--search-literature`)

## Notes

- Current dataset search source is GEO Series (`GSE`).
- Relevance score is keyword-based to rank likely scRNA/snrna datasets.
- Cell-type filter handles many label variants (e.g. `T-cell`, `tcell`, `CD8+ T`, `t lymphocyte`).
- For higher throughput at NCBI, set `NCBI_API_KEY`.
