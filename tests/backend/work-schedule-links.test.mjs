import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';
import { createDatabasePool } from '../../dist/packages/database/src/pool.js';
import {
  loadTestDatabaseConfig,
  assertSafeTestDatabase,
} from '../../dist/packages/database/src/config.js';
import { createRequestHandler } from '../../dist/apps/api/src/app.js';
import { hashPassword } from '../../dist/packages/security/src/password.js';
import {
  runMigrations,
  loadMigrationFiles,
} from '../../dist/packages/database/src/migrator.js';
import { resolve } from 'node:path';

test('Work ↔ Schedule: mutation, employee/workspace isolation, version, CSRF, replay and schedule revisions', async (t) => {
  const cfg = loadTestDatabaseConfig();
  assertSafeTestDatabase(cfg);
  const pool = createDatabasePool(cfg);
  t.after(() => pool.end());
  await runMigrations(
    pool,
    loadMigrationFiles(resolve('packages/database/src/migrations')),
  );
  const ws = crypto.randomUUID(),
    other = crypto.randomUUID();
  await pool.query(
    "INSERT INTO workspaces(id,name) VALUES($1,'Schedule links QA'),($2,'Other QA')",
    [ws, other],
  );
  const origin = 'http://127.0.0.1:3149';
  const server = http.createServer(
    createRequestHandler({
      pool,
      csrfSecret: crypto.randomBytes(32).toString('hex'),
      allowedOrigins: [origin],
      isProduction: false,
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function api(path, actor, body, headers = {}, method) {
    const res = await fetch(base + '/api/v1/' + path, {
      method: method || (body === undefined ? 'GET' : 'POST'),
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
      body: await res.json(),
      cookie: res.headers.get('set-cookie')?.split(';')[0],
    };
  }
  async function actor(role, workspace = ws) {
    const user = crypto.randomUUID(),
      emp = crypto.randomUUID(),
      password = 'FixtureSchedule123!';
    await pool.query(
      "INSERT INTO users(id,username_normalized,email_normalized,status) VALUES($1::uuid,$1::text,$2,'active')",
      [user, user + '@example.invalid'],
    );
    await pool.query(
      'INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)',
      [user, await hashPassword(password)],
    );
    await pool.query(
      "INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES($1,$2,$3,'active')",
      [workspace, user, role],
    );
    await pool.query(
      "INSERT INTO user_workspace_bindings(workspace_id,user_id,status) VALUES($1,$2,'active')",
      [workspace, user],
    );
    await pool.query(
      "INSERT INTO employees(id,workspace_id,user_id,employee_code,full_name,employment_status) VALUES($1,$2,$3,$4,'QA Employee','active')",
      [emp, workspace, user, 'QA' + emp.slice(0, 8)],
    );
    const login = await api('auth/login', null, { identifier: user, password });
    assert.equal(login.status, 200);
    return {
      user,
      emp,
      cookie: login.cookie,
      csrf: login.body.data.csrf_token,
    };
  }
  const owner = await actor('owner'),
    staff = await actor('staff'),
    colleague = await actor('staff'),
    foreign = await actor('owner', other);
  const entries = [
    { work_date: '2026-10-19', day_of_week: 1, start_time: '08:00' },
  ];
  const schedule = await api('schedules', staff, {
    week_start_date: '2026-10-19',
    entries,
  });
  assert.equal(schedule.status, 201);
  const sid = schedule.body.data.schedule.id;
  const otherSchedule = await api('schedules', colleague, {
    week_start_date: '2026-10-19',
    entries,
  });
  assert.equal(otherSchedule.status, 201);
  const work = await api('work-items', owner, {
    title: 'Task linked to registered shift',
    assignee_ids: [staff.emp, colleague.emp],
  });
  assert.equal(work.status, 201);
  const item = work.body.data,
    assignment = item.assignments.find((a) => a.employee_id === staff.emp);
  const body = {
    assignment_id: assignment.id,
    schedule_id: sid,
    work_date: '2026-10-19',
  };
  const endpoint = `work-items/${item.id}/schedule-links`;
  assert.equal(
    (await api(endpoint, staff, body, { 'If-Match': '"1"' })).status,
    403,
  );
  assert.equal(
    (
      await api(endpoint, owner, body, {
        'X-CSRF-Token': '',
        'If-Match': '"1"',
      })
    ).status,
    403,
  );
  assert.equal((await api(endpoint, owner, body)).status, 428);
  assert.equal(
    (await api(endpoint, owner, body, { 'If-Match': '"99"' })).status,
    412,
  );
  assert.equal(
    (await api(endpoint, foreign, body, { 'If-Match': '"1"' })).status,
    404,
  );
  assert.equal(
    (
      await api(
        endpoint,
        owner,
        { ...body, schedule_id: otherSchedule.body.data.schedule.id },
        { 'If-Match': '"1"' },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await api(
        endpoint,
        owner,
        { ...body, work_date: '2026-10-20' },
        { 'If-Match': '"1"' },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await api(
        endpoint,
        owner,
        { ...body, work_date: '2026-02-31' },
        { 'If-Match': '"1"' },
      )
    ).status,
    400,
  );
  const key = crypto.randomUUID(),
    headers = { 'If-Match': '"1"', 'Idempotency-Key': key };
  const linked = await api(endpoint, owner, body, headers);
  assert.equal(linked.status, 200);
  assert.equal(linked.body.data.version, 2);
  assert.deepEqual(
    (await api(endpoint, owner, body, headers)).body.data,
    linked.body.data,
  );
  const mine = await api(
    `work-items?schedule_id=${sid}&work_date=2026-10-19`,
    staff,
  );
  assert.equal(mine.body.data.total, 1);
  assert.equal(mine.body.data.items[0].assignments.length, 1);
  assert.equal(
    mine.body.data.items[0].assignments[0].schedule_links[0].work_date,
    '2026-10-19',
  );
  assert.equal(
    (await api(`work-items?schedule_id=${sid}`, colleague)).body.data.total,
    0,
  );
  assert.equal(
    (await api(`work-items?schedule_id=${sid}`, foreign)).body.data.total,
    0,
  );
  // Entry replacement retains date link; removed registered date is rejected at COMMIT.
  const revised = await api(
    `schedules/${sid}`,
    staff,
    { entries: [{ ...entries[0], start_time: '09:30' }] },
    { 'If-Match': '"1"' },
    'PUT',
  );
  assert.equal(revised.status, 200);
  const detail = await api(`work-items/${item.id}`, staff);
  assert.equal(
    detail.body.data.assignments[0].schedule_links[0].start_time,
    '09:30',
  );
  const removed = await api(
    `schedules/${sid}`,
    staff,
    { entries: [] },
    { 'If-Match': '"2"' },
    'PUT',
  );
  assert.equal(removed.status, 409);
  assert.equal(removed.body.error.code, 'SCHEDULE_HAS_ASSIGNED_WORK');
  const unlink = await api(
    endpoint,
    owner,
    { ...body, schedule_id: null },
    { 'If-Match': '"2"' },
  );
  assert.equal(unlink.status, 200);
  assert.equal(
    (await api(`work-items?schedule_id=${sid}`, staff)).body.data.total,
    0,
  );
  assert.equal(
    (
      await api(
        `schedules/${sid}`,
        staff,
        { entries: [] },
        { 'If-Match': '"2"' },
        'PUT',
      )
    ).status,
    200,
  );
  const audit = await pool.query(
    "SELECT count(*)::int AS n FROM audit_events WHERE entity_id=$1 AND action='work.schedule_link_changed'",
    [item.id],
  );
  assert.equal(audit.rows[0].n, 2);
});
