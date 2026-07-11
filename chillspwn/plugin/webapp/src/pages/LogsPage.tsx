import { useState, useEffect, useRef } from "react";

type LogType = "gateway.log" | "agent.log" | "errors.log" | "dashboard.log";

const LOG_TABS: { id: LogType; label: string }[] = [
  { id: "gateway.log", label: "Gateway" },
  { id: "agent.log", label: "Agent" },
  { id: "errors.log", label: "Errors" },
  { id: "dashboard.log", label: "Dashboard" },
];

export default function LogsPage() {
  const [activeLog, setActiveLog] = useState<LogType>("gateway.log");
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchLogs = (logType: LogType) => {
    setLoading(true);
    setError(null);
    fetch(`/api/logs/${logType}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setLines(data.lines || []);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLines([]);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchLogs(activeLog);
  }, [activeLog]);

  // Auto-scroll to bottom when lines change
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  const handleTabChange = (logType: LogType) => {
    setActiveLog(logType);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Logs</h2>
            <p className="text-xs text-slate-500">
              {lines.length} line{lines.length !== 1 ? "s" : ""}
            </p>
          </div>
          <button
            onClick={() => fetchLogs(activeLog)}
            className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition-colors"
          >
            Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-3">
          {LOG_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`px-3 py-1.5 text-xs rounded-t transition-colors ${
                activeLog === tab.id
                  ? "bg-slate-800 text-white border-t border-x border-slate-700"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              {tab.label}
              {tab.id === "errors.log" && activeLog !== "errors.log" && (
                <span className="ml-1 text-red-400">!</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Log content */}
      <div className="flex-1 overflow-hidden p-4">
        {loading && (
          <div className="flex items-center justify-center h-full text-slate-500">
            <span className="animate-pulse">Loading logs...</span>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-full text-red-400">
            <div className="text-center">
              <p className="text-sm">Failed to load log file</p>
              <p className="text-xs mt-1 text-slate-500">{error}</p>
            </div>
          </div>
        )}

        {!loading && !error && (
          <div
            ref={containerRef}
            className="h-full overflow-y-auto bg-slate-900 rounded-lg border border-slate-800 p-4 font-mono text-xs leading-relaxed"
          >
            {lines.length === 0 && (
              <p className="text-slate-600">Log file is empty</p>
            )}
            {lines.map((line, i) => (
              <div
                key={i}
                className={`whitespace-pre-wrap ${
                  line.toLowerCase().includes("error")
                    ? "text-red-400"
                    : line.toLowerCase().includes("warn")
                    ? "text-amber-400"
                    : "text-slate-400"
                } hover:bg-slate-800/50`}
              >
                <span className="text-slate-600 select-none mr-3 inline-block w-8 text-right">
                  {i + 1}
                </span>
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
