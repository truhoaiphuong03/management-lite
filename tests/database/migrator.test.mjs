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

test('loadMigrationFiles loads M00, M01, M02, M02b, M03, M04, and M05 migrations in deterministic sequence', async () => {
  const { loadMigrationFiles } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );

  const migrations = loadMigrationFiles(
    resolve(root, 'packages/database/src/migrations'),
  );

  assert.equal(migrations.length, 7);
  assert.equal(migrations[0]?.id, '0001_m00_prerequisites');
  assert.equal(migrations[1]?.id, '0002_m01_workspace_user_audit_idempotency');
  assert.equal(migrations[2]?.id, '0003_m02_auth_membership_session_outbox');
  assert.equal(migrations[3]?.id, '0004_m02b_user_workspace_bindings');
  assert.equal(migrations[4]?.id, '0005_m03_employees');
  assert.equal(migrations[5]?.id, '0006_m04_attendance');
  assert.equal(migrations[6]?.id, '0007_m05_reports');

  // Assert valid SHA-256 checksums
  assert.match(migrations[0]?.checksum || '', /^[a-f0-9]{64}$/);
  assert.match(migrations[1]?.checksum || '', /^[a-f0-9]{64}$/);
  assert.match(migrations[2]?.checksum || '', /^[a-f0-9]{64}$/);
  assert.match(migrations[3]?.checksum || '', /^[a-f0-9]{64}$/);
  assert.match(migrations[4]?.checksum || '', /^[a-f0-9]{64}$/);
  assert.match(migrations[5]?.checksum || '', /^[a-f0-9]{64}$/);
  assert.match(migrations[6]?.checksum || '', /^[a-f0-9]{64}$/);
});

test('M05 migration SQL conforms strictly to canonical doc 03, 05, 19, 20, 21, 22, 25, 36, 50 report specifications', async () => {
  const { loadMigrationFiles } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );

  const migrations = loadMigrationFiles(
    resolve(root, 'packages/database/src/migrations'),
  );
  const m05 = migrations.find((m) => m.id === '0007_m05_reports');
  assert.ok(m05);

  // Table definitions
  assert.match(m05.sql, /CREATE TABLE IF NOT EXISTS daily_reports/);
  assert.match(m05.sql, /CREATE TABLE IF NOT EXISTS daily_report_entries/);
  assert.match(m05.sql, /CREATE TABLE IF NOT EXISTS daily_report_revisions/);
  assert.match(m05.sql, /CHECK \(status IN \('draft', 'submitted'\)\)/);
  assert.match(
    m05.sql,
    /uq_daily_reports_employee_day UNIQUE \(workspace_id, employee_id, report_date\)/,
  );
  assert.match(
    m05.sql,
    /uq_daily_report_revisions_number UNIQUE \(workspace_id, report_id, revision_number\)/,
  );
  assert.match(m05.sql, /trg_daily_report_revisions_immutable/);
});

test('M04 migration SQL conforms strictly to canonical doc 05, 14, 19, 20, 22, 25, 36 attendance specifications', async () => {
  const { loadMigrationFiles } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );

  const migrations = loadMigrationFiles(
    resolve(root, 'packages/database/src/migrations'),
  );
  const m04 = migrations.find((m) => m.id === '0006_m04_attendance');
  assert.ok(m04);

  // Table definitions
  assert.match(m04.sql, /CREATE TABLE IF NOT EXISTS attendance_shifts/);
  assert.match(m04.sql, /CREATE TABLE IF NOT EXISTS attendance_breaks/);
  assert.match(m04.sql, /CREATE TABLE IF NOT EXISTS attendance_shift_versions/);
  assert.match(m04.sql, /CREATE TABLE IF NOT EXISTS attendance_approvals/);
  assert.match(
    m04.sql,
    /CREATE TABLE IF NOT EXISTS attendance_correction_requests/,
  );
  assert.match(m04.sql, /CREATE TABLE IF NOT EXISTS attendance_adjustments/);
  assert.match(
    m04.sql,
    /CHECK \(run_state IN \('working', 'paused', 'completed'\)\)/,
  );
  assert.match(
    m04.sql,
    /CHECK \(review_state IN \('unreviewed', 'approved', 'rejected', 'needs_review'\)\)/,
  );
});

test('M03 migration SQL conforms strictly to canonical doc 20, 21, and 25 HR employee specifications', async () => {
  const { loadMigrationFiles } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );

  const migrations = loadMigrationFiles(
    resolve(root, 'packages/database/src/migrations'),
  );
  const m03 = migrations.find((m) => m.id === '0005_m03_employees');
  assert.ok(m03);

  // Table definition
  assert.match(m03.sql, /CREATE TABLE IF NOT EXISTS employees/);
  assert.match(
    m03.sql,
    /workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE RESTRICT/,
  );
  assert.match(
    m03.sql,
    /user_id uuid NULL REFERENCES users\(id\) ON DELETE RESTRICT/,
  );
  assert.match(m03.sql, /employee_code text NOT NULL/);
  assert.match(m03.sql, /full_name text NOT NULL/);
  assert.match(
    m03.sql,
    /CHECK \(employment_status IN \('invited', 'active', 'suspended', 'archived'\)\)/,
  );
  assert.match(m03.sql, /is_payroll_eligible boolean NOT NULL DEFAULT true/);
  assert.match(
    m03.sql,
    /CONSTRAINT uq_employees_workspace_code UNIQUE \(workspace_id, employee_code\)/,
  );
  assert.match(
    m03.sql,
    /FOREIGN KEY\s*\(workspace_id,\s*user_id\)\s*REFERENCES\s*workspace_memberships\s*\(workspace_id,\s*user_id\)/,
  );
  assert.match(
    m03.sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS ix_employees_user\s+ON employees\s*\(workspace_id,\s*user_id\)\s+WHERE user_id IS NOT NULL/,
  );
});

test('M02b migration SQL conforms strictly to canonical doc 03, 04, 20, 21, and 36 C06 specifications', async () => {
  const { loadMigrationFiles } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );

  const migrations = loadMigrationFiles(
    resolve(root, 'packages/database/src/migrations'),
  );
  const m02b = migrations.find(
    (m) => m.id === '0004_m02b_user_workspace_bindings',
  );
  assert.ok(m02b);

  const sql = m02b.sql;

  // 1. system_administrators
  assert.match(sql, /CREATE TABLE IF NOT EXISTS system_administrators/);
  assert.match(sql, /user_id uuid PRIMARY KEY REFERENCES users\(id\)/);
  assert.match(
    sql,
    /status text NOT NULL DEFAULT 'active' CHECK \(status IN \('active', 'revoked'\)\)/,
  );
  assert.match(sql, /granted_by_user_id uuid NULL REFERENCES users\(id\)/);
  assert.match(sql, /reason text NOT NULL/);
  assert.match(sql, /revoked_by_user_id uuid NULL REFERENCES users\(id\)/);
  assert.match(sql, /revoked_at timestamptz NULL/);
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS ix_system_administrators_active/,
  );

  // 2. user_workspace_bindings
  assert.match(sql, /CREATE TABLE IF NOT EXISTS user_workspace_bindings/);
  assert.match(sql, /workspace_id uuid NOT NULL REFERENCES workspaces\(id\)/);
  assert.match(sql, /user_id uuid NOT NULL REFERENCES users\(id\)/);
  assert.match(
    sql,
    /status text NOT NULL DEFAULT 'active' CHECK \(status IN \('active', 'revoked'\)\)/,
  );
  assert.match(sql, /version integer NOT NULL DEFAULT 1 CHECK \(version > 0\)/);
  assert.match(sql, /provisioned_by_user_id uuid NULL REFERENCES users\(id\)/);
  assert.match(sql, /revoked_by_user_id uuid NULL REFERENCES users\(id\)/);
  assert.match(sql, /revoked_at timestamptz NULL/);
  assert.match(
    sql,
    /CONSTRAINT uq_user_workspace_bindings_workspace_id UNIQUE \(workspace_id, id\)/,
  );
  assert.match(
    sql,
    /FOREIGN KEY\s*\(workspace_id,\s*user_id\)\s*REFERENCES\s*workspace_memberships\s*\(workspace_id,\s*user_id\)/,
  );
  assert.match(
    sql,
    /CREATE UNIQUE INDEX IF NOT EXISTS uq_user_workspace_bindings_single_active\s+ON user_workspace_bindings\s*\(user_id\)\s+WHERE status = 'active'/,
  );
  assert.match(
    sql,
    /CREATE INDEX IF NOT EXISTS ix_user_workspace_bindings_lookup/,
  );
});

test('M02 migration SQL conforms strictly to canonical doc 20, 21, and 36 specifications', async () => {
  const { loadMigrationFiles } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );

  const migrations = loadMigrationFiles(
    resolve(root, 'packages/database/src/migrations'),
  );
  const m02 = migrations.find(
    (m) => m.id === '0003_m02_auth_membership_session_outbox',
  );
  assert.ok(m02);

  const sql = m02.sql;

  // 1. workspace_memberships
  assert.match(sql, /CREATE TABLE IF NOT EXISTS workspace_memberships/);
  assert.match(
    sql,
    /role text NOT NULL CHECK \(role IN \('owner', 'staff'\)\)/,
  );
  assert.match(
    sql,
    /status text NOT NULL DEFAULT 'invited' CHECK \(status IN \('invited', 'active', 'suspended'\)\)/,
  );
  assert.match(
    sql,
    /CONSTRAINT uq_workspace_memberships_workspace_user UNIQUE \(workspace_id, user_id\)/,
  );
  assert.match(
    sql,
    /CONSTRAINT uq_workspace_memberships_workspace_id UNIQUE \(workspace_id, id\)/,
  );

  // 2. user_credentials
  assert.match(sql, /CREATE TABLE IF NOT EXISTS user_credentials/);
  assert.match(sql, /password_hash text NOT NULL/);
  assert.match(
    sql,
    /credential_version integer NOT NULL DEFAULT 1 CHECK \(credential_version > 0\)/,
  );

  // 3. activation_invites
  assert.match(sql, /CREATE TABLE IF NOT EXISTS activation_invites/);
  assert.match(
    sql,
    /CONSTRAINT uq_activation_invites_token_hash UNIQUE \(token_hash\)/,
  );
  assert.match(
    sql,
    /status text NOT NULL DEFAULT 'queued' CHECK \(status IN \('queued', 'issued', 'used', 'revoked', 'expired'\)\)/,
  );
  assert.match(
    sql,
    /FOREIGN KEY\s*\(workspace_id,\s*user_id\)\s*REFERENCES\s*workspace_memberships\s*\(workspace_id,\s*user_id\)/,
  );

  // 4. auth_sessions
  assert.match(sql, /CREATE TABLE IF NOT EXISTS auth_sessions/);
  assert.match(
    sql,
    /CONSTRAINT uq_auth_sessions_token_hash UNIQUE \(session_token_hash\)/,
  );
  assert.match(
    sql,
    /FOREIGN KEY\s*\(workspace_id,\s*user_id\)\s*REFERENCES\s*workspace_memberships\s*\(workspace_id,\s*user_id\)/,
  );

  // 5. email_outbox & email_delivery_attempts
  assert.match(sql, /CREATE TABLE IF NOT EXISTS email_outbox/);
  assert.match(
    sql,
    /FOREIGN KEY\s*\(workspace_id,\s*invite_id\)\s*REFERENCES\s*activation_invites\s*\(workspace_id,\s*id\)/,
  );
  assert.match(sql, /CREATE TABLE IF NOT EXISTS email_delivery_attempts/);
  assert.match(
    sql,
    /FOREIGN KEY\s*\(workspace_id,\s*outbox_id\)\s*REFERENCES\s*email_outbox\s*\(workspace_id,\s*id\)/,
  );
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

test('runMigrations acquires and releases PostgreSQL advisory lock around execution', async () => {
  const { runMigrations } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );

  const queryLog = [];
  const mockClient = {
    query: async (sql, params) => {
      queryLog.push({ sql: sql.trim(), params });
      if (sql.includes('SELECT id, checksum')) {
        return { rows: [] };
      }
      return { rows: [] };
    },
    release: () => {
      queryLog.push({ sql: 'CLIENT_RELEASED' });
    },
  };
  const mockPool = { connect: async () => mockClient };

  const testMigrations = [
    {
      id: '0001_test',
      sql: 'CREATE TABLE lock_test (id int);',
      checksum: 'chk_1',
    },
  ];

  await runMigrations(mockPool, testMigrations);

  // Assert lock is acquired first
  assert.equal(queryLog[0]?.sql, 'SELECT pg_advisory_lock($1)');
  assert.deepEqual(queryLog[0]?.params, ['8273645192837461']);

  // Assert unlock is executed in finally, before client release
  const unlockIdx = queryLog.findIndex((q) =>
    q.sql.includes('SELECT pg_advisory_unlock($1)'),
  );
  assert.ok(unlockIdx > 0, 'Advisory unlock must be executed');
  assert.deepEqual(queryLog[unlockIdx]?.params, ['8273645192837461']);

  const releaseIdx = queryLog.findIndex((q) => q.sql === 'CLIENT_RELEASED');
  assert.ok(releaseIdx > unlockIdx, 'Client must be released after unlock');
});

test('runMigrations executes BEGIN, rolls back on error, does not record failed migration, and releases lock', async () => {
  const { runMigrations } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );

  const queryLog = [];
  const mockClient = {
    query: async (sql, params) => {
      queryLog.push({ sql: sql.trim(), params });
      if (sql.includes('SELECT id, checksum')) {
        return { rows: [] };
      }
      if (sql.includes('FAILING_SQL')) {
        throw new Error('syntax error at or near "FAILING_SQL"');
      }
      return { rows: [] };
    },
    release: () => {
      queryLog.push({ sql: 'CLIENT_RELEASED' });
    },
  };
  const mockPool = { connect: async () => mockClient };

  const testMigrations = [
    {
      id: '0001_fail_test',
      sql: 'FAILING_SQL;',
      checksum: 'chk_fail',
    },
  ];

  await assert.rejects(
    async () => {
      await runMigrations(mockPool, testMigrations);
    },
    {
      name: 'Error',
      message:
        /Migration failed at "0001_fail_test": syntax error at or near "FAILING_SQL"/,
    },
  );

  // Assert BEGIN was called
  const beginIdx = queryLog.findIndex((q) => q.sql === 'BEGIN');
  assert.ok(
    beginIdx !== -1,
    'BEGIN must be called for transactional migration',
  );

  // Assert ROLLBACK was called
  const rollbackIdx = queryLog.findIndex((q) => q.sql === 'ROLLBACK');
  assert.ok(rollbackIdx !== -1, 'ROLLBACK must be called when migration fails');
  assert.ok(rollbackIdx > beginIdx, 'ROLLBACK must occur after BEGIN');

  // Assert failed migration was NOT inserted into schema_migrations
  const insertMigration = queryLog.find((q) =>
    q.sql.includes('INSERT INTO schema_migrations'),
  );
  assert.equal(
    insertMigration,
    undefined,
    'Failed migration must never be recorded in schema_migrations',
  );

  // Assert unlock was called even after failure
  const unlockIdx = queryLog.findIndex((q) =>
    q.sql.includes('SELECT pg_advisory_unlock($1)'),
  );
  assert.ok(
    unlockIdx > rollbackIdx,
    'Lock must be released in finally block after rollback',
  );
});

test('runMigrations safe replay skips already applied migrations without executing SQL or transactions', async () => {
  const { runMigrations } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );

  const queryLog = [];
  const mockClient = {
    query: async (sql, params) => {
      queryLog.push({ sql: sql.trim(), params });
      if (sql.includes('SELECT id, checksum')) {
        return {
          rows: [
            {
              id: '0001_m00',
              checksum: 'chk_00',
              applied_at: new Date(),
              execution_time_ms: 5,
            },
            {
              id: '0002_m01',
              checksum: 'chk_01',
              applied_at: new Date(),
              execution_time_ms: 10,
            },
          ],
        };
      }
      return { rows: [] };
    },
    release: () => {},
  };
  const mockPool = { connect: async () => mockClient };

  const testMigrations = [
    { id: '0001_m00', sql: 'CREATE EXTENSION pgcrypto;', checksum: 'chk_00' },
    { id: '0002_m01', sql: 'CREATE TABLE workspaces;', checksum: 'chk_01' },
  ];

  const result = await runMigrations(mockPool, testMigrations);

  assert.equal(result.appliedCount, 0);
  assert.equal(result.alreadyAppliedCount, 2);
  assert.deepEqual(result.appliedIds, []);

  // Assert no BEGIN, COMMIT, or INSERT INTO schema_migrations occurred
  assert.ok(!queryLog.some((q) => q.sql === 'BEGIN'));
  assert.ok(
    !queryLog.some((q) => q.sql.includes('INSERT INTO schema_migrations')),
  );
});

test('migration SQL files and embedded catalog have strict 1:1 parity in count, IDs, checksums, and content', async () => {
  const { loadMigrationFiles, assertMigrationParity } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );
  const { EMBEDDED_MIGRATIONS } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrations/catalog.js')}`
  );

  const fsFiles = loadMigrationFiles(
    resolve(root, 'packages/database/src/migrations'),
  );

  assert.equal(
    fsFiles.length,
    EMBEDDED_MIGRATIONS.length,
    'Count of filesystem .sql files must match embedded catalog',
  );

  // Run the parity assertion function
  assert.doesNotThrow(() => {
    assertMigrationParity(fsFiles, EMBEDDED_MIGRATIONS);
  });

  // Verify detailed content equality
  for (let i = 0; i < fsFiles.length; i++) {
    const fsMig = fsFiles[i];
    const embMig = EMBEDDED_MIGRATIONS[i];

    assert.equal(fsMig.id, embMig.id);
    assert.equal(fsMig.checksum, embMig.checksum);
    assert.equal(
      fsMig.sql.replace(/\r\n/g, '\n').trim(),
      embMig.sql.replace(/\r\n/g, '\n').trim(),
      `Normalized SQL content must match for ${fsMig.id}`,
    );
  }
});
