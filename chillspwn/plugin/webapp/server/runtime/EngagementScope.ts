import { existsSync, lstatSync } from "fs";
import { join } from "path";
import { safeEngagementName } from "../security/identifiers";
import { resolveExistingWithinRoots } from "../security/paths";

/** Resolve a user/DB engagement name to a real, non-symlink engagement directory. */
export function resolveEngagementWorkingDirectory(rawName: unknown, roots: string[]): string {
  const name = safeEngagementName(rawName);
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const candidate = join(root, name);
    if (!existsSync(candidate)) continue;
    const state = lstatSync(candidate);
    if (state.isSymbolicLink() || !state.isDirectory()) continue;
    const resolved = resolveExistingWithinRoots(
      [root],
      candidate,
      "engagement working directory",
      { rejectFinalSymlink: true },
    );
    if (!lstatSync(resolved).isDirectory()) continue;
    return resolved;
  }
  throw new Error(`Engagement '${name}' does not identify a safe configured workspace`);
}
