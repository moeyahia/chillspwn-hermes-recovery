import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SCRIPT = resolve(
  import.meta.dir,
  "../../../../skills/council-of-ais/scripts/chillspwn_learn.py",
);

describe("legacy public-model learning containment", () => {
  test("fails closed before environment, transcript, native resume, or provider access", () => {
    const source = readFileSync(SCRIPT, "utf8");
    const guard = source.indexOf("LEGACY_FULL_CONTEXT_PUBLIC_REVIEW_DISABLED = True");
    const hermes = source.indexOf('HERMES_SRC = os.environ.get("CHILLSPWN_HERMES_SRC"');
    const provider = source.indexOf("def run_claude(");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(hermes);
    expect(guard).toBeLessThan(provider);

    const result = spawnSync("python3", [
      SCRIPT,
      "--resume-session",
      "provider-session-that-must-not-be-opened",
      "--transcript",
      "/path/that/must/not/be/read.md",
    ], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        // Intentionally omit CHILLSPWN_HERMES_SRC: the containment boundary
        // must run before any environment or source-tree dependency check.
      },
      timeout: 5_000,
    });

    expect(result.status).toBe(78);
    expect(result.stdout).toContain("legacy full-context public-model reviewer is disabled");
    expect(result.stderr).toBe("");
  });
});
