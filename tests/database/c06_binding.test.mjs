import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('C06-DB-01: isolated schema clean install, replay, and checksum integrity', async (t) => {
  // 1. Strict Isolation & Confirmation Gate
  const testUrl = process.env.TEST_DATABASE_URL?.trim();
  const confirmed =
    process.env.CONFIRM_ISOLATED_TEST_DB === 'true' ||
    process.env.CONFIRM_ISOLATED_TEST_DB === '1';

  if (!testUrl || !confirmed) {
    const missing = [];
    if (!testUrl) missing.push('TEST_DATABASE_URL');
    if (!confirmed) missing.push('CONFIRM_ISOLATED_TEST_DB=true');

    t.skip(
      `[BLOCKED] Dedicated test database instance not confirmed (missing: ${missing.join(', ')}). Live database integration tests require an explicitly confirmed, isolated test instance. Tests will not connect or execute against unconfirmed databases.`,
    );
    return;
  }

  const { loadTestDatabaseConfig, assertSafeTestDatabase } = await import(
    `file://${resolve(root, 'dist/packages/database/src/config.js')}`
  );
  const { createDatabasePool, checkDatabaseHealth, closeDatabasePool } =
    await import(
      `file://${resolve(root, 'dist/packages/database/src/pool.js')}`
    );
  const { runMigrations, loadMigrationFiles } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );

  const config = loadTestDatabaseConfig();
  assertSafeTestDatabase(config);

  const mainPool = createDatabasePool(config);

  try {
    const health = await checkDatabaseHealth(mainPool);
    if (!health.connected) {
      t.skip(
        `[BLOCKED] Real PostgreSQL instance is not reachable (${health.error || 'unreachable'}). Live database integration tests are BLOCKED.`,
      );
      return;
    }

    const migrationFiles = loadMigrationFiles(
      resolve(root, 'packages/database/src/migrations'),
    );

    // Run clean install test in a dedicated, isolated temporary schema
    const runToken = crypto.randomBytes(6).toString('hex');
    const isolatedSchema = `c06_clean_install_${runToken}`;

    await mainPool.query(`CREATE SCHEMA ${isolatedSchema};`);

    const isolatedPool = new pg.Pool({
      connectionString: config.connectionString,
      options: `-c search_path=${isolatedSchema},public`,
      max: 2,
    });

    try {
      // 1. Genuine Clean Install from Scratch (M00 -> M01 -> M02 -> M02b)
      const cleanInstallResult = await runMigrations(
        isolatedPool,
        migrationFiles,
      );
      assert.equal(
        cleanInstallResult.appliedCount,
        4,
        'Clean install must apply all 4 migrations in order',
      );
      assert.equal(
        cleanInstallResult.alreadyAppliedCount,
        0,
        'Clean install must have 0 previously applied migrations',
      );
      assert.deepEqual(cleanInstallResult.appliedIds, [
        '0001_m00_prerequisites',
        '0002_m01_workspace_user_audit_idempotency',
        '0003_m02_auth_membership_session_outbox',
        '0004_m02b_user_workspace_bindings',
      ]);

      // 2. Verify all recorded checksums match canonical file checksums without manual modification
      const ledgerRes = await isolatedPool.query(
        `SELECT id, checksum FROM schema_migrations ORDER BY id ASC;`,
      );
      assert.equal(ledgerRes.rows.length, 4);
      for (let i = 0; i < migrationFiles.length; i++) {
        const file = migrationFiles[i];
        const row = ledgerRes.rows[i];
        assert.equal(row.id, file.id);
        assert.equal(
          row.checksum,
          file.checksum,
          `Ledger checksum for "${row.id}" must match calculated file checksum`,
        );
      }

      // 3. Safe Replay Test on newly installed schema
      const replayResult = await runMigrations(isolatedPool, migrationFiles);
      assert.equal(
        replayResult.appliedCount,
        0,
        'Replay must apply 0 new migrations',
      );
      assert.equal(
        replayResult.alreadyAppliedCount,
        4,
        'Replay must recognize all 4 migrations as already applied',
      );
    } finally {
      await isolatedPool.end();
      // Fixture Teardown: completely drop the temporary schema and all its objects
      await mainPool.query(`DROP SCHEMA ${isolatedSchema} CASCADE;`);
    }
  } finally {
    await closeDatabasePool(mainPool);
  }
});

test('C06-DB-01: tenant isolation, composite FK, single-active uniqueness, and lifecycle in isolated schema', async (t) => {
  const testUrl = process.env.TEST_DATABASE_URL?.trim();
  const confirmed =
    process.env.CONFIRM_ISOLATED_TEST_DB === 'true' ||
    process.env.CONFIRM_ISOLATED_TEST_DB === '1';

  if (!testUrl || !confirmed) {
    t.skip('Dedicated test database instance not confirmed.');
    return;
  }

  const { loadTestDatabaseConfig, assertSafeTestDatabase } = await import(
    `file://${resolve(root, 'dist/packages/database/src/config.js')}`
  );
  const { createDatabasePool, checkDatabaseHealth, closeDatabasePool } =
    await import(
      `file://${resolve(root, 'dist/packages/database/src/pool.js')}`
    );
  const { runMigrations, loadMigrationFiles } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );
  const { recordAuditEvent } = await import(
    `file://${resolve(root, 'dist/packages/database/src/audit.js')}`
  );

  const config = loadTestDatabaseConfig();
  assertSafeTestDatabase(config);

  const mainPool = createDatabasePool(config);

  try {
    const health = await checkDatabaseHealth(mainPool);
    if (!health.connected) {
      t.skip('Real PostgreSQL instance is not reachable.');
      return;
    }

    const migrationFiles = loadMigrationFiles(
      resolve(root, 'packages/database/src/migrations'),
    );

    // Execute lifecycle and constraint tests in a dedicated isolated schema
    const runToken = crypto.randomBytes(6).toString('hex');
    const lifecycleSchema = `c06_lifecycle_${runToken}`;

    await mainPool.query(`CREATE SCHEMA ${lifecycleSchema};`);

    const isolatedPool = new pg.Pool({
      connectionString: config.connectionString,
      options: `-c search_path=${lifecycleSchema},public`,
      max: 2,
    });

    try {
      // Set up schema via genuine migration run
      await runMigrations(isolatedPool, migrationFiles);

      const ws1Id = crypto.randomUUID();
      const ws2Id = crypto.randomUUID();
      const adminUserId = crypto.randomUUID();
      const user1Id = crypto.randomUUID();
      const user2Id = crypto.randomUUID();

      // Helpers within isolated schema
      async function createTestWorkspace(id, name) {
        await isolatedPool.query(
          `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active');`,
          [id, name],
        );
      }

      async function createTestUser(id, prefix) {
        const username = `${prefix}_${runToken}`;
        const email = `${prefix}_${runToken}@c06test.local`;
        await isolatedPool.query(
          `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
          [id, username, email],
        );
      }

      async function createMembership(wsId, uId, role = 'staff') {
        const res = await isolatedPool.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'active') RETURNING id;`,
          [wsId, uId, role],
        );
        return res.rows[0]?.id;
      }

      // Base tenant setup
      await createTestWorkspace(ws1Id, `C06 Test Workspace 1 ${runToken}`);
      await createTestWorkspace(ws2Id, `C06 Test Workspace 2 ${runToken}`);
      await createTestUser(adminUserId, `admin_user`);
      await createTestUser(user1Id, `user1`);
      await createTestUser(user2Id, `user2`);

      await createMembership(ws1Id, adminUserId, 'owner');
      await createMembership(ws1Id, user1Id, 'staff');
      await createMembership(ws2Id, user1Id, 'staff');
      // user2Id is ONLY member of ws2Id, NOT ws1Id
      await createMembership(ws2Id, user2Id, 'staff');

      // A. Tenant Isolation & Composite FK: user2Id is NOT member of ws1Id
      await assert.rejects(
        async () => {
          await isolatedPool.query(
            `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, provisioned_by_user_id)
             VALUES ($1, $2, 'active', $3);`,
            [ws1Id, user2Id, adminUserId],
          );
        },
        (err) => {
          assert.equal(
            err.code,
            '23503',
            'Must reject with foreign key violation code 23503',
          );
          assert.match(
            err.message,
            /fk_user_workspace_bindings_membership/,
            'Must violate composite FK fk_user_workspace_bindings_membership',
          );
          return true;
        },
        'Cross-tenant binding without membership must be rejected by composite FK',
      );

      // B. Nullable Bootstrap Actor Compatibility
      const bootstrapBindingRes = await isolatedPool.query(
        `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, provisioned_by_user_id)
         VALUES ($1, $2, 'active', NULL)
         RETURNING id, provisioned_by_user_id, status;`,
        [ws1Id, adminUserId],
      );
      assert.ok(bootstrapBindingRes.rows[0]?.id);
      assert.equal(bootstrapBindingRes.rows[0]?.provisioned_by_user_id, null);
      assert.equal(bootstrapBindingRes.rows[0]?.status, 'active');

      // Audit event with NULL actor (system bootstrap provenance)
      const bootstrapAuditRes = await recordAuditEvent(isolatedPool, {
        workspaceId: ws1Id,
        actorUserId: null,
        action: 'platform.system_bootstrap_executed',
        entityType: 'user_workspace_binding',
        entityId: bootstrapBindingRes.rows[0].id,
        requestId: `req-bootstrap-${runToken}`,
        metadata: { mechanism: 'system_bootstrap_test' },
      });
      assert.ok(bootstrapAuditRes.id);

      const auditDbCheck = await isolatedPool.query(
        `SELECT actor_user_id, action FROM audit_events WHERE id = $1;`,
        [bootstrapAuditRes.id],
      );
      assert.equal(auditDbCheck.rows[0]?.actor_user_id, null);
      assert.equal(
        auditDbCheck.rows[0]?.action,
        'platform.system_bootstrap_executed',
      );

      // C. Single-Active Uniqueness: user1Id has memberships in ws1Id and ws2Id
      const binding1Res = await isolatedPool.query(
        `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, provisioned_by_user_id)
         VALUES ($1, $2, 'active', $3)
         RETURNING id, status;`,
        [ws1Id, user1Id, adminUserId],
      );
      assert.ok(binding1Res.rows[0]?.id);
      assert.equal(binding1Res.rows[0]?.status, 'active');
      const binding1Id = binding1Res.rows[0].id;

      // Attempting second active binding for user1Id to ws2Id must fail
      await assert.rejects(
        async () => {
          await isolatedPool.query(
            `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, provisioned_by_user_id)
             VALUES ($1, $2, 'active', $3);`,
            [ws2Id, user1Id, adminUserId],
          );
        },
        (err) => {
          assert.equal(
            err.code,
            '23505',
            'Must reject with unique violation code 23505',
          );
          assert.match(
            err.message,
            /uq_user_workspace_bindings_single_active/,
            'Must violate partial unique index uq_user_workspace_bindings_single_active',
          );
          return true;
        },
        'Concurrent second active binding must be rejected by partial unique index',
      );

      // D. Revoke & Re-provision History Retention (Append-Lifecycle)
      // 1. Revoke binding1
      const revokeRes = await isolatedPool.query(
        `UPDATE user_workspace_bindings
         SET status = 'revoked',
             revoked_at = now(),
             revoked_by_user_id = $1,
             updated_at = now()
         WHERE id = $2 AND status = 'active'
         RETURNING id, status, revoked_at, revoked_by_user_id;`,
        [adminUserId, binding1Id],
      );
      assert.equal(revokeRes.rows[0]?.status, 'revoked');
      assert.ok(revokeRes.rows[0]?.revoked_at);
      assert.equal(revokeRes.rows[0]?.revoked_by_user_id, adminUserId);

      // 2. Re-provision user1Id to ws2Id (now allowed because user1Id has 0 active bindings)
      const binding2Res = await isolatedPool.query(
        `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, provisioned_by_user_id)
         VALUES ($1, $2, 'active', $3)
         RETURNING id, status, workspace_id;`,
        [ws2Id, user1Id, adminUserId],
      );
      assert.ok(binding2Res.rows[0]?.id);
      assert.equal(binding2Res.rows[0]?.status, 'active');
      assert.equal(binding2Res.rows[0]?.workspace_id, ws2Id);
      const binding2Id = binding2Res.rows[0].id;

      // 3. Verify history is preserved: both records exist
      const historyRes = await isolatedPool.query(
        `SELECT id, workspace_id, status, provisioned_by_user_id, revoked_by_user_id, revoked_at
         FROM user_workspace_bindings
         WHERE user_id = $1
         ORDER BY created_at ASC;`,
        [user1Id],
      );
      assert.equal(
        historyRes.rows.length,
        2,
        'History must contain exactly 2 records',
      );
      assert.equal(historyRes.rows[0]?.id, binding1Id);
      assert.equal(historyRes.rows[0]?.status, 'revoked');
      assert.equal(historyRes.rows[0]?.workspace_id, ws1Id);
      assert.equal(historyRes.rows[1]?.id, binding2Id);
      assert.equal(historyRes.rows[1]?.status, 'active');
      assert.equal(historyRes.rows[1]?.workspace_id, ws2Id);

      // E. Revocation State Check Constraint Verification
      await assert.rejects(
        async () => {
          await isolatedPool.query(
            `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, revoked_at, revoked_by_user_id)
             VALUES ($1, $2, 'active', now(), $3);`,
            [ws2Id, user2Id, adminUserId],
          );
        },
        (err) => {
          assert.equal(
            err.code,
            '23514',
            'Must reject with check constraint violation code 23514',
          );
          assert.match(
            err.message,
            /ck_user_workspace_bindings_revocation_state/,
          );
          return true;
        },
      );

      await assert.rejects(
        async () => {
          await isolatedPool.query(
            `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, revoked_at, revoked_by_user_id)
             VALUES ($1, $2, 'revoked', NULL, $3);`,
            [ws2Id, user2Id, adminUserId],
          );
        },
        (err) => {
          assert.equal(
            err.code,
            '23514',
            'Must reject with check constraint violation code 23514',
          );
          assert.match(
            err.message,
            /ck_user_workspace_bindings_revocation_state/,
          );
          return true;
        },
      );

      // F. System Administrators Table Lifecycle & Constraints
      const sysAdminRes = await isolatedPool.query(
        `INSERT INTO system_administrators (user_id, granted_by_user_id, reason, status)
         VALUES ($1, NULL, 'Initial platform system administrator', 'active')
         RETURNING user_id, status, reason;`,
        [adminUserId],
      );
      assert.equal(sysAdminRes.rows[0]?.user_id, adminUserId);
      assert.equal(sysAdminRes.rows[0]?.status, 'active');

      await assert.rejects(
        async () => {
          await isolatedPool.query(
            `INSERT INTO system_administrators (user_id, granted_by_user_id, reason, status)
             VALUES ($1, $1, 'Duplicate grant attempt', 'active');`,
            [adminUserId],
          );
        },
        (err) => {
          assert.equal(
            err.code,
            '23505',
            'Must reject with unique violation on primary key',
          );
          return true;
        },
      );

      const revokeSysAdminRes = await isolatedPool.query(
        `UPDATE system_administrators
         SET status = 'revoked',
             revoked_at = now(),
             revoked_by_user_id = $1,
             updated_at = now()
         WHERE user_id = $1 AND status = 'active'
         RETURNING user_id, status, revoked_at, revoked_by_user_id;`,
        [adminUserId],
      );
      assert.equal(revokeSysAdminRes.rows[0]?.status, 'revoked');
      assert.ok(revokeSysAdminRes.rows[0]?.revoked_at);
      assert.equal(revokeSysAdminRes.rows[0]?.revoked_by_user_id, adminUserId);

      await assert.rejects(
        async () => {
          await isolatedPool.query(
            `INSERT INTO system_administrators (user_id, granted_by_user_id, reason, status, revoked_at, revoked_by_user_id)
             VALUES ($1, NULL, 'Invalid state check', 'active', now(), $1);`,
            [user1Id],
          );
        },
        (err) => {
          assert.equal(
            err.code,
            '23514',
            'Must reject with check constraint violation code 23514',
          );
          assert.match(err.message, /ck_system_administrators_revocation/);
          return true;
        },
      );
    } finally {
      await isolatedPool.end();
      // Fixture Teardown: completely drop the temporary lifecycle schema and all fixtures
      await mainPool.query(`DROP SCHEMA ${lifecycleSchema} CASCADE;`);
    }
  } finally {
    await closeDatabasePool(mainPool);
  }
});
