import { test, expect, describe } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { WordlistAssetManager } from "../WordlistAssetManager";
import { HashcatAssetManager } from "../HashcatAssetManager";
import { getAgent, listAgentIds, AGENT_ROSTER } from "../../agents/agentRoster";
import { routeTask } from "../../agents/agentRouter";
import { SPECIALIST_LANES } from "../../agents/missionBoardLanes";

const dir = join(import.meta.dir, "..");
const wl = new WordlistAssetManager(join(dir, "wordlistAssets.manifest.json"));
const hc = new HashcatAssetManager(join(dir, "hashcatAssets.manifest.json"));
const vi = JSON.parse(readFileSync(join(dir, "vulnIntelMcp.manifest.json"), "utf-8"));

describe("Part 1 manifests", () => {
  test("wordlist + hashcat + vuln-intel manifests load with pinned commits", () => {
    expect(wl.getLoadError()).toBeNull(); expect(hc.getLoadError()).toBeNull();
    const wlm = JSON.parse(readFileSync(join(dir, "wordlistAssets.manifest.json"), "utf-8"));
    for (const r of wlm.repos) expect(r.commitHash).toMatch(/^[0-9a-f]{40}$/);
    for (const s of vi.servers) { expect(s.commitHash).toMatch(/^[0-9a-f]{40}$/); expect(s.assignedAgents).toContain("VulnIntel"); }
  });
});

describe("Part 2 wordlist manager — paths/metadata only", () => {
  test("list returns metadata, NO contents field", () => {
    for (const w of wl.list({ includeLarge: true, includeBreach: true })) {
      expect(w).not.toHaveProperty("contents");
      expect(w.localPath).toContain("/opt/chillspwn-assets/");
    }
  });
  test("select returns -w <path> args, never contents; small lists for quick", () => {
    const sel = wl.select({ taskType: "directory", specialistAgentId: "WebBreaker", speedProfile: "quick" });
    expect(sel.commandPathArgs.every((a) => a.startsWith("-w /opt/"))).toBe(true);
    expect(JSON.stringify(sel)).not.toContain("admin\n"); // no content lines
    expect(sel.selectedWordlists.every((w) => !w.isLarge)).toBe(true);
  });
  test("large + breach lists excluded by default; flagged + approval when deep", () => {
    expect(wl.list().some((w) => w.isLarge || w.isBreachData)).toBe(false); // default excludes
    const deep = wl.select({ taskType: "passwords", specialistAgentId: "CredSmith", riskTolerance: "high", depthProfile: "deep" });
    const breach = deep.selectedWordlists.filter((w) => w.isBreachData);
    if (breach.length) { expect(breach.every((w) => w.requiresApproval)).toBe(true); expect(deep.caution).toContain("BREACH"); }
  });
  test("breach datasets not auto-downloaded (manifest requiresDownload + requiresApproval)", () => {
    const wlm = JSON.parse(readFileSync(join(dir, "wordlistAssets.manifest.json"), "utf-8"));
    for (const w of wlm.wordlists.filter((x: any) => x.isBreachData)) { expect(w.requiresDownload).toBe(true); expect(w.requiresApproval).toBe(true); expect(w.enabledByDefault).toBe(false); }
  });
});

describe("Part 4 hashcat manager — strategy by metadata", () => {
  test("strategy returns wordlist/rule PATHS + command template, no contents", () => {
    const p = hc.strategy({ objective: "corporate phrases", passwordStyleHint: "passphrase", runtimeBudget: "balanced" });
    expect(p.strategy).toBe("passphrase");
    expect(p.selectedRulePaths.every((r) => r.startsWith("/opt/"))).toBe(true);
    expect(p.commandPlan).toContain("--potfile-disable");
    expect(p.approvalRequired).toBe(true);
    expect(p.safety.toLowerCase()).toContain("never");
  });
  test("rule metadata carries expansion factor (not contents)", () => {
    for (const r of hc.listRules()) { expect(typeof r.estimatedExpansionFactor).toBe("number"); expect(r).not.toHaveProperty("contents"); }
  });
});

describe("Part 5/8 VulnIntel specialist + lane", () => {
  test("VulnIntel in roster (12 agents), read-only, denies exploitation tools", () => {
    expect(listAgentIds()).toContain("VulnIntel");
    expect(AGENT_ROSTER.length).toBe(12);
    const v = getAgent("VulnIntel")!;
    expect(v.specialty).toBe("vulnerability_intelligence");
    for (const t of ["execute", "runHashcat", "nmapScan", "ffufScan", "sqlmap"]) expect(v.deniedTools).toContain(t);
    expect(v.allowedTools.some((t) => /cve|epss|kev|attack/i.test(t))).toBe(true);
    expect(v.canApproveTrainingLessons).toBe(false);
  });
  test("CVE routing → VulnIntel", () => {
    for (const q of ["known vulnerabilities for Apache 2.4.49", "check EPSS and KEV for this CVE", "is this version vulnerable", "MITRE ATT&CK mapping"]) expect(routeTask(q).selectedAgent).toBe("VulnIntel");
  });
  test("Mission Board has Vulnerability Intel lane at position 4 (15 lanes)", () => {
    expect(SPECIALIST_LANES.length).toBe(15);
    expect(SPECIALIST_LANES[3].title).toBe("Vulnerability Intel");
    expect(SPECIALIST_LANES[3].agentId).toBe("VulnIntel");
  });
});

describe("Part 6 CVE MCPs assigned ONLY to VulnIntel", () => {
  test("manifest CVE servers → VulnIntel; no other agent gets cve tools", () => {
    const mcp = JSON.parse(readFileSync(join(dir, "..", "agents", "mcpArsenal.manifest.json"), "utf-8"));
    const cve = mcp.servers.filter((s: any) => /vulnintel-/.test(s.mcpServerName));
    expect(cve.length).toBe(3);
    for (const s of cve) expect(s.assignedAgents).toEqual(["VulnIntel"]);
    // no non-VulnIntel specialist allows a cve tool
    for (const a of AGENT_ROSTER.filter((x) => x.agentId !== "VulnIntel")) expect(a.allowedTools.some((t) => /^fetch_cve|get_epss|check_kev/.test(t))).toBe(false);
  });
});

describe("Part 10 training memory — strategy/intel lesson kinds, no secrets", () => {
  test("new lesson kinds exist; secret-bearing strategy lesson still rejected", () => {
    const { LESSON_KINDS, validateAndNormalizeLesson } = require("../../runtime/AttackLesson");
    for (const k of ["wordlist_strategy_lesson", "hashcat_strategy_lesson", "vulnerability_intelligence_lesson"]) expect(LESSON_KINDS).toContain(k);
    const bad = validateAndNormalizeLesson({ kind: "hashcat_strategy_lesson", title: "x", techniqueName: "y", techniqueCategory: "credentials", summary: "cracked HTB{aaaaaaaaaaaaaaaaaaaa}" });
    expect(bad.ok).toBe(false); // secret rejected even in strategy lessons
  });
});
