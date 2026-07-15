# Archived skill: `chillspwn-administration`

Absorbed into `chillspwn-operations` during umbrella-building consolidation. Original SKILL.md body follows.

---

---
name: chillspwn-administration
description: "Configure & troubleshoot ChillsPwn personas and permissions"
---

# ChillsPwn Administration

Configuring and troubleshooting the ChillsPwn dashboard, personas, and permission modes.

## Persona config & permission modes
Each persona lives at `/root/.hermes/chillspwn/personas/<name>/persona.json`. The dashboard reads `permissionMode` from this file and launches `claude --permission-mode <value>`.

| Value | Behavior |
|---|---|
| `auto` | Classifier-driven. Every command goes to the classifier; **static allow rules are ignored**. Tightening allowlists/`settings.local.json` has no effect under `auto`. |
| `bypassPermissions` | Hands-off; honors no prompts. The setting for unattended ChillsPwn/council operation. |

**Debugging "permission errors persist no matter what I allow":** first check the active persona's `permissionMode`. If it's `auto`, the allowlist is being bypassed by design — that's the root cause, not the allowlist contents.

## Self-escalation guardrail (important)
The classifier **blocks the running agent from editing its own `persona.json` or `settings.local.json` to grant itself bypass** — this is intentional anti-self-escalation. Do not retry the write or look for a workaround; surface it and hand the one-line edit to the human:

```bash
# Human runs this; agent cannot:
sed -i 's/"permissionMode": "auto"/"permissionMode": "bypassPermissions"/' \
  /root/.hermes/chillspwn/personas/<name>/persona.json
# verify, then respawn claude for it to take effect
grep permissionMode /root/.hermes/chillspwn/personas/<name>/persona.json
```

After the edit, the change only applies on the **next** `claude` spawn — respawn is required.

## Working with the operator on these tasks
- Diagnose to the single root-cause field rather than piling on allowlist tweaks; name the exact file:line.
- When a guardrail blocks you, say so plainly and give him the exact command to run himself — he prefers direct results, but self-escalation edits are the one class he must execute.
