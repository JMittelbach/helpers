#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="$($SCRIPT_DIR/find-codex-bin.sh)"

mkdir -p "$HOME/bin"
ln -sf "$TARGET" "$HOME/bin/codex"

printf 'Linked codex -> %s\n' "$TARGET"
printf 'Symlink path: %s\n' "$HOME/bin/codex"
printf '\nIf needed, ensure ~/bin is in PATH:\n'
printf 'echo '\''export PATH="$HOME/bin:$PATH"'\'' >> ~/.zprofile && source ~/.zprofile\n'
