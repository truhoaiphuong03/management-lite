import http from 'node:http';
import type { ApiConfig } from './config.js';
import { createRequestHandler } from './app.js';
import type { DatabasePool } from '../../../packages/database/src/pool.js';
import { closeDatabasePool } from '../../../packages/database/src/pool.js';

export interface RunningServer {
  server: http.Server;
  port: number;
  host: string;
  close: () => Promise<void>;
}

/**
 * Starts the Management Lite API HTTP server.
 */
export async function startServer(
  config: ApiConfig,
  pool?: DatabasePool | null,
): Promise<RunningServer> {
  const handler = createRequestHandler({ pool });
  const server = http.createServer(handler);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const close = async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    if (pool) {
      await closeDatabasePool(pool);
    }
  };

  return {
    server,
    port: config.port,
    host: config.host,
    close,
  };
}

/**
 * Registers signal handlers for graceful shutdown (SIGINT, SIGTERM).
 */
export function setupGracefulShutdown(
  runningServer: RunningServer,
  logger = console,
): void {
  let isShuttingDown = false;

  const onShutdownSignal = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.log(`Received ${signal}, commencing graceful shutdown...`);

    try {
      await runningServer.close();
      logger.log('Graceful shutdown completed successfully.');
      process.exit(0);
    } catch (err) {
      logger.error('Error during graceful shutdown:', err);
      process.exit(1);
    }
  };

  process.once('SIGINT', () => void onShutdownSignal('SIGINT'));
  process.once('SIGTERM', () => void onShutdownSignal('SIGTERM'));
}
