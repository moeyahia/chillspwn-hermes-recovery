import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.chillspwn.app',
  appName: 'ChillsPwn',
  webDir: 'dist',
  server: {
    // Point to the Kali VM's Tailscale IP
    url: 'https://kali-vps.tail6f91d3.ts.net',
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
