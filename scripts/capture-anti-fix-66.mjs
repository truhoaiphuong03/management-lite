import { loadQaEndpoint } from './explicit-database.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const screenshotsDir = resolve(root, 'docs/handoff/FIX-66/screenshots');

mkdirSync(screenshotsDir, { recursive: true });

const port = 9266;
const runId = Math.random().toString(36).substring(2, 8);
const targetUrl = loadQaEndpoint(process.env.QA_WEB_BASE);

async function run() {
  console.log(
    '=== STARTING ANTI-FIX-66 BROWSER HIT-TEST & EVIDENCE CAPTURE ===\n',
  );

  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=/tmp/chrome-fix-66-${runId}`,
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
        const text = msg.params.args
          .map((a) => a.value || a.description)
          .join(' ');
        // Privacy guard: never log sensitive amounts
        if (!text.includes('vnd') && !text.includes('password')) {
          console.log('[BROWSER CONSOLE]', msg.params.type, text);
        }
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        console.log('[BROWSER EXCEPTION]', msg.params.exceptionDetails.text);
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

    // Intercept and mock API requests strictly adhering to contracts
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (() => {
          window.fetch = async (url, opts) => {
            const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';

            if (urlStr.includes('/api/v1/auth/me')) {
              const isStaff = document.cookie.includes('mock_role=staff');
              const role = isStaff ? 'staff' : 'owner';
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  success: true,
                  data: {
                    user: { id: 'usr-fix-66', email: 'owner@mglite.vn', full_name: role === 'owner' ? 'Trần Chủ Sở Hữu' : 'Lê Nhân Viên' },
                    active_workspace: {
                      id: 'ws-fix-66',
                      workspace_id: 'ws-fix-66',
                      name: 'FIX-66 Production Workspace',
                      workspace_name: 'FIX-66 Production Workspace',
                      role,
                    },
                    csrf_token: 'csrf-fix-66-token',
                  },
                }),
              };
            }

            // Employees mock with multiple pages for hit-test testing
            if (urlStr.includes('/api/v1/employees')) {
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
                    },
                  }),
                };
              }
              const hasCursor = urlStr.includes('cursor=');
              if (hasCursor) {
                return {
                  ok: true,
                  status: 200,
                  json: async () => ({
                    success: true,
                    data: {
                      items: Array.from({ length: 8 }, (_, i) => ({
                        id: 'emp-p2-' + i,
                        employee_code: 'NV0' + (i + 10),
                        full_name: 'Nhân viên Trang 2 #' + (i + 1),
                        employment_status: 'active',
                        role: 'staff',
                        created_at: '2026-10-05T08:00:00Z',
                      })),
                      next_cursor: null,
                      total_count: 18,
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
                    items: Array.from({ length: 10 }, (_, i) => ({
                      id: 'emp-p1-' + i,
                      employee_code: 'NV00' + (i + 1),
                      full_name: 'Nhân viên Trang 1 #' + (i + 1),
                      employment_status: 'active',
                      role: 'staff',
                      created_at: '2026-10-01T08:00:00Z',
                    })),
                    next_cursor: 'emp_page_2_cursor',
                    total_count: 18,
                  },
                }),
              };
            }

            // Payroll Staff Payslip fixture
            if (urlStr.includes('/api/v1/payroll/periods/') && urlStr.includes('/me')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  success: true,
                  data: {
                    period_month: '2026-10',
                    status: 'draft',
                    server_as_of: new Date().toISOString(),
                    employee: {
                      id: 'emp-1',
                      employee_code: 'NV001',
                      full_name: 'Nguyễn Văn A (Staff)',
                    },
                    hourly_rate_vnd: 45000,
                    confirmed: {
                      approved_worked_seconds: 36000,
                      approved_worked_minutes: 600,
                      base_pay_vnd: 7200000,
                      paid_leave_pay_vnd: 400000,
                      net_pay_vnd: 7600000,
                      paid_amount_vnd: 2000000,
                      payment_status: 'partially_paid',
                    },
                    pending_review: {
                      shift_count: 2,
                      pending_seconds: 28800,
                      pending_minutes: 480,
                      estimated_pay_vnd: 360000,
                    },
                    live_provisional: {
                      has_open_shift: true,
                      working_state: 'working',
                      live_seconds: 7200,
                      live_minutes: 120,
                      live_pay_vnd: 90000,
                    },
                    daily_breakdowns: [],
                    disbursements: [],
                  },
                }),
              };
            }

            // Payroll Owner Overview mock
            if (urlStr.includes('/api/v1/payroll/periods/')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  success: true,
                  data: {
                    period: {
                      id: 'prd-1',
                      period_month: '2026-10',
                      status: 'finalized',
                      version: 1,
                      total_net_pay_vnd: 15000000,
                      total_paid_amount_vnd: 5000000,
                    },
                    server_as_of: new Date().toISOString(),
                    items: [
                      {
                        id: 'item-01',
                        employee_id: 'emp-01',
                        employee_code: 'NV001',
                        full_name: 'Nguyễn Văn A',
                        employment_status: 'active',
                        version: 1,
                        confirmed: {
                          approved_worked_seconds: 36000,
                          approved_worked_minutes: 600,
                          base_pay_vnd: 7200000,
                          paid_leave_pay_vnd: 800000,
                          net_pay_vnd: 8000000,
                          paid_amount_vnd: 3000000,
                          payment_status: 'partially_paid',
                        },
                        disbursements: [],
                      },
                      {
                        id: 'item-02',
                        employee_id: 'emp-02',
                        employee_code: 'NV002',
                        full_name: 'Trần Thị B',
                        employment_status: 'active',
                        version: 1,
                        confirmed: {
                          approved_worked_seconds: 36000,
                          approved_worked_minutes: 600,
                          base_pay_vnd: 6500000,
                          paid_leave_pay_vnd: 500000,
                          net_pay_vnd: 7000000,
                          paid_amount_vnd: 2000000,
                          payment_status: 'partially_paid',
                        },
                        disbursements: [],
                      },
                    ],
                  },
                }),
              };
            }

            // Attendance / Clock mock
            if (urlStr.includes('/api/v1/attendance')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  success: true,
                  data: {
                    current_shift: null,
                    recent_shifts: [],
                    shifts: [],
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
                    next_cursor: null,
                  },
                }),
              };
            }

            // Schedule mock
            if (urlStr.includes('/api/v1/schedules')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  success: true,
                  data: {
                    schedules: [
                      {
                        id: 'sch-1',
                        week_start_date: '2026-10-05',
                        status: 'published',
                        version: 1,
                      },
                    ],
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
        deviceScaleFactor: 1,
        mobile: width <= 768,
      });
    };

    const navigateTo = async (path, role = 'owner') => {
      await send('Network.setCookie', {
        name: 'mock_role',
        value: role,
        url: targetUrl,
      });
      await send('Page.navigate', { url: `${targetUrl}${path}` });
      await new Promise((r) => setTimeout(r, 1200));
    };

    const takeScreenshot = async (filename) => {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      writeFileSync(
        resolve(screenshotsDir, filename),
        Buffer.from(data, 'base64'),
      );
      console.log(`Saved screenshot: ${filename}`);
    };

    // Helper: Execute comprehensive 5-point hit-test on Load More button vs Floating Bug Widget
    const runHitTestAtScroll = async (scrollFraction, label) => {
      const result = await evaluate(`
        (() => {
          const loadMoreBtn = document.querySelector('[data-testid="btn-load-more"]') ||
            Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Tải thêm'));
          const bugWidget = document.querySelector('[data-testid="btn-open-report-bug"]');

          if (!loadMoreBtn) return { ok: false, error: 'Load more button not found' };
          if (!bugWidget) return { ok: false, error: 'Bug widget not found' };

          // Scroll page to fraction
          const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
          window.scrollTo(0, Math.max(0, maxScroll * ${scrollFraction}));

          const btnRect = loadMoreBtn.getBoundingClientRect();
          const bugRect = bugWidget.getBoundingClientRect();

          // 5-Point Hit Test points
          const points = [
            { name: 'top-left', x: btnRect.left + 2, y: btnRect.top + 2 },
            { name: 'top-right', x: btnRect.right - 2, y: btnRect.top + 2 },
            { name: 'center', x: btnRect.left + btnRect.width / 2, y: btnRect.top + btnRect.height / 2 },
            { name: 'bottom-left', x: btnRect.left + 2, y: btnRect.bottom - 2 },
            { name: 'bottom-right', x: btnRect.right - 2, y: btnRect.bottom - 2 },
          ];

          const pointResults = [];
          for (const pt of points) {
            const el = document.elementFromPoint(pt.x, pt.y);
            const isSelfOrDescendant = el && (el === loadMoreBtn || loadMoreBtn.contains(el));
            const isBugWidget = el && (el === bugWidget || bugWidget.contains(el));

            pointResults.push({
              name: pt.name,
              x: pt.x,
              y: pt.y,
              hitTag: el ? el.tagName + (el.className ? '.' + el.className : '') : 'null',
              isLoadMore: isSelfOrDescendant,
              isBugWidget,
            });
          }

          // Check geometric overlap
          const overlaps = !(
            btnRect.right < bugRect.left ||
            btnRect.left > bugRect.right ||
            btnRect.bottom < bugRect.top ||
            btnRect.top > bugRect.bottom
          );

          return {
            ok: pointResults.every(p => !p.isBugWidget),
            allLoadMoreHits: pointResults.every(p => p.isLoadMore),
            overlaps,
            horizontalGap: bugRect.left - btnRect.right,
            btnRect: { left: btnRect.left, right: btnRect.right, top: btnRect.top, bottom: btnRect.bottom },
            bugRect: { left: bugRect.left, right: bugRect.right, top: bugRect.top, bottom: bugRect.bottom },
            pointResults,
          };
        })()
      `);

      console.log(`[HIT-TEST ${label} (scroll ${scrollFraction})]`, {
        ok: result.ok,
        allLoadMoreHits: result.allLoadMoreHits,
        overlaps: result.overlaps,
        horizontalGap: result.horizontalGap + 'px',
        topRightHit: result.pointResults?.find((p) => p.name === 'top-right'),
      });

      assert.equal(
        result.ok,
        true,
        `Hit test must NEVER hit the bug widget at scroll ${scrollFraction} (${label})`,
      );
      assert.equal(
        result.overlaps,
        false,
        `Button must never geometrically overlap with bug widget (${label})`,
      );
      return result;
    };

    // ==========================================
    // 1. Desktop 1440px: Owner Payroll Overview
    // ==========================================
    console.log('\n--- 1. Desktop 1440px: Owner Payroll Overview ---');
    await setViewport(1440, 900);
    await navigateTo('/payroll', 'owner');
    await takeScreenshot('01_desktop_1440_owner_payroll.png');

    // ==========================================
    // 2. Desktop 1440px: Owner Disburse Modal
    // ==========================================
    console.log('\n--- 2. Desktop 1440px: Owner Disburse Modal ---');
    await evaluate(`
      (() => {
        const disburseBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Chi lương'));
        if (disburseBtn) disburseBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));
    await takeScreenshot('02_desktop_1440_disburse_modal.png');

    // Close modal
    await evaluate(`
      (() => {
        const cancelBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Hủy');
        if (cancelBtn) cancelBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 400));

    // ==========================================
    // 3. Desktop 1440px: Staff /my-pay
    // ==========================================
    console.log('\n--- 3. Desktop 1440px: Staff /my-pay ---');
    await navigateTo('/my-pay', 'staff');
    await takeScreenshot('03_desktop_1440_staff_mypay.png');

    // ==========================================
    // 4. Tablet 768px: Owner Schedule
    // ==========================================
    console.log('\n--- 4. Tablet 768px: Owner Schedule ---');
    await setViewport(768, 1024);
    await navigateTo('/schedule', 'owner');
    await takeScreenshot('04_tablet_768_owner_schedule.png');

    // ==========================================
    // 5-7. Mobile 390px: Employees List Clearance Across Scroll Range
    // ==========================================
    console.log(
      '\n--- 5-7. Mobile 390px: Employees List Clearance Across Scroll Range ---',
    );
    await setViewport(390, 844);
    await navigateTo('/employees', 'owner');

    // Scroll 0.0 (top)
    await runHitTestAtScroll(0.0, '390px-Scroll0');
    await takeScreenshot('05_mobile_390_employees_clearance_scroll0.png');

    // Scroll 0.5 (mid)
    await runHitTestAtScroll(0.5, '390px-ScrollMid');
    await takeScreenshot('06_mobile_390_employees_clearance_scroll_mid.png');

    // Scroll 1.0 (bottom)
    await runHitTestAtScroll(1.0, '390px-ScrollBottom');
    await takeScreenshot('07_mobile_390_employees_clearance_scroll_bottom.png');

    // Scroll back up to 0.5 and 0.0 to verify scrolling up
    await runHitTestAtScroll(0.5, '390px-ScrollUpMid');
    await runHitTestAtScroll(0.0, '390px-ScrollUpTop');

    // ==========================================
    // 8-10. Mobile 360px: Employees List Clearance Across Scroll Range
    // ==========================================
    console.log(
      '\n--- 8-10. Mobile 360px: Employees List Clearance Across Scroll Range ---',
    );
    await setViewport(360, 640);
    await navigateTo('/employees', 'owner');

    // Scroll 0.0 (top)
    await runHitTestAtScroll(0.0, '360px-Scroll0');
    await takeScreenshot('08_mobile_360_employees_clearance_scroll0.png');

    // Scroll 0.5 (mid)
    await runHitTestAtScroll(0.5, '360px-ScrollMid');
    await takeScreenshot('09_mobile_360_employees_clearance_scroll_mid.png');

    // Scroll 1.0 (bottom)
    await runHitTestAtScroll(1.0, '360px-ScrollBottom');
    await takeScreenshot('10_mobile_360_employees_clearance_scroll_bottom.png');

    // Scroll back up to 0.5 and 0.0
    await runHitTestAtScroll(0.5, '360px-ScrollUpMid');
    await runHitTestAtScroll(0.0, '360px-ScrollUpTop');

    // ==========================================
    // 11. Mobile 360px: Owner Clock
    // ==========================================
    console.log('\n--- 11. Mobile 360px: Owner Clock ---');
    await navigateTo('/clock', 'owner');
    await takeScreenshot('11_mobile_360_owner_clock.png');

    // ==========================================
    // 12. Mobile 360px: Staff Reports
    // ==========================================
    console.log('\n--- 12. Mobile 360px: Staff Reports ---');
    await navigateTo('/reports', 'staff');
    await takeScreenshot('12_mobile_360_staff_reports.png');

    console.log(
      '\n=== ALL BROWSER HIT-TESTS PASSED & 12 SCREENSHOTS CAPTURED FOR ANTI-FIX-66 ===',
    );
  } finally {
    chrome.kill();
  }
}

run().catch((err) => {
  console.error('CAPTURE RUN FAILED:', err);
  process.exit(1);
});
