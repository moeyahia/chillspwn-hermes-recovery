/**
 * Phase 16 — McpServerRegistry. Loads the staged arsenal config + the manifest, derives each MCP
 * server's runtime spec (incl. a stdio start command where known), and computes its health state.
 * Pure of side effects beyond reading files + checking binary/docker/env presence (NO target scans).
 */

import { accessSync, constants, existsSync, lstatSync, readFileSync, realpathSync, statSync } from "fs";
import { execFileSync } from "child_process";
import { dirname, isAbsolute, join } from "path";
import type { McpServerSpec, McpServerState, McpHealthResult, McpRuntimeType } from "./McpTypes";

const VENDOR = "/opt/chillspwn-mcp-arsenal";
const SAFE_ENV_KEYS = new Set(["MCP_TRANSPORT", "NODE_ENV", "PYTHONUNBUFFERED"]);

function assertTrustedDirectoryChain(path: string, label: string, trustedOwnerUid: number): void {
  let current = realpathSync(path);
  while (true) {
    const state = statSync(current);
    if (!state.isDirectory() || ![0, trustedOwnerUid].includes(state.uid) || (state.mode & 0o022) !== 0) {
      throw new Error(`${label} crosses a directory not controlled by the trusted owner`);
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function assertRootControlledFile(path: string, label: string, trustedOwnerUid = 0): string {
  if (!isAbsolute(path)) throw new Error(`${label} must be absolute`);
  const lexical = lstatSync(path);
  if (!lexical.isFile() || lexical.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file`);
  const resolved = realpathSync(path);
  const file = statSync(resolved);
  if (![0, trustedOwnerUid].includes(file.uid) || (file.mode & 0o022) !== 0) {
    throw new Error(`${label} must be root-owned and not writable by group/other`);
  }
  assertTrustedDirectoryChain(dirname(resolved), label, trustedOwnerUid);
  return resolved;
}

function assertRootControlledDirectory(path: string, label: string, trustedOwnerUid = 0): string {
  if (!isAbsolute(path)) throw new Error(`${label} must be absolute`);
  const lexical = lstatSync(path);
  if (!lexical.isDirectory() || lexical.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink directory`);
  }
  assertTrustedDirectoryChain(dirname(path), label, trustedOwnerUid);
  const resolved = realpathSync(path);
  const stat = statSync(resolved);
  if (!stat.isDirectory() || ![0, trustedOwnerUid].includes(stat.uid) || (stat.mode & 0o022) !== 0) {
    throw new Error(`${label} must be a root-owned directory not writable by group/other`);
  }
  assertTrustedDirectoryChain(resolved, label, trustedOwnerUid);
  return resolved;
}

function resolveTrustedBinary(bin: string, trustedOwnerUid = 0): string | null {
  if (typeof bin !== "string" || !bin || bin.length > 4096 || bin.includes("\0")) return null;
  const candidates = isAbsolute(bin)
    ? [bin]
    : /^[A-Za-z0-9._+-]+$/.test(bin)
      ? String(process.env.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
          .split(":")
          .filter(Boolean)
          .map((dir) => join(dir, bin))
      : [];
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      const lexical = lstatSync(candidate);
      if (![0, trustedOwnerUid].includes(lexical.uid)) continue;
      if (!lexical.isFile() && !lexical.isSymbolicLink()) continue;
      if (lexical.isFile() && (lexical.mode & 0o022) !== 0) continue;
      assertTrustedDirectoryChain(dirname(candidate), `MCP executable '${bin}'`, trustedOwnerUid);
      const resolved = realpathSync(candidate);
      const file = statSync(resolved);
      if (file.isFile() && [0, trustedOwnerUid].includes(file.uid) && (file.mode & 0o022) === 0) {
        assertTrustedDirectoryChain(dirname(resolved), `MCP executable '${bin}'`, trustedOwnerUid);
        return resolved;
      }
    } catch { /* try the next PATH entry */ }
  }
  return null;
}

function sanitizedEnv(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!SAFE_ENV_KEYS.has(key) || typeof value !== "string" || value.length > 1024 || value.includes("\0")) {
      throw new Error(`unsupported MCP process environment key '${key}'`);
    }
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

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

  constructor(
    private readonly configPath: string,
    private readonly manifestPath?: string,
    private readonly trustedOwnerUid = 0,
  ) {
    this.reload();
  }

  reload(): void {
    this.specs = [];
    this.loadError = null;
    try {
      if (!existsSync(this.configPath)) { this.loadError = `arsenal config not found: ${this.configPath}`; return; }
      const trustedConfigPath = assertRootControlledFile(this.configPath, "MCP arsenal config", this.trustedOwnerUid);
      const cfg = JSON.parse(readFileSync(trustedConfigPath, "utf-8"));
      const trustedManifestPath = this.manifestPath && existsSync(this.manifestPath)
        ? assertRootControlledFile(this.manifestPath, "MCP arsenal manifest", this.trustedOwnerUid)
        : null;
      const manifest = trustedManifestPath ? JSON.parse(readFileSync(trustedManifestPath, "utf-8")) : { servers: [] };
      const byName: Record<string, any> = Object.fromEntries((manifest.servers || []).map((s: any) => [s.mcpServerName, s]));
      for (const [name, raw] of Object.entries<any>(cfg.mcpServers || {})) {
        const m = byName[name] || {};
        const runtime = normRuntime(raw.runtime || m.runtimeType || "stdio");
        const derived = deriveCommand(name, runtime);
        const requestedCommand = typeof raw.command === "string" ? raw.command : derived.command;
        const command = requestedCommand ? resolveTrustedBinary(requestedCommand, this.trustedOwnerUid) : null;
        const startErrors: string[] = [];
        if (requestedCommand && !command) startErrors.push("configured command is missing or not a trusted executable");
        const args = Array.isArray(raw.args) ? raw.args : (derived.args || []);
        if (!args.every((arg: unknown) => typeof arg === "string" && arg.length <= 4096 && !arg.includes("\0"))) {
          throw new Error(`MCP server '${name}' has invalid process arguments`);
        }
        const requestedCwd = typeof raw.cwd === "string" ? raw.cwd : derived.cwd;
        let cwd: string | undefined;
        if (requestedCwd) {
          try { cwd = assertRootControlledDirectory(requestedCwd, `MCP server '${name}' cwd`, this.trustedOwnerUid); }
          catch { startErrors.push("configured working directory is missing or not root-controlled"); }
        }
        const startError = startErrors.length ? startErrors.join("; ") : undefined;
        const env = sanitizedEnv(raw.env);
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
          ...(command ? { command, args, cwd } : {}),
          ...(startError ? { startError } : {}),
          ...(env ? { env } : {}),
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
    return resolveTrustedBinary(bin, this.trustedOwnerUid) !== null;
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
    if (s.startError) { base.state = "missing_dependency"; base.reasons.push(s.startError); }
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
