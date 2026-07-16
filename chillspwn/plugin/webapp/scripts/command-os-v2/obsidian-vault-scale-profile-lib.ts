import { existsSync, lstatSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const OBSIDIAN_SCALE_CONFIRMATION = "isolated-temporary-obsidian-scale-50000";
export const OBSIDIAN_SCALE_PREFIX = "chillspwn-obsidian-scale-";
export const OBSIDIAN_SCALE_DEFAULT_NOTES = 50_000;
export const OBSIDIAN_SCALE_MAX_NOTES = 50_000;
export const OBSIDIAN_SCALE_MIN_NOTES = 4;

export interface ObsidianScalePaths {
  readonly root: string;
  readonly databasePath: string;
  readonly allowedVaultRoot: string;
  readonly vaultName: string;
}

export interface IncrementalBatchOptions {
  readonly batchSize: number;
  readonly signal?: AbortSignal;
  readonly yieldControl?: () => Promise<void>;
  readonly onProgress?: (processed: number, total: number) => void;
}

export interface IncrementalBatchResult {
  readonly processed: number;
  readonly batches: number;
  readonly elapsedMs: number;
}

export class IncrementalBatchAbortError extends Error {
  readonly processed: number;
  readonly elapsedMs: number;

  constructor(processed: number, elapsedMs: number) {
    super(`Incremental Obsidian scale work aborted after ${processed} items`);
    this.name = "AbortError";
    this.processed = processed;
    this.elapsedMs = elapsedMs;
  }
}

function isDescendant(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== ""
    && path !== ".."
    && !path.startsWith(`..${sep}`)
    && !isAbsolute(path);
}

/** Exact opt-in only; this profile never accepts a database or vault path. */
export function validateObsidianScaleGate(env: NodeJS.ProcessEnv): void {
  if (env.CHILLSPWN_OBSIDIAN_SCALE_CONFIRM !== OBSIDIAN_SCALE_CONFIRMATION) {
    throw new Error(
      `Set CHILLSPWN_OBSIDIAN_SCALE_CONFIRM=${OBSIDIAN_SCALE_CONFIRMATION} to run the isolated 50,000-note profile`,
    );
  }
}

export function scaleNoteCount(env: NodeJS.ProcessEnv): number {
  const source = env.CHILLSPWN_OBSIDIAN_SCALE_NOTES?.trim();
  if (!source) return OBSIDIAN_SCALE_DEFAULT_NOTES;
  if (!/^\d+$/u.test(source)) throw new TypeError("CHILLSPWN_OBSIDIAN_SCALE_NOTES must be an integer");
  const count = Number(source);
  if (!Number.isSafeInteger(count) || count < OBSIDIAN_SCALE_MIN_NOTES || count > OBSIDIAN_SCALE_MAX_NOTES) {
    throw new RangeError(
      `CHILLSPWN_OBSIDIAN_SCALE_NOTES must be between ${OBSIDIAN_SCALE_MIN_NOTES} and ${OBSIDIAN_SCALE_MAX_NOTES}`,
    );
  }
  return count;
}

/** Fail closed unless the workspace is a real, immediate /tmp child. */
export function assertIsolatedObsidianScaleWorkspace(
  workspaceRoot: string,
  temporaryRoot = "/tmp",
): string {
  if (!isAbsolute(workspaceRoot) || !isAbsolute(temporaryRoot)) {
    throw new TypeError("Obsidian scale paths must be absolute");
  }
  const verifiedTemporaryRoot = realpathSync(temporaryRoot);
  const verifiedWorkspace = realpathSync(workspaceRoot);
  const metadata = lstatSync(workspaceRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Obsidian scale workspace must be a real directory");
  }
  if (
    dirname(verifiedWorkspace) !== verifiedTemporaryRoot
    || !basename(verifiedWorkspace).startsWith(OBSIDIAN_SCALE_PREFIX)
  ) {
    throw new Error("Obsidian scale workspace must be a fresh direct child of the temporary root");
  }
  return verifiedWorkspace;
}

export function buildObsidianScalePaths(
  workspaceRoot: string,
  temporaryRoot = "/tmp",
): ObsidianScalePaths {
  const root = assertIsolatedObsidianScaleWorkspace(workspaceRoot, temporaryRoot);
  const paths: ObsidianScalePaths = {
    root,
    databasePath: join(root, "canonical", "second-brain-scale.sqlite"),
    allowedVaultRoot: join(root, "vault-sandbox"),
    vaultName: "ChillsPwn-Brain-Scale-Acceptance",
  };
  for (const candidate of [paths.databasePath, paths.allowedVaultRoot]) {
    if (!isDescendant(root, resolve(candidate))) {
      throw new Error("Derived Obsidian scale path escaped the temporary workspace");
    }
  }
  return paths;
}

/** Refuses cleanup unless the strict temporary-workspace gate still passes. */
export function removeObsidianScaleWorkspace(
  workspaceRoot: string,
  temporaryRoot = "/tmp",
): void {
  const verified = assertIsolatedObsidianScaleWorkspace(workspaceRoot, temporaryRoot);
  rmSync(verified, { recursive: true, force: true });
  if (existsSync(verified)) throw new Error("Obsidian scale workspace cleanup did not complete");
}

/**
 * Execute synchronous bridge operations in bounded batches. Each item remains
 * atomic; event-loop yields make cancellation and mission heartbeats observable
 * between batches without changing canonical bridge semantics.
 */
export async function processIncrementally(
  total: number,
  operation: (index: number) => void | Promise<void>,
  options: IncrementalBatchOptions,
): Promise<IncrementalBatchResult> {
  if (!Number.isSafeInteger(total) || total < 0) throw new RangeError("incremental total must be a non-negative integer");
  if (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 10_000) {
    throw new RangeError("incremental batch size must be between 1 and 10000");
  }
  const startedAt = performance.now();
  const yieldControl = options.yieldControl ?? (() => new Promise((resolve) => setTimeout(resolve, 0)));
  let processed = 0;
  let batches = 0;
  const abortIfRequested = (): void => {
    if (options.signal?.aborted) {
      throw new IncrementalBatchAbortError(processed, performance.now() - startedAt);
    }
  };

  abortIfRequested();
  while (processed < total) {
    const boundary = Math.min(total, processed + options.batchSize);
    while (processed < boundary) {
      abortIfRequested();
      await operation(processed);
      processed += 1;
    }
    batches += 1;
    options.onProgress?.(processed, total);
    if (processed < total) {
      await yieldControl();
      abortIfRequested();
    }
  }
  return { processed, batches, elapsedMs: performance.now() - startedAt };
}
