import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installFakeDom } from './helpers/fake-dom.mjs';

const dom = installFakeDom();
const { FinanceHistoryScreen } =
  await import('../../dist/apps/web/src/screens/FinanceHistoryScreen.js');
const h = React.createElement;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = { userId: uuid(1), workspaceId: uuid(2) };
const B = { userId: uuid(3), workspaceId: uuid(4) };
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => tick());
};

let session = A;
let reqs = [];
function install() {
  reqs = [];
  globalThis.fetch = (p, o) => {
    if (p.endsWith('/auth/me'))
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            user: { id: session.userId },
            active_workspace: { id: session.workspaceId, role: 'owner' },
            csrf_token: 'synthetic',
          },
        }),
      });
    return new Promise((resolve, reject) => {
      const r = {
        url: p,
        who: session === A ? 'A' : 'B',
        done: false,
        respond(data, ok = true) {
          r.done = true;
          resolve({
            ok,
            status: ok ? 200 : 500,
            json: async () => (ok ? { success: true, data } : {}),
          });
        },
        fail() {
          r.done = true;
          reject(new Error('network'));
        },
      };
      void o;
      reqs.push(r);
    });
  };
}
const open = (needle, who) =>
  reqs.filter(
    (r) => !r.done && r.url.includes(needle) && (!who || r.who === who),
  );
const entry = (n, label, cat) => ({
  id: uuid(100 + n),
  direction: 'expense',
  category_id: cat,
  category_name_snapshot: label,
  amount_vnd: '1000',
  occurred_on: '2026-10-11',
  note: label + '-note',
  version: 1,
});
const category = (n, name) => ({
  id: uuid(500 + n),
  name,
  direction: 'expense',
  is_active: true,
  version: 1,
});
async function mount(identity) {
  const container = dom.container();
  const root = createRoot(container);
  const render = (id) =>
    act(async () =>
      root.render(h(FinanceHistoryScreen, { identity: id, onNavigate() {} })),
    );
  await render(identity);
  await flush();
  return { root, container, render };
}
const selects = (c) => dom.find(c, (n) => n.nodeName === 'SELECT');
const text = (c) => c.textContent;

test('P1 history identity: Owner/workspace change drops rows, cursor, category and ignores stale responses', async () => {
  install();
  session = A;
  const { root, container, render } = await mount(A);
  open('/entries', 'A')[0].respond({
    items: [entry(1, 'A-row', uuid(501))],
    next_cursor: null,
    total: 45,
    offset: 0,
    limit: 20,
  });
  for (const r of open('/categories', 'A'))
    r.respond({ items: [category(1, 'A-cat')], next_cursor: null });
  await flush();
  assert.match(text(container), /A-row/);
  assert.match(text(container), /A-cat/);

  // Owner A selects a category
  const catSelect = selects(container)[1];
  await act(async () => {
    dom.props(catSelect).onChange({ target: { value: uuid(501) } });
  });
  await flush();
  assert.ok(
    open('/entries', 'A').some((r) =>
      r.url.includes('category_id=' + uuid(501)),
    ),
  );
  open('/entries', 'A')
    .at(-1)
    .respond({
      items: [entry(1, 'A-row', uuid(501))],
      next_cursor: null,
      total: 45,
      offset: 0,
      limit: 20,
    });
  await flush();

  // Owner A requests the next page; response is delayed
  const more = dom.find(
    container,
    (n) => n.nodeName === 'BUTTON' && /^Sau$/.test(n.textContent),
  );
  assert.ok(more.length > 0, 'next page must be available');
  await act(async () => dom.props(more[0]).onClick());
  await flush();
  const lateA = open('offset=20', 'A')[0];
  assert.ok(lateA, 'A next-page request must be in flight');

  // identity changes to a different Owner/workspace
  session = B;
  const before = reqs.length;
  await render(B);
  await flush();
  const bReqs = reqs.slice(before).filter((r) => r.who === 'B');
  assert.ok(bReqs.length >= 2, 'B must load its own entries/categories');
  for (const r of bReqs) {
    assert.ok(!r.url.includes('offset=20'), 'A page leaked into B: ' + r.url);
    assert.ok(!r.url.includes(uuid(501)), 'A category leaked into B: ' + r.url);
  }
  assert.ok(!/A-row|A-cat/.test(text(container)), 'A data visible under B');
  assert.equal(
    dom.props(selects(container)[1]).value,
    '',
    'selected category must reset',
  );

  // stale A response arrives after identity change
  lateA.respond({
    items: [entry(2, 'A-late', uuid(501))],
    next_cursor: null,
    total: 45,
  });
  await flush();
  assert.ok(!/A-late|A-row/.test(text(container)), 'stale A response rendered');

  // B responses
  open('/entries', 'B')[0].respond({
    items: [entry(3, 'B-row', uuid(601))],
    next_cursor: null,
    total: 1,
  });
  for (const r of open('/categories', 'B'))
    r.respond({
      items: [{ ...category(9, 'B-cat'), id: uuid(601) }],
      next_cursor: null,
    });
  await flush();
  const t = text(container);
  assert.match(t, /B-row/);
  assert.match(t, /B-cat/);
  assert.ok(!/A-row|A-cat|A-late/.test(t), 'A data merged into B');
  await act(async () => root.unmount());
});

const optionNames = (c) =>
  dom
    .find(c, (n) => n.nodeName === 'OPTION')
    .map((n) => n.textContent)
    .filter(
      (t) => t !== 'Tất cả' && t !== 'Thu' && t !== 'Chi' && !/^\d+$/.test(t),
    );
const cat = (n, name, direction = 'expense') => ({
  ...category(n, name),
  direction,
});

test('P2 categories: page failure mid-chain shows no partial list, then retry loads the full list', async () => {
  install();
  session = A;
  const { root, container } = await mount(A);
  open('/entries', 'A')[0].respond({ items: [], next_cursor: null });
  open('/categories', 'A')[0].respond({
    items: [cat(1, 'P1-cat'), cat(2, 'P1b-cat')],
    next_cursor: 'p2',
  });
  await flush();
  open('cursor=p2', 'A')[0].respond({}, false);
  await flush();
  assert.deepEqual(optionNames(container), [], 'partial list shown as success');
  assert.match(text(container), /Không tải đủ danh mục/);
  const retry = dom.find(
    container,
    (n) => n.nodeName === 'BUTTON' && /Thử lại danh mục/.test(n.textContent),
  );
  assert.equal(retry.length, 1);
  await act(async () => dom.props(retry[0]).onClick());
  await flush();
  const first = open('/categories', 'A').find(
    (r) => !r.url.includes('cursor='),
  );
  first.respond({
    items: [cat(1, 'P1-cat'), cat(2, 'P1b-cat')],
    next_cursor: 'p2',
  });
  await flush();
  open('cursor=p2', 'A')[0].respond({
    items: [cat(3, 'P2-cat')],
    next_cursor: null,
  });
  await flush();
  assert.deepEqual(optionNames(container), ['P1-cat', 'P1b-cat', 'P2-cat']);
  assert.ok(!/Không tải đủ danh mục/.test(text(container)));
  await act(async () => root.unmount());
});

test('P2 categories: delayed response for an old direction is never shown after direction change', async () => {
  install();
  session = A;
  const { root, container } = await mount(A);
  open('/entries', 'A')[0].respond({ items: [], next_cursor: null });
  const oldReq = open('/categories', 'A')[0];
  assert.ok(!oldReq.url.includes('direction='));
  await act(async () => {
    dom.props(selects(container)[0]).onChange({ target: { value: 'income' } });
  });
  await flush();
  const incomeReq = open('direction=income', 'A').find((r) =>
    r.url.includes('/categories'),
  );
  assert.ok(incomeReq, 'new direction must issue a new request');
  oldReq.respond({ items: [cat(1, 'OLD-cat')], next_cursor: null });
  await flush();
  assert.ok(
    !/OLD-cat/.test(text(container)),
    'stale direction response rendered',
  );
  incomeReq.respond({
    items: [cat(2, 'INC-cat', 'income')],
    next_cursor: null,
  });
  await flush();
  assert.deepEqual(optionNames(container), ['INC-cat']);
  await act(async () => root.unmount());
});

test('P2 categories: malformed category, bad cursor or wrong direction => error, no options', async () => {
  for (const bad of [
    { items: [{ id: 'x', name: 'n' }], next_cursor: null },
    { items: [cat(1, 'ok')], next_cursor: '' },
    { items: [cat(1, 'ok')], next_cursor: 'bad cursor!' },
    { items: [cat(1, 'ok')] },
    {
      items: [cat(1, 'wrong', 'income')],
      next_cursor: null,
      direction: 'expense',
    },
  ]) {
    install();
    session = A;
    const { root, container } = await mount(A);
    open('/entries', 'A')[0].respond({ items: [], next_cursor: null });
    if (bad.direction)
      await act(async () => {
        dom
          .props(selects(container)[0])
          .onChange({ target: { value: 'expense' } });
      });
    await flush();
    const req = open('/categories', 'A').at(-1);
    req.respond({ items: bad.items, next_cursor: bad.next_cursor });
    await flush();
    assert.deepEqual(optionNames(container), [], JSON.stringify(bad));
    assert.match(text(container), /Không tải đủ danh mục/);
    await act(async () => root.unmount());
  }
});
