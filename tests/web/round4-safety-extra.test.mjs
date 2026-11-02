import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  verifyIsolatedQaService,
  sanitizeErrorMessage,
} from '../../scripts/qa-target-safety.mjs';
test('Round4: unrelated HTTP 200 service must not count as verified QA instance', async () => {
  globalThis.fetch = async () => ({
    status: 200,
    headers: { get: () => null },
    text: async () => '<html>unrelated service</html>',
  });
  await assert.rejects(() => verifyIsolatedQaService('http://127.0.0.1:3037'));
});
test('Round4: same-origin redirect must be followed and checked before success', async () => {
  globalThis.fetch = async () => ({
    status: 302,
    headers: { get: () => '/redirect-again' },
  });
  await assert.rejects(() => verifyIsolatedQaService('http://127.0.0.1:3037'));
});
test('Round4: arbitrary raw CDP error must not echo synthetic sensitive text', () => {
  const marker = 'synthetic-sensitive-phrase';
  assert.equal(
    sanitizeErrorMessage(new Error('Unexpected response: ' + marker)).includes(
      marker,
    ),
    false,
  );
});
