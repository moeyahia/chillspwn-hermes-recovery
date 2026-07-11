# Phase 8 — OpenRouter/Codex runtime gate client.
#
# This is the TESTABLE form of the gate logic that is inlined into orchestrator_openrouter.py
# (see phase8-orchestrator-gating.patch). The orchestrator inlines the same logic with module-
# level env constants + the real _board_http; this class injects http/sleep/config so it can be
# unit-tested. Keep the two in sync — the decision logic is identical.
#
# With gating disabled (the default) gate() always returns ("allow", None, None): tools execute
# exactly as before. Claude is never gated here (different, frozen process).


# Pass-through = read-only / introspection tools that do NOT act on the target system and do NOT
# spawn other agents. Everything state-changing or delegating (delegate_task, board_create_task,
# board_update, skill_manage, remember) is GATED — 8.2 removed them from this list to close the
# delegated-agent bypass (a spawned worker would otherwise run tools outside the gate).
#   board_await / board_list  : wait-for / read the board (no mutation, no spawn)
#   use_skill / index_skills  : load / list skill playbooks (returns text; no mutation)
#   recall_conversation       : read the on-disk log (no mutation)
#   web_search / web_extract  : read-only web retrieval (no target-system mutation)
_GATE_PASSTHROUGH = {
    "board_await", "board_list", "use_skill", "recall_conversation", "index_skills",
    "web_search", "web_extract",
}

# Heuristic: treat obvious runtime-error output as a FAILED tool result (8.2). Conservative — only
# clear signals; ambiguous output stays success=True.
def infer_success(output):
    o = output or ""
    if o.startswith("[runtime gate") or o.startswith("ERROR:"):
        return False
    for marker in ("Traceback (most recent call last)", "Permission denied", "command not found"):
        if marker in o:
            return False
    return True


class GateClient:
    PASSTHROUGH = _GATE_PASSTHROUGH

    def __init__(self, *, enabled, mode, fail_mode="deny", run_id="", timeout=300, poll=2,
                 http=None, sleep=None):
        self.enabled = enabled
        self.mode = mode                     # off | dry-run | enforce
        self.fail_mode = fail_mode           # only "deny" supported — gate-unreachable fails CLOSED
        self.run_id = run_id
        self.timeout = timeout
        self.poll = max(1, poll)
        self._http = http or (lambda *a, **k: {"error": "no http"})  # (method, path, body) -> dict
        self._sleep = sleep or (lambda s: None)

    def active(self):
        return bool(self.enabled) and self.mode in ("dry-run", "enforce") and bool(self.run_id)

    def gate(self, name, args):
        """Return (decision, denial_msg, tool_call_id). decision in {'allow','deny'}."""
        if not self.active() or name in self.PASSTHROUGH:
            return ("allow", None, None)
        cmd = args.get("command") if isinstance(args, dict) else None
        resp = self._http("POST", "/api/runs/%s/tool-gate" % self.run_id,
                          {"toolName": name, "arguments": args if isinstance(args, dict) else {}, "command": cmd})
        if not isinstance(resp, dict) or resp.get("error"):
            if self.mode == "dry-run":
                return ("allow", None, None)                 # dry-run NEVER blocks
            return ("deny", "[runtime gate unreachable — fail-closed deny for '%s']" % name, None)
        decision = resp.get("decision")
        tcid = resp.get("toolCallId")
        if self.mode == "dry-run":
            return ("allow", None, tcid)                     # record what WOULD happen; never block
        if decision == "allow":
            return ("allow", None, tcid)
        if decision == "deny":
            return ("deny", "[runtime gate DENIED '%s': %s]" % (name, resp.get("reason", "policy")), tcid)
        if decision == "awaiting_approval":
            waited = 0
            while waited < self.timeout:
                self._sleep(self.poll)
                waited += self.poll
                st = self._http("GET", "/api/runs/%s/tool-calls/%s" % (self.run_id, tcid), None)
                s = st.get("status") if isinstance(st, dict) else None
                if s == "approved":
                    return ("allow", None, tcid)
                if s == "rejected":
                    return ("deny", "[runtime gate: operator REJECTED '%s']" % name, tcid)
            # 8.3: timed out — tell the runtime to EXPIRE the approval + reject the tool call so it
            # stops showing as action-required, then deny to the model.
            self._http("POST", "/api/runs/%s/tool-calls/%s/timeout" % (self.run_id, tcid),
                       {"reason": "gate approval timed out after %ss" % self.timeout})
            return ("deny", "[runtime gate: approval TIMED OUT for '%s']" % name, tcid)
        return ("deny", "[runtime gate: unrecognized decision for '%s']" % name, tcid)

    def record_result(self, tcid, success, output):
        if not (self.active() and tcid):
            return
        self._http("POST", "/api/runs/%s/tool-calls/%s/result" % (self.run_id, tcid),
                   {"success": bool(success), "output": (output or "")[:20000]})
