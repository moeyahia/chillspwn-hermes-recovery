# Archived skill: `chillspwn-permission-config`

Absorbed into `chillspwn-operations` during umbrella-building consolidation. Original SKILL.md body follows.

---

---
name: chillspwn-permission-config
description: "Diagnose/fix ChillsPwn persona permission modes"
---

# ChillsPwn permission & persona configuration

How the ChillsPwn dashboard decides what the spawned `claude` process is allowed to do, and how to debug "my allowlist isn't working" symptoms.

## Where the setting lives
`/root/.hermes/chillspwn/personas/<persona-name>/persona.json` → field `permissionMode`.
The dashboard reads this and spawns `claude --permission-mode <value>`. Per-persona, so check the SPECIFIC persona that's running (e.g. `chillspwn`), not a global config.

## permissionMode values
| Value | Behavior | Static allowlist honored? |
|---|---|---|
| `auto` | Every command routed to the classifier (LLM-driven yes/no) | **NO** — allow rules bypassed |
| `bypassPermissions` | No prompts, runs everything | N/A (all allowed) |
| `default` / `acceptEdits` | Prompt-based, honors allow/deny rules | Yes |

## Debugging "allowlist never helps"
If commands keep getting blocked/erroring AND you've added allow rules that do nothing, suspect `permissionMode: "auto"` FIRST. Under `auto`, static allow rules in `settings.local.json` are never consulted — the classifier decides everything. A classifier that's erroring will block all session regardless of the allowlist. The single field is usually the whole problem; don't keep editing the allowlist.

Fix (must be run by the user — see guardrail below):
```bash
sed -i 's/"permissionMode": "auto"/"permissionMode": "bypassPermissions"/' \
  /root/.hermes/chillspwn/personas/<persona>/persona.json
# verify
grep permissionMode /root/.hermes/chillspwn/personas/<persona>/persona.json
```
Then respawn the claude process for it to take effect.

## Self-escalation guardrail (important)
The classifier deliberately blocks the agent from raising its OWN privileges: writes that change `permissionMode` to `bypassPermissions`, or edits to `settings.local.json` that loosen permissions, are denied even when the agent attempts them. This is intentional anti-self-escalation. When the fix requires this, STOP attempting it yourself and hand the user the exact command to run in their terminal — that's the last manual step, not a retryable failure.
