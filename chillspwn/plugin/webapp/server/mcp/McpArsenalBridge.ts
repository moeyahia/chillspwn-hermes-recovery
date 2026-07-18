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
import {
  createMcpExecutionBinding,
  validateMcpApprovalAttestation,
  type McpApprovalAttestation,
  type McpApprovalAttestationVerifier,
} from "./McpApprovalAttestation";
import {
  isMcpToolExposable,
  resolvedMcpToolExecutionDecision,
  reviewedMcpServerSurface,
  reviewedMcpToolDisposition,
} from "./McpToolDispositionRegistry";
import { adaptVulnIntelCveMcpContent } from "./VulnIntelCveResultAdapter";
import { adaptPentestReconMcpContent } from "./PentestReconResultAdapter";
import {
  isExactFullTcpNmapSelection,
  validatePentestReconToolPolicy,
} from "./PentestReconToolPolicy";
import { attestMcpServerImplementation } from "./McpServerImplementationAttestation";

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
  /**
   * Trusted durable consume boundary for approval-required execution. It must
   * atomically verify and consume the exact claim; a passive boolean check is
   * intentionally not supported.
   */
  verifyAndConsumeApprovalAttestation?: McpApprovalAttestationVerifier;
  /** Test-only clock injection. */
  now?: () => Date;
  /** Test-only trusted-tool readiness injection; production always omits it. */
  trustedNmapReady?: boolean;
  /** Test-only implementation attestation injection; production always omits it. */
  attestImplementation?: typeof attestMcpServerImplementation;
}

export interface McpBridgeExecuteInput {
  readonly runId?: string;
  readonly stepId?: string;
  readonly specialistAgentId: string;
  readonly mcpServer: string;
  readonly toolName: string;
  readonly arguments?: unknown;
  readonly startedAtMs: number;
  readonly signal?: AbortSignal;
  readonly approvalAttestation?: McpApprovalAttestation;
}

export interface SpecialistToolView {
  agentId: string;
  servers: { name: string; state: string; tools: string[]; deniedTools: string[]; approvalRequiredTools: string[]; reasons: string[] }[];
  availableTools: string[];      // tools the specialist could actually run (allowlisted + server healthy/enabled)
  blockedTools: { tool: string; reason: string }[];
}

export class McpArsenalBridge {
  readonly registry: McpServerRegistry;
  readonly #claimsInFlight = new Set<string>();
  readonly #consumedClaims = new Map<string, number>();
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
      const tools = s.toolNames.filter((toolName) => {
        if (!map.allowedTools.includes(toolName)) return false;
        const review = reviewedMcpServerSurface(s.name);
        if (!review) return true;
        const disposition = reviewedMcpToolDisposition(s.name, toolName);
        return Boolean(
          disposition
          && isMcpToolExposable(disposition.disposition)
          && disposition.mappedAgentIds.includes(agent.agentId),
        );
      });
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
   * Execute (or dry-run) a specialist tool against its assigned MCP server. It
   * re-verifies the tool↔specialist↔server binding and independently requires
   * an exact, durable, one-time attestation for approval-required tools.
   */
  async execute(input: McpBridgeExecuteInput): Promise<McpToolResult> {
    const base: McpToolResult = { success: false, dryRun: this.isDryRun(), mcpServer: input.mcpServer, toolName: input.toolName, specialistAgentId: input.specialistAgentId, outputPreview: "", fullOutputBytes: 0, artifactId: null, evidenceIds: [], error: null, durationMs: 0, isError: false };
    const fin = (over: Partial<McpToolResult>): McpToolResult => ({ ...base, ...over, durationMs: Math.max(0, (over.durationMs ?? 0)) });

    if (this.cfg.mode === "disabled") return fin({ error: "MCP arsenal is disabled (MCP_ARSENAL_MODE=disabled)" });

    // Defense-in-depth binding checks (the endpoint already enforced policy/routing/gate).
    const rosterDecision = specialistToolDecision(input.specialistAgentId, input.toolName);
    if (rosterDecision === "unknown_agent") return fin({ error: `unknown specialist '${input.specialistAgentId}'` });
    if (rosterDecision === "deny") return fin({ error: `'${input.toolName}' is outside ${input.specialistAgentId}'s allowlist` });
    const specialist = getAgent(input.specialistAgentId);
    if (!specialist?.allowedMcpServers.includes(input.mcpServer)) {
      return fin({ error: `MCP server '${input.mcpServer}' is outside ${input.specialistAgentId}'s server allowlist` });
    }
    const spec = this.registry.get(input.mcpServer);
    if (!spec) return fin({ error: `MCP server '${input.mcpServer}' not in arsenal config` });
    if (!spec.assignedAgents.map((a) => a.toLowerCase()).includes(input.specialistAgentId.toLowerCase())) return fin({ error: `server '${input.mcpServer}' is not assigned to ${input.specialistAgentId}` });
    if (!spec.toolNames.includes(input.toolName)) return fin({ error: `'${input.toolName}' is not a declared tool of '${input.mcpServer}'` });
    const reviewedServer = reviewedMcpServerSurface(input.mcpServer);
    const reviewedTool = reviewedMcpToolDisposition(input.mcpServer, input.toolName);
    if (reviewedServer && (!reviewedTool || !isMcpToolExposable(reviewedTool.disposition))) {
      return fin({ error: `'${input.toolName}' is suppressed by the reviewed MCP tool disposition registry` });
    }
    if (reviewedTool && !reviewedTool.mappedAgentIds.includes(input.specialistAgentId)) {
      return fin({ error: `'${input.toolName}' is not mapped to ${input.specialistAgentId} in the reviewed MCP tool disposition registry` });
    }
    const decision = resolvedMcpToolExecutionDecision(
      input.mcpServer,
      input.toolName,
      input.specialistAgentId,
      rosterDecision,
    );
    if (decision === "deny") return fin({ error: `'${input.toolName}' is denied for this reviewed MCP server binding` });
    const policyOptions = {
      currentYear: (this.cfg.now ?? (() => new Date()))().getUTCFullYear(),
      ...(this.cfg.trustedNmapReady === undefined
        ? {}
        : { trustedNmapReady: this.cfg.trustedNmapReady }),
    };
    const inputPolicyError = validatePentestReconToolPolicy(
      input.mcpServer,
      input.toolName,
      input.arguments ?? {},
      policyOptions,
    );
    const contractBoundFullTcp = Boolean(
      inputPolicyError
      && this.isEnabled()
      && input.mcpServer === "pentest-mcp-recon"
      && input.toolName === "nmapScan"
      && input.approvalAttestation?.kind === "autonomous_full_tcp"
      && isExactFullTcpNmapSelection(input.arguments ?? {}),
    );
    if (inputPolicyError && !contractBoundFullTcp) {
      return fin({ error: `invalid input: ${inputPolicyError}` });
    }
    if (contractBoundFullTcp) {
      const fullTcpPolicyError = validatePentestReconToolPolicy(
        input.mcpServer,
        input.toolName,
        input.arguments ?? {},
        { ...policyOptions, allowAttestedExactFullTcp: true },
      );
      if (fullTcpPolicyError) return fin({ error: `invalid input: ${fullTcpPolicyError}` });
    }
    const dispositionRequiresApproval = reviewedTool?.disposition === "guided_only";

    // DRY-RUN: record what WOULD happen, execute nothing.
    if (this.isDryRun()) {
      return fin({ success: true, dryRun: true, outputPreview: `[dry-run] would call ${input.mcpServer}.${input.toolName}(${redactSecrets(JSON.stringify(input.arguments ?? {})).slice(0, 400)})${decision === "require_approval" || dispositionRequiresApproval ? " [approval-required]" : ""}` });
    }

    // ENABLED: actually call the MCP server.
    if (!this.cfg.startServers) return fin({ error: "MCP_ARSENAL_START_SERVERS=false — server start not permitted" });
    const implementation = (this.cfg.attestImplementation ?? attestMcpServerImplementation)(spec);
    if (!implementation.accepted) {
      return fin({ error: `server '${input.mcpServer}' implementation attestation failed: ${implementation.reason}` });
    }
    const h = this.registry.health(input.mcpServer, { allowDocker: this.cfg.allowDocker });
    if (h.state === "missing_dependency" || h.state === "missing_secret" || h.state === "failed" || h.state === "disabled") {
      return fin({ error: `server '${input.mcpServer}' not runnable (${h.state}): ${h.reasons.join("; ")}` });
    }
    if (
      decision === "require_approval"
      || dispositionRequiresApproval
      || input.approvalAttestation
      || contractBoundFullTcp
    ) {
      if (!input.runId || !input.stepId) {
        return fin({ error: "approval-required MCP execution must be bound to a run and step" });
      }
      const binding = createMcpExecutionBinding({
        runId: input.runId,
        stepId: input.stepId,
        specialistAgentId: input.specialistAgentId,
        mcpServer: input.mcpServer,
        toolName: input.toolName,
        arguments: input.arguments,
      });
      const verifiedAt = (this.cfg.now ?? (() => new Date()))().toISOString();
      const invalid = validateMcpApprovalAttestation(input.approvalAttestation, binding, verifiedAt);
      if (invalid) return fin({ error: `approval denied: ${invalid}` });
      const attestation = input.approvalAttestation!;
      this.#pruneConsumedClaims(Date.parse(verifiedAt));
      if (this.#claimsInFlight.has(attestation.claimId) || this.#consumedClaims.has(attestation.claimId)) {
        return fin({ error: "approval denied: approval attestation was already consumed" });
      }
      const verifier = this.cfg.verifyAndConsumeApprovalAttestation;
      if (!verifier) return fin({ error: "approval denied: durable approval verifier is unavailable" });
      this.#claimsInFlight.add(attestation.claimId);
      try {
        const verification = await verifier({ attestation, binding, verifiedAt });
        if (!verification.approved) {
          return fin({ error: `approval denied: ${redactSecrets(verification.reason).slice(0, 500)}` });
        }
        this.#consumedClaims.set(attestation.claimId, Date.parse(attestation.expiresAt));
      } catch {
        return fin({ error: "approval denied: durable approval verification failed" });
      } finally {
        this.#claimsInFlight.delete(attestation.claimId);
      }
    }
    if (contractBoundFullTcp) {
      // Re-run the structured policy after the canonical verifier atomically
      // consumes the issued claim. Until this point the ordinary 1,024-port
      // boundary remains authoritative and no full-TCP dispatch may occur.
      const fullTcpPolicyError = validatePentestReconToolPolicy(
        input.mcpServer,
        input.toolName,
        input.arguments ?? {},
        { ...policyOptions, allowAttestedExactFullTcp: true },
      );
      if (fullTcpPolicyError) return fin({ error: `invalid input: ${fullTcpPolicyError}` });
    }
    const opts: ExecOptions = {
      timeoutMs: this.cfg.defaultTimeoutMs,
      allowDocker: this.cfg.allowDocker,
      signal: input.signal,
    };
    const raw = await callServerTool(spec, input.toolName, input.arguments ?? {}, opts);
    const dur = 0; // real ms is stamped by the caller (registry avoids Date.now)
    if (!raw.ok) return fin({ error: raw.error ?? "MCP call failed", durationMs: dur });
    const vulnIntelContent = adaptVulnIntelCveMcpContent(
      input.mcpServer,
      input.toolName,
      flattenMcpContent(raw.result),
    );
    const { text, isError } = adaptPentestReconMcpContent(
      input.mcpServer,
      input.toolName,
      vulnIntelContent,
    );
    const redacted = redactSecrets(text);
    const fullBytes = Buffer.byteLength(redacted, "utf-8");
    const preview = fullBytes > this.cfg.maxOutputBytes ? redacted.slice(0, this.cfg.maxOutputBytes) + `\n…[truncated ${fullBytes - this.cfg.maxOutputBytes} bytes → artifact]` : redacted;
    return fin({ success: !isError, isError, outputPreview: preview, fullOutputBytes: fullBytes, durationMs: dur, error: isError ? "MCP tool reported an error (see output)" : null });
  }

  #pruneConsumedClaims(nowMs: number): void {
    for (const [claimId, expiresAtMs] of this.#consumedClaims) {
      if (expiresAtMs <= nowMs) this.#consumedClaims.delete(claimId);
    }
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
  async probeTools(name: string, signal?: AbortSignal): Promise<{
    ok: boolean;
    tools?: string[];
    toolSchemas?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    error?: string;
  }> {
    if (!this.isEnabled() || !this.cfg.startServers) return { ok: false, error: "probe requires enabled mode + start permission" };
    const spec = this.registry.get(name);
    if (!spec) return { ok: false, error: "unknown server" };
    const implementation = attestMcpServerImplementation(spec);
    if (!implementation.accepted) {
      return { ok: false, error: `MCP implementation attestation failed: ${implementation.reason}` };
    }
    const raw = await listServerTools(spec, {
      timeoutMs: this.cfg.defaultTimeoutMs,
      allowDocker: this.cfg.allowDocker,
      signal,
    });
    if (!raw.ok) return { ok: false, error: raw.error };
    if (!Array.isArray(raw.result?.tools) || raw.result.tools.length > 256) {
      return { ok: false, error: "MCP tools/list returned an invalid or oversized tool collection" };
    }
    const tools: string[] = [];
    const toolSchemas: Record<string, Readonly<Record<string, unknown>>> = Object.create(null) as Record<
      string,
      Readonly<Record<string, unknown>>
    >;
    for (const item of raw.result.tools as unknown[]) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return { ok: false, error: "MCP tools/list returned an invalid tool descriptor" };
      }
      const descriptor = item as Record<string, unknown>;
      const toolName = typeof descriptor.name === "string" ? descriptor.name.trim() : "";
      const inputSchema = descriptor.inputSchema;
      if (
        !/^[A-Za-z0-9._:-]{1,160}$/u.test(toolName)
        || !inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)
      ) {
        return { ok: false, error: "MCP tools/list omitted a usable tool name or input schema" };
      }
      let serialized: string;
      try { serialized = JSON.stringify(inputSchema); }
      catch { return { ok: false, error: "MCP tools/list returned a non-serializable input schema" }; }
      if (Buffer.byteLength(serialized, "utf8") > 128 * 1024) {
        return { ok: false, error: "MCP tool input schema exceeds the reviewed attestation bound" };
      }
      if (tools.includes(toolName)) return { ok: false, error: "MCP tools/list returned duplicate tool names" };
      tools.push(toolName);
      toolSchemas[toolName] = JSON.parse(serialized) as Readonly<Record<string, unknown>>;
    }
    return { ok: true, tools, toolSchemas };
  }
}
