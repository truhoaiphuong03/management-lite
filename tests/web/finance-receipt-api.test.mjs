// FIN web: real ReceiptApi (fetch mocked) and the auto/manual time response checks in sendPending.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as client from '../../dist/apps/web/src/finance/client.js';

const { createReceiptApi, sendPending } = client;
const identity = {
  userId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
};
const RID = '55555555-5555-4555-8555-555555555555';
const CAT = '44444444-4444-4444-8444-444444444444';
const ok = (data, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => ({ success: status < 400, data, error: { code: 'X' } }),
});
const me = () =>
  ok({
    user: { id: identity.userId },
    active_workspace: { id: identity.workspaceId, role: 'owner' },
    csrf_token: 'csrf-1',
  });
function mockFetch(t, handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url, init });
    if (url === '/api/v1/auth/me') return me();
    return handler(url, init);
  };
  t.after(() => {
    globalThis.fetch = original;
  });
  return calls;
}
const signal = () => new AbortController().signal;
const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

test('FIN ReceiptApi.upload posts raw bytes with CSRF and the sniffed type', async (t) => {
  const calls = mockFetch(t, () =>
    ok({ id: RID, duplicate_of_entry_id: null }, 201),
  );
  const r = await createReceiptApi(identity).upload(
    bytes,
    'image/png',
    signal(),
  );
  assert.deepEqual(r, { id: RID, duplicate_of_entry_id: null });
  const c = calls.find((x) => x.url === '/api/v1/fin/receipts');
  assert.equal(c.init.method, 'POST');
  assert.equal(c.init.headers['X-CSRF-Token'], 'csrf-1');
  assert.equal(c.init.headers['Content-Type'], 'image/png');
  assert.equal(c.init.body, bytes);
  assert.equal(c.init.credentials, 'include');
});
test('FIN ReceiptApi.upload fails closed on server errors and malformed responses', async (t) => {
  mockFetch(t, () => ok({ id: 'x' }, 201));
  await assert.rejects(
    createReceiptApi(identity).upload(bytes, 'image/png', signal()),
  );
  mockFetch(t, () => ok({}, 415));
  await assert.rejects(
    createReceiptApi(identity).upload(bytes, 'image/png', signal()),
    (e) => e.status === 415,
  );
});
test('FIN ReceiptApi refuses to act when the session identity changed', async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) =>
    url === '/api/v1/auth/me'
      ? ok({
          user: { id: identity.userId },
          active_workspace: {
            id: '99999999-9999-4999-8999-999999999999',
            role: 'owner',
          },
          csrf_token: 'c',
        })
      : ok({}, 201);
  t.after(() => {
    globalThis.fetch = original;
  });
  await assert.rejects(
    createReceiptApi(identity).upload(bytes, 'image/png', signal()),
  );
});
test('FIN ReceiptApi.extract maps ok / unavailable / rate-limit; errors throw', async (t) => {
  const suggestion = {
    amount_vnd: '5',
    occurred_on: null,
    occurred_at: null,
    merchant: null,
    description: null,
    suggested_category_id: null,
    direction_hint: null,
    ambiguous_fields: [],
    unreadable_fields: [],
  };
  mockFetch(t, () => ok({ status: 'ok', data: suggestion }));
  assert.deepEqual(await createReceiptApi(identity).extract(RID, signal()), {
    status: 'ok',
    data: suggestion,
  });
  mockFetch(t, () => ok({ status: 'unavailable', reason: 'AI_TIMEOUT' }));
  assert.deepEqual(await createReceiptApi(identity).extract(RID, signal()), {
    status: 'unavailable',
    reason: 'AI_TIMEOUT',
  });
  mockFetch(t, () => ok({}, 429));
  assert.deepEqual(await createReceiptApi(identity).extract(RID, signal()), {
    status: 'unavailable',
    reason: 'AI_RATE_LIMITED',
  });
  mockFetch(t, () => ok({ status: 'ok', data: { amount_vnd: '5' } }));
  await assert.rejects(
    createReceiptApi(identity).extract(RID, signal()),
    'malformed suggestion',
  );
  mockFetch(t, () => ok({}, 403));
  await assert.rejects(createReceiptApi(identity).extract(RID, signal()));
  await assert.rejects(
    createReceiptApi(identity).extract('not-a-uuid', signal()),
  );
});
test('FIN ReceiptApi.discard uses DELETE with CSRF', async (t) => {
  const calls = mockFetch(t, () => ok({ id: RID, state: 'discarded' }));
  await createReceiptApi(identity).discard(RID, signal());
  const c = calls.find((x) => x.url === `/api/v1/fin/receipts/${RID}`);
  assert.equal(c.init.method, 'DELETE');
  assert.equal(c.init.headers['X-CSRF-Token'], 'csrf-1');
  mockFetch(t, () => ok({}, 409));
  await assert.rejects(createReceiptApi(identity).discard(RID, signal()));
});

// ---- sendPending echo checks for the new time model ----
const entryResponse = (extra) => ({
  id: RID,
  revision_id: '66666666-6666-4666-8666-666666666666',
  version: 1,
  direction: 'expense',
  category_id: CAT,
  category_name_snapshot: 'Ăn',
  amount_vnd: '1000',
  occurred_on: '2026-10-11',
  note: null,
  occurred_at: '2026-10-11T12:00:00+07:00',
  occurred_at_source: 'auto',
  receipt_id: null,
  ...extra,
});
const op = (payload) => ({
  identity,
  key: '33333333-3333-4333-8333-333333333333',
  path: '/entries',
  method: 'POST',
  payload: {
    direction: 'expense',
    category_id: CAT,
    amount_vnd: '1000',
    note: null,
    ...payload,
  },
  version: null,
});
test('FIN sendPending accepts an auto response (server-stamped time) with no client date', async (t) => {
  mockFetch(t, () => ok(entryResponse({}), 201));
  const d = await sendPending(op({ time_mode: 'auto' }), signal());
  assert.equal(d.occurred_at_source, 'auto');
});
test('FIN sendPending rejects an auto response that is not auto-stamped', async (t) => {
  mockFetch(t, () =>
    ok(
      entryResponse({
        occurred_at: null,
        occurred_at_source: 'legacy_date_only',
      }),
      201,
    ),
  );
  await assert.rejects(
    sendPending(op({ time_mode: 'auto' }), signal()),
    /thời gian|Response/,
  );
});
test('FIN sendPending checks manual time echo and receipt echo', async (t) => {
  const manual = {
    time_mode: 'manual',
    occurred_at: '2026-10-10T08:15:00+07:00',
    occurred_on: '2026-10-10',
  };
  mockFetch(t, () =>
    ok(
      entryResponse({
        occurred_on: '2026-10-10',
        occurred_at: manual.occurred_at,
        occurred_at_source: 'manual',
      }),
      201,
    ),
  );
  assert.equal(
    (await sendPending(op(manual), signal())).occurred_at_source,
    'manual',
  );
  // server changed the time -> keep the pending request for reconciliation
  mockFetch(t, () =>
    ok(
      entryResponse({
        occurred_on: '2026-10-10',
        occurred_at: '2026-10-10T08:16:00+07:00',
        occurred_at_source: 'manual',
      }),
      201,
    ),
  );
  await assert.rejects(sendPending(op(manual), signal()));
  // receipt id must be echoed
  mockFetch(t, () => ok(entryResponse({ receipt_id: null }), 201));
  await assert.rejects(
    sendPending(op({ time_mode: 'auto', receipt_id: RID }), signal()),
  );
  mockFetch(t, () => ok(entryResponse({ receipt_id: RID }), 201));
  assert.equal(
    (await sendPending(op({ time_mode: 'auto', receipt_id: RID }), signal()))
      .receipt_id,
    RID,
  );
});
