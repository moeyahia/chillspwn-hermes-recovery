/**
 * Phase 16 — McpArsenalBridge. The single entry point the runtime uses to (a) inspect MCP servers +
 * tools per specialist, (b) health-check them, and (c) EXECUTE an allowed specialist tool against its
 * MCP server. The bridge enforces the tool↔specialist↔server binding + the mode (disabled/dry-run/
 * enabled) + output truncation/redaction. Policy/routing/gate/approval are applied UPSTREAM by the
 * execute endpoint (16.3) before this runs — the bridge is the dispatch + normalization layer.
 *
 * Never touches the Claude path.
 */

import { McpServerRegistry } from "./McpServerRegistry";
import { callServerTool, listServerTools, flattenMcpContent, type ExecOptions } from "./McpToolExecutor";
import type { McpServerSpec, McpToolResult, McpHealthResult } from "./McpTypes";
import { getAgent } from "../agents/agentRoster";
import { mappingFor, specialistToolDecision } from "../agents/agentMcpMap";
import { redactSecrets } from "../runtime/RunReport";

export interface BridgeConfig {
  configPath: string;
  manifestPath: string;
  mode: "disabled" | "dry-run" | "enabled";
  allowDocker: boolean;
  startServers: boolean;
  defaultTimeoutMs: number;
  maxOutputBytes: number;
  /** Test-only owner injection; production omits this and requires UID 0. */
  trustedOwnerUid?: number;
}

export interface SpecialistToolView {
  agentId: string;
  servers: { name: string; state: string; tools: string[]; deniedTools: string[]; approvalRequiredTools: string[]; reasons: string[] }[];
  availableTools: string[];      // tools the specialist could actually run (allowlisted + server healthy/enabled)
  blockedTools: { tool: string; reason: string }[];
}

export class McpArsenalBridge {
  readonly registry: McpServerRegistry;
  constructor(private cfg: BridgeConfig) {
    this.registry = new McpServerRegistry(cfg.configPath, cfg.manifestPath, cfg.trustedOwnerUid);
  }

  get mode() { return this.cfg.mode; }
  isEnabled() { return this.cfg.mode === "enabled"; }
  isDryRun() { return this.cfg.mode === "dry-run"; }
  loadError() { return this.registry.getLoadError(); }
  reload() { this.registry.reload(); }

  listServers(): { spec: McpServerSpec; health: McpHealthResult }[] {
    return this.registry.list().map((spec) => ({ spec, health: this.registry.health(spec.name, { allowDocker: this.cfg.allowDocker }) }));
  }

  health(name: string): McpHealthResult { return this.registry.health(name, { allowDocker: this.cfg.allowDocker }); }
  healthAll(): McpHealthResult[] { return this.registry.list().map((s) => this.registry.health(s.name, { allowDocker: this.cfg.allowDocker })); }

  /** A specialist's MCP tool view: which of its allowlisted tools are actually runnable now. */
  toolsForSpecialist(agentId: string): SpecialistToolView | null {
    const agent = getAgent(agentId);
    const map = mappingFor(agentId);
    if (!agent || !map) return null;
    const servers = this.registry.forAgent(agentId);
    const view: SpecialistToolView = { agentId: agent.agentId, servers: [], availableTools: [], blockedTools: [] };
    for (const s of servers) {
      const h = this.registry.health(s.name, { allowDocker: this.cfg.allowDocker });
      // tools this specialist is allowed AND this server exposes
      const tools = s.toolNames.filter((t) => map.allowedTools.includes(t));
      view.servers.push({ name: s.name, state: h.state, tools, deniedTools: map.deniedTools, approvalRequiredTools: map.approvalRequiredTools.filter((t) => s.toolNames.includes(t)), reasons: h.reasons });
      const runnable = h.state === "healthy" || h.state === "configured";
      for (const t of tools) {
        if (runnable && this.cfg.mode !== "disabled") view.availableTools.push(t);
        else view.blockedTools.push({ tool: t, reason: this.cfg.mode === "disabled" ? "MCP arsenal disabled" : `server ${s.name} ${h.state}: ${h.reasons[0] ?? ""}` });
      }
    }
    return view;
  }

  /**
   * Execute (or dry-run) a specialist tool against its assigned MCP server. Assumes UPSTREAM
   * policy/routing/gate/approval already passed. Still re-verifies the tool↔specialist↔server binding
   * (defense in depth). Returns a normalized, truncated, secret-redacted McpToolResult.
   */
  async execute(input: { specialistAgentId: string; mcpServer: string; toolName: string; arguments?: unknown; startedAtMs: number; signal?: AbortSignal }): Promise<McpToolResult> {
    const base: McpToolResult = { success: false, dryRun: this.isDryRun(), mcpServer: input.mcpServer, toolName: input.toolName, specialistAgentId: input.specialistAgentId, outputPreview: "", fullOutputBytes: 0, artifactId: null, evidenceIds: [], error: null, durationMs: 0, isError: false };
    const fin = (over: Partial<McpToolResult>): McpToolResult => ({ ...base, ...over, durationMs: Math.max(0, (over.durationMs ?? 0)) });

    if (this.cfg.mode === "disabled") return fin({ error: "MCP arsenal is disabled (MCP_ARSENAL_MODE=disabled)" });

    // Defense-in-depth binding checks (the endpoint already enforced policy/routing/gate).
    const decision = specialistToolDecision(input.specialistAgentId, input.toolName);
    if (decision === "unknown_agent") return fin({ error: `unknown specialist '${input.specialistAgentId}'` });
    if (decision === "deny") return fin({ error: `'${input.toolName}' is outside ${input.specialistAgentId}'s allowlist` });
    const spec = this.registry.get(input.mcpServer);
    if (!spec) return fin({ error: `MCP server '${input.mcpServer}' not in arsenal config` });
    if (!spec.assignedAgents.map((a) => a.toLowerCase()).includes(input.specialistAgentId.toLowerCase())) return fin({ error: `server '${input.mcpServer}' is not assigned to ${input.specialistAgentId}` });
    if (!spec.toolNames.includes(input.toolName)) return fin({ error: `'${input.toolName}' is not a declared tool of '${input.mcpServer}'` });

    // DRY-RUN: record what WOULD happen, execute nothing.
    if (this.isDryRun()) {
      return fin({ success: true, dryRun: true, outputPreview: `[dry-run] would call ${input.mcpServer}.${input.toolName}(${redactSecrets(JSON.stringify(input.arguments ?? {})).slice(0, 400)})${decision === "require_approval" ? " [approval-required]" : ""}` });
    }

    // ENABLED: actually call the MCP server.
    if (!this.cfg.startServers) return fin({ error: "MCP_ARSENAL_START_SERVERS=false — server start not permitted" });
    const h = this.registry.health(input.mcpServer, { allowDocker: this.cfg.allowDocker });
    if (h.state === "missing_dependency" || h.state === "missing_secret" || h.state === "failed" || h.state === "disabled") {
      return fin({ error: `server '${input.mcpServer}' not runnable (${h.state}): ${h.reasons.join("; ")}` });
    }
    const opts: ExecOptions = {
      timeoutMs: this.cfg.defaultTimeoutMs,
      allowDocker: this.cfg.allowDocker,
      signal: input.signal,
    };
    const raw = await callServerTool(spec, input.toolName, input.arguments ?? {}, opts);
    const dur = 0; // real ms is stamped by the caller (registry avoids Date.now)
    if (!raw.ok) return fin({ error: raw.error ?? "MCP call failed", durationMs: dur });
    const { text, isError } = flattenMcpContent(raw.result);
    const redacted = redactSecrets(text);
    const fullBytes = Buffer.byteLength(redacted, "utf-8");
    const preview = fullBytes > this.cfg.maxOutputBytes ? redacted.slice(0, this.cfg.maxOutputBytes) + `\n…[truncated ${fullBytes - this.cfg.maxOutputBytes} bytes → artifact]` : redacted;
    return fin({ success: !isError, isError, outputPreview: preview, fullOutputBytes: fullBytes, durationMs: dur, error: isError ? "MCP tool reported an error (see output)" : null });
  }

  /**
   * Phase 16.1 — MCP readiness summary for a specialist's lane/cards. Aggregates the health of the
   * servers assigned to the agent into a single profile + counts. No execution.
   */
  agentMcpStatus(agentId: string): {
    bridgeMode: "disabled" | "dry-run" | "enabled"; profile: string;
    enabledServers: number; disabledServers: number; missingDependency: number; missingSecret: number; dockerRequired: number;
    servers: { name: string; state: string }[];
  } {
    const servers = this.registry.forAgent(agentId);
    const states = servers.map((s) => ({ name: s.name, h: this.registry.health(s.name, { allowDocker: this.cfg.allowDocker }), spec: s }));
    const enabledServers = states.filter((s) => s.spec.enabled).length;
    const disabledServers = states.filter((s) => !s.spec.enabled).length;
    const missingDependency = states.filter((s) => s.h.state === "missing_dependency").length;
    const missingSecret = states.filter((s) => s.h.state === "missing_secret").length;
    const dockerRequired = states.filter((s) => s.spec.runtime === "docker" && !this.cfg.allowDocker).length;
    let profile: string;
    if (this.cfg.mode === "disabled") profile = "disabled";
    else if (!states.length) profile = "bridge_not_active";
    else if (states.some((s) => s.h.state === "healthy")) profile = "healthy";
    else if (states.some((s) => s.spec.enabled && s.h.state === "configured")) profile = this.cfg.mode === "dry-run" ? "dry-run" : "active";
    else if (missingSecret) profile = "missing_secret";
    else if (dockerRequired) profile = "docker_disabled";
    else if (missingDependency) profile = "missing_dependency";
    else profile = "staged";
    return { bridgeMode: this.cfg.mode, profile, enabledServers, disabledServers, missingDependency, missingSecret, dockerRequired, servers: states.map((s) => ({ name: s.name, state: s.h.state })) };
  }

  /** Live tools/list health probe (only in enabled mode + startServers). Safe: no target args. */
  async probeTools(name: string): Promise<{ ok: boolean; tools?: string[]; error?: string }> {
    if (!this.isEnabled() || !this.cfg.startServers) return { ok: false, error: "probe requires enabled mode + start permission" };
    const spec = this.registry.get(name);
    if (!spec) return { ok: false, error: "unknown server" };
    const raw = await listServerTools(spec, { timeoutMs: this.cfg.defaultTimeoutMs, allowDocker: this.cfg.allowDocker });
    if (!raw.ok) return { ok: false, error: raw.error };
    const tools = Array.isArray(raw.result?.tools) ? raw.result.tools.map((t: any) => t.name).filter(Boolean) : [];
    return { ok: true, tools };
  }
}
