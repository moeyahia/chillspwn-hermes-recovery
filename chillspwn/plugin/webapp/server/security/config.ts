/**
 * Security configuration (Phase 1).
 *
 * Single source of truth for risky-feature gating + network exposure, driven by
 * environment variables with SECURE DEFAULTS. `loadSecurityConfig(env)` is pure
 * w.r.t. its argument (defaults to process.env) so it is fully unit-testable.
 *
 * Operator decisions encoded here (see Phase 0 approval):
 *   - CHILLSPWN_BIND defaults to 127.0.0.1 (loopback / local-only).
 *   - If bound to a non-loopback address, DASHBOARD_TOKEN is REQUIRED.
 *   - If exposed without a token, the server FAILS CLOSED unless
 *     CHILLSPWN_ALLOW_UNSAFE_NO_AUTH=true is explicitly set (with a loud warning).
 *   - Risky features (terminal / proxy / file-write / security tools) default OFF
 *     in code; the live deployment re-enables what it needs via .env (documented
 *     in .env.example + SECURITY.md). This keeps a fresh clone secure-by-default
 *     while preserving the live app's behavior on an explicit, reviewed opt-in.
 *   - Prompt obfuscation (g0dm0d3 / parseltongue) defaults OFF and is legacy.
 */

import type { PolicyConfig } from "../runtime/ToolPolicy";

export interface SecurityConfig {
  // ── network / auth ──
  bindHost: string;
  port: number;
  token: string;
  allowUnsafeNoAuth: boolean;
  /** Derived: bindHost is not a loopback address. */
  exposed: boolean;
  /** Derived: auth should be enforced for non-loopback clients. */
  authActive: boolean;

  // ── risky-feature flags (secure default = off) ──
  enableTerminal: boolean;
  enableProxy: boolean;
  enableFileWrite: boolean;
  enableSecurityTools: boolean;

  // ── approval gates (enforced in Phase 3; recorded here in Phase 1) ──
  requireApprovalForTerminal: boolean;
  requireApprovalForFileWrite: boolean;

  // ── prompt obfuscation (legacy; default off) ──
  enablePromptObfuscation: boolean;

  // ── filesystem scoping ──
  allowedWorkspaceRoots: string[];

  // ── chat ↔ agent-runtime integration (Phase 7; default OFF / observe-only) ──
  enableChatAgentRuns: boolean;
  chatAgentMode: "observe" | "managed";
  chatAgentPlanning: "off" | "preview" | "inferred";
  chatAgentForcePlan: boolean;
  /** Model used for the advisory plan-preview call (Phase 7.2). OpenRouter slug. */
  chatAgentPlanningModel: string;
  /** Phase 7.4: master switch for the optional runtime-managed chat launcher (default off). */
  enableRuntimeManagedChat: boolean;
  /** Phase 7.4: managed runs hold at awaiting_plan_approval until approved (default true). */
  requirePlanApproval: boolean;

  // ── Phase 8: OpenRouter/Codex runtime tool gating (default OFF — risky) ──
  enableOpenrouterRuntimeGating: boolean;
  openrouterGateMode: "off" | "dry-run" | "enforce";
  // Only `deny` is supported: if the runtime gate is unreachable in enforce mode the orchestrator
  // FAILS CLOSED. `allow-read-only` was never implemented in the gate client/patch and was removed (8.1).
  openrouterGateFailMode: "deny";
  openrouterGateTimeoutSeconds: number;
  openrouterGatePollSeconds: number;

  // ── Phases 9-13: additive capabilities (default ON; purely additive — record/display
  // extra data, never change chat / delegation / run OUTCOMES) ──
  enableDelegatedWorkerContract: boolean; // Phase 9
  enableLiveMemoryProposals: boolean; // Phase 10
  enableFinalRunReports: boolean; // Phase 11
  enableArtifactStorage: boolean; // Phase 12
  enableCockpitLiveRefresh: boolean; // Phase 13
  enableTrainingMemory: boolean; // 8.2 — HTB Training Memory (verified attack lessons)

  // ── Phase 14: legacy prompt cleanup (default OFF — only flip after gating+board ownership) ──
  enableLegacyPromptCleanup: boolean;

  // ── Phase 15: specialist agent army + ChillsPwn Commander-in-Chief routing enforcement ──
  enableSpecialistAgentRouting: boolean; // master switch: roster/routing/policy available
  enforceChillspwnDelegation: boolean; // true = DENY ChillsPwn direct specialist-tool use; false = AUDIT only
  allowChillspwnDirectTools: boolean; // escape hatch: permit ChillsPwn direct specialist-tool calls
  requireSpecialistAssignment: boolean; // true = a classified-domain step MUST have an assigned specialist

  // ── Phase 18: hard "no-hands commander" — ChillsPwn may NOT directly run the execution surface ──
  // (terminal/execute_code/process/mcp_execute) or any specialist tool, in chat OR managed runs. It
  // must delegate execution to specialists. Default TRUE (this is a safety rule, not an experiment).
  enforceChillspwnNoHands: boolean;

  // ── Phase 19: hide terminal GENERATED specialist sessions from the default active session list ──
  // (the "Task: …" spam). Non-destructive: sessions stay on disk + show with ?includeClosed=true.
  // Default TRUE. Set ENABLE_SESSION_AUTO_ARCHIVE=false to roll back to showing every session.
  enableSessionAutoArchive: boolean;

  // ── Phase 16: MCP Arsenal Bridge (default OFF — makes staged MCPs executable via the OR/runtime path, never Claude) ──
  enableMcpArsenal: boolean; // master switch
  mcpArsenalConfig: string; // path to .mcp.arsenal.json
  mcpArsenalMode: "disabled" | "dry-run" | "enabled"; // disabled=no bridge; dry-run=validate+record, no exec; enabled=execute allowed tools
  mcpArsenalStartServers: boolean; // allow the bridge to start stdio MCP servers
  mcpArsenalAllowDocker: boolean; // allow starting Docker-based MCP servers
  mcpArsenalDefaultTimeoutSeconds: number;
  mcpArsenalMaxOutputBytes: number;

  // ── Phase 16.2: approval mode (operator-controlled; auto-approval is a RUNTIME policy, not self-approval) ──
  approvalMode: "human" | "auto" | "hybrid"; // human=operator approves; auto=runtime auto-approves policy-passing actions; hybrid=auto low-risk, human high-risk
  autoApproveRiskClasses: string[]; // hybrid: which risk classes auto-approve
  autoApproveToolNames: string[];   // always auto-approve these tools (any mode but human)
  autoApproveAgentIds: string[];    // restrict auto-approval to these agents (empty = all)
  autoApproveMaxRisk: string;       // hybrid: highest risk class that may auto-approve
}

function parseEnum<T extends string>(v: string | undefined, allowed: readonly T[], dflt: T): T {
  return v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : dflt;
}
function parseIntDefault(v: string | undefined, dflt: number): number {
  const n = v !== undefined ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

const DEFAULT_WORKSPACE_ROOTS = [
  "/root/htb/boxes",
  "/root/engagements",
];

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "::ffff:127.0.0.1"]);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

/** True for a remote *client* address (used by the auth middleware / WS guard). */
export function isLoopbackAddr(addr: string | undefined | null): boolean {
  if (!addr) return false;
  const a = addr.trim().toLowerCase();
  return (
    a === "127.0.0.1" ||
    a === "::1" ||
    a === "::ffff:127.0.0.1" ||
    a.startsWith("127.") ||
    a === "localhost"
  );
}

function parseBool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === "") return dflt;
  const t = v.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(t)) return true;
  if (["0", "false", "no", "off"].includes(t)) return false;
  return dflt;
}

function parseList(v: string | undefined, dflt: string[]): string[] {
  if (!v || !v.trim()) return dflt;
  return v
    .split(/[:,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadSecurityConfig(env: NodeJS.ProcessEnv = process.env): SecurityConfig {
  const bindHost = (env.CHILLSPWN_BIND || "127.0.0.1").trim();
  const port = parseInt(env.CHILLSPWN_PORT || "3131", 10) || 3131;
  const token = (env.DASHBOARD_TOKEN || "").trim();
  const allowUnsafeNoAuth = parseBool(env.CHILLSPWN_ALLOW_UNSAFE_NO_AUTH, false);
  const exposed = !isLoopbackHost(bindHost) && bindHost !== "";
  // Enforce auth for non-loopback clients whenever we're exposed OR a token is set.
  const authActive = exposed || token.length > 0;

  return {
    bindHost,
    port,
    token,
    allowUnsafeNoAuth,
    exposed,
    authActive,

    enableTerminal: parseBool(env.ENABLE_TERMINAL, false),
    enableProxy: parseBool(env.ENABLE_PROXY, false),
    enableFileWrite: parseBool(env.ENABLE_FILE_WRITE, false),
    enableSecurityTools: parseBool(env.ENABLE_SECURITY_TOOLS, false),

    requireApprovalForTerminal: parseBool(env.REQUIRE_APPROVAL_FOR_TERMINAL, true),
    requireApprovalForFileWrite: parseBool(env.REQUIRE_APPROVAL_FOR_FILE_WRITE, true),

    enablePromptObfuscation: parseBool(env.ENABLE_PROMPT_OBFUSCATION, false),

    allowedWorkspaceRoots: parseList(env.ALLOWED_WORKSPACE_ROOTS, DEFAULT_WORKSPACE_ROOTS),

    // Phase 7: chat-runtime integration. Default OFF — when off, chat is byte-for-byte
    // unchanged (no AgentRun created, no observer started). observe-only is the only
    // implemented mode; planning/force-plan are placeholders for later sub-phases.
    enableChatAgentRuns: parseBool(env.ENABLE_CHAT_AGENT_RUNS, false),
    chatAgentMode: env.CHAT_AGENT_MODE === "managed" ? "managed" : "observe",
    chatAgentPlanning:
      env.CHAT_AGENT_PLANNING === "preview" || env.CHAT_AGENT_PLANNING === "inferred"
        ? env.CHAT_AGENT_PLANNING
        : "off",
    chatAgentForcePlan: parseBool(env.CHAT_AGENT_FORCE_PLAN, false),
    chatAgentPlanningModel: (env.CHAT_AGENT_PLANNING_MODEL || "z-ai/glm-5.1").trim(),
    // Phase 7.4: runtime-managed chat. Default OFF — launcher hidden; behavior unchanged.
    enableRuntimeManagedChat: parseBool(env.ENABLE_RUNTIME_MANAGED_CHAT, false),
    requirePlanApproval: parseBool(env.REQUIRE_PLAN_APPROVAL, true),

    // Phase 8: OR/Codex gating — OFF by default. Even when the master switch is on, mode
    // gates the behavior (off → no-op; dry-run → record-only; enforce → real allow/deny/wait).
    enableOpenrouterRuntimeGating: parseBool(env.ENABLE_OPENROUTER_RUNTIME_GATING, false),
    openrouterGateMode: parseEnum(env.OPENROUTER_GATE_MODE, ["off", "dry-run", "enforce"] as const, "off"),
    openrouterGateFailMode: parseEnum(env.OPENROUTER_GATE_FAIL_MODE, ["deny"] as const, "deny"),
    openrouterGateTimeoutSeconds: parseIntDefault(env.OPENROUTER_GATE_TIMEOUT_SECONDS, 300),
    openrouterGatePollSeconds: parseIntDefault(env.OPENROUTER_GATE_POLL_SECONDS, 2),

    // Phases 9-13: additive capabilities, ON by default (additive only).
    enableDelegatedWorkerContract: parseBool(env.ENABLE_DELEGATED_WORKER_CONTRACT, true),
    enableLiveMemoryProposals: parseBool(env.ENABLE_LIVE_MEMORY_PROPOSALS, true),
    enableFinalRunReports: parseBool(env.ENABLE_FINAL_RUN_REPORTS, true),
    enableArtifactStorage: parseBool(env.ENABLE_ARTIFACT_STORAGE, true),
    enableCockpitLiveRefresh: parseBool(env.ENABLE_COCKPIT_LIVE_REFRESH, true),
    enableTrainingMemory: parseBool(env.ENABLE_TRAINING_MEMORY, true),

    // Phase 14: legacy prompt cleanup — OFF by default.
    enableLegacyPromptCleanup: parseBool(env.ENABLE_LEGACY_PROMPT_CLEANUP, false),

    // Phase 15: routing available by default; delegation ENFORCEMENT defaults to AUDIT-only so it
    // cannot break the current OR orchestration. Flip ENFORCE_CHILLSPWN_DELEGATION=true +
    // REQUIRE_SPECIALIST_ASSIGNMENT=true to enforce. ALLOW_CHILLSPWN_DIRECT_TOOLS stays false.
    enableSpecialistAgentRouting: parseBool(env.ENABLE_SPECIALIST_AGENT_ROUTING, true),
    enforceChillspwnDelegation: parseBool(env.ENFORCE_CHILLSPWN_DELEGATION, false),
    allowChillspwnDirectTools: parseBool(env.ALLOW_CHILLSPWN_DIRECT_TOOLS, false),
    requireSpecialistAssignment: parseBool(env.REQUIRE_SPECIALIST_ASSIGNMENT, false),

    // Phase 18 — no-hands commander defaults ON. Set ENFORCE_CHILLSPWN_NO_HANDS=false to roll back.
    enforceChillspwnNoHands: parseBool(env.ENFORCE_CHILLSPWN_NO_HANDS, true),

    // Phase 19 — auto-archive terminal specialist sessions from the active list. Default ON.
    enableSessionAutoArchive: parseBool(env.ENABLE_SESSION_AUTO_ARCHIVE, true),

    // Phase 16: MCP Arsenal Bridge — default OFF / disabled. Activate progressively:
    // ENABLE_MCP_ARSENAL=true + MCP_ARSENAL_MODE=dry-run first, then =enabled after validation.
    enableMcpArsenal: parseBool(env.ENABLE_MCP_ARSENAL, false),
    mcpArsenalConfig: (env.MCP_ARSENAL_CONFIG || "/opt/chillspwn-mcp-arsenal/.mcp.arsenal.json").trim(),
    mcpArsenalMode: parseEnum(env.MCP_ARSENAL_MODE, ["disabled", "dry-run", "enabled"] as const, "disabled"),
    mcpArsenalStartServers: parseBool(env.MCP_ARSENAL_START_SERVERS, false),
    mcpArsenalAllowDocker: parseBool(env.MCP_ARSENAL_ALLOW_DOCKER, false),
    mcpArsenalDefaultTimeoutSeconds: parseIntDefault(env.MCP_ARSENAL_DEFAULT_TIMEOUT_SECONDS, 120),
    mcpArsenalMaxOutputBytes: parseIntDefault(env.MCP_ARSENAL_MAX_OUTPUT_BYTES, 20000),

    // Phase 16.2 — approval mode. Default HUMAN (current safe behavior). Runtime-toggleable via API.
    approvalMode: parseEnum(env.APPROVAL_MODE, ["human", "auto", "hybrid"] as const, "human"),
    autoApproveRiskClasses: parseList(env.AUTO_APPROVE_RISK_CLASSES, ["read-only", "network"]),
    autoApproveToolNames: parseList(env.AUTO_APPROVE_TOOL_NAMES, []),
    autoApproveAgentIds: parseList(env.AUTO_APPROVE_AGENT_IDS, []),
    autoApproveMaxRisk: (env.AUTO_APPROVE_MAX_RISK || "network").trim(),
  };
}

/** Map the security config onto the runtime's PolicyConfig (Phase 3 enforcement). */
export function toPolicyConfig(cfg: SecurityConfig): PolicyConfig {
  return {
    enableTerminal: cfg.enableTerminal,
    enableFileWrite: cfg.enableFileWrite,
    enableNetwork: true,
    enableSecurityTools: cfg.enableSecurityTools,
    requireApprovalForTerminal: cfg.requireApprovalForTerminal,
    requireApprovalForFileWrite: cfg.requireApprovalForFileWrite,
    requireStepBinding: true,
  };
}

export interface StartupCheck {
  /** False ⇒ refuse to start (fail closed). */
  ok: boolean;
  /** Present when ok=false: the reason to abort. */
  fatal?: string;
  /** Non-fatal warnings to log loudly at boot. */
  warnings: string[];
}

/**
 * Validate the config at startup. Implements the fail-closed contract:
 * exposed + no token + not explicitly allowed-unsafe ⇒ refuse to start.
 */
export function validateStartup(cfg: SecurityConfig): StartupCheck {
  const warnings: string[] = [];

  if (cfg.exposed && !cfg.token) {
    if (!cfg.allowUnsafeNoAuth) {
      return {
        ok: false,
        warnings,
        fatal:
          `Refusing to start: bound to non-loopback host '${cfg.bindHost}' with no DASHBOARD_TOKEN. ` +
          `Set DASHBOARD_TOKEN, bind to 127.0.0.1, or (UNSAFE) set CHILLSPWN_ALLOW_UNSAFE_NO_AUTH=true.`,
      };
    }
    warnings.push(
      `UNSAFE: exposed on '${cfg.bindHost}' with NO authentication ` +
        `(CHILLSPWN_ALLOW_UNSAFE_NO_AUTH=true). Anyone who can reach the port has full control.`,
    );
  }

  if (cfg.enablePromptObfuscation) {
    warnings.push(
      "ENABLE_PROMPT_OBFUSCATION=true: legacy g0dm0d3/parseltongue prompt rewriting is ACTIVE. " +
        "This is unsafe and non-auditable; it is scheduled for removal. Disable unless you know why.",
    );
  }

  if (cfg.enableTerminal && cfg.exposed && !cfg.requireApprovalForTerminal) {
    warnings.push(
      "ENABLE_TERMINAL=true with REQUIRE_APPROVAL_FOR_TERMINAL=false while exposed: " +
        "remote terminal access is ungated behind only the dashboard token.",
    );
  }

  return { ok: true, warnings };
}
