# ChillsPwn + Hermes Recovery

Private disaster-recovery and maintenance repository for the ChillsPwn operator dashboard, its Hermes Agent integration, safe runtime configuration, and restoration tooling.

> **Status:** private recovery snapshot under validation, application pre-release, and environment-coupled. The Hermes snapshot was captured on 2026-07-11; the maintained ChillsPwn application source was refreshed on 2026-07-15. Portable checks run from this repository, while a clean-host restore rehearsal, separately installed provider CLIs, authenticated OAuth sessions, and host security tooling remain deployment responsibilities.

Keep this repository **private**. Use ChillsPwn only on systems and targets you are authorized to test.

## What this repository preserves

- ChillsPwn's React dashboard, Bun/Express backend, Mission Board, agent runtime, personas, and report tooling.
- Claude, OpenRouter, Codex, Gemini, and OAuth-backed Grok ACP integration source.
- Grok ACP Expert mode, commander Soul, delegation boundary, tool policy, runtime isolation, and fail-closed attestation.
- Hermes Agent 0.14.0 source plus selected deployed runtime skills and configuration.
- Android/Capacitor native project source; generated web assets are intentionally excluded and recreated during a mobile build.
- Systemd deployment material and a guarded restoration helper for a fresh Linux server.

The repository is a curated snapshot, not a copy of either original Git history. See [SOURCE-MANIFEST.md](SOURCE-MANIFEST.md) for provenance.

## Screenshot or demo

A screenshot is intentionally omitted until a capture can be proven free of engagement names, targets, logs, infrastructure details, and personal information. Do not use production screenshots in issues or pull requests.

## Technology stack

| Area | Technology |
|---|---|
| ChillsPwn runtime | Bun 1.3.14, TypeScript, Express 4, WebSockets |
| Client | React 19, Vite 6, Tailwind CSS 4, xterm.js |
| State | Hermes SQLite board plus JSON/JSONL runtime stores, excluded from Git |
| Mobile | Capacitor 8 and Android native project source |
| Hermes | Python 3.11+, Hermes Agent 0.14.0 |
| Tests | Bun test runner, TypeScript checks, portable Python integration checks |
| Deployment | Linux systemd services and SSH-tunnel-friendly loopback binding |

Application architecture, data flow, contracts, configuration, and operations are documented under [chillspwn/plugin/webapp/docs](chillspwn/plugin/webapp/docs/architecture.md).

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

`ALLOWED_WORKSPACE_ROOTS` is shared by the file browser, engagement APIs and working directories, interactive Claude workspace access, and OSINT output. The defaults are `/root/htb/boxes` and `/root/engagements`; recovery provisions only those defaults. Pre-create any custom root as a real directory writable/traversable by `chillspwn` before enabling the services.

## Build, test, and code-quality checks

From `chillspwn/plugin/webapp`:

```bash
bun run check:server-entry
bun run typecheck
bun run typecheck:client
bun test ./server ./src/lib
python3 integration/test_or_gate_client.py
python3 integration/test_board_mcp_server.py
bun run build
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
/root/hermes-venv/bin/python -m unittest \
  hermes.runtime.tests.test_chillspwn_learning_pipeline \
  hermes.runtime.tests.test_validate_hermes_config
/root/hermes-venv/bin/python -m compileall -q \
  hermes/source/agent \
  hermes/source/acp_adapter \
  hermes/source/hermes_cli \
  hermes/source/run_agent.py \
  hermes/source/tools/memory_tool.py \
  hermes/runtime/scripts/chillspwn_learn_cron.py \
  hermes/runtime/skills/red-teaming/council-of-ais/scripts \
  scripts/chillspwn-memory-broker.py
git diff --check
```

There is no repository-wide formatter or linter baseline yet. `.editorconfig`, `.gitattributes`, TypeScript checking, test suites, and `git diff --check` provide the current code-quality gate. Introduce a formatter or linter separately to avoid obscuring functional changes.

## Production recovery

On a clean supported Linux server, clone the private repository and run:

```bash
cd chillspwn-hermes-recovery
sudo ./scripts/restore.sh --install-deps
```

Recreate `/root/.hermes/.env` from a password manager or encrypted offline backup, authenticate each enabled CLI, validate the host, and only then enable the service:

```bash
sudo ./scripts/restore.sh --force --install-deps --enable-service
sudo systemctl status chillspwn-memory.service chillspwn.service hermes-gateway.service --no-pager
```

The helper refuses to overwrite a populated installation without `--force`. Read [RECOVERY.md](RECOVERY.md) before using that option. Deployment, rollback, configuration, and operational details are also covered in the [application deployment guide](chillspwn/plugin/webapp/docs/deployment.md).

For Android packaging, build the sanitized web client and regenerate Capacitor assets locally:

```bash
cd chillspwn/plugin/webapp
bun run build
bunx cap sync android
```

Do not commit the generated `android/app/src/main/assets` output.

## Usage and API documentation

After a secure local start:

1. Configure sanitized personas and the provider integrations you intend to use.
2. Create or select an authorized engagement.
3. Coordinate multi-step work through the Mission Board and delegated specialist flows.
4. Review approvals, evidence, artifacts, reports, and proposed training-memory lessons.
5. Preserve operational state only through a separate, consistent, client-side encrypted backup.

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
scripts/              snapshot verifier and guarded restore helper
.github/               CI, issue forms, PR template, and dependency updates
```

Credentials, provider auth stores, databases, sessions, conversations, memories, logs, engagement data, dependencies, generated builds, and downloaded binaries are deliberately excluded.

## Troubleshooting

### No personas are available

Set `CHILLSPWN_PERSONAS_DIR` to the restored persona directory. The integrated recovery units use `/root/.hermes/chillspwn/personas`; local development defaults to `${HERMES_HOME:-$HOME/.hermes}/chillspwn/personas`. The repository includes sanitized source definitions, but it does not include provider authentication or live session state.

### A provider does not start

Confirm its CLI is installed and authenticated as the service account. Keep refreshable OAuth state narrowly service-owned, and keep API-secret environment files root-owned and unreadable by the service after startup; never solve access errors with group/world-readable files. Grok ACP uses the CLI's refreshable OAuth state through `GROK_AUTH_PATH`, not xAI API credits.

### The exposed server refuses to start

This is fail-closed behavior. Keep `CHILLSPWN_BIND=127.0.0.1` for local or tunneled access, or configure a strong `DASHBOARD_TOKEN` before binding to a non-loopback address.

### Mission Board state is unavailable

The operational SQLite database is intentionally absent. Restore it only from a consistent encrypted state backup and review [data and migrations](chillspwn/plugin/webapp/docs/data-and-migrations.md).

### Restore refuses to overwrite files

Inspect the existing destination and backup any needed operational state. Use `--force` only after reading [RECOVERY.md](RECOVERY.md); it is intentionally never implied.

## Contributing, security, and license

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change and follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities privately using [SECURITY.md](SECURITY.md), never through a public issue.

No repository-wide license has been selected. ChillsPwn currently grants no permission to copy, modify, or redistribute it. Retained third-party components, including Hermes Agent, remain subject to their own upstream licenses. Do not assume that one component's license applies to the entire recovery repository.

## Acknowledgments

This snapshot contains or integrates with independently maintained projects and services, including Hermes Agent, Bun, React, Vite, Capacitor, Anthropic Claude, OpenRouter, OpenAI Codex, Google Gemini, xAI Grok, MCP-compatible servers, and the broader open-source security-tool ecosystem. Their respective licenses and service terms apply.
