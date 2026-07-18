import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { activateCommandOsV2PreviewRuntime } from "./runtime/CommandOsPreviewRuntime";

const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/u;

export function commandOsV2KillSwitchEnabled(value = process.env.COMMAND_OS_V2_KILL_SWITCH): boolean {
  return /^(?:1|true|yes|on)$/iu.test(value?.trim() ?? "");
}

function requestId(request: IncomingMessage): string {
  const supplied = request.headers["x-request-id"];
  const value = Array.isArray(supplied) ? supplied[0] : supplied;
  return typeof value === "string" && REQUEST_ID.test(value) ? value : randomUUID();
}

function disabledResponse(request: IncomingMessage, response: ServerResponse): void {
  const traceId = requestId(request);
  const payload = JSON.stringify({
    error: {
      code: "command_os_v2_killed",
      message: "Command OS V2 is disabled by its kill switch",
      humanMessage: "Command OS V2 is deliberately disabled. The legacy application is unaffected.",
      retryable: false,
      category: "service_disabled",
      traceId,
      remediation: "Clear COMMAND_OS_V2_KILL_SWITCH and restart only the V2 preview service.",
      timestamp: new Date().toISOString(),
    },
  });
  response.writeHead(503, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Request-ID": traceId,
  });
  response.end(payload);
}

/**
 * This listener intentionally has no imports from the hybrid application.
 * When the kill switch is active, SQLite, providers, MCP servers, workers,
 * Vault watchers, and legacy runtime modules are never initialized.
 */
export function createCommandOsV2KillSwitchServer(): Server {
  return createServer(disabledResponse);
}

/** Activate the internal preview marker before evaluating the shared runtime. */
export async function loadCommandOsV2Runtime(
  importer: () => Promise<unknown> = () => import("./index"),
): Promise<void> {
  activateCommandOsV2PreviewRuntime();
  await importer();
}

async function main(): Promise<void> {
  if (!commandOsV2KillSwitchEnabled()) {
    await loadCommandOsV2Runtime();
    return;
  }

  const bind = process.env.CHILLSPWN_BIND?.trim() || "127.0.0.1";
  const parsedPort = Number(process.env.CHILLSPWN_PORT ?? "3132");
  if (!Number.isSafeInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error("CHILLSPWN_PORT must be an integer between 1 and 65535");
  }
  const server = createCommandOsV2KillSwitchServer();
  server.listen(parsedPort, bind, () => {
    process.stdout.write(`Command OS V2 kill switch active on http://${bind}:${parsedPort}\n`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (import.meta.main) {
  void main().catch((error) => {
    process.stderr.write(`Command OS V2 preview entry failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
