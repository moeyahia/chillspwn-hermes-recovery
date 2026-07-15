import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  OBSIDIAN_SMOKE_CONFIRMATION,
  OBSIDIAN_SMOKE_PREFIX,
  assertIsolatedObsidianWorkspace,
  buildObsidianSmokePaths,
  removeObsidianSmokeWorkspace,
  validateObsidianSmokeGate,
} from "../../../scripts/command-os-v2/obsidian-bridge-acceptance-smoke-lib";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("physical Obsidian bridge acceptance smoke safety", () => {
  test("requires an exact operator opt-in phrase", () => {
    expect(() => validateObsidianSmokeGate({})).toThrow("Set CHILLSPWN_OBSIDIAN_SMOKE_CONFIRM");
    expect(() => validateObsidianSmokeGate({
      CHILLSPWN_OBSIDIAN_SMOKE_CONFIRM: `${OBSIDIAN_SMOKE_CONFIRMATION}-wrong`,
    })).toThrow("isolated smoke");
    expect(() => validateObsidianSmokeGate({
      CHILLSPWN_OBSIDIAN_SMOKE_CONFIRM: OBSIDIAN_SMOKE_CONFIRMATION,
    })).not.toThrow();
  });

  test("derives the database and vault only below a fresh direct /tmp child", () => {
    const root = mkdtempSync(join("/tmp", OBSIDIAN_SMOKE_PREFIX));
    temporaryPaths.push(root);
    const paths = buildObsidianSmokePaths(root);
    expect(paths.root).toBe(root);
    expect(paths.databasePath).toStartWith(`${root}/`);
    expect(paths.allowedVaultRoot).toStartWith(`${root}/`);
    expect(paths.databasePath).not.toContain("/var/lib/chillspwn");
    expect(paths.allowedVaultRoot).not.toContain("/var/lib/chillspwn");
    expect(paths.vaultName).toBe("ChillsPwn-Brain-Acceptance");

    const nested = join(root, OBSIDIAN_SMOKE_PREFIX + "nested");
    mkdirSync(nested);
    expect(() => assertIsolatedObsidianWorkspace(nested)).toThrow("direct child");
    expect(() => assertIsolatedObsidianWorkspace("/tmp")).toThrow("direct child");
  });

  test("rejects symlink workspaces and cleanup targets outside the smoke prefix", () => {
    const target = mkdtempSync(join("/tmp", "obsidian-target-"));
    const link = join("/tmp", `${OBSIDIAN_SMOKE_PREFIX}link-${crypto.randomUUID()}`);
    const unrelated = mkdtempSync(join("/tmp", "must-not-remove-"));
    const sentinel = join(unrelated, "sentinel");
    temporaryPaths.push(target, link, unrelated);
    symlinkSync(target, link, "dir");
    writeFileSync(sentinel, "preserve");
    expect(() => assertIsolatedObsidianWorkspace(link)).toThrow("real directory");
    expect(() => removeObsidianSmokeWorkspace(unrelated)).toThrow("direct child");
    expect(existsSync(sentinel)).toBe(true);
  });

  test("removes only a validated isolated workspace", () => {
    const root = mkdtempSync(join("/tmp", OBSIDIAN_SMOKE_PREFIX));
    writeFileSync(join(root, "synthetic-state"), "temporary");
    removeObsidianSmokeWorkspace(root);
    expect(existsSync(root)).toBe(false);
  });
});
