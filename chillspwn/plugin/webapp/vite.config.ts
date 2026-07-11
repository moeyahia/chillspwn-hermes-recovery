import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { writeFileSync } from "fs";
import { join } from "path";

// Unique id per build. Baked into the app (__BUILD_ID__) AND written to dist/build-id.json so the
// running app can detect when the server is serving a NEWER build and auto-reload — the fix for
// iOS home-screen PWAs that snapshot a stale index.html despite the no-store header.
const BUILD_ID = String(Date.now());

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "chillspwn-build-id",
      closeBundle() {
        try { writeFileSync(join("dist", "build-id.json"), JSON.stringify({ id: BUILD_ID })); } catch {}
      },
    },
  ],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: {
    port: 3132,
    proxy: {
      "/api": "http://localhost:3131",
      "/ws": { target: "ws://localhost:3131", ws: true },
    },
  },
  build: {
    outDir: "dist",
  },
});
