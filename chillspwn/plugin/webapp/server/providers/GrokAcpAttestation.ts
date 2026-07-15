export interface GrokBoundaryAttestation {
  ok: boolean;
  reason: string;
  retryable?: boolean;
}

export interface GrokBoundaryActivationState {
  profileAttested: boolean;
  hooksAttested: boolean;
  mcpsAttested: boolean;
  failed: boolean;
  closing: boolean;
  activated: boolean;
}

/** A failed/closing launch can never be resurrected by later buffered ACP responses. */
export function canActivateGrokCommanderBoundary(state: GrokBoundaryActivationState): boolean {
  return !state.failed
    && !state.closing
    && !state.activated
    && state.profileAttested
    && state.hooksAttested
    && state.mcpsAttested;
}

const ROOT_TOOLSET = ["search_tool", "use_tool"] as const;
const COMMANDER_MCP_TOOLSET = [
  "chillspwn-board__board_list",
  "chillspwn-board__board_create_task",
  "chillspwn-board__board_update",
  "chillspwn-board__board_await",
  "chillspwn-conversation__get_recent_conversation",
  "chillspwn-conversation__recall_conversation",
] as const;

const COMMANDER_MCP_TOOLS_BY_SERVER: Readonly<Record<string, readonly string[]>> = {
  "chillspwn-board": ["board_list", "board_create_task", "board_update", "board_await"],
  "chillspwn-conversation": ["get_recent_conversation", "recall_conversation"],
};

function record(value: unknown): Record<string, any> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function strictSortedStrings(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) return null;
  return [...value].sort();
}

function sameStrings(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

/** Attest the actual model-callable tools emitted by Grok's profile/MCP loader. */
export function attestGrokCommanderToolSurface(
  update: unknown,
  allowApprovedMcpExpansion = false,
): GrokBoundaryAttestation | null {
  const body = record(update);
  if (body?.sessionUpdate !== "available_commands_update") return null;
  const tools = strictSortedStrings(record(body._meta)?.tools);
  if (!tools) return { ok: false, reason: "Malformed Grok root tool surface" };
  const root = [...ROOT_TOOLSET].sort();
  const expanded = [...ROOT_TOOLSET, ...COMMANDER_MCP_TOOLSET].sort();
  if (sameStrings(tools, root) || (allowApprovedMcpExpansion && sameStrings(tools, expanded))) {
    return { ok: true, reason: `Grok root tool surface attested: ${tools.join(", ")}` };
  }
  // Grok announces the two profile dispatchers before explicitly supplied MCPs
  // finish loading. A strict subset is not authorization: keep the prompt gated
  // until the final exact surface arrives. Any unknown tool fails immediately.
  const expected: readonly string[] = allowApprovedMcpExpansion ? expanded : root;
  if (tools.every((tool) => expected.includes(tool))) {
    return { ok: false, retryable: true, reason: `Grok tool surface is still initializing: ${tools.join(", ") || "(missing)"}` };
  }
  return { ok: false, reason: `Unexpected Grok root tool surface: ${tools.join(", ") || "(missing)"}` };
}

function extensionBody(value: unknown): Record<string, any> {
  const outer = record(value) || {};
  return record(outer.result) || outer;
}

/** Attest the one enabled global PreToolUse guard provisioned in isolated GROK_HOME. */
export function attestGrokCommanderHooks(
  value: unknown,
  guardPath: string,
  expectedSourceDir?: string,
): GrokBoundaryAttestation {
  const hooks = extensionBody(value).hooks;
  if (!Array.isArray(hooks) || hooks.length !== 1) {
    return { ok: false, reason: `Expected exactly one Grok commander hook; found ${Array.isArray(hooks) ? hooks.length : 0}` };
  }
  const hook = record(hooks[0]) || {};
  const command = String(hook.command || "");
  const expectedCommand = `/root/.bun/bin/bun ${JSON.stringify(guardPath)}`;
  const valid = hook.event === "pre_tool_use"
    && hook.handlerType === "command"
    && hook.disabled === false
    && hook.matcher == null
    && command === expectedCommand
    && hook.timeoutMs === 5_000
    && (!expectedSourceDir || hook.sourceDir === expectedSourceDir);
  return valid
    ? { ok: true, reason: "Grok commander PreToolUse guard attested" }
    : { ok: false, reason: "Grok commander PreToolUse guard is missing, disabled, matched narrowly, or points at the wrong command" };
}

/**
 * Attest MCP isolation. Ambient local discovery and xAI account-managed
 * gateways are disabled; only explicitly supplied local ACP servers may remain.
 */
export function attestGrokCommanderMcps(
  value: unknown,
  expectedLocalNames: readonly string[],
): GrokBoundaryAttestation {
  const servers = extensionBody(value).servers;
  if (!Array.isArray(servers)) return { ok: false, reason: "Grok MCP attestation response has no server list" };

  const parsedServers: Record<string, any>[] = [];
  for (const server of servers) {
    const item = record(server);
    if (!item
      || typeof item.name !== "string"
      || !item.name.trim()
      || typeof item.source !== "string"
      || !item.source.trim()) {
      return { ok: false, reason: "Grok MCP attestation response contains a malformed server" };
    }
    parsedServers.push(item);
  }

  const locals = parsedServers.filter((server) => server.source === "local");
  const localNames = strictSortedStrings(locals.map((server) => server.name));
  const expected = [...expectedLocalNames].sort();
  if (!localNames || !sameStrings(localNames, expected)) {
    return { ok: false, reason: `Unexpected local Grok MCP servers: ${localNames?.join(", ") || "(none)"}` };
  }

  for (const server of locals) {
    const item = server;
    const session = record(item.session);
    if (!session) return { ok: false, reason: `Grok MCP '${item.name}' has malformed session state` };
    if (session.status === "initializing" || session.status === "starting") {
      return { ok: false, retryable: true, reason: `Grok MCP '${item.name}' is still initializing` };
    }
    if (session.enabled !== true || session.status !== "ready") {
      return { ok: false, reason: `Grok MCP '${item.name}' is not enabled and ready (status=${String(session.status || "missing")})` };
    }
    const expectedTools = COMMANDER_MCP_TOOLS_BY_SERVER[String(item.name)] || [];
    if (!Array.isArray(session.tools) || session.tools.some((tool) => !record(tool))) {
      return { ok: false, reason: `Grok MCP '${item.name}' has a malformed tool list` };
    }
    const toolRecords = session.tools as Record<string, any>[];
    if (toolRecords.some((tool) => typeof tool.name !== "string" || !tool.name.trim())) {
      return { ok: false, reason: `Grok MCP '${item.name}' has a malformed tool identity` };
    }
    const actualTools = toolRecords.map((tool) => String(tool.name || "")).filter(Boolean).sort();
    if (!sameStrings(actualTools, [...expectedTools].sort()) || toolRecords.some((tool) => tool.enabled !== true)) {
      return {
        ok: false,
        reason: `Unexpected or disabled tools on Grok MCP '${item.name}': ${actualTools.join(", ") || "(none)"}`,
      };
    }
  }

  const nonLocal = parsedServers.filter((server) => server.source !== "local");
  if (nonLocal.length) {
    return {
      ok: false,
      reason: `Unexpected non-local Grok MCP servers: ${nonLocal.map((server) => String(record(server)?.name || "unknown")).join(", ")}`,
    };
  }

  return { ok: true, reason: `Grok local MCP surface attested: ${localNames.join(", ") || "none"}` };
}

export const GROK_COMMANDER_ROOT_TOOLS = ROOT_TOOLSET;
export const GROK_COMMANDER_MCP_TOOLS = COMMANDER_MCP_TOOLSET;
