import { loadQaEndpoint, loadQaSecret } from './explicit-database.mjs';
const qaAdminPassword = loadQaSecret('ADMIN_PASSWORD');
// Chrome CDP QA for FIN pagination/UI polish against the ISOLATED QA stack (web 3027 / API 3028).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = loadQaEndpoint(process.env.QA_WEB_BASE);
const cdpPort = 9272;
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
  return { ev, shot, nav, login, clickText, setValue, text, close };
}

const testid = (c, id) =>
  c.ev(`document.querySelector('[data-testid="${id}"]')?.innerText ?? null`);
const click = (c, id) =>
  c.ev(
    `(()=>{const b=document.querySelector('[data-testid="${id}"]');if(!b||b.disabled)return false;b.click();return true})()`,
  );
const disabled = (c, id) =>
  c.ev(`document.querySelector('[data-testid="${id}"]')?.disabled ?? null`);
const rowTexts = (c, id) =>
  c.ev(
    `[...document.querySelectorAll('${id}')].map(e=>e.innerText.replace(/\\s+/g,' ').trim())`,
  );
const noOverflow = (c) =>
  c.ev(
    `document.documentElement.scrollWidth<=document.documentElement.clientWidth+1`,
  );

async function main() {
  const c = await session();
  try {
    await wait(1200);
    await c.login('admin', qaAdminPassword);

    // ===== HISTORY =====
    await c.nav('/finance/history');
    await wait(1200);
    const h1 = await testid(c, 'hist-pager-summary');
    record(
      'Lịch sử: tổng 118 mục, hiển thị 1–20',
      /1–20 \/ 118/.test(h1 ?? ''),
      h1,
    );
    record(
      'Lịch sử: mặc định 20 dòng/trang',
      (await rowTexts(c, '[data-testid="history-row"]')).length === 20,
    );
    record(
      'Lịch sử: Trước bị vô hiệu ở trang 1',
      (await disabled(c, 'hist-pager-prev')) === true,
    );
    record(
      'Lịch sử: chọn 10/20/50/100',
      JSON.stringify(
        await c.ev(
          `[...document.querySelectorAll('[data-testid="hist-pager-size"] option')].map(o=>o.value)`,
        ),
      ) === '["10","20","50","100"]',
    );
    record(
      'Lịch sử: mặc định chọn 20',
      (await c.ev(
        `document.querySelector('[data-testid="hist-pager-size"]').value`,
      )) === '20',
    );
    await c.shot('pg-01-history-desktop.png', 1280, 900);
    const seen = new Set(await rowTexts(c, '[data-testid="history-row"]'));
    let pages = 1;
    let last = '';
    while (!(await disabled(c, 'hist-pager-next'))) {
      await click(c, 'hist-pager-next');
      await wait(900);
      pages++;
      const rows = await rowTexts(c, '[data-testid="history-row"]');
      // rows can legitimately repeat visually (same text); compare by count instead of text
      last = await testid(c, 'hist-pager-summary');
      rows.forEach((r) => seen.add(r));
      if (pages > 10) break;
    }
    record(
      'Lịch sử: đi hết 6 trang, trang cuối 101–118',
      pages === 6 && /101–118 \/ 118/.test(last),
      `${pages} trang; ${last}`,
    );
    record(
      'Lịch sử: Sau bị vô hiệu ở trang cuối',
      (await disabled(c, 'hist-pager-next')) === true,
    );
    record(
      'Lịch sử: trang cuối còn 18 dòng',
      (await rowTexts(c, '[data-testid="history-row"]')).length === 18,
    );
    await click(c, 'hist-pager-prev');
    await wait(900);
    record(
      'Lịch sử: bấm Trước quay về trang 5',
      /Trang 5 \/ 6/.test((await testid(c, 'hist-pager-page')) ?? ''),
    );
    await c.setValue('[data-testid="hist-pager-size"]', '50');
    await wait(1000);
    record(
      'Lịch sử: đổi 50/trang → về trang 1, 3 trang',
      /Trang 1 \/ 3/.test((await testid(c, 'hist-pager-page')) ?? '') &&
        (await rowTexts(c, '[data-testid="history-row"]')).length === 50,
    );
    await c.setValue('[data-testid="hist-pager-size"]', '10');
    await wait(1000);
    record(
      'Lịch sử: 10/trang → 12 trang',
      /Trang 1 \/ 12/.test((await testid(c, 'hist-pager-page')) ?? ''),
    );
    await click(c, 'hist-pager-next');
    await click(c, 'hist-pager-next');
    await wait(1200);
    // đổi bộ lọc Loại → đặt lại trang 1
    await c.ev(`(()=>{const s=[...document.querySelectorAll('select')].find(e=>[...e.options].some(o=>o.value==='income'));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'income');s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await wait(1200);
    const inc = await testid(c, 'hist-pager-summary');
    record(
      'Lịch sử: đổi bộ lọc Loại đặt lại trang 1 và tổng đúng (0 giao dịch Thu)',
      /Trang 1 \/ 1/.test((await testid(c, 'hist-pager-page')) ?? '') &&
        /Không có mục nào/.test(inc ?? ''),
      inc,
    );
    record(
      'Lịch sử: trạng thái rỗng hiển thị',
      await c.ev(`document.body.innerText.includes('Chưa có giao dịch')`),
    );
    await c.setValue('[data-testid="hist-pager-size"]', '20');
    await c.ev(`(()=>{const s=[...document.querySelectorAll('select')].find(e=>[...e.options].some(o=>o.value==='income'));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'');s.dispatchEvent(new Event('change',{bubbles:true}))})()`);
    await wait(1200);
    await c.shot('pg-02-history-mobile.png', 390, 844, true);
    record('Lịch sử mobile 390: không tràn ngang', await noOverflow(c));
    await c.shot('pg-02b-history-tablet.png', 768, 900);
    record('Lịch sử tablet 768: không tràn ngang', await noOverflow(c));
    await c.shot('pg-02c-history-desktop-bottom.png', 1280, 900);
    record('Lịch sử desktop 1280: không tràn ngang', await noOverflow(c));

    // ===== CATEGORIES =====
    await c.nav('/finance/categories');
    await wait(1200);
    const c1 = await testid(c, 'cat-pager-summary');
    record(
      'Danh mục Chi: tổng 28, hiển thị 1–20 (mặc định 20/trang)',
      /1–20 \/ 28/.test(c1 ?? ''),
      c1,
    );
    record(
      'Danh mục: Trước vô hiệu ở trang 1',
      (await disabled(c, 'cat-pager-prev')) === true,
    );
    const names = new Set();
    const collect = async () =>
      await c.ev(
        `[...document.querySelectorAll('button')].filter(b=>b.dataset.action==='edit').length`,
      );
    record('Danh mục: 20 dòng ở trang 1', (await collect()) === 20);
    await c.shot('pg-03-categories-desktop.png', 1280, 900);
    let cp = 1;
    while (!(await disabled(c, 'cat-pager-next')) && cp < 10) {
      await click(c, 'cat-pager-next');
      await wait(900);
      cp++;
    }
    const cl = await testid(c, 'cat-pager-summary');
    record(
      'Danh mục Chi: 2 trang, trang cuối 21–28 (8 dòng)',
      cp === 2 && /21–28 \/ 28/.test(cl ?? '') && (await collect()) === 8,
      `${cp} trang; ${cl}`,
    );
    names.add(cl);
    // chuyển loại về Thu → trang 1
    await c.ev(
      `[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.includes('Nguồn thu')).click()`,
    );
    await wait(1200);
    const ci = await testid(c, 'cat-pager-summary');
    record(
      'Danh mục: chuyển sang Thu đặt lại trang 1, tổng 4',
      /Trang 1 \/ 1/.test((await testid(c, 'cat-pager-page')) ?? '') &&
        /1–4 \/ 4/.test(ci ?? ''),
      ci,
    );
    record(
      'Danh mục: không còn ô "Chuyển loại" trùng lặp',
      !(await c.ev(`document.body.innerText.includes('Chuyển loại')`)),
    );
    await c.ev(
      `[...document.querySelectorAll('[role=tab]')].find(b=>b.textContent.includes('Khoản chi')).click()`,
    );
    await wait(1200);
    await c.setValue('[data-testid="cat-pager-size"]', '20');
    await wait(1000);
    record(
      'Danh mục: 20/trang → 2 trang',
      /Trang 1 \/ 2/.test((await testid(c, 'cat-pager-page')) ?? ''),
    );
    await c.setValue('[data-testid="cat-pager-size"]', '10');
    await wait(900);
    // nút Ngừng dùng kiểu cảnh báo nhẹ (không đỏ đặc)
    const bg = await c.ev(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.dataset.action==='deactivate');return b?getComputedStyle(b).backgroundColor:null})()`,
    );
    record(
      'Danh mục: nút Ngừng dùng không còn nền đỏ đặc',
      !!bg && /rgba\(0, 0, 0, 0\)|transparent/.test(bg),
      bg,
    );
    // modal xác nhận vẫn đỏ
    await c.ev(
      `[...document.querySelectorAll('button')].find(b=>b.dataset.action==='deactivate').click()`,
    );
    await wait(500);
    const modalBg = await c.ev(
      `(()=>{const d=document.querySelector('[role=dialog]');if(!d)return null;const b=[...d.querySelectorAll('button')].find(b=>b.textContent.trim()==='Ngừng dùng');return b?getComputedStyle(b).backgroundColor:null})()`,
    );
    record(
      'Danh mục: modal xác nhận vẫn dùng nút đỏ',
      !!modalBg &&
        /rgb\(2(39|2\d), ?68, ?68\)|rgb\(239, 68, 68\)/.test(modalBg),
      modalBg,
    );
    await c.shot('pg-04-categories-confirm.png', 1280, 900);
    await c.ev(
      `[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Hủy').click()`,
    );
    await wait(400);
    await c.shot('pg-05-categories-mobile.png', 390, 844, true);
    record('Danh mục mobile 390: không tràn ngang', await noOverflow(c));
    await c.shot('pg-05b-categories-tablet.png', 768, 900);
    record('Danh mục tablet 768: không tràn ngang', await noOverflow(c));
    const rowH = await c.ev(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.dataset.action==='edit');return b.closest('div[style*="border-bottom"], div').parentElement.getBoundingClientRect().height})()`,
    );
    console.log('  (row container height', rowH, ')');

    // ===== OVERVIEW =====
    await c.nav('/finance');
    await wait(1500);
    const hasPeriodSelect = await c.ev(
      `[...document.querySelectorAll('select')].some(s=>[...s.options].some(o=>o.textContent==='Tuần'))`,
    );
    record(
      'Tổng hợp: không còn dropdown "Kỳ" trùng với nút Ngày/Tuần/Tháng/Năm',
      !hasPeriodSelect,
    );
    const tabs = await c.ev(
      `[...document.querySelectorAll('[role=tablist] button')].map(b=>b.textContent.trim())`,
    );
    record(
      'Tổng hợp: giữ nút Ngày/Tuần/Tháng/Năm',
      JSON.stringify(tabs) === '["Ngày","Tuần","Tháng","Năm"]',
      JSON.stringify(tabs),
    );
    await c.ev(
      `[...document.querySelectorAll('[role=tablist] button')].find(b=>b.textContent.trim()==='Năm').click()`,
    );
    await wait(1000);
    record(
      'Tổng hợp: chuyển kỳ Năm vẫn hoạt động',
      await c.ev(`document.body.innerText.includes('Kỳ:')`),
    );
    await c.shot('pg-06-overview-desktop.png', 1280, 900);
    await c.shot('pg-06b-overview-mobile.png', 390, 844, true);
    record('Tổng hợp mobile 390: không tràn ngang', await noOverflow(c));

    // ===== PLAN =====
    await c.nav('/finance/plan');
    await wait(1500);
    // chuẩn mới: mặc định 20/trang → chọn 10/trang để kiểm tra nhiều trang
    await c.setValue('[data-testid="plan-pager-expense-size"]', '10');
    await wait(500);
    const pe = await c.ev(
      `document.querySelector('[data-testid="plan-pager-expense"]')?.innerText ?? null`,
    );
    record(
      'Kế hoạch: danh sách Chi 12 khoản có phân trang gọn (1–10 / 12)',
      /1–10 \/ 12/.test(pe ?? ''),
      (pe ?? '').replace(/\s+/g, ' '),
    );
    record(
      'Kế hoạch: Thu 1 khoản không hiện phân trang',
      (await c.ev(
        `!!document.querySelector('[data-testid="plan-pager-income"]')`,
      )) === false,
    );
    const tot = (await c.text('plan-total-expense')) ?? '';
    record(
      'Kế hoạch: tổng chi tính trên TẤT CẢ 12 khoản (12.000.000), không chỉ trang hiện tại',
      /12\.000\.000/.test(tot),
      tot,
    );
    await click(c, 'plan-pager-expense-next');
    await wait(500);
    const tot2 = (await c.text('plan-total-expense')) ?? '';
    record(
      'Kế hoạch: sang trang 2 tổng chi vẫn 12.000.000, trang 2 có 2 dòng',
      /12\.000\.000/.test(tot2) &&
        /11–12 \/ 12/.test(
          (await c.ev(
            `document.querySelector('[data-testid="plan-pager-expense"]').innerText`,
          )) ?? '',
        ),
      tot2,
    );
    await c.shot('pg-07-plan-desktop.png', 1280, 900);
    await c.shot('pg-07b-plan-mobile.png', 390, 844, true);
    record('Kế hoạch mobile 390: không tràn ngang', await noOverflow(c));
  } finally {
    c.close();
  }
  const failed = checks.filter((x) => !x).length;
  console.log(`\n${checks.length - failed}/${checks.length} PASS`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
