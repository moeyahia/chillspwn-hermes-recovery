# Recovery runbook

## 1. Prepare the server

Install the base tools required by the restore helper:

```bash
sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip rsync acl curl git sqlite3 weasyprint
```

Install `uv` **0.11.15**, Bun **1.3.14**, and the Claude, Codex, and Grok CLIs using their official
distribution channels. The restore fails closed on other uv/Bun versions; the snapshot does not
vendor executable downloads or authentication stores. Verify the pinned tools before continuing:

```bash
uv --version   # uv 0.11.15 ...
bun --version  # 1.3.14
```

## 2. Restore source and safe runtime configuration

Clone this private repository and run:

```bash
sudo ./scripts/restore.sh --install-deps
```

The helper restores the expected production paths:

- `/opt/chillspwn/hermes-agent`
- `/root/hermes-venv`
- `/opt/chillspwn/plugin`
- `/root/.hermes/chillspwn` for ChillsPwn personas, sessions, logs, and mutable runtime state
- `/opt/chillspwn/bin/grok` as the immutable, root-owned Grok executable
- `/root/.hermes/SOUL.md`, skills, scripts, and cron definitions
- `/root/.hermes/kanban.db` as a fresh, service-owned Mission Board schema when absent
- `/root/htb/boxes` and `/root/engagements` as empty/default operational workspace roots when absent
- `/root/report-template`

It refuses every source/configuration collision unless `--force` is supplied. A forced restore also requires `--install-deps`, so the retained lockfile, staged Hermes runtime, and web build are revalidated before any prior service is restarted. On an already configured server, inspect the destination first and use:

```bash
sudo ./scripts/restore.sh --install-deps --force
```

The recovery service runs as the unprivileged `chillspwn` account but explicitly sets `HOME=/root` because provider contracts resolve isolated state below `/root/.hermes`. Reviewed plugin/application code is deployed under `/opt/chillspwn/plugin`, mutable ChillsPwn state lives under `/root/.hermes/chillspwn`, and the service never needs to create, list, or traverse the legacy `/root/.claude` plugin tree.

Dependency installation uses the lockfile's curated `all` extra (`uv sync --locked --extra all`). Before the staged virtualenv replaces `/root/hermes-venv`, its read/execute modes are normalized and the `chillspwn` identity must successfully run its Python interpreter and import the canonical Kanban module. Both systemd units receive the same pinned `HERMES_PYTHON=/root/hermes-venv/bin/python`; the OpenRouter/Codex/Gemini orchestrator and council launcher do not fall back to the system Python.

When `--install-deps`, `--enable-service`, or `--force` is selected, the helper invokes Hermes's canonical Kanban initializer through that pinned interpreter as the actual `chillspwn` service identity. It then applies only ChillsPwn's additive board schema, runs SQLite integrity and create/read/update/delete checks inside a transaction, and rolls that transaction back. No smoke-test card or board column is retained. A fresh database is owned by `chillspwn:chillspwn` with mode `0600`; unsafe symlinks, hard links, file types, ownership, or inaccessible runtime state stop recovery before service enablement. Hermes scripts and reviewed skill children remain root-owned. The sticky `root:chillspwn` skills root preserves service-created learned skills and mutable usage/curator sidecars across restores; a disposable create/update/delete smoke proves that contract and restores the sidecar bytes exactly. `/root/.hermes/state`, `/root/.hermes/logs`, and `/root/.hermes/chillspwn/runtime` are service-owned and explicitly checked for write access.

Reusable memory is a separate privilege boundary. `/root/.hermes/memories` and every retained child are normalized to `root:root` mode `0700`/`0600`; the dashboard and gateway identity can neither traverse, read, nor write them directly. Both services use the root-owned client with `CHILLSPWN_MEMORY_GUARD=required` and reach `/run/chillspwn-memory/broker.sock`. The hardened root broker accepts only validated `add` and policy-filtered `safe-read` requests; arbitrary paths, replacement, deletion, restoration, and curator operations are not exposed to the service account. This prevents a specialist terminal from bypassing the memory validator with ordinary file commands.

`ALLOWED_WORKSPACE_ROOTS` is the application-wide ordered workspace allowlist for file browsing/writes, engagement APIs and working directories, interactive Claude `--add-dir` access, and OSINT output. Its secure defaults are `/root/htb/boxes` and `/root/engagements`. Recovery creates those two root-owned directories without deleting existing operational data, grants `chillspwn` narrow directory/default ACLs, and verifies write access. It does not parse the private environment file to create custom roots. Any custom root must be created before service enablement as a real non-symlink directory with read/write/traverse access for `chillspwn`; never add `/root`, provider-auth state, protected reusable memory, reviewed code, or the repository checkout.

The optional MCP arsenal follows the same code/state separation. When `/opt/chillspwn-mcp-arsenal` exists, recovery makes the vendor tree and `.mcp.arsenal.json` root-owned and non-writable by the service, validates the deployed root-owned manifest, and rejects enabled entries whose command or working directory does not resolve through root-controlled paths. Only `/root/.hermes/chillspwn/mcp-runtime` is service-writable. Configure profiles through the reviewed setup script with `sudo`; never transfer ownership of the vendor tree to `chillspwn`.

### Forced restore safety and rollback

Before any restore mutates the filesystem, it captures the load/active/enabled state of `chillspwn-memory.service`, `chillspwn.service`, and `hermes-gateway.service`, stops active writers, and waits for them to become inactive. If `/root/.hermes/kanban.db` exists, the helper always creates a local mode-`0700` recovery directory, uses SQLite's online backup operation, and validates the resulting database and SHA-256 before any bootstrap or migration. A forced restore also backs up the source-owned destinations. The recovery directory contains:

- `service-state.tsv` — the pre-restore unit states;
- `operational-state/kanban.db` — the consistent pre-migration database backup; and
- `operational-state/kanban.db.sha256` — its checksum.

A forced restore also preserves the private Grok OAuth directory in the local rollback tree when it exists. That local backup is mode `0700`, is never added to Git, and must be handled as a live credential.

The helper prints the dated recovery directory. It does not add that directory to Git. Without `--enable-service`, it restarts only units that were running beforehand and leaves their enabled/disabled settings untouched; systemd starts the memory broker whenever a restored dashboard or gateway requires it. The explicit `--enable-service` option intentionally enables and starts all three units. A forced restore installs the reviewed unit definitions but does not change enablement unless that explicit flag is present. Services start only after dependency, schema, integrity, permission, executable, and memory-boundary checks pass. If recovery fails after quiescing, the writers remain stopped and the error points to the recovery directory.

To roll back, keep all three units stopped, verify `operational-state/kanban.db` against its checksum and `PRAGMA quick_check`, restore the source/configuration paths from the same dated backup, replace the live database from the validated backup without carrying over stale `-wal` or `-shm` files, restore owner `chillspwn:chillspwn` and mode `0600`, and then reapply the states recorded in `service-state.tsv`. Preserve the failed state separately until rollback has been validated; do not copy a live database or its sidecars while either application writer is running.

## 3. Restore secrets and authentication

The restore copies the sanitized reference file to `/root/.hermes/runtime.env.example`; systemd does not load that example. Create `/root/.hermes/.env` manually from your password manager or encrypted offline backup. Do not copy credentials from this repository; they are intentionally absent. Recovery clears any extended ACL, sets the live file to `root:root` mode `0600`, and proves that `chillspwn` cannot read or write it. The systemd manager reads this file before applying `User=chillspwn`; the server consumes selected values only from its inherited process environment and never reopens the file.

If an older deployment still has `/opt/chillspwn/plugin/webapp/.env`, recovery protects it with the same root-only contract. Both service units load that optional legacy file first and the canonical `/root/.hermes/.env` second, so canonical values take precedence. Move maintained settings into the canonical file, then remove the legacy file during a separately reviewed cleanup. Verify modes and the runtime denial without displaying contents:

```bash
sudo chown root:root /root/.hermes/.env
sudo chmod 0600 /root/.hermes/.env
sudo setfacl -b /root/.hermes/.env
stat -c '%U %G %a %n' /root/.hermes/.env
sudo -u chillspwn test ! -r /root/.hermes/.env
sudo -u chillspwn test ! -w /root/.hermes/.env
```

Do not grant the service account a read ACL for either environment file. Direct provider subprocesses and individual Council lanes are constructed from explicit provider-aware allowlists, reducing accidental cross-provider inheritance. The multi-provider Council launcher still receives the inputs required to create its configured lanes. This is defense in depth, not process isolation: the dashboard and provider children share the `chillspwn` UID, so a compromised child may still be able to inspect same-UID process state (including `/proc` where host policy permits it) or access service-readable OAuth stores. Strong mutual isolation requires separate service identities and a credential broker; the recovery snapshot does not claim that boundary.

Re-authenticate each subscription-backed CLI on the recovery host:

- Claude Code
- OpenAI Codex
- Grok CLI
- any OAuth MCP servers, including Higgsfield

Claude and Codex use service-owned credential roots that are separate from the root-owned plugin
and boundary code:

```bash
sudo -u chillspwn env HOME=/root CLAUDE_CONFIG_DIR=/root/.hermes/auth/claude \
  claude auth login
sudo -u chillspwn env HOME=/root CODEX_HOME=/root/.hermes/auth/codex \
  codex login --device-auth
```

The restore copies the installed Grok executable into the immutable root-owned path `/opt/chillspwn/bin/grok`. The service launches only that absolute path; it does not resolve `grok` through `PATH` or execute the installer-managed binary below `/root/.grok`. For Grok, authenticate **as the `chillspwn` service identity** so OAuth refresh can safely replace its own credential file:

```bash
sudo -u chillspwn env HOME=/root \
  GROK_HOME=/root/.hermes/chillspwn/grok \
  GROK_AUTH_PATH=/root/.hermes/auth/grok/auth.json \
  /opt/chillspwn/bin/grok login --oauth --device-auth
sudo -u chillspwn env HOME=/root \
  GROK_HOME=/root/.hermes/chillspwn/grok \
  GROK_AUTH_PATH=/root/.hermes/auth/grok/auth.json \
  /opt/chillspwn/bin/grok models
```

The refreshable OAuth directory is service-owned with mode `0700`; `auth.json`, when present, is service-owned with mode `0600`. On first migration only, a regular legacy `/root/.grok/auth.json` is copied into the new private directory without deleting the original. The legacy installer tree is then made root-only and is not used by systemd. Verify ownership and modes without reading the credential, and verify that neither the executable nor its parent is service-writable:

```bash
stat -c '%U %G %a %n' \
  /opt/chillspwn/bin /opt/chillspwn/bin/grok \
  /root/.hermes/auth/grok /root/.hermes/auth/grok/auth.json
sudo -u chillspwn test ! -w /opt/chillspwn/bin
sudo -u chillspwn test ! -w /opt/chillspwn/bin/grok
```

Do not grant recursive or read-only named-user ACLs to the OAuth tree: their POSIX mask bits violate the fail-closed validator, and read-only access cannot refresh OAuth atomically. The application resolves the refreshable OAuth file without reading it, passes its path into an isolated commander home, launches the reviewed absolute Grok executable over ACP stdio with Expert/high reasoning, and removes `XAI_API_KEY` from every Grok child environment. The ChillsPwn commander additionally uses a controlled profile, Soul, MCP allowlist, pre-tool guard, and fail-closed startup attestation; specialists retain their scoped execution role.

Hermes provider configuration is regenerated with the installed Hermes CLI and is excluded from Git. Keep provider secrets in the protected systemd environment or a narrowly scoped OAuth store; do not embed them in `config.yaml`. Recovery and both unit startup paths run the root-owned validator, which rejects literal values under credential fields, duplicate YAML keys, URL-embedded credentials, and high-confidence credential patterns without printing the values. Environment references such as `${OPENROUTER_API_KEY}` are allowed:

```bash
/root/hermes-venv/bin/hermes model
/root/hermes-venv/bin/hermes tools
/root/hermes-venv/bin/python /opt/chillspwn/libexec/validate-hermes-config.py \
  /root/.hermes/config.yaml
```

The validator is intentionally conservative but cannot prove that arbitrary free-form commands, prompts, or opaque plugin configuration contain no disguised credential. Review `config.yaml` manually after provider/tool changes and keep secret scanning in the operational workflow.

## 4. Enable the dashboard

After dependencies and authentication are ready:

```bash
sudo ./scripts/restore.sh --force --install-deps --enable-service
sudo systemctl status chillspwn-memory.service chillspwn.service hermes-gateway.service --no-pager
```

The service listens according to the application configuration. Recreate any SSH port forwarding separately; tunnel-only keys and `authorized_keys` restrictions are host security configuration and are not stored here.

## 5. Validate the recovered application

Run source checks:

```bash
./scripts/verify-snapshot.sh
cd /opt/chillspwn/plugin/webapp
/root/.bun/bin/bun run check:server-entry
/root/.bun/bin/bun run typecheck
/root/.bun/bin/bun run typecheck:client
/root/.bun/bin/bun test ./server ./src/lib
python3 integration/test_or_gate_client.py
python3 integration/test_board_mcp_server.py
/root/.bun/bin/bun run build
```

Then validate the live integrations:

1. Open the dashboard and confirm personas, Soul, skills, Kanban, chat, and report generation load.
2. Send one short request through Claude, Codex, OpenRouter, Gemini (if configured), and Grok ACP.
3. For Grok, confirm the provider label is `xai-grok`, the commander boundary attestation event appears, and the process uses `--reasoning-effort high`.
4. Confirm the commander can list, create, update, and await Mission Board tasks while native execution and unapproved MCP tools are denied.
5. Confirm a named specialist can execute its delegated task and that terminal completion closes the associated process tree and session.
6. Confirm no `XAI_API_KEY` is present in the Grok child environment or raw provider log metadata.

## 6. Rebuild Android assets when needed

The native Capacitor project is retained, but generated web assets are excluded because the earlier snapshot contained deployment-specific output. Regenerate them only from the reviewed local build:

```bash
cd /opt/chillspwn/plugin/webapp
/root/.bun/bin/bun run build
/root/.bun/bin/bunx cap sync android
```

Do not copy generated assets back into the recovery repository.

## Operational data

Kanban records, memories, conversations, sessions, and engagement evidence are data backups, not application source. On a clean host, the restore helper creates only an empty canonical Kanban schema and never sources cards or history from Git. During an explicit forced in-place recovery, it preserves the existing board in place only after taking the local consistent backup described above. Recover other operational state only from a consistent, client-side encrypted archive. Copying live database/WAL files independently can produce an inconsistent restore.
