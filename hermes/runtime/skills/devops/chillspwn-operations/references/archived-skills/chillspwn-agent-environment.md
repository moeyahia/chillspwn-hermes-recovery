# Archived skill: `chillspwn-agent-environment`

Absorbed into `chillspwn-operations` during umbrella-building consolidation. Original SKILL.md body follows.

---

---
name: chillspwn-agent-environment
description: "ChillsPwn agent env: permissions, restart, bg procs"
---

# ChillsPwn agent operating environment

How this agent runs and why allowlisted Bash commands sometimes still get classifier-blocked. Written from a session that burned ~30 min fighting permission blocks before the mechanics were understood.

## How the agent is launched
- Spawned by `chillspwn.service` (a Bun dashboard, `/opt/chillspwn/plugin/webapp`) which launches `/usr/bin/claude -p ... --permission-mode auto`. There is **no standalone `claude` systemd service** — `/usr/bin/claude` is just the binary, launched on demand.
- To reload anything read at spawn time, restart the dashboard (system service, root, no sudo): `systemctl restart chillspwn`. The fresh `claude` child re-reads `~/.claude/settings.json`. Surgical alt: `pkill -f "claude -p --input-format stream-json"` (dashboard respawns it on next message).
- The operator runs the restart in their own terminal — don't run it yourself (you'd kill your own process mid-command).

## The Bash permission allowlist
- Lives in `~/.claude/settings.json` → `.permissions.allow` (NOT `settings.local.json`, which is a separate near-empty file — check the right one).
- Read **once at process spawn — no hot-reload.** Edits don't take effect until a restart. To tell whether it's loaded: compare process start time (`ps -o pid,lstart,args -C claude`) to the file mtime; if the file is newer, the live allowlist is stale.

## Why an allowlisted command still gets blocked
1. **Allowlist not loaded yet** (most common right after an edit) → needs restart. First hypothesis when an obviously-benign/allowlisted command is consistently blocked is "not loaded → restart," NOT "classifier is flaky." Don't burn cycles re-trying the same command.
2. **The matcher only matches simple single-tool invocations.** These fall through to the classifier:
   - env-var prefix: `KRB5CCNAME=... klist` — and even `env KRB5CCNAME=... klist`.
   - compound/chained: `&&`, `;`, `||`, pipelines, `$(...)`, `setsid`/`nohup`/`disown`/`sleep` loops.

   Workarounds that do NOT require widening permissions:
   - Keep each Bash call atomic (one tool, no chaining) so it matches the allowlist.
   - For Kerberos, drop the ccache at the default location `/tmp/krb5cc_0` (root) so tools read it with no env prefix needed.
   - For persistent infra (openvpn, chisel SOCKS), use the Bash tool's native `run_in_background:true`. Shell backgrounding (`setsid nohup ... &`) both fails to match the allowlist AND gets SIGTERM-reaped by the harness at session/turn boundaries (minutes later) — the native background mechanism survives.

## Self-modification boundary — do NOT fight it
The agent **cannot edit its own permission allowlist.** The classifier blocks any write to `~/.claude/settings.json` permissions — and enabling steps toward it (a `cp` backup of it, `apt-get install jq` "to edit the allowlist") — flagging **"Self-Modification / Auto-Mode Bypass."** This is by design. Don't retry, don't disguise it via Write/python/sed. Recognize it immediately and hand the operator a ready-to-paste command (jq preferred — the operator corrected "using jq please not python") plus the restart, and let THEM run it. You may READ the allowlist back afterward (read-only) to verify entries landed.
