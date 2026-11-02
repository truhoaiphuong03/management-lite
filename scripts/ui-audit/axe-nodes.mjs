// Liệt kê phần tử vi phạm label / select-name (DEV only). Dùng: node scripts/ui-audit/axe-nodes.mjs [routes]
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const routes = (
  process.argv[2] ||
  '/,/clock,/schedule,/reports,/storage,/attendance,/employees,/employees/new,/payroll,/accounts,/audit,/settings'
).split(',');
const PORT = 5196;
const vite = spawn(
  process.execPath,
  [
    resolve('node_modules/vite/bin/vite.js'),
    '--host',
    '127.0.0.1',
    '--port',
    String(PORT),
    '--strictPort',
  ],
  { cwd: 'apps/web', stdio: 'ignore' },
);
const stop = () => {
  try {
    vite.kill();
  } catch {
    /* noop */
  }
};
process.on('exit', stop);
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break;
  } catch {
    /* retry */
  }
  await new Promise((r) => setTimeout(r, 400));
}
const me = {
  success: true,
  data: {
    user: { id: 'u', email: 'a@b.c', email_verified: true },
    active_workspace: { id: 'w', name: 'W', role: 'owner' },
    csrf_token: 'x',
  },
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const ctx = await browser.newContext({
    viewport: { width: 1366, height: 768 },
  });
  await ctx.route('**/api/**', (r) =>
    r.fulfill({
      json: r.request().url().includes('/auth/me')
        ? me
        : { success: true, data: [] },
    }),
  );
  for (const path of routes) {
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}${path}`, {
      waitUntil: 'networkidle',
    });
    await page.addScriptTag({ content: axeSource });
    const found = await page.evaluate(async () => {
      const r = await window.axe.run(document, {
        runOnly: ['label', 'select-name', 'button-name', 'link-name'],
      });
      return r.violations.flatMap((v) =>
        v.nodes.map((n) => `${v.id}: ${n.html.slice(0, 140)}`),
      );
    });
    console.log(`## ${path} (${found.length})`);
    found.forEach((f) => console.log('  ' + f));
    await page.close();
  }
} finally {
  await browser.close();
  stop();
}
