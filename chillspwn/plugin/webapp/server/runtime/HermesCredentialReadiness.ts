import { lstatSync, readFileSync } from "node:fs";

const MAX_AUTH_METADATA_BYTES = 2 * 1024 * 1024;

function hasCredentialEntry(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && typeof value === "object" && Object.keys(value as Record<string, unknown>).length > 0);
}

/**
 * Read provider identities only from Hermes' canonical credential pool. Secret
 * values are never returned, logged, hashed, or copied by this readiness path.
 */
export function readHermesCredentialProviderNames(authPath: string): ReadonlySet<string> {
  try {
    const state = lstatSync(authPath);
    if (!state.isFile() || state.isSymbolicLink() || state.size <= 0 || state.size > MAX_AUTH_METADATA_BYTES) {
      return new Set();
    }
    if ((state.mode & 0o022) !== 0) return new Set();
    const parsed = JSON.parse(readFileSync(authPath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Set();
    const pool = (parsed as Record<string, unknown>).credential_pool;
    if (!pool || typeof pool !== "object" || Array.isArray(pool)) return new Set();
    return new Set(Object.entries(pool as Record<string, unknown>)
      .filter(([, value]) => hasCredentialEntry(value))
      .map(([name]) => name.trim().toLowerCase())
      .filter(Boolean));
  } catch {
    return new Set();
  }
}

export function hasHermesCredentialProvider(
  providers: ReadonlySet<string>,
  ...aliases: readonly string[]
): boolean {
  return aliases.some((alias) => providers.has(alias.trim().toLowerCase()));
}
