import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MemoryService, MemoryError, type MemoryProposalInput } from "../MemoryService";
import { MemoryStore } from "../MemoryStore";
import { EventLog } from "../EventLog";

let dir: string;
let svc: MemoryService;
let events: EventLog;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "chillspwn-mem-"));
  events = new EventLog({ dir });
  svc = new MemoryService(new MemoryStore(dir), events);
});
afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

const sessionPref: MemoryProposalInput = {
  type: "user_preference", content: "the operator prefers Telegram alerts", scope: "session",
  sourceSessionId: "s1", confidence: 0.9,
};

describe("memory proposal creation + validation", () => {
  test("a valid proposal is stored as UNVERIFIED (never auto-trusted)", () => {
    const item = svc.proposeMemory(sessionPref);
    expect(item.status).toBe("unverified");
    expect(item.id.startsWith("mem_")).toBe(true);
    expect(events.readAll().some((e) => e.type === "memory_proposed")).toBe(true);
    // it shows up as a proposal, NOT as a verified item
    expect(svc.listMemoryProposals().length).toBe(1);
    expect(svc.listMemoryItems({ status: "verified" }).length).toBe(0);
  });

  test("invalid proposals are rejected with errors", () => {
    expect(() => svc.proposeMemory({ ...sessionPref, content: "  " })).toThrow(MemoryError);
    expect(() => svc.proposeMemory({ ...sessionPref, confidence: 2 })).toThrow(/confidence/);
    expect(() => svc.proposeMemory({ ...sessionPref, type: "bogus" as any })).toThrow(/invalid memory type/);
    // session scope requires a session id
    expect(() => svc.proposeMemory({ ...sessionPref, sourceSessionId: undefined })).toThrow(/sourceSessionId/);
  });

  test("global/project scope REQUIRES provenance", () => {
    expect(() => svc.proposeMemory({ type: "finding", content: "x", scope: "global" })).toThrow(/requires provenance/);
    // with provenance it's allowed (but still unverified)
    const ok = svc.proposeMemory({ type: "finding", content: "x", scope: "global", sourceAgentRunId: "run_1" });
    expect(ok.status).toBe("unverified");
  });

  test("reusable scopes reject target identity and secrets", () => {
    expect(() => svc.proposeMemory({
      type: "finding", content: "target 10.10.10.10 password=secret-value", scope: "global", sourceAgentRunId: "run_1",
    })).toThrow(/target-agnostic and secret-free/);
    for (const content of [
      "curl https://victim.example/admin",
      "login user=administrator",
      "Use username alice with smbclient",
      "target named orion exposed SMB",
      "password is demo-passphrase",
      "password demo-passphrase",
      "credential alice:demo-passphrase",
      "login with alice and demo-passphrase",
      "token was demo-token-value",
      "use token demo-token-value",
      "secret is demo-secret-value",
      "the target machine CredSmith exposed SMB",
    ]) {
      expect(() => svc.proposeMemory({
        type: "finding", content, scope: "project", sourceAgentRunId: "run_1",
      })).toThrow(/target-agnostic and secret-free/);
    }
  });

  test("tool_observation requires a tool/evidence link", () => {
    expect(() =>
      svc.proposeMemory({ type: "tool_observation", content: "port 80 open", scope: "engagement", sourceSessionId: "s1" }),
    ).toThrow(/tool_observation/);
    const ok = svc.proposeMemory({
      type: "tool_observation", content: "port 80 open", scope: "engagement",
      sourceSessionId: "s1", sourceToolName: "nmap", sourceEvidenceId: "ev_1",
    });
    expect(ok.status).toBe("unverified");
  });
});

describe("approval flow", () => {
  test("approve converts a proposal to a verified item + audits memory_written", () => {
    const item = svc.proposeMemory(sessionPref);
    const approved = svc.approveMemory(item.id, { resolvedBy: "operator" });
    expect(approved.status).toBe("verified");
    expect(approved.resolvedBy).toBe("operator");
    expect(events.readAll().some((e) => e.type === "memory_written")).toBe(true);
    expect(svc.listMemoryItems({ status: "verified" }).length).toBe(1);
    expect(svc.listMemoryProposals().length).toBe(0);
  });

  test("reject marks the proposal rejected with a reason", () => {
    const item = svc.proposeMemory(sessionPref);
    const rej = svc.rejectMemory(item.id, "not durable");
    expect(rej.status).toBe("rejected");
    expect(rej.rejectionReason).toBe("not durable");
    expect(events.readAll().some((e) => e.type === "memory_rejected")).toBe(true);
  });

  test("only an unverified proposal can be approved", () => {
    const item = svc.proposeMemory(sessionPref);
    svc.approveMemory(item.id);
    expect(() => svc.approveMemory(item.id)).toThrow(/only an unverified/);
  });

  test("approval quarantines target-specific engagement proposals", () => {
    const item = svc.proposeMemory({
      type: "engagement_fact", content: "host 10.10.10.10 accepted administrator", scope: "engagement", sourceAgentRunId: "run_1",
    });
    expect(() => svc.approveMemory(item.id)).toThrow(/keep raw target state in evidence/);
    expect(svc.getMemory(item.id)?.status).toBe("unverified");
  });

  test("markStale retires a verified item", () => {
    const item = svc.proposeMemory(sessionPref);
    svc.approveMemory(item.id);
    const stale = svc.markStale(item.id);
    expect(stale.status).toBe("stale");
    expect(events.readAll().some((e) => e.type === "memory_stale")).toBe(true);
  });
});

describe("category discipline", () => {
  test("a HYPOTHESIS is not treated as verified by default", () => {
    const hyp = svc.proposeMemory({
      type: "hypothesis", content: "the DC may be vulnerable to zerologon", scope: "engagement",
      sourceAgentRunId: "run_1", confidence: 0.3,
    });
    expect(hyp.status).toBe("unverified");
    // it is NOT in the verified set until explicitly approved
    expect(svc.listMemoryItems({ status: "verified" }).some((m) => m.type === "hypothesis")).toBe(false);
  });

  test("evidence/tool observation does NOT automatically become long-term memory", () => {
    // Proposing from a tool observation yields an unverified item; nothing global is auto-created.
    svc.proposeMemory({
      type: "tool_observation", content: "smb signing disabled", scope: "engagement",
      sourceSessionId: "s1", sourceToolName: "nxc", sourceEvidenceId: "ev_9",
    });
    expect(svc.listMemoryItems({ scope: "global" }).length).toBe(0);
    expect(svc.listMemoryItems({ status: "verified" }).length).toBe(0);
  });

  test("scope separation: session vs engagement vs global are queryable distinctly", () => {
    svc.proposeMemory(sessionPref); // session
    svc.proposeMemory({ type: "engagement_fact", content: "box is PING.HTB", scope: "engagement", sourceSessionId: "s1" });
    svc.proposeMemory({ type: "finding", content: "reusable AD chain", scope: "global", sourceAgentRunId: "run_1" });
    expect(svc.listMemoryItems({ scope: "session" }).length).toBe(1);
    expect(svc.listMemoryItems({ scope: "engagement" }).length).toBe(1);
    expect(svc.listMemoryItems({ scope: "global" }).length).toBe(1);
  });

  test("provenance links round-trip through storage", () => {
    const item = svc.proposeMemory({
      type: "finding", content: "cred works", scope: "engagement",
      sourceSessionId: "s1", sourceAgentRunId: "run_1", sourceStepId: "step_1",
      sourceToolName: "nxc", sourceToolCallId: "tool_1", sourceEvidenceId: "ev_1", sourceBoardCardId: "card_1",
    });
    const fetched = svc.getMemory(item.id)!;
    expect(fetched.sourceAgentRunId).toBe("run_1");
    expect(fetched.sourceStepId).toBe("step_1");
    expect(fetched.sourceToolCallId).toBe("tool_1");
    expect(fetched.sourceEvidenceId).toBe("ev_1");
    expect(fetched.sourceBoardCardId).toBe("card_1");
  });
});
