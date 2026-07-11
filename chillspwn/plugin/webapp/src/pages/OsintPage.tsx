import { useState, useEffect, useCallback } from "react";
import { useVisiblePolling } from "../lib/useVisiblePolling";
import { copyToClipboard } from "../lib/clipboard";
import { CyberDropdown } from "../components/CyberDropdown";

interface OsintJob {
  id: string;
  target: string;
  targetType: string;
  scope: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  outputDir: string;
  hasReport: boolean;
  hasPdf: boolean;
  stage: string;
  progress: number;
  model?: string;
  modelChoice?: string;
}

const MODEL_OPTIONS = [
  { id: "auto",              label: "Auto (by scope)",  desc: "Sonnet for Quick/Standard · Opus for Deep" },
  { id: "claude-haiku-4-5",  label: "Haiku 4.5",        desc: "Fastest · cheapest · OK for quick lookups" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6",       desc: "Balanced · good for most OSINT runs" },
  { id: "claude-opus-4-7",   label: "Opus 4.7",         desc: "Stable reasoning · best tool-chain speed" },
  { id: "claude-opus-4-8",   label: "Opus 4.8",         desc: "Newest · highest synthesis quality · slower tools" },
];

const TARGET_TYPES = [
  { id: "domain",  label: "Domain",  icon: "⌖", placeholder: "example.com",      help: "TLD or subdomain — runs whois, dig (all records), amass passive, crt.sh certs, theHarvester, httpx, whatweb, wayback machine" },
  { id: "ip",      label: "IP",      icon: "⊞", placeholder: "1.2.3.4 or CIDR",  help: "IPv4/IPv6 — whois, reverse DNS, nmap top 100, httpx probe, Shodan InternetDB" },
  { id: "email",   label: "Email",   icon: "⊛", placeholder: "user@example.com", help: "Email enum — theHarvester, breach databases, GitHub search, Gravatar, Google dorks" },
  { id: "person",  label: "Person",  icon: "◈", placeholder: "username or full name", help: "Identity — sherlock for usernames, social platforms, image search guidance, username variants" },
  { id: "company", label: "Company", icon: "⌬", placeholder: "Acme Corp", help: "Company — known domains, LinkedIn dorking, opencorporates, crunchbase, employee enum" },
];

const SCOPES = [
  { id: "quick",    label: "Quick",    desc: "~3 min · core tools, surface enum", color: "#b6f23a" },
  { id: "standard", label: "Standard", desc: "~10 min · full passive + active probe", color: "#2bd47f" },
  { id: "deep",     label: "Deep",     desc: "~25 min · adds dark web, subdomain brute, deep cert harvest", color: "#b07cff" },
];

function fmtElapsed(start: string, end?: string) {
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  const s = Math.floor((b - a) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default function OsintPage() {
  const [jobs, setJobs] = useState<OsintJob[]>([]);
  const [target, setTarget] = useState("");
  const [targetType, setTargetType] = useState("domain");
  const [scope, setScope] = useState("standard");
  const [model, setModel] = useState("auto");
  const [submitting, setSubmitting] = useState(false);
  // Track only the SELECTED ID — we always read the live job snapshot from the `jobs` array.
  // This fixes the stale-detail-panel bug where progress stopped updating after navigating away.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = selectedId ? jobs.find((j) => j.id === selectedId) || null : null;
  const [reportMd, setReportMd] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  const showToast = (text: string, ok = true) => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 4000);
  };

  const fetchJobs = useCallback(() => {
    fetch("/api/osint/jobs")
      .then((r) => r.json())
      .then((d) => setJobs(Array.isArray(d) ? d : []))
      .catch(() => {});
  }, []);

  useVisiblePolling(fetchJobs, 4000);

  const startInvestigation = async () => {
    if (!target.trim()) return;
    setSubmitting(true);
    try {
      const resp = await fetch("/api/osint/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: target.trim(), targetType, scope, model }),
      });
      const data = await resp.json();
      if (resp.ok) {
        showToast(`✓ OSINT investigation started for "${target}"`, true);
        setTarget("");
        fetchJobs();
      } else {
        showToast(`✗ ${data.error}`, false);
      }
    } catch (e: any) {
      showToast(`✗ ${e.message}`, false);
    }
    setSubmitting(false);
  };

  const openJob = (job: OsintJob) => {
    setSelectedId(job.id);
    setReportMd(null);
    if (job.hasReport) {
      fetch(`/api/osint/${job.id}/report`)
        .then((r) => r.json())
        .then((d) => setReportMd(d.content || ""))
        .catch(() => setReportMd("(failed to load)"));
    }
  };

  // When the selected job completes (transitions to completed/failed), auto-fetch the report
  useEffect(() => {
    if (!selected) return;
    if (selected.status !== "running" && selected.hasReport && !reportMd) {
      fetch(`/api/osint/${selected.id}/report`)
        .then((r) => r.json())
        .then((d) => setReportMd(d.content || ""))
        .catch(() => setReportMd("(failed to load)"));
    }
  }, [selected?.status, selected?.hasReport, selected?.id, reportMd]);

  const downloadFile = (jobId: string, format: "md" | "pdf") => {
    window.location.href = `/api/osint/${jobId}/download/${format}`;
  };

  const shareReport = async (job: OsintJob) => {
    // Build a shareable text snippet — copy summary + key links to clipboard
    if (!reportMd) {
      showToast("Report not loaded yet", false);
      return;
    }
    // Extract executive summary section
    const summaryMatch = reportMd.match(/##\s*Executive Summary([\s\S]*?)(?=##|$)/i);
    const summary = summaryMatch ? summaryMatch[1].trim().slice(0, 600) : reportMd.slice(0, 600);
    const shareText = `OSINT Report — ${job.target}\n` +
      `Type: ${job.targetType} · Scope: ${job.scope}\n` +
      `Generated: ${new Date(job.startedAt).toLocaleString()}\n\n` +
      `${summary}\n\n` +
      `[Full report available on ChillsPwn dashboard]`;
    const ok = await copyToClipboard(shareText);
    if (ok) showToast("✓ Summary copied to clipboard — paste to share", true);
    else showToast("✗ Copy failed", false);
  };

  const selectedType = TARGET_TYPES.find((t) => t.id === targetType);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, position: "relative" }}>
      {toast && (
        <div style={{
          position: "absolute", top: 12, right: 12, zIndex: 100,
          padding: "8px 14px", borderRadius: 5, fontSize: 11, fontWeight: 600,
          background: toast.ok ? "rgba(43,212,127,0.15)" : "rgba(255,77,99,0.15)",
          border: `1px solid ${toast.ok ? "rgba(43,212,127,0.5)" : "rgba(255,77,99,0.5)"}`,
          color: toast.ok ? "var(--neon-green)" : "var(--neon-red, #ff4d63)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)", maxWidth: 380,
        }}>{toast.text}</div>
      )}

      {/* Header */}
      <div style={{
        padding: "8px 12px", borderBottom: "1px solid var(--border-color)",
        display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0,
      }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--jarvis-blue)", letterSpacing: "0.06em" }}>
            ⌖ OSINT
          </span>
          <span style={{ fontSize: 9, color: "var(--text-muted)", marginLeft: 8 }}>
            Deep target reconnaissance — runs whois, dig, amass, theHarvester, httpx, whatweb, wayback, crt.sh, sherlock and more
          </span>
        </div>
        <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
          {jobs.filter((j) => j.status === "running").length} running · {jobs.filter((j) => j.status === "completed").length} complete
        </span>
      </div>

      {/* Investigation form */}
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-color)", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
          {TARGET_TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTargetType(t.id)}
              style={{
                fontSize: 10, padding: "5px 11px", borderRadius: 4,
                border: `1px solid ${targetType === t.id ? "rgba(182,242,58,0.5)" : "var(--border-color)"}`,
                background: targetType === t.id ? "rgba(182,242,58,0.12)" : "rgba(0,0,0,0.2)",
                color: targetType === t.id ? "var(--jarvis-blue)" : "var(--text-muted)",
                cursor: "pointer", fontWeight: 600, minHeight: 30,
              }}
            >
              <span style={{ marginRight: 5, fontFamily: "'JetBrains Mono', monospace" }}>{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !submitting && startInvestigation()}
            placeholder={selectedType?.placeholder}
            style={{
              flex: 1, fontSize: 12, padding: "8px 12px", borderRadius: 5,
              border: "1px solid var(--border-color)", color: "var(--text-primary)",
              background: "rgba(0,0,0,0.3)", fontFamily: "monospace", minHeight: 36,
            }}
          />
          <button
            onClick={startInvestigation}
            disabled={submitting || !target.trim()}
            style={{
              fontSize: 11, padding: "0 16px", borderRadius: 5,
              border: "1px solid rgba(182,242,58,0.5)",
              background: "linear-gradient(135deg, rgba(182,242,58,0.25), rgba(0,153,255,0.25))",
              color: "var(--jarvis-blue)", cursor: submitting || !target.trim() ? "not-allowed" : "pointer",
              fontWeight: 700, minHeight: 36, minWidth: 110,
              opacity: submitting || !target.trim() ? 0.5 : 1,
            }}
          >
            {submitting ? "Starting..." : "▶ Investigate"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
          {SCOPES.map((s) => (
            <button
              key={s.id}
              onClick={() => setScope(s.id)}
              style={{
                flex: 1, fontSize: 9, padding: "5px 8px", borderRadius: 4,
                border: `1px solid ${scope === s.id ? `${s.color}80` : "var(--border-color)"}`,
                background: scope === s.id ? `${s.color}15` : "transparent",
                color: scope === s.id ? s.color : "var(--text-muted)",
                cursor: "pointer", textAlign: "left",
              }}
            >
              <div style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{s.label}</div>
              <div style={{ fontSize: 8, opacity: 0.8, marginTop: 1 }}>{s.desc}</div>
            </button>
          ))}
        </div>

        {/* Model picker — custom dropdown styled to match ChillsPwn (native <select> looks OS-default on mobile) */}
        <CyberDropdown
          value={model}
          onChange={setModel}
          options={MODEL_OPTIONS}
          label="Model"
          accent={model !== "auto" ? "#b07cff" : "var(--jarvis-blue)"}
        />

        <div style={{ fontSize: 9, color: "var(--text-dim)", marginTop: 4, fontStyle: "italic" }}>
          ▸ {selectedType?.help}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Jobs list */}
        <div style={{
          width: selected ? "38%" : "100%",
          borderRight: selected ? "1px solid var(--border-color)" : "none",
          overflowY: "auto", padding: 6, transition: "width 0.2s ease",
        }}>
          {jobs.length === 0 ? (
            <div style={{ textAlign: "center", padding: 30, color: "var(--text-muted)", fontSize: 10 }}>
              No investigations yet. Pick a target type and hit ▶ Investigate.
            </div>
          ) : jobs.map((j) => {
            const tt = TARGET_TYPES.find((t) => t.id === j.targetType);
            const sc = SCOPES.find((s) => s.id === j.scope);
            const statusColor = j.status === "running" ? "#b6f23a" : j.status === "completed" ? "#2bd47f" : "#ff4d63";
            return (
              <div
                key={j.id}
                onClick={() => openJob(j)}
                style={{
                  padding: "8px 10px", marginBottom: 5, borderRadius: 6,
                  cursor: "pointer",
                  background: selectedId === j.id ? "rgba(182,242,58,0.1)" : "rgba(0,0,0,0.2)",
                  borderLeft: `3px solid ${statusColor}`,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 6 }}>
                  <div style={{ overflow: "hidden", flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: "monospace" }}>
                      {tt?.icon} {j.target}
                    </div>
                    <div style={{ fontSize: 8, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 1 }}>
                      {j.targetType} · {sc?.label} · {fmtElapsed(j.startedAt, j.completedAt)}
                      {j.model && (
                        <span style={{ marginLeft: 6, color: "#b07cff" }}>
                          · {j.model.replace("claude-", "").replace(/-\d{8}$/, "")}
                        </span>
                      )}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 8, padding: "2px 7px", borderRadius: 3,
                    background: `${statusColor}20`, border: `1px solid ${statusColor}50`,
                    color: statusColor, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em",
                    flexShrink: 0,
                  }}>
                    {j.status === "running" && <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: statusColor, marginRight: 4, animation: "pulse-green 1.5s infinite" }} />}
                    {j.status}
                  </span>
                </div>
                {j.status === "running" && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ width: "100%", height: 3, borderRadius: 2, background: "rgba(0,0,0,0.3)", overflow: "hidden" }}>
                      <div style={{ width: `${j.progress}%`, height: "100%", background: "linear-gradient(90deg, rgba(182,242,58,0.6), rgba(182,242,58,1))", transition: "width 0.5s" }} />
                    </div>
                    <div style={{ fontSize: 8, color: "var(--jarvis-blue)", marginTop: 3 }}>{j.stage} · {j.progress}%</div>
                  </div>
                )}
                {j.status !== "running" && (j.hasReport || j.hasPdf) && (
                  <div style={{ display: "flex", gap: 4, marginTop: 5 }}>
                    {j.hasReport && <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, background: "rgba(182,242,58,0.15)", color: "var(--jarvis-blue)", fontWeight: 700 }}>MD</span>}
                    {j.hasPdf && <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, background: "rgba(43,212,127,0.15)", color: "var(--neon-green)", fontWeight: 700 }}>PDF</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Detail panel */}
        {selected && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
            <div style={{
              padding: "8px 12px", borderBottom: "1px solid var(--border-color)",
              display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, gap: 6, flexWrap: "wrap",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--jarvis-blue)", fontFamily: "monospace" }}>
                  {selected.target}
                </div>
                <div style={{ fontSize: 9, color: "var(--text-muted)" }}>
                  {selected.targetType} · {selected.scope} · {selected.status} · {fmtElapsed(selected.startedAt, selected.completedAt)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {selected.hasReport && (
                  <button onClick={() => shareReport(selected)}
                    style={{ fontSize: 10, padding: "5px 10px", borderRadius: 4, border: "1px solid rgba(176,124,255,0.4)", background: "rgba(176,124,255,0.1)", color: "#b07cff", cursor: "pointer", fontWeight: 600, minHeight: 28 }}>
                    🔗 Share
                  </button>
                )}
                {selected.hasReport && (
                  <button onClick={() => downloadFile(selected.id, "md")}
                    style={{ fontSize: 10, padding: "5px 10px", borderRadius: 4, border: "1px solid rgba(182,242,58,0.4)", background: "rgba(182,242,58,0.1)", color: "var(--jarvis-blue)", cursor: "pointer", fontWeight: 600, minHeight: 28 }}>
                    ⬇ MD
                  </button>
                )}
                {selected.hasPdf && (
                  <button onClick={() => downloadFile(selected.id, "pdf")}
                    style={{ fontSize: 10, padding: "5px 10px", borderRadius: 4, border: "1px solid rgba(43,212,127,0.4)", background: "rgba(43,212,127,0.1)", color: "var(--neon-green)", cursor: "pointer", fontWeight: 600, minHeight: 28 }}>
                    ⬇ PDF
                  </button>
                )}
                <button onClick={() => { setSelectedId(null); setReportMd(null); }}
                  style={{ fontSize: 11, padding: "5px 8px", borderRadius: 4, border: "1px solid rgba(255,77,99,0.3)", background: "transparent", color: "var(--neon-red, #ff4d63)", cursor: "pointer", minHeight: 28 }}>
                  ✕
                </button>
              </div>
            </div>

            <div style={{ flex: 1, overflow: "auto", padding: 14, background: "rgba(0,0,0,0.3)" }}>
              {selected.status === "running" ? (
                <div style={{ textAlign: "center", padding: 30, color: "var(--text-muted)", fontSize: 11 }}>
                  Investigation in progress — stage: <strong style={{ color: "var(--jarvis-blue)" }}>{selected.stage}</strong> ({selected.progress}%)
                  <div style={{ marginTop: 12, fontSize: 9 }}>
                    Output dir: <code>{selected.outputDir}</code>
                  </div>
                </div>
              ) : reportMd ? (
                <pre style={{
                  margin: 0, fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                  lineHeight: 1.6, color: "var(--text-primary)",
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}>
                  {reportMd}
                </pre>
              ) : selected.hasReport ? (
                <div style={{ color: "var(--text-muted)", fontSize: 11, textAlign: "center", padding: 30 }}>Loading report...</div>
              ) : (
                <div style={{ color: "var(--text-muted)", fontSize: 11, textAlign: "center", padding: 30 }}>
                  {selected.status === "failed" ? "Investigation failed — no report generated. Check the output directory for partial data." : "No report yet."}
                  <div style={{ marginTop: 12, fontSize: 9, fontFamily: "monospace" }}>
                    {selected.outputDir}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

