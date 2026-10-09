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

  return {
    plugins: [react()],
    server: {
      port: 3001,
      strictPort: true,
      host: isLan ? '0.0.0.0' : '127.0.0.1',
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3002',
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
