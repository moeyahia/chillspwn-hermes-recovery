import { describe, expect, test } from "bun:test";
import {
  missionBoardLane,
  missionPortfolioStateToUrl,
  parseMissionPortfolioState,
  parseSavedMissionViews,
  serializeSavedMissionViews,
} from "../../features/missions/missionPortfolioState";
import {
  parseMissionBulkArchive,
  parseMissionBulkExport,
  parseSavedMissionViewCollection,
} from "../../domain/schemas/commandOs";

describe("mission portfolio state", () => {
  test("keeps only the two public journeys and bounded filters", () => {
    expect(parseMissionPortfolioState({ journey: "autonomous", view: "board", query: "  CredSmith " })).toEqual({
      journey: "autonomous",
      view: "board",
      query: "CredSmith",
      status: "",
      engagement: "",
      target: "",
      agent: "",
      provider: "",
      updatedFrom: "",
      updatedTo: "",
      risk: "",
      evidence: "",
      findingSeverity: "",
      decisionState: "",
      recoveryState: "",
    });
    expect(parseMissionPortfolioState({ journey: "provider-direct", view: "desktop" }).journey).toBe("");
  });

  test("round trips safe saved views and ignores malformed records", () => {
    const raw = serializeSavedMissionViews([{
      id: "view-1",
      name: "Recovering Autonomous",
      state: parseMissionPortfolioState({ journey: "autonomous", status: "recovering" }),
      createdAt: "2026-07-15T00:00:00.000Z",
    }]);
    expect(parseSavedMissionViews(raw)).toHaveLength(1);
    expect(parseSavedMissionViews("not-json")).toEqual([]);
    expect(parseSavedMissionViews(JSON.stringify([{ id: "../bad", name: "Bad", createdAt: "today" }]))).toEqual([]);
  });

  test("uses shareable URL state and deterministic board lanes", () => {
    expect(missionPortfolioStateToUrl(parseMissionPortfolioState({ journey: "guided", status: "blocked" }))).toEqual({
      query: undefined,
      journey: "guided",
      status: "blocked",
      engagement: undefined,
      target: undefined,
      agent: undefined,
      provider: undefined,
      updatedFrom: undefined,
      updatedTo: undefined,
      risk: undefined,
      evidence: undefined,
      findingSeverity: undefined,
      decisionState: undefined,
      recoveryState: undefined,
      view: undefined,
    });
    expect(missionBoardLane("recovering")).toBe("attention");
    expect(missionBoardLane("running")).toBe("active");
    expect(missionBoardLane("completed")).toBe("finished");
  });

  test("validates synchronized views and bounded bulk response policy", () => {
    const state = parseMissionPortfolioState({ journey: "guided", evidence: "present", view: "board" });
    expect(parseSavedMissionViewCollection({
      schemaVersion: "2.1",
      version: 1,
      items: [{ id: "view-1", name: "Evidence", state, createdAt: "2026-07-15T00:00:00Z", updatedAt: "2026-07-15T00:00:00Z" }],
    })).toMatchObject({ version: 1, items: [{ state: { journey: "guided", evidence: "present", view: "board" } }] });
    expect(parseMissionBulkArchive({
      schemaVersion: "2.1", selectionHash: "a".repeat(64), archivedCount: 1,
      outcomes: [{ missionId: "mission-1", status: "archived", reason: "terminal" }],
    }).archivedCount).toBe(1);
    expect(parseMissionBulkExport({
      schemaVersion: "2.1", generatedAt: "2026-07-15T00:00:00Z",
      selectionHash: "a".repeat(64), exportSha256: "b".repeat(64), records: [], outcomes: [],
      policy: { maxBatch: 50, evidenceBlobsIncluded: false, confidentialPayloadsIncluded: false, titlePreviewLimit: 120 },
    }).policy.evidenceBlobsIncluded).toBeFalse();
    expect(() => parseMissionBulkExport({
      schemaVersion: "2.1", generatedAt: "2026-07-15T00:00:00Z",
      selectionHash: "a".repeat(64), exportSha256: "b".repeat(64), records: [], outcomes: [],
      policy: { maxBatch: 50, evidenceBlobsIncluded: true, confidentialPayloadsIncluded: false, titlePreviewLimit: 120 },
    })).toThrow("must exclude evidence");
  });
});
