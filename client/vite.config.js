import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.API_URL ?? 'http://localhost:4000';

export default defineConfig(() => {
  return {
    plugins: [react()],
    build: { target: 'es2022' },
    server: {
      host: true,
      proxy: {
        '/api': api,
        '/socket.io': { target: api, ws: true },
      },
    },
  };
});
