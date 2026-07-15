import { closeSync, existsSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from "fs";
import { isAbsolute, join } from "path";
import { safeSessionId } from "../security/identifiers";
import { resolveExistingWithinRoots } from "../security/paths";

const MAX_ORIGIN_PREFIX_BYTES = 1024 * 1024;

export function locateClaudeSessionFile(projectsDir: string, rawSessionId: unknown): string {
  const sessionId = safeSessionId(rawSessionId, "CLI session ID");
  if (!existsSync(projectsDir)) throw new Error("Claude projects directory does not exist");
  const rootState = lstatSync(projectsDir);
  if (rootState.isSymbolicLink() || !rootState.isDirectory()) throw new Error("Claude projects directory is not trusted");
  const realRoot = realpathSync(projectsDir);
  const matches: string[] = [];

  for (const projectName of readdirSync(realRoot)) {
    const projectCandidate = join(realRoot, projectName);
    try {
      const projectState = lstatSync(projectCandidate);
      if (projectState.isSymbolicLink() || !projectState.isDirectory()) continue;
      const projectDir = resolveExistingWithinRoots(
        [realRoot],
        projectCandidate,
        "Claude project directory",
        { rejectFinalSymlink: true },
      );
      const candidate = join(projectDir, `${sessionId}.jsonl`);
      if (!existsSync(candidate)) continue;
      const fileState = lstatSync(candidate);
      if (fileState.isSymbolicLink() || !fileState.isFile()) continue;
      matches.push(resolveExistingWithinRoots(
        [realRoot],
        candidate,
        "Claude session file",
        { rejectFinalSymlink: true },
      ));
    } catch {
      // Broken or unsafe project entries do not become resumable sources.
    }
  }

  if (matches.length === 0) throw new Error("CLI session not found");
  if (matches.length > 1) throw new Error("CLI session ID is ambiguous across projects");
  return matches[0];
}

export function readClaudeSessionOrigin(filePath: string, rawExpectedId: unknown): string {
  const expectedId = safeSessionId(rawExpectedId, "CLI session ID");
  const state = lstatSync(filePath);
  if (state.isSymbolicLink() || !state.isFile()) throw new Error("Claude session source is not a regular file");
  const buffer = Buffer.alloc(Math.min(MAX_ORIGIN_PREFIX_BYTES, Math.max(1, state.size)));
  const fd = openSync(filePath, "r");
  let bytesRead = 0;
  try { bytesRead = readSync(fd, buffer, 0, buffer.length, 0); }
  finally { closeSync(fd); }

  for (const line of buffer.subarray(0, bytesRead).toString("utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record?.sessionId !== expectedId) continue;
      const cwd = record?.cwd;
      if (typeof cwd === "string" && cwd.length > 0 && isAbsolute(cwd) && !cwd.includes("\0")) return cwd;
    } catch {
      // Metadata and malformed records are skipped within the bounded prefix.
    }
  }
  throw new Error("CLI session has no trustworthy origin working directory");
}

export function resolveTrustedClaudeResumeCwd(
  recordedCwd: string,
  allowedWorkspaceRoots: string[],
  dashboardCwd: string,
): string {
  if (!isAbsolute(recordedCwd) || !existsSync(recordedCwd)) throw new Error("CLI session working directory no longer exists");
  const state = lstatSync(recordedCwd);
  if (state.isSymbolicLink() || !state.isDirectory()) throw new Error("CLI session working directory is not trusted");
  const realRecorded = realpathSync(recordedCwd);

  try {
    return resolveExistingWithinRoots(
      allowedWorkspaceRoots,
      realRecorded,
      "CLI session working directory",
      { rejectFinalSymlink: true },
    );
  } catch {
    // Dashboard-origin sessions are a narrow compatibility exception: exact
    // equality is allowed, but the dashboard directory is never a broad root.
  }

  const realDashboard = realpathSync(dashboardCwd);
  if (realRecorded === realDashboard) return realRecorded;
  throw new Error("CLI session working directory is outside allowed workspace roots");
}

export function resolveClaudeResumeSource(input: {
  projectsDir: string;
  sessionId: unknown;
  allowedWorkspaceRoots: string[];
  dashboardCwd: string;
}): { filePath: string; cwd: string } {
  const sessionId = safeSessionId(input.sessionId, "CLI session ID");
  const filePath = locateClaudeSessionFile(input.projectsDir, sessionId);
  const recordedCwd = readClaudeSessionOrigin(filePath, sessionId);
  return {
    filePath,
    cwd: resolveTrustedClaudeResumeCwd(recordedCwd, input.allowedWorkspaceRoots, input.dashboardCwd),
  };
}
