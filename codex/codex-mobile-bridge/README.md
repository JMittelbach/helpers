# Codex Mobile Bridge

Mobile-first web app to run Codex on your Mac from a phone browser.

## Features

- Multi-chat workspace in the web app
- Live run status for all web-app chats
- Per-chat logs, messages, and latest answer
- Optional token auth (`APP_TOKEN`)
- Workspace safety guard via `ALLOWED_ROOTS`
- Optional Cloudflare quick tunnel for remote access

## Important Chat Scope

This app shows chats that are created and run **inside this web app**.

It does **not** automatically import or mirror already-running chats from VS Code or other Codex clients.

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
