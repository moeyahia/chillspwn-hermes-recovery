import { describe, expect, test } from "bun:test";
import { sanitizeJsonWithRedaction } from "../validation";

describe("operations projection redaction", () => {
  test("combines known-secret defense with bounded producer-declared paths", () => {
    expect(sanitizeJsonWithRedaction({
      credential: "do-not-project",
      opaque: { nested: "also-do-not-project", retained: "safe semantic value" },
    }, {
      paths: ["opaque.nested"],
    })).toEqual({
      credential: "[REDACTED]",
      opaque: { nested: "[REDACTED]", retained: "safe semantic value" },
    });
  });
});
