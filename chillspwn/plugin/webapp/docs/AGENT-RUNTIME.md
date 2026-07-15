# ChillsPwn Agent Runtime — Historical Predecessor Modes (Phases 1–14)

> **Historical scope:** this document records the Phase 1–14 runtime design. It does not
> describe the later specialist army, session lifecycle, MCP arsenal, or Grok ACP commander
> boundary. Use `architecture.md`, `integrations.md`, and the top-level `SECURITY.md` for the
> current repository-wide view.
>
> Command OS has exactly two user-facing journeys: **Autonomous** and **Guided**. Every mode in
> this document is retired compatibility terminology, not a supported product choice. Compatibility
> mutations remain default-off behind `ENABLE_LEGACY_EXECUTION_API` and exist only for a bounded
> rollback window.

The agent runtime turns the dashboard from a chat front-end into a supervised agent-execution
platform. It owns plans, tool policy, approvals, evidence, memory provenance, worker results,
final reports, and artifacts — while leaving the **Claude path 100% frozen**.

## Frozen surfaces (never changed)

`claude -p`, `spawnClaude`, Claude CLI args, stream-json handling, session resume, Claude tool
handling, Claude output parsing, and the existing normal Chat behavior. Claude tool calls are
**observed, never enforced** — Claude runs under its own CLI permissions; the runtime cannot
gate them without changing Claude's permission/hook surface (a separate future approval).

## Retired internal compatibility modes

| Mode | What it is | Plan enforced | Tool policy enforced | Approvals enforced | Evidence | Cockpit role |
|------|-----------|---------------|----------------------|--------------------|----------|--------------|
| **Normal Chat** | Plain chat turn (Claude or OR) | – | – | – | – | none |
| **Observe-only Chat** | Chat that also creates an observe AgentRun; SessionObserver tails the log | no | **no (observe-only)** | no | observed | read-only monitor |
| **Preview Chat** | Observe chat + advisory plan preview (labeled PREVIEW · NOT ENFORCED) | no (advisory) | no | no | observed | advisory only |
| **Managed Claude (observed execution)** | Real plan + approval, then Claude runs the objective observe-only | **yes (plan+approval)** | **no — Claude tools observe-only** | yes (plan) | observed + step-mapped | supervise plan, observe tools |
| **Managed OpenRouter (gated)** | Managed run, OR orchestrator consults the runtime tool-gate before each tool | **yes** | **YES (enforce mode)** | **YES** | enforced tool calls + results | full control room |
| **Runtime-owned API run** | `POST /api/runs` lifecycle, no chat | **yes** | **YES** | **YES** | enforced | full control room |

**Historical enforcement boundary:** only the OpenRouter/Codex path and runtime-owned API path could
enforce tool policy because `orchestrator_openrouter.py` owned tool execution in Python and could
wait on the runtime's decision. In Command OS, provider selection is secondary and policy-driven:
a substrate that cannot enforce the selected Autonomous contract or exact Guided decision cannot
perform consequential execution.

## Component map

- **AgentRuntime** — the state machine: AgentRun (created→planning→awaiting_plan_approval→executing
  →completed/failed/cancelled), PlanStep, ToolCall, ApprovalRequest, EvidenceItem, WorkerResult,
  MemoryItem. Emits an append-only AgentEvent audit log.
- **ToolPolicy** — risk classification + allow/deny/require_approval (`decideTool`). `requestTool`
  binds a tool to a running step; `enforceAllowedTools:false` (Phase 8) gates on risk only.
- **SessionObserver** — read-only tail of `${CHILLSPWN_HOME}/session-logs/<sid>.stdout.jsonl`;
  maps observed tool calls to the active step; never enforces.
- **gateRoutes (Phase 8 / 8.1)** — `POST /api/runs/:id/tool-gate`; mode is server-authoritative
  (`run.metadata.gateMode`). **enforce** → `requestTool` (real ToolCall + ApprovalRequest);
  **dry-run** → `evaluateToolDryRun` (records a non-blocking observation, **no ToolCall / no
  approval**). `GET .../tool-calls/:id` (poll), `POST .../result`. The OR orchestrator
  (`or_gate_client`) never blocks in dry-run; fails **closed** on an unreachable gate.
- **WorkerContract (Phase 9)** — structured delegated-worker result + `wrapWorkerResult` (free-form
  fallback). The `POST /api/runs/:id/worker-result` endpoint is **live-ready**; the live worker
  paths (orchestrator `board_await` / card runners) do **not** yet auto-post to it (documented
  future wiring). A contract endpoint, not yet automatic live integration.
- **MemoryService (Phase 10 / 8.1)** — propose (always unverified) / approve / reject / stale;
  `getRelevantVerifiedMemory` (verified-only); `validateMemoryReferences` (referential);
  `buildVerifiedMemoryContext` — verified-only memory is injected into **managed planning** prompts
  (8.1), excluding unverified/rejected/stale/session-scoped.
- **RunReport (Phase 11)** — `buildRunReport` + Markdown/JSON + evidence bundle + `redactSecrets`.
- **ArtifactStore (Phase 12)** — side-file storage by generated id (traversal-safe), sha256.
- **Cockpit (Phase 13)** — run search/filter, unambiguous labels, approvals, evidence drawer,
  report/artifact export.

## Historical Claude observe-only implementation

`spawnClaude` is called with a closed stub websocket; `broadcastToSession` is readyState-guarded
so nothing is sent. The observer records `tool_observed` events with `enforced:false`. The cockpit
label helper (`runModeLabel`/`enforcementLabel`) is unit-tested to NEVER print "ENFORCED" for an
observe-only event.

## Phase 16.1 — Specialist Mission Board
PlanStep → specialist assignment surfaces on the specialist Mission Board as Agent + Task cards (see
docs/SPECIALIZED-AGENTS.md). `PlanStep.assignedAgent` carries the specialist (backward-compatible;
old runs without it are routed by signal). MCP readiness per card comes from the Phase 16 bridge.
The board is read-only assembly (`buildSpecialistBoard`) over runtime docs — it never mutates runs.
