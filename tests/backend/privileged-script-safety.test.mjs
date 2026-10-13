import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  loadExplicitDatabaseConfig,
  loadQaEndpoint,
  loadConfirmedTestConfig,
} from '../../scripts/explicit-database.mjs';
import { bootstrapOwner } from '../../scripts/bootstrap-owner.mjs';
import { loadTestDatabaseConfig } from '../../dist/packages/database/src/config.js';
import { createDatabasePool } from '../../dist/packages/database/src/pool.js';
import { verifyPassword } from '../../dist/packages/security/src/password.js';
import { addAdminAccount } from '../../scripts/add-admin.mjs';

test('administrative targets refuse PG defaults and TEST_DATABASE_URL fallback', () => {
  for (const env of [
    {},
    { PGHOST: '127.0.0.1', PGDATABASE: 'app', PGPASSWORD: 'synthetic' },
    { TEST_DATABASE_URL: 'postgresql://127.0.0.1/isolated_test' },
  ]) {
    assert.throws(
      () => loadExplicitDatabaseConfig(env),
      /explicit DATABASE_URL/,
    );
  }
  for (const url of [
    'invalid',
    'https://127.0.0.1/db',
    'postgresql://127.0.0.1',
  ])
    assert.throws(() => loadExplicitDatabaseConfig({}, url));
});
test('QA writers reject missing, unconfirmed and application-colliding targets', () => {
  assert.throws(() => loadConfirmedTestConfig({}), /TEST_DATABASE_URL/);
  const url = 'postgresql://127.0.0.1:55812/synthetic_test';
  assert.throws(
    () => loadConfirmedTestConfig({ TEST_DATABASE_URL: url }),
    /Unconfirmed/,
  );
  assert.throws(
    () =>
      loadConfirmedTestConfig({
        NODE_ENV: 'test',
        TEST_DATABASE_URL: url,
        DATABASE_URL: url,
        CONFIRM_ISOLATED_TEST_DB: 'true',
      }),
    /same database/,
  );
});
test('bootstrap refuses missing confirmation or passwords before connecting', async () => {
  const env = { DATABASE_URL: 'postgresql://127.0.0.1:1/never_connect' };
  await assert.rejects(bootstrapOwner(env), /confirmation/);
  await assert.rejects(
    bootstrapOwner({
      ...env,
      CONFIRM_BOOTSTRAP_OWNER: 'create-new-installation',
    }),
    /OWNER_PASSWORD/,
  );
  await assert.rejects(
    bootstrapOwner({
      ...env,
      CONFIRM_BOOTSTRAP_OWNER: 'create-new-installation',
      OWNER_PASSWORD: randomBytes(24).toString('hex'),
    }),
    /STAFF_PASSWORD/,
  );
});
test('bootstrap CLI does not disclose credentials or accept command-line secrets', () => {
  const secret = randomBytes(24).toString('hex');
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    OWNER_PASSWORD: secret,
    STAFF_PASSWORD: secret,
  };
  for (const args of [[], ['--owner-password', secret]]) {
    const r = spawnSync(
      process.execPath,
      ['scripts/bootstrap-owner.mjs', ...args],
      { env, encoding: 'utf8', timeout: 5000 },
    );
    assert.equal(r.status, 1);
    assert.equal((r.stdout + r.stderr).includes(secret), false);
  }
});
test('admin API cannot infer a database from ambient PG defaults', async () => {
  const old = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    await assert.rejects(
      addAdminAccount({ password: randomBytes(24).toString('hex') }),
      /explicit DATABASE_URL/,
    );
  } finally {
    if (old !== undefined) process.env.DATABASE_URL = old;
  }
});
test('first-install bootstrap is atomic, serialized, cannot reset or promote existing identities', async () => {
  const cfg = loadTestDatabaseConfig();
  const pool = createDatabasePool(cfg);
  const ownerPassword = randomBytes(24).toString('hex'),
    staffPassword = randomBytes(24).toString('hex');
  const env = {
    DATABASE_URL: cfg.connectionString,
    CONFIRM_BOOTSTRAP_OWNER: 'create-new-installation',
    OWNER_PASSWORD: ownerPassword,
    STAFF_PASSWORD: staffPassword,
  };
  try {
    assert.equal(
      (await pool.query('SELECT count(*)::int n FROM users')).rows[0].n,
      0,
    );
    const attempts = await Promise.allSettled([
      bootstrapOwner(env),
      bootstrapOwner(env),
    ]);
    assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter((r) => r.status === 'rejected').length, 1);
    const snapshot = async () =>
      JSON.stringify(
        (
          await pool.query(
            'SELECT u.id,u.username_normalized,c.password_hash,c.credential_version,w.role,w.status FROM users u JOIN user_credentials c ON c.user_id=u.id JOIN workspace_memberships w ON w.user_id=u.id ORDER BY u.id',
          )
        ).rows,
      );
    const before = await snapshot();
    const rows = (
      await pool.query(
        'SELECT u.username_normalized,c.password_hash,w.role FROM users u JOIN user_credentials c ON c.user_id=u.id JOIN workspace_memberships w ON w.user_id=u.id',
      )
    ).rows;
    assert.equal(rows.length, 2);
    assert.equal(
      await verifyPassword(
        ownerPassword,
        rows.find((r) => r.role === 'owner').password_hash,
      ),
      true,
    );
    assert.equal(
      await verifyPassword(
        staffPassword,
        rows.find((r) => r.role === 'staff').password_hash,
      ),
      true,
    );
    await assert.rejects(
      bootstrapOwner({
        ...env,
        OWNER_PASSWORD: randomBytes(24).toString('hex'),
      }),
      /already contains/,
    );
    await assert.rejects(
      bootstrapOwner({
        ...env,
        OWNER_USERNAME: 'staff',
        OWNER_EMAIL: 'staff@management-lite.local',
        STAFF_USERNAME: 'newstaff',
        STAFF_EMAIL: 'newstaff@test.invalid',
      }),
      /already contains/,
    );
    assert.equal(
      await snapshot(),
      before,
      'Existing credential versions and roles must remain unchanged',
    );
    assert.equal(
      (await pool.query('SELECT count(*)::int n FROM workspaces')).rows[0].n,
      1,
    );
  } finally {
    await pool.end();
  }
});

test('external QA endpoints fail closed without explicit nonoperational localhost targets', () => {
  for (const value of [
    undefined,
    'http://127.0.0.1:3018',
    'http://127.0.0.1:3008',
    'https://example.com',
  ])
    assert.throws(() => loadQaEndpoint(value));
  assert.equal(
    loadQaEndpoint('http://127.0.0.1:3038'),
    'http://127.0.0.1:3038',
  );
});

test('legacy QA scripts refuse missing credentials before opening Chrome or contacting an API', () => {
  const scripts = [
    'test-categories-chrome',
    'chrome-fin-entry-modal-qa',
    'chrome-fin-pagination-qa',
    'chrome-fin-live-smoke',
    'chrome-fin-all-screens-qa',
    'chrome-fin-icon-actions-qa',
    'chrome-fin-network-check',
    'chrome-fin-redesign-shots',
    'chrome-fin-plan-qa',
    'chrome-fin-pager-live-qa',
    'fin-final-api-qa',
    'fin-pagination-api-qa',
  ];
  for (const name of scripts) {
    const r = spawnSync(process.execPath, ['scripts/' + name + '.mjs'], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(r.status, 1, name);
    assert.match(r.stderr, /Explicit ADMIN_PASSWORD/, name);
    const blocked = spawnSync(process.execPath, ['scripts/' + name + '.mjs'], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        ADMIN_PASSWORD: randomBytes(24).toString('hex'),
        QA_WEB_BASE: 'http://127.0.0.1:3017',
        QA_API_BASE: 'http://127.0.0.1:3018',
      },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(blocked.status, 1, name);
    assert.match(blocked.stderr, /Operational/, name);
  }
});

test('capture and login QA scripts refuse implicit or operational endpoints before launching Chrome', () => {
  for (const name of [
    'capture-anti-fix-66',
    'capture-anti-implement-61',
    'test-login-ui-chrome',
    'test-login-a11y-focus-chrome',
    'capture-ui-final-55',
    'capture-anti-next-64',
    'full-system-qa',
    'chrome-ui-deep-qa',
    'capture-ui-fix-57',
    'capture-ui-refine-53',
  ]) {
    for (const target of [undefined, 'http://127.0.0.1:3017']) {
      const env = { PATH: process.env.PATH, HOME: process.env.HOME };
      if (target) env.QA_WEB_BASE = target;
      const r = spawnSync(process.execPath, ['scripts/' + name + '.mjs'], {
        env,
        encoding: 'utf8',
        timeout: 5000,
      });
      assert.equal(r.status, 1, name);
      assert.match(r.stderr, /explicit isolated QA endpoint|Operational/, name);
    }
  }
});
