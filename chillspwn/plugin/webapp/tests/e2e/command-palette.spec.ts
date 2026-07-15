import { expect, test } from "@playwright/test";

test.describe("Global Command Palette", () => {
  test("keeps exactly two journey launch commands and restores keyboard focus", async ({ page }) => {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Search or run a command" });
    await trigger.focus();
    await page.keyboard.press("Control+K");

    const dialog = page.getByRole("dialog", { name: "Command palette" });
    const search = page.getByRole("combobox", { name: /Search commands, missions/u });
    await expect(dialog).toBeVisible();
    await expect(search).toBeFocused();
    await expect(dialog.getByRole("group", { name: "Journeys" }).getByRole("option")).toHaveText([
      /Go Autonomous/u,
      /Start Guided Mission/u,
    ]);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("navigates with ranked keyboard results and exposes bounded real search APIs", async ({ page, request }) => {
    for (const path of [
      "/api/v2/missions?query=credential&limit=10",
      "/api/v2/runs?query=credential&limit=10",
      "/api/v2/decisions?query=credential&limit=10",
      "/api/v2/agents?query=credential&limit=10",
      "/api/v2/brain/nodes?query=credential&limit=10",
    ]) {
      const response = await request.get(path);
      expect(response.ok(), path).toBe(true);
      const body = await response.json() as { schemaVersion: string; items: unknown[] };
      expect(body.schemaVersion).toBe("2.1");
      expect(Array.isArray(body.items)).toBe(true);
    }

    await page.goto("/");
    await page.keyboard.press("Control+K");
    const search = page.getByRole("combobox", { name: /Search commands, missions/u });
    await search.fill("Start Guided Mission");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/missions\/new\/guided$/u);
    await expect(page.getByRole("heading", { level: 1, name: "Start with the authorized objective" })).toBeVisible();
  });
});
