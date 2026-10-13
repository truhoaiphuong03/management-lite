import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';
import { loadTestDatabaseConfig } from '../../dist/packages/database/src/config.js';
import { createDatabasePool } from '../../dist/packages/database/src/pool.js';
import {
  loadMigrationFiles,
  runMigrations,
} from '../../dist/packages/database/src/migrator.js';
import { hashPassword } from '../../dist/packages/security/src/password.js';
import { createRequestHandler } from '../../dist/apps/api/src/app.js';

// This suite adds live assertions absent from the former source-only coverage.
// It never reads .env or calls a pre-existing API server.
test('Function verification: live AUTH, ACC atomic rollback, ATT overnight', async (t) => {
  const expected = process.env.VERIFY_QA_SYSTEM_IDENTIFIER;
  assert.ok(expected, 'Explicit owned QA cluster identity required');
  const cfg = loadTestDatabaseConfig();
  const target = new URL(cfg.connectionString);
  assert.equal(target.hostname, '127.0.0.1');
  assert.ok(
    ![
      '5432',
      '55499',
      '55571',
      '55601',
      '55701',
      '55777',
      '55813',
      '55888',
    ].includes(target.port),
  );
  const pool = createDatabasePool(cfg);
  t.after(() => pool.end());
  const proof = (
    await pool.query(
      "SELECT current_database() AS db, current_setting('port') AS port, (SELECT system_identifier::text FROM pg_control_system()) AS id",
    )
  ).rows[0];
  assert.equal(proof.id, expected);
  assert.equal(proof.port, target.port);
  assert.equal(proof.db, target.pathname.slice(1));
  await runMigrations(
    pool,
    loadMigrationFiles('packages/database/src/migrations'),
  );

  const workspace = crypto.randomUUID();
  await pool.query(
    "INSERT INTO workspaces(id,name) VALUES($1,'Function verification QA')",
    [workspace],
  );
  const origin = 'http://127.0.0.1:3099';
  const server = http.createServer(
    createRequestHandler({
      pool,
      csrfSecret: crypto.randomBytes(32).toString('hex'),
      accountSecretKey: crypto.randomBytes(32),
      allowedOrigins: [origin],
      isProduction: false,
    }),
  );
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => server.close(done)));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(
    path,
    actor,
    body,
    method = body === undefined ? 'GET' : 'POST',
    headers = {},
  ) {
    const response = await fetch(base + path, {
      method,
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(actor ? { Cookie: actor.cookie, 'X-CSRF-Token': actor.csrf } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      data: text ? JSON.parse(text) : null,
    };
  }
  async function provision(
    role,
    username = `verify_${crypto.randomUUID()}`,
    email = `${crypto.randomUUID()}@example.test`,
  ) {
    const id = crypto.randomUUID(),
      employee = crypto.randomUUID(),
      password = crypto.randomBytes(24).toString('hex');
    await pool.query(
      "INSERT INTO users(id,username_normalized,email_normalized,status) VALUES($1,$2,$3,'active')",
      [id, username, email],
    );
    await pool.query(
      'INSERT INTO user_credentials(user_id,password_hash) VALUES($1,$2)',
      [id, await hashPassword(password)],
    );
    await pool.query(
      "INSERT INTO workspace_memberships(workspace_id,user_id,role,status) VALUES($1,$2,$3,'active')",
      [workspace, id, role],
    );
    await pool.query(
      "INSERT INTO user_workspace_bindings(workspace_id,user_id,status) VALUES($1,$2,'active')",
      [workspace, id],
    );
    await pool.query(
      "INSERT INTO employees(id,workspace_id,user_id,employee_code,full_name,employment_status) VALUES($1,$2,$3,$4,'QA synthetic actor','active')",
      [employee, workspace, id, id],
    );
    const login = await request('/api/v1/auth/login', null, {
      identifier: username,
      password,
    });
    assert.equal(login.status, 200);
    return {
      id,
      employee,
      password,
      username,
      cookie: login.headers.get('set-cookie').split(';')[0],
      csrf: login.data.data.csrf_token,
    };
  }
  const owner = await provision('owner'),
    staff = await provision('staff');

  await t.test(
    'AUTH-007 raw session token is absent from persisted row; cookie is HttpOnly',
    async () => {
      const raw = owner.cookie.slice(owner.cookie.indexOf('=') + 1);
      const digest = crypto.createHash('sha256').update(raw).digest('hex');
      const row = (
        await pool.query(
          'SELECT * FROM auth_sessions WHERE session_token_hash=$1',
          [digest],
        )
      ).rows[0];
      assert.ok(row);
      assert.equal(row.session_token_hash, digest);
      assert.ok(!JSON.stringify(row).includes(raw));
      const login = await request('/api/v1/auth/login', null, {
        identifier: staff.username,
        password: staff.password,
      });
      assert.equal(login.status, 200);
      assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
      assert.match(login.headers.get('set-cookie'), /SameSite=Lax/i);
    },
  );

  await t.test(
    'AUTH-006 expired idle and absolute sessions return 401 without extending last_seen',
    async () => {
      for (const expiry of ['idle_expires_at', 'absolute_expires_at']) {
        const login = await request('/api/v1/auth/login', null, {
          identifier: staff.username,
          password: staff.password,
        });
        assert.equal(login.status, 200);
        const cookie = login.headers.get('set-cookie').split(';')[0];
        const raw = cookie.slice(cookie.indexOf('=') + 1);
        const digest = crypto.createHash('sha256').update(raw).digest('hex');
        await pool.query(
          `UPDATE auth_sessions SET ${expiry}=now()-interval '1 minute' WHERE session_token_hash=$1`,
          [digest],
        );
        const before = (
          await pool.query(
            'SELECT last_seen_at FROM auth_sessions WHERE session_token_hash=$1',
            [digest],
          )
        ).rows[0];
        assert.equal(
          (await request('/api/v1/auth/me', { cookie })).status,
          401,
        );
        const after = (
          await pool.query(
            'SELECT last_seen_at FROM auth_sessions WHERE session_token_hash=$1',
            [digest],
          )
        ).rows[0];
        assert.deepEqual(after, before);
      }
    },
  );

  await t.test(
    'AUTH-010 real username/email collision normalizes case and refuses session issuance',
    async () => {
      const shared = `shared_${crypto.randomUUID()}@example.test`;
      const first = await provision('staff', shared);
      await provision('staff', `other_${crypto.randomUUID()}`, shared);
      const before = (
        await pool.query('SELECT count(*)::int AS n FROM auth_sessions')
      ).rows[0].n;
      const response = await request('/api/v1/auth/login', null, {
        identifier: `  ${shared.toUpperCase()}  `,
        password: first.password,
      });
      assert.equal(response.status, 401);
      assert.equal(response.data.error.code, 'INVALID_CREDENTIALS');
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal(
        (await pool.query('SELECT count(*)::int AS n FROM auth_sessions'))
          .rows[0].n,
        before,
      );
    },
  );

  await t.test(
    'ACC-003/004/007 failed audit atomically rolls back secret and proof consumption; retry succeeds',
    async () => {
      const account = await request('/api/v1/accounts', owner, {
        platform: 'gmail',
        username: `verify_${crypto.randomUUID()}`,
      });
      assert.equal(account.status, 201);
      const id = account.data.data.id;
      const proof = await request('/api/v1/auth/reauth', owner, {
        password: owner.password,
        action: 'secret_write',
        account_id: id,
      });
      assert.equal(proof.status, 200);
      const body = {
        secret_type: 'password',
        secret_value: crypto.randomBytes(24).toString('hex'),
        reauth_proof: proof.data.data.reauth_proof,
      };
      const snapshot = async () =>
        (
          await pool.query(
            `SELECT json_build_object(
      'version',(SELECT version FROM managed_accounts WHERE id=$1),
      'secrets',(SELECT count(*) FROM account_secrets WHERE account_id=$1),
      'proofs',(SELECT count(*) FROM account_reauth_proofs WHERE account_id=$1 AND used_at IS NOT NULL),
      'access',(SELECT count(*) FROM secret_access_events WHERE account_id=$1),
      'audit',(SELECT count(*) FROM audit_events WHERE entity_id=$1::text)) AS state`,
            [id],
          )
        ).rows[0].state;
      const before = await snapshot();
      await pool.query(`CREATE FUNCTION qa_reject_vault_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='account_secret_write' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER qa_reject_vault_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION qa_reject_vault_audit()`);
      try {
        assert.equal(
          (
            await request(
              `/api/v1/accounts/${id}/secrets`,
              owner,
              body,
              'PUT',
              { 'If-Match': '1' },
            )
          ).status,
          500,
        );
        assert.deepEqual(await snapshot(), before);
      } finally {
        await pool.query(
          'DROP TRIGGER qa_reject_vault_audit ON audit_events; DROP FUNCTION qa_reject_vault_audit()',
        );
      }
      assert.equal(
        (
          await request(`/api/v1/accounts/${id}/secrets`, owner, body, 'PUT', {
            'If-Match': '1',
          })
        ).status,
        200,
      );
      assert.equal((await snapshot()).secrets, 1);
      assert.equal((await snapshot()).proofs, 1);
      assert.equal(
        (
          await request(`/api/v1/accounts/${id}/secrets`, staff, body, 'PUT', {
            'If-Match': '1',
          })
        ).status,
        403,
      );
    },
  );

  await t.test(
    'REP-006 cursor traverses actual reports without duplicates or read-side writes',
    async () => {
      const ids = [];
      for (const report_date of ['2026-09-01', '2026-09-02', '2026-09-03']) {
        const created = await request('/api/v1/reports/daily', staff, {
          report_date,
          entries: [{ work_type: 'other', reported_count: 1 }],
        });
        assert.equal(created.status, 201);
        ids.push(created.data.data.id);
      }
      const before = (
        await pool.query('SELECT count(*)::int n FROM daily_reports')
      ).rows[0].n;
      for (const [path, actor] of [
        ['/api/v1/reports/me', staff],
        ['/api/v1/reports/daily', owner],
      ]) {
        const seen = [];
        let cursor;
        for (let page = 0; page < 4; page++) {
          const response = await request(
            `${path}?limit=1${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`,
            actor,
          );
          assert.equal(response.status, 200);
          seen.push(...response.data.data.items.map((row) => row.id));
          cursor = response.data.data.next_cursor;
          if (!cursor) break;
        }
        assert.deepEqual(new Set(seen), new Set(ids));
        assert.equal(seen.length, ids.length);
        assert.equal(
          (await request(path + '?cursor=invalid', actor)).status,
          400,
        );
      }
      assert.equal(
        (await request('/api/v1/reports/daily?limit=1', staff)).status,
        403,
      );
      assert.equal(
        (await pool.query('SELECT count(*)::int n FROM daily_reports')).rows[0]
          .n,
        before,
      );
    },
  );

  await t.test(
    'ATT-007/010 cross-midnight correction validates input, RBAC, rollback and immutable seconds',
    async () => {
      const shift = crypto.randomUUID();
      // Synthetic local 23:30 -> 01:30, crossing month boundary in Asia/Ho_Chi_Minh.
      const start = '2026-09-30T16:30:00.000Z',
        end = '2026-09-30T18:30:00.000Z';
      await pool.query(
        "INSERT INTO attendance_shifts(id,workspace_id,employee_id,clock_in_at,run_state) VALUES($1,$2,$3,$4,'working')",
        [shift, workspace, staff.employee, start],
      );
      await pool.query(
        'INSERT INTO attendance_breaks(workspace_id,shift_id,started_at,ended_at,unpaid) VALUES($1,$2,$3,$4,true)',
        [workspace, shift, '2026-09-30T16:50:00Z', '2026-09-30T17:10:00Z'],
      );
      const created = await request(
        `/api/v1/attendance/shifts/${shift}/correction-requests`,
        staff,
        { reason: 'Synthetic missed clock-out', claimed_clock_out_at: end },
      );
      assert.equal(created.status, 201);
      const path = `/api/v1/attendance/correction-requests/${created.data.data.id}/decide`;
      const decision = {
        decision: 'accept',
        reason: 'Synthetic supervisor verification',
        clock_out_at: end,
      };
      assert.equal((await request(path, staff, decision)).status, 403);
      const before = (
        await pool.query(
          'SELECT status FROM attendance_correction_requests WHERE id=$1',
          [created.data.data.id],
        )
      ).rows[0];
      // Anty's 121612a handoff example differs from the implemented C01 DTO.
      // Keep the existing endpoint contract; prove the documented payload fails closed.
      assert.equal(
        (
          await request(path, owner, {
            decision: 'approved',
            reviewer_notes: 'Synthetic handoff example',
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request(path, owner, {
            ...decision,
            clock_out_at: '2026-09-30T16:00:00Z',
          })
        ).status,
        400,
      );
      assert.deepEqual(
        (
          await pool.query(
            'SELECT status FROM attendance_correction_requests WHERE id=$1',
            [created.data.data.id],
          )
        ).rows[0],
        before,
      );
      assert.equal(
        (
          await pool.query(
            'SELECT count(*)::int n FROM attendance_shift_versions WHERE shift_id=$1',
            [shift],
          )
        ).rows[0].n,
        0,
      );
      assert.equal((await request(path, owner, decision)).status, 200);
      const version = (
        await pool.query(
          'SELECT worked_seconds,clock_in_at,clock_out_at FROM attendance_shift_versions WHERE shift_id=$1',
          [shift],
        )
      ).rows[0];
      assert.equal(Number(version.worked_seconds), 6000);
      assert.equal(version.clock_in_at.toISOString(), start);
      assert.equal(version.clock_out_at.toISOString(), end);
      const history = await request('/api/v1/attendance/me', staff);
      assert.equal(history.status, 200);
      assert.equal(
        history.data.data.recent_shifts.find((row) => row.id === shift)
          .worked_seconds,
        6000,
      );
      await assert.rejects(
        pool.query(
          'UPDATE attendance_shift_versions SET worked_seconds=0 WHERE shift_id=$1',
          [shift],
        ),
        /immutable|prohibited|append.only/i,
      );
      await assert.rejects(
        pool.query('DELETE FROM attendance_shift_versions WHERE shift_id=$1', [
          shift,
        ]),
        /immutable|prohibited|append.only/i,
      );
      assert.equal(
        Number(
          (
            await pool.query(
              'SELECT worked_seconds FROM attendance_shift_versions WHERE shift_id=$1',
              [shift],
            )
          ).rows[0].worked_seconds,
        ),
        6000,
      );
    },
  );

  await t.test(
    'AUDIT-005 audit_events is append-only: database trigger prohibits UPDATE and DELETE',
    async () => {
      const auditId = crypto.randomUUID();
      await pool.query(
        "INSERT INTO audit_events(id,workspace_id,actor_user_id,action,entity_type,entity_id,request_id,metadata_sanitized) VALUES($1,$2,$3,'AUDIT_TEST','test_entity','e-verify','req-verify','{}')",
        [auditId, workspace, owner.id],
      );
      await assert.rejects(
        pool.query("UPDATE audit_events SET action='TAMPERED' WHERE id=$1", [
          auditId,
        ]),
        /audit_events is append-only: UPDATE operation prohibited/i,
      );
      await assert.rejects(
        pool.query('DELETE FROM audit_events WHERE id=$1', [auditId]),
        /audit_events is append-only: DELETE operation prohibited/i,
      );
      const row = (
        await pool.query('SELECT action FROM audit_events WHERE id=$1', [
          auditId,
        ])
      ).rows[0];
      assert.equal(row.action, 'AUDIT_TEST');
    },
  );
});
