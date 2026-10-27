#!/usr/bin/env node
/**
 * Offline UI preview: serves apps/web/dist with a stubbed API (fixtures only,
 * no database, no network) and takes Chrome headless screenshots of the
 * Owner screens added for payroll statistics and the system log console.
 *
 *   npm run build && npm run build:web
 *   node scripts/dev/preview-screens.mjs [outDir]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  aggregateStats,
  sumBuckets,
} from '../../dist/apps/api/src/payroll/stats.js';

const root = path.resolve(import.meta.dirname, '../..');
const dist = path.join(root, 'apps/web/dist');
const outDir = path.resolve(process.argv[2] ?? '/tmp/ui-preview');
fs.mkdirSync(outDir, { recursive: true });
const chrome =
  process.env.CHROME_BIN ??
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const ws = '11111111-1111-4111-8111-111111111111';
const emp = '22222222-2222-4222-8222-222222222222';
const ok = (data) => ({ success: true, data, request_id: 'preview' });

const rows = [];
const mk = (date, hours, rate, clips) =>
  rows.push({
    employee_id: emp,
    employee_code: 'NV001',
    employee_name: 'Nguyễn Huỳnh Thế Vinh',
    work_date: date,
    worked_seconds: hours * 3600,
    shift_count: 1,
    wage_vnd: Math.round(hours * rate),
    hourly_rate_vnd: rate,
    report: clips
      ? {
          id: '33333333-3333-4333-8333-333333333333',
          status: 'submitted',
          total_reported_count: clips,
          notes: `${clips} clip LSK: linco, fensit`,
        }
      : null,
  });
mk('2026-06-01', 3, 20000, 8);
mk('2026-06-02', 4, 20000, 17);
mk('2026-06-08', 6, 20000, 12);
mk('2026-07-03', 3.75, 25000, 8);
mk('2026-07-09', 2, 25000, 0);
mk('2026-07-14', 5, 25000, 10);
mk('2026-08-06', 2, 25000, 18);
mk('2026-09-10', 4.92, 25000, 80);
mk('2026-10-14', 3, 25000, 70);

const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
const logs = [
  [
    'error',
    'api',
    'POST',
    '/api/v1/payroll-tools/timesheet/import',
    500,
    'INTERNAL_SERVER_ERROR',
    'insert or update on table "employee_hourly_rates" violates check constraint',
    12,
    480,
    'fp1',
  ],
  [
    'error',
    'web',
    'UI',
    '/payroll/stats',
    null,
    'CLIENT_ERROR',
    "TypeError: Cannot read properties of undefined (reading 'wage_vnd')",
    25,
    null,
    'fp2',
  ],
  [
    'warn',
    'api',
    'GET',
    '/api/v1/storage/folders/:id',
    403,
    'FORBIDDEN',
    'Bạn không có quyền xem thư mục này',
    40,
    35,
    'fp3',
  ],
  [
    'warn',
    'api',
    'GET',
    '/api/v1/payroll/periods/2026-10',
    200,
    'SLOW_REQUEST',
    'Slow request (4210 ms)',
    90,
    4210,
    'fp4',
  ],
  [
    'warn',
    'api',
    'POST',
    '/api/v1/reports/daily',
    422,
    'INVALID_WORK_ITEM',
    'Công việc liên kết không tồn tại hoặc chưa được giao cho bạn.',
    130,
    22,
    'fp5',
  ],
  [
    'error',
    'api',
    'POST',
    '/api/v1/payroll-tools/timesheet/import',
    500,
    'INTERNAL_SERVER_ERROR',
    'insert or update on table "employee_hourly_rates" violates check constraint',
    300,
    510,
    'fp1',
  ],
].map((l, i) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`,
  occurred_at: iso(l[7]),
  level: l[0],
  source: l[1],
  request_id: `req-${i}a1b2c3d4`,
  method: l[2],
  route: l[3],
  status: l[4],
  duration_ms: l[8],
  error_code: l[5],
  message: l[6],
  stack: `Error: ${l[6]}\n    at handler (apps/api/src/payroll/timesheet-service.ts:${100 + i}:11)\n    at async Server.<anonymous> (apps/api/src/app.ts:2960:7)`,
  fingerprint: l[9],
  release: 'ab7500c',
  user_id: emp,
  metadata: {},
}));

function route(url) {
  const u = new URL(url, 'http://x');
  const p = u.pathname;
  if (p === '/api/v1/auth/me')
    return ok({
      user: { id: emp, email: 'owner@example.com', email_verified: true },
      active_workspace: { id: ws, name: 'Management Lite', role: 'owner' },
      csrf_token: 'preview-csrf',
    });
  if (p === '/api/v1/employees')
    return ok({
      items: [
        { id: emp, employee_code: 'NV001', full_name: 'Nguyễn Huỳnh Thế Vinh' },
      ],
    });
  if (p === '/api/v1/payroll-tools/stats') {
    const g = u.searchParams.get('granularity') ?? 'month';
    const buckets = aggregateStats(rows, g);
    const t = sumBuckets(buckets);
    return ok({
      granularity: g,
      from: u.searchParams.get('from'),
      to: u.searchParams.get('to'),
      totals: t,
      buckets,
      notes: [
        'Chỉ tính ca đã hoàn tất và đã được duyệt (PAY-026).',
        'Tuần tính từ Thứ Hai đến Chủ nhật theo múi giờ Asia/Ho_Chi_Minh.',
      ],
    });
  }
  if (p === '/api/v1/system/logs/summary')
    return ok({
      hours: 24,
      totals: { error: 3, warn: 3, info: 0, slow: 1 },
      timeline: Array.from({ length: 24 }, (_, i) => ({
        bucket: iso((24 - i) * 60),
        level: i % 7 === 0 ? 'error' : 'warn',
        count: ((i * 5) % 6) + 1,
      })),
      top_errors: [
        {
          fingerprint: 'fp1',
          count: 2,
          users: 1,
          first_seen: iso(300),
          last_seen: iso(12),
          message: logs[0].message,
          route: logs[0].route,
          error_code: 'INTERNAL_SERVER_ERROR',
          status: 500,
          source: 'api',
        },
        {
          fingerprint: 'fp2',
          count: 1,
          users: 1,
          first_seen: iso(25),
          last_seen: iso(25),
          message: logs[1].message,
          route: logs[1].route,
          error_code: 'CLIENT_ERROR',
          status: null,
          source: 'web',
        },
      ],
      top_routes: [],
      retention_days: 30,
    });
  if (p === '/api/v1/system/logs')
    return ok({ items: logs, next_cursor: null });
  const detail = /^\/api\/v1\/system\/logs\/(.+)$/.exec(p);
  if (detail) {
    const log = logs.find((l) => l.id === detail[1]) ?? logs[0];
    return ok({
      log,
      related_audit_events: [
        {
          id: 'a1',
          action: 'payroll.timesheet_import',
          entity_type: 'employee',
          entity_id: emp,
          created_at: log.occurred_at,
        },
      ],
      same_request_logs: [],
      occurrences: { count: 2, first_seen: iso(300), last_seen: iso(12) },
    });
  }
  return null;
}

const mime = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
};
const server = http.createServer((req, res) => {
  // /__mobile?u=/path&w=360&h=2400 wraps the page in an iframe, because headless
  // Chrome refuses windows narrower than ~500px; the iframe gets a true 360px viewport.
  if (req.url.startsWith('/__mobile')) {
    const q = new URL(req.url, 'http://x').searchParams;
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(
      `<body style="margin:0;background:#222"><iframe src="${q.get('u')}" style="width:${Number(q.get('w'))}px;height:${Number(q.get('h'))}px;border:0;background:#fff"></iframe></body>`,
    );
    return;
  }
  const body = route(req.url);
  if (req.url.startsWith('/api/')) {
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify(
        body ?? {
          success: false,
          error: { code: 'NOT_FOUND', message: 'preview stub' },
        },
      ),
    );
    return;
  }
  const file = path.join(dist, req.url.split('?')[0]);
  const target =
    file.startsWith(dist) && fs.existsSync(file) && fs.statSync(file).isFile()
      ? file
      : path.join(dist, 'index.html');
  res.writeHead(200, {
    'content-type': mime[path.extname(target)] ?? 'application/octet-stream',
  });
  fs.createReadStream(target).pipe(res);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const shots = [
  ['payroll-stats', '/payroll/stats', 1280, 1500],
  ['payroll-stats-360', '/__mobile?u=/payroll/stats&w=360&h=2300', 520, 2300],
  ['system-logs', '/system-logs', 1280, 1700],
  ['system-logs-360', '/__mobile?u=/system-logs&w=360&h=2900', 520, 2900],
];
for (const [name, url, w, h] of shots) {
  const file = path.join(outDir, `${name}.png`);
  // Async spawn: the stub API above must keep serving while Chrome renders.
  const status = await new Promise((resolve) => {
    const child = spawn(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        `--window-size=${w},${h}`,
        '--virtual-time-budget=6000',
        `--screenshot=${file}`,
        `--user-data-dir=${path.join(outDir, '.profile-' + name)}`,
        base + url,
      ],
      { stdio: 'ignore' },
    );
    const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  console.log(
    name,
    status === 0 && fs.existsSync(file) ? 'ok' : 'FAILED',
    file,
  );
}
server.close();
