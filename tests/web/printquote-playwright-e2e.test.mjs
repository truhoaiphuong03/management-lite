/**
 * Real-Browser Playwright E2E Acceptance & Fail-Closed DB Safety Guard for MGL-PRINTQUOTE V1
 *
 * Strictly isolated from Production:
 *   - NEVER reads process.env.DATABASE_URL, .env DATABASE_URL, or .env.qa-credentials.local.
 *   - Requires TEST_DATABASE_URL + CONFIRM_ISOLATED_TEST_DB=true + CONFIRM_PRINTQUOTE_E2E_RESET=true.
 *   - Blocks production ports (3000, 3001, 3002, 55432), user hp_test_admin, and db management_lite.
 *   - Automatically launches ephemeral Web + API servers on 127.0.0.1:0 backed by TEST_DATABASE_URL
 *     when QA_WEB_URL is not explicitly set, using an isolated test-only Owner credential.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
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

const PROHIBITED_WEB_PORTS = new Set(['3000', '3001', '3002', '55432']);
const PROHIBITED_HOSTS = new Set([
  'hoaiphuong.click',
  'ql.hoaiphuong.click',
  'www.hoaiphuong.click',
]);

export function assertSafePrintQuoteE2ETarget(env = process.env) {
  const dbConfig = loadTestDatabaseConfig(env);
  assertSafeTestDatabase(dbConfig, env);

  const e2eConfirm = (env['CONFIRM_PRINTQUOTE_E2E_RESET'] || '')
    .trim()
    .toLowerCase();
  if (e2eConfirm !== 'true' && e2eConfirm !== '1') {
    throw new Error(
      '[PrintQuote E2E Safety Guard] Missing explicit E2E reset confirmation. Set CONFIRM_PRINTQUOTE_E2E_RESET=true in addition to TEST_DATABASE_URL and CONFIRM_ISOLATED_TEST_DB=true.',
    );
  }

  const rawWebUrl = env['QA_WEB_URL']?.trim();
  if (rawWebUrl) {
    let parsedWeb;
    try {
      parsedWeb = new URL(rawWebUrl);
    } catch {
      throw new Error(
        `[PrintQuote E2E Safety Guard] Invalid QA_WEB_URL: "${rawWebUrl}".`,
      );
    }
    const host = parsedWeb.hostname.toLowerCase();
    const port =
      parsedWeb.port || (parsedWeb.protocol === 'https:' ? '443' : '80');
    if (PROHIBITED_HOSTS.has(host) || host.endsWith('.hoaiphuong.click')) {
      throw new Error(
        `[PrintQuote E2E Safety Guard] Prohibited production hostname "${host}" in QA_WEB_URL.`,
      );
    }
    if (PROHIBITED_WEB_PORTS.has(port)) {
      throw new Error(
        `[PrintQuote E2E Safety Guard] Prohibited production port "${port}" in QA_WEB_URL. E2E must use an isolated staging/ephemeral port.`,
      );
    }
  }

  return dbConfig;
}

async function verifyAndResetPrintQuoteTablesInTestDb(pool, env = process.env) {
  const dbConfig = assertSafePrintQuoteE2ETarget(env);

  const identityRes = await pool.query(
    `SELECT current_database() AS db, inet_server_port() AS port, current_user AS usr`,
  );
  const row = identityRes.rows[0] || {};
  const dbName = String(row.db || '').trim();
  const serverPort = Number(row.port || 0);
  const dbUser = String(row.usr || '')
    .trim()
    .toLowerCase();

  const isLinuxCiContainer =
    env['GITHUB_ACTIONS'] === 'true' &&
    process.platform === 'linux' &&
    dbUser === 'ci_test';
  if (serverPort === 55432 && !isLinuxCiContainer) {
    throw new Error(
      `[PrintQuote E2E Safety Guard] Runtime PostgreSQL server port is 55432 (Production). Aborting DELETE immediately.`,
    );
  }
  if (dbUser === 'hp_test_admin') {
    throw new Error(
      `[PrintQuote E2E Safety Guard] Runtime PostgreSQL user is "hp_test_admin" (Production). Aborting DELETE immediately.`,
    );
  }
  if (
    dbName.toLowerCase() === 'management_lite' ||
    !/(?:^test_|_test$|[-_]test[-_]|_test_|\btest\b)/i.test(dbName)
  ) {
    throw new Error(
      `[PrintQuote E2E Safety Guard] Runtime PostgreSQL database "${dbName}" is not a verified test database. Aborting DELETE immediately.`,
    );
  }

  assertSafeTestDatabase(dbConfig, env);

  await pool.query(`
    DELETE FROM print_order_payments;
    DELETE FROM print_orders;
    DELETE FROM print_quote_versions;
    DELETE FROM print_quotes;
    DELETE FROM print_vendor_price_items;
    DELETE FROM print_customers;
    DELETE FROM print_vendors;
    DELETE FROM print_code_counters;
  `);
}

async function ensureIsolatedTestOwner(pool, testOwnerPassword) {
  const passwordHash = await hashPassword(testOwnerPassword);

  const wsRes = await pool.query(
    `SELECT id FROM workspaces WHERE status = 'active' ORDER BY created_at ASC LIMIT 1`,
  );
  let workspaceId;
  if (wsRes.rows.length > 0) {
    workspaceId = wsRes.rows[0].id;
    await pool.query(
      `UPDATE workspaces SET name = 'Hoài Phương Media' WHERE id = $1`,
      [workspaceId],
    );
  } else {
    workspaceId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO workspaces (id, name, timezone, status)
       VALUES ($1, 'Hoài Phương Media', 'Asia/Ho_Chi_Minh', 'active')`,
      [workspaceId],
    );
  }

  const userRes = await pool.query(
    `SELECT id FROM users WHERE username_normalized = 'owner' LIMIT 1`,
  );
  let ownerUserId;
  if (userRes.rows.length > 0) {
    ownerUserId = userRes.rows[0].id;
    await pool.query(`UPDATE users SET status = 'active' WHERE id = $1`, [
      ownerUserId,
    ]);
    await pool.query(
      `INSERT INTO user_credentials (user_id, password_hash, credential_version)
       VALUES ($1, $2, 1)
       ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [ownerUserId, passwordHash],
    );
  } else {
    ownerUserId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO users (id, username_normalized, email_normalized, status)
       VALUES ($1, 'owner', 'owner@isolated-test.local', 'active')`,
      [ownerUserId],
    );
    await pool.query(
      `INSERT INTO user_credentials (user_id, password_hash, credential_version)
       VALUES ($1, $2, 1)`,
      [ownerUserId, passwordHash],
    );
  }

  const memCheck = await pool.query(
    `SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
    [workspaceId, ownerUserId],
  );
  if (memCheck.rows.length > 0) {
    await pool.query(
      `UPDATE workspace_memberships SET role = 'owner', status = 'active' WHERE id = $1`,
      [memCheck.rows[0].id],
    );
  } else {
    await pool.query(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status)
       VALUES ($1, $2, $3, 'owner', 'active')`,
      [crypto.randomUUID(), workspaceId, ownerUserId],
    );
  }

  const bindCheck = await pool.query(
    `SELECT user_id FROM user_workspace_bindings WHERE user_id = $1 LIMIT 1`,
    [ownerUserId],
  );
  if (bindCheck.rows.length > 0) {
    await pool.query(
      `UPDATE user_workspace_bindings SET workspace_id = $2, status = 'active' WHERE user_id = $1`,
      [ownerUserId, workspaceId],
    );
  } else {
    await pool.query(
      `INSERT INTO user_workspace_bindings (user_id, workspace_id, status, version)
       VALUES ($1, $2, 'active', 1)`,
      [ownerUserId, workspaceId],
    );
  }

  const empCheck = await pool.query(
    `SELECT id FROM employees WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
    [workspaceId, ownerUserId],
  );
  if (empCheck.rows.length > 0) {
    await pool.query(
      `UPDATE employees SET phone = '0909123456', employment_status = 'active' WHERE id = $1`,
      [empCheck.rows[0].id],
    );
  } else {
    await pool.query(
      `INSERT INTO employees (id, workspace_id, user_id, employee_code, full_name, phone, employment_status)
       VALUES ($1, $2, $3, 'OWN01', 'Chủ sở hữu (Test)', '0909123456', 'active')`,
      [crypto.randomUUID(), workspaceId, ownerUserId],
    );
  }
}

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

async function startEphemeralStagingServers(pool) {
  const distDir = path.resolve(process.cwd(), 'apps/web/dist');
  const indexHtmlPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error(
      `Missing built web assets at ${indexHtmlPath}. Run "npm run build:web" before E2E.`,
    );
  }

  let webOrigin = 'http://127.0.0.1';
  const csrfSecret = 'isolated-printquote-e2e-csrf-secret-32chars!';
  const apiHandlerWithOrigin = createRequestHandler({
    pool,
    isProduction: false,
    csrfSecret,
    allowedOrigins: ['http://127.0.0.1:3000'],
  });

  const apiServer = http.createServer((req, res) => {
    if (req.headers.origin === webOrigin) {
      req.headers.origin = 'http://127.0.0.1:3000';
    }
    apiHandlerWithOrigin(req, res);
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
    apiPort,
    webPort,
    close: async () => {
      await new Promise((resolve) => webServer.close(resolve));
      await new Promise((resolve) => apiServer.close(resolve));
    },
  };
}

function inspectPdfBufferStructure(pdfBuffer) {
  const rawLatin1 = pdfBuffer.toString('latin1');
  const hasPdfHeader = rawLatin1.startsWith('%PDF-');
  const hasTrueTypeOrCidFont =
    rawLatin1.includes('/CIDFontType2') ||
    rawLatin1.includes('/TrueType') ||
    rawLatin1.includes('/ToUnicode');
  const hasFallbackType1HelveticaOnly =
    rawLatin1.includes('/BaseFont /Helvetica') && !hasTrueTypeOrCidFont;

  const mediaBoxMatches = [
    ...rawLatin1.matchAll(
      /\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g,
    ),
  ];
  const pageCountMatch = rawLatin1.match(
    /\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/,
  );
  const pageCount = pageCountMatch
    ? Number(pageCountMatch[1])
    : mediaBoxMatches.length;

  // Decompress all FlateDecode streams to verify ToUnicode CMap & absence of leaked keys
  let decompressedText = '';
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  while ((match = streamRegex.exec(rawLatin1)) !== null) {
    const rawStream = Buffer.from(match[1], 'latin1');
    try {
      const inflated = zlib.inflateSync(rawStream);
      decompressedText += inflated.toString('utf8') + '\n';
    } catch {
      // Not a raw zlib stream
    }
  }

  return {
    hasPdfHeader,
    byteLength: pdfBuffer.length,
    hasTrueTypeOrCidFont,
    hasFallbackType1HelveticaOnly,
    pageCount,
    mediaBoxes: mediaBoxMatches.map((m) => [
      Number(m[1]),
      Number(m[2]),
      Number(m[3]),
      Number(m[4]),
    ]),
    decompressedText,
  };
}

test('Task WIN-1: Fail-Closed E2E Safety Guard — Rejects DATABASE_URL fallback, Production ports/users, and unconfirmed E2E reset', () => {
  // 1. Rejects when TEST_DATABASE_URL is missing even if DATABASE_URL is present
  assert.throws(
    () =>
      assertSafePrintQuoteE2ETarget({
        DATABASE_URL:
          'postgresql://hp_test_admin:secret@127.0.0.1:55432/management_lite',
        CONFIRM_ISOLATED_TEST_DB: 'true',
        CONFIRM_PRINTQUOTE_E2E_RESET: 'true',
      }),
    /TEST_DATABASE_URL is not set/,
  );

  // 2. Rejects when CONFIRM_PRINTQUOTE_E2E_RESET is missing
  assert.throws(
    () =>
      assertSafePrintQuoteE2ETarget({
        TEST_DATABASE_URL:
          'postgresql://ml_test_admin:secret@127.0.0.1:55433/management_lite_printquote_test',
        CONFIRM_ISOLATED_TEST_DB: 'true',
      }),
    /Missing explicit E2E reset confirmation/,
  );

  // 3. Rejects Production port 55432
  assert.throws(
    () =>
      assertSafePrintQuoteE2ETarget({
        TEST_DATABASE_URL:
          'postgresql://ml_test_admin:secret@127.0.0.1:55432/management_lite_printquote_test',
        CONFIRM_ISOLATED_TEST_DB: 'true',
        CONFIRM_PRINTQUOTE_E2E_RESET: 'true',
        GITHUB_ACTIONS: 'false',
      }),
    /port 55432/,
  );

  // 4. Rejects Production user hp_test_admin
  assert.throws(
    () =>
      assertSafePrintQuoteE2ETarget({
        TEST_DATABASE_URL:
          'postgresql://hp_test_admin:secret@127.0.0.1:55433/management_lite_printquote_test',
        CONFIRM_ISOLATED_TEST_DB: 'true',
        CONFIRM_PRINTQUOTE_E2E_RESET: 'true',
      }),
    /hp_test_admin/,
  );

  // 5. Rejects QA_WEB_URL pointing to Production port 3001 or domain ql.hoaiphuong.click
  assert.throws(
    () =>
      assertSafePrintQuoteE2ETarget({
        TEST_DATABASE_URL:
          'postgresql://ml_test_admin:secret@127.0.0.1:55433/management_lite_printquote_test',
        CONFIRM_ISOLATED_TEST_DB: 'true',
        CONFIRM_PRINTQUOTE_E2E_RESET: 'true',
        QA_WEB_URL: 'http://localhost:3001',
      }),
    /Prohibited production port "3001"/,
  );

  assert.throws(
    () =>
      assertSafePrintQuoteE2ETarget({
        TEST_DATABASE_URL:
          'postgresql://ml_test_admin:secret@127.0.0.1:55433/management_lite_printquote_test',
        CONFIRM_ISOLATED_TEST_DB: 'true',
        CONFIRM_PRINTQUOTE_E2E_RESET: 'true',
        QA_WEB_URL: 'https://ql.hoaiphuong.click',
      }),
    /Prohibited production hostname/,
  );
});

async function prepareE2ERuntimeEnv() {
  if (
    process.env.GITHUB_ACTIONS === 'true' &&
    process.env.CI === 'true' &&
    process.platform === 'linux' &&
    process.env.CI_DATABASE_PASSWORD &&
    !process.env.TEST_DATABASE_URL
  ) {
    const ciAdminUrl = new URL('postgresql://ci_test@127.0.0.1:55432/postgres');
    ciAdminUrl.password = process.env.CI_DATABASE_PASSWORD;
    const ciAdminPool = createDatabasePool({
      connectionString: ciAdminUrl.href,
      max: 2,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 5000,
    });
    const ciDbName = 'management_lite_printquote_ci_test';
    try {
      const checkDb = await ciAdminPool.query(
        `SELECT 1 FROM pg_database WHERE datname = $1`,
        [ciDbName],
      );
      if (checkDb.rows.length === 0) {
        await ciAdminPool.query(`CREATE DATABASE ${ciDbName}`);
      }
    } finally {
      await ciAdminPool.end();
    }
    const ciTargetUrl = new URL(ciAdminUrl.href);
    ciTargetUrl.pathname = `/${ciDbName}`;
    return {
      ...process.env,
      TEST_DATABASE_URL: ciTargetUrl.href,
      CONFIRM_ISOLATED_TEST_DB: 'true',
      CONFIRM_PRINTQUOTE_E2E_RESET: 'true',
    };
  }
  return process.env;
}

test('Task QA-03 & WIN-3/WIN-4: Real-Browser Playwright E2E — Full 12-Step PrintQuote Workflow, Vietnamese Unicode A4 PDF & Responsive Viewports on Windows', async () => {
  const runtimeEnv = await prepareE2ERuntimeEnv();
  const dbConfig = assertSafePrintQuoteE2ETarget(runtimeEnv);
  const artifactDir =
    runtimeEnv.QA_ARTIFACT_DIR ||
    path.resolve(process.cwd(), '.artifacts', 'printquote-win-qa');
  fs.mkdirSync(artifactDir, { recursive: true });

  const testOwnerPassword =
    runtimeEnv.QA_OWNER_PASSWORD || 'TestOwnerPrintQuote#2026!';
  const pool = createDatabasePool(dbConfig);

  let ephemeralServers = null;
  let browser = null;

  try {
    await runMigrations(
      pool,
      loadMigrationFiles('packages/database/src/migrations'),
    );
    await ensureIsolatedTestOwner(pool, testOwnerPassword);
    await verifyAndResetPrintQuoteTablesInTestDb(pool, runtimeEnv);

    let targetWebUrl = runtimeEnv.QA_WEB_URL?.trim();
    if (!targetWebUrl) {
      ephemeralServers = await startEphemeralStagingServers(pool);
      targetWebUrl = ephemeralServers.webUrl;
    }

    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 1120 },
      acceptDownloads: true,
    });
    const page = await context.newPage();

    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // Step 1: Login as Owner
    await page.goto(`${targetWebUrl}/login`, { waitUntil: 'networkidle' });
    await page.fill('#identifier', 'owner');
    await page.fill('#password', testOwnerPassword);
    await page.click('button[type="submit"]');

    const navPrintQuoteBtn =
      'nav[aria-label="Desktop navigation"] button:has-text("Báo giá in ấn")';
    await page.waitForSelector(navPrintQuoteBtn, { timeout: 15000 });

    // Step 2: Open menu "Báo giá in ấn"
    await page.click(navPrintQuoteBtn);
    await page.waitForSelector('[data-testid="printquote-screen"]', {
      timeout: 10000,
    });

    // Step 3: Create Vendor, Price Catalog Item, and Customer (under group Danh mục)
    await page.click('[data-testid="pq-nav-group-catalog"]');
    await page.waitForSelector('[data-testid="panel-vendors-catalog"]');

    await page.fill(
      'input[aria-label="Tên nhà in"]',
      'Nhà in Offset Sài Gòn Chuẩn',
    );
    await page.fill('input[aria-label="Số điện thoại nhà in"]', '0908111222');
    await page.fill('input[aria-label="Ngân hàng nhà in"]', 'Vietcombank');
    await page.fill('input[aria-label="Số tài khoản nhà in"]', '0071000888999');
    await page.click('button:has-text("+ Thêm Nhà in")');
    await page.waitForSelector('text=Nhà in Offset Sài Gòn Chuẩn');

    await page.fill(
      'input[aria-label="Tên hạng mục bảng giá"]',
      'Tờ rơi A5 Couche 150gsm',
    );
    await page.fill(
      'input[aria-label="Quy cách in bảng giá"]',
      'In Offset 2 mặt 4 màu, cán bóng',
    );
    await page.fill('input[aria-label="Đơn giá vốn nhà in"]', '300');
    await page.fill('input[aria-label="Lợi nhuận mặc định"]', '200');
    await page.click('button:has-text("+ Lưu vào Bảng giá")');
    await page.waitForSelector('text=Tờ rơi A5 Couche 150gsm');

    await page.screenshot({
      path: path.join(artifactDir, 'qa03-01-desktop-vendors-catalog.png'),
      fullPage: false,
    });

    await page.click('[data-testid="tab-customers"]');
    await page.waitForSelector('[data-testid="panel-customers"]');

    await page.fill(
      'input[aria-label="Tên khách hàng"]',
      'Anh Minh — Chuỗi Trà Sữa Sài Gòn',
    );
    await page.fill(
      'input[aria-label="Tên công ty khách hàng"]',
      'Công ty TNHH F&B Minh Phát',
    );
    await page.fill(
      'input[aria-label="Số điện thoại khách hàng"]',
      '0912333444',
    );
    await page.fill(
      'input[aria-label="Địa chỉ giao hàng"]',
      '123 Nguyễn Huệ, Quận 1, TP.HCM',
    );
    await page.click('button:has-text("+ Thêm Khách hàng")');
    await page.waitForSelector('text=Anh Minh — Chuỗi Trà Sữa Sài Gòn');

    await page.screenshot({
      path: path.join(artifactDir, 'qa03-02-desktop-customers.png'),
      fullPage: false,
    });

    // Step 4 & 5: Create Quote 100 tờ (vốn 300đ/tờ, lời 200đ/tờ, ship toàn đơn 50.000đ) -> Verify 1.000đ/tờ & 100.000đ
    await page.click('[data-testid="pq-nav-group-quotes"]');
    await page.waitForSelector('[data-testid="panel-create-quote"]');

    await page.fill(
      '[data-testid="pq-title-input"]',
      'Báo giá in Tờ rơi A5 khai trương Chuỗi Trà Sữa Sài Gòn',
    );

    const custSelect = page.locator('[data-testid="pq-customer-select"]');
    const custOptionVal = await custSelect
      .locator('option')
      .nth(1)
      .getAttribute('value');
    assert.ok(custOptionVal, 'Customer option must exist');
    await custSelect.selectOption(custOptionVal);

    const catalogSelect = page.locator(
      'select[aria-label="Chọn bảng giá nhà in dòng 1"]',
    );
    const catalogOptionVal = await catalogSelect
      .locator('option')
      .nth(1)
      .getAttribute('value');
    assert.ok(catalogOptionVal, 'Catalog item option must exist');
    await catalogSelect.selectOption(catalogOptionVal);

    // Step 6: Verify profit modes (PERCENTAGE, PER_UNIT, TOTAL_BATCH) & vendor cost modes (PER_UNIT, TOTAL_BATCH)
    await page.fill('input[aria-label="Số lượng dòng 1"]', '100');
    await page.selectOption(
      'select[aria-label="Kiểu giá vốn dòng 1"]',
      'TOTAL_BATCH',
    );
    await page.fill('input[aria-label="Giá trị giá vốn dòng 1"]', '30000');
    await page.selectOption(
      'select[aria-label="Kiểu lợi nhuận dòng 1"]',
      'PERCENTAGE',
    );
    await page.fill('input[aria-label="Giá trị lợi nhuận dòng 1"]', '50');
    await page.fill('[data-testid="pq-shipping-input"]', '50000');
    // 30.000 vốn + 50% lời (15.000) + 50.000 ship = 95.000 ₫
    assert.match(
      await page.textContent('[data-testid="pq-summary-profit"]'),
      /15\.000/,
    );
    assert.match(
      await page.textContent('[data-testid="pq-summary-total"]'),
      /95\.000/,
    );

    // Test FIXED_AMOUNT + TOTAL_BATCH profit (trọn lô 20.000đ)
    await page.selectOption(
      'select[aria-label="Kiểu lợi nhuận dòng 1"]',
      'FIXED_AMOUNT',
    );
    await page.selectOption(
      'select[aria-label="Phạm vi lợi nhuận dòng 1"]',
      'TOTAL_BATCH',
    );
    await page.fill('input[aria-label="Giá trị lợi nhuận dòng 1"]', '20000');
    assert.match(
      await page.textContent('[data-testid="pq-summary-profit"]'),
      /20\.000/,
    );
    assert.match(
      await page.textContent('[data-testid="pq-summary-total"]'),
      /100\.000/,
    );

    // Step 7: Test multi-item & rounding in UI (add 2nd line item, verify line 1 auto-collapses, verify shipping charged only once, then remove 2nd line)
    await page.click('[data-testid="pq-add-line-btn"]');
    await page.waitForSelector('[data-testid="pq-line-card-1"]');
    await page.waitForSelector('[data-testid="pq-line-collapsed-0"]');
    await page.fill(
      'input[aria-label="Tên sản phẩm dòng 2"]',
      'Voucher giảm giá 20%',
    );
    await page.fill('input[aria-label="Số lượng dòng 2"]', '3');
    await page.fill('input[aria-label="Giá trị giá vốn dòng 2"]', '10000');
    await page.fill('input[aria-label="Giá trị lợi nhuận dòng 2"]', '5000');
    // Line 1 base = 50.000, Line 2 base = 45.000, Shipping (1 lần) = 50.000 -> Total = 145.000 ₫
    assert.match(
      await page.textContent('[data-testid="pq-summary-shipping"]'),
      /50\.000/,
    );
    assert.match(
      await page.textContent('[data-testid="pq-summary-total"]'),
      /145\.000/,
    );
    await page.screenshot({
      path: path.join(artifactDir, 'qa03-03b-desktop-multi-item-collapsed.png'),
      fullPage: false,
    });
    // Remove 2nd line to return to canonical 100 tờ quote (Line 1 automatically re-expands)
    await page.click(
      '[data-testid="pq-line-card-1"] button:has-text("Xóa dòng")',
    );

    // Canonical Step 4 & 5 configuration: 100 tờ, vốn 300đ/tờ, lời 200đ/tờ, ship 50.000đ
    await page.selectOption(
      'select[aria-label="Kiểu giá vốn dòng 1"]',
      'PER_UNIT',
    );
    await page.fill('input[aria-label="Giá trị giá vốn dòng 1"]', '300');
    await page.selectOption(
      'select[aria-label="Kiểu lợi nhuận dòng 1"]',
      'FIXED_AMOUNT',
    );
    await page.selectOption(
      'select[aria-label="Phạm vi lợi nhuận dòng 1"]',
      'PER_UNIT',
    );
    await page.fill('input[aria-label="Giá trị lợi nhuận dòng 1"]', '200');
    await page.fill('[data-testid="pq-shipping-input"]', '50000');
    await page.fill(
      '#pq-customer-notes',
      'Báo giá đã bao gồm thiết kế file in & giao hàng tận nơi nội thành TP.HCM.',
    );

    const vendorCostText = await page.textContent(
      '[data-testid="pq-summary-vendor-cost"]',
    );
    const profitText = await page.textContent(
      '[data-testid="pq-summary-profit"]',
    );
    const shippingText = await page.textContent(
      '[data-testid="pq-summary-shipping"]',
    );
    const totalText = await page.textContent(
      '[data-testid="pq-summary-total"]',
    );
    const customerCardText = await page.textContent(
      '[data-testid="pq-customer-safe-card"]',
    );

    assert.match(vendorCostText, /30\.000/);
    assert.match(profitText, /20\.000/);
    assert.match(shippingText, /50\.000/);
    assert.match(totalText, /100\.000/);
    assert.match(customerCardText, /1\.000\s*₫/);
    assert.match(customerCardText, /100\.000\s*₫/);
    assert.match(customerCardText, /Một trăm nghìn đồng chẵn/);

    // Step 8: Save Quote (v1)
    await page.click('[data-testid="pq-save-quote-btn"]');
    await page.waitForSelector(
      '[data-testid="printquote-banner"]:has-text("Đã lưu thành công báo giá")',
    );

    const bannerAfterSave = await page.textContent(
      '[data-testid="printquote-banner"]',
    );
    const codeMatch = bannerAfterSave.match(/(BG-\d{6}-\d{3})/);
    assert.ok(codeMatch, `Expected quote code in banner: ${bannerAfterSave}`);
    const savedQuoteCode = codeMatch[1];

    await page.evaluate(() => {
      document
        .getElementById('pq-sec-products')
        ?.scrollIntoView({ block: 'start' });
    });
    await page.screenshot({
      path: path.join(artifactDir, 'qa03-03-desktop-create-quote-100k.png'),
      fullPage: false,
    });

    // Step 9 & PHASE WIN-4: Download direct .PDF file & verify Windows Chromium PDF A4 structure
    const downloadPromise = page.waitForEvent('download');
    await page.click('[data-testid="pq-download-pdf-btn"]');
    const download = await downloadPromise;
    const suggestedFilename = download.suggestedFilename();
    assert.equal(suggestedFilename, `${savedQuoteCode}.pdf`);

    const savedPdfPath = path.join(artifactDir, suggestedFilename);
    await download.saveAs(savedPdfPath);
    const sampleAliasPdfPath = path.join(
      artifactDir,
      'MGL-PrintQuote-Bao-Gia-Mau-A4.pdf',
    );
    fs.copyFileSync(savedPdfPath, sampleAliasPdfPath);

    const pdfBytes = fs.readFileSync(savedPdfPath);
    const pdfInspection = inspectPdfBufferStructure(pdfBytes);
    assert.equal(
      pdfInspection.hasPdfHeader,
      true,
      'Downloaded file must start with %PDF-',
    );
    assert.ok(
      pdfInspection.byteLength > 10000,
      `Expected real Chromium A4 PDF with embedded Unicode fonts (>10KB), got ${pdfInspection.byteLength} bytes`,
    );
    assert.equal(
      pdfInspection.hasTrueTypeOrCidFont,
      true,
      'PDF must embed TrueType/CIDFontType2 + ToUnicode for Vietnamese diacritics',
    );
    assert.equal(
      pdfInspection.hasFallbackType1HelveticaOnly,
      false,
      'PDF must NEVER use the ASCII Helvetica fallback that strips Vietnamese diacritics',
    );
    assert.equal(
      pdfInspection.pageCount,
      1,
      'Single-page quote PDF must fit cleanly on 1 A4 page without overflow',
    );
    if (pdfInspection.mediaBoxes.length > 0) {
      const [, , w, h] = pdfInspection.mediaBoxes[0];
      // A4 portrait is ~595 x 842 pt
      assert.ok(
        Math.abs(w - 595) <= 5 && Math.abs(h - 842) <= 5,
        `Expected A4 portrait MediaBox (~595x842 pt), got [${w}, ${h}]`,
      );
    }
    assert.ok(
      !pdfInspection.decompressedText.includes('vendorCost') &&
        !pdfInspection.decompressedText.includes('totalProfit'),
      'PDF binary streams must not contain vendor cost or profit keys',
    );

    // Also render the saved PDF in a new browser tab to capture a visual proof screenshot of the actual PDF file
    const pdfPage = await context.newPage();
    await pdfPage.goto(pathToFileURL(savedPdfPath).href, {
      waitUntil: 'load',
    });
    await pdfPage.waitForTimeout(800);
    await pdfPage.screenshot({
      path: path.join(artifactDir, 'qa03-04b-windows-real-pdf-file-render.png'),
    });
    await pdfPage.close();

    // Open PDF A4 Preview Modal & verify Vietnamese content + no leak + no overflow
    await page.click('[data-testid="pq-preview-pdf-btn"]');
    await page.waitForSelector('[data-testid="pq-pdf-modal"]');
    const iframeSrcDoc =
      (await page
        .locator('[data-testid="pq-pdf-modal"] iframe')
        .getAttribute('srcdoc')) ||
      (await page.textContent('[data-testid="pq-pdf-modal"]'));
    assert.match(iframeSrcDoc, /BẢNG BÁO GIÁ/);
    assert.match(iframeSrcDoc, /Tờ rơi A5 Couche 150gsm/);
    assert.match(iframeSrcDoc, /1\.000\s*₫/);
    assert.match(iframeSrcDoc, /100\.000\s*₫/);
    assert.match(iframeSrcDoc, /Một trăm nghìn đồng chẵn/);
    assert.ok(
      !iframeSrcDoc.includes('30.000') && !iframeSrcDoc.includes('20.000'),
      'PDF A4 preview must not leak vendor cost (30.000) or profit (20.000)',
    );
    await page.screenshot({
      path: path.join(artifactDir, 'qa03-04-desktop-pdf-a4-preview.png'),
    });
    await page.click('[data-testid="pq-pdf-modal"] button:has-text("Đóng")');
    await page.waitForSelector('[data-testid="pq-pdf-modal"]', {
      state: 'detached',
    });

    // Step 8 (continued): Go to Tab 2 (Danh sách báo giá), reopen the saved quote into the editor, and verify fields
    await page.click('[data-testid="tab-quotes-list"]');
    await page.waitForSelector('[data-testid="panel-quotes-list"]');
    const quoteRow = page.locator(
      `[data-testid="quote-row-${savedQuoteCode}"]`,
    );
    await quoteRow.waitFor({ state: 'visible' });

    await page.screenshot({
      path: path.join(artifactDir, 'qa03-05-desktop-quotes-list.png'),
      fullPage: false,
    });

    await quoteRow.locator('button:has-text("Sửa / Tạo phiên bản")').click();
    await page.waitForSelector('[data-testid="panel-create-quote"]');
    assert.equal(
      await page.inputValue('[data-testid="pq-title-input"]'),
      'Báo giá in Tờ rơi A5 khai trương Chuỗi Trà Sữa Sài Gòn',
    );
    assert.equal(
      await page.inputValue('input[aria-label="Số lượng dòng 1"]'),
      '100',
    );

    // Step 10: Return to Tab 2 & Convert Quote to Order (and verify duplicate conversion prevention)
    await page.click('[data-testid="tab-quotes-list"]');
    await page.waitForSelector(`[data-testid="quote-row-${savedQuoteCode}"]`);
    await page.click(`[data-testid="pq-convert-order-btn-${savedQuoteCode}"]`);
    await page.waitForSelector('[data-testid="panel-orders"]');

    // Step 11: On Tab 5 (Đơn hàng): Test Deposit (40.000 ₫), Installment (30.000 ₫), Final (30.000 ₫), Refund (10.000 ₫), and Final settlement (10.000 ₫ -> Debt 0 ₫)
    const orderCard = page.locator('[data-testid^="order-card-"]').first();
    await orderCard.waitFor({ state: 'visible' });
    const orderTestId = await orderCard.getAttribute('data-testid');
    const savedOrderCode = orderTestId.replace('order-card-', '');

    // 11a. Record Deposit = 40.000 ₫ -> Paid 40.000 ₫, Debt 60.000 ₫
    await page.click(
      `[data-testid="pq-order-record-payment-${savedOrderCode}"]`,
    );
    await page.waitForSelector(
      'div[role="dialog"][aria-label="Ghi nhận thanh toán đơn hàng"]',
    );
    await page.selectOption('select[aria-label="Loại thanh toán"]', 'DEPOSIT');
    await page.fill('input[aria-label="Số tiền thanh toán"]', '40000');
    await page.fill(
      'input[aria-label="Ghi chú thanh toán"]',
      'Khách chuyển khoản đặt cọc 40%',
    );
    await page.click('button:has-text("Xác nhận thu tiền")');

    await page.waitForFunction((code) => {
      const el = document.querySelector(`[data-testid="order-card-${code}"]`);
      return el && el.textContent && el.textContent.includes('40.000');
    }, savedOrderCode);
    assert.match(await orderCard.textContent(), /40\.000\s*₫/);
    assert.match(await orderCard.textContent(), /60\.000\s*₫/);

    // 11b. Record Installment = 30.000 ₫ -> Paid 70.000 ₫, Debt 30.000 ₫
    await page.click(
      `[data-testid="pq-order-record-payment-${savedOrderCode}"]`,
    );
    await page.waitForSelector(
      'div[role="dialog"][aria-label="Ghi nhận thanh toán đơn hàng"]',
    );
    await page.selectOption(
      'select[aria-label="Loại thanh toán"]',
      'INSTALLMENT',
    );
    await page.fill('input[aria-label="Số tiền thanh toán"]', '30000');
    await page.fill(
      'input[aria-label="Ghi chú thanh toán"]',
      'Thanh toán đợt 2 khi duyệt bài in',
    );
    await page.click('button:has-text("Xác nhận thu tiền")');
    await page.waitForFunction((code) => {
      const el = document.querySelector(`[data-testid="order-card-${code}"]`);
      return el && el.textContent && el.textContent.includes('70.000');
    }, savedOrderCode);

    // 11c. Record Refund = 10.000 ₫ -> Paid 60.000 ₫, Debt 40.000 ₫
    await page.click(
      `[data-testid="pq-order-record-payment-${savedOrderCode}"]`,
    );
    await page.waitForSelector(
      'div[role="dialog"][aria-label="Ghi nhận thanh toán đơn hàng"]',
    );
    await page.selectOption('select[aria-label="Loại thanh toán"]', 'REFUND');
    await page.fill('input[aria-label="Số tiền thanh toán"]', '10000');
    await page.fill(
      'input[aria-label="Ghi chú thanh toán"]',
      'Hoàn tiền chiết khấu khách thân thiết',
    );
    await page.click('button:has-text("Xác nhận thu tiền")');
    await page.waitForFunction((code) => {
      const el = document.querySelector(`[data-testid="order-card-${code}"]`);
      return el && el.textContent && el.textContent.includes('60.000');
    }, savedOrderCode);

    // Update Production Status -> COMPLETED, Delivery Status -> DELIVERED
    await page.selectOption(
      `select[aria-label="Trạng thái sản xuất ${savedOrderCode}"]`,
      'COMPLETED',
    );
    await page.waitForFunction((code) => {
      const el = document.querySelector(`[data-testid="order-card-${code}"]`);
      return (
        el && el.textContent && el.textContent.includes('SX: Hoàn tất sản xuất')
      );
    }, savedOrderCode);

    await page.selectOption(
      `select[aria-label="Trạng thái giao hàng ${savedOrderCode}"]`,
      'DELIVERED',
    );
    await page.waitForFunction((code) => {
      const el = document.querySelector(`[data-testid="order-card-${code}"]`);
      return (
        el &&
        el.textContent &&
        el.textContent.includes('Giao: Đã giao thành công')
      );
    }, savedOrderCode);

    // 11d. Record Final Settlement = 40.000 ₫ -> Paid 100.000 ₫, Debt = 0 ₫, Status = Đã tất toán
    await page.click(
      `[data-testid="pq-order-record-payment-${savedOrderCode}"]`,
    );
    await page.waitForSelector(
      'div[role="dialog"][aria-label="Ghi nhận thanh toán đơn hàng"]',
    );
    await page.selectOption('select[aria-label="Loại thanh toán"]', 'FINAL');
    await page.fill('input[aria-label="Số tiền thanh toán"]', '40000');
    await page.fill(
      'input[aria-label="Ghi chú thanh toán"]',
      'Khách tất toán đủ khi nhận hàng',
    );
    await page.click('button:has-text("Xác nhận thu tiền")');

    await page.waitForSelector(
      'div[role="dialog"][aria-label="Ghi nhận thanh toán đơn hàng"]',
      { state: 'detached' },
    );

    await page.waitForFunction((code) => {
      const el = document.querySelector(`[data-testid="order-card-${code}"]`);
      return el && el.textContent && el.textContent.includes('Đã tất toán');
    }, savedOrderCode);

    const cardAfterSettlement = await orderCard.textContent();
    assert.match(cardAfterSettlement, /Đã tất toán/);
    assert.match(cardAfterSettlement, /SX:\s*Hoàn tất sản xuất/);
    assert.match(cardAfterSettlement, /Giao:\s*Đã giao thành công/);

    await page.screenshot({
      path: path.join(artifactDir, 'qa03-06-desktop-orders-paid.png'),
      fullPage: false,
    });

    // Check Tab 6 (Lợi nhuận & Công nợ)
    await page.click('[data-testid="pq-nav-group-analytics"]');
    await page.waitForSelector('[data-testid="panel-profit-debt"]');
    const analyticsText = await page.textContent(
      '[data-testid="panel-profit-debt"]',
    );
    assert.match(analyticsText, /100\.000\s*₫/);
    assert.match(analyticsText, /20\.000\s*₫/);
    assert.match(analyticsText, /0\s*₫/);

    await page.screenshot({
      path: path.join(artifactDir, 'qa03-07-desktop-analytics.png'),
      fullPage: false,
    });

    // Logout & Login again -> Verify data persists and duplicate order conversion is blocked
    await page.click('button[aria-label="Đăng xuất"]');
    await page.waitForSelector('#identifier', { timeout: 10000 });

    await page.fill('#identifier', 'owner');
    await page.fill('#password', testOwnerPassword);
    await page.click('button[type="submit"]');
    await page.waitForSelector(navPrintQuoteBtn, { timeout: 15000 });

    await page.click(navPrintQuoteBtn);
    await page.waitForSelector('[data-testid="printquote-screen"]');

    await page.click('[data-testid="tab-quotes-list"]');
    await page.waitForSelector(`[data-testid="quote-row-${savedQuoteCode}"]`);
    const convertedBadge = await page.textContent(
      `[data-testid="pq-quote-converted-badge-${savedQuoteCode}"]`,
    );
    assert.match(convertedBadge, /Đã chuyển đơn in/);
    assert.equal(
      await page
        .locator(`[data-testid="pq-convert-order-btn-${savedQuoteCode}"]`)
        .count(),
      0,
      'Convert to Order button must be removed after quote is converted to prevent duplicates',
    );

    await page.click('[data-testid="pq-nav-group-orders"]');
    await page.waitForSelector(`[data-testid="order-card-${savedOrderCode}"]`);

    // Step 12: Verify iPhone viewport (390x844) & no horizontal overflow
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('[data-testid="pq-nav-group-quotes"]');
    await page.waitForSelector('[data-testid="panel-create-quote"]');

    const mobileOverflowCreate = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
      );
    });
    assert.equal(
      mobileOverflowCreate,
      false,
      'Mobile iPhone 390px view on Create Quote must not overflow horizontally',
    );

    await page.screenshot({
      path: path.join(artifactDir, 'qa03-08-iphone-create-quote.png'),
      fullPage: false,
    });

    await page.click('[data-testid="pq-nav-group-orders"]');
    await page.waitForSelector('[data-testid="panel-orders"]');

    const mobileOverflowOrders = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
      );
    });
    assert.equal(
      mobileOverflowOrders,
      false,
      'Mobile iPhone 390px view on Orders must not overflow horizontally',
    );

    await page.screenshot({
      path: path.join(artifactDir, 'qa03-09-iphone-orders.png'),
      fullPage: false,
    });

    // Also verify 320px ultra-compact mobile viewport has zero horizontal overflow
    await page.setViewportSize({ width: 320, height: 740 });
    await page.click('[data-testid="pq-nav-group-quotes"]');
    await page.waitForSelector('[data-testid="panel-create-quote"]');
    const overflow320Create = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
      );
    });
    assert.equal(
      overflow320Create,
      false,
      '320px compact mobile view on Create Quote must not overflow horizontally',
    );
    await page.screenshot({
      path: path.join(artifactDir, 'qa03-10-mobile-320px-create-quote.png'),
      fullPage: false,
    });

    assert.equal(
      pageErrors.length,
      0,
      `Expected 0 uncaught page errors, got: ${pageErrors.join('; ')}`,
    );

    await context.close();
  } finally {
    if (browser) {
      await browser.close();
    }
    if (ephemeralServers) {
      await ephemeralServers.close();
    }
    await pool.end();
  }
});
