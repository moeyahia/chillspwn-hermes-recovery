import { useState, useRef, useEffect, useCallback, lazy, Suspense, startTransition, memo } from "react";
import type { CSSProperties } from "react";
import { copyToClipboard } from "../lib/clipboard";
import { CyberDropdown } from "../components/CyberDropdown";
const TerminalPage = lazy(() => import("./TerminalPage"));

// ── Constants ─────────────────────────────────────────

const ALLOWED_TEXT_EXTENSIONS = new Set([
  "txt", "py", "sh", "json", "nmap", "md", "html", "xml", "yaml", "yml",
  "conf", "cfg", "log", "csv", "c", "h", "cpp", "js", "ts", "sql",
]);

const MAX_FILE_SIZE = 500 * 1024; // 500KB

// ── Types ──────────────────────────────────────────────

interface AttachedFile {
  name: string;
  size: number;
  content: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolName?: string;
  toolId?: string;
  isError?: boolean;
  isContextChip?: boolean;    // per-turn "🧠 context loaded" chip (memory/ledger injected)
  timestamp: number;
  streaming?: boolean;        // true while still receiving token deltas
  toolInputPartial?: boolean; // tool card whose input JSON is still accumulating
  isResult?: boolean;         // tool OUTPUT (result) rather than a tool call
}

interface SessionInfo {
  id: string;
  persona: string;
  preview: string;
  running: boolean;
  created_at: number;
  messageCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheRead: number;
  model: string;
  title?: string;
}

// ── Mobile detection ──────────────────────────────────────────────
// Local copy of App.tsx's useIsMobile (importing from App.tsx would create a
// circular import since App imports ChatPage). Returns true on the mobile
// layout (< 900px) so the chat header can stack its info block and action
// buttons into separate full-width rows instead of cramming them into one row.
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" && window.innerWidth < 900
  );
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

// Derive the active provider from a model slug. OpenRouter models are namespaced
// with a "/" (e.g. "deepseek/deepseek-v4-pro", "z-ai/glm-5.1", "qwen/..."), while
// Anthropic models start with "claude" (empty/unknown ⇒ default anthropic).
function deriveProviderFromModel(model?: string | null): "anthropic" | "openrouter" | "openai-codex" | "gemini" | "xai-grok" {
  if (model && /^gpt-5/i.test(model)) return "openai-codex";   // codex models (gpt-5.5)
  if (model && /^gemini-/i.test(model)) return "gemini";       // gemini models (gemini-3.5-flash)
  if (model && /^grok-/i.test(model)) return "xai-grok";
  if (model && model.includes("/")) return "openrouter";
  return "anthropic";
}

interface ChatProps {
  persona: string;
  // The active persona's configured backend — used so the header shows the right provider/model
  // for the default chat (sessions don't persist a provider, so without this it defaults to "Anthropic").
  personaProvider?: string;
  personaModel?: string;
  permissionMode: string;
  onLiveSessionChange?: (hasLive: boolean) => void;
  resumeCliSession?: { id: string; title: string; cwd: string } | null;
  onResumeConsumed?: () => void;
  // ── Nav-driven sessions ──
  // The session list now lives in the app navigation. The nav commands this chat via
  // monotonic nonces (a value change = "do it once"), and the chat reports its active
  // session id back up so the nav can highlight it.
  requestedSession?: { id: string; nonce: number } | null;  // open this session
  pendingNewSession?: boolean;                               // start a fresh session (survives remount)
  onNewSessionConsumed?: () => void;                         // clear the flag once handled
  onActiveSessionChange?: (id: string | null) => void;
}

// ── Component ──────────────────────────────────────────

// ── Confirm Modal ──────────────────────────────────────
function ConfirmModal({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[10000]"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={onCancel}
    >
      <div
        className="rounded-lg p-6 max-w-sm mx-4 relative"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--neon-cyan, #b6f23a)",
          boxShadow: "0 0 30px rgba(182,242,58, 0.15), 0 0 60px rgba(182,242,58, 0.05)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm mb-5" style={{ color: "var(--text-primary)" }}>{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-xs rounded font-medium transition-all"
            style={{ border: "1px solid var(--border-bright, #243049)", color: "var(--text-dim)" }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 text-xs rounded font-medium transition-all"
            style={{
              background: "rgba(255,77,99, 0.15)",
              border: "1px solid rgba(255,77,99, 0.5)",
              color: "#ff4d63",
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChatPage({ persona, personaProvider, personaModel, permissionMode, onLiveSessionChange, resumeCliSession, onResumeConsumed, requestedSession, pendingNewSession, onNewSessionConsumed, onActiveSessionChange }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  // Live activity label that replaces the static "Processing" — fed by status events (engine
  // phases + the model's own narration) and tool_use events. Cleared whenever streaming stops.
  const [currentActivity, setCurrentActivity] = useState<string | null>(null);
  useEffect(() => { if (!isStreaming) setCurrentActivity(null); }, [isStreaming]);
  const [contextTokens, setContextTokens] = useState(0);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [turnCount, setTurnCount] = useState(0); // tracks how many user messages sent in this session
  // Messages the user submitted while a turn was still running — queued on the
  // server and injected after the current turn ends. Shown as chips above the composer.
  const [queuedMessages, setQueuedMessages] = useState<{ id: string; preview: string }[]>([]);
  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [explainModal, setExplainModal] = useState<{ code: string; language: string; explanation: string; loading: boolean } | null>(null);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  // Available skills for the /skill:<name> slash command (loaded from the dashboard's skill list).
  const [availableSkills, setAvailableSkills] = useState<{ name: string; description: string }[]>([]);
  useEffect(() => {
    fetch("/api/skills").then(r => r.json()).then((data) => {
      // /api/skills returns { skills: [...] } (not a bare array)
      const list = Array.isArray(data) ? data : (data?.skills || []);
      setAvailableSkills(list.filter((s: any) => s && s.name).map((s: any) => ({ name: s.name, description: s.description || "" })));
    }).catch(() => {});
  }, []);

  // Working directory / project panel
  const [detectedProject, setDetectedProject] = useState<string | null>(null);
  const [projectFiles, setProjectFiles] = useState<{ name: string; path: string; isDir: boolean; size: number }[]>([]);
  const [showProjectPanel, setShowProjectPanel] = useState(false);
  const [projectPath, setProjectPath] = useState<string | null>(null); // current directory path within the engagement
  const [filePreview, setFilePreview] = useState<{ path: string; name: string; content: string; loading: boolean; binary?: boolean } | null>(null);
  const [projectLoot, setProjectLoot] = useState<string[]>([]);
  const [showTerminal, setShowTerminal] = useState(false);
  // Mobile layout flag — drives the header's column/wrap arrangement on phones
  // so every control stays visible instead of overflowing one cramped row.
  const isMobile = useIsMobile();
  const [wsConnected, setWsConnected] = useState(false);
  // Tracks whether the currentSession has a live claude subprocess. Driven by
  // restore-session/session_history/session_end events. Used by sendMessage to
  // decide between "chat" (spawn new, possibly with context) and "followup"
  // (inject into live stdin). Default false — we always need positive confirmation.
  const [currentSessionLive, setCurrentSessionLive] = useState(false);
  // Phase 7.1: the observe-only AgentRun attached to this chat session (null when the
  // ENABLE_CHAT_AGENT_RUNS feature is off or no run is attached yet). Drives a small banner.
  const [attachedRun, setAttachedRun] = useState<{ runId: string } | null>(null);
  // Re-checked on session change + on each turn start/end (the run is created server-side
  // when a chat turn starts). 404 ⇒ no run attached (feature off or not yet created).
  useEffect(() => {
    if (!currentSession) { setAttachedRun(null); return; }
    let cancelled = false;
    fetch(`/api/sessions/${encodeURIComponent(currentSession)}/run`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setAttachedRun(d && d.runId ? { runId: d.runId } : null); })
      .catch(() => { if (!cancelled) setAttachedRun(null); });
    return () => { cancelled = true; };
  }, [currentSession, isStreaming]);
  // Per-chat permission mode override — defaults to whatever the persona has,
  // but the user can change it for the next spawned session via the header dropdown.
  const [chatPermissionMode, setChatPermissionMode] = useState<string>(permissionMode);
  // ── In-chat provider/model switcher (mid-conversation) ──
  // Lets the operator route THIS chat to OpenRouter (or back to Anthropic) without going to
  // Config. Backed by the server's switch_provider WS + per-session override. The catalog is
  // lazy-loaded the first time the picker opens.
  const [showSwitcher, setShowSwitcher] = useState(false);
  // Mobile-only "⋯" overflow menu that holds the secondary header controls
  // (Terminal/Council/New/Close/mode/provider/copy) so the phone bar stays clean.
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const [orModels, setOrModels] = useState<{ id: string; name?: string; context_length?: number }[]>([]);
  const [switchModel, setSwitchModel] = useState("");
  const [activeProvider, setActiveProvider] = useState<"anthropic" | "openrouter" | "openai-codex" | "gemini" | "xai-grok">("anthropic");
  // The model slug backing this chat (e.g. "claude-opus-4-8" or "deepseek/deepseek-v4-pro").
  // Re-derived on session restore so the provider chip survives a refresh.
  const [activeModel, setActiveModel] = useState<string>("");
  // Default the header's provider/model to the ACTIVE persona's backend (passed by App). The
  // default chat never persists a provider, so without this the header shows "Anthropic" for a
  // Codex/Gemini/OpenRouter persona. session_history overrides this with session-specific values;
  // this only fires when the persona itself changes (not on plain session switches).
  useEffect(() => {
    if (personaProvider) setActiveProvider(personaProvider as any);
    if (personaModel) setActiveModel(personaModel);
  }, [persona, personaProvider, personaModel]);
  // Sidebar starts hidden on mobile (narrow viewport), shown on desktop
  const [showSessions, setShowSessions] = useState(() => typeof window !== "undefined" && window.innerWidth >= 900);
  // Sessions with new activity that the user hasn't viewed yet
  const [unreadSessions, setUnreadSessions] = useState<Set<string>>(new Set());
  // Live-streaming indicator per session (so sidebar shows "..." while bg sessions work)
  const [busySessions, setBusySessions] = useState<Set<string>>(new Set());
  // useRef mirror of currentSession so handleServerEvent (memoized with []) reads the latest value
  const currentSessionRef = useRef<string | null>(null);
  // True for a freshly-created, not-yet-persisted session (via "+ New"). The WS onopen reads this
  // to SKIP both restore and load_session — otherwise a fresh session would either reload the last
  // conversation (the bug) or hit a "session not found" error for its brand-new id.
  const freshSessionRef = useRef(false);
  // useRef mirror of messages so the memoized handler can read current length without
  // re-subscribing — used by the session_history de-race guard (avoid empty-clobber on reconnect).
  const messagesRef = useRef<Message[]>([]);
  // Big-session windowing: load_session sends only the last ~120 msgs; these track
  // whether older history is available to lazy-load via load_older.
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [totalHistory, setTotalHistory] = useState(0);

  // Run-in-terminal handler — opens the inline terminal and sends the command
  const runInTerminal = useCallback((command: string) => {
    setShowTerminal(true);
    // Wait for the terminal to mount + connect before sending the input.
    // The TerminalPage opens its own WebSocket and sends "term_start". The server
    // replies with "term_ready". We don't have direct access to that connection
    // here, so we rely on our chat WS (different WebSocket but shared term routing
    // on the server). Cleaner: send via chat WS — server's term_input handler
    // routes to the proc tracked against the client's WS.
    //
    // The terminal pane connects on its own WS — to inject text into it we route
    // through that WS. We expose `(window as any).__chillspwnTerminalInject` from
    // TerminalPage; if available, use it. Otherwise fall back to copying.
    const attemptSend = (attemptsLeft: number) => {
      const inject = (window as any).__chillspwnTerminalInject as ((s: string) => boolean) | undefined;
      if (inject && inject(command + "\n")) return;
      if (attemptsLeft > 0) {
        setTimeout(() => attemptSend(attemptsLeft - 1), 300);
      } else {
        // Final fallback — copy to clipboard so the user can paste manually
        copyToClipboard(command);
      }
    };
    setTimeout(() => attemptSend(8), 100); // up to ~2.5s total
  }, []);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsSeqRef = useRef(0); // monotonic id per socket, so duplicate sockets are visible in logs
  // Set when the user clicks Stop/Interrupt; consumed by the next interrupted ("error_during_
  // execution") result so we can label it "Stopped by user" vs a non-user interruption.
  const userInterruptRef = useRef<{ sessionId: string; at: number } | null>(null);
  // Last time ANY message was received from the server — used to detect an iOS "zombie"
  // socket (readyState still OPEN after a background freeze, but actually dead).
  const lastRecvRef = useRef<number>(Date.now());
  const detectedPaths = useRef<Set<string>>(new Set());

  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const seenMessageIds = useRef<Set<string>>(new Set());
  // Streaming deltas are coalesced into ONE state update per animation frame (~60fps)
  // instead of one per token, so a fast stream doesn't trigger a render+reparse storm
  // on the live bubble. Keyed by messageId so multiple in-flight bubbles stay separate.
  const pendingDeltasRef = useRef<Map<string, string>>(new Map());
  const deltaRafRef = useRef<number | null>(null);
  // Paced reveal ("drip") queue — see pumpReveal/enqueueReveal/flushReveal below.
  const revealQueueRef = useRef<Message[]>([]);
  const revealTimerRef = useRef<number | null>(null);

  // ── Scroll: NATIVE bottom-pinning via CSS column-reverse on the container ──
  // The messages scroll area uses flex-direction:column-reverse, so the browser
  // keeps the view pinned to the newest message automatically as tokens stream —
  // ZERO JS scroll animation (operator's explicit choice: native, not snappy/glide).
  // We only read scrollTop to toggle the "Jump to latest" pill. In column-reverse
  // the bottom is scrollTop≈0 and reading history moves it away from 0.
  const scrollToBottom = useCallback(() => {
    const c = messagesContainerRef.current;
    // 0 == bottom (newest) in column-reverse. Smooth ONLY here (the pill) — manual scroll stays native.
    if (c) { try { c.scrollTo({ top: 0, behavior: "smooth" }); } catch { c.scrollTop = 0; } }
    setAtBottom(true);
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const c = messagesContainerRef.current;
    if (!c) return;
    setAtBottom(Math.abs(c.scrollTop) <= 120);
  }, []);

  // Sync the local permission-mode override when the persona's default changes
  useEffect(() => { setChatPermissionMode(permissionMode); }, [permissionMode]);

  // Keep messagesRef in sync so the memoized handler's de-race guard sees current length
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Keep ref in sync with state — used by memoized WS handler
  useEffect(() => {
    currentSessionRef.current = currentSession;
    // Clear unread badge when user views a session
    if (currentSession) {
      setUnreadSessions(prev => {
        if (!prev.has(currentSession)) return prev;
        const next = new Set(prev);
        next.delete(currentSession);
        return next;
      });
    }
  }, [currentSession]);

  // ── File attachment handler ──
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      setFileError(`File too large: ${(file.size / 1024).toFixed(1)}KB. Max ${MAX_FILE_SIZE / 1024}KB.`);
      e.target.value = "";
      return;
    }

    // Check extension
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!ALLOWED_TEXT_EXTENSIONS.has(ext)) {
      setFileError(`Binary files not supported. Allowed: ${[...ALLOWED_TEXT_EXTENSIONS].join(", ")}`);
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      // Basic binary check: look for null bytes
      if (content.includes("\0")) {
        setFileError("Binary files not supported");
        e.target.value = "";
        return;
      }
      setAttachedFile({ name: file.name, size: file.size, content });
    };
    reader.onerror = () => {
      setFileError("Failed to read file");
      e.target.value = "";
    };
    reader.readAsText(file);
    e.target.value = "";
  }, []);

  // ── Explain code handler ──
  const handleExplainCode = useCallback(async (code: string, language: string) => {
    setExplainModal({ code, language, explanation: "", loading: true });
    try {
      const resp = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          language,
          // Recent conversation so the helper can explain in context.
          // Cap each message to ~2000 chars; server trims to its configured contextDepth.
          context: messages.slice(-20).map((m) => ({
            role: m.role,
            content: (m.content || "").slice(0, 2000),
          })),
        }),
      });
      const data = await resp.json();
      setExplainModal((prev) => prev ? { ...prev, explanation: data.explanation || data.error || "No response", loading: false } : null);
    } catch (err: any) {
      setExplainModal((prev) => prev ? { ...prev, explanation: `Error: ${err.message}`, loading: false } : null);
    }
  }, [messages]);

  // ── Load CLI session history when resumeCliSession prop changes ──
  const lastLoadedCliSession = useRef<string | null>(null);
  useEffect(() => {
    if (!resumeCliSession) return;
    if (lastLoadedCliSession.current === resumeCliSession.id) return;
    lastLoadedCliSession.current = resumeCliSession.id;

    console.log("[chat] Loading CLI session:", resumeCliSession.id);
    fetch(`/api/cli-sessions/${resumeCliSession.id}/history?limit=200`)
      .then(r => r.json())
      .then(data => {
        console.log("[chat] CLI history response:", data.messages?.length, "messages");
        if (!data.messages?.length) {
          lastLoadedCliSession.current = null;
          return;
        }
        const history: Message[] = data.messages.map((m: any, i: number) => ({
          id: `cli-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: m.role,
          content: m.content,
          toolName: m.toolName,
          toolId: m.toolId,
          timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
        }));
        const sid = `s-${Date.now()}`;
        setCurrentSession(sid);
        setMessages(history);
        // turnCount = 0 so the next send triggers a fresh "chat" (with --resume),
        // not a "followup" to a non-existent live session
        setTurnCount(0);
        seenMessageIds.current = new Set(history.map(m => m.id));
        onResumeConsumed?.();
      })
      .catch((err) => {
        console.error("[chat] CLI history load failed:", err);
        lastLoadedCliSession.current = null;
      });
  }, [resumeCliSession, onResumeConsumed]);

  // ── WebSocket connection with auto-reconnect ──
  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      // GUARD: never open a second socket while one is already CONNECTING or OPEN.
      // (A reconnect timer + a visibility-driven reconnect could otherwise both fire.)
      const existing = wsRef.current;
      if (existing && (existing.readyState === WebSocket.CONNECTING || existing.readyState === WebSocket.OPEN)) return;
      const id = ++wsSeqRef.current;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log(`[ws#${id}] connected`);
        // Connected → cancel any pending reconnect timer so a stale one can't fire later.
        if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
        setWsConnected(true);
        reconnectAttemptsRef.current = 0;
        ws.send(JSON.stringify({ type: "list_sessions" }));

        // If we have a current session, reattach to it (re-sync messages and live status).
        // Read the REF, not the closed-over `currentSession` — this effect runs with []
        // deps, so the closure's `currentSession` is frozen at first render (null). On a
        // background-resume reconnect that stale null meant we never re-attached to the
        // still-running OpenRouter session → chat looked "stopped". The ref is always current.
        // A freshly-created "+ New" session must stay empty: don't reattach to its
        // (non-existent) id and don't fall through to the last-session restore below.
        if (freshSessionRef.current) return;

        const sid = currentSessionRef.current || currentSession;
        if (sid) {
          ws.send(JSON.stringify({ type: "load_session", sessionId: sid }));
          return;
        }

        // Skip auto-restore if user is resuming a CLI session — that takes priority
        if ((window as any).__resumeCliSessionId) return;

        // Smart session restore — auto-load the last session if we don't have one
        fetch("/api/restore-session")
          .then(r => r.json())
          .then(data => {
            if ((window as any).__resumeCliSessionId) return;
            // Race guard: this fetch is async. If the user opened or created a
            // DIFFERENT session while it was in flight, do NOT clobber that view
            // with the last-active session's (deferred) history.
            if (currentSessionRef.current && currentSessionRef.current !== data.sessionId) return;
            if (data.hasSession && data.messages?.length > 0) {
              setCurrentSession(data.sessionId);
              // Render the restored history as a NON-URGENT transition so the chat
              // shell + input stay interactive while the (now windowed) list paints,
              // instead of blocking the main thread on one big synchronous render.
              startTransition(() => setMessages(data.messages));
              setHasMoreHistory(!!data.hasMore);
              setTotalHistory(typeof data.totalMessages === "number" ? data.totalMessages : data.messages.length);
              const userMsgCount = data.messages.filter((m: any) => m.role === "user").length;
              // With windowing the visible user-count is partial; trust hasMore as a
              // signal that older turns exist (drives followup-vs-spawn).
              setTurnCount(data.hasMore ? Math.max(userMsgCount, 1) : userMsgCount);
              setCurrentSessionLive(!!data.isLive); // authoritative liveness from server
              (window as any).__restoreContextSummary = data.contextSummary;
              (window as any).__restorePersona = data.persona;
              (window as any).__restoreIsLive = data.isLive;
              // Re-derive provider/model on restore: the server's in-memory provider override is
              // lost on refresh, so trust the persisted session model — and when the session has
              // neither (the default chat never persists a provider), fall back to the active
              // persona's configured backend instead of defaulting to "Anthropic".
              if (data.model) setActiveModel(data.model);
              else if (personaModel) setActiveModel(personaModel);
              setActiveProvider(
                data.provider === "openrouter" || data.provider === "anthropic" || data.provider === "openai-codex" || data.provider === "gemini" || data.provider === "xai-grok"
                  ? data.provider
                  : data.model
                    ? deriveProviderFromModel(data.model)
                    : ((personaProvider as any) || "anthropic")
              );
              if (data.isLive) {
                ws.send(JSON.stringify({ type: "load_session", sessionId: data.sessionId }));
              }
            }
          })
          .catch(() => {});
      };

      ws.onmessage = (event) => {
        lastRecvRef.current = Date.now();   // liveness heartbeat (zombie-socket detection)
        try {
          const msg = JSON.parse(event.data);
          handleServerEvent(msg);
        } catch (e) {
          console.warn("[ws] parse error", e);
        }
      };

      ws.onclose = () => {
        console.log(`[ws#${id}] disconnected`);
        // ONLY the current socket may drive UI state + schedule a reconnect. A socket that
        // was replaced (hardReconnect) or is otherwise stale must do NOTHING here — that
        // stale-onclose reconnect was the source of duplicate "[ws] connected" sockets.
        if (cancelled || wsRef.current !== ws) return;
        setWsConnected(false);
        setIsStreaming(false);
        // Auto-reconnect with exponential backoff (capped at 10s)
        const attempt = ++reconnectAttemptsRef.current;
        const delay = Math.min(1000 * Math.pow(1.5, attempt - 1), 10000);
        console.log(`[ws#${id}] reconnecting in ${Math.round(delay)}ms (attempt ${attempt})`);
        reconnectTimerRef.current = setTimeout(connect, delay);
      };

      ws.onerror = (e) => {
        console.warn(`[ws#${id}] error`, e);
      };
    };

    connect();

    // ── Resume from background (iOS/Android PWA fix) ──
    // When the app is backgrounded, the OS freezes JS timers and silently kills the
    // WebSocket. On return the page would otherwise sit on an empty shell because the
    // backoff timer never fires and the socket is dead. On any "we're visible again"
    // signal, re-establish and re-attach so the still-running OpenRouter orchestrator's
    // output reappears (the server keeps the detached process alive regardless).
    const hardReconnect = () => {
      if (cancelled) return;
      if (reconnectTimerRef.current) { clearTimeout(reconnectTimerRef.current); reconnectTimerRef.current = null; }
      reconnectAttemptsRef.current = 0;
      // Detach the old socket FIRST: with wsRef.current = null, the old socket's onclose
      // sees `wsRef.current !== ws` and does NOT schedule its own reconnect. Otherwise we'd
      // get two concurrent connects (this one + the old onclose's) → duplicate sockets.
      const old = wsRef.current;
      wsRef.current = null;
      try { old?.close(); } catch {}
      connect();   // onopen re-sends list_sessions + load_session(currentSessionRef)
    };
    const forceReconnect = () => {
      if (cancelled) return;
      if (document.visibilityState === "hidden") return;
      const cur = wsRef.current;
      // iOS ZOMBIE SOCKET: after a background freeze the socket often still reports OPEN
      // while being dead, so "if OPEN, do nothing" left the chat wired to a corpse and it
      // looked stopped. Instead, when it claims OPEN we PROBE: send load_session (the server
      // always answers with session_history) and arm a 3s watchdog — if no message arrives,
      // it's a zombie → hard reconnect. If not OPEN, reconnect immediately.
      if (cur && cur.readyState === WebSocket.OPEN) {
        const sid = currentSessionRef.current;
        const before = lastRecvRef.current;
        try {
          cur.send(JSON.stringify({ type: "list_sessions" }));
          if (sid) cur.send(JSON.stringify({ type: "load_session", sessionId: sid }));
        } catch { hardReconnect(); return; }
        setTimeout(() => {
          if (cancelled) return;
          // No server message since the probe → the OPEN socket is dead. Reconnect.
          if (lastRecvRef.current === before) hardReconnect();
        }, 3000);
        return;
      }
      hardReconnect();
    };
    const onVisible = () => { if (document.visibilityState === "visible") forceReconnect(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", forceReconnect);
    window.addEventListener("focus", forceReconnect);
    window.addEventListener("online", forceReconnect);

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", forceReconnect);
      window.removeEventListener("focus", forceReconnect);
      window.removeEventListener("online", forceReconnect);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Paced message reveal ("drip") ──────────────────────────────────────────────
  // Real chat apps receive messages one-at-a-time over the network; the agent emits a whole
  // turn's bubbles (text + command + output) in a BURST, which floods the scroll. NEW live
  // bubbles (tool commands, tool outputs, context chips, non-streamed text) route through this
  // FIFO queue and are revealed at a human cadence so the chat POPULATES instead of dumping.
  // Catch-up batching keeps a big backlog (fast turn / event replay) from lagging reality.
  // Streaming token deltas + reconciliations of an on-screen bubble bypass it (immediate);
  // flushReveal() drains it to preserve order before a new text bubble and on turn-end / switch.
  // The setMessages updaters dedup by id, so a re-delivered event can never double a bubble.
  const pumpReveal = useCallback(() => {
    revealTimerRef.current = null;
    const q = revealQueueRef.current;
    if (q.length === 0) return;
    const release = q.length > 10 ? q.splice(0, q.length - 4) : [q.shift() as Message];
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      const fresh = release.filter((r) => !ids.has(r.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
    if (q.length > 0) revealTimerRef.current = window.setTimeout(pumpReveal, q.length > 6 ? 55 : 130);
  }, []);
  const enqueueReveal = useCallback((m: Message) => {
    revealQueueRef.current.push(m);
    if (revealTimerRef.current == null) revealTimerRef.current = window.setTimeout(pumpReveal, 0);
  }, [pumpReveal]);
  const flushReveal = useCallback(() => {
    if (revealTimerRef.current != null) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null; }
    const q = revealQueueRef.current;
    if (!q.length) return;
    const all = q.splice(0, q.length);
    setMessages((prev) => {
      const ids = new Set(prev.map((m) => m.id));
      const fresh = all.filter((r) => !ids.has(r.id));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, []);

  // Flush all buffered streaming text into state in a single update. Runs on an
  // animation frame. Skips ids already finalized (the consolidated `assistant`
  // event owns the bubble once it lands), so it can never resurrect a closed turn.
  const flushStreamingDeltas = useCallback(() => {
    deltaRafRef.current = null;
    const pend = pendingDeltasRef.current;
    if (pend.size === 0) return;
    const entries = Array.from(pend.entries());
    pend.clear();
    if (entries.some(([mid]) => !seenMessageIds.current.has(mid) && !messagesRef.current.some((m) => m.id === mid))) {
      flushReveal();  // release queued command/output bubbles before a NEW text bubble (keep order)
    }
    setMessages((prev) => {
      let arr = prev;
      let changed = false;
      for (const [mid, text] of entries) {
        if (!text || seenMessageIds.current.has(mid)) continue;
        if (arr.some((m) => m.id === mid)) {
          arr = arr.map((m) => (m.id === mid ? { ...m, content: m.content + text, streaming: true } : m));
        } else {
          arr = [...arr, { id: mid, role: "assistant", content: text, streaming: true, timestamp: Date.now() }];
        }
        changed = true;
      }
      return changed ? arr : prev;
    });
  }, [flushReveal]);

  // Drop any half-buffered stream tokens (and cancel a pending frame) whenever the
  // active session changes, so the old session's trailing tokens can't bleed in.
  useEffect(() => {
    pendingDeltasRef.current.clear();
    if (deltaRafRef.current != null) {
      cancelAnimationFrame(deltaRafRef.current);
      deltaRafRef.current = null;
    }
    // Drop the reveal queue too — the new session reloads its own history instantly.
    revealQueueRef.current = [];
    if (revealTimerRef.current != null) { clearTimeout(revealTimerRef.current); revealTimerRef.current = null; }
    return () => {
      if (deltaRafRef.current != null) cancelAnimationFrame(deltaRafRef.current);
      if (revealTimerRef.current != null) clearTimeout(revealTimerRef.current);
    };
  }, [currentSession]);

  // ── Handle server events ──
  const handleServerEvent = useCallback((msg: any) => {
    // -- Live token streaming (partial deltas) --
    // Builds the in-progress assistant bubble token-by-token. The bubble id is
    // the model's message.id, so the later consolidated `assistant` event
    // reconciles onto it (replace + un-stream) instead of duplicating.
    if (msg.type === "claude_delta") {
      const eventSessionId = msg.sessionId;
      if (eventSessionId && eventSessionId !== currentSessionRef.current) {
        if (eventSessionId) setBusySessions(prev => prev.has(eventSessionId) ? prev : new Set(prev).add(eventSessionId));
        return; // background session — don't render in current view
      }
      const messageId = msg.messageId;
      if (msg.phase === "block_start") {
        if (msg.blockType === "tool_use" && msg.toolId) {
          // Show the tool card immediately ("Claude is calling X"); input fills in.
          const tid = `tool-${msg.toolId}`;
          setMessages(prev => prev.some(m => m.id === tid)
            ? prev
            : [...prev, { id: tid, role: "tool", toolName: msg.toolName, toolId: msg.toolId, content: "", toolInputPartial: true, streaming: true, timestamp: Date.now() }]);
        }
        // Text bubble is created lazily on the first delta (avoids an empty
        // flash). Thinking blocks are intentionally not surfaced.
        return;
      }
      if (msg.phase === "delta" && msg.kind === "text" && messageId) {
        if (seenMessageIds.current.has(messageId)) return; // already finalized
        const chunk = msg.text || "";
        if (!chunk) return;
        // Coalesce tokens: buffer this chunk and flush all pending on the next frame
        // (one render+reparse per frame, not per token). Same final content as before.
        pendingDeltasRef.current.set(messageId, (pendingDeltasRef.current.get(messageId) || "") + chunk);
        if (deltaRafRef.current == null) {
          deltaRafRef.current = requestAnimationFrame(flushStreamingDeltas);
        }
        return;
      }
      // thinking/tool_input deltas, block_stop, message_start: nothing to render
      return;
    }

    // -- Turn lifecycle / queue / interrupt acknowledgements --
    if (msg.type === "turn_state") {
      if (msg.sessionId && msg.sessionId !== currentSessionRef.current) return;
      setIsStreaming(!!msg.turnActive);
      return;
    }
    if (msg.type === "followup_dequeued") {
      if (msg.sessionId && msg.sessionId !== currentSessionRef.current) return;
      setQueuedMessages(prev => prev.slice(1)); // FIFO — drop the oldest
      return;
    }
    if (msg.type === "followup_queued" || msg.type === "interrupt_ack") {
      return; // queue chips are tracked locally on send; interrupt result renders itself
    }
    // -- Mid-conversation provider switch acknowledged by the server --
    // The backend has set a per-session override and ended the live backend; the next
    // message resurrects on the chosen provider, seeded from the persisted history.
    if (msg.type === "provider_switched") {
      if (msg.sessionId && msg.sessionId !== currentSessionRef.current) return;
      setCurrentSessionLive(false); // force the next send to spawn (resurrect) on the new backend
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-${Date.now()}`,
          role: "system",
          content: `↺ Switched this chat to ${msg.provider === "openrouter" ? "OpenRouter" : msg.provider === "openai-codex" ? "OpenAI Codex" : msg.provider === "gemini" ? "Google Gemini" : msg.provider === "xai-grok" ? "Grok Build (OAuth ACP)" : "Anthropic"} · ${msg.model}. Your next message continues here on the new model.`,
          isError: false,
          timestamp: Date.now(),
        },
      ]);
      return;
    }

    // -- Claude streaming events --
    if (msg.type === "claude_event") {
      const data = msg.data;
      // Track which session this event belongs to. Events for background
      // sessions get marked as "unread" (sidebar badge); we don't merge them
      // into the currently-viewed session's message stream.
      const eventSessionId = msg.sessionId;
      const isBackgroundEvent = eventSessionId && eventSessionId !== currentSessionRef.current;
      if (isBackgroundEvent) {
        // Mark unread + busy for this background session
        if (data.type === "assistant" || data.type === "tool_use") {
          setUnreadSessions(prev => {
            if (prev.has(eventSessionId)) return prev;
            const next = new Set(prev);
            next.add(eventSessionId);
            return next;
          });
        }
        // Track streaming state for sidebar pulse-dot
        if (data.type === "assistant" || data.type === "tool_use") {
          setBusySessions(prev => {
            if (prev.has(eventSessionId)) return prev;
            const next = new Set(prev);
            next.add(eventSessionId);
            return next;
          });
        }
        if (data.type === "result") {
          setBusySessions(prev => {
            if (!prev.has(eventSessionId)) return prev;
            const next = new Set(prev);
            next.delete(eventSessionId);
            return next;
          });
        }
        return; // Don't render in current view
      }

      // Live activity label for the "Processing" indicator (engine phase / model narration).
      if (data.type === "status") {
        const txt = typeof data.text === "string" ? data.text.trim() : "";
        // kind:"context" → a persistent per-turn chip showing what memory/ledger was injected
        // (the passive "model is referring to the MCP/memory" signal). Else → the transient label.
        if (data.kind === "context" && txt) {
          if (!msg.sessionId || msg.sessionId === currentSessionRef.current) {
            enqueueReveal({ id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, role: "system", content: txt, isContextChip: true, timestamp: Date.now() });
          }
          return;
        }
        if (txt) setCurrentActivity(txt);
        return;
      }

      // SKIP system init events (don't clutter chat)
      if (data.type === "system") return;

      // SKIP rate limit events
      if (data.type === "rate_limit_event") return;

      // TOOL OUTPUT — results arrive as `user` events carrying tool_result blocks.
      // Render each as a distinct output panel (deduped by tool_use_id).
      if (data.type === "user") {
        const content = data.message?.content;
        if (!Array.isArray(content)) return;
        for (const block of content) {
          if (block.type !== "tool_result") continue;
          const resultText = typeof block.content === "string"
            ? block.content
            : Array.isArray(block.content)
              ? block.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n")
              : (block.content != null ? JSON.stringify(block.content, null, 2) : "");
          const rid = `result-${block.tool_use_id || Math.random().toString(36).slice(2, 8)}`;
          if (seenMessageIds.current.has(rid)) continue;
          seenMessageIds.current.add(rid);
          enqueueReveal({
            id: rid,
            role: "tool",
            content: resultText || "(no output)",
            toolName: "result",
            toolId: block.tool_use_id,
            isResult: true,
            isError: !!block.is_error,
            timestamp: Date.now(),
          });
        }
        return;
      }

      // ASSISTANT message — only show if it has text blocks
      if (data.type === "assistant") {
        const content = data.message?.content;
        if (!Array.isArray(content)) return;

        const hasText = content.some((b: any) => b.type === "text");
        const hasToolUse = content.some((b: any) => b.type === "tool_use");
        if (!hasText && !hasToolUse) return; // skip thinking-only events

        // Dedup by message.id — but text and tool_use arrive as SEPARATE events
        // sharing ONE msgId (CLI splits per content block). A bare-id skip dropped
        // the tool_use event after the text event registered the id, so the
        // command never rendered. Instead: render text once (guarded), and ALWAYS
        // process tool_use blocks below (reconciliation is idempotent by tool.id).
        const msgId = data.message?.id;
        const textAlreadyRendered = !!msgId && seenMessageIds.current.has(msgId);
        if (msgId) seenMessageIds.current.add(msgId);

        // Extract text blocks
        const textParts = content
          .filter((b: any) => b.type === "text")
          .map((b: any) => b.text)
          .join("\n");

        // Extract tool_use blocks
        const toolParts = content.filter((b: any) => b.type === "tool_use");
        if (toolParts.length) {
          // Reflect the tool being run in the live activity label (e.g. "Launching RDP session…").
          const last = toolParts[toolParts.length - 1];
          setCurrentActivity(activityLabel(last.name, JSON.stringify(last.input || {})));
        }

        if (textParts && !textAlreadyRendered) {
          const tid = msgId || `asst-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          // Order: release any queued command/output bubbles BEFORE this text block lands.
          flushReveal();
          const liveIdx = messagesRef.current.findIndex((m) => m.id === tid);
          if (liveIdx >= 0) {
            // Reconcile a streamed bubble already on screen — replace content, un-stream (immediate).
            setMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === tid);
              if (idx < 0) return [...prev, { id: tid, role: "assistant", content: textParts, timestamp: Date.now() }];
              const next = [...prev];
              next[idx] = { ...next[idx], content: textParts, streaming: false };
              return next;
            });
          } else {
            // Brand-new (non-streamed) text bubble — reveal it through the paced queue.
            enqueueReveal({ id: tid, role: "assistant", content: textParts, timestamp: Date.now() });
          }
        }

        for (const tool of toolParts) {
          const toolMsgId = `tool-${tool.id}`;
          const toolContent = JSON.stringify(tool.input, null, 2);
          const liveIdx = messagesRef.current.findIndex((m) => m.id === toolMsgId);
          const qIdx = revealQueueRef.current.findIndex((m) => m.id === toolMsgId);
          if (liveIdx >= 0) {
            // Reconcile a streamed tool card already on screen (Claude block_start path) — immediate.
            setMessages((prev) => {
              const idx = prev.findIndex((m) => m.id === toolMsgId);
              if (idx < 0) return prev;
              const next = [...prev];
              next[idx] = { ...next[idx], content: toolContent, toolName: tool.name, streaming: false, toolInputPartial: false };
              return next;
            });
          } else if (qIdx >= 0) {
            // Still in the reveal queue — update it in place (no duplicate, no reorder).
            revealQueueRef.current[qIdx] = { ...revealQueueRef.current[qIdx], content: toolContent, toolName: tool.name, streaming: false, toolInputPartial: false };
          } else {
            // New command card — reveal it through the paced queue.
            enqueueReveal({ id: toolMsgId, role: "tool", content: toolContent, toolName: tool.name, toolId: tool.id, timestamp: Date.now() });
          }

          // Detect project from file paths in tool_use
          const inp = tool.input || {};
          const pathFields = [inp.file_path, inp.path, inp.command, inp.description].filter(Boolean);
          for (const field of pathFields) {
            const match = String(field).match(/\/root\/(htb\/boxes|engagements)\/([^\/\s'"]+)/);
            if (match) {
              const proj = match[2];
              if (!detectedPaths.current.has(proj)) {
                detectedPaths.current.add(proj);
                setDetectedProject(proj);
                // Fetch project files
                fetch(`/api/files/list?path=/root/${match[1]}/${proj}`)
                  .then(r => r.json())
                  .then(d => setProjectFiles(d.entries || []))
                  .catch(() => {});
                // Check for loot
                fetch(`/api/files/list?path=/root/${match[1]}/${proj}/loot`)
                  .then(r => r.json())
                  .then(d => setProjectLoot((d.entries || []).map((e: any) => e.name)))
                  .catch(() => setProjectLoot([]));
              }
            }
          }
        }
      }

      // RESULT — mark streaming done, show usage
      if (data.type === "result") {
        flushReveal();  // reveal any still-queued command/output bubbles before the turn closes
        setIsStreaming(false);
        // Finalize any bubbles still flagged as streaming (the consolidated
        // assistant event usually does this; this is the safety net).
        setMessages(prev => prev.some(m => m.streaming || m.toolInputPartial)
          ? prev.map(m => (m.streaming || m.toolInputPartial) ? { ...m, streaming: false, toolInputPartial: false } : m)
          : prev);

        // If this session was scheduled to close after memory check, do it now
        const sidForClose = closeAfterMemoryRef.current;
        if (sidForClose && (msg.sessionId === sidForClose || !msg.sessionId)) {
          closeAfterMemoryRef.current = null;
          const after = postCloseActionRef.current;
          postCloseActionRef.current = null;
          // Tell the server to stop the live process
          setTimeout(() => {
            wsRef.current?.send(JSON.stringify({ type: "stop", sessionId: sidForClose }));
            // Then run any follow-up action (e.g. delete)
            if (after) setTimeout(after, 400);
          }, 200);
        }

        // Show error if present — but an interrupted turn ends with
        // subtype "error_during_execution"; render that as a subtle note,
        // not a scary red error.
        if (data.is_error) {
          const interrupted = data.subtype === "error_during_execution";
          // Did THIS user just click Stop (within ~30s, same session)? If so, label it
          // "Stopped by user"; otherwise it's a non-user interruption.
          const ui = userInterruptRef.current;
          const byUser = interrupted && !!ui && (Date.now() - ui.at < 30000)
            && (!currentSessionRef.current || ui.sessionId === currentSessionRef.current);
          if (byUser) userInterruptRef.current = null; // consume so a later turn isn't mislabeled
          setMessages((prev) => [
            ...prev,
            {
              id: `${interrupted ? "int" : "err"}-${Date.now()}`,
              role: "system",
              content: interrupted
                ? (byUser ? "⏹ Stopped by user" : "↯ turn interrupted")
                : `Error: ${data.result || "Unknown error"} (status: ${data.api_error_status || "?"})`,
              isError: !interrupted,
              timestamp: Date.now(),
            },
          ]);
        } else if (data.end_reason && data.end_reason !== "final") {
          // OpenRouter orchestrator stopped for a non-natural reason (hit the
          // per-turn tool-iteration safety cap, or a loop guard). Tell the user
          // explicitly so a truncated turn never silently looks like a clean
          // finish — they can send a message to continue where it left off.
          const reasonLabel =
            data.end_reason === "max_iters"
              ? `⏸ Stopped after ${data.max_iters || "the"} tool-iterations (safety cap). Send a message to continue where it left off.`
              : data.end_reason === "loop_detected"
              ? "⏸ Stopped — the model was repeating the same tool call. Send a message to redirect it."
              : `⏸ Turn paused (${data.end_reason}). Send a message to continue.`;
          setMessages((prev) => [
            ...prev,
            {
              id: `endreason-${Date.now()}`,
              role: "system",
              content: reasonLabel,
              isError: false,
              timestamp: Date.now(),
            },
          ]);
        }

        // Update context size and show usage stats
        if (data.usage) {
          const u = data.usage;
          const totalCtx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
          setContextTokens(totalCtx);
          const cacheInfo = u.cache_read_input_tokens ? ` · ${(u.cache_read_input_tokens / 1000).toFixed(1)}K cached` : "";
          setMessages((prev) => [
            ...prev,
            {
              id: `usage-${Date.now()}`,
              role: "system",
              content: `${u.input_tokens || 0} in + ${u.output_tokens || 0} out${cacheInfo} · ${((data.duration_ms || 0) / 1000).toFixed(1)}s · ctx: ${(totalCtx / 1000).toFixed(1)}K`,
              timestamp: Date.now(),
            },
          ]);
        }
      }
    }

    // -- Session list response --
    if (msg.type === "session_list") {
      const mapped = (msg.sessions || []).map((s: any) => ({
        id: s.id,
        persona: s.persona,
        preview: s.preview || "",
        running: s.status === "running",
        created_at: new Date(s.createdAt).getTime(),
        messageCount: s.messageCount || 0,
        totalInputTokens: s.totalInputTokens || 0,
        totalOutputTokens: s.totalOutputTokens || 0,
        totalCacheRead: s.totalCacheRead || 0,
        model: s.model || "",
        title: s.title || "",
      }));
      setSessions(mapped);
      onLiveSessionChange?.(mapped.some((s: SessionInfo) => s.running));
    }

    // -- Session history response --
    if (msg.type === "session_history") {
      // Stale-session guard: a load_session reply for a session we've SINCE LEFT
      // (switched away / created a new one) must NOT repopulate the current view.
      // Without this, a late history reply for the previous session leaks its tool
      // bubbles into the new session, then the next send appends on top of them.
      // Mirrors the guards in session_history_older (below) and the stream handlers above.
      if (msg.sessionId && msg.sessionId !== currentSessionRef.current) return;
      const incoming: Message[] = (msg.messages || []).map((m: any, i: number) => ({
        id: m.id || m.toolId || `hist-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: m.role,
        content: m.content,
        toolName: m.toolName,
        toolId: m.toolId,
        isResult: m.isResult,
        timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
      }));
      // De-race guard: on navigate-away → back, the reconnect's onopen fires BOTH
      // list_sessions AND load_session. A stale/empty load_session reply must NOT
      // wipe the messages we're already showing for THIS same session (the blank
      // flash). Only replace when the incoming history is for a different session,
      // OR it actually has content, OR we currently have nothing to lose.
      const sameSession = !msg.sessionId || msg.sessionId === currentSessionRef.current;
      const history =
        sameSession && incoming.length === 0 && messagesRef.current.length > 0
          ? messagesRef.current // keep what we have; ignore the empty clobber
          : incoming;
      seenMessageIds.current = new Set(history.map((m) => m.id));
      // Non-urgent: keep the current view interactive while the windowed history
      // (up to ~120 bubbles) paints, rather than a blocking synchronous render.
      startTransition(() => setMessages(history));
      // Big sessions are sent windowed (last ~120). Track whether older history exists
      // so we can show a "Load older" affordance, and remember the true total.
      setHasMoreHistory(!!msg.hasMore);
      setTotalHistory(typeof msg.totalMessages === "number" ? msg.totalMessages : history.length);
      // turnCount drives followup-vs-spawn. With windowing the visible user-count is
      // partial, so trust the server's total when it indicates more exists.
      const userCount = history.filter((m: Message) => m.role === "user").length;
      setTurnCount(msg.hasMore ? Math.max(userCount, 1) : userCount);
      // Track liveness from server's authoritative answer
      const sessionIsLive = msg.status === "running";
      setCurrentSessionLive(sessionIsLive);
      // Re-derive the provider chip from the persisted model so a refresh /
      // session-switch keeps the right backend label (override map is in-memory).
      if (msg.model) setActiveModel(msg.model);
      setActiveProvider(
        msg.provider === "openrouter" || msg.provider === "anthropic" || msg.provider === "openai-codex" || msg.provider === "gemini" || msg.provider === "xai-grok"
          ? msg.provider
          : deriveProviderFromModel(msg.model)
      );
      if (sessionIsLive) {
        setIsStreaming(true);
        onLiveSessionChange?.(true);
      }
    }

    // -- Older history page (prepended; pairs with load_older request) --
    if (msg.type === "session_history_older") {
      if (msg.sessionId && msg.sessionId !== currentSessionRef.current) return;
      const older: Message[] = (msg.messages || []).map((m: any, i: number) => ({
        id: m.id || m.toolId || `histold-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: m.role,
        content: m.content,
        toolName: m.toolName,
        toolId: m.toolId,
        isResult: m.isResult,
        timestamp: m.timestamp ? new Date(m.timestamp).getTime() : Date.now(),
      })).filter((m: Message) => !seenMessageIds.current.has(m.id));
      older.forEach((m) => seenMessageIds.current.add(m.id));
      if (older.length) setMessages((prev) => [...older, ...prev]);
      setHasMoreHistory(!!msg.hasMore);
    }

    // -- Session ended --
    if (msg.type === "session_end") {
      // Clear busy state for whichever session ended
      const endedId = msg.sessionId;
      if (endedId && endedId === currentSessionRef.current) {
        // This session is no longer live — next send must spawn new
        setCurrentSessionLive(false);
      }
      if (endedId) {
        setBusySessions(prev => {
          if (!prev.has(endedId)) return prev;
          const next = new Set(prev);
          next.delete(endedId);
          return next;
        });
      }
      // Only mark THIS view as not-streaming if the ended session is the one we're viewing
      if (!endedId || endedId === currentSessionRef.current) {
        setIsStreaming(false);
        onLiveSessionChange?.(false);
      }
      // Refresh session list
      wsRef.current?.send(JSON.stringify({ type: "list_sessions" }));
    }

    // -- Error --
    if (msg.type === "error") {
      setIsStreaming(false);
      // If the error references a specific session that's not live anymore
      // (e.g. user typed after the claude subprocess already exited), DON'T
      // clear the chat — preserve the history. Just mark the session as
      // not-running in the sidebar and show a small inline notice so the
      // user can see what happened. The next send will automatically respawn
      // a fresh claude via sendMessage's resurrect logic.
      const orphanId = msg.sessionId;
      const m = (msg.message || "").toLowerCase();
      const notFound = m.includes("not found") || m.includes("no running session") || m.includes("does not exist");
      if (orphanId && notFound) {
        // Mark session as not-running (instead of removing) so the sidebar reflects reality
        setSessions((prev) => prev.map((s) =>
          s.id === orphanId ? { ...s, running: false } : s
        ));
        // Only show the notice for the currently-viewed session
        if (currentSessionRef.current === orphanId) {
          setMessages((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              role: "system",
              content: "↻ Reconnected to this conversation. Just keep typing — your full history is loaded and your next message continues right where you left off.",
              isError: false,
              timestamp: Date.now(),
            },
          ]);
        }
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "system",
          content: `Error: ${msg.message}`,
          isError: true,
          timestamp: Date.now(),
        },
      ]);
    }
  }, []);

  // ── Project file browser helpers ──
  const browseProjectPath = useCallback((path: string) => {
    setProjectPath(path);
    fetch(`/api/files/list?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((d) => setProjectFiles(d.entries || []))
      .catch(() => setProjectFiles([]));
  }, []);

  const openFilePreview = useCallback((filePath: string, fileName: string) => {
    setFilePreview({ path: filePath, name: fileName, content: "", loading: true });
    fetch(`/api/files/read?path=${encodeURIComponent(filePath)}`)
      .then((r) => r.json())
      .then((d) => {
        setFilePreview({
          path: filePath,
          name: fileName,
          content: d.content || d.error || "(empty)",
          loading: false,
          binary: d.binary,
        });
      })
      .catch((e) => {
        setFilePreview({ path: filePath, name: fileName, content: `Failed to load: ${e.message}`, loading: false });
      });
  }, []);

  // ── Create new session ──
  const createNewSession = useCallback(() => {
    const id = `s-${Date.now()}`;
    freshSessionRef.current = true;        // empty, not-yet-persisted — onopen must not restore it
    currentSessionRef.current = id;        // set immediately so a racing onopen sees the new id
    setCurrentSession(id);
    setMessages([]);
    setTurnCount(0);
    setCurrentSessionLive(false); // new session — nothing's running yet
    seenMessageIds.current = new Set();
    // Optimistically add a placeholder to the sidebar so the user immediately
    // sees their new session — it'll be replaced/updated when the server
    // returns the real list after the first message is sent.
    setSessions((prev) => {
      if (prev.some((s) => s.id === id)) return prev;
      return [
        {
          id,
          persona,
          preview: "(empty — type a message to start)",
          running: false,
          created_at: Date.now(),
          messageCount: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheRead: 0,
          model: "",
        },
        ...prev,
      ];
    });
    inputRef.current?.focus();
  }, [persona]);

  // ── Switch to existing session ──
  const switchSession = useCallback((sessionId: string) => {
    freshSessionRef.current = false;       // switching to a real, persisted session
    currentSessionRef.current = sessionId;
    setCurrentSession(sessionId);
    setMessages([]);
    setIsStreaming(false);
    seenMessageIds.current = new Set();
    // Clear unread + busy marker for this session — user is now viewing it
    setUnreadSessions(prev => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
    // Load fresh state from server — includes everything that streamed in
    // while the user was on another session (server-side persistence saves
    // text + tool calls + tool results in real-time).
    // Only send if the socket is actually OPEN: when a session is opened from the nav
    // on ANOTHER tab, ChatPage remounts and switchSession runs while the WS is still
    // CONNECTING. Calling .send() then throws "Still in CONNECTING state" — which, from
    // inside this effect, unmounted the whole app (blank screen). When not open, onopen
    // loads currentSessionRef.current (set just above) once connected.
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "load_session", sessionId }));
    }
  }, []);

  // ── Send message ──
  const sendMessage = useCallback(() => {
    if (!input.trim() && !attachedFile) return;

    // If WS is not connected, show an explicit error so the user knows the
    // message didn't go through. Previously this returned silently and the
    // user thought Claude was ignoring them.
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        role: "system",
        content: "⚠️ Not connected to server — message not sent. Reconnecting now; try again in a moment.",
        isError: true,
        timestamp: Date.now(),
      }]);
      return;
    }

    // The session is now real (a message is going out) — clear the fresh-session guard so a
    // later reconnect reattaches to it normally.
    freshSessionRef.current = false;

    // Build prompt: include attached file if present
    let prompt = input.trim();
    // /skill:<name> slash command → rewrite into a load-and-follow directive. Works on BOTH
    // providers: OpenRouter has use_skill, the Claude path has the Skill tool. The model loads
    // the full playbook itself (so it also gets the skill directory + any sub-files).
    const skillMatch = prompt.match(/^\/skill:([A-Za-z0-9._-]+)\s*(.*)$/s);
    if (skillMatch) {
      const skillName = skillMatch[1];
      const extra = (skillMatch[2] || "").trim();
      prompt = `Load the "${skillName}" skill now (use your skill tool — use_skill / Skill — to fetch its full playbook), then FOLLOW its workflow for our objective. Do not skip steps.` +
        (extra ? `\n\nAdditional context for this run: ${extra}` : "");
    }
    if (attachedFile) {
      const fileContext = `I'm attaching the file \`${attachedFile.name}\`:\n\`\`\`\n${attachedFile.content}\n\`\`\`\nPlease analyze this.`;
      prompt = prompt ? `${prompt}\n\n${fileContext}` : fileContext;
    }

    // Create session if none selected
    let sid = currentSession;
    if (!sid) {
      sid = `s-${Date.now()}`;
      setCurrentSession(sid);
    }

    // Capture turn state BEFORE we flip isStreaming — tells us if this message
    // will be queued by the server (a turn is already running) vs start a turn.
    const wasStreaming = isStreaming;

    // Add user message locally
    const userMsg: Message = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: "user",
      content: prompt,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);
    onLiveSessionChange?.(true);

    // Decide between "chat" (spawn new) vs "followup" (inject into live).
    // Use the authoritative `currentSessionLive` flag — driven by
    // restore-session, session_history, and session_end events — instead of
    // the racy sessions.find() lookup (which can be empty during initial load).
    const sessionIsDead = turnCount > 0 && !currentSessionLive;
    const shouldSpawnNew = turnCount === 0 || sessionIsDead;

    if (shouldSpawnNew) {
      // Check if we're resuming a CLI session
      const resumeId = (window as any).__resumeCliSessionId;
      const resumeCwd = (window as any).__resumeCliCwd;
      if (resumeId) {
        delete (window as any).__resumeCliSessionId;
        delete (window as any).__resumeCliTitle;
        delete (window as any).__resumeCliCwd;
      }

      // If respawning a dead session, embed the recent conversation as context
      // so the new claude knows what we were doing.
      //
      // OpenRouter EXCEPTION (Hermes-parity fix): the OR orchestrator re-seeds the FULL
      // engagement history itself (findings ledger + recent raw turns from the session file
      // on every spawn), so this wrapper is redundant for it. Worse, OR exits after every
      // turn by design (request/response), so `sessionIsDead` is true on essentially every
      // follow-up — meaning this "[your prior process exited… acknowledge briefly]" framing
      // fired on nearly EVERY DeepSeek turn and trained it to open with a status recap and
      // then stall ("Let me verify…:"). For OpenRouter we send the raw prompt and let the
      // orchestrator drive. The claude crash-respawn path is unchanged.
      let finalPrompt = prompt;
      if (sessionIsDead && messages.length > 0 && activeProvider !== "openrouter") {
        const recent = messages.slice(-12).filter((m) => m.role === "user" || m.role === "assistant");
        if (recent.length > 0) {
          const transcript = recent
            .map((m) => `[${m.role.toUpperCase()}]: ${m.content.slice(0, 600)}${m.content.length > 600 ? "..." : ""}`)
            .join("\n\n");
          finalPrompt =
            `[Resuming a previous conversation — your prior process exited. The recent history is below for context. Acknowledge briefly and continue from where we left off.]\n\n` +
            `--- PRIOR CONTEXT ---\n${transcript}\n--- END CONTEXT ---\n\n` +
            `[CURRENT USER MESSAGE]:\n${prompt}`;
        }
      }

      wsRef.current.send(
        JSON.stringify({
          type: "chat",
          sessionId: sid,
          persona,
          permissionMode: chatPermissionMode,
          prompt: finalPrompt,
          ...(resumeId ? { resumeCliSessionId: resumeId, resumeCliCwd: resumeCwd } : {}),
        })
      );
      // Mark this session as live now — a spawn was just kicked off
      setCurrentSessionLive(true);
      setSessions((prev) => prev.map((s) => s.id === sid ? { ...s, running: true } : s));
      // Refresh the session list shortly after — the server creates the persisted
      // session file when claude is spawned, so the sidebar entry appears on next list.
      const refresh = () => wsRef.current?.send(JSON.stringify({ type: "list_sessions" }));
      setTimeout(refresh, 300);
      setTimeout(refresh, 1200);
      setTimeout(refresh, 3000);
    } else {
      // Follow-up message in existing live session
      wsRef.current.send(
        JSON.stringify({
          type: "followup",
          sessionId: sid,
          prompt,
        })
      );
      // If a turn was already running, the server queues this message and
      // injects it when the current turn ends — show a chip so the user knows.
      if (wasStreaming) {
        setQueuedMessages((prev) => [
          ...prev,
          { id: userMsg.id, preview: prompt.slice(0, 40) + (prompt.length > 40 ? "…" : "") },
        ]);
      }
      // Refresh once to update message count badge on the current session entry
      setTimeout(() => wsRef.current?.send(JSON.stringify({ type: "list_sessions" })), 800);
    }

    setTurnCount((c) => c + 1);
    setInput("");
    setAttachedFile(null);
    setFileError(null);
    inputRef.current?.focus();
  }, [input, attachedFile, isStreaming, currentSession, turnCount, persona, permissionMode]);

  // ── Send follow-up (for interactive question buttons) ──
  const handleSendFollowUp = useCallback((text: string) => {
    if (!wsRef.current || !currentSession) return;

    const userMsg: Message = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);

    wsRef.current.send(
      JSON.stringify({
        type: "followup",
        sessionId: currentSession,
        prompt: text,
      })
    );
    setTurnCount((c) => c + 1);
  }, [currentSession]);

  // Stable per-bubble callbacks. These MUST keep a constant identity across renders
  // or React.memo(MessageBubble) can never bail out (inline arrows defeat memo) and
  // every token would re-render all bubbles again.
  const onBubbleOptionClick = useCallback(
    (answer: string) => handleSendFollowUp(`I choose: ${answer}`),
    [handleSendFollowUp]
  );
  const onBubbleSuggestEdit = useCallback(
    (code: string) => handleSendFollowUp(`Suggest improvements to this code:\n\`\`\`\n${code}\n\`\`\``),
    [handleSendFollowUp]
  );
  const onBubbleExplain = useCallback(
    (code: string, language: string) => handleExplainCode(code, language),
    [handleExplainCode]
  );

  // ── Mid-conversation provider switch ──
  // Sends switch_provider to the server, which sets a per-session override and ends the live
  // backend; the next message resurrects on the chosen provider (seeded from history).
  const switchProvider = useCallback((provider: "anthropic" | "openrouter" | "openai-codex" | "gemini" | "xai-grok", model: string) => {
    if (!wsRef.current || !currentSession || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ type: "switch_provider", sessionId: currentSession, provider, model }));
    setActiveProvider(provider);
    setShowSwitcher(false);
  }, [currentSession]);

  // Lazy-load the OpenRouter catalog when the switcher first opens.
  useEffect(() => {
    if (showSwitcher && orModels.length === 0) {
      fetch("/api/openrouter/models").then((r) => r.json()).then((j) => setOrModels(j.models || [])).catch(() => {});
    }
  }, [showSwitcher, orModels.length]);

  // ── Stop session (hard kill — used by the close-with-memory flow) ──
  const stopSession = useCallback(() => {
    if (wsRef.current && currentSession) {
      wsRef.current.send(JSON.stringify({ type: "stop", sessionId: currentSession }));
    }
    setIsStreaming(false);
  }, [currentSession]);

  // ── Graceful interrupt — cancel the current turn but keep the session/process
  // alive. Optionally "steer" by passing a new prompt that runs once the
  // interrupted turn unwinds. Does NOT kill the process (unlike stopSession).
  const interruptTurn = useCallback((newPrompt?: string) => {
    if (wsRef.current && currentSession) {
      // Record the user-initiated stop so the resulting interrupted-turn event renders as
      // "Stopped by user" rather than the generic "turn interrupted".
      userInterruptRef.current = { sessionId: currentSession, at: Date.now() };
      wsRef.current.send(JSON.stringify({
        type: "interrupt",
        sessionId: currentSession,
        ...(newPrompt ? { newPrompt } : {}),
      }));
    }
  }, [currentSession]);

  // When set, the next "result" event for the current session triggers an auto-stop.
  // Used by the Close-with-Memory-Check flow.
  const closeAfterMemoryRef = useRef<string | null>(null);
  // Optional: a callback to run after the memory check + stop completes (e.g. delete the session)
  const postCloseActionRef = useRef<(() => void) | null>(null);

  // Close session: send a memory-check prompt as a final follow-up, then stop the process
  // once Claude finishes responding. Use this on UI "Close Session" or before deleting.
  const closeSessionWithMemoryCheck = useCallback((targetSessionId?: string, afterStop?: () => void) => {
    const sid = targetSessionId || currentSession;
    if (!sid || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      // No live session — just run the after-stop action if any
      afterStop?.();
      return;
    }

    const sessionInfo = sessions.find((s) => s.id === sid);
    if (!sessionInfo?.running) {
      // Session is already stopped — skip the memory check
      afterStop?.();
      return;
    }

    // Add a visible user message announcing the close so the user can see what's happening
    if (sid === currentSession) {
      setMessages((prev) => [
        ...prev,
        {
          id: `close-${Date.now()}`,
          role: "system",
          content: "🔒 Closing session — checking for memory-worthy facts to persist before shutdown...",
          timestamp: Date.now(),
        },
      ]);
    }

    // Memory-check prompt (same text the old Stop hook used)
    const memoryPrompt =
      "Before this session closes, check if any new facts were learned that should be persisted. " +
      "If the user shared new preferences, if we discovered new credentials/attack paths, or if " +
      "important lessons were learned, use the Edit tool to append them to ~/.hermes/memories/USER.md " +
      "(for preferences, separated by §) or ~/.hermes/memories/MEMORY.md (for facts, separated by §). " +
      "These memories are shared with Hermes. If nothing notable was learned, just say 'No facts to persist.'";

    closeAfterMemoryRef.current = sid;
    postCloseActionRef.current = afterStop || null;
    setIsStreaming(true);
    onLiveSessionChange?.(true);

    wsRef.current.send(
      JSON.stringify({
        type: "followup",
        sessionId: sid,
        prompt: memoryPrompt,
      })
    );
  }, [currentSession, sessions, onLiveSessionChange]);

  // ── Key handler ──
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage]
  );

  // ── Header action handlers ───────────────────────────────────────
  // Extracted from the header JSX so the action buttons share one implementation
  // (no duplicated logic) across the desktop and mobile header layouts.

  // Toggle the engagement file/loot side panel; on open, fetch the engagement root + loot.
  const handleToggleProjectPanel = () => {
    const newState = !showProjectPanel;
    setShowProjectPanel(newState);
    // When opening, fetch the engagement root immediately
    if (newState && detectedProject) {
      const root = `/root/htb/boxes/${detectedProject}`;
      browseProjectPath(root);
      // Also kick off loot enumeration (sibling)
      fetch(`/api/files/list?path=${encodeURIComponent(root + "/loot")}`)
        .then((r) => r.json())
        .then((d) => setProjectLoot((d.entries || []).map((e: any) => e.name)))
        .catch(() => setProjectLoot([]));
    }
  };

  // Toggle the embedded terminal pane.
  const handleToggleTerminal = () => {
    setShowTerminal((v) => !v);
  };

  // Summon the Council of 6 AIs for the current engagement (routes a prompt to the session).
  const handleSummonCouncil = () => {
    // Auto-detect engagement directory from recent tool_use messages, or use generic prompt
    const summonPrompt = detectedProject
      ? `Summon the Council of 6 AIs for engagement '${detectedProject}'. Follow the mandatory detach+poll pattern from SOUL.md — launch with setsid/nohup, poll for completion every 30s, do NOT do other work in parallel while waiting.`
      : `Summon the Council of 6 AIs. Briefing: tell me what engagement directory to use, then follow the mandatory detach+poll pattern from SOUL.md.`;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}`,
        role: "system",
        content: "⚠️ Not connected — wait for reconnect before summoning council.",
        isError: true,
        timestamp: Date.now(),
      }]);
      return;
    }
    // Add user message locally, route to current session
    const userMsg: Message = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: "user",
      content: "🏛️ Summon the Council of AIs",
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsStreaming(true);
    onLiveSessionChange?.(true);
    let sid = currentSession;
    if (!sid) {
      sid = `s-${Date.now()}`;
      setCurrentSession(sid);
    }
    if (turnCount === 0) {
      wsRef.current.send(JSON.stringify({
        type: "chat",
        sessionId: sid,
        persona,
        permissionMode,
        prompt: summonPrompt,
      }));
    } else {
      wsRef.current.send(JSON.stringify({
        type: "followup",
        sessionId: sid,
        prompt: summonPrompt,
      }));
    }
    setTurnCount(t => t + 1);
  };

  // Close the current session with a server-side memory pass, then release it from the sidebar.
  const handleCloseSession = () => {
    const sid = currentSession!;
    // Server-side close-with-memory + delete. This survives client
    // disconnect — even if you navigate away from COMMS while Claude
    // is doing the memory pass, the server still kills + deletes.
    try {
      wsRef.current?.send(JSON.stringify({
        type: "close_with_memory",
        sessionId: sid,
        deleteAfter: true,
      }));
    } catch {}
    // Optimistic local removal so the sidebar updates immediately
    setSessions((prev) => prev.filter((s) => s.id !== sid));
    if (currentSession === sid) {
      setCurrentSession(null);
      setMessages([]);
      setContextTokens(0);
    }
    // Show a brief notice in the chat so user knows what's happening
    setMessages((prev) => [...prev, {
      id: `close-${Date.now()}`,
      role: "system",
      content: "🔒 Closing session — Claude is saving any new facts to memory before shutdown. Safe to navigate away.",
      timestamp: Date.now(),
    }]);
  };

  // Start a fresh session (stopping the current stream first if one is running).
  const handleNewSession = () => {
    if (isStreaming) stopSession();
    createNewSession();
  };

  // ── Nav-driven session control ───────────────────────────────────
  // Report the active session id up so the navigation can highlight it.
  useEffect(() => {
    onActiveSessionChange?.(currentSession);
  }, [currentSession, onActiveSessionChange]);

  // The nav asked to open a specific session (nonce changes per request).
  const lastRequestedNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!requestedSession) return;
    if (lastRequestedNonce.current === requestedSession.nonce) return;
    lastRequestedNonce.current = requestedSession.nonce;
    if (requestedSession.id && requestedSession.id !== currentSessionRef.current) {
      switchSession(requestedSession.id);
    }
  }, [requestedSession, switchSession]);

  // The nav asked to start a fresh session. A boolean flag (not a nonce) is used so the intent
  // SURVIVES a ChatPage remount: clicking "+ New" from another tab remounts this component, and a
  // remount-initialized nonce ref would look "already handled" — leaving the last session restored
  // (the bug). This effect fires on mount too, so the fresh session is created either way.
  useEffect(() => {
    if (!pendingNewSession) return;
    handleNewSession();
    onNewSessionConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNewSession]);

  // Shared body for the provider/model switcher — used by BOTH the desktop popover and the
  // mobile overflow menu so the two never drift.
  const renderSwitcherBody = () => (
    <>
      <div style={{ fontSize: 9, color: "var(--text-muted)", marginBottom: 6, fontFamily: "monospace" }}>
        SWITCH THIS CHAT — applies on your next message
      </div>
      <button
        onClick={() => { switchProvider("anthropic", "claude-opus-4-8"); setShowSwitcher(false); setShowHeaderMenu(false); }}
        style={{
          display: "block", width: "100%", textAlign: "left", marginBottom: 8,
          fontSize: 11, padding: "6px 8px", borderRadius: 4, cursor: "pointer",
          border: "1px solid rgba(182,242,58,0.3)", background: "rgba(182,242,58,0.06)",
          color: "var(--jarvis-blue)", fontFamily: "monospace",
        }}
      >
        ← Anthropic (claude-opus-4-8, subscription)
      </button>
      <button
        onClick={() => { switchProvider("openai-codex", "gpt-5.5"); setShowSwitcher(false); setShowHeaderMenu(false); }}
        style={{
          display: "block", width: "100%", textAlign: "left", marginBottom: 8,
          fontSize: 11, padding: "6px 8px", borderRadius: 4, cursor: "pointer",
          border: "1px solid rgba(182,242,58,0.35)", background: "rgba(182,242,58,0.07)",
          color: "var(--neon-green, #b6f23a)", fontFamily: "monospace",
        }}
      >
        ⌬ OpenAI Codex (gpt-5.5, ChatGPT subscription)
      </button>
      <button
        onClick={() => { switchProvider("gemini", "gemini-3.5-flash"); setShowSwitcher(false); setShowHeaderMenu(false); }}
        style={{
          display: "block", width: "100%", textAlign: "left", marginBottom: 8,
          fontSize: 11, padding: "6px 8px", borderRadius: 4, cursor: "pointer",
          border: "1px solid rgba(182,242,58,0.35)", background: "rgba(182,242,58,0.07)",
          color: "var(--neon-green, #b6f23a)", fontFamily: "monospace",
        }}
      >
        ✦ Google Gemini (gemini-3.5-flash, BLOCK_NONE)
      </button>
      <button
        onClick={() => { switchProvider("xai-grok", "grok-4.5"); setShowSwitcher(false); setShowHeaderMenu(false); }}
        style={{
          display: "block", width: "100%", textAlign: "left", marginBottom: 8,
          fontSize: 11, padding: "6px 8px", borderRadius: 4, cursor: "pointer",
          border: "1px solid rgba(43,212,127,0.4)", background: "rgba(43,212,127,0.07)",
          color: "var(--neon-green, #2bd47f)", fontFamily: "monospace",
        }}
      >
        ◉ Grok Build (OAuth ACP · grok-4.5)
      </button>
      <div style={{ fontSize: 9, color: "var(--text-muted)", margin: "2px 0 4px", fontFamily: "monospace" }}>
        OpenRouter model ({orModels.length || "…"} available):
      </div>
      <div style={{ marginBottom: 6 }}>
        <CyberDropdown
          searchable fullWidth size="sm"
          value={switchModel}
          onChange={setSwitchModel}
          options={orModels.map((m) => ({ id: m.id, label: m.id, desc: m.context_length ? Math.round(m.context_length / 1000) + "k ctx" : undefined }))}
          placeholder="openrouter model slug…"
          accent="var(--neon-amber, #ffae42)"
        />
      </div>
      <button
        disabled={!switchModel.trim()}
        onClick={() => { switchProvider("openrouter", switchModel.trim()); setShowSwitcher(false); setShowHeaderMenu(false); }}
        style={{
          width: "100%", fontSize: 11, padding: "6px 8px", borderRadius: 4,
          border: "1px solid rgba(255,174,66,0.5)",
          background: switchModel.trim() ? "rgba(255,174,66,0.15)" : "transparent",
          color: switchModel.trim() ? "var(--neon-amber, #ffae42)" : "var(--text-muted)",
          cursor: switchModel.trim() ? "pointer" : "default", fontWeight: 700, fontFamily: "monospace",
        }}
      >
        → Switch to OpenRouter
      </button>
    </>
  );

  // Row style for the mobile "⋯" overflow-menu items.
  const menuItemStyle = (active: boolean, color?: string): CSSProperties => ({
    display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
    fontSize: 13, padding: "9px 11px", borderRadius: 6, cursor: "pointer", fontFamily: "monospace",
    fontWeight: 600, lineHeight: 1.1,
    border: `1px solid ${active ? "rgba(182,242,58,0.4)" : "rgba(255,255,255,0.07)"}`,
    background: active ? "rgba(182,242,58,0.1)" : "rgba(255,255,255,0.02)",
    color: color || "var(--text-bright, #d7e6f5)",
  });

  // ── Render ──
  return (
    <div className="flex h-full">
      {/* Session sidebar — toggle via header button */}
      {false && (/* sidebar removed — sessions live in the app nav */
      <div
        className="w-52 shrink-0 flex flex-col overflow-hidden"
        style={{
          background: "var(--bg-surface)",
          borderRight: "1px solid var(--border-color)",
        }}
      >
        {/* New session button */}
        <div className="p-2" style={{ borderBottom: "1px solid var(--border-color)" }}>
          <button
            onClick={createNewSession}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded text-xs font-medium transition-all hover:opacity-90"
            style={{
              background: "rgba(43,212,127, 0.1)",
              border: "1px solid rgba(43,212,127, 0.25)",
              color: "var(--neon-green)",
            }}
          >
            <span className="text-sm">+</span> New Session
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto py-1">
          {sessions.length === 0 && (
            <p className="text-[11px] px-3 py-4 text-center" style={{ color: "var(--text-muted)" }}>
              No sessions yet
            </p>
          )}
          {sessions.map((s) => {
            const totalTokens = s.totalInputTokens + s.totalOutputTokens + s.totalCacheRead;
            const tokenDisplay = totalTokens > 1000
              ? `${(totalTokens / 1000).toFixed(1)}K`
              : `${totalTokens}`;
            return (
              <div
                key={s.id}
                className={`session-item group relative px-3 py-2.5 cursor-pointer ${
                  currentSession === s.id ? "active" : ""
                }`}
                onClick={() => switchSession(s.id)}
              >
                <div className="flex items-center gap-1.5 mb-0.5">
                  {(s.running || busySessions.has(s.id)) && (
                    <span
                      className="pulse-dot w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: "var(--neon-green)" }}
                      title="Session is currently running"
                    />
                  )}
                  <span
                    className="text-[10px] uppercase tracking-wide font-medium truncate flex-1"
                    style={{ color: currentSession === s.id ? "var(--neon-green)" : "var(--text-dim)" }}
                  >
                    {s.persona || "session"}
                  </span>
                  {/* Unread badge — new activity in a session not currently viewed */}
                  {unreadSessions.has(s.id) && currentSession !== s.id && (
                    <span
                      style={{
                        fontSize: 8,
                        padding: "1px 5px",
                        borderRadius: 6,
                        background: "var(--neon-cyan, #b6f23a)",
                        color: "#000",
                        fontWeight: 700,
                        letterSpacing: "0.04em",
                      }}
                      title="New activity in this session"
                    >
                      NEW
                    </span>
                  )}
                  {/* Delete button — visible on hover */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(s.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-1 rounded"
                    style={{ color: "var(--neon-red, #ff4d63)" }}
                    title="Delete session"
                  >
                    ✕
                  </button>
                </div>
                <p
                  className="text-[11px] truncate leading-tight"
                  style={{ color: "var(--text-muted)" }}
                >
                  {s.preview || "Empty session"}
                </p>
                {/* Token / context info */}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] font-cyber" style={{ color: "var(--text-muted)" }}>
                    {s.messageCount} msgs
                  </span>
                  {totalTokens > 0 && (
                    <span className="text-[9px] font-cyber" style={{ color: "var(--neon-cyan)", opacity: 0.6 }}>
                      {tokenDisplay} tok
                    </span>
                  )}
                  {s.model && (
                    <span className="text-[9px] font-cyber" style={{ color: "var(--text-muted)" }}>
                      {s.model.replace("claude-", "").replace("-20", "")}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* Chat area + optional project panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main chat column */}
        <div className="flex-1 flex flex-col overflow-hidden" style={{ minWidth: 0, position: "relative" }}>
        {/* Chat header — classy messenger bar; the session list now lives in the app nav */}
        <div
          className="chat-topbar shrink-0"
          style={{
            display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
            background: "var(--bg-surface)", borderBottom: "1px solid var(--border-color)",
          }}
        >
          {/* conversation avatar */}
          <div className="msg-ava" style={{ width: 34, height: 34 }}>
            <img src="/smallLogo.png" alt="" />
          </div>
          {/* title + subtle status line */}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 14, fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                {(sessions.find((s) => s.id === currentSession)?.title || "").trim() || sessions.find((s) => s.id === currentSession)?.persona || persona}
              </span>
              {currentSessionLive && (
                <span className="pulse-dot" style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--neon-green)", flexShrink: 0 }} title="Live session" />
              )}
            </div>
            <div style={{ fontSize: 11, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              color: !wsConnected ? "var(--neon-red, #ff4d63)" : isStreaming ? "var(--neon-cyan)" : "var(--text-muted)" }}>
              {!wsConnected
                ? "reconnecting…"
                : isStreaming
                  ? `${persona} is typing…`
                  : (activeProvider === "openrouter"
                      ? ((activeModel.includes("/") ? activeModel.split("/")[1] : activeModel) || "OpenRouter")
                      : activeProvider === "openai-codex"
                        ? `Codex${activeModel ? " · " + activeModel : ""}`
                        : activeProvider === "gemini"
                          ? `Gemini${activeModel ? " · " + activeModel : ""}`
                          : activeProvider === "xai-grok"
                            ? `Grok ACP${activeModel ? " · " + activeModel : ""}`
                          : "Anthropic")}
            </div>
          </div>
          {/* streaming → single Stop control */}
          {isStreaming && (
            <button
              onClick={() => interruptTurn()}
              title="Stop the current turn (keeps the session alive)"
              style={{ fontSize: 12, padding: "5px 13px", borderRadius: 999, border: "1px solid rgba(255,174,66,0.5)", background: "rgba(255,174,66,0.12)", color: "var(--neon-amber, #ffae42)", cursor: "pointer", flexShrink: 0, fontWeight: 600 }}
            >
              ⏸ Stop
            </button>
          )}
          {/* overflow menu — all secondary controls collapse here so the bar stays clean */}
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button
              onClick={() => setShowHeaderMenu((v) => !v)}
              aria-label="More actions" title="More"
              style={{ fontSize: 18, lineHeight: 1, padding: "3px 11px", borderRadius: 8, border: "1px solid var(--border-color)", background: showHeaderMenu ? "rgba(182,242,58,0.12)" : "transparent", color: "var(--text-primary)", cursor: "pointer" }}
            >
              ⋯
            </button>
            {showHeaderMenu && (
              <>
                <div onClick={() => setShowHeaderMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 55 }} />
                <div style={{ position: "absolute", top: "130%", right: 0, zIndex: 56, width: 250, maxWidth: "82vw", padding: 8, borderRadius: 10, background: "#161c27", border: "1px solid rgba(182,242,58,0.22)", boxShadow: "0 12px 30px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", gap: 5 }}>
                  {detectedProject && (
                    <button style={menuItemStyle(showProjectPanel, "var(--jarvis-blue)")} onClick={() => { handleToggleProjectPanel(); setShowHeaderMenu(false); }}>
                      📁 {detectedProject}
                    </button>
                  )}
                  <button style={menuItemStyle(showTerminal, showTerminal ? "var(--neon-green)" : undefined)} onClick={() => { handleToggleTerminal(); setShowHeaderMenu(false); }}>
                    ▪ {showTerminal ? "Hide terminal" : "Terminal"}
                  </button>
                  <button style={menuItemStyle(false, "#b07cff")} onClick={() => { handleSummonCouncil(); setShowHeaderMenu(false); }}>
                    🏛️ Summon Council
                  </button>
                  {currentSession && messages.length > 0 && (
                    <>
                      <button style={menuItemStyle(false)} onClick={() => { handleNewSession(); setShowHeaderMenu(false); }}>
                        + New session
                      </button>
                      {sessions.find((s) => s.id === currentSession)?.running && (
                        <button style={menuItemStyle(false, "#b07cff")} onClick={() => { handleCloseSession(); setShowHeaderMenu(false); }}>
                          🔒 Close session
                        </button>
                      )}
                    </>
                  )}
                  <button style={menuItemStyle(false)} title="Permission mode for the next spawned session"
                    onClick={() => { const modes = ["default", "auto", "plan", "acceptEdits", "bypassPermissions"]; const idx = modes.indexOf(chatPermissionMode); setChatPermissionMode(modes[(idx + 1) % modes.length]); }}>
                    ⚙ Mode: {chatPermissionMode === "bypassPermissions" ? "yolo" : chatPermissionMode}
                  </button>
                  {currentSession && (
                    <button style={menuItemStyle(false)} title={currentSession}
                      onClick={async () => { await copyToClipboard(currentSession); setShowHeaderMenu(false); }}>
                      ⧉ Copy session id
                    </button>
                  )}
                  {contextTokens > 0 && (
                    <div style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", padding: "2px 8px 4px" }}>
                      context · {(contextTokens / 1000).toFixed(1)}K tokens
                    </div>
                  )}
                  {currentSession && (
                    <div style={{ marginTop: 4, paddingTop: 7, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                      {renderSwitcherBody()}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Phase 7.1: observe-only Agent Run banner (only shows when a run is attached) */}
        {attachedRun && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "3px 14px", fontSize: 11,
            background: "rgba(255,174,66,0.08)", borderBottom: "1px solid rgba(255,174,66,0.18)", color: "#ffae42",
          }}>
            <span>⬡ Agent Run active · observe-only</span>
            <a
              onClick={() => { window.location.hash = "cockpit"; }}
              style={{ color: "#ffae42", textDecoration: "underline", cursor: "pointer" }}
              title={`Run ${attachedRun.runId}`}
            >
              View in Cockpit
            </a>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto chat-scroll" ref={messagesContainerRef} onScroll={handleMessagesScroll} style={{ display: "flex", flexDirection: "column-reverse" }}>
          <div className="px-4 py-4 space-y-3">
          {messages.length === 0 && !isStreaming && (
            <div className="flex items-center justify-center h-full" style={{ color: "var(--text-muted)" }}>
              <div className="text-center">
                <p className="text-5xl mb-4 opacity-40">{"\u{1F480}"}</p>
                <p className="text-base matrix-title font-bold mb-1">ChillsPwn Ready</p>
                <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                  Send a message to start a session
                </p>
              </div>
            </div>
          )}

          {/* Restored session banner — show Continue button when session was dead */}
          {messages.length > 0 && !isStreaming && currentSession && (window as any).__restoreContextSummary && (
            <div style={{
              padding: "8px 12px",
              borderRadius: 6,
              background: "rgba(182,242,58,0.06)",
              border: "1px solid rgba(182,242,58,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}>
              <div>
                <span style={{ fontSize: 10, color: "var(--jarvis-blue)", fontWeight: 700 }}>
                  Session restored from history
                </span>
                <span style={{ fontSize: 9, color: "var(--text-muted)", marginLeft: 8 }}>
                  {messages.length} messages loaded
                </span>
              </div>
              <button
                onClick={() => {
                  const summary = (window as any).__restoreContextSummary;
                  delete (window as any).__restoreContextSummary;
                  if (!wsRef.current || !currentSession) return;

                  // Check if session is live — if so, send followup; if dead, start a new claude process
                  const session = sessions.find(s => s.id === currentSession);
                  if (session?.running) {
                    handleSendFollowUp("Continue where we left off.");
                  } else {
                    // Dead session — spawn a new claude process with context summary
                    const continuePrompt = summary
                      ? `${summary}\n\nUser has reconnected. Continue where we left off.`
                      : "Continue where we left off.";
                    const userMsg: Message = {
                      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                      role: "user",
                      content: "Continue where we left off.",
                      timestamp: Date.now(),
                    };
                    setMessages(prev => [...prev, userMsg]);
                    setIsStreaming(true);
                    onLiveSessionChange?.(true);
                    wsRef.current.send(JSON.stringify({
                      type: "chat",
                      sessionId: currentSession,
                      persona,
                      permissionMode,
                      prompt: continuePrompt,
                    }));
                    setTurnCount(1);
                  }
                }}
                style={{
                  fontSize: 9, padding: "4px 12px", borderRadius: 4,
                  background: "rgba(182,242,58,0.15)",
                  border: "1px solid rgba(182,242,58,0.3)",
                  color: "var(--jarvis-blue)", cursor: "pointer", fontWeight: 700,
                }}
              >
                Continue
              </button>
            </div>
          )}

          {hasMoreHistory && messages.length > 0 && (
            <div className="flex justify-center py-2">
              <button
                type="button"
                onClick={() => {
                  wsRef.current?.send(JSON.stringify({
                    type: "load_older",
                    sessionId: currentSessionRef.current,
                    before: messagesRef.current.length,
                  }));
                }}
                style={{
                  fontSize: 11, fontFamily: "monospace", padding: "5px 14px", borderRadius: 999,
                  border: "1px solid rgba(182,242,58,0.35)", background: "rgba(182,242,58,0.06)",
                  color: "var(--jarvis-blue)", cursor: "pointer",
                }}
              >
                ↑ Load older messages ({Math.max(0, totalHistory - messages.length)} more)
              </button>
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble
              key={msg.id}
              msg={msg}
              prevRole={i > 0 ? messages[i - 1].role : null}
              nextRole={i < messages.length - 1 ? messages[i + 1].role : null}
              onOptionClick={onBubbleOptionClick}
              onSuggestEdit={onBubbleSuggestEdit}
              onExplain={onBubbleExplain}
              onRunInTerminal={runInTerminal}
            />
          ))}

          {isStreaming && !messages.some((m) => m.streaming) && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="msg-animate flex justify-start">
              <div
                className="msg-assistant rounded-lg px-4 py-3 max-w-[85%]"
              >
                <span
                  className="streaming-indicator text-xs font-cyber"
                  style={{ color: "var(--neon-green)" }}
                >
                  {currentActivity || "Processing"}
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Floating "jump to latest" pill — only when scrolled away from bottom */}
        {!atBottom && messages.length > 0 && (
          <button
            type="button"
            onClick={() => scrollToBottom()}
            aria-label="Jump to latest message"
            style={{
              position: "absolute",
              bottom: 90,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 30,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.02em",
              cursor: "pointer",
              fontFamily: "inherit",
              color: "var(--jarvis-blue)",
              background: "rgba(10, 14, 20, 0.9)",
              border: "1px solid var(--jarvis-blue)",
              boxShadow: "0 0 14px rgba(182,242,58, 0.4), 0 4px 16px rgba(0,0,0,0.5)",
              backdropFilter: "blur(6px)",
              WebkitTapHighlightColor: "transparent",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--jarvis-blue)";
              e.currentTarget.style.color = "var(--bg-dark, #0a0e14)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(10, 14, 20, 0.9)";
              e.currentTarget.style.color = "var(--jarvis-blue)";
            }}
          >
            <span style={{ fontSize: 14, lineHeight: 1 }}>↓</span> Jump to latest
          </button>
        )}

        {/* Input area */}
        <div
          className="px-4 py-3 shrink-0"
          style={{
            background: "var(--bg-surface)",
            borderTop: "1px solid var(--border-color)",
          }}
        >
          {/* Queued follow-ups (sent mid-turn; injected when the turn ends) */}
          {queuedMessages.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {queuedMessages.map((q, i) => (
                <span
                  key={q.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
                  style={{
                    background: "rgba(255,174,66, 0.1)",
                    border: "1px solid rgba(255,174,66, 0.3)",
                    color: "var(--neon-amber, #ffae42)",
                  }}
                  title="Queued — will run after the current turn"
                >
                  {"⏳"} {q.preview}
                  <button
                    onClick={() => {
                      setQueuedMessages((prev) => prev.filter((_, idx) => idx !== i));
                      wsRef.current?.send(JSON.stringify({ type: "cancel_queued", sessionId: currentSession, index: i }));
                    }}
                    className="ml-1 hover:opacity-80"
                    style={{ color: "var(--neon-red, #ff4d63)" }}
                  >
                    {"✕"}
                  </button>
                </span>
              ))}
            </div>
          )}
          {/* Attached file pill */}
          {attachedFile && (
            <div className="mb-2 flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
                style={{
                  background: "rgba(182,242,58, 0.1)",
                  border: "1px solid rgba(182,242,58, 0.3)",
                  color: "var(--neon-cyan, #b6f23a)",
                }}
              >
                {"📎"} {attachedFile.name} ({(attachedFile.size / 1024).toFixed(1)}KB)
                <button
                  onClick={() => { setAttachedFile(null); setFileError(null); }}
                  className="ml-1 hover:opacity-80"
                  style={{ color: "var(--neon-red, #ff4d63)" }}
                >
                  {"✕"}
                </button>
              </span>
            </div>
          )}
          {/* File error */}
          {fileError && (
            <div className="mb-2">
              <span className="text-[11px] font-medium" style={{ color: "var(--neon-red, #ff4d63)" }}>
                {fileError}
              </span>
            </div>
          )}
          <div className="flex gap-2 items-end">
            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept={[...ALLOWED_TEXT_EXTENSIONS].map(ext => `.${ext}`).join(",")}
              onChange={handleFileSelect}
            />
            {/* Paperclip upload button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-2.5 py-2.5 rounded-lg text-base transition-all"
              style={{
                background: "var(--bg-panel)",
                border: "1px solid var(--border-color)",
                color: "var(--text-dim)",
              }}
              title="Attach file"
            >
              {"📎"}
            </button>
            <div style={{ position: "relative", flex: 1 }}>
              {/* Terminal-style prompt prefix — ChillsPwn input has a cyber prompt symbol */}
              <span
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: 14,
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  color: isStreaming ? "var(--neon-amber, #ffae42)" : "var(--neon-green, #2bd47f)",
                  pointerEvents: "none",
                  fontWeight: 700,
                  textShadow: isStreaming
                    ? "0 0 6px rgba(255,174,66,0.6)"
                    : "0 0 6px rgba(43,212,127,0.6)",
                  zIndex: 1,
                  animation: isStreaming ? "pulse-green 1.4s ease-in-out infinite" : "none",
                }}
              >
                {isStreaming ? "⌛" : "▸"}
              </span>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  // Show slash menu when typing /
                  if (e.target.value === "/") {
                    setShowSlashMenu(true);
                    setSlashFilter("");
                  } else if (e.target.value.startsWith("/") && !e.target.value.includes(" ")) {
                    setShowSlashMenu(true);
                    setSlashFilter(e.target.value.slice(1).toLowerCase());
                  } else {
                    setShowSlashMenu(false);
                  }
                }}
                onKeyDown={(e) => {
                  if (showSlashMenu && e.key === "Escape") {
                    setShowSlashMenu(false);
                    return;
                  }
                  handleKeyDown(e);
                }}
                placeholder={isStreaming ? `${persona} is working — Enter to queue, or use ↯ Interrupt & Send` : `Message ${persona}…  (type / for commands)`}
                rows={1}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className="cyber-input w-full rounded-lg resize-none"
                style={{
                  background: "linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(14,18,30,0.8) 100%)",
                  border: `1px solid ${isStreaming ? "rgba(255,174,66,0.3)" : "rgba(182,242,58,0.25)"}`,
                  color: "var(--text-primary)",
                  padding: "10px 14px 10px 34px",
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  fontSize: 13,
                  lineHeight: 1.5,
                  letterSpacing: "0.01em",
                  caretColor: "var(--neon-green, #2bd47f)",
                  boxShadow: isStreaming
                    ? "inset 0 0 0 1px rgba(255,174,66,0.1), 0 0 12px rgba(255,174,66,0.08)"
                    : "inset 0 0 0 1px rgba(182,242,58,0.06), 0 0 12px rgba(182,242,58,0.05)",
                }}
              />
              {/* Slash command menu */}
              {showSlashMenu && (
                <div style={{
                  position: "absolute",
                  bottom: "100%",
                  left: 0,
                  right: 0,
                  marginBottom: 4,
                  background: "#0a0e14",
                  border: "1px solid var(--border-bright)",
                  borderRadius: 6,
                  maxHeight: 200,
                  overflowY: "auto",
                  boxShadow: "0 -4px 20px rgba(0,0,0,0.3)",
                  zIndex: 100,
                }}>
                  {[
                    // Claude Code built-in commands
                    { cmd: "/batch", desc: "Run a batch of prompts from a file", cat: "tools" },
                    { cmd: "/claude-api", desc: "Build, debug, and optimize Claude API apps", cat: "dev" },
                    { cmd: "/clear", desc: "Clear conversation and start fresh", cat: "session" },
                    { cmd: "/code-review", desc: "Review code for bugs and improvements", cat: "dev" },
                    { cmd: "/compact", desc: "Compress conversation to save context", cat: "session" },
                    { cmd: "/context", desc: "Show current context window usage", cat: "session" },
                    { cmd: "/debug", desc: "Debug an issue interactively", cat: "dev" },
                    { cmd: "/extra-usage", desc: "Show extra/overage usage details", cat: "info" },
                    { cmd: "/fewer-permission-prompts", desc: "Scan and reduce permission prompts", cat: "config" },
                    { cmd: "/goal", desc: "Set a standing objective for autonomous operation", cat: "session" },
                    { cmd: "/heapdump", desc: "Generate a heap dump for debugging", cat: "tools" },
                    { cmd: "/init", desc: "Initialize CLAUDE.md project documentation", cat: "dev" },
                    { cmd: "/insights", desc: "Show token/cost/activity analytics", cat: "info" },
                    { cmd: "/loop", desc: "Run a command on a recurring interval", cat: "tools" },
                    { cmd: "/reload-skills", desc: "Reload all skills from disk", cat: "config" },
                    { cmd: "/review", desc: "Review a pull request", cat: "dev" },
                    { cmd: "/run", desc: "Launch and run the project app", cat: "dev" },
                    { cmd: "/run-skill-generator", desc: "Generate a new skill interactively", cat: "tools" },
                    { cmd: "/schedule", desc: "Create a scheduled remote agent routine", cat: "tools" },
                    { cmd: "/security-review", desc: "Security review of pending changes", cat: "dev" },
                    { cmd: "/simplify", desc: "Review current diff and apply fixes", cat: "dev" },
                    { cmd: "/team-onboarding", desc: "Onboard a new team member", cat: "tools" },
                    { cmd: "/update-config", desc: "Configure Claude Code settings and hooks", cat: "config" },
                    { cmd: "/usage", desc: "Show current session usage stats", cat: "info" },
                    { cmd: "/usage-credits", desc: "Show credit balance and usage", cat: "info" },
                    { cmd: "/verify", desc: "Verify a code change works correctly", cat: "dev" },
                    // ChillsPwn custom commands
                    { cmd: "/cpwn:memory", desc: "View/edit shared memory (USER.md + MEMORY.md)", cat: "cpwn" },
                    { cmd: "/cpwn:status", desc: "Show ChillsPwn agent status", cat: "cpwn" },
                    { cmd: "/cpwn:kanban", desc: "Manage kanban task board", cat: "cpwn" },
                    { cmd: "/cpwn:cron", desc: "Manage scheduled monitoring jobs", cat: "cpwn" },
                    // Skills — /skill:<name> loads that skill's playbook (works on both providers)
                    ...availableSkills.map((s) => ({ cmd: "/skill:" + s.name, desc: s.description, cat: "skill" })),
                  ]
                    .filter((c: any) => !slashFilter || c.cmd.slice(1).includes(slashFilter))
                    .map((c: any) => {
                      const catColors: Record<string, string> = {
                        dev: "#b6f23a", session: "#2bd47f", tools: "#ffae42",
                        info: "#b07cff", config: "#9aa6b6", cpwn: "#ff8844", skill: "#b6f23a",
                      };
                      return (
                        <button
                          key={c.cmd}
                          onClick={() => {
                            setInput(c.cmd + " ");
                            setShowSlashMenu(false);
                            inputRef.current?.focus();
                          }}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            padding: "5px 10px",
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            background: "transparent",
                            border: "none",
                            borderBottom: "1px solid rgba(182,242,58,0.04)",
                            color: "inherit",
                            cursor: "pointer",
                            transition: "background 0.1s",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(182,242,58,0.06)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                        >
                          <span style={{ fontSize: 10, fontFamily: "monospace", color: "var(--jarvis-blue)", fontWeight: 700, minWidth: 130 }}>{c.cmd}</span>
                          <span style={{ fontSize: 9, color: "var(--text-dim)", flex: 1 }}>{c.desc}</span>
                          <span style={{ fontSize: 7, padding: "1px 4px", borderRadius: 2, background: `${catColors[c.cat] || "#9aa6b6"}15`, color: catColors[c.cat] || "#9aa6b6", border: `1px solid ${catColors[c.cat] || "#9aa6b6"}30`, textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>{c.cat}</span>
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
            <button
              onClick={sendMessage}
              disabled={(!input.trim() && !attachedFile) || !wsConnected}
              className="px-4 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-30"
              style={{
                background: !wsConnected
                  ? "rgba(255,77,99, 0.1)"
                  : (input.trim() || attachedFile)
                    ? "rgba(43,212,127, 0.15)"
                    : "var(--bg-panel)",
                border: !wsConnected
                  ? "1px solid rgba(255,77,99, 0.4)"
                  : `1px solid ${(input.trim() || attachedFile) ? "rgba(43,212,127, 0.4)" : "var(--border-color)"}`,
                color: !wsConnected
                  ? "var(--neon-red, #ff4d63)"
                  : (input.trim() || attachedFile) ? "var(--neon-green)" : "var(--text-muted)",
              }}
              title={!wsConnected ? "Disconnected — wait for reconnect" : "Send (Enter)"}
            >
              {!wsConnected ? "Offline" : "Send"}
            </button>
          </div>
        </div>

        {/* Inline terminal panel — appears below the input */}
        {showTerminal && (
          <div
            style={{
              height: 280,
              flexShrink: 0,
              borderTop: "2px solid var(--neon-green)",
              position: "relative",
            }}
          >
            <Suspense fallback={
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: 11 }}>
                Loading terminal...
              </div>
            }>
              <TerminalPage />
            </Suspense>
          </div>
        )}
        </div>{/* end main chat column */}

        {/* Project Files Panel — collapsible sidebar */}
        {showProjectPanel && detectedProject && (
          <div style={{
            width: 240,
            borderLeft: "1px solid var(--border-color)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            flexShrink: 0,
          }}>
            {/* Panel header with breadcrumb */}
            <div style={{
              padding: "6px 10px",
              borderBottom: "1px solid var(--border-color)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexShrink: 0,
              gap: 6,
            }}>
              <div style={{ overflow: "hidden", flex: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--jarvis-blue)" }}>
                  Project · {detectedProject}
                </div>
                <div style={{ fontSize: 9, color: "var(--text-dim)", fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", direction: "rtl", textAlign: "left" }} title={projectPath || `/root/htb/boxes/${detectedProject}`}>
                  {(projectPath || `/root/htb/boxes/${detectedProject}`).replace(`/root/htb/boxes/${detectedProject}`, "~")}
                </div>
              </div>
              <button
                onClick={() => browseProjectPath(projectPath || `/root/htb/boxes/${detectedProject}`)}
                style={{ fontSize: 11, padding: "3px 7px", borderRadius: 3, border: "1px solid var(--border-color)", color: "var(--text-muted)", background: "transparent", cursor: "pointer", flexShrink: 0 }}
                title="Refresh"
              >
                ↻
              </button>
            </div>

            {/* Up-directory button — visible when below the engagement root */}
            {(() => {
              const root = `/root/htb/boxes/${detectedProject}`;
              const cur = projectPath || root;
              if (cur === root) return null;
              const parent = cur.substring(0, cur.lastIndexOf("/")) || "/";
              return (
                <div
                  onClick={() => browseProjectPath(parent)}
                  style={{
                    cursor: "pointer",
                    padding: "5px 10px",
                    fontSize: 10,
                    color: "var(--neon-cyan, #b6f23a)",
                    background: "rgba(182,242,58,0.04)",
                    borderBottom: "1px solid var(--border-color)",
                    fontFamily: "monospace",
                  }}
                >
                  ⬆ .. (parent)
                </div>
              );
            })()}

            {/* Loot section */}
            {projectLoot.length > 0 && (
              <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--border-color)" }}>
                <div style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--neon-green)", marginBottom: 4 }}>
                  Loot ({projectLoot.length})
                </div>
                {projectLoot.map((f, i) => (
                  <div key={i} style={{ fontSize: 9, fontFamily: "monospace", color: "var(--neon-green)", padding: "1px 0" }}>
                    {f}
                  </div>
                ))}
              </div>
            )}

            {/* File tree */}
            <div style={{ flex: 1, overflowY: "auto", padding: "4px 6px" }}>
              <div style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: 4, padding: "0 4px" }}>
                Files
              </div>
              {projectFiles.map((f) => (
                <div
                  key={f.path}
                  onClick={() => {
                    if (f.isDir) {
                      browseProjectPath(f.path);
                    } else {
                      openFilePreview(f.path, f.name);
                    }
                  }}
                  style={{
                    fontSize: 10,
                    fontFamily: "monospace",
                    color: f.isDir ? "var(--jarvis-blue)" : "var(--text-primary)",
                    fontWeight: f.isDir ? 600 : 400,
                    padding: "5px 6px",
                    borderRadius: 4,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    minHeight: 28,
                    transition: "background 0.1s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(182,242,58,0.06)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <span style={{ fontSize: 12 }}>{f.isDir ? "📁" : "📄"}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{f.name}</span>
                  {!f.isDir && f.size > 0 && (
                    <span style={{ fontSize: 8, color: "var(--text-muted)", flexShrink: 0 }}>
                      {f.size < 1024 ? `${f.size}B` : f.size < 1024 * 1024 ? `${(f.size / 1024).toFixed(0)}K` : `${(f.size / 1024 / 1024).toFixed(1)}M`}
                    </span>
                  )}
                </div>
              ))}
              {projectFiles.length === 0 && (
                <div style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center", padding: 14 }}>
                  No files in this directory
                </div>
              )}
            </div>
          </div>
        )}
      </div>{/* end flex row */}

      {/* Custom delete confirmation modal */}
      {confirmDelete && (() => {
        const target = sessions.find((s) => s.id === confirmDelete);
        const isLive = target?.running;
        const doDelete = () => {
          const sid = confirmDelete!;
          // OPTIMISTIC LOCAL REMOVAL — the session disappears from the sidebar
          // immediately regardless of whether the server actually has a file to delete.
          // (Placeholder sessions never reached the server; orphaned sessions might
          // exist only in local state. The server's subsequent session_list will
          // confirm/sync the real state.)
          setSessions((prev) => prev.filter((s) => s.id !== sid));
          if (currentSession === sid) {
            setCurrentSession(null);
            setMessages([]);
            setContextTokens(0);
          }
          // Still send to server in case there's a persisted file to clean up
          try {
            wsRef.current?.send(JSON.stringify({ type: "delete_session", sessionId: sid }));
          } catch {}
          setConfirmDelete(null);
        };
        return (
          <ConfirmModal
            message={isLive
              ? "This session is still running. We'll ask Claude to save any new facts to memory first, then stop and delete it. Continue?"
              : "Delete this session? This cannot be undone."}
            onConfirm={() => {
              if (isLive) {
                // Server-side close-with-memory + delete (survives client disconnect)
                const sid = confirmDelete!;
                try {
                  wsRef.current?.send(JSON.stringify({
                    type: "close_with_memory",
                    sessionId: sid,
                    deleteAfter: true,
                  }));
                } catch {}
                // Optimistic local removal
                setSessions((prev) => prev.filter((s) => s.id !== sid));
                if (currentSession === sid) {
                  setCurrentSession(null);
                  setMessages([]);
                  setContextTokens(0);
                }
                setConfirmDelete(null);
              } else {
                doDelete();
              }
            }}
            onCancel={() => setConfirmDelete(null)}
          />
        );
      })()}

      {/* Explain code modal */}
      {explainModal && (
        <ExplainModal
          code={explainModal.code}
          language={explainModal.language}
          explanation={explainModal.explanation}
          loading={explainModal.loading}
          onClose={() => setExplainModal(null)}
        />
      )}

      {/* File preview modal */}
      {filePreview && (
        <div
          onClick={() => setFilePreview(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 12,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#11161f",
              border: "1px solid rgba(182,242,58,0.3)",
              borderRadius: 10,
              maxWidth: "92vw",
              maxHeight: "85vh",
              width: 900,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 8px 40px rgba(0,0,0,0.6), 0 0 60px rgba(182,242,58,0.1)",
            }}
          >
            {/* Header */}
            <div style={{
              padding: "10px 14px",
              borderBottom: "1px solid var(--border-color)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 10,
              flexShrink: 0,
            }}>
              <div style={{ overflow: "hidden", flex: 1 }}>
                <div style={{ fontSize: 9, color: "var(--text-muted)", fontFamily: "monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {filePreview.path}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--jarvis-blue)", marginTop: 2 }}>
                  📄 {filePreview.name}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={async () => {
                    const ok = await copyToClipboard(filePreview.content);
                    if (ok) {
                      const target = document.activeElement as HTMLElement;
                      // brief visual confirmation
                      const t = setFilePreview({ ...filePreview, name: filePreview.name + "  ✓ copied" });
                      setTimeout(() => setFilePreview((cur) => cur ? { ...cur, name: cur.name.replace("  ✓ copied", "") } : cur), 1500);
                      void target; void t;
                    }
                  }}
                  style={{
                    fontSize: 11, padding: "5px 12px", borderRadius: 4,
                    border: "1px solid rgba(182,242,58,0.3)",
                    background: "rgba(182,242,58,0.1)", color: "var(--jarvis-blue)",
                    cursor: "pointer", fontWeight: 600, minHeight: 30,
                  }}
                >
                  Copy
                </button>
                <button
                  onClick={() => setFilePreview(null)}
                  style={{
                    fontSize: 14, padding: "5px 12px", borderRadius: 4,
                    border: "1px solid rgba(255,77,99,0.3)",
                    background: "rgba(255,77,99,0.08)", color: "var(--neon-red, #ff4d63)",
                    cursor: "pointer", fontWeight: 700, minHeight: 30,
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflow: "auto", padding: 12, background: "rgba(0,0,0,0.3)" }}>
              {filePreview.loading ? (
                <div style={{ color: "var(--text-muted)", fontSize: 12, textAlign: "center", padding: 30 }}>
                  Loading...
                </div>
              ) : filePreview.binary ? (
                <div style={{ color: "var(--text-muted)", fontSize: 11, padding: 20, fontFamily: "monospace" }}>
                  {filePreview.content}
                </div>
              ) : filePreview.name.toLowerCase().endsWith(".html") ? (
                <iframe
                  srcDoc={filePreview.content}
                  sandbox="allow-same-origin"
                  style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}
                  title={filePreview.name}
                />
              ) : (
                <pre style={{
                  margin: 0,
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  lineHeight: 1.5,
                  color: "var(--text-primary)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}>
                  {filePreview.content}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Interactive Question Parser ─────────────────────────

interface UserQuestion {
  question: string;
  options: { label: string; description?: string }[];
}

function parseUserQuestions(text: string): { cleanText: string; questions: UserQuestion[] } {
  const questions: UserQuestion[] = [];

  // Method 1: Parse <user-question> JSON tags
  let cleanText = text.replace(/<user-question>\s*([\s\S]*?)\s*<\/user-question>/g, (_, json) => {
    try {
      const parsed = JSON.parse(json.trim());
      questions.push(parsed);
    } catch {}
    return "";
  });

  // Method 2: Detect emoji-based option patterns from Claude's text output
  // Supports both:
  //   "🎓 **Guided Mode** — desc"  (emoji-first)
  //   "1. **🧠 Summon council** — desc"  (numbered list with emoji inside bold)
  //   "- **Option** — desc"  (bullet list)
  if (questions.length === 0) {
    // Match either: emoji/digit/dash prefix + optional **bold** + dash/colon + description
    const optionLinePatterns = [
      // Pattern A: emoji-first — "🎓 **Label** — desc"
      /^([^\x00-\x7F][‍️\u{1F000}-\u{1FFFF}\w]*)\s*\*\*(.+?)\*\*\s*[—\-–:]\s*(.+)/u,
      // Pattern B: numbered list — "1. **Label** — desc" or "1) **Label** — desc"
      /^(\d+[.)])\s*\*\*(.+?)\*\*\s*[—\-–:]\s*(.+)/,
      // Pattern C: bullet list — "- **Label** — desc" or "* **Label** — desc"
      /^([-*+])\s*\*\*(.+?)\*\*\s*[—\-–:]\s*(.+)/,
    ];
    const lines = cleanText.split("\n");
    const optionIndices: number[] = [];
    const options: { label: string; description?: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      for (const pattern of optionLinePatterns) {
        const m = trimmed.match(pattern);
        if (m) {
          optionIndices.push(i);
          // Label = bold content (may include emoji); skip the numeric prefix in display
          const label = m[2].trim();
          options.push({
            label,
            description: m[3].trim(),
          });
          break;
        }
      }
    }

    if (options.length >= 2) {
      // Find the question text — look for a line ending with ? before the first option
      let questionText = "";
      const firstOptIdx = optionIndices[0];
      for (let i = firstOptIdx - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (line && line.endsWith("?")) {
          questionText = line;
          break;
        }
        if (line && !line.endsWith("?")) {
          questionText = line;
          break;
        }
      }
      if (!questionText) questionText = "Choose an option:";

      questions.push({ question: questionText, options });

      // Remove the question + option lines from cleanText
      const removeStart = questionText ? lines.findIndex(l => l.trim() === questionText) : firstOptIdx;
      const removeEnd = optionIndices[optionIndices.length - 1];
      const remaining = lines.filter((_, i) => i < (removeStart >= 0 ? removeStart : firstOptIdx) || i > removeEnd);
      cleanText = remaining.join("\n").trim();
    }
  }

  return { cleanText: cleanText.trim(), questions };
}

// ── Code Block with action buttons ─────────────────────

// ── ChillsPwn arsenal: alias → real tool name, applied ONLY to displayed code ──
// The living value (storage, conversation, LLM prompts) stays in aliases; this swaps
// to the real command name purely for on-screen readability, and only at a command
// position (line start or just after a shell operator) so arguments, comments, and
// prose are never mis-translated. Source of truth = the arsenal in /opt/chillspwn-bin.
// Full canonical set — generated from /opt/chillspwn-bin (97 wrappers). Keep in sync
// with /opt/chillspwn-bin/ALIASES.md (regenerate that, then mirror here).
const ALIAS_TO_REAL: Record<string, string> = {
  AD: "bloodyAD", ASREP: "impacket-GetNPUsers", AUDIT: "nikto", BATCH: "dnsrecon",
  BROWSE: "gobuster", CARVE: "binwalk", CHAIN: "proxychains4", CHILD: "impacket-raiseChild",
  COLLECT: "amass", CRAFT: "msfvenom", DACL: "impacket-dacledit", DB: "impacket-mssqlclient",
  DCOM: "impacket-rpcdump", DELEGATE: "impacket-findDelegation", DESK: "msfconsole",
  DOOR: "rpcclient", DPAPI: "impacket-dpapi", DUMP: "impacket-samrdump", EDIT: "ldapmodify",
  ENTER: "evil-winrm", FACE: "wafw00f", FIND: "searchsploit", FWD: "nslookup", GATHER: "cewl",
  GENERATE: "crunch", GETUSER: "impacket-GetADUsers", GOTO: "nxc", GPU: "gpu-crack",
  GRAB: "smbget", GRAPH: "bloodhound", GUESS: "john", HARVEST: "theharvester",
  HOOK: "proxychains", JOIN: "impacket-addcomputer", KEEP: "impacket-secretsdump",
  KERBEROS: "impacket-getTGT", KUSER: "kerbrute", LABEL: "hashid", LDAP: "ldapdomaindump",
  LINK: "socat", LIST: "enum4linux", LISTEN: "responder", LIVE: "httpx", LOCK: "sslyze",
  LOOKUP: "dig", LOT: "dnsenum", MAP: "smbmap", MARK: "xsstrike", MATCH: "hashcat",
  META: "exiftool", MIX: "commix", NAME: "nmblookup", NAME2: "hash-identifier", NET: "nbtscan",
  NOTE: "impacket-dcomexec", OWNER: "impacket-owneredit", PAC: "impacket-getPac", PAGE: "dirb",
  PASSWORD: "impacket-changepasswd", PEEK: "rustscan", PIPE: "impacket-smbexec",
  PKI: "certipy-ad", PUSH: "patator", QUERY: "sqlmap", QUICK: "unicornscan", RBCD: "impacket-rbcd",
  READ: "wpscan", RECOVER: "foremost", REGISTRY: "impacket-reg", RELAY: "impacket-ntlmrelayx",
  REPEAT: "ncrack", RESOLVE: "host", RETRY: "hydra", ROAST: "impacket-GetUserSPNs",
  ROUND: "medusa", SEEK: "ffuf", SEND: "impacket-atexec", SERVICE: "impacket-services",
  SHARE: "smbclient", SHARE2: "impacket-smbserver", SHOW: "whatweb", SID: "impacket-lookupsid",
  SILVER: "impacket-getST", STEP: "impacket-psexec", STORE: "ldapsearch", SURFACE: "nmap",
  TASK: "impacket-wmiexec", TICKET: "impacket-ticketer", TLS: "sslscan", TRACE: "bloodhound-python",
  TRAP: "tcpdump", TRY: "wfuzz", TUN: "chisel", VIEW2: "pywerview", WALK: "feroxbuster",
  WIDE: "masscan", WIRES: "tshark",
};
const ALIAS_DISPLAY_RE = new RegExp(
  "(^|[\\n|;&(]\\s*|\\$\\(\\s*)(" + Object.keys(ALIAS_TO_REAL).join("|") + ")\\b",
  "g",
);
// Display-only: alias → real at command positions. Never mutates stored data.
function aliasToReal(code: string): string {
  return code.replace(ALIAS_DISPLAY_RE, (_m, pre, alias) => pre + (ALIAS_TO_REAL[alias] || alias));
}

function CodeBlock({
  code,
  language,
  onSuggestEdit,
  onExplain,
  onRunInTerminal,
}: {
  code: string;
  language: string;
  onSuggestEdit: (code: string) => void;
  onExplain: (code: string, language: string) => void;
  onRunInTerminal?: (command: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  // Detect bash-like shell commands. Triggers the "Try in Terminal" button.
  const isShellLike = !language || /^(bash|sh|shell|zsh|console|terminal)$/i.test(language);

  return (
    <div style={{ position: "relative", margin: "0.5rem 0", borderRadius: 6, overflow: "hidden" }}>
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "4px 10px",
          background: "rgba(0, 0, 0, 0.5)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          flexWrap: "wrap",
          gap: 4,
        }}
      >
        <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {language || "code"}
        </span>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          <button
            onClick={async () => {
              const ok = await copyToClipboard(code);
              if (ok) {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            }}
            style={{
              fontSize: 10,
              padding: "4px 9px",
              borderRadius: 4,
              border: "1px solid rgba(182,242,58, 0.3)",
              background: copied ? "rgba(182,242,58, 0.25)" : "rgba(182,242,58, 0.08)",
              color: "var(--neon-cyan, #b6f23a)",
              cursor: "pointer",
              transition: "all 0.15s",
              minHeight: 28,
              fontWeight: 600,
            }}
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
          {onRunInTerminal && isShellLike && (
            <button
              onClick={() => onRunInTerminal(code)}
              style={{
                fontSize: 10,
                padding: "4px 9px",
                borderRadius: 4,
                border: "1px solid rgba(43,212,127, 0.4)",
                background: "rgba(43,212,127, 0.1)",
                color: "var(--neon-green, #2bd47f)",
                cursor: "pointer",
                transition: "all 0.15s",
                minHeight: 28,
                fontWeight: 600,
              }}
              title="Open the terminal and run this"
            >
              ▶ Try in Terminal
            </button>
          )}
          <button
            onClick={() => onSuggestEdit(code)}
            style={{
              fontSize: 10,
              padding: "4px 9px",
              borderRadius: 4,
              border: "1px solid rgba(255,174,66, 0.3)",
              background: "rgba(255,174,66, 0.08)",
              color: "var(--neon-amber, #ffae42)",
              cursor: "pointer",
              transition: "all 0.15s",
              minHeight: 28,
              fontWeight: 600,
            }}
          >
            Suggest Edit
          </button>
          <button
            onClick={() => onExplain(code, language)}
            style={{
              fontSize: 10,
              padding: "4px 9px",
              borderRadius: 4,
              border: "1px solid rgba(43,212,127, 0.3)",
              background: "rgba(43,212,127, 0.08)",
              color: "var(--neon-green, #2bd47f)",
              cursor: "pointer",
              transition: "all 0.15s",
              minHeight: 28,
              fontWeight: 600,
            }}
          >
            Explain
          </button>
        </div>
      </div>
      {/* Code content — wraps long lines instead of horizontal scroll */}
      <pre
        style={{
          margin: 0,
          padding: "10px 12px",
          background: "rgba(0, 0, 0, 0.4)",
          overflowX: "auto",
          fontSize: 11,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        <code style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace", color: "var(--text-primary)" }}>{aliasToReal(code)}</code>
      </pre>
    </div>
  );
}

// ── Content renderer with code block parsing ───────────

function renderContentWithCodeBlocks(
  text: string,
  isUser: boolean,
  onSuggestEdit: (code: string) => void,
  onExplain: (code: string, language: string) => void,
  onRunInTerminal?: (command: string) => void,
): React.ReactNode[] {
  // Split by code blocks: ```language\ncode``` (flexible — newline optional after language)
  const parts: React.ReactNode[] = [];
  const codeBlockRegex = /```(\w*)\s*\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Text before this code block
    if (match.index > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index);
      parts.push(
        <span key={`text-${lastIndex}`} style={{ whiteSpace: "pre-wrap" }}>{textBefore}</span>
      );
    }

    const language = match[1] || "";
    const code = match[2];

    if (isUser) {
      // For user messages, render code blocks plainly (no action buttons)
      parts.push(
        <pre key={`code-${match.index}`} style={{ margin: "0.5rem 0", padding: "8px 10px", background: "rgba(0,0,0,0.3)", borderRadius: 4, overflowX: "auto", fontSize: 12, lineHeight: 1.5 }}>
          <code style={{ fontFamily: "monospace" }}>{aliasToReal(code)}</code>
        </pre>
      );
    } else {
      parts.push(
        <CodeBlock
          key={`code-${match.index}`}
          code={code}
          language={language}
          onSuggestEdit={onSuggestEdit}
          onExplain={onExplain}
          onRunInTerminal={onRunInTerminal}
        />
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Remaining text after last code block
  if (lastIndex < text.length) {
    parts.push(
      <span key={`text-${lastIndex}`} style={{ whiteSpace: "pre-wrap" }}>{text.slice(lastIndex)}</span>
    );
  }

  return parts;
}

// ── Explain Modal ──────────────────────────────────────

function ExplainModal({
  code,
  language,
  explanation,
  loading,
  onClose,
}: {
  code: string;
  language: string;
  explanation: string;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-[10000]"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="rounded-lg overflow-hidden flex flex-col"
        style={{
          background: "var(--bg-surface, #0f172a)",
          border: "1px solid rgba(43,212,127, 0.3)",
          boxShadow: "0 0 40px rgba(43,212,127, 0.1), 0 0 80px rgba(43,212,127, 0.05)",
          width: "min(700px, 90vw)",
          maxHeight: "80vh",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--border-color)", background: "rgba(0,0,0,0.3)" }}
        >
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ background: "var(--neon-green)" }} />
            <span className="text-sm font-semibold" style={{ color: "var(--neon-green)" }}>
              Code Explanation
            </span>
            {language && (
              <span className="text-[10px] uppercase px-1.5 py-0.5 rounded" style={{ background: "rgba(255,255,255,0.05)", color: "var(--text-muted)" }}>
                {language}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-sm px-2 py-0.5 rounded transition-all"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border-color)" }}
          >
            {"✕"}
          </button>
        </div>

        {/* Code being explained (collapsed) */}
        <div style={{ maxHeight: 120, overflowY: "auto", borderBottom: "1px solid var(--border-color)" }}>
          <pre
            className="text-[11px] font-cyber leading-relaxed p-3"
            style={{ margin: 0, background: "rgba(0,0,0,0.3)", color: "var(--text-dim)" }}
          >
            <code>{aliasToReal(code)}</code>
          </pre>
        </div>

        {/* Explanation */}
        <div className="flex-1 overflow-y-auto p-4" style={{ minHeight: 150 }}>
          {loading ? (
            <div className="flex items-center gap-2">
              <span className="streaming-indicator text-xs font-cyber" style={{ color: "var(--neon-green)" }}>
                Analyzing with Haiku...
              </span>
            </div>
          ) : (
            <div
              className="text-sm leading-relaxed whitespace-pre-wrap"
              style={{ color: "var(--text-primary)" }}
            >
              {explanation}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageContent({
  content,
  isUser,
  onOptionClick,
  onSuggestEdit,
  onExplain,
  onRunInTerminal,
}: {
  content: string;
  isUser: boolean;
  onOptionClick?: (answer: string) => void;
  onSuggestEdit?: (code: string) => void;
  onExplain?: (code: string, language: string) => void;
  onRunInTerminal?: (command: string) => void;
}) {
  const { cleanText, questions } = isUser ? { cleanText: content, questions: [] } : parseUserQuestions(content);

  // Check if content has code blocks (flexible: with or without newline after language)
  const hasCodeBlocks = /```[\w]*[\s\S]*?```/.test(cleanText);

  return (
    <>
      {cleanText && (
        <div
          className="chat-content text-sm leading-relaxed"
          style={{ color: "var(--text-primary)" }}
        >
          {hasCodeBlocks && onSuggestEdit && onExplain
            ? renderContentWithCodeBlocks(cleanText, isUser, onSuggestEdit, onExplain, onRunInTerminal)
            : <span style={{ whiteSpace: "pre-wrap" }}>{cleanText}</span>
          }
        </div>
      )}
      {questions.map((q, qi) => (
        <div key={qi} className="mt-3">
          <p className="text-xs font-semibold mb-2" style={{ color: "var(--neon-green)" }}>
            {q.question}
          </p>
          <div className="flex flex-wrap gap-2" style={{ alignItems: "stretch" }}>
            {q.options.map((opt, oi) => (
              <button
                key={oi}
                onClick={() => onOptionClick?.(opt.label)}
                className="text-left px-3 py-2 rounded-lg text-xs transition-all hover:scale-[1.02] flex flex-col justify-center"
                style={{
                  background: "rgba(182,242,58, 0.08)",
                  border: "1px solid rgba(182,242,58, 0.25)",
                  color: "var(--neon-cyan, #b6f23a)",
                  minWidth: 180,
                  flex: "1 1 0",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(182,242,58, 0.15)";
                  e.currentTarget.style.boxShadow = "0 0 12px rgba(182,242,58, 0.2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(182,242,58, 0.08)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <span className="font-semibold">{opt.label}</span>
                {opt.description && (
                  <span className="block mt-0.5" style={{ color: "var(--text-dim)", fontSize: "10px" }}>
                    {opt.description}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

// Glanceable per-tool indicator (icon + colored label) so you can SEE which tool/skill/terminal
// fired in the chat — terminal vs file vs code vs skill vs delegated sub-agent, etc.
// Humanize a tool call into a live activity phrase for the "Processing" indicator — derived purely
// from the tool name + command (zero extra model tokens). Command patterns win over tool names so a
// `terminal` running xfreerdp reads as "Launching RDP session…".
function activityLabel(name?: string, content?: string): string {
  const t = (name || "").toLowerCase();
  let raw = "";
  try { const i = JSON.parse(content || "{}"); raw = String(i.command || i.code || i.skill || i.agent || i.name || i.query || i.title || ""); } catch {}
  const c = raw.toLowerCase();
  // Pull a concrete target (IP / *.htb host / path) out of the command so the label says WHAT
  // it's hitting, not just the category — "Port scanning 10.10.10.5" rather than "Port scanning".
  const target = (raw.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/) || raw.match(/\b[a-z0-9_-]+\.(?:htb|vl|local|lan|corp|com|net|io)\b/i) || raw.match(/\/[A-Za-z0-9._\/-]{3,40}/) || [])[0] || "";
  const tgt = target ? ` ${target}` : "";
  if (/xfreerdp|rdesktop|\brdp\b|xdotool|xvfb/.test(c)) return `Launching RDP session${tgt}…`;
  if (/\bnmap|naabu|masscan|rustscan|autorecon/.test(c)) return `Port scanning${tgt}…`;
  if (/impacket-|bloodyad|gettgt|getst|secretsdump|certipy|kerberoast|asrep|\bs4u|rbcd|dcsync|ntlmrelay/.test(c)) return `Running AD / Kerberos attack${tgt}…`;
  if (/hashcat|\bjohn\b|hashid|\.potfile/.test(c)) return "Cracking hashes…";
  if (/\bnxc\b|netexec|crackmapexec|smbclient|smbmap|enum4linux|rpcclient|ldapsearch/.test(c)) return `Enumerating SMB / LDAP${tgt}…`;
  if (/ffuf|gobuster|feroxbuster|wfuzz|nikto|wpscan|httpx|katana|\bcurl |\bwget /.test(c)) return `Probing web service${tgt}…`;
  if (/openvpn|\btun0\b|\bvpn\b/.test(c)) return "Bringing up VPN…";
  if (/\bnc -|ncat |socat |reverse shell|msfvenom|payload|listener/.test(c)) return "Setting up shell / payload…";
  if (/sqlmap|union select|' or 1=1/.test(c)) return "Testing SQL injection…";
  const byName: Record<string, string> = {
    use_skill: raw ? `Loading skill: ${raw}…` : "Loading a skill…",
    board_create_task: raw ? `Delegating to ${raw}…` : "Delegating to an agent…",
    board_await: "Awaiting agent results…",
    board_list: "Checking the board…",
    delegate_task: "Running a sub-agent…",
    recall_conversation: "Recalling prior findings…",
    remember: "Saving to memory…",
    write_file: "Writing a file…",
    read_file: "Reading a file…",
    search_files: "Searching files…",
    patch: "Editing a file…",
    execute_code: "Running code…",
    process: "Managing a background process…",
    terminal: raw ? `Running: ${raw.trim().split(/\s+/)[0]}…` : "Running a command…",
    bash: raw ? `Running: ${raw.trim().split(/\s+/)[0]}…` : "Running a command…",
  };
  return byName[t] || (t ? `Running ${t}…` : "Working…");
}

function toolIndicator(name?: string, content?: string): { icon: string; label: string; color: string } {
  const t = (name || "").toLowerCase();
  let extra = "";
  try { const inp = JSON.parse(content || "{}"); extra = inp.skill || inp.name || ""; } catch {}
  const m: Record<string, { icon: string; label: string; color: string }> = {
    terminal:            { icon: "⚡", label: "TERMINAL",   color: "#2bd47f" },
    bash:                { icon: "⚡", label: "TERMINAL",   color: "#2bd47f" },
    execute_code:        { icon: "🐍", label: "CODE",       color: "#b6f23a" },
    write_file:          { icon: "✏️", label: "WRITE FILE", color: "#ffae42" },
    read_file:           { icon: "📄", label: "READ FILE",  color: "#b6f23a" },
    patch:               { icon: "🩹", label: "PATCH",      color: "#ffae42" },
    search_files:        { icon: "🔍", label: "SEARCH",     color: "#b6f23a" },
    process:             { icon: "⚙",  label: "PROCESS",    color: "#b07cff" },
    use_skill:           { icon: "📚", label: extra ? `SKILL → ${extra}` : "SKILL", color: "#b6f23a" },
    skill_manage:        { icon: "💾", label: "SKILL SAVE",  color: "#b6f23a" },
    recall_conversation: { icon: "🧠", label: "RECALL",     color: "#b07cff" },
    delegate_task:       { icon: "🔱", label: "SUB-AGENT",  color: "#ff8844" },
  };
  return m[t] || { icon: "▸", label: (name || "tool").toUpperCase(), color: "var(--neon-amber)" };
}

// ── Message Bubble ──────────────────────────────────────

const MessageBubble = memo(function MessageBubbleImpl({
  msg,
  prevRole,
  nextRole,
  onOptionClick,
  onSuggestEdit,
  onExplain,
  onRunInTerminal,
}: {
  msg: Message;
  prevRole?: string | null;
  nextRole?: string | null;
  onOptionClick?: (answer: string) => void;
  onSuggestEdit?: (code: string) => void;
  onExplain?: (code: string, language: string) => void;
  onRunInTerminal?: (command: string) => void;
}) {
  const [toolExpanded, setToolExpanded] = useState(false);
  // Rules of Hooks: EVERY hook must run unconditionally on every render. toolCopied used to be
  // declared inside the `msg.role === "tool"` branch below — so a MessageBubble rendered 2 hooks
  // for a tool message but 1 for any other role. When resume's setMessages reconciliation made a
  // bubble render a different role than its previous render, the hook count changed and React
  // threw #310 ("Rendered more hooks than during the previous render"), crashing the whole tree
  // → blank screen on resume. Declared here so the hook count is constant for all roles.
  const [toolCopied, setToolCopied] = useState(false);

  // Tool OUTPUT — distinct from a tool call. Compact, collapsible output panel.
  if (msg.role === "tool" && msg.isResult) {
    const out = msg.content || "";
    const long = out.length > 1200;
    const accent = msg.isError ? "var(--neon-red, #ff4d63)" : "var(--neon-green, #2bd47f)";
    return (
      <div className="msg-animate">
        <div className="tool-panel overflow-hidden" style={{ borderRadius: 6 }}>
          <div
            style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "4px 10px", background: "rgba(0, 0, 0, 0.4)",
              borderBottom: `1px solid ${msg.isError ? "rgba(255,64,64,0.15)" : "rgba(43,212,127,0.12)"}`,
            }}
          >
            <span style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 700, color: accent, textTransform: "uppercase" }}>
              {msg.isError ? "◂ output (error)" : "◂ output"}
            </span>
            {long && (
              <button
                onClick={() => setToolExpanded(!toolExpanded)}
                style={{ fontSize: 8, padding: "2px 6px", borderRadius: 3, border: "1px solid var(--border-color)", background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}
              >
                {toolExpanded ? "Collapse" : "Expand"}
              </button>
            )}
          </div>
          <pre
            style={{
              margin: 0, padding: "8px 12px", background: "rgba(0, 0, 0, 0.3)",
              fontSize: 11, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word",
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              color: msg.isError ? "#ff8585" : "var(--text-dim, #9fb0c0)",
              // Long output becomes an internal scroll area: a compact 240px window
              // when collapsed, a taller 600px one when expanded — both scroll.
              // overscrollBehavior:contain stops the chat from scroll-chaining once
              // you hit the top/bottom of the block.
              maxHeight: long ? (toolExpanded ? 600 : 240) : undefined,
              overflowY: long ? "auto" : "visible",
              overscrollBehavior: "contain",
            }}
          >
            {out}
          </pre>
        </div>
      </div>
    );
  }

  if (msg.role === "tool") {
    // Extract the command or file path from the tool input JSON
    let toolCommand = "";
    let toolDescription = "";
    try {
      const inp = JSON.parse(msg.content);
      toolCommand = inp.command || inp.file_path || inp.path || inp.old_string || "";
      toolDescription = inp.description || "";
    } catch {
      toolCommand = msg.content;
    }

    // A tool_use block_start creates a BLANK placeholder card that only fills once
    // the consolidated event arrives. Render nothing while content is empty so no
    // blank "▸ BASH" block flashes or lingers — the real card appears once it fills.
    // (Guard sits AFTER the hooks above to keep hook order stable across empty→filled.)
    if (!msg.content || !msg.content.trim()) return null;
    const ind = toolIndicator(msg.toolName, msg.content);

    return (
      <div className="msg-animate">
        <div className="tool-panel overflow-hidden" style={{ borderRadius: 6, borderLeft: `3px solid ${ind.color}` }}>
          {/* Tool header — glanceable indicator that this tool/skill/terminal actually fired */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "4px 10px",
              background: "rgba(0, 0, 0, 0.4)",
              borderBottom: "1px solid rgba(255,174,66, 0.1)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, lineHeight: 1 }}>{ind.icon}</span>
              <span style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 700, color: ind.color, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {ind.label}
              </span>
              {toolDescription && (
                <span style={{ fontSize: 9, color: "var(--text-muted)" }}>— {toolDescription.slice(0, 50)}</span>
              )}
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <button
                onClick={async () => {
                  const ok = await copyToClipboard(toolCommand);
                  if (ok) {
                    setToolCopied(true);
                    setTimeout(() => setToolCopied(false), 2000);
                  }
                }}
                style={{
                  fontSize: 9, padding: "3px 8px", borderRadius: 4,
                  border: "1px solid rgba(182,242,58, 0.3)",
                  background: toolCopied ? "rgba(182,242,58, 0.2)" : "rgba(182,242,58, 0.08)",
                  color: "var(--neon-cyan)", cursor: "pointer",
                  minHeight: 28,
                }}
              >
                {toolCopied ? "✓ Copied" : "Copy"}
              </button>
              {onRunInTerminal && (msg.toolName === "Bash" || /^[a-z]/.test(toolCommand)) && (
                <button
                  onClick={() => onRunInTerminal(toolCommand)}
                  style={{
                    fontSize: 9, padding: "3px 8px", borderRadius: 4,
                    border: "1px solid rgba(43,212,127, 0.4)",
                    background: "rgba(43,212,127, 0.1)",
                    color: "var(--neon-green)", cursor: "pointer",
                    fontWeight: 600,
                    minHeight: 28,
                  }}
                  title="Open the inline terminal and paste this command at the prompt"
                >
                  ▶ Try in Terminal
                </button>
              )}
              {onSuggestEdit && (
                <button
                  onClick={() => onSuggestEdit(toolCommand)}
                  style={{
                    fontSize: 9, padding: "3px 8px", borderRadius: 4,
                    border: "1px solid rgba(255,174,66, 0.3)",
                    background: "rgba(255,174,66, 0.08)",
                    color: "var(--neon-amber)", cursor: "pointer",
                    minHeight: 28,
                  }}
                >
                  Suggest Edit
                </button>
              )}
              {onExplain && (
                <button
                  onClick={() => onExplain(toolCommand, msg.toolName || "bash")}
                  style={{
                    fontSize: 9, padding: "3px 8px", borderRadius: 4,
                    border: "1px solid rgba(43,212,127, 0.3)",
                    background: "rgba(43,212,127, 0.08)",
                    color: "var(--neon-green)", cursor: "pointer",
                    minHeight: 28,
                  }}
                >
                  Explain
                </button>
              )}
              <button
                onClick={() => setToolExpanded(!toolExpanded)}
                style={{
                  fontSize: 8, padding: "2px 6px", borderRadius: 3,
                  border: "1px solid var(--border-color)",
                  background: "transparent",
                  color: "var(--text-muted)", cursor: "pointer",
                }}
              >
                {toolExpanded ? "Hide" : "Raw"}
              </button>
            </div>
          </div>
          {/* Command display */}
          <pre
            style={{
              margin: 0,
              padding: "8px 12px",
              background: "rgba(0, 0, 0, 0.3)",
              fontSize: 11,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              color: "var(--text-primary)",
            }}
          >
            {toolCommand}
          </pre>
          {/* Raw JSON (expandable) */}
          {toolExpanded && (
            <pre
              style={{
                margin: 0,
                padding: "6px 12px",
                background: "rgba(0, 0, 0, 0.5)",
                borderTop: "1px solid rgba(255,174,66, 0.1)",
                fontSize: 9,
                lineHeight: 1.4,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "monospace",
                color: "var(--text-muted)",
              }}
            >
              {msg.content}
            </pre>
          )}
        </div>
      </div>
    );
  }

  if (msg.role === "system") {
    // Per-turn context chip: a distinct, subtle purple pill so the operator can see the memory/
    // ledger being injected each turn (the passive "model referring to the MCP" signal).
    if (msg.isContextChip) {
      return (
        <div className="msg-animate flex justify-center">
          <div
            className="rounded-full px-3 py-0.5 text-[10px] font-cyber"
            style={{ color: "#b07cff", border: "1px solid rgba(192,132,252,0.3)", background: "rgba(192,132,252,0.06)" }}
            title="Memory/ledger injected into this turn (the MCP context the model reasons over). An explicit recall shows as a 🧠 RECALL tool card."
          >
            {msg.content}
          </div>
        </div>
      );
    }
    return (
      <div className="msg-animate flex justify-center">
        <div
          className={`${msg.isError ? "msg-error pulse-red" : "msg-system"} rounded px-3 py-1.5 max-w-[90%]`}
        >
          <p
            className="text-[11px] font-cyber"
            style={{ color: msg.isError ? "var(--neon-red)" : "var(--text-muted)" }}
          >
            {msg.content}
          </p>
        </div>
      </div>
    );
  }

  const isUser = msg.role === "user";
  const msgClass = isUser ? "msg-user" : "msg-assistant";
  // Messenger-style grouping: consecutive bubbles from the same sender hug together; the
  // avatar + name show only at the edges of a run, and the timestamp only on the last bubble.
  const sameAsPrev = prevRole === msg.role;
  const sameAsNext = nextRole === msg.role;
  const firstInGroup = !sameAsPrev;
  const lastInGroup = !sameAsNext;
  const showName = !isUser && firstInGroup;
  const showAvatar = !isUser && lastInGroup;
  const showMeta = lastInGroup && !msg.streaming;
  const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      className={`msg-animate msg-row flex ${msg.streaming ? "msg-live " : ""}${isUser ? "justify-end" : "justify-start"}`}
      style={{ marginTop: sameAsPrev ? 2 : 12, gap: 8 }}
    >
      {/* Assistant avatar gutter — fixed width keeps a run left-aligned; face only on the last bubble */}
      {!isUser && (
        <div style={{ width: 28, flexShrink: 0, display: "flex", alignItems: "flex-end" }}>
          {showAvatar && (
            <div className="msg-ava">
              <img src="/smallLogo.png" alt="" />
            </div>
          )}
        </div>
      )}
      <div
        style={{
          maxWidth: "82%",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: isUser ? "flex-end" : "flex-start",
        }}
      >
        {showName && <span className="msg-name">ChillsPwn</span>}
        <div
          className={`${msgClass} msg-bubble`}
          style={{ minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" }}
        >
          <MessageContent content={msg.content} isUser={isUser} onOptionClick={onOptionClick} onSuggestEdit={onSuggestEdit} onExplain={onExplain} onRunInTerminal={onRunInTerminal} />
          {!isUser && msg.streaming && <span className="stream-caret" aria-hidden="true">▍</span>}
        </div>
        {showMeta && (
          <div className="msg-meta">
            <span>{time}</span>
            <button
              className="msg-copy"
              onClick={async (e) => {
                const btn = e.currentTarget;
                const ok = await copyToClipboard(msg.content);
                btn.textContent = ok ? "copied" : "failed";
                setTimeout(() => { btn.textContent = "copy"; }, 1200);
              }}
              title="Copy this message"
            >
              copy
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
