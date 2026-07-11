# Archived skill: `chillspwn-long-running-commands`

Absorbed into `chillspwn-operations` during umbrella-building consolidation. Original SKILL.md body follows.

---

---
name: chillspwn-long-running-commands
description: "Run long/buffered/privileged commands in the ChillsPwn harne"
---

# Running long / buffered / privileged commands in the ChillsPwn harness

Hard-won execution patterns for this Kali tool-runner. Following these avoids the multi-cycle thrashing that happens when you fight the sandbox.

## Persistent / privileged processes — use run_in_background, not shell `&`
- Backgrounding a privileged or long-lived process with shell `&`, `nohup`, or `--daemon` is **killed by the sandbox (exit code 144)** — the process never survives, no log is written.
- Instead launch it as a **foreground** command with the tool's own `run_in_background: true`; the harness tracks it and writes output to a task file you Read.
- Applies to: `openvpn`, long credential sprays (`nxc -u users.txt`), `xfreerdp` sessions, `Xvfb`, BloodHound collection, watchers/pollers.

## Don't chain sleeps to poll — it's blocked
- Chaining `sleep N; cat ...` (or multiple short sleeps) to wait for output is rejected by the harness.
- To wait: either set `run_in_background: true` and Read the task output file, or use a single Monitor-style loop `until <check>; do sleep N; done` inside one command.

## Buffered tool output won't flush through auto-backgrounded pipes
- Tools like `nxc` buffer stdout; piped through the auto-backgrounding mechanism the output can arrive empty.
- Fix: write to an explicit file and poll it — `tool ... | tee out.txt` (or `> out.txt 2>&1`) with `run_in_background: true`, then Read the file. `stdbuf -oL -eL` forces line buffering when needed.

## A network tool going silent ≠ the tool is broken
- If `nxc`/`ldapsearch`/`smbclient` suddenly produces no output or times out (`NT_STATUS_IO_TIMEOUT`), **verify target reachability first** (`ping -c3`, `/dev/tcp/host/port`) before switching tools or assuming a locked state DB. On HTB/Vulnlab this is usually a VPN/tunnel drop, not the tool. Checkpoint state to disk and bring the tunnel back (see [[active-directory-pentest]]).

## Validate before you daemonize
- For services (openvpn especially), run once in the foreground with a short `timeout` to confirm it works (cert verify, route push, `Initialization Sequence Completed`), then relaunch persistently via run_in_background. The `timeout` killing the test run is expected, not a failure.