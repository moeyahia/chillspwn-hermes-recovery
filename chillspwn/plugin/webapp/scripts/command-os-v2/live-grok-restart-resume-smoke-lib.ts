import { isAbsolute, resolve } from "node:path";

export const LIVE_RESTART_CONFIRMATION = "authorized-local-selftest-restart-resume";
export const REVIEWED_SELFTEST_PATH = "/opt/chillspwn-mcp-arsenal/local-selftest-mcp.mjs";
export const REVIEWED_SELFTEST_SHA256 = "ecc77ab562c9cabf5f68297ede9df563935d1720ead341dff4c307363da8a215";
export const REVIEWED_SELFTEST_SERVER = "local-selftest";
export const REVIEWED_SELFTEST_TOOL = "quick_scan";

export interface SmokeIdentity {
  readonly platform: NodeJS.Platform;
  readonly euid: number | undefined;
  readonly username: string;
}

export interface LiveRestartSmokeGate {
  readonly authPath: string;
  readonly port: number;
  readonly serviceUser: string;
  readonly grokBin: string;
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error(`${name} is required`);
  if (normalized.includes("\0")) throw new Error(`${name} contains an invalid NUL byte`);
  return normalized;
}

function absolutePath(value: string | undefined, name: string): string {
  const normalized = required(value, name);
  if (!isAbsolute(normalized)) throw new Error(`${name} must be an absolute path`);
  return resolve(normalized);
}

/**
 * Fail closed before allocating state or starting a child. The real smoke is
 * intentionally unavailable to root and requires both the expected service
 * account name and an exact human confirmation phrase.
 */
export function validateLiveRestartSmokeGate(
  env: NodeJS.ProcessEnv,
  identity: SmokeIdentity,
): LiveRestartSmokeGate {
  if (identity.platform !== "linux") {
    throw new Error("The process-level restart smoke requires Linux process groups");
  }
  if (identity.euid === undefined || identity.euid === 0) {
    throw new Error("Run the live restart smoke only as the unprivileged ChillsPwn service user");
  }
  if (env.CHILLSPWN_LIVE_RESTART_CONFIRM !== LIVE_RESTART_CONFIRMATION) {
    throw new Error(`Set CHILLSPWN_LIVE_RESTART_CONFIRM=${LIVE_RESTART_CONFIRMATION} to opt in`);
  }
  const serviceUser = required(
    env.CHILLSPWN_LIVE_RESTART_SERVICE_USER,
    "CHILLSPWN_LIVE_RESTART_SERVICE_USER",
  );
  if (serviceUser !== identity.username) {
    throw new Error("CHILLSPWN_LIVE_RESTART_SERVICE_USER must match the effective service account");
  }
  const portText = required(env.CHILLSPWN_LIVE_RESTART_PORT, "CHILLSPWN_LIVE_RESTART_PORT");
  if (!/^\d{4,5}$/u.test(portText)) {
    throw new Error("CHILLSPWN_LIVE_RESTART_PORT must be an explicit unprivileged TCP port");
  }
  const port = Number(portText);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535 || port === 3131) {
    throw new Error("CHILLSPWN_LIVE_RESTART_PORT must be 1024-65535 and must not be the production port 3131");
  }
  return {
    authPath: absolutePath(env.GROK_AUTH_PATH, "GROK_AUTH_PATH"),
    port,
    serviceUser,
    grokBin: absolutePath(env.CHILLSPWN_LIVE_RESTART_GROK_BIN || "/opt/chillspwn/bin/grok", "Grok binary"),
  };
}

export interface IsolatedServerPaths {
  readonly root: string;
  readonly home: string;
  readonly hermesHome: string;
  readonly stateRoot: string;
  readonly sessionsRoot: string;
  readonly databasePath: string;
  readonly vaultRoot: string;
  readonly workspace: string;
  readonly tmp: string;
  readonly mcpConfigPath: string;
}

/** Build a positive allowlist; ambient API keys and unrelated credentials never cross the boundary. */
export function buildIsolatedServerEnvironment(
  parent: NodeJS.ProcessEnv,
  gate: LiveRestartSmokeGate,
  paths: IsolatedServerPaths,
): NodeJS.ProcessEnv {
  const child: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
    "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR",
  ]) {
    if (parent[key] !== undefined) child[key] = parent[key];
  }
  Object.assign(child, {
    NODE_ENV: "production",
    TMPDIR: paths.tmp,
    HOME: paths.home,
    HERMES_HOME: paths.hermesHome,
    CHILLSPWN_STATE_DIR: paths.stateRoot,
    CHILLSPWN_SESSIONS_DIR: paths.sessionsRoot,
    COMMAND_OS_DB_PATH: paths.databasePath,
    CHILLSPWN_VAULT_ROOT: paths.vaultRoot,
    ALLOWED_WORKSPACE_ROOTS: paths.workspace,
    CHILLSPWN_BIND: "127.0.0.1",
    CHILLSPWN_PORT: String(gate.port),
    DASHBOARD_TOKEN: "",
    CHILLSPWN_ALLOW_UNSAFE_NO_AUTH: "false",

    // OAuth is supplied only as an opaque file path. API-key fallbacks are
    // explicitly blank even if the parent service environment contains them.
    GROK_AUTH_PATH: gate.authPath,
    GROK_BIN: gate.grokBin,
    XAI_API_KEY: "",
    OPENROUTER_API_KEY: "",
    GEMINI_API_KEY: "",
    CODEX_HOME: resolve(paths.root, "unavailable", "codex-home"),
    CODEX_BIN: resolve(paths.root, "unavailable", "codex"),
    CLAUDE_CONFIG_DIR: resolve(paths.root, "unavailable", "claude-config"),
    CLAUDE_BIN: resolve(paths.root, "unavailable", "claude"),
    HERMES_PYTHON: "/usr/bin/false",
    CHILLSPWN_MEM_CLI: resolve(paths.root, "unavailable", "memory-cli"),

    ENABLE_TERMINAL: "false",
    ENABLE_PROXY: "false",
    ENABLE_FILE_WRITE: "false",
    ENABLE_SECURITY_TOOLS: "false",
    ENABLE_CHAT_AGENT_RUNS: "false",
    ENABLE_RUNTIME_MANAGED_CHAT: "false",
    ENABLE_OPENROUTER_RUNTIME_GATING: "false",
    ENABLE_SPECIALIST_AGENT_ROUTING: "true",
    ENFORCE_CHILLSPWN_DELEGATION: "true",
    ENFORCE_CHILLSPWN_NO_HANDS: "true",
    ALLOW_CHILLSPWN_DIRECT_TOOLS: "false",
    REQUIRE_SPECIALIST_ASSIGNMENT: "true",

    ENABLE_MCP_ARSENAL: "true",
    MCP_ARSENAL_CONFIG: paths.mcpConfigPath,
    MCP_ARSENAL_MODE: "enabled",
    MCP_ARSENAL_START_SERVERS: "true",
    MCP_ARSENAL_ALLOW_DOCKER: "false",
    MCP_ARSENAL_DEFAULT_TIMEOUT_SECONDS: "30",
    MCP_ARSENAL_MAX_OUTPUT_BYTES: "4096",
    APPROVAL_MODE: "auto",
    AUTO_APPROVE_TOOL_NAMES: REVIEWED_SELFTEST_TOOL,
    AUTO_APPROVE_AGENT_IDS: "ReconScout",
    AUTO_APPROVE_RISK_CLASSES: "read-only,network",
    AUTO_APPROVE_MAX_RISK: "network",
  });
  return child;
}

function exactStrings(value: unknown, expected: readonly string[], label: string): void {
  if (!Array.isArray(value) || value.length !== expected.length
      || value.some((item, index) => item !== expected[index])) {
    throw new Error(`${label} must contain only ${expected.join(", ") || "no values"}`);
  }
}

/** Validate the committed config before the production registry sees it. */
export function validateReviewedSelftestConfig(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Reviewed MCP config must be an object");
  }
  const root = value as Record<string, unknown>;
  const reviewed = root.reviewedAsset as Record<string, unknown> | undefined;
  if (reviewed?.path !== REVIEWED_SELFTEST_PATH || reviewed.sha256 !== REVIEWED_SELFTEST_SHA256) {
    throw new Error("Reviewed MCP config does not pin the approved local-selftest asset");
  }
  const servers = root.mcpServers;
  if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
    throw new Error("Reviewed MCP config has no server map");
  }
  const entries = Object.entries(servers as Record<string, unknown>);
  if (entries.length !== 1 || entries[0]?.[0] !== REVIEWED_SELFTEST_SERVER) {
    throw new Error("The restart smoke MCP config may expose only local-selftest");
  }
  const spec = entries[0][1] as Record<string, unknown>;
  if (!spec || typeof spec !== "object" || Array.isArray(spec)
      || spec.enabled !== true || spec.runtime !== "stdio" || spec.command !== "/usr/bin/node") {
    throw new Error("local-selftest must be the enabled reviewed stdio server");
  }
  exactStrings(spec.args, [REVIEWED_SELFTEST_PATH], "local-selftest args");
  exactStrings(spec.assignedAgents, ["ReconScout"], "local-selftest agent assignment");
  exactStrings(spec.toolNames, [REVIEWED_SELFTEST_TOOL], "local-selftest tool surface");
  exactStrings(spec.requiredBinaries, ["/usr/bin/node"], "local-selftest binary requirements");
  exactStrings(spec.requiredDockerImages, [], "local-selftest Docker requirements");
  exactStrings(spec.apiKeysRequired, [], "local-selftest API-key requirements");
  if (!spec.envTemplate || typeof spec.envTemplate !== "object" || Array.isArray(spec.envTemplate)
      || Object.keys(spec.envTemplate as Record<string, unknown>).length !== 0
      || (spec.env && Object.keys(spec.env as Record<string, unknown>).length !== 0)) {
    throw new Error("local-selftest may not receive process credentials or custom environment values");
  }
}

export interface FinalDurabilitySnapshot {
  readonly run: { status: string; journey: string; leaseOwner: string | null; leaseExpiresAt: string | null };
  readonly missionStatus: string;
  readonly recoveryEventCount: number;
  readonly recoveryCheckpointCount: number;
  readonly waitingGuidedEventCount: number;
  readonly guidedDecisionCount: number;
  readonly planCount: number;
  readonly actions: readonly {
    id: string;
    status: string;
    kind: string;
    mcpServer: string;
    toolName: string;
  }[];
  readonly toolCalls: readonly {
    id: string;
    actionId: string;
    status: string;
    mcpServer: string | null;
    toolName: string;
  }[];
  readonly completedActionEventCount: number;
  readonly verifiedSelftestEvidenceCount: number;
  readonly evaluationCount: number;
  readonly evaluationEvidenceCoverage: number;
  readonly openAssignmentCount: number;
  readonly startedProviderTurnCount: number;
  readonly crashProviderTurn: { status: string; endedAt: string | null } | null;
}

/** Pure final gate used by the live harness and by portable unit tests. */
export function validateFinalDurability(snapshot: FinalDurabilitySnapshot): void {
  if (snapshot.run.journey !== "autonomous" || snapshot.run.status !== "completed"
      || snapshot.missionStatus !== "completed") {
    throw new Error("The recovered Autonomous mission did not complete durably");
  }
  if (snapshot.run.leaseOwner !== null || snapshot.run.leaseExpiresAt !== null) {
    throw new Error("The terminal run retained a ghost lease");
  }
  if (snapshot.recoveryEventCount < 1 || snapshot.recoveryCheckpointCount < 1) {
    throw new Error("Restart recovery was not represented by a durable event and checkpoint");
  }
  if (snapshot.waitingGuidedEventCount !== 0 || snapshot.guidedDecisionCount !== 0) {
    throw new Error("Autonomous recovery entered a Guided decision state");
  }
  if (snapshot.planCount !== 1) {
    throw new Error("Planning restart produced a duplicate or missing durable plan");
  }
  if (snapshot.actions.length !== 1) {
    throw new Error("Recovered execution produced a duplicate or missing action");
  }
  const action = snapshot.actions[0]!;
  if (action.status !== "succeeded" || action.kind !== "tool"
      || action.mcpServer !== REVIEWED_SELFTEST_SERVER || action.toolName !== REVIEWED_SELFTEST_TOOL) {
    throw new Error("The only completed action was not the reviewed local-selftest.quick_scan tool");
  }
  if (snapshot.toolCalls.length !== 1) {
    throw new Error("Recovered execution produced a duplicate or missing MCP tool call");
  }
  const toolCall = snapshot.toolCalls[0]!;
  if (toolCall.actionId !== action.id || toolCall.status !== "succeeded"
      || toolCall.mcpServer !== REVIEWED_SELFTEST_SERVER || toolCall.toolName !== REVIEWED_SELFTEST_TOOL) {
    throw new Error("The MCP receipt does not match the single reviewed completed action");
  }
  if (snapshot.completedActionEventCount !== 1) {
    throw new Error("Recovered execution emitted duplicate or missing action completion events");
  }
  if (snapshot.verifiedSelftestEvidenceCount < 1) {
    throw new Error("Recovered execution produced no verified local-selftest evidence");
  }
  if (snapshot.evaluationCount !== 1 || snapshot.evaluationEvidenceCoverage <= 0) {
    throw new Error("Recovered execution produced no evidence-backed terminal evaluation");
  }
  if (snapshot.openAssignmentCount !== 0 || snapshot.startedProviderTurnCount !== 0) {
    throw new Error("Recovered execution left ghost assignments or provider turns");
  }
  if (!snapshot.crashProviderTurn
      || !["cancelled", "failed"].includes(snapshot.crashProviderTurn.status)
      || !snapshot.crashProviderTurn.endedAt) {
    throw new Error("The SIGKILL-interrupted planning turn was not closed durably during recovery");
  }
}
