# Provider-aware Council routing

The Council launcher is the routing, billing, and credential-isolation boundary. Do not reproduce
its subprocess commands in a prompt, shell loop, or `execute_code` block.

## Current routing

| Lane | Provider | Model | Billing route |
|---|---|---|---|
| Claude Opus | `claude-cli` | `claude-opus-4-8` | logged-in Claude subscription |
| DeepSeek | `openrouter` | `deepseek/deepseek-v4-pro` | OpenRouter API credits |
| Qwen | `openrouter` | `qwen/qwen3.7-max` | OpenRouter API credits |
| GPT | `openai-codex` | `gpt-5.5` | Codex OAuth subscription |
| GLM | `openrouter` | `z-ai/glm-5.2` | OpenRouter API credits |
| Grok | `xai-oauth` | `grok-4.20-reasoning` | xAI OAuth subscription |

Grok deliberately has no direct mode or OpenRouter fallback. Claude deliberately receives no
Anthropic API-key variables.

## Child-environment contract

`build_lane_environment()` starts with a small runtime allowlist, then adds only the selected
provider's credential or auth path:

- OpenRouter: `OPENROUTER_API_KEY`; direct web tools may also receive
  `FIRECRAWL_API_KEY`/`FIRECRAWL_API_URL`.
- Claude CLI: `CLAUDE_CONFIG_DIR`, optional `CLAUDE_CODE_OAUTH_TOKEN`, and the
  `COUNCIL_CLAUDE_*` runtime settings. `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and
  `ANTHROPIC_TOKEN` are excluded.
- Codex OAuth: `HERMES_HOME` and `CODEX_HOME`. Set `COUNCIL_CODEX_HERMES_HOME` to map a
  separately provisioned Hermes profile into the lane as `HERMES_HOME`.
- xAI OAuth: `HERMES_HOME`. Set `COUNCIL_XAI_HERMES_HOME` to map a separately provisioned Hermes
  profile into the lane as `HERMES_HOME`.

The optional provider-specific Hermes homes must contain the required non-secret configuration,
SOUL/skills, and that provider's authenticated `auth.json`; merely creating empty directories will
break the lanes. Existing installations can continue to use the shared `HERMES_HOME` fallback.

The memory guard/socket settings are propagated so native Hermes memory remains mediated.
`DASHBOARD_TOKEN`, Telegram credentials, unrelated inference keys, cloud/GitHub secrets, and
`SSH_AUTH_SOCK` are never copied into a lane. Telegram settings remain in the Council parent only.
Both independent and live OAuth subprocesses use this same builder. The Claude CLI applies the
allowlist again as defense in depth, and the standalone lane worker never reopens
`~/.hermes/.env`.

## Verification

Inspect `COUNCIL_MEMBERS`, `build_agent_command()`, `build_lane_environment()`, and
`spawn_agent()` in `scripts/council_summon.py`, then run a non-billing dry run:

```bash
: "${COUNCIL_SCRIPT:?set the installed council_summon.py path}"
: "${ENGAGEMENT_DIR:?set an authorized engagement directory}"
python3 "$COUNCIL_SCRIPT" \
  --engagement-dir "$ENGAGEMENT_DIR" \
  --briefing "provider routing audit only" \
  --dry-run
```

Verify OAuth status without reading or printing token files:

```bash
hermes auth list
```

Run the focused regression class after any launcher change:

```bash
python3 -m unittest \
  hermes.runtime.tests.test_chillspwn_learning_pipeline.CouncilRoutingTests -v
```

The sentinel tests assert that every lane excludes dashboard, Telegram, unrelated provider,
cloud, GitHub, and SSH-agent secrets.
