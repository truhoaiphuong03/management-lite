import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as client from '../../dist/apps/web/src/finance/client.js';

const { loadPending, savePending, clearPending, sendPending } = client;
const identity = {
  userId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
};
const key = '33333333-3333-4333-8333-333333333333';
const payload = {
  direction: 'expense',
  category_id: '44444444-4444-4444-8444-444444444444',
  amount_vnd: '9007199254740993',
  occurred_on: '2026-10-11',
  note: '  nguyên văn\n',
};
const op = () => ({
  identity,
  key,
  path: '/entries',
  method: 'POST',
  payload,
  version: null,
});
const store = new Map();
const base = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};
globalThis.sessionStorage = base;
const sk = `fin01a:${identity.workspaceId}:${identity.userId}:new-entry`;
const auth = () => ({
  ok: true,
  status: 200,
  json: async () => ({
    success: true,
    data: {
      user: { id: identity.userId },
      active_workspace: { id: identity.workspaceId, role: 'owner' },
      csrf_token: 'synthetic',
    },
  }),
});
const okEntry = () => ({
  ok: true,
  status: 201,
  json: async () => ({
    success: true,
    data: {
      ...payload,
      id: key,
      version: 1,
      revision_id: key,
      category_name_snapshot: 'Test',
    },
  }),
});

// ---- B1: pending/retry cleanup ----
test('B1 server success + cleanup read-back failure keeps original key/payload and retry replays them', async () => {
  store.clear();
  savePending(identity, 'new-entry', op());
  const rawBefore = store.get(sk);
  const requests = [];
  globalThis.fetch = async (p, o) => {
    if (p.endsWith('/me')) return auth();
    requests.push(o);
    return okEntry();
  };
  const first = await sendPending(
    loadPending(identity, 'new-entry'),
    new AbortController().signal,
  );
  assert.equal(first.id, key);
  // cleanup cannot remove (storage ignores removeItem)
  globalThis.sessionStorage = { ...base, removeItem() {} };
  assert.throws(() => clearPending(identity, 'new-entry', key), /Chỉ thử lại/);
  globalThis.sessionStorage = base;
  assert.equal(store.get(sk), rawBefore, 'stored record must be untouched');
  // remount: pending is reloaded and retried with identical key and body
  const reloaded = loadPending(identity, 'new-entry');
  assert.equal(reloaded.key, key);
  await sendPending(reloaded, new AbortController().signal);
  assert.equal(requests.length, 2);
  assert.equal(requests[1].headers['Idempotency-Key'], key);
  assert.equal(requests[0].body, requests[1].body);
  clearPending(identity, 'new-entry', key);
  assert.equal(loadPending(identity, 'new-entry'), null);
});

test('B1 removeItem exception never drops or rewrites the stored operation', () => {
  store.clear();
  savePending(identity, 'new-entry', op());
  const rawBefore = store.get(sk);
  globalThis.sessionStorage = {
    ...base,
    removeItem() {
      throw new Error('storage failure');
    },
  };
  assert.throws(() => clearPending(identity, 'new-entry', key));
  globalThis.sessionStorage = base;
  assert.equal(store.get(sk), rawBefore);
  assert.equal(loadPending(identity, 'new-entry').key, key);
});

test('B1 corrupted or foreign record at cleanup time is never silently deleted', () => {
  store.clear();
  store.set(sk, '{');
  assert.throws(() => clearPending(identity, 'new-entry', key));
  assert.equal(store.get(sk), '{');
  store.clear();
  savePending(identity, 'new-entry', op());
  const raw = store.get(sk);
  clearPending(identity, 'new-entry', '55555555-5555-4555-8555-555555555555');
  assert.equal(store.get(sk), raw);
  clearPending(
    { ...identity, userId: '66666666-6666-4666-8666-666666666666' },
    'new-entry',
    key,
  );
  assert.equal(store.get(sk), raw);
});

test('B1 submit flow clears only after success, via original identity and key', () => {
  const src = readFileSync('apps/web/src/finance/ui.tsx', 'utf8');
  const send = src.indexOf('await sendPending(o');
  const clear = src.indexOf('clearPending(o.identity, slot, o.key)');
  assert.ok(send > 0 && clear > send);
});

// ---- B2: category pagination in history filter ----
const cat = (n) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  name: `C${n}`,
  direction: 'expense',
  is_active: true,
  version: 1,
});
const page = (from, count, next) => ({
  items: Array.from({ length: count }, (_, i) => cat(from + i)),
  next_cursor: next,
});
function pagedFetch(pages, seen = []) {
  return async (p) => {
    if (p.endsWith('/me')) return auth();
    seen.push(p);
    const u = new URL(p, 'http://x');
    const c = u.searchParams.get('cursor');
    const data = pages[c ?? ''];
    if (!data) return { ok: false, status: 422, json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data }),
    };
  };
}
test('B2 loadCategoryPages exists and follows next_cursor beyond 100', async () => {
  assert.equal(typeof client.loadCategoryPages, 'function');
  const seen = [];
  globalThis.fetch = pagedFetch(
    {
      '': page(1, 100, 'c2'),
      c2: page(101, 100, 'c3'),
      c3: page(201, 5, null),
    },
    seen,
  );
  const items = await client.loadCategoryPages(
    identity,
    'expense',
    new AbortController().signal,
  );
  assert.equal(items.length, 205);
  assert.equal(items[204].name, 'C205');
  const reqs = seen.filter((p) => p.includes('/categories'));
  assert.equal(reqs.length, 3);
  assert.ok(reqs.every((r) => r.includes('direction=expense')));
  assert.ok(reqs[1].includes('cursor=c2'));
});
test('B2 loader fails closed on page error, repeated cursor and runaway paging', async () => {
  globalThis.fetch = pagedFetch({ '': page(1, 100, 'c2') });
  await assert.rejects(
    client.loadCategoryPages(identity, '', new AbortController().signal),
  );
  globalThis.fetch = pagedFetch({ '': page(1, 2, 'c2'), c2: page(3, 2, 'c2') });
  await assert.rejects(
    client.loadCategoryPages(identity, '', new AbortController().signal),
  );
  const runaway = {};
  for (let i = 0; i < 80; i++)
    runaway[i === 0 ? '' : `p${i}`] = page(i * 3, 3, `p${i + 1}`);
  globalThis.fetch = pagedFetch(runaway);
  await assert.rejects(
    client.loadCategoryPages(identity, '', new AbortController().signal),
  );
});
test('B2 loader honours abort (stale/session change) and dedupes ids', async () => {
  const c = new AbortController();
  globalThis.fetch = async (p) => {
    if (p.endsWith('/me')) {
      c.abort();
      return auth();
    }
    throw new Error('must not fetch after abort');
  };
  await assert.rejects(client.loadCategoryPages(identity, '', c.signal));
  globalThis.fetch = pagedFetch({ '': page(1, 3, 'c2'), c2: page(3, 3, null) });
  const items = await client.loadCategoryPages(
    identity,
    '',
    new AbortController().signal,
  );
  assert.equal(items.length, 5);
});
test('B2 history screen uses the paged loader with identity/direction binding', () => {
  const src = readFileSync(
    'apps/web/src/screens/FinanceHistoryScreen.tsx',
    'utf8',
  );
  assert.match(src, /loadCategoryPages\(/);
  assert.doesNotMatch(src, /categories\?limit=100/);
  assert.doesNotMatch(src, /Danh mục còn trang sau/);
  assert.match(src, /c\.abort\(\)/);
  assert.match(src, /identity\.userId/);
  assert.match(src, /identity\.workspaceId/);
});

test('D loader: shape, cursor and mid-flight abort validation fail closed', async () => {
  const sig = () => new AbortController().signal;
  for (const bad of [
    { items: [{ id: 'x' }], next_cursor: null },
    { items: [{ ...cat(1), direction: 'other' }], next_cursor: null },
    { items: [{ ...cat(1), is_active: 'yes' }], next_cursor: null },
    { items: [cat(1)], next_cursor: '' },
    { items: [cat(1)], next_cursor: 'a b' },
    { items: [cat(1)], next_cursor: 7 },
    { items: [cat(1)] },
    { items: 'nope', next_cursor: null },
  ]) {
    globalThis.fetch = pagedFetch({ '': bad });
    await assert.rejects(
      client.loadCategoryPages(identity, '', sig()),
      JSON.stringify(bad),
    );
  }
  globalThis.fetch = pagedFetch({ '': { items: [cat(1)], next_cursor: null } });
  await assert.rejects(client.loadCategoryPages(identity, 'income', sig()));
  // abort lands between response and JSON parse
  const c = new AbortController();
  globalThis.fetch = async (p) => {
    if (p.endsWith('/me')) return auth();
    return {
      ok: true,
      status: 200,
      json: async () => {
        c.abort();
        return { success: true, data: { items: [cat(1)], next_cursor: null } };
      },
    };
  };
  await assert.rejects(client.loadCategoryPages(identity, '', c.signal));
});
