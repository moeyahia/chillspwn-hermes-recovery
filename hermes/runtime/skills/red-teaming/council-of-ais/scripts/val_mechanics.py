#!/usr/bin/env python3
"""Offline validation of the ChillsPwn memory engine mechanics (no API calls).
Run from the scripts dir so `orchestrator_openrouter` + `conversation_recall` import.
Exercises: ledger merge/render/dedup, DSML tool-call parsing, conversation recall,
and reconstruct() distillation slicing (distill stubbed). Prints PASS/FAIL per check."""
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
    "hosts": {"10.10.10.5": {"ports": ["22/ssh", "80/http"], "os": "Ubuntu", "hostname": "soulmate"}},
    "credentials": [{"user": "bob", "secret": "Hunter2", "service": "ssh", "validated": True}],
    "vulns": [{"host": "10.10.10.5", "name": "CVE-2025-31161", "detail": "CrushFTP auth bypass", "exploited": True}],
    "flags": [{"type": "user", "value": "abc123", "host": "10.10.10.5"}],
    "tasks_done": ["nmap full scan", "enumerated ftp vhost"],
    "tasks_pending": ["privesc to root"],
    "key_facts": ["real entry is ftp.<host> vhost"],
})
# merge again with an overlapping + a new port -> must dedup and union ports
led = O.merge_ledger(led, {
    "hosts": {"10.10.10.5": {"ports": ["80/http", "2222/ssh"]}},
    "tasks_done": ["nmap full scan"],          # duplicate -> must NOT double
    "credentials": [{"user": "bob", "secret": "Hunter2", "service": "ssh"}],  # dup by user
})
ports = sorted(led["hosts"]["10.10.10.5"]["ports"])
check("ledger.hosts ports unioned+deduped", ports == ["22/ssh", "2222/ssh", "80/http"], str(ports))
check("ledger.tasks_done deduped", led["tasks_done"].count("nmap full scan") == 1, str(led["tasks_done"]))
check("ledger.credentials deduped by user", len(led["credentials"]) == 1, str(led["credentials"]))
rendered = O.render_ledger(led)
check("render shows host", "10.10.10.5" in rendered)
check("render shows EXPLOITED vuln", "EXPLOITED" in rendered and "CVE-2025-31161" in rendered)
check("render shows 'do NOT repeat' tasks", "do NOT repeat" in rendered and "nmap full scan" in rendered)
check("render shows flag", "abc123" in rendered)

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
CR.append(d, {"role": "user", "content": "start recon on soulmate.htb"})
CR.append(d, {"role": "tool", "toolName": "terminal", "content": "found SSH password for bob is CANARY_TOKEN_7788"})
CR.append(d, {"role": "assistant", "content": "noted the creds, moving on to privesc"})
for i in range(5):
    CR.append(d, {"role": "user", "content": f"unrelated chatter line {i}"})
recalled = CR.recall(d, "bob ssh password", 4000)
check("recall finds the canary by keyword", "CANARY_TOKEN_7788" in recalled, recalled[:200])
recent = CR.get_recent(d, 3)
check("get_recent returns last records", "chatter line 4" in recent, recent[:200])
empty = CR.recall(tempfile.mkdtemp(prefix="valempty_"), "x", 1000)
check("recall on empty log is safe", "empty" in empty.lower(), empty)

# 4) reconstruct(): distill everything older than KEEP_RAW_MSGS, keep recent raw
rows = []
for i in range(24):
    rows.append({"role": "user" if i % 2 == 0 else "assistant", "content": f"recon step {i}"})
sf = os.path.join(d, "sess.json")
with open(sf, "w") as f:
    json.dump({"messages": rows}, f)
captured = {}
def fake_distill(old_text, ledger, model, headers):
    captured["old_text"] = old_text
    ledger["key_facts"] = list(ledger.get("key_facts", [])) + ["distilled_marker"]
    return ledger
O.distill_into_ledger = fake_distill           # stub the LLM call
led2 = O.empty_ledger()
seeded, led2 = O.reconstruct(sf, led2, "test-model", {})
check("reconstruct keeps KEEP_RAW_MSGS recent", len(seeded) == O.KEEP_RAW_MSGS, f"got {len(seeded)}")
check("reconstruct distilled the older turns", "recon step 0" in captured.get("old_text", ""), "")
check("reconstruct did NOT distill recent turns", "recon step 23" not in captured.get("old_text", ""), "")
check("_distilled_upto advanced", led2.get("_distilled_upto") == 24 - O.KEEP_RAW_MSGS, str(led2.get("_distilled_upto")))
check("ledger persisted to .ledger.json", os.path.exists(sf + ".ledger.json"))
check("distill marker merged into ledger", "distilled_marker" in led2.get("key_facts", []), str(led2.get("key_facts")))

# 5) estimate_tokens grows with content; _safe_recent drops a leading orphan tool msg
small = O.estimate_tokens([{"role": "user", "content": "hi"}])
big = O.estimate_tokens([{"role": "user", "content": "word " * 5000}])
check("estimate_tokens grows with size", big > small * 50, f"{small} vs {big}")
sr = O._safe_recent([{"role": "tool", "content": "orphan"}] + [{"role": "user", "content": f"m{i}"} for i in range(20)])
check("_safe_recent drops leading orphan tool msg", sr[0].get("role") != "tool", str(sr[0]))

print(f"\nRESULT: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
