#!/usr/bin/env python3
"""LIVE validation of the ChillsPwn memory engine against a real Deepseek model.
Proves end-to-end: distillation (old turns -> ledger via real LLM), compaction
(token budget exceeded -> 🗜 distill+drop), recall_conversation, and ledger-awareness
(model reads injected state instead of re-running work). Bounded + cheap.

Run on the server from the scripts dir. Reads OPENROUTER_API_KEY from /root/.hermes/.env."""
import json, os, re, subprocess, sys, shutil

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
ORCH = os.path.join(SCRIPTS, "orchestrator_openrouter.py")
MODEL = "deepseek/deepseek-v4-pro"
WORK = "/tmp/val_live"

def read_key():
    for path in ("/root/.hermes/.env", "/root/.zshenv"):
        try:
            for line in open(path):
                m = re.search(r'OPENROUTER_API_KEY\s*=\s*["\']?([A-Za-z0-9._\-]+)', line)
                if m:
                    return m.group(1)
        except Exception:
            pass
    return ""

def main():
    key = read_key()
    if not key:
        print("NO_KEY: could not read OPENROUTER_API_KEY"); sys.exit(2)
    if os.path.isdir(WORK):
        shutil.rmtree(WORK)
    os.makedirs(WORK)

    # --- seed session: oldest 8 carry the FINDINGS (get distilled), recent 16 are bulky filler
    findings = [
        {"role": "user", "content": "kick off recon on the target"},
        {"role": "assistant", "content": "nmap shows 10.10.10.50 has 22/ssh and 80/http (Apache 2.4.49)"},
        {"role": "user", "content": "check the web app"},
        {"role": "assistant", "content": "found working credentials admin:S3cr3tPass on the /login page"},
        {"role": "user", "content": "any known CVEs?"},
        {"role": "assistant", "content": "10.10.10.50 Apache 2.4.49 is vulnerable to CVE-2021-41773 path traversal"},
        {"role": "user", "content": "good, log that"},
        {"role": "assistant", "content": "recorded host, creds, and the CVE. proceeding."},
    ]
    filler = []
    for i in range(16):
        role = "user" if i % 2 == 0 else "assistant"
        filler.append({"role": role,
                       "content": f"step {i}: " + ("detailed intermediate enumeration notes; " * 40)})
    rows = findings + filler
    sf = os.path.join(WORK, "seed_session.json")
    with open(sf, "w") as f:
        json.dump({"messages": rows}, f)

    # --- pre-seed conversation.mcp with a recallable canary (cwd == engagement dir)
    import conversation_recall as CR
    CR.append(WORK, {"role": "assistant", "content": "earlier note: the root flag hint is /root/proof_CANARY9911.txt"})
    CR.append(WORK, {"role": "user", "content": "ok continue"})

    soul = os.path.join(WORK, "soul.txt")
    with open(soul, "w") as f:
        f.write("You are ChillsPwn, a concise pentest agent. You have a terminal tool and a "
                "recall_conversation tool. Use recall_conversation to retrieve earlier notes. "
                "Trust the CURRENT ENGAGEMENT STATE block — do NOT re-run work already recorded there.")

    prompt = ("1) Use recall_conversation to find the root flag location hint. "
              "2) Use the terminal tool to run: echo VALIDATION_RUN && uname -a . "
              "3) In one line, state the host IP, the credentials, and the CVE we already know "
              "from the engagement state (do not re-scan).")

    env = dict(os.environ)
    env["OPENROUTER_API_KEY"] = key
    env["CHILLSPWN_OR_CONTEXT_WINDOW"] = "8000"   # budget = 4800 -> forces compaction after a tool round
    env["CHILLSPWN_OR_MAX_ITERS"] = "5"

    cmd = ["python3", ORCH, "--model", MODEL, "--prompt", prompt,
           "--system-file", soul, "--session-file", sf, "--cwd", WORK]
    print(f">>> running orchestrator ({MODEL}, window=8000, max_iters=5) ...\n")
    try:
        proc = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=420)
    except subprocess.TimeoutExpired as e:
        print("TIMEOUT after 420s"); print((e.stdout or "")[-2000:]); sys.exit(3)

    raw = proc.stdout
    open(os.path.join(WORK, "stream.jsonl"), "w").write(raw)
    events = []
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("{"):
            try: events.append(json.loads(line))
            except Exception: pass

    # ---- analyze the event stream ----
    compaction = []
    recall_used = recall_hit = False
    terminal_used = False
    final_texts = []
    for ev in events:
        if ev.get("type") == "assistant":
            for blk in (ev.get("message", {}).get("content") or []):
                if blk.get("type") == "text":
                    t = blk.get("text", "")
                    if "compacted" in t.lower() or "🗜" in t:
                        compaction.append(t)
                    final_texts.append(t)
                if blk.get("type") == "tool_use":
                    if blk.get("name") == "recall_conversation":
                        recall_used = True
                    if blk.get("name") == "terminal":
                        terminal_used = True
        if ev.get("type") == "user":
            for blk in (ev.get("message", {}).get("content") or []):
                if blk.get("type") == "tool_result" and "CANARY9911" in str(blk.get("content", "")):
                    recall_hit = True
    result_ev = next((e for e in events if e.get("type") == "result"), {})

    # ---- inspect the ledger the engine produced ----
    led = {}
    try:
        led = json.load(open(sf + ".ledger.json"))
    except Exception:
        pass
    led_str = json.dumps(led).lower()
    has_host = "10.10.10.50" in led_str
    has_cred = "s3cr3tpass" in led_str or "admin" in led_str
    has_cve = "41773" in led_str
    final_blob = " ".join(final_texts).lower()
    aware = ("10.10.10.50" in final_blob) and ("41773" in final_blob or "cve" in final_blob)

    print("\n================ LIVE VALIDATION RESULTS ================")
    def line(name, ok, extra=""):
        print(f"[{'PASS' if ok else 'FAIL'}] {name}  {extra}")
    line("orchestrator exited cleanly", proc.returncode == 0, f"(rc={proc.returncode})")
    line("DISTILLATION populated ledger with host", has_host)
    line("DISTILLATION populated ledger with creds", has_cred)
    line("DISTILLATION populated ledger with CVE", has_cve)
    line("COMPACTION fired (🗜 event)", len(compaction) > 0, f"({len(compaction)} event(s))")
    line("RECALL tool invoked by model", recall_used)
    line("RECALL returned the canary (CANARY9911)", recall_hit)
    line("TERMINAL tool invoked by model", terminal_used)
    line("LEDGER-AWARENESS: model cited known host+CVE w/o rescan", aware)
    print(f"end_reason = {result_ev.get('end_reason')!r}   usage = {result_ev.get('usage')}")
    print(f"\nledger.json keys populated: hosts={bool(led.get('hosts'))} creds={len(led.get('credentials',[]))} "
          f"vulns={len(led.get('vulns',[]))} tasks_done={len(led.get('tasks_done',[]))} "
          f"key_facts={len(led.get('key_facts',[]))}")
    if proc.stderr.strip():
        print("\n--- orchestrator stderr (tail) ---")
        print(proc.stderr.strip()[-1200:])
    print("\n--- rendered ledger (what the model sees) ---")
    try:
        import orchestrator_openrouter as O
        print(O.render_ledger(led))
    except Exception as e:
        print("(render failed)", e)
    print(f"\n(raw stream saved to {WORK}/stream.jsonl, {len(events)} events)")

if __name__ == "__main__":
    main()
