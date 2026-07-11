import { useState, useEffect, useCallback } from "react";
import { useVisiblePolling } from "../lib/useVisiblePolling";

interface Lane {
  display: string; provider: string; mode: string; status: string;
  assessment_bytes: number; tools_called: { tool: string; calls: number }[];
}
interface Run {
  engagement: string; engagement_dir: string; status: string; completion_mode: string;
  briefing: string; started_at: string; finished_at?: string; completed_at?: string;
  lanes: Record<string, Lane>;
}
interface CouncilState { settings: { default_completion_mode: string }; runs: Record<string, Run>; }

const LANE_ORDER = ["claude_opus", "deepseek_v4", "qwen", "gpt55", "glm", "grok"];
const EMOJI: Record<string, string> = {
  claude_opus: "🟣", deepseek_v4: "🔵", qwen: "🟢", gpt55: "⚪", glm: "🔴", grok: "🟡",
};
const runColor = (s: string) => s === "completed" ? "#2bd47f" : s === "awaiting_review" ? "#ffae42"
  : s === "running" ? "#b6f23a" : "#9aa6b6";
const laneColor = (s: string) => s === "submitted" ? "#2bd47f" : s === "running" ? "#b6f23a"
  : s === "failed" ? "#ff4d63" : "#9aa6b6";
const laneIcon = (s: string) => s === "submitted" ? "✅" : s === "failed" ? "❌" : s === "running" ? "◌" : "○";

function MarkdownLite({ md }: { md: string }) {
  // Lightweight render: fenced code blocks as monospace panels, everything else
  // as pre-wrap with headings emphasized. Good enough for assessments.
  const parts = md.split(/```/);
  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--text-primary)" }}>
      {parts.map((part, i) => i % 2 === 1 ? (
        <pre key={i} style={{ background: "rgba(0,0,0,0.45)", border: "1px solid rgba(182,242,58,0.18)",
          borderRadius: 6, padding: "8px 12px", overflowX: "auto", fontSize: 11.5,
          fontFamily: "'JetBrains Mono','Fira Code',monospace", color: "#9fe7ff", whiteSpace: "pre" }}>
          {part.replace(/^[a-z]*\n/, "")}
        </pre>
      ) : (
        <div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {part.split("\n").map((line, j) => {
            const h = /^#{1,6}\s/.test(line);
            return <div key={j} style={h ? { fontWeight: 700, color: "var(--neon-cyan,#b6f23a)", marginTop: 8 } : undefined}>
              {line.replace(/^#{1,6}\s/, "")}</div>;
          })}
        </div>
      ))}
    </div>
  );
}

export default function CouncilPage() {
  const [state, setState] = useState<CouncilState | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [briefing, setBriefing] = useState("");
  const [extra, setExtra] = useState("");
  const [mode, setMode] = useState("auto");
  const [assessment, setAssessment] = useState<{ lane: string; content: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const fetchState = useCallback(() => {
    fetch("/api/council/state").then(r => r.json()).then(setState).catch(() => {});
  }, []);
  useVisiblePolling(fetchState, 4000);

  const runs = state ? Object.values(state.runs).sort((a, b) => (b.started_at || "").localeCompare(a.started_at || "")) : [];
  const selRun = sel && state ? state.runs[sel] : null;
  useEffect(() => { if (selRun) { setBriefing(selRun.briefing || ""); setMode(selRun.completion_mode || "auto"); setExtra(""); } }, [sel]); // eslint-disable-line

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); };
  const post = (url: string, body: any) =>
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());

  const setDefaultMode = (m: string) => post("/api/council/settings", { default_completion_mode: m }).then(fetchState);
  const setRunMode = (eng: string, m: string) => post("/api/council/mode", { engagement: eng, mode: m }).then(fetchState);
  const complete = (eng: string) => post("/api/council/complete", { engagement: eng })
    .then(r => { flash(r.notified ? `Completed — notified ${r.notified} session(s)` : "Marked complete"); fetchState(); });
  const summon = (dir: string) => post("/api/council/summon", { engagementDir: dir, briefing, extraContext: extra, completionMode: mode })
    .then(r => { flash(r.ok ? "🏛️ Council summoned — lanes spawning…" : "Failed: " + (r.error || "")); fetchState(); });
  const viewAssessment = (dir: string, lane: string) =>
    fetch(`/api/council/assessment?dir=${encodeURIComponent(dir)}&lane=${lane}`).then(r => r.json())
      .then(d => setAssessment({ lane, content: d.content || d.error || "(empty)" }));

  const dim = state?.settings?.default_completion_mode || "auto";

  return (
    <div style={{ display: "flex", height: "100%", color: "var(--text-primary)", fontFamily: "system-ui, sans-serif" }}>
      {/* LEFT: global toggle + run list */}
      <div style={{ width: 300, borderRight: "1px solid var(--border-color)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border-color)" }}>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.05em" }}>🏛️ COUNCIL OF AIs</div>
          <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 6 }}>Default completion</div>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            {["auto", "manual"].map(m => (
              <button key={m} onClick={() => setDefaultMode(m)}
                style={{ flex: 1, fontSize: 11, padding: "5px 0", borderRadius: 5, cursor: "pointer",
                  border: `1px solid ${dim === m ? "rgba(182,242,58,0.6)" : "var(--border-color)"}`,
                  background: dim === m ? "rgba(182,242,58,0.15)" : "transparent",
                  color: dim === m ? "var(--neon-cyan,#b6f23a)" : "var(--text-muted)", fontWeight: 600 }}>
                {m}
              </button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
          {runs.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: 12, padding: 12 }}>No council runs yet.</div>}
          {runs.map(r => {
            const done = Object.values(r.lanes).filter(l => l.status === "submitted").length;
            return (
              <div key={r.engagement} onClick={() => setSel(r.engagement)}
                style={{ padding: "9px 11px", marginBottom: 6, borderRadius: 6, cursor: "pointer",
                  border: `1px solid ${sel === r.engagement ? runColor(r.status) : "var(--border-color)"}`,
                  background: sel === r.engagement ? "rgba(255,255,255,0.04)" : "transparent" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.engagement}</span>
                  <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, color: runColor(r.status),
                    border: `1px solid ${runColor(r.status)}55`, background: `${runColor(r.status)}18`, whiteSpace: "nowrap" }}>
                    {r.status === "awaiting_review" && r.status === "awaiting_review" ? "REVIEW" : r.status.toUpperCase()}
                  </span>
                </div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
                  {done}/6 · {r.completion_mode}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* RIGHT: detail */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16, position: "relative" }}>
        {!selRun && <div style={{ color: "var(--text-muted)", marginTop: 40, textAlign: "center" }}>Select a council run.</div>}
        {selRun && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{selRun.engagement}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{selRun.engagement_dir}</div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, padding: "3px 9px", borderRadius: 5, color: runColor(selRun.status),
                  border: `1px solid ${runColor(selRun.status)}66`, background: `${runColor(selRun.status)}1a`, fontWeight: 600 }}>
                  {selRun.status}
                </span>
                {/* per-run mode toggle */}
                {["auto", "manual"].map(m => (
                  <button key={m} onClick={() => setRunMode(selRun.engagement, m)}
                    style={{ fontSize: 10.5, padding: "3px 8px", borderRadius: 5, cursor: "pointer",
                      border: `1px solid ${selRun.completion_mode === m ? "rgba(182,242,58,0.6)" : "var(--border-color)"}`,
                      background: selRun.completion_mode === m ? "rgba(182,242,58,0.15)" : "transparent",
                      color: selRun.completion_mode === m ? "var(--neon-cyan,#b6f23a)" : "var(--text-muted)" }}>{m}</button>
                ))}
                {selRun.status === "awaiting_review" && (
                  <button onClick={() => complete(selRun.engagement)}
                    style={{ fontSize: 11, padding: "4px 12px", borderRadius: 5, cursor: "pointer", fontWeight: 700,
                      border: "1px solid rgba(43,212,127,0.6)", background: "rgba(43,212,127,0.18)", color: "#2bd47f" }}>
                    ✓ Mark Complete
                  </button>
                )}
              </div>
            </div>

            {selRun.status === "awaiting_review" && (
              <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 6, fontSize: 11.5,
                border: "1px solid rgba(255,174,66,0.4)", background: "rgba(255,174,66,0.1)", color: "#ffcc66" }}>
                ⛔ Manual mode — ChillsPwn is hard-paused on this engagement until you press <b>Mark Complete</b>.
              </div>
            )}

            {/* lane cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 10, marginTop: 14 }}>
              {LANE_ORDER.filter(id => selRun.lanes[id]).map(id => {
                const l = selRun.lanes[id];
                return (
                  <div key={id} style={{ border: `1px solid ${laneColor(l.status)}44`, borderRadius: 8, padding: 11,
                    background: "rgba(255,255,255,0.02)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{EMOJI[id]} {l.display}</span>
                      <span style={{ fontSize: 10, color: laneColor(l.status) }}>{laneIcon(l.status)} {l.status}</span>
                    </div>
                    <div style={{ fontSize: 9.5, color: "var(--text-muted)", marginTop: 3 }}>
                      {l.mode}/{l.provider}{l.assessment_bytes ? ` · ${(l.assessment_bytes / 1024).toFixed(1)}KB` : ""}
                    </div>
                    {/* tools called */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 7, minHeight: 18 }}>
                      {l.tools_called.length === 0 && <span style={{ fontSize: 9.5, color: "var(--text-muted)" }}>no tools logged</span>}
                      {l.tools_called.map(t => (
                        <span key={t.tool} style={{ fontSize: 9.5, padding: "1px 6px", borderRadius: 10,
                          border: "1px solid rgba(182,242,58,0.25)", background: "rgba(182,242,58,0.08)", color: "#7fd9ff" }}>
                          🔧 {t.tool}×{t.calls}
                        </span>
                      ))}
                    </div>
                    {l.status === "submitted" && (
                      <button onClick={() => viewAssessment(selRun.engagement_dir, id)}
                        style={{ marginTop: 9, width: "100%", fontSize: 11, padding: "5px 0", borderRadius: 5, cursor: "pointer",
                          border: "1px solid rgba(43,212,127,0.35)", background: "rgba(43,212,127,0.1)", color: "#2bd47f", fontWeight: 600 }}>
                        View assessment →
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* relaunch / summon */}
            <div style={{ marginTop: 18, borderTop: "1px solid var(--border-color)", paddingTop: 14 }}>
              <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 8 }}>🔄 Relaunch council</div>
              <label style={{ fontSize: 10.5, color: "var(--text-muted)" }}>Briefing</label>
              <textarea value={briefing} onChange={e => setBriefing(e.target.value)} rows={3}
                style={{ width: "100%", marginTop: 3, padding: 8, fontSize: 12, borderRadius: 6, resize: "vertical",
                  background: "rgba(0,0,0,0.4)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} />
              <label style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 8, display: "block" }}>Additional context (optional — appended to the briefing)</label>
              <textarea value={extra} onChange={e => setExtra(e.target.value)} rows={2} placeholder="e.g. Round-1's ESC1 path failed — the CA enforces manager approval…"
                style={{ width: "100%", marginTop: 3, padding: 8, fontSize: 12, borderRadius: 6, resize: "vertical",
                  background: "rgba(0,0,0,0.4)", border: "1px solid var(--border-color)", color: "var(--text-primary)" }} />
              <div style={{ display: "flex", gap: 8, marginTop: 9, alignItems: "center" }}>
                <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>mode</span>
                {["auto", "manual"].map(m => (
                  <button key={m} onClick={() => setMode(m)}
                    style={{ fontSize: 11, padding: "4px 10px", borderRadius: 5, cursor: "pointer",
                      border: `1px solid ${mode === m ? "rgba(182,242,58,0.6)" : "var(--border-color)"}`,
                      background: mode === m ? "rgba(182,242,58,0.15)" : "transparent",
                      color: mode === m ? "var(--neon-cyan,#b6f23a)" : "var(--text-muted)" }}>{m}</button>
                ))}
                <button onClick={() => summon(selRun.engagement_dir)} disabled={!briefing.trim()}
                  style={{ marginLeft: "auto", fontSize: 12, padding: "6px 16px", borderRadius: 6, cursor: "pointer", fontWeight: 700,
                    border: "1px solid rgba(176,124,255,0.5)", background: "rgba(176,124,255,0.18)", color: "#b07cff",
                    opacity: briefing.trim() ? 1 : 0.4 }}>
                  🏛️ Summon / Relaunch
                </button>
              </div>
            </div>
          </>
        )}

        {/* assessment overlay */}
        {assessment && (
          <div onClick={() => setAssessment(null)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 30, padding: 24 }}>
            <div onClick={e => e.stopPropagation()} style={{ height: "100%", display: "flex", flexDirection: "column",
              background: "var(--bg-surface,#11161f)", border: "1px solid var(--border-bright,rgba(182,242,58,0.4))", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--border-color)" }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{EMOJI[assessment.lane]} {selRun?.lanes[assessment.lane]?.display} — assessment</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => navigator.clipboard?.writeText(assessment.content)}
                    style={{ fontSize: 11, padding: "3px 10px", borderRadius: 5, cursor: "pointer", border: "1px solid var(--border-color)", background: "transparent", color: "var(--text-muted)" }}>Copy</button>
                  <button onClick={() => setAssessment(null)}
                    style={{ fontSize: 11, padding: "3px 10px", borderRadius: 5, cursor: "pointer", border: "1px solid rgba(255,77,99,0.4)", background: "rgba(255,77,99,0.12)", color: "#ff6b6b" }}>✕ Close</button>
                </div>
              </div>
              <div style={{ flex: 1, overflowY: "auto", padding: 16 }}><MarkdownLite md={assessment.content} /></div>
            </div>
          </div>
        )}

        {toast && (
          <div style={{ position: "absolute", bottom: 16, right: 16, zIndex: 40, padding: "9px 14px", borderRadius: 6,
            background: "rgba(0,0,0,0.85)", border: "1px solid rgba(182,242,58,0.4)", color: "var(--neon-cyan,#b6f23a)", fontSize: 12 }}>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
