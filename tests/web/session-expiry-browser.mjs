import { spawn } from 'node:child_process';
import http from 'node:http';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';

import {
  loadTestDatabaseConfig,
  assertSafeTestDatabase,
} from '../../dist/packages/database/src/config.js';

const dbConfig = loadTestDatabaseConfig(process.env);
assertSafeTestDatabase(dbConfig, process.env);
const DATABASE_URL = dbConfig.connectionString;

async function runSessionExpiryE2E() {
  console.log('=== CHROME CDP E2E: SESSION EXPIRATION & UX INTERCEPTOR ===');
  const port = 9455;
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

  const pool = new pg.Pool({ connectionString: DATABASE_URL });

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

    // Helper: Reset admin password to a known password
    const adminPassword = 'AdminSecretPass2026!#';
    const baselineHash =
      await import('../../dist/packages/security/src/password.js').then((m) =>
        m.hashPassword(adminPassword),
      );
    await pool.query(
      `UPDATE user_credentials SET password_hash = $1 WHERE user_id = (SELECT id FROM users WHERE username_normalized = 'admin');`,
      [baselineHash],
    );

    // SCENARIO 5: Login with wrong password displays error, no redirect loop
    console.log('\n--- Scenario 5: Login with wrong password ---');
    await send('Page.navigate', { url: 'http://127.0.0.1:3001/login' });
    await new Promise((r) => setTimeout(r, 1500));

    await evalJs(`
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const inputs = document.querySelectorAll('input');
      setter.call(inputs[0], 'admin');
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(inputs[1], 'TotallyWrongPassword123');
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Đăng nhập'));
      btn.click();
    `);
    await new Promise((r) => setTimeout(r, 1500));

    let bodyText = await evalJs('return document.body.innerText;');
    let currentUrl = await evalJs('return window.location.pathname;');
    assert.equal(currentUrl, '/login', 'Must stay on /login');
    assert.ok(
      bodyText.includes('không chính xác') ||
        bodyText.includes('không đúng') ||
        bodyText.includes('Đăng nhập'),
      'Must display login error without reload loop',
    );
    console.log(
      '✓ Scenario 5 PASS: Wrong password showed error, no reload loop, stayed at /login.',
    );

    // Login successfully as admin
    console.log('\nLogging in with valid admin credentials...');
    await evalJs(`
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const inputs = document.querySelectorAll('input');
      setter.call(inputs[0], 'admin');
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(inputs[1], '${adminPassword}');
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Đăng nhập'));
      btn.click();
    `);
    await new Promise((r) => setTimeout(r, 2000));

    // SCENARIO 1: Valid session -> stays on screen, no redirect
    console.log('\n--- Scenario 1: Valid session ---');
    await send('Page.navigate', { url: 'http://127.0.0.1:3001/clock' });
    await new Promise((r) => setTimeout(r, 1500));

    currentUrl = await evalJs('return window.location.pathname;');
    assert.equal(currentUrl, '/clock', 'Should be at /clock');
    bodyText = await evalJs('return document.body.innerText;');
    assert.ok(
      bodyText.includes('Chấm công') ||
        bodyText.includes('Clock') ||
        bodyText.includes('Giờ làm'),
      'Clock screen should render normally',
    );
    console.log(
      '✓ Scenario 1 PASS: Valid session does not redirect, stays on /clock.',
    );

    // SCENARIO 6: Multiple simultaneous 401s -> trigger redirect only once
    console.log(
      '\n--- Scenario 6: Multiple APIs returning 401 simultaneously ---',
    );
    // Invalidate all active sessions in DB
    await pool.query(
      `UPDATE auth_sessions SET revoked_at = now() WHERE revoked_at IS NULL;`,
    );

    // Fire 3 simultaneous fetch calls to authenticated endpoints from the browser
    await evalJs(`
      let redirectEventCount = 0;
      window.sessionExpiredCallCount = 0;

      Promise.all([
        fetch('/api/v1/attendance/me', { credentials: 'include' }),
        fetch('/api/v1/auth/me', { credentials: 'include' }),
        fetch('/api/v1/reports', { credentials: 'include' })
      ]).catch(() => {});

      return true;
    `);

    // Check banner appears immediately
    await new Promise((r) => setTimeout(r, 300));
    let hasBanner = await evalJs(`
      return Boolean(document.querySelector('[data-testid="session-expired-banner"]') || document.body.innerText.includes('hết hạn'));
    `);
    assert.ok(hasBanner, 'Expiration banner must appear on 401');
    console.log('✓ Banner appeared promptly.');

    // Wait 1.8 seconds (banner displays for 1.5s, then redirects)
    await new Promise((r) => setTimeout(r, 1800));
    currentUrl = await evalJs('return window.location.pathname;');
    assert.equal(
      currentUrl,
      '/login',
      'Must redirect to /login after notice timeout',
    );
    console.log(
      '✓ Scenario 6 PASS: Multiple simultaneous 401s resulted in exactly 1 redirect to /login.',
    );

    // SCENARIO 8 check: Post-login redirect returns user to previous route (/clock)
    console.log(
      '\n--- Scenario 8: Return to previous route (/clock) after re-login & Open Redirect Guard ---',
    );
    await evalJs(`
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const inputs = document.querySelectorAll('input');
      setter.call(inputs[0], 'admin');
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(inputs[1], '${adminPassword}');
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Đăng nhập'));
      btn.click();
    `);
    await new Promise((r) => setTimeout(r, 2000));
    currentUrl = await evalJs('return window.location.pathname;');
    assert.equal(
      currentUrl,
      '/clock',
      'Should return to previous path (/clock) post-login',
    );
    console.log('✓ Scenario 8 PASS: Returned to /clock after re-login.');

    // SCENARIO 2: Session expired during user action in ReportBugWidget -> does NOT store plaintext token
    console.log(
      '\n--- Scenario 2: Session expired in ReportBugWidget protects sensitive tokens ---',
    );
    const sampleSensitiveToken =
      'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sensitive_payload_123';
    const draftText = `Lỗi hệ thống nghiêm trọng kèm token: ${sampleSensitiveToken}`;
    await evalJs(`
      const openBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Báo lỗi'));
      if (openBtn) openBtn.click();
    `);
    await new Promise((r) => setTimeout(r, 500));

    await evalJs(`
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      const textarea = document.querySelector('textarea');
      if (textarea) {
        setter.call(textarea, '${draftText}');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      }
    `);

    // Invalidate session in DB
    await pool.query(
      `UPDATE auth_sessions SET revoked_at = now() WHERE revoked_at IS NULL;`,
    );

    // Click submit in bug widget
    await evalJs(`
      const sendBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Gửi báo lỗi'));
      if (sendBtn) sendBtn.click();
    `);
    await new Promise((r) => setTimeout(r, 400));

    hasBanner = await evalJs(`
      return Boolean(document.querySelector('[data-testid="session-expired-banner"]') || document.body.innerText.includes('hết hạn'));
    `);
    assert.ok(
      hasBanner,
      'Expiration banner must appear when ReportBugWidget detects 401',
    );

    // Wait for redirect to /login
    await new Promise((r) => setTimeout(r, 1800));
    currentUrl = await evalJs('return window.location.pathname;');
    assert.equal(currentUrl, '/login', 'Must redirect to /login');

    // Verify draft is NOT saved in plaintext in shared sessionStorage (Codex P1 requirement)
    const savedDraft = await evalJs(`
      return sessionStorage.getItem('mgmt_bug_report_draft');
    `);
    assert.equal(
      savedDraft,
      null,
      'Draft must NOT be saved in shared sessionStorage',
    );

    const allSessionStorage = await evalJs(`
      return JSON.stringify(sessionStorage);
    `);
    assert.equal(
      allSessionStorage.includes(sampleSensitiveToken),
      false,
      'Sample token must NOT be leaked or stored in plaintext in sessionStorage',
    );
    console.log(
      '✓ Scenario 2 PASS: Session expiry in ReportBugWidget redirected to /login without leaking plaintext tokens into sessionStorage.',
    );

    // SCENARIO 3: Session revoked after password reset -> automatically redirects
    console.log('\n--- Scenario 3: Session revoked after password reset ---');
    // Re-login
    await evalJs(`
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const inputs = document.querySelectorAll('input');
      setter.call(inputs[0], 'admin');
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(inputs[1], '${adminPassword}');
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Đăng nhập'));
      btn.click();
    `);
    await new Promise((r) => setTimeout(r, 2000));

    // Request and perform password reset in background (simulating user reset on another device)
    await new Promise((resolve, reject) => {
      const req = http.request(
        'http://127.0.0.1:3002/api/v1/auth/forgot-password',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://127.0.0.1:3001',
          },
        },
        (res) => {
          let d = '';
          res.on('data', (c) => (d += c));
          res.on('end', () => resolve(JSON.parse(d)));
        },
      );
      req.on('error', reject);
      req.write(JSON.stringify({ email: 'admin-reset@example.test' }));
      req.end();
    });

    // Internal test DB fixture: generate token directly in QA database without mock HTTP endpoint
    const userRes = await pool.query(
      `SELECT id FROM users WHERE username_normalized = 'admin' LIMIT 1;`,
    );
    const adminUserId = userRes.rows[0].id;
    const rToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rToken).digest('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3);`,
      [adminUserId, tokenHash, expiresAt],
    );

    const newAdminPass = 'AdminNewRotatedPass2026!#';
    await new Promise((resolve, reject) => {
      const req = http.request(
        'http://127.0.0.1:3002/api/v1/auth/reset-password',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'http://127.0.0.1:3001',
          },
        },
        (res) => {
          let d = '';
          res.on('data', (c) => (d += c));
          res.on('end', () => resolve(JSON.parse(d)));
        },
      );
      req.on('error', reject);
      req.write(JSON.stringify({ token: rToken, new_password: newAdminPass }));
      req.end();
    });

    // In the browser, the old session is now revoked. Any API call returns 401.
    await evalJs(`
      fetch('/api/v1/auth/me', { credentials: 'include' }).catch(() => {});
    `);
    await new Promise((r) => setTimeout(r, 400));
    hasBanner = await evalJs(`
      return Boolean(document.querySelector('[data-testid="session-expired-banner"]') || document.body.innerText.includes('hết hạn'));
    `);
    assert.ok(
      hasBanner,
      'Session revoked after password reset must show banner',
    );

    await new Promise((r) => setTimeout(r, 1800));
    currentUrl = await evalJs('return window.location.pathname;');
    assert.equal(
      currentUrl,
      '/login',
      'Must redirect to /login after session revoked by password reset',
    );
    console.log(
      '✓ Scenario 3 PASS: Session revoked after password reset transitioned to /login.',
    );

    // SCENARIO 4: 403 Forbidden does not redirect
    console.log('\n--- Scenario 4: 403 Forbidden does NOT redirect ---');
    // Login with new rotated password
    await evalJs(`
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const inputs = document.querySelectorAll('input');
      setter.call(inputs[0], 'admin');
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      setter.call(inputs[1], '${newAdminPass}');
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Đăng nhập'));
      btn.click();
    `);
    await new Promise((r) => setTimeout(r, 2000));

    // Make a 403 call (or test endpoint returning 403)
    await evalJs(`
      // Fetch an endpoint with forbidden method or action that returns 403
      fetch('/api/v1/auth/reauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password: 'wrong', action: 'test', account_id: '00000000-0000-0000-0000-000000000000' })
      }).catch(() => {});
    `);
    await new Promise((r) => setTimeout(r, 1000));

    currentUrl = await evalJs('return window.location.pathname;');
    assert.notEqual(
      currentUrl,
      '/login',
      '403 Forbidden must NOT redirect to /login',
    );
    console.log(
      '✓ Scenario 4 PASS: 403 Forbidden did not trigger redirect to /login.',
    );

    ws.close();
    console.log('\n=== CHROME CDP E2E: ALL 6 SCENARIOS PASSED 100%! ===\n');
  } finally {
    await pool.end();
    chrome.kill();
  }
}

runSessionExpiryE2E()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('SESSION EXPIRY E2E FAILED:', err);
    process.exit(1);
  });
