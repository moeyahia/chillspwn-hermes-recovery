# Council Connectivity Audit

Use this procedure when the operator asks how the council is currently configured to connect or
whether a subscription lane could consume API credits.

## Current launcher baseline

Treat `scripts/council_summon.py` as the source of truth. Each member carries an explicit provider;
the launcher does not inherit the global Hermes model provider for these calls.

| Member | Model | Transport and billing boundary |
|---|---|---|
| Claude Opus 4.8 | `claude-opus-4-8` | `claude-cli`; logged-in Claude subscription |
| DeepSeek V4 Pro | `deepseek/deepseek-v4-pro` | direct OpenRouter; API credits |
| Qwen 3.7 Max | `qwen/qwen3.7-max` | direct OpenRouter; API credits |
| GPT-5.5 | `gpt-5.5` | `openai-codex`; OAuth subscription |
| GLM-5.2 | `z-ai/glm-5.2` | direct OpenRouter; API credits |
| Grok 4.3 | `grok-4.20-reasoning` | `xai-oauth`; SuperGrok OAuth subscription |

The Grok member deliberately has no `mode: direct`. It is spawned with `hermes chat --provider
xai-oauth`, which uses Hermes' native xAI OAuth Responses transport and token refresh. It must not
be changed to an `x-ai/...` OpenRouter slug or given `mode: direct`; missing/revoked xAI OAuth must
fail that lane instead of silently spending OpenRouter credits.

## What to inspect

1. In `COUNCIL_MEMBERS`, verify every model/provider/mode tuple, especially Grok's exact
   `xai-oauth` provider and absence of direct mode.
2. In `spawn_agent()`, verify direct mode calls `council_lane_agent.py` and all other members call
   `hermes chat` with the member's explicit provider.
3. Run `hermes auth list` and confirm that `openai-codex` and `xai-oauth` are logged in. Do not print
   or copy token values, auth files, or provider environment values.
4. Confirm only the three intended direct OpenRouter members require `OPENROUTER_API_KEY`.
5. Treat `/opt/chillspwn-bin/ALIASES.md` as an optional local convenience. Native Kali commands
   remain valid when no alias map exists.
6. Confirm `HERMES_PYTHON` (or the current `sys.executable`) is executable for direct lanes and
   `HERMES_CLI` (or the sibling/PATH `hermes`) is executable for OAuth lanes. The launcher validates
   both before spawning and does not assume an interactive shell's `python3`/`hermes` PATH.
7. Confirm `spawn_agent()` and live-mode `speak_hermes()` use `build_lane_environment()`. The lane
   worker must read provider keys from its injected environment only; it must not reopen
   `~/.hermes/.env`.
8. Run `CouncilRoutingTests`. Its sentinel credentials verify that dashboard, Telegram, unrelated
   provider, cloud, GitHub, and SSH-agent secrets do not reach any lane.

For stronger OAuth file separation, provision complete provider-specific Hermes homes and set
`COUNCIL_CODEX_HERMES_HOME` and `COUNCIL_XAI_HERMES_HOME`. Each home must retain the required
configuration, SOUL/skills, and only its provider's authenticated state. If these values are unset,
both OAuth lanes use the existing `HERMES_HOME` for backward compatibility.

## Non-billing dry-run validation

```bash
: "${COUNCIL_SCRIPT:?set the installed council_summon.py path}"
mkdir -p /tmp/council-provider-audit
python3 "$COUNCIL_SCRIPT" \
  --engagement-dir /tmp/council-provider-audit \
  --briefing "provider routing audit only" \
  --dry-run
```

Expected key routes:

```text
Claude Opus 4.8  provider claude-cli, model claude-opus-4-8
GPT-5.5          provider openai-codex, model gpt-5.5
Grok 4.3         provider xai-oauth, model grok-4.20-reasoning
```

The dry run must not show `openrouter` or a `DIRECT` marker for Grok.

## Answering pattern

- Separate current actual launcher behavior from optional recommendations.
- State which lanes use OAuth/subscription versus OpenRouter credits.
- Report authentication as present/missing/revoked without exposing token material.
- If Grok OAuth is unavailable, report the lane as unavailable and provide the re-authentication
  command; do not recommend an automatic paid fallback.

Provider behavior changes over time. Record the durable audit procedure and explicit billing
boundary, not a permanent claim that a provider is broken.
