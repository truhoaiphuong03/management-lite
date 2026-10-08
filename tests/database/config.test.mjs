import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('loadDatabaseConfig parses default values safely', async () => {
  const { loadDatabaseConfig } = await import(
    `file://${resolve(root, 'dist/packages/database/src/config.js')}`
  );

  const config = loadDatabaseConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 5432);
  assert.equal(config.user, 'postgres');
  assert.equal(config.password, '');
  assert.equal(config.database, 'management_lite');
  assert.equal(config.max, 10);
  assert.equal(config.idleTimeoutMillis, 30000);
  assert.equal(config.connectionTimeoutMillis, 5000);
  assert.equal(config.connectionString, undefined);
});

test('loadDatabaseConfig prioritizes DATABASE_URL when present', async () => {
  const { loadDatabaseConfig } = await import(
    `file://${resolve(root, 'dist/packages/database/src/config.js')}`
  );

  const url = 'postgresql://custom_user:secret_pass@db.internal:5433/prod_db';
  const config = loadDatabaseConfig({
    DATABASE_URL: url,
    PGHOST: 'should_ignore',
    DB_POOL_MAX: '25',
  });

  assert.equal(config.connectionString, url);
  assert.equal(config.max, 25);
  assert.equal(config.host, undefined);
});

test('sanitizeDatabaseConfig redacts passwords in connection string and plain config', async () => {
  const { loadDatabaseConfig, sanitizeDatabaseConfig } = await import(
    `file://${resolve(root, 'dist/packages/database/src/config.js')}`
  );

  // 1. Connection string with password
  const configWithUrl = loadDatabaseConfig({
    DATABASE_URL:
      'postgresql://admin:super_secret_password@db.cloud.net:5432/mglite',
  });
  const sanitizedUrl = sanitizeDatabaseConfig(configWithUrl);
  assert.ok(!JSON.stringify(sanitizedUrl).includes('super_secret_password'));
  assert.equal(
    sanitizedUrl.connectionString,
    'postgresql://admin:***@db.cloud.net:5432/mglite',
  );

  // 2. Individual fields with password
  const configWithFields = loadDatabaseConfig({
    PGUSER: 'admin',
    PGPASSWORD: 'another_plain_secret',
    PGDATABASE: 'test_db',
  });
  const sanitizedFields = sanitizeDatabaseConfig(configWithFields);
  assert.ok(!JSON.stringify(sanitizedFields).includes('another_plain_secret'));
  assert.equal(sanitizedFields.password, '***');
});

test('sanitizeErrorMessage strips credentials from error strings', async () => {
  const { sanitizeErrorMessage } = await import(
    `file://${resolve(root, 'dist/packages/database/src/config.js')}`
  );

  const rawUrlError =
    'Connection failed to postgresql://dbuser:my_secret_token@10.0.0.1:5432/main_db: ECONNREFUSED';
  const sanitizedUrl = sanitizeErrorMessage(rawUrlError);
  assert.ok(!sanitizedUrl.includes('my_secret_token'));
  assert.match(
    sanitizedUrl,
    /postgresql:\/\/dbuser:\*\*\*@10\.0\.0\.1:5432\/main_db/,
  );

  const rawParamError =
    'Failed to authenticate with password="super_secret_123" for user app';
  const sanitizedParam = sanitizeErrorMessage(rawParamError);
  assert.ok(!sanitizedParam.includes('super_secret_123'));
  assert.match(sanitizedParam, /password="\*\*\*"/);
});

test('isSafeTestDatabase and assertSafeTestDatabase enforce strict database isolation', async () => {
  const { isSafeTestDatabase, assertSafeTestDatabase } = await import(
    `file://${resolve(root, 'dist/packages/database/src/config.js')}`
  );

  // 1. Rejects NODE_ENV === 'production'
  const prodCheck = isSafeTestDatabase(
    {
      database: 'my_test_db',
      max: 5,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: 1000,
    },
    { NODE_ENV: 'production' },
  );
  assert.equal(prodCheck.safe, false);
  assert.match(prodCheck.reason || '', /NODE_ENV is set to "production"/);

  assert.throws(
    () => {
      assertSafeTestDatabase(
        {
          database: 'my_test_db',
          max: 5,
          idleTimeoutMillis: 1000,
          connectionTimeoutMillis: 1000,
        },
        { NODE_ENV: 'production' },
      );
    },
    {
      message:
        /\[Database Safety Guard\] Prohibited: NODE_ENV is set to "production"/,
    },
  );

  // 2. Rejects default production database name 'management_lite'
  const defaultDbCheck = isSafeTestDatabase(
    {
      database: 'management_lite',
      max: 5,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: 1000,
    },
    { NODE_ENV: 'test' },
  );
  assert.equal(defaultDbCheck.safe, false);
  assert.match(
    defaultDbCheck.reason || '',
    /default or production database name/,
  );

  // 3. Rejects system databases (postgres, template1, master)
  for (const sysDb of ['postgres', 'template1', 'master', 'defaultdb']) {
    const sysCheck = isSafeTestDatabase(
      {
        database: sysDb,
        max: 5,
        idleTimeoutMillis: 1000,
        connectionTimeoutMillis: 1000,
      },
      { NODE_ENV: 'test' },
    );
    assert.equal(sysCheck.safe, false);
  }

  // 4. Rejects databases without 'test' in their name
  const noTestCheck = isSafeTestDatabase(
    {
      connectionString: 'postgresql://usr:pass@localhost:5432/crm_app_staging',
      max: 5,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: 1000,
    },
    { NODE_ENV: 'test' },
  );
  assert.equal(noTestCheck.safe, false);
  assert.match(noTestCheck.reason || '', /does not contain "test"/);

  // 5. Accepts database names explicitly containing 'test'
  const validTestDb1 = isSafeTestDatabase(
    {
      database: 'management_lite_test',
      max: 5,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: 1000,
    },
    { NODE_ENV: 'test' },
  );
  assert.equal(validTestDb1.safe, true);

  const validTestDb2 = isSafeTestDatabase(
    {
      connectionString:
        'postgresql://usr:pass@localhost:5432/mglite_isolated_test',
      max: 5,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: 1000,
    },
    { NODE_ENV: 'test' },
  );
  assert.equal(validTestDb2.safe, true);
  assert.doesNotThrow(() => {
    assertSafeTestDatabase(
      {
        connectionString:
          'postgresql://usr:pass@localhost:5432/mglite_isolated_test',
        max: 5,
        idleTimeoutMillis: 1000,
        connectionTimeoutMillis: 1000,
      },
      { NODE_ENV: 'test' },
    );
  });
});

test('loadTestDatabaseConfig prioritizes TEST_DATABASE_URL and blocks non-test databases', async () => {
  const { loadTestDatabaseConfig } = await import(
    `file://${resolve(root, 'dist/packages/database/src/config.js')}`
  );

  // 1. Defaults to management_lite_test when no env vars provided
  const defaultConfig = loadTestDatabaseConfig({});
  assert.equal(defaultConfig.database, 'management_lite_test');

  // 2. Uses TEST_DATABASE_URL over DATABASE_URL
  const config = loadTestDatabaseConfig({
    DATABASE_URL: 'postgresql://localhost:5432/ignored_test_db',
    TEST_DATABASE_URL: 'postgresql://localhost:5432/preferred_test_db',
  });
  assert.equal(
    config.connectionString,
    'postgresql://localhost:5432/preferred_test_db',
  );

  // 3. Fails closed if DATABASE_URL or TEST_DATABASE_URL points to non-test db
  assert.throws(
    () => {
      loadTestDatabaseConfig({
        DATABASE_URL: 'postgresql://localhost:5432/management_lite',
      });
    },
    { message: /\[Database Safety Guard\]/ },
  );
});
