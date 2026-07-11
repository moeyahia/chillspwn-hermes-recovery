#!/usr/bin/env python3
"""MCP server exposing the ChillsPwn agent-board tools to claude (native MCP).

Registered via `claude mcp add` — NEVER in buildClaudeArgs (the claude path stays frozen). Talks to the
dashboard over localhost HTTP (127.0.0.1:3131), so every kanban write funnels through the dashboard's
single writer (no SQLITE_BUSY race). Gives the CLAUDE-side orchestrator (e.g. ChillsPwn-on-Claude) the
same plan/delegate/gather loop the OpenRouter orchestrator has.

Self-planning (agent="self") routes to the orchestrator's OWN Backlog/Plan column and tags the card with
the model the orchestrator is running (Claude). Delegated cards (agent="<other>") run on the target
agent's OWN provider config — never overridden.

Run with the hermes venv python (FastMCP needs pydantic v2):
  /root/hermes-venv/bin/python board_mcp_server.py
"""
import os
import json
import time
import urllib.request
from mcp.server.fastmcp import FastMCP

DASH = os.environ.get("CHILLSPWN_DASHBOARD_URL", "http://127.0.0.1:3131")
ORCH = os.environ.get("CHILLSPWN_OR_PERSONA", "ChillsPwn")
PERSONAS_DIR = os.environ.get("CHILLSPWN_PERSONAS_DIR", "/root/.claude/chillspwn/personas")


def _orch_model() -> str:
    """The claude model the orchestrator persona is configured with (for the plan card's label)."""
    env = os.environ.get("CHILLSPWN_ORCH_MODEL")
    if env:
        return env
    try:
        for name in os.listdir(PERSONAS_DIR):
            pj = os.path.join(PERSONAS_DIR, name, "persona.json")
            if os.path.isfile(pj):
                d = json.load(open(pj))
                if d.get("name") == ORCH:
                    return d.get("model") or "claude-opus-4-8"
    except Exception:
        pass
    return "claude-opus-4-8"


def _http(method, path, body=None, timeout=15):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(DASH + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            return json.loads(raw) if raw.strip() else {}
    except Exception as e:
        return {"error": f"{type(e).__name__}: {e}"}


mcp = FastMCP("chillspwn-board")


@mcp.tool()
def board_list() -> str:
    """List the board's agent columns and the current cards (id, agent, status, title) so you can plan:
    which specialist agents you can delegate to, and what is already in flight."""
    cards = (_http("GET", "/api/board") or {}).get("cards") or []
    cols = (_http("GET", "/api/board/columns") or {}).get("columns") or []
    return json.dumps({
        "agents": [c.get("persona") for c in cols if not c.get("isBacklog") and c.get("enabled")],
        "cards": [{"id": c.get("id"), "agent": c.get("assignee"), "status": c.get("status"), "title": c.get("title")} for c in cards[:40]],
    })


@mcp.tool()
def board_create_task(agent: str, title: str, body: str, engagement: str = "") -> str:
    """Create a board card. Use agent="self" to add a step to YOUR OWN Backlog/Plan column (the card shows
    the model you are planning with and is NOT executed by an agent — you work it yourself). Use
    agent="<other-persona>" to DELEGATE a self-contained task to a specialist agent column; that agent runs
    it on its OWN provider + tools. The body must be complete — a delegated agent cannot ask you back.
    Returns the card_id."""
    if not agent or not title:
        return json.dumps({"error": "board_create_task needs agent + title"})
    is_self = agent in ("self", "__plan__", "backlog", "plan") or agent == ORCH
    if is_self:
        agent = ORCH
    payload = {"title": title, "body": body or "", "assignee": agent, "engagement": engagement or "", "createdBy": "orchestrator"}
    if is_self:
        payload["provider"] = "anthropic"     # this orchestrator runs on the Claude backend
        payload["model"] = _orch_model()       # the plan card shows the Claude model you are planning with
    r = _http("POST", "/api/kanban", payload)
    if r.get("error"):
        return json.dumps({"error": r["error"]})
    return json.dumps({"ok": True, "card_id": r.get("id"), "agent": agent, "dispatched": r.get("dispatched")})


@mcp.tool()
def board_await(card_ids: list, timeout: int = 600) -> str:
    """Block until the given board cards finish (done/failed), then return each card's result + the tools it
    used. Use to GATHER a parallel fan-out before planning the next wave. Always returns by the timeout
    (stragglers come back with status 'timeout')."""
    if isinstance(card_ids, str):
        card_ids = [c.strip() for c in card_ids.split(",") if c.strip()]
    if not card_ids:
        return json.dumps({"error": "board_await needs card_ids"})
    timeout = min(int(timeout or 600), 900)
    deadline = time.time() + timeout
    results = {}
    while time.time() < deadline and len(results) < len(card_ids):
        for cid in card_ids:
            if cid in results:
                continue
            c = _http("GET", f"/api/kanban/card/{cid}")
            if c.get("error"):
                continue
            if c.get("status") in ("done", "failed"):
                results[cid] = {"status": c.get("status"), "result": str(c.get("result") or c.get("error") or "")[:6000],
                                "tools": [t.get("name") for t in (c.get("tools") or []) if isinstance(t, dict)]}
        if len(results) < len(card_ids):
            time.sleep(2)
    for cid in card_ids:
        results.setdefault(cid, {"status": "timeout", "result": "(still running when board_await timed out)", "tools": []})
    return json.dumps({"ok": True, "results": results})


@mcp.tool()
def board_update(card_id: str, status: str = "", assignee: str = "") -> str:
    """Update a board card to keep your plan current: mark a Backlog/plan step done (status="done"), or
    PROMOTE a Backlog card to a specialist agent (assignee="<persona>"), which queues it for that agent to run."""
    if not card_id:
        return json.dumps({"error": "board_update needs card_id"})
    body = {}
    if status:
        body["status"] = status
    if assignee:
        body["assignee"] = assignee
    return json.dumps(_http("PUT", f"/api/board/card/{card_id}", body))


if __name__ == "__main__":
    mcp.run()
