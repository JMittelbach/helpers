#!/usr/bin/env bash
set -euo pipefail

# 1) If codex is already on PATH, use it.
if command -v codex >/dev/null 2>&1; then
  command -v codex
  exit 0
fi

# 2) Try VS Code ChatGPT extension bundled binary (macOS).
# Pick the newest matching extension directory.
latest=""
if [ -d "$HOME/.vscode/extensions" ]; then
  while IFS= read -r dir; do
    latest="$dir"
    break
  done < <(ls -dt "$HOME"/.vscode/extensions/openai.chatgpt-* 2>/dev/null || true)
fi

if [ -n "$latest" ]; then
  for platform_dir in macos-aarch64 macos-x64 linux-x64 linux-arm64; do
    candidate="$latest/bin/$platform_dir/codex"
    if [ -x "$candidate" ]; then
      echo "$candidate"
      exit 0
    fi
  done
fi

echo "codex binary not found" >&2
exit 1
