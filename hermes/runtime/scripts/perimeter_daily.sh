#!/usr/bin/env bash
# no-agent cron wrapper for "perimeter_daily_summary".
# perimeter_daily_summary.sh always prints a summary; we deliver it ONLY when there were new
# devices in the last 24h, and suppress (stay silent) otherwise. exit 0 normally; exit 1 on a hang.
out="$(timeout 90s /root/perimeter_daily_summary.sh 2>/dev/null)"; rc=$?
if [ "$rc" -eq 124 ]; then
  echo "⚠ perimeter_daily_summary.sh hung and was killed at 90s."
  exit 1
fi
case "$out" in
  *"No new devices detected in the last 24 hours"*) : ;;  # nothing new -> silent
  *) printf '%s' "$out" ;;                                 # has detections -> deliver summary
esac
exit 0
