import { expect, test, type Locator, type Page } from "@playwright/test";

const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

async function tabTo(page: Page, target: Locator, maximumTabs = 120): Promise<void> {
  await expect(target).toBeVisible();
  for (let attempt = 0; attempt < maximumTabs; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement)) return;
  }
  throw new Error(`Keyboard focus did not reach ${await target.getAttribute("aria-label") ?? await target.textContent() ?? "target"}`);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

async function expectNamedInteractiveControls(page: Page): Promise<void> {
  const unnamed = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(
    "button, a[href], input, select, textarea, summary, [role='button'], [role='application']",
  )].filter((element) => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || bounds.width === 0 || bounds.height === 0) return false;
    const labelledBy = element.getAttribute("aria-labelledby")?.split(/\s+/u)
      .map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
    const label = element.id
      ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(element.id)}"]`)?.textContent?.trim()
      : undefined;
    return !(element.getAttribute("aria-label") || labelledBy || label || element.closest("label")?.textContent?.trim()
      || element.getAttribute("title") || element.textContent?.trim());
  }).map((element) => `${element.tagName.toLowerCase()}.${element.className}`));
  expect(unnamed).toEqual([]);
}

async function expectKeyboardFocusIndicator(target: Locator): Promise<void> {
  const focus = await target.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
      outlineStyle: style.outlineStyle,
      boxShadow: style.boxShadow,
    };
  });
  expect(
    (focus.outlineStyle !== "none" && focus.outlineWidth >= 2) || focus.boxShadow !== "none",
    "keyboard focus must have a visible outline or focus ring",
  ).toBe(true);
}

async function prepareVisualPage(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({ content: `
    *, *::before, *::after { caret-color: transparent !important; }
    time, .os-stream { visibility: hidden !important; }
  ` });
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

async function expectStablePageScreenshot(
  page: Page,
  name: string,
  options: { maxDiffPixels?: number } = {},
): Promise<void> {
  await prepareVisualPage(page);
  await expect(page).toHaveScreenshot(name, {
    animations: "disabled",
    mask: [page.locator("code:visible, .os-mono:visible")],
    maskColor: "#151b1e",
    ...options,
  });
}

async function expectStableRegionScreenshot(
  page: Page,
  region: Locator,
  name: string,
  options: { maxDiffPixels?: number } = {},
): Promise<void> {
  await prepareVisualPage(page);
  await expect(region).toHaveScreenshot(name, {
    animations: "disabled",
    mask: [region.locator("code:visible, .os-mono:visible")],
    maskColor: "#151b1e",
    ...options,
  });
}

test.describe.configure({ mode: "serial" });

test.describe("Command OS populated canonical browser journeys", () => {
  test("overview presents real Autonomous, Guided, attention, and Brain state", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "Command Center" })).toBeVisible();
    await expect(page.getByRole("link", { name: /\[E2E fixture\] Guided evidence lesson/u })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Needs attention" })).toBeVisible();
    await expect(page.getByText("Interpret one bounded fixture result")).toBeVisible();
    await expect(page.getByRole("region", { name: "Current operations summary" }).getByText("Pending decisions")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Second Brain pulse" })).toBeVisible();
    await expect(page.locator(".os-journey-card h2")).toHaveText(["Go Autonomous", "Start Guided Mission"]);
  });

  test("semantic in-app notifications persist read state and never imply external delivery", async ({ page, request }, testInfo) => {
    const readUnreadCount = async (): Promise<number> => {
      const response = await request.get("/api/v2/notifications/unread-count");
      expect(response.ok()).toBe(true);
      return (await response.json() as { unreadCount: number }).unreadCount;
    };

    const initialUnreadCount = await readUnreadCount();
    if (testInfo.retry === 0) expect(initialUnreadCount).toBe(25);
    await page.goto("/");
    const trigger = page.getByRole("button", { name: `Notifications, ${initialUnreadCount} unread` });
    await trigger.click();
    const panel = page.getByRole("dialog", { name: "In-app notifications" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Autonomous run safe-stopped")).toBeVisible();
    await expect(panel.getByText("Guided step ready")).toBeVisible();
    await expect(panel.getByText("Run completed").first()).toBeVisible();
    await expect(panel).toContainText("In-app delivery only. No email, SMS, or webhook is configured.");
    await expect(panel.locator("li")).toHaveCount(20);
    await panel.getByRole("button", { name: "Load older notifications" }).click();
    await expect(panel.locator("li")).toHaveCount(25);
    await expect(panel.getByRole("button", { name: "Load older notifications" })).toHaveCount(0);

    const markSafeStopRead = panel.getByRole("button", { name: "Mark Autonomous run safe-stopped as read" });
    if (testInfo.retry === 0) await expect(markSafeStopRead).toBeVisible();
    const safeStopWasUnread = await markSafeStopRead.count() > 0;
    if (safeStopWasUnread) await markSafeStopRead.click();
    const persistedUnreadCount = initialUnreadCount - (safeStopWasUnread ? 1 : 0);
    await expect(page.getByRole("button", { name: `Notifications, ${persistedUnreadCount} unread` })).toBeVisible();
    await page.reload();
    const reloadedTrigger = page.getByRole("button", { name: `Notifications, ${persistedUnreadCount} unread` });
    await expect(reloadedTrigger).toBeVisible();
    await reloadedTrigger.click();
    const reloadedPanel = page.getByRole("dialog", { name: "In-app notifications" });
    await reloadedPanel.getByRole("link", { name: /Autonomous run safe-stopped/u }).click();
    await expect(page).toHaveURL(/\/live\/run-e2e-safe-stop$/u);
    await expect(reloadedPanel).not.toBeVisible();
    await expect(reloadedTrigger).toBeFocused();

    const count = await request.get("/api/v2/notifications/unread-count", {
      headers: { "X-Request-ID": "e2e-notification-count" },
    });
    expect(count.ok()).toBe(true);
    expect(count.headers()["x-request-id"]).toBe("e2e-notification-count");
    expect(await count.json()).toEqual({ schemaVersion: "2.1", unreadCount: persistedUnreadCount });

    await reloadedTrigger.click();
    const reloadedNotificationPanel = page.getByRole("dialog", { name: "In-app notifications" });
    const markAllRead = reloadedNotificationPanel.getByRole("button", { name: "Mark all as read" });
    if (persistedUnreadCount > 0) await markAllRead.click();
    else await expect(markAllRead).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Notifications, 0 unread" })).toBeVisible();
    await expect.poll(readUnreadCount).toBe(0);
  });

  test("Autonomous composer inspects providers and specialists then signs exact memory and team selections", async ({ page }) => {
    await page.goto("/missions/new/autonomous");
    await page.getByLabel("Mission title").fill("[E2E] Reviewed Autonomous contract");
    await page.getByLabel("Authorized objective").fill("Review a bounded fixture observation under the exact signed policy");
    await page.getByLabel("Measurable success criteria").fill("One evidence-backed fixture observation is retained");
    await page.getByLabel("Required final deliverables").fill("Command OS JSON completion bundle");
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Engagement ID").fill("eng-e2e");
    await page.getByLabel("Allowed targets and boundaries").fill("fixture.local");
    await page.getByLabel("I confirm this mission is authorized").check();
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Pre-authorized action classes").fill("analysis");
    await page.getByLabel("Safe-stop conditions").fill("Any action outside the exact signed target or specialist pool");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByRole("heading", { name: "Inspected enforcing provider paths" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Autonomous enforcing provider paths" })).toContainText("grok-acp");
    const specialistList = page.getByRole("list", { name: "Compatible Autonomous specialists" });
    const staleFixtureSpecialist = page.getByRole("checkbox", { name: /Fixture Recon Specialist/u });
    await expect(staleFixtureSpecialist).toBeDisabled();
    await expect(specialistList).toContainText("Specialist status is offline");
    const compatibleSpecialist = specialistList.locator('input[type="checkbox"]:not(:disabled)').first();
    await expect(compatibleSpecialist).toBeChecked();
    await expect(specialistList).toContainText("Provider policy");
    await page.getByRole("button", { name: "Continue" }).click();

    const memory = page.getByRole("checkbox", { name: /Explain before acting/u });
    await expect(memory).toBeVisible();
    await memory.check();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page.getByText("Contract version")).toBeVisible();
    await expect(page.getByText("Selected memory nodes").locator("..")).toContainText("1; Context Pack created at planning");
    await expect(page.locator(".os-review-grid code")).toHaveText(/^[a-f0-9]{64}$/u);
    await expect(page.getByText("Contract is ready to launch")).toBeVisible();
    await expect(page.getByRole("button", { name: "Launch Autonomous Mission" })).toBeEnabled();
  });

  test("mission portfolio searches canonical state and retains an operator saved view", async ({ page }) => {
    await page.goto("/missions");

    await expect(page.getByRole("heading", { level: 1, name: "Missions" })).toBeVisible();
    await expect(page.getByText("[E2E fixture] Completed Autonomous review")).toBeVisible();
    await page.getByLabel("Mission, phase, run, or next action").fill("Guided evidence");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/query=Guided(?:\+|%20)evidence/u);
    await expect(page.getByText("[E2E fixture] Guided evidence lesson")).toBeVisible();
    await expect(page.getByText("[E2E fixture] Completed Autonomous review")).not.toBeVisible();

    await page.getByLabel("Journey").selectOption("guided");
    await page.getByRole("combobox", { name: "View", exact: true }).selectOption("board");
    await expect(page.getByLabel("Mission board")).toBeVisible();
    await page.getByPlaceholder("Name current filters").fill("Guided evidence board");
    await page.getByRole("button", { name: "Save view" }).click();
    await expect(page.getByRole("button", { name: "Guided evidence board", exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Guided evidence board", exact: true })).toBeVisible();
    await expect(page.getByLabel("Mission board")).toBeVisible();
  });

  test("mission portfolio confirms and downloads a redacted exact metadata selection", async ({ page }) => {
    await page.goto("/missions");
    await page.getByLabel("Mission, phase, run, or next action").fill("Completed Autonomous review");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await page.getByRole("checkbox", { name: "Select [E2E fixture] Completed Autonomous review" }).check();
    await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Export redacted metadata" }).click();
    const dialog = page.getByRole("dialog", { name: "Confirm redacted metadata export" });
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Confirm export" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Export redacted metadata" })).toBeFocused();
    await page.getByRole("button", { name: "Export redacted metadata" }).click();
    await expect(dialog).toContainText("Evidence blobs, objectives, target values, and confidential payloads are excluded.");
    await expect(dialog).toContainText("mission-e2e-auto-complete");
    const downloadPromise = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Confirm export" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^chillspwn-mission-metadata-[a-f0-9]{12}\.json$/u);
    await expect(page.getByText("Bulk operation recorded")).toBeVisible();
    await expect(page.getByText("1 succeeded; 0 unchanged.")).toBeVisible();
  });

  test("completed Autonomous run exposes evidence, evaluation, report, and context used", async ({ page }) => {
    await page.goto("/missions/mission-e2e-auto-complete");

    await expect(page.getByRole("heading", { level: 1, name: "[E2E fixture] Completed Autonomous review" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Completed autonomously" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Completion metrics" })).toContainText("1/1");
    await expect(page.getByText("The fixture run met its single evidence-backed success criterion without retries.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open mission memory graph" })).toHaveAttribute(
      "href",
      "/brain/graph?view=mission&mission=mission-e2e-auto-complete",
    );
    await page.getByRole("button", { name: "Verify fixture evidence using a permitted lesson" }).click();
    await expect(page.getByRole("heading", { name: "Verify fixture evidence using a permitted lesson" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Show memory path" })).toHaveAttribute("href", /\/brain\/graph\?view=local/u);
    await expect(page.getByRole("link", { name: "Export bounded evidence metadata" })).toHaveAttribute(
      "href",
      "/api/v2/intelligence/evidence/runs/run-e2e-auto-complete/export",
    );
    await expect(page.getByRole("link", { name: "Export restricted run audit" })).toHaveAttribute(
      "href",
      "/api/v2/observability/audit/runs/run-e2e-auto-complete/export",
    );

    await page.goto("/intelligence/evidence?runId=run-e2e-auto-complete");
    const evidenceExport = page.getByRole("region", { name: "Exact run evidence export" });
    await expect(evidenceExport.getByRole("heading", { name: "Bounded evidence metadata export" })).toBeVisible();
    await expect(evidenceExport.getByRole("link", { name: "Export evidence metadata" })).toHaveAttribute(
      "href",
      "/api/v2/intelligence/evidence/runs/run-e2e-auto-complete/export",
    );

    await page.goto("/intelligence/artifacts/report-e2e-complete");
    await expect(page.getByText("Metadata only", { exact: true })).toBeVisible();
    await expect(page.getByText(/Artifact content remains metadata-only/u)).toBeVisible();
    await expect(page.getByRole("link", { name: "Download verified content" })).toHaveCount(0);

    await page.goto("/reports/report-e2e-complete");
    await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
    await expect(page.getByText("Autonomous", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Context used" }).click();
    await expect(page.getByRole("heading", { name: "Verify fixture evidence using a permitted lesson" })).toBeVisible();
  });

  test("query-scoped links remain inside the application and preserve back navigation", async ({ page }) => {
    await page.goto("/missions/mission-e2e-auto-complete");
    await page.getByRole("link", { name: "Review evidence" }).click();

    await expect(page).toHaveURL(/\/intelligence\/evidence\?runId=run-e2e-auto-complete$/u);
    await expect(page.getByRole("heading", { level: 1, name: "Evidence, findings, and artifacts" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Exact run evidence export" })).toContainText("run-e2e-auto-complete");
    await expect(page.getByRole("heading", { level: 1, name: "Command surface not found" })).toHaveCount(0);

    await page.getByRole("textbox", { name: "Search" }).fill("fixture evidence");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/\/intelligence\/evidence\?.*query=fixture\+evidence/u);
    await expect(page.getByRole("heading", { level: 1, name: "Evidence, findings, and artifacts" })).toBeVisible();

    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "[E2E fixture] Completed Autonomous review" })).toBeVisible();
  });

  test("Completion Review presents measured budgets and performs exact-run reviews through canonical mutations", async ({ page, request }) => {
    await page.goto("/missions/mission-e2e-auto-complete");

    const budgets = page.getByRole("region", { name: "Terminal run budget review" });
    await expect(budgets.getByRole("heading", { name: "Limit versus recorded usage" })).toBeVisible();
    await expect(budgets).toContainText("Provider tokens");
    await expect(budgets).toContainText("Usage 120 · limit 1,000");
    await expect(budgets).toContainText("Recorded estimate");
    await expect(budgets).toContainText("Retries");

    const findingReview = page.getByRole("form", { name: "Review finding Fixture finding awaits independent review" });
    await findingReview.getByLabel("Finding review reason for Fixture finding awaits independent review").fill(
      "Browser acceptance independently reviewed the linked immutable evidence",
    );
    await findingReview.getByRole("button", { name: "Record finding review" }).click();
    await expect(findingReview.getByText(/Finding moved to verified/u)).toBeVisible();
    const finding = await request.get("/api/v2/intelligence/findings/finding-e2e-review");
    expect(finding.ok()).toBe(true);
    expect(await finding.json()).toMatchObject({ reviewStatus: "verified", version: 2, operatorOverride: false });

    const lessonReview = page.getByRole("form", { name: "Review lesson Require an independent reviewer before promoting this exact-run candidate" });
    await lessonReview.getByLabel("Lesson review reason for Require an independent reviewer before promoting this exact-run candidate").fill(
      "Browser acceptance confirms independent evidence-linked review",
    );
    await lessonReview.getByRole("button", { name: "Record lesson review" }).click();
    await expect(lessonReview.getByText(/Lesson moved to verified/u)).toBeVisible();
    const lesson = await request.get("/api/v2/learning/lessons/lesson-e2e-review");
    expect(lesson.ok()).toBe(true);
    expect(await lesson.json()).toMatchObject({ status: "verified", reviewedBy: expect.any(String) });

    const memoryReviews = page.getByRole("region", { name: "Exact-run memory candidate reviews" });
    await expect(memoryReviews).toContainText("Review completion evidence before retaining the procedure");
    await memoryReviews.getByRole("button", { name: "Confirm memory" }).click();
    await expect(page.getByText("No pending memory candidate has provenance resolving to this exact run.")).toBeVisible();
    const candidates = await request.get("/api/v2/brain/candidates?missionId=mission-e2e-auto-complete&runId=run-e2e-auto-complete&status=confirmed");
    expect(candidates.ok()).toBe(true);
    expect((await candidates.json() as { items: Array<{ id: string }> }).items.map((item) => item.id))
      .toContain("candidate-e2e-completion-review");
  });

  test("out-of-contract Autonomous run is visibly safe-stopped with a durable checkpoint", async ({ page }) => {
    await page.goto("/missions/mission-e2e-safe-stop/runs/run-e2e-safe-stop");

    await expect(page.getByRole("heading", { level: 1, name: "[E2E fixture] Autonomous safe stop" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Safe-stopped outside contract" })).toBeVisible();
    await page.getByRole("button", { name: "Live" }).click();
    const recovery = page.getByRole("region", { name: "Autonomous run safe-stopped" });
    await expect(recovery.getByRole("heading", { level: 2, name: "Autonomous run safe-stopped" })).toBeVisible();
    await expect(recovery.getByRole("region", { name: "Immutable recovery events" }).getByText("Safe-stopped: outside the signed fixture contract")).toBeVisible();
    const checkpoint = recovery.getByRole("region", { name: "Checkpoint" });
    await expect(checkpoint.getByRole("heading", { level: 3, name: "Checkpoint" })).toBeVisible();
    await expect(checkpoint.getByText("safe_no_in_flight_action")).toBeVisible();
    await expect(page.getByText("No action is dispatched")).toBeVisible();
  });

  test("transient failures and repeated-action loops expose bounded recovery truth in both journeys", async ({ page }) => {
    await page.goto("/live/run-e2e-auto-transient");
    await expect(page.getByRole("heading", { level: 1, name: "[E2E fixture] Autonomous transient recovery" })).toBeVisible();
    const autonomousTransient = page.getByRole("region", { name: "Autonomous recovery intelligence" });
    await expect(autonomousTransient).toContainText("Transient timeout classified; a bounded idempotent retry is scheduled after Retry-After.");
    await expect(autonomousTransient).toContainText("1/2 used · 1 remaining");
    await expect(autonomousTransient).toContainText("Retry the unchanged in-contract observation after the bounded delay");
    await expect(autonomousTransient).toContainText("Transient timeout classified; bounded retry honors Retry-After and the retry budget.");
    await expect(autonomousTransient).toContainText("Retry transient timeouts only after a bounded provider-directed delay");

    await page.goto("/live/run-e2e-auto-loop");
    const autonomousLoop = page.getByRole("region", { name: "Autonomous run safe-stopped" });
    await expect(autonomousLoop).toContainText("Repeated identical action fingerprint produced no meaningful progress within the configured bound.");
    await expect(autonomousLoop).toContainText("Failed actions retained3");
    await expect(autonomousLoop).toContainText("Third identical action fingerprint produced no progress; Autonomous execution stopped safely.");
    await expect(autonomousLoop).toContainText("Do not repeat an identical deterministic action without new evidence or changed facts");

    await page.goto("/live/run-e2e-guided-transient");
    await expect(page.getByRole("heading", { level: 1, name: "[E2E fixture] Guided transient recovery" })).toBeVisible();
    const guidedTransient = page.getByRole("region", { name: "Guided recovery needs your decision" });
    await expect(guidedTransient).toContainText("The represented observation timed out; a materially different recovery step awaits one exact decision.");
    await expect(guidedTransient).toContainText("Use a materially different read-only observation after explaining the timeout.");
    await expect(guidedTransient.getByRole("link", { name: "Review exact step" }))
      .toHaveAttribute("href", "/guided/mission-e2e-guided-transient");

    await page.goto("/live/run-e2e-guided-loop");
    const guidedLoop = page.getByRole("region", { name: "Guided recovery intelligence" });
    await expect(guidedLoop).toContainText("The same Guided action was regenerated without changed facts or missing information.");
    await expect(guidedLoop).toContainText("Failed actions retained3");
    await expect(guidedLoop).toContainText("Repeated Guided action was blocked because no changed fact justified another request.");
  });

  test("five canonical populated states have reduced-motion visual regression coverage", async ({ page, request }) => {
    test.slow();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });

    // Keep this visual baseline independent from whether the notification
    // journey ran earlier in the serial project or this test was selected in
    // isolation. The bell remains visible, while its actor-scoped unread badge
    // is put into one deterministic canonical state before capture.
    const markAllRead = await request.post("/api/v2/notifications/read-all", {
      headers: { "Idempotency-Key": "visual-baseline-notifications-read-all" },
      data: {},
    });
    expect(markAllRead.ok()).toBe(true);
    await expect.poll(async () => {
      const count = await request.get("/api/v2/notifications/unread-count");
      return (await count.json() as { unreadCount: number }).unreadCount;
    }).toBe(0);

    // The earlier Completion Review journey intentionally verifies this
    // finding. Bring an isolated visual run to the same canonical state so
    // the baseline does not depend on serial test order.
    const findingResponse = await request.get("/api/v2/intelligence/findings/finding-e2e-review");
    expect(findingResponse.ok()).toBe(true);
    const finding = await findingResponse.json() as { reviewStatus: string; version: number };
    if (finding.reviewStatus !== "verified") {
      const review = await request.post("/api/v2/intelligence/findings/finding-e2e-review/review", {
        headers: { "Idempotency-Key": "visual-baseline-finding-review" },
        data: {
          expectedVersion: finding.version,
          status: "verified",
          reason: "Normalize the canonical visual fixture after evidence-linked review",
        },
      });
      expect(review.ok()).toBe(true);
    }

    const confirmedCandidates = await request.get(
      "/api/v2/brain/candidates?missionId=mission-e2e-auto-complete&runId=run-e2e-auto-complete&status=confirmed",
    );
    expect(confirmedCandidates.ok()).toBe(true);
    const confirmedCandidateIds = (
      await confirmedCandidates.json() as { items: Array<{ id: string }> }
    ).items.map((item) => item.id);
    if (!confirmedCandidateIds.includes("candidate-e2e-completion-review")) {
      const confirmation = await request.post(
        "/api/v2/brain/candidates/candidate-e2e-completion-review/confirm",
        {
          headers: { "Idempotency-Key": "visual-baseline-memory-confirmation" },
          data: { edits: {} },
        },
      );
      expect(confirmation.ok()).toBe(true);
    }

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: "Second Brain pulse" })).toBeVisible();
    await expectStablePageScreenshot(page, "command-center-populated.png");

    await page.goto("/missions/mission-e2e-auto-complete");
    await expect(page.getByRole("heading", { level: 2, name: "Completed autonomously" })).toBeVisible();
    // Playwright's Ubuntu Chromium build can rasterize a few glyph edges
    // differently from the pinned Linux baseline. Keep this page under a
    // strict, absolute 0.035% pixel budget; structural drift still fails.
    await expectStablePageScreenshot(page, "autonomous-mission-workspace-populated.png", { maxDiffPixels: 500 });

    await page.goto("/guided/mission-e2e-guided");
    const exactDecision = page.getByRole("complementary", { name: "Exact Guided decision" });
    await expect(exactDecision.getByRole("heading", { level: 2, name: "Exact step decision" })).toBeVisible();
    await expectStableRegionScreenshot(page, exactDecision, "guided-exact-step-decision-populated.png");

    await page.goto("/live/run-e2e-auto-transient");
    const recovery = page.getByRole("region", { name: "Autonomous recovery intelligence" });
    await expect(recovery).toContainText("1/2 used · 1 remaining");
    await expectStableRegionScreenshot(page, recovery, "autonomous-recovery-populated.png");

    await page.goto("/brain/graph");
    await expect(page.getByText("Memory graph layout ready")).toBeAttached();
    const graph = page.locator(".brain-graph-workspace");
    await expect(graph.getByRole("application", { name: /Memory graph with 9 nodes and 5 relationships/u })).toBeVisible();
    // A newly confirmed candidate receives a cryptographically random stable
    // node ID, which intentionally introduces a few pixels of hash-seeded
    // layout jitter between isolated databases. Keep the shell, topology, and
    // inspector under regression while bounding that one-node variance.
    await expectStableRegionScreenshot(page, graph, "second-brain-graph-populated.png", { maxDiffPixels: 250 });
  });

  test("populated Autonomous, Guided, Decisions, and Brain remain mobile and keyboard operable", async ({ page }) => {
    test.slow();
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.emulateMedia({ reducedMotion: "reduce" });

    await page.goto("/missions/mission-e2e-auto-complete");
    await expect(page.getByRole("heading", { level: 1, name: "[E2E fixture] Completed Autonomous review" })).toBeVisible();
    const navigationButton = page.getByRole("button", { name: "Open navigation" });
    const navigationBounds = await navigationButton.boundingBox();
    expect(navigationBounds?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(navigationBounds?.height ?? 0).toBeGreaterThanOrEqual(44);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#command-os-content")).toBeFocused();
    const liveTab = page.getByRole("button", { name: "Live", exact: true });
    await tabTo(page, liveTab);
    await expectKeyboardFocusIndicator(liveTab);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 2, name: "Plan and agent ownership" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNamedInteractiveControls(page);

    await page.goto("/guided/mission-e2e-guided");
    await expect(page.getByRole("complementary", { name: "Exact Guided decision" })).toBeVisible();
    const exactParameters = page.locator("summary").filter({ hasText: "Exact normalized parameters" }).first();
    await tabTo(page, exactParameters);
    await expectKeyboardFocusIndicator(exactParameters);
    await page.keyboard.press("Enter");
    await expect(exactParameters.locator("..")).toHaveAttribute("open", "");
    await expectNoHorizontalOverflow(page);
    await expectNamedInteractiveControls(page);

    await page.keyboard.press("Control+K");
    const paletteSearch = page.getByRole("combobox", { name: /Search commands, missions/u });
    await expect(paletteSearch).toBeFocused();
    await page.keyboard.type("Decisions");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/decisions$/u);
    await expect(page.getByRole("heading", { level: 1, name: "Decisions" })).toBeVisible();
    await expect(page.getByText("Interpret one bounded fixture result")).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectNamedInteractiveControls(page);

    await page.keyboard.press("Control+K");
    await expect(paletteSearch).toBeFocused();
    await page.keyboard.type("Second Brain");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/brain$/u);
    const graphLink = page.getByRole("link", { name: "Graph", exact: true });
    await tabTo(page, graphLink);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/brain\/graph$/u);
    await expect(page.getByRole("application", { name: /Memory graph with (?:8|9) nodes and 5 relationships/u })).toBeVisible();

    const accessibleTable = page.getByRole("button", { name: "Accessible table" });
    await tabTo(page, accessibleTable);
    await expectKeyboardFocusIndicator(accessibleTable);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("table", { name: "Accessible memory graph node list" })).toBeVisible();
    const canvasView = page.getByRole("button", { name: "Canvas view" });
    await expect(canvasView).toBeFocused();
    await page.keyboard.press("Enter");
    const graphCanvas = page.getByRole("application", { name: /Memory graph with (?:8|9) nodes and 5 relationships/u });
    await tabTo(page, graphCanvas);
    await expectKeyboardFocusIndicator(graphCanvas);
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/selected=mem-/u);

    const reducedMotion = await page.evaluate(() => {
      const milliseconds = (value: string): number => Math.max(...value.split(",").map((part) => {
        const normalized = part.trim();
        const amount = Number.parseFloat(normalized) || 0;
        return normalized.endsWith("ms") ? amount : amount * 1_000;
      }));
      let longestAnimationMs = 0;
      let longestTransitionMs = 0;
      document.querySelectorAll<HTMLElement>("*").forEach((element) => {
        const style = getComputedStyle(element);
        longestAnimationMs = Math.max(longestAnimationMs, milliseconds(style.animationDuration));
        longestTransitionMs = Math.max(longestTransitionMs, milliseconds(style.transitionDuration));
      });
      return {
        matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
        longestAnimationMs,
        longestTransitionMs,
      };
    });
    expect(reducedMotion.matches).toBe(true);
    expect(reducedMotion.longestAnimationMs).toBeLessThanOrEqual(1);
    expect(reducedMotion.longestTransitionMs).toBeLessThanOrEqual(1);
    await expectNoHorizontalOverflow(page);
    await expectNamedInteractiveControls(page);
  });

  test("Guided browser flow explains, rejects drift, interprets manual output, resumes, records evidence, and advances", async ({ page, request }) => {
    await page.goto("/guided/mission-e2e-guided");

    await expect(page.getByRole("heading", { level: 1, name: "[E2E fixture] Guided evidence lesson" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Inspect the bounded fixture result" }).first()).toBeVisible();
    await expect(page.getByText("This bounded fixture step explains inspect the bounded fixture result before any consequential action.").first()).toBeVisible();
    await expect(page.getByText("We are in evidence review.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Skip exact step" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Stop mission" })).toBeDisabled();
    await expect(page.getByRole("heading", { name: "I ran it — submit and interpret output" })).toBeVisible();
    await expect(page.getByText("Creates no action and no evidence.")).toBeVisible();

    const altered = await request.post("/api/v2/guided-decisions/decision-e2e-guided/skip", {
      headers: { "Idempotency-Key": "e2e-altered-guided-skip" },
      data: {
        expectedFingerprint: "0".repeat(64),
        expectedParameters: { procedure: "A materially changed procedure" },
        reason: "This request must fail closed",
      },
    });
    expect([409, 422]).toContain(altered.status());
    const decisions = await request.get("/api/v2/decisions?runId=run-e2e-guided&status=pending&limit=10");
    expect(decisions.ok()).toBe(true);
    expect(await decisions.json()).toMatchObject({ items: [{ id: "decision-e2e-guided", status: "pending" }] });

    await page.getByLabel("Result text").fill("fixture health=ok");
    await page.getByRole("button", { name: "Interpret only — keep step paused" }).click();
    await expect(page.getByText("[E2E fixture] The bounded result contains the expected success marker.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Interpretation ready for your decision" })).toBeVisible();
    await expect(page.getByText("[E2E fixture] Result matches the represented success pattern")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept interpreted evidence and advance exact step" })).toBeDisabled();

    // The observation gate is reconstructed from canonical evidence and chain
    // records after reload; it is not owned by component state or transcript.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Interpretation ready for your decision" })).toBeVisible();
    await page.getByLabel("I performed the exact represented action and reviewed this interpretation.").check();
    await page.getByRole("button", { name: "Accept interpreted evidence and advance exact step" }).click();
    await expect(page.getByText("Reviewed evidence verified. The exact step advanced to its next durable checkpoint.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Review the next bounded checkpoint" }).first()).toBeVisible();

    const resolved = await request.get("/api/v2/decisions?runId=run-e2e-guided&limit=10");
    expect(resolved.ok()).toBe(true);
    const resolvedBody = await resolved.json() as { items: Array<{ id: string; stepId: string; status: string }> };
    expect(resolvedBody.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "decision-e2e-guided", status: "manual" }),
      expect.objectContaining({ stepId: "step-e2e-guided-next", status: "pending" }),
    ]));
  });

  test("Second Brain graph is real and correction then forgetting changes retrieval", async ({ page, request }) => {
    await page.goto("/brain/graph");
    await expect(page.getByRole("heading", { level: 1, name: "Memory Graph" })).toBeVisible();
    await expect(page.getByText(/(?:8 visible of 8|9 visible of 9) loaded nodes/u)).toBeVisible();
    await expect(page.getByRole("application", { name: /Memory graph with (?:8|9) nodes and 5 relationships/u })).toBeVisible();
    const physics = page.getByRole("button", { name: "Physics: fixed clusters" });
    await physics.click();
    await expect(page.getByRole("button", { name: "Physics: relationship weighted" })).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/physics=1/u);
    await page.getByText("Filters, labels, and time range").click();
    await page.getByRole("button", { name: "Collapse Failure (2)" }).click();
    await expect(page.getByRole("application", { name: /Memory graph with (?:7|8) nodes and 4 relationships/u })).toBeVisible();
    await expect(page.getByRole("button", { name: "Expand Failure (2)" })).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/collapsed=failure/u);
    await page.goto("/brain/graph?pathFrom=mem-e2e-evidence&selected=mem-e2e-technique");
    await expect(page.getByText("Shortest path from")).toBeVisible();
    await expect(page.getByText("mem-e2e-evidence", { exact: true })).toBeVisible();
    await expect(page.getByText("Shortest memory path contains 3 nodes")).toBeAttached();

    const beforePack = await request.get("/api/v2/brain/context-packs/context-e2e-complete");
    expect(beforePack.ok()).toBe(true);
    expect((await beforePack.json() as { items: Array<{ node: { id: string } }> }).items.map((item) => item.node.id)).toContain("mem-e2e-preference");

    const vaultConnect = await request.post("/api/v2/brain/vault/connect", {
      headers: { "Idempotency-Key": "e2e-node-vault-connect-0001" },
      data: {
        vaultPath: "E2E-Operator-Brain",
        displayName: "E2E Operator Brain",
        permissionGranted: true,
      },
    });
    expect(vaultConnect.status()).toBe(201);
    await page.goto("/brain/nodes/mem-e2e-preference");
    await expect(page.getByRole("heading", { level: 1, name: "Explain before acting" })).toBeVisible();
    await page.getByRole("button", { name: "Export this memory" }).click();
    await expect(page.getByText("This memory was exported as a versioned Obsidian note.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open this note in Obsidian" })).toHaveAttribute("href", /^obsidian:\/\//u);
    await page.getByRole("button", { name: "Correct memory" }).click();
    const dialog = page.getByRole("dialog", { name: "Correct memory" });
    await expect(dialog.getByLabel("Title")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Correct memory" })).toBeFocused();
    await page.getByRole("button", { name: "Correct memory" }).click();
    await dialog.getByLabel("Title").fill("Explain before acting — corrected");
    await dialog.getByLabel("Reason for correction").fill("Browser acceptance verifies versioned operator correction");
    await dialog.getByRole("button", { name: "Save correction" }).click();
    await expect(page.getByText("Memory corrected and versioned.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Explain before acting — corrected" })).toBeVisible();
    const corrected = await request.get("/api/v2/brain/nodes/mem-e2e-preference");
    expect(corrected.ok()).toBe(true);
    expect(await corrected.json()).toMatchObject({ node: { version: 2, title: "Explain before acting — corrected" } });

    await page.getByLabel("Reason", { exact: true }).fill("Browser acceptance verifies complete operator-controlled forgetting");
    await page.getByLabel("Type FORGET").fill("FORGET");
    await page.getByRole("button", { name: "Forget permanently" }).click();
    await expect(page).toHaveURL(/\/brain$/u);
    const forgotten = await request.get("/api/v2/brain/nodes/mem-e2e-preference");
    expect(forgotten.ok()).toBe(true);
    expect(await forgotten.json()).toMatchObject({
      node: {
        lifecycleStatus: "forgotten",
        title: "[Forgotten memory]",
        summary: "",
        body: "",
      },
      sources: [],
      backlinks: [],
      outgoing: [],
      versions: [],
      usage: [],
    });
    const afterPack = await request.get("/api/v2/brain/context-packs/context-e2e-complete");
    expect(afterPack.ok()).toBe(true);
    expect((await afterPack.json() as { items: Array<{ node: { id: string } }> }).items.map((item) => item.node.id)).not.toContain("mem-e2e-preference");
    const graph = await request.get("/api/v2/brain/graph?view=global&limit=250");
    expect(graph.ok()).toBe(true);
    expect((await graph.json() as { nodes: Array<{ id: string }> }).nodes.map((node) => node.id)).not.toContain("mem-e2e-preference");
  });

  test("Completion Review creates a real same-contract follow-up with explicit verified-lesson eligibility", async ({ page, request }) => {
    await page.goto("/missions/mission-e2e-auto-complete");
    await expect(page.getByRole("heading", { level: 3, name: "Create a follow-up run" })).toBeVisible();

    const lesson = page.getByRole("checkbox", {
      name: /Require a fresh immutable evidence delta before declaring the follow-up complete/u,
    });
    await expect(lesson).toBeVisible();
    await lesson.check();
    await page.getByLabel("Reason for the follow-up (audited)").fill(
      "Validate that a fresh bounded attempt advances immutable evidence without changing scope",
    );
    await page.getByRole("button", { name: "Create follow-up run" }).click();

    await expect(page).toHaveURL(/\/missions\/mission-e2e-auto-complete\/runs\/run_[a-f0-9-]+$/u);
    await expect(page.getByRole("heading", { level: 1, name: "[E2E fixture] Completed Autonomous review" })).toBeVisible();
    const runId = new URL(page.url()).pathname.split("/").at(-1)!;

    const runResponse = await request.get(`/api/v2/runs/${encodeURIComponent(runId)}`);
    expect(runResponse.ok()).toBe(true);
    expect(await runResponse.json()).toMatchObject({
      run: { id: runId, missionId: "mission-e2e-auto-complete", journey: "autonomous" },
    });
    const eventResponse = await request.get(`/api/v2/observability/events?runId=${encodeURIComponent(runId)}&limit=20`);
    expect(eventResponse.ok()).toBe(true);
    const eventBody = await eventResponse.json() as {
      items: Array<{ eventType: string; payload: { selectedVerifiedLessonIds?: string[]; contractChanged?: boolean; journeyChanged?: boolean } }>;
    };
    expect(eventBody.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: "run.follow_up_created",
        payload: expect.objectContaining({
          selectedVerifiedLessonIds: ["lesson-e2e-verified-follow-up"],
          contractChanged: false,
          journeyChanged: false,
        }),
      }),
    ]));
    const usageResponse = await request.get(`/api/v2/learning/usage?runId=${encodeURIComponent(runId)}&limit=20`);
    expect(usageResponse.ok()).toBe(true);
    expect(await usageResponse.json()).toMatchObject({ items: [] });
  });
});
