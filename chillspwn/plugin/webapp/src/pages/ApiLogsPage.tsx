// ── ApiLogsPage ─────────────────────────────────────────────────────
// Splunk-style monitor for Claude API request/response traffic.
//
// Each spawned `claude` CLI run streams JSONL events (stream-json) which
// the server captures to /root/.claude/chillspwn/session-logs/<id>.stdout.jsonl
//
// This page provides:
//   • Left pane:   list of sessions with rollup stats (tokens, cost, status)
//   • Middle pane: chronological event list for the selected session,
//                  with search, type filter, and live tail (SSE)
//   • Right pane:  the FULL raw JSON of the selected event — that's the
//                  actual Claude request/response payload
//
// Conventions:
//   • All inline styles use --bg-primary / --bg-surface / --text-* / etc.
//     so the page stays on theme with the rest of the dark UI.
//   • Numbers shown without thousands separators on purpose — operator UX.

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { CyberDropdown } from "../components/CyberDropdown";

// ── Types from the server ──────────────────────────────────────────
interface ApiEventTokens {
  in?: number;
  out?: number;
  cacheRead?: number;
  cacheCreation?: number;
}
interface ApiEventSummary {
  session: string;
  line: number;
  ts: string | null;
  type: string;
  subtype?: string;
  model?: string;
  uuid?: string;
  endpoint?: string;     // upstream API path (proxy sessions)
  method?: string;       // HTTP method (proxy sessions)
  summary: string;
  toolName?: string;
  tokens?: ApiEventTokens;
}
interface SessionSummary {
  id: string;
  persona: string | null;
  model: string | null;
  cliSessionId: string | null;
  kind: "cli" | "proxy";   // CLI subprocess vs Anthropic API proxy capture
  endpoint: string | null; // upstream API path (proxy sessions only)
  method: string | null;   // HTTP method (proxy sessions only)
  lines: number;
  sizeBytes: number;
  mtime: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheRead: number;
  totalCostUsd: number | null;
  finalStatus: string;
}

// ── Visual helpers ─────────────────────────────────────────────────
// Color-code event types — same palette across the list + detail border
const TYPE_COLOR: Record<string, string> = {
  system: "var(--text-muted)",
  assistant: "var(--neon-cyan)",
  user: "var(--neon-green)",
  result: "var(--neon-amber)",
  error: "var(--neon-red)",
};
// Compact human size: 1234 → "1.2k", 1234567 → "1.2M"
function humanNum(n: number): string {
  if (n == null) return "0";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return (n / 1000).toFixed(1) + "k";
  return (n / 1_000_000).toFixed(2) + "M";
}
function humanBytes(n: number): string {
  if (n < 1024) return n + "B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + "K";
  return (n / 1024 / 1024).toFixed(1) + "M";
}
function relTime(iso: string): string {
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return Math.floor(s) + "s ago";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

// ── Reusable styled atoms ──────────────────────────────────────────
const cardStyle: React.CSSProperties = {
  background: "var(--bg-surface)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  border: "1px solid var(--border-color)",
  borderRadius: 8,
  overflow: "hidden",
};
const labelStyle: React.CSSProperties = {
  fontSize: "0.6rem",
  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};
const inputStyle: React.CSSProperties = {
  padding: "5px 9px",
  fontSize: "0.78rem",
  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  borderRadius: 5,
  border: "1px solid var(--border-color)",
  background: "var(--bg-primary)",
  color: "var(--text-primary)",
  outline: "none",
};

// Pretty-print JSON with simple syntax coloring (keys cyan, strings amber, numbers green)
function JsonView({ data }: { data: any }) {
  const json = JSON.stringify(data, null, 2);
  // Tokenize: keys ("…":), strings ("…"), numbers, booleans, null
  const html = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/(&quot;[^&]*?&quot;)(\s*:)/g, '<span style="color:var(--neon-cyan)">$1</span>$2')
    .replace(/:\s*(&quot;[^&]*?&quot;)/g, ': <span style="color:var(--neon-amber)">$1</span>')
    .replace(/:\s*(-?\d+\.?\d*)/g, ': <span style="color:var(--neon-green)">$1</span>')
    .replace(/:\s*(true|false|null)/g, ': <span style="color:var(--neon-purple)">$1</span>');
  return (
    <pre
      style={{
        margin: 0,
        padding: 12,
        fontSize: "0.72rem",
        fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        lineHeight: 1.55,
        color: "var(--text-primary)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ── Main page component ────────────────────────────────────────────
export default function ApiLogsPage() {
  // ── State ────────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [events, setEvents] = useState<ApiEventSummary[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<{ line: number; summary: ApiEventSummary } | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [endpointFilter, setEndpointFilter] = useState("");      // /v1/messages, /v1/complete, …
  const [sessionKindFilter, setSessionKindFilter] = useState(""); // "cli" | "proxy" | ""
  const [liveTail, setLiveTail] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [stickToBottom, setStickToBottom] = useState(true);

  const sseRef = useRef<EventSource | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ── Responsive: single-pane drill-down on narrow screens ─────────
  // < 900px: show ONE pane at a time, navigate with back buttons (mobile-style).
  // ≥ 900px: classic 3-pane Splunk layout.
  const [isNarrow, setIsNarrow] = useState(typeof window !== "undefined" ? window.innerWidth < 900 : false);
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // On narrow screens we track which "page" the user is on:
  //   "sessions" → list of sessions (left pane equivalent)
  //   "events"   → event stream for the selected session (middle pane)
  //   "detail"   → full JSON of one event (right pane)
  const [mobilePane, setMobilePane] = useState<"sessions" | "events" | "detail">("sessions");

  // ── Load session list ────────────────────────────────────────────
  const loadSessions = useCallback(() => {
    setSessionsLoading(true);
    fetch("/api/api-events/sessions")
      .then((r) => r.json())
      .then((data) => {
        setSessions(data.sessions || []);
        setSessionsLoading(false);
        // Auto-select most recent if nothing selected
        if (!selectedSession && data.sessions?.length) {
          setSelectedSession(data.sessions[0].id);
        }
      })
      .catch(() => setSessionsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { loadSessions(); }, [loadSessions]);

  // ── Debounce the search box (350ms) ──────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // ── Load events whenever filters/session change ──────────────────
  useEffect(() => {
    if (!selectedSession) {
      setEvents([]);
      return;
    }
    setEventsLoading(true);
    const params = new URLSearchParams({ session: selectedSession });
    if (typeFilter) params.set("type", typeFilter);
    if (endpointFilter) params.set("endpoint", endpointFilter);
    if (debouncedSearch) params.set("q", debouncedSearch);
    params.set("limit", "1000");
    fetch(`/api/api-events?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setEvents(data.events || []);
        setEventsLoading(false);
      })
      .catch(() => setEventsLoading(false));
  }, [selectedSession, typeFilter, endpointFilter, debouncedSearch]);

  // ── Load full JSON for the selected event ────────────────────────
  useEffect(() => {
    if (!selectedEvent || !selectedSession) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    fetch(`/api/api-events/${selectedSession}/${selectedEvent.line}`)
      .then((r) => r.json())
      .then((data) => {
        setDetail(data.event || null);
        setDetailLoading(false);
      })
      .catch(() => { setDetail(null); setDetailLoading(false); });
  }, [selectedEvent, selectedSession]);

  // ── Live tail via SSE ────────────────────────────────────────────
  useEffect(() => {
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
    if (!liveTail || !selectedSession) return;
    const es = new EventSource(`/api/api-events/stream?session=${selectedSession}`);
    es.onmessage = (e) => {
      try {
        const { summary } = JSON.parse(e.data);
        if (!summary) return;
        // Honor active filters during live tail too
        if (typeFilter && summary.type !== typeFilter) return;
        if (debouncedSearch && !JSON.stringify(summary).toLowerCase().includes(debouncedSearch.toLowerCase())) return;
        setEvents((prev) => [...prev, summary]);
      } catch {}
    };
    es.onerror = () => {
      // Browser will auto-retry; nothing to do
    };
    sseRef.current = es;
    return () => { es.close(); sseRef.current = null; };
  }, [liveTail, selectedSession, typeFilter, debouncedSearch]);

  // Auto-scroll the event list when live tailing and the user is at the bottom
  useEffect(() => {
    if (liveTail && stickToBottom && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events, liveTail, stickToBottom]);

  // Track whether the user has scrolled away from the bottom of the events list
  const onListScroll = () => {
    if (!listRef.current) return;
    const el = listRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setStickToBottom(atBottom);
  };

  // ── Distinct endpoints across all proxy sessions (for filter dropdown) ─
  const endpoints = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessions) if (s.endpoint) set.add(s.endpoint);
    return [...set].sort();
  }, [sessions]);

  // Apply session-kind + endpoint filters to the session list (left pane)
  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (sessionKindFilter && s.kind !== sessionKindFilter) return false;
      if (endpointFilter && s.endpoint !== endpointFilter) return false;
      return true;
    });
  }, [sessions, sessionKindFilter, endpointFilter]);

  // ── Top-of-list rollup stats from currently-displayed events ─────
  const stats = useMemo(() => {
    let totIn = 0, totOut = 0, totCache = 0;
    const types: Record<string, number> = {};
    for (const ev of events) {
      if (ev.tokens?.in) totIn += ev.tokens.in;
      if (ev.tokens?.out) totOut += ev.tokens.out;
      if (ev.tokens?.cacheRead) totCache += ev.tokens.cacheRead;
      types[ev.type] = (types[ev.type] || 0) + 1;
    }
    return { totIn, totOut, totCache, types };
  }, [events]);

  // ── Render ───────────────────────────────────────────────────────
  // Auto-advance pane when a session/event is picked on narrow screens
  const pickSession = (id: string) => {
    setSelectedSession(id);
    setSelectedEvent(null);
    if (isNarrow) setMobilePane("events");
  };
  const pickEvent = (ev: ApiEventSummary) => {
    setSelectedEvent({ line: ev.line, summary: ev });
    if (isNarrow) setMobilePane("detail");
  };

  // Visibility helpers — desktop shows everything, narrow shows only active pane
  const showSessions = !isNarrow || mobilePane === "sessions";
  const showEvents   = !isNarrow || mobilePane === "events";
  const showDetail   = !isNarrow || mobilePane === "detail";

  // ── Ask AI state ─────────────────────────────────────────────────
  // Lets the user query the currently-selected event in natural language —
  // backed by `claude -p` (uses your existing Claude Code auth, no API key).
  type AskMsg = { role: "user" | "assistant"; content: string };
  const [askOpen, setAskOpen] = useState(false);
  const [askInput, setAskInput] = useState("");
  const [askHistory, setAskHistory] = useState<AskMsg[]>([]);
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);

  // Reset Ask AI conversation when the user moves to a different event
  useEffect(() => {
    setAskHistory([]);
    setAskInput("");
    setAskError(null);
  }, [selectedEvent?.line, selectedEvent?.summary.session]);

  const submitAsk = async () => {
    if (!selectedEvent || !askInput.trim() || askLoading) return;
    const q = askInput.trim();
    setAskInput("");
    setAskError(null);
    setAskHistory((prev) => [...prev, { role: "user", content: q }]);
    setAskLoading(true);
    try {
      const resp = await fetch(`/api/api-events/${selectedEvent.summary.session}/${selectedEvent.line}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          history: askHistory,   // prior turns, not including the new question
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      setAskHistory((prev) => [...prev, { role: "assistant", content: data.answer || "(no answer)" }]);
    } catch (e: any) {
      setAskError(e.message || String(e));
    } finally {
      setAskLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0, background: "var(--bg-primary)", flexDirection: isNarrow ? "column" : "row" }}>
      {/* ── LEFT PANE: session list ───────────────────────────── */}
      {showSessions && <div
        style={{
          width: isNarrow ? "100%" : 240,
          flexShrink: 0,
          borderRight: isNarrow ? "none" : "1px solid var(--border-color)",
          background: "var(--bg-surface)",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          flex: isNarrow ? 1 : "0 0 auto",
        }}
      >
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-color)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div>
              <div style={{ ...labelStyle, color: "var(--neon-cyan)" }}>Sessions</div>
              <div style={{ ...labelStyle, marginTop: 2 }}>
                {filteredSessions.length} / {sessions.length}
              </div>
            </div>
            <button
              onClick={loadSessions}
              title="Reload session list"
              style={{
                padding: "4px 8px",
                fontSize: "0.65rem",
                borderRadius: 4,
                border: "1px solid var(--border-bright)",
                background: "transparent",
                color: "var(--text-dim)",
                cursor: "pointer",
              }}
            >
              ↻
            </button>
          </div>
          {/* Kind filter: CLI vs Proxy sessions */}
          <div style={{ marginBottom: 6 }}>
            <CyberDropdown
              value={sessionKindFilter}
              onChange={setSessionKindFilter}
              fullWidth
              size="sm"
              placeholder="All session kinds"
              options={[
                { id: "", label: "All session kinds" },
                { id: "cli", label: "CLI (claude subprocess)" },
                { id: "proxy", label: "Proxy (Anthropic API)" },
              ]}
            />
          </div>
          {/* Endpoint filter — populated from distinct proxy endpoints */}
          {endpoints.length > 0 && (
            <CyberDropdown
              value={endpointFilter}
              onChange={setEndpointFilter}
              fullWidth
              size="sm"
              placeholder="All endpoints"
              options={[
                { id: "", label: "All endpoints" },
                ...endpoints.map((ep) => ({ id: ep, label: ep })),
              ]}
            />
          )}
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {sessionsLoading && <div style={{ padding: 12, ...labelStyle }}>Loading…</div>}
          {!sessionsLoading && filteredSessions.length === 0 && (
            <div style={{ padding: 12, ...labelStyle }}>
              {sessions.length === 0 ? "No sessions captured yet." : "No sessions match the active filters."}
            </div>
          )}
          {filteredSessions.map((s) => {
            const active = selectedSession === s.id;
            return (
              <button
                key={s.id}
                onClick={() => pickSession(s.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 12px",
                  background: active ? "var(--jarvis-blue-faint)" : "transparent",
                  borderLeft: active ? "2px solid var(--neon-cyan)" : "2px solid transparent",
                  borderBottom: "1px solid var(--border-color)",
                  cursor: "pointer",
                  color: "var(--text-primary)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{
                    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                    fontSize: "0.72rem",
                    color: active ? "var(--neon-cyan)" : "var(--text-primary)",
                  }}>
                    {s.id.slice(-12)}
                  </span>
                  <span style={{
                    fontSize: "0.55rem",
                    padding: "1px 5px",
                    borderRadius: 3,
                    border: `1px solid ${s.finalStatus === "active" ? "var(--neon-green)" : "var(--border-color)"}`,
                    color: s.finalStatus === "active" ? "var(--neon-green)" : "var(--text-muted)",
                  }}>
                    {s.finalStatus.toUpperCase()}
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                  <span style={{ ...labelStyle, color: s.kind === "proxy" ? "var(--neon-amber)" : "var(--text-dim)" }}>
                    {s.kind === "proxy" ? `PROXY ${s.method || ""}` : (s.persona || "—")}
                  </span>
                  <span style={{ ...labelStyle }}>{relTime(s.mtime)}</span>
                </div>
                {/* Endpoint badge — only for proxy sessions */}
                {s.endpoint && (
                  <div style={{
                    ...labelStyle,
                    marginTop: 3,
                    color: "var(--neon-cyan)",
                    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }} title={s.endpoint}>
                    {s.endpoint}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 3 }}>
                  <span style={{ ...labelStyle }} title="events">{s.lines} ev</span>
                  <span style={{ ...labelStyle }} title="in/out tokens">{humanNum(s.totalInputTokens)}↓ {humanNum(s.totalOutputTokens)}↑</span>
                  <span style={{ ...labelStyle }} title="file size">{humanBytes(s.sizeBytes)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>}

      {/* ── MIDDLE PANE: event list with toolbar + stats ───────── */}
      {showEvents && <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        {/* Mobile back button → return to session list */}
        {isNarrow && (
          <button
            onClick={() => setMobilePane("sessions")}
            style={{
              padding: "8px 12px",
              background: "var(--bg-surface)",
              border: "none",
              borderBottom: "1px solid var(--border-color)",
              color: "var(--neon-cyan)",
              textAlign: "left",
              fontSize: "0.78rem",
              fontFamily: '"JetBrains Mono", "Fira Code", monospace',
              cursor: "pointer",
            }}
          >
            ← Sessions ({selectedSession?.slice(-12) || "—"})
          </button>
        )}
        {/* Toolbar */}
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid var(--border-color)",
            background: "var(--bg-surface)",
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexShrink: 0,
            flexWrap: "wrap",
          }}
        >
          <input
            type="text"
            placeholder="Search events (full-line substring)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="glow-input"
            style={{ ...inputStyle, flex: 1, minWidth: 200 }}
          />
          <CyberDropdown
            value={typeFilter}
            onChange={setTypeFilter}
            size="sm"
            placeholder="All types"
            options={[
              { id: "", label: "All types" },
              { id: "system", label: "system" },
              { id: "assistant", label: "assistant" },
              { id: "user", label: "user (tool_result)" },
              { id: "result", label: "result" },
            ]}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", color: liveTail ? "var(--neon-green)" : "var(--text-dim)" }}>
            <input
              type="checkbox"
              checked={liveTail}
              onChange={(e) => setLiveTail(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            <span style={{ ...labelStyle, color: "inherit" }}>● LIVE TAIL</span>
          </label>
        </div>

        {/* Stats strip */}
        <div
          style={{
            padding: "6px 12px",
            borderBottom: "1px solid var(--border-color)",
            background: "var(--bg-primary)",
            display: "flex",
            gap: 16,
            flexShrink: 0,
          }}
        >
          <div><span style={labelStyle}>EVENTS </span><span style={{ color: "var(--neon-cyan)", fontFamily: "monospace", fontSize: "0.78rem" }}>{events.length}</span></div>
          <div><span style={labelStyle}>IN </span><span style={{ color: "var(--neon-cyan)", fontFamily: "monospace", fontSize: "0.78rem" }}>{humanNum(stats.totIn)}</span></div>
          <div><span style={labelStyle}>OUT </span><span style={{ color: "var(--neon-amber)", fontFamily: "monospace", fontSize: "0.78rem" }}>{humanNum(stats.totOut)}</span></div>
          <div><span style={labelStyle}>CACHE READ </span><span style={{ color: "var(--neon-green)", fontFamily: "monospace", fontSize: "0.78rem" }}>{humanNum(stats.totCache)}</span></div>
          {Object.entries(stats.types).map(([t, n]) => (
            <div key={t}>
              <span style={labelStyle}>{t.toUpperCase()} </span>
              <span style={{ color: TYPE_COLOR[t] || "var(--text-primary)", fontFamily: "monospace", fontSize: "0.78rem" }}>{n}</span>
            </div>
          ))}
        </div>

        {/* Event list */}
        <div
          ref={listRef}
          onScroll={onListScroll}
          style={{ flex: 1, overflowY: "auto", background: "var(--bg-primary)", minHeight: 0 }}
        >
          {eventsLoading && <div style={{ padding: 12, ...labelStyle }}>Loading events…</div>}
          {!eventsLoading && events.length === 0 && (
            <div style={{ padding: 12, ...labelStyle }}>
              {selectedSession ? "No events match the current filters." : "Select a session on the left."}
            </div>
          )}
          {events.map((ev, i) => {
            const active = selectedEvent?.line === ev.line && selectedEvent?.summary.session === ev.session;
            const color = TYPE_COLOR[ev.type] || "var(--text-primary)";
            return (
              <button
                key={`${ev.session}-${ev.line}-${i}`}
                onClick={() => pickEvent(ev)}
                style={{
                  display: "flex",
                  width: "100%",
                  textAlign: "left",
                  padding: "5px 12px",
                  gap: 10,
                  borderBottom: "1px solid var(--border-color)",
                  background: active ? "var(--jarvis-blue-faint)" : "transparent",
                  borderLeft: `3px solid ${active ? "var(--neon-cyan)" : color}`,
                  cursor: "pointer",
                  alignItems: "center",
                  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                  fontSize: "0.72rem",
                  color: "var(--text-primary)",
                }}
              >
                <span style={{ color: "var(--text-muted)", width: 50, flexShrink: 0 }}>#{ev.line}</span>
                <span style={{ color, width: 72, flexShrink: 0, fontWeight: 600 }}>
                  {ev.type}{ev.subtype ? `/${ev.subtype}` : ""}
                </span>
                {ev.toolName && (
                  <span style={{ color: "var(--neon-amber)", width: 110, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ev.toolName}
                  </span>
                )}
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)" }}>
                  {ev.summary}
                </span>
                {ev.tokens && (
                  <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>
                    {ev.tokens.in ? `${humanNum(ev.tokens.in)}↓` : ""} {ev.tokens.out ? `${humanNum(ev.tokens.out)}↑` : ""}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>}

      {/* ── RIGHT PANE: full event JSON ────────────────────────── */}
      {showDetail && <div
        style={{
          width: isNarrow ? "100%" : 540,
          flexShrink: 0,
          borderLeft: isNarrow ? "none" : "1px solid var(--border-color)",
          background: "var(--bg-surface)",
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          flex: isNarrow ? 1 : "0 0 auto",
        }}
      >
        {/* Mobile back button → return to events list */}
        {isNarrow && (
          <button
            onClick={() => setMobilePane("events")}
            style={{
              padding: "8px 12px",
              background: "var(--bg-surface)",
              border: "none",
              borderBottom: "1px solid var(--border-color)",
              color: "var(--neon-cyan)",
              textAlign: "left",
              fontSize: "0.78rem",
              fontFamily: '"JetBrains Mono", "Fira Code", monospace',
              cursor: "pointer",
            }}
          >
            ← Events
          </button>
        )}
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-color)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ ...labelStyle, color: "var(--neon-cyan)" }}>Event Detail</div>
            {selectedEvent && (
              <div style={{ ...labelStyle, marginTop: 2 }}>
                {selectedEvent.summary.type}{selectedEvent.summary.subtype ? `/${selectedEvent.summary.subtype}` : ""} · line #{selectedEvent.line}
              </div>
            )}
          </div>
          {detail && (
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => setAskOpen((v) => !v)}
                title="Ask Claude about this event"
                style={{
                  padding: "4px 10px",
                  fontSize: "0.65rem",
                  borderRadius: 4,
                  border: `1px solid ${askOpen ? "var(--neon-cyan)" : "var(--border-bright)"}`,
                  background: askOpen ? "var(--jarvis-blue-faint)" : "transparent",
                  color: askOpen ? "var(--neon-cyan)" : "var(--text-dim)",
                  cursor: "pointer",
                }}
              >
                🔍 ASK AI
              </button>
              <button
                onClick={() => navigator.clipboard.writeText(JSON.stringify(detail, null, 2))}
                title="Copy raw JSON to clipboard"
                style={{
                  padding: "4px 10px",
                  fontSize: "0.65rem",
                  borderRadius: 4,
                  border: "1px solid var(--border-bright)",
                  background: "transparent",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                }}
              >
                COPY JSON
              </button>
            </div>
          )}
        </div>

        {/* ── Ask AI panel — collapsible chat over the selected event ── */}
        {askOpen && selectedEvent && (
          <div style={{
            borderBottom: "1px solid var(--border-color)",
            background: "var(--bg-primary)",
            display: "flex",
            flexDirection: "column",
            maxHeight: "45%",
            flexShrink: 0,
          }}>
            <div style={{
              padding: "8px 12px",
              borderBottom: "1px solid var(--border-color)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <div style={{ ...labelStyle, color: "var(--neon-cyan)" }}>
                ASK AI · powered by claude -p (uses your Claude Code auth)
              </div>
              {askHistory.length > 0 && (
                <button
                  onClick={() => { setAskHistory([]); setAskError(null); }}
                  style={{
                    fontSize: "0.6rem",
                    color: "var(--text-muted)",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  CLEAR
                </button>
              )}
            </div>

            {/* Conversation history */}
            <div style={{ overflowY: "auto", flex: 1, padding: 8, minHeight: 80 }}>
              {askHistory.length === 0 && !askLoading && (
                <div style={{ ...labelStyle, padding: 4 }}>
                  Ask anything about this event — e.g. "what tool was called?", "what's in the system prompt?", "why did this fail?"
                </div>
              )}
              {askHistory.map((m, i) => (
                <div key={i} style={{
                  marginBottom: 8,
                  padding: "6px 10px",
                  borderRadius: 6,
                  background: m.role === "user" ? "var(--jarvis-blue-faint)" : "var(--bg-surface)",
                  border: `1px solid ${m.role === "user" ? "var(--border-bright)" : "var(--border-color)"}`,
                  fontSize: "0.78rem",
                  color: "var(--text-primary)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}>
                  <div style={{ ...labelStyle, color: m.role === "user" ? "var(--neon-cyan)" : "var(--neon-amber)", marginBottom: 3 }}>
                    {m.role === "user" ? "YOU" : "CLAUDE"}
                  </div>
                  {m.content}
                </div>
              ))}
              {askLoading && (
                <div style={{ ...labelStyle, padding: 4, color: "var(--neon-amber)" }}>
                  <span className="animate-pulse">CLAUDE THINKING…</span>
                </div>
              )}
              {askError && (
                <div style={{ ...labelStyle, padding: 4, color: "var(--neon-red)" }}>
                  ERROR: {askError}
                </div>
              )}
            </div>

            {/* Input row */}
            <div style={{ padding: 8, borderTop: "1px solid var(--border-color)", display: "flex", gap: 6 }}>
              <input
                type="text"
                value={askInput}
                onChange={(e) => setAskInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitAsk(); }}
                placeholder="Ask about this event…"
                disabled={askLoading}
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                onClick={submitAsk}
                disabled={askLoading || !askInput.trim()}
                style={{
                  padding: "5px 14px",
                  fontSize: "0.7rem",
                  borderRadius: 5,
                  border: "1px solid var(--neon-cyan)",
                  background: askLoading || !askInput.trim() ? "transparent" : "var(--neon-cyan)",
                  color: askLoading || !askInput.trim() ? "var(--text-muted)" : "#000",
                  cursor: askLoading || !askInput.trim() ? "not-allowed" : "pointer",
                  fontWeight: 600,
                }}
              >
                {askLoading ? "…" : "ASK"}
              </button>
            </div>
          </div>
        )}
        <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
          {!selectedEvent && (
            <div style={{ padding: 14, ...labelStyle }}>
              Select an event on the left to view the raw Claude API payload.
            </div>
          )}
          {selectedEvent && detailLoading && <div style={{ padding: 14, ...labelStyle }}>Loading…</div>}
          {selectedEvent && !detailLoading && detail && <JsonView data={detail} />}
          {selectedEvent && !detailLoading && !detail && (
            <div style={{ padding: 14, ...labelStyle, color: "var(--neon-red)" }}>
              Event not found (the log file may have been rotated).
            </div>
          )}
        </div>
      </div>}
    </div>
  );
}
