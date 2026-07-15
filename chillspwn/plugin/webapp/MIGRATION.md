# Historical migration ledger — Phases 1 → 18

> **Do not use this file as the recovery or deployment runbook.** It preserves historical,
> per-phase implementation notes, old branch/commit names, and patch procedures through Phase 18.
> The combined recovery repository already contains the selected deployed source/runtime files;
> applying an old patch again can duplicate or regress current behavior. Use the root `RECOVERY.md`
> and the maintained webapp documentation for a current restore.
>
> **Reading order / historical context.** The blockquotes below are **historical, per-phase** notes
> (each describes that phase at the time). Where an early note says something like
> "`orchestrator_openrouter.py` was NOT modified" or "board-first prompt remains active", it
> describes the state **as of that phase** — it is superseded by the **Phase 8–14** and
> later sections in this ledger. This file is **not a statement of the current deployment**;
> the repository now also contains Phase 19 lifecycle, memory, and Grok ACP boundary work. For the
> maintained system view and integration boundaries, see `README.md`, `docs/architecture.md`,
> `docs/integrations.md`, and `SECURITY.md`.

## Maintained recovery-path mapping

Do not translate the historical commands below literally. The maintained integrated recovery layout is:

| Historical phase path or action | Current recovery contract |
|---|---|
| `~/.claude/chillspwn` runtime/persona state | `CHILLSPWN_STATE_DIR` (default: the `chillspwn` child of `HERMES_HOME`) and `CHILLSPWN_PERSONAS_DIR`; integrated units use `/root/.hermes/chillspwn` |
| Service-readable `.env` | Root-owned mode-`0600` systemd EnvironmentFiles; `chillspwn` cannot reopen them |
| Direct model access to `$HERMES_HOME/memories` | Root-only memory plus `chillspwn-memory.service` validated `add`/`safe-read` broker |
| `grok` found through `PATH` | Root-owned absolute `/opt/chillspwn/bin/grok` |
| Installer-owned `~/.grok/auth.json` | Refreshable `/root/.hermes/auth/grok/auth.json` owned by the service identity |
| Phase patch application | Reviewed source is retained directly and installed by the root `scripts/restore.sh` |
| One dashboard service | `chillspwn-memory.service`, `chillspwn.service`, and `hermes-gateway.service` |

Before a maintained deployment, run `bun run check` from the webapp and the root snapshot/config validation described in `RECOVERY.md`. `bun run check` includes `check:server-entry`, which parses and bundles the production composition root even though that file is not yet included in strict TypeScript checking.

> **Phase 6 (refactor + cleanup) — NO behavior change, NO API change, additive structure:**
> - The Phase 2–5 runtime route HANDLERS (`/api/runs*`, `/api/runtime-memory*`,
>   `/api/observe/tool`, worker-result, cockpit) were **moved verbatim** from
>   `server/index.ts` into `server/routes/runtimeRoutes.ts` (registered via
>   `registerRuntimeRoutes(app, deps)`). Same paths, same responses — verified by an
>   endpoint sweep. The backing singletons (agentRuntime/memoryService) stay in index.ts.
>   index.ts shrank 7348 → 7058 lines.
> - The extracted module is **strict-typechecked** under `tsconfig.server.json`.
> - **Removed** 42 dead `*.bak` SOURCE copies (duplicates of git-tracked source; were already
>   gitignored and unused). **Kept** `g0dm0d3.ts`/`parseltongue.ts` — still referenced by the
>   gated obfuscation shim, so NOT dead. **Did NOT delete** CTF loot / Kerberos tickets /
>   `conversation.mcp` (possible live engagement data) — they remain on disk, gitignored.
> - `.gitignore` hardened (caches, more credential/runtime patterns). Archives use
>   `git archive` → tracked source only, so they were already secret-free.
> - **No change** to the chat path, `spawnClaude`, `claude -p`, `orchestrator_openrouter.py`,
>   any API contract, or the cockpit. **A frontend rebuild is NOT required** for Phase 6
>   (only the server module moved); deploy = restart the dashboard when you choose.


> **Phase 5 (Agent Cockpit UI) — additive; a frontend rebuild is required to see it:**
> - **New UI page** `AGENT COCKPIT` (OPERATE nav group, next to Chat). Lazy-loaded React
>   page that supervises runtime-owned runs: objective/status, plan + steps, active step +
>   active tool, evidence, tool decisions, **pending approvals with Approve/Reject**, worker
>   results, **observe-only classifications clearly labeled NOT enforced**, related memory,
>   and the final deliverable.
> - **One new server endpoint:** `GET /api/runs/:id/cockpit` (read-only composite: run doc +
>   audit events + related memory). Everything else reuses existing Phase 2–4 endpoints.
> - **To deploy:** rebuild the frontend (`bun run build` → `dist/`) and restart the dashboard
>   so the new server endpoint + bundle are served. (Not done here — the live service was not
>   touched. The build was verified to a TEMP dir; the live `dist/` was left unchanged.)
> - **Chat is NOT changed.** The cockpit is reachable as a nav tab only; `ChatPage`,
>   `spawnClaude`, the claude CLI path, and `orchestrator_openrouter.py` are all untouched.
> - The cockpit is usable today by driving runs via `/api/runs*` (REST); it does not require
>   live chat to be integrated.


> **Phase 4.1 (corrective) — additive, no new env/storage, no breaking changes:**
> - Worker `evidence[].kind` must now be a real `EvidenceKind` (not an arbitrary/missing/
>   empty string) — invalid kinds reject the worker result with a clear error.
> - `WorkerResultRecord` now persists the generated `evidenceIds`; **old worker-result
>   records auto-upgrade to `evidenceIds: []` on read** (no migration step).
> - **Clarified (not a code change):** memory provenance validation checks the **shape and
>   presence** of provenance fields, NOT that the referenced run/step/tool/evidence IDs
>   actually exist. Provenance is **not yet referentially verified** — deferred to a later phase.


> **Phase 4 (memory provenance + worker contract) — additive; legacy projection retained:**
> - **New REST** (auth-gated), namespaced to avoid the legacy file memory:
>   `POST /api/runtime-memory/propose`, `GET /api/runtime-memory/{proposals,items}`,
>   `GET /api/runtime-memory/:id`, `POST /api/runtime-memory/:id/{approve,reject,stale}`,
>   and `POST /api/runs/:id/worker-result`.
> - **Legacy `/api/memory` (USER.md/MEMORY.md) remains compatible but is now validated** — the new provenance memory
>   lives separately under `~/.claude/chillspwn/runtime/memory/items.json`.
> - **Safety:** model output never auto-becomes trusted memory. `proposeMemory` always
>   stores an **unverified** item; **`approveMemory` is the only path to `verified`**.
>   project/global scope requires provenance; `tool_observation` requires a tool/evidence
>   link; **hypotheses and evidence never auto-verify**.
> - **Storage:** the per-run JSON doc gained `workerResults: []` (old docs auto-upgrade on
>   read). No DB migration.
>
> **Implemented vs scaffolded:** the memory provenance model + proposal/approval flow + REST
> are **fully implemented and live-tested**. The delegated-worker contract + validator +
> storage + `recordWorkerResult` are **implemented** and reachable via REST, but **wiring
> live board-card / orchestrator workers to RETURN this shape is deliberately NOT done**
> (it would touch `orchestrator_openrouter.py` / delegation) — that is the documented future
> integration point.


> **Phase 3.1 (lifecycle hardening) — additive, no breaking changes, no new env/storage:**
> - `requestTool` now enforces the full lifecycle: a runtime tool call is only
>   allowed/approval-gated when the **run is `executing`** AND the **step exists in the run**
>   AND the **step is `running`** (plus allowedTools + policy). Otherwise it is recorded +
>   audited as a rejection with a clear reason.
> - `recordEvidence` rejects an unknown/foreign `stepId`; `recordToolResult` rejects a tool
>   call not in the run, a vanished step, or a **late result for a terminal step**.
> - `GET /api/runs/:id/approvals` on a missing run now returns **404** (was an empty list).
> - **Output guard:** `ToolResult.output` is truncated to **20,000 chars** inline with a
>   marker (`MAX_INLINE_OUTPUT`); full artifact storage is explicitly deferred to a later
>   phase (`artifacts` are still stored as-is). Old run docs are unaffected.


> **Phase 3 (ToolPolicy enforcement + approvals + evidence) — additive, no breaking changes:**
> - **New REST** (auth-gated): `GET /api/runs/:id/approvals[?pending=1]`,
>   `POST /api/runs/:id/approvals/:approvalId/{approve,reject}`,
>   `POST /api/runs/:id/tools/:toolCallId/result`, `POST /api/observe/tool`.
> - **Enforcement is ON for `/api/runs`** tool calls (deny / approval-required / allow);
>   a `ToolResult` can only be recorded for an **approved** tool call. **Live chat stays
>   observe-only** (`/api/observe/tool` records `tool_observed`, `enforced=false`; it never
>   blocks and never touches `claude -p`). See `SECURITY.md` → "Enforced vs observe-only".
> - **Storage:** the per-run JSON doc gained an `approvals: []` array. Existing pre-Phase-3
>   run docs are auto-upgraded on read (missing arrays default to `[]`) — **no migration
>   step required**.
> - To exercise approval-gating, enable the relevant feature (e.g. `ENABLE_FILE_WRITE=true`)
>   with its `REQUIRE_APPROVAL_FOR_*` left at the default `true`.
> - **No changes** to `spawnClaude` / the Claude CLI path. **`orchestrator_openrouter.py`
>   was NOT modified** (OpenRouter-side gating remains a documented, separate future step).


> **Phase 2.1 (integration checkpoint + small review fixes) — additive:**
> - `POST /api/runs/:id/evidence` now **validates `kind`**: an unknown kind returns `400`
>   (previously any string was accepted); omitting it still defaults to `finding`.
> - Runtime board cards now **broadcast** on create/update (live Kanban reflects them).
> - The legacy prompt-driven "board first" instruction **remains active** on the OpenRouter
>   chat path until chat-runtime integration is approved — see
>   `PHASE-2.1-integration-design.md`. No chat-flow / `claude -p` changes.


> **Phase 2 (AgentRun lifecycle + structured planning) — additive, no breaking changes:**
> - **New REST surface** (auth-gated like everything else): `POST /api/runs`,
>   `GET /api/runs`, `GET /api/runs/:id`, `GET /api/runs/:id/events`,
>   `POST /api/runs/:id/plan`, `/approve`, `/reject`,
>   `POST /api/runs/:id/steps/:stepId/{start,complete,fail}`,
>   `POST /api/runs/:id/tools` (step-bound tool gate),
>   `POST /api/runs/:id/evidence`, `POST /api/runs/:id/complete`,
>   `GET /api/runs/plan-prompt?objective=…`.
> - **New storage** (no DB migration): one JSON doc per run under
>   `~/.claude/chillspwn/runtime/runs/<runId>.json` (created lazily; gitignored). The
>   AgentEvent audit stream stays in `runtime/events.jsonl`.
> - **Board:** when a plan is submitted, the runtime auto-creates one kanban card per
>   PlanStep (created_by=`runtime`) in a **non-`queued`** status, so the existing
>   auto-dispatch sweeper never spawns an agent for a plan card. Cards update as steps
>   run/complete. No changes to the existing board schema or routes.
> - **No changes** to the chat flow, `spawnClaude`, Claude CLI args, stream-json, session
>   resume, or Claude output parsing. The runtime is drivable via the REST surface; wiring
>   it into the live chat turn comes in a later phase.
> - Provider turn completion remains distinct from AgentRun completion (`recordProviderTurn`
>   never changes run status; only `completeRun` does, and only once all steps are terminal).


> **Phase 1.1 (corrective) — behavior notes (no new env vars, no storage changes):**
> - **File browser is now scoped** to `ALLOWED_WORKSPACE_ROOTS` (the historical Phase 1
>   defaults included `/root/htb`, `/root/engagements`, reusable memory, and the report template;
>   the maintained default is now only `/root/htb/boxes` and `/root/engagements`). The old broad
>   `/root` allowance is gone. If you relied on browsing another path under `/root`, add it
>   to `ALLOWED_WORKSPACE_ROOTS` (colon/comma-separated).
> - **Council briefings/assessments are now plain by default** (the l33tspeak mandate is
>   gated behind `ENABLE_PROMPT_OBFUSCATION`).
> - **Auth runs before body parsers**, and **process-kill** is restricted to dashboard-tracked
>   PIDs (+ a narrow `orchestrator_openrouter.py` / `council_summon.py` fallback).
> - Removed `server/check_server.ts` (a standalone g0dm0d3 smoke-test).


Phase 1 is **additive** and **flag-gated**. No storage format changed. The live app keeps
running unchanged until you choose to restart it with the new env. This file tells you
exactly what to do.

## TL;DR

- New code defaults are **secure** (loopback bind, features off). If you restart the live
  service with **no env changes**, remote/iPad access and terminal/proxy/file-write will be
  OFF. To **preserve today's behavior + add auth**, apply the env block below before
  restarting.
- Nothing was deleted. Rollback is `git checkout main` (baseline commit) + restart, or set
  the legacy env values (below).

## 1. New environment variables

See `.env.example` for the full annotated list. Summary:

```
CHILLSPWN_BIND=127.0.0.1          # default; set to 0.0.0.0 / tailscale IP to expose
DASHBOARD_TOKEN=                  # required when exposed; generate: openssl rand -hex 32
CHILLSPWN_ALLOW_UNSAFE_NO_AUTH=false
ENABLE_TERMINAL=false
ENABLE_PROXY=false
ENABLE_FILE_WRITE=false
ENABLE_SECURITY_TOOLS=false
REQUIRE_APPROVAL_FOR_TERMINAL=true   # recorded; enforced in Phase 3
REQUIRE_APPROVAL_FOR_FILE_WRITE=true # recorded; enforced in Phase 3
ALLOWED_WORKSPACE_ROOTS=/root/htb/boxes:/root/engagements
ENABLE_PROMPT_OBFUSCATION=false   # legacy; leave off
ENABLE_CHAT_AGENT_RUNS=false      # Phase 7.1: chat → observe-only AgentRun in the cockpit
CHAT_AGENT_MODE=observe           # observe only (7.1/7.2)
CHAT_AGENT_PLANNING=off           # off | preview (7.2 advisory plan preview)
CHAT_AGENT_PLANNING_MODEL=z-ai/glm-5.1   # OpenRouter slug for the preview / managed plan call
CHAT_AGENT_FORCE_PLAN=false       # never force plan-first chat
ENABLE_RUNTIME_MANAGED_CHAT=false # Phase 7.4: managed-run launcher (NO execution yet)
REQUIRE_PLAN_APPROVAL=true        # managed runs hold at awaiting_plan_approval
```

The systemd unit already loads `/root/.hermes/.env` (`EnvironmentFile=-/root/.hermes/.env`),
so add the variables there.

### Phase 7.1 — Chat Runtime Integration (observe-only)

Set `ENABLE_CHAT_AGENT_RUNS=true` (and restart) to make a normal chat turn ALSO create an
**observe-only** AgentRun that appears in the Agent Cockpit. What it does and does NOT do:

- **Does:** creates one `source=chat`, `mode=observe`, `status=executing` AgentRun per chat
  session (no PlanSteps); a `SessionObserver` tails the stdout JSONL the chat path already
  writes and records **provider turns** + **observe-only tool classifications** (the policy
  decision that *would* apply). The cockpit shows the run with a `CHAT · OBSERVE-ONLY` badge
  and *"No structured plan attached yet — observing live chat."* A small *"Agent Run active ·
  observe-only · View in Cockpit"* chip appears in Chat.
- **Does NOT:** touch `spawnClaude` / `claude -p` / CLI args / stream-json / session resume /
  the provider fork / `orchestrator_openrouter.py`; block, gate, or alter chat; or enforce
  anything against live chat. Observed tool calls are **never** marked enforced — enforcement
  is real only for runtime-owned `/api/runs`.
- **Fail-safe:** if the flag is off, or run-attach throws, or the observer errors, chat behaves
  exactly as before (the seam is wrapped in try/catch; the observer never throws into chat).
- **Restart-behavior:** the `sessionId → runId` map is in-memory; on restart it is rebuilt from
  the durable AgentRunStore (still-`executing`, `source=chat` runs are re-attached). A chat
  turn after a restart with no rebuildable run simply creates a fresh observe-only run.

### Phase 7.2 — Advisory plan preview (manual, NOT enforced)

Set `CHAT_AGENT_PLANNING=preview` (default `off`) to enable a **manual** "Generate plan
preview" button in the Agent Cockpit for observe-only chat runs.

- **Manual, not automatic:** the preview is generated only when you click the button (or
  `POST /api/runs/:id/plan-preview`). It is NOT generated on every chat — chat is never slowed.
- **Advisory, never enforced:** the preview is stored as `AgentRun.planPreview` (a separate
  field — NOT managed PlanSteps). It has no ids/status/approvals/board cards, creates no
  ToolCalls, and never changes the run from `observe` to `managed`. The cockpit labels it
  `PREVIEW` / `NOT ENFORCED`; the live chat keeps running unchanged. The agent is NOT
  following it.
- **How it's made:** the existing `buildPlanPrompt()` + structured-plan parser, fed by a
  single isolated OpenRouter call (`CHAT_AGENT_PLANNING_MODEL`, default `z-ai/glm-5.1`). It
  does NOT touch `claude -p` / `spawnClaude` / the orchestrator.
- **Endpoints:** `POST /api/runs/:id/plan-preview` (generate), `GET …/plan-preview`,
  `DELETE …/plan-preview`. The POST returns 403 if planning is off, 400 for a non-chat /
  managed run, and 502 if the model returns an invalid/empty plan (the run is left untouched
  on any failure).
- **API key:** requires `OPENROUTER_API_KEY` in the environment (already present in the live
  `.env`).

### Phase 7.4 — Runtime-managed run launcher (NO execution)

Set `ENABLE_RUNTIME_MANAGED_CHAT=true` (default off) to show a **"Start runtime-managed run"**
button in the Agent Cockpit. It opens an objective modal; on submit, `POST /api/runs/managed-chat`:

1. creates a `source=chat`, `mode=managed` AgentRun (`status=created`),
2. `beginPlanning` → `planning`,
3. generates a **STRICT** plan (`buildPlanPrompt` → OpenRouter → `parseAndValidatePlan`, **no**
   preview coercion; retries for reliability; **fails clearly** with validation errors if the
   model can't produce a strictly-valid plan — the run is then failed cleanly),
4. `submitPlan` → real PlanSteps + one board card per step → **`awaiting_plan_approval`**.

The cockpit shows the run badged **MANAGED**, the section titled **MANAGED PLAN** (steps,
risks, allowed tools, success criteria), and **Approve plan / Reject plan** buttons. Approve →
`executing`; Reject → `planning`.

**What 7.4 does NOT do:** no `claude -p`, no orchestrator, no tool calls, no tool gating.
Approving the plan moves the run to `executing` but nothing executes until **Phase 7.5**. The
launcher is hidden client-side when the flag is off, and `POST /api/runs/managed-chat` returns
403. Endpoints: `POST /api/runs/managed-chat`, `GET /api/runtime/flags`; plan approve/reject
reuse `POST /api/runs/:id/approve|reject`. Requires `OPENROUTER_API_KEY`.

### Phase 7.5 — Managed observed execution (Option A complete; observe-only)

After a managed plan is approved (run `executing`), the cockpit shows **"Start observed
execution"**. Clicking it (`POST /api/runs/:id/start-observed-execution`) launches the real
provider and attaches a `SessionObserver` that maps observed activity to the active PlanStep.
No new env flag — reuses `ENABLE_RUNTIME_MANAGED_CHAT`.

- **Launch mechanism (no frozen-path change):** the provider is started via an **isolated
  wrapper** — `spawnOpenRouter(…, null)` for OR (the existing headless agent-board-card
  pattern) and `spawnClaude(…, stubWs)` for Claude, where `stubWs` is a closed no-op
  WebSocket. `spawnClaude` uses `ws` only in `new Set([ws])`, and `broadcastToSession` is
  `readyState`-guarded, so the stub is added to the client set and **skipped on every
  broadcast** — never `.send()`-ed. `spawnClaude`/CLI args/stream-json/resume/output parsing
  and `orchestrator_openrouter.py` are **untouched**.
- **OBSERVE-ONLY for Claude (honest):** the observer **classifies** each observed tool call
  (`tool_observed`, `enforced=false`) and records observe-only evidence on the active step,
  but it **cannot and does not block** Claude's tools. The cockpit says *"Execution
  observe-only · Tool policy NOT enforced for Claude · observed tools classified but not
  blocked."* No plan is injected into Claude's prompt (only the original objective is used).
- **Manual step control (no over-automation):** the cockpit has per-step **Start step /
  Complete step** buttons (reusing `POST /api/runs/:id/steps/:stepId/start|complete|fail`).
  The observer never auto-completes a step or the run — completion is operator-driven.
- **Gating:** `start-observed-execution` requires `mode=managed`, `status=executing`
  (plan approved), real PlanSteps, and not-already-started (else 403/400/404/409).
- **Enforcement boundary unchanged:** runtime-owned `/api/runs` tool calls stay fully
  enforced; managed-chat execution is observe-only. (OR/Codex real gating is Phase 7.6.)

## 2. Recommended live rollout (preserve behavior + add auth, no lockout)

Append to `/root/.hermes/.env` (kept out of git):

```
CHILLSPWN_BIND=0.0.0.0
DASHBOARD_TOKEN=<paste output of: openssl rand -hex 32>
ENABLE_TERMINAL=true
ENABLE_PROXY=true
ENABLE_FILE_WRITE=true
ENABLE_SECURITY_TOOLS=true
```

This keeps the dashboard reachable exactly as before, but now behind a token. Then:

```
systemctl restart chillspwn
# verify locally (loopback bypasses auth):
curl -fsS http://127.0.0.1:3131/api/health
# from a device, open once to set the cookie:
#   https://<host>:3131/?token=<DASHBOARD_TOKEN>
```

To go stricter later, flip individual `ENABLE_*` flags off, or move to
`CHILLSPWN_BIND=<tailscale-ip>` / loopback + SSH tunnel.

## 3. New on-disk artifacts (no migration needed)

- Audit log: `~/.claude/chillspwn/runtime/events.jsonl` (created on first event; gitignored).
- No database schema changes. `kanban.db`, session JSON, and memory files are untouched.

## 4. New dev/CI commands (no new runtime dependencies)

```
bun run typecheck        # strict tsc over the new runtime + security + provider modules
bun test ./server        # unit tests (bun's built-in runner)
```

`@types/node` and `typescript` were already present. `bun:test` is built into Bun.

## 5. Rollback

- Code: `git checkout main` (baseline commit `baseline before agent runtime phase 1`) and
  restart. The Phase 1 branch is `phase-1-runtime-foundation`.
- Behavior-only: keep the code, set legacy env to restore pre-Phase-1 behavior exactly —
  `CHILLSPWN_BIND=0.0.0.0`, no `DASHBOARD_TOKEN`, `CHILLSPWN_ALLOW_UNSAFE_NO_AUTH=true`,
  all `ENABLE_*=true`. (This reopens the original no-auth exposure — not recommended.)

---

# Phases 8–14 — Agent Runtime completion (branch `phase-8-to-14-complete-agent-runtime`)

All new capability is **flag-gated**; defaults preserve the exact current deployed behavior.

## Feature flags

| Flag | Default | Effect |
|------|---------|--------|
| `ENABLE_OPENROUTER_RUNTIME_GATING` | `false` | master switch for OR/Codex tool gating |
| `OPENROUTER_GATE_MODE` | `off` | `off` \| `dry-run` (records a NON-blocking observation — never creates an approval) \| `enforce` (real allow/deny/wait) |
| `OPENROUTER_GATE_FAIL_MODE` | `deny` | **only `deny`** — fail-closed when the gate is unreachable (8.1: `allow-read-only` removed, was never implemented) |
| `OPENROUTER_GATE_TIMEOUT_SECONDS` | `300` | max wait for an approval |
| `OPENROUTER_GATE_POLL_SECONDS` | `2` | approval poll interval |
| `ENABLE_DELEGATED_WORKER_CONTRACT` | `true` | wrap free-form worker output into the structured contract |
| `ENABLE_LIVE_MEMORY_PROPOSALS` | `true` | runs may propose memory (always unverified) |
| `ENABLE_FINAL_RUN_REPORTS` | `true` | report + evidence-bundle endpoints |
| `ENABLE_ARTIFACT_STORAGE` | `true` | large evidence → side-file artifacts |
| `ENABLE_COCKPIT_LIVE_REFRESH` | `true` | cockpit auto-refresh |
| `ENABLE_TRAINING_MEMORY` | `true` | HTB Training Memory — verified attack lessons + planning injection (8.2) |
| `ENABLE_LEGACY_PROMPT_CLEANUP` | `false` | drop the hard "board first" prompt rule (runtime owns orchestration) |

**Recommended first deploy:** keep gating OFF; turn it on later as `dry-run` to observe, then
`enforce`. Leave `ENABLE_LEGACY_PROMPT_CLEANUP=false` until OR gating + managed runs are exercised.

## OpenRouter orchestrator gating (Phase 8)

The runtime gate endpoints ship in the dashboard. The Python orchestrator integration is shipped
as a reviewable patch — **NOT applied to the live orchestrator**:

```
integration/phase8-orchestrator-gating.patch   # apply to orchestrator_openrouter.py on deploy
integration/or_gate_client.py                   # testable copy of the inlined gate logic
```

The patch headers are `a/scripts/orchestrator_openrouter.py` / `b/scripts/...`, so the strip level
and target directory must line up. Use **Option A** (verified to apply cleanly):

```bash
ORCH_ROOT=~/.hermes/skills/red-teaming/council-of-ais        # NOTE: parent of scripts/, not scripts/

# 1. ALWAYS dry-run first (no files touched; must print no errors):
patch --dry-run -p1 -d "$ORCH_ROOT" < integration/phase8-orchestrator-gating.patch

# 2. Keep a rollback copy, then apply:
cp "$ORCH_ROOT/scripts/orchestrator_openrouter.py" "$ORCH_ROOT/scripts/orchestrator_openrouter.py.pre8"
patch -p1 -d "$ORCH_ROOT" < integration/phase8-orchestrator-gating.patch
python3 -m py_compile "$ORCH_ROOT/scripts/orchestrator_openrouter.py"   # sanity
```

Equivalent **Option B**: `patch -p2 -d "$ORCH_ROOT/scripts" < integration/phase8-orchestrator-gating.patch`
(strips `a/scripts/`). Do **NOT** use `-p1 -d .../scripts` — that resolves to `scripts/scripts/...` and FAILS.

With the gating flags unset the patched orchestrator behaves identically (the gate is a no-op).
**Rollback:** `cp "$ORCH_ROOT/scripts/orchestrator_openrouter.py.pre8" "$ORCH_ROOT/scripts/orchestrator_openrouter.py"`
(or `patch -R -p1 -d "$ORCH_ROOT" < integration/phase8-orchestrator-gating.patch`).

## Legacy prompt cleanup (Phase 14)

`ENABLE_LEGACY_PROMPT_CLEANUP=true` removes the hard "your VERY FIRST tool call MUST be
board_create_task" forbid from the OpenRouter system prompt (the soft board guidance stays). Only
flip this once runtime-managed runs + OR gating are the orchestration path. Default off = current.

## Obfuscation (g0dm0d3 / parseltongue)

DEPRECATED + QUARANTINED. Off by default (`ENABLE_PROMPT_OBFUSCATION=false`), reachable only via the
identity shims in `server/security/obfuscation.ts`. Not deleted (active identity call sites), not
moved (would break imports). Removal path: inline the shims as identity, then delete the lib files.
**Do not re-enable prompt obfuscation.**

## Rollback

- **Flags:** unset the Phase 8–14 env vars → exact pre-batch behavior.
- **Git:** the batch is one branch; `git checkout 6095c82` returns to the deployed Phase 7.5.1.
- **Orchestrator:** `git`-less file — keep a copy before patching; revert by restoring it (the
  live file is currently the unmodified original).
- **Data:** artifacts live under `runtime/artifacts/`; safe to delete (only previews are inlined).

---

# Phase 8–14.1 — corrective patch (what is COMPLETE vs SCAFFOLDED)

A review-driven corrective pass. No deploy; Claude path still frozen.

## Dry-run gating is now non-blocking (fix 2)

`OPENROUTER_GATE_MODE=dry-run` previously called `requestTool`, which could create a real
`awaiting_approval` ToolCall + ApprovalRequest — making the cockpit show "action required" for a
tool that had already executed. **Fixed:** the gate now branches server-side on the run's launch
mode (`run.metadata.gateMode`, server-authoritative). In dry-run it calls
`AgentRuntime.evaluateToolDryRun`, which computes the would-be policy decision and records a
**non-blocking observation** (`tool_observed`, `mode:"dry-run"`, `enforced:false`) — it creates
**no ToolCall and no ApprovalRequest**, so dry-run can never appear in the approval queue. The
cockpit labels these **DRY RUN · NOT ENFORCED** (and **WOULD REQUIRE APPROVAL** when relevant),
visually distinct from enforce. Enforce mode still creates real pending approvals. Tested.

## Fail-mode is deny-only (fix 3)

`OPENROUTER_GATE_FAIL_MODE=allow-read-only` was documented but never implemented. **Removed** — the
config now accepts only `deny`; the gate client/orchestrator already fail **closed** on an
unreachable gate (deny unknown/terminal/file-write/credential/exploit/destructive). Tested.

## Phase 9 — accurate scope (fix 4)

Phase 9 is a **delegated-worker contract endpoint + free-form fallback wrapping**, NOT automatic
live integration. What is COMPLETE: `POST /api/runs/:id/worker-result` accepts a structured result
OR free-form text (wrapped conservatively via `wrapWorkerResult`), validates, stores
(`recordWorkerResult`), links run/step/board-card/evidence, and the cockpit renders it. What is
SCAFFOLDED: the live delegated-worker paths (the orchestrator's `board_await` / card runners) do
**not** yet auto-POST their results to this endpoint — that wiring is the documented next step. The
endpoint is live-ready; nothing posts to it automatically yet.

## Phase 10 — verified memory now feeds managed planning (fix 5)

Previously verified memory was only queryable. **Now:** the managed-chat planner injects
operator-**verified** memory into the planning prompt via `buildVerifiedMemoryContext` (gated by
`ENABLE_LIVE_MEMORY_PROPOSALS`). It includes ONLY `verified` items, EXCLUDES
unverified/rejected/stale and session-scoped memory, is capped, and is visible/auditable in the
prompt. It is injected into **managed planning only** (not normal chat / not Claude turns). Finer
engagement-relevance scoping (beyond verified + reusable-scope) remains future work. Tested.

---

# Phase 8–14.2 — corrective patch

Second review pass. No deploy; Claude path still frozen.

## Delegated-agent bypass closed (fix 1)

`delegate_task` (and `board_create_task`, `board_update`, `skill_manage`, `remember`) were in the
gate **pass-through** list, so a managed gated run could spawn an agent / mutate state **outside**
the gate. **Removed from pass-through** in `integration/or_gate_client.py` AND the orchestrator
patch. They now go through the runtime gate; the TypeScript ToolPolicy classifies them as
`terminal` / `file-write`, both **OFF by default → denied** (or approval-gated when enabled).
Live-verified in enforce mode: `delegate_task`→deny, `board_create_task`→deny, `remember`→deny,
`read_file`→allow.

**Pass-through is now READ-ONLY / introspection only**, each justified:
`board_await` (waits for cards — no mutation/spawn), `board_list` (reads the board),
`use_skill` / `index_skills` (load/list skill text), `recall_conversation` (reads the log),
`web_search` / `web_extract` (read-only web retrieval — no target-system mutation).

## Verified hypotheses excluded from trusted facts (fix 2)

`buildVerifiedMemoryContext` now also filters out `type === "hypothesis"` — a *verified* hypothesis
is still a hypothesis, so it must never appear under "you may TRUST these". Only verified
`engagement_fact` / `finding` / `tool_observation` / `user_preference` (non-session-scoped) are
injected into managed planning.

## Provider-aware managed labels (fix 3)

`runModeLabel` + the cockpit no longer say "Claude" for OpenRouter/Codex managed runs:
managed Claude → `MANAGED · CLAUDE OBSERVE-ONLY`; managed OR/Codex (no gate) →
`MANAGED · OPENROUTER OBSERVE-ONLY`; dry-run → `OR GATED · DRY RUN`; enforce → `OR GATED · ENFORCED`.
New `executionEnforcementNote(run)` drives the observed-execution banner accurately per provider+gate.

## Gated-result success inference (fix 4)

The orchestrator patch + `or_gate_client` now record `success=false` for obvious runtime errors —
output starting with `[runtime gate` or `ERROR:`, or containing `Traceback (most recent call last)`,
`Permission denied`, or `command not found`. Conservative — ambiguous output stays `success=true`.
Heuristic only (see Known limitations).

## Known limitations (updated)

- **Gated-result success** is a heuristic (the markers above). Tool-specific exit codes are not
  inspected; a tool that fails without one of those markers is still recorded `success=true`.
- **Pass-through web tools** (`web_search`/`web_extract`) are not gated. They are read-only w.r.t.
  the target system, but they DO make network egress — if egress control matters, gate them too.
- Worker live auto-posting, finer memory relevance scoping, and further `index.ts` route
  extraction remain future work (unchanged from 8.1).

---

# Phase 8–14.2 — HTB Training Memory amendment

Adds a first-class **Verified Attack Lesson** model so authorized HTB/lab work trains the agent on
reusable, evidence-backed technique knowledge — not raw notes. Flag `ENABLE_TRAINING_MEMORY`
(default on). See `docs/TRAINING-MEMORY.md` for the full model.

- **New model/store/service:** `AttackLesson` (`category: "verified_attack_lesson"`) under
  `runtime/training/lessons.json`. Distinct from generic `MemoryItem`s.
- **REST:** `POST /api/training-memory/lessons/propose`, `GET /api/training-memory/lessons`,
  `POST /api/training-memory/lessons/:id/{approve,reject,stale}`.
- **Safety:** propose → always `proposed`; approve is the only path to `verified` and **refuses**
  non-promotable lessons (no provenance / contains a secret). Flags/hashes/keys are **rejected**;
  credentials/tokens are **redacted**. Store evidence references, not secrets.
- **Planning injection:** managed planning prepends `VERIFIED TRAINING LESSONS` (verified-only) then
  `VERIFIED MEMORY` (verified, non-hypothesis). Hypotheses / unverified / stale / rejected / secrets
  are NEVER injected.
- **Cockpit:** a "Training memory" review section (approve/reject/stale, evidence count,
  "▶ in planning").

## Ledger cleanup tool (safe by default — DRY RUN)

```bash
bun scripts/training-memory-cleanup.ts                   # dry-run report (no mutation)
bun scripts/training-memory-cleanup.ts --mode=quarantine # mark hypotheses/raw-notes/secrets rejected (no delete)
bun scripts/training-memory-cleanup.ts --mode=promote    # seed PROPOSED lessons from candidates w/ provenance
bun scripts/training-memory-cleanup.ts --mode=delete --confirm-delete   # DANGEROUS, explicit
```

Hypotheses are **never blindly deleted** — they are marked/quarantined and excluded from planning,
preserved for operator review.

---

# Phase 8–14.3 — corrective patch

Third review pass. No deploy; Claude path frozen.

## Verified attack lessons must be evidence-backed (fix 1)

`isPromotable` is stricter: a lesson cannot become `verified` unless it has **both `evidenceIds`
AND `sourceRunId`**, plus at least one corroborating field (`sourceStepIds` / `verificationMethod`
/ `outcome` / `reuseGuidance`), and no secret. A lesson may still exist as `proposed` without these
— it just can't be verified (and so can't reach planning). The cleanup `promote` mode still only
creates **proposed** lessons. Tested: sourceRunId-only → approval fails; evidenceIds-only → approval
fails; both+corroboration → verified.

## Gate approval timeout no longer lingers (fix 2)

When the OpenRouter gate stops waiting (`OPENROUTER_GATE_TIMEOUT_SECONDS`), `or_gate_client` /
the orchestrator patch now call **`POST /api/runs/:id/tool-calls/:toolCallId/timeout`**. The runtime
`expireToolCall` marks the `ApprovalRequest` **`expired`** + the `ToolCall` **`rejected`**, emits an
**`approval_expired`** audit event, and so the cockpit stops showing it as pending/action-required.
Idempotent + safe (terminal tool call → no-op). `resolveApproval` (approve/reject) is unchanged.
Live-verified: 1 pending → timeout → 0 pending / 1 expired / 1 audit event. The patch was regenerated
(applies via `-p1 -d council-of-ais` / `-p2 -d scripts`).

## web_search / web_extract — explicit egress decision (fix 3)

**Kept pass-through, documented as a deliberate egress decision** (see `SECURITY.md`). They are
read-only public-research tools (no target mutation, no agent spawn); the accepted trade-off is
ungated outbound network egress. To gate them, remove them from `_GATE_PASSTHROUGH` (they classify
as `network`).

---

# Phase 15 — Specialist agent army + ChillsPwn Commander-in-Chief

Additive; NOT wired into the live gate (audit-safe). See `docs/SPECIALIZED-AGENTS.md`.

## Flags
| Flag | Default | Effect |
|------|---------|--------|
| `ENABLE_SPECIALIST_AGENT_ROUTING` | `true` | roster/routing/policy + read-only `/api/agents/*` available |
| `ENFORCE_CHILLSPWN_DELEGATION` | `false` | true = DENY ChillsPwn direct specialist-tool use; false = AUDIT-only |
| `ALLOW_CHILLSPWN_DIRECT_TOOLS` | `false` | escape hatch (keep false) |
| `REQUIRE_SPECIALIST_ASSIGNMENT` | `false` | true = a classified-domain step MUST have an assigned specialist |

Audit-safe defaults so nothing breaks. To go to enforce: `ENFORCE_CHILLSPWN_DELEGATION=true` +
`REQUIRE_SPECIALIST_ASSIGNMENT=true`, then restart.

## SOUL deployment
Append `server/agents/personas/chillspwn-commander-soul.md` to the live SOUL
(`/root/.hermes/SOUL.md`) and copy `server/agents/personas/*.md` into the live persona dirs
(`/root/.claude/chillspwn/personas/<id>/SOUL.md` + a `persona.json`). NOT done in this branch.

## MCP arsenal
Vendor `/opt/chillspwn-mcp-arsenal` (clones, NOT committed). Install via dry-run-first
`scripts/setup-mcp-arsenal.sh`. All MCPs disabled by default; exposed only via `agentMcpMap.ts`.

## Rollback
- Flags: unset the Phase 15 vars (routing reverts to off/audit).
- Git: `git checkout a72bb40` (the activated Phase 8-14.3 commit) — Phase 15 is a separate branch.
- Personas/SOUL: only applied on explicit deploy; restore the SOUL/persona backups if applied.

---

# Phase 16 — MCP Arsenal Bridge (additive, default OFF; NOT deployed)

New: `server/mcp/*`, `server/routes/mcpRoutes.ts`, `integration/phase16_mcp_tool.py`. See
`docs/MCP-ARSENAL.md`. Flags: `ENABLE_MCP_ARSENAL=false`, `MCP_ARSENAL_MODE=disabled|dry-run|enabled`,
`MCP_ARSENAL_START_SERVERS=false`, `MCP_ARSENAL_ALLOW_DOCKER=false`, `MCP_ARSENAL_DEFAULT_TIMEOUT_SECONDS=120`,
`MCP_ARSENAL_MAX_OUTPUT_BYTES=20000`.

**Activate progressively (when ready, not in this phase):**
1. `scripts/setup-mcp-arsenal.sh --profile core --write-config --health-check` (+ web/ad/osint).
2. Install the light servers (venv/npm); build Docker images only if using docker MCPs.
3. `ENABLE_MCP_ARSENAL=true MCP_ARSENAL_MODE=dry-run` → validate via `/api/mcp/*`.
4. `MCP_ARSENAL_MODE=enabled MCP_ARSENAL_START_SERVERS=true` (+ `ALLOW_DOCKER=true` if needed) → restart.

**Rollback:** `ENABLE_MCP_ARSENAL=false` (inert) · `rm .mcp.arsenal.json` · `git checkout` pre-16 commit.
Claude path untouched throughout.

---

# Phase 16.1 — Specialist Mission Board (additive, NOT deployed)
New: `server/agents/missionBoardLanes.ts`, `src/pages/MissionBoardPage.tsx`; extended `agentRoutes`
(`/api/agents/mission-board` now specialist-lanes + `/lanes`), `McpArsenalBridge.agentMcpStatus()`.
The old Kanban board + APIs are untouched (kept as KANBAN (LEGACY)); legacy flat cards remain as
`legacyCards`. No PlanStep schema change — `assignedAgent` already existed (backward-compatible).

**MCP activation (when ready — not this phase):** unchanged from Phase 16 (see docs/MCP-ARSENAL.md):
`scripts/setup-mcp-arsenal.sh --profile <core|web|ad|osint> --write-config --health-check` →
`ENABLE_MCP_ARSENAL=true MCP_ARSENAL_MODE=dry-run` → validate via `/api/mcp/*` and the board's MCP
badges → `MCP_ARSENAL_MODE=enabled MCP_ARSENAL_START_SERVERS=true` (+ `ALLOW_DOCKER=true` only for
Docker MCPs). Cloud-control-plane + threat-intel stay disabled unless creds/keys provided.
**Rollback:** board needs no rollback (read-only); `git checkout` pre-16.1; disable routing/MCP flags.

---

# Phase 17 — Wordlist/Hashcat assets + VulnIntel (additive, NOT deployed)
New: `server/assets/*` (3 manifests + Wordlist/Hashcat managers), `server/routes/assetRoutes.ts`,
`scripts/setup-security-assets.sh`, VulnIntel roster/persona/lane, 3 CVE MCPs in the arsenal manifest,
3 strategy/intel lesson kinds, docs (WORDLIST/HASHCAT/VULNERABILITY-INTEL/MISSING-API-KEYS). No PlanStep/
schema changes. Mission Board: 15 lanes (Vulnerability Intel at position 4).

**Activation (when ready, not this phase):**
1. `scripts/setup-security-assets.sh --dry-run --profile wordlists-core|hashcat-core|vuln-intel`
2. `scripts/setup-security-assets.sh --profile wordlists-core --metadata-only --write-config` (no downloads)
3. To enable a CVE MCP: clone its vendor repo to /opt/chillspwn-assets/vuln-intel, install (npm/pip),
   provide NVD/VT/Shodan keys (optional) in .env, add it to the active MCP config `enabled:true`, restart.
4. Wordlist/hashcat assets: sparse-checkout the specific subdir on demand (never full multi-GB clone).

**Rollback:** remove asset manifests' enabled flags / CVE MCP config entries; `git checkout 8696080`;
assets in /opt are not tracked, delete if desired. Claude path untouched throughout.

---

# Phase 18 — Hard Delegation Enforcement / ChillsPwn No-Hands Commander (DEPLOYED)
ChillsPwn (Commander-in-Chief) may NOT directly run the execution surface (`terminal`/`execute_code`/
`process`/`mcp_execute`) or any specialist tool — in **chat AND managed** runs. It is denied + routed
to the right specialist. Closes a direct-execution gap proven by a prior authorized-lab engagement.

**Two enforcement points (both required):**
1. **TypeScript gate (managed runs)** — in-repo: `server/agents/ChillspwnCommanderPolicy.ts`,
   `gateRoutes.ts`, `agentRoster.ts` (GENERIC_TOOLS + SessionRunner exec tools), `config.ts`/`index.ts`
   (`ENFORCE_CHILLSPWN_NO_HANDS`, default true). Deployed by the normal server restart.
2. **Orchestrator (chat sessions)** — retained by the outer recovery repository at
   `hermes/runtime/skills/red-teaming/council-of-ais/scripts/orchestrator_openrouter.py` and installed
   by the exact-sync restore. No secondary patch step is required.

**Confirm flag active:** `grep ENFORCE_CHILLSPWN_NO_HANDS /root/.hermes/.env` → `=true`; or
`GET /api/agents/enforcement` → `"enforceChillspwnNoHands":true`.

**Validate (safe, no attacks):** `GET /api/agents/check-direct-tool?tool=terminal&command=nmap` →
`noHands.action=deny → ReconScout`; `certipy→ADAttackMapper`; `hashcat→CredSmith`;
`execute_code→SessionRunner`; `board_create_task`/`read_file` → allow. Ledger:
`bun scripts/analyze-session-ledger.ts <ledger> --actor chillspwn`.

**Rollback:** (emergency) `ENFORCE_CHILLSPWN_NO_HANDS=false` + restart — DO NOT leave false. For a
full rollback, restore a reviewed private recovery tag as one coherent snapshot. SOUL source artifact:
`server/agents/personas/phase18-no-hands-soul-section.md`. Claude path untouched throughout.
