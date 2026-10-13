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

// READ-ONLY on live: opens dialogs and cancels; never confirms a mutation.
const PREFIX = process.env.SHOT_PREFIX ?? 'icon-after';
const probe = (scope) => `(()=>{
  const root=${scope};
  const btns=[...root.querySelectorAll('button[data-action]')];
  const rects=btns.map(b=>{const r=b.getBoundingClientRect();return {a:b.dataset.action,w:Math.round(r.width),h:Math.round(r.height),l:r.left,r:r.right,t:r.top,b:r.bottom,
    text:b.textContent.trim(),title:b.title,aria:b.getAttribute('aria-label'),svg:!!b.querySelector('svg'),color:getComputedStyle(b).color,tab:b.tabIndex}});
  let minGap=999;
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const A=rects[i],B=rects[j];
    if(Math.abs(A.t-B.t)<4){const g=Math.max(B.l-A.r,A.l-B.r);minGap=Math.min(minGap,g);}
    const ov=!(A.r<=B.l||B.r<=A.l||A.b<=B.t||B.b<=A.t);if(ov)minGap=-1;}
  return {n:rects.length,rects,minGap,
    overflowX:document.documentElement.scrollWidth>document.documentElement.clientWidth+1};
})()`;
const sizeOk = (r) => r.w >= 36 && r.w <= 44 && r.h >= 36 && r.h <= 44;

async function main() {
  const c = await session();
  try {
    await c.login('admin', qaAdminPassword);
    for (const [path, name, actions] of [
      ['/finance/history', 'history', ['view']],
      ['/finance/categories', 'categories', ['edit', 'deactivate']],
      ['/finance/plan', 'plan', ['edit', 'deactivate']],
    ]) {
      for (const [w, h, mobile, tag] of [
        [1280, 900, false, 'desktop'],
        [390, 844, true, 'mobile'],
      ]) {
        await c.nav(path);
        await c.send('Emulation.setDeviceMetricsOverride', {
          width: w,
          height: h,
          deviceScaleFactor: mobile ? 2 : 1,
          mobile,
        });
        await wait(1500);
        const p = await c.ev(probe('document'));
        record(`${name} ${tag}: có icon button`, p.n > 0, `n=${p.n}`);
        record(
          `${name} ${tag}: mọi nút 36–44px, có icon, không chữ`,
          p.rects.every((r) => sizeOk(r) && r.svg && r.text === ''),
          JSON.stringify(p.rects[0]),
        );
        record(
          `${name} ${tag}: tooltip + aria-label tiếng Việt`,
          p.rects.every(
            (r) =>
              r.title && r.aria && r.aria.startsWith(r.title) && r.tab >= 0,
          ),
          `${p.rects[0].title} | ${p.rects[0].aria}`,
        );
        record(
          `${name} ${tag}: khoảng cách ≥ 8px, không chồng`,
          p.minGap === 999 || p.minGap >= 8,
          `minGap=${p.minGap}`,
        );
        record(`${name} ${tag}: không tràn ngang`, !p.overflowX);
        for (const a of actions)
          record(
            `${name} ${tag}: có nút ${a}`,
            p.rects.some((r) => r.a === a),
          );
        if (tag === 'desktop' || name !== 'history')
          await c.shot(`${PREFIX}-${name}-${tag}.png`, w, h, mobile);
        if (name !== 'history' && tag === 'desktop') {
          const warn = p.rects.find((r) => r.a === 'deactivate');
          record(
            `${name}: Ngừng dùng màu cảnh báo (amber)`,
            /245, 158, 11/.test(warn.color),
            warn.color,
          );
        }
      }
    }
    // Keyboard focus + confirm dialog (no mutation)
    for (const [path, tid] of [
      ['/finance/categories', 'button[data-testid^="cat-deactivate-"]'],
      ['/finance/plan', 'button[data-testid^="plan-deactivate-"]'],
    ]) {
      await c.nav(path);
      await wait(1500);
      const focused = await c.ev(
        `(()=>{const b=document.querySelector('${tid}');b.focus();return document.activeElement===b})()`,
      );
      record(`${path}: nút focus được bằng bàn phím`, focused === true);
      const pat = [];
      await c.ev(
        `window.__m=[];const of=window.fetch;window.fetch=(u,o)=>{if(o&&o.method&&o.method!=='GET')window.__m.push(o.method+' '+u);return of(u,o)};true`,
      );
      await c.ev(`document.querySelector('${tid}').click()`);
      await wait(600);
      const dlg = await c.ev(
        `(()=>{const d=document.querySelector('[role=dialog]');return d?d.innerText:null})()`,
      );
      record(
        `${path}: bấm Ngừng dùng → hộp thoại xác nhận`,
        !!dlg && /Ngừng dùng/.test(dlg),
        (dlg ?? '').replace(/\s+/g, ' ').slice(0, 90),
      );
      await c.shot(`${PREFIX}-confirm-${path.split('/').pop()}.png`);
      await c.key('Escape');
      await wait(400);
      const m = await c.ev('window.__m');
      record(
        `${path}: Esc đóng hộp thoại, không gửi request ghi`,
        (m ?? pat).length === 0 &&
          (await c.ev(`!document.querySelector('[role=dialog]')`)),
        JSON.stringify(m),
      );
    }
  } finally {
    c.close();
  }
  console.log(checks.every(Boolean) ? 'ALL PASS' : 'CÓ FAIL');
  process.exit(checks.every(Boolean) ? 0 : 1);
}
main();
