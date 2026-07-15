#!/usr/bin/env python3
"""Dry-run what happens on RESUME of the cleaned session: load ledger + reconstruct().
With _distilled_upto=1318 there should be ZERO old msgs to distill (no API call) and the
last 16 kept raw. Proves the installed ledger is used and the backlog isn't re-processed."""
import os
import sys

import orchestrator_openrouter as O

SF = os.environ.get("CHILLSPWN_TEST_SESSION_FILE", "").strip()
if not SF or not os.path.isfile(SF):
    print("CHILLSPWN_TEST_SESSION_FILE must name a readable test-session file", file=sys.stderr)
    raise SystemExit(2)

# Instrument distill so we can PROVE it is/ isn't called (no real API call wanted here).
calls = {"n": 0}
_orig = O.distill_into_ledger
def spy(old_text, ledger, model, headers):
    calls["n"] += 1
    print(f"  !! distill_into_ledger CALLED with {len(old_text)} chars (would hit API)")
    return ledger
O.distill_into_ledger = spy

led = O.load_ledger(SF)
print(f"loaded ledger: hosts={len(led.get('hosts',{}))} creds={len(led.get('credentials',[]))} "
      f"vulns={len(led.get('vulns',[]))} tasks_done={len(led.get('tasks_done',[]))} "
      f"key_facts={len(led.get('key_facts',[]))} _distilled_upto={led.get('_distilled_upto')}")
seeded, led2 = O.reconstruct(SF, led, "deepseek/deepseek-v4-pro", {})
print(f"reconstruct -> seeded_raw_msgs={len(seeded)}  distill_calls={calls['n']}  "
      f"_distilled_upto_after={led2.get('_distilled_upto')}")
ok = (calls["n"] == 0 and len(seeded) == O.KEEP_RAW_MSGS and len(led.get("tasks_done", [])) > 0)
print("RESUME BEHAVIOUR:",
      f"OK (full ledger loaded as memory, last {len(seeded)} turns raw, backlog NOT re-distilled)"
      if ok else f"UNEXPECTED (distill_calls={calls['n']} seeded={len(seeded)})")
