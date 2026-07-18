#!/usr/bin/env python3
"""Legacy ChillsPwn full-context learning scheduler (contained in V2.4).

The retained implementation documents and tests the historical state machine,
but production execution is disabled because it can pass complete native
sessions or conversation.mcp payloads to a public model. The replacement must
use a sanitized LearningCandidateBrief plus ProviderExposureReceipt.
"""
import json, os, subprocess, sys, time
from pathlib import Path

HERMES_HOME = os.environ.get("HERMES_HOME", "").strip()
SESSIONS_PATH = os.environ.get("CHILLSPWN_SESSIONS_DIR", "").strip()
if not HERMES_HOME:
    print("[learn-cron] HERMES_HOME is required", file=sys.stderr)
    raise SystemExit(2)
if not SESSIONS_PATH:
    print("[learn-cron] CHILLSPWN_SESSIONS_DIR is required", file=sys.stderr)
    raise SystemExit(2)

HERMES = Path(HERMES_HOME).expanduser()
CONV = HERMES / "conversations"
STATE_ROOT = Path(os.environ.get(
    "CHILLSPWN_LEARN_STATE_DIR",
    str(HERMES / "state" / "chillspwn-learning"),
)).expanduser()
LOG_ROOT = Path(os.environ.get(
    "CHILLSPWN_LEARN_LOG_DIR",
    str(HERMES / "logs"),
)).expanduser()
STATE = STATE_ROOT / "state.json"
REVIEWER = HERMES / "skills" / "red-teaming" / "council-of-ais" / "scripts" / "chillspwn_learn.py"
SESSIONS_DIR = Path(SESSIONS_PATH).expanduser()
MAX_PER_RUN = 1          # dispatch ONE detached reviewer per tick (avoid concurrent Opus runs)
SETTLE_SECONDS = 600     # only review transcripts stable for >10 min — a session that
                         # might be resumed soon shouldn't be reviewed yet (and the fork
                         # keeps the original clean either way).
LEARN_LOG = LOG_ROOT / "chillspwn-learning.log"  # detached reviewer stdout/stderr
SUCCESS_DIR = STATE_ROOT / "success"
RETRY_GRACE_SECONDS = int(os.environ.get("CHILLSPWN_LEARN_RETRY_GRACE_SECONDS", "1200"))
DRY = "--dry-run" in sys.argv
LEGACY_FULL_CONTEXT_PUBLIC_REVIEW_DISABLED = True


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
    """Return processed names, successful MCP offsets, and detached-review state.

    mcp_offsets maps a
    conversation.mcp path -> how many records have already been reviewed, so the reviewer
    only sees new records. Offsets advance only after a valid reviewer success marker.
    """
    try:
        d = json.loads(STATE.read_text())
        return (
            set(d.get("processed", [])),
            dict(d.get("mcp_offsets", {})),
            dict(d.get("inflight", {})),
        )
    except Exception:
        return set(), {}, {}

def save_state(done, offsets, inflight):
    payload = {
        "processed": sorted(done),
        "mcp_offsets": offsets,
        "inflight": inflight,
    }
    try:
        STATE.parent.mkdir(parents=True, exist_ok=True)
        tmp = STATE.with_suffix(STATE.suffix + ".tmp")
        tmp.write_text(json.dumps(payload, sort_keys=True))
        os.replace(tmp, STATE)
    except Exception as e:
        print(f"[learn-cron] state save failed: {e}", file=sys.stderr)

def count_records(p):
    try:
        with open(p, errors="replace") as stream:
            return sum(1 for line in stream if line.strip())
    except Exception:
        return 0


def success_marker_for(transcript_name):
    return SUCCESS_DIR / f"{transcript_name}.done.json"


def marker_succeeded(marker):
    """A file exists only as transport; completion requires an explicit JSON `ok: true`."""
    try:
        payload = json.loads(Path(marker).read_text())
        return isinstance(payload, dict) and payload.get("ok") is True
    except Exception:
        return False


def reconcile_inflight(done, offsets, inflight, now):
    """Consume valid markers and mark stale reviews eligible for a controlled retry."""
    changed = False
    for name, meta in list(inflight.items()):
        marker = success_marker_for(name)
        if marker_succeeded(marker):
            done.add(name)
            mcp_key = meta.get("mcp_key")
            if mcp_key:
                prior = int(offsets.get(mcp_key, 0))
                offsets[mcp_key] = max(prior, int(meta.get("mcp_total", 0)))
            inflight.pop(name, None)
            changed = True
            continue
        dispatched_at = float(meta.get("dispatched_at", 0) or 0)
        if now - dispatched_at >= RETRY_GRACE_SECONDS:
            if not meta.get("retry_ready"):
                meta["retry_ready"] = True
                changed = True
    return changed

def main():
    if LEGACY_FULL_CONTEXT_PUBLIC_REVIEW_DISABLED:
        print(
            "[learn-cron] blocked: the legacy full-context public-model reviewer is disabled; "
            "use the V2 sanitized candidate and exposure-receipt workflow"
        )
        return
    if not REVIEWER.is_file():
        print("[learn-cron] configured reviewer script is missing", file=sys.stderr)
        raise SystemExit(2)
    if not SESSIONS_DIR.is_dir():
        print("[learn-cron] configured sessions directory is missing", file=sys.stderr)
        raise SystemExit(2)
    if not CONV.exists():
        print("[learn-cron] no conversations dir"); return
    done, offsets, inflight = load_state()
    now = time.time()
    state_changed = reconcile_inflight(done, offsets, inflight, now)
    # ChillsPwn transcripts only; finished (stable) and not yet reviewed.
    candidates = sorted(
        f for f in CONV.glob("*_ChillsPwn_*.md")
        if (
            f.name not in done
            and (f.name not in inflight or inflight[f.name].get("retry_ready"))
            and (now - f.stat().st_mtime) > SETTLE_SECONDS
        )
    )
    if not candidates:
        if state_changed and not DRY:
            save_state(done, offsets, inflight)
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
        marker = success_marker_for(f.name)
        cmd = [
            sys.executable, str(REVIEWER),
            "--transcript", str(f),
            "--success-marker", str(marker),
        ]
        mcp_key = None
        cur_total = 0
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
        if cli_sid:
            cmd += ["--resume-session", cli_sid]
            if cli_cwd:
                cmd += ["--cwd", cli_cwd]
        # DISPATCH DETACHED: the reviewer runs Opus via `claude -p` (minutes) — far
        # longer than the gateway's 120s no_agent script timeout. start_new_session
        # puts it in its own session so it survives this cron exiting (and the gateway
        # reaping our process group). The transcript and MCP offset remain inflight until
        # the reviewer atomically writes a valid success marker. Missing/invalid markers
        # become retryable only after RETRY_GRACE_SECONDS.
        try:
            SUCCESS_DIR.mkdir(parents=True, exist_ok=True)
            LEARN_LOG.parent.mkdir(parents=True, exist_ok=True)
            if marker.exists():
                marker.unlink()  # remove an invalid/stale marker before a new attempt
            with open(LEARN_LOG, "a", encoding="utf-8") as lf:
                subprocess.Popen(
                    cmd,
                    stdout=lf,
                    stderr=lf,
                    stdin=subprocess.DEVNULL,
                    start_new_session=True,
                )
            previous_attempt = int(inflight.get(f.name, {}).get("attempt", 0) or 0)
            inflight[f.name] = {
                "dispatched_at": now,
                "attempt": previous_attempt + 1,
                "mcp_key": mcp_key,
                "mcp_total": cur_total if mcp_key else 0,
            }
            print(f"  dispatched (detached): {f.name} via {mode} -> log {LEARN_LOG}")
        except Exception as e:
            print(f"  [learn-cron] dispatch failed for {f.name}: {e} (will retry next run)")
    if not DRY:
        save_state(done, offsets, inflight)

if __name__ == "__main__":
    main()
