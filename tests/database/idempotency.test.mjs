import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('computeRequestFingerprint creates deterministic SHA-256 fingerprints', async () => {
  const { computeRequestFingerprint } = await import(
    `file://${resolve(root, 'dist/packages/database/src/idempotency.js')}`
  );

  const fp1 = computeRequestFingerprint('POST', '/api/v1/shifts', {
    employee_id: 'EMP-01',
  });
  const fp2 = computeRequestFingerprint('post', '/api/v1/shifts', {
    employee_id: 'EMP-01',
  });
  assert.equal(fp1, fp2);
  assert.match(fp1, /^[a-f0-9]{64}$/);

  // Different payload produces different fingerprint
  const fp3 = computeRequestFingerprint('POST', '/api/v1/shifts', {
    employee_id: 'EMP-02',
  });
  assert.notEqual(fp1, fp3);
});

test('claimIdempotency handles fresh claim, replay, and payload mismatch per T1', async () => {
  const { claimIdempotency } = await import(
    `file://${resolve(root, 'dist/packages/database/src/idempotency.js')}`
  );

  // 1. Fresh claim succeeds
  const mockFreshPool = {
    query: async (sql) => {
      if (sql.includes('INSERT INTO idempotency_records')) {
        return { rows: [{ id: 'idem-uuid-1' }] };
      }
      return { rows: [] };
    },
  };

  const freshRes = await claimIdempotency(mockFreshPool, {
    workspaceId: 'ws-1',
    actorUserId: 'usr-1',
    operationKey: 'op-key-1',
    requestFingerprint: 'fp-111',
  });
  assert.equal(freshRes.status, 'claimed');

  // 2. Conflict with DIFFERENT payload fingerprint returns mismatch (409)
  const mockMismatchPool = {
    query: async (sql) => {
      if (sql.includes('INSERT INTO idempotency_records')) {
        return { rows: [] }; // Conflict
      }
      if (sql.includes('SELECT state, request_fingerprint')) {
        return {
          rows: [
            {
              state: 'completed',
              request_fingerprint: 'fp-111',
              response_code: 201,
              sanitized_response: { id: 'created-1' },
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  const mismatchRes = await claimIdempotency(mockMismatchPool, {
    workspaceId: 'ws-1',
    actorUserId: 'usr-1',
    operationKey: 'op-key-1',
    requestFingerprint: 'fp-DIFFERENT',
  });
  assert.equal(mismatchRes.status, 'mismatch');
  assert.match(mismatchRes.error, /IDEMPOTENCY_CONFLICT/);

  // 3. Conflict with SAME payload and completed state returns replay
  const replayRes = await claimIdempotency(mockMismatchPool, {
    workspaceId: 'ws-1',
    actorUserId: 'usr-1',
    operationKey: 'op-key-1',
    requestFingerprint: 'fp-111',
  });
  assert.equal(replayRes.status, 'replay');
  assert.equal(replayRes.responseCode, 201);
  assert.deepEqual(replayRes.sanitizedResponse, { id: 'created-1' });

  // 4. Conflict with in-progress state returns in_progress
  const mockInProgressPool = {
    query: async (sql) => {
      if (sql.includes('INSERT INTO idempotency_records')) return { rows: [] };
      return {
        rows: [
          {
            state: 'claimed',
            request_fingerprint: 'fp-111',
            response_code: null,
            sanitized_response: null,
          },
        ],
      };
    },
  };

  const inProgressRes = await claimIdempotency(mockInProgressPool, {
    workspaceId: 'ws-1',
    actorUserId: 'usr-1',
    operationKey: 'op-key-1',
    requestFingerprint: 'fp-111',
  });
  assert.equal(inProgressRes.status, 'in_progress');
  assert.match(inProgressRes.error, /IDEMPOTENCY_IN_PROGRESS/);
});
