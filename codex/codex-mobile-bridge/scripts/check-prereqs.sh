#!/usr/bin/env bash
set -euo pipefail

pass() {
  printf '[OK] %s\n' "$1"
}

warn() {
  printf '[WARN] %s\n' "$1"
}

section() {
  printf '\n%s\n' "$1"
}

section "Codex Mobile Bridge - Prereq Check"

if command -v brew >/dev/null 2>&1; then
  pass "Homebrew found: $(brew --version | head -n 1)"
else
  warn "Homebrew is missing. Install: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
fi

if command -v node >/dev/null 2>&1; then
  pass "node found: $(node -v)"
else
  warn "node is missing. Recommended install: brew install node@24"
  warn "Then add to PATH: echo 'export PATH=\"/opt/homebrew/opt/node@24/bin:\$PATH\"' >> ~/.zprofile && source ~/.zprofile"
fi

if command -v npm >/dev/null 2>&1; then
  pass "npm found: $(npm -v)"
else
  warn "npm is missing (it ships with Node)."
fi

if command -v codex >/dev/null 2>&1; then
  pass "codex found: $(command -v codex)"
else
  if codex_from_extension="$(bash ./scripts/find-codex-bin.sh 2>/dev/null)"; then
    warn "codex is not in PATH, but a binary was found: $codex_from_extension"
    warn "Fix: bash ./scripts/fix-codex-path.sh"
    warn "Or set in .env: CODEX_BIN=$codex_from_extension"
  else
    warn "codex is missing. Install Codex CLI or fix your PATH."
  fi
fi

if command -v cloudflared >/dev/null 2>&1; then
  pass "cloudflared found: $(cloudflared --version | head -n 1)"
else
  warn "cloudflared is missing. For any-network access: brew install cloudflared"
fi

section "Project Status"
if [ -f "package.json" ]; then
  pass "package.json found"
else
  warn "package.json is missing"
fi

if [ -f ".env" ]; then
  pass ".env found"
else
  warn ".env is missing. Create it with: cp .env.example .env"
fi

section "Next Steps"
printf '1) Install Node\n'
printf '2) npm install\n'
printf '3) cp .env.example .env\n'
printf '4) npm start\n'
