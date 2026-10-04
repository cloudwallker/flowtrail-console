import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { ServerResponse } from 'node:http';
import type { ProxyOptions } from 'vite';

const apiProxy: ProxyOptions = {
  target: process.env.FLOWTRAIL_API_URL || 'http://127.0.0.1:18081',
  changeOrigin: true,
  configure(proxy) {
    // Vite's default error handler can send 502 only before headers. A broken
    // upstream SSE connection must also close the response already streaming
    // to the browser, so EventSource can detect it and reconnect from its cursor.
    proxy.on('error', (_error, _request, response) => {
      if (response instanceof ServerResponse && response.headersSent && !response.writableEnded) response.destroy();
    });
    proxy.on('proxyRes', (upstream, _request, response) => {
      if (!(response instanceof ServerResponse)) return;
      const disconnect = () => {
        if (!response.destroyed && !response.writableEnded) response.destroy();
      };
      upstream.once('aborted', disconnect);
      upstream.once('error', disconnect);
    });
  },
};

export default defineConfig({
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true, proxy: { '/api': apiProxy } },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy: { '/api': apiProxy } },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] },
});
