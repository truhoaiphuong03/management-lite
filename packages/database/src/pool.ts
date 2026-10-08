import pg from 'pg';
import type { DatabaseConfig } from './config.js';
import { sanitizeErrorMessage } from './config.js';

const { Pool } = pg;

export type DatabasePool = pg.Pool;

/**
 * Creates a PostgreSQL connection pool from DatabaseConfig.
 */
export function createDatabasePool(config: DatabaseConfig): DatabasePool {
  const poolConfig: pg.PoolConfig = config.connectionString
    ? {
        connectionString: config.connectionString,
        max: config.max,
        idleTimeoutMillis: config.idleTimeoutMillis,
        connectionTimeoutMillis: config.connectionTimeoutMillis,
      }
    : {
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        ssl: config.ssl,
        max: config.max,
        idleTimeoutMillis: config.idleTimeoutMillis,
        connectionTimeoutMillis: config.connectionTimeoutMillis,
      };

  const pool = new Pool(poolConfig);

  // Prevent uncaughtException when idle clients encounter connection errors
  pool.on('error', () => {
    // Handled internally by pool reconnects
  });

  return pool;
}

export interface DatabaseHealthResult {
  connected: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Tests database connectivity by executing a lightweight ping query (SELECT 1).
 * Never throws; returns sanitized health status.
 */
export async function checkDatabaseHealth(
  pool: DatabasePool,
): Promise<DatabaseHealthResult> {
  const startTime = Date.now();
  try {
    const res = await pool.query<{ ping: number }>('SELECT 1 AS ping');
    const latencyMs = Date.now() - startTime;
    if (res.rows[0]?.ping === 1) {
      return { connected: true, latencyMs };
    }
    return {
      connected: false,
      error: 'Unexpected ping response from database',
    };
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    return {
      connected: false,
      error: sanitizeErrorMessage(rawMessage),
    };
  }
}

/**
 * Gracefully shuts down the connection pool, waiting for active queries to complete.
 */
export async function closeDatabasePool(pool: DatabasePool): Promise<void> {
  try {
    await pool.end();
  } catch {
    // Ignore errors during termination
  }
}
