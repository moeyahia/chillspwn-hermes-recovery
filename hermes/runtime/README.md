# Hermes runtime snapshot

This directory contains only recovery-safe, reusable runtime configuration:

- the active Chillspwn `SOUL.md`
- installed skills without curator/archive/cache data
- active helper scripts without logs and backups
- the current cron definition

`config.yaml`, `.env`, `auth.json`, memories, conversations, databases, sessions, logs, channel pairing state, and OAuth stores are excluded because they contain credentials, target data, or private history. Recreate provider configuration and authentication after restore.
