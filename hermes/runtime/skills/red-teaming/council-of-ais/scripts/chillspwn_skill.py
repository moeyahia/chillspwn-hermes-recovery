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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
HERMES_SRC = "/media/sf_hermes-agent"
if HERMES_SRC not in sys.path:
    sys.path.insert(0, HERMES_SRC)

import council_tools as ct
from tools.skill_provenance import (
    set_current_write_origin, reset_current_write_origin, BACKGROUND_REVIEW,
)

SKILL_TOOLSETS = ("skills",)


def _dispatch(name, args):
    return ct.dispatch(name, args, task_id="chillspwn-learn", toolsets=SKILL_TOOLSETS)


def main():
    ap = argparse.ArgumentParser(description="Skill CLI for the ChillsPwn reviewer (created_by=agent).")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    p = sub.add_parser("view"); p.add_argument("--name", required=True)
    p = sub.add_parser("create")
    p.add_argument("--name", required=True); p.add_argument("--description", required=True)
    p.add_argument("--content", required=True)
    p = sub.add_parser("patch")
    p.add_argument("--name", required=True); p.add_argument("--content", required=True)
    a = ap.parse_args()

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
            out = _dispatch("skill_manage", {"action": "patch", "name": a.name, "content": a.content})
        else:
            out = json.dumps({"error": "unknown command"})
    finally:
        reset_current_write_origin(token)

    print(out if isinstance(out, str) else json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
