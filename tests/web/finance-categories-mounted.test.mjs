import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installFakeDom } from './helpers/fake-dom.mjs';

const dom = installFakeDom();
globalThis.window.addEventListener = () => {};
globalThis.window.removeEventListener = () => {};
const { FinanceCategoriesScreen } =
  await import('../../dist/apps/web/src/screens/FinanceCategoriesScreen.js');
const h = React.createElement;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const identity = { userId: uuid(1), workspaceId: uuid(2) };
const CAT1 = uuid(501);
const CAT2 = uuid(502);

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

function setupMockServer() {
  store.clear();
  const requests = [];
  const state = {
    categories: [
      {
        id: CAT1,
        direction: 'expense',
        name: 'Ăn uống',
        is_active: true,
        version: 1,
      },
      {
        id: CAT2,
        direction: 'expense',
        name: 'Đi lại',
        is_active: false,
        version: 1,
      },
      {
        id: uuid(503),
        direction: 'income',
        name: 'Lương',
        is_active: true,
        version: 1,
      },
    ],
  };

  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET', body: options.body });
    const ok = (data, status = 200) => ({
      ok: true,
      status,
      json: async () => ({ success: true, data }),
    });

    if (url.endsWith('/auth/me')) {
      return ok({
        user: { id: identity.userId },
        active_workspace: { id: identity.workspaceId, role: 'owner' },
        csrf_token: 'synthetic',
      });
    }

    if (
      url.includes('/categories') &&
      (options.method === 'GET' || !options.method)
    ) {
      const u = new URL(url, 'http://localhost');
      const dir = u.searchParams.get('direction') || 'expense';
      const items = state.categories.filter((c) => c.direction === dir);
      return ok({ items, next_cursor: null });
    }

    if (url.includes('/categories') && options.method === 'POST') {
      const body = JSON.parse(options.body);
      const newCat = {
        id: uuid(999),
        direction: body.direction,
        name: body.name,
        is_active: true,
        version: 1,
      };
      state.categories.push(newCat);
      return ok(newCat, 201);
    }

    if (url.includes('/categories/') && options.method === 'PATCH') {
      const id = url.split('/categories/')[1].split('?')[0];
      const body = JSON.parse(options.body);
      const target = state.categories.find((c) => c.id === id);
      if (target) {
        if (body.name !== undefined) target.name = body.name;
        if (body.is_active !== undefined) target.is_active = body.is_active;
        target.version += 1;
      }
      return ok(target);
    }

    return ok({});
  };

  return { requests, state };
}

test('FinanceCategoriesScreen: renders compact category list with prominent names and status badges', async () => {
  setupMockServer();
  const container = dom.container();
  const root = createRoot(container);

  await act(async () =>
    root.render(h(FinanceCategoriesScreen, { identity, onNavigate: () => {} })),
  );
  await flush();

  // Check header & screen title
  const h1 = dom.find(container, (n) => n.nodeName === 'H1')[0];
  assert.ok(h1);
  assert.match(h1.textContent, /Danh mục thu chi/);

  // Check category rows exist
  const textContent = container.textContent;
  assert.match(textContent, /Ăn uống/);
  assert.match(textContent, /Đang dùng/);
  assert.match(textContent, /Đi lại/);
  assert.match(textContent, /Ngừng dùng/);

  // Check action buttons
  const renameBtns = dom.find(
    container,
    (n) => n.nodeName === 'BUTTON' && dom.props(n)['data-action'] === 'edit',
  );
  assert.equal(renameBtns.length, 2, 'Must have 2 Đổi tên buttons');

  const deactivateBtn = dom.find(
    container,
    (n) =>
      n.nodeName === 'BUTTON' && dom.props(n)['data-action'] === 'deactivate',
  );
  assert.equal(
    deactivateBtn.length,
    1,
    'Active category has Ngừng dùng button',
  );

  const reactivateBtn = dom.find(
    container,
    (n) =>
      n.nodeName === 'BUTTON' && dom.props(n)['data-action'] === 'reactivate',
  );
  assert.equal(
    reactivateBtn.length,
    1,
    'Inactive category has Kích hoạt lại button',
  );

  await act(async () => root.unmount());
});

test('FinanceCategoriesScreen: Ngừng dùng requires confirmation before executing', async () => {
  const { requests } = setupMockServer();
  const container = dom.container();
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        h(FinanceCategoriesScreen, { identity, onNavigate: () => {} }),
      ),
    );
    await flush();

    const deactivateBtn = dom.find(
      container,
      (n) =>
        n.nodeName === 'BUTTON' && dom.props(n)['data-action'] === 'deactivate',
    )[0];
    assert.ok(deactivateBtn);

    // Click "Ngừng dùng" -> dialog opens, NO PATCH sent yet
    await act(async () => dom.props(deactivateBtn).onClick());
    await flush();

    const patchRequestsBefore = requests.filter((r) => r.method === 'PATCH');
    assert.equal(
      patchRequestsBefore.length,
      0,
      'Must NOT send PATCH before confirmation',
    );

    // Verify dialog is open
    const dialog = dom.find(
      container,
      (n) => n.getAttribute('role') === 'dialog',
    )[0];
    assert.ok(dialog, 'Confirmation dialog must be visible');
    assert.match(dialog.textContent, /Xác nhận ngừng dùng/);
    assert.match(dialog.textContent, /Ăn uống/);

    // Find confirm button in dialog
    const confirmBtn = dom.find(
      dialog,
      (n) => n.nodeName === 'BUTTON' && n.textContent.includes('Ngừng dùng'),
    )[0];
    assert.ok(confirmBtn);

    // Click confirm in dialog
    await act(async () => dom.props(confirmBtn).onClick());
    await flush();

    const patchRequestsAfter = requests.filter((r) => r.method === 'PATCH');
    assert.equal(
      patchRequestsAfter.length,
      1,
      'Must send PATCH after confirmation',
    );
    const patchPayload = JSON.parse(patchRequestsAfter[0].body);
    assert.equal(patchPayload.is_active, false);
  } finally {
    await act(async () => root.unmount());
  }
});

test('FinanceCategoriesScreen: tab switch toggles between Khoản chi and Nguồn thu', async () => {
  setupMockServer();
  const container = dom.container();
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        h(FinanceCategoriesScreen, { identity, onNavigate: () => {} }),
      ),
    );
    await flush();

    // Initially on expense: shows Ăn uống, not Lương
    assert.match(container.textContent, /Ăn uống/);
    assert.doesNotMatch(container.textContent, /Lương/);

    // Switch to Nguồn thu
    const incomeTab = dom.find(
      container,
      (n) => n.nodeName === 'BUTTON' && n.textContent.includes('Nguồn thu'),
    )[0];
    assert.ok(incomeTab);

    await act(async () => dom.props(incomeTab).onClick());
    await flush();

    // Now shows Lương, not Ăn uống
    assert.match(container.textContent, /Lương/);
    assert.doesNotMatch(container.textContent, /Ăn uống/);
  } finally {
    await act(async () => root.unmount());
  }
});

test('FinanceCategoriesScreen: Đổi tên opens dialog and sends PATCH with updated name on confirm', async () => {
  const { requests } = setupMockServer();
  const container = dom.container();
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        h(FinanceCategoriesScreen, { identity, onNavigate: () => {} }),
      ),
    );
    await flush();

    const renameBtn = dom.find(
      container,
      (n) => n.nodeName === 'BUTTON' && dom.props(n)['data-action'] === 'edit',
    )[0];
    assert.ok(renameBtn);

    // Click Đổi tên
    await act(async () => dom.props(renameBtn).onClick());
    await flush();

    // Verify dialog is open
    const dialog = dom.find(
      container,
      (n) => n.getAttribute('role') === 'dialog',
    )[0];
    assert.ok(dialog, 'Rename dialog must be visible');
    assert.match(dialog.textContent, /Đổi tên danh mục/);

    // Find input and confirm button
    const input = dom.find(dialog, (n) => n.nodeName === 'INPUT')[0];
    assert.ok(input);
    await act(async () =>
      dom.props(input).onChange({ target: { value: 'Ăn uống gia đình' } }),
    );

    const saveBtn = dom.find(
      dialog,
      (n) => n.nodeName === 'BUTTON' && n.textContent.includes('Lưu'),
    )[0];
    assert.ok(saveBtn);

    // Confirm rename
    await act(async () => dom.props(saveBtn).onClick());
    await flush();

    const patchReqs = requests.filter((r) => r.method === 'PATCH');
    assert.equal(patchReqs.length, 1);
    const payload = JSON.parse(patchReqs[0].body);
    assert.equal(payload.name, 'Ăn uống gia đình');
  } finally {
    await act(async () => root.unmount());
  }
});

test('FinanceCategoriesScreen: slow flush / 30ms AppDialog focus timeout executes cleanly without querySelectorAll TypeError', async () => {
  setupMockServer();
  const container = dom.container();
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        h(FinanceCategoriesScreen, { identity, onNavigate: () => {} }),
      ),
    );
    await flush();

    const deactivateBtn = dom.find(
      container,
      (n) =>
        n.nodeName === 'BUTTON' && dom.props(n)['data-action'] === 'deactivate',
    )[0];
    assert.ok(deactivateBtn);

    // Open confirmation dialog (which arms 30ms focus timer in AppDialog)
    await act(async () => dom.props(deactivateBtn).onClick());

    // Explicitly wait 50ms so AppDialog focus timeout fires while dialog is mounted
    await act(async () => new Promise((r) => setTimeout(r, 50)));

    const dialog = dom.find(
      container,
      (n) => n.getAttribute('role') === 'dialog',
    )[0];
    assert.ok(
      dialog,
      'Dialog must remain mounted and valid after focus timeout',
    );
    assert.ok(
      typeof dialog.querySelectorAll === 'function',
      'Dialog must support querySelectorAll in FakeElement',
    );
  } finally {
    await act(async () => root.unmount());
  }
});

test('FinanceCategoriesScreen: category search and empty search state filter items accurately', async () => {
  setupMockServer();
  const container = dom.container();
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(
        h(FinanceCategoriesScreen, { identity, onNavigate: () => {} }),
      ),
    );
    await flush();

    const searchInput = dom.find(
      container,
      (n) => n.getAttribute('data-testid') === 'category-search-input',
    )[0];
    assert.ok(searchInput, 'Must render category-search-input');

    // 1. Initial list has both Ăn uống and Đi lại
    assert.match(container.textContent, /Ăn uống/);
    assert.match(container.textContent, /Đi lại/);

    // 2. Filter by "Ăn"
    await act(async () => {
      dom.props(searchInput).onChange({ target: { value: 'Ăn' } });
    });
    await flush();

    assert.match(container.textContent, /Ăn uống/);
    assert.doesNotMatch(container.textContent, /Đi lại/);

    // 3. Filter by non-existing term -> triggers category-empty-search
    await act(async () => {
      dom.props(searchInput).onChange({ target: { value: 'KhôngTồnTại' } });
    });
    await flush();

    const emptyState = dom.find(
      container,
      (n) => n.getAttribute('data-testid') === 'category-empty-search',
    )[0];
    assert.ok(emptyState, 'Must render category-empty-search on no match');
    assert.match(emptyState.textContent, /Không tìm thấy danh mục phù hợp/);

    // 4. Click clear search
    const resetBtn = dom.find(emptyState, (n) => n.nodeName === 'BUTTON')[0];
    assert.ok(resetBtn, 'Must render reset button in empty search state');
    await act(async () => dom.props(resetBtn).onClick());
    await flush();

    assert.match(container.textContent, /Ăn uống/);
    assert.match(container.textContent, /Đi lại/);
  } finally {
    await act(async () => root.unmount());
  }
});
