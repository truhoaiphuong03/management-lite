import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('live PostgreSQL integration (migrations, replay, audit guard, idempotency)', async (t) => {
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

  // Enforce database safety guard: must be explicitly designated test database
  const config = loadTestDatabaseConfig();
  assertSafeTestDatabase(config);

  const pool = createDatabasePool(config);

  const health = await checkDatabaseHealth(pool);
  if (!health.connected) {
    await closeDatabasePool(pool);
    t.skip(
      `[BLOCKED] Real PostgreSQL instance is not available (${health.error || 'unreachable'}). Live database integration tests are BLOCKED. To reproduce: start a PostgreSQL 15+ container and run with TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/management_lite_test`,
    );
    return;
  }

  try {
    // 1. Initial migration run
    const migrationFiles = loadMigrationFiles(
      resolve(root, 'packages/database/src/migrations'),
    );
    const initialResult = await runMigrations(pool, migrationFiles);
    assert.ok(initialResult.appliedCount >= 0);

    // 2. Safe replay test (must not fail or alter schema)
    const replayResult = await runMigrations(pool, migrationFiles);
    assert.equal(replayResult.appliedCount, 0);
    assert.equal(replayResult.alreadyAppliedCount, migrationFiles.length);

    // 3. Test workspace and user creation
    const wsId = '11111111-1111-4111-8111-111111111111';
    await pool.query(
      `
      INSERT INTO workspaces (id, name, timezone, status)
      VALUES ($1, 'Integration Test Workspace', 'Asia/Ho_Chi_Minh', 'active')
      ON CONFLICT (id) DO NOTHING;
    `,
      [wsId],
    );

    const userId = '22222222-2222-4222-8222-222222222222';
    await pool.query(
      `
      INSERT INTO users (id, username_normalized, email_normalized, status)
      VALUES ($1, 'testuser_pk01', 'test_pk01@example.com', 'active')
      ON CONFLICT (id) DO NOTHING;
    `,
      [userId],
    );

    // 4. Test audit event recording and immutable guard
    const auditRes = await recordAuditEvent(pool, {
      workspaceId: wsId,
      actorUserId: userId,
      action: 'integration.test.created',
      entityType: 'test_entity',
      entityId: 'ent-1',
      requestId: 'req-integration-1',
      metadata: { test_key: 'test_value', password: 'should_redact' },
    });
    assert.ok(auditRes.id);

    // 5. Test DB Guard: Prohibit UPDATE or DELETE on audit_events
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

    // 6. Test idempotency claim and replay
    const opKey = 'op-integration-test-1';
    const claimRes1 = await claimIdempotency(pool, {
      workspaceId: wsId,
      actorUserId: userId,
      operationKey: opKey,
      requestFingerprint: 'fp-integ-1',
    });
    assert.equal(claimRes1.status, 'claimed');

    await completeIdempotency(pool, {
      workspaceId: wsId,
      actorUserId: userId,
      operationKey: opKey,
      responseCode: 201,
      sanitizedResponse: { success: true },
    });

    const claimRes2 = await claimIdempotency(pool, {
      workspaceId: wsId,
      actorUserId: userId,
      operationKey: opKey,
      requestFingerprint: 'fp-integ-1',
    });
    assert.equal(claimRes2.status, 'replay');
    assert.equal(claimRes2.responseCode, 201);
  } finally {
    await closeDatabasePool(pool);
  }
});
