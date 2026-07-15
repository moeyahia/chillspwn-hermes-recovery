# Deprecated: Anthropic API-key Council routing

The current Claude Council lane does not use the Anthropic API. It uses `claude-cli` with the
operator's authenticated Claude subscription.

Do not set `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, or `ANTHROPIC_TOKEN` for this lane and do
not add an OpenRouter fallback. `build_lane_environment()` excludes these variables, and
`run_claude_cli()` strips them again before starting Claude Code. This prevents a subscription lane
from silently becoming a metered API call.

Required runtime settings are:

- `CLAUDE_CONFIG_DIR`, or an authenticated Claude CLI state reachable from the selected home;
- optional `CLAUDE_CODE_OAUTH_TOKEN` when subscription OAuth is intentionally supplied by env;
- `COUNCIL_CLAUDE_USER` and `COUNCIL_CLAUDE_HOME` for root-launched live-tool execution;
- optional `COUNCIL_CLAUDE_LIVE_TOOLS=0` for the evidence-prefed, tool-less fallback.

If the subscription login is unavailable, fail and reauthenticate the Claude lane. Never repair it
by introducing an API key.
