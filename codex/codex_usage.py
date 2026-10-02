#!/usr/bin/env python3

import argparse
import datetime as dt
import glob
import hashlib
import json
import os
import math
import tempfile
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
    if reset_at is None:
        reset_at = first_value(window, "resets_at", "resetsAt")
    reset_at = reset_seconds(reset_at)
    if reset_at is not None:
        return used_percent, max(0, reset_at - int(time.time()))

    return used_percent, None


def window_seconds(window):
    seconds = first_value(
        window,
        "limit_window_seconds",
        "window_seconds",
        "windowSeconds",
    )
    seconds = as_int(seconds)
    if seconds is not None:
        return seconds

    minutes = first_value(window, "window_minutes", "windowMinutes")
    minutes = as_int(minutes)
    return minutes * 60 if minutes is not None else None


def window_label(seconds):
    if seconds is None:
        return None

    if seconds % 86400 == 0:
        return f"{seconds // 86400}d"
    if seconds % 3600 == 0:
        return f"{seconds // 3600}h"
    if seconds % 60 == 0:
        return f"{seconds // 60}m"
    return f"{seconds}s"


def parse_quota_payload(body, headers):
    header_quotas = {
        "5h": (
            as_float(get_header(headers, "x-codex-primary-used-percent")),
            as_int(
                get_header(headers, "x-codex-primary-reset-after-seconds")
            ),
        ),
        "7d": (
            as_float(get_header(headers, "x-codex-secondary-used-percent")),
            as_int(
                get_header(headers, "x-codex-secondary-reset-after-seconds")
            ),
        ),
    }

    try:
        payload = json.loads(body) if isinstance(body, str) else body
    except (TypeError, ValueError):
        return header_quotas

    if not isinstance(payload, dict):
        return header_quotas

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
        return header_quotas

    windows = (
        ("primary_window", "primaryWindow", "primary"),
        ("secondary_window", "secondaryWindow", "secondary"),
    )
    body_quotas = {}

    for index, keys in enumerate(windows):
        window = first_value(rate_limit, *keys)
        if not isinstance(window, dict):
            continue

        used, reset = parse_usage_window(window)
        label = window_label(window_seconds(window))
        if label is None:
            # Older responses did not expose the window length. Preserve the
            # historical primary=5h / secondary=7d mapping only as fallback.
            label = "5h" if index == 0 else "7d"

        body_quotas[label] = (used, reset)

    # A response body with windows is authoritative. In particular, a plan
    # may expose only one 7d window and set the other window to null.
    return body_quotas if body_quotas else header_quotas


def finite_number(value):
    if isinstance(value, bool):
        return None
    number = as_float(value)
    return number if number is not None and math.isfinite(number) else None


def positive_number(value):
    number = finite_number(value)
    if number is None or number <= 0:
        raise argparse.ArgumentTypeError("must be a finite number greater than zero")
    return number


def credit_reference(balance, account_id, cache_path):
    """Track the highest observed balance separately for each account."""
    if not account_id:
        return None
    key = hashlib.sha256(str(account_id).encode()).hexdigest()
    try:
        with open(cache_path, encoding="utf-8") as handle:
            saved = json.load(handle)
        if not isinstance(saved, dict):
            saved = {}
    except (OSError, ValueError):
        saved = {}
    previous = finite_number(saved.get(key))
    reference = max(balance, previous or 0)
    saved[key] = reference
    directory = os.path.dirname(os.path.abspath(cache_path))
    temporary = None
    try:
        os.makedirs(directory, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", dir=directory, delete=False) as handle:
            temporary = handle.name
            json.dump(saved, handle)
        os.replace(temporary, cache_path)
    except OSError:
        return None
    finally:
        if temporary and os.path.exists(temporary):
            os.unlink(temporary)
    return reference


def print_credits(body, total=None, cache_path=None):
    try:
        payload = json.loads(body) if isinstance(body, str) else body
    except (TypeError, ValueError):
        payload = None
    credits = payload.get("credits") if isinstance(payload, dict) else None
    if not isinstance(credits, dict):
        print("Credits   not provided by Codex API")
        return
    if credits.get("unlimited") is True:
        print("Credits   unlimited")
        return
    balance = finite_number(credits.get("balance"))
    if balance is None:
        if first_value(credits, "has_credits", "hasCredits") is False:
            balance = 0.0
        else:
            print("Credits   balance not provided by Codex API")
            return
    reference = total
    if reference is None:
        cache_path = cache_path or os.path.expanduser("~/.cache/codex-usage/credits.json")
        reference = credit_reference(max(0, balance), payload.get("account_id"), cache_path)
    if reference is not None and reference > 0:
        percent = max(0.0, min(100.0, (1 - balance / reference) * 100))
        print(f"Credits   {quota_bar(percent)}  {percent:5.1f}% used  |  {balance:,.2f} credits remaining")
    else:
        print(f"Credits   {balance:,.2f} credits remaining  |  percentage unavailable (no reference total)")


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
        print(f"{label:<9} not provided by Codex API")
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
    parser.add_argument("--credits-total", type=positive_number,
                        help="reference credit total for the used percentage")
    args = parser.parse_args()

    _status, headers, usage_body = fetch_codex_usage()
    quotas = parse_quota_payload(usage_body, headers)

    stats = local_token_stats(days=7)

    print()
    print("Codex quota")
    print("=" * 86)
    for label in ("5h", "7d"):
        used, reset = quotas.get(label, (None, None))
        print_quota(label, used, reset)

    for label, (used, reset) in quotas.items():
        if label not in {"5h", "7d"}:
            print_quota(label, used, reset)

    print()
    print("Codex credits")
    print("=" * 86)
    print_credits(usage_body, total=args.credits_total)

    print()
    print("Local tokens used")
    print("=" * 86)
    print_token_summary(stats)

    print_daily_chart(stats["daily"])

    if usage_body and all(used is None for used, _reset in quotas.values()):
        print()
        print("Error:")
        print(str(usage_body)[:800])

    print()


if __name__ == "__main__":
    main()
