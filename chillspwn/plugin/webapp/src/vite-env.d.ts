/// <reference types="vite/client" />

// Injected at build time by vite.config.ts (define). Identifies the running build so the app can
// detect a newer server build and auto-reload (iOS PWA stale-bundle fix).
declare const __BUILD_ID__: string;
