# ChillsPwn Dashboard

ChillsPwn is a local-first operator dashboard and agent runtime for coordinating AI-assisted, authorized security-testing workflows across Claude, OpenRouter, Codex, Gemini, and Grok ACP integrations.

> **Project status:** pre-release and environment-coupled. The web application builds and its portable tests run from this repository, but full operation currently requires separately managed Hermes services, personas, provider CLIs, and local security tooling. See [Architecture](docs/architecture.md) and [Integrations](docs/integrations.md) before deploying.

Use ChillsPwn only on systems and targets you are authorized to test. Secure defaults disable terminal, proxy, file-write, security-tool, and MCP execution. The process-termination route remains available but is restricted to dashboard-managed processes or exact approved runner commands; review the security model before deployment.

## Features

- React operator dashboard with chat, Mission Board, agent cockpit, reports, logs, runtime controls, and system views.
- Bun/Express backend with REST and WebSocket transports.
- Provider paths for Claude CLI, OpenRouter-backed models, Codex, Gemini, and OAuth-backed Grok ACP.
- Commander/specialist delegation, tool-policy decisions, approvals, evidence, artifacts, run reports, and training memory.
- Optional MCP arsenal, wordlist, hashcat, vulnerability-intelligence, OSINT, and report-generation integrations.
- Loopback-first networking, token authentication for exposed deployments, and explicit gates for risky capabilities.

## Screenshot

A sanitized dashboard screenshot is intentionally deferred until all engagement names, targets, logs, and user information can be removed from the capture.

## Technology stack

| Area | Technology |
|---|---|
| Runtime and package manager | Bun 1.3.14 |
| Client | React 19, TypeScript, Vite 6, Tailwind CSS 4, xterm.js |
| Server | Bun, Express 4, WebSockets |
| State | Hermes SQLite board plus JSON/JSONL runtime stores |
| Mobile wrapper | Capacitor 8 (optional; native Android source is retained, generated web assets are not) |
| Tests | Bun test runner and portable Python integration checks |

## Prerequisites

For the portable dashboard build and test suite:

- Bun 1.3.14
- Node.js 22 or newer for Vite and Capacitor tooling
- Python 3 for the portable gate and Board MCP regressions

For a functional local runtime, also install `sqlite3` and provide the external persona and Hermes contracts described in [Integrations](docs/integrations.md). Provider-specific CLIs and credentials are optional unless their personas are enabled.

The current production environment is Linux/Kali-oriented. Windows and macOS may support frontend development, but the complete runtime assumes Linux process, filesystem, and security-tool behavior.

## Installation

```bash
git clone git@github.com:moeyahia/chillspwn-hermes-recovery.git
cd chillspwn-hermes-recovery/chillspwn/plugin/webapp
bun install --frozen-lockfile
cp .env.example .env
```

Review `.env` before enabling any risky feature. Never copy live provider credentials, engagement data, or a production environment file into the repository.

## Environment configuration

The tracked [.env.example](.env.example) contains secure dashboard and runtime defaults. Optional MCP vendor key names are documented separately in [.env.mcp.example](.env.mcp.example).

Important defaults:

- `CHILLSPWN_BIND=127.0.0.1`: local access only.
- `DASHBOARD_TOKEN=`: required when binding to a non-loopback address.
- Terminal, proxy, file-write, security-tool, and MCP execution gates are disabled.
- `ALLOWED_WORKSPACE_ROOTS=/root/htb/boxes:/root/engagements`: one ordered allowlist for file browsing/writes, engagement APIs and working directories, Claude workspace access, and OSINT output.
- Grok uses the installed CLI's OAuth state through `GROK_AUTH_PATH`; it does not require an xAI API key on this path.
- Gemini's current direct API path consumes `GEMINI_API_KEY` through the external Hermes orchestrator.
- Capacitor packages local assets unless `CAPACITOR_SERVER_URL` is explicitly supplied at build time.

See [Configuration](docs/configuration.md) for the configuration model and exposure rules.

## Local development

Start the backend on port 3131 and the Vite client on port 3132:

```bash
bun run dev
```

Open `http://127.0.0.1:3132`. Vite proxies `/api` and `/ws` to the backend.

To run each process separately:

```bash
bun run server
bun run client
```

If no external personas are installed under `CHILLSPWN_PERSONAS_DIR`, the UI can load but chat will report that no personas are configured. The default is `${HERMES_HOME:-$HOME/.hermes}/chillspwn/personas`; the integrated recovery units set `/root/.hermes/chillspwn/personas` explicitly.

## Build and production-like serving

```bash
bun run build
bun run serve
```

The build writes the frontend to `dist/`. The Bun server serves that directory and the API from `http://127.0.0.1:3131` by default.

`bun run preview` starts Vite's frontend-only preview server; API-dependent pages still need the Bun backend.

Production deployment and rollback are documented in [Deployment](docs/deployment.md). No unattended or remote deployment workflow is included; the outer recovery helper is an explicit, guarded operator action because the target and secret-management design are environment-specific.

## Tests and checks

Run the complete portable validation sequence:

```bash
bun run check
bun audit
```

Or run checks individually:

```bash
bun run check:server-entry
bun run typecheck
bun run typecheck:client
bun test ./server ./src/lib
python3 integration/test_or_gate_client.py
python3 integration/test_board_mcp_server.py
bun run build
```

The server typecheck covers modular server code but intentionally excludes the legacy `server/index.ts`; that file has existing type debt and is executed directly by Bun. `bun run check` compensates by parsing and bundling the production entry before the strict modular typechecks. The board MCP regression loads the retained Hermes script and stubs only its transport dependency when MCP is unavailable, so it is portable and runs in CI without a live board or provider.

## Linting and formatting

The repository currently has no established repo-wide linter or formatter, and existing source has not been mass-reformatted. Editor behavior is normalized through `.editorconfig` and `.gitattributes`. Before opening a pull request, run:

```bash
git diff --check
bun run typecheck
bun run typecheck:client
```

Introduce a formatter or linter in a dedicated baseline change so functional diffs remain reviewable.

## Usage

1. Start the dashboard with a secure local configuration.
2. Configure external personas and only the provider integrations you intend to use.
3. Create or select an authorized engagement.
4. Use the Mission Board and delegated specialist flows for multi-step execution.
5. Review approvals, evidence, artifacts, reports, and proposed training-memory lessons before accepting them.

The HTTP surface is currently an internal UI contract, not a versioned public API. Route groups and authentication behavior are summarized in [API](docs/api.md).

## Project structure

```text
src/            React client, pages, shared UI state
server/         API, WebSocket server, runtime, agents, providers, MCP, security
integration/    Portable and live-environment integration checks/patches
scripts/        Operational inventory and setup helpers
docs/           Architecture, configuration, integration, and operations guidance
public/         Static assets and PWA metadata
deploy/         Sanitized deployment examples
```

Runtime state, credentials, engagement data, logs, generated builds, Android output, and dependencies are deliberately excluded from Git.

## Troubleshooting

### `No personas configured`

Install sanitized persona definitions under `${CHILLSPWN_PERSONAS_DIR}/<name>/persona.json`. The integrated recovery layout uses `/root/.hermes/chillspwn/personas`; tracked persona Markdown files are source material and are not automatically deployed by a standalone webapp checkout.

### Mission Board database errors

The dashboard expects the base Hermes board schema in `${HERMES_HOME:-$HOME/.hermes}/kanban.db`. A standalone webapp start does not bootstrap the full `tasks`, `task_events`, and `task_runs` schema; the outer recovery helper initializes it through the pinned Hermes interpreter and then applies ChillsPwn's additive schema. Review [Data and migrations](docs/data-and-migrations.md).

### Provider does not start

Confirm that the provider CLI or Hermes component is installed for the service account. Keep refreshable OAuth state narrowly service-owned; keep API-secret systemd environment files root-owned and unreadable by the service after startup. Do not solve permission errors by making either class group/world-readable.

### Exposed server refuses to start

Set a strong `DASHBOARD_TOKEN` whenever `CHILLSPWN_BIND` is not loopback. This fail-closed behavior is intentional.

### UI is running but API calls fail

Use `bun run dev` for the proxied development setup, or build and use `bun run serve`. `bun run preview` alone does not provide the API.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) before proposing a change. Report security vulnerabilities privately using [SECURITY.md](SECURITY.md); do not disclose unpatched issues publicly.

## License

No license has been selected. Until the maintainer adds an explicit license, no permission is granted to copy, modify, or redistribute this project. The maintainer must review code and asset provenance before choosing an open-source license.

## Acknowledgments

ChillsPwn integrates with independently maintained tools and services, including Bun, React, Vite, Capacitor, Anthropic Claude, OpenRouter, OpenAI Codex, Google Gemini, xAI Grok, MCP-compatible servers, and the broader open-source security-tool ecosystem. Their respective licenses and terms apply.
