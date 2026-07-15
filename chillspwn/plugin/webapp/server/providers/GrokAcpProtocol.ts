/**
 * Pure protocol helpers for the Grok Agent Client Protocol (ACP) integration.
 *
 * Keeping JSON-RPC classification and envelope construction here is deliberate:
 * the process owner can route agent-to-client requests before looking up response
 * IDs, without coupling the protocol rules to subprocess or WebSocket state.
 */

export type AcpRequestId = string | number;

export interface AcpClientRequest {
  jsonrpc?: "2.0";
  id: AcpRequestId;
  method: string;
  params?: unknown;
}

export interface AcpPermissionOption {
  optionId: string;
  kind: string;
  name?: string;
  [key: string]: unknown;
}

export interface GrokQuestionAnswerMap {
  [question: string]: string | string[];
}

export type GrokStopClassification =
  | "completed"
  | "cancelled"
  | "limit"
  | "refused"
  | "unknown";

export interface GrokToolUpdate {
  sessionUpdate?: string;
  status?: unknown;
  content?: unknown;
  rawOutput?: unknown;
  [key: string]: unknown;
}

export interface GrokToolInvocation {
  name: string;
  input: unknown;
  detail: string;
  kind: "tool" | "skill";
}

/** Grok has its own tools, so Chillspwn must not advertise callbacks it does not implement. */
export const GROK_ACP_CLIENT_CAPABILITIES: Readonly<Record<string, never>> = Object.freeze({});

export interface GrokAgentLaunchOptions {
  alwaysApprove?: boolean;
  agentProfile?: string;
  pluginDirs?: readonly string[];
  /** Session-scoped plugins are ignored by Grok's shared leader. */
  noLeader?: boolean;
}

/** Build argv in the order required by `grok agent`: all options precede `stdio`. */
export function buildGrokAgentArgs(
  model: string,
  options: boolean | GrokAgentLaunchOptions,
): string[] {
  const opts: GrokAgentLaunchOptions = typeof options === "boolean"
    ? { alwaysApprove: options }
    : options;
  return [
    "agent",
    "-m",
    model,
    "--reasoning-effort",
    "high",
    ...(opts.noLeader ? ["--no-leader"] : []),
    ...(opts.agentProfile ? ["--agent-profile", opts.agentProfile] : []),
    ...((opts.pluginDirs || []).flatMap((dir) => ["--plugin-dir", dir])),
    ...(opts.alwaysApprove ? ["--always-approve"] : []),
    "stdio",
  ];
}

/** ACP initialize params shared by every Grok process entry point. */
export function grokAcpInitializeParams(): {
  protocolVersion: 1;
  clientCapabilities: Readonly<Record<string, never>>;
} {
  return {
    protocolVersion: 1,
    clientCapabilities: GROK_ACP_CLIENT_CAPABILITIES,
  };
}

/**
 * Detect an agent-to-client JSON-RPC request, including request ID 0.
 *
 * This predicate must be evaluated before matching `id` against locally pending
 * requests; both peers are allowed to use the same numeric ID space.
 */
export function isAcpClientRequest(message: unknown): message is AcpClientRequest {
  if (!message || typeof message !== "object") return false;
  const candidate = message as Record<string, unknown>;
  const id = candidate.id;
  return (
    typeof candidate.method === "string" &&
    candidate.method.length > 0 &&
    (typeof id === "string" || (typeof id === "number" && Number.isFinite(id)))
  );
}

/**
 * Return true only for ACP traffic that proves the current turn is progressing.
 *
 * Grok emits extension maintenance responses such as `skills-reload` while it is
 * otherwise idle. Counting every stdout line as turn activity prevents the
 * dead-turn watchdog from ever firing, so only official session updates,
 * agent-to-client requests, and responses to requests owned by Chillspwn count.
 */
export function isMeaningfulGrokAcpActivity(
  message: unknown,
  pendingRequests?: { has(id: number): boolean },
): boolean {
  if (!message || typeof message !== "object") return false;
  if (isAcpClientRequest(message)) return true;

  const candidate = message as Record<string, unknown>;
  if (candidate.method === "session/update") return true;

  return (
    typeof candidate.id === "number" &&
    Number.isFinite(candidate.id) &&
    pendingRequests?.has(candidate.id) === true
  );
}

/** Select a protocol permission option without inventing an option the agent did not offer. */
export function selectPermissionOption(
  options: readonly AcpPermissionOption[] | null | undefined,
  allow: boolean,
): AcpPermissionOption | undefined {
  if (!Array.isArray(options)) return undefined;
  const preference = allow
    ? (["allow_once", "allow_always"] as const)
    : (["reject_once", "reject_always"] as const);

  for (const desiredKind of preference) {
    const option = options.find(
      (candidate) =>
        candidate != null &&
        typeof candidate.optionId === "string" &&
        candidate.optionId.length > 0 &&
        typeof candidate.kind === "string" &&
        candidate.kind.toLowerCase() === desiredKind,
    );
    if (option) return option;
  }
  return undefined;
}

/** Exact ACP response envelope for a permission choice. */
export function permissionSelectedResponse(id: AcpRequestId, optionId: string) {
  return {
    jsonrpc: "2.0" as const,
    id,
    result: {
      outcome: {
        outcome: "selected" as const,
        optionId,
      },
    },
  };
}

/** Exact ACP response envelope when no permission option is selected. */
export function permissionCancelledResponse(id: AcpRequestId) {
  return {
    jsonrpc: "2.0" as const,
    id,
    result: {
      outcome: {
        outcome: "cancelled" as const,
      },
    },
  };
}

/**
 * Grok's private question extension uses a flatter result envelope than ACP
 * permissions. This shape was validated against the installed Grok Build
 * client: `outcome: "accepted"` plus an answers map resumes the blocked tool.
 */
export function questionAcceptedResponse(id: AcpRequestId, answers: GrokQuestionAnswerMap) {
  return {
    jsonrpc: "2.0" as const,
    id,
    result: {
      outcome: "accepted" as const,
      answers,
    },
  };
}

/** Cancel a Grok question when no interactive operator is available. */
export function questionCancelledResponse(id: AcpRequestId) {
  return {
    jsonrpc: "2.0" as const,
    id,
    result: {
      outcome: "cancelled" as const,
    },
  };
}

/**
 * Extension maintenance traffic can be extremely frequent and contains no
 * conversation evidence. Suppressing only these known messages keeps raw ACP
 * logs useful without synchronously writing hundreds of megabytes of reloads.
 */
export function isNoisyGrokMaintenanceMessage(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const candidate = message as Record<string, any>;
  if (candidate.id === "skills-reload") return true;
  if (candidate.method === "_x.ai/models/update" || candidate.method === "_x.ai/settings/update") return true;
  return candidate.method === "session/update"
    && candidate.params?.update?.sessionUpdate === "available_commands_update";
}

/** Construct a JSON-RPC notification (notifications intentionally have no `id`). */
export function acpNotification(method: string, params: unknown) {
  return {
    jsonrpc: "2.0" as const,
    method,
    params,
  };
}

/** Reject an unsupported agent-to-client request instead of leaving Grok blocked forever. */
export function unsupportedAcpMethodResponse(id: AcpRequestId, method: string) {
  return {
    jsonrpc: "2.0" as const,
    id,
    error: {
      code: -32601,
      message: `Method not found: ${method}`,
    },
  };
}

/** Map ACP stop reasons onto the lifecycle states Chillspwn needs. */
export function classifyGrokStopReason(reason: unknown): GrokStopClassification {
  if (typeof reason !== "string") return "unknown";
  switch (reason.trim().toLowerCase()) {
    case "end_turn":
      return "completed";
    case "cancelled":
      return "cancelled";
    case "max_tokens":
    case "max_turn_requests":
      return "limit";
    case "refusal":
      return "refused";
    default:
      return "unknown";
  }
}

/** Only terminal statuses from ACP are final; raw output may also arrive while in progress. */
export function isFinalGrokToolUpdate(update: unknown): boolean {
  if (!update || typeof update !== "object") return false;
  const status = (update as Record<string, unknown>).status;
  if (typeof status !== "string") return false;
  const normalized = status.trim().toLowerCase();
  return normalized === "completed" || normalized === "failed";
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseObjectString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

/**
 * Normalize a Grok ACP tool call for persistence and board progress.
 *
 * Native tools expose their name in x.ai metadata. MCP tools first appear as
 * the generic `use_tool` wrapper, with the real server/tool name and arguments
 * nested under `rawInput.tool_name` / `rawInput.tool_input`. Unwrapping that
 * envelope keeps live board timelines useful instead of showing every MCP call
 * as an opaque `use_tool` event.
 */
export function extractGrokToolInvocation(update: unknown): GrokToolInvocation | null {
  const candidate = asRecord(update);
  if (!candidate) return null;

  const rawInput = parseObjectString(candidate.rawInput ?? candidate.input ?? candidate.arguments ?? "");
  const rawRecord = asRecord(rawInput);
  const nestedName = typeof rawRecord?.tool_name === "string" ? rawRecord.tool_name.trim() : "";
  const input = nestedName && hasOwn(rawRecord!, "tool_input")
    ? rawRecord!.tool_input
    : rawInput;

  const meta = asRecord(candidate._meta);
  const xaiTool = asRecord(meta?.["x.ai/tool"]);
  const metadataName = typeof xaiTool?.name === "string" ? xaiTool.name.trim() : "";
  const directName = [candidate.name, candidate.toolName, candidate.title]
    .find((value) => typeof value === "string" && value.trim().length > 0);
  const name = nestedName || metadataName || (typeof directName === "string" ? directName.trim() : "");
  if (!name) return null;

  const inputRecord = asRecord(input);
  const detailValue = inputRecord
    ? [
      inputRecord.skill,
      inputRecord.command,
      inputRecord.path,
      inputRecord.file_path,
      inputRecord.pattern,
      inputRecord.query,
      inputRecord.code,
      inputRecord.task,
      inputRecord.description,
    ].find((value) => typeof value === "string" && value.length > 0)
    : input;
  let detail = "";
  if (typeof detailValue === "string") detail = detailValue;
  else if (input != null && input !== "") {
    try { detail = JSON.stringify(input); } catch { detail = ""; }
  }

  const baseName = name.includes("__") ? name.slice(name.lastIndexOf("__") + 2) : name;
  return {
    name,
    input,
    detail,
    kind: baseName === "use_skill" ? "skill" : "tool",
  };
}

function flattenAcpValue(value: unknown, seen = new WeakSet<object>()): string {
  if (typeof value === "string") return value;
  if (value == null) return "";

  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255)) {
      return Buffer.from(value as number[]).toString("utf8");
    }
    return value
      .map((item) => flattenAcpValue(item, seen))
      .filter(Boolean)
      .join("\n");
  }

  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  const record = value as Record<string, unknown>;

  // ACP ContentBlock and Grok raw-output payloads use these known nesting keys.
  // Grok MCP calls wrap the server's serialized result in a Rust-enum-shaped
  // envelope: `output: { OkayOutput: "..." }`.  Error results use the
  // corresponding `ErrorOutput` variant.  Decode only these explicit variants
  // rather than falling back to arbitrary object stringification.
  if (hasOwn(record, "OkayOutput")) {
    const output = flattenAcpValue(record.OkayOutput, seen);
    if (output) return output;
  }
  if (hasOwn(record, "ErrorOutput")) {
    const error = flattenAcpValue(record.ErrorOutput, seen);
    if (error) return error;
  }
  if (typeof record.output_for_prompt === "string") return record.output_for_prompt;
  if (typeof record.text === "string") return record.text;
  if (hasOwn(record, "content")) {
    const content = flattenAcpValue(record.content, seen);
    if (content) return content;
  }
  if (hasOwn(record, "Content")) {
    const content = flattenAcpValue(record.Content, seen);
    if (content) return content;
  }
  if (hasOwn(record, "resource")) {
    const resource = flattenAcpValue(record.resource, seen);
    if (resource) return resource;
  }

  const streams = [record.stdout, record.stderr]
    .map((stream) => flattenAcpValue(stream, seen))
    .filter(Boolean);
  if (streams.length > 0) return streams.join("\n");

  if (hasOwn(record, "output")) {
    const output = flattenAcpValue(record.output, seen);
    if (output) return output;
  }
  if (hasOwn(record, "message")) {
    const message = flattenAcpValue(record.message, seen);
    if (message) return message;
  }
  if (hasOwn(record, "error")) return flattenAcpValue(record.error, seen);
  return "";
}

/**
 * Extract user-displayable output from a Grok tool update.
 *
 * Initial metadata-only updates are ignored. Completed/failed updates may use
 * ACP `content`; Grok terminal updates may expose useful `rawOutput` before the
 * terminal status becomes final, so that is accepted as an explicit output signal.
 */
export function extractGrokToolOutput(update: unknown): string {
  if (!update || typeof update !== "object") return "";
  const candidate = update as GrokToolUpdate;
  const rawOutputPresent = hasOwn(candidate, "rawOutput") && candidate.rawOutput != null;
  if (!isFinalGrokToolUpdate(candidate) && !rawOutputPresent) return "";

  if (rawOutputPresent) {
    const raw = flattenAcpValue(candidate.rawOutput);
    if (raw) return raw;
  }
  return flattenAcpValue(candidate.content);
}
