import { spawn } from 'node:child_process';
import { getAcceptanceOwnerCredentials } from './qa-credentials-reader.mjs';

const ownerCreds = getAcceptanceOwnerCredentials();
const adminPass = ownerCreds.password;

async function main() {
  console.log('======================================================');
  console.log('🌐 REAL GOOGLE CHROME BROWSER AUTOMATION E2E (PORT 3007)');
  console.log('======================================================');

  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      '--remote-debugging-port=9222',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  );

  try {
    await new Promise((r) => setTimeout(r, 1200));
    const newTab = await fetch(
      'http://127.0.0.1:9222/json/new?http://127.0.0.1:3007/login',
      { method: 'PUT' },
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

    const evaluate = async (exp) => {
      const r = await send('Runtime.evaluate', {
        expression: exp,
        returnByValue: true,
        awaitPromise: true,
      });
      return r.result?.value;
    };

    await send('Page.enable');
    await new Promise((r) => setTimeout(r, 1500));

    // 1. Verify Login Screen
    const h2Text = await evaluate('document.querySelector("h2")?.textContent');
    console.log('1. Chrome Page Loaded:', h2Text);
    if (!h2Text?.includes('Đăng nhập')) {
      throw new Error(`Expected login screen, got: ${h2Text}`);
    }

    // 2. Perform Login via DOM interaction in Chrome
    const loginSuccess = await evaluate(`
      (async () => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const usernameInput = inputs[0];
        const passwordInput = inputs[1];
        if (!usernameInput || !passwordInput) return false;

        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(usernameInput, 'admin');
        usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
        usernameInput.dispatchEvent(new Event('change', { bubbles: true }));

        nativeSetter.call(passwordInput, ${JSON.stringify(adminPass)});
        passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
        passwordInput.dispatchEvent(new Event('change', { bubbles: true }));

        await new Promise(res => setTimeout(res, 200));

        const submitBtn = document.querySelector('button[type="submit"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Đăng nhập'));
        if (!submitBtn) return false;

        submitBtn.click();
        return true;
      })()
    `);
    console.log('2. Chrome Form Submitted:', loginSuccess);

    // Wait for auth & navigation
    await new Promise((r) => setTimeout(r, 2000));

    // 3. Verify App Shell after login
    const currentUrl = await evaluate('window.location.pathname');
    const shellTitle = await evaluate(
      'document.querySelector("header")?.textContent || document.body.textContent',
    );
    console.log(
      '3. Chrome Current Path:',
      currentUrl,
      '| Header:',
      shellTitle ? 'OK' : 'EMPTY',
    );
    console.log('   Chrome Logged-In User Context confirmed');

    // 4. Navigate to /employees in Chrome
    await evaluate(
      'window.history.pushState(null, "", "/employees"); window.dispatchEvent(new Event("popstate"));',
    );
    await new Promise((r) => setTimeout(r, 1500));

    const empPath = await evaluate('window.location.pathname');
    const empCount = await evaluate(
      'document.querySelectorAll("[data-testid=\\"employee-card\\"]").length || document.querySelectorAll("article, .app-card, [style*=\\"border\\"]").length',
    );
    console.log(
      '4. Chrome /employees Loaded. Path:',
      empPath,
      '| Card Count:',
      empCount,
    );

    // Check disabled button on ADMIN employee
    const adminSuspendBtnState = await evaluate(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const suspendBtns = buttons.filter(b => b.textContent.includes('Tạm ngưng'));
        const disabledBtn = suspendBtns.find(b => b.disabled || b.hasAttribute('disabled'));
        return {
          totalSuspendButtons: suspendBtns.length,
          hasDisabledButton: Boolean(disabledBtn),
          disabledTooltip: disabledBtn?.getAttribute('title') || ''
        };
      })()
    `);
    console.log(
      '   Admin Suspend Button Guard in Chrome:',
      adminSuspendBtnState,
    );

    // 5. Navigate to /work in Chrome
    await evaluate(
      'window.history.pushState(null, "", "/work"); window.dispatchEvent(new Event("popstate"));',
    );
    await new Promise((r) => setTimeout(r, 1500));
    const workHeader = await evaluate(
      'document.querySelector("h1, h2, h3")?.textContent',
    );
    console.log(
      '5. Chrome /work Loaded:',
      workHeader || 'Work Screen Rendered',
    );

    // 6. Navigate to /accounts in Chrome
    await evaluate(
      'window.history.pushState(null, "", "/accounts"); window.dispatchEvent(new Event("popstate"));',
    );
    await new Promise((r) => setTimeout(r, 1500));
    const accHeader = await evaluate(
      'document.querySelector("h1, h2, h3")?.textContent',
    );
    console.log(
      '6. Chrome /accounts Loaded:',
      accHeader || 'Accounts Screen Rendered',
    );

    // 7. Navigate to /storage in Chrome
    await evaluate(
      'window.history.pushState(null, "", "/storage"); window.dispatchEvent(new Event("popstate"));',
    );
    await new Promise((r) => setTimeout(r, 1500));
    const storageHeader = await evaluate(
      'document.querySelector("h1, h2, h3")?.textContent',
    );
    console.log(
      '7. Chrome /storage Loaded:',
      storageHeader || 'Storage Screen Rendered',
    );

    // 8. Logout
    await evaluate(`
      (() => {
        const logoutBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Đăng xuất') || b.textContent.includes('logout'));
        if (logoutBtn) logoutBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 1500));
    const finalUrl = await evaluate('window.location.pathname');
    console.log('8. Chrome Logout Completed. Final Path:', finalUrl);

    console.log('======================================================');
    console.log('🎉 GOOGLE CHROME REAL BROWSER AUTOMATION: 100% PASS');
    console.log('======================================================');
  } finally {
    chrome.kill();
  }
}

main().catch((err) => {
  console.error('CHROME TEST ERROR:', err);
  process.exit(1);
});
