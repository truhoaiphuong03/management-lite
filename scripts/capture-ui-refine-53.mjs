import { loadQaEndpoint } from './explicit-database.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const screenshotsDir = resolve(root, 'docs/handoff/UI-REFINE-53/screenshots');

const port = 9253;
const runId = Math.random().toString(36).substring(2, 8);
const targetUrl = loadQaEndpoint(process.env.QA_WEB_BASE);

async function run() {
  console.log('=== STARTING UI-REFINE-53 AUTOMATED VERIFICATION & SCREENSHOT CAPTURE ===\n');

  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=/tmp/chrome-refine-53-${runId}`,
    ],
  );

  try {
    await new Promise((r) => setTimeout(r, 1500));

    const newTab = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
      method: 'PUT',
    }).then((r) => r.json());

    const ws = new WebSocket(newTab.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));

    let msgId = 1;
    const callbacks = new Map();

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
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
            (r.exceptionDetails.exception?.description || '')
        );
      }
      return r.result?.value;
    };

    await send('Page.enable');
    await send('Runtime.enable');
    await send('Network.enable');

    // Setup session mocking before page loads
    await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (() => {
          window.fetch = async (url) => {
            const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
            if (urlStr.includes('/api/v1/auth/me')) {
              const currentRole = document.cookie.includes('mock_role=staff') ? 'staff' : 'owner';
              return {
                ok: true,
                status: 200,
                json: async () => ({
                  success: true,
                  data: {
                    user: { id: 'usr-1', email: 'user@mglite.vn', full_name: currentRole === 'owner' ? 'Trần Chủ Sở Hữu' : 'Lê Nhân Viên' },
                    active_workspace: {
                      id: 'ws-1',
                      name: 'Management Lite Production',
                      role: currentRole,
                    },
                    csrf_token: 'csrf-refine-53',
                  },
                }),
              };
            }
            if (urlStr.includes('/api/v1/')) {
              return {
                ok: true,
                status: 200,
                json: async () => ({ success: true, data: { items: [], next_cursor: null } }),
              };
            }
            throw new Error('Blocked: ' + urlStr);
          };
        })()
      `,
    });

    await send('Page.navigate', { url: targetUrl });
    await new Promise((r) => setTimeout(r, 1200));

    // Helper: set viewport
    const setViewport = async (width, height, isMobile = false) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 2,
        mobile: isMobile,
      });
      await send('Emulation.setVisibleSize', { width, height });
    };

    // Helper: capture screenshot
    const capture = async (filename) => {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      const filePath = resolve(screenshotsDir, filename);
      writeFileSync(filePath, Buffer.from(data, 'base64'));
      console.log(`📸 Saved screenshot: ${filename}`);
    };

    // Helper: navigate within SPA
    const navigateSPA = async (path) => {
      await evaluate(`
        window.history.pushState({}, '', '${path}');
        window.dispatchEvent(new PopStateEvent('popstate'));
      `);
      await new Promise((r) => setTimeout(r, 200));
    };

    // Helper: switch mock role
    const setRole = async (role) => {
      await evaluate(`document.cookie = 'mock_role=${role}; path=/'`);
      // Reload app session
      await send('Page.navigate', { url: targetUrl });
      await new Promise((r) => setTimeout(r, 1200));
    };

    // =========================================================================
    // 1. DESKTOP VIEWPORT (1440x900) — OWNER SCREENSHOTS & CHECKS
    // =========================================================================
    console.log('--- 1. Capturing Desktop 1440x900 (Owner) ---');
    await setViewport(1440, 900, false);
    await navigateSPA('/');
    await capture('01_desktop_1440_owner_sidebar_overview.png');

    await navigateSPA('/groups/attendance');
    await capture('02_desktop_1440_owner_group_attendance.png');

    await navigateSPA('/groups/work');
    await capture('03_desktop_1440_owner_group_work.png');

    await navigateSPA('/groups/hr-payroll');
    await capture('04_desktop_1440_owner_group_hr_payroll.png');

    await navigateSPA('/groups/admin');
    await capture('05_desktop_1440_owner_group_admin.png');

    // Check: HR-Payroll has Nhân sự card and it is NOT "Chưa triển khai"
    const hrCardStatus = await evaluate(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const empBtn = buttons.find(b => b.textContent.includes('Nhân sự'));
        const hasUnimplementedBadge = document.body.textContent.includes('Chưa triển khai');
        return {
          hasEmpButton: Boolean(empBtn),
          empButtonText: empBtn ? empBtn.textContent : null,
          hasUnimplementedBadge,
        };
      })()
    `);
    console.log('HR-Payroll check (Owner):', hrCardStatus);
    assert.equal(hrCardStatus.hasEmpButton, true, 'Owner MUST see clickable Nhân sự card');
    assert.equal(hrCardStatus.hasUnimplementedBadge, false, 'Nhân sự card must NOT show Chưa triển khai');
    console.log('✔ Section 4 Check: Owner can access Nhân sự card directly: PASS');

    // =========================================================================
    // 2. DESKTOP VIEWPORT (1440x900) — STAFF SCREENSHOTS & RBAC CHECKS
    // =========================================================================
    console.log('\n--- 2. Capturing Desktop 1440x900 (Staff) ---');
    await setRole('staff');

    await navigateSPA('/groups/hr-payroll');
    await capture('06_desktop_1440_staff_group_hr_payroll.png');

    const staffHrStatus = await evaluate(`
      (() => {
        const main = document.querySelector('main') || document.body;
        const cards = Array.from(main.querySelectorAll('button, div[aria-disabled="true"]'));
        const cardTexts = cards.map(c => c.textContent);
        return {
          cardTexts,
          hasMyPay: cardTexts.some(t => t.includes('Lương cá nhân')),
          hasEmployeesCard: cardTexts.some(t => t.includes('Quản lý danh sách nhân sự')),
          hasPayrollCard: cardTexts.some(t => t.includes('Bảng lương')),
        };
      })()
    `);
    console.log('Staff HR Group check:', staffHrStatus);
    assert.equal(staffHrStatus.hasMyPay, true, 'Staff sees Lương cá nhân card');
    assert.equal(staffHrStatus.hasEmployeesCard, false, 'Staff NEVER sees Nhân sự card');
    assert.equal(staffHrStatus.hasPayrollCard, false, 'Staff NEVER sees Bảng lương card');
    console.log('✔ Staff RBAC in Group Overview: PASS');

    await navigateSPA('/groups/admin');
    await capture('07_desktop_1440_staff_group_admin.png');

    // =========================================================================
    // 3. MOBILE VIEWPORTS (390x844 & 360x640)
    // =========================================================================
    console.log('\n--- 3. Capturing Mobile 390x844 & 360x640 ---');
    await setRole('owner');
    await setViewport(390, 844, true);

    await navigateSPA('/groups/attendance');
    await capture('08_mobile_390_owner_group_attendance.png');

    await navigateSPA('/groups/hr-payroll');
    await capture('09_mobile_390_owner_group_hr_payroll.png');

    await setViewport(360, 640, true);
    await navigateSPA('/groups/work');
    await capture('10_mobile_360_owner_group_work.png');

    // Check horizontal overflow at 360px
    const overflowCheck = await evaluate(`
      (() => {
        const docWidth = document.documentElement.scrollWidth;
        const winWidth = window.innerWidth;
        return {
          docWidth,
          winWidth,
          hasHorizontalOverflow: docWidth > winWidth,
        };
      })()
    `);
    console.log('360px horizontal overflow check:', overflowCheck);
    assert.equal(overflowCheck.hasHorizontalOverflow, false, 'No horizontal overflow at 360px');
    console.log('✔ Mobile 360px zero horizontal overflow: PASS');

    // =========================================================================
    // 4. FUNCTIONAL INTERACTION CHECKS (Click, Active Group, Detail, Back, Unknown)
    // =========================================================================
    console.log('\n--- 4. Functional Verification ---');
    await setViewport(1440, 900, false);

    // 4A: Card click navigation: clicking "Chấm công" card navigates to /clock
    await navigateSPA('/groups/attendance');
    const navResult = await evaluate(`
      (() => {
        const main = document.querySelector('main');
        const buttons = Array.from(main ? main.querySelectorAll('button') : document.querySelectorAll('button'));
        const clockCard = buttons.find(b => b.textContent.includes('Chấm công') && !b.textContent.includes('Ca &'));
        if (!clockCard) return { clicked: false, error: 'Chấm công card not found in main' };
        clockCard.click();
        return { clicked: true, pathAfter: window.location.pathname };
      })()
    `);
    await new Promise((r) => setTimeout(r, 200));
    const pathAfterClick = await evaluate(`window.location.pathname`);
    console.log('Card click navigation result:', { navResult, pathAfterClick });
    assert.equal(pathAfterClick, '/clock', 'Clicking card navigates to /clock');
    console.log('✔ Card semantic navigation to child screen: PASS');

    // 4B: Active group highlighting on detail routes (/issues/ISS-001)
    await navigateSPA('/issues/ISS-001');
    const detailActiveGroup = await evaluate(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('nav[aria-label="Desktop navigation"] button'));
        const adminBtn = buttons.find(b => b.textContent.includes('Quản trị'));
        const attendanceBtn = buttons.find(b => b.textContent.includes('Ca & Chấm công'));
        return {
          adminColor: adminBtn ? adminBtn.style.color : null,
          attendanceColor: attendanceBtn ? attendanceBtn.style.color : null,
          adminActive: adminBtn ? adminBtn.style.borderColor.includes('rgba(20, 184, 166') : false,
          attendanceActive: attendanceBtn ? attendanceBtn.style.borderColor.includes('rgba(20, 184, 166') : false,
        };
      })()
    `);
    console.log('Detail route active group check (/issues/ISS-001):', detailActiveGroup);
    assert.equal(detailActiveGroup.adminActive, true, 'Quản trị group button MUST be active on /issues/ISS-001');
    assert.equal(detailActiveGroup.attendanceActive, false, 'Other groups must not be active');
    console.log('✔ Active group detection on detail routes: PASS');

    // 4C: Unknown group fallback
    await navigateSPA('/groups/non-existent-group-xyz');
    const unknownGroupStatus = await evaluate(`
      (() => {
        const text = document.body.textContent;
        return {
          hasNotFoundTitle: text.includes('Không tìm thấy nhóm chức năng'),
          hasGoBackButton: Boolean(Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Quay lại Tổng quan'))),
        };
      })()
    `);
    console.log('Unknown group handling:', unknownGroupStatus);
    assert.equal(unknownGroupStatus.hasNotFoundTitle, true, 'Renders safe fallback for unknown group');
    assert.equal(unknownGroupStatus.hasGoBackButton, true, 'Renders Quay lại Tổng quan button');
    console.log('✔ Unknown group fallback screen: PASS');

    // 4D: Report bug button aesthetic check
    await navigateSPA('/');
    const reportBugBtnStyle = await evaluate(`
      (() => {
        const btn = document.querySelector('[data-testid="btn-open-report-bug"]');
        if (!btn) return null;
        return {
          background: btn.style.backgroundColor,
          color: btn.style.color,
          boxShadow: btn.style.boxShadow,
          minHeight: btn.style.minHeight,
        };
      })()
    `);
    console.log('ReportBug button styles:', reportBugBtnStyle);
    assert.equal(reportBugBtnStyle.background, 'rgb(30, 41, 59)', 'Button uses dark slate token');
    assert.ok(!reportBugBtnStyle.boxShadow.includes('220, 38, 38'), 'No glowing red shadow');
    assert.equal(reportBugBtnStyle.minHeight, '44px', 'Meets 44px touch target');
    console.log('✔ Report bug button toned-down styling: PASS');

    ws.close();
    console.log('\n=== ALL UI-REFINE-53 SCREENSHOTS & LIVE CHECKS COMPLETED PERFECTLY ===\n');
  } finally {
    chrome.kill();
  }
}

run().catch((err) => {
  console.error('Run failed:', err);
  process.exit(1);
});
