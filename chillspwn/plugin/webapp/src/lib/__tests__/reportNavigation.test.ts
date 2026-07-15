import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { engagementReportViewUrl } from "../reportNavigation";

describe("engagement report navigation", () => {
  test("uses the server-sandboxed report endpoint", () => {
    expect(engagementReportViewUrl("client alpha/../x")).toBe("/api/reports/client%20alpha%2F..%2Fx/view");
  });

  test("the report UI never opens target HTML through an origin-inheriting Blob", () => {
    const source = readFileSync(new URL("../../pages/EngagementsPage.tsx", import.meta.url), "utf8");
    expect(source).toContain("engagementReportViewUrl(selected.name)");
    expect(source).not.toContain("new Blob([reportHtml]");
    expect(source).not.toContain('type: "text/html"');
  });
});
