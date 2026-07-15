import { readdirSync, readFileSync } from "node:fs";

const DEFAULT_GRACEFUL_WAIT_MS = 250;
const DEFAULT_TERM_GRACE_MS = 3_000;
const DEFAULT_KILL_WAIT_MS = 1_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

type ShutdownPhase = "discover" | "graceful" | "term" | "kill";

export interface ProcessIdentity {
  pid: number;
  ppid: number;
  /** Linux process start time, in clock ticks since boot (field 22 in /proc/PID/stat). */
  startTime: string;
  state: string;
}

export interface ProcessTreeShutdownIssue {
  phase: ShutdownPhase;
  pid?: number;
  message: string;
}

export interface ProcessTreeShutdownOptions {
  /**
   * Sends the provider's graceful cancellation before any Unix signal is used.
   * For Grok ACP this can write `session/cancel` to stdin. The hook should
   * resolve once the cancellation request has been sent; cleanup will still
   * continue if it rejects or does not settle before gracefulWaitMs.
   */
  requestGracefulStop?: () => void | Promise<void>;
  gracefulWaitMs?: number;
  termGraceMs?: number;
  killWaitMs?: number;
  pollIntervalMs?: number;
  logger?: (message: string, issue?: ProcessTreeShutdownIssue) => void;
}

export interface ProcessTreeShutdownResult {
  rootPid: number | null;
  rootStartTime?: string;
  alreadyExited: boolean;
  gracefulRequested: boolean;
  termSignalPids: number[];
  killSignalPids: number[];
  remainingPids: number[];
  issues: ProcessTreeShutdownIssue[];
}

interface ShutdownContext {
  root: ProcessIdentity;
  known: Map<number, string>;
  issues: ProcessTreeShutdownIssue[];
  options: Required<Pick<
    ProcessTreeShutdownOptions,
    "gracefulWaitMs" | "termGraceMs" | "killWaitMs" | "pollIntervalMs"
  >> & Pick<ProcessTreeShutdownOptions, "requestGracefulStop" | "logger">;
}

const inFlightShutdowns = new Map<string, Promise<ProcessTreeShutdownResult>>();

function identityKey(identity: Pick<ProcessIdentity, "pid" | "startTime">): string {
  return `${identity.pid}:${identity.startTime}`;
}

function boundedDelay(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function normalizedOptions(options: ProcessTreeShutdownOptions): ShutdownContext["options"] {
  return {
    requestGracefulStop: options.requestGracefulStop,
    gracefulWaitMs: boundedDelay(options.gracefulWaitMs, DEFAULT_GRACEFUL_WAIT_MS),
    termGraceMs: boundedDelay(options.termGraceMs, DEFAULT_TERM_GRACE_MS),
    killWaitMs: boundedDelay(options.killWaitMs, DEFAULT_KILL_WAIT_MS),
    pollIntervalMs: Math.max(1, boundedDelay(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS)),
    logger: options.logger,
  };
}

function issueMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function recordIssue(
  context: Pick<ShutdownContext, "issues" | "options">,
  phase: ShutdownPhase,
  error: unknown,
  pid?: number,
): void {
  const issue: ProcessTreeShutdownIssue = { phase, pid, message: issueMessage(error) };
  context.issues.push(issue);
  try {
    context.options.logger?.(`[process-tree] ${phase} failed${pid ? ` for PID ${pid}` : ""}: ${issue.message}`, issue);
  } catch {
    // A diagnostic logger must never prevent process cleanup.
  }
}

/** Parse the fields Chillspwn needs from a Linux /proc/PID/stat record. */
export function parseLinuxProcStat(stat: string): ProcessIdentity | null {
  const openParen = stat.indexOf("(");
  const closeParen = stat.lastIndexOf(")");
  if (openParen <= 0 || closeParen <= openParen) return null;

  const pid = Number.parseInt(stat.slice(0, openParen).trim(), 10);
  // The tail begins at field 3 (state); a process name may itself contain spaces
  // or parentheses, which is why lastIndexOf(")") is required above.
  const tail = stat.slice(closeParen + 1).trim().split(/\s+/);
  const ppid = Number.parseInt(tail[1] ?? "", 10);
  const startTime = tail[19];
  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(ppid) || !startTime) return null;

  return { pid, ppid, startTime, state: tail[0] ?? "" };
}

function readProcess(pid: number): ProcessIdentity | null {
  try {
    return parseLinuxProcStat(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return null;
  }
}

function readProcessTable(): Map<number, ProcessIdentity> {
  const table = new Map<number, ProcessIdentity>();
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return table;
  }

  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const processInfo = readProcess(Number(entry));
    if (processInfo) table.set(processInfo.pid, processInfo);
  }
  return table;
}

function isExitedState(state: string): boolean {
  return state === "Z" || state === "X" || state === "x";
}

/**
 * Refresh identities already associated with the tree and discover new
 * descendants by PPID. Known descendants remain tracked after re-parenting.
 */
function refreshTrackedTree(context: ShutdownContext): ProcessIdentity[] {
  const table = readProcessTable();
  const active = new Map<number, ProcessIdentity>();

  for (const [pid, startTime] of context.known) {
    const current = table.get(pid);
    if (current && current.startTime === startTime && !isExitedState(current.state)) {
      active.set(pid, current);
    }
  }

  const childrenByParent = new Map<number, ProcessIdentity[]>();
  for (const processInfo of table.values()) {
    if (isExitedState(processInfo.state)) continue;
    const siblings = childrenByParent.get(processInfo.ppid) ?? [];
    siblings.push(processInfo);
    childrenByParent.set(processInfo.ppid, siblings);
  }

  const queue = [...active.keys()];
  const visited = new Set(queue);
  while (queue.length > 0) {
    const parentPid = queue.shift()!;
    for (const child of childrenByParent.get(parentPid) ?? []) {
      if (visited.has(child.pid)) continue;
      visited.add(child.pid);
      context.known.set(child.pid, child.startTime);
      active.set(child.pid, child);
      queue.push(child.pid);
    }
  }

  // Signal the provider root first so it cannot intentionally launch more
  // children while the already captured descendants are being stopped.
  return [...active.values()].sort((a, b) => {
    if (a.pid === context.root.pid) return -1;
    if (b.pid === context.root.pid) return 1;
    return a.pid - b.pid;
  });
}

function sameProcessStillAlive(identity: ProcessIdentity): boolean {
  const current = readProcess(identity.pid);
  return Boolean(
    current
      && current.startTime === identity.startTime
      && !isExitedState(current.state),
  );
}

function signalProcesses(
  context: ShutdownContext,
  identities: ProcessIdentity[],
  signal: "SIGTERM" | "SIGKILL",
  signalled: Map<string, number>,
): void {
  const phase: ShutdownPhase = signal === "SIGTERM" ? "term" : "kill";
  for (const identity of identities) {
    const key = identityKey(identity);
    if (signalled.has(key) || !sameProcessStillAlive(identity)) continue;
    try {
      process.kill(identity.pid, signal);
      signalled.set(key, identity.pid);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      if (code !== "ESRCH") recordIssue(context, phase, error, identity.pid);
    }
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTree(
  context: ShutdownContext,
  durationMs: number,
  signal?: "SIGTERM" | "SIGKILL",
  signalled?: Map<string, number>,
): Promise<ProcessIdentity[]> {
  const deadline = Date.now() + durationMs;
  let active = refreshTrackedTree(context);

  while (active.length > 0) {
    if (signal && signalled) signalProcesses(context, active, signal, signalled);
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    await sleep(Math.min(context.options.pollIntervalMs, remainingMs));
    active = refreshTrackedTree(context);
  }

  return refreshTrackedTree(context);
}

async function requestGracefulStop(context: ShutdownContext): Promise<void> {
  const hook = context.options.requestGracefulStop;
  if (!hook) {
    await waitForTree(context, 0);
    return;
  }

  const deadline = Date.now() + context.options.gracefulWaitMs;
  let settled = false;
  const hookSettled = Promise.resolve()
    .then(hook)
    .catch((error) => recordIssue(context, "graceful", error, context.root.pid))
    .finally(() => { settled = true; });

  // Never let a broken cancellation callback prevent TERM/KILL cleanup.
  while (!settled && Date.now() < deadline) {
    await Promise.race([
      hookSettled,
      sleep(Math.min(context.options.pollIntervalMs, Math.max(0, deadline - Date.now()))),
    ]);
  }

  await waitForTree(context, Math.max(0, deadline - Date.now()));
}

function emptyResult(rootPid: number | null, issue?: ProcessTreeShutdownIssue): ProcessTreeShutdownResult {
  return {
    rootPid,
    alreadyExited: true,
    gracefulRequested: false,
    termSignalPids: [],
    killSignalPids: [],
    remainingPids: [],
    issues: issue ? [issue] : [],
  };
}

async function performShutdown(
  root: ProcessIdentity,
  options: ProcessTreeShutdownOptions,
): Promise<ProcessTreeShutdownResult> {
  const context: ShutdownContext = {
    root,
    known: new Map([[root.pid, root.startTime]]),
    issues: [],
    options: normalizedOptions(options),
  };
  const termSignalled = new Map<string, number>();
  const killSignalled = new Map<string, number>();

  // Capture descendants before graceful cancellation can cause re-parenting.
  refreshTrackedTree(context);
  await requestGracefulStop(context);

  let active = refreshTrackedTree(context);
  if (active.length > 0) {
    signalProcesses(context, active, "SIGTERM", termSignalled);
    active = await waitForTree(context, context.options.termGraceMs, "SIGTERM", termSignalled);
  }

  if (active.length > 0) {
    signalProcesses(context, active, "SIGKILL", killSignalled);
    active = await waitForTree(context, context.options.killWaitMs, "SIGKILL", killSignalled);
  }

  return {
    rootPid: root.pid,
    rootStartTime: root.startTime,
    alreadyExited: false,
    gracefulRequested: Boolean(context.options.requestGracefulStop),
    termSignalPids: [...termSignalled.values()],
    killSignalPids: [...killSignalled.values()],
    remainingPids: active.map(({ pid }) => pid),
    issues: context.issues,
  };
}

/**
 * Stop one provider process and every descendant discoverable through Linux
 * /proc, including children that created another process group or session.
 * Concurrent calls for the same root PID share one shutdown operation.
 */
export function shutdownProcessTree(
  rootPid: number | null | undefined,
  options: ProcessTreeShutdownOptions = {},
): Promise<ProcessTreeShutdownResult> {
  if (!Number.isInteger(rootPid) || Number(rootPid) <= 0) {
    return Promise.resolve(emptyResult(rootPid ?? null, {
      phase: "discover",
      message: `Invalid process ID: ${String(rootPid)}`,
    }));
  }

  const pid = Number(rootPid);
  const root = readProcess(pid);
  if (!root || isExitedState(root.state)) return Promise.resolve(emptyResult(pid));
  const key = identityKey(root);
  const existing = inFlightShutdowns.get(key);
  if (existing) return existing;

  const operation = performShutdown(root, options).finally(() => {
    if (inFlightShutdowns.get(key) === operation) inFlightShutdowns.delete(key);
  });
  inFlightShutdowns.set(key, operation);
  return operation;
}
