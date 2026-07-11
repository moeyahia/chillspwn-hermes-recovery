# Provider-aware Council routing (May 2026)

Session learning: the council launcher should not blindly route every model through OpenRouter. Mr. Wong explicitly prefers direct/OAuth lanes when Hermes has working credentials.

## Current preferred routing

- `claude_opus`: `--provider anthropic --model claude-opus-4-7`
  - Auth: `ANTHROPIC_API_KEY` / Anthropic provider credentials.
  - Rationale: Claude Opus has historically 502'd through OpenRouter.
- `gpt55`: `--provider openai-codex --model gpt-5.5`
  - Auth: OpenAI Codex OAuth (`hermes login --provider openai-codex`).
- `grok`: `--provider xai-oauth --model grok-4.20-reasoning`
  - Auth: xAI OAuth credentials in `~/.hermes/auth.json`.
- `deepseek_v4`: `--provider openrouter --model deepseek/deepseek-v4-pro`
- `nemotron`: `--provider openrouter --model nvidia/nemotron-3-super-120b-a12b:free`
- `glm`: `--provider openrouter --model z-ai/glm-5.1`

## Implementation pattern

Each `COUNCIL_MEMBERS` entry in `scripts/council_summon.py` should carry both:

```python
{
    "id": "gpt55",
    "display_name": "GPT-5.5",
    "model": "gpt-5.5",
    "provider": "openai-codex",
    "emoji": "⚪",
}
```

The launcher should use:

```python
"--model", member["model"],
"--provider", member.get("provider", "openrouter"),
```

Do not hard-code `--provider openrouter` inside `spawn_agent()`.

## Verification pattern

After editing the launcher, run a dry run and inspect emitted commands:

```bash
python3 /root/.hermes/skills/red-teaming/council-of-ais/scripts/council_summon.py \
  --engagement-dir /tmp/council-dryrun \
  --briefing "dry run provider verification" \
  --dry-run
```

Expected key lines:

```text
Claude Opus 4.7: --model claude-opus-4-7 --provider anthropic
GPT-5.5:         --model gpt-5.5 --provider openai-codex
Grok 4.3:        --model grok-4.20-reasoning --provider xai-oauth
```

Also verify auth status without printing secrets:

```bash
hermes auth list
```

Look for `anthropic`, `openai-codex`, `xai-oauth`, and `openrouter` credentials.
