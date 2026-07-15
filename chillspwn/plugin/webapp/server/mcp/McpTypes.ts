/**
 * Phase 16 — MCP Arsenal Bridge types.
 *
 * The bridge makes the STAGED MCP arsenal (`/opt/chillspwn-mcp-arsenal/.mcp.arsenal.json`) executable
 * for SPECIALIST agents through the OpenRouter/runtime path — NEVER through the frozen Claude path.
 * Tools are exposed only through specialist allowlists + AgentRoutingPolicy + ToolPolicy + the runtime
 * gate + per-server health. Nothing here touches claude-p / spawnClaude / .claude.json.
 */

/** Lifecycle of a configured MCP server as seen by the bridge. */
export const MCP_SERVER_STATES = [
  "disabled",            // present in config but enabled:false
  "configured",          // enabled, dependencies look present, not yet started
  "missing_dependency",  // a required binary / docker image is absent
  "missing_secret",      // a required env var / API key is absent
  "starting",            // start attempted
  "healthy",             // tool-list (or safe self-test) succeeded
  "failed",              // start / health check failed
  "stopped",             // was started, now stopped
] as const;
export type McpServerState = (typeof MCP_SERVER_STATES)[number];

export type McpRuntimeType = "stdio" | "node" | "python" | "docker" | "http" | "registry" | "builtin";

/** One MCP server as loaded from the arsenal config (+ derived runtime fields). */
export interface McpServerSpec {
  name: string;
  runtime: McpRuntimeType;
  enabled: boolean;
  assignedAgents: string[];
  requiredBinaries: string[];
  requiredDockerImages: string[];
  requiredEnv: string[];          // env var NAMES only (never values)
  apiKeysRequired: string[];
  installMethod: string;
  /** How to start it (stdio command + args), if known. Docker/registry/builtin may omit. */
  command?: string;
  args?: string[];
  cwd?: string;
  /** Present when a configured start command failed immutable-executable validation. */
  startError?: string;
  /** Extra non-secret env for the spawned server (e.g. MCP_TRANSPORT=stdio). */
  env?: Record<string, string>;
  /** Tool names this server exposes (from the manifest; refreshed by a live tools/list when healthy). */
  toolNames: string[];
  riskClass?: string;
}

export interface McpHealthResult {
  name: string;
  state: McpServerState;
  reasons: string[];           // human-readable, secret-free
  missingBinaries: string[];
  missingEnv: string[];        // names only
  missingDockerImages: string[];
  toolCount: number | null;    // from a live tools/list, when performed
  checkedAt: string;
}

/** Normalized result of an MCP tool execution (or dry-run preview). */
export interface McpToolResult {
  success: boolean;
  dryRun: boolean;
  mcpServer: string;
  toolName: string;
  specialistAgentId: string | null;
  outputPreview: string;       // truncated to MCP_ARSENAL_MAX_OUTPUT_BYTES, secret-redacted
  fullOutputBytes: number;
  artifactId: string | null;   // set when output exceeded the preview budget
  evidenceIds: string[];
  error: string | null;
  durationMs: number;
  isError: boolean;            // MCP-protocol tool error (content.isError)
}

/** JSON-RPC 2.0 message shapes used by the minimal stdio client. */
export interface JsonRpcRequest { jsonrpc: "2.0"; id: number; method: string; params?: unknown }
export interface JsonRpcNotification { jsonrpc: "2.0"; method: string; params?: unknown }
export interface JsonRpcResponse { jsonrpc: "2.0"; id: number; result?: any; error?: { code: number; message: string; data?: unknown } }

export const MCP_PROTOCOL_VERSION = "2024-11-05";
