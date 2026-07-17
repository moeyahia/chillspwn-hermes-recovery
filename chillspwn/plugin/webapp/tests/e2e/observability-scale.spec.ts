import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import {
  OBSERVABILITY_SCALE_EVENT_COUNT,
  OBSERVABILITY_SCALE_FILTER_EVENT_TYPE,
  OBSERVABILITY_SCALE_LOG_COUNT,
  OBSERVABILITY_SCALE_SEARCH_TERM,
  OBSERVABILITY_SCALE_TRACE_ID,
} from "./support/seed-observability-scale";

interface CursorPage<T> {
  readonly schemaVersion: "2.4";
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

interface EventRecord {
  readonly id: string;
  readonly eventType: string;
  readonly summary: string;
  readonly journey: "autonomous" | "guided";
}

interface LogRecord {
  readonly id: string;
  readonly severity: string;
  readonly domain: string;
  readonly message: string;
}

interface TraceSummary {
  readonly traceId: string;
  readonly summary: string;
  readonly counts: {
    readonly events: number;
    readonly logs: number;
    readonly actions: number;
    readonly toolCalls: number;
    readonly errors: number;
  };
}

interface TraceRecord {
  readonly id: string;
  readonly kind: "event" | "log" | "action" | "tool_call";
  readonly title: string;
  readonly summary: string;
}

interface TraceDetail {
  readonly schemaVersion: "2.4";
  readonly trace: TraceSummary;
  readonly records: CursorPage<TraceRecord>;
}

interface TimingEvidence {
  eventFirstApiMs: number;
  eventNextApiMs: number;
  traceSearchApiMs: number;
  traceFirstApiMs: number;
  traceNextApiMs: number;
  logSearchApiMs: number;
  traceUiInteractiveMs: number;
  traceNextUiMs: number;
  eventNextUiMs: number;
  eventFilterUiMs: number;
  logFilterUiMs: number;
  scrollFramesMs: number;
}

const BUDGETS_MS: Readonly<TimingEvidence> = {
  eventFirstApiMs: 1_000,
  eventNextApiMs: 1_000,
  traceSearchApiMs: 3_000,
  traceFirstApiMs: 3_000,
  traceNextApiMs: 3_000,
  logSearchApiMs: 500,
  traceUiInteractiveMs: 5_000,
  traceNextUiMs: 5_000,
  eventNextUiMs: 3_000,
  eventFilterUiMs: 3_000,
  logFilterUiMs: 3_000,
  scrollFramesMs: 500,
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

async function attachJson(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  await testInfo.attach(name, {
    body: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
    contentType: "application/json",
  });
}

async function installLongTaskObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = window as Window & { __chillspwnLongTasks?: number[] };
    target.__chillspwnLongTasks = [];
    if (!("PerformanceObserver" in window)) return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) target.__chillspwnLongTasks?.push(entry.duration);
      });
      observer.observe({ entryTypes: ["longtask"] });
    } catch {
      // Unsupported browsers still produce an explicit empty measurement.
    }
  });
}

function ids<T extends { readonly id: string }>(items: readonly T[]): Set<string> {
  return new Set(items.map((item) => item.id));
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let count = 0;
  left.forEach((item) => { if (right.has(item)) count += 1; });
  return count;
}

test.describe("E2E-only 100,000-event observability profile", () => {
  test("keeps canonical APIs and semantic browser views cursor-bounded and responsive", async ({ page, request }, testInfo) => {
    test.setTimeout(180_000);
    testInfo.annotations.push({
      type: "fixture",
      description: "E2E-only isolated temporary database; never available in production paths",
    });

    const browserErrors: string[] = [];
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") browserErrors.push(message.text());
    });
    await installLongTaskObserver(page);

    const timings = {} as TimingEvidence;
    const firstEvents = await timedJson<CursorPage<EventRecord>>(
      request,
      "/api/v2/observability/events?limit=50",
    );
    timings.eventFirstApiMs = firstEvents.elapsedMs;
    expect(firstEvents.body.items).toHaveLength(50);
    expect(firstEvents.body.nextCursor).toEqual(expect.any(String));
    expect(firstEvents.bytes).toBeLessThan(150_000);

    const nextEvents = await timedJson<CursorPage<EventRecord>>(
      request,
      `/api/v2/observability/events?limit=50&cursor=${encodeURIComponent(firstEvents.body.nextCursor!)}`,
    );
    timings.eventNextApiMs = nextEvents.elapsedMs;
    expect(nextEvents.body.items).toHaveLength(50);
    expect(intersectionSize(ids(firstEvents.body.items), ids(nextEvents.body.items))).toBe(0);

    const traceSearch = await timedJson<CursorPage<TraceSummary>>(
      request,
      `/api/v2/observability/traces?limit=50&query=${encodeURIComponent(OBSERVABILITY_SCALE_SEARCH_TERM)}`,
    );
    timings.traceSearchApiMs = traceSearch.elapsedMs;
    expect(traceSearch.body.items).toEqual([
      expect.objectContaining({
        traceId: OBSERVABILITY_SCALE_TRACE_ID,
        counts: expect.objectContaining({
          events: OBSERVABILITY_SCALE_EVENT_COUNT,
          logs: OBSERVABILITY_SCALE_LOG_COUNT,
        }),
      }),
    ]);
    expect(traceSearch.body.items[0]?.summary).toContain(OBSERVABILITY_SCALE_SEARCH_TERM);

    const firstTrace = await timedJson<TraceDetail>(
      request,
      `/api/v2/observability/traces/${encodeURIComponent(OBSERVABILITY_SCALE_TRACE_ID)}?limit=50`,
    );
    timings.traceFirstApiMs = firstTrace.elapsedMs;
    expect(firstTrace.body.trace.counts).toMatchObject({
      events: OBSERVABILITY_SCALE_EVENT_COUNT,
      logs: OBSERVABILITY_SCALE_LOG_COUNT,
      actions: 0,
      toolCalls: 0,
      errors: 0,
    });
    expect(firstTrace.body.records.items).toHaveLength(50);
    expect(new Set(firstTrace.body.records.items.map((item) => item.kind))).toEqual(new Set(["event", "log"]));
    expect(firstTrace.body.records.nextCursor).toEqual(expect.any(String));
    expect(firstTrace.bytes).toBeLessThan(150_000);

    const nextTrace = await timedJson<TraceDetail>(
      request,
      `/api/v2/observability/traces/${encodeURIComponent(OBSERVABILITY_SCALE_TRACE_ID)}?limit=50&cursor=${encodeURIComponent(firstTrace.body.records.nextCursor!)}`,
    );
    timings.traceNextApiMs = nextTrace.elapsedMs;
    expect(nextTrace.body.records.items).toHaveLength(50);
    expect(intersectionSize(ids(firstTrace.body.records.items), ids(nextTrace.body.records.items))).toBe(0);

    const logSearch = await timedJson<CursorPage<LogRecord>>(
      request,
      `/api/v2/observability/logs?limit=50&severity=warn&query=${encodeURIComponent(OBSERVABILITY_SCALE_SEARCH_TERM)}`,
    );
    timings.logSearchApiMs = logSearch.elapsedMs;
    expect(logSearch.body.items).toEqual([
      expect.objectContaining({
        id: "log-observability-scale-sentinel",
        severity: "warn",
        domain: "provider",
      }),
    ]);

    const traceUiStartedAt = performance.now();
    await page.goto(
      `/observability?view=traces&limit=50&query=${encodeURIComponent(OBSERVABILITY_SCALE_SEARCH_TERM)}`,
      { waitUntil: "domcontentloaded", timeout: 30_000 },
    );
    await expect(page.getByRole("heading", { level: 1, name: "Observability" })).toBeVisible();
    const traceResult = page.getByRole("button", { name: new RegExp(OBSERVABILITY_SCALE_SEARCH_TERM, "u") });
    await expect(traceResult).toBeVisible({ timeout: 15_000 });
    await traceResult.click();
    const waterfall = page.getByRole("list", { name: new RegExp(OBSERVABILITY_SCALE_TRACE_ID, "u") });
    await expect(waterfall).toBeVisible({ timeout: 15_000 });
    await expect(waterfall.locator(":scope > li")).toHaveCount(50);
    const renderedKinds = new Set(await waterfall.locator(".os-trace-kind").allTextContents());
    expect(renderedKinds).toEqual(new Set(["event", "log"]));
    await expect(
      waterfall.getByText(`Provider recovery sentinel ${OBSERVABILITY_SCALE_SEARCH_TERM} was acknowledged.`),
    ).toBeVisible();
    timings.traceUiInteractiveMs = elapsed(traceUiStartedAt);

    const firstWaterfallSummaries = await waterfall.locator(".os-trace-record-body > p").allTextContents();
    const traceNextStartedAt = performance.now();
    const nextTraceUiResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === `/api/v2/observability/traces/${OBSERVABILITY_SCALE_TRACE_ID}`
        && Boolean(url.searchParams.get("cursor"));
    });
    await page.locator(".os-trace-detail").getByRole("button", { name: "Next page" }).click();
    expect((await nextTraceUiResponse).ok()).toBe(true);
    await expect.poll(async () => waterfall.locator(".os-trace-record-body > p").allTextContents()).not.toEqual(firstWaterfallSummaries);
    await expect(waterfall.locator(":scope > li")).toHaveCount(50);
    timings.traceNextUiMs = elapsed(traceNextStartedAt);

    await page.getByRole("button", { name: "Events", exact: true }).click();
    const feed = page.locator(".os-semantic-feed");
    await expect(feed.locator(":scope > li")).toHaveCount(50, { timeout: 15_000 });
    await expect(feed).toContainText("New evidence strengthened finding confidence at event 100000.");
    const firstEventSummary = await feed.locator("article strong").first().textContent();

    const boundedDom = await page.evaluate(() => ({
      allElements: document.querySelectorAll("*").length,
      semanticRows: document.querySelectorAll(".os-semantic-feed > li").length,
      tableRows: document.querySelectorAll("tbody tr").length,
      htmlBytes: new TextEncoder().encode(document.documentElement.outerHTML).byteLength,
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
    }));
    expect(boundedDom.semanticRows).toBe(50);
    expect(boundedDom.allElements).toBeLessThan(5_000);
    expect(boundedDom.htmlBytes).toBeLessThan(2_000_000);
    expect(boundedDom.scrollHeight).toBeGreaterThan(boundedDom.viewportHeight);

    timings.scrollFramesMs = await page.evaluate(async () => {
      const startedAt = performance.now();
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return Math.round((performance.now() - startedAt) * 100) / 100;
    });

    const eventNextStartedAt = performance.now();
    const nextEventUiResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/v2/observability/events" && Boolean(url.searchParams.get("cursor"));
    });
    await page.getByRole("navigation", { name: "Results pages" }).getByRole("button", { name: "Next page" }).click();
    expect((await nextEventUiResponse).ok()).toBe(true);
    await expect.poll(async () => feed.locator("article strong").first().textContent()).not.toBe(firstEventSummary);
    await expect(feed.locator(":scope > li")).toHaveCount(50);
    timings.eventNextUiMs = elapsed(eventNextStartedAt);

    const eventFilterStartedAt = performance.now();
    await page.getByLabel("Event type").fill(OBSERVABILITY_SCALE_FILTER_EVENT_TYPE);
    await page.getByLabel("Journey").selectOption("autonomous");
    const filteredEventResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/v2/observability/events"
        && url.searchParams.get("eventType") === OBSERVABILITY_SCALE_FILTER_EVENT_TYPE
        && url.searchParams.get("journey") === "autonomous";
    });
    await page.getByRole("button", { name: "Apply filters" }).click();
    expect((await filteredEventResponse).ok()).toBe(true);
    await expect(feed.locator(":scope > li")).toHaveCount(50);
    const filteredTypes = await feed.locator("article header span").allTextContents();
    expect(new Set(filteredTypes)).toEqual(new Set([OBSERVABILITY_SCALE_FILTER_EVENT_TYPE]));
    timings.eventFilterUiMs = elapsed(eventFilterStartedAt);

    await page.getByRole("button", { name: "Logs", exact: true }).click();
    const logFilterStartedAt = performance.now();
    await page.getByRole("textbox", { name: "Search", exact: true }).fill(OBSERVABILITY_SCALE_SEARCH_TERM);
    await page.getByLabel("Severity").selectOption("warn");
    const filteredLogResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/v2/observability/logs"
        && url.searchParams.get("query") === OBSERVABILITY_SCALE_SEARCH_TERM
        && url.searchParams.get("severity") === "warn";
    });
    await page.getByRole("button", { name: "Apply filters" }).click();
    expect((await filteredLogResponse).ok()).toBe(true);
    const logTable = page.getByRole("table");
    await expect(logTable.getByRole("row")).toHaveCount(2);
    await expect(logTable).toContainText(`Provider recovery sentinel ${OBSERVABILITY_SCALE_SEARCH_TERM} was acknowledged.`);
    await expect(logTable).toContainText("provider");
    timings.logFilterUiMs = elapsed(logFilterStartedAt);

    const longTasks = await page.evaluate(() => {
      const target = window as Window & { __chillspwnLongTasks?: number[] };
      return target.__chillspwnLongTasks ?? [];
    });
    const longTaskEvidence = {
      count: longTasks.length,
      maximumMs: longTasks.length ? Math.round(Math.max(...longTasks) * 100) / 100 : 0,
      totalMs: Math.round(longTasks.reduce((total, duration) => total + duration, 0) * 100) / 100,
      durationsMs: longTasks.map((duration) => Math.round(duration * 100) / 100),
    };

    const evidence = {
      fixture: "E2E-only isolated temporary database",
      canonicalCounts: {
        events: OBSERVABILITY_SCALE_EVENT_COUNT,
        logs: OBSERVABILITY_SCALE_LOG_COUNT,
        traceId: OBSERVABILITY_SCALE_TRACE_ID,
      },
      boundedApi: {
        eventPageSize: firstEvents.body.items.length,
        eventNextPageSize: nextEvents.body.items.length,
        eventPageDuplicateCount: intersectionSize(ids(firstEvents.body.items), ids(nextEvents.body.items)),
        tracePageSize: firstTrace.body.records.items.length,
        traceNextPageSize: nextTrace.body.records.items.length,
        tracePageDuplicateCount: intersectionSize(ids(firstTrace.body.records.items), ids(nextTrace.body.records.items)),
        eventPayloadBytes: firstEvents.bytes,
        tracePayloadBytes: firstTrace.bytes,
      },
      semanticRendering: {
        traceKinds: [...renderedKinds].sort(),
        exactEventFilter: OBSERVABILITY_SCALE_FILTER_EVENT_TYPE,
        exactLogSearch: OBSERVABILITY_SCALE_SEARCH_TERM,
      },
      boundedDom,
      longTasks: longTaskEvidence,
      timingsMs: timings,
      budgetsMs: BUDGETS_MS,
      browserErrors,
    };
    await attachJson(testInfo, "e2e-only-observability-100000-event-evidence.json", evidence);
    console.log(`[e2e-only:observability-scale] ${JSON.stringify(evidence)}`);

    for (const [name, budget] of Object.entries(BUDGETS_MS) as Array<[keyof TimingEvidence, number]>) {
      expect(timings[name], `${name} exceeded the E2E-only local budget`).toBeLessThanOrEqual(budget);
    }
    expect(longTaskEvidence.maximumMs).toBeLessThanOrEqual(500);
    expect(browserErrors).toEqual([]);
  });
});
