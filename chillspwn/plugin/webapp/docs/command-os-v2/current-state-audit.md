# Command OS V2.1 current-state audit

> Baseline notice: this document records the pre-V2.1 characterization used to
> plan the implementation. It is intentionally preserved as before-state
> evidence. It does not describe the current candidate; see
> [`completion-gap-audit.md`](completion-gap-audit.md).

Date: 2026-07-15
Scope: `chillspwn/plugin/webapp` and the live state paths used by the recovered deployment
Method: source inspection, read-only state inventory, production build, unit/type checks, browser capture, and Higgsfield reference analysis

## Executive finding

ChillsPwn already has substantial runtime, provider, policy, evidence, memory, training, MCP, session, and reporting behavior. It does not yet have the product or reliability model required to call that behavior a durable mission operating system. The current product is still session-first, provider-facing, and split across file stores. The V2.1 work therefore begins with canonical mission state and deterministic supervision before replacing execution behavior.

## Verified application architecture

- Frontend: React 19, TypeScript strict mode, Vite 6, Tailwind 4, Bun 1.3.14, Capacitor 8.
- Backend: Bun/Express, WebSocket and SSE endpoints, provider subprocesses, MCP bridges, and `better-sqlite3` installed but not used by the ChillsPwn runtime.
- `src/App.tsx` is 1,173 lines and still contains roughly 500 lines of obsolete window-manager code.
- `src/pages/ChatPage.tsx` is 3,949 lines and owns transport, provider selection, sessions, permission prompts, files, terminal injection, attachments, streaming, and presentation.
- `src/index.css` is 2,040 lines, with two token generations, 148 `!important` declarations, and conflicting global overrides.
- `server/index.ts` is 9,878 lines and owns HTTP/WS setup, provider processes, board dispatch, sessions, runtime construction, logs, and restart reconciliation.
- Useful modules already exist under `server/runtime`, `server/providers`, `server/agents`, `server/mcp`, `server/routes`, and `server/security`.

There is no pathname router. The root page mounts an in-memory 21-tab shell with chat selected. Hash links are compatibility actions rather than durable mission URLs.

## Verified data stores

| Domain | Current source | Reliability issue |
| --- | --- | --- |
| Board/tasks | `/root/.hermes/kanban.db` | External schema, CLI SQL, no ChillsPwn migration version |
| Hermes session index | `/root/.hermes/state.db` | 808 MB SQLite store with 4,565 sessions and 52,251 messages; separate from dashboard session JSON |
| Run current state | `runtime/runs/<run>.json` | Whole-document rewrites; corrupt reads appear missing |
| Runtime history | `runtime/events.jsonl` | No transactional outbox, sequence, replay, or gap repair |
| Sessions | Session JSON files | Session is the practical execution owner |
| Provider history | Raw JSONL/log files | Sensitive and unsuitable as reusable memory |
| Structured memory | `runtime/memory/items.json` | Flat array; active file currently empty |
| Lessons | `runtime/training/lessons.json` | Flat array; active file currently empty |
| Artifacts/evidence | Files plus JSON indexes | Metadata and state are not transactionally linked |
| Legacy memory | `USER.md`, `MEMORY.md`, `ARCHIVE.md`, audit files | Useful history but mixed provenance and retention |

Live-path inventory found 3,025 board tasks, 42,453 task events, 656 task runs, 77 runtime run documents, 6,046 runtime events, 3,731 dashboard session files, 4,565 indexed Hermes sessions, 52,251 indexed messages, and 2,178 conversation transcripts. Historical event records include memory and lesson proposals even though the active arrays are empty. Migration must reconcile history and quarantine rather than infer that empty active files mean no prior learning.

The deployed paths differ from the recovery unit defaults. Source discovery must read the actual service/environment configuration and never assume `CHILLSPWN_STATE_DIR`.

## Existing lifecycle and journey mapping

The current lifecycle is:

`created -> planning -> awaiting_plan_approval -> executing -> awaiting_user_input | blocked | terminal`

V2.1 maps it as follows:

| Legacy concept | V2.1 concept |
| --- | --- |
| managed/board/auto approval | Internal Autonomous machinery after a signed contract |
| observe chat/manual approval | Guided |
| `awaiting_plan_approval` | Pre-launch `awaiting_contract_confirmation` or a Guided decision |
| `awaiting_user_input` | Guided-only `waiting_guided_decision` |
| `executing` | `running` |
| provider/mode selectors | Secondary policy-driven routing controls |

No current persistent object carries a `journey`, and there is no Mission object supporting multiple runs.

## Policy boundaries and Autonomous feasibility

The no-hands commander policy, specialist routing, Grok ACP reduced tool surface, target validation, reusable-memory screening, and evidence-gated lesson verification are strong foundations.

Full Autonomous execution is not yet feasible because:

- managed launch stops for plan approval;
- provider execution is observed rather than driven through durable steps;
- approval mode is global rather than contract-scoped;
- plan tool allowlists are not uniformly enforced across provider paths;
- board workers execute outside a single assignment boundary;
- no contract, readiness gate, lease, checkpoint, budget, retry taxonomy, recovery planner, or safe stop exists;
- restart reconciliation marks work stopped/failed instead of resuming deterministically.

Grok ACP currently has the strongest commander boundary. Its text-oriented continuation controller still asks the operator after a bounded number of turns, which violates the launched-Autonomous invariant. Claude remains Guided/advisory-only until it can pass the same enforceable action boundary.

## Memory and Obsidian findings

Existing reusable lesson fields already capture prerequisites, signals, executable steps, tools, references, validation, failures, recovery, and provenance. Existing validators reject secrets, target identity, credentials, hashes, flags, and box-specific material.

Missing capabilities include graph nodes/edges, versions, sensitivity, retention, engagement-keyed isolation, consent, contradictions, suppression, true forgetting, context packs, retrieval telemetry, FTS, vault sync, and conflict resolution. The only current Obsidian capability is a manual filesystem skill; no vault is configured.

## Failure and loop gaps

There is no general action fingerprint, evidence-delta progress evaluator, alternating-cycle detector, equivalent-replan detector, error taxonomy, bounded backoff, lease, worker heartbeat, circuit breaker, unified cancellation token, or deterministic resume. Grok and OpenRouter continuation guards are useful provider adapters but cannot prove meaningful progress.

## Security and privacy risks for migration

- Sessions, provider logs, task bodies, transcripts, and engagement artifacts can contain credentials and proof material.
- Existing run records lack engagement linkage, so uncertain correlation must be quarantined.
- Current `engagement` memory scope has no engagement identifier.
- Parse failures can masquerade as empty stores.
- Existing live file modes are broader than the recovered service's `UMask=0077` design.
- A privacy-compliant forget operation must remove content, embeddings, derived edges, cached context, and synchronized notes while retaining only content-free audit metadata.

## Baseline verification

- Server tests: 562 passed, 0 failed.
- Frontend utility tests: 31 passed, 0 failed.
- Server and client TypeScript checks passed.
- Production build passed.
- Original logo SHA-256: `0a3dfd69f74a00d41bb0cb20d6af1097dffa265d4c1e54c9228fe4b55f85c955`.

The baseline screenshot is at `screenshots/before-command-center.png`. It was
captured from baseline commit `343f6ac` with an isolated empty `HOME`, Hermes
state, sessions directory, and loopback-only dashboard port. No live engagement,
provider credential, operator memory, or production database was mounted.
