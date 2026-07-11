import { useState, useEffect, useMemo, useRef } from "react";
import { CyberDropdown } from "../components/CyberDropdown";

// ── Terminal-style per-persona orchestration config ──────────────────────────
// Lets the operator set each persona's backend: "anthropic" (the claude -p path,
// unchanged) or "openrouter" (the additive direct-OpenRouter backend), and pick the
// model. For anthropic a small fixed list; for openrouter the full live catalog.
// Saving PUTs /api/personas/:name/config — personas are hot-loaded, so the next chat
// uses it (no restart).

interface PersonaRow {
  name: string;
  description: string;
  color: string;
  model: string;
  provider: "anthropic" | "openrouter" | "openai-codex" | "gemini" | "xai-grok";
}
interface OrModel {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

const ANTHROPIC_MODELS = [
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
];

// Codex (ChatGPT backend) supported models — the codex-tuned + general gpt-5.x line that the
// chatgpt.com/backend-api/codex endpoint accepts (272K ctx on Codex). gpt-5.5 is the default.
const CODEX_MODELS = [
  "gpt-5.5",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2-codex",
  "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini",
  "gpt-5.4",
  "gpt-5.4-mini",
];

// Google Gemini (native generateContent API, safetySettings=BLOCK_NONE baked in by the gemini
// provider). gemini-3.5-flash is the default; -latest auto-tracks the newest Flash.
const GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-flash-latest",
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
];
// The local OAuth CLI reports these live ACP models. API-only model ids are
// intentionally excluded so the OAuth provider cannot route to API billing.
const GROK_MODELS = ["grok-4.5", "grok-composer-2.5-fast"];

const C = {
  bg: "#0a0e14",
  panel: "#161c27",
  border: "rgba(182,242,58,0.18)",
  green: "#2bd47f",
  cyan: "#b6f23a",
  amber: "#ffae42",
  dim: "#9aa6b6",
  mono: "'JetBrains Mono','Fira Code','Cascadia Code',monospace",
};

export default function SettingsPage() {
  const [personas, setPersonas] = useState<PersonaRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [provider, setProvider] = useState<"anthropic" | "openrouter" | "openai-codex" | "gemini" | "xai-grok">("anthropic");
  const [model, setModel] = useState("");
  const [orModels, setOrModels] = useState<OrModel[]>([]);
  const [orLoading, setOrLoading] = useState(false);
  const [codexModels, setCodexModels] = useState<string[]>([]);   // live codex model ids (models.dev)
  const [codexLoading, setCodexLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState("");
  const [dirty, setDirty] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  // ── HELPER / EXPLAIN config (separate from per-persona config) ──
  const [helperCfg, setHelperCfg] = useState<{
    enabled: boolean;
    provider: "anthropic" | "openrouter";
    model: string;
    contextDepth: number;
    style: "terse" | "teach";
  }>({ enabled: true, provider: "anthropic", model: "claude-haiku-4-5", contextDepth: 6, style: "teach" });
  const [helperSaving, setHelperSaving] = useState(false);
  const [helperStatus, setHelperStatus] = useState("");

  useEffect(() => {
    fetch("/api/helper-config")
      .then((r) => r.json())
      .then((j) => { if (j && typeof j === "object" && !j.error) setHelperCfg((c) => ({ ...c, ...j })); })
      .catch(() => {});
  }, []);

  // Lazily load the OpenRouter catalog when the helper provider is openrouter
  // (reuses the same orModels list the persona picker uses).
  useEffect(() => {
    if (helperCfg.provider === "openrouter" && orModels.length === 0 && !orLoading) {
      setOrLoading(true);
      fetch("/api/openrouter/models")
        .then((r) => r.json())
        .then((j) => setOrModels(j.models || []))
        .catch(() => {})
        .finally(() => setOrLoading(false));
    }
  }, [helperCfg.provider, orModels.length, orLoading]);

  const saveHelperCfg = () => {
    setHelperSaving(true);
    setHelperStatus("");
    fetch("/api/helper-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(helperCfg),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j && !j.error) { setHelperCfg((c) => ({ ...c, ...j })); setHelperStatus("✓ saved"); }
        else setHelperStatus(j?.error ? `! ${j.error}` : "! save failed");
      })
      .catch((e) => setHelperStatus(`! ${e.message}`))
      .finally(() => {
        setHelperSaving(false);
        setTimeout(() => setHelperStatus(""), 2500);
      });
  };

  // Load personas
  const reload = () => {
    fetch("/api/personas")
      .then((r) => r.json())
      .then((ps: PersonaRow[]) => {
        setPersonas(ps);
        if (!selected && ps.length) selectPersona(ps[0]);
      })
      .catch(() => setStatus("! failed to load personas"));
  };
  useEffect(reload, []);

  const selectPersona = (p: PersonaRow) => {
    setSelected(p.name);
    setProvider(p.provider || "anthropic");
    setModel(p.model || "");
    setDirty(false);
    setStatus("");
  };

  // Lazy-load the OpenRouter catalog the first time it's needed.
  useEffect(() => {
    if (provider === "openrouter" && orModels.length === 0 && !orLoading) {
      setOrLoading(true);
      fetch("/api/openrouter/models")
        .then((r) => r.json())
        .then((j) => setOrModels(j.models || []))
        .catch(() => setStatus("! failed to load OpenRouter catalog"))
        .finally(() => setOrLoading(false));
    }
  }, [provider]);

  // Lazy-load the live Codex model catalog (from models.dev via the server) on first need.
  useEffect(() => {
    if (provider === "openai-codex" && codexModels.length === 0 && !codexLoading) {
      setCodexLoading(true);
      fetch("/api/codex/models")
        .then((r) => r.json())
        .then((j) => setCodexModels((j.models || []).map((m: any) => m.id)))
        .catch(() => setCodexModels(CODEX_MODELS))   // fall back to the curated list
        .finally(() => setCodexLoading(false));
    }
  }, [provider]);

  const filteredModels = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return orModels.slice(0, 400);
    return orModels.filter(
      (m) => m.id.toLowerCase().includes(f) || (m.name || "").toLowerCase().includes(f)
    );
  }, [orModels, filter]);

  const save = () => {
    if (!selected) return;
    setStatus("saving…");
    fetch(`/api/personas/${encodeURIComponent(selected)}/config`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, model }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) { setStatus("! " + j.error); return; }
        setStatus(`✓ saved — ${selected} → ${provider}:${model} (applies to next chat)`);
        setDirty(false);
        reload();
      })
      .catch((e) => setStatus("! " + e.message));
  };

  const curPersona = personas.find((p) => p.name === selected);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: C.bg, color: C.dim, fontFamily: C.mono, fontSize: 13 }}>
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      {/* Left: persona list */}
      <div style={{ width: 200, borderRight: `1px solid ${C.border}`, overflowY: "auto", padding: 8 }}>
        <div style={{ color: C.cyan, fontSize: 11, letterSpacing: "0.1em", padding: "4px 6px 8px" }}>PERSONAS</div>
        {personas.map((p) => (
          <button
            key={p.name}
            onClick={() => selectPersona(p)}
            style={{
              display: "block", width: "100%", textAlign: "left", padding: "8px 10px", marginBottom: 4,
              background: selected === p.name ? "rgba(182,242,58,0.1)" : "transparent",
              border: "none", borderLeft: `2px solid ${selected === p.name ? C.cyan : "transparent"}`,
              color: selected === p.name ? C.green : C.dim, cursor: "pointer", fontFamily: C.mono, fontSize: 12,
            }}
          >
            <span style={{ color: p.color || C.cyan }}>●</span> {p.name}
            <div style={{ fontSize: 9, color: p.provider === "openrouter" ? C.amber : p.provider === "openai-codex" || p.provider === "xai-grok" ? C.green : p.provider === "gemini" ? "#ff8adb" : C.dim, marginTop: 2 }}>
              {p.provider === "openrouter" ? "OR" : p.provider === "openai-codex" ? "CODEX" : p.provider === "xai-grok" ? "GROK ACP" : p.provider === "gemini" ? "GEMINI" : "ANTHROPIC"}
            </div>
          </button>
        ))}
      </div>

      {/* Right: CLI-style config */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {!curPersona ? (
          <div style={{ color: C.dim }}>Select a persona…</div>
        ) : (
          <>
            <div style={{ color: C.green, marginBottom: 4 }}>
              <span style={{ color: C.cyan }}>chillspwn@dashboard</span>:~/personas/{curPersona.name}$ configure
            </div>
            <div style={{ color: C.dim, fontSize: 11, marginBottom: 14 }}>{curPersona.description}</div>

            {/* provider */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ color: C.cyan, fontSize: 11, marginBottom: 6 }}>BACKEND PROVIDER</div>
              {(["anthropic", "openrouter", "openai-codex", "gemini", "xai-grok"] as const).map((pv) => (
                <button
                  key={pv}
                  onClick={() => {
                    setProvider(pv); setDirty(true);
                    if (pv === "anthropic" && !ANTHROPIC_MODELS.includes(model)) setModel(ANTHROPIC_MODELS[0]);
                    if (pv === "openai-codex" && !CODEX_MODELS.includes(model)) setModel(CODEX_MODELS[0]);
                    if (pv === "gemini" && !GEMINI_MODELS.includes(model)) setModel(GEMINI_MODELS[0]);
                    if (pv === "xai-grok" && !GROK_MODELS.includes(model)) setModel(GROK_MODELS[0]);
                  }}
                  style={{
                    padding: "6px 14px", marginRight: 8, fontFamily: C.mono, fontSize: 12, cursor: "pointer",
                    background: provider === pv ? "rgba(43,212,127,0.12)" : "transparent",
                    border: `1px solid ${provider === pv ? C.green : C.border}`,
                    color: provider === pv ? C.green : C.dim, borderRadius: 4,
                  }}
                >
                  {provider === pv ? "[x] " : "[ ] "}{pv}
                </button>
              ))}
              <div style={{ color: C.dim, fontSize: 10, marginTop: 6 }}>
                {provider === "anthropic"
                  ? "→ claude -p (subscription, unchanged)"
                  : provider === "openai-codex"
                  ? "→ OpenAI Codex Responses API (gpt-5.5 on your ChatGPT subscription, via the shared Hermes login)"
                  : provider === "gemini"
                  ? "→ direct Google Gemini API (native generateContent, safetySettings=BLOCK_NONE, GEMINI_API_KEY billing)"
                  : provider === "xai-grok"
                  ? "→ Grok Build ACP via cached OAuth CLI session (no API key / no API-credit path)"
                  : "→ direct OpenRouter (OpenRouter credits)"}
              </div>
            </div>

            {/* model */}
            <div style={{ marginBottom: 14 }}>
              <div style={{ color: C.cyan, fontSize: 11, marginBottom: 6 }}>MODEL</div>
              {provider !== "openrouter" ? (
                (provider === "anthropic" ? ANTHROPIC_MODELS
                  : provider === "gemini" ? GEMINI_MODELS
                  : provider === "xai-grok" ? GROK_MODELS
                  : (codexModels.length ? codexModels : CODEX_MODELS)).map((m) => (
                  <button
                    key={m}
                    onClick={() => { setModel(m); setDirty(true); }}
                    style={{
                      display: "block", width: "100%", textAlign: "left", padding: "6px 10px", marginBottom: 4,
                      background: model === m ? "rgba(182,242,58,0.1)" : "transparent",
                      border: `1px solid ${model === m ? C.cyan : C.border}`,
                      color: model === m ? C.green : C.dim, cursor: "pointer", fontFamily: C.mono, fontSize: 12, borderRadius: 4,
                    }}
                  >
                    {model === m ? "› " : "  "}{m}
                  </button>
                ))
              ) : (
                <>
                  <input
                    ref={filterRef}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder={orLoading ? "loading catalog…" : `filter ${orModels.length} models… (e.g. deepseek, qwen, claude)`}
                    style={{
                      width: "100%", boxSizing: "border-box", padding: "8px 10px", marginBottom: 8,
                      background: C.panel, border: `1px solid ${C.border}`, color: C.green,
                      fontFamily: C.mono, fontSize: 12, borderRadius: 4, outline: "none",
                    }}
                  />
                  <div style={{ maxHeight: 320, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 4 }}>
                    {/* allow a freehand slug too */}
                    {model && !filteredModels.some((m) => m.id === model) && (
                      <div style={{ padding: "6px 10px", color: C.amber, fontSize: 11, borderBottom: `1px solid ${C.border}` }}>
                        current: {model}
                      </div>
                    )}
                    {filteredModels.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => { setModel(m.id); setDirty(true); }}
                        style={{
                          display: "block", width: "100%", textAlign: "left", padding: "6px 10px",
                          background: model === m.id ? "rgba(182,242,58,0.12)" : "transparent",
                          border: "none", borderLeft: `2px solid ${model === m.id ? C.cyan : "transparent"}`,
                          color: model === m.id ? C.green : C.dim, cursor: "pointer", fontFamily: C.mono, fontSize: 11.5,
                        }}
                      >
                        {model === m.id ? "› " : "  "}{m.id}
                        {m.context_length ? <span style={{ color: C.dim, fontSize: 9 }}>  {Math.round(m.context_length / 1000)}k</span> : null}
                      </button>
                    ))}
                    {!orLoading && filteredModels.length === 0 && (
                      <div style={{ padding: "8px 10px", color: C.dim, fontSize: 11 }}>no match</div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* save */}
            <button
              onClick={save}
              disabled={!dirty}
              style={{
                padding: "8px 18px", fontFamily: C.mono, fontSize: 13, fontWeight: 700,
                background: dirty ? C.green : "transparent", color: dirty ? "#06121e" : C.dim,
                border: `1px solid ${dirty ? C.green : C.border}`, borderRadius: 4,
                cursor: dirty ? "pointer" : "default",
              }}
            >
              {dirty ? "APPLY CONFIG" : "no changes"}
            </button>
            {status && (
              <div style={{ marginTop: 12, color: status.startsWith("!") ? "#ff6b6b" : C.green, fontSize: 11 }}>
                {status}
              </div>
            )}
            <div style={{ marginTop: 16, color: C.dim, fontSize: 10, lineHeight: 1.6 }}>
              # Anthropic = the claude -p backend (unchanged, subscription).<br />
              # OpenRouter = direct backend; pick any of the catalog models.<br />
              # Changes apply to the NEXT chat with this persona (no restart).
            </div>
          </>
        )}
      </div>
    </div>

    {/* ── HELPER / EXPLAIN config (the "explain this code" helper) ── */}
    <div style={{ borderTop: `1px solid ${C.border}`, padding: 16, overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
        <div style={{ color: C.amber, fontSize: 13, fontWeight: 700, letterSpacing: "0.08em" }}>
          HELPER / EXPLAIN
        </div>
        <button
          onClick={() => setHelperCfg((c) => ({ ...c, enabled: !c.enabled }))}
          style={{
            fontSize: 11, fontWeight: 700, padding: "6px 14px", borderRadius: 4,
            border: `1px solid ${helperCfg.enabled ? C.amber : C.border}`,
            background: helperCfg.enabled ? "rgba(255,174,66,0.12)" : "transparent",
            color: helperCfg.enabled ? C.amber : C.dim,
            cursor: "pointer", fontFamily: C.mono, letterSpacing: "0.06em", whiteSpace: "nowrap",
          }}
        >
          {helperCfg.enabled ? "[x] ENABLED" : "[ ] DISABLED"}
        </button>
      </div>
      <div style={{ color: C.dim, fontSize: 10, marginBottom: 14, lineHeight: 1.6 }}>
        # Controls the context-aware "explain this code" helper. Separate from per-persona config.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 560 }}>
        <CyberDropdown
          label="PROVIDER"
          fullWidth
          size="sm"
          accent={C.amber}
          value={helperCfg.provider}
          onChange={(v) => setHelperCfg((c) => ({ ...c, provider: v as "anthropic" | "openrouter" }))}
          options={[
            { id: "anthropic", label: "ANTHROPIC", desc: "claude -p one-shot" },
            { id: "openrouter", label: "OPENROUTER", desc: "model catalog" },
          ]}
        />

        <CyberDropdown
          label="MODEL"
          fullWidth
          size="sm"
          accent={C.amber}
          searchable={helperCfg.provider === "openrouter"}
          value={helperCfg.model}
          onChange={(v) => setHelperCfg((c) => ({ ...c, model: v }))}
          placeholder={helperCfg.provider === "openrouter" ? "openrouter model slug…" : "select model"}
          options={
            helperCfg.provider === "openrouter"
              ? orModels.map((m) => ({
                  id: m.id,
                  label: m.id,
                  desc: m.context_length ? Math.round(m.context_length / 1000) + "k ctx" : undefined,
                }))
              : ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8"].map((m) => ({ id: m, label: m }))
          }
        />

        <CyberDropdown
          label="CONTEXT DEPTH"
          fullWidth
          size="sm"
          accent={C.amber}
          value={String(helperCfg.contextDepth)}
          onChange={(v) => setHelperCfg((c) => ({ ...c, contextDepth: Number(v) }))}
          options={[
            { id: "0", label: "0", desc: "no chat context" },
            { id: "4", label: "4", desc: "last 4 messages" },
            { id: "6", label: "6", desc: "last 6 messages" },
            { id: "10", label: "10", desc: "last 10 messages" },
            { id: "20", label: "20", desc: "last 20 messages" },
          ]}
        />

        <CyberDropdown
          label="STYLE"
          fullWidth
          size="sm"
          accent={C.amber}
          value={helperCfg.style}
          onChange={(v) => setHelperCfg((c) => ({ ...c, style: v as "terse" | "teach" }))}
          options={[
            { id: "terse", label: "TERSE", desc: "concise" },
            { id: "teach", label: "TEACH", desc: "thorough why/how" },
          ]}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
          <button
            onClick={saveHelperCfg}
            disabled={helperSaving}
            style={{
              padding: "8px 18px", fontFamily: C.mono, fontSize: 13, fontWeight: 700,
              background: helperSaving ? "transparent" : "rgba(255,174,66,0.14)",
              color: C.amber, border: `1px solid ${C.amber}`, borderRadius: 4,
              cursor: helperSaving ? "wait" : "pointer", opacity: helperSaving ? 0.6 : 1,
              letterSpacing: "0.06em",
            }}
          >
            {helperSaving ? "SAVING…" : "SAVE HELPER CONFIG"}
          </button>
          {helperStatus && (
            <span style={{ fontSize: 11, fontWeight: 700, color: helperStatus.startsWith("!") ? "#ff6b6b" : C.green }}>
              {helperStatus}
            </span>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
