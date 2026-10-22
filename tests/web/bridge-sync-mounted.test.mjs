import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installFakeDom } from './helpers/fake-dom.mjs';
import { DashboardScreen } from '../../dist/apps/web/src/screens/DashboardScreen.js';
const dom = installFakeDom();
test('dashboard sync obtains CSRF from real /auth/me endpoint and refuses an absent token', async (t) => {
  let csrf = 'valid-csrf';
  const posts = [];
  const urls = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    urls.push(url);
    if (url === '/api/v1/auth/me')
      return Response.json({ success: true, data: { csrf_token: csrf } });
    if (options.method === 'POST') {
      posts.push(options);
      assert.equal(options.headers['x-csrf-token'], 'valid-csrf');
      return Response.json({
        success: true,
        data: {
          employees_synced: 0,
          reports_synced: 0,
          work_items_synced: 0,
          warnings: [],
        },
      });
    }
    return Response.json({ success: true, data: {} });
  });
  const container = dom.container(),
    root = createRoot(container);
  const tick = async () => {
    for (let i = 0; i < 5; i++)
      await act(async () => new Promise((r) => setTimeout(r, 0)));
  };
  try {
    await act(async () =>
      root.render(
        React.createElement(DashboardScreen, {
          role: 'owner',
          onNavigate() {},
        }),
      ),
    );
    await tick();
    const button = () =>
      dom.find(
        container,
        (node) =>
          node.nodeName === 'BUTTON' &&
          node.textContent === 'Đồng bộ nhân sự & công việc',
      )[0];
    assert.ok(button());
    await act(async () => dom.props(button()).onClick());
    await tick();
    assert.equal(posts.length, 1);
    assert.ok(!urls.includes('/api/v1/auth/session'));
    csrf = '';
    await act(async () => dom.props(button()).onClick());
    await tick();
    assert.equal(posts.length, 1);
    assert.match(container.textContent, /Không lấy được mã xác thực phiên/);
  } finally {
    await act(async () => root.unmount());
  }
});
