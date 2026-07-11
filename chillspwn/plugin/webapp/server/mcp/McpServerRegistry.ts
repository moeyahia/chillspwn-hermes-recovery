/**
 * Phase 16 — McpServerRegistry. Loads the staged arsenal config + the manifest, derives each MCP
 * server's runtime spec (incl. a stdio start command where known), and computes its health state.
 * Pure of side effects beyond reading files + checking binary/docker/env presence (NO target scans).
 */

import { existsSync, readFileSync } from "fs";
import { execFileSync } from "child_process";
import type { McpServerSpec, McpServerState, McpHealthResult, McpRuntimeType } from "./McpTypes";

const VENDOR = "/opt/chillspwn-mcp-arsenal";

function nowIso(): string { return new Date(0).toISOString().replace("1970-01-01T00:00:00.000Z", "checked"); }
// (avoid Date.now; callers stamp real time — registry only needs a marker)

/** Best-effort stdio start command per known server (only the light, local ones are runnable). */
function deriveCommand(name: string, runtime: McpRuntimeType): Pick<McpServerSpec, "command" | "args" | "cwd"> {
  switch (name) {
    case "pentest-mcp-server-ssh":
      return { command: `${VENDOR}/pentest-mcp-server/.venv/bin/python`, args: ["-m", "pentest_mcp_server"], cwd: `${VENDOR}/pentest-mcp-server` };
    case "pentest-mcp-recon":
      return { command: "node", args: ["build/index.js"], cwd: `${VENDOR}/pentest-mcp` };
    default:
      if (runtime === "docker") return {}; // started via `docker run -i --rm <image>` only when allowed
      return {};
  }
}

function normRuntime(rt: string): McpRuntimeType {
  if (["stdio", "node", "python", "docker", "http", "registry", "builtin"].includes(rt)) return rt as McpRuntimeType;
  return "stdio";
}

export class McpServerRegistry {
  private specs: McpServerSpec[] = [];
  private loadError: string | null = null;

  constructor(private readonly configPath: string, private readonly manifestPath?: string) {
    this.reload();
  }

  reload(): void {
    this.specs = [];
    this.loadError = null;
    try {
      if (!existsSync(this.configPath)) { this.loadError = `arsenal config not found: ${this.configPath}`; return; }
      const cfg = JSON.parse(readFileSync(this.configPath, "utf-8"));
      const manifest = this.manifestPath && existsSync(this.manifestPath) ? JSON.parse(readFileSync(this.manifestPath, "utf-8")) : { servers: [] };
      const byName: Record<string, any> = Object.fromEntries((manifest.servers || []).map((s: any) => [s.mcpServerName, s]));
      for (const [name, raw] of Object.entries<any>(cfg.mcpServers || {})) {
        const m = byName[name] || {};
        const runtime = normRuntime(raw.runtime || m.runtimeType || "stdio");
        this.specs.push({
          name,
          runtime,
          enabled: raw.enabled === true,
          assignedAgents: raw.assignedAgents || m.assignedAgents || [],
          requiredBinaries: raw.requiredBinaries || m.requiredBinaries || [],
          requiredDockerImages: raw.requiredDockerImages || m.requiredDockerImages || [],
          requiredEnv: Object.keys(raw.envTemplate || {}).length ? Object.keys(raw.envTemplate) : (m.requiredEnv || []),
          apiKeysRequired: raw.apiKeysRequired || m.apiKeysRequired || [],
          installMethod: raw.installMethod || m.installMethod || "",
          // config toolNames win (they reflect the INSTALLED server's real tool surface).
          toolNames: (Array.isArray(raw.toolNames) && raw.toolNames.length ? raw.toolNames : m.toolNames) || [],
          riskClass: m.riskClass,
          // config-provided command wins over the derived default (lets an active config pin the
          // exact start command for an installed server).
          ...deriveCommand(name, runtime),
          ...(typeof raw.command === "string" ? { command: raw.command, args: Array.isArray(raw.args) ? raw.args : [], cwd: typeof raw.cwd === "string" ? raw.cwd : undefined } : {}),
          ...(raw.env && typeof raw.env === "object" ? { env: raw.env as Record<string, string> } : {}),
        });
      }
    } catch (e) {
      this.loadError = `failed to load arsenal config: ${(e as Error).message}`;
    }
  }

  getLoadError(): string | null { return this.loadError; }
  list(): McpServerSpec[] { return this.specs; }
  get(name: string): McpServerSpec | null { return this.specs.find((s) => s.name === name) ?? null; }
  /** Servers assigned to a specialist (regardless of enabled/health). */
  forAgent(agentId: string): McpServerSpec[] {
    return this.specs.filter((s) => s.assignedAgents.map((a) => a.toLowerCase()).includes(agentId.toLowerCase()));
  }

  private binaryPresent(bin: string): boolean {
    try { execFileSync("bash", ["-lc", `command -v ${JSON.stringify(bin).slice(1, -1)} >/dev/null 2>&1`], { stdio: "ignore" }); return true; } catch { return false; }
  }
  private dockerImagePresent(img: string): boolean {
    try { execFileSync("docker", ["image", "inspect", img], { stdio: "ignore", timeout: 5000 }); return true; } catch { return false; }
  }

  /**
   * Compute a server's health state WITHOUT scanning any target. Checks: enabled, required binaries,
   * required docker images, required env present. Optionally a live tools/list is layered on by the
   * bridge (passing toolCount). `env` defaults to process.env (names only are inspected).
   */
  health(name: string, opts: { allowDocker?: boolean; env?: NodeJS.ProcessEnv } = {}): McpHealthResult {
    const env = opts.env ?? process.env;
    const s = this.get(name);
    const base: McpHealthResult = { name, state: "disabled", reasons: [], missingBinaries: [], missingEnv: [], missingDockerImages: [], toolCount: null, checkedAt: nowIso() };
    if (!s) { base.state = "failed"; base.reasons.push("server not found in config"); return base; }
    if (!s.enabled) { base.state = "disabled"; base.reasons.push("enabled:false in arsenal config"); return base; }

    base.missingBinaries = s.requiredBinaries.filter((b) => !this.binaryPresent(b));
    base.missingEnv = s.requiredEnv.filter((k) => !env[k]);
    base.missingDockerImages = s.runtime === "docker"
      ? (opts.allowDocker ? s.requiredDockerImages.filter((i) => !this.dockerImagePresent(i)) : s.requiredDockerImages)
      : [];

    if (base.missingBinaries.length) { base.state = "missing_dependency"; base.reasons.push(`missing binaries: ${base.missingBinaries.join(", ")}`); }
    if (s.runtime === "docker" && !opts.allowDocker) { base.state = "missing_dependency"; base.reasons.push("docker MCP — requires MCP_ARSENAL_ALLOW_DOCKER=true + a built image"); }
    else if (base.missingDockerImages.length) { base.state = "missing_dependency"; base.reasons.push(`missing docker images (run a build): ${base.missingDockerImages.join(", ")}`); }
    if (base.missingEnv.length || s.apiKeysRequired.length && s.requiredEnv.length === 0 && base.missingEnv.length) {
      // keys with no env template still flagged
    }
    if (base.missingEnv.length) { base.state = "missing_secret"; base.reasons.push(`missing env/keys: ${base.missingEnv.join(", ")}`); }
    if (base.state === "disabled") base.state = "configured"; // enabled + nothing missing yet
    if (!base.reasons.length) base.reasons.push("dependencies present; ready to start");
    return base;
  }
}
