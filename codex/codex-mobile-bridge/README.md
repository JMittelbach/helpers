# Codex Mobile Bridge

Mobile-first Weboberflaeche, um `codex exec` auf deinem Mac auszufuehren und live am Handy zu verfolgen.

## Was ist drin

- Node.js Server mit WebSocket-Streaming
- Mobile UI (Prompt, Sandbox-Mode, Live-Logs, Final Answer)
- Optionales App-Token (`APP_TOKEN`)
- Pfad-Sicherheitsgrenze ueber `ALLOWED_ROOTS`

## Projektstruktur

- `server.js` - Backend, startet `codex exec --json`
- `public/index.html` - UI
- `public/app.js` - Clientlogik
- `public/styles.css` - Mobile Styling

## Voraussetzungen

- macOS/Linux mit installiertem `codex`
- Node.js 20+ und npm

Hinweis: Auf deinem aktuellen System war beim Check **kein `node` installiert** (`command not found`).

## Manuelle Befehle (dein Mac)

1. Node installieren (Homebrew):

```bash
brew install node@24
echo 'export PATH="/opt/homebrew/opt/node@24/bin:$PATH"' >> ~/.zprofile
source ~/.zprofile
node -v
npm -v
```

2. Codex-Pfad pruefen:

```bash
which codex
codex --version
```

Falls `codex` nicht gefunden wird:

```bash
cd /Users/jannes/Github/helpers/codex/codex-mobile-bridge
bash ./scripts/find-codex-bin.sh
bash ./scripts/fix-codex-path.sh
source ~/.zprofile
which codex
```

Alternative ohne PATH-Aenderung in `.env`:

```bash
CODEX_BIN="$(bash ./scripts/find-codex-bin.sh)"
echo "CODEX_BIN=$CODEX_BIN" >> .env
```

3. Projekt-Check:

```bash
cd /Users/jannes/Github/helpers/codex/codex-mobile-bridge
bash ./scripts/check-prereqs.sh
```

## Setup

1. In das Projekt wechseln:

```bash
cd /Users/jannes/Github/helpers/codex/codex-mobile-bridge
```

2. Abhaengigkeiten installieren:

```bash
npm install
```

3. Env-Datei anlegen:

```bash
cp .env.example .env
```

4. Optional `APP_TOKEN` in `.env` setzen.

5. Server starten:

```bash
npm start
```

6. Im gleichen WLAN auf dem Handy oeffnen:

```text
http://<MAC-IP>:4173
```

Lokale URLs ausgeben:

```bash
bash ./scripts/show-local-urls.sh
```

Kurze Diagnose:

```bash
npm run doctor
```

## Sicherheit

- Setze `APP_TOKEN`, bevor du vom Handy aus dem Heimnetz raus zugreifst.
- Lass `ALLOWED_ROOTS` eng (z. B. nur `/Users/jannes/Github`).
- Fuer Internetzugriff besser via Tailscale/ZeroTier statt offenem Port-Forwarding.

## Aktueller MVP-Flow

- Die UI startet pro Anfrage einen neuen `codex exec` Run.
- `read-only`: nur Analyse
- `workspace-write`: Datei-Aenderungen im erlaubten Root

## Naechster Ausbau (optional)

- Wechsel von `codex exec` auf `codex app-server` fuer echte, persistente Threads
- Session-Historie in lokaler Datei speichern
- PWA-Icons + Offline Shell
