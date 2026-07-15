import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
} from "fs";
import { basename, join } from "path";
import { safeEngagementName, safeSessionId } from "../security/identifiers";
import { isWithinRoot, resolveExistingWithinRoots } from "../security/paths";

const OSINT_DIRECTORY = /^osint-[A-Za-z0-9._-]+-\d+$/;

function readBoundedRegularFile(
  trustedRoot: string,
  candidate: string,
  maximumBytes: number,
): { path: string; content: Buffer; size: number } {
  const root = realpathSync(trustedRoot);
  const fd = openSync(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const state = fstatSync(fd);
    if (!state.isFile() || state.size > maximumBytes) {
      throw new Error("OSINT file is not a bounded regular file");
    }
    const openedPath = realpathSync(`/proc/self/fd/${fd}`);
    if (!isWithinRoot(root, openedPath)) throw new Error("OSINT file escaped its trusted directory");
    return { path: openedPath, content: readFileSync(fd), size: state.size };
  } finally {
    closeSync(fd);
  }
}

export function safeOsintJobId(raw: unknown): string {
  const id = safeSessionId(raw, "OSINT job ID");
  if (!id.startsWith("osint-")) throw new Error("invalid OSINT job ID");
  return id;
}

export function resolveOsintOutputDirectory(rawPath: unknown, engagementRoots: string[]): string {
  if (typeof rawPath !== "string") throw new Error("invalid OSINT output directory");
  const name = safeEngagementName(basename(rawPath), "OSINT output directory name");
  if (!OSINT_DIRECTORY.test(name)) throw new Error("invalid OSINT output directory name");
  const resolved = resolveExistingWithinRoots(
    engagementRoots,
    rawPath,
    "OSINT output directory",
    { rejectFinalSymlink: true },
  );
  const state = lstatSync(resolved);
  if (!state.isDirectory()) throw new Error("OSINT output path is not a directory");
  return resolved;
}

export function resolveOsintArtifact(
  outputDirectory: string,
  filename: "report.md" | "report.pdf" | "report.html" | "findings.json",
  maximumBytes = 10 * 1024 * 1024,
): string {
  const candidate = join(outputDirectory, filename);
  if (!existsSync(candidate)) throw new Error(`OSINT artifact '${filename}' does not exist`);
  const state = lstatSync(candidate);
  if (state.isSymbolicLink() || !state.isFile()) throw new Error("OSINT artifact is not a regular file");
  if (state.size > maximumBytes) throw new Error("OSINT artifact exceeds the size limit");
  return resolveExistingWithinRoots(
    [outputDirectory],
    candidate,
    "OSINT artifact",
    { rejectFinalSymlink: true },
  );
}

export function readOsintArtifact(
  outputDirectory: string,
  filename: "report.md" | "report.pdf" | "report.html" | "findings.json",
  maximumBytes = 10 * 1024 * 1024,
): { path: string; content: Buffer; size: number } {
  const trustedDirectory = realpathSync(outputDirectory);
  const path = resolveOsintArtifact(trustedDirectory, filename, maximumBytes);
  return readBoundedRegularFile(trustedDirectory, path, maximumBytes);
}

export function readOsintStateSnapshot(
  stateDirectory: string,
  jobId: string,
  maximumBytes = 2 * 1024 * 1024,
): { path: string; content: Buffer; size: number } {
  const id = safeOsintJobId(jobId);
  const root = realpathSync(stateDirectory);
  const candidate = join(root, `${id}.json`);
  return readBoundedRegularFile(root, candidate, maximumBytes);
}

export function readOsintLogChunk(
  stateDirectory: string,
  jobId: string,
  offset: number,
  options: { maximumFileBytes?: number; maximumChunkBytes?: number } = {},
): { content: Buffer; nextOffset: number; truncated: boolean } {
  const id = safeOsintJobId(jobId);
  const root = realpathSync(stateDirectory);
  const candidate = join(root, `${id}.stdout.log`);
  const maximumFileBytes = options.maximumFileBytes ?? 100 * 1024 * 1024;
  const maximumChunkBytes = options.maximumChunkBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid OSINT log offset");
  if (!Number.isSafeInteger(maximumChunkBytes) || maximumChunkBytes < 1) throw new Error("invalid OSINT log chunk limit");

  const fd = openSync(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const state = fstatSync(fd);
    if (!state.isFile() || state.size > maximumFileBytes) {
      throw new Error("OSINT log is not a bounded regular file");
    }
    const openedPath = realpathSync(`/proc/self/fd/${fd}`);
    if (!isWithinRoot(root, openedPath)) throw new Error("OSINT log escaped its state directory");

    const truncated = state.size < offset;
    const start = truncated ? 0 : offset;
    const length = Math.min(state.size - start, maximumChunkBytes);
    if (length <= 0) return { content: Buffer.alloc(0), nextOffset: start, truncated };
    const content = Buffer.alloc(length);
    const bytesRead = readSync(fd, content, 0, length, start);
    return { content: content.subarray(0, bytesRead), nextOffset: start + bytesRead, truncated };
  } finally {
    closeSync(fd);
  }
}
