#!/usr/bin/env bun

import { evaluateGrokAcpTool } from "../../GrokAcpExecutionPolicy";

async function deny(reason: string, toolName = "unknown"): Promise<never> {
  process.stdout.write(JSON.stringify({ decision: "deny", reason, toolName }) + "\n");
  process.exit(2);
}

try {
  const raw = await new Response(Bun.stdin.stream()).text();
  const role = process.env.CHILLSPWN_GROK_ROLE;
  if (role !== "commander" && role !== "planner") {
    await deny("ChillsPwn Grok guard is missing its required commander/planner role binding");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    await deny("ChillsPwn Grok commander guard received malformed hook JSON");
  }

  // The guard above proves this role before any tool decision is evaluated.
  const decision = evaluateGrokAcpTool(role as "commander" | "planner", payload, true);
  process.stdout.write(JSON.stringify({
    decision: decision.action,
    reason: decision.reason,
    toolName: decision.toolName,
  }) + "\n");
  process.exit(decision.action === "allow" ? 0 : 2);
} catch (error: any) {
  await deny(`ChillsPwn Grok commander guard failed closed: ${error?.message || String(error)}`);
}
