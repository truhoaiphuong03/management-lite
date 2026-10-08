import { loadDatabaseConfig } from '../../../packages/database/src/config.js';
import type { DatabaseConfig } from '../../../packages/database/src/config.js';

export interface ApiConfig {
  port: number;
  host: string;
  nodeEnv: string;
  isProduction: boolean;
  csrfSecret: string;
  allowedOrigins: string[];
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
  const isProduction = nodeEnv === 'production';

  const defaultCsrfSecret =
    'mglite_dev_csrf_secret_min_32_bytes_safe_default_key_test';
  const csrfSecret = env['CSRF_SECRET'] || defaultCsrfSecret;

  if (isProduction && (!env['CSRF_SECRET'] || env['CSRF_SECRET'].length < 32)) {
    throw new Error(
      'CSRF_SECRET environment variable must be set with at least 32 characters in production',
    );
  }

  const rawOrigins = env['ALLOWED_ORIGINS'];
  const allowedOrigins = rawOrigins
    ? rawOrigins
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:3002',
        'http://127.0.0.1:3002',
      ];

  return {
    port,
    host,
    nodeEnv,
    isProduction,
    csrfSecret,
    allowedOrigins,
    database: loadDatabaseConfig(env),
  };
}
