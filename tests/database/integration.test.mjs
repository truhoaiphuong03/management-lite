import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('live PostgreSQL integration (migrations, replay, audit guard, idempotency)', async (t) => {
  // 1. Strict Isolation & Confirmation Gate:
  // Requires explicit TEST_DATABASE_URL AND explicit confirmation CONFIRM_ISOLATED_TEST_DB=true.
  // Automated tests never assume database isolation based solely on database name, hostname, or NODE_ENV.
  const testUrl = process.env.TEST_DATABASE_URL?.trim();
  const confirmed =
    process.env.CONFIRM_ISOLATED_TEST_DB === 'true' ||
    process.env.CONFIRM_ISOLATED_TEST_DB === '1';

  if (!testUrl || !confirmed) {
    const missing = [];
    if (!testUrl) missing.push('TEST_DATABASE_URL');
    if (!confirmed) missing.push('CONFIRM_ISOLATED_TEST_DB=true');

    t.skip(
      `[BLOCKED] Dedicated test database instance not confirmed (missing: ${missing.join(', ')}). Live database integration tests require an explicitly confirmed, isolated test instance. Tests will not connect or execute against unconfirmed databases. Automated tests never assume isolation based solely on hostname, db name, or NODE_ENV. To reproduce: start an isolated PostgreSQL 15+ container and run with TEST_DATABASE_URL and CONFIRM_ISOLATED_TEST_DB=true.`,
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
  const { claimIdempotency, completeIdempotency } = await import(
    `file://${resolve(root, 'dist/packages/database/src/idempotency.js')}`
  );
  const { recordAuditEvent } = await import(
    `file://${resolve(root, 'dist/packages/database/src/audit.js')}`
  );
  const { hashPassword, verifyPassword } = await import(
    `file://${resolve(root, 'dist/packages/security/src/password.js')}`
  );
  const { generateCsprngToken, hashToken } = await import(
    `file://${resolve(root, 'dist/packages/security/src/tokens.js')}`
  );

  // Enforce multi-factor database safety guard on testUrl
  const config = loadTestDatabaseConfig();
  assertSafeTestDatabase(config);

  const pool = createDatabasePool(config);

  try {
    const health = await checkDatabaseHealth(pool);
    if (!health.connected) {
      t.skip(
        `[BLOCKED] Real PostgreSQL instance is not reachable (${health.error || 'unreachable'}). Live database integration tests are BLOCKED. To reproduce: ensure an isolated PostgreSQL 15+ container is running and accessible via TEST_DATABASE_URL with CONFIRM_ISOLATED_TEST_DB=true.`,
      );
      return;
    }

    const migrationFiles = loadMigrationFiles(
      resolve(root, 'packages/database/src/migrations'),
    );

    // 2. Repeatability: Execute integration workflow twice consecutively on the test database
    for (let runIndex = 1; runIndex <= 2; runIndex++) {
      await executeIntegrationWorkflow(pool, migrationFiles, runIndex, {
        claimIdempotency,
        completeIdempotency,
        recordAuditEvent,
        runMigrations,
        hashPassword,
        verifyPassword,
        generateCsprngToken,
        hashToken,
      });
    }
  } finally {
    await closeDatabasePool(pool);
  }
});

async function executeIntegrationWorkflow(pool, migrationFiles, runIndex, ops) {
  const {
    claimIdempotency,
    completeIdempotency,
    recordAuditEvent,
    runMigrations,
    hashPassword,
    verifyPassword,
    generateCsprngToken,
    hashToken,
  } = ops;

  // A. Initial / Replay migration execution
  const initialResult = await runMigrations(pool, migrationFiles);
  assert.ok(initialResult.appliedCount >= 0);

  // B. Safe replay test (must not fail or alter schema)
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

  // C. Generate unique per-run identifiers (zero hardcoded UUIDs, usernames, or keys)
  const runToken = crypto.randomBytes(6).toString('hex');
  const wsId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const username = `user_${Date.now()}_r${runIndex}_${runToken}`;
  const email = `user_${Date.now()}_r${runIndex}_${runToken}@integration.local`;
  const opKey = `op_r${runIndex}_${runToken}`;
  const reqId = `req_r${runIndex}_${runToken}`;
  const entityId = `entity_r${runIndex}_${runToken}`;

  try {
    // D. Workspace and User creation
    await pool.query(
      `
      INSERT INTO workspaces (id, name, timezone, status)
      VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active');
    `,
      [wsId, `Integration Test Workspace ${runToken}`],
    );

    await pool.query(
      `
      INSERT INTO users (id, username_normalized, email_normalized, status)
      VALUES ($1, $2, $3, 'active');
    `,
      [userId, username, email],
    );

    // E. M02 Tables Verification
    // 1. Workspace Membership
    const memberRes = await pool.query(
      `
      INSERT INTO workspace_memberships (workspace_id, user_id, role, status)
      VALUES ($1, $2, 'owner', 'active')
      RETURNING id, role, status;
    `,
      [wsId, userId],
    );
    assert.equal(memberRes.rows[0]?.role, 'owner');
    assert.equal(memberRes.rows[0]?.status, 'active');

    // Duplicate membership must fail unique constraint
    await assert.rejects(
      async () => {
        await pool.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'staff', 'invited');`,
          [wsId, userId],
        );
      },
      { name: 'error' },
    );

    // 2. User Credentials (Argon2id)
    const testPlainPassword = `SecurePass_${runToken}_2026!`;
    const passwordHash = await hashPassword(testPlainPassword);
    await pool.query(
      `
      INSERT INTO user_credentials (user_id, password_hash, credential_version)
      VALUES ($1, $2, 1);
    `,
      [userId, passwordHash],
    );
    const isValidPass = await verifyPassword(testPlainPassword, passwordHash);
    assert.equal(isValidPass, true);

    // 3. Activation Invites
    const staffUserId = crypto.randomUUID();
    const staffUsername = `staff_${Date.now()}_r${runIndex}_${runToken}`;
    const staffEmail = `staff_${Date.now()}_r${runIndex}_${runToken}@integration.local`;
    await pool.query(
      `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'pending_activation');`,
      [staffUserId, staffUsername, staffEmail],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'staff', 'invited');`,
      [wsId, staffUserId],
    );

    const rawInviteToken = generateCsprngToken(32);
    const inviteTokenHash = hashToken(rawInviteToken);
    const inviteRes = await pool.query(
      `
      INSERT INTO activation_invites (workspace_id, user_id, token_hash, status, expires_at)
      VALUES ($1, $2, $3, 'queued', now() + interval '24 hours')
      RETURNING id, status;
    `,
      [wsId, staffUserId, inviteTokenHash],
    );
    const inviteId = inviteRes.rows[0]?.id;
    assert.ok(inviteId);
    assert.equal(inviteRes.rows[0]?.status, 'queued');

    // 4. Auth Sessions
    const rawSessionToken = generateCsprngToken(32);
    const sessionTokenHash = hashToken(rawSessionToken);
    const sessionRes = await pool.query(
      `
      INSERT INTO auth_sessions (workspace_id, user_id, session_token_hash, credential_version_at_issue, idle_expires_at, absolute_expires_at)
      VALUES ($1, $2, $3, 1, now() + interval '30 minutes', now() + interval '12 hours')
      RETURNING id;
    `,
      [wsId, userId, sessionTokenHash],
    );
    assert.ok(sessionRes.rows[0]?.id);

    // 5. Email Outbox & Delivery Attempts
    const outboxRes = await pool.query(
      `
      INSERT INTO email_outbox (workspace_id, invite_id, message_type, status)
      VALUES ($1, $2, 'activation_invite', 'pending')
      RETURNING id, status;
    `,
      [wsId, inviteId],
    );
    const outboxId = outboxRes.rows[0]?.id;
    assert.ok(outboxId);
    assert.equal(outboxRes.rows[0]?.status, 'pending');

    const attemptRes = await pool.query(
      `
      INSERT INTO email_delivery_attempts (workspace_id, outbox_id, attempt_no, outcome)
      VALUES ($1, $2, 1, 'queued')
      RETURNING id, outcome;
    `,
      [wsId, outboxId],
    );
    assert.ok(attemptRes.rows[0]?.id);
    assert.equal(attemptRes.rows[0]?.outcome, 'queued');

    // E. Audit event recording and immutable guard
    const auditRes = await recordAuditEvent(pool, {
      workspaceId: wsId,
      actorUserId: userId,
      action: 'integration.test.created',
      entityType: 'test_entity',
      entityId,
      requestId: reqId,
      metadata: { runIndex, runToken, password: 'should_redact' },
    });
    assert.ok(auditRes.id);

    // DB Guard: Prohibit UPDATE or DELETE on audit_events
    await assert.rejects(
      async () => {
        await pool.query('DELETE FROM audit_events WHERE id = $1', [
          auditRes.id,
        ]);
      },
      {
        name: 'error',
        message: /audit_events is append-only/,
      },
    );

    await assert.rejects(
      async () => {
        await pool.query(
          "UPDATE audit_events SET action = 'tampered' WHERE id = $1",
          [auditRes.id],
        );
      },
      {
        name: 'error',
        message: /audit_events is append-only/,
      },
    );

    // F. Idempotency claim, completion, and replay
    const claimRes1 = await claimIdempotency(pool, {
      workspaceId: wsId,
      actorUserId: userId,
      operationKey: opKey,
      requestFingerprint: `fp_${runToken}`,
    });
    assert.equal(claimRes1.status, 'claimed');

    await completeIdempotency(pool, {
      workspaceId: wsId,
      actorUserId: userId,
      operationKey: opKey,
      responseCode: 201,
      sanitizedResponse: { success: true, runToken },
    });

    const claimRes2 = await claimIdempotency(pool, {
      workspaceId: wsId,
      actorUserId: userId,
      operationKey: opKey,
      requestFingerprint: `fp_${runToken}`,
    });
    assert.equal(claimRes2.status, 'replay');
    assert.equal(claimRes2.responseCode, 201);
  } finally {
    // Note on audit_events & append-only retention:
    // Per canonical Doc 20/58 and database trigger trg_audit_events_immutable, audit_events is strictly append-only.
    // Rows cannot be modified or deleted. Because audit_events references workspace_id and actor_user_id
    // with ON DELETE RESTRICT, parent workspace and user rows are preserved as immutable compliance records.
    // Using distinct random UUIDs per run ensures complete isolation and zero collision across repeated runs.
    // Real data is never deleted, maintaining strict append-only audit integrity.
  }
}
