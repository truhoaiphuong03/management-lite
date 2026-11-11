import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright-core';

import { preloadRouteScreen } from '../../dist/apps/web/src/lazy-screens.js';
import {
  PrintQuoteScreen,
  invalidatePrintQuoteClientCache,
} from '../../dist/apps/web/src/screens/PrintQuoteScreen.js';
import { PRINTQUOTE_STYLES } from '../../dist/apps/web/src/screens/printquote/printquote-styles.js';
import { BridgeService } from '../../dist/apps/api/src/bridge/service.js';

const require = createRequire(import.meta.url);
const { createWebServer } = require('../../scripts/runtime/serve-web.cjs');

const ROOT = process.cwd();

function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

test('PERF-02A: preloadRouteScreen resolves route chunks safely and App.tsx preloads in parallel with verifySession', async () => {
  const appSrc = fs.readFileSync(
    path.join(ROOT, 'apps/web/src/App.tsx'),
    'utf8',
  );
  const preloadIdx = appSrc.indexOf(
    'preloadRouteScreen(window.location.pathname)',
  );
  const verifyIdx = appSrc.indexOf('const verified = await verifySession();');
  assert.ok(
    preloadIdx > 0 && verifyIdx > preloadIdx,
    'App.tsx must trigger preloadRouteScreen(window.location.pathname) BEFORE awaiting verifySession()',
  );

  assert.equal(preloadRouteScreen('/login'), null);
  const resolved = await Promise.all([
    preloadRouteScreen('/'),
    preloadRouteScreen('/print-quotes'),
    preloadRouteScreen('/work'),
    preloadRouteScreen('/accounts'),
  ]);
  for (const mod of resolved) {
    assert.ok(mod && typeof mod === 'object');
  }
});

test('PERF-02B: PrintQuoteScreen inline CSS is modularized into printquote-styles.ts while preserving SSR markup', () => {
  const pqScreenPath = path.join(
    ROOT,
    'apps/web/src/screens/PrintQuoteScreen.tsx',
  );
  const pqScreenSrc = fs.readFileSync(pqScreenPath, 'utf8');
  assert.match(
    pqScreenSrc,
    /import\s*\{\s*PRINTQUOTE_STYLES\s*\}\s*from\s*['"]\.\/printquote\/printquote-styles\.js['"]/,
    'PrintQuoteScreen.tsx must import PRINTQUOTE_STYLES from ./printquote/printquote-styles.js',
  );
  const styleTagMatches =
    pqScreenSrc.match(/<style\b[^>]*>[\s\S]*?<\/style>/g) ?? [];
  assert.deepEqual(
    styleTagMatches,
    ['<style>{PRINTQUOTE_STYLES}</style>'],
    'The only JSX <style> tag in PrintQuoteScreen.tsx must reference PRINTQUOTE_STYLES from its module',
  );
  assert.ok(
    PRINTQUOTE_STYLES.includes('.pq-module-nav') &&
      PRINTQUOTE_STYLES.includes('.pq-directory-table') &&
      PRINTQUOTE_STYLES.includes('.pq-orders-todo-strip'),
  );

  invalidatePrintQuoteClientCache();
  const html = renderToStaticMarkup(
    React.createElement(PrintQuoteScreen, {
      role: 'owner',
      currentPath: '/print-quotes',
    }),
  );
  assert.ok(html.includes('data-testid="printquote-screen"'));
  assert.ok(html.includes('<style>'));
  assert.ok(html.includes('.pq-module-nav'));
  assert.ok(html.includes('.pq-directory-table'));
  assert.ok(html.includes('.pq-orders-todo-strip'));
});

test('PERF-02C: BridgeService caches TikTok V4 summary for 60s (< 15ms warm hit) without blocking /dashboard', async (t) => {
  const originalDir = process.cwd();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mglite-bridge-perf-'));
  const prevSecret = process.env.HP_BRIDGE_SECRET;
  const prevUrl = process.env.TIKTOK_V4_BRIDGE_URL;
  process.chdir(tempDir);
  process.env.HP_BRIDGE_SECRET = 'perf-test-secret';
  process.env.TIKTOK_V4_BRIDGE_URL = 'http://127.0.0.1:49998';

  t.after(() => {
    process.chdir(originalDir);
    if (prevSecret === undefined) delete process.env.HP_BRIDGE_SECRET;
    else process.env.HP_BRIDGE_SECRET = prevSecret;
    if (prevUrl === undefined) delete process.env.TIKTOK_V4_BRIDGE_URL;
    else process.env.TIKTOK_V4_BRIDGE_URL = prevUrl;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  let remoteHits = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    remoteHits += 1;
    await new Promise((r) => setTimeout(r, 220));
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: {
          system: 'tiktok-ai-factory-v4',
          domain: 'https://hoaiphuong.click',
          connected_at: '2026-11-07T00:00:00Z',
          workspace: {
            connected: true,
            owner_uid: 'u-1',
            google_account_email: 'owner@example.com',
            drive_root_folder_id: null,
            drive_folders: {},
            spreadsheet_id: null,
          },
          counts: {
            products: 2,
            channels: 3,
            scripts: 4,
            prompts: 5,
            audio_deliverables: 1,
            video_deliverables: 1,
            active_members: 2,
            registered_accounts: 2,
            today_checkins: 1,
          },
          recent_scripts: [],
          channels: [],
          deliverables: [],
        },
      }),
    };
  });

  const pool = {
    query: async (sql) => {
      if (sql.includes('SELECT name FROM workspaces')) {
        return { rows: [{ name: 'THIẾT KẾ IN ẤN TOÀN GIA PHÁT' }] };
      }
      if (sql.includes('COUNT(*)')) return { rows: [{ cnt: '2' }] };
      return { rows: [] };
    },
  };

  const svc = new BridgeService(pool);
  const auth = {
    workspace: { id: 'ws-perf-1', role: 'owner' },
    user: { id: 'owner-1' },
  };

  const t0 = performance.now();
  const first = await svc.getTikTokV4Status(auth);
  const coldMs = performance.now() - t0;
  assert.equal(first.connected, true);
  assert.equal(remoteHits, 1);
  assert.ok(coldMs >= 180, `Expected cold call >= 180ms, got ${coldMs}ms`);

  const t1 = performance.now();
  const second = await svc.getTikTokV4Status(auth);
  const warmMs = performance.now() - t1;
  assert.equal(second.connected, true);
  assert.equal(
    remoteHits,
    1,
    'Second /dashboard status read within 60s must hit memory cache without remote HTTP call',
  );
  assert.ok(
    warmMs < 20,
    `Expected warm BridgeService status read < 20ms, got ${warmMs.toFixed(2)}ms`,
  );

  svc.invalidateSummaryCache('ws-perf-1');
  await svc.getTikTokV4Status(auth);
  assert.equal(remoteHits, 2);
});

test('PERF-02D: Browser E2E proves /print-quotes eliminates 2-wave 11-API waterfall and reuses 15s client cache', async (t) => {
  const chromePath = findChromeExecutable();
  const webDistIndex = path.join(ROOT, 'apps/web/dist/index.html');
  if (!chromePath || !fs.existsSync(webDistIndex)) {
    t.skip('Browser binary or apps/web/dist not available');
    return;
  }

  const webServer = createWebServer({
    root: path.join(ROOT, 'apps/web/dist'),
  });
  await new Promise((resolve) => webServer.listen(0, '127.0.0.1', resolve));
  const webPort = webServer.address().port;
  const pqRequests = [];

  let browser = null;
  try {
    browser = await chromium.launch({
      executablePath: chromePath,
      headless: true,
    });
    const ctx = await browser.newContext({
      viewport: { width: 1366, height: 860 },
      colorScheme: 'light',
    });

    await ctx.route('**/api/v1/**', async (route) => {
      const urlPath = new URL(route.request().url()).pathname;
      if (urlPath.startsWith('/api/v1/print-quotes/')) {
        pqRequests.push(urlPath);
      }

      if (urlPath === '/api/v1/auth/me') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              user: {
                id: '11111111-1111-4111-8111-111111111111',
                username: 'owner_hp',
                full_name: 'Trương Hoài Phương',
                email: 'truhoaiphuong03@gmail.com',
                email_verified: true,
                phone: '0901234567',
              },
              active_workspace: {
                id: '22222222-2222-4222-8222-222222222222',
                name: 'THIẾT KẾ IN ẤN TOÀN GIA PHÁT',
                role: 'owner',
                permissions: [],
              },
              csrf_token: 'csrf-perf-test',
            },
          }),
        });
      }

      if (urlPath === '/api/v1/employees/me') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              id: 'emp-owner',
              employee_code: 'OWNER',
              full_name: 'Trương Hoài Phương',
              phone: '0901234567',
              employment_status: 'active',
            },
          }),
        });
      }

      if (urlPath === '/api/v1/print-quotes/stats') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              total_quotes: 1,
              total_orders: 0,
              expected_revenue: 0,
              expected_profit: 0,
              total_receivable: 0,
            },
          }),
        });
      }

      if (urlPath === '/api/v1/print-quotes/receivables') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              totals: {
                total_receivable: 0,
                total_collected: 0,
                total_outstanding: 0,
                overdue_customers_count: 0,
              },
              summaries: [],
            },
          }),
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { items: [], summaries: [] },
        }),
      });
    });

    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${webPort}/print-quotes`, {
      waitUntil: 'networkidle',
    });
    await page.waitForSelector('[data-testid="printquote-screen"]', {
      timeout: 8000,
    });

    const ledgerEndpoints = new Set([
      '/api/v1/print-quotes/receivables',
      '/api/v1/print-quotes/payables',
      '/api/v1/print-quotes/transactions',
      '/api/v1/print-quotes/financial-report',
      '/api/v1/print-quotes/import-history/batches',
    ]);
    const initialLedgerCalls = pqRequests.filter((u) => ledgerEndpoints.has(u));
    assert.equal(
      initialLedgerCalls.length,
      0,
      `Opening /print-quotes must fetch 0 ledger/report endpoints, got: ${initialLedgerCalls.join(', ')}`,
    );
    assert.equal(
      pqRequests.length,
      6,
      `Opening /print-quotes must issue exactly 6 core requests in 1 wave, got ${pqRequests.length}: ${pqRequests.join(', ')}`,
    );

    pqRequests.length = 0;
    await page.click('[data-testid="pq-nav-group-finance"]');
    await page.waitForTimeout(250);
    assert.deepEqual(
      pqRequests,
      ['/api/v1/print-quotes/receivables'],
      'Switching to Công nợ within 15s must fetch ONLY /api/v1/print-quotes/receivables without re-fetching 6 core collections',
    );

    pqRequests.length = 0;
    await page.click('[data-testid="pq-nav-group-quotes"]');
    await page.waitForTimeout(200);
    assert.equal(
      pqRequests.length,
      0,
      'Switching back to Báo giá within 15s must hit client cache with 0 network calls',
    );

    // Verify direct entry to /print-quotes/orders isolates order fetching
    pqRequests.length = 0;
    await page.goto(`http://127.0.0.1:${webPort}/print-quotes/orders`, {
      waitUntil: 'networkidle',
    });
    assert.deepEqual(
      pqRequests,
      ['/api/v1/print-quotes/orders'],
      `Opening /print-quotes/orders directly must fetch ONLY /api/v1/print-quotes/orders without unrelated requests, got: ${pqRequests.join(', ')}`,
    );
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    webServer.closeAllConnections?.();
    await new Promise((resolve) => webServer.close(() => resolve()));
  }
});
