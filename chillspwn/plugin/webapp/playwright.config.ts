import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const port = Number.parseInt(process.env.CHILLSPWN_E2E_PORT || "33131", 10);
const populatedPort = Number.parseInt(process.env.CHILLSPWN_E2E_POPULATED_PORT || "33132", 10);
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
const baseURL = externalBaseUrl || `http://127.0.0.1:${port}`;
const populatedBaseURL = `http://127.0.0.1:${populatedPort}`;

function resolveChromiumExecutable(): string | undefined {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim();
  if (configured) {
    if (!existsSync(configured)) {
      throw new Error(`PLAYWRIGHT_CHROMIUM_EXECUTABLE does not exist: ${configured}`);
    }
    return configured;
  }

  for (const candidate of [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

const chromiumExecutable = resolveChromiumExecutable();

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  expect: { timeout: 8_000 },
  timeout: 45_000,
  projects: externalBaseUrl
    ? [{ name: "external", testIgnore: /populated-journeys\.spec\.ts/u }]
    : [
        { name: "empty-state", testIgnore: /populated-journeys\.spec\.ts/u },
        { name: "populated-journeys", testMatch: /populated-journeys\.spec\.ts/u, use: { baseURL: populatedBaseURL } },
      ],
  use: {
    baseURL,
    browserName: "chromium",
    headless: true,
    launchOptions: {
      ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}),
      args: typeof process.getuid === "function" && process.getuid() === 0 ? ["--no-sandbox"] : [],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  webServer: externalBaseUrl
    ? undefined
    : [{
        command: "bun run e2e:server",
        url: `${baseURL}/api/health`,
        timeout: 60_000,
        reuseExistingServer: false,
        gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
        stdout: "pipe",
        stderr: "pipe",
        env: { CHILLSPWN_E2E_PORT: String(port) },
      }, {
        command: "bun run e2e:server",
        url: `${populatedBaseURL}/api/health`,
        timeout: 60_000,
        reuseExistingServer: false,
        gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
        stdout: "pipe",
        stderr: "pipe",
        env: {
          CHILLSPWN_E2E_PORT: String(populatedPort),
          CHILLSPWN_E2E_SEED_CANONICAL: "1",
        },
      }],
});
