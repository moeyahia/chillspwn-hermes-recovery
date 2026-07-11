# Council Connectivity Audit Pattern

Use this when the user asks how the council is currently configured to connect.

## What to inspect

1. Main launcher script:
   - `/root/.hermes/skills/red-teaming/council-of-ais/scripts/council_summon.py`
   - Specifically inspect `COUNCIL_MEMBERS` and `spawn_agent()`.

2. Hermes config:
   - `/root/.hermes/config.yaml`
   - Check global `model:` and `delegation:` separately from council launcher overrides.

3. Environment presence, without printing secret values:
   - `/root/.hermes/.env`
   - Confirm presence/absence of `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `ANTHROPIC_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USERS`, etc.

## Observed baseline from May 2026

The `council_summon.py` script's first-pass launcher currently routes all six members through OpenRouter:

```python
cmd = [
    "hermes", "chat",
    "-q", prompt,
    "--model", member["model"],
    "--provider", "openrouter",
    "-t", "file,terminal",
    "--yolo",
    "-Q",
]
```

The configured member model IDs were:

- Claude Opus 4.7: `anthropic/claude-opus-4.7` via OpenRouter
- DeepSeek V4 Pro: `deepseek/deepseek-v4-pro` via OpenRouter
- Nemotron 3 Super: `nvidia/nemotron-3-super-120b-a12b:free` via OpenRouter
- GPT-5.5: `openai/gpt-5.5` via OpenRouter
- Gemini 3.1 Pro: `google/gemini-3.1-pro-preview` via OpenRouter
- Grok 4.3: `x-ai/grok-4.3` via OpenRouter

This is different from the preferred reliability guidance for Claude Opus, which says to use direct Anthropic. Treat the script as the source of truth for "currently configured" and the SKILL.md guidance as the preferred/reliable manual override.

## Answering pattern

When answering "how is it configured?":

- Separate **current actual launcher behavior** from **recommended override**.
- State that the council script overrides the global Hermes default using `--provider openrouter`.
- State whether direct Anthropic credentials are present, but never reveal values.
- Call out the known mismatch: Claude Opus is preferred direct Anthropic, but first-pass script may still route it through OpenRouter unless patched.

## Do not record as a permanent failure

Do not write memories like "Claude via OpenRouter is broken". Provider behavior changes. Capture the durable operational pattern instead: verify the active launcher, verify credential presence, and use direct Anthropic for Claude Opus when OpenRouter errors or when maximum reliability is needed.
