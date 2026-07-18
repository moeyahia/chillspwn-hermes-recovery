import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveEngagementWorkingDirectory } from "../EngagementScope";

let root: string;
let first: string;
let second: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "chillspwn-engagement-scope-"));
  first = join(root, "boxes");
  second = join(root, "engagements");
  mkdirSync(first);
  mkdirSync(second);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("engagement working-directory boundary", () => {
  test("resolves a valid engagement under a configured root", () => {
    const valid = join(second, "client-alpha");
    mkdirSync(valid);
    expect(resolveEngagementWorkingDirectory("client-alpha", [first, second])).toBe(valid);
  });

  test("resolves a unique existing workspace when display-name casing differs", () => {
    const valid = join(second, "reapertwo");
    mkdirSync(valid);
    expect(resolveEngagementWorkingDirectory("ReaperTwo", [first, second])).toBe(valid);
  });

  test("fails closed when case-insensitive workspace matching is ambiguous", () => {
    mkdirSync(join(second, "reapertwo"));
    mkdirSync(join(second, "ReaperTwo"));
    expect(() => resolveEngagementWorkingDirectory("REAPERTWO", [first, second]))
      .toThrow("ambiguous");
  });

  test("rejects traversal, missing names, and symlinked engagements", () => {
    expect(() => resolveEngagementWorkingDirectory("../../.ssh", [first, second])).toThrow();
    expect(() => resolveEngagementWorkingDirectory("missing", [first, second])).toThrow("does not identify");
    const outside = join(root, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(first, "linked"), "dir");
    expect(() => resolveEngagementWorkingDirectory("linked", [first, second])).toThrow("does not identify");
  });
});
