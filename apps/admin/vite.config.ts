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
    fs: { allow: ['..', '../../packages'] },
    port: 5177,
    proxy: {
      // The `/api` prefix must be stripped: the client calls `/api/admin/...` so
      // the dev server can proxy it, but the API serves `/admin/...`. Without the
      // rewrite every request 404s. Matches apps/web and apps/ops.
      '/api': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
