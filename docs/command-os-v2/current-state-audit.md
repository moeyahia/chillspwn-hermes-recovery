# Command OS V2.4 current-state audit

Status: initial Phase -1/0 characterization, 2026-07-16 UTC. This document records observed source behavior; it is not a cutover approval or a claim that V2 exists.

## Authoritative source pin

| Field | Verified value |
| --- | --- |
| Repository | `https://github.com/moeyahia/chillspwn-hermes-recovery` |
| Default branch | `main` |
| Exact HEAD | `343f6ac5a05f7286a0d66aee8c5dbd6e78a41aee` |
| Commit time | `2026-07-14T20:49:58-04:00` |
| Subject | `Merge pull request #1 from moeyahia/agent/refresh-chillspwn-repository` |
| Audit worktree | `/root/chillspwn-command-os-v24` |
| Audit branch | `feat/command-os-v2-4-parallel` |
| Initial working tree | clean |

The repository began as a squashed disaster-recovery snapshot. `SOURCE-MANIFEST.md` records an initial snapshot at `2026-07-11T14:39:35Z` and a source refresh at `2026-07-15T05:02:52Z`. The ChillsPwn source was captured from `/opt/chillspwn/plugin/webapp`, then at branch `phase-19-board-session-lifecycle`, base commit `f626be547a9c06cf772159b7162b8fcc4ccade80`; 245 selected source files were retained while credentials, logs, generated output, and engagement data were excluded. Hermes is recorded as version `0.14.0`, upstream base `4d2df86281551614056baba8300bea6d04d5396c`. Those identifiers are provenance only: the GitHub `main` HEAD above is authoritative.

No `chillspwn/plugin/command-os-v2` or `chillspwn/plugin/apps/command-os-v2` directory exists at this HEAD. The chosen greenfield location is therefore `chillspwn/plugin/command-os-v2`.

## Legacy freeze boundary

The protected production application is `chillspwn/plugin/webapp`. Its entry point, components, global CSS, browser state, build output, Android/Capacitor project, APIs, WebSocket behavior, and operational stores are not V2 implementation surfaces. In particular, V2 must not import or rewrite:

- `src/App.tsx` — 1,173 lines; shell, navigation, session rail, persona selection, and page composition.
- `src/index.css` — 2,040 lines of accumulated global styling.
- `src/pages/ChatPage.tsx` — 3,949 lines spanning chat, session lifecycle, WebSocket handling, provider switching, tool activity, and composer behavior.
- `src/pages/AgentCockpitPage.tsx` — 657 lines of managed-run controls and runtime inspection.
- `src/pages/MissionBoardPage.tsx` — 147 lines and an eight-second polling loop.
- `server/index.ts` — 9,878 lines spanning HTTP, WebSocket, providers, sessions, boards, files, reports, OSINT, logs, and process lifecycle.

The logo at `chillspwn/plugin/webapp/public/Logo.svg` has independently verified SHA-256:

`0a3dfd69f74a00d41bb0cb20d6af1097dffa265d4c1e54c9228fe4b55f85c955`

It is a protected invariant. V2 may consume the original SVG through a hash-verifying asset step; it may not redraw, recolor, regenerate, or overwrite it.

## Verified legacy application model

The application has no URL router for its main product surfaces. `App.tsx` selects one of 21 lazy-loaded applications in a unified shell and uses transient hash targets for a few deep links. The navigation groups are Operate, Agents, Intel, Configuration, and Logs; the primary product remains chat/session led. The shell refreshes sessions every five seconds. Mission Board separately polls every eight seconds. Chat and terminal use the shared `/ws` endpoint; API Monitor and System also use SSE endpoints.

Observed concentration is not permission to refactor the legacy interface. It explains why V2 must have a separate composition root, router, styles, state, test project, and build.

## Runtime capabilities at HEAD

### Policy and execution

- Runtime risk classes are `read-only`, `file-write`, `terminal`, `network`, `destructive`, `credential-sensitive`, and `exploit-sensitive` in `server/runtime/types.ts`.
- `ToolPolicy.ts`, the agent roster, and MCP manifests already classify tool risk and retain approval boundaries. These must feed a V2 registry adapter instead of being copied into React.
- Existing run states are `created`, `planning`, `awaiting_plan_approval`, `executing`, `awaiting_user_input`, `blocked`, `completed`, `failed`, and `cancelled`.
- Existing plan-step states are `pending`, `running`, `blocked`, `completed`, `failed`, and `skipped`.
- Existing tool-call states are `requested`, `awaiting_approval`, `approved`, `rejected`, `executing`, `succeeded`, and `failed`.
- The current runtime distinguishes `managed` from `observe` execution. Observe-only activity is explicitly not enforceable; OpenRouter may be configured with an enforced gate, while Claude and Grok paths are represented as observe-only in the cockpit. This distinction is essential to Autonomous readiness.

### Evidence and memory

- Existing evidence kinds are `command_output`, `file`, `screenshot`, `http_response`, `finding`, and `artifact`.
- The current `EvidenceItem` model records provenance fields, but `command_output` is itself an evidence kind. V2.4 requires a stricter pipeline: log record → observation → candidate → verified evidence. Raw output must default to log, not verified evidence.
- Structured memory is file-backed at `runtime/memory/items.json`; lessons are an atomic JSON array at `runtime/training/lessons.json`; run documents are one JSON file per run; events/logs and provider/session activity use JSONL/text files; artifacts are side files.
- The legacy root-owned `USER.md`/`MEMORY.md` store is exposed only through the memory broker safety boundary. Current structured memory requires provenance and explicit promotion for reusable scopes; verified lessons cannot self-approve.
- No Obsidian integration, graph store, Context Pack ledger, vault watcher, or two-way conflict workflow was found at authoritative HEAD.

### Agents, MCP, and providers

- The runtime registers 12 specialists: ReconScout, WebBreaker, CredSmith, ADAttackMapper, CloudSentinel, ReverseSage, FuzzSmith, OSINTSeeker, SecretHunter, SessionRunner, ReportSmith, and VulnIntel. The commander is intentionally outside the specialist roster.
- The roster declares capabilities, MCP/tool allowlists, risk profiles, evidence requirements, handoffs, routing signals, and safety boundaries. Agents can propose lessons but cannot approve their own lessons.
- MCP configuration is manifest/registry driven through `McpServerRegistry` and `McpArsenalBridge`; health and agent mapping already exist and should be adapted into V2 readiness.
- Provider kinds are Claude, OpenRouter, OpenAI Codex, Gemini, and xAI Grok. OpenRouter and Codex expose catalog endpoints; the code also contains static provider/model lists in UI pages, a drift risk V2 must eliminate.

## Data-store and compatibility map

The recovered deployment separates reviewed code from mutable state. Important legacy locations include:

| Data | Current location / form | V2 preview rule |
| --- | --- | --- |
| Sessions | `/root/.hermes/chillspwn/sessions/*.json` | read-only import only |
| Runtime | `/root/.hermes/chillspwn/runtime/` with run JSON, event data, memory JSON, lesson JSON, artifacts | hash, import, preserve originals |
| Session/tool output | `/root/.hermes/chillspwn/session-logs/*.jsonl` | normalize into logs/observations; no auto-evidence |
| Dashboard/LLM logs | `/root/.hermes/chillspwn/logs`, `llm-logs/*.jsonl`, and `/root/.hermes/logs` | read-only importer; redact before reuse |
| Mission Board | `/root/.hermes/kanban.db` | online backup and one-way import |
| Engagement workspaces | `/root/htb/boxes`, `/root/engagements` | discover configured roots; never mutate during preview import |
| Reusable flat memory | `/root/.hermes/memories` through root broker | do not bypass broker; sanitize/import candidates only |
| V2 canonical data | absent | dedicated `data/command-os-v2.sqlite` and namespaced artifact root |

The V2 database will be transactional truth for V2-owned runs. The Obsidian vault will be an optional synchronized projection, never a second transactional owner. A run must have one server-enforced `control_plane`: `legacy` or `command_os_v2`.

## Reliability and explanatory gaps

The existing runtime persists state and has guarded transitions, approvals, evidence, memory, process-tree cancellation, and some session recovery. It does not contain a general `RunSupervisor`, lease manager, heartbeat watchdog, checkpoint manager, progress evaluator, action-fingerprint loop detector, bounded recovery planner, budget manager, or circuit breaker. Search found `endReason` and lesson-level failed-attempt support, but no structured `FailureDiagnosis` domain.

Consequences that V2 must close before Autoresearch can judge behavior:

- `blocked` and `failed` records lack a canonical, searchable causal diagnosis and valid recovery actions.
- Prompt advice says not to loop, but no general deterministic repeated-action/stagnation bound enforces that promise.
- Observed tool output can be stored under `command_output` evidence; semantic promotion and immutable verification are incomplete.
- A managed run still uses `awaiting_plan_approval`; there is no post-launch Autonomous no-wait invariant.
- Run/session mapping includes in-memory coordination and partial restart reconstruction, not durable action-safe resume.
- Live updates are split among a shared WebSocket, SSE endpoints, five/eight-second polling, and page-specific fetch loops rather than a durable replayable event stream.
- No canonical metrics snapshot, attack-attempt model, recon digital twin, versioned graph plan, Context Pack ledger, or Research Lab exists.

## Baseline validation performed in the isolated worktree

Dependencies were installed with Bun 1.3.14 using the frozen lockfile. Node was v24.15.0 and Python v3.13.12. The following authoritative-main checks passed:

- server entry bundle: 71 modules, approximately 0.71 MB;
- server TypeScript check;
- client TypeScript check;
- Bun tests: 593 passed, 0 failed, 2,138 expectations, 72 files;
- OpenRouter gate integration: 34/34 passed;
- Mission Board MCP portable regression: 17/17 passed;
- production Vite build: 66 modules, 37 output files, 2,767,919 bytes, 2.47 seconds;
- initial JS: 214,079 bytes raw / 67.26 KB gzip;
- global CSS: 63.57 KB raw / 13.05 KB gzip;
- Terminal route chunk: 342.96 KB raw / 87.33 KB gzip;
- Chat route chunk: 76.50 KB raw / 23.13 KB gzip.

There is no Playwright/Cypress project or versioned browser regression suite at authoritative HEAD. No isolated live-provider, production WebSocket, Web Vitals, cross-browser, accessibility, visual-regression, soak, or concurrent legacy/V2 measurement has been claimed. Establishing these is Phase 0/1 work and a cutover blocker.

## External research pins

- Higgsfield MCP exposed 69 tools, including scene analysis, image/video generation, history, variation, and upscaling capabilities. The reference-video analysis completed as job `6a4a8339-ed55-4d53-aeaa-d847966cd035`, 32 scenes spanning `0:00–8:01`, completed `2026-07-16T08:15:23Z`. A transient OAuth failure occurred on the first probe but did not prevent the completed authenticated job.
- `karpathy/autoresearch` default branch `master` was verified at `228791fb499afffb54b46200aca536f79142f117`, commit time `2026-03-26T00:07:37Z`, as of 2026-07-16 UTC. V2 adapts its bounded experimental contract; it does not copy its training implementation or its persistence semantics.

## Initial architecture decisions

1. Create `chillspwn/plugin/command-os-v2` as an independent application and service boundary.
2. Do not import legacy UI components, CSS, stores, or page code.
3. Add `/api/v2` and a versioned V2 event stream; preserve every legacy route and payload.
4. Use a dedicated SQLite database, event outbox, artifact root, queues, telemetry identity, and browser namespaces.
5. Build runtime registries from the actual tool policy, agent roster, MCP manifests, provider capabilities, and evidence rules.
6. Make operational truth—evidence semantics, failure diagnoses, metrics, topology normalization, plan versioning, Vault health, and legacy import—reliable before enabling Research Lab evaluation.
7. Keep legacy the default. Soak, preview acceptance, migration rehearsal, rollback rehearsal, and explicit human sign-off remain pending and mandatory.
