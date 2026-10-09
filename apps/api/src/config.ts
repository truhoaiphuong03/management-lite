import { loadDatabaseConfig } from '../../../packages/database/src/config.js';
import type { DatabaseConfig } from '../../../packages/database/src/config.js';

export interface ApiConfig {
  port: number;
  host: string;
  nodeEnv: string;
  isProduction: boolean;
  csrfSecret: string;
  allowedOrigins: string[];
  trustedProxies: string[];
  database: DatabaseConfig;
}

export const DEV_DEFAULT_CSRF_SECRET =
  'mglite_dev_csrf_secret_min_32_bytes_safe_default_key_test';

/**
 * Loads API server configuration from environment variables.
 * Safe defaults: host 127.0.0.1, port 3002.
 * Enforces strict production fail-closed validation for secrets and proxy trust.
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

  const rawCsrfSecret = env['CSRF_SECRET'];

  if (isProduction) {
    if (!rawCsrfSecret || typeof rawCsrfSecret !== 'string') {
      throw new Error(
        'FATAL: CSRF_SECRET environment variable is required in production',
      );
    }
    if (rawCsrfSecret.length < 32) {
      throw new Error(
        'FATAL: CSRF_SECRET must be at least 32 characters in production',
      );
    }
    if (rawCsrfSecret === DEV_DEFAULT_CSRF_SECRET) {
      throw new Error(
        'FATAL: CSRF_SECRET in production must not use the development default secret',
      );
    }
    if (
      /^(.)\1+$/.test(rawCsrfSecret) ||
      rawCsrfSecret === '12345678901234567890123456789012'
    ) {
      throw new Error('FATAL: CSRF_SECRET in production is too weak');
    }
  }

  const csrfSecret = rawCsrfSecret || DEV_DEFAULT_CSRF_SECRET;

  const rawOrigins = env['ALLOWED_ORIGINS'];
  const allowedOrigins = rawOrigins
    ? rawOrigins
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3001',
        'http://localhost:3002',
        'http://127.0.0.1:3002',
      ];

  const rawProxies = env['TRUSTED_PROXIES'];
  const trustedProxies = rawProxies
    ? rawProxies
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return {
    port,
    host,
    nodeEnv,
    isProduction,
    csrfSecret,
    allowedOrigins,
    trustedProxies,
    database: loadDatabaseConfig(env),
  };
}
