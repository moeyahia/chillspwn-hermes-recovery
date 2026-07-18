import { existsSync, lstatSync, readdirSync } from "fs";
import { join } from "path";
import { safeEngagementName } from "../security/identifiers";
import { resolveExistingWithinRoots } from "../security/paths";

/** Resolve a user/DB engagement name to a real, non-symlink engagement directory. */
export function resolveEngagementWorkingDirectory(rawName: unknown, roots: string[]): string {
  const name = safeEngagementName(rawName);

  const resolveCandidate = (root: string, candidate: string): string | null => {
    if (!existsSync(candidate)) return null;
    const state = lstatSync(candidate);
    if (state.isSymbolicLink() || !state.isDirectory()) return null;
    const resolved = resolveExistingWithinRoots(
      [root],
      candidate,
      "engagement working directory",
      { rejectFinalSymlink: true },
    );
    return lstatSync(resolved).isDirectory() ? resolved : null;
  };

  // Preserve the existing deterministic root precedence for exact names.
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const resolved = resolveCandidate(root, join(root, name));
    if (resolved) return resolved;
  }

  // Engagement names are human-facing and frequently arrive with display
  // casing that differs from the existing Linux workspace directory. Resolve
  // a unique case-insensitive match, but fail closed on a case collision.
  const foldedName = name.toLowerCase();
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let matches: string[];
    try {
      matches = readdirSync(root)
        .filter((entry) => entry.toLowerCase() === foldedName);
    } catch {
      continue;
    }
    if (matches.length > 1) {
      throw new Error(`Engagement '${name}' is ambiguous because multiple configured workspaces differ only by letter case`);
    }
    if (matches.length === 1) {
      const resolved = resolveCandidate(root, join(root, matches[0]));
      if (resolved) return resolved;
    }
  }
  throw new Error(`Engagement '${name}' does not identify a safe configured workspace`);
}
