import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';
import { resolve } from 'node:path';

/**
 * Real-PostgreSQL integration test (runs in GitHub CI via ci-isolated-tests.mjs).
 * Covers: timesheet import/export, payroll statistics, report links and the
 * Owner system-log console, through the real HTTP handler.
 */
test('TIMESHEET + STATS + SYSTEM LOG against migrated PostgreSQL (HTTP, RBAC, idempotency)', async (t) => {
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
  const { runMigrations, loadMigrationFiles } =
    await import('../../dist/packages/database/src/migrator.js');
  const { hashPassword } =
    await import('../../dist/packages/security/src/password.js');
  const { createRequestHandler } =
    await import('../../dist/apps/api/src/app.js');
  const { buildTimesheetXlsx, parseTimesheetXlsx } =
    await import('../../dist/apps/api/src/payroll/timesheet.js');

  const pool = createDatabasePool(cfg);
  let server;
  t.after(async () => {
    if (server) await new Promise((r) => server.close(r));
    await pool.end();
  });
  await runMigrations(
    pool,
    loadMigrationFiles(resolve('packages/database/src/migrations')),
  );

  const workspace = crypto.randomUUID();
  const other = crypto.randomUUID();
  await pool.query(
    "INSERT INTO workspaces(id,name) VALUES($1,'TS QA'),($2,'TS QA Other')",
    [workspace, other],
  );
  // Old log row: must be purged by the first flush (30-day retention).
  await pool.query(
    "INSERT INTO system_logs(occurred_at,level,source,workspace_id,message,fingerprint) VALUES(now() - interval '40 days','error','api',$1,'ancient row','old')",
    [workspace],
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

  async function request(path, actor, body) {
    const res = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(actor ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.csrf } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const type = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      type,
      buffer: type.includes('json')
        ? null
        : Buffer.from(await res.arrayBuffer()),
      data: type.includes('json') ? await res.json() : null,
      cookie: res.headers.get('set-cookie'),
    };
  }
  async function actor(role, ws = workspace) {
    const id = crypto.randomUUID();
    const emp = crypto.randomUUID();
    const name = 'tsqa_' + id.replaceAll('-', '');
    const pw = crypto.randomBytes(24).toString('base64');
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
      cookie: login.cookie.split(';')[0],
      csrf: login.data.data.csrf_token,
    };
  }
  const owner = await actor('owner');
  const staff = await actor('staff');
  const foreign = await actor('owner', other);

  const year = new Date().getUTCFullYear() - 1; // always in the past
  const day = (d, s, e, task = '') => ({
    day: d,
    start_min: s,
    end_min: e,
    task,
    bonus: 0,
  });
  const workbook = buildTimesheetXlsx({
    employee_name: 'Nguyễn Test Import',
    year,
    months: [
      {
        month: 6,
        rate: 20000,
        days: [day(1, 540, 720, '8 clip LSK: linco'), day(2, 540, 780)],
      },
      {
        month: 7,
        rate: 25000,
        days: [
          day(3, 675, 900, 'taphoa: 24 clip. baphat: 10 clip'),
          day(9, 795, 915),
          day(20, 1320, 120), // overnight 22:00 -> 02:00
        ],
      },
    ],
  });
  const file_base64 = workbook.toString('base64');
  const importUrl = '/api/v1/payroll-tools/timesheet/import';
  const counts = async () => ({
    employees: (
      await pool.query(
        'SELECT count(*)::int n FROM employees WHERE workspace_id=$1',
        [workspace],
      )
    ).rows[0].n,
    shifts: (
      await pool.query(
        'SELECT count(*)::int n FROM attendance_shifts WHERE workspace_id=$1',
        [workspace],
      )
    ).rows[0].n,
    rates: (
      await pool.query(
        'SELECT count(*)::int n FROM employee_hourly_rates WHERE workspace_id=$1',
        [workspace],
      )
    ).rows[0].n,
    reports: (
      await pool.query(
        'SELECT count(*)::int n FROM daily_reports WHERE workspace_id=$1',
        [workspace],
      )
    ).rows[0].n,
  });

  let employeeId;
  await t.test(
    'RBAC: only the Owner can import, export or read statistics',
    async () => {
      assert.equal(
        (await request(importUrl, null, { file_base64 })).status,
        401,
      );
      assert.equal(
        (await request(importUrl, staff, { file_base64, year })).status,
        403,
      );
      assert.equal(
        (await request('/api/v1/payroll-tools/stats', staff)).status,
        403,
      );
      assert.equal(
        (
          await request(
            '/api/v1/payroll-tools/timesheet/export?employee_id=' +
              staff.emp +
              '&year=' +
              year,
            staff,
          )
        ).status,
        403,
      );
    },
  );

  await t.test('Preview writes nothing; commit imports once', async () => {
    const before = await counts();
    const preview = await request(importUrl, owner, {
      file_base64,
      year,
      new_employee_name: 'Nguyễn Test Import',
      commit: false,
    });
    assert.equal(preview.status, 200, JSON.stringify(preview.data));
    assert.equal(preview.data.data.committed, false);
    assert.equal(preview.data.data.totals.shifts_new, 5);
    assert.equal(preview.data.data.totals.hours, 16.75);
    assert.equal(preview.data.data.totals.expected_wage_vnd, 383750);
    assert.deepEqual(await counts(), before);

    const done = await request(importUrl, owner, {
      file_base64,
      year,
      new_employee_name: 'Nguyễn Test Import',
      commit: true,
    });
    assert.equal(done.status, 201, JSON.stringify(done.data));
    const d = done.data.data;
    assert.equal(d.committed, true);
    assert.equal(d.employee.created, true);
    assert.match(d.employee.code, /^NV\d+$/);
    assert.equal(d.totals.shifts_new, 5);
    assert.equal(d.totals.rates_created, 2);
    assert.equal(d.totals.reports_created, 2);
    employeeId = d.employee.id;
    const after = await counts();
    assert.equal(after.shifts, before.shifts + 5);
    assert.equal(after.rates, before.rates + 2);
    assert.equal(after.reports, before.reports + 2);
    const row = (
      await pool.query(
        'SELECT run_state, review_state, source, current_version_id IS NOT NULL AS has_version FROM attendance_shifts WHERE workspace_id=$1 AND employee_id=$2 LIMIT 1',
        [workspace, employeeId],
      )
    ).rows[0];
    assert.deepEqual(row, {
      run_state: 'completed',
      review_state: 'approved',
      source: 'import',
      has_version: true,
    });
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int n FROM audit_events WHERE workspace_id=$1 AND action='payroll.timesheet_import'",
          [workspace],
        )
      ).rows[0].n,
      1,
    );
    const nextCodeRes = await request('/api/v1/employees/next-code', owner);
    assert.equal(nextCodeRes.status, 200);
    assert.equal(nextCodeRes.data.data.next_employee_code, 'NV002');
  });

  await t.test('Re-import is idempotent and never overwrites', async () => {
    const before = await counts();
    const again = await request(importUrl, owner, {
      file_base64,
      year,
      employee_id: employeeId,
      commit: true,
    });
    assert.equal(again.status, 201);
    assert.equal(again.data.data.totals.shifts_new, 0);
    assert.equal(again.data.data.totals.shifts_skipped, 5);
    assert.deepEqual(await counts(), before);
  });

  await t.test(
    'Tenant isolation: another workspace cannot import into this employee',
    async () => {
      const res = await request(importUrl, foreign, {
        file_base64,
        year,
        employee_id: employeeId,
        commit: true,
      });
      assert.equal(res.status, 404);
    },
  );

  await t.test(
    'Imported shifts flow into the monthly payroll with the historical rates',
    async () => {
      const june = await request(`/api/v1/payroll/periods/${year}-06`, owner);
      assert.equal(june.status, 200);
      const item = june.data.data.items.find(
        (i) => i.employee_id === employeeId,
      );
      assert.ok(item, 'imported employee is payroll-eligible');
      assert.equal(item.confirmed.base_pay_vnd, 140000); // 3h + 4h at 20.000
      const july = await request(`/api/v1/payroll/periods/${year}-07`, owner);
      const j = july.data.data.items.find((i) => i.employee_id === employeeId);
      assert.equal(j.confirmed.base_pay_vnd, 243750); // 3.75h + 2h + 4h at 25.000
    },
  );

  await t.test(
    'Statistics by day, week, month and year agree with each other',
    async () => {
      const q = (g) =>
        `/api/v1/payroll-tools/stats?granularity=${g}&from=${year}-01-01&to=${year}-12-31&employee_id=${employeeId}`;
      const month = (await request(q('month'), owner)).data.data;
      assert.deepEqual(
        month.buckets.map((b) => [b.key, b.wage_vnd]),
        [
          [`${year}-06`, 140000],
          [`${year}-07`, 243750],
        ],
      );
      assert.equal(month.totals.wage_vnd, 383750);
      assert.equal(month.totals.worked_hours, 16.75);
      assert.equal(month.totals.work_days, 6);
      assert.equal(month.totals.report_days, 2);
      assert.equal(month.totals.missing_report_days, 4);
      assert.equal(month.totals.reported_clips, 42);
      for (const g of ['day', 'week', 'year']) {
        const r = (await request(q(g), owner)).data.data;
        assert.equal(
          r.buckets.reduce((s, b) => s + b.wage_vnd, 0),
          383750,
          g,
        );
      }
      const days = (await request(q('day'), owner)).data.data.buckets;
      // overnight shift is split across two local calendar days
      assert.ok(days.find((b) => b.key === `${year}-07-20`));
      assert.ok(days.find((b) => b.key === `${year}-07-21`));
      // each worked day links to the daily report of the same employee and date
      const jun1 = days.find((b) => b.key === `${year}-06-01`).days[0];
      assert.equal(jun1.report.total_reported_count, 8);
      assert.equal(jun1.report.status, 'submitted');
      const jul9 = days.find((b) => b.key === `${year}-07-09`).days[0];
      assert.equal(jul9.report, null);
      assert.equal(month.buckets[1].report_days, 1);
      assert.equal(month.buckets[1].missing_report_days, 3);
      assert.equal(month.buckets[1].reported_clips, 34);
      assert.equal(
        (await request('/api/v1/payroll-tools/stats?granularity=bad', owner))
          .status,
        400,
      );
    },
  );

  await t.test(
    'Export fills the same layout and can be read back',
    async () => {
      const res = await request(
        `/api/v1/payroll-tools/timesheet/export?employee_id=${employeeId}&year=${year}`,
        owner,
      );
      assert.equal(res.status, 200);
      assert.match(res.type, /spreadsheetml/);
      const parsed = parseTimesheetXlsx(res.buffer);
      assert.equal(parsed.employee_name, 'Nguyễn Test Import');
      assert.deepEqual(
        parsed.months.map((m) => [m.month, m.rate, m.days.length]),
        [
          [6, 20000, 2],
          [7, 25000, 3],
        ],
      );
      const d1 = parsed.months[0].days.find((d) => d.day === 1);
      assert.equal(d1.task, '8 clip LSK: linco');
      assert.equal(d1.sheet_hours, 3);
      const d20 = parsed.months[1].days.find((d) => d.day === 20);
      assert.deepEqual(
        [d20.start_min, d20.end_min, d20.sheet_hours],
        [1320, 120, 4],
      );
      // empty months are not exported
      assert.equal(
        parsed.months.some((m) => m.month === 8),
        false,
      );
      // exported workbook imports back without creating anything new
      const before = await counts();
      const back = await request(importUrl, owner, {
        file_base64: res.buffer.toString('base64'),
        year,
        employee_id: employeeId,
        commit: true,
      });
      assert.equal(back.data.data.totals.shifts_new, 0);
      assert.deepEqual(await counts(), before);
    },
  );

  await t.test(
    'Validation: bad files and years are rejected without side effects',
    async () => {
      const before = await counts();
      const bad = await request(importUrl, owner, {
        file_base64: Buffer.from('not an xlsx').toString('base64'),
        year,
        new_employee_name: 'X',
        commit: true,
      });
      assert.equal(bad.status, 422);
      assert.equal(
        (
          await request(importUrl, owner, {
            file_base64,
            year: 1800,
            new_employee_name: 'X',
            commit: true,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request(importUrl, owner, {
            file_base64,
            year,
            commit: true,
            hacker: 1,
          })
        ).status,
        400,
      );
      // PAY-025: the Owner is not payroll eligible
      assert.equal(
        (
          await request(importUrl, owner, {
            file_base64,
            year,
            employee_id: owner.emp,
            commit: true,
          })
        ).status,
        403,
      );
      assert.deepEqual(await counts(), before);
    },
  );

  await t.test(
    'Real 2026 timesheet (Nguyễn Huỳnh Thế Vinh, 53 shifts / 167.28h) dry-run and commit match sheet within 2 VND daily rounding',
    async () => {
      const vinhRaw = [
        [
          6,
          20000,
          [
            [1, 540, 720, ''],
            [2, 540, 780, ''],
            [3, 570, 810, ''],
            [4, 570, 690, 'Edit 8 clip kênh LSK'],
            [
              8,
              570,
              930,
              'Edit 8 clip LSK: 4 Tonic, 2 men rắc, 2 tiêu phân-khử mùi; 4 clip LSKMM: 2 men rắc thảo dược, 2 men rắc tiêu phân - khử mùi',
            ],
            [
              9,
              570,
              810,
              '6 clip LSK: 2 Linco, 2 bổ gan thận, 2 Canxi B12. Phụ live TikTok',
            ],
            [10, 630, 900, '8 clip LSK: 4 Flodoxy, 4 Fensit. Live kênh LSKMM'],
            [15, 630, 840, '4 Clip LSK: 2 Flodoxy, 2 Fensit. Phụ Live Tiktok'],
            [
              17,
              540,
              900,
              '10 clip LSK: giải độc gan, Tonic, Flodoxy, Linco, Fensit',
            ],
            [18, 810, 1020, '2 clip thực tế Linco, 1 clip thực tế Flodoxy'],
            [19, 630, 900, '6 clip thực tế: 3 Flodoxy,  3 Fensit'],
            [
              22,
              630,
              810,
              '8 clip LSKMM: Flodoxy, Fensit, Linco, Flucasol. LIVE',
            ],
            [
              23,
              630,
              900,
              '6 clip LSK: linco, 4 fensit, flucasol. LIVE. 4 clip thực tế: 2 fensit, 2 flodoxy',
            ],
            [24, 640, 920, '5 clip thực tế: 2 flodoxy, 2 tonic, 1 canxi B12'],
          ],
        ],
        [
          7,
          25000,
          [
            [
              3,
              675,
              900,
              '8 clip thực tế cho: flodoxy, linco, men rắc tiêu phân, fensit',
            ],
            [
              7,
              680,
              910,
              '7 clip LSK: 2Tonic, 3 linco, 2men rắc tiêu phân-khử mùi | 7 clip LSKMM',
            ],
            [9, 795, 915, '8 clip LSK: linco, tonic, canxiB12, giải độc gan'],
            [
              14,
              585,
              885,
              'LSK: 10 clip: 2 canxi B12, 2 Gan, 2 Tonic, 4 Men sống| Thực tế: 3 men sống, 3 fensit',
            ],
            [20, 635, 840, '9 clip thực tế: Fensit, Linco, Men sống'],
            [
              21,
              635,
              840,
              '17 clip kênh LSK: flucasol, flodoxy, men sống, men nửa ký, kích lông, canxi, fensit',
            ],
            [
              22,
              705,
              870,
              '17 clip kênh LSKMM: flucasol, flodoxy, men sống, men nửa ký, kích lông, canxi, fensit',
            ],
            [
              23,
              715,
              950,
              '8 clip LSK: men sống, flucasol, fensit, linco. 2 clip thực tế linco, men thảo dược.',
            ],
            [
              29,
              820,
              1000,
              'LSKMM:5 clip Nuôi gà theo mệnh. | Kenh2:15 clip MMG. | COCO: 15 clip MMG.',
            ],
            [
              30,
              800,
              995,
              '3 clip thực tế: linco, 3 clip thực tế men sống, 1 clip thực tế fensit.',
            ],
          ],
        ],
        [
          8,
          25000,
          [
            [
              4,
              635,
              840,
              '17 clip LSK: fensit, linco, canxi, men sống, men rắc, flodoxy, flucasol',
            ],
            [
              5,
              860,
              1020,
              'LSKMM: 15 clip màu mệnh, 5 clip mệnh gà. COCO: 15 clip màu mệnh',
            ],
            [6, 840, 1000, '8 clip thực tế: men sống, linco, fensit.'],
            [
              13,
              805,
              940,
              'LSKMM: 16 clip MMG, COCO: 16 clip MMG. Chèn nhạc vào clip LSK 0408 30 phút( tại nhà)',
            ],
            [14, 840, 970, 'LSKMM: 15 clip MMG, COCO: 15 clip MM'],
            [16, 860, 960, 'LSKMM: 15 clip MMG, COCO: 15 clip MM'],
            [
              18,
              700,
              975,
              'LSK: 2 men song, 2 linco, 2flucasol, 2 canxi. 2 fensit, 1 gđ gan, 1 tonic, 1 flodoxy, 1 men rắc',
            ],
            [
              19,
              770,
              960,
              'LSK: 2flodoxy, 2 GDGan, 2Tonic, 2Men song, 2 Men rắc, 1 linco,1 đẹn, 1fensit, 1 canxi',
            ],
            [
              20,
              840,
              1020,
              'LSK 17 clip: linco, flucasol, fensit, canxi, flodoxy, Gan, Tonic, Men rắc, Men sống',
            ],
            [28, 870, 1020, '22 clip nhà máy cho kênh tạp hóa'],
            [29, 860, 1027, '76 clip kênh tạp hóa cho các Dot4,5,6,7,8,9'],
          ],
        ],
        [
          9,
          25000,
          [
            [3, 840, 990, '16 CLIP TRẠI GÀ, 29 CLIP BaPhat'],
            [4, 860, 1040, '25 clip tạp hóa, 25 clip BaPhat.'],
            [5, 795, 1065, 'taphoanhabinh:40 clip. Baphat: 48 clip'],
            [6, 795, 915, '18 clip nhamaythuocga. 24 clip baphatreview'],
            [
              8,
              865,
              1035,
              'taphoa.24sp.0509; baphat.24sp.0509.dot2; batphat.24sp.0609.dot1',
            ],
            [9, 1080, 1200, '48 clip baphat dot1, dot2'],
            [10, 800, 1095, 'Tạp Hóa: 80 clip. Bá Phát: 56 clip'],
            [16, 1290, 1350, 'Tạp hóa: 22 clip (không có lỗi)'],
            [17, 840, 990, 'taphoa: 27 clip. baphat: 54 clip'],
            [22, 870, 1050, 'tạp hóa: 39 clip. baphat: 38 clip'],
            [23, 920, 1040, 'tạp hóa: 55 clip'],
            [24, 960, 1080, 'taphoa: 58 clip'],
            [25, 840, 900, 'taphoa: 32 clip'],
          ],
        ],
        [
          10,
          25000,
          [
            [5, 825, 885, '26 clip tạp hóa'],
            [13, 840, 960, '59 clip tạp hóa'],
            [14, 800, 980, '70 clip tạp hóa'],
            [15, 860, 1040, '44 clip tạp hóa'],
            [21, 840, 1000, '38 clip tạp hóa'],
          ],
        ],
        [11, 20000, []],
        [12, 20000, []],
      ];
      const vinhWb = buildTimesheetXlsx({
        employee_name: 'Nguyễn Huỳnh Thế Vinh',
        year: 2026,
        months: vinhRaw.map(([m, rate, days]) => ({
          month: m,
          rate,
          days: days.map(([d, s, e, task]) => day(d, s, e, task)),
        })),
      }).toString('base64');

      const before = await counts();
      const dryRun = await request(importUrl, owner, {
        file_base64: vinhWb,
        year: 2026,
        new_employee_name: 'Nguyễn Huỳnh Thế Vinh',
        commit: false,
      });
      assert.equal(dryRun.status, 200);
      assert.equal(dryRun.data.data.committed, false);
      assert.equal(dryRun.data.data.totals.shifts_new, 53);
      assert.equal(dryRun.data.data.totals.hours, 167.28);
      assert.equal(dryRun.data.data.totals.expected_wage_vnd, 3896252);
      assert.equal(dryRun.data.data.totals.rates_created, 2);
      assert.equal(dryRun.data.data.totals.reports_created, 50);
      assert.deepEqual(await counts(), before);

      const committed = await request(importUrl, owner, {
        file_base64: vinhWb,
        year: 2026,
        new_employee_name: 'Nguyễn Huỳnh Thế Vinh',
        commit: true,
      });
      assert.equal(committed.status, 201);
      const vinhId = committed.data.data.employee.id;
      const statsRes = await request(
        `/api/v1/payroll-tools/stats?granularity=month&from=2026-01-01&to=2026-12-31&employee_id=${vinhId}`,
        owner,
      );
      assert.equal(statsRes.status, 200);
      const st = statsRes.data.data;
      assert.deepEqual(
        st.buckets.map((b) => [b.key, b.wage_vnd]),
        [
          ['2026-06', 1143333],
          ['2026-07', 858334],
          ['2026-08', 771668],
          ['2026-09', 831250],
          ['2026-10', 291667],
        ],
      );
      assert.equal(st.totals.wage_vnd, 3896252);
      assert.equal(st.totals.worked_hours, 167.28);
      assert.equal(st.totals.work_days, 53);
      assert.equal(st.totals.report_days, 50);
      assert.equal(st.totals.reported_clips, 1453);
    },
  );

  // ------------------------------------------------------------ system logs
  async function waitForLogs(path, actorCtx, predicate, ms = 4000) {
    const end = Date.now() + ms;
    let last;
    while (Date.now() < end) {
      last = await request(path, actorCtx);
      if (last.status === 200 && predicate(last.data.data))
        return last.data.data;
      await new Promise((r) => setTimeout(r, 150));
    }
    assert.fail('timed out waiting for logs: ' + JSON.stringify(last?.data));
  }

  await t.test(
    'System log: errors are captured, grouped, filterable and Owner-only',
    async () => {
      assert.equal((await request('/api/v1/system/logs', staff)).status, 403);
      assert.equal((await request('/api/v1/system/logs')).status, 401);
      await request('/api/v1/definitely-missing/' + crypto.randomUUID(), owner);
      await request('/api/v1/definitely-missing/' + crypto.randomUUID(), owner);

      const list = await waitForLogs(
        '/api/v1/system/logs?status_min=400&route=definitely-missing',
        owner,
        (d) => d.items.length >= 2,
      );
      assert.ok(
        list.items.every((i) => i.route === '/api/v1/definitely-missing/:id'),
      );
      assert.equal(list.items[0].level, 'warn');
      assert.equal(list.items[0].source, 'api');
      assert.ok(list.items[0].request_id);
      assert.equal(
        list.items[0].fingerprint,
        list.items[1].fingerprint,
        'same endpoint groups together',
      );

      // earlier RBAC failures (403) are logged with the user and workspace
      const forbidden = await waitForLogs(
        '/api/v1/system/logs?q=FORBIDDEN',
        owner,
        (d) => d.items.length >= 1,
      );
      assert.ok(
        forbidden.items.some((i) => i.status === 403 && i.user_id === staff.id),
      );

      const summary = (
        await request('/api/v1/system/logs/summary?hours=24', owner)
      ).data.data;
      assert.ok(summary.totals.warn >= 3);
      assert.ok(summary.top_errors.length >= 1);
      assert.equal(summary.top_errors[0].count >= 2, true);
      assert.equal(summary.retention_days, 30);

      // other tenants never see this workspace's rows
      const foreignList = await request(
        '/api/v1/system/logs?q=FORBIDDEN',
        foreign,
      );
      assert.equal(foreignList.status, 200);
      assert.equal(
        foreignList.data.data.items.filter((i) => i.user_id === staff.id)
          .length,
        0,
      );

      // retention: the 40-day-old row was purged by the first flush
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int n FROM system_logs WHERE message='ancient row'",
          )
        ).rows[0].n,
        0,
      );
    },
  );

  await t.test('System log: cursor pagination and validation', async () => {
    const p1 = (await request('/api/v1/system/logs?limit=1', owner)).data.data;
    assert.equal(p1.items.length, 1);
    assert.ok(p1.next_cursor);
    const p2 = (
      await request(
        '/api/v1/system/logs?limit=1&cursor=' + p1.next_cursor,
        owner,
      )
    ).data.data;
    assert.notEqual(p2.items[0]?.id, p1.items[0].id);
    assert.equal(
      (await request('/api/v1/system/logs?level=bogus', owner)).status,
      400,
    );
    assert.equal(
      (await request('/api/v1/system/logs?cursor=garbage', owner)).status,
      400,
    );
    assert.equal(
      (await request('/api/v1/system/logs?status_min=1', owner)).status,
      400,
    );
  });

  await t.test(
    'System log: browser errors are stored sanitised and rate limited',
    async () => {
      const res = await request('/api/v1/system/client-errors', owner, {
        message: 'TypeError boom password=abc123secret',
        stack: 'TypeError: boom\n    at render (app.js:1:1)',
        url: '/payroll/stats?token=xyz',
      });
      assert.equal(res.status, 202);
      const rows = await waitForLogs(
        '/api/v1/system/logs?source=web',
        owner,
        (d) => d.items.length >= 1,
      );
      const item = rows.items[0];
      assert.equal(item.error_code, 'CLIENT_ERROR');
      assert.equal(item.route, '/payroll/stats');
      assert.ok(!item.message.includes('abc123secret'));
      const noCsrf = await fetch(base + '/api/v1/system/client-errors', {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          Cookie: owner.cookie,
        },
        body: JSON.stringify({ message: 'x' }),
      });
      assert.equal(noCsrf.status, 403);
      assert.equal(
        (
          await request('/api/v1/system/client-errors', owner, {
            message: 'x',
            evil: 1,
          })
        ).status,
        400,
      );
    },
  );

  await t.test(
    'System log detail links the audit events of the same request',
    async () => {
      const requestId = 'req-' + crypto.randomUUID();
      const logId = (
        await pool.query(
          "INSERT INTO system_logs(level,source,workspace_id,request_id,route,status,message,stack,fingerprint) VALUES('error','api',$1,$2,'/api/v1/x',500,'boom','Error: boom\n    at f (a.js:1:1)','fp1') RETURNING id",
          [workspace, requestId],
        )
      ).rows[0].id;
      await pool.query(
        "INSERT INTO audit_events(workspace_id,actor_user_id,action,entity_type,entity_id,request_id) VALUES($1,$2,'unit.test','thing','1',$3)",
        [workspace, owner.id, requestId],
      );
      const detail = await request('/api/v1/system/logs/' + logId, owner);
      assert.equal(detail.status, 200);
      assert.equal(detail.data.data.log.stack.includes('at f'), true);
      assert.equal(detail.data.data.related_audit_events.length, 1);
      assert.equal(
        detail.data.data.related_audit_events[0].action,
        'unit.test',
      );
      assert.equal(detail.data.data.occurrences.count, 1);
      assert.equal(
        (await request('/api/v1/system/logs/' + logId, foreign)).status,
        404,
      );
      assert.equal(
        (await request('/api/v1/system/logs/not-a-uuid', owner)).status,
        404,
      );
    },
  );
});
