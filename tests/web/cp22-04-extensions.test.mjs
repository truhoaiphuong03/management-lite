import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

test('CP22-04 UI structure only; unavailable GPS/MFA/Admin must not imply runtime acceptance', () => {
  const auditScreen = fs.readFileSync(
    path.join(ROOT, 'apps/web/src/screens/AuditScreen.tsx'),
    'utf8',
  );
  assert.match(auditScreen, /data-testid="btn-export-audit-csv"/);
  assert.match(auditScreen, /audit-export-/);

  const clockScreen = fs.readFileSync(
    path.join(ROOT, 'apps/web/src/screens/ClockScreen.tsx'),
    'utf8',
  );
  assert.match(clockScreen, /data-testid="gps-geofence-panel"/);
  assert.match(clockScreen, /data-testid="btn-verify-gps"/);
  assert.match(clockScreen, /data-testid="btn-export-attendance-csv"/);

  const settingsScreen = fs.readFileSync(
    path.join(ROOT, 'apps/web/src/screens/SettingsScreen.tsx'),
    'utf8',
  );
  assert.match(settingsScreen, /data-testid="rbac-and-mfa-section"/);
  assert.match(settingsScreen, /data-testid="mfa-totp-panel"/);
  assert.match(settingsScreen, /OWNER \(Chủ sở hữu\)/);
  assert.match(settingsScreen, /ADMIN \(Quản lý vận hành\)/);
  assert.match(settingsScreen, /STAFF \(Nhân viên\)/);
});

test('Unavailable security features must not advertise successful verification', async (t) => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { SettingsScreen } =
    await import('../../dist/apps/web/src/screens/SettingsScreen.js');
  const { ClockScreen } =
    await import('../../dist/apps/web/src/screens/ClockScreen.js');
  const settings = renderToStaticMarkup(
    React.createElement(SettingsScreen, {
      role: 'owner',
      onChangeRole() {},
      onLogout() {},
    }),
  );
  assert.match(settings, /MFA chưa triển khai/);
  assert.doesNotMatch(settings, /MFA Sẵn sàng/);
  assert.match(settings, /Đề xuất chưa bật/);
  const { installFakeDom } = await import('./helpers/fake-dom.mjs');
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const globals = [
    'window',
    'document',
    'localStorage',
    'sessionStorage',
    'IS_REACT_ACT_ENVIRONMENT',
  ];
  const previous = new Map(
    globals.map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const dom = installFakeDom();
  t.mock.method(globalThis, 'fetch', async (url) =>
    Response.json({
      success: true,
      data: url.endsWith('/auth/me')
        ? { csrf_token: 'isolated' }
        : { current_shift: null, recent_shifts: [] },
    }),
  );
  const container = dom.container();
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(React.createElement(ClockScreen, { role: 'staff' })),
    );
    for (let i = 0; i < 4; i++)
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    assert.match(container.textContent, /GPS: Chưa triển khai/);
    assert.doesNotMatch(container.textContent, /Hợp lệ trong bán kính/);
    const button = dom.find(
      container,
      (node) => dom.props(node)['data-testid'] === 'btn-verify-gps',
    )[0];
    assert.ok(button);
    assert.equal(dom.props(button).disabled, true);
    assert.equal(dom.props(button).onClick, undefined);
  } finally {
    await act(async () => root.unmount());
    for (const key of globals) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
