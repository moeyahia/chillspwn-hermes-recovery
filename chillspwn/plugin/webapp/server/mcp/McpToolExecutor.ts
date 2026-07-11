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

/** Resolve the actual command+args to start a server over stdio. */
export function resolveStartCommand(spec: McpServerSpec, allowDocker: boolean): { command: string; args: string[]; cwd?: string; env?: Record<string, string> } | { error: string } {
  if (spec.runtime === "docker") {
    if (!allowDocker) return { error: "docker MCP server — set MCP_ARSENAL_ALLOW_DOCKER=true and build the image first" };
    const img = spec.requiredDockerImages[0];
    if (!img) return { error: "docker MCP server has no image defined" };
    return { command: "docker", args: ["run", "-i", "--rm", img] };
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
      child = spawn(cmd.command, cmd.args, { cwd: cmd.cwd, env: { ...(opts.env ?? process.env), ...(cmd.env ?? {}) }, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) { return resolve({ ok: false, error: `spawn failed: ${(e as Error).message}` }); }

    let buf = "";
    let stderr = "";
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
    child.stderr!.on("data", (d) => { stderr += d.toString(); if (stderr.length > 4000) stderr = stderr.slice(-4000); });
    child.on("error", (e) => done({ ok: false, error: `process error: ${e.message}` }));
    child.on("exit", (code) => { if (!settled && code !== 0) done({ ok: false, error: `MCP server exited (code ${code})${stderr ? ": " + stderr.slice(0, 300) : ""}` }); });

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
  return rpcSession(cmd, "tools/list", {}, opts);
}

/** Call a tool on a server. Returns the raw MCP result ({content:[...], isError?}). */
export async function callServerTool(spec: McpServerSpec, toolName: string, args: unknown, opts: ExecOptions): Promise<RawResult> {
  const cmd = resolveStartCommand(spec, opts.allowDocker);
  if ("error" in cmd) return { ok: false, error: cmd.error };
  return rpcSession(cmd, "tools/call", { name: toolName, arguments: args ?? {} }, opts);
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
