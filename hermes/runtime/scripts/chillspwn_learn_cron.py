#!/usr/bin/env python3
"""ChillsPwn continuous-learning cron — reviews FINISHED ChillsPwn sessions.

Scans ~/.hermes/conversations for new ChillsPwn transcripts (written by the
dashboard on session close), runs chillspwn_learn.py on each (which saves
durable memory + skills), and records what it processed so nothing is reviewed
twice. Registered as a no_agent script cron in jobs.json.
"""
import json, os, subprocess, sys, time
from pathlib import Path

HERMES = Path(os.environ.get("HERMES_HOME", "/root/.hermes"))
CONV = HERMES / "conversations"
STATE = HERMES / "scripts" / ".chillspwn_learn_state.json"
REVIEWER = Path("/root/.hermes/skills/red-teaming/council-of-ais/scripts/chillspwn_learn.py")
SESSIONS_DIR = Path(os.environ.get("HOME", "/root")) / ".claude" / "chillspwn" / "sessions"
MAX_PER_RUN = 1          # dispatch ONE detached reviewer per tick (avoid concurrent Opus runs)
SETTLE_SECONDS = 600     # only review transcripts stable for >10 min — a session that
                         # might be resumed soon shouldn't be reviewed yet (and the fork
                         # keeps the original clean either way).
LEARN_LOG = HERMES / "scripts" / "chillspwn_learn.log"  # detached reviewer stdout/stderr
DRY = "--dry-run" in sys.argv


def resolve_cli_session(md_name):
    """Map a conversation .md (named <ts>_<persona>_<sessionId>.md) to the CLI
    session id + cwd persisted by the dashboard, so the reviewer can --resume
    with the session's FULL native context (tool calls + outputs)."""
    try:
        sid = Path(md_name).stem.split("_")[-1]          # trailing s-<digits>
        data = json.loads((SESSIONS_DIR / f"{sid}.json").read_text())
        return data.get("cliSessionId"), data.get("cliCwd")
    except Exception:
        return None, None

def load_state():
    """Returns (processed_md_names:set, mcp_offsets:dict). mcp_offsets maps a
    conversation.mcp path -> how many records have already been reviewed, so the reviewer
    only sees NEW records (the per-cwd append-only log accumulates every session)."""
    try:
        d = json.loads(STATE.read_text())
        return set(d.get("processed", [])), dict(d.get("mcp_offsets", {}))
    except Exception:
        return set(), {}

def save_state(done, offsets):
    try: STATE.write_text(json.dumps({"processed": sorted(done), "mcp_offsets": offsets}))
    except Exception as e: print(f"[learn-cron] state save failed: {e}", file=sys.stderr)

def count_records(p):
    try: return sum(1 for ln in open(p, errors="replace") if ln.strip())
    except Exception: return 0

def main():
    if not CONV.exists():
        print("[learn-cron] no conversations dir"); return
    done, offsets = load_state()
    now = time.time()
    # ChillsPwn transcripts only; finished (stable) and not yet reviewed.
    candidates = sorted(
        f for f in CONV.glob("*_ChillsPwn_*.md")
        if f.name not in done and (now - f.stat().st_mtime) > SETTLE_SECONDS
    )
    if not candidates:
        print("[learn-cron] nothing new to review"); return
    print(f"[learn-cron] {len(candidates)} new ChillsPwn transcript(s); processing up to {MAX_PER_RUN}")
    for f in candidates[:MAX_PER_RUN]:
        cli_sid, cli_cwd = resolve_cli_session(f.name)
        mode = f"resume {cli_sid} (cwd {cli_cwd})" if cli_sid else "transcript-only (no cliSessionId)"
        if DRY:
            print(f"  [dry-run] would review: {f.name} via {mode}"); continue
        # Context priority (reviewer decides): --resume (native) → --mcp (COMPLETE
        # append-only conversation.mcp) → --transcript (lossy .md, last resort). We pass
        # whatever is available. conversation.mcp lives in the engagement dir (cli_cwd);
        # this is the key fix so OpenRouter sessions (no native session) review the FULL
        # log instead of the 200k-truncated .md.
        cmd = [sys.executable, str(REVIEWER), "--transcript", str(f)]
        mcp_key = None
        if cli_cwd:
            mcp = Path(cli_cwd) / "conversation.mcp"
            if mcp.exists():
                mcp_key = str(mcp)
                # INCREMENTAL: only review records appended since we last reviewed this
                # per-cwd log, so prior sessions in the same dir are not re-processed.
                since = int(offsets.get(mcp_key, 0))
                cur_total = count_records(mcp)
                cmd += ["--mcp", mcp_key, "--mcp-since", str(since)]
                if cli_sid:
                    cmd += ["--session-id", cli_sid]
                # Advance the offset at DISPATCH (same "mark at dispatch" semantics as the
                # .md set: the detached reviewer self-caps; a failed review just skips that
                # delta rather than retry-looping into the gateway's 120s timeout).
                offsets[mcp_key] = cur_total
        if cli_sid:
            cmd += ["--resume-session", cli_sid]
            if cli_cwd:
                cmd += ["--cwd", cli_cwd]
        # DISPATCH DETACHED: the reviewer runs Opus via `claude -p` (minutes) — far
        # longer than the gateway's 120s no_agent script timeout. start_new_session
        # puts it in its own session so it survives this cron exiting (and the gateway
        # reaping our process group). We mark the transcript processed at DISPATCH:
        # chillspwn_learn.py self-caps its own runtime, so a slow/failed review just
        # skips that transcript instead of retry-looping into the same 120s timeout.
        try:
            lf = open(LEARN_LOG, "a")
            subprocess.Popen(cmd, stdout=lf, stderr=lf, stdin=subprocess.DEVNULL,
                             start_new_session=True)
            done.add(f.name)
            print(f"  dispatched (detached): {f.name} via {mode} -> log {LEARN_LOG}")
        except Exception as e:
            print(f"  [learn-cron] dispatch failed for {f.name}: {e} (will retry next run)")
    if not DRY:
        save_state(done, offsets)

if __name__ == "__main__":
    main()
