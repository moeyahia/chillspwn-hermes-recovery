import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();

const config: CapacitorConfig = {
  appId: 'com.chillspwn.app',
  appName: 'ChillsPwn',
  webDir: 'dist',
  // Omit `server` for a normal packaged build. Set CAPACITOR_SERVER_URL only
  // during intentional live-reload development against a trusted HTTPS host.
  ...(serverUrl ? { server: { url: serverUrl } } : {}),
  android: {
    allowMixedContent: process.env.CAPACITOR_ALLOW_MIXED_CONTENT === 'true',
  },
};

export default config;
