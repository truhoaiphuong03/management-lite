import { loadQaEndpoint, loadQaSecret } from './explicit-database.mjs';
const qaAdminPassword = loadQaSecret('ADMIN_PASSWORD');
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..');

const runId = Math.random().toString(36).substring(2, 8);
const webBase = loadQaEndpoint(process.env.QA_WEB_BASE);
const cdpPort = 9250;

async function runAllScreensQA() {
  console.log('======================================================');
  console.log('🌐 FULL 4-SCREEN CHROME CDP QA & DESIGN AUDIT');
  console.log(`Target: ${webBase}`);
  console.log('======================================================\n');

  mkdirSync(resolve(PROJECT_ROOT, 'docs/handoff/screenshots'), {
    recursive: true,
  });

  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${cdpPort}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=/tmp/chrome-all-qa-${runId}`,
      '--window-size=1280,900',
    ],
  );

  const checks = [];
  function record(section, name, pass, detail = '') {
    checks.push({ section, name, pass, detail });
    console.log(
      `  [${section}] ${pass ? '✔ PASS' : '✖ FAIL'}: ${name}${detail ? ` (${detail})` : ''}`,
    );
  }

  try {
    await new Promise((r) => setTimeout(r, 1500));
    const newTab = await fetch(
      `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(webBase + '/login')}`,
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

    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');

    const evalExp = async (exp) => {
      const r = await send('Runtime.evaluate', {
        expression: exp,
        returnByValue: true,
        awaitPromise: true,
      });
      return r.result?.value;
    };

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    const takeScreenshot = async (
      filename,
      width = 1280,
      height = 900,
      isMobile = false,
    ) => {
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: isMobile ? 2 : 1,
        mobile: isMobile,
      });
      await wait(300);
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const targetPath = resolve(
        PROJECT_ROOT,
        `docs/handoff/screenshots/${filename}`,
      );
      writeFileSync(targetPath, Buffer.from(shot.data, 'base64'));
      console.log(`    📸 Saved: docs/handoff/screenshots/${filename}`);
    };

    // ==========================================
    // 0. LOGIN AS OWNER
    // ==========================================
    console.log('\n--- 0. AUTHENTICATION (OWNER) ---');
    await wait(1500);

    const loginRes = await evalExp(`
      (async () => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const usernameInput = inputs[0];
        const passwordInput = inputs[1];
        if (!usernameInput || !passwordInput) return { success: false, reason: 'inputs not found' };

        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(usernameInput, 'admin');
        usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
        usernameInput.dispatchEvent(new Event('change', { bubbles: true }));

        nativeSetter.call(passwordInput, ${JSON.stringify(qaAdminPassword)});
        passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
        passwordInput.dispatchEvent(new Event('change', { bubbles: true }));

        await new Promise(r => setTimeout(r, 200));

        const submitBtn = document.querySelector('button[type="submit"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Đăng nhập'));
        if (!submitBtn) return { success: false, reason: 'submit button not found' };

        submitBtn.click();
        return { success: true };
      })()
    `);
    record('AUTH', 'Login as Owner (admin)', loginRes.success);
    await wait(2500);

    // Verify Sidebar Navigation contains "Thu chi cá nhân" for Owner
    const navCheck = await evalExp(`
      (() => {
        const links = Array.from(document.querySelectorAll('button, a'));
        const finLink = links.find(el => el.innerText.includes('Thu chi cá nhân'));
        return { hasFinLink: Boolean(finLink) };
      })()
    `);
    record(
      'AUTH',
      'Sidebar contains "Thu chi cá nhân" for Owner',
      navCheck.hasFinLink,
    );

    // ==========================================
    // SCREEN 1: TỔNG HỢP (/finance)
    // ==========================================
    console.log('\n--- 1. SCREEN 1: TỔNG HỢP (/finance) ---');
    await evalExp(`
      window.history.pushState(null, "", "/finance");
      window.dispatchEvent(new Event("popstate"));
    `);
    await wait(1500);

    const s1Check = await evalExp(`
      (() => {
        const text = document.body.innerText;
        const hasTitle = /thu chi/i.test(text);
        const hasNav = Boolean(document.querySelector('nav[aria-label="Thu chi cá nhân"]'));
        const hasIncome = /tổng thu/i.test(text);
        const hasExpense = /tổng chi/i.test(text);
        const hasNet = /chênh lệch thu chi/i.test(text);
        const hasPeriod = Boolean(document.querySelector('select')) || text.includes('Tháng');
        const hasCategoryBreakdown = /danh mục/i.test(text);
        return { hasTitle, hasNav, hasIncome, hasExpense, hasNet, hasPeriod, hasCategoryBreakdown };
      })()
    `);
    record(
      'SCREEN 1',
      'Screen title "Thu chi cá nhân" renders',
      s1Check.hasTitle,
    );
    record('SCREEN 1', 'FinanceNav sub-navigation renders', s1Check.hasNav);
    record(
      'SCREEN 1',
      'Metrics (Tổng thu, Tổng chi, Chênh lệch) present',
      s1Check.hasIncome && s1Check.hasExpense && s1Check.hasNet,
    );
    record(
      'SCREEN 1',
      'Period selector and date filter present',
      s1Check.hasPeriod,
    );
    record(
      'SCREEN 1',
      'Category breakdown section present',
      s1Check.hasCategoryBreakdown,
    );

    await takeScreenshot('screen1-overview-desktop.png', 1280, 900, false);
    await takeScreenshot('screen1-overview-mobile.png', 390, 844, true);

    // ==========================================
    // SCREEN 2: POPUP THÊM THU/CHI (mở từ Tổng hợp; /finance/new chỉ còn là đường dẫn tương thích)
    // ==========================================
    console.log('\n--- 2. SCREEN 2: POPUP THÊM THU/CHI (từ /finance) ---');
    const navTabs = await evalExp(`
      Array.from(document.querySelectorAll('nav[aria-label="Thu chi cá nhân"] button')).map(b => b.textContent.trim())
    `);
    record(
      'SCREEN 2',
      'Thanh FIN không còn tab "Thêm thu/chi" (4 mục)',
      navTabs.length === 4 && !navTabs.includes('Thêm thu/chi'),
      JSON.stringify(navTabs),
    );
    await evalExp(`
      Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Thêm thu/chi')).click()
    `);
    await wait(1200);

    const s2Check = await evalExp(`
      (() => {
        const dlg = document.querySelector('[role="dialog"]');
        const text = dlg ? dlg.innerText : '';
        const selects = dlg ? Array.from(dlg.querySelectorAll('select')) : [];
        const catSelect = selects[1];
        const amountInput = dlg ? dlg.querySelector('input[inputmode="numeric"]') : null;
        const submitBtn = dlg ? Array.from(dlg.querySelectorAll('button')).find(b => b.innerText.includes('Lưu giao dịch')) : null;
        const catOptions = catSelect ? Array.from(catSelect.options).map(o => o.text) : [];
        return {
          isDialog: Boolean(dlg),
          samePath: window.location.pathname === '/finance',
          hasDirSelect: Boolean(selects[0]),
          hasCatSelect: Boolean(catSelect),
          catOptionCount: catOptions.length,
          hasAmountInput: Boolean(amountInput),
          hasTimeToggle: text.includes('Tự động ghi ngày giờ khi lưu'),
          hasReceiptPanel: text.includes('Ảnh hóa đơn'),
          hasSubmitBtn: Boolean(submitBtn),
        };
      })()
    `);
    record(
      'SCREEN 2',
      'Bấm "+ Thêm thu/chi" mở AppDialog, không chuyển trang',
      s2Check.isDialog && s2Check.samePath,
    );
    record(
      'SCREEN 2',
      'Form fields: Type (Thu/Chi) selector present',
      s2Check.hasDirSelect,
    );
    record(
      'SCREEN 2',
      'Form fields: Category selector loaded with options',
      s2Check.hasCatSelect && s2Check.catOptionCount > 1,
      `count: ${s2Check.catOptionCount}`,
    );
    record(
      'SCREEN 2',
      'Form fields: Amount VND numeric input present',
      s2Check.hasAmountInput,
    );
    record(
      'SCREEN 2',
      'Form fields: Automatic / manual time option present',
      s2Check.hasTimeToggle,
    );
    record(
      'SCREEN 2',
      'Form fields: Receipt upload panel present',
      s2Check.hasReceiptPanel,
    );
    record(
      'SCREEN 2',
      'Submit button "Lưu giao dịch" present',
      s2Check.hasSubmitBtn,
    );

    await takeScreenshot('screen2-entry-desktop.png', 1280, 900, false);
    await takeScreenshot('screen2-entry-mobile.png', 390, 844, true);

    // Đóng bằng Esc (form chưa nhập → đóng ngay)
    await evalExp(
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
    );
    await wait(600);
    const closed = await evalExp(`!document.querySelector('[role="dialog"]')`);
    record('SCREEN 2', 'Esc đóng popup khi chưa nhập dữ liệu', closed);

    // Đường dẫn cũ /finance/new: chuyển về /finance và mở popup
    await evalExp(`
      window.history.pushState(null, "", "/finance/new");
      window.dispatchEvent(new Event("popstate"));
    `);
    await wait(1500);
    const legacy = await evalExp(
      `({ path: window.location.pathname, dialog: Boolean(document.querySelector('[role="dialog"]')) })`,
    );
    record(
      'SCREEN 2',
      'Đường dẫn cũ /finance/new chuyển về /finance và mở popup',
      legacy.path === '/finance' && legacy.dialog,
      JSON.stringify(legacy),
    );
    await evalExp(
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`,
    );
    await wait(600);

    // ==========================================
    // SCREEN 3: LỊCH SỬ (/finance/history)
    // ==========================================
    console.log('\n--- 3. SCREEN 3: LỊCH SỬ (/finance/history) ---');
    await evalExp(`
      window.history.pushState(null, "", "/finance/history");
      window.dispatchEvent(new Event("popstate"));
    `);
    await wait(1500);

    const s3Check = await evalExp(`
      (() => {
        const text = document.body.innerText;
        const hasTitle = text.includes('Lịch sử thu chi');
        const selects = Array.from(document.querySelectorAll('select'));
        const dateInputs = Array.from(document.querySelectorAll('input[type="date"]'));
        const detailBtns = Array.from(document.querySelectorAll('button')).filter(b => b.dataset.action==='view');
        const hasCards = document.querySelectorAll('div[style*="border-radius"]').length > 0;
        const hasPagination = text.includes('giao dịch') || Boolean(document.querySelector('footer, [role="status"]'));

        return {
          hasTitle,
          filterSelectsCount: selects.length,
          dateInputsCount: dateInputs.length,
          detailBtnsCount: detailBtns.length,
          hasCards,
          hasPagination,
        };
      })()
    `);
    record(
      'SCREEN 3',
      'Screen title "Lịch sử thu chi" renders',
      s3Check.hasTitle,
    );
    record(
      'SCREEN 3',
      'Filter controls (Type, Category, From, To) present',
      s3Check.filterSelectsCount >= 2 && s3Check.dateInputsCount >= 2,
    );
    record(
      'SCREEN 3',
      'Transaction cards rendered with "Chi tiết" button',
      s3Check.detailBtnsCount > 0,
      `found ${s3Check.detailBtnsCount} entries`,
    );

    await takeScreenshot('screen3-history-desktop.png', 1280, 900, false);
    await takeScreenshot('screen3-history-mobile.png', 390, 844, true);

    // ==========================================
    // SCREEN 3b: XEM CHI TIẾT & SỬA GIAO DỊCH
    // ==========================================
    console.log('\n--- 3b. DETAIL & CORRECTION SCREEN ---');
    if (s3Check.detailBtnsCount > 0) {
      await evalExp(`
        (() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.dataset.action==='view');
          if (btn) btn.click();
        })()
      `);
      await wait(1500);

      const s3bCheck = await evalExp(`
        (() => {
          const text = document.body.innerText;
          const hasCorrectionBtn = Array.from(document.querySelectorAll('button')).some(b => b.innerText.includes('Chỉnh sửa có lý do'));
          const hasCorrectionHistory = text.includes('Lịch sử chỉnh sửa');
          return { hasCorrectionBtn, hasCorrectionHistory, url: window.location.pathname };
        })()
      `);
      record(
        'SCREEN 3b',
        'Transaction detail opens with "Chỉnh sửa có lý do"',
        s3bCheck.hasCorrectionBtn,
        s3bCheck.url,
      );
      record(
        'SCREEN 3b',
        'Correction history section present',
        s3bCheck.hasCorrectionHistory,
      );

      await takeScreenshot('screen3b-detail-desktop.png', 1280, 900, false);
      await takeScreenshot('screen3b-detail-mobile.png', 390, 844, true);
    }

    // ==========================================
    // SCREEN 4: DANH MỤC (/finance/categories)
    // ==========================================
    console.log('\n--- 4. SCREEN 4: DANH MỤC (/finance/categories) ---');
    await evalExp(`
      window.history.pushState(null, "", "/finance/categories");
      window.dispatchEvent(new Event("popstate"));
    `);
    await wait(1500);

    const s4Check = await evalExp(`
      (() => {
        const text = document.body.innerText;
        const hasTitle = text.includes('Danh mục thu chi');
        const buttons = Array.from(document.querySelectorAll('button'));
        const renameBtns = buttons.filter(b => b.dataset.action==='edit');
        const deactivateBtns = buttons.filter(b => b.dataset.action==='deactivate');
        const badges = Array.from(document.querySelectorAll('span')).filter(s => s.innerText === 'Đang dùng' || s.innerText === 'Ngừng dùng');

        let minGap = 999;
        let overlap = false;
        if (renameBtns[0] && deactivateBtns[0]) {
          const rRect = renameBtns[0].getBoundingClientRect();
          const dRect = deactivateBtns[0].getBoundingClientRect();
          minGap = dRect.left - rRect.right;
          if (rRect.right > dRect.left && rRect.bottom > dRect.top) overlap = true;
        }

        const tabs = buttons.filter(b => b.innerText.includes('Khoản chi') || b.innerText.includes('Nguồn thu'));

        return {
          hasTitle,
          catCount: renameBtns.length,
          badgeCount: badges.length,
          buttonGap: minGap,
          buttonOverlap: overlap,
          hasTabs: tabs.length >= 2,
        };
      })()
    `);
    record('SCREEN 4', 'Title "Danh mục thu chi" renders', s4Check.hasTitle);
    record(
      'SCREEN 4',
      'Compact category rows rendered (>0)',
      s4Check.catCount > 0,
      `${s4Check.catCount} categories`,
    );
    record(
      'SCREEN 4',
      'Action buttons gap >= 8px and NO overlap',
      s4Check.buttonGap >= 8 && !s4Check.buttonOverlap,
      `gap = ${s4Check.buttonGap}px`,
    );
    record(
      'SCREEN 4',
      'Status badges displayed ("Đang dùng" / "Ngừng dùng")',
      s4Check.badgeCount > 0,
    );
    record(
      'SCREEN 4',
      'Segmented tabs (Khoản chi / Nguồn thu) present',
      s4Check.hasTabs,
    );

    await takeScreenshot('screen4-categories-desktop.png', 1280, 900, false);
    await takeScreenshot('screen4-categories-mobile.png', 390, 844, true);

    // ==========================================
    // 5. RBAC CHECK (STAFF ISOLATION)
    // ==========================================
    console.log('\n--- 5. RBAC & ISOLATION CHECK (STAFF) ---');
    // Logout Owner
    await evalExp(`
      (() => {
        const logoutBtn = Array.from(document.querySelectorAll('button, a')).find(b => b.innerText.includes('Đăng xuất'));
        if (logoutBtn) logoutBtn.click();
      })()
    `);
    await wait(1500);

    // If still on page, navigate to login
    await send('Page.navigate', { url: `${webBase}/login` });
    await wait(1500);

    // Login as Staff
    const staffPass = loadQaSecret('STAFF_PASSWORD');
    const staffLogin = await evalExp(`
      (async () => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const usernameInput = inputs[0];
        const passwordInput = inputs[1];
        if (!usernameInput || !passwordInput) return { success: false, reason: 'inputs not found' };

        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(usernameInput, 'staff');
        usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
        usernameInput.dispatchEvent(new Event('change', { bubbles: true }));

        nativeSetter.call(passwordInput, ${JSON.stringify(staffPass)});
        passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
        passwordInput.dispatchEvent(new Event('change', { bubbles: true }));

        await new Promise(r => setTimeout(r, 200));

        const submitBtn = document.querySelector('button[type="submit"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Đăng nhập'));
        if (!submitBtn) return { success: false, reason: 'submit button not found' };

        submitBtn.click();
        return { success: true };
      })()
    `);
    record('RBAC', 'Login as Staff (staff)', staffLogin.success);
    await wait(2500);

    // Check Staff navigation menu DOES NOT have "Thu chi cá nhân"
    const staffNavCheck = await evalExp(`
      (() => {
        const text = document.body.innerText;
        const hasFin = text.includes('Thu chi cá nhân');
        const links = Array.from(document.querySelectorAll('button, a'));
        const finLink = links.find(el => el.innerText.includes('Thu chi cá nhân'));
        return { hasFinInText: hasFin, hasFinLink: Boolean(finLink) };
      })()
    `);
    record(
      'RBAC',
      'Staff sidebar HIDES "Thu chi cá nhân"',
      !staffNavCheck.hasFinLink,
    );

    // Try navigating to /finance as Staff
    await evalExp(`
      window.history.pushState(null, "", "/finance");
      window.dispatchEvent(new Event("popstate"));
    `);
    await wait(1000);

    const staffAccessCheck = await evalExp(`
      (() => {
        const text = document.body.innerText;
        // Staff should be redirected or see empty/denied state, not finance data
        const hasEntries = text.includes('Tổng thu') || text.includes('Tổng chi');
        return { hasEntries, path: window.location.pathname };
      })()
    `);
    record(
      'RBAC',
      'Staff CANNOT access /finance data (denied/redirected)',
      !staffAccessCheck.hasEntries,
      `path: ${staffAccessCheck.path}`,
    );

    await takeScreenshot('staff-isolation-desktop.png', 1280, 900, false);

    ws.close();
    chrome.kill();

    const allPassed = checks.every((c) => c.pass);
    console.log('\n======================================================');
    console.log(
      `TOTAL CHECKS: ${checks.length} | PASS: ${checks.filter((c) => c.pass).length} | FAIL: ${checks.filter((c) => !c.pass).length}`,
    );
    console.log(
      `CONCLUSION: ${allPassed ? 'ALL PASS (QA AUDIT COMPLETE)' : 'FAILED'}`,
    );
    console.log('======================================================');

    process.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('Audit execution error:', err);
    chrome.kill();
    process.exit(1);
  }
}

runAllScreensQA();
