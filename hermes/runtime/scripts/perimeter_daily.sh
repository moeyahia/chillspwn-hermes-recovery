#!/usr/bin/env bash
# no-agent cron wrapper for "perimeter_daily_summary".
# perimeter_daily_summary.sh always prints a summary; we deliver it ONLY when there were new
# devices in the last 24h, and suppress (stay silent) otherwise. exit 0 normally; exit 1 on a hang.
summary_script="${PERIMETER_DAILY_SCRIPT:-}"
if [ -z "$summary_script" ] || [ ! -x "$summary_script" ]; then
  echo "PERIMETER_DAILY_SCRIPT must name an executable summary script." >&2
  exit 2
fi
out="$(timeout 90s "$summary_script" 2>/dev/null)"; rc=$?
if [ "$rc" -eq 124 ]; then
  echo "⚠ Perimeter daily summary hung and was killed at 90s."
  exit 1
fi
case "$out" in
  *"No new devices detected in the last 24 hours"*) : ;;  # nothing new -> silent
  *) printf '%s' "$out" ;;                                 # has detections -> deliver summary
esac
exit 0
