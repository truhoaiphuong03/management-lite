export interface DatabaseConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: boolean | { rejectUnauthorized: boolean };
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
}

/**
 * Loads database configuration from environment variables with safe defaults and validation.
 * Prioritizes DATABASE_URL if provided, otherwise individual PG* variables.
 */
export function loadDatabaseConfig(
  env: Record<string, string | undefined> = process.env,
): DatabaseConfig {
  const maxPool = Number.parseInt(env['DB_POOL_MAX'] || '10', 10);
  const idleTimeout = Number.parseInt(
    env['DB_POOL_IDLE_TIMEOUT_MS'] || '30000',
    10,
  );
  const connTimeout = Number.parseInt(
    env['DB_CONNECTION_TIMEOUT_MS'] || '5000',
    10,
  );

  const baseConfig: Pick<
    DatabaseConfig,
    'max' | 'idleTimeoutMillis' | 'connectionTimeoutMillis'
  > = {
    max: Number.isFinite(maxPool) && maxPool > 0 ? maxPool : 10,
    idleTimeoutMillis:
      Number.isFinite(idleTimeout) && idleTimeout > 0 ? idleTimeout : 30000,
    connectionTimeoutMillis:
      Number.isFinite(connTimeout) && connTimeout > 0 ? connTimeout : 5000,
  };

  if (env['DATABASE_URL']) {
    return {
      connectionString: env['DATABASE_URL'],
      ...baseConfig,
    };
  }

  const portParsed = Number.parseInt(env['PGPORT'] || '5432', 10);

  return {
    host: env['PGHOST'] || '127.0.0.1',
    port: Number.isFinite(portParsed) && portParsed > 0 ? portParsed : 5432,
    user: env['PGUSER'] || 'postgres',
    password: env['PGPASSWORD'] || '',
    database: env['PGDATABASE'] || 'management_lite',
    ssl: env['PGSSLMODE'] === 'require' ? { rejectUnauthorized: false } : false,
    ...baseConfig,
  };
}

/**
 * Produces a sanitized representation of the database config suitable for logs or debug output.
 * Redacts passwords and connection strings containing credentials.
 */
export function sanitizeDatabaseConfig(
  config: DatabaseConfig,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {
    max: config.max,
    idleTimeoutMillis: config.idleTimeoutMillis,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
  };

  if (config.connectionString) {
    try {
      const url = new URL(config.connectionString);
      if (url.password) {
        url.password = '***';
      }
      sanitized['connectionString'] = url.toString();
    } catch {
      sanitized['connectionString'] = '[REDACTED_INVALID_URL]';
    }
  } else {
    sanitized['host'] = config.host;
    sanitized['port'] = config.port;
    sanitized['user'] = config.user;
    sanitized['database'] = config.database;
    sanitized['ssl'] = Boolean(config.ssl);
    sanitized['password'] = config.password ? '***' : undefined;
  }

  return sanitized;
}

/**
 * Sanitizes error messages by scrubbing connection strings, passwords, or hostnames.
 */
export function sanitizeErrorMessage(rawMessage: string): string {
  if (!rawMessage) return 'Unknown database error';

  let sanitized = rawMessage;

  // Mask postgres URLs: postgresql://user:password@host:port/dbname
  sanitized = sanitized.replace(
    /(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/gi,
    '$1***$3',
  );

  // Mask password=xyz or password 'xyz'
  sanitized = sanitized.replace(
    /(password\s*[=:]\s*['"]?)[^\s,'"]+(['"]?)/gi,
    '$1***$2',
  );

  return sanitized;
}
