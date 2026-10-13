import http from 'node:http';
import type { ApiConfig } from './config.js';
import { createRequestHandler } from './app.js';
import type { DatabasePool } from '../../../packages/database/src/pool.js';
import { closeDatabasePool } from '../../../packages/database/src/pool.js';
import { resolve } from 'node:path';
import {
  FinanceService,
  type FinanceServiceOptions,
  type ReceiptExtractor,
} from './finance/service.js';
import { ReceiptStore } from './finance/receipt-store.js';
import {
  startPurgeScheduler,
  type PurgeScheduler,
} from './finance/purge-scheduler.js';

export interface RunningServer {
  server: http.Server;
  port: number;
  host: string;
  close: () => Promise<void>;
}

/**
 * Starts the Management Lite API HTTP server.
 */
export interface ServerExtras {
  /**
   * Composition hook for the single AI Core instance. It receives FIN's `authorizeOwner`.
   * Absent means receipt reading reports `unavailable`; manual FIN keeps working.
   */
  createReceiptExtractor?: (
    authorize: FinanceService['aiAuthorizer'],
  ) => ReceiptExtractor | undefined;
}
export async function startServer(
  config: ApiConfig,
  pool?: DatabasePool | null,
  extras: ServerExtras = {},
): Promise<RunningServer> {
  let financeService: FinanceService | undefined;
  let purge: PurgeScheduler | undefined;
  if (pool) {
    const options: FinanceServiceOptions = {};
    if (config.finReceiptDirectory)
      options.receipts = new ReceiptStore(config.finReceiptDirectory, [
        resolve(process.cwd(), 'apps/web'),
      ]);
    financeService = new FinanceService(pool, options);
    const ai = extras.createReceiptExtractor?.(financeService.aiAuthorizer);
    if (ai) options.ai = ai;
    if (options.receipts) {
      const svc = financeService;
      purge = startPurgeScheduler({
        run: () => svc.purgeExpiredReceipts(),
        logger: console,
      });
    }
  }
  const handler = createRequestHandler({
    pool,
    ...(financeService ? { financeService } : {}),
    csrfSecret: config.csrfSecret,
    allowedOrigins: config.allowedOrigins,
    trustedProxies: config.trustedProxies,
    isProduction: config.isProduction,
    accountSecretKey: config.accountSecretKey,
    sessionCookieName: config.sessionCookieName,
  });
  const server = http.createServer(handler);

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (err) {
    await purge?.stop();
    throw err;
  }

  const close = async () => {
    await purge?.stop();
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
