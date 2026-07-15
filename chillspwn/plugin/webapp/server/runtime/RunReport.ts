/**
 * RunReport (Phase 11) — assemble a useful final deliverable for ANY AgentRun (managed,
 * observe-only, OR-gated, worker) from its persisted doc + events + related memory, and serialize
 * to Markdown / JSON. Pure + dependency-free → fully unit-testable. Includes a conservative
 * secret redactor for evidence previews.
 */

import type { AgentEvent, MemoryItem } from "./types";
import type { AgentRunDoc } from "./AgentRunStore";

export interface RunReport {
  runId: string;
  objective: string;
  status: string;
  source?: string;
  mode?: string;
  gateMode?: string;
  persona: string;
  providerKind: string;
  createdAt: string;
  updatedAt: string;
  plan: { stepCount: number; steps: Array<{ index: number; title: string; status: string; successCriteria: string; summary?: string }> };
  toolsUsed: Array<{ toolName: string; status: string; riskLevel: string; stepId: string | null }>;
  approvals: Array<{ toolName: string; status: string; riskLevel: string }>;
  deniedActions: Array<{ toolName: string; reason: string }>;
  evidence: Array<{ label: string; kind: string; stepId: string | null; sourceToolName?: string; preview: string }>;
  workerResults: Array<{ status: string; summary: string; confidence: number }>;
  memoryProposals: Array<{ type: string; content: string; status: string }>;
  conclusion: string;
  risks: string[];
  nextSteps: string[];
}

/** Conservative secret redaction for evidence previews / report bodies. */
export function redactSecrets(text: string): string {
  if (!text) return text;
  return text
    // bearer / api keys / long hex/base64 secrets
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, "[REDACTED-KEY]")
    .replace(/\b(Authorization|Bearer|api[_-]?key|token|password|passwd|secret)\b\s*[:=]\s*\S+/gi, "$1: [REDACTED]")
    .replace(/\b((?:password|passwd|passphrase)\s+(?:is|was|equals?))\s+(?!<(?:PASSWORD|SECRET|TOKEN|CREDENTIAL)>)(?:"[^"]+"|'[^']+'|`[^`]+`|\S+)/gi, "$1 [REDACTED]")
    .replace(/\b((?:token|secret|api[_ -]?key)\s+(?:is|was|equals?))\s+(?!<(?:PASSWORD|SECRET|TOKEN|CREDENTIAL)>)(?:"[^"]+"|'[^']+'|`[^`]+`|\S+)/gi, "$1 [REDACTED]")
    .replace(/\b((?:password|passwd|passphrase)|use\s+(?:the\s+)?(?:token|secret))\s+(?!<(?:PASSWORD|SECRET|TOKEN|CREDENTIAL)>)(?!(?:authentication|field|hash|length|manager|placeholder|policy|prompt|reset|spraying)\b)(?:"[^"]+"|'[^']+'|`[^`]+`|\S+)/gi, "$1 [REDACTED]")
    .replace(/\b(credentials?\s*(?:(?:is|was)\s+|[:=]\s*)?)(?!<(?:CREDENTIAL|USER_REF)>)([A-Za-z][A-Za-z0-9._$-]{1,31}):(?!<(?:PASSWORD|SECRET)>)[^\s,;]+/gi, "$1[REDACTED-CREDENTIAL]")
    .replace(/\b(login\s+(?:with|as)\s+[^\s,;]+\s+(?:and|using|with\s+(?:password|secret))\s+)(?!<(?:PASSWORD|SECRET|TOKEN)>)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED-PRIVATE-KEY]");
}

function previewOf(content: string | undefined, redact: boolean, n = 280): string {
  const raw = (content ?? "").slice(0, n);
  const out = redact ? redactSecrets(raw) : raw;
  return (content && content.length > n) ? out + ` … (+${content.length - n} chars)` : out;
}

export interface BuildReportOpts {
  events?: AgentEvent[];
  memory?: MemoryItem[];
  redact?: boolean; // default true
}

export function buildRunReport(doc: AgentRunDoc, opts: BuildReportOpts = {}): RunReport {
  const redact = opts.redact !== false;
  const run = doc.run;
  const steps = doc.steps ?? [];
  const toolCalls = doc.toolCalls ?? [];
  const evidence = doc.evidence ?? [];
  const approvals = doc.approvals ?? [];
  const workers = doc.workerResults ?? [];
  const memory = opts.memory ?? [];

  const denied = toolCalls.filter((t) => t.status === "rejected");
  const blocked = steps.filter((s) => s.status === "blocked" || s.status === "failed");

  const risks: string[] = [];
  for (const s of blocked) risks.push(`Step "${s.title}" ended ${s.status}${s.summary ? `: ${s.summary}` : ""}`);
  for (const d of denied) risks.push(`Tool "${d.toolName}" was denied by policy${(d as any).riskLevel ? ` (${(d as any).riskLevel})` : ""}`);
  for (const w of workers) if (w.result.status !== "complete") risks.push(`Delegated worker ${w.result.status}: ${w.result.summary}`);

  const nextSteps = Array.from(new Set([
    ...workers.flatMap((w) => w.result.recommendedNextSteps),
    ...steps.filter((s) => s.status === "pending").map((s) => `Pending step: ${s.title}`),
  ]));

  const done = steps.filter((s) => s.status === "completed").length;
  const conclusion = run.finalReport && run.finalReport.trim()
    ? run.finalReport
    : `Run is ${run.status}. ${done}/${steps.length} plan step(s) completed, ${toolCalls.length} tool call(s) recorded, ${evidence.length} evidence item(s) collected${denied.length ? `, ${denied.length} action(s) denied by policy` : ""}.`;

  return {
    runId: run.id,
    objective: run.objective,
    status: run.status,
    source: run.source,
    mode: run.mode,
    gateMode: (run.metadata as any)?.gateMode,
    persona: run.persona,
    providerKind: run.providerKind,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    plan: {
      stepCount: steps.length,
      steps: steps.map((s) => ({ index: s.index, title: s.title, status: s.status, successCriteria: s.successCriteria, summary: s.summary })),
    },
    toolsUsed: toolCalls.map((t) => ({ toolName: t.toolName, status: t.status, riskLevel: t.riskLevel, stepId: t.stepId ?? null })),
    approvals: approvals.map((a) => ({ toolName: a.toolName, status: a.status, riskLevel: a.riskLevel })),
    deniedActions: denied.map((d) => ({ toolName: d.toolName, reason: `denied (${d.riskLevel})` })),
    evidence: evidence.map((e) => ({ label: e.label, kind: e.kind, stepId: e.stepId ?? null, sourceToolName: e.sourceToolName, preview: previewOf(e.content, redact) })),
    workerResults: workers.map((w) => ({ status: w.result.status, summary: w.result.summary, confidence: w.result.confidence })),
    memoryProposals: memory.map((m) => ({ type: m.type, content: m.content, status: m.status })),
    conclusion: redact ? redactSecrets(conclusion) : conclusion,
    risks,
    nextSteps,
  };
}

export function runReportToMarkdown(r: RunReport): string {
  const L: string[] = [];
  L.push(`# Agent Run Report — ${r.objective}`);
  L.push("");
  L.push(`- **Run:** ${r.runId}`);
  L.push(`- **Status:** ${r.status}  ·  **Source:** ${r.source ?? "api"}  ·  **Mode:** ${r.mode ?? "managed"}${r.gateMode ? `  ·  **OR gate:** ${r.gateMode}` : ""}`);
  L.push(`- **Persona/Provider:** ${r.persona} / ${r.providerKind}`);
  L.push(`- **Created/Updated:** ${r.createdAt} → ${r.updatedAt}`);
  L.push("");
  L.push(`## Conclusion\n\n${r.conclusion}\n`);
  L.push(`## Plan (${r.plan.stepCount} step${r.plan.stepCount === 1 ? "" : "s"})`);
  for (const s of r.plan.steps) L.push(`- [${s.status}] **${s.title}** — ${s.successCriteria}${s.summary ? `\n  - ↳ ${s.summary}` : ""}`);
  L.push("");
  if (r.toolsUsed.length) { L.push(`## Tools used (${r.toolsUsed.length})`); for (const t of r.toolsUsed) L.push(`- ${t.toolName} — ${t.status} (${t.riskLevel})`); L.push(""); }
  if (r.approvals.length) { L.push(`## Approvals`); for (const a of r.approvals) L.push(`- ${a.toolName} — ${a.status} (${a.riskLevel})`); L.push(""); }
  if (r.deniedActions.length) { L.push(`## Denied actions`); for (const d of r.deniedActions) L.push(`- ${d.toolName} — ${d.reason}`); L.push(""); }
  if (r.evidence.length) { L.push(`## Evidence (${r.evidence.length})`); for (const e of r.evidence) L.push(`- **${e.label}** (${e.kind})${e.sourceToolName ? ` via ${e.sourceToolName}` : ""}\n  \`\`\`\n  ${e.preview.replace(/\n/g, "\n  ")}\n  \`\`\``); L.push(""); }
  if (r.workerResults.length) { L.push(`## Delegated worker results`); for (const w of r.workerResults) L.push(`- [${w.status}] ${w.summary} (confidence ${Math.round(w.confidence * 100)}%)`); L.push(""); }
  if (r.memoryProposals.length) { L.push(`## Memory proposals`); for (const m of r.memoryProposals) L.push(`- [${m.status}] (${m.type}) ${m.content}`); L.push(""); }
  if (r.risks.length) { L.push(`## Remaining risks`); for (const x of r.risks) L.push(`- ${x}`); L.push(""); }
  if (r.nextSteps.length) { L.push(`## Recommended next steps`); for (const x of r.nextSteps) L.push(`- ${x}`); L.push(""); }
  return L.join("\n");
}

/** Evidence bundle — metadata + artifact references only (no raw secrets by default). */
export function buildEvidenceBundle(doc: AgentRunDoc, opts: { redact?: boolean } = {}): {
  runId: string;
  count: number;
  items: Array<{ id?: string; label: string; kind: string; stepId: string | null; sourceToolName?: string; artifactId?: string; preview: string }>;
} {
  const redact = opts.redact !== false;
  const evidence = doc.evidence ?? [];
  return {
    runId: doc.run.id,
    count: evidence.length,
    items: evidence.map((e) => ({
      id: (e as any).id,
      label: e.label,
      kind: e.kind,
      stepId: e.stepId ?? null,
      sourceToolName: e.sourceToolName,
      artifactId: (e as any).artifactId,
      preview: previewOf(e.content, redact, 200),
    })),
  };
}
