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

test('V0.2 SCHEDULE-01 R09: Staff Work Schedules, Entries, Revisions, RBAC, and Concurrency', async (t) => {
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

    const csrfSecret = 'schedule_test_csrf_secret_min_32_bytes_super_secure!';
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
      const wsName = `Schedule Test Workspace ${runToken}`;

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
        `sch_owner_${runToken}`,
        'owner',
        'Owner Boss',
      );
      const staff1 = await setupActor(
        `sch_staff1_${runToken}`,
        'staff',
        'Staff Minh',
      );
      const staff2 = await setupActor(
        `sch_staff2_${runToken}`,
        'staff',
        'Staff Lan',
      );

      // Next week Monday to Sunday
      const nextMon = '2026-10-12';
      const nextSun = '2026-10-18';

      // =========================================================================
      // Test 1: Staff initially has no schedule for next week
      // =========================================================================
      const initialMeRes = await makeRequest(
        `${baseUrl}/api/v1/schedules/me?week_start_date=${nextMon}`,
        {
          headers: { Cookie: staff1.cookie },
        },
      );
      assert.equal(initialMeRes.status, 200);
      assert.equal(initialMeRes.body.data.schedule.id, '');
      assert.equal(initialMeRes.body.data.entries.length, 0);

      // =========================================================================
      // Test 2: Validation checks for start_time (00:00 & 23:59 valid, 24:00 invalid)
      // =========================================================================
      // 24:00 must be rejected with 400
      const invalidTimeRes = await makeRequest(`${baseUrl}/api/v1/schedules`, {
        method: 'POST',
        headers: {
          Origin: allowedOrigin,
          Cookie: staff1.cookie,
          'X-CSRF-Token': staff1.csrfToken,
        },
        body: {
          week_start_date: nextMon,
          entries: [
            { work_date: '2026-10-12', day_of_week: 1, start_time: '24:00' },
          ],
        },
      });
      assert.equal(
        invalidTimeRes.status,
        400,
        '24:00 start_time must be rejected',
      );

      // Invalid minute 12:60 must be rejected
      const invalidMinRes = await makeRequest(`${baseUrl}/api/v1/schedules`, {
        method: 'POST',
        headers: {
          Origin: allowedOrigin,
          Cookie: staff1.cookie,
          'X-CSRF-Token': staff1.csrfToken,
        },
        body: {
          week_start_date: nextMon,
          entries: [
            { work_date: '2026-10-12', day_of_week: 1, start_time: '12:60' },
          ],
        },
      });
      assert.equal(
        invalidMinRes.status,
        400,
        'Invalid minute 12:60 must be rejected',
      );

      // =========================================================================
      // Test 3: Staff registers schedule for next week (POST /api/v1/schedules)
      // Selected: Monday 00:00, Wednesday 08:30, Friday 23:59 (Unselected days default off)
      // =========================================================================
      const createRes = await makeRequest(`${baseUrl}/api/v1/schedules`, {
        method: 'POST',
        headers: {
          Origin: allowedOrigin,
          Cookie: staff1.cookie,
          'X-CSRF-Token': staff1.csrfToken,
        },
        body: {
          week_start_date: nextMon,
          entries: [
            {
              work_date: '2026-10-12',
              day_of_week: 1,
              start_time: '00:00',
              notes: 'Ca đầu tuần sớm',
            },
            {
              work_date: '2026-10-14',
              day_of_week: 3,
              start_time: '08:30',
              notes: 'Ca sáng thứ 4',
            },
            {
              work_date: '2026-10-16',
              day_of_week: 5,
              start_time: '23:59',
              notes: 'Ca đêm thứ 6',
            },
          ],
        },
      });

      assert.equal(createRes.status, 201, 'Should create schedule');
      assert.equal(createRes.body.success, true);
      const createdData = createRes.body.data;
      assert.ok(createdData.schedule.id);
      assert.equal(createdData.schedule.week_start_date, nextMon);
      assert.equal(createdData.schedule.week_end_date, nextSun);
      assert.equal(createdData.schedule.current_revision, 1);
      assert.equal(createdData.schedule.version, 1);
      // Only 3 selected working days returned
      assert.equal(createdData.entries.length, 3);
      assert.equal(createdData.entries[0].start_time, '00:00');
      assert.equal(createdData.entries[1].start_time, '08:30');
      assert.equal(createdData.entries[2].start_time, '23:59');
      assert.equal(createdData.revisions.length, 1);
      assert.equal(createdData.revisions[0].revision_number, 1);

      const scheduleId = createdData.schedule.id;

      // Duplicate registration on same week fails with 409 CONFLICT
      const dupRes = await makeRequest(`${baseUrl}/api/v1/schedules`, {
        method: 'POST',
        headers: {
          Origin: allowedOrigin,
          Cookie: staff1.cookie,
          'X-CSRF-Token': staff1.csrfToken,
        },
        body: {
          week_start_date: nextMon,
          entries: [
            { work_date: '2026-10-12', day_of_week: 1, start_time: '09:00' },
          ],
        },
      });
      assert.equal(
        dupRes.status,
        409,
        'Duplicate schedule on same week must fail with 409',
      );

      // =========================================================================
      // Test 4: Staff views registered schedule (GET /api/v1/schedules/me)
      // Only selected days and start times are displayed
      // =========================================================================
      const getMeRes = await makeRequest(
        `${baseUrl}/api/v1/schedules/me?week_start_date=${nextMon}`,
        {
          headers: { Cookie: staff1.cookie },
        },
      );
      assert.equal(getMeRes.status, 200);
      assert.equal(getMeRes.body.data.schedule.id, scheduleId);
      assert.equal(getMeRes.body.data.entries.length, 3);
      assert.deepEqual(
        getMeRes.body.data.entries.map((e) => ({
          date: e.work_date,
          day: e.day_of_week,
          time: e.start_time,
        })),
        [
          { date: '2026-10-12', day: 1, time: '00:00' },
          { date: '2026-10-14', day: 3, time: '08:30' },
          { date: '2026-10-16', day: 5, time: '23:59' },
        ],
      );

      // =========================================================================
      // Test 5: Concurrency Guard - Missing or Invalid If-Match on PUT
      // =========================================================================
      // Missing If-Match -> 428 Precondition Required
      const missingIfMatch = await makeRequest(
        `${baseUrl}/api/v1/schedules/${scheduleId}`,
        {
          method: 'PUT',
          headers: {
            Origin: allowedOrigin,
            Cookie: staff1.cookie,
            'X-CSRF-Token': staff1.csrfToken,
          },
          body: {
            entries: [
              { work_date: '2026-10-12', day_of_week: 1, start_time: '10:00' },
            ],
          },
        },
      );
      assert.equal(
        missingIfMatch.status,
        428,
        'Missing If-Match must return 428',
      );

      // Stale If-Match -> 412 Precondition Failed
      const staleIfMatch = await makeRequest(
        `${baseUrl}/api/v1/schedules/${scheduleId}`,
        {
          method: 'PUT',
          headers: {
            Origin: allowedOrigin,
            Cookie: staff1.cookie,
            'X-CSRF-Token': staff1.csrfToken,
            'If-Match': '"99"',
          },
          body: {
            entries: [
              { work_date: '2026-10-12', day_of_week: 1, start_time: '10:00' },
            ],
          },
        },
      );
      assert.equal(staleIfMatch.status, 412, 'Stale version must return 412');

      // =========================================================================
      // Test 6: Staff edits schedule (PUT /api/v1/schedules/:id)
      // Adds Sunday, removes Wednesday, modifies Monday time to 09:15
      // Retains immutable revision history
      // =========================================================================
      const updateRes = await makeRequest(
        `${baseUrl}/api/v1/schedules/${scheduleId}`,
        {
          method: 'PUT',
          headers: {
            Origin: allowedOrigin,
            Cookie: staff1.cookie,
            'X-CSRF-Token': staff1.csrfToken,
            'If-Match': `"${createdData.schedule.version}"`,
          },
          body: {
            entries: [
              {
                work_date: '2026-10-12',
                day_of_week: 1,
                start_time: '09:15',
                notes: 'Đổi giờ muộn hơn',
              },
              {
                work_date: '2026-10-16',
                day_of_week: 5,
                start_time: '23:59',
                notes: 'Giữ nguyên',
              },
              {
                work_date: '2026-10-18',
                day_of_week: 7,
                start_time: '14:00',
                notes: 'Đăng ký thêm chủ nhật',
              },
            ],
            reason: 'Đổi lịch để phù hợp với lịch học đại học',
          },
        },
      );

      assert.equal(updateRes.status, 200, 'Should update schedule');
      const updatedData = updateRes.body.data;
      assert.equal(updatedData.schedule.current_revision, 2);
      assert.equal(updatedData.schedule.version, 2);
      assert.equal(updatedData.entries.length, 3);
      assert.equal(updatedData.entries[0].start_time, '09:15');
      assert.equal(updatedData.entries[2].work_date, '2026-10-18');
      assert.equal(updatedData.entries[2].start_time, '14:00');

      // Check revision history contains v1 (initial) and v2 (updated with reason)
      assert.equal(updatedData.revisions.length, 2);
      assert.equal(updatedData.revisions[0].revision_number, 1);
      assert.equal(updatedData.revisions[1].revision_number, 2);
      assert.equal(
        updatedData.revisions[1].reason,
        'Đổi lịch để phù hợp với lịch học đại học',
      );
      assert.equal(updatedData.revisions[1].snapshot.entries.length, 3);

      // =========================================================================
      // Test 6b: Save without changes does NOT create a new revision
      // =========================================================================
      const noChangeRes = await makeRequest(
        `${baseUrl}/api/v1/schedules/${scheduleId}`,
        {
          method: 'PUT',
          headers: {
            Origin: allowedOrigin,
            Cookie: staff1.cookie,
            'X-CSRF-Token': staff1.csrfToken,
            'If-Match': `"${updatedData.schedule.version}"`,
          },
          body: {
            entries: [
              {
                work_date: '2026-10-12',
                day_of_week: 1,
                start_time: '09:15',
                notes: 'Đổi giờ muộn hơn',
              },
              {
                work_date: '2026-10-16',
                day_of_week: 5,
                start_time: '23:59',
                notes: 'Giữ nguyên',
              },
              {
                work_date: '2026-10-18',
                day_of_week: 7,
                start_time: '14:00',
                notes: 'Đăng ký thêm chủ nhật',
              },
            ],
            reason: 'Không có gì thay đổi',
          },
        },
      );
      assert.equal(noChangeRes.status, 200);
      assert.equal(
        noChangeRes.body.data.schedule.current_revision,
        2,
        'Revision number must remain 2 when no changes were made',
      );
      assert.equal(
        noChangeRes.body.data.schedule.version,
        2,
        'Version must remain 2 when no changes were made',
      );
      assert.equal(
        noChangeRes.body.data.revisions.length,
        2,
        'No new revision row should be created',
      );

      // =========================================================================
      // Test 6c: Update without reason (reason is optional)
      // =========================================================================
      const noReasonRes = await makeRequest(
        `${baseUrl}/api/v1/schedules/${scheduleId}`,
        {
          method: 'PUT',
          headers: {
            Origin: allowedOrigin,
            Cookie: staff1.cookie,
            'X-CSRF-Token': staff1.csrfToken,
            'If-Match': `"${updatedData.schedule.version}"`,
          },
          body: {
            entries: [
              {
                work_date: '2026-10-12',
                day_of_week: 1,
                start_time: '08:00',
              },
            ],
          },
        },
      );
      assert.equal(
        noReasonRes.status,
        200,
        'Update without reason must succeed',
      );
      assert.equal(noReasonRes.body.data.schedule.current_revision, 3);
      assert.equal(noReasonRes.body.data.schedule.version, 3);
      assert.equal(noReasonRes.body.data.revisions.length, 3);
      assert.equal(
        noReasonRes.body.data.revisions[2].reason,
        null,
        'Revision reason should be null when omitted',
      );

      // =========================================================================
      // Test 7: Edit past schedule (Staff can edit schedules in the past)
      // =========================================================================
      const pastMon = '2026-09-14';

      const pastCreate = await makeRequest(`${baseUrl}/api/v1/schedules`, {
        method: 'POST',
        headers: {
          Origin: allowedOrigin,
          Cookie: staff1.cookie,
          'X-CSRF-Token': staff1.csrfToken,
        },
        body: {
          week_start_date: pastMon,
          entries: [
            { work_date: pastMon, day_of_week: 1, start_time: '08:00' },
          ],
        },
      });
      assert.equal(pastCreate.status, 201);
      const pastScheduleId = pastCreate.body.data.schedule.id;

      // =========================================================================
      // Test 7b: Register schedule with all days off (entries: [])
      // =========================================================================
      const allOffMon = '2026-11-02';
      const allOffCreate = await makeRequest(`${baseUrl}/api/v1/schedules`, {
        method: 'POST',
        headers: {
          Origin: allowedOrigin,
          Cookie: staff1.cookie,
          'X-CSRF-Token': staff1.csrfToken,
        },
        body: {
          week_start_date: allOffMon,
          entries: [],
        },
      });
      assert.equal(
        allOffCreate.status,
        201,
        'Should allow registering week with all days off',
      );
      assert.equal(allOffCreate.body.data.entries.length, 0);

      const allOffGet = await makeRequest(
        `${baseUrl}/api/v1/schedules/me?week_start_date=${allOffMon}`,
        {
          headers: { Cookie: staff1.cookie },
        },
      );
      assert.equal(allOffGet.status, 200);
      assert.ok(
        allOffGet.body.data.schedule.id,
        'Schedule record should exist',
      );
      assert.equal(
        allOffGet.body.data.entries.length,
        0,
        'No working days should be listed',
      );

      // Staff edits past schedule
      const pastUpdate = await makeRequest(
        `${baseUrl}/api/v1/schedules/${pastScheduleId}`,
        {
          method: 'PUT',
          headers: {
            Origin: allowedOrigin,
            Cookie: staff1.cookie,
            'X-CSRF-Token': staff1.csrfToken,
            'If-Match': `"${pastCreate.body.data.schedule.version}"`,
          },
          body: {
            entries: [
              { work_date: pastMon, day_of_week: 1, start_time: '10:30' },
              { work_date: '2026-09-15', day_of_week: 2, start_time: '14:00' },
            ],
            reason: 'Bổ sung giờ đã làm việc trong quá khứ',
          },
        },
      );
      assert.equal(
        pastUpdate.status,
        200,
        'Should allow editing past schedule',
      );
      assert.equal(pastUpdate.body.data.schedule.current_revision, 2);
      assert.equal(pastUpdate.body.data.entries.length, 2);

      // =========================================================================
      // Test 8: Cross-month / cross-year boundary schedule
      // Week crossing December 2026 to January 2027: 2026-12-28 (Mon) to 2027-01-03 (Sun)
      // =========================================================================
      const crossMon = '2026-12-28';
      const crossRes = await makeRequest(`${baseUrl}/api/v1/schedules`, {
        method: 'POST',
        headers: {
          Origin: allowedOrigin,
          Cookie: staff1.cookie,
          'X-CSRF-Token': staff1.csrfToken,
        },
        body: {
          week_start_date: crossMon,
          entries: [
            {
              work_date: '2026-12-31',
              day_of_week: 4,
              start_time: '18:00',
              notes: 'Giao thừa',
            },
            {
              work_date: '2027-01-01',
              day_of_week: 5,
              start_time: '10:00',
              notes: 'Năm mới',
            },
          ],
        },
      });
      assert.equal(crossRes.status, 201, 'Should create cross-year schedule');
      assert.equal(crossRes.body.data.schedule.week_start_date, '2026-12-28');
      assert.equal(crossRes.body.data.schedule.week_end_date, '2027-01-03');
      assert.equal(crossRes.body.data.entries.length, 2);

      // =========================================================================
      // Test 9: RBAC Enforcement
      // - Staff 2 CANNOT edit Staff 1 schedule -> 403 FORBIDDEN
      // - Owner CANNOT edit Staff schedule on their behalf -> 403 FORBIDDEN
      // =========================================================================
      const staff2EditStaff1 = await makeRequest(
        `${baseUrl}/api/v1/schedules/${scheduleId}`,
        {
          method: 'PUT',
          headers: {
            Origin: allowedOrigin,
            Cookie: staff2.cookie,
            'X-CSRF-Token': staff2.csrfToken,
            'If-Match': `"${updateRes.body.data.schedule.version}"`,
          },
          body: {
            entries: [
              { work_date: '2026-10-12', day_of_week: 1, start_time: '08:00' },
            ],
          },
        },
      );
      assert.equal(
        staff2EditStaff1.status,
        403,
        'Staff 2 must be forbidden from editing Staff 1 schedule',
      );

      const ownerEditStaff1 = await makeRequest(
        `${baseUrl}/api/v1/schedules/${scheduleId}`,
        {
          method: 'PUT',
          headers: {
            Origin: allowedOrigin,
            Cookie: owner.cookie,
            'X-CSRF-Token': owner.csrfToken,
            'If-Match': `"${updateRes.body.data.schedule.version}"`,
          },
          body: {
            entries: [
              { work_date: '2026-10-12', day_of_week: 1, start_time: '08:00' },
            ],
          },
        },
      );
      assert.equal(
        ownerEditStaff1.status,
        403,
        'Owner cannot edit schedule on behalf of Staff',
      );

      // Staff cannot view schedule of another staff directly
      const staff2ViewStaff1 = await makeRequest(
        `${baseUrl}/api/v1/schedules/${scheduleId}`,
        {
          headers: { Cookie: staff2.cookie },
        },
      );
      assert.equal(
        staff2ViewStaff1.status,
        403,
        'Staff 2 must be forbidden from viewing Staff 1 schedule detail',
      );

      // Staff cannot access Owner schedule list endpoint (/api/v1/schedules) -> 403 FORBIDDEN
      const staffListSchedules = await makeRequest(
        `${baseUrl}/api/v1/schedules?week_start_date=${nextMon}`,
        {
          headers: { Cookie: staff1.cookie },
        },
      );
      assert.equal(
        staffListSchedules.status,
        403,
        'Staff must be forbidden from Owner schedule list',
      );

      // =========================================================================
      // Test 10: Owner views staff schedules by week and revision history
      // =========================================================================
      // Staff 2 also creates a schedule for next week
      await makeRequest(`${baseUrl}/api/v1/schedules`, {
        method: 'POST',
        headers: {
          Origin: allowedOrigin,
          Cookie: staff2.cookie,
          'X-CSRF-Token': staff2.csrfToken,
        },
        body: {
          week_start_date: nextMon,
          entries: [
            { work_date: '2026-10-13', day_of_week: 2, start_time: '13:00' },
          ],
        },
      });

      const ownerListRes = await makeRequest(
        `${baseUrl}/api/v1/schedules?week_start_date=${nextMon}`,
        {
          headers: { Cookie: owner.cookie },
        },
      );
      assert.equal(ownerListRes.status, 200, 'Owner can list schedules');
      assert.equal(
        ownerListRes.body.data.items.length,
        2,
        'Should find 2 staff schedules',
      );

      // Owner views schedule detail and revision history
      const ownerDetailRes = await makeRequest(
        `${baseUrl}/api/v1/schedules/${scheduleId}`,
        {
          headers: { Cookie: owner.cookie },
        },
      );
      assert.equal(ownerDetailRes.status, 200);
      assert.equal(ownerDetailRes.body.data.schedule.id, scheduleId);
      assert.equal(ownerDetailRes.body.data.revisions.length, 3);

      // =========================================================================
      // Test 11: Database Immutability Trigger Protection for Revisions
      // Direct UPDATE or DELETE on staff_schedule_revisions must fail closed
      // =========================================================================
      await assert.rejects(
        pool.query(
          `UPDATE staff_schedule_revisions SET reason = 'tampered' WHERE schedule_id = $1;`,
          [scheduleId],
        ),
        /staff_schedule_revisions is append-only/,
      );

      await assert.rejects(
        pool.query(
          `DELETE FROM staff_schedule_revisions WHERE schedule_id = $1;`,
          [scheduleId],
        ),
        /staff_schedule_revisions is append-only/,
      );

      // =========================================================================
      // Test 12: Isolation from ATT and PAY
      // Verify changing schedule does not insert or alter attendance_shifts
      // =========================================================================
      const shiftsRes = await pool.query(
        `SELECT COUNT(*) FROM attendance_shifts WHERE workspace_id = $1;`,
        [wsId],
      );
      assert.equal(
        parseInt(shiftsRes.rows[0].count, 10),
        0,
        'No shifts should be created or modified by schedule mutations',
      );
    } finally {
      await new Promise((res) => server.close(res));
    }
  } finally {
    await closeDatabasePool(pool);
  }
});
