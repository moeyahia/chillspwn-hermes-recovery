# Legacy execution boundary

## Decision

Production exposes exactly two mutating execution journeys: Autonomous and
Guided. The old desktop/chat UI is no longer public, so its backend cannot
remain an implicit third execution API.

`ENABLE_LEGACY_EXECUTION_API` defaults to `false`. With that default:

- canonical `/api/v2` reads and mutations continue normally;
- unversioned `GET`, `HEAD`, and `OPTIONS` compatibility requests remain
  available for migration, reconciliation, and historical inspection;
- every unversioned REST mutation and `/proxy` request returns `403` with
  `legacy_execution_disabled` before a body parser or route handler runs;
- mutating legacy WebSocket messages return the same stable code and cannot
  spawn, continue, approve, interrupt, delete, or open a terminal session;
- the queued Kanban dispatcher, detached OSINT rehydration, and legacy startup
  reconciliation/archive writers do not start.

## Audited compatibility surface

The default-off boundary covers these retained domains:

- persona, board, Kanban, process, approval-mode, and legacy run mutations;
- managed/observed chat launchers, plan previews, runtime memory, training
  memory, tool gates, and old MCP execution;
- cron, skill, delegation, file-write, engagement, report-generation, session,
  OSINT, Council, and API-event analysis mutations;
- the Anthropic compatibility proxy;
- legacy chat, follow-up, provider-switch, interrupt, permission, close/delete,
  and terminal WebSocket commands;
- boot-time compatibility workers that could otherwise execute queued work or
  continue writing file/legacy-database state without a V2 mission contract.

Read-only compatibility is not an execution authority. It must never advance a
mission, dispatch a worker, change policy, mutate memory, or write legacy state.

## Rollback opt-in

Setting `ENABLE_LEGACY_EXECUTION_API=true` reopens the complete compatibility
surface as one unit. Startup emits a loud warning, process health reports the
opt-in, canonical readiness becomes degraded, and structured audit events still
record denied requests when the switch is off.

Use the opt-in only for a reviewed, monitored, time-bounded rollback. Do not
combine it with public ingress. Remove it immediately when the rollback task is
complete; a long-lived opt-in violates the two-journey product invariant.

## Verification

Focused tests prove:

- default denial and the stable error envelope;
- preservation of unversioned reads;
- canonical V2 mutation passthrough and prefix-confusion rejection;
- explicit opt-in behavior;
- complete classification of every recognized mutating legacy WebSocket
  message;
- secure configuration defaults and startup warning;
- readiness and structured health visibility.

The production entry is also bundled as a validation gate so the otherwise
legacy composition root cannot hide an import or syntax failure.
