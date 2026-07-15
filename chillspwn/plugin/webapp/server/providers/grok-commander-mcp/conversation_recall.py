#!/usr/bin/env python3
"""Bounded retrieval for an engagement-local append-only conversation log."""
import json
import os
import re


FNAME = "conversation.mcp"


def log_path(engagement_dir: str) -> str:
    return os.path.join(engagement_dir or ".", FNAME)


def read_all(engagement_dir: str) -> list:
    records = []
    try:
        with open(log_path(engagement_dir), encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
                except (ValueError, TypeError):
                    pass
    except OSError:
        pass
    return records


def _token_length(value: str) -> int:
    return max(1, len(value) // 4)


def _record_text(record: dict) -> str:
    role = record.get("role", "?")
    tool_name = record.get("toolName")
    content = record.get("content", "")
    if not isinstance(content, str):
        content = json.dumps(content, ensure_ascii=False)
    tag = f"{role}" + (f"/{tool_name}" if tool_name else "")
    return f"[{tag}] {content}"


def recall(engagement_dir: str, query: str = "", max_tokens: int = 8000) -> str:
    records = read_all(engagement_dir)
    if not records:
        return "(conversation.mcp empty — nothing recalled)"
    max_tokens = max(1, min(int(max_tokens), 16000))
    terms = [term.lower() for term in re.findall(r"\w+", query or "") if len(term) > 2]
    scored = []
    for index, record in enumerate(records):
        text = _record_text(record)
        score = sum(text.lower().count(term) for term in terms) if terms else 0
        scored.append((score, index, text))
    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    picked = []
    used = 0
    for score, index, text in scored:
        if terms and score == 0 and len(picked) >= 3:
            break
        size = _token_length(text)
        if used + size > max_tokens:
            continue
        picked.append((index, text))
        used += size
    picked.sort(key=lambda item: item[0])
    return f"Recalled {len(picked)} records (~{used} tok):\n" + "\n".join(text for _, text in picked)


def get_recent(engagement_dir: str, count: int = 20) -> str:
    count = max(1, min(int(count), 100))
    records = read_all(engagement_dir)[-count:]
    return "\n".join(_record_text(record) for record in records) or "(empty)"
