"""
Phase 16.4 — `mcp_execute` tool for the OpenRouter/Codex orchestrator.

This exposes the ENTIRE MCP arsenal to a specialist agent as ONE logical tool, `mcp_execute`, that
routes every call through the runtime's gated endpoint (`POST /api/mcp/execute`). The runtime applies
AgentRoutingPolicy + ToolPolicy + the approval gate + the per-specialist allowlist + MCP health — the
orchestrator never talks to an MCP server directly, never bypasses the gate, and never gets broad
tool access.

INTEGRATION (do NOT modify the Claude path):
  - Register `MCP_EXECUTE_TOOL_SCHEMA` in the OpenRouter/Codex tool list ONLY (not for claude-p).
  - Route the model's `mcp_execute` tool call to `run_mcp_execute(...)`.
  - Gate env already used by the Phase 8 gate client is reused (RUNTIME_BASE_URL, run_id, step_id).

This module is delivered as a reviewable artifact; it is NOT applied to the live orchestrator in this
phase (no deploy). The runtime endpoint it targets IS tested.
"""

import json
import os
import time
import urllib.request
import urllib.error

# The single logical tool the model sees. The model picks the specialist + server + tool + args;
# the runtime validates the binding and enforces the allowlist/gate.
MCP_EXECUTE_TOOL_SCHEMA = {
    "type": "function",
    "function": {
        "name": "mcp_execute",
        "description": (
            "Run a security MCP tool as a specialist agent. The runtime enforces your specialist "
            "allowlist + approvals; you may only call tools your specialist owns. Use the specialist "
            "you were assigned. Returns the tool output (truncated) + evidence id."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "specialistAgentId": {"type": "string", "description": "e.g. ReconScout, WebBreaker, CredSmith"},
                "mcpServer": {"type": "string", "description": "the MCP server name, e.g. sechub-reconnaissance"},
                "toolName": {"type": "string", "description": "a tool in your specialist's allowlist, e.g. quick_scan"},
                "arguments": {"type": "object", "description": "tool arguments"},
            },
            "required": ["specialistAgentId", "mcpServer", "toolName"],
        },
    },
}


def _post(url, payload, timeout=130):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"content-type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def _get(url, timeout=30):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode())


def run_mcp_execute(args, *, base_url=None, run_id=None, step_id=None,
                    approval_poll_seconds=5, approval_max_wait_seconds=900):
    """
    Execute one MCP tool call through the runtime gate.

    Mirrors the Phase 8 gate flow: the runtime may return `awaiting_approval`; we poll the run's
    approvals until the operator approves/rejects, then re-dispatch with the same toolCallId. NEVER
    bypasses the gate. Returns a dict the orchestrator can hand back to the model as the tool result.
    """
    base_url = base_url or os.environ.get("RUNTIME_BASE_URL", "http://127.0.0.1:3131")
    run_id = run_id or os.environ.get("CHILLSPWN_RUN_ID")
    step_id = step_id or os.environ.get("CHILLSPWN_STEP_ID")
    if not run_id:
        return {"success": False, "error": "no run_id — mcp_execute requires a managed run context"}

    body = {
        "runId": run_id,
        "stepId": step_id,
        "actorAgentId": args.get("specialistAgentId"),
        "specialistAgentId": args.get("specialistAgentId"),
        "mcpServer": args.get("mcpServer"),
        "toolName": args.get("toolName"),
        "arguments": args.get("arguments") or {},
    }
    try:
        res = _post(f"{base_url}/api/mcp/execute", body)
    except urllib.error.HTTPError as e:
        return {"success": False, "error": f"runtime rejected mcp_execute: HTTP {e.code} {e.read().decode()[:200]}"}
    except Exception as e:  # noqa: BLE001
        return {"success": False, "error": f"mcp_execute transport error: {e}"}

    decision = res.get("decision")
    if decision in ("deny",) or res.get("routingBlocked"):
        return {"success": False, "error": res.get("error", "denied"), "decision": decision}
    if decision == "dry-run":
        return {"success": True, "dryRun": True, "output": res.get("outputPreview", "")}
    if decision == "executed":
        return res

    # awaiting_approval → poll the run's approvals, then re-dispatch with the toolCallId.
    if decision == "awaiting_approval":
        tc_id = res.get("toolCallId")
        waited = 0
        while waited < approval_max_wait_seconds:
            time.sleep(approval_poll_seconds)
            waited += approval_poll_seconds
            try:
                appr = _get(f"{base_url}/api/runs/{run_id}/tool-calls/{tc_id}")
            except Exception:  # noqa: BLE001
                continue
            status = (appr.get("toolCall") or appr).get("status")
            if status in ("approved", "executing"):
                return _post(f"{base_url}/api/mcp/execute", {**body, "toolCallId": tc_id})
            if status in ("rejected", "denied", "expired"):
                return {"success": False, "error": f"approval {status} for {body['mcpServer']}.{body['toolName']}"}
        return {"success": False, "error": "approval timed out"}

    return {"success": False, "error": f"unexpected decision: {decision}", "raw": res}
