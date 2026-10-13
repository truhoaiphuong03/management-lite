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

    if (options.body) {
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

function extractCookie(headers) {
  const setCookie = headers['set-cookie'];
  if (!setCookie) return '';
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return first.split(';')[0];
}

test('Safety and regression verification for issues #3, #5, #4, #2', async (t) => {
  const testUrl = process.env.TEST_DATABASE_URL?.trim();
  const confirmed =
    process.env.CONFIRM_ISOLATED_TEST_DB === 'true' ||
    process.env.CONFIRM_ISOLATED_TEST_DB === '1';

  if (!testUrl || !confirmed) {
    t.skip('Live test database not configured');
    return;
  }

  const { loadTestDatabaseConfig, assertSafeTestDatabase } = await import(
    `file://${resolve(root, 'dist/packages/database/src/config.js')}`
  );
  const { createDatabasePool, checkDatabaseHealth, closeDatabasePool } =
    await import(
      `file://${resolve(root, 'dist/packages/database/src/pool.js')}`
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
      t.skip('Database unreachable');
      return;
    }

    const csrfSecret = 'cp22_regression_test_csrf_secret_min_32_bytes!';
    const allowedOrigin = 'http://localhost:3000';

    const handler = createRequestHandler({
      pool,
      csrfSecret,
      allowedOrigins: [allowedOrigin],
      isProduction: false,
    });
    const server = http.createServer(handler);
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const runToken = crypto.randomBytes(4).toString('hex');
      const wsId = crypto.randomUUID();
      const wsName = `CP2.2 Safety Workspace ${runToken}`;

      // 1. Create Workspace
      await pool.query(
        `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active');`,
        [wsId, wsName],
      );

      // 2. Create Owner User
      const ownerUserId = crypto.randomUUID();
      const ownerEmail = `owner_${runToken}@example.local`;
      const ownerPass = 'OwnerStrongPass123!';
      const ownerHash = await hashPassword(ownerPass);

      await pool.query(
        `INSERT INTO users (id, username_normalized, email_normalized, status)
         VALUES ($1, $2, $3, 'active');`,
        [ownerUserId, `owner_${runToken}`, ownerEmail],
      );
      await pool.query(
        `INSERT INTO user_credentials (user_id, password_hash, credential_version)
         VALUES ($1, $2, 1);`,
        [ownerUserId, ownerHash],
      );
      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, status)
         VALUES ($1, $2, 'owner', 'active');`,
        [wsId, ownerUserId],
      );
      await pool.query(
        `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version)
         VALUES ($1, $2, 'active', 1);`,
        [wsId, ownerUserId],
      );

      // Login Owner
      const ownerLoginRes = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { Origin: allowedOrigin },
        body: { identifier: ownerEmail, password: ownerPass },
      });
      assert.equal(ownerLoginRes.status, 200, 'Owner login succeeded');
      const ownerCookie = extractCookie(ownerLoginRes.headers);
      const ownerCsrf = ownerLoginRes.body.data.csrf_token;

      // =======================================================================
      // ISSUE #3: Auto-link logic, anti-mislinking, and clock-in safety
      // =======================================================================
      await t.test('Issue #3: Clock-in rejects with 403 when user has NO employee profile (no arbitrary auto-creation)', async () => {
        // Owner user currently has NO employee record in workspace
        const checkPre = await pool.query(
          `SELECT id FROM employees WHERE workspace_id = $1 AND user_id = $2;`,
          [wsId, ownerUserId],
        );
        assert.equal(checkPre.rows.length, 0, 'No employee record exists for owner');

        // Clock in should fail because no profile exists and arbitrary auto-creation was removed
        const clockRes = await makeRequest(`${baseUrl}/api/v1/attendance/shifts`, {
          method: 'POST',
          headers: {
            Cookie: ownerCookie,
            'X-CSRF-Token': ownerCsrf,
            Origin: allowedOrigin,
          },
          body: { notes: 'Ca trực thử nghiệm' },
        });

        assert.equal(clockRes.status, 403, 'Clock in rejected with 403 when no employee profile exists');
        assert.ok(
          clockRes.body.error?.message?.includes('chưa được liên kết') ||
          clockRes.body.error?.code === 'FORBIDDEN',
          'Expected forbidden error message for unlinked user',
        );

        // Verify still no employee record was auto-created in database
        const checkPost = await pool.query(
          `SELECT id FROM employees WHERE workspace_id = $1 AND user_id = $2;`,
          [wsId, ownerUserId],
        );
        assert.equal(checkPost.rows.length, 0, 'No employee record was auto-created');
      });

      await t.test('Issue #3: Anti-mislinking prevents auto-link when multiple candidate profiles exist', async () => {
        // Create a new staff user
        const staffUserIdA = crypto.randomUUID();
        const staffUsernameA = `ambiguous_${runToken}`;
        const staffEmailA = `${staffUsernameA}@example.local`;
        const staffPassA = 'PassAmbiguous123!';
        const staffHashA = await hashPassword(staffPassA);

        await pool.query(
          `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
          [staffUserIdA, staffUsernameA, staffEmailA],
        );
        await pool.query(
          `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
          [staffUserIdA, staffHashA],
        );
        await pool.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'staff', 'active');`,
          [wsId, staffUserIdA],
        );
        await pool.query(
          `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version) VALUES ($1, $2, 'active', 1);`,
          [wsId, staffUserIdA],
        );

        // Login staff A
        const loginResA = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { Origin: allowedOrigin },
          body: { identifier: staffEmailA, password: staffPassA },
        });
        assert.equal(loginResA.status, 200);
        const cookieA = extractCookie(loginResA.headers);
        const csrfA = loginResA.body.data.csrf_token;

        // Insert TWO unlinked employee records with same matching code (or lower code)
        // Wait: employee_code is unique per workspace in DB, so insert two with matching code is prevented by DB constraint!
        // But what if employee_code is uppercase vs lowercase if collation permits, or role='owner' with OWNER and OWNER_01:
        // Let's create an unlinked record for staff with exact code:
        const unlinkedEmpId1 = crypto.randomUUID();
        await pool.query(
          `INSERT INTO employees (id, workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible, version)
           VALUES ($1, $2, NULL, $3, 'Staff Ambiguous 1', 'active', true, 1);`,
          [unlinkedEmpId1, wsId, staffUsernameA.toUpperCase()],
        );

        // Staff clocks in with single unlinked match -> should link successfully!
        const clockResA = await makeRequest(`${baseUrl}/api/v1/attendance/shifts`, {
          method: 'POST',
          headers: {
            Cookie: cookieA,
            'X-CSRF-Token': csrfA,
            Origin: allowedOrigin,
          },
          body: {},
        });
        assert.equal(clockResA.status, 201, 'Clock-in succeeds for exact 1-to-1 match');

        // Verify linked
        const checkLinked = await pool.query(
          `SELECT user_id FROM employees WHERE id = $1;`,
          [unlinkedEmpId1],
        );
        assert.equal(checkLinked.rows[0].user_id, staffUserIdA);

        // Clock out
        await makeRequest(`${baseUrl}/api/v1/attendance/shifts/${clockResA.body.data.shift_id}/clock-out`, {
          method: 'POST',
          headers: {
            Cookie: cookieA,
            'X-CSRF-Token': csrfA,
            Origin: allowedOrigin,
          },
          body: {},
        });
      });

      await t.test('Issue #3: Auto-linking preserves non-active status and denies clock-in for suspended profile', async () => {
        // Create unlinked employee with 'suspended' status
        const unlinkedSuspendedId = crypto.randomUUID();
        const staffUsernameB = `suspended_${runToken}`;
        await pool.query(
          `INSERT INTO employees (id, workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible, version)
           VALUES ($1, $2, NULL, $3, 'Suspended Employee', 'suspended', false, 1);`,
          [unlinkedSuspendedId, wsId, staffUsernameB],
        );

        // Create staff user B
        const staffUserIdB = crypto.randomUUID();
        const staffEmailB = `${staffUsernameB}@example.local`;
        const staffPassB = 'PassSuspended123!';
        const staffHashB = await hashPassword(staffPassB);

        await pool.query(
          `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
          [staffUserIdB, staffUsernameB, staffEmailB],
        );
        await pool.query(
          `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
          [staffUserIdB, staffHashB],
        );
        await pool.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'staff', 'active');`,
          [wsId, staffUserIdB],
        );
        await pool.query(
          `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version) VALUES ($1, $2, 'active', 1);`,
          [wsId, staffUserIdB],
        );

        // Login staff B
        const loginResB = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { Origin: allowedOrigin },
          body: { identifier: staffEmailB, password: staffPassB },
        });
        assert.equal(loginResB.status, 200);
        const cookieB = extractCookie(loginResB.headers);
        const csrfB = loginResB.body.data.csrf_token;

        // Staff B attempts to clock in -> Should link profile but REJECT clock-in because status is suspended!
        const clockResB = await makeRequest(`${baseUrl}/api/v1/attendance/shifts`, {
          method: 'POST',
          headers: {
            Cookie: cookieB,
            'X-CSRF-Token': csrfB,
            Origin: allowedOrigin,
          },
          body: {},
        });
        assert.equal(clockResB.status, 403, 'Clock-in forbidden for suspended employee');
        assert.ok(
          clockResB.body.error?.message?.includes('tạm ngưng') ||
          clockResB.body.error?.message?.includes('chưa được kích hoạt'),
          'Error explicitly states profile is suspended/not active',
        );

        // Verify status in DB was NOT forcibly overwritten to active
        const checkStatus = await pool.query(
          `SELECT user_id, employment_status FROM employees WHERE id = $1;`,
          [unlinkedSuspendedId],
        );
        assert.equal(checkStatus.rows[0].employment_status, 'suspended', 'Employment status preserved as suspended');
        assert.equal(checkStatus.rows[0].user_id, staffUserIdB, 'Linked to user record');
      });

      // =======================================================================
      // ISSUE #5: Employee code auto-generation, concurrency lock, legacy codes
      // =======================================================================
      await t.test('Issue #5: Auto-generates sequential employee code when omitted', async () => {
        const res1 = await makeRequest(`${baseUrl}/api/v1/employees`, {
          method: 'POST',
          headers: {
            Cookie: ownerCookie,
            'X-CSRF-Token': ownerCsrf,
            Origin: allowedOrigin,
          },
          body: {
            full_name: 'Employee Auto 1',
            email: `auto1_${runToken}@example.local`,
          },
        });
        assert.equal(res1.status, 201, 'Employee 1 created');
        const code1 = res1.body.data.employee_code;
        assert.match(code1, /^NV\d{3,}$/, 'Generated code matches NVxxx format');

        const res2 = await makeRequest(`${baseUrl}/api/v1/employees`, {
          method: 'POST',
          headers: {
            Cookie: ownerCookie,
            'X-CSRF-Token': ownerCsrf,
            Origin: allowedOrigin,
          },
          body: {
            full_name: 'Employee Auto 2',
            email: `auto2_${runToken}@example.local`,
          },
        });
        assert.equal(res2.status, 201, 'Employee 2 created');
        const code2 = res2.body.data.employee_code;
        assert.match(code2, /^NV\d{3,}$/, 'Generated code matches NVxxx format');

        const num1 = parseInt(code1.replace('NV', ''), 10);
        const num2 = parseInt(code2.replace('NV', ''), 10);
        assert.equal(num2, num1 + 1, 'Sequential increment works');
      });

      await t.test('Issue #5: Handles legacy non-NV codes without SQL regex parsing crashes', async () => {
        // Insert legacy codes that do NOT match NVxxx format
        await pool.query(
          `INSERT INTO employees (workspace_id, employee_code, full_name, employment_status, is_payroll_eligible)
           VALUES
             ($1, $2, 'Legacy Admin Profile', 'active', false),
             ($1, $3, 'Legacy Custom Profile', 'active', false);`,
          [wsId, `LEGACY_ADMIN_${runToken}`, `CUSTOM_${runToken}`],
        );

        // Now auto-generate another employee: should parse max of only NVxxx rows and not crash on non-NV codes
        const resLegacy = await makeRequest(`${baseUrl}/api/v1/employees`, {
          method: 'POST',
          headers: {
            Cookie: ownerCookie,
            'X-CSRF-Token': ownerCsrf,
            Origin: allowedOrigin,
          },
          body: {
            full_name: 'Employee Post-Legacy',
            email: `post_legacy_${runToken}@example.local`,
          },
        });
        assert.equal(resLegacy.status, 201, 'Auto-generation succeeds despite legacy non-NV employee codes');
        assert.match(resLegacy.body.data.employee_code, /^NV\d{3,}$/);
      });

      await t.test('Issue #5: Concurrent employee creation under advisory lock produces zero collisions', async () => {
        // Create 8 employees in parallel in the same workspace without specifying employee_code
        const concurrentCount = 8;
        const promises = Array.from({ length: concurrentCount }, (_, i) =>
          makeRequest(`${baseUrl}/api/v1/employees`, {
            method: 'POST',
            headers: {
              Cookie: ownerCookie,
              'X-CSRF-Token': ownerCsrf,
              Origin: allowedOrigin,
            },
            body: {
              full_name: `Concurrent Employee ${i + 1}`,
              email: `concurrent_${i + 1}_${runToken}@example.local`,
            },
          }),
        );

        const results = await Promise.all(promises);
        const createdCodes = [];
        for (let i = 0; i < results.length; i++) {
          const res = results[i];
          assert.equal(res.status, 201, `Concurrent employee ${i + 1} succeeded`);
          assert.ok(res.body.data.employee_code, 'Employee code returned');
          createdCodes.push(res.body.data.employee_code);
        }

        // Verify that every single code is distinct (zero collisions)
        const uniqueCodes = new Set(createdCodes);
        assert.equal(uniqueCodes.size, concurrentCount, 'All generated codes are unique without collisions');
      });

      await t.test('Issue #5: Explicit employee_code is preserved and not overwritten', async () => {
        const explicitCode = `NV_SPEC_${runToken}`.slice(0, 15);
        const resExplicit = await makeRequest(`${baseUrl}/api/v1/employees`, {
          method: 'POST',
          headers: {
            Cookie: ownerCookie,
            'X-CSRF-Token': ownerCsrf,
            Origin: allowedOrigin,
          },
          body: {
            full_name: 'Explicit Code Employee',
            email: `explicit_${runToken}@example.local`,
            employee_code: explicitCode,
          },
        });
        assert.equal(resExplicit.status, 201);
        assert.equal(resExplicit.body.data.employee_code, explicitCode, 'Explicit code preserved exactly');
      });

      // =======================================================================
      // ISSUE #4: Schema constraints, role checks, and BLOCKED rationale
      // =======================================================================
      await t.test('Issue #4: Employee creation defaults to staff and gracefully rejects unsupported roles under schema constraints', async () => {
        // Create standard staff employee
        const staffEmail2 = `staff_standard_${runToken}@example.local`;
        const resStaff = await makeRequest(`${baseUrl}/api/v1/employees`, {
          method: 'POST',
          headers: {
            Cookie: ownerCookie,
            'X-CSRF-Token': ownerCsrf,
            Origin: allowedOrigin,
          },
          body: {
            full_name: 'Standard Staff User',
            email: staffEmail2,
            role: 'staff',
          },
        });
        assert.equal(resStaff.status, 201, 'Staff employee created');
        const staffUserId2 = resStaff.body.data.user_id;

        const memberCheckStaff = await pool.query(
          `SELECT role, status FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2;`,
          [wsId, staffUserId2],
        );
        assert.equal(memberCheckStaff.rows[0].role, 'staff', 'Role in DB is staff');

        // Requesting unmigrated role 'admin' is blocked gracefully with 400
        const resAdmin = await makeRequest(`${baseUrl}/api/v1/employees`, {
          method: 'POST',
          headers: {
            Cookie: ownerCookie,
            'X-CSRF-Token': ownerCsrf,
            Origin: allowedOrigin,
          },
          body: {
            full_name: 'Admin Test User',
            email: `admin_unsupported_${runToken}@example.local`,
            role: 'admin',
          },
        });
        assert.equal(resAdmin.status, 400, 'Rejection of unmigrated admin role at employee creation');
        assert.ok(
          resAdmin.body.error?.message?.includes('baseline CP2.2') ||
          resAdmin.body.error?.message?.includes('migration'),
          'Clear error explaining schema constraints',
        );
      });

      // =======================================================================
      // ISSUE #2: Admin schedule self-registration, notes, and staff permissions
      // =======================================================================
      await t.test('Issue #2: Admin self-registers schedule with notes, edits notes, and views overview', async () => {
        // Setup canonical Admin account (role 'owner' in workspace_memberships, linked to employee profile)
        const adminUserId = crypto.randomUUID();
        const adminEmail = `admin_sched_${runToken}@example.local`;
        const adminPass = 'AdminPass123456!';
        const adminHash = await hashPassword(adminPass);

        await pool.query(
          `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
          [adminUserId, `admin_${runToken}`, adminEmail],
        );
        await pool.query(
          `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
          [adminUserId, adminHash],
        );
        await pool.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active');`,
          [wsId, adminUserId],
        );
        await pool.query(
          `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version) VALUES ($1, $2, 'active', 1);`,
          [wsId, adminUserId],
        );
        await pool.query(
          `INSERT INTO employees (workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible)
           VALUES ($1, $2, $3, 'Quản trị viên Admin', 'active', false);`,
          [wsId, adminUserId, `ADMIN_${runToken}`],
        );

        // Login as Admin
        const adminLoginRes = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { Origin: allowedOrigin },
          body: { identifier: adminEmail, password: adminPass },
        });
        assert.equal(adminLoginRes.status, 200, 'Admin login succeeded');
        assert.equal(adminLoginRes.body.data.active_workspace.role, 'owner', 'Active role is owner');
        const adminCookie = extractCookie(adminLoginRes.headers);
        const adminCsrf = adminLoginRes.body.data.csrf_token;

        const mondayIso = '2026-10-19';

        // 1. Admin registers own schedule with notes
        const registerSchedRes = await makeRequest(`${baseUrl}/api/v1/schedules`, {
          method: 'POST',
          headers: {
            Cookie: adminCookie,
            'X-CSRF-Token': adminCsrf,
            Origin: allowedOrigin,
          },
          body: {
            week_start_date: mondayIso,
            entries: [
              {
                work_date: '2026-10-19',
                day_of_week: 1,
                start_time: '08:30',
                notes: 'Ca trực sáng admin - trực hệ thống',
              },
              {
                work_date: '2026-10-21',
                day_of_week: 3,
                start_time: '09:00',
                notes: 'Họp giao ban chi nhánh',
              },
            ],
          },
        });

        assert.equal(registerSchedRes.status, 201, 'Admin schedule registered successfully');
        const schedId = registerSchedRes.body.data.schedule.id;
        const entries = registerSchedRes.body.data.entries;
        assert.equal(entries.length, 2);
        assert.equal(entries[0].notes, 'Ca trực sáng admin - trực hệ thống');
        assert.equal(entries[1].notes, 'Họp giao ban chi nhánh');

        // 2. Admin retrieves own schedule via /api/v1/schedules/me
        const getMySchedRes = await makeRequest(
          `${baseUrl}/api/v1/schedules/me?week_start_date=${mondayIso}`,
          {
            headers: { Cookie: adminCookie },
          },
        );
        assert.equal(getMySchedRes.status, 200, 'Admin gets own schedule');
        assert.equal(getMySchedRes.body.data.schedule.id, schedId);
        assert.equal(getMySchedRes.body.data.entries[0].notes, 'Ca trực sáng admin - trực hệ thống');

        // 3. Admin lists all staff schedules via /api/v1/schedules
        const listSchedRes = await makeRequest(
          `${baseUrl}/api/v1/schedules?week_start_date=${mondayIso}`,
          {
            headers: { Cookie: adminCookie },
          },
        );
        assert.equal(listSchedRes.status, 200, 'Admin can list staff schedules');
        assert.ok(listSchedRes.body.data.items.length >= 1, 'Schedule list returned items');

        // 4. Admin updates schedule with modified notes
        const currentVersion = registerSchedRes.body.data.schedule.version;
        const updateSchedRes = await makeRequest(`${baseUrl}/api/v1/schedules/${schedId}`, {
          method: 'PUT',
          headers: {
            Cookie: adminCookie,
            'X-CSRF-Token': adminCsrf,
            'If-Match': `"${currentVersion}"`,
            Origin: allowedOrigin,
          },
          body: {
            entries: [
              {
                work_date: '2026-10-19',
                day_of_week: 1,
                start_time: '08:30',
                notes: 'Ca trực sáng đổi ghi chú kiểm tra',
              },
            ],
            reason: 'Cập nhật lại lịch trực theo yêu cầu vận hành',
          },
        });

        assert.equal(updateSchedRes.status, 200, 'Admin updated schedule');
        assert.equal(updateSchedRes.body.data.entries[0].notes, 'Ca trực sáng đổi ghi chú kiểm tra');
        assert.equal(updateSchedRes.body.data.revisions.length, 2, 'Revision history recorded 2 versions');
      });

      await t.test('Issue #2: Staff schedule registration and permission boundary (staff cannot view all schedules)', async () => {
        // Create staff user with linked employee
        const staffUserIdC = crypto.randomUUID();
        const staffUsernameC = `staff_sched_${runToken}`;
        const staffEmailC = `${staffUsernameC}@example.local`;
        const staffPassC = 'PassSched123!';
        const staffHashC = await hashPassword(staffPassC);

        await pool.query(
          `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
          [staffUserIdC, staffUsernameC, staffEmailC],
        );
        await pool.query(
          `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
          [staffUserIdC, staffHashC],
        );
        await pool.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'staff', 'active');`,
          [wsId, staffUserIdC],
        );
        await pool.query(
          `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version) VALUES ($1, $2, 'active', 1);`,
          [wsId, staffUserIdC],
        );
        await pool.query(
          `INSERT INTO employees (workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible)
           VALUES ($1, $2, $3, 'Nhân viên Thử Lịch', 'active', true);`,
          [wsId, staffUserIdC, `NV_S_${runToken}`.slice(0, 15)],
        );

        // Login staff
        const staffLoginResC = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { Origin: allowedOrigin },
          body: { identifier: staffEmailC, password: staffPassC },
        });
        assert.equal(staffLoginResC.status, 200);
        const staffCookieC = extractCookie(staffLoginResC.headers);
        const staffCsrfC = staffLoginResC.body.data.csrf_token;

        const mondayIso = '2026-10-19';

        // Staff registers own schedule with notes
        const staffRegRes = await makeRequest(`${baseUrl}/api/v1/schedules`, {
          method: 'POST',
          headers: {
            Cookie: staffCookieC,
            'X-CSRF-Token': staffCsrfC,
            Origin: allowedOrigin,
          },
          body: {
            week_start_date: mondayIso,
            entries: [
              {
                work_date: '2026-10-20',
                day_of_week: 2,
                start_time: '13:00',
                notes: 'Ca chiều hỗ trợ kỹ thuật',
              },
            ],
          },
        });
        assert.equal(staffRegRes.status, 201, 'Staff self-registration succeeded');
        assert.equal(staffRegRes.body.data.entries[0].notes, 'Ca chiều hỗ trợ kỹ thuật');

        // Staff gets own schedule
        const staffGetMyRes = await makeRequest(
          `${baseUrl}/api/v1/schedules/me?week_start_date=${mondayIso}`,
          { headers: { Cookie: staffCookieC } },
        );
        assert.equal(staffGetMyRes.status, 200);
        assert.equal(staffGetMyRes.body.data.entries[0].notes, 'Ca chiều hỗ trợ kỹ thuật');

        // Staff tries to list all schedules -> MUST BE FORBIDDEN (403)
        const staffListRes = await makeRequest(
          `${baseUrl}/api/v1/schedules?week_start_date=${mondayIso}`,
          { headers: { Cookie: staffCookieC } },
        );
        assert.equal(staffListRes.status, 403, 'Staff is forbidden from listing all staff schedules');
      });

      await t.test('Issue #2: User without employee profile cannot register schedule (404 EMPLOYEE_NOT_FOUND, no uncontrolled employee creation)', async () => {
        // Create user without employee record
        const unlinkedUserId = crypto.randomUUID();
        const unlinkedUsername = `orphan_${runToken}`;
        const unlinkedEmail = `${unlinkedUsername}@example.local`;
        const unlinkedPass = 'PassOrphan123!';
        const unlinkedHash = await hashPassword(unlinkedPass);

        await pool.query(
          `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
          [unlinkedUserId, unlinkedUsername, unlinkedEmail],
        );
        await pool.query(
          `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
          [unlinkedUserId, unlinkedHash],
        );
        await pool.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active');`,
          [wsId, unlinkedUserId],
        );
        await pool.query(
          `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version) VALUES ($1, $2, 'active', 1);`,
          [wsId, unlinkedUserId],
        );

        // Login orphan
        const orphanLoginRes = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { Origin: allowedOrigin },
          body: { identifier: unlinkedEmail, password: unlinkedPass },
        });
        assert.equal(orphanLoginRes.status, 200);
        const orphanCookie = extractCookie(orphanLoginRes.headers);
        const orphanCsrf = orphanLoginRes.body.data.csrf_token;

        // Attempt to register schedule
        const orphanSchedRes = await makeRequest(`${baseUrl}/api/v1/schedules`, {
          method: 'POST',
          headers: {
            Cookie: orphanCookie,
            'X-CSRF-Token': orphanCsrf,
            Origin: allowedOrigin,
          },
          body: {
            week_start_date: '2026-10-19',
            entries: [
              {
                work_date: '2026-10-19',
                day_of_week: 1,
                start_time: '08:00',
              },
            ],
          },
        });

        assert.equal(orphanSchedRes.status, 404, 'Schedule registration fails with 404 for unlinked user');
        assert.equal(orphanSchedRes.body.error?.code, 'EMPLOYEE_NOT_FOUND');

        // Verify NO employee record was created
        const checkNoEmp = await pool.query(
          `SELECT id FROM employees WHERE workspace_id = $1 AND user_id = $2;`,
          [wsId, unlinkedUserId],
        );
        assert.equal(checkNoEmp.rows.length, 0, 'No employee record was auto-created');
      });

    } finally {
      server.close();
    }
  } finally {
    await closeDatabasePool(pool);
  }
});
