# Recovery runbook

## 1. Prepare the server

Install the base tools required by the restore helper:

```bash
sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip rsync acl curl git
```

Install Bun and the Claude, Codex, and Grok CLIs using their current official instructions. The snapshot does not vendor executable downloads or authentication stores.

## 2. Restore source and safe runtime configuration

Clone this private repository and run:

```bash
sudo ./scripts/restore.sh --install-deps
```

The helper restores the expected production paths:

- `/opt/chillspwn/hermes-agent`
- `/root/hermes-venv`
- `/root/.claude/plugins/chillspwn`
- `/root/.claude/chillspwn/personas`
- `/root/.hermes/SOUL.md`, skills, scripts, and cron definitions
- `/root/report-template`

It refuses to overwrite an existing installation unless `--force` is supplied. On an already configured server, inspect the destination first and use:

```bash
sudo ./scripts/restore.sh --install-deps --force
```

## 3. Restore secrets and authentication

Create `/root/.hermes/.env` manually from your password manager or encrypted offline backup. Do not copy credentials from this repository; they are intentionally absent.

Re-authenticate each subscription-backed CLI on the recovery host:

- Claude Code
- OpenAI Codex
- Grok CLI
- any OAuth MCP servers, including Higgsfield

For Grok, authenticate the installed CLI interactively and confirm that `/root/.grok` is readable by the `chillspwn` service account. The restore helper prepares the ACL if that directory already exists. The application uses `GROK_HOME=/root/.grok`, ACP stdio, and Expert/high reasoning. It explicitly removes `XAI_API_KEY` before spawning Grok so this route uses the CLI OAuth session rather than API credits.

Hermes provider configuration is regenerated with the installed Hermes CLI because the live `config.yaml` can contain provider secrets and is excluded from Git:

```bash
/root/hermes-venv/bin/hermes model
/root/hermes-venv/bin/hermes tools
```

## 4. Enable the dashboard

After dependencies and authentication are ready:

```bash
sudo ./scripts/restore.sh --force --enable-service
sudo systemctl status chillspwn.service --no-pager
```

The service listens according to the application configuration. Recreate any SSH port forwarding separately; tunnel-only keys and `authorized_keys` restrictions are host security configuration and are not stored here.

## 5. Validate the recovered application

Run source checks:

```bash
./scripts/verify-snapshot.sh
cd /root/.claude/plugins/chillspwn/webapp
/root/.bun/bin/bun run typecheck
/root/.bun/bin/bun test ./server ./src/lib
```

Then validate the live integrations:

1. Open the dashboard and confirm personas, Soul, skills, Kanban, chat, and report generation load.
2. Send one short request through Claude, Codex, OpenRouter, Gemini (if configured), and Grok ACP.
3. For Grok, confirm the provider label is `xai-grok`, tool events appear, and the spawned command uses `--reasoning-effort high`.
4. Confirm no `XAI_API_KEY` is present in the Grok child environment or raw provider log metadata.

## Operational data

Kanban state, memories, conversations, sessions, and engagement evidence are data backups, not application source. Recover them only from a consistent, client-side encrypted archive. SQLite databases should be captured with SQLite's online backup command or while the service is stopped; copying live database/WAL files independently can produce an inconsistent restore.
