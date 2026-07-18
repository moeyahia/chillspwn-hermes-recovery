import { afterEach, describe, expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  commandOsV2KillSwitchEnabled,
  createCommandOsV2KillSwitchServer,
} from "../../command-os-v2-preview-entry";

let server: Server | undefined;

afterEach(async () => {
  if (!server?.listening) return;
  await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = undefined;
});

describe("Command OS V2 hybrid preview kill switch entry", () => {
  test("accepts only explicit enabled values", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on", " On "]) {
      expect(commandOsV2KillSwitchEnabled(value)).toBe(true);
    }
    for (const value of [undefined, "", "0", "false", "enabled", "no"]) {
      expect(commandOsV2KillSwitchEnabled(value)).toBe(false);
    }
  });

  test("serves only a canonical disabled response without importing the hybrid runtime", async () => {
    server = createCommandOsV2KillSwitchServer();
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", resolve);
    });
    const port = (server.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}/api/v2/health`, {
      headers: { "X-Request-ID": "kill-switch-test" },
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("kill-switch-test");
    expect(await response.json()).toEqual({
      error: {
        code: "command_os_v2_killed",
        message: "Command OS V2 is disabled by its kill switch",
        humanMessage: "Command OS V2 is deliberately disabled. The legacy application is unaffected.",
        retryable: false,
        category: "service_disabled",
        traceId: "kill-switch-test",
        remediation: "Clear COMMAND_OS_V2_KILL_SWITCH and restart only the V2 preview service.",
        timestamp: expect.any(String),
      },
    });
  });
});
