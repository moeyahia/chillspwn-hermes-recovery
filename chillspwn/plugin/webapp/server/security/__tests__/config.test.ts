import { test, expect, describe } from "bun:test";
import { loadSecurityConfig, validateStartup, toPolicyConfig, isLoopbackHost } from "../config";

describe("security config — secure defaults", () => {
  test("empty env yields loopback bind + all risky features OFF + obfuscation OFF", () => {
    const cfg = loadSecurityConfig({});
    expect(cfg.bindHost).toBe("127.0.0.1");
    expect(cfg.exposed).toBe(false);
    expect(cfg.enableTerminal).toBe(false);
    expect(cfg.enableProxy).toBe(false);
    expect(cfg.enableFileWrite).toBe(false);
    expect(cfg.enableSecurityTools).toBe(false);
    expect(cfg.enableLegacyExecutionApi).toBe(false);
    expect(cfg.enablePromptObfuscation).toBe(false);
    expect(cfg.requireApprovalForTerminal).toBe(true);
    expect(cfg.requireApprovalForFileWrite).toBe(true);
  });

  test("loopback host detection", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("198.51.100.83")).toBe(false);
  });

  test("exposing the bind flips `exposed` and activates auth", () => {
    const cfg = loadSecurityConfig({ CHILLSPWN_BIND: "0.0.0.0", DASHBOARD_TOKEN: "secret" });
    expect(cfg.exposed).toBe(true);
    expect(cfg.authActive).toBe(true);
  });

  test("bool parsing accepts common truthy/falsey spellings", () => {
    expect(loadSecurityConfig({ ENABLE_TERMINAL: "true" }).enableTerminal).toBe(true);
    expect(loadSecurityConfig({ ENABLE_TERMINAL: "1" }).enableTerminal).toBe(true);
    expect(loadSecurityConfig({ ENABLE_TERMINAL: "on" }).enableTerminal).toBe(true);
    expect(loadSecurityConfig({ ENABLE_TERMINAL: "false" }).enableTerminal).toBe(false);
    expect(loadSecurityConfig({ ENABLE_TERMINAL: "garbage" }).enableTerminal).toBe(false);
    expect(loadSecurityConfig({ ENABLE_LEGACY_EXECUTION_API: "true" }).enableLegacyExecutionApi).toBe(true);
    expect(loadSecurityConfig({ ENABLE_LEGACY_EXECUTION_API: "garbage" }).enableLegacyExecutionApi).toBe(false);
  });

  test("ALLOWED_WORKSPACE_ROOTS parses colon/comma lists, defaults otherwise", () => {
    expect(loadSecurityConfig({}).allowedWorkspaceRoots).toEqual([
      "/var/lib/chillspwn/workspaces/htb/boxes",
      "/var/lib/chillspwn/workspaces/engagements",
    ]);
    const cfg = loadSecurityConfig({ ALLOWED_WORKSPACE_ROOTS: "/a:/b,/c" });
    expect(cfg.allowedWorkspaceRoots).toEqual(["/a", "/b", "/c"]);
  });
});

describe("security config — startup validation (fail closed)", () => {
  test("exposed without token refuses to start", () => {
    const cfg = loadSecurityConfig({ CHILLSPWN_BIND: "0.0.0.0" });
    const chk = validateStartup(cfg);
    expect(chk.ok).toBe(false);
    expect(chk.fatal).toMatch(/Refusing to start/);
  });

  test("exposed without token but explicitly allowed-unsafe starts with a warning", () => {
    const cfg = loadSecurityConfig({
      CHILLSPWN_BIND: "0.0.0.0",
      CHILLSPWN_ALLOW_UNSAFE_NO_AUTH: "true",
    });
    const chk = validateStartup(cfg);
    expect(chk.ok).toBe(true);
    expect(chk.warnings.join(" ")).toMatch(/UNSAFE/);
  });

  test("exposed with token starts clean", () => {
    const cfg = loadSecurityConfig({ CHILLSPWN_BIND: "0.0.0.0", DASHBOARD_TOKEN: "t" });
    const chk = validateStartup(cfg);
    expect(chk.ok).toBe(true);
  });

  test("loopback bind starts clean with no token", () => {
    const chk = validateStartup(loadSecurityConfig({}));
    expect(chk.ok).toBe(true);
  });

  test("enabling obfuscation produces an audit warning", () => {
    const cfg = loadSecurityConfig({ ENABLE_PROMPT_OBFUSCATION: "true" });
    const chk = validateStartup(cfg);
    expect(chk.warnings.join(" ")).toMatch(/obfuscation/i);
  });

  test("enabling legacy execution produces a loud compatibility warning", () => {
    const cfg = loadSecurityConfig({ ENABLE_LEGACY_EXECUTION_API: "true" });
    const chk = validateStartup(cfg);
    expect(chk.ok).toBe(true);
    expect(chk.warnings.join(" ")).toMatch(/two-journey Command OS boundary/i);
  });

  test("toPolicyConfig mirrors the security flags", () => {
    const cfg = loadSecurityConfig({ ENABLE_TERMINAL: "true", ENABLE_FILE_WRITE: "true" });
    const pol = toPolicyConfig(cfg);
    expect(pol.enableTerminal).toBe(true);
    expect(pol.enableFileWrite).toBe(true);
    expect(pol.requireStepBinding).toBe(true);
  });
});
