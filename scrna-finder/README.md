# scRNA Finder

CLI tool to search, filter, and download scRNA-seq datasets from public repositories, with robust cell-type filtering and optional literature enrichment.

## Install

```bash
cd /Users/jannes/Github/helpers/scrna-finder
python3 -m pip install -e . --no-build-isolation
```

If your Python setup blocks global installs (PEP668), run directly without install:

```bash
cd /Users/jannes/Github/helpers/scrna-finder
PYTHONPATH=src python3 -m scrna_finder.cli --help
```

## Conda-Only Setup (No pip for user)

If you want conda-only usage, run:

```bash
cd /Users/jannes/Github/helpers/scrna-finder
./scripts/setup_conda.sh
conda activate scrna-finder
scrna-finder
```

Notes:
- no `pip install` command is needed by the user
- the setup script creates a launcher command `scrna-finder` inside the conda env

### Same flow with `make`

```bash
cd /Users/jannes/Github/helpers/scrna-finder
make conda-shell
```

This does setup and opens an interactive shell in the conda env.

Useful variants:

```bash
make conda-run
make conda-shell CONDA_ENV=my-scrna-env PYTHON_VERSION=3.12
```

## Quickstart

```bash
scrna-finder search \
  --query "lung adenocarcinoma" \
  --source geo \
  --source sra \
  --source cellxgene \
  --organism "Homo sapiens" \
  --since-year 2019 \
  --cell-type "CD8+ T" \
  --cell-type "fibroblast" \
  --cell-mode any \
  --must-contain "tumor" \
  --exclude "microarray" \
  --min-score 0.55 \
  --literature-global \
  --search-literature \
  --papers-per-dataset 5 \
  --literature-top 8 \
  --out results.csv
```

## Easy Mode (One Question)

Start without long commands. The tool starts the fixed project search directly:

```bash
cd /Users/jannes/Github/helpers/scrna-finder
PYTHONPATH=src python3 -m scrna_finder.cli
```

or explicitly:

```bash
PYTHONPATH=src python3 -m scrna_finder.cli easy
```

The easy mode asks one question:
- require annotation evidence? (default: `yes`)

Then it applies these defaults automatically:
- query is fixed to `pbmc`
- sources are fixed to `geo,sra,cellxgene`
- organism is fixed to `Homo sapiens`
- all cell types are allowed (no cell-type filter)
- no year filter
- no annotation-confidence prompt
- scRNA score threshold is disabled (`min-score = 0.0`)
- fine T-cell subtype requirement is disabled
- if annotation is enabled, manual/lab annotation mode is enabled and software-annotated datasets are excluded

## PBMC + Fine T-Cell Focus

```bash
scrna-finder search \
  --query "pbmc immune atlas" \
  --source cellxgene \
  --organism "Homo sapiens" \
  --cell-type "T-cell" \
  --require-annotation \
  --annotation-method seurat \
  --annotation-method singler \
  --require-fine-tcell \
  --min-annotation-confidence 0.55 \
  --show-annotation-details \
  --preview 30 \
  --out pbmc_ranked.csv
```

Console output includes:
- selected data sources
- hit distribution per source
- active filter settings
- table with score, sample count, paper stats, PMID hint (if available), and matched cell-type aliases
- optional extra table with recent query-based PubMed papers
- warning section when one selected source is temporarily unavailable

## Resolve Download Files (GEO + CELLxGENE)

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

## Internal Evaluation

```bash
scrna-finder evaluate --score-threshold 0.5
```

Runs built-in benchmark cases for:
- scRNA relevance scoring quality
- cell-type alias matching edge cases

## What Databases Are Searched

- `GEO` series metadata via NCBI E-utilities (`db=gds`)
- `SRA` study metadata via NCBI E-utilities (`db=sra`)
- `CELLxGENE Discover` dataset index via CZI Data Portal API (`/dp/v1/datasets/index` or `/v1/datasets/index`)
- `CELLxGENE Discover` per-dataset asset endpoints for download links
- `PubMed` dataset-linked paper metadata (`--search-literature`)
- `PubMed` query-based recent paper search (`--literature-global`)
- GEO FTP supplementary listings are used for GEO file discovery (`list-files`)

## Main Search Options

- `--source geo --source sra --source cellxgene`: choose one or multiple dataset sources (default: all)
- `--cell-type ...`: repeatable, alias-aware cell-type filter (`T-cell`, `tcell`, `CD8+ T`, etc.); use `--cell-type all` to disable cell-type filtering
- `--cell-mode any|all`: combine repeated cell types
- `--require-annotation`: keep only datasets with annotation evidence
- `--annotation-method`: require a method hit (e.g. `seurat`, `singler`, `celltypist`, `azimuth`, `scanvi`, `lab`, `manual`)
- `--require-fine-tcell`: require fine-grained T-cell subtype signals (`naive`, `memory`, `Treg`, `exhausted`, etc.)
- `--require-tcell-pure`: strict text-hint filter for likely ~100% T-cell datasets (`sorted/purified/enriched T-cell` wording)
- `--min-annotation-confidence`: confidence threshold for inferred annotation quality
- `--show-annotation-details`: print methods/evidence/signal source (`title`, `summary`, `paper_title`)
- `--search-literature`: enrich each dataset with linked PubMed metadata
- `--literature-global`: additionally show recent PubMed papers for the search query
- `--show-cell-catalog`: print the known canonical cell-type labels

## Notes

- Relevance score is keyword-based to rank likely scRNA/snrna datasets.
- Cell-type filter is not limited to T-cells. It supports many groups (`B-cell`, `NK`, `monocyte`, `dendritic`, `platelet`, `megakaryocyte`, `erythrocyte`, `fibroblast`, `epithelial`, `endothelial`, etc.) with typo-tolerant matching for common misspellings.
- Annotation signals are inferred heuristically from metadata and (if available) linked paper titles.
- Manual/lab-style annotation evidence is surfaced when terms like `manual curation`, `flow cytometry`, or `expert curated` are detected.
- If linked PubMed IDs are available, the output includes a PMID/URL hint per dataset.
- For strict method provenance, inspect the linked paper methods section or supplementary metadata.
- For higher throughput at NCBI, set `NCBI_API_KEY`.
