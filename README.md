# helpers
Personal toolbox repo with two active projects and shared conventions.

## Projects

- `codex/`
  - `codex_usage.py`: local Codex token/quota helper
  - `codex-mobile-bridge/`: mobile web control surface for Codex on Mac
- `scrna-finder/`
  - Python CLI for scRNA dataset discovery/filter/download

## Fast Entry Points

### Codex Mobile Bridge

```bash
cd /Users/jannes/Github/helpers/codex/codex-mobile-bridge
npm start
```

### Codex Usage Helper

```bash
cd /Users/jannes/Github/helpers/codex
make run
```

### scRNA Finder

```bash
cd /Users/jannes/Github/helpers/scrna-finder
PYTHONPATH=src python3 -m scrna_finder.cli --help
```

## Repo Hygiene

- Runtime files are ignored:
  - `codex/codex-mobile-bridge/data/chats.json`
  - `scrna-finder/search_results.csv`
- Cache/build artifacts are ignored globally (`__pycache__`, `*.pyc`, `node_modules`, `.venv`, logs, `.env`).
- Structure guide: `docs/REPO_STRUCTURE.md`
