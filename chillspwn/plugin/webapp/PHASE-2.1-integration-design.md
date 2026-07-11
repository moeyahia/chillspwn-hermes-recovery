# Phase 2.1 — Chat-Runtime Integration Design (checkpoint, not implemented)

How the Phase-2 AgentRun/PlanStep runtime becomes the **real chat runtime** without
touching the frozen `claude -p` path. This is a design + a few small Phase-2 review fixes
(implemented). **No Phase 3 work, no chat-flow code change yet.**

---

## 1. Current live chat flow (exact map, current `server/index.ts`)

| Stage | Where | Notes |
|---|---|---|
| **Objective enters** | WS `case "chat"` — `server/index.ts:6593` | `{ sessionId, persona, prompt, resumeCliSessionId, resumeCliCwd }` |
| Persona resolve | `:6600–6606` | name → persona, default `chillspwn` |
| Per-session provider override | `:6630–6633` (`getSessionProviderOverride`) | mid-convo backend switch; `persona.json` untouched |
| **Provider selection / fork** | `:6635–6642` (comment: "the ONLY edit to the existing chat flow") | `openrouter`/`openai-codex` → `spawnOpenRouter`; else → `spawnClaude` |
| **Claude backend** | `spawnClaude()` `:661` | spawns `claude -p`; stdout → `~/.claude/chillspwn/session-logs/<sessionId>.stdout.jsonl` (`:695`) |
| **OpenRouter/Codex backend** | `spawnOpenRouter()` `:1216` | spawns `orchestrator_openrouter.py`; same stream-json envelope, own stdout log |
| **Stream-json parse** | inside `spawnClaude` (tail+parse of the stdout log) | emits `claude_delta` (token stream) + `claude_event` (`assistant`/`tool_use`/`user` tool_result/`result`) to the session WS |
| **Tool events surfaced** | `broadcastToSession(...)` per-session; board cards via `broadcastBoard()` `:2543` | UI renders tool cards from `claude_event` |
| Follow-ups / steer | `case "followup"`, `sendFollowUp`/`injectIntoSession` | writes to the live process stdin |
| Provider switch | `case "switch_provider"` `:6650` | sets override, ends backend; next `chat` resurrects on the new backend |
| Session resume | `spawnClaude(..., resumeCliSessionId, resumeCliCwd)` → `claude --resume` | OR path reseeds from persisted history |
| **Legacy board-first prompt** | OpenRouter system prompt, `:~1197` (now annotated) | "your VERY FIRST tool call MUST be `board_create_task`" — still active |

**Key seams for integration (both additive, neither edits `spawnClaude`):**
- **Seam A — entry**: just before the fork at `:6638`, the runtime can create an AgentRun + plan.
- **Seam B — observe**: the per-session stdout JSONL (`:695`) is already written by `spawnClaude`. A *separate* tailer can feed it through the Phase-1 `normalizeStreamLine` into the runtime — **observation only**, no change to the existing parser.

---

## 2. Minimal integration design (incremental; future phase, not now)

Two increments so value lands early and the risky part (turn control) is isolated.

### Increment A — "observe + plan" (thin, low-risk)

On a `chat` whose objective is multi-step (heuristic or an explicit UI flag):

1. **Create the run** at Seam A: `agentRuntime.createRun({ sessionId, persona, providerKind, objective })`. Map `sessionId → runId` in a new in-memory `SessionRunMap` (mirrors `liveSessions`).
2. **Planning turn**: get a structured plan via `buildPlanPrompt(objective)`.
   - This is a **separate, additive** provider call — **not** a modification of `spawnClaude`. For Claude, a *new* `claude -p` invocation that returns JSON (its own short-lived spawn); for OR, a direct completion or a one-shot orchestrator call. The existing chat spawn is unchanged.
   - Feed the model's JSON to `agentRuntime.submitPlan(runId, raw)`. Invalid → re-ask (bounded) or fall back to a single-step plan.
3. **Runtime-owned board cards** are created automatically by `submitPlan` (one per PlanStep) and now broadcast live (Phase 2.1 fix #2). The old prompt-driven "board first" instruction can then be **removed** for runtime-managed runs.
4. **Approve**: `approvePlan(runId)` (auto for autonomous mode, or operator action from the cockpit).
5. **Execute as today** but **observed**: the existing chat turn drives the work; Seam B tails the stdout log, runs `normalizeStreamLine`, and calls the runtime to:
   - `recordProviderTurn(runId, …)` on each `result` (**stays distinct from run completion**);
   - associate `tool_requested`/`tool_result` with the **active step** (`requestTool` in **observe-only** mode — record the decision + ToolCall, do not block);
   - `recordEvidence` from notable tool outputs.

Increment A delivers: a visible plan, runtime-owned board cards, evidence, and provider-turn/tool association — **with zero change to `claude -p`** and no turn-control change.

### Increment B — "drive" (later; needs Phase 3 approvals)

The runtime issues per-step turns and gates tools *before* execution. This is where real enforcement lives — and where the claude path's limits bite (see §3). Out of scope here.

### Invariants preserved

- `provider_turn_completed` ≠ `run_completed` — enforced in `AgentRuntime.recordProviderTurn` (no status change) and the normalizer (emits `provider_turn_*` only). Verified by test.
- Existing sessions/resume: the run is a **parallel umbrella**; if no run exists for a session, chat behaves exactly as today. Resume is unaffected (the run is reconstructed from `SessionRunMap`/store, or simply absent).
- `claude -p` argv/stream/resume/output parsing: untouched (planning is a separate spawn; execution observation is a separate tailer).

---

## 3. Phase 3 enforcement scope — recommendation + tradeoffs

**Recommendation: enforce ToolPolicy + approvals INSIDE `/api/runs` first; OBSERVE-ONLY on live chat.**

- **`/api/runs` (runtime-owned execution)** — enforce fully. The runtime owns these tool calls, so `decideTool` → deny/approval is real and safe. *Tradeoff:* only protects runtime-driven flows, which aren't the live chat yet.
- **Live chat — claude path** — **cannot truly gate without breaking the freeze.** `claude -p` runs its tools internally; intercepting them means `--permission-mode`/hooks, i.e. changing Claude invocation/behavior — **forbidden**. So for live claude, Phase 3 is **observe-only**: surface "what *would* be gated" (risk + decision) in the cockpit/audit, no blocking.
- **Live chat — OpenRouter path** — gating *is* technically possible, but only by changing `orchestrator_openrouter.py`'s `council_tools.dispatch` (a Python-side change), **not** `index.ts`. Recommend deferring real OR gating to a dedicated, separately-reviewed orchestrator change after Increment B.

**Net:** Phase 3 = real enforcement in `/api/runs` + observe-only/audit on live chat. Honest about the claude-freeze limit; no false sense of protection.

---

## 4. Files that would change (future integration — NOT in this checkpoint)

| File | Expected change |
|---|---|
| `server/index.ts` | At Seam A (`:6638`): create run + planning turn + `SessionRunMap`. Wire Seam B observer start/stop alongside `spawnClaude`/`spawnOpenRouter` (additive, no edit to those functions). Eventually drop the legacy board-first prompt for runtime-managed runs. |
| `server/runtime/SessionObserver.ts` *(new)* | Tail `<sessionId>.stdout.jsonl`, run `normalizeStreamLine`, drive `recordProviderTurn` / observe-mode `requestTool` / `recordEvidence`. Pure observation. |
| `server/providers/ClaudeProvider.ts`, `OpenRouterProvider.ts` | Supply a real `lineSource` (the file tail) to `streamTurn` — already designed for DI in Phase 1; no behavior change to the underlying spawns. |
| stream-json parsing | **No change to `spawnClaude`'s parser.** Observation is a *second* reader of the same log. |
| board/card updates | Runtime card create/update already broadcast (Phase 2.1 fix). Increment A maps step↔card status live. |
| `src/pages/ChatPage.tsx` | Optional: show an AgentRun banner (objective/plan/active step). Likely deferred to the Phase 5 **Agent Cockpit** rather than overloading ChatPage. |
| runtime APIs | Add `attachSession(runId, sessionId)` + `setActiveStep(runId, stepId)` (or derive active step) so the observer can associate turns/tools. Small, additive. |

---

## 5. `claude -p` stays frozen

No change to: the `claude -p` invocation pattern, Claude CLI arguments, stream-json behavior, session resume, `spawnClaude`, Claude tool handling, or Claude output parsing. Planning is a *separate* spawn; execution observation is a *separate* tailer of an already-written log.

---

## 6. Small corrective fixes shipped in this checkpoint

1. **`evidence.kind` validated** — `POST /api/runs/:id/evidence` now rejects an unknown `kind` (400) via the new `isEvidenceKind` guard; defaults to `finding` when omitted.
2. **Board broadcast on runtime card create/update** — `KanbanBoardSink` gained a non-throwing `onChange` hook, wired to `broadcastBoard`, so runtime plan cards appear live on the Kanban (best-effort; never affects the board write or the run).
3. **Documented** that the legacy prompt-driven board-first instruction **remains active** until chat-runtime integration is approved (annotated at `server/index.ts:~1197` and here).

All three are additive, behind the existing runtime/board code, and covered by tests (115 pass).
