import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('live PostgreSQL integration (migrations, replay, audit guard, idempotency)', async (t) => {
  // 1. Strict Isolation Gate: TEST_DATABASE_URL must be explicitly provided
  const testUrl = process.env.TEST_DATABASE_URL?.trim();
  if (!testUrl) {
    t.skip(
      '[BLOCKED] TEST_DATABASE_URL is not set. Live PostgreSQL integration test is BLOCKED. To run live integration tests, explicitly set TEST_DATABASE_URL pointing to an isolated test database (e.g. TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/management_lite_test). Automatic fallback to DATABASE_URL, PGDATABASE, or default databases is strictly disabled to prevent accidental connection or mutation of active databases.',
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

  // Enforce multi-factor database safety guard on testUrl
  const config = loadTestDatabaseConfig();
  assertSafeTestDatabase(config);

  const pool = createDatabasePool(config);

  try {
    const health = await checkDatabaseHealth(pool);
    if (!health.connected) {
      t.skip(
        `[BLOCKED] Real PostgreSQL instance is not reachable (${health.error || 'unreachable'}). Live database integration tests are BLOCKED. Target: ${testUrl}. To reproduce: ensure an isolated PostgreSQL 15+ container is running and accessible.`,
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
    // G. Safe cleanup scoped strictly to this run's identifiers
    await pool
      .query(
        'DELETE FROM idempotency_records WHERE workspace_id = $1 AND actor_user_id = $2;',
        [wsId, userId],
      )
      .catch(() => {});

    // Note on audit_events & parent foreign keys:
    // Per canonical Doc 20/58 and database trigger trg_audit_events_immutable, audit_events is strictly append-only.
    // Rows cannot be modified or deleted. Because audit_events references workspace_id and actor_user_id
    // with ON DELETE RESTRICT, parent workspace and user rows are preserved as immutable compliance records.
    // Using distinct random UUIDs per run ensures complete isolation and zero collision across repeated runs.
  }
}
