# API overview

The HTTP and WebSocket interfaces are internal dashboard contracts. Command OS
resources are versioned below `/api/v2`; retained unversioned endpoints are
temporary compatibility contracts and are not guaranteed stable for third-party
clients.

## Base URLs

- Development client: `http://127.0.0.1:3132`
- Bun server/API: `http://127.0.0.1:3131`
- WebSocket: `/ws` on the Bun server

Vite proxies `/api` and `/ws` during development. A production build is served from the Bun server's origin.

## Authentication

Loopback requests are trusted by default. When authentication is active, send the configured dashboard token using one of the supported server mechanisms:

```http
Authorization: Bearer <dashboard-token>
```

The server also supports its dashboard cookie flow. Avoid query-string tokens in scripts because URLs are commonly logged.

## Route groups

| Prefix | Responsibility |
|---|---|
| `/api/v2` | Canonical Autonomous/Guided missions, runs, decisions, events, intelligence, Second Brain, learning, reports, and system readiness |
| `/api/health`, `/api/build-id` | Basic process/build status |
| `/api/personas`, `/api/sessions`, `/api/cli-sessions` | Persona and conversation/session lifecycle |
| `/api/runs`, `/api/observe` | Agent runs, plans, approvals, tool gates, evidence, artifacts, and reports |
| `/api/agents` | Specialist roster, routing, enforcement, and Mission Board views |
| `/api/board`, `/api/kanban` | Board cards, columns, output, and process lifecycle |
| `/api/memory`, `/api/runtime-memory`, `/api/training-memory` | Broker-filtered legacy memory, proposed/verified memory, and attack lessons |
| `/api/mcp`, `/api/assets` | MCP registry/execution and asset readiness |
| `/api/files` | Workspace-confined file listing, reading, and gated writing |
| `/api/engagements`, `/api/reports` | Engagement files and report generation/downloads |
| `/api/logs`, `/api/llm-logs`, `/api/api-events` | Operator-visible diagnostics and streams |
| `/api/system` | Process, disk, network, and host statistics |
| `/api/osint`, `/api/council` | Specialized workflows |
| `/api/cron`, `/api/skills`, `/api/delegation` | Hermes configuration surfaces |

Not every route is read-only. File writes, terminal access, process termination, provider execution, MCP calls, and report generation can affect the host and are subject to their respective feature and policy gates.

In the secure default configuration, unversioned `GET`, `HEAD`, and `OPTIONS`
requests remain available for historical inspection and migration, but every
unversioned mutation, `/proxy` request, legacy chat/terminal WebSocket command,
and compatibility background executor is disabled. Such a request returns
`403` with code `legacy_execution_disabled`. The explicit
`ENABLE_LEGACY_EXECUTION_API=true` opt-in reopens this entire weaker boundary,
emits a startup warning, and degrades V2 readiness; it is intended only for a
time-bounded rollback. It does not affect canonical `/api/v2` mutations.

`ALLOWED_WORKSPACE_ROOTS` is shared across `/api/files`, `/api/engagements`, engagement/report resolution, provider working directories, and `/api/osint`. New engagement and OSINT directories use the first configured root that is present and writable by the service. The server rejects unsafe names, symlinked roots/children, traversal, and real paths outside the configured roots.

Legacy `/api/memory` routes are compatibility surfaces and do not own V2
memory. Command OS Second Brain resources are backed by the canonical database,
context-pack policy, and vault projection. A compatibility endpoint may remain
read-only or unavailable when its legacy adapter is not configured; it must
never bypass V2 scope, lifecycle, audit, or forgetting controls.

## Errors

Routes generally return JSON errors with an appropriate HTTP status. Common operator causes include:

- `401`: missing or invalid dashboard token;
- `403`: feature disabled, policy denial, or path outside allowed roots;
- `404`: unknown persona, session, run, artifact, report, or file;
- `409`: lifecycle/state conflict;
- `500`/`503`: external provider, database, report, or Hermes dependency unavailable.

## Compatibility policy

Until an API schema and versioning policy exist:

- treat endpoints as coupled to the bundled UI;
- pin automation to a reviewed commit;
- test integrations before upgrading;
- do not expose the API directly to the public internet;
- avoid building irreversible workflows around undocumented response fields.
