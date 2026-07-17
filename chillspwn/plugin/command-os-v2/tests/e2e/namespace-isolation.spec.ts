import { createHash } from "node:crypto";
import { expect, test } from "./support/playwright";

const TEST_ID = "e2e.namespace.isolation";
const PREFIX = "chillspwn.command-os-v2.";
const LEGACY_LOCAL_KEY = "chillspwn.missions.saved-views.v1";
const LEGACY_SESSION_KEY = "chillspwn.brain.graph-root";

test.describe(`${TEST_ID} browser and asset boundary`, () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(({ localKey, sessionKey, prefix }) => {
      localStorage.setItem(localKey, "legacy-local-sentinel");
      sessionStorage.setItem(sessionKey, "legacy-session-sentinel");
      localStorage.setItem(`${prefix}test-sentinel`, "v2-sentinel");
    }, { localKey: LEGACY_LOCAL_KEY, sessionKey: LEGACY_SESSION_KEY, prefix: PREFIX });
  });

  test("does not read, migrate, overwrite, or delete legacy browser keys", async ({ page }) => {
    await page.goto("/brain/graph");
    await expect(page.locator("main#command-os-content")).toBeVisible();
    const storage = await page.evaluate(({ localKey, sessionKey }) => ({
      localLegacy: localStorage.getItem(localKey),
      sessionLegacy: sessionStorage.getItem(sessionKey),
      localKeys: Object.keys(localStorage),
      sessionKeys: Object.keys(sessionStorage),
    }), { localKey: LEGACY_LOCAL_KEY, sessionKey: LEGACY_SESSION_KEY });
    expect(storage.localLegacy).toBe("legacy-local-sentinel");
    expect(storage.sessionLegacy).toBe("legacy-session-sentinel");
    expect(storage.localKeys.filter((key) => key !== LEGACY_LOCAL_KEY).every((key) => key.startsWith(PREFIX))).toBe(true);
    expect(storage.sessionKeys.filter((key) => key !== LEGACY_SESSION_KEY).every((key) => key.startsWith(PREFIX))).toBe(true);
  });

  test("keeps cache, service-worker, resource, and logo identities isolated", async ({ page, browserAudit }) => {
    await page.goto("/manual");
    const cacheNames = await page.evaluate(() => caches.keys());
    expect(cacheNames.every((name) => name.startsWith(PREFIX))).toBe(true);
    const registrations = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((registration) => registration.scope));
    expect(registrations.every((scope) => !scope.includes("/webapp/"))).toBe(true);
    const resources = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.name));
    expect(resources.some((url) => url.includes("/webapp/"))).toBe(false);

    const serviceWorker = await browserAudit.request(page.request, { method: "GET", url: "/sw-v2.js" });
    expect(serviceWorker.status()).toBe(200);
    const serviceWorkerText = await serviceWorker.text();
    expect(serviceWorkerText).toContain("chillspwn.command-os-v2.");
    expect(serviceWorkerText).not.toContain("chillspwn-command-os-v2-");

    const logo = await browserAudit.request(page.request, { method: "GET", url: "/Logo.svg" });
    expect(logo.status()).toBe(200);
    const hash = createHash("sha256").update(await logo.body()).digest("hex");
    expect(hash).toBe("0a3dfd69f74a00d41bb0cb20d6af1097dffa265d4c1e54c9228fe4b55f85c955");
  });
});
