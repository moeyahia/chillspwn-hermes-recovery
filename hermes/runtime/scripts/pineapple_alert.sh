#!/usr/bin/env bash
# no-agent cron wrapper for "Pineapple Client Alerts".
# pineapple_monitor.sh prints findings only (silent when quiet), but can hang on SSH.
# Contract for Hermes no_agent mode: empty stdout => silent (no delivery); non-empty => delivered;
# non-zero exit => Hermes delivers a "watchdog failed" alert. So: pass findings through, always
# exit 0 on a normal/quiet run, and only fail (exit 1) on a genuine hang.
out="$(timeout 35s /root/pineapple_monitor.sh 2>/dev/null)"; rc=$?
if [ "$rc" -eq 124 ]; then
  echo "⚠ pineapple_monitor.sh hung and was killed at 35s — Pineapple monitor may be stuck."
  exit 1
fi
printf '%s' "$out"
exit 0
