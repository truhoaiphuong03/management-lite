import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('sanitizeAuditMetadata scrubs secrets, passwords, tokens and credentials per T3', async () => {
  const { sanitizeAuditMetadata } = await import(
    `file://${resolve(root, 'dist/packages/database/src/audit.js')}`
  );

  const rawMetadata = {
    employee_code: 'EMP-01',
    password: 'raw_user_password_plaintext',
    nested: {
      auth_token: 'secret_jwt_bearer_token',
      api_key: 'sk_live_1234567890',
      safe_metric: 42,
    },
    items: [
      { name: 'public_item', secret_phrase: 'do_not_log_this' },
      { name: 'regular_item', status: 'active' },
    ],
  };

  const sanitized = sanitizeAuditMetadata(rawMetadata);

  assert.equal(sanitized.employee_code, 'EMP-01');
  assert.equal(sanitized.password, '[REDACTED]');
  assert.equal(sanitized.nested?.auth_token, '[REDACTED]');
  assert.equal(sanitized.nested?.api_key, '[REDACTED]');
  assert.equal(sanitized.nested?.safe_metric, 42);
  assert.equal(sanitized.items?.[0]?.secret_phrase, '[REDACTED]');
  assert.equal(sanitized.items?.[0]?.name, 'public_item');
  assert.equal(sanitized.items?.[1]?.status, 'active');

  // Verify full JSON output does not leak sensitive strings
  const jsonStr = JSON.stringify(sanitized);
  assert.ok(!jsonStr.includes('raw_user_password_plaintext'));
  assert.ok(!jsonStr.includes('secret_jwt_bearer_token'));
  assert.ok(!jsonStr.includes('sk_live_1234567890'));
  assert.ok(!jsonStr.includes('do_not_log_this'));
});

test('recordAuditEvent persists append-only sanitized audit row', async () => {
  const { recordAuditEvent } = await import(
    `file://${resolve(root, 'dist/packages/database/src/audit.js')}`
  );

  let capturedSql = '';
  let capturedParams = [];

  const mockPool = {
    query: async (sql, params) => {
      capturedSql = sql;
      capturedParams = params;
      return { rows: [{ id: 'audit-uuid-1' }] };
    },
  };

  const result = await recordAuditEvent(mockPool, {
    workspaceId: 'ws-100',
    actorUserId: 'usr-100',
    action: 'employee.created',
    entityType: 'employee',
    entityId: 'emp-100',
    requestId: 'req-100',
    metadata: {
      employee_code: 'EMP-100',
      temporary_password: 'plain_secret_123',
    },
  });

  assert.equal(result.id, 'audit-uuid-1');
  assert.match(capturedSql, /INSERT INTO audit_events/);

  // Assert parameters are sanitized
  const metadataParam = JSON.parse(capturedParams[6]);
  assert.equal(metadataParam.employee_code, 'EMP-100');
  assert.equal(metadataParam.temporary_password, '[REDACTED]');
});

test('audit_events immutability trigger definition strictly prohibits UPDATE and DELETE', async () => {
  const { loadMigrationFiles } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );

  const migrations = loadMigrationFiles(
    resolve(root, 'packages/database/src/migrations'),
  );
  const m01 = migrations.find(
    (m) => m.id === '0002_m01_workspace_user_audit_idempotency',
  );
  assert.ok(m01, 'M01 migration must exist');

  // Trigger function must raise exception on any mutation
  assert.match(
    m01.sql,
    /CREATE OR REPLACE FUNCTION prevent_audit_events_mutation\(\)/,
  );
  assert.match(
    m01.sql,
    /RAISE EXCEPTION 'audit_events is append-only: % operation prohibited', TG_OP;/,
  );

  // Trigger must be defined BEFORE UPDATE OR DELETE FOR EACH ROW
  assert.match(
    m01.sql,
    /CREATE TRIGGER trg_audit_events_immutable\s+BEFORE UPDATE OR DELETE ON audit_events\s+FOR EACH ROW EXECUTE FUNCTION prevent_audit_events_mutation\(\);/,
  );
});
