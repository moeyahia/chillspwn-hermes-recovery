#!/usr/bin/env python3
"""
chillspwn_skill.py — skill CLI for the ChillsPwn learning reviewer.

Reuses Hermes' real `skill_manage`/`skills_list`/`skill_view` handlers (via
council_tools' decoupled registry) and marks every write created_by=agent
(BACKGROUND_REVIEW origin) so the EXISTING gateway Curator consolidates and
archives them over time — exactly like Hermes' own self-improvement.

This is the additive/consolidating counterpart to chillspwn_mem.py: bulky,
reusable procedure → SKILL (loaded on demand), so MEMORY.md stays lean.

Usage:
  chillspwn_skill.py list
  chillspwn_skill.py view  --name <skill-name>
  chillspwn_skill.py create --name N --description D --content "markdown body"
  chillspwn_skill.py patch  --name N --content "appended/updated markdown"
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
HERMES_SRC = os.environ.get("CHILLSPWN_HERMES_SRC", "").strip()
if not HERMES_SRC:
    raise RuntimeError("CHILLSPWN_HERMES_SRC is required")
if not os.path.isdir(os.path.join(HERMES_SRC, "tools")):
    raise RuntimeError("CHILLSPWN_HERMES_SRC does not contain the Hermes tools package")
if HERMES_SRC not in sys.path:
    sys.path.insert(0, HERMES_SRC)

import council_tools as ct
from chillspwn_learn import reusable_content_violations
from agent.skill_utils import EXCLUDED_SKILL_DIRS, get_all_skills_dirs
from tools.skill_provenance import (
    set_current_write_origin, reset_current_write_origin, BACKGROUND_REVIEW,
)
from tools.skill_usage import get_record as get_skill_usage_record

SKILL_TOOLSETS = ("skills",)


def _dispatch(name, args):
    return ct.dispatch(name, args, task_id="chillspwn-learn", toolsets=SKILL_TOOLSETS)


def validate_skill_write(action, name, description="", content=""):
    """Validate direct CLI writes with the same boundary as reviewer preflight.

    Public technical URLs/domains are permitted only under a dedicated Markdown
    References heading. Create requires a complete attack-chain playbook; patch
    remains additive but the appended fragment must independently be reusable.
    """
    problems = []
    problems.extend(reusable_content_violations(name or ""))
    if action == "create":
        problems.extend(reusable_content_violations(description or ""))
    problems.extend(reusable_content_violations(
        content or "",
        require_playbook=action == "create",
        reference_aware=True,
    ))
    return sorted(set(problems))


def is_reviewer_managed_skill(name):
    """Only service-owned learned skills may be patched by this automated path."""
    try:
        record = get_skill_usage_record(name)
    except Exception:
        return False
    return bool(
        isinstance(record, dict)
        and (record.get("created_by") == "agent" or record.get("agent_created") is True)
    )


def find_skill_path(name):
    """Find a skill without invoking skill_view or mutating usage telemetry."""
    for root in get_all_skills_dirs():
        root = Path(root)
        if not root.exists():
            continue
        for skill_md in root.rglob("SKILL.md"):
            if any(part in EXCLUDED_SKILL_DIRS for part in skill_md.parts):
                continue
            if skill_md.parent.name == name:
                return skill_md.parent
    return None


def preflight_skill_write(action, name, description="", content=""):
    """Resolve an additive write without touching reviewed files or telemetry."""
    problems = validate_skill_write(action, name, description, content)
    if problems:
        return {"success": False, "violations": problems}
    existing = find_skill_path(name)
    managed = bool(existing and is_reviewer_managed_skill(name))
    if action == "patch":
        if not existing:
            return {"success": False, "violations": ["learned skill does not exist"]}
        if not managed:
            return {"success": False, "violations": ["reviewed skill is immutable"]}
        return {"success": True, "resolved_action": "patch"}
    if existing and not managed:
        return {"success": False, "violations": ["reviewed skill name collision"]}
    # A retry may find the service-owned skill created by a prior partial attempt.
    return {"success": True, "resolved_action": "patch" if managed else "create"}


def main():
    ap = argparse.ArgumentParser(description="Skill CLI for the ChillsPwn reviewer (created_by=agent).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    p = sub.add_parser("view"); p.add_argument("--name", required=True)
    p = sub.add_parser("preflight")
    p.add_argument("--action", required=True, choices=("create", "patch"))
    p.add_argument("--name", required=True)
    p.add_argument("--description", default="")
    p.add_argument("--content", required=True)
    p = sub.add_parser("create")
    p.add_argument("--name", required=True); p.add_argument("--description", required=True)
    p.add_argument("--content", required=True)
    p = sub.add_parser("patch")
    p.add_argument("--name", required=True); p.add_argument("--content", required=True)
    a = ap.parse_args()

    if a.cmd == "preflight":
        result = preflight_skill_write(
            a.action,
            a.name,
            a.description,
            a.content,
        )
        print(json.dumps(result, ensure_ascii=False))
        raise SystemExit(0 if result.get("success") else 1)

    if a.cmd in ("create", "patch"):
        problems = validate_skill_write(
            a.cmd,
            a.name,
            getattr(a, "description", ""),
            a.content,
        )
        if problems:
            print(json.dumps({
                "success": False,
                "error": "reusable-content validation failed",
                "violations": problems,
            }, ensure_ascii=False))
            raise SystemExit(1)
        if a.cmd == "patch" and not is_reviewer_managed_skill(a.name):
            print(json.dumps({
                "success": False,
                "error": (
                    "automated patch refused: skill is reviewed/immutable or lacks "
                    "background-review provenance; create a new additive learned skill"
                ),
            }, ensure_ascii=False))
            raise SystemExit(1)

    token = set_current_write_origin(BACKGROUND_REVIEW)
    try:
        if a.cmd == "list":
            out = _dispatch("skills_list", {})
        elif a.cmd == "view":
            out = _dispatch("skill_view", {"name": a.name})
        elif a.cmd == "create":
            # skill_manage 'create' expects the FULL SKILL.md (frontmatter + body).
            # Synthesize valid YAML frontmatter if the body doesn't already have it.
            content = a.content
            if not content.lstrip().startswith("---"):
                desc = json.dumps(a.description[:1024])  # safe YAML scalar (handles : and quotes)
                content = f"---\nname: {a.name}\ndescription: {desc}\n---\n\n{content}"
            out = _dispatch("skill_manage", {"action": "create", "name": a.name,
                                             "description": a.description, "content": content})
        elif a.cmd == "patch":
            # Hermes patch requires old_string/new_string. The reviewer contract supplies an
            # additive markdown fragment, so resolve the current body and submit one full edit.
            viewed = _dispatch("skill_view", {"name": a.name})
            try:
                parsed = json.loads(viewed) if isinstance(viewed, str) else viewed
            except Exception:
                parsed = {}
            existing = parsed.get("content") if isinstance(parsed, dict) and parsed.get("success") else None
            if not existing:
                out = json.dumps({"success": False, "error": f"Skill '{a.name}' not found; create a new technique-oriented chain instead."})
            else:
                fragment = (a.content or "").strip()
                if fragment and fragment in existing:
                    out = json.dumps({"success": True, "skipped": True,
                                      "message": "exact skill content already present (idempotent skip)"})
                else:
                    updated = existing.rstrip() + "\n\n" + fragment + "\n"
                    out = _dispatch("skill_manage", {"action": "edit", "name": a.name, "content": updated})
        else:
            out = json.dumps({"error": "unknown command"})
    finally:
        reset_current_write_origin(token)

    print(out if isinstance(out, str) else json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
