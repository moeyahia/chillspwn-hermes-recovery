#!/usr/bin/env bun
/**
 * analyze-session-ledger.ts (Phase 18, Part 11) — analyze a ChillsPwn session ledger for the
 * delegation-enforcement gap: how much did the COMMANDER execute directly vs delegate?
 *
 * Reports, per the spec:
 *   - direct `terminal` count by actor
 *   - direct `execute_code` count by actor
 *   - `delegate_task` count
 *   - specialist-tool count
 *   - ChillsPwn direct-execution VIOLATIONS (with the specialist each should have gone to)
 *   - recommended fixes
 *
 * Pure read-only. Reuses ChillspwnCommanderPolicy so "what counts as a violation" is the SAME
 * classification the runtime enforces. Run BEFORE enforcement (to measure the gap) and AFTER (to
 * confirm 0 commander direct-execution violations on new sessions).
 *
 *   bun scripts/analyze-session-ledger.ts <ledger.json> [--actor <persona>] [--json]
 *   bun scripts/analyze-session-ledger.ts /home/chillspwn/.claude/chillspwn/sessions/s-XXXX.json.ledger.json
 */

import { readFileSync, existsSync } from "node:fs";
import { evaluateCommanderTool, isCommander, recommendSpecialist, COMMANDER_BLOCKED_EXEC_TOOLS } from "../server/agents/ChillspwnCommanderPolicy";
import { isSpecialistTool } from "../server/agents/agentRoster";

interface LedgerEntry { tool?: string; command?: string; action?: string; type?: string; args?: any; input?: any; params?: any; agent?: string; actor?: string; persona?: string }

function loadEntries(path: string): LedgerEntry[] {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (Array.isArray(raw)) return raw;
  return raw.entries || raw.actions || raw.ledger || [];
}

/** Best-effort actor for the ledger: explicit flag → session-file persona → "chillspwn" default. */
function resolveActor(ledgerPath: string, override?: string): string {
  if (override) return override;
  // ledger path is "<session>.json.ledger.json" or "<session>.ledger.json"; try the sibling session file.
  for (const cand of [ledgerPath.replace(/\.ledger\.json$/, ""), ledgerPath.replace(/\.json\.ledger\.json$/, ".json")]) {
    if (cand !== ledgerPath && existsSync(cand)) {
      try { const p = JSON.parse(readFileSync(cand, "utf8")).persona; if (typeof p === "string" && p) return p; } catch { /* ignore */ }
    }
  }
  return "chillspwn";
}

function entryTool(e: LedgerEntry): string { return String(e.tool || e.action || e.type || ""); }
function entryCommand(e: LedgerEntry): string {
  const a = e.args || e.input || e.params || {};
  if (typeof e.command === "string") return e.command;
  if (a && typeof a === "object") return String(a.command || a.code || a.cmd || "");
  return "";
}

function main() {
  const args = process.argv.slice(2);
  const ledgerPath = args.find((a) => !a.startsWith("--"));
  const actorOverride = args.includes("--actor") ? args[args.indexOf("--actor") + 1] : undefined;
  const asJson = args.includes("--json");
  if (!ledgerPath || !existsSync(ledgerPath)) {
    console.error("usage: bun scripts/analyze-session-ledger.ts <ledger.json> [--actor <persona>] [--json]");
    process.exit(2);
  }

  const entries = loadEntries(ledgerPath);
  const actor = resolveActor(ledgerPath, actorOverride);
  const commander = isCommander(actor);
  const cfg = { enforceChillspwnNoHands: true, enableSpecialistRouting: true };

  const byTool: Record<string, number> = {};
  let terminalCount = 0, execCount = 0, processCount = 0, mcpExecCount = 0, delegateCount = 0, boardCreateCount = 0, specialistToolCount = 0;
  const violations: Array<{ tool: string; command: string; recommend: string; domain: string }> = [];

  for (const e of entries) {
    const tool = entryTool(e);
    if (!tool) continue;
    byTool[tool] = (byTool[tool] || 0) + 1;
    if (tool === "terminal") terminalCount++;
    if (tool === "execute_code") execCount++;
    if (tool === "process") processCount++;
    if (tool === "mcp_execute") mcpExecCount++;
    if (tool === "delegate_task") delegateCount++;
    if (tool === "board_create_task") boardCreateCount++;
    if (isSpecialistTool(tool)) specialistToolCount++;

    // A VIOLATION = the commander used a tool the no-hands policy would deny.
    if (commander) {
      const command = entryCommand(e);
      const d = evaluateCommanderTool(actor, tool, command, cfg);
      if (d.action === "deny") {
        const rec = d.recommendedSpecialist || recommendSpecialist(tool, command);
        violations.push({ tool, command: command.slice(0, 80), recommend: rec.agentId, domain: rec.domain });
      }
    }
  }

  const delegations = delegateCount + boardCreateCount;
  const directExec = terminalCount + execCount + processCount + mcpExecCount;
  const byRecommend: Record<string, number> = {};
  for (const v of violations) byRecommend[v.recommend] = (byRecommend[v.recommend] || 0) + 1;

  const report = {
    ledger: ledgerPath,
    actor,
    isCommander: commander,
    totalEntries: entries.length,
    counts: { terminal: terminalCount, execute_code: execCount, process: processCount, mcp_execute: mcpExecCount,
      delegate_task: delegateCount, board_create_task: boardCreateCount, specialistTools: specialistToolCount },
    directExecution: directExec,
    delegations,
    delegationRatio: directExec ? Number((delegations / directExec).toFixed(3)) : null,
    commanderViolations: commander ? violations.length : 0,
    violationsBySpecialist: byRecommend,
    verdict: !commander ? "actor is not the commander — no-hands rule N/A"
      : violations.length === 0 ? "PASS — 0 commander direct-execution violations"
      : `FAIL — ${violations.length} commander direct-execution violations (would be DENIED + routed under Phase 18)`,
  };

  if (asJson) { console.log(JSON.stringify({ ...report, violations }, null, 2)); return; }

  console.log(`\n=== Session ledger analysis — Phase 18 no-hands ===`);
  console.log(`ledger:        ${ledgerPath}`);
  console.log(`actor:         ${actor}  ${commander ? "(COMMANDER — no-hands subject)" : "(specialist/other)"}`);
  console.log(`entries:       ${entries.length}`);
  console.log(`\n-- tool counts --`);
  for (const [t, c] of Object.entries(byTool).sort((a, b) => b[1] - a[1]).slice(0, 18)) {
    const flag = COMMANDER_BLOCKED_EXEC_TOOLS.has(t) ? "  ⛔ exec" : isSpecialistTool(t) ? "  ⛔ specialist" : "";
    console.log(`   ${t.padEnd(22)} x${String(c).padStart(4)}${flag}`);
  }
  console.log(`\n-- delegation vs direct execution --`);
  console.log(`   direct execution (terminal/execute_code/process/mcp_execute): ${directExec}`);
  console.log(`   delegations (delegate_task + board_create_task):              ${delegations}`);
  console.log(`   ratio delegations:direct = ${report.delegationRatio ?? "n/a"}`);
  if (commander) {
    console.log(`\n-- commander direct-execution VIOLATIONS: ${violations.length} --`);
    if (violations.length) {
      console.log(`   should have been routed to:`);
      for (const [agent, c] of Object.entries(byRecommend).sort((a, b) => b[1] - a[1])) console.log(`     ${agent.padEnd(18)} ${c}`);
      console.log(`   sample:`);
      for (const v of violations.slice(0, 8)) console.log(`     ${v.tool.padEnd(13)} → ${v.recommend.padEnd(16)} ${v.command ? "$ " + v.command : ""}`);
    }
  }
  console.log(`\n-- recommended fixes --`);
  if (!commander) {
    console.log(`   • Actor is not the commander; no-hands rule does not apply.`);
  } else if (violations.length) {
    console.log(`   • Enable ENFORCE_CHILLSPWN_NO_HANDS=true (default in Phase 18): these ${violations.length} direct`);
    console.log(`     executions would be DENIED at the gate + orchestrator and converted to specialist tasks.`);
    console.log(`   • Ensure the target specialists exist and own the execution tools (SessionRunner has`);
    console.log(`     terminal/execute_code/process; ReconScout/WebBreaker/etc. own their domain tools).`);
    console.log(`   • Re-run this analyzer on a NEW session after enforcement — expect 0 violations.`);
  } else {
    console.log(`   • None — commander executed nothing directly. ✅`);
  }
  console.log(`\nVERDICT: ${report.verdict}\n`);
}

main();
