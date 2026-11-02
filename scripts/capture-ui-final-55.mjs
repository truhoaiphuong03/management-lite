import { loadQaEndpoint } from './explicit-database.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const screenshotsDir = resolve(root, 'docs/handoff/UI-FINAL-55/screenshots');

mkdirSync(screenshotsDir, { recursive: true });

const port = 9255;
const runId = Math.random().toString(36).substring(2, 8);
const targetUrl = loadQaEndpoint(process.env.QA_WEB_BASE);

async function run() {
  console.log(
    '=== STARTING UI-FINAL-55 AUTOMATED VERIFICATION & SCREENSHOT CAPTURE ===\n',
  );

  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=/tmp/chrome-final-55-${runId}`,
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
                    csrf_token: 'csrf-final-55',
                  },
                }),
              };
            }

            // Audit events list mock with exact total
            if (urlStr.includes('/api/v1/audit')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  success: true,
                  data: {
                    items: [
                      {
                        id: 'evt-1',
                        action: 'auth.login',
                        created_at: new Date().toISOString(),
                        request_id: 'req-00000001-abcd-ef01-2345-6789abcdef01',
                        user_id: 'usr-1',
                        entity_type: 'auth',
                        entity_id: 'usr-1',
                        metadata: { ip: '127.0.0.1' },
                      },
                      {
                        id: 'evt-2',
                        action: 'work.create',
                        created_at: new Date().toISOString(),
                        request_id: 'req-00000002-abcd-ef01-2345-6789abcdef02',
                        user_id: 'usr-1',
                        entity_type: 'work',
                        entity_id: 'w-1',
                        metadata: { work_id: 'w-1' },
                      },
                    ],
                    next_cursor: 'next-cursor-audit-sample',
                    total_count: 2653,
                  },
                }),
              };
            }

            // Issues list mock
            if (urlStr.includes('/api/v1/issues')) {
              if (urlStr.match(/\\/issues\\/ISS-[^/?]+/)) {
                return {
                  ok: true,
                  status: 200,
                  json: async () => ({
                    success: true,
                    data: {
                      issue: {
                        id: 'iss-sample-1',
                        code: 'ISS-001',
                        title: 'Nút đăng xuất không nhận click ở màn hình nhỏ',
                        status: 'open',
                        type: 'ui_bug',
                        description: 'Trên viewport 360px nút đăng xuất bị che bởi header element.',
                        route_template: '/issues/ISS-001',
                        module_name: 'Quản trị (Admin)',
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                      },
                      activities: [],
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
                        id: 'iss-1',
                        code: 'ISS-001',
                        title: 'Nút đăng xuất không nhận click ở màn hình nhỏ',
                        status: 'open',
                        type: 'ui_bug',
                        created_at: new Date().toISOString(),
                        module_name: 'Quản trị',
                      },
                      {
                        id: 'iss-2',
                        code: 'ISS-002',
                        title: 'Thiếu định dạng ngày tháng tiếng Việt trên bảng chấm công',
                        status: 'in_progress',
                        type: 'ui_bug',
                        created_at: new Date().toISOString(),
                        module_name: 'Ca & Chấm công',
                      },
                    ],
                    next_cursor: 'next-cursor-issues-sample',
                    group_counts: { all: 2, open: 1, in_progress: 1, resolved: 0, closed: 0 },
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
                      }
                    ],
                    next_cursor: 'next-cursor-reports-sample',
                  },
                }),
              };
            }

            // Employees mock
            if (urlStr.includes('/api/v1/employees')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  success: true,
                  data: {
                    items: [
                      {
                        id: 'emp-1',
                        full_name: 'Nguyễn Văn A',
                        role: 'staff',
                        employment_status: 'active',
                        email: 'staff.a@mglite.vn',
                      }
                    ],
                    next_cursor: 'next-cursor-emp-sample',
                  },
                }),
              };
            }

            // Default mock
            if (urlStr.includes('/api/v1/')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({ success: true, data: { items: [], next_cursor: null } }),
              };
            }

            throw new Error('Blocked external URL: ' + urlStr);
          };
        })()
      `,
    });

    await send('Page.navigate', { url: targetUrl });
    for (let i = 0; i < 40; i++) {
      const ready = await evaluate(
        `Boolean(document.querySelector('main') || document.querySelector('header'))`,
      );
      if (ready) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    const setViewport = async (w, h) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width: w,
        height: h,
        deviceScaleFactor: 1,
        mobile: w <= 768,
      });
      await new Promise((r) => setTimeout(r, 300));
    };

    const navigateSPA = async (path) => {
      await evaluate(`
        (() => {
          window.history.pushState(null, '', '${path}');
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

    // -------------------------------------------------------------
    // CAPTURE 1: Desktop 1440px Owner at /issues
    // -------------------------------------------------------------
    console.log('\n--- 1. Desktop 1440px Owner at /issues ---');
    await setMockRole('owner');
    await setViewport(1440, 900);
    await navigateSPA('/issues');
    await capture('01_desktop_1440_owner_breadcrumb_issues_list.png');

    const issuesBreadcrumb = await evaluate(`
      (() => {
        const nav = document.querySelector('nav[aria-label="Đường dẫn điều hướng"]');
        return nav ? nav.textContent : '';
      })()
    `);
    assert.ok(
      issuesBreadcrumb.includes('Quản trị'),
      'Issues list must have Quản trị in breadcrumb',
    );
    assert.ok(
      issuesBreadcrumb.includes('Sổ tay Issues'),
      'Issues list must have Sổ tay Issues in breadcrumb',
    );

    // -------------------------------------------------------------
    // CAPTURE 2: Desktop 1440px Owner at /issues/ISS-001 (Detail)
    // -------------------------------------------------------------
    console.log('\n--- 2. Desktop 1440px Owner at /issues/ISS-001 ---');
    await navigateSPA('/issues/ISS-001');
    await capture('02_desktop_1440_owner_breadcrumb_issue_detail.png');

    const detailBreadcrumb = await evaluate(`
      (() => {
        const nav = document.querySelector('nav[aria-label="Đường dẫn điều hướng"]');
        return nav ? nav.textContent : '';
      })()
    `);
    assert.ok(
      detailBreadcrumb.includes('Quản trị'),
      'Detail must include Quản trị',
    );
    assert.ok(
      detailBreadcrumb.includes('Sổ tay Issues'),
      'Detail must include Sổ tay Issues',
    );
    assert.ok(
      detailBreadcrumb.includes('ISS-001'),
      'Detail must include ISS-001',
    );

    // -------------------------------------------------------------
    // CAPTURE 3: Desktop 1440px Owner at /audit (Exact Total ListFooter)
    // -------------------------------------------------------------
    await navigateSPA('/audit');
    await new Promise((r) => setTimeout(r, 800));
    const mainHtml = await evaluate(
      `document.querySelector('main')?.innerText || ''`,
    );
    console.log(
      'MAIN TEXT ON AUDIT:',
      mainHtml.slice(0, 200).replace(/\n/g, ' '),
    );
    await capture('03_desktop_1440_owner_audit_footer_exact_total.png');

    const auditFooterText = await evaluate(`
      (() => {
        const footer = document.querySelector('footer[aria-label="Điều hướng danh sách"]');
        return footer ? footer.textContent : '';
      })()
    `);
    console.log('AUDIT FOOTER TEXT IS:', JSON.stringify(auditFooterText));
    assert.ok(
      auditFooterText.includes('2.653') ||
        auditFooterText.includes('2,653') ||
        auditFooterText.includes('2653'),
      'Audit footer must show exact total 2.653',
    );
    assert.ok(
      auditFooterText.includes('Trước'),
      'Audit footer must have Trước button',
    );
    assert.ok(
      auditFooterText.includes('Sau'),
      'Audit footer must have Sau button',
    );

    // -------------------------------------------------------------
    // CAPTURE 4: Desktop 1440px Owner at /reports (Load More Footer)
    // -------------------------------------------------------------
    console.log('\n--- 4. Desktop 1440px Owner at /reports ---');
    await navigateSPA('/reports');
    await capture('04_desktop_1440_owner_reports_footer_load_more.png');

    const reportsFooterText = await evaluate(`
      (() => {
        const footer = document.querySelector('footer[aria-label="Điều hướng danh sách"]');
        return footer ? footer.textContent : '';
      })()
    `);
    assert.ok(
      reportsFooterText.includes('Tải thêm'),
      'Reports footer must have Tải thêm button',
    );

    // -------------------------------------------------------------
    // CAPTURE 5: Desktop 1440px Owner at /employees
    // -------------------------------------------------------------
    console.log('\n--- 5. Desktop 1440px Owner at /employees ---');
    await navigateSPA('/employees');
    await capture('05_desktop_1440_owner_employees_list_footer.png');

    // -------------------------------------------------------------
    // CAPTURE 6: Desktop 1440px Staff at /groups/hr-payroll
    // -------------------------------------------------------------
    console.log('\n--- 6. Desktop 1440px Staff at /groups/hr-payroll ---');
    await setMockRole('staff');
    await navigateSPA('/groups/hr-payroll');
    await capture('06_desktop_1440_staff_group_hr_mypay.png');

    const staffHrText = await evaluate(`
      (() => {
        const main = document.querySelector('main');
        return main ? main.textContent : '';
      })()
    `);
    assert.ok(
      staffHrText.includes('Lương cá nhân'),
      'Staff must see Lương cá nhân in hr-payroll',
    );
    assert.equal(
      staffHrText.includes('Quản lý danh sách nhân sự'),
      false,
      'Staff must NOT see employees in hr-payroll',
    );

    // -------------------------------------------------------------
    // CAPTURE 7: Desktop 1440px Staff at /groups/admin
    // -------------------------------------------------------------
    console.log('\n--- 7. Desktop 1440px Staff at /groups/admin ---');
    await navigateSPA('/groups/admin');
    await capture('07_desktop_1440_staff_group_admin_settings.png');

    const staffAdminText = await evaluate(`
      (() => {
        const main = document.querySelector('main');
        return main ? main.textContent : '';
      })()
    `);
    assert.ok(
      staffAdminText.includes('Cài đặt'),
      'Staff must see Cài đặt in admin',
    );
    assert.equal(
      staffAdminText.includes('Sổ tay Issues'),
      false,
      'Staff must NOT see Issues',
    );
    assert.equal(
      staffAdminText.includes('Nhật ký hoạt động'),
      false,
      'Staff must NOT see Audit',
    );

    // -------------------------------------------------------------
    // CAPTURE 8: Tablet 768px Owner at /clock
    // -------------------------------------------------------------
    console.log('\n--- 8. Tablet 768px Owner at /clock ---');
    await setMockRole('owner');
    await setViewport(768, 1024);
    await navigateSPA('/clock');
    await capture('08_tablet_768_owner_breadcrumb_clock.png');

    // -------------------------------------------------------------
    // CAPTURE 9: Mobile 390px Owner at /issues/ISS-001 (Back button)
    // -------------------------------------------------------------
    console.log('\n--- 9. Mobile 390px Owner at /issues/ISS-001 ---');
    await setViewport(390, 844);
    await navigateSPA('/issues/ISS-001');
    await capture('09_mobile_390_owner_back_button_issue_detail.png');

    const mobileBackButtonCheck = await evaluate(`
      (() => {
        const btn = document.querySelector('.mobile-breadcrumb-back button');
        if (!btn) return { exists: false };
        const rect = btn.getBoundingClientRect();
        return {
          exists: true,
          text: btn.textContent.trim(),
          width: rect.width,
          height: rect.height,
        };
      })()
    `);
    assert.ok(mobileBackButtonCheck.exists, 'Mobile back button must exist');
    assert.equal(
      mobileBackButtonCheck.text,
      'Sổ tay Issues',
      'Mobile back button on issue detail must target Sổ tay Issues',
    );
    assert.ok(
      mobileBackButtonCheck.height >= 44,
      'Mobile back button height must be >= 44px',
    );

    // Test clicking back button in mobile
    await evaluate(
      `document.querySelector('.mobile-breadcrumb-back button').click()`,
    );
    await new Promise((r) => setTimeout(r, 400));
    const currentPathAfterBack = await evaluate(`window.location.pathname`);
    assert.equal(
      currentPathAfterBack,
      '/issues',
      'Clicking mobile back button must navigate to /issues',
    );

    // -------------------------------------------------------------
    // CAPTURE 10: Mobile 390px Owner at /issues (Back to Admin group)
    // -------------------------------------------------------------
    console.log('\n--- 10. Mobile 390px Owner at /issues ---');
    await capture('10_mobile_390_owner_back_button_function.png');

    const mobileBackToGroupCheck = await evaluate(`
      (() => {
        const btn = document.querySelector('.mobile-breadcrumb-back button');
        return btn ? btn.textContent.trim() : '';
      })()
    `);
    assert.equal(
      mobileBackToGroupCheck,
      'Quản trị',
      'Mobile back button on /issues must target Quản trị',
    );

    // -------------------------------------------------------------
    // CAPTURE 11: Narrow Mobile 360px Owner at /reports
    // -------------------------------------------------------------
    console.log('\n--- 11. Narrow Mobile 360px Owner at /reports ---');
    await setViewport(360, 740);
    await navigateSPA('/reports');
    await capture('11_mobile_360_owner_reports_footer_compact.png');

    const overflow360 = await evaluate(`
      (() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      })()
    `);
    assert.equal(
      overflow360,
      false,
      '360px must have zero horizontal overflow',
    );

    console.log(
      '\n=== ALL 11 SCREENSHOTS CAPTURED & ALL VERIFICATIONS PASSED ===\n',
    );
  } finally {
    chrome.kill('SIGTERM');
  }
}

run().catch((err) => {
  console.error('Fatal error during capture:', err);
  process.exit(1);
});
