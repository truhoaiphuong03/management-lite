import { loadQaEndpoint, loadQaSecret } from './explicit-database.mjs';
const qaAdminPassword = loadQaSecret('ADMIN_PASSWORD');
// Chrome CDP QA for FIN "Kế hoạch thu chi cố định" against an ISOLATED QA stack (web 3027 / API 3028).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = loadQaEndpoint(process.env.QA_WEB_BASE);
const api = loadQaEndpoint(process.env.QA_API_BASE) + '/api/v1';
let cdpPort = 9262;
const shots = resolve(ROOT, 'docs/handoff/screenshots');
mkdirSync(shots, { recursive: true });
const staffPassword = /STAFF_PASSWORD=(.*)/
  .exec(readFileSync(resolve(ROOT, '.env.qa-credentials.local'), 'utf8'))?.[1]
  ?.trim();

const checks = [];
const record = (name, pass, detail = '') => {
  checks.push({ name, pass });
  console.log(
    `${pass ? 'PASS' : 'FAIL'}: ${name}${detail ? ` (${detail})` : ''}`,
  );
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function session() {
  const profile = `/tmp/chrome-plan-qa-${Math.random().toString(36).slice(2, 8)}`;
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
    await ev(`(async()=>{const i=[...document.querySelectorAll('input')];
      const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      s.call(i[0],${JSON.stringify(user)});i[0].dispatchEvent(new Event('input',{bubbles:true}));
      s.call(i[1],${JSON.stringify(pass)});i[1].dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,200));
      (document.querySelector('button[type=submit]')||[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Đăng nhập'))).click();})()`);
    await wait(2500);
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
  return { ev, shot, nav, login, clickText, setValue, text, close };
}

const digits = (s) => (s ?? '').replace(/[^\d-]/g, '');
const overflow = (c) =>
  c.ev(
    `document.documentElement.scrollWidth<=document.documentElement.clientWidth+1`,
  );

async function addItem(c, dir, categoryName, amount) {
  await c.clickText(
    dir === 'income' ? 'Thu' : 'Chi',
    'document.querySelector("[role=tablist]")',
  );
  await wait(300);
  const optId = await c.ev(
    `(()=>{const o=[...document.querySelectorAll('select[aria-label="Danh mục"] option')].find(o=>o.textContent===${JSON.stringify(categoryName)});return o?o.value:null})()`,
  );
  if (!optId) return false;
  await c.setValue('select[aria-label="Danh mục"]', optId);
  const amountSel = `form input[inputmode="numeric"]`;
  await c.setValue(amountSel, String(amount));
  await wait(200);
  await c.clickText('Lưu khoản dự tính');
  await wait(1500);
  return true;
}

async function main() {
  const c = await session();
  try {
    await wait(1200);
    await c.login('admin', qaAdminPassword);
    await c.nav('/finance/plan');
    record(
      'Owner: tab Kế hoạch hiển thị & tiêu đề',
      (await c.ev(
        `document.body.innerText.includes('Kế hoạch thu chi cố định')`,
      )) &&
        (await c.ev(
          `[...document.querySelectorAll('button')].some(b=>b.textContent.includes('Kế hoạch thu chi cố định'))`,
        )),
    );
    await c.clickText('Thu', 'document.querySelector("[role=tablist]")');
    await wait(700);
    const catsIncome = await c.ev(
      `(()=>{const sel=document.querySelector('select[aria-label="Danh mục"]');return sel?[...sel.options].map(o=>o.textContent):[]})()`,
    );
    await c.clickText('Chi', 'document.querySelector("[role=tablist]")');
    await wait(500);
    const catsExpense = await c.ev(
      `[...document.querySelector('select[aria-label="Danh mục"]').options].map(o=>o.textContent)`,
    );
    record(
      'Danh mục lọc theo Thu/Chi',
      catsIncome.includes('Lương Viettel Post') &&
        !catsIncome.includes('Tiền nhà') &&
        catsExpense.includes('Tiền nhà') &&
        !catsExpense.includes('Lương Viettel Post'),
      `thu=${catsIncome.length - 1} chi=${catsExpense.length - 1}`,
    );
    record(
      'Trạng thái rỗng ban đầu: tổng = 0',
      digits(await c.text('plan-total-income')) === '0' &&
        digits(await c.text('plan-total-expense')) === '0',
    );
    await c.shot('plan-01-empty-desktop.png');

    // Thêm 12M thu + 15M chi (tháng 30 ngày)
    await c.ev(`(()=>{})()`);
    await c.setValue('input[type="month"]', '2026-04');
    await wait(300);
    record(
      'Thêm Thu 12.000.000',
      await addItem(c, 'income', 'Lương Viettel Post', 12000000),
    );
    record(
      'Thêm Chi 15.000.000',
      await addItem(c, 'expense', 'Tiền nhà', 15000000),
    );
    record(
      'Tổng thu/chi/chênh lệch đúng',
      digits(await c.text('plan-total-income')) === '12000000' &&
        digits(await c.text('plan-total-expense')) === '15000000' &&
        digits(await c.text('plan-net')) === '-3000000',
      `${await c.text('plan-net')}`,
    );
    const need = await c.text('plan-need');
    record(
      'Cần kiếm thêm: 3.000.000/tháng, 100.000/ngày, 700.000/tuần (30 ngày)',
      !!need &&
        /3\.000\.000/.test(need) &&
        /100\.000/.test(need) &&
        /700\.000/.test(need),
      (need ?? '').replace(/\s+/g, ' '),
    );
    await c.shot('plan-02-deficit-desktop.png');

    // Tháng 28 / 29 / 31 ngày
    await c.setValue('input[type="month"]', '2026-02');
    await wait(300);
    const feb = (await c.text('plan-need')) ?? '';
    record(
      'Tháng 2/2026 (28 ngày): 107.143/ngày, 750.000/tuần',
      /107\.143/.test(feb) && /750\.000/.test(feb),
      feb.replace(/\s+/g, ' '),
    );
    await c.setValue('input[type="month"]', '2024-02');
    await wait(300);
    const leap = (await c.text('plan-need')) ?? '';
    record(
      'Tháng 2/2024 (29 ngày, nhuận): 103.449/ngày, 724.138/tuần',
      /103\.449/.test(leap) && /724\.138/.test(leap),
      leap.replace(/\s+/g, ' '),
    );
    await c.setValue('input[type="month"]', '2026-01');
    await wait(300);
    const jan = (await c.text('plan-need')) ?? '';
    record(
      'Tháng 1/2026 (31 ngày): 96.775/ngày, 677.420/tuần',
      /96\.775/.test(jan) && /677\.420/.test(jan),
      jan.replace(/\s+/g, ' '),
    );
    await c.setValue('input[type="month"]', '2026-04');

    // Sửa số tiền: chi 15M -> 10M => dư 2M
    const edited = await c.ev(
      `(()=>{const l=document.querySelector('[data-testid="plan-list-expense"]');const b=[...l.querySelectorAll('button')].find(b=>b.dataset.action==='edit');if(!b)return false;b.click();return true})()`,
    );
    await wait(500);
    await c.ev(`(()=>{const d=document.querySelector('[role=dialog]');const i=d.querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'10000000');i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait(200);
    await c.ev(
      `(()=>{const d=document.querySelector('[role=dialog]');[...d.querySelectorAll('button')].find(b=>/Lưu/.test(b.textContent)).click()})()`,
    );
    await wait(1500);
    record(
      'Sửa số tiền cập nhật tổng (thu > chi: dư)',
      edited &&
        digits(await c.text('plan-net')) === '2000000' &&
        /2\.000\.000/.test(await c.text('plan-net')),
      await c.text('plan-status'),
    );
    record(
      'Thu = chi: cần kiếm thêm 0 khi dư',
      /^0\b|0\s*₫|0\s*đ/i.test((await c.text('plan-shortfall')) ?? '') ||
        digits(await c.text('plan-shortfall')) === '0',
      await c.text('plan-shortfall'),
    );

    // Ngừng dùng cần xác nhận
    await c.ev(
      `[...document.querySelector('[data-testid="plan-list-expense"]').querySelectorAll('button')].find(b=>b.dataset.action==='deactivate').click()`,
    );
    await wait(500);
    const dlg = await c.ev(`!!document.querySelector('[role=dialog]')`);
    record(
      'Ngừng dùng mở hộp xác nhận (chưa đổi dữ liệu)',
      dlg && digits(await c.text('plan-total-expense')) === '10000000',
    );
    await c.shot('plan-03-confirm-desktop.png');
    await c.ev(
      `(()=>{const d=document.querySelector('[role=dialog]');[...d.querySelectorAll('button')].filter(b=>/Ngừng dùng|Xác nhận/.test(b.textContent)).pop().click()})()`,
    );
    await wait(1500);
    record(
      'Sau xác nhận: khoản ngừng dùng bị loại khỏi tổng',
      digits(await c.text('plan-total-expense')) === '0',
    );
    record(
      'Hiển thị badge Ngừng dùng',
      await c.ev(
        `document.querySelector('[data-testid="plan-list-expense"]').innerText.includes('Ngừng dùng')`,
      ),
    );
    await c.ev(
      `[...document.querySelector('[data-testid="plan-list-expense"]').querySelectorAll('button')].find(b=>b.dataset.action==='reactivate').click()`,
    );
    await wait(1500);
    record(
      'Kích hoạt lại tính lại tổng',
      digits(await c.text('plan-total-expense')) === '10000000',
    );

    // Reload giữ dữ liệu
    await c.ev('location.reload()');
    await wait(3000);
    record(
      'Tải lại trang vẫn giữ dữ liệu',
      digits(await c.text('plan-total-income')) === '12000000' &&
        digits(await c.text('plan-total-expense')) === '10000000',
    );

    // Không ảnh hưởng sổ thu chi thực tế
    await c.nav('/finance');
    const body = await c.ev('document.body.innerText');
    record(
      'Tổng hợp thực tế không bị ảnh hưởng (không có 12.000.000)',
      !/12\.000\.000/.test(body),
    );
    for (const p of [
      '/finance/entry',
      '/finance/history',
      '/finance/categories',
    ]) {
      await c.nav(p);
      record(
        `Màn hình ${p} vẫn hiển thị`,
        await c.ev(`document.querySelectorAll('button').length>3`),
      );
    }

    // Responsive
    await c.nav('/finance/plan');
    record('Desktop 1280 không tràn ngang', await overflow(c));
    await c.shot('plan-04-desktop-full.png', 1280, 900);
    await c.shot('plan-05-mobile-390.png', 390, 844, true);
    record('Mobile 390 không tràn ngang', await overflow(c));
    await c.shot('plan-06-tablet-768.png', 768, 900);
    record('Tablet 768 không tràn ngang', await overflow(c));
    await c.shot('plan-04-desktop-full.png', 1280, 900);

    c.close();
    await wait(800);
  } finally {
  }
  cdpPort = 9263;
  const s2 = await session();
  try {
    await wait(1200);
    await s2.login('staff', staffPassword.replace(/^["']|["']$/g, ''));
    const staffNavTab = await s2.ev(
      `[...document.querySelectorAll('button,a')].some(e=>e.innerText.includes('Thu chi cá nhân'))`,
    );
    await s2.nav('/finance/plan');
    const body403 = await s2.ev('document.body.innerText');
    record(
      'Staff: không thấy menu, /finance/plan bị chặn',
      !staffNavTab && !/Tổng thu dự kiến/.test(body403),
      body403.slice(0, 80).replace(/\s+/g, ' '),
    );
    const staffApi = await s2.ev(`fetch('/api/v1/fin/plan').then(r=>r.status)`);
    record('Staff API /fin/plan => 403', staffApi === 403, String(staffApi));
    const staffPost = await s2.ev(
      `fetch('/api/v1/fin/plan-items',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.status)`,
    );
    record(
      'Staff API POST /fin/plan-items bị chặn (403/412/428)',
      [403, 412, 428].includes(staffPost),
      String(staffPost),
    );
    await s2.shot('plan-07-staff-403.png');
  } finally {
    s2.close();
  }
  const unauth = await fetch(`${api}/fin/plan`).then((r) => r.status);
  record('Chưa đăng nhập API /fin/plan => 401', unauth === 401, String(unauth));
  const failed = checks.filter((x) => !x.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
