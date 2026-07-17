import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ["COMMAND_OS_V2_", "VITE_COMMAND_OS_V2_"]);
  const apiOrigin = env.COMMAND_OS_V2_API_ORIGIN || env.VITE_COMMAND_OS_V2_API_ORIGIN || "http://127.0.0.1:43141";
  return {
    plugins: [react(), tailwindcss()],
    envPrefix: ["COMMAND_OS_V2_", "VITE_COMMAND_OS_V2_"],
    base: "/",
    publicDir: "public",
    server: {
      host: "127.0.0.1",
      port: 43140,
      strictPort: true,
      proxy: {
        "/api/v2": { target: apiOrigin, changeOrigin: false },
        "/api/v2/events": { target: apiOrigin, changeOrigin: false },
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 43140,
      strictPort: true,
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: true,
      target: "es2022",
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom"],
          },
        },
      },
    },
  };
});
