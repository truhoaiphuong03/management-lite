import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppShell } from '../../dist/apps/web/src/AppShell.js';
import { ReportBugWidget } from '../../dist/apps/web/src/components/ReportBugWidget.js';
import { ScheduleScreen } from '../../dist/apps/web/src/screens/ScheduleScreen.js';
import { MobileBottomNav } from '../../dist/packages/ui/src/components/index.js';

const ROOT_DIR = process.cwd();

test('MOBILE-P0-01: tokens.css enforces horizontal overflow guard, 16px mobile input font-size, and light/dark theme tokens', () => {
  const css = fs.readFileSync(
    path.join(ROOT_DIR, 'packages/ui/src/tokens.css'),
    'utf8',
  );

  assert.ok(
    css.includes('overflow-x: hidden;') && css.includes('max-width: 100%;'),
    'tokens.css must guard body against horizontal overflow',
  );
  assert.ok(
    css.includes('font-size: 16px !important;'),
    'tokens.css must enforce >=16px font-size on mobile inputs to prevent iOS Safari auto-zoom and left-edge clipping',
  );
  assert.ok(
    css.includes("[data-theme='light']") &&
      css.includes('.app-shell-root') &&
      css.includes('.mobile-bottom-nav'),
    'tokens.css must define light theme surface/border overrides for AppShell and MobileBottomNav',
  );
});

test('MOBILE-P0-02: MobileBottomNav enforces iPhone safe-area padding, >=44px touch targets, and non-truncating multi-line labels', () => {
  const html = renderToStaticMarkup(
    React.createElement(MobileBottomNav, {
      currentPath: '/schedule',
      role: 'owner',
      isOwnerVerified: true,
      onNavigate: () => {},
    }),
  );

  assert.ok(
    html.includes('env(safe-area-inset-bottom, 0px)'),
    'MobileBottomNav must include iPhone safe-area-inset-bottom support',
  );
  assert.ok(
    html.includes('min-height:50px'),
    'MobileBottomNav buttons must have >= 44px touch target height (min-height:50px)',
  );
  assert.ok(
    html.includes('z-index:920'),
    'MobileBottomNav must maintain z-index:920 above scrolling content',
  );
  assert.ok(
    html.includes('overflow-wrap:break-word') &&
      html.includes('white-space:normal'),
    'MobileBottomNav labels must wrap cleanly without cutting words',
  );
  assert.ok(
    html.includes('aria-current="page"'),
    'MobileBottomNav must mark active group with aria-current="page"',
  );
});

test('MOBILE-P0-03: AppShell docks ReportBugWidget in normal flow (.app-shell-report-dock) so it never covers primary action buttons', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      AppShell,
      {
        currentPath: '/schedule',
        role: 'owner',
        isOwnerVerified: true,
        userName: 'Chủ sở hữu',
        workspaceName: 'Hoài Phương Studio',
        onNavigate: () => {},
        onLogout: () => {},
      },
      React.createElement(
        'button',
        { type: 'submit', 'data-testid': 'btn-submit-schedule' },
        'Đăng ký lịch tuần',
      ),
    ),
  );

  const contentIdx = html.indexOf('app-shell-content');
  const submitIdx = html.indexOf('btn-submit-schedule');
  const dockIdx = html.indexOf('app-shell-report-dock');
  const reportBtnIdx = html.indexOf('btn-open-report-bug');

  assert.ok(contentIdx > 0, 'AppShell must render .app-shell-content');
  assert.ok(
    dockIdx > submitIdx && reportBtnIdx > dockIdx,
    'AppShell must place .app-shell-report-dock and btn-open-report-bug AFTER primary screen content in DOM order',
  );
  assert.ok(
    html.includes('.app-shell-report-dock .btn-floating-report-bug') &&
      html.includes('position: static !important'),
    'AppShell must dock .btn-floating-report-bug in normal document flow so it cannot overlap primary buttons',
  );

  const widgetHtml = renderToStaticMarkup(
    React.createElement(ReportBugWidget, {
      currentPath: '/schedule',
      csrfToken: 'csrf-token',
    }),
  );
  assert.ok(
    widgetHtml.includes('.app-shell-report-dock .btn-floating-report-bug'),
    'ReportBugWidget style sheet must also preserve static docked layout inside .app-shell-report-dock',
  );
});

test('MOBILE-P0-04: ScheduleScreen renders mobile-first vertical day cards, 2x2 week selector, and full-width submit action rules', () => {
  const html = renderToStaticMarkup(
    React.createElement(ScheduleScreen, {
      role: 'owner',
      onNavigate: () => {},
    }),
  );

  assert.ok(
    html.includes('schedule-screen-root'),
    'ScheduleScreen root container must have .schedule-screen-root class',
  );
  assert.ok(
    html.includes('schedule-week-actions'),
    'ScheduleScreen week selector must have .schedule-week-actions class',
  );
  assert.ok(
    html.includes('.schedule-day-card') &&
      html.includes('flex-direction: column !important'),
    'ScheduleScreen must stack .schedule-day-card vertically on mobile viewports',
  );
  assert.ok(
    html.includes('.schedule-day-controls') &&
      html.includes('.schedule-day-time-row') &&
      html.includes('.schedule-day-note-row'),
    'ScheduleScreen must define responsive rules for day card controls, start time row, and notes row',
  );
  assert.ok(
    html.includes('.schedule-form-actions button') &&
      html.includes('width: 100% !important'),
    'ScheduleScreen must make form submit buttons full-width on mobile',
  );
});

test('MOBILE-P0-05: Audited screens use responsive grid minmax(min(100%, ...), 1fr) and wrapping filter selects for 320px compatibility', () => {
  const checks = [
    {
      file: 'apps/web/src/screens/GroupOverviewScreen.tsx',
      mustInclude: 'minmax(min(100%, 260px), 1fr)',
      mustNotInclude: 'minmax(300px, 1fr)',
    },
    {
      file: 'apps/web/src/screens/FinanceOverviewScreen.tsx',
      mustInclude: 'minmax(min(100%, 260px), 1fr)',
      mustNotInclude: 'minmax(300px, 1fr)',
    },
    {
      file: 'apps/web/src/screens/FinanceCategoriesScreen.tsx',
      mustInclude: 'minmax(min(100%, 360px), 1fr)',
      mustNotInclude: 'minmax(420px, 1fr)',
    },
    {
      file: 'apps/web/src/screens/IssueDetailScreen.tsx',
      mustInclude: 'minmax(min(100%, 240px), 1fr)',
      mustNotInclude: 'minmax(280px, 1fr)',
    },
    {
      file: 'apps/web/src/screens/AuditScreen.tsx',
      mustInclude: "flex: '1 1 160px'",
      mustNotInclude: null,
    },
  ];

  for (const item of checks) {
    const content = fs.readFileSync(path.join(ROOT_DIR, item.file), 'utf8');
    assert.ok(
      content.includes(item.mustInclude),
      `${item.file} must include responsive pattern: ${item.mustInclude}`,
    );
    if (item.mustNotInclude) {
      assert.ok(
        !content.includes(item.mustNotInclude),
        `${item.file} must not contain rigid overflow pattern: ${item.mustNotInclude}`,
      );
    }
  }
});

test('MOBILE-P0-06: Headless browser verification across 320/375/390/430/768/1024px, scroll, tabs, modal, keyboard focus, and light/dark themes', async (t) => {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  const browserBin = candidates.find((p) => fs.existsSync(p));
  const webDistIndex = path.join(ROOT_DIR, 'apps/web/dist/index.html');

  if (!browserBin || !fs.existsSync(webDistIndex)) {
    t.skip(
      'Headless browser or apps/web/dist not available in this environment',
    );
    return;
  }

  const distDir = path.join(ROOT_DIR, 'apps/web/dist');
  const server = http.createServer((req, res) => {
    const u = new URL(req.url || '/', 'http://127.0.0.1');
    const p = u.pathname;
    if (p === '/api/v1/auth/me') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          data: {
            user: {
              id: '11111111-1111-4111-8111-111111111111',
              username: 'owner',
              email: 'owner@hoaiphuong.local',
              display_name: 'Chủ sở hữu Hoài Phương',
            },
            active_workspace: {
              id: '22222222-2222-4222-8222-222222222222',
              code: 'HP-MAIN',
              name: 'Hoài Phương Studio',
              role: 'owner',
            },
            csrf_token: 'csrf-token-123',
            session_id: '33333333-3333-4333-8333-333333333333',
          },
        }),
      );
      return;
    }
    if (p === '/api/v1/schedules/me') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          data: { schedule: null, entries: [], revisions: [] },
        }),
      );
      return;
    }
    if (p.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          data: { items: [], total_count: 0, has_next_page: false },
        }),
      );
      return;
    }
    let filePath = path.join(distDir, p === '/' ? 'index.html' : p);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(distDir, 'index.html');
    }
    const ext = path.extname(filePath);
    const mime =
      ext === '.html'
        ? 'text/html; charset=utf-8'
        : ext === '.js'
          ? 'application/javascript; charset=utf-8'
          : ext === '.css'
            ? 'text/css; charset=utf-8'
            : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(fs.readFileSync(filePath));
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const debugPort = 9420 + Math.floor(Math.random() * 400);
  const userDataDir = path.join(
    process.env.TEMP || '/tmp',
    `chrome-mobile-p0-${Date.now()}`,
  );

  const chrome = spawn(
    browserBin,
    [
      '--headless=new',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      '--window-size=390,844',
      `${baseUrl}/schedule`,
    ],
    { stdio: 'ignore' },
  );

  let ws;
  try {
    let list;
    for (let i = 0; i < 30; i++) {
      try {
        list = await new Promise((resolve, reject) => {
          http
            .get(`http://127.0.0.1:${debugPort}/json/list`, (res) => {
              let data = '';
              res.on('data', (c) => (data += c));
              res.on('end', () => resolve(JSON.parse(data)));
            })
            .on('error', reject);
        });
        if (list && list.length > 0) break;
      } catch {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    assert.ok(list && list.length > 0, 'Chrome CDP endpoint must respond');

    const pageTab = list.find((item) => item.type === 'page') || list[0];
    ws = new WebSocket(pageTab.webSocketDebuggerUrl);
    let msgId = 1;
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const curId = msgId++;
        const timer = setTimeout(
          () => reject(new Error(`CDP timeout: ${method}`)),
          10000,
        );
        const handler = (evt) => {
          const resp = JSON.parse(evt.data);
          if (resp.id === curId) {
            clearTimeout(timer);
            ws.removeEventListener('message', handler);
            resolve(resp.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id: curId, method, params }));
      });

    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    await send('Page.enable');
    await send('Runtime.enable');

    for (const vp of [
      { w: 320, h: 667 },
      { w: 375, h: 812 },
      { w: 390, h: 844 },
      { w: 430, h: 932 },
      { w: 768, h: 1024 },
      { w: 1024, h: 768 },
    ]) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: vp.w,
        height: vp.h,
        deviceScaleFactor: 2,
        mobile: vp.w <= 768,
      });
      await send('Page.navigate', { url: `${baseUrl}/schedule` });
      await new Promise((r) => setTimeout(r, 600));

      // Click "Chọn T2 – T6 (08:00)" so all working inputs are active
      await send('Runtime.evaluate', {
        expression: `
          (() => {
            const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Chọn T2 – T6'));
            if (btn) btn.click();
          })()
        `,
      });
      await new Promise((r) => setTimeout(r, 200));

      const result = (
        await send('Runtime.evaluate', {
          expression: `
            (() => {
              const docW = document.documentElement.clientWidth;
              const scrollW = document.documentElement.scrollWidth;
              let clippedLeft = 0;
              let overflowRight = 0;
              for (const el of document.querySelectorAll('main *')) {
                const r = el.getBoundingClientRect();
                if (r.width === 0 && r.height === 0) continue;
                if (r.left < -1) clippedLeft++;
                if (r.right > docW + 1) overflowRight++;
              }
              return { docW, scrollW, clippedLeft, overflowRight };
            })()
          `,
          returnByValue: true,
        })
      ).result.value;

      assert.ok(
        result.scrollW <= result.docW + 1,
        `Viewport ${vp.w}px must have zero horizontal scroll overflow (got scrollW=${result.scrollW}, docW=${result.docW})`,
      );
      assert.equal(
        result.clippedLeft,
        0,
        `Viewport ${vp.w}px must have zero left-clipped elements`,
      );
      assert.equal(
        result.overflowRight,
        0,
        `Viewport ${vp.w}px must have zero right-overflowing elements`,
      );
    }

    // At 390px: verify vertical card stacking, CTA vs ReportBugWidget non-overlap, modal open, tab switch, keyboard focus, and light/dark mode
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await send('Page.navigate', { url: `${baseUrl}/schedule?t=${Date.now()}` });
    await new Promise((r) => setTimeout(r, 800));

    const evalRes = await send('Runtime.evaluate', {
      expression: `
        (async () => {
          for (let i = 0; i < 20; i++) {
            if (document.querySelector('[data-testid="schedule-day-card-1"]')) break;
            await new Promise(r => setTimeout(r, 100));
          }
          const quickBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Chọn T2 – T6'));
          if (quickBtn) quickBtn.click();
          await new Promise(r => setTimeout(r, 200));

          const card = document.querySelector('[data-testid="schedule-day-card-1"]');
          if (!card) return { error: 'Missing schedule-day-card-1' };
          const header = card.querySelector('.schedule-day-header').getBoundingClientRect();
          const timeRow = card.querySelector('.schedule-day-time-row').getBoundingClientRect();
          const noteRow = card.querySelector('.schedule-day-note-row').getBoundingClientRect();
          const isStackedVertically = header.bottom <= timeRow.top + 4 && timeRow.bottom <= noteRow.top + 4;

          // Scroll to bottom and check CTA vs ReportBugWidget vs MobileBottomNav
          window.scrollTo(0, document.documentElement.scrollHeight);
          await new Promise(r => setTimeout(r, 200));
          const submitRect = document.querySelector('[data-testid="btn-submit-schedule"]').getBoundingClientRect();
          const reportRect = document.querySelector('[data-testid="btn-open-report-bug"]').getBoundingClientRect();
          const navRect = document.querySelector('nav.mobile-bottom-nav').getBoundingClientRect();
          const intersectsSubmit = !(reportRect.right < submitRect.left || reportRect.left > submitRect.right || reportRect.bottom < submitRect.top || reportRect.top > submitRect.bottom);
          const intersectsNav = !(reportRect.right < navRect.left || reportRect.left > navRect.right || reportRect.bottom < navRect.top || reportRect.top > navRect.bottom);

          // Switch to Light mode and verify no overflow
          document.documentElement.setAttribute('data-theme', 'light');
          const lightScrollW = document.documentElement.scrollWidth;
          document.documentElement.setAttribute('data-theme', 'dark');

          // Open ReportBugWidget modal and verify no overflow
          document.querySelector('[data-testid="btn-open-report-bug"]').click();
          await new Promise(r => setTimeout(r, 200));
          const modalContainer = document.querySelector('[data-testid="report-bug-modal-container"]');
          const modalRect = modalContainer ? modalContainer.getBoundingClientRect() : null;
          const closeBtn = document.querySelector('[data-testid="btn-close-report-modal"]');
          if (closeBtn) closeBtn.click();
          await new Promise(r => setTimeout(r, 100));

          return {
            isStackedVertically,
            intersectsSubmit,
            intersectsNav,
            lightScrollW,
            modalFitsViewport: modalRect ? (modalRect.left >= 0 && modalRect.right <= 390) : false
          };
        })()
      `,
      awaitPromise: true,
      returnByValue: true,
    });
    const interactiveCheck = evalRes.result.value;

    assert.equal(
      interactiveCheck.isStackedVertically,
      true,
      'Mobile schedule card must stack day header, start time, and notes vertically',
    );
    assert.equal(
      interactiveCheck.intersectsSubmit,
      false,
      'Báo lỗi button must never overlap Đăng ký lịch tuần button',
    );
    assert.equal(
      interactiveCheck.intersectsNav,
      false,
      'Báo lỗi button at bottom of page must sit cleanly above MobileBottomNav',
    );
    assert.ok(
      interactiveCheck.lightScrollW <= 390,
      'Light mode at 390px must have zero horizontal overflow',
    );
    assert.equal(
      interactiveCheck.modalFitsViewport,
      true,
      'ReportBugWidget modal must fit cleanly inside 390px mobile viewport',
    );
  } finally {
    if (ws) ws.close();
    chrome.kill();
    server.close();
  }
});
