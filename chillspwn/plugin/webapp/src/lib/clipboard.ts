// Clipboard utility that works on HTTP (mobile via Tailscale) and HTTPS.
// Falls back to document.execCommand('copy') when navigator.clipboard.writeText
// is unavailable (insecure context — anything that isn't HTTPS or localhost).
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard?.writeText &&
      (window.isSecureContext ?? false)
    ) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  // Legacy fallback — hidden textarea + execCommand
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
