import { describe, expect, test } from "bun:test";
import {
  missionWorkspaceTabFromSearch,
  missionWorkspaceTabs,
  resolveMissionWorkspaceTab,
  searchForMissionWorkspaceTab,
} from "../../features/missions/missionWorkspaceModel";

describe("durable Mission Workspace tabs", () => {
  test("exposes Live only for Autonomous and Guide only for Guided", () => {
    const autonomous = missionWorkspaceTabs("autonomous").map((tab) => tab.id);
    const guided = missionWorkspaceTabs("guided").map((tab) => tab.id);

    expect(autonomous).toEqual([
      "summary", "plan", "live", "evidence", "findings", "conversation", "brain", "learning", "history", "settings",
    ]);
    expect(guided).toEqual([
      "summary", "plan", "guide", "evidence", "findings", "conversation", "brain", "learning", "history", "settings",
    ]);
    expect(autonomous).not.toContain("guide");
    expect(guided).not.toContain("live");
  });

  test("defaults missing or invalid URL state to Summary", () => {
    expect(missionWorkspaceTabFromSearch("", "autonomous")).toBe("summary");
    expect(missionWorkspaceTabFromSearch("?tab=unknown", "guided")).toBe("summary");
    expect(resolveMissionWorkspaceTab(null, "guided")).toBe("summary");
  });

  test("restores a valid tab from a copied URL and maps journey aliases safely", () => {
    expect(missionWorkspaceTabFromSearch("?tab=evidence", "autonomous")).toBe("evidence");
    expect(missionWorkspaceTabFromSearch("tab=history", "guided")).toBe("history");
    expect(missionWorkspaceTabFromSearch("?tab=live", "guided")).toBe("guide");
    expect(missionWorkspaceTabFromSearch("?tab=guide", "autonomous")).toBe("live");
  });

  test("writes canonical tab search state without discarding unrelated parameters", () => {
    expect(searchForMissionWorkspaceTab("?trace=trace%3A1", "evidence", "guided")).toBe("?trace=trace%3A1&tab=evidence");
    expect(searchForMissionWorkspaceTab("?trace=trace%3A1&tab=live", "summary", "guided")).toBe("?trace=trace%3A1");
    expect(searchForMissionWorkspaceTab("?tab=live", "live", "guided")).toBe("?tab=guide");
  });
});
