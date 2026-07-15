#!/usr/bin/env python3
"""Minimal native MCP bridge for a ChillsPwn coordination commander.

All board writes remain serialized through the authenticated local dashboard.
Self cards are planning records only; executable work must be assigned to a
different specialist. This file ships inside the root-controlled application
release so a service user cannot replace the commander's delegation surface.
"""
import json
import os
import time
import urllib.request

from mcp.server.fastmcp import FastMCP


DASH = os.environ.get("CHILLSPWN_DASHBOARD_URL", "http://127.0.0.1:3131")
ORCH = os.environ.get("CHILLSPWN_OR_PERSONA", "ChillsPwn")
PERSONAS_DIR = os.environ.get("CHILLSPWN_PERSONAS_DIR", "").strip()


def _orch_model() -> str:
    configured = os.environ.get("CHILLSPWN_ORCH_MODEL")
    if configured:
        return configured
    if not PERSONAS_DIR:
        return "claude-opus-4-8"
    try:
        for name in os.listdir(PERSONAS_DIR):
            persona_path = os.path.join(PERSONAS_DIR, name, "persona.json")
            if not os.path.isfile(persona_path):
                continue
            with open(persona_path, encoding="utf-8") as handle:
                persona = json.load(handle)
            if persona.get("name") == ORCH:
                return persona.get("model") or "claude-opus-4-8"
    except (OSError, ValueError, TypeError):
        pass
    return "claude-opus-4-8"


def _http(method, path, body=None, timeout=15):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        DASH + path,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", "replace")
            return json.loads(raw) if raw.strip() else {}
    except Exception as error:  # MCP result must remain structured for recovery.
        return {"error": f"{type(error).__name__}: {error}"}


mcp = FastMCP("chillspwn-board")


@mcp.tool()
def board_list() -> str:
    """List specialist columns and current cards for bounded delegation planning."""
    cards = (_http("GET", "/api/board") or {}).get("cards") or []
    columns = (_http("GET", "/api/board/columns") or {}).get("columns") or []
    return json.dumps({
        "agents": [
            column.get("persona")
            for column in columns
            if not column.get("isBacklog") and column.get("enabled")
        ],
        "cards": [
            {
                "id": card.get("id"),
                "agent": card.get("assignee"),
                "status": card.get("status"),
                "title": card.get("title"),
            }
            for card in cards[:40]
        ],
    })


@mcp.tool()
def board_create_task(agent: str, title: str, body: str, engagement: str = "") -> str:
    """Record a self planning card or delegate one complete task to a specialist."""
    agent = str(agent or "").strip()
    title = str(title or "").strip()
    if not agent or not title:
        return json.dumps({"error": "board_create_task needs agent + title"})
    is_self = agent.casefold() in {
        "self", "__plan__", "backlog", "plan", ORCH.strip().casefold(),
    }
    if is_self:
        agent = ORCH
    payload = {
        "title": title,
        "body": body or "",
        "assignee": agent,
        "engagement": engagement or "",
        "createdBy": "orchestrator",
    }
    if is_self:
        payload.update({
            "provider": os.environ.get("CHILLSPWN_ORCH_PROVIDER", "anthropic"),
            "model": _orch_model(),
            "planningOnly": True,
        })
    result = _http("POST", "/api/kanban", payload)
    if result.get("error"):
        return json.dumps({"error": result["error"]})
    return json.dumps({
        "ok": True,
        "card_id": result.get("id"),
        "agent": agent,
        "dispatched": result.get("dispatched"),
        "planning_only": is_self,
    })


@mcp.tool()
def board_await(card_ids: list, timeout: int = 600) -> str:
    """Wait one bounded heartbeat window for delegated cards to become terminal."""
    if isinstance(card_ids, str):
        card_ids = [card.strip() for card in card_ids.split(",") if card.strip()]
    if not card_ids:
        return json.dumps({"error": "board_await needs card_ids"})
    timeout = min(int(timeout or 600), 120)
    deadline = time.time() + timeout
    results = {}
    latest = {}
    while time.time() < deadline and len(results) < len(card_ids):
        for card_id in card_ids:
            if card_id in results:
                continue
            card = _http("GET", f"/api/kanban/card/{card_id}")
            if card.get("error"):
                continue
            latest[card_id] = card
            if card.get("status") in ("done", "failed", "blocked"):
                results[card_id] = {
                    "status": card.get("status"),
                    "result": str(card.get("result") or card.get("error") or "")[:6000],
                    "tools": [
                        tool.get("name")
                        for tool in (card.get("tools") or [])
                        if isinstance(tool, dict)
                    ],
                }
        if len(results) < len(card_ids):
            time.sleep(2)
    for card_id in card_ids:
        if card_id in results:
            continue
        card = latest.get(card_id)
        if card:
            status = str(card.get("status") or "unknown")
            results[card_id] = {
                "status": status,
                "result": str(card.get("result") or card.get("error") or f"(still {status} at heartbeat)")[:6000],
                "tools": [
                    tool.get("name")
                    for tool in (card.get("tools") or [])
                    if isinstance(tool, dict)
                ],
                "heartbeat_timeout": True,
            }
        else:
            results[card_id] = {
                "status": "timeout",
                "result": "(no card state available at heartbeat)",
                "tools": [],
                "heartbeat_timeout": True,
            }
    return json.dumps({"ok": True, "results": results})


@mcp.tool()
def board_update(card_id: str, status: str = "", assignee: str = "") -> str:
    """Update planning state or promote a planning card to a specialist."""
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
