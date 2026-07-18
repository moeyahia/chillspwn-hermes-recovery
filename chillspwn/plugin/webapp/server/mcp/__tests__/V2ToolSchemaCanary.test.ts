import { describe, expect, test } from "bun:test";
import { runV2ToolSchemaCanary } from "../V2ToolSchemaCanary";

describe("V2 tool schema no-network canary", () => {
  test("generates and validates the exact snake_case NVD argument", () => {
    const result = runV2ToolSchemaCanary({
      type: "object",
      properties: {
        cve_id: { type: "string", pattern: "^CVE-\\d{4}-\\d{4,}$" },
      },
      required: ["cve_id"],
      additionalProperties: false,
    });
    expect(result).toEqual({
      validInput: { cve_id: "CVE-2025-12345" },
      invalidInputCategory: "invalid_input",
    });
  });

  test("supports empty and typed required schemas without executing a tool", () => {
    expect(runV2ToolSchemaCanary({ type: "object", properties: {} }).validInput).toEqual({});
    expect(runV2ToolSchemaCanary({
      type: "object",
      properties: {
        address: { type: "string" },
        level: { type: "integer", minimum: 0, maximum: 4 },
      },
      required: ["address", "level"],
    }).validInput).toEqual({ address: "0x1000", level: 0 });
  });
});
