import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dir, "../../..");

describe("Grok ACP commander SOUL/profile", () => {
  test("profile exposes only MCP discovery and dispatch", () => {
    const profile = readFileSync(resolve(ROOT, "server/providers/grok-commander-profile.md"), "utf-8");
    const allowed = profile.match(/tools:\n([\s\S]*?)disallowedTools:/)?.[1] || "";
    expect(allowed).toContain("search_tool");
    expect(allowed).toContain("use_tool");
    expect(allowed).not.toContain("ask_user_question");
    expect(allowed).not.toContain("run_terminal");
    expect(allowed).not.toContain("search_replace");
    expect(allowed).not.toContain("spawn_subagent");
  });

  test("dedicated SOUL has no one-step or execute-first escape hatch", () => {
    const soul = readFileSync(resolve(ROOT, "server/agents/personas/chillspwn-commander-soul.md"), "utf-8");
    expect(soul).toContain("NO HANDS");
    expect(soul).toContain("MANDATORY ROUTING RULE");
    expect(soul).not.toMatch(/EXECUTE FIRST/i);
    expect(soul).not.toMatch(/Never delegate a single task/i);
    expect(soul).not.toMatch(/trivial ONE-step ask may be done directly/i);
  });

  test("live persona append prompt, when present, has no direct-execution exception", () => {
    const personaPath = process.env.CHILLSPWN_PERSONAS_DIR
      ? resolve(process.env.CHILLSPWN_PERSONAS_DIR, "chillspwn/persona.json")
      : "/root/.hermes/chillspwn/personas/chillspwn/persona.json";
    if (!existsSync(personaPath)) return;
    const persona = JSON.parse(readFileSync(personaPath, "utf-8"));
    expect(String(persona.appendSystemPrompt || "")).not.toMatch(/trivial ONE-step ask may be done directly/i);
  });
});
