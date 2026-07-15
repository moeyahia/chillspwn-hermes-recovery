import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import {
  legacyMemoryPutPolicy,
  readLegacyMemoryBundle,
  readLegacyMemoryViaBroker,
  registerLegacyMemoryRoutes,
} from "../LegacyMemoryBroker";

describe("legacy flat memory broker boundary", () => {
  const base = {
    python: "/opt/runtime/python",
    cli: "/opt/runtime/chillspwn_mem.py",
  };

  test("all provider-facing flat memory comes from the same safe-read client", () => {
    const calls: string[][] = [];
    const execFile = ((_python: string, args: string[]) => {
      calls.push(args);
      const target = args[args.indexOf("--target") + 1];
      return JSON.stringify({
        ok: true,
        content: target === "user" ? "Validated preference." : "Validated provider fact.",
        included: 1,
        excluded: 0,
      });
    }) as any;
    const bundle = readLegacyMemoryBundle({ ...base, execFile });
    expect(bundle).toEqual({
      "USER.md": "Validated preference.",
      "MEMORY.md": "Validated provider fact.",
    });
    expect(calls).toHaveLength(2);
    for (const args of calls) {
      expect(args.slice(0, 2)).toEqual([base.cli, "safe-read"]);
      expect(args).toContain("--format");
      expect(args).not.toContain("USER.md");
      expect(args).not.toContain("MEMORY.md");
    }
  });

  test("EACCES and broker failures return no raw fallback content", () => {
    const execFile = (() => {
      const error: any = new Error("EACCES reading root-only memory");
      error.code = "EACCES";
      throw error;
    }) as any;
    const result = readLegacyMemoryViaBroker("MEMORY.md", { ...base, execFile });
    expect(result).toEqual({
      ok: false,
      content: "",
      included: 0,
      excluded: 0,
      error: "broker_unavailable",
    });
    expect(JSON.stringify(result)).not.toContain("root-only memory");
  });

  test("whole-file API writes are forbidden for both stores", () => {
    for (const file of ["USER.md", "MEMORY.md"]) {
      const decision = legacyMemoryPutPolicy(file);
      expect(decision.status).toBe(403);
      expect(decision.body.code).toBe("MEMORY_MUTATION_MEDIATED");
    }
    expect(legacyMemoryPutPolicy("OTHER.md").status).toBe(400);
  });

  test("registered GET is broker-backed and PUT returns HTTP 403", () => {
    const routes = new Map<string, Function>();
    const app: any = {
      get: (path: string, handler: Function) => routes.set(`GET ${path}`, handler),
      put: (path: string, handler: Function) => routes.set(`PUT ${path}`, handler),
    };
    const audits: any[] = [];
    const execFile = ((_python: string, args: string[]) => JSON.stringify({
      ok: true,
      content: args.includes("user") ? "Safe user context." : "Safe memory context.",
      included: 1,
      excluded: 0,
    })) as any;
    registerLegacyMemoryRoutes(app, {
      reader: { ...base, execFile },
      audit: (event, data) => audits.push({ event, data }),
    });

    const response = () => {
      const state: any = { statusCode: 200, body: undefined };
      state.status = (code: number) => { state.statusCode = code; return state; };
      state.json = (body: unknown) => { state.body = body; return state; };
      return state;
    };
    const getRes = response();
    routes.get("GET /api/memory")!({}, getRes);
    expect(getRes.statusCode).toBe(200);
    expect(getRes.body["USER.md"]).toBe("Safe user context.");
    expect(getRes.body["MEMORY.md"]).toBe("Safe memory context.");

    const putRes = response();
    routes.get("PUT /api/memory/:file")!({
      params: { file: "MEMORY.md" },
      body: { content: "attempted whole-file replacement" },
    }, putRes);
    expect(putRes.statusCode).toBe(403);
    expect(putRes.body.code).toBe("MEMORY_MUTATION_MEDIATED");
    expect(audits).toEqual([{
      event: "legacy_memory_write_rejected",
      data: { file: "MEMORY.md", reason: "whole_file_mutation_disabled" },
    }]);
  });

  test("registered GET reports broker EACCES as HTTP 503 without raw detail", () => {
    const routes = new Map<string, Function>();
    const app: any = {
      get: (path: string, handler: Function) => routes.set(`GET ${path}`, handler),
      put: () => undefined,
    };
    const execFile = (() => {
      throw new Error("EACCES /root/.hermes/memories/MEMORY.md");
    }) as any;
    registerLegacyMemoryRoutes(app, { reader: { ...base, execFile } });
    const res: any = { statusCode: 200, body: undefined };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (body: unknown) => { res.body = body; return res; };
    routes.get("GET /api/memory")!({}, res);
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe("MEMORY_BROKER_UNAVAILABLE");
    expect(JSON.stringify(res.body)).not.toContain("/root/.hermes");
  });

  test("dashboard provider builders cannot regain direct memory filesystem access", () => {
    const source = readFileSync(new URL("../../index.ts", import.meta.url), "utf-8");
    expect(source).toContain("registerLegacyMemoryRoutes(app");
    expect(source).toContain("readLegacyMemoryViaBroker(file");
    expect(source).not.toContain('"--add-dir", "/root/.hermes/memories"');
    expect(source).not.toContain("Updated memory file:");
    expect(source.match(/readSafeLegacyMemoryFile\("USER\.md"\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source.match(/readSafeLegacyMemoryFile\("MEMORY\.md"\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
