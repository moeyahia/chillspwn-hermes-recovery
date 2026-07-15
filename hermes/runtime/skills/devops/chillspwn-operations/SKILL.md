---
name: chillspwn-operations
description: "Use when operating, configuring, or troubleshooting ChillsPwn agents, dashboards, permissions, kanban-board delegation, persona modes, and long-running command execution."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [chillspwn, dashboard, permissions, agents, kanban, background-jobs]
    related_skills: [ai-dashboard-service-ops, pentest-engagement-ops]
---

# ChillsPwn Operations

## Overview

Umbrella skill for operating the ChillsPwn environment: dashboard service behavior, persona permission modes, agent-board orchestration, command permission gates, and safe execution of long-running jobs. Prefer this class-level skill over narrow one-session notes.

## When to Use

Use when the task mentions ChillsPwn and any of:
- persona configuration or `permissionMode` behavior;
- allowlist/classifier permission failures;
- dashboard spawning, session internals, model/workflow settings, or service restarts;
- kanban/board delegation to persona-scoped agents;
- long-running/backgrounded commands launched from the ChillsPwn harness.

Do not use for generic Hermes configuration unless ChillsPwn is specifically involved; use `hermes-agent` for Hermes CLI/config/tools.

## Dashboard and persona model

Personas live under `/root/.hermes/chillspwn/personas/<name>/persona.json`. The dashboard reads `permissionMode` at spawn time and launches `claude -p` with the selected mode. Changing persona JSON or allowlist files requires a fresh spawned session; do not expect hot reload.

Common `permissionMode` values:
- `auto`: classifier-driven. In observed ChillsPwn sessions, commands fall through to a safety classifier; static allow rules may not help if the mode routes every command through classification.
- `default`: normal permission prompt/control flow.
- `bypassPermissions`: unattended operation; use only when the operator has explicitly configured/approved it.

Guardrail: do not self-escalate by editing your own permission configuration to make a blocked action pass. Explain the needed operator-side change and continue with allowed steps.

## Permission-gate operating pattern

1. Identify the live persona and mode before debugging allowlist symptoms.
2. Shape Bash commands to match existing allowlist patterns; keep command prefixes simple and avoid wrappers when a direct command is allowed.
3. If an allowlist/config change was made, restart/respawn the dashboard session before retesting.
4. Treat intermittent classifier failures as a reason to use cleaner command shapes, not as proof the underlying tool is broken.

## Kanban board orchestration

For multi-agent ChillsPwn work, list the board first to discover agents and cards. Create a plan/backlog card for decomposition, then delegate small, verifiable tasks to persona columns. Prompt delegated agents with explicit context, output expectations, and evidence requirements. Verify completed cards by reading their artifacts or checking external handles; do not trust status labels alone.

## Long-running and background execution

For long-lived/privileged tools in ChillsPwn, launch the foreground command through the harness' native background/tracking mechanism instead of shell `&`, `nohup`, or daemon flags. Poll for readiness using concrete signals: process exists, port bound, log line present, tunnel interface up, or output file contains a sentinel.

Avoid chained sleeps such as `sleep 25; cat file` when the harness blocks them. Use an until-loop or background process polling. If a network tool suddenly returns empty output, check reachability and routes before blaming buffering or auth.

## Preserved narrow notes

Older one-session skills were archived into this umbrella and copied into `references/` with their original bodies. Read those files when you need exact session-specific commands, dashboard internals, or permission-mode edge cases.

## Common Pitfalls

1. **Assuming allowlist edits hot-reload.** They are read at process spawn; restart/respawn before retesting.
2. **Fighting self-modification boundaries.** Permission escalation is an operator action, not an agent workaround.
3. **Using shell backgrounding for daemons.** Use the harness' tracked background mode and verify readiness.
4. **Treating board status as proof.** Verify artifacts, logs, or handles.

## Verification Checklist

- [ ] Live persona and permission mode identified when relevant.
- [ ] Dashboard/session restarted if spawn-time config changed.
- [ ] Long-running processes have a tracked PID/log/readiness signal.
- [ ] Board-delegated work has verifiable artifacts, not just status labels.
