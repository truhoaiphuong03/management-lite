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

test('MVP Phase 3 ATT: Clock in/out, Break, History, Owner review, Correction, and RBAC', async (t) => {
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

    const csrfSecret = 'mvp_att_csrf_secret_min_32_bytes_super_secure!';
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
      const wsName = `ATT Test Store ${runToken}`;

      // 1. Create Workspace
      await pool.query(
        `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active');`,
        [wsId, wsName],
      );

      // 2. Create Owner User
      const ownerId = crypto.randomUUID();
      const ownerUser = `owner_att_${runToken}`;
      const ownerEmail = `${ownerUser}@att.test`;
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
      const ownerEmpId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO employees (id, workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible)
         VALUES ($1, $2, $3, 'OWNER', 'Chủ cửa hàng ATT', 'active', false);`,
        [ownerEmpId, wsId, ownerId],
      );

      // 3. Create Staff User
      const staffId = crypto.randomUUID();
      const staffUser = `staff_att_${runToken}`;
      const staffEmail = `${staffUser}@att.test`;
      const staffPw = `StaffPass_${runToken}!`;
      const staffHash = await hashPassword(staffPw);

      await pool.query(
        `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
        [staffId, staffUser, staffEmail],
      );
      await pool.query(
        `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
        [staffId, staffHash],
      );
      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'staff', 'active');`,
        [wsId, staffId],
      );
      await pool.query(
        `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version) VALUES ($1, $2, 'active', 1);`,
        [wsId, staffId],
      );
      const staffEmpId = crypto.randomUUID();
      await pool.query(
        `INSERT INTO employees (id, workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible)
         VALUES ($1, $2, $3, 'NV_ATT', 'Nhân viên Chấm Công', 'active', true);`,
        [staffEmpId, wsId, staffId],
      );

      // Helper function to login and get cookies + csrf
      const login = async (identifier, password) => {
        const res = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { Origin: allowedOrigin },
          body: { identifier, password },
        });
        assert.equal(res.status, 200, `Login failed for ${identifier}`);
        const cookie = res.headers['set-cookie'][0].split(';')[0];
        return {
          cookie,
          csrfToken: res.body.data.csrf_token,
          role: res.body.data.active_workspace.role,
        };
      };

      const ownerAuth = await login(ownerUser, ownerPw);
      const staffAuth = await login(staffUser, staffPw);

      // 4. Test GET /attendance/me when no shift is open
      const meInitRes = await makeRequest(`${baseUrl}/api/v1/attendance/me`, {
        headers: { Cookie: staffAuth.cookie },
      });
      assert.equal(meInitRes.status, 200);
      assert.equal(meInitRes.body.data.current_shift, null);
      assert.equal(meInitRes.body.data.recent_shifts.length, 0);

      // 5. Test Staff Clock In: POST /attendance/shifts
      const clockInRes = await makeRequest(
        `${baseUrl}/api/v1/attendance/shifts`,
        {
          method: 'POST',
          headers: {
            Cookie: staffAuth.cookie,
            Origin: allowedOrigin,
            'X-CSRF-Token': staffAuth.csrfToken,
          },
          body: {},
        },
      );
      assert.equal(clockInRes.status, 201);
      assert.equal(clockInRes.body.data.run_state, 'working');
      assert.ok(clockInRes.body.data.shift_id);
      const shiftId = clockInRes.body.data.shift_id;

      // 6. Test Prevent Duplicate Clock In while shift is open (Conflict 409)
      const dupClockInRes = await makeRequest(
        `${baseUrl}/api/v1/attendance/shifts`,
        {
          method: 'POST',
          headers: {
            Cookie: staffAuth.cookie,
            Origin: allowedOrigin,
            'X-CSRF-Token': staffAuth.csrfToken,
          },
          body: {},
        },
      );
      assert.equal(dupClockInRes.status, 409);

      // 7. Test Check GET /attendance/me has current_shift
      const meOpenRes = await makeRequest(`${baseUrl}/api/v1/attendance/me`, {
        headers: { Cookie: staffAuth.cookie },
      });
      assert.equal(meOpenRes.status, 200);
      assert.equal(meOpenRes.body.data.current_shift.id, shiftId);
      assert.equal(meOpenRes.body.data.current_shift.run_state, 'working');

      // 8. Test Start Break: POST /attendance/shifts/:id/breaks
      const breakRes = await makeRequest(
        `${baseUrl}/api/v1/attendance/shifts/${shiftId}/breaks`,
        {
          method: 'POST',
          headers: {
            Cookie: staffAuth.cookie,
            Origin: allowedOrigin,
            'X-CSRF-Token': staffAuth.csrfToken,
          },
          body: {},
        },
      );
      assert.equal(breakRes.status, 200);
      assert.equal(breakRes.body.data.run_state, 'paused');
      assert.ok(breakRes.body.data.break_id);

      // 9. Test Clock out is prohibited while paused (Doc 19: clock-out allowed only from working)
      const invalidClockOutRes = await makeRequest(
        `${baseUrl}/api/v1/attendance/shifts/${shiftId}/clock-out`,
        {
          method: 'POST',
          headers: {
            Cookie: staffAuth.cookie,
            Origin: allowedOrigin,
            'X-CSRF-Token': staffAuth.csrfToken,
          },
          body: {},
        },
      );
      assert.equal(invalidClockOutRes.status, 422);

      // 10. Test Resume from Break: POST /attendance/shifts/:id/resume
      const resumeRes = await makeRequest(
        `${baseUrl}/api/v1/attendance/shifts/${shiftId}/resume`,
        {
          method: 'POST',
          headers: {
            Cookie: staffAuth.cookie,
            Origin: allowedOrigin,
            'X-CSRF-Token': staffAuth.csrfToken,
          },
          body: {},
        },
      );
      assert.equal(resumeRes.status, 200);
      assert.equal(resumeRes.body.data.run_state, 'working');

      // 11. Test Clock Out: POST /attendance/shifts/:id/clock-out
      const clockOutRes = await makeRequest(
        `${baseUrl}/api/v1/attendance/shifts/${shiftId}/clock-out`,
        {
          method: 'POST',
          headers: {
            Cookie: staffAuth.cookie,
            Origin: allowedOrigin,
            'X-CSRF-Token': staffAuth.csrfToken,
          },
          body: {},
        },
      );
      assert.equal(clockOutRes.status, 200);
      assert.equal(clockOutRes.body.data.run_state, 'completed');
      assert.ok(clockOutRes.body.data.shift_version_id);

      // 12. Test Owner Reviews Staff Shift: POST /attendance/shifts/:id/reviews
      // 12.1. Rejection requires reason
      const failReviewRes = await makeRequest(
        `${baseUrl}/api/v1/attendance/shifts/${shiftId}/reviews`,
        {
          method: 'POST',
          headers: {
            Cookie: ownerAuth.cookie,
            Origin: allowedOrigin,
            'X-CSRF-Token': ownerAuth.csrfToken,
          },
          body: { decision: 'rejected' },
        },
      );
      assert.equal(failReviewRes.status, 400);

      // 12.2. Valid Approval by Owner
      const approveRes = await makeRequest(
        `${baseUrl}/api/v1/attendance/shifts/${shiftId}/reviews`,
        {
          method: 'POST',
          headers: {
            Cookie: ownerAuth.cookie,
            Origin: allowedOrigin,
            'X-CSRF-Token': ownerAuth.csrfToken,
          },
          body: { decision: 'approved', reason: 'Ca làm đầy đủ, đúng giờ' },
        },
      );
      assert.equal(approveRes.status, 200);
      assert.equal(approveRes.body.data.review_state, 'approved');

      // 13. Test SCP-D05 / Doc 36 guard: Owner cannot self-review their own shift
      // Owner clocks in and clocks out
      const ownerClockIn = await makeRequest(
        `${baseUrl}/api/v1/attendance/shifts`,
        {
          method: 'POST',
          headers: {
            Cookie: ownerAuth.cookie,
            Origin: allowedOrigin,
            'X-CSRF-Token': ownerAuth.csrfToken,
          },
          body: {},
        },
      );
      assert.equal(ownerClockIn.status, 201);
      const ownerShiftId = ownerClockIn.body.data.shift_id;

      const ownerClockOut = await makeRequest(
        `${baseUrl}/api/v1/attendance/shifts/${ownerShiftId}/clock-out`,
        {
          method: 'POST',
          headers: {
            Cookie: ownerAuth.cookie,
            Origin: allowedOrigin,
            'X-CSRF-Token': ownerAuth.csrfToken,
          },
          body: {},
        },
      );
      assert.equal(ownerClockOut.status, 200);

      // Owner attempts to review own shift -> must be 403 Forbidden
      const selfReviewRes = await makeRequest(
        `${baseUrl}/api/v1/attendance/shifts/${ownerShiftId}/reviews`,
        {
          method: 'POST',
          headers: {
            Cookie: ownerAuth.cookie,
            Origin: allowedOrigin,
            'X-CSRF-Token': ownerAuth.csrfToken,
          },
          body: { decision: 'approved' },
        },
      );
      assert.equal(selfReviewRes.status, 403);

      // 14. Test Staff Correction Request: POST /attendance/shifts/:id/correction-requests
      // Create another staff shift that staff forgot to clock out or needs correction
      const staffShift2Res = await makeRequest(
        `${baseUrl}/api/v1/attendance/shifts`,
        {
          method: 'POST',
          headers: {
            Cookie: staffAuth.cookie,
            Origin: allowedOrigin,
            'X-CSRF-Token': staffAuth.csrfToken,
          },
          body: {},
        },
      );
      assert.equal(staffShift2Res.status, 201);
      const shift2Id = staffShift2Res.body.data.shift_id;

      // Staff submits correction request
      const crReqRes = await makeRequest(
        `${baseUrl}/api/v1/attendance/shifts/${shift2Id}/correction-requests`,
        {
          method: 'POST',
          headers: {
            Cookie: staffAuth.cookie,
            Origin: allowedOrigin,
            'X-CSRF-Token': staffAuth.csrfToken,
          },
          body: {
            reason: 'Quên bấm kết thúc ca lúc 18:00',
            claimed_clock_out_at: new Date(Date.now() + 3600000).toISOString(),
            evidence_note: 'Có xác nhận từ trưởng ca',
          },
        },
      );
      assert.equal(crReqRes.status, 201);
      assert.equal(crReqRes.body.data.status, 'pending');
      const crId = crReqRes.body.data.id;

      // 15. Test Owner Decides on Correction Request: Accept
      const acceptTime = new Date(Date.now() + 3600000).toISOString();
      const decideRes = await makeRequest(
        `${baseUrl}/api/v1/attendance/correction-requests/${crId}/decide`,
        {
          method: 'POST',
          headers: {
            Cookie: ownerAuth.cookie,
            Origin: allowedOrigin,
            'X-CSRF-Token': ownerAuth.csrfToken,
          },
          body: {
            decision: 'accept',
            reason: 'Chấp nhận theo xác nhận trưởng ca',
            clock_out_at: acceptTime,
          },
        },
      );
      assert.equal(decideRes.status, 200);
      assert.equal(decideRes.body.data.status, 'accepted');

      // 16. Test Owner Shift List: GET /attendance/shifts
      const ownerListRes = await makeRequest(
        `${baseUrl}/api/v1/attendance/shifts`,
        {
          headers: { Cookie: ownerAuth.cookie },
        },
      );
      assert.equal(ownerListRes.status, 200);
      assert.ok(ownerListRes.body.data.shifts.length >= 2);

      // 17. Test RBAC: Staff cannot access GET /attendance/shifts
      const staffListDenied = await makeRequest(
        `${baseUrl}/api/v1/attendance/shifts`,
        {
          headers: { Cookie: staffAuth.cookie },
        },
      );
      assert.equal(staffListDenied.status, 403);

      // 18. Verify net worked_seconds calculation & correction rejection + audit trail
      const versionCheck = await pool.query(
        `SELECT worked_seconds, version_number FROM attendance_shift_versions WHERE shift_id = $1 ORDER BY version_number DESC LIMIT 1;`,
        [shiftId],
      );
      assert.equal(versionCheck.rows.length, 1);
      assert.ok(
        Number(versionCheck.rows[0].worked_seconds) >= 0,
        'Net worked_seconds after subtracting breaks must be non-negative',
      );

      // Submit and reject a correction request on shiftId, and verify audit log
      const crRejectReq = await makeRequest(
        `${baseUrl}/api/v1/attendance/shifts/${shiftId}/correction-requests`,
        {
          method: 'POST',
          headers: {
            Cookie: staffAuth.cookie,
            Origin: allowedOrigin,
            'X-CSRF-Token': staffAuth.csrfToken,
          },
          body: {
            reason: 'Xin điều chỉnh giờ kết thúc thêm 2 tiếng',
            claimed_clock_out_at: new Date(Date.now() + 7200000).toISOString(),
          },
        },
      );
      assert.equal(crRejectReq.status, 201);
      const rejectCrId = crRejectReq.body.data.id;

      const rejectDecideRes = await makeRequest(
        `${baseUrl}/api/v1/attendance/correction-requests/${rejectCrId}/decide`,
        {
          method: 'POST',
          headers: {
            Cookie: ownerAuth.cookie,
            Origin: allowedOrigin,
            'X-CSRF-Token': ownerAuth.csrfToken,
          },
          body: {
            decision: 'reject',
            reason: 'Không khớp dữ liệu camera quầy',
          },
        },
      );
      assert.equal(rejectDecideRes.status, 200);
      assert.equal(rejectDecideRes.body.data.status, 'rejected');

      // Verify audit events recorded for attendance actions and correction decisions
      const attAuditRes = await pool.query(
        `SELECT action FROM audit_events WHERE workspace_id = $1 AND action LIKE 'attendance.%';`,
        [wsId],
      );
      assert.ok(
        attAuditRes.rows.length >= 4,
        'Audit log must record attendance shift and correction events',
      );

      // 19. Verify duplicate review prevention (409 CONFLICT) and date/status filtering
      const duplicateApproveRes = await makeRequest(
        `${baseUrl}/api/v1/attendance/shifts/${shiftId}/reviews`,
        {
          method: 'POST',
          headers: {
            Cookie: ownerAuth.cookie,
            Origin: allowedOrigin,
            'X-CSRF-Token': ownerAuth.csrfToken,
          },
          body: { decision: 'approved', reason: 'Duyệt trùng lần 2' },
        },
      );
      assert.equal(
        duplicateApproveRes.status,
        409,
        'Reviewing an already-approved shift at the same version must return 409 CONFLICT',
      );

      // Verify GET /attendance/shifts returns review_reason & reviewed_at and supports date/status filters
      const todayStr = new Date().toLocaleDateString('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
      });
      const filteredOwnerRes = await makeRequest(
        `${baseUrl}/api/v1/attendance/shifts?review_state=approved&run_state=completed&from_date=${todayStr}&to_date=${todayStr}`,
        {
          headers: { Cookie: ownerAuth.cookie },
        },
      );
      assert.equal(filteredOwnerRes.status, 200);
      const approvedShiftItem = filteredOwnerRes.body.data.shifts.find(
        (s) => s.id === shiftId,
      );
      assert.ok(approvedShiftItem, 'Filtered list must include approved shift');
      assert.equal(
        approvedShiftItem.review_reason,
        'Ca làm đầy đủ, đúng giờ',
      );
      assert.ok(approvedShiftItem.reviewed_at, 'Must include reviewed_at timestamp');

      // Verify GET /attendance/me supports date & status filters
      const filteredMeRes = await makeRequest(
        `${baseUrl}/api/v1/attendance/me?review_state=approved&from_date=${todayStr}&to_date=${todayStr}`,
        {
          headers: { Cookie: staffAuth.cookie },
        },
      );
      assert.equal(filteredMeRes.status, 200);
      assert.ok(
        filteredMeRes.body.data.recent_shifts.some((s) => s.id === shiftId),
        'Filtered personal history must include approved shift',
      );
    } finally {
      await new Promise((res) => server.close(res));
    }
  } finally {
    await closeDatabasePool(pool);
  }
});
