"""
council_state.py — shared, file-locked GLOBAL state for council runs.

Read by ChillsPwn (so the agent relies on council state) AND the dashboard;
written by council_summon.py and the dashboard. Lives at
$HERMES_HOME/council/state.json (flock-guarded, like the memory store).

Each run carries a completion_mode:
  • auto   → self-completes when all lanes finish.
  • manual → sits in 'awaiting_review' until marked complete (dashboard/user);
             ChillsPwn HARD-PAUSES that engagement until then.
Statuses: running → (auto) completed | (manual) awaiting_review → completed.
"""
import fcntl
import json
import os
import re
from datetime import datetime
from pathlib import Path


def _home():
    return Path(os.environ.get("HERMES_HOME", str(Path.home() / ".hermes")))


def state_path():
    d = _home() / "council"
    d.mkdir(parents=True, exist_ok=True)
    return d / "state.json"


def _now():
    return datetime.now().astimezone().isoformat()


def _default():
    # Default = AUTO (council self-completes when lanes finish). The user flips a
    # run to MANUAL only when they want to review before it's marked complete.
    return {"settings": {"default_completion_mode": "auto"}, "runs": {}}


def update(mutator):
    """Atomic read-modify-write under an exclusive lock. mutator(state)->state."""
    p = state_path()
    if not p.exists():
        p.write_text(json.dumps(_default(), indent=2))
    with open(p, "r+", encoding="utf-8") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            raw = f.read()
            try:
                st = json.loads(raw) if raw.strip() else _default()
            except Exception:
                st = _default()
            st = mutator(st) or st
            f.seek(0)
            f.truncate()
            f.write(json.dumps(st, indent=2))
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)
    return st


def read():
    p = state_path()
    if not p.exists():
        return _default()
    try:
        with open(p, encoding="utf-8") as f:
            fcntl.flock(f, fcntl.LOCK_SH)
            try:
                return json.loads(f.read() or "{}") or _default()
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)
    except Exception:
        return _default()


def get_default_mode():
    return read().get("settings", {}).get("default_completion_mode", "manual")


def set_default_mode(mode):
    def m(st):
        st.setdefault("settings", {})["default_completion_mode"] = "auto" if mode == "auto" else "manual"
        return st
    return update(m)


def ensure_run(engagement, engagement_dir, briefing, completion_mode, lanes):
    """lanes: {id: {display, provider, mode}}. (Re)creates a run as 'running'."""
    def m(st):
        st.setdefault("runs", {})[engagement] = {
            "engagement": engagement,
            "engagement_dir": str(engagement_dir),
            "status": "running",
            "completion_mode": "auto" if completion_mode == "auto" else "manual",
            "briefing": (briefing or "")[:2000],
            "started_at": _now(), "finished_at": None, "completed_at": None,
            "lanes": {lid: {**meta, "status": "pending", "assessment_bytes": 0, "tools_called": []}
                      for lid, meta in lanes.items()},
        }
        return st
    return update(m)


def update_lane(engagement, lane_id, status=None, assessment_bytes=None, tools_called=None):
    def m(st):
        run = st.get("runs", {}).get(engagement)
        if not run:
            return st
        lane = run["lanes"].setdefault(lane_id, {})
        if status is not None:
            lane["status"] = status
        if assessment_bytes is not None:
            lane["assessment_bytes"] = assessment_bytes
        if tools_called is not None:
            lane["tools_called"] = tools_called
        return st
    return update(m)


def finish_run(engagement):
    """All lanes done: auto→completed, manual→awaiting_review."""
    def m(st):
        run = st.get("runs", {}).get(engagement)
        if not run:
            return st
        run["finished_at"] = _now()
        if run.get("completion_mode") == "auto":
            run["status"] = "completed"
            run["completed_at"] = _now()
        else:
            run["status"] = "awaiting_review"
        return st
    return update(m)


def complete_run(engagement):
    """Manual completion (dashboard/user pressed Complete)."""
    def m(st):
        run = st.get("runs", {}).get(engagement)
        if run:
            run["status"] = "completed"
            run["completed_at"] = _now()
        return st
    return update(m)


def set_run_mode(engagement, mode):
    def m(st):
        run = st.get("runs", {}).get(engagement)
        if run:
            run["completion_mode"] = "auto" if mode == "auto" else "manual"
        return st
    return update(m)


_TOOL_LINE = re.compile(r'↳\s+([A-Za-z_]\w*)\s*\(')  # the "↳ toolname(" lane-log lines


def parse_tools(log_path):
    """Ordered unique tools a direct lane called, from its log's ↳ lines."""
    try:
        text = Path(log_path).read_text(errors="ignore")
    except Exception:
        return []
    order, counts = [], {}
    for mt in _TOOL_LINE.finditer(text):
        t = mt.group(1)
        counts[t] = counts.get(t, 0) + 1
        if t not in order:
            order.append(t)
    return [{"tool": t, "calls": counts[t]} for t in order]


def summary_text():
    """Accurate, on-demand, agent-readable snapshot of all council state.
    ChillsPwn runs `python3 council_state.py` to capture the CURRENT state."""
    st = read()
    runs = st.get("runs", {})
    lines = [f"Council default completion mode: {st.get('settings', {}).get('default_completion_mode', 'auto')}"]
    if not runs:
        lines.append("No council runs recorded.")
        return "\n".join(lines)
    for eng, r in sorted(runs.items(), key=lambda kv: kv[1].get("started_at", ""), reverse=True):
        lines.append("")
        lines.append(f"### {eng} — status={r.get('status')} (completion_mode={r.get('completion_mode')})")
        lines.append(f"    dir: {r.get('engagement_dir')}")
        if r.get("status") == "awaiting_review":
            lines.append("    ⛔ HARD PAUSE — awaiting your review. Do NOT proceed on this engagement until it is marked Completed.")
        elif r.get("status") == "completed":
            lines.append("    ✅ completed — read all lane assessments in <dir>/council/*_assessment.md and decide.")
        for lid, lane in r.get("lanes", {}).items():
            tools = ", ".join(f"{t['tool']}×{t['calls']}" for t in lane.get("tools_called", [])) or "—"
            lines.append(f"    - {lane.get('display', lid)} [{lane.get('mode','?')}/{lane.get('provider','?')}]: "
                         f"{lane.get('status')} ({lane.get('assessment_bytes', 0)}b) | tools: {tools}")
    return "\n".join(lines)


if __name__ == "__main__":
    import sys as _sys
    print(json.dumps(read(), indent=2) if "--json" in _sys.argv else summary_text())
