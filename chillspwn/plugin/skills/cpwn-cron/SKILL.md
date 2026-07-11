---
name: cpwn-cron
description: Manage shared cron/scheduled jobs. View, create, and control monitoring jobs. Shared with Hermes gateway.
allowed-tools: [Bash, Read, Edit, Write]
---

# ChillsPwn Cron Management

Cron jobs are stored at `~/.hermes/cron/jobs.json` and executed by Hermes's gateway.

## Commands:
- `/cpwn:cron list` — Show all scheduled jobs with status and next run
- `/cpwn:cron create "<name>" --cron "<expr>" --prompt "<prompt>"` — Create a new job
- `/cpwn:cron pause <id>` — Pause a job
- `/cpwn:cron resume <id>` — Resume a paused job
- `/cpwn:cron delete <id>` — Remove a job
- `/cpwn:cron output <id>` — Show last output from a job

## View jobs:
```bash
cat ~/.hermes/cron/jobs.json | python3 -m json.tool
```

## Note:
Jobs are executed by **Hermes's gateway**, not by ChillsPwn directly. ChillsPwn manages the job definitions; Hermes runs them on schedule. This means jobs run even when ChillsPwn/Claude Code is not active.

## Existing jobs:
- Pineapple Client Alerts (every 5 min)
- Perimeter Monitor (every 10 min)
- perimeter_daily_summary (daily at 8am)
