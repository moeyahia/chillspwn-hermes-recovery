# Archived skill: `chillspwn-dashboard-internals`

Absorbed into `chillspwn-operations` during umbrella-building consolidation. Original SKILL.md body follows.

---

---
name: chillspwn-dashboard-internals
description: "How ChillsPwn webapp spawns and controls claude sessions"
---

# ChillsPwn dashboard internals

How `webapp/server/index.ts` spawns and steers each `claude` session, and how operator tool-permission approval is wired. Reach for this when debugging session spawning, permission prompts, or workflow/effort settings.

## Session spawn (`buildClaudeArgs`)
- Runs `claude -p` with `--input-format stream-json --output-format stream-json --verbose --include-partial-messages`.
- Model defaults to `claude-opus-4-8` (ULTRACODING default) when a persona omits a model.
- `--permission-mode` = `persona.permissionMode || "default"`. There is **no** `--permission-prompt-tool` override — permission decisions ride the `can_use_tool` stream-JSON control protocol instead.
- `--disallowedTools AskUserQuestion` (it auto-resolves in `-p` mode; the UI renders questions as clickable buttons from structured text instead).
- `workflowSettings({standing, model})` → `--settings` JSON: always `enableWorkflows:true`; adds `ultracode:true` only when standing AND model matches `/opus/i`. Interactive sessions get standing ultracode; background/detached agents get workflows on-demand only (deliberately no standing orchestration for unattended agents — runaway-token guard).

## Operator tool-permission approval flow (`--permission-mode default`)
Designed so any tool call NOT pre-approved by a `permissions.allow` rule is delegated to the operator:
1. `LiveSession.pendingApprovals: Map<requestId, {toolName, input, at}>` tracks requests awaiting a click.
2. Server catches `data.type === "control_request" && data.request?.subtype === "can_use_tool"`, stores it, and surfaces an Approve/Deny card in chat.
3. `answerToolApproval(session, requestId, decision, input?, message?)` writes a `control_response` back: allow → `{behavior:"allow", updatedInput}`, deny → `{behavior:"deny", message}`. No auto-answer path — every prompt requires a human click.
4. The `tool_approval` websocket message (`{sessionId, requestId, decision, message}`) carries the operator's click to `answerToolApproval`.

⚠️ Code comment flags the exact `can_use_tool` field shape as "to be confirmed on first real use" — treat the handler as untested until verified.

## Allowlist matching quirk (useful for testing approvals)
Bash allowlist matches on the leading command token. To deliberately trigger a **non-allowlisted** command for testing the approval card:
- `KRB5CCNAME=/path klist` → leading token is the env-var assignment, so it does NOT match an allowlist entry for `klist` → requires approval.
- `env KRB5CCNAME=/path klist` → leading token is `env`, which matches the `env` allowlist → auto-approved, no prompt.
Both run the same benign read; pick the bare env-prefix form when you want the prompt to fire.

## Troubleshooting: approval card never appears, command auto-denies instantly
Symptom: non-allowlisted command returns "This command requires approval" immediately, no card reaches the operator. Likely cause: `"skipAutoPermissionPrompt": true` in `~/.claude/settings.json` — it makes claude skip the prompt and auto-decide (→ deny in headless `-p`) instead of emitting the `can_use_tool` request the dashboard waits for. Fix:
```bash
sed -i 's/"skipAutoPermissionPrompt": true/"skipAutoPermissionPrompt": false/' /root/.claude/settings.json
grep skipAutoPermissionPrompt /root/.claude/settings.json   # verify false
systemctl restart chillspwn
```
Then re-run the bare env-prefix test command; a card should now surface. (Fix unverified as of first writing — confirm on next test.)

## Killing the background council
`pkill -9 -f council_summon.py` then verify with `pgrep -af council_summon`. The council runs as a separate background process and is not disturbed by interactive session tests.