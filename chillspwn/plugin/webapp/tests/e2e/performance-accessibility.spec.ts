import { expect, test, type Page, type TestInfo } from "@playwright/test";

interface BrowserVitals {
  readonly firstContentfulPaintMs: number | null;
  readonly largestContentfulPaintMs: number | null;
  readonly cumulativeLayoutShift: number;
  readonly navigationDomContentLoadedMs: number | null;
  readonly longTasksOver50Ms: number;
  readonly longestTaskMs: number;
}

const browserBudgetsEnforced = process.env.COMMAND_OS_ENFORCE_BROWSER_BUDGETS === "true";

async function gotoShell(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded", timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1, name: "Command Center" })).toBeVisible();
}

async function navigateWithinShell(page: Page, path: string, heading: string): Promise<void> {
  await page.evaluate((nextPath) => {
    history.pushState({}, "", nextPath);
    dispatchEvent(new PopStateEvent("popstate"));
  }, path);
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  await testInfo.attach(name, {
    body: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
    contentType: "application/json",
  });
}

async function installVitalsObservers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type VitalsState = {
      cumulativeLayoutShift: number;
      largestContentfulPaintMs: number | null;
      longTasks: number[];
    };
    const target = window as Window & { __commandOsVitals?: VitalsState };
    target.__commandOsVitals = {
      cumulativeLayoutShift: 0,
      largestContentfulPaintMs: null,
      longTasks: [],
    };
    if (!("PerformanceObserver" in window)) return;
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
          if (!shift.hadRecentInput) target.__commandOsVitals!.cumulativeLayoutShift += shift.value ?? 0;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch { /* Browser does not expose Layout Instability entries. */ }
    try {
      new PerformanceObserver((list) => {
        const latest = list.getEntries().at(-1);
        if (latest) target.__commandOsVitals!.largestContentfulPaintMs = latest.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch { /* Browser does not expose LCP entries. */ }
    try {
      new PerformanceObserver((list) => {
        target.__commandOsVitals!.longTasks.push(...list.getEntries().map((entry) => entry.duration));
      }).observe({ type: "longtask", buffered: true });
    } catch { /* Browser does not expose Long Task entries. */ }
  });
}

async function readVitals(page: Page): Promise<BrowserVitals> {
  return page.evaluate(() => {
    type VitalsState = {
      cumulativeLayoutShift: number;
      largestContentfulPaintMs: number | null;
      longTasks: number[];
    };
    const state = (window as Window & { __commandOsVitals?: VitalsState }).__commandOsVitals ?? {
      cumulativeLayoutShift: 0,
      largestContentfulPaintMs: null,
      longTasks: [],
    };
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return {
      firstContentfulPaintMs: paint ? Number(paint.startTime.toFixed(3)) : null,
      largestContentfulPaintMs: state.largestContentfulPaintMs === null
        ? null
        : Number(state.largestContentfulPaintMs.toFixed(3)),
      cumulativeLayoutShift: Number(state.cumulativeLayoutShift.toFixed(6)),
      navigationDomContentLoadedMs: navigation
        ? Number(navigation.domContentLoadedEventEnd.toFixed(3))
        : null,
      longTasksOver50Ms: state.longTasks.filter((duration) => duration > 50).length,
      longestTaskMs: Number(Math.max(0, ...state.longTasks).toFixed(3)),
    };
  });
}

async function basicAccessibilityAudit(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const violations: string[] = [];
    const visible = (element: Element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const accessibleName = (element: HTMLElement): string => {
      const labelledBy = element.getAttribute("aria-labelledby")
        ?.split(/\s+/u)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
        .trim();
      const explicitLabel = element.id
        ? document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(element.id)}"]`)?.textContent?.trim()
        : undefined;
      const wrappedLabel = element.closest("label")?.textContent?.trim();
      return (
        element.getAttribute("aria-label") ||
        labelledBy ||
        explicitLabel ||
        wrappedLabel ||
        element.getAttribute("alt") ||
        element.getAttribute("title") ||
        element.innerText ||
        ""
      ).trim();
    };

    if (document.documentElement.lang.trim() === "") violations.push("Document language is missing");
    if (document.querySelectorAll("main").length !== 1) violations.push("Page must expose exactly one main landmark");
    if (document.querySelectorAll("h1").length !== 1) violations.push("Page must expose exactly one h1");
    if (!document.querySelector("header")) violations.push("Page header landmark is missing");
    if (!document.querySelector("nav")) violations.push("Navigation landmark is missing");

    const ids = new Map<string, number>();
    document.querySelectorAll<HTMLElement>("[id]").forEach((element) => {
      ids.set(element.id, (ids.get(element.id) ?? 0) + 1);
    });
    for (const [id, count] of ids) if (count > 1) violations.push(`Duplicate id: ${id}`);

    document.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [role='button'], [role='option']")
      .forEach((element) => {
        if (visible(element) && !accessibleName(element)) {
          violations.push(`Visible interactive element has no accessible name: ${element.tagName.toLowerCase()}`);
        }
      });
    document.querySelectorAll<HTMLImageElement>("img").forEach((image) => {
      if (!image.hasAttribute("alt")) violations.push(`Image is missing alt text: ${image.getAttribute("src") ?? "unknown"}`);
    });

    let previousHeading = 0;
    document.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6").forEach((heading) => {
      if (!visible(heading)) return;
      const level = Number(heading.tagName.slice(1));
      if (previousHeading > 0 && level > previousHeading + 1) {
        violations.push(`Heading level jumps from h${previousHeading} to h${level}`);
      }
      previousHeading = level;
    });
    return violations;
  });
}

test.describe("Command OS performance and accessibility evidence", () => {
  test("local production shell records paint, layout stability, and long tasks", async ({ page }, testInfo) => {
    await installVitalsObservers(page);
    const samples: BrowserVitals[] = [];
    for (let index = 0; index < 5; index += 1) {
      await gotoShell(page);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      samples.push(await readVitals(page));
    }
    const percentile75 = (values: number[]) => [...values].sort((left, right) => left - right)[Math.ceil(values.length * 0.75) - 1]!;
    const fcp = samples.flatMap((sample) => sample.firstContentfulPaintMs === null ? [] : [sample.firstContentfulPaintMs]);
    const lcp = samples.flatMap((sample) => sample.largestContentfulPaintMs === null ? [] : [sample.largestContentfulPaintMs]);
    const summary = {
      samples,
      p75: {
        firstContentfulPaintMs: fcp.length === samples.length ? percentile75(fcp) : null,
        largestContentfulPaintMs: lcp.length === samples.length ? percentile75(lcp) : null,
        cumulativeLayoutShift: percentile75(samples.map((sample) => sample.cumulativeLayoutShift)),
        navigationDomContentLoadedMs: percentile75(samples.flatMap((sample) => sample.navigationDomContentLoadedMs === null ? [] : [sample.navigationDomContentLoadedMs])),
      },
      totalLongTasksOver50Ms: samples.reduce((total, sample) => total + sample.longTasksOver50Ms, 0),
      longestTaskMs: Math.max(...samples.map((sample) => sample.longestTaskMs)),
      targetAssessment: {
        firstContentfulPaint: fcp.length === samples.length && percentile75(fcp) <= 1_000,
        largestContentfulPaint: lcp.length === samples.length && percentile75(lcp) <= 1_800,
        cumulativeLayoutShift: percentile75(samples.map((sample) => sample.cumulativeLayoutShift)) <= 0.05,
      },
      budgetsEnforced: browserBudgetsEnforced,
    };
    await attachJson(testInfo, "local-browser-vitals.json", summary);
    console.log(`[command-os-vitals] ${JSON.stringify(summary)}`);

    expect(summary.p75.firstContentfulPaintMs, "Chromium should expose FCP for every sample").not.toBeNull();
    expect(summary.p75.largestContentfulPaintMs, "Chromium should expose LCP for every sample").not.toBeNull();
    expect(summary.p75.navigationDomContentLoadedMs).toBeGreaterThan(0);
    expect(summary.p75.firstContentfulPaintMs!).toBeLessThanOrEqual(10_000);
    expect(summary.p75.largestContentfulPaintMs!).toBeLessThanOrEqual(30_000);
    expect(summary.p75.cumulativeLayoutShift).toBeLessThanOrEqual(0.1);
    if (browserBudgetsEnforced) {
      expect(summary.p75.firstContentfulPaintMs!).toBeLessThanOrEqual(1_000);
      expect(summary.p75.largestContentfulPaintMs!).toBeLessThanOrEqual(1_800);
      expect(summary.p75.cumulativeLayoutShift).toBeLessThanOrEqual(0.05);
    }
  });

  test("primary pages pass a dependency-free structural accessibility audit", async ({ page }, testInfo) => {
    const result: Record<string, string[]> = {};
    await gotoShell(page);
    const pages: Array<[string, string]> = [
      ["/", "Command Center"],
      ["/brain", "Second Brain"],
      ["/brain/graph", "Memory Graph"],
      ["/missions/new/guided", "Start with the authorized objective"],
      ["/manual", "ChillsPwn User Manual"],
    ];
    for (const [path, heading] of pages) {
      await test.step(path, async () => {
        if (path !== "/") await navigateWithinShell(page, path, heading);
        result[path] = await basicAccessibilityAudit(page);
      });
    }
    await attachJson(testInfo, "basic-accessibility-audit.json", result);
    expect(result).toEqual({
      "/": [],
      "/brain": [],
      "/brain/graph": [],
      "/missions/new/guided": [],
      "/manual": [],
    });
  });

  test("keyboard navigation exposes skip-link focus and restores palette focus", async ({ page }) => {
    await gotoShell(page);
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#command-os-content")).toBeFocused();

    const paletteTrigger = page.getByRole("button", { name: /Search or run a command/u });
    await paletteTrigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await expect(page.getByRole("combobox", { name: /Search commands, missions/u })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeHidden();
    await expect(paletteTrigger).toBeFocused();

    const focusStyle = await paletteTrigger.evaluate((element) => {
      const style = getComputedStyle(element);
      return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) };
    });
    expect(focusStyle.outlineStyle).not.toBe("none");
    expect(focusStyle.outlineWidth).toBeGreaterThanOrEqual(2);
  });

  test("long pages retain document scrolling with sticky operational chrome", async ({ page }, testInfo) => {
    const measurements: Record<string, unknown> = {};
    const viewports = [
      { name: "desktop", width: 1_440, height: 700 },
      { name: "mobile", width: 390, height: 667 },
    ] as const;

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await gotoShell(page);

      const before = await page.evaluate(() => ({
        viewportHeight: innerHeight,
        documentHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
        bodyOverflowX: getComputedStyle(document.body).overflowX,
        bodyOverflowY: getComputedStyle(document.body).overflowY,
      }));
      expect(before.documentHeight).toBeGreaterThan(before.viewportHeight);
      expect(before.bodyOverflowX).toBe("hidden");
      expect(before.bodyOverflowY).toBe("auto");

      await page.getByRole("heading", { level: 1, name: "Command Center" }).hover();
      await page.mouse.wheel(0, viewport.height);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

      const wheel = await page.evaluate(() => ({
        scrollY: window.scrollY,
        topbarTop: document.querySelector<HTMLElement>(".os-topbar")!.getBoundingClientRect().top,
        sidebarTop: document.querySelector<HTMLElement>(".os-sidebar")!.getBoundingClientRect().top,
      }));
      expect(Math.abs(wheel.topbarTop)).toBeLessThanOrEqual(1);
      if (viewport.name === "desktop") expect(Math.abs(wheel.sidebarTop - 64)).toBeLessThanOrEqual(1);

      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.locator("#command-os-content").focus();
      await page.keyboard.press("End");
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

      measurements[viewport.name] = {
        viewport: { width: viewport.width, height: viewport.height },
        before,
        wheel,
        keyboardScrollY: await page.evaluate(() => window.scrollY),
      };
    }

    await attachJson(testInfo, "document-scroll-regression.json", measurements);
  });

  test("reduced-motion preference collapses running animation and transition durations", async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoShell(page);
    const motion = await page.evaluate(() => {
      const durationMs = (value: string): number => Math.max(...value.split(",").map((part) => {
        const normalized = part.trim();
        const numeric = Number.parseFloat(normalized) || 0;
        return normalized.endsWith("ms") ? numeric : numeric * 1_000;
      }));
      let maximumAnimationMs = 0;
      let maximumTransitionMs = 0;
      let infiniteAnimations = 0;
      document.querySelectorAll<HTMLElement>("*").forEach((element) => {
        const style = getComputedStyle(element);
        maximumAnimationMs = Math.max(maximumAnimationMs, durationMs(style.animationDuration));
        maximumTransitionMs = Math.max(maximumTransitionMs, durationMs(style.transitionDuration));
        if (style.animationIterationCount.split(",").includes("infinite")) infiniteAnimations += 1;
      });
      return {
        mediaMatches: matchMedia("(prefers-reduced-motion: reduce)").matches,
        maximumAnimationMs,
        maximumTransitionMs,
        infiniteAnimations,
      };
    });
    await attachJson(testInfo, "reduced-motion.json", motion);
    expect(motion.mediaMatches).toBe(true);
    expect(motion.maximumAnimationMs).toBeLessThanOrEqual(1);
    expect(motion.maximumTransitionMs).toBeLessThanOrEqual(1);
    expect(motion.infiniteAnimations).toBe(0);
  });

  test("mobile primary routes reflow without document overflow and keep touch targets reachable", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const measurements: Record<string, unknown> = {};
    await gotoShell(page);
    const pages: Array<[string, string]> = [
      ["/", "Command Center"],
      ["/missions/new/guided", "Start with the authorized objective"],
      ["/brain", "Second Brain"],
      ["/brain/graph", "Memory Graph"],
      ["/observability", "Observability"],
    ];
    for (const [path, headingName] of pages) {
      if (path !== "/") await navigateWithinShell(page, path, headingName);
      measurements[path] = await page.evaluate(() => {
        const heading = document.querySelector("h1")!.getBoundingClientRect();
        const undersizedTargets = [...document.querySelectorAll<HTMLElement>(
          ".command-os .os-button, .command-os .os-icon-button, .command-os .os-nav-item, .command-os .os-command-trigger, .command-os .os-brand",
        )].filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0 &&
            (rect.width < 43.5 || rect.height < 43.5);
        }).map((element) => ({
          label: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 60) || element.tagName,
          width: Number(element.getBoundingClientRect().width.toFixed(1)),
          height: Number(element.getBoundingClientRect().height.toFixed(1)),
        }));
        return {
          viewportWidth: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          headingTop: Number(heading.top.toFixed(1)),
          headingBottom: Number(heading.bottom.toFixed(1)),
          undersizedTargets,
        };
      });
      const current = measurements[path] as { viewportWidth: number; documentWidth: number; headingTop: number; headingBottom: number; undersizedTargets: unknown[] };
      expect(current.documentWidth).toBeLessThanOrEqual(current.viewportWidth + 1);
      expect(current.headingTop).toBeGreaterThanOrEqual(0);
      expect(current.headingBottom).toBeLessThan(844);
      expect(current.undersizedTargets).toEqual([]);
    }
    await attachJson(testInfo, "mobile-reflow.json", measurements);
  });
});
