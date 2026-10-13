import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installFakeDom } from './helpers/fake-dom.mjs';

const dom = installFakeDom();
const { FinanceEntryScreen } =
  await import('../../dist/apps/web/src/screens/FinanceEntryScreen.js');
const h = React.createElement;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const identity = { userId: uuid(1), workspaceId: uuid(2) };
const CAT = uuid(500);
const ENTRY = uuid(700);
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => tick());
};
const store = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};
const entry = (direction) => ({
  id: ENTRY,
  revision_id: uuid(701),
  version: 1,
  direction,
  category_id: CAT,
  category_name_snapshot: 'Ăn uống',
  amount_vnd: '200000',
  occurred_on: '2026-10-11',
  occurred_at: '2026-10-11T09:00:00+07:00',
  occurred_at_source: 'auto',
  note: 'x',
});
function install(direction) {
  store.clear();
  globalThis.fetch = async (p) => {
    const ok = (data) => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data }),
    });
    if (p.endsWith('/auth/me'))
      return ok({
        user: { id: identity.userId },
        active_workspace: { id: identity.workspaceId, role: 'owner' },
        csrf_token: 'synthetic',
      });
    if (p.includes('/corrections')) return ok({ items: [], next_cursor: null });
    if (p.includes('/entries/')) return ok(entry(direction));
    if (p.includes('/categories'))
      return ok({
        items: [
          { id: CAT, direction, name: 'Ăn uống', is_active: true, version: 1 },
        ],
        next_cursor: null,
      });
    return ok({});
  };
}
const all = (c, pred) => dom.find(c, pred);
async function openCorrection(direction) {
  install(direction);
  const container = dom.container();
  const root = createRoot(container);
  await act(async () =>
    root.render(
      h(FinanceEntryScreen, {
        identity,
        onNavigate: () => {},
        entryId: ENTRY,
        aiEnabled: false,
      }),
    ),
  );
  await flush();
  const edit = all(
    container,
    (n) => n.nodeName === 'BUTTON' && /Chỉnh sửa có lý do/.test(n.textContent),
  )[0];
  assert.ok(edit, 'correction button must be present');
  await act(async () => dom.props(edit).onClick());
  await flush();
  const offered = all(
    container,
    (n) => n.nodeName === 'OPTION' && dom.props(n).value === CAT,
  );
  await act(async () => root.unmount());
  return offered.length;
}

for (const direction of ['expense', 'income']) {
  test(`FIN correction UI (${direction}): the entry's category is offered when editing starts`, async () => {
    assert.equal(await openCorrection(direction), 1);
  });
}
