# Codex Mobile Bridge

Mobile-first web app to run Codex on your Mac from a phone browser.

## Features

- Multi-chat workspace in the web app
- Live Codex thread list from local app-server (`cli`, `vscode`, `exec`, `appServer`)
- Continue any live thread with new prompts directly from mobile
- One-tap "Open As Live Thread" from mirrored chats (resume by thread id/path when possible)
- Handle command/file/permission approvals from mobile (`approve`, `approve session`, `deny`)
- Live run status for all web-app chats
- Per-chat logs, messages, and latest answer
- Read-only VS Code chat mirror (best-effort import from local session files)
- Codex session mirror from `~/.codex/sessions` with mobile continue support
- Built-in file browser for allowed roots (including VS Code/Codex folders)
- Optional token auth (`APP_TOKEN`)
- Workspace safety guard via `ALLOWED_ROOTS`
- Optional Cloudflare quick tunnel for remote access

## Important Chat Scope

Primary mode is now **live app-server threads**:
- these are full-control chats (`source = app-server-thread`)
- they include existing Codex/VS Code sessions and new mobile-created sessions
- approvals are handled directly in the mobile UI

Additional mirror modes still exist:
- VS Code chat session files as read-only chats (`source = vscode-mirror`)
- Codex session files (`source = codex-session-mirror`)

Mirror limits:
- VS Code mirror chats are not controllable from this app (`Run/Stop` disabled).
- Codex session mirror chats can be continued with new prompts (uses `codex exec resume`).
- For mirrored sessions with known thread ids, the UI can switch into a live app-server thread via `activate_live_chat`.
- Any mirror chat can be copied into a new editable local chat from the UI (`Copy To Editable Chat`).
- Import depends on what VS Code writes to local `chatSessions` files.
- Some in-progress threads may lag or appear partial depending on VS Code storage format.
- The app auto-refreshes mirror data in the background every few seconds.

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

## Optional Runtime Settings

```bash
VSCODE_MIRROR_ENABLED=1
VSCODE_MIRROR_SCAN_MS=3000
VSCODE_MIRROR_MAX_FILES=300
CODEX_SESSION_MIRROR_ENABLED=1
CODEX_SESSION_MIRROR_MAX_FILES=120
APP_SERVER_ENABLED=1
APP_SERVER_SYNC_MS=5000
APP_SERVER_THREAD_LIMIT=200
APP_SERVER_REQUEST_TIMEOUT_MS=25000
# Optional custom roots (comma-separated)
# VSCODE_MIRROR_ROOTS=/Users/you/Library/Application Support/Code/User/workspaceStorage

BROWSE_MAX_ENTRIES=400
BROWSE_MAX_FILE_BYTES=160000
# BROWSE_ROOTS=/Users/you/Github,/Users/you/.codex,/Users/you/Library/Application Support/Code/User
```
