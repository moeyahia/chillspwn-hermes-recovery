import { useState, useEffect, useCallback } from "react";

// Phase 16.1 — Specialist Mission Board: horizontal specialist lanes with Agent + Task cards, MCP
// status, approval/evidence/memory counts, handoff indicators, and Cockpit links. Data-first; the
// full execution detail lives in the Agent Cockpit (this board does not duplicate it).

interface McpStatus { bridgeMode: string; profile: string; enabledServers: number; disabledServers: number; missingDependency: number; missingSecret: number; dockerRequired: number }
interface AgentCard { agentId: string; displayName: string; role: string; status: string; specialty: string; currentObjective: string | null; assignedMcpServers: string[]; mcpHealthStatus: McpStatus; evidenceCount: number; pendingApprovalCount: number; proposedLessonCount: number; verifiedLessonCount: number; failedAttemptLessonCount: number; memoryNamespace: string; handoffTo: string | null; handoffFrom: string | null; agentRunId: string | null; currentStepId: string | null; cockpitUrl: string }
interface TaskCard { taskId: string; runId: string; stepId: string; assignedAgentId: string | null; laneId?: string; originatingLane?: string; title: string; objective: string; status: string; riskLevel: string; mcpHealthStatus: string; evidenceIds: string[]; approvalIds: string[]; handoffIds: string[]; cockpitUrl: string }
interface Lane { laneId: string; title: string; agentId: string | null; kind: string; agentCard: AgentCard | null; taskCards: TaskCard[]; openCards?: TaskCard[]; completedCards?: TaskCard[]; failedCards?: TaskCard[]; counts: { tasks: number; running: number; blocked: number; awaitingApproval: number; completed: number; failed?: number; open?: number; approvals?: number; evidence?: number } }
interface Board { mode: string; missionId: string | null; lanes: Lane[]; handoffs: any[] }

const STATUS_COLOR: Record<string, string> = { idle: "#6b7280", assigned: "#3b82f6", planning: "#8b5cf6", running: "#22c55e", awaiting_approval: "#f59e0b", blocked: "#ef4444", completed: "#10b981", failed: "#ef4444", handoff_requested: "#06b6d4" };
const MCP_COLOR: Record<string, string> = { active: "#22c55e", healthy: "#22c55e", "dry-run": "#f59e0b", staged: "#6b7280", disabled: "#6b7280", missing_dependency: "#f97316", missing_secret: "#f59e0b", docker_disabled: "#a855f7", bridge_disabled: "#6b7280", bridge_not_active: "#6b7280", failed: "#ef4444" };
const mcpLabel = (p: string) => ({ active: "MCP active", healthy: "MCP healthy", "dry-run": "MCP dry-run", staged: "MCP staged", disabled: "MCP disabled", missing_dependency: "needs dependency", missing_secret: "needs API key", docker_disabled: "needs Docker build", bridge_disabled: "bridge disabled", bridge_not_active: "no MCP", failed: "MCP failed" }[p] ?? p);

function openCockpit(url: string) { try { window.dispatchEvent(new CustomEvent("cs-open-cockpit", { detail: { url } })); } catch { /* noop */ } }

function Badge({ text, color }: { text: string; color: string }) {
  return <span style={{ background: color + "22", color, border: `1px solid ${color}55`, borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 600, whiteSpace: "nowrap" }}>{text}</span>;
}

function AgentCardView({ c }: { c: AgentCard }) {
  return (
    <div style={{ background: "var(--bg-elevated, #161b22)", border: `1px solid ${STATUS_COLOR[c.status] ?? "#333"}55`, borderRadius: 8, padding: 8, marginBottom: 8 }}>
      <div className="flex items-center justify-between" style={{ gap: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 12, color: "var(--text)" }}>{c.role === "commander" ? "★ " : ""}{c.displayName}</span>
        <Badge text={c.status} color={STATUS_COLOR[c.status] ?? "#888"} />
      </div>
      {c.currentObjective && <div style={{ fontSize: 10, color: "var(--text-muted)", margin: "3px 0" }}>{c.currentObjective.slice(0, 70)}</div>}
      <div className="flex flex-wrap" style={{ gap: 4, marginTop: 4 }}>
        {c.role === "specialist" && <Badge text={mcpLabel(c.mcpHealthStatus.profile)} color={MCP_COLOR[c.mcpHealthStatus.profile] ?? "#888"} />}
        {c.pendingApprovalCount > 0 && <Badge text={`⚠ ${c.pendingApprovalCount} approval`} color="#f59e0b" />}
        {c.evidenceCount > 0 && <Badge text={`◆ ${c.evidenceCount} ev`} color="#3b82f6" />}
        {(c.verifiedLessonCount + c.proposedLessonCount + c.failedAttemptLessonCount) > 0 && <Badge text={`✎ ${c.verifiedLessonCount}v/${c.proposedLessonCount}p/${c.failedAttemptLessonCount}f`} color="#8b5cf6" />}
        {c.handoffTo && <Badge text={`→ ${c.handoffTo}`} color="#06b6d4" />}
        {c.handoffFrom && <Badge text={`← ${c.handoffFrom}`} color="#06b6d4" />}
      </div>
      {c.agentRunId && <button onClick={() => openCockpit(c.cockpitUrl)} style={{ marginTop: 5, fontSize: 10, color: "var(--accent, #58a6ff)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>→ Cockpit</button>}
    </div>
  );
}

function TaskCardView({ t }: { t: TaskCard }) {
  return (
    <div style={{ background: "var(--bg, #0d1117)", border: "1px solid #ffffff14", borderRadius: 6, padding: 6, marginBottom: 6 }}>
      <div className="flex items-center justify-between" style={{ gap: 6 }}>
        <span style={{ fontSize: 11, color: "var(--text)" }}>{t.title.slice(0, 48)}</span>
        <Badge text={t.status} color={STATUS_COLOR[t.status] ?? "#888"} />
      </div>
      <div className="flex flex-wrap" style={{ gap: 4, marginTop: 3 }}>
        <Badge text={t.riskLevel} color="#6b7280" />
        {t.mcpHealthStatus && <Badge text={mcpLabel(t.mcpHealthStatus)} color={MCP_COLOR[t.mcpHealthStatus] ?? "#888"} />}
        {t.evidenceIds.length > 0 && <Badge text={`◆ ${t.evidenceIds.length}`} color="#3b82f6" />}
        {t.approvalIds.length > 0 && <Badge text={`⚠ ${t.approvalIds.length}`} color="#f59e0b" />}
        {t.handoffIds.length > 0 && <Badge text="⇄ handoff" color="#06b6d4" />}
      </div>
      <button onClick={() => openCockpit(t.cockpitUrl)} style={{ marginTop: 4, fontSize: 10, color: "var(--accent, #58a6ff)", background: "none", border: "none", cursor: "pointer", padding: 0 }}>→ step in Cockpit</button>
    </div>
  );
}

const COMPLETED_STATUSES = new Set(["completed", "complete", "done", "archived", "closed"]);
const FAILED_STATUSES = new Set(["failed", "error", "cancelled", "canceled", "timed_out", "timedout"]);
const isCompleted = (s: string) => COMPLETED_STATUSES.has((s || "").toLowerCase());
const isFailed = (s: string) => FAILED_STATUSES.has((s || "").toLowerCase());

// Collapsible section helper (used for FAILED + COMPLETED). Collapsed by default when >3 cards.
function CardSection({ label, color, cards, agent, keySuffix }: { label: string; color: string; cards: TaskCard[]; agent: AgentCard | null; keySuffix: string }) {
  const [open, setOpen] = useState(cards.length <= 3);
  if (cards.length === 0 && !agent) return null;
  return (
    <div style={{ marginTop: 8, borderTop: "1px dashed #ffffff14", paddingTop: 6 }}>
      <button onClick={() => setOpen((v) => !v)} style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0, color, fontSize: 10, fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}>
        <span>{open ? "▾" : "▸"}</span>
        <span>{label} ({cards.length})</span>
      </button>
      {open && (
        <div style={{ marginTop: 6, opacity: 0.78 }}>
          {agent && <AgentCardView c={agent} />}
          {cards.map((t) => <TaskCardView key={t.taskId + keySuffix} t={t} />)}
        </div>
      )}
    </div>
  );
}

// Phase 19 — one lane column: OPEN (expanded), FAILED + COMPLETED (collapsed by default if >3).
function LaneView({ lane }: { lane: Lane }) {
  // Prefer API-provided grouping; fall back to deriving from taskCards (back-compat with older API).
  const completedCards = lane.completedCards ?? lane.taskCards.filter((t) => isCompleted(t.status));
  const failedCards = lane.failedCards ?? lane.taskCards.filter((t) => isFailed(t.status));
  const openCards = lane.openCards ?? lane.taskCards.filter((t) => !isCompleted(t.status) && !isFailed(t.status));
  const agentOpen = lane.agentCard && !isCompleted(lane.agentCard.status) && !isFailed(lane.agentCard.status) ? lane.agentCard : null;
  const agentDone = lane.agentCard && isCompleted(lane.agentCard.status) ? lane.agentCard : null;
  const agentFailed = lane.agentCard && isFailed(lane.agentCard.status) ? lane.agentCard : null;
  const openCount = lane.counts.open ?? openCards.length;
  const completedCount = lane.counts.completed ?? completedCards.length;
  const failedCount = lane.counts.failed ?? failedCards.length;

  return (
    <div style={{ minWidth: 210, maxWidth: 230, display: "flex", flexDirection: "column", background: "var(--bg-subtle, #11161d)", border: "1px solid #ffffff10", borderRadius: 8 }}>
      <div style={{ padding: "6px 8px", borderBottom: "1px solid #ffffff10", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: lane.kind === "command" ? "#facc15" : "var(--text)" }}>{lane.title}</span>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
          <span style={{ color: "#22c55e" }}>{openCount} open</span>{failedCount ? <span style={{ color: "#ef4444" }}> · {failedCount} failed</span> : ""} · {completedCount} done{lane.counts.awaitingApproval ? <span style={{ color: "#f59e0b" }}> · ⚠{lane.counts.awaitingApproval}</span> : ""}
        </span>
      </div>
      <div style={{ padding: 8, overflowY: "auto", flex: 1 }}>
        {/* OPEN */}
        {agentOpen && <AgentCardView c={agentOpen} />}
        {openCards.map((t) => <TaskCardView key={t.taskId + "open"} t={t} />)}
        {!agentOpen && openCards.length === 0 && <div style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center", margin: "6px 0" }}>—</div>}

        {/* FAILED (above Completed — more attention-worthy) */}
        <CardSection label="FAILED" color="#ef4444" cards={failedCards} agent={agentFailed} keySuffix="fail" />
        {/* COMPLETED */}
        <CardSection label="COMPLETED" color="var(--text-muted)" cards={completedCards} agent={agentDone} keySuffix="done" />
      </div>
    </div>
  );
}

export default function MissionBoardPage() {
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch("/api/agents/mission-board").then((r) => r.json()).then((d) => { if (d.lanes) setBoard(d); else setErr(d.error || "specialist board unavailable"); }).catch((e) => setErr(String(e)));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);

  if (err) return <div style={{ padding: 16, color: "var(--text-muted)" }}>Mission Board: {err}. (Enable ENABLE_SPECIALIST_AGENT_ROUTING.)</div>;
  if (!board) return <div style={{ padding: 16, color: "var(--text-muted)" }}>Loading mission board…</div>;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg, #0d1117)" }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid #ffffff14", display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontWeight: 700, color: "var(--text)" }}>MISSION BOARD — Specialist Lanes</span>
        <Badge text={board.mode} color="#3b82f6" />
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{board.lanes.reduce((n, l) => n + l.counts.tasks, 0)} tasks · {board.handoffs.length} handoffs</span>
      </div>
      <div style={{ flex: 1, overflowX: "auto", overflowY: "hidden", display: "flex", gap: 10, padding: 10 }}>
        {board.lanes.map((lane) => <LaneView key={lane.laneId} lane={lane} />)}
      </div>
    </div>
  );
}
