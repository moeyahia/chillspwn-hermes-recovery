/**
 * Broker-backed access to the legacy flat USER.md / MEMORY.md stores.
 *
 * The dashboard service account has no raw filesystem access to the root-only
 * memory tree. Every read therefore invokes chillspwn_mem.py safe-read, which
 * reaches the privileged Unix-socket broker and returns only policy-clean
 * entries. Whole-file mutation is intentionally unsupported; callers must use
 * the additive validated CLI path.
 */

import { execFileSync } from "child_process";
import { isAbsolute } from "path";
import type { Express, Request, Response } from "express";

export type LegacyMemoryFile = "USER.md" | "MEMORY.md";

export interface LegacyMemoryReaderConfig {
  python: string;
  cli: string;
  env?: NodeJS.ProcessEnv;
  execFile?: typeof execFileSync;
}

export interface LegacyMemoryReadResult {
  ok: boolean;
  content: string;
  included: number;
  excluded: number;
  error?: "invalid_configuration" | "broker_unavailable" | "invalid_response";
}

function failed(error: LegacyMemoryReadResult["error"]): LegacyMemoryReadResult {
  return { ok: false, content: "", included: 0, excluded: 0, error };
}

export function readLegacyMemoryViaBroker(
  file: LegacyMemoryFile,
  config: LegacyMemoryReaderConfig,
): LegacyMemoryReadResult {
  if (!isAbsolute(config.python) || !isAbsolute(config.cli)) {
    return failed("invalid_configuration");
  }
  const target = file === "USER.md" ? "user" : "memory";
  try {
    const run = config.execFile || execFileSync;
    const raw = run(
      config.python,
      [config.cli, "safe-read", "--target", target, "--format", "json"],
      {
        encoding: "utf-8",
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
        env: config.env || process.env,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const parsed = JSON.parse(String(raw));
    if (parsed?.ok !== true || typeof parsed.content !== "string") {
      return failed("invalid_response");
    }
    return {
      ok: true,
      content: parsed.content,
      included: Number.isSafeInteger(parsed.included) ? parsed.included : 0,
      excluded: Number.isSafeInteger(parsed.excluded) ? parsed.excluded : 0,
    };
  } catch {
    // EACCES, broker outage, timeout, malformed JSON, and helper failure are
    // indistinguishable to the caller and all fail closed. Never expose stderr.
    return failed("broker_unavailable");
  }
}

export function readLegacyMemoryBundle(config: LegacyMemoryReaderConfig): Record<LegacyMemoryFile, string> {
  return {
    "USER.md": readLegacyMemoryViaBroker("USER.md", config).content,
    "MEMORY.md": readLegacyMemoryViaBroker("MEMORY.md", config).content,
  };
}

export function legacyMemoryPutPolicy(file: string): {
  status: 400 | 403;
  body: Record<string, unknown>;
} {
  if (file !== "USER.md" && file !== "MEMORY.md") {
    return { status: 400, body: { error: "invalid file" } };
  }
  return {
    status: 403,
    body: {
      error: "Whole-file memory mutation is disabled",
      code: "MEMORY_MUTATION_MEDIATED",
      remediation: "Use chillspwn_mem.py add through the validated memory broker.",
    },
  };
}

export interface LegacyMemoryRouteDeps {
  reader: LegacyMemoryReaderConfig;
  audit?: (event: string, data: Record<string, unknown>) => void;
}

export function registerLegacyMemoryRoutes(app: Express, deps: LegacyMemoryRouteDeps): void {
  app.get("/api/memory", (_req: Request, res: Response) => {
    const user = readLegacyMemoryViaBroker("USER.md", deps.reader);
    const memory = readLegacyMemoryViaBroker("MEMORY.md", deps.reader);
    if (!user.ok || !memory.ok) {
      deps.audit?.("legacy_memory_read_failed", {
        reason: user.error || memory.error || "broker_unavailable",
      });
      return res.status(503).json({
        error: "Validated memory is temporarily unavailable",
        code: "MEMORY_BROKER_UNAVAILABLE",
      });
    }
    res.json({ "USER.md": user.content, "MEMORY.md": memory.content });
  });

  app.put("/api/memory/:file", (req: Request, res: Response) => {
    const decision = legacyMemoryPutPolicy(req.params.file);
    if (decision.status === 403) {
      deps.audit?.("legacy_memory_write_rejected", {
        file: req.params.file,
        reason: "whole_file_mutation_disabled",
      });
    }
    res.status(decision.status).json(decision.body);
  });
}
