import { useState, useEffect } from "react";

type MemoryFile = "USER.md" | "MEMORY.md";

interface MemoryData {
  "USER.md": string;
  "MEMORY.md": string;
}

export default function MemoryPage() {
  const [data, setData] = useState<MemoryData>({ "USER.md": "", "MEMORY.md": "" });
  const [drafts, setDrafts] = useState<MemoryData>({ "USER.md": "", "MEMORY.md": "" });
  const [activeTab, setActiveTab] = useState<MemoryFile>("USER.md");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const fetchMemory = () => {
    setLoading(true);
    setError(null);
    fetch("/api/memory")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: MemoryData) => {
        setData(d);
        setDrafts(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchMemory();
  }, []);

  const handleSave = (file: MemoryFile) => {
    setSaving(true);
    setSaveStatus(null);
    fetch(`/api/memory/${file}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: drafts[file] }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        setData((prev) => ({ ...prev, [file]: drafts[file] }));
        setSaveStatus("Saved");
        setTimeout(() => setSaveStatus(null), 2000);
      })
      .catch((e) => {
        setSaveStatus(`Error: ${e.message}`);
      })
      .finally(() => setSaving(false));
  };

  const isDirty = drafts[activeTab] !== data[activeTab];

  // Highlight section separators (lines that are just "---" or contain only special chars)
  const renderHighlighted = (text: string) => {
    return text.split("\n").map((line, i) => {
      const isSeparator = /^\s*[#\-=]{3,}\s*$/.test(line) || /^##?\s/.test(line);
      return (
        <span key={i}>
          {isSeparator ? (
            <span className="text-cyan-400 font-semibold">{line}</span>
          ) : (
            line
          )}
          {"\n"}
        </span>
      );
    });
  };

  const TABS: MemoryFile[] = ["USER.md", "MEMORY.md"];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Memory Files</h2>
            <p className="text-xs text-slate-500">
              Shared with Hermes -- edits here propagate to all personas
            </p>
          </div>
          <div className="flex items-center gap-2">
            {saveStatus && (
              <span
                className={`text-xs ${
                  saveStatus === "Saved" ? "text-green-400" : "text-red-400"
                }`}
              >
                {saveStatus}
              </span>
            )}
            <button
              onClick={() => handleSave(activeTab)}
              disabled={!isDirty || saving}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded transition-colors"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-3">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-xs rounded-t transition-colors ${
                activeTab === tab
                  ? "bg-slate-800 text-white border-t border-x border-slate-700"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              {tab}
              {drafts[tab] !== data[tab] && (
                <span className="ml-1 text-amber-400">*</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden p-4">
        {loading && (
          <div className="flex items-center justify-center h-full text-slate-500">
            <span className="animate-pulse">Loading memory files...</span>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-full text-red-400">
            <div className="text-center">
              <p className="text-sm">Failed to load memory</p>
              <p className="text-xs mt-1 text-slate-500">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && (
          <textarea
            value={drafts[activeTab]}
            onChange={(e) =>
              setDrafts((prev) => ({ ...prev, [activeTab]: e.target.value }))
            }
            spellCheck={false}
            className="w-full h-full bg-slate-900 text-slate-200 font-mono text-sm leading-relaxed rounded-lg border border-slate-700 focus:border-blue-500 focus:outline-none p-4 resize-none"
            placeholder={`${activeTab} content...`}
          />
        )}
      </div>
    </div>
  );
}
