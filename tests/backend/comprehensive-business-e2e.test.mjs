import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import http from 'node:http';

test('COMPREHENSIVE BUSINESS LOGIC E2E: Deep verification of all 13 core domains on isolated QA DB', async (t) => {
  if (
    !process.env.TEST_DATABASE_URL ||
    process.env.CONFIRM_ISOLATED_TEST_DB !== 'true'
  ) {
    t.skip(
      'Explicit isolated QA DB required (TEST_DATABASE_URL + CONFIRM_ISOLATED_TEST_DB=true)',
    );
    return;
  }

  const { loadTestDatabaseConfig, assertSafeTestDatabase } =
    await import('../../dist/packages/database/src/config.js');
  const cfg = loadTestDatabaseConfig();
  assertSafeTestDatabase(cfg);

  const { createDatabasePool, closeDatabasePool } =
    await import('../../dist/packages/database/src/pool.js');
  let pool = createDatabasePool(cfg);

  const { hashPassword } =
    await import('../../dist/packages/security/src/password.js');
  const { createRequestHandler } =
    await import('../../dist/apps/api/src/app.js');

  let server;

  try {
    // 1. Set up clean dedicated test workspace
    const workspaceId = crypto.randomUUID();
    const otherWsId = crypto.randomUUID();
    await pool.query(
      "INSERT INTO workspaces(id, name, timezone, status) VALUES($1, 'E2E Main Store', 'Asia/Ho_Chi_Minh', 'active'), ($2, 'Foreign Shop', 'Asia/Ho_Chi_Minh', 'active')",
      [workspaceId, otherWsId],
    );

    // 2. Start API HTTP server on ephemeral loopback port
    const origin = 'http://localhost:3001';
    const csrfSecret = crypto.randomBytes(32).toString('hex');
    const accountSecretKey = crypto.randomBytes(32);
    server = http.createServer(
      createRequestHandler({
        pool,
        csrfSecret,
        allowedOrigins: [origin],
        isProduction: false,
        accountSecretKey,
      }),
    );
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    let baseUrl = 'http://127.0.0.1:' + server.address().port;

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
      return { status: res.status, data, headers: res.headers };
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
      const randStr = crypto.randomBytes(4).toString('hex');
      const username = 'usr_' + randStr;
      const email = username + '@test.local';
      const password = 'Password123!@#TestSafe';

      await pool.query(
        "INSERT INTO users(id, username_normalized, email_normalized, status) VALUES($1, $2, $3, 'active')",
        [userId, username, email],
      );
      await pool.query(
        'INSERT INTO user_credentials(user_id, password_hash, credential_version) VALUES($1, $2, 1)',
        [userId, await hashPassword(password)],
      );
      await pool.query(
        "INSERT INTO workspace_memberships(workspace_id, user_id, role, status) VALUES($1, $2, $3, 'active')",
        [wsId, userId, role],
      );
      await pool.query(
        "INSERT INTO user_workspace_bindings(workspace_id, user_id, status, version) VALUES($1, $2, 'active', 1)",
        [wsId, userId],
      );

      const code =
        empCode ||
        (role === 'owner'
          ? `OWN_${randStr.toUpperCase()}`
          : `EMP_${randStr.toUpperCase()}`);
      const name =
        empName ||
        (role === 'owner' ? `Chủ tiệm ${randStr}` : `Nhân viên ${randStr}`);
      await pool.query(
        "INSERT INTO employees(id, workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible, version) VALUES($1, $2, $3, $4, $5, 'active', $6, 1)",
        [empId, wsId, userId, code, name, role !== 'owner'],
      );

      // Login
      const loginRes = await apiRequest('/api/v1/auth/login', null, {
        identifier: username,
        password,
      });
      assert.equal(loginRes.status, 200, `Login failed for ${username}`);
      const cookie = loginRes.headers.get('set-cookie').split(';')[0];
      const csrf = loginRes.data.data.csrf_token;

      return {
        userId,
        empId,
        username,
        email,
        password,
        role,
        workspaceId: wsId,
        cookie,
        csrf,
      };
    }

    const owner = await createActor(
      'owner',
      workspaceId,
      'OWNER_01',
      'Chủ cửa hàng',
    );
    await createActor('owner', otherWsId, 'OWN_FOR', 'Chủ tiệm khác');

    // =========================================================================
    // DOMAIN 1: EMPLOYEES (Nhân viên & Phân quyền Tài khoản)
    // =========================================================================
    let staff1 = null;
    let staff1InviteToken = null;
    const staff1Code = 'NV_E2E_01';
    const staff1Email = 'nva@e2e-business.test';
    const staff1Password = 'StaffSecret123!@#Pass';

    await t.test(
      'Domain 1: Employees - CRUD, activation, concurrency, suspension, and self-suspend guard',
      async () => {
        // 1.1 Owner creates staff employee
        const createRes = await apiRequest('/api/v1/employees', owner, {
          employee_code: staff1Code,
          full_name: 'Nguyễn Văn A',
          email: staff1Email,
        });
        assert.equal(createRes.status, 201);
        assert.equal(createRes.data.data.employee_code, staff1Code);
        assert.equal(createRes.data.data.employment_status, 'invited');
        assert.ok(
          createRes.data.data.invite_token,
          'Invite token must be returned',
        );
        staff1InviteToken = createRes.data.data.invite_token;
        const createdStaffId = createRes.data.data.id;

        // 1.2 Duplicate employee_code rejected with 409 CONFLICT
        const dupRes = await apiRequest('/api/v1/employees', owner, {
          employee_code: staff1Code,
          full_name: 'Trùng mã',
          email: 'another@test.local',
        });
        assert.equal(dupRes.status, 409);
        assert.equal(dupRes.data.error.code, 'CONFLICT');

        // 1.3 Staff activates account via invite token
        const activateRes = await apiRequest('/api/v1/auth/activate', null, {
          token: staff1InviteToken,
          new_password: staff1Password,
        });
        assert.equal(activateRes.status, 200);
        assert.equal(activateRes.data.success, true);

        // 1.4 Staff logs in
        const loginStaffRes = await apiRequest('/api/v1/auth/login', null, {
          identifier: staff1Email,
          password: staff1Password,
        });
        assert.equal(loginStaffRes.status, 200);
        const staffCookie = loginStaffRes.headers
          .get('set-cookie')
          .split(';')[0];
        const staffCsrf = loginStaffRes.data.data.csrf_token;
        staff1 = {
          userId: loginStaffRes.data.data.user.id,
          empId: createdStaffId,
          cookie: staffCookie,
          csrf: staffCsrf,
          email: staff1Email,
          password: staff1Password,
        };

        // 1.5 If-Match concurrency on employee update
        const curEmpRes = await apiRequest(
          `/api/v1/employees/${createdStaffId}`,
          owner,
        );
        assert.equal(curEmpRes.status, 200);
        const currentVersion = curEmpRes.data.data.version;

        // Missing If-Match -> 428
        const missingMatchRes = await apiRequest(
          `/api/v1/employees/${createdStaffId}`,
          owner,
          { full_name: 'Nguyễn Văn A Updated' },
          {},
          'PATCH',
        );
        assert.equal(missingMatchRes.status, 428);

        // Stale If-Match -> 412
        const staleMatchRes = await apiRequest(
          `/api/v1/employees/${createdStaffId}`,
          owner,
          { full_name: 'Nguyễn Văn A Updated' },
          { 'If-Match': '"999"' },
          'PATCH',
        );
        assert.equal(staleMatchRes.status, 412);

        // Valid If-Match -> 200 & version increments
        const validMatchRes = await apiRequest(
          `/api/v1/employees/${createdStaffId}`,
          owner,
          { full_name: 'Nguyễn Văn A Updated' },
          { 'If-Match': `"${currentVersion}"` },
          'PATCH',
        );
        assert.equal(validMatchRes.status, 200);
        assert.equal(validMatchRes.data.data.version, currentVersion + 1);

        // 1.6 Owner self-suspend guard (P0 Security Invariant: 403 Forbidden)
        const selfSuspendRes = await apiRequest(
          `/api/v1/employees/${owner.empId}/suspend`,
          owner,
          { reason: 'Self suspend test' },
          { 'If-Match': '"1"' },
        );
        assert.equal(selfSuspendRes.status, 403);
        assert.equal(selfSuspendRes.data.error.code, 'FORBIDDEN');

        // 1.7 Owner suspends staff employee -> Session revoked & login blocked
        const suspendRes = await apiRequest(
          `/api/v1/employees/${createdStaffId}/suspend`,
          owner,
          { reason: 'Suspension test' },
          { 'If-Match': `"${validMatchRes.data.data.version}"` },
        );
        assert.equal(suspendRes.status, 200);
        assert.equal(suspendRes.data.data.employment_status, 'suspended');

        // Active staff session is immediately revoked -> 401
        const meAfterSuspend = await apiRequest('/api/v1/employees/me', staff1);
        assert.equal(meAfterSuspend.status, 401);

        // Login attempt while suspended -> 409 WORKSPACE_CONTEXT_UNRESOLVED
        const loginWhileSuspended = await apiRequest(
          '/api/v1/auth/login',
          null,
          {
            identifier: staff1Email,
            password: staff1Password,
          },
        );
        assert.equal(loginWhileSuspended.status, 409);

        // 1.8 Reactivate staff employee -> Login succeeds again
        const suspendedVer = suspendRes.data.data.version;
        const reactivateRes = await apiRequest(
          `/api/v1/employees/${createdStaffId}/reactivate`,
          owner,
          {},
          { 'If-Match': `"${suspendedVer}"` },
        );
        assert.equal(reactivateRes.status, 200);
        assert.equal(reactivateRes.data.data.employment_status, 'active');

        const reLoginRes = await apiRequest('/api/v1/auth/login', null, {
          identifier: staff1Email,
          password: staff1Password,
        });
        assert.equal(reLoginRes.status, 200);
        staff1.cookie = reLoginRes.headers.get('set-cookie').split(';')[0];
        staff1.csrf = reLoginRes.data.data.csrf_token;
      },
    );

    // =========================================================================
    // DOMAIN 2: ATTENDANCE (Chấm công, Nghỉ giữa ca, Ca đêm, Phê duyệt)
    // =========================================================================
    let shiftId = null;
    await t.test(
      'Domain 2: Attendance - Clock-in, breaks, resume, clock-out, review & approval',
      async () => {
        // 2.1 Staff clock-in
        const clockInRes = await apiRequest(
          '/api/v1/attendance/shifts',
          staff1,
          {},
        );
        assert.equal(clockInRes.status, 201);
        shiftId = clockInRes.data.data.shift_id || clockInRes.data.data.id;
        assert.ok(shiftId, 'Must return active shift ID');

        // 2.2 Staff starts break
        const breakRes = await apiRequest(
          `/api/v1/attendance/shifts/${shiftId}/breaks`,
          staff1,
          {},
        );
        assert.equal(breakRes.status, 200);

        // 2.3 Staff resumes work
        const resumeRes = await apiRequest(
          `/api/v1/attendance/shifts/${shiftId}/resume`,
          staff1,
          {},
        );
        assert.equal(resumeRes.status, 200);

        // 2.4 Staff clock-out
        const clockOutRes = await apiRequest(
          `/api/v1/attendance/shifts/${shiftId}/clock-out`,
          staff1,
          {},
        );
        assert.equal(clockOutRes.status, 200);

        // 2.5 Owner reviews and approves shift
        const reviewRes = await apiRequest(
          `/api/v1/attendance/shifts/${shiftId}/reviews`,
          owner,
          {
            decision: 'approved',
            reason: 'Ca làm việc đã được kiểm tra đầy đủ',
          },
        );
        assert.equal(reviewRes.status, 200);
        assert.equal(reviewRes.data.data.review_state, 'approved');

        // 2.6 Verify attendance history /me for staff
        const attMeRes = await apiRequest('/api/v1/attendance/me', staff1);
        assert.equal(attMeRes.status, 200);
        assert.ok(Array.isArray(attMeRes.data.data.recent_shifts));
        assert.ok(attMeRes.data.data.recent_shifts.length >= 1);
      },
    );

    // =========================================================================
    // DOMAIN 3: SCHEDULES (Lịch làm việc, Trùng ca, Đăng ký & Xuất bản)
    // =========================================================================
    await t.test(
      'Domain 3: Schedules - Staff register schedule, owner view, /schedules/me',
      async () => {
        // 3.1 Staff registers schedule for Monday 2026-10-19
        const schedRes = await apiRequest('/api/v1/schedules', staff1, {
          week_start_date: '2026-10-19',
          entries: [
            {
              work_date: '2026-10-19',
              day_of_week: 1,
              start_time: '08:00',
              notes: 'Ca sáng thứ hai',
            },
            {
              work_date: '2026-10-20',
              day_of_week: 2,
              start_time: '13:00',
              notes: 'Ca chiều thứ ba',
            },
          ],
        });
        assert.equal(schedRes.status, 201);
        assert.equal(schedRes.data.data.schedule.week_start_date, '2026-10-19');
        assert.equal(schedRes.data.data.entries.length, 2);

        // 3.2 Owner views schedules for that week
        const ownerSchedRes = await apiRequest(
          '/api/v1/schedules?week_start_date=2026-10-19',
          owner,
        );
        assert.equal(ownerSchedRes.status, 200);
        assert.ok(Array.isArray(ownerSchedRes.data.data.items));
        assert.ok(ownerSchedRes.data.data.items.length >= 1);

        // 3.3 Staff views their schedule (/schedules/me)
        const staffSchedRes = await apiRequest(
          '/api/v1/schedules/me?week_start_date=2026-10-19',
          staff1,
        );
        assert.equal(staffSchedRes.status, 200);
        assert.ok(staffSchedRes.data.data.schedule);
      },
    );

    // =========================================================================
    // DOMAIN 4: WORK (Quản lý công việc: Create, Assign, Submit, Review, Complete)
    // =========================================================================
    await t.test(
      'Domain 4: Work - Full lifecycle: create, assign, start, submit, request changes, approve',
      async () => {
        // 4.1 Owner creates work item assigned to staff1
        const createWorkRes = await apiRequest(
          '/api/v1/work-items',
          owner,
          {
            title: 'Bảo trì hệ thống POS',
            description: 'Kiểm tra máy quét mã vạch và máy in hóa đơn',
            work_type: 'general',
            priority: 'high',
            due_at: '2026-10-15T17:00:00.000Z',
            assignee_ids: [staff1.empId],
          },
          { 'Idempotency-Key': 'work-create-' + crypto.randomUUID() },
        );
        assert.equal(createWorkRes.status, 201);
        let workItem = createWorkRes.data.data;
        const workItemId = workItem.id;
        assert.equal(workItem.assignments.length, 1);
        const assignment = workItem.assignments[0];
        const assignmentId = assignment.id;
        assert.equal(assignment.employee_id, staff1.empId);

        // 4.2 Staff1 views assigned tasks
        const staffWorkRes = await apiRequest('/api/v1/work-items', staff1);
        assert.equal(staffWorkRes.status, 200);
        const foundItem = staffWorkRes.data.data.items.find(
          (i) => i.id === workItemId,
        );
        assert.ok(foundItem, 'Assigned work item must be visible to staff');

        // 4.3 Staff1 starts work (transitions to in_progress)
        const startRes = await apiRequest(
          `/api/v1/work-items/${workItemId}/assignments/${assignmentId}/start`,
          staff1,
          { note: 'Bắt đầu kiểm tra máy quét' },
          {
            'Idempotency-Key': 'work-start-' + crypto.randomUUID(),
            'If-Match': `"${workItem.version}"`,
          },
        );
        assert.equal(startRes.status, 200);
        workItem = startRes.data.data;
        assert.equal(workItem.status, 'in_progress');

        // 4.4 Staff1 submits deliverable (revision 1)
        const submit1Res = await apiRequest(
          `/api/v1/work-items/${workItemId}/assignments/${assignmentId}/submissions`,
          staff1,
          {
            submission_note:
              'Đã hoàn thành kiểm tra máy quét, máy in bị kẹt giấy nhẹ',
            attachments: [],
          },
          {
            'Idempotency-Key': 'work-sub1-' + crypto.randomUUID(),
            'If-Match': `"${workItem.version}"`,
          },
        );
        assert.equal(submit1Res.status, 201);
        workItem = submit1Res.data.data;
        const a1AfterSub1 = workItem.assignments.find(
          (a) => a.id === assignmentId,
        );
        assert.equal(a1AfterSub1.status, 'in_review');
        const submission1Id = a1AfterSub1.submissions[0].id;

        // 4.5 Owner requests changes
        const review1Res = await apiRequest(
          `/api/v1/work-items/${workItemId}/assignments/${assignmentId}/submissions/${submission1Id}/reviews`,
          owner,
          {
            submission_id: submission1Id,
            decision: 'request_changes',
            feedback: 'Vui lòng vệ sinh trục cuốn máy in để hết kẹt hẳn',
          },
          {
            'Idempotency-Key': 'work-rev1-' + crypto.randomUUID(),
            'If-Match': `"${workItem.version}"`,
          },
        );
        assert.equal(review1Res.status, 200);
        workItem = review1Res.data.data;

        // 4.6 Staff1 re-submits report (revision 2)
        const submit2Res = await apiRequest(
          `/api/v1/work-items/${workItemId}/assignments/${assignmentId}/submissions`,
          staff1,
          {
            submission_note:
              'Đã thay trục cao su mới, in thử 10 hóa đơn đều mượt',
            attachments: [],
          },
          {
            'Idempotency-Key': 'work-sub2-' + crypto.randomUUID(),
            'If-Match': `"${workItem.version}"`,
          },
        );
        assert.equal(submit2Res.status, 201);
        workItem = submit2Res.data.data;
        const a1AfterSub2 = workItem.assignments.find(
          (a) => a.id === assignmentId,
        );
        assert.equal(a1AfterSub2.submissions.length, 2);
        const submission2Id = a1AfterSub2.submissions[1].id;

        // 4.7 Owner approves submission -> item marked completed
        const review2Res = await apiRequest(
          `/api/v1/work-items/${workItemId}/assignments/${assignmentId}/submissions/${submission2Id}/reviews`,
          owner,
          {
            submission_id: submission2Id,
            decision: 'approved',
            feedback: 'Xuất sắc, nghiệm thu hoàn thành',
          },
          {
            'Idempotency-Key': 'work-rev2-' + crypto.randomUUID(),
            'If-Match': `"${workItem.version}"`,
          },
        );
        assert.equal(review2Res.status, 200);
        workItem = review2Res.data.data;
        assert.equal(workItem.status, 'completed');
      },
    );

    // =========================================================================
    // DOMAIN 5: FINANCE (Tài chính: Thu/Chi, Kế hoạch, Dòng tiền, Bất biến)
    // =========================================================================
    await t.test(
      'Domain 5: Finance - Categories, income/expense entries, summary balance math, plan items',
      async () => {
        // 5.1 Owner creates income category
        const catIncomeRes = await apiRequest(
          '/api/v1/fin/categories',
          owner,
          {
            direction: 'income',
            name: 'Doanh thu bán lẻ POS',
          },
          { 'Idempotency-Key': 'fin-cat-inc-' + crypto.randomUUID() },
        );
        assert.equal(catIncomeRes.status, 201);
        const incCatId = catIncomeRes.data.data.id;

        // 5.2 Owner creates expense category
        const catExpenseRes = await apiRequest(
          '/api/v1/fin/categories',
          owner,
          {
            direction: 'expense',
            name: 'Chi phí văn phòng phẩm',
          },
          { 'Idempotency-Key': 'fin-cat-exp-' + crypto.randomUUID() },
        );
        assert.equal(catExpenseRes.status, 201);
        const expCatId = catExpenseRes.data.data.id;

        // 5.3 Owner creates income entry: 10,000,000 VND
        const entryIncRes = await apiRequest(
          '/api/v1/fin/entries',
          owner,
          {
            direction: 'income',
            category_id: incCatId,
            amount_vnd: '10000000',
            occurred_on: '2026-10-14',
            note: 'Doanh thu ca sáng',
          },
          { 'Idempotency-Key': 'fin-entry-inc-' + crypto.randomUUID() },
        );
        assert.equal(entryIncRes.status, 201);

        // 5.4 Owner creates expense entry: 3,500,000 VND
        const entryExpRes = await apiRequest(
          '/api/v1/fin/entries',
          owner,
          {
            direction: 'expense',
            category_id: expCatId,
            amount_vnd: '3500000',
            occurred_on: '2026-10-14',
            note: 'Mua giấy in nhiệt',
          },
          { 'Idempotency-Key': 'fin-entry-exp-' + crypto.randomUUID() },
        );
        assert.equal(entryExpRes.status, 201);

        // 5.5 Verify cash flow summary balance math
        // Net = 10,000,000 - 3,500,000 = 6,500,000 VND
        const summaryRes = await apiRequest(
          '/api/v1/fin/summary?period=month&anchor=2026-10-14',
          owner,
        );
        assert.equal(summaryRes.status, 200);
        assert.equal(summaryRes.data.data.total_income_vnd, '10000000');
        assert.equal(summaryRes.data.data.total_expense_vnd, '3500000');
        assert.equal(summaryRes.data.data.net_vnd, '6500000');

        // 5.6 Financial Plan item
        const planRes = await apiRequest(
          '/api/v1/fin/plan-items',
          owner,
          {
            direction: 'income',
            category_id: incCatId,
            amount_vnd: '50000000',
          },
          { 'Idempotency-Key': 'fin-plan-' + crypto.randomUUID() },
        );
        assert.equal(planRes.status, 201);

        // 5.7 Staff is blocked from accessing Finance (403 FORBIDDEN)
        const staffFinRes = await apiRequest('/api/v1/fin/entries', staff1);
        assert.equal(staffFinRes.status, 403);
      },
    );

    // =========================================================================
    // DOMAIN 6: PAYROLL (Bảng lương: Hourly Rate, Adjustments, Overview)
    // =========================================================================
    await t.test(
      'Domain 6: Payroll - Set hourly rate, overview math, bonus adjustment, staff payslip',
      async () => {
        // 6.1 Owner sets staff1 hourly rate: 50,000 VND/h (integer number)
        const rateRes = await apiRequest(
          '/api/v1/payroll/hourly-rates',
          owner,
          {
            employee_id: staff1.empId,
            hourly_rate_vnd: 50000,
            effective_from: '2026-10-01',
          },
          { 'Idempotency-Key': 'pay-rate-' + crypto.randomUUID() },
        );
        assert.equal(rateRes.status, 201);

        // 6.2 Owner checks payroll periods
        const periodsRes = await apiRequest('/api/v1/payroll/periods', owner);
        assert.equal(periodsRes.status, 200);

        // 6.3 Owner adds paid leave adjustment: 200,000 VND
        const adjRes = await apiRequest(
          '/api/v1/payroll/periods/2026-10/adjustments',
          owner,
          {
            employee_id: staff1.empId,
            adjustment_type: 'paid_leave',
            attributable_date: '2026-10-14',
            amount_vnd: 200000,
            reason: 'Nghỉ phép có hưởng lương theo quy định',
          },
          { 'Idempotency-Key': 'pay-adj-' + crypto.randomUUID() },
        );
        assert.equal(adjRes.status, 201);

        // 6.4 Owner checks payroll overview for 2026-10
        const overviewRes = await apiRequest(
          '/api/v1/payroll/periods/2026-10',
          owner,
        );
        assert.equal(overviewRes.status, 200);
        assert.ok(overviewRes.data.data);

        // 6.5 Staff checks personal payslip (/payroll/periods/2026-10/me)
        const mePayRes = await apiRequest(
          '/api/v1/payroll/periods/2026-10/me',
          staff1,
        );
        assert.equal(mePayRes.status, 200);
      },
    );

    // =========================================================================
    // DOMAIN 7: REPORTS (Báo cáo ngày: Draft, Submit, Revise, RBAC Isolation)
    // =========================================================================
    await t.test(
      'Domain 7: Reports - Daily report draft, submit, foreign staff blocked, owner view all',
      async () => {
        // 7.1 Staff1 creates daily report draft
        const draftRes = await apiRequest('/api/v1/reports/daily', staff1, {
          report_date: '2026-10-14',
          notes: 'Báo cáo bán hàng và bảo trì ca sáng',
          entries: [
            {
              work_type: 'sales',
              reported_count: 15,
              notes: 'Bán được 15 đơn hàng',
            },
            {
              work_type: 'maintenance',
              reported_count: 2,
              notes: 'Máy in hóa đơn đã được thay trục mới',
            },
          ],
        });
        assert.equal(draftRes.status, 201);
        const reportId = draftRes.data.data.id;

        // 7.2 Staff1 submits report
        const submitRepRes = await apiRequest(
          `/api/v1/reports/daily/${reportId}/submit`,
          staff1,
          {},
          { 'If-Match': `"${draftRes.data.data.version}"` },
        );
        assert.equal(submitRepRes.status, 200);
        assert.equal(submitRepRes.data.data.status, 'submitted');

        // 7.3 Foreign staff or user from other workspace cannot access report
        const foreignStaff = await createActor(
          'staff',
          otherWsId,
          'STAFF_FOR',
          'Nhân viên tiệm khác',
        );
        const foreignAccessRes = await apiRequest(
          `/api/v1/reports/daily/${reportId}`,
          foreignStaff,
        );
        assert.ok(
          [403, 404].includes(foreignAccessRes.status),
          'Foreign actor must be denied',
        );

        // 7.4 Owner views all daily reports
        const allReportsRes = await apiRequest('/api/v1/reports/daily', owner);
        assert.equal(allReportsRes.status, 200);
        const foundReport = allReportsRes.data.data.items.find(
          (r) => r.id === reportId,
        );
        assert.ok(foundReport, 'Owner must see staff submitted report');
      },
    );

    // =========================================================================
    // DOMAIN 8: BUG REPORT & AI MANAGEMENT (Báo lỗi, AI Phân tích, Owner Close Guard)
    // =========================================================================
    await t.test(
      'Domain 8: Bug/AI Lifecycle - Create bug, AI analysis, test pass -> awaiting_owner, Staff close blocked, Owner close succeeds',
      async () => {
        // 8.1 Staff or Owner creates bug report
        const createBugRes = await apiRequest(
          '/api/v1/issues',
          owner,
          {
            title: 'Lỗi hiển thị thanh cuộn trên màn hình Chấm công',
            description:
              'Khi danh sách ca làm việc quá 20 mục, bảng chấm công bị tràn khung nhìn',
            route_template: '/attendance',
            severity: 'P2',
            type: 'bug',
          },
          { 'Idempotency-Key': 'bug-create-' + crypto.randomUUID() },
        );
        assert.equal(createBugRes.status, 201);
        const bugId = createBugRes.data.data.id;
        assert.equal(createBugRes.data.data.status, 'open');

        // 8.2 AI Analysis: transitions to analyzing -> fixing with structured proposals
        const analyzeRes = await apiRequest(
          `/api/v1/issues/${bugId}/analyze`,
          owner,
          {},
        );
        assert.equal(analyzeRes.status, 200);
        assert.equal(analyzeRes.data.data.issue.status, 'fixing');
        assert.ok(
          analyzeRes.data.data.analysis,
          'Must return structured analysis',
        );

        // 8.3 Automated fix verification test run: test_result = 'passed'
        // CRITICAL INVARIANT: Passing test MUST NOT auto-close the bug! It must transition to awaiting_owner!
        const verifyRes = await apiRequest(
          `/api/v1/issues/${bugId}/verify`,
          owner,
          {
            commit_sha: 'a1b2c3d4e5f67890123456789012345678901234',
            test_result: 'passed',
          },
        );
        assert.equal(verifyRes.status, 200);
        assert.equal(
          verifyRes.data.data.status,
          'awaiting_owner',
          'P0 Invariant: Test PASS must transition to awaiting_owner, NEVER auto-close!',
        );
        assert.equal(
          verifyRes.data.data.closed_at,
          null,
          'Bug must not have closed_at set',
        );

        // 8.4 Non-owner (Staff) attempts to confirm fix / close bug -> 403 FORBIDDEN
        const staffCloseRes = await apiRequest(
          `/api/v1/issues/${bugId}/confirm-fix`,
          staff1,
          { comment: 'Staff trying to close bug' },
          {
            'If-Match': `"${verifyRes.data.data.version}"`,
            'Idempotency-Key': 'staff-close-' + crypto.randomUUID(),
          },
        );
        assert.equal(
          staffCloseRes.status,
          403,
          'P0 Invariant: Backend MUST forbid Staff from closing or confirming bug fix!',
        );

        // 8.5 Owner confirms fix and closes the bug
        const ownerCloseRes = await apiRequest(
          `/api/v1/issues/${bugId}/confirm-fix`,
          owner,
          {
            comment:
              'Owner đã kiểm tra trên giao diện thật: cuộn mượt mà, xác nhận sửa thành công',
          },
          {
            'If-Match': `"${verifyRes.data.data.version}"`,
            'Idempotency-Key': 'owner-close-' + crypto.randomUUID(),
          },
        );
        assert.equal(ownerCloseRes.status, 200);
        assert.equal(ownerCloseRes.data.data.status, 'fixed');
        assert.ok(
          ownerCloseRes.data.data.closed_at,
          'closed_at must be populated',
        );
        assert.equal(
          ownerCloseRes.data.data.version,
          verifyRes.data.data.version + 1,
        );
      },
    );

    // =========================================================================
    // DOMAIN 9: SECURITY & RBAC (Bảo mật, CSRF, Origin, Session Revocation)
    // =========================================================================
    await t.test(
      'Domain 9: Security & RBAC - Staff blocked from Owner routes, CSRF enforcement, Origin checks, Logout',
      async () => {
        // 9.1 Staff is blocked from Owner-only endpoints (403 FORBIDDEN)
        const empListStaffRes = await apiRequest('/api/v1/employees', staff1, {
          employee_code: 'NV_HACK',
          full_name: 'Hack',
          email: 'hack@test.local',
        });
        assert.equal(empListStaffRes.status, 403);

        const finStaffRes = await apiRequest('/api/v1/fin/summary', staff1);
        assert.equal(finStaffRes.status, 403);

        const auditStaffRes = await apiRequest('/api/v1/audit', staff1);
        assert.equal(auditStaffRes.status, 403);

        // 9.2 CSRF Protection: mutation without CSRF token fails with 403
        const noCsrfRes = await apiRequest(
          '/api/v1/work-items',
          { cookie: owner.cookie, csrf: '' }, // empty csrf
          { title: 'No CSRF Test' },
        );
        assert.equal(noCsrfRes.status, 403);

        // 9.3 Origin check: mutation with untrusted origin fails with 403
        const badOriginRes = await apiRequest(
          '/api/v1/work-items',
          owner,
          { title: 'Bad Origin Test' },
          { Origin: 'https://malicious-site.com' },
        );
        assert.equal(badOriginRes.status, 403);

        // 9.4 Logout clears session and invalidates access
        const logoutRes = await apiRequest('/api/v1/auth/logout', staff1, {});
        assert.ok([200, 204].includes(logoutRes.status));
        assert.ok(logoutRes.headers.get('set-cookie').includes('Max-Age=0'));

        // Subsequent request using old cookie returns 401 UNAUTHENTICATED
        const meAfterLogout = await apiRequest('/api/v1/auth/me', staff1);
        assert.equal(meAfterLogout.status, 401);
      },
    );

    // =========================================================================
    // DOMAIN 10: VAULT (Tài khoản được quản lý & Mã hóa bí mật AEAD)
    // =========================================================================
    const staffActive = await createActor(
      'staff',
      workspaceId,
      'NV_E2E_02',
      'Nguyễn Văn B',
    );
    const otherWsActor = await createActor(
      'owner',
      otherWsId,
      'OTHER_OWN_02',
      'Chủ tiệm khác',
    );

    await t.test(
      'Domain 10: Vault - Managed accounts, AEAD secret encrypt/reveal, single-use reauth, archive/restore, tenant isolation',
      async () => {
        // 10.1 Owner creates managed account
        const createAccRes = await apiRequest('/api/v1/accounts', owner, {
          platform: 'tiktok',
          username: 'hoai_phuong_shop',
          platform_account_id: 'tiktok_acc_001',
          notes: 'Kênh TikTok chính thức cửa hàng',
        });
        assert.equal(createAccRes.status, 201);
        const accountId = createAccRes.data.data.id;
        assert.ok(accountId);
        assert.equal(createAccRes.data.data.platform, 'tiktok');
        assert.equal(createAccRes.data.data.username, 'hoai_phuong_shop');
        assert.equal(createAccRes.data.data.status, 'active');

        // 10.2 Owner requests single-use reauth proof for secret write
        const reauthWriteRes = await apiRequest('/api/v1/auth/reauth', owner, {
          password: 'Password123!@#TestSafe',
          action: 'secret_write',
          account_id: accountId,
        });
        assert.equal(reauthWriteRes.status, 200);
        const writeProof = reauthWriteRes.data.data.reauth_proof;
        assert.ok(writeProof);

        // 10.3 Owner saves secret (AEAD encrypted with If-Match concurrency guard)
        const putSecretRes = await apiRequest(
          `/api/v1/accounts/${accountId}/secrets`,
          owner,
          {
            secret_type: 'password',
            secret_value: 'SuperSecretT1kt0kP@ssword2026!',
            reauth_proof: writeProof,
          },
          { 'If-Match': `"${createAccRes.data.data.version}"` },
          'PUT',
        );
        assert.equal(putSecretRes.status, 200);
        assert.equal(putSecretRes.data.data.secret_version, 1);
        const updatedAccountVersion = createAccRes.data.data.version + 1;

        // 10.4 Owner requests single-use reauth proof for secret reveal
        const reauthRevealRes = await apiRequest('/api/v1/auth/reauth', owner, {
          password: 'Password123!@#TestSafe',
          action: 'secret_reveal',
          account_id: accountId,
        });
        assert.equal(reauthRevealRes.status, 200);
        const revealProof = reauthRevealRes.data.data.reauth_proof;
        assert.ok(revealProof);

        // 10.5 Owner reveals secret with valid proof -> decrypted plaintext matches
        const revealRes = await apiRequest(
          `/api/v1/accounts/${accountId}/secrets/reveal`,
          owner,
          {
            secret_type: 'password',
            reauth_proof: revealProof,
          },
        );
        assert.equal(revealRes.status, 200);
        assert.equal(
          revealRes.data.data.secret_value,
          'SuperSecretT1kt0kP@ssword2026!',
          'Decrypted secret must match original plaintext',
        );

        // 10.6 Single-use invariant: Replaying used reauth proof FAILS closed with 403
        const replayRes = await apiRequest(
          `/api/v1/accounts/${accountId}/secrets/reveal`,
          owner,
          {
            secret_type: 'password',
            reauth_proof: revealProof,
          },
        );
        assert.equal(
          replayRes.status,
          403,
          'Replaying consumed reauth proof must fail closed with 403',
        );

        // 10.7 Staff attempts reveal -> 403 Forbidden
        const staffRevealRes = await apiRequest(
          `/api/v1/accounts/${accountId}/secrets/reveal`,
          staffActive,
          {
            secret_type: 'password',
            reauth_proof: 'invalid-or-stolen-proof',
          },
        );
        assert.equal(
          staffRevealRes.status,
          403,
          'Staff must be forbidden from revealing account secrets',
        );

        // 10.8 Archive & Restore lifecycle (with If-Match concurrency guard)
        const archiveRes = await apiRequest(
          `/api/v1/accounts/${accountId}/archive`,
          owner,
          { reason: 'Tạm dừng chạy quảng cáo TikTok' },
          { 'If-Match': `"${updatedAccountVersion}"` },
        );
        assert.equal(archiveRes.status, 200);
        assert.equal(archiveRes.data.data.status, 'archived');

        const restoreRes = await apiRequest(
          `/api/v1/accounts/${accountId}/restore`,
          owner,
          {},
          { 'If-Match': `"${archiveRes.data.data.version}"` },
        );
        assert.equal(restoreRes.status, 200);
        assert.equal(restoreRes.data.data.status, 'active');

        // 10.9 Cross-workspace isolation: Other workspace user cannot access account
        const crossWsRes = await apiRequest(
          `/api/v1/accounts/${accountId}`,
          otherWsActor,
        );
        assert.equal(
          crossWsRes.status,
          404,
          'Cross-workspace account query must return 404',
        );
      },
    );

    // =========================================================================
    // DOMAIN 11: STORAGE (Quản lý Google Drive, Biên nhận & Group Trash)
    // =========================================================================
    await t.test(
      'Domain 11: Storage - Folder creation, receipts, fail-closed delete-readiness, cross-workspace isolation',
      async () => {
        // 11.1 Owner creates source folder
        const createFolderRes = await apiRequest(
          '/api/v1/storage/folders',
          owner,
          {
            name: 'Nguồn Thiết Kế Quý 4',
            drive_url:
              'https://drive.google.com/drive/folders/test_drive_folder_source_001',
            folder_type: 'source',
            assigned_employee_ids: [staffActive.empId],
            notes: 'Tài liệu nguồn thiết kế cho nhân viên',
          },
        );
        assert.equal(createFolderRes.status, 201);
        const folderId = createFolderRes.data.data.id;
        assert.ok(folderId);
        assert.equal(createFolderRes.data.data.folder_type, 'source');
        assert.equal(createFolderRes.data.data.status, 'ready_for_download');

        // 11.2 List folders includes new folder
        const listFoldersRes = await apiRequest(
          '/api/v1/storage/folders',
          owner,
        );
        assert.equal(listFoldersRes.status, 200);
        const foundFolder = listFoldersRes.data.data.find(
          (f) => f.id === folderId,
        );
        assert.ok(foundFolder);

        // 11.3 Get folder detail with ETag and delete_readiness
        const getFolderRes = await apiRequest(
          `/api/v1/storage/folders/${folderId}`,
          owner,
        );
        assert.equal(getFolderRes.status, 200);
        assert.ok(getFolderRes.headers.get('etag'));
        assert.ok(getFolderRes.data.data.delete_readiness);
        assert.equal(
          getFolderRes.data.data.delete_readiness.is_ready,
          false,
          'Initial folder with pending downloads/deliverables must not be ready for deletion',
        );

        // 11.4 Staff confirms download receipt
        const downloadReceiptRes = await apiRequest(
          `/api/v1/storage/folders/${folderId}/receipts`,
          staffActive,
          {
            receipt_type: 'download',
            notes: 'Nhân viên đã tải đầy đủ tài liệu nguồn về máy',
          },
        );
        assert.equal(downloadReceiptRes.status, 201);
        assert.equal(downloadReceiptRes.data.data.receipt_type, 'download');

        // 11.5 Fail-Closed Group Trash Protocol:
        // Trying to trash folder group when deliverables are not completed fails with 409
        const trashReqRes = await apiRequest(
          `/api/v1/storage/folders/${folderId}/trash-requests`,
          owner,
          {
            version: getFolderRes.data.data.version,
            group_snapshot_hash:
              getFolderRes.data.data.delete_readiness.group_snapshot_hash,
          },
        );
        assert.equal(
          trashReqRes.status,
          409,
          'P0 Invariant: Fail-closed group trash must reject incomplete folder groups with 409',
        );
        assert.equal(
          trashReqRes.data.error.code,
          'CANNOT_TRASH_INCOMPLETE_GROUP',
        );

        // 11.6 Cross-workspace isolation
        const crossWsRes = await apiRequest(
          `/api/v1/storage/folders/${folderId}`,
          otherWsActor,
        );
        assert.equal(
          crossWsRes.status,
          404,
          'Cross-workspace storage folder query must return 404',
        );
      },
    );

    // =========================================================================
    // DOMAIN 12: AUDIT LOG & IMMUTABILITY (Nhật ký kiểm toán hệ thống)
    // =========================================================================
    await t.test(
      'Domain 12: Audit Log - Owner-only access, sensitive metadata scrubbing, append-only immutability, workspace isolation',
      async () => {
        // 12.1 Owner queries audit log
        const auditRes = await apiRequest('/api/v1/audit?limit=50', owner);
        assert.equal(auditRes.status, 200);
        assert.ok(Array.isArray(auditRes.data.data.items));
        assert.ok(auditRes.data.data.items.length > 0);

        // 12.2 Staff querying audit log -> 403 FORBIDDEN
        const staffAuditRes = await apiRequest('/api/v1/audit', staffActive);
        assert.equal(
          staffAuditRes.status,
          403,
          'P0 Invariant: Non-owner staff must be rejected from audit logs',
        );

        // 12.3 Sensitive metadata sanitization: verify NO passwords, secrets, or tokens exist in metadata
        for (const event of auditRes.data.data.items) {
          const metaStr = JSON.stringify(event.metadata || {});
          assert.ok(
            !metaStr.includes('SuperSecretT1kt0kP@ssword2026!'),
            'Plaintext passwords must never appear in audit metadata',
          );
          assert.ok(
            !metaStr.includes('Password123!@#TestSafe'),
            'User credentials must never appear in audit metadata',
          );
        }

        // 12.4 Append-only immutability: DELETE or PATCH methods return 404
        const deleteRes = await apiRequest(
          '/api/v1/audit',
          owner,
          undefined,
          {},
          'DELETE',
        );
        assert.equal(
          deleteRes.status,
          404,
          'Audit log cannot be deleted (append-only enforcement)',
        );

        const patchRes = await apiRequest(
          '/api/v1/audit',
          owner,
          { comment: 'tamper' },
          {},
          'PATCH',
        );
        assert.equal(
          patchRes.status,
          404,
          'Audit log cannot be modified (append-only enforcement)',
        );

        // 12.5 Workspace isolation: Events in other workspace are strictly isolated
        const otherAuditRes = await apiRequest('/api/v1/audit', otherWsActor);
        assert.equal(otherAuditRes.status, 200);
        for (const item of otherAuditRes.data.data.items) {
          assert.equal(
            item.workspace_id,
            otherWsId,
            'Audit query must never leak events across workspaces',
          );
        }
      },
    );

    // =========================================================================
    // DOMAIN 13: PAYROLL ENGINE EDGE CASES & FORMULA INVARIANTS
    // =========================================================================
    await t.test(
      'Domain 13: Payroll Invariants - Cross-midnight split, unpaid break deduction, halfUp VND rounding',
      async () => {
        const { calculateDays, subtractBreaks, halfUp, monthBounds } =
          await import('../../dist/apps/api/src/payroll/calculation.js');

        // 13.1 Month bounds validation
        const bounds = monthBounds('2026-10');
        assert.equal(bounds.starts_on, '2026-10-01');
        assert.equal(bounds.ends_on, '2026-10-31');

        // 13.2 Break deduction: 9-hour shift (08:00 - 17:00 ICT) with 1-hour unpaid break (12:00 - 13:00)
        // 2026-10-14 08:00 ICT = 2026-10-14T01:00:00Z (start)
        // 2026-10-14 17:00 ICT = 2026-10-14T10:00:00Z (end)
        const shiftInterval = {
          start: new Date('2026-10-14T01:00:00Z').getTime(),
          end: new Date('2026-10-14T10:00:00Z').getTime(),
        };
        const breaks = [
          {
            started_at: '2026-10-14T05:00:00Z', // 12:00 ICT
            ended_at: '2026-10-14T06:00:00Z', // 13:00 ICT
            unpaid: true,
          },
        ];
        const afterBreaks = subtractBreaks(
          shiftInterval,
          breaks,
          shiftInterval.end,
        );
        assert.equal(afterBreaks.length, 2);
        const totalNetSeconds = afterBreaks.reduce(
          (sum, i) => sum + (i.end - i.start) / 1000,
          0,
        );
        assert.equal(
          totalNetSeconds,
          8 * 3600,
          '9h shift minus 1h unpaid break must equal exactly 8h net work',
        );

        // 13.3 Cross-midnight shift split:
        // Starts 2026-10-14 22:00 ICT (15:00Z), ends 2026-10-15 02:00 ICT (19:00Z)
        // 4 hours total = 2 hours on 2026-10-14, 2 hours on 2026-10-15
        const nightInterval = {
          start: new Date('2026-10-14T15:00:00Z').getTime(),
          end: new Date('2026-10-14T19:00:00Z').getTime(),
        };
        const rates = [
          {
            hourly_rate_vnd: 30000,
            effective_from: '2026-01-01T00:00:00Z',
            effective_to: null,
          },
        ];
        const daySplits = calculateDays([nightInterval], rates, '2026-10');
        assert.equal(
          daySplits.length,
          2,
          'Cross-midnight shift must split into 2 calendar days',
        );
        assert.equal(daySplits[0].work_date, '2026-10-14');
        assert.equal(daySplits[0].worked_seconds, 2 * 3600);
        assert.equal(daySplits[0].rounded_wage_vnd, 60000);

        assert.equal(daySplits[1].work_date, '2026-10-15');
        assert.equal(daySplits[1].worked_seconds, 2 * 3600);
        assert.equal(daySplits[1].rounded_wage_vnd, 60000);

        // 13.4 Half-Up Rounding to Integer VND
        // Exactly half (0.5 VND) rounds up:
        // numerator = 1800n -> 1800 / 3600 = 0.5 VND -> (1800 + 1800) / 3600 = 1 VND
        assert.equal(halfUp(1800n), 1);
        // Slightly below half (0.499 VND):
        // numerator = 1799n -> (1799 + 1800) / 3600 = 3599 / 3600 = 0 VND
        assert.equal(halfUp(1799n), 0);
        // Exactly integer:
        assert.equal(halfUp(360000000n), 100000);
      },
    );

    // =========================================================================
    // DOMAIN 14: SANDBOX SERVICE RESTART & DATA PERSISTENCE (CORE-07 #7)
    // =========================================================================
    await t.test(
      'Domain 14: Sandbox Service Restart - Full HTTP server & DB pool stop/restart preserves sessions, employees, schedules, attendance, payroll, finance, and audit data',
      async () => {
        // 14.1 Stop initial server and close initial DB pool completely
        await new Promise((r) => server.close(r));
        server = null;
        await closeDatabasePool(pool);

        // 14.2 Re-initialize fresh DB pool and start new HTTP server instance
        pool = createDatabasePool(cfg);
        server = http.createServer(
          createRequestHandler({
            pool,
            csrfSecret,
            allowedOrigins: [origin],
            isProduction: false,
            accountSecretKey,
          }),
        );
        await new Promise((r) => server.listen(0, '127.0.0.1', r));
        baseUrl = 'http://127.0.0.1:' + server.address().port;

        // 14.3 Verify Owner and Staff sessions persist across restart
        const ownerMe = await apiRequest('/api/v1/auth/me', owner);
        assert.equal(ownerMe.status, 200, 'Owner session persists across restart');
        assert.equal(ownerMe.data.data.active_workspace.id, workspaceId);

        const staffMe = await apiRequest('/api/v1/auth/me', staffActive);
        assert.equal(staffMe.status, 200, 'Staff session persists across restart');
        assert.equal(staffMe.data.data.active_workspace.role, 'staff');

        // 14.4 Verify Employees & Attendance persist
        const empList = await apiRequest('/api/v1/employees', owner);
        assert.equal(empList.status, 200);
        assert.ok(empList.data.data.items.length >= 2, 'Employees persisted');

        const attList = await apiRequest('/api/v1/attendance/shifts', owner);
        assert.equal(attList.status, 200);
        assert.ok(attList.data.data.shifts.length >= 1, 'Attendance shifts persisted');

        // 14.5 Verify Schedules & Work Items persist
        const schedList = await apiRequest(
          '/api/v1/schedules?week_start_date=2026-10-19',
          owner,
        );
        assert.equal(schedList.status, 200);
        assert.ok(schedList.data.data.items.length >= 1, 'Schedules persisted');

        const workList = await apiRequest('/api/v1/work-items', owner);
        assert.equal(workList.status, 200);
        assert.ok(workList.data.data.items.length >= 1, 'Work items persisted');

        // 14.6 Verify Payroll Overview & Staff Re-login + Self-Service Payslip persist
        const payRes = await apiRequest(
          '/api/v1/payroll/periods/2026-10',
          owner,
        );
        assert.equal(payRes.status, 200);
        assert.ok(payRes.data.data, 'Payroll overview persisted');

        const staff1ReLogin = await apiRequest('/api/v1/auth/login', null, {
          identifier: staff1Email,
          password: staff1Password,
        });
        assert.equal(staff1ReLogin.status, 200);
        staff1.cookie = staff1ReLogin.headers.get('set-cookie').split(';')[0];
        staff1.csrf = staff1ReLogin.data.data.csrf_token;

        const myPayRes = await apiRequest(
          '/api/v1/payroll/periods/2026-10/me',
          staff1,
        );
        assert.equal(myPayRes.status, 200);
        assert.ok(myPayRes.data.data, 'Staff payslip persisted');

        // 14.7 Verify Finance entries, summary balance, and audit logs persist
        const finRes = await apiRequest('/api/v1/fin/entries', owner);
        assert.equal(finRes.status, 200);
        assert.ok(finRes.data.data.items.length >= 2, 'Finance entries persisted');

        const finSumRes = await apiRequest(
          '/api/v1/fin/summary?period=month&anchor=2026-10-14',
          owner,
        );
        assert.equal(finSumRes.status, 200);
        assert.equal(finSumRes.data.data.net_vnd, '6500000', 'Finance summary net balance persisted');

        const auditRes = await apiRequest('/api/v1/audit?limit=50', owner);
        assert.equal(auditRes.status, 200);
        assert.ok(auditRes.data.data.items.length >= 10, 'Audit logs persisted');
      },
    );
  } finally {
    if (server) {
      await new Promise((r) => server.close(r));
    }
    await closeDatabasePool(pool);
  }
});
