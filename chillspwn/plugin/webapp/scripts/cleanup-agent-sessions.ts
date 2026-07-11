#!/usr/bin/env bun
/**
 * cleanup-agent-sessions.ts (Phase 19) — SAFE, non-destructive lifecycle maintenance for the session
 * store. Archives terminal GENERATED specialist sessions (the "Task: …" spam) so the active list stays
 * clean, and can restore them. NEVER deletes raw logs/evidence: "archive" only flips a flag + status
 * in the session JSON (reversible with --restore).
 *
 * Default is DRY-RUN. Mutations require --apply.
 *
 *   bun scripts/cleanup-agent-sessions.ts                         # dry-run, summarize candidates
 *   bun scripts/cleanup-agent-sessions.ts --archive-completed --apply
 *   bun scripts/cleanup-agent-sessions.ts --archive-completed --only-specialist --older-than 7d --apply
 *   bun scripts/cleanup-agent-sessions.ts --archive-completed --only-validation --apply
 *   bun scripts/cleanup-agent-sessions.ts --restore <sessionId> --apply
 *
 * Run as the `chillspwn` user (or root) so it can read/write the session files in place.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { classifySessionKind, isTerminalSession, type SessionLike } from "../server/agents/sessionLifecycle";

const ARGS = process.argv.slice(2);
function hasFlag(f: string): boolean { return ARGS.includes(f); }
function argVal(f: string): string | undefined { const i = ARGS.indexOf(f); return i >= 0 ? ARGS[i + 1] : undefined; }

function resolveSessionsDir(): string {
  const fromArg = argVal("--sessions-dir");
  if (fromArg) return fromArg;
  const candidates = [
    process.env.CHILLSPWN_HOME ? join(process.env.CHILLSPWN_HOME, "sessions") : "",
    "/home/chillspwn/.claude/chillspwn/sessions",
    join(process.env.HOME || "/root", ".claude/chillspwn/sessions"),
  ].filter(Boolean) as string[];
  return candidates.find((d) => existsSync(d)) || candidates[candidates.length - 1];
}

/** Parse 7d / 24h / 30m / 90s → milliseconds. */
function parseDuration(s: string | undefined): number | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d+)\s*([smhdw])$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = { s: 1e3, m: 6e4, h: 3.6e6, d: 8.64e7, w: 6.048e8 }[m[2]]!;
  return n * unit;
}

const VALIDATION_RE = /validation|no-?op|smoke[\s-]?test|\btest run\b|synthetic|sanity check/i;
function looksLikeValidation(s: SessionLike): boolean {
  return VALIDATION_RE.test(`${s.title || ""} ${s.preview || ""}`);
}

interface SessionFile {
  id: string; persona?: string; status?: string; title?: string; createdAt?: string;
  messages?: Array<{ role: string; content?: string; timestamp?: string }>;
  archived?: boolean; prevStatus?: string; archivedAt?: string;
  [k: string]: unknown;
}

function load(dir: string, file: string): SessionFile | null {
  try { return JSON.parse(readFileSync(join(dir, file), "utf8")); } catch { return null; }
}
function toLike(d: SessionFile): SessionLike {
  const firstUser = (d.messages || []).find((m) => m.role === "user");
  return { id: d.id, persona: d.persona, status: d.status, isLive: false, title: d.title, preview: (firstUser?.content || "").slice(0, 80) };
}
function lastActivityMs(d: SessionFile): number {
  const msgs = d.messages || [];
  const ts = msgs.length ? msgs[msgs.length - 1].timestamp : undefined;
  const v = Date.parse(ts || d.createdAt || "");
  return Number.isFinite(v) ? v : 0;
}

function main() {
  const dir = resolveSessionsDir();
  const apply = hasFlag("--apply");
  const archiveCompleted = hasFlag("--archive-completed");
  const onlySpecialist = hasFlag("--only-specialist");
  const onlyValidation = hasFlag("--only-validation");
  const restoreId = argVal("--restore");
  const olderThanMs = parseDuration(argVal("--older-than"));
  const nowArg = argVal("--now");                       // testability: pin "now" (epoch ms)
  const nowMs = nowArg ? parseInt(nowArg, 10) : Date.now();

  if (!existsSync(dir)) { console.error(`sessions dir not found: ${dir}`); process.exit(2); }
  const mode = apply ? "APPLY" : "DRY-RUN";
  console.log(`\n=== cleanup-agent-sessions — ${mode} ===`);
  console.log(`sessions dir: ${dir}`);

  // session files only — exclude ledgers / stdout sidecars (e.g. *.json.ledger.json, *.stdout.json).
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && !/\.(ledger|stdout)\.json$/.test(f) && !f.includes(".ledger."));

  // ----- RESTORE -----
  if (restoreId) {
    const file = files.find((f) => f === `${restoreId}.json` || f.replace(/\.json$/, "") === restoreId);
    if (!file) { console.error(`session not found: ${restoreId}`); process.exit(2); }
    const d = load(dir, file);
    if (!d) { console.error(`unreadable: ${file}`); process.exit(2); }
    if (!d.archived) { console.log(`'${restoreId}' is not archived — nothing to restore.`); return; }
    console.log(`restore ${restoreId}: status '${d.status}' -> '${d.prevStatus || "stopped"}', archived=false`);
    if (apply) {
      d.status = (d.prevStatus as string) || "stopped"; d.archived = false; delete d.prevStatus; delete d.archivedAt;
      writeFileSync(join(dir, file), JSON.stringify(d, null, 2));
      console.log("  restored");
    } else { console.log("  (dry-run — pass --apply to restore)"); }
    return;
  }

  // ----- ARCHIVE / SUMMARIZE -----
  let scanned = 0, eligible = 0, archivedN = 0, alreadyArchived = 0;
  const samples: string[] = [];
  for (const file of files) {
    const d = load(dir, file); if (!d) continue;
    scanned++;
    if (d.archived) { alreadyArchived++; continue; }
    const like = toLike(d);
    const kind = classifySessionKind(like);
    const terminal = isTerminalSession(like);

    // selection filters — only ever consider GENERATED specialist sessions that are terminal.
    if (kind !== "specialist") continue;                  // never touch real chats
    if (!terminal) continue;
    if (onlySpecialist && kind !== "specialist") continue;
    if (onlyValidation && !looksLikeValidation(like)) continue;
    if (olderThanMs !== null && (nowMs - lastActivityMs(d)) < olderThanMs) continue;

    eligible++;
    if (samples.length < 12) samples.push(`  ${kind.padEnd(10)} ${String(d.status).padEnd(10)} ${file}`);

    if (archiveCompleted && apply) {
      d.prevStatus = d.status; d.status = "archived"; d.archived = true; d.archivedAt = new Date(nowMs).toISOString();
      writeFileSync(join(dir, file), JSON.stringify(d, null, 2));
      archivedN++;
    }
  }

  console.log(`\nscanned: ${scanned}  already-archived: ${alreadyArchived}`);
  console.log(`eligible (terminal specialist sessions${onlyValidation ? ", validation-only" : ""}${olderThanMs !== null ? ", older-than filter" : ""}): ${eligible}`);
  if (samples.length) { console.log("sample:"); samples.forEach((s) => console.log(s)); }
  if (!archiveCompleted) {
    console.log("\nNo action flag given. Pass --archive-completed (with --apply) to archive these.");
  } else if (apply) {
    console.log(`\narchived ${archivedN} session(s). Reverse any with: --restore <sessionId> --apply`);
  } else {
    console.log(`\nDRY-RUN — would archive ${eligible} session(s). Re-run with --apply to execute. Nothing was changed.`);
  }
}

main();
