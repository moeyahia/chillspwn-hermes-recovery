import { expect, test } from "@playwright/test";

test.describe("ChillsPwn User Manual", () => {
  test("answers how to start an engagement and links both real journeys", async ({ page }) => {
    await page.goto("/manual");

    await expect(page.getByRole("heading", { level: 1, name: "ChillsPwn User Manual" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "To start a new engagement, create its first Mission" })).toBeVisible();
    await expect(page.getByText("There is no separate Create Engagement page today")).toBeVisible();
    await expect(page.getByRole("link", { name: "Go Autonomous", exact: true })).toHaveAttribute("href", "/missions/new/autonomous");
    await expect(page.getByRole("link", { name: "Start Guided Mission", exact: true })).toHaveAttribute("href", "/missions/new/guided");
    await expect(page.getByRole("navigation", { name: "Manual sections" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Functions that are not available in the current UI" })).toBeVisible();
  });

  test("manual search narrows sections without hiding the permanent support link", async ({ page }) => {
    await page.goto("/manual");
    await page.getByLabel("Search this manual").fill("Obsidian");

    await expect(page.getByRole("heading", { level: 2, name: "Second Brain and Obsidian" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Autonomous missions" })).toHaveCount(0);
    await expect(page.getByRole("complementary", { name: "Primary navigation" }).getByRole("link", { name: "User Manual" })).toBeVisible();
  });

  test("command palette finds the manual using engagement help language", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+K");
    await page.getByRole("combobox", { name: /Search commands, missions/u }).fill("new engagement help");
    await expect(page.getByRole("option", { name: /User Manual/u })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/manual$/u);
    await expect(page.getByRole("heading", { level: 1, name: "ChillsPwn User Manual" })).toBeVisible();
  });

  test("remains vertically scrollable without document overflow on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/manual");
    await expect(page.getByRole("heading", { level: 1, name: "ChillsPwn User Manual" })).toBeVisible();

    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1);
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.viewportHeight * 2);

    await page.getByRole("link", { name: "Keyboard, mobile, and readable use" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Keyboard, mobile, and readable use" })).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });
});
