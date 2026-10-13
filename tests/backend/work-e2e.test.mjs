import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';
import { resolve } from 'node:path';

test('WORK-01 E2E: Complete Owner/Staff lifecycle, RBAC, reviews, concurrency, and audit preservation', async (t) => {
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

  const { runMigrations, loadMigrationFiles } =
    await import('../../dist/packages/database/src/migrator.js');
  const { hashPassword } =
    await import('../../dist/packages/security/src/password.js');
  const { createRequestHandler } =
    await import('../../dist/apps/api/src/app.js');

  let server;

  try {
    // 1. Ensure migrations are applied cleanly
    const migrations = loadMigrationFiles(
      resolve('packages/database/src/migrations'),
    );
    await pool.query(
      'DROP TABLE IF EXISTS work_reviews, work_submissions, work_assignments, work_items CASCADE;' +
        'DROP FUNCTION IF EXISTS work_history_immutable, work_assignment_guard, work_submission_guard, work_review_guard, work_item_guard, work_aggregate_consistent CASCADE;' +
        "DELETE FROM schema_migrations WHERE id = '0010_m08_work';",
    );
    await runMigrations(pool, migrations);

    // 2. Set up test workspaces
    const workspaceId = crypto.randomUUID();
    const otherWorkspaceId = crypto.randomUUID();
    await pool.query(
      "INSERT INTO workspaces(id, name) VALUES($1, 'WORK E2E Shop'), ($2, 'Other Shop')",
      [workspaceId, otherWorkspaceId],
    );

    // 3. Start API HTTP server on loopback
    const origin = 'http://localhost:3001';
    const csrfSecret = crypto.randomBytes(32).toString('hex');
    server = http.createServer(
      createRequestHandler({
        pool,
        csrfSecret,
        allowedOrigins: [origin],
        isProduction: false,
      }),
    );
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const baseUrl = 'http://127.0.0.1:' + server.address().port;

    // Helper: make request with session cookie and CSRF
    async function apiRequest(
      path,
      actor,
      body,
      headers = {},
      methodOverride = undefined,
    ) {
      const method = methodOverride ?? (body === undefined ? 'GET' : 'POST');
      const res = await fetch(baseUrl + path, {
        method,
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
      const data = await res.json().catch(() => null);
      return {
        status: res.status,
        data,
        headers: res.headers,
      };
    }

    // Helper: create user, employee, membership, binding, and log in
    async function createActor(
      role,
      wsId = workspaceId,
      empCode = undefined,
      empName = undefined,
    ) {
      const userId = crypto.randomUUID();
      const empId = crypto.randomUUID();
      const username = 'e2e_' + userId.replaceAll('-', '');
      const email = username + '@example.test';
      const password = 'Password123!@#TestSafe';

      await pool.query(
        "INSERT INTO users(id, username_normalized, email_normalized, status) VALUES($1, $2, $3, 'active')",
        [userId, username, email],
      );
      await pool.query(
        'INSERT INTO user_credentials(user_id, password_hash) VALUES($1, $2)',
        [userId, await hashPassword(password)],
      );
      await pool.query(
        "INSERT INTO workspace_memberships(workspace_id, user_id, role, status) VALUES($1, $2, $3, 'active')",
        [wsId, userId, role],
      );
      await pool.query(
        "INSERT INTO user_workspace_bindings(workspace_id, user_id, status) VALUES($1, $2, 'active')",
        [wsId, userId],
      );

      if (empCode) {
        await pool.query(
          "INSERT INTO employees(id, workspace_id, user_id, employee_code, full_name, employment_status) VALUES($1, $2, $3, $4, $5, 'active')",
          [empId, wsId, userId, empCode, empName ?? empCode],
        );
      }

      // Login through API
      const loginRes = await fetch(baseUrl + '/api/v1/auth/login', {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          identifier: username,
          password,
        }),
      });

      assert.equal(loginRes.status, 200, `Login for ${username} must succeed`);
      const cookie = loginRes.headers.get('set-cookie');
      assert.ok(cookie, 'Login must issue session cookie');
      const loginData = await loginRes.json();
      const csrf = loginData.data?.csrf_token;
      assert.ok(csrf, 'Login must issue CSRF token');

      return {
        userId,
        empId,
        username,
        role,
        cookie,
        csrf,
      };
    }

    // Provision actors
    const owner = await createActor('owner', workspaceId);
    const staff1 = await createActor(
      'staff',
      workspaceId,
      'NV01',
      'Nguyễn Văn A',
    );
    const staff2 = await createActor(
      'staff',
      workspaceId,
      'NV02',
      'Trần Thị B',
    );
    const foreignStaff = await createActor(
      'staff',
      otherWorkspaceId,
      'OTHER01',
      'Người Lạ',
    );

    let createdWorkItem;
    let assignment1Id;
    let assignment2Id;
    let submission1Rev1Id;
    let submission1Rev2Id;

    // STEP 1: Staff resolves self employee identity via /api/v1/employees/me
    await t.test(
      'Step 1: Staff resolves employee identity from /api/v1/employees/me',
      async () => {
        const res = await apiRequest('/api/v1/employees/me', staff1);
        assert.equal(res.status, 200);
        assert.equal(res.data.data.id, staff1.empId);
        assert.equal(res.data.data.employee_code, 'NV01');
        assert.equal(res.data.data.full_name, 'Nguyễn Văn A');
      },
    );

    // STEP 2: Owner creates work item assigned to 2 employees
    await t.test(
      'Step 2: Owner creates work item and assigns multiple staff members',
      async () => {
        const res = await apiRequest('/api/v1/work-items', owner, {
          title: 'Kiểm kê kho hàng và đối chiếu số liệu',
          description: 'Kiểm kê kệ 1-5 và lập biên bản chi tiết',
          work_type: 'general',
          priority: 'high',
          due_at: '2026-10-15T17:00:00.000Z',
          assignee_ids: [staff1.empId, staff2.empId],
        });

        assert.equal(res.status, 201);
        assert.equal(res.data.success, true);
        createdWorkItem = res.data.data;
        assert.equal(
          createdWorkItem.title,
          'Kiểm kê kho hàng và đối chiếu số liệu',
        );
        assert.equal(createdWorkItem.status, 'todo');
        assert.equal(createdWorkItem.version, 1);
        assert.equal(createdWorkItem.assignments.length, 2);

        const a1 = createdWorkItem.assignments.find(
          (a) => a.employee_id === staff1.empId,
        );
        const a2 = createdWorkItem.assignments.find(
          (a) => a.employee_id === staff2.empId,
        );
        assert.ok(a1);
        assert.ok(a2);
        assert.equal(a1.status, 'todo');
        assert.equal(a2.status, 'todo');
        assignment1Id = a1.id;
        assignment2Id = a2.id;
      },
    );

    // STEP 3: Staff visibility, detail self-isolation, and cross-workspace denial
    await t.test(
      'Step 3: Staff sees only their assignment; foreign actor denied',
      async () => {
        // Staff 1 list
        const listStaff1 = await apiRequest('/api/v1/work-items', staff1);
        assert.equal(listStaff1.status, 200);
        assert.equal(listStaff1.data.data.total, 1);
        assert.equal(listStaff1.data.data.items[0].id, createdWorkItem.id);

        // Staff 1 detail: only sees their own assignment
        const detailStaff1 = await apiRequest(
          `/api/v1/work-items/${createdWorkItem.id}`,
          staff1,
        );
        assert.equal(detailStaff1.status, 200);
        assert.equal(detailStaff1.data.data.assignments.length, 1);
        assert.equal(
          detailStaff1.data.data.assignments[0].employee_id,
          staff1.empId,
        );

        // Staff 2 detail: only sees their own assignment
        const detailStaff2 = await apiRequest(
          `/api/v1/work-items/${createdWorkItem.id}`,
          staff2,
        );
        assert.equal(detailStaff2.status, 200);
        assert.equal(detailStaff2.data.data.assignments.length, 1);
        assert.equal(
          detailStaff2.data.data.assignments[0].employee_id,
          staff2.empId,
        );

        // Staff cannot query another employee's assignments
        const forbiddenFilter = await apiRequest(
          `/api/v1/work-items?assignee_id=${staff2.empId}`,
          staff1,
        );
        assert.equal(forbiddenFilter.status, 403);

        // Foreign actor denied
        const foreignAccess = await apiRequest(
          `/api/v1/work-items/${createdWorkItem.id}`,
          foreignStaff,
        );
        assert.equal(foreignAccess.status, 404);
      },
    );

    // STEP 4: Staff 1 starts work (todo -> in_progress)
    await t.test(
      'Step 4: Staff 1 starts work (todo -> in_progress)',
      async () => {
        const res = await apiRequest(
          `/api/v1/work-items/${createdWorkItem.id}/assignments/${assignment1Id}/start`,
          staff1,
          { note: 'Bắt đầu kiểm kê kệ 1-3' },
          { 'If-Match': `"${createdWorkItem.version}"` },
        );

        assert.equal(res.status, 200);
        createdWorkItem = res.data.data;
        assert.equal(createdWorkItem.status, 'in_progress');
        assert.equal(createdWorkItem.version, 2);

        const a1 = createdWorkItem.assignments.find(
          (a) => a.id === assignment1Id,
        );
        assert.equal(a1.status, 'in_progress');

        // Duplicate start is rejected
        const dupStart = await apiRequest(
          `/api/v1/work-items/${createdWorkItem.id}/assignments/${assignment1Id}/start`,
          staff1,
          { note: 'Bắt đầu lại' },
          { 'If-Match': `"${createdWorkItem.version}"` },
        );
        assert.equal(dupStart.status, 409);
      },
    );

    // STEP 5: Staff 1 submits work report (in_progress -> in_review, revision 1)
    await t.test(
      'Step 5: Staff 1 submits work report (revision 1)',
      async () => {
        const res = await apiRequest(
          `/api/v1/work-items/${createdWorkItem.id}/assignments/${assignment1Id}/submissions`,
          staff1,
          {
            submission_note:
              'Đã hoàn thành kiểm kê kệ 1 và 2. Tổng số: 150 mặt hàng.',
            attachments: [
              {
                name: 'bien_ban_kiem_ke_1.pdf',
                url: 'https://drive.google.com/file/d/abc12345/view',
              },
            ],
          },
          { 'If-Match': `"${createdWorkItem.version}"` },
        );

        assert.equal(res.status, 201);
        createdWorkItem = res.data.data;
        const a1 = createdWorkItem.assignments.find(
          (a) => a.id === assignment1Id,
        );
        assert.equal(a1.status, 'in_review');
        assert.equal(a1.submissions.length, 1);
        assert.equal(a1.submissions[0].revision_number, 1);
        assert.equal(
          a1.submissions[0].attachments[0].name,
          'bien_ban_kiem_ke_1.pdf',
        );
        submission1Rev1Id = a1.submissions[0].id;

        // Parent work item status remains in_progress because Staff 2 is still todo
        assert.equal(createdWorkItem.status, 'in_progress');
      },
    );

    // STEP 6: Owner reviews submission & requests changes (request_changes -> in_progress)
    await t.test('Step 6: Owner requests changes with feedback', async () => {
      // Owner review URL format matching WorkScreen.tsx:
      // /api/v1/work-items/:id/assignments/:assignmentId/submissions/:submissionId/reviews
      const reviewUrl = `/api/v1/work-items/${createdWorkItem.id}/assignments/${assignment1Id}/submissions/${submission1Rev1Id}/reviews`;

      // Missing feedback on request_changes must fail
      const missingFeedback = await apiRequest(
        reviewUrl,
        owner,
        {
          submission_id: submission1Rev1Id,
          decision: 'request_changes',
        },
        { 'If-Match': `"${createdWorkItem.version}"` },
      );
      assert.equal(missingFeedback.status, 400);

      // Stale If-Match must fail
      const staleReview = await apiRequest(
        reviewUrl,
        owner,
        {
          submission_id: submission1Rev1Id,
          decision: 'request_changes',
          feedback: 'Thiếu ảnh đối chiếu',
        },
        { 'If-Match': '"999"' },
      );
      assert.equal(staleReview.status, 412);

      // Valid request_changes
      const res = await apiRequest(
        reviewUrl,
        owner,
        {
          submission_id: submission1Rev1Id,
          decision: 'request_changes',
          feedback: 'Cần bổ sung ảnh chụp kệ 2 để đối chiếu số lượng thực tế',
        },
        { 'If-Match': `"${createdWorkItem.version}"` },
      );

      assert.equal(res.status, 200);
      createdWorkItem = res.data.data;
      const a1 = createdWorkItem.assignments.find(
        (a) => a.id === assignment1Id,
      );
      assert.equal(a1.status, 'in_progress');
      assert.equal(a1.reviews.length, 1);
      assert.equal(a1.reviews[0].decision, 'request_changes');
      assert.equal(
        a1.reviews[0].feedback,
        'Cần bổ sung ảnh chụp kệ 2 để đối chiếu số lượng thực tế',
      );
    });

    // STEP 7: Staff 1 re-submits report (revision 2, in_progress -> in_review)
    await t.test(
      'Step 7: Staff 1 re-submits report with revision 2',
      async () => {
        const res = await apiRequest(
          `/api/v1/work-items/${createdWorkItem.id}/assignments/${assignment1Id}/submissions`,
          staff1,
          {
            submission_note:
              'Đã bổ sung ảnh chụp kệ 2 và biên bản kiểm kê đầy đủ.',
            attachments: [
              {
                name: 'anh_chup_ke_2.png',
                url: 'https://drive.google.com/file/d/xyz98765/view',
              },
            ],
          },
          { 'If-Match': `"${createdWorkItem.version}"` },
        );

        assert.equal(res.status, 201);
        createdWorkItem = res.data.data;
        const a1 = createdWorkItem.assignments.find(
          (a) => a.id === assignment1Id,
        );
        assert.equal(a1.status, 'in_review');
        assert.equal(a1.submissions.length, 2);
        assert.deepEqual(
          a1.submissions.map((s) => s.revision_number),
          [1, 2],
        );
        submission1Rev2Id = a1.submissions[1].id;

        // Old submission (rev 1) cannot be reviewed now
        const reviewOld = await apiRequest(
          `/api/v1/work-items/${createdWorkItem.id}/assignments/${assignment1Id}/submissions/${submission1Rev1Id}/reviews`,
          owner,
          {
            submission_id: submission1Rev1Id,
            decision: 'approved',
          },
          { 'If-Match': `"${createdWorkItem.version}"` },
        );
        assert.equal(reviewOld.status, 409);
      },
    );

    // STEP 8: Owner approves Staff 1 submission (in_review -> completed)
    await t.test(
      'Step 8: Owner approves Staff 1 submission; item remains in_progress',
      async () => {
        const reviewUrl = `/api/v1/work-items/${createdWorkItem.id}/assignments/${assignment1Id}/submissions/${submission1Rev2Id}/reviews`;
        const res = await apiRequest(
          reviewUrl,
          owner,
          {
            submission_id: submission1Rev2Id,
            decision: 'approved',
            feedback: 'Số liệu khớp, duyệt hoàn thành phân công kệ 1-2',
          },
          { 'If-Match': `"${createdWorkItem.version}"` },
        );

        assert.equal(res.status, 200);
        createdWorkItem = res.data.data;
        const a1 = createdWorkItem.assignments.find(
          (a) => a.id === assignment1Id,
        );
        assert.equal(a1.status, 'completed');

        // CRITICAL INVARIANT: Parent work item must NOT be completed yet
        assert.equal(
          createdWorkItem.status,
          'in_progress',
          'Work item must stay in_progress when not all assignments are completed',
        );
      },
    );

    // STEP 9: Staff 2 starts, submits, and Owner approves -> Work item status completes!
    await t.test(
      'Step 9: Staff 2 completes work; entire work item transitions to completed',
      async () => {
        // Staff 2 starts
        const start2 = await apiRequest(
          `/api/v1/work-items/${createdWorkItem.id}/assignments/${assignment2Id}/start`,
          staff2,
          { note: 'Bắt đầu kiểm kê kệ 3-5' },
          { 'If-Match': `"${createdWorkItem.version}"` },
        );
        assert.equal(start2.status, 200);
        createdWorkItem = start2.data.data;

        // Staff 2 submits
        const submit2 = await apiRequest(
          `/api/v1/work-items/${createdWorkItem.id}/assignments/${assignment2Id}/submissions`,
          staff2,
          {
            submission_note:
              'Đã hoàn thành kiểm kê kệ 3, 4, 5. Không phát hiện thất thoát.',
            attachments: [
              {
                name: 'bien_ban_ke_3_5.pdf',
                url: 'https://drive.google.com/file/d/doc34567/view',
              },
            ],
          },
          { 'If-Match': `"${createdWorkItem.version}"` },
        );
        assert.equal(submit2.status, 201);
        createdWorkItem = submit2.data.data;
        const sub2Id = createdWorkItem.assignments.find(
          (a) => a.id === assignment2Id,
        ).submissions[0].id;

        // Owner approves Staff 2
        const reviewUrl = `/api/v1/work-items/${createdWorkItem.id}/assignments/${assignment2Id}/submissions/${sub2Id}/reviews`;
        const review2 = await apiRequest(
          reviewUrl,
          owner,
          {
            submission_id: sub2Id,
            decision: 'approved',
            feedback: 'Đã kiểm tra số liệu toàn diện. Tốt.',
          },
          { 'If-Match': `"${createdWorkItem.version}"` },
        );
        assert.equal(review2.status, 200);
        createdWorkItem = review2.data.data;

        // ALL assignments are completed
        assert.ok(
          createdWorkItem.assignments.every((a) => a.status === 'completed'),
        );
        // CRITICAL INVARIANT: Work item status is now completed
        assert.equal(
          createdWorkItem.status,
          'completed',
          'Work item must transition to completed when ALL assignments are completed',
        );
      },
    );

    // STEP 10: Owner cancels work item; history is preserved
    await t.test(
      'Step 10: Owner cancels work item while preserving full audit history',
      async () => {
        const cancelRes = await apiRequest(
          `/api/v1/work-items/${createdWorkItem.id}/cancel`,
          owner,
          { reason: 'Đóng ca kiểm kê định kỳ' },
          { 'If-Match': `"${createdWorkItem.version}"` },
        );

        assert.equal(cancelRes.status, 200);
        createdWorkItem = cancelRes.data.data;
        assert.equal(createdWorkItem.status, 'cancelled');

        // History in DB must be 100% preserved
        const dbAssignments = await pool.query(
          'SELECT count(*) FROM work_assignments WHERE work_item_id = $1',
          [createdWorkItem.id],
        );
        assert.equal(Number(dbAssignments.rows[0].count), 2);

        const dbSubmissions = await pool.query(
          'SELECT count(*) FROM work_submissions WHERE work_item_id = $1',
          [createdWorkItem.id],
        );
        assert.equal(Number(dbSubmissions.rows[0].count), 3); // 2 from staff1, 1 from staff2

        const dbReviews = await pool.query(
          'SELECT count(*) FROM work_reviews WHERE work_item_id = $1',
          [createdWorkItem.id],
        );
        assert.equal(Number(dbReviews.rows[0].count), 3); // 2 reviews for staff1, 1 review for staff2

        // Staff can still read the cancelled item
        const staffRead = await apiRequest(
          `/api/v1/work-items/${createdWorkItem.id}`,
          staff1,
        );
        assert.equal(staffRead.status, 200);
        assert.equal(staffRead.data.data.status, 'cancelled');

        // Further mutations on cancelled item are blocked
        const blockedStart = await apiRequest(
          `/api/v1/work-items/${createdWorkItem.id}/assignments/${assignment1Id}/start`,
          staff1,
          {},
          { 'If-Match': `"${createdWorkItem.version}"` },
        );
        assert.equal(blockedStart.status, 409);
      },
    );

    // STEP 11: CSRF, Origin, and RBAC boundary enforcement
    await t.test(
      'Step 11: CSRF absence, foreign origin, and Staff privilege escalation fail closed',
      async () => {
        // Missing CSRF token on POST
        const missingCsrf = await apiRequest(
          '/api/v1/work-items',
          { cookie: owner.cookie, csrf: '' },
          { title: 'Tạo trái phép' },
        );
        assert.equal(missingCsrf.status, 403);

        // Foreign Origin
        const foreignOrigin = await fetch(baseUrl + '/api/v1/work-items', {
          method: 'POST',
          headers: {
            Origin: 'http://malicious-site.test',
            'Content-Type': 'application/json',
            Cookie: owner.cookie,
            'X-CSRF-Token': owner.csrf,
          },
          body: JSON.stringify({ title: 'Tạo từ trang lạ' }),
        });
        assert.equal(foreignOrigin.status, 403);

        // Staff attempting to create work item
        const staffCreate = await apiRequest('/api/v1/work-items', staff1, {
          title: 'Staff cố tạo việc',
        });
        assert.equal(staffCreate.status, 403);
      },
    );
  } finally {
    if (server) {
      await new Promise((r) => server.close(r));
    }
    await pool.end();
  }
});
