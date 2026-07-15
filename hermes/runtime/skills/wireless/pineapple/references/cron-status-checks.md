# Pineapple Cron Status Checks

Use this workflow when the operator asks whether Pineapple monitoring is healthy.

## Verify

1. Confirm the scheduler entry is enabled and record its last/next run time.
2. Distinguish a successful silent run from a configuration or provider-authentication error.
3. Verify each configured script path is executable; never assume a path under a particular user's home directory.
4. Verify SSH host identity, SSH reachability, and PineAP daemon state through `PINEAPPLE_SSH_TARGET` and `PINEAPPLE_SSH_KEY`.
5. Run a bounded smoke test with the same protected environment used by the scheduler.

Required scheduler path variables:

- `PINEAPPLE_MONITOR_SCRIPT`
- `PINEAPPLE_DEFENSE_SCRIPT`
- `PERIMETER_MONITOR_SCRIPT`, when deployed
- `PERIMETER_DAILY_SCRIPT`, when deployed

An empty stdout stream with exit status `0` means no new event. Exit status `2` indicates missing or invalid configuration. A timeout or SSH failure is a real operational error and must not be reported as a quiet scan.

## Report

- job name and schedule;
- last and next run;
- last exit status;
- SSH/PineAP status;
- whether silence means no events or a blocker.

Do not add heartbeat delivery to recurring alert jobs unless explicitly requested.
