# codex usage helper

A small helper script that shows your Codex token usage:
- local tokens from `~/.codex/sessions/*.jsonl`
- if reachable: quota percentages/reset time from Codex's account usage endpoint

## Files

- `codex_usage.py`: usage report
- `Makefile`: quick commands
- `install_alias.sh`: optional alias installer (`tokens`)

## Quick start

```bash
cd codex
make run
```

## Optional: set alias `tokens`

```bash
cd codex
make install-alias
```

This writes the alias to:
- `~/.zshrc` for zsh
- `~/.bashrc` for bash

Then reload your shell config if needed:

```bash
source ~/.zshrc
# or
source ~/.bashrc
```

## Check login (Codex CLI)

```bash
codex login status
```

Typical output:

```text
Logged in using ChatGPT
```

If not logged in:

```bash
codex login
```

## Example output

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

Note: `no quota data` can appear when server access is currently unavailable. The
quota request does not send a prompt and does not depend on the selected model.
