import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const REPO_ROOT = path.resolve('.');
const DIST_ROOT = path.join(REPO_ROOT, 'apps/web/dist');

const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function startDistServer() {
  const server = http.createServer((req, res) => {
    const reqPath = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    const safeRel = path
      .normalize(reqPath)
      .replace(/^(\.\.(\/|\\|$))+/, '')
      .replace(/^[/\\]+/, '');
    const candidate = path.join(DIST_ROOT, safeRel);
    if (
      safeRel &&
      candidate.startsWith(DIST_ROOT) &&
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isFile()
    ) {
      const ext = path.extname(candidate).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_BY_EXT[ext] || 'application/octet-stream',
      });
      res.end(fs.readFileSync(candidate));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(DIST_ROOT, 'index.html')));
  });
  return server;
}

function createApiMockHandler(getRole) {
  return async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const p = u.pathname;
    const role = getRole();

    if (p === '/api/v1/auth/me') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            user: {
              id:
                role === 'owner'
                  ? '11111111-1111-4111-8111-111111111111'
                  : '33333333-3333-4333-8333-333333333333',
              username: role === 'owner' ? 'owner_hp' : 'staff_nv01',
              full_name:
                role === 'owner' ? 'Trương Hoài Phương' : 'Nguyễn Văn Minh',
              email:
                role === 'owner'
                  ? 'truhoaiphuong03@gmail.com'
                  : 'minh@hoaiphuong.click',
              email_verified: true,
              phone: '0901234567',
            },
            active_workspace: {
              id: '22222222-2222-4222-8222-222222222222',
              name: 'Hoài Phương Media',
              role,
              permissions: [],
            },
            csrf_token: 'csrf-work-unify-token',
          },
        }),
      });
    }

    if (p === '/api/v1/employees/me') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            id: role === 'owner' ? 'emp-owner' : 'emp-staff',
            employee_code: role === 'owner' ? 'OWNER' : 'NV001',
            full_name:
              role === 'owner' ? 'Trương Hoài Phương' : 'Nguyễn Văn Minh',
            phone: '0901234567',
            employment_status: 'active',
            user: {
              email:
                role === 'owner'
                  ? 'truhoaiphuong03@gmail.com'
                  : 'minh@hoaiphuong.click',
              email_verified: true,
            },
          },
        }),
      });
    }

    if (
      role !== 'owner' &&
      (p.startsWith('/api/v1/fin/') ||
        p.startsWith('/api/v1/print-quotes') ||
        p.startsWith('/api/v1/accounts') ||
        p.startsWith('/api/v1/issues'))
    ) {
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Forbidden for staff' },
        }),
      });
    }

    if (p.startsWith('/api/v1/fin/summary')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            period: 'month',
            from: '2026-11-01',
            to: '2026-11-30',
            total_income_vnd: '18500000',
            total_expense_vnd: '6200000',
            net_vnd: '12300000',
            categories: [
              {
                category_id: '44444444-4444-4444-8444-444444444444',
                category_name: 'Thu đơn in ấn',
                direction: 'income',
                total_vnd: '18500000',
              },
            ],
          },
        }),
      });
    }

    if (p.startsWith('/api/v1/fin/categories')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            items: [
              {
                id: '44444444-4444-4444-8444-444444444444',
                workspace_id: '22222222-2222-4222-8222-222222222222',
                name: 'Thu đơn in ấn',
                direction: 'income',
                is_archived: false,
                sort_order: 1,
                created_at: '2026-11-01T00:00:00Z',
                updated_at: '2026-11-01T00:00:00Z',
              },
            ],
            next_cursor: null,
            total: 1,
          },
        }),
      });
    }

    if (p.startsWith('/api/v1/fin/')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { items: [], next_cursor: null, total: 0 },
        }),
      });
    }

    if (p.startsWith('/api/v1/accounts')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            items: [
              {
                id: 'acc-1',
                platform: 'gmail',
                username: 'hoaiphuong.media01@gmail.com',
                phone_number: '0909111222',
                status: 'active',
                health_status: 'healthy',
                version: 1,
              },
            ],
            next_cursor: null,
          },
        }),
      });
    }

    if (p.startsWith('/api/v1/issues')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            items: [
              {
                id: 'iss-1',
                issue_code: 'ISS-0042',
                title: 'Kiểm tra đồng bộ thanh điều hướng phân hệ',
                description: 'Chuẩn hóa theo trang /work Quản lý công việc',
                status: 'open',
                severity: 'medium',
                issue_type: 'ui_ux',
                page_path: '/issues',
                created_at: '2026-11-05T04:00:00Z',
                updated_at: '2026-11-05T04:00:00Z',
              },
            ],
            counts: {
              all: 2,
              open: 1,
              in_progress: 0,
              awaiting_owner: 1,
              closed: 0,
            },
            next_cursor: null,
          },
        }),
      });
    }

    if (p.startsWith('/api/v1/print-quotes')) {
      const listField = p.endsWith('/vendors')
        ? {
            vendors: [
              {
                id: 'v-1',
                code: 'NCC01',
                name: 'Xưởng In Minh Phát',
                phone: '0909111222',
                is_active: true,
              },
            ],
          }
        : p.endsWith('/price-items')
          ? {
              price_items: [
                {
                  id: 'pi-1',
                  vendor_id: 'v-1',
                  code: 'BG01',
                  name: 'Tờ rơi A4 C150',
                  unit: 'tờ',
                  pricing_mode: 'PER_UNIT',
                  unit_cost: 1200,
                  batch_quantity: 1,
                  batch_total_cost: 0,
                  default_profit_mode: 'FIXED_AMOUNT',
                  default_profit_scope: 'PER_UNIT',
                  default_profit_value: 500,
                  version: 1,
                  is_active: true,
                },
              ],
            }
          : p.endsWith('/customers')
            ? {
                customers: [
                  {
                    id: 'c-1',
                    code: 'KH01',
                    name: 'Công ty Ánh Dương',
                    phone: '0909333444',
                    is_active: true,
                  },
                ],
              }
            : p.endsWith('/stats')
              ? {
                  total_quotes: 1,
                  total_orders: 0,
                  expected_revenue: 1700000,
                  expected_profit: 500000,
                  total_receivable: 0,
                }
              : { quotes: [], orders: [], items: [], next_cursor: null };
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: listField }),
      });
    }

    if (p === '/api/v1/employees') {
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
                full_name: 'Nguyễn Văn Minh',
                phone: '0901234567',
                employment_status: 'active',
                role: 'staff',
                permissions: [],
              },
            ],
            total: 1,
          },
        }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          items: [],
          entries: [],
          logs: [],
          issues: [],
          shifts: [],
          periods: [],
        },
      }),
    });
  };
}

test('Unify Management Lite to /work standard: CDP rendered font, 7-module typography & subnav parity, tabs, RBAC, keyboard focus, overflow & draft state', async () => {
  const server = startDistServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  let activeRole = 'owner';
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'dark',
    });
    await ctx.route(
      '**/api/v1/**',
      createApiMockHandler(() => activeRole),
    );

    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');

    async function getPlatformFonts(selector) {
      const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
      const { nodeId } = await cdp.send('DOM.querySelector', {
        nodeId: root.nodeId,
        selector,
      });
      if (!nodeId) return [];
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', {
        nodeId,
      });
      return fonts;
    }

    const SEVEN_MODULES = [
      { name: 'Công việc', path: '/work' },
      { name: 'Chấm công', path: '/clock' },
      { name: 'Nhân sự', path: '/employees' },
      { name: 'Tài khoản', path: '/accounts' },
      { name: 'Thu chi', path: '/finance' },
      { name: 'Báo giá', path: '/print-quotes' },
      { name: 'Sổ tay lỗi', path: '/issues' },
    ];

    // 1. Desktop & Mobile, Dark & Light parity across all 7 modules vs /work
    for (const vp of [
      { label: 'desktop', width: 1440, height: 900 },
      { label: 'mobile', width: 390, height: 844 },
      { label: 'mobile-320', width: 320, height: 640 },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const theme of ['dark', 'light']) {
        await page.goto(`${baseUrl}/work`, { waitUntil: 'networkidle' });
        await page.evaluate((t) => {
          localStorage.setItem('mglite_theme', t);
          document.documentElement.setAttribute('data-theme', t);
        }, theme);

        let workRef = null;
        for (const mod of SEVEN_MODULES) {
          await page.goto(`${baseUrl}${mod.path}`, {
            waitUntil: 'networkidle',
          });
          await page.waitForSelector('#main-content h1');
          await page.evaluate((t) => {
            document.documentElement.setAttribute('data-theme', t);
          }, theme);

          const h1PlatformFonts = await getPlatformFonts('#main-content h1');
          assert.ok(
            h1PlatformFonts.length > 0,
            `${mod.name} (${vp.label}/${theme}) must report real CDP platform font on h1`,
          );
          if (process.platform === 'win32') {
            assert.ok(
              !h1PlatformFonts.some((f) => /Black/i.test(f.familyName)),
              `${mod.name} h1 must render Segoe UI Bold (700), NOT Segoe UI Black: got ${JSON.stringify(h1PlatformFonts)}`,
            );
          }

          const metrics = await page.evaluate(() => {
            const doc = document.documentElement;
            const h1 = document.querySelector('#main-content h1');
            const sub = document.querySelector(
              '#main-content .page-header-subtitle, #main-content .pq-page-subtitle',
            );
            const nav = document.querySelector(
              '#main-content .app-subnav-bar, #main-content .pq-module-nav',
            );
            const navActive = nav?.querySelector('[data-active="true"]');
            const navInactive = nav?.querySelector('[data-active="false"]');
            const dupSwitcher = document.querySelector(
              '[data-testid="issues-logs-subswitcher"]',
            );
            const h1Cs = window.getComputedStyle(h1);
            const subCs = sub ? window.getComputedStyle(sub) : null;
            const navCs = nav ? window.getComputedStyle(nav) : null;
            const actCs = navActive ? window.getComputedStyle(navActive) : null;
            const inactCs = navInactive
              ? window.getComputedStyle(navInactive)
              : null;
            const h1Rect = h1.getBoundingClientRect();
            const navRect = nav ? nav.getBoundingClientRect() : null;

            return {
              overflowX: doc.scrollWidth - doc.clientWidth,
              dupSwitcherExists: Boolean(dupSwitcher),
              navAriaLabel: nav ? nav.getAttribute('aria-label') : null,
              activeAriaCurrent: navActive
                ? navActive.getAttribute('aria-current')
                : null,
              navAboveTitle: navRect ? navRect.top < h1Rect.top : false,
              h1X: Math.round(h1Rect.left),
              h1Style: {
                fontFamily: h1Cs.fontFamily,
                fontSize: h1Cs.fontSize,
                fontWeight: h1Cs.fontWeight,
                lineHeight: h1Cs.lineHeight,
                letterSpacing: h1Cs.letterSpacing,
              },
              subVisible: subCs ? subCs.display !== 'none' : false,
              subStyle:
                subCs && subCs.display !== 'none'
                  ? {
                      fontFamily: subCs.fontFamily,
                      fontSize: subCs.fontSize,
                      fontWeight: subCs.fontWeight,
                      lineHeight: subCs.lineHeight,
                    }
                  : null,
              navBorderBottom: navCs ? navCs.borderBottomStyle : null,
              activeTabStyle: actCs
                ? {
                    fontSize: actCs.fontSize,
                    fontWeight: actCs.fontWeight,
                  }
                : null,
              inactiveTabStyle: inactCs
                ? {
                    fontSize: inactCs.fontSize,
                    fontWeight: inactCs.fontWeight,
                  }
                : null,
            };
          });

          assert.ok(
            metrics.overflowX <= 0,
            `${mod.name} (${vp.label}/${theme}) must have 0 horizontal overflow, got ${metrics.overflowX}`,
          );
          assert.equal(
            metrics.dupSwitcherExists,
            false,
            `${mod.name} must not render redundant issues-logs-subswitcher`,
          );
          assert.ok(
            metrics.navAriaLabel && metrics.navAriaLabel.length > 0,
            `${mod.name} module subnav must expose accessible aria-label`,
          );
          assert.equal(
            metrics.activeAriaCurrent,
            'page',
            `${mod.name} active subnav item must expose aria-current="page"`,
          );
          assert.equal(
            metrics.navAboveTitle,
            true,
            `${mod.name} module subnav must sit ABOVE the page title like /work`,
          );
          assert.equal(
            metrics.navBorderBottom,
            'solid',
            `${mod.name} module subnav must use flat bottom divider line like /work`,
          );

          if (!workRef) {
            workRef = metrics;
            assert.equal(
              workRef.h1Style.fontSize,
              vp.width <= 768 ? '17.5px' : '22px',
            );
            assert.equal(workRef.h1Style.fontWeight, '700');
            assert.equal(workRef.subVisible, vp.width > 768);
          } else {
            assert.deepEqual(
              metrics.h1Style,
              workRef.h1Style,
              `${mod.name} (${vp.label}/${theme}) h1 typography must match /work 100%`,
            );
            assert.deepEqual(
              metrics.subStyle,
              workRef.subStyle,
              `${mod.name} (${vp.label}/${theme}) subtitle typography/visibility must match /work 100%`,
            );
            assert.deepEqual(
              metrics.activeTabStyle,
              workRef.activeTabStyle,
              `${mod.name} (${vp.label}/${theme}) active subnav tab style must match /work 100%`,
            );
            assert.deepEqual(
              metrics.inactiveTabStyle,
              workRef.inactiveTabStyle,
              `${mod.name} (${vp.label}/${theme}) inactive subnav tab style must match /work 100%`,
            );
            assert.ok(
              Math.abs(metrics.h1X - workRef.h1X) <= 2,
              `${mod.name} (${vp.label}/${theme}) h1 X alignment (${metrics.h1X}) must match /work (${workRef.h1X})`,
            );
          }
        }
      }
    }

    // 2. Level-2 Tab Switching, Keyboard Focus/Activation & Zero Lost Routes
    await page.setViewportSize({ width: 1440, height: 900 });

    // 2a. Finance 4 peer tabs + zero duplicate Breadcrumb + keyboard Enter activation
    await page.goto(`${baseUrl}/finance`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="finance-subnav-bar"]');
    const finSecondTab = page
      .locator('[data-testid="finance-subnav-bar"] button')
      .nth(1);
    await finSecondTab.focus();
    const focusOutline = await finSecondTab.evaluate(
      (el) => window.getComputedStyle(el).outlineStyle,
    );
    assert.notEqual(
      focusOutline,
      'none',
      'Focused subnav button shows focus ring',
    );
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => window.location.pathname === '/finance/history',
    );
    assert.equal(
      await page.locator('nav[aria-label="Breadcrumb"]').count(),
      0,
      '/finance/history peer tab must not render duplicate Breadcrumb above subnav',
    );
    await page.click(
      '[data-testid="finance-subnav-bar"] button:has-text("Danh mục")',
    );
    await page.waitForFunction(
      () => window.location.pathname === '/finance/categories',
    );
    await page.click(
      '[data-testid="finance-subnav-bar"] button:has-text("Kế hoạch thu chi cố định")',
    );
    await page.waitForFunction(
      () => window.location.pathname === '/finance/plan',
    );

    // 2b. Quản trị 4 unified peer tabs: Sổ tay lỗi | Nhật ký hệ thống | Nhật ký Audit | Cài đặt
    await page.goto(`${baseUrl}/issues`, { waitUntil: 'networkidle' });
    const adminLabels = await page
      .locator('[data-testid="app-subnav-bar"] button')
      .allTextContents();
    assert.deepEqual(adminLabels, [
      'Sổ tay lỗi',
      'Nhật ký hệ thống',
      'Nhật ký Audit',
      'Cài đặt',
    ]);
    await page.click(
      '[data-testid="app-subnav-bar"] button:has-text("Nhật ký hệ thống")',
    );
    await page.waitForFunction(
      () => window.location.pathname === '/system-logs',
    );
    await page.click(
      '[data-testid="app-subnav-bar"] button:has-text("Nhật ký Audit")',
    );
    await page.waitForFunction(() => window.location.pathname === '/audit');
    await page.click(
      '[data-testid="app-subnav-bar"] button:has-text("Cài đặt")',
    );
    await page.waitForFunction(() => window.location.pathname === '/settings');

    // 2c. PrintQuote 4 top tabs + 3 Catalog sub-tabs + RAM Draft Preservation across tab switches
    await page.goto(`${baseUrl}/print-quotes/new`, {
      waitUntil: 'networkidle',
    });
    await page.fill(
      '[data-testid="pq-title-input"]',
      'Báo giá Catalogue Cao Cấp 2026',
    );
    await page.click('[data-testid="pq-editor-back-btn"]');
    await page.waitForSelector('[data-testid="pq-ram-draft-banner"]');
    assert.match(
      await page.textContent('[data-testid="pq-ram-draft-banner"]'),
      /Báo giá Catalogue Cao Cấp 2026/,
    );
    // Switch across Orders -> Finance/AR-AP (verify 4 finance sub-tabs) -> Catalog (verify all 3 catalog sub-tabs remain accessible) -> Reports -> Quotes
    await page.click('[data-testid="pq-nav-group-orders"]');
    await page.waitForFunction(
      () => window.location.pathname === '/print-quotes/orders',
    );
    await page.click('[data-testid="pq-nav-group-finance"]');
    await page.waitForSelector('[data-testid="pq-finance-tabs"]');
    await page.click('[data-testid="pq-finance-tab-payables"]');
    await page.waitForFunction(
      () => window.location.pathname === '/print-quotes/payables',
    );
    await page.click('[data-testid="pq-nav-group-catalog"]');
    await page.waitForSelector('[data-testid="pq-catalog-tabs"]');
    await page.click('[data-testid="pq-catalog-tab-customers"]');
    await page.waitForFunction(
      () => window.location.pathname === '/print-quotes/catalog/customers',
    );
    await page.click('[data-testid="pq-catalog-tab-vendors"]');
    await page.waitForFunction(
      () => window.location.pathname === '/print-quotes/catalog/vendors',
    );
    await page.click('[data-testid="pq-nav-group-analytics"]');
    await page.waitForFunction(
      () => window.location.pathname === '/print-quotes/reports',
    );
    await page.click('[data-testid="pq-nav-group-quotes"]');
    await page.click('[data-testid="pq-resume-draft-btn"]');
    await page.waitForSelector('[data-testid="pq-title-input"]');
    assert.equal(
      await page.inputValue('[data-testid="pq-title-input"]'),
      'Báo giá Catalogue Cao Cấp 2026',
      'PrintQuote in-progress RAM draft input must remain intact after switching tabs',
    );

    // 2d. Accounts search input preserved across top view-mode tabs
    await page.goto(`${baseUrl}/accounts`, { waitUntil: 'networkidle' });
    const accSearch = page.locator('input[placeholder*="Tìm email"]');
    await accSearch.fill('hoaiphuong');
    await page.click('[data-testid="tab-view-clusters"]');
    await page.click('[data-testid="tab-view-phones"]');
    await page.click('[data-testid="tab-view-protection"]');
    await page.click('[data-testid="tab-view-all"]');
    assert.equal(
      await accSearch.inputValue(),
      'hoaiphuong',
      'Accounts search input preserved when switching view tabs',
    );

    // 2e. Issues search input preserved across status chips
    await page.goto(`${baseUrl}/issues`, { waitUntil: 'networkidle' });
    await page.fill('[data-testid="issue-search-input"]', 'điều hướng');
    await page.click('[data-testid="tab-status-open"]');
    await page.click('[data-testid="tab-status-all"]');
    assert.equal(
      await page.inputValue('[data-testid="issue-search-input"]'),
      'điều hướng',
      'Issues search input preserved when switching status chips',
    );

    // 3. Long Vietnamese Title Stress Test (no ellipsis cutoff, 0 overflow)
    const longTitle =
      'Quản lý Công việc Sản xuất Ấn phẩm Đóng gói Ánh Kim & Nghiệm thu Chất lượng Xưởng In Đối tác Quý 4 Năm 2026';
    for (const vw of [1440, 390, 320]) {
      await page.setViewportSize({ width: vw, height: 800 });
      const res = await page.evaluate((t) => {
        const h1 = document.querySelector('#main-content h1');
        h1.textContent = t;
        const cs = window.getComputedStyle(h1);
        return {
          overflowX:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
          whiteSpace: cs.whiteSpace,
          text: h1.textContent,
        };
      }, longTitle);
      assert.ok(res.overflowX <= 0, `No horizontal overflow at ${vw}px`);
      assert.equal(
        res.whiteSpace,
        'normal',
        `Title wraps naturally at ${vw}px`,
      );
    }

    // 4. Staff RBAC Verification (Owner-only modules hidden in subnav/sidebar & guarded)
    activeRole = 'staff';
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${baseUrl}/settings`, { waitUntil: 'networkidle' });
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(
      await page.locator('[data-testid="app-subnav-bar"]').count(),
      0,
      'Staff on /settings must NOT see Sổ tay lỗi / Nhật ký hệ thống / Nhật ký Audit in subnav',
    );
    const sidebarText = await page.textContent('aside');
    assert.equal(sidebarText.includes('Thu chi'), false);
    assert.equal(sidebarText.includes('Báo giá'), false);
    assert.equal(sidebarText.includes('Tài khoản'), false);

    // 5. PDF Output Invariant (buildPrintQuoteA4Html untouched)
    const { buildPrintQuoteA4Html } = await import(
      pathToFileURL(
        path.join(
          REPO_ROOT,
          'dist/apps/web/src/screens/helpers/printquote-helpers.js',
        ),
      ).href
    );
    const pdfHtml = buildPrintQuoteA4Html(
      {
        quote_code: 'BG-2026-0001',
        version_number: 1,
        issued_at: '2026-11-05T00:00:00.000Z',
        customer_name: 'Công ty Ánh Dương',
        title: 'Báo giá Catalogue',
        total_quantity: 100,
        subtotal_before_shipping: 2_500_000,
        shipping_fee_display: 0,
        shipping_display_mode: 'INCLUDED_IN_UNIT_PRICE',
        grand_total: 2_500_000,
        lines: [
          {
            stt: 1,
            name: 'Catalogue A4',
            spec_summary: 'Bìa C250',
            unit: 'cuốn',
            quantity: 100,
            customer_unit_price: 25_000,
            customer_line_total: 2_500_000,
          },
        ],
      },
      {
        quoteCode: 'BG-2026-0001',
        quoteTitle: 'Báo giá Catalogue',
        workspaceName: 'Hoài Phương Media',
      },
    );
    assert.match(pdfHtml, /BG-2026-0001/);
    assert.match(
      pdfHtml,
      /font-family:\s*-apple-system,\s*BlinkMacSystemFont,\s*"Segoe UI",\s*Roboto,\s*"Helvetica Neue",\s*Arial,\s*sans-serif/,
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
