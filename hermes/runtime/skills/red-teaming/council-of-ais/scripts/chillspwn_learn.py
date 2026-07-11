#!/usr/bin/env python3
"""
chillspwn_learn.py — ChillsPwn post-session continuous-learning reviewer.

ChillsPwn runs as `claude -p`, so it never gets Hermes' built-in self-improvement.
This reviews a finished session and saves durable MEMORY + reusable SKILLS for
future sessions.

ENGINE (per Mr. Wong): Claude Opus via `claude -p` — SUBSCRIPTION auth (counts
against the plan, NOT API credits). The reviewer RESUMES the finished session
with `--resume <cliSessionId> --fork-session`, so Opus reflects with the session's
FULL NATIVE CONTEXT — including every tool call and its output, which the exported
.md transcript loses. `--fork-session` means the review happens in a NEW session id,
so the user's original conversation is left untouched (no pollution).

SAFETY (per Mr. Wong — "what if the reviewer removes something important?"):
The model does NOT write to memory itself. It emits its learnings as a single JSON
block; THIS runtime persists them through the ADDITIVE-ONLY chillspwn_mem.py /
chillspwn_skill.py CLIs. Consequences:
  • The reviewer can only ADD memory + CREATE/PATCH skills — removal/replace is
    structurally impossible from this path. Today's near-miss (almost deleting the
    HTB Lock ROOTED flag) cannot happen.
  • chillspwn_mem.py also takes a backup before every write, protects 📌 pinned
    entries, soft-deletes to ARCHIVE.md, and logs an audit trail — those guard the
    SEPARATE, human-gated curator path.
  • No tool-permission hangs in headless/root mode (we pass `--tools ""`).

Modes:
  --resume-session <cliSessionId> [--cwd DIR]   resume for full context (PREFERRED)
  --transcript <file.md>                        fallback: review a .md (no resume)
"""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

HERMES_SRC = "/media/sf_hermes-agent"
if HERMES_SRC not in sys.path:
    sys.path.insert(0, HERMES_SRC)
SCRIPT_DIR = Path(__file__).resolve().parent

from agent.background_review import _COMBINED_REVIEW_PROMPT  # Hermes' real review taxonomy

MEM_CLI = str(SCRIPT_DIR / "chillspwn_mem.py")
SKILL_CLI = str(SCRIPT_DIR / "chillspwn_skill.py")
DEFAULT_MODEL = "claude-opus-4-8"
CLAUDE_TIMEOUT = 900
TRANSCRIPT_CAP = 120_000
MCP_CHAR_BUDGET = int(os.environ.get("CHILLSPWN_LEARN_MCP_CHARS", "600000"))  # ~150k tokens

# A sentinel-block contract (NOT JSON): skill bodies are markdown with ``` code
# fences and newlines, which break JSON escaping/fence-matching. Blocks end at a
# line that is exactly @END, so the body can contain anything else freely.
DIRECTIVE_CONTRACT = (
    "Output ONLY directive blocks in EXACTLY this format — no other prose. Each block "
    "ends with a line that is exactly @END.\n\n"
    "For each durable fact (ONE fact per block):\n"
    "@MEMORY target=memory\n"
    "<the fact — env/project/ops fact. Use target=user for a fact about the user or a durable preference.>\n"
    "@END\n\n"
    "For a NEW reusable skill (prefer this over a long memory entry for bulky procedures):\n"
    "@SKILL action=create name=kebab-name desc=short description up to 60 chars\n"
    "<markdown body — may contain anything, including ``` code fences>\n"
    "@END\n\n"
    "To extend an EXISTING skill by name:\n"
    "@SKILL action=patch name=kebab-name\n"
    "<markdown to append>\n"
    "@END\n\n"
    "If nothing is worth saving, output exactly one line: @NOTHING"
)
_ATTR_KEYS = ("target", "action", "name")

ADDITIVE_RULE = (
    "ADDITIVE-ONLY (critical): you may only PROPOSE NEW memory entries and NEW/UPDATED "
    "skills. NEVER propose removing or replacing existing memory — if something is now "
    "stale, write a NEW entry that supersedes it and say so in the text. A separate, "
    "human-gated curator handles consolidation. Do NOT use any tools — just output JSON."
)

COMMAND_LEARNING_RULE = (
    "CAPTURE COMMANDS THAT MATTER: when a specific command / tool-invocation produced a meaningful "
    "result — a working exploit or enumeration command, a technique that SUCCEEDED, or one that clearly "
    "FAILED for a knowable reason — record the EXACT command and its concrete result. Prefer the real "
    "command + outcome over a vague paraphrase, so a future session can reuse the working command verbatim "
    "and avoid the dead ends. Fold a repeatable multi-step chain into a @SKILL; keep one-off command->result "
    "facts as @MEMORY. A FAILURE means 'this exact approach did not work HERE — vary it next time', NOT "
    "'never attempt this class of test': never encode a learning that would make a future agent SKIP a check "
    "it has not actually run."
)


MEM_DIGEST_CAP = int(os.environ.get("CHILLSPWN_LEARN_MEM_CHARS", "80000"))

QA_GAP_RULE = (
    "FINAL-QA / GAP CAPTURE: a lightweight mid-conversation distiller already captured the obvious "
    "structured findings live (into per-session engagement state). You are the FINAL pass over the WHOLE "
    "conversation. Cross-reference the CURRENT PERSISTENT MEMORY shown below and propose ONLY what is "
    "MISSING from it: durable learnings, the exact working/failed commands + their results, and engagement "
    "facts the live distillation did not already persist. Do NOT restate what memory already contains — your "
    "value is catching the gaps the live pass missed."
)


def current_memory_digest(cap=MEM_DIGEST_CAP, log=print):
    """Read the current USER.md + MEMORY.md so the reviewer can cross-reference and capture only gaps
    (Level-1 QA). Resolved via chillspwn_mem.get_memory_dir() — the SAME dir the persist path writes to."""
    try:
        from chillspwn_mem import get_memory_dir
        d = Path(str(get_memory_dir()))
    except Exception as e:
        log(f"memory digest: cannot resolve memory dir ({e})")
        return ""
    out = []
    for name in ("USER.md", "MEMORY.md"):
        p = d / name
        try:
            if p.exists():
                out.append(f"### {name}\n" + p.read_text(errors="replace"))
        except Exception:
            pass
    blob = "\n\n".join(out)
    if len(blob) > cap:
        blob = blob[:cap] + "\n…(memory truncated for review)…"
    return blob


def build_prompt(transcript=None, memory_digest=None):
    head = ("You are ChillsPwn's learning reviewer. " + (
        "You have the FULL context of this finished ChillsPwn session above (every tool "
        "call and output included). Review it for durable learnings worth keeping for "
        "future sessions." if transcript is None else
        "Below is a finished ChillsPwn session transcript. Review it for durable learnings."))
    parts = [head, "", _COMBINED_REVIEW_PROMPT, "", COMMAND_LEARNING_RULE]
    if memory_digest:
        parts += ["", QA_GAP_RULE, "",
                  "----- CURRENT PERSISTENT MEMORY (already captured — do NOT duplicate) -----",
                  memory_digest, "----- END CURRENT MEMORY -----"]
    parts += ["", ADDITIVE_RULE, "", DIRECTIVE_CONTRACT]
    if transcript is not None:
        parts += ["", "----- TRANSCRIPT -----", transcript[:TRANSCRIPT_CAP], "----- END TRANSCRIPT -----"]
    return "\n".join(parts)


def render_mcp(mcp_file, since_record=0, session_id=None):
    """Render conversation.mcp (append-only JSONL of {role,content,toolName?,ts}) into a
    readable transcript for review. The MCP is the COMPLETE, never-rewritten engagement
    log — unlike the .md export it is not lossily truncated by the dashboard.

    INCREMENTAL (prevents reprocessing): conversation.mcp is keyed per engagement DIR and
    accumulates EVERY session that ran in that cwd. Reviewing the whole file each time would
    re-review prior sessions on every later one. So we review ONLY records with index
    >= `since_record` (the cron persists, per-mcp-path, how many records were already
    reviewed). The new delta == the just-finished session's turns.

    `session_id`: best-effort filter for records that carry a sessionId (today they don't —
    #66 keys the log per dir, not per session — so this is a no-op until the write path
    stamps it; the offset is the real dedup). On overflow keep the RECENT tail.
    Returns (text, n_records_shown, n_total, n_new)."""
    recs = []
    for line in Path(mcp_file).read_text(errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            recs.append(json.loads(line))
        except Exception:
            pass
    total = len(recs)
    since = since_record if 0 <= since_record <= total else 0
    new = recs[since:]                       # ONLY records appended since the last review
    n_new = len(new)
    sel = new
    if session_id:
        tagged = [r for r in sel if r.get("sessionId") == session_id]
        if tagged:                           # only trust the filter if records actually carry it
            sel = tagged
    lines = []
    for r in sel:
        role = r.get("role", "?")
        tn = r.get("toolName")
        c = r.get("content", "")
        if not isinstance(c, str):
            c = json.dumps(c, ensure_ascii=False)
        tag = role + (f"/{tn}" if tn else "")
        lines.append(f"[{tag}] {c}")
    body = "\n".join(lines)
    note = ""
    if len(body) > MCP_CHAR_BUDGET:
        body = body[-MCP_CHAR_BUDGET:]          # keep the RECENT tail of the new delta
        note = (f"(NOTE: the new conversation.mcp delta exceeded {MCP_CHAR_BUDGET} chars; "
                f"showing its MOST RECENT portion.)\n\n")
    return f"{note}{body}", len(sel), total, n_new


# claude prints these to stdout and exits 0/1 — treat as a failed review (fall back).
_ERR_SENTINELS = ("prompt is too long", "no conversation found", "credit balance",
                  "context low", "execution error")


def run_claude(prompt, model, resume_session=None, cwd=None, log=print):
    """Returns (ok, text). ok=False on non-zero exit or a known error sentinel."""
    cmd = ["claude", "-p", prompt, "--model", model, "--output-format", "text", "--tools", ""]
    if resume_session:
        cmd += ["--resume", resume_session, "--fork-session"]
    log(f"claude review: model={model} resume={resume_session or '-'} cwd={cwd or os.getcwd()}")
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=CLAUDE_TIMEOUT)
    except subprocess.TimeoutExpired:
        log("claude review TIMED OUT")
        return False, ""
    text = r.stdout or ""
    low = text.strip().lower()
    if r.returncode != 0 or not low or any(s in low[:120] for s in _ERR_SENTINELS):
        log(f"claude review failed (exit {r.returncode}): {(text or r.stderr or '')[:160]}")
        return False, text
    return True, text


def _parse_attrs(s):
    d = {}
    for key in _ATTR_KEYS:
        m = re.search(rf"\b{key}=(\S+)", s)
        if m:
            d[key] = m.group(1)
    m = re.search(r"\bdesc=(.+)$", s)
    if m:
        d["desc"] = m.group(1).strip()
    return d


def _collect_body(lines, i):
    """Read lines until a line that is exactly @END; return (body, next_index)."""
    body = []
    while i < len(lines) and lines[i].strip() != "@END":
        body.append(lines[i])
        i += 1
    return "\n".join(body).strip(), i + 1  # skip the @END line


def parse_directives(text):
    """Parse @MEMORY / @SKILL / @NOTHING sentinel blocks. Robust to ``` in bodies."""
    if not text:
        return None
    if "@MEMORY" not in text and "@SKILL" not in text:
        return {"memory": [], "skills": [], "notes": "nothing durable"} if "@NOTHING" in text else None
    lines = text.splitlines()
    mem, skills, i = [], [], 0
    while i < len(lines):
        ln = lines[i].strip()
        if ln.startswith("@MEMORY"):
            attrs = _parse_attrs(ln[len("@MEMORY"):])
            body, i = _collect_body(lines, i + 1)
            if body:
                mem.append({"target": attrs.get("target", "memory"), "text": body})
        elif ln.startswith("@SKILL"):
            attrs = _parse_attrs(ln[len("@SKILL"):])
            body, i = _collect_body(lines, i + 1)
            if attrs.get("name"):
                skills.append({"action": attrs.get("action", "create"), "name": attrs["name"],
                               "description": attrs.get("desc", ""), "content": body})
        else:
            i += 1
    if not mem and not skills:
        return None
    return {"memory": mem, "skills": skills, "notes": ""}


def _cli(argv, log):
    try:
        r = subprocess.run([sys.executable] + argv, capture_output=True, text=True, timeout=60)
        out = (r.stdout or "").strip()
        ok = '"ok": true' in out or '"success": true' in out
        return ok, out
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


def persist(plan, log):
    saved = {"memory": 0, "skills": 0}
    for m in plan.get("memory", []) or []:
        target = m.get("target", "memory")
        text = (m.get("text") or "").strip()
        if not text or target not in ("memory", "user"):
            continue
        ok, out = _cli([MEM_CLI, "add", "--target", target, "--text", text, "--actor", "reviewer"], log)
        saved["memory"] += int(ok)
        log(f"  mem add [{target}] ok={ok}: {text[:70]}")
    for s in plan.get("skills", []) or []:
        action, name = s.get("action"), (s.get("name") or "").strip()
        if not name:
            continue
        if action == "create":
            ok, out = _cli([SKILL_CLI, "create", "--name", name,
                            "--description", (s.get("description") or "")[:60],
                            "--content", s.get("content") or ""], log)
        elif action == "patch":
            ok, out = _cli([SKILL_CLI, "patch", "--name", name, "--content", s.get("content") or ""], log)
        else:
            continue
        saved["skills"] += int(ok)
        log(f"  skill {action} {name}: ok={ok} {out[:80]}")
    return saved


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--resume-session", help="cliSessionId to resume for full context (preferred)")
    ap.add_argument("--cwd", help="cwd the session was spawned in (claude resolves --resume relative to it)")
    ap.add_argument("--mcp", help="conversation.mcp (COMPLETE append-only log) — preferred over --transcript")
    ap.add_argument("--mcp-since", type=int, default=0,
                    help="only review MCP records with index >= this (incremental; avoids re-review)")
    ap.add_argument("--session-id", help="optional: best-effort filter MCP records to this session id")
    ap.add_argument("--transcript", help="last-resort fallback: review a lossy .md transcript")
    ap.add_argument("--model", default=DEFAULT_MODEL, help="reviewer model (default: claude-opus-4-8, subscription)")
    args = ap.parse_args()

    def log(m):
        print(f"[learn] {m}", flush=True)

    if not args.resume_session and not args.mcp and not args.transcript:
        log("need --resume-session, --mcp, or --transcript")
        sys.exit(2)

    # Context priority: resume (claude native, richest tool I/O) → conversation.mcp
    # (COMPLETE append-only log, replaces the lossy .md) → .md transcript (last resort).
    # OpenRouter sessions have no claude native session, so they now get the full MCP
    # instead of the 120k-truncated .md.
    # Level-1 QA: load the current persistent memory once so every review path can cross-reference
    # it and propose ONLY the gaps the mid-conversation distillation missed.
    mem_dig = current_memory_digest(log=log)
    if mem_dig:
        log(f"cross-referencing {len(mem_dig)} chars of existing memory (gap-capture QA)")

    raw, ok = "", False
    if args.resume_session:
        ok, raw = run_claude(build_prompt(transcript=None, memory_digest=mem_dig), args.model,
                             resume_session=args.resume_session, cwd=args.cwd, log=log)
    if not ok and args.mcp and Path(args.mcp).exists():
        if args.resume_session:
            log("resume failed — falling back to conversation.mcp (complete log)")
        rendered, shown, total, n_new = render_mcp(
            args.mcp, since_record=args.mcp_since, session_id=args.session_id)
        if n_new == 0:
            log(f"mcp: no new records since offset {args.mcp_since}/{total} — "
                f"nothing new to learn from MCP; trying .md fallback")
        else:
            log(f"mcp mode: {shown} new record(s) reviewed (total {total}, since {args.mcp_since})")
            ok, raw = run_claude(build_prompt(rendered, memory_digest=mem_dig), args.model, log=log)
    if not ok:
        # Last resort: the capped .md transcript.
        if args.transcript and Path(args.transcript).exists():
            if args.resume_session or args.mcp:
                log("falling back to capped .md transcript mode")
            ok, raw = run_claude(build_prompt(Path(args.transcript).read_text(errors="ignore"),
                                              memory_digest=mem_dig), args.model, log=log)
        if not ok:
            log("review failed and no usable fallback — aborting")
            sys.exit(1)

    plan = parse_directives(raw)
    if plan is None:
        log(f"could not parse directives from the review. First 300 chars:\n{(raw or '')[:300]}")
        sys.exit(1)

    log(f"plan: {len(plan.get('memory', []) or [])} memory, {len(plan.get('skills', []) or [])} skills | "
        f"notes: {plan.get('notes', '')[:160]}")
    saved = persist(plan, log)
    log(f"DONE — saved {saved['memory']} memory entr(y/ies), {saved['skills']} skill update(s)")
    sys.exit(0)


if __name__ == "__main__":
    main()
