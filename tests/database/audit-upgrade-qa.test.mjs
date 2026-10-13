import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import { loadTestDatabaseConfig } from '../../dist/packages/database/src/config.js';
import { createDatabasePool } from '../../dist/packages/database/src/pool.js';
import {
  loadMigrationFiles,
  runMigrations,
} from '../../dist/packages/database/src/migrator.js';

test('AUDIT-005 upgrade preserves rows, restores a missing guard, and rejects concurrent tampering', async (t) => {
  const expected = process.env.VERIFY_QA_SYSTEM_IDENTIFIER;
  assert.ok(expected, 'Explicit owned QA cluster required');
  const config = loadTestDatabaseConfig();
  const pool = createDatabasePool(config);
  t.after(() => pool.end());
  assert.equal(
    (
      await pool.query(
        'SELECT system_identifier::text AS id FROM pg_control_system()',
      )
    ).rows[0].id,
    expected,
  );
  assert.equal(new URL(config.connectionString).hostname, '127.0.0.1');
  const migrations = loadMigrationFiles('packages/database/src/migrations');
  const upgrade = migrations.find(
    (m) => m.id === '0018_audit_events_immutable',
  );
  assert.ok(upgrade);
  await runMigrations(
    pool,
    migrations.filter((m) => m.id < upgrade.id),
  );
  const ws = crypto.randomUUID(),
    id = crypto.randomUUID();
  await pool.query(
    "INSERT INTO workspaces(id,name) VALUES($1,'Audit upgrade QA')",
    [ws],
  );
  await pool.query(
    "INSERT INTO audit_events(id,workspace_id,action,entity_type,entity_id,request_id) VALUES($1,$2,'original','qa','synthetic','qa')",
    [id, ws],
  );
  const read = async () =>
    (
      await pool.query(
        'SELECT row_to_json(a) AS row FROM audit_events a WHERE id=$1',
        [id],
      )
    ).rows;
  const before = await read();
  // Rehearse legacy upgrade on owned synthetic data, never on operational tables.
  await pool.query('DROP TRIGGER trg_audit_events_immutable ON audit_events');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(upgrade.sql);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  const count = async () =>
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='trg_audit_events_immutable' AND tgrelid='audit_events'::regclass",
      )
    ).rows[0].n;
  assert.equal(
    await count(),
    0,
    'DDL rollback restores pre-upgrade missing-guard state',
  );
  assert.deepEqual(await read(), before);
  await runMigrations(pool, migrations);
  assert.equal(await count(), 1);
  assert.equal((await runMigrations(pool, migrations)).appliedCount, 0);
  const writes = await Promise.allSettled([
    pool.query("UPDATE audit_events SET action='tampered' WHERE id=$1", [id]),
    pool.query('DELETE FROM audit_events WHERE id=$1', [id]),
  ]);
  for (const result of writes) {
    assert.equal(result.status, 'rejected');
    assert.match(result.reason.message, /audit_events is append-only/);
  }
  assert.deepEqual(await read(), before);
  await Promise.all(
    [1, 2].map((n) =>
      pool.query(
        "INSERT INTO audit_events(workspace_id,action,entity_type,entity_id,request_id) VALUES($1,'append','qa','synthetic',$2)",
        [ws, 'parallel-' + n],
      ),
    ),
  );
  assert.equal(
    Number(
      (
        await pool.query(
          'SELECT count(*) FROM audit_events WHERE workspace_id=$1',
          [ws],
        )
      ).rows[0].count,
    ),
    3,
  );
});
