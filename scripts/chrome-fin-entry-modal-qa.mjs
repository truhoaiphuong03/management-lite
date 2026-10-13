import { loadQaEndpoint, loadQaSecret } from './explicit-database.mjs';
const qaAdminPassword = loadQaSecret('ADMIN_PASSWORD');
// Chrome CDP QA for FIN entry modal against the ISOLATED QA stack (web 3027 / API 3028).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = loadQaEndpoint(process.env.QA_WEB_BASE);
let cdpPort = 9282;
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

const noOverflow = (c) =>
  c.ev(
    `document.documentElement.scrollWidth<=document.documentElement.clientWidth+1`,
  );
const dialogOpen = (c) => c.ev(`!!document.querySelector('[role=dialog]')`);
const clickIn = (c, label) =>
  c.ev(
    `(()=>{const d=document.querySelector('[role=dialog]')||document;const b=[...d.querySelectorAll('button')].filter(b=>b.textContent.trim()===${JSON.stringify(label)}&&!b.disabled).pop();if(!b)return false;b.click();return true})()`,
  );
const openDialog = async (c) => {
  await c.ev(
    `[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Thêm thu/chi')).click()`,
  );
  await wait(500);
};
const fillDialog = async (c, { direction, category, amount, note }) => {
  if (
    direction &&
    (await c.ev(`document.querySelector('[role=dialog] select').value`)) !==
      direction
  )
    await c.setValue('[role=dialog] select', direction);
  await wait(900);
  if (category) {
    const id = await c.ev(
      `(()=>{const sel=[...document.querySelectorAll('[role=dialog] select')][1];const o=[...sel.options].find(o=>o.textContent===${JSON.stringify(category)});return o?o.value:null})()`,
    );
    if (!id) return false;
    await c.ev(
      `(()=>{const sel=[...document.querySelectorAll('[role=dialog] select')][1];Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(sel,${JSON.stringify(id)});sel.dispatchEvent(new Event('change',{bubbles:true}))})()`,
    );
  }
  if (amount)
    await c.setValue('[role=dialog] input[inputmode="numeric"]', amount);
  if (note)
    await c.ev(
      `(()=>{const t=document.querySelector('[role=dialog] textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(note)});t.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
  await wait(200);
  return true;
};
const api = (c, path) =>
  c.ev(`fetch('/api/v1/fin${path}').then(r=>r.json()).then(j=>j.data)`);

async function main() {
  const c = await session();
  try {
    await wait(1200);
    await c.login('admin', qaAdminPassword);
    await c.nav('/finance');
    await wait(1200);
    const tabs = await c.ev(
      `[...document.querySelectorAll('nav[aria-label="Thu chi cá nhân"] button')].map(b=>b.textContent.trim())`,
    );
    record(
      'Thanh điều hướng FIN còn 4 mục (không còn "Thêm thu/chi")',
      JSON.stringify(tabs) ===
        JSON.stringify([
          'Tổng hợp',
          'Lịch sử',
          'Danh mục',
          'Kế hoạch thu chi cố định',
        ]),
      JSON.stringify(tabs),
    );

    const before = await api(
      c,
      '/summary?period=year&anchor=' + new Date().toISOString().slice(0, 10),
    );
    await openDialog(c);
    record(
      'Bấm "+ Thêm thu/chi" mở hộp thoại, không chuyển trang',
      (await dialogOpen(c)) && (await c.ev('location.pathname')) === '/finance',
    );
    await wait(300);
    const focused = await c.ev(
      `document.activeElement?.tagName+':'+(document.activeElement?.closest('[role=dialog]')?'in':'out')`,
    );
    record(
      'Focus tự động vào trường đầu tiên (Loại) trong hộp thoại',
      focused === 'SELECT:in',
      focused,
    );
    const w = await c.ev(
      `Math.round(document.querySelector('[role=dialog] > div').getBoundingClientRect().width)`,
    );
    record('Desktop: hộp thoại rộng ≤ 640px', w <= 640 && w >= 400, String(w));
    const order = await c.ev(
      `[...document.querySelectorAll('[role=dialog] select, [role=dialog] input, [role=dialog] textarea')].slice(0,3).map(e=>e.tagName+(e.inputMode?':'+e.inputMode:''))`,
    );
    record(
      'Thứ tự trường: Loại → Số tiền → Danh mục ở đầu',
      JSON.stringify(order) === '["SELECT","INPUT:numeric","SELECT"]',
      JSON.stringify(order),
    );
    await c.shot('em-01-dialog-desktop.png', 1280, 900);

    // Validation: submit empty
    await clickIn(c, 'Lưu giao dịch');
    await wait(500);
    record(
      'Validation: lưu form trống báo lỗi, hộp thoại vẫn mở',
      (await dialogOpen(c)) &&
        (await c.ev(
          `!!document.querySelector('[role=dialog] [role=alert]') || ![...document.querySelectorAll('[role=dialog] select, [role=dialog] input')].every(e=>e.checkValidity())`,
        )),
    );
    await c.shot('em-02-validation.png', 1280, 900);

    // Esc không có dữ liệu → đóng
    await c.key('Escape');
    record('Esc khi chưa nhập gì: đóng ngay', !(await dialogOpen(c)));

    // Dữ liệu chưa lưu → cảnh báo
    await openDialog(c);
    await fillDialog(c, { amount: '12345' });
    await c.key('Escape');
    record(
      'Esc khi đã nhập dữ liệu: hiện cảnh báo, chưa đóng',
      (await dialogOpen(c)) &&
        (await c.ev(
          `!!document.querySelector('[data-testid="entry-discard-warning"]')`,
        )),
    );
    await c.shot('em-03-discard-warning.png', 1280, 900);
    await c.ev(
      `document.querySelector('[data-testid="entry-keep-editing"]').click()`,
    );
    await wait(300);
    record(
      '"Tiếp tục nhập" giữ nguyên dữ liệu',
      (await c.ev(
        `document.querySelector('[role=dialog] input[inputmode="numeric"]').value`,
      )) === '12345',
    );
    await c.ev(
      `document.querySelector('[aria-label="Đóng hộp thoại"]').click()`,
    );
    await wait(300);
    record(
      'Nút X khi có dữ liệu: hiện cảnh báo',
      await c.ev(
        `!!document.querySelector('[data-testid="entry-discard-warning"]')`,
      ),
    );
    await c.ev(
      `document.querySelector('[data-testid="entry-keep-editing"]').click()`,
    );
    await wait(300);
    await clickIn(c, 'Hủy');
    await wait(300);
    record(
      'Nút Hủy khi có dữ liệu: hiện cảnh báo (không đóng ngay)',
      (await dialogOpen(c)) &&
        (await c.ev(
          `!!document.querySelector('[data-testid="entry-discard-warning"]')`,
        )),
    );
    await c.ev(
      `document.querySelector('[data-testid="entry-discard"]').click()`,
    );
    await wait(400);
    record('"Bỏ thay đổi" đóng hộp thoại', !(await dialogOpen(c)));
    await openDialog(c);
    record(
      'Mở lại: form sạch (không giữ dữ liệu cũ)',
      (await c.ev(
        `document.querySelector('[role=dialog] input[inputmode="numeric"]').value`,
      )) === '',
    );

    // Bẫy focus bằng Tab
    let trapped = true;
    for (let i = 0; i < 14; i++) {
      await c.key('Tab');
      if (!(await c.ev(`!!document.activeElement?.closest('[role=dialog]')`)))
        trapped = false;
    }
    record('Bàn phím: Tab xoay vòng trong hộp thoại (focus trap)', trapped);

    // Lưu CHI thành công
    await fillDialog(c, {
      direction: 'expense',
      category: 'Ăn uống, sinh hoạt',
      amount: '50000',
      note: 'Thử hộp thoại - chi',
    });
    await clickIn(c, 'Lưu giao dịch');
    await wait(1800);
    record(
      'Lưu Chi thành công: hộp thoại đóng, vẫn ở /finance',
      !(await dialogOpen(c)) &&
        (await c.ev('location.pathname')) === '/finance',
    );
    record(
      'Hiện thông báo thành công',
      await c.ev(
        `document.body.innerText.includes('Đã lưu giao dịch thành công')`,
      ),
    );
    await c.shot('em-04-after-save.png', 1280, 900);

    // Thu với giờ thủ công
    await openDialog(c);
    await fillDialog(c, {
      direction: 'income',
      category: 'Lương Viettel Post',
      amount: '8500000',
    });
    await c.ev(
      `(()=>{const cb=document.querySelector('[role=dialog] input[type=checkbox]');cb.click()})()`,
    );
    await wait(300);
    const manual = await c.ev(
      `new Date(Date.now()+6*3600e3).toISOString().slice(0,16)`,
    );
    await c.setValue('[role=dialog] input[type="datetime-local"]', manual);
    await c.shot('em-05-manual-time.png', 1280, 900);
    await clickIn(c, 'Lưu giao dịch');
    await wait(1800);
    record('Lưu Thu với ngày giờ thủ công thành công', !(await dialogOpen(c)));
    const list = await api(c, '/entries?limit=5&offset=0');
    const income = list.items.find(
      (i) => i.direction === 'income' && i.amount_vnd === '8500000',
    );
    record(
      'Dữ liệu Thu đúng (giờ thủ công, nguồn manual)',
      !!income &&
        income.occurred_at_source === 'manual' &&
        String(income.occurred_at).startsWith(manual.slice(0, 13)),
      JSON.stringify(income && [income.occurred_at, income.occurred_at_source]),
    );
    const expense = list.items.find(
      (i) => i.direction === 'expense' && i.amount_vnd === '50000',
    );
    record(
      'Dữ liệu Chi đúng (giờ tự động)',
      !!expense && expense.occurred_at_source === 'auto',
    );
    const after = await api(
      c,
      '/summary?period=year&anchor=' + new Date().toISOString().slice(0, 10),
    );
    record(
      'Số liệu Tổng hợp được làm mới (+8.500.000 thu, +50.000 chi)',
      BigInt(after.total_income_vnd) - BigInt(before.total_income_vnd) ===
        8500000n &&
        BigInt(after.total_expense_vnd) - BigInt(before.total_expense_vnd) ===
          50000n,
    );

    // Ngày giờ tương lai bị chặn
    await openDialog(c);
    await fillDialog(c, {
      direction: 'expense',
      category: 'Chi khác',
      amount: '1000',
    });
    await c.ev(
      `document.querySelector('[role=dialog] input[type=checkbox]').click()`,
    );
    await wait(300);
    const future = await c.ev(
      `new Date(Date.now()+31*3600e3).toISOString().slice(0,16)`,
    );
    await c.setValue('[role=dialog] input[type="datetime-local"]', future);
    await clickIn(c, 'Lưu giao dịch');
    await wait(800);
    record(
      'Validation: thời gian tương lai bị chặn, hộp thoại giữ nguyên',
      (await dialogOpen(c)) &&
        (/tương lai/.test(
          await c.ev(
            `document.querySelector('[role=dialog] [role=alert]')?.innerText ?? ''`,
          ),
        ) ||
          !(await c.ev(
            `document.querySelector('[role=dialog] input[type="datetime-local"]').checkValidity()`,
          ))),
    );
    await c.key('Escape');
    await c.ev(
      `document.querySelector('[data-testid="entry-discard"]')?.click()`,
    );
    await wait(300);

    // Số tiền sai
    await openDialog(c);
    await fillDialog(c, {
      direction: 'expense',
      category: 'Chi khác',
      amount: '0',
    });
    await clickIn(c, 'Lưu giao dịch');
    await wait(600);
    record(
      'Validation: số tiền 0 bị từ chối',
      ((await dialogOpen(c)) &&
        (await c.ev(
          `!!document.querySelector('[role=dialog] [role=alert]')`,
        ))) ||
        (await api(c, '/entries?limit=50&offset=0')).items.every(
          (i) => i.amount_vnd !== '0',
        ),
    );
    await c.key('Escape');
    await c.ev(
      `document.querySelector('[data-testid="entry-discard"]')?.click()`,
    );
    await wait(300);

    // Lưu thất bại: giữ dữ liệu, thử lại thành công
    await openDialog(c);
    await fillDialog(c, {
      direction: 'expense',
      category: 'Mua sắm',
      amount: '77000',
      note: 'Thử lỗi mạng',
    });
    await c.ev(
      `window.__f=window.fetch;window.__failed=false;window.fetch=(u,o)=>{if(String(u).includes('/fin/entries')&&o&&o.method==='POST'&&!window.__failed){window.__failed=true;return Promise.reject(new Error('network'))}return window.__f(u,o)}`,
    );
    await clickIn(c, 'Lưu giao dịch');
    await wait(1200);
    const kept = await c.ev(
      `({open:!!document.querySelector('[role=dialog]'),amount:document.querySelector('[role=dialog] input[inputmode="numeric"]')?.value,note:document.querySelector('[role=dialog] textarea')?.value,alert:!!document.querySelector('[role=dialog] [role=alert], [role=dialog] [role=status]')})`,
    );
    record(
      'Lưu thất bại: hộp thoại mở, giữ nguyên dữ liệu, hiện lỗi/trạng thái',
      kept.open &&
        kept.amount === '77000' &&
        kept.note === 'Thử lỗi mạng' &&
        kept.alert,
      JSON.stringify(kept),
    );
    await c.shot('em-06-save-failed.png', 1280, 900);
    await clickIn(c, 'Thử lại đúng yêu cầu đã lưu');
    await wait(1800);
    record('Thử lại sau lỗi: lưu thành công và đóng', !(await dialogOpen(c)));
    const dupe = await api(c, '/entries?limit=20&offset=0');
    record(
      'Thử lại không tạo giao dịch trùng (đúng 1 bản ghi 77.000)',
      dupe.items.filter((i) => i.amount_vnd === '77000').length === 1,
    );

    // Ảnh hóa đơn
    const { default: sharp } = await import('sharp');
    const png = '/tmp/em-receipt.png';
    await sharp({
      create: {
        width: 320,
        height: 480,
        channels: 3,
        background: { r: 240, g: 240, b: 230 },
      },
    })
      .png()
      .toFile(png);
    await openDialog(c);
    await fillDialog(c, {
      direction: 'expense',
      category: 'Điện, nước',
      amount: '350000',
    });
    const doc = await c.send('DOM.getDocument', { depth: -1 });
    const node = await c.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: '[role=dialog] input[type=file]',
    });
    record('Hộp thoại có ô tải ảnh hóa đơn', node.nodeId > 0);
    if (node.nodeId > 0) {
      await c.send('DOM.setFileInputFiles', {
        nodeId: node.nodeId,
        files: [png],
      });
      await wait(2500);
      await c.shot('em-07-receipt.png', 1280, 900);
      await clickIn(c, 'Lưu giao dịch');
      await wait(2000);
      const rl = await api(c, '/entries?limit=5&offset=0');
      const withReceipt = rl.items.find((i) => i.amount_vnd === '350000');
      record(
        'Lưu kèm ảnh hóa đơn thành công, giao dịch có receipt',
        !(await dialogOpen(c)) &&
          !!withReceipt &&
          JSON.stringify(withReceipt).includes('receipt'),
        JSON.stringify(
          withReceipt &&
            Object.keys(withReceipt).filter((k) => k.includes('receipt')),
        ),
      );
    }

    // Tương thích /finance/new
    await c.ev(`location.href='/finance/new'`);
    await wait(3000);
    record(
      '/finance/new: chuyển về /finance và mở hộp thoại',
      (await c.ev('location.pathname')) === '/finance' && (await dialogOpen(c)),
    );
    await c.key('Escape');
    record(
      '/finance/new: đóng hộp thoại không để lại URL hỏng',
      !(await dialogOpen(c)) &&
        (await c.ev('location.pathname')) === '/finance',
    );

    // Mobile
    await openDialog(c);
    await c.shot('em-08-dialog-mobile.png', 390, 844, true);
    record('Mobile 390: không tràn ngang', await noOverflow(c));
    const geo = await c.ev(
      `(()=>{const d=document.querySelector('[role=dialog] > div').getBoundingClientRect();const f=[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent.trim()==='Lưu giao dịch').getBoundingClientRect();return {w:d.width,h:d.height,vh:innerHeight,saveVisible:f.top>=0&&f.bottom<=innerHeight}})()`,
    );
    record(
      'Mobile: hộp thoại gần toàn màn hình, nút Lưu luôn nhìn thấy',
      geo.w >= 340 && geo.h <= geo.vh && geo.saveVisible,
      JSON.stringify(geo),
    );
    await c.shot('em-09-dialog-tablet.png', 768, 900);
    record('Tablet 768: không tràn ngang', await noOverflow(c));
    await c.key('Escape');

    // Các màn khác không bị ảnh hưởng
    for (const [p, needle] of [
      ['/finance/history', 'Lịch sử thu chi'],
      ['/finance/categories', 'Danh mục thu chi'],
      ['/finance/plan', 'Kế hoạch thu chi cố định'],
    ]) {
      await c.nav(p);
      await wait(1000);
      record(
        `${p} vẫn hoạt động`,
        await c.ev(
          `document.body.innerText.includes(${JSON.stringify(needle)})`,
        ),
      );
    }
    await c.nav('/finance/history');
    await wait(1200);
    const hist = await c.ev(
      `document.querySelector('[data-testid="hist-pager-summary"]')?.innerText`,
    );
    record(
      'Lịch sử hiển thị các giao dịch mới (4 bản ghi)',
      /\/ 4 mục/.test(hist ?? ''),
      hist,
    );
    await c.nav(
      '/finance/entries/' +
        (await api(c, '/entries?limit=1&offset=0')).items[0].id,
    );
    await wait(1200);
    record(
      'Chi tiết giao dịch (/finance/entries/:id) vẫn hoạt động, có nút chỉnh sửa',
      await c.ev(`document.body.innerText.includes('Chỉnh sửa có lý do')`),
    );
    record('Màn chi tiết không hiện dạng popup', !(await dialogOpen(c)));
    c.close();
  } catch (e) {
    c.close();
    throw e;
  }
  cdpPort = 9283;
  const s2 = await session();
  try {
    await wait(1200);
    const staffPw = /STAFF_PASSWORD=(.*)/
      .exec(readFileSync(resolve(ROOT, '.env.qa-credentials.local'), 'utf8'))[1]
      .trim()
      .replace(/^["']|["']$/g, '');
    await s2.login('staff', staffPw);
    await s2.nav('/finance/new');
    await wait(1200);
    const body = await s2.ev('document.body.innerText');
    record(
      'Staff: /finance/new bị chặn, không mở hộp thoại',
      !(await dialogOpen(s2)) && !/Tổng hợp thu chi/.test(body),
    );
    const st = await s2.ev(
      `fetch('/api/v1/fin/entries',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.status)`,
    );
    record(
      'Staff: API tạo giao dịch bị chặn',
      [401, 403, 412, 428].includes(st),
      String(st),
    );
  } finally {
    s2.close();
  }
  const failed = checks.filter((x) => !x).length;
  console.log(`\n${checks.length - failed}/${checks.length} PASS`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(2);
});
