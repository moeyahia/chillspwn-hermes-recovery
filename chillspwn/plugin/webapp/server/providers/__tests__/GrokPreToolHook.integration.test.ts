import { describe, expect, test } from "bun:test";
import { resolve } from "path";

const ROOT = resolve(import.meta.dir, "../../..");
const GUARD = resolve(ROOT, "server/providers/grok-commander-plugin/bin/commander-tool-guard.ts");
const PLUGIN = resolve(ROOT, "server/providers/grok-commander-plugin");

async function runGuard(payload: string, role = "commander") {
  const proc = Bun.spawn([process.execPath, GUARD], {
    cwd: ROOT,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CHILLSPWN_GROK_ROLE: role, GROK_PLUGIN_ROOT: PLUGIN },
  });
  proc.stdin.write(payload);
  proc.stdin.end();
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode, body: JSON.parse(stdout) };
}

describe("Grok commander PreToolUse guard", () => {
  test("denies terminal execution with the explicit hook exit code", async () => {
    const result = await runGuard(JSON.stringify({
      hookEventName: "pre_tool_use",
      toolName: "run_terminal_command",
      toolInput: { command: "touch /tmp/must-not-exist" },
    }));
    expect(result.exitCode).toBe(2);
    expect(result.body.decision).toBe("deny");
    expect(result.stderr).toBe("");
  });

  test("allows qualified Mission Board coordination", async () => {
    const result = await runGuard(JSON.stringify({
      hookEventName: "pre_tool_use",
      toolName: "chillspwn-board__board_create_task",
      toolInput: { agent: "ReverseSage", title: "Analyze fixture" },
    }));
    expect(result.exitCode).toBe(0);
    expect(result.body.decision).toBe("allow");
  });

  test("fails closed on malformed JSON, missing role, and unknown tools", async () => {
    expect((await runGuard("not-json")).body.decision).toBe("deny");
    expect((await runGuard(JSON.stringify({ toolName: "board_list" }), "")).exitCode).toBe(2);
    expect((await runGuard(JSON.stringify({ toolName: "future_tool" }))).body.decision).toBe("deny");
  });

  test("planning role cannot use board tools", async () => {
    const result = await runGuard(JSON.stringify({ toolName: "chillspwn-board__board_list", toolInput: {} }), "planner");
    expect(result.exitCode).toBe(2);
    expect(result.body.decision).toBe("deny");
  });
});
