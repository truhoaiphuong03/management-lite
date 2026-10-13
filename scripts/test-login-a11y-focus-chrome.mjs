import { loadQaEndpoint } from './explicit-database.mjs';
import { spawn } from 'node:child_process';

const port = 9246;
const runId = Math.random().toString(36).substring(2, 8);
const targetUrl = loadQaEndpoint(process.env.QA_WEB_BASE);

async function run() {
  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=/tmp/chrome-login-focus-${runId}`,
    ],
  );

  try {
    await new Promise((r) => setTimeout(r, 1500));
    const newTab = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(targetUrl)}`, {
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

    const evaluate = async (exp) => {
      const r = await send('Runtime.evaluate', { expression: exp, returnByValue: true, awaitPromise: true });
      return r.result?.value;
    };

    await send('Page.enable');
    await new Promise((r) => setTimeout(r, 1000));

    // 1. Submit empty form
    const emptyTest = await evaluate(`
      (async () => {
        const form = document.querySelector('form');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 50));
        const active = document.activeElement;
        const idInput = document.getElementById('identifier');
        const passInput = document.getElementById('password');
        const alert = document.getElementById('login-error-alert');

        return {
          activeId: active?.id,
          idAriaInvalid: idInput?.getAttribute('aria-invalid'),
          idAriaDescribedby: idInput?.getAttribute('aria-describedby'),
          passAriaInvalid: passInput?.getAttribute('aria-invalid'),
          passAriaDescribedby: passInput?.getAttribute('aria-describedby'),
          hasAlert: Boolean(alert),
          alertText: alert?.textContent,
        };
      })()
    `);

    // 2. Fill identifier only and submit
    const idOnlyTest = await evaluate(`
      (async () => {
        const idInput = document.getElementById('identifier');
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(idInput, 'admin_test');
        idInput.dispatchEvent(new Event('input', { bubbles: true }));

        const form = document.querySelector('form');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await new Promise(r => setTimeout(r, 50));
        const active = document.activeElement;
        const passInput = document.getElementById('password');
        const alert = document.getElementById('login-error-alert');

        return {
          activeId: active?.id,
          idValue: idInput.value,
          passAriaInvalid: passInput?.getAttribute('aria-invalid'),
          passAriaDescribedby: passInput?.getAttribute('aria-describedby'),
          alertText: alert?.textContent,
        };
      })()
    `);

    // 3. Fill wrong password, submit -> 401 error -> password cleared, secret policy verified
    const authErrorTest = await evaluate(`
      (async () => {
        const passInput = document.getElementById('password');
        const idInput = document.getElementById('identifier');
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeSetter.call(passInput, 'WrongPassword123');
        passInput.dispatchEvent(new Event('input', { bubbles: true }));

        const form = document.querySelector('form');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

        // Wait for fetch response and re-render
        await new Promise(r => setTimeout(r, 800));

        const active = document.activeElement;
        const alert = document.getElementById('login-error-alert');

        return {
          idPreserved: idInput.value === 'admin_test',
          passwordCleared: passInput.value === '',
          activeId: active?.id,
          passAriaInvalid: passInput?.getAttribute('aria-invalid'),
          alertText: alert?.textContent,
        };
      })()
    `);

    console.log(JSON.stringify({ emptyTest, idOnlyTest, authErrorTest }, null, 2));

    ws.close();
  } finally {
    chrome.kill();
  }
}

run().catch(console.error);
