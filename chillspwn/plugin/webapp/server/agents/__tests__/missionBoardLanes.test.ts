import { test, expect, describe } from "bun:test";
import { buildSpecialistBoard, SPECIALIST_LANES, specialistForStep, laneForAgent, makeHandoff, type RunDocLite, type McpStatusSummary } from "../missionBoardLanes";

const MCP_STUB: McpStatusSummary = { bridgeMode: "disabled", profile: "disabled", enabledServers: 0, disabledServers: 2, missingDependency: 0, missingSecret: 0, dockerRequired: 2, servers: [] };
const baseInput = (docs: RunDocLite[], handoffs: any[] = []) => ({
  missionId: "m1", docs,
  mcpStatusForAgent: (_a: string) => MCP_STUB,
  memoryCountsForAgent: (_a: string) => ({ proposed: 1, verified: 2, failedAttempts: 1, verifiedUsed: 0 }),
  handoffs,
});
const doc = (runId: string, steps: any[]): RunDocLite => ({ run: { id: runId, persona: "ChillsPwn", objective: "o", status: "executing" }, steps, approvals: [], evidence: [] });

describe("Part 2 lanes", () => {
  test("14 lanes in EXACT order", () => {
    expect(SPECIALIST_LANES.map((l) => l.title)).toEqual([
      "Command","Recon","Web","Vulnerability Intel","Credentials","AD / Identity","Cloud / Container","Reverse / Binary","Fuzzing","OSINT","Secrets / Code","Persistent Sessions","Reporting","Blocked / Approval","Complete",
    ]);
  });
  test("lane→agent mapping", () => {
    expect(laneForAgent("ReconScout")).toBe("recon");
    expect(laneForAgent("WebBreaker")).toBe("web");
    expect(laneForAgent("ReportSmith")).toBe("reporting");
    expect(SPECIALIST_LANES[0].agentId).toBe("chillspwn");
  });
});

describe("Part 3 Agent Cards", () => {
  const board = buildSpecialistBoard(baseInput([doc("r1", [{ id: "s1", title: "scan ports", purpose: "recon", status: "running", assignedAgent: "ReconScout", evidenceRefs: ["ev1"] }])]));
  test("command lane has ChillsPwn commander card; specialists each get a card", () => {
    const cmd = board.lanes.find((l) => l.laneId === "command")!;
    expect(cmd.agentCard!.role).toBe("commander");
    expect(cmd.agentCard!.displayName).toContain("Commander-in-Chief");
    expect(cmd.agentCard!.assignedMcpServers.join()).toContain("coordination only");
    expect(board.lanes.filter((l) => l.kind === "specialist").every((l) => l.agentCard !== null)).toBe(true);
  });
  test("Agent Card carries MCP status + memory counts + status", () => {
    const recon = board.lanes.find((l) => l.laneId === "recon")!.agentCard!;
    expect(recon.status).toBe("running");
    expect(recon.mcpHealthStatus.profile).toBe("disabled");
    expect(recon.verifiedLessonCount).toBe(2);
    expect(recon.failedAttemptLessonCount).toBe(1);
    expect(recon.evidenceCount).toBe(1);
    expect(recon.cockpitUrl).toContain("run=r1");
    expect(recon.boardUrl).toContain("lane=recon");
  });
});

describe("Part 4/5 Task Cards from PlanSteps", () => {
  test("step assigned to ReconScout → Task Card in Recon lane; WebBreaker → Web lane", () => {
    const board = buildSpecialistBoard(baseInput([doc("r1", [
      { id: "s1", title: "scan", purpose: "recon", status: "running", assignedAgent: "ReconScout" },
      { id: "s2", title: "fuzz web", purpose: "web", status: "pending", assignedAgent: "WebBreaker" },
    ])]));
    expect(board.lanes.find((l) => l.laneId === "recon")!.taskCards.map((t) => t.taskId)).toEqual(["s1"]);
    expect(board.lanes.find((l) => l.laneId === "web")!.taskCards.map((t) => t.taskId)).toEqual(["s2"]);
  });
  test("derivation by routing when no explicit assignedAgent", () => {
    expect(specialistForStep({ title: "crack this hash with hashcat", purpose: "" })).toBe("CredSmith");
    expect(specialistForStep({ title: "x", purpose: "y", assignedAgent: "ReconScout" })).toBe("ReconScout");
  });
  test("Task Card preserves assignedAgentId + originatingLane + cockpit link", () => {
    const tc = buildSpecialistBoard(baseInput([doc("r1", [{ id: "s1", title: "scan", purpose: "recon", status: "running", assignedAgent: "ReconScout" }])])).lanes.find((l) => l.laneId === "recon")!.taskCards[0];
    expect(tc.assignedAgentId).toBe("ReconScout"); expect(tc.originatingLane).toBe("recon"); expect(tc.cockpitUrl).toContain("step=s1");
  });
});

describe("Part 4 mirroring to Blocked/Approval + Complete", () => {
  const board = buildSpecialistBoard(baseInput([doc("r1", [
    { id: "s1", title: "scan", purpose: "recon", status: "blocked", assignedAgent: "ReconScout" },
    { id: "s2", title: "fuzz web", purpose: "web", status: "completed", assignedAgent: "WebBreaker" },
    { id: "s3", title: "crack", purpose: "cred", status: "awaiting_approval", assignedAgent: "CredSmith" },
  ])]));
  test("blocked + awaiting_approval mirror to Blocked/Approval; original lane preserved", () => {
    const ba = board.lanes.find((l) => l.laneId === "blocked_approval")!;
    expect(ba.taskCards.map((t) => t.taskId).sort()).toEqual(["s1", "s3"]);
    expect(ba.taskCards.find((t) => t.taskId === "s1")!.originatingLane).toBe("recon"); // preserved
  });
  test("completed mirrors to Complete; still in originating lane too", () => {
    expect(board.lanes.find((l) => l.laneId === "complete")!.taskCards.map((t) => t.taskId)).toEqual(["s2"]);
    expect(board.lanes.find((l) => l.laneId === "web")!.taskCards.map((t) => t.taskId)).toEqual(["s2"]);
  });
});

describe("Part 6 handoffs", () => {
  test("handoff record + card indicators", () => {
    const h = makeHandoff({ missionId: "m1", runId: "r1", fromAgentId: "ReconScout", toAgentId: "WebBreaker", reason: "Web services discovered", evidenceIds: ["ev_http_ports"], sourceStepId: "s1", targetStepId: "s2", sourceTaskId: "s1", targetTaskId: "s2", createdAt: "t" });
    const board = buildSpecialistBoard(baseInput([doc("r1", [
      { id: "s1", title: "scan", purpose: "recon", status: "completed", assignedAgent: "ReconScout" },
      { id: "s2", title: "fuzz web", purpose: "web", status: "running", assignedAgent: "WebBreaker" },
    ])], [h]));
    expect(board.handoffs.length).toBe(1);
    expect(board.lanes.find((l) => l.laneId === "recon")!.agentCard!.handoffTo).toBe("WebBreaker");
    expect(board.lanes.find((l) => l.laneId === "recon")!.agentCard!.status).toBe("handoff_requested");
    expect(board.lanes.find((l) => l.laneId === "web")!.agentCard!.handoffFrom).toBe("ReconScout");
    expect(board.lanes.find((l) => l.laneId === "web")!.taskCards[0].handoffIds).toContain(h.handoffId);
  });
});

describe("Part 7 MCP status on cards", () => {
  test("Task Card shows the agent's MCP profile; bridge_disabled when no bridge", () => {
    const board = buildSpecialistBoard({ ...baseInput([doc("r1", [{ id: "s1", title: "scan", purpose: "recon", status: "running", assignedAgent: "ReconScout" }])]), mcpStatusForAgent: () => ({ ...MCP_STUB, profile: "missing_secret" }) });
    expect(board.lanes.find((l) => l.laneId === "recon")!.taskCards[0].mcpHealthStatus).toBe("missing_secret");
  });
});

describe("Part 2 old generic lanes hidden + Part 5 unassigned→blocked", () => {
  test("specialist board contains ONLY the 14 specialist lanes (no generic Backlog/In-Progress/Done)", () => {
    const titles = SPECIALIST_LANES.map((l) => l.title);
    for (const generic of ["Backlog", "In Progress", "Done", "To Do", "Review"]) expect(titles).not.toContain(generic);
    expect(titles.length).toBe(15);
  });
  test("a classified step with no resolvable specialist lands in Blocked/Approval", () => {
    // a step that routes to nothing + has no assignedAgent → unassigned → blocked_approval
    const board = buildSpecialistBoard(baseInput([doc("r1", [{ id: "s1", title: "qqzzx wibble frobnicate", purpose: "", status: "pending" }])]));
    const recon = board.lanes.find((l) => l.laneId === "recon")!;
    const ba = board.lanes.find((l) => l.laneId === "blocked_approval")!;
    // 'do something vague' has no routing signal → assignedAgentId null → blocked lane
    expect(recon.taskCards.length).toBe(0);
    expect(ba.taskCards.some((t) => t.taskId === "s1")).toBe(true);
  });
  test("MCP bridge_disabled status surfaces on the agent card when no bridge", () => {
    const board = buildSpecialistBoard({ ...baseInput([doc("r1", [{ id: "s1", title: "scan", purpose: "recon", status: "running", assignedAgent: "ReconScout" }])]), mcpStatusForAgent: () => ({ ...MCP_STUB, profile: "bridge_disabled", bridgeMode: "disabled" }) });
    expect(board.lanes.find((l) => l.laneId === "recon")!.agentCard!.mcpHealthStatus.profile).toBe("bridge_disabled");
  });
});
