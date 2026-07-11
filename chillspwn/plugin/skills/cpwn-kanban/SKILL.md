---
name: cpwn-kanban
description: Manage the shared Kanban task board (SQLite). Create, list, assign, complete, and decompose tasks. Shared with Hermes.
allowed-tools: [Bash, Read, Write]
---

# ChillsPwn Kanban Board

The kanban board is a shared SQLite database at `~/.hermes/kanban.db`. Both ChillsPwn and Hermes can read/write to it.

## Commands:
- `/cpwn:kanban list` — Show all tasks grouped by status
- `/cpwn:kanban create "<title>" [--body "<description>"]` — Add a new task
- `/cpwn:kanban show <id>` — Show task details
- `/cpwn:kanban complete <id>` — Mark task as done
- `/cpwn:kanban assign <id> <agent>` — Assign to chillspwn or hermes
- `/cpwn:kanban decompose <id>` — Break a complex task into subtasks using AI

## Direct SQLite access:
```bash
sqlite3 ~/.hermes/kanban.db "SELECT id, title, status FROM tasks ORDER BY created_at DESC LIMIT 20;"
```

## Task statuses: triage → todo → in_progress → done → archived

## Integration:
- Hermes's gateway dispatcher automatically picks up `todo` tasks and executes them
- ChillsPwn can create tasks that Hermes will work on, and vice versa
