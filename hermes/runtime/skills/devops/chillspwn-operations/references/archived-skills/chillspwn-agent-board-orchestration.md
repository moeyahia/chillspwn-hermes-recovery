# Archived skill: `chillspwn-agent-board-orchestration`

Absorbed into `chillspwn-operations` during umbrella-building consolidation. Original SKILL.md body follows.

---

---
name: chillspwn-agent-board-orchestration
description: "Plan + delegate multi-step jobs via the ChillsPwn kanban boa"
---

# ChillsPwn Agent-Board Orchestration

How to PLAN and RUN a multi-step job by delegating to persona-scoped agents on the ChillsPwn kanban board (the orchestration-board redesign — columns are agents, the orchestrator delegates via cards). Verified end-to-end on a "passive recon + summarize" job (2026-06-01).

## Board tools & their real shapes

- **`board_list`** → `{agents:[...], cards:[{id,agent,status,title}]}`. Use it first to see which agents exist. Observed roster: `ChillsPwn`, `recon-agent`, `Researcher`, `Claude Code`, `Coder`, `Intigriti Researcher`.
- **`board_create_task(agent='__plan__', title=..., ...)`** → creates a **Backlog plan card** (tracking only, NOT dispatched to a runner). Returns `{ok:true, card_id, agent:'__plan__', dispatched:'backlog'}`. Use one `__plan__` card per step to lay out the plan before doing the work.
- **`board_create_task(agent='<named-agent>', title=..., details=...)`** → **dispatches** the task to that agent, which runs autonomously with ITS OWN tools/skills. Returns `{ok:true, card_id, agent, dispatched:'backlog'}`.
- **`board_await(card_ids)`** → BLOCKS until the delegated card(s) finish, returns `{ok:true, results:{<card_id>:{status:'done'|'failed', result:<final text>, tools:[...]}}}`. The `tools` array is the live tool trace of that agent's run.
- **`board_update`** → move/mark cards (`{ok:true, dispatched:bool}`).

## Delegated-agent prompt convention (important)

When you dispatch a card, the agent receives a task prompt. The expected close-out is a sentinel: the agent ends its reply with `<<OBJECTIVE_COMPLETE>>` on its own line, followed by a concise result. Phrase the `details` so the sub-agent runs autonomously and self-terminates, e.g.:

> "You are the '<agent>' agent. Complete this task autonomously with your tools, then end your reply with `<<OBJECTIVE_COMPLETE>>` on its own line followed by a concise result."

## Canonical flow (what worked)

1. `board_list` to confirm agents.
2. For each plan step, `board_create_task(agent='__plan__', ...)` → Backlog cards (the plan, visible to the operator).
3. `board_create_task(agent='recon-agent', title=..., details=...)` to dispatch the real work to a named agent.
4. `board_await([recon_card_id])` — wait for `status:'done'`, read `result` + `tools`.
5. Optionally `read_file` the artifact the sub-agent wrote (it ran in its own context — its files are the ground truth, its `result` text is a summary).
6. Synthesize and deliver the summary to the operator.

## Notes

- The sub-agent runs in a SEPARATE context: it auto-loads its own skills (e.g. `recon-agent` loaded `recon-osint`) and writes its own engagement files (this run: `/root/engagements/<target>/recon/`). Always go to the written report/artifacts for detail, not just the returned `result` blurb.
- `__plan__` cards never execute — don't `board_await` them expecting work; they're for plan legibility.
- Match the operator's literal structure: if they say "one card per step" and name the delegate agent, create exactly that — plan cards for planning, one dispatch card for the named agent.