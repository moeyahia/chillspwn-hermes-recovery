#!/usr/bin/env python3
"""Manual, FULL distillation of a long ChillsPwn session into a complete findings ledger.
Overcomes the engine's one-shot 48k DISTILL_INPUT_CAP by paging through EVERY old message
in chunks and accumulating into one ledger (merge_ledger dedups). Read-only on the session
JSON; writes the result to /tmp/full.ledger.json for review before install.

PART A also reproduces what the CURRENT engine (single 48k-capped call) would capture, so the
gain is measurable. Run from the scripts dir (needs orchestrator_openrouter importable)."""
import json, os, re, sys, time
import orchestrator_openrouter as O

SESS = os.environ.get("CHILLSPWN_TEST_SESSION_FILE", "").strip()
MODEL = "deepseek/deepseek-v4-pro"
KEEP_RAW = O.KEEP_RAW_MSGS        # 16 — kept raw on resume
PER_MSG_CAP = 4000                # chars retained per message when rendering for distillation
CHUNK_CHARS = 40000               # < DISTILL_INPUT_CAP(48000) so no per-chunk truncation
OUT = os.environ.get("CHILLSPWN_TEST_LEDGER_OUTPUT", "").strip()

def read_key():
    return os.environ.get("OPENROUTER_API_KEY", "").strip()

def render_msg(m):
    role = m.get("role", "")
    tn = m.get("toolName")
    c = m.get("content", "")
    if not isinstance(c, str):
        c = json.dumps(c, ensure_ascii=False)
    tag = role + (("/" + tn) if tn else "")
    return f"{tag}: {c[:PER_MSG_CAP]}"

def counts(l):
    return dict(hosts=len(l.get('hosts', {})), creds=len(l.get('credentials', [])),
                vulns=len(l.get('vulns', [])), flags=len(l.get('flags', [])),
                tasks_done=len(l.get('tasks_done', [])), tasks_pending=len(l.get('tasks_pending', [])),
                key_facts=len(l.get('key_facts', [])))

def log(*a):
    print(*a, flush=True)

def main():
    if not SESS or not os.path.isfile(SESS):
        log("CHILLSPWN_TEST_SESSION_FILE must name a readable test-session file")
        sys.exit(2)
    if not OUT or not os.path.isabs(OUT):
        log("CHILLSPWN_TEST_LEDGER_OUTPUT must be an absolute output path")
        sys.exit(2)
    key = read_key()
    if not key:
        log("NO_KEY"); sys.exit(2)
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json",
               "HTTP-Referer": "https://chillspwn.local", "X-Title": "ChillsPwn LedgerClean"}
    data = json.load(open(SESS))
    rows = data.get("messages", [])
    n = len(rows)
    cut = max(0, n - KEEP_RAW)
    old = rows[:cut]                     # everything except the last 16
    log(f"session={os.path.basename(SESS)} total_msgs={n} distill_old={len(old)} keep_raw_last={KEEP_RAW}")

    # ---- PART A: reproduce the engine's CURRENT one-shot (single 48k-capped call) ----
    t0 = time.time()
    old_text_all = "\n".join(render_msg(m) for m in old)
    log(f"\n[A] one-shot: rendered_old_chars={len(old_text_all)} ; engine feeds only first {O.DISTILL_INPUT_CAP}")
    led_one = O.distill_into_ledger(old_text_all, O.empty_ledger(), MODEL, headers)
    log(f"[A] one-shot ledger (what you'd get today): {counts(led_one)}  [{time.time()-t0:.0f}s]")

    # ---- PART B: FULL chunked distillation over ALL old messages ----
    led = O.empty_ledger()
    chunk, clen, done = [], 0, 0
    def flush():
        nonlocal led, chunk, clen, done
        if not chunk:
            return
        txt = "\n".join(chunk)
        t = time.time()
        led = O.distill_into_ledger(txt, led, MODEL, headers)
        done += 1
        log(f"[B] chunk {done:>2} ({len(chunk)} msgs, {clen} chars) -> {counts(led)}  [{time.time()-t:.0f}s]")
        chunk, clen = [], 0
    log(f"\n[B] full chunked distillation (chunk_chars={CHUNK_CHARS}) ...")
    for m in old:
        r = render_msg(m)
        if clen + len(r) > CHUNK_CHARS and chunk:
            flush()
        chunk.append(r); clen += len(r) + 1
    flush()
    led["_distilled_upto"] = cut
    json.dump(led, open(OUT, "w"), indent=2)

    log(f"\n[B] FULL ledger counts: {counts(led)}")
    log(f"[B] _distilled_upto set to {cut} (last {KEEP_RAW} msgs stay raw on resume)")
    log("\n===== ONE-SHOT vs FULL =====")
    log(f"  one-shot: {counts(led_one)}")
    log(f"  full    : {counts(led)}")
    log("\n===== RENDERED FULL LEDGER (what the model will see on resume) =====")
    log(O.render_ledger(led))
    log(f"\nsaved -> {OUT}")
    log("PROCESS_COMPLETE")

if __name__ == "__main__":
    main()
