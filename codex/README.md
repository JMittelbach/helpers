# codex usage helper

Kurzes Hilfsskript, das dir deinen Codex-Tokenverbrauch zeigt:
- lokale Tokens aus `~/.codex/sessions/*.jsonl`
- sofern erreichbar: Quota-Prozente/Reset-Zeit vom Server

## Dateien

- `codex_usage.py`: Usage-Report
- `Makefile`: schnelle Befehle
- `install_alias.sh`: optionaler Alias-Installer (`tokens`)

## Schnellstart

```bash
cd codex
make run
```

## Optional: Alias `tokens` setzen

```bash
cd codex
make install-alias
```

Das schreibt den Alias in:
- `~/.zshrc` für zsh
- `~/.bashrc` für bash

Danach ggf. neu laden:

```bash
source ~/.zshrc
# oder
source ~/.bashrc
```

## Login prüfen (Codex CLI)

```bash
codex login status
```

Typische Ausgabe:

```text
Logged in using ChatGPT
```

Wenn nicht eingeloggt:

```bash
codex login
```

## Beispielausgabe

```text
Codex quota
======================================================================================
5h        no quota data

7d        no quota data

Local tokens used
======================================================================================
Total local  ██████████████████████████████  3.549.977.180
Today        █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  72.078.889
Last 5h      █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  66.077.441
Last 7d      █████░░░░░░░░░░░░░░░░░░░░░░░░░  586.914.314
```

Hinweis: `no quota data` erscheint z. B. wenn gerade kein Serverzugriff möglich ist.
