import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  IncrementalBatchAbortError,
  OBSIDIAN_SCALE_CONFIRMATION,
  OBSIDIAN_SCALE_DEFAULT_NOTES,
  OBSIDIAN_SCALE_MAX_NOTES,
  OBSIDIAN_SCALE_MIN_NOTES,
  OBSIDIAN_SCALE_PREFIX,
  assertIsolatedObsidianScaleWorkspace,
  buildObsidianScalePaths,
  processIncrementally,
  removeObsidianScaleWorkspace,
  scaleNoteCount,
  validateObsidianScaleGate,
} from "../../../scripts/command-os-v2/obsidian-vault-scale-profile-lib";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("physical Obsidian scale profile safety", () => {
  test("requires an exact opt-in and bounds the synthetic note count", () => {
    expect(() => validateObsidianScaleGate({})).toThrow("CHILLSPWN_OBSIDIAN_SCALE_CONFIRM");
    expect(() => validateObsidianScaleGate({
      CHILLSPWN_OBSIDIAN_SCALE_CONFIRM: `${OBSIDIAN_SCALE_CONFIRMATION}-wrong`,
    })).toThrow("isolated 50,000-note profile");
    expect(() => validateObsidianScaleGate({
      CHILLSPWN_OBSIDIAN_SCALE_CONFIRM: OBSIDIAN_SCALE_CONFIRMATION,
    })).not.toThrow();
    expect(scaleNoteCount({})).toBe(OBSIDIAN_SCALE_DEFAULT_NOTES);
    expect(scaleNoteCount({ CHILLSPWN_OBSIDIAN_SCALE_NOTES: String(OBSIDIAN_SCALE_MIN_NOTES) }))
      .toBe(OBSIDIAN_SCALE_MIN_NOTES);
    expect(scaleNoteCount({ CHILLSPWN_OBSIDIAN_SCALE_NOTES: String(OBSIDIAN_SCALE_MAX_NOTES) }))
      .toBe(OBSIDIAN_SCALE_MAX_NOTES);
    expect(() => scaleNoteCount({ CHILLSPWN_OBSIDIAN_SCALE_NOTES: "0" })).toThrow("between 4");
    expect(() => scaleNoteCount({ CHILLSPWN_OBSIDIAN_SCALE_NOTES: "3" })).toThrow("between 4");
    expect(() => scaleNoteCount({ CHILLSPWN_OBSIDIAN_SCALE_NOTES: "50001" })).toThrow("between 4");
    expect(() => scaleNoteCount({ CHILLSPWN_OBSIDIAN_SCALE_NOTES: "1.5" })).toThrow("integer");
  });

  test("derives all state below a fresh direct /tmp child", () => {
    const root = mkdtempSync(join("/tmp", OBSIDIAN_SCALE_PREFIX));
    temporaryPaths.push(root);
    const paths = buildObsidianScalePaths(root);
    expect(paths.root).toBe(root);
    expect(paths.databasePath).toStartWith(`${root}/`);
    expect(paths.allowedVaultRoot).toStartWith(`${root}/`);
    expect(paths.databasePath).not.toContain("/var/lib/chillspwn");
    expect(paths.vaultName).toBe("ChillsPwn-Brain-Scale-Acceptance");

    const nested = join(root, `${OBSIDIAN_SCALE_PREFIX}nested`);
    mkdirSync(nested);
    expect(() => assertIsolatedObsidianScaleWorkspace(nested)).toThrow("direct child");
    expect(() => assertIsolatedObsidianScaleWorkspace("/tmp")).toThrow("direct child");
  });

  test("rejects symlink and unrelated cleanup targets", () => {
    const target = mkdtempSync(join("/tmp", "obsidian-scale-target-"));
    const link = join("/tmp", `${OBSIDIAN_SCALE_PREFIX}link-${crypto.randomUUID()}`);
    const unrelated = mkdtempSync(join("/tmp", "obsidian-scale-preserve-"));
    const sentinel = join(unrelated, "sentinel");
    temporaryPaths.push(target, link, unrelated);
    symlinkSync(target, link, "dir");
    writeFileSync(sentinel, "preserve");
    expect(() => assertIsolatedObsidianScaleWorkspace(link)).toThrow("real directory");
    expect(() => removeObsidianScaleWorkspace(unrelated)).toThrow("direct child");
    expect(existsSync(sentinel)).toBe(true);
  });

  test("yields by batch and observes cancellation without partial items", async () => {
    const controller = new AbortController();
    const completed: number[] = [];
    let yields = 0;
    let thrown: unknown;
    try {
      await processIncrementally(100, (index) => {
        completed.push(index);
        if (index === 12) controller.abort();
      }, {
        batchSize: 5,
        signal: controller.signal,
        yieldControl: async () => { yields += 1; },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(IncrementalBatchAbortError);
    expect((thrown as IncrementalBatchAbortError).processed).toBe(13);
    expect(completed).toEqual(Array.from({ length: 13 }, (_, index) => index));
    expect(yields).toBe(2);
  });

  test("removes only a validated isolated workspace", () => {
    const root = mkdtempSync(join("/tmp", OBSIDIAN_SCALE_PREFIX));
    writeFileSync(join(root, "synthetic-scale-state"), "temporary");
    removeObsidianScaleWorkspace(root);
    expect(existsSync(root)).toBe(false);
  });
});
