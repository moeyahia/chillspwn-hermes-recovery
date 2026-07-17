import { describe, expect, test } from "bun:test";
import {
  contextualRunCommands,
  decisionCommand,
  JOURNEY_COMMANDS,
  memoryCommand,
  missionCommand,
  parsePaletteRoute,
  rankPaletteCommands,
  runCommand,
} from "../../app/command-palette/commandPaletteModel";
import { parseMissionPage } from "../../domain/schemas/commandOs";
import { parseRunPage } from "../../domain/schemas/runtimeV2";
import type { RuntimeRun } from "../../domain/types/runtimeV2";

function run(status: RuntimeRun["status"], journey: RuntimeRun["journey"] = "autonomous"): RuntimeRun {
  return {
    id: "run-credential-audit",
    missionId: "mission-credential-audit",
    missionName: "Credential audit",
    objective: "Validate the authorized test identity",
    journey,
    status,
    statusReason: null,
    progress: 0.4,
    nextAction: "Collect unique evidence",
    currentPlanId: "plan-1",
    currentStepId: "step-2",
    currentOwnerId: "CredSmith",
    lastHeartbeatAt: "2026-07-15T10:00:00.000Z",
    leaseExpiresAt: "2026-07-15T10:01:00.000Z",
    startedAt: "2026-07-15T09:00:00.000Z",
    endedAt: null,
    createdAt: "2026-07-15T09:00:00.000Z",
    updatedAt: "2026-07-15T10:00:00.000Z",
    version: 4,
  };
}

describe("Command Palette model", () => {
  test("exposes exactly the two product journeys", () => {
    expect(JOURNEY_COMMANDS.map((command) => command.label)).toEqual([
      "Go Autonomous",
      "Start Guided Mission",
    ]);
    expect(JOURNEY_COMMANDS.map((command) => command.path)).toEqual([
      "/missions/new/autonomous",
      "/missions/new/guided",
    ]);
  });

  test("derives only state-safe contextual run controls", () => {
    expect(contextualRunCommands(run("running")).map((command) => command.action)).toEqual(["pause", "cancel"]);
    expect(contextualRunCommands(run("blocked")).map((command) => command.action)).toEqual(["resume", "cancel"]);
    expect(contextualRunCommands(run("queued")).map((command) => command.action)).toEqual(["cancel"]);
    expect(contextualRunCommands(run("completed"))).toEqual([]);
    expect(contextualRunCommands(run("failed"))).toEqual([]);
    expect(contextualRunCommands(run("cancelled"))).toEqual([]);
    expect(contextualRunCommands(run("running"))[1]).toMatchObject({ danger: true, action: "cancel" });
  });

  test("parses mission and run routes without treating malformed encodings as context", () => {
    expect(parsePaletteRoute("/guided/mission-a")).toEqual({ missionId: "mission-a", guided: true });
    expect(parsePaletteRoute("/live/run-a")).toEqual({ runId: "run-a", guided: false });
    expect(parsePaletteRoute("/missions/mission-a/runs/run-a")).toEqual({ missionId: "mission-a", runId: "run-a", guided: false });
    expect(parsePaletteRoute("/guided/%E0%A4%A")).toEqual({ missionId: undefined, guided: true });
  });

  test("ranks exact entity labels ahead of keyword matches and keeps real deep links", () => {
    const commands = [
      missionCommand({ id: "mission-a", title: "Credential audit", journey: "guided", status: "active", updatedAt: "2026-07-15T00:00:00Z" }),
      runCommand(run("running")),
      decisionCommand({ id: "decision-a", missionId: "mission-a", runId: "run-a", stepId: "step-a", status: "pending", actionFingerprint: "f".repeat(64), requestedParameters: {}, rationale: "Review credential evidence", riskClass: "low", reversibility: "read only", expiresAt: "2026-07-16T00:00:00Z", createdAt: "2026-07-15T00:00:00Z" }),
      memoryCommand({ id: "memory-a", nodeType: "lesson", title: "Credential evidence", summary: "Retain unique evidence", scope: { kind: "mission", missionId: "mission-a" }, sensitivity: "private", confidence: 0.9, lifecycleStatus: "verified", confirmationState: "not_required", version: 1, pinned: false, createdAt: "2026-07-15T00:00:00Z", updatedAt: "2026-07-15T00:00:00Z", edgeCount: 2, sourceCount: 1 }),
    ];
    expect(rankPaletteCommands(commands, "Credential audit")[0]).toMatchObject({ kind: "mission", path: "/guided/mission-a" });
    expect(rankPaletteCommands(commands, "CredSmith")[0]).toMatchObject({ kind: "run", path: "/live/run-credential-audit" });
    expect(rankPaletteCommands(commands, "verified lesson")[0]).toMatchObject({ kind: "memory", path: "/brain/nodes/memory-a" });
    expect(rankPaletteCommands(commands, "does-not-exist")).toEqual([]);
  });

  test("validates bounded mission and run search projections", () => {
    expect(parseMissionPage({
      schemaVersion: "2.4",
      items: [{ id: "mission-a", title: "Mission A", journey: "autonomous", status: "running", updatedAt: "2026-07-15T00:00:00Z" }],
      nextCursor: null,
    }).items[0]).toMatchObject({ id: "mission-a", journey: "autonomous" });
    expect(parseRunPage({ schemaVersion: "2.4", items: [run("running")] }).items[0]).toMatchObject({ id: "run-credential-audit", status: "running" });
    expect(() => parseRunPage({ schemaVersion: "2.4", items: [{ ...run("running"), journey: "direct" }] })).toThrow("journey is invalid");
  });
});
