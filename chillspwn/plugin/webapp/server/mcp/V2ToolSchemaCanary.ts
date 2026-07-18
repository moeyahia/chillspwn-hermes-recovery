import {
  McpToolInputValidationError,
  normalizeAndValidateMcpToolInput,
} from "./McpToolInputSchema";

export interface V2ToolSchemaCanaryResult {
  readonly validInput: Readonly<Record<string, unknown>>;
  readonly invalidInputCategory: "invalid_input";
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringFixture(name: string, schema: Record<string, unknown>): string {
  if (typeof schema.default === "string") return schema.default;
  if (Array.isArray(schema.examples) && typeof schema.examples[0] === "string") return schema.examples[0];
  if (Array.isArray(schema.enum) && typeof schema.enum[0] === "string") return schema.enum[0];
  const lower = name.toLocaleLowerCase("en-US");
  let value = lower.includes("cve") ? "CVE-2025-12345"
    : lower.includes("address") ? "0x1000"
      : lower.includes("file_path") || lower === "path" ? "/fixture/disposable.bin"
        : lower.includes("expression") ? "1 + 1"
          : lower.includes("prototype") ? "int fixture(void)"
            : lower.includes("keyword") ? "fixture-package"
              : lower.includes("url") ? "http://127.0.0.1:1/fixture"
                : `fixture-${name.replace(/[^A-Za-z0-9]+/gu, "-")}`;
  const minimum = typeof schema.minLength === "number" ? Math.max(0, schema.minLength) : 0;
  if (value.length < minimum) value = value.padEnd(minimum, "x");
  if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
    value = value.slice(0, schema.maxLength);
  }
  if (typeof schema.pattern === "string") {
    let pattern: RegExp;
    try { pattern = new RegExp(schema.pattern, "u"); }
    catch { throw new Error(`Cannot generate a canary for ${name}: invalid schema pattern`); }
    if (!pattern.test(value)) {
      throw new Error(`Cannot generate a local schema canary for ${name}: pattern requires a reviewed fixture`);
    }
  }
  return value;
}

function minimalValue(name: string, schema: Record<string, unknown>): unknown {
  if (Object.prototype.hasOwnProperty.call(schema, "const")) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.oneOf) && object(schema.oneOf[0])) return minimalValue(name, schema.oneOf[0]);
  if (Array.isArray(schema.anyOf) && object(schema.anyOf[0])) return minimalValue(name, schema.anyOf[0]);
  const type = typeof schema.type === "string"
    ? schema.type
    : Array.isArray(schema.type) && typeof schema.type[0] === "string"
      ? schema.type[0]
      : schema.properties !== undefined ? "object" : "string";
  if (type === "string") return stringFixture(name, schema);
  if (type === "boolean") return false;
  if (type === "integer" || type === "number") {
    const lower = typeof schema.minimum === "number" ? schema.minimum : 0;
    const upper = typeof schema.maximum === "number" ? schema.maximum : lower;
    const value = Math.min(lower, upper);
    return type === "integer" ? Math.ceil(value) : value;
  }
  if (type === "array") {
    const minimum = typeof schema.minItems === "number" ? Math.max(0, schema.minItems) : 0;
    const itemSchema = object(schema.items) ? schema.items : { type: "string" };
    return Array.from({ length: minimum }, (_unused, index) => minimalValue(`${name}_${index}`, itemSchema));
  }
  if (type === "object") return minimalObject(schema);
  if (type === "null") return null;
  throw new Error(`Cannot generate a local canary for unsupported schema type ${type}`);
}

function minimalObject(schema: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const properties = object(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((value): value is string => typeof value === "string")
    : [];
  const result: Record<string, unknown> = {};
  for (const name of required) {
    const property = properties[name];
    if (!object(property)) throw new Error(`Required property ${name} has no usable schema`);
    result[name] = minimalValue(name, property);
  }
  return result;
}

/**
 * Execute a no-network positive and negative canary against one fresh
 * tools/list schema. This proves the V2 boundary can accept a minimal exact
 * payload and reject a non-object payload before tools/call. It does not claim
 * the underlying vendor implementation succeeded.
 */
export function runV2ToolSchemaCanary(
  schema: Readonly<Record<string, unknown>>,
): V2ToolSchemaCanaryResult {
  const validInput = minimalObject(schema as Record<string, unknown>);
  normalizeAndValidateMcpToolInput(validInput, schema);
  try {
    normalizeAndValidateMcpToolInput("invalid-non-object-canary", schema);
  } catch (error) {
    if (error instanceof McpToolInputValidationError && error.code === "mcp_tool_input_invalid") {
      return { validInput, invalidInputCategory: "invalid_input" };
    }
    throw error;
  }
  throw new Error("The MCP input boundary accepted the invalid non-object canary");
}
