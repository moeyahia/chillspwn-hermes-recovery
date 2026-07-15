---
name: council-of-ais
description: "Summon a council of 6 elite AI hackers (Claude, GPT, GLM, Grok, DeepSeek, Qwen) to independently analyze a pentest engagement and recommend attack vectors when stuck."
version: 1.0.0
author: chillspwn
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [pentest, council, multi-model, strategy, stuck, openrouter]
    related_skills: [kali-arsenal, godmode]
---

# Council of AIs — Multi-Model Attack Council

> When you're stuck, summon 6 elite AI hackers — each powered by a different model — to analyze your engagement and propose attack strategies. They explore the files themselves, find what you missed, and come back with fresh perspectives.

## Two Modes

The council runs in one of two modes:

- **`live` — a real-time roundtable DEBATE (DEFAULT, operator preference).** The 6 models share **one growing conversation**: each takes a turn reading everything said so far and adding the next message — responding by name, challenging weak/already-tried ideas, conceding when wrong, and **chaining** each other's findings — cycling for `--laps` rounds. Then a **chair** model (default Claude Opus) weighs the whole debate and writes the **single final verdict** (`final_verdict.md`) — the one plan to execute next. Every message is streamed live to Telegram and to `council/conversation.md` as it's spoken. This is the default because it makes the council actually *deliberate and decide*, not just vote in parallel. **Omitting `--mode` now runs live.**
- **`independent`** — each of the 6 models writes a **sealed assessment alone**; no model sees another's work. When all finish, *you* read the 6 files and synthesize consensus/unique/contradictions. This is the classic parallel behavior — **pass `--mode independent` explicitly** to use it.

**Run the council (live is default — no `--mode` needed):**
```bash
: "${COUNCIL_SCRIPT:?set the installed council_summon.py path}"
: "${ENGAGEMENT_DIR:?set the authorized engagement directory}"
python3 "$COUNCIL_SCRIPT" \
  --engagement-dir "$ENGAGEMENT_DIR" \
  --briefing "RCE as www-data, stuck on privesc. Tried SUID/sudo/cron/kernel." \
  --laps 3 --timeout 1800
# add `--mode independent` for the classic parallel/sealed-assessment run instead.
```

Live-mode flags: `--laps N` (times each member speaks; default 3 → 18 turns + chair), `--chair <member_id>` (who writes the verdict; default `claude_opus`), `--timeout` is the **per-turn** cap in seconds (a member that stalls past it is skipped for that turn so one bad lane never freezes the debate). Deliverables land in `council/`: `final_verdict.md` (the decision), `conversation.md` (full debate), and each member's last position as `<id>_assessment.md` (back-compat).

**How it stays reliable:** Claude (`claude -p`) and the three OpenRouter lanes use the bounded direct worker. GPT-5.5 and Grok use explicit `openai-codex` and `xai-oauth` Hermes transports so they stay on their subscription/OAuth routes. Every subprocess receives a provider-scoped environment; do not replace the launcher with an ad-hoc `subprocess.Popen` call.

## When to Summon the Council

The council is summoned **ONLY when the user explicitly asks**. You do NOT summon it yourself.

Trigger phrases: "summon the council", "call the council", "need fresh eyes", "council time"

## How to Summon

### Step 1 — Prepare the Briefing

Write a clear, concise briefing of the current situation. Include:
- **Target**: IP, hostname, box name
- **What's known**: Open ports, services, technologies found
- **What's been tried**: Specific tools/attacks run and their results
- **What's blocking**: Why you're stuck, what's not working
- **Engagement directory**: Where all files are stored

### Step 2 — Run the Council Script

```bash
: "${COUNCIL_SCRIPT:?set the installed council_summon.py path}"
: "${ENGAGEMENT_DIR:?set the authorized engagement directory}"
python3 "$COUNCIL_SCRIPT" \
  --engagement-dir "$ENGAGEMENT_DIR" \
  --briefing "We have a shell as www-data on a Ubuntu 22.04 box. Found ports 22,80,3000. Tried SUID, sudo -l, kernel exploits, cron jobs — nothing works. Gitea on port 3000 has internal repos we can't access." \
  --timeout 1800
```

The script will:
- Create a `council/` directory inside the engagement dir
- Spawn 6 Hermes agent instances in parallel, each running a different AI model
- Each agent independently explores the engagement files and writes an assessment
- Progress updates are sent to Telegram as each model finishes
- The script exits when all 6 complete (or timeout)

### Step 3 — Read and Synthesize

After the script completes:

1. Read all assessment files from `<engagement_dir>/council/`:
   - `claude_opus_assessment.md`
   - `deepseek_v4_assessment.md`
   - `qwen_assessment.md`
   - `gpt55_assessment.md`
   - `glm_assessment.md`
   - `grok_assessment.md`

2. **Synthesize the assessments:**
   - Identify **consensus** — what 2+ models agree on (highest confidence)
   - Highlight **unique insights** — ideas only 1 model suggested (worth exploring)
   - Rank all attack vectors by feasibility and impact
   - Note any contradictions between models

3. **Present to the user via Telegram:**
   ```
   send_message(target="telegram", message="🏛️ COUNCIL VERDICT\n\n🥇 Consensus (4/6): SSTI in Jinja2 on port 8080\n🥈 Strong (3/6): Docker socket escape\n🆕 Unique (Grok): Race condition in auth token\n🆕 Unique (Gemini): SSRF via internal API\n\nProceeding with SSTI approach...")
   ```

4. **Proceed** with the top-ranked approach

## Models in the Council

| Model | Provider | Model ID |
|---|---|---|
| Claude Opus 4.8 | `claude-cli` | `claude-opus-4-8` |
| DeepSeek V4 Pro | `openrouter` | `deepseek/deepseek-v4-pro` |
| Qwen 3.7 Max | `openrouter` | `qwen/qwen3.7-max` |
| GPT-5.5 | `openai-codex` | `gpt-5.5` |
| GLM-5.2 | `openrouter` | `z-ai/glm-5.2` |
| Grok 4.3 | `xai-oauth` | `grok-4.20-reasoning` |

Claude Opus uses the logged-in Claude CLI subscription; its lane strips Anthropic API variables to prevent metered fallback. GPT-5.5 uses OpenAI Codex OAuth, and Grok uses xAI OAuth with no OpenRouter fallback. DeepSeek, Qwen, and GLM use only `OPENROUTER_API_KEY`.

**Current connectivity check:** Inspect `scripts/council_summon.py`; it is the source of truth for model, provider, mode, executable validation, and provider-scoped child environments. See `references/current-connectivity-audit.md`.

## Reliability and billing safeguards

- Direct reasoning lanes reserve iterations for a final written assessment and the monitor retries
  failed or stalled workers within a bounded budget.
- Validate a lane by substantive output, not merely process exit code or file existence.
- Treat latency and model reliability as observations from the current run, not permanent model
  characteristics.
- Never change a subscription/OAuth lane to a paid API fallback to improve availability.

### Relaunch boundary

Use the Council launcher and its built-in retry/monitor logic. Do not relaunch a lane with a raw
`hermes chat`, `claude -p`, or `subprocess.Popen` command: those paths bypass provider-scoped
credentials, completion tracking, process-group cleanup, and billing-route safeguards.

### Logs and status

Use the per-lane files in `council/`, the engagement `log/` prompt/response records, and compact
process status. Do not dump full process command lines because they contain large prompts.

### Claude Opus subscription invariant

Claude runs through the authenticated Claude CLI. The launcher strips `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN`, and `ANTHROPIC_TOKEN` from its child, so a subscription lane cannot silently
become a metered Anthropic API call. A missing Claude login fails the lane; do not add an API fallback.

## Step 4 — Dispatch Winner for Execution

After presenting the verdict, execute it only through ChillsPwn's managed delegation/Mission Board
path. Preserve the engagement boundary, stop conditions, progress reporting, and cleanup contract.
Council members are analysts; the verdict is not authority to bypass the commander/delegation
boundary or start an unmanaged provider process.

**WARNING — council analysis can be WRONG**: A strong council majority once predicted that a Server Authentication EKU certificate would map to an LDAP client identity. Live validation instead returned either an unsupported SASL mechanism or an anonymous bind. Server Authentication EKU does not guarantee Schannel client identity mapping. **Always verify council recommendations on the live target before committing to a path.** The council analyzes artifacts and theorizes; it does not test against live infrastructure.

**Operator-agent guardrail**: When dispatching a council member as an execution subagent, make the prompt explicitly forbid already-known dead ends and require it to stop/report rather than improvise if the primary path fails. Include: "If step N fails with X/Y/Z, send status and stop; do NOT pursue fallback paths unless listed here." The orchestrator should verify key outputs directly before declaring success/failure.

## Re-summoning / Re-using the Same Briefing

When the user says "resummon the council with the same info", do **not** ask for a new briefing if the active engagement is inferable. Re-use the newest substantive briefing in the engagement's `council/` directory (for example `briefing_r4.txt`), then first check whether matching `hermes chat` lanes are already running. If they are active, report the active lanes and start/confirm a lightweight monitor instead of spawning duplicate model calls. If they are stale or missing, preserve prior assessment files with `_vN` suffixes and relaunch only what is needed. See `references/resummon-same-briefing-pattern.md`.

Use compact process polling (`ps -p <pids> -o pid,stat,etime,comm --no-headers` plus assessment byte counts). Avoid dumping full command lines because council prompts are huge and can flood the parent context.

## Round 2 — Re-summoning After Failure

When the council's top recommendations fail on the live target, re-summon with updated briefing:

1. **Preserve Round 1 assessments** as `*_v1.md` for reference:
   ```bash
   cd <council_dir>
   for f in *_assessment.md; do mv "$f" "${f%.md}_v1.md"; done
   ```

2. **Write a Round 2 briefing** that includes:
   - Exact error messages from each failed path (e.g., `authMethodNotSupported`, `ReportEventBatchResult=false` with no proof file)
   - Explicit "DEAD ENDS" list including Round 1 recommendations that failed
   - "FRESH ideas only" instruction — tell models to read Round 1 assessments in `council/*_v1.md` to avoid repeating
   - What access/primitives are still available

3. **Re-run through `council_summon.py`** with the updated briefing. The launcher owns provider
   routing, scoped credentials, retry behavior, process groups, and state tracking. Never recreate
   the six subprocesses in `execute_code`.

4. **Feed forward consensus errors** — if 5/6 models agreed on a path and it failed, that's critical context. Models need to know their collective blind spot.

## Important Notes

- DeepSeek, Qwen, and GLM use OpenRouter credits. Claude, GPT-5.5, and Grok use their configured
  subscription/OAuth routes; a missing OAuth login fails that lane instead of falling back to
  another provider.
- Each agent has full **file and terminal access** — they can read any file in the engagement directory.
- Each agent runs with `--yolo` so it doesn't ask for tool approval.
- The council is a **tool, not a crutch**. Use it when genuinely stuck, not as a first resort.
- All council output is saved in the engagement's `council/` directory for the report.

## Pitfalls

- **Use monotonic time for council launchers/timeouts**: virtual-machine wall clocks can jump under hypervisor control, causing wrappers that use wall-clock deltas to expire every lane prematurely. In Python launchers, use `time.monotonic()` for elapsed-time polling and timeout decisions. Treat partial lane files as useful only when they contain substantive output.
- **Avoid stale 10-minute council launches**: Before launching, inspect the actual runner output/log for `Timeout:`. The supported default is 1800s (30 min), but older one-off scripts or copied commands may still pass `--timeout 600`, which terminates slow lanes (DeepSeek/GLM/GPT) at ~10m and leaves `KeyboardInterrupt` traces. If a council exits around 10m, check the run log first; relaunch missing lanes with a 30m ceiling and a tighter write-file prompt.
- **Do not treat an empty successful lane as useful**: Some free/model lanes can exit `rc=0` but produce a zero-byte assessment. Count useful assessments by output file size/content, not process exit status alone.
- **Guard against transient zero-size races during retries**: Assessment files may temporarily appear, shrink to zero, then be rewritten by another agent turn. Poll by final file size after the process exits, not a single intermediate sample. If a launcher process is SIGTERM'd (`exit -15`), distinguish that from the council timeout and inspect child logs before declaring a model failure.
- **Do not treat an empty successful lane as useful**: Some free/model lanes can exit `rc=0` but produce a zero-byte assessment. Count useful assessments by output file size/content, not process exit status alone.

## Pitfalls & Lessons Learned

### Model-specific issues
- Reasoning lanes can spend too long exploring. Keep the briefing evidence-focused and let the
  worker's reserved write phase enforce completion.
- Claude must remain on `claude-cli`; Grok must remain on `xai-oauth`.

### Launcher ownership
- `council_summon.py` owns retries, process-group cleanup, state, and credential scoping.
- Diagnose through its artifacts and relaunch through the same script; never recreate a lane command.

### Multi-round councils
- When running Round 2 after Round 1 paths fail, rename Round 1 assessments to `*_v1.md` and explicitly include failure details in the Round 2 briefing. Models will otherwise suggest the same dead paths.
- Include a "DEAD ENDS — DO NOT SUGGEST" section with exact error messages from failed attempts.

### Subagent delegation issues
- If managed delegation cannot resolve an allowed model, report and fix that routing configuration;
  do not fall back to an unmanaged `hermes chat` process.
- Always include `messaging` in toolsets if you want subagents to report to Telegram.
- **Wait for ALL models** before synthesizing — the operator prefers complete data over partial early results. Relaunch failures rather than settling for 3-4, but report partial status via Telegram while waiting.
- **Relaunch pattern**: Kill stuck/failed models → relaunch individually with tighter prompt + correct provider. Don't ask user which to relaunch — relaunch all failures unless told otherwise.
- **Claude Opus**: keep the `claude-cli` subscription route. Do not add Anthropic API or OpenRouter
  fallbacks.
- **Validate assessment files by size/content, not existence alone**: Some models create placeholder files (e.g. 47 bytes) before later filling them, or exit leaving no useful content. Poll `wc -c council/*_assessment.md`, inspect headings, and only count files with substantive Markdown. Empty logs are not proof of failure; missing/placeholder assessment after the timeout is.
- **Avoid huge `ps` output in polling**: Council prompts can make `ps -o cmd` enormous. Poll compactly with `ps -p <pids> -o pid,stat,etime,comm --no-headers` plus `wc -c *_assessment.md` to avoid flooding the parent context.

## Known issues and fixes

- Long briefings can encourage excessive exploration. Point to the most relevant evidence and state
  known dead ends explicitly.
- An exited process without a substantive assessment is a failed lane; the monitor retries it.
- Elapsed-time checks use `time.monotonic()` so virtual-machine wall-clock changes do not expire
  every lane prematurely.
- A missing or revoked OAuth credential is an authentication failure, not permission to switch
  providers.
- See `references/session-observations.md` for detailed failure modes and token burn data.
- See `references/council-provider-and-consensus-validation.md` for provider-authentication checks, substantive-output counting, live falsification of model consensus, and execution-agent stop conditions.
- See `references/provider-aware-council-routing.md` for the current provider and credential-isolation invariants.
- See `references/council-timeout-troubleshooting.md` for diagnosing councils that appear to terminate early: check `runner*.log` for the actual `--timeout` used by that run before assuming the script default applied.
- See `references/council-ad-artifact-and-machine-workflow-validation.md` for validating AD hypotheses against collected artifacts and recognizing trusted machine workflows when no interactive administrator session exists.

### No direct-launch bypass

All Council starts and retries must pass through `council_summon.py`. This is a security and
billing boundary, not optional monitoring overhead.
