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
const cdpPort = 9246;
const runId = Math.random().toString(36).substring(2, 8);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(step, pass, detail = '') {
  results.push({ step, pass, detail });
  console.log(
    `  ${pass ? '✔ PASS' : '✖ FAIL'}: ${step}${detail ? ` (${detail})` : ''}`,
  );
}

async function run() {
  console.log('======================================================');
  console.log('🌐 CHROME CDP QA: SKELETON INTEGRATION & RESPONSIVE SUITE');
  console.log(`Target: ${webBase}`);
  console.log('======================================================\n');

  const profile = `/tmp/chrome-skeleton-qa-${runId}`;
  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${cdpPort}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      '--window-size=1440,900',
    ],
    { stdio: 'ignore' },
  );

  try {
    await wait(1800);

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

    const evaluate = async (exp, timeout = 10000) => {
      const timer = new Promise((_, rej) =>
        setTimeout(
          () => rej(new Error('Browser evaluation timed out')),
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

    // 1. Wait for Login Page & Authenticate
    let ready = false;
    for (let i = 0; i < 20; i++) {
      const formExists = await evaluate(
        `Boolean(document.querySelector('input[type="password"]'))`,
      );
      if (formExists) {
        ready = true;
        break;
      }
      await wait(200);
    }
    record('Login Screen Ready', ready);

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

    const isLoggedIn = await evaluate(
      `Boolean(document.querySelector('header')?.textContent?.includes('Management Lite'))`,
    );
    record('Owner Authenticated', isLoggedIn);

    // 2. Test Screens at multiple Viewports: 360px (mobile), 768px (tablet), 1440px (desktop)
    const screens = [
      { name: 'Employees (/employees)', path: '/employees' },
      { name: 'Finance History (/finance/history)', path: '/finance/history' },
      { name: 'Payroll (/payroll)', path: '/payroll' },
    ];

    const viewports = [
      { name: 'Mobile 360px', width: 360, height: 740, isMobile: true },
      { name: 'Tablet 768px', width: 768, height: 1024, isMobile: true },
      { name: 'Desktop 1440px', width: 1440, height: 900, isMobile: false },
    ];

    for (const screen of screens) {
      console.log(`\n--- Testing ${screen.name} ---`);
      await evaluate(
        `window.history.pushState(null, '', '${screen.path}'); window.dispatchEvent(new Event('popstate'));`,
      );
      await wait(1200);

      const isMounted = await evaluate(
        `Boolean(document.querySelector('main') || document.body.textContent.length > 50)`,
      );
      record(`${screen.name} Mounted Successfully`, isMounted);

      for (const vp of viewports) {
        await send('Emulation.setDeviceMetricsOverride', {
          width: vp.width,
          height: vp.height,
          deviceScaleFactor: 1,
          mobile: vp.isMobile,
        });
        await wait(250);

        const overflowCheck = await evaluate(`(() => {
          const html = document.documentElement;
          const body = document.body;
          const hasHorizontalOverflow = (html.scrollWidth > html.clientWidth + 1) || (body.scrollWidth > body.clientWidth + 1);
          return {
            hasHorizontalOverflow,
            scrollWidth: html.scrollWidth,
            clientWidth: html.clientWidth,
          };
        })()`);

        record(
          `${screen.name} Responsive at ${vp.name}`,
          !overflowCheck.hasHorizontalOverflow,
          `measured: scrollWidth=${overflowCheck.scrollWidth}px, clientWidth=${overflowCheck.clientWidth}px, overflowDelta=${overflowCheck.scrollWidth - overflowCheck.clientWidth}px, status=${overflowCheck.hasHorizontalOverflow ? 'OVERFLOW_DETECTED' : 'FIT_EXACT'}`,
        );
      }
    }
  } finally {
    try {
      chrome.kill('SIGTERM');
    } catch {}
  }

  const allPass = results.every((r) => r.pass);
  console.log('\n======================================================');
  console.log(
    `TOTAL CHECKS: ${results.length} | PASS: ${results.filter((r) => r.pass).length} | FAIL: ${results.filter((r) => !r.pass).length}`,
  );
  console.log(`OVERALL RESULT: ${allPass ? '✔ ALL PASS' : '✖ SOME FAILED'}`);
  console.log('======================================================\n');
  process.exit(allPass ? 0 : 1);
}

run().catch((err) => {
  console.error('Test execution failed:', sanitizeErrorMessage(err));
  process.exit(1);
});
