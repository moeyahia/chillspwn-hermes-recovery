import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  COMMAND_OS_JOURNEYS,
  COMMAND_OS_RUN_STATES,
  COMMAND_OS_V2_ENDPOINTS,
  createCommandOsOpenApiDocument,
  operationalEventJsonSchema,
} from "../v2Contract";

function implementationRouteIds(): string[] {
  const serverRoot = resolve(import.meta.dir, "../..");
  const files: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "__tests__") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
    }
  };
  visit(serverRoot);
  const identities = new Set<string>();
  const route = /router\.(get|post|put|patch|delete)\(\s*(["'`])([^"'`]+)\2/gu;
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(route)) {
      const method = match[1]!;
      const path = match[3]!;
      if (!path.startsWith("/api/v2/")) continue;
      if (path === "/api/v2/runs/:runId/${command}") {
        for (const command of ["pause", "resume", "cancel"]) identities.add(`${method}:/api/v2/runs/:runId/${command}`);
      } else {
        identities.add(`${method}:${path}`);
      }
    }
  }
  return [...identities].sort();
}

describe("Command OS V2 contract", () => {
  test("publishes exactly the Autonomous and Guided journeys", () => {
    expect(COMMAND_OS_JOURNEYS).toEqual(["autonomous", "guided"]);
    expect(COMMAND_OS_RUN_STATES).toContain("awaiting_contract_confirmation");
    expect(COMMAND_OS_RUN_STATES).toContain("waiting_guided_decision");
    expect(COMMAND_OS_RUN_STATES).not.toContain("waiting_input");
    expect(COMMAND_OS_RUN_STATES).not.toContain("awaiting_plan_approval");
  });

  test("has stable unique operations and idempotency on harmful mutations", () => {
    const identities = COMMAND_OS_V2_ENDPOINTS.map((endpoint) => `${endpoint.method}:${endpoint.path}`);
    expect(new Set(identities).size).toBe(identities.length);

    const unsafeWithoutKey = COMMAND_OS_V2_ENDPOINTS.filter((endpoint) =>
      endpoint.method !== "get"
      && !endpoint.idempotencyRequired
      && endpoint.path !== "/api/v2/missions/autonomous/preflight"
    );
    expect(unsafeWithoutKey).toEqual([]);
  });

  test("documents every implemented V2 route literal", () => {
    const catalog = COMMAND_OS_V2_ENDPOINTS
      .map((endpoint) => `${endpoint.method}:${endpoint.path}`)
      .sort();
    expect(catalog).toEqual(implementationRouteIds());
  });

  test("emits a valid OpenAPI 3.1 document with shared errors", () => {
    const document = createCommandOsOpenApiDocument() as {
      openapi: string;
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths["/api/v2/missions/{missionId}/runtime"]?.get).toBeDefined();
    expect(document.paths["/api/v2/runs/{runId}/cancel"]?.post).toBeDefined();
    expect(document.paths["/api/v2/events/stream"]?.get).toBeDefined();
    expect(document.components.schemas.ErrorEnvelope).toBeDefined();
  });

  test("requires correlation, journey, sensitivity, and redaction on events", () => {
    const schema = operationalEventJsonSchema() as {
      required: string[];
      properties: Record<string, unknown>;
    };
    for (const field of ["id", "sequence", "eventType", "timestamp", "actor", "summary", "journey", "sensitivity", "redacted"]) {
      expect(schema.required).toContain(field);
    }
    expect(schema.properties.contextPackId).toBeDefined();
    expect(schema.properties.traceId).toBeDefined();
  });
});
