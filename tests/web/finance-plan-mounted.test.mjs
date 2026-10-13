import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installFakeDom } from './helpers/fake-dom.mjs';

const dom = installFakeDom();
globalThis.window.addEventListener = () => {};
globalThis.window.removeEventListener = () => {};
const { FinancePlanScreen } =
  await import('../../dist/apps/web/src/screens/FinancePlanScreen.js');
const h = React.createElement;
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const identity = { userId: uuid(1), workspaceId: uuid(2) };

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
    plan: {
      items: [
        {
          id: uuid(101),
          direction: 'expense',
          category_id: uuid(501),
          category_name: 'Tiền thuê nhà',
          category_is_active: true,
          amount_vnd: '15000000',
          is_active: true,
          version: 1,
          created_at: '2026-10-01T00:00:00Z',
          updated_at: '2026-10-01T00:00:00Z',
        },
        {
          id: uuid(102),
          direction: 'expense',
          category_id: uuid(502),
          category_name: 'Điện nước internet',
          category_is_active: true,
          amount_vnd: '3000000',
          is_active: true,
          version: 1,
          created_at: '2026-10-01T00:00:00Z',
          updated_at: '2026-10-01T00:00:00Z',
        },
        {
          id: uuid(103),
          direction: 'income',
          category_id: uuid(503),
          category_name: 'Doanh thu dịch vụ',
          category_is_active: true,
          amount_vnd: '50000000',
          is_active: true,
          version: 1,
          created_at: '2026-10-01T00:00:00Z',
          updated_at: '2026-10-01T00:00:00Z',
        },
      ],
      summary: {
        month: '2026-10',
        days_in_month: 31,
        total_income_vnd: '50000000',
        total_expense_vnd: '18000000',
        net_vnd: '32000000',
        status: 'surplus',
        shortfall_vnd: '0',
        need_per_month_vnd: '0',
        need_per_week_vnd: '0',
        need_per_day_vnd: '0',
      },
    },
    categories: [
      {
        id: uuid(501),
        direction: 'expense',
        name: 'Tiền thuê nhà',
        is_active: true,
        version: 1,
      },
      {
        id: uuid(502),
        direction: 'expense',
        name: 'Điện nước internet',
        is_active: true,
        version: 1,
      },
      {
        id: uuid(503),
        direction: 'income',
        name: 'Doanh thu dịch vụ',
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

    if (url.includes('/auth/me')) {
      return ok({
        user: { id: identity.userId },
        active_workspace: { id: identity.workspaceId, role: 'owner' },
        csrf_token: 'synthetic-csrf',
      });
    }

    if (url.includes('/fin/plan') && (options.method === 'GET' || !options.method)) {
      return ok(state.plan);
    }

    if (url.includes('/categories') && (options.method === 'GET' || !options.method)) {
      const u = new URL(url, 'http://localhost');
      const dir = u.searchParams.get('direction') || 'expense';
      const items = state.categories.filter((c) => c.direction === dir);
      return ok({ items, next_cursor: null });
    }

    return ok({});
  };

  return { requests, state };
}

test('FinancePlanScreen: renders header, plan metrics, items and category search', async () => {
  setupMockServer();
  const container = dom.container();
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(h(FinancePlanScreen, { identity, onNavigate: () => {} })),
    );
    await flush();

    // Check header
    const h1 = dom.find(container, (n) => n.nodeName === 'H1')[0];
    assert.ok(h1);
    assert.match(h1.textContent, /Kế hoạch thu chi cố định/);

    // Check metrics card
    const metrics = dom.find(
      container,
      (n) => n.getAttribute('data-testid') === 'plan-metrics',
    )[0];
    assert.ok(metrics, 'Must render plan-metrics card');

    // Check items rendered
    assert.match(container.textContent, /Tiền thuê nhà/);
    assert.match(container.textContent, /Điện nước internet/);
    assert.match(container.textContent, /Doanh thu dịch vụ/);

    // Check search input
    const searchInput = dom.find(
      container,
      (n) => n.getAttribute('data-testid') === 'plan-search-input',
    )[0];
    assert.ok(searchInput, 'Must render plan-search-input');
  } finally {
    await act(async () => root.unmount());
  }
});

test('FinancePlanScreen: search filtering by category name and empty search state', async () => {
  setupMockServer();
  const container = dom.container();
  const root = createRoot(container);

  try {
    await act(async () =>
      root.render(h(FinancePlanScreen, { identity, onNavigate: () => {} })),
    );
    await flush();

    const searchInput = dom.find(
      container,
      (n) => n.getAttribute('data-testid') === 'plan-search-input',
    )[0];
    assert.ok(searchInput);

    // 1. Search for "thuê" -> shows "Tiền thuê nhà", filters out "Điện nước" in expense list
    await act(async () => {
      dom.props(searchInput).onChange({ target: { value: 'thuê' } });
    });
    await flush();

    const expenseList = dom.find(
      container,
      (n) => n.getAttribute('data-testid') === 'plan-list-expense',
    )[0];
    assert.ok(expenseList);
    assert.match(expenseList.textContent, /Tiền thuê nhà/);
    assert.doesNotMatch(expenseList.textContent, /Điện nước internet/);

    // 2. Search for non-matching term -> triggers plan-empty-search
    await act(async () => {
      dom.props(searchInput).onChange({ target: { value: 'KhôngHềTồnTại' } });
    });
    await flush();

    const emptyStates = dom.find(
      container,
      (n) => n.getAttribute('data-testid') === 'plan-empty-search',
    );
    assert.ok(emptyStates.length > 0, 'Must render plan-empty-search on no match');
    assert.match(emptyStates[0].textContent, /Không tìm thấy khoản/);

    // 3. Reset search via clear button
    const resetBtn = dom.find(
      emptyStates[0],
      (n) => n.nodeName === 'BUTTON',
    )[0];
    assert.ok(resetBtn, 'Must render reset button in empty search state');
    await act(async () => dom.props(resetBtn).onClick());
    await flush();

    assert.match(container.textContent, /Tiền thuê nhà/);
    assert.match(container.textContent, /Điện nước internet/);
  } finally {
    await act(async () => root.unmount());
  }
});
