// Liệt kê cặp màu gây lỗi tương phản nhiều nhất (DEV only). Dùng: node scripts/ui-audit/contrast.mjs [theme] [routes] [port]
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const theme = process.argv[2] || 'light';
const routes = (process.argv[3] || '/,/clock,/settings,/payroll,/reports').split(',');
const PORT = Number(process.argv[4] || (theme === 'dark' ? 5198 : 5197));
const vite = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: 'apps/web', stdio: 'ignore' });
const stop = () => { try { vite.kill(); } catch { /* noop */ } };
process.on('exit', stop);
for (const f of ['--warning-text: #b45309']) void f;
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break; } catch { /* retry */ }
  await new Promise((r) => setTimeout(r, 400));
}
const me = { success: true, data: { user: { id: 'u', email: 'a@b.c', email_verified: true }, active_workspace: { id: 'w', name: 'W', role: 'owner' }, csrf_token: 'x' } };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const tally = {};
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await ctx.addInitScript((t) => localStorage.setItem('mglite_theme', t), theme);
  await ctx.route('**/api/**', (r) => r.fulfill({ json: r.request().url().includes('/auth/me') ? me : { success: true, data: [] } }));
  for (const path of routes) {
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}${path}`, { waitUntil: 'networkidle' });
    await page.addScriptTag({ content: axeSource });
    const found = await page.evaluate(async (p) => {
      const r = await window.axe.run(document, { runOnly: ['color-contrast'] });
      return r.violations.flatMap((v) => v.nodes.map((n) => {
        const d = n.any[0]?.data || {};
        return `${d.fgColor}/${d.bgColor} ratio=${d.contrastRatio} [${p}] @${String(n.target).slice(0, 80)}`;
      }));
    }, path);
    for (const f of found) tally[f] = (tally[f] || 0) + 1;
    await page.close();
  }
} finally { await browser.close(); stop(); }
console.log(Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => `${v}\t${k}`).join('\n'));
