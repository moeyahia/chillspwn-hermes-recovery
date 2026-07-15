import { useState, useEffect } from "react";

type MemoryFile = "USER.md" | "MEMORY.md";

interface MemoryData {
  "USER.md": string;
  "MEMORY.md": string;
}

export default function MemoryPage() {
  const [data, setData] = useState<MemoryData>({ "USER.md": "", "MEMORY.md": "" });
  const [activeTab, setActiveTab] = useState<MemoryFile>("USER.md");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const TABS: MemoryFile[] = ["USER.md", "MEMORY.md"];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Validated Memory</h2>
            <p className="text-xs text-slate-500">
              Safe-read view shared across providers. Additions use the mediated memory CLI; whole-file editing is disabled.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={fetchMemory}
              disabled={loading}
              className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded transition-colors"
            >
              {loading ? "Refreshing..." : "Refresh"}
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
            value={data[activeTab]}
            readOnly
            spellCheck={false}
            className="w-full h-full bg-slate-900 text-slate-200 font-mono text-sm leading-relaxed rounded-lg border border-slate-700 focus:outline-none p-4 resize-none"
            placeholder={`No validated ${activeTab} entries.`}
          />
        )}
      </div>
    </div>
  );
}
