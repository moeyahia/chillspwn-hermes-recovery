// Throwaway preview server for the dark-HUD revamp.
// Serves dist-revamp/ statically and proxies /api/* + /manifest + /ws to the LIVE backend
// (127.0.0.1:3131) so the preview is fully functional (real sessions/board/WS), while the live
// app on 3131 is never touched. /api/build-id is served from the revamp build so the in-app
// auto-updater sees a matching id and doesn't reload.
import { existsSync, readFileSync } from "fs";
import { join, extname } from "path";

const ROOT = "/root/.claude/plugins/chillspwn/webapp/dist-revamp";
const UPSTREAM = "127.0.0.1:3131";
const PORT = 3142;
const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json", ".woff2": "font/woff2", ".map": "application/json", ".txt": "text/plain",
};

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  idleTimeout: 120,
  async fetch(req, server) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === "/ws") {
      if (server.upgrade(req, { data: { up: null as any, q: [] as any[] } })) return undefined as any;
      return new Response("ws upgrade failed", { status: 400 });
    }
    if (p === "/api/build-id") {
      try {
        return new Response(readFileSync(join(ROOT, "build-id.json")),
          { headers: { "content-type": "application/json", "cache-control": "no-store" } });
      } catch {}
    }
    if (p.startsWith("/api/") || p === "/manifest.webmanifest") {
      const target = "http://" + UPSTREAM + p + url.search;
      const init: any = { method: req.method, headers: req.headers, redirect: "manual" };
      if (!["GET", "HEAD"].includes(req.method)) init.body = await req.arrayBuffer();
      try { return await fetch(target, init); } catch (e) { return new Response("upstream error", { status: 502 }); }
    }
    // static from dist-revamp
    const rel = p === "/" ? "/index.html" : p;
    const fp = join(ROOT, rel);
    if (existsSync(fp) && !fp.endsWith("/")) {
      const ext = extname(fp);
      const headers: Record<string, string> = { "content-type": MIME[ext] || "application/octet-stream" };
      if (p.startsWith("/assets/")) headers["cache-control"] = "public, max-age=31536000, immutable";
      else if (rel === "/index.html") headers["cache-control"] = "no-store";
      return new Response(readFileSync(fp), { headers });
    }
    // SPA fallback (but 404 missing hashed assets so we don't serve HTML for a JS request)
    if (/\.(js|css|map|png|svg|woff2?|ico)$/.test(p)) return new Response("not found", { status: 404 });
    return new Response(readFileSync(join(ROOT, "index.html")),
      { headers: { "content-type": "text/html", "cache-control": "no-store" } });
  },
  websocket: {
    open(ws) {
      const up = new WebSocket("ws://" + UPSTREAM + "/ws");
      (ws.data as any).up = up;
      up.addEventListener("open", () => { for (const m of (ws.data as any).q) up.send(m); (ws.data as any).q = []; });
      up.addEventListener("message", (e: any) => { try { ws.send(e.data); } catch {} });
      up.addEventListener("close", () => { try { ws.close(); } catch {} });
      up.addEventListener("error", () => { try { ws.close(); } catch {} });
    },
    message(ws, msg) {
      const up = (ws.data as any).up as WebSocket | null;
      if (up && up.readyState === 1) up.send(msg); else (ws.data as any).q.push(msg);
    },
    close(ws) { try { (ws.data as any).up?.close(); } catch {} },
  },
});
console.log(`[preview] dark-HUD revamp on :${PORT} → proxying /api + /ws to ${UPSTREAM}`);
