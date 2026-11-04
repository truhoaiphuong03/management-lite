/**
 * Real-Browser Playwright + Axe-Core Acceptance, RBAC, Zero-Sample-Data, PDF & Multi-Viewport Audit:
 * MANAGEMENT LITE — HOÀN THIỆN CÔNG NỢ & TÀI CHÍNH IN ẤN (AR / AP / Đa xưởng / Đơn hủy / 3 Chế độ Báo cáo / Nhập lịch sử 2 Google Sheet)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';

import {
  AreaInputMode,
  ProfitMode,
  ProfitScope,
  VendorCostMode,
} from '../../dist/packages/contracts/src/printquote.js';
import { buildPrintQuoteA4Html } from '../../dist/apps/web/src/screens/helpers/printquote-helpers.js';
import {
  loadTestDatabaseConfig,
  assertSafeTestDatabase,
} from '../../dist/packages/database/src/config.js';
import { createDatabasePool } from '../../dist/packages/database/src/pool.js';
import {
  runMigrations,
  loadMigrationFiles,
} from '../../dist/packages/database/src/migrator.js';
import { createRequestHandler } from '../../dist/apps/api/src/app.js';
import { hashPassword } from '../../dist/packages/security/src/password.js';

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(
  require.resolve('axe-core/axe.min.js'),
  'utf8',
);

const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function assertSafeTarget(env = process.env) {
  const dbConfig = loadTestDatabaseConfig(env);
  assertSafeTestDatabase(dbConfig, env);
  const e2eConfirm = (env['CONFIRM_PRINTQUOTE_E2E_RESET'] || '')
    .trim()
    .toLowerCase();
  if (e2eConfirm !== 'true' && e2eConfirm !== '1') {
    throw new Error(
      'Set CONFIRM_PRINTQUOTE_E2E_RESET=true in addition to TEST_DATABASE_URL and CONFIRM_ISOLATED_TEST_DB=true.',
    );
  }
  return dbConfig;
}

async function startEphemeralServers(pool) {
  const distDir = path.resolve(process.cwd(), 'apps/web/dist');
  const indexHtmlPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error(
      `Missing built web assets at ${indexHtmlPath}. Run "npm run build:web" first.`,
    );
  }

  let webOrigin = 'http://127.0.0.1';
  const csrfSecret = 'isolated-pq-arap-ui-e2e-csrf-secret-32chars!!';
  const apiHandler = createRequestHandler({
    pool,
    isProduction: false,
    csrfSecret,
    allowedOrigins: ['http://127.0.0.1:3000'],
  });

  const apiServer = http.createServer((req, res) => {
    if (req.headers.origin === webOrigin) {
      req.headers.origin = 'http://127.0.0.1:3000';
    }
    apiHandler(req, res);
  });

  await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve));
  const apiPort = apiServer.address().port;

  const webServer = http.createServer((req, res) => {
    const reqUrl = req.url || '/';
    if (reqUrl.startsWith('/api/')) {
      const proxyReq = http.request(
        {
          hostname: '127.0.0.1',
          port: apiPort,
          path: reqUrl,
          method: req.method,
          headers: {
            ...req.headers,
            host: `127.0.0.1:${apiPort}`,
          },
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );
      proxyReq.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Bad Gateway: ${err.message}`);
      });
      req.pipe(proxyReq);
      return;
    }

    const cleanPath = reqUrl.split('?')[0].split('#')[0];
    const relPath = cleanPath === '/' ? 'index.html' : cleanPath.slice(1);
    const candidatePath = path.resolve(distDir, relPath);
    if (
      candidatePath.startsWith(distDir) &&
      fs.existsSync(candidatePath) &&
      fs.statSync(candidatePath).isFile()
    ) {
      const ext = path.extname(candidatePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_BY_EXT[ext] || 'application/octet-stream',
      });
      res.end(fs.readFileSync(candidatePath));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(indexHtmlPath));
  });

  await new Promise((resolve) => webServer.listen(0, '127.0.0.1', resolve));
  const webPort = webServer.address().port;
  webOrigin = `http://127.0.0.1:${webPort}`;

  return {
    webUrl: webOrigin,
    close: async () => {
      webServer.closeAllConnections?.();
      apiServer.closeAllConnections?.();
      await new Promise((resolve) => webServer.close(resolve));
      await new Promise((resolve) => apiServer.close(resolve));
    },
  };
}

async function seedOwnerAndSubAdmin(
  pool,
  ownerUsername,
  adminUsername,
  passwordPlain,
) {
  const passwordHash = await hashPassword(passwordPlain);
  const workspaceId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const adminId = crypto.randomUUID();

  await pool.query(
    `INSERT INTO workspaces (id, name, timezone, status)
     VALUES ($1, 'Hoài Phương Media', 'Asia/Ho_Chi_Minh', 'active')`,
    [workspaceId],
  );
  await pool.query(
    `INSERT INTO users (id, username_normalized, email_normalized, status)
     VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
    [
      ownerId,
      ownerUsername,
      `${ownerUsername}@pq-arap-ui.local`,
      adminId,
      adminUsername,
      `${adminUsername}@pq-arap-ui.local`,
    ],
  );
  await pool.query(
    `INSERT INTO user_credentials (user_id, password_hash, credential_version)
     VALUES ($1, $3, 1), ($2, $3, 1)`,
    [ownerId, adminId, passwordHash],
  );
  await pool.query(
    `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status)
     VALUES ($1, $2, $3, 'owner', 'active'), ($4, $2, $5, 'staff', 'active')`,
    [crypto.randomUUID(), workspaceId, ownerId, crypto.randomUUID(), adminId],
  );
  await pool.query(
    `INSERT INTO user_workspace_bindings (user_id, workspace_id, status, version)
     VALUES ($1, $2, 'active', 1), ($3, $2, 'active', 1)`,
    [ownerId, workspaceId, adminId],
  );
  await pool.query(
    `INSERT INTO employees (id, workspace_id, user_id, employee_code, full_name, phone, employment_status, sub_role, sub_permissions)
     VALUES ($1, $2, $3, 'OWN01', 'Chủ sở hữu (Test)', '0909123456', 'active', 'staff', '[]'::jsonb),
            ($4, $2, $5, 'ADM01', 'Quản lý phụ đủ 6 quyền', '0909888999', 'active', 'admin', $6::jsonb)`,
    [
      crypto.randomUUID(),
      workspaceId,
      ownerId,
      crypto.randomUUID(),
      adminId,
      JSON.stringify([
        'attendance:review',
        'work:manage',
        'employees:manage',
        'accounts:manage',
        'payroll:manage',
        'finance:manage',
      ]),
    ],
  );
  return { workspaceId, ownerId, adminId };
}

async function pageApiPost(page, urlPath, body) {
  return page.evaluate(
    async ({ p, b }) => {
      const meRes = await fetch('/api/v1/auth/me', { credentials: 'include' });
      const meJson = await meRes.json();
      const csrf = meJson?.data?.csrf_token || '';
      const r = await fetch(p, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify(b),
      });
      const j = await r.json();
      return { status: r.status, body: j };
    },
    { p: urlPath, b: body },
  );
}

async function pageApiPatch(page, urlPath, body) {
  return page.evaluate(
    async ({ p, b }) => {
      const meRes = await fetch('/api/v1/auth/me', { credentials: 'include' });
      const meJson = await meRes.json();
      const csrf = meJson?.data?.csrf_token || '';
      const r = await fetch(p, {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrf,
        },
        body: JSON.stringify(b),
      });
      const j = await r.json();
      return { status: r.status, body: j };
    },
    { p: urlPath, b: body },
  );
}

async function pageApiGet(page, urlPath) {
  return page.evaluate(async (p) => {
    const r = await fetch(p, { credentials: 'include' });
    const j = await r.json();
    return { status: r.status, body: j };
  }, urlPath);
}

test('Real-Browser Playwright + Axe Audit: 5 Trang Công Nợ & Tài Chính In Ấn (1440px, 390px, 320px × Light/Dark) + Zero Sample Data + Chặn Admin Phụ + Bảo Mật PDF D-02', async () => {
  const dbConfig = assertSafeTarget(process.env);
  const screenshotDir =
    process.env.PQ_SCREENSHOT_DIR ||
    path.resolve(process.cwd(), '.artifacts', 'pq-arap-ui');
  fs.mkdirSync(screenshotDir, { recursive: true });

  const suffix = crypto.randomUUID().slice(0, 8);
  const ownerUsername = `owner_arap_${suffix}`;
  const adminUsername = `admin_arap_${suffix}`;
  const passwordPlain = 'TestOwnerArAp#2026!';

  const pool = createDatabasePool(dbConfig);
  let ephemeral = null;
  let browser = null;

  try {
    await runMigrations(
      pool,
      loadMigrationFiles('packages/database/src/migrations'),
    );
    await seedOwnerAndSubAdmin(
      pool,
      ownerUsername,
      adminUsername,
      passwordPlain,
    );
    ephemeral = await startEphemeralServers(pool);

    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    // =========================================================================
    // PART 1: Sub-Admin (with all 6 sub-permissions incl. finance:manage) MUST be blocked on UI!
    // =========================================================================
    {
      const adminCtx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      const adminPage = await adminCtx.newPage();
      await adminPage.goto(`${ephemeral.webUrl}/login`, {
        waitUntil: 'networkidle',
      });
      await adminPage.fill('#identifier', adminUsername);
      await adminPage.fill('#password', passwordPlain);
      await adminPage.click('button[type="submit"]');
      await adminPage.waitForSelector('nav[aria-label="Desktop navigation"]', {
        timeout: 15000,
      });

      const navText = await adminPage.textContent(
        'nav[aria-label="Desktop navigation"]',
      );
      assert.equal(
        navText.includes('Báo giá in ấn'),
        false,
        'Sub-admin must NOT see Báo giá in ấn in sidebar',
      );

      for (const route of [
        '/print-quotes/receivables',
        '/print-quotes/payables',
        '/print-quotes/transactions',
        '/print-quotes/reports',
        '/print-quotes/import-history',
      ]) {
        await adminPage.goto(`${ephemeral.webUrl}${route}`, {
          waitUntil: 'networkidle',
        });
        await adminPage.waitForTimeout(200);
        assert.equal(
          await adminPage
            .locator('[data-testid="panel-pq-receivables"]')
            .count(),
          0,
          `Sub-admin must NOT access ${route}`,
        );
        assert.equal(
          await adminPage.locator('[data-testid="panel-pq-payables"]').count(),
          0,
          `Sub-admin must NOT access ${route}`,
        );
      }
      await adminCtx.close();
    }

    // =========================================================================
    // PART 2: Owner Empty Workspace -> Zero Sample Data Check -> Seed Real Financial Lifecycle
    // =========================================================================
    const ownerCtx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    await ownerCtx.addInitScript(() =>
      localStorage.setItem('mglite_theme', 'light'),
    );
    const page = await ownerCtx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));

    await page.goto(`${ephemeral.webUrl}/login`, { waitUntil: 'networkidle' });
    await page.fill('#identifier', ownerUsername);
    await page.fill('#password', passwordPlain);
    await page.click('button[type="submit"]');
    await page.waitForSelector(
      'nav[aria-label="Desktop navigation"] button:has-text("Báo giá in ấn")',
      { timeout: 15000 },
    );

    // Check empty states on all 5 new pages (ZERO fake/sample data)
    for (const [route, testId] of [
      ['/print-quotes/receivables', 'panel-pq-receivables'],
      ['/print-quotes/payables', 'panel-pq-payables'],
      ['/print-quotes/transactions', 'panel-pq-transactions'],
      ['/print-quotes/reports', 'panel-profit-debt'],
      ['/print-quotes/import-history', 'panel-pq-import-history'],
    ]) {
      await page.goto(`${ephemeral.webUrl}${route}`, {
        waitUntil: 'networkidle',
      });
      await page.waitForSelector(`[data-testid="${testId}"]`);
      const bodyText = await page.textContent(`[data-testid="${testId}"]`);
      assert.equal(
        bodyText.includes('Nguyễn Văn A'),
        false,
        `No sample customer allowed on ${route}`,
      );
    }

    // Populate real end-to-end financial lifecycle via API
    const cust = (
      await pageApiPost(page, '/api/v1/print-quotes/customers', {
        name: 'Công ty CP Thương Mại Ánh Dương',
        phone: '0903456789',
      })
    ).body.data;
    const vendPrint = (
      await pageApiPost(page, '/api/v1/print-quotes/vendors', {
        name: 'Xưởng Offset Bình Thạnh',
        phone: '0918111222',
        bank_name: 'ACB',
        bank_account_number: '1900888999',
        bank_account_holder: 'XUONG OFFSET BINH THANH',
      })
    ).body.data;
    const vendFinish = (
      await pageApiPost(page, '/api/v1/print-quotes/vendors', {
        name: 'Xưởng Gia Công Ép Kim Phú Nhuận',
        phone: '0918333444',
      })
    ).body.data;

    // Quote 1: Multi-workshop + 6-decimal m² + D-02 customer area note
    const q1 = (
      await pageApiPost(page, '/api/v1/print-quotes/quotes', {
        title: 'Backdrop sự kiện + Hộp quà ép kim Ánh Dương',
        customer_id: cust.id,
        customer_name: cust.name,
        status: 'FINALIZED',
        shipping_fee: 80_000,
        items: [
          {
            name: 'Backdrop PP cán mờ khổ lẻ',
            unit: 'tấm',
            quantity: 2,
            vendorCostMode: VendorCostMode.PER_SQM,
            baseCostRate: 100_000,
            vendorId: vendPrint.id,
            vendorName: vendPrint.name,
            areaSpec: {
              mode: AreaInputMode.DIRECT_AREA,
              actualAreaSqm: 2.88,
              billableAreaSqm: 3.123456,
              adjustmentReason: 'Khổ bạt xưởng 3,2m hao lề kẹp máy nội bộ',
              customerAreaNote: 'Tính diện tích theo khổ vật tư 3,123456 m²',
            },
            profitMode: ProfitMode.FIXED_AMOUNT,
            profitScope: ProfitScope.TOTAL_BATCH,
            profitValue: 300_000,
          },
          {
            name: 'Hộp quà cứng ép kim logo',
            unit: 'hộp',
            quantity: 200,
            vendorCostMode: VendorCostMode.TOTAL_BATCH,
            baseCostRate: 1_200_000,
            vendorId: vendPrint.id,
            vendorName: vendPrint.name,
            finishingStages: [
              {
                name: 'Ép kim nhũ vàng nắp hộp',
                unit: 'lô',
                pricingMode: VendorCostMode.TOTAL_BATCH,
                rate: 450_000,
                vendorId: vendFinish.id,
                vendorName: vendFinish.name,
              },
            ],
            profitMode: ProfitMode.PERCENTAGE,
            profitScope: ProfitScope.TOTAL_BATCH,
            profitValue: 20,
          },
        ],
      })
    ).body.data;

    // Verify customer PDF payload & HTML: shows 3,123456 m² + D-02 customerAreaNote, NEVER leaks internal adjustmentReason / vendor / cost / profit!
    const pdfRes = await pageApiGet(
      page,
      `/api/v1/print-quotes/quotes/${q1.id}/pdf`,
    );
    assert.equal(pdfRes.status, 200);
    const pdfHtml = buildPrintQuoteA4Html(
      pdfRes.body.data,
      'Hoài Phương Media',
    );
    assert.match(pdfHtml, /3,123456/);
    assert.match(pdfHtml, /2,88/);
    assert.match(pdfHtml, /Tính diện tích theo khổ vật tư 3,123456 m²/);
    assert.equal(pdfHtml.includes('hao lề kẹp máy nội bộ'), false);
    assert.equal(pdfHtml.includes('Xưởng Offset Bình Thạnh'), false);
    assert.equal(pdfHtml.includes('Xưởng Gia Công Ép Kim Phú Nhuận'), false);
    assert.equal(pdfHtml.includes('1.200.000'), false);

    const ord1 = (
      await pageApiPost(page, '/api/v1/print-quotes/orders', {
        quote_id: q1.id,
        vendor_id: vendPrint.id,
        deposit_required: 1_000_000,
        due_date: '2026-11-25',
      })
    ).body.data;

    const jobsRes = await pageApiPost(
      page,
      `/api/v1/print-quotes/orders/${ord1.id}/workshop-jobs/init`,
      {},
    );
    assert.equal(jobsRes.status, 201);
    const jobs = jobsRes.body.data.items;
    const jobPrint = jobs.find((j) => j.vendor_id === vendPrint.id);
    const jobFinish = jobs.find((j) => j.vendor_id === vendFinish.id);

    // Confirm jobPrint, leave jobFinish entered-unconfirmed so UI renders both states!
    await pageApiPatch(
      page,
      `/api/v1/print-quotes/workshop-jobs/${jobPrint.id}`,
      {
        entered_cost: jobPrint.expected_cost,
        confirm_cost: true,
      },
    );
    await pageApiPatch(
      page,
      `/api/v1/print-quotes/workshop-jobs/${jobFinish.id}`,
      {
        entered_cost: 460_000,
      },
    );

    // AR Receipt with partial allocation + unallocated advance
    await pageApiPost(page, '/api/v1/print-quotes/receivables/receipts', {
      customer_id: cust.id,
      amount: 1_800_000,
      reference_code: 'UNC-AD-1800',
      allocations: [{ order_id: ord1.id, amount: 1_200_000 }],
    });

    // AP Payout allocated to confirmed jobPrint + unallocated vendor advance
    await pageApiPost(page, '/api/v1/print-quotes/payables/payouts', {
      vendor_id: vendPrint.id,
      amount: 1_500_000,
      reference_code: 'UNC-OFFSET-1500',
      allocations: [{ workshop_job_id: jobPrint.id, amount: 1_000_000 }],
    });

    // Order 2: Cancelled after deposit (stays in PENDING_SETTLEMENT)
    const q2 = (
      await pageApiPost(page, '/api/v1/print-quotes/quotes', {
        title: 'Standee hội thảo hủy giữa chừng',
        customer_id: cust.id,
        customer_name: cust.name,
        status: 'FINALIZED',
        items: [
          {
            name: 'Standee cuốn nhôm 80x200',
            unit: 'cây',
            quantity: 10,
            vendorCostMode: VendorCostMode.PER_UNIT,
            baseCostRate: 120_000,
            profitMode: ProfitMode.FIXED_AMOUNT,
            profitScope: ProfitScope.PER_UNIT,
            profitValue: 60_000,
          },
        ],
      })
    ).body.data;
    const ord2 = (
      await pageApiPost(page, '/api/v1/print-quotes/orders', {
        quote_id: q2.id,
        deposit_required: 500_000,
      })
    ).body.data;
    await pageApiPost(page, '/api/v1/print-quotes/receivables/receipts', {
      customer_id: cust.id,
      amount: 500_000,
      reference_code: 'UNC-CANCEL-DEP500',
      allocations: [{ order_id: ord2.id, amount: 500_000 }],
    });
    await pageApiPatch(page, `/api/v1/print-quotes/orders/${ord2.id}`, {
      production_status: 'CANCELLED',
    });

    // Historical Import Preview via UI on /print-quotes/import-history!
    await page.goto(`${ephemeral.webUrl}/print-quotes/import-history`, {
      waitUntil: 'networkidle',
    });
    await page.fill('[data-testid="pq-import-tab-name"]', 'CongNo_RIENG_T10');
    await page.fill(
      'textarea',
      [
        'Đối tượng\tVai trò\tTổng tiền hàng\tCông nợ còn lại\tMã chứng từ\tNgày',
        'Công ty Nội Thất Mộc Việt\tKhách hàng\t6.000.000\t2.400.000\tCT-R-101\t12/10/2026',
        'Thẩm Mỹ Aura\tKhách hàng\t4.200.000\t\tCT-R-102\t14/10/2026',
      ].join('\n'),
    );
    await page.click('button[type="submit"]');
    await page.waitForSelector('text=Công ty Nội Thất Mộc Việt');

    await ownerCtx.close();

    // =========================================================================
    // PART 3: 3 Viewports (1440x900, 390x844, 320x640) × 2 Themes (light, dark) + Axe-Core Audit
    // =========================================================================
    const viewports = [
      { name: 'desktop', width: 1440, height: 900, mobile: false },
      { name: 'iphone', width: 390, height: 844, mobile: true },
      { name: 'mobile320', width: 320, height: 640, mobile: true },
    ];
    const themes = ['light', 'dark'];
    const routesToAudit = [
      { path: '/print-quotes/receivables', testId: 'panel-pq-receivables' },
      { path: '/print-quotes/payables', testId: 'panel-pq-payables' },
      { path: '/print-quotes/transactions', testId: 'panel-pq-transactions' },
      { path: '/print-quotes/reports', testId: 'panel-profit-debt' },
      {
        path: '/print-quotes/import-history',
        testId: 'panel-pq-import-history',
      },
      { path: '/print-quotes/orders', testId: 'panel-orders' },
      { path: '/print-quotes/new', testId: 'panel-create-quote' },
    ];

    for (const theme of themes) {
      for (const vp of viewports) {
        const ctx = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          isMobile: vp.mobile,
          hasTouch: vp.mobile,
          deviceScaleFactor: 1,
        });
        await ctx.addInitScript(
          (t) => localStorage.setItem('mglite_theme', t),
          theme,
        );
        const vpPage = await ctx.newPage();
        vpPage.on('pageerror', (e) =>
          pageErrors.push(`[${vp.name}-${theme}] ${e.message}`),
        );

        await vpPage.goto(`${ephemeral.webUrl}/login`, {
          waitUntil: 'networkidle',
        });
        await vpPage.fill('#identifier', ownerUsername);
        await vpPage.fill('#password', passwordPlain);
        await vpPage.click('button[type="submit"]');
        await vpPage.waitForTimeout(600);

        for (const r of routesToAudit) {
          await vpPage.goto(`${ephemeral.webUrl}${r.path}`, {
            waitUntil: 'networkidle',
          });
          await vpPage.waitForSelector(`[data-testid="${r.testId}"]`, {
            timeout: 15000,
          });
          await vpPage.waitForTimeout(200);

          // If on /reports, verify all 3 modes (EXPECTED, RECONCILED, CASH_DEBT)
          if (r.path === '/print-quotes/reports') {
            for (const modeBtn of [
              'pq-report-mode-expected',
              'pq-report-mode-reconciled',
              'pq-report-mode-cash-debt',
            ]) {
              await vpPage.click(`[data-testid="${modeBtn}"]`);
              await vpPage.waitForTimeout(120);
              const mOverflow = await vpPage.evaluate(
                () =>
                  document.documentElement.scrollWidth -
                  document.documentElement.clientWidth,
              );
              assert.ok(
                mOverflow <= 1,
                `[${vp.name}/${theme}/${r.path}/${modeBtn}] Horizontal overflow: ${mOverflow}px`,
              );
            }
          }

          const metrics = await vpPage.evaluate(() => {
            const doc = document.documentElement;
            const overflowX = doc.scrollWidth - doc.clientWidth;
            const pqStorageCount =
              Object.keys(window.localStorage).filter((k) =>
                k.toLowerCase().includes('printquote'),
              ).length +
              Object.keys(window.sessionStorage).filter((k) =>
                k.toLowerCase().includes('printquote'),
              ).length;
            return { overflowX, pqStorageCount };
          });

          assert.ok(
            metrics.overflowX <= 1,
            `[${vp.name}/${theme}/${r.path}] Horizontal overflow: ${metrics.overflowX}px`,
          );
          assert.equal(
            metrics.pqStorageCount,
            0,
            `[${vp.name}/${theme}/${r.path}] Zero browser storage leak required`,
          );

          await vpPage.addScriptTag({ content: axeSource });
          const axeViolations = await vpPage.evaluate(async () => {
            const res = await window.axe.run(document, {
              runOnly: [
                'button-name',
                'link-name',
                'label',
                'select-name',
                'image-alt',
                'color-contrast',
              ],
            });
            return res.violations.map((v) => ({
              id: v.id,
              count: v.nodes.length,
              samples: v.nodes.slice(0, 2).map((n) => n.html.slice(0, 120)),
            }));
          });

          assert.deepEqual(
            axeViolations,
            [],
            `[${vp.name}/${theme}/${r.path}] Axe accessibility/contrast violations: ${JSON.stringify(axeViolations)}`,
          );

          // Capture representative evidence screenshots
          const slug = r.path
            .replace('/print-quotes/', '')
            .replace(/\W+/g, '-');
          if (
            (vp.name === 'desktop' && theme === 'light') ||
            (vp.name === 'iphone' && theme === 'dark') ||
            (vp.name === 'mobile320' &&
              theme === 'dark' &&
              (slug === 'receivables' || slug === 'reports'))
          ) {
            await vpPage.screenshot({
              path: path.join(
                screenshotDir,
                `pq-arap-${slug}-${vp.name}-${theme}.png`,
              ),
              fullPage: true,
            });
          }
        }

        await ctx.close();
      }
    }

    assert.deepEqual(
      pageErrors,
      [],
      `Runtime page errors detected: ${pageErrors.join(' | ')}`,
    );
  } finally {
    if (browser) await browser.close();
    if (ephemeral) await ephemeral.close();
    await pool.end();
  }
});
