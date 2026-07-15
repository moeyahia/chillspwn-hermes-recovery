export type ProviderChildKind = "claude" | "openrouter" | "openai-codex" | "gemini" | "grok" | "council" | "terminal";

const BASE_KEYS = [
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM", "COLORTERM", "TMPDIR",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "PYTHONUNBUFFERED",
  "HERMES_HOME", "HERMES_PYTHON", "HERMES_CLI", "CODEX_HOME",
  "CHILLSPWN_STATE_DIR", "CHILLSPWN_SESSIONS_DIR", "CHILLSPWN_PERSONAS_DIR", "CHILLSPWN_PLUGIN_DIR",
  "CHILLSPWN_MEMORY_GUARD", "CHILLSPWN_MEM_CLI", "CHILLSPWN_MEMORY_SOCKET",
] as const;

const PROVIDER_KEYS: Record<ProviderChildKind, readonly string[]> = {
  claude: ["CLAUDE_CONFIG_DIR"],
  openrouter: ["OPENROUTER_API_KEY"],
  "openai-codex": ["CHILLSPWN_HERMES_SRC", "CHILLSPWN_CODEX_HTTP_TIMEOUT", "CHILLSPWN_CODEX_CALL_MAX_SECONDS", "CODEX_REASONING_EFFORT"],
  gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY", "CHILLSPWN_GEMINI_HTTP_TIMEOUT"],
  grok: [
    "GROK_HOME", "GROK_AUTH_PATH", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME",
    "GROK_CLAUDE_MCPS_ENABLED", "GROK_CURSOR_MCPS_ENABLED", "GROK_MANAGED_MCPS_ENABLED",
    "GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED", "GROK_SUBAGENTS", "GROK_MEMORY", "GROK_WEB_FETCH",
  ],
  council: [
    "CHILLSPWN_HERMES_SRC",
    "OPENROUTER_API_KEY", "FIRECRAWL_API_KEY", "FIRECRAWL_API_URL",
    "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN",
    "COUNCIL_ALIASES_FILE", "COUNCIL_CLAUDE_USER", "COUNCIL_CLAUDE_HOME", "COUNCIL_CLAUDE_LIVE_TOOLS",
    "COUNCIL_CODEX_HERMES_HOME", "COUNCIL_XAI_HERMES_HOME",
    // These remain in the Council parent for progress delivery. The Python
    // provider-scoped lane builder intentionally never copies them to a lane.
    "TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_USERS",
  ],
  terminal: [],
};

const SAFE_EXTRA = /^(?:CHILLSPWN_OR_[A-Z0-9_]+|CHILLSPWN_AGENT_RUN_ID|CHILLSPWN_DASHBOARD_URL|ENABLE_OPENROUTER_RUNTIME_GATING|OPENROUTER_GATE_(?:MODE|FAIL_MODE|TIMEOUT_SECONDS|POLL_SECONDS)|ENFORCE_CHILLSPWN_NO_HANDS|PAGER|TERM|COLUMNS|LINES)$/;

/**
 * Construct a provider-specific subprocess environment. The dashboard token and
 * unrelated provider credentials are absent by construction; callers can add
 * only narrowly-scoped runtime controls through the allowlisted `extra` map.
 */
export function buildProviderChildEnv(
  kind: ProviderChildKind,
  source: NodeJS.ProcessEnv = process.env,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of [...BASE_KEYS, ...PROVIDER_KEYS[kind]]) {
    const value = source[key];
    if (typeof value === "string" && value.length <= 32_768 && !value.includes("\0")) out[key] = value;
  }
  out.PATH ||= "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
  out.LANG ||= "C.UTF-8";
  out.TZ ||= "UTC";
  if (kind === "grok" && out.GROK_HOME) out.HOME = out.GROK_HOME;
  if (kind === "openrouter" || kind === "openai-codex" || kind === "gemini") {
    for (const [key, value] of Object.entries(source)) {
      if (SAFE_EXTRA.test(key) && typeof value === "string" && value.length <= 16_384 && !value.includes("\0")) {
        out[key] = value;
      }
    }
  }
  for (const [key, value] of Object.entries(extra)) {
    if (!SAFE_EXTRA.test(key) || typeof value !== "string" || value.length > 16_384 || value.includes("\0")) {
      throw new Error(`unsafe child environment override '${key}'`);
    }
    out[key] = value;
  }
  return out;
}
