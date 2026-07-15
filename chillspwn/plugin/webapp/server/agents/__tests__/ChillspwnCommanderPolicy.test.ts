/**
 * Phase 18 — Hard Delegation Enforcement / ChillsPwn No-Hands Commander.
 * Tests the 17 cases from the spec (Part 10) against ChillspwnCommanderPolicy + AgentRoutingPolicy.
 */
import { test, expect, describe } from "bun:test";
import {
  evaluateCommanderTool, recommendSpecialist, isCommander, commanderMayUseTool,
  isManagedMissionPrompt, COMMANDER_BLOCKED_EXEC_TOOLS,
} from "../ChillspwnCommanderPolicy";
import { AgentRoutingPolicy } from "../AgentRoutingPolicy";
import { isSpecialistTool, getAgent } from "../agentRoster";

const NO_HANDS = { enforceChillspwnNoHands: true, enableSpecialistRouting: true };
const ROLLBACK = { enforceChillspwnNoHands: false, enableSpecialistRouting: true };
const GATE_ENFORCE = { enableSpecialistRouting: true, enforceChillspwnDelegation: true, allowChillspwnDirectTools: false, requireSpecialistAssignment: true, enforceChillspwnNoHands: true };

const deny = (tool: string, cmd?: string) => evaluateCommanderTool("chillspwn", tool, cmd ?? null, NO_HANDS);

describe("Phase 18 — no-hands commander core denials", () => {
  test("1. ChillsPwn terminal denied", () => {
    const d = deny("terminal", "id");
    expect(d.action).toBe("deny");
    expect(d.recommendedSpecialist).toBeDefined();
  });
  test("2. ChillsPwn execute_code denied", () => {
    expect(deny("execute_code", "import os").action).toBe("deny");
  });
  test("3. ChillsPwn mcp_execute denied", () => {
    expect(deny("mcp_execute").action).toBe("deny");
    expect(COMMANDER_BLOCKED_EXEC_TOOLS.has("mcp_execute")).toBe(true);
  });
  test("process is also a blocked execution tool", () => {
    expect(deny("process").action).toBe("deny");
  });
  test("mutations, private delegation, and research tools are blocked", () => {
    for (const tool of ["write_file", "patch", "delegate_task", "remember", "skill_manage", "web_search", "web_extract"]) {
      expect(deny(tool).action).toBe("deny");
      expect(COMMANDER_BLOCKED_EXEC_TOOLS.has(tool)).toBe(true);
    }
  });
});

describe("Phase 18 — blocked commands route to the right specialist (Part 6)", () => {
  test("4. certipy/impacket/nxc → ADAttackMapper", () => {
    for (const c of ["certipy find -dc-ip 10.0.0.1", "impacket-secretsdump u/p@dc", "nxc smb 10.0.0.1", "getuserspns.py", "bloodhound-python -d corp"]) {
      const d = deny("terminal", c);
      expect(d.action).toBe("deny");
      expect(d.recommendedSpecialist?.agentId).toBe("ADAttackMapper");
    }
  });
  test("5. nmap → ReconScout", () => {
    expect(deny("terminal", "nmap -sCV 192.0.2.25").recommendedSpecialist?.agentId).toBe("ReconScout");
    expect(deny("terminal", "masscan -p1-65535 192.0.2.25").recommendedSpecialist?.agentId).toBe("ReconScout");
  });
  test("6. ffuf/gobuster → WebBreaker", () => {
    expect(deny("terminal", "ffuf -w w -u http://x/FUZZ").recommendedSpecialist?.agentId).toBe("WebBreaker");
    expect(deny("terminal", "gobuster dir -u http://x").recommendedSpecialist?.agentId).toBe("WebBreaker");
    expect(deny("terminal", "sqlmap -u http://x?id=1").recommendedSpecialist?.agentId).toBe("WebBreaker");
  });
  test("7. hashcat/john → CredSmith", () => {
    expect(deny("terminal", "hashcat -m 1000 h rockyou").recommendedSpecialist?.agentId).toBe("CredSmith");
    expect(deny("terminal", "john --wordlist=rockyou h").recommendedSpecialist?.agentId).toBe("CredSmith");
  });
  test("8. shell/tmux/ssh/socks → SessionRunner", () => {
    expect(deny("terminal", "ls -la").recommendedSpecialist?.agentId).toBe("SessionRunner"); // raw shell, no signal
    expect(deny("terminal", "ssh user@10.0.0.1").recommendedSpecialist?.agentId).toBe("SessionRunner");
    expect(deny("terminal", "tmux new -s s").recommendedSpecialist?.agentId).toBe("SessionRunner");
    expect(deny("terminal", "proxychains -q nc 10.0.0.1 1080").recommendedSpecialist?.agentId).toBe("SessionRunner");
  });
});

describe("Phase 18 — delegate_task enforcement (Part 5)", () => {
  const policy = new AgentRoutingPolicy(GATE_ENFORCE);
  test("9. delegate_task without targetAgentId denied", () => {
    expect(policy.delegateTask({ targetAgentId: null }).action).toBe("deny");
    expect(policy.delegateTask({ targetAgentId: "" }).action).toBe("deny");
  });
  test("10. delegate_task wrong specialist denied", () => {
    // recon task handed to CredSmith → domain mismatch → deny
    expect(policy.delegateTask({ targetAgentId: "CredSmith", taskDomain: "reconnaissance" }).action).toBe("deny");
    // unknown agent → deny
    expect(policy.delegateTask({ targetAgentId: "Nobody" }).action).toBe("deny");
  });
  test("11. delegate_task correct specialist allowed", () => {
    expect(policy.delegateTask({ targetAgentId: "ReconScout", taskDomain: "reconnaissance" }).action).toBe("allow");
    expect(policy.delegateTask({ targetAgentId: "ADAttackMapper", taskDomain: "active_directory" }).action).toBe("allow");
    expect(policy.delegateTask({ targetAgentId: "ReconScout" }).action).toBe("allow"); // no domain asserted → allow
  });
});

describe("Phase 18 — approval mode cannot bypass (Part 7)", () => {
  test("12. no-hands deny is a hard DENY, never require_approval (auto-approve can't grant it)", () => {
    const d = deny("terminal", "certipy");
    expect(d.action).toBe("deny");
    // there is no 'require_approval' path for a commander exec tool → auto-approve has nothing to grant
    expect(["allow", "deny"]).toContain(d.action);
    expect(d.action).not.toBe("require_approval" as any);
  });
});

describe("Phase 18 — chat + managed enforcement parity (Parts 3, 14)", () => {
  test("13. chat-session classification blocks terminal/execute_code for ChillsPwn", () => {
    // the orchestrator mirrors this exact classification for chat sessions
    expect(deny("terminal").action).toBe("deny");
    expect(deny("execute_code").action).toBe("deny");
  });
  test("14. managed-run gate (AgentRoutingPolicy.commanderNoHands) denies the same", () => {
    const policy = new AgentRoutingPolicy(GATE_ENFORCE);
    expect(policy.isCommanderActor("ChillsPwn")).toBe(true);
    expect(policy.commanderNoHands("ChillsPwn", "terminal", "nmap").action).toBe("deny");
    expect(policy.commanderNoHands("ChillsPwn", "execute_code", "x").action).toBe("deny");
  });
});

describe("Phase 18 — specialists unaffected (Parts 15, 16)", () => {
  const policy = new AgentRoutingPolicy(GATE_ENFORCE);
  test("15. specialist allowed tool still works", () => {
    // ReconScout owns nmap; SessionRunner owns terminal/execute (Phase 18)
    expect(policy.specialistTool("ReconScout", "nmap").action).not.toBe("deny");
    expect(policy.specialistTool("SessionRunner", "terminal").action).not.toBe("deny");
    // specialists are NOT the commander → no-hands does not touch them
    expect(evaluateCommanderTool("ReconScout", "terminal", "nmap", NO_HANDS).action).toBe("allow");
  });
  test("16. specialist out-of-allowlist still denied", () => {
    // ReconScout does not own hashcat
    expect(policy.specialistTool("ReconScout", "hashcat").action).toBe("deny");
    // CredSmith does not own nmap
    expect(policy.specialistTool("CredSmith", "nmap").action).toBe("deny");
  });
});

describe("Phase 18 — HTB mission detection (Part 4) + rollback + coordination-safe", () => {
  test("17. HTB mission prompt detected as managed specialist mission", () => {
    expect(isManagedMissionPrompt("Assess the authorized lab target at 192.0.2.25 and retrieve its proof files")).toBe(true);
    expect(isManagedMissionPrompt("Hack The Box authorized lab engagement")).toBe(true);
    expect(isManagedMissionPrompt("what's the weather like today?")).toBe(false);
    expect(isManagedMissionPrompt("help me write a python script to parse CSV")).toBe(false);
  });
  test("coordination tools allowed for the commander (plan/route/synthesize)", () => {
    for (const t of ["board_create_task", "board_update", "board_list", "read_file", "search_files", "recall_conversation", "use_skill", "board_await"]) {
      expect(commanderMayUseTool("chillspwn", t, NO_HANDS)).toBe(true);
    }
  });
  test("rollback: ENFORCE_CHILLSPWN_NO_HANDS=false re-allows direct execution", () => {
    expect(evaluateCommanderTool("chillspwn", "terminal", "nmap", ROLLBACK).action).toBe("allow");
  });
  test("isCommander matches the documented persona aliases", () => {
    for (const c of ["chillspwn", "ChillsPwn", "commander", "commander-in-chief", "orchestrator"]) expect(isCommander(c)).toBe(true);
    for (const s of ["ReconScout", "WebBreaker", "coder", ""]) expect(isCommander(s)).toBe(false);
  });
  test("generic tools are not specialist tools (regression for ReconScout allowlist pollution)", () => {
    for (const g of ["read_file", "write_file", "search_files", "use_skill", "recall_conversation", "terminal", "execute_code"]) {
      expect(isSpecialistTool(g)).toBe(false);
    }
    // real domain tools still are
    expect(isSpecialistTool("hashcat_crack")).toBe(true);
    expect(isSpecialistTool("bloodhound_collect")).toBe(true);
  });
});
