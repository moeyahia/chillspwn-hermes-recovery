# Security Policy

## Supported versions

ChillsPwn has not published a stable release yet.

| Version | Supported |
|---|---|
| Current reviewed default branch | Yes |
| Historical phase snapshots and unmaintained forks | No |

Security fixes are developed against the current maintained branch. A supported-release table will replace this policy when versioned releases begin.

## Reporting a vulnerability

Do not disclose an unpatched vulnerability in a public issue, discussion, pull request, chat log, or demonstration environment.

Use GitHub private vulnerability reporting when it is enabled for the repository. If that feature is unavailable, contact the repository owner through a pre-established private channel and request a secure reporting path. Do not put vulnerability details in the initial public contact.

Include:

- the affected commit or version;
- the affected component and configuration;
- clear reproduction steps or a minimal proof of concept;
- expected and actual behavior;
- impact and realistic attack prerequisites;
- whether credentials, target data, or user information may be exposed;
- suggested remediation, if known;
- a safe way to contact you for follow-up.

Do not include real provider credentials, private keys, engagement data, or third-party personal information. Use synthetic fixtures and redact logs. Maintainers will acknowledge a complete report, investigate it, coordinate a fix and disclosure timeline, and credit the reporter when requested and appropriate. Response-time commitments will be published once a monitored reporting channel and maintainer rotation exist.

If a credential may have been exposed, revoke or rotate it immediately; deleting a file or commit does not make the credential safe.

## Application security model

This section summarizes the maintained current branch. Later phase-numbered sections preserve implementation history; where historical deployment wording conflicts with this summary, the summary and current code take precedence.

### Current enforcement matrix

| Execution path | Current boundary |
|---|---|
| Runtime-owned `/api/runs` tools | Enforced allow/deny/approval lifecycle; results require approved, step-bound calls. |
| Managed OpenRouter/Codex | Gateable when the retained orchestrator integration and `ENABLE_OPENROUTER_RUNTIME_GATING` are active. `enforce` fails closed; `dry-run` records without blocking. |
| Normal OpenRouter chat | Observe-only unless launched through the managed gated path. |
| Claude CLI chat | Observe-only for native CLI tools; the dashboard does not claim it can block Claude-owned execution. |
| Grok ACP commander | Enforced coordination-only boundary: Mission Board and conversation recall only. Native execution, Grok subagents/tasks, and unapproved MCP tools are denied. |
| Grok ACP specialist | Scoped specialist execution under its persona/tool contract; it is not the ChillsPwn commander. |
| Grok planning/preview | Tool-free; any permission request is denied and interactive questions fail explicitly. |

### Grok OAuth and ACP boundary

Grok is launched through the installed CLI's ACP stdio protocol with `--reasoning-effort high`. The application passes the path to a refreshable, service-owned OAuth file but never reads its value, and removes `XAI_API_KEY` from child environments so this path does not consume API credits.

Commander/planner processes receive an isolated HOME, controlled Grok configuration, `--no-leader`, a reviewed agent profile, the canonical commander Soul, and only explicitly supplied Mission Board/conversation MCP servers. Startup must attest the profile, blocking pre-tool deny capability, and exact MCP/tool surface before the first prompt. A commander-only pre-tool hook and ACP permission handler share the same fail-closed allowlist. Sessions created before the current boundary version are not silently resumed as trusted commander sessions.

OAuth state must be a regular service-owned file with mode `0600` in a service-owned directory with mode `0700`, and both must be writable for atomic token refresh. Recursive/read-only named-user ACLs are not an accepted substitute.

### Lifecycle and delegation

The Phase 18 no-hands policy is the current commander rule: every execution unit, including a quick command, belongs to a different named specialist through the Mission Board. Phase 19 lifecycle controls add ACP activity classification, setup/dead-turn timeouts, queued-turn draining, terminal process-tree shutdown, session reconciliation, and attack-chain memory fields that remove target/box identifiers.

The detailed sections below explain how these boundaries evolved. Labels such as “Phase 7.5.1 deployed” describe an old checkpoint, not the refreshed recovery snapshot.

### Deployment credential and memory boundaries

The integrated recovery units load the optional legacy `/opt/chillspwn/plugin/webapp/.env` first and canonical `/root/.hermes/.env` second. Both are root-owned mode `0600` with no ACL, and `chillspwn` must be unable to read or write them. systemd injects selected values before applying `User=chillspwn`; application and provider code consumes only inherited variables and does not reopen these files. A root-owned startup validator rejects duplicate Hermes YAML keys, structured literal credentials, credential-bearing URLs, and selected high-confidence patterns without printing values.

Direct provider subprocesses and individual Council lanes receive provider-aware environment subsets; the multi-provider Council launcher still holds the inputs required to create those lanes. This limits accidental cross-provider inheritance but is not a strong process boundary: the dashboard and children share the `chillspwn` UID, so same-UID `/proc` inspection and access to service-readable OAuth stores remain possible where host policy permits them. Strong mutual isolation requires separate provider UIDs and a credential broker.

Reusable memory under `/root/.hermes/memories` is `root:root` mode `0700`/`0600` and cannot be traversed directly by the dashboard, gateway, or provider children. The root-owned `chillspwn-memory.service` exposes only validated `add` and policy-filtered `safe-read` operations over `/run/chillspwn-memory/broker.sock`. Whole-file mutation and arbitrary paths are not exposed to the service account; broker failure does not fall back to raw filesystem access.

## Threat model in one line

The dashboard can spawn shells, write files, kill processes, and proxy API traffic on the
host. Before Phase 1 it bound `0.0.0.0` with **no authentication** — anyone who could reach
port 3131 had full control. Phase 1 closes that and gates the risky features.

## Network exposure & authentication

| Variable | Default | Effect |
|---|---|---|
| `CHILLSPWN_BIND` | `127.0.0.1` | Address the HTTP+WS server binds to. Loopback = local only. |
| `DASHBOARD_TOKEN` | _(empty)_ | Shared secret required for **non-loopback** HTTP + WS access. |
| `CHILLSPWN_ALLOW_UNSAFE_NO_AUTH` | `false` | Allow starting exposed with no token (dangerous). |

**Middleware order (Phase 1.1):** the auth middleware is mounted **before** the raw
50 MB proxy parser and the 10 MB JSON parser, so unauthorized remote requests are
rejected before any large body is read.

Rules enforced at startup (`server/security/config.ts` → `validateStartup`):

- **Loopback clients are always trusted** — local dev and SSH-tunnel mode need no token.
- If bound to a **non-loopback** address **without** a token → the server **refuses to
  start** (fail closed), unless `CHILLSPWN_ALLOW_UNSAFE_NO_AUTH=true` is explicitly set
  (which logs a loud warning).
- A valid token may be supplied as `Authorization: Bearer <t>`, `X-Dashboard-Token: <t>`,
  or a `chillspwn_token` cookie. Only the root path accepts the one-time
  `?token=<t>` bootstrap query; API, report, artifact, and WebSocket query tokens
  are rejected. A valid root bootstrap sets an HttpOnly cookie, so the **existing
  built PWA keeps working without a rebuild**: visit `https://host:3131/?token=<t>` once.
- Token comparison is constant-time (`server/security/auth.ts` → `tokensMatch`).
- WebSocket upgrades are gated by the same logic (`verifyClient`).

## Risky-feature gates (secure default = off)

| Variable | Default | Gates |
|---|---|---|
| `ENABLE_TERMINAL` | `false` | WebSocket interactive shell (`term_start`). |
| `ENABLE_PROXY` | `false` | `/proxy/anthropic/*` outbound passthrough. |
| `ENABLE_FILE_WRITE` | `false` | `PUT /api/files/write` (arbitrary-path writes). |
| `ENABLE_SECURITY_TOOLS` | `false` | Offensive tooling via terminal-class tools (Phase 3 enforcement). |
| `ENABLE_CHAT_AGENT_RUNS` | `false` | Phase 7.1: attach an **observe-only** AgentRun to live chat (see below). |

A blocked feature returns a clear `403`/terminal notice and records a `security_event` in
the audit log. These default OFF in code so a fresh clone is secure; the **live deployment
re-enables what it needs via `.env`** (see `MIGRATION.md`).

### Observe-only vs enforced (Phase 7.1)

The agent-runtime enforces tool policy (allow / deny / approval) **only** for runtime-owned
runs created via `/api/runs` (`mode=managed`). When `ENABLE_CHAT_AGENT_RUNS=true`, a chat
session also gets an AgentRun, but it is **`mode=observe` / observe-only**: the
`SessionObserver` reads the chat's existing stdout log and *classifies* each tool call —
recording the policy decision that **would** apply — but it **does not and cannot block,
gate, or alter** the live `claude -p` / orchestrator turn. This is an honesty boundary: the
frozen `claude -p` tools are observable, not enforceable. Observed events are recorded as
`tool_observed` with `enforced: false` and are rendered in the cockpit under a distinct
*"Observe-only classifications (live chat — NOT enforced)"* section, never as enforced
`ToolCall`s. The observer is read-only and fail-safe: it never throws into the chat path and
never touches `spawnClaude` / CLI args / stream-json / session resume / the orchestrator.

**Plan preview (Phase 7.2) is advisory, never enforced.** With `CHAT_AGENT_PLANNING=preview`,
a chat run may carry a `planPreview` — an advisory plan generated on demand. It lives in its
own `AgentRun.planPreview` field (never the managed `steps` array), creates no PlanSteps /
ToolCalls / approvals, and never flips the run from `observe` to `managed`. The cockpit labels
it `PREVIEW` / `NOT ENFORCED`; the live chat is unaffected and is NOT following it. There are
three enforcement tiers, always visually distinct in the cockpit: **MANAGED** (runtime-owned
`/api/runs`, enforceable) · **PREVIEW** (advisory chat plan, not enforced) · **OBSERVE-ONLY**
(live-chat tool classifications, not enforced).

**Runtime-managed chat launcher (Phase 7.4, `ENABLE_RUNTIME_MANAGED_CHAT`, default off).** A
managed chat run (`mode=managed`) goes through the real plan lifecycle and **real plan
approval** (the run holds at `awaiting_plan_approval` until an operator approves). Phase 7.4
deliberately **does not execute**: approving the plan advances the lifecycle but runs no
`claude -p`, no orchestrator, and gates no tools. Tool-execution enforcement is a later phase
and — per the Phase 7.3 design — will **never** be real for `claude -p` (the CLI owns its own
tools). The plan-generation call is strict (no preview coercion): an invalid plan fails the run
cleanly rather than executing a malformed plan.

**Managed observed execution (Phase 7.5) is observe-only.** `POST /api/runs/:id/start-observed-
execution` launches the provider via an isolated wrapper (a closed no-op stub WebSocket for
Claude — `spawnClaude` only does `new Set([ws])` and `broadcastToSession` is `readyState`-
guarded, so the stub is never invoked; headless `spawnOpenRouter(…, null)` for OR). For Claude
the observer **classifies** tool calls (`enforced=false`) but **cannot block** them — the
cockpit labels this *NOT ENFORCED*. No managed plan is injected into Claude's prompt. Real
allow/deny/approval enforcement on the OR/Codex path is a separately-approved later phase
(7.6); runtime-owned `/api/runs` tool calls remain fully enforced.

## Path-traversal hardening

Untrusted `:name`/`:file` route params are validated with `server/security/paths.ts`
(`safeSegment`) on: `/api/personas/:name` (+ `/soul`, `/config`), `POST /api/personas`,
`/api/engagements/:name/files`, `/api/engagements/:name/report`, `/api/reports/:name/view`,
`/api/reports/:name/assets/:file`. Traversal attempts get a `400`.

**File-browser routes (Phase 1.1):** `/api/files/list`, `/api/files/read`,
`/api/files/write` (and `/api/files/roots`) no longer use `startsWith()` or a broad
`/root` allowance. They resolve the requested path and confine it to
`SECURITY.allowedWorkspaceRoots` via lexical and real-path containment (default:
`/root/htb/boxes` and `/root/engagements`; override with `ALLOWED_WORKSPACE_ROOTS`).
That same allowlist now defines engagement discovery/creation/report roots, engagement working
directories, interactive Claude `--add-dir` roots, and the permitted parents for detached OSINT
output. The recovery helper creates and grants only the two defaults; a custom root must be
pre-created as a real non-symlink directory with read/write/traverse access for `chillspwn`.
Reusable memory, provider authentication, reviewed code, and report-template paths are deliberately
excluded from generic writes.
A sibling whose name is a prefix
(`/root/htb2` vs `/root/htb`) and any `../` escape are rejected (`403`, audited as
`path_denied`). Existing reads reject final symlinks and real-path escapes; writes use a
no-follow temporary file followed by an atomic rename.

**OSINT persistence:** user-supplied targets are type-normalized and rendered as inert quoted data
before they reach the Claude prompt. Job IDs, persisted JSON, log tails, output directories, and
report/PDF downloads are revalidated on every read or restart. State and worker logs live under the
service-owned `CHILLSPWN_STATE_DIR/osint-jobs`; output artifacts must remain in a correctly named,
non-symlink directory below an allowed workspace root. State/artifact reads use no-follow file
descriptors, real-path containment, and size bounds. Malformed, traversing, symlinked, oversized, or
out-of-root persisted records are ignored or rejected rather than trusted during rehydration.

## Process-kill hardening (Phase 1.1)

`POST /api/kanban/kill/:pid` refuses PID 1 and the dashboard's own PID, then:

1. **Prefers tracked PIDs** — the process must be one the dashboard actually spawned and
   holds in memory (`dashboardManagedPids()`: chat + claude/OR card agents in
   `liveSessions`, `kanbanJobs`, `osintJobs`, terminals).
2. **Fallback is narrow + exact** — only a `/proc/<pid>/cmdline` containing the exact
   runner script `orchestrator_openrouter.py` or `council_summon.py` is accepted. The
   previous broad matches (`python3`, `/script`, `server/index`, bare `claude`) are gone.
3. **Refuses on an unreadable cmdline** (no silent allow).

Both refusals and successful kills are audited. **Documented gap:** a detached dashboard
child that is neither tracked in memory nor one of the two runner scripts cannot be killed
via this endpoint (intentional; it self-terminates). Full per-PID registration is a
later-phase improvement.

## Prompt obfuscation (legacy / unsafe — default OFF)

The `g0dm0d3` + `parseltongue` leetspeak engine rewrote prompts "to bypass model content
filters." This is **non-auditable and unreliable** and is now gated behind
`ENABLE_PROMPT_OBFUSCATION` (default `false`). All call sites route through
`server/security/obfuscation.ts`, which is the identity function unless explicitly enabled
(then it emits a loud one-time audit warning). **Phase 1.1** also moved the council
briefing's "respond in l33tspeak" mandate behind the same flag (`buildCouncilBriefing`),
so council briefings **and** assessments stay plain/auditable by default, and removed the
standalone `server/check_server.ts` smoke-test that imported `g0dm0d3` directly. The legacy
engine files are retained for a controlled removal in a later cleanup phase. Tests
(`obfuscation.test.ts`) prove the default runtime produces no l33tspeak/obfuscation.

## Audit log

Security-relevant events are appended as JSON lines to
the `runtime/events.jsonl` child of `CHILLSPWN_STATE_DIR` (`server/runtime/EventLog.ts`), queryable by
`agentRunId` / `sessionId`. Emits: `server_start`, `auth_failure`, `ws_auth_failure`,
`terminal_blocked`, `file_write_blocked`, `proxy_blocked`, `kill_refused`,
`process_killed`, `prompt_obfuscation_enabled`, and (Phase 1.1) `path_denied`,
`kill_failed`.

## Tool policy enforcement & approvals (Phase 3)

`ToolPolicy` is now **enforced for runtime-owned tool calls** (the `/api/runs` flow):

- `AgentRuntime.requestTool` runs `decideTool` and acts on it: **deny** (rejected; no
  execution), **require_approval** (a persisted `ApprovalRequest` is created and the tool
  call is held `awaiting_approval`), or **allow** (`approved`). Risk classes covered:
  read-only / network / file-write / terminal / destructive / credential-sensitive /
  exploit-sensitive. Step-binding is mandatory (a call without a valid `stepId` is denied).
- **Approval workflow:** `POST /api/runs/:id/approvals/:approvalId/{approve,reject}` flips
  the approval and the gated tool call; `GET /api/runs/:id/approvals` lists them.
- **Result enforcement:** `POST /api/runs/:id/tools/:toolCallId/result` records a
  normalized `ToolResult` **only for an approved tool call** (a denied/awaiting call is
  refused, `400`/`RuntimeError`), and can mint an `EvidenceItem` linked to the
  run/step/tool-call/board card.
- **Audit:** `tool_requested`, `tool_approved`, `tool_rejected`, `approval_requested`,
  `approval_resolved`, `tool_result`, `evidence_stored` are all written to the EventLog.

### Enforced vs observe-only — read this

> **Historical checkpoint.** This table records the Phase 7/8 transition that motivated the later
> gate. It is retained for design provenance, not as the current recovery state. Consult the current
> enforcement matrix above before enabling a provider path.

| Path | Status |
|---|---|
| **`/api/runs` (runtime-owned)** | **ENFORCED** — deny/approval are real; results require approval. |
| **Live chat — `claude -p`** | **OBSERVE-ONLY** — `POST /api/observe/tool` records what policy *would* decide (`tool_observed`, `enforced=false`). It never blocks and never touches the Claude CLI. Real gating of claude tools is impossible without changing the frozen invocation, so it is intentionally not attempted. |
| **Managed OpenRouter / Codex (Phase 8 design)** | **GATEABLE.** With the retained orchestrator integration + `ENABLE_OPENROUTER_RUNTIME_GATING=true`: `off` disables gating; `dry-run` records without blocking; `enforce` performs real allow/deny/approval and fails closed if the runtime gate is unreachable. |
| **Normal chat — OpenRouter** | **OBSERVE-ONLY** (not a managed gated run) — same as `claude -p`: classified, never blocked. |

This split is deliberate: it avoids a false sense of protection over the frozen Claude path, while
making OpenRouter/Codex genuinely enforceable (that path owns its tool execution in Python).

## Known gaps (deferred to later phases by design)

- The Anthropic proxy still logs request/response bodies; redaction tightening is a
  follow-up. It is now `403` by default (`ENABLE_PROXY=false`).
- **Live (non-managed) chat** tool calls — both `claude -p` and OpenRouter — are
  **classified/audited only**, not gated. Real enforcement applies to **managed OpenRouter/Codex
  runs** (Phase 8, off by default) and `/api/runs`; Claude is never gated.
- `server/index.ts` remains an approximately 9.3k-line legacy composition root executed directly by
  Bun and excluded from strict checking. Runtime, provider, agent, route, MCP, and security modules
  have been split out and are strictly type-checked through `tsconfig.server.json`; reducing the
  composition root remains technical debt.

---

## Phases 8–14 security posture

- **Claude stays observe-only.** No phase changes `claude -p` / `spawnClaude` / Claude tool
  handling. Claude tool calls are recorded as `tool_observed` with `enforced:false`; the cockpit
  label helpers are unit-tested to never print "ENFORCED" for an observe-only event.
- **OR gating fails closed.** When `OPENROUTER_GATE_MODE=enforce` and the runtime gate is
  unreachable, gated (execution + unknown) tools are DENIED.
- **Delegation/state-changing tools are GATED (8.2).** `delegate_task`, `board_create_task`,
  `board_update`, `skill_manage`, and `remember` go through the gate (classified terminal/file-write
  → denied or approval-gated) — they can no longer spawn an agent or mutate state outside the gate.
  Pass-through is read-only / introspection only (`board_await`, `board_list`, `use_skill`,
  `index_skills`, `recall_conversation`, `web_search`, `web_extract`).
- **`web_search` / `web_extract` egress decision (8.3 — explicit).** These two are **intentionally
  NOT gated** and pass through even in enforce mode. Rationale: they are **read-only public-research**
  tools that do not mutate the target system or spawn agents. The accepted trade-off is that they
  perform **outbound network egress** that the runtime does not gate. This is a deliberate decision,
  not an oversight. **If your threat model requires egress control** (e.g. exfiltration concerns on a
  sensitive engagement), remove `web_search`/`web_extract` from `_GATE_PASSTHROUGH` in
  `integration/or_gate_client.py` + the orchestrator patch — they then classify as `network` and the
  runtime ToolPolicy gates them (allow by default; flip `enableNetwork` to require approval).
- **Gate approval timeout expires cleanly (8.3).** When the orchestrator stops waiting for an
  approval (`OPENROUTER_GATE_TIMEOUT_SECONDS`), it calls
  `POST /api/runs/:id/tool-calls/:toolCallId/timeout`; the runtime marks the `ApprovalRequest`
  **`expired`** + the `ToolCall` **`rejected`** and emits an `approval_expired` audit event, so a
  timed-out approval **never lingers in the cockpit's pending/action-required queue**.
- **Verified attack lessons are evidence-backed (8.3).** A training lesson cannot become `verified`
  (and thus cannot reach planning) unless it has **both `evidenceIds` AND `sourceRunId`** plus a
  corroborating field — see `docs/TRAINING-MEMORY.md`.
- **Tool gate reuses the runtime policy** — no policy logic is duplicated in Python; the gate is a
  thin wrapper over `requestTool` (real risk classification + approval flow).
- **Memory can never be auto-trusted.** `proposeMemory` is always `unverified`; only an explicit
  operator approval promotes to `verified`; only verified+relevant memory is fed into new runs.
- **Reports/exports redact secrets by default** (api keys, bearer tokens, `password=…`, PEM keys).
- **Artifacts are traversal-safe:** stored + retrieved by a generated `art_…` id only; the retrieval
  endpoint is auth-gated and rejects unsafe ids.
- **No new auth weakening, no new 0.0.0.0 bind, no unsafe no-auth mode.** All new endpoints sit
  behind the existing auth middleware; risky capability is flag-gated off by default.

---

## Phase 15 — specialist army governance

- **ChillsPwn is Commander-in-Chief, not a super-agent.** It commands/routes/supervises/approves/
  synthesizes/learns. `server/agents/AgentRoutingPolicy.ts` is CODE-level enforcement (not prompt-only):
  ChillsPwn direct specialist-tool use is denied (enforce) / audited (default); specialists are confined
  to least-privilege allowlists; classified-domain steps require an assigned specialist; `delegate_task`
  must name a real matching `targetAgentId` and can never bypass the runtime gate.
- **Least privilege:** no all-tools-to-all-agents; every state-changing/high-risk specialist tool is
  approval-gated; MCPs are disabled by default and exposed ONLY via the agent mapping — never to Claude
  globally.
- **Memory:** specialists propose but never approve their own lessons; verified lessons require
  evidenceIds+sourceRunId+corroboration; hypotheses/secrets never injected; failed-attempt lessons are
  shown separately as avoidance guidance.
- **Egress:** OSINT/threat-intel MCPs + `web_search`/`web_extract` are documented public network egress.
- **API keys** (VirusTotal/OTX/Shodan/cloud) are supplied via env TEMPLATES only — never printed or
  stored in memory. The installer is dry-run by default and writes disabled-by-default config.
- **Default posture is AUDIT** (enforcement off) so activation cannot break current orchestration; flip
  to enforce explicitly.

---

## Phase 16 — MCP Arsenal Bridge governance

- **MCPs are NOT attached to Claude.** No `--mcp-config`, no `.claude.json` change, no `spawnClaude`
  change. Claude stays observe-only. MCP execution is wired into the OR/Codex/runtime path only.
- **No global exposure.** Tools reach a specialist ONLY through its allowlist (`agentMcpMap.ts`) + the
  bridge. There is no arbitrary UI execution — only `POST /api/mcp/execute`, which runs the full chain:
  run/step/specialist checks → AgentRoutingPolicy → ToolPolicy/approval gate → MCP health → execute.
- **ChillsPwn cannot direct-call MCP tools** (the routing policy denies it); one specialist cannot run
  another's tools (actor check); state-changing/terminal MCP tools require approval; `delegate_task`
  cannot bypass the MCP gate.
- **Default OFF** (`ENABLE_MCP_ARSENAL=false`, `MCP_ARSENAL_MODE=disabled`). Activate `dry-run` first.
  Docker servers need `MCP_ARSENAL_ALLOW_DOCKER=true` + a built image; OSINT/threat-intel/cloud need
  keys/credentials supplied via env — never stored, never printed. Output is truncated + secret-redacted;
  large output → artifact store.

---

## Phase 16.1 — Mission Board governance
- The specialist Mission Board is **read-only assembly** over runtime docs + MCP health + memory
  counts. It never executes tools, never mutates runs, never enables MCPs, never touches the Claude path.
- ChillsPwn remains the **Commander-in-Chief command card** in the Command lane — not a separate agent;
  its card shows "coordination only — no direct specialist MCPs". Enforcement (direct-tool denial,
  allowlists, delegate_task targetAgentId/domain) is unchanged from Phase 15.1/16.
- Cards expose MCP readiness so an operator sees exactly what is staged vs active vs blocked (needs
  key/Docker/dependency) before any live activation.

---

## Phase 17 — wordlist / hashcat / VulnIntel governance
- **Wordlists + hashcat assets are used by PATH + METADATA only** — contents NEVER enter LLM prompts or
  runtime memory, NEVER committed to the repo (assets live in /opt/chillspwn-assets). Large/breach
  datasets are disabled by default, never auto-downloaded, approval-gated; breach data is authorized
  lab/password-audit only and entries are never printed/stored.
- **Hashcat:** plaintext passwords + hashes are NEVER reusable memory — only redacted evidence; lessons
  describe strategy. Cracking on the GPU host with --potfile-disable; model supplies its own wordlist.
- **VulnIntel is read-only intelligence** — denies all exec/scan/crack tools; never exploits/mutates;
  distinguishes confirmed vs possible; CVE MCPs assigned only to VulnIntel.
- **API keys** are env-name-only in manifests/`/api/mcp/missing-keys` — values never read/stored/printed.
  Cloud creds are required only for cloud-ACCOUNT posture scanning, NOT for cloud-hosted target testing.
