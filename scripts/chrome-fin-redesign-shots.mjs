import { loadQaEndpoint, loadQaSecret } from './explicit-database.mjs';
const qaAdminPassword = loadQaSecret('ADMIN_PASSWORD');
// Chrome CDP shots for FIN entry modal against the ISOLATED QA stack (web 3027 / API 3028).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = loadQaEndpoint(process.env.QA_WEB_BASE);
let cdpPort = 9292;
const shots = resolve(ROOT, 'docs/handoff/screenshots');
mkdirSync(shots, { recursive: true });
const checks = [];
const record = (name, pass, detail = '') => {
  checks.push(pass);
  console.log(
    `${pass ? 'PASS' : 'FAIL'}: ${name}${detail ? ` (${detail})` : ''}`,
  );
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function session() {
  const profile = `/tmp/chrome-rd-qa-${Math.random().toString(36).slice(2, 8)}`;
  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      `--remote-debugging-port=${cdpPort}`,
      '--disable-gpu',
      '--no-first-run',
      `--user-data-dir=${profile}`,
      '--window-size=1280,900',
    ],
    { stdio: 'ignore' },
  );
  await wait(1800);
  const tab = await fetch(
    `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(web + '/login')}`,
    { method: 'PUT' },
  ).then((r) => r.json());
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 1;
  const cb = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && cb.has(m.id)) {
      const { res, rej } = cb.get(m.id);
      cb.delete(m.id);
      if (m.error) rej(new Error(m.error.message));
      else res(m.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = id++;
      cb.set(i, { res, rej });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send('Page.enable');
  await send('Runtime.enable');
  const ev = async (expression) =>
    (
      await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })
    ).result?.value;
  const shot = async (name, w = 1280, h = 900, mobile = false) => {
    await send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: mobile ? 2 : 1,
      mobile,
    });
    await wait(300);
    const s = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
    });
    writeFileSync(resolve(shots, name), Buffer.from(s.data, 'base64'));
  };
  const nav = async (path) => {
    await ev(
      `history.pushState(null,'',${JSON.stringify(path)});dispatchEvent(new Event('popstate'))`,
    );
    await wait(1200);
  };
  const login = async (user, pass) => {
    for (let i = 0; i < 40; i++) {
      if (await ev(`document.querySelectorAll('input').length>=2`)) break;
      await wait(250);
    }
    await ev(`(async()=>{const i=[...document.querySelectorAll('input')];
      const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      s.call(i[0],${JSON.stringify(user)});i[0].dispatchEvent(new Event('input',{bubbles:true}));
      s.call(i[1],${JSON.stringify(pass)});i[1].dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,200));
      (document.querySelector('button[type=submit]')||[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Đăng nhập'))).click();})()`);
    for (let i = 0; i < 40; i++) {
      if (!(await ev(`location.pathname.startsWith('/login')`))) break;
      await wait(250);
    }
    await wait(800);
  };
  const clickText = (text, scope = 'document') =>
    ev(
      `(()=>{const b=[...${scope}.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled);if(!b)return false;b.click();return true})()`,
    );
  const setValue = (selector, value) =>
    ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;
      const proto=e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});
      e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));return true})()`);
  const text = (tid) =>
    ev(`document.querySelector('[data-testid="${tid}"]')?.innerText ?? null`);
  const close = () => {
    ws.close();
    chrome.kill();
  };
  const key = async (k, code = k) => {
    await send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: k,
      code,
      windowsVirtualKeyCode: k === 'Escape' ? 27 : 9,
    });
    await send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: k,
      code,
      windowsVirtualKeyCode: k === 'Escape' ? 27 : 9,
    });
    await wait(250);
  };
  return { ev, shot, nav, login, clickText, setValue, text, close, send, key };
}

const PREFIX = process.argv[2] ?? 'rd-after';
const VIEWS = [
  ['01-overview', '/finance'],
  ['02-history', '/finance/history'],
  ['03-categories', '/finance/categories'],
  ['04-plan', '/finance/plan'],
];
const SIZES = [
  ['desktop', 1280, 900, false],
  ['laptop', 1024, 768, false],
  ['mobile', 390, 844, true],
];
async function main() {
  const c = await session();
  try {
    await wait(1200);
    await c.login('admin', qaAdminPassword);
    for (const [name, path] of VIEWS) {
      await c.nav(path);
      await wait(1000);
      for (const [label, w, h, m] of SIZES) {
        await c.shot(`${PREFIX}-${name}-${label}.png`, w, h, m);
        const ov = await c.ev(
          'document.documentElement.scrollWidth<=document.documentElement.clientWidth+1',
        );
        record(`${name} ${label}: không tràn ngang`, ov);
      }
    }
    await c.nav('/finance');
    await c.setValue('input[type="date"]', '2026-09-15');
    await wait(1200);
    for (const [label, w, h, m] of SIZES) {
      await c.shot(`${PREFIX}-01b-overview-data-${label}.png`, w, h, m);
      record(
        `overview có dữ liệu ${label}: không tràn ngang`,
        await c.ev(
          'document.documentElement.scrollWidth<=document.documentElement.clientWidth+1',
        ),
      );
    }
    await c.nav('/finance');
    await c.ev(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Thêm thu/chi')).click()`,
    );
    await wait(800);
    for (const [label, w, h, m] of SIZES)
      await c.shot(`${PREFIX}-05-dialog-${label}.png`, w, h, m);
  } finally {
    c.close();
  }
  console.log(`${checks.filter(Boolean).length}/${checks.length} PASS`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
