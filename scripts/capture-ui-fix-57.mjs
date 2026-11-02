import { loadQaEndpoint } from './explicit-database.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const screenshotsDir = resolve(root, 'docs/handoff/FIX-57/screenshots');

mkdirSync(screenshotsDir, { recursive: true });

const port = 9257;
const runId = Math.random().toString(36).substring(2, 8);
const targetUrl = loadQaEndpoint(process.env.QA_WEB_BASE);

async function run() {
  console.log('=== STARTING FIX-57 BROWSER MATRIX & EVIDENCE CAPTURE ===\n');

  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=/tmp/chrome-fix-57-${runId}`,
    ],
  );

  try {
    await new Promise((r) => setTimeout(r, 1500));

    const newTab = await fetch(
      `http://127.0.0.1:${port}/json/new?about:blank`,
      {
        method: 'PUT',
      },
    ).then((r) => r.json());

    const ws = new WebSocket(newTab.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));

    let msgId = 1;
    const callbacks = new Map();

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        console.log(
          '[BROWSER CONSOLE]',
          msg.params.type,
          msg.params.args.map((a) => a.value || a.description).join(' '),
        );
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        console.log(
          '[BROWSER EXCEPTION]',
          msg.params.exceptionDetails.text,
          msg.params.exceptionDetails.exception?.description,
        );
      }
      if (msg.id && callbacks.has(msg.id)) {
        const { res, rej } = callbacks.get(msg.id);
        callbacks.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    };

    const send = (method, params = {}) =>
      new Promise((res, rej) => {
        const id = msgId++;
        callbacks.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
      });

    const evaluate = async (exp) => {
      const r = await send('Runtime.evaluate', {
        expression: exp,
        returnByValue: true,
        awaitPromise: true,
      });
      if (r.exceptionDetails) {
        throw new Error(
          r.exceptionDetails.text +
            ': ' +
            (r.exceptionDetails.exception?.description || ''),
        );
      }
      return r.result?.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');

    // Intercept and mock API requests cleanly in browser context
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (() => {
          window.__networkLedger = [];
          window.fetch = async (url, opts) => {
            const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
            const record = { url: urlStr, method: opts?.method || 'GET', time: Date.now() };
            window.__networkLedger.push(record);

            if (urlStr.includes('/api/v1/auth/me')) {
              const isStaff = document.cookie.includes('mock_role=staff');
              const role = isStaff ? 'staff' : 'owner';
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  success: true,
                  data: {
                    user: { id: 'usr-1', email: 'user@mglite.vn', full_name: role === 'owner' ? 'Trần Chủ Sở Hữu' : 'Lê Nhân Viên' },
                    active_workspace: {
                      id: 'ws-1',
                      name: 'Management Lite Production',
                      role,
                    },
                    csrf_token: 'csrf-fix-57',
                  },
                }),
              };
            }

            // Employees mock
            if (urlStr.includes('/api/v1/employees')) {
              if (opts?.method === 'POST') {
                return {
                  ok: true,
                  status: 200,
                  json: async () => ({
                    success: true,
                    data: { status: 'suspended', token: 'mock-token-xyz' },
                  }),
                };
              }
              if (urlStr.includes('/api/v1/employees/emp-')) {
                return {
                  ok: true,
                  status: 200,
                  json: async () => ({
                    success: true,
                    data: {
                      id: 'emp-1',
                      employee_code: 'NV001',
                      full_name: 'Nguyễn Văn A',
                      email: 'nva@mglite.vn',
                      phone: '0901234567',
                      employment_status: 'active',
                      role: 'staff',
                      created_at: '2026-10-01T08:00:00Z',
                      invitation_link: 'http://127.0.0.1:3017/invite/token-12345',
                    },
                  }),
                };
              }
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  success: true,
                  data: {
                    items: [
                      {
                        id: 'emp-1',
                        employee_code: 'NV001',
                        full_name: 'Nguyễn Văn A',
                        email: 'nva@mglite.vn',
                        phone: '0901234567',
                        employment_status: 'active',
                        role: 'staff',
                        created_at: '2026-10-01T08:00:00Z',
                        invitation_link: 'http://127.0.0.1:3017/invite/token-12345',
                      },
                      {
                        id: 'emp-2',
                        employee_code: 'NV002',
                        full_name: 'Trần Thị B',
                        email: 'ttb@mglite.vn',
                        phone: '0907654321',
                        employment_status: 'suspended',
                        role: 'staff',
                        created_at: '2026-10-02T08:00:00Z',
                      },
                    ],
                    next_cursor: null,
                    total_count: 2,
                  },
                }),
              };
            }

            // Attendance mock
            if (urlStr.includes('/api/v1/attendance/shifts')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  success: true,
                  data: {
                    shifts: [
                      {
                        id: 'shift-1',
                        employee_id: 'emp-1',
                        employee_code: 'NV001',
                        employee_name: 'Nguyễn Văn A',
                        run_state: 'working',
                        clock_in_at: new Date(Date.now() - 4 * 3600 * 1000).toISOString(),
                        clock_out_at: null,
                        version: 1,
                      },
                    ],
                  },
                }),
              };
            }

            if (urlStr.includes('/api/v1/attendance/me')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  success: true,
                  data: {
                    current_shift: {
                      id: 'shift-me-1',
                      run_state: 'working',
                      clock_in_at: new Date(Date.now() - 3600 * 1000).toISOString(),
                      breaks: [],
                      version: 1,
                    },
                    recent_shifts: [],
                  },
                }),
              };
            }

            // Reports mock
            if (urlStr.includes('/api/v1/reports')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  success: true,
                  data: {
                    items: [
                      {
                        id: 'rep-1',
                        report_date: '2026-10-10',
                        employee_name: 'Nguyễn Văn A',
                        status: 'submitted',
                        created_at: '2026-10-10 12:00:00.123456+00',
                        entries_count: 3,
                        total_reported_count: 5,
                      },
                    ],
                    next_cursor: 'next-cursor-reports-sample',
                  },
                }),
              };
            }

            if (urlStr.includes('/api/v1/')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({ success: true, data: {} }),
              };
            }

            return { ok: true, status: 200, json: async () => ({}) };
          };
        })();
      `,
    });

    const setViewport = async (width, height) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 2,
        mobile: width <= 768,
      });
      await new Promise((r) => setTimeout(r, 400));
    };

    const navigateSPA = async (path) => {
      await evaluate(`
        (() => {
          window.history.pushState({}, '', '${path}');
          window.dispatchEvent(new PopStateEvent('popstate'));
        })()
      `);
      await new Promise((r) => setTimeout(r, 600));
    };

    const setMockRole = async (role) => {
      await evaluate(`document.cookie = 'mock_role=${role}; path=/'`);
      await send('Page.reload');
      for (let i = 0; i < 40; i++) {
        const ready = await evaluate(
          `Boolean(document.querySelector('main') || document.querySelector('header'))`,
        );
        if (ready) break;
        await new Promise((r) => setTimeout(r, 200));
      }
    };

    const capture = async (filename) => {
      const shot = await send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });
      const buffer = Buffer.from(shot.data, 'base64');
      const targetPath = resolve(screenshotsDir, filename);
      writeFileSync(targetPath, buffer);
      console.log(`✓ Screenshot captured: ${filename}`);
    };

    // Initial navigation
    await send('Page.navigate', { url: targetUrl });
    for (let i = 0; i < 40; i++) {
      const ready = await evaluate(
        `Boolean(document.querySelector('main') || document.querySelector('header'))`,
      );
      if (ready) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    // -------------------------------------------------------------
    // CAPTURE 1: Desktop 1440px Owner at /employees
    // -------------------------------------------------------------
    console.log('\n--- 1. Desktop 1440px Owner at /employees ---');
    await setMockRole('owner');
    await setViewport(1440, 900);
    await navigateSPA('/employees');
    await new Promise((r) => setTimeout(r, 600));
    await capture('01_desktop_1440_owner_employees.png');

    // -------------------------------------------------------------
    // CAPTURE 2: Desktop 1440px Owner trigger AppDialog (Suspend)
    // -------------------------------------------------------------
    console.log('\n--- 2. Desktop 1440px Owner AppDialog Suspend ---');
    const clicked = await evaluate(`
      (() => {
        const redBtn = Array.from(document.querySelectorAll('button')).find(b =>
          b.textContent.trim() === 'Tạm ngưng' && b.style.backgroundColor.includes('239')
        );
        if (redBtn) {
          redBtn.click();
          return true;
        }
        return false;
      })()
    `);
    console.log('Clicked red suspend button:', clicked);
    await new Promise((r) => setTimeout(r, 600));
    await capture('02_desktop_1440_owner_dialog_suspend.png');

    const dialogRendered = await evaluate(
      `Boolean(document.querySelector('[role="dialog"]'))`,
    );
    assert.ok(dialogRendered, 'AppDialog must be open and rendered in the DOM');

    // -------------------------------------------------------------
    // CAPTURE 3: Desktop 1440px Owner submit dialog -> trigger AppToast
    // -------------------------------------------------------------
    console.log('\n--- 3. Desktop 1440px Owner AppToast Notification ---');
    await evaluate(`
      (() => {
        const input = document.querySelector('[role="dialog"] input');
        if (input) {
          input.value = 'Nghỉ phép dài hạn theo yêu cầu';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        const confirmBtn = Array.from(document.querySelectorAll('[role="dialog"] button')).find(b => b.textContent.includes('Xác nhận'));
        if (confirmBtn) confirmBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));
    await capture('03_desktop_1440_owner_toast_action.png');

    const toastRendered = await evaluate(
      `Boolean(document.querySelector('[role="status"], [role="alert"]'))`,
    );
    assert.ok(toastRendered, 'AppToast must be visible on screen');

    // -------------------------------------------------------------
    // CAPTURE 4: Tablet 768px Owner at /employees (Documenting 768px breakpoint)
    // -------------------------------------------------------------
    console.log('\n--- 4. Tablet 768px Owner at /employees ---');
    await setViewport(768, 1024);
    await new Promise((r) => setTimeout(r, 400));
    await capture('04_tablet_768_owner_employees.png');

    // Verify 768px activates mobile bottom nav per AppShell media queries
    const isMobileNavVisible768 = await evaluate(`
      (() => {
        const nav = document.querySelector('nav[aria-label="Điều hướng chính di động"]');
        if (!nav) return false;
        const rect = nav.getBoundingClientRect();
        return rect.height > 0 && rect.width > 0;
      })()
    `);
    console.log(
      `[768px BREAKPOINT NOTE] Mobile bottom nav visible at 768px: ${isMobileNavVisible768}`,
    );

    // -------------------------------------------------------------
    // CAPTURE 5: Mobile 390px Owner at /employees
    // -------------------------------------------------------------
    console.log('\n--- 5. Mobile 390px Owner at /employees ---');
    await setViewport(390, 844);
    await new Promise((r) => setTimeout(r, 400));
    await capture('05_mobile_390_owner_employees.png');

    // -------------------------------------------------------------
    // CAPTURE 6: Mobile 360px Owner at /clock (Minimal Viewport Overflow Check)
    // -------------------------------------------------------------
    console.log('\n--- 6. Mobile 360px Owner at /clock ---');
    await setViewport(360, 780);
    await navigateSPA('/clock');
    await new Promise((r) => setTimeout(r, 600));
    await capture('06_mobile_360_owner_clock.png');

    const overflow360 = await evaluate(`
      (() => {
        const scrollW = document.documentElement.scrollWidth;
        const innerW = window.innerWidth;
        return { scrollW, innerW, hasOverflow: scrollW > innerW };
      })()
    `);
    console.log(
      `[360px OVERFLOW CHECK] scrollWidth=${overflow360.scrollW}, innerWidth=${overflow360.innerW}`,
    );
    assert.ok(
      !overflow360.hasOverflow,
      '360px viewport must have ZERO horizontal overflow',
    );

    // -------------------------------------------------------------
    // CAPTURE 7: Mobile 360px Owner AppDialog for Clock-Out
    // -------------------------------------------------------------
    console.log('\n--- 7. Mobile 360px Owner Clock-Out AppDialog ---');
    await evaluate(`
      (() => {
        const stopBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Kết thúc'));
        if (stopBtn) stopBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 400));
    await capture('07_mobile_360_owner_clock_dialog.png');

    const dialogOverflow360 = await evaluate(`
      (() => {
        const scrollW = document.documentElement.scrollWidth;
        const innerW = window.innerWidth;
        return { scrollW, innerW, hasOverflow: scrollW > innerW };
      })()
    `);
    assert.ok(
      !dialogOverflow360.hasOverflow,
      'AppDialog at 360px must have ZERO horizontal overflow',
    );

    // Close dialog
    await evaluate(`
      (() => {
        const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Hủy'));
        if (cancelBtn) cancelBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));

    // -------------------------------------------------------------
    // CAPTURE 8: Desktop 1440px Staff at /clock
    // -------------------------------------------------------------
    console.log('\n--- 8. Desktop 1440px Staff at /clock ---');
    await setMockRole('staff');
    await setViewport(1440, 900);
    await navigateSPA('/clock');
    await new Promise((r) => setTimeout(r, 600));
    await capture('08_desktop_1440_staff_clock.png');

    // -------------------------------------------------------------
    // CAPTURE 9: Tablet 768px Staff at /reports
    // -------------------------------------------------------------
    console.log('\n--- 9. Tablet 768px Staff at /reports ---');
    await setViewport(768, 1024);
    await navigateSPA('/reports');
    await new Promise((r) => setTimeout(r, 600));
    await capture('09_tablet_768_staff_reports.png');

    // -------------------------------------------------------------
    // CAPTURE 10: Mobile 360px Staff at /reports
    // -------------------------------------------------------------
    console.log('\n--- 10. Mobile 360px Staff at /reports ---');
    await setViewport(360, 780);
    await new Promise((r) => setTimeout(r, 400));
    await capture('10_mobile_360_staff_reports.png');

    const staffReportsOverflow = await evaluate(`
      (() => {
        const scrollW = document.documentElement.scrollWidth;
        const innerW = window.innerWidth;
        return { scrollW, innerW, hasOverflow: scrollW > innerW };
      })()
    `);
    assert.ok(
      !staffReportsOverflow.hasOverflow,
      'Staff ReportsScreen at 360px must have ZERO horizontal overflow',
    );

    console.log(
      '\n🎉 ALL 10 SCREENSHOTS CAPTURED AND VIEWPORT INVARIANTS VERIFIED SUCCESSFULLY!\n',
    );
  } finally {
    chrome.kill('SIGKILL');
  }
}

run().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
