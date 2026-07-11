/**
 * AttackLesson (Phase 8–14.2 — HTB Training Memory) — the reusable TRAINING unit.
 *
 * The goal of authorized HTB/lab work is not just to solve a box: it is to distil VERIFIED,
 * evidence-backed attack lessons the agent can reuse. A lesson is distinct from:
 *   - raw evidence (a captured artifact — not knowledge),
 *   - a hypothesis (an untrusted guess — never reusable),
 *   - a generic finding (an observation about one target).
 *
 * Hard rules encoded here:
 *   - a lesson is `proposed` until an operator approves it (`verified`); the model can never
 *     self-promote a lesson to trusted;
 *   - target-specific SECRETS (flags, hashes, private keys, NTLM, credentials) must never be
 *     stored as reusable lesson content — they are rejected (flag/hash/key) or redacted
 *     (credential/token). Store evidence REFERENCES, not secrets.
 */

import { redactSecrets } from "./RunReport";

export const TECHNIQUE_CATEGORIES = [
  "recon", "web", "smb", "ldap", "active_directory", "kerberos", "winrm",
  "linux_privesc", "windows_privesc", "credentials", "pivoting",
  "post_exploitation", "defensive_detection",
] as const;
export type TechniqueCategory = (typeof TECHNIQUE_CATEGORIES)[number];

export const LESSON_STATUSES = ["proposed", "verified", "rejected", "stale"] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];

// 15.9: scopes ordered narrowest → broadest (agent < mission < lab < project < global).
export const LESSON_SCOPES = ["agent", "mission", "lab", "project", "global"] as const;
export type LessonScope = (typeof LESSON_SCOPES)[number];

/** Discriminator so a lesson is never confused with a generic MemoryItem finding/hypothesis. */
export const ATTACK_LESSON_CATEGORY = "verified_attack_lesson" as const;

// 15.10 + 17: lesson kinds. attack_lesson (default reusable) | failed_attempt (avoidance) | Phase-17
// strategy/intel lessons (describe STRATEGY/INTEL, never secrets/hashes/passwords/wordlists/exploit
// code). Strategy/intel lessons inject like reusable attack lessons (NOT the failed-attempt section).
export const LESSON_KINDS = ["attack_lesson", "failed_attempt", "wordlist_strategy_lesson", "hashcat_strategy_lesson", "vulnerability_intelligence_lesson"] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

export interface AttackLesson {
  id: string;
  category: typeof ATTACK_LESSON_CATEGORY;
  /** 15.10: attack_lesson (default) | failed_attempt (avoidance lesson). */
  kind: LessonKind;
  /** 15.9: owning specialist (e.g. "WebBreaker"), for agent-scoped memory. Absent ⇒ commander/global. */
  agentId?: string;
  title: string;
  techniqueName: string;
  techniqueCategory: TechniqueCategory;
  summary: string;
  prerequisites: string[];
  observedSignals: string[];
  stepsThatWorked: string[];
  toolsUsed: string[];
  evidenceIds: string[];
  sourceRunId?: string;
  sourceStepIds: string[];
  sourceBoxOrLab?: string;
  verificationMethod: string;
  outcome: string;
  confidence: number; // 0..1
  reuseGuidance: string;
  antiReuseWarnings: string[];
  failedAttempts: string[];
  scope: LessonScope;
  status: LessonStatus;
  createdAt: string;
  verifiedAt?: string;
  verifiedBy?: string;
  // 15.10: failed-attempt fields (used when kind === "failed_attempt").
  attemptedTechnique?: string;
  whyItWasTried?: string;
  whyItFailed?: string;
  conditions?: string;
  futureAvoidanceGuidance?: string;
}

/** Input to propose a lesson (status/timestamps/id are assigned by the service). */
export type AttackLessonInput = Partial<Omit<AttackLesson, "id" | "category" | "status" | "createdAt">> & {
  title: string;
  techniqueName: string;
  techniqueCategory: TechniqueCategory;
  summary: string;
};

export type LessonValidation = { ok: true } | { ok: false; errors: string[] };

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

// ── Secret handling ─────────────────────────────────────────────────────────────────────

/**
 * Detect REJECTABLE target-specific secrets that have NO reuse value and must never be stored:
 * flags, bare hashes (md5/sha/HTB-style 32+ hex), NTLM pairs, and PEM private keys. Credentials
 * / tokens are handled by REDACTION (see redactLessonText), not rejection.
 */
export function findRejectableSecrets(text: string): string[] {
  if (!text) return [];
  const kinds = new Set<string>();
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) kinds.add("private_key");
  if (/\b[a-fA-F0-9]{31,}:[a-fA-F0-9]{31,}\b/.test(text)) kinds.add("ntlm_hash");
  if (/\b[a-fA-F0-9]{32,}\b/.test(text)) kinds.add("hash_or_flag"); // md5/sha/ntlm/HTB-style flag
  if (/\b(?:HTB|FLAG|flag|root|user)\{[^}\n]{3,}\}/.test(text)) kinds.add("flag");
  return [...kinds];
}

/** Redact soft secrets (api keys, bearer, password=…, PEM) from a lesson text field. */
export function redactLessonText(text: string): string {
  return redactSecrets(text ?? "");
}

/** The text fields that are scanned for secrets (references like evidenceIds are NOT scanned). */
const TEXT_FIELDS: (keyof AttackLesson)[] = [
  "title", "techniqueName", "summary", "verificationMethod", "outcome", "reuseGuidance",
  // 15.10: failed-attempt text fields are scanned/redacted for secrets too.
  "attemptedTechnique", "whyItWasTried", "whyItFailed", "conditions", "futureAvoidanceGuidance",
];
const TEXT_ARRAY_FIELDS: (keyof AttackLesson)[] = [
  "prerequisites", "observedSignals", "stepsThatWorked", "antiReuseWarnings", "failedAttempts", "toolsUsed",
];

/** All scannable text of a lesson, concatenated (for secret detection). */
export function lessonScannableText(l: Partial<AttackLesson>): string {
  const parts: string[] = [];
  for (const f of TEXT_FIELDS) { const v = l[f]; if (typeof v === "string") parts.push(v); }
  for (const f of TEXT_ARRAY_FIELDS) { const v = l[f]; if (isStringArray(v)) parts.push(v.join("\n")); }
  return parts.join("\n");
}

/** Return the rejectable secret kinds found anywhere in a lesson's reusable text (empty = clean). */
export function detectLessonSecrets(l: Partial<AttackLesson>): string[] {
  return findRejectableSecrets(lessonScannableText(l));
}

// ── Validation + normalization ──────────────────────────────────────────────────────────

/**
 * Validate + NORMALIZE a lesson input into a clean AttackLesson body (no id/status/createdAt).
 * Soft secrets are redacted in place; rejectable secrets (flag/hash/key) FAIL validation. A lesson
 * with no provenance (no evidenceIds AND no sourceRunId) is allowed to be PROPOSED but should not
 * be promotable to verified (the service / cleanup tool enforce that).
 */
export function validateAndNormalizeLesson(raw: unknown): LessonValidation & { lesson?: Omit<AttackLesson, "id" | "status" | "createdAt"> } {
  if (typeof raw !== "object" || raw === null) return { ok: false, errors: ["lesson must be an object"] };
  const r = raw as Record<string, unknown>;
  const errors: string[] = [];

  if (typeof r.title !== "string" || !r.title.trim()) errors.push("title is required");
  if (typeof r.techniqueName !== "string" || !r.techniqueName.trim()) errors.push("techniqueName is required");
  if (!TECHNIQUE_CATEGORIES.includes(r.techniqueCategory as TechniqueCategory)) {
    errors.push(`techniqueCategory must be one of ${TECHNIQUE_CATEGORIES.join("|")}`);
  }
  if (typeof r.summary !== "string" || !r.summary.trim()) errors.push("summary is required");
  const conf = typeof r.confidence === "number" ? r.confidence : 0.4;
  if (typeof r.confidence === "number" && (r.confidence < 0 || r.confidence > 1)) errors.push("confidence must be in [0,1]");
  const scope: LessonScope = LESSON_SCOPES.includes(r.scope as LessonScope) ? (r.scope as LessonScope) : "lab";
  const kind: LessonKind = LESSON_KINDS.includes(r.kind as LessonKind) ? (r.kind as LessonKind) : "attack_lesson";

  const strArr = (v: unknown): string[] => (isStringArray(v) ? v : []);
  const candidate: Omit<AttackLesson, "id" | "status" | "createdAt"> = {
    category: ATTACK_LESSON_CATEGORY,
    kind,
    agentId: typeof r.agentId === "string" ? r.agentId : undefined,
    attemptedTechnique: typeof r.attemptedTechnique === "string" ? r.attemptedTechnique.trim() : undefined,
    whyItWasTried: typeof r.whyItWasTried === "string" ? r.whyItWasTried.trim() : undefined,
    whyItFailed: typeof r.whyItFailed === "string" ? r.whyItFailed.trim() : undefined,
    conditions: typeof r.conditions === "string" ? r.conditions.trim() : undefined,
    futureAvoidanceGuidance: typeof r.futureAvoidanceGuidance === "string" ? r.futureAvoidanceGuidance.trim() : undefined,
    title: String(r.title ?? "").trim(),
    techniqueName: String(r.techniqueName ?? "").trim(),
    techniqueCategory: r.techniqueCategory as TechniqueCategory,
    summary: String(r.summary ?? "").trim(),
    prerequisites: strArr(r.prerequisites),
    observedSignals: strArr(r.observedSignals),
    stepsThatWorked: strArr(r.stepsThatWorked),
    toolsUsed: strArr(r.toolsUsed),
    evidenceIds: strArr(r.evidenceIds),
    sourceRunId: typeof r.sourceRunId === "string" ? r.sourceRunId : undefined,
    sourceStepIds: strArr(r.sourceStepIds),
    sourceBoxOrLab: typeof r.sourceBoxOrLab === "string" ? r.sourceBoxOrLab : undefined,
    verificationMethod: String(r.verificationMethod ?? "").trim(),
    outcome: String(r.outcome ?? "").trim(),
    confidence: conf,
    reuseGuidance: String(r.reuseGuidance ?? "").trim(),
    antiReuseWarnings: strArr(r.antiReuseWarnings),
    failedAttempts: strArr(r.failedAttempts),
    scope,
    verifiedBy: undefined,
  };

  // Reject target-specific secrets that have no reuse value.
  const secretKinds = detectLessonSecrets(candidate);
  if (secretKinds.length) {
    errors.push(`lesson contains target-specific secret(s) [${secretKinds.join(", ")}] — store an evidence reference, not the secret`);
  }
  if (errors.length) return { ok: false, errors };

  // Redact soft secrets (credentials/tokens/PEM) from every text field before storage.
  const c = candidate as unknown as Record<string, unknown>;
  for (const f of TEXT_FIELDS) {
    const v = c[f as string];
    if (typeof v === "string") c[f as string] = redactLessonText(v);
  }
  for (const f of TEXT_ARRAY_FIELDS) {
    const v = c[f as string];
    if (Array.isArray(v)) c[f as string] = v.map((x) => redactLessonText(String(x)));
  }
  return { ok: true, lesson: candidate };
}

/**
 * True when a lesson is promotable to `verified`. For the HTB training goal a verified lesson MUST
 * be EVIDENCE-BACKED (8.3 — stricter than 8.2): it requires BOTH `evidenceIds` AND `sourceRunId`,
 * plus at least one corroborating field (a source step, a verification method, an outcome, or reuse
 * guidance), and no target-specific secret. A lesson may exist as `proposed` without these — it
 * just cannot become `verified` (and thus cannot reach planning).
 */
export function isPromotable(l: AttackLesson): { ok: boolean; reason?: string } {
  if (detectLessonSecrets(l).length) return { ok: false, reason: "contains a target-specific secret" };
  if (!((l.evidenceIds?.length ?? 0) > 0)) return { ok: false, reason: "no evidenceIds — a verified lesson must be evidence-backed" };
  if (!l.sourceRunId) return { ok: false, reason: "no sourceRunId — a verified lesson must cite the run it came from" };
  const corroborated =
    (l.sourceStepIds?.length ?? 0) > 0 ||
    !!l.verificationMethod?.trim() ||
    !!l.outcome?.trim() ||
    !!l.reuseGuidance?.trim();
  if (!corroborated) return { ok: false, reason: "needs at least one of sourceStepIds / verificationMethod / outcome / reuseGuidance" };
  return { ok: true };
}

// ── Planning-context injection ──────────────────────────────────────────────────────────

/**
 * Build the "VERIFIED TRAINING LESSONS" planning block from VERIFIED, non-stale lessons. Concise +
 * evidence-referenced (no raw secrets). Defensive: filters to status==="verified" regardless of
 * input. Returns "" when there is nothing.
 */
export function buildTrainingLessonContext(lessons: AttackLesson[], opts: { max?: number; header?: string } = {}): string {
  const max = opts.max ?? 15;
  // 15.10: failed-attempt lessons are NEVER presented here (they get their own avoidance section).
  const usable = lessons.filter((l) => l.status === "verified" && l.kind !== "failed_attempt").slice(0, max);
  if (!usable.length) return "";
  const lines: string[] = [
    opts.header ?? "=== VERIFIED TRAINING LESSONS (operator-approved, evidence-backed — reusable knowledge) ===",
    "These are verified attack lessons from prior authorized lab work. They are NOT hypotheses and",
    "NOT raw notes. Consider them when their prerequisites/signals match; heed the anti-reuse warnings.",
  ];
  for (const l of usable) {
    lines.push(
      `\n• ${l.title}  [${l.techniqueCategory} · ${l.techniqueName} · confidence ${Math.round(l.confidence * 100)}%]`,
      `  technique: ${l.summary}`,
      l.prerequisites.length ? `  when to consider — prerequisites/signals: ${[...l.prerequisites, ...l.observedSignals].join("; ")}` : "",
      l.reuseGuidance ? `  reuse guidance: ${l.reuseGuidance}` : "",
      l.antiReuseWarnings.length ? `  ⚠ anti-reuse: ${l.antiReuseWarnings.join("; ")}` : "",
      l.evidenceIds.length ? `  evidence refs: ${l.evidenceIds.join(", ")}` : "",
    );
  }
  lines.push("=== END VERIFIED TRAINING LESSONS ===");
  return lines.filter((x) => x !== "").join("\n");
}

/**
 * 15.10 — the RELEVANT FAILED ATTEMPTS / AVOIDANCE LESSONS block. Verified `failed_attempt` lessons
 * ONLY, presented as avoidance guidance — NEVER as successful attack lessons.
 */
export function buildFailedAttemptContext(lessons: AttackLesson[], opts: { max?: number } = {}): string {
  const max = opts.max ?? 10;
  const usable = lessons.filter((l) => l.status === "verified" && l.kind === "failed_attempt").slice(0, max);
  if (!usable.length) return "";
  const lines: string[] = [
    "=== RELEVANT FAILED ATTEMPTS / AVOIDANCE LESSONS (these did NOT work — do not repeat) ===",
    "These are verified records of techniques that FAILED. They are NOT attack lessons. Use them to",
    "avoid dead ends; the conditions under which they failed are noted.",
  ];
  for (const l of usable) {
    lines.push(
      `\n✗ ${l.attemptedTechnique || l.title}  [${l.techniqueCategory}${l.agentId ? " · " + l.agentId : ""} · confidence ${Math.round(l.confidence * 100)}%]`,
      l.whyItWasTried ? `  why tried: ${l.whyItWasTried}` : "",
      `  why it failed: ${l.whyItFailed || l.summary}`,
      l.conditions ? `  conditions: ${l.conditions}` : "",
      l.futureAvoidanceGuidance ? `  avoidance: ${l.futureAvoidanceGuidance}` : "",
      l.evidenceIds.length ? `  evidence refs: ${l.evidenceIds.join(", ")}` : "",
    );
  }
  lines.push("=== END FAILED ATTEMPTS ===");
  return lines.filter((x) => x !== "").join("\n");
}

/**
 * 15.11 — layered planning-context hierarchy for a SPECIALIST task. Verified lessons ONLY, injected
 * in strict order, each section clearly separated:
 *   1. VERIFIED GLOBAL TRAINING LESSONS        (scope=global)
 *   2. VERIFIED PROJECT/LAB LESSONS            (scope in project|lab|mission)
 *   3. VERIFIED SPECIALIST LESSONS FOR <AGENT> (agentId match OR scope=agent for this agent)
 *   4. RELEVANT FAILED ATTEMPTS / AVOIDANCE    (verified failed_attempt for this agent or global)
 * NEVER injects hypotheses / unverified / rejected / stale / secrets (verified filter + the
 * secret-redaction at propose time guarantee this).
 */
export function buildLayeredPlanningContext(lessons: AttackLesson[], opts: { agentId?: string; max?: number } = {}): string {
  const agent = (opts.agentId || "").toLowerCase();
  const verified = lessons.filter((l) => l.status === "verified");
  const attack = verified.filter((l) => l.kind !== "failed_attempt");

  const globalL = attack.filter((l) => l.scope === "global");
  const projL = attack.filter((l) => l.scope === "project" || l.scope === "lab" || l.scope === "mission");
  const agentL = attack.filter((l) => (l.agentId || "").toLowerCase() === agent || (l.scope === "agent" && (l.agentId || "").toLowerCase() === agent));
  const failed = verified.filter((l) => l.kind === "failed_attempt" && (!agent || !l.agentId || (l.agentId || "").toLowerCase() === agent));

  const sections = [
    buildTrainingLessonContext(globalL, { header: "=== 1. VERIFIED GLOBAL TRAINING LESSONS ===", max: opts.max }),
    buildTrainingLessonContext(projL, { header: "=== 2. VERIFIED PROJECT/LAB LESSONS ===", max: opts.max }),
    buildTrainingLessonContext(agentL, { header: `=== 3. VERIFIED SPECIALIST LESSONS FOR ${opts.agentId || "(agent)"} ===`, max: opts.max }),
    buildFailedAttemptContext(failed, { max: opts.max }),
  ].filter(Boolean);
  return sections.join("\n\n");
}
