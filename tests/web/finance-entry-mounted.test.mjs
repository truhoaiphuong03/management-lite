import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installFakeDom } from './helpers/fake-dom.mjs';

const dom = installFakeDom();
globalThis.URL.createObjectURL = () => 'blob:fake-preview';
globalThis.URL.revokeObjectURL = () => {};
const { FinanceEntryScreen } =
  await import('../../dist/apps/web/src/screens/FinanceEntryScreen.js');
const h = React.createElement;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const identity = { userId: uuid(1), workspaceId: uuid(2) };
const CAT = uuid(500);
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => tick());
};

const store = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};
let posts = [];
let postPlan = [];
function install() {
  store.clear();
  posts = [];
  postPlan = [];
  globalThis.fetch = async (p, o) => {
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
    if (o?.method === 'POST') {
      const body = JSON.parse(o.body);
      posts.push({ key: o.headers['Idempotency-Key'], body });
      if ((postPlan.shift() ?? 'ok') === 'fail')
        return { ok: false, status: 500, json: async () => ({}) };
      return {
        ok: true,
        status: 201,
        json: async () => ({
          success: true,
          data: {
            ...body,
            id: uuid(900),
            version: 1,
            revision_id: uuid(901),
            category_name_snapshot: 'Ăn uống',
          },
        }),
      };
    }
    if (p.includes('/categories'))
      return ok({
        items: [
          {
            id: CAT,
            direction: 'expense',
            name: 'Ăn uống',
            is_active: true,
            version: 1,
          },
        ],
        next_cursor: null,
      });
    return ok({});
  };
}
async function mount(receipt, aiEnabled = true) {
  const container = dom.container();
  const root = createRoot(container);
  const navigated = [];
  await act(async () =>
    root.render(
      h(FinanceEntryScreen, {
        identity,
        onNavigate: (p) => navigated.push(p),
        receipt,
        ...(aiEnabled === 'default' ? {} : { aiEnabled }),
      }),
    ),
  );
  await flush();
  return { root, container, navigated };
}
const all = (c, pred) => dom.find(c, pred);
const checkbox = (c) =>
  all(c, (n) => n.nodeName === 'INPUT' && dom.props(n).type === 'checkbox')[0];
const dtInput = (c) =>
  all(
    c,
    (n) => n.nodeName === 'INPUT' && dom.props(n).type === 'datetime-local',
  )[0];
const amountInput = (c) =>
  all(
    c,
    (n) => n.nodeName === 'INPUT' && dom.props(n).inputMode === 'numeric',
  )[0];
const noteArea = (c) => all(c, (n) => n.nodeName === 'TEXTAREA')[0];
const catSelect = (c) => all(c, (n) => n.nodeName === 'SELECT')[1];
const form = (c) => all(c, (n) => n.nodeName === 'FORM')[0];
const buttonByText = (c, re) =>
  all(c, (n) => n.nodeName === 'BUTTON' && re.test(n.textContent))[0];
async function fillRequired(c) {
  await act(async () =>
    dom.props(catSelect(c)).onChange({ target: { value: CAT } }),
  );
  await act(async () =>
    dom.props(amountInput(c)).onChange({ target: { value: '125000' } }),
  );
}
const submit = (c) =>
  act(async () => dom.props(form(c)).onSubmit({ preventDefault() {} }));

test('FIN time UI: auto is default; unchecking shows a VN datetime input capped at now', async () => {
  install();
  const { root, container } = await mount();
  assert.equal(dom.props(checkbox(container)).checked, true);
  assert.equal(dtInput(container), undefined);
  assert.match(
    container.textContent,
    /Thời gian sẽ được ghi theo lúc bạn bấm Lưu/,
  );
  await act(async () =>
    dom.props(checkbox(container)).onChange({ target: { checked: false } }),
  );
  const dt = dtInput(container);
  assert.ok(dt, 'datetime-local input must appear in manual mode');
  assert.match(String(dom.props(dt).max), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  await act(async () => root.unmount());
});

test('FIN time UI: manual future time is rejected with no POST', async () => {
  install();
  const { root, container } = await mount();
  await fillRequired(container);
  await act(async () =>
    dom.props(checkbox(container)).onChange({ target: { checked: false } }),
  );
  await act(async () =>
    dom
      .props(dtInput(container))
      .onChange({ target: { value: '2999-01-01T10:00' } }),
  );
  await submit(container);
  await flush();
  assert.equal(posts.length, 0);
  assert.match(container.textContent, /tương lai/);
  await act(async () => root.unmount());
});

test('FIN time UI: auto date is frozen in the pending request and retry does not change it', async (t) => {
  install();
  t.mock.timers.enable({
    apis: ['Date'],
    now: new Date('2026-10-11T16:59:00Z'),
  }); // 23:59 VN, 11th
  const { root, container } = await mount();
  await fillRequired(container);
  postPlan = ['fail', 'ok'];
  await submit(container);
  await flush();
  assert.equal(posts.length, 1);
  // auto: the client sends no date at all; the server stamps the time once
  assert.equal(posts[0].body.time_mode, 'auto');
  assert.equal('occurred_on' in posts[0].body, false);
  assert.equal('occurred_at' in posts[0].body, false);
  // two minutes later it is already the 12th in VN
  t.mock.timers.setTime(new Date('2026-10-11T17:01:00Z').getTime());
  await submit(container);
  await flush();
  assert.equal(posts.length, 2);
  assert.equal(posts[1].key, posts[0].key, 'same idempotency key');
  assert.deepEqual(posts[1].body, posts[0].body, 'retry body is frozen');
  await act(async () => root.unmount());
});

test('FIN time UI: manual past time is sent as its VN date', async () => {
  install();
  const { root, container } = await mount();
  await fillRequired(container);
  await act(async () =>
    dom.props(checkbox(container)).onChange({ target: { checked: false } }),
  );
  await act(async () =>
    dom
      .props(dtInput(container))
      .onChange({ target: { value: '2026-01-02T08:15' } }),
  );
  await submit(container);
  await flush();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.occurred_on, '2026-01-02');
  assert.equal(posts[0].body.time_mode, 'manual');
  assert.equal(posts[0].body.occurred_at, '2026-01-02T08:15:00+07:00');
  await act(async () => root.unmount());
});

// ---- receipt panel inside the entry screen ----
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const fileOf = (bytes) => ({
  arrayBuffer: async () =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
});
function fakeApi(extractResult) {
  const calls = { upload: [], extract: [], discard: [] };
  return {
    calls,
    upload: async (b, mime) => {
      calls.upload.push({ size: b.length, mime });
      return { id: uuid(700), duplicate_of_entry_id: null };
    },
    extract: async (id) => {
      calls.extract.push(id);
      return extractResult;
    },
    discard: async (id) => {
      calls.discard.push(id);
    },
  };
}
const fileInput = (c) =>
  all(c, (n) => n.nodeName === 'INPUT' && dom.props(n).type === 'file')[0];
const pick = async (c, bytes) => {
  await act(async () =>
    dom.props(fileInput(c)).onChange({ target: { files: [fileOf(bytes)] } }),
  );
  await flush();
};

test('FIN receipt UI: upload, Read with AI prefills for review, and nothing is saved until Save', async () => {
  install();
  const api = fakeApi({
    status: 'ok',
    data: {
      amount_vnd: '88000',
      occurred_at: '2026-10-10T12:00:00+07:00',
      merchant: 'Quán B',
      description: null,
      suggested_category_id: CAT,
      direction_hint: 'expense',
      occurred_on: '2026-10-10',
      ambiguous_fields: ['category'],
      unreadable_fields: [],
    },
  });
  const { root, container } = await mount(api);
  await pick(container, PNG);
  assert.deepEqual(api.calls.upload, [{ size: PNG.length, mime: 'image/png' }]);
  assert.match(container.textContent, /Đã tải ảnh lên/);
  assert.ok(buttonByText(container, /Đọc bằng AI/));
  await act(async () =>
    dom.props(buttonByText(container, /Đọc bằng AI/)).onClick(),
  );
  await flush();
  assert.deepEqual(api.calls.extract, [uuid(700)]);
  assert.equal(dom.props(amountInput(container)).value, '88000');
  assert.equal(dom.props(noteArea(container)).value, 'Quán B');
  assert.equal(dom.props(catSelect(container)).value, CAT);
  assert.match(container.textContent, /AI gợi ý — hãy kiểm tra/);
  assert.match(container.textContent, /Dùng ngày giờ trên ảnh/);
  assert.match(container.textContent, /Cần kiểm tra kỹ: category/);
  assert.equal(posts.length, 0, 'AI prefill must never save');
  // Owner edits then confirms
  await act(async () =>
    dom.props(amountInput(container)).onChange({ target: { value: '90000' } }),
  );
  await submit(container);
  await flush();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.amount_vnd, '90000');
  assert.equal(
    posts[0].body.receipt_id,
    uuid(700),
    'confirmed save attaches the receipt',
  );
  assert.equal(posts[0].body.time_mode, 'auto');
  await act(async () => root.unmount());
});

test('FIN receipt UI: discarding the image removes receipt_id from the saved request', async () => {
  install();
  const api = fakeApi({ status: 'unavailable', reason: 'x' });
  const { root, container } = await mount(api);
  await pick(container, PNG);
  await fillRequired(container);
  const discardBtn = buttonByText(container, /Bỏ ảnh|Xóa ảnh|Hủy ảnh/);
  assert.ok(discardBtn, 'discard button present');
  await act(async () => dom.props(discardBtn).onClick());
  await flush();
  assert.deepEqual(api.calls.discard, [uuid(700)]);
  await submit(container);
  await flush();
  assert.equal(posts.length, 1);
  assert.equal('receipt_id' in posts[0].body, false);
  await act(async () => root.unmount());
});

test('FIN receipt UI: AI unavailable keeps manual entry working', async () => {
  install();
  const api = fakeApi({ status: 'unavailable', reason: 'timeout' });
  const { root, container } = await mount(api);
  await pick(container, PNG);
  await act(async () =>
    dom.props(buttonByText(container, /Đọc bằng AI/)).onClick(),
  );
  await flush();
  assert.match(
    container.textContent,
    /Chưa đọc được bằng AI. Hãy nhập thủ công/,
  );
  assert.equal(dom.props(amountInput(container)).value, '');
  await fillRequired(container);
  await submit(container);
  await flush();
  assert.equal(posts.length, 1);
  await act(async () => root.unmount());
});

test('FIN receipt UI: wrong type is rejected before upload; upload failure leaves manual entry', async () => {
  install();
  const api = fakeApi({ status: 'unavailable', reason: 'disabled' });
  const { root, container } = await mount(api);
  await pick(container, Uint8Array.from(Buffer.from('<svg xmlns="x"/>')));
  assert.equal(api.calls.upload.length, 0);
  assert.match(container.textContent, /Chỉ nhận ảnh JPEG hoặc PNG/);
  assert.equal(buttonByText(container, /Đọc bằng AI/), undefined);
  api.upload = async () => {
    throw new Error('network');
  };
  await pick(container, PNG);
  assert.match(container.textContent, /Không tải được ảnh/);
  await fillRequired(container);
  await submit(container);
  await flush();
  assert.equal(posts.length, 1);
  await act(async () => root.unmount());
});

test('FIN receipt UI: duplicate warning and discard', async () => {
  install();
  const api = fakeApi({ status: 'unavailable', reason: 'disabled' });
  api.upload = async () => ({
    id: uuid(701),
    duplicate_of_entry_id: uuid(800),
  });
  const { root, container } = await mount(api);
  await pick(container, PNG);
  assert.match(container.textContent, /đã được gắn vào một giao dịch khác/);
  await act(async () => dom.props(buttonByText(container, /Bỏ ảnh/)).onClick());
  await flush();
  assert.deepEqual(api.calls.discard, [uuid(701)]);
  assert.equal(buttonByText(container, /Đọc bằng AI/), undefined);
  await act(async () => root.unmount());
});

test('FIN receipt UI: panel is absent when no receipt backend is provided', async () => {
  install();
  const { root, container } = await mount();
  assert.equal(fileInput(container), undefined);
  await act(async () => root.unmount());
});

test('FIN release: "Đọc bằng AI" is hidden by default and the manual receipt flow still saves', async () => {
  install();
  const api = fakeApi({ status: 'ok', data: {} });
  const { root, container } = await mount(api, 'default');
  await pick(container, PNG);
  assert.deepEqual(api.calls.upload, [{ size: PNG.length, mime: 'image/png' }]);
  assert.equal(buttonByText(container, /Đọc bằng AI/), undefined);
  assert.ok(
    buttonByText(container, /Bỏ ảnh/),
    'receipt can still be discarded',
  );
  assert.equal(api.calls.extract?.length ?? 0, 0, 'AI is never called');
  await fillRequired(container);
  await submit(container);
  await flush();
  assert.equal(posts.length, 1);
  assert.match(JSON.stringify(posts[0]), /receipt_id/);
  await act(async () => root.unmount());
});
