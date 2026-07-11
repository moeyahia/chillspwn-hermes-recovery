// ── SystemPage ──────────────────────────────────────────────────────
// Real-time system resource monitor — htop / Activity Monitor style.
//
// Shows:
//   • CPU (overall + per-core bars)
//   • Memory (used / available / cached / buffered)
//   • Swap
//   • Load average + uptime
//   • Thread + process counts
//   • Disk usage per mount (df)
//   • Top processes (sortable by CPU/MEM/PID)
//   • Network interfaces (RX/TX rates)
//
// Backend endpoints:
//   GET  /api/system/stats      — snapshot
//   GET  /api/system/processes  — top-N processes (?sort=cpu|mem|pid)
//   GET  /api/system/disk       — mount usage
//   GET  /api/system/network    — per-interface counters
//   GET  /api/system/stream     — SSE pushing combined snapshot every N seconds
//
// Live mode uses SSE for stats; processes/disk/network refresh on a polling
// timer that respects the same interval.

import { useState, useEffect, useRef } from "react";

// ── Types ──────────────────────────────────────────────────────────
interface SystemStats {
  hostname: string;
  platform: string;
  arch: string;
  kernel: string;
  uptime: number;
  loadAvg: number[];
  cpu: { cores: number; model: string; overallPercent: number; perCorePercent: number[] };
  memory: { total: number; used: number; free: number; available: number; buffers: number; cached: number; percent: number };
  swap: { total: number; used: number; free: number; percent: number };
  threads: number;
  processCount: number;
  timestamp: string;
}
interface Process {
  pid: number;
  user: string;
  cpuPercent: number;
  memPercent: number;
  rssKb: number;
  vszKb: number;
  threads: number;
  elapsed: string;
  state: string;
  command: string;
}
interface Mount {
  source: string;
  fstype: string;
  totalBytes: number;
  usedBytes: number;
  availBytes: number;
  percent: number;
  mount: string;
}
interface Iface {
  interface: string;
  rxBytes: number;
  rxPackets: number;
  rxErrs: number;
  txBytes: number;
  txPackets: number;
  txErrs: number;
}

// ── Helpers ────────────────────────────────────────────────────────
function humanBytes(n: number): string {
  if (n < 1024) return n + " B";
  if (n < 1024 ** 2) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 ** 3) return (n / 1024 ** 2).toFixed(1) + " MB";
  if (n < 1024 ** 4) return (n / 1024 ** 3).toFixed(2) + " GB";
  return (n / 1024 ** 4).toFixed(2) + " TB";
}
function humanUptime(s: number): string {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
// Color a bar from green → amber → red as percentage rises
function pctColor(p: number): string {
  if (p < 50) return "var(--neon-green)";
  if (p < 80) return "var(--neon-amber)";
  return "var(--neon-red)";
}

// ── Reusable atoms (dark theme variables, consistent with rest of app) ──
const cardStyle: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border-color)",
  borderRadius: 8,
  padding: 12,
  overflow: "hidden",
};
const labelStyle: React.CSSProperties = {
  fontSize: "0.6rem",
  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  letterSpacing: "0.1em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};
const numStyle: React.CSSProperties = {
  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  fontSize: "1.15rem",
  fontWeight: 600,
  color: "var(--neon-cyan)",
};

// Horizontal percentage bar with color gradient
function Bar({ percent, height = 8 }: { percent: number; height?: number }) {
  return (
    <div style={{
      width: "100%",
      height,
      background: "var(--bg-primary)",
      borderRadius: height / 2,
      border: "1px solid var(--border-color)",
      overflow: "hidden",
    }}>
      <div style={{
        width: `${Math.max(0, Math.min(100, percent))}%`,
        height: "100%",
        background: pctColor(percent),
        transition: "width 0.4s ease, background 0.4s ease",
        boxShadow: percent > 80 ? `0 0 8px ${pctColor(percent)}` : "none",
      }} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────
export default function SystemPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [processes, setProcesses] = useState<Process[]>([]);
  const [mounts, setMounts] = useState<Mount[]>([]);
  const [ifaces, setIfaces] = useState<Iface[]>([]);
  const [prevIfaces, setPrevIfaces] = useState<{ data: Iface[]; t: number } | null>(null);
  const [procSort, setProcSort] = useState<"cpu" | "mem" | "pid">("cpu");
  const [interval, setInterval] = useState(2000);
  const [live, setLive] = useState(true);
  const sseRef = useRef<EventSource | null>(null);
  const pollRef = useRef<number | null>(null);

  // Track if we're on a narrow screen so we can collapse the grid
  const [isNarrow, setIsNarrow] = useState(typeof window !== "undefined" ? window.innerWidth < 900 : false);
  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 900);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // ── Fetch helpers ─────────────────────────────────────────────
  const refreshStats = () => {
    fetch("/api/system/stats").then((r) => r.json()).then(setStats).catch(() => {});
  };
  const refreshProcesses = () => {
    fetch(`/api/system/processes?sort=${procSort}&limit=80`)
      .then((r) => r.json())
      .then((d) => setProcesses(d.processes || []))
      .catch(() => {});
  };
  const refreshDisk = () => {
    fetch("/api/system/disk").then((r) => r.json()).then((d) => setMounts(d.mounts || [])).catch(() => {});
  };
  const refreshNet = () => {
    fetch("/api/system/network").then((r) => r.json()).then((d) => {
      const next = d.interfaces || [];
      setPrevIfaces({ data: ifaces, t: Date.now() });
      setIfaces(next);
    }).catch(() => {});
  };

  // ── Initial load + when procSort changes ──────────────────────
  useEffect(() => { refreshStats(); refreshDisk(); refreshNet(); }, []);
  useEffect(() => { refreshProcesses(); }, [procSort]);

  // ── Live mode: SSE for stats + polling for everything else ────
  useEffect(() => {
    if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    if (!live) return;

    // Stats via SSE (matches server stream interval)
    const es = new EventSource(`/api/system/stream?interval=${interval}`);
    es.onmessage = (e) => {
      try {
        const snap = JSON.parse(e.data);
        // Merge SSE snapshot into stats (preserve static fields we don't get every tick)
        setStats((prev) => prev ? {
          ...prev,
          cpu: { ...prev.cpu, ...snap.cpu },
          memory: { ...prev.memory, ...snap.memory },
          swap: { ...prev.swap, ...snap.swap },
          loadAvg: snap.loadAvg,
          uptime: snap.uptime,
          threads: snap.threads,
          timestamp: snap.timestamp,
        } : prev);
      } catch {}
    };
    sseRef.current = es;

    // Processes, disk, network on the same interval as a polled refresh.
    // Skip while the tab/app is hidden — no point polling system stats nobody
    // is looking at (saves background network + re-render churn on mobile).
    pollRef.current = window.setInterval(() => {
      if (document.hidden) return;
      refreshProcesses();
      refreshNet();
    }, interval);

    // Disk polls less aggressively — mounts change rarely
    const diskTimer = window.setInterval(() => {
      if (document.hidden) return;
      refreshDisk();
    }, Math.max(interval, 5000) * 2);

    return () => {
      es.close();
      if (pollRef.current) window.clearInterval(pollRef.current);
      window.clearInterval(diskTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, interval, procSort]);

  // ── Compute network rates by diffing two snapshots ────────────
  const ifaceRates = (() => {
    if (!prevIfaces || prevIfaces.t === 0) return {} as Record<string, { rx: number; tx: number }>;
    const dt = (Date.now() - prevIfaces.t) / 1000;
    if (dt <= 0) return {};
    const map: Record<string, { rx: number; tx: number }> = {};
    for (const cur of ifaces) {
      const prev = prevIfaces.data.find((i) => i.interface === cur.interface);
      if (!prev) continue;
      map[cur.interface] = {
        rx: Math.max(0, (cur.rxBytes - prev.rxBytes) / dt),
        tx: Math.max(0, (cur.txBytes - prev.txBytes) / dt),
      };
    }
    return map;
  })();

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      background: "var(--bg-primary)",
      color: "var(--text-primary)",
      overflowY: "auto",
      minHeight: 0,
    }}>
      {/* Header strip */}
      <div style={{
        padding: "10px 16px",
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border-color)",
        display: "flex",
        gap: 16,
        alignItems: "center",
        flexWrap: "wrap",
        flexShrink: 0,
      }}>
        <div>
          <div style={{ ...labelStyle, color: "var(--neon-cyan)" }}>SYSTEM MONITOR</div>
          <div style={{ ...labelStyle, marginTop: 2 }}>
            {stats ? `${stats.hostname} · ${stats.platform}/${stats.arch} · kernel ${stats.kernel}` : "Loading…"}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {/* Interval picker */}
        <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-dim)" }}>
          <span style={labelStyle}>POLL</span>
          <select
            value={interval}
            onChange={(e) => setInterval(parseInt(e.target.value, 10))}
            style={{
              padding: "3px 6px",
              fontSize: "0.7rem",
              fontFamily: '"JetBrains Mono", "Fira Code", monospace',
              borderRadius: 4,
              border: "1px solid var(--border-color)",
              background: "var(--bg-primary)",
              color: "var(--text-primary)",
              cursor: "pointer",
            }}
          >
            <option value={500}>0.5s</option>
            <option value={1000}>1s</option>
            <option value={2000}>2s</option>
            <option value={5000}>5s</option>
            <option value={10000}>10s</option>
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", color: live ? "var(--neon-green)" : "var(--text-dim)" }}>
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} style={{ cursor: "pointer" }} />
          <span style={{ ...labelStyle, color: "inherit" }}>● LIVE</span>
        </label>
      </div>

      {/* Stats grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isNarrow ? "1fr" : "repeat(4, 1fr)",
        gap: 12,
        padding: 12,
        flexShrink: 0,
      }}>
        {/* CPU */}
        <div style={cardStyle}>
          <div style={labelStyle}>CPU OVERALL</div>
          <div style={{ ...numStyle, color: pctColor(stats?.cpu.overallPercent ?? 0), marginTop: 4 }}>
            {(stats?.cpu.overallPercent ?? 0).toFixed(1)}%
          </div>
          <div style={{ marginTop: 6 }}>
            <Bar percent={stats?.cpu.overallPercent ?? 0} height={10} />
          </div>
          <div style={{ ...labelStyle, marginTop: 6 }}>
            {stats?.cpu.cores ?? 0} cores · load {stats?.loadAvg.map((l) => l.toFixed(2)).join(" / ") || "0/0/0"}
          </div>
        </div>

        {/* Memory */}
        <div style={cardStyle}>
          <div style={labelStyle}>MEMORY</div>
          <div style={{ ...numStyle, color: pctColor(stats?.memory.percent ?? 0), marginTop: 4 }}>
            {(stats?.memory.percent ?? 0).toFixed(1)}%
          </div>
          <div style={{ marginTop: 6 }}>
            <Bar percent={stats?.memory.percent ?? 0} height={10} />
          </div>
          <div style={{ ...labelStyle, marginTop: 6 }}>
            {humanBytes(stats?.memory.used ?? 0)} / {humanBytes(stats?.memory.total ?? 0)}
          </div>
        </div>

        {/* Swap */}
        <div style={cardStyle}>
          <div style={labelStyle}>SWAP</div>
          <div style={{ ...numStyle, color: pctColor(stats?.swap.percent ?? 0), marginTop: 4 }}>
            {(stats?.swap.percent ?? 0).toFixed(1)}%
          </div>
          <div style={{ marginTop: 6 }}>
            <Bar percent={stats?.swap.percent ?? 0} height={10} />
          </div>
          <div style={{ ...labelStyle, marginTop: 6 }}>
            {humanBytes(stats?.swap.used ?? 0)} / {humanBytes(stats?.swap.total ?? 0)}
          </div>
        </div>

        {/* Uptime + threads */}
        <div style={cardStyle}>
          <div style={labelStyle}>UPTIME · THREADS · PROCESSES</div>
          <div style={{ ...numStyle, marginTop: 4 }}>
            {stats ? humanUptime(stats.uptime) : "—"}
          </div>
          <div style={{ ...labelStyle, marginTop: 6 }}>
            {stats?.threads ?? 0} threads · {stats?.processCount ?? 0} processes
          </div>
          <div style={{ ...labelStyle, marginTop: 3, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis" }} title={stats?.cpu.model || ""}>
            {stats?.cpu.model || "—"}
          </div>
        </div>
      </div>

      {/* Per-core CPU strip */}
      {stats && stats.cpu.perCorePercent.length > 0 && (
        <div style={{ padding: "0 12px 12px", flexShrink: 0 }}>
          <div style={cardStyle}>
            <div style={{ ...labelStyle, marginBottom: 8 }}>PER-CORE CPU</div>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(stats.cpu.perCorePercent.length, isNarrow ? 4 : 16)}, 1fr)`, gap: 6 }}>
              {stats.cpu.perCorePercent.map((p, i) => (
                <div key={i}>
                  <div style={{ ...labelStyle, marginBottom: 2 }}>
                    C{i} <span style={{ color: pctColor(p), float: "right" }}>{p.toFixed(0)}%</span>
                  </div>
                  <Bar percent={p} height={6} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Disk + network row */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isNarrow ? "1fr" : "1fr 1fr",
        gap: 12,
        padding: "0 12px 12px",
        flexShrink: 0,
      }}>
        {/* Disk usage */}
        <div style={cardStyle}>
          <div style={{ ...labelStyle, marginBottom: 8 }}>DISK USAGE · {mounts.length} mounts</div>
          <table style={{ width: "100%", fontSize: "0.72rem", fontFamily: '"JetBrains Mono", "Fira Code", monospace' }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                <th style={{ padding: "2px 4px" }}>MOUNT</th>
                <th style={{ padding: "2px 4px" }}>FS</th>
                <th style={{ padding: "2px 4px", textAlign: "right" }}>USED</th>
                <th style={{ padding: "2px 4px", textAlign: "right" }}>TOTAL</th>
                <th style={{ padding: "2px 4px", width: 140 }}>%</th>
              </tr>
            </thead>
            <tbody>
              {mounts.map((m) => (
                <tr key={m.mount} style={{ borderTop: "1px solid var(--border-color)" }}>
                  <td style={{ padding: "4px", color: "var(--neon-cyan)", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }} title={`${m.source} on ${m.mount}`}>
                    {m.mount}
                  </td>
                  <td style={{ padding: "4px", color: "var(--text-dim)" }}>{m.fstype}</td>
                  <td style={{ padding: "4px", textAlign: "right" }}>{humanBytes(m.usedBytes)}</td>
                  <td style={{ padding: "4px", textAlign: "right" }}>{humanBytes(m.totalBytes)}</td>
                  <td style={{ padding: "4px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{ flex: 1 }}>
                        <Bar percent={m.percent} height={6} />
                      </div>
                      <span style={{ color: pctColor(m.percent), width: 36, textAlign: "right" }}>
                        {m.percent.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Network */}
        <div style={cardStyle}>
          <div style={{ ...labelStyle, marginBottom: 8 }}>NETWORK · {ifaces.length} interfaces</div>
          <table style={{ width: "100%", fontSize: "0.72rem", fontFamily: '"JetBrains Mono", "Fira Code", monospace' }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                <th style={{ padding: "2px 4px" }}>IFACE</th>
                <th style={{ padding: "2px 4px", textAlign: "right" }}>RX/s</th>
                <th style={{ padding: "2px 4px", textAlign: "right" }}>TX/s</th>
                <th style={{ padding: "2px 4px", textAlign: "right" }}>RX TOTAL</th>
                <th style={{ padding: "2px 4px", textAlign: "right" }}>TX TOTAL</th>
                <th style={{ padding: "2px 4px", textAlign: "right" }}>ERR</th>
              </tr>
            </thead>
            <tbody>
              {ifaces.map((i) => {
                const r = ifaceRates[i.interface] || { rx: 0, tx: 0 };
                const err = i.rxErrs + i.txErrs;
                return (
                  <tr key={i.interface} style={{ borderTop: "1px solid var(--border-color)" }}>
                    <td style={{ padding: "4px", color: "var(--neon-cyan)" }}>{i.interface}</td>
                    <td style={{ padding: "4px", textAlign: "right", color: "var(--neon-green)" }}>{humanBytes(r.rx)}</td>
                    <td style={{ padding: "4px", textAlign: "right", color: "var(--neon-amber)" }}>{humanBytes(r.tx)}</td>
                    <td style={{ padding: "4px", textAlign: "right", color: "var(--text-dim)" }}>{humanBytes(i.rxBytes)}</td>
                    <td style={{ padding: "4px", textAlign: "right", color: "var(--text-dim)" }}>{humanBytes(i.txBytes)}</td>
                    <td style={{ padding: "4px", textAlign: "right", color: err > 0 ? "var(--neon-red)" : "var(--text-muted)" }}>{err}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Process list */}
      <div style={{ padding: "0 12px 12px", flex: 1, minHeight: 0 }}>
        <div style={{ ...cardStyle, padding: 0, height: "100%", display: "flex", flexDirection: "column", minHeight: 360 }}>
          <div style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexShrink: 0,
          }}>
            <div style={{ ...labelStyle }}>TOP PROCESSES · {processes.length}</div>
            <div style={{ display: "flex", gap: 4 }}>
              {(["cpu", "mem", "pid"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setProcSort(s)}
                  style={{
                    padding: "3px 8px",
                    fontSize: "0.65rem",
                    borderRadius: 4,
                    border: `1px solid ${procSort === s ? "var(--neon-cyan)" : "var(--border-color)"}`,
                    background: procSort === s ? "var(--jarvis-blue-faint)" : "transparent",
                    color: procSort === s ? "var(--neon-cyan)" : "var(--text-dim)",
                    cursor: "pointer",
                  }}
                >
                  {s.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            <table style={{ width: "100%", fontSize: "0.72rem", fontFamily: '"JetBrains Mono", "Fira Code", monospace', borderCollapse: "collapse" }}>
              <thead style={{ position: "sticky", top: 0, background: "var(--bg-surface)", zIndex: 1 }}>
                <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                  <th style={{ padding: "6px 8px" }}>PID</th>
                  <th style={{ padding: "6px 8px" }}>USER</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>%CPU</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>%MEM</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>RSS</th>
                  <th style={{ padding: "6px 8px", textAlign: "right" }}>THR</th>
                  <th style={{ padding: "6px 8px" }}>TIME</th>
                  <th style={{ padding: "6px 8px" }}>S</th>
                  <th style={{ padding: "6px 8px" }}>COMMAND</th>
                </tr>
              </thead>
              <tbody>
                {processes.map((p) => (
                  <tr key={p.pid} style={{ borderTop: "1px solid var(--border-color)" }}>
                    <td style={{ padding: "3px 8px", color: "var(--text-dim)" }}>{p.pid}</td>
                    <td style={{ padding: "3px 8px", color: "var(--text-dim)" }}>{p.user}</td>
                    <td style={{ padding: "3px 8px", textAlign: "right", color: pctColor(p.cpuPercent) }}>{p.cpuPercent.toFixed(1)}</td>
                    <td style={{ padding: "3px 8px", textAlign: "right", color: pctColor(p.memPercent) }}>{p.memPercent.toFixed(1)}</td>
                    <td style={{ padding: "3px 8px", textAlign: "right", color: "var(--neon-cyan)" }}>{humanBytes(p.rssKb * 1024)}</td>
                    <td style={{ padding: "3px 8px", textAlign: "right", color: "var(--text-dim)" }}>{p.threads}</td>
                    <td style={{ padding: "3px 8px", color: "var(--text-dim)" }}>{p.elapsed}</td>
                    <td style={{ padding: "3px 8px", color: p.state.startsWith("R") ? "var(--neon-green)" : "var(--text-muted)" }}>{p.state}</td>
                    <td style={{ padding: "3px 8px", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 400 }} title={p.command}>
                      {p.command}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
