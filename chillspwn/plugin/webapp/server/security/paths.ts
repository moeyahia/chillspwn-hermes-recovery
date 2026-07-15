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

import { existsSync, lstatSync, realpathSync } from "fs";
import { basename, dirname, resolve, sep, isAbsolute } from "path";

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

function existingRealRoots(roots: string[]): string[] {
  return roots
    .filter((root) => existsSync(root))
    .map((root) => realpathSync(root));
}

/**
 * Resolve an existing filesystem object, follow its ancestors, and verify the
 * real path remains under a real allowed root. This closes lexical containment
 * bypasses where an in-root symlink points to a secret outside the root.
 */
export function resolveExistingWithinRoots(
  roots: string[],
  userPath: string,
  label = "path",
  options: { rejectFinalSymlink?: boolean } = {},
): string {
  const lexical = resolveWithinRoots(roots, userPath, label);
  if (!existsSync(lexical)) throw new PathSecurityError(`${label} does not exist`);
  if (options.rejectFinalSymlink && lstatSync(lexical).isSymbolicLink()) {
    throw new PathSecurityError(`${label} must not be a symbolic link`);
  }
  const real = realpathSync(lexical);
  if (!existingRealRoots(roots).some((root) => isWithinRoot(root, real))) {
    throw new PathSecurityError(`${label} resolves outside all allowed roots`);
  }
  return real;
}

/**
 * Resolve a write target without following a final symlink. The existing real
 * parent must be inside an allowed real root; existing targets must be regular
 * non-symlink files. Callers should write a new O_NOFOLLOW temporary file in
 * this returned parent and atomically rename it over the target.
 */
export function resolveWriteTargetWithinRoots(roots: string[], userPath: string, label = "path"): string {
  const lexical = resolveWithinRoots(roots, userPath, label);
  const lexicalParent = dirname(lexical);
  if (!existsSync(lexicalParent)) throw new PathSecurityError(`${label} parent does not exist`);
  const realParent = realpathSync(lexicalParent);
  if (!existingRealRoots(roots).some((root) => isWithinRoot(root, realParent))) {
    throw new PathSecurityError(`${label} parent resolves outside all allowed roots`);
  }
  if (existsSync(lexical)) {
    const stat = lstatSync(lexical);
    if (stat.isSymbolicLink()) throw new PathSecurityError(`${label} must not be a symbolic link`);
    if (!stat.isFile()) throw new PathSecurityError(`${label} is not a regular file`);
    const real = realpathSync(lexical);
    if (!isWithinRoot(realParent, real)) throw new PathSecurityError(`${label} resolves outside its parent`);
  }
  return resolve(realParent, basename(lexical));
}
