import { loadApiConfig } from './config.js';
import { createDatabasePool } from '../../../packages/database/src/pool.js';
import { startServer, setupGracefulShutdown } from './server.js';

async function main(): Promise<void> {
  const config = loadApiConfig();
  const pool = createDatabasePool(config.database);
  const running = await startServer(config, pool);
  setupGracefulShutdown(running);
  console.log(
    `Management Lite API listening at http://${running.host}:${running.port} (${config.nodeEnv})`,
  );
}

main().catch((err) => {
  console.error(
    'Fatal API bootstrap error:',
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
