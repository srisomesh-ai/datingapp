import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.API_URL ?? 'http://localhost:4000';

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  return {
    plugins: [react()],
    // The demo build imports the server's pure config/puzzle modules.
    define: demo ? { 'process.env': '{}' } : {},
    build: { target: 'es2022', outDir: demo ? 'dist-demo' : 'dist' },
    server: {
      host: true,
      proxy: {
        '/api': api,
        '/socket.io': { target: api, ws: true },
      },
    },
  };
});
