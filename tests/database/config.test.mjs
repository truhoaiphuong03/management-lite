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

test('isSafeTestDatabase and assertSafeTestDatabase enforce multi-factor database isolation', async () => {
  const { isSafeTestDatabase, assertSafeTestDatabase } = await import(
    `file://${resolve(root, 'dist/packages/database/src/config.js')}`
  );

  const safeUrl = 'postgresql://usr:pass@localhost:5432/mglite_isolated_test';

  // 1. Rejects NODE_ENV === 'production'
  const prodCheck = isSafeTestDatabase(
    {
      connectionString: safeUrl,
      max: 5,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: 1000,
    },
    { NODE_ENV: 'production', TEST_DATABASE_URL: safeUrl },
  );
  assert.equal(prodCheck.safe, false);
  assert.match(prodCheck.reason || '', /NODE_ENV is set to "production"/);

  assert.throws(
    () => {
      assertSafeTestDatabase(
        {
          connectionString: safeUrl,
          max: 5,
          idleTimeoutMillis: 1000,
          connectionTimeoutMillis: 1000,
        },
        { NODE_ENV: 'production', TEST_DATABASE_URL: safeUrl },
      );
    },
    {
      message:
        /\[Database Safety Guard\] Prohibited: NODE_ENV is set to "production"/,
    },
  );

  // 2. Rejects NODE_ENV === 'staging'
  const stagingCheck = isSafeTestDatabase(
    {
      connectionString: safeUrl,
      max: 5,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: 1000,
    },
    { NODE_ENV: 'staging', TEST_DATABASE_URL: safeUrl },
  );
  assert.equal(stagingCheck.safe, false);
  assert.match(stagingCheck.reason || '', /NODE_ENV is set to "staging"/);

  // 3. Rejects missing connection string / TEST_DATABASE_URL
  const missingCheck = isSafeTestDatabase(
    { max: 5, idleTimeoutMillis: 1000, connectionTimeoutMillis: 1000 },
    { NODE_ENV: 'test' },
  );
  assert.equal(missingCheck.safe, false);
  assert.match(
    missingCheck.reason || '',
    /TEST_DATABASE_URL is not explicitly configured/,
  );

  // 4. Rejects remote production or staging hostnames
  for (const dangerousHost of [
    'prod-db.corp.net',
    'production-cluster.io',
    'live-aurora.aws.com',
    'staging-db.internal',
  ]) {
    const hostCheck = isSafeTestDatabase(
      {
        connectionString: `postgresql://usr:pass@${dangerousHost}:5432/my_test_db`,
        max: 5,
        idleTimeoutMillis: 1000,
        connectionTimeoutMillis: 1000,
      },
      {
        NODE_ENV: 'test',
        TEST_DATABASE_URL: `postgresql://usr:pass@${dangerousHost}:5432/my_test_db`,
      },
    );
    assert.equal(hostCheck.safe, false);
    assert.match(hostCheck.reason || '', /production or staging host/);
  }

  // 5. Rejects system or default application database names
  for (const sysDb of [
    'management_lite',
    'postgres',
    'template1',
    'master',
    'defaultdb',
    'production',
    'staging',
  ]) {
    const sysCheck = isSafeTestDatabase(
      {
        connectionString: `postgresql://usr:pass@localhost:5432/${sysDb}`,
        max: 5,
        idleTimeoutMillis: 1000,
        connectionTimeoutMillis: 1000,
      },
      {
        NODE_ENV: 'test',
        TEST_DATABASE_URL: `postgresql://usr:pass@localhost:5432/${sysDb}`,
      },
    );
    assert.equal(sysCheck.safe, false);
    assert.match(
      sysCheck.reason || '',
      /default, application, or system database name/,
    );
  }

  // 6. Rejects databases without 'test' in their name
  const noTestCheck = isSafeTestDatabase(
    {
      connectionString: 'postgresql://usr:pass@localhost:5432/crm_app',
      max: 5,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: 1000,
    },
    {
      NODE_ENV: 'test',
      TEST_DATABASE_URL: 'postgresql://usr:pass@localhost:5432/crm_app',
    },
  );
  assert.equal(noTestCheck.safe, false);
  assert.match(noTestCheck.reason || '', /does not contain a test designation/);

  // 7. Rejects invalid protocols
  const protocolCheck = isSafeTestDatabase(
    {
      connectionString: 'http://localhost:5432/test_db',
      max: 5,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: 1000,
    },
    { NODE_ENV: 'test', TEST_DATABASE_URL: 'http://localhost:5432/test_db' },
  );
  assert.equal(protocolCheck.safe, false);
  assert.match(protocolCheck.reason || '', /Invalid protocol/);

  // 8. Rejects Windows production database management_lite_test on port 55432
  const winProdDbUrl =
    'postgresql://usr:pass@127.0.0.1:55432/management_lite_test';
  const winProdCheck = isSafeTestDatabase(
    {
      connectionString: winProdDbUrl,
      max: 5,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: 1000,
    },
    { NODE_ENV: 'test', TEST_DATABASE_URL: winProdDbUrl },
  );
  assert.equal(winProdCheck.safe, false);
  assert.match(
    winProdCheck.reason || '',
    /active Windows production database/,
  );

  // 9. Accepts properly isolated test database
  const validCheck = isSafeTestDatabase(
    {
      connectionString: safeUrl,
      max: 5,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: 1000,
    },
    { NODE_ENV: 'test', TEST_DATABASE_URL: safeUrl },
  );
  assert.equal(validCheck.safe, true);
  assert.doesNotThrow(() => {
    assertSafeTestDatabase(
      {
        connectionString: safeUrl,
        max: 5,
        idleTimeoutMillis: 1000,
        connectionTimeoutMillis: 1000,
      },
      { NODE_ENV: 'test', TEST_DATABASE_URL: safeUrl },
    );
  });
});

test('verifyTestInstanceConfirmation enforces explicit operator confirmation of test instances', async () => {
  const { verifyTestInstanceConfirmation } = await import(
    `file://${resolve(root, 'dist/packages/database/src/config.js')}`
  );

  // 1. Unconfirmed when variable is unset
  const res1 = verifyTestInstanceConfirmation({});
  assert.equal(res1.confirmed, false);
  assert.match(res1.reason || '', /Unconfirmed test instance/);

  // 2. Unconfirmed when variable is not 'true' or '1'
  const res2 = verifyTestInstanceConfirmation({
    CONFIRM_ISOLATED_TEST_DB: 'false',
  });
  assert.equal(res2.confirmed, false);

  // 3. Confirmed when explicitly set to 'true' or '1'
  assert.equal(
    verifyTestInstanceConfirmation({ CONFIRM_ISOLATED_TEST_DB: 'true' })
      .confirmed,
    true,
  );
  assert.equal(
    verifyTestInstanceConfirmation({ CONFIRM_ISOLATED_TEST_DB: '1' }).confirmed,
    true,
  );
});

test('loadTestDatabaseConfig requires both explicit TEST_DATABASE_URL and CONFIRM_ISOLATED_TEST_DB=true', async () => {
  const { loadTestDatabaseConfig } = await import(
    `file://${resolve(root, 'dist/packages/database/src/config.js')}`
  );

  const validUrl =
    'postgresql://testuser:testpass@localhost:5432/management_lite_test';

  // 1. Throws fail-closed when TEST_DATABASE_URL is not set (zero fallback to defaults)
  assert.throws(
    () => {
      loadTestDatabaseConfig({ CONFIRM_ISOLATED_TEST_DB: 'true' });
    },
    { message: /TEST_DATABASE_URL is not set/ },
  );

  // 2. Throws fail-closed if only DATABASE_URL is set (no fallback)
  assert.throws(
    () => {
      loadTestDatabaseConfig({
        DATABASE_URL: 'postgresql://localhost:5432/management_lite_test',
        CONFIRM_ISOLATED_TEST_DB: 'true',
      });
    },
    { message: /TEST_DATABASE_URL is not set/ },
  );

  // 3. Throws fail-closed if TEST_DATABASE_URL is set but CONFIRM_ISOLATED_TEST_DB is missing
  assert.throws(
    () => {
      loadTestDatabaseConfig({
        TEST_DATABASE_URL: validUrl,
      });
    },
    { message: /Unconfirmed test instance/ },
  );

  // 4. Succeeds when both TEST_DATABASE_URL and CONFIRM_ISOLATED_TEST_DB=true are provided
  const config = loadTestDatabaseConfig({
    TEST_DATABASE_URL: validUrl,
    CONFIRM_ISOLATED_TEST_DB: 'true',
  });
  assert.equal(config.connectionString, validUrl);

  // 5. Fails closed if TEST_DATABASE_URL points to non-test db
  assert.throws(
    () => {
      loadTestDatabaseConfig({
        TEST_DATABASE_URL: 'postgresql://localhost:5432/management_lite',
        CONFIRM_ISOLATED_TEST_DB: 'true',
      });
    },
    { message: /\[Database Safety Guard\]/ },
  );
});

test('credential protection: sensitive credentials in TEST_DATABASE_URL are never leaked in logs, error messages, or safety check results', async () => {
  const {
    isSafeTestDatabase,
    assertSafeTestDatabase,
    sanitizeDatabaseConfig,
    sanitizeErrorMessage,
    loadTestDatabaseConfig,
  } = await import(
    `file://${resolve(root, 'dist/packages/database/src/config.js')}`
  );

  const fakeSecret = 'SUPER_SECRET_FAKE_PASSWORD_9876543210';
  const fakeSecretUrl = `postgresql://app_user:${fakeSecret}@localhost:5432/management_lite_test`;

  // 1. sanitizeDatabaseConfig redacts the secret
  const sanitized = sanitizeDatabaseConfig({
    connectionString: fakeSecretUrl,
    max: 5,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 1000,
  });
  const sanitizedJson = JSON.stringify(sanitized);
  assert.ok(
    !sanitizedJson.includes(fakeSecret),
    'sanitized config must not leak fake password',
  );
  assert.ok(sanitizedJson.includes('***'));

  // 2. sanitizeErrorMessage redacts fake password in postgres URL and error text
  const rawError = `Connection failed to ${fakeSecretUrl} using password="${fakeSecret}"`;
  const sanitizedErr = sanitizeErrorMessage(rawError);
  assert.ok(
    !sanitizedErr.includes(fakeSecret),
    'sanitized error message must not leak fake password',
  );
  assert.ok(sanitizedErr.includes('***'));

  // 3. Rejection / validation error message from isSafeTestDatabase / assertSafeTestDatabase never echoes raw credentials
  const invalidUrlWithSecret = `postgresql://app_user:${fakeSecret}@prod-host.internal:5432/management_lite`;
  const result = isSafeTestDatabase(
    {
      connectionString: invalidUrlWithSecret,
      max: 5,
      idleTimeoutMillis: 1000,
      connectionTimeoutMillis: 1000,
    },
    { NODE_ENV: 'test', TEST_DATABASE_URL: invalidUrlWithSecret },
  );
  assert.equal(result.safe, false);
  assert.ok(
    !result.reason?.includes(fakeSecret),
    'rejection reason must not contain password',
  );

  assert.throws(
    () => {
      assertSafeTestDatabase(
        {
          connectionString: invalidUrlWithSecret,
          max: 5,
          idleTimeoutMillis: 1000,
          connectionTimeoutMillis: 1000,
        },
        { NODE_ENV: 'test', TEST_DATABASE_URL: invalidUrlWithSecret },
      );
    },
    (err) => {
      assert.ok(
        !err.message.includes(fakeSecret),
        'thrown exception must not contain password',
      );
      return true;
    },
  );

  // 4. loadTestDatabaseConfig rejection never echoes raw password in error message
  assert.throws(
    () => {
      loadTestDatabaseConfig({
        TEST_DATABASE_URL: invalidUrlWithSecret,
        CONFIRM_ISOLATED_TEST_DB: 'true',
      });
    },
    (err) => {
      assert.ok(
        !err.message.includes(fakeSecret),
        'loadTestDatabaseConfig error must not leak password',
      );
      return true;
    },
  );
});
