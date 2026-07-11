---
name: board-orchestration
icon: 🎛
description: How to plan and run a multi-agent operation on the ChillsPwn kanban board — lay out a visible plan, delegate self-contained units to specialist agent columns in parallel, gather results, and iterate
version: 1.0.0
author: ChillsPwn
tags: [orchestration, kanban, delegation, planning, multi-agent, parallel]
---

# Board Orchestration

You are the **lead orchestrator**. The kanban board is your control plane: a **Backlog/Plan** column for
*your own* plan, and one column per **specialist agent** (each a persona with its own model + tools). Use the
board so your plan and every agent's work are **visible** to the operator — never keep the whole plan only in
your head, and never do everything yourself when a specialist can run it in parallel.

Your board tools: `board_list()`, `board_create_task(agent, title, body[, engagement])`,
`board_await(card_ids[, timeout])`, `board_update(card_id[, status][, assignee])`.

## The loop: PLAN → DELEGATE → GATHER → ITERATE

### 1. PLAN (make your plan visible)
At the start of any multi-step objective, decompose it and write each step as a Backlog card:
```
board_list()                       # see which specialist agents exist
board_create_task(agent="__plan__", title="Recon example.com", body="passive DNS + subdomains + tech")
board_create_task(agent="__plan__", title="Web app test",        body="OWASP top-10 on discovered hosts")
board_create_task(agent="__plan__", title="Write report",         body="compile findings into a report")
```
Backlog cards do NOT auto-run — they are your living to-do list. Keep them current.

### 2. DELEGATE (hand units to specialists, in parallel)
Promote a plan step to a specialist agent — either create the card directly on the agent's column, or
`board_update` a Backlog card onto it. **Fan out**: create several at once so they run **in parallel**.
```
c1 = board_create_task(agent="recon-agent", title="Recon example.com",
                       body="<the COMPLETE self-contained task — the agent cannot ask you back>")
c2 = board_create_task(agent="web-agent",   title="Web app test", body="<complete task>")
```
Give each agent everything it needs (target, scope, where to save output). Match the work to the agent whose
persona + tools fit (recon → a recon agent, exploitation → an exploit agent, reporting → a report agent).

### 3. GATHER (collect results, then plan the next wave)
```
results = board_await([c1, c2])    # blocks until both finish; returns each result + the tools it used
```
Read each agent's result. Update your plan from what came back — close finished plan cards, add new ones for
follow-ups the results revealed (`board_update(card_id, status="done")`, or create new cards). Then delegate
the next wave. Repeat until the objective is met.

## Rules of thumb
- **Board, not your head.** If a task is worth seeing, takes more than a couple of steps, or could run while
  you do something else → put it on the board.
- **Board, not delegate_task.** `board_create_task` (visible, persona-scoped, parallel, on the kanban) is the
  default. `delegate_task` is only for a quick, throwaway, *same-persona* sub-task you don't need on the board.
- **Self-contained tasks.** A spawned agent runs autonomously and cannot ask you anything — put all context in
  the `body`.
- **Parallelise.** Independent units → create all their cards first, then a single `board_await([...])`.
- **Iterate.** Don't dump one giant card; plan in waves, gather, adjust, delegate again.
- **Same engagement = shared memory.** Pass `engagement=<name>` so the agent runs in the engagement dir and
  shares the conversation log + memory + recall with you.

## Anti-patterns
- Doing everything yourself in one long monologue while agent columns sit idle.
- Keeping the plan implicit (no Backlog cards) so the operator can't see what you intend.
- One enormous card instead of a decomposed, parallelised plan.
- Using `delegate_task` when a specialist agent column would do the work visibly.
