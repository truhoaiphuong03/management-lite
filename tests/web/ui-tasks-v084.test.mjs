import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  applyTheme,
  getStoredTheme,
  normalizeThemePreference,
  removeThemeListener,
  resolveEffectiveTheme,
  setThemePreference,
} from '../../dist/apps/web/src/theme.js';
import { AppShell } from '../../dist/apps/web/src/AppShell.js';

test('TASK 1: Header theme toggle renders in AppShell with accessible label and state attributes', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      AppShell,
      {
        currentPath: '/',
        onNavigate: () => {},
        role: 'owner',
        isOwnerVerified: true,
        onLogout: () => {},
      },
      React.createElement('div', null, 'Body'),
    ),
  );

  assert.ok(
    html.includes('data-testid="header-btn-theme-toggle"'),
    'AppShell header must render header-btn-theme-toggle',
  );
  assert.ok(
    html.includes('aria-label="Chuyển sang giao diện sáng"'),
    'Default dark theme must expose accessible label to switch to light theme',
  );
  // Ensure order: theme toggle is placed right before settings button in header actions
  const themeIdx = html.indexOf('data-testid="header-btn-theme-toggle"');
  const settingsIdx = html.indexOf('data-testid="header-btn-settings"');
  assert.ok(
    themeIdx > 0 && settingsIdx > themeIdx,
    'Theme toggle button must appear immediately before Settings button in header cluster',
  );
});

test('TASK 1: Theme helpers handle dark/light/system resolution, persistence, and live sync event', () => {
  const origDoc = globalThis.document;
  const origWin = globalThis.window;
  const origStorage = globalThis.localStorage;

  try {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };

    const attrs = new Map();
    let metaContent = '#0B1220';
    globalThis.document = {
      documentElement: {
        style: {},
        setAttribute: (k, v) => attrs.set(k, v),
        getAttribute: (k) => attrs.get(k) ?? null,
      },
      body: { style: {} },
      querySelector: (sel) =>
        sel === 'meta[name="theme-color"]'
          ? { setAttribute: (_k, v) => (metaContent = v) }
          : null,
    };

    let osPrefersDark = false;
    let mediaChangeCb = null;
    const dispatchedEvents = [];
    globalThis.window = {
      matchMedia: () => ({
        get matches() {
          return osPrefersDark;
        },
        addEventListener: (_ev, cb) => {
          mediaChangeCb = cb;
        },
        removeEventListener: () => {
          mediaChangeCb = null;
        },
      }),
      dispatchEvent: (ev) => {
        dispatchedEvents.push(ev);
        return true;
      },
    };

    assert.equal(normalizeThemePreference(null), 'dark');
    assert.equal(getStoredTheme(), 'dark');

    // 1. Switch to light
    setThemePreference('light');
    assert.equal(getStoredTheme(), 'light');
    assert.equal(attrs.get('data-theme'), 'light');
    assert.equal(resolveEffectiveTheme(), 'light');
    assert.equal(metaContent, '#F8FAFC');
    assert.equal(dispatchedEvents.at(-1)?.detail?.theme, 'light');
    assert.equal(dispatchedEvents.at(-1)?.detail?.effectiveTheme, 'light');

    // 2. Switch to system while OS is light -> effectiveTheme = 'light'
    setThemePreference('system');
    assert.equal(getStoredTheme(), 'system');
    assert.equal(resolveEffectiveTheme(), 'light');
    assert.equal(dispatchedEvents.at(-1)?.detail?.theme, 'system');
    assert.equal(dispatchedEvents.at(-1)?.detail?.effectiveTheme, 'light');

    // 3. OS flips to dark while in 'system' mode -> dynamic update + sync event
    osPrefersDark = true;
    assert.ok(typeof mediaChangeCb === 'function');
    mediaChangeCb({ matches: true });
    assert.equal(resolveEffectiveTheme(), 'dark');
    assert.equal(metaContent, '#0B1220');
    assert.equal(dispatchedEvents.at(-1)?.detail?.effectiveTheme, 'dark');

    // 4. Quick toggle from effective dark -> explicit 'light'
    setThemePreference('light');
    assert.equal(getStoredTheme(), 'light');
    assert.equal(mediaChangeCb, null, 'System media listener cleaned up');
    applyTheme('dark');
    removeThemeListener();
  } finally {
    globalThis.document = origDoc;
    globalThis.window = origWin;
    globalThis.localStorage = origStorage;
  }
});

test('TASK 2: DesktopSidebar defaults to expanded, supports collapsed icon mode with accessible names, and persists state', async () => {
  const { DesktopSidebar } =
    await import('../../dist/packages/ui/src/components/Navigation.js');
  const { readStoredSidebarCollapsed } =
    await import('../../dist/apps/web/src/AppShell.js');

  // 1. Default expanded state for new users
  const expandedHtml = renderToStaticMarkup(
    React.createElement(DesktopSidebar, {
      currentPath: '/print-quotes',
      onNavigate: () => {},
      role: 'owner',
      isOwnerVerified: true,
    }),
  );
  assert.ok(
    expandedHtml.includes('data-collapsed="false"'),
    'Sidebar defaults to expanded (data-collapsed="false")',
  );
  assert.ok(
    expandedHtml.includes('width:224px'),
    'Expanded sidebar renders at 224px width',
  );
  assert.ok(
    expandedHtml.includes('aria-expanded="true"'),
    'Toggle button exposes aria-expanded="true" when expanded',
  );
  assert.ok(
    expandedHtml.includes('aria-label="Thu gọn menu bên trái"'),
    'Toggle button exposes accessible collapse label',
  );
  assert.ok(
    expandedHtml.includes('aria-current="page"'),
    'Active route button exposes aria-current="page"',
  );

  // 2. Collapsed state keeps every icon accessible via aria-label + sr-only text + tooltip
  const collapsedHtml = renderToStaticMarkup(
    React.createElement(DesktopSidebar, {
      currentPath: '/print-quotes',
      onNavigate: () => {},
      role: 'owner',
      isOwnerVerified: true,
      collapsed: true,
    }),
  );
  assert.ok(
    collapsedHtml.includes('data-collapsed="true"'),
    'Sidebar reflects collapsed state',
  );
  assert.ok(
    collapsedHtml.includes('width:64px'),
    'Collapsed sidebar shrinks to 64px icon rail',
  );
  assert.ok(
    collapsedHtml.includes('aria-expanded="false"'),
    'Toggle button exposes aria-expanded="false" when collapsed',
  );
  assert.ok(
    collapsedHtml.includes('aria-label="Mở rộng menu bên trái"'),
    'Toggle button exposes accessible expand label when collapsed',
  );
  for (const label of [
    'Tổng quan',
    'Công việc',
    'Chấm công',
    'Nhân sự',
    'Tài khoản',
    'Thu chi',
    'Báo giá in ấn',
    'Quản trị',
  ]) {
    assert.ok(
      collapsedHtml.includes(`aria-label="${label}"`),
      `Collapsed icon button retains aria-label="${label}"`,
    );
  }

  // 3. Storage helper defaults to false for new users and reads persisted '1'/'0'
  const origStorage = globalThis.localStorage;
  try {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    };
    assert.equal(
      readStoredSidebarCollapsed(),
      false,
      'New user defaults to expanded',
    );
    store.set('mglite_sidebar_collapsed', '1');
    assert.equal(readStoredSidebarCollapsed(), true);
    store.set('mglite_sidebar_collapsed', '0');
    assert.equal(readStoredSidebarCollapsed(), false);
  } finally {
    globalThis.localStorage = origStorage;
  }
});

test('TASK 3: Sidebar user identity resolves employee profile, missing-profile fallbacks, subRole, and collapsed accessibility', async () => {
  const { DesktopSidebar, resolveSidebarUserSummary } =
    await import('../../dist/packages/ui/src/components/Navigation.js');
  const { parseSessionPayload } =
    await import('../../dist/apps/web/src/session-manager.js');

  // 1. parseSessionPayload extracts username & subRole safely
  const parsed = parseSessionPayload({
    success: true,
    data: {
      user: {
        id: 'u-1',
        username: 'ql_phu',
        email: 'phu@hoaiphuong.click',
        email_verified: true,
      },
      active_workspace: {
        id: 'ws-1',
        name: 'Hoài Phương Media',
        role: 'staff',
        sub_role: 'admin',
      },
      csrf_token: 'csrf-123',
    },
  });
  assert.equal(parsed?.userUsername, 'ql_phu');
  assert.equal(parsed?.subRole, 'admin');
  assert.equal(parsed?.userEmail, 'phu@hoaiphuong.click');

  // 2. Full employee profile (Owner & Staff)
  const ownerSummary = resolveSidebarUserSummary({
    role: 'owner',
    userFullName: 'Trương Hoài Phương',
    userEmail: 'truhoaiphuong03@gmail.com',
    employeeCode: 'OWNER',
  });
  assert.equal(ownerSummary.displayName, 'Trương Hoài Phương');
  assert.equal(ownerSummary.roleLabel, 'Chủ sở hữu');
  assert.equal(ownerSummary.secondaryText, 'Chủ sở hữu');
  assert.equal(ownerSummary.initials, 'TP');
  assert.equal(ownerSummary.hasEmployeeProfile, true);

  const staffSummary = resolveSidebarUserSummary({
    role: 'staff',
    subRole: 'admin',
    userFullName: 'Nguyễn Văn An',
    employeeCode: 'NV001',
  });
  assert.equal(staffSummary.displayName, 'Nguyễn Văn An');
  assert.equal(staffSummary.roleLabel, 'Quản lý');
  assert.equal(staffSummary.secondaryText, 'Quản lý · NV001');
  assert.equal(staffSummary.initials, 'NA');

  // 3. Fallback chain when employee profile is missing (404)
  const usernameFallback = resolveSidebarUserSummary({
    role: 'staff',
    userUsername: 'media_editor',
    userEmail: 'editor@hoaiphuong.click',
  });
  assert.equal(usernameFallback.displayName, 'media_editor');
  assert.equal(usernameFallback.roleLabel, 'Nhân viên');
  assert.equal(usernameFallback.hasEmployeeProfile, false);

  const emailFallback = resolveSidebarUserSummary({
    role: 'owner',
    userEmail: 'truhoaiphuong03@gmail.com',
  });
  assert.equal(emailFallback.displayName, 'truhoaiphuong03');
  assert.equal(emailFallback.roleLabel, 'Chủ sở hữu');

  const bareFallback = resolveSidebarUserSummary({ role: 'staff' });
  assert.equal(bareFallback.displayName, 'Nhân viên');

  // 4. Expanded vs Collapsed footer rendering and navigation targets
  const navigatedPaths = [];
  const expandedHtml = renderToStaticMarkup(
    React.createElement(DesktopSidebar, {
      currentPath: '/',
      onNavigate: (p) => navigatedPaths.push(p),
      role: 'owner',
      isOwnerVerified: true,
      userFullName: 'Hoài Phương',
      employeeCode: 'OWNER',
    }),
  );
  assert.ok(expandedHtml.includes('data-testid="sidebar-user-footer"'));
  assert.ok(expandedHtml.includes('data-testid="sidebar-user-profile-btn"'));
  assert.ok(expandedHtml.includes('data-testid="sidebar-user-edit-profile"'));
  assert.ok(
    expandedHtml.includes('data-testid="sidebar-user-change-password"'),
  );
  assert.ok(expandedHtml.includes('Hoài Phương'));
  assert.ok(expandedHtml.includes('Chủ sở hữu'));

  const collapsedHtml = renderToStaticMarkup(
    React.createElement(DesktopSidebar, {
      currentPath: '/',
      onNavigate: () => {},
      role: 'owner',
      isOwnerVerified: true,
      collapsed: true,
      userFullName: 'Hoài Phương',
      employeeCode: 'OWNER',
    }),
  );
  assert.ok(
    collapsedHtml.includes(
      'aria-label="Hoài Phương Chủ sở hữu — Hồ sơ cá nhân &amp; Đổi mật khẩu"',
    ),
    'Collapsed sidebar user button exposes full accessible identity & action label',
  );
  assert.equal(
    collapsedHtml.includes('data-testid="sidebar-user-edit-profile"'),
    false,
    'Collapsed sidebar hides expanded secondary text buttons to fit 64px rail',
  );
});

test('TASK 3: PrintQuote dirty draft guard intercepts navigation to /settings#profile and /settings#password', async () => {
  const {
    clearPrintQuoteRamDraft,
    confirmLeavePrintQuoteIfNeeded,
    isInternalPrintQuotePath,
    isPrintQuoteDraftDirty,
    registerPrintQuoteLeaveInterceptor,
    setPrintQuoteRamDraft,
  } = await import('../../dist/apps/web/src/printquote-draft-bridge.js');

  let leavePromptCount = 0;
  setPrintQuoteRamDraft(
    {
      editorPath: '/print-quotes/new',
      isDirty: true,
      customerName: 'Khách hàng thử nghiệm',
      lines: [],
      updatedAt: Date.now(),
    },
    { userId: 'u-owner', workspaceId: 'ws-1', role: 'owner' },
  );
  registerPrintQuoteLeaveInterceptor(() => {
    leavePromptCount += 1;
  });

  try {
    for (const rawTarget of ['/settings#profile', '/settings#password']) {
      const cleanPath = rawTarget.split(/[?#]/, 1)[0] || '/';
      assert.equal(isInternalPrintQuotePath(cleanPath), false);
      assert.equal(isPrintQuoteDraftDirty(), true);
      const intercepted = confirmLeavePrintQuoteIfNeeded(() => {});
      assert.equal(
        intercepted,
        true,
        `Dirty PrintQuote draft must block immediate navigation to ${rawTarget}`,
      );
    }
    assert.equal(
      leavePromptCount,
      2,
      'Both personal-settings links trigger leave-draft confirmation dialog',
    );
  } finally {
    registerPrintQuoteLeaveInterceptor(null);
    clearPrintQuoteRamDraft();
  }
});

test('E2E Browser (Playwright): Tasks 1-3 desktop/mobile, light/dark, keyboard, persistence, live rename, and dirty-draft guard + Task 4 font check', async () => {
  const http = await import('node:http');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { chromium } = await import('playwright-core');

  const distRoot = path.resolve('apps/web/dist');
  const mimeByExt = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
  };

  const server = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0] || '/';
    const safeRel =
      urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const candidate = path.resolve(distRoot, safeRel);
    if (
      candidate.startsWith(distRoot) &&
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isFile()
    ) {
      const ext = path.extname(candidate).toLowerCase();
      res.writeHead(200, {
        'Content-Type': mimeByExt[ext] || 'application/octet-stream',
      });
      res.end(fs.readFileSync(candidate));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(distRoot, 'index.html')));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      colorScheme: 'dark',
    });

    let currentFullName = 'Hoài Phương';
    let simulateMissingEmployee = false;

    await context.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      const p = u.pathname;

      if (p === '/api/v1/auth/me') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              user: {
                id: 'u-owner-1',
                username: 'owner_hp',
                email: 'truhoaiphuong03@gmail.com',
                email_verified: true,
              },
              active_workspace: {
                id: 'ws-hp-1',
                name: 'Hoài Phương Media',
                role: 'owner',
              },
              csrf_token: 'csrf-e2e-token',
            },
          }),
        });
      }
      if (p === '/api/v1/employees/me') {
        if (simulateMissingEmployee) {
          return route.fulfill({
            status: 404,
            contentType: 'application/json',
            body: JSON.stringify({
              success: false,
              error: { code: 'NOT_FOUND', message: 'Employee not found' },
            }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: 'emp-owner-1',
              employee_code: 'OWNER',
              full_name: currentFullName,
              phone: '0901234567',
              employment_status: 'active',
              user: {
                email: 'truhoaiphuong03@gmail.com',
                email_verified: true,
              },
            },
          }),
        });
      }
      if (p === '/api/v1/auth/profile' && req.method() === 'PATCH') {
        const body = JSON.parse(req.postData() || '{}');
        if (typeof body.full_name === 'string' && body.full_name.trim()) {
          currentFullName = body.full_name.trim();
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              full_name: currentFullName,
              phone: body.phone || '0901234567',
              email: 'truhoaiphuong03@gmail.com',
              email_verified: true,
              email_changed: false,
              message: 'Đã cập nhật thông tin cá nhân thành công.',
            },
          }),
        });
      }
      if (p === '/api/v1/employees' && req.method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              items: [
                {
                  id: 'emp-1',
                  employee_code: 'NV001',
                  full_name: 'Nguyễn Thị Hoài Phương',
                  phone: '0901234567',
                  job_title: 'Quản lý sản xuất',
                  bank_name: 'Vietcombank',
                  bank_account_number: '0071001234567',
                  employment_status: 'active',
                  role: 'owner',
                  permissions: [],
                },
              ],
              total: 1,
            },
          }),
        });
      }
      if (p.startsWith('/api/v1/print-quotes')) {
        const listField = p.endsWith('/vendors')
          ? { vendors: [] }
          : p.endsWith('/price-items')
            ? { price_items: [] }
            : p.endsWith('/customers')
              ? { customers: [] }
              : { quotes: [], next_cursor: null };
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: listField }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { items: [], entries: [], logs: [], issues: [], shifts: [] },
        }),
      });
    });

    const page = await context.newPage();
    await page.goto(`${baseUrl}/settings`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="header-btn-theme-toggle"]');
    await page.waitForSelector('#select-theme');

    // --- TASK 1: Header Light/Dark Toggle & Sync with Settings + OS System ---
    assert.equal(
      await page.getAttribute('html', 'data-theme'),
      'dark',
      'Initial theme defaults to dark',
    );
    assert.equal(await page.inputValue('#select-theme'), 'dark');

    // Toggle via keyboard (Focus + Enter) while /settings is open
    await page.focus('[data-testid="header-btn-theme-toggle"]');
    await page.keyboard.press('Enter');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
    assert.equal(
      await page.inputValue('#select-theme'),
      'light',
      'SettingsScreen #select-theme syncs immediately when header toggle is pressed',
    );
    assert.equal(
      await page.getAttribute(
        '[data-testid="header-btn-theme-toggle"]',
        'aria-label',
      ),
      'Chuyển sang giao diện tối',
    );

    // Reload preserves selection
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#select-theme');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
    assert.equal(await page.inputValue('#select-theme'), 'light');

    // System preference mode ('system') tracks OS media query & syncs header button
    await page.emulateMedia({ colorScheme: 'light' });
    await page.selectOption('#select-theme', 'system');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'system');
    assert.equal(
      await page.getAttribute(
        '[data-testid="header-btn-theme-toggle"]',
        'data-effective-theme',
      ),
      'light',
    );
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="header-btn-theme-toggle"]')
          ?.getAttribute('data-effective-theme') === 'dark',
    );
    // Quick toggle from system(dark) -> explicit 'light'
    await page.click('[data-testid="header-btn-theme-toggle"]');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'light');
    assert.equal(await page.inputValue('#select-theme'), 'light');

    // --- TASK 2: Collapsible DesktopSidebar ---
    const sidebar = page.locator('[data-testid="desktop-sidebar"]');
    assert.equal(
      await sidebar.getAttribute('data-collapsed'),
      'false',
      'New user sidebar starts expanded',
    );
    const mainWidthExpanded = await page.evaluate(
      () =>
        document.getElementById('main-content')?.getBoundingClientRect()
          .width || 0,
    );

    // Collapse via keyboard (Space)
    await page.focus('[data-testid="sidebar-collapse-toggle"]');
    await page.keyboard.press('Space');
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-testid="desktop-sidebar"]')
          ?.getAttribute('data-collapsed') === 'true',
    );
    await page.waitForTimeout(200); // allow 150ms width transition
    const sidebarBoxCollapsed = await sidebar.boundingBox();
    assert.equal(Math.round(sidebarBoxCollapsed?.width || 0), 64);

    const mainWidthCollapsed = await page.evaluate(
      () =>
        document.getElementById('main-content')?.getBoundingClientRect()
          .width || 0,
    );
    assert.ok(
      mainWidthCollapsed >= mainWidthExpanded,
      'Main content adapts smoothly without clipping when sidebar collapses',
    );

    // Navigate using collapsed icon button & verify persistence across reload
    await page.click('[data-testid="sidebar-nav-print-quotes"]');
    await page.waitForSelector('[data-testid="printquote-screen"]');
    assert.equal(new URL(page.url()).pathname, '/print-quotes');

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="desktop-sidebar"]');
    assert.equal(
      await sidebar.getAttribute('data-collapsed'),
      'true',
      'Collapsed state persists across page reload',
    );

    // Expand back
    await page.click('[data-testid="sidebar-collapse-toggle"]');
    assert.equal(await sidebar.getAttribute('data-collapsed'), 'false');

    // --- TASK 3: Sidebar User Info, Live Rename, Password Anchor & Dirty-Draft Guard ---
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="sidebar-user-display-name"]')
          ?.textContent === 'Hoài Phương',
    );
    assert.equal(
      await page.textContent('[data-testid="sidebar-user-role-label"]'),
      'Chủ sở hữu',
    );

    // Dirty PrintQuote draft guard when clicking sidebar personal actions
    await page.click('[data-testid="pq-new-quote-cta"]');
    await page.waitForSelector('[data-testid="pq-title-input"]');
    await page.fill(
      '[data-testid="pq-title-input"]',
      'Báo giá thử nghiệm chống mất nháp',
    );
    await page.click('[data-testid="sidebar-user-profile-btn"]');
    await page.waitForSelector('[data-testid="pq-leave-draft-dialog"]');
    await page.click('[data-testid="pq-leave-stay-btn"]');
    assert.equal(new URL(page.url()).pathname, '/print-quotes/new');
    assert.equal(
      await page.inputValue('[data-testid="pq-title-input"]'),
      'Báo giá thử nghiệm chống mất nháp',
      'Staying preserves unsaved PrintQuote draft intact',
    );

    // Confirm discard -> navigates to /settings#profile & focuses name input
    await page.click('[data-testid="sidebar-user-edit-profile"]');
    await page.waitForSelector('[data-testid="pq-leave-draft-dialog"]');
    await page.click('[data-testid="pq-leave-discard-btn"]');
    await page.waitForSelector('[data-testid="edit-profile-name"]');
    assert.equal(new URL(page.url()).pathname, '/settings');
    assert.equal(new URL(page.url()).hash, '#profile');

    // Rename user -> verify sidebar updates live without reload
    await page.fill('[data-testid="edit-profile-name"]', 'Trương Hoài Phương');
    await page.click('[data-testid="btn-save-profile"]');
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="sidebar-user-display-name"]')
          ?.textContent === 'Trương Hoài Phương',
    );

    // Password quick button focuses #currentPassword
    await page.click('[data-testid="sidebar-user-change-password"]');
    assert.equal(new URL(page.url()).hash, '#password');
    const activeId = await page.evaluate(
      () => document.activeElement?.id || '',
    );
    assert.equal(activeId, 'currentPassword');

    // Mobile 320px & 390px overflow + More drawer personal card check (Light & Dark)
    for (const vw of [320, 390]) {
      await page.setViewportSize({ width: vw, height: 780 });
      for (const th of ['light', 'dark']) {
        await page.evaluate((t) => {
          localStorage.setItem('mglite_theme', t);
          document.documentElement.setAttribute('data-theme', t);
        }, th);
        await page.waitForTimeout(50);
        const overflow = await page.evaluate(() => {
          const header = document.querySelector('.app-shell-header');
          const hRect = header?.getBoundingClientRect();
          return {
            docOverflow:
              document.documentElement.scrollWidth - window.innerWidth,
            headerRightOverflow: hRect ? hRect.right - window.innerWidth : 0,
            desktopSidebarHidden:
              window.getComputedStyle(
                document.querySelector('.desktop-sidebar-wrapper'),
              ).display === 'none',
          };
        });
        assert.ok(
          overflow.docOverflow <= 0,
          `No horizontal overflow at ${vw}px (${th}): got ${overflow.docOverflow}`,
        );
        assert.ok(
          overflow.headerRightOverflow <= 0.5,
          `Header stays within ${vw}px (${th})`,
        );
        assert.equal(
          overflow.desktopSidebarHidden,
          true,
          `Desktop sidebar hidden at ${vw}px mobile`,
        );
      }
    }

    // Missing employee profile fallback (404 on /api/v1/employees/me)
    simulateMissingEmployee = true;
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="sidebar-user-display-name"]')
          ?.textContent === 'owner_hp',
    );
    assert.equal(
      await page.textContent('[data-testid="sidebar-user-role-label"]'),
      'Chủ sở hữu',
    );

    // --- TASK 4 (Option 4A): Unified System Typography, Tabular Numerals & Monospace Exceptions ---
    // 1. Zero downloaded web fonts (0 KB font payload)
    const fontCount = await page.evaluate(() => document.fonts.size);
    assert.equal(
      fontCount,
      0,
      'Option 4A must use native OS system font stack with 0 downloaded web fonts',
    );

    // 2. Compare computed typography between /print-quotes (.pq-page-title) and /settings + /employees (.page-header-title)
    await page.goto(`${baseUrl}/print-quotes`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.pq-page-title');
    const pqHeading = await page.evaluate(() => {
      const s = window.getComputedStyle(
        document.querySelector('.pq-page-title'),
      );
      return {
        fontFamily: s.fontFamily,
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        letterSpacing: s.letterSpacing,
      };
    });

    await page.goto(`${baseUrl}/settings`, { waitUntil: 'networkidle' });
    await page.waitForSelector('.page-header-title');
    const settingsHeadingAndMono = await page.evaluate(() => {
      const h = window.getComputedStyle(
        document.querySelector('.page-header-title'),
      );
      const commitEl = document.querySelector(
        '[data-testid="system-info-commit"]',
      );
      const m = commitEl ? window.getComputedStyle(commitEl) : null;
      return {
        heading: {
          fontFamily: h.fontFamily,
          fontSize: h.fontSize,
          fontWeight: h.fontWeight,
          letterSpacing: h.letterSpacing,
        },
        commitFontFamily: m ? m.fontFamily : '',
      };
    });

    assert.deepEqual(
      settingsHeadingAndMono.heading,
      pqHeading,
      'PageHeader across Management Lite must match PrintQuote .pq-page-title computed typography 100%',
    );
    assert.match(
      settingsHeadingAndMono.commitFontFamily,
      /monospace|Consolas|SFMono-Regular|Menlo/i,
      'Technical commit SHA exception retains --font-mono stack',
    );

    // 3. Verify tabular-nums on data tables (/print-quotes/new) & high-density list (/employees) + Vietnamese diacritics + Long Title Stress Test
    await page.goto(`${baseUrl}/print-quotes/new`, {
      waitUntil: 'networkidle',
    });
    await page.waitForSelector('[data-testid="pq-title-input"]');
    const tableMetrics = await page.evaluate(() => {
      // Check both live DOM table/input and mounted table td computed rule from tokens.css
      const probe = document.createElement('table');
      probe.innerHTML = '<tbody><tr><td>1.250.000 ₫</td></tr></tbody>';
      document.body.appendChild(probe);
      const td = probe.querySelector('td');
      const tdStyle = window.getComputedStyle(td);
      const res = {
        fontVariantNumeric: tdStyle.fontVariantNumeric,
        fontFamily: tdStyle.fontFamily,
      };
      probe.remove();
      return res;
    });
    assert.equal(
      tableMetrics.fontVariantNumeric,
      'tabular-nums',
      'Data table cells apply tabular-nums for vertical numeric alignment',
    );
    assert.equal(
      tableMetrics.fontFamily,
      pqHeading.fontFamily,
      'Data tables use the shared system sans-serif stack rather than ad-hoc monospace',
    );

    await page.goto(`${baseUrl}/employees`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="employees-list-container"]');
    assert.match(
      await page.textContent('[data-testid="employees-list-container"]'),
      /Nguyễn Thị Hoài Phương/,
      'Vietnamese diacritics render intact on EmployeesScreen',
    );

    // Long Vietnamese title stress test across Desktop (1366px) & Mobile (320px, 390px) in Light & Dark
    const longViTitle =
      'Quản lý Báo giá Đóng gói & Đối soát Công nợ Xưởng Gia công Ánh Kim Đặc Biệt Năm 2026 — Kiểm Tra Chống Tràn Khung';
    for (const vw of [1366, 390, 320]) {
      await page.setViewportSize({ width: vw, height: 780 });
      for (const th of ['dark', 'light']) {
        const check = await page.evaluate(
          ({ titleText, themeName }) => {
            document.documentElement.setAttribute('data-theme', themeName);
            const h1 = document.querySelector('.page-header-title');
            if (h1) h1.textContent = titleText;
            const cs = h1 ? window.getComputedStyle(h1) : null;
            return {
              docOverflow:
                document.documentElement.scrollWidth - window.innerWidth,
              fontSize: cs ? cs.fontSize : '',
            };
          },
          { titleText: longViTitle, themeName: th },
        );
        assert.ok(
          check.docOverflow <= 0,
          `Long Vietnamese title must not overflow horizontally at ${vw}px (${th}): got ${check.docOverflow}`,
        );
        assert.equal(
          check.fontSize,
          vw <= 768 ? '17.5px' : '22px',
          `Responsive heading scale at ${vw}px`,
        );
      }
    }
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Task 4 (Option 4A) — Shared typography tokens, non-technical monospace cleanup, OTP/log exceptions & PDF preservation', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const REPO_ROOT = path.resolve('.');
  const tokensCss = fs.readFileSync(
    path.join(REPO_ROOT, 'packages/ui/src/tokens.css'),
    'utf8',
  );
  const { TOKENS } = await import(
    pathToFileURL(path.join(REPO_ROOT, 'dist/packages/ui/src/tokens.js')).href
  );
  const { PageHeader } = await import(
    pathToFileURL(
      path.join(REPO_ROOT, 'dist/packages/ui/src/components/PageHeader.js'),
    ).href
  );
  const { buildPrintQuoteA4Html } = await import(
    pathToFileURL(
      path.join(
        REPO_ROOT,
        'dist/apps/web/src/screens/helpers/printquote-helpers.js',
      ),
    ).href
  );

  // 1. Shared tokens exist in CSS & TS without @font-face or external font imports
  assert.doesNotMatch(tokensCss, /@font-face|fonts\.googleapis\.com/i);
  assert.match(tokensCss, /--font-sans:/);
  assert.match(tokensCss, /--font-mono:/);
  assert.match(tokensCss, /--heading-page-size:\s*22px/);
  assert.match(tokensCss, /--heading-page-weight:\s*800/);
  assert.match(tokensCss, /font-variant-numeric:\s*tabular-nums/);
  assert.equal(TOKENS.typography.letterSpacing.tight, '-0.02em');
  assert.equal(TOKENS.typography.numericVariant, 'tabular-nums');

  // 2. PageHeader renders shared heading token hierarchy
  const headerHtml = renderToStaticMarkup(
    React.createElement(PageHeader, {
      title: 'Bảng lương & Đối soát công nhân viên',
      subtitle: 'Kiểm tra dấu tiếng Việt đầy đủ',
    }),
  );
  assert.match(headerHtml, /font-weight:800/);
  assert.match(headerHtml, /var\(--heading-page-size, 22px\)/);
  assert.match(headerHtml, /var\(--subtitle-size, 13\.5px\)/);

  // 3. Business screens no longer use raw 'monospace'; justified technical screens use var(--font-mono)
  for (const rel of [
    'apps/web/src/screens/EmployeeDetailScreen.tsx',
    'apps/web/src/screens/PayrollScreen.tsx',
    'apps/web/src/screens/AccountsScreen.tsx',
    'apps/web/src/screens/SettingsScreen.tsx',
    'apps/web/src/screens/IssuesScreen.tsx',
    'apps/web/src/screens/IssueDetailScreen.tsx',
    'apps/web/src/screens/AuditScreen.tsx',
    'apps/web/src/screens/SystemLogsScreen.tsx',
  ]) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    assert.doesNotMatch(
      src,
      /fontFamily:\s*['"]monospace['"]/,
      `${rel} must not use bare 'monospace' (Courier New fallback)`,
    );
  }

  const accountsSrc = fs.readFileSync(
    path.join(REPO_ROOT, 'apps/web/src/screens/AccountsScreen.tsx'),
    'utf8',
  );
  assert.match(
    accountsSrc,
    /fontFamily:\s*'var\(--font-mono\)'/,
    '2FA OTP & secrets retain --font-mono exception',
  );

  // 4. PrintQuote A4 PDF HTML preserves its standalone print font stack untouched
  const pdfHtml = buildPrintQuoteA4Html(
    {
      quote_code: 'BG-0001',
      version_number: 1,
      issued_at: '2026-11-04T00:00:00.000Z',
      customer_name: 'Công ty TNHH Hoài Phương',
      title: 'In hộp giấy cứng cao cấp',
      total_quantity: 500,
      subtotal_before_shipping: 5_000_000,
      shipping_fee_display: 0,
      shipping_display_mode: 'INCLUDED_IN_UNIT_PRICE',
      grand_total: 5_000_000,
      lines: [
        {
          stt: 1,
          name: 'Hộp âm dương ép kim',
          spec_summary: 'Bìa lạnh 2mm',
          unit: 'hộp',
          quantity: 500,
          customer_unit_price: 10_000,
          customer_line_total: 5_000_000,
        },
      ],
    },
    { workspaceName: 'Hoài Phương Media' },
  );
  assert.match(
    pdfHtml,
    /font-family:\s*-apple-system,\s*BlinkMacSystemFont,\s*"Segoe UI",\s*Roboto,\s*"Helvetica Neue",\s*Arial,\s*sans-serif/,
    'PDF HTML template font stack must remain untouched',
  );
});
