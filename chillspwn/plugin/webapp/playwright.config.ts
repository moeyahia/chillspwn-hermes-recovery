import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

const port = Number.parseInt(process.env.CHILLSPWN_E2E_PORT || "33131", 10);
const populatedPort = Number.parseInt(process.env.CHILLSPWN_E2E_POPULATED_PORT || "33132", 10);
const brainScalePort = Number.parseInt(process.env.CHILLSPWN_E2E_BRAIN_SCALE_PORT || "33133", 10);
const observabilityScalePort = Number.parseInt(process.env.CHILLSPWN_E2E_OBSERVABILITY_SCALE_PORT || "33134", 10);
const brainScaleProfile = process.env.CHILLSPWN_E2E_BRAIN_SCALE_PROFILE === "1";
const observabilityScaleProfile = process.env.CHILLSPWN_E2E_OBSERVABILITY_SCALE_PROFILE === "1";
const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
const baseURL = externalBaseUrl || `http://127.0.0.1:${port}`;
const populatedBaseURL = `http://127.0.0.1:${populatedPort}`;
const brainScaleBaseURL = `http://127.0.0.1:${brainScalePort}`;
const observabilityScaleBaseURL = `http://127.0.0.1:${observabilityScalePort}`;
const nonDefaultProfileSpecs = /(populated-journeys|second-brain-scale|observability-scale)\.spec\.ts/u;

if (brainScaleProfile && observabilityScaleProfile) {
  throw new Error("Select only one isolated Playwright scale profile at a time");
}

function resolveChromiumExecutable(): string | undefined {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?.trim();
  if (configured) {
    if (!existsSync(configured)) {
      throw new Error(`PLAYWRIGHT_CHROMIUM_EXECUTABLE does not exist: ${configured}`);
    }
    return configured;
  }
  // Use the browser revision pinned by @playwright/test unless an operator
  // deliberately supplies an executable. Auto-selecting whatever Chromium or
  // Chrome happened to be installed on the host made visual evidence depend
  // on the runner image rather than the repository lockfile. CI installs the
  // pinned Playwright browser before this suite; local operators can retain an
  // explicit system-browser compatibility run through the environment
  // variable above without changing the canonical regression baseline.
  return undefined;
}

const chromiumExecutable = resolveChromiumExecutable();

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // A retry can collect useful diagnostics, but it cannot turn an
  // intermittent product or visual state into release evidence. Keep the
  // protected compatibility gate retry-free in CI and locally.
  retries: 0,
  reporter: process.env.CI
    ? [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  expect: { timeout: 8_000 },
  timeout: 45_000,
  projects: externalBaseUrl
    ? [{ name: "external", testIgnore: nonDefaultProfileSpecs }]
    : brainScaleProfile
      ? [{
          name: "second-brain-scale",
          testMatch: /second-brain-scale\.spec\.ts/u,
          use: { baseURL: brainScaleBaseURL },
        }]
      : observabilityScaleProfile
        ? [{
            name: "observability-scale",
            testMatch: /observability-scale\.spec\.ts/u,
            use: { baseURL: observabilityScaleBaseURL },
          }]
      : [
          { name: "empty-state", testIgnore: nonDefaultProfileSpecs },
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
    : brainScaleProfile
      ? [{
          command: "bun run e2e:server",
          url: `${brainScaleBaseURL}/api/health`,
          timeout: 120_000,
          reuseExistingServer: false,
          gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
          stdout: "pipe",
          stderr: "pipe",
          env: {
            CHILLSPWN_E2E_PORT: String(brainScalePort),
            CHILLSPWN_E2E_BRAIN_SCALE: "1",
          },
        }]
      : observabilityScaleProfile
        ? [{
            command: "bun run e2e:server",
            url: `${observabilityScaleBaseURL}/api/health`,
            timeout: 180_000,
            reuseExistingServer: false,
            gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
            stdout: "pipe",
            stderr: "pipe",
            env: {
              CHILLSPWN_E2E_PORT: String(observabilityScalePort),
              CHILLSPWN_E2E_OBSERVABILITY_SCALE: "1",
            },
          }]
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
