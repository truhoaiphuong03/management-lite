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

test('MVP Phase 4 REP: Draft, Submit, Revise (C02), History, Owner View, and RBAC', async (t) => {
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

    const csrfSecret = 'mvp_rep_csrf_secret_min_32_bytes_super_secure!';
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
      const wsName = `REP Test Store ${runToken}`;

      // 1. Create Workspace
      await pool.query(
        `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active');`,
        [wsId, wsName],
      );

      const passwordHash = await hashPassword('password123');

      // Helper: Setup user, credential, membership, binding, employee
      async function setupActor(username, role, fullName) {
        const userId = crypto.randomUUID();
        const empId = crypto.randomUUID();

        await pool.query(
          `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
          [userId, username, `${username}@test.local`],
        );
        await pool.query(
          `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
          [userId, passwordHash],
        );
        await pool.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'active');`,
          [wsId, userId, role],
        );
        await pool.query(
          `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version) VALUES ($1, $2, 'active', 1);`,
          [wsId, userId],
        );
        await pool.query(
          `INSERT INTO employees (id, workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible)
           VALUES ($1, $2, $3, $4, $5, 'active', true);`,
          [empId, wsId, userId, `EMP-${username.toUpperCase()}`, fullName],
        );

        // Login to get session cookie & csrf token
        const loginRes = await makeRequest(`${baseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { Origin: allowedOrigin },
          body: { identifier: username, password: 'password123' },
        });

        assert.equal(loginRes.status, 200);
        const setCookie = loginRes.headers['set-cookie'];
        const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
        const cookie = cookieStr ? cookieStr.split(';')[0] : '';
        const csrfToken = loginRes.body?.data?.csrf_token;

        return { userId, empId, cookie, csrfToken };
      }

      const owner = await setupActor(
        `rep_owner_${runToken}`,
        'owner',
        'Owner Rep',
      );
      const staff1 = await setupActor(
        `rep_staff1_${runToken}`,
        'staff',
        'Staff Nguyen',
      );
      const staff2 = await setupActor(
        `rep_staff2_${runToken}`,
        'staff',
        'Staff Tran',
      );

      const today = '2026-10-09';

      // =========================================================================
      // Test 1: Staff creates daily report draft (POST /api/v1/reports/daily)
      // =========================================================================
      const createRes = await makeRequest(`${baseUrl}/api/v1/reports/daily`, {
        method: 'POST',
        headers: {
          Origin: allowedOrigin,
          Cookie: staff1.cookie,
          'X-CSRF-Token': staff1.csrfToken,
        },
        body: {
          report_date: today,
          entries: [
            {
              work_type: 'video_editing',
              reported_count: 3,
              notes: 'Edit TikTok reels',
            },
            {
              work_type: 'script_writing',
              reported_count: 1,
              notes: 'Draft YouTube script',
            },
          ],
          notes: 'Năng suất làm việc hôm nay đạt 100%',
        },
      });

      assert.equal(createRes.status, 201, 'Should create draft report');
      assert.equal(createRes.body.success, true);
      const report = createRes.body.data;
      assert.equal(report.status, 'draft');
      assert.equal(report.current_revision, 1);
      assert.equal(report.version, 1);
      assert.equal(report.entries.length, 2);
      assert.equal(report.employee_name, 'Staff Nguyen');
      const reportId = report.id;

      // Duplicate report on same date by same employee rejected with 409 CONFLICT
      const dupRes = await makeRequest(`${baseUrl}/api/v1/reports/daily`, {
        method: 'POST',
        headers: {
          Origin: allowedOrigin,
          Cookie: staff1.cookie,
          'X-CSRF-Token': staff1.csrfToken,
        },
        body: {
          report_date: today,
          entries: [{ work_type: 'other', reported_count: 1 }],
        },
      });
      assert.equal(dupRes.status, 409, 'Duplicate report must fail with 409');
      assert.equal(dupRes.body.error?.code, 'REPORT_ALREADY_EXISTS');

      // =========================================================================
      // Test 2: Staff updates draft report (PATCH /api/v1/reports/daily/:id)
      // =========================================================================
      // Missing If-Match -> 428 PRECONDITION_REQUIRED
      const missingIfMatchRes = await makeRequest(
        `${baseUrl}/api/v1/reports/daily/${reportId}`,
        {
          method: 'PATCH',
          headers: {
            Origin: allowedOrigin,
            Cookie: staff1.cookie,
            'X-CSRF-Token': staff1.csrfToken,
          },
          body: {
            entries: [{ work_type: 'video_editing', reported_count: 4 }],
          },
        },
      );
      assert.equal(
        missingIfMatchRes.status,
        428,
        'Missing If-Match must return 428',
      );

      // Stale If-Match -> 412 PRECONDITION_FAILED
      const staleIfMatchRes = await makeRequest(
        `${baseUrl}/api/v1/reports/daily/${reportId}`,
        {
          method: 'PATCH',
          headers: {
            Origin: allowedOrigin,
            Cookie: staff1.cookie,
            'X-CSRF-Token': staff1.csrfToken,
            'If-Match': '"999"',
          },
          body: {
            entries: [{ work_type: 'video_editing', reported_count: 4 }],
          },
        },
      );
      assert.equal(
        staleIfMatchRes.status,
        412,
        'Stale If-Match must return 412',
      );

      // Valid update
      const updateRes = await makeRequest(
        `${baseUrl}/api/v1/reports/daily/${reportId}`,
        {
          method: 'PATCH',
          headers: {
            Origin: allowedOrigin,
            Cookie: staff1.cookie,
            'X-CSRF-Token': staff1.csrfToken,
            'If-Match': `"${report.version}"`,
          },
          body: {
            entries: [
              {
                work_type: 'video_editing',
                reported_count: 4,
                notes: 'Updated 4 reels',
              },
            ],
            notes: 'Đã hoàn tất thêm 1 video',
          },
        },
      );
      assert.equal(updateRes.status, 200, 'Draft update must succeed');
      assert.equal(updateRes.body.data.version, 2);
      assert.equal(updateRes.body.data.entries.length, 1);
      assert.equal(updateRes.body.data.entries[0].reported_count, 4);

      // =========================================================================
      // Test 3: Staff submits draft report (POST /api/v1/reports/daily/:id/submit)
      // =========================================================================
      const submitRes = await makeRequest(
        `${baseUrl}/api/v1/reports/daily/${reportId}/submit`,
        {
          method: 'POST',
          headers: {
            Origin: allowedOrigin,
            Cookie: staff1.cookie,
            'X-CSRF-Token': staff1.csrfToken,
            'If-Match': '"2"',
          },
        },
      );
      assert.equal(submitRes.status, 200, 'Submit should succeed');
      assert.equal(submitRes.body.data.status, 'submitted');
      assert.equal(submitRes.body.data.revision_number, 1);
      assert.equal(submitRes.body.data.version, 3);
      assert.ok(submitRes.body.data.submitted_at);

      // PATCH after submit must fail with 422 INVALID_TRANSITION (Doc 36 REP C02)
      const patchAfterSubmitRes = await makeRequest(
        `${baseUrl}/api/v1/reports/daily/${reportId}`,
        {
          method: 'PATCH',
          headers: {
            Origin: allowedOrigin,
            Cookie: staff1.cookie,
            'X-CSRF-Token': staff1.csrfToken,
            'If-Match': '"3"',
          },
          body: {
            entries: [{ work_type: 'other', reported_count: 1 }],
          },
        },
      );
      assert.equal(
        patchAfterSubmitRes.status,
        422,
        'PATCH on submitted report must return 422',
      );

      // =========================================================================
      // Test 4: Staff revises submitted report (POST /api/v1/reports/daily/:id/revisions) (REP C02)
      // =========================================================================
      const reviseRes = await makeRequest(
        `${baseUrl}/api/v1/reports/daily/${reportId}/revisions`,
        {
          method: 'POST',
          headers: {
            Origin: allowedOrigin,
            Cookie: staff1.cookie,
            'X-CSRF-Token': staff1.csrfToken,
            'If-Match': '"3"',
          },
          body: {
            entries: [
              {
                work_type: 'video_editing',
                reported_count: 5,
                notes: 'Bổ sung thêm 1 video ban đêm',
              },
              {
                work_type: 'support',
                reported_count: 2,
                notes: 'Hỗ trợ khách hàng',
              },
            ],
            notes: 'Bản chỉnh sửa sau khi kiểm tra lại số liệu',
            reason: 'Quên ghi nhận video thứ 5 và 2 ca hỗ trợ',
          },
        },
      );
      assert.equal(
        reviseRes.status,
        201,
        'Revise report should succeed with 201',
      );
      assert.equal(reviseRes.body.data.status, 'submitted');
      assert.equal(
        reviseRes.body.data.revision_number,
        2,
        'Revision number should increment to 2',
      );
      assert.equal(
        reviseRes.body.data.version,
        4,
        'Entity version should increment to 4',
      );

      // =========================================================================
      // Test 5: Check revision history (GET /api/v1/reports/daily/:id/revisions)
      // =========================================================================
      const revsRes = await makeRequest(
        `${baseUrl}/api/v1/reports/daily/${reportId}/revisions`,
        {
          method: 'GET',
          headers: {
            Origin: allowedOrigin,
            Cookie: staff1.cookie,
          },
        },
      );
      assert.equal(
        revsRes.body.data.length,
        2,
        'submit (v1) + revision (v2) = 2 revision records',
      );
      assert.equal(
        revsRes.body.data[0].revision_number,
        2,
        'Latest revision is revision 2',
      );
      assert.equal(revsRes.body.data[0].status, 'submitted');
      assert.equal(
        revsRes.body.data[0].reason,
        'Quên ghi nhận video thứ 5 và 2 ca hỗ trợ',
      );

      // =========================================================================
      // Test 6: Check staff self history (GET /api/v1/reports/me)
      // =========================================================================
      const staff1MeRes = await makeRequest(`${baseUrl}/api/v1/reports/me`, {
        method: 'GET',
        headers: {
          Origin: allowedOrigin,
          Cookie: staff1.cookie,
        },
      });
      assert.equal(staff1MeRes.status, 200);
      assert.equal(staff1MeRes.body.data.items.length, 1);
      assert.equal(staff1MeRes.body.data.items[0].current_revision, 2);
      assert.equal(staff1MeRes.body.data.items[0].total_reported_count, 7); // 5 + 2

      // Staff2 sees 0 reports in their own history
      const staff2MeRes = await makeRequest(`${baseUrl}/api/v1/reports/me`, {
        method: 'GET',
        headers: {
          Origin: allowedOrigin,
          Cookie: staff2.cookie,
        },
      });
      assert.equal(staff2MeRes.status, 200);
      assert.equal(staff2MeRes.body.data.items.length, 0);

      // =========================================================================
      // Test 7: Scoped access / tenant isolation (Cross-staff access hidden)
      // =========================================================================
      const crossGetRes = await makeRequest(
        `${baseUrl}/api/v1/reports/daily/${reportId}`,
        {
          method: 'GET',
          headers: {
            Origin: allowedOrigin,
            Cookie: staff2.cookie,
          },
        },
      );
      assert.equal(
        crossGetRes.status,
        404,
        'Other staff cannot access another staff report',
      );

      // =========================================================================
      // Test 8: Owner View (GET /api/v1/reports/daily) & RBAC
      // =========================================================================
      // Staff cannot view all workspace reports -> 403 FORBIDDEN
      const staffDailyRes = await makeRequest(
        `${baseUrl}/api/v1/reports/daily`,
        {
          method: 'GET',
          headers: {
            Origin: allowedOrigin,
            Cookie: staff1.cookie,
          },
        },
      );
      assert.equal(
        staffDailyRes.status,
        403,
        'Staff cannot call Owner reports list',
      );

      // Owner can view all workspace reports
      const ownerDailyRes = await makeRequest(
        `${baseUrl}/api/v1/reports/daily`,
        {
          method: 'GET',
          headers: {
            Origin: allowedOrigin,
            Cookie: owner.cookie,
          },
        },
      );
      assert.equal(ownerDailyRes.status, 200);
      assert.equal(ownerDailyRes.body.data.items.length, 1);
      assert.equal(
        ownerDailyRes.body.data.items[0].employee_name,
        'Staff Nguyen',
      );
      assert.equal(ownerDailyRes.body.data.items[0].status, 'submitted');
      assert.equal(ownerDailyRes.body.data.items[0].current_revision, 2);

      // Owner can view report details
      const ownerDetailRes = await makeRequest(
        `${baseUrl}/api/v1/reports/daily/${reportId}`,
        {
          method: 'GET',
          headers: {
            Origin: allowedOrigin,
            Cookie: owner.cookie,
          },
        },
      );
      assert.equal(ownerDetailRes.status, 200);
      assert.equal(ownerDetailRes.body.data.revisions.length, 2);
      assert.equal(ownerDetailRes.body.data.entries.length, 2);

      // =========================================================================
      // Test 9: Immutability trigger test on daily_report_revisions
      // =========================================================================
      await assert.rejects(
        pool.query(
          `UPDATE daily_report_revisions SET reason = 'tampered' WHERE report_id = $1;`,
          [reportId],
        ),
        /daily_report_revisions is append-only/,
        'Trigger must block UPDATE on daily_report_revisions',
      );

      await assert.rejects(
        pool.query(`DELETE FROM daily_report_revisions WHERE report_id = $1;`, [
          reportId,
        ]),
        /daily_report_revisions is append-only/,
        'Trigger must block DELETE on daily_report_revisions',
      );

      // =========================================================================
      // Test 10: Owner merge_if_exists + employee_id + submit_now (v0.9.17)
      // =========================================================================
      const ownerMergeRes = await makeRequest(
        `${baseUrl}/api/v1/reports/daily`,
        {
          method: 'POST',
          headers: {
            Origin: allowedOrigin,
            Cookie: owner.cookie,
            'X-CSRF-Token': owner.csrfToken,
          },
          body: {
            report_date: today,
            employee_id: staff1.empId,
            merge_if_exists: true,
            submit_now: true,
            entries: [
              {
                work_type: 'Làm video Hưng',
                reported_count: 3,
                notes: '1 cái đã đăng 2 cái nháp',
              },
            ],
            notes: '1 cái đã đăng 2 cái nháp',
          },
        },
      );
      assert.equal(ownerMergeRes.status, 201);
      assert.equal(ownerMergeRes.body.data.id, reportId);
      assert.equal(ownerMergeRes.body.data.status, 'submitted');
      assert.equal(ownerMergeRes.body.data.current_revision, 3);
      assert.equal(ownerMergeRes.body.data.entries.length, 3);
      assert.equal(
        ownerMergeRes.body.data.entries[2].work_type,
        'Làm video Hưng',
      );
      assert.equal(ownerMergeRes.body.data.entries[2].reported_count, 3);
    } finally {
      await new Promise((res) => server.close(res));
    }
  } finally {
    await closeDatabasePool(pool);
  }
});
