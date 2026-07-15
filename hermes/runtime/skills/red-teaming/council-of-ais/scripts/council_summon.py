#!/usr/bin/env python3
"""
Council of AIs — Multi-Model Attack Council Orchestrator

Spawns 6 lanes to independently analyze a pentest engagement directory, via two
mechanisms (set per-member by "mode"):
  • DIRECT (mode="direct") → our own non-streaming agentic worker
    (council_lane_agent.py), which REUSES Hermes' real tools (council_tools.py)
    but calls the model API directly — no Hermes runtime, so the "stream stalled
    mid tool-call" failure is structurally impossible. Lanes: Claude Opus
    (`claude -p`, SUBSCRIPTION auth — not metered API), GLM-5.1 / DeepSeek V4 /
    Qwen 3.7 (direct OpenRouter).
  • HERMES (default) → `hermes chat`. Lanes: GPT-5.5 (openai-codex OAuth) and
    Grok (xai OAuth) — reliable on Hermes and ride their subscriptions, so they
    consume no OpenRouter credits.
Monitors progress and sends real-time Telegram updates as each model submits.

Usage:
    python3 council_summon.py \
        --engagement-dir /path/to/authorized-engagement/ \
        --briefing "We have RCE as www-data but can't escalate. Tried SUID, sudo, cron." \
        --timeout 1800

Requirements:
    - claude CLI logged in on the operator's subscription (Claude Opus lane runs
      `claude -p`; NO ANTHROPIC_API_KEY needed — and it is stripped from the lane's
      env so it can never silently fall back to metered API billing)
    - OpenAI Codex OAuth login via `hermes login --provider openai-codex` (GPT-5.5 lane)
    - xAI OAuth login via `hermes auth add xai-oauth --type oauth` or existing xAI OAuth creds (Grok lane)
    - OPENROUTER_API_KEY in ~/.hermes/.env (DeepSeek/Qwen/GLM lanes)
    - TELEGRAM_BOT_TOKEN in ~/.hermes/.env
    - TELEGRAM_ALLOWED_USERS in ~/.hermes/.env (used as chat_id)
    - hermes CLI installed and accessible
"""

import argparse
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import threading
from pathlib import Path
from datetime import datetime

import council_state  # shared global council state (auto/manual completion, per-lane status+tools)

# ──────────────────────────────────────────────────────────────────────
# Council Members — 6 Elite AI Hackers
# ──────────────────────────────────────────────────────────────────────
# Lane call modes:
#   • "direct"  — call the OpenRouter model's HTTP API directly (scripts/direct_lane.py).
#                 No hermes, no agentic tool loop → immune to the "stream stalled
#                 mid tool-call" hang that plagued the OpenRouter reasoning lanes.
#                 The worker curates the engagement files into the prompt and takes
#                 the model's text response AS the assessment.
#   • "hermes"  — spawn `hermes chat` (default). Used for the OAuth lanes
#                 (openai-codex GPT-5.5, xai-oauth Grok) where hermes manages the
#                 OAuth tokens. (The Claude lane is now "direct" via `claude -p`.)
COUNCIL_MEMBERS = [
    {
        "id": "claude_opus",
        "display_name": "Claude Opus 4.8",
        "model": "claude-opus-4-8",
        "provider": "claude-cli",   # `claude -p` — SUBSCRIPTION auth (plan, NOT metered API)
        "mode": "direct",           # council_lane_agent.py → run_claude_cli (live tools, bypassPermissions)
        "emoji": "🟣",
    },
    {
        "id": "deepseek_v4",
        "display_name": "DeepSeek V4 Pro",
        "model": "deepseek/deepseek-v4-pro",
        "provider": "openrouter",
        "mode": "direct",           # direct OpenRouter API
        "emoji": "🔵",
    },
    {
        "id": "qwen",
        "display_name": "Qwen 3.7 Max",
        "model": "qwen/qwen3.7-max",
        "provider": "openrouter",
        "mode": "direct",           # direct OpenRouter API
        "emoji": "🟢",
    },
    {
        "id": "gpt55",
        "display_name": "GPT-5.5",
        "model": "gpt-5.5",
        "provider": "openai-codex",
        "emoji": "⚪",
    },
    {
        # Z-AI GLM-5.2 lane — replaces the former Gemini lane.
        "id": "glm",                       # → writes glm_assessment.md / glm_log.txt
        "display_name": "GLM-5.2",
        "model": "z-ai/glm-5.2",           # OpenRouter model slug for Z-AI GLM-5.2
        "provider": "openrouter",
        "mode": "direct",                  # direct OpenRouter API (non-streaming → no stall)
        "emoji": "🔴",
    },
    {
        "id": "grok",
        "display_name": "Grok 4.3",
        "model": "grok-4.20-reasoning",   # xAI-native slug through Hermes Responses transport
        "provider": "xai-oauth",          # SuperGrok OAuth; no OpenRouter/API-credit fallback
        # No direct mode: `hermes chat` owns OAuth token refresh and provider transport.
        "emoji": "🟡",
    },
]

# ──────────────────────────────────────────────────────────────────────
# Telegram Integration
# ──────────────────────────────────────────────────────────────────────

def load_env(source_env=None):
    """Load the operator env file without exporting it wholesale to a lane."""
    source = os.environ if source_env is None else source_env
    home = str(source.get("HOME", "") or "").strip()
    env_path = (
        Path(home).expanduser() / ".hermes" / ".env"
        if home else Path.home() / ".hermes" / ".env"
    )
    env_vars = {}
    try:
        lines = env_path.read_text().splitlines()
    except (OSError, UnicodeError):
        lines = []
    for line in lines:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            env_vars[key.strip()] = value.strip()
    return env_vars


# Council children are untrusted model-execution boundaries.  Keep this list
# deliberately small: operational secrets such as DASHBOARD_TOKEN, Telegram
# credentials, GitHub/cloud credentials, SSH agents, and unrelated provider
# keys must never be inherited merely because the dashboard has them.
_LANE_BASE_ENV_KEYS = (
    "HOME", "USER", "LOGNAME", "SHELL", "PATH",
    "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM", "TMPDIR",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE",
    "PYTHONUNBUFFERED",
)
_LANE_BOUNDARY_ENV_KEYS = (
    "CHILLSPWN_MEMORY_GUARD",
    "CHILLSPWN_MEM_CLI",
    "CHILLSPWN_MEMORY_SOCKET",
)
_LANE_WEB_TOOL_ENV_KEYS = (
    # Council tools currently register the Firecrawl backend explicitly. These
    # are shared tool credentials, not inference-provider fallbacks.
    "FIRECRAWL_API_KEY",
    "FIRECRAWL_API_URL",
)


def build_lane_environment(member, source_env=None, file_env=None):
    """Return the least-privilege environment for one Council member.

    Values may come from the protected service environment or ``~/.hermes/.env``,
    but only names explicitly selected for this provider are copied.  OAuth
    homes can be split per provider with ``COUNCIL_CODEX_HERMES_HOME`` and
    ``COUNCIL_XAI_HERMES_HOME``; ``HERMES_HOME`` remains a compatibility
    fallback for existing installations.
    """
    source = dict(os.environ if source_env is None else source_env)
    stored = load_env(source) if file_env is None else dict(file_env)

    def setting(name):
        value = source.get(name)
        if value is None or not str(value).strip():
            value = stored.get(name)
        return str(value).strip() if value is not None else ""

    lane_env = {"PAGER": "cat"}
    for name in _LANE_BASE_ENV_KEYS:
        value = setting(name)
        if value:
            lane_env[name] = value
    lane_env.setdefault("PATH", os.defpath)
    if "HOME" not in lane_env and source_env is None:
        lane_env["HOME"] = str(Path.home())

    for name in _LANE_BOUNDARY_ENV_KEYS:
        value = setting(name)
        if value:
            lane_env[name] = value

    provider = str(member.get("provider", "openrouter")).strip().lower()
    mode = str(member.get("mode", "hermes")).strip().lower()

    if mode == "direct" and provider in {"openrouter", "anthropic"}:
        for name in _LANE_WEB_TOOL_ENV_KEYS:
            value = setting(name)
            if value:
                lane_env[name] = value

    if mode == "direct":
        # The standalone worker imports Hermes' tool registry from this exact
        # tree. It does not need the rest of the dashboard/service environment.
        for name in ("CHILLSPWN_HERMES_SRC", "COUNCIL_ALIASES_FILE"):
            value = setting(name)
            if value:
                lane_env[name] = value

    if provider == "openrouter":
        value = setting("OPENROUTER_API_KEY")
        if value:
            lane_env["OPENROUTER_API_KEY"] = value
    elif provider == "anthropic":
        value = setting("ANTHROPIC_API_KEY")
        if value:
            lane_env["ANTHROPIC_API_KEY"] = value
    elif provider == "claude-cli":
        # Subscription auth is file/OAuth based. Never pass Anthropic API-key
        # variables, which can silently switch Claude Code to metered billing.
        for name in (
            "CLAUDE_CONFIG_DIR",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "COUNCIL_CLAUDE_USER",
            "COUNCIL_CLAUDE_HOME",
            "COUNCIL_CLAUDE_LIVE_TOOLS",
        ):
            value = setting(name)
            if value:
                lane_env[name] = value
    elif provider == "openai-codex":
        hermes_home = setting("COUNCIL_CODEX_HERMES_HOME") or setting("HERMES_HOME")
        if hermes_home:
            lane_env["HERMES_HOME"] = hermes_home
        codex_home = setting("CODEX_HOME")
        if codex_home:
            lane_env["CODEX_HOME"] = codex_home
    elif provider == "xai-oauth":
        hermes_home = setting("COUNCIL_XAI_HERMES_HOME") or setting("HERMES_HOME")
        if hermes_home:
            lane_env["HERMES_HOME"] = hermes_home

    return lane_env


def send_telegram(bot_token, chat_id, message):
    """Send a Telegram message using urllib (no external deps)."""
    import urllib.request
    import urllib.parse

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    data = urllib.parse.urlencode({
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "Markdown",
    }).encode("utf-8")

    try:
        req = urllib.request.Request(url, data=data)
        urllib.request.urlopen(req, timeout=10)
    except Exception as e:
        print(f"[!] Telegram send failed: {e}", file=sys.stderr)


# ──────────────────────────────────────────────────────────────────────
# Prompt Builder
# ──────────────────────────────────────────────────────────────────────

def build_prompt(member, briefing, engagement_dir, output_file):
    """Build the council prompt for a specific member."""
    template_path = Path(__file__).parent.parent / "templates" / "council_prompt.md"

    if template_path.exists():
        template = template_path.read_text()
    else:
        # Fallback inline template if file is missing
        template = (
            "You are an elite penetration tester. The lead pentester is STUCK.\n\n"
            "## Situation\n{{BRIEFING}}\n\n"
            "## Mission\n"
            "1. Explore `{{ENGAGEMENT_DIR}}` — list files, read scans, analyze evidence\n"
            "2. Find what was MISSED\n"
            "3. Write your assessment to `{{OUTPUT_FILE}}`\n\n"
            "Include: Executive Summary, Top 3 Attack Vectors (with exact commands), "
            "Things the Team Missed, Files Analyzed, Confidence Level.\n"
            "Be specific — name CVEs, versions, file paths. Don't repeat what was tried."
        )

    # Optional convenience aliases. A clean Kali host is expected to use native
    # command names; absence of this file must not alter or weaken the prompt.
    aliases = ""
    try:
        alias_path = Path(os.environ.get(
            "COUNCIL_ALIASES_FILE",
            "/opt/chillspwn-bin/ALIASES.md",
        ))
        amd = alias_path.read_text()
        # The compact block is the fenced code block after the "Compact" heading.
        if "## Compact" in amd:
            tail = amd.split("## Compact", 1)[1]
            if "```" in tail:
                aliases = tail.split("```", 2)[1].strip()
        if not aliases:  # fallback: any line that looks like the flat map
            for ln in amd.splitlines():
                if ln.count("=") >= 5 and "SURFACE=" in ln:
                    aliases = ln.strip(); break
    except Exception:
        aliases = ""

    # Replace template variables
    prompt = template.replace("{{BRIEFING}}", briefing)
    prompt = prompt.replace("{{ENGAGEMENT_DIR}}", str(engagement_dir))
    prompt = prompt.replace("{{OUTPUT_FILE}}", str(output_file))
    prompt = prompt.replace("{{MODEL_DISPLAY_NAME}}", member["display_name"])
    alias_guidance = ""
    if aliases:
        alias_guidance = (
            "## Optional operator alias wrappers\n\n"
            "Native Kali command names are valid and portable. This deployment also exposes "
            "optional convenience aliases; use them only when helpful and never assume they "
            "exist on another host. Alias map (alias=canonical command):\n\n"
            f"```text\n{aliases}\n```"
        )
    prompt = prompt.replace("{{ALIAS_GUIDANCE}}", alias_guidance)
    prompt = prompt.replace("{{ALIASES}}", aliases)  # backward-compatible custom templates
    prompt = prompt.replace("{{BRIEFING}}", briefing)
    prompt = prompt.replace("{{ENGAGEMENT_DIR}}", str(engagement_dir))

    # Per-lane extra constraints (e.g. GLM stall mitigation: assessment-only,
    # no large PoC tool-calls). Appended last so it overrides the template prose.
    if member.get("prompt_extra"):
        prompt = prompt + member["prompt_extra"]

    return prompt


# ──────────────────────────────────────────────────────────────────────
# Agent Spawner
# ──────────────────────────────────────────────────────────────────────

def _validated_executable(candidate, label):
    """Resolve and validate an executable without relying on an interactive PATH."""
    candidate = os.path.expanduser(str(candidate or "").strip())
    if not candidate:
        raise RuntimeError(f"{label} executable is not configured")
    if os.sep in candidate:
        path = Path(candidate)
        if path.is_file() and os.access(path, os.X_OK):
            return str(path.resolve())
    else:
        found = shutil.which(candidate)
        if found and os.access(found, os.X_OK):
            return str(Path(found).resolve())
    raise RuntimeError(f"{label} executable is missing or not executable: {candidate}")


def resolve_council_python():
    return _validated_executable(
        os.environ.get("HERMES_PYTHON") or sys.executable,
        "HERMES_PYTHON",
    )


def resolve_hermes_cli():
    configured = os.environ.get("HERMES_CLI", "").strip()
    if configured:
        return _validated_executable(configured, "HERMES_CLI")
    sibling = Path(resolve_council_python()).with_name("hermes")
    if sibling.is_file() and os.access(sibling, os.X_OK):
        return str(sibling.resolve())
    return _validated_executable("hermes", "HERMES_CLI")


def build_agent_command(member, prompt, engagement_dir, briefing=None, output_file=None):
    """Construct and validate a lane command without starting a provider call."""
    if member.get("mode") == "direct":
        worker = str(Path(__file__).parent / "council_lane_agent.py")
        if not Path(worker).is_file():
            raise RuntimeError(f"council lane worker is missing: {worker}")
        return [
            resolve_council_python(), worker,
            "--provider", member.get("provider", "openrouter"),
            "--model", member["model"],
            "--engagement-dir", str(engagement_dir),
            "--briefing", briefing or "",
            "--output", str(output_file),
            "--display-name", member["display_name"],
        ]
    return [
        resolve_hermes_cli(), "chat",
        "-q", prompt,
        "--model", member["model"],
        "--provider", member.get("provider", "openrouter"),
        "-t", "file,terminal",
        "--yolo",
        "-Q",
    ]


def spawn_agent(member, prompt, engagement_dir, log_file, briefing=None, output_file=None):
    """Spawn a council lane.

    mode == "direct" → our own non-streaming agentic worker (council_lane_agent.py),
      which reuses Hermes' real tools but calls the model API directly (no Hermes
      runtime, so no stall). Used for Claude (anthropic) + GLM/DeepSeek/Qwen (openrouter).
    otherwise → `hermes chat` as before. Used for the OAuth lanes (GPT-5.5/Grok),
      which are reliable on Hermes and ride their subscriptions (no OpenRouter credits).
    """
    cmd = build_agent_command(member, prompt, engagement_dir, briefing, output_file)
    if member.get("mode") == "direct":
        print(f"  {member['emoji']} Spawning {member['display_name']} (DIRECT {member.get('provider')}:{member['model']})")
    else:
        print(f"  {member['emoji']} Spawning {member['display_name']} ({member.get('provider', 'openrouter')}:{member['model']})")

    with open(log_file, "w") as log:
        process = subprocess.Popen(
            cmd,
            stdout=log,
            stderr=subprocess.STDOUT,
            cwd=str(engagement_dir),
            env=build_lane_environment(member),
            # Put each lane in its own process group so it survives if the
            # parent council process is killed or its tty closes.
            start_new_session=True,
            stdin=subprocess.DEVNULL,
        )

    return process


# ──────────────────────────────────────────────────────────────────────
# Progress Monitor
# ──────────────────────────────────────────────────────────────────────

def extract_top_pick(assessment_file):
    """Extract the first attack vector name from an assessment file."""
    try:
        content = Path(assessment_file).read_text()
        # Look for "### 1." or "## 1." pattern
        for line in content.splitlines():
            stripped = line.strip()
            if stripped.startswith("### 1.") or stripped.startswith("## 1."):
                # Extract the vector name after the number
                name = stripped.split(".", 1)[-1].strip()
                # Remove any markdown formatting
                name = name.strip("*").strip("#").strip()
                if name:
                    return name[:80]  # Cap at 80 chars
            # Also check for **What**: pattern
            if "**What**:" in stripped and "1." not in stripped:
                continue
        # Fallback: look for "Executive Summary" section and grab first sentence
        in_summary = False
        for line in content.splitlines():
            if "executive summary" in line.lower():
                in_summary = True
                continue
            if in_summary and line.strip() and not line.startswith("#"):
                return line.strip()[:100]
    except Exception:
        pass
    return "Assessment submitted (see file for details)"


def monitor_assessments(council_dir, members, bot_token, chat_id, start_mono,
                        timeout, processes=None, relaunch_fn=None,
                        max_retries=2, stall_secs=300):
    """Monitor assessment files, auto-recover failed/stalled lanes, send TG updates.

    Each lane resolves one of three ways:
      • SUBMITTED — assessment file present and non-trivial.
      • RETRIED   — its process exited with no file, OR (the OpenRouter
                    "stream stalled mid tool-call" hang) it is still 'running'
                    but its log has been silent for `stall_secs` after having
                    produced output. We kill it if needed and relaunch via
                    `relaunch_fn`, up to `max_retries` times.
      • DEAD      — retries exhausted (or no relaunch_fn supplied).

    The loop ends when every lane is SUBMITTED or DEAD, so a permanently broken
    lane never makes the council wait out the full timeout, while genuinely-slow
    reasoning lanes (GLM/DeepSeek) get both the full window AND fresh attempts.
    """
    completed = set()
    dead = set()
    retries = {m["id"]: 0 for m in members}
    last_size = {m["id"]: -1 for m in members}       # last observed log byte count
    last_progress = {m["id"]: 0.0 for m in members}  # elapsed when the log last grew
    exited_since = {}                                # mid -> elapsed at first observed exit
    assessment_files = {
        m["id"]: council_dir / f"{m['id']}_assessment.md" for m in members
    }

    def _log_size(mid):
        info = processes.get(mid) if processes else None
        lf = info.get("log_file") if info else None
        try:
            return Path(lf).stat().st_size if lf and Path(lf).exists() else 0
        except OSError:
            return 0

    def _kill(proc):
        """SIGTERM the lane's whole process group, escalating to SIGKILL."""
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except (ProcessLookupError, PermissionError, OSError):
            try:
                proc.terminate()
            except Exception:
                pass
        try:
            proc.wait(timeout=8)
        except Exception:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass

    def _recover(member, elapsed, reason):
        """Relaunch a failed/stalled lane, or bury it once retries are spent."""
        mid = member["id"]
        info = processes.get(mid) if processes else None
        es = format_time(elapsed)
        if relaunch_fn and info and retries[mid] < max_retries:
            if info["process"].poll() is None:      # still hung → kill before relaunch
                _kill(info["process"])
            retries[mid] += 1
            relaunch_fn(member, retries[mid])         # updates processes[mid] in place
            last_size[mid] = -1
            last_progress[mid] = elapsed
            exited_since.pop(mid, None)
            send_telegram(
                bot_token, chat_id,
                f"🔁 [{es}] {member['emoji']} *{member['display_name']}* — {reason}; "
                f"retry {retries[mid]}/{max_retries}"
            )
            print(f"  🔁 [{es}] {member['display_name']} — {reason}; retry {retries[mid]}/{max_retries}")
            return
        dead.add(mid)
        try:
            council_state.update_lane(council_dir.parent.name, mid, status="failed")
        except Exception:
            pass
        send_telegram(
            bot_token, chat_id,
            f"❌ [{es}] {member['emoji']} *{member['display_name']}* — {reason}; "
            f"gave up after {retries[mid]} retr{'y' if retries[mid] == 1 else 'ies'} "
            f"({len(completed)}/{len(members)} done)"
        )
        print(f"  ❌ [{es}] {member['display_name']} — {reason}; gave up after {retries[mid]} retries")

    while len(completed) + len(dead) < len(members):
        elapsed = time.monotonic() - start_mono
        if elapsed > timeout:
            incomplete = [m for m in members if m["id"] not in completed and m["id"] not in dead]
            names = ", ".join(m["display_name"] for m in incomplete)
            send_telegram(
                bot_token, chat_id,
                f"⏰ *COUNCIL TIMEOUT* ({int(elapsed)}s)\n"
                f"Still waiting on: {names}\n"
                f"Proceeding with {len(completed)}/{len(members)} assessments."
            )
            break

        for member in members:
            mid = member["id"]
            if mid in completed or mid in dead:
                continue

            af = assessment_files[mid]
            if af.exists() and af.stat().st_size > 100:
                completed.add(mid)
                try:
                    _lf = processes[mid]["log_file"] if (processes and mid in processes) else None
                    council_state.update_lane(
                        council_dir.parent.name, mid, status="submitted",
                        assessment_bytes=af.stat().st_size,
                        tools_called=council_state.parse_tools(_lf) if _lf else [],
                    )
                except Exception:
                    pass
                elapsed_str = format_time(elapsed)
                top_pick = extract_top_pick(af)
                send_telegram(
                    bot_token, chat_id,
                    f"✅ [{elapsed_str}] {member['emoji']} *{member['display_name']}* — "
                    f"assessment submitted ({len(completed)}/{len(members)})\n"
                    f"→ _{top_pick}_"
                )
                print(
                    f"  ✅ [{elapsed_str}] {member['display_name']} — "
                    f"assessment submitted ({len(completed)}/{len(members)})"
                )
                continue

            # Track log growth — drives the stall watchdog.
            sz = _log_size(mid)
            if sz > last_size[mid]:
                last_size[mid] = sz
                last_progress[mid] = elapsed

            info = processes.get(mid) if processes else None
            proc = info["process"] if info else None
            if proc is None:
                continue

            # (1) Process exited but left no assessment → failed. One ~20s flush
            #     grace (in case the file write lagged the exit), then recover.
            if proc.poll() is not None:
                first = exited_since.get(mid)
                if first is None:
                    exited_since[mid] = elapsed
                elif elapsed - first >= 20:
                    _recover(member, elapsed, "lane exited with no assessment")
                continue

            # (2) Process alive but its log has gone silent for stall_secs AFTER
            #     having produced output → the "stream stalled mid tool-call"
            #     hang. Only armed once the lane has written something, so a slow
            #     time-to-first-token isn't mistaken for a stall. Kill + retry.
            silent_for = elapsed - last_progress[mid]
            if last_size[mid] > 0 and silent_for > stall_secs:
                _recover(member, elapsed, f"stream stalled (~{int(silent_for)}s no output)")
                continue

        time.sleep(15)  # Check every 15 seconds

    return completed


def format_time(seconds):
    """Format seconds into a human-readable string."""
    mins = int(seconds) // 60
    secs = int(seconds) % 60
    if mins > 0:
        return f"{mins}m {secs:02d}s"
    return f"{secs}s"


# ──────────────────────────────────────────────────────────────────────
# File Inventory
# ──────────────────────────────────────────────────────────────────────

def count_engagement_files(engagement_dir):
    """Count text files in the engagement directory."""
    text_extensions = {
        ".txt", ".md", ".xml", ".json", ".nmap", ".gnmap",
        ".py", ".sh", ".rb", ".pl", ".php", ".html", ".js",
        ".conf", ".cfg", ".ini", ".yaml", ".yml", ".toml",
        ".log", ".csv", ".tsv", ".out", ".results",
    }
    count = 0
    for root, dirs, files in os.walk(engagement_dir):
        # Skip the council directory itself
        if "council" in root:
            continue
        for f in files:
            ext = Path(f).suffix.lower()
            if ext in text_extensions or not ext:
                count += 1
    return count


def list_engagement_dirs(engagement_dir):
    """List top-level subdirectories in the engagement."""
    dirs = []
    for item in sorted(Path(engagement_dir).iterdir()):
        if item.is_dir() and item.name != "council":
            file_count = sum(1 for _ in item.rglob("*") if _.is_file())
            dirs.append(f"{item.name}/ ({file_count} files)")
    return dirs


# ──────────────────────────────────────────────────────────────────────
# Main Orchestrator
# ──────────────────────────────────────────────────────────────────────

def main():
    # Line-buffer stdout/stderr so the runner log STREAMS live when redirected to
    # a file (e.g. `tail -f` it in the dashboard terminal) instead of only
    # flushing at exit. Without this, a file-redirected run looks "silent".
    try:
        sys.stdout.reconfigure(line_buffering=True)
        sys.stderr.reconfigure(line_buffering=True)
    except Exception:
        pass
    parser = argparse.ArgumentParser(
        description="Council of AIs — Summon 6 AI hackers to analyze your engagement"
    )
    parser.add_argument(
        "--engagement-dir", "-d",
        required=True,
        help="Path to the authorized engagement directory"
    )
    parser.add_argument(
        "--briefing", "-b",
        required=True,
        help="Brief description of the situation — what's known, tried, and blocking"
    )
    parser.add_argument(
        "--timeout", "-t",
        type=int,
        default=1800,
        help="Maximum time to wait for all assessments (seconds, default: 1800 = 30 min). Bumped from 1200 because reasoning-heavy lanes (GLM-5.1, DeepSeek) burn lots of time on private chain-of-thought and were getting terminated mid-stream. Crashed lanes are detected early (process exit) so this ceiling only applies to lanes that are genuinely still thinking."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be done without actually spawning agents"
    )
    parser.add_argument(
        "--completion-mode",
        choices=["auto", "manual"],
        default=None,
        help="auto = run self-completes when lanes finish (default); manual = run sits in "
             "'awaiting_review' until marked complete in the dashboard (ChillsPwn hard-pauses). "
             "Defaults to the global setting (auto)."
    )
    parser.add_argument(
        "--mode",
        choices=["independent", "live"],
        default="live",
        help="live (DEFAULT — operator preference) = the models hold a real-time roundtable "
             "DEBATE (they read each other and reply, cycling for --laps), then a chair writes "
             "the single final verdict (final_verdict.md). Delegates to council_conversation.py. "
             "independent = each model writes a sealed assessment alone, then you synthesize "
             "(the classic parallel behavior; pass --mode independent to use it)."
    )
    parser.add_argument(
        "--laps",
        type=int,
        default=3,
        help="live mode only: how many times each member speaks in the debate (default 3)."
    )
    parser.add_argument(
        "--chair",
        default="claude_opus",
        help="live mode only: member id that synthesizes the final verdict (default claude_opus)."
    )
    args = parser.parse_args()

    engagement_dir = Path(args.engagement_dir).resolve()
    if not engagement_dir.exists():
        print(f"[!] Engagement directory does not exist: {engagement_dir}")
        sys.exit(1)

    # ── LIVE mode → hand off to the roundtable-debate orchestrator ────────
    # Live mode is a fundamentally different flow (sequential turns over one shared
    # conversation), so it lives in council_conversation.py. Lazy-import to avoid a
    # top-level cycle (council_conversation imports helpers from this module).
    if args.mode == "live":
        completion_mode = args.completion_mode or council_state.get_default_mode()
        if args.dry_run:
            import council_conversation as cc
            print(f"[DRY RUN] mode=live → council_conversation.run_live("
                  f"laps={args.laps}, chair={args.chair}, per_turn_timeout={args.timeout}, "
                  f"completion={completion_mode})")
            for i, m in enumerate(COUNCIL_MEMBERS, 1):
                kind = "in-process" if m.get("mode") == "direct" else "hermes-per-turn"
                print(f"    {i}. {m['emoji']} {m['display_name']:16s} [{kind}] {m.get('provider')}:{m['model']}")
            sys.exit(0)
        import council_conversation as cc
        cc.run_live(engagement_dir, args.briefing, args.laps, args.timeout,
                    args.chair, completion_mode)
        return

    # Load env vars for Telegram
    env = load_env()
    bot_token = os.environ.get("TELEGRAM_BOT_TOKEN", "") or env.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = os.environ.get("TELEGRAM_ALLOWED_USERS", "") or env.get("TELEGRAM_ALLOWED_USERS", "")

    if not bot_token or not chat_id:
        print("[!] Warning: TELEGRAM_BOT_TOKEN or TELEGRAM_ALLOWED_USERS not set.")
        print("    Progress updates will only appear in the console.")

    # Create council directory
    council_dir = engagement_dir / "council"
    council_dir.mkdir(exist_ok=True)

    # ── Register this run in the shared global council state ──────────────
    # ChillsPwn reads this to know a council's status (running / awaiting_review
    # / completed), its completion_mode, and each lane's tools + assessment.
    completion_mode = args.completion_mode or council_state.get_default_mode()
    engagement_name = engagement_dir.name
    try:
        council_state.ensure_run(
            engagement_name, engagement_dir, args.briefing, completion_mode,
            {m["id"]: {"display": m["display_name"], "provider": m.get("provider", "openrouter"),
                       "mode": m.get("mode", "hermes")} for m in COUNCIL_MEMBERS},
        )
        print(f"📊 Council state: '{engagement_name}' registered (completion_mode={completion_mode})")
    except Exception as e:
        print(f"[!] council_state.ensure_run failed (non-fatal): {e}")

    # File inventory
    file_count = count_engagement_files(engagement_dir)
    subdirs = list_engagement_dirs(engagement_dir)
    subdir_str = ", ".join(subdirs) if subdirs else "No subdirectories"

    # ── Announce the council ────────────────────────────────────────
    print("\n" + "=" * 60)
    print("🏛️  COUNCIL OF AIs — SUMMONED")
    print("=" * 60)
    print(f"📂 Engagement: {engagement_dir}")
    print(f"📄 Files available: {file_count} files across {subdir_str}")
    print(f"📝 Briefing: {args.briefing[:200]}...")
    print(f"⏱️  Timeout: {args.timeout}s")
    print()

    # Build member display for Telegram
    member_lines = "\n".join(
        f"   {m['emoji']} {m['display_name']:20s} → {m.get('provider', 'openrouter')}:{m['model']}"
        for m in COUNCIL_MEMBERS
    )

    announce_msg = (
        f"🏛️ *COUNCIL SUMMONED*\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"📂 `{engagement_dir.name}/`\n"
        f"📝 _{args.briefing[:200]}_\n"
        f"📄 {file_count} files available\n\n"
        f"🤖 *Deploying 6 AI analysts...*\n"
        f"{member_lines}\n"
        f"━━━━━━━━━━━━━━━━━━"
    )

    if bot_token and chat_id:
        send_telegram(bot_token, chat_id, announce_msg)

    if args.dry_run:
        print("\n[DRY RUN] Would spawn the following agents:\n")
        for m in COUNCIL_MEMBERS:
            output_file = council_dir / f"{m['id']}_assessment.md"
            print(f"  {m['emoji']} {m['display_name']}")
            print(f"     Model:  {m['model']}")
            print(f"     Provider: {m.get('provider', 'openrouter')}")
            print(f"     Output: {output_file}")
            if m.get("mode") == "direct":
                print(f"     CMD:    {resolve_council_python()} council_lane_agent.py --provider {m.get('provider')} "
                      f"--model {m['model']} --engagement-dir <dir> --output {output_file.name}  (DIRECT, non-streaming)")
            else:
                print(f"     CMD:    {resolve_hermes_cli()} chat -q '...' --model {m['model']} "
                      f"--provider {m.get('provider', 'openrouter')} -t file,terminal --yolo -Q  (HERMES)")
            print()
        print("[DRY RUN] No agents spawned. Exiting.")
        sys.exit(0)

    # ── Spawn all 6 agents ──────────────────────────────────────────
    print("🤖 Deploying analysts...\n")
    start_mono = time.monotonic()
    processes = {}

    # Permanent prompt/response logs for the whole council live here.
    log_dir = engagement_dir / "log"
    try:
        log_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass

    for member in COUNCIL_MEMBERS:
        output_file = council_dir / f"{member['id']}_assessment.md"
        log_file = council_dir / f"{member['id']}_log.txt"

        prompt = build_prompt(member, args.briefing, engagement_dir, output_file)
        # Log the actual prompt for HERMES lanes here (they receive `prompt` via -q).
        # DIRECT lanes build+log their own prompt inside council_lane_agent.py.
        if member.get("mode") != "direct":
            try:
                (log_dir / f"council_{member['id']}_prompt.txt").write_text(
                    f"# Council PROMPT — {member['display_name']} "
                    f"({member.get('provider','openrouter')}:{member['model']})  [hermes -q]\n"
                    f"# {time.strftime('%Y-%m-%d %H:%M:%S')}  "
                    f"aliases_injected={'SURFACE=nmap' in prompt}\n\n{prompt}\n"
                )
            except OSError:
                pass
        proc = spawn_agent(member, prompt, engagement_dir, log_file, briefing=args.briefing, output_file=output_file)
        processes[member["id"]] = {
            "process": proc,
            "member": member,
            "output_file": output_file,
            "log_file": log_file,
        }

    print(f"\n  All {len(COUNCIL_MEMBERS)} agents deployed. Monitoring for assessments...\n")

    # Relaunch helper used by the monitor's auto-recovery (failed/stalled lanes).
    # Each retry writes its own {id}_log_retry{n}.txt and swaps the live process
    # handle in `processes` so the monitor tracks the fresh attempt.
    def relaunch_fn(member, attempt):
        mid = member["id"]
        output_file = council_dir / f"{mid}_assessment.md"
        log_file = council_dir / f"{mid}_log_retry{attempt}.txt"
        # Clear a stale empty/partial assessment so completion stays unambiguous.
        try:
            if output_file.exists() and output_file.stat().st_size <= 100:
                output_file.unlink()
        except OSError:
            pass
        prompt = build_prompt(member, args.briefing, engagement_dir, output_file)
        proc = spawn_agent(member, prompt, engagement_dir, log_file, briefing=args.briefing, output_file=output_file)
        processes[mid]["process"] = proc
        processes[mid]["log_file"] = log_file
        return proc

    # ── Monitor progress (auto-recovers failed/stalled lanes) ────────
    completed = monitor_assessments(
        council_dir, COUNCIL_MEMBERS,
        bot_token, chat_id,
        start_mono, args.timeout,
        processes,
        relaunch_fn=relaunch_fn,
    )

    # ── Permanent response logs: copy each lane's final assessment into log/ ──
    # (Uniform for all 6 lanes; the DIRECT lanes also self-log, this guarantees the
    #  hermes lanes' responses are captured and keeps prompt+response side by side.)
    for member in COUNCIL_MEMBERS:
        af = council_dir / f"{member['id']}_assessment.md"
        try:
            if af.exists() and af.stat().st_size > 0:
                (log_dir / f"council_{member['id']}_response.md").write_text(
                    f"# Council RESPONSE — {member['display_name']} "
                    f"({member.get('provider','openrouter')}:{member['model']})\n"
                    f"# {time.strftime('%Y-%m-%d %H:%M:%S')}  chars={af.stat().st_size}\n\n"
                    + af.read_text()
                )
        except OSError:
            pass

    # ── Transition the run's global state: auto→completed, manual→awaiting_review ──
    try:
        st = council_state.finish_run(engagement_name)
        _final = st.get("runs", {}).get(engagement_name, {}).get("status", "?")
        print(f"📊 Council state: '{engagement_name}' → {_final} (mode={completion_mode})")
        if _final == "awaiting_review":
            send_telegram(bot_token, chat_id,
                          f"🟡 *Council awaiting review* — `{engagement_name}` finished "
                          f"({len(completed)}/{len(COUNCIL_MEMBERS)}). Mark it Complete in the dashboard "
                          f"to release ChillsPwn.")
    except Exception as e:
        print(f"[!] council_state.finish_run failed (non-fatal): {e}")

    # ── Cleanup: terminate any still-running processes ──────────────
    for mid, info in processes.items():
        proc = info["process"]
        if proc.poll() is None:
            print(f"  ⚠️  Terminating {info['member']['display_name']} (still running)")
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()

    # ── Final Report ────────────────────────────────────────────────
    elapsed = time.monotonic() - start_mono
    elapsed_str = format_time(elapsed)

    print("\n" + "=" * 60)
    print(f"🏛️  COUNCIL COMPLETE — {len(completed)}/{len(COUNCIL_MEMBERS)} assessments received")
    print(f"⏱️  Total time: {elapsed_str}")
    print("=" * 60)

    # List all assessment files
    print("\n📋 Assessment files:")
    for member in COUNCIL_MEMBERS:
        af = council_dir / f"{member['id']}_assessment.md"
        status = "✅" if member["id"] in completed else "❌"
        size = f"({af.stat().st_size} bytes)" if af.exists() else "(missing)"
        print(f"  {status} {member['emoji']} {member['display_name']:20s} → {af.name} {size}")

    # Send final Telegram message
    if bot_token and chat_id:
        completed_names = "\n".join(
            f"  ✅ {m['emoji']} {m['display_name']}"
            for m in COUNCIL_MEMBERS if m["id"] in completed
        )
        failed_names = "\n".join(
            f"  ❌ {m['emoji']} {m['display_name']}"
            for m in COUNCIL_MEMBERS if m["id"] not in completed
        )

        final_msg = (
            f"🏛️ *COUNCIL COMPLETE*\n"
            f"⏱️ Total: {elapsed_str}\n"
            f"📊 {len(completed)}/{len(COUNCIL_MEMBERS)} assessments received\n\n"
            f"{completed_names}"
        )
        if failed_names:
            final_msg += f"\n\n{failed_names}"
        final_msg += f"\n\n📂 Results in: `{council_dir}/`\n_Synthesizing recommendations..._"

        send_telegram(bot_token, chat_id, final_msg)

    # Save council summary
    summary_file = council_dir / "council_summary.md"
    with open(summary_file, "w") as f:
        f.write(f"# Council of AIs — Session Summary\n\n")
        f.write(f"**Date**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"**Engagement**: `{engagement_dir}`\n")
        f.write(f"**Briefing**: {args.briefing}\n")
        f.write(f"**Duration**: {elapsed_str}\n")
        f.write(f"**Completed**: {len(completed)}/{len(COUNCIL_MEMBERS)}\n\n")
        f.write("## Assessments\n\n")
        for member in COUNCIL_MEMBERS:
            af = council_dir / f"{member['id']}_assessment.md"
            status = "✅" if member["id"] in completed else "❌ (timeout/failed)"
            f.write(f"- {status} **{member['display_name']}** ({member.get('provider', 'openrouter')}:{member['model']}): `{af.name}`\n")
        f.write(f"\n## Briefing\n\n{args.briefing}\n")

    print(f"\n📝 Summary saved to: {summary_file}")
    print(f"\n🧠 Hermes: Read all files in {council_dir}/ and synthesize the recommendations.\n")


if __name__ == "__main__":
    main()
