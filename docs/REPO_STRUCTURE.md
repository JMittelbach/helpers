# Repository Structure

## Current Layout

```text
helpers/
├── codex/
│   ├── codex_usage.py
│   ├── install_alias.sh
│   └── codex-mobile-bridge/
│       ├── server.js
│       ├── public/
│       └── scripts/
├── scrna-finder/
│   ├── src/scrna_finder/
│   ├── tests/
│   └── scripts/
├── docs/
└── README.md
```

## Conventions

- Keep each tool self-contained in its project folder.
- Put long-form docs under `docs/`.
- Keep executable helpers in project-local `scripts/`.
- Do not commit runtime/cache artifacts:
  - Python: `__pycache__/`, `*.pyc`, `.venv/`
  - Node: `node_modules/`
  - Runtime outputs:
    - `codex/codex-mobile-bridge/data/chats.json`
    - `scrna-finder/search_results.csv`

## Where New Things Go

- New Codex-related tool: `codex/<tool-name>/`
- New bioinformatics/analysis CLI: `scrna-finder/<module-or-script>`
- Shared docs/notes: `docs/`

## Optional Future Split

If this repo grows further, split into:
- `apps/` for runnable services
- `cli/` for command-line utilities
- `libs/` for reusable shared code
