# Pineapple Cron Status Checks

Use this when Mr. Wong asks whether Pineapple monitoring jobs are running.

## What to verify

1. **Hermes cron job state**
   - `Pineapple Client Alerts` should be enabled, scheduled every 5 minutes, and normally silent unless real client/victim activity is found.
   - `Perimeter Monitor` should be enabled, scheduled every 10 minutes, and normally silent unless new devices/events are detected.
   - `perimeter_daily_summary` should be enabled, scheduled daily.

2. **Last run result**
   - `last_status=ok` means the job executed successfully.
   - `last_status=error` requires checking the recent cron session dump. A common actionable failure is provider auth invalidation, e.g. `token_invalidated`; the fix is provider re-auth, not a Pineapple/script failure.
   - If a job was recently failing, force/run or wait for the next scheduled run after auth/session recovery and re-check status before reporting final state.

3. **Scripts and Pineapple health**
   - Verify monitor scripts exist and are executable:
     - `/root/pineapple_monitor.sh`
     - `/root/perimeter_monitor.sh`
     - `/root/perimeter_daily_summary.sh`
   - Check Pineapple reachability via SSH and daemon status. SSH success + `pineapd running` is stronger than ICMP; the Pineapple may answer SSH even when ping reports failure.

4. **Manual smoke tests**
   - Run `/root/pineapple_monitor.sh` with an explicit timeout. Empty stdout with exit 0 means no new alert-worthy events.
   - Run `/root/perimeter_monitor.sh` with an explicit timeout. “No new devices detected” with exit 0 means the script is healthy and quiet.

## Reporting style

Return results, not commands. Keep it short:

- Job name
- Enabled/schedule
- Last run time/status
- Next run time
- Pineapple SSH/PineAP status
- Whether silence means “no events” or there is a real blocker

Do **not** add heartbeat output to recurring jobs unless Mr. Wong explicitly requests liveness pings.