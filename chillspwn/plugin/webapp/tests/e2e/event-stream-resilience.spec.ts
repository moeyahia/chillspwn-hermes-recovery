import { expect, test } from "@playwright/test";

test("falls back to bounded authoritative refreshes when the live stream is unavailable", async ({ page }) => {
  let streamRequests = 0;
  let overviewRequests = 0;
  let allowStream = false;

  await page.route("**/api/v2/events/stream**", async (route) => {
    streamRequests += 1;
    if (allowStream) await route.continue();
    else await route.abort("connectionrefused");
  });
  await page.route("**/api/v2/overview", async (route) => {
    overviewRequests += 1;
    await route.continue();
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Command Center" })).toBeVisible();
  await expect.poll(() => streamRequests, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
  await expect(page.locator(".os-stream")).toContainText("Fallback refresh");
  await expect(page.getByRole("status").filter({ hasText: "Live stream degraded" })).toBeAttached();
  await expect.poll(() => overviewRequests).toBeGreaterThanOrEqual(2);

  const reconciliationsAfterFallback = overviewRequests;
  await page.waitForTimeout(1_500);
  expect(overviewRequests).toBe(reconciliationsAfterFallback);

  const streamAttemptsBeforeBackgrounding = streamRequests;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(4_500);
  expect(streamRequests).toBe(streamAttemptsBeforeBackgrounding);
  expect(overviewRequests).toBe(reconciliationsAfterFallback);

  allowStream = true;
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.locator(".os-stream")).toContainText("Live");
  const reconciliationsAfterRecovery = overviewRequests;
  await page.waitForTimeout(1_500);
  expect(overviewRequests).toBe(reconciliationsAfterRecovery);
});
