# Codex Mobile Bridge

Mobile-first web app to run Codex on your Mac from a phone browser.

## Features

- Multi-chat workspace in the web app
- Live run status for all web-app chats
- Per-chat logs, messages, and latest answer
- Read-only VS Code chat mirror (best-effort import from local session files)
- Read-only Codex session mirror from `~/.codex/sessions`
- Built-in file browser for allowed roots (including VS Code/Codex folders)
- Optional token auth (`APP_TOKEN`)
- Workspace safety guard via `ALLOWED_ROOTS`
- Optional Cloudflare quick tunnel for remote access

## Important Chat Scope

This app fully supports chats that are created and run **inside this web app**.

It now also mirrors:
- VS Code chat session files as read-only chats (`source = vscode-mirror`)
- Codex session files as read-only chats (`source = codex-session-mirror`)

Mirror limits:
- Mirror chats are not controllable from this app (`Run/Stop` disabled).
- Import depends on what VS Code writes to local `chatSessions` files.
- Some in-progress threads may lag or appear partial depending on VS Code storage format.

## Project Structure

- `server.js`: backend, websocket API, chat store, Codex process runner
- `public/index.html`: mobile UI
- `public/app.js`: client state management and live updates
- `public/styles.css`: styling
- `scripts/`: helper scripts

## Prerequisites

- macOS/Linux with `codex` available
- Node.js 20+ and npm

## Manual Setup (Mac)

```bash
brew install node@24
echo 'export PATH="/opt/homebrew/opt/node@24/bin:$PATH"' >> ~/.zprofile
source ~/.zprofile

node -v
npm -v
which codex
codex --version
```

If `codex` is not found:

```bash
cd /Users/jannes/Github/helpers/codex/codex-mobile-bridge
bash ./scripts/find-codex-bin.sh
bash ./scripts/fix-codex-path.sh
source ~/.zprofile
which codex
```

## Local Run

```bash
cd /Users/jannes/Github/helpers/codex/codex-mobile-bridge
npm install
cp .env.example .env
npm start
```

In another terminal:

```bash
npm run urls
```

Open the shown URL from your phone.

## Any-Network Access (optional)

```bash
brew install cloudflared
cd /Users/jannes/Github/helpers/codex/codex-mobile-bridge
npm start
# new terminal
npm run tunnel:cf
```

Use the `https://...trycloudflare.com` URL on your phone.

Note: Some corporate/filtered networks may block `trycloudflare` with TLS interception.

## Useful Commands

```bash
npm run doctor
npm run urls
npm run codex:find
npm run codex:fix-path
npm run tunnel:cf
```

## Security Notes

- Set a strong `APP_TOKEN` in `.env`.
- Keep `ALLOWED_ROOTS` narrow.
- Do not expose an unauthenticated bridge to the public internet.

## Optional Mirror Settings

```bash
VSCODE_MIRROR_ENABLED=1
VSCODE_MIRROR_SCAN_MS=3000
VSCODE_MIRROR_MAX_FILES=300
CODEX_SESSION_MIRROR_ENABLED=1
CODEX_SESSION_MIRROR_MAX_FILES=120
# Optional custom roots (comma-separated)
# VSCODE_MIRROR_ROOTS=/Users/you/Library/Application Support/Code/User/workspaceStorage

BROWSE_MAX_ENTRIES=400
BROWSE_MAX_FILE_BYTES=160000
# BROWSE_ROOTS=/Users/you/Github,/Users/you/.codex,/Users/you/Library/Application Support/Code/User
```
