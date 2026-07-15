import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  safeSegment,
  resolveWithin,
  resolveWithinRoots,
  isWithinRoot,
  PathSecurityError,
  resolveExistingWithinRoots,
  resolveWriteTargetWithinRoots,
} from "../paths";

const temporaryPaths: string[] = [];
afterEach(() => {
  while (temporaryPaths.length) rmSync(temporaryPaths.pop()!, { recursive: true, force: true });
});

describe("safeSegment", () => {
  test("accepts ordinary names", () => {
    expect(safeSegment("chillspwn")).toBe("chillspwn");
    expect(safeSegment("ping.htb")).toBe("ping.htb");
    expect(safeSegment("report_2026-06-05")).toBe("report_2026-06-05");
  });

  test("rejects traversal and separators", () => {
    expect(() => safeSegment("..")).toThrow(PathSecurityError);
    expect(() => safeSegment("../etc")).toThrow(PathSecurityError);
    expect(() => safeSegment("a/b")).toThrow(PathSecurityError);
    expect(() => safeSegment("a\\b")).toThrow(PathSecurityError);
    expect(() => safeSegment("/etc/passwd")).toThrow(PathSecurityError);
    expect(() => safeSegment("foo\0bar")).toThrow(PathSecurityError);
    expect(() => safeSegment("")).toThrow(PathSecurityError);
  });
});

describe("isWithinRoot / resolveWithin", () => {
  test("isWithinRoot is true for children, false for escapes", () => {
    expect(isWithinRoot("/root/htb", "/root/htb/ping")).toBe(true);
    expect(isWithinRoot("/root/htb", "/root/htb")).toBe(true);
    expect(isWithinRoot("/root/htb", "/root/secrets")).toBe(false);
    expect(isWithinRoot("/root/htb", "/root/htb/../secrets")).toBe(false);
  });

  test("resolveWithin keeps inside the root", () => {
    expect(resolveWithin("/root/htb", "ping")).toBe("/root/htb/ping");
    expect(resolveWithin("/root/htb", "/root/htb/ping/loot")).toBe("/root/htb/ping/loot");
  });

  test("resolveWithin rejects escapes", () => {
    expect(() => resolveWithin("/root/htb", "../secrets")).toThrow(PathSecurityError);
    expect(() => resolveWithin("/root/htb", "/etc/passwd")).toThrow(PathSecurityError);
    expect(() => resolveWithin("/root/htb", "ping/../../etc")).toThrow(PathSecurityError);
  });
});

describe("resolveWithinRoots (file-route guard)", () => {
  const roots = ["/root/htb", "/root/engagements"];
  test("accepts a path under any allowed root", () => {
    expect(resolveWithinRoots(roots, "/root/engagements/x")).toBe("/root/engagements/x");
    expect(resolveWithinRoots(roots, "/root/htb/ping/loot.txt")).toBe("/root/htb/ping/loot.txt");
  });
  test("a sibling whose name is a prefix is NOT accepted (/root/htb2 vs /root/htb)", () => {
    expect(() => resolveWithinRoots(roots, "/root/htb2")).toThrow(PathSecurityError);
    expect(() => resolveWithinRoots(roots, "/root/htb2/secret")).toThrow(PathSecurityError);
    expect(() => resolveWithinRoots(roots, "/root/engagements-evil/x")).toThrow(PathSecurityError);
  });
  test("rejects a path outside all roots (no broad /root)", () => {
    expect(() => resolveWithinRoots(roots, "/root/.hermes/auth.json")).toThrow(PathSecurityError);
    expect(() => resolveWithinRoots(roots, "/root/.ssh/id_rsa")).toThrow(PathSecurityError);
    expect(() => resolveWithinRoots(roots, "/etc/passwd")).toThrow(PathSecurityError);
  });
  test("rejects traversal that escapes a root", () => {
    expect(() => resolveWithinRoots(roots, "/root/htb/../../etc/shadow")).toThrow(PathSecurityError);
    expect(() => resolveWithinRoots(roots, "/root/htb/ping/../../../.ssh/id_rsa")).toThrow(PathSecurityError);
  });
});

describe("real filesystem containment", () => {
  test("rejects a symlink that escapes an allowed root", () => {
    const base = mkdtempSync(join(tmpdir(), "chillspwn-paths-"));
    temporaryPaths.push(base);
    const root = join(base, "allowed");
    const outside = join(base, "outside");
    mkdirSync(root);
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.txt"), "not workspace data");
    symlinkSync(join(outside, "secret.txt"), join(root, "escape.txt"));

    expect(() => resolveExistingWithinRoots([root], join(root, "escape.txt"))).toThrow(PathSecurityError);
    expect(() => resolveWriteTargetWithinRoots([root], join(root, "escape.txt"))).toThrow(PathSecurityError);
  });

  test("accepts regular existing files and new files under a real allowed parent", () => {
    const root = mkdtempSync(join(tmpdir(), "chillspwn-paths-"));
    temporaryPaths.push(root);
    const existing = join(root, "existing.txt");
    writeFileSync(existing, "ok");

    expect(resolveExistingWithinRoots([root], existing, "path", { rejectFinalSymlink: true })).toBe(existing);
    expect(resolveWriteTargetWithinRoots([root], join(root, "new.txt"))).toBe(join(root, "new.txt"));
  });
});
