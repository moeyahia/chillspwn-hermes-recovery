import { useState, useEffect } from "react";

interface PersonaDetail {
  name: string;
  description: string;
  color: string;
  icon: string;
  model: string;
  permissionMode: string;
  soul: string;
  soulPath: string | null;
  isSymlink: boolean;
}

interface PersonaSummary {
  name: string;
  description: string;
  color: string;
  icon: string;
  model: string;
  permissionMode: string;
}

export default function PersonasPage() {
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<PersonaDetail | null>(null);
  const [editingSoul, setEditingSoul] = useState(false);
  const [soulDraft, setSoulDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/personas")
      .then((r) => r.json())
      .then((data) => {
        setPersonas(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const loadDetail = (name: string) => {
    setSelected(name);
    setDetail(null);
    setEditingSoul(false);
    setSaveStatus(null);
    fetch(`/api/personas/${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((data) => {
        setDetail(data);
        setSoulDraft(data.soul || "");
      })
      .catch(() => {});
  };

  const saveSoul = async () => {
    if (!selected || !detail) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      const resp = await fetch(`/api/personas/${encodeURIComponent(selected)}/soul`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: soulDraft }),
      });
      if (resp.ok) {
        const data = await resp.json();
        setSaveStatus(`Saved to ${data.path}`);
        setDetail({ ...detail, soul: soulDraft });
        setEditingSoul(false);
      } else {
        const err = await resp.json();
        setSaveStatus(`Error: ${err.error}`);
      }
    } catch (e: any) {
      setSaveStatus(`Error: ${e.message}`);
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: "var(--text-muted)" }}>
        <span className="animate-pulse">Loading personas...</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      {/* Persona list */}
      <div
        className="w-64 shrink-0 overflow-y-auto"
        style={{ borderRight: "1px solid var(--border-color)", background: "var(--bg-surface)" }}
      >
        <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border-color)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--neon-green)" }}>
            Personas
          </h2>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            {personas.length} configured
          </p>
        </div>

        <div className="p-2 space-y-1">
          {personas.map((p) => (
            <button
              key={p.name}
              onClick={() => loadDetail(p.name)}
              className={`session-item w-full text-left px-3 py-2.5 rounded text-sm ${
                selected === p.name ? "active" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: p.color }}
                />
                <span style={{ color: selected === p.name ? "var(--neon-green)" : "var(--text-primary)" }}>
                  {p.name}
                </span>
              </div>
              <div className="text-[11px] mt-0.5 ml-5 truncate" style={{ color: "var(--text-dim)" }}>
                {p.model} · {p.permissionMode}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selected && (
          <div className="flex items-center justify-center h-full" style={{ color: "var(--text-muted)" }}>
            Select a persona to view its settings and SOUL
          </div>
        )}

        {selected && detail && (
          <div className="max-w-3xl space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl"
                style={{ backgroundColor: detail.color + "20", border: `1px solid ${detail.color}40` }}
              >
                {detail.icon === "skull" ? "\u{1F480}" : detail.icon === "code" ? "\u{1F4BB}" : detail.icon === "search" ? "\u{1F50D}" : detail.icon === "terminal" ? "\u{1F5A5}" : detail.icon === "bug" ? "\u{1F41B}" : "\u{1F916}"}
              </div>
              <div>
                <h2 className="text-lg font-bold" style={{ color: detail.color }}>
                  {detail.name}
                </h2>
                <p className="text-sm" style={{ color: "var(--text-dim)" }}>
                  {detail.description}
                </p>
              </div>
            </div>

            {/* Settings grid */}
            <div className="grid grid-cols-3 gap-4">
              <div className="neon-card p-3">
                <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Model</div>
                <div className="text-sm font-cyber mt-1" style={{ color: "var(--neon-cyan)" }}>{detail.model}</div>
              </div>
              <div className="neon-card p-3">
                <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Permission Mode</div>
                <div className="text-sm font-cyber mt-1" style={{ color: "var(--neon-cyan)" }}>{detail.permissionMode}</div>
              </div>
              <div className="neon-card p-3">
                <div className="text-[10px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>Color</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="w-4 h-4 rounded" style={{ backgroundColor: detail.color }} />
                  <span className="text-sm font-cyber" style={{ color: "var(--text-primary)" }}>{detail.color}</span>
                </div>
              </div>
            </div>

            {/* SOUL section */}
            <div className="neon-card">
              <div
                className="px-4 py-3 flex items-center justify-between"
                style={{ borderBottom: "1px solid var(--border-color)" }}
              >
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: "var(--neon-green)" }}>
                    SOUL
                  </h3>
                  <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {detail.soulPath
                      ? (detail.isSymlink ? "Symlinked to " : "") + detail.soulPath
                      : "No SOUL file configured"}
                  </p>
                  {detail.isSymlink && (
                    <p className="text-[10px] mt-0.5" style={{ color: "var(--neon-amber)" }}>
                      Shared with Hermes — edits apply to both agents
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  {detail.soul && !editingSoul && (
                    <button
                      onClick={() => { setEditingSoul(true); setSoulDraft(detail.soul); setSaveStatus(null); }}
                      className="px-3 py-1 text-xs rounded"
                      style={{
                        border: "1px solid var(--neon-green)",
                        color: "var(--neon-green)",
                        background: "rgba(43,212,127,0.05)",
                      }}
                    >
                      Edit
                    </button>
                  )}
                  {editingSoul && (
                    <>
                      <button
                        onClick={() => { setEditingSoul(false); setSaveStatus(null); }}
                        className="px-3 py-1 text-xs rounded"
                        style={{ border: "1px solid var(--border-bright)", color: "var(--text-dim)" }}
                      >
                        Cancel
                      </button>
                      <button
                        onClick={saveSoul}
                        disabled={saving}
                        className="px-3 py-1 text-xs rounded"
                        style={{
                          background: "var(--neon-green)",
                          color: "#000",
                          opacity: saving ? 0.5 : 1,
                        }}
                      >
                        {saving ? "Saving..." : "Save"}
                      </button>
                    </>
                  )}
                </div>
              </div>

              {saveStatus && (
                <div
                  className="px-4 py-2 text-xs"
                  style={{
                    borderBottom: "1px solid var(--border-color)",
                    color: saveStatus.startsWith("Error") ? "var(--neon-red)" : "var(--neon-green)",
                    background: saveStatus.startsWith("Error") ? "rgba(255,0,64,0.05)" : "rgba(43,212,127,0.05)",
                  }}
                >
                  {saveStatus}
                </div>
              )}

              <div className="p-4">
                {!detail.soul && (
                  <p className="text-sm italic" style={{ color: "var(--text-muted)" }}>
                    This persona has no SOUL file. It uses Claude Code's default behavior.
                  </p>
                )}
                {detail.soul && !editingSoul && (
                  <pre
                    className="text-xs font-cyber leading-relaxed whitespace-pre-wrap overflow-y-auto max-h-96"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {detail.soul}
                  </pre>
                )}
                {editingSoul && (
                  <textarea
                    value={soulDraft}
                    onChange={(e) => setSoulDraft(e.target.value)}
                    className="w-full text-xs font-cyber leading-relaxed rounded p-3 glow-input"
                    style={{
                      background: "var(--bg-primary)",
                      border: "1px solid var(--border-color)",
                      color: "var(--text-primary)",
                      minHeight: "400px",
                      resize: "vertical",
                    }}
                  />
                )}
              </div>

              {detail.soul && (
                <div
                  className="px-4 py-2 text-[11px] font-cyber"
                  style={{ borderTop: "1px solid var(--border-color)", color: "var(--text-muted)" }}
                >
                  {detail.soul.split("\n").length} lines · {detail.soul.length} chars
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
