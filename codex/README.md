# codex usage helper

A small helper script that shows your Codex token usage:
- local tokens from `~/.codex/sessions/*.jsonl`
- if reachable: quota percentages/reset time and remaining credits from Codex's account usage endpoint

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

## Remaining credits

`tokens` also shows the live credit balance and a used-percentage bar.
The usage endpoint supplies a balance, but no original credit total. By default,
the reference is the highest balance observed by this helper for the account,
saved in `~/.cache/codex-usage/credits.json` (hashed account identifiers, no login
secrets). The first observation starts at 0% used; this is not a purchased-total
or subscription-quota percentage. Later top-ups raise the reference if needed.
The reference is tracked internally and is not printed in the report.

To use a known total instead, run `tokens --credits-total 100000`. This does not
change the saved reference. The used percentage is clamped to 0–100%; a balance above the total
displays 0% used with an empty bar. Unlimited, missing, and zero balances are handled explicitly;
if no positive reference can be stored or determined, only the balance is shown.

Run the offline tests with `python3 -B -m unittest discover -s codex -p 'test_*.py'`
from the repository root.
