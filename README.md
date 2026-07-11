# Chillspwn + Hermes recovery snapshot

This private repository is a disaster-recovery snapshot of the deployed Chillspwn application and its Hermes Agent integration, captured on **2026-07-11 (UTC)**.

It preserves the current working source, including changes that had not yet been committed in the original Chillspwn checkout. It is intentionally a clean snapshot rather than a copy of the original Git histories, which keeps old test secrets and unrelated engagement artifacts out of the recovery repository.

## What is backed up

- `chillspwn/plugin/` — the complete Claude plugin and current tracked web application source
- `chillspwn/plugin/webapp/android/` — recoverable Android/Capacitor project source that was ignored by the original webapp repository
- `chillspwn/runtime/personas/` and `skill-config.json` — active personas and skill routing
- `chillspwn/report-template/` — reporting code, templates, and brand assets required by dashboard report generation
- `hermes/source/` — Hermes Agent v0.14.0 source, including the deployed local changes and custom CVE researcher skill
- `hermes/runtime/SOUL.md`, `skills/`, `scripts/`, and `cron-jobs.json` — active behavior and reusable runtime configuration
- `deployment/systemd/` — the deployed dashboard unit and Grok environment drop-in
- `scripts/restore.sh` — restoration helper for a fresh server
- `scripts/verify-snapshot.sh` — local safety and completeness checks

The Grok ACP implementation is present in the snapshot. It launches Grok through ACP using the cached CLI OAuth session, removes `XAI_API_KEY` from the child environment, and sets `--reasoning-effort high`, which is the Grok CLI's Expert thinking mode.

## Deliberate exclusions

This is a **recoverable application backup**, not a plaintext credential or engagement-data dump. The following are not committed:

- OAuth stores, API keys, `.env` files, `auth.json`, private keys, certificates, and credential caches
- Hermes/Chillspwn databases, conversations, memories, session transcripts, logs, and council/runtime state
- HTB and client engagement directories, loot, exploit artifacts, OSINT results, and pentest write-ups
- `node_modules`, virtual environments, build products, caches, and downloaded binaries

Those files contain live access material or client data and must never be pushed to GitHub in plaintext, even to a private repository. After recovery, authenticate Claude, Codex, Grok, and MCP integrations again and restore operational data only from a separately encrypted backup.

## Quick recovery

On a clean Linux server with Python 3.11+, `rsync`, Bun, and the required AI CLIs installed:

```bash
git clone git@github.com:moeyahia/chillspwn-hermes-recovery.git
cd chillspwn-hermes-recovery
sudo ./scripts/restore.sh --install-deps --enable-service
```

Then recreate `/root/.hermes/.env`, authenticate each OAuth-backed CLI, and run the verification steps in [RECOVERY.md](RECOVERY.md).

See [SOURCE-MANIFEST.md](SOURCE-MANIFEST.md) for snapshot provenance and [SECURITY.md](SECURITY.md) for the backup boundary.
