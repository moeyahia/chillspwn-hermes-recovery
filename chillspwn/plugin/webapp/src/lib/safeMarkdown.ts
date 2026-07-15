function decodeEscapedText(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Return an escaped, normalized HTTP(S) URL or null for unsafe schemes/input. */
export function safeExternalMarkdownHref(preEscapedHref: string): string | null {
  const decoded = decodeEscapedText(preEscapedHref);
  if (!decoded || decoded.trim() !== decoded || /[\u0000-\u001f\u007f]/.test(decoded)) return null;
  try {
    const parsed = new URL(decoded);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password) return null;
    return escapeAttribute(parsed.href);
  } catch {
    return null;
  }
}

/** Render only externally navigable HTTP(S) links; unsafe targets remain plain text. */
export function renderSafeMarkdownLink(labelHtml: string, preEscapedHref: string): string {
  const href = safeExternalMarkdownHref(preEscapedHref);
  if (!href) return labelHtml;
  return `<a href="${href}" style="color:var(--jarvis-blue);text-decoration:underline" target="_blank" rel="noopener noreferrer">${labelHtml}</a>`;
}
