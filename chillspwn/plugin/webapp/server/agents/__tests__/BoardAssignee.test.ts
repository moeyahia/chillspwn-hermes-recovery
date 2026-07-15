import { describe, expect, test } from "bun:test";
import { canonicalBoardAssignee } from "../BoardAssignee";

const columns = [
  { persona: "ChillsPwn", is_backlog: 1 },
  { persona: "Coder", is_backlog: 0 },
  { persona: "SessionRunner", is_backlog: 0 },
];

describe("Mission Board assignee boundary", () => {
  test("normalizes every commander/self spelling to the non-executing backlog", () => {
    for (const value of ["self", " SELF ", "plan", "__plan__", "chillspwn", " ChIlLsPwN "]) {
      expect(canonicalBoardAssignee(value, columns)).toBe("ChillsPwn");
    }
  });

  test("canonicalizes real specialists case-insensitively", () => {
    expect(canonicalBoardAssignee(" coder ", columns)).toBe("Coder");
    expect(canonicalBoardAssignee("SESSIONRUNNER", columns)).toBe("SessionRunner");
  });

  test("rejects unknown or empty assignees instead of falling into a generic runner", () => {
    expect(canonicalBoardAssignee("not-a-specialist", columns)).toBeNull();
    expect(canonicalBoardAssignee("", columns)).toBeNull();
  });
});
