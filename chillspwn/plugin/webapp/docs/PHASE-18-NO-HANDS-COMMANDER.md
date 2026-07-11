# Phase 18 — Hard Delegation Enforcement / ChillsPwn No-Hands Commander

**Goal:** make ChillsPwn a true Commander-in-Chief with **no direct attack-execution capability**. It
plans, routes, supervises, approves, synthesizes. **Specialists execute.**

## The gap this closes
The PingPong HTB session (`s-1780414494347`, persona ChillsPwn) ran attacks directly instead of
delegating — measured from its own ledger:

| | count |
|---|---|
| `terminal` (direct) | 418 |
| `execute_code` (direct) | 367 |
| `process` (direct) | 43 |
| **direct execution total** | **828** |
| delegations (`delegate_task` + `board_create_task`) | 63 |
| ratio delegations : direct | **0.076** |

Root causes: (1) **chat sessions bypass the managed-run gate** (the gate needs a run); (2)
`terminal`/`execute_code` were classified as "commander coordination tools" and slipped through; (3)
the SOUL said *delegate* but code still allowed direct execution.

## What changed
| File | Change |
|------|--------|
| `server/agents/ChillspwnCommanderPolicy.ts` (new) | Deterministic no-hands policy. Commander may NOT run `terminal`/`execute_code`/`process`/`mcp_execute` or any specialist tool. `recommendSpecialist()` names the specialist to route to. `isManagedMissionPrompt()` detects HTB/lab missions. Coordination tools always allowed. |
| `server/agents/agentRoster.ts` | `GENERIC_TOOLS` excluded from `isSpecialistTool`/`agentsForTool` (so shared tools like `read_file`/`search_files` aren't mistaken for specialist tools and don't block the commander's own coordination surface). SessionRunner gains `terminal`/`execute_code`/`process` (the execution specialist; approval-gated). |
| `server/routes/gateRoutes.ts` | Managed-run gate now runs the no-hands check for the commander **before** the legacy specialist-name check → denies the execution surface + returns `recommendedSpecialist`. |
| `…/council-of-ais/scripts/orchestrator_openrouter.py` | **Chat-path enforcement** (the real gap): strips the exec tools from the commander's tool list for the turn, injects the no-hands directive, and hard-denies in dispatch (belt-and-suspenders for text-parsed tool calls) with specialist routing + a status event. Specialist personas are unaffected. |
| `server/security/config.ts`, `server/index.ts` | `enforceChillspwnNoHands` flag (env `ENFORCE_CHILLSPWN_NO_HANDS`, default **true**) wired through SECURITY, all routing-config builders, and the `spawnOpenRouter` env. |
| `/root/.hermes/SOUL.md` (live) + `server/agents/personas/chillspwn-commander-soul.md` | "Commander-in-Chief — No Hands" hard-rule section. |
| `scripts/analyze-session-ledger.ts` (new) | Ledger validator: direct-exec by actor, delegations, commander violations + recommended specialists, verdict. |
| `server/agents/__tests__/ChillspwnCommanderPolicy.test.ts` (new) | 22 tests covering all 17 spec cases. |

## Specialist routing map (Part 6)
nmap/masscan/discovery → **ReconScout** · ffuf/gobuster/nikto/nuclei/sqlmap/web → **WebBreaker** ·
hashcat/john/hydra/wordlists → **CredSmith** ·
certipy/impacket/nxc/kerberos/ldap/bloodhound/roadrecon/WinRM/ADCS/gMSA/DCSync → **ADAttackMapper** ·
shell/tmux/ssh/socks/pivot/long-running → **SessionRunner** · gitleaks/semgrep/secrets → **SecretHunter**
· CVE/NVD/EPSS/KEV/version → **VulnIntel** · final report/evidence → **ReportSmith**.

## Approval-mode interaction (Part 7)
The no-hands rule is a **hard DENY**, not an approval gate. It resolves to `deny` before any approval
step — so `APPROVAL_MODE=auto` has nothing to grant and **cannot** let the commander bypass specialists.
Specialist actions that pass policy can still auto-approve.

## Verification (live, post-deploy)
- `GET /api/agents/enforcement` → `enforceChillspwnNoHands: true`, mode `ENFORCE`.
- `GET /api/agents/check-direct-tool?tool=terminal&command=nmap…` → `noHands.action=deny → ReconScout`;
  `certipy → ADAttackMapper`; `hashcat → CredSmith`; `execute_code → SessionRunner`;
  `board_create_task`/`read_file`/`write_file` → `allow`.
- Orchestrator module under commander env: `_NO_HANDS_ACTIVE=True`,
  `_COMMANDER_BLOCK={terminal,execute_code,process,mcp_execute}`; under a specialist persona or with the
  flag off → `False`.
- Ledger validator on the Pong session: **828 commander direct-execution violations** (the "before").
  Expected after enforcement on a NEW session: **0**.
- Full test suite **418 pass / 0 fail**; server typecheck clean. Health 200, chat + Mission Board OK.

## Limitations
- **Part 4 (HTB → managed mode)** is enforced via the no-hands rule (the commander cannot execute in
  chat OR managed regardless), plus a deterministic `isManagedMissionPrompt()` detector. Automatic
  AgentRun/PlanStep creation from a chat HTB prompt is **not** auto-wired (deferred — the safety goal
  is already met by no-hands).
- `write_file`/`patch`/`read_file`/`search_files` remain available to the commander as
  **coordination-safe** (plans, synthesis, reports). They cannot launch an attack once the four
  execution tools are blocked. Tighten via `COMMANDER_BLOCKED_EXEC_TOOLS` if you want them blocked too.
- Specialists other than SessionRunner do not yet own raw `terminal` in their allowlists; cross-domain
  shell work routes to SessionRunner. Extend per-specialist allowlists as needed.

## Orchestrator patch (Phase 18.1 — release packaging)
The **chat-path enforcement** lives in the OpenRouter/Codex orchestrator, which is **outside this repo**:
`~/.hermes/skills/red-teaming/council-of-ais/scripts/orchestrator_openrouter.py`. To make Phase 18
reproducible, that change is captured as a patch artifact **inside the repo**:

`integration/phase18-no-hands-orchestrator.patch`  — purely additive (89 lines, 0 removed).

**Why it exists:** without it, a fresh checkout would deploy the TypeScript gate (managed-run
enforcement) but NOT the orchestrator change (chat-session enforcement) — the exact gap Phase 18
fixed. The patch re-creates the chat-path enforcement on any clean orchestrator.

**Where to apply:** the live orchestrator script directory:
```
cd ~/.hermes/skills/red-teaming/council-of-ais/scripts
```
**Dry-run / apply / reverse / verify** (exact commands, all verified):
```
# 0. back up first (rollback reference)
cp orchestrator_openrouter.py orchestrator_openrouter.py.pre-phase18.bak

# 1. dry-run (no changes made)
patch -p1 --dry-run < /path/to/webapp/integration/phase18-no-hands-orchestrator.patch

# 2. apply
patch -p1 < /path/to/webapp/integration/phase18-no-hands-orchestrator.patch

# 3. verify it compiles + the no-hands symbols are present
python3 -m py_compile orchestrator_openrouter.py
grep -c '_NO_HANDS_ACTIVE\|_COMMANDER_BLOCK\|_recommend_specialist\|_no_hands_denial' orchestrator_openrouter.py   # → nonzero

# 4. reverse (emergency rollback)
patch -R -p1 < /path/to/webapp/integration/phase18-no-hands-orchestrator.patch
```
No service restart is needed for the orchestrator change — it is spawned fresh per chat turn, so the
patch takes effect on the next turn. (The TypeScript gate/config change DID require the one restart
already done at deploy.)

**Confirm `ENFORCE_CHILLSPWN_NO_HANDS` is active (live):**
```
grep ENFORCE_CHILLSPWN_NO_HANDS /root/.hermes/.env                 # → ENFORCE_CHILLSPWN_NO_HANDS=true
curl -s -H "Authorization: Bearer $DASHBOARD_TOKEN" \
  http://127.0.0.1:3131/api/agents/enforcement | grep -o '"enforceChillspwnNoHands":[a-z]*'   # → true
# safe no-op decision check (no command is executed):
curl -s -H "Authorization: Bearer $DASHBOARD_TOKEN" \
  "http://127.0.0.1:3131/api/agents/check-direct-tool?tool=terminal&command=nmap" # → noHands.action=deny → ReconScout
```

## Rollback
**Emergency (flag only — fastest, keeps the code in place):**
1. `ENFORCE_CHILLSPWN_NO_HANDS=false` in `/root/.hermes/.env` → `systemctl restart chillspwn.service`.
   Gate + orchestrator both become inert for no-hands; the commander can execute again. **Use this ONLY
   as an emergency rollback** — the default and intended state is `true`.

**Full revert:**
2. Reverse the orchestrator patch:
   `cd ~/.hermes/skills/red-teaming/council-of-ais/scripts && patch -R -p1 < <webapp>/integration/phase18-no-hands-orchestrator.patch`
   (or `cp orchestrator_openrouter.py.pre-phase18.bak orchestrator_openrouter.py`).
3. Restore SOUL: `cp /root/.claude/chillspwn/personas/chillspwn/SOUL.md.pre-phase18.bak /root/.hermes/SOUL.md`.
4. Restore env: `cp /root/.hermes/.env.pre-phase18.bak /root/.hermes/.env`.
5. `git checkout <pre-Phase-18 commit>` for the webapp code; `systemctl restart chillspwn.service`.

The frozen Claude path is untouched in every case.
