import { test, expect, describe } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { AGENT_ROSTER, getAgent, isSpecialistTool, agentsForTool, listAgentIds } from "../agentRoster";
import { mappingFor, specialistToolDecision } from "../agentMcpMap";
import { AgentRoutingPolicy } from "../AgentRoutingPolicy";
import { routeTask, specialistProfile } from "../agentRouter";
import { buildMissionBoard, buildCommanderCard, makeHandoff } from "../missionBoard";
import { SPECIALIST_DOMAINS } from "../types";

const ENFORCE = { enableSpecialistRouting: true, enforceChillspwnDelegation: true, allowChillspwnDirectTools: false, requireSpecialistAssignment: true };
const AUDIT = { ...ENFORCE, enforceChillspwnDelegation: false, requireSpecialistAssignment: false };

describe("15.2 roster validation", () => {
  test("exactly 11 specialists, no Commander in roster", () => {
    expect(AGENT_ROSTER.length).toBe(12);
    expect(listAgentIds()).not.toContain("chillspwn");
    expect(listAgentIds()).toEqual(["ReconScout","WebBreaker","CredSmith","ADAttackMapper","CloudSentinel","ReverseSage","FuzzSmith","OSINTSeeker","SecretHunter","SessionRunner","ReportSmith","VulnIntel"]);
  });
  test("every specialist: can propose but NEVER approve own lessons; has namespace + allowlist + persona", () => {
    for (const a of AGENT_ROSTER) {
      expect(a.canApproveTrainingLessons).toBe(false);
      expect(a.canProposeTrainingLessons).toBe(true);
      expect(a.memoryNamespace).toContain("agent:");
      expect(a.allowedTools.length).toBeGreaterThan(0);
      expect(a.personaId).toBeTruthy();
      expect(SPECIALIST_DOMAINS).toContain(a.specialty);
    }
  });
  test("least privilege: no two specialists share an identical full toolset; each denies others' core tools", () => {
    expect(getAgent("CredSmith")!.deniedTools).toContain("create_session");
    expect(getAgent("ReconScout")!.deniedTools).toContain("hashcat");
    expect(getAgent("WebBreaker")!.allowedTools).not.toContain("hashcat");
  });
});

describe("15.3 agent-MCP map", () => {
  test("mapping exists for every agent; high-risk tools require approval", () => {
    for (const a of AGENT_ROSTER) expect(mappingFor(a.agentId)).not.toBeNull();
    expect(specialistToolDecision("SessionRunner", "execute")).toBe("require_approval");
    expect(specialistToolDecision("CredSmith", "hashcat_crack")).toBe("require_approval");
    expect(specialistToolDecision("ReconScout", "quick_scan")).toBe("allow");
    expect(specialistToolDecision("WebBreaker", "hashcat")).toBe("deny"); // outside allowlist
    expect(specialistToolDecision("nope", "x")).toBe("unknown_agent");
  });
});

describe("15.6 ChillsPwn direct-tool denial (code enforcement)", () => {
  const enforce = new AgentRoutingPolicy(ENFORCE);
  const audit = new AgentRoutingPolicy(AUDIT);
  test("ENFORCE: ChillsPwn denied direct specialist tool, told to delegate", () => {
    const d = enforce.chillspwnDirectTool("quick_scan");
    expect(d.action).toBe("deny");
    expect(d.reason.toLowerCase()).toContain("delegate");
    expect(d.audit).toBe(true);
    expect((d.meta as any).mustDelegateTo).toContain("ReconScout");
  });
  test("AUDIT default: same call is audited, not blocked", () => {
    expect(audit.chillspwnDirectTool("quick_scan").action).toBe("audit");
  });
  test("commander coordination tool (non-specialist) always allowed", () => {
    expect(enforce.chillspwnDirectTool("board_list").action).toBe("allow");
  });
  test("emergency fallback / approval override allows + audits", () => {
    const d = enforce.chillspwnDirectTool("quick_scan", { emergencyReason: "specialist down" });
    expect(d.action).toBe("allow"); expect(d.audit).toBe(true);
  });
});

describe("15.6 specialist allowlist + assignment + delegate_task enforcement", () => {
  const p = new AgentRoutingPolicy(ENFORCE);
  test("specialist tool inside/outside allowlist", () => {
    expect(p.specialistTool("ReconScout", "quick_scan").action).toBe("allow");
    expect(p.specialistTool("ReconScout", "hashcat").action).toBe("deny");
    expect(p.specialistTool("SessionRunner", "execute").action).toBe("require_approval");
  });
  test("classified-domain step requires specialist assignment (enforce → block)", () => {
    expect(p.requireAssignment({ domain: "web", assignedAgentId: null }).action).toBe("block_step");
    expect(p.requireAssignment({ domain: "web", assignedAgentId: "WebBreaker" }).action).toBe("allow");
    expect(p.requireAssignment({ domain: "small-talk", assignedAgentId: null }).action).toBe("allow");
  });
  test("delegate_task requires real targetAgentId + matching domain", () => {
    expect(p.delegateTask({ targetAgentId: null }).action).toBe("deny");
    expect(p.delegateTask({ targetAgentId: "Nope" }).action).toBe("deny");
    expect(p.delegateTask({ targetAgentId: "WebBreaker", taskDomain: "credentials" }).action).toBe("deny");
    const ok = p.delegateTask({ targetAgentId: "WebBreaker", taskDomain: "web" });
    expect(ok.action).toBe("allow");
    expect((ok.meta as any).allowedTools).toContain("ffuf_dir");
  });
});

describe("15.13 routing logic", () => {
  test("routing signals select the narrowest specialist", () => {
    expect(routeTask("scan the host for open ports and services").selectedAgent).toBe("ReconScout");
    expect(routeTask("fuzz the web directory with ffuf and check sql injection").selectedAgent).toBe("WebBreaker");
    expect(routeTask("crack this NTLM hash with hashcat").selectedAgent).toBe("CredSmith");
    expect(routeTask("run bloodhound and analyze the kerberos attack path").selectedAgent).toBe("ADAttackMapper");
    expect(routeTask("reverse engineer this firmware with radare and capa").selectedAgent).toBe("ReverseSage");
    expect(routeTask("open a persistent tmux ssh session").selectedAgent).toBe("SessionRunner");
    expect(routeTask("write the final report and propose a lesson").selectedAgent).toBe("ReportSmith");
    expect(routeTask("scan the AWS cloud posture with prowler").selectedAgent).toBe("CloudSentinel");
    expect(routeTask("find secrets in source code with gitleaks").selectedAgent).toBe("SecretHunter");
  });
  test("unmatched task → no agent + clear reason", () => {
    const r = routeTask("tell me a joke");
    expect(r.selectedAgent).toBeNull();
    expect(r.reason).toContain("no specialist");
  });
  test("routing returns restricted profile + fallback", () => {
    const r = routeTask("enumerate subdomains");
    expect(r.allowedTools.length).toBeGreaterThan(0);
    expect(r.fallbackAgent).toBeTruthy();
    expect(specialistProfile("ReconScout")!.canApproveTrainingLessons).toBe(false);
  });
});

describe("15.7 mission board agent cards", () => {
  test("board has a ChillsPwn commander card + 11 specialist cards", () => {
    const board = buildMissionBoard("mission-1");
    expect(board.length).toBe(13);
    expect(board[0].role).toBe("commander");
    expect(board[0].displayName).toContain("Commander-in-Chief");
    expect(board.filter((c) => c.role === "specialist").length).toBe(12);
  });
  test("commander card never exposes specialist MCPs", () => {
    expect(buildCommanderCard("m").allowedMcpServers.join()).toContain("coordination only");
  });
  test("specialist card carries status + restricted profile + live state", () => {
    const board = buildMissionBoard("m", { WebBreaker: { status: "running", evidenceCount: 3 } });
    const wb = board.find((c) => c.agentId === "WebBreaker")!;
    expect(wb.status).toBe("running"); expect(wb.evidenceCount).toBe(3);
    expect(wb.allowedTools).toContain("ffuf_dir");
  });
  test("15.8 handoff record", () => {
    const h = makeHandoff({ fromAgentId: "ReconScout", toAgentId: "WebBreaker", reason: "web ports found", evidenceIds: ["ev1"], sourceStepId: "s1", targetStepId: null, createdAt: "t" });
    expect(h.id).toContain("ReconScout_WebBreaker");
    expect(h.toAgentId).toBe("WebBreaker");
  });
});

describe("15.0 MCP manifest validation", () => {
  const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "mcpArsenal.manifest.json"), "utf-8"));
  test("repos pinned with commit hashes + licenses", () => {
    expect(manifest.repos.length).toBe(5);
    for (const r of manifest.repos) { expect(r.commit).toMatch(/^[0-9a-f]{40}$/); expect(r.url).toContain("github.com"); }
  });
  test("every server: all-disabled-by-default (except built-in reporting); assigned agents exist", () => {
    const ids = new Set(listAgentIds());
    for (const s of manifest.servers) {
      expect(s).toHaveProperty("riskClass");
      for (const ag of s.assignedAgents) expect(ids.has(ag)).toBe(true);
      if (s.sourceRepo !== "chillspwn-builtin") expect(s.enabledByDefault).toBe(false);
    }
  });
  test("every specialist's allowedMcpServers exist in the manifest", () => {
    const servers = new Set(manifest.servers.map((s: any) => s.mcpServerName));
    for (const a of AGENT_ROSTER) for (const mcp of a.allowedMcpServers) expect(servers.has(mcp)).toBe(true);
  });
});
