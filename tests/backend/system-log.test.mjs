import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SystemLogService,
  sanitizeLogText,
  normalizeRoute,
  logFingerprint,
} from '../../dist/apps/api/src/system-log/service.js';

test('log text never keeps secrets', () => {
  const raw =
    'connect postgres://admin:S3cretPw@db:5432/x failed; Authorization: Bearer abc.def.ghi password=hunter2 token: "tok_123456"';
  const out = sanitizeLogText(raw, 600);
  assert.ok(!out.includes('S3cretPw'));
  assert.ok(!out.includes('abc.def.ghi'));
  assert.ok(!out.includes('hunter2'));
  assert.ok(!out.includes('tok_123456'));
  assert.ok(out.includes('[REDACTED]'));
  assert.equal(sanitizeLogText('x'.repeat(50), 10).length, 10);
  assert.equal(sanitizeLogText(null, 10), '');
});

test('routes are normalised so the same endpoint groups together', () => {
  assert.equal(
    normalizeRoute(
      '/api/v1/work/3f2b8c1e-1111-4222-8333-444455556666/assign?x=1',
    ),
    '/api/v1/work/:id/assign',
  );
  assert.equal(
    normalizeRoute('/api/v1/payroll/items/12345/x'),
    '/api/v1/payroll/items/:id/x',
  );
  assert.equal(
    normalizeRoute('https://ql.example.com/reports?employee=a#b'),
    '/reports',
  );
  assert.equal(normalizeRoute(''), '');
});

test('fingerprint groups the same failure and separates different ones', () => {
  const base = {
    level: 'error',
    source: 'api',
    route: '/api/v1/x',
    errorCode: 'E',
  };
  const stack = (line) =>
    `Error: boom\n    at ${line} (file.js:10:5)\n    at other (a.js:1:1)`;
  const a = logFingerprint({ ...base, message: 'boom 1', stack: stack('fnA') });
  const b = logFingerprint({ ...base, message: 'boom 2', stack: stack('fnA') });
  const c = logFingerprint({ ...base, message: 'boom 1', stack: stack('fnB') });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(a.length, 16);
});

test('record() never throws and flush writes one batched, sanitised insert', async () => {
  const calls = [];
  const svc = new SystemLogService({
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [], rowCount: 0 };
    },
  });
  svc.record({
    level: 'error',
    source: 'api',
    requestId: 'r1',
    route: '/api/v1/work/3f2b8c1e-1111-4222-8333-444455556666',
    status: 500,
    message: 'fail password=abc',
    stack: 'Error\n    at f (x.js:1:1)',
  });
  svc.record({ level: 'warn', source: 'web', message: 'client' });
  await svc.flush();
  const insert = calls.find((c) => /INSERT INTO system_logs/.test(c.sql));
  assert.ok(insert);
  assert.equal(insert.params.length, 30); // 2 rows x 15 columns
  assert.ok(!insert.params.join('|').includes('password=abc'));
  assert.equal(insert.params[6], '/api/v1/work/:id');
  // a failing database must not throw
  const bad = new SystemLogService({
    query: async () => {
      throw new Error('db down');
    },
  });
  bad.record({ level: 'error', source: 'api', message: 'x' });
  await bad.flush();
});

test('browser error intake is rate limited per user', () => {
  const svc = new SystemLogService({ query: async () => ({ rows: [] }) });
  let ok = 0;
  for (let i = 0; i < 25; i++) if (svc.allowClientError('u1')) ok++;
  assert.equal(ok, 20);
  assert.equal(svc.allowClientError('u2'), true);
});
