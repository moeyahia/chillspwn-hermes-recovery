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
python3 <skills>/council-of-ais/scripts/council_summon.py \
  --engagement-dir /root/htb/boxes/<box>/ \
  --briefing "RCE as www-data, stuck on privesc. Tried SUID/sudo/cron/kernel." \
  --laps 3 --timeout 1800
# add `--mode independent` for the classic parallel/sealed-assessment run instead.
```

Live-mode flags: `--laps N` (times each member speaks; default 3 → 18 turns + chair), `--chair <member_id>` (who writes the verdict; default `claude_opus`), `--timeout` is the **per-turn** cap in seconds (a member that stalls past it is skipped for that turn so one bad lane never freezes the debate). Deliverables land in `council/`: `final_verdict.md` (the decision), `conversation.md` (full debate), and each member's last position as `<id>_assessment.md` (back-compat).

**How it stays reliable:** direct lanes (Claude via `claude -p`, DeepSeek, Qwen, GLM, Grok) run in-process via the same non-streaming agentic loop the classic council uses (immune to the mid-stream stall); the remaining OAuth lane (GPT-5.5) gets one `hermes chat` per turn to keep riding its subscription. Turns are sequential (that's what makes it a live conversation), so live mode costs ~`laps × 6 + 1` model calls and takes longer than the parallel independent mode — budget for it.

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
python3 /root/.hermes/skills/red-teaming/council-of-ais/scripts/council_summon.py \
  --engagement-dir /root/htb/boxes/<box_name>/ \
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
   - `nemotron_assessment.md`
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
| Claude Opus 4.7 | `anthropic` | `claude-opus-4-7` |
| DeepSeek V4 Pro | `openrouter` | `deepseek/deepseek-v4-pro` |
| Nemotron 3 Super (free) | `openrouter` | `nvidia/nemotron-3-super-120b-a12b:free` |
| GPT-5.5 | `openai-codex` | `gpt-5.5` |
| GLM-5.1 | `openrouter` | `z-ai/glm-5.1` |
| Grok 4.3 | `xai-oauth` | `grok-4.20-reasoning` |

Claude Opus uses the direct Anthropic provider with `ANTHROPIC_API_KEY` in `~/.hermes/.env`. GPT-5.5 uses OpenAI Codex OAuth via the `openai-codex` provider. Grok uses xAI OAuth via the `xai-oauth` provider. DeepSeek, Qwen, and GLM-5.1 use OpenRouter with `OPENROUTER_API_KEY`.

**Current-vs-preferred connectivity check:** When the user asks how the council is currently configured, inspect `scripts/council_summon.py` directly. The script is the source of truth for actual first-pass routing. Current launcher behavior: each council member carries its own `provider` field; Claude Opus is launched with `--provider anthropic --model claude-opus-4-7`, GPT-5.5 is launched with `--provider openai-codex --model gpt-5.5`, Grok is launched with `--provider xai-oauth --model grok-4.20-reasoning`, and DeepSeek/Qwen/GLM-5.1 launch with `--provider openrouter`. See `references/provider-aware-council-routing.md` for the durable implementation and dry-run verification pattern.

## Known Issues & Pitfalls

### Model Reliability (observed May 2026)

| Model | Reliability | Notes |
|---|---|---|
| Grok 4.3 | ⭐ Fastest (1-2 min) | Concise, action-oriented |
| GPT-5.5 | ⭐ Most thorough (19KB+) | Takes 4-5 min but delivers deep analysis |
| GLM-5.1 | 🆕 Not yet profiled | Newly added lane (replaced Gemini) — observe first run for latency/output quality |
| Claude Opus 4.7 | ⚠️ Often fails via OpenRouter | Gets 502 Bad Gateway from Anthropic API proxied through OR. Process goes zombie. |
| DeepSeek V4 Pro | ⚠️ Gets stuck in tool loops | Reads files endlessly (30+ API calls) without writing assessment. Needs tight prompt. |
| Nemotron 3 Super | ⚠️ Gets stuck in tool loops | Same loop problem as DeepSeek. Free tier may have rate limits. |

**First-run yield: expect 3-4 out of 6 to deliver.** DeepSeek/Nemotron loop and Opus 502s on first attempt. After manual relaunch with tighter prompts + Opus on `--provider anthropic`, all 6 can deliver (6/6 achieved May 2026). Always relaunch failures — don't settle for partial results.

### Anti-Loop Prompt (CRITICAL for DeepSeek/Nemotron)

The council_summon.py script's default prompt is too open-ended for weaker models. When relaunching failed models manually, use this tighter prompt structure:

```
IMPORTANT: Do NOT loop forever reading files. Read the key files, think, then WRITE YOUR ASSESSMENT. You have 10 minutes max. Your ONLY deliverable is the assessment file.
```

This single line at the end of the prompt prevents the infinite tool-call loop.

### Manual Relaunch Pattern

When models fail or loop, kill them and relaunch individually:

```bash
# Kill stuck process
kill -9 <PID>

# Relaunch with tighter prompt
hermes chat \
  -q "<briefing with explicit file paths to read and anti-loop instruction>" \
  --model <model_id> \
  --provider openrouter \
  -t file,terminal \
  --yolo \
  -Q 2>&1 | tee <council_dir>/<model>_log_v2.txt
```

### Log Files Are Often Empty

The council script redirects stdout to log files, but hermes writes internally to `~/.hermes/logs/agent.log`. To debug stuck models:
- Check `~/.hermes/logs/agent.log` and grep for the model name
- Check `~/.hermes/logs/errors.log` for API failures
- Look at `/proc/<PID>/status` to see if process is alive vs zombie

### Claude Opus — Always Use Direct Anthropic API

Claude Opus consistently 502s via OpenRouter. **Never** route it through OpenRouter. Always relaunch manually:

```bash
hermes chat \
  -q "<briefing>" \
  --model claude-opus-4-7 \
  --provider anthropic \
  -t file,terminal \
  --yolo -Q 2>&1 | tee <council_dir>/claude_opus_log_v2.txt
```

This bypasses the OpenRouter proxy entirely and uses the direct Anthropic API key.

## Step 4 — Dispatch Winner for Execution

After synthesizing and presenting the verdict, the user may ask you to execute the #1 path. The preferred pattern is to **dispatch a council member as an operator agent** via `hermes chat` in background:

```bash
hermes chat \
  -q "<detailed step-by-step execution plan with exact commands>" \
  --model deepseek/deepseek-v4-pro \
  --provider openrouter \
  -t file,terminal,messaging \
  --yolo \
  -Q 2>&1 | tee <council_dir>/deepseek_execution_log.txt
```

**Key points:**
- Include `messaging` in `-t` toolsets so the agent can send Telegram updates
- Include explicit `send_message(target='telegram:Mr. Wong', message='...')` instructions in the prompt
- Give the agent the FULL attack plan with exact file paths, credentials, and fallback steps
- Run in background with `notify_on_complete=true` so the orchestrator gets notified

**WARNING — delegate_task DOES NOT WORK for this**: The subagent model routing uses `gpt-4.1` by default, which fails on OpenAI Codex accounts with: `Error code: 400 - The 'gpt-4.1' model is not supported when using Codex with a ChatGPT account.` This applies to both council analysis AND execution dispatch. Always launch via `hermes chat` directly as shown above — this is the only reliable pattern.

**WARNING — council analysis can be WRONG**: In the May 2026 Logging engagement, 5/6 council members agreed that Schannel LDAPS with a Server Auth EKU cert would work for LDAP client authentication. It did not — the DC returned `authMethodNotSupported` for SASL EXTERNAL and anonymous binds for passthecert.py. Server Auth EKU does NOT guarantee Schannel client identity mapping on all DCs. **Always verify council recommendations on the live target before committing to a path.** The council analyzes files and theorizes — it does not test against live infrastructure.

**Operator-agent guardrail**: When dispatching a council member as an execution subagent, make the prompt explicitly forbid already-known dead ends and require it to stop/report rather than improvise if the primary path fails. In Logging, an operator agent drifted from the requested Schannel path into already-debunked certreq/DLL/WSUS ideas. Include: "If step N fails with X/Y/Z, send Telegram status and stop; do NOT pursue fallback paths unless listed here." The orchestrator should verify key outputs directly before declaring success/failure.

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

3. **Launch all 6 directly via execute_code** instead of the council_summon.py script (faster, more reliable, skip the monitoring overhead):
   ```python
   import subprocess, os
   for model_id, model_name, provider in MODELS:
       cmd = ["hermes", "chat", "-q", prompt, "--model", model_name,
              "--provider", provider, "-t", "file,terminal", "--yolo", "-Q"]
       proc = subprocess.Popen(cmd, stdout=log_file, stderr=subprocess.STDOUT,
                               cwd=engagement_dir, env={**os.environ, "PAGER": "cat"})
   ```
   Then poll for assessment files with `ls -la council/*_assessment.md`.

4. **Feed forward consensus errors** — if 5/6 models agreed on a path and it failed, that's critical context. Models need to know their collective blind spot.

## Important Notes

- The council runs on **your OpenRouter credits**. Nemotron is free; the others cost per token.
- Each agent has full **file and terminal access** — they can read any file in the engagement directory.
- Each agent runs with `--yolo` so it doesn't ask for tool approval.
- The council is a **tool, not a crutch**. Use it when genuinely stuck, not as a first resort.
- All council output is saved in the engagement's `council/` directory for the report.

## Pitfalls

- **Use monotonic time for council launchers/timeouts**: HTB/Kali VM wall clocks can jump under hypervisor control, causing wrapper scripts that use `time.time()`/`date` deltas to think 10k+ seconds elapsed and kill every lane prematurely. In Python launchers, use `time.monotonic()` for elapsed-time polling and timeout decisions. Treat partial lane files as useful if they exceed a substantive byte threshold, then synthesize from completed lanes instead of restarting indefinitely.
- **Avoid stale 10-minute council launches**: Before launching, inspect the actual runner output/log for `Timeout:`. The supported default is 1800s (30 min), but older one-off scripts or copied commands may still pass `--timeout 600`, which terminates slow lanes (DeepSeek/GLM/GPT) at ~10m and leaves `KeyboardInterrupt` traces. If a council exits around 10m, check the run log first; relaunch missing lanes with a 30m ceiling and a tighter write-file prompt.
- **Do not treat an empty successful lane as useful**: Some free/model lanes can exit `rc=0` but produce a zero-byte assessment. Count useful assessments by output file size/content, not process exit status alone.
- **Guard against transient zero-size races during retries**: Assessment files may temporarily appear, shrink to zero, then be rewritten by another agent turn. Poll by final file size after the process exits, not a single intermediate sample. If a launcher process is SIGTERM'd (`exit -15`), distinguish that from the council timeout and inspect child logs before declaring a model failure.
- **Do not treat an empty successful lane as useful**: Some free/model lanes can exit `rc=0` but produce a zero-byte assessment. Count useful assessments by output file size/content, not process exit status alone.

## Pitfalls & Lessons Learned

### Model-specific issues
- **Nemotron 3 Super** and **DeepSeek V4 Pro** frequently get stuck in infinite tool-call loops — reading files endlessly without writing the assessment. Always add explicit instructions: "Do NOT loop forever reading files. Read the key files, think, then WRITE YOUR ASSESSMENT. You have 10 minutes max. Your ONLY deliverable is the assessment file."
- **Claude Opus via OpenRouter** may hit 502 Bad Gateway errors. Launch it via **Anthropic direct** (`--provider anthropic`) instead of OpenRouter to avoid this.
- Tighter prompts with explicit deadlines ("WRITE WITHIN 5 MINUTES") dramatically improve delivery rate for weaker models.

### Script vs direct launch
- The `council_summon.py` script captures stdout to log files, but hermes writes internally — log files appear empty even while agents are working. Check `~/.hermes/logs/agent.log` for actual API call activity.
- For failed/stuck agents, it's faster to kill and relaunch individually via `hermes chat` with tighter prompts than to rerun the full council script.

### Multi-round councils
- When running Round 2 after Round 1 paths fail, rename Round 1 assessments to `*_v1.md` and explicitly include failure details in the Round 2 briefing. Models will otherwise suggest the same dead paths.
- Include a "DEAD ENDS — DO NOT SUGGEST" section with exact error messages from failed attempts.

### Subagent delegation issues
- `delegate_task` may fail if the default subagent model isn't available (e.g., "gpt-4.1 not supported on Codex"). Fall back to launching `hermes chat` directly as a background process with `--model` and `--provider` flags.
- Always include `messaging` in toolsets if you want subagents to report to Telegram.
- **Wait for ALL models** before synthesizing — Mr. Wong prefers complete data over partial early results. Relaunch failures rather than settling for 3-4, but report partial status via Telegram while waiting.
- **Relaunch pattern**: Kill stuck/failed models → relaunch individually with tighter prompt + correct provider. Don't ask user which to relaunch — relaunch all failures unless told otherwise.
- **Claude Opus**: Prefer `--provider anthropic` (direct API) because OpenRouter often 502s. If direct Anthropic returns a quota/usage exhaustion error, relaunch the Claude lane via OpenRouter as a fallback, but verify an assessment file is actually written; the fallback can exit cleanly with only a `session_id` and no deliverable.
- **Validate assessment files by size/content, not existence alone**: Some models create placeholder files (e.g. 47 bytes) before later filling them, or exit leaving no useful content. Poll `wc -c council/*_assessment.md`, inspect headings, and only count files with substantive Markdown. Empty logs are not proof of failure; missing/placeholder assessment after the timeout is.
- **Avoid huge `ps` output in polling**: Council prompts can make `ps -o cmd` enormous. Poll compactly with `ps -p <pids> -o pid,stat,etime,comm --no-headers` plus `wc -c *_assessment.md` to avoid flooding the parent context.

## Known Issues & Fixes

- **DeepSeek/Nemotron loop forever** with long briefings. Fix: use shorter, tighter prompts with explicit "Do NOT loop forever reading files. Write your assessment. 10 minutes max." instruction. Also list specific files to read (5-8 max) instead of "explore the directory."
- **Claude Opus via OpenRouter** hits 502 Bad Gateway consistently. Fix: launch Opus with `--provider anthropic` using the direct API key. This is not intermittent — always use direct Anthropic for Opus.
- **Empty log files** are normal — hermes writes to internal logs, not stdout. Check `~/.hermes/logs/agent.log` and grep by model name to confirm activity.
- **Zombie processes** (`<defunct>`) indicate the hermes child exited but the council_summon.py parent hasn't reaped it — harmless but confusing in `ps` output.
- **VM wall-clock jumps can kill every lane early** if a custom launcher uses `time.time()` for elapsed-time checks. Use `time.monotonic()` for council polling/timeout loops, especially on Kali/VMs where the hypervisor can jump the clock. If this happens, clean up orphaned `hermes chat` processes from the failed run before relaunching.
- **Expect to relaunch 2-3 models manually** on every council run. The script's first pass delivers 3-4; manual relaunch with tighter prompts gets the rest.
- **Nemotron has a distinct failure mode**: unlike DeepSeek (which loops on tool calls), Nemotron often dies mid-thought — it thinks about what to do but never writes the assessment file. The process exits cleanly (exit code 0) with an empty or missing assessment. The anti-loop prompt helps but doesn't fully fix this. Use even stricter deadlines: "YOU MUST WRITE THE FILE WITHIN 5 MINUTES. Stop reading and WRITE after 3 minutes max."
- See `references/session-observations.md` for detailed failure modes and token burn data.
- See `references/logging-round3-council-observations.md` for a concrete Round 3 run where Claude quota exhaustion, OpenRouter fallback with no deliverable, Nemotron stall, Gemini placeholder-file behavior, and compact polling practices were observed.
- See `references/logging-round4-council-observations.md` for the API-key-vs-OAuth Claude verification pattern: check that `ANTHROPIC_API_KEY` is non-empty before promising direct API-key Claude, use `--ignore-user-config --ignore-rules`, and count only substantive assessment files.
- See `references/provider-aware-council-routing.md` for the current provider-routing invariant: Claude Opus uses direct Anthropic, GPT-5.5 uses OpenAI Codex OAuth, and the remaining lanes use OpenRouter.
- See `references/council-timeout-troubleshooting.md` for diagnosing councils that appear to terminate early: check `runner*.log` for the actual `--timeout` used by that run before assuming the script default applied.
- See `references/anthropic-api-key-council-auth.md` for the verified procedure to force the Claude council lane to use a manual Anthropic API key from Hermes credential pool instead of Claude/Anthropic OAuth.
- See `references/logging-svc-recovery-council-2026-05-26.md` for a concrete svc_recovery-focused Logging council: validate council theories against local BloodHound/certipy artifacts before reporting, consider GenericWrite-to-intermediary-account UPN/ESC10 paths, and use `time.monotonic()` in direct launchers to avoid VM wall-clock jump killing all lanes prematurely.
- See `references/logging-wsus-adminsession-council-2026-05-26.md` for the WSUS/Admin-session lesson: the missing "admin session" may be a trusted machine/service workflow. In Logging, ADCS cert + DNS control made the DC's Windows Update client pull from rogue WSUS and execute as SYSTEM; avoid over-focusing councils on inert reporting APIs.

### Direct Python Launch (Faster Than council_summon.py)

For Round 2+ runs or when the script's monitoring overhead is unwanted, launch all 6 directly via `execute_code`:

```python
import subprocess, os
from pathlib import Path

MODELS = [
    ("claude_opus",  "claude-opus-4-7",                        "anthropic"),
    ("gpt55",        "gpt-5.5",                                "openai-codex"),
    ("deepseek_v4",  "deepseek/deepseek-v4-pro",              "openrouter"),
    ("grok",         "grok-4.20-reasoning",                    "xai-oauth"),
    ("glm",          "z-ai/glm-5.1",                           "openrouter"),
    ("nemotron",     "nvidia/nemotron-3-super-120b-a12b:free", "openrouter"),
]

for model_id, model_name, provider in MODELS:
    log_file = open(council_dir / f"{model_id}_log.txt", "w")
    cmd = ["hermes", "chat", "-q", prompt, "--model", model_name,
           "--provider", provider, "-t", "file,terminal", "--yolo", "-Q"]
    subprocess.Popen(cmd, stdout=log_file, stderr=subprocess.STDOUT,
                     cwd=str(engagement_dir), env={**os.environ, "PAGER": "cat"})
```

Then poll for assessment files: `ls -la council/*_assessment.md`

This is faster, more reliable, and avoids the Telegram monitoring thread in the script.
