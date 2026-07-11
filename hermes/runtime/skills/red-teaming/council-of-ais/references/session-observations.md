# Council of AIs — Session Observations (May 26, 2026)

## First Run (via council_summon.py)
- **Grok 4.3**: Delivered in 1m 45s. 6.4 KB. Concise. BUT made factual errors: wrong IP (stale nmap), wrong RBCD target (msa_health$ not DC01$).
- **GPT-5.5**: Delivered in ~5 min. 19.5 KB. Most thorough assessment. Correctly identified toby Schannel path. Included working Python scripts.
- **Gemini 3.1 Pro**: Delivered in ~6 min. 4.2 KB. Adequate but vague — no concrete commands, misunderstood WSUS mechanics.
- **Claude Opus 4.7**: FAILED — 502 Bad Gateway via OpenRouter. Process went zombie.
- **DeepSeek V4 Pro**: STUCK — 37+ API calls, 88K input tokens per call, tool loop reading files endlessly without writing assessment.
- **Nemotron 3 Super**: STUCK — 29+ API calls, 45K input tokens, same loop pattern.

## Relaunch (individual hermes chat with tighter prompts)
After killing stuck processes and relaunching with explicit anti-loop instruction:
- **DeepSeek V4 Pro**: Delivered in ~8 min. 6.5 KB. Found the toby.brynleigh = Domain Admin insight from BloodHound data. Best unique finding.
- **Nemotron 3 Super**: Delivered in ~4 min. 5.4 KB. Mostly validated CLEAN_RUN.md without novel insights.
- **Claude Opus 4.7** (via `--provider anthropic` direct): Delivered in ~5 min. 12 KB. Cross-referenced other assessments, caught Grok's RBCD error and IP error. Most critical peer review.

## Consensus Analysis
- **5/6 agreed on Schannel LDAPS** as #1 path → turned out to be WRONG on live target (Server Auth EKU doesn't map)
- **4/6 agreed on WSUS** as backup → turned out WSUS exploit doesn't fire (proof file not created)
- **1/6 (Grok) had RBCD** → debunked by Claude Opus (wrong target object)

## Key Takeaways
1. **Council analysis is theoretical** — models read files and reason but don't test against live targets. A 5/6 consensus can still be wrong.
2. **GPT-5.5 produces the most actionable output** — thorough, includes working code, verifies claims against actual file contents.
3. **Claude Opus is the best peer reviewer** — catches errors in other models' reasoning, identifies contradictions.
4. **Grok is fastest but least accurate** — speed comes at the cost of factual verification.
5. **DeepSeek finds unique angles** — identified the toby/Domain Admin connection from BloodHound data that others missed.
6. **Nemotron adds little unique value** — mostly re-summarizes existing documentation without novel analysis.
7. **Always verify council recommendations** on the live target before committing hours to a path.

## Round 2 — Re-summoning After Failure (same session)

After both Round 1 paths failed on the live target, council was re-summoned with exact failure errors in the briefing. Round 1 assessments preserved as `*_v1.md` for models to read and avoid repeating.

### Launch Method
Used `execute_code` with `subprocess.Popen` instead of `council_summon.py` — faster, no monitoring overhead, all 6 launched in ~0.25s.

### Results
- All 6 models launched cleanly
- 5/6 delivered within ~10 min (Grok fastest again at ~3 min)
- Nemotron slowest (~8 min running, still pending at status check)
- No failures, no loops — tighter prompts from Round 1 experience applied to all models

### Key Insight
Round 2 briefing quality matters enormously. Including **exact error messages** (not just "it failed") and the explicit "DEAD ENDS" catalog forced models to think beyond their Round 1 answers. The Round 2 assessments were notably more creative and explored paths the Round 1 models overlooked.

### Execution Dispatch Failure
After Round 1 synthesis, tried to dispatch DeepSeek as an operator via `delegate_task` — failed with `gpt-4.1 model not supported`. Launched via `hermes chat` directly instead. DeepSeek as operator went off-script within minutes — started exploring certreq DLLs (a known dead end) instead of sticking to the Schannel LDAPS path. **Council models are better as analysts than operators** — they theorize well but lack the discipline to follow a plan step-by-step.

## Token Burn Data
- DeepSeek first run (stuck): ~37 API calls × 88K input = ~3.2M input tokens wasted
- Nemotron first run (stuck): ~29 API calls × 45K input = ~1.3M input tokens wasted
- Successful relaunch: 7-12 API calls each, much more efficient
- Total council cost (both runs): estimated ~$15-25 in API credits
