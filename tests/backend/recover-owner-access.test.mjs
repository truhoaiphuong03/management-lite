import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { loadTestDatabaseConfig } from '../../dist/packages/database/src/config.js';
import { createDatabasePool } from '../../dist/packages/database/src/pool.js';
import {
  hashPassword,
  verifyPassword,
} from '../../dist/packages/security/src/password.js';

test('recovery CLI refuses implicit database selection without touching an Owner', () => {
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    NODE_ENV: 'test',
  };
  const child = spawnSync(
    process.execPath,
    ['scripts/recover-owner-access.mjs'],
    { env, input: 'n\n', encoding: 'utf8', timeout: 5000 },
  );
  assert.equal(child.status, 1);
  assert.match(child.stderr, /TEST_DATABASE_URL|Safety Guard/);
});

test('recovery SQL regression uses only a disposable Staff fixture and preserves every Owner credential', async () => {
  const pool = createDatabasePool(loadTestDatabaseConfig());
  const client = await pool.connect();
  const id = randomUUID(),
    ws = randomUUID();
  const initial = randomBytes(24).toString('hex'),
    next = randomBytes(24).toString('hex');
  try {
    const owners = () =>
      client.query(
        "SELECT uc.user_id,uc.password_hash,uc.credential_version FROM user_credentials uc WHERE EXISTS(SELECT 1 FROM workspace_memberships wm WHERE wm.user_id=uc.user_id AND wm.role='owner') ORDER BY uc.user_id",
      );
    const before = (await owners()).rows;
    await client.query('BEGIN');
    await client.query(
      "INSERT INTO workspaces(id,name) VALUES($1,'Disposable recovery regression')",
      [ws],
    );
    await client.query(
      "INSERT INTO users(id,username_normalized,email_normalized,status) VALUES($1::uuid,$1::text,$1::text || '@test.invalid','active')",
      [id],
    );
    await client.query(
      'INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)',
      [id, await hashPassword(initial)],
    );
    await client.query(
      "INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES($1,$2,'staff','active')",
      [ws, id],
    );
    const row = (
      await client.query(
        'UPDATE user_credentials SET password_hash=$1,credential_version=credential_version+1,password_changed_at=NOW() WHERE user_id=$2 RETURNING password_hash,credential_version',
        [await hashPassword(next), id],
      )
    ).rows[0];
    assert.equal(row.credential_version, 2);
    assert.equal(await verifyPassword(next, row.password_hash), true);
    assert.equal(await verifyPassword(initial, row.password_hash), false);
    await client.query('SAVEPOINT failure_probe');
    await assert.rejects(
      client.query('SELECT * FROM nonexistent_recovery_regression_table'),
    );
    await client.query('ROLLBACK TO SAVEPOINT failure_probe');
    assert.equal(
      (
        await client.query(
          'SELECT credential_version FROM user_credentials WHERE user_id=$1',
          [id],
        )
      ).rows[0].credential_version,
      2,
    );
    assert.deepEqual((await owners()).rows, before);
    await client.query('ROLLBACK');
    assert.equal(
      (await client.query('SELECT 1 FROM users WHERE id=$1', [id])).rowCount,
      0,
    );
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end();
  }
});
