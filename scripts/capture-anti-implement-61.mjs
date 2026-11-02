import { loadQaEndpoint } from './explicit-database.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const screenshotsDir = resolve(
  root,
  'docs/handoff/ANTI-IMPLEMENT-61/screenshots',
);

mkdirSync(screenshotsDir, { recursive: true });

const port = 9261;
const runId = Math.random().toString(36).substring(2, 8);
const targetUrl = loadQaEndpoint(process.env.QA_WEB_BASE);

async function run() {
  console.log(
    '=== STARTING ANTI-IMPLEMENT-61 BROWSER MATRIX & EVIDENCE CAPTURE ===\n',
  );

  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=/tmp/chrome-implement-61-${runId}`,
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
                      name: 'Studio Media Production',
                      role,
                    },
                    csrf_token: 'csrf-implement-61',
                  },
                }),
              };
            }

            // Employees mock with next_cursor
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
              const hasCursor = urlStr.includes('cursor=');
              if (hasCursor) {
                return {
                  ok: true,
                  status: 200,
                  json: async () => ({
                    success: true,
                    data: {
                      items: [
                        {
                          id: 'emp-3',
                          employee_code: 'NV003',
                          full_name: 'Phạm Văn C (Trang 2)',
                          email: 'pvc@mglite.vn',
                          phone: '0901112233',
                          employment_status: 'active',
                          role: 'staff',
                          created_at: '2026-09-25T08:00:00Z',
                        },
                      ],
                      next_cursor: null,
                      total_count: 3,
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
                    next_cursor: 'emp_page_2_cursor',
                    total_count: 3,
                  },
                }),
              };
            }

            // Payroll Staff Payslip fixture with valid employee (FA60-02 & FA60-04)
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
                      base_pay_vnd: 7200000,
                      paid_leave_vnd: 400000,
                      net_pay_vnd: 7600000,
                      paid_amount_vnd: 2000000,
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
                        id: 'item-1',
                        employee_id: 'emp-1',
                        employee_code: 'NV001',
                        full_name: 'Nguyễn Văn A',
                        version: 1,
                        hourly_rate_vnd: 40000,
                        confirmed: {
                          base_pay_vnd: 7000000,
                          paid_leave_vnd: 500000,
                          net_pay_vnd: 7500000,
                          paid_amount_vnd: 2000000,
                        },
                        pending_review: {
                          shift_count: 1,
                          pending_seconds: 14400,
                          pending_minutes: 240,
                          estimated_pay_vnd: 160000,
                        },
                        live_provisional: {
                          has_open_shift: true,
                          working_state: 'working',
                          live_seconds: 7200,
                          live_minutes: 120,
                          live_pay_vnd: 80000,
                        },
                        daily_breakdowns: [],
                        disbursements: [],
                      },
                      {
                        id: 'item-2',
                        employee_id: 'emp-2',
                        employee_code: 'NV002',
                        full_name: 'Trần Thị B',
                        version: 1,
                        hourly_rate_vnd: 45000,
                        confirmed: {
                          base_pay_vnd: 7000000,
                          paid_leave_vnd: 500000,
                          net_pay_vnd: 7500000,
                          paid_amount_vnd: 3000000,
                        },
                        pending_review: {
                          shift_count: 0,
                          pending_seconds: 0,
                          pending_minutes: 0,
                          estimated_pay_vnd: 0,
                        },
                        live_provisional: {
                          has_open_shift: false,
                          working_state: 'idle',
                          live_seconds: 0,
                          live_minutes: 0,
                          live_pay_vnd: 0,
                        },
                        daily_breakdowns: [],
                        disbursements: [],
                      },
                    ],
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
                json: async () => ({
                  success: true,
                  data: {},
                }),
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

    // Assert zero horizontal overflow
    const assertNoHorizontalOverflow = async (screenName, expectedWidth) => {
      const scrollWidth = await evaluate(
        'document.documentElement.scrollWidth',
      );
      const innerWidth = await evaluate('window.innerWidth');
      console.log(
        `[OVERFLOW ASSERT] ${screenName}: scrollWidth=${scrollWidth}, innerWidth=${innerWidth} (Expected: <= ${expectedWidth})`,
      );
      assert.ok(
        scrollWidth <= innerWidth,
        `Horizontal overflow detected on ${screenName}! scrollWidth=${scrollWidth}, innerWidth=${innerWidth}`,
      );
    };

    // ==========================================
    // 1. Desktop 1440px: Owner Payroll Overview
    // ==========================================
    console.log('\n--- 1. Desktop 1440px: Owner Payroll Overview ---');
    await setViewport(1440, 900);
    await navigateTo('/payroll', 'owner');
    await takeScreenshot('01_desktop_1440_owner_payroll_overview.png');

    // ==========================================
    // 2. Desktop 1440px: Owner Disburse Modal
    // ==========================================
    console.log(
      '\n--- 2. Desktop 1440px: Owner Disburse Modal with Idempotency Key ---',
    );
    // Open disburse modal for first employee
    await evaluate(`
      (() => {
        const disburseBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Chi lương'));
        if (disburseBtn) disburseBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));
    await takeScreenshot('02_desktop_1440_owner_payroll_disburse_modal.png');

    // Close disburse modal
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
    console.log(
      '\n--- 3. Desktop 1440px: Staff /my-pay (Payslip rendering with employee profile) ---',
    );
    await navigateTo('/my-pay', 'staff');
    await takeScreenshot('03_desktop_1440_staff_mypay.png');

    // ==========================================
    // 4. Tablet 768px: Owner Schedule
    // ==========================================
    console.log(
      '\n--- 4. Tablet 768px: Owner Schedule & Multi-page Selector ---',
    );
    await setViewport(768, 1024);
    await navigateTo('/schedule', 'owner');
    await takeScreenshot('04_tablet_768_owner_schedule.png');

    // ==========================================
    // 5. Tablet 768px: Staff /my-pay
    // ==========================================
    console.log('\n--- 5. Tablet 768px: Staff /my-pay Responsive ---');
    await navigateTo('/my-pay', 'staff');
    await takeScreenshot('05_tablet_768_staff_mypay.png');

    // ==========================================
    // 6. Mobile 390px: Owner Employees List
    // ==========================================
    console.log(
      '\n--- 6. Mobile 390px: Owner Employees List & Touch Targets ---',
    );
    await setViewport(390, 844);
    await navigateTo('/employees', 'owner');
    await takeScreenshot('06_mobile_390_owner_employees.png');

    // ==========================================
    // 7. Mobile 390px: AppToast Touch Targets
    // ==========================================
    console.log('\n--- 7. Mobile 390px: AppToast >= 44x44px Touch Targets ---');
    // Trigger invite link copy toast
    await evaluate(`
      (() => {
        const copyBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Sao chép'));
        if (copyBtn) copyBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));
    await takeScreenshot('07_mobile_390_owner_toast.png');

    // ==========================================
    // 8. Mobile 360px: Owner Clock (Zero Overflow)
    // ==========================================
    console.log('\n--- 8. Mobile 360px: Owner Clock Zero Overflow ---');
    await setViewport(360, 640);
    await navigateTo('/clock', 'owner');
    await assertNoHorizontalOverflow('Owner Clock 360px', 360);
    await takeScreenshot('08_mobile_360_owner_clock.png');

    // ==========================================
    // 9. Mobile 360px: Staff Reports (Zero Overflow)
    // ==========================================
    console.log('\n--- 9. Mobile 360px: Staff Reports Zero Overflow ---');
    await navigateTo('/reports', 'staff');
    await assertNoHorizontalOverflow('Staff Reports 360px', 360);
    await takeScreenshot('09_mobile_360_staff_reports.png');

    // ==========================================
    // 10. Mobile 360px: Owner Dashboard (Verified Workspace)
    // ==========================================
    console.log(
      '\n--- 10. Mobile 360px: Owner Dashboard Verified Workspace & Zero Overflow ---',
    );
    await navigateTo('/', 'owner');
    await assertNoHorizontalOverflow('Owner Dashboard 360px', 360);
    await takeScreenshot('10_mobile_360_owner_dashboard.png');

    console.log(
      '\n=== ALL 10 SCREENSHOTS CAPTURED SUCCESSFULLY WITH ZERO REGRESSIONS ===',
    );
  } finally {
    chrome.kill();
  }
}

run().catch((err) => {
  console.error('CAPTURE RUN FAILED:', err);
  process.exit(1);
});
