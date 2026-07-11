# Council Round 3 Observations — Logging

Session context: HTB Logging council re-summoned after Administrator password-reuse via Kerberos failed (`KDC_ERR_PREAUTH_FAILED`) and several prior Round 1/2 paths were dead.

## Launch outcome

Useful assessments completed:

- GPT-5.5: substantive assessment (~32 KB)
- DeepSeek V4 Pro: substantive assessment (~23 KB)
- Grok 4.3: substantive assessment (~9 KB)
- Gemini 3.1 Pro: initially wrote a tiny placeholder (~47 B), later filled a substantive assessment (~5.7 KB)

Failed/stalled lanes:

- Claude direct Anthropic failed with usage/quota exhaustion. This is not a model quality signal; it is account quota state.
- Claude OpenRouter fallback exited with only a `session_id` in the log and no assessment file.
- Nemotron stalled with empty log/no assessment and was killed after the timeout.

## Operational lessons

1. **Count substantive deliverables, not processes.** A Hermes process can stay alive after writing the assessment; another can exit cleanly without producing one. The assessment file is the deliverable.
2. **Poll compactly.** Avoid `ps -o cmd` for Hermes council processes because the full prompt appears in the command line and can flood context. Use:
   ```bash
   ps -p <pids> -o pid=,stat=,etime=,comm= 2>/dev/null || true
   for f in *_assessment.md; do [ -e "$f" ] && wc -c "$f"; done
   ```
3. **Placeholders can fill later.** A tiny assessment file is not necessarily final while the process is still running. Keep polling until the process exits or size stabilizes after timeout.
4. **Quota failures need fallback plus verification.** If Claude direct Anthropic fails due usage exhaustion, OpenRouter fallback is reasonable, but do not assume it worked; verify a substantive file.
5. **Synthesis can proceed with 4 strong models if remaining lanes are quota/stalled**, but tell Mr. Wong exactly which models completed, failed, and were killed.

## Analysis lessons from the council

The strongest multi-model consensus was not a single exploit but a validation sequence:

1. Use confirmed low-priv DLL execution as a telemetry primitive before dismissing it.
2. Prefer native C DLL with full CRT and `CreateProcessA` for Windows service/DLL hijack contexts.
3. If WSUS SOAP reaches the service but no side effect happens, re-check the deserialization injection point/key, not just the payload command.
4. Validate `Performance Log Users` membership before attempting `logman` SYSTEM escalation.
5. Treat ESC10/UPN swap as conditional and precheck UPN conflicts, own-UPN write rights, ClientAuth EKU, and enrollment rights.
