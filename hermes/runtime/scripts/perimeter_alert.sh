#!/usr/bin/env bash
# no-agent cron wrapper for "Perimeter Monitor".
# perimeter_monitor.sh ALWAYS prints something ("🛡️ PERIMETER ALERT …" on a real finding,
# "No new devices detected in this scan cycle." when quiet). For no_agent mode we must emit output
# ONLY on a real alert, else stay empty (silent). exit 0 normally; exit 1 only on a genuine hang.
out="$(timeout 90s /root/perimeter_monitor.sh 2>/dev/null)"; rc=$?
if [ "$rc" -eq 124 ]; then
  echo "⚠ perimeter_monitor.sh hung and was killed at 90s — perimeter scan may be stuck."
  exit 1
fi
case "$out" in
  *"PERIMETER ALERT"*) printf '%s' "$out" ;;   # real finding -> deliver
  *) : ;;                                        # "No new devices" -> silent
esac
exit 0
