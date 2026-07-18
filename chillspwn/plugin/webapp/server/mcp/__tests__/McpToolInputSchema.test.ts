import { describe, expect, test } from "bun:test";
import {
  McpToolInputValidationError,
  normalizeAndValidateMcpToolInput,
} from "../McpToolInputSchema";

const CVE_SCHEMA = {
  type: "object",
  properties: {
    cve_id: { type: "string", pattern: "^CVE-\\d{4}-\\d{4,}$" },
  },
  required: ["cve_id"],
  additionalProperties: false,
} as const;

describe("MCP tool input schema boundary", () => {
  test("maps only a unique schema-equivalent key to its canonical property", () => {
    expect(normalizeAndValidateMcpToolInput({ cveId: "CVE-2025-13583" }, CVE_SCHEMA)).toEqual({
      arguments: { cve_id: "CVE-2025-13583" },
      aliases: [{ from: "cveId", to: "cve_id", path: "arguments" }],
    });
  });

  test("rejects unresolved planner placeholders before an MCP call", () => {
    expect(() => normalizeAndValidateMcpToolInput(
      { cveId: "OPAQUE_TOP_CVE_ID_FROM_STEP_0" },
      CVE_SCHEMA,
    )).toThrow(McpToolInputValidationError);
    try {
      normalizeAndValidateMcpToolInput({ cveId: "OPAQUE_TOP_CVE_ID_FROM_STEP_0" }, CVE_SCHEMA);
    } catch (error) {
      expect(error).toMatchObject({
        code: "mcp_tool_input_placeholder",
        path: "arguments.cve_id",
      });
    }
    expect(() => normalizeAndValidateMcpToolInput(
      { nested: { values: ["OPAQUE_TARGET_FROM_STEP_0"] } },
      { type: "object", additionalProperties: true },
    )).toThrow("arguments.nested.values[0] contains an unresolved planner placeholder");
  });

  test("rejects missing, malformed, unknown, and ambiguous arguments", () => {
    expect(() => normalizeAndValidateMcpToolInput({}, CVE_SCHEMA)).toThrow("arguments.cve_id is required");
    expect(() => normalizeAndValidateMcpToolInput({ cve_id: "not-a-cve" }, CVE_SCHEMA))
      .toThrow("does not match the tool schema pattern");
    expect(() => normalizeAndValidateMcpToolInput({ cve_id: "CVE-2025-13583", extra: true }, CVE_SCHEMA))
      .toThrow("is not declared by the tool schema");
    expect(() => normalizeAndValidateMcpToolInput(
      { cve_id: "CVE-2025-13583", cveId: "CVE-2025-13584" },
      CVE_SCHEMA,
    )).toThrow("duplicates canonical property cve_id");
  });
});
