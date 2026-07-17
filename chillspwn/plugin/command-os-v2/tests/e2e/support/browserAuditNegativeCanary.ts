import type {
  APIRequestContext,
  APIResponse,
  Browser,
  BrowserContext,
  Download,
  TestInfo,
} from "@playwright/test";
import { BrowserAuditSession, installBrowserAuditRuntimeInstrumentation } from "./browserAudit";

async function isolatedAudit(
  browser: Browser,
  storageState?: Awaited<ReturnType<BrowserContext["storageState"]>>,
): Promise<{
  readonly context: BrowserContext;
  readonly session: BrowserAuditSession;
}> {
  const context = await browser.newContext(storageState === undefined ? undefined : { storageState });
  await installBrowserAuditRuntimeInstrumentation(context);
  const session = BrowserAuditSession.forContext(context, { allowEventStreamNavigationAbort: true });
  return { context, session };
}

export async function unsolicitedPopupCanary(browser: Browser, baseUrl: string): Promise<readonly string[]> {
  const { context, session } = await isolatedAudit(browser);
  const hostPath = "/audit-boundary/negative-popup-host";
  const popupPath = "/audit-boundary/negative-popup-target";
  await context.route(`**${hostPath}`, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><button id='open-popup'>Open</button><script>document.getElementById('open-popup').addEventListener('click',()=>window.open('/audit-boundary/negative-popup-target','_blank'))</script>",
  }));
  await context.route(`**${popupPath}`, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><title>Undeclared popup</title>",
  }));
  const page = await context.newPage();
  session.attach(page);
  try {
    await page.goto(new URL(hostPath, baseUrl).href, { waitUntil: "load" });
    const popup = page.waitForEvent("popup");
    await page.locator("#open-popup").click();
    const opened = await popup;
    await opened.waitForLoadState("load");
    await opened.close();
    return session.unexpected.map((issue) => issue.message);
  } finally {
    session.dispose();
    await context.close().catch(() => undefined);
  }
}

export async function undeclaredDownloadCanary(browser: Browser, baseUrl: string): Promise<readonly string[]> {
  const { context, session } = await isolatedAudit(browser);
  const hostPath = "/audit-boundary/negative-download-host";
  await context.route(`**${hostPath}`, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><button id='download'>Download</button><script>document.getElementById('download').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob(['undeclared download canary'],{type:'application/octet-stream'}));const link=document.createElement('a');link.href=url;link.download='undeclared-canary.bin';link.click();URL.revokeObjectURL(url)})</script>",
  }));
  const page = await context.newPage();
  session.attach(page);
  try {
    await page.goto(new URL(hostPath, baseUrl).href, { waitUntil: "load" });
    const download = page.waitForEvent("download");
    await page.locator("#download").click();
    await expectSuccessfulDownload(await download);
    return session.unexpected.map((issue) => issue.message);
  } finally {
    session.dispose();
    await context.close().catch(() => undefined);
  }
}

export async function sameUrlWrongPageDownloadCanary(
  browser: Browser,
  baseUrl: string,
  options: {
    readonly attachmentPath?: string;
    readonly storageState?: Awaited<ReturnType<BrowserContext["storageState"]>>;
    readonly requireSuccessfulDownload?: boolean;
  } = {},
): Promise<readonly string[]> {
  const { context, session } = await isolatedAudit(browser, options.storageState);
  const hostPath = "/audit-boundary/wrong-page-download-host";
  const attachmentPath = options.attachmentPath ?? "/api/v2/audit-boundary/wrong-page-download.bin";
  await context.route(`**${hostPath}`, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: `<!doctype html><a id="download" download href="${attachmentPath}">Download</a>`,
  }));
  const authorizedPage = await context.newPage();
  const wrongPage = await context.newPage();
  session.attach(authorizedPage);
  session.attach(wrongPage);
  try {
    await Promise.all([
      authorizedPage.goto(new URL(hostPath, baseUrl).href, { waitUntil: "load" }),
      wrongPage.goto(new URL(hostPath, baseUrl).href, { waitUntil: "load" }),
    ]);
    session.expectVerifiedDownload(authorizedPage, attachmentPath);
    const downloadEvent = wrongPage.waitForEvent("download");
    await wrongPage.locator("#download").click();
    const download = await downloadEvent;
    const expectedUrl = new URL(attachmentPath, baseUrl).href;
    if (download.url() !== expectedUrl) {
      throw new Error(`The wrong-page canary observed ${download.url()} instead of ${expectedUrl}`);
    }
    if (options.requireSuccessfulDownload) await expectSuccessfulDownload(download);
    else await download.failure();
    return session.unexpected.map((issue) => issue.message);
  } finally {
    session.dispose();
    await context.close().catch(() => undefined);
  }
}

export async function unwrappedEventSourceNavigationCanary(
  browser: Browser,
  baseUrl: string,
  storageState: Awaited<ReturnType<BrowserContext["storageState"]>>,
  testInfo: TestInfo,
): Promise<readonly string[]> {
  const { context, session } = await isolatedAudit(browser, storageState);
  const firstPath = "/audit-boundary/unwrapped-navigation-stream-host";
  const secondPath = "/audit-boundary/unwrapped-navigation-destination";
  const streamPath = "/api/v2/events/stream?runId=audit-canary-unwrapped-navigation&afterSequence=0";
  await context.route(`**${firstPath}`, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><title>Unwrapped navigation stream host</title>",
  }));
  await context.route(`**${secondPath}`, (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><title>Unwrapped navigation destination</title>",
  }));
  const page = await context.newPage();
  session.attach(page);
  try {
    await page.goto(new URL(firstPath, baseUrl).href, { waitUntil: "load" });
    const exactStreamUrl = new URL(streamPath, baseUrl).href;
    const streamRequestPromise = page.waitForRequest((request) => (
      request.method() === "GET" && request.url() === exactStreamUrl
    ));
    const streamResponsePromise = page.waitForResponse((response) => (
      response.request().method() === "GET" && response.url() === exactStreamUrl
    ));
    await page.evaluate((url) => {
      const runtime = window as unknown as Window & { __auditUnwrappedNavigationStream?: EventSource };
      runtime.__auditUnwrappedNavigationStream = new EventSource(url, { withCredentials: true });
    }, exactStreamUrl);
    const streamRequest = await streamRequestPromise;
    if ((await streamResponsePromise).status() !== 200) {
      throw new Error("The unwrapped-navigation canary did not establish its exact EventSource request");
    }
    const failedRequestPromise = page.waitForEvent("requestfailed", (request) => request === streamRequest);
    // This is deliberately not wrapped. The negative canary proves an exact
    // old-document EventSource abort remains a defect without a prospective
    // navigation boundary, even when URL, page, and request are otherwise known.
    await page.goto(new URL(secondPath, baseUrl).href, { waitUntil: "load" });
    if (await failedRequestPromise !== streamRequest) {
      throw new Error("The unwrapped-navigation canary did not observe the exact EventSource request failure");
    }
    try {
      await session.finalize(testInfo);
      throw new Error("An unwrapped document navigation incorrectly passed browser-audit finalization");
    } catch (error) {
      const messages = session.unexpected.map((issue) => issue.message);
      if (!messages.some((message) => message.includes(
        "tracked EventSource request had no correlated close, navigation, or page-close receipt",
      ))) throw error;
      return messages;
    }
  } finally {
    session.dispose();
    await context.close().catch(() => undefined);
  }
}

async function expectSuccessfulDownload(download: Download): Promise<void> {
  // The event itself is the browser's successful download initiation receipt;
  // the canary intentionally avoids saving or retaining the payload.
  if (await download.failure() !== null) {
    throw new Error("The undeclared-download canary did not produce the expected browser Download identity");
  }
}

export async function inFlightRequestSealCanary(
  browser: Browser,
  baseUrl: string,
  testInfo: TestInfo,
): Promise<{ readonly waited: boolean; readonly rejectedAfterSeal: boolean }> {
  const { context, session } = await isolatedAudit(browser);
  const page = await context.newPage();
  session.attach(page);
  let resolveFetch!: (response: APIResponse) => void;
  const response = new Promise<APIResponse>((resolve) => { resolveFetch = resolve; });
  const api = {
    fetch: () => response,
  } as unknown as APIRequestContext;
  const exactUrl = new URL("/api/v2/audit-boundary/in-flight", baseUrl).href;
  const pending = session.request(api, { method: "GET", url: exactUrl });
  let finalized = false;
  const finalization = session.finalize(testInfo).then(() => { finalized = true; });
  await Promise.resolve();
  const waited = !finalized;
  let rejectedAfterSeal = false;
  try {
    session.request(api, { method: "GET", url: exactUrl });
  } catch (error) {
    rejectedAfterSeal = error instanceof Error && error.message.includes("after browser-audit sealing");
  }
  resolveFetch({
    url: () => exactUrl,
    status: () => 200,
    statusText: () => "OK",
  } as APIResponse);
  await pending;
  await finalization;
  session.dispose();
  await context.close();
  return { waited, rejectedAfterSeal };
}

export async function hungRequestFinalizationCanary(
  browser: Browser,
  baseUrl: string,
  testInfo: TestInfo,
): Promise<readonly string[]> {
  const { context, session } = await isolatedAudit(browser);
  const page = await context.newPage();
  session.attach(page);
  const api = {
    fetch: () => new Promise<APIResponse>(() => undefined),
  } as unknown as APIRequestContext;
  const exactUrl = new URL("/api/v2/audit-boundary/hung", baseUrl).href;
  void session.request(api, { method: "GET", url: exactUrl });
  try {
    await session.finalize(testInfo);
    throw new Error("A hung audited API request incorrectly passed finalization");
  } catch (error) {
    if (!(error instanceof Error) || !session.unexpected.some((issue) => issue.message.includes("finalization drain"))) {
      throw error;
    }
    return session.unexpected.map((issue) => issue.message);
  } finally {
    session.dispose();
    await context.close().catch(() => undefined);
  }
}
