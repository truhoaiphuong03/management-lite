import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const runId = Math.random().toString(36).substring(2, 8);
const webBase = 'http://127.0.0.1:3001';
const port = 9245;

async function runChromeLoginTest() {
  console.log('======================================================');
  console.log('🌐 REAL GOOGLE CHROME CDP — QA_OWNER LOGIN VERIFICATION');
  console.log(`Target: ${webBase}/login`);
  console.log('======================================================\n');

  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=/tmp/chrome-owner-qa-${runId}`,
    ],
  );

  chrome.on('error', (err) => {
    console.error('Failed to spawn Chrome:', err);
  });

  const steps = [];
  function record(name, pass, detail = '') {
    steps.push({ name, pass, detail });
    console.log(
      `  ${pass ? '✔ PASS' : '✖ FAIL'}: ${name}${detail ? ` (${detail})` : ''}`,
    );
  }

  try {
    let newTab = null;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 300));
      try {
        const res = await fetch(
          `http://127.0.0.1:${port}/json/new?${encodeURIComponent(webBase + '/login')}`,
          {
            method: 'PUT',
          },
        );
        if (res.ok) {
          newTab = await res.json();
          break;
        }
      } catch {
        // Retry
      }
    }
    assert.ok(newTab, 'Chrome CDP port did not respond in 6 seconds');

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
    await send('DOM.enable');

    // Wait for login page ready
    let loginFormReady = false;
    for (let i = 0; i < 25; i++) {
      const hasForm = await evaluate(
        `Boolean(document.querySelector('form') && document.querySelector('input[type="password"]'))`,
      );
      if (hasForm) {
        loginFormReady = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    record('1. Tải trang đăng nhập /login trên Chrome thật', loginFormReady);
    assert.ok(
      loginFormReady,
      'Trang /login không tải được form trong vòng 5 giây',
    );

    // Password is read from environment variable QA_OWNER_PASSWORD
    const ownerPassword =
      process.env.QA_OWNER_PASSWORD || 'QAOwnerPassword123!';

    // Fill in credentials and submit
    const fillResult = await evaluate(`
      (() => {
        const usernameInput = document.querySelector('input[type="text"]') || document.querySelector('input[name="identifier"]');
        const passwordInput = document.querySelector('input[type="password"]');
        const submitBtn = document.querySelector('button[type="submit"]');
        if (!usernameInput || !passwordInput || !submitBtn) return { success: false, reason: 'Inputs not found' };

        // React controlled inputs need native setter or input events
        const setVal = (input, val) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(input, val);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        };

        setVal(usernameInput, 'qa_owner');
        setVal(passwordInput, ${JSON.stringify(ownerPassword)});
        submitBtn.click();
        return { success: true };
      })()
    `);
    record(
      '2. Điền tài khoản qa_owner và nhấn nút đăng nhập',
      fillResult?.success,
    );
    assert.ok(fillResult?.success, 'Không thể điền form đăng nhập');

    // Wait for post-login navigation and AppShell rendering
    let loggedIn = false;
    let currentUrl = '';

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const status = await evaluate(`
        (() => {
          const path = window.location.pathname;
          const hasSidebar = Boolean(document.querySelector('nav') || document.querySelector('[data-testid="desktop-sidebar"]') || document.querySelector('.app-shell'));
          const hasError = document.querySelector('[data-testid="login-error"]') ? document.querySelector('[data-testid="login-error"]').textContent : null;
          const bodyText = document.body ? document.body.innerText.slice(0, 300) : '';
          return { path, hasSidebar, hasError, bodyText };
        })()
      `);

      if (status && status.path !== '/login') {
        loggedIn = true;
        currentUrl = status.path;
        break;
      }
      if (status && status.hasError) {
        throw new Error('Đăng nhập thất bại với lỗi: ' + status.hasError);
      }
    }

    record(
      '3. Điều hướng thành công sau đăng nhập (URL khác /login)',
      loggedIn,
      `URL hiện tại: ${currentUrl}`,
    );
    assert.ok(loggedIn, 'Đăng nhập không chuyển hướng sau 6 giây');

    // Verify AppShell elements
    const shellVerification = await evaluate(`
      (() => {
        const title = document.title;
        const text = document.body ? document.body.innerText : '';
        const hasNavigation = Boolean(document.querySelector('nav'));
        const hasIssuesLink = Boolean(document.querySelector('a[href="/issues"]') || text.includes('Báo lỗi'));
        return { title, hasNavigation, hasIssuesLink };
      })()
    `);

    record(
      '4. AppShell hiển thị đầy đủ giao diện làm việc của Owner',
      shellVerification?.hasNavigation,
    );
    record(
      '5. Quyền Owner: Nhận diện menu Quản lý Báo lỗi (Issues)',
      shellVerification?.hasIssuesLink,
    );

    ws.close();
    chrome.kill('SIGTERM');

    console.log('\n======================================================');
    console.log('✅ KẾT QUẢ: qa_owner ĐĂNG NHẬP THÀNH CÔNG TRÊN CHROME THẬT!');
    console.log('======================================================\n');
  } catch (err) {
    chrome.kill('SIGTERM');
    console.error('\n✖ LỖI TRONG QUÁ TRÌNH TEST CHROME:', err.message || err);
    process.exit(1);
  }
}

runChromeLoginTest();
