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

/** Grok has its own tools, so Chillspwn must not advertise callbacks it does not implement. */
export const GROK_ACP_CLIENT_CAPABILITIES: Readonly<Record<string, never>> = Object.freeze({});

/** Build argv in the order required by `grok agent`: all options precede `stdio`. */
export function buildGrokAgentArgs(model: string, alwaysApprove: boolean): string[] {
  return [
    "agent",
    "-m",
    model,
    "--reasoning-effort",
    "high",
    ...(alwaysApprove ? ["--always-approve"] : []),
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
