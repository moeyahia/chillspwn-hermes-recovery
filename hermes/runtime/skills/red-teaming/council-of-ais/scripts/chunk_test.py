#!/usr/bin/env python3
"""Unit test for distill_texts_chunked (no API). Run from scripts dir."""
import orchestrator_openrouter as O
P = F = 0
def check(n, c, d=""):
    global P, F
    if c: P += 1; print("PASS", n)
    else: F += 1; print("FAIL", n, d)

# stub the per-call distiller to COUNT calls and accumulate a marker (no network)
calls = {"n": 0}
def stub(text, ledger, model, headers):
    calls["n"] += 1
    ledger.setdefault("key_facts", []).append("c%d" % calls["n"])
    return ledger
O.distill_into_ledger = stub

# 1) under cap: 30 texts x 5000 chars -> all distilled, multiple chunks, nothing dropped
calls["n"] = 0
texts = ["x" * 5000 for _ in range(30)]
led, done = O.distill_texts_chunked(texts, O.empty_ledger(), "m", {})
check("under-cap: all rows distilled", done == 30, "done=%d" % done)
check("under-cap: chunked (>1 call)", calls["n"] >= 4, "calls=%d" % calls["n"])
check("under-cap: not capped", calls["n"] < O.DISTILL_MAX_CHUNKS_PER_RUN, "calls=%d" % calls["n"])

# 2) over cap: 20 texts each bigger than a chunk -> exactly cap calls, remainder deferred
calls["n"] = 0
big = ["y" * (O.DISTILL_CHUNK_CHARS + 1) for _ in range(20)]
led2, done2 = O.distill_texts_chunked(big, O.empty_ledger(), "m", {})
check("over-cap: stops at cap", calls["n"] == O.DISTILL_MAX_CHUNKS_PER_RUN, "calls=%d" % calls["n"])
check("over-cap: done == cap (rest deferred, not lost)", done2 == O.DISTILL_MAX_CHUNKS_PER_RUN, "done=%d" % done2)
check("over-cap: deferred remainder > 0", (20 - done2) > 0, "deferred=%d" % (20 - done2))

# 3) empty input is safe
calls["n"] = 0
led3, done3 = O.distill_texts_chunked([], O.empty_ledger(), "m", {})
check("empty input: no calls, done 0", calls["n"] == 0 and done3 == 0)

print("\nRESULT: %d passed, %d failed" % (P, F))
import sys; sys.exit(1 if F else 0)
