import { describe, expect, test } from "bun:test";
import { boundedPositiveInteger, safeEngagementName, safeSessionId } from "../identifiers";

describe("safeSessionId", () => {
  test("accepts dashboard, worker, and provider identifiers", () => {
    expect(safeSessionId("s-1720000000000-deadbeef")).toBe("s-1720000000000-deadbeef");
    expect(safeSessionId("card-task_42")).toBe("card-task_42");
    expect(safeSessionId("019f506f-da43-7d22-8970-caeaea1e6c95")).toBe("019f506f-da43-7d22-8970-caeaea1e6c95");
  });

  test("rejects traversal, separators, controls, whitespace, and oversized IDs", () => {
    for (const value of ["../auth", "a/b", "a\\b", "x\nnext", "two words", "..", "a".repeat(129)]) {
      expect(() => safeSessionId(value)).toThrow();
    }
  });
});

test("engagement names reject header and path metacharacters", () => {
  expect(safeEngagementName("client-lab_01")).toBe("client-lab_01");
  for (const value of ['client"lab', "client\r\nX-Test: yes", "client lab", "../client"]) {
    expect(() => safeEngagementName(value)).toThrow();
  }
});

describe("boundedPositiveInteger", () => {
  test("normalizes invalid values and caps valid values", () => {
    expect(boundedPositiveInteger("25", 50, 200)).toBe(25);
    expect(boundedPositiveInteger("999", 50, 200)).toBe(200);
    expect(boundedPositiveInteger("-1", 50, 200)).toBe(50);
    expect(boundedPositiveInteger("Infinity", 50, 200)).toBe(50);
    expect(boundedPositiveInteger("1.5", 50, 200)).toBe(50);
  });
});
