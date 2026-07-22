import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
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
