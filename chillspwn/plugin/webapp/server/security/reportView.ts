export const REPORT_VIEW_CSP = "sandbox; default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'";

export function assertPassiveReportMarkup(markup: string): void {
  if (/<script\b/i.test(markup) || /\son[a-z]+\s*=/i.test(markup) || /javascript\s*:/i.test(markup)) {
    throw new Error("report navigation overlay must not contain active content");
  }
}

const REPORT_IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

export function reportAssetHeaders(filename: string, size: number): Record<string, string> {
  const dot = filename.lastIndexOf(".");
  const extension = dot >= 0 ? filename.slice(dot).toLowerCase() : "";
  const contentType = REPORT_IMAGE_TYPES[extension];
  if (!contentType) throw new Error("report asset type is not allowed");
  if (!Number.isSafeInteger(size) || size < 0 || size > 5 * 1024 * 1024) {
    throw new Error("report asset size is not allowed");
  }
  return {
    "Content-Type": contentType,
    "Content-Length": String(size),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": extension === ".svg"
      ? "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
      : "default-src 'none'; sandbox",
  };
}
