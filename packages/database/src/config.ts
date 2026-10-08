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

export interface TestDatabaseSafetyResult {
  safe: boolean;
  reason?: string;
  databaseName?: string;
}

/**
 * Validates that a database target is strictly isolated and explicitly designated for testing.
 * Prevents accidental connection, migration execution, or test data pollution in
 * production, staging, development, or shared databases.
 */
export function isSafeTestDatabase(
  config: DatabaseConfig,
  env: Record<string, string | undefined> = process.env,
): TestDatabaseSafetyResult {
  const nodeEnv = (env['NODE_ENV'] || '').trim().toLowerCase();
  if (nodeEnv === 'production') {
    return {
      safe: false,
      reason:
        'Prohibited: NODE_ENV is set to "production". Integration tests cannot execute in a production environment.',
    };
  }

  let dbName = '';
  if (config.connectionString) {
    try {
      const url = new URL(config.connectionString);
      dbName = url.pathname.replace(/^\//, '').trim();
    } catch {
      return {
        safe: false,
        reason:
          'Prohibited: Unable to parse database connectionString URL to verify test designation.',
      };
    }
  } else if (config.database) {
    dbName = config.database.trim();
  }

  if (!dbName) {
    return {
      safe: false,
      reason: 'Prohibited: Database name is empty or unspecified.',
    };
  }

  const prohibitedExact = new Set([
    'management_lite',
    'postgres',
    'template1',
    'master',
    'defaultdb',
  ]);

  if (prohibitedExact.has(dbName.toLowerCase())) {
    return {
      safe: false,
      databaseName: dbName,
      reason: `Prohibited: Target database "${dbName}" is a default or production database name. Integration tests must run against an explicitly isolated test database.`,
    };
  }

  // Database name MUST contain 'test' (e.g. management_lite_test, test_db)
  const isTestDesignated = /test/i.test(dbName);
  if (!isTestDesignated) {
    return {
      safe: false,
      databaseName: dbName,
      reason: `Prohibited: Target database "${dbName}" does not contain "test". Integration tests require an explicit test database name (e.g. "management_lite_test").`,
    };
  }

  return { safe: true, databaseName: dbName };
}

/**
 * Asserts that the database configuration targets an isolated test database.
 * Throws an Error fail-closed if the database is not safe.
 */
export function assertSafeTestDatabase(
  config: DatabaseConfig,
  env: Record<string, string | undefined> = process.env,
): void {
  const result = isSafeTestDatabase(config, env);
  if (!result.safe) {
    throw new Error(`[Database Safety Guard] ${result.reason}`);
  }
}

/**
 * Loads database configuration specifically for test execution.
 * Prioritizes TEST_DATABASE_URL over DATABASE_URL.
 * Defaults to 'management_lite_test' if no URL/PGDATABASE is provided.
 * Enforces assertSafeTestDatabase before returning.
 */
export function loadTestDatabaseConfig(
  env: Record<string, string | undefined> = process.env,
): DatabaseConfig {
  const testUrl = env['TEST_DATABASE_URL'];
  const testDbName =
    env['TEST_PGDATABASE'] || env['PGDATABASE'] || 'management_lite_test';

  const testEnv: Record<string, string | undefined> = {
    ...env,
    DATABASE_URL: testUrl || env['DATABASE_URL'],
    PGDATABASE: testDbName,
  };

  const config = loadDatabaseConfig(testEnv);

  // If connectionString was not set and no URL provided in env, ensure database is explicitly testDbName
  if (!config.connectionString && !testUrl && !env['DATABASE_URL']) {
    config.database = testDbName;
  }

  assertSafeTestDatabase(config, env);
  return config;
}
