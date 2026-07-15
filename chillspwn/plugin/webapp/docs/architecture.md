# Architecture

## Scope

This webapp subtree contains the ChillsPwn dashboard and agent-runtime application. The outer private recovery repository also retains Hermes source and selected runtime files, sanitized personas, report templates, deployment units, and a restore helper. Provider authentication, live operational state, engagement data, and optional security-tool/MCP installations remain external by design.

The application therefore has two practical operating levels:

1. **Portable application mode:** install dependencies, run typechecks/tests, build the client, and start the HTTP server.
2. **Integrated operator mode:** add the external contracts in [Integrations](integrations.md) to enable personas, provider execution, Mission Board persistence, reports, memory, and security tooling.

## System context

```mermaid
flowchart LR
  Browser[React dashboard] -->|REST /api| Server[Bun + Express]
  Browser <-->|WebSocket /ws| Server
  Server --> Runtime[Agent runtime and policy]
  Runtime --> DB[(Command OS SQLite)]
  Runtime --> Vault[Obsidian vault projection]
  DB --> Vault
  Runtime --> Providers[Provider execution paths]
  Providers --> Claude[Claude CLI]
  Providers --> Hermes[Hermes orchestrator]
  Providers --> Grok[Grok ACP CLI]
  Runtime --> MCP[MCP bridge and local servers]
  Hermes --> OR[OpenRouter / Codex / Gemini]
  Grok --> OAuth[Grok OAuth state outside Git]
```

## Browser application

`index.html` loads `src/main.tsx`, which mounts the small `src/App.tsx` composition root. The
query-aware router lazy-loads the Command Center, mission portfolio and workspace, Autonomous Live
Operations, Guided Workspace, Decisions, Intelligence, Agents, Second Brain, Learning,
Observability, Reports, and System surfaces. Conversation is contextual to a mission; it is not the
owner of execution state.

During development, Vite listens on port 3132 and proxies `/api` and `/ws` to the Bun server on port 3131. In a production build, the Bun server serves `dist/` and the API from the same origin.

## Server application

`server/index.ts` owns the Express application, WebSocket lifecycle, static serving, provider process management, and several legacy routes. Newer capabilities are split into modules:

- `server/runtime/`: run lifecycle, planning, policy, approvals, evidence, artifacts, reports, memory, and process shutdown.
- `server/agents/`: specialist roster, routing, assignment, personas, and Mission Board logic.
- `server/providers/`: provider abstractions and the Grok ACP boundary/runtime.
- `server/mcp/`: MCP registry, execution policy, and arsenal bridge.
- `server/routes/`: extracted API route groups.
- `server/security/`: startup configuration, authentication, safe paths, and legacy obfuscation controls.
- `server/security/LegacyExecutionGate.ts`: default-off boundary that keeps
  compatibility reads available but denies every unversioned mutation, legacy
  chat/terminal command, and background compatibility executor unless the
  rollback-only `ENABLE_LEGACY_EXECUTION_API` opt-in is set.
- `server/assets/`: wordlist, hashcat, and vulnerability-intelligence catalogs.

`server/index.ts` remains a large legacy composition root and is intentionally excluded from strict TypeScript checking. Modular server code is checked by `tsconfig.server.json`; `bun run check:server-entry` parses and bundles the production entry so syntax and import-graph failures cannot bypass validation. This bundle check is not a substitute for bringing the composition root under strict typing; reducing and typing it remains technical debt.

## Run and delegation flow

```mermaid
sequenceDiagram
  participant O as Operator
  participant UI as Dashboard
  participant R as Runtime
  participant C as Commander
  participant B as Mission Board
  participant S as Specialist

  O->>UI: Select Autonomous or Guided
  UI->>R: Create mission and versioned journey contract
  R->>C: Plan/coordinate under journey boundary
  C->>B: Create assigned task
  B->>S: Dispatch specialist work
  S->>B: Return result and evidence
  B->>C: Awaited result
  R->>UI: Events, decisions, evidence, completion review
```

There are exactly two user-facing journeys. Autonomous executes only through a provider path that
can enforce its signed contract and must recover in-contract or safe-stop. Guided permits only the
exact represented step covered by the current operator decision. Provider selection is secondary,
policy-driven, and inspectable. Grok commander ACP additionally uses an isolated profile, live
readiness attestation, a constrained tool surface, and a fail-closed pre-tool guard. An advisory or
observe-only compatibility substrate is never represented as an enforceable journey executor.

## Persistence

The application reads and writes state outside the repository. In the hardened
deployment the explicit systemd variables below are authoritative:

- `COMMAND_OS_DB_PATH=/var/lib/chillspwn/command-os-v2.sqlite`: canonical mission, event, evidence, memory, and learning state.
- `CHILLSPWN_VAULT_ROOT=/var/lib/chillspwn/brain-vaults`: synchronized Obsidian-compatible projections.
- `CHILLSPWN_STATE_DIR=/var/lib/chillspwn/state`: compatibility runtime data, reports, artifacts, and UI state.
- `CHILLSPWN_PERSONAS_DIR=/opt/chillspwn/plugin/webapp/server/agents/personas`: reviewed persona and Soul source.
- `CHILLSPWN_SESSIONS_DIR=/var/lib/chillspwn/state/sessions`: compatibility ChillsPwn session records.
- `HERMES_HOME=/var/lib/chillspwn/hermes`: Hermes mutable state and configuration.
- Workspace/engagement roots configured by `ALLOWED_WORKSPACE_ROOTS`. The same ordered roots drive file browsing, engagement APIs and working directories, interactive Claude `--add-dir` access, and OSINT output placement.

These paths may contain credentials and target data. They must never be copied into the Git worktree. See [Data and migrations](data-and-migrations.md) and [Operations](operations.md).

## Security boundaries

- The server binds to loopback by default.
- Non-loopback exposure fails closed without a dashboard token unless an explicit unsafe escape hatch is enabled.
- Terminal, proxy, file-write, security-tool, and MCP execution are independent feature gates.
- File, engagement, report, and OSINT artifact routes are confined to configured workspace roots with real-path/no-follow checks. Persisted OSINT control state and worker stdout/stderr live separately under the `osint-jobs` child of `CHILLSPWN_STATE_DIR`; state/artifact reads and stdout tail reads use bounded no-follow helpers.
- API secrets are injected by systemd from root-owned mode-`0600` environment files that the service account cannot reopen. Refreshable provider OAuth stores remain narrowly service-owned where the CLI must update them.
- Provider children receive explicit provider-specific environment subsets. Because they still share the dashboard's UID, this prevents accidental inheritance but is not strong process isolation; same-UID `/proc` access and service-readable OAuth stores remain residual risks.
- Second Brain memory is database-mediated with provenance, scope, consent,
  sensitivity, lifecycle, context-pack audit, and forgetting; the hardened
  services have no root memory-broker dependency.
- The Grok ACP commander receives a reduced environment and OAuth credential path, not an API key value.
- Both services run as `chillspwn` with no supplementary groups or capabilities;
  code/runtimes are root-controlled under `/opt` and state is service-owned under
  `/var/lib/chillspwn`.
- Docker MCP remains disabled because Docker socket access is root-equivalent.

The detailed application threat model is in [SECURITY.md](../SECURITY.md).

## Current technical decisions and debt

- **Bun is canonical.** `bun.lock` is the only JavaScript dependency lockfile.
- **External live state is intentional.** The outer recovery repository packages reviewed source and sanitized runtime contracts, but never credentials, databases, conversations, memories, logs, or engagement data.
- **Deployment is manual.** CI validates source but does not deploy.
- **Android native source is retained.** Gradle output and `android/app/src/main/assets/` are generated and ignored; reproducible signed mobile release work remains future scope.
- **No formatter baseline yet.** Repository-wide formatting should be introduced separately from behavior changes.
- **V2 owns versioned database migrations.** Legacy Board/JSON/JSONL sources are
  imported through an idempotent backup-first compatibility migration and are
  not permanent canonical stores.
