#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-4173}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not found. Install with: brew install cloudflared" >&2
  exit 1
fi

if ! curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  echo "Local bridge server not reachable on port ${PORT}. Start it first: npm start" >&2
  exit 1
fi

echo "Starting Cloudflare Quick Tunnel for http://127.0.0.1:${PORT}"
echo "Share the https://...trycloudflare.com URL shown below."
echo "Press Ctrl+C to stop tunnel."

autoupdate_flag=""
if cloudflared tunnel --help 2>/dev/null | grep -q -- '--no-autoupdate'; then
  autoupdate_flag="--no-autoupdate"
fi

if [ -n "$autoupdate_flag" ]; then
  cloudflared tunnel "$autoupdate_flag" --url "http://127.0.0.1:${PORT}"
else
  cloudflared tunnel --url "http://127.0.0.1:${PORT}"
fi
