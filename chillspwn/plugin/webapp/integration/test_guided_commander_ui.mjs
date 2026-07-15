import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const port = Number(process.env.COMMAND_OS_E2E_PORT ?? 4174);
const externalBaseUrl = process.env.COMMAND_OS_TEST_URL;
const baseUrl = externalBaseUrl ?? `http://127.0.0.1:${port}`;
let preview;

async function waitForPreview() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error(`Vite preview did not become ready at ${baseUrl}`);
}

function stopPreview() {
  if (!preview?.pid) return;
  try { process.kill(-preview.pid, "SIGTERM"); } catch {}
}

if (!externalBaseUrl) {
  preview = spawn("bun", ["run", "preview", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
  });
  process.on("exit", stopPreview);
  process.on("SIGINT", () => { stopPreview(); process.exit(130); });
  await waitForPreview();
}

const now = "2026-07-15T12:00:00.000Z";
const fingerprint = "a".repeat(64);
const run = {
  id: "run-1", missionId: "mission-1", missionName: "Authorized readiness review", objective: "Validate the local readiness endpoint",
  journey: "guided", status: "waiting_guided_decision", statusReason: "Waiting for the exact represented step", progress: 0.25,
  nextAction: "Review the represented local request", currentPlanId: "plan-1", currentStepId: "step-1", currentOwnerId: "recon-specialist",
  lastHeartbeatAt: now, leaseExpiresAt: null, startedAt: now, endedAt: null, createdAt: now, updatedAt: now, version: 1,
};
const action = {
  actionType: "readiness_check", actionClass: "recon", target: "127.0.0.1", arguments: { path: "/api/v2/health" },
  intentSummary: "Inspect the approved local readiness response", kind: "manual", idempotent: true, destructive: false,
};
const plan = {
  id: "plan-1", runId: "run-1", version: 1, status: "active", strategySummary: "Validate the approved local service",
  rationaleSummary: "A read-only local request establishes current readiness.", createdAt: now, activatedAt: now,
  steps: [{
    id: "step-1", ordinal: 0, phase: "Readiness", title: "Inspect the local health response", objective: "Collect a bounded response",
    status: "waiting", assignedAgentId: "recon-specialist", riskClass: "low", successCriteria: ["A response is retained as evidence"],
    action, explanation: "Inspect only the approved local readiness endpoint.", rationale: "This reduces uncertainty without changing state.", reversibility: "Read-only",
  }],
};
const representedStep = {
  id: "step-1", planId: "plan-1", planVersion: 1, phase: "Readiness", title: "Inspect the local health response",
  objective: "Collect a bounded response", status: "waiting", assignedAgentId: "recon-specialist", riskClass: "low",
  successCriteria: ["A response is retained as evidence"], explanation: "Inspect only the approved local readiness endpoint.",
  rationale: "This reduces uncertainty without changing state.", reversibility: "Read-only", representedAction: action,
  actionFingerprint: fingerprint, guidedDecisionId: "decision-1", guidedDecisionStatus: "pending",
};
const message = (id, role, body, structuredContent, contextPackId, offset = 0) => ({
  id, conversationId: "conversation-1", missionId: "mission-1", runId: "run-1", stepId: "step-1", role, body,
  structuredContent, contextPackId, createdAt: new Date(Date.parse(now) + offset).toISOString(),
});

const executablePath = process.env.CHROMIUM_PATH
  ?? (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : chromium.executablePath());
const browser = await chromium.launch({ headless: true, executablePath, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  const requestFailures = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => requestFailures.push(`${request.url()}: ${request.failure()?.errorText ?? "failed"}`));
  await page.route("**/api/v2/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/v2/events/stream") return route.abort();
    if (url.pathname === "/api/v2/missions/mission-1/runtime") return json({ schemaVersion: "2.1", mission: { id: "mission-1", name: "Authorized readiness review", objective: run.objective, journey: "guided", engagementId: "engagement-1", authorizationStatus: "verified", allowedTargets: ["127.0.0.1"], prohibitedTargets: [], successCriteria: ["Evidence retained"], memoryPolicy: { guidedUse: true } }, runs: [run] });
    if (url.pathname === "/api/v2/runs/run-1") return json({ schemaVersion: "2.1", run, latestCheckpoint: null });
    if (url.pathname === "/api/v2/runs/run-1/plans") return json({ schemaVersion: "2.1", items: [plan] });
    if (url.pathname === "/api/v2/decisions") return json({ schemaVersion: "2.1", items: [{ id: "decision-1", missionId: "mission-1", runId: "run-1", stepId: "step-1", status: "pending", actionFingerprint: fingerprint, requestedParameters: action, rationale: "Inspect the approved local endpoint", riskClass: "low", reversibility: "Read-only", expiresAt: "2026-07-16T12:00:00.000Z", createdAt: now }] });
    if (url.pathname === "/api/v2/observability/events") return json({ schemaVersion: "2.1", items: [], nextCursor: null });
    if (url.pathname === "/api/v2/guided/mission-1/commander/transcript") return json({ schemaVersion: "2.1", mission: { id: "mission-1", name: "Authorized readiness review", objective: run.objective, engagementId: "engagement-1", authorizationStatus: "verified", scope: { targets: ["127.0.0.1"] } }, run: { id: "run-1", status: run.status, currentStepId: "step-1", progress: 0.25 }, currentStep: representedStep, items: [], nextCursor: null });
    if (url.pathname === "/api/v2/guided/mission-1/commander/show-next-step") {
      const submitted = request.postDataJSON();
      if (submitted.expectedFingerprint !== fingerprint || !request.headers()["idempotency-key"]) return json({ error: { code: "invalid_test_request", message: "Missing exact Guided binding" } }, 400);
      return json({ schemaVersion: "2.1", result: {
        action: "show_next_step",
        operatorMessage: message("message-operator", "operator", "Asked to review the exact next Guided step.", { kind: "guided_commander_request", action: "show_next_step", stepId: "step-1", actionFingerprint: fingerprint }, null),
        assistantMessage: message("message-assistant", "assistant", "The first bounded step checks only the approved local readiness endpoint. It is read-only, and success means retaining one valid response before you decide whether to advance.", { kind: "guided_commander_response", action: "show_next_step", stepId: "step-1", summary: "Review the bounded local readiness request", confidence: 0.96, observations: [], recommendedNextStep: "Run the represented read-only request or provide another approach.", contextPackId: "context-1", executionPerformed: false, planMutated: false, nextConsequentialActionRequiresDecision: true }, "context-1", 1),
        contextPackId: "context-1", actionFingerprint: fingerprint,
      } });
    }
    return json({ error: { code: "fixture_route_missing", message: `No explicit test fixture for ${url.pathname}` } }, 404);
  });

  await page.goto(`${baseUrl}/guided/mission-1`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2_000);
  if (await page.getByRole("heading", { name: "Commander conversation" }).count() === 0) {
    const body = (await page.locator("body").innerText()).slice(0, 2_000);
    throw new Error(`Guided Commander did not render. Visible document:\n${body}\nPage errors: ${pageErrors.join(" | ")}\nRequest failures: ${requestFailures.join(" | ")}`);
  }
  await page.getByRole("heading", { name: "Commander conversation" }).waitFor();
  await page.getByText("The first bounded step checks only the approved local readiness endpoint.", { exact: false }).waitFor();

  const main = await page.locator("#command-os-content").boundingBox();
  const header = await page.locator(".os-topbar").boundingBox();
  const sidebar = await page.locator('aside[aria-label="Primary navigation"]').evaluate((element) => ({
    position: getComputedStyle(element).position,
    transform: getComputedStyle(element).transform,
  }));
  if (!main || Math.abs(main.y - 64) > 1) throw new Error(`Mobile main content starts at y=${main?.y}, expected 64`);
  if (!header || Math.abs(header.height - 64) > 1) throw new Error(`Top bar height is ${header?.height}, expected 64`);
  if (sidebar.position !== "fixed") throw new Error(`Closed mobile navigation is ${sidebar.position}, expected fixed`);
  if (!sidebar.transform || sidebar.transform === "none") throw new Error("Closed mobile navigation is not translated off canvas");
  if (await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)) throw new Error("Guided workspace creates horizontal mobile overflow");

  for (const label of ["Explain more", "Show next step", "Use another approach", "Interpret only — keep step paused", "Context used", "Remember this", "Do not remember this", "Complete exact step and advance", "Skip exact step", "Stop mission"]) {
    await page.getByRole("button", { name: label, exact: true }).first().waitFor();
  }

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.waitForTimeout(250);
  const openSidebar = await page.locator('aside[aria-label="Primary navigation"]').boundingBox();
  const mainWhileOpen = await page.locator("#command-os-content").boundingBox();
  if (!openSidebar || openSidebar.x < -1) throw new Error("Mobile navigation did not become an overlay");
  if (!mainWhileOpen || Math.abs(mainWhileOpen.y - 64) > 1) throw new Error("Opening navigation changed main document flow");
  await page.locator('aside[aria-label="Primary navigation"]').getByRole("button", { name: "Close navigation" }).click();

  const screenshot = process.env.COMMAND_OS_E2E_SCREENSHOT ?? "/tmp/chillspwn-guided-commander-mobile.png";
  await page.screenshot({ path: screenshot, fullPage: true });
  console.log(JSON.stringify({ status: "pass", viewport: "390x844", mainY: main.y, sidebarPosition: sidebar.position, screenshot }, null, 2));
} finally {
  await browser.close();
  stopPreview();
}
