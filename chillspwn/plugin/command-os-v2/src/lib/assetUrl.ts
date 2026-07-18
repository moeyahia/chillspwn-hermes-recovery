/** Resolve V2-owned static media against this application's independent Vite base. */
export function assetUrl(path: string): string {
  const configuredBase = import.meta.env.BASE_URL ?? "/";
  const base = configuredBase.endsWith("/")
    ? configuredBase
    : `${configuredBase}/`;
  return `${base}${path.replace(/^\/+/, "")}`;
}
