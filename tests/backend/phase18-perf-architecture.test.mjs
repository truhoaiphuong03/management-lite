import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

test('Phase 18.1: RouteTable provides O(1) exact route lookup and prefix dispatch', async () => {
  const { RouteTable } = await import(
    '../../dist/apps/api/src/routes/router.js'
  );

  const calls = [];
  const table = new RouteTable()
    .registerExact('GET', '/api/v1/schedules/me', async () => {
      calls.push('exact:schedules/me');
      return true;
    })
    .registerPrefix('/api/v1/schedules', async (ctx) => {
      calls.push(`prefix:${ctx.pathname}`);
      return true;
    });

  assert.equal(table.hasExact('GET', '/api/v1/schedules/me'), true);
  assert.equal(table.hasExact('POST', '/api/v1/schedules/me'), false);
  assert.equal(table.getExactCount(), 1);
  assert.equal(table.getPrefixCount(), 1);

  const exactHandled = await table.dispatch({
    method: 'GET',
    pathname: '/api/v1/schedules/me',
  });
  assert.equal(exactHandled, true);
  assert.deepEqual(calls, ['exact:schedules/me']);

  const prefixHandled = await table.dispatch({
    method: 'GET',
    pathname: '/api/v1/schedules/sched-123',
  });
  assert.equal(prefixHandled, true);
  assert.deepEqual(calls, [
    'exact:schedules/me',
    'prefix:/api/v1/schedules/sched-123',
  ]);

  const unrelatedHandled = await table.dispatch({
    method: 'GET',
    pathname: '/api/v1/other',
  });
  assert.equal(unrelatedHandled, false);
});

test('Phase 18.2: SchedulesService batches week entries into a single UNNEST INSERT query', async () => {
  const { SchedulesService } = await import(
    '../../dist/apps/api/src/schedules/service.js'
  );

  const executedQueries = [];
  const mockPool = {
    query: async () => ({ rows: [] }),
    connect: async () => ({
      query: async (sql, params) => {
        executedQueries.push({ sql, params });
        return {
          rows: [
            {
              id: 'ent-1',
              workspace_id: 'ws-1',
              schedule_id: 'sched-1',
              work_date: '2026-11-02',
              day_of_week: 1,
              start_time: '08:00',
              notes: null,
              created_at: new Date().toISOString(),
            },
          ],
        };
      },
      release: () => {},
    }),
  };

  const svc = new SchedulesService(mockPool);
  const client = await mockPool.connect();
  const entries = [
    { work_date: '2026-11-02', day_of_week: 1, start_time: '08:00', notes: 'Mon' },
    { work_date: '2026-11-03', day_of_week: 2, start_time: '08:30', notes: 'Tue' },
    { work_date: '2026-11-04', day_of_week: 3, start_time: '09:00', notes: null },
    { work_date: '2026-11-05', day_of_week: 4, start_time: '08:00', notes: null },
    { work_date: '2026-11-06', day_of_week: 5, start_time: '08:00', notes: null },
  ];

  await svc.insertScheduleEntriesBatch(client, 'ws-1', 'sched-1', entries);

  assert.equal(
    executedQueries.length,
    1,
    'Expected 5 schedule entries to be inserted in 1 UNNEST query instead of 5 round-trips',
  );
  assert.match(executedQueries[0].sql, /FROM unnest\(\$3::text\[\], \$4::int\[\], \$5::text\[\], \$6::text\[\]\)/i);
  assert.deepEqual(executedQueries[0].params[2], [
    '2026-11-02',
    '2026-11-03',
    '2026-11-04',
    '2026-11-05',
    '2026-11-06',
  ]);
});

test('Phase 18.2: AttendanceService supports keyset cursor pagination without OFFSET', async () => {
  const { AttendanceService } = await import(
    '../../dist/apps/api/src/attendance/service.js'
  );

  const sqlCalls = [];
  const mockPool = {
    query: async (sql, params) => {
      sqlCalls.push({ sql, params });
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ cnt: 120 }] };
      }
      return { rows: [] };
    },
  };

  const svc = new AttendanceService(mockPool);
  const ownerCtx = {
    user: { id: '00000000-0000-4000-8000-000000000010', username: 'owner' },
    workspace: { id: '00000000-0000-4000-8000-000000000001', role: 'owner' },
  };

  await svc.listShifts(ownerCtx, {
    limit: 25,
    cursor: '2026-10-30T10:00:00.000Z|00000000-0000-4000-8000-000000000099',
  });

  const selectCall = sqlCalls.find((c) => c.sql.includes('FROM attendance_shifts s\n      JOIN employees e'));
  assert.ok(selectCall, 'Expected shift list SELECT query');
  assert.match(
    selectCall.sql,
    /\(s\.clock_in_at, s\.id\) < \(\$2, \$3::uuid\)/,
    'Expected keyset tuple comparison when cursor is provided',
  );
  assert.ok(
    !selectCall.sql.includes('OFFSET'),
    'Keyset cursor query must not emit OFFSET clause',
  );
});

test('Phase 18.3 & 18.4: Extracted web helpers and hot-query index/EXPLAIN scripts exist and work', async () => {
  const payrollHelpers = await import(
    '../../dist/apps/web/src/screens/helpers/payroll-helpers.js'
  );
  const workHelpers = await import(
    '../../dist/apps/web/src/screens/helpers/work-helpers.js'
  );
  const accountsHelpers = await import(
    '../../dist/apps/web/src/screens/helpers/accounts-helpers.js'
  );
  const storageHelpers = await import(
    '../../dist/apps/web/src/screens/helpers/storage-helpers.js'
  );
  const { HOT_QUERY_SPECS } = await import(
    '../../scripts/perf/explain-hot-queries.mjs'
  );

  assert.equal(payrollHelpers.resolveVietQrBankCode('Vietcombank'), 'VCB');
  assert.equal(payrollHelpers.formatMinutes(95), '1h 35p');
  assert.equal(workHelpers.getPriorityLabel('urgent'), 'Khẩn cấp');
  assert.equal(
    accountsHelpers.sanitizeUiError('Bearer secret-token-123'),
    'Bearer [REDACTED]',
  );
  assert.equal(storageHelpers.formatStorageBytes(1048576), '1.0 MB');

  const sqlFile = fs.readFileSync(
    path.join(repoRoot, 'scripts/perf/ensure-hot-indexes.sql'),
    'utf8',
  );
  assert.match(sqlFile, /idx_work_items_ws_v4_ref/);
  assert.match(sqlFile, /idx_attendance_shifts_ws_clock_in_id/);
  assert.equal(HOT_QUERY_SPECS.length, 5);
});
