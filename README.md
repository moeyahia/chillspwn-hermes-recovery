# ChillsPwn + Hermes Recovery

Private disaster-recovery and maintenance repository for the ChillsPwn operator dashboard, its Hermes Agent integration, safe runtime configuration, and restoration tooling.

> **Status:** private recovery snapshot under validation, application pre-release, and environment-coupled. The Hermes snapshot was captured on 2026-07-11; the maintained ChillsPwn application source was refreshed on 2026-07-15. Portable checks run from this repository, while a clean-host restore rehearsal, separately installed provider CLIs, authenticated OAuth sessions, and host security tooling remain deployment responsibilities.

Keep this repository **private**. Use ChillsPwn only on systems and targets you are authorized to test.

## What this repository preserves

- ChillsPwn Command OS V2.1: its React shell, Bun/Express backend, two-journey mission runtime, specialist orchestration, evidence, reports, and observability.
- Claude, OpenRouter, Codex, Gemini, and OAuth-backed Grok ACP integration source.
- OAuth-backed Grok ACP Expert mode, commander Soul, planning-only boundary, specialist delegation, tool policy, runtime isolation, and fail-closed attestation.
- Canonical SQLite mission/event/evidence state plus the user-owned Second Brain and optional Obsidian-compatible vault bridge.
- Hermes Agent 0.14.0 source plus selected deployed runtime skills and configuration.
- Android/Capacitor native project source; generated web assets are intentionally excluded and recreated during a mobile build.
- Hardened systemd deployment material, a manual V2 recovery runbook, and a
  fail-closed legacy restore helper retained for migration history.

The repository is a curated snapshot, not a copy of either original Git history. See [SOURCE-MANIFEST.md](SOURCE-MANIFEST.md) for provenance.

## Screenshot or demo

A screenshot is intentionally omitted until a capture can be proven free of engagement names, targets, logs, infrastructure details, and personal information. Do not use production screenshots in issues or pull requests.

## Technology stack

| Area | Technology |
|---|---|
| ChillsPwn runtime | Bun 1.3.14, TypeScript, Express 4, WebSockets |
| Client | React 19, Vite 6, Tailwind CSS 4, xterm.js |
| State | Command OS SQLite/WAL canonical database plus a temporary legacy Hermes/file-state compatibility layer |
| Mobile | Capacitor 8 and Android native project source |
| Hermes | Python 3.11+, Hermes Agent 0.14.0 |
| Tests | Bun test runner, TypeScript checks, portable Python integration checks |
| Deployment | Linux systemd services and SSH-tunnel-friendly loopback binding |

Application architecture, data flow, contracts, configuration, and operations are documented under [Command OS V2.1 docs](chillspwn/plugin/webapp/docs/command-os-v2/current-state-audit.md).

## Prerequisites

For portable ChillsPwn development and validation:

- Git and `rsync`
- Bun 1.3.14
- Node.js 22 or newer for the Vite/Capacitor toolchain
- Python 3.11 or newer

A full restored host additionally needs Linux, systemd, ACL support, the approved security tools, and the Claude, Codex, Grok, and any other enabled provider CLIs. Authentication stores are never included.

## Install for local development

```bash
git clone git@github.com:moeyahia/chillspwn-hermes-recovery.git
cd chillspwn-hermes-recovery/chillspwn/plugin/webapp
bun install --frozen-lockfile
cp .env.example .env
bun run dev
```

Open `http://127.0.0.1:3132`. Vite proxies API and WebSocket traffic to the backend on port 3131. Review every environment value before enabling a risky capability; secure defaults keep terminal, proxy, file-write, security-tool, and MCP execution gates disabled.

The sanitized [.env.example](chillspwn/plugin/webapp/.env.example) documents dashboard defaults. Optional MCP variable names are in [.env.mcp.example](chillspwn/plugin/webapp/.env.mcp.example). Real `.env` files are ignored at both repository and application scope.

`ALLOWED_WORKSPACE_ROOTS` is shared by the file browser, engagement APIs and working directories, interactive Claude workspace access, and OSINT output. Production uses `/var/lib/chillspwn/workspaces/htb/boxes` and `/var/lib/chillspwn/workspaces/engagements`; tracked systemd mount units bind the existing operator data into those paths. Pre-create and review any additional root before enabling the services.

## Build, test, and code-quality checks

From `chillspwn/plugin/webapp`:

```bash
bun run check:server-entry
bun run typecheck
bun run typecheck:client
bun run typecheck:e2e
bun test ./server ./src/lib
python3 integration/test_or_gate_client.py
python3 integration/test_board_mcp_server.py
bun run build
bun run test:e2e:run
bun audit
```

Or run the portable application sequence with:

```bash
bun run check
```

`bun run check` first parses and bundles the production `server/index.ts` entry, then runs the modular server and client typechecks, both portable Python regressions, the Bun tests, and the production client build. The entry-point bundle check is required because the legacy composition root is not yet part of the strict server TypeScript project.

From the repository root on a restored host, validate the recovery boundary and retained Hermes entry points with the pinned interpreter (CI performs the same checks with its configured Python 3.11 environment):

```bash
./scripts/verify-snapshot.sh
bash -n scripts/restore.sh scripts/verify-snapshot.sh
/opt/chillspwn-runtime/hermes-venv/bin/python -m unittest \
  hermes.runtime.tests.test_chillspwn_learning_pipeline \
  hermes.runtime.tests.test_validate_hermes_config
/opt/chillspwn-runtime/hermes-venv/bin/python -m compileall -q \
  hermes/source/agent \
  hermes/source/acp_adapter \
  hermes/source/hermes_cli \
  hermes/source/run_agent.py \
  hermes/source/tools/memory_tool.py \
  hermes/runtime/scripts/chillspwn_learn_cron.py \
  hermes/runtime/skills/red-teaming/council-of-ais/scripts
git diff --check
```

There is no repository-wide formatter or linter baseline yet. `.editorconfig`, `.gitattributes`, TypeScript checking, test suites, and `git diff --check` provide the current code-quality gate. Introduce a formatter or linter separately to avoid obscuring functional changes.

## Production recovery

The supported V2.1 recovery is the reviewed two-service `/opt` plus
`/var/lib/chillspwn` procedure in [RECOVERY.md](RECOVERY.md). It stages an
immutable root-controlled release and runtimes, restores service-owned state,
installs the two tracked workspace bind mounts, performs backup-first database
migration/reconciliation, and starts `hermes-gateway.service` and
`chillspwn.service` as an unprivileged identity.

The earlier `scripts/restore.sh` targets the legacy three-service
`/root/.hermes` layout and is retained for historical validation only. Do not
use it to deploy Command OS V2.1 until that helper is separately rewritten and
rehearsed for the hardened host contract.

For Android packaging, build the sanitized web client and regenerate Capacitor assets locally:

```bash
cd chillspwn/plugin/webapp
bun run build
bunx cap sync android
```

Do not commit the generated `android/app/src/main/assets` output.

## Usage and API documentation

After a secure local start:

1. Verify provider, MCP, authorization, and Second Brain readiness.
2. Choose **Go Autonomous** or **Start Guided Mission**; no provider-specific third journey is exposed.
3. Define the exact authorized target and constraints. Autonomous additionally requires a complete signed mission contract.
4. Observe specialist ownership, decisions, checkpoints, evidence, recovery, evaluation, and proposed lessons.
5. Export a verified database backup and, when enabled, an Obsidian-compatible knowledge projection. Keep secrets and engagement evidence outside Git.

The dashboard HTTP surface is an internal UI contract, not a versioned public API. See the [API overview](chillspwn/plugin/webapp/docs/api.md), [integration contracts](chillspwn/plugin/webapp/docs/integrations.md), and [operations guide](chillspwn/plugin/webapp/docs/operations.md).

## Repository structure

```text
chillspwn/
  plugin/             Claude plugin and ChillsPwn web application source
  runtime/            sanitized personas and skill routing
  report-template/    report generation code and brand assets
hermes/
  source/             Hermes Agent source snapshot
  runtime/            selected Soul, skills, scripts, and cron definitions
deployment/systemd/   deployed service definitions
scripts/              snapshot verifier and legacy guarded restore helper
.github/               CI, issue forms, PR template, and dependency updates
```

Credentials, provider auth stores, databases, sessions, conversations, memories, logs, engagement data, dependencies, generated builds, and downloaded binaries are deliberately excluded.

## Troubleshooting

### No personas are available

Set `CHILLSPWN_PERSONAS_DIR` to the restored persona directory. The integrated units use `/opt/chillspwn/plugin/webapp/server/agents/personas`; local development may use a checkout-relative path. The repository includes sanitized source definitions, but it does not include provider authentication or live session state.

### A provider does not start

Confirm its CLI is installed and authenticated as the service account. Keep refreshable OAuth state narrowly service-owned, and keep API-secret environment files root-owned and unreadable by the service after startup; never solve access errors with group/world-readable files. Grok ACP uses the CLI's refreshable OAuth state through `GROK_AUTH_PATH`, not xAI API credits.

### The exposed server refuses to start

This is fail-closed behavior. Keep `CHILLSPWN_BIND=127.0.0.1` for local or tunneled access, or configure a strong `DASHBOARD_TOKEN` before binding to a non-loopback address.

### Command OS or legacy Board state is unavailable

Operational databases are intentionally absent from Git. Restore only from a verified encrypted backup. For the canonical V2.1 database follow [migration](chillspwn/plugin/webapp/docs/command-os-v2/migration.md) and [rollback](chillspwn/plugin/webapp/docs/command-os-v2/rollback.md); retained legacy Board guidance remains in [data and migrations](chillspwn/plugin/webapp/docs/data-and-migrations.md).

### Recovery finds an existing release or state tree

Stop and inventory it. Create checksummed application and operational-state
backups, preserve the current release symlink and unit hashes, then follow the
explicit promotion/migration/rollback gates in [RECOVERY.md](RECOVERY.md).
Never overwrite the only copy of state or point systemd at a mutable worktree.

## Contributing, security, and license

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change and follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately using [SECURITY.md](SECURITY.md), never through a public issue.

No repository-wide license has been selected. ChillsPwn currently grants no permission to copy, modify, or redistribute it. Retained third-party components, including Hermes Agent, remain subject to their own upstream licenses. Do not assume that one component's license applies to the entire recovery repository.

## Acknowledgments

This snapshot contains or integrates with independently maintained projects and services, including Hermes Agent, Bun, React, Vite, Capacitor, Anthropic Claude, OpenRouter, OpenAI Codex, Google Gemini, xAI Grok, MCP-compatible servers, and the broader open-source security-tool ecosystem. Their respective licenses and service terms apply.
