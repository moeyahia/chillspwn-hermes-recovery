import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createHash } from "crypto";
import { ArtifactStore, isSafeArtifactId, safeFilename } from "../ArtifactStore";

let dir: string;
let store: ArtifactStore;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "chillspwn-art-")); store = new ArtifactStore(dir); });
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

describe("Phase 12 ArtifactStore", () => {
  test("write returns metadata with sha256 + size; read round-trips", () => {
    const content = "PORT 80 open\n".repeat(1000);
    const m = store.write({ runId: "run_1", stepId: "s0", kind: "command_output", content, filename: "scan.txt" });
    expect(m.id).toMatch(/^art_/);
    expect(m.size).toBe(Buffer.byteLength(content));
    expect(m.sha256).toBe(createHash("sha256").update(Buffer.from(content)).digest("hex"));
    const r = store.read(m.id);
    expect(r).not.toBeNull();
    expect(r!.content.toString()).toBe(content);
  });

  test("read rejects path-traversal / unsafe ids (returns null, never reads outside the store)", () => {
    expect(store.read("../../etc/passwd")).toBeNull();
    expect(store.read("art_../escape")).toBeNull();
    expect(store.read("not-an-art-id")).toBeNull();
    expect(isSafeArtifactId("art_../x")).toBe(false);
    expect(isSafeArtifactId("art_abc123")).toBe(true);
  });

  test("safeFilename strips path components", () => {
    expect(safeFilename("../../evil.sh")).not.toContain("/");
    expect(safeFilename("a/b/c.txt")).toBe("a_b_c.txt");
  });

  test("list filters by runId", () => {
    store.write({ runId: "r1", content: "a" });
    store.write({ runId: "r2", content: "b" });
    expect(store.list("r1").length).toBe(1);
    expect(store.list().length).toBe(2);
  });

  test("missing artifact → null", () => {
    expect(store.read("art_doesnotexist")).toBeNull();
  });
});

import { AgentRuntime } from "../AgentRuntime";
import { AgentRunStore } from "../AgentRunStore";
import { EventLog } from "../EventLog";
import { MemoryBoardSink } from "../BoardSink";
import { DEFAULT_POLICY_CONFIG } from "../ToolPolicy";

describe("Phase 12 recordEvidence → artifact (large content)", () => {
  test("evidence content over the inline cap is stored as an artifact + previewed", () => {
    const d = mkdtempSync(join(tmpdir(), "chillspwn-artrt-"));
    try {
      const as = new ArtifactStore(d);
      const rt = new AgentRuntime({ store: new AgentRunStore(d), events: new EventLog({ dir: d }), board: new MemoryBoardSink(), policy: DEFAULT_POLICY_CONFIG, artifactStore: as });
      const run = rt.createManagedChatRun({ sessionId: "s", persona: "x", providerKind: "claude", objective: "o" });
      rt.beginPlanning(run.id);
      const { steps } = rt.submitPlan(run.id, { summary: "s", steps: [{ title: "a", purpose: "p", successCriteria: "c", allowedTools: [] }] });
      rt.approvePlan(run.id); rt.startStep(run.id, steps[0].id);
      const big = "X".repeat(30000); // > MAX_INLINE_OUTPUT (20000)
      const ev = rt.recordEvidence({ runId: run.id, stepId: steps[0].id, kind: "command_output", label: "big scan", content: big });
      expect(ev.artifactId).toBeTruthy();
      expect((ev.content || "").length).toBeLessThan(big.length); // inline is a preview
      expect(ev.content).toContain("truncated");
      const art = as.read(ev.artifactId!);
      expect(art!.content.toString()).toBe(big); // full content preserved in the artifact
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test("small evidence content stays inline (no artifact)", () => {
    const d = mkdtempSync(join(tmpdir(), "chillspwn-artsm-"));
    try {
      const rt = new AgentRuntime({ store: new AgentRunStore(d), events: new EventLog({ dir: d }), board: new MemoryBoardSink(), policy: DEFAULT_POLICY_CONFIG, artifactStore: new ArtifactStore(d) });
      const run = rt.createManagedChatRun({ sessionId: "s", persona: "x", providerKind: "claude", objective: "o" });
      rt.beginPlanning(run.id);
      const { steps } = rt.submitPlan(run.id, { summary: "s", steps: [{ title: "a", purpose: "p", successCriteria: "c", allowedTools: [] }] });
      rt.approvePlan(run.id); rt.startStep(run.id, steps[0].id);
      const ev = rt.recordEvidence({ runId: run.id, stepId: steps[0].id, kind: "finding", label: "small", content: "just a little" });
      expect(ev.artifactId).toBeUndefined();
      expect(ev.content).toBe("just a little");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
