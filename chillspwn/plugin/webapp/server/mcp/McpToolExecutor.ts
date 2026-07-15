/**
 * Phase 16 — McpToolExecutor. A MINIMAL MCP stdio client (JSON-RPC 2.0, newline-delimited) — no new
 * dependency. Spawns a configured MCP server over stdio, runs the initialize handshake, and supports
 * tools/list + tools/call with a hard timeout. Output is captured, truncated, and secret-redacted by
 * the bridge. In dry-run mode nothing is spawned. Docker servers are started only when allowed.
 */

import { spawn } from "child_process";
import type { McpServerSpec, JsonRpcResponse } from "./McpTypes";
import { MCP_PROTOCOL_VERSION } from "./McpTypes";

export interface ExecOptions { timeoutMs: number; allowDocker: boolean; env?: NodeJS.ProcessEnv }

const MCP_CHILD_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const SAFE_STATIC_ENV = new Set(["MCP_TRANSPORT", "NODE_ENV", "PYTHONUNBUFFERED"]);
const DANGEROUS_ENV = /^(?:DASHBOARD_TOKEN|CHILLSPWN_DASHBOARD_TOKEN|NODE_OPTIONS|BUN_OPTIONS|PYTHONPATH|PYTHONSTARTUP|BASH_ENV|ENV|SHELLOPTS|GIT_SSH_COMMAND|LD_.+|DYLD_.+)$/;

function allowedExplicitEnvName(name: string): boolean {
  return /^[A-Z][A-Z0-9_]{0,127}$/.test(name) && !DANGEROUS_ENV.test(name);
}

/** Build a least-privilege environment for an untrusted third-party MCP process. */
export function buildMcpChildEnv(spec: McpServerSpec, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: MCP_CHILD_PATH,
    HOME: "/var/empty",
    TMPDIR: "/tmp",
    LANG: typeof source.LANG === "string" && source.LANG.length <= 64 ? source.LANG : "C.UTF-8",
    TZ: typeof source.TZ === "string" && source.TZ.length <= 64 ? source.TZ : "UTC",
  };
  for (const name of spec.requiredEnv || []) {
    if (!allowedExplicitEnvName(name)) throw new Error(`unsafe required MCP environment name '${name}'`);
    const value = source[name];
    if (typeof value === "string") env[name] = value;
  }
  for (const [name, value] of Object.entries(spec.env || {})) {
    if (!SAFE_STATIC_ENV.has(name) || typeof value !== "string" || value.length > 1024 || value.includes("\0")) {
      throw new Error(`unsafe static MCP environment name '${name}'`);
    }
    env[name] = value;
  }
  return env;
}

/** Resolve the actual command+args to start a server over stdio. */
export function resolveStartCommand(spec: McpServerSpec, allowDocker: boolean): { command: string; args: string[]; cwd?: string; env?: Record<string, string> } | { error: string } {
  if (spec.runtime === "docker") {
    if (!allowDocker) return { error: "docker MCP server — set MCP_ARSENAL_ALLOW_DOCKER=true and build the image first" };
    const img = spec.requiredDockerImages[0];
    if (!img) return { error: "docker MCP server has no image defined" };
    if (!spec.command) return { error: "docker executable was not resolved from the trusted MCP config" };
    if (!/^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,255}$/.test(img)) return { error: "docker MCP image name is invalid" };
    return { command: spec.command, args: ["run", "-i", "--rm", img] };
  }
  if (spec.runtime === "builtin" || spec.runtime === "registry") return { error: `${spec.runtime} server is not started over stdio` };
  if (!spec.command) return { error: `no start command known for '${spec.name}' (install it first: ${spec.installMethod})` };
  return { command: spec.command, args: spec.args ?? [], cwd: spec.cwd, env: spec.env };
}

interface RawResult { ok: boolean; result?: any; error?: string }

/** Run a single JSON-RPC session: initialize → (optional) tools/list → method/params → close. */
async function rpcSession(cmd: { command: string; args: string[]; cwd?: string; env?: Record<string, string> }, method: string, params: unknown, opts: ExecOptions): Promise<RawResult> {
  return await new Promise<RawResult>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd.command, cmd.args, { cwd: cmd.cwd, env: opts.env ?? {}, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) { return resolve({ ok: false, error: `spawn failed: ${(e as Error).message}` }); }

    let buf = "";
    let nextId = 1;
    let settled = false;
    const pending = new Map<number, (r: JsonRpcResponse) => void>();
    const done = (r: RawResult) => { if (settled) return; settled = true; clearTimeout(timer); try { child.kill("SIGKILL"); } catch {} resolve(r); };
    const timer = setTimeout(() => done({ ok: false, error: `MCP call timed out after ${opts.timeoutMs}ms` }), opts.timeoutMs);

    const send = (msg: object) => { try { child.stdin!.write(JSON.stringify(msg) + "\n"); } catch {} };
    const request = (m: string, p?: unknown) => new Promise<JsonRpcResponse>((res) => { const id = nextId++; pending.set(id, res); send({ jsonrpc: "2.0", id, method: m, params: p }); });

    child.stdout!.on("data", (d) => {
      buf += d.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        let msg: JsonRpcResponse; try { msg = JSON.parse(line); } catch { continue; }
        if (typeof msg.id === "number" && pending.has(msg.id)) { const cb = pending.get(msg.id)!; pending.delete(msg.id); cb(msg); }
      }
    });
    // Drain stderr to avoid child backpressure, but never return third-party
    // stderr: it can echo credentials or target payloads.
    child.stderr!.on("data", () => {});
    child.on("error", (e) => done({ ok: false, error: `process error: ${e.message}` }));
    child.on("exit", (code) => { if (!settled && code !== 0) done({ ok: false, error: `MCP server exited (code ${code})` }); });

    (async () => {
      try {
        const init = await request("initialize", { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "chillspwn-arsenal-bridge", version: "16.0" } });
        if (init.error) return done({ ok: false, error: `initialize failed: ${init.error.message}` });
        send({ jsonrpc: "2.0", method: "notifications/initialized" });
        const resp = await request(method, params);
        if (resp.error) return done({ ok: false, error: `${method} failed: ${resp.error.message}` });
        done({ ok: true, result: resp.result });
      } catch (e) { done({ ok: false, error: `session error: ${(e as Error).message}` }); }
    })();
  });
}

/** Live tools/list for a server (used by health checks when safe). */
export async function listServerTools(spec: McpServerSpec, opts: ExecOptions): Promise<RawResult> {
  const cmd = resolveStartCommand(spec, opts.allowDocker);
  if ("error" in cmd) return { ok: false, error: cmd.error };
  try { return rpcSession(cmd, "tools/list", {}, { ...opts, env: buildMcpChildEnv(spec, opts.env) }); }
  catch (e) { return { ok: false, error: `MCP environment rejected: ${(e as Error).message}` }; }
}

/** Call a tool on a server. Returns the raw MCP result ({content:[...], isError?}). */
export async function callServerTool(spec: McpServerSpec, toolName: string, args: unknown, opts: ExecOptions): Promise<RawResult> {
  const cmd = resolveStartCommand(spec, opts.allowDocker);
  if ("error" in cmd) return { ok: false, error: cmd.error };
  try { return rpcSession(cmd, "tools/call", { name: toolName, arguments: args ?? {} }, { ...opts, env: buildMcpChildEnv(spec, opts.env) }); }
  catch (e) { return { ok: false, error: `MCP environment rejected: ${(e as Error).message}` }; }
}

/** Flatten an MCP tools/call result's content array into a single text blob. */
export function flattenMcpContent(result: any): { text: string; isError: boolean } {
  const isError = result?.isError === true;
  const content = Array.isArray(result?.content) ? result.content : [];
  const parts: string[] = [];
  for (const c of content) {
    if (c?.type === "text" && typeof c.text === "string") parts.push(c.text);
    else if (c?.type === "resource" && c?.resource?.text) parts.push(String(c.resource.text));
    else parts.push(JSON.stringify(c));
  }
  if (!parts.length && result !== undefined) parts.push(typeof result === "string" ? result : JSON.stringify(result));
  return { text: parts.join("\n"), isError };
}
