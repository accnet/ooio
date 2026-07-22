import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@ooio/shared': fileURLToPath(new URL('../../packages/shared/src', import.meta.url)),
    },
  },
  server: {
    // The shared package lives outside this app's root, so Vite must be allowed
    // to serve it in dev.
    fs: { allow: ['..', '../../packages'] },
    // Port 5176 keeps admin on a different origin from apps/web in development.
    // Same origin would mean the two apps share localStorage, and an operator
    // session would leak into the customer app.
    port: 5176,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
