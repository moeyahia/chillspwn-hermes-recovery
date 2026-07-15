import { describe, expect, test } from "bun:test";
import { shutdownProcessTree, parseLinuxProcStat } from "../ProcessTreeShutdown";

const fastShutdown = {
  gracefulWaitMs: 25,
  termGraceMs: 75,
  killWaitMs: 500,
  pollIntervalMs: 10,
};

describe("parseLinuxProcStat", () => {
  test("handles process names containing spaces and parentheses", () => {
    const fieldsAfterName = [
      "S", "7", "6", "5", "0", "-1", "4194304", "1", "2", "3", "4",
      "5", "6", "7", "8", "9", "10", "11", "12", "987654", "14", "15",
    ];
    expect(parseLinuxProcStat(`42 (grok agent (stdio)) ${fieldsAfterName.join(" ")}`)).toEqual({
      pid: 42,
      ppid: 7,
      startTime: "987654",
      state: "S",
    });
  });

  test("rejects malformed records", () => {
    expect(parseLinuxProcStat("not a proc stat record")).toBeNull();
    expect(parseLinuxProcStat("12 (short) S 1")).toBeNull();
  });
});

describe("shutdownProcessTree", () => {
  test("is a safe no-op for invalid or already exited PIDs", async () => {
    expect((await shutdownProcessTree(undefined)).alreadyExited).toBe(true);
    expect((await shutdownProcessTree(-1)).issues[0]?.phase).toBe("discover");
    expect((await shutdownProcessTree(2_147_483_647)).alreadyExited).toBe(true);
  });

  test("runs one graceful hook for concurrent idempotent shutdown calls", async () => {
    const child = Bun.spawn(["bash", "-c", "trap '' TERM; while :; do sleep 1; done"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    let gracefulCalls = 0;
    const options = {
      ...fastShutdown,
      requestGracefulStop: () => { gracefulCalls += 1; },
    };

    try {
      const [first, second] = await Promise.all([
        shutdownProcessTree(child.pid, options),
        shutdownProcessTree(child.pid, options),
      ]);
      expect(gracefulCalls).toBe(1);
      expect(first).toEqual(second);
      expect(first.killSignalPids).toContain(child.pid);
      expect(first.remainingPids).toEqual([]);
    } finally {
      try { process.kill(child.pid, "SIGKILL"); } catch {}
      await child.exited;
    }
  });

  test("kills the complete tree, including a setsid descendant", async () => {
    const child = Bun.spawn([
      "bash",
      "-c",
      [
        "trap '' TERM",
        "setsid bash -c 'trap \"\" TERM; sleep 60 & wait' &",
        "bash -c 'trap \"\" TERM; sleep 60 & wait' &",
        "wait",
      ].join("\n"),
    ], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });

    try {
      // Give both branches time to create their own sleep descendants.
      await new Promise((resolve) => setTimeout(resolve, 150));
      const result = await shutdownProcessTree(child.pid, fastShutdown);

      expect(result.termSignalPids).toContain(child.pid);
      expect(result.termSignalPids.length).toBeGreaterThanOrEqual(3);
      expect(result.killSignalPids).toContain(child.pid);
      expect(result.killSignalPids.length).toBeGreaterThanOrEqual(3);
      expect(result.remainingPids).toEqual([]);
      expect(result.issues).toEqual([]);
    } finally {
      try { process.kill(child.pid, "SIGKILL"); } catch {}
      await child.exited;
    }
  });
});
