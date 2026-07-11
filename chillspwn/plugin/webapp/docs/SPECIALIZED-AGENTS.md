# ChillsPwn Specialist Agent Army (Phase 15)

ChillsPwn is the **Commander-in-Chief** of a specialist agent army. It is **not** a super-agent.
ChillsPwn **commands, routes, supervises, approves, synthesizes, and learns**; specialists perform
domain work under least-privilege MCP/tool allowlists.

## Mission Board vs Cockpit
- **Mission Board** = the *org chart of the mission*: ChillsPwn's command card + one card per
  specialist, each with status, assigned step, MCP/tool profile, evidence count, pending approvals,
  lesson counts, and handoff target. (`GET /api/agents/mission-board`)
- **Cockpit** = the *control room for one run*: per-step specialist assignment, the specialist memory
  used in planning, proposed/verified/failed-attempt lessons, the MCP/tool surface, approvals, the
  handoff timeline, and *why this agent was selected*.

## ChillsPwn — Commander-in-Chief
ChillsPwn: parses the objective, verifies authorized HTB/lab scope, owns the mission + Mission Board,
creates the AgentRun/PlanSteps, **classifies each task's domain and routes it to the narrowest
capable specialist**, restricts each specialist to its MCP/tool profile, routes handoffs, collects
WorkerResults + evidence, manages approvals through the Cockpit, triggers ReportSmith, and routes
lessons to approval. It does **not** directly perform specialist attack work when a specialist exists.

### Enforcement (prompt + code)
- **Prompt:** `server/agents/personas/chillspwn-commander-soul.md` (appended to the live SOUL on deploy).
- **Code:** `server/agents/AgentRoutingPolicy.ts` — deterministic policy: (1) ChillsPwn cannot directly
  call specialist tools (deny in enforce / audit by default); (2) specialist allowlist enforcement;
  (3) classified-domain steps require an assigned specialist; (4) `delegate_task` must name a real
  `targetAgentId` whose specialty matches the task — it can never bypass the runtime gate.
- **Flags:** `ENABLE_SPECIALIST_AGENT_ROUTING=true`, `ENFORCE_CHILLSPWN_DELEGATION` (default **false**
  = audit), `ALLOW_CHILLSPWN_DIRECT_TOOLS=false`, `REQUIRE_SPECIALIST_ASSIGNMENT` (default false).
  Audit-safe by default so it cannot break current OR orchestration; flip the two to enforce.

## Specialist roster (11)
| Agent | Domain | Persona | Key MCP servers | Approval-required |
|------|--------|---------|-----------------|-------------------|
| ReconScout | reconnaissance | reconscout | sechub-reconnaissance, pentest-mcp-recon | masscan_scan/run_masscan |
| WebBreaker | web | webbreaker | sechub-web-security, sechub-exploitation | ffuf_custom/sqlmap_assess |
| CredSmith | credentials | credsmith | sechub-password-cracking | hashcat_crack |
| ADAttackMapper | active_directory | adattackmapper | sechub-active-directory | bloodhound_collect/ad_enum |
| CloudSentinel | cloud | cloudsentinel | sechub-cloud-security | prowler_scan |
| ReverseSage | reverse_engineering | reversesage | sechub-binary-analysis | binwalk_extract |
| FuzzSmith | fuzzing | fuzzsmith | sechub-fuzzing, sechub-code-security | boofuzz_run_fuzzer/ftp_fuzzer |
| OSINTSeeker | osint | osintseeker | sechub-osint, sechub-threat-intel | (read-only; public egress) |
| SecretHunter | secrets_code | secrethunter | sechub-secrets, sechub-code-security | (scan-only) |
| SessionRunner | persistent_execution | sessionrunner | pentest-mcp-server-ssh | create_session/execute/send_input/upload_file |
| ReportSmith | reporting_memory | reportsmith | chillspwn-reporting | (read-only/local) |

Source of truth: `server/agents/agentRoster.ts`. Mapping/limits: `server/agents/agentMcpMap.ts`.
Personas: `server/agents/personas/<personaId>.md`. **No Commander in the roster** — ChillsPwn is the
commander.

## MCP arsenal
`server/agents/mcpArsenal.manifest.json` (17 server entries from 5 inspected repos; commits pinned).
All MCPs are **disabled by default** and exposed ONLY through the agent mapping — never to Claude
globally. Categorization → 11 domains. `web_search`/`web_extract` and OSINT/threat-intel are
documented **public network egress**.

### Install profiles (dry-run by default)
```
scripts/setup-mcp-arsenal.sh                          # DRY RUN — plan only, no changes
scripts/setup-mcp-arsenal.sh --profile core|web|ad|reverse|cloud|osint|full
scripts/setup-mcp-arsenal.sh --profile full --no-docker
scripts/setup-mcp-arsenal.sh --profile core --health-check    # verify binaries/images/env
scripts/setup-mcp-arsenal.sh --profile core --write-config    # DISABLED-by-default .mcp.arsenal.json (env templates only)
```
Vendor dir `/opt/chillspwn-mcp-arsenal` is **outside** the source tree and is never committed.

## Agent card lifecycle
`idle → assigned → planning → running → awaiting_approval → blocked → completed/failed`, plus
`handoff_requested`. Models: `server/agents/missionBoard.ts` (AgentCard + HandoffRecord).

## Per-agent memory model
Each specialist has a namespace `agent:<id>`. Lessons (`AttackLesson`) carry `agentId`, `scope`
(agent < mission < lab < project < global), `kind` (`attack_lesson` | `failed_attempt`). Specialists
**propose** but **never approve** their own lessons (`canApproveTrainingLessons=false`). Secrets are
rejected/redacted; verified lessons require `evidenceIds` + `sourceRunId` + corroboration (8.3).

### Memory injection hierarchy (specialist planning)
`buildSpecialistPlanningContext(agentId)` injects, in order, each section clearly separated:
1. `VERIFIED GLOBAL TRAINING LESSONS`
2. `VERIFIED PROJECT/LAB LESSONS`
3. `VERIFIED SPECIALIST LESSONS FOR <AGENT>`
4. `RELEVANT FAILED ATTEMPTS / AVOIDANCE LESSONS` (never presented as successes)

NEVER injected: hypotheses, unverified/rejected/stale lessons, target-specific secrets.

### Lesson promotion / cleanup
- Promote: `POST /api/training-memory/lessons/:id/promote-scope` (agent→…→global) — requires verified
  + promotable + a reason. Demote: `…/demote-scope`. Per-agent: `GET /api/training-memory/agents/:id/lessons`.
- Cleanup: `bun scripts/training-memory-cleanup.ts --agent=<id> --scope=<…> --category=<…>` — dry-run
  per-agent summary (hypotheses/raw-notes/verified/failed-attempts/promotion-candidates/secret-bearing).
  Quarantine marks (never deletes); delete needs `--confirm-delete`.

## Handoffs
`{fromAgentId, toAgentId, reason, evidenceIds, sourceStepId, targetStepId}`. Recorded on delegation,
cross-domain moves, and final evidence → ReportSmith. Examples: ReconScout(web ports)→WebBreaker;
WebBreaker(creds)→CredSmith; CredSmith(domain creds)→ADAttackMapper; ADAttackMapper(session)→SessionRunner;
all evidence→ReportSmith.

## Read-only API (Mission Board / Cockpit data)
`GET /api/agents/roster`, `/api/agents/mission-board`, `/api/agents/:id/profile`,
`/api/agents/route?task=…`, `/api/agents/enforcement`, `/api/agents/check-direct-tool?tool=…`.

## How-to
- **Add a specialist:** add an entry to `agentRoster.ts` (+ a manifest MCP if needed), re-run
  `gen-personas.ts`, add routing signals. Tests in `server/agents/__tests__` enforce shape.
- **Add an MCP:** add a server entry to `mcpArsenal.manifest.json` (+ assignedAgents) and reference it
  in the agent's `allowedMcpServers`; keep `enabledByDefault:false`.
- **Disable a risky MCP:** remove it from the agent's `allowedMcpServers` (or set the agent's tool in
  `deniedTools`); it stays out of every prompt.
- **Disable a specialist:** remove it from `agentRoster.ts` (or stop routing to it).
- **Switch enforcement audit→enforce:** set `ENFORCE_CHILLSPWN_DELEGATION=true` (+ optionally
  `REQUIRE_SPECIALIST_ASSIGNMENT=true`) and restart.
- **Verify MCP health:** `scripts/setup-mcp-arsenal.sh --profile <p> --health-check`.

## Phase 16 — MCP tools are now executable
Specialist MCP tools execute through the **MCP Arsenal Bridge** (OR/runtime path, never Claude). See
`docs/MCP-ARSENAL.md`. A specialist calls the single `mcp_execute` tool → the runtime enforces its
allowlist + approvals + MCP health, runs the MCP server over stdio, and records the output as evidence.
Default OFF (`ENABLE_MCP_ARSENAL=false`); activate `dry-run` → `enabled` progressively.

## Phase 16.1 — Specialist Mission Board (lanes, Agent/Task cards, handoffs)
The active **Mission Board** is now a specialist-operations board (`src/pages/MissionBoardPage.tsx`,
view id `missionboard`). The old generic Kanban is kept as **KANBAN (LEGACY)** (its APIs untouched).

**14 lanes (exact order):** Command · Recon · Web · Credentials · AD / Identity · Cloud / Container ·
Reverse / Binary · Fuzzing · OSINT · Secrets / Code · Persistent Sessions · Reporting ·
Blocked / Approval · Complete. (`GET /api/agents/mission-board/lanes`)

**Agent Card** (one per specialist, ChillsPwn command card in Command): status, specialty, current
objective, assigned tools/MCP servers, **MCP health profile**, evidence/approval counts, lesson counts
(proposed/verified/failed-attempt), handoff →/←, Cockpit link. **Task Card** (one per PlanStep): title,
status, risk, **required MCP status**, evidence/approval/handoff refs, Cockpit step link.

**Assignment flow:** ChillsPwn classifies a PlanStep → routes to the narrowest specialist → the step's
`assignedAgent` (or the router as fallback) places a Task Card in that specialist's lane. Blocked /
awaiting-approval tasks mirror to **Blocked / Approval** (original lane preserved); completed tasks
mirror to **Complete**. Unassigned/unroutable classified steps land in Blocked / Approval.

**Mission Board vs Cockpit:** the board is the team operational view (lanes, cards, status, MCP
readiness, handoffs); the **Agent Cockpit** holds the full execution/evidence/approval/report/memory
detail. Card "→ Cockpit" links switch to the Cockpit; the board never duplicates Cockpit detail.

### MCP status meanings (on cards)
`active`/`healthy` (runnable) · `dry-run` (recording only) · `staged` (configured, not enabled) ·
`disabled` (bridge off) · `missing_dependency` (needs binary/image) · `missing_secret` (needs API
key/cred) · `docker_disabled` (needs `MCP_ARSENAL_ALLOW_DOCKER=true` + built image) · `bridge_disabled`
/`bridge_not_active` (no bridge / no assigned servers) · `failed`.

## Phase 17 — VulnIntel + asset intelligence
12th specialist **VulnIntel** (Vulnerability Intel lane, position 4) — read-only CVE/EPSS/KEV/ATT&CK
intelligence, NOT exploitation (see docs/VULNERABILITY-INTEL.md). ReconScout/WebBreaker/CredSmith/
SecretHunter/OSINTSeeker select wordlists and CredSmith selects hashcat strategy by PATH+METADATA only
(docs/WORDLIST-ASSETS.md, docs/HASHCAT-ASSETS.md) — contents never enter prompts/memory. API keys:
docs/MISSING-API-KEYS.md + `GET /api/mcp/missing-keys`.
