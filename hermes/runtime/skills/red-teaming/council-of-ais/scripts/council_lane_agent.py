#!/usr/bin/env python3
"""
council_lane_agent.py — our own non-streaming agentic council lane.

WE are the runtime: we advertise Hermes' REAL tools (reused via council_tools —
no Hermes agent/gateway, so nothing to stall), the model CHOOSES which tool to
call, we execute the real handler and append the result, and we loop until the
model returns its final assessment — which we write to the output file.

Non-streaming on purpose: the "stream stalled mid tool-call" failure is a
streaming artifact; one-shot responses per turn make it impossible.

Providers (direct, non-streaming):
  --provider openrouter : OpenAI tool format     (GLM/DeepSeek/Qwen, OpenRouter creds)
  --provider anthropic  : legacy Anthropic API tool_use/tool_result (ANTHROPIC_API_KEY)

Spawned exactly like the hermes lanes by council_summon.py, so the existing
monitor/retry/Telegram machinery works unchanged (exit 0 with a written
assessment, non-zero → orchestrator relaunches).
"""
import argparse
import functools
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import council_tools as ct  # noqa: E402  (reuses Hermes' real tool handlers)

MAX_ITERS = 16
# Reserve budget: stop exploring and FORCE the written assessment well before the hard iteration
# cap. Verbose reasoning lanes (DeepSeek V4 Pro, GLM-5.1) used to burn all 16 iters on tool calls
# and only write on the very last turn — by then DeepSeek truncated at the token cap and GLM
# returned empty. Forcing the prose answer at iter 10 leaves them iteration + token headroom to write.
FORCE_WRITE_AT = 10
# Reasoning models spend a large share of OUTPUT tokens on hidden chain-of-thought, so 12k made
# DeepSeek hit finish=length mid-assessment (truncated -> empty/short -> failed). 32k gives the
# assessment real headroom; safe for every council lane incl. Claude Opus.
MAX_TOKENS = 32_000
HTTP_TIMEOUT = 300
TOOL_RESULT_CAP = 24_000
# claude-cli lane: `claude -p` runs on the operator's SUBSCRIPTION (not metered API).
CLAUDE_CLI_TIMEOUT = 900
# By default the lane investigates LIVE with Claude Code's own Bash/Read/Grep/Glob tools
# (bypassPermissions). Set COUNCIL_CLAUDE_LIVE_TOOLS=0 to fall back to the tool-less
# "pre-feed the evidence into the prompt" mode (below constants govern that fallback).
CLAUDE_LIVE_TOOLS = os.environ.get("COUNCIL_CLAUDE_LIVE_TOOLS", "1") != "0"
# Permission-bypass is refused under root, so when the council runs as root the lane
# drops to this non-root service user (which owns the subscription creds). Production
# already runs as this user, so the drop is skipped there.
CHILLSPWN_USER = os.environ.get("COUNCIL_CLAUDE_USER", "").strip()
CHILLSPWN_HOME = os.environ.get("COUNCIL_CLAUDE_HOME", "").strip()
# Tool-less fallback: pre-feed at most this many chars of engagement evidence.
CLAUDE_CTX_BUDGET = 180_000
CLAUDE_CTX_PER_FILE = 24_000


# ── GLM / text-format tool-call parsing ────────────────────────────────────
# GLM-5.1 (z-ai) over OpenRouter often emits its tool calls as TEXT markup in the message CONTENT
# instead of the structured `tool_calls` field, e.g.:
#   <tool_call>execute_code<arg_key>code</arg_key><arg_value>...</arg_value></tool_call>
# The loop only read structured tool_calls, so these leaked verbatim into the lane's final
# assessment (a tool-call blob instead of analysis). Parse them so they are EXECUTED instead.
_GLM_TOOL_CALL = re.compile(r"<tool_call>\s*(?P<name>[A-Za-z0-9_.\-]+)(?P<body>.*?)</tool_call>", re.DOTALL)
_GLM_ARG = re.compile(r"<arg_key>(?P<k>.*?)</arg_key>\s*<arg_value>(?P<v>.*?)</arg_value>", re.DOTALL)


def parse_glm_text_tool_calls(text):
    """Extract GLM-style text tool calls → [{name, input}]. Only returns calls whose name is a REAL
    registered tool, so prose that merely mentions <tool_call> isn't executed."""
    valid = {e.name for e in ct.all_entries()}
    calls = []
    for m in _GLM_TOOL_CALL.finditer(text or ""):
        name = (m.group("name") or "").strip()
        if name not in valid:
            continue
        args = {}
        for am in _GLM_ARG.finditer(m.group("body") or ""):
            k = (am.group("k") or "").strip()
            vs = (am.group("v") or "").strip()
            try:
                args[k] = json.loads(vs)   # numbers / quoted strings / json values
            except Exception:
                args[k] = vs               # raw (code, plain strings)
        calls.append({"name": name, "input": args})
    return calls


def strip_glm_tool_markup(text):
    """Drop any residual <tool_call>...</tool_call> blocks so stray markup never lands in the
    final assessment text."""
    return _GLM_TOOL_CALL.sub("", text or "").strip()


# ── DeepSeek / DSML text-format tool-call parsing ──────────────────────────
# DeepSeek V4 over OpenRouter emits its tool calls as TEXT markup in message CONTENT using the
# fullwidth-pipe DSML dialect (U+FF5C = ｜), e.g.:
#   <｜DSML｜invoke name="search_files"><｜DSML｜parameter name="pattern" string="true">*nfs*</｜DSML｜parameter></｜DSML｜invoke>
# The loop only read structured tool_calls + GLM's <tool_call> markup, so DeepSeek's DSML leaked
# verbatim into the transcript AND its intended tool calls never ran. Parse + EXECUTE them instead.
_DSML_INVOKE = re.compile(
    r"<｜DSML｜invoke\s+name=\"(?P<name>[^\"]+)\"\s*>(?P<body>.*?)</｜DSML｜invoke>", re.DOTALL)
_DSML_PARAM = re.compile(
    r"<｜DSML｜parameter\s+name=\"(?P<k>[^\"]+)\"[^>]*>(?P<v>.*?)</｜DSML｜parameter>", re.DOTALL)


def parse_dsml_text_tool_calls(text):
    """Extract DSML-style text tool calls → [{name, input}]. Only returns calls whose name is a
    REAL registered tool, so prose that merely mentions DSML isn't executed."""
    valid = {e.name for e in ct.all_entries()}
    calls = []
    for m in _DSML_INVOKE.finditer(text or ""):
        name = (m.group("name") or "").strip()
        if name not in valid:
            continue
        args = {}
        for am in _DSML_PARAM.finditer(m.group("body") or ""):
            k = (am.group("k") or "").strip()
            vs = (am.group("v") or "").strip()
            try:
                args[k] = json.loads(vs)
            except Exception:
                args[k] = vs
        calls.append({"name": name, "input": args})
    return calls


def strip_dsml_tool_markup(text):
    """Drop any residual DSML invoke blocks and stray <｜DSML｜…> tags so markup never lands in
    the final answer."""
    t = _DSML_INVOKE.sub("", text or "")
    t = re.sub(r"</?｜DSML｜[^>]*>", "", t)   # bare tool_calls wrapper / stray tags
    return t.strip()


def load_key(name):
    """Return only a credential explicitly injected into this lane.

    The orchestrator may read its protected env file, but the worker must not
    reopen that file and regain unrelated service/provider secrets.
    """
    return os.environ.get(name, "").strip()


SYSTEM_TEMPLATE = """You are {name}, an elite penetration tester summoned to a council of AI hackers because the lead pentester is STUCK and needs fresh eyes.

You have REAL tools to investigate the engagement yourself: a shell `terminal` (run commands, recon, read files), file tools (`read_file`, `write_file`, `search_files`, `patch`), and `execute_code`. Use them to examine the evidence (scans, loot/creds, notes, exploit scripts) and to verify ideas. Work out what services/versions are present, what was already tried and why it failed, what was MISSED, and what findings can be CHAINED. Budget ~8-12 tool calls, then STOP and write your assessment.

When done, respond with ONLY the assessment in this exact markdown (and NO further tool calls):

# {name} — Council Assessment
## Executive Summary
[one paragraph: what you found, your #1 recommendation, why it will work]
## Top 3 Attack Vectors
### 1. [Vector Name]
- **What**: ...
- **Why it will work**: [cite specific evidence from the files you read]
- **Commands to execute**:
```bash
# exact commands with comments
```
- **Expected outcome**: ...
### 2. [Vector Name]
[same structure]
### 3. [Vector Name]
[same structure]
## Things the Team Missed
## Files I Analyzed
## Confidence Level
[High/Medium/Low] — [justification]

Be specific — exact CVEs, versions, file paths. Don't repeat what's already been tried. Your final text response IS the deliverable."""


# ── Debate phase (round >= 2) ──────────────────────────────────────────────
# The lane already gave its opening assessment in round 1. Now it SEES every other
# member's latest position (injected into the user turn) and must move the council
# toward one plan: concede weaker ideas, adopt stronger ones, chain findings, and
# rebut dead-ends. It may run a few tool calls to verify a peer's claim, then STOP.
DEBATE_TEMPLATE = """You are {name}, an elite penetration tester in a live COUNCIL DEBATE about a stuck engagement. You already investigated and gave your opening assessment. You will be shown the CURRENT positions of every OTHER council member.

Your job now is NOT to repeat your opening — it is to move the council toward the single best plan:
- ADOPT ideas stronger than your own; say plainly when a peer changed your mind.
- CONCEDE your own earlier ideas that a peer convincingly refuted or that are already-tried dead-ends.
- REBUT reasoning you believe is wrong, already-tried, or unsupported by the evidence — cite the specific file/scan.
- CHAIN: call out where two members' findings combine into a stronger attack than either alone.
You have your same REAL tools. You may run a FEW (at most ~4) tool calls to verify a specific disputed claim against the evidence, then STOP and write your updated position.

When done, respond with ONLY this markdown (and NO further tool calls):

# {name} — Round {round} Position
## Where I Agree / Concede
[which peers' points you now accept; which of your own earlier ideas you are dropping and why]
## Where I Disagree
[specific peer claims you think are wrong or dead-ends, each with the evidence that refutes them]
## Strongest Path Now (my vote)
[the ONE attack vector you think the council should commit to — it may be a peer's idea or a chain of several]
## Ranked Vectors
1. [vector] — [one line why]
2. [vector] — [one line why]
3. [vector] — [one line why]
## Confidence
[High/Medium/Low] — [why]

Be specific — exact CVEs, versions, file paths. Argue the evidence, not vibes. Your final text response IS the deliverable."""


# ── Chair phase (final synthesis) ──────────────────────────────────────────
# One designated member reads the FULL multi-round debate and delivers the
# council's single final recommendation — the "final ask" the operator acts on.
CHAIR_TEMPLATE = """You are {name}, CHAIRING a council of six elite AI penetration testers. They each independently investigated a stuck engagement, then DEBATED across multiple rounds. You will be shown the full debate — every member's opening position and every round of rebuttals.

Your job is to deliver the council's SINGLE final recommendation: the one plan the operator should execute next. Decisions:
- Weigh the ARGUMENTS and EVIDENCE, not the raw vote count — a lone member with a decisive file-backed insight can outweigh a popular guess.
- Resolve the disagreements: state which contested points the evidence settles and how.
- Preserve genuine dissent as a recorded risk; a strong majority can still agree on a path that fails live validation.
You have REAL tools; you MAY run a few tool calls to confirm one decisive detail, then STOP and write the verdict.

When done, respond with ONLY this markdown (and NO further tool calls):

# 🏛️ Council Final Verdict
## The Decision
[one paragraph: the single recommended attack path and why it won the debate]
## Primary Attack Plan
- **Vector**: ...
- **Why the council converged here**: [name the members who argued it and the specific evidence]
- **Commands to execute**:
```bash
# exact step-by-step commands, with comments
```
- **Expected outcome**: ...
## Backup Path
[the #2 vector and the exact trigger/condition to switch to it if the primary fails]
## Dissent & Open Risks
[any member's unresolved objection worth remembering before committing; verify-on-target reminders]
## Confidence
[High/Medium/Low] — [why]

Be specific — exact CVEs, versions, file paths. This verdict IS the council's deliverable."""


def load_aliases():
    """Load an optional alias map; clean Kali hosts use native commands normally."""
    try:
        alias_path = Path(os.environ.get(
            "COUNCIL_ALIASES_FILE",
            "/opt/chillspwn-bin/ALIASES.md",
        ))
        amd = alias_path.read_text()
        if "## Compact" in amd:
            tail = amd.split("## Compact", 1)[1]
            if "```" in tail:
                return tail.split("```", 2)[1].strip()
        for ln in amd.splitlines():
            if ln.count("=") >= 5 and "SURFACE=" in ln:
                return ln.strip()
    except Exception:
        pass
    return ""


ALIAS_BLOCK = (
    "\n\n## OPTIONAL OPERATOR ALIAS WRAPPERS\n"
    "Native Kali command names are valid and are the portable default. This deployment also "
    "advertises convenience aliases; use one only when it helps the local operator, and never "
    "assume `/opt/chillspwn-bin` or any wrapper exists on another host. Flags and arguments remain "
    "those of the canonical command. Alias map (alias=canonical command):\n{aliases}"
)


def build_user(briefing, engagement_dir):
    return (f"## The Situation\n{briefing}\n\n"
            f"## Engagement directory\n`{engagement_dir}`\n\n"
            f"Investigate it with your tools (start by listing/reading the files there), "
            f"then produce your council assessment.")


# ── Pre-fed engagement context (for the tool-less claude-cli lane) ──────────
# Text evidence worth inlining when the lane has no live tools. "" = extensionless
# files (notes, flags, creds dumps) are common in engagement dirs, so keep them.
_CTX_EXTS = {".txt", ".md", ".xml", ".json", ".nmap", ".gnmap", ".conf", ".cfg",
             ".ini", ".yaml", ".yml", ".toml", ".log", ".csv", ".tsv", ".out",
             ".results", ".py", ".sh", ".rb", ".pl", ".php", ".html", ".js", ""}
# High-signal filename/dir hints — inline these first so the budget goes to evidence.
_CTX_PRIORITY = ("nmap", "scan", "recon", "enum", "loot", "cred", "password", "hash",
                 "note", "finding", "user", "flag", "service", "vuln", "exploit",
                 "web", "smb", "http", "ssh", "ldap")


def curate_engagement_context(engagement_dir, char_budget=CLAUDE_CTX_BUDGET,
                              per_file_cap=CLAUDE_CTX_PER_FILE):
    """Inline the engagement's text evidence into the prompt for a lane that has no
    live tools (claude-cli). Prioritizes high-signal files (scans/loot/notes), skips
    the council/ dir and binaries, and hard-caps total + per-file size so the prompt
    stays bounded."""
    root = Path(engagement_dir)
    files = []
    for p in root.rglob("*"):
        try:
            if not p.is_file() or "council" in p.parts:
                continue
            if p.suffix.lower() not in _CTX_EXTS:
                continue
            if p.stat().st_size > 2_000_000:      # skip huge dumps (pcap text, big wordlists)
                continue
        except OSError:
            continue
        files.append(p)

    def _score(p):
        hay = (p.name + " " + str(p.parent)).lower()
        pr = sum(1 for kw in _CTX_PRIORITY if kw in hay)
        try:
            sz = p.stat().st_size
        except OSError:
            sz = 0
        return (-pr, sz)                          # priority first, then smaller files

    files.sort(key=_score)
    parts, tree, used = [], [], 0
    for p in files:
        rel = p.relative_to(root)
        try:
            body = p.read_text(errors="ignore")
        except Exception:
            continue
        if len(body) > per_file_cap:
            body = body[:per_file_cap] + f"\n... [truncated — {len(body)} chars total]"
        block = f"\n===== FILE: {rel} =====\n{body}\n"
        if used + len(block) > char_budget:
            tree.append(f"{rel}  (listed only — context budget reached)")
            continue
        parts.append(block)
        tree.append(str(rel))
        used += len(block)
    if not files:
        return ("## Engagement evidence\n(No readable text files were found in the "
                "engagement directory.)\n")
    return ("## Engagement evidence — PRE-LOADED (you have NO live tools this run; "
            "analyze ONLY what is inlined below)\n\n### File inventory\n"
            + "\n".join(f"- {t}" for t in tree)
            + "\n\n### File contents\n" + "".join(parts))


def build_user_debate(briefing, engagement_dir, transcript):
    """User turn for a debate round: the situation + engagement dir + every OTHER
    member's latest position (the `transcript`)."""
    return (f"## The Situation\n{briefing}\n\n"
            f"## Engagement directory\n`{engagement_dir}` (your tools still work here)\n\n"
            f"## The council so far — every other member's latest position\n\n{transcript}\n\n"
            f"Now write YOUR updated position for this round: concede, rebut, adopt, and chain as "
            f"instructed. Verify a disputed claim with a few tool calls only if it changes your vote.")


def build_user_chair(briefing, engagement_dir, transcript):
    """User turn for the chair: the situation + the FULL multi-round debate transcript."""
    return (f"## The Situation\n{briefing}\n\n"
            f"## Engagement directory\n`{engagement_dir}` (tools available to confirm one detail)\n\n"
            f"## The full council debate (openings + all debate rounds)\n\n{transcript}\n\n"
            f"Deliver the council's single final verdict now, in the required format.")


def http_post(url, headers, body):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
        return json.loads(r.read().decode())


# ── OpenRouter loop (OpenAI tool format) ───────────────────────────────────
def run_openrouter(model, system, user, task_id, log, max_iters=MAX_ITERS,
                   force_write_at=FORCE_WRITE_AT, api_key=None):
    key = (api_key or load_key("OPENROUTER_API_KEY")).strip()
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY missing")
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json",
               "HTTP-Referer": "https://chillspwn.local/council", "X-Title": "ChillsPwn Council"}
    tools = ct.openai_schemas()
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    empty_writes = 0
    for it in range(max_iters):
        # Force the written assessment once budget is reserved (or at the hard cap): stop offering
        # tools so the model MUST produce prose while it still has iteration + token headroom.
        force_write = it >= force_write_at
        body = {"model": model, "messages": messages, "stream": False, "max_tokens": MAX_TOKENS,
                "provider": {"require_parameters": True}}  # only tool-capable backends
        if not force_write:
            body["tools"] = tools
            body["tool_choice"] = "auto"
        else:
            body["tool_choice"] = "none"  # force a text answer
        j = http_post("https://openrouter.ai/api/v1/chat/completions", headers, body)
        choice = j["choices"][0]
        msg = choice["message"]
        # Reasoning lanes (DeepSeek/GLM) sometimes leave `content` empty and return the text in a
        # reasoning field — fall back to it so a valid assessment isn't dropped as "empty".
        content = msg.get("content") or msg.get("reasoning_content") or msg.get("reasoning") or ""
        tcs = msg.get("tool_calls") or []
        # GLM (z-ai) emits tool calls as TEXT markup in content instead of structured tool_calls.
        # Parse + execute those so they don't leak into the assessment. Skip once we're forcing a
        # prose answer (tool_choice='none').
        text_calls = [] if (tcs or force_write) else (
            parse_glm_text_tool_calls(content) + parse_dsml_text_tool_calls(content))
        log(f"iter {it}: finish={choice.get('finish_reason')} tool_calls={len(tcs)} "
            f"text_tool_calls={len(text_calls)} provider={j.get('provider')}")
        if not tcs and not text_calls:
            ans = strip_dsml_tool_markup(strip_glm_tool_markup(content))   # never return raw tool-call markup
            if len(ans.strip()) > 200 or it >= max_iters - 1:
                return ans
            # Forced write came back empty/short (common for reasoning lanes) — nudge to write NOW,
            # a few times, instead of giving up with no assessment.
            empty_writes += 1
            if empty_writes >= 3:
                return ans
            messages.append({"role": "assistant", "content": content})
            messages.append({"role": "user", "content":
                "You produced no assessment. STOP investigating and write your COMPLETE council "
                "assessment NOW, in the required markdown format. Do not call any tools."})
            continue
        if tcs:
            messages.append({"role": "assistant", "content": content, "tool_calls": tcs})
            for tc in tcs:
                try:
                    a = json.loads(tc["function"].get("arguments") or "{}")
                except Exception:
                    a = {}
                res = ct.dispatch(tc["function"]["name"], a, task_id=task_id)
                log(f"   ↳ {tc['function']['name']}({json.dumps(a)[:80]}) -> {len(res)}b")
                messages.append({"role": "tool", "tool_call_id": tc["id"],
                                 "name": tc["function"]["name"], "content": res[:TOOL_RESULT_CAP]})
        else:
            # Text-markup tool calls have no tool_call_id, so we can't use role:tool. Execute them and
            # feed the results back as a user turn, nudging the model to the structured tools API.
            messages.append({"role": "assistant", "content": content})
            blocks = []
            for gc in text_calls:
                res = ct.dispatch(gc["name"], gc["input"], task_id=task_id)
                log(f"   ↳ (text){gc['name']}({json.dumps(gc['input'])[:80]}) -> {len(res)}b")
                blocks.append(f"<tool_result name=\"{gc['name']}\">\n{res[:TOOL_RESULT_CAP]}\n</tool_result>")
            messages.append({"role": "user", "content": "\n\n".join(blocks) +
                             "\n\n(Call tools via the structured tools API — do NOT emit <tool_call> as text.)"})
    return None


# ── Anthropic loop (tool_use / tool_result blocks) ─────────────────────────
def run_anthropic(model, system, user, task_id, log, max_iters=MAX_ITERS,
                  force_write_at=None, api_key=None):
    key = (api_key or load_key("ANTHROPIC_API_KEY")).strip()
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY missing")
    headers = {"x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"}
    tools = ct.anthropic_schemas()
    messages = [{"role": "user", "content": user}]
    for it in range(max_iters):
        last = it == max_iters - 1
        body = {"model": model, "system": system, "messages": messages, "max_tokens": MAX_TOKENS}
        if not last:
            body["tools"] = tools
        j = http_post("https://api.anthropic.com/v1/messages", headers, body)
        content = j.get("content") or []
        messages.append({"role": "assistant", "content": content})
        tus = [b for b in content if b.get("type") == "tool_use"]
        log(f"iter {it}: stop={j.get('stop_reason')} tool_uses={len(tus)}")
        if not tus:
            return "".join(b.get("text", "") for b in content if b.get("type") == "text")
        results = []
        for tu in tus:
            res = ct.dispatch(tu["name"], tu.get("input") or {}, task_id=task_id)
            log(f"   ↳ {tu['name']}({json.dumps(tu.get('input') or {})[:80]}) -> {len(res)}b")
            results.append({"type": "tool_result", "tool_use_id": tu["id"], "content": res[:TOOL_RESULT_CAP]})
        messages.append({"role": "user", "content": results})
    return None


# ── Claude Code CLI loop (`claude -p` — SUBSCRIPTION auth, NO metered API credits) ──
# Runs the operator's Claude Code subscription instead of the Anthropic API. By default
# the lane INVESTIGATES LIVE with Claude Code's own Bash/Read/Grep/Glob tools
# (--permission-mode bypassPermissions, cwd = the engagement dir). Claude Code runs its
# own agentic loop; its final stdout IS the assessment. If live_tools is False it instead
# runs `--tools ""` on pre-fed evidence (see curate_engagement_context / main()).
def run_claude_cli(model, system, user, task_id, log, max_iters=None, force_write_at=None,
                   cwd=None, live_tools=None, subprocess_env=None):
    if live_tools is None:
        live_tools = CLAUDE_LIVE_TOOLS
    prompt = f"{system}\n\n{user}"
    # HARD subscription guard: build this child from the same provider-specific
    # allowlist as classic Council lanes. Never let an inherited Anthropic API
    # variable flip `claude` to metered API billing.
    from council_summon import build_lane_environment
    source_env = os.environ if subprocess_env is None else subprocess_env
    env = build_lane_environment(
        {"provider": "claude-cli", "mode": "direct"},
        source_env=source_env,
        file_env={},
    )
    for name in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_TOKEN"):
        env.pop(name, None)
    chillspwn_user = env.get("COUNCIL_CLAUDE_USER", CHILLSPWN_USER).strip()
    chillspwn_home = env.get("COUNCIL_CLAUDE_HOME", CHILLSPWN_HOME).strip()
    claude_cmd = ["claude", "-p", prompt, "--model", model, "--output-format", "text"]
    if live_tools:
        claude_cmd += ["--permission-mode", "bypassPermissions"]   # headless tool use
    else:
        claude_cmd += ["--tools", ""]                              # analysis-only fallback
    # Claude Code refuses permission-bypass under root → drop to the non-root service
    # user that owns the subscription creds. `env -u` guarantees the API key is unset in
    # claude's env regardless of what runuser preserves, so billing stays on the plan.
    if live_tools and os.geteuid() == 0:
        if not chillspwn_user or not chillspwn_home:
            raise RuntimeError(
                "COUNCIL_CLAUDE_USER and COUNCIL_CLAUDE_HOME are required for a root-launched Claude lane"
            )
        cmd = (["runuser", "-u", chillspwn_user, "--",
                "env", "-u", "ANTHROPIC_API_KEY", "-u", "ANTHROPIC_AUTH_TOKEN",
                "-u", "ANTHROPIC_TOKEN", "HOME=" + chillspwn_home,
                "USER=" + chillspwn_user, "LOGNAME=" + chillspwn_user,
                "PAGER=cat"] + claude_cmd)
        as_user = chillspwn_user
    else:
        cmd = claude_cmd
        as_user = "self"
    log(f"claude -p (SUBSCRIPTION user={as_user} tools={'live' if live_tools else 'off'}): "
        f"model={model} cwd={cwd or os.getcwd()} prompt_chars={len(prompt)}")
    out_fd, out_path = tempfile.mkstemp(suffix=".claude.out")
    err_fd, err_path = tempfile.mkstemp(suffix=".claude.err")
    try:
        with os.fdopen(out_fd, "w") as of, os.fdopen(err_fd, "w") as ef:
            proc = subprocess.Popen(cmd, stdout=of, stderr=ef, stdin=subprocess.DEVNULL,
                                    env=env, cwd=cwd)
            start = time.monotonic()
            # Heartbeat so council_summon's stall watchdog (300s of no log growth)
            # doesn't kill a legitimately long single-shot analysis — `claude -p`
            # emits nothing until it finishes.
            while proc.poll() is None:
                if time.monotonic() - start > CLAUDE_CLI_TIMEOUT:
                    proc.kill()
                    try:
                        proc.wait(timeout=10)
                    except Exception:
                        pass
                    raise RuntimeError(f"claude -p timed out after {CLAUDE_CLI_TIMEOUT}s")
                log(f"   … claude -p analyzing ({int(time.monotonic() - start)}s elapsed)")
                time.sleep(30)
        out = Path(out_path).read_text(errors="ignore").strip()
        err = Path(err_path).read_text(errors="ignore").strip()
    finally:
        for pth in (out_path, err_path):
            try:
                os.unlink(pth)
            except OSError:
                pass
    if proc.returncode != 0:
        raise RuntimeError(f"claude -p exit {proc.returncode}: {(err or out)[:300]}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--provider", required=True, choices=["openrouter", "anthropic", "claude-cli"])
    ap.add_argument("--model", required=True)
    ap.add_argument("--engagement-dir", required=True)
    ap.add_argument("--briefing", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--display-name", default="Council Member")
    # Debate support (backward compatible: default phase 'opening' == original behavior).
    ap.add_argument("--phase", default="opening", choices=["opening", "debate", "chair"],
                    help="opening = independent assessment (default); debate = respond to peers' "
                         "positions; chair = synthesize the full debate into the final verdict.")
    ap.add_argument("--round", type=int, default=1, help="Debate round number (for prompt/labels).")
    ap.add_argument("--transcript-file", default=None,
                    help="Path to the assembled peer transcript injected for debate/chair phases.")
    args = ap.parse_args()

    aliases = load_aliases()
    # Load the peer transcript for debate/chair phases (empty is tolerated — the lane
    # just behaves like an opening if no peers responded).
    transcript = ""
    if args.transcript_file:
        try:
            transcript = Path(args.transcript_file).read_text()
        except Exception:
            transcript = ""

    if args.phase == "debate":
        system = DEBATE_TEMPLATE.format(name=args.display_name, round=args.round)
        user = build_user_debate(args.briefing, args.engagement_dir, transcript)
    elif args.phase == "chair":
        system = CHAIR_TEMPLATE.format(name=args.display_name)
        user = build_user_chair(args.briefing, args.engagement_dir, transcript)
    else:  # opening (default) — unchanged behavior
        system = SYSTEM_TEMPLATE.format(name=args.display_name)
        user = build_user(args.briefing, args.engagement_dir)

    if aliases:
        system += ALIAS_BLOCK.format(aliases=aliases)
    # Tool-less fallback ONLY (COUNCIL_CLAUDE_LIVE_TOOLS=0): pre-feed the engagement
    # evidence and override the templates' "use your tools" framing. With live tools
    # (the default) Claude Code reads the files itself from cwd, so skip this.
    if args.provider == "claude-cli" and not CLAUDE_LIVE_TOOLS:
        _no_tools_note = (
            "\n\nNOTE: You have NO live tools this run — do NOT attempt tool calls or "
            "reference commands you 'ran'. Base your assessment ONLY on the engagement "
            "evidence inlined above plus the situation briefing, and output the full "
            "assessment in the required markdown format.")
        user = user + "\n\n" + curate_engagement_context(args.engagement_dir) + _no_tools_note

    task_id = f"council-{os.path.basename(args.output)}"

    def log(m):
        print(f"[{args.display_name}] {m}", flush=True)

    # Permanent prompt log in the engagement's log/ dir — lets the operator verify
    # exactly what was sent to each lane (incl. whether the alias map is present).
    lane_id = Path(args.output).stem.replace("_assessment", "")
    log_dir = Path(args.engagement_dir) / "log"
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        (log_dir / f"council_{lane_id}_prompt.txt").write_text(
            f"# Council PROMPT — {args.display_name} ({args.provider}:{args.model})\n"
            f"# {time.strftime('%Y-%m-%d %H:%M:%S')}  aliases_injected={bool(aliases)}\n\n"
            f"===== SYSTEM =====\n{system}\n\n===== USER =====\n{user}\n"
        )
    except Exception as e:
        log(f"prompt-log warn: {e}")

    log(f"agentic loop start — provider={args.provider} model={args.model} "
        f"tools={[e.name for e in ct.entries()]}")
    runner = {"openrouter": run_openrouter, "anthropic": run_anthropic,
              "claude-cli": run_claude_cli}[args.provider]
    if args.provider == "claude-cli":
        # Investigate live from the engagement dir (or pre-fed evidence in fallback mode).
        runner = functools.partial(run_claude_cli, cwd=args.engagement_dir,
                                   live_tools=CLAUDE_LIVE_TOOLS)

    assessment, last_err = None, None
    for attempt in range(2):
        try:
            assessment = runner(args.model, system, user, task_id, log)
            if assessment and len(assessment.strip()) > 200:
                break
            last_err = "empty/short final answer"
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code}: {e.read()[:200].decode(errors='ignore')}"
            log(f"attempt {attempt+1} error: {last_err}")
        except Exception as e:
            last_err = str(e)
            log(f"attempt {attempt+1} error: {last_err}")
        time.sleep(5 * (attempt + 1))

    if assessment and len(assessment.strip()) > 200:
        Path(args.output).write_text(assessment)
        # Permanent response log alongside the prompt log.
        try:
            (log_dir / f"council_{lane_id}_response.txt").write_text(
                f"# Council RESPONSE — {args.display_name} ({args.provider}:{args.model})\n"
                f"# {time.strftime('%Y-%m-%d %H:%M:%S')}  chars={len(assessment)}\n\n{assessment}\n"
            )
        except Exception as e:
            log(f"response-log warn: {e}")
        log(f"wrote assessment ({len(assessment)} chars) -> {args.output}")
        sys.exit(0)
    log(f"FAILED: {last_err}")
    sys.exit(1)


if __name__ == "__main__":
    main()
