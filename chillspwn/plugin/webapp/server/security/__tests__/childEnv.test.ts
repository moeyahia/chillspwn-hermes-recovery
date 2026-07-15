import { describe, expect, test } from "bun:test";
import { buildProviderChildEnv } from "../childEnv";

const source = {
  PATH: "/usr/bin:/bin",
  HOME: "/srv/chillspwn",
  DASHBOARD_TOKEN: "dashboard-secret",
  CHILLSPWN_DASHBOARD_TOKEN: "dashboard-secret-2",
  OPENROUTER_API_KEY: "openrouter-secret",
  GEMINI_API_KEY: "gemini-secret",
  GOOGLE_API_KEY: "google-secret",
  ANTHROPIC_API_KEY: "anthropic-metered-secret",
  XAI_API_KEY: "xai-secret",
  OPENAI_API_KEY: "openai-secret",
  FIRECRAWL_API_KEY: "firecrawl-secret",
  FIRECRAWL_API_URL: "https://firecrawl.internal.example",
  CLAUDE_CONFIG_DIR: "/auth/claude",
  CLAUDE_CODE_OAUTH_TOKEN: "claude-oauth-secret",
  CODEX_HOME: "/auth/codex",
  HERMES_HOME: "/auth/hermes",
  CHILLSPWN_HERMES_SRC: "/opt/chillspwn/hermes-agent",
  CHILLSPWN_REPORT_TEMPLATE_DIR: "/opt/chillspwn/report-template",
  COUNCIL_CODEX_HERMES_HOME: "/auth/codex-hermes",
  COUNCIL_XAI_HERMES_HOME: "/auth/xai-hermes",
  COUNCIL_CLAUDE_USER: "council-claude",
  COUNCIL_CLAUDE_HOME: "/home/council-claude",
  TELEGRAM_BOT_TOKEN: "telegram-secret",
  TELEGRAM_ALLOWED_USERS: "10001",
  GROK_HOME: "/auth/grok-home",
  GROK_AUTH_PATH: "/auth/grok.json",
  GITHUB_TOKEN: "github-secret",
  SSH_AUTH_SOCK: "/run/ssh-agent.sock",
  UNRELATED_SENTINEL: "must-not-cross",
};

describe("provider child environments", () => {
  test("Claude OAuth process receives no provider or dashboard API secrets", () => {
    const env = buildProviderChildEnv("claude", source);
    expect(env.CHILLSPWN_REPORT_TEMPLATE_DIR).toBe("/opt/chillspwn/report-template");
    for (const key of ["DASHBOARD_TOKEN", "CHILLSPWN_DASHBOARD_TOKEN", "OPENROUTER_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY", "UNRELATED_SENTINEL"]) {
      expect(env[key]).toBeUndefined();
    }
  });

  test("each API-backed provider receives only its selected key", () => {
    const openrouter = buildProviderChildEnv("openrouter", source);
    expect(openrouter.OPENROUTER_API_KEY).toBe("openrouter-secret");
    expect(openrouter.GEMINI_API_KEY).toBeUndefined();

    const gemini = buildProviderChildEnv("gemini", source);
    expect(gemini.GEMINI_API_KEY).toBe("gemini-secret");
    expect(gemini.OPENROUTER_API_KEY).toBeUndefined();
  });

  test("runtime extras are narrowly allowlisted", () => {
    expect(buildProviderChildEnv("openrouter", source, { CHILLSPWN_OR_MAX_ITERS: "20" }).CHILLSPWN_OR_MAX_ITERS).toBe("20");
    expect(() => buildProviderChildEnv("openrouter", source, { DASHBOARD_TOKEN: "no" })).toThrow();
  });

  test("Council parent receives its distribution contract but no dashboard or unrelated secrets", () => {
    const env = buildProviderChildEnv("council", source);

    expect(env.CHILLSPWN_HERMES_SRC).toBe("/opt/chillspwn/hermes-agent");
    expect(env.HERMES_HOME).toBe("/auth/hermes");
    expect(env.CODEX_HOME).toBe("/auth/codex");
    expect(env.OPENROUTER_API_KEY).toBe("openrouter-secret");
    expect(env.FIRECRAWL_API_KEY).toBe("firecrawl-secret");
    expect(env.CLAUDE_CONFIG_DIR).toBe("/auth/claude");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("claude-oauth-secret");
    expect(env.COUNCIL_CODEX_HERMES_HOME).toBe("/auth/codex-hermes");
    expect(env.COUNCIL_XAI_HERMES_HOME).toBe("/auth/xai-hermes");
    expect(env.TELEGRAM_BOT_TOKEN).toBe("telegram-secret");
    expect(env.TELEGRAM_ALLOWED_USERS).toBe("10001");

    for (const key of [
      "DASHBOARD_TOKEN", "CHILLSPWN_DASHBOARD_TOKEN", "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY", "XAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",
      "GROK_HOME", "GROK_AUTH_PATH", "GITHUB_TOKEN", "SSH_AUTH_SOCK",
      "UNRELATED_SENTINEL",
    ]) {
      expect(env[key]).toBeUndefined();
    }
  });
});
