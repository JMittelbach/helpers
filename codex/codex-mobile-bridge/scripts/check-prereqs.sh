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
  pass "Homebrew gefunden: $(brew --version | head -n 1)"
else
  warn "Homebrew fehlt. Installieren: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
fi

if command -v node >/dev/null 2>&1; then
  pass "node gefunden: $(node -v)"
else
  warn "node fehlt. Installieren (empfohlen): brew install node@24"
  warn "Danach in PATH: echo 'export PATH=\"/opt/homebrew/opt/node@24/bin:\$PATH\"' >> ~/.zprofile && source ~/.zprofile"
fi

if command -v npm >/dev/null 2>&1; then
  pass "npm gefunden: $(npm -v)"
else
  warn "npm fehlt (kommt mit Node)."
fi

if command -v codex >/dev/null 2>&1; then
  pass "codex gefunden: $(command -v codex)"
else
  if codex_from_extension="$(bash ./scripts/find-codex-bin.sh 2>/dev/null)"; then
    warn "codex nicht im PATH, aber vorhanden: $codex_from_extension"
    warn "Fix: bash ./scripts/fix-codex-path.sh"
    warn "Oder .env setzen: CODEX_BIN=$codex_from_extension"
  else
    warn "codex fehlt. Installiere Codex CLI oder stelle den Pfad in PATH."
  fi
fi

if command -v cloudflared >/dev/null 2>&1; then
  pass "cloudflared gefunden: $(cloudflared --version | head -n 1)"
else
  warn "cloudflared fehlt. Fuer Zugriff von jedem Netz: brew install cloudflared"
fi

section "Projektstatus"
if [ -f "package.json" ]; then
  pass "package.json vorhanden"
else
  warn "package.json fehlt"
fi

if [ -f ".env" ]; then
  pass ".env vorhanden"
else
  warn ".env fehlt. Erzeuge: cp .env.example .env"
fi

section "Naechste Schritte"
printf '1) Node installieren\n'
printf '2) npm install\n'
printf '3) cp .env.example .env\n'
printf '4) npm start\n'
