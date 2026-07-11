"""Phase 8 — unit tests for the OpenRouter/Codex gate client logic.
Run: python3 integration/test_or_gate_client.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from or_gate_client import GateClient, infer_success, _GATE_PASSTHROUGH


def mock_http(responses):
    calls = []

    def http(method, path, body=None):
        calls.append((method, path, body))
        return responses.pop(0) if responses else {"error": "empty"}

    return http, calls


def gc(**kw):
    base = dict(enabled=True, mode="enforce", fail_mode="deny", run_id="r1",
                http=lambda *a, **k: {}, sleep=lambda s: None)
    base.update(kw)
    return GateClient(**base)


_n = [0, 0]


def check(name, cond):
    _n[0 if cond else 1] += 1
    print(("PASS" if cond else "FAIL") + "  " + name)


# 1. gating disabled preserves current behavior (allow, no gate call)
http, calls = mock_http([])
check("gating disabled → allow + no gate call", gc(enabled=False, http=http).gate("terminal", {"command": "id"}) == ("allow", None, None) and not calls)

# 2. read-only tools pass through (not gated). NB: 8.2 — delegation/state-changing tools
# (board_create_task, delegate_task, …) are NO LONGER pass-through; see the 8.2 tests below.
http, calls = mock_http([])
check("read-only tool passes through (not gated)", gc(http=http).gate("web_search", {}) == ("allow", None, None) and not calls)

# 3. dry-run never blocks — even when the gate says deny
http, _ = mock_http([{"decision": "deny", "toolCallId": "t1", "reason": "x"}])
d = gc(mode="dry-run", http=http).gate("terminal", {})
check("dry-run does not block (records would-be deny)", d[0] == "allow" and d[2] == "t1")

# 4. enforce allow executes
http, _ = mock_http([{"decision": "allow", "toolCallId": "t1"}])
check("enforce allow → execute", gc(http=http).gate("nmap", {})[0] == "allow")

# 5. enforce deny blocks
http, _ = mock_http([{"decision": "deny", "toolCallId": "t1", "reason": "terminal disabled"}])
check("enforce deny → block", gc(http=http).gate("terminal", {})[0] == "deny")

# 6. approval required → wait → accepted → execute
http, _ = mock_http([{"decision": "awaiting_approval", "toolCallId": "t1"}, {"status": "pending"}, {"status": "approved"}])
check("approval accepted → execute", gc(http=http, poll=1).gate("terminal", {})[0] == "allow")

# 7. approval rejected → block
http, _ = mock_http([{"decision": "awaiting_approval", "toolCallId": "t1"}, {"status": "rejected"}])
check("approval rejected → block", gc(http=http, poll=1).gate("terminal", {})[0] == "deny")

# 8. approval timeout → block
http, _ = mock_http([{"decision": "awaiting_approval", "toolCallId": "t1"}] + [{"status": "pending"}] * 100)
check("approval timeout → block", gc(http=http, poll=1, timeout=3).gate("terminal", {})[0] == "deny")

# 9. gate unreachable in enforce → fail closed (deny)
http, _ = mock_http([{"error": "ConnectionRefused"}])
check("gate unreachable (enforce) → fail-closed deny", gc(http=http).gate("terminal", {})[0] == "deny")

# 10. gate unreachable in dry-run → do not block
http, _ = mock_http([{"error": "x"}])
check("gate unreachable (dry-run) → allow", gc(mode="dry-run", http=http).gate("terminal", {})[0] == "allow")

# 11. result recording posts to the result endpoint
posted = []
http = lambda m, p, b=None: posted.append((m, p)) or {}
gc(http=http).record_result("t1", True, "output")
check("record_result posts to result endpoint", any("/result" in p for _, p in posted))


# ── 8.2: delegated/state-changing tools must be GATED, not passed through ──
def test2(name, cond):
    _n[0 if cond else 1] += 1
    print(("PASS" if cond else "FAIL") + "  " + name)

for gated_tool in ["delegate_task", "board_create_task", "board_update", "skill_manage", "remember"]:
    http, calls = mock_http([{"decision": "deny", "toolCallId": "t1", "reason": "terminal"}])
    res = gc(http=http).gate(gated_tool, {})
    test2(f"{gated_tool} is GATED (calls runtime gate, not pass-through)", len(calls) == 1 and res[0] == "deny")

for ro_tool in ["board_await", "board_list", "use_skill", "recall_conversation", "index_skills", "web_search", "web_extract"]:
    http, calls = mock_http([])
    res = gc(http=http).gate(ro_tool, {})
    test2(f"{ro_tool} is read-only pass-through (no gate call)", len(calls) == 0 and res == ("allow", None, None))

test2("delegate_task NOT in passthrough set", "delegate_task" not in _GATE_PASSTHROUGH)
test2("board_create_task NOT in passthrough set", "board_create_task" not in _GATE_PASSTHROUGH)

# ── 8.2: infer_success on obvious runtime errors ──
test2("infer_success False on [runtime gate denial", infer_success("[runtime gate DENIED 'terminal']") is False)
test2("infer_success False on ERROR:", infer_success("ERROR: bad thing") is False)
test2("infer_success False on Traceback", infer_success("oops\nTraceback (most recent call last):\n  ...") is False)
test2("infer_success False on Permission denied", infer_success("bash: Permission denied") is False)
test2("infer_success False on command not found", infer_success("zsh: command not found: nmapp") is False)
test2("infer_success True on normal output", infer_success("80/tcp open http") is True)
test2("infer_success True on empty", infer_success("") is True)

# ── 8.3: on approval timeout the gate client notifies the runtime to EXPIRE the approval ──
_to_calls = []
def _http_timeout(method, path, body=None):
    _to_calls.append((method, path))
    if path.endswith("/tool-gate"):
        return {"decision": "awaiting_approval", "toolCallId": "t1"}
    if path.endswith("/tool-calls/t1/timeout"):
        return {"ok": True}
    return {"status": "pending"}  # poll: never resolves → times out
_res = GateClient(enabled=True, mode="enforce", run_id="r1", http=_http_timeout, sleep=lambda s: None, poll=1, timeout=2).gate("terminal", {})
test2("timeout denies the tool", _res[0] == "deny")
test2("timeout POSTs to /tool-calls/t1/timeout (expire approval)", any(m == "POST" and p.endswith("/tool-calls/t1/timeout") for m, p in _to_calls))

print("\n%d pass / %d fail" % (_n[0], _n[1]))
sys.exit(1 if _n[1] else 0)
