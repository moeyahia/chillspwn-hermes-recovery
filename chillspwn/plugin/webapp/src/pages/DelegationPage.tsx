import { useState, useEffect } from "react";

interface DelegationConfig {
  delegation: {
    model: string;
    provider: string;
    max_concurrent_children: number;
    max_spawn_depth: number;
    orchestrator_enabled: boolean;
    child_timeout_seconds: number;
    subagent_auto_approve: boolean;
    max_iterations: number;
  };
  mainModel: { default?: string; provider?: string } | string;
  availableProviders: string[];
}

const KNOWN_MODELS: Record<string, string[]> = {
  "openai-codex": ["gpt-5.5", "gpt-4.1", "gpt-4.1-mini", "o3", "o4-mini"],
  anthropic: ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"],
  "xai-oauth": ["grok-3", "grok-4.3-reasoning"],
  "xai-grok": ["grok-4.5", "grok-composer-2.5-fast"],
  openrouter: ["deepseek/deepseek-v4-pro", "google/gemini-2.5-pro", "meta-llama/llama-4-405b"],
  gemini: ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3.1-flash-lite", "gemini-2.5-flash"],
};

export default function DelegationPage() {
  const [config, setConfig] = useState<DelegationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Editable fields
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("");
  const [maxChildren, setMaxChildren] = useState(15);
  const [maxDepth, setMaxDepth] = useState(1);
  const [orchestratorEnabled, setOrchestratorEnabled] = useState(false);
  const [timeout, setChildTimeout] = useState(7200);

  useEffect(() => {
    fetch("/api/delegation")
      .then((r) => r.json())
      .then((data: DelegationConfig) => {
        setConfig(data);
        setModel(data.delegation.model || "");
        setProvider(data.delegation.provider || "");
        setMaxChildren(data.delegation.max_concurrent_children || 15);
        setMaxDepth(data.delegation.max_spawn_depth || 1);
        setOrchestratorEnabled(data.delegation.orchestrator_enabled || false);
        setChildTimeout(data.delegation.child_timeout_seconds || 7200);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setSaveStatus(null);
    try {
      const resp = await fetch("/api/delegation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          provider,
          max_concurrent_children: maxChildren,
          max_spawn_depth: maxDepth,
          orchestrator_enabled: orchestratorEnabled,
          child_timeout_seconds: timeout,
        }),
      });
      if (resp.ok) {
        setSaveStatus("Saved! Restart Hermes gateway to apply.");
      } else {
        const err = await resp.json();
        setSaveStatus(`Error: ${err.error}`);
      }
    } catch (e: any) {
      setSaveStatus(`Error: ${e.message}`);
    }
    setSaving(false);
  };

  const models = KNOWN_MODELS[provider] || [];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-slate-500">
        <span className="animate-pulse">Loading delegation config...</span>
      </div>
    );
  }

  const mainModel =
    typeof config?.mainModel === "string"
      ? config.mainModel
      : config?.mainModel?.default || "unknown";
  const mainProvider =
    typeof config?.mainModel === "string"
      ? "auto"
      : (config?.mainModel as any)?.provider || "auto";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/50">
        <h2 className="text-sm font-semibold text-white">Delegation Config</h2>
        <p className="text-xs text-slate-500">
          Configure how ChillsPwn/Hermes delegates tasks to subagents
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          {/* Current main model info */}
          <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
              Main Agent (Hermes)
            </h3>
            <p className="text-sm text-white">
              Model: <code className="text-cyan-400">{mainModel}</code> · Provider:{" "}
              <code className="text-cyan-400">{mainProvider}</code>
            </p>
            <p className="text-xs text-slate-500 mt-1">
              This is configured in Hermes's config.yaml (model section)
            </p>
          </div>

          {/* Delegation provider */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
              Delegation Provider
            </label>
            <select
              value={provider}
              onChange={(e) => {
                setProvider(e.target.value);
                const firstModel = KNOWN_MODELS[e.target.value]?.[0] || "";
                setModel(firstModel);
              }}
              className="w-full bg-slate-800 text-white text-sm rounded-lg px-3 py-2 border border-slate-700 focus:border-blue-500 focus:outline-none"
            >
              <option value="">Select provider...</option>
              {(config?.availableProviders || []).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Available providers from Hermes auth configuration
            </p>
          </div>

          {/* Delegation model */}
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
              Delegation Model
            </label>
            <div className="flex gap-2">
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="flex-1 bg-slate-800 text-white text-sm rounded-lg px-3 py-2 border border-slate-700 focus:border-blue-500 focus:outline-none"
              >
                <option value="">Select model...</option>
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="or type custom model..."
                className="flex-1 bg-slate-800 text-white text-sm rounded-lg px-3 py-2 border border-slate-700 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Orchestrator toggle */}
          <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg p-4">
            <div>
              <h3 className="text-sm text-white font-medium">Orchestrator Mode</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Allow subagents to spawn their own sub-subagents
              </p>
            </div>
            <button
              onClick={() => setOrchestratorEnabled(!orchestratorEnabled)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                orchestratorEnabled ? "bg-blue-600" : "bg-slate-700"
              }`}
            >
              <span
                className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                  orchestratorEnabled ? "translate-x-5.5 left-0" : "left-0.5"
                }`}
                style={{ transform: orchestratorEnabled ? "translateX(22px)" : "translateX(0)" }}
              />
            </button>
          </div>

          {/* Numeric settings */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                Max Concurrent Children
              </label>
              <input
                type="number"
                value={maxChildren}
                onChange={(e) => setMaxChildren(parseInt(e.target.value) || 1)}
                min={1}
                max={50}
                className="w-full bg-slate-800 text-white text-sm rounded-lg px-3 py-2 border border-slate-700 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                Max Spawn Depth
              </label>
              <input
                type="number"
                value={maxDepth}
                onChange={(e) => setMaxDepth(parseInt(e.target.value) || 1)}
                min={1}
                max={5}
                className="w-full bg-slate-800 text-white text-sm rounded-lg px-3 py-2 border border-slate-700 focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1.5">
                Child Timeout (seconds)
              </label>
              <input
                type="number"
                value={timeout}
                onChange={(e) => setChildTimeout(parseInt(e.target.value) || 3600)}
                min={60}
                max={86400}
                className="w-full bg-slate-800 text-white text-sm rounded-lg px-3 py-2 border border-slate-700 focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Save */}
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 text-white text-sm rounded-lg transition-colors font-medium"
            >
              {saving ? "Saving..." : "Save to Hermes Config"}
            </button>
            {saveStatus && (
              <span
                className={`text-xs ${
                  saveStatus.startsWith("Error") ? "text-red-400" : "text-green-400"
                }`}
              >
                {saveStatus}
              </span>
            )}
          </div>

          <p className="text-xs text-slate-500">
            Changes are written to <code>~/.hermes/config.yaml</code> (shared
            with Hermes). Restart the Hermes gateway for delegation changes to
            take effect.
          </p>
        </div>
      </div>
    </div>
  );
}
