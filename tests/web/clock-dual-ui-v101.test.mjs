import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
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
  return http.createServer((req, res) => {
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
}

test('CLOCK-UI-V101.1: Source invariants — Dual-UI grid testids, zero Doc 20/36 leak, 0 phút idle copy & 1120px left-aligned container', () => {
  const clockSrc = fs.readFileSync(
    path.join(REPO_ROOT, 'apps/web/src/screens/ClockScreen.tsx'),
    'utf8',
  );
  const tokensCss = fs.readFileSync(
    path.join(REPO_ROOT, 'packages/ui/src/tokens.css'),
    'utf8',
  );

  assert.equal(
    clockSrc.includes('(Doc 20/36)'),
    false,
    'ClockScreen must not leak internal "(Doc 20/36)" reference into user-facing subtitle',
  );
  assert.ok(
    clockSrc.includes('data-testid="clock-dual-ui-grid"') &&
      clockSrc.includes('data-testid="clock-primary-card"') &&
      clockSrc.includes('data-testid="clock-secondary-column"'),
    'ClockScreen must render Dual-UI grid with primary clock card and secondary overview/history column',
  );
  assert.ok(
    clockSrc.includes("if (safe === 0) return '0 phút';"),
    'formatHoursMinutes must format 0 worked seconds as "0 phút" instead of "0 giây"',
  );
  assert.ok(
    clockSrc.includes('<span className="clock-self-timer">00:00</span>'),
    'Idle clock timer must display balanced "00:00"',
  );
  assert.match(
    tokensCss,
    /\.clock-self-page\s*\{[\s\S]*?max-width:\s*1120px;[\s\S]*?margin:\s*0;/,
    '.clock-self-page must span up to 1120px while keeping margin: 0 so h1 X-alignment matches /work',
  );
});

test('CLOCK-UI-V101.2: Real-browser Playwright Dual-UI layout — Desktop 2-column above-the-fold & Mobile 1-column stack (Light + Dark)', async () => {
  const server = startDistServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({
      viewport: { width: 1366, height: 800 },
    });
    const page = await context.newPage();

    await page.route('**/api/v1/**', async (route) => {
      const u = new URL(route.request().url());
      const p = u.pathname;
      if (p === '/api/v1/auth/me') {
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
                name: 'Hoài Phương Media',
                role: 'owner',
                permissions: [],
              },
              csrf_token: 'csrf-clock-v101',
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
              id: 'emp-owner',
              employee_code: 'ADM01',
              full_name: 'Trương Hoài Phương',
              phone: '0901234567',
              employment_status: 'active',
            },
          }),
        });
      }
      if (p === '/api/v1/attendance/me') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              current_shift: null,
              recent_shifts: [],
            },
          }),
        });
      }
      if (p === '/api/v1/employees') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { items: [], next_cursor: null },
          }),
        });
      }
      if (p === '/api/v1/attendance/shifts') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: { shifts: [], next_cursor: null },
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { items: [] } }),
      });
    });

    // 1. Desktop (1366x800 & 1280x800) in Light & Dark themes
    for (const vp of [
      { width: 1366, height: 800 },
      { width: 1280, height: 800 },
    ]) {
      await page.setViewportSize(vp);
      await page.goto(`${baseUrl}/clock`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="clock-primary-card"]');

      for (const theme of ['light', 'dark']) {
        const dMetrics = await page.evaluate((th) => {
          document.documentElement.setAttribute('data-theme', th);
          const doc = document.documentElement;
          const leftCol = document.querySelector(
            '[data-testid="clock-primary-card"]',
          );
          const rightCol = document.querySelector(
            '[data-testid="clock-secondary-column"]',
          );
          const clockBtn = document.querySelector('.clock-self-circle-btn');
          const toggleBtn = document.querySelector(
            '[data-testid="toggle-personal-history-btn"]',
          );
          const filterBar = document.querySelector(
            '[data-testid="my-history-filter-bar"]',
          );
          const todayText =
            document.querySelector('[data-testid="today-attendance-summary"]')
              ?.textContent || '';
          const timerText =
            document.querySelector('.clock-self-timer')?.textContent || '';
          const bodyText = document.body.textContent || '';

          const lRect = leftCol.getBoundingClientRect();
          const rRect = rightCol.getBoundingClientRect();
          const bRect = clockBtn.getBoundingClientRect();

          return {
            overflowX: doc.scrollWidth - doc.clientWidth,
            leftRight: lRect.right,
            rightLeft: rRect.left,
            topDiff: Math.abs(lRect.top - rRect.top),
            btnBottom: bRect.bottom,
            historyExpanded: toggleBtn?.getAttribute('aria-expanded'),
            filterVisible: Boolean(
              filterBar && filterBar.getClientRects().length > 0,
            ),
            todayText,
            timerText,
            hasDocLeak: bodyText.includes('Doc 20/36'),
          };
        }, theme);

        assert.ok(
          dMetrics.overflowX <= 0,
          `Desktop ${vp.width}px (${theme}) must have 0 horizontal overflow`,
        );
        assert.ok(
          dMetrics.rightLeft >= dMetrics.leftRight + 16,
          `Desktop ${vp.width}px (${theme}) must place secondary column to the right of primary clock card (got leftRight=${dMetrics.leftRight}, rightLeft=${dMetrics.rightLeft})`,
        );
        assert.ok(
          dMetrics.topDiff <= 2,
          `Desktop ${vp.width}px (${theme}) columns must align at top (got diff=${dMetrics.topDiff})`,
        );
        assert.ok(
          dMetrics.btnBottom <= vp.height,
          `Desktop ${vp.width}x${vp.height} (${theme}) "Vào ca" button must fit above the fold (btnBottom=${dMetrics.btnBottom})`,
        );
        assert.equal(
          dMetrics.historyExpanded,
          'true',
          `Desktop ${vp.width}px (${theme}) Personal History must expand by default`,
        );
        assert.equal(dMetrics.filterVisible, true);
        assert.match(dMetrics.todayText, /0 ca/);
        assert.match(dMetrics.todayText, /0 phút/);
        assert.doesNotMatch(dMetrics.todayText, /0 giây/);
        assert.equal(dMetrics.timerText, '00:00');
        assert.equal(dMetrics.hasDocLeak, false);
        if (
          vp.width === 1366 &&
          theme === 'light' &&
          process.env.SAVE_CLOCK_DESKTOP_PNG
        ) {
          await page.screenshot({
            path: process.env.SAVE_CLOCK_DESKTOP_PNG,
            fullPage: false,
          });
        }
      }
    }

    // 2. Mobile (390x844 & 320x640): single-column vertical stack, collapsed history by default, 0 overflow
    for (const vp of [
      { width: 390, height: 844 },
      { width: 320, height: 640 },
    ]) {
      await page.setViewportSize(vp);
      await page.goto(`${baseUrl}/clock`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[data-testid="clock-primary-card"]');
      if (vp.width === 390 && process.env.SAVE_CLOCK_MOBILE_PNG) {
        await page.evaluate(() => {
          document.documentElement.setAttribute('data-theme', 'light');
        });
        await page.screenshot({
          path: process.env.SAVE_CLOCK_MOBILE_PNG,
          fullPage: false,
        });
      }

      const mMetrics = await page.evaluate(() => {
        const doc = document.documentElement;
        const leftCol = document.querySelector(
          '[data-testid="clock-primary-card"]',
        );
        const rightCol = document.querySelector(
          '[data-testid="clock-secondary-column"]',
        );
        const toggleBtn = document.querySelector(
          '[data-testid="toggle-personal-history-btn"]',
        );
        const lRect = leftCol.getBoundingClientRect();
        const rRect = rightCol.getBoundingClientRect();
        return {
          overflowX: doc.scrollWidth - doc.clientWidth,
          xDiff: Math.abs(lRect.left - rRect.left),
          stackedBelow: rRect.top >= lRect.bottom + 10,
          historyExpanded: toggleBtn?.getAttribute('aria-expanded'),
        };
      });

      assert.ok(
        mMetrics.overflowX <= 0,
        `Mobile ${vp.width}px must have 0 horizontal overflow (got ${mMetrics.overflowX})`,
      );
      assert.ok(
        mMetrics.xDiff <= 2 && mMetrics.stackedBelow,
        `Mobile ${vp.width}px must stack secondary column vertically below primary clock card`,
      );
      assert.equal(
        mMetrics.historyExpanded,
        'false',
        `Mobile ${vp.width}px must keep Personal History collapsed by default for compact thumb UX`,
      );
    }

    // Verify mobile toggle expands Personal History cleanly
    await page.click('[data-testid="toggle-personal-history-btn"]');
    assert.equal(
      await page
        .locator('[data-testid="toggle-personal-history-btn"]')
        .getAttribute('aria-expanded'),
      'true',
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
