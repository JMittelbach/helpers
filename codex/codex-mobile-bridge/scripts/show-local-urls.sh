#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-4173}"

printf 'Local access URLs for port %s\n\n' "$PORT"

if command -v scutil >/dev/null 2>&1; then
  if mac_name="$(scutil --get LocalHostName 2>/dev/null)"; then
    if [ -n "$mac_name" ]; then
      printf 'Hostname URL: http://%s.local:%s\n' "$mac_name" "$PORT"
    fi
  fi
fi

if command -v networksetup >/dev/null 2>&1 && command -v ipconfig >/dev/null 2>&1; then
  current_port=""
  current_device=""
  found_ip="0"

  while IFS= read -r line; do
    case "$line" in
      Hardware\ Port:*)
        current_port="${line#Hardware Port: }"
        ;;
      Device:*)
        current_device="${line#Device: }"
        if [ -n "$current_device" ]; then
          if ip="$(ipconfig getifaddr "$current_device" 2>/dev/null)"; then
            if [ -n "$ip" ]; then
              found_ip="1"
              printf '%s (%s): http://%s:%s\n' "$current_port" "$current_device" "$ip" "$PORT"
            fi
          fi
        fi
        ;;
    esac
  done < <(networksetup -listallhardwareports)

  if [ "$found_ip" = "0" ]; then
    if command -v ifconfig >/dev/null 2>&1; then
      while IFS= read -r ip; do
        [ -z "$ip" ] && continue
        printf 'Interface IPv4: http://%s:%s\n' "$ip" "$PORT"
      done < <(
        ifconfig \
          | awk '/inet / {print $2}' \
          | grep -Ev '^(127\.|169\.254\.)' \
          | sort -u
      )
    fi
  fi
else
  printf 'Could not read interfaces via networksetup/ipconfig.\n'
fi
