#!/usr/bin/env bash
# no-agent cron wrapper for "Pineapple Client Alerts".
# The configured monitor script prints findings only (silent when quiet), but can hang on SSH.
# Contract for Hermes no_agent mode: empty stdout => silent (no delivery); non-empty => delivered;
# non-zero exit => Hermes delivers a "watchdog failed" alert. So: pass findings through, always
# exit 0 on a normal/quiet run, and only fail (exit 1) on a genuine hang.
monitor_script="${PINEAPPLE_MONITOR_SCRIPT:-}"
if [ -z "$monitor_script" ] || [ ! -x "$monitor_script" ]; then
  echo "PINEAPPLE_MONITOR_SCRIPT must name an executable monitor script." >&2
  exit 2
fi
out="$(timeout 35s "$monitor_script" 2>/dev/null)"; rc=$?
if [ "$rc" -eq 124 ]; then
  echo "⚠ Pineapple monitor hung and was killed at 35s."
  exit 1
fi
printf '%s' "$out"
exit 0
