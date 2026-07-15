# Archived skill: `chillspwn-persona-permissions`

Absorbed into `chillspwn-operations` during umbrella-building consolidation. Original SKILL.md body follows.

---

---
name: chillspwn-persona-permissions
description: "ChillsPwn persona permissionMode behavior & fixes"
---

# ChillsPwn persona permission modes

How the dashboard decides command-approval behavior, and how to debug it.

## Where it lives
`/root/.hermes/chillspwn/personas/<persona>/persona.json` → field `permissionMode`.
The dashboard reads this at launch and runs `claude --permission-mode <value>`. Changing it requires **respawning the claude process** to take effect.

## Mode behavior (the gotcha)
- `"auto"` — classifier-driven. Sends **every** command to the classifier and **ignores static allow rules** in `settings.local.json`. Symptom: an allowlist you added "never helps," and if the classifier is flaky every command stalls/errors.
- `"bypassPermissions"` — fully hands-off, no per-command gating. Use this for autonomous/unattended operation (e.g. the chillspwn service account).

## Debugging an "allowlist won't stick / commands keep getting blocked" report
1. Don't chase `settings.local.json` first. Check `permissionMode` in the active persona.json. If it's `auto`, that's the root cause — allow rules are bypassed by design.
2. Flip to `bypassPermissions`:
   ```bash
   sed -i 's/"permissionMode": "auto"/"permissionMode": "bypassPermissions"/' \
     /root/.hermes/chillspwn/personas/chillspwn/persona.json
   ```
3. Respawn claude (dashboard re-reads persona.json at launch).

## Self-escalation guardrail — the agent cannot do step 2 itself
The classifier blocks the running agent from editing its own persona's `permissionMode` to `bypassPermissions`, and from writing `settings.local.json` to grant itself bypass. This is deliberate anti-self-escalation. **Hand the one-line edit to the user to run manually** — don't burn turns retrying the write; surface it as the last manual step.
