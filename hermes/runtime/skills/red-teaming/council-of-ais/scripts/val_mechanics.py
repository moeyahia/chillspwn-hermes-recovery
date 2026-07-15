#!/usr/bin/env python3
"""Offline validation of the ChillsPwn memory engine mechanics (no API calls).
Run from the scripts dir so `orchestrator_openrouter` + `conversation_recall` import.
Exercises: ledger merge/render/dedup, DSML tool-call parsing, conversation recall,
and full-history reconstruction. Prints PASS/FAIL per check."""
import json, os, sys, tempfile, importlib

import orchestrator_openrouter as O
import conversation_recall as CR

PASS = 0
FAIL = 0
def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"PASS  {name}")
    else:
        FAIL += 1
        print(f"FAIL  {name}  {detail}")

# 1) ledger merge + dedup + render
led = O.empty_ledger()
led = O.merge_ledger(led, {
    "hosts": {"192.0.2.5": {"ports": ["22/ssh", "80/http"], "os": "ExampleOS", "hostname": "target.example"}},
    "credentials": [{"user": "test-user", "secret": "TEST_ONLY_NOT_A_SECRET", "service": "ssh", "validated": True}],
    "vulns": [{"host": "192.0.2.5", "name": "CVE-2099-0001", "detail": "Synthetic test vulnerability", "exploited": True}],
    "flags": [{"type": "user", "value": "TEST{SYNTHETIC_FLAG}", "host": "192.0.2.5"}],
    "tasks_done": ["nmap full scan", "enumerated ftp vhost"],
    "tasks_pending": ["privesc to root"],
    "key_facts": ["real entry is ftp.<host> vhost"],
})
# merge again with an overlapping + a new port -> must dedup and union ports
led = O.merge_ledger(led, {
    "hosts": {"192.0.2.5": {"ports": ["80/http", "2222/ssh"]}},
    "tasks_done": ["nmap full scan"],          # duplicate -> must NOT double
    "credentials": [{"user": "test-user", "secret": "TEST_ONLY_NOT_A_SECRET", "service": "ssh"}],  # dup by user
})
ports = sorted(led["hosts"]["192.0.2.5"]["ports"])
check("ledger.hosts ports unioned+deduped", ports == ["22/ssh", "2222/ssh", "80/http"], str(ports))
check("ledger.tasks_done deduped", led["tasks_done"].count("nmap full scan") == 1, str(led["tasks_done"]))
check("ledger.credentials deduped by user", len(led["credentials"]) == 1, str(led["credentials"]))
rendered = O.render_ledger(led)
check("render shows host", "192.0.2.5" in rendered)
check("render shows EXPLOITED vuln", "EXPLOITED" in rendered and "CVE-2099-0001" in rendered)
check("render shows 'do NOT repeat' tasks", "do NOT repeat" in rendered and "nmap full scan" in rendered)
check("render shows flag", "TEST{SYNTHETIC_FLAG}" in rendered)

# 2) DSML text tool-call parsing (the exact shape deepseek-v4-pro emits)
dsml = (
    'I will enumerate.\n'
    '<|DSML|tool_calls>\n'
    '<|DSML|invoke name="terminal">\n'
    '<|DSML|parameter name="command" string="true">whoami; id</|DSML|parameter>\n'
    '<|DSML|parameter name="timeout" string="false">25</|DSML|parameter>\n'
    '</|DSML|invoke>\n'
    '</|DSML|tool_calls>'
)
# the parser only accepts known tool names; force-allow "terminal" for the test
_orig_names = O._TOOL_NAMES
O._TOOL_NAMES = set(_orig_names) | {"terminal"}
calls, cleaned = O.parse_text_tool_calls(dsml)
O._TOOL_NAMES = _orig_names
check("DSML parsed one call", len(calls) == 1, str(calls))
if calls:
    c = calls[0]
    check("DSML call name=terminal", c["name"] == "terminal", c["name"])
    check("DSML command param captured", c["input"].get("command") == "whoami; id", str(c["input"]))
    check("DSML timeout coerced to int", c["input"].get("timeout") == 25, repr(c["input"].get("timeout")))
check("DSML cleaned text has no markup", "DSML" not in cleaned, repr(cleaned))

# 3) conversation recall (append-only log + budget-aware retrieval)
d = tempfile.mkdtemp(prefix="valmcp_")
CR.append(d, {"role": "user", "content": "start recon on target.example"})
CR.append(d, {"role": "tool", "toolName": "terminal", "content": "synthetic SSH password for test-user is TEST_CANARY_7788"})
CR.append(d, {"role": "assistant", "content": "noted the synthetic test data, moving on"})
for i in range(5):
    CR.append(d, {"role": "user", "content": f"unrelated chatter line {i}"})
recalled = CR.recall(d, "test-user ssh password", 4000)
check("recall finds the canary by keyword", "TEST_CANARY_7788" in recalled, recalled[:200])
recent = CR.get_recent(d, 3)
check("get_recent returns last records", "chatter line 4" in recent, recent[:200])
empty = CR.recall(tempfile.mkdtemp(prefix="valempty_"), "x", 1000)
check("recall on empty log is safe", "empty" in empty.lower(), empty)

# 4) reconstruct(): preserve full native history; compaction is a separate preflight concern
rows = []
for i in range(24):
    rows.append({"role": "user" if i % 2 == 0 else "assistant", "content": f"recon step {i}"})
sf = os.path.join(d, "sess.json")
with open(sf, "w") as f:
    json.dump({"messages": rows}, f)
led2 = O.empty_ledger()
seeded, led2 = O.reconstruct(sf, led2, "test-model", {})
check("reconstruct preserves all native turns", len(seeded) == len(rows), f"got {len(seeded)}")
check("reconstruct preserves oldest turn", seeded[0].get("content") == "recon step 0", str(seeded[0]))
check("reconstruct preserves newest turn", seeded[-1].get("content") == "recon step 23", str(seeded[-1]))
check("reconstruct leaves ledger unchanged", led2 == O.empty_ledger(), str(led2))
check("reconstruct creates no sidecar", not os.path.exists(sf + ".ledger.json"))

# 5) estimate_tokens grows with content; _safe_recent drops a leading orphan tool msg
small = O.estimate_tokens([{"role": "user", "content": "hi"}])
big = O.estimate_tokens([{"role": "user", "content": "word " * 5000}])
check("estimate_tokens grows with size", big > small * 50, f"{small} vs {big}")
sr = O._safe_recent([{"role": "tool", "content": "orphan"}] + [{"role": "user", "content": f"m{i}"} for i in range(20)])
check("_safe_recent drops leading orphan tool msg", sr[0].get("role") != "tool", str(sr[0]))

print(f"\nRESULT: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
