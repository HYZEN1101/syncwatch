import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // Stamps every build with the exact time it was compiled. This shows
    // up as a small watermark in the lobby — if two open browser tabs
    // ever show DIFFERENT build times, one of them is running stale
    // JavaScript and needs a hard refresh (Ctrl+Shift+R), regardless of
    // what the server is actually serving.
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    proxy: {
      '/_syncwatch': 'http://localhost:3000',
    },
  },
});
