/**
 * Path-traversal guards (Phase 1).
 *
 * Pure, dependency-light helpers used to sanitize untrusted path input from HTTP
 * routes (`:name` params, `?path=` queries). Two guarantees:
 *   - `safeSegment` rejects any single path segment that could escape (`..`, `/`,
 *     backslashes, null bytes, absolute markers).
 *   - `resolveWithin` resolves a child path and asserts it stays inside an allowed
 *     root after normalization (defeats `../` and symlink-name tricks at the string
 *     level; callers that need symlink-real-path safety can pass realpath'd roots).
 */

import { resolve, sep, isAbsolute } from "path";

/** Thrown on a rejected/escaping path. Routes map this to HTTP 400. */
export class PathSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathSecurityError";
  }
}

/**
 * Validate a single untrusted path segment (e.g. an `:name` route param). Returns
 * the segment unchanged if safe; throws PathSecurityError otherwise.
 */
export function safeSegment(segment: string, label = "segment"): string {
  if (typeof segment !== "string" || segment.length === 0) {
    throw new PathSecurityError(`${label} is empty`);
  }
  if (segment.includes("\0")) {
    throw new PathSecurityError(`${label} contains a null byte`);
  }
  if (segment === "." || segment === "..") {
    throw new PathSecurityError(`${label} is a relative path component`);
  }
  if (segment.includes("/") || segment.includes("\\")) {
    throw new PathSecurityError(`${label} contains a path separator`);
  }
  if (isAbsolute(segment)) {
    throw new PathSecurityError(`${label} is absolute`);
  }
  // Defense in depth: reject any embedded traversal token.
  if (segment.includes("..")) {
    throw new PathSecurityError(`${label} contains '..'`);
  }
  return segment;
}

/** True if `child` resolves to a location inside `root` (or equal to it). */
export function isWithinRoot(root: string, child: string): boolean {
  const r = resolve(root);
  const c = resolve(child);
  return c === r || c.startsWith(r + sep);
}

/**
 * Resolve `userPath` relative to `root` and assert it stays within `root`.
 * `userPath` may be absolute or relative; either way the result must be inside
 * `root`. Returns the resolved absolute path or throws PathSecurityError.
 */
export function resolveWithin(root: string, userPath: string, label = "path"): string {
  if (typeof userPath !== "string" || userPath.length === 0) {
    throw new PathSecurityError(`${label} is empty`);
  }
  if (userPath.includes("\0")) {
    throw new PathSecurityError(`${label} contains a null byte`);
  }
  const resolved = isAbsolute(userPath) ? resolve(userPath) : resolve(root, userPath);
  if (!isWithinRoot(root, resolved)) {
    throw new PathSecurityError(`${label} escapes the allowed root`);
  }
  return resolved;
}

/**
 * Resolve `userPath` and assert it lives under at least one of `roots`. Returns the
 * resolved path or throws. Use for endpoints scoped to several workspace roots.
 */
export function resolveWithinRoots(roots: string[], userPath: string, label = "path"): string {
  if (typeof userPath !== "string" || userPath.length === 0) {
    throw new PathSecurityError(`${label} is empty`);
  }
  if (userPath.includes("\0")) {
    throw new PathSecurityError(`${label} contains a null byte`);
  }
  const resolved = isAbsolute(userPath) ? resolve(userPath) : resolve(roots[0] || "/", userPath);
  for (const root of roots) {
    if (isWithinRoot(root, resolved)) return resolved;
  }
  throw new PathSecurityError(`${label} is outside all allowed roots`);
}
