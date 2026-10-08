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
/**
 * Sanitizes error messages by scrubbing connection strings, passwords, or hostnames.
 */
export function sanitizeErrorMessage(rawMessage: string): string {
  if (!rawMessage) return 'Unknown database error';

  let sanitized = rawMessage;

  // Mask postgres URLs: postgresql://user:password@host:port/dbname or postgres://:password@host
  sanitized = sanitized.replace(
    /(postgres(?:ql)?:\/\/[^:@\s]*:)([^@\s]+)(@)/gi,
    '$1***$3',
  );

  // Mask user:pass in any remaining postgres url patterns
  sanitized = sanitized.replace(
    /(postgres(?:ql)?:\/\/)([^:@\s]+):([^@\s]+)(@)/gi,
    '$1$2:***$4',
  );

  // Mask password=xyz or password 'xyz' or password: "xyz"
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

export interface TestInstanceConfirmation {
  confirmed: boolean;
  reason?: string;
}

/**
 * Validates the confirmation protocol for dedicated test instances.
 * Automated tests must NEVER assume a database is safely isolated merely
 * because its hostname is local, its database name includes 'test', or NODE_ENV is set.
 * Explicit confirmation (CONFIRM_ISOLATED_TEST_DB=true) is required to certify that
 * the target instance is dedicated, disposable, and intended for test execution.
 */
export function verifyTestInstanceConfirmation(
  env: Record<string, string | undefined> = process.env,
): TestInstanceConfirmation {
  const confirmed = env['CONFIRM_ISOLATED_TEST_DB']?.trim().toLowerCase();
  if (confirmed !== 'true' && confirmed !== '1') {
    return {
      confirmed: false,
      reason:
        'Unconfirmed test instance. Automated tests cannot declare database isolation based solely on database name, hostname, or NODE_ENV. To prevent data corruption or pollution in existing/shared databases, an isolated test instance must be explicitly confirmed by setting CONFIRM_ISOLATED_TEST_DB=true.',
    };
  }
  return { confirmed: true };
}

/**
 * Validates that a database target conforms to safety invariants.
 * IMPORTANT: Naming and hostname checks are necessary baseline filters, but
 * NEVER constitute sole proof of test instance isolation. Genuine isolation
 * requires an explicitly confirmed dedicated instance (verifyTestInstanceConfirmation).
 *
 * Baseline safety invariants:
 * 1. Must be explicitly specified via TEST_DATABASE_URL (no fallback to DATABASE_URL or defaults).
 * 2. NODE_ENV must NOT be 'production' or 'staging'.
 * 3. Protocol must be postgresql: or postgres:.
 * 4. Hostname must NOT contain production or staging indicators.
 * 5. Database name must NOT be a protected default/app database name.
 * 6. Database name MUST explicitly contain a test designation (e.g. 'management_lite_test').
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
  if (nodeEnv === 'staging') {
    return {
      safe: false,
      reason:
        'Prohibited: NODE_ENV is set to "staging". Integration tests cannot execute in a staging environment.',
    };
  }

  const testUrl = env['TEST_DATABASE_URL']?.trim();
  const connStr = config.connectionString?.trim() || testUrl;

  if (!connStr) {
    return {
      safe: false,
      reason:
        'Prohibited: TEST_DATABASE_URL is not explicitly configured. Live integration tests require explicit opt-in via TEST_DATABASE_URL. Fallbacks to DATABASE_URL, PGDATABASE, or default databases are strictly disabled.',
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(connStr);
  } catch {
    return {
      safe: false,
      reason:
        'Prohibited: Unable to parse test database connection string as a valid URL.',
    };
  }

  if (
    parsedUrl.protocol !== 'postgres:' &&
    parsedUrl.protocol !== 'postgresql:'
  ) {
    return {
      safe: false,
      reason: `Prohibited: Invalid protocol "${parsedUrl.protocol}" in test connection string. Expected postgresql: or postgres:`,
    };
  }

  // Multi-factor check: Hostname must not indicate a remote production or staging environment
  const hostname = parsedUrl.hostname.toLowerCase();
  if (
    hostname.includes('prod') ||
    hostname.includes('production') ||
    hostname.includes('live') ||
    hostname.includes('staging') ||
    hostname.includes('stage')
  ) {
    return {
      safe: false,
      reason: `Prohibited: Hostname "${hostname}" indicates a production or staging host. Test database must run on an isolated test instance.`,
    };
  }

  const dbName = parsedUrl.pathname.replace(/^\//, '').trim();
  if (!dbName) {
    return {
      safe: false,
      reason:
        'Prohibited: Database name is empty or unspecified in connection string.',
    };
  }

  const prohibitedExact = new Set([
    'management_lite',
    'postgres',
    'template1',
    'master',
    'defaultdb',
    'app',
    'production',
    'staging',
  ]);

  if (prohibitedExact.has(dbName.toLowerCase())) {
    return {
      safe: false,
      databaseName: dbName,
      reason: `Prohibited: Target database "${dbName}" is a default, application, or system database name. Integration tests must run against an explicitly isolated test database.`,
    };
  }

  // Database name MUST explicitly contain a test designation (e.g. management_lite_test)
  const isTestDesignated =
    /(?:^test_|_test$|[-_]test[-_]|_test_|\btest\b)/i.test(dbName);
  if (!isTestDesignated) {
    return {
      safe: false,
      databaseName: dbName,
      reason: `Prohibited: Target database "${dbName}" does not contain a test designation (e.g. "management_lite_test"). Having a test keyword is necessary but not solely sufficient.`,
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
 * STRICT ISOLATION & CONFIRMATION CONTRACT:
 * - Requires explicit TEST_DATABASE_URL.
 * - Requires explicit confirmation CONFIRM_ISOLATED_TEST_DB=true.
 * - Absolutely NO automatic fallback to DATABASE_URL, PGDATABASE, or default databases.
 * - Enforces assertSafeTestDatabase multi-factor verification.
 */
export function loadTestDatabaseConfig(
  env: Record<string, string | undefined> = process.env,
): DatabaseConfig {
  const testUrl = env['TEST_DATABASE_URL']?.trim();
  if (!testUrl) {
    throw new Error(
      '[Database Safety Guard] TEST_DATABASE_URL is not set. Live integration tests require an explicitly designated TEST_DATABASE_URL. Automatic fallback to DATABASE_URL, PGDATABASE, or default databases is strictly prohibited.',
    );
  }

  const confirmation = verifyTestInstanceConfirmation(env);
  if (!confirmation.confirmed) {
    throw new Error(`[Database Safety Guard] ${confirmation.reason}`);
  }

  const maxPool = Number.parseInt(env['DB_POOL_MAX'] || '5', 10);
  const idleTimeout = Number.parseInt(
    env['DB_POOL_IDLE_TIMEOUT_MS'] || '30000',
    10,
  );
  const connTimeout = Number.parseInt(
    env['DB_CONNECTION_TIMEOUT_MS'] || '5000',
    10,
  );

  const config: DatabaseConfig = {
    connectionString: testUrl,
    max: Number.isFinite(maxPool) && maxPool > 0 ? maxPool : 5,
    idleTimeoutMillis:
      Number.isFinite(idleTimeout) && idleTimeout > 0 ? idleTimeout : 30000,
    connectionTimeoutMillis:
      Number.isFinite(connTimeout) && connTimeout > 0 ? connTimeout : 5000,
  };

  assertSafeTestDatabase(config, env);
  return config;
}
