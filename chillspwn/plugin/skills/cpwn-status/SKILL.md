---
name: cpwn-status
description: Show ChillsPwn agent status — loaded persona, memory state, shared skills, Hermes coexistence
allowed-tools: [Bash, Read]
---

# ChillsPwn Status

Show the current state of the ChillsPwn agent:

1. **Active persona**: Read `~/.claude/chillspwn/personas/*/persona.json` to show which persona is active
2. **Memory state**: Check `~/.hermes/memories/USER.md` and `MEMORY.md` — show line counts and last modified times
3. **Shared skills**: List all skills in `~/.claude/plugins/chillspwn/skills/` — distinguish symlinked (shared with Hermes) from local
4. **Kanban board**: Check `~/.hermes/kanban.db` — show task counts by status (triage/todo/in_progress/done)
5. **Hermes status**: Check if Hermes gateway is running (`pgrep -af hermes`)
6. **Claude Code version**: Run `claude --version`
7. **Cron jobs**: List active cron jobs from `~/.hermes/cron/jobs.json`

Format as a clean status dashboard.
