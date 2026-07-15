import { expect, test } from "bun:test";
import { assertPassiveReportMarkup, reportAssetHeaders, REPORT_VIEW_CSP } from "../reportView";

test("report view is sandboxed without script capability", () => {
  expect(REPORT_VIEW_CSP).toContain("sandbox");
  expect(REPORT_VIEW_CSP).toContain("default-src 'none'");
  expect(REPORT_VIEW_CSP).not.toContain("allow-scripts");
  expect(REPORT_VIEW_CSP).not.toContain("allow-same-origin");
});

test("navigation overlay rejects active markup", () => {
  expect(() => assertPassiveReportMarkup('<a href="/#reports">Back</a>')).not.toThrow();
  expect(() => assertPassiveReportMarkup("<script>alert(1)</script>")).toThrow();
  expect(() => assertPassiveReportMarkup('<img src=x onerror="alert(1)">')).toThrow();
  expect(() => assertPassiveReportMarkup('<a href="javascript:alert(1)">x</a>')).toThrow();
});

test("report assets allow images only and sandbox SVG", () => {
  expect(reportAssetHeaders("Logo.PNG", 1024)["Content-Type"]).toBe("image/png");
  const svg = reportAssetHeaders("Logo.svg", 2048);
  expect(svg["Content-Type"]).toBe("image/svg+xml");
  expect(svg["Content-Security-Policy"]).toContain("sandbox");
  expect(svg["Content-Security-Policy"]).toContain("default-src 'none'");
  expect(svg["X-Content-Type-Options"]).toBe("nosniff");
  for (const filename of ["payload.html", "payload.js", "style.css", "no-extension"]) {
    expect(() => reportAssetHeaders(filename, 10)).toThrow("not allowed");
  }
  expect(() => reportAssetHeaders("huge.png", 6 * 1024 * 1024)).toThrow("size");
});
