import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

test('0037_rename_workspace_toan_gia_phat renames active Hoài Phương Media workspace and preserves non-target rows', async (t) => {
  if (
    process.env.CONFIRM_ISOLATED_TEST_DB !== 'true' ||
    !process.env.TEST_DATABASE_URL
  ) {
    t.skip('Isolated TEST_DATABASE_URL not configured');
    return;
  }

  const { loadTestDatabaseConfig } =
    await import('../../dist/packages/database/src/config.js');
  const { createDatabasePool, closeDatabasePool } =
    await import('../../dist/packages/database/src/pool.js');
  const { loadMigrationFiles, runMigrations } =
    await import('../../dist/packages/database/src/migrator.js');

  const pool = createDatabasePool(loadTestDatabaseConfig(process.env));
  const targetActiveId = randomUUID();
  const suspendedLegacyId = randomUUID();
  const syntheticTestId = randomUUID();

  try {
    const allMigs = loadMigrationFiles(
      resolve('packages/database/src/migrations'),
    );
    await runMigrations(pool, allMigs);

    const mig0037Sql = readFileSync(
      resolve(
        'packages/database/src/migrations/0037_rename_workspace_toan_gia_phat.sql',
      ),
      'utf8',
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO workspaces (id, name, timezone, status) VALUES
          ($1, 'Hoài Phương Media', 'Asia/Ho_Chi_Minh', 'active'),
          ($2, 'Hoài Phương Media', 'Asia/Ho_Chi_Minh', 'suspended'),
          ($3, 'TEST_ISOLATED_WORKSPACE', 'Asia/Ho_Chi_Minh', 'active')`,
        [targetActiveId, suspendedLegacyId, syntheticTestId],
      );

      await client.query(mig0037Sql);

      const res = await client.query(
        `SELECT id, name, status FROM workspaces WHERE id = ANY($1::uuid[])`,
        [[targetActiveId, suspendedLegacyId, syntheticTestId]],
      );
      const byId = new Map(res.rows.map((r) => [r.id, r]));

      assert.equal(
        byId.get(targetActiveId)?.name,
        'THIẾT KẾ IN ẤN TOÀN GIA PHÁT',
      );
      assert.equal(byId.get(suspendedLegacyId)?.name, 'Hoài Phương Media');
      assert.equal(byId.get(syntheticTestId)?.name, 'TEST_ISOLATED_WORKSPACE');

      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  } finally {
    await closeDatabasePool(pool);
  }
});
