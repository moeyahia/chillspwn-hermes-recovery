# Council Timeout Troubleshooting

Use this when a council appears to have terminated earlier than expected.

## Source of truth

Do **not** rely only on the current `council_summon.py` default. A specific run may have been launched with an explicit older override.

Check the engagement run log first:

```bash
python3 - <<'PY'
import os
from pathlib import Path
c = Path(os.environ['ENGAGEMENT_DIR']) / 'council'
for p in sorted(c.glob('runner*.log')):
    print('\n==', p, '==')
    for line in p.read_text(errors='ignore').splitlines():
        if 'Timeout:' in line or 'COUNCIL TIMEOUT' in line or 'Total time:' in line or 'Terminating' in line:
            print(line)
PY
```

If the log says `Timeout: 600s`, the council was explicitly launched with a 10-minute cap even if the script default is now `1800s`.

## What to inspect

- `<engagement_dir>/council/runner*.log` — actual timeout value, completion count, termination messages.
- `<engagement_dir>/council/*_assessment.md` — count only substantive files; zero-byte or missing files are failures.
- `<engagement_dir>/council/*_log*.txt` — look for `KeyboardInterrupt` after termination; that usually means the wrapper sent SIGINT/SIGTERM at timeout, not that the model voluntarily failed.
- `ps -p <pid> -o pid,stat,etime,comm --no-headers` — compact process status if lanes are still running.

## Durable fix

- Use `--timeout 1800` or higher for council runs with reasoning-heavy lanes such as GLM/DeepSeek/Qwen.
- Update stale commands/templates that still include `--timeout 600`.
- When building direct launchers, use `time.monotonic()` for elapsed time and a substantive byte threshold (e.g. `>1500`) for completed assessment files.
- Preserve completed lanes and relaunch only missing/zero-byte lanes with a tighter anti-loop prompt.
