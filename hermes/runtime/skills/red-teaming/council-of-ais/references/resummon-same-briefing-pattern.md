# Resummon Same-Briefing Pattern

When the user says "resummon the council with the same info" (or similar), treat it as an instruction to re-use the latest existing briefing for the active engagement rather than asking for a new target.

## Pattern

1. Identify the likely engagement directory from current context or recent box state, e.g. `/root/htb/boxes/<box>/council/`.
2. Re-use the newest substantive briefing file, preferring numbered round files such as `briefing_r4.txt` over older `briefing.txt`.
3. Before launching duplicate lanes, check whether a council is already running for that same briefing/output directory.
   - Look for `hermes chat` processes whose args include the engagement `council/` path and current assessment filenames.
   - Check assessment file sizes; count only substantive files, not empty placeholders.
4. If lanes are already running, report that the council is active and start/confirm a lightweight monitor rather than spawning duplicates.
5. If lanes are not running, launch all lanes with the exact same briefing and fresh output names, preserving prior assessment files with `_vN` suffixes when appropriate.
6. Use compact polling output: PID/status/elapsed/model/provider and assessment byte counts. Avoid full `ps -o cmd` dumps because council prompts are huge and flood context.

## Example monitor behavior

- Expected output files: `claude_opus_assessment.md`, `gpt55_assessment.md`, `grok_assessment.md`, `deepseek_v4_assessment.md`, `glm_assessment.md`, `qwen_assessment.md`.
- Treat an assessment as useful only when it exceeds a substantive threshold (for example >1500 bytes) and contains Markdown content.
- Use a background monitor with notify-on-complete for long council runs; do not keep the main turn blocked unless the user asked to wait for synthesis.

## Why this matters

Council prompts can be expensive and long-running. Duplicate resummons waste tokens and can confuse synthesis by mixing output from multiple concurrent runs. The safe default is: reuse latest briefing, detect active lanes, then monitor or relaunch only missing/stale lanes.