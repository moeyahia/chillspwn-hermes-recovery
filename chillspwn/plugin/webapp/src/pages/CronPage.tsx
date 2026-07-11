import { useState, useEffect, useCallback } from "react";
import { CyberDropdown } from "../components/CyberDropdown";

// ── Types ──────────────────────────────────────────────

interface CronJob {
  name: string;
  cron?: string;
  schedule?: { kind?: string; expr?: string; display?: string; minutes?: number };
  prompt?: string;
  provider: string;
  model: string;
  enabled?: boolean;
  persona?: string;
  delivery?: {
    type: string;
    target?: string;
  };
}

function getJobCron(job: CronJob): string {
  if (job.cron) return job.cron;
  if (job.schedule?.expr) return job.schedule.expr;
  if (job.schedule?.kind === "interval" && job.schedule?.minutes) return `*/${job.schedule.minutes} * * * *`;
  if (job.schedule?.display) return job.schedule.display;
  return "";
}

function getJobPrompt(job: CronJob): string {
  return job.prompt || "";
}

function isJobEnabled(job: CronJob): boolean {
  return job.enabled !== false;
}

interface PersonaSummary {
  name: string;
  description: string;
  color: string;
  icon: string;
  model: string;
  permissionMode: string;
}

type EditingJob = Omit<CronJob, "delivery"> & {
  delivery?: { type: string; target?: string };
};

// ── Cron Expression Parser ─────────────────────────────

function describeCron(expr: string | undefined | null): string {
  if (!expr) return "No schedule";
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Every N minutes
  if (minute.startsWith("*/") && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const n = parseInt(minute.slice(2), 10);
    if (n === 1) return "Every minute";
    return `Every ${n} minutes`;
  }

  // Every N hours
  if (minute !== "*" && !minute.includes("/") && hour.startsWith("*/") && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const n = parseInt(hour.slice(2), 10);
    if (n === 1) return `Every hour at :${minute.padStart(2, "0")}`;
    return `Every ${n} hours at :${minute.padStart(2, "0")}`;
  }

  // Specific time daily
  if (!minute.includes("*") && !minute.includes("/") && !hour.includes("*") && !hour.includes("/") && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10);
    const ampm = h >= 12 ? "PM" : "AM";
    const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `Daily at ${displayH}:${String(m).padStart(2, "0")} ${ampm}`;
  }

  // Specific time on weekdays
  if (!minute.includes("*") && !hour.includes("*") && dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10);
    const ampm = h >= 12 ? "PM" : "AM";
    const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const days: Record<string, string> = {
      "0": "Sun", "1": "Mon", "2": "Tue", "3": "Wed",
      "4": "Thu", "5": "Fri", "6": "Sat",
      "1-5": "Mon-Fri", "0,6": "Weekends",
    };
    const dayStr = days[dayOfWeek] || dayOfWeek;
    return `${dayStr} at ${displayH}:${String(m).padStart(2, "0")} ${ampm}`;
  }

  // Every hour
  if (minute !== "*" && !minute.includes("/") && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Hourly at :${minute.padStart(2, "0")}`;
  }

  // Fallback
  return expr;
}

// ── Empty Job Template ─────────────────────────────────

function emptyJob(): EditingJob {
  return {
    name: "",
    cron: "0 * * * *",
    prompt: "",
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    enabled: true,
    persona: "",
  };
}

// ── Toggle Switch ──────────────────────────────────────

function ToggleSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{
        position: "relative",
        width: 40,
        height: 22,
        borderRadius: 11,
        border: "1px solid var(--border-color)",
        background: checked ? "var(--neon-green)" : "rgba(0,0,0,0.08)",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.2s ease",
        flexShrink: 0,
        padding: 0,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: checked ? 20 : 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
          transition: "left 0.2s ease",
        }}
      />
    </button>
  );
}

// ── Main Component ─────────────────────────────────────

export default function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Expanded job index (view details)
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  // Editing state: index being edited, or "new" for create mode
  const [editingIndex, setEditingIndex] = useState<number | "new" | null>(null);
  const [editDraft, setEditDraft] = useState<EditingJob>(emptyJob());

  // Save/delete status feedback
  const [saveStatus, setSaveStatus] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null);

  // ── Data fetching ──

  const fetchJobs = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch("/api/cron")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setJobs(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  const fetchPersonas = useCallback(() => {
    fetch("/api/personas")
      .then((r) => r.json())
      .then((data) => setPersonas(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchJobs();
    fetchPersonas();
  }, [fetchJobs, fetchPersonas]);

  // ── Persona-to-provider/model mapping ──

  const personaOptions = personas.map((p) => ({
    label: p.name,
    description: p.description,
    model: p.model,
    color: p.color,
    icon: p.icon,
  }));

  const applyPersona = (personaName: string) => {
    const p = personas.find((pp) => pp.name === personaName);
    if (p) {
      // Parse "provider/model" or just "model"
      const parts = p.model.split("/");
      const provider = parts.length > 1 ? parts[0] : "anthropic";
      const model = parts.length > 1 ? parts.slice(1).join("/") : p.model;
      setEditDraft((d) => ({ ...d, persona: personaName, provider, model }));
    } else {
      setEditDraft((d) => ({ ...d, persona: personaName }));
    }
  };

  // ── Edit handlers ──

  const startEdit = (index: number) => {
    const job = jobs[index];
    setEditingIndex(index);
    setEditDraft({
      name: job.name,
      cron: getJobCron(job),
      prompt: getJobPrompt(job),
      provider: job.provider,
      model: job.model,
      enabled: isJobEnabled(job),
      persona: job.persona || "",
    });
    setExpandedIndex(index);
    setSaveStatus(null);
  };

  const startCreate = () => {
    setEditingIndex("new");
    setEditDraft(emptyJob());
    setExpandedIndex(null);
    setSaveStatus(null);
  };

  const cancelEdit = () => {
    setEditingIndex(null);
    setEditDraft(emptyJob());
    setSaveStatus(null);
  };

  const saveJob = async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      const isNew = editingIndex === "new";
      const url = isNew ? "/api/cron" : `/api/cron/${editingIndex}`;
      const method = isNew ? "POST" : "PUT";

      const body: Record<string, unknown> = {
        name: editDraft.name,
        cron: editDraft.cron || "",
        prompt: editDraft.prompt || "",
        provider: editDraft.provider,
        model: editDraft.model,
        enabled: editDraft.enabled,
      };
      if (editDraft.persona) body.persona = editDraft.persona;

      const resp = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (resp.ok) {
        setSaveStatus({ type: "ok", msg: isNew ? "Job created" : "Job updated" });
        setEditingIndex(null);
        fetchJobs();
      } else {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        setSaveStatus({ type: "err", msg: err.error || `HTTP ${resp.status}` });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveStatus({ type: "err", msg });
    }
    setSaving(false);
  };

  const deleteJob = async (index: number) => {
    setSaving(true);
    setSaveStatus(null);
    try {
      const resp = await fetch(`/api/cron/${index}`, { method: "DELETE" });
      if (resp.ok) {
        setSaveStatus({ type: "ok", msg: "Job deleted" });
        setConfirmDeleteIndex(null);
        setExpandedIndex(null);
        setEditingIndex(null);
        fetchJobs();
      } else {
        const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
        setSaveStatus({ type: "err", msg: err.error || `HTTP ${resp.status}` });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveStatus({ type: "err", msg });
    }
    setSaving(false);
  };

  const toggleExpand = (index: number) => {
    if (editingIndex !== null && editingIndex !== index) return; // don't collapse while editing another
    setExpandedIndex((prev) => (prev === index ? null : index));
    setConfirmDeleteIndex(null);
  };

  // ── Field updater ──

  const updateDraft = <K extends keyof EditingJob>(key: K, value: EditingJob[K]) => {
    setEditDraft((d) => ({ ...d, [key]: value }));
  };

  // ── Styles ──

  const cardStyle: React.CSSProperties = {
    // Dark glass surface — matches the rest of the app's neon/jarvis theme
    background: "var(--bg-surface)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid var(--border-color)",
    borderRadius: 8,
    boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
    transition: "all 0.2s ease",
    overflow: "hidden",
  };

  const cardHoverStyle: React.CSSProperties = {
    // Subtle cyan glow on hover (matches --jarvis-blue accent)
    borderColor: "var(--border-bright)",
    boxShadow: "0 8px 32px rgba(182,242,58,0.12)",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 10px",
    fontSize: "0.8rem",
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    borderRadius: 6,
    border: "1px solid var(--border-color)",
    // Dark input surface — keeps text legible against the dark page background
    background: "var(--bg-primary)",
    color: "var(--text-primary)",
    outline: "none",
    transition: "border-color 0.2s ease, box-shadow 0.2s ease",
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: "pointer",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "0.65rem",
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
    marginBottom: 4,
    display: "block",
  };

  const btnPrimary: React.CSSProperties = {
    padding: "6px 16px",
    fontSize: "0.75rem",
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    letterSpacing: "0.06em",
    borderRadius: 6,
    border: "1px solid var(--jarvis-blue)",
    background: "var(--jarvis-blue)",
    color: "#fff",
    cursor: "pointer",
    transition: "all 0.15s ease",
  };

  const btnSecondary: React.CSSProperties = {
    ...btnPrimary,
    background: "transparent",
    color: "var(--text-dim)",
    borderColor: "var(--border-bright)",
  };

  const btnDanger: React.CSSProperties = {
    ...btnPrimary,
    background: "transparent",
    color: "var(--neon-red)",
    borderColor: "var(--neon-red)",
  };

  const btnDangerFilled: React.CSSProperties = {
    ...btnPrimary,
    background: "var(--neon-red)",
    borderColor: "var(--neon-red)",
    color: "#fff",
  };

  const btnSuccess: React.CSSProperties = {
    ...btnPrimary,
    background: "var(--neon-green)",
    borderColor: "var(--neon-green)",
    color: "#fff",
  };

  // ── Render: Create Form ──

  const renderEditForm = () => {
    const isNew = editingIndex === "new";

    return (
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        {/* Header */}
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "rgba(0,119,204,0.04)",
          }}
        >
          <span
            style={{
              fontFamily: '"JetBrains Mono", "Fira Code", monospace',
              fontSize: "0.75rem",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--jarvis-blue)",
              fontWeight: 600,
            }}
          >
            {isNew ? "Create New Job" : `Editing: ${editDraft.name}`}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={cancelEdit} style={btnSecondary}>Cancel</button>
            <button
              onClick={saveJob}
              disabled={saving || !editDraft.name.trim() || !(editDraft.cron || "").trim()}
              style={{
                ...btnSuccess,
                opacity: saving || !editDraft.name.trim() || !(editDraft.cron || "").trim() ? 0.5 : 1,
                cursor: saving ? "wait" : "pointer",
              }}
            >
              {saving ? "Saving..." : isNew ? "Create" : "Save"}
            </button>
          </div>
        </div>

        {/* Form body */}
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Row: Name + Enabled */}
          <div style={{ display: "flex", gap: 16, alignItems: "flex-end" }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Job Name</label>
              <input
                type="text"
                value={editDraft.name}
                onChange={(e) => updateDraft("name", e.target.value)}
                placeholder="my-scheduled-task"
                style={inputStyle}
                className="glow-input"
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <label style={labelStyle}>Enabled</label>
              <ToggleSwitch
                checked={editDraft.enabled !== false}
                onChange={(v) => updateDraft("enabled", v)}
              />
            </div>
          </div>

          {/* Row: Schedule */}
          <div>
            <label style={labelStyle}>Cron Schedule</label>
            <input
              type="text"
              value={editDraft.cron}
              onChange={(e) => updateDraft("cron", e.target.value)}
              placeholder="*/5 * * * *"
              style={inputStyle}
              className="glow-input"
            />
            {(editDraft.cron || "").trim() && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: "0.7rem",
                  color: "var(--jarvis-blue)",
                  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                }}
              >
                {describeCron(editDraft.cron)}
              </div>
            )}
          </div>

          {/* Row: Persona + Provider + Model */}
          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Agent / Persona</label>
              <CyberDropdown
                value={editDraft.persona || ""}
                onChange={(val) => {
                  if (val) {
                    applyPersona(val);
                  } else {
                    updateDraft("persona", "");
                  }
                }}
                fullWidth
                placeholder="-- Custom --"
                options={[
                  { id: "", label: "-- Custom --" },
                  ...personaOptions.map((p) => ({ id: p.label, label: p.label })),
                ]}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Provider</label>
              <input
                type="text"
                value={editDraft.provider}
                onChange={(e) => updateDraft("provider", e.target.value)}
                placeholder="anthropic"
                style={inputStyle}
                className="glow-input"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Model</label>
              <input
                type="text"
                value={editDraft.model}
                onChange={(e) => updateDraft("model", e.target.value)}
                placeholder="claude-sonnet-4-20250514"
                style={inputStyle}
                className="glow-input"
              />
            </div>
          </div>

          {/* Prompt */}
          <div>
            <label style={labelStyle}>Prompt</label>
            <textarea
              value={editDraft.prompt}
              onChange={(e) => updateDraft("prompt", e.target.value)}
              placeholder="Enter the prompt for this scheduled job..."
              rows={6}
              style={{
                ...inputStyle,
                resize: "vertical",
                minHeight: 100,
                lineHeight: 1.5,
              }}
              className="glow-input"
            />
          </div>
        </div>
      </div>
    );
  };

  // ── Render: Job Card ──

  const renderJobCard = (job: CronJob, index: number) => {
    const isExpanded = expandedIndex === index;
    const isEditing = editingIndex === index;
    const isDeleting = confirmDeleteIndex === index;

    // If we're editing this card inline, show the edit form instead
    if (isEditing) {
      return (
        <div key={`job-${index}`}>
          {renderEditForm()}
        </div>
      );
    }

    return (
      <div
        key={`job-${index}`}
        style={{
          ...cardStyle,
          marginBottom: 12,
          ...(isExpanded ? cardHoverStyle : {}),
        }}
        onMouseEnter={(e) => {
          if (!isExpanded) {
            Object.assign(e.currentTarget.style, {
              borderColor: "var(--border-bright)",
              boxShadow: "0 8px 32px rgba(182,242,58,0.12)",
            });
          }
        }}
        onMouseLeave={(e) => {
          if (!isExpanded) {
            Object.assign(e.currentTarget.style, {
              borderColor: "",
              boxShadow: "",
            });
          }
        }}
      >
        {/* Summary row (always visible) */}
        <div
          onClick={() => toggleExpand(index)}
          style={{
            padding: "12px 16px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 14,
            userSelect: "none",
          }}
        >
          {/* Status indicator */}
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: isJobEnabled(job) ? "var(--neon-green)" : "rgba(0,0,0,0.15)",
              boxShadow: isJobEnabled(job) ? "0 0 8px rgba(0,170,68,0.4)" : "none",
              flexShrink: 0,
            }}
            className={isJobEnabled(job) ? "pulse-dot" : ""}
          />

          {/* Name */}
          <span
            style={{
              flex: 1,
              fontWeight: 600,
              fontSize: "0.85rem",
              color: "var(--text-primary)",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {job.name}
          </span>

          {/* Schedule badge */}
          <span
            style={{
              fontFamily: '"JetBrains Mono", "Fira Code", monospace',
              fontSize: "0.7rem",
              color: "var(--jarvis-blue)",
              background: "var(--jarvis-blue-faint)",
              border: "1px solid var(--jarvis-blue-dim)",
              padding: "2px 10px",
              borderRadius: 12,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {describeCron(getJobCron(job))}
          </span>

          {/* Provider/Model */}
          <span
            style={{
              fontFamily: '"JetBrains Mono", "Fira Code", monospace',
              fontSize: "0.65rem",
              color: "var(--text-dim)",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {job.persona || `${job.provider}/${job.model}`}
          </span>

          {/* Expand chevron */}
          <span
            style={{
              fontSize: "0.7rem",
              color: "var(--text-muted)",
              transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.2s ease",
              flexShrink: 0,
            }}
          >
            &#9660;
          </span>
        </div>

        {/* Expanded details */}
        {isExpanded && (
          <div
            style={{
              borderTop: "1px solid var(--border-color)",
              padding: 16,
            }}
          >
            {/* Detail grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <div style={labelStyle}>Schedule</div>
                <code
                  style={{
                    fontSize: "0.8rem",
                    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                    color: "var(--neon-cyan)",
                    background: "rgba(0,153,170,0.06)",
                    padding: "2px 8px",
                    borderRadius: 4,
                  }}
                >
                  {getJobCron(job)}
                </code>
              </div>
              <div>
                <div style={labelStyle}>Provider</div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-primary)" }}>
                  {job.provider}
                </div>
              </div>
              <div>
                <div style={labelStyle}>Model</div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                    color: "var(--text-primary)",
                  }}
                >
                  {job.model}
                </div>
              </div>
              <div>
                <div style={labelStyle}>Status</div>
                <div style={{ fontSize: "0.8rem" }}>
                  {isJobEnabled(job) ? (
                    <span style={{ color: "var(--neon-green)", fontWeight: 600 }}>Active</span>
                  ) : (
                    <span style={{ color: "var(--text-muted)" }}>Disabled</span>
                  )}
                </div>
              </div>
            </div>

            {/* Persona row */}
            {job.persona && (
              <div style={{ marginBottom: 12 }}>
                <div style={labelStyle}>Agent / Persona</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {(() => {
                    const p = personas.find((pp) => pp.name === job.persona);
                    if (p) {
                      return (
                        <>
                          <span
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: "50%",
                              background: p.color,
                              flexShrink: 0,
                            }}
                          />
                          <span style={{ fontSize: "0.8rem", color: "var(--text-primary)", fontWeight: 500 }}>
                            {p.name}
                          </span>
                          <span style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>
                            {p.description}
                          </span>
                        </>
                      );
                    }
                    return (
                      <span style={{ fontSize: "0.8rem", color: "var(--text-primary)" }}>
                        {job.persona}
                      </span>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Delivery config */}
            {job.delivery && (
              <div style={{ marginBottom: 12 }}>
                <div style={labelStyle}>Delivery</div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-primary)" }}>
                  {job.delivery.type}
                  {job.delivery.target && (
                    <span style={{ color: "var(--text-dim)", marginLeft: 8 }}>
                      {job.delivery.target}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Prompt */}
            {getJobPrompt(job) && (
              <div style={{ marginBottom: 16 }}>
                <div style={labelStyle}>Prompt</div>
                <pre
                  style={{
                    fontSize: "0.75rem",
                    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                    color: "var(--text-primary)",
                    background: "rgba(0,30,60,0.03)",
                    border: "1px solid var(--border-color)",
                    borderRadius: 6,
                    padding: "10px 14px",
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    margin: 0,
                    maxHeight: 200,
                    overflowY: "auto",
                  }}
                >
                  {getJobPrompt(job)}
                </pre>
              </div>
            )}

            {/* Action buttons */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                borderTop: "1px solid var(--border-color)",
                paddingTop: 12,
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  startEdit(index);
                }}
                style={btnPrimary}
              >
                Edit
              </button>

              {!isDeleting && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDeleteIndex(index);
                  }}
                  style={btnDanger}
                >
                  Delete
                </button>
              )}

              {isDeleting && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 12px",
                    background: "rgba(204,34,51,0.05)",
                    border: "1px solid rgba(204,34,51,0.15)",
                    borderRadius: 6,
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--neon-red)",
                      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                    }}
                  >
                    Delete "{job.name}"?
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteJob(index);
                    }}
                    disabled={saving}
                    style={{
                      ...btnDangerFilled,
                      fontSize: "0.7rem",
                      padding: "4px 12px",
                      opacity: saving ? 0.5 : 1,
                    }}
                  >
                    {saving ? "..." : "Yes, Delete"}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteIndex(null);
                    }}
                    style={{
                      ...btnSecondary,
                      fontSize: "0.7rem",
                      padding: "4px 12px",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ── Main render ──

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid var(--border-color)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          // Dark sticky header — was bright white, now matches the app theme
          background: "var(--bg-surface)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          flexShrink: 0,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: "0.85rem",
              fontWeight: 700,
              fontFamily: '"JetBrains Mono", "Fira Code", monospace',
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--jarvis-blue)",
            }}
          >
            Cron Jobs
          </h2>
          <p
            style={{
              margin: "2px 0 0 0",
              fontSize: "0.7rem",
              color: "var(--text-muted)",
              fontFamily: '"JetBrains Mono", "Fira Code", monospace',
            }}
          >
            {jobs.length} job{jobs.length !== 1 ? "s" : ""} configured
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={fetchJobs} style={btnSecondary}>
            Refresh
          </button>
          <button
            onClick={startCreate}
            disabled={editingIndex !== null}
            style={{
              ...btnPrimary,
              opacity: editingIndex !== null ? 0.5 : 1,
            }}
          >
            + New Job
          </button>
        </div>
      </div>

      {/* Status banner */}
      {saveStatus && (
        <div
          style={{
            padding: "8px 16px",
            fontSize: "0.75rem",
            fontFamily: '"JetBrains Mono", "Fira Code", monospace',
            color: saveStatus.type === "ok" ? "var(--neon-green)" : "var(--neon-red)",
            background:
              saveStatus.type === "ok"
                ? "rgba(0,170,68,0.06)"
                : "rgba(204,34,51,0.06)",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>{saveStatus.type === "ok" ? "✓" : "✗"} {saveStatus.msg}</span>
          <button
            onClick={() => setSaveStatus(null)}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: "0.75rem",
              padding: "2px 6px",
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {/* Loading */}
        {loading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 256,
              color: "var(--text-muted)",
            }}
          >
            <span className="animate-pulse">Loading cron jobs...</span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: 256,
              color: "var(--neon-red)",
            }}
          >
            <div style={{ textAlign: "center" }}>
              <p style={{ fontSize: "0.85rem", margin: 0 }}>Failed to load cron jobs</p>
              <p
                style={{
                  fontSize: "0.75rem",
                  marginTop: 4,
                  color: "var(--text-muted)",
                }}
              >
                {error}
              </p>
            </div>
          </div>
        )}

        {/* Create form (when not inline editing) */}
        {!loading && !error && editingIndex === "new" && renderEditForm()}

        {/* Empty state */}
        {!loading && !error && jobs.length === 0 && editingIndex !== "new" && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: 256,
              color: "var(--text-muted)",
            }}
          >
            <div
              style={{
                fontSize: "2.5rem",
                marginBottom: 12,
                color: "var(--jarvis-blue)",
                opacity: 0.3,
              }}
            >
              &#9678;
            </div>
            <p style={{ fontSize: "0.95rem", margin: 0, color: "var(--text-dim)" }}>
              No cron jobs configured
            </p>
            <p style={{ fontSize: "0.8rem", marginTop: 4, color: "var(--text-muted)" }}>
              Create a scheduled job to get started
            </p>
          </div>
        )}

        {/* Job cards */}
        {!loading && !error && jobs.length > 0 && (
          <div>
            {jobs.map((job, i) => renderJobCard(job, i))}
          </div>
        )}
      </div>
    </div>
  );
}
