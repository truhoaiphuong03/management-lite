// Kiểm tra bảng → thẻ trên điện thoại: chèn bảng mẫu vào <main>, đo & chụp ảnh (DEV only).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = 5198;
const OUT = 'scripts/ui-audit/out-tables';
mkdirSync(OUT, { recursive: true });
const vite = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { cwd: 'apps/web', stdio: 'ignore' });
const stop = () => { try { vite.kill(); } catch { /* noop */ } };
process.on('exit', stop);
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break; } catch { /* retry */ }
  await new Promise((r) => setTimeout(r, 400));
}
const me = { success: true, data: { user: { id: 'u', email: 'a@b.c', email_verified: true }, active_workspace: { id: 'w', name: 'W', role: 'owner' }, csrf_token: 'x' } };
const html = `<div id="t-wrap" style="overflow-x:auto"><table style="width:100%;border-collapse:collapse"><thead><tr><th>Nhân viên</th><th>Giờ công</th><th>Lương</th><th>Trạng thái</th><th></th></tr></thead><tbody>
<tr><td style="padding:10px;border-bottom:1px solid #334">Nguyễn Văn A</td><td style="padding:10px">120</td><td style="padding:10px">12.000.000 ₫</td><td style="padding:10px">Đã chi</td><td style="padding:10px"><button>Xem</button></td></tr>
<tr><td colspan="5" style="padding:10px">Không có thêm dữ liệu</td></tr></tbody></table></div>`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const res = {};
try {
  for (const [name, w, h] of [['mobile', 360, 780], ['desktop', 1366, 768]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.route('**/api/**', (r) => r.fulfill({ json: r.request().url().includes('/auth/me') ? me : { success: true, data: [] } }));
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/settings`, { waitUntil: 'networkidle' });
    await page.evaluate((h2) => { document.getElementById('main-content').insertAdjacentHTML('afterbegin', h2); }, html);
    await page.waitForTimeout(400);
    res[name] = await page.evaluate(() => {
      const t = document.querySelector('#t-wrap table');
      const td = t.querySelector('tbody td');
      return { cls: t.className, label: td.getAttribute('data-label'), display: getComputedStyle(t.querySelector('thead')).display, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    await page.screenshot({ path: `${OUT}/${name}.png` });
    await ctx.close();
  }
} finally { await browser.close(); stop(); }
console.log(JSON.stringify(res, null, 1));
