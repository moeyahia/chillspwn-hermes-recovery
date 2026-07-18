import { describe, expect, test } from "bun:test";
import { runRepresentativeMissionBenchmarks } from "../../../scripts/command-os-v2/measure-mission-benchmarks";

describe("representative mission benchmark suite", () => {
  test("compares synthetic Autonomous and Guided fixtures using canonical evaluation logic", () => {
    const results = runRepresentativeMissionBenchmarks();
    expect(results.map((result) => result.journey).sort()).toEqual(["autonomous", "guided"]);
    expect(results.every((result) => result.passed)).toBe(true);
    for (const result of results) {
      expect(result.comparison.status).toBe("available");
      expect(result.comparison.basis).toBe("same_mission_and_journey");
      expect(result.missingFavorableMetrics).toEqual([]);
      expect(result.unexpectedUnfavorableMetrics).toEqual([]);
      expect(result.comparison.summary).toContain("does not establish that the system improved");
    }
  });
});
