import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test.describe("Command OS populated canonical browser journeys", () => {
  test("overview presents real Autonomous, Guided, attention, and Brain state", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1, name: "Command Center" })).toBeVisible();
    await expect(page.getByText("[E2E fixture] Guided evidence lesson")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Needs attention" })).toBeVisible();
    await expect(page.getByText("Interpret one bounded fixture result")).toBeVisible();
    await expect(page.getByRole("region", { name: "Current operations summary" }).getByText("Pending decisions")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Second Brain pulse" })).toBeVisible();
    await expect(page.locator(".os-journey-card h2")).toHaveText(["Go Autonomous", "Start Guided Mission"]);
  });

  test("completed Autonomous run exposes evidence, evaluation, report, and context used", async ({ page }) => {
    await page.goto("/missions/mission-e2e-auto-complete");

    await expect(page.getByRole("heading", { level: 1, name: "[E2E fixture] Completed Autonomous review" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Completed autonomously" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Completion metrics" })).toContainText("1/1");
    await expect(page.getByText("The fixture run met its single evidence-backed success criterion without retries.")).toBeVisible();
    await page.getByRole("button", { name: "Inspect context-e2e-complete" }).click();
    await expect(page.getByRole("heading", { name: "Verify fixture evidence using a permitted lesson" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Show memory path" })).toHaveAttribute("href", /\/brain\/graph\?view=local/u);

    await page.goto("/reports/report-e2e-complete");
    await expect(page.getByRole("heading", { level: 1, name: "Reports" })).toBeVisible();
    await expect(page.getByText("Autonomous", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Context used" }).click();
    await expect(page.getByRole("heading", { name: "Verify fixture evidence using a permitted lesson" })).toBeVisible();
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

  test("Guided workspace explains one step and rejects altered exact parameters", async ({ page, request }) => {
    await page.goto("/guided/mission-e2e-guided");

    await expect(page.getByRole("heading", { level: 1, name: "[E2E fixture] Guided evidence lesson" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Inspect the bounded fixture result" }).first()).toBeVisible();
    await expect(page.getByText("This bounded fixture step explains inspect the bounded fixture result before any consequential action.").first()).toBeVisible();
    await expect(page.getByText("We are in evidence review.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Complete exact step and advance" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Skip exact step" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Stop mission" })).toBeDisabled();
    await expect(page.getByText("This is not interpretation.")).toBeVisible();
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
  });

  test("Second Brain graph is real and correction then forgetting changes retrieval", async ({ page, request }) => {
    await page.goto("/brain/graph");
    await expect(page.getByRole("heading", { level: 1, name: "Memory Graph" })).toBeVisible();
    await expect(page.getByText("8 visible of 8 loaded nodes")).toBeVisible();
    await expect(page.getByRole("application", { name: /Memory graph with 8 nodes and 5 relationships/u })).toBeVisible();

    const beforePack = await request.get("/api/v2/brain/context-packs/context-e2e-complete");
    expect(beforePack.ok()).toBe(true);
    expect((await beforePack.json() as { items: Array<{ node: { id: string } }> }).items.map((item) => item.node.id)).toContain("mem-e2e-preference");

    await page.goto("/brain/nodes/mem-e2e-preference");
    await expect(page.getByRole("heading", { level: 1, name: "Explain before acting" })).toBeVisible();
    await page.getByRole("button", { name: "Correct memory" }).click();
    const dialog = page.getByRole("dialog", { name: "Correct memory" });
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
});
