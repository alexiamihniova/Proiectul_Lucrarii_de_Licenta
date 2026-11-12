/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// The browser only ever talks to its own origin: `/api` is proxied to the backend, so the
// session cookie is same-origin and no CORS configuration is needed (ADR-0005).
// VITE_API_PROXY_TARGET comes from the environment (Docker Compose sets it) or defaults to
// the backend started with `make dev`.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  const backend = env.VITE_API_PROXY_TARGET ?? 'http://localhost:3001';
  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      proxy: { '/api': { target: backend, changeOrigin: true } },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      restoreMocks: true,
    },
  };
});
