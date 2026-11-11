import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig(() => {
  // Localhost-only (127.0.0.1) by default; explicit choice enables LAN (0.0.0.0)
  const isLan =
    process.env.LAN === 'true' ||
    process.env.VITE_HOST_LAN === 'true' ||
    process.argv.includes('--host');

  const devPort = Number.parseInt(process.env.VITE_PORT || '3001', 10);

  return {
    plugins: [react()],
    build: {
      chunkSizeWarningLimit: 400,
      rollupOptions: {
        output: {
          // Third-party code changes rarely, so it lives in its own long-cached chunk.
          // Screens are NOT grouped here: App.tsx loads each one on demand (React.lazy),
          // and Rollup emits one chunk per route plus shared chunks for common code.
          manualChunks(id) {
            if (id.includes('node_modules')) {
              return 'vendor-react';
            }
            if (
              id.includes('packages/contracts/src/printquote') ||
              id.includes('packages\\contracts\\src\\printquote')
            ) {
              return 'printquote-contracts';
            }
            if (
              id.includes('screens/helpers/printquote-helpers') ||
              id.includes('screens\\helpers\\printquote-helpers')
            ) {
              return 'printquote-helpers';
            }
            if (
              id.includes('packages/contracts/src/release-notes-catalog') ||
              id.includes('packages\\contracts\\src\\release-notes-catalog')
            ) {
              return 'release-notes-catalog';
            }
          },
        },
      },
    },
    server: {
      port: Number.isFinite(devPort) && devPort > 0 ? devPort : 3001,
      strictPort: true,
      host: isLan ? '0.0.0.0' : '127.0.0.1',
      proxy: {
        '/api': {
          target: process.env.VITE_API_TARGET || 'http://127.0.0.1:3002',
          changeOrigin: false,
        },
      },
    },
    resolve: {
      alias: {
        '@management-lite/ui/tokens.css': resolve(
          __dirname,
          '../../packages/ui/src/tokens.css',
        ),
        '@management-lite/ui/tokens': resolve(
          __dirname,
          '../../packages/ui/src/tokens.ts',
        ),
        '@management-lite/ui/components': resolve(
          __dirname,
          '../../packages/ui/src/components/index.ts',
        ),
      },
    },
  };
});
