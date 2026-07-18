# ChillsPwn Command OS

ChillsPwn Command OS is a local-first mission, agent-orchestration, evidence, and learning system for authorized security operations. It provides exactly two operator journeys: **Autonomous** execution under a signed mission contract, and **Guided** step-by-step collaboration.

> **Status:** V2.1 pre-release implementation candidate under validation. The canonical mission, run, event, evidence, learning, and Second Brain state is SQLite-backed. Legacy dashboard routes and file-state adapters remain temporarily available during controlled migration.

Use ChillsPwn only on systems and targets you are authorized to test. Autonomous launch is fail-closed when authorization, provider enforcement, specialist routing, or required MCP execution is unavailable.

## Product capabilities

- Durable Mission and Run workspaces instead of chat-owned execution state.
- Autonomous contracts with exact scope, action, retry, replan, time, concurrency, evidence, memory, and safe-stop boundaries.
- Guided explain → recommend → choose → observe → interpret → record → advance workflow with fingerprint-bound decisions.
- Planning-only OAuth-backed Grok ACP commander behind ChillsPwn's delegation and tool boundary; the commander has no direct shell or target-tool surface.
- Specialist-owned MCP execution, immutable evidence hashes, findings, artifacts, reports, correlated events, and semantic observability.
- Run leases, heartbeats, checkpoints, restart recovery, cancellation propagation, loop detection, bounded retry/replan, budgets, and circuit breakers.
- User-owned Second Brain with provenance, consent, engagement isolation, context-pack transparency, forgetting, and an optional two-way Obsidian-compatible vault.
- Evidence-gated evaluations and attack-chain or failed-attempt lesson candidates that cannot self-approve.
- Responsive React shell, keyboard command palette, reduced-motion support, and accessible list alternatives for graph data.

## Screenshots and demo

Production screenshots are intentionally withheld until their mission names, targets, evidence, logs, and operator information can be proven sanitized. The implementation evidence directory is [docs/command-os-v2/screenshots](docs/command-os-v2/screenshots); do not add captures from live engagements.

## Technology stack

| Area | Technology |
|---|---|
| Runtime and package manager | Bun 1.3.14 |
| Client | React 19, strict TypeScript, Vite 6, Tailwind CSS 4 |
| Server | Bun, Express 4, WebSocket/SSE compatibility surfaces |
| Canonical state | SQLite through `better-sqlite3`, WAL, foreign keys, migrations, FTS5 |
| Live delivery | Transactional event outbox, replayable SSE, bounded reconnect and polling fallback |
| Terminal compatibility | xterm.js, disabled by secure default |
| Mobile wrapper | Capacitor 8; generated Android web assets are not tracked |
| Tests | Bun test, Playwright, portable Python integration checks |

## Prerequisites

For portable development and CI:

- Bun 1.3.14
- Node.js 22 or newer for Vite/Capacitor tooling
- Python 3.11 or newer
- `sqlite3` for retained legacy Board compatibility checks

A functional deployment additionally needs the separately installed provider CLIs and only the reviewed MCP servers its mission policy permits. OAuth state, API credentials, databases, engagement data, and artifacts are never included in this repository.

## Install

```bash
git clone git@github.com:moeyahia/chillspwn-hermes-recovery.git
cd chillspwn-hermes-recovery/chillspwn/plugin/webapp
bun install --frozen-lockfile
cp .env.example .env
```

Review `.env` before starting. The tracked [.env.example](.env.example) uses loopback networking and keeps terminal, proxy, file-write, security-tool, and MCP execution gates disabled. Optional MCP variable names are documented in [.env.mcp.example](.env.mcp.example). Real `.env` files and provider auth stores are ignored.

## Local development

```bash
bun run dev
```

The backend listens on `127.0.0.1:3131`; Vite serves the client on `127.0.0.1:3132` and proxies API/WebSocket traffic. To run them separately:

```bash
bun run server
bun run client
```

The first screen is the Command Center. Choose **Go Autonomous** to compose a complete contract, or **Start Guided Mission** for deliberate step-by-step work. Internal provider selection is policy-driven and is not a third journey.

## Build and production-like serving

```bash
bun run build
bun run serve
```

`bun run build` writes the route-split client to `dist/`. `bun run serve` provides both the API and built client on the configured loopback address. `bun run preview` is frontend-only and does not provide mission APIs.

For Android packaging:

```bash
bun run build
bunx cap sync android
```

Do not commit generated `android/app/src/main/assets` output.

## Validation

Run the complete portable gate:

```bash
bun run check
bun run test:e2e:run
bun audit --production
```

Or run checks individually:

```bash
bun run check:server-entry
bun run typecheck
bun run typecheck:client
bun run typecheck:e2e
bun test ./server ./src/lib --timeout 30000
python3 integration/test_or_gate_client.py
python3 integration/test_board_mcp_server.py
bun run build
bun run test:e2e:run
```

Performance evidence can be regenerated with:

```bash
bun run performance:bundle
bun run performance:runtime
bun run performance:check
```

The optional live OAuth/MCP smoke test is deliberately separate from portable CI. It accepts only a loopback server and requires an explicit confirmation variable. It creates isolated test missions, uses the reviewed no-network `local-selftest.quick_scan` MCP for Autonomous validation, and cleans up nonterminal runs:

```bash
CHILLSPWN_LIVE_TEST_URL=http://127.0.0.1:33132 \
CHILLSPWN_LIVE_TEST_CONFIRM=authorized-local-selftest \
bun run test:live:grok-oauth
```

Do not point this test at a production database.

## Database and migration operations

SQLite is the V2.1 transactional source of truth. The Obsidian vault is a synchronized human-readable projection, not an execution-state database.

```bash
bun run db:migrate
bun run db:migrate:legacy -- --dry-run
bun run db:verify
bun run db:backup
bun run db:reconcile
```

Restore is an explicit operator action:

```bash
bun run db:restore -- --help
```

Legacy migration creates a timestamped backup, hashes inputs, supports resume, quarantines malformed records, preserves originals, and produces a reconciliation report. Quiesce writers before a real cutover. Follow [migration.md](docs/command-os-v2/migration.md) and [rollback.md](docs/command-os-v2/rollback.md); never infer a production command from an example.

Obsidian bridge commands:

```bash
bun run brain:import-obsidian -- --help
bun run brain:export-obsidian -- --help
bun run brain:sync-verify -- --help
```

Vault access requires an explicitly permitted root and connection. Synchronization never modifies `.obsidian` settings.

## Environment and security essentials

- Keep `CHILLSPWN_BIND=127.0.0.1` for local or SSH-tunnel access. A non-loopback bind requires a strong dashboard token and a reviewed exposure design.
- `ALLOWED_WORKSPACE_ROOTS` is the sole allowlist for engagement and workspace paths.
- Grok Command OS uses the CLI's refreshable OAuth state through `GROK_AUTH_PATH`; `XAI_API_KEY` is removed from the child environment so this path does not spend xAI API credits.
- The Grok auth directory must be service-owned mode `0700`; the auth file must be service-owned mode `0600` and refreshable by that service account.
- The commander plans, routes, evaluates, and synthesizes. Specialists own tool execution. Do not weaken `ENFORCE_CHILLSPWN_DELEGATION`, `ENFORCE_CHILLSPWN_NO_HANDS`, or exact specialist assignment to make readiness pass.
- Never store credentials, session tokens, private keys, or raw confidential payloads in reusable memory, logs, lessons, or vault notes.
- Autonomous work outside the signed contract safe-stops. Guided work executes only the exact represented fingerprint after a deliberate decision.

See [security.md](docs/command-os-v2/security.md), [memory-privacy.md](docs/command-os-v2/memory-privacy.md), and the repository [SECURITY.md](../../../SECURITY.md).

## API and architecture documentation

The V2 API is an internal application contract. Start with:

- [Current-state audit](docs/command-os-v2/current-state-audit.md)
- [Architecture map](docs/command-os-v2/architecture-map.md)
- [Journey model](docs/command-os-v2/journey-model.md)
- [Domain and database model](docs/command-os-v2/domain-model.md)
- [Event model](docs/command-os-v2/event-model.md)
- [Run supervisor](docs/command-os-v2/run-supervisor.md)
- [Second Brain](docs/command-os-v2/second-brain.md)
- [Obsidian bridge](docs/command-os-v2/obsidian-bridge.md)
- [Existing API reference](docs/api.md)

## Project structure

```text
src/app/                 shell, router, providers, command palette
src/design-system/       tokens, primitives, reusable components
src/features/            missions, runs, Guided, brain, intelligence, operations
src/data/                typed API, schemas, cache, event stream
server/app/              composition and live runtime adapters
server/db/               connection, migrations, health, backups, repositories
server/command-runtime/  durable two-journey mission engine
server/orchestration/    leases, checkpoints, action boundary
server/supervisor/       progress, loops, retries, budgets, recovery
server/memory/           canonical Second Brain and controls
server/vault/            Obsidian projection, watcher, conflicts, portable export
server/learning/         evaluations and evidence-gated attack-chain lessons
server/operations/       scoped operational query repositories
server/events/           durable events, outbox, replay, SSE
tests/e2e/               isolated credential-free browser tests
docs/command-os-v2/      architecture, safety, performance, test, and rollback evidence
```

## Troubleshooting

### Autonomous launch is blocked

Open the readiness details and repair the named dependency. Common causes are missing authorization, insecure/unavailable OAuth state, a non-enforcing provider path, disabled MCP startup, or no reviewed specialist binding. Do not bypass the server-side readiness gate.

### A run appears stuck

Inspect its heartbeat, last meaningful event, checkpoint, provider/MCP health, and Recovery panel. The supervisor transitions expired or repeated work to `recovering` or `blocked`; it does not treat raw tool output as progress. Use pause/resume only after the stated dependency is healthy, or cancel to propagate cleanup to child work.

### Grok OAuth is unavailable

Authenticate the Grok CLI as the service account, then verify the configured binary, protected auth path ownership/mode, commander profile, Soul, plugin, hooks, and MCP attestation. Do not add an xAI API key as a workaround for the OAuth-backed path.

### Guided explanation is waiting

Planning must first persist a versioned plan and one exact decision. A Guided Commander explanation is planning-only and cannot grant tool authority. Refresh the current checkpoint; if planning failed, follow its recovery reason rather than repeating the request.

### Obsidian sync is degraded

Check the Memory Control Center, connected vault permission, sandbox path, and conflict inbox. Database and vault changes are never silently overwritten. Run `brain:sync-verify` against a backup-safe configuration before resolving conflicts.

### The UI loads but APIs fail

Use `bun run dev` for the proxied development setup or `bun run build && bun run serve`. `bun run preview` alone is insufficient.

## Contributing, security, and license

Follow the repository [CONTRIBUTING.md](../../../CONTRIBUTING.md) and [Code of Conduct](../../../CODE_OF_CONDUCT.md). Report vulnerabilities privately using [SECURITY.md](../../../SECURITY.md); never publish an unpatched issue or engagement evidence.

No repository-wide license has been selected. Until the maintainer chooses one, no permission is granted to copy, modify, or redistribute ChillsPwn. Retained third-party components remain subject to their own licenses.

## Acknowledgments

ChillsPwn integrates with independently maintained tools and services including Bun, React, Vite, Capacitor, Anthropic Claude, OpenRouter, OpenAI Codex, Google Gemini, xAI Grok, Obsidian-compatible Markdown, MCP-compatible servers, and the broader authorized-security-tool ecosystem. Their licenses and service terms apply.
