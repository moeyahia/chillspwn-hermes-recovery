import { afterEach, describe, expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import {
  createLegacyExecutionHttpGate,
  isLegacyHttpMutation,
  legacyExecutionWebSocketError,
  legacyWebSocketMutation,
} from "../LegacyExecutionGate";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function fixture(enabled: boolean) {
  const app = express();
  app.use(express.json());
  app.use(createLegacyExecutionHttpGate({
    enabled,
    clock: () => new Date("2026-07-15T12:00:00.000Z"),
  }));
  app.get("/api/runs", (_request, response) => response.json({ source: "legacy-read" }));
  app.post("/api/runs", (_request, response) => response.json({ source: "legacy-write" }));
  app.post("/api/v2/missions", (_request, response) => response.json({ source: "canonical-write" }));
  app.post("/api/v20/missions", (_request, response) => response.json({ source: "prefix-confusion" }));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("legacy execution compatibility gate", () => {
  test("classifies only unversioned compatibility mutations", () => {
    expect(isLegacyHttpMutation("GET", "/api/runs")).toBe(false);
    expect(isLegacyHttpMutation("POST", "/api/v2/missions")).toBe(false);
    expect(isLegacyHttpMutation("POST", "/api/v20/missions")).toBe(true);
    expect(isLegacyHttpMutation("PUT", "/api/files/write")).toBe(true);
    expect(isLegacyHttpMutation("POST", "/proxy")).toBe(true);
    expect(isLegacyHttpMutation("POST", "/proxy/anthropic/v1/messages")).toBe(true);
  });

  test("defaults can preserve legacy reads while blocking hidden execution writes", async () => {
    const url = await fixture(false);
    const read = await fetch(`${url}/api/runs`);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ source: "legacy-read" });

    const blocked = await fetch(`${url}/api/runs`, { method: "POST" });
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({
      error: {
        code: "legacy_execution_disabled",
        category: "policy_denied",
        retryable: false,
        timestamp: "2026-07-15T12:00:00.000Z",
      },
    });

    const canonical = await fetch(`${url}/api/v2/missions`, { method: "POST" });
    expect(canonical.status).toBe(200);
    expect(await canonical.json()).toEqual({ source: "canonical-write" });

    const confusion = await fetch(`${url}/api/v20/missions`, { method: "POST" });
    expect(confusion.status).toBe(403);
  });

  test("allows the compatibility mutation only after explicit opt-in", async () => {
    const url = await fixture(true);
    const response = await fetch(`${url}/api/runs`, { method: "POST" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ source: "legacy-write" });
  });

  test("blocks known mutating WebSocket messages but keeps history reads available", () => {
    expect(legacyWebSocketMutation("chat")).toBe("chat");
    expect(legacyWebSocketMutation("term_start")).toBe("term_start");
    expect(legacyWebSocketMutation("delete_session")).toBe("delete_session");
    expect(legacyWebSocketMutation("list_sessions")).toBeNull();
    expect(legacyWebSocketMutation("load_session")).toBeNull();
    expect(legacyWebSocketMutation("unknown_future_message")).toBeNull();
    expect(legacyExecutionWebSocketError("chat")).toMatchObject({
      type: "error",
      code: "legacy_execution_disabled",
      operation: "chat",
      retryable: false,
    });
  });
});
