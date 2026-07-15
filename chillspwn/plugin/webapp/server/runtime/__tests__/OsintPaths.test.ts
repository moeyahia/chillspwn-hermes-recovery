import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  readOsintArtifact,
  readOsintLogChunk,
  readOsintStateSnapshot,
  resolveOsintArtifact,
  resolveOsintOutputDirectory,
  safeOsintJobId,
} from "../OsintPaths";

let root: string;
let engagements: string;
let output: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "chillspwn-osint-paths-"));
  engagements = join(root, "boxes");
  output = join(engagements, "osint-example.test-1234");
  mkdirSync(engagements);
  mkdirSync(output);
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("OSINT persisted path boundary", () => {
  test("accepts canonical job IDs, output directories, and bounded artifacts", () => {
    expect(safeOsintJobId("osint-123-example.test")).toBe("osint-123-example.test");
    expect(resolveOsintOutputDirectory(output, [engagements])).toBe(output);
    const report = join(output, "report.md");
    writeFileSync(report, "safe report");
    expect(resolveOsintArtifact(output, "report.md")).toBe(report);
    expect(readOsintArtifact(output, "report.md").content.toString()).toBe("safe report");
  });

  test("rejects traversal, arbitrary directories, symlinks, and oversized artifacts", () => {
    expect(() => safeOsintJobId("../../etc/passwd")).toThrow();
    expect(() => resolveOsintOutputDirectory(engagements, [engagements])).toThrow();
    const outside = join(root, "outside");
    mkdirSync(outside);
    const linkedDir = join(engagements, "osint-linked-1234");
    symlinkSync(outside, linkedDir, "dir");
    expect(() => resolveOsintOutputDirectory(linkedDir, [engagements])).toThrow();
    const secret = join(root, "secret");
    writeFileSync(secret, "secret");
    symlinkSync(secret, join(output, "report.md"));
    expect(() => resolveOsintArtifact(output, "report.md")).toThrow();
    writeFileSync(join(output, "report.pdf"), "too large");
    expect(() => resolveOsintArtifact(output, "report.pdf", 2)).toThrow("size limit");
  });

  test("reads only exact bounded state and log files through no-follow descriptors", () => {
    const state = join(root, "state");
    mkdirSync(state);
    const id = "osint-123-example.test";
    writeFileSync(join(state, `${id}.json`), JSON.stringify({ id }));
    writeFileSync(join(state, `${id}.stdout.log`), "abcdef");

    expect(JSON.parse(readOsintStateSnapshot(state, id).content.toString())).toEqual({ id });
    const first = readOsintLogChunk(state, id, 0, { maximumChunkBytes: 3 });
    expect(first.content.toString()).toBe("abc");
    expect(readOsintLogChunk(state, id, first.nextOffset).content.toString()).toBe("def");

    const outside = join(root, "outside-state");
    writeFileSync(outside, "secret");
    const linkedId = "osint-456-linked";
    symlinkSync(outside, join(state, `${linkedId}.json`));
    symlinkSync(outside, join(state, `${linkedId}.stdout.log`));
    expect(() => readOsintStateSnapshot(state, linkedId)).toThrow();
    expect(() => readOsintLogChunk(state, linkedId, 0)).toThrow();
  });
});
