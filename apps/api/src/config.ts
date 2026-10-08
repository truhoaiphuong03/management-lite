import { loadDatabaseConfig } from '../../../packages/database/src/config.js';
import type { DatabaseConfig } from '../../../packages/database/src/config.js';

export interface ApiConfig {
  port: number;
  host: string;
  nodeEnv: string;
  database: DatabaseConfig;
}

/**
 * Loads API server configuration from environment variables.
 * Safe defaults: host 127.0.0.1, port 3002.
 */
export function loadApiConfig(
  env: Record<string, string | undefined> = process.env,
): ApiConfig {
  const portParsed = Number.parseInt(env['PORT'] || '3002', 10);
  const port =
    Number.isFinite(portParsed) && portParsed > 0 ? portParsed : 3002;
  const host = env['HOST'] || '127.0.0.1';
  const nodeEnv = env['NODE_ENV'] || 'development';

  return {
    port,
    host,
    nodeEnv,
    database: loadDatabaseConfig(env),
  };
}
