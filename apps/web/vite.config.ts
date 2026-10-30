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
          manualChunks(id) {
            if (id.includes('node_modules')) {
              return 'vendor-react';
            }
            if (
              id.includes('PayrollScreen') ||
              id.includes('PayrollStatsScreen') ||
              id.includes('EmployeeMyPayScreen') ||
              id.includes('FinanceOverviewScreen') ||
              id.includes('FinanceLedgerScreen')
            ) {
              return 'screen-payroll-finance';
            }
            if (
              id.includes('ClockScreen') ||
              id.includes('AttendanceScreen') ||
              id.includes('ScheduleScreen')
            ) {
              return 'screen-attendance-schedule';
            }
            if (
              id.includes('StorageScreen') ||
              id.includes('ReportsScreen') ||
              id.includes('ReportNewScreen') ||
              id.includes('ReportDetailScreen') ||
              id.includes('WorkScreen') ||
              id.includes('WorkDetailScreen')
            ) {
              return 'screen-storage-work-reports';
            }
            if (
              id.includes('EmployeesScreen') ||
              id.includes('EmployeeDetailScreen') ||
              id.includes('EmployeeNewScreen') ||
              id.includes('AccountsScreen') ||
              id.includes('SystemLogsScreen')
            ) {
              return 'screen-employees-admin';
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
