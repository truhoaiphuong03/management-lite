import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('C06-DB-01: live PostgreSQL migration M02b user_workspace_bindings and system_administrators', async (t) => {
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
  const { recordAuditEvent } = await import(
    `file://${resolve(root, 'dist/packages/database/src/audit.js')}`
  );

  const config = loadTestDatabaseConfig();
  assertSafeTestDatabase(config);

  const pool = createDatabasePool(config);

  try {
    const health = await checkDatabaseHealth(pool);
    if (!health.connected) {
      t.skip(
        `[BLOCKED] Real PostgreSQL instance is not reachable (${health.error || 'unreachable'}). Live database integration tests are BLOCKED.`,
      );
      return;
    }

    const migrationFiles = loadMigrationFiles(
      resolve(root, 'packages/database/src/migrations'),
    );

    // A. Clean install & Replay test
    const initialResult = await runMigrations(pool, migrationFiles);
    assert.ok(initialResult.appliedCount >= 0);

    const replayResult = await runMigrations(pool, migrationFiles);
    assert.equal(
      replayResult.appliedCount,
      0,
      'Replay must apply 0 new migrations',
    );
    assert.equal(
      replayResult.alreadyAppliedCount,
      migrationFiles.length,
      'Replay must recognize all migrations as applied',
    );

    const runToken = crypto.randomBytes(6).toString('hex');
    const ws1Id = crypto.randomUUID();
    const ws2Id = crypto.randomUUID();
    const adminUserId = crypto.randomUUID();
    const user1Id = crypto.randomUUID();
    const user2Id = crypto.randomUUID();

    // Helper: create workspace
    async function createTestWorkspace(id, name) {
      await pool.query(
        `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active');`,
        [id, name],
      );
    }

    // Helper: create user
    async function createTestUser(id, prefix) {
      const username = `${prefix}_${runToken}`;
      const email = `${prefix}_${runToken}@c06test.local`;
      await pool.query(
        `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
        [id, username, email],
      );
    }

    // Helper: create membership
    async function createMembership(wsId, uId, role = 'staff') {
      const res = await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'active') RETURNING id;`,
        [wsId, uId, role],
      );
      return res.rows[0]?.id;
    }

    // Setup base tenants & users
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

    // B. Tenant Isolation & Composite FK: user2Id is NOT member of ws1Id
    await assert.rejects(
      async () => {
        await pool.query(
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

    // C. Nullable Bootstrap Actor Compatibility
    const bootstrapBindingRes = await pool.query(
      `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, provisioned_by_user_id)
       VALUES ($1, $2, 'active', NULL)
       RETURNING id, provisioned_by_user_id, status;`,
      [ws1Id, adminUserId],
    );
    assert.ok(bootstrapBindingRes.rows[0]?.id);
    assert.equal(bootstrapBindingRes.rows[0]?.provisioned_by_user_id, null);
    assert.equal(bootstrapBindingRes.rows[0]?.status, 'active');

    // Audit event with NULL actor (system bootstrap provenance)
    const bootstrapAuditRes = await recordAuditEvent(pool, {
      workspaceId: ws1Id,
      actorUserId: null,
      action: 'platform.system_bootstrap_executed',
      entityType: 'user_workspace_binding',
      entityId: bootstrapBindingRes.rows[0].id,
      requestId: `req-bootstrap-${runToken}`,
      metadata: { mechanism: 'system_bootstrap_test' },
    });
    assert.ok(bootstrapAuditRes.id);

    // Verify audit event actor is truly null in database
    const auditDbCheck = await pool.query(
      `SELECT actor_user_id, action FROM audit_events WHERE id = $1;`,
      [bootstrapAuditRes.id],
    );
    assert.equal(auditDbCheck.rows[0]?.actor_user_id, null);
    assert.equal(
      auditDbCheck.rows[0]?.action,
      'platform.system_bootstrap_executed',
    );

    // D. Single-Active Uniqueness: user1Id has memberships in ws1Id and ws2Id
    const binding1Res = await pool.query(
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
        await pool.query(
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

    // E. Revoke & Re-provision History Retention (Append-Lifecycle)
    // 1. Revoke binding1
    const revokeRes = await pool.query(
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
    const binding2Res = await pool.query(
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
    const historyRes = await pool.query(
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

    // F. Revocation State Check Constraint Verification
    // 1. status = 'active' with revoked_at != NULL must fail
    await assert.rejects(
      async () => {
        await pool.query(
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

    // 2. status = 'revoked' with revoked_at = NULL must fail
    await assert.rejects(
      async () => {
        await pool.query(
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

    // G. System Administrators Table Lifecycle & Constraints
    // 1. Grant system admin
    const sysAdminRes = await pool.query(
      `INSERT INTO system_administrators (user_id, granted_by_user_id, reason, status)
       VALUES ($1, NULL, 'Initial platform system administrator', 'active')
       RETURNING user_id, status, reason;`,
      [adminUserId],
    );
    assert.equal(sysAdminRes.rows[0]?.user_id, adminUserId);
    assert.equal(sysAdminRes.rows[0]?.status, 'active');

    // 2. Duplicate grant to same user must fail on PRIMARY KEY
    await assert.rejects(
      async () => {
        await pool.query(
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

    // 3. Revoke system admin
    const revokeSysAdminRes = await pool.query(
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

    // 4. Invalid revocation state on system_administrators must fail
    await assert.rejects(
      async () => {
        await pool.query(
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
    await closeDatabasePool(pool);
  }
});
