import { useState, useEffect, useMemo } from "react";

// ── LLM LOGS ─────────────────────────────────────────────────────────────────
// Raw LLM audit trail: the exact request sent to / response received from the LLM,
// one level above parsing. Two backends write to <engagement>/logs/llm_raw.jsonl:
//   • Claude path (claude -p, subscription OAuth) — server-side rawLlmLog
//   • OpenRouter path (api key) — orchestrator raw_log
// Filterable by engagement; each entry shows provider/model/auth + direction.

interface Engagement { name: string; source: string; entries: number; lastModified: string; }
interface LogEntry {
  ts?: string;
  provider?: string;
  auth?: string;
  model?: string;
  direction?: "request" | "response";
  endpoint?: string;
  kind?: string;
  iter?: number;
  sessionId?: string;
  payload?: any;
  parseError?: boolean;
  raw?: string;
}

const C = {
  bg: "#0a0e14", panel: "#161c27", border: "rgba(182,242,58,0.18)",
  green: "#2bd47f", cyan: "#b6f23a", amber: "#ffae42", red: "#ff4d4d",
  dim: "#9aa6b6", mono: "'JetBrains Mono','Fira Code',monospace",
};

export default function LlmLogsPage({ navCollapsed, onToggleNav }: { navCollapsed?: boolean; onToggleNav?: () => void } = {}) {
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [providerFilter, setProviderFilter] = useState<"all" | "anthropic" | "openrouter" | "openai-codex" | "gemini" | "xai-grok">("all");
  const [dirFilter, setDirFilter] = useState<"all" | "request" | "response">("all");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [hideList, setHideList] = useState(false);  // hide the in-page engagements menu for more width

  const ctrlBtn = {
    background: "none", border: `1px solid ${C.border}`, color: C.dim,
    cursor: "pointer", fontSize: 10, padding: "3px 8px", borderRadius: 4, whiteSpace: "nowrap" as const,
  };

  const loadEngagements = () => {
    fetch("/api/llm-logs/engagements").then((r) => r.json()).then((list: Engagement[]) => {
      setEngagements(list);
      if (!selected && list.length) selectEngagement(list[0].name);
    }).catch(() => {});
  };
  useEffect(loadEngagements, []);

  const selectEngagement = (name: string) => {
    setSelected(name);
    setLoading(true);
    setExpanded(new Set());
    fetch(`/api/llm-logs?engagement=${encodeURIComponent(name)}&limit=1000`)
      .then((r) => r.json())
      .then((j) => setEntries(j.entries || []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  };

  const filtered = useMemo(() => entries.filter((e) =>
    (providerFilter === "all" || e.provider === providerFilter) &&
    (dirFilter === "all" || e.direction === dirFilter)
  ), [entries, providerFilter, dirFilter]);

  const toggle = (i: number) => setExpanded((prev) => {
    const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n;
  });

  const previewOf = (e: LogEntry): string => {
    if (e.parseError) return e.raw || "(unparseable)";
    const p = e.payload;
    if (p == null) return "";
    if (typeof p === "string") return p.slice(0, 200);
    try {
      // Surface the most useful bit per shape
      if (p.argv) return "spawn argv (" + p.argv.length + " args) + turn: " + JSON.stringify(p.turn_prompt || "").slice(0, 120);
      if (p.turn_prompt) return "turn: " + String(p.turn_prompt).slice(0, 160);
      if (p.messages) return p.messages.length + " messages, model " + (p.model || "");
      if (p.choices) return "choices[0]: " + JSON.stringify(p.choices[0]?.message || {}).slice(0, 160);
      if (p.http_error) return "HTTP " + p.http_error + ": " + (p.detail || "");
      return JSON.stringify(p).slice(0, 200);
    } catch { return JSON.stringify(p).slice(0, 200); }
  };

  const fmt = (e: LogEntry) => e.parseError ? (e.raw || "") : (typeof e.payload === "string" ? e.payload : JSON.stringify(e.payload, null, 2));

  return (
    <div style={{ display: "flex", height: "100%", background: C.bg, color: C.dim, fontFamily: C.mono, fontSize: 12 }}>
      {/* Left: engagements (hideable for more log width) */}
      {!hideList && (
      <div style={{ width: 210, borderRight: `1px solid ${C.border}`, overflowY: "auto", padding: 8, flexShrink: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 6px 8px" }}>
          <span style={{ color: C.cyan, fontSize: 11, letterSpacing: "0.1em" }}>ENGAGEMENTS</span>
          <button onClick={loadEngagements} title="Refresh" style={{ background: "none", border: "none", color: C.dim, cursor: "pointer", fontSize: 13 }}>↻</button>
        </div>
        {engagements.length === 0 && <div style={{ padding: 6, fontSize: 10, color: C.dim }}>No LLM logs yet.</div>}
        {engagements.map((e) => (
          <button key={e.name} onClick={() => selectEngagement(e.name)}
            style={{
              display: "block", width: "100%", textAlign: "left", padding: "7px 9px", marginBottom: 4,
              background: selected === e.name ? "rgba(182,242,58,0.1)" : "transparent",
              border: "none", borderLeft: `2px solid ${selected === e.name ? C.cyan : "transparent"}`,
              color: selected === e.name ? C.green : C.dim, cursor: "pointer", fontFamily: C.mono, fontSize: 11.5,
            }}>
            {e.name}
            <div style={{ fontSize: 9, color: C.dim, marginTop: 2 }}>{e.entries} entries · {e.source}</div>
          </button>
        ))}
      </div>
      )}

      {/* Right: entries */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* filter bar */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap" }}>
          {/* layout toggles — reclaim width by hiding the app nav and/or the engagements list */}
          {onToggleNav && (
            <button onClick={onToggleNav} style={ctrlBtn}
              title={navCollapsed ? "Show navigation menu" : "Hide navigation menu"}>
              {navCollapsed ? "⮞" : "⮜"} Nav
            </button>
          )}
          <button onClick={() => setHideList((v) => !v)} style={ctrlBtn}
            title={hideList ? "Show engagements list" : "Hide engagements list"}>
            {hideList ? "⮞" : "⮜"} List
          </button>
          <span style={{ color: C.cyan, fontSize: 11 }}>{selected || "—"}</span>
          <span style={{ color: C.dim, fontSize: 10 }}>· {filtered.length}/{entries.length}</span>
          <span style={{ flex: 1 }} />
          {(["all", "anthropic", "openrouter", "openai-codex", "gemini", "xai-grok"] as const).map((p) => (
            <button key={p} onClick={() => setProviderFilter(p)} style={chip(providerFilter === p, providerMeta(p).color)}>{providerMeta(p).label}</button>
          ))}
          <span style={{ color: C.dim }}>|</span>
          {(["all", "request", "response"] as const).map((d) => (
            <button key={d} onClick={() => setDirFilter(d)} style={chip(dirFilter === d, C.green)}>{d}</button>
          ))}
          <button onClick={() => selected && selectEngagement(selected)} title="Reload entries" style={{ background: "none", border: `1px solid ${C.border}`, color: C.dim, cursor: "pointer", fontSize: 11, padding: "3px 8px", borderRadius: 4 }}>↻</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {loading && <div style={{ padding: 12, color: C.dim }}>loading…</div>}
          {!loading && filtered.length === 0 && <div style={{ padding: 12, color: C.dim }}>No entries.</div>}
          {filtered.map((e, i) => {
            const pm = providerMeta(e.provider || "openrouter");
            const isReq = e.direction === "request";
            return (
              <div key={i} style={{ marginBottom: 6, border: `1px solid ${C.border}`, borderRadius: 5, overflow: "hidden" }}>
                <button onClick={() => toggle(i)} style={{
                  display: "flex", gap: 8, alignItems: "center", width: "100%", textAlign: "left",
                  padding: "6px 9px", background: "transparent", border: "none", cursor: "pointer", fontFamily: C.mono,
                }}>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
                    color: isReq ? C.cyan : C.green, border: `1px solid ${isReq ? C.cyan : C.green}` }}>
                    {isReq ? "▲ REQ" : "▼ RESP"}
                  </span>
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 3,
                    color: pm.color, border: `1px solid ${pm.color}` }}>
                    {pm.label}
                  </span>
                  <span style={{ fontSize: 10, color: C.dim, whiteSpace: "nowrap" }}>{e.model}</span>
                  {e.kind && <span style={{ fontSize: 9, color: C.dim }}>· {e.kind}{e.iter != null ? `#${e.iter}` : ""}</span>}
                  <span style={{ flex: 1, fontSize: 10, color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {previewOf(e)}
                  </span>
                  <span style={{ fontSize: 9, color: C.dim, whiteSpace: "nowrap" }}>{e.ts?.slice(11, 19)}</span>
                </button>
                {expanded.has(i) && (
                  <div style={{ borderTop: `1px solid ${C.border}`, padding: 8, background: "#070b14" }}>
                    <div style={{ fontSize: 9, color: C.dim, marginBottom: 6 }}>
                      auth: {e.auth || "?"}{e.endpoint ? ` · ${e.endpoint}` : ""}{e.sessionId ? ` · ${e.sessionId}` : ""}
                    </div>
                    <pre style={{ margin: 0, fontSize: 10.5, lineHeight: 1.5, color: "#cfe3f5", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 420, overflowY: "auto" }}>
                      {fmt(e)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Provider → display label + badge/chip color. Keeps the LLM-logs filter + badges accurate now
// that the shared orchestrator backend serves openrouter / codex / gemini (not just openrouter).
function providerMeta(p: string): { label: string; color: string } {
  switch (p) {
    case "openrouter": return { label: "OpenRouter", color: "#ffae42" };   // amber
    case "openai-codex": return { label: "Codex", color: "#6cb6ff" };      // blue
    case "gemini": return { label: "Gemini", color: "#ff8adb" };           // magenta
    case "xai-grok": return { label: "Grok ACP", color: "#2bd47f" };       // green
    case "anthropic": return { label: "Anthropic", color: "#b07cff" };     // purple
    case "all": return { label: "all", color: "#b6f23a" };                 // cyan
    default: return { label: p, color: "#9aa6b6" };
  }
}

function chip(active: boolean, color: string): React.CSSProperties {
  return {
    fontSize: 10, padding: "2px 8px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace",
    border: `1px solid ${active ? color : "rgba(255,255,255,0.12)"}`,
    background: active ? `${color}1a` : "transparent",
    color: active ? color : "#9aa6b6", fontWeight: active ? 700 : 400,
  };
}
