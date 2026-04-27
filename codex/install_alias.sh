#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USAGE_SCRIPT="$SCRIPT_DIR/codex_usage.py"

if [[ ! -x "$USAGE_SCRIPT" ]]; then
  echo "Error: $USAGE_SCRIPT not found or not executable"
  exit 1
fi

SHELL_NAME="${SHELL##*/}"
case "$SHELL_NAME" in
  zsh) RC_FILE="$HOME/.zshrc" ;;
  bash) RC_FILE="$HOME/.bashrc" ;;
  *)
    echo "Unsupported shell '$SHELL_NAME'. Please add this alias manually:"
    echo "alias tokens=\"$USAGE_SCRIPT\""
    exit 1
    ;;
esac

ALIAS_LINE="alias tokens=\"$USAGE_SCRIPT\""

touch "$RC_FILE"
TMP_FILE="$(mktemp)"

awk -v line="$ALIAS_LINE" '
BEGIN { done=0 }
{
  if ($0 ~ /^alias[[:space:]]+tokens=/) {
    if (!done) {
      print line
      done=1
    }
    next
  }
  print
}
END {
  if (!done) print line
}
' "$RC_FILE" > "$TMP_FILE"

mv "$TMP_FILE" "$RC_FILE"

echo "Alias added/updated in $RC_FILE"

auto_sourced=false
if [[ "$RC_FILE" == "$HOME/.zshrc" && -n "${ZSH_VERSION:-}" ]]; then
  # shellcheck disable=SC1090
  source "$RC_FILE"
  auto_sourced=true
fi
if [[ "$RC_FILE" == "$HOME/.bashrc" && -n "${BASH_VERSION:-}" ]]; then
  # shellcheck disable=SC1090
  source "$RC_FILE"
  auto_sourced=true
fi

if [[ "$auto_sourced" == true ]]; then
  echo "Config sourced in current shell. Try: tokens --help"
else
  echo "Open a new terminal or run: source $RC_FILE"
fi
