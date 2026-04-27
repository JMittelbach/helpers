#!/usr/bin/env python3

import argparse
import datetime as dt
import glob
import json
import os
import urllib.error
import urllib.request

try:
    import tomllib
except ImportError:
    tomllib = None


AUTH_PATH = os.path.expanduser("~/.codex/auth.json")
CONFIG_PATH = os.path.expanduser("~/.codex/config.toml")
SESSIONS_DIR = os.path.expanduser("~/.codex/sessions")
CODEX_URL = "https://chatgpt.com/backend-api/codex/responses"

DEFAULT_MODEL = "gpt-5.3-codex"


def fmt_int(value):
    return f"{int(round(value)):,}".replace(",", ".")


def fmt_duration(seconds):
    if seconds is None:
        return "unknown"

    seconds = max(0, int(seconds))
    days = seconds // 86400
    hours = (seconds % 86400) // 3600
    minutes = (seconds % 3600) // 60

    if days:
        return f"{days}d {hours}h {minutes}m"
    if hours:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"


def bar(percent, width=30):
    if percent is None:
        return "[" + "?" * width + "]"

    percent = max(0.0, min(100.0, float(percent)))
    filled = round(width * percent / 100.0)
    return "[" + "█" * filled + "░" * (width - filled) + "]"


def token_bar(value, max_value, width=30):
    if max_value <= 0:
        filled = 0
    else:
        filled = round(width * value / max_value)

    return "█" * filled + "░" * (width - filled)


def get_header(headers, name):
    for key, value in headers.items():
        if key.lower() == name.lower():
            return value
    return None


def as_float(value):
    try:
        return float(value)
    except Exception:
        return None


def as_int(value):
    try:
        return int(float(value))
    except Exception:
        return None


def read_config_model():
    if not tomllib or not os.path.exists(CONFIG_PATH):
        return None

    try:
        with open(CONFIG_PATH, "rb") as handle:
            cfg = tomllib.load(handle)
    except Exception:
        return None

    active_profile = cfg.get("profile")
    profiles = cfg.get("profiles", {})

    if active_profile and isinstance(profiles, dict):
        profile_cfg = profiles.get(active_profile, {})
        if isinstance(profile_cfg, dict) and profile_cfg.get("model"):
            return profile_cfg["model"]

    return cfg.get("model")


def resolve_model(cli_model):
    if cli_model:
        return cli_model

    env_model = os.environ.get("CODEX_MODEL")
    if env_model:
        return env_model

    cfg_model = read_config_model()
    if cfg_model:
        return cfg_model

    return DEFAULT_MODEL


def read_auth():
    if not os.path.exists(AUTH_PATH):
        raise RuntimeError("Missing ~/.codex/auth.json. Run: codex login")

    with open(AUTH_PATH, "r", encoding="utf-8") as handle:
        auth = json.load(handle)

    tokens = auth.get("tokens", {})

    access_token = (
        tokens.get("access_token")
        or auth.get("access_token")
        or auth.get("token")
    )

    account_id = (
        tokens.get("account_id")
        or auth.get("account_id")
        or auth.get("chatgpt_account_id")
        or auth.get("last_openai_account_id")
    )

    if not access_token:
        raise RuntimeError("No access token found in ~/.codex/auth.json. Run: codex login")

    return access_token, account_id


def fetch_codex_quota(model):
    access_token, account_id = read_auth()

    payload = {
        "model": model,
        "instructions": "You are a minimal assistant.",
        "input": [
            {
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": "Return only: ok"}],
            }
        ],
        "tools": [],
        "tool_choice": "auto",
        "parallel_tool_calls": False,
        "store": False,
        "stream": True,
    }

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "OpenAI-Beta": "responses=experimental",
        "originator": "codex_cli_rs",
        "User-Agent": "simple-codex-quota/1.1",
        "session_id": os.urandom(16).hex(),
    }

    if account_id:
        headers["chatgpt-account-id"] = account_id

    request = urllib.request.Request(
        CODEX_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, dict(response.headers), None

    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        return error.code, dict(error.headers), body

    except Exception as error:
        return "failed", {}, str(error)


def parse_time(value):
    if not value:
        return None

    if isinstance(value, (int, float)):
        try:
            return dt.datetime.fromtimestamp(value)
        except Exception:
            return None

    if isinstance(value, str):
        try:
            parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo:
                parsed = parsed.astimezone().replace(tzinfo=None)
            return parsed
        except Exception:
            return None

    return None


def event_time(obj, path):
    candidates = [
        obj.get("timestamp"),
        obj.get("ts"),
        obj.get("time"),
        obj.get("created_at"),
    ]

    payload = obj.get("payload")
    if isinstance(payload, dict):
        candidates.extend(
            [
                payload.get("timestamp"),
                payload.get("ts"),
                payload.get("time"),
                payload.get("created_at"),
            ]
        )

        info = payload.get("info")
        if isinstance(info, dict):
            candidates.extend(
                [
                    info.get("timestamp"),
                    info.get("ts"),
                    info.get("time"),
                    info.get("created_at"),
                ]
            )

    for candidate in candidates:
        parsed = parse_time(candidate)
        if parsed:
            return parsed

    try:
        return dt.datetime.fromtimestamp(os.path.getmtime(path))
    except Exception:
        return dt.datetime.now()


def token_total_from_usage(usage):
    if isinstance(usage, (int, float)):
        return int(usage)

    if not isinstance(usage, dict):
        return None

    for key in [
        "total_tokens",
        "total",
        "tokens",
        "total_token_count",
        "total_tokens_count",
    ]:
        if key in usage:
            try:
                return int(usage[key])
            except Exception:
                pass

    total = 0
    found = False

    for key, value in usage.items():
        if isinstance(value, (int, float)) and "token" in key.lower():
            total += int(value)
            found = True

    return total if found else None


def extract_token_count(obj):
    payload = obj.get("payload")
    if not isinstance(payload, dict):
        return None

    if payload.get("type") != "token_count":
        return None

    info = payload.get("info")
    if not isinstance(info, dict):
        info = payload

    usage = (
        info.get("total_token_usage")
        or info.get("token_usage")
        or info.get("usage")
    )

    return token_total_from_usage(usage)


def local_token_stats(days=7):
    files = glob.glob(os.path.join(SESSIONS_DIR, "**", "*.jsonl"), recursive=True)

    now = dt.datetime.now()
    today = now.date()

    start_date = today - dt.timedelta(days=days - 1)
    start_dt = dt.datetime.combine(start_date, dt.time.min)
    five_hours_ago = now - dt.timedelta(hours=5)

    daily = {
        start_date + dt.timedelta(days=i): 0
        for i in range(days)
    }

    all_time_total = 0
    today_total = 0
    last_5h_total = 0
    week_total = 0
    event_count = 0

    for path in files:
        previous_total = 0

        try:
            with open(path, "r", encoding="utf-8") as handle:
                for line in handle:
                    try:
                        obj = json.loads(line)
                    except Exception:
                        continue

                    current_total = extract_token_count(obj)
                    if current_total is None:
                        continue

                    delta = current_total - previous_total
                    if delta < 0:
                        delta = current_total

                    previous_total = current_total

                    if delta <= 0:
                        continue

                    timestamp = event_time(obj, path)
                    date_key = timestamp.date()

                    all_time_total += delta
                    event_count += 1

                    if timestamp >= five_hours_ago:
                        last_5h_total += delta

                    if timestamp >= start_dt:
                        week_total += delta

                        if date_key in daily:
                            daily[date_key] += delta

                        if date_key == today:
                            today_total += delta

        except Exception:
            continue

    return {
        "all_time": all_time_total,
        "today": today_total,
        "last_5h": last_5h_total,
        "last_7d": week_total,
        "daily": daily,
        "events": event_count,
        "files": len(files),
    }


def estimate_left(local_used, used_percent):
    if used_percent is None:
        return None, None

    if used_percent <= 0:
        return None, None

    estimated_total = local_used / (used_percent / 100.0)
    estimated_left = max(0.0, estimated_total - local_used)

    return estimated_total, estimated_left


def print_quota(label, used_percent, reset_seconds, local_used):
    if used_percent is None:
        print(f"{label:<9} no quota data")
        return

    left_percent = max(0.0, 100.0 - used_percent)
    estimated_total, estimated_left = estimate_left(local_used, used_percent)

    print(
        f"{label:<9} {bar(used_percent)}  "
        f"{used_percent:5.1f}% used  |  {left_percent:5.1f}% left  |  reset {fmt_duration(reset_seconds)}"
    )

    print(f"{'':<9} used tokens: {fmt_int(local_used)}")

    if estimated_left is not None:
        print(
            f"{'':<9} estimated left: {fmt_int(estimated_left)} "
            f"/ estimated total: {fmt_int(estimated_total)}"
        )
    else:
        print(f"{'':<9} estimated left: not available yet")


def print_token_summary(stats):
    max_value = max(stats["all_time"], stats["today"], stats["last_5h"], stats["last_7d"], 1)

    rows = [
        ("Total local", stats["all_time"]),
        ("Today", stats["today"]),
        ("Last 5h", stats["last_5h"]),
        ("Last 7d", stats["last_7d"]),
    ]

    for label, value in rows:
        print(f"{label:<12} {token_bar(value, max_value)}  {fmt_int(value)}")


def print_daily_chart(daily):
    print()
    print("Last 7 days")
    print("=" * 86)

    max_value = max(daily.values()) if daily else 0

    for date_key, tokens in daily.items():
        print(
            f"{date_key.strftime('%a')} {date_key.strftime('%Y-%m-%d')}  "
            f"{token_bar(tokens, max_value)}  {fmt_int(tokens)}"
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--model",
        help="Optional internal Codex model for the quota request, e.g. gpt-5.5",
    )
    args = parser.parse_args()

    model = resolve_model(args.model)
    status, headers, error_body = fetch_codex_quota(model)

    primary_used = as_float(get_header(headers, "x-codex-primary-used-percent"))
    primary_reset = as_int(get_header(headers, "x-codex-primary-reset-after-seconds"))

    secondary_used = as_float(get_header(headers, "x-codex-secondary-used-percent"))
    secondary_reset = as_int(get_header(headers, "x-codex-secondary-reset-after-seconds"))

    stats = local_token_stats(days=7)

    print()
    print("Codex quota")
    print("=" * 86)
    print_quota("5h", primary_used, primary_reset, stats["last_5h"])
    print()
    print_quota("7d", secondary_used, secondary_reset, stats["last_7d"])

    print()
    print("Local tokens used")
    print("=" * 86)
    print_token_summary(stats)
    print()
    print(f"Log events   {fmt_int(stats['events'])} token events in {stats['files']} jsonl files")

    print_daily_chart(stats["daily"])

    if error_body and primary_used is None and secondary_used is None:
        print()
        print("Error:")
        print(str(error_body)[:800])

    print()


if __name__ == "__main__":
    main()