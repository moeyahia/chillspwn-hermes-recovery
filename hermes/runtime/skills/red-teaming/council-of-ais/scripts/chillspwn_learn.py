#!/usr/bin/env python3
"""
chillspwn_learn.py — ChillsPwn post-session continuous-learning reviewer.

ChillsPwn runs as `claude -p`, so it never gets Hermes' built-in self-improvement.
This reviews a finished session and saves durable MEMORY + reusable SKILLS for
future sessions.

ENGINE (per the operator): Claude Opus via `claude -p` — SUBSCRIPTION auth (counts
against the plan, NOT API credits). The reviewer RESUMES the finished session
with `--resume <cliSessionId> --fork-session`, so Opus reflects with the session's
FULL NATIVE CONTEXT — including every tool call and its output, which the exported
.md transcript loses. `--fork-session` means the review happens in a NEW session id,
so the user's original conversation is left untouched (no pollution).

SAFETY (per the operator — "what if the reviewer removes something important?"):
The model does NOT write to memory itself. It emits a single directive plan;
THIS runtime preflights and persists it through the ADDITIVE-ONLY chillspwn_mem.py /
chillspwn_skill.py CLIs. Consequences:
  • The reviewer can only ADD memory + CREATE/PATCH skills — removal/replace is
    structurally impossible from this path. A rejected or failed review remains
    retryable without deleting prior knowledge.
  • chillspwn_mem.py also takes a backup before every write, protects 📌 pinned
    entries, soft-deletes to ARCHIVE.md, and logs an audit trail — those guard the
    SEPARATE, human-gated curator path.
  • No tool-permission hangs in headless/root mode (we pass `--tools ""`).

Modes:
  --resume-session <cliSessionId> [--cwd DIR]   resume for full context (PREFERRED)
  --mcp <conversation.mcp> [--mcp-since N]      review an incremental complete log
  --transcript <file.md>                        fallback: review a .md (no resume)
  --success-marker <file.json>                  acknowledge only complete persistence
"""
import argparse
import hashlib
import ipaddress
import json
import os
import re
import subprocess
import sys
from pathlib import Path

# V2.4 containment boundary: this legacy reviewer resumes a public-model session
# with complete native tool context or falls back to an unbounded engagement
# transcript. That trust model cannot produce the required sanitized
# LearningCandidateBrief or ProviderExposureReceipt, so direct execution is
# deliberately disabled before reading any transcript, memory, or environment
# configuration. Keep the module importable for the additive local validators
# used by chillspwn_mem.py and chillspwn_skill.py. A replacement belongs in the
# V2 Research/Learning service and must promote only through human review.
LEGACY_FULL_CONTEXT_PUBLIC_REVIEW_DISABLED = True
if __name__ == "__main__" and LEGACY_FULL_CONTEXT_PUBLIC_REVIEW_DISABLED:
    print(
        "[learn] blocked: the legacy full-context public-model reviewer is disabled; "
        "use the V2 sanitized candidate and exposure-receipt workflow",
        flush=True,
    )
    raise SystemExit(78)

HERMES_SRC = os.environ.get("CHILLSPWN_HERMES_SRC", "").strip()
if not HERMES_SRC:
    raise RuntimeError("CHILLSPWN_HERMES_SRC is required")
if not Path(HERMES_SRC, "agent").is_dir():
    raise RuntimeError("CHILLSPWN_HERMES_SRC does not contain the Hermes agent package")
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
    "For a genuinely cross-target provider/tool/environment fact, or an operator preference "
    "(ONE fact per block):\n"
    "@MEMORY target=memory\n"
    "<the global fact. Use target=user for an operator preference. Never put target or engagement state here.>\n"
    "@END\n\n"
    "For a NEW generalized attack-chain playbook:\n"
    "@SKILL action=create name=kebab-name desc=short description up to 60 chars\n"
    "<markdown containing headings for Prerequisites/Signals, Ordered Attack Chain, "
    "Command Templates, Validation, Failure Recovery, Cleanup, Tools, and References; "
    "the References section must include at least one reusable technical URL>\n"
    "@END\n\n"
    "To extend an EXISTING skill created by a prior automated reviewer (never a bundled/reviewed skill):\n"
    "@SKILL action=patch name=kebab-name\n"
    "<markdown to append>\n"
    "@END\n\n"
    "Bundled/reviewed skills are immutable. If their guidance needs an additive extension, create a "
    "NEW distinct technique-oriented top-level skill instead of patching the reviewed name.\n\n"
    "If nothing is worth saving, output exactly one line: @NOTHING"
)
_ATTR_KEYS = ("target", "action", "name")

ADDITIVE_RULE = (
    "ADDITIVE-ONLY (critical): you may only PROPOSE NEW memory entries and NEW/UPDATED "
    "skills. NEVER propose removing or replacing existing memory — if something is now "
    "stale, write a NEW entry that supersedes it and say so in the text. A separate, "
    "human-gated curator handles consolidation. Do NOT use any tools — output only the directive blocks."
)

COMMAND_LEARNING_RULE = (
    "CAPTURE EXECUTABLE SYNTAX WITHOUT TARGET IDENTITY: retain the reusable command structure, flags, "
    "ordering, and expected result, but replace every target value with explicit placeholders such as "
    "<TARGET_HOST>, <TARGET_PORT>, <DOMAIN>, <USER_REF>, <CREDENTIAL_REF>, <LHOST>, and <LPORT>. "
    "Fold a repeatable multi-step procedure into one @SKILL. Record conditional failures under Failure "
    "Recovery, never as a global rule to skip a technique. Do not save one-off target commands or results "
    "as @MEMORY."
)

ATTACK_CHAIN_RULE = (
    "HIGHEST-PRIORITY ATTACK-CHAIN MEMORY POLICY: preserve the reusable chain, not the target that "
    "demonstrated it. The playbook name and title must be technique-oriented. Include prerequisites and "
    "signals; ordered executable steps; generalized command templates; validation checkpoints; failure "
    "recovery; cleanup; tools; and references that help execute or understand the technique (official or "
    "vendor documentation, tool documentation, advisories, general research, or reusable exploit "
    "repositories). NEVER include a lab or box name or URL, a copied walkthrough, a literal target address, "
    "domain, username, credential, token, hash, proof string, private key, or engagement-specific path. "
    "Raw target facts remain in protected evidence, reports, ledgers, and transcripts."
)


MEM_DIGEST_CAP = int(os.environ.get("CHILLSPWN_LEARN_MEM_CHARS", "80000"))

QA_GAP_RULE = (
    "FINAL-QA / GAP CAPTURE: a lightweight mid-conversation distiller already captured the obvious "
    "structured findings live (into per-session engagement state). You are the FINAL pass over the WHOLE "
    "conversation. Cross-reference the CURRENT PERSISTENT MEMORY shown below and propose ONLY what is "
    "MISSING from it: generalized attack chains and genuinely cross-target tool/provider behavior. Do NOT "
    "promote engagement facts, credentials, proof strings, target addresses, or named-target history. Do NOT "
    "restate what memory already contains — your value is a concise, executable, target-agnostic playbook."
)


def _fingerprint(value):
    """Return non-reversible log metadata; never echo reviewed content or secrets."""
    raw = (value or "").encode("utf-8", errors="replace")
    return f"len={len(raw)} sha256={hashlib.sha256(raw).hexdigest()}"


def current_memory_digest(cap=MEM_DIGEST_CAP, log=print):
    """Read the current USER.md + MEMORY.md so the reviewer can cross-reference and capture only gaps
    (Level-1 QA). Resolved via chillspwn_mem.get_memory_dir() — the SAME dir the persist path writes to."""
    try:
        from chillspwn_mem import get_memory_dir, safe_read_memory
        d = Path(str(get_memory_dir()))
    except Exception as e:
        log(f"memory digest: cannot resolve memory dir ({type(e).__name__})")
        return ""
    out = []
    for name, target in (("USER.md", "user"), ("MEMORY.md", "memory")):
        result = safe_read_memory(target, d / name)
        content = result.get("content", "") if result.get("ok") else ""
        if content:
            out.append(f"### {name}\n" + content)
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
    parts = [head, "", _COMBINED_REVIEW_PROMPT, "", ATTACK_CHAIN_RULE, "", COMMAND_LEARNING_RULE]
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
    # Send large review input over stdin. Passing transcript + memory as an argv value can
    # exceed Linux ARG_MAX before the reviewer process starts.
    cmd = ["claude", "-p", "--model", model, "--output-format", "text", "--tools", ""]
    if resume_session:
        cmd += ["--resume", resume_session, "--fork-session"]
    log(f"claude review: model={model} resume={'yes' if resume_session else 'no'} cwd_configured={'yes' if cwd else 'no'}")
    try:
        r = subprocess.run(
            cmd, cwd=cwd, input=prompt, capture_output=True, text=True,
            timeout=CLAUDE_TIMEOUT,
        )
    except subprocess.TimeoutExpired:
        log("claude review TIMED OUT")
        return False, ""
    text = r.stdout or ""
    low = text.strip().lower()
    if r.returncode != 0 or not low or any(s in low[:120] for s in _ERR_SENTINELS):
        log(
            f"claude review failed (exit {r.returncode}); "
            f"stdout {_fingerprint(text)}; stderr {_fingerprint(r.stderr or '')}"
        )
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
        return ({"memory": [], "skills": [], "notes": "nothing durable", "nothing": True}
                if text.strip() == "@NOTHING" else None)
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
    return {"memory": mem, "skills": skills, "notes": "", "nothing": False}


def _cli(argv, log):
    try:
        r = subprocess.run([sys.executable] + argv, capture_output=True, text=True, timeout=60)
        out = (r.stdout or "").strip()
        try:
            result = json.loads(out)
        except (TypeError, json.JSONDecodeError):
            result = {}
        ok = bool(result.get("ok") is True or result.get("success") is True)
        return ok, out
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"


_NON_REUSABLE_PATTERNS = (
    ("practice-target reference", re.compile(
        r"\b(?:HTB|Hack\s*The\s*Box|VulnLab|TryHackMe)\b|"
        r"(?:hackthebox|vulnlab|tryhackme)\.com", re.I)),
    ("practice-target path/domain", re.compile(
        r"(?:^|[\\/])(?:root[\\/])?htb[\\/]boxes[\\/]|\.htb\b", re.I)),
    ("engagement path", re.compile(
        r"(?:^|[\\/])(?:root|home[\\/][^\\/]+)[\\/]"
        r"(?:engagements|labs|targets|machines)[\\/]", re.I)),
    ("target-like domain", re.compile(
        r"\b[a-z0-9][a-z0-9.-]*\.(?:local|internal|lan|test)\b", re.I)),
    ("proof/hash", re.compile(
        r"\b(?:HTB|FLAG|root|user)\{[^}\n]+\}|\b[a-f0-9]{32,}\b", re.I)),
    ("private key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("authorization secret", re.compile(
        r"(?im)^\s*Authorization\s*:\s*(?:Bearer|Basic)\s+"
        r"(?!<(?:CREDENTIAL|TOKEN|SECRET|API_KEY)_REF>)\S+")),
    ("credential/token", re.compile(
        r"\b(?:password|passwd|pwd|token|secret|api[_ -]?key)\s*[:=]\s*"
        r"(?!<(?:CREDENTIAL|TOKEN|SECRET|API_KEY)_REF>)\S+", re.I)),
    ("credential argument", re.compile(
        r"(?<!\S)(?:--password|--passwd|--token|--api[-_]?key|--hash(?:es)?)"
        r"(?:\s+|=)(?!<(?:CREDENTIAL|TOKEN|SECRET|API_KEY|HASH)_REF>)\S+", re.I)),
    ("username argument", re.compile(
        r"(?<!\S)(?:-u|--user(?:name)?|--login)(?:\s+|=)"
        r"(?!<(?:USER|USERNAME|USER_REF)>)\S+", re.I)),
    ("target user home", re.compile(
        r"(?:/home/|[A-Z]:[\\/]Users[\\/])(?!<(?:USER|USER_REF)>)[^\s\\/`\"']+", re.I)),
    ("embedded JWT", re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b")),
)

_PLAYBOOK_HEADINGS = (
    ("prerequisites/signals", re.compile(r"(?im)^#{1,4}\s+.*(?:prerequisite|signal)")),
    ("ordered chain", re.compile(r"(?im)^#{1,4}\s+.*(?:attack chain|ordered steps|procedure)")),
    ("commands", re.compile(r"(?im)^#{1,4}\s+.*command")),
    ("validation", re.compile(r"(?im)^#{1,4}\s+.*(?:validation|verification|success criteria)")),
    ("failure recovery", re.compile(r"(?im)^#{1,4}\s+.*(?:failure|recovery|troubleshoot)")),
    ("cleanup", re.compile(r"(?im)^#{1,4}\s+.*cleanup")),
    ("tools", re.compile(r"(?im)^#{1,4}\s+.*tools?\b")),
    ("references", re.compile(r"(?im)^#{1,4}\s+.*reference")),
)

_IP_TOKEN = re.compile(
    r"(?<![0-9A-Za-z])(?:\[(?:[0-9A-Fa-f:]{2,})\]|(?:\d{1,3}\.){3}\d{1,3}|[0-9A-Fa-f:]{2,})(?![0-9A-Za-z])"
)
_SOURCE_CONTEXT_ANCHORS = frozenset(("boxes", "engagements", "labs", "targets", "machines"))
_LITERAL_URL = re.compile(
    r"\b(?:https?|ftp)://"
    r"(?!<(?:TARGET_URL|REFERENCE_URL|TARGET_HOST|TARGET_DOMAIN)>)[^\s)>`'\"]+",
    re.I,
)
_LITERAL_DOMAIN = re.compile(
    r"\b(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,63}\b",
    re.I,
)
_TARGET_USERNAME_PATTERNS = (
    re.compile(
        r"(?:\b(?:user(?:name)?|login|account)\s*[:=]\s*|(?:^|\s)-(?:u|U)\s+|\\|/home/)"
        r"(?P<username>(?!<(?:USER|USER_REF)>)[a-z][a-z0-9._$-]{1,31})\b",
        re.I | re.MULTILINE,
    ),
    re.compile(
        r"\b(?:user(?:name)?|account)\s+"
        r"(?P<username>(?!<(?:USER|USER_REF)>)[a-z][a-z0-9._$-]{1,31})\b",
        re.I,
    ),
    re.compile(
        r"\blog(?:in)?\s+as\s+"
        r"(?P<username>(?!<(?:USER|USER_REF)>)[a-z][a-z0-9._$-]{1,31})\b",
        re.I,
    ),
)
_GENERIC_USERNAME_WORDS = frozenset({
    "access", "account", "accounts", "authentication", "authorization", "context",
    "creation", "data", "directory", "enumeration", "field", "fields", "flow", "home",
    "input", "inputs", "management", "name", "names", "profile", "profiles", "role",
    "roles", "session", "sessions", "supplied", "validation",
})
_BARE_NAMED_TARGET = re.compile(
    r"\b(?:box|machine|target|host|engagement)\s+(?:named\s+)?[\"'`]?"
    r"[A-Z][A-Za-z0-9_-]{2,}[\"'`]?(?=$|[\s.,;:!?)}\]])"
)
_EXPLICIT_NAMED_TARGET = re.compile(
    r"\b(?:box|machine|target|host|engagement)\s+"
    r"(?:named\s+[\"'`]?[a-z][a-z0-9_-]{2,}[\"'`]?|"
    r"[\"'`][a-z][a-z0-9_-]{2,}[\"'`])(?=$|[\s.,;:!?)}\]])",
    re.I,
)
_NATURAL_CREDENTIAL_PATTERNS = (
    ("natural-language secret", re.compile(
        r"\b(?P<label>password|passwd|pwd|secret|token|api[_ -]?key)\s+"
        r"(?:is|was)\s+(?P<value>\S+)", re.I)),
    ("natural-language token", re.compile(
        r"\buse\s+(?:the\s+)?token\s+(?P<value>\S+)", re.I)),
    ("credential pair", re.compile(
        r"\bcredentials?\s+(?P<username>\S+?):(?P<value>\S+)", re.I)),
    ("login credential pair", re.compile(
        r"\blog(?:in)?\s+with\s+(?P<username>\S+)\s+and\s+(?P<value>\S+)", re.I)),
)
_GENERIC_SECRET_WORDS = frozenset({
    "accepted", "authentication", "authorization", "changed", "correct", "expired",
    "hidden", "incorrect", "invalid", "masked", "missing", "provided", "redacted",
    "rejected", "required", "rotated", "rotation", "supplied", "unavailable", "unknown",
    "validation",
})
_MARKDOWN_HEADING = re.compile(r"^(#{1,6})\s+(.+?)\s*$")


def _parsed_ip(value):
    token = (value or "").strip("[]")
    if ":" not in token and "." not in token:
        return None
    try:
        return ipaddress.ip_address(token)
    except ValueError:
        return None


def _contains_literal_ip(text):
    return any(_parsed_ip(match.group(0)) is not None for match in _IP_TOKEN.finditer(text or ""))


def _replace_literal_ips(text):
    return _IP_TOKEN.sub(
        lambda match: "<TARGET_HOST>" if _parsed_ip(match.group(0)) is not None else match.group(0),
        text or "",
    )


def _source_target_names(source_context):
    """Derive ephemeral target labels from conventional workspace anchors.

    Values are used only for deterministic removal and are never persisted.
    """
    if not source_context:
        return ()
    parts = Path(source_context).parts
    lowered = [part.lower() for part in parts]
    names = []
    for index, part in enumerate(lowered[:-1]):
        if part in _SOURCE_CONTEXT_ANCHORS:
            candidate = parts[index + 1].strip()
            if len(candidate) >= 3 and not (candidate.startswith("<") and candidate.endswith(">")):
                names.append(candidate)
    return tuple(sorted(set(names), key=str.lower))


def _placeholder(value):
    return bool(re.fullmatch(
        r"<(?:USER|USER_REF|USERNAME|CREDENTIAL|CREDENTIAL_REF|TOKEN|TOKEN_REF|"
        r"SECRET|SECRET_REF|API_KEY|API_KEY_REF)>",
        (value or "").strip(".,;:()[]{}\"'`"),
        re.I,
    ))


def _generic_word(value, vocabulary):
    return (value or "").strip(".,;:()[]{}\"'`").lower() in vocabulary


def _contains_target_username(text):
    for pattern in _TARGET_USERNAME_PATTERNS:
        for match in pattern.finditer(text or ""):
            username = match.group("username")
            if not _placeholder(username) and not _generic_word(username, _GENERIC_USERNAME_WORDS):
                return True
    return False


def _contains_named_target(text):
    return bool(
        _BARE_NAMED_TARGET.search(text or "")
        or _EXPLICIT_NAMED_TARGET.search(text or "")
    )


def _natural_credential_violations(text):
    problems = []
    for label, pattern in _NATURAL_CREDENTIAL_PATTERNS:
        for match in pattern.finditer(text or ""):
            values = [
                match.groupdict().get(key)
                for key in ("username", "value")
                if match.groupdict().get(key) is not None
            ]
            if values and all(
                _placeholder(value) or _generic_word(value, _GENERIC_SECRET_WORDS | _GENERIC_USERNAME_WORDS)
                for value in values
            ):
                continue
            problems.append(label)
            break
    return problems


def _markdown_reference_parts(text):
    """Return (ordinary text, dedicated References text) for field-aware scanning.

    Public URLs and domains are reusable only inside a Markdown References section.
    A References heading owns its nested subsections until the next heading at the
    same or a higher level. This mirrors AttackLesson's dedicated references field.
    """
    ordinary, references = [], []
    in_references = False
    reference_level = 7
    for line in (text or "").splitlines():
        heading = _MARKDOWN_HEADING.match(line)
        if heading:
            level = len(heading.group(1))
            title = heading.group(2)
            if re.search(r"\breferences?\b", title, re.I):
                in_references = True
                reference_level = level
            elif in_references and level <= reference_level:
                in_references = False
                reference_level = 7
        (references if in_references else ordinary).append(line)
    return "\n".join(ordinary), "\n".join(references)


def reusable_content_violations(
    text,
    source_context=None,
    require_playbook=False,
    reference_aware=False,
):
    """Fail closed when reusable text retains target identity or an incomplete chain.

    The strict scan intentionally matches the TypeScript AttackLesson boundary:
    executable/durable text cannot contain literal URLs, domains, usernames, or
    named targets. Public URLs/domains are allowed only in a dedicated References
    section; target identifiers and secrets remain forbidden everywhere.
    """
    text = (text or "").strip()
    problems = [label for label, pattern in _NON_REUSABLE_PATTERNS if pattern.search(text)]
    if _contains_literal_ip(text):
        problems.append("literal IP address")
    for target_name in _source_target_names(source_context):
        if re.search(rf"(?i)(?<![a-z0-9]){re.escape(target_name)}(?![a-z0-9])", text):
            problems.append("source target name")
            break
    ordinary_text, reference_text = (
        _markdown_reference_parts(text)
        if (reference_aware or require_playbook)
        else (text, "")
    )
    if _LITERAL_URL.search(ordinary_text):
        problems.append("literal URL outside References")
    if _LITERAL_DOMAIN.search(ordinary_text):
        problems.append("literal domain outside References")
    if _contains_target_username(ordinary_text):
        problems.append("target username")
    if _contains_named_target(ordinary_text):
        problems.append("named target")
    problems.extend(_natural_credential_violations(ordinary_text))
    if require_playbook:
        problems.extend(
            f"missing {label} section"
            for label, pattern in _PLAYBOOK_HEADINGS
            if not pattern.search(text)
        )
        if "<TECHNICAL_REFERENCE_REQUIRED>" in text:
            problems.append("unresolved reference placeholder")
        reusable_urls = [
            url for url in re.findall(r"https?://[^\s)>`]+", reference_text, re.I)
            if not re.search(r"(?:hackthebox|vulnlab|tryhackme)\.com", url, re.I)
            and "<" not in url
        ]
        if not reusable_urls:
            problems.append("missing reusable reference URL")
    return sorted(set(problems))


_GENERALIZATION_RULES = (
    # Replace the most specific artifacts first. Replacements remain executable
    # operator-supplied placeholders rather than opaque redactions.
    (re.compile(
        r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
        re.I | re.S,
    ), "<PRIVATE_KEY_REF>"),
    (re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"), "<TOKEN_REF>"),
    (re.compile(r"(?im)^(\s*Authorization\s*:\s*)(?:Bearer|Basic)\s+\S+"),
     r"\1Bearer <TOKEN_REF>"),
    (re.compile(r"(?i)(https?://)[^\s/:@]+:[^\s/@]+@"),
     r"\1<USER_REF>:<CREDENTIAL_REF>@"),
    (re.compile(r"\b(?:HTB|FLAG|root|user)\{[^}\n]+\}", re.I), "<TARGET_ARTIFACT_REF>"),
    (re.compile(r"\b[a-f0-9]{32,}\b", re.I), "<HASH_REF>"),
    (re.compile(
        r"(?i)(?<!\S)(--password|--passwd|--token|--api[-_]?key|--hash(?:es)?)(\s+|=)\S+"
    ), r"\1\2<CREDENTIAL_REF>"),
    (re.compile(
        r"(?im)^((?=.*\b(?:hydra|medusa|nxc|netexec|crackmapexec|evil-winrm|mysql|psql|smbclient)\b).*?)"
        r"(-p)(\s+)\S+"
    ), r"\1\2\3<CREDENTIAL_REF>"),
    (re.compile(r"(?i)(?<!\S)(-u|--user(?:name)?|--login)(\s+|=)\S+"),
     r"\1\2<USER_REF>"),
    (re.compile(r"(?i)(?<!\S)(--domain)(\s+|=)\S+"), r"\1\2<DOMAIN>"),
    (re.compile(
        r"\b(password|passwd|pwd|token|secret|api[_ -]?key)(\s*[:=]\s*)\S+",
        re.I,
    ), r"\1\2<CREDENTIAL_REF>"),
    (re.compile(r"\b(user|username|login)(\s*[:=]\s*)(?!<(?:USER|USER_REF)>)\S+", re.I),
     r"\1\2<USER_REF>"),
    (re.compile(r"\b(account)(\s*[:=]\s*)(?!<(?:USER|USER_REF)>)\S+", re.I),
     r"\1\2<USER_REF>"),
    (re.compile(
        r"\b((?:box|machine|target|host|engagement)\s+(?:named\s+)?[\"'`]?)"
        r"[A-Z][A-Za-z0-9_-]{2,}([\"'`]?)(?=$|[\s.,;:!?)}\]])"
    ), r"\1<TARGET_CONTEXT>\2"),
    (re.compile(
        r"\b((?:box|machine|target|host|engagement)\s+"
        r"(?:named\s+[\"'`]?|[\"'`]))[a-z][a-z0-9_-]{2,}([\"'`]?)"
        r"(?=$|[\s.,;:!?)}\]])",
        re.I,
    ), r"\1<TARGET_CONTEXT>\2"),
    (re.compile(r"https?://(?:www\.)?(?:hackthebox|vulnlab|tryhackme)\.com/\S*", re.I),
     "<TECHNICAL_REFERENCE_REQUIRED>"),
    (re.compile(
        r"/(?:root|home/[^/]+)/(?:htb/boxes|engagements|labs|targets|machines)/[^\s`\"']+",
        re.I,
    ), "<ENGAGEMENT_DIR>"),
    (re.compile(r"/home/(?!<(?:USER|USER_REF)>)[^/\s`\"']+", re.I), "/home/<USER_REF>"),
    (re.compile(r"(?i)[A-Z]:[\\/]Users[\\/](?!<(?:USER|USER_REF)>)[^\\/\s`\"']+"),
     r"C:\\Users\\<USER_REF>"),
    (re.compile(r"\b[^\s@:/]+@(?:[a-z0-9][a-z0-9.-]*\.[a-z]{2,}|<TARGET_DOMAIN>)\b", re.I),
     "<USER_REF>@<TARGET_DOMAIN>"),
    (re.compile(r"(?<![A-Za-z0-9_])(?:[A-Za-z0-9_.-]+\\)+[A-Za-z0-9_.$-]+"),
     r"<DOMAIN>\\<USER_REF>"),
    (re.compile(r"\b[a-z0-9][a-z0-9.-]*\.(?:htb|local|internal|lan|test)\b", re.I),
     "<TARGET_DOMAIN>"),
    (re.compile(r"(?i)(\bLHOST\s*=\s*)(?:\d{1,3}\.){3}\d{1,3}\b"), r"\1<LHOST>"),
    (re.compile(r"(?i)(\bLPORT\s*=\s*)\d{1,5}\b"), r"\1<LPORT>"),
    (re.compile(r"(?i)(\bRPORT\s*=\s*)\d{1,5}\b"), r"\1<TARGET_PORT>"),
    (re.compile(r"\b(?:HTB|Hack\s*The\s*Box|VulnLab|TryHackMe)\b", re.I), "authorized lab"),
)


def _replace_match_groups(text, pattern, replacements, generic_words=frozenset()):
    """Replace selected named groups without retaining captured values in logs."""
    count = 0

    def replace(match):
        nonlocal count
        rendered = match.group(0)
        edits = []
        for group_name, placeholder in replacements.items():
            value = match.groupdict().get(group_name)
            if value is None or _placeholder(value) or _generic_word(value, generic_words):
                continue
            start, end = match.span(group_name)
            base = match.start()
            edits.append((start - base, end - base, placeholder))
        for start, end, placeholder in sorted(edits, reverse=True):
            rendered = rendered[:start] + placeholder + rendered[end:]
            count += 1
        return rendered

    return pattern.sub(replace, text or ""), count


def _generalize_natural_language(text):
    out = text or ""
    replacements = []
    for pattern in _TARGET_USERNAME_PATTERNS:
        out, count = _replace_match_groups(
            out,
            pattern,
            {"username": "<USER_REF>"},
            _GENERIC_USERNAME_WORDS,
        )
        if count:
            replacements.append("<USER_REF>")
    for label, pattern in _NATURAL_CREDENTIAL_PATTERNS:
        groups = {"username": "<USER_REF>", "value": "<CREDENTIAL_REF>"}
        if label == "natural-language token":
            groups["value"] = "<TOKEN_REF>"
        out, count = _replace_match_groups(
            out,
            pattern,
            groups,
            _GENERIC_SECRET_WORDS | _GENERIC_USERNAME_WORDS,
        )
        if count:
            replacements.extend(groups.values())
    return out, sorted(set(replacements))


def generalize_reusable_text(text, source_context=None):
    """Deterministically replace target artifacts with explicit placeholders."""
    out = text or ""
    changed = []
    for pattern, replacement in _GENERALIZATION_RULES:
        out, count = pattern.subn(replacement, out)
        if count:
            changed.append(replacement)
    out, natural_replacements = _generalize_natural_language(out)
    changed.extend(natural_replacements)
    generalized_ips = _replace_literal_ips(out)
    if generalized_ips != out:
        out = generalized_ips
        changed.append("<TARGET_HOST>")
    for target_name in _source_target_names(source_context):
        out, count = re.subn(
            rf"(?i)(?<![a-z0-9]){re.escape(target_name)}(?![a-z0-9])",
            "<TARGET_CONTEXT>",
            out,
        )
        if count:
            changed.append("<TARGET_CONTEXT>")
    return out, sorted(set(changed))


def generalize_skill_name(name, source_context=None):
    """Keep skill identifiers technique-oriented and independent of source targets."""
    out = name or ""
    for target_name in _source_target_names(source_context):
        out = re.sub(
            rf"(?i)(?<![a-z0-9]){re.escape(target_name)}(?![a-z0-9])",
            "",
            out,
        )
    out = re.sub(r"(?i)\b(?:htb|hack-the-box|vulnlab|tryhackme)\b", "", out)
    out = re.sub(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", "target", out)
    out = re.sub(r"[^a-zA-Z0-9-]+", "-", out.lower())
    out = re.sub(r"-{2,}", "-", out).strip("-")
    return out or "generalized-attack-chain"


def persist(plan, log, source_context=None):
    saved = {"memory": 0, "skills": 0, "generalized": 0, "rejected": 0, "failed": 0}
    prepared_memory = []
    prepared_skills = []
    proposed_skill_names = set()

    # Preflight the entire plan before the first write. Retries are then safe because
    # both memory adds and skill patches are exact-content idempotent.
    for m in plan.get("memory", []) or []:
        target = m.get("target", "memory")
        text = (m.get("text") or "").strip()
        if not text:
            saved["rejected"] += 1
            log("  REJECTED empty memory proposal")
            continue
        if target not in ("memory", "user"):
            saved["rejected"] += 1
            log("  REJECTED memory proposal: invalid persistence target")
            continue
        problems = reusable_content_violations(text, source_context)
        if problems:
            saved["rejected"] += 1
            log("  REJECTED global-memory proposal; target state remains in protected evidence: "
                + ", ".join(problems))
            continue
        prepared_memory.append((target, text))

    for s in plan.get("skills", []) or []:
        action, name = s.get("action"), (s.get("name") or "").strip()
        content = (s.get("content") or "").strip()
        if not name:
            saved["rejected"] += 1
            log("  REJECTED skill proposal: missing technique-oriented name")
            continue
        if not content:
            saved["rejected"] += 1
            log("  REJECTED skill proposal: empty playbook content")
            continue
        generalized_name = generalize_skill_name(name, source_context)
        generalized_content, replacements = generalize_reusable_text(content, source_context)
        original_description = (s.get("description") or "")[:60]
        generalized_description, description_replacements = generalize_reusable_text(
            original_description, source_context,
        )
        replacements = sorted(set(replacements + description_replacements))
        if (generalized_name != name or generalized_content != content
                or generalized_description != original_description):
            saved["generalized"] += 1
            log(f"  generalized skill candidate as {generalized_name}: "
                f"{', '.join(replacements) or 'technique-oriented name'}")
        name, content = generalized_name, generalized_content
        if action not in ("create", "patch"):
            saved["rejected"] += 1
            log(f"  REJECTED skill {name}: unsupported additive action")
            continue
        if name in proposed_skill_names:
            saved["rejected"] += 1
            log(f"  REJECTED skill {name}: duplicate skill name in one persistence plan")
            continue
        proposed_skill_names.add(name)
        problems = (
            reusable_content_violations(name, source_context)
            + reusable_content_violations(generalized_description, source_context)
            + reusable_content_violations(
                content,
                source_context,
                require_playbook=action == "create",
                reference_aware=True,
            )
        )
        if problems:
            saved["rejected"] += 1
            log(f"  REJECTED skill {name}: {', '.join(sorted(set(problems)))}")
            continue
        preflight_ok, preflight_out = _cli([
            SKILL_CLI,
            "preflight",
            "--action", action,
            "--name", name,
            "--description", generalized_description,
            "--content", content,
        ], log)
        try:
            preflight_payload = json.loads(preflight_out)
        except (TypeError, json.JSONDecodeError):
            preflight_payload = {}
        if not preflight_ok:
            saved["rejected"] += 1
            violations = preflight_payload.get("violations") or []
            reason = ", ".join(str(item) for item in violations) or "immutable/name-collision preflight"
            log(f"  REJECTED skill {name}: {reason}; response {_fingerprint(preflight_out)}")
            continue
        resolved_action = preflight_payload.get("resolved_action") or action
        prepared_skills.append((resolved_action, name, generalized_description, content))

    if saved["rejected"]:
        log("  preflight rejected the plan; no memory or skill writes were attempted")
        return saved

    for target, text in prepared_memory:
        ok, out = _cli(
            [MEM_CLI, "add", "--target", target, "--text", text, "--actor", "reviewer"],
            log,
        )
        saved["memory"] += int(ok)
        saved["failed"] += int(not ok)
        log(f"  mem add [{target}] ok={ok}; content {_fingerprint(text)}")

    for action, name, description, content in prepared_skills:
        if action == "create":
            ok, out = _cli([SKILL_CLI, "create", "--name", name,
                            "--description", description, "--content", content], log)
            # A previous attempt may have created the playbook before another write failed.
            # Convert that single expected create collision to an idempotent additive patch.
            if not ok and re.search(r"already\s+exists|exists already", out, re.I):
                ok, out = _cli(
                    [SKILL_CLI, "patch", "--name", name, "--content", content],
                    log,
                )
                action = "patch"
        else:
            ok, out = _cli([SKILL_CLI, "patch", "--name", name, "--content", content], log)
        saved["skills"] += int(ok)
        saved["failed"] += int(not ok)
        log(f"  skill {action} {name}: ok={ok}; response {_fingerprint(out)}")
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
    ap.add_argument("--success-marker", help="write an atomic JSON marker only after review and persistence complete")
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
        log(f"could not parse directives from review; output {_fingerprint(raw)}")
        sys.exit(1)

    log(f"plan: {len(plan.get('memory', []) or [])} memory, "
        f"{len(plan.get('skills', []) or [])} skills; "
        f"notes {_fingerprint(plan.get('notes', ''))}")
    saved = persist(plan, log, source_context=args.cwd)
    actionable = len(plan.get("memory", []) or []) + len(plan.get("skills", []) or [])
    if actionable == 0 and not plan.get("nothing"):
        log("review produced no actionable directives and no explicit @NOTHING result")
        sys.exit(1)
    persisted = saved["memory"] + saved["skills"]
    complete = (
        saved["rejected"] == 0
        and saved["failed"] == 0
        and (bool(plan.get("nothing")) or persisted == actionable)
    )
    log(
        f"DONE — saved {saved['memory']} global memory entr(y/ies), "
        f"{saved['skills']} generalized attack-chain skill update(s); "
        f"generalized {saved['generalized']} candidate(s), rejected {saved['rejected']}, "
        f"persistence failures {saved['failed']}"
    )
    if args.success_marker and complete:
        marker = Path(args.success_marker)
        marker.parent.mkdir(parents=True, exist_ok=True)
        tmp = marker.with_suffix(marker.suffix + ".tmp")
        tmp.write_text(json.dumps({"ok": True, "saved": saved}, sort_keys=True))
        os.replace(tmp, marker)
    if not complete:
        log("review remains retryable because reusable candidates were not safely persisted")
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
