import { existsSync, lstatSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const OBSIDIAN_SMOKE_CONFIRMATION = "isolated-temporary-obsidian-bridge";
export const OBSIDIAN_SMOKE_PREFIX = "chillspwn-obsidian-smoke-";

export interface ObsidianSmokePaths {
  readonly root: string;
  readonly databasePath: string;
  readonly allowedVaultRoot: string;
  readonly vaultName: string;
}

function isDescendant(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== ""
    && path !== ".."
    && !path.startsWith(`..${sep}`)
    && !isAbsolute(path);
}

/**
 * This smoke never accepts a database or vault path. It requires an exact
 * opt-in phrase and derives both paths from one fresh temporary workspace.
 */
export function validateObsidianSmokeGate(env: NodeJS.ProcessEnv): void {
  if (env.CHILLSPWN_OBSIDIAN_SMOKE_CONFIRM !== OBSIDIAN_SMOKE_CONFIRMATION) {
    throw new Error(
      `Set CHILLSPWN_OBSIDIAN_SMOKE_CONFIRM=${OBSIDIAN_SMOKE_CONFIRMATION} to run the isolated smoke`,
    );
  }
}

/** Fail closed unless the workspace is a real, immediate child of /tmp. */
export function assertIsolatedObsidianWorkspace(
  workspaceRoot: string,
  temporaryRoot = "/tmp",
): string {
  if (!isAbsolute(workspaceRoot) || !isAbsolute(temporaryRoot)) {
    throw new TypeError("Obsidian smoke paths must be absolute");
  }
  const verifiedTemporaryRoot = realpathSync(temporaryRoot);
  const verifiedWorkspace = realpathSync(workspaceRoot);
  const metadata = lstatSync(workspaceRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Obsidian smoke workspace must be a real directory");
  }
  if (
    dirname(verifiedWorkspace) !== verifiedTemporaryRoot
    || !basename(verifiedWorkspace).startsWith(OBSIDIAN_SMOKE_PREFIX)
  ) {
    throw new Error("Obsidian smoke workspace must be a fresh direct child of the temporary root");
  }
  return verifiedWorkspace;
}

export function buildObsidianSmokePaths(
  workspaceRoot: string,
  temporaryRoot = "/tmp",
): ObsidianSmokePaths {
  const root = assertIsolatedObsidianWorkspace(workspaceRoot, temporaryRoot);
  const paths: ObsidianSmokePaths = {
    root,
    databasePath: join(root, "canonical", "second-brain.sqlite"),
    allowedVaultRoot: join(root, "vault-sandbox"),
    vaultName: "ChillsPwn-Brain-Acceptance",
  };
  for (const candidate of [paths.databasePath, paths.allowedVaultRoot]) {
    const resolved = resolve(candidate);
    if (!isDescendant(root, resolved)) {
      throw new Error("Derived Obsidian smoke path escaped the temporary workspace");
    }
  }
  return paths;
}

/** Refuses cleanup unless the same strict temporary-workspace gate passes. */
export function removeObsidianSmokeWorkspace(
  workspaceRoot: string,
  temporaryRoot = "/tmp",
): void {
  const verified = assertIsolatedObsidianWorkspace(workspaceRoot, temporaryRoot);
  rmSync(verified, { recursive: true, force: true });
  if (existsSync(verified)) throw new Error("Obsidian smoke workspace cleanup did not complete");
}
