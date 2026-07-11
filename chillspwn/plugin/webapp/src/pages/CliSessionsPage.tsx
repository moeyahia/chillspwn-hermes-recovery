import { useState, useEffect, useCallback } from "react";
import { copyToClipboard } from "../lib/clipboard";

interface CliSession {
  sessionId: string;
  project: string;
  cwd: string;
  title: string;
  preview: string;
  messageCount: number;
  lastModified: string;
  size: number;
}

interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

export default function CliSessionsPage({ onResumeSession }: { onResumeSession?: (sessionId: string, title: string, cwd: string) => void }) {
  const [sessions, setSessions] = useState<CliSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CliSession | null>(null);
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchSessions = useCallback(() => {
    setLoading(true);
    fetch("/api/cli-sessions")
      .then((r) => r.json())
      .then((data) => { setSessions(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const loadHistory = useCallback((session: CliSession) => {
    setSelected(session);
    setHistoryLoading(true);
    fetch(`/api/cli-sessions/${session.sessionId}/history?limit=30`)
      .then((r) => r.json())
      .then((data) => { setHistory(data.messages || []); setHistoryLoading(false); })
      .catch(() => setHistoryLoading(false));
  }, []);

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      {/* Session list */}
      <div style={{
        width: selected ? "40%" : "100%",
        borderRight: selected ? "1px solid var(--border-color)" : "none",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        transition: "width 0.2s ease",
      }}>
        <div style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--border-color)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexShrink: 0,
        }}>
          <div>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--jarvis-blue)" }}>
              CLI Sessions
            </span>
            <span style={{ fontSize: 9, color: "var(--text-muted)", marginLeft: 6 }}>
              {sessions.length} found
            </span>
          </div>
          <button
            onClick={fetchSessions}
            style={{
              fontSize: 9, padding: "3px 8px", borderRadius: 3,
              border: "1px solid var(--border-color)", color: "var(--text-dim)",
              background: "transparent", cursor: "pointer",
            }}
          >
            Refresh
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 4 }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 30, color: "var(--text-muted)", fontSize: 10 }}>
              Loading sessions...
            </div>
          ) : sessions.map((s) => (
            <button
              key={s.sessionId}
              onClick={() => loadHistory(s)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                borderRadius: 5,
                marginBottom: 2,
                background: selected?.sessionId === s.sessionId ? "rgba(182,242,58,0.08)" : "transparent",
                borderLeft: selected?.sessionId === s.sessionId ? "2px solid var(--jarvis-blue)" : "2px solid transparent",
                border: "none",
                borderLeftWidth: 2,
                borderLeftStyle: "solid",
                borderLeftColor: selected?.sessionId === s.sessionId ? "var(--jarvis-blue)" : "transparent",
                cursor: "pointer",
                color: "inherit",
                display: "block",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                if (selected?.sessionId !== s.sessionId) e.currentTarget.style.background = "rgba(182,242,58,0.03)";
              }}
              onMouseLeave={(e) => {
                if (selected?.sessionId !== s.sessionId) e.currentTarget.style.background = "transparent";
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-primary)", marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {s.title}
              </div>
              <div style={{ display: "flex", gap: 8, fontSize: 9, color: "var(--text-muted)" }}>
                <span>{s.messageCount} msgs</span>
                <span>{formatSize(s.size)}</span>
                <span>{formatDate(s.lastModified)}</span>
              </div>
              <div style={{ fontSize: 8, fontFamily: "monospace", color: "var(--text-dim)", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: 0.7 }}>
                ID: {s.sessionId}
              </div>
              <div style={{ fontSize: 9, fontFamily: "monospace", color: "var(--text-muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {s.cwd}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* History viewer */}
      {selected && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Header */}
          <div style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}>
            <div style={{ overflow: "hidden" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--jarvis-blue)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {selected.title}
              </div>
              <div style={{ fontSize: 9, fontFamily: "monospace", color: "var(--text-muted)" }}>
                {selected.cwd} · {selected.messageCount} messages
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                <span style={{ fontSize: 8, fontFamily: "monospace", color: "var(--text-dim)", letterSpacing: "0.02em" }}>
                  {selected.sessionId}
                </span>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    const btn = e.currentTarget;
                    const ok = await copyToClipboard(selected.sessionId);
                    btn.textContent = ok ? "✓ Copied" : "✗ Failed";
                    setTimeout(() => { btn.textContent = "Copy ID"; }, 1500);
                  }}
                  style={{
                    fontSize: 10, padding: "4px 10px", borderRadius: 4,
                    border: "1px solid rgba(182,242,58,0.3)",
                    background: "rgba(182,242,58,0.08)", color: "var(--jarvis-blue)",
                    cursor: "pointer", fontWeight: 600, minHeight: 28,
                  }}
                >
                  Copy ID
                </button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
              {onResumeSession && (
                <button
                  onClick={() => onResumeSession(selected.sessionId, selected.title, selected.cwd)}
                  style={{
                    fontSize: 9, padding: "4px 12px", borderRadius: 4,
                    border: "1px solid rgba(182,242,58,0.3)",
                    background: "rgba(182,242,58,0.1)",
                    color: "var(--jarvis-blue)",
                    cursor: "pointer", fontWeight: 600,
                  }}
                >
                  Resume in COMMS
                </button>
              )}
              <button
                onClick={() => { setSelected(null); setHistory([]); }}
                style={{
                  fontSize: 9, padding: "4px 8px", borderRadius: 4,
                  border: "1px solid rgba(255,77,99,0.2)",
                  background: "transparent", color: "var(--neon-red)", cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
            {historyLoading ? (
              <div style={{ textAlign: "center", padding: 30, color: "var(--text-muted)", fontSize: 10 }}>
                Loading history...
              </div>
            ) : history.length === 0 ? (
              <div style={{ textAlign: "center", padding: 30, color: "var(--text-muted)", fontSize: 10 }}>
                No messages to display
              </div>
            ) : history.map((msg, i) => (
              <div
                key={i}
                style={{
                  marginBottom: 8,
                  padding: "8px 10px",
                  borderRadius: 6,
                  borderLeft: `2px solid ${msg.role === "user" ? "var(--neon-cyan, #0099aa)" : "var(--jarvis-blue)"}`,
                  background: msg.role === "user" ? "rgba(182,242,58,0.03)" : "rgba(182,242,58,0.06)",
                }}
              >
                <div style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: msg.role === "user" ? "var(--neon-cyan)" : "var(--jarvis-blue)", marginBottom: 4 }}>
                  {msg.role}
                </div>
                <pre style={{
                  fontSize: 10,
                  fontFamily: "inherit",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color: "var(--text-primary)",
                  margin: 0,
                  lineHeight: 1.5,
                }}>
                  {msg.content.slice(0, 2000)}{msg.content.length > 2000 ? "\n...(truncated)" : ""}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
