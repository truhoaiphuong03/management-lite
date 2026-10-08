import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('calculateChecksum produces deterministic SHA-256 for SQL strings', async () => {
  const { calculateChecksum } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );

  const sql1 = 'CREATE TABLE test (id int);\r\n';
  const sql2 = 'CREATE TABLE test (id int);\n';
  assert.equal(calculateChecksum(sql1), calculateChecksum(sql2));
  assert.match(calculateChecksum(sql1), /^[a-f0-9]{64}$/);
});

test('loadMigrationFiles loads M00 and M01 migrations in deterministic sequence', async () => {
  const { loadMigrationFiles } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );

  const migrations = loadMigrationFiles(
    resolve(root, 'packages/database/src/migrations'),
  );

  assert.equal(migrations.length, 2);
  assert.equal(migrations[0]?.id, '0001_m00_prerequisites');
  assert.equal(migrations[1]?.id, '0002_m01_workspace_user_audit_idempotency');

  // Assert valid SHA-256 checksums
  assert.match(migrations[0]?.checksum || '', /^[a-f0-9]{64}$/);
  assert.match(migrations[1]?.checksum || '', /^[a-f0-9]{64}$/);
});

test('M01 migration SQL conforms strictly to canonical doc 20, 21, and 58 specifications', async () => {
  const { loadMigrationFiles } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );

  const migrations = loadMigrationFiles(
    resolve(root, 'packages/database/src/migrations'),
  );
  const m01 = migrations.find(
    (m) => m.id === '0002_m01_workspace_user_audit_idempotency',
  );
  assert.ok(m01);

  const sql = m01.sql;

  // 1. Workspaces table & columns
  assert.match(sql, /CREATE TABLE IF NOT EXISTS workspaces/);
  assert.match(sql, /timezone text NOT NULL DEFAULT 'Asia\/Ho_Chi_Minh'/);
  assert.match(sql, /status text NOT NULL DEFAULT 'active'/);
  assert.match(sql, /CONSTRAINT uq_workspaces_id UNIQUE \(id\)/);

  // 2. Users table (global identity, version, checks)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS users/);
  assert.match(sql, /username_normalized text NOT NULL/);
  assert.match(sql, /email_normalized text NOT NULL/);
  assert.match(sql, /version integer NOT NULL DEFAULT 1 CHECK \(version > 0\)/);
  assert.match(sql, /CONSTRAINT uq_users_username UNIQUE/);
  assert.match(sql, /CONSTRAINT uq_users_email UNIQUE/);

  // 3. Idempotency records (T1/T2: tenant + actor + operation_key)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS idempotency_records/);
  assert.match(sql, /workspace_id uuid NOT NULL REFERENCES workspaces/);
  assert.match(sql, /actor_user_id uuid NOT NULL REFERENCES users/);
  assert.match(sql, /operation_key text NOT NULL/);
  assert.match(sql, /request_fingerprint text NOT NULL/);
  assert.match(
    sql,
    /CONSTRAINT uq_idempotency_records UNIQUE \(workspace_id, actor_user_id, operation_key\)/,
  );
  assert.match(sql, /CREATE INDEX IF NOT EXISTS ix_idempotency_expiry/);

  // 4. Audit events (T3: append-only, tenant-isolated)
  assert.match(sql, /CREATE TABLE IF NOT EXISTS audit_events/);
  assert.match(sql, /workspace_id uuid NOT NULL REFERENCES workspaces/);
  assert.match(sql, /actor_user_id uuid NULL REFERENCES users/);
  assert.match(sql, /metadata_sanitized jsonb NOT NULL/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS ix_audit_cursor/);

  // 5. Immutability trigger on audit_events
  assert.match(sql, /prevent_audit_events_mutation/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON audit_events/);
});

test('runMigrations fails closed when migration checksum mismatch is detected', async () => {
  const { runMigrations } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );

  // Mock pool client simulating an already recorded migration with differing checksum
  const queries = [];
  const mockClient = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (sql.includes('SELECT pg_advisory_lock')) return { rows: [] };
      if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations'))
        return { rows: [] };
      if (sql.includes('SELECT id, checksum')) {
        return {
          rows: [
            {
              id: '0001_m00_prerequisites',
              checksum: 'mismatched_checksum_from_tampered_history',
              applied_at: new Date(),
              execution_time_ms: 10,
            },
          ],
        };
      }
      if (sql.includes('SELECT pg_advisory_unlock')) return { rows: [] };
      return { rows: [] };
    },
    release: () => {},
  };

  const mockPool = {
    connect: async () => mockClient,
  };

  const sampleMigrations = [
    {
      id: '0001_m00_prerequisites',
      sql: 'CREATE EXTENSION IF NOT EXISTS pgcrypto;',
      checksum: 'valid_new_checksum',
    },
  ];

  await assert.rejects(
    async () => {
      await runMigrations(mockPool, sampleMigrations);
    },
    {
      name: 'Error',
      message: /Migration checksum mismatch for "0001_m00_prerequisites"/,
    },
  );
});
