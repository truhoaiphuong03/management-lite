import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installFakeDom } from './helpers/fake-dom.mjs';

const dom = installFakeDom();
const ui = await import('../../dist/packages/ui/src/index.js');
const {
  Pagination,
  ActionIconButton,
  ACTION_ICON_LABELS,
  PAGINATION_PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  pageCount,
  clampPage,
  pageRange,
} = ui;
const h = React.createElement;
const tick = () => new Promise((r) => setTimeout(r, 0));

test('standard: default 20/page and choices 10/20/50/100', () => {
  assert.equal(DEFAULT_PAGE_SIZE, 20);
  assert.deepEqual([...PAGINATION_PAGE_SIZES], [10, 20, 50, 100]);
});

test('pageCount / clampPage / pageRange are exact and safe on empty and shrinking lists', () => {
  assert.equal(pageCount(0, 20), 1);
  assert.equal(pageCount(20, 20), 1);
  assert.equal(pageCount(21, 20), 2);
  assert.equal(pageCount(55, 10), 6);
  // current page vanished after delete/deactivate -> pulled back to last valid page
  assert.equal(clampPage(5, 41, 20), 2);
  assert.equal(clampPage(2, 40, 20), 1);
  assert.equal(clampPage(3, 0, 20), 0);
  assert.equal(clampPage(-2, 10, 20), 0);
  assert.deepEqual(pageRange(0, 0, 20), { from: 0, to: 0 });
  assert.deepEqual(pageRange(0, 55, 20), { from: 1, to: 20 });
  assert.deepEqual(pageRange(2, 55, 20), { from: 41, to: 55 });
});

async function mountPager(props) {
  const container = dom.container();
  const root = createRoot(container);
  await act(async () => root.render(h(Pagination, props)));
  await act(async () => tick());
  return { container, root };
}
const byTid = (c, id) =>
  dom.find(c, (n) => n.getAttribute?.('data-testid') === id)[0];

test('Pagination: range + total shown, Trước disabled on first page, size options 10/20/50/100', async () => {
  const { container, root } = await mountPager({
    total: 55,
    page: 0,
    pageSize: 20,
    onPage: () => {},
    onPageSize: () => {},
    testId: 'p',
  });
  assert.match(
    byTid(container, 'p-summary').textContent,
    /Hiển thị 1–20 \/ 55 mục/,
  );
  assert.match(byTid(container, 'p-page').textContent, /Trang 1 \/ 3/);
  assert.equal(dom.props(byTid(container, 'p-prev')).disabled, true);
  assert.equal(dom.props(byTid(container, 'p-next')).disabled, false);
  const opts = dom
    .find(container, (n) => n.nodeName === 'OPTION')
    .map((o) => o.textContent);
  assert.deepEqual(opts, ['10', '20', '50', '100']);
  await act(async () => root.unmount());
});

test('Pagination: Sau disabled on last page; click Trước/Sau emits page index', async () => {
  const seen = [];
  const { container, root } = await mountPager({
    total: 55,
    page: 2,
    pageSize: 20,
    onPage: (n) => seen.push(n),
    testId: 'p',
  });
  assert.match(byTid(container, 'p-summary').textContent, /41–55 \/ 55/);
  assert.equal(dom.props(byTid(container, 'p-next')).disabled, true);
  await act(async () => dom.props(byTid(container, 'p-prev')).onClick());
  assert.deepEqual(seen, [1]);
  await act(async () => root.unmount());
});

test('Pagination: empty list says "Không có mục nào" with both buttons disabled', async () => {
  const { container, root } = await mountPager({
    total: 0,
    page: 0,
    pageSize: 20,
    onPage: () => {},
    testId: 'p',
  });
  assert.match(byTid(container, 'p-summary').textContent, /Không có mục nào/);
  assert.equal(dom.props(byTid(container, 'p-prev')).disabled, true);
  assert.equal(dom.props(byTid(container, 'p-next')).disabled, true);
  await act(async () => root.unmount());
});

test('Pagination: loading disables navigation', async () => {
  const { container, root } = await mountPager({
    total: 55,
    page: 1,
    pageSize: 20,
    loading: true,
    onPage: () => {},
    testId: 'p',
  });
  assert.equal(dom.props(byTid(container, 'p-prev')).disabled, true);
  assert.equal(dom.props(byTid(container, 'p-next')).disabled, true);
  await act(async () => root.unmount());
});

test('Pagination: cursor mode (no total) displays range and disables Sau when hasNext is false', async () => {
  const { container, root } = await mountPager({
    page: 1,
    pageSize: 20,
    itemCount: 15,
    hasNext: false,
    onPage: () => {},
    testId: 'p',
  });
  assert.match(byTid(container, 'p-summary').textContent, /Hiển thị 21–35 mục/);
  assert.match(byTid(container, 'p-page').textContent, /Trang 2/);
  assert.equal(dom.props(byTid(container, 'p-prev')).disabled, false);
  assert.equal(dom.props(byTid(container, 'p-next')).disabled, true);
  await act(async () => root.unmount());
});

test('Pagination: cursor mode (no total) enables Sau when hasNext is true', async () => {
  const { container, root } = await mountPager({
    page: 0,
    pageSize: 20,
    itemCount: 20,
    hasNext: true,
    onPage: () => {},
    testId: 'p',
  });
  assert.match(byTid(container, 'p-summary').textContent, /Hiển thị 1–20 mục/);
  assert.match(byTid(container, 'p-page').textContent, /Trang 1/);
  assert.equal(dom.props(byTid(container, 'p-prev')).disabled, true);
  assert.equal(dom.props(byTid(container, 'p-next')).disabled, false);
  await act(async () => root.unmount());
});

test('ActionIconButton: standard labels for all 7 actions (Vietnamese)', () => {
  assert.deepEqual(ACTION_ICON_LABELS, {
    view: 'Xem chi tiết',
    edit: 'Sửa',
    deactivate: 'Ngừng dùng',
    reactivate: 'Kích hoạt lại',
    delete: 'Xóa',
    download: 'Tải xuống',
    copy: 'Sao chép',
  });
});

test('ActionIconButton: icon-only, tooltip + aria-label with target, 40px, click works, disabled respected', async () => {
  for (const action of Object.keys(ACTION_ICON_LABELS)) {
    const container = dom.container();
    const root = createRoot(container);
    let clicks = 0;
    await act(async () =>
      root.render(
        h(ActionIconButton, {
          action,
          target: 'Tiền nhà',
          onClick: () => clicks++,
        }),
      ),
    );
    const btn = dom.find(container, (n) => n.nodeName === 'BUTTON')[0];
    const p = dom.props(btn);
    assert.equal(p.title, ACTION_ICON_LABELS[action]);
    assert.equal(p['aria-label'], `${ACTION_ICON_LABELS[action]}: Tiền nhà`);
    assert.equal(p['data-action'], action);
    assert.equal(btn.textContent.trim(), '', 'no visible text');
    assert.ok(
      dom.find(btn, (n) => String(n.nodeName).toLowerCase() === 'svg').length >=
        1,
      'has svg icon',
    );
    assert.equal(p.style.width, 40);
    assert.equal(p.style.height, 40);
    await act(async () => p.onClick());
    assert.equal(clicks, 1);
    await act(async () => root.unmount());
  }
  const container = dom.container();
  const root = createRoot(container);
  await act(async () =>
    root.render(
      h(ActionIconButton, { action: 'delete', disabled: true, onClick() {} }),
    ),
  );
  const btn = dom.find(container, (n) => n.nodeName === 'BUTTON')[0];
  assert.equal(dom.props(btn).disabled, true);
  assert.equal(dom.props(btn)['aria-label'], 'Xóa');
  await act(async () => root.unmount());
});
