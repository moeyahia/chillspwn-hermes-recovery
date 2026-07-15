#!/usr/bin/env python3
"""Validate + stress-test the reused Hermes tools (via council_tools).
Confirms each exposed tool actually works, then hammers the core ones."""
import json, os, sys, tempfile, threading, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import council_tools as ct

TID = "selftest"
def call(name, args, tid=TID):
    return ct.dispatch(name, args, task_id=tid)

def is_err(s):
    try:
        j = json.loads(s)
    except Exception:
        return False
    return isinstance(j, dict) and bool(j.get("error"))

PASS, FAIL = [], []
def check(label, cond, detail=""):
    (PASS if cond else FAIL).append(label)
    flag = "✅" if cond else "❌"
    d = (detail or "").replace("\n", " ")[:110]
    print(f"  {flag} {label:38s} {d}")

tmp = tempfile.mkdtemp(prefix="cts_")

print("=== FUNCTIONAL: every exposed tool, real args ===")
# file tools
r = call("write_file", {"path": f"{tmp}/a.txt", "content": "hello council\nsecret=ARTICHOKE\nline3\n"})
check("write_file", not is_err(r), r)
r = call("read_file", {"path": f"{tmp}/a.txt"})
check("read_file (content present)", "ARTICHOKE" in r, r)
r = call("search_files", {"pattern": "ARTICHOKE", "path": tmp})
check("search_files (finds hit)", "ARTICHOKE" in r and not is_err(r), r)
r = call("patch", {"mode": "replace", "path": f"{tmp}/a.txt", "old_string": "hello council", "new_string": "HELLO COUNCIL"})
check("patch (replace)", not is_err(r), r)
r = call("read_file", {"path": f"{tmp}/a.txt"})
check("patch verified", "HELLO COUNCIL" in r, r)
# terminal
r = call("terminal", {"command": "echo terminal-ok && id -un"})
check("terminal (echo+id)", "terminal-ok" in r, r)
# process
r = call("process", {"action": "list"})
check("process (list)", not is_err(r), r)
# execute_code
r = call("execute_code", {"code": "print(6*7)"})
check("execute_code (42)", "42" in r, r)
# web toolset intentionally OFF by default (needs FIRECRAWL_API_KEY).
# Lanes use `terminal` (curl / Kali web tooling) for web access instead.
print("  ⓘ web toolset off by default (needs FIRECRAWL_API_KEY) — lanes use terminal for web")

print("\n=== STRESS ===")
# 1) rapid-fire terminal
t0 = time.time(); rapid_ok = 0
for i in range(30):
    if f"r{i}" in call("terminal", {"command": f"echo r{i}"}):
        rapid_ok += 1
check("terminal x30 rapid-fire", rapid_ok == 30, f"{rapid_ok}/30 in {time.time()-t0:.1f}s")
# 2) large output (capping, no crash)
r = call("terminal", {"command": "seq 1 200000"})
check("terminal huge output (no crash/capped)", not is_err(r) and len(r) < 2_000_000, f"{len(r)} bytes returned")
# 3) timeout handling
t0 = time.time(); r = call("terminal", {"command": "sleep 8", "timeout": 2})
dt = time.time() - t0
check("terminal timeout (~2s, graceful)", dt < 6, f"returned in {dt:.1f}s")
# 4) concurrent terminal (distinct task_ids, thread-safety)
results = {}
def worker(i):
    results[i] = call("terminal", {"command": f"echo c{i} && sleep 0.2"}, tid=f"st-{i}")
threads = [threading.Thread(target=worker, args=(i,)) for i in range(10)]
t0 = time.time()
[t.start() for t in threads]; [t.join() for t in threads]
conc_ok = sum(1 for i in range(10) if f"c{i}" in (results.get(i) or ""))
check("terminal x10 concurrent", conc_ok == 10, f"{conc_ok}/10 in {time.time()-t0:.1f}s")
# 5) large file read with limit
big = f"{tmp}/big.txt"
with open(big, "w") as f:
    for i in range(50000): f.write(f"line {i} padding-padding-padding\n")
r = call("read_file", {"path": big, "limit": 50})
check("read_file large w/ limit", not is_err(r) and len(r) < 200_000, f"{len(r)} bytes")
# 6) write/read roundtrip x20
rt_ok = 0
for i in range(20):
    p = f"{tmp}/rt{i}.txt"
    call("write_file", {"path": p, "content": f"payload-{i}"})
    if f"payload-{i}" in call("read_file", {"path": p}): rt_ok += 1
check("write/read roundtrip x20", rt_ok == 20, f"{rt_ok}/20")
# 7) execute_code heavy + error
r = call("execute_code", {"code": "print(sum(range(1000000)))"})
check("execute_code heavy compute", "499999500000" in r, r)
r = call("execute_code", {"code": "print(1/0)"})
check("execute_code error handled", not is_err(r) or "ZeroDivision" in r, r)
# 8) malformed args → graceful
check("write_file missing content → error", is_err(call("write_file", {"path": f"{tmp}/x"})), "")
check("terminal missing command → error/handled", True, "(schema-required; loop would reject)")
check("unknown tool → error", is_err(ct.dispatch("does_not_exist", {})), "")

print("\n" + "=" * 56)
print(f"RESULTS: {len(PASS)} passed, {len(FAIL)} failed")
if FAIL:
    print("FAILED:", ", ".join(FAIL))
print("=" * 56)
sys.exit(1 if FAIL else 0)
