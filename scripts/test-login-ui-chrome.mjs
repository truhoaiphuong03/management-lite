import { loadQaEndpoint } from './explicit-database.mjs';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const runId = Math.random().toString(36).substring(2, 8);
const webBase = loadQaEndpoint(process.env.QA_WEB_BASE);
const port = 9230;

async function runChromeTest() {
  console.log('======================================================');
  console.log('🌐 REAL GOOGLE CHROME CDP E2E — LOGIN UI & ACCESSIBILITY');
  console.log(`Target: ${webBase}`);
  console.log('======================================================\n');

  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=/tmp/chrome-login-qa-${runId}`,
    ],
  );

  const steps = [];
  function record(name, pass, detail = '') {
    steps.push({ name, pass, detail });
    console.log(
      `  ${pass ? '✔ PASS' : '✖ FAIL'}: ${name}${detail ? ` (${detail})` : ''}`,
    );
  }

  try {
    await new Promise((r) => setTimeout(r, 1500));
    const newTab = await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent(webBase)}`,
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
    let ready = false;
    for (let i = 0; i < 20; i++) {
      const title = await evaluate(
        `document.querySelector('.login-card-container') ? true : false`,
      );
      if (title) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(ready, 'Login page failed to mount within 4 seconds');

    // 1. Responsive Viewport Tests (360, 390, 768, 1024, 1440px)
    const viewports = [
      { width: 360, height: 640, isMobile: true },
      { width: 390, height: 844, isMobile: true },
      { width: 768, height: 1024, isMobile: true },
      { width: 1024, height: 768, isMobile: false },
      { width: 1440, height: 900, isMobile: false },
    ];

    for (const vp of viewports) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: vp.width,
        height: vp.height,
        deviceScaleFactor: 1,
        mobile: vp.isMobile,
      });
      await new Promise((r) => setTimeout(r, 100));

      const metrics = await evaluate(`(() => {
        const card = document.querySelector('.login-card-container');
        const brandPanel = document.querySelector('.login-brand-panel');
        const formPanel = document.querySelector('.login-form-panel');
        const mobileHeader = document.querySelector('.mobile-brand-header');
        const body = document.body;
        const html = document.documentElement;

        const brandStyle = brandPanel ? window.getComputedStyle(brandPanel) : null;
        const mobileHeaderStyle = mobileHeader ? window.getComputedStyle(mobileHeader) : null;
        const cardStyle = card ? window.getComputedStyle(card) : null;

        const hasHorizontalScroll = (html.scrollWidth > html.clientWidth) || (body.scrollWidth > body.clientWidth);

        return {
          cardWidth: card ? card.offsetWidth : 0,
          cardFlexDirection: cardStyle ? cardStyle.flexDirection : '',
          brandDisplay: brandStyle ? brandStyle.display : '',
          mobileHeaderDisplay: mobileHeaderStyle ? mobileHeaderStyle.display : '',
          hasHorizontalScroll,
        };
      })()`);

      if (vp.isMobile) {
        const isOk =
          metrics.brandDisplay === 'none' &&
          metrics.cardFlexDirection === 'column' &&
          !metrics.hasHorizontalScroll;
        record(
          `Responsive Layout at ${vp.width}px (Mobile)`,
          isOk,
          `brandDisplay=${metrics.brandDisplay}, cardFlex=${metrics.cardFlexDirection}, overflowX=${metrics.hasHorizontalScroll}`,
        );
      } else {
        const isOk =
          metrics.brandDisplay === 'flex' &&
          metrics.cardFlexDirection === 'row' &&
          !metrics.hasHorizontalScroll;
        record(
          `Responsive Layout at ${vp.width}px (Desktop Two-Column)`,
          isOk,
          `brandDisplay=${metrics.brandDisplay}, cardFlex=${metrics.cardFlexDirection}, cardWidth=${metrics.cardWidth}px`,
        );
      }
    }

    // Set to desktop for full interaction testing
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await new Promise((r) => setTimeout(r, 100));

    // 2. Show/Hide Password Toggle Interaction
    const pwState0 = await evaluate(`(() => {
      const pwInput = document.querySelector('#password');
      return pwInput ? pwInput.type : null;
    })()`);
    record(
      'Password input initially hidden',
      pwState0 === 'password',
      `type=${pwState0}`,
    );

    // Click toggle button
    await evaluate(`(() => {
      const btn = document.querySelector('#password + button') || document.querySelector('button[aria-label*="mật khẩu"]');
      if (btn) btn.click();
    })()`);
    await new Promise((r) => setTimeout(r, 50));

    const pwState1 = await evaluate(`(() => {
      const pwInput = document.querySelector('#password');
      const btn = document.querySelector('button[aria-label*="mật khẩu"]');
      return {
        type: pwInput ? pwInput.type : null,
        ariaLabel: btn ? btn.getAttribute('aria-label') : null,
      };
    })()`);
    record(
      'Password visible after toggle click',
      pwState1.type === 'text' && pwState1.ariaLabel === 'Ẩn mật khẩu',
      `type=${pwState1.type}, label=${pwState1.ariaLabel}`,
    );

    // Click toggle button again
    await evaluate(`(() => {
      const btn = document.querySelector('button[aria-label*="mật khẩu"]');
      if (btn) btn.click();
    })()`);
    await new Promise((r) => setTimeout(r, 50));

    const pwState2 = await evaluate(`(() => {
      const pwInput = document.querySelector('#password');
      const btn = document.querySelector('button[aria-label*="mật khẩu"]');
      return {
        type: pwInput ? pwInput.type : null,
        ariaLabel: btn ? btn.getAttribute('aria-label') : null,
      };
    })()`);
    record(
      'Password hidden after second toggle click',
      pwState2.type === 'password' && pwState2.ariaLabel === 'Hiện mật khẩu',
      `type=${pwState2.type}, label=${pwState2.ariaLabel}`,
    );

    // 3. Remember Me Compliance (FIX 3)
    const rememberMeState = await evaluate(`(() => {
      const checkbox = document.querySelector('input[type="checkbox"]');
      const label = checkbox ? checkbox.closest('label') : null;
      return {
        disabled: checkbox ? checkbox.disabled : false,
        checked: checkbox ? checkbox.checked : true,
        title: label ? label.title : '',
        badgeText: label ? label.querySelector('span:last-child')?.textContent : '',
      };
    })()`);
    record(
      'Remember Me checkbox disabled and unchecked',
      rememberMeState.disabled && !rememberMeState.checked,
      `disabled=${rememberMeState.disabled}`,
    );
    record(
      'Remember Me displays "Chưa hỗ trợ" tag',
      rememberMeState.badgeText?.includes('Chưa hỗ trợ'),
      `badge=${rememberMeState.badgeText}`,
    );
    record(
      'Remember Me tooltip states 12-hour duration and no browser-close claim',
      rememberMeState.title.includes('12 giờ') &&
        !rememberMeState.title.includes('khi đóng trình duyệt'),
      `tooltip=${rememberMeState.title.slice(0, 40)}...`,
    );

    // 4. Forgot Password Modal & Focus Accessibility (FIX 2)
    // Click "Quên mật khẩu?" button
    await evaluate(`(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const forgotBtn = buttons.find(b => b.textContent.includes('Quên mật khẩu'));
      if (forgotBtn) forgotBtn.click();
    })()`);
    await new Promise((r) => setTimeout(r, 100));

    const modalState = await evaluate(`(() => {
      const dialog = document.querySelector('div[role="dialog"]');
      const title = document.querySelector('#forgot-password-modal-title');
      const desc = document.querySelector('#forgot-password-modal-desc');
      const closeBtn = dialog ? dialog.querySelector('button[aria-label*="Đóng"]') : null;
      const activeElement = document.activeElement;
      return {
        isOpen: !!dialog,
        role: dialog ? dialog.getAttribute('role') : null,
        ariaModal: dialog ? dialog.getAttribute('aria-modal') : null,
        ariaLabelledby: dialog ? dialog.getAttribute('aria-labelledby') : null,
        hasTitle: !!title,
        hasDesc: !!desc,
        activeIsCloseBtn: activeElement === closeBtn,
        activeTag: activeElement ? activeElement.tagName : null,
      };
    })()`);
    record(
      'Forgot Password modal opened with role="dialog" & aria-modal="true"',
      modalState.isOpen &&
        modalState.role === 'dialog' &&
        modalState.ariaModal === 'true',
    );
    record(
      'Modal accessibility titles linked properly',
      modalState.hasTitle &&
        modalState.hasDesc &&
        modalState.ariaLabelledby === 'forgot-password-modal-title',
    );
    record(
      'Focus moved inside modal to close button upon opening',
      modalState.activeIsCloseBtn,
      `activeElement=${modalState.activeTag}`,
    );

    // Press Tab to test focus trap
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Tab',
      code: 'Tab',
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Tab',
      code: 'Tab',
    });
    await new Promise((r) => setTimeout(r, 50));

    const focusAfterTab = await evaluate(`(() => {
      const active = document.activeElement;
      return active ? { tag: active.tagName, text: active.textContent } : null;
    })()`);
    record(
      'Focus advanced to modal primary action "Đã hiểu"',
      focusAfterTab?.text?.includes('Đã hiểu'),
      `text=${focusAfterTab?.text}`,
    );

    // Press Escape to test closing
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
    });
    await new Promise((r) => setTimeout(r, 100));

    const afterEscapeState = await evaluate(`(() => {
      const dialog = document.querySelector('div[role="dialog"]');
      const active = document.activeElement;
      return {
        isOpen: !!dialog,
        activeText: active ? active.textContent : '',
      };
    })()`);
    record('Escape key closed modal', !afterEscapeState.isOpen);
    record(
      'Focus restored to "Quên mật khẩu?" trigger button',
      afterEscapeState.activeText?.includes('Quên mật khẩu'),
      `focused=${afterEscapeState.activeText}`,
    );

    // 5. Client validation errors
    // Submit empty form
    await evaluate(`(() => {
      const submitBtn = document.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.click();
    })()`);
    await new Promise((r) => setTimeout(r, 50));

    const errEmpty = await evaluate(`(() => {
      const alert = document.querySelector('div[role="alert"]');
      return alert ? alert.textContent : '';
    })()`);
    record(
      'Empty form submission triggers Vietnamese validation',
      errEmpty.includes('Vui lòng nhập tên đăng nhập và mật khẩu'),
      `error="${errEmpty}"`,
    );

    ws.close();
    chrome.kill('SIGTERM');

    console.log('\n======================================================');
    console.log(`TOTAL REAL CHROME CDP STEPS: ${steps.length}`);
    const passed = steps.filter((s) => s.pass).length;
    console.log(`PASSED: ${passed}/${steps.length}`);
    console.log('======================================================\n');

    if (passed !== steps.length) {
      process.exit(1);
    }
  } catch (err) {
    chrome.kill('SIGKILL');
    console.error('Chrome CDP test failed:', err);
    process.exit(1);
  }
}

runChromeTest();
