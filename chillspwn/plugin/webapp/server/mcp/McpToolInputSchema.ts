/**
 * Minimal, fail-closed validation for the JSON-Schema subset exposed by MCP
 * tools/list. The runtime deliberately does not depend on provider prose for
 * argument names: only a unique, punctuation/case-insensitive match to an
 * exact schema property may be normalized (for example cveId -> cve_id).
 */

export interface McpToolInputAlias {
  readonly from: string;
  readonly to: string;
  readonly path: string;
}

export interface NormalizedMcpToolInput {
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly aliases: readonly McpToolInputAlias[];
}

export class McpToolInputValidationError extends Error {
  constructor(
    readonly code:
      | "mcp_tool_schema_invalid"
      | "mcp_tool_input_invalid"
      | "mcp_tool_input_placeholder"
      | "mcp_tool_input_alias_ambiguous"
      | "mcp_tool_action_binding_mismatch",
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = "McpToolInputValidationError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalPropertyName(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/gu, "").toLowerCase();
}

function placeholder(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  return /^(?:<[^<>]{1,200}>|\$\{[^{}]{1,200}\}|\{\{[^{}]{1,200}\}\})$/u.test(normalized)
    || /^(?:replace[_ -]?me|placeholder|tbd|todo|your[_ -][a-z0-9_ -]+)$/iu.test(normalized)
    || /^opaque_[A-Z0-9_]{3,}$/u.test(normalized)
    || /^[A-Z][A-Z0-9_]{5,}_FROM_STEP_[0-9]+$/u.test(normalized);
}

function assertConcreteInput(
  value: unknown,
  path: string,
  state: { readonly seen: WeakSet<object>; nodes: number },
  depth = 0,
): void {
  state.nodes += 1;
  if (state.nodes > 10_000 || depth > 64) {
    throw new McpToolInputValidationError(
      "mcp_tool_input_invalid",
      "MCP tool arguments exceed the bounded validation depth or size",
      path,
    );
  }
  if (typeof value === "string" && placeholder(value)) {
    throw new McpToolInputValidationError(
      "mcp_tool_input_placeholder",
      `${path} contains an unresolved planner placeholder`,
      path,
    );
  }
  if (!value || typeof value !== "object") return;
  if (state.seen.has(value)) {
    throw new McpToolInputValidationError(
      "mcp_tool_input_invalid",
      "MCP tool arguments must be an acyclic JSON object",
      path,
    );
  }
  state.seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertConcreteInput(item, `${path}[${index}]`, state, depth + 1));
  } else if (record(value)) {
    Object.entries(value).forEach(([name, item]) => {
      assertConcreteInput(item, `${path}.${name}`, state, depth + 1);
    });
  }
  state.seen.delete(value);
}

function schemaTypes(schema: Record<string, unknown>): readonly string[] {
  if (typeof schema.type === "string") return [schema.type];
  if (Array.isArray(schema.type) && schema.type.every((item) => typeof item === "string")) {
    return schema.type as string[];
  }
  return [];
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return record(value);
  if (type === "integer") return typeof value === "number" && Number.isSafeInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function assertSchemaArray(value: unknown, label: string, path: string): readonly Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every(record)) {
    throw new McpToolInputValidationError("mcp_tool_schema_invalid", `${label} must contain schema objects`, path);
  }
  return value;
}

function validateCombinators(
  value: unknown,
  schema: Record<string, unknown>,
  path: string,
  aliases: McpToolInputAlias[],
): unknown {
  if (schema.allOf !== undefined) {
    let normalized = value;
    for (const candidate of assertSchemaArray(schema.allOf, "allOf", path)) {
      normalized = validateValue(normalized, candidate, path, aliases);
    }
    value = normalized;
  }
  for (const key of ["anyOf", "oneOf"] as const) {
    if (schema[key] === undefined) continue;
    const candidates = assertSchemaArray(schema[key], key, path);
    const accepted: Array<{ value: unknown; aliases: McpToolInputAlias[] }> = [];
    for (const candidate of candidates) {
      const localAliases: McpToolInputAlias[] = [];
      try {
        accepted.push({ value: validateValue(value, candidate, path, localAliases), aliases: localAliases });
      } catch (error) {
        if (!(error instanceof McpToolInputValidationError)) throw error;
      }
    }
    if (accepted.length === 0 || (key === "oneOf" && accepted.length !== 1)) {
      throw new McpToolInputValidationError(
        "mcp_tool_input_invalid",
        `${path} does not satisfy the tool's ${key} contract`,
        path,
      );
    }
    aliases.push(...accepted[0]!.aliases);
    value = accepted[0]!.value;
  }
  return value;
}

function validateObject(
  value: Record<string, unknown>,
  schema: Record<string, unknown>,
  path: string,
  aliases: McpToolInputAlias[],
): Readonly<Record<string, unknown>> {
  const rawProperties = schema.properties ?? {};
  if (!record(rawProperties)) {
    throw new McpToolInputValidationError("mcp_tool_schema_invalid", "Tool schema properties must be an object", path);
  }
  const properties = rawProperties as Record<string, unknown>;
  for (const [name, child] of Object.entries(properties)) {
    if (!record(child)) {
      throw new McpToolInputValidationError("mcp_tool_schema_invalid", `Schema property ${name} is invalid`, path);
    }
  }
  const normalizedIndex = new Map<string, string[]>();
  for (const name of Object.keys(properties)) {
    const key = canonicalPropertyName(name);
    normalizedIndex.set(key, [...(normalizedIndex.get(key) ?? []), name]);
  }

  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [inputName, inputValue] of Object.entries(value)) {
    let propertyName = inputName;
    if (!Object.prototype.hasOwnProperty.call(properties, inputName)) {
      const candidates = normalizedIndex.get(canonicalPropertyName(inputName)) ?? [];
      if (candidates.length > 1) {
        throw new McpToolInputValidationError(
          "mcp_tool_input_alias_ambiguous",
          `${path}.${inputName} matches more than one schema property`,
          `${path}.${inputName}`,
        );
      }
      if (candidates.length === 1) propertyName = candidates[0]!;
    }
    if (Object.prototype.hasOwnProperty.call(output, propertyName)) {
      throw new McpToolInputValidationError(
        "mcp_tool_input_alias_ambiguous",
        `${path}.${inputName} duplicates canonical property ${propertyName}`,
        `${path}.${inputName}`,
      );
    }
    if (propertyName !== inputName) aliases.push({ from: inputName, to: propertyName, path });

    const childSchema = properties[propertyName];
    if (record(childSchema)) {
      output[propertyName] = validateValue(inputValue, childSchema, `${path}.${propertyName}`, aliases);
      continue;
    }
    if (schema.additionalProperties === false) {
      throw new McpToolInputValidationError(
        "mcp_tool_input_invalid",
        `${path}.${inputName} is not declared by the tool schema`,
        `${path}.${inputName}`,
      );
    }
    if (record(schema.additionalProperties)) {
      output[propertyName] = validateValue(inputValue, schema.additionalProperties, `${path}.${propertyName}`, aliases);
    } else {
      output[propertyName] = inputValue;
    }
  }

  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || !schema.required.every((item) => typeof item === "string")) {
      throw new McpToolInputValidationError("mcp_tool_schema_invalid", "Tool schema required must be a string array", path);
    }
    for (const required of schema.required as string[]) {
      if (!Object.prototype.hasOwnProperty.call(output, required)) {
        throw new McpToolInputValidationError(
          "mcp_tool_input_invalid",
          `${path}.${required} is required by the tool schema`,
          `${path}.${required}`,
        );
      }
    }
  }
  return output;
}

function validateValue(
  initial: unknown,
  schema: Record<string, unknown>,
  path: string,
  aliases: McpToolInputAlias[],
): unknown {
  if (schema.$ref !== undefined) {
    throw new McpToolInputValidationError(
      "mcp_tool_schema_invalid",
      "External or unresolved schema references are not executable at the MCP boundary",
      path,
    );
  }
  let value = validateCombinators(initial, schema, path, aliases);
  if (typeof value === "string" && placeholder(value)) {
    throw new McpToolInputValidationError(
      "mcp_tool_input_placeholder",
      `${path} contains an unresolved planner placeholder`,
      path,
    );
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    throw new McpToolInputValidationError("mcp_tool_input_invalid", `${path} is outside the schema enum`, path);
  }
  if (Object.prototype.hasOwnProperty.call(schema, "const") && !Object.is(schema.const, value)) {
    throw new McpToolInputValidationError("mcp_tool_input_invalid", `${path} does not equal the schema constant`, path);
  }
  const types = schemaTypes(schema);
  if (types.length > 0 && !types.some((type) => matchesType(value, type))) {
    throw new McpToolInputValidationError(
      "mcp_tool_input_invalid",
      `${path} must have schema type ${types.join(" or ")}`,
      path,
    );
  }
  if (record(value) && (types.includes("object") || schema.properties !== undefined)) {
    value = validateObject(value, schema, path, aliases);
  }
  if (Array.isArray(value) && record(schema.items)) {
    value = value.map((item, index) => validateValue(item, schema.items as Record<string, unknown>, `${path}[${index}]`, aliases));
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      throw new McpToolInputValidationError("mcp_tool_input_invalid", `${path} is shorter than minLength`, path);
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      throw new McpToolInputValidationError("mcp_tool_input_invalid", `${path} exceeds maxLength`, path);
    }
    if (typeof schema.pattern === "string") {
      let pattern: RegExp;
      try { pattern = new RegExp(schema.pattern, "u"); }
      catch {
        throw new McpToolInputValidationError("mcp_tool_schema_invalid", `${path} has an invalid schema pattern`, path);
      }
      if (!pattern.test(value)) {
        throw new McpToolInputValidationError("mcp_tool_input_invalid", `${path} does not match the tool schema pattern`, path);
      }
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      throw new McpToolInputValidationError("mcp_tool_input_invalid", `${path} is below the schema minimum`, path);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      throw new McpToolInputValidationError("mcp_tool_input_invalid", `${path} exceeds the schema maximum`, path);
    }
  }
  return value;
}

export function normalizeAndValidateMcpToolInput(
  input: unknown,
  schema: unknown,
): NormalizedMcpToolInput {
  if (!record(schema)) {
    throw new McpToolInputValidationError(
      "mcp_tool_schema_invalid",
      "The fresh MCP tools/list attestation did not include a usable input schema",
      "arguments",
    );
  }
  if (!record(input)) {
    throw new McpToolInputValidationError(
      "mcp_tool_input_invalid",
      "MCP tool arguments must be an object",
      "arguments",
    );
  }
  const aliases: McpToolInputAlias[] = [];
  const normalized = validateValue(input, schema, "arguments", aliases);
  if (!record(normalized)) {
    throw new McpToolInputValidationError(
      "mcp_tool_schema_invalid",
      "MCP tool input schema must resolve to an object",
      "arguments",
    );
  }
  assertConcreteInput(normalized, "arguments", { seen: new WeakSet(), nodes: 0 });
  return { arguments: normalized, aliases };
}
