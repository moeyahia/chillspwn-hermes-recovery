#!/usr/bin/env python3
"""Shared append-only conversation.mcp log + budget-aware retrieval.
Used by the OpenRouter orchestrator (direct) and the MCP server (for claude).
conversation.mcp lives in the ENGAGEMENT folder, JSONL, append-only, never rewritten."""
import json, os, re, time

FNAME = "conversation.mcp"

def log_path(engagement_dir: str) -> str:
    return os.path.join(engagement_dir or ".", FNAME)

def append(engagement_dir: str, record: dict) -> None:
    """Append one record as a JSON line. Never raises (additive, must not break caller)."""
    try:
        os.makedirs(engagement_dir, exist_ok=True)
        record = dict(record)
        record.setdefault("ts", time.time())
        with open(log_path(engagement_dir), "a") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass

def read_all(engagement_dir: str) -> list:
    out = []
    try:
        with open(log_path(engagement_dir)) as f:
            for line in f:
                line = line.strip()
                if line:
                    try: out.append(json.loads(line))
                    except Exception: pass
    except Exception:
        pass
    return out

def _toklen(s: str) -> int:
    return max(1, len(s) // 4)

def _record_text(r: dict) -> str:
    role = r.get("role", "?")
    tn = r.get("toolName")
    c = r.get("content", "")
    if not isinstance(c, str):
        c = json.dumps(c, ensure_ascii=False)
    tag = f"{role}" + (f"/{tn}" if tn else "")
    return f"[{tag}] {c}"

def recall(engagement_dir: str, query: str = "", max_tokens: int = 8000) -> str:
    """Return up to max_tokens of the most relevant log records for `query`.
    Relevance = keyword overlap; ties broken by recency. Empty query => most recent."""
    recs = read_all(engagement_dir)
    if not recs:
        return "(conversation.mcp empty — nothing recalled)"
    terms = [t.lower() for t in re.findall(r"\w+", query or "") if len(t) > 2]
    scored = []
    for i, r in enumerate(recs):
        txt = _record_text(r)
        low = txt.lower()
        score = sum(low.count(t) for t in terms) if terms else 0
        scored.append((score, i, txt))
    if terms:
        scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    else:
        scored.sort(key=lambda x: x[1], reverse=True)  # recency
    picked, used = [], 0
    for score, i, txt in scored:
        if terms and score == 0 and len(picked) >= 3:
            break
        t = _toklen(txt)
        if used + t > max_tokens:
            continue
        picked.append((i, txt)); used += t
    picked.sort(key=lambda x: x[0])  # chronological for readability
    head = f"Recalled {len(picked)} records (~{used} tok) for query={query!r}:\n"
    return head + "\n".join(t for _, t in picked)

def get_recent(engagement_dir: str, n: int = 20) -> str:
    recs = read_all(engagement_dir)[-n:]
    return "\n".join(_record_text(r) for r in recs) or "(empty)"
