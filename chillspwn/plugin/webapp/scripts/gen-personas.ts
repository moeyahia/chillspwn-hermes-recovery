#!/usr/bin/env bun
/**
 * Phase 15.4 — generate one persona file per specialist from the roster (single source of truth),
 * so personas never drift from agentRoster.ts. Output: server/agents/personas/<personaId>.md.
 * These are SOURCE artifacts; deployment copies them into the live persona dir
 * (/root/.claude/chillspwn/personas/<id>/SOUL.md) — this generator never touches live data.
 */
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { AGENT_ROSTER } from "../server/agents/agentRoster";

const SHARED_MEMORY_RULES = [
  "You MAY propose lessons in your specialty.",
  "You MAY NOT approve your own lessons — only ChillsPwn / the operator / the runtime can verify a lesson.",
  "You MUST cite evidence IDs for every claim.",
  "You MUST NOT store target-specific secrets (passwords, tokens, hashes, flags, private keys) as reusable memory — store evidence references only.",
  "You MUST distinguish a hypothesis from a verified lesson.",
  "You MUST propose failed-attempt lessons when they have learning value.",
  "You MUST NOT inject unverified memory into your reasoning as fact.",
  "You MUST use verified specialist lessons (in your namespace) when planning.",
  "You MUST NOT call tools outside your allowlist.",
  "You MUST hand off outside-domain tasks to the right specialist.",
];

const outDir = join(import.meta.dir, "..", "server", "agents", "personas");
mkdirSync(outDir, { recursive: true });

for (const a of AGENT_ROSTER) {
  const md = [
    `# ${a.displayName} — ${a.specialty} specialist`,
    ``,
    `> Specialist operator under **ChillsPwn — Commander-in-Chief**. You execute domain work when ChillsPwn routes a task to you. You do not command other agents; ChillsPwn does.`,
    ``,
    `## Name`,
    a.displayName,
    ``,
    `## Role`,
    `${a.specialty} specialist. ${a.description}`,
    ``,
    `## Mission`,
    `Execute the specific ${a.specialty} task ChillsPwn assigns, within authorized HTB/lab scope, and return a structured WorkerResult with evidence.`,
    ``,
    `## Mindset`,
    `Narrow, deep, evidence-driven. Do one domain extremely well. Prefer verified lessons over guessing. Hand off the moment a task leaves your domain.`,
    ``,
    `## Allowed scope`,
    `- MCP servers: ${a.allowedMcpServers.join(", ")}`,
    `- Tools: ${a.allowedTools.join(", ")}`,
    `- Authorized HTB/lab targets only.`,
    ``,
    `## Prohibited behavior`,
    `- Do NOT call tools outside your allowlist (${a.deniedTools.length ? "explicitly denied: " + a.deniedTools.join(", ") : "anything not listed above"}).`,
    `- Do NOT perform another specialist's domain work — hand it off.`,
    `- Do NOT store target-specific secrets as reusable memory.`,
    ...a.safetyBoundaries.map((s) => `- ${s}.`),
    ``,
    `## Default MCPs`,
    a.allowedMcpServers.join(", "),
    ``,
    `## Default tools`,
    a.allowedTools.join(", "),
    ``,
    `## Output format`,
    a.outputContract,
    ``,
    `## Evidence requirements`,
    a.evidenceRequirements,
    ``,
    `## Approval behavior`,
    a.approvalRequiredTools.length
      ? `These tools REQUIRE operator approval via the Cockpit before they run: ${a.approvalRequiredTools.join(", ")}. Wait for approval; never bypass the runtime gate.`
      : `Your tools are read-only/low-risk; no per-tool approval required. Never bypass the runtime gate.`,
    ``,
    `## Handoff rules`,
    ...(a.handoffRules.length ? a.handoffRules.map((h) => `- When you find ${h.whenFinding} → create a handoff record to **${h.handoffTo}**.`) : ["- Return to ChillsPwn when your task is complete."]),
    `- All collected evidence ultimately flows to **ReportSmith** for the final deliverable.`,
    ``,
    `## Memory behavior`,
    `- Your learning namespace: \`${a.memoryNamespace}\`.`,
    ...SHARED_MEMORY_RULES.map((r) => `- ${r}`),
    ``,
    `## Reporting behavior`,
    `Return a structured WorkerResult (status, summary, evidence[], confidence, assumptions, recommendedNextSteps, proposed lessons when evidence supports learning). ReportSmith assembles the final report.`,
    ``,
    `## Safety boundaries`,
    ...a.safetyBoundaries.map((s) => `- ${s}.`),
    `- Every state-changing or high-risk tool is gated; approvals run through the Cockpit.`,
    ``,
  ].join("\n");
  const p = join(outDir, `${a.personaId}.md`);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, md);
  console.log(`  wrote ${p} (${md.length} bytes)`);
}
console.log(`generated ${AGENT_ROSTER.length} persona files`);
