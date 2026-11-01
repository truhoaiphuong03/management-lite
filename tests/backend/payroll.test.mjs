import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';
import { resolve } from 'node:path';
import {
  calculateDays,
  subtractBreaks,
  halfUp,
  monthBounds,
} from '../../dist/apps/api/src/payroll/calculation.js';

const rate = (v, start = '2026-01-01T00:00:00Z', end = null) => ({
  hourly_rate_vnd: v,
  effective_from: start,
  effective_to: end,
});
const interval = (a, b) => ({ start: Date.parse(a), end: Date.parse(b) });
test('PAY exact half-up uses rational arithmetic including large safe monetary values', () => {
  assert.equal(halfUp(1800n), 1);
  assert.equal(halfUp(1799n), 0);
  assert.equal(halfUp(3600n * 1000000000000n + 1800n), 1000000000001);
});
test('PAY preserves seconds through rate changes and rounds once per local day', () => {
  const days = calculateDays(
    [interval('2026-10-01T01:00:00Z', '2026-10-01T01:01:00Z')],
    [
      rate(30000, '2026-01-01T00:00:00Z', '2026-10-01T01:00:29Z'),
      rate(35000, '2026-10-01T01:00:29Z'),
    ],
    '2026-10',
  );
  assert.equal(days[0].worked_seconds, 60);
  assert.equal(days[0].rounded_wage_vnd, 543);
  const two = calculateDays(
    [
      interval('2026-10-01T01:00:00Z', '2026-10-01T01:00:01Z'),
      interval('2026-10-01T02:00:00Z', '2026-10-01T02:00:01Z'),
    ],
    [rate(1800)],
    '2026-10',
  );
  assert.equal(two[0].rounded_wage_vnd, 1);
});
test('PAY clips cross-midnight/month work and handles leap-year month bounds', () => {
  const i = [interval('2026-09-30T16:59:30Z', '2026-09-30T17:01:00Z')];
  assert.equal(
    calculateDays(i, [rate(3600)], '2026-09').at(-1).worked_seconds,
    30,
  );
  assert.equal(calculateDays(i, [rate(3600)], '2026-10')[0].worked_seconds, 60);
  assert.equal(monthBounds('2028-02').ends_on, '2028-02-29');
});
test('PAY subtracts union of unpaid breaks and rejects missing/overlapping rates', () => {
  const i = interval('2026-10-01T01:00:00Z', '2026-10-01T02:00:00Z');
  const bs = [
    { started_at: '2026-10-01T01:10:00Z', ended_at: '2026-10-01T01:20:00Z' },
    { started_at: '2026-10-01T01:15:00Z', ended_at: '2026-10-01T01:25:00Z' },
    { started_at: '2026-10-01T01:30:00Z', ended_at: null },
  ];
  const ds = calculateDays(
    subtractBreaks(i, bs, i.end),
    [rate(3600)],
    '2026-10',
  );
  assert.equal(ds[0].worked_seconds, 900);
  assert.throws(() => calculateDays([i], [], '2026-10'), /Missing/);
  assert.throws(
    () => calculateDays([i], [rate(1), rate(2)], '2026-10'),
    /overlapping/,
  );
});

test('PAY isolated PostgreSQL upgrade, API security, financial atomicity and immutability', async (t) => {
  if (
    !process.env.TEST_DATABASE_URL ||
    process.env.CONFIRM_ISOLATED_TEST_DB !== 'true'
  ) {
    t.skip('Explicit isolated PostgreSQL configuration required');
    return;
  }
  const { loadTestDatabaseConfig, assertSafeTestDatabase } =
    await import('../../dist/packages/database/src/config.js');
  const cfg = loadTestDatabaseConfig();
  assertSafeTestDatabase(cfg);
  const { createDatabasePool } =
    await import('../../dist/packages/database/src/pool.js');
  const pool = createDatabasePool(cfg);

  function shiftYearMonth(ym, deltaMonths) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  const defaultMonth = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  const configuredClockIso =
    process.env.PAYROLL_TEST_CLOCK_ISO || `${defaultMonth}-15T12:00:00.000Z`;
  let controlledClockMs = Date.parse(configuredClockIso);
  const testClock = {
    nowMs: () => controlledClockMs,
    iso: () => new Date(controlledClockMs).toISOString(),
    advanceMs: (ms) => {
      controlledClockMs += ms;
    },
  };

  const currMonth = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date(controlledClockMs));
  const prevMonth = shiftYearMonth(currMonth, -1);
  const olderMonth = shiftYearMonth(currMonth, -2);
  const nextMonth = shiftYearMonth(currMonth, 1);
  const rateStartIso = `${shiftYearMonth(currMonth, -9)}-01T00:00:00Z`;
  const currBounds = monthBounds(currMonth);
  const olderBounds = monthBounds(olderMonth);
  const currDay1Date = `${currMonth}-01`;
  const currPaymentDate = `${currMonth}-09`;
  const currMonthStartMs = Date.parse(`${currMonth}-01T00:00:00+07:00`);
  const crossStartIso = new Date(currMonthStartMs - 30_000).toISOString();
  const crossEndIso = new Date(currMonthStartMs + 60_000).toISOString();
  const currDay1ShiftStart = `${currMonth}-01T01:00:00Z`;
  const currDay1ShiftEnd = `${currMonth}-01T01:01:00Z`;
  const nextDay1ShiftStart = `${nextMonth}-01T01:00:00Z`;
  const nextDay1ShiftEnd = `${nextMonth}-01T02:00:00Z`;

  const wrapClientClock = (client) => {
    if (client && !client._payrollClockWrapped) {
      const origClientQuery = client.query.bind(client);
      client.query = (text, values, ...rest) => {
        if (
          typeof text === 'string' &&
          text === "SELECT date_trunc('second',clock_timestamp()) AS at"
        ) {
          return origClientQuery(
            "SELECT date_trunc('second', $1::timestamptz) AS at",
            [testClock.iso()],
            ...rest,
          );
        }
        return origClientQuery(text, values, ...rest);
      };
      client._payrollClockWrapped = true;
    }
    return client;
  };
  const origConnect = pool.connect.bind(pool);
  pool.connect = (...args) => {
    if (typeof args[0] === 'function') {
      const cb = args[0];
      return origConnect((err, client, done) => {
        if (!err && client) wrapClientClock(client);
        return cb(err, client, done);
      });
    }
    return origConnect(...args).then((client) => wrapClientClock(client));
  };
  const { runMigrations, loadMigrationFiles, calculateChecksum } =
    await import('../../dist/packages/database/src/migrator.js');
  const { EMBEDDED_MIGRATIONS } =
    await import('../../dist/packages/database/src/migrations/catalog.js');
  const { hashPassword } =
    await import('../../dist/packages/security/src/password.js');
  const { createRequestHandler } =
    await import('../../dist/apps/api/src/app.js');
  let server;
  try {
    const migrations = loadMigrationFiles(
      resolve('packages/database/src/migrations'),
    ).slice(0, 9); // Keep PAY upgrade test bounded to M07.
    await t.test(
      'M00-M06 upgrade to M07, file/embedded checksums, replay and mismatch fail-closed',
      async () => {
        assert.equal(migrations.length, 9);
        for (let i = 0; i < 9; i++)
          assert.equal(migrations[i].checksum, EMBEDDED_MIGRATIONS[i].checksum);
        await runMigrations(pool, migrations.slice(0, 8));
        const preApplied =
          (
            await pool.query(
              "SELECT 1 FROM schema_migrations WHERE id = '0009_m07_payroll'",
            )
          ).rowCount > 0;
        const upgrade = await runMigrations(pool, migrations);
        assert.ok(
          preApplied || upgrade.appliedIds.includes('0009_m07_payroll'),
        );
        assert.equal((await runMigrations(pool, migrations)).appliedCount, 0);
        const changed = migrations.map((m) => ({ ...m }));
        changed[8].sql += '\n-- invalid replay';
        changed[8].checksum = calculateChecksum(changed[8].sql);
        await assert.rejects(runMigrations(pool, changed), /checksum/i);
      },
    );
    // Preserve the bounded M07 upgrade assertions above, then exercise payroll
    // business behavior against the current schema, including ATT history guards.
    await runMigrations(
      pool,
      loadMigrationFiles(resolve('packages/database/src/migrations')),
    );
    const workspace = crypto.randomUUID(),
      other = crypto.randomUUID();
    await pool.query(
      "INSERT INTO workspaces(id,name) VALUES($1,'PAY QA'),($2,'PAY QA Other')",
      [workspace, other],
    );
    const origin = 'http://localhost:3000';
    server = http.createServer(
      createRequestHandler({
        pool,
        csrfSecret: crypto.randomBytes(32).toString('hex'),
        allowedOrigins: [origin],
        isProduction: false,
      }),
    );
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + server.address().port;
    async function request(path, actor, body, headers = {}) {
      const res = await fetch(base + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          ...(actor
            ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.csrf }
            : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: res.status,
        data: await res.json(),
        cookie: res.headers.get('set-cookie'),
      };
    }
    async function actor(role, ws = workspace) {
      const id = crypto.randomUUID(),
        emp = crypto.randomUUID(),
        name = 'payqa_' + id.replaceAll('-', ''),
        pw = crypto.randomBytes(24).toString('base64');
      await pool.query(
        "INSERT INTO users(id,username_normalized,email_normalized,status) VALUES($1,$2,$3,'active')",
        [id, name, name + '@qa.invalid'],
      );
      await pool.query(
        'INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)',
        [id, await hashPassword(pw)],
      );
      await pool.query(
        "INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES($1,$2,$3,'active')",
        [ws, id, role],
      );
      await pool.query(
        "INSERT INTO user_workspace_bindings(workspace_id,user_id,status) VALUES($1,$2,'active')",
        [ws, id],
      );
      await pool.query(
        "INSERT INTO employees(id,workspace_id,user_id,employee_code,full_name,employment_status,is_payroll_eligible) VALUES($1,$2,$3,$4,'QA','active',$5)",
        [emp, ws, id, name, role !== 'owner'],
      );
      const login = await request('/api/v1/auth/login', null, {
        identifier: name,
        password: pw,
      });
      assert.equal(login.status, 200);
      return {
        id,
        emp,
        ws,
        cookie: login.cookie.split(';')[0],
        csrf: login.data.data.csrf_token,
      };
    }
    const owner = await actor('owner'),
      staff = await actor('staff'),
      foreign = await actor('owner', other),
      second = await actor('staff');
    const prefix = '/api/v1/payroll';
    await t.test(
      'All read endpoints enforce authentication, Owner RBAC and self scope',
      async () => {
        assert.equal((await request(prefix + '/hourly-rates')).status, 401);
        assert.equal(
          (await request(prefix + '/hourly-rates', staff)).status,
          403,
        );
        assert.equal(
          (await request(`${prefix}/periods/${currMonth}`, staff)).status,
          403,
        );
        assert.equal((await request(prefix + '/periods', staff)).status, 200);
        assert.equal(
          (await request(`${prefix}/periods/${currMonth}/me`, staff)).status,
          200,
        );
        assert.equal(
          (
            await request(
              `${prefix}/periods/${currMonth}/paid-leaves`,
              owner,
              {},
            )
          ).status,
          404,
        );
      },
    );
    await t.test(
      'Virtual draft DTO uses null rate/id and GET never persists a period',
      async () => {
        const before = (
          await pool.query('SELECT count(*)::int AS n FROM payroll_periods')
        ).rows[0].n;
        const view = await request(`${prefix}/periods/${currMonth}`, owner);
        assert.equal(view.status, 200);
        const p = view.data.data.period;
        assert.equal(p.id, null);
        assert.equal(p.workspace_id, workspace);
        assert.equal(p.starts_on, currBounds.starts_on);
        assert.equal(p.ends_on, currBounds.ends_on);
        assert.equal(p.timezone, 'Asia/Ho_Chi_Minh');
        assert.equal(p.calculation_revision, 1);
        assert.equal(p.status, 'draft');
        assert.ok(
          view.data.data.items.every((i) => i.hourly_rate_vnd === null),
        );
        const me = await request(`${prefix}/periods/${currMonth}/me`, staff);
        assert.equal(me.data.data.hourly_rate_vnd, null);
        assert.equal(
          (await pool.query('SELECT count(*)::int AS n FROM payroll_periods'))
            .rows[0].n,
          before,
        );
        assert.equal((await request(prefix + '/rates', owner)).status, 404);
        assert.equal((await request(prefix + '/rates', owner, {})).status, 404);
      },
    );
    await t.test(
      'Rate uses server time, CSRF rejects, tenant lookup conceals and audit is atomic',
      async () => {
        const body = {
          employee_id: staff.emp,
          hourly_rate_vnd: 35000,
          effective_from: '2000-01-01T00:00:00Z',
        };
        assert.equal(
          (
            await request(prefix + '/hourly-rates', owner, body, {
              'X-CSRF-Token': '',
            })
          ).status,
          403,
        );
        assert.equal(
          (await request(prefix + '/hourly-rates', foreign, body)).status,
          404,
        );
        const before = testClock.nowMs() - 2000;
        const r = await request(prefix + '/hourly-rates', owner, body, {
          'Idempotency-Key': 'rate',
        });
        assert.equal(r.status, 201);
        assert.ok(Date.parse(r.data.data.effective_from) >= before);
        const replay = await request(prefix + '/hourly-rates', owner, body, {
          'Idempotency-Key': 'rate',
        });
        assert.deepEqual(replay.data.data, r.data.data);
        assert.equal(
          (
            await request(
              prefix + '/hourly-rates',
              owner,
              { ...body, hourly_rate_vnd: 1 },
              { 'Idempotency-Key': 'rate' },
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM audit_events WHERE workspace_id=$1 AND action='PAY_RATE_CONFIGURED'",
              [workspace],
            )
          ).rows[0].n,
          1,
        );
      },
    );
    // Historical fixtures are written only to this new isolated QA database.
    await pool.query(
      'INSERT INTO employee_hourly_rates(workspace_id,employee_id,hourly_rate_vnd,effective_from,effective_to,created_by) SELECT $1,$2,30000,$3,min(effective_from),$4 FROM employee_hourly_rates WHERE workspace_id=$1 AND employee_id=$2',
      [workspace, staff.emp, rateStartIso, owner.id],
    );
    await pool.query(
      'INSERT INTO employee_hourly_rates(workspace_id,employee_id,hourly_rate_vnd,effective_from,created_by) VALUES($1,$2,3600,$3,$4)',
      [workspace, second.emp, rateStartIso, owner.id],
    );
    async function shift(emp, start, end, review = 'approved', breaks = []) {
      const id = crypto.randomUUID(),
        vid = crypto.randomUUID();
      await pool.query(
        'INSERT INTO attendance_shifts(id,workspace_id,employee_id,clock_in_at,clock_out_at,run_state,review_state) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [id, workspace, emp, start, end, end ? 'completed' : 'paused', review],
      );
      if (end) {
        await pool.query(
          'INSERT INTO attendance_shift_versions(id,workspace_id,shift_id,version_number,clock_in_at,clock_out_at,breaks_snapshot,worked_seconds,snapshot_hash,created_by) VALUES($1,$2,$3,1,$4,$5,$6,0,$7,$8)',
          [
            vid,
            workspace,
            id,
            start,
            end,
            JSON.stringify(breaks),
            'qa-source',
            owner.id,
          ],
        );
        await pool.query(
          'UPDATE attendance_shifts SET current_version_id=$1 WHERE id=$2',
          [vid, id],
        );
        if (review === 'approved')
          await pool.query(
            "INSERT INTO attendance_approvals(workspace_id,shift_id,shift_version_id,reviewer_user_id,decision) VALUES($1,$2,$3,$4,'approved')",
            [workspace, id, vid, owner.id],
          );
      }
      return id;
    }
    await shift(staff.emp, crossStartIso, crossEndIso);
    await shift(second.emp, currDay1ShiftStart, currDay1ShiftEnd, 'unreviewed');
    const now = testClock.nowMs();
    const liveId = await shift(
      second.emp,
      new Date(now - 3600000).toISOString(),
      null,
      'unreviewed',
    );
    await pool.query(
      'INSERT INTO attendance_breaks(workspace_id,shift_id,started_at) VALUES($1,$2,$3)',
      [workspace, liveId, new Date(now - 1800000)],
    );
    await t.test(
      'Display rate follows server_as_of while historical wages retain historical rates',
      async () => {
        const view = await request(`${prefix}/periods/${currMonth}`, owner);
        assert.equal(view.status, 200);
        const item = view.data.data.items.find(
          (i) => i.employee_id === staff.emp,
        );
        assert.equal(item.hourly_rate_vnd, 35000);
        assert.equal(item.confirmed.base_pay_vnd, 500);
        assert.equal(item.daily_breakdowns[0].hourly_rate_vnd_snapshot, 30000);
        const me = await request(`${prefix}/periods/${currMonth}/me`, staff);
        assert.equal(me.data.data.hourly_rate_vnd, 35000);
      },
    );
    await t.test(
      'Confirmed/pending/live separate; previews never mutate ATT; cross-month clips work',
      async () => {
        const before = (
          await pool.query(
            'SELECT row_to_json(s) AS s FROM attendance_shifts s WHERE id=$1',
            [liveId],
          )
        ).rows[0].s;
        const r = await request(`${prefix}/periods/${currMonth}`, owner);
        assert.equal(r.status, 200);
        const a = r.data.data.items.find((i) => i.employee_id === staff.emp),
          b = r.data.data.items.find((i) => i.employee_id === second.emp);
        assert.equal(a.confirmed.approved_worked_seconds, 60);
        assert.equal(a.confirmed.base_pay_vnd, 500);
        assert.equal(b.confirmed.base_pay_vnd, 0);
        assert.equal(b.pending_review.pending_seconds, 60);
        assert.equal(b.pending_review.estimated_pay_vnd, 60);
        assert.ok(
          b.live_provisional.live_seconds >= 1799 &&
            b.live_provisional.live_seconds <= 1801,
        );
        assert.equal(
          b.live_provisional.live_pay_vnd,
          b.live_provisional.live_seconds,
        );
        assert.deepEqual(
          (
            await pool.query(
              'SELECT row_to_json(s) AS s FROM attendance_shifts s WHERE id=$1',
              [liveId],
            )
          ).rows[0].s,
          before,
        );
        const sep = await request(`${prefix}/periods/${prevMonth}/me`, staff);
        assert.equal(sep.data.data.confirmed.approved_worked_seconds, 30);
      },
    );
    await t.test(
      'Only paid_leave with date, amount, reason; unsupported kinds rejected',
      async () => {
        const body = {
          employee_id: staff.emp,
          adjustment_type: 'paid_leave',
          attributable_date: currDay1Date,
          amount_vnd: 500,
          reason: 'QA paid leave',
        };
        for (const invalid of [
          { ...body, adjustment_type: 'bonus' },
          { ...body, reason: '' },
          { ...body, attributable_date: '2026-02-30' },
          { ...body, amount_vnd: 0 },
        ])
          assert.equal(
            (
              await request(
                `${prefix}/periods/${currMonth}/adjustments`,
                owner,
                invalid,
              )
            ).status,
            400,
          );
        assert.equal(
          (
            await request(
              `${prefix}/periods/${currMonth}/adjustments`,
              owner,
              body,
              { 'Idempotency-Key': 'leave' },
            )
          ).status,
          201,
        );
        assert.equal(
          (
            await request(
              `${prefix}/periods/${currMonth}/adjustments`,
              owner,
              body,
              { 'Idempotency-Key': 'leave' },
            )
          ).status,
          201,
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM payroll_adjustments WHERE workspace_id=$1',
              [workspace],
            )
          ).rows[0].n,
          1,
        );
      },
    );
    let finalized;
    await t.test(
      'Finalize requires exact If-Match/idempotency; rollback, replay and mismatch safe',
      async () => {
        const path = `${prefix}/periods/${currMonth}/finalize`;
        assert.equal((await request(path, owner, {})).status, 428);
        assert.equal(
          (await request(path, owner, {}, { 'If-Match': '"2"' })).status,
          428,
        );
        assert.equal(
          (
            await request(
              path,
              owner,
              {},
              { 'If-Match': '"99"', 'Idempotency-Key': 'stale' },
            )
          ).status,
          412,
        );
        const r = await request(
          path,
          owner,
          {},
          { 'If-Match': '"2"', 'Idempotency-Key': 'finalize' },
        );
        assert.equal(r.status, 200);
        finalized = r.data.data;
        assert.equal(finalized.status, 'finalized');
        assert.equal(finalized.pending_review_shift_count, 1);
        const replay = await request(
          path,
          owner,
          {},
          { 'If-Match': '"2"', 'Idempotency-Key': 'finalize' },
        );
        assert.deepEqual(replay.data.data, r.data.data);
        assert.equal(
          (
            await request(
              path,
              owner,
              {},
              { 'If-Match': '"3"', 'Idempotency-Key': 'finalize' },
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM payroll_employee_items WHERE workspace_id=$1',
              [workspace],
            )
          ).rows[0].n,
          2,
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM payroll_employee_items WHERE employee_id=$1',
              [owner.emp],
            )
          ).rows[0].n,
          0,
        );
      },
    );
    const item = (
      await pool.query(
        'SELECT * FROM payroll_employee_items WHERE workspace_id=$1 AND employee_id=$2',
        [workspace, staff.emp],
      )
    ).rows[0];
    await t.test(
      'Finalized wages and breakdowns stay frozen when display rate changes',
      async () => {
        const path = `${prefix}/periods/${currMonth}`;
        const before = (await request(path, owner)).data.data;
        assert.equal(before.period.id, finalized.id);
        assert.equal(before.period.status, 'finalized');
        const snapshot = before.items.find((i) => i.employee_id === staff.emp);
        testClock.advanceMs(2000);
        const changed = await request(
          prefix + '/hourly-rates',
          owner,
          { employee_id: staff.emp, hourly_rate_vnd: 40000 },
          { 'Idempotency-Key': 'post-finalize-rate' },
        );
        assert.equal(changed.status, 201);
        const after = (await request(path, owner)).data.data;
        const updated = after.items.find((i) => i.employee_id === staff.emp);
        assert.equal(updated.hourly_rate_vnd, 40000);
        assert.deepEqual(updated.confirmed, snapshot.confirmed);
        assert.deepEqual(updated.daily_breakdowns, snapshot.daily_breakdowns);
        assert.equal(
          after.period.finalized_snapshot_hash,
          before.period.finalized_snapshot_hash,
        );
        assert.equal(after.period.version, before.period.version);
      },
    );
    await t.test(
      'Immutable period/item/day/paid leave prohibit UPDATE/DELETE/INSERT and reparenting',
      async () => {
        for (const sql of [
          'UPDATE payroll_periods SET version=version+1 WHERE id=$1',
          'DELETE FROM payroll_periods WHERE id=$1',
        ])
          await assert.rejects(pool.query(sql, [finalized.id]), /immutable/);
        for (const table of [
          'payroll_employee_items',
          'payroll_daily_breakdowns',
          'payroll_adjustments',
        ]) {
          const field =
            table === 'payroll_employee_items' ? 'id' : 'payroll_item_id';
          await assert.rejects(
            pool.query(`DELETE FROM ${table} WHERE ${field}=$1`, [item.id]),
            /immutable/,
          );
          const value =
            table === 'payroll_employee_items'
              ? 'net_pay_vnd'
              : table === 'payroll_daily_breakdowns'
                ? 'rounded_wage_vnd'
                : 'amount_vnd';
          await assert.rejects(
            pool.query(
              `UPDATE ${table} SET ${value}=${value}+1 WHERE ${field}=$1`,
              [item.id],
            ),
            /immutable/,
          );
        }
        await assert.rejects(
          pool.query(
            "INSERT INTO payroll_adjustments(workspace_id,payroll_item_id,adjustment_type,attributable_date,amount_vnd,reason,created_by) VALUES($1,$2,'paid_leave',$3,1,'QA',$4)",
            [workspace, item.id, currDay1Date, owner.id],
          ),
          /immutable/,
        );
        await assert.rejects(
          pool.query(
            'UPDATE payroll_employee_items SET workspace_id=$1 WHERE id=$2',
            [other, item.id],
          ),
          /immutable/,
        );
      },
    );
    await t.test(
      'Concurrent payments, duplicate replay, mismatch and overpayment; ledger-derived balance',
      async () => {
        const before = (
          await pool.query(
            'SELECT row_to_json(i) AS i FROM payroll_employee_items i WHERE id=$1',
            [item.id],
          )
        ).rows[0].i;
        const path = prefix + '/items/' + item.id + '/disbursements';
        const body = {
          amount_vnd: 600,
          payment_date: currPaymentDate,
          payment_method: 'cash',
        };
        assert.equal(
          (await request(path, foreign, body, { 'Idempotency-Key': 'foreign' }))
            .status,
          404,
        );
        const results = await Promise.all(
          ['a', 'b'].map((k) =>
            request(path, owner, body, { 'Idempotency-Key': k }),
          ),
        );
        assert.deepEqual(results.map((r) => r.status).sort(), [201, 422]);
        const k = results[0].status === 201 ? 'a' : 'b';
        assert.equal(
          (await request(path, owner, body, { 'Idempotency-Key': k })).status,
          201,
        );
        assert.equal(
          (
            await request(
              path,
              owner,
              { ...body, amount_vnd: 1 },
              { 'Idempotency-Key': k },
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await request(
              path,
              owner,
              { ...body, amount_vnd: 400 },
              { 'Idempotency-Key': 'rest' },
            )
          ).status,
          201,
        );
        assert.equal(
          (
            await request(
              path,
              owner,
              { ...body, amount_vnd: 1 },
              { 'Idempotency-Key': 'excess' },
            )
          ).status,
          422,
        );
        const me = await request(`${prefix}/periods/${currMonth}/me`, staff);
        assert.equal(me.data.data.confirmed.paid_amount_vnd, 1000);
        assert.equal(me.data.data.confirmed.remaining_balance_vnd, 0);
        assert.equal(me.data.data.confirmed.payment_status, 'paid');
        assert.deepEqual(
          (
            await pool.query(
              'SELECT row_to_json(i) AS i FROM payroll_employee_items i WHERE id=$1',
              [item.id],
            )
          ).rows[0].i,
          before,
        );
        await assert.rejects(
          pool.query(
            'UPDATE payroll_disbursements SET amount_vnd=1 WHERE payroll_item_id=$1',
            [item.id],
          ),
          /append-only/,
        );
        await assert.rejects(
          pool.query(
            'DELETE FROM payroll_disbursements WHERE payroll_item_id=$1',
            [item.id],
          ),
          /append-only/,
        );
        await assert.rejects(
          pool.query(
            'INSERT INTO payroll_disbursements(workspace_id,payroll_item_id,disbursement_order,amount_vnd,payment_date,paid_by) VALUES($1,$2,99,1,$3,$4)',
            [workspace, item.id, currPaymentDate, owner.id],
          ),
          /OVERPAYMENT/,
        );
      },
    );
    await t.test(
      'Frozen payroll survives subsequent employee eligibility changes',
      async () => {
        const before = await request(
          `${prefix}/periods/${currMonth}/me`,
          staff,
        );
        await pool.query(
          'UPDATE employees SET is_payroll_eligible=false WHERE id=$1',
          [staff.emp],
        );
        const after = await request(`${prefix}/periods/${currMonth}/me`, staff);
        assert.equal(after.status, 200);
        assert.deepEqual(after.data.data.confirmed, before.data.data.confirmed);
        assert.equal(after.data.data.daily_breakdowns[0].shift_count, 1);
        assert.equal(
          after.data.data.daily_breakdowns[0].work_date,
          currDay1Date,
        );
        assert.equal(
          after.data.data.adjustments[0].attributable_date,
          currDay1Date,
        );
      },
    );
    await t.test(
      'Composite tenant FK and rate overlap fail closed',
      async () => {
        await assert.rejects(
          pool.query(
            'INSERT INTO employee_hourly_rates(workspace_id,employee_id,hourly_rate_vnd,effective_from,created_by) VALUES($1,$2,1,$3,$4)',
            [other, staff.emp, rateStartIso.slice(0, 10), foreign.id],
          ),
          /foreign key/,
        );
        await assert.rejects(
          pool.query(
            'INSERT INTO employee_hourly_rates(workspace_id,employee_id,hourly_rate_vnd,effective_from,created_by) VALUES($1,$2,1,$3,$4)',
            [workspace, second.emp, rateStartIso.slice(0, 10), owner.id],
          ),
          /Overlapping/,
        );
        await assert.rejects(
          pool.query(
            'INSERT INTO payroll_daily_breakdowns(workspace_id,payroll_item_id,work_date,hourly_rate_vnd_snapshot,raw_wage_vnd,rounded_wage_vnd) VALUES($1,$2,$3,1,1,1)',
            [other, item.id, currDay1Date],
          ),
          /foreign key/,
        );
      },
    );
    await t.test(
      'Negative net and invalid finalized metadata are rejected by DB constraints',
      async () => {
        const pid = crypto.randomUUID();
        const eid = crypto.randomUUID();
        await pool.query(
          "INSERT INTO employees(id,workspace_id,employee_code,full_name,employment_status) VALUES($1,$2,$3,'QA','active')",
          [eid, other, 'pay_negative_' + eid],
        );
        await pool.query(
          'INSERT INTO payroll_periods(id,workspace_id,period_month,starts_on,ends_on) VALUES($1,$2,$3,$4,$5)',
          [pid, other, olderMonth, olderBounds.starts_on, olderBounds.ends_on],
        );
        await assert.rejects(
          pool.query(
            'INSERT INTO payroll_employee_items(workspace_id,period_id,employee_id,net_pay_vnd) VALUES($1,$2,$3,-1)',
            [other, pid, eid],
          ),
          /check constraint/,
        );
        await assert.rejects(
          pool.query(
            "UPDATE payroll_periods SET status='finalized' WHERE id=$1",
            [pid],
          ),
          /check constraint/,
        );
      },
    );
    await t.test(
      'Concurrent finalize succeeds once and retry reconciles durable completion',
      async () => {
        const path = `${prefix}/periods/${prevMonth}/finalize`;
        const headers = {
          'If-Match': '"1"',
          'Idempotency-Key': 'concurrent-final',
        };
        const results = await Promise.all([
          request(path, owner, {}, headers),
          request(path, owner, {}, headers),
        ]);
        assert.ok(results.some((r) => r.status === 200));
        assert.ok(results.every((r) => [200, 409].includes(r.status)));
        assert.equal((await request(path, owner, {}, headers)).status, 200);
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM audit_events WHERE workspace_id=$1 AND action=$2',
              [workspace, `PAY_FINALIZE:${prevMonth}`],
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      'Fresh missing-rate approved work prevents entire finalize and leaves no period',
      async () => {
        const missing = await actor('staff');
        await shift(missing.emp, nextDay1ShiftStart, nextDay1ShiftEnd);
        const r = await request(
          `${prefix}/periods/${nextMonth}/finalize`,
          owner,
          {},
          { 'If-Match': '"1"', 'Idempotency-Key': 'missing' },
        );
        assert.equal(r.status, 422);
        assert.equal(r.data.error.code, 'MISSING_HOURLY_RATE');
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM payroll_periods WHERE workspace_id=$1 AND period_month=$2',
              [workspace, nextMonth],
            )
          ).rows[0].n,
          0,
        );
      },
    );
    await t.test(
      'PAY-004 current Owner cannot read personal payslip, including frozen former-Staff history',
      async () => {
        assert.equal(
          (await request(`${prefix}/periods/${currMonth}/me`, owner)).status,
          403,
        );
        const { AuthService } =
          await import('../../dist/apps/api/src/auth/service.js');
        const { PayrollService } =
          await import('../../dist/apps/api/src/payroll/service.js');
        const authService = new AuthService(
          pool,
          crypto.randomBytes(32).toString('hex'),
        );
        const staleContext = await authService.resolveSession(
          staff.cookie.slice(staff.cookie.indexOf('=') + 1),
        );
        assert.equal(staleContext.workspace.role, 'staff');
        await pool.query(
          "UPDATE workspace_memberships SET role='owner' WHERE workspace_id=$1 AND user_id=$2",
          [workspace, staff.id],
        );
        try {
          assert.equal(
            (await request(`${prefix}/periods/${currMonth}/me`, staff)).status,
            403,
          );
          await assert.rejects(
            new PayrollService(pool).me(staleContext, currMonth),
            (error) =>
              error.statusCode === 401 && error.code === 'UNAUTHENTICATED',
          );
        } finally {
          await pool.query(
            "UPDATE workspace_memberships SET role='staff' WHERE workspace_id=$1 AND user_id=$2",
            [workspace, staff.id],
          );
        }
      },
    );

    await t.test(
      'Staff writes forbidden and stale session context fails transaction authorization',
      async () => {
        const body = { employee_id: second.emp, hourly_rate_vnd: 100 };
        assert.equal(
          (await request(prefix + '/hourly-rates', staff, body)).status,
          403,
        );
        const { AuthService } =
          await import('../../dist/apps/api/src/auth/service.js');
        const { PayrollService } =
          await import('../../dist/apps/api/src/payroll/service.js');
        const authService = new AuthService(
          pool,
          crypto.randomBytes(32).toString('hex'),
        );
        const context = await authService.resolveSession(
          owner.cookie.slice(owner.cookie.indexOf('=') + 1),
        );
        assert.ok(context);
        await pool.query(
          "UPDATE workspace_memberships SET role='staff' WHERE workspace_id=$1 AND user_id=$2",
          [workspace, owner.id],
        );
        await assert.rejects(
          new PayrollService(pool).periods(context),
          (e) => e.statusCode === 401,
        );
        await pool.query(
          "UPDATE workspace_memberships SET role='owner' WHERE workspace_id=$1 AND user_id=$2",
          [workspace, owner.id],
        );
        const before = (
          await pool.query(
            'SELECT count(*)::int AS n FROM employee_hourly_rates WHERE workspace_id=$1',
            [workspace],
          )
        ).rows[0].n;
        await pool.query(
          'UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE id=$1',
          [context.sessionId],
        );
        await assert.rejects(
          new PayrollService(pool).setRate(
            context,
            body,
            'revoked',
            crypto.randomUUID(),
          ),
          (e) => e.statusCode === 401,
        );
        assert.equal(
          (
            await pool.query(
              'SELECT count(*)::int AS n FROM employee_hourly_rates WHERE workspace_id=$1',
              [workspace],
            )
          ).rows[0].n,
          before,
        );
      },
    );
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await pool.end();
  }
});
