#!/usr/bin/env python3

import argparse
import datetime as dt
import glob
import json
import os
import time
import urllib.error
import urllib.request

AUTH_PATH = os.path.expanduser("~/.codex/auth.json")
SESSIONS_DIR = os.path.expanduser("~/.codex/sessions")
CODEX_USAGE_URLS = (
    "https://chatgpt.com/backend-api/wham/usage",
    "https://chatgpt.com/backend-api/api/codex/usage",
)


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


def quota_bar(percent, width=30):
    if percent is None:
        return "[" + "?" * width + "]"

    percent = max(0.0, min(100.0, float(percent)))
    filled = round(width * percent / 100.0)
    return "[" + "█" * filled + "░" * (width - filled) + "]"


def day_bar(value, max_value, width=30):
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


def first_value(mapping, *keys):
    if not isinstance(mapping, dict):
        return None

    for key in keys:
        if key in mapping and mapping[key] is not None:
            return mapping[key]

    return None


def reset_seconds(value):
    direct = as_int(value)
    if direct is None:
        return None

    # `reset_at` is an epoch timestamp, while `reset_after_seconds` is a
    # duration. The caller handles the two forms separately.
    return direct


def parse_usage_window(window):
    if not isinstance(window, dict):
        return None, None

    used_percent = as_float(first_value(window, "used_percent", "usedPercent"))

    reset_after = reset_seconds(
        first_value(window, "reset_after_seconds", "resetAfterSeconds")
    )
    if reset_after is not None:
        return used_percent, max(0, reset_after)

    reset_at = first_value(window, "reset_at", "resetAt")
    reset_at = reset_seconds(reset_at)
    if reset_at is not None:
        return used_percent, max(0, reset_at - int(time.time()))

    return used_percent, None


def parse_quota_payload(body, headers):
    primary_used = as_float(get_header(headers, "x-codex-primary-used-percent"))
    primary_reset = as_int(
        get_header(headers, "x-codex-primary-reset-after-seconds")
    )
    secondary_used = as_float(get_header(headers, "x-codex-secondary-used-percent"))
    secondary_reset = as_int(
        get_header(headers, "x-codex-secondary-reset-after-seconds")
    )

    try:
        payload = json.loads(body) if isinstance(body, str) else body
    except (TypeError, ValueError):
        return primary_used, primary_reset, secondary_used, secondary_reset

    if not isinstance(payload, dict):
        return primary_used, primary_reset, secondary_used, secondary_reset

    # Current Codex uses `rate_limit`; tolerate the camelCase and plural forms
    # used by older/proxy responses as well.
    rate_limit = first_value(
        payload,
        "rate_limit",
        "rateLimit",
        "rate_limits",
        "rateLimits",
    )
    if not isinstance(rate_limit, dict):
        return primary_used, primary_reset, secondary_used, secondary_reset

    primary_window = first_value(
        rate_limit, "primary_window", "primaryWindow", "primary"
    )
    secondary_window = first_value(
        rate_limit, "secondary_window", "secondaryWindow", "secondary"
    )

    body_primary_used, body_primary_reset = parse_usage_window(primary_window)
    body_secondary_used, body_secondary_reset = parse_usage_window(secondary_window)

    if body_primary_used is not None:
        primary_used = body_primary_used
    if body_primary_reset is not None:
        primary_reset = body_primary_reset
    if body_secondary_used is not None:
        secondary_used = body_secondary_used
    if body_secondary_reset is not None:
        secondary_reset = body_secondary_reset

    return primary_used, primary_reset, secondary_used, secondary_reset


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


def auth_headers(access_token, account_id):
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
        "User-Agent": "codex-cli",
    }

    if account_id:
        headers["ChatGPT-Account-Id"] = account_id

    return headers


def fetch_codex_usage():
    access_token, account_id = read_auth()
    last_error = None

    for url in CODEX_USAGE_URLS:
        request = urllib.request.Request(
            url,
            headers=auth_headers(access_token, account_id),
            method="GET",
        )

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read().decode("utf-8", errors="replace")
                return response.status, dict(response.headers), body

        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            last_error = f"GET {url} failed: HTTP {error.code}: {body[:500]}"

        except Exception as error:
            last_error = f"GET {url} failed: {error}"

    return "failed", {}, last_error


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


def print_quota(label, used_percent, reset_seconds):
    if used_percent is None:
        print(f"{label:<9} no quota data")
        return

    left_percent = max(0.0, 100.0 - used_percent)

    print(
        f"{label:<9} {quota_bar(used_percent)}  "
        f"{used_percent:5.1f}% used  |  {left_percent:5.1f}% left  |  reset in {fmt_duration(reset_seconds)}"
    )


def print_token_summary(stats):
    last_7d = stats["last_7d"]

    today_share = (stats["today"] / last_7d * 100.0) if last_7d > 0 else 0.0
    last_5h_share = (stats["last_5h"] / last_7d * 100.0) if last_7d > 0 else 0.0

    print(f"Today              {fmt_int(stats['today'])} tokens  ({today_share:.1f}% of local 7d usage)")
    print(f"Last 5h            {fmt_int(stats['last_5h'])} tokens  ({last_5h_share:.1f}% of local 7d usage)")
    print(f"Last 7d            {fmt_int(stats['last_7d'])} tokens")
    print(f"All local logged   {fmt_int(stats['all_time'])} tokens")


def print_daily_chart(daily):
    print()
    print("Last 7 days")
    print("=" * 86)

    max_value = max(daily.values()) if daily else 0

    for date_key, tokens in daily.items():
        print(
            f"{date_key.strftime('%a')} {date_key.strftime('%Y-%m-%d')}  "
            f"{day_bar(tokens, max_value)}  {fmt_int(tokens)}"
        )


def main():
    parser = argparse.ArgumentParser()
    args = parser.parse_args()

    _status, headers, usage_body = fetch_codex_usage()
    primary_used, primary_reset, secondary_used, secondary_reset = parse_quota_payload(
        usage_body, headers
    )

    stats = local_token_stats(days=7)

    print()
    print("Codex quota")
    print("=" * 86)
    print_quota("5h", primary_used, primary_reset)
    print_quota("7d", secondary_used, secondary_reset)

    print()
    print("Local tokens used")
    print("=" * 86)
    print_token_summary(stats)

    print_daily_chart(stats["daily"])

    if usage_body and primary_used is None and secondary_used is None:
        print()
        print("Error:")
        print(str(usage_body)[:800])

    print()


if __name__ == "__main__":
    main()
