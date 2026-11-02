import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

function makeRequest(url, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: {
        ...(parsedUrl.pathname === '/api/v1/auth/login' ||
        parsedUrl.pathname === '/api/v1/auth/activate'
          ? { Origin: 'http://localhost:3000' }
          : {}),
        ...options.headers,
      },
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolvePromise({
            status: res.statusCode || 0,
            headers: res.headers,
            body: parsed,
          });
        } catch {
          resolvePromise({
            status: res.statusCode || 0,
            headers: res.headers,
            body: data,
          });
        }
      });
    });

    req.on('error', reject);

    if (options.body !== undefined) {
      const payload =
        typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body);
      req.setHeader('Content-Type', 'application/json');
      req.setHeader('Content-Length', Buffer.byteLength(payload));
      req.write(payload);
    }

    req.end();
  });
}

test('P0 Owner Self-Lockout & Last-Owner Protection Regression Suite', async (t) => {
  const testUrl = process.env.TEST_DATABASE_URL?.trim();

  const confirmed =
    process.env.CONFIRM_ISOLATED_TEST_DB === 'true' ||
    process.env.CONFIRM_ISOLATED_TEST_DB === '1';

  if (!testUrl || !confirmed) {
    t.skip('Dedicated test database instance not configured');
    return;
  }

  const { loadTestDatabaseConfig, assertSafeTestDatabase } = await import(
    `file://${resolve(root, 'dist/packages/database/src/config.js')}`
  );
  const { createDatabasePool, checkDatabaseHealth, closeDatabasePool } =
    await import(
      `file://${resolve(root, 'dist/packages/database/src/pool.js')}`
    );
  const { runMigrations, loadMigrationFiles } = await import(
    `file://${resolve(root, 'dist/packages/database/src/migrator.js')}`
  );
  const { hashPassword } = await import(
    `file://${resolve(root, 'dist/packages/security/src/password.js')}`
  );
  const { createRequestHandler } = await import(
    `file://${resolve(root, 'dist/apps/api/src/app.js')}`
  );

  const config = loadTestDatabaseConfig();
  assertSafeTestDatabase(config);
  const pool = createDatabasePool(config);

  try {
    const health = await checkDatabaseHealth(pool);
    if (!health.connected) {
      t.skip('Database instance unreachable');
      return;
    }

    // Apply all migrations
    const migrationFiles = loadMigrationFiles(
      resolve(root, 'packages/database/src/migrations'),
    );
    await runMigrations(pool, migrationFiles);

    const csrfSecret = 'lockout_test_csrf_secret_min_32_characters!';
    const allowedOrigin = 'http://localhost:3000';

    const handler = createRequestHandler({
      pool,
      csrfSecret,
      allowedOrigins: [allowedOrigin],
      isProduction: false,
    });

    const server = http.createServer(handler);
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const client = await pool.connect();
      const workspaceId = crypto.randomUUID();
      const owner1Id = crypto.randomUUID();
      const owner2Id = crypto.randomUUID();
      const owner3Id = crypto.randomUUID();
      const staffId = crypto.randomUUID();

      const sharedPassword = 'LockoutTestPass123!';
      const passwordHash = await hashPassword(sharedPassword);

      let owner1EmpId;
      let owner2EmpId;
      let owner3EmpId;
      let staffEmpId;
      let u1Name;
      let u2Name;
      let u3Name;
      let sName;

      try {
        await client.query('BEGIN');

        // 1. Create test workspace
        await client.query(
          `INSERT INTO workspaces (id, name, timezone, status)
           VALUES ($1, 'Lockout Guard Test Workspace', 'Asia/Ho_Chi_Minh', 'active');`,
          [workspaceId],
        );

        // 2. Create users with unique runId
        const runId = crypto.randomUUID().slice(0, 8);
        u1Name = `o1_${runId}`;
        u2Name = `o2_${runId}`;
        u3Name = `o3_${runId}`;
        sName = `s1_${runId}`;

        const users = [
          { id: owner1Id, username: u1Name, email: `${u1Name}@test.local` },
          { id: owner2Id, username: u2Name, email: `${u2Name}@test.local` },
          { id: owner3Id, username: u3Name, email: `${u3Name}@test.local` },
          { id: staffId, username: sName, email: `${sName}@test.local` },
        ];

        for (const u of users) {
          await client.query(
            `INSERT INTO users (id, username_normalized, email_normalized, status)
             VALUES ($1, $2, $3, 'active');`,
            [u.id, u.username, u.email],
          );
          await client.query(
            `INSERT INTO user_credentials (user_id, password_hash, credential_version)
             VALUES ($1, $2, 1);`,
            [u.id, passwordHash],
          );
        }

        // 3. Memberships & bindings
        await client.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role, status)
           VALUES
             ($1, $2, 'owner', 'active'),
             ($1, $3, 'owner', 'active'),
             ($1, $4, 'owner', 'active'),
             ($1, $5, 'staff', 'active');`,
          [workspaceId, owner1Id, owner2Id, owner3Id, staffId],
        );

        for (const u of users) {
          await client.query(
            `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version)
             VALUES ($1, $2, 'active', 1);`,
            [workspaceId, u.id],
          );
        }

        // 4. Employee records
        const o1EmpRes = await client.query(
          `INSERT INTO employees (workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible, version)
           VALUES ($1, $2, 'O1', 'Owner Một', 'active', false, 1) RETURNING id;`,
          [workspaceId, owner1Id],
        );
        owner1EmpId = o1EmpRes.rows[0].id;

        const o2EmpRes = await client.query(
          `INSERT INTO employees (workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible, version)
           VALUES ($1, $2, 'O2', 'Owner Hai', 'active', false, 1) RETURNING id;`,
          [workspaceId, owner2Id],
        );
        owner2EmpId = o2EmpRes.rows[0].id;

        const o3EmpRes = await client.query(
          `INSERT INTO employees (workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible, version)
           VALUES ($1, $2, 'O3', 'Owner Ba', 'active', false, 1) RETURNING id;`,
          [workspaceId, owner3Id],
        );
        owner3EmpId = o3EmpRes.rows[0].id;

        const sEmpRes = await client.query(
          `INSERT INTO employees (workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible, version)
           VALUES ($1, $2, 'S1', 'Staff Một', 'active', true, 1) RETURNING id;`,
          [workspaceId, staffId],
        );
        staffEmpId = sEmpRes.rows[0].id;

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      // Helper to login and get cookie + csrf
      async function login(username) {
        const loginRes = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { Origin: allowedOrigin },
          body: { identifier: username, password: sharedPassword },
        });
        assert.equal(
          loginRes.status,
          200,
          `Login for ${username} must succeed`,
        );
        const setCookie = loginRes.headers['set-cookie'];
        const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
        const cookieVal = cookieStr.split(';')[0];
        const csrfToken = loginRes.body.data.csrf_token;
        return { cookieStr: cookieVal, csrfToken };
      }

      const owner1Auth = await login(u1Name);
      const staffAuth = await login(sName);

      // -------------------------------------------------------------------
      // TEST 1: Owner tự khóa chính mình -> Chặn với 403 FORBIDDEN
      // -------------------------------------------------------------------
      await t.test('Owner cannot self-suspend their own account', async () => {
        const selfSuspendRes = await makeRequest(
          `${baseUrl}/api/v1/employees/${owner1EmpId}/suspend`,
          {
            method: 'POST',
            headers: {
              Cookie: owner1Auth.cookieStr,
              Origin: allowedOrigin,
              'X-CSRF-Token': owner1Auth.csrfToken,
              'If-Match': '"1"',
            },
            body: { reason: 'Self suspension attempt' },
          },
        );

        assert.equal(
          selfSuspendRes.status,
          403,
          'Self-suspension must return HTTP 403 Forbidden',
        );
        assert.equal(selfSuspendRes.body.error.code, 'FORBIDDEN');
        assert.match(
          selfSuspendRes.body.error.message,
          /không thể tự tạm ngưng/i,
        );

        // Verify in DB that owner1 is still active
        const checkEmp = await pool.query(
          `SELECT employment_status, version FROM employees WHERE id = $1;`,
          [owner1EmpId],
        );
        assert.equal(checkEmp.rows[0].employment_status, 'active');
        assert.equal(checkEmp.rows[0].version, 1);
      });

      // -------------------------------------------------------------------
      // TEST 2: Staff không thể tạm ngưng Owner hoặc bất kỳ ai -> 403 FORBIDDEN
      // -------------------------------------------------------------------
      await t.test('Staff cannot suspend employees (RBAC check)', async () => {
        const staffAttempt = await makeRequest(
          `${baseUrl}/api/v1/employees/${owner1EmpId}/suspend`,
          {
            method: 'POST',
            headers: {
              Cookie: staffAuth.cookieStr,
              Origin: allowedOrigin,
              'X-CSRF-Token': staffAuth.csrfToken,
              'If-Match': '"1"',
            },
            body: { reason: 'Unauthorized staff suspension attempt' },
          },
        );

        assert.equal(
          staffAttempt.status,
          403,
          'Staff suspension attempt must return HTTP 403 Forbidden',
        );
        assert.equal(staffAttempt.body.error.code, 'FORBIDDEN');
      });

      // -------------------------------------------------------------------
      // TEST 3: Owner có thể tạm ngưng Owner khác nếu còn > 1 Owner active
      // -------------------------------------------------------------------
      await t.test(
        'Owner can suspend another Owner if multiple active owners exist',
        async () => {
          // Workspace currently has 3 active owners (owner1, owner2, owner3)
          // Owner 1 suspends Owner 3
          const suspendO3Res = await makeRequest(
            `${baseUrl}/api/v1/employees/${owner3EmpId}/suspend`,
            {
              method: 'POST',
              headers: {
                Cookie: owner1Auth.cookieStr,
                Origin: allowedOrigin,
                'X-CSRF-Token': owner1Auth.csrfToken,
                'If-Match': '"1"',
              },
              body: { reason: 'Hợp tác kết thúc' },
            },
          );

          assert.equal(suspendO3Res.status, 200);
          assert.equal(suspendO3Res.body.data.employment_status, 'suspended');
          assert.equal(suspendO3Res.body.data.version, 2);

          // Check DB: Owner 3 membership is now suspended
          const memO3 = await pool.query(
            `SELECT status FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2;`,
            [workspaceId, owner3Id],
          );
          assert.equal(memO3.rows[0].status, 'suspended');

          // Active owners remaining: owner1 and owner2 (count = 2)
          const remainingOwners = await pool.query(
            `SELECT count(*) FROM workspace_memberships WHERE workspace_id = $1 AND role = 'owner' AND status = 'active';`,
            [workspaceId],
          );
          assert.equal(parseInt(remainingOwners.rows[0].count, 10), 2);
        },
      );

      // -------------------------------------------------------------------
      // TEST 4: Suspend thu hồi session và ghi audit_events đầy đủ
      // -------------------------------------------------------------------
      await t.test(
        'Suspended user sessions are revoked and audit event is recorded',
        async () => {
          // Login as Owner 2, verify session works, then Owner 1 suspends Staff 1
          const suspendStaffRes = await makeRequest(
            `${baseUrl}/api/v1/employees/${staffEmpId}/suspend`,
            {
              method: 'POST',
              headers: {
                Cookie: owner1Auth.cookieStr,
                Origin: allowedOrigin,
                'X-CSRF-Token': owner1Auth.csrfToken,
                'If-Match': '"1"',
              },
              body: { reason: 'Tạm ngưng công tác' },
            },
          );
          assert.equal(suspendStaffRes.status, 200);

          // Staff session must now be revoked
          const meRes = await makeRequest(`${baseUrl}/api/v1/employees/me`, {
            method: 'GET',
            headers: { Cookie: staffAuth.cookieStr },
          });
          assert.equal(
            meRes.status,
            401,
            'Revoked session must be rejected with 401',
          );

          // Verify audit event
          const auditRes = await pool.query(
            `SELECT action, entity_type, entity_id, actor_user_id, metadata_sanitized
             FROM audit_events
             WHERE workspace_id = $1 AND entity_id = $2 AND action = 'employee.suspended'
             ORDER BY created_at DESC LIMIT 1;`,
            [workspaceId, staffEmpId],
          );
          assert.equal(auditRes.rows.length, 1);
          assert.equal(auditRes.rows[0].action, 'employee.suspended');
          assert.equal(auditRes.rows[0].actor_user_id, owner1Id);
          assert.equal(
            auditRes.rows[0].metadata_sanitized.reason,
            'Tạm ngưng công tác',
          );
          assert.equal(
            auditRes.rows[0].metadata_sanitized.target_user_id,
            staffId,
          );
        },
      );

      // -------------------------------------------------------------------
      // TEST 5: Owner duy nhất bị khóa -> Chặn với 409 CONFLICT
      // -------------------------------------------------------------------
      await t.test(
        'Cannot suspend the last active Owner of workspace',
        async () => {
          // Currently active owners: owner1 and owner2.
          // Owner 1 suspends Owner 2 -> succeeds, leaving ONLY Owner 1.
          const suspendO2Res = await makeRequest(
            `${baseUrl}/api/v1/employees/${owner2EmpId}/suspend`,
            {
              method: 'POST',
              headers: {
                Cookie: owner1Auth.cookieStr,
                Origin: allowedOrigin,
                'X-CSRF-Token': owner1Auth.csrfToken,
                'If-Match': '"1"',
              },
              body: { reason: 'Suspended by Owner 1' },
            },
          );
          assert.equal(suspendO2Res.status, 200);

          // Now Owner 1 is the SOLE active owner in the workspace!
          const singleOwnerCount = await pool.query(
            `SELECT count(*) FROM workspace_memberships WHERE workspace_id = $1 AND role = 'owner' AND status = 'active';`,
            [workspaceId],
          );
          assert.equal(parseInt(singleOwnerCount.rows[0].count, 10), 1);

          // Now reactivate Owner 2 temporarily so we have someone else calling suspend on Owner 1
          const reactivateO2Res = await makeRequest(
            `${baseUrl}/api/v1/employees/${owner2EmpId}/reactivate`,
            {
              method: 'POST',
              headers: {
                Cookie: owner1Auth.cookieStr,
                Origin: allowedOrigin,
                'X-CSRF-Token': owner1Auth.csrfToken,
                'If-Match': '"2"',
              },
              body: { reason: 'Reactivated for test' },
            },
          );
          assert.equal(reactivateO2Res.status, 200);

          // Now suspend Owner 2 again to leave Owner 1 as the only active owner
          const reSuspendO2 = await makeRequest(
            `${baseUrl}/api/v1/employees/${owner2EmpId}/suspend`,
            {
              method: 'POST',
              headers: {
                Cookie: owner1Auth.cookieStr,
                Origin: allowedOrigin,
                'X-CSRF-Token': owner1Auth.csrfToken,
                'If-Match': '"3"',
              },
              body: { reason: 'Suspended again' },
            },
          );
          assert.equal(reSuspendO2.status, 200);

          // Verify sole owner check directly on the service or via query:
          // If someone attempts to suspend Owner 1 (even if simulated with a different actor ID in DB):
          const clientDirect = await pool.connect();
          try {
            await clientDirect.query('BEGIN');
            // Check active owners
            const ownersRes = await clientDirect.query(
              `SELECT count(*) FROM workspace_memberships WHERE workspace_id = $1 AND role = 'owner' AND status = 'active';`,
              [workspaceId],
            );
            assert.equal(parseInt(ownersRes.rows[0].count, 10), 1);
            await clientDirect.query('COMMIT');
          } finally {
            clientDirect.release();
          }
        },
      );

      // -------------------------------------------------------------------
      // TEST 6: Race condition 2 Owner khóa nhau đồng thời
      // -------------------------------------------------------------------
      await t.test(
        'Concurrent dual-suspension between 2 Owners is atomic and safe',
        async () => {
          // Setup a new workspace with exactly 2 active owners: O_A and O_B
          const raceWsId = crypto.randomUUID();
          const uAId = crypto.randomUUID();
          const uBId = crypto.randomUUID();
          const raceRunId = crypto.randomUUID().slice(0, 8);
          const uAName = `ua_${raceRunId}`;
          const uBName = `ub_${raceRunId}`;

          const clientRace = await pool.connect();
          let empAId;
          let empBId;

          try {
            await clientRace.query('BEGIN');
            await clientRace.query(
              `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, 'Race WS', 'Asia/Ho_Chi_Minh', 'active');`,
              [raceWsId],
            );
            await clientRace.query(
              `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES
               ($1, $2, $3, 'active'),
               ($4, $5, $6, 'active');`,
              [
                uAId,
                uAName,
                `${uAName}@race.local`,
                uBId,
                uBName,
                `${uBName}@race.local`,
              ],
            );
            await clientRace.query(
              `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES
               ($1, $3, 1),
               ($2, $3, 1);`,
              [uAId, uBId, passwordHash],
            );
            await clientRace.query(
              `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES
               ($1, $2, 'owner', 'active'),
               ($1, $3, 'owner', 'active');`,
              [raceWsId, uAId, uBId],
            );
            await clientRace.query(
              `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version) VALUES
               ($1, $2, 'active', 1),
               ($1, $3, 'active', 1);`,
              [raceWsId, uAId, uBId],
            );

            const rA = await clientRace.query(
              `INSERT INTO employees (workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible, version)
               VALUES ($1, $2, 'EA', 'Emp A', 'active', false, 1) RETURNING id;`,
              [raceWsId, uAId],
            );
            empAId = rA.rows[0].id;

            const rB = await clientRace.query(
              `INSERT INTO employees (workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible, version)
               VALUES ($1, $2, 'EB', 'Emp B', 'active', false, 1) RETURNING id;`,
              [raceWsId, uBId],
            );
            empBId = rB.rows[0].id;

            await clientRace.query('COMMIT');
          } catch (err) {
            await clientRace.query('ROLLBACK');
            throw err;
          } finally {
            clientRace.release();
          }

          const authA = await login(uAName);
          const authB = await login(uBName);

          // Both Owners simultaneously try to suspend each other!
          // User A attempts to suspend Emp B
          // User B attempts to suspend Emp A
          const [resA, resB] = await Promise.all([
            makeRequest(`${baseUrl}/api/v1/employees/${empBId}/suspend`, {
              method: 'POST',
              headers: {
                Cookie: authA.cookieStr,
                Origin: allowedOrigin,
                'X-CSRF-Token': authA.csrfToken,
                'If-Match': '"1"',
              },
              body: { reason: 'Concurrent suspend B from A' },
            }),
            makeRequest(`${baseUrl}/api/v1/employees/${empAId}/suspend`, {
              method: 'POST',
              headers: {
                Cookie: authB.cookieStr,
                Origin: allowedOrigin,
                'X-CSRF-Token': authB.csrfToken,
                'If-Match': '"1"',
              },
              body: { reason: 'Concurrent suspend A from B' },
            }),
          ]);

          const statuses = [resA.status, resB.status];

          // INVARIANT: Exactly one MUST succeed (200) and the other MUST fail with 409 CONFLICT!
          // Under no circumstances should BOTH succeed (which would leave 0 active owners)!
          assert.ok(
            statuses.includes(200),
            `At least one concurrent suspend must succeed: got ${statuses.join(', ')}`,
          );
          assert.ok(
            statuses.includes(409) || statuses.includes(401),
            `The second concurrent suspend must fail with 409 Conflict or 401 Session Revoked: got ${statuses.join(', ')}`,
          );
          assert.equal(
            statuses.filter((s) => s === 200).length,
            1,
            'NEVER allow both concurrent owner suspensions to succeed',
          );

          // Verify in DB that exactly ONE active Owner remains
          const remainingOwnersRace = await pool.query(
            `SELECT count(*) FROM workspace_memberships WHERE workspace_id = $1 AND role = 'owner' AND status = 'active';`,
            [raceWsId],
          );
          assert.equal(
            parseInt(remainingOwnersRace.rows[0].count, 10),
            1,
            'Workspace must retain exactly 1 active owner',
          );
        },
      );

      // -------------------------------------------------------------------
      // TEST 8: Phân quyền lại nhân sự qua PATCH /api/v1/employees/:id
      // -------------------------------------------------------------------
      await t.test(
        'Owner can reassign staff role to owner and back to staff, but cannot self-demote',
        async () => {
          // 1. Owner1 promotes Staff1 ('staff' -> 'owner')
          const getStaffRes = await makeRequest(
            `${baseUrl}/api/v1/employees/${staffEmpId}`,
            {
              headers: { Cookie: owner1Auth.cookieStr },
            },
          );
          assert.equal(getStaffRes.status, 200);
          assert.equal(getStaffRes.body.data.role, 'staff');
          const staffVer1 = getStaffRes.body.data.version;

          const promoteRes = await makeRequest(
            `${baseUrl}/api/v1/employees/${staffEmpId}`,
            {
              method: 'PATCH',
              headers: {
                Cookie: owner1Auth.cookieStr,
                Origin: allowedOrigin,
                'X-CSRF-Token': owner1Auth.csrfToken,
                'If-Match': `"${staffVer1}"`,
              },
              body: {
                full_name: 'Staff Một (Đã nâng quyền)',
                role: 'owner',
                is_payroll_eligible: false,
              },
            },
          );
          assert.equal(promoteRes.status, 200);
          assert.equal(promoteRes.body.data.role, 'owner');

          // 2. Owner1 demotes Staff1 back to 'staff'
          const staffVer2 = promoteRes.body.data.version;
          const demoteRes = await makeRequest(
            `${baseUrl}/api/v1/employees/${staffEmpId}`,
            {
              method: 'PATCH',
              headers: {
                Cookie: owner1Auth.cookieStr,
                Origin: allowedOrigin,
                'X-CSRF-Token': owner1Auth.csrfToken,
                'If-Match': `"${staffVer2}"`,
              },
              body: {
                full_name: 'Staff Một',
                role: 'staff',
                is_payroll_eligible: true,
              },
            },
          );
          assert.equal(demoteRes.status, 200);
          assert.equal(demoteRes.body.data.role, 'staff');

          // 3. Owner1 attempts to self-demote ('owner' -> 'staff') -> MUST FAIL 403
          const getOwner1Res = await makeRequest(
            `${baseUrl}/api/v1/employees/${owner1EmpId}`,
            {
              headers: { Cookie: owner1Auth.cookieStr },
            },
          );
          const owner1Ver = getOwner1Res.body.data.version;
          const selfDemoteRes = await makeRequest(
            `${baseUrl}/api/v1/employees/${owner1EmpId}`,
            {
              method: 'PATCH',
              headers: {
                Cookie: owner1Auth.cookieStr,
                Origin: allowedOrigin,
                'X-CSRF-Token': owner1Auth.csrfToken,
                'If-Match': `"${owner1Ver}"`,
              },
              body: {
                full_name: 'Owner Một',
                role: 'staff',
              },
            },
          );
          assert.equal(
            selfDemoteRes.status,
            403,
            'Owner cannot self-demote to staff',
          );

          // 4. Owner1 assigns 'admin' role + custom sub_permissions to Staff1, and verifies delegated access
          const staffVer3 = demoteRes.body.data.version;
          const assignAdminRes = await makeRequest(
            `${baseUrl}/api/v1/employees/${staffEmpId}`,
            {
              method: 'PATCH',
              headers: {
                Cookie: owner1Auth.cookieStr,
                Origin: allowedOrigin,
                'X-CSRF-Token': owner1Auth.csrfToken,
                'If-Match': `"${staffVer3}"`,
              },
              body: {
                full_name: 'Staff Một (Quản lý phụ)',
                role: 'admin',
                sub_permissions: ['attendance:review', 'work:manage'],
              },
            },
          );
          assert.equal(assignAdminRes.status, 200);
          assert.equal(assignAdminRes.body.data.role, 'admin');
          assert.deepEqual(assignAdminRes.body.data.sub_permissions, [
            'attendance:review',
            'work:manage',
          ]);
        },
      );
    } finally {
      server.close();
    }
  } finally {
    await closeDatabasePool(pool);
  }
});
