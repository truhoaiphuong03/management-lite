import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';
import { resolve } from 'node:path';
test('WORK rev03 isolated PostgreSQL lifecycle, contracts, security and concurrency', async (t) => {
  if (
    !process.env.TEST_DATABASE_URL ||
    process.env.CONFIRM_ISOLATED_TEST_DB !== 'true'
  ) {
    t.skip('Explicit isolated QA DB required');
    return;
  }
  const { loadTestDatabaseConfig, assertSafeTestDatabase } =
    await import('../../dist/packages/database/src/config.js');
  const cfg = loadTestDatabaseConfig();
  assertSafeTestDatabase(cfg);
  const { createDatabasePool } =
    await import('../../dist/packages/database/src/pool.js');
  const pool = createDatabasePool(cfg);
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
    );
    await t.test(
      'M07-to-M08 upgrade, replay and checksum fail closed',
      async () => {
        assert.ok(migrations.length >= 10);
        for (let i = 0; i < 10; i++)
          assert.equal(migrations[i].checksum, EMBEDDED_MIGRATIONS[i].checksum);
        await pool.query(
          'DROP TABLE IF EXISTS work_schedule_links, work_reviews, work_submissions, work_assignments, work_items CASCADE;' +
            'ALTER TABLE staff_schedules DROP CONSTRAINT IF EXISTS uq_schedule_employee_identity CASCADE;' +
            'ALTER TABLE staff_schedule_entries DROP CONSTRAINT IF EXISTS uq_schedule_entry_workspace_date CASCADE;' +
            'DROP FUNCTION IF EXISTS work_history_immutable, work_assignment_guard, work_submission_guard, work_review_guard, work_item_guard, work_aggregate_consistent CASCADE;' +
            "DELETE FROM schema_migrations WHERE id IN ('0010_m08_work', '0022_work_schedule_links');",
        );
        await runMigrations(pool, migrations.slice(0, 9));
        assert.deepEqual((await runMigrations(pool, migrations)).appliedIds, [
          '0010_m08_work',
          '0022_work_schedule_links',
        ]);
        assert.equal((await runMigrations(pool, migrations)).appliedCount, 0);
        const bad = migrations.map((x) => ({ ...x }));
        bad[9].sql += '\n-- mismatch';
        bad[9].checksum = calculateChecksum(bad[9].sql);
        await assert.rejects(runMigrations(pool, bad), /checksum/i);
      },
    );
    const workspace = crypto.randomUUID(),
      other = crypto.randomUUID();
    await pool.query(
      "INSERT INTO workspaces(id,name) VALUES($1,'WORK QA'),($2,'WORK QA Other')",
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

    const root = '/api/v1/work-items';
    async function call(id, action, a, body = {}, key, version) {
      const path = root + '/' + id + action;
      const current =
        version ?? (await request(root + '/' + id, owner)).data.data.version;
      return request(path, a, body, {
        'If-Match': '"' + current + '"',
        ...(key ? { 'Idempotency-Key': key } : {}),
      });
    }
    let work, first, secondAssignment;
    await t.test(
      'Create rejects Staff, cross-workspace employees, bad title and unknown fields',
      async () => {
        assert.equal((await request(root, staff, { title: 'No' })).status, 403);
        assert.equal(
          (
            await request(root, owner, {
              title: 'Cross',
              assignee_ids: [foreign.emp],
            })
          ).status,
          404,
        );
        assert.equal((await request(root, owner, { title: ' ' })).status, 400);
        assert.equal(
          (await request(root, owner, { title: 'No', status: 'completed' }))
            .status,
          400,
        );
        assert.equal(
          (
            await request(root, owner, {
              title: 'Duplicates',
              assignee_ids: [staff.emp, staff.emp],
            })
          ).status,
          400,
        );
        assert.equal(
          (await request(root, owner, { title: 'Too long', due_at: 'invalid' }))
            .status,
          400,
        );
      },
    );
    await t.test(
      'Create idempotency replay/mismatch and independent assignments',
      async () => {
        const body = {
          title: 'WORK QA lifecycle',
          priority: 'high',
          assignee_ids: [staff.emp, second.emp],
        };
        const r = await request(root, owner, body, {
          'Idempotency-Key': 'work-create',
        });
        assert.equal(r.status, 201);
        work = r.data.data;
        assert.equal(work.status, 'todo');
        assert.equal(work.version, 1);
        assert.equal(work.assignments.length, 2);
        first = work.assignments.find((a) => a.employee_id === staff.emp).id;
        secondAssignment = work.assignments.find(
          (a) => a.employee_id === second.emp,
        ).id;
        assert.deepEqual(
          (
            await request(root, owner, body, {
              'Idempotency-Key': 'work-create',
            })
          ).data.data,
          work,
        );
        assert.equal(
          (
            await request(
              root,
              owner,
              { ...body, title: 'Different' },
              { 'Idempotency-Key': 'work-create' },
            )
          ).status,
          409,
        );
      },
    );
    await t.test(
      'List filters/self isolation/detail privacy/cross-workspace deny',
      async () => {
        assert.equal((await request(root)).status, 401);
        assert.equal(
          (
            await request(
              root + '?status=todo&priority=high&search=WORK',
              owner,
            )
          ).data.data.total,
          1,
        );
        const own = (await request(root + '/' + work.id, staff)).data.data;
        assert.equal(own.assignments.length, 1);
        assert.equal(own.assignments[0].employee_id, staff.emp);
        assert.equal(
          (await request(root + '/' + work.id, foreign)).status,
          404,
        );
        assert.equal(
          (await request(root + '?assignee_id=' + second.emp, staff)).status,
          403,
        );
        assert.equal((await request(root + '?status=bad', owner)).status, 400);
      },
    );
    await t.test(
      'CSRF absent/foreign origin and stale/missing If-Match fail without writes',
      async () => {
        const path = root + '/' + work.id + '/assignments/' + first + '/start';
        assert.equal(
          (await request(path, staff, {}, { 'X-CSRF-Token': '' })).status,
          403,
        );
        assert.equal(
          (await request(path, staff, {}, { Origin: 'https://evil.invalid' }))
            .status,
          403,
        );
        assert.equal((await request(path, staff, {})).status, 428);
        assert.equal(
          (
            await call(
              work.id,
              '/assignments/' + first + '/start',
              staff,
              {},
              undefined,
              99,
            )
          ).status,
          412,
        );
        assert.equal(
          (await request(root + '/' + work.id, owner)).data.data.version,
          1,
        );
      },
    );
    await t.test(
      'No quick review without valid submission and no cross-assignment writes',
      async () => {
        assert.equal(
          (
            await call(work.id, '/assignments/' + first + '/reviews', owner, {
              submission_id: crypto.randomUUID(),
              decision: 'approved',
            })
          ).status,
          409,
        );
        assert.equal(
          (await call(work.id, '/assignments/' + first + '/start', second))
            .status,
          403,
        );
      },
    );
    await t.test(
      'Concurrent duplicate start commits once with one version advance',
      async () => {
        const before = (await request(root + '/' + work.id, owner)).data.data;
        const results = await Promise.all([
          call(
            work.id,
            '/assignments/' + first + '/start',
            staff,
            {},
            undefined,
            before.version,
          ),
          call(
            work.id,
            '/assignments/' + first + '/start',
            staff,
            {},
            undefined,
            before.version,
          ),
        ]);
        assert.deepEqual(results.map((x) => x.status).sort(), [200, 412]);
        const after = (await request(root + '/' + work.id, owner)).data.data;
        assert.equal(after.version, 2);
        assert.equal(after.status, 'in_progress');
        assert.equal(
          after.assignments.find((a) => a.id === secondAssignment).status,
          'todo',
        );
      },
    );
    let submission;
    await t.test(
      'Submission belongs to actor, requires note and safe attachment; revision 1',
      async () => {
        assert.equal(
          (
            await call(
              work.id,
              '/assignments/' + first + '/submissions',
              owner,
              { submission_note: 'Not mine' },
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await call(
              work.id,
              '/assignments/' + first + '/submissions',
              staff,
              { submission_note: ' ' },
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              work.id,
              '/assignments/' + first + '/submissions',
              staff,
              {
                submission_note: 'bad link',
                attachments: [{ name: 'bad', url: 'javascript:alert(1)' }],
              },
            )
          ).status,
          400,
        );
        const r = await call(
          work.id,
          '/assignments/' + first + '/submissions',
          staff,
          {
            submission_note: 'Revision 1',
            attachments: [{ name: 'QA', url: 'https://example.invalid/qa' }],
          },
          'submission-1',
        );
        assert.equal(r.status, 201);
        const replay = await call(
          work.id,
          '/assignments/' + first + '/submissions',
          staff,
          {
            submission_note: 'Revision 1',
            attachments: [{ name: 'QA', url: 'https://example.invalid/qa' }],
          },
          'submission-1',
          2,
        );
        assert.equal(replay.status, 201);
        assert.deepEqual(replay.data.data, r.data.data);
        assert.equal(
          (
            await call(
              work.id,
              '/assignments/' + first + '/submissions',
              staff,
              { submission_note: 'different' },
              'submission-1',
              2,
            )
          ).status,
          409,
        );
        const a = r.data.data.assignments.find((x) => x.id === first);
        assert.equal(a.status, 'in_review');
        submission = a.submissions[0].id;
        assert.equal(a.submissions[0].revision_number, 1);
      },
    );
    await t.test(
      'Review requires feedback for changes, rejects path/body mismatch and stale ID',
      async () => {
        const path =
          '/assignments/' + first + '/submissions/' + submission + '/reviews';
        assert.equal(
          (
            await call(work.id, path, owner, {
              submission_id: submission,
              decision: 'request_changes',
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await call(work.id, path, owner, {
              submission_id: crypto.randomUUID(),
              decision: 'approved',
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await call(work.id, '/assignments/' + first + '/reviews', owner, {
              submission_id: crypto.randomUUID(),
              decision: 'approved',
            })
          ).status,
          409,
        );
        const r = await call(work.id, path, owner, {
          submission_id: submission,
          decision: 'request_changes',
          feedback: 'Please revise',
        });
        assert.equal(r.status, 200);
        assert.equal(
          r.data.data.assignments.find((x) => x.id === first).status,
          'in_progress',
        );
      },
    );
    await t.test(
      'Revision advances to 2, old submission cannot be reviewed; single completion not item completion',
      async () => {
        const r = await call(
          work.id,
          '/assignments/' + first + '/submissions',
          staff,
          { submission_note: 'Revision 2' },
        );
        assert.equal(r.status, 201);
        const a = r.data.data.assignments.find((x) => x.id === first);
        assert.deepEqual(
          a.submissions.map((x) => x.revision_number),
          [1, 2],
        );
        assert.equal(
          (
            await call(work.id, '/assignments/' + first + '/reviews', owner, {
              submission_id: submission,
              decision: 'approved',
            })
          ).status,
          409,
        );
        submission = a.submissions[1].id;
        const review = await call(
          work.id,
          '/assignments/' + first + '/reviews',
          owner,
          { submission_id: submission, decision: 'approved' },
        );
        assert.equal(review.status, 200);
        assert.equal(review.data.data.status, 'in_progress');
        assert.equal(
          review.data.data.assignments.find((x) => x.id === first).status,
          'completed',
        );
        assert.equal(
          review.data.data.assignments.find((x) => x.id === secondAssignment)
            .status,
          'todo',
        );
      },
    );
    await t.test(
      'Item completes only when all independent assignments complete',
      async () => {
        assert.equal(
          (
            await call(
              work.id,
              '/assignments/' + secondAssignment + '/start',
              second,
            )
          ).status,
          200,
        );
        let r = await call(
          work.id,
          '/assignments/' + secondAssignment + '/submissions',
          second,
          { submission_note: 'Second employee result' },
        );
        assert.equal(r.status, 201);
        const sid = r.data.data.assignments.find(
          (a) => a.id === secondAssignment,
        ).submissions[0].id;
        const expectedVersion = r.data.data.version;
        const reviewPath =
          '/assignments/' +
          secondAssignment +
          '/submissions/' +
          sid +
          '/reviews';
        const concurrent = await Promise.all([
          call(
            work.id,
            reviewPath,
            owner,
            { decision: 'approved' },
            undefined,
            expectedVersion,
          ),
          call(
            work.id,
            reviewPath,
            owner,
            { decision: 'approved' },
            undefined,
            expectedVersion,
          ),
        ]);
        assert.deepEqual(concurrent.map((x) => x.status).sort(), [200, 412]);
        r = concurrent.find((x) => x.status === 200);
        assert.equal(r.status, 200);
        assert.equal(r.data.data.status, 'completed');
        assert.ok(
          r.data.data.assignments.every((a) => a.status === 'completed'),
        );
      },
    );
    await t.test(
      'Composite FK/review binding and history append-only guards',
      async () => {
        await assert.rejects(
          pool.query(
            'UPDATE work_submissions SET submission_note=$1 WHERE id=$2',
            ['overwrite', submission],
          ),
          /append-only/,
        );
        await assert.rejects(
          pool.query('DELETE FROM work_reviews WHERE work_item_id=$1', [
            work.id,
          ]),
          /append-only/,
        );
        await assert.rejects(
          pool.query(
            'INSERT INTO work_assignments(workspace_id,work_item_id,employee_id,assigned_by) VALUES($1,$2,$3,$4)',
            [other, work.id, foreign.emp, foreign.id],
          ),
          /foreign key/i,
        );
      },
    );
    let cancelWork;
    await t.test(
      'PATCH metadata and assignments use parent If-Match, duplicate assignment blocked',
      async () => {
        const r = await request(root, owner, {
          title: 'Cancel history',
          assignee_ids: [staff.emp],
        });
        cancelWork = r.data.data;
        await assert.rejects(
          pool.query(
            "UPDATE work_items SET status='completed',version=version+1 WHERE id=$1",
            [cancelWork.id],
          ),
          /aggregate status invalid/,
        );
        assert.equal(
          (
            await request(
              root + '/' + cancelWork.id + '/cancel/' + first + '/start',
              owner,
              {},
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              root +
                '/' +
                cancelWork.id +
                '/assignments/' +
                first +
                '/start/' +
                submission +
                '/reviews',
              owner,
              {},
            )
          ).status,
          404,
        );
        const edit = await fetch(base + root + '/' + cancelWork.id, {
          method: 'PATCH',
          headers: {
            Origin: origin,
            'Content-Type': 'application/json',
            Cookie: owner.cookie,
            'X-CSRF-Token': owner.csrf,
            'If-Match': '"1"',
          },
          body: JSON.stringify({ title: 'Edited', priority: 'urgent' }),
        });
        assert.equal(edit.status, 200);
        let add = await call(cancelWork.id, '/assignments', owner, {
          employee_ids: [second.emp],
        });
        assert.equal(add.status, 201);
        assert.equal(add.data.data.assignments.length, 2);
        assert.equal(
          (
            await call(cancelWork.id, '/assignments', owner, {
              employee_ids: [second.emp],
            })
          ).status,
          409,
        );
      },
    );
    await t.test(
      'Cancel preserves history, blocks further actions and retains Staff read access',
      async () => {
        const a = (await request(root + '/' + cancelWork.id, staff)).data.data
          .assignments[0];
        await call(cancelWork.id, '/assignments/' + a.id + '/start', staff);
        await call(
          cancelWork.id,
          '/assignments/' + a.id + '/submissions',
          staff,
          { submission_note: 'Retained evidence' },
        );
        const before = (await request(root + '/' + cancelWork.id, owner)).data
          .data;
        assert.equal(
          (await call(cancelWork.id, '/cancel', owner, { reason: 'QA cancel' }))
            .status,
          200,
        );
        const after = (await request(root + '/' + cancelWork.id, owner)).data
          .data;
        assert.equal(after.status, 'cancelled');
        assert.deepEqual(after.assignments, before.assignments);
        assert.equal(
          (await call(cancelWork.id, '/assignments/' + a.id + '/start', staff))
            .status,
          409,
        );
        assert.equal(
          (await request(root + '/' + cancelWork.id, staff)).status,
          200,
        );
        await assert.rejects(
          pool.query('DELETE FROM work_items WHERE id=$1', [cancelWork.id]),
          /cannot be deleted/,
        );
      },
    );
    await t.test(
      'Parent aggregate cannot drift at commit and Owner can cancel completed work without losing history',
      async () => {
        await assert.rejects(
          pool.query(
            "INSERT INTO work_items(workspace_id,title,status,created_by) VALUES($1,'invalid completion','completed',$2)",
            [workspace, owner.id],
          ),
          /must start todo/,
        );
        const before = (await request(root + '/' + work.id, owner)).data.data;
        const cancel = await call(work.id, '/cancel', owner, {
          reason: 'Completed work cancellation preserves history',
        });
        assert.equal(cancel.status, 200);
        assert.equal(cancel.data.data.status, 'cancelled');
        assert.deepEqual(cancel.data.data.assignments, before.assignments);
      },
    );
    await t.test(
      'Audit failure rolls back item, assignment and idempotency claim atomically',
      async () => {
        const { WorkService } =
          await import('../../dist/apps/api/src/work/service.js');
        const { AuthService } =
          await import('../../dist/apps/api/src/auth/service.js');
        const auth = await new AuthService(pool).resolveSession(
          owner.cookie.split('=')[1],
        );
        assert.ok(auth);
        const injected = {
          connect: async () => {
            const c = await pool.connect();
            return {
              query: (sql, args) =>
                String(sql).includes('INSERT INTO audit_events')
                  ? Promise.reject(new Error('Injected audit failure'))
                  : c.query(sql, args),
              release: () => c.release(),
            };
          },
        };
        const service = new WorkService(injected);
        const before = (
          await pool.query('SELECT count(*)::int AS n FROM work_items')
        ).rows[0].n;
        await assert.rejects(
          service.create(
            auth,
            { title: 'Must rollback', assignee_ids: [staff.emp] },
            'audit-rollback',
            'qa-request',
          ),
          /Injected audit failure/,
        );
        assert.equal(
          (await pool.query('SELECT count(*)::int AS n FROM work_items'))
            .rows[0].n,
          before,
        );
        assert.equal(
          (
            await pool.query(
              "SELECT count(*)::int AS n FROM idempotency_records WHERE operation_key='WORK_CREATE:audit-rollback'",
            )
          ).rows[0].n,
          0,
        );
      },
    );
    await t.test(
      'Concurrent projection and session refresh avoid stale-snapshot failures',
      async () => {
        const { WorkService } =
          await import('../../dist/apps/api/src/work/service.js');
        const { AuthService } =
          await import('../../dist/apps/api/src/auth/service.js');
        const auth = await new AuthService(pool).resolveSession(
          owner.cookie.split('=')[1],
        );
        const service = new WorkService(pool);
        await Promise.all(
          Array.from({ length: 20 }, async () => {
            await Promise.all([
              service.get(auth, work.id),
              pool.query(
                "UPDATE auth_sessions SET idle_expires_at=idle_expires_at+interval '1 second' WHERE id=$1",
                [auth.sessionId],
              ),
            ]);
          }),
        );
      },
    );
    await t.test(
      'Revoked session cannot perform a sensitive write',
      async () => {
        const { WorkService } =
          await import('../../dist/apps/api/src/work/service.js');
        const { AuthService } =
          await import('../../dist/apps/api/src/auth/service.js');
        const auth = await new AuthService(pool).resolveSession(
          owner.cookie.split('=')[1],
        );
        await pool.query(
          'UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE id=$1',
          [auth.sessionId],
        );
        await assert.rejects(
          new WorkService(pool).create(
            auth,
            { title: 'Forbidden after revoke' },
            undefined,
            'qa-stale',
          ),
          (e) => e.code === 'UNAUTHENTICATED',
        );
      },
    );
  } finally {
    if (server) await new Promise((r) => server.close(r));
    await pool.end();
  }
});
