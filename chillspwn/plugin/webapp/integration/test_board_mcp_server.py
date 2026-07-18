"""Regression tests for the recovery snapshot's ChillsPwn board MCP server.

Run: python3 integration/test_board_mcp_server.py
"""
import importlib.util
import io
import json
import os
import sys
import types
import urllib.error
from pathlib import Path


try:
    from mcp.server.fastmcp import FastMCP as _FastMCP  # noqa: F401
except ImportError:
    # The regression exercises the pure tool functions, not the transport. Keep
    # it portable in CI without resolving the full Hermes environment.
    class _FastMCPStub:
        def __init__(self, _name):
            pass

        def tool(self):
            return lambda function: function

        def run(self):
            raise AssertionError("transport must not start in this regression")

    mcp_module = types.ModuleType("mcp")
    server_module = types.ModuleType("mcp.server")
    fastmcp_module = types.ModuleType("mcp.server.fastmcp")
    fastmcp_module.FastMCP = _FastMCPStub
    sys.modules.update({
        "mcp": mcp_module,
        "mcp.server": server_module,
        "mcp.server.fastmcp": fastmcp_module,
    })


BOARD_MCP_SERVER = os.environ.get(
    "CHILLSPWN_BOARD_MCP_SERVER",
    str(
        Path(__file__).resolve().parents[1]
        / "server/providers/grok-commander-mcp/board_mcp_server.py"
    ),
)


def load_board_mcp_server():
    spec = importlib.util.spec_from_file_location("chillspwn_board_mcp_server", BOARD_MCP_SERVER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load board MCP server from {BOARD_MCP_SERVER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


board = load_board_mcp_server()


real_http = board._http
real_urlopen = board.urllib.request.urlopen


def reject_with_reason(_request, timeout=15):
    del timeout
    raise urllib.error.HTTPError(
        "http://127.0.0.1:3131/api/kanban",
        400,
        "Bad Request",
        None,
        io.BytesIO(b'{"error":"engagement must identify an existing configured workspace"}'),
    )


board.urllib.request.urlopen = reject_with_reason
rejected_request = real_http("POST", "/api/kanban", {"title": "Plan"})
board.urllib.request.urlopen = real_urlopen


class FakeClock:
    def __init__(self, *, fail_on_sleep=False):
        self.now = 0
        self.sleeps = []
        self.fail_on_sleep = fail_on_sleep

    def time(self):
        return self.now

    def sleep(self, seconds):
        if self.fail_on_sleep:
            raise AssertionError("board_await slept after receiving a terminal card")
        self.sleeps.append(seconds)
        self.now += seconds


calls = []


def blocked_card(method, path, body=None, timeout=15):
    calls.append((method, path))
    return {
        "id": "blocked-card",
        "status": "blocked",
        "result": "target reset required",
        "tools": [{"name": "run_terminal_command"}],
    }


board._http = blocked_card
board.time = FakeClock(fail_on_sleep=True)

result = json.loads(board.board_await(["blocked-card"], timeout=600))
card = result["results"]["blocked-card"]

checks = {
    "HTTP rejection preserves the server correction": rejected_request.get("error") == (
        "HTTP 400: engagement must identify an existing configured workspace"
    ),
    "HTTP rejection includes a stable status": rejected_request.get("status") == 400,
    "HTTP 400 is not mislabeled retryable": rejected_request.get("retryable") is False,
    "blocked card returns successfully": result.get("ok") is True,
    "blocked status is preserved": card.get("status") == "blocked",
    "blocked result is preserved": card.get("result") == "target reset required",
    "tool evidence is preserved": card.get("tools") == ["run_terminal_command"],
    "blocked card is fetched only once": calls == [("GET", "/api/kanban/card/blocked-card")],
}


active_calls = []


def active_card(method, path, body=None, timeout=15):
    active_calls.append((method, path))
    return {
        "id": "active-card",
        "status": "running",
        "result": "enumeration reached stage two",
        "tools": [
            {"name": "run_terminal_command"},
            {"name": "read_file"},
        ],
    }


clock = FakeClock()
board._http = active_card
board.time = clock
active_result = json.loads(board.board_await(["active-card"], timeout=700))
active = active_result["results"]["active-card"]

checks.update({
    "requested timeout is capped at 120 seconds": sum(clock.sleeps) == 120,
    "heartbeat preserves active status": active.get("status") == "running",
    "heartbeat preserves partial result": active.get("result") == "enumeration reached stage two",
    "heartbeat preserves observed tools": active.get("tools") == ["run_terminal_command", "read_file"],
    "heartbeat is explicitly identified": active.get("heartbeat_timeout") is True,
    "active card was polled throughout heartbeat": len(active_calls) == 60,
})


create_calls = []


def create_card(method, path, body=None, timeout=15):
    create_calls.append((method, path, body))
    return {"id": "plan-card", "dispatched": False}


os.environ["CHILLSPWN_ORCH_PROVIDER"] = "xai-grok"
os.environ["CHILLSPWN_ORCH_MODEL"] = "grok-4"
board._http = create_card
plan_result = json.loads(board.board_create_task(" self ", " Plan next wave ", "delegate it"))
plan_payload = create_calls[-1][2]

checks.update({
    "self card is explicitly planning-only": plan_result.get("planning_only") is True,
    "self card is not reported as dispatched": plan_result.get("dispatched") is False,
    "self card records the active orchestrator provider": plan_payload.get("provider") == "xai-grok",
    "self card records the active orchestrator model": plan_payload.get("model") == "grok-4",
    "self card carries the planning-only boundary": plan_payload.get("planningOnly") is True,
    "self alias is normalized to the orchestrator": plan_payload.get("assignee") == board.ORCH,
})

failed = [name for name, passed in checks.items() if not passed]
for name, passed in checks.items():
    print(("PASS" if passed else "FAIL") + "  " + name)

sys.exit(1 if failed else 0)
