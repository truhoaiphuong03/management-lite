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

test('MVP Phase 2 EMP: Owner employee management, activation, login, self-profile, suspend/reactivate, RBAC', async (t) => {
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

    // Ensure all 5 migrations (up to 0005_m03_employees) are applied
    const migrationFiles = loadMigrationFiles(
      resolve(root, 'packages/database/src/migrations'),
    );
    await runMigrations(pool, migrationFiles);

    const csrfSecret = 'emp_mvp_csrf_secret_min_32_chars_long_key!';
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
      const wsName = `EMP Test Store ${runToken}`;

      // 1. Create Workspace
      await pool.query(
        `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active');`,
        [wsId, wsName],
      );

      // 2. Create Owner User + Active Binding + Employee Profile
      const ownerId = crypto.randomUUID();
      const ownerUser = `owner_emp_${runToken}`;
      const ownerEmail = `owner_emp_${runToken}@emp.test`;
      const ownerPw = `OwnerPass_${runToken}!`;
      const ownerHash = await hashPassword(ownerPw);

      await pool.query(
        `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
        [ownerId, ownerUser, ownerEmail],
      );
      await pool.query(
        `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
        [ownerId, ownerHash],
      );
      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active');`,
        [wsId, ownerId],
      );
      await pool.query(
        `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version) VALUES ($1, $2, 'active', 1);`,
        [wsId, ownerId],
      );
      await pool.query(
        `INSERT INTO employees (workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible)
         VALUES ($1, $2, 'OWNER_01', 'Chủ cửa hàng', 'active', false);`,
        [wsId, ownerId],
      );

      // -------------------------------------------------------------------
      // STEP 1: Owner logs in
      // -------------------------------------------------------------------
      const ownerLoginRes = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        body: { identifier: ownerUser, password: ownerPw },
      });
      assert.equal(ownerLoginRes.status, 200);
      assert.equal(ownerLoginRes.body.success, true);
      const ownerCsrf = ownerLoginRes.body.data.csrf_token;
      const ownerCookie = ownerLoginRes.headers['set-cookie'];
      const ownerCookieStr = Array.isArray(ownerCookie)
        ? ownerCookie[0]
        : ownerCookie;

      // -------------------------------------------------------------------
      // STEP 2: Owner lists employees -> sees initial Owner employee
      // -------------------------------------------------------------------
      const initialListRes = await makeRequest(`${baseUrl}/api/v1/employees`, {
        method: 'GET',
        headers: { Cookie: ownerCookieStr },
      });
      assert.equal(initialListRes.status, 200);
      assert.equal(initialListRes.body.success, true);
      assert.equal(initialListRes.body.data.items.length, 1);
      assert.equal(initialListRes.body.data.items[0].employee_code, 'OWNER_01');

      // -------------------------------------------------------------------
      // STEP 3: Owner creates a new staff employee
      // -------------------------------------------------------------------
      const newStaffCode = `NV_${runToken}`;
      const newStaffEmail = `staff_${runToken}@emp.test`;
      const createEmpRes = await makeRequest(`${baseUrl}/api/v1/employees`, {
        method: 'POST',
        headers: {
          Cookie: ownerCookieStr,
          Origin: allowedOrigin,
          'X-CSRF-Token': ownerCsrf,
        },
        body: {
          employee_code: newStaffCode,
          full_name: 'Nguyễn Văn Nhân Viên',
          email: newStaffEmail,
        },
      });
      assert.equal(createEmpRes.status, 201);
      assert.equal(createEmpRes.body.success, true);
      const createdStaff = createEmpRes.body.data;
      assert.equal(createdStaff.employee_code, newStaffCode);
      assert.equal(createdStaff.full_name, 'Nguyễn Văn Nhân Viên');
      assert.equal(createdStaff.employment_status, 'invited');
      assert.ok(
        createdStaff.invite_token,
        'Must return activation invite token',
      );
      const staffInviteToken = createdStaff.invite_token;
      const staffEmpId = createdStaff.id;

      // -------------------------------------------------------------------
      // STEP 4: Duplicate employee_code is rejected with 409 CONFLICT
      // -------------------------------------------------------------------
      const dupCodeRes = await makeRequest(`${baseUrl}/api/v1/employees`, {
        method: 'POST',
        headers: {
          Cookie: ownerCookieStr,
          Origin: allowedOrigin,
          'X-CSRF-Token': ownerCsrf,
        },
        body: {
          employee_code: newStaffCode,
          full_name: 'Trùng mã',
          email: `other_${runToken}@emp.test`,
        },
      });
      assert.equal(dupCodeRes.status, 409);
      assert.equal(dupCodeRes.body.error.code, 'CONFLICT');

      // -------------------------------------------------------------------
      // STEP 5: Staff activates account using invite token
      // -------------------------------------------------------------------
      const staffPassword = `StaffP@ss_${runToken}!123`;
      const activateRes = await makeRequest(`${baseUrl}/api/v1/auth/activate`, {
        method: 'POST',
        body: {
          token: staffInviteToken,
          new_password: staffPassword,
        },
      });
      assert.equal(activateRes.status, 200);
      assert.equal(activateRes.body.success, true);

      // Replay with consumed token fails with 410 INVITE_EXPIRED
      const replayActivateRes = await makeRequest(
        `${baseUrl}/api/v1/auth/activate`,
        {
          method: 'POST',
          body: {
            token: staffInviteToken,
            new_password: staffPassword,
          },
        },
      );
      assert.equal(replayActivateRes.status, 410);
      assert.equal(replayActivateRes.body.error.code, 'INVITE_EXPIRED');

      // -------------------------------------------------------------------
      // STEP 6: Newly activated staff logs in
      // -------------------------------------------------------------------
      const staffLoginRes = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        body: { identifier: newStaffEmail, password: staffPassword },
      });
      assert.equal(staffLoginRes.status, 200);
      assert.equal(staffLoginRes.body.success, true);
      assert.equal(staffLoginRes.body.data.active_workspace.role, 'staff');
      const staffCsrf = staffLoginRes.body.data.csrf_token;
      const staffCookie = staffLoginRes.headers['set-cookie'];
      const staffCookieStr = Array.isArray(staffCookie)
        ? staffCookie[0]
        : staffCookie;

      // -------------------------------------------------------------------
      // STEP 7: Staff views own profile (/employees/me and /employees/:id)
      // -------------------------------------------------------------------
      const staffMeRes = await makeRequest(`${baseUrl}/api/v1/employees/me`, {
        method: 'GET',
        headers: { Cookie: staffCookieStr },
      });
      assert.equal(staffMeRes.status, 200);
      assert.equal(staffMeRes.body.success, true);
      assert.equal(staffMeRes.body.data.id, staffEmpId);
      assert.equal(staffMeRes.body.data.employee_code, newStaffCode);
      assert.equal(staffMeRes.body.data.employment_status, 'active');

      const staffOwnIdRes = await makeRequest(
        `${baseUrl}/api/v1/employees/${staffEmpId}`,
        {
          method: 'GET',
          headers: { Cookie: staffCookieStr },
        },
      );
      assert.equal(staffOwnIdRes.status, 200);
      assert.equal(staffOwnIdRes.body.data.id, staffEmpId);

      // -------------------------------------------------------------------
      // STEP 8: Staff CANNOT list employees or view other employees (RBAC & 404 concealment)
      // -------------------------------------------------------------------
      const staffListRes = await makeRequest(`${baseUrl}/api/v1/employees`, {
        method: 'GET',
        headers: { Cookie: staffCookieStr },
      });
      assert.equal(staffListRes.status, 403);
      assert.equal(staffListRes.body.error.code, 'FORBIDDEN');

      // Staff cannot view Owner's employee profile (concealed with 404 per Doc 04/24)
      const ownerEmpIdRes = await pool.query(
        `SELECT id FROM employees WHERE workspace_id = $1 AND user_id = $2;`,
        [wsId, ownerId],
      );
      const ownerEmpId = ownerEmpIdRes.rows[0].id;
      const staffViewOwnerRes = await makeRequest(
        `${baseUrl}/api/v1/employees/${ownerEmpId}`,
        {
          method: 'GET',
          headers: { Cookie: staffCookieStr },
        },
      );
      assert.equal(staffViewOwnerRes.status, 404);
      assert.equal(staffViewOwnerRes.body.error.code, 'NOT_FOUND');

      // Staff cannot create employees
      const staffCreateRes = await makeRequest(`${baseUrl}/api/v1/employees`, {
        method: 'POST',
        headers: {
          Cookie: staffCookieStr,
          Origin: allowedOrigin,
          'X-CSRF-Token': staffCsrf,
        },
        body: {
          employee_code: 'UNAUTH',
          full_name: 'Hack',
          email: 'hack@test.local',
        },
      });
      assert.equal(staffCreateRes.status, 403);

      // -------------------------------------------------------------------
      // STEP 9: Owner updates employee info with If-Match concurrency guard
      // -------------------------------------------------------------------
      // Missing If-Match -> 428 PRECONDITION_REQUIRED
      const missingIfMatchRes = await makeRequest(
        `${baseUrl}/api/v1/employees/${staffEmpId}`,
        {
          method: 'PATCH',
          headers: {
            Cookie: ownerCookieStr,
            Origin: allowedOrigin,
            'X-CSRF-Token': ownerCsrf,
          },
          body: { full_name: 'Nguyễn Văn Nhân Viên (Updated)' },
        },
      );
      assert.equal(missingIfMatchRes.status, 428);
      assert.equal(missingIfMatchRes.body.error.code, 'PRECONDITION_REQUIRED');

      // Stale If-Match -> 412 PRECONDITION_FAILED
      const staleIfMatchRes = await makeRequest(
        `${baseUrl}/api/v1/employees/${staffEmpId}`,
        {
          method: 'PATCH',
          headers: {
            Cookie: ownerCookieStr,
            Origin: allowedOrigin,
            'X-CSRF-Token': ownerCsrf,
            'If-Match': '"999"',
          },
          body: { full_name: 'Nguyễn Văn Nhân Viên (Updated)' },
        },
      );
      assert.equal(staleIfMatchRes.status, 412);
      assert.equal(staleIfMatchRes.body.error.code, 'PRECONDITION_FAILED');

      // Valid If-Match: "2" (since activation incremented version from 1 to 2) -> 200 OK, version becomes 3
      const updateRes = await makeRequest(
        `${baseUrl}/api/v1/employees/${staffEmpId}`,
        {
          method: 'PATCH',
          headers: {
            Cookie: ownerCookieStr,
            Origin: allowedOrigin,
            'X-CSRF-Token': ownerCsrf,
            'If-Match': '"2"',
          },
          body: { full_name: 'Nguyễn Văn Nhân Viên (Updated)' },
        },
      );
      assert.equal(updateRes.status, 200);
      assert.equal(
        updateRes.body.data.full_name,
        'Nguyễn Văn Nhân Viên (Updated)',
      );
      assert.equal(updateRes.body.data.version, 3);

      // -------------------------------------------------------------------
      // STEP 10: Owner suspends employee -> Staff active session is revoked immediately!
      // -------------------------------------------------------------------
      const suspendRes = await makeRequest(
        `${baseUrl}/api/v1/employees/${staffEmpId}/suspend`,
        {
          method: 'POST',
          headers: {
            Cookie: ownerCookieStr,
            Origin: allowedOrigin,
            'X-CSRF-Token': ownerCsrf,
            'If-Match': '"3"',
          },
          body: { reason: 'Nghỉ việc tạm thời' },
        },
      );
      assert.equal(suspendRes.status, 200);
      assert.equal(suspendRes.body.data.employment_status, 'suspended');
      assert.equal(suspendRes.body.data.version, 4);

      // Previous Staff session MUST now be revoked and rejected with 401 UNAUTHENTICATED
      const staffAfterSuspendRes = await makeRequest(
        `${baseUrl}/api/v1/employees/me`,
        {
          method: 'GET',
          headers: { Cookie: staffCookieStr },
        },
      );
      assert.equal(staffAfterSuspendRes.status, 401);
      assert.equal(staffAfterSuspendRes.body.error.code, 'UNAUTHENTICATED');

      // -------------------------------------------------------------------
      // STEP 11: Owner reactivates employee
      // -------------------------------------------------------------------
      const reactivateRes = await makeRequest(
        `${baseUrl}/api/v1/employees/${staffEmpId}/reactivate`,
        {
          method: 'POST',
          headers: {
            Cookie: ownerCookieStr,
            Origin: allowedOrigin,
            'X-CSRF-Token': ownerCsrf,
            'If-Match': '"4"',
          },
          body: { reason: 'Đi làm trở lại' },
        },
      );
      assert.equal(reactivateRes.status, 200);
      assert.equal(reactivateRes.body.data.employment_status, 'active');
      assert.equal(reactivateRes.body.data.version, 5);

      // Staff can now log in again
      const staffReLoginRes = await makeRequest(
        `${baseUrl}/api/v1/auth/login`,
        {
          method: 'POST',
          body: { identifier: newStaffEmail, password: staffPassword },
        },
      );
      assert.equal(staffReLoginRes.status, 200);
      assert.equal(staffReLoginRes.body.success, true);
    } finally {
      await new Promise((res) => server.close(res));
    }
  } finally {
    await closeDatabasePool(pool);
  }
});
