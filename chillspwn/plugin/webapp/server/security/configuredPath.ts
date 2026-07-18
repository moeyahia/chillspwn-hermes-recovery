import { isAbsolute, parse, resolve } from "path";

/**
 * Resolve a filesystem location supplied by trusted deployment configuration.
 *
 * These paths are not HTTP input, but they can grant a provider access to local
 * files or select executable helper scripts. Keep the boundary explicit and
 * fail closed on relative, empty, NUL-containing, or filesystem-root values.
 * Existence and ownership are deployment/readiness concerns so local source
 * checkouts can still use an operator-selected template directory.
 */
export function configuredAbsoluteDirectory(
  name: string,
  value: string | undefined,
  fallback: string,
): string {
  const configured = (value ?? fallback).trim();
  if (!configured) throw new Error(`${name} must not be empty`);
  if (configured.includes("\0")) throw new Error(`${name} must not contain a NUL byte`);
  if (!isAbsolute(configured)) throw new Error(`${name} must be an absolute path`);

  const normalized = resolve(configured);
  if (normalized === parse(normalized).root) {
    throw new Error(`${name} must not be the filesystem root`);
  }
  return normalized;
}
