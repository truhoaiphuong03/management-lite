import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import {
  SystemLogService,
  sanitizeLogText,
  normalizeRoute,
  logFingerprint,
} from '../../dist/apps/api/src/system-log/service.js';

function runStopScenarioInWorker(scenario, timeoutMs = 800) {
  const serviceUrl = new URL(
    '../../dist/apps/api/src/system-log/service.js',
    import.meta.url,
  ).href;

  const workerCode = `
    import { parentPort, workerData } from 'node:worker_threads';
    const { SystemLogService } = await import(workerData.serviceUrl);

    if (workerData.scenario === 'slow-ok') {
      const calls = [];
      let firstQueryStartedResolve;
      const firstQueryStarted = new Promise((r) => {
        firstQueryStartedResolve = r;
      });

      const svc = new SystemLogService({
        query: async (sql, params) => {
          calls.push({ sql, params });
          if (calls.length === 1) {
            firstQueryStartedResolve();
            await new Promise((r) => setTimeout(r, 60));
          } else {
            await new Promise((r) => setTimeout(r, 20));
          }
          return { rows: [], rowCount: 0 };
        },
      });

      svc.record({ level: 'error', source: 'api', message: 'first slow log' });
      const inFlight = svc.flush();
      await firstQueryStarted;

      svc.record({ level: 'warn', source: 'api', message: 'second queued log' });
      const concurrentFlush = svc.flush();
      await svc.stop();
      await Promise.all([inFlight, concurrentFlush]);

      parentPort.postMessage({
        ok: true,
        insertBatchRowCounts: calls
          .filter((c) => /INSERT INTO system_logs/.test(c.sql))
          .map((c) => c.params.length / 15),
      });
    } else if (workerData.scenario === 'slow-db-error') {
      let attempts = 0;
      let firstQueryStartedResolve;
      const firstQueryStarted = new Promise((r) => {
        firstQueryStartedResolve = r;
      });

      const origError = console.error;
      console.error = () => {};
      try {
        const svc = new SystemLogService({
          query: async () => {
            attempts += 1;
            if (attempts === 1) {
              firstQueryStartedResolve();
              await new Promise((r) => setTimeout(r, 50));
            } else {
              await new Promise((r) => setTimeout(r, 10));
            }
            throw new Error('DB connection lost during flush');
          },
        });

        svc.record({ level: 'error', source: 'api', message: 'first failing slow log' });
        const inFlight = svc.flush();
        await firstQueryStarted;

        for (let i = 0; i < 125; i++) {
          svc.record({ level: 'error', source: 'api', message: 'queued-' + i });
        }

        await svc.stop();
        await inFlight;

        parentPort.postMessage({
          ok: true,
          attempts,
        });
      } finally {
        console.error = origError;
      }
    }
  `;

  return new Promise((resolve, reject) => {
    const worker = new Worker(workerCode, {
      eval: true,
      workerData: { serviceUrl, scenario },
    });
    let settled = false;
    const timer = setTimeout(async () => {
      if (settled) return;
      settled = true;
      await worker.terminate();
      reject(
        new Error(
          `SystemLogService.stop() timed out after ${timeoutMs}ms in scenario "${scenario}" (microtask loop or unawaited flush)`,
        ),
      );
    }, timeoutMs);

    worker.once('message', (msg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(msg);
    });
    worker.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    worker.once('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Worker exited with code ${code}`));
      }
    });
  });
}

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

test('grand totals add up the buckets (work days are not collapsed)', async () => {
  const { aggregateStats, sumBuckets } =
    await import('../../dist/apps/api/src/payroll/stats.js');
  const row = (d, e, sec, wage, report) => ({
    employee_id: e,
    employee_code: e,
    employee_name: e,
    work_date: d,
    worked_seconds: sec,
    shift_count: 1,
    wage_vnd: wage,
    hourly_rate_vnd: 1,
    report,
  });
  const rep = {
    id: 'r',
    status: 'submitted',
    total_reported_count: 5,
    notes: null,
  };
  const rows = [
    row('2026-06-01', 'a', 3600, 100, rep),
    row('2026-06-02', 'a', 7200, 200, null),
    row('2026-07-01', 'a', 3600, 100, rep),
    row('2026-07-01', 'b', 3600, 300, null),
  ];
  const t = sumBuckets(aggregateStats(rows, 'month'));
  assert.equal(t.work_days, 4);
  assert.equal(t.report_days, 2);
  assert.equal(t.missing_report_days, 2);
  assert.equal(t.reported_clips, 10);
  assert.equal(t.wage_vnd, 700);
  assert.equal(t.worked_hours, 5);
  assert.deepEqual(
    t.employees.map((e) => [e.employee_id, e.wage_vnd, e.work_days]),
    [
      ['a', 400, 3],
      ['b', 300, 1],
    ],
  );
  assert.equal(sumBuckets([]).work_days, 0);
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

test(
  'stop() awaits an in-flight slow DB flush, drains newly queued logs without microtask hang, and finishes cleanly on DB errors',
  { timeout: 4000 },
  async () => {
    const okRes = await runStopScenarioInWorker('slow-ok', 800);
    assert.equal(okRes.ok, true);
    assert.deepEqual(okRes.insertBatchRowCounts, [1, 1]);

    const errRes = await runStopScenarioInWorker('slow-db-error', 1000);
    assert.equal(errRes.ok, true);
    // 1st in-flight batch (1 item) + 2 batches for 125 queued items (100 + 25) = 3 attempts
    assert.equal(errRes.attempts, 3);
  },
);
