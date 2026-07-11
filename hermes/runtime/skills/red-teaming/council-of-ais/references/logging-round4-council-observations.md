# Logging Round 4 Council Observations — Anthropic API-Key Verification + Consensus Handling

Session context: HTB Logging, after Round 3 confirmed stable `UpdateMonitor -> PreUpdateCheck()` native DLL execution as `logging\\jaylee.clifton` and live membership in `BUILTIN\\Performance Log Users`.

## Durable council-running lessons

### Verify Claude is really using API-key mode
When the user asks to use an Anthropic API key rather than OAuth for Claude, do not rely on `--provider anthropic` alone. Hermes may still have a stored Anthropic OAuth credential (`claude_code oauth hermes_pkce`) and the Claude lane can fail with an OAuth usage/quota error.

Before launching Claude:

```bash
python3 - <<'PY'
from pathlib import Path
p = Path.home()/'.hermes/.env'
for line in p.read_text(errors='ignore').splitlines():
    if line.startswith(('ANTHROPIC_API_KEY=', 'ANTHROPIC_TOKEN=')):
        k, v = line.split('=', 1)
        print(k, 'non_empty=', bool(v), 'len=', len(v))
PY
hermes auth list anthropic
```

If `ANTHROPIC_API_KEY` is empty, say so immediately and do not claim the Claude lane is API-key-backed. If the key is present, launch Claude with config isolation to avoid stored OAuth/state influencing routing:

```bash
set -a; source ~/.hermes/.env; set +a
hermes chat --ignore-user-config --ignore-rules \
  -q "<briefing>" \
  --model claude-opus-4-7 \
  --provider anthropic \
  -t file,terminal \
  --yolo -Q
```

If this still reports `You're out of extra usage`, the active credential path is not the intended paid API key; report the credential problem and proceed only with the non-Claude assessments unless the user supplies/fixes the key.

### Count only substantive assessment files
Validate council output by file size/content, not by process exit or a final self-report. Good quick check:

```bash
for f in council*/*_assessment.md; do [ -e "$f" ] && wc -c "$f"; done | sort
```

A lane that exits cleanly but leaves no substantive Markdown should not be counted.

## Round 4 strategic consensus from returned models
Five returned models independently converged on:

1. **Primary:** deploy a native C `PreUpdateCheck()` DLL as Jaylee to test `Performance Log Users -> logman/Data Collector Set -> SYSTEM` with a benign `whoami` proof file under `C:\\ProgramData\\UpdateMonitor\\Logs`.
2. **Secondary:** use the same DLL cycle to verify ForceSync liveness and `C:\\ProgramData\\UpdateMonitor\\hunt_jaylee.ps1` existence/ACL/hash before any script hijack.
3. **Deprioritize:** Administrator password reuse, ServerAuth EKU Schannel, blind ESC10/UPN swap, current WSUS gadget placements, and TaskCache RemoteRegistry extraction.

Recommended council synthesis shape for this class of engagement:

```text
- State which models returned and which failed, with credential/provider reason if relevant.
- Separate credential/tooling failure from strategic consensus.
- Rank only paths that satisfy current hard constraints and exclude known dead ends.
- Recommend the next smallest live proof, not a destructive end-state payload.
```
