import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL or DATABASE_URL must be defined in environment to connect to isolated test database',
  );
}

async function runBrowserE2E() {
  console.log('=== CHROME CDP E2E: PASSWORD RESET & LOGIN FLOW ===');
  const port = 9451;
  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--disable-gpu',
      '--no-sandbox',
    ],
  );

  chrome.on('error', (err) => {
    console.error('Failed to spawn Chrome:', err);
  });

  try {
    await new Promise((r) => setTimeout(r, 1500));

    const list = await new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${port}/json/list`, (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => resolve(JSON.parse(data)));
        })
        .on('error', reject);
    });

    const pageTab = list.find((t) => t.type === 'page') || list[0];
    const ws = new WebSocket(pageTab.webSocketDebuggerUrl);
    let id = 1;
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const curId = id++;
        const timeout = setTimeout(() => {
          reject(new Error(`CDP command ${method} timed out`));
        }, 15000);
        const handler = (evt) => {
          const resp = JSON.parse(evt.data);
          if (resp.id === curId) {
            clearTimeout(timeout);
            ws.removeEventListener('message', handler);
            resolve(resp.result);
          }
        };
        ws.addEventListener('message', handler);
        ws.send(JSON.stringify({ id: curId, method, params }));
      });

    await new Promise((r) => ws.addEventListener('open', r, { once: true }));
    await send('Page.enable');
    await send('Runtime.enable');

    const evalJs = async (expr) => {
      const res = await send('Runtime.evaluate', {
        expression: `(() => { ${expr} })()`,
        returnByValue: true,
      });
      if (res.exceptionDetails) {
        throw new Error(
          `CDP eval error: ${res.exceptionDetails.text} - ${res.exceptionDetails.exception?.description || ''}`,
        );
      }
      return res.result?.value;
    };

    // Step 1: Open /login
    console.log('Step 1: Navigating to http://127.0.0.1:3001/login...');
    await send('Page.navigate', { url: 'http://127.0.0.1:3001/login' });
    await new Promise((r) => setTimeout(r, 1500));

    let bodyText = await evalJs('return document.body.innerText;');
    assert.ok(bodyText.includes('Đăng nhập'), 'Login page should render');
    assert.ok(
      bodyText.includes('Quên mật khẩu?'),
      'Forgot password link should exist on /login',
    );
    console.log('✓ Login page loaded with "Quên mật khẩu?" link.');

    // Step 2: Click "Quên mật khẩu?" link
    console.log('Step 2: Clicking "Quên mật khẩu?" link...');
    await evalJs(`
      const link = Array.from(document.querySelectorAll('a, button')).find(el => el.textContent.includes('Quên mật khẩu?'));
      if (link) link.click();
    `);
    await new Promise((r) => setTimeout(r, 1000));

    let currentUrl = await evalJs('return window.location.href;');
    let screenTitle = await evalJs(
      'return document.querySelector("h1")?.innerText;',
    );
    assert.ok(
      currentUrl.includes('/forgot-password') ||
        screenTitle?.includes('Khôi phục mật khẩu'),
      'Should navigate to forgot password screen',
    );
    console.log(`✓ Navigated to Forgot Password screen: "${screenTitle}"`);

    // Step 2a: Test direct navigation to /forgot-password URL
    console.log('Step 2a: Navigating directly to http://127.0.0.1:3001/forgot-password...');
    await send('Page.navigate', { url: 'http://127.0.0.1:3001/forgot-password' });
    await new Promise((r) => setTimeout(r, 1200));

    // Step 2b: Verify email field is strictly EMPTY by default, has correct placeholder, and no auto-filled admin email
    const initialEmailState = await evalJs(`
      const input = document.getElementById('forgot-email-input');
      return {
        value: input ? input.value : null,
        placeholder: input ? input.placeholder : null,
        autoComplete: input ? input.getAttribute('autocomplete') : null,
      };
    `);
    assert.equal(initialEmailState.value, '', 'Forgot password email input MUST be strictly empty on initial render');
    assert.equal(initialEmailState.placeholder, 'Nhập email đã đăng ký', 'Placeholder must strictly be "Nhập email đã đăng ký"');
    assert.ok(!initialEmailState.placeholder.includes('@'), 'Placeholder must NOT contain any email address');
    assert.equal(initialEmailState.autoComplete, 'off', 'Autocomplete must be set to off');
    console.log('✓ Verified: Email field is strictly empty, placeholder is generic, and autocomplete is off.');

    // Step 2c: Verify empty submission fails with validation message
    console.log('Step 2c: Submitting form with empty email to verify manual entry is required...');
    await evalJs(`
      const submitBtn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('Gửi yêu cầu khôi phục'));
      if (submitBtn) submitBtn.click();
    `);
    await new Promise((r) => setTimeout(r, 500));
    const validationError = await evalJs('return document.body.innerText;');
    assert.ok(validationError.includes('Vui lòng nhập địa chỉ email.'), 'Validation error must appear on empty submit');
    console.log('✓ Verified: Empty submit prevented, user must explicitly enter email.');

    // Step 3: Fill Admin Email manually
    console.log(
      'Step 3: User manually enters admin email into email input...',
    );
    await evalJs(`
      const input = document.getElementById('forgot-email-input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'truhoaiphuong02@gmail.com');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    `);

    // Step 4: Submit forgot password form
    console.log('Step 4: Submitting forgot password form...');
    await evalJs(`
      const submitBtn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('Gửi yêu cầu khôi phục'));
      if (submitBtn) submitBtn.click();
    `);
    await new Promise((r) => setTimeout(r, 1500));

    bodyText = await evalJs('return document.body.innerText;');
    assert.ok(
      bodyText.includes('Nếu email tồn tại trong hệ thống và hợp lệ'),
      'Success feedback banner must appear',
    );
    assert.ok(
      bodyText.includes('EMAIL_DELIVERY_BLOCKED'),
      'EMAIL_DELIVERY_BLOCKED status must be explicitly displayed',
    );
    console.log(
      '✓ Success banner displayed with EMAIL_DELIVERY_BLOCKED notice.',
    );

    // Step 5: Verify NO bypass button exists on public UI, and fetch token via authorized QA endpoint
    console.log(
      'Step 5: Verifying NO bypass button exists on UI and fetching token via QA test harness...',
    );
    const hasBypassBtn = await evalJs(`
      const btn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('Tiếp tục: Đặt lại mật khẩu ngay'));
      return Boolean(btn);
    `);
    assert.equal(
      hasBypassBtn,
      false,
      'No bypass button should exist on public Forgot Password screen',
    );
    console.log('✓ Verified: Public UI strictly contains NO bypass button.');

    // Internal QA DB fixture: Insert single-use reset token directly into QA database (no public HTTP endpoint)
    const pool = new pg.Pool({ connectionString: DATABASE_URL });
    const userRes = await pool.query(
      `SELECT id FROM users WHERE username_normalized = 'admin' LIMIT 1;`,
    );
    assert.ok(userRes.rows.length > 0, 'Admin user must exist in test DB');
    const adminUserId = userRes.rows[0].id;

    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3);`,
      [adminUserId, tokenHash, expiresAt],
    );
    await pool.end();

    console.log('Navigating to /reset-password with verified test fixture token...');
    await send('Page.navigate', {
      url: `http://127.0.0.1:3001/reset-password?token=${resetToken}`,
    });
    await new Promise((r) => setTimeout(r, 1200));

    screenTitle = await evalJs(
      'return document.querySelector("h1")?.innerText;',
    );
    assert.ok(
      screenTitle?.includes('Đặt lại mật khẩu mới'),
      'Should be on Reset Password screen',
    );
    console.log(`✓ On Reset Password screen: "${screenTitle}"`);

    // Step 6: Enter new password and confirmation
    console.log('Step 6: Entering new password and confirmation...');
    const testNewPassword = 'AdminSecretPass2026!#';
    await evalJs(`
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const newPassInput = document.getElementById('new-password-input');
      const confirmPassInput = document.getElementById('confirm-password-input');
      if (newPassInput && confirmPassInput) {
        setter.call(newPassInput, '${testNewPassword}');
        newPassInput.dispatchEvent(new Event('input', { bubbles: true }));

        setter.call(confirmPassInput, '${testNewPassword}');
        confirmPassInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    `);

    // Step 7: Submit new password
    console.log('Step 7: Submitting new password...');
    await evalJs(`
      const saveBtn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('Lưu mật khẩu mới'));
      if (saveBtn) saveBtn.click();
    `);
    await new Promise((r) => setTimeout(r, 1500));

    bodyText = await evalJs('return document.body.innerText;');
    assert.ok(
      bodyText.includes('Mật khẩu đã được đặt lại thành công'),
      'Reset password success message should appear',
    );
    console.log('✓ Mật khẩu đã được đặt lại thành công!');

    // Step 8: Click "Đăng nhập ngay"
    console.log(
      'Step 8: Clicking "Đăng nhập ngay →" to navigate back to /login...',
    );
    await evalJs(`
      const loginBtn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.includes('Đăng nhập ngay'));
      if (loginBtn) loginBtn.click();
    `);
    await new Promise((r) => setTimeout(r, 1000));

    // Step 9: Login with username `admin` and new password
    console.log(
      'Step 9: Logging in with username "admin" and the new password...',
    );
    await evalJs(`
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const inputs = document.querySelectorAll('input');
      const idInput = inputs[0];
      const pwInput = inputs[1];
      if (idInput && pwInput) {
        setter.call(idInput, 'admin');
        idInput.dispatchEvent(new Event('input', { bubbles: true }));

        setter.call(pwInput, '${testNewPassword}');
        pwInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const loginSubmit = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Đăng nhập'));
      if (loginSubmit) loginSubmit.click();
    `);
    await new Promise((r) => setTimeout(r, 2500));

    bodyText = await evalJs('return document.body.innerText;');
    const isLoggedIn =
      bodyText.includes('Tổng quan') ||
      bodyText.includes('Dashboard') ||
      bodyText.includes('Chủ sở hữu') ||
      bodyText.includes('Owner') ||
      bodyText.includes('Quản lý') ||
      bodyText.includes('Hệ thống');

    assert.ok(
      isLoggedIn,
      'User should be logged in to Management Lite dashboard',
    );
    console.log(
      '✓ Admin successfully authenticated with new password and reached Dashboard!',
    );

    ws.close();
    console.log(
      '\n=== CHROME CDP E2E TEST: ALL 9 STEPS PASSED SUCCESSFULLY! ===\n',
    );
  } finally {
    chrome.kill();
  }
}

runBrowserE2E().catch((err) => {
  console.error('E2E TEST FAILED:', err);
  process.exit(1);
});
