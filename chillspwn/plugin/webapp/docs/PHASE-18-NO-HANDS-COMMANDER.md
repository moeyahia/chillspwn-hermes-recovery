# Phase 18 — Hard Delegation Enforcement / ChillsPwn No-Hands Commander

**Goal:** make ChillsPwn a true Commander-in-Chief with **no direct attack-execution capability**. It
plans, routes, supervises, approves, synthesizes. **Specialists execute.**

## The gap this closes

A prior authorized-lab engagement showed that the commander could execute extensively through the
generic terminal/code surface instead of delegating. The reusable finding was architectural, not
target-specific: chat sessions bypassed the managed-run gate, and generic execution tools had been
misclassified as coordination tools.

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
- Ledger validator on the historical engagement: commander direct-execution violations were present (the "before").
  Expected after enforcement on a NEW session: **0**.
- Full test suite **418 pass / 0 fail**; server typecheck clean. Health 200, chat + Mission Board OK.

## Limitations
- **Part 4 (HTB → managed mode)** is enforced via the no-hands rule (the commander cannot execute in
  chat OR managed regardless), plus a deterministic `isManagedMissionPrompt()` detector. Automatic
  AgentRun/PlanStep creation from a chat HTB prompt is **not** auto-wired (deferred — the safety goal
  is already met by no-hands).
- Only Mission Board operations and read-only context/skill lookup remain coordination-safe.
  File mutations, private delegation, research execution, and memory/skill writes are denied.
- Specialists other than SessionRunner do not yet own raw `terminal` in their allowlists; cross-domain
  shell work routes to SessionRunner. Extend per-specialist allowlists as needed.

## Orchestrator recovery packaging

The chat-path implementation is retained directly by the outer recovery repository at
`hermes/runtime/skills/red-teaming/council-of-ais/scripts/orchestrator_openrouter.py`. The restore
script installs that reviewed source exactly; there is no secondary patch artifact to drift or apply.

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

For a full historical revert, restore a previously reviewed private recovery tag and run the
documented exact-sync restore. Do not reverse individual enforcement files in place.
