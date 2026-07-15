/**
 * Hard authorization boundary for the ChillsPwn commander on Grok ACP.
 *
 * Grok owns its native tool registry, so its tool calls do not pass through the
 * OpenRouter `/tool-gate`.  This module is shared by the ACP permission handler
 * and the commander-only PreToolUse plugin.  The agent profile removes native
 * execution tools; this policy then fail-closes every remaining dynamic/MCP call
 * that is not explicitly coordination or conversation recall.
 */

export type GrokAcpActor = "commander" | "planner" | "specialist";

export interface GrokAcpToolDecision {
  action: "allow" | "deny";
  toolName: string;
  reason: string;
}

const COMMANDER_BUILTIN_ALLOWLIST: ReadonlySet<string> = new Set([
  // MCP discovery/dispatch. The target MCP name is independently checked below.
  "search_tool",
  "use_tool",
]);

const COMMANDER_MCP_ALLOWLIST: ReadonlySet<string> = new Set([
  "chillspwn-board__board_list",
  "chillspwn-board__board_create_task",
  "chillspwn-board__board_update",
  "chillspwn-board__board_await",
  "chillspwn-conversation__get_recent_conversation",
  "chillspwn-conversation__recall_conversation",
]);

const GROK_NATIVE_EXECUTION_TOOLS: ReadonlySet<string> = new Set([
  "run_terminal_command",
  "run_terminal_cmd",
  "bash",
  "search_replace",
  "write_file",
  "spawn_subagent",
  "task",
  "get_command_or_subagent_output",
  "wait_commands_or_subagents",
  "kill_command_or_subagent",
  "kill_terminal_command",
  "kill_task",
  "process",
  "execute_code",
]);

const GROK_MANAGED_TASK_TOOLS: ReadonlySet<string> = new Set([
  "tasks__create",
  "tasks__list",
  "tasks__update",
  "tasks__delete",
  "tasks__pause",
  "tasks__get_results",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Extract the real tool name from either a Grok hook or ACP permission shape. */
export function grokAcpToolName(payload: unknown): string {
  const root = asRecord(payload);
  if (!root) return "";

  const direct = nonEmptyString(root.toolName) || nonEmptyString(root.tool_name) || nonEmptyString(root.name);
  if (direct) return direct;

  const params = asRecord(root.params);
  const toolCall = asRecord(params?.toolCall) || asRecord(root.toolCall);
  const callMeta = asRecord(toolCall?._meta);
  const xaiTool = asRecord(callMeta?.["x.ai/tool"]);
  return nonEmptyString(xaiTool?.name)
    || nonEmptyString(toolCall?.toolName)
    || nonEmptyString(toolCall?.name)
    || "";
}

/** Extract tool input while preserving Grok's nested ACP permission representation. */
export function grokAcpToolInput(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload);
  if (!root) return {};
  const params = asRecord(root.params);
  const toolCall = asRecord(params?.toolCall) || asRecord(root.toolCall);
  return asRecord(root.toolInput)
    || asRecord(root.tool_input)
    || asRecord(toolCall?.rawInput)
    || asRecord(toolCall?.input)
    || {};
}

/** Resolve the qualified MCP target hidden behind Grok's `use_tool` dispatcher. */
export function grokAcpEffectiveToolName(payload: unknown): string {
  const outer = grokAcpToolName(payload);
  if (outer !== "use_tool") return outer;
  const input = grokAcpToolInput(payload);
  return nonEmptyString(input.tool_name) || nonEmptyString(input.toolName) || outer;
}

export function evaluateGrokAcpTool(
  actor: GrokAcpActor,
  payload: unknown,
  enforce = true,
): GrokAcpToolDecision {
  const outer = grokAcpToolName(payload);
  const effective = grokAcpEffectiveToolName(payload);

  if (!enforce || actor === "specialist") {
    return { action: "allow", toolName: effective || outer, reason: "Grok ACP commander boundary is not active for this actor" };
  }

  // Malformed or missing actor/tool data must fail closed. Grok hooks fail open
  // on crashes, so the guard returns an explicit deny instead of throwing.
  if (!effective) {
    return { action: "deny", toolName: "unknown", reason: "ChillsPwn commander denied a tool call with no verifiable tool identity" };
  }

  if (actor === "planner") {
    return {
      action: "deny",
      toolName: effective,
      reason: `ChillsPwn Grok planning calls are analysis-only; tool '${effective}' must be performed later by a delegated specialist`,
    };
  }

  if (COMMANDER_MCP_ALLOWLIST.has(effective)) {
    return { action: "allow", toolName: effective, reason: "Allowed ChillsPwn board/conversation coordination tool" };
  }

  if (outer === "use_tool") {
    return {
      action: "deny",
      toolName: effective,
      reason: `ChillsPwn may use MCP only for the Mission Board and conversation recall; '${effective}' must be delegated to a specialist`,
    };
  }

  if (COMMANDER_BUILTIN_ALLOWLIST.has(effective)) {
    return { action: "allow", toolName: effective, reason: "Allowed non-executing ChillsPwn coordination tool" };
  }

  const kind = GROK_NATIVE_EXECUTION_TOOLS.has(effective)
    ? "native execution/subagent"
    : GROK_MANAGED_TASK_TOOLS.has(effective)
      ? "account-managed private task"
      : "unapproved";
  return {
    action: "deny",
    toolName: effective,
    reason: `ChillsPwn is coordination-only on Grok ACP: ${kind} tool '${effective}' is forbidden; create a board task assigned to a different named specialist`,
  };
}

/** Grok must advertise a blocking pre_tool_use hook with an explicit deny decision. */
export function supportsGrokPreToolDeny(initializeResult: unknown): boolean {
  const result = asRecord(initializeResult);
  const caps = asRecord(result?.agentCapabilities);
  const meta = asRecord(caps?._meta);
  const hooks = asRecord(meta?.["x.ai/hooks"]);
  const events = Array.isArray(hooks?.blockingEvents) ? hooks?.blockingEvents : [];
  const decisions = Array.isArray(hooks?.decisions) ? hooks?.decisions : [];
  return events.includes("pre_tool_use") && decisions.includes("deny");
}

export function isGrokCommanderPersona(name: string | null | undefined): boolean {
  const normalized = String(name || "").trim().toLowerCase();
  return normalized === "chillspwn"
    || normalized === "commander"
    || normalized === "commander-in-chief"
    || normalized === "commander_in_chief"
    || normalized === "orchestrator";
}

export const GROK_COMMANDER_BOUNDARY_VERSION = 1;
