/**
 * ToolPolicy — risk classification + (Phase 3) enforcement for tool calls.
 *
 * Phase 1 ships the DATA (a tool→risk table + an offensive-command classifier) and
 * the pure decision function. It is NOT yet wired to block live tool calls — that
 * enforcement, plus the approval gates, lands in Phase 3. Shipping it now lets the
 * security defaults be unit-tested and gives the runtime a single source of truth
 * for "how risky is this and is it allowed under the current policy".
 *
 * Decoupled from server/security/config.ts on purpose: security/config builds a
 * PolicyConfig from its flags, but the runtime never imports the security layer.
 */

import { type RiskLevel } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Tool → risk classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Known tool names mapped to their risk level. Covers both the OpenRouter/Codex
 * orchestrator tool set and the Claude CLI tool set. Unknown tools fall back to
 * the most conservative interpretation (see `classifyTool`).
 */
const TOOL_RISK: Record<string, RiskLevel> = {
  // ── terminal / arbitrary code execution ──
  terminal: "terminal",
  execute_code: "terminal",
  process: "terminal",
  bash: "terminal",
  delegate_task: "terminal", // spawns a child agent that can run anything

  // ── file write / mutation ──
  write_file: "file-write",
  patch: "file-write",
  write: "file-write",
  edit: "file-write",
  notebookedit: "file-write",
  skill_manage: "file-write", // writes/patches SKILL.md
  remember: "file-write", // writes durable memory
  board_create_task: "file-write", // mutates the board (dispatched agent governed separately)
  board_update: "file-write",

  // ── network ──
  web_search: "network",
  web_extract: "network",
  websearch: "network",
  webfetch: "network",

  // ── read-only ──
  read_file: "read-only",
  search_files: "read-only",
  read: "read-only",
  glob: "read-only",
  grep: "read-only",
  recall_conversation: "read-only",
  use_skill: "read-only",
  board_list: "read-only",
  board_await: "read-only",
};

/**
 * Offensive / credential-sensitive command tokens. Because pentest tools execute
 * THROUGH `terminal`/`bash`, a tool-name lookup can't catch them — we scan the
 * command string for these tokens. Includes both raw tool names and the ChillsPwn
 * UPPERCASE aliases (see chillspwn-arsenal-aliases). Used by the
 * ENABLE_SECURITY_TOOLS gate in Phase 3.
 */
const OFFENSIVE_TOKENS: readonly string[] = [
  // raw offensive tool names
  "nmap", "masscan", "rustscan", "nikto", "sqlmap", "hydra", "medusa", "ncrack",
  "hashcat", "john", "responder", "impacket", "evil-winrm", "crackmapexec", "nxc",
  "metasploit", "msfconsole", "msfvenom", "bloodhound", "certipy", "kerbrute",
  "secretsdump", "ntlmrelayx", "wpscan", "ffuf", "gobuster", "feroxbuster",
  // ChillsPwn UPPERCASE aliases (offensive subset)
  "SURFACE", "WIDE", "PEEK", "AUDIT", "QUERY", "RETRY", "ROUND", "REPEAT", "MATCH",
  "GUESS", "LISTEN", "RELAY", "ENTER", "DESK", "CRAFT", "ROAST", "ASREP", "KEEP",
  "STEP", "TASK", "GRAPH", "TRACE", "PKI", "KERBEROS", "SILVER", "TICKET", "GPU",
];

/** Credential-material tokens — surface a stricter risk level when present. */
const CREDENTIAL_TOKENS: readonly string[] = [
  "secretsdump", "KEEP", "/etc/shadow", "ntds.dit", "lsass", "sam.hive",
  "hashcat", "MATCH", ".kirbi", ".ccache", "dpapi", "DPAPI",
];

/** Classify a tool by name. Unknown tools default to `terminal` (conservative). */
export function classifyTool(toolName: string): RiskLevel {
  const key = toolName.trim().toLowerCase();
  return TOOL_RISK[key] ?? "terminal";
}

/** True if a terminal command appears to invoke offensive security tooling. */
export function isSecuritySensitiveCommand(command: string): boolean {
  if (!command) return false;
  return OFFENSIVE_TOKENS.some((tok) => commandHasToken(command, tok));
}

/** True if a command appears to touch credential material. */
export function isCredentialSensitiveCommand(command: string): boolean {
  if (!command) return false;
  return CREDENTIAL_TOKENS.some((tok) => commandHasToken(command, tok));
}

function commandHasToken(command: string, token: string): boolean {
  // UPPERCASE aliases are matched case-sensitively on a word boundary (so "STEP"
  // doesn't match "stepwise"); raw lowercase names are matched case-insensitively.
  const isAlias = token === token.toUpperCase() && /[A-Z]/.test(token);
  const flags = isAlias ? "" : "i";
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`, flags).test(command);
}

// ─────────────────────────────────────────────────────────────────────────────
// Policy decision (pure; enforcement wired in Phase 3)
// ─────────────────────────────────────────────────────────────────────────────

/** Runtime-facing policy config. security/config.ts maps its flags onto this. */
export interface PolicyConfig {
  enableTerminal: boolean;
  enableFileWrite: boolean;
  enableNetwork: boolean;
  enableSecurityTools: boolean;
  requireApprovalForTerminal: boolean;
  requireApprovalForFileWrite: boolean;
  /** When true, a tool call lacking a stepId is denied (Phase 2/3 step-binding). */
  requireStepBinding: boolean;
}

export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  enableTerminal: false,
  enableFileWrite: false,
  enableNetwork: true,
  enableSecurityTools: false,
  requireApprovalForTerminal: true,
  requireApprovalForFileWrite: true,
  requireStepBinding: true,
};

export type ToolDecisionAction = "allow" | "deny" | "require_approval";

export interface ToolDecision {
  action: ToolDecisionAction;
  riskLevel: RiskLevel;
  reason: string;
}

export interface ToolDecisionInput {
  toolName: string;
  /** Null when the model issued a tool call outside any plan step. */
  stepId: string | null;
  /** If provided, the step's tool allow-list; toolName must be a member. */
  allowedTools?: string[];
  /** For terminal tools, the command string (enables offensive-tool gating). */
  command?: string;
}

/**
 * Decide whether a tool call may proceed under the given policy. Pure function —
 * deterministic from its inputs. Phase 3 calls this before executing any tool.
 */
export function decideTool(input: ToolDecisionInput, policy: PolicyConfig): ToolDecision {
  const riskLevel = classifyTool(input.toolName);

  if (policy.requireStepBinding && !input.stepId) {
    return {
      action: "deny",
      riskLevel,
      reason: "tool call is not bound to a plan step (stepId required)",
    };
  }

  if (input.allowedTools && !input.allowedTools.includes(input.toolName)) {
    return {
      action: "deny",
      riskLevel,
      reason: `tool '${input.toolName}' is not in the step's allowed tools`,
    };
  }

  // Security-sensitive command gate (applies to terminal-class tools).
  if (
    (riskLevel === "terminal") &&
    input.command &&
    isSecuritySensitiveCommand(input.command) &&
    !policy.enableSecurityTools
  ) {
    return {
      action: "deny",
      riskLevel: isCredentialSensitiveCommand(input.command)
        ? "credential-sensitive"
        : "exploit-sensitive",
      reason: "security/offensive tooling is disabled (ENABLE_SECURITY_TOOLS=false)",
    };
  }

  switch (riskLevel) {
    case "terminal":
      if (!policy.enableTerminal) {
        return { action: "deny", riskLevel, reason: "terminal execution disabled (ENABLE_TERMINAL=false)" };
      }
      return policy.requireApprovalForTerminal
        ? { action: "require_approval", riskLevel, reason: "terminal execution requires approval" }
        : { action: "allow", riskLevel, reason: "terminal allowed by policy" };

    case "file-write":
      if (!policy.enableFileWrite) {
        return { action: "deny", riskLevel, reason: "file writes disabled (ENABLE_FILE_WRITE=false)" };
      }
      return policy.requireApprovalForFileWrite
        ? { action: "require_approval", riskLevel, reason: "file write requires approval" }
        : { action: "allow", riskLevel, reason: "file write allowed by policy" };

    case "network":
      return policy.enableNetwork
        ? { action: "allow", riskLevel, reason: "network access allowed by policy" }
        : { action: "deny", riskLevel, reason: "network access disabled" };

    case "destructive":
    case "credential-sensitive":
    case "exploit-sensitive":
      return { action: "require_approval", riskLevel, reason: `${riskLevel} action requires approval` };

    case "read-only":
    default:
      return { action: "allow", riskLevel, reason: "read-only / low-risk" };
  }
}
