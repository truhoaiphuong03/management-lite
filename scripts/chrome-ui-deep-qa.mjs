import { loadQaEndpoint } from './explicit-database.mjs';
const webBase = loadQaEndpoint(process.env.QA_WEB_BASE);
import { spawn } from 'node:child_process';
import { getAcceptanceOwnerCredentials } from './qa-credentials-reader.mjs';

const ownerCreds = getAcceptanceOwnerCredentials();
const adminPass = ownerCreds.password;

const runId = Math.random().toString(36).substring(2, 8);

const testResults = [];
function recordStep(category, stepName, isPass, detail = '') {
  testResults.push({ category, stepName, isPass, detail });
  const status = isPass ? '[PASS]' : '[FAIL]';
  console.log(
    `  ${status} [${category}] ${stepName}${detail ? ` - ${detail}` : ''}`,
  );
}

async function main() {
  console.log('\n======================================================');
  console.log('🌐 MANAGEMENT LITE: COMPREHENSIVE CHROME CDP UI SUITE');
  console.log('======================================================\n');

  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=9226',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=/tmp/chrome-qa-profile-${runId}`,
    ],
  );

  try {
    await new Promise((r) => setTimeout(r, 1500));
    const newTab = await fetch(
      `http://127.0.0.1:9226/json/new?${webBase + '/login'}`,
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

    const evaluate = async (exp, timeout = 12000) => {
      const timer = new Promise((_, rej) =>
        setTimeout(
          () =>
            rej(
              new Error(
                `CDP evaluation timed out after ${timeout}ms: ${exp.slice(0, 80)}`,
              ),
            ),
          timeout,
        ),
      );
      const evalPromise = send('Runtime.evaluate', {
        expression: exp,
        returnByValue: true,
        awaitPromise: true,
      });
      const r = await Promise.race([evalPromise, timer]);
      return r.result?.value;
    };

    await send('Page.enable');
    await send('DOM.enable');
    await send('Page.navigate', { url: webBase + '/login' });

    // Set standard desktop viewport
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await new Promise((r) => setTimeout(r, 800));

    // -------------------------------------------------------------
    // FLOW 1: AUTHENTICATION UI
    // -------------------------------------------------------------
    console.log('[FLOW 1: AUTHENTICATION UI]');
    const loginRendered = await evaluate(
      `Boolean(document.querySelector('input[type=password]') && [...document.querySelectorAll('button')].some(b => b.type === 'submit' && b.textContent.includes('Đăng nhập')))`,
    );
    recordStep(
      'AUTH',
      'Login screen mounted with password form and submit action',
      loginRendered,
    );

    // Perform interactive UI login
    await evaluate(`
      (async () => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const uInput = inputs[0];
        const pInput = inputs[1];
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

        nativeSetter.call(uInput, 'admin');
        uInput.dispatchEvent(new Event('input', { bubbles: true }));
        uInput.dispatchEvent(new Event('change', { bubbles: true }));

        nativeSetter.call(pInput, ${JSON.stringify(adminPass)});
        pInput.dispatchEvent(new Event('input', { bubbles: true }));
        pInput.dispatchEvent(new Event('change', { bubbles: true }));

        await new Promise(r => setTimeout(r, 100));
        const btn = document.querySelector('button[type="submit"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Đăng nhập'));
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 2000));

    const loggedInHeader = await evaluate(
      'document.querySelector("header")?.textContent',
    );
    const isLoggedIn = loggedInHeader
      ?.toLowerCase()
      .includes('management lite');
    recordStep(
      'AUTH',
      'Login submission succeeded and mounted AppShell',
      isLoggedIn,
    );

    // -------------------------------------------------------------
    // FLOW 2: NHÂN SỰ (HR) UI: TẠO, XEM CHI TIẾT, SỬA, BẢO VỆ KHÓA
    // -------------------------------------------------------------
    console.log('\n[FLOW 2: NHÂN SỰ (HR) UI]');

    // 2.1 Navigate to /employees/new
    await evaluate(
      `window.history.pushState(null, '', '/employees/new'); window.dispatchEvent(new Event('popstate'));`,
    );
    await new Promise((r) => setTimeout(r, 1000));

    const newEmpPage = await evaluate(
      'document.querySelector("h1, h2")?.textContent',
    );
    recordStep(
      'EMP',
      'Navigate to Create Employee page (/employees/new)',
      newEmpPage?.includes('Tạo nhân sự mới') ||
        newEmpPage?.includes('nhân sự'),
    );

    // 2.2 Form Validation check: Empty submit displays error
    await evaluate(`
      (() => {
        const submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Tạo nhân sự mới') || b.type === 'submit');
        if (submitBtn) submitBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));
    const validationErr = await evaluate('document.body.textContent');
    const hasValidationErr = validationErr.includes('Vui lòng điền đầy đủ');
    recordStep(
      'EMP',
      'Client-side form validation triggers on empty submit',
      hasValidationErr,
    );

    // 2.3 Fill form & submit
    const empCode = `NV_UI_${runId}`;
    const empName = `Nhân viên UI ${runId}`;
    const empEmail = `ui_${runId}@mglite.vn`;

    await evaluate(`
      (async () => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

        const codeInp = inputs.find(i => i.placeholder?.includes('NV') || i.name?.includes('code')) || inputs[0];
        const nameInp = inputs.find(i => i.placeholder?.includes('Nguyễn') || i.name?.includes('name')) || inputs[1];
        const emailInp = inputs.find(i => i.type === 'email' || i.name?.includes('email')) || inputs[2];

        if (codeInp) {
          nativeSetter.call(codeInp, '${empCode}');
          codeInp.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (nameInp) {
          nativeSetter.call(nameInp, '${empName}');
          nameInp.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (emailInp) {
          nativeSetter.call(emailInp, '${empEmail}');
          emailInp.dispatchEvent(new Event('input', { bubbles: true }));
        }

        await new Promise(r => setTimeout(r, 150));
        const submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Tạo nhân sự mới') || b.type === 'submit');
        if (submitBtn) submitBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 2000));

    const inviteResult = await evaluate('document.body.textContent');
    const inviteGenerated =
      inviteResult.includes('Liên kết kích hoạt') ||
      inviteResult.includes('/activate?token=');
    recordStep(
      'EMP',
      'Employee creation yields activation invite link in UI',
      inviteGenerated,
    );

    // 2.4 Verify employee listed in /employees table
    await evaluate(`
      (() => {
        const backBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Về danh sách nhân sự'));
        if (backBtn) {
          backBtn.click();
        } else {
          window.history.pushState(null, '', '/employees');
          window.dispatchEvent(new Event('popstate'));
        }
      })()
    `);

    // Poll until Employees table is rendered and not loading
    for (let i = 0; i < 25; i++) {
      const loaded = await evaluate(`
        document.body.textContent.includes('Quản lý nhân sự') && !document.body.textContent.includes('Đang tải danh sách')
      `);
      if (loaded) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    const listText = await evaluate('document.body.textContent');
    const inList = listText.includes(empCode) && listText.includes(empName);
    recordStep(
      'EMP',
      'Newly created employee appears in Employee list table',
      inList,
    );

    // 2.5 Verify Owner self-suspend guard in UI
    const selfLockGuard = await evaluate(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const suspendBtns = buttons.filter(b => b.dataset.action === 'deactivate' && b.getAttribute('title')?.includes('Chủ sở hữu'));
        const disabledBtn = suspendBtns.find(b => b.disabled || b.hasAttribute('disabled'));
        return {
          foundDisabled: Boolean(disabledBtn),
          tooltip: disabledBtn?.getAttribute('title') || '',
        };
      })()
    `);
    recordStep(
      'EMP',
      'Owner self-suspend button is disabled with safety tooltip in UI',
      selfLockGuard.foundDisabled &&
        selfLockGuard.tooltip.includes('chính mình'),
    );

    // -------------------------------------------------------------
    // FLOW 3: WORK (QUẢN LÝ CÔNG VIỆC) UI
    // -------------------------------------------------------------
    console.log('\n[FLOW 3: WORK (QUẢN LÝ CÔNG VIỆC) UI]');

    await evaluate(
      `window.history.pushState(null, '', '/work/new'); window.dispatchEvent(new Event('popstate'));`,
    );
    await new Promise((r) => setTimeout(r, 1000));

    const workNewPage = await evaluate(
      'document.querySelector("h1, h2")?.textContent',
    );
    recordStep(
      'WORK',
      'Navigate to Create Work page (/work/new)',
      Boolean(workNewPage),
    );

    const workTitle = `Nhiệm vụ Chrome UI ${runId}`;
    await evaluate(`
      (async () => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const textareas = Array.from(document.querySelectorAll('textarea'));
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const nativeAreaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;

        const titleInp = inputs[0];
        if (titleInp) {
          nativeSetter.call(titleInp, '${workTitle}');
          titleInp.dispatchEvent(new Event('input', { bubbles: true }));
        }

        const descArea = textareas[0];
        if (descArea) {
          nativeAreaSetter.call(descArea, 'Nội dung kiểm thử tương tác Chrome CDP UI');
          descArea.dispatchEvent(new Event('input', { bubbles: true }));
        }

        await new Promise(r => setTimeout(r, 150));
        const submitBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Tạo') || b.type === 'submit');
        if (submitBtn) submitBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 2000));

    await evaluate(
      `window.history.pushState(null, '', '/work'); window.dispatchEvent(new Event('popstate'));`,
    );
    await new Promise((r) => setTimeout(r, 1200));

    const workListText = await evaluate('document.body.textContent');
    const workCreated = workListText.includes(workTitle);
    recordStep(
      'WORK',
      'Work item created via form and rendered in list table',
      workCreated,
    );

    // -------------------------------------------------------------
    // FLOW 4: ACC (TÀI KHOẢN & SECRET VAULT) UI
    // -------------------------------------------------------------
    console.log('\n[FLOW 4: ACC (TÀI KHOẢN & SECRET VAULT) UI]');

    await evaluate(
      `window.history.pushState(null, '', '/accounts'); window.dispatchEvent(new Event('popstate'));`,
    );
    await new Promise((r) => setTimeout(r, 1200));

    // 4.1 Open Create Account Modal
    await evaluate(`
      (() => {
        const addBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Thêm tài khoản') || b.textContent.includes('+'));
        if (addBtn) addBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));

    const modalTitle = await evaluate('document.body.textContent');
    const modalOpened = modalTitle.includes('Thêm tài khoản quản lý mới');
    recordStep('ACC', 'Open "+ Thêm tài khoản mới" modal dialog', modalOpened);

    // 4.2 Fill modal form and submit
    const accUsername = `ui_account_${runId}`;
    await evaluate(`
      (async () => {
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        const uInp = document.querySelector('form input[placeholder*="shop_official"]') || document.querySelector('input[placeholder*="shop_official"]');
        if (uInp) {
          nativeSetter.call(uInp, '${accUsername}');
          uInp.dispatchEvent(new Event('input', { bubbles: true }));
          uInp.dispatchEvent(new Event('change', { bubbles: true }));
        }

        await new Promise(r => setTimeout(r, 150));
        const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Lưu tài khoản') || (b.type === 'submit' && b.closest('form')));
        if (saveBtn) saveBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 2000));

    const accListText = await evaluate('document.body.textContent');
    const accCreated = accListText.includes(accUsername);
    recordStep(
      'ACC',
      'Create managed account via modal form and verify in table',
      accCreated,
    );

    // 4.3 Reauth & Reveal Secret in UI
    // Find the button "Xem pass" for shop_admin (the seeded account)
    await evaluate(`
      (() => {
        const rows = Array.from(document.querySelectorAll('tr'));
        const shopRow = rows.find(r => r.textContent.includes('shop_admin'));
        if (shopRow) {
          const revealBtn = Array.from(shopRow.querySelectorAll('button')).find(b => b.textContent.includes('Xem pass') || b.textContent.includes('Xem'));
          if (revealBtn) revealBtn.click();
        }
      })()
    `);
    await new Promise((r) => setTimeout(r, 800));

    const reauthModalText = await evaluate('document.body.textContent');
    const reauthOpened =
      reauthModalText.includes('Xác thực lại để xem mật khẩu') ||
      reauthModalText.includes('SEC-02');
    recordStep(
      'ACC',
      'Clicking "Xem pass" opens Step-up Reauth modal dialog',
      reauthOpened,
    );

    // Enter owner password in re-auth dialog and submit
    await evaluate(`
      (async () => {
        const passInp = document.querySelector('input[placeholder*="Chủ shop"]') || document.querySelector('form input[type="password"]');
        if (passInp) {
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          nativeSetter.call(passInp, ${JSON.stringify(adminPass)});
          passInp.dispatchEvent(new Event('input', { bubbles: true }));
          passInp.dispatchEvent(new Event('change', { bubbles: true }));
        }

        await new Promise(r => setTimeout(r, 200));
        const authBtn = document.querySelector('form button[type="submit"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Xác thực & Xem') || b.textContent.includes('Xác thực'));
        if (authBtn) authBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 2500));

    const secretBoxText = await evaluate('document.body.textContent');
    const secretRevealed =
      secretBoxText.includes('TikTokPass2026!Secure') ||
      secretBoxText.includes('Mật khẩu được giải mã');
    recordStep(
      'ACC',
      'Reauth verification succeeds and decrypts AEAD secret in DOM',
      secretRevealed,
    );

    // Close reveal modal
    await evaluate(`
      (() => {
        const closeBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Đóng') || b.textContent.includes('Close'));
        if (closeBtn) closeBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));

    // -------------------------------------------------------------
    // FLOW 5: CHẤM CÔNG, LỊCH & BẢNG LƯƠNG UI
    // -------------------------------------------------------------
    console.log('\n[FLOW 5: CHẤM CÔNG, LỊCH & BẢNG LƯƠNG UI]');

    // 5.1 Navigate to /clock & verify tab navigation
    await evaluate(
      `window.history.pushState(null, '', '/clock'); window.dispatchEvent(new Event('popstate'));`,
    );
    await new Promise((r) => setTimeout(r, 1000));

    const clockTabs = await evaluate(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const reviewTab = buttons.find(b => b.textContent.includes('Duyệt công') || b.textContent.includes('quản lý'));
        return Boolean(reviewTab);
      })()
    `);
    recordStep(
      'CLOCK',
      'Navigate to /clock and verify Owner Review tab',
      clockTabs,
    );

    // Switch to Owner Review tab
    await evaluate(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const reviewTab = buttons.find(b => b.textContent.includes('Duyệt công') || b.textContent.includes('quản lý'));
        if (reviewTab) reviewTab.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1000));
    const reviewTabActive = await evaluate('document.body.textContent');
    recordStep(
      'CLOCK',
      'Owner Review shifts table mounts in DOM',
      reviewTabActive.includes('Duyệt công') ||
        reviewTabActive.includes('ca làm việc'),
    );

    // 5.2 Navigate to /payroll & verify Vietnamese banner / Rate modal
    await evaluate(
      `window.history.pushState(null, '', '/payroll'); window.dispatchEvent(new Event('popstate'));`,
    );
    await new Promise((r) => setTimeout(r, 1500));

    const payrollPageText = await evaluate('document.body.textContent');
    recordStep(
      'PAY',
      'Navigate to /payroll: Period overview & employee table rendered',
      payrollPageText.includes('Quản lý bảng lương') ||
        payrollPageText.includes('bảng lương'),
    );

    // Open rate modal on first available employee
    await evaluate(`
      (() => {
        const rateBtns = Array.from(document.querySelectorAll('button')).filter(b => b.textContent.includes('Đơn giá') || b.textContent.includes('Thiết lập'));
        if (rateBtns.length > 0) rateBtns[0].click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 800));

    const rateModalText = await evaluate('document.body.textContent');
    const rateModalOpened =
      rateModalText.includes('đơn giá') || rateModalText.includes('giờ');
    recordStep(
      'PAY',
      'Click "Thiết lập đơn giá" opens hourly rate configuration modal',
      rateModalOpened,
    );

    // Close rate modal
    await evaluate(`
      (() => {
        const closeBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Hủy') || b.textContent.includes('Đóng'));
        if (closeBtn) closeBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 500));

    // -------------------------------------------------------------
    // FLOW 6: FILE (QUẢN LÝ TỆP & THÙNG RÁC) UI
    // -------------------------------------------------------------
    console.log('\n[FLOW 6: FILE (QUẢN LÝ TỆP & THÙNG RÁC) UI]');

    await evaluate(
      `window.history.pushState(null, '', '/storage'); window.dispatchEvent(new Event('popstate'));`,
    );
    await new Promise((r) => setTimeout(r, 1200));

    const storagePageText = await evaluate('document.body.textContent');
    const storageRendered =
      storagePageText.toLowerCase().includes('quản lý tệp') ||
      storagePageText.toLowerCase().includes('storage');
    recordStep(
      'FILE',
      'Navigate to /storage: Folder groups and readiness cards rendered',
      storageRendered,
    );

    // -------------------------------------------------------------
    // FLOW 7: SETTINGS & PASSWORD CHANGE (UI20)
    // -------------------------------------------------------------
    console.log('\n[FLOW 7: SETTINGS & ĐỔI MẬT KHẨU (UI20)]');

    await evaluate(
      `window.history.pushState(null, '', '/settings'); window.dispatchEvent(new Event('popstate'));`,
    );
    await new Promise((r) => setTimeout(r, 1200));

    const settingsPageText = await evaluate('document.body.textContent');
    const settingsRendered =
      settingsPageText.includes('Cài đặt & Hồ sơ cá nhân') &&
      settingsPageText.includes('C06 Multi-Tenant Isolated');
    recordStep(
      'SET',
      'Navigate to /settings: Profile and C06 Workspace Context cards rendered',
      settingsRendered,
    );

    // 1. Validation: Empty submit
    await evaluate(`
      (() => {
        const btn = document.querySelector('[data-testid="btn-change-password"]');
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));
    const emptyErrText = await evaluate(
      'document.querySelector("[data-testid=\'alert-password-error\']")?.textContent || ""',
    );
    recordStep(
      'SET',
      'Client-side validation rejects empty submit with inline alert',
      emptyErrText.includes('Vui lòng nhập mật khẩu hiện tại'),
    );

    // 2. Validation: Mismatched confirmation
    await evaluate(`
      (() => {
        const setVal = (el, val) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const curInput = document.querySelector('[data-testid="input-current-password"]');
        const newInput = document.querySelector('[data-testid="input-new-password"]');
        const confInput = document.querySelector('[data-testid="input-confirm-password"]');
        if (curInput) setVal(curInput, 'dummy_pass_123');
        if (newInput) setVal(newInput, 'NewSecretPassword888');
        if (confInput) setVal(confInput, 'MismatchPassword999');
        const btn = document.querySelector('[data-testid="btn-change-password"]');
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));
    const mismatchErrText = await evaluate(
      'document.querySelector("[data-testid=\'alert-password-error\']")?.textContent || ""',
    );
    recordStep(
      'SET',
      'Validation rejects mismatched password confirmation',
      mismatchErrText.includes('không khớp'),
    );

    // 3. Validation: Short password (< 8 chars)
    await evaluate(`
      (() => {
        const setVal = (el, val) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const curInput = document.querySelector('[data-testid="input-current-password"]');
        const newInput = document.querySelector('[data-testid="input-new-password"]');
        const confInput = document.querySelector('[data-testid="input-confirm-password"]');
        if (curInput) setVal(curInput, 'dummy_pass_123');
        if (newInput) setVal(newInput, 'short');
        if (confInput) setVal(confInput, 'short');
        const btn = document.querySelector('[data-testid="btn-change-password"]');
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 600));
    const shortErrText = await evaluate(
      'document.querySelector("[data-testid=\'alert-password-error\']")?.textContent || ""',
    );
    recordStep(
      'SET',
      'Validation rejects weak/short password (< 8 chars)',
      shortErrText.includes('tối thiểu 8 ký tự'),
    );

    // 4. API Error: Wrong current password returns 401 and UI shows friendly error
    await evaluate(`
      (() => {
        const setVal = (el, val) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, val);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const curInput = document.querySelector('[data-testid="input-current-password"]');
        const newInput = document.querySelector('[data-testid="input-new-password"]');
        const confInput = document.querySelector('[data-testid="input-confirm-password"]');
        if (curInput) setVal(curInput, 'WrongCurrentPassword999!');
        if (newInput) setVal(newInput, 'NewValidPass12345!');
        if (confInput) setVal(confInput, 'NewValidPass12345!');
        const btn = document.querySelector('[data-testid="btn-change-password"]');
        if (btn) btn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1500));
    const wrongCurErrText = await evaluate(
      'document.querySelector("[data-testid=\'alert-password-error\']")?.textContent || ""',
    );
    recordStep(
      'SET',
      'API rejects wrong current password with 401 error message in DOM',
      wrongCurErrText.includes('không chính xác'),
    );

    // 5. API Success: Correct password change
    const tempNewPass = 'TempPass12345678!';
    try {
      await evaluate(`
        (() => {
          const setVal = (el, val) => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          };
          const curInput = document.querySelector('[data-testid="input-current-password"]');
          const newInput = document.querySelector('[data-testid="input-new-password"]');
          const confInput = document.querySelector('[data-testid="input-confirm-password"]');
          if (curInput) setVal(curInput, ${JSON.stringify(adminPass)});
          if (newInput) setVal(newInput, ${JSON.stringify(tempNewPass)});
          if (confInput) setVal(confInput, ${JSON.stringify(tempNewPass)});
          const btn = document.querySelector('[data-testid="btn-change-password"]');
          if (btn) btn.click();
        })()
      `);
      await new Promise((r) => setTimeout(r, 2000));
      const successAlertText = await evaluate(
        'document.querySelector("[data-testid=\'alert-password-success\']")?.textContent || ""',
      );
      recordStep(
        'SET',
        'Successful password change renders green confirmation alert',
        successAlertText.includes('thành công'),
      );

      // 5b. Verify Session Rotation & CSRF Refreshed in active session
      const meAfterRotation = await evaluate(`
        (async () => {
          const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
          if (!res.ok) return { ok: false };
          const json = await res.json();
          return { ok: true, hasCsrf: Boolean(json.data?.csrf_token) };
        })()
      `);
      recordStep(
        'SET',
        'Session rotation preserves authenticated context and provides valid CSRF',
        meAfterRotation.ok && meAfterRotation.hasCsrf,
      );
    } finally {
      // 6. Restore original password immediately to keep QA credentials stable
      await evaluate(`
        (() => {
          const setVal = (el, val) => {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          };
          const curInput = document.querySelector('[data-testid="input-current-password"]');
          const newInput = document.querySelector('[data-testid="input-new-password"]');
          const confInput = document.querySelector('[data-testid="input-confirm-password"]');
          if (curInput) setVal(curInput, ${JSON.stringify(tempNewPass)});
          if (newInput) setVal(newInput, ${JSON.stringify(adminPass)});
          if (confInput) setVal(confInput, ${JSON.stringify(adminPass)});
          const btn = document.querySelector('[data-testid="btn-change-password"]');
          if (btn) btn.click();
        })()
      `);
      await new Promise((r) => setTimeout(r, 2000));
      const restoredAlertText = await evaluate(
        'document.querySelector("[data-testid=\'alert-password-success\']")?.textContent || ""',
      );
      recordStep(
        'SET',
        'Restoration of baseline QA credential succeeds cleanly',
        restoredAlertText.includes('thành công'),
      );

      const meAfterRestore = await evaluate(`
        (async () => {
          const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
          return res.ok;
        })()
      `);
      recordStep(
        'SET',
        'Session active and authenticated after credential restoration',
        meAfterRestore,
      );
    }

    // -------------------------------------------------------------
    // FLOW 8: AUDIT SYSTEM LOG (UI19) - OWNER ONLY & REDACTION
    // -------------------------------------------------------------
    console.log('\n[FLOW 8: AUDIT SYSTEM LOG (UI19)]');

    // 1. Navigate to /audit via pushState and popstate event
    await evaluate(
      `window.history.pushState(null, '', '/audit'); window.dispatchEvent(new Event('popstate'));`,
    );
    await new Promise((r) => setTimeout(r, 1500));

    // 2. Verify Audit Screen Header & ID
    const auditHeader = await evaluate(`
      (() => {
        const el = document.querySelector('[data-testid="audit-header"]');
        return {
          title: el?.textContent || '',
          url: window.location.pathname,
        };
      })()
    `);
    recordStep(
      'AUDIT',
      'Navigate to /audit renders UI19 Audit Screen and PageHeader',
      auditHeader.title.includes('Nhật ký kiểm toán hệ thống') &&
        auditHeader.url === '/audit',
    );

    // 3. Verify Security Assurance Banner (Q3-OPS-003, Q3-ACC-006)
    const auditBannerText = await evaluate(
      'document.querySelector("[data-testid=\'audit-security-banner\']")?.textContent || ""',
    );
    recordStep(
      'AUDIT',
      'Security assurance banner visible with Q3-OPS-003 and Q3-ACC-006 compliance',
      auditBannerText.includes('Q3-OPS-003') &&
        auditBannerText.includes('Q3-ACC-006'),
    );

    // 4. Verify Audit Event Cards rendered with Action badges and Timestamps
    const auditCardsCount = await evaluate(
      'document.querySelectorAll("[data-testid=\'audit-event-card\']").length',
    );
    recordStep(
      'AUDIT',
      'Audit event cards rendered with timestamps, actor, and actions',
      auditCardsCount > 0,
      `Found ${auditCardsCount} cards`,
    );

    // 5. Expand first event metadata to verify redaction & sanitized view
    await evaluate(`
      (() => {
        const expandBtn = document.querySelector('[data-testid="btn-expand-metadata"]');
        if (expandBtn) expandBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 800));

    const metadataText = await evaluate(
      'document.querySelector("[data-testid=\'audit-metadata-block\']")?.textContent || ""',
    );
    const isRedacted =
      !metadataText.includes('password_hash') &&
      !metadataText.includes('secret_ciphertext') &&
      !metadataText.includes('token_hash') &&
      metadataText.includes('Không chứa mã băm');
    recordStep(
      'AUDIT',
      'Expandable technical details render sanitized metadata without secret leaks',
      isRedacted,
    );

    // 6. Test Action Filter: select auth.login
    await evaluate(`
      (() => {
        const select = document.querySelector('[data-testid="select-audit-action"]');
        if (select) {
          select.value = 'auth.login';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
    await new Promise((r) => setTimeout(r, 1500));

    const filteredCardsCount = await evaluate(
      'document.querySelectorAll("[data-testid=\'audit-event-card\']").length',
    );
    const filterResetBtnVisible = await evaluate(
      'Boolean(document.querySelector("[data-testid=\'btn-reset-filters\']"))',
    );
    recordStep(
      'AUDIT',
      'Action filter filters timeline and reveals Reset button',
      filteredCardsCount > 0 && filterResetBtnVisible,
    );

    // 7. Reset filters
    await evaluate(`
      (() => {
        const resetBtn = document.querySelector('[data-testid="btn-reset-filters"]');
        if (resetBtn) resetBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1500));

    const restoredCardsCount = await evaluate(
      'document.querySelectorAll("[data-testid=\'audit-event-card\']").length',
    );
    recordStep(
      'AUDIT',
      'Reset filters restores full audit event list',
      restoredCardsCount >= filteredCardsCount,
    );

    // -------------------------------------------------------------
    // FLOW 9: MOBILE RESPONSIVE (375x667) & DRAWER NAVIGATION
    // -------------------------------------------------------------
    console.log('\n[FLOW 9: MOBILE RESPONSIVE (375x667)]');

    await send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 667,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await new Promise((r) => setTimeout(r, 800));

    const mobileLayout = await evaluate(`
      (() => {
        const sidebar = document.querySelector('.desktop-sidebar-wrapper');
        const bottomNav = document.querySelector('nav[aria-label="Mobile Navigation"]') || document.querySelector('.mobile-bottom-nav') || document.querySelector('nav');
        return {
          sidebarHidden: sidebar ? window.getComputedStyle(sidebar).display === 'none' : true,
          hasBottomNav: Boolean(bottomNav),
        };
      })()
    `);
    recordStep(
      'MOBILE',
      'Desktop sidebar hidden and responsive layout active on 375px',
      mobileLayout.sidebarHidden,
    );

    // Logout from Mobile / Desktop
    await evaluate(`
      (async () => {
        const logoutBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Đăng xuất'));
        if (logoutBtn) logoutBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1500));

    const finalUrl = await evaluate('window.location.pathname');
    const logoutSuccess = finalUrl === '/login';
    recordStep(
      'AUTH',
      'Logout terminates session and redirects back to /login',
      logoutSuccess,
    );
  } finally {
    try {
      chrome.kill('SIGTERM');
    } catch {}
  }

  // ---------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------
  console.log('\n======================================================');
  console.log('📊 CHROME CDP DEEP UI EXECUTION SUMMARY');
  console.log('======================================================');
  const passed = testResults.filter((t) => t.isPass).length;
  const failed = testResults.filter((t) => !t.isPass).length;
  console.log(`Total Interactive UI Steps : ${testResults.length}`);
  console.log(`Passed                     : ${passed}`);
  console.log(`Failed                     : ${failed}`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal CDP Error:', err);
  process.exit(1);
});
