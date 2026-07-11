import { useState, useCallback, useEffect } from "react";
import { useVisiblePolling } from "../lib/useVisiblePolling";
import { runtimeApi } from "../lib/runtimeApi";
import { toolIndicator } from "../lib/toolIndicator";
import {
  runStatusBadge, stepStatusBadge, riskBadge, stepProgress, activeStep, activeToolCall,
  pendingApprovals, blockers, previewText, isObserveOnlyEvent, previewBadges,
  MANAGED_PLAN_APPROVED_MSG, filterRuns, isArchivedRun, runModeLabel,
  isDryRunGateEvent, observeEventLabel, executionEnforcementNote, shortTime, type Badge,
  approvalModeBadge, approvalProvenanceBadge,
} from "../lib/cockpit";
import type {
  AgentRun, CockpitSnapshot, PlanStep, ToolCall, ApprovalRequest, EvidenceItem,
  WorkerResultRecord, AgentEvent, MemoryItem,
} from "../lib/runtimeTypes";

const MUTED = "var(--text-muted)";
const BORDER = "var(--border-color)";

function Pill({ badge, sm }: { badge: Badge; sm?: boolean }) {
  return (
    <span style={{
      fontSize: sm ? 8.5 : 9.5, padding: sm ? "1px 5px" : "2px 7px", borderRadius: 4, fontWeight: 700,
      color: badge.color, border: `1px solid ${badge.color}55`, background: `${badge.color}18`,
      whiteSpace: "nowrap", letterSpacing: "0.04em",
    }}>{badge.label}</span>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, padding: 12, marginBottom: 12, background: "rgba(255,255,255,0.02)" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--text-primary)", marginBottom: 10, textTransform: "uppercase" }}>
        {title}{count !== undefined && <span style={{ color: MUTED, marginLeft: 6 }}>({count})</span>}
      </div>
      {children}
    </div>
  );
}

const card: React.CSSProperties = { border: `1px solid ${BORDER}`, borderRadius: 6, padding: "8px 10px", marginBottom: 6, fontSize: 11.5 };
const codeBox: React.CSSProperties = { fontFamily: "ui-monospace, monospace", fontSize: 10.5, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#8fd3ff", background: "rgba(0,0,0,0.25)", borderRadius: 4, padding: "6px 8px", marginTop: 4, maxHeight: 160, overflow: "auto" };

export default function AgentCockpitPage() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [snap, setSnap] = useState<CockpitSnapshot | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Phase 7.4 — runtime-managed run launcher.
  const [flags, setFlags] = useState<{ managedChatEnabled: boolean; planningEnabled: boolean; requirePlanApproval: boolean } | null>(null);
  // Phase 16.2 — approval mode (operator-controlled; shown + switchable at the top of the Cockpit).
  const [approvalMode, setApprovalMode] = useState<string>("human");
  useEffect(() => { fetch("/api/runtime/approval-mode").then((r) => r.json()).then((d) => d?.mode && setApprovalMode(d.mode)).catch(() => {}); }, []);
  const changeApprovalMode = (mode: string) => {
    fetch("/api/runtime/approval-mode", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode }) })
      .then((r) => r.json()).then((d) => { if (d?.mode) setApprovalMode(d.mode); }).catch(() => {});
  };
  // Phase 13 — run navigation.
  const [runQuery, setRunQuery] = useState("");
  const [runFilter, setRunFilter] = useState<"all" | "active" | "archived">("active");
  const [launcher, setLauncher] = useState(false);
  const [objective, setObjective] = useState("");
  const [persona, setPersona] = useState("");
  const [provider, setProvider] = useState("");
  const [launching, setLaunching] = useState(false);
  // 8.2 — HTB training memory (verified attack lessons).
  const [lessons, setLessons] = useState<any[]>([]);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };

  const refresh = useCallback(() => {
    runtimeApi.listRuns().then(setRuns).catch(() => {});
    runtimeApi.listLessons().then(setLessons).catch(() => {});
    runtimeApi.flags().then(setFlags).catch(() => {});
    if (sel) runtimeApi.cockpit(sel).then(setSnap).catch(() => setSnap(null));
  }, [sel]);
  useVisiblePolling(refresh, 3500);

  const decide = (a: ApprovalRequest, action: "approve" | "reject") => {
    if (!sel) return;
    setBusy(true);
    const p = action === "approve"
      ? runtimeApi.approve(sel, a.id, "operator")
      : runtimeApi.reject(sel, a.id, "rejected from cockpit");
    p.then(() => { flash(`Approval ${action}d`); return runtimeApi.cockpit(sel).then(setSnap); })
      .catch((e) => flash(`Error: ${e.message}`))
      .finally(() => setBusy(false));
  };

  // Phase 7.2 — advisory plan preview (does NOT change the run to managed / enforced).
  const generatePreview = () => {
    if (!sel) return;
    setBusy(true);
    runtimeApi.generatePlanPreview(sel)
      .then(() => { flash("Advisory plan preview generated"); return runtimeApi.cockpit(sel).then(setSnap); })
      .catch((e) => flash(`Preview failed: ${e.message}`))
      .finally(() => setBusy(false));
  };
  const clearPreview = () => {
    if (!sel) return;
    setBusy(true);
    runtimeApi.clearPlanPreview(sel)
      .then(() => { flash("Preview cleared"); return runtimeApi.cockpit(sel).then(setSnap); })
      .catch((e) => flash(`Error: ${e.message}`))
      .finally(() => setBusy(false));
  };

  // Phase 7.4 — launch a managed run (creates run + strict plan; NO execution).
  const launchManaged = () => {
    const obj = objective.trim();
    if (!obj) return;
    setLaunching(true);
    runtimeApi.createManagedChatRun({ objective: obj, persona: persona.trim() || undefined, provider: provider.trim() || undefined })
      .then((r) => {
        flash("Managed run created — plan awaiting approval");
        setLauncher(false); setObjective(""); setPersona(""); setProvider("");
        setSel(r.run.id);
        return runtimeApi.cockpit(r.run.id).then(setSnap);
      })
      .catch((e) => flash(`Managed run failed: ${e.message}`))
      .finally(() => setLaunching(false));
  };
  const approveManagedPlan = () => {
    if (!sel) return; setBusy(true);
    runtimeApi.approvePlan(sel)
      .then(() => { flash(MANAGED_PLAN_APPROVED_MSG); return runtimeApi.cockpit(sel).then(setSnap); })
      .catch((e) => flash(`Error: ${e.message}`)).finally(() => setBusy(false));
  };
  const rejectManagedPlan = () => {
    if (!sel) return; setBusy(true);
    runtimeApi.rejectPlan(sel, "rejected from cockpit")
      .then(() => { flash("Plan rejected"); return runtimeApi.cockpit(sel).then(setSnap); })
      .catch((e) => flash(`Error: ${e.message}`)).finally(() => setBusy(false));
  };
  // Phase 7.5 — observed execution (observe-only) + manual step controls.
  const startObservedExec = () => {
    if (!sel) return; setBusy(true);
    runtimeApi.startObservedExecution(sel)
      .then(() => { flash("Observed execution started (observe-only)"); return runtimeApi.cockpit(sel).then(setSnap); })
      .catch((e) => flash(`Error: ${e.message}`)).finally(() => setBusy(false));
  };
  const startStepFn = (stepId: string) => {
    if (!sel) return; setBusy(true);
    runtimeApi.startStep(sel, stepId)
      .then(() => { flash("Step started"); return runtimeApi.cockpit(sel).then(setSnap); })
      .catch((e) => flash(`Error: ${e.message}`)).finally(() => setBusy(false));
  };
  const completeStepFn = (stepId: string) => {
    if (!sel) return; setBusy(true);
    runtimeApi.completeStep(sel, stepId, "completed from cockpit")
      .then(() => { flash("Step completed"); return runtimeApi.cockpit(sel).then(setSnap); })
      .catch((e) => flash(`Error: ${e.message}`)).finally(() => setBusy(false));
  };
  // 8.2 — training-lesson review actions.
  const lessonAction = (id: string, action: "approve" | "reject" | "stale") => {
    setBusy(true);
    const p = action === "approve" ? runtimeApi.approveLesson(id) : action === "reject" ? runtimeApi.rejectLesson(id) : runtimeApi.staleLesson(id);
    p.then(() => { flash(`Lesson ${action === "stale" ? "marked stale" : action + "d"}`); return runtimeApi.listLessons().then(setLessons); })
      .catch((e) => flash(`Error: ${e.message}`)).finally(() => setBusy(false));
  };
  // Phase 10 — memory review actions.
  const memAction = (id: string, action: "approve" | "reject" | "stale") => {
    if (!sel) return; setBusy(true);
    const p = action === "approve" ? runtimeApi.approveMemory(id)
      : action === "reject" ? runtimeApi.rejectMemory(id, "rejected from cockpit")
      : runtimeApi.staleMemory(id);
    p.then(() => { flash(`Memory ${action === "stale" ? "marked stale" : action + "d"}`); return runtimeApi.cockpit(sel).then(setSnap); })
      .catch((e) => flash(`Error: ${e.message}`)).finally(() => setBusy(false));
  };

  const doc = snap?.doc;
  const run = doc?.run;
  const steps: PlanStep[] = doc?.steps ?? [];
  const toolCalls: ToolCall[] = doc?.toolCalls ?? [];
  const evidence: EvidenceItem[] = doc?.evidence ?? [];
  const approvals: ApprovalRequest[] = doc?.approvals ?? [];
  const workers: WorkerResultRecord[] = doc?.workerResults ?? [];
  const events: AgentEvent[] = snap?.events ?? [];
  const memory: MemoryItem[] = snap?.memory ?? [];

  const observed = events.filter(isObserveOnlyEvent);
  const progress = stepProgress(steps);
  const aStep = activeStep(steps);
  const aTool = activeToolCall(toolCalls);
  const pending = pendingApprovals(approvals);
  const blocks = run ? blockers(run.status, steps, approvals) : [];
  const stepTitle = (id: string | null) => (id ? steps.find((s) => s.id === id)?.title ?? id.slice(0, 10) : "—");

  return (
    <div style={{ display: "flex", height: "100%", color: "var(--text-primary)", fontFamily: "system-ui, sans-serif" }}>
      {/* Phase 7.4 — managed-run launcher modal */}
      {launcher && (
        <div onClick={() => !launching && setLauncher(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: 500, maxWidth: "92vw", background: "var(--bg-surface)", border: `1px solid ${BORDER}`, borderRadius: 10, padding: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>Start runtime-managed run</div>
            <div style={{ fontSize: 10.5, color: MUTED, marginBottom: 12 }}>
              The runtime generates a <b>strict plan</b> and holds it for your <b>approval</b>. After you approve,
              you can start execution. Plan approval is always real; tool enforcement depends on the provider —
              <b>Claude is always observe-only</b>, <b>OpenRouter/Codex can be gated</b> (off / dry-run / enforce).
            </div>
            <label style={{ fontSize: 10.5, color: MUTED }}>Objective</label>
            <textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={3}
              placeholder="e.g. Enumerate the target host and identify a foothold"
              style={{ width: "100%", marginTop: 4, marginBottom: 10, background: "rgba(0,0,0,0.25)", color: "var(--text-primary)", border: `1px solid ${BORDER}`, borderRadius: 6, padding: 8, fontSize: 12, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10.5, color: MUTED }}>Persona (optional)</label>
                <input value={persona} onChange={(e) => setPersona(e.target.value)} placeholder="managed"
                  style={{ width: "100%", marginTop: 4, background: "rgba(0,0,0,0.25)", color: "var(--text-primary)", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "6px 8px", fontSize: 11.5, boxSizing: "border-box" }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 10.5, color: MUTED }}>Provider (optional)</label>
                <input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="claude · openrouter · openai-codex"
                  style={{ width: "100%", marginTop: 4, background: "rgba(0,0,0,0.25)", color: "var(--text-primary)", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "6px 8px", fontSize: 11.5, boxSizing: "border-box" }} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setLauncher(false)} disabled={launching}
                style={{ fontSize: 11, color: MUTED, background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "7px 14px", cursor: "pointer" }}>Cancel</button>
              <button onClick={launchManaged} disabled={launching || !objective.trim()}
                style={{ fontSize: 11, fontWeight: 700, color: "#0a0a0a", background: "#3ad0c0", border: "none", borderRadius: 6, padding: "7px 14px", cursor: launching || !objective.trim() ? "default" : "pointer", opacity: launching || !objective.trim() ? 0.6 : 1 }}>
                {launching ? "Generating plan…" : "Create managed run"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* LEFT: run list */}
      <div style={{ width: 290, borderRight: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${BORDER}` }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.05em" }}>❖ AGENT COCKPIT</div>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>Supervise runtime-owned agent runs</div>
          {/* Phase 13 — run search + active/archived filter */}
          <input value={runQuery} onChange={(e) => setRunQuery(e.target.value)} placeholder="search runs…"
            style={{ width: "100%", marginTop: 8, background: "rgba(0,0,0,0.25)", color: "var(--text-primary)", border: `1px solid ${BORDER}`, borderRadius: 5, padding: "5px 8px", fontSize: 11, boxSizing: "border-box" }} />
          <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
            {(["active", "archived", "all"] as const).map((f) => (
              <button key={f} onClick={() => setRunFilter(f)}
                style={{ flex: 1, fontSize: 9.5, fontWeight: 700, color: runFilter === f ? "#0a0a0a" : MUTED, background: runFilter === f ? "#8fd3ff" : "transparent", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "3px 0", cursor: "pointer", textTransform: "uppercase" }}>{f}</button>
            ))}
          </div>
          {flags?.managedChatEnabled && (
            <button onClick={() => setLauncher(true)}
              style={{ marginTop: 9, width: "100%", fontSize: 11, fontWeight: 700, color: "#3ad0c0", background: "rgba(58,208,192,0.12)", border: "1px solid #3ad0c055", borderRadius: 6, padding: "7px 10px", cursor: "pointer" }}>
              ❖ Start runtime-managed run
            </button>
          )}
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {(() => {
            const visible = filterRuns(runs, { query: runQuery }).filter((r) =>
              runFilter === "all" ? true : runFilter === "archived" ? isArchivedRun(r) : !isArchivedRun(r));
            if (runs.length === 0) return <div style={{ color: MUTED, fontSize: 12, padding: 12 }}>No agent runs yet. Create one via <code>POST /api/runs</code>.</div>;
            if (visible.length === 0) return <div style={{ color: MUTED, fontSize: 12, padding: 12 }}>No {runFilter} runs match.</div>;
            return visible.map((r) => {
            const b = runStatusBadge(r.status);
            return (
              <div key={r.id} onClick={() => { setSel(r.id); runtimeApi.cockpit(r.id).then(setSnap).catch(() => {}); }}
                style={{ padding: "9px 11px", marginBottom: 6, borderRadius: 6, cursor: "pointer",
                  border: `1px solid ${sel === r.id ? b.color : BORDER}`, background: sel === r.id ? "rgba(255,255,255,0.04)" : "transparent" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.objective}</span>
                  <Pill badge={b} sm />
                </div>
                <div style={{ fontSize: 9.5, color: MUTED, marginTop: 4, display: "flex", gap: 5, alignItems: "center" }}>
                  {r.source === "chat" && r.mode === "managed" && <span style={{ color: "#3ad0c0", fontWeight: 700 }}>MANAGED</span>}
                  {r.source === "chat" && r.mode !== "managed" && <span style={{ color: "#ffae42" }}>observe</span>}
                  <span>{r.persona} · {r.providerKind} · {shortTime(r.updatedAt)}</span>
                </div>
              </div>
            );
          });
          })()}
        </div>
      </div>

      {/* RIGHT: selected run */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {!run && <div style={{ color: MUTED, fontSize: 13, marginTop: 40, textAlign: "center" }}>Select a run to supervise it.</div>}
        {run && (
          <>
            {/* Objective + status */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>{run.objective}</span>
                <Pill badge={runStatusBadge(run.status)} />
                {/* 8.2: single provider-aware label (covers managed Claude/OR, gated enforce/dry-run). */}
                {run.source === "chat" && (() => { const m = runModeLabel(run); return <Pill badge={{ label: m.label, color: m.color }} />; })()}
                {/* 16.2: approval mode badge + switcher (operator-controlled, runtime-toggleable). */}
                <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }} title="Approval mode — human: operator approves; auto: runtime auto-approves policy-passing actions; hybrid: auto low-risk only">
                  <Pill badge={approvalModeBadge(approvalMode)} />
                  <select value={approvalMode} onChange={(e) => changeApprovalMode(e.target.value)} style={{ fontSize: 10, background: "var(--bg-elevated,#161b22)", color: "var(--text)", border: "1px solid #ffffff22", borderRadius: 4, padding: "2px 4px" }}>
                    <option value="human">human</option>
                    <option value="auto">auto</option>
                    <option value="hybrid">hybrid</option>
                  </select>
                </span>
              </div>
              {/* Managed plan approval gate — approve to enable observe-only execution (7.5) */}
              {run.status === "awaiting_plan_approval" && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10, padding: "8px 10px", border: "1px solid #b6f23a55", borderRadius: 8, background: "#b6f23a0c" }}>
                  <span style={{ fontSize: 11, color: "var(--text-primary)" }}>
                    ⏸ Plan awaiting approval{run.mode === "managed" ? " · MANAGED · approve to enable observe-only execution" : ""}
                  </span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                    <button onClick={approveManagedPlan} disabled={busy}
                      style={{ fontSize: 10.5, fontWeight: 700, color: "#0a0a0a", background: "#b6f23a", border: "none", borderRadius: 5, padding: "5px 12px", cursor: busy ? "default" : "pointer" }}>Approve plan</button>
                    <button onClick={rejectManagedPlan} disabled={busy}
                      style={{ fontSize: 10.5, fontWeight: 700, color: "#ff8844", background: "transparent", border: "1px solid #ff884455", borderRadius: 5, padding: "5px 12px", cursor: busy ? "default" : "pointer" }}>Reject plan</button>
                  </div>
                </div>
              )}
              {/* Phase 7.5 — managed observed execution (OBSERVE-ONLY; not enforced for Claude) */}
              {run.mode === "managed" && run.status === "executing" && (
                <div style={{ marginTop: 10, padding: "8px 10px", border: "1px solid #3ad0c055", borderRadius: 8, background: "rgba(58,208,192,0.06)" }}>
                  {!run.metadata?.observedExecutionStartedAt ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, color: "var(--text-primary)" }}>
                        Plan approved. {run.providerKind === "openrouter" || run.providerKind === "openai-codex" || run.providerKind === "gemini"
                          ? <>Execution watches the provider; <b>OpenRouter/Codex/Gemini tools are gated</b> when OR gating is enabled (else observe-only).</>
                          : run.providerKind === "xai-grok"
                            ? <>Execution uses <b>Grok ACP with OAuth</b>; tool activity is recorded by Chillspwn and obeys Grok ACP permissions.</>
                          : <>Execution is <b>observe-only</b> — <b>Claude tools are never enforced</b> (frozen <code>claude -p</code>).</>}
                      </span>
                      <button onClick={startObservedExec} disabled={busy}
                        style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 700, color: "#0a0a0a", background: "#3ad0c0", border: "none", borderRadius: 5, padding: "5px 12px", cursor: busy ? "default" : "pointer" }}>Start observed execution</button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 10.5, color: "#3ad0c0", lineHeight: 1.5 }}>
                      ▸ <b>Observed execution running</b> · {executionEnforcementNote(run)}
                    </div>
                  )}
                </div>
              )}
              <div style={{ fontSize: 10.5, color: MUTED, marginTop: 6 }}>
                {run.persona} · {run.providerKind} · session {run.sessionId.slice(0, 14)} · created {shortTime(run.createdAt)} · updated {shortTime(run.updatedAt)}
                {run.endReason ? ` · ended: ${run.endReason}` : ""}
              </div>
              {/* progress */}
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                  <div style={{ width: `${progress.pct}%`, height: "100%", background: "#2bd47f" }} />
                </div>
                <span style={{ fontSize: 10.5, color: MUTED }}>{progress.done}/{progress.total} steps</span>
              </div>
            </div>

            {/* Blockers */}
            {blocks.length > 0 && (
              <div style={{ border: "1px solid #ffae4255", background: "#ffae4214", borderRadius: 8, padding: 10, marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#ffae42", marginBottom: 6 }}>⚠ BLOCKERS</div>
                {blocks.map((x, i) => <div key={i} style={{ fontSize: 11.5, color: "var(--text-primary)" }}>• {x}</div>)}
              </div>
            )}

            {/* Pending approvals */}
            {pending.length > 0 && (
              <Section title="Approvals — action required" count={pending.length}>
                {pending.map((a) => {
                  const ti = toolIndicator(a.toolName);
                  return (
                    <div key={a.id} style={{ ...card, borderColor: "#ffae4255", background: "#ffae420c" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ color: ti.color, fontWeight: 700 }}>{ti.icon} {a.toolName}</span>
                        <Pill badge={riskBadge(a.riskLevel)} sm />
                        <span style={{ color: MUTED }}>step {stepTitle(a.stepId)}</span>
                      </div>
                      <div style={{ marginTop: 4 }}>{a.summary}</div>
                      {a.preview && <div style={codeBox}>{previewText(a.preview, 300)}</div>}
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button disabled={busy} onClick={() => decide(a, "approve")}
                          style={{ fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 5, cursor: "pointer", border: "1px solid #2bd47f88", background: "#2bd47f22", color: "#2bd47f" }}>✓ Approve</button>
                        <button disabled={busy} onClick={() => decide(a, "reject")}
                          style={{ fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 5, cursor: "pointer", border: "1px solid #ff4d6388", background: "#ff4d6322", color: "#ff4d63" }}>✕ Reject</button>
                      </div>
                    </div>
                  );
                })}
              </Section>
            )}

            {/* Plan + steps */}
            <Section title={run.mode === "managed" ? "MANAGED PLAN" : "Plan"} count={steps.length}>
              {steps.length === 0 && (
                <div style={{ color: MUTED, fontSize: 11 }}>
                  {run.mode === "managed"
                    ? "Managed plan not generated."
                    : run.source === "chat"
                    ? "No structured plan attached yet — observing live chat."
                    : <>No plan yet — submit one via <code>POST /api/runs/:id/plan</code>.</>}
                </div>
              )}
              {steps.map((s) => {
                const isActive = aStep?.id === s.id;
                return (
                  <div key={s.id} style={{ ...card, borderColor: isActive ? "#b6f23a66" : BORDER, background: isActive ? "#b6f23a0c" : "transparent" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ color: MUTED, fontSize: 10 }}>#{s.index + 1}</span>
                      <span style={{ fontWeight: 700 }}>{s.title}</span>
                      <Pill badge={{ label: "MANAGED", color: "#2bd47f" }} sm />
                      <Pill badge={stepStatusBadge(s.status)} sm />
                      <Pill badge={riskBadge(s.riskLevel)} sm />
                      {s.evidenceRefs.length > 0 && <span style={{ fontSize: 9.5, color: MUTED }}>🔎 {s.evidenceRefs.length}</span>}
                    </div>
                    <div style={{ fontSize: 10.5, color: MUTED, marginTop: 3 }}>✓ {s.successCriteria}</div>
                    {s.allowedTools.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5 }}>
                        {s.allowedTools.map((t) => <span key={t} style={{ fontSize: 9, color: MUTED, border: `1px solid ${BORDER}`, borderRadius: 3, padding: "1px 5px" }}>{t}</span>)}
                      </div>
                    )}
                    {s.summary && <div style={{ fontSize: 10.5, marginTop: 4, color: "var(--text-primary)" }}>↳ {s.summary}</div>}
                    {isActive && aTool && (
                      <div style={{ marginTop: 6, fontSize: 10.5, color: toolIndicator(aTool.toolName).color }}>
                        ▸ active tool: {toolIndicator(aTool.toolName).icon} {aTool.toolName} ({aTool.status})
                      </div>
                    )}
                    {/* Phase 7.5 — manual step controls for managed observed execution */}
                    {run.mode === "managed" && run.status === "executing" && run.metadata?.observedExecutionStartedAt && (s.status === "pending" || s.status === "running") && (
                      <div style={{ marginTop: 7, display: "flex", gap: 6 }}>
                        {s.status === "pending" && (
                          <button onClick={() => startStepFn(s.id)} disabled={busy}
                            style={{ fontSize: 9.5, fontWeight: 700, color: "#b6f23a", background: "transparent", border: "1px solid #b6f23a55", borderRadius: 4, padding: "3px 9px", cursor: busy ? "default" : "pointer" }}>Start step</button>
                        )}
                        {s.status === "running" && (
                          <button onClick={() => completeStepFn(s.id)} disabled={busy}
                            style={{ fontSize: 9.5, fontWeight: 700, color: "#2bd47f", background: "transparent", border: "1px solid #2bd47f55", borderRadius: 4, padding: "3px 9px", cursor: busy ? "default" : "pointer" }}>Complete step</button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </Section>

            {/* Phase 7.2: ADVISORY plan preview — observe-only chat runs only (NOT managed runs,
                which have a real MANAGED PLAN above). Visually distinct + explicitly NOT ENFORCED. */}
            {run.source === "chat" && run.mode !== "managed" && (
              <Section title="Plan preview — advisory, not enforced">
                <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {previewBadges().map((b) => <Pill key={b.label} badge={b} />)}
                  <span style={{ fontSize: 10, color: MUTED }}>Advisory only — live chat is still observe-only; the agent is not following these steps.</span>
                </div>
                {!run.planPreview && (
                  <button onClick={generatePreview} disabled={busy}
                    style={{ fontSize: 11, fontWeight: 700, color: "#ffae42", background: "rgba(255,174,66,0.12)", border: "1px solid #ffae4255", borderRadius: 6, padding: "6px 12px", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
                    {busy ? "Generating…" : "✦ Generate plan preview"}
                  </button>
                )}
                {run.planPreview && (
                  <>
                    <div style={{ fontSize: 10.5, color: MUTED, marginBottom: 8 }}>
                      {run.planPreview.title} · risk {run.planPreview.riskLevel} · confidence {Math.round(run.planPreview.confidence * 100)}% · {run.planPreview.source} via {run.planPreview.generatedBy ?? "model"}
                    </div>
                    {run.planPreview.steps.map((s, i) => (
                      <div key={i} style={{ ...card, borderStyle: "dashed", borderColor: "#ffae4255", background: "rgba(255,174,66,0.04)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ color: MUTED, fontSize: 10 }}>~{i + 1}</span>
                          <span style={{ fontWeight: 700 }}>{s.title}</span>
                          <Pill badge={{ label: "PREVIEW", color: "#ffae42" }} sm />
                          <Pill badge={{ label: "NOT ENFORCED", color: "#ff8844" }} sm />
                          <Pill badge={riskBadge(s.riskLevel as any)} sm />
                        </div>
                        <div style={{ fontSize: 10.5, color: MUTED, marginTop: 3 }}>{s.purpose}</div>
                        <div style={{ fontSize: 10.5, color: MUTED, marginTop: 3 }}>✓ {s.successCriteria}</div>
                        {s.suggestedTools.length > 0 && (
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 5, alignItems: "center" }}>
                            <span style={{ fontSize: 9, color: MUTED }}>suggested (advisory):</span>
                            {s.suggestedTools.map((t) => <span key={t} style={{ fontSize: 9, color: MUTED, border: `1px dashed ${BORDER}`, borderRadius: 3, padding: "1px 5px" }}>{t}</span>)}
                          </div>
                        )}
                      </div>
                    ))}
                    <button onClick={clearPreview} disabled={busy}
                      style={{ fontSize: 10, color: MUTED, background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 5, padding: "4px 10px", marginTop: 4, cursor: busy ? "default" : "pointer" }}>
                      Clear preview
                    </button>
                  </>
                )}
              </Section>
            )}

            {/* Tool calls + decisions */}
            {toolCalls.length > 0 && (
              <Section title="Tool calls & decisions" count={toolCalls.length}>
                {toolCalls.slice().reverse().slice(0, 30).map((t) => {
                  const ti = toolIndicator(t.toolName);
                  const sc: Record<string, string> = { approved: "#2bd47f", succeeded: "#2bd47f", rejected: "#ff4d63", failed: "#ff4d63", awaiting_approval: "#ffae42", executing: "#b6f23a" };
                  const col = sc[t.status] || "#9aa6b6";
                  return (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 11, borderBottom: `1px solid ${BORDER}` }}>
                      <span style={{ color: ti.color }}>{ti.icon} {t.toolName}</span>
                      <Pill badge={riskBadge(t.riskLevel)} sm />
                      <span style={{ color: col, fontWeight: 700, fontSize: 9.5 }}>{t.status.toUpperCase()}</span>
                      <span style={{ color: MUTED, fontSize: 9.5 }}>step {stepTitle(t.stepId)}</span>
                      <span style={{ color: MUTED, fontSize: 9.5, marginLeft: "auto" }}>{shortTime(t.createdAt)}</span>
                    </div>
                  );
                })}
              </Section>
            )}

            {/* Evidence */}
            {evidence.length > 0 && (
              <Section title="Evidence collected" count={evidence.length}>
                {evidence.slice().reverse().slice(0, 20).map((e) => (
                  <div key={e.id} style={card}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700 }}>{e.label}</span>
                      <Pill badge={{ label: e.kind, color: "#8fd3ff" }} sm />
                      <span style={{ color: MUTED, fontSize: 9.5 }}>step {stepTitle(e.stepId)}</span>
                      {e.sourceToolName && <span style={{ color: MUTED, fontSize: 9.5 }}>via {e.sourceToolName}</span>}
                      {e.artifactId && (
                        <a onClick={() => window.open(`/api/artifacts/${encodeURIComponent(e.artifactId!)}`, "_blank")}
                          style={{ fontSize: 9, color: "#8fd3ff", textDecoration: "underline", cursor: "pointer" }} title="Full content (artifact)">📎 artifact</a>
                      )}
                      <span style={{ color: MUTED, fontSize: 9.5, marginLeft: "auto" }}>{shortTime(e.createdAt)}</span>
                    </div>
                    {e.content && <div style={codeBox}>{previewText(e.content, 300)}</div>}
                  </div>
                ))}
              </Section>
            )}

            {/* Worker results */}
            {workers.length > 0 && (
              <Section title="Delegated worker results" count={workers.length}>
                {workers.map((w, i) => (
                  <div key={i} style={card}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Pill badge={{ label: w.result.status.toUpperCase(), color: w.result.status === "complete" ? "#2bd47f" : w.result.status === "failed" ? "#ff4d63" : "#ffae42" }} sm />
                      <span style={{ fontWeight: 600 }}>{w.result.summary}</span>
                      <span style={{ color: MUTED, fontSize: 9.5, marginLeft: "auto" }}>conf {Math.round(w.result.confidence * 100)}%</span>
                    </div>
                    {w.result.assumptions.length > 0 && <div style={{ fontSize: 10, color: MUTED, marginTop: 4 }}>assumes: {w.result.assumptions.join("; ")}</div>}
                    {w.result.recommendedNextSteps.length > 0 && <div style={{ fontSize: 10, color: "#b6f23a", marginTop: 2 }}>next: {w.result.recommendedNextSteps.join("; ")}</div>}
                    {w.evidenceIds.length > 0 && <div style={{ fontSize: 9.5, color: MUTED, marginTop: 2 }}>🔎 {w.evidenceIds.length} evidence item(s)</div>}
                  </div>
                ))}
              </Section>
            )}

            {/* Non-enforced classifications — observe-only (live chat) + dry-run gate. NEVER actionable. */}
            {observed.length > 0 && (
              <Section title="Non-enforced classifications (observe-only + dry-run)" count={observed.length}>
                <div style={{ fontSize: 10, color: "#ffae42", marginBottom: 6 }}>
                  Recorded for visibility only — the runtime did NOT gate these. <b>OBSERVE-ONLY</b> = a tool the runtime can't enforce (e.g. frozen <code>claude -p</code>). <b>DRY RUN</b> = OpenRouter gating in dry-run mode: the decision was recorded but the tool still executed and <b>no approval was required</b>. Neither appears in the approvals queue.
                </div>
                {observed.slice().reverse().slice(0, 15).map((e) => {
                  const dry = isDryRunGateEvent(e);
                  return (
                    <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0", fontSize: 10.5, borderBottom: `1px solid ${BORDER}` }}>
                      <span>{String(e.data.toolName ?? "?")}</span>
                      <span style={{ color: MUTED }}>would: {String(e.data.wouldDecide ?? "?")}</span>
                      <Pill badge={{ label: observeEventLabel(e), color: dry ? "#c08bff" : "#ffae42" }} sm />
                      <span style={{ color: MUTED, fontSize: 9.5, marginLeft: "auto" }}>{shortTime(e.timestamp)}</span>
                    </div>
                  );
                })}
              </Section>
            )}

            {/* Memory (minimal) */}
            {memory.length > 0 && (
              <Section title="Related memory" count={memory.length}>
                {memory.slice(0, 12).map((m) => {
                  const mc: Record<string, string> = { verified: "#2bd47f", unverified: "#ffae42", rejected: "#ff4d63", stale: "#9aa6b6" };
                  return (
                    <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 11, borderBottom: `1px solid ${BORDER}` }}>
                      <Pill badge={{ label: m.status, color: mc[m.status] || "#9aa6b6" }} sm />
                      <span style={{ color: MUTED, fontSize: 9.5 }}>{m.type}/{m.scope}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{m.content}</span>
                      {/* Phase 10 — review actions for unverified proposals */}
                      {m.status === "unverified" && (
                        <span style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => memAction(m.id, "approve")} disabled={busy} title="Approve → verified"
                            style={{ fontSize: 9, color: "#2bd47f", background: "transparent", border: "1px solid #2bd47f55", borderRadius: 3, padding: "1px 6px", cursor: "pointer" }}>✓</button>
                          <button onClick={() => memAction(m.id, "reject")} disabled={busy} title="Reject"
                            style={{ fontSize: 9, color: "#ff4d63", background: "transparent", border: "1px solid #ff4d6355", borderRadius: 3, padding: "1px 6px", cursor: "pointer" }}>✕</button>
                        </span>
                      )}
                      {m.status === "verified" && (
                        <button onClick={() => memAction(m.id, "stale")} disabled={busy} title="Mark stale"
                          style={{ fontSize: 9, color: MUTED, background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 3, padding: "1px 6px", cursor: "pointer" }}>stale</button>
                      )}
                    </div>
                  );
                })}
              </Section>
            )}

            {/* 8.2 — HTB Training Memory (verified attack lessons). Global; reviewed here. */}
            {lessons.length > 0 && (
              <Section title="Training memory — verified attack lessons" count={lessons.length}>
                <div style={{ fontSize: 9.5, color: MUTED, marginBottom: 6 }}>
                  Reusable, evidence-backed lessons. Only <b>verified</b> lessons are injected into managed planning (never hypotheses / raw notes / secrets).
                </div>
                {lessons.slice(0, 14).map((l) => {
                  const lc: Record<string, string> = { verified: "#2bd47f", proposed: "#ffae42", rejected: "#ff4d63", stale: "#9aa6b6" };
                  return (
                    <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 11, borderBottom: `1px solid ${BORDER}` }}>
                      <Pill badge={{ label: l.status, color: lc[l.status] || "#9aa6b6" }} sm />
                      <span style={{ color: MUTED, fontSize: 9 }}>{l.techniqueCategory}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{l.title}</span>
                      {l.status === "verified" && <span style={{ fontSize: 8.5, color: "#2bd47f" }} title="injected into managed planning">▶ in planning</span>}
                      {l.evidenceIds?.length > 0 && <span style={{ fontSize: 8.5, color: MUTED }}>🔎{l.evidenceIds.length}</span>}
                      {l.status === "proposed" && (
                        <span style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => lessonAction(l.id, "approve")} disabled={busy} title="Verify"
                            style={{ fontSize: 9, color: "#2bd47f", background: "transparent", border: "1px solid #2bd47f55", borderRadius: 3, padding: "1px 6px", cursor: "pointer" }}>✓</button>
                          <button onClick={() => lessonAction(l.id, "reject")} disabled={busy} title="Reject"
                            style={{ fontSize: 9, color: "#ff4d63", background: "transparent", border: "1px solid #ff4d6355", borderRadius: 3, padding: "1px 6px", cursor: "pointer" }}>✕</button>
                        </span>
                      )}
                      {l.status === "verified" && (
                        <button onClick={() => lessonAction(l.id, "stale")} disabled={busy} title="Mark stale"
                          style={{ fontSize: 9, color: MUTED, background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 3, padding: "1px 6px", cursor: "pointer" }}>stale</button>
                      )}
                    </div>
                  );
                })}
              </Section>
            )}

            {/* Final deliverable + Phase 11 report/export */}
            <Section title="Report & export">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: run.finalReport ? 10 : 0 }}>
                <button onClick={() => window.open(`/api/runs/${encodeURIComponent(sel!)}/report?format=md`, "_blank")}
                  style={{ fontSize: 10.5, fontWeight: 700, color: "#8fd3ff", background: "rgba(143,211,255,0.1)", border: "1px solid #8fd3ff44", borderRadius: 5, padding: "5px 11px", cursor: "pointer" }}>↗ Report (Markdown)</button>
                <button onClick={() => window.open(`/api/runs/${encodeURIComponent(sel!)}/report?format=json`, "_blank")}
                  style={{ fontSize: 10.5, color: MUTED, background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 5, padding: "5px 11px", cursor: "pointer" }}>↗ Report (JSON)</button>
                <button onClick={() => window.open(`/api/runs/${encodeURIComponent(sel!)}/evidence-bundle`, "_blank")}
                  style={{ fontSize: 10.5, color: MUTED, background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 5, padding: "5px 11px", cursor: "pointer" }}>↗ Evidence bundle</button>
                <span style={{ fontSize: 9, color: MUTED, alignSelf: "center" }}>secrets redacted by default</span>
              </div>
              {run.finalReport && <div style={{ ...codeBox, color: "var(--text-primary)", maxHeight: 320 }}>{run.finalReport}</div>}
            </Section>
          </>
        )}
      </div>

      {toast && (
        <div style={{ position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)", background: "rgba(0,0,0,0.85)", color: "#b6f23a", padding: "8px 16px", borderRadius: 6, fontSize: 12, zIndex: 1000, border: "1px solid #b6f23a44" }}>{toast}</div>
      )}
    </div>
  );
}
