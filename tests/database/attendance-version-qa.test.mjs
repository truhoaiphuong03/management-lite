import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import { loadTestDatabaseConfig } from '../../dist/packages/database/src/config.js';
import { createDatabasePool } from '../../dist/packages/database/src/pool.js';
import {
  loadMigrationFiles,
  runMigrations,
} from '../../dist/packages/database/src/migrator.js';

test('ATT snapshot migration preserves old rows, rolls back DDL, replays and blocks rewrite', async (t) => {
  assert.ok(
    process.env.VERIFY_QA_SYSTEM_IDENTIFIER,
    'Owned isolated QA cluster required',
  );
  const pool = createDatabasePool(loadTestDatabaseConfig());
  t.after(() => pool.end());
  assert.equal(
    (
      await pool.query(
        'SELECT system_identifier::text AS id FROM pg_control_system()',
      )
    ).rows[0].id,
    process.env.VERIFY_QA_SYSTEM_IDENTIFIER,
  );
  const migrations = loadMigrationFiles('packages/database/src/migrations');
  const upgrade = migrations.find(
    (row) => row.id === '0017_attendance_version_immutable',
  );
  assert.ok(upgrade);
  await runMigrations(
    pool,
    migrations.filter((row) => row.id < upgrade.id),
  );
  const ws = crypto.randomUUID(),
    user = crypto.randomUUID(),
    emp = crypto.randomUUID(),
    shift = crypto.randomUUID();
  await pool.query(
    "INSERT INTO workspaces(id,name) VALUES($1,'Migration QA')",
    [ws],
  );
  await pool.query(
    'INSERT INTO users(id,username_normalized,email_normalized) VALUES($1,$2,$3)',
    [user, user, `${user}@example.test`],
  );
  await pool.query(
    "INSERT INTO employees(id,workspace_id,employee_code,full_name) VALUES($1,$2,'QA','Migration QA')",
    [emp, ws],
  );
  await pool.query(
    "INSERT INTO attendance_shifts(id,workspace_id,employee_id,clock_in_at,clock_out_at,run_state) VALUES($1,$2,$3,'2026-09-30T16:30:00Z','2026-09-30T18:30:00Z','completed')",
    [shift, ws, emp],
  );
  await pool.query(
    "INSERT INTO attendance_shift_versions(workspace_id,shift_id,version_number,clock_in_at,clock_out_at,worked_seconds,snapshot_hash,created_by) VALUES($1,$2,1,'2026-09-30T16:30:00Z','2026-09-30T18:30:00Z',7200,'synthetic-snapshot',$3)",
    [ws, shift, user],
  );
  const read = async () =>
    (
      await pool.query(
        'SELECT row_to_json(v) AS row FROM attendance_shift_versions v WHERE shift_id=$1',
        [shift],
      )
    ).rows;
  const before = await read();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(upgrade.sql);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int n FROM pg_trigger WHERE tgname='attendance_version_immutable'",
      )
    ).rows[0].n,
    0,
  );
  assert.ok(
    (await runMigrations(pool, migrations)).appliedIds.includes(upgrade.id),
  );
  assert.equal((await runMigrations(pool, migrations)).appliedCount, 0);
  assert.deepEqual(await read(), before);
  await assert.rejects(
    pool.query(
      'UPDATE attendance_shift_versions SET worked_seconds=0 WHERE shift_id=$1',
      [shift],
    ),
    /immutable/,
  );
  await assert.rejects(
    pool.query('DELETE FROM attendance_shift_versions WHERE shift_id=$1', [
      shift,
    ]),
    /immutable/,
  );
  assert.deepEqual(await read(), before);
  // Valid corrections still append a new historical version.
  await pool.query(
    "INSERT INTO attendance_shift_versions(workspace_id,shift_id,version_number,clock_in_at,clock_out_at,worked_seconds,snapshot_hash,created_by) VALUES($1,$2,2,'2026-09-30T16:30:00Z','2026-09-30T18:31:00Z',7260,'synthetic-corrected-snapshot',$3)",
    [ws, shift, user],
  );
  assert.equal((await read()).length, 2);
});
