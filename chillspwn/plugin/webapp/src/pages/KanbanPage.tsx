import { useState, useEffect, useCallback, memo } from "react";
import type { CSSProperties } from "react";
import { toolIndicator } from "../lib/toolIndicator";
import { useBoardSocket } from "../lib/useBoardSocket";
import type { Card, BoardColumn, ToolEvent } from "../lib/boardTypes";

// Agent-orchestration board: columns = agents (personas). The orchestrator (and you) delegate by
// creating cards; each card triggers that persona's agent, whose tools/skills stream onto the card
// live, with the final result on expand. Live over WS (board_* events), REST seed on connect.
const STATUS_COLORS: Record<string, string> = {
  backlog: "#9aa6b6", queued: "#ffae42", running: "#b6f23a", done: "#2bd47f", failed: "#ff4d63",
};
const PERSONA_ICON: Record<string, string> = {
  skull: "💀", code: "⌨", search: "🔍", terminal: "▪", bug: "🐛", user: "◇", shield: "🛡", brain: "🧠",
};

const btn: CSSProperties = { background: "transparent", border: "1px solid #2a3a4a", color: "#8a9aaa", borderRadius: 4, padding: "4px 8px", fontSize: 11, cursor: "pointer" };
const inp: CSSProperties = { width: "100%", background: "#05080c", border: "1px solid #2a3a4a", color: "#e0e0e0", borderRadius: 4, padding: "4px 6px", fontSize: 11, boxSizing: "border-box" };

function ToolTimeline({ tools, max = 8 }: { tools: ToolEvent[]; max?: number }) {
  if (!tools?.length) return null;
  const shown = tools.slice(-max);
  const extra = tools.length - shown.length;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
      {extra > 0 && <span style={{ fontSize: 10, color: "#9aa6b6", alignSelf: "center" }}>+{extra}</span>}
      {shown.map((t) => {
        const ind = toolIndicator(t.name, t.detail);
        return (
          <span key={t.id} title={`${ind.label}${t.detail ? ": " + t.detail : ""}`}
            style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, border: `1px solid ${ind.color}55`, color: ind.color, background: `${ind.color}11`, whiteSpace: "nowrap" }}>
            {ind.icon} {ind.label}
          </span>
        );
      })}
    </div>
  );
}

const CardView = memo(function CardView({ card, expanded, onToggle }: { card: Card; expanded: boolean; onToggle: () => void }) {
  const sc = STATUS_COLORS[card.status] || "#9aa6b6";
  const isOrch = card.createdBy === "orchestrator";
  // Brain label for orchestrator-created cards — derived from the card's own provider/model
  // (was hardcoded "DEEPSEEK" from when the orchestrator was always DeepSeek; it now runs codex etc.).
  const brain =
    card.provider === "openai-codex" ? "CODEX"
    : card.provider === "gemini" ? "GEMINI"
    : card.provider === "xai-grok" ? "GROK ACP"
    : card.provider === "anthropic" ? "CLAUDE"
    : card.provider === "openrouter" ? (card.model && /deepseek/i.test(card.model) ? "DEEPSEEK" : (card.model?.split("/")[1] || "OPENROUTER").toUpperCase())
    : "ORCHESTRATOR";
  return (
    <div onClick={onToggle} style={{ background: "#0a0e14", border: `1px solid ${sc}33`, borderLeft: `3px solid ${sc}`, borderRadius: 6, padding: "8px 10px", marginBottom: 8, cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, color: isOrch ? "#b07cff" : "#b6f23a", fontWeight: 700 }}>{isOrch ? `🧠 ${brain}` : "◈ YOU"}</span>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: sc, padding: "1px 6px", border: `1px solid ${sc}`, borderRadius: 10 }}>
          {card.status === "running" ? "● " : ""}{card.status}
        </span>
      </div>
      <div style={{ fontSize: 13, color: "#e0e0e0", marginTop: 4, fontWeight: 600 }}>{card.title}</div>
      {(card.provider || card.model) && (
        <div style={{ fontSize: 9, color: "#9aa6b6", marginTop: 2 }}>
          {card.provider === "openrouter" ? "🟢 OpenRouter" : card.provider === "openai-codex" ? "⌬ Codex" : card.provider === "gemini" ? "✦ Gemini" : card.provider === "xai-grok" ? "◉ Grok ACP" : card.provider === "anthropic" ? "🔶 Claude" : ""}
          {card.model ? ` · ${card.model}` : ""}
        </div>
      )}
      <ToolTimeline tools={card.tools} />
      {expanded && (
        <div style={{ marginTop: 8, borderTop: "1px solid #1a2230", paddingTop: 8 }}>
          {card.task && <div style={{ fontSize: 11, color: "#8a9aaa", whiteSpace: "pre-wrap", marginBottom: 6 }}>{card.task}</div>}
          {card.tools?.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {card.tools.map((t) => {
                const ind = toolIndicator(t.name, t.detail);
                return <div key={t.id} style={{ fontSize: 10, color: ind.color, fontFamily: "monospace" }}>{ind.icon} {ind.label}{t.detail ? ` — ${String(t.detail).slice(0, 90)}` : ""}</div>;
              })}
            </div>
          )}
          {(card.result || card.error) && (
            <pre style={{ fontSize: 11, color: card.error ? "#ff6677" : "#2bd47f", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 280, overflow: "auto", margin: 0, background: "#060a0f", padding: 8, borderRadius: 4 }}>
              {card.result || card.error}
            </pre>
          )}
        </div>
      )}
    </div>
  );
});

export default function KanbanPage() {
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [cardsById, setCardsById] = useState<Record<string, Card>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [composeFor, setComposeFor] = useState<string | null>(null);
  const [doneOpen, setDoneOpen] = useState<Record<string, boolean>>({});
  const [cTitle, setCTitle] = useState("");
  const [cBody, setCBody] = useState("");

  const seedBoard = useCallback(() => {
    fetch("/api/board/columns").then((r) => r.json()).then((d) => setColumns(d.columns || [])).catch(() => {});
    fetch("/api/board").then((r) => r.json()).then((d) => {
      const m: Record<string, Card> = {};
      for (const c of (d.cards || [])) m[c.id] = c;
      setCardsById(m);
    }).catch(() => {});
  }, []);

  // Incremental reducer — a tool event touches exactly one card object, so only that memoized
  // CardView re-renders (no full-board re-render; important for mobile).
  const onBoardEvent = useCallback((msg: any) => {
    if (msg.type === "board_card_created" && msg.card) {
      setCardsById((s) => ({ ...s, [msg.card.id]: msg.card }));
    } else if (msg.type === "board_card_updated" && msg.taskId) {
      setCardsById((s) => (s[msg.taskId] ? { ...s, [msg.taskId]: { ...s[msg.taskId], ...msg.patch } } : s));
    } else if (msg.type === "board_tool" && msg.taskId && msg.event) {
      setCardsById((s) => {
        const c = s[msg.taskId];
        if (!c) return s;
        if (c.tools?.some((t) => t.id === msg.event.id)) return s; // replay-safe dedup
        return { ...s, [msg.taskId]: { ...c, tools: [...(c.tools || []), msg.event] } };
      });
    } else if (msg.type === "board_columns" && msg.columns) {
      setColumns(msg.columns);
    }
  }, []);

  const { connected } = useBoardSocket({ onBoardEvent, onReconnect: seedBoard });
  useEffect(() => { seedBoard(); }, [seedBoard]);

  const createCard = (persona: string) => {
    if (!cTitle.trim()) return;
    fetch("/api/kanban", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: cTitle, body: cBody, assignee: persona, createdBy: "human" }) })
      .then(() => { setCTitle(""); setCBody(""); setComposeFor(null); }).catch(() => {});
  };

  const cardsFor = (persona: string) => Object.values(cardsById).filter((c) => (c.assignee || "__plan__") === persona).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const ordered = [...columns].sort((a, b) => a.position - b.position);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#05080c" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #1a2230", display: "flex", alignItems: "center", gap: 10 }}>
        <span className="font-cyber" style={{ fontSize: 16, color: "#b6f23a" }}>◈ MISSION BOARD</span>
        <span style={{ fontSize: 11, color: connected ? "#2bd47f" : "#ff8844" }}>{connected ? "● live" : "○ reconnecting"}</span>
        <span style={{ flex: 1 }} />
        <button onClick={seedBoard} style={btn}>⟳ Refresh</button>
      </div>
      <div style={{ flex: 1, display: "flex", gap: 12, padding: 12, overflowX: "auto", scrollSnapType: "x proximity" }}>
        {ordered.map((col) => {
          const cards = cardsFor(col.persona);
          const active = cards.filter((c) => c.status !== "done" && c.status !== "failed");
          const completed = cards.filter((c) => c.status === "done" || c.status === "failed");
          const running = cards.filter((c) => c.status === "running").length;
          const showDone = !!doneOpen[col.persona];
          const accent = col.color || "#b6f23a";
          return (
            <div key={col.persona} style={{ minWidth: 300, maxWidth: 340, flex: "0 0 320px", display: "flex", flexDirection: "column", background: "#080c12", border: `1px solid ${accent}22`, borderRadius: 8, scrollSnapAlign: "start" }}>
              <div style={{ padding: "10px 12px", borderBottom: `1px solid ${accent}22` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{PERSONA_ICON[col.icon] || (col.isBacklog ? "📋" : "◇")}</span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: accent }}>{col.persona}{col.isBacklog ? "  ·  PLAN" : ""}</span>
                  <span style={{ flex: 1 }} />
                  {!col.isBacklog && <span style={{ fontSize: 10, color: "#9aa6b6" }}>{running}/{col.wipLimit ?? "∞"}</span>}
                </div>
                {!col.isBacklog && <div style={{ fontSize: 10, color: "#9aa6b6", marginTop: 2 }}>default · {col.provider} · {col.model || "—"}</div>}
                {!col.isBacklog && (
                  composeFor === col.persona ? (
                    <div style={{ marginTop: 6 }}>
                      <input value={cTitle} onChange={(e) => setCTitle(e.target.value)} placeholder="task title" style={inp} autoFocus />
                      <textarea value={cBody} onChange={(e) => setCBody(e.target.value)} placeholder="task details…" rows={2} style={{ ...inp, marginTop: 4, resize: "vertical" }} />
                      <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                        <button onClick={() => createCard(col.persona)} style={{ ...btn, color: accent, borderColor: accent }}>Delegate</button>
                        <button onClick={() => { setComposeFor(null); setCTitle(""); setCBody(""); }} style={btn}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setComposeFor(col.persona)} style={{ ...btn, marginTop: 6, width: "100%" }}>+ delegate task</button>
                  )
                )}
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px", minHeight: 80 }}>
                {cards.length === 0 && <div style={{ fontSize: 11, color: "#3a4a5a", textAlign: "center", padding: "16px 0" }}>no cards</div>}
                {active.map((c) => <CardView key={c.id} card={c} expanded={expanded === c.id} onToggle={() => setExpanded(expanded === c.id ? null : c.id)} />)}
                {completed.length > 0 && (
                  <>
                    <div onClick={() => setDoneOpen((o) => ({ ...o, [col.persona]: !o[col.persona] }))}
                      style={{ cursor: "pointer", fontSize: 11, color: "#9aa6b6", padding: "6px 2px", marginTop: 4, borderTop: "1px solid #14202c", userSelect: "none" }}>
                      {showDone ? "▾" : "▸"} ✓ {completed.length} completed
                    </div>
                    {showDone && (
                      <div style={{ opacity: 0.55 }}>
                        {completed.map((c) => <CardView key={c.id} card={c} expanded={expanded === c.id} onToggle={() => setExpanded(expanded === c.id ? null : c.id)} />)}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
        {ordered.length === 0 && (
          <div style={{ color: "#9aa6b6", fontSize: 13, padding: 20 }}>
            No agent columns yet. Set a persona's provider to <b>openrouter</b> — it becomes an agent column automatically.
          </div>
        )}
      </div>
    </div>
  );
}
