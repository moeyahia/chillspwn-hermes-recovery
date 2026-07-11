#!/usr/bin/env bun
/**
 * Training-memory cleanup / migration tool (8.2). SAFE BY DEFAULT — dry-run reports only.
 *
 * Audits existing runtime memory, classifies every entry (verified_attack_lesson_candidate /
 * hypothesis / raw_note / target_specific_secret / stale / unknown), and (per mode) quarantines
 * untrusted entries, promotes provenance-backed candidates to PROPOSED attack lessons (operator
 * must still approve), or — only with --confirm-delete — hard-deletes. Hypotheses are never
 * blindly erased; they are marked/quarantined and excluded from planning.
 *
 * Usage:
 *   bun scripts/training-memory-cleanup.ts                 # dry-run (default) — report only
 *   bun scripts/training-memory-cleanup.ts --mode=quarantine
 *   bun scripts/training-memory-cleanup.ts --mode=promote
 *   bun scripts/training-memory-cleanup.ts --mode=delete --confirm-delete   # DANGEROUS
 */
import { resolve, join } from "path";
import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { MemoryStore } from "../server/runtime/MemoryStore";
import { MemoryService } from "../server/runtime/MemoryService";
import { TrainingMemoryStore } from "../server/runtime/TrainingMemoryStore";
import { TrainingMemoryService } from "../server/runtime/TrainingMemoryService";
import { EventLog } from "../server/runtime/EventLog";
import { planCleanup, type CleanupMode } from "../server/runtime/MemoryCleanup";
import type { MemoryItem } from "../server/runtime/types";

const args = process.argv.slice(2);
const modeArg = (args.find((a) => a.startsWith("--mode=")) || "--mode=dry-run").split("=")[1] as CleanupMode;
const mode: CleanupMode = ["dry-run", "quarantine", "promote", "delete"].includes(modeArg) ? modeArg : "dry-run";
const confirmDelete = args.includes("--confirm-delete");
// 15.12 filters
const argVal = (k: string): string | undefined => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const lessonFilters = { agent: argVal("agent"), scope: argVal("scope"), category: argVal("category") };

const RUNTIME_DIR = resolve(process.env.HOME || "/root", ".claude/chillspwn", "runtime");
const events = new EventLog({ dir: RUNTIME_DIR });
const memStore = new MemoryStore(RUNTIME_DIR);
const memSvc = new MemoryService(memStore, events);
const trainStore = new TrainingMemoryStore(RUNTIME_DIR);
const trainSvc = new TrainingMemoryService(trainStore, events);

// 15.12 — per-agent / per-scope / per-category TRAINING LESSON summary (dry-run, never mutates).
import { summarizeLessons } from "../server/runtime/MemoryCleanup";
function printLessonSummary() {
  const s = summarizeLessons(trainStore.list(), lessonFilters);
  const f = [lessonFilters.agent && `agent=${lessonFilters.agent}`, lessonFilters.scope && `scope=${lessonFilters.scope}`, lessonFilters.category && `category=${lessonFilters.category}`].filter(Boolean).join(" ");
  console.log(`\n=== TRAINING LESSONS summary${f ? " [" + f + "]" : ""} — ${s.total} lesson(s) (read-only) ===`);
  for (const [agent, c] of Object.entries(s.byAgent)) {
    console.log(`  ${agent}: proposed=${c.proposed} verified=${c.verified} failed_attempts=${c.failed_attempts} rejected=${c.rejected} stale=${c.stale} promotion_candidates=${c.promotion_candidates} secret_bearing=${c.secret_bearing}`);
  }
  if (!s.total) console.log("  (no lessons match the filter)");
}

const items: MemoryItem[] = memSvc.listMemoryItems();
const plan = planCleanup(items, mode);

console.log(`\n=== Training-memory cleanup — mode=${mode}${mode === "delete" ? (confirmDelete ? " (CONFIRMED)" : " (NOT confirmed — will NOT delete)") : ""} ===`);
console.log(`scanned ${items.length} memory item(s) in ${RUNTIME_DIR}`);
console.log("classification:");
for (const [cat, n] of Object.entries(plan.counts)) if (n) console.log(`  ${cat}: ${n}`);

if (mode === "dry-run") {
  console.log("\nDRY RUN — no mutation. Sample actions that WOULD be taken in other modes:");
  for (const a of plan.actions.slice(0, 30)) console.log(`  [${a.category}] ${a.id} — ${a.reason}`);
  console.log("\nRun with --mode=quarantine (mark untrusted), --mode=promote (seed lessons), or --mode=delete --confirm-delete.");
  console.log("Filters (lessons): --agent=<id> --scope=<agent|mission|lab|project|global> --category=<verified_attack_lesson|failed_attempt_lesson|hypothesis>");
  printLessonSummary();
  process.exit(0);
}

let rejected = 0, promoted = 0, deleted = 0;
const deleteIds = new Set<string>();
for (const a of plan.actions) {
  try {
    if (a.action === "mark_rejected") { memSvc.rejectMemory(a.id, `cleanup: ${a.reason}`); rejected++; }
    else if (a.action === "mark_stale") { memSvc.markStale(a.id); rejected++; }
    else if (a.action === "promote_candidate") {
      const it = items.find((x) => x.id === a.id)!;
      trainSvc.proposeLesson({
        title: it.content.slice(0, 80),
        techniqueName: it.content.slice(0, 60),
        techniqueCategory: "recon", // placeholder — operator must enrich + approve
        summary: it.content,
        evidenceIds: it.sourceEvidenceId ? [it.sourceEvidenceId] : [],
        sourceRunId: it.sourceAgentRunId,
        sourceStepIds: it.sourceStepId ? [it.sourceStepId] : [],
        scope: "lab",
      });
      promoted++;
    } else if (a.action === "delete" && confirmDelete) {
      deleteIds.add(a.id);
    }
  } catch (e: any) {
    console.log(`  ! skip ${a.id}: ${e.message}`);
  }
}

if (deleteIds.size && confirmDelete) {
  // Hard delete: rewrite items.json without the deleted ids (atomic).
  const path = join(RUNTIME_DIR, "memory", "items.json");
  if (existsSync(path)) {
    const all = JSON.parse(readFileSync(path, "utf-8")) as MemoryItem[];
    const kept = all.filter((x) => !deleteIds.has(x.id));
    deleted = all.length - kept.length;
    const tmp = path + ".tmp";
    writeFileSync(tmp, JSON.stringify(kept, null, 2));
    renameSync(tmp, path);
  }
}

console.log(`\napplied: rejected/marked=${rejected} promoted(proposed lessons)=${promoted} deleted=${deleted}`);
if (mode === "delete" && !confirmDelete) console.log("NOTE: delete mode requires --confirm-delete; nothing was deleted.");
