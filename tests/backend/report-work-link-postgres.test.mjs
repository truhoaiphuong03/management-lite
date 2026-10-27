import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';
import { resolve } from 'node:path';

/** Real-PostgreSQL test: a report entry can link to a work item assigned to the same employee. */
test('REPORT ↔ WORK link against migrated PostgreSQL (assignment ownership, revisions, validation)', async (t) => {
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
    "INSERT INTO workspaces(id,name) VALUES($1,'RW QA'),($2,'RW QA Other')",
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
  async function request(path, actor, body, headers = {}, method) {
    const res = await fetch(base + path, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(actor ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.csrf } : {}),
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
    const id = crypto.randomUUID();
    const emp = crypto.randomUUID();
    const name = 'rwqa_' + id.replaceAll('-', '');
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
  const alice = await actor('staff');
  const bob = await actor('staff');

  async function workItem(title, assignee) {
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO work_items(id,workspace_id,title,created_by) VALUES($1,$2,$3,$4)',
      [id, workspace, title, owner.id],
    );
    if (assignee)
      await pool.query(
        'INSERT INTO work_assignments(workspace_id,work_item_id,employee_id,assigned_by) VALUES($1,$2,$3,$4)',
        [workspace, id, assignee.emp, owner.id],
      );
    return id;
  }
  const aliceItem = await workItem('Edit 8 clip LSK', alice);
  const bobItem = await workItem('Clip tạp hóa', bob);
  const unassigned = await workItem('Chưa giao', null);

  const entry = (extra = {}) => ({
    work_type: 'video_editing',
    reported_count: 8,
    notes: 'n',
    ...extra,
  });
  let reportId;
  let version;

  await t.test(
    'An entry links to a work item assigned to the same employee',
    async () => {
      const res = await request('/api/v1/reports/daily', alice, {
        report_date: '2026-03-02',
        entries: [
          entry({ work_item_id: aliceItem }),
          entry({ reported_count: 2 }),
        ],
      });
      assert.equal(res.status, 201, JSON.stringify(res.data));
      const d = res.data.data;
      reportId = d.id;
      version = d.version;
      assert.equal(d.entries[0].work_item_id, aliceItem);
      assert.equal(d.entries[0].work_item_title, 'Edit 8 clip LSK');
      assert.equal(d.entries[1].work_item_id, null);
      const detail = await request('/api/v1/reports/daily/' + reportId, alice);
      assert.equal(detail.status, 200);
      assert.equal(
        detail.data.data.entries[0].work_item_title,
        'Edit 8 clip LSK',
      );
    },
  );

  await t.test(
    "Cannot link to another employee's, an unassigned or a missing work item",
    async () => {
      const before = (
        await pool.query(
          'SELECT count(*)::int n FROM daily_reports WHERE workspace_id=$1',
          [workspace],
        )
      ).rows[0].n;
      for (const id of [bobItem, unassigned, crypto.randomUUID()]) {
        const res = await request('/api/v1/reports/daily', alice, {
          report_date: '2026-03-03',
          entries: [entry({ work_item_id: id })],
        });
        assert.equal(res.status, 422, id);
        assert.equal(res.data.error.code, 'INVALID_WORK_ITEM');
      }
      const bad = await request('/api/v1/reports/daily', alice, {
        report_date: '2026-03-03',
        entries: [entry({ work_item_id: 'not-a-uuid' })],
      });
      assert.equal(bad.status, 400);
      // nothing was created by the failed attempts (atomic)
      assert.equal(
        (
          await pool.query(
            'SELECT count(*)::int n FROM daily_reports WHERE workspace_id=$1',
            [workspace],
          )
        ).rows[0].n,
        before,
      );
    },
  );

  await t.test(
    'Draft update, submit and revision keep the link and snapshot it',
    async () => {
      const patch = await request(
        '/api/v1/reports/daily/' + reportId,
        alice,
        { entries: [entry({ work_item_id: aliceItem, reported_count: 9 })] },
        { 'If-Match': String(version) },
        'PATCH',
      );
      assert.equal(patch.status, 200, JSON.stringify(patch.data));
      assert.equal(patch.data.data.entries[0].work_item_id, aliceItem);
      version = patch.data.data.version;

      const submit = await request(
        '/api/v1/reports/daily/' + reportId + '/submit',
        alice,
        {},
        { 'If-Match': String(version) },
      );
      assert.equal(submit.status, 200, JSON.stringify(submit.data));
      version = submit.data.data.version;
      const snap = (
        await pool.query(
          "SELECT snapshot FROM daily_report_revisions WHERE report_id=$1 AND status='submitted' ORDER BY revision_number DESC LIMIT 1",
          [reportId],
        )
      ).rows[0].snapshot;
      assert.equal(snap.entries[0].work_item_id, aliceItem);

      const revise = await request(
        '/api/v1/reports/daily/' + reportId + '/revisions',
        alice,
        {
          entries: [entry({ work_item_id: aliceItem, reported_count: 10 })],
          reason: 'đổi số lượng',
        },
        { 'If-Match': String(version) },
      );
      assert.equal(revise.status, 201, JSON.stringify(revise.data));
      const rev = await request(
        '/api/v1/reports/daily/' + reportId + '/revisions',
        alice,
      );
      assert.equal(rev.status, 200);
      const latest = rev.data.data.find((r) => r.revision_number === 2);
      assert.equal(latest.snapshot.entries[0].work_item_id, aliceItem);
      // revising with someone else's work item is rejected and keeps the previous entries
      const reject = await request(
        '/api/v1/reports/daily/' + reportId + '/revisions',
        alice,
        { entries: [entry({ work_item_id: bobItem })], reason: 'x' },
        { 'If-Match': String(revise.data.data.version ?? version + 1) },
      );
      assert.ok([422, 412].includes(reject.status), String(reject.status));
      const still = await request('/api/v1/reports/daily/' + reportId, alice);
      assert.equal(still.data.data.entries[0].work_item_id, aliceItem);
    },
  );

  await t.test(
    'Another employee and another workspace cannot see the link',
    async () => {
      assert.equal(
        (await request('/api/v1/reports/daily/' + reportId, bob)).status,
        404,
      );
      const foreign = await actor('owner', other);
      assert.equal(
        (await request('/api/v1/reports/daily/' + reportId, foreign)).status,
        404,
      );
    },
  );

  await t.test(
    'A linked work item cannot be deleted from under a report (FK)',
    async () => {
      await assert.rejects(
        pool.query('DELETE FROM work_items WHERE workspace_id=$1 AND id=$2', [
          workspace,
          aliceItem,
        ]),
        /violates foreign key/,
      );
    },
  );
});
