import { useEffect, useRef, useState } from "react";

// Board events are broadcast to ALL dashboard clients, so this hook just keeps a WS open and forwards
// any `board_*` message. The component (re)seeds the full board over REST on every (re)connect — so no
// polling in the happy path. Mirrors ChatPage's reconnect + iOS/PWA resume logic (visibility/focus/
// online → reconnect; zombie-socket probe via list_sessions).
export function useBoardSocket(handlers: {
  onBoardEvent: (msg: any) => void;
  onReconnect: () => void; // seed/refresh the board on connect
}): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnRef = useRef(0);
  const timerRef = useRef<any>(null);
  const seqRef = useRef(0); // monotonic id per socket, so duplicate sockets are visible in logs
  const lastRecvRef = useRef(Date.now());
  const hRef = useRef(handlers);
  hRef.current = handlers;

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      // GUARD: don't open a second socket while one is already CONNECTING or OPEN.
      const existing = wsRef.current;
      if (existing && (existing.readyState === WebSocket.CONNECTING || existing.readyState === WebSocket.OPEN)) return;
      const id = ++seqRef.current;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        console.log(`[board-ws#${id}] connected`);
        if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
        setConnected(true);
        reconnRef.current = 0;
        try { hRef.current.onReconnect(); } catch {}
      };
      ws.onmessage = (e) => {
        lastRecvRef.current = Date.now();
        try {
          const msg = JSON.parse(e.data);
          if (typeof msg?.type === "string" && msg.type.startsWith("board_")) hRef.current.onBoardEvent(msg);
        } catch {}
      };
      ws.onclose = () => {
        console.log(`[board-ws#${id}] disconnected`);
        // Only the CURRENT socket reconnects — a replaced/stale socket must not (dup guard).
        if (cancelled || wsRef.current !== ws) return;
        setConnected(false);
        const a = ++reconnRef.current;
        timerRef.current = setTimeout(connect, Math.min(1000 * Math.pow(1.5, a - 1), 10000));
      };
      ws.onerror = () => {};
    };
    connect();

    const hardReconnect = () => {
      if (cancelled) return;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
      reconnRef.current = 0;
      // Detach first so the old socket's onclose won't schedule a competing reconnect.
      const old = wsRef.current;
      wsRef.current = null;
      try { old?.close(); } catch {}
      connect();
    };
    const forceReconnect = () => {
      if (cancelled || document.visibilityState === "hidden") return;
      const cur = wsRef.current;
      if (cur && cur.readyState === WebSocket.OPEN) {
        const before = lastRecvRef.current;
        try { cur.send(JSON.stringify({ type: "list_sessions" })); } catch { hardReconnect(); return; }
        try { hRef.current.onReconnect(); } catch {}
        setTimeout(() => { if (!cancelled && lastRecvRef.current === before) hardReconnect(); }, 3000);
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
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", forceReconnect);
      window.removeEventListener("focus", forceReconnect);
      window.removeEventListener("online", forceReconnect);
      wsRef.current?.close();
    };
  }, []);

  return { connected };
}
