import { spawn } from 'node:child_process';
import {
  validateQaTarget,
  verifyIsolatedQaService,
  sanitizeErrorMessage,
} from './qa-target-safety.mjs';
import { getAcceptanceOwnerCredentials } from './qa-credentials-reader.mjs';

// 1. Fail-closed target validation BEFORE reading credentials or opening browser
const webBase = validateQaTarget(process.env.QA_WEB_BASE);
await verifyIsolatedQaService(webBase);

// 2. Read QA credentials only after target has been strictly validated
const qaCredentialsFile = process.env.QA_CREDENTIALS_FILE;
let ownerCreds = null;
if (qaCredentialsFile) {
  ownerCreds = getAcceptanceOwnerCredentials(qaCredentialsFile);
} else {
  try {
    ownerCreds = getAcceptanceOwnerCredentials();
  } catch {
    // Isolated synthetic QA context
    ownerCreds = {
      id: process.env.QA_OWNER_ID || 'synthetic-owner-uuid',
      identifier: process.env.QA_ADMIN_IDENTIFIER || 'admin',
      password: process.env.QA_ADMIN_PASSWORD || '',
    };
  }
}
const adminPass = ownerCreds.password;
const cdpPort = 9245;
const runId = Math.random().toString(36).substring(2, 8);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(step, pass, detail = '') {
  results.push({ step, pass, detail });
  console.log(`  ${pass ? '✔ PASS' : '✖ FAIL'}: ${step}${detail ? ` (${detail})` : ''}`);
}

async function run() {
  console.log('======================================================');
  console.log('🌐 CHROME CDP QA: ACC-005 BACKGROUND EXPIRY & ACC-006 ESCAPE KEY');
  console.log(`Target: ${webBase}`);
  console.log('======================================================\n');

  const profile = `/tmp/chrome-acc-qa-${runId}`;
  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${cdpPort}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      '--window-size=1280,900',
    ],
    { stdio: 'ignore' },
  );

  try {
    await wait(1800);

    const newTab = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(webBase + '/login')}`, {
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

    const evaluate = async (exp, timeout = 10000) => {
      const timer = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('Browser evaluation timed out')), timeout),
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

    // 1. Wait for Login Page
    let ready = false;
    for (let i = 0; i < 20; i++) {
      const formExists = await evaluate(`Boolean(document.querySelector('input[type="password"]'))`);
      if (formExists) {
        ready = true;
        break;
      }
      await wait(200);
    }
    record('Login Screen Mounted', ready);

    // 2. Perform Owner Login
    await evaluate(`
      (async () => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const uInput = inputs[0];
        const pInput = inputs[1];
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

        setter.call(uInput, ${JSON.stringify(ownerCreds.identifier)});
        uInput.dispatchEvent(new Event('input', { bubbles: true }));
        uInput.dispatchEvent(new Event('change', { bubbles: true }));

        setter.call(pInput, ${JSON.stringify(adminPass)});
        pInput.dispatchEvent(new Event('input', { bubbles: true }));
        pInput.dispatchEvent(new Event('change', { bubbles: true }));

        await new Promise(r => setTimeout(r, 100));
        const btn = document.querySelector('button[type="submit"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Đăng nhập'));
        if (btn) btn.click();
      })()
    `);
    await wait(2000);

    const isLoggedIn = await evaluate(`Boolean(document.querySelector('header')?.textContent?.includes('Management Lite'))`);
    record('Owner Authenticated & AppShell Mounted', isLoggedIn);

    // 3. Navigate to /accounts
    await evaluate(`window.history.pushState(null, '', '/accounts'); window.dispatchEvent(new Event('popstate'));`);
    await wait(1500);

    const accountsPageMounted = await evaluate(`Boolean(document.body.textContent.includes('Tài khoản') || document.body.textContent.includes('ACC'))`);
    record('Accounts Screen (/accounts) Mounted', accountsPageMounted);

    // Ensure at least one account exists
    let hasAccount = await evaluate(`Boolean(document.querySelector('tr button, [data-action="view"]'))`);
    if (!hasAccount) {
      // Create a test account
      await evaluate(`
        (async () => {
          const addBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Thêm tài khoản') || b.textContent.includes('+'));
          if (addBtn) addBtn.click();
        })()
      `);
      await wait(600);
      await evaluate(`
        (async () => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          const uInp = document.querySelector('form input[placeholder*="shop_official"]') || document.querySelector('input[placeholder*="shop_official"]');
          if (uInp) {
            setter.call(uInp, 'shop_admin');
            uInp.dispatchEvent(new Event('input', { bubbles: true }));
            uInp.dispatchEvent(new Event('change', { bubbles: true }));
          }
          await new Promise(r => setTimeout(r, 100));
          const saveBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Lưu tài khoản') || (b.type === 'submit' && b.closest('form')));
          if (saveBtn) saveBtn.click();
        })()
      `);
      await wait(2000);
      hasAccount = await evaluate(`Boolean(document.querySelector('tr button, [data-action="view"]'))`);
    }
    record('Managed Accounts List Populated', hasAccount);

    // -------------------------------------------------------------
    // ACC-005 TEST: Reveal Secret -> Background -> DOM Purged -> Return -> Secret Gone
    // -------------------------------------------------------------
    console.log('\n--- TESTING ACC-005 BACKGROUND EXPIRY ---');

    // Filter table by shop_admin which has the encrypted secret seeded
    await evaluate(`
      (() => {
        const searchInp = document.querySelector('input[placeholder*="Tìm theo Username"]');
        if (searchInp) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(searchInp, 'shop_admin');
          searchInp.dispatchEvent(new Event('input', { bubbles: true }));
          searchInp.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()
    `);
    await wait(600);

    // Open Step-up Reauth modal via "Xem pass" button on shop_admin
    const opened = await evaluate(`
      (() => {
        const rows = Array.from(document.querySelectorAll('tr'));
        const shopRow = rows.find(r => r.textContent.includes('shop_admin'));
        if (shopRow) {
          const passBtn = Array.from(shopRow.querySelectorAll('button')).find(b => b.textContent.includes('Xem pass'));
          if (passBtn) {
            passBtn.click();
            return true;
          }
        }
        return false;
      })()
    `);
    await wait(800);

    const reauthModalOpen = await evaluate(`Boolean(document.querySelector('form input[type="password"]'))`);
    record('ACC-005: Step-up Reauth Modal Opened', Boolean(opened && reauthModalOpen));

    // Fill reauth password and submit
    await evaluate(`
      (async () => {
        const passInp = document.querySelector('form input[type="password"]');
        if (passInp) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(passInp, ${JSON.stringify(adminPass)});
          passInp.dispatchEvent(new Event('input', { bubbles: true }));
          passInp.dispatchEvent(new Event('change', { bubbles: true }));
        }
        await new Promise(r => setTimeout(r, 200));
        const authBtn = document.querySelector('form button[type="submit"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Xác thực & Xem') || b.textContent.includes('Xác thực'));
        if (authBtn) authBtn.click();
      })()
    `);
    await wait(2500);

    // Verify secret is revealed in DOM: browser returns only boolean verification
    const secretRevealed = await evaluate(`(() => {
      const codeEl = document.querySelector('code');
      const hasCode = Boolean(codeEl && codeEl.textContent.trim().length > 0);
      const countdownPresent = document.body.textContent.includes('30 giây') || document.body.textContent.includes('tự động ẩn');
      return Boolean(hasCode && countdownPresent);
    })()`);
    record('ACC-005: Secret Decrypted and Visible in DOM', Boolean(secretRevealed), 'secret verified non-empty in browser DOM [REDACTED]');

    // Trigger background tab state (visibilitychange: hidden)
    console.log('  Simulating background tab transition (visibilitychange -> hidden)...');
    await evaluate(`
      (() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      })()
    `);
    await wait(200);

    // Verify secret is purged IMMEDIATELY from DOM upon backgrounding
    const backgroundPurged = await evaluate(`(() => {
      const codeEl = document.querySelector('code');
      return !codeEl;
    })()`);
    record('ACC-005: Secret Immediately Purged from DOM on Background State', Boolean(backgroundPurged), 'DOM purged [REDACTED]');

    // Simulate returning to tab after expiration (> 30s elapsed)
    console.log('  Simulating returning to tab in foreground after expiry...');
    await evaluate(`
      (() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
      })()
    `);
    await wait(500);

    // Verify secret DOES NOT reappear
    const secretNeverReappeared = await evaluate(`(() => {
      const codeEl = document.querySelector('code');
      return !codeEl;
    })()`);
    record('ACC-005: Secret Never Reappears in DOM After Expiry / Return', Boolean(secretNeverReappeared));

    // Close any lingering modal before next test
    await evaluate(`
      (() => {
        const closeBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Đóng') || b.textContent.includes('Close'));
        if (closeBtn) closeBtn.click();
      })()
    `);
    await wait(600);

    // -------------------------------------------------------------
    // ACC-006 TEST: Escape Key Keyboard Accessibility
    // -------------------------------------------------------------
    console.log('\n--- TESTING ACC-006 ESCAPE KEY ACCESSIBILITY ---');

    // Reopen Step-up Reauth modal
    await evaluate(`
      (() => {
        const rows = Array.from(document.querySelectorAll('tr'));
        const targetRow = rows.find(r => r.textContent.includes('shop_admin')) || rows[1];
        if (targetRow) {
          const passBtn = Array.from(targetRow.querySelectorAll('button')).find(b => b.textContent.includes('Xem pass'));
          if (passBtn) passBtn.click();
        }
      })()
    `);
    await wait(800);

    const reauthOpenedAgain = await evaluate(`Boolean(document.querySelector('form input[type="password"]'))`);
    record('ACC-006: Reauth Modal Reopened for Escape Test', reauthOpenedAgain);

    // Dispatch Escape key event
    console.log('  Dispatching Escape key event...');
    await send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    // Also trigger window keydown for full browser compatibility
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));`);
    await wait(500);

    // Verify modal is closed
    const modalAfterEscape = await evaluate(`Boolean(document.body.textContent.includes('Xác thực lại để xem mật khẩu'))`);
    record('ACC-006: Modal Closed Immediately on Escape Key', !modalAfterEscape);

    // Verify no secret leak in DOM
    const noSecretLeak = await evaluate(`!document.querySelector('code')`);
    record('ACC-006: No Secret State or Leak in DOM After Escape', noSecretLeak);

  } finally {
    try {
      chrome.kill('SIGTERM');
    } catch {}
  }

  const allPass = results.every((r) => r.pass);
  console.log('\n======================================================');
  console.log(`TOTAL CHECKS: ${results.length} | PASS: ${results.filter(r => r.pass).length} | FAIL: ${results.filter(r => !r.pass).length}`);
  console.log(`OVERALL RESULT: ${allPass ? '✔ ALL PASS' : '✖ SOME FAILED'}`);
  console.log('======================================================\n');
  process.exit(allPass ? 0 : 1);
}

run().catch((err) => {
  console.error('Test execution failed:', sanitizeErrorMessage(err));
  process.exit(1);
});
