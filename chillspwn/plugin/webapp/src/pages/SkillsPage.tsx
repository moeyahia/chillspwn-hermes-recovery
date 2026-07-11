import { useState, useEffect } from "react";

interface Skill {
  name: string;
  icon?: string;
  description: string;
  symlink: boolean;
  source: string;
  defaultProvider: string;
  defaultModel: string;
  provider: string;
  model: string;
}

const KNOWN_MODELS: Record<string, string[]> = {
  "openai-codex": ["gpt-5.5", "gpt-4.1", "gpt-4.1-mini", "o3", "o4-mini"],
  anthropic: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"],
  "xai-oauth": ["grok-3", "grok-4.3-reasoning"],
  "xai-grok": ["grok-4.5", "grok-composer-2.5-fast"],
  openrouter: ["deepseek/deepseek-v4-pro", "google/gemini-2.5-pro", "meta-llama/llama-4-405b"],
  gemini: ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.1-flash-lite", "gemini-2.5-flash"],
  "": [],
};

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<Record<string, string>>({});

  const fetchSkills = () => {
    setLoading(true);
    fetch("/api/skills")
      .then((r) => r.json())
      .then((data) => {
        setSkills(data.skills || data);
        setProviders(data.availableProviders || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(fetchSkills, []);

  const updateSkillConfig = async (skillName: string, provider: string, model: string) => {
    setSaving(skillName);
    try {
      const resp = await fetch(`/api/skills/${encodeURIComponent(skillName)}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model }),
      });
      if (resp.ok) {
        setSaveStatus((prev) => ({ ...prev, [skillName]: "Saved" }));
        setSkills((prev) =>
          prev.map((s) => (s.name === skillName ? { ...s, provider, model } : s))
        );
        setTimeout(() => setSaveStatus((prev) => ({ ...prev, [skillName]: "" })), 2000);
      }
    } catch (e: any) {
      setSaveStatus((prev) => ({ ...prev, [skillName]: `Error: ${e.message}` }));
    }
    setSaving(null);
  };

  const shared = skills.filter((s) => s.symlink);
  const local = skills.filter((s) => !s.symlink);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: "var(--text-muted)" }}>
        <span className="animate-pulse">Loading skills...</span>
      </div>
    );
  }

  const renderSkillCard = (skill: Skill) => {
    const models = KNOWN_MODELS[skill.provider] || [];
    const status = saveStatus[skill.name] || "";

    return (
      <div key={skill.name} className="neon-card p-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold font-cyber" style={{ color: "var(--neon-green)" }}>
            <span style={{ marginRight: 6 }}>{skill.icon || "📜"}</span>{skill.name}
          </h3>
          <span
            className="text-[10px] px-2 py-0.5 rounded"
            style={{
              background: skill.symlink ? "rgba(0,255,255,0.1)" : "rgba(43,212,127,0.1)",
              color: skill.symlink ? "var(--neon-cyan)" : "var(--neon-green)",
              border: `1px solid ${skill.symlink ? "rgba(0,255,255,0.2)" : "rgba(43,212,127,0.2)"}`,
            }}
          >
            {skill.symlink ? "Shared" : "Local"}
          </span>
        </div>

        {/* Description */}
        <p className="text-xs mb-3" style={{ color: "var(--text-dim)" }}>
          {skill.description || "No description"}
        </p>

        {/* Provider / Model selectors */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label
              className="block text-[10px] uppercase tracking-widest mb-1"
              style={{ color: "var(--text-muted)" }}
            >
              Provider
            </label>
            <select
              value={skill.provider}
              onChange={(e) => {
                const newProvider = e.target.value;
                const firstModel = KNOWN_MODELS[newProvider]?.[0] || "";
                updateSkillConfig(skill.name, newProvider, firstModel);
              }}
              className="w-full text-xs rounded px-2 py-1.5 font-cyber glow-input"
              style={{
                background: "var(--bg-primary)",
                border: "1px solid var(--border-color)",
                color: "var(--text-primary)",
              }}
            >
              <option value="">Default (inherit)</option>
              {providers.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label
              className="block text-[10px] uppercase tracking-widest mb-1"
              style={{ color: "var(--text-muted)" }}
            >
              Model
            </label>
            <select
              value={skill.model}
              onChange={(e) => updateSkillConfig(skill.name, skill.provider, e.target.value)}
              className="w-full text-xs rounded px-2 py-1.5 font-cyber glow-input"
              style={{
                background: "var(--bg-primary)",
                border: "1px solid var(--border-color)",
                color: "var(--text-primary)",
              }}
            >
              <option value="">Default (inherit)</option>
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Status */}
        {status && (
          <div
            className="mt-2 text-[11px] font-cyber"
            style={{ color: status.startsWith("Error") ? "var(--neon-red)" : "var(--neon-green)" }}
          >
            {status}
          </div>
        )}

        {/* Source path */}
        {skill.symlink && (
          <div className="mt-2 text-[10px] font-cyber truncate" style={{ color: "var(--text-muted)" }}>
            {skill.source}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ borderBottom: "1px solid var(--border-color)", background: "var(--bg-surface)" }}
      >
        <div>
          <h2 className="text-sm font-semibold" style={{ color: "var(--neon-green)" }}>Skills</h2>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            {shared.length} shared from Hermes · {local.length} local · Choose provider/model per skill
          </p>
        </div>
        <button
          onClick={fetchSkills}
          className="px-3 py-1.5 text-xs rounded"
          style={{ border: "1px solid var(--border-bright)", color: "var(--text-dim)" }}
        >
          Refresh
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Shared skills (from Hermes) */}
        {shared.length > 0 && (
          <div className="mb-6">
            <h3 className="text-xs uppercase tracking-widest mb-3 flex items-center gap-2" style={{ color: "var(--neon-cyan)" }}>
              <span className="w-2 h-2 rounded-full" style={{ background: "var(--neon-cyan)" }} />
              Shared from Hermes ({shared.length})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {shared.map(renderSkillCard)}
            </div>
          </div>
        )}

        {/* Local skills */}
        {local.length > 0 && (
          <div>
            <h3 className="text-xs uppercase tracking-widest mb-3 flex items-center gap-2" style={{ color: "var(--neon-green)" }}>
              <span className="w-2 h-2 rounded-full" style={{ background: "var(--neon-green)" }} />
              ChillsPwn Local ({local.length})
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {local.map(renderSkillCard)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
