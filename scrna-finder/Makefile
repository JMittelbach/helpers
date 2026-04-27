SHELL := /bin/bash

CONDA_ENV ?= scrna-finder
PYTHON_VERSION ?= 3.11

.PHONY: help conda-setup conda-shell conda-run test

help:
	@echo "Targets:"
	@echo "  make conda-setup              # create/update conda env + launcher"
	@echo "  make conda-shell              # setup env and open interactive shell in env"
	@echo "  make conda-run                # setup env and run fixed PBMC search profile"
	@echo "  make test                     # run local unit tests"
	@echo ""
	@echo "Variables:"
	@echo "  CONDA_ENV=<name>              # default: $(CONDA_ENV)"
	@echo "  PYTHON_VERSION=<version>      # default: $(PYTHON_VERSION)"

conda-setup:
	@PYTHON_VERSION="$(PYTHON_VERSION)" ./scripts/setup_conda.sh "$(CONDA_ENV)"

conda-shell: conda-setup
	@echo "Opening shell in conda env '$(CONDA_ENV)'..."
	@echo "Exit this shell with 'exit'."
	@bash -lc 'source "$$(conda info --base)/etc/profile.d/conda.sh" && conda activate "$(CONDA_ENV)" && exec bash -i'

conda-run: conda-setup
	@bash -lc 'source "$$(conda info --base)/etc/profile.d/conda.sh" && conda activate "$(CONDA_ENV)" && PYTHONPATH=src python -m scrna_finder.cli'; rc=$$?; if [ $$rc -eq 130 ]; then echo "Wizard cancelled (ok)."; exit 0; fi; exit $$rc

test:
	@PYTHONPATH=src python3 -m unittest discover -s tests -v
