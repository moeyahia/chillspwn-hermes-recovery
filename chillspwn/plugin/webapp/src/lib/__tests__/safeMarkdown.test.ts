import { describe, expect, test } from "bun:test";
import { renderSafeMarkdownLink, safeExternalMarkdownHref } from "../safeMarkdown";

describe("safe Markdown links", () => {
  test("allows normalized HTTP and HTTPS URLs", () => {
    expect(safeExternalMarkdownHref("https://example.test/a?x=1&amp;y=2")).toContain("https://example.test/a");
    expect(safeExternalMarkdownHref("http://example.test")).toBe("http://example.test/");
  });

  test("rejects active, local, credentialed, and malformed URLs", () => {
    for (const value of [
      "javascript:alert(1)",
      "data:text/html,pwned",
      "file:///etc/passwd",
      "/api/settings",
      "https://user:pass@example.test/",
      " https://example.test/",
      "https://example.test/\nX-Test: yes",
    ]) expect(safeExternalMarkdownHref(value)).toBeNull();
  });

  test("unsafe links render as text and safe links isolate the new tab", () => {
    expect(renderSafeMarkdownLink("click", "javascript:alert(1)")).toBe("click");
    const safe = renderSafeMarkdownLink("docs", "https://example.test/docs");
    expect(safe).toContain('target="_blank"');
    expect(safe).toContain('rel="noopener noreferrer"');
  });
});
