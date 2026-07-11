import { useState, useEffect, useCallback, useRef } from "react";

// ── Types ─────────────────────────────────────────────────

interface Engagement {
  name: string;
  path: string;
  source: string;
  hasScans: boolean;
  hasLoot: boolean;
  hasExploits: boolean;
  hasNotes: boolean;
  hasReport: boolean;
  hasResearch: boolean;
  reportFile: string | null;
  fileCount: number;
  totalSize: number;
  lastModified: string;
  status: string;
  dirs: string[];
}

interface EngagementFile {
  path: string;
  relativePath: string;
  size: number;
  modified: string;
}

// ── Constants ─────────────────────────────────────────────

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string; label: string }> = {
  reported: { bg: "rgba(43,212,127,0.1)", border: "rgba(43,212,127,0.3)", text: "var(--neon-green)", label: "REPORTED" },
  completed: { bg: "rgba(182,242,58,0.1)", border: "rgba(182,242,58,0.3)", text: "var(--jarvis-blue)", label: "COMPLETED" },
  exploiting: { bg: "rgba(255,174,66,0.1)", border: "rgba(255,174,66,0.3)", text: "var(--neon-amber)", label: "EXPLOITING" },
  scanning: { bg: "rgba(176,124,255,0.1)", border: "rgba(176,124,255,0.3)", text: "var(--neon-purple)", label: "SCANNING" },
  new: { bg: "rgba(255,255,255,0.05)", border: "var(--border-color)", text: "var(--text-muted)", label: "NEW" },
};

const STATUS_DOTS: Record<string, string> = {
  reported: "#2bd47f",
  completed: "#b6f23a",
  exploiting: "#ffae42",
  scanning: "#b07cff",
  new: "#556680",
};

const STANDARD_DIRS = ["scans", "loot", "exploits", "notes", "report", "research"];

// ── Helpers ───────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes === 0) return "0B";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / 1024 / 1024).toFixed(1)}M`;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fileExtIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    nmap: "\u{1F50D}", gnmap: "\u{1F50D}", xml: "\u{1F50D}",
    py: "\u{1F40D}", sh: "\u{1F4DC}",
    txt: "\u{1F4DD}", md: "\u{1F4DD}", log: "\u{1F4DD}",
    json: "\u{1F4CB}", yaml: "\u{1F4CB}", yml: "\u{1F4CB}",
    html: "\u{1F310}", htm: "\u{1F310}",
    pdf: "\u{1F4D5}",
    png: "\u{1F5BC}", jpg: "\u{1F5BC}", jpeg: "\u{1F5BC}",
    zip: "\u{1F4E6}", gz: "\u{1F4E6}", tar: "\u{1F4E6}",
    pcap: "\u{1F4E1}", cap: "\u{1F4E1}",
  };
  return map[ext] || "\u{1F4C4}";
}

// ── Component ─────────────────────────────────────────────

export default function EngagementsPage() {
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Engagement | null>(null);
  const [files, setFiles] = useState<EngagementFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [dirFilters, setDirFilters] = useState<Set<string>>(new Set());

  // Modal state
  const [showReport, setShowReport] = useState(false);
  const [reportHtml, setReportHtml] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  // Report feedback / regeneration
  const [reportFeedback, setReportFeedback] = useState("");
  const [showFeedbackPanel, setShowFeedbackPanel] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // File viewer modal
  const [viewingFile, setViewingFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileViewLoading, setFileViewLoading] = useState(false);

  // New engagement form
  const [showNewForm, setShowNewForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  // Report generation
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportJobId, setReportJobId] = useState<string | null>(null);
  const [reportJobStatus, setReportJobStatus] = useState<string | null>(null);
  const [reportJobOutput, setReportJobOutput] = useState("");
  const [reportProgress, setReportProgress] = useState(0);
  const [reportStage, setReportStage] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch engagements ──

  const fetchEngagements = useCallback(() => {
    setLoading(true);
    fetch("/api/engagements")
      .then((r) => r.json())
      .then((data) => {
        setEngagements(data.engagements || []);
        setLoading(false);
      })
      .catch(() => {
        setEngagements([]);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchEngagements();
  }, [fetchEngagements]);

  // ── Fetch files for selected engagement ──

  const fetchFiles = useCallback((name: string) => {
    setFilesLoading(true);
    fetch(`/api/engagements/${encodeURIComponent(name)}/files`)
      .then((r) => r.json())
      .then((data) => {
        setFiles(data.files || []);
        setFilesLoading(false);
      })
      .catch(() => {
        setFiles([]);
        setFilesLoading(false);
      });
  }, []);

  const selectEngagement = useCallback((eng: Engagement) => {
    setSelected(eng);
    fetchFiles(eng.name);
    setShowReport(false);
    setReportHtml(null);
    setGeneratingReport(false);
    setReportJobId(null);
    setReportJobStatus(null);
    setReportJobOutput("");
  }, [fetchFiles]);

  // ── View report ──

  const viewReport = useCallback(() => {
    if (!selected) return;
    setReportLoading(true);
    fetch(`/api/engagements/${encodeURIComponent(selected.name)}/report`)
      .then((r) => r.json())
      .then((data) => {
        if (data.html) {
          setReportHtml(data.html);
          setShowReport(true);
        }
        setReportLoading(false);
      })
      .catch(() => setReportLoading(false));
  }, [selected]);

  // ── Generate report ──

  const generateReport = useCallback(() => {
    if (!selected) return;
    setGeneratingReport(true);
    setReportJobStatus("starting");
    setReportJobOutput("");

    fetch(`/api/engagements/${encodeURIComponent(selected.name)}/generate-report`, { method: "POST" })
      .then((r) => r.json())
      .then((data) => {
        if (data.jobId) {
          setReportJobId(data.jobId);
          setReportJobStatus("running");
        } else {
          setReportJobStatus("failed");
          setReportJobOutput(data.error || "Unknown error");
        }
      })
      .catch((e) => {
        setReportJobStatus("failed");
        setReportJobOutput(e.message);
      });
  }, [selected]);

  // Poll for report generation status
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    if (!reportJobId || reportJobStatus !== "running") return;

    pollRef.current = setInterval(() => {
      fetch(`/api/engagements/report-status/${reportJobId}`)
        .then((r) => r.json())
        .then((data) => {
          setReportJobStatus(data.status);
          setReportJobOutput(data.output || "");
          setReportProgress(data.progress || 0);
          setReportStage(data.stage || "");
          if (data.status === "completed" || data.status === "failed") {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            setGeneratingReport(false);
            if (data.status === "completed") {
              // Refresh engagement data and auto-open report
              fetchEngagements();
              if (selected) {
                fetchFiles(selected.name);
                // Auto-view report after short delay
                setTimeout(() => {
                  viewReport();
                }, 1000);
              }
            }
          }
        })
        .catch(() => {});
    }, 3000);

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [reportJobId, reportJobStatus, fetchEngagements, fetchFiles, selected, viewReport]);

  // ── View file in modal ──

  const openFileViewer = useCallback((filePath: string) => {
    setViewingFile(filePath);
    setFileViewLoading(true);
    setFileContent(null);
    fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`)
      .then((r) => r.json())
      .then((data) => {
        setFileContent(data.content || data.error || "Empty file");
        setFileViewLoading(false);
      })
      .catch((e) => {
        setFileContent(`Error: ${e.message}`);
        setFileViewLoading(false);
      });
  }, []);

  // ── Create new engagement ──

  const createEngagement = useCallback(async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const resp = await fetch("/api/engagements/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const data = await resp.json();
      if (data.success) {
        setNewName("");
        setShowNewForm(false);
        fetchEngagements();
      } else {
        alert(data.error || "Failed to create engagement");
      }
    } catch (e: any) {
      alert(e.message);
    }
    setCreating(false);
  }, [newName, fetchEngagements]);

  // ── Render ──

  return (
    <div style={{ display: "flex", height: "100%", color: "var(--text-primary)", fontFamily: "inherit" }}>
      {/* ── Left Panel: Engagement List ── */}
      <div style={{
        width: selected ? "38%" : "100%",
        minWidth: 280,
        borderRight: selected ? "1px solid var(--border-color)" : "none",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        transition: "width 0.2s ease",
      }}>
        {/* Header */}
        <div style={{
          padding: "10px 12px",
          borderBottom: "1px solid var(--border-color)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "var(--jarvis-blue)" }}>
            ENGAGEMENTS ({engagements.length})
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => setShowNewForm(!showNewForm)}
              style={{
                fontSize: 10,
                padding: "3px 10px",
                borderRadius: 4,
                border: "1px solid rgba(43,212,127,0.3)",
                background: "rgba(43,212,127,0.08)",
                color: "var(--neon-green)",
                cursor: "pointer",
              }}
            >
              + New
            </button>
            <button
              onClick={fetchEngagements}
              style={{
                fontSize: 10,
                padding: "3px 10px",
                borderRadius: 4,
                border: "1px solid var(--border-color)",
                background: "transparent",
                color: "var(--text-dim)",
                cursor: "pointer",
              }}
            >
              Refresh
            </button>
          </div>
        </div>

        {/* New engagement form */}
        {showNewForm && (
          <div style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            gap: 6,
            alignItems: "center",
            background: "rgba(43,212,127,0.03)",
            flexShrink: 0,
          }}>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Engagement name (e.g. 10.129.1.50)"
              onKeyDown={(e) => e.key === "Enter" && createEngagement()}
              style={{
                flex: 1,
                fontSize: 11,
                padding: "5px 8px",
                borderRadius: 4,
                border: "1px solid rgba(43,212,127,0.2)",
                background: "rgba(0,0,0,0.3)",
                color: "var(--text-primary)",
                outline: "none",
                fontFamily: "monospace",
              }}
            />
            <button
              onClick={createEngagement}
              disabled={creating || !newName.trim()}
              style={{
                fontSize: 10,
                padding: "5px 12px",
                borderRadius: 4,
                border: "1px solid rgba(43,212,127,0.3)",
                background: "rgba(43,212,127,0.12)",
                color: "var(--neon-green)",
                cursor: creating ? "wait" : "pointer",
                opacity: creating || !newName.trim() ? 0.5 : 1,
              }}
            >
              {creating ? "Creating..." : "Create"}
            </button>
            <button
              onClick={() => { setShowNewForm(false); setNewName(""); }}
              style={{
                fontSize: 10,
                padding: "5px 8px",
                borderRadius: 4,
                border: "1px solid var(--border-color)",
                background: "transparent",
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Status filter bar */}
        <div style={{
          display: "flex",
          gap: 4,
          padding: "6px 8px",
          borderBottom: "1px solid var(--border-color)",
          flexWrap: "wrap",
          flexShrink: 0,
        }}>
          {[
            { key: "all", label: "ALL", color: "var(--text-dim)" },
            ...Object.entries(STATUS_COLORS).map(([key, sc]) => ({
              key,
              label: sc.label,
              color: sc.text,
            })),
          ].map((f) => {
            const isActive = statusFilter === f.key;
            const count = f.key === "all"
              ? engagements.length
              : engagements.filter((e) => e.status === f.key).length;
            return (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                style={{
                  fontSize: 8,
                  padding: "3px 8px",
                  borderRadius: 3,
                  border: `1px solid ${isActive ? f.color : "var(--border-color)"}`,
                  background: isActive ? `${f.color}15` : "transparent",
                  color: isActive ? f.color : "var(--text-muted)",
                  cursor: "pointer",
                  fontWeight: isActive ? 700 : 400,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  transition: "all 0.15s ease",
                  opacity: count === 0 && f.key !== "all" ? 0.4 : 1,
                }}
              >
                {f.label} ({count})
              </button>
            );
          })}
        </div>

        {/* Engagement list */}
        <div style={{ flex: 1, overflowY: "auto", padding: 6 }}>
          {loading ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)", fontSize: 11 }}>
              <span style={{ animation: "pulse 1.5s infinite" }}>Loading engagements...</span>
            </div>
          ) : engagements.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)", fontSize: 11 }}>
              No engagements found. Create one or add directories to /root/htb/boxes/
            </div>
          ) : (
            engagements.filter((e) => statusFilter === "all" || e.status === statusFilter).map((eng) => {
              const sc = STATUS_COLORS[eng.status] || STATUS_COLORS.new;
              const dot = STATUS_DOTS[eng.status] || STATUS_DOTS.new;
              const isSelected = selected?.name === eng.name && selected?.path === eng.path;

              return (
                <button
                  key={eng.path}
                  onClick={() => selectEngagement(eng)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 10px",
                    marginBottom: 2,
                    borderRadius: 6,
                    border: isSelected ? `1px solid ${sc.border}` : "1px solid transparent",
                    background: isSelected ? sc.bg : "transparent",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "rgba(182,242,58,0.04)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "transparent";
                  }}
                >
                  {/* Status dot */}
                  <span style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: dot,
                    boxShadow: `0 0 6px ${dot}`,
                    flexShrink: 0,
                  }} />

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 12,
                      fontWeight: 600,
                      fontFamily: "monospace",
                      color: "var(--text-primary)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}>
                      {eng.name}
                    </div>
                    <div style={{
                      fontSize: 9,
                      color: "var(--text-muted)",
                      marginTop: 2,
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                    }}>
                      <span style={{ color: sc.text, fontWeight: 600 }}>{sc.label.toLowerCase()}</span>
                      <span>{eng.fileCount} files</span>
                      <span>{formatSize(eng.totalSize)}</span>
                      <span style={{
                        padding: "0 4px",
                        borderRadius: 3,
                        background: eng.source === "htb" ? "rgba(43,212,127,0.1)" : "rgba(182,242,58,0.1)",
                        border: `1px solid ${eng.source === "htb" ? "rgba(43,212,127,0.2)" : "rgba(182,242,58,0.2)"}`,
                        color: eng.source === "htb" ? "var(--neon-green)" : "var(--jarvis-blue)",
                        fontSize: 8,
                        fontWeight: 600,
                        letterSpacing: "0.05em",
                      }}>
                        {eng.source.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  {/* Modified date */}
                  <span style={{ fontSize: 9, color: "var(--text-muted)", flexShrink: 0 }}>
                    {formatDate(eng.lastModified)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ── Right Panel: Detail ── */}
      {selected && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Detail header */}
          <div style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--border-color)",
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{
                fontSize: 15,
                fontWeight: 700,
                fontFamily: "monospace",
                color: "var(--text-primary)",
              }}>
                {selected.name}
              </span>
              {(() => {
                const sc = STATUS_COLORS[selected.status] || STATUS_COLORS.new;
                return (
                  <span style={{
                    fontSize: 9,
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: 4,
                    background: sc.bg,
                    border: `1px solid ${sc.border}`,
                    color: sc.text,
                    letterSpacing: "0.06em",
                  }}>
                    {sc.label}
                  </span>
                );
              })()}
            </div>
            <div style={{ fontSize: 9, fontFamily: "monospace", color: "var(--text-muted)" }}>
              {selected.path}
            </div>
          </div>

          {/* Detail content — scrollable */}
          <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
            {/* Directory checklist */}
            <div style={{ marginBottom: 16 }}>
              <div style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: "0.08em",
                color: "var(--text-muted)",
                marginBottom: 6,
                textTransform: "uppercase",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}>
                <span>Directories (click to filter)</span>
                <button
                  onClick={() => {
                    if (dirFilters.size === 0 || dirFilters.size === STANDARD_DIRS.length) {
                      setDirFilters(new Set());
                    } else {
                      setDirFilters(new Set(STANDARD_DIRS));
                    }
                  }}
                  style={{
                    fontSize: 8,
                    padding: "2px 6px",
                    borderRadius: 3,
                    border: `1px solid ${dirFilters.size === 0 ? "rgba(182,242,58,0.2)" : "rgba(182,242,58,0.4)"}`,
                    background: dirFilters.size === 0 ? "transparent" : "rgba(182,242,58,0.08)",
                    color: dirFilters.size === 0 ? "var(--text-muted)" : "var(--jarvis-blue)",
                    cursor: "pointer",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  {dirFilters.size === 0 ? "All" : dirFilters.size === STANDARD_DIRS.length ? "All" : `${dirFilters.size} selected`}
                </button>
              </div>
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 4,
              }}>
                {STANDARD_DIRS.map((dir) => {
                  const exists = selected.dirs.includes(dir);
                  const hasFiles = dir === "scans" ? selected.hasScans
                    : dir === "loot" ? selected.hasLoot
                    : dir === "exploits" ? selected.hasExploits
                    : dir === "notes" ? selected.hasNotes
                    : dir === "report" ? selected.hasReport
                    : dir === "research" ? selected.hasResearch
                    : exists;
                  const isActive = dirFilters.has(dir);

                  return (
                    <button
                      key={dir}
                      onClick={() => {
                        setDirFilters((prev) => {
                          const next = new Set(prev);
                          if (next.has(dir)) {
                            next.delete(dir);
                          } else {
                            next.add(dir);
                          }
                          return next;
                        });
                      }}
                      style={{
                        fontSize: 10,
                        padding: "4px 8px",
                        borderRadius: 4,
                        background: isActive
                          ? "rgba(182,242,58,0.12)"
                          : hasFiles ? "rgba(43,212,127,0.06)" : "rgba(255,255,255,0.02)",
                        border: `1px solid ${isActive
                          ? "rgba(182,242,58,0.4)"
                          : hasFiles ? "rgba(43,212,127,0.15)" : "var(--border-color)"}`,
                        color: isActive
                          ? "var(--jarvis-blue)"
                          : hasFiles ? "var(--neon-green)" : exists ? "var(--text-dim)" : "var(--text-muted)",
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                        cursor: hasFiles ? "pointer" : "default",
                        opacity: hasFiles ? 1 : 0.5,
                        transition: "all 0.15s ease",
                        boxShadow: isActive ? "0 0 8px rgba(182,242,58,0.15)" : "none",
                      }}
                    >
                      <span style={{ fontSize: 11 }}>{isActive ? "◉" : hasFiles ? "✓" : exists ? "─" : "✗"}</span>
                      <span style={{ fontFamily: "monospace" }}>{dir}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
              {selected.hasReport && (
                <button
                  onClick={viewReport}
                  disabled={reportLoading}
                  style={{
                    fontSize: 10,
                    padding: "6px 14px",
                    borderRadius: 5,
                    border: "1px solid rgba(43,212,127,0.3)",
                    background: "rgba(43,212,127,0.1)",
                    color: "var(--neon-green)",
                    cursor: reportLoading ? "wait" : "pointer",
                    fontWeight: 600,
                    opacity: reportLoading ? 0.6 : 1,
                  }}
                >
                  {reportLoading ? "Loading..." : "View Report"}
                </button>
              )}

              {!generatingReport ? (
                <button
                  onClick={generateReport}
                  style={{
                    fontSize: 10,
                    padding: "6px 14px",
                    borderRadius: 5,
                    border: "1px solid rgba(182,242,58,0.3)",
                    background: "rgba(182,242,58,0.1)",
                    color: "var(--jarvis-blue)",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  Generate Report
                </button>
              ) : (
                <span style={{
                  fontSize: 10,
                  padding: "6px 14px",
                  borderRadius: 5,
                  border: "1px solid rgba(255,174,66,0.3)",
                  background: "rgba(255,174,66,0.1)",
                  color: "var(--neon-amber)",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}>
                  <span style={{ animation: "pulse 1.5s infinite" }}>Generating...</span>
                </span>
              )}

              {selected.hasReport && (
                <button
                  onClick={() => {
                    // Open report in new tab for printing
                    window.open(`/api/engagements/${encodeURIComponent(selected.name)}/report`, "_blank");
                  }}
                  style={{
                    fontSize: 10,
                    padding: "6px 14px",
                    borderRadius: 5,
                    border: "1px solid var(--border-color)",
                    background: "transparent",
                    color: "var(--text-dim)",
                    cursor: "pointer",
                  }}
                >
                  Export PDF
                </button>
              )}

              <button
                onClick={() => {
                  // Copy path to clipboard
                  navigator.clipboard?.writeText(selected.path);
                }}
                style={{
                  fontSize: 10,
                  padding: "6px 14px",
                  borderRadius: 5,
                  border: "1px solid var(--border-color)",
                  background: "transparent",
                  color: "var(--text-dim)",
                  cursor: "pointer",
                }}
                title={selected.path}
              >
                Copy Path
              </button>
            </div>

            {/* Report generation progress with stage indicator */}
            {(reportJobStatus === "running" || reportJobStatus === "failed") && (
              <div style={{
                marginBottom: 16,
                padding: 12,
                borderRadius: 6,
                border: `1px solid ${reportJobStatus === "failed" ? "rgba(255,77,99,0.3)" : "rgba(182,242,58,0.2)"}`,
                background: reportJobStatus === "failed" ? "rgba(255,77,99,0.06)" : "rgba(182,242,58,0.04)",
              }}>
                {/* Header */}
                <div style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                }}>
                  <div style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: "0.06em",
                    color: reportJobStatus === "failed" ? "var(--neon-red)" : "var(--jarvis-blue)",
                    textTransform: "uppercase",
                  }}>
                    {reportJobStatus === "failed" ? "Report Generation Failed" : "Generating Report"}
                  </div>
                  <div style={{
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: "monospace",
                    color: reportJobStatus === "failed" ? "var(--neon-red)" : "var(--jarvis-blue)",
                  }}>
                    {reportProgress}%
                  </div>
                </div>

                {/* Progress bar */}
                {reportJobStatus === "running" && (
                  <div style={{
                    width: "100%",
                    height: 6,
                    borderRadius: 3,
                    background: "rgba(0,0,0,0.3)",
                    overflow: "hidden",
                    marginBottom: 8,
                  }}>
                    <div style={{
                      width: `${reportProgress}%`,
                      height: "100%",
                      borderRadius: 3,
                      background: "linear-gradient(90deg, rgba(182,242,58,0.6), rgba(182,242,58,0.9))",
                      boxShadow: "0 0 8px rgba(182,242,58,0.4)",
                      transition: "width 0.5s ease",
                    }} />
                  </div>
                )}

                {/* Stage label */}
                {reportStage && reportJobStatus === "running" && (
                  <div style={{
                    fontSize: 9,
                    fontFamily: "monospace",
                    color: "var(--text-dim)",
                    marginBottom: 6,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}>
                    <span style={{
                      display: "inline-block",
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "var(--jarvis-blue)",
                      animation: "pulse-green 1.5s ease-in-out infinite",
                    }} />
                    {reportStage}
                  </div>
                )}

                {/* Error output */}
                {reportJobStatus === "failed" && reportJobOutput && (
                  <pre style={{
                    fontSize: 9,
                    fontFamily: "monospace",
                    color: "var(--text-dim)",
                    background: "rgba(0,0,0,0.2)",
                    padding: 8,
                    borderRadius: 4,
                    maxHeight: 100,
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}>
                    {reportJobOutput.slice(-500)}
                  </pre>
                )}
              </div>
            )}

            {reportJobStatus === "completed" && (
              <div style={{
                marginBottom: 16,
                padding: 10,
                borderRadius: 6,
                border: "1px solid rgba(43,212,127,0.3)",
                background: "rgba(43,212,127,0.06)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}>
                <span style={{ color: "var(--neon-green)", fontSize: 14 }}>{"✓"}</span>
                <span style={{ fontSize: 11, color: "var(--neon-green)", fontWeight: 600 }}>
                  Report generated successfully
                </span>
                <button
                  onClick={viewReport}
                  style={{
                    fontSize: 10,
                    padding: "3px 10px",
                    borderRadius: 4,
                    border: "1px solid rgba(43,212,127,0.3)",
                    background: "rgba(43,212,127,0.12)",
                    color: "var(--neon-green)",
                    cursor: "pointer",
                    marginLeft: "auto",
                  }}
                >
                  View Report
                </button>
              </div>
            )}

            {/* Recent files — filtered by selected directories */}
            <div>
              {(() => {
                const filteredFiles = dirFilters.size === 0
                  ? files
                  : files.filter((f) => {
                      const topDir = f.relativePath.split("/")[0];
                      return dirFilters.has(topDir);
                    });
                return (
                  <>
                    <div style={{
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      color: "var(--text-muted)",
                      marginBottom: 6,
                      textTransform: "uppercase",
                    }}>
                      {dirFilters.size > 0
                        ? `Files in ${[...dirFilters].join(", ")} (${filteredFiles.length})`
                        : `All Files (${files.length})`}
                    </div>

                    {filesLoading ? (
                      <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)", fontSize: 10 }}>
                        Loading files...
                      </div>
                    ) : filteredFiles.length === 0 ? (
                      <div style={{ textAlign: "center", padding: 20, color: "var(--text-muted)", fontSize: 10 }}>
                        {dirFilters.size > 0 ? "No files in selected directories" : "No files yet"}
                      </div>
                    ) : (
                      <div style={{
                        background: "rgba(0,0,0,0.15)",
                        borderRadius: 6,
                        border: "1px solid var(--border-color)",
                        overflow: "hidden",
                        maxHeight: 400,
                        overflowY: "auto",
                      }}>
                        {filteredFiles.slice(0, 30).map((file, i) => (
                    <button
                      key={file.path}
                      onClick={() => openFileViewer(file.path)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "6px 10px",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        borderBottom: i < Math.min(files.length, 15) - 1 ? "1px solid rgba(182,242,58,0.06)" : "none",
                        background: "transparent",
                        border: "none",
                        borderBottomStyle: "solid",
                        borderBottomWidth: i < Math.min(files.length, 15) - 1 ? 1 : 0,
                        borderBottomColor: "rgba(182,242,58,0.06)",
                        cursor: "pointer",
                        color: "inherit",
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(182,242,58,0.04)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      <span style={{ fontSize: 12, flexShrink: 0 }}>{fileExtIcon(file.relativePath)}</span>
                      <span style={{
                        flex: 1,
                        fontSize: 10,
                        fontFamily: "monospace",
                        color: "var(--text-primary)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}>
                        {file.relativePath}
                      </span>
                      <span style={{ fontSize: 9, color: "var(--text-muted)", flexShrink: 0 }}>
                        {formatSize(file.size)}
                      </span>
                      <span style={{ fontSize: 9, color: "var(--text-muted)", flexShrink: 0 }}>
                        {formatDate(file.modified)}
                      </span>
                    </button>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── Report Viewer Modal ── */}
      {showReport && reportHtml && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowReport(false);
              setReportHtml(null);
            }
          }}
        >
          <div style={{
            width: "90%",
            maxWidth: 1000,
            height: "90%",
            background: "var(--bg-primary)",
            borderRadius: 10,
            border: "1px solid var(--border-bright)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 0 40px rgba(182,242,58,0.15)",
          }}>
            {/* Modal header */}
            <div style={{
              padding: "10px 16px",
              borderBottom: "1px solid var(--border-color)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--jarvis-blue)" }}>
                Report: {selected?.name}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => {
                    // Open in new tab for PDF export
                    const blob = new Blob([reportHtml], { type: "text/html" });
                    const url = URL.createObjectURL(blob);
                    window.open(url, "_blank");
                  }}
                  style={{
                    fontSize: 10,
                    padding: "4px 10px",
                    borderRadius: 4,
                    border: "1px solid var(--border-color)",
                    background: "transparent",
                    color: "var(--text-dim)",
                    cursor: "pointer",
                  }}
                >
                  Open in Tab
                </button>
                <button
                  onClick={() => setShowFeedbackPanel(!showFeedbackPanel)}
                  style={{
                    fontSize: 10,
                    padding: "4px 10px",
                    borderRadius: 4,
                    border: `1px solid ${showFeedbackPanel ? "rgba(182,242,58,0.5)" : "rgba(255,174,66,0.3)"}`,
                    background: showFeedbackPanel ? "rgba(182,242,58,0.1)" : "transparent",
                    color: showFeedbackPanel ? "var(--jarvis-blue)" : "var(--neon-amber)",
                    cursor: "pointer",
                  }}
                >
                  {showFeedbackPanel ? "Hide Feedback" : "Request Changes"}
                </button>
                <button
                  onClick={() => { setShowReport(false); setReportHtml(null); setShowFeedbackPanel(false); setReportFeedback(""); }}
                  style={{
                    fontSize: 10,
                    padding: "4px 10px",
                    borderRadius: 4,
                    border: "1px solid rgba(255,77,99,0.3)",
                    background: "transparent",
                    color: "var(--neon-red)",
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
              </div>
            </div>

            {/* Feedback panel — request changes and regenerate */}
            {showFeedbackPanel && (
              <div style={{
                padding: "10px 16px",
                borderBottom: "1px solid var(--border-color)",
                background: "rgba(255,174,66,0.03)",
                flexShrink: 0,
              }}>
                <p style={{ fontSize: 10, color: "var(--neon-amber)", marginBottom: 6, fontWeight: 600 }}>
                  Describe what needs to be changed. Claude will regenerate the report with your feedback.
                </p>
                <textarea
                  value={reportFeedback}
                  onChange={(e) => setReportFeedback(e.target.value)}
                  placeholder="e.g., The client name should be 'Acme Corp'. Add the SSRF finding from the notes. Change severity of Finding #2 to High. Include the Metasploit module used..."
                  rows={3}
                  style={{
                    width: "100%",
                    fontSize: 11,
                    fontFamily: "inherit",
                    background: "rgba(0,0,0,0.2)",
                    border: "1px solid var(--border-color)",
                    borderRadius: 6,
                    padding: "6px 10px",
                    color: "var(--text-primary)",
                    resize: "vertical",
                    outline: "none",
                  }}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
                  <button
                    onClick={async () => {
                      if (!selected || !reportFeedback.trim()) return;
                      setRegenerating(true);
                      try {
                        // Delete old report first
                        await fetch(`/api/files/write`, {
                          method: "PUT",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            path: `${selected.path}/report/feedback.md`,
                            content: `# Report Feedback\n\n${reportFeedback}\n\nGenerated: ${new Date().toISOString()}\n`,
                          }),
                        });
                        // Trigger regeneration
                        const resp = await fetch(`/api/engagements/${encodeURIComponent(selected.name)}/generate-report`, { method: "POST" });
                        const data = await resp.json();
                        if (data.jobId) {
                          setShowReport(false);
                          setReportHtml(null);
                          setShowFeedbackPanel(false);
                          setReportFeedback("");
                          // The engagements page will show the generation progress
                          alert(`Report regeneration started (Job: ${data.jobId}). Check the detail panel for progress.`);
                        }
                      } catch (e: any) {
                        alert(`Error: ${e.message}`);
                      }
                      setRegenerating(false);
                    }}
                    disabled={regenerating || !reportFeedback.trim()}
                    style={{
                      fontSize: 10,
                      padding: "5px 14px",
                      borderRadius: 4,
                      border: "1px solid rgba(182,242,58,0.3)",
                      background: "rgba(182,242,58,0.1)",
                      color: "var(--jarvis-blue)",
                      cursor: regenerating || !reportFeedback.trim() ? "not-allowed" : "pointer",
                      opacity: regenerating || !reportFeedback.trim() ? 0.5 : 1,
                      fontWeight: 600,
                    }}
                  >
                    {regenerating ? "Regenerating..." : "Regenerate Report"}
                  </button>
                  <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
                    Your feedback is saved to report/feedback.md and included in the next generation.
                  </span>
                </div>
              </div>
            )}

            {/* Report iframe */}
            <div style={{ flex: 1, overflow: "hidden" }}>
              <iframe
                srcDoc={reportHtml}
                sandbox="allow-same-origin"
                style={{
                  width: "100%",
                  height: "100%",
                  border: "none",
                  background: "#fff",
                }}
                title="Engagement Report"
              />
            </div>
          </div>
        </div>
      )}

      {/* ── File Viewer Modal ── */}
      {viewingFile && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setViewingFile(null);
              setFileContent(null);
            }
          }}
        >
          <div style={{
            width: "80%",
            maxWidth: 800,
            height: "80%",
            background: "var(--bg-primary)",
            borderRadius: 10,
            border: "1px solid var(--border-bright)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 0 40px rgba(182,242,58,0.15)",
          }}>
            {/* Modal header */}
            <div style={{
              padding: "10px 16px",
              borderBottom: "1px solid var(--border-color)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexShrink: 0,
            }}>
              <span style={{
                fontSize: 11,
                fontFamily: "monospace",
                color: "var(--jarvis-blue)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {viewingFile.split("/").slice(-2).join("/")}
              </span>
              <button
                onClick={() => { setViewingFile(null); setFileContent(null); }}
                style={{
                  fontSize: 10,
                  padding: "4px 10px",
                  borderRadius: 4,
                  border: "1px solid rgba(255,77,99,0.3)",
                  background: "transparent",
                  color: "var(--neon-red)",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                Close
              </button>
            </div>
            {/* File content */}
            <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
              {fileViewLoading ? (
                <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)", fontSize: 11 }}>
                  Loading...
                </div>
              ) : viewingFile.match(/\.(html|htm)$/i) ? (
                <iframe
                  srcDoc={fileContent || ""}
                  sandbox="allow-same-origin"
                  style={{
                    width: "100%",
                    height: "100%",
                    border: "1px solid var(--border-color)",
                    borderRadius: 6,
                    background: "#fff",
                  }}
                  title="File Preview"
                />
              ) : viewingFile.match(/\.md$/i) ? (
                <div
                  style={{
                    fontSize: 11,
                    lineHeight: 1.6,
                    color: "var(--text-primary)",
                    background: "rgba(0,0,0,0.15)",
                    padding: 12,
                    borderRadius: 6,
                    border: "1px solid var(--border-color)",
                    whiteSpace: "pre-wrap",
                    fontFamily: "inherit",
                  }}
                >
                  {fileContent}
                </div>
              ) : (
                <pre style={{
                  fontSize: 10,
                  fontFamily: "monospace",
                  lineHeight: 1.5,
                  color: "var(--text-primary)",
                  background: "rgba(0,0,0,0.2)",
                  padding: 12,
                  borderRadius: 6,
                  border: "1px solid var(--border-color)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  margin: 0,
                }}>
                  {(fileContent || "").split("\n").map((line, i) => (
                    <div key={i} style={{ display: "flex" }}>
                      <span style={{
                        width: 35,
                        flexShrink: 0,
                        textAlign: "right",
                        paddingRight: 10,
                        color: "var(--text-muted)",
                        fontSize: 9,
                        userSelect: "none",
                      }}>
                        {i + 1}
                      </span>
                      <span style={{ flex: 1 }}>{line}</span>
                    </div>
                  ))}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
