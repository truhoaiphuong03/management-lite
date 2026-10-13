import { loadQaEndpoint, loadQaSecret } from './explicit-database.mjs';
const qaAdminPassword = loadQaSecret('ADMIN_PASSWORD');
// Chrome CDP READ-ONLY smoke for FIN entry modal against the ISOLATED QA stack (web 3027 / API 3028).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = loadQaEndpoint(process.env.QA_WEB_BASE);
let cdpPort = 9293;
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
  const profile = `/tmp/chrome-smoke-${Math.random().toString(36).slice(2, 8)}`;
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

const bodyText = (c) => c.ev('document.body.innerText');
async function main() {
  const c = await session();
  try {
    await wait(1200);
    await c.login('admin', qaAdminPassword);
    const errTxt = 'Không tải được dữ liệu';
    // 1 Tổng hợp
    await c.nav('/finance');
    await wait(1500);
    let t = await bodyText(c);
    record('Tổng hợp: không có lỗi tải dữ liệu', !t.includes(errTxt));
    record(
      'Tổng hợp: Tổng thu 8.500.000 ₫, Tổng chi 50.000 ₫',
      /8\.500\.000/.test(t) && /50\.000/.test(t),
    );
    await c.shot('smoke-01-overview.png', 1280, 900);
    // 2 Popup (mở/đóng, KHÔNG lưu)
    await c.ev(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Thêm thu/chi')).click()`,
    );
    await wait(900);
    const dlg = await c.ev(
      `(()=>{const d=document.querySelector('[role=dialog]');if(!d)return null;const s=[...d.querySelectorAll('select')];return {path:location.pathname,cats:s[1]?s[1].options.length:0,amount:!!d.querySelector('input[inputmode=numeric]'),file:!!d.querySelector('input[type=file]'),save:[...d.querySelectorAll('button')].some(b=>b.textContent.trim()==='Lưu giao dịch')}})()`,
    );
    record(
      'Popup Thêm thu/chi mở tại /finance, có danh mục + số tiền + ảnh + nút Lưu',
      !!dlg &&
        dlg.path === '/finance' &&
        dlg.cats > 1 &&
        dlg.amount &&
        dlg.file &&
        dlg.save,
      JSON.stringify(dlg),
    );
    await c.shot('smoke-02-dialog.png', 1280, 900);
    await c.key('Escape');
    record(
      'Popup đóng bằng Esc (chưa nhập, không lưu gì)',
      !(await c.ev(`!!document.querySelector('[role=dialog]')`)),
    );
    // 3 Lịch sử
    await c.nav('/finance/history');
    await wait(1500);
    t = await bodyText(c);
    record('Lịch sử: không có lỗi tải dữ liệu', !t.includes(errTxt));
    record(
      'Lịch sử: hiển thị 2 giao dịch, Hiển thị 1–2 / 2 mục',
      /1–2 \/ 2 mục/.test(t) &&
        /Lương Viettel Post/.test(t) &&
        /Ăn uống, sinh hoạt/.test(t),
    );
    await c.shot('smoke-03-history.png', 1280, 900);
    // 4 Danh mục
    await c.nav('/finance/categories');
    await wait(1500);
    t = await bodyText(c);
    record('Danh mục: không có lỗi tải dữ liệu', !t.includes(errTxt));
    record(
      'Danh mục Khoản chi: 9 mục chuẩn (Hiển thị 1–9 / 9)',
      /1–9 \/ 9/.test(t),
      (t.match(/Hiển thị[^\n]*/) ?? [''])[0],
    );
    await c.shot('smoke-04-categories-expense.png', 1280, 900);
    await c.ev(
      `[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.trim()==='Nguồn thu').click()`,
    );
    await wait(1200);
    t = await bodyText(c);
    record(
      'Danh mục Nguồn thu: 4 mục chuẩn (Hiển thị 1–4 / 4)',
      /1–4 \/ 4/.test(t),
      (t.match(/Hiển thị[^\n]*/) ?? [''])[0],
    );
    record(
      'Danh mục Nguồn thu: có Lương Viettel Post, In ấn – Thiết kế, TikTok, Nguồn khác',
      ['Lương Viettel Post', 'In ấn – Thiết kế', 'TikTok', 'Nguồn khác'].every(
        (n) => t.includes(n),
      ),
    );
    await c.shot('smoke-05-categories-income.png', 1280, 900);
    // 5 Kế hoạch
    await c.nav('/finance/plan');
    await wait(1500);
    t = await bodyText(c);
    record(
      'Kế hoạch: không có lỗi tải dữ liệu',
      !t.includes(errTxt) && !/Không tìm thấy|Endpoint not found/.test(t),
    );
    record(
      'Kế hoạch: hiện 4 KPI và khối cần kiếm thêm Mỗi ngày/tuần/tháng',
      [
        'Tổng thu dự kiến',
        'Tổng chi dự kiến',
        'Chênh lệch thu',
        'cần kiếm thêm',
        'Mỗi ngày',
        'Mỗi tuần',
        'Mỗi tháng',
      ].every((n) => new RegExp(n, 'i').test(t)),
    );
    await c.shot('smoke-06-plan.png', 1280, 900);
    // Mobile 390 không tràn
    for (const p of [
      '/finance',
      '/finance/history',
      '/finance/categories',
      '/finance/plan',
    ]) {
      await c.nav(p);
      await wait(1000);
      await c.shot('smoke-m' + p.replace(/\//g, '-') + '.png', 390, 844, true);
      record(
        `Mobile 390 ${p}: không tràn ngang`,
        await c.ev(
          'document.documentElement.scrollWidth<=document.documentElement.clientWidth+1',
        ),
      );
    }
  } finally {
    c.close();
  }
  const pass = checks.filter(Boolean).length;
  console.log(`${pass}/${checks.length} PASS`);
  process.exit(pass === checks.length ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
