import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

export default function TerminalPage() {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // Touch-scroll state — xterm.js doesn't support touch scroll natively
  const touchStartYRef = useRef<number | null>(null);
  const touchAccumRef = useRef<number>(0);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      scrollback: 5000,
      scrollOnUserInput: true,
      smoothScrollDuration: 100,
      theme: {
        background: "#11161f",
        foreground: "#dfe6ef",
        cursor: "#2bd47f",
        cursorAccent: "#11161f",
        selectionBackground: "rgba(182,242,58, 0.3)",
        black: "#1a1e2e",
        red: "#ff4d63",
        green: "#2bd47f",
        yellow: "#ffd700",
        blue: "#b6f23a",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#dfe6ef",
        brightBlack: "#4a5568",
        brightRed: "#ff6b6b",
        brightGreen: "#34d399",
        brightYellow: "#fbbf24",
        brightBlue: "#60a5fa",
        brightMagenta: "#b07cff",
        brightCyan: "#22d3ee",
        brightWhite: "#f8fafc",
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);

    termRef.current = term;
    fitRef.current = fitAddon;

    setTimeout(() => fitAddon.fit(), 100);

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "term_start" }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "term_ready") {
          setConnected(true);
          // Expose an injector so the chat can "Try in Terminal" a command
          (window as any).__chillspwnTerminalInject = (text: string): boolean => {
            if (ws.readyState !== WebSocket.OPEN) return false;
            ws.send(JSON.stringify({ type: "term_input", data: text }));
            term.focus();
            return true;
          };
        } else if (msg.type === "term_output") {
          term.write(msg.data);
        } else if (msg.type === "term_exit") {
          term.write("\r\n\x1b[31m[Terminal session ended]\x1b[0m\r\n");
          setConnected(false);
          delete (window as any).__chillspwnTerminalInject;
        }
      } catch {}
    };

    ws.onclose = () => {
      setConnected(false);
      term.write("\r\n\x1b[33m[Disconnected]\x1b[0m\r\n");
      delete (window as any).__chillspwnTerminalInject;
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "term_input", data }));
      }
    });

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "term_resize", cols, rows }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch {}
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      delete (window as any).__chillspwnTerminalInject;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "term_close" }));
      }
      ws.close();
      term.dispose();
    };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#11161f" }}>
      <div
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "6px 12px", borderBottom: "1px solid var(--border-color)",
          background: "rgba(0,0,0,0.3)", flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>▪</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--jarvis-blue)", letterSpacing: "0.08em" }}>
            TERMINAL
          </span>
          <span
            style={{
              width: 6, height: 6, borderRadius: "50%",
              background: connected ? "#2bd47f" : "#ff4d63",
              boxShadow: connected ? "0 0 6px rgba(43,212,127,0.5)" : "0 0 6px rgba(255,77,99,0.5)",
            }}
          />
        </div>
        <span style={{ fontSize: 9, color: "var(--text-muted)" }}>
          {connected ? "Connected" : "Disconnected"}
        </span>
      </div>
      {/* Mobile helper toolbar — Tab/Esc/Arrow keys + scrollback navigation */}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "4px 6px",
          background: "rgba(0,0,0,0.4)",
          borderBottom: "1px solid var(--border-color)",
          overflowX: "auto",
          flexShrink: 0,
        }}
      >
        {/* Scrollback controls — xterm.js doesn't support touch-scroll natively, these
            give explicit ways to page through history on mobile */}
        <button
          key="scroll-top"
          onClick={() => termRef.current?.scrollToTop()}
          style={{
            flexShrink: 0, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
            padding: "3px 8px", borderRadius: 3, border: "1px solid rgba(176,124,255,0.3)",
            background: "rgba(176,124,255,0.08)", color: "#b07cff", cursor: "pointer",
          }}
          title="Scroll to top of history"
        >⤒</button>
        <button
          key="page-up"
          onClick={() => termRef.current?.scrollLines(-10)}
          style={{
            flexShrink: 0, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
            padding: "3px 10px", borderRadius: 3, border: "1px solid rgba(176,124,255,0.4)",
            background: "rgba(176,124,255,0.12)", color: "#b07cff", cursor: "pointer", fontWeight: 700,
          }}
          title="Scroll up (10 lines)"
        >▲</button>
        <button
          key="page-down"
          onClick={() => termRef.current?.scrollLines(10)}
          style={{
            flexShrink: 0, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
            padding: "3px 10px", borderRadius: 3, border: "1px solid rgba(176,124,255,0.4)",
            background: "rgba(176,124,255,0.12)", color: "#b07cff", cursor: "pointer", fontWeight: 700,
          }}
          title="Scroll down (10 lines)"
        >▼</button>
        <button
          key="scroll-bot"
          onClick={() => termRef.current?.scrollToBottom()}
          style={{
            flexShrink: 0, fontSize: 11, fontFamily: "'JetBrains Mono', monospace",
            padding: "3px 8px", borderRadius: 3, border: "1px solid rgba(176,124,255,0.3)",
            background: "rgba(176,124,255,0.08)", color: "#b07cff", cursor: "pointer",
          }}
          title="Jump to bottom"
        >⤓</button>
        <div style={{ width: 1, alignSelf: "stretch", background: "rgba(255,255,255,0.1)", margin: "0 4px" }} />
        {[
          { label: "Tab", key: "\t" },
          { label: "Esc", key: "\x1b" },
          { label: "Ctrl+C", key: "\x03" },
          { label: "Ctrl+D", key: "\x04" },
          { label: "Ctrl+L", key: "\x0c" },
          { label: "↑", key: "\x1b[A" },
          { label: "↓", key: "\x1b[B" },
          { label: "←", key: "\x1b[D" },
          { label: "→", key: "\x1b[C" },
          { label: "|", key: "|" },
          { label: "~", key: "~" },
          { label: "/", key: "/" },
        ].map((b) => (
          <button
            key={b.label}
            onClick={() => {
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: "term_input", data: b.key }));
                termRef.current?.focus();
              }
            }}
            style={{
              flexShrink: 0,
              fontSize: 10,
              fontFamily: "'JetBrains Mono', monospace",
              padding: "3px 8px",
              borderRadius: 3,
              border: "1px solid var(--border-color)",
              background: "rgba(182,242,58,0.05)",
              color: "var(--jarvis-blue)",
              cursor: "pointer",
            }}
          >
            {b.label}
          </button>
        ))}
      </div>
      <div
        ref={containerRef}
        style={{
          flex: 1,
          padding: "4px 0 0 4px",
          overflow: "hidden",
          touchAction: "auto",
        }}
        onWheel={(e) => {
          e.stopPropagation();
        }}
        // Touch-pan scroll — xterm.js doesn't handle touch scroll natively,
        // so we capture finger drag and translate it into scrollLines() calls.
        onTouchStart={(e) => {
          if (e.touches.length !== 1) return;
          touchStartYRef.current = e.touches[0].clientY;
          touchAccumRef.current = 0;
        }}
        onTouchMove={(e) => {
          if (e.touches.length !== 1 || touchStartYRef.current === null) return;
          const y = e.touches[0].clientY;
          const dy = touchStartYRef.current - y; // positive = swipe up = scroll down
          touchStartYRef.current = y;
          // Roughly 20px per line — accumulate and emit scroll calls
          touchAccumRef.current += dy;
          const lineHeight = 20;
          if (Math.abs(touchAccumRef.current) >= lineHeight) {
            const lines = Math.trunc(touchAccumRef.current / lineHeight);
            touchAccumRef.current -= lines * lineHeight;
            try { termRef.current?.scrollLines(lines); } catch {}
          }
        }}
        onTouchEnd={() => {
          touchStartYRef.current = null;
          touchAccumRef.current = 0;
        }}
      />
    </div>
  );
}
