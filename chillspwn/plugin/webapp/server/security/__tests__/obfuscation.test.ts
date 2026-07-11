import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  setObfuscationEnabled,
  isPromptObfuscationEnabled,
  maybeObfuscatePrompt,
  maybeSafeObfuscate,
  maybeObfuscateWithAliases,
  buildCouncilBriefing,
  councilResponseInstruction,
} from "../obfuscation";

// The module carries process-global state; reset to the secure default around each
// test so ordering can't leak. This mirrors how index.ts wires it once at boot.
beforeEach(() => setObfuscationEnabled(false));
afterEach(() => setObfuscationEnabled(false));

const SAMPLE = "Run nmap against the target and elite hack the box";

describe("prompt obfuscation — DEFAULT runtime is transparent", () => {
  test("disabled by default", () => {
    expect(isPromptObfuscationEnabled()).toBe(false);
  });

  test("all shims are the IDENTITY when disabled (no transformation at all)", () => {
    // If g0dm0d3/parseltongue were invoked, leetspeak/alias replacement would mutate
    // the text. Identity proves the legacy engine is never reached in the default path.
    expect(maybeObfuscatePrompt(SAMPLE)).toBe(SAMPLE);
    expect(maybeSafeObfuscate(SAMPLE)).toBe(SAMPLE);
    expect(maybeObfuscateWithAliases(SAMPLE)).toBe(SAMPLE);
    // Crucially, the deterministic alias map is NOT applied: 'nmap' stays 'nmap'.
    expect(maybeObfuscateWithAliases("nmap scan")).toBe("nmap scan");
    expect(maybeObfuscateWithAliases("nmap scan")).not.toContain("SURFACE");
  });

  test("DEFAULT council briefing is plain — no l33tspeak instruction appended", () => {
    const base = "Engagement PING.HTB. Stuck on AD privesc. Recommend the next vector.";
    expect(councilResponseInstruction()).toBe("");
    const briefing = buildCouncilBriefing(base);
    expect(briefing).toBe(base); // unchanged
    expect(briefing.toLowerCase()).not.toContain("l33t");
    expect(briefing.toLowerCase()).not.toContain("leet");
    expect(briefing).not.toContain("RESPONSE FORMAT (MANDATORY)");
  });
});

describe("prompt obfuscation — explicit opt-in reaches the legacy engine", () => {
  test("enabling routes through g0dm0d3 (deterministic alias proof) + warns once", () => {
    const warnings: string[] = [];
    setObfuscationEnabled(true, (m) => warnings.push(m));

    // Enabling reaches the legacy engine: the deterministic alias map replaces 'nmap'
    // (then leetspeak further mangles it), so the output differs from input and the raw
    // tool name is gone. (We avoid asserting the exact alias text because the random
    // leetspeak pass rewrites it, e.g. SURFACE → 5URF4C3.)
    const out = maybeObfuscateWithAliases("nmap scan");
    expect(out).not.toBe("nmap scan");
    expect(out.toLowerCase()).not.toContain("nmap");

    // The legacy/unsafe warning is emitted exactly once on first use.
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/obfuscation/i);
    maybeObfuscateWithAliases("another nmap"); // second call: no new warning
    expect(warnings.length).toBe(1);
  });

  test("setObfuscationEnabled(false) restores identity", () => {
    setObfuscationEnabled(true);
    expect(maybeObfuscateWithAliases("nmap")).not.toBe("nmap"); // transformed when on
    setObfuscationEnabled(false);
    expect(maybeObfuscateWithAliases("nmap")).toBe("nmap"); // identity when off
  });

  test("council briefing includes the l33t mandate only when enabled", () => {
    setObfuscationEnabled(true);
    const briefing = buildCouncilBriefing("base briefing");
    expect(briefing).toContain("RESPONSE FORMAT (MANDATORY)");
    expect(briefing.toLowerCase()).toContain("l33t");
  });
});
