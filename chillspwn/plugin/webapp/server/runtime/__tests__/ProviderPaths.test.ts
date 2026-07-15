import { describe, expect, test } from "bun:test";
import { claudeProjectsDir, claudeStateDir } from "../ProviderPaths";

describe("Claude credential/session state paths", () => {
  test("defaults to the isolated Hermes Claude credential root", () => {
    expect(claudeStateDir({ HOME: "/home/service" })).toBe("/home/service/.hermes/auth/claude");
    expect(claudeProjectsDir({ HOME: "/home/service" })).toBe("/home/service/.hermes/auth/claude/projects");
  });

  test("honors isolated CLAUDE_CONFIG_DIR", () => {
    const env = { HOME: "/root", CLAUDE_CONFIG_DIR: "/root/.hermes/auth/claude" };
    expect(claudeStateDir(env)).toBe("/root/.hermes/auth/claude");
    expect(claudeProjectsDir(env)).toBe("/root/.hermes/auth/claude/projects");
  });
});
