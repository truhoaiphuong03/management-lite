import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    strictPort: true,
    host: '0.0.0.0', // Enables LAN phone access on same Wi-Fi
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
});
