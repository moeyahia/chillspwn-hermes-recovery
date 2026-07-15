import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "fs";
import { randomUUID } from "crypto";
import { dirname, join, resolve } from "path";

export type GrokCommanderRole = "commander" | "planner";

export interface GrokAcpMcpServer {
  name: string;
  command: string;
  args: string[];
  env: Array<{ name: string; value: string }>;
}

export interface GrokCommanderRuntimePaths {
  root: string;
  home: string;
  grokHome: string;
  cwd: string;
  xdgConfigHome: string;
  xdgDataHome: string;
  xdgStateHome: string;
}

export const GROK_COMMANDER_PYTHON = "/root/hermes-venv/bin/python";
export const GROK_COMMANDER_MCP_SCRIPT_DIR = "/root/.hermes/skills/red-teaming/council-of-ais/scripts";

const CONTROLLED_GROK_CONFIG = `[compat.claude]
mcps = false
skills = false
rules = false
agents = false
hooks = true

[compat.cursor]
mcps = false
skills = false
rules = false
agents = false
hooks = false

[plugins]
enabled = []
disabled = []

[cli]
auto_update = false

[marketplace]
official_marketplace_auto_installed = false
`;

/**
 * Resolve the existing Grok OAuth credential file without reading it. The ACP
 * child receives only the path through GROK_AUTH_PATH; API-key auth is removed.
 */
export function resolveGrokOAuthAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.GROK_AUTH_PATH) return resolve(env.GROK_AUTH_PATH);
  const hermesHome = resolve(env.HERMES_HOME || resolve(env.HOME || "/root", ".hermes"));
  return join(hermesHome, "auth", "grok", "auth.json");
}

export function grokCommanderRuntimePaths(root: string): GrokCommanderRuntimePaths {
  const absoluteRoot = resolve(root);
  const home = join(absoluteRoot, "home");
  return {
    root: absoluteRoot,
    home,
    grokHome: join(home, ".grok"),
    cwd: join(absoluteRoot, "workspace"),
    xdgConfigHome: join(home, ".config"),
    xdgDataHome: join(home, ".local", "share"),
    xdgStateHome: join(home, ".local", "state"),
  };
}

/** Allocate a distinct discovery/config root for every ACP child launch. */
export function createGrokCommanderLaunchRuntime(
  baseRoot: string,
  label = "launch",
): GrokCommanderRuntimePaths {
  const safeLabel = label.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 48) || "launch";
  return grokCommanderRuntimePaths(join(resolve(baseRoot), `${safeLabel}-${randomUUID()}`));
}

/** Create the stable, deliberately empty discovery roots used by commander ACP. */
export function ensureGrokCommanderRuntime(paths: GrokCommanderRuntimePaths, guardPath?: string): void {
  for (const dir of [
    paths.root,
    paths.home,
    paths.grokHome,
    paths.cwd,
    paths.xdgConfigHome,
    paths.xdgDataHome,
    paths.xdgStateHome,
  ]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  // The workspace and compatibility discovery roots must stay configuration
  // free. Never silently clean a poisoned root; fail so the condition is
  // visible and no commander prompt can run under ambiguous policy.
  const forbiddenDiscoveryPaths = [
    join(paths.cwd, ".mcp.json"),
    join(paths.cwd, ".grok"),
    join(paths.cwd, ".claude"),
    join(paths.cwd, ".cursor"),
    join(paths.home, ".mcp.json"),
    join(paths.home, ".claude"),
    join(paths.home, ".cursor"),
    join(paths.grokHome, "plugins"),
    join(paths.grokHome, "mcp_credentials.json"),
  ];
  const poisoned = forbiddenDiscoveryPaths.find((path) => existsSync(path));
  if (poisoned) throw new Error(`Grok commander discovery root contains forbidden configuration: ${poisoned}`);

  // Grok bootstraps its own default config on first use. Replace it before
  // every commander launch with a small owned config that disables all ambient
  // compatibility/plugin discovery. Explicit ACP mcpServers remain available.
  const configPath = join(paths.grokHome, "config.toml");
  const tempPath = `${configPath}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(tempPath, CONTROLLED_GROK_CONFIG, { encoding: "utf-8", mode: 0o600 });
  renameSync(tempPath, configPath);
  chmodSync(configPath, 0o600);

  if (guardPath) {
    const hooksDir = join(paths.grokHome, "hooks");
    mkdirSync(hooksDir, { recursive: true, mode: 0o700 });
    const hookFile = "chillspwn-commander.json";
    const unexpected = readdirSync(hooksDir).find((name) => name !== hookFile);
    if (unexpected) {
      throw new Error(`Grok commander hook root contains unexpected file: ${join(hooksDir, unexpected)}`);
    }
    const hookConfig = {
      hooks: {
        PreToolUse: [{
          hooks: [{
            type: "command",
            command: `/root/.bun/bin/bun ${JSON.stringify(resolve(guardPath))}`,
            timeout: 5,
          }],
        }],
      },
    };
    const hookPath = join(hooksDir, hookFile);
    const hookTemp = `${hookPath}.tmp-${process.pid}-${randomUUID()}`;
    writeFileSync(hookTemp, JSON.stringify(hookConfig, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
    renameSync(hookTemp, hookPath);
    chmodSync(hookPath, 0o600);
  }
}

export function validateGrokCommanderAssets(options: {
  profile: string;
  pluginDir: string;
  soul: string;
  authPath: string;
}): void {
  const files = [
    [options.profile, "agent profile"],
    [join(options.pluginDir, "hooks", "hooks.json"), "PreToolUse hook manifest"],
    [join(options.pluginDir, "plugin.json"), "commander boundary plugin manifest"],
    [join(options.pluginDir, "bin", "commander-tool-guard.ts"), "PreToolUse guard"],
    [options.soul, "commander SOUL"],
    [join(GROK_COMMANDER_MCP_SCRIPT_DIR, "board_mcp_server.py"), "board MCP server"],
    [join(GROK_COMMANDER_MCP_SCRIPT_DIR, "conversation_mcp_server.py"), "conversation MCP server"],
  ] as const;
  for (const [path, label] of files) {
    if (!existsSync(path)) throw new Error(`Missing Grok commander ${label}: ${path}`);
    const state = lstatSync(path);
    if (state.isSymbolicLink() || !state.isFile()) {
      throw new Error(`Grok commander ${label} must be a regular file: ${path}`);
    }
    if (state.uid !== 0 || (state.mode & 0o022) !== 0) {
      throw new Error(`Grok commander ${label} must be root-owned and not group/other-writable: ${path}`);
    }
    const parent = lstatSync(dirname(path));
    if (!parent.isDirectory() || parent.uid !== 0 || (parent.mode & 0o022) !== 0) {
      throw new Error(`Grok commander ${label} parent must be root-owned and not group/other-writable: ${dirname(path)}`);
    }
  }
  if (!existsSync(options.pluginDir) || !lstatSync(options.pluginDir).isDirectory()) {
    throw new Error(`Missing Grok commander plugin directory: ${options.pluginDir}`);
  }
  const pluginState = lstatSync(options.pluginDir);
  if (pluginState.uid !== 0 || (pluginState.mode & 0o022) !== 0) {
    throw new Error(`Grok commander plugin directory must be root-owned and not group/other-writable: ${options.pluginDir}`);
  }

  // A venv's python entry point is normally a symlink. The symlink and its
  // parent must be root-controlled, and its resolved executable must also be
  // a root-owned, non-writable regular file.
  if (!existsSync(GROK_COMMANDER_PYTHON)) {
    throw new Error(`Missing Grok commander MCP Python runtime: ${GROK_COMMANDER_PYTHON}`);
  }
  const pythonLink = lstatSync(GROK_COMMANDER_PYTHON);
  const pythonParent = lstatSync(dirname(GROK_COMMANDER_PYTHON));
  const pythonTarget = statSync(GROK_COMMANDER_PYTHON);
  if (pythonLink.uid !== 0
      || !pythonParent.isDirectory() || pythonParent.uid !== 0 || (pythonParent.mode & 0o022) !== 0
      || !pythonTarget.isFile() || pythonTarget.uid !== 0 || (pythonTarget.mode & 0o022) !== 0) {
    throw new Error(`Grok commander MCP Python runtime must resolve through a root-controlled venv: ${GROK_COMMANDER_PYTHON}`);
  }
  validateGrokOAuthAuthFile(options.authPath);
}

/**
 * Enforce a refresh-safe single-owner OAuth contract.
 *
 * Named-user ACLs alter the POSIX group-mode mask and can make a nominally
 * 0600 credential fail this boundary. More importantly, read-only ACL access
 * cannot atomically replace a refreshed token. The service must own both the
 * file and its private parent directory so refresh/rename remains available
 * without granting a group or another user credential access.
 */
export function validateGrokOAuthAuthFile(
  authPath: string,
  expectedUid: number | undefined = typeof process.geteuid === "function" ? process.geteuid() : undefined,
): void {
  const absoluteAuthPath = resolve(authPath);
  const authStat = lstatSync(absoluteAuthPath);
  if (authStat.isSymbolicLink() || !authStat.isFile()) {
    throw new Error(`Grok OAuth auth path must be a regular file: ${absoluteAuthPath}`);
  }
  if ((authStat.mode & 0o777) !== 0o600) {
    throw new Error(`Grok OAuth auth file must have mode 0600: ${absoluteAuthPath}`);
  }
  if (expectedUid !== undefined && authStat.uid !== expectedUid) {
    throw new Error(`Grok OAuth auth file must be owned by the service user: ${absoluteAuthPath}`);
  }

  const parent = dirname(absoluteAuthPath);
  const parentStat = lstatSync(parent);
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new Error(`Grok OAuth directory must be a regular directory: ${parent}`);
  }
  if ((parentStat.mode & 0o777) !== 0o700) {
    throw new Error(`Grok OAuth directory must have mode 0700: ${parent}`);
  }
  if (expectedUid !== undefined && parentStat.uid !== expectedUid) {
    throw new Error(`Grok OAuth directory must be owned by the service user: ${parent}`);
  }

  try {
    accessSync(absoluteAuthPath, constants.R_OK | constants.W_OK);
    accessSync(parent, constants.R_OK | constants.W_OK | constants.X_OK);
  } catch {
    throw new Error(`Grok OAuth state must be readable and refreshable by the service user: ${absoluteAuthPath}`);
  }
}

/**
 * Isolate root-session MCP/plugin discovery while retaining the installed
 * Grok CLI's refreshable OAuth identity via GROK_AUTH_PATH.
 */
export function buildGrokCommanderEnv(
  base: NodeJS.ProcessEnv,
  paths: GrokCommanderRuntimePaths,
  authPath: string,
  role: GrokCommanderRole,
): NodeJS.ProcessEnv {
  // Pass only process/runtime essentials plus network proxy/certificate knobs.
  // This prevents unrelated service secrets and Grok override variables from
  // crossing into the commander process.
  const env: NodeJS.ProcessEnv = {};
  for (const name of [
    "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM", "TMPDIR",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
    "http_proxy", "https_proxy", "all_proxy", "no_proxy",
    "SSL_CERT_FILE", "SSL_CERT_DIR",
  ]) {
    if (base[name] !== undefined) env[name] = base[name];
  }
  env.HOME = paths.home;
  env.GROK_HOME = paths.grokHome;
  env.GROK_AUTH_PATH = resolve(authPath);
  env.XDG_CONFIG_HOME = paths.xdgConfigHome;
  env.XDG_DATA_HOME = paths.xdgDataHome;
  env.XDG_STATE_HOME = paths.xdgStateHome;
  env.GROK_CLAUDE_MCPS_ENABLED = "0";
  env.GROK_CURSOR_MCPS_ENABLED = "0";
  env.GROK_MANAGED_MCPS_ENABLED = "0";
  env.GROK_MANAGED_MCP_GATEWAY_TOOLS_ENABLED = "0";
  env.GROK_SUBAGENTS = "0";
  env.GROK_MEMORY = "0";
  env.GROK_WEB_FETCH = "0";
  env.CHILLSPWN_GROK_ROLE = role;
  return env;
}

/** The complete MCP surface supplied to a Grok commander root ACP session. */
export function buildGrokCommanderMcpServers(options: {
  engagementDir: string;
  model: string;
  dashboardUrl?: string;
}): GrokAcpMcpServer[] {
  const dashboardUrl = options.dashboardUrl || "http://127.0.0.1:3131";
  return [
    {
      name: "chillspwn-board",
      command: GROK_COMMANDER_PYTHON,
      args: [join(GROK_COMMANDER_MCP_SCRIPT_DIR, "board_mcp_server.py")],
      env: [
        { name: "CHILLSPWN_OR_PERSONA", value: "ChillsPwn" },
        { name: "CHILLSPWN_ORCH_PROVIDER", value: "xai-grok" },
        { name: "CHILLSPWN_ORCH_MODEL", value: options.model },
        { name: "CHILLSPWN_DASHBOARD_URL", value: dashboardUrl },
      ],
    },
    {
      name: "chillspwn-conversation",
      command: GROK_COMMANDER_PYTHON,
      args: [join(GROK_COMMANDER_MCP_SCRIPT_DIR, "conversation_mcp_server.py")],
      env: [
        { name: "CHILLSPWN_ENGAGEMENT_DIR", value: resolve(options.engagementDir) },
      ],
    },
  ];
}
