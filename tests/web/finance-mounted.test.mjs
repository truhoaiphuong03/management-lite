import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installFakeDom } from './helpers/fake-dom.mjs';

const dom = installFakeDom();
const { useFinanceMutation } =
  await import('../../dist/apps/web/src/finance/ui.js');
const h = React.createElement;

const identity = {
  userId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
};
const payload = {
  direction: 'expense',
  category_id: '44444444-4444-4444-8444-444444444444',
  amount_vnd: '150000',
  occurred_on: '2026-10-11',
  note: 'ăn trưa',
};
const slot = 'new-entry';
const sk = `fin01a:${identity.workspaceId}:${identity.userId}:${slot}`;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function makeStorage(mode) {
  const map = new Map();
  let removed = false;
  globalThis.sessionStorage = {
    getItem(k) {
      // real removal already happened; only the confirmation read misbehaves
      if (removed && k === sk) {
        removed = false;
        if (mode === 'throw') throw new Error('storage read failure');
        if (mode === 'mismatch') return '"stale-mismatch"';
      }
      return map.has(k) ? map.get(k) : null;
    },
    setItem: (k, v) => map.set(k, v),
    removeItem(k) {
      map.delete(k);
      if (k === sk) removed = true;
    },
  };
  return map;
}
function makeServer() {
  const posts = [];
  globalThis.fetch = async (p, o) => {
    if (p.endsWith('/auth/me'))
      return {
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
      };
    posts.push({ key: o.headers['Idempotency-Key'], body: o.body });
    return {
      ok: true,
      status: 201,
      json: async () => ({
        success: true,
        data: {
          ...payload,
          id: uuid(900),
          version: 1,
          revision_id: uuid(901),
          category_name_snapshot: 'Ăn uống',
        },
      }),
    };
  };
  return posts;
}
async function mount(api) {
  const container = dom.container();
  const root = createRoot(container);
  function Probe() {
    api.current = useFinanceMutation(identity, slot);
    return h('p', null, api.current.error);
  }
  await act(async () => root.render(h(Probe)));
  return root;
}

for (const mode of ['throw', 'mismatch']) {
  test(`P1 clearPending: server success, real removal, confirmation read ${mode} -> remount/retry keeps ONE key`, async () => {
    const map = makeStorage(mode);
    const posts = makeServer();
    const api = { current: null };
    let root = await mount(api);
    assert.equal(api.current.ready, true);
    // 1st attempt: server accepted; cleanup confirmation fails.
    await act(async () => {
      await api.current.submit('/entries', 'POST', payload);
    });
    assert.equal(posts.length, 1);
    assert.match(api.current.error, /.+/, 'user must see the cleanup error');
    // component unmounts (navigation) and mounts again
    await act(async () => root.unmount());
    root = await mount(api);
    assert.ok(
      api.current.pending || map.has(sk),
      'original pending operation must survive cleanup failure',
    );
    // user retries the same intent
    await act(async () => {
      await api.current.submit('/entries', 'POST', payload);
    });
    assert.equal(posts.length, 2);
    assert.equal(
      new Set(posts.map((p) => p.key)).size,
      1,
      'same intent must reuse the original Idempotency-Key',
    );
    assert.equal(posts[0].body, posts[1].body);
    await act(async () => root.unmount());
  });
}

test('P1 clearPending: retry in the same mounted component after cleanup failure reuses original key', async () => {
  makeStorage('throw');
  const posts = makeServer();
  const api = { current: null };
  const root = await mount(api);
  await act(async () => {
    await api.current.submit('/entries', 'POST', payload);
  });
  await act(async () => {
    await api.current.submit('/entries', 'POST', payload);
  });
  assert.equal(posts.length, 2);
  assert.equal(new Set(posts.map((p) => p.key)).size, 1);
  await act(async () => root.unmount());
});

test('P1 clearPending: clean success clears pending and next intent gets a NEW key', async () => {
  const map = makeStorage('ok');
  const posts = makeServer();
  const api = { current: null };
  const root = await mount(api);
  await act(async () => {
    await api.current.submit('/entries', 'POST', payload);
  });
  assert.equal(map.has(sk), false);
  assert.equal(api.current.pending, null);
  await act(async () => {
    await api.current.submit('/entries', 'POST', payload);
  });
  assert.equal(new Set(posts.map((p) => p.key)).size, 2);
  await act(async () => root.unmount());
});
