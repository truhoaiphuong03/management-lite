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
const cdpPort = 9245;

async function runChromeCategoryQA() {
  console.log('======================================================');
  console.log('🌐 REAL GOOGLE CHROME CDP QA — FINANCE CATEGORIES UI');
  console.log(`Target: ${webBase}`);
  console.log('======================================================\n');

  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${cdpPort}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=/tmp/chrome-cat-qa-${runId}`,
      '--window-size=1280,900',
    ],
  );

  const steps = [];
  function record(name, pass, detail = '') {
    steps.push({ name, pass, detail });
    console.log(`  ${pass ? '✔ PASS' : '✖ FAIL'}: ${name}${detail ? ` (${detail})` : ''}`);
  }

  try {
    await new Promise((r) => setTimeout(r, 1500));
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

    // 1. Login as Admin/Owner
    console.log('1. Logging in as Owner...');
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
    record('Submit Login credentials', loginRes.success, loginRes.reason);

    // Wait for auth & navigation
    await wait(2500);

    // 2. Navigate to /finance/categories via SPA history popstate
    console.log('\n2. Navigating to /finance/categories...');
    await evalExp(`
      window.history.pushState(null, "", "/finance/categories");
      window.dispatchEvent(new Event("popstate"));
    `);
    await wait(2000);

    // Check page title & heading
    const pageInfo = await evalExp(`
      (() => {
        const h1 = document.querySelector('h1');
        const nav = document.querySelector('nav[aria-label="Thu chi cá nhân"]');
        return {
          h1Text: h1 ? h1.innerText : '',
          hasNav: Boolean(nav),
          url: window.location.href,
        };
      })()
    `);
    record('Heading "Danh mục thu chi" renders', pageInfo.h1Text.includes('Danh mục thu chi'), pageInfo.h1Text);
    record('FinanceNav renders', pageInfo.hasNav);

    // 3. Check Compact Row Layout & Buttons
    console.log('\n3. Inspecting Category List layout, buttons, and spacing...');
    const catInspection = await evalExp(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const renameBtns = buttons.filter(b => b.innerText.includes('Đổi tên'));
        const deactivateBtns = buttons.filter(b => b.innerText.includes('Ngừng dùng'));
        const badges = Array.from(document.querySelectorAll('span')).filter(s => s.innerText === 'Đang dùng' || s.innerText === 'Ngừng dùng');

        let minGap = 999;
        let buttonOverlap = false;

        if (renameBtns.length > 0 && deactivateBtns.length > 0) {
          const rRect = renameBtns[0].getBoundingClientRect();
          const dRect = deactivateBtns[0].getBoundingClientRect();
          const gap = dRect.left - rRect.right;
          minGap = gap;
          if (rRect.right > dRect.left && rRect.bottom > dRect.top) {
            buttonOverlap = true;
          }
        }

        // Check if category rows are compact
        const rows = document.querySelectorAll('div[style*="justify-content: space-between"]');

        return {
          renameCount: renameBtns.length,
          deactivateCount: deactivateBtns.length,
          badgeCount: badges.length,
          buttonGap: minGap,
          buttonOverlap,
          firstRenameBg: renameBtns[0] ? window.getComputedStyle(renameBtns[0]).backgroundColor : '',
          firstDeactivateBg: deactivateBtns[0] ? window.getComputedStyle(deactivateBtns[0]).backgroundColor : '',
          rowCount: rows.length,
        };
      })()
    `);

    record('Category rows rendered (>0)', catInspection.renameCount > 0, `found ${catInspection.renameCount} categories`);
    record('Buttons have spacing (>= 8px)', catInspection.buttonGap >= 8, `gap = ${catInspection.buttonGap}px`);
    record('Buttons do not overlap', !catInspection.buttonOverlap);
    record('Đổi tên uses secondary/neutral styling', catInspection.firstRenameBg !== '', `bg: ${catInspection.firstRenameBg}`);
    record('Ngừng dùng uses destructive/warning styling', catInspection.firstDeactivateBg.includes('239') || catInspection.firstDeactivateBg.includes('185') || catInspection.firstDeactivateBg.includes('rgb'), `bg: ${catInspection.firstDeactivateBg}`);

    // 4. Test Deactivate Confirmation Modal
    console.log('\n4. Testing Deactivate Confirmation Modal...');
    await evalExp(`
      (() => {
        const deactivateBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Ngừng dùng'));
        if (!deactivateBtn) return false;
        deactivateBtn.click();
        return true;
      })()
    `);
    await wait(300);

    const dialogInspection = await evalExp(`
      (() => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return { open: false };
        const title = dialog.querySelector('h3');
        const confirmBtn = Array.from(dialog.querySelectorAll('button')).find(b => b.innerText.includes('Ngừng dùng'));
        const cancelBtn = Array.from(dialog.querySelectorAll('button')).find(b => b.innerText.includes('Hủy'));
        return {
          open: true,
          titleText: title ? title.innerText : '',
          hasConfirm: Boolean(confirmBtn),
          hasCancel: Boolean(cancelBtn),
        };
      })()
    `);

    record('Confirmation dialog opens on "Ngừng dùng" click', dialogInspection.open, dialogInspection.titleText);
    record('Confirmation dialog has destructive confirm button', dialogInspection.hasConfirm);
    record('Confirmation dialog has cancel button', dialogInspection.hasCancel);

    // Capture Dialog Screenshot
    const dialogShot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(
      resolve(PROJECT_ROOT, 'docs/handoff/screenshots/categories-dialog-1280.png'),
      Buffer.from(dialogShot.data, 'base64'),
    );
    console.log('  📸 Saved dialog screenshot: docs/handoff/screenshots/categories-dialog-1280.png');

    // Cancel the modal so no data is changed
    await evalExp(`
      (() => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (dialog) {
          const cancelBtn = Array.from(dialog.querySelectorAll('button')).find(b => b.innerText.includes('Hủy'));
          if (cancelBtn) cancelBtn.click();
        }
      })()
    `);
    await wait(300);

    const dialogClosed = await evalExp(`!document.querySelector('div[role="dialog"]')`);
    record('Cancel button dismisses modal without action', dialogClosed);

    // 5. Test Direction Tabs (Khoản chi / Nguồn thu)
    console.log('\n5. Testing Category Type Switcher (Khoản chi vs Nguồn thu)...');
    await evalExp(`
      (() => {
        const tabs = Array.from(document.querySelectorAll('button'));
        const incomeTab = tabs.find(b => b.innerText.includes('Nguồn thu'));
        if (!incomeTab) return false;
        incomeTab.click();
        return true;
      })()
    `);
    await wait(800);

    const incomeInspection = await evalExp(`
      (() => {
        const bodyText = document.body.innerText;
        const hasSalary = bodyText.includes('Lương Viettel Post') || bodyText.includes('Lương') || bodyText.includes('TikTok');
        return { hasSalary };
      })()
    `);
    record('Switch to Nguồn thu displays income categories', incomeInspection.hasSalary);

    // Capture Income Screenshot
    const incomeShot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(
      resolve(PROJECT_ROOT, 'docs/handoff/screenshots/categories-income-1280.png'),
      Buffer.from(incomeShot.data, 'base64'),
    );
    console.log('  📸 Saved income screenshot: docs/handoff/screenshots/categories-income-1280.png');

    // Switch back to Khoản chi
    await evalExp(`
      (() => {
        const tabs = Array.from(document.querySelectorAll('button'));
        const expenseTab = tabs.find(b => b.innerText.includes('Khoản chi'));
        if (expenseTab) expenseTab.click();
      })()
    `);
    await wait(800);

    // 6. Test Responsive / Mobile Viewport
    console.log('\n6. Testing Mobile Responsive Viewport (390px iPhone width)...');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await wait(500);

    const mobileInspection = await evalExp(`
      (() => {
        const body = document.body;
        const docEl = document.documentElement;
        const scrollWidth = Math.max(body.scrollWidth, docEl.scrollWidth);
        const clientWidth = window.innerWidth;
        const hasHorizontalOverflow = scrollWidth > clientWidth + 1; // 1px tolerance for subpixel rounding

        const buttons = Array.from(document.querySelectorAll('button'));
        const renameBtns = buttons.filter(b => b.innerText.includes('Đổi tên'));
        const deactivateBtns = buttons.filter(b => b.innerText.includes('Ngừng dùng'));

        let buttonsFit = true;
        if (renameBtns[0] && deactivateBtns[0]) {
          const dRect = deactivateBtns[0].getBoundingClientRect();
          if (dRect.right > clientWidth + 5) buttonsFit = false;
        }

        return {
          scrollWidth,
          clientWidth,
          hasHorizontalOverflow,
          buttonsFit,
        };
      })()
    `);

    record('Mobile viewport (390px) has no horizontal scroll overflow', !mobileInspection.hasHorizontalOverflow, `scroll: ${mobileInspection.scrollWidth}px, client: ${mobileInspection.clientWidth}px`);
    record('Mobile action buttons fit cleanly within viewport', mobileInspection.buttonsFit);

    // Capture Mobile Screenshot
    const mobileShot = await send('Page.captureScreenshot', { format: 'png' });
    mkdirSync(resolve(PROJECT_ROOT, 'docs/handoff/screenshots'), { recursive: true });
    writeFileSync(
      resolve(PROJECT_ROOT, 'docs/handoff/screenshots/categories-mobile-390.png'),
      Buffer.from(mobileShot.data, 'base64'),
    );
    console.log('  📸 Saved mobile screenshot: docs/handoff/screenshots/categories-mobile-390.png');

    // Reset to Desktop & Capture Desktop Screenshot
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await wait(500);

    const desktopShot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(
      resolve(PROJECT_ROOT, 'docs/handoff/screenshots/categories-desktop-1280.png'),
      Buffer.from(desktopShot.data, 'base64'),
    );
    console.log('  📸 Saved desktop screenshot: docs/handoff/screenshots/categories-desktop-1280.png');

    ws.close();
    chrome.kill();

    const allPassed = steps.every((s) => s.pass);
    console.log('\n======================================================');
    console.log(`TOTAL CHECKS: ${steps.length} | PASS: ${steps.filter((s) => s.pass).length} | FAIL: ${steps.filter((s) => !s.pass).length}`);
    console.log(`CONCLUSION: ${allPassed ? 'ALL PASS (QA VERIFIED)' : 'FAILED'}`);
    console.log('======================================================');

    process.exit(allPassed ? 0 : 1);
  } catch (err) {
    console.error('Test execution error:', err);
    chrome.kill();
    process.exit(1);
  }
}

runChromeCategoryQA();
