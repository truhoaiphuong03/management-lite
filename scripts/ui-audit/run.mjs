// UI audit (DEV only): chạy Vite dev server cổng riêng + mock API, chụp ảnh nhiều cỡ màn × theme,
// kiểm tra tràn ngang, tên truy cập của nút/ô nhập (axe-core).
// Dùng: node scripts/ui-audit/run.mjs [--out=dir] [--routes=/a,/b]
// Chrome hệ thống được dùng (channel 'chrome'), không tải trình duyệt.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve as resolvePath } from 'node:path';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => a.slice(2).split('=')),
);
const PORT = Number(args.port || 5199); // KHÔNG dùng 3000/3001/3002 (Production)
const OUT = args.out || 'scripts/ui-audit/out';
const ROLE = args.role || 'owner';
const SHOTS = args.shots !== 'off';

export const ROUTES = [
  '/',
  '/clock',
  '/schedule',
  '/reports',
  '/work',
  '/storage',
  '/attendance',
  '/attendance/review',
  '/employees',
  '/employees/new',
  '/payroll',
  '/payroll/stats',
  '/my-pay',
  '/accounts',
  '/audit',
  '/system-logs',
  '/issues',
  '/settings',
  '/finance',
  '/groups/attendance',
  '/groups/work',
  '/groups/hr-payroll',
  '/groups/admin',
  '/khong-ton-tai',
];
const routes = args.routes ? args.routes.split(',') : ROUTES;

export const VIEWPORTS = [
  { name: 'mobile', width: 360, height: 780, mobile: true },
  { name: 'tablet', width: 768, height: 1024, mobile: true },
  { name: 'desktop', width: 1366, height: 768, mobile: false },
];
const THEMES = args.themes ? args.themes.split(',') : ['dark', 'light'];

const me = {
  success: true,
  data: {
    user: { id: 'u-1', email: 'audit@example.com', email_verified: true },
    active_workspace: {
      id: 'w-1',
      name: 'THIẾT KẾ IN ẤN TOÀN GIA PHÁT',
      role: ROLE,
    },
    csrf_token: 'audit-csrf',
  },
};

async function waitForServer(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error('Vite dev server không khởi động được');
}

const vite = spawn(
  process.execPath,
  [
    resolvePath('node_modules/vite/bin/vite.js'),
    '--host',
    '127.0.0.1',
    '--port',
    String(PORT),
    '--strictPort',
  ],
  {
    cwd: 'apps/web',
    stdio: 'ignore',
    env: { ...process.env, VITE_PORT: String(PORT) },
  },
);
const stop = () => {
  try {
    vite.kill();
  } catch {
    /* noop */
  }
};
process.on('exit', stop);

const results = [];
try {
  await waitForServer(`http://127.0.0.1:${PORT}/`);
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.mobile && vp.width < 700,
        hasTouch: vp.mobile,
        deviceScaleFactor: 1,
      });
      await ctx.addInitScript(
        (t) => localStorage.setItem('mglite_theme', t),
        theme,
      );
      await ctx.route('**/api/**', (route) => {
        const url = route.request().url();
        if (url.includes('/auth/me')) return route.fulfill({ json: me });
        if (url.includes('/employees/me'))
          return route.fulfill({
            json: {
              success: true,
              data: { id: 'e-1', employee_code: 'OWNER', phone: '0900000000' },
            },
          });
        return route.fulfill({ json: { success: true, data: [] } });
      });
      for (const path of routes) {
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) =>
          errors.push(String(e.message).slice(0, 160)),
        );
        try {
          await page.goto(`http://127.0.0.1:${PORT}${path}`, {
            waitUntil: 'networkidle',
            timeout: 20000,
          });
          await page.waitForTimeout(400);
          const metrics = await page.evaluate(() => {
            const doc = document.documentElement;
            const overflowX = doc.scrollWidth - doc.clientWidth;
            const offenders = [];
            if (overflowX > 1) {
              for (const el of document.querySelectorAll('body *')) {
                const r = el.getBoundingClientRect();
                if (
                  r.right > doc.clientWidth + 1 &&
                  r.width > 0 &&
                  !el.closest(
                    '[style*="overflow-x"], [style*="overflow: auto"]',
                  )
                ) {
                  offenders.push(
                    `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`,
                  );
                  if (offenders.length >= 3) break;
                }
              }
            }
            const small = [...document.querySelectorAll('body *')].filter(
              (el) => {
                if (!el.childNodes.length) return false;
                const hasText = [...el.childNodes].some(
                  (n) => n.nodeType === 3 && n.textContent.trim(),
                );
                return (
                  hasText && parseFloat(getComputedStyle(el).fontSize) < 11
                );
              },
            ).length;
            return {
              overflowX,
              offenders,
              smallText: small,
              h1: document.querySelectorAll('h1').length,
            };
          });
          await page.addScriptTag({ content: axeSource });
          const axe = await page.evaluate(async () => {
            const r = await window.axe.run(document, {
              runOnly: [
                'button-name',
                'link-name',
                'label',
                'select-name',
                'image-alt',
                'color-contrast',
              ],
            });
            return r.violations.map((v) => ({ id: v.id, n: v.nodes.length }));
          });
          if (SHOTS) {
            await page.screenshot({
              path: `${OUT}/${vp.name}-${theme}-${path.replace(/\W+/g, '_') || 'root'}.png`,
            });
          }
          results.push({ vp: vp.name, theme, path, ...metrics, axe, errors });
        } catch (e) {
          results.push({
            vp: vp.name,
            theme,
            path,
            fatal: String(e.message).slice(0, 160),
          });
        }
        await page.close();
      }
      await ctx.close();
    }
  }
  await browser.close();
} finally {
  stop();
}

writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2));

const sum = {};
const bump = (k, by = 1) => {
  sum[k] = (sum[k] || 0) + by;
};
for (const r of results) {
  if (r.fatal) {
    bump('fatal');
    continue;
  }
  if (r.overflowX > 1) bump(`overflow:${r.vp}`);
  for (const a of r.axe) bump(`axe:${a.id}:${r.theme}`, a.n);
  if (r.errors.length) bump('pageerror');
}
console.log(JSON.stringify({ total: results.length, summary: sum }, null, 1));
export { results };
