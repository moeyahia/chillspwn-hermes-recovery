#!/usr/bin/env python3
"""MCP server exposing the ChillsPwn agent-board tools to an orchestrator (native MCP).

Registered via `claude mcp add` — NEVER in buildClaudeArgs (the claude path stays frozen). Talks to the
dashboard over localhost HTTP (127.0.0.1:3131), so every kanban write funnels through the dashboard's
single writer (no SQLITE_BUSY race). Gives every supported orchestrator the same
plan/delegate/gather loop.

Self-planning (agent="self") routes to the orchestrator's OWN Backlog/Plan column and is never
dispatched. It records intent only; the orchestrator must delegate executable work to a different
named specialist. Delegated cards run on the target agent's OWN provider config — never overridden.

Run with the configured Hermes virtual-environment Python (FastMCP needs pydantic v2).
"""
import os
import json
import time
import urllib.request
from mcp.server.fastmcp import FastMCP

DASH = os.environ.get("CHILLSPWN_DASHBOARD_URL", "http://127.0.0.1:3131")
ORCH = os.environ.get("CHILLSPWN_OR_PERSONA", "ChillsPwn")
PERSONAS_DIR = os.environ.get("CHILLSPWN_PERSONAS_DIR", "").strip()


def _orch_model() -> str:
    """The orchestrator model configured for the plan card's label."""
    env = os.environ.get("CHILLSPWN_ORCH_MODEL")
    if env:
        return env
    try:
        if not PERSONAS_DIR:
            return "claude-opus-4-8"
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
    """Create a board card. Use agent="self" only to record a planning step in YOUR OWN Backlog/Plan
    column. A self card is never executed and never authorizes you to work it yourself. Use
    agent="<other-persona>" to DELEGATE a self-contained task to a specialist agent column; that agent runs
    it on its OWN provider + tools. The body must be complete — a delegated agent cannot ask you back.
    Returns the card_id."""
    agent = str(agent or "").strip()
    title = str(title or "").strip()
    if not agent or not title:
        return json.dumps({"error": "board_create_task needs agent + title"})
    agent_key = agent.casefold()
    is_self = agent_key in ("self", "__plan__", "backlog", "plan", ORCH.strip().casefold())
    if is_self:
        agent = ORCH
    payload = {"title": title, "body": body or "", "assignee": agent, "engagement": engagement or "", "createdBy": "orchestrator"}
    if is_self:
        payload["provider"] = os.environ.get("CHILLSPWN_ORCH_PROVIDER", "anthropic")
        payload["model"] = _orch_model()
        payload["planningOnly"] = True
    r = _http("POST", "/api/kanban", payload)
    if r.get("error"):
        return json.dumps({"error": r["error"]})
    return json.dumps({
        "ok": True,
        "card_id": r.get("id"),
        "agent": agent,
        "dispatched": r.get("dispatched"),
        "planning_only": is_self,
    })


@mcp.tool()
def board_await(card_ids: list, timeout: int = 600) -> str:
    """Block until the given board cards reach a terminal state (done/failed/blocked), then return each
    card's result + the tools it used. A blocked card is terminal for this wait: return it immediately so
    the orchestrator can inspect the blocker and plan a recovery wave. Each call is capped at a 120-second
    heartbeat window. Non-terminal cards return their latest status, partial result, and observed tools at
    the heartbeat so the orchestrator can report progress or plan the next wait."""
    if isinstance(card_ids, str):
        card_ids = [c.strip() for c in card_ids.split(",") if c.strip()]
    if not card_ids:
        return json.dumps({"error": "board_await needs card_ids"})
    timeout = min(int(timeout or 600), 120)
    deadline = time.time() + timeout
    results = {}
    latest = {}
    while time.time() < deadline and len(results) < len(card_ids):
        for cid in card_ids:
            if cid in results:
                continue
            c = _http("GET", f"/api/kanban/card/{cid}")
            if c.get("error"):
                continue
            latest[cid] = c
            if c.get("status") in ("done", "failed", "blocked"):
                results[cid] = {"status": c.get("status"), "result": str(c.get("result") or c.get("error") or "")[:6000],
                                "tools": [t.get("name") for t in (c.get("tools") or []) if isinstance(t, dict)]}
        if len(results) < len(card_ids):
            time.sleep(2)
    for cid in card_ids:
        if cid in results:
            continue
        c = latest.get(cid)
        if c:
            status = str(c.get("status") or "unknown")
            results[cid] = {
                "status": status,
                "result": str(c.get("result") or c.get("error") or f"(still {status} at board_await heartbeat)")[:6000],
                "tools": [t.get("name") for t in (c.get("tools") or []) if isinstance(t, dict)],
                "heartbeat_timeout": True,
            }
        else:
            results[cid] = {
                "status": "timeout",
                "result": "(no card state available at board_await heartbeat)",
                "tools": [],
                "heartbeat_timeout": True,
            }
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
