.PHONY: help run install-alias check-login

help:
	@echo "Targets:"
	@echo "  make run          - Run local Codex usage report"
	@echo "  make check-login  - Check if Codex CLI is logged in"
	@echo "  make install-alias - Optional: set alias 'tokens' in .zshrc/.bashrc"

run:
	./codex_usage.py

check-login:
	codex login status

install-alias:
	./install_alias.sh
