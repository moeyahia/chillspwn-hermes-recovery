import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

async function missionCount(request: APIRequestContext): Promise<number> {
  const response = await request.get("/api/v2/missions?limit=100");
  expect(response.ok()).toBe(true);
  const body = await response.json() as { items: unknown[] };
  return body.items.length;
}

async function completeRequiredAutonomousFields(page: Page): Promise<void> {
  await page.getByLabel("Mission title").fill("Fail-closed browser test");
  await page.getByLabel("Authorized objective").fill("Validate the isolated authorized lab boundary");
  await page.getByLabel("Measurable success criteria").fill("No mission is persisted when readiness is blocked");
  await page.getByLabel("Required final deliverables").fill("Readiness exception report");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel("Allowed targets and boundaries").fill("lab.invalid");
  await page.getByLabel("I confirm this mission is authorized").check();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel("Pre-authorized action classes").fill("reconnaissance");
  await page.getByLabel("Safe-stop conditions").fill("Any dependency or scope conflict");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("Autonomous blockers detected.")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
}

test.describe("Command OS V2.1 real application journeys", () => {
  test("Overview exposes exactly the Autonomous and Guided journey entry points", async ({ page, request }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "Command Center" })).toBeVisible();
    await expect(page.locator(".os-journey-card h2")).toHaveText(["Go Autonomous", "Start Guided Mission"]);
    await expect(page.getByRole("link", { name: "Compose mission contract" })).toHaveAttribute("href", "/missions/new/autonomous");
    await expect(page.getByRole("link", { name: "Create guided mission" })).toHaveAttribute("href", "/missions/new/guided");
    await expect(page.getByText("No active missions")).toBeVisible();
    await expect(page.locator('.os-brand img[src="/Logo.svg"]')).toHaveCount(1);
    expect(await missionCount(request)).toBe(0);
  });

  test("legacy compatibility routes redirect into the two-journey product", async ({ page }) => {
    await page.goto("/approvals");
    await expect(page).toHaveURL(/\/decisions$/u);
    await expect(page.getByRole("heading", { level: 1, name: "Decisions" })).toBeVisible();

    await page.goto("/legacy");
    await expect(page).toHaveURL(/\/$/u);
    await expect(page.getByRole("heading", { level: 1, name: "Command Center" })).toBeVisible();
    await expect(page.locator(".os-journey-card h2")).toHaveText(["Go Autonomous", "Start Guided Mission"]);
    await expect(page.locator(".poc-shell")).toHaveCount(0);
  });

  test("keyboard command palette provides focused navigation", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+K");

    const palette = page.getByRole("dialog", { name: "Command palette" });
    const search = page.getByRole("combobox", { name: /Search commands, missions/u });
    await expect(palette).toBeVisible();
    await expect(search).toBeFocused();
    await search.fill("Second Brain");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/brain$/u);
    await expect(page.getByRole("heading", { level: 1, name: "Second Brain" })).toBeVisible();
  });

  test("Autonomous readiness fails closed and persists no mission", async ({ page, request }) => {
    expect(await missionCount(request)).toBe(0);
    const overview = await request.get("/api/v2/overview");
    expect(overview.ok()).toBe(true);
    expect((await overview.json() as { readiness: { status: string } }).readiness.status).toBe("blocked");

    await page.goto("/missions/new/autonomous");
    await completeRequiredAutonomousFields(page);

    await expect(page.getByText("Launch is blocked")).toBeVisible();
    await expect(page.getByRole("button", { name: "Launch Autonomous Mission" })).toBeDisabled();

    const bypassAttempt = await request.post("/api/v2/missions", {
      headers: {
        "Idempotency-Key": "e2e-fail-closed-autonomous-001",
        "X-Request-ID": "e2e-fail-closed-trace",
      },
      data: {
        journey: "autonomous",
        launch: true,
        title: "Readiness bypass attempt",
        objective: "Verify server-side readiness enforcement",
        successCriteria: ["No canonical mission is written"],
        authorization: {
          allowedTargets: ["lab.invalid"],
          prohibitedTargets: [],
          authorizationConfirmed: true,
        },
        contract: {
          allowedActionClasses: ["reconnaissance"],
          prohibitedActionClasses: [],
          destructivePolicy: "prohibited",
          evidenceRequirements: [],
          timeBudgetMinutes: 30,
          retryBudget: 2,
          replanBudget: 2,
          concurrencyLimit: 2,
          evidenceStorageBudgetBytes: 16 * 1024 * 1024,
          artifactStorageBudgetBytes: 16 * 1024 * 1024,
          notificationPolicy: "in_app_only",
          reportingFormat: "command_os_json",
          dataHandlingPolicy: "local_private",
          retentionPolicy: "operator_managed",
          providerPolicy: "automatic_enforcing_only",
          toolPolicy: "contract_allowlist",
          memoryScopes: ["verified_lessons"],
          contextNodeIds: [],
          safeStopConditions: ["Any dependency or scope conflict"],
          deliverables: ["Readiness exception report"],
        },
      },
    });
    expect(bypassAttempt.status()).toBe(409);
    expect(await bypassAttempt.json()).toMatchObject({
      error: {
        code: "autonomous_readiness_blocked",
        category: "dependency_missing",
        retryable: false,
        traceId: "e2e-fail-closed-trace",
      },
    });
    expect(await missionCount(request)).toBe(0);
  });

  test("Second Brain exposes an accessible empty canonical surface", async ({ page }) => {
    await page.goto("/brain");

    await expect(page.getByRole("heading", { level: 1, name: "Second Brain" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Second Brain" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Memory health" })).toBeVisible();
    await expect(page.getByRole("search").getByLabel("Search title, summary, and note text")).toBeVisible();
    await expect(page.getByText("No matching memory")).toBeVisible();

    await page.getByRole("link", { name: "Graph", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Memory Graph" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Memory graph controls" })).toBeVisible();
    await expect(page.getByText("The Second Brain is empty")).toBeVisible();

    await page.getByLabel("Edge type").selectOption("supports");
    await expect(page).toHaveURL(/edgeType=supports/u);
    await expect(page.getByText("No memories match this graph view")).toBeVisible();
    await page.getByText("Filters, labels, and time range").click();
    await page.getByLabel("Label density").selectOption("all");
    await expect(page).toHaveURL(/labels=all/u);
    await page.getByLabel("View name").fill("Evidence support path");
    await page.getByRole("button", { name: "Save current" }).click();
    await expect(page.getByRole("button", { name: "Evidence support path", exact: true })).toBeVisible();
    await expect(page.getByText("Operator-owned display settings stored only in this browser.")).toBeVisible();
    await page.getByRole("button", { name: "Attack path" }).click();
    await expect(page).toHaveURL(/preset=attack_path/u);
    await expect(page).not.toHaveURL(/edgeType=/u);
  });

  test("mobile shell keeps both journeys usable and navigation intentional", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const menu = page.getByRole("button", { name: "Open navigation" });
    await expect(menu).toBeVisible();
    await expect(page.locator(".os-journey-card h2")).toHaveText(["Go Autonomous", "Start Guided Mission"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("complementary", { name: "Primary navigation" }).getByRole("button", { name: "Close navigation" })).toBeVisible();
    await page.getByRole("link", { name: "Second Brain" }).click();
    await expect(page).toHaveURL(/\/brain$/u);
    await expect(page.getByRole("heading", { level: 1, name: "Second Brain" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
