import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import {
  BRAIN_SCALE_EDGE_COUNT,
  BRAIN_SCALE_NODE_COUNT,
  BRAIN_SCALE_SENTINEL_ID,
  BRAIN_SCALE_SENTINEL_TERM,
} from "./support/seed-brain-scale";

interface GraphPayload {
  readonly schemaVersion: string;
  readonly view: string;
  readonly rootNodeId?: string;
  readonly nodes: ReadonlyArray<{ readonly id: string }>;
  readonly edges: ReadonlyArray<{ readonly id: string }>;
  readonly availableNodeCount: number;
  readonly truncated: boolean;
}

interface SummaryPayload {
  readonly counts: {
    readonly confirmed: number;
    readonly edges: number;
  };
}

interface NodePagePayload {
  readonly items: ReadonlyArray<{ readonly id: string; readonly title: string }>;
  readonly totalReturned: number;
}

interface TimingEvidence {
  summaryApiMs: number;
  globalGraphApiMs: number;
  initialGraphInteractiveMs: number;
  progressiveGraphInteractiveMs: number;
  searchApiMs: number;
  localGraphApiMs: number;
  localGraphInteractiveMs: number;
  viewportAndTableMs: number;
}

const BUDGETS_MS: Readonly<TimingEvidence> = {
  summaryApiMs: 1_000,
  globalGraphApiMs: 1_000,
  initialGraphInteractiveMs: 1_500,
  progressiveGraphInteractiveMs: 1_500,
  searchApiMs: 300,
  localGraphApiMs: 200,
  localGraphInteractiveMs: 1_500,
  viewportAndTableMs: 1_500,
};

function elapsed(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 100) / 100;
}

async function timedJson<T>(
  request: APIRequestContext,
  path: string,
): Promise<{ readonly body: T; readonly elapsedMs: number; readonly bytes: number }> {
  const startedAt = performance.now();
  const response = await request.get(path);
  const elapsedMs = elapsed(startedAt);
  expect(response.ok(), `${path} should return a successful canonical response`).toBe(true);
  const text = await response.text();
  return {
    body: JSON.parse(text) as T,
    elapsedMs,
    bytes: Buffer.byteLength(text, "utf8"),
  };
}

async function waitForGraphLayout(page: Page, nodes: number): Promise<void> {
  const canvas = page.getByRole("application", { name: new RegExp(`Memory graph with ${nodes} nodes`, "u") });
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await expect(canvas).toHaveAttribute("aria-busy", "false", { timeout: 15_000 });
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  await testInfo.attach(name, {
    body: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
    contentType: "application/json",
  });
}

test.describe("E2E-only Second Brain 50,000-node profile", () => {
  test("uses canonical storage while progressively rendering bounded real graph segments", async ({ page, request }, testInfo) => {
    test.setTimeout(120_000);
    testInfo.annotations.push({
      type: "fixture",
      description: "E2E-only isolated temporary database; never available in production paths",
    });

    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });

    const timings = {} as TimingEvidence;
    const summary = await timedJson<SummaryPayload>(request, "/api/v2/brain/summary");
    timings.summaryApiMs = summary.elapsedMs;
    expect(summary.body.counts).toMatchObject({
      confirmed: BRAIN_SCALE_NODE_COUNT,
      edges: BRAIN_SCALE_EDGE_COUNT,
    });

    const globalGraph = await timedJson<GraphPayload>(
      request,
      "/api/v2/brain/graph?view=global&limit=250",
    );
    timings.globalGraphApiMs = globalGraph.elapsedMs;
    expect(globalGraph.body).toMatchObject({
      schemaVersion: "2.4",
      view: "global",
      truncated: true,
    });
    expect(globalGraph.body.nodes).toHaveLength(250);
    expect(globalGraph.body.availableNodeCount).toBe(BRAIN_SCALE_NODE_COUNT);
    expect(globalGraph.body.nodes.some((node) => node.id === BRAIN_SCALE_SENTINEL_ID)).toBe(false);
    expect(globalGraph.bytes).toBeLessThan(1_000_000);

    const initialStartedAt = performance.now();
    await page.goto("/brain/graph", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Memory Graph" })).toBeVisible();
    await waitForGraphLayout(page, 250);
    timings.initialGraphInteractiveMs = elapsed(initialStartedAt);
    await expect(page.locator(".brain-graph-meta")).toContainText("250 visible of 250 loaded · 50,000 accessible in this view");
    await expect(page.getByText("Bounded view", { exact: true })).toBeVisible();

    const progressiveStartedAt = performance.now();
    const progressiveResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/v2/brain/graph" && url.searchParams.get("limit") === "500";
    });
    await page.getByRole("button", { name: "Load another bounded segment" }).click();
    const progressiveResponse = await progressiveResponsePromise;
    expect(progressiveResponse.ok()).toBe(true);
    const progressivePayload = await progressiveResponse.json() as GraphPayload;
    expect(progressivePayload.nodes).toHaveLength(500);
    expect(progressivePayload.availableNodeCount).toBe(BRAIN_SCALE_NODE_COUNT);
    expect(progressivePayload.truncated).toBe(true);
    await waitForGraphLayout(page, 500);
    timings.progressiveGraphInteractiveMs = elapsed(progressiveStartedAt);
    await expect(page).toHaveURL(/limit=500/u);
    await expect(page.locator(".brain-graph-meta")).toContainText("500 visible of 500 loaded · 50,000 accessible in this view");

    const boundedDom = await page.evaluate(() => ({
      allElements: document.querySelectorAll("*").length,
      canvases: document.querySelectorAll("canvas").length,
      tableRows: document.querySelectorAll("tbody tr").length,
      htmlBytes: new TextEncoder().encode(document.documentElement.outerHTML).byteLength,
    }));
    expect(boundedDom.canvases).toBe(1);
    expect(boundedDom.tableRows).toBe(0);
    expect(boundedDom.allElements).toBeLessThan(5_000);
    expect(boundedDom.htmlBytes).toBeLessThan(2_000_000);

    const search = await timedJson<NodePagePayload>(
      request,
      `/api/v2/brain/nodes?query=${encodeURIComponent(BRAIN_SCALE_SENTINEL_TERM)}&limit=10`,
    );
    timings.searchApiMs = search.elapsedMs;
    expect(search.body.totalReturned).toBe(1);
    expect(search.body.items).toEqual([
      expect.objectContaining({ id: BRAIN_SCALE_SENTINEL_ID }),
    ]);

    const localGraph = await timedJson<GraphPayload>(
      request,
      `/api/v2/brain/graph?view=local&nodeId=${encodeURIComponent(BRAIN_SCALE_SENTINEL_ID)}&depth=2&limit=250`,
    );
    timings.localGraphApiMs = localGraph.elapsedMs;
    expect(localGraph.body).toMatchObject({
      view: "local",
      rootNodeId: BRAIN_SCALE_SENTINEL_ID,
      truncated: false,
    });
    expect(localGraph.body.nodes).toHaveLength(5);
    expect(localGraph.body.edges).toHaveLength(4);
    expect(localGraph.body.availableNodeCount).toBe(5);

    const localStartedAt = performance.now();
    await page.goto(
      `/brain/graph?view=local&root=${encodeURIComponent(BRAIN_SCALE_SENTINEL_ID)}&selected=${encodeURIComponent(BRAIN_SCALE_SENTINEL_ID)}`,
      { waitUntil: "domcontentloaded", timeout: 30_000 },
    );
    await waitForGraphLayout(page, 5);
    timings.localGraphInteractiveMs = elapsed(localStartedAt);
    await expect(page.locator(".brain-graph-meta")).toContainText("5 visible of 5 loaded · 5 accessible in this view");
    await expect(page.getByRole("heading", { name: `Scale search ${BRAIN_SCALE_SENTINEL_TERM}` })).toBeVisible();

    const interactionStartedAt = performance.now();
    const canvas = page.getByRole("application", { name: /Memory graph with 5 nodes/u });
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.getByRole("button", { name: "Fit" }).click();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.move(box.x + 8, box.y + 8);
      await page.mouse.down();
      await page.mouse.move(box.x + 72, box.y + 48, { steps: 4 });
      await page.mouse.up();
    }
    await canvas.focus();
    await expect(canvas).toBeFocused();

    await page.getByRole("button", { name: "Accessible table" }).click();
    const table = page.getByRole("table", { name: "Accessible memory graph node list" });
    await expect(table).toBeVisible();
    await expect(table.getByRole("row")).toHaveCount(6);
    await expect(table).toContainText(`Scale search ${BRAIN_SCALE_SENTINEL_TERM}`);
    await page.getByLabel("Search visible graph").fill(BRAIN_SCALE_SENTINEL_TERM);
    await expect(page.locator(".brain-graph-meta")).toContainText("1 visible of 5 loaded · 5 accessible in this view");
    await expect(table.getByRole("row")).toHaveCount(2);
    timings.viewportAndTableMs = elapsed(interactionStartedAt);

    const evidence = {
      fixture: "E2E-only isolated temporary database",
      canonicalCounts: summary.body.counts,
      boundedResponses: {
        initialNodes: globalGraph.body.nodes.length,
        progressiveNodes: progressivePayload.nodes.length,
        localNodes: localGraph.body.nodes.length,
        localEdges: localGraph.body.edges.length,
        initialPayloadBytes: globalGraph.bytes,
      },
      boundedDom,
      sentinel: {
        id: BRAIN_SCALE_SENTINEL_ID,
        term: BRAIN_SCALE_SENTINEL_TERM,
        absentFromInitialSegment: true,
        foundByCanonicalFts: true,
      },
      timingsMs: timings,
      budgetsMs: BUDGETS_MS,
      browserErrors,
    };
    await attachJson(testInfo, "e2e-only-second-brain-50000-node-evidence.json", evidence);
    console.log(`[e2e-only:brain-scale] ${JSON.stringify(evidence)}`);

    for (const [name, budget] of Object.entries(BUDGETS_MS) as Array<[keyof TimingEvidence, number]>) {
      expect(timings[name], `${name} exceeded the E2E-only local budget`).toBeLessThanOrEqual(budget);
    }
    expect(browserErrors).toEqual([]);
  });
});
