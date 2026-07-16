import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import GridSignal from "./components/GridSignal";
import { resolveSessionHistoryState } from "./lib/sessionHistoryState";

// Pages are code-split (React.lazy) so the initial mobile bundle stays small:
// only the app shell loads up front, then the active page's chunk streams in.
// This is the #1 mobile-perf fix — a 792KB monolith was parsed before first paint.
const ChatPage = lazy(() => import("./pages/ChatPage"));
const KanbanPage = lazy(() => import("./pages/KanbanPage"));
const MemoryPage = lazy(() => import("./pages/MemoryPage"));
const SkillsPage = lazy(() => import("./pages/SkillsPage"));
const CronPage = lazy(() => import("./pages/CronPage"));
const LogsPage = lazy(() => import("./pages/LogsPage"));
const ApiLogsPage = lazy(() => import("./pages/ApiLogsPage"));
const SystemPage = lazy(() => import("./pages/SystemPage"));
const DelegationPage = lazy(() => import("./pages/DelegationPage"));
const PersonasPage = lazy(() => import("./pages/PersonasPage"));
const ProjectFilesPage = lazy(() => import("./pages/ProjectFilesPage"));
const EngagementsPage = lazy(() => import("./pages/EngagementsPage"));
const CliSessionsPage = lazy(() => import("./pages/CliSessionsPage"));
const TerminalPage = lazy(() => import("./pages/TerminalPage"));
const ReportsPage = lazy(() => import("./pages/ReportsPage"));
const OsintPage = lazy(() => import("./pages/OsintPage"));
const CouncilPage = lazy(() => import("./pages/CouncilPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const LlmLogsPage = lazy(() => import("./pages/LlmLogsPage"));
const AgentCockpitPage = lazy(() => import("./pages/AgentCockpitPage"));
const MissionBoardPage = lazy(() => import("./pages/MissionBoardPage")); // Phase 16.1 — specialist lanes

// Lightweight fallback shown while a lazy page chunk streams in. Pure CSS, no
// heavy deps — paints instantly so the user never sees a blank/frozen panel.
function PageLoading() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%",
        color: "#2bd47f",
        fontFamily: "monospace",
        fontSize: 12,
        letterSpacing: "0.18em",
        opacity: 0.65,
      }}
    >
      ◢◤ loading ◥◣
    </div>
  );
}

// ── Types ──────────────────────────────────────────────

interface Persona {
  name: string;
  description: string;
  color: string;
  icon: string;
  model: string;
  provider?: "anthropic" | "openrouter" | "openai-codex" | "gemini" | "xai-grok";
  permissionMode: string;
}

interface WindowSize {
  width: number;
  height: number;
}

interface WindowPosition {
  x: number;
  y: number;
}

interface WindowState {
  id: string;
  title: string;
  icon: string;
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  position: WindowPosition;
  size: WindowSize;
  defaultSize: WindowSize;
  zIndex: number;
  preMaximizePosition?: WindowPosition;
  preMaximizeSize?: WindowSize;
}

interface AppDef {
  id: string;
  title: string;
  icon: string;
  defaultSize: WindowSize;
}

// ── App Definitions ────────────────────────────────────

const APPS: AppDef[] = [
  { id: "chat", title: "COMMS", icon: "⬡", defaultSize: { width: 700, height: 500 } },
  { id: "cockpit", title: "AGENT COCKPIT", icon: "❖", defaultSize: { width: 1100, height: 700 } },
  { id: "missionboard", title: "MISSION BOARD", icon: "◈", defaultSize: { width: 1280, height: 640 } }, // Phase 16.1 specialist lanes
  { id: "kanban", title: "KANBAN (LEGACY)", icon: "▤", defaultSize: { width: 800, height: 500 } },
  { id: "memory", title: "NEURAL CORE", icon: "◉", defaultSize: { width: 600, height: 500 } },
  { id: "skills", title: "ARSENAL", icon: "⎔", defaultSize: { width: 750, height: 500 } },
  { id: "cron", title: "SCHEDULER", icon: "◎", defaultSize: { width: 600, height: 400 } },
  { id: "delegation", title: "DISPATCH", icon: "⬢", defaultSize: { width: 650, height: 500 } },
  { id: "personas", title: "IDENTITIES", icon: "◇", defaultSize: { width: 800, height: 500 } },
  { id: "settings", title: "CONFIG", icon: "⚙", defaultSize: { width: 820, height: 560 } },
  { id: "llm-logs", title: "LLM LOGS", icon: "❡", defaultSize: { width: 1000, height: 640 } },
  { id: "logs", title: "SYS LOG", icon: "▣", defaultSize: { width: 700, height: 400 } },
  { id: "api-logs", title: "API MONITOR", icon: "⟁", defaultSize: { width: 1280, height: 720 } },
  { id: "system", title: "SYSTEM", icon: "▦", defaultSize: { width: 1200, height: 720 } },
  { id: "files", title: "PROJECT FILES", icon: "◫", defaultSize: { width: 850, height: 550 } },
  { id: "engagements", title: "ENGAGEMENTS", icon: "⬡", defaultSize: { width: 900, height: 600 } },
  { id: "cli-sessions", title: "CLI SESSIONS", icon: "⊞", defaultSize: { width: 850, height: 550 } },
  { id: "terminal", title: "TERMINAL", icon: "▪", defaultSize: { width: 800, height: 500 } },
  { id: "reports", title: "REPORTS", icon: "⊟", defaultSize: { width: 950, height: 620 } },
  { id: "osint", title: "OSINT", icon: "⌖", defaultSize: { width: 950, height: 640 } },
  { id: "council", title: "COUNCIL", icon: "⚖", defaultSize: { width: 1100, height: 680 } },
];

// ── Navigation IA — the confirmed user journey (Operate / Agents / Intel / Config / Logs).
// Drives the grouped "More" sheet (mobile/iPad/Fold) and the desktop launcher sections.
const NAV_GROUPS: { title: string; ids: string[] }[] = [
  { title: "OPERATE",       ids: ["chat", "cockpit", "missionboard", "council", "terminal", "engagements"] },
  { title: "AGENTS",        ids: ["personas", "skills", "memory", "delegation", "kanban"] },
  { title: "INTEL",         ids: ["osint", "reports", "files", "cli-sessions"] },
  { title: "CONFIGURATION", ids: ["settings", "cron", "system"] },
  { title: "LOGS",          ids: ["llm-logs", "api-logs", "logs"] },
];

// ── Sessions in the nav (list + rename + delete) ──────────
type NavSession = {
  id: string; persona: string; preview: string; title: string;
  status: string; isLive: boolean; turnActive: boolean; messageCount: number;
  displayName?: string; kind?: string;   // Phase 19 — structured name + specialist/chat
};

// Conversation list rendered UNDER the app navigation (rail on tablet/Fold, drawer on phone).
// Each row opens in COMMS; pencil renames inline, trash deletes with a tiny confirm.
function SessionNavList({ sessions, activeId, onOpen, onNew, onRename, onDelete, showClosed, onToggleClosed }: {
  sessions: NavSession[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  showClosed?: boolean;
  onToggleClosed?: (v: boolean) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  return (
    <div>
      <div className="poc-railsec" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>SESSIONS</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {onToggleClosed && (
            <button
              className="poc-sess-new"
              style={{ opacity: showClosed ? 1 : 0.55 }}
              onClick={() => onToggleClosed(!showClosed)}
              title={showClosed ? "Hide completed specialist sessions" : "Show completed/archived sessions"}
            >{showClosed ? "✓ closed" : "closed"}</button>
          )}
          <button className="poc-sess-new" onClick={onNew} title="New chat">+ New</button>
        </span>
      </div>
      {sessions.length === 0 && <div className="poc-sess-empty">No sessions yet</div>}
      {sessions.map((s) => {
        const label = (s.title || "").trim() || (s.displayName || "").trim() || s.preview || s.persona || "session";
        const isActive = s.id === activeId;
        const runtimeLabel = s.turnActive ? "working" : s.isLive ? "ready" : "";
        if (editing === s.id) {
          const commit = () => { onRename(s.id, draft.trim()); setEditing(null); };
          return (
            <div key={s.id} className="poc-sess editing">
              <input
                autoFocus className="poc-sess-input" value={draft}
                placeholder="Session name"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(null); }}
                onBlur={commit}
              />
              <button className="poc-sess-act" title="Save" onMouseDown={(e) => e.preventDefault()} onClick={commit}>✓</button>
            </div>
          );
        }
        return (
          <div key={s.id} className={`poc-sess ${isActive ? "on" : ""}`}>
            <span className="poc-sess-main" onClick={() => onOpen(s.id)}>
              <span
                className={`poc-sess-dot ${s.turnActive ? "active" : s.isLive ? "ready" : ""}`}
                title={s.turnActive ? "Turn in progress" : s.isLive ? "Session process ready" : "Session stopped"}
              />
              <span className="poc-sess-label" title={label}>{label}</span>
              {runtimeLabel && (
                <span className={`poc-sess-state ${s.turnActive ? "active" : "ready"}`}>
                  {runtimeLabel}
                </span>
              )}
            </span>
            {confirmDel === s.id ? (
              <span className="poc-sess-confirm">
                <button className="poc-sess-act del" onClick={() => { onDelete(s.id); setConfirmDel(null); }}>del</button>
                <button className="poc-sess-act" onClick={() => setConfirmDel(null)}>keep</button>
              </span>
            ) : (
              <>
                <button className="poc-sess-act" title="Rename"
                  onClick={() => { setEditing(s.id); setDraft((s.title || "").trim()); }}>✎</button>
                <button className="poc-sess-act del" title="Delete" onClick={() => setConfirmDel(s.id)}>🗑</button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────

function cascadePosition(index: number): WindowPosition {
  const base = 80;
  const offset = index * 30;
  return { x: base + offset, y: base + offset };
}

// ── Desktop Icon ───────────────────────────────────────

function DesktopIcon({
  app,
  onOpen,
}: {
  app: AppDef;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      className="hud-icon-tile"
      onDoubleClick={() => onOpen(app.id)}
      onClick={() => onOpen(app.id)}
      title={app.title}
    >
      <span className="hud-icon-tile-icon">{app.icon}</span>
      <span className="hud-icon-tile-label">{app.title}</span>
    </button>
  );
}

// ── Window Component ───────────────────────────────────

function HudWindow({
  win,
  onFocus,
  onClose,
  onMinimize,
  onMaximize,
  onDragStart,
  onResizeStart,
  children,
}: {
  win: WindowState;
  onFocus: () => void;
  onClose: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  if (!win.isOpen) return null;

  const style: React.CSSProperties = win.isMinimized
    ? {
        position: "absolute",
        top: -9999,
        left: -9999,
        width: win.size.width,
        height: win.size.height,
        zIndex: -1,
        visibility: "hidden" as const,
        pointerEvents: "none" as const,
      }
    : win.isMaximized
    ? {
        position: "absolute",
        top: 20,
        left: 20,
        right: 20,
        bottom: 52,
        width: "auto",
        height: "auto",
        zIndex: win.zIndex,
      }
    : {
        position: "absolute",
        top: win.position.y,
        left: win.position.x,
        width: win.size.width,
        height: win.size.height,
        zIndex: win.zIndex,
      };

  return (
    <div
      className="hud-window"
      style={style}
      onMouseDown={onFocus}
    >
      {/* Title bar */}
      <div className="hud-titlebar" onMouseDown={onDragStart}>
        <div className="hud-titlebar-left">
          <span className="hud-titlebar-icon">{win.icon}</span>
          <span className="hud-titlebar-title">{win.title}</span>
        </div>
        <div className="hud-titlebar-controls">
          <button
            className="hud-ctrl-btn hud-ctrl-minimize"
            onClick={(e) => { e.stopPropagation(); onMinimize(); }}
            title="Minimize"
          >
            &#x2500;
          </button>
          <button
            className="hud-ctrl-btn hud-ctrl-maximize"
            onClick={(e) => { e.stopPropagation(); onMaximize(); }}
            title="Maximize"
          >
            {win.isMaximized ? "⧉" : "□"}
          </button>
          <button
            className="hud-ctrl-btn hud-ctrl-close"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            title="Close"
          >
            ✕
          </button>
        </div>
      </div>
      {/* Body */}
      <div className="hud-window-body">
        {children}
      </div>
      {/* Resize handle */}
      {!win.isMaximized && (
        <div className="hud-resize-handle" onMouseDown={onResizeStart} />
      )}
    </div>
  );
}

// ── Taskbar ────────────────────────────────────────────

function Taskbar({
  windows,
  currentPersona,
  permissionMode,
  onTaskbarClick,
  hasLiveSession,
}: {
  windows: WindowState[];
  currentPersona: Persona | undefined;
  permissionMode: string;
  onTaskbarClick: (id: string) => void;
  hasLiveSession: boolean;
}) {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const openWindows = windows.filter((w) => w.isOpen);

  const timeStr = time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const dateStr = time.toLocaleDateString([], { month: "short", day: "numeric" });

  return (
    <div className="hud-taskbar">
      {/* Left: logo + status */}
      <div className="hud-taskbar-left">
        <img src="/smallLogo.png" alt="ChillsPwn" className="hud-taskbar-logo-img" style={{ width: 22, height: 22, borderRadius: 4 }} />
        <span className="hud-taskbar-brand">ChillsPwn</span>
        <span
          className={`hud-taskbar-status-dot ${hasLiveSession ? "" : "hud-taskbar-status-dot-offline"}`}
          style={{ backgroundColor: hasLiveSession ? "#2bd47f" : "#ff4d63" }}
          title={hasLiveSession ? "Session active" : "No active session"}
        />
      </div>

      {/* Center: open window tabs */}
      <div className="hud-taskbar-center">
        {openWindows.map((w) => (
          <button
            key={w.id}
            className={`hud-taskbar-tab ${w.isMinimized ? "hud-taskbar-tab-minimized" : "hud-taskbar-tab-active"}`}
            onClick={() => onTaskbarClick(w.id)}
            title={w.title}
          >
            <span className="hud-taskbar-tab-icon">{w.icon}</span>
            <span className="hud-taskbar-tab-label">{w.title}</span>
          </button>
        ))}
      </div>

      {/* Right: persona + model + time */}
      <div className="hud-taskbar-right">
        <span className="hud-taskbar-persona">{currentPersona?.name || "---"}</span>
        <span className="hud-taskbar-divider">|</span>
        <span className="hud-taskbar-model">{currentPersona?.model || "opus"}</span>
        <span className="hud-taskbar-divider">|</span>
        <span className="hud-taskbar-mode">{permissionMode}</span>
        <span className="hud-taskbar-divider">|</span>
        <span className="hud-taskbar-time">{timeStr}</span>
        <span className="hud-taskbar-date">{dateStr}</span>
      </div>
    </div>
  );
}

// ── Persona Panel (top-right) ──────────────────────────

function PersonaPanel({
  personas,
  activePersona,
  permissionMode,
  onPersonaChange,
  onModeChange,
}: {
  personas: Persona[];
  activePersona: string;
  permissionMode: string;
  onPersonaChange: (name: string) => void;
  onModeChange: (mode: string) => void;
}) {
  return (
    <div className="hud-persona-panel">
      <div className="hud-persona-panel-header">
        <img src="/smallLogo.png" alt="" style={{ width: 18, height: 18, borderRadius: 3, opacity: 0.8 }} />
        <span>IDENTITY</span>
      </div>
      <div className="hud-persona-panel-body">
        <label className="hud-persona-label">Persona</label>
        <select
          value={activePersona}
          onChange={(e) => onPersonaChange(e.target.value)}
          className="hud-persona-select"
        >
          {personas.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="hud-persona-label" style={{ marginTop: 6 }}>Mode</label>
        <select
          value={permissionMode}
          onChange={(e) => onModeChange(e.target.value)}
          className="hud-persona-select"
        >
          <option value="default">Default (ask)</option>
          <option value="auto">Auto</option>
          <option value="plan">Plan</option>
          <option value="bypassPermissions">YOLO</option>
        </select>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────

// ── Mobile detection ──────────────────────────────────
function isMobileViewport() {
  // Touch tablets — including iPad, which iPadOS reports at desktop width (esp. in
  // landscape) — should use the touch-friendly mobile layout, NOT the mouse-only
  // desktop window-manager (which doesn't touch-scroll). Narrow desktop windows
  // (<900) also use mobile.
  const touch = (navigator.maxTouchPoints || 0) > 1 || "ontouchstart" in window;
  return window.innerWidth < 900 || (touch && window.innerWidth < 1400);
}
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(isMobileViewport);
  useEffect(() => {
    const handler = () => setIsMobile(isMobileViewport());
    window.addEventListener("resize", handler);
    window.addEventListener("orientationchange", handler);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("orientationchange", handler);
    };
  }, []);
  return isMobile;
}

export default function LegacyDesktop() {
  const isMobile = useIsMobile();

  // Auto-update: if the server is serving a NEWER build than the one running (compares the baked
  // __BUILD_ID__ to /api/build-id), reload once to pick it up. Fixes iOS home-screen PWAs that
  // keep launching a stale bundle. Checks on mount + whenever the app is re-foregrounded.
  useEffect(() => {
    let cancelled = false;
    const myId = (typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "") as string;
    const check = async () => {
      try {
        const j = await (await fetch("/api/build-id", { cache: "no-store" })).json();
        const serverId = String(j?.id || "");
        if (cancelled || !myId || !serverId || serverId === "unknown" || serverId === myId) return;
        // only auto-reload ONCE per distinct server build → no reload loop if it can't update
        if (sessionStorage.getItem("cpwn_reloaded_for") === serverId) return;
        sessionStorage.setItem("cpwn_reloaded_for", serverId);
        location.reload();
      } catch {}
    };
    check();
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onVis); };
  }, []);

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [activePersona, setActivePersona] = useState<string>("ChillsPwn");
  const [permissionMode, setPermissionMode] = useState<string>("auto");
  const [zCounter, setZCounter] = useState(100);
  const [mobileTab, setMobileTab] = useState<string>("chat");
  const [hasLiveSession, setHasLiveSession] = useState(false);
  const [resumeCliSession, setResumeCliSession] = useState<{ id: string; title: string } | null>(null);

  // ── Sessions in the nav ──
  // The session list lives in the navigation now (not inside the chat). App owns the list via
  // REST and commands ChatPage through monotonic nonces; ChatPage reports its active id back.
  const [navSessions, setNavSessions] = useState<NavSession[]>([]);
  const [showClosed, setShowClosed] = useState(false);   // Phase 19 — show terminal specialist sessions
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  // LLM LOGS can hide the app navigation rail for more log width (auto-restored on leaving the page).
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [requestedSession, setRequestedSession] = useState<{ id: string; nonce: number } | null>(null);
  // A boolean (not a nonce): the "start fresh" intent must survive a ChatPage remount when "+ New"
  // is pressed from another tab. ChatPage flips it back via onNewSessionConsumed once handled.
  const [pendingNewSession, setPendingNewSession] = useState(false);
  const navNonceRef = useRef(0);

  const refreshSessions = useCallback(() => {
    fetch("/api/sessions" + (showClosed ? "?includeClosed=true" : "")).then((r) => r.json()).then((d) => {
      if (!Array.isArray(d)) return;
      const normalized = d.map((session: NavSession) => ({
        ...session,
        ...resolveSessionHistoryState(session),
      }));
      setNavSessions(normalized);
      setHasLiveSession(normalized.some((session: NavSession) => session.isLive));
    }).catch(() => {});
  }, [showClosed]);

  const handleActiveSessionChange = useCallback((id: string | null) => setActiveChatId(id), []);

  const openChatSession = useCallback((id: string) => {
    navNonceRef.current += 1;
    setPendingNewSession(false);   // opening a specific session overrides any pending "+ New"
    setRequestedSession({ id, nonce: navNonceRef.current });
    setMobileTab("chat");
  }, []);

  const newChatSession = useCallback(() => {
    setPendingNewSession(true);
    setRequestedSession(null);   // drop any stale open-this-session request
    setMobileTab("chat");
  }, []);

  const renameChatSession = useCallback((id: string, title: string) => {
    fetch(`/api/session/${encodeURIComponent(id)}/rename`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).then(() => refreshSessions()).catch(() => {});
  }, [refreshSessions]);

  const deleteChatSession = useCallback((id: string) => {
    fetch(`/api/session/${encodeURIComponent(id)}`, { method: "DELETE" })
      .then(() => { refreshSessions(); if (id === activeChatId) setPendingNewSession(true); })
      .catch(() => {});
  }, [refreshSessions, activeChatId]);

  // Load the list on mount + on tab focus; poll while a session is live so the dot stays fresh.
  useEffect(() => {
    refreshSessions();
    const onVis = () => { if (document.visibilityState === "visible") refreshSessions(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refreshSessions]);
  useEffect(() => {
    if (!hasLiveSession) return;
    const t = setInterval(refreshSessions, 5000);
    return () => clearInterval(t);
  }, [hasLiveSession, refreshSessions]);
  // Restore the nav when navigating away from LLM LOGS (the hide is scoped to that page).
  useEffect(() => {
    if (mobileTab !== "llm-logs" && navCollapsed) setNavCollapsed(false);
  }, [mobileTab, navCollapsed]);

  // Initialize window states
  const [windows, setWindows] = useState<WindowState[]>(() =>
    APPS.map((app, i) => ({
      id: app.id,
      title: app.title,
      icon: app.icon,
      isOpen: false,
      isMinimized: false,
      isMaximized: false,
      position: cascadePosition(i),
      size: { ...app.defaultSize },
      defaultSize: { ...app.defaultSize },
      zIndex: 10 + i,
    }))
  );

  // Drag state
  const dragRef = useRef<{
    windowId: string;
    startX: number;
    startY: number;
    startPosX: number;
    startPosY: number;
  } | null>(null);

  // Resize state
  const resizeRef = useRef<{
    windowId: string;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  // Fetch personas
  useEffect(() => {
    fetch("/api/personas")
      .then((r) => r.json())
      .then((data) => {
        setPersonas(data);
        if (data.length > 0 && !data.find((p: Persona) => p.name === activePersona)) {
          setActivePersona(data[0].name);
        }
      })
      .catch(() => {});
  }, []);

  const currentPersona = personas.find((p) => p.name === activePersona);

  // ── Window operations ──

  const bringToFront = useCallback(
    (id: string) => {
      setZCounter((prev) => {
        const next = prev + 1;
        setWindows((ws) =>
          ws.map((w) => (w.id === id ? { ...w, zIndex: next } : w))
        );
        return next;
      });
    },
    []
  );

  const openWindow = useCallback(
    (id: string) => {
      setWindows((ws) =>
        ws.map((w) => {
          if (w.id !== id) return w;
          if (w.isOpen && !w.isMinimized) {
            // Already open and visible: just focus
            return w;
          }
          return { ...w, isOpen: true, isMinimized: false };
        })
      );
      bringToFront(id);
    },
    [bringToFront]
  );

  // ── Deep-link via URL hash ──
  // Lets external pages return the user to a specific window/tab.
  // Used by the "Back to ChillsPwn" button injected into /view report pages:
  // navigating to "/#reports" lands here, we read the hash, and open that window
  // (or switch the mobile tab) so the user ends up where they expected — the
  // Reports view — instead of the default chat/comms view.
  // Why a hash and not a query/route: this app has no router; windows are pure
  // state. A hash is the cheapest deep-link primitive that survives a full page
  // load and doesn't require any routing infrastructure.
  useEffect(() => {
    // Open the window matching the current URL hash, if any. Safe to call
    // before windows exist — APPS is the source of truth for valid ids.
    const applyHash = () => {
      // window.location.hash includes the leading "#" — strip it.
      const target = window.location.hash.replace(/^#/, "").trim().toLowerCase();
      if (!target) return;
      // Only act if it matches a real app id; ignore anything else (#section anchors, etc.)
      if (!APPS.some((a) => a.id === target)) return;
      // Desktop: open + focus the window. Mobile: switch the active mobile tab.
      // Calling both is harmless since each branch no-ops in the wrong layout.
      openWindow(target);
      setMobileTab(target);
      // Clear the hash so a refresh doesn't keep forcing the same window open.
      // Use history.replaceState so we don't push a new entry to back-history.
      try { history.replaceState(null, "", window.location.pathname + window.location.search); } catch {}
    };
    // Run once on mount (covers the "Back to ChillsPwn" landing case).
    applyHash();
    // Also respond to in-app hash changes (e.g., if any other UI ever links via #id).
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [openWindow]);

  const closeWindow = useCallback((id: string) => {
    setWindows((ws) =>
      ws.map((w) =>
        w.id === id
          ? { ...w, isOpen: false, isMinimized: false, isMaximized: false }
          : w
      )
    );
  }, []);

  const minimizeWindow = useCallback((id: string) => {
    setWindows((ws) =>
      ws.map((w) => (w.id === id ? { ...w, isMinimized: true } : w))
    );
  }, []);

  const maximizeWindow = useCallback((id: string) => {
    setWindows((ws) =>
      ws.map((w) => {
        if (w.id !== id) return w;
        if (w.isMaximized) {
          // Restore
          return {
            ...w,
            isMaximized: false,
            position: w.preMaximizePosition || w.position,
            size: w.preMaximizeSize || w.defaultSize,
          };
        }
        // Maximize
        return {
          ...w,
          isMaximized: true,
          preMaximizePosition: { ...w.position },
          preMaximizeSize: { ...w.size },
        };
      })
    );
  }, []);

  const taskbarClick = useCallback(
    (id: string) => {
      setWindows((ws) => {
        const w = ws.find((w) => w.id === id);
        if (!w) return ws;
        if (w.isMinimized) {
          // Restore from minimize
          return ws.map((w) =>
            w.id === id ? { ...w, isMinimized: false } : w
          );
        }
        // Minimize if it was focused (top z)
        const maxZ = Math.max(...ws.filter((w) => w.isOpen && !w.isMinimized).map((w) => w.zIndex));
        if (w.zIndex === maxZ) {
          return ws.map((w) =>
            w.id === id ? { ...w, isMinimized: true } : w
          );
        }
        return ws;
      });
      bringToFront(id);
    },
    [bringToFront]
  );

  // ── Drag handling ──

  const handleDragStart = useCallback(
    (windowId: string, e: React.MouseEvent) => {
      // Don't start drag on control buttons
      if ((e.target as HTMLElement).closest(".hud-ctrl-btn")) return;
      e.preventDefault();
      const win = windows.find((w) => w.id === windowId);
      if (!win || win.isMaximized) return;
      dragRef.current = {
        windowId,
        startX: e.clientX,
        startY: e.clientY,
        startPosX: win.position.x,
        startPosY: win.position.y,
      };
      bringToFront(windowId);
    },
    [windows, bringToFront]
  );

  const handleResizeStart = useCallback(
    (windowId: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const win = windows.find((w) => w.id === windowId);
      if (!win || win.isMaximized) return;
      resizeRef.current = {
        windowId,
        startX: e.clientX,
        startY: e.clientY,
        startW: win.size.width,
        startH: win.size.height,
      };
      bringToFront(windowId);
    },
    [windows, bringToFront]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const { windowId, startX, startY, startPosX, startPosY } = dragRef.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        setWindows((ws) =>
          ws.map((w) =>
            w.id === windowId
              ? {
                  ...w,
                  position: {
                    x: Math.max(0, startPosX + dx),
                    y: Math.max(0, startPosY + dy),
                  },
                }
              : w
          )
        );
      }
      if (resizeRef.current) {
        const { windowId, startX, startY, startW, startH } = resizeRef.current;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        setWindows((ws) =>
          ws.map((w) =>
            w.id === windowId
              ? {
                  ...w,
                  size: {
                    width: Math.max(320, startW + dx),
                    height: Math.max(200, startH + dy),
                  },
                }
              : w
          )
        );
      }
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      resizeRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  // ── Persona handlers ──

  const handlePersonaChange = useCallback(
    (name: string) => {
      setActivePersona(name);
      const p = personas.find((p) => p.name === name);
      if (p) setPermissionMode(p.permissionMode);
    },
    [personas]
  );

  // Navigate to chat — works in both desktop (openWindow) and mobile (setMobileTab)
  const navigateToChat = useCallback(() => {
    setMobileTab("chat");
    openWindow("chat");
  }, [openWindow]);

  // Phase 16.1 — Mission Board card "→ Cockpit" links: switch to the Agent Cockpit view.
  useEffect(() => {
    const onOpenCockpit = () => { setMobileTab("cockpit"); openWindow("cockpit"); };
    window.addEventListener("cs-open-cockpit", onOpenCockpit as EventListener);
    return () => window.removeEventListener("cs-open-cockpit", onOpenCockpit as EventListener);
  }, [openWindow]);

  // ── Render page content inside window ──

  const renderWindowContent = (id: string) => {
    const content = (() => {
      switch (id) {
      case "chat":
        return <ChatPage
          persona={activePersona}
          personaProvider={currentPersona?.provider}
          personaModel={currentPersona?.model}
          permissionMode={permissionMode}
          onLiveSessionChange={(live) => { setHasLiveSession(live); refreshSessions(); }}
          resumeCliSession={resumeCliSession}
          onResumeConsumed={() => setResumeCliSession(null)}
          requestedSession={requestedSession}
          pendingNewSession={pendingNewSession}
          onNewSessionConsumed={() => setPendingNewSession(false)}
          onActiveSessionChange={handleActiveSessionChange}
        />;
      case "kanban":
        return <KanbanPage />;
      case "missionboard":
        return <MissionBoardPage />;
      case "cockpit":
        return <AgentCockpitPage />;
      case "memory":
        return <MemoryPage />;
      case "skills":
        return <SkillsPage />;
      case "cron":
        return <CronPage />;
      case "delegation":
        return <DelegationPage />;
      case "personas":
        return <PersonasPage />;
      case "logs":
        return <LogsPage />;
      case "api-logs":
        return <ApiLogsPage />;
      case "system":
        return <SystemPage />;
      case "files":
        return <ProjectFilesPage />;
      case "engagements":
        return <EngagementsPage />;
      case "cli-sessions":
        return <CliSessionsPage onResumeSession={(cliSessionId, title) => {
          // Set the resume state — passed as prop to ChatPage. Also keep window props
          // so the existing sendMessage logic that reads them on first send still works.
          (window as any).__resumeCliSessionId = cliSessionId;
          (window as any).__resumeCliTitle = title;
          setResumeCliSession({ id: cliSessionId, title });
          navigateToChat();
        }} />;
      case "terminal":
        return <TerminalPage />;
      case "reports":
        return <ReportsPage />;
      case "osint":
        return <OsintPage />;
      case "council":
        return <CouncilPage />;
      case "settings":
        return <SettingsPage />;
      case "llm-logs":
        return <LlmLogsPage navCollapsed={navCollapsed} onToggleNav={() => setNavCollapsed((v) => !v)} />;
      default:
        return null;
      }
    })();
    return <Suspense fallback={<PageLoading />}>{content}</Suspense>;
  };

  // ── UNIFIED SHELL — one layout for EVERY viewport (desktop, iPad, iPhone, Fold-7).
  // The operator asked for the new shell everywhere; the old windowed-HUD desktop layout
  // was removed. Hooks below now run unconditionally (also fixes a latent conditional-hook
  // mismatch between the former mobile vs desktop branches).
    // Bottom tab bar — primary destinations. "More" opens a slide-up sheet.
    // Cyber/tech unicode glyphs instead of emoji for a sharper terminal-OS feel.
    // Bottom bar = the OPERATE group's most-used (Comms/Board/Council/Ops); the rest live in the
    // grouped "More" sheet. Terminal (also Operate) sits in the sheet's OPERATE section.
    const MOBILE_TABS = [
      { id: "chat",        icon: "⬡", label: "COMMS" },
      { id: "missionboard", icon: "⊞", label: "BOARD" },
      { id: "council",     icon: "⚖", label: "COUNCIL" },
      { id: "engagements", icon: "⌖", label: "OPS" },
      { id: "more",        icon: "⋮", label: "MORE" },
    ];
    // Cyber-themed icons for the grouped "More" sheet
    const MORE_ICONS: Record<string, string> = {
      memory:        "⟁",  // triangle-in-triangle — neural core
      skills:        "⚙",  // gear — arsenal
      cron:          "⌬",  // benzene-ring — scheduler
      delegation:    "⊛",  // circled asterisk — dispatch
      personas:      "◈",  // diamond-in-diamond — identities
      logs:          "▤",  // square with horizontal fill — log lines
      "api-logs":    "⟁",  // triangle-in-triangle — API monitor (Splunk-style)
      system:        "▦",  // square grid — system resources (htop-style)
      "cli-sessions":"⌘",  // command symbol — cli
      terminal:      "▶",  // play triangle — terminal prompt
      reports:       "⊟",  // boxed minus — reports
      osint:         "⌖",  // crosshair — osint
      council:       "⚖",  // balance scale — council of AIs
      settings:      "⚙",  // gear — per-persona backend/model config
      "llm-logs":    "❡",  // raw LLM request/response audit trail
      files:         "◫",  // project files
      chat:          "⬡",  engagements: "⌖", kanban: "▤", missionboard: "⊞",
    };
    const [showMoreSheet, setShowMoreSheet] = useState(false);
    const [showPersonaSheet, setShowPersonaSheet] = useState(false);

    // Pick the appropriate page title for the app bar
    const currentTabLabel = (() => {
      const apps = APPS.find(a => a.id === mobileTab);
      return apps?.title || "ChillsPwn";
    })();

    const onTabClick = (id: string) => {
      if (id === "more") {
        refreshSessions();
        setShowMoreSheet(true);
        return;
      }
      setMobileTab(id);
      setShowMoreSheet(false);
    };

    const onMoreAppClick = (id: string) => {
      setMobileTab(id);
      setShowMoreSheet(false);
    };

    return (
      <div className={`poc-shell ${navCollapsed ? "nav-collapsed" : ""}`}>
        {/* command bar */}
        <header className="poc-bar">
          <button className="poc-menu" onClick={() => setShowMoreSheet(true)} aria-label="Menu">☰</button>
          <img src="/Logo.svg" alt="ChillsPwn" className="brand-logo" style={{ height: 30, width: "auto", maxWidth: 160, objectFit: "contain", flexShrink: 0 }} />
          <span className="app-bar-title" style={{ fontFamily: "var(--font-display)", fontSize: 13, letterSpacing: ".05em", textTransform: "uppercase", marginLeft: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentTabLabel}</span>
          <div className="sp" />
          <span className="poc-chip"><span className={`poc-dot ${hasLiveSession ? "live" : ""}`} />{hasLiveSession ? "LIVE" : "IDLE"}</span>
          <button className="poc-chip" onClick={() => setShowPersonaSheet(true)} style={{ maxWidth: 150 }}>
            <span className="poc-dot" style={{ background: currentPersona?.color || "var(--acid)", boxShadow: "none" }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{activePersona}</span> ▾
          </button>
        </header>

        {/* grouped rail (tablet / iPad / Fold) */}
        <aside className="poc-rail">
          {NAV_GROUPS.map(group => (
            <div key={group.title}>
              <div className="poc-railsec">{group.title}</div>
              {group.ids.map(id => {
                const app = APPS.find(a => a.id === id);
                if (!app) return null;
                return (
                  <div key={id} className={`poc-nav ${mobileTab === id ? "on" : ""}`} onClick={() => setMobileTab(id)}>
                    <span className="ic">{MORE_ICONS[id] || app.icon}</span>{app.title}
                  </div>
                );
              })}
            </div>
          ))}
          {/* Sessions live UNDER the app navigation */}
          <SessionNavList
            sessions={navSessions}
            activeId={activeChatId}
            onOpen={openChatSession}
            onNew={newChatSession}
            onRename={renameChatSession}
            onDelete={deleteChatSession}
            showClosed={showClosed}
            onToggleClosed={setShowClosed}
          />
        </aside>

        {/* Persona slide-up sheet (replaces native select) */}
        {showPersonaSheet && (
          <>
            <div className="app-sheet-backdrop" onClick={() => setShowPersonaSheet(false)} />
            <div className="app-sheet" style={{ maxHeight: "60vh" }}>
              <div className="app-sheet-handle" />
              <div className="app-sheet-title">Switch Persona</div>
              {personas.map(p => {
                const isActive = p.name === activePersona;
                return (
                  <button
                    key={p.name}
                    onClick={() => { setActivePersona(p.name); setShowPersonaSheet(false); }}
                    style={{
                      width: "100%", textAlign: "left", padding: "12px 14px",
                      marginBottom: 6, borderRadius: 8,
                      background: isActive ? `${p.color}15` : "rgba(255,255,255,0.02)",
                      border: `1px solid ${isActive ? `${p.color}60` : "var(--border-color)"}`,
                      color: "var(--text-primary)", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 12,
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: p.color, flexShrink: 0 }} />
                    <div style={{ overflow: "hidden", flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: isActive ? p.color : "var(--text-primary)" }}>
                        {p.name}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                        {p.description || `${p.model} · ${p.permissionMode}`}
                      </div>
                    </div>
                    {isActive && <span style={{ color: p.color, fontSize: 14 }}>▸</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* main page content */}
        <main className="poc-main">
          {renderWindowContent(mobileTab)}
        </main>

        {/* phone bottom bar (OPERATE primary) */}
        <div className="poc-botbar">
          {MOBILE_TABS.map(tab => {
            const isActive = tab.id === "more" ? showMoreSheet : (mobileTab === tab.id && !showMoreSheet);
            return (
              <button
                key={tab.id}
                onClick={() => onTabClick(tab.id)}
                className={`poc-tab ${isActive ? "on" : ""}`}
                aria-label={tab.label}
              >
                <span className="ic">{tab.icon}</span>
                <span className="lb">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* phone nav drawer — the full grouped rail (reuses showMoreSheet) */}
        <div className={`poc-drawer ${showMoreSheet ? "open" : ""}`}>
          <div className="bg" onClick={() => setShowMoreSheet(false)} />
          <div className="panel">
            {NAV_GROUPS.map(group => (
              <div key={group.title}>
                <div className="poc-railsec">{group.title}</div>
                {group.ids.map(id => {
                  const app = APPS.find(a => a.id === id);
                  if (!app) return null;
                  return (
                    <div key={id} className={`poc-nav ${mobileTab === id ? "on" : ""}`} onClick={() => onMoreAppClick(id)}>
                      <span className="ic">{MORE_ICONS[id] || app.icon}</span>{app.title}
                    </div>
                  );
                })}
              </div>
            ))}
            {/* Sessions live UNDER the app navigation */}
            <SessionNavList
              sessions={navSessions}
              activeId={activeChatId}
              onOpen={(id) => { openChatSession(id); setShowMoreSheet(false); }}
              onNew={() => { newChatSession(); setShowMoreSheet(false); }}
              onRename={renameChatSession}
              onDelete={deleteChatSession}
              showClosed={showClosed}
              onToggleClosed={setShowClosed}
            />
          </div>
        </div>
      </div>
    );
}
