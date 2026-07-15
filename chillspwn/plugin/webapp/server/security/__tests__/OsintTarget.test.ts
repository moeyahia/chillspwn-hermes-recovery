import { describe, expect, test } from "bun:test";
import { normalizeOsintTarget, shellQuote } from "../OsintTarget";

describe("normalizeOsintTarget", () => {
  test("normalizes supported target types", () => {
    expect(normalizeOsintTarget("Example.COM.", "domain")).toBe("example.com");
    expect(normalizeOsintTarget("192.0.2.10", "ip")).toBe("192.0.2.10");
    expect(normalizeOsintTarget("Analyst+lab@Example.com", "email")).toBe("Analyst+lab@example.com");
    expect(normalizeOsintTarget("Ada Lovelace", "person")).toBe("Ada Lovelace");
    expect(normalizeOsintTarget("Acme Security Labs", "company")).toBe("Acme Security Labs");
  });

  test("rejects prompt and shell control characters", () => {
    for (const target of ["example.com\nrm -rf /", "example.com;id", "$(id).example.com", "a/b.example.com"]) {
      expect(() => normalizeOsintTarget(target, "domain")).toThrow();
    }
    expect(() => normalizeOsintTarget("Acme && id", "company")).toThrow();
  });
});

test("shellQuote produces one inert POSIX argument", () => {
  expect(shellQuote("O'Reilly")).toBe("'O'\"'\"'Reilly'");
});
