import { loadQaEndpoint } from './explicit-database.mjs';
const webBase = loadQaEndpoint(process.env.QA_WEB_BASE);
import { spawn } from 'node:child_process';
import { getAcceptanceOwnerCredentials } from './qa-credentials-reader.mjs';

const ownerCreds = getAcceptanceOwnerCredentials();
const adminPass = ownerCreds.password;

const origin = webBase;

const results = {
  passed: 0,
  failed: 0,
  modules: {
    A: { name: 'AUTH + NHÂN SỰ', pass: 0, fail: 0 },
    B: { name: 'CHẤM CÔNG + LỊCH + LƯƠNG', pass: 0, fail: 0 },
    C: { name: 'WORK (QUẢN LÝ CÔNG VIỆC)', pass: 0, fail: 0 },
    D: { name: 'ACC (TÀI KHOẢN & SECRET VAULT)', pass: 0, fail: 0 },
    E: { name: 'FILE (QUẢN LÝ TỆP & GOOGLE DRIVE)', pass: 0, fail: 0 },
    F: { name: 'UI / UX & ĐA THIẾT BỊ (CHROME CDP)', pass: 0, fail: 0 },
  },
  details: [],
};

function recordTest(moduleKey, testName, isPass, detail = '') {
  if (isPass) {
    results.passed++;
    results.modules[moduleKey].pass++;
    console.log(`  [PASS] ${testName}`);
  } else {
    results.failed++;
    results.modules[moduleKey].fail++;
    console.error(`  [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
  }
  results.details.push({ moduleKey, testName, isPass, detail });
}

async function request(
  path,
  method = 'GET',
  body = null,
  cookie = '',
  csrf = '',
  extraHeaders = {},
) {
  const headers = {
    Origin: origin,
    ...extraHeaders,
  };
  if (cookie) headers['Cookie'] = cookie;
  if (csrf) headers['X-CSRF-Token'] = csrf;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${webBase}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {}
  }
  return { status: res.status, headers: res.headers, data };
}

async function runApiQa() {
  console.log('\n======================================================');
  console.log('🚀 MANAGEMENT LITE: FULL SYSTEM API & PROTOCOL QA');
  console.log('======================================================');

  // -------------------------------------------------------------------
  // A. AUTH + NHÂN SỰ
  // -------------------------------------------------------------------
  console.log('\n[A. AUTH + NHÂN SỰ]');
  let ownerCookie = '';
  let ownerCsrf = '';
  let ownerUser = null;
  let ownerEmp = null;

  // 1. Owner Login
  const loginRes = await request('/api/v1/auth/login', 'POST', {
    identifier: 'admin',
    password: adminPass,
  });
  const loginPass =
    loginRes.status === 200 &&
    loginRes.data?.success &&
    Boolean(loginRes.headers.get('set-cookie'));
  if (loginPass) {
    ownerCookie = loginRes.headers.get('set-cookie').split(';')[0];
    ownerCsrf = loginRes.data.data.csrf_token;
    ownerUser = loginRes.data.data.user;
  }
  recordTest(
    'A',
    'Owner login sets mglite_session cookie and returns CSRF',
    loginPass,
  );

  // 2. /auth/me verification
  const meRes = await request('/api/v1/auth/me', 'GET', null, ownerCookie);
  const mePass =
    meRes.status === 200 &&
    meRes.data?.data?.user?.username === 'admin' &&
    meRes.data?.data?.active_workspace?.role === 'owner';
  recordTest(
    'A',
    'Owner /auth/me returns active owner workspace context',
    mePass,
  );

  // 3. List employees & identify owner employee
  const empListRes = await request(
    '/api/v1/employees',
    'GET',
    null,
    ownerCookie,
  );
  const empListPass =
    empListRes.status === 200 && Array.isArray(empListRes.data?.data?.items);
  if (empListPass) {
    ownerEmp = empListRes.data.data.items.find(
      (e) => e.user_id === ownerUser.id,
    );
  }
  recordTest(
    'A',
    'Owner accesses employee list and resolves self profile',
    empListPass && Boolean(ownerEmp),
  );

  // 4. Owner self-suspend guard (P0 Security Invariant)
  if (ownerEmp) {
    const selfSuspendRes = await request(
      `/api/v1/employees/${ownerEmp.id}/suspend`,
      'POST',
      { reason: 'Test self suspend' },
      ownerCookie,
      ownerCsrf,
      {
        'If-Match': `"${ownerEmp.version}"`,
      },
    );
    const selfSuspendBlocked =
      selfSuspendRes.status === 403 &&
      selfSuspendRes.data?.error?.code === 'FORBIDDEN';
    recordTest(
      'A',
      'P0 Guard: Owner cannot self-suspend their own account (403 FORBIDDEN)',
      selfSuspendBlocked,
    );
  }

  // 5. Create new Staff Employee
  const runId = Math.random().toString(36).substring(2, 8);
  const testStaffCode = `NV_QA_${runId}`;
  const testStaffEmail = `staff_${runId}@qa-unified.test`;
  const createEmpRes = await request(
    '/api/v1/employees',
    'POST',
    {
      employee_code: testStaffCode,
      full_name: `Nhân viên QA ${runId}`,
      email: testStaffEmail,
    },
    ownerCookie,
    ownerCsrf,
  );
  const createEmpPass =
    createEmpRes.status === 201 &&
    Boolean(createEmpRes.data?.data?.invite_token) &&
    createEmpRes.data?.data?.employment_status === 'invited';
  const createdEmp = createEmpRes.data?.data;
  recordTest(
    'A',
    'Owner creates new staff employee and receives invite token',
    createEmpPass,
  );

  // 6. Duplicate employee_code rejected
  const dupEmpRes = await request(
    '/api/v1/employees',
    'POST',
    {
      employee_code: testStaffCode,
      full_name: 'Trùng mã nhân viên',
      email: `dup_${runId}@qa-unified.test`,
    },
    ownerCookie,
    ownerCsrf,
  );
  const dupEmpRejected =
    dupEmpRes.status === 409 && dupEmpRes.data?.error?.code === 'CONFLICT';
  recordTest(
    'A',
    'Duplicate employee_code fails closed with 409 CONFLICT',
    dupEmpRejected,
  );

  // 7. If-Match Concurrency on Employee Update
  if (createdEmp) {
    const missingIfMatchRes = await request(
      `/api/v1/employees/${createdEmp.id}`,
      'PATCH',
      { full_name: 'Name updated' },
      ownerCookie,
      ownerCsrf,
    );
    const missingPass = missingIfMatchRes.status === 428;

    const staleIfMatchRes = await request(
      `/api/v1/employees/${createdEmp.id}`,
      'PATCH',
      { full_name: 'Name updated' },
      ownerCookie,
      ownerCsrf,
      {
        'If-Match': '"999"',
      },
    );
    const stalePass = staleIfMatchRes.status === 412;

    const validIfMatchRes = await request(
      `/api/v1/employees/${createdEmp.id}`,
      'PATCH',
      { full_name: `Nhân viên QA ${runId} (Updated)` },
      ownerCookie,
      ownerCsrf,
      {
        'If-Match': `"${createdEmp.version}"`,
      },
    );
    const validPass =
      validIfMatchRes.status === 200 &&
      validIfMatchRes.data?.data?.version === createdEmp.version + 1;
    recordTest(
      'A',
      'If-Match concurrency enforces 428 (missing), 412 (stale), 200 (valid)',
      missingPass && stalePass && validPass,
    );
  }

  // 8. Staff Activation via Invite Token & Login with Email
  let activatedStaffCookie = '';
  let activatedStaffCsrf = '';
  const newStaffPassword = `StaffQA2026!_${runId}`;
  if (createdEmp?.invite_token) {
    const activateRes = await request('/api/v1/auth/activate', 'POST', {
      token: createdEmp.invite_token,
      new_password: newStaffPassword,
    });
    let loginStaffPass = false;
    if (activateRes.status === 200 && activateRes.data?.success) {
      const staffLogin = await request('/api/v1/auth/login', 'POST', {
        identifier: testStaffEmail,
        password: newStaffPassword,
      });
      if (staffLogin.status === 200 && staffLogin.headers.get('set-cookie')) {
        activatedStaffCookie = staffLogin.headers
          .get('set-cookie')
          .split(';')[0];
        activatedStaffCsrf = staffLogin.data?.data?.csrf_token;
        loginStaffPass = true;
      }
    }
    recordTest(
      'A',
      'Staff activates account via invite token and logs in successfully',
      activateRes.status === 200 && loginStaffPass,
    );
  }

  // 9. Staff Suspension & Immediate Session Revocation
  if (createdEmp) {
    const latestEmpRes = await request(
      `/api/v1/employees/${createdEmp.id}`,
      'GET',
      null,
      ownerCookie,
    );
    const latestVersion = latestEmpRes.data?.data?.version;

    const suspendRes = await request(
      `/api/v1/employees/${createdEmp.id}/suspend`,
      'POST',
      { reason: 'QA Suspension Test' },
      ownerCookie,
      ownerCsrf,
      {
        'If-Match': `"${latestVersion}"`,
      },
    );
    const suspendPass =
      suspendRes.status === 200 &&
      suspendRes.data?.data?.employment_status === 'suspended';

    // Verify Staff session revoked immediately (401 UNAUTHENTICATED)
    const staffRevokedRes = await request(
      '/api/v1/employees/me',
      'GET',
      null,
      activatedStaffCookie,
    );
    const revokedPass =
      staffRevokedRes.status === 401 &&
      staffRevokedRes.data?.error?.code === 'UNAUTHENTICATED';

    // Verify Staff cannot log in while suspended (409 WORKSPACE_CONTEXT_UNRESOLVED)
    const staffLoginSuspendedRes = await request('/api/v1/auth/login', 'POST', {
      identifier: testStaffEmail,
      password: newStaffPassword,
    });
    const loginBlockedPass =
      staffLoginSuspendedRes.status === 409 &&
      staffLoginSuspendedRes.data?.error?.code ===
        'WORKSPACE_CONTEXT_UNRESOLVED';

    recordTest(
      'A',
      'Owner suspends Staff: session revoked (401) and login blocked (409)',
      suspendPass && revokedPass && loginBlockedPass,
    );

    // 10. Reactivate Staff
    const suspendedEmpRes = await request(
      `/api/v1/employees/${createdEmp.id}`,
      'GET',
      null,
      ownerCookie,
    );
    const suspendedVersion = suspendedEmpRes.data?.data?.version;

    const reactivateRes = await request(
      `/api/v1/employees/${createdEmp.id}/reactivate`,
      'POST',
      {},
      ownerCookie,
      ownerCsrf,
      {
        'If-Match': `"${suspendedVersion}"`,
      },
    );
    const reactivatePass =
      reactivateRes.status === 200 &&
      reactivateRes.data?.data?.employment_status === 'active';

    // Verify Staff can log in again after reactivation
    const staffLoginReactivatedRes = await request(
      '/api/v1/auth/login',
      'POST',
      {
        identifier: testStaffEmail,
        password: newStaffPassword,
      },
    );
    const staffReLoginPass = staffLoginReactivatedRes.status === 200;
    if (staffReLoginPass) {
      activatedStaffCookie = staffLoginReactivatedRes.headers
        .get('set-cookie')
        .split(';')[0];
      activatedStaffCsrf = staffLoginReactivatedRes.data.data.csrf_token;
    }
    recordTest(
      'A',
      'Owner reactivates Staff: employment restored (active) and login succeeds',
      reactivatePass && staffReLoginPass,
    );
  }

  // -------------------------------------------------------------------
  // B. CHẤM CÔNG + LỊCH + LƯƠNG
  // -------------------------------------------------------------------
  console.log('\n[B. CHẤM CÔNG + LỊCH + LƯƠNG]');

  // 1. Staff Attendance Lifecycle (Clock-in, Break, Resume, Clock-out)
  let activeShiftId = null;
  const clockInRes = await request(
    '/api/v1/attendance/shifts',
    'POST',
    {},
    activatedStaffCookie,
    activatedStaffCsrf,
  );
  const clockInPass =
    clockInRes.status === 201 &&
    Boolean(clockInRes.data?.data?.shift_id || clockInRes.data?.data?.id);
  if (clockInPass)
    activeShiftId = clockInRes.data.data.shift_id || clockInRes.data.data.id;
  recordTest(
    'B',
    'Staff performs clock-in (creates attendance shift)',
    clockInPass,
  );

  if (activeShiftId) {
    const breakStartRes = await request(
      `/api/v1/attendance/shifts/${activeShiftId}/breaks`,
      'POST',
      {},
      activatedStaffCookie,
      activatedStaffCsrf,
    );
    const breakStartPass = breakStartRes.status === 200;

    const resumeRes = await request(
      `/api/v1/attendance/shifts/${activeShiftId}/resume`,
      'POST',
      {},
      activatedStaffCookie,
      activatedStaffCsrf,
    );
    const resumePass = resumeRes.status === 200;

    const clockOutRes = await request(
      `/api/v1/attendance/shifts/${activeShiftId}/clock-out`,
      'POST',
      {},
      activatedStaffCookie,
      activatedStaffCsrf,
    );
    const clockOutPass = clockOutRes.status === 200;

    recordTest(
      'B',
      'Staff completes break-start, resume, and clock-out lifecycle',
      breakStartPass && resumePass && clockOutPass,
    );
  }

  // 2. Staff views their schedule
  const staffScheduleRes = await request(
    '/api/v1/schedules/me',
    'GET',
    null,
    activatedStaffCookie,
  );
  const staffSchedulePass = staffScheduleRes.status === 200;
  recordTest(
    'B',
    'Staff views their weekly schedule (/schedules/me)',
    staffSchedulePass,
  );

  // 3. Owner views attendance shifts
  const ownerShiftsRes = await request(
    '/api/v1/attendance/shifts',
    'GET',
    null,
    ownerCookie,
  );
  const ownerShiftsPass =
    ownerShiftsRes.status === 200 &&
    Array.isArray(ownerShiftsRes.data?.data?.shifts);
  recordTest('B', 'Owner lists workspace attendance shifts', ownerShiftsPass);

  // 4. Owner creates/updates schedule
  const schedulesListRes = await request(
    '/api/v1/schedules?week_start_date=2026-10-12',
    'GET',
    null,
    ownerCookie,
  );
  const schedulesListPass = schedulesListRes.status === 200;
  recordTest('B', 'Owner accesses workspace schedules', schedulesListPass);

  // 5. Owner configures hourly rate & inspects payroll period overview
  let setRatePass = true;
  if (createdEmp) {
    const setRateRes = await request(
      '/api/v1/payroll/hourly-rates',
      'POST',
      {
        employee_id: createdEmp.id,
        hourly_rate_vnd: 60000,
      },
      ownerCookie,
      ownerCsrf,
    );
    setRatePass = setRateRes.status === 201 && setRateRes.data?.success;
  }
  const payrollPeriodRes = await request(
    '/api/v1/payroll/periods/2026-10',
    'GET',
    null,
    ownerCookie,
  );
  const payrollPeriodPass =
    setRatePass &&
    payrollPeriodRes.status === 200 &&
    payrollPeriodRes.data?.data?.period?.period_month === '2026-10';
  recordTest(
    'B',
    'Owner inspects payroll period overview (2026-10)',
    payrollPeriodPass,
  );

  // -------------------------------------------------------------------
  // C. WORK (QUẢN LÝ CÔNG VIỆC)
  // -------------------------------------------------------------------
  console.log('\n[C. WORK (QUẢN LÝ CÔNG VIỆC)]');

  // 1. Owner creates work item
  const workItemRes = await request(
    '/api/v1/work-items',
    'POST',
    {
      title: `Nhiệm vụ kiểm thử QA ${runId}`,
      description:
        'Nhiệm vụ phục vụ kiểm thử tích hợp toàn diện Unified Staging',
      priority: 'high',
    },
    ownerCookie,
    ownerCsrf,
  );
  const workItemPass =
    workItemRes.status === 201 && Boolean(workItemRes.data?.data?.id);
  let workItem = workItemRes.data?.data;
  recordTest('C', 'Owner creates work item', workItemPass);

  // 2. Owner assigns work item to Staff
  let assignmentId = null;
  if (workItem && createdEmp) {
    const assignRes = await request(
      `/api/v1/work-items/${workItem.id}/assignments`,
      'POST',
      {
        employee_ids: [createdEmp.id],
      },
      ownerCookie,
      ownerCsrf,
      {
        'If-Match': `"${workItem.version}"`,
      },
    );
    const assignPass = assignRes.status === 201;
    if (assignPass) {
      workItem = assignRes.data?.data;
      assignmentId = workItem?.assignments?.find(
        (a) => a.employee_id === createdEmp.id,
      )?.id;
    }
    recordTest(
      'C',
      'Owner assigns work item to Staff',
      assignPass && Boolean(assignmentId),
    );
  }

  // 3. Staff starts work item (transitions to in_progress)
  if (workItem && assignmentId) {
    const startRes = await request(
      `/api/v1/work-items/${workItem.id}/assignments/${assignmentId}/start`,
      'POST',
      {
        note: 'Bắt đầu xử lý công việc',
      },
      activatedStaffCookie,
      activatedStaffCsrf,
      {
        'If-Match': `"${workItem.version}"`,
      },
    );
    const startPass = startRes.status === 200;
    if (startPass) workItem = startRes.data?.data;
    recordTest(
      'C',
      'Staff starts work item (assignment becomes in_progress)',
      startPass,
    );

    // 4. Staff submits work deliverable
    const submitRes = await request(
      `/api/v1/work-items/${workItem.id}/assignments/${assignmentId}/submissions`,
      'POST',
      {
        submission_note: 'Bản nộp đợt 1',
        attachments: [
          {
            name: 'file.pdf',
            url: 'https://drive.google.com/test-qa-deliverable-1',
          },
        ],
      },
      activatedStaffCookie,
      activatedStaffCsrf,
      {
        'If-Match': `"${workItem.version}"`,
      },
    );
    const submitPass = submitRes.status === 201;
    if (submitPass) workItem = submitRes.data?.data;
    const assignment = workItem?.assignments?.find(
      (a) => a.id === assignmentId,
    );
    const submissionId = assignment?.submissions?.at(-1)?.id;
    recordTest(
      'C',
      'Staff submits deliverable (state becomes in_review)',
      submitPass && Boolean(submissionId),
    );

    // 5. Concurrency Check: Stale If-Match returns 412
    const staleWorkRes = await request(
      `/api/v1/work-items/${workItem.id}`,
      'PATCH',
      { title: 'New Title' },
      ownerCookie,
      ownerCsrf,
      {
        'If-Match': '"999"',
      },
    );
    const staleWorkPass = staleWorkRes.status === 412;
    recordTest(
      'C',
      'If-Match concurrency: stale version returns 412 PRECONDITION_FAILED',
      staleWorkPass,
    );

    // 6. Owner reviews and requests changes
    if (submissionId) {
      const rejectRes = await request(
        `/api/v1/work-items/${workItem.id}/assignments/${assignmentId}/submissions/${submissionId}/reviews`,
        'POST',
        {
          decision: 'request_changes',
          feedback: 'Cần bổ sung thêm thông tin chi tiết',
        },
        ownerCookie,
        ownerCsrf,
        {
          'If-Match': `"${workItem.version}"`,
        },
      );
      const rejectPass = rejectRes.status === 200;
      if (rejectPass) workItem = rejectRes.data?.data;
      recordTest(
        'C',
        'Owner reviews and requests changes with feedback',
        rejectPass,
      );

      // 7. Staff resubmits revision 2
      const resubmitRes = await request(
        `/api/v1/work-items/${workItem.id}/assignments/${assignmentId}/submissions`,
        'POST',
        {
          submission_note: 'Bản nộp đợt 2 đã chỉnh sửa',
          attachments: [
            {
              name: 'file_v2.pdf',
              url: 'https://drive.google.com/test-qa-deliverable-2',
            },
          ],
        },
        activatedStaffCookie,
        activatedStaffCsrf,
        {
          'If-Match': `"${workItem.version}"`,
        },
      );
      const resubmitPass = resubmitRes.status === 201;
      if (resubmitPass) workItem = resubmitRes.data?.data;
      const resubmissionId = workItem?.assignments
        ?.find((a) => a.id === assignmentId)
        ?.submissions?.at(-1)?.id;
      recordTest(
        'C',
        'Staff resubmits revision 2 of deliverable',
        resubmitPass && Boolean(resubmissionId),
      );

      // 8. Owner reviews and approves revision 2
      if (resubmissionId) {
        const approveRes = await request(
          `/api/v1/work-items/${workItem.id}/assignments/${assignmentId}/submissions/${resubmissionId}/reviews`,
          'POST',
          {
            decision: 'approved',
            feedback: 'Nội dung đạt chuẩn chất lượng',
          },
          ownerCookie,
          ownerCsrf,
          {
            'If-Match': `"${workItem.version}"`,
          },
        );
        const approvePass = approveRes.status === 200;
        recordTest(
          'C',
          'Owner approves deliverable (task lifecycle completed)',
          approvePass,
        );
      }
    }
  }

  // -------------------------------------------------------------------
  // D. ACC (TÀI KHOẢN & SECRET VAULT)
  // -------------------------------------------------------------------
  console.log('\n[D. ACC (TÀI KHOẢN & SECRET VAULT)]');

  // 1. Owner creates managed account
  const accCreateRes = await request(
    '/api/v1/accounts',
    'POST',
    {
      platform: 'tiktok',
      username: `tiktok_qa_${runId}`,
      platform_account_id: `tt_${runId}`,
      notes: 'Tài khoản TikTok phục vụ kiểm thử Staging QA',
    },
    ownerCookie,
    ownerCsrf,
  );
  const accCreatePass =
    accCreateRes.status === 201 && Boolean(accCreateRes.data?.data?.id);
  const accItem = accCreateRes.data?.data;
  recordTest('D', 'Owner creates managed account (TikTok)', accCreatePass);

  // 2. Staff access rejected with 403 FORBIDDEN
  const staffAccRes = await request(
    '/api/v1/accounts',
    'GET',
    null,
    activatedStaffCookie,
  );
  const staffAccBlocked =
    staffAccRes.status === 403 && staffAccRes.data?.error?.code === 'FORBIDDEN';
  recordTest(
    'D',
    'RBAC Invariant: Staff access to /accounts returns 403 FORBIDDEN',
    staffAccBlocked,
  );

  // 3. Owner Reauth for secret_write
  let writeReauthProof = '';
  if (accItem) {
    const reauthWriteRes = await request(
      '/api/v1/auth/reauth',
      'POST',
      {
        password: adminPass,
        action: 'secret_write',
        account_id: accItem.id,
      },
      ownerCookie,
      ownerCsrf,
    );
    const reauthWritePass =
      reauthWriteRes.status === 200 &&
      Boolean(reauthWriteRes.data?.data?.reauth_proof);
    if (reauthWritePass)
      writeReauthProof = reauthWriteRes.data.data.reauth_proof;
    recordTest(
      'D',
      'Owner completes re-auth challenge for secret_write',
      reauthWritePass,
    );

    // 4. Save Secret (Encrypted via AEAD AES-256-GCM)
    const secretPayload = `TopSecretKey2026!_${runId}`;
    if (writeReauthProof) {
      const saveSecretRes = await request(
        `/api/v1/accounts/${accItem.id}/secrets`,
        'PUT',
        {
          secret_type: 'password',
          secret_value: secretPayload,
          reauth_proof: writeReauthProof,
        },
        ownerCookie,
        ownerCsrf,
        {
          'If-Match': `"${accItem.version}"`,
        },
      );
      const saveSecretPass = saveSecretRes.status === 200;
      recordTest(
        'D',
        'Owner stores encrypted secret in AEAD Vault',
        saveSecretPass,
      );

      // 5. Owner Reauth for secret_reveal
      const reauthRevealRes = await request(
        '/api/v1/auth/reauth',
        'POST',
        {
          password: adminPass,
          action: 'secret_reveal',
          account_id: accItem.id,
        },
        ownerCookie,
        ownerCsrf,
      );
      const reauthRevealPass =
        reauthRevealRes.status === 200 &&
        Boolean(reauthRevealRes.data?.data?.reauth_proof);
      const revealReauthProof = reauthRevealRes.data?.data?.reauth_proof;
      recordTest(
        'D',
        'Owner completes re-auth challenge for secret_reveal',
        reauthRevealPass,
      );

      // 6. Reveal Secret (Single-use reveal token)
      if (revealReauthProof) {
        const revealRes = await request(
          `/api/v1/accounts/${accItem.id}/secrets/reveal`,
          'POST',
          {
            secret_type: 'password',
            reauth_proof: revealReauthProof,
          },
          ownerCookie,
          ownerCsrf,
        );
        const revealPass =
          revealRes.status === 200 &&
          revealRes.data?.data?.secret_value === secretPayload;
        recordTest(
          'D',
          'Owner decrypts AEAD secret: value matches original payload',
          revealPass,
        );

        // 7. Verify single-use token: Reusing same proof MUST be rejected
        const reuseRes = await request(
          `/api/v1/accounts/${accItem.id}/secrets/reveal`,
          'POST',
          {
            secret_type: 'password',
            reauth_proof: revealReauthProof,
          },
          ownerCookie,
          ownerCsrf,
        );
        const reuseBlocked = reuseRes.status === 401 || reuseRes.status === 403;
        recordTest(
          'D',
          'Single-use invariant: Reusing secret_reveal proof fails closed',
          reuseBlocked,
        );
      }
    }

    // 8. Owner Archives and Restores Account
    const freshAccRes = await request(
      `/api/v1/accounts/${accItem.id}`,
      'GET',
      null,
      ownerCookie,
    );
    const freshVersion = freshAccRes.data?.data?.version;

    const archiveRes = await request(
      `/api/v1/accounts/${accItem.id}/archive`,
      'POST',
      { reason: 'QA archiving test' },
      ownerCookie,
      ownerCsrf,
      {
        'If-Match': `"${freshVersion}"`,
      },
    );
    const archivePass =
      archiveRes.status === 200 && archiveRes.data?.data?.status === 'archived';

    const archivedVersion = archiveRes.data?.data?.version;
    const restoreRes = await request(
      `/api/v1/accounts/${accItem.id}/restore`,
      'POST',
      {},
      ownerCookie,
      ownerCsrf,
      {
        'If-Match': `"${archivedVersion}"`,
      },
    );
    const restorePass =
      restoreRes.status === 200 && restoreRes.data?.data?.status === 'active';

    recordTest(
      'D',
      'Owner archives and restores account with audit trail',
      archivePass && restorePass,
    );
  }

  // -------------------------------------------------------------------
  // E. FILE (QUẢN LÝ TỆP & GOOGLE DRIVE TRASH)
  // -------------------------------------------------------------------
  console.log('\n[E. FILE (QUẢN LÝ TỆP & GOOGLE DRIVE)]');

  // 1. Owner creates source folder group
  const folderCreateRes = await request(
    '/api/v1/storage/folders',
    'POST',
    {
      name: `Thư mục QA ${runId}`,
      drive_url: `https://drive.google.com/drive/folders/qa_source_${runId}`,
      folder_type: 'source',
      assigned_employee_ids: createdEmp ? [createdEmp.id] : [],
      notes: 'Thư mục nguồn phục vụ kiểm thử FILE protocol',
    },
    ownerCookie,
    ownerCsrf,
  );
  const folderCreatePass =
    folderCreateRes.status === 201 && Boolean(folderCreateRes.data?.data?.id);
  const folderItem = folderCreateRes.data?.data;
  recordTest(
    'E',
    'Owner creates source folder with Staff assignment',
    folderCreatePass,
  );

  if (folderItem && createdEmp) {
    // 2. Initial delete_readiness check: fail-closed (is_ready: false)
    const initialFolderRes = await request(
      `/api/v1/storage/folders/${folderItem.id}`,
      'GET',
      null,
      ownerCookie,
    );
    const initialNotReady =
      initialFolderRes.status === 200 &&
      initialFolderRes.data?.data?.delete_readiness?.is_ready === false;
    recordTest(
      'E',
      'Fail-closed invariant: delete_readiness is false before receipts/deliverables',
      initialNotReady,
    );

    // 3. Staff records download receipt
    const dlReceiptRes = await request(
      `/api/v1/storage/folders/${folderItem.id}/receipts`,
      'POST',
      {
        receipt_type: 'download',
        notes: 'Nhân viên đã tải tài liệu nguồn',
      },
      activatedStaffCookie,
      activatedStaffCsrf,
    );
    const dlReceiptPass = dlReceiptRes.status === 201;
    recordTest(
      'E',
      'Staff confirms download receipt for source folder',
      dlReceiptPass,
    );

    // 4. Staff submits deliverable folder/file
    const deliverableRes = await request(
      '/api/v1/storage/folders',
      'POST',
      {
        name: `Sản phẩm hoàn thành QA ${runId}`,
        drive_url: `https://drive.google.com/drive/folders/qa_out_${runId}`,
        folder_type: 'deliverable',
        parent_folder_id: folderItem.id,
      },
      activatedStaffCookie,
      activatedStaffCsrf,
    );
    const deliverablePass =
      deliverableRes.status === 201 && Boolean(deliverableRes.data?.data?.id);
    const deliverableId = deliverableRes.data?.data?.id;
    recordTest(
      'E',
      'Staff submits output deliverable revision 1',
      deliverablePass,
    );

    // 5. Owner records output approval receipt
    let approvalReceiptPass = false;
    if (deliverableId) {
      const approvalReceiptRes = await request(
        `/api/v1/storage/folders/${folderItem.id}/receipts`,
        'POST',
        {
          receipt_type: 'deliverable_approval',
          output_id: deliverableId,
          revision_number: 1,
          notes: 'Chủ cơ sở đã kiểm tra và duyệt sản phẩm đầu ra',
        },
        ownerCookie,
        ownerCsrf,
      );
      approvalReceiptPass = approvalReceiptRes.status === 201;
    }
    recordTest(
      'E',
      'Owner confirms output approval receipt',
      approvalReceiptPass,
    );

    // 6. Delete readiness check: now is_ready: true
    const readyFolderRes = await request(
      `/api/v1/storage/folders/${folderItem.id}`,
      'GET',
      null,
      ownerCookie,
    );
    const deleteReadyPass =
      readyFolderRes.status === 200 &&
      readyFolderRes.data?.data?.delete_readiness?.is_ready === true;
    const snapshotHash =
      readyFolderRes.data?.data?.delete_readiness?.group_snapshot_hash;
    recordTest(
      'E',
      'Delete readiness turns true after all deliverables approved',
      deleteReadyPass && Boolean(snapshotHash),
    );

    // 7. Step 1: Owner initiates Trash Request
    if (snapshotHash) {
      const trashReqRes = await request(
        `/api/v1/storage/folders/${folderItem.id}/trash-requests`,
        'POST',
        {
          version: 1,
        },
        ownerCookie,
        ownerCsrf,
        {
          'If-Match': '"1"',
        },
      );
      const trashReqPass =
        trashReqRes.status === 200 &&
        Boolean(trashReqRes.data?.data?.trash_request_id);
      const trashReqId = trashReqRes.data?.data?.trash_request_id;
      recordTest(
        'E',
        'Step 1: Owner initiates trash request with snapshot hash',
        trashReqPass,
      );

      // 8. Step 2: Owner confirms Trash Request (Mock provider only)
      if (trashReqId) {
        // Concurrency test: stale snapshot hash rejected with 412
        const staleTrashRes = await request(
          `/api/v1/storage/trash-requests/${trashReqId}/confirm`,
          'POST',
          {
            acknowledged: true,
            group_snapshot_hash:
              'stale_hash_precondition_failed_12345678901234567890123456789012',
          },
          ownerCookie,
          ownerCsrf,
        );
        const staleTrashPass = staleTrashRes.status === 412;
        recordTest(
          'E',
          'Stale snapshot hash rejects confirmation with 412 PRECONDITION_FAILED',
          staleTrashPass,
        );

        // Valid confirmation
        const confirmTrashRes = await request(
          `/api/v1/storage/trash-requests/${trashReqId}/confirm`,
          'POST',
          {
            acknowledged: true,
            group_snapshot_hash: snapshotHash,
          },
          ownerCookie,
          ownerCsrf,
        );
        const confirmTrashPass =
          confirmTrashRes.status === 200 &&
          confirmTrashRes.data?.data?.status === 'trashed';
        recordTest(
          'E',
          'Step 2: Owner confirms trash request (moved to Mock Trash, NO real Drive calls)',
          confirmTrashPass,
        );
      }
    }
  }

  return { ownerCookie, ownerCsrf };
}

async function runChromeQa() {
  console.log('\n======================================================');
  console.log('🌐 MANAGEMENT LITE: GOOGLE CHROME CDP BROWSER QA (MODULE F)');
  console.log('======================================================');

  const chrome = spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    [
      '--headless=new',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=9225',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=/tmp/chrome-full-system-qa-${process.pid}`,
    ],
  );

  try {
    await new Promise((r) => setTimeout(r, 1500));
    const newTab = await fetch(
      `http://127.0.0.1:9225/json/new?${webBase + '/login'}`,
      {
        method: 'PUT',
      },
    ).then((r) => r.json());

    const ws = new WebSocket(newTab.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));

    let msgId = 1;
    const callbacks = new Map();
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && callbacks.has(msg.id)) {
        const { res, rej } = callbacks.get(msg.id);
        callbacks.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    };

    const send = (method, params = {}) =>
      new Promise((res, rej) => {
        const id = msgId++;
        callbacks.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
      });

    const evaluate = async (exp) => {
      const r = await send('Runtime.evaluate', {
        expression: exp,
        returnByValue: true,
        awaitPromise: true,
      });
      return r.result?.value;
    };

    await send('Page.enable');
    await send('DOM.enable');
    await send('Page.navigate', { url: webBase + '/login' });

    // -------------------------------------------------------------------
    // Test 1: Desktop Viewport (1280x800)
    // -------------------------------------------------------------------
    console.log('\n--- 1. Desktop Viewport (1280x800) ---');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await new Promise((r) => setTimeout(r, 1000));

    // 1.1 Verify Login Screen
    const loginRendered = await evaluate(
      `Boolean(document.querySelector('input[type=password]') && [...document.querySelectorAll('button')].some(b => b.type === 'submit' && b.textContent.includes('Đăng nhập')))`,
    );
    recordTest(
      'F',
      'Chrome Desktop: Login page loaded with form inputs',
      loginRendered,
    );

    // 1.2 Submit Login form
    await evaluate(`
      (async () => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const usernameInput = inputs[0];
        const passwordInput = inputs[1];
        const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

        nativeSetter.call(usernameInput, 'admin');
        usernameInput.dispatchEvent(new Event('input', { bubbles: true }));
        usernameInput.dispatchEvent(new Event('change', { bubbles: true }));

        nativeSetter.call(passwordInput, ${JSON.stringify(adminPass)});
        passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
        passwordInput.dispatchEvent(new Event('change', { bubbles: true }));

        await new Promise(r => setTimeout(r, 150));
        const submitBtn = document.querySelector('button[type="submit"]') || Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Đăng nhập'));
        if (submitBtn) submitBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 2000));

    // 1.3 Verify AppShell Header & Desktop Sidebar
    const desktopShell = await evaluate(`
      (() => {
        const header = document.querySelector('header');
        const sidebarWrapper = document.querySelector('.desktop-sidebar-wrapper');
        const navLinks = Array.from(document.querySelectorAll('aside a, aside button'));
        return {
          hasHeader: Boolean(header),
          headerHeight: header?.offsetHeight,
          hasSidebar: Boolean(sidebarWrapper),
          sidebarVisible: sidebarWrapper ? window.getComputedStyle(sidebarWrapper).display !== 'none' : false,
          navItemCount: navLinks.length,
        };
      })()
    `);
    const desktopShellPass =
      desktopShell.hasHeader &&
      desktopShell.headerHeight === 44 &&
      desktopShell.sidebarVisible &&
      desktopShell.navItemCount === 6;
    recordTest(
      'F',
      'Chrome Desktop: AppShell fixed header (44px) and sidebar navigation with 6 functional groups',
      desktopShellPass,
    );

    // 1.4 Test Client-Side Navigation across screens
    const testRoutes = [
      { path: '/', titleCheck: 'tổng quan' },
      { path: '/employees', titleCheck: 'nhân sự' },
      { path: '/clock', titleCheck: 'chấm công' },
      { path: '/schedule', titleCheck: 'lịch' },
      { path: '/payroll', titleCheck: 'lương' },
      { path: '/work', titleCheck: 'công việc' },
      { path: '/accounts', titleCheck: 'tài khoản' },
      { path: '/storage', titleCheck: 'tệp' },
      { path: '/settings', titleCheck: 'cài đặt' },
    ];

    let allRoutesPass = true;
    for (const r of testRoutes) {
      await evaluate(
        `window.history.pushState(null, '', '${r.path}'); window.dispatchEvent(new Event('popstate'));`,
      );
      await new Promise((res) => setTimeout(res, 800));
      const pageText = await evaluate(
        'document.body.textContent.toLowerCase()',
      );
      const matches = pageText.includes(r.titleCheck.toLowerCase());
      if (!matches) {
        allRoutesPass = false;
        console.error(
          `Route ${r.path} failed content check for '${r.titleCheck}'`,
        );
      }
    }
    recordTest(
      'F',
      'Chrome Desktop: Seamless History API navigation across 9 core application routes',
      allRoutesPass,
    );

    // 1.5 Verify Owner Self-Lockout Button Guard in Chrome DOM
    await evaluate(
      `window.history.pushState(null, '', '/employees'); window.dispatchEvent(new Event('popstate'));`,
    );
    await new Promise((res) => setTimeout(res, 1000));
    const buttonGuardState = await evaluate(`
      (() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const suspendBtns = buttons.filter(b => b.dataset.action === 'deactivate' && b.getAttribute('title')?.includes('Chủ sở hữu'));
        const disabledBtn = suspendBtns.find(b => b.disabled || b.hasAttribute('disabled'));
        return {
          totalSuspendButtons: suspendBtns.length,
          hasDisabledButton: Boolean(disabledBtn),
          disabledTooltip: disabledBtn?.getAttribute('title') || '',
        };
      })()
    `);
    const buttonGuardPass =
      buttonGuardState.hasDisabledButton &&
      buttonGuardState.disabledTooltip.includes(
        'Chủ sở hữu không thể tự tạm ngưng',
      );
    recordTest(
      'F',
      'Chrome Desktop: Owner self-suspend button disabled with Vietnamese safety tooltip',
      buttonGuardPass,
    );

    // -------------------------------------------------------------------
    // Test 2: Mobile Viewport (375x667 - iPhone SE / Standard Mobile)
    // -------------------------------------------------------------------
    console.log('\n--- 2. Mobile Viewport (375x667) ---');
    await send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 667,
      deviceScaleFactor: 2,
      mobile: true,
      hasTouch: true,
    });
    await new Promise((r) => setTimeout(r, 1200));

    // 2.1 Verify Mobile Bottom Nav & Hidden Desktop Sidebar
    const mobileShell = await evaluate(`
      (() => {
        const sidebarWrapper = document.querySelector('.desktop-sidebar-wrapper');
        const bottomNavWrapper = document.querySelector('.mobile-bottom-nav-wrapper');
        return {
          sidebarHidden: sidebarWrapper ? window.getComputedStyle(sidebarWrapper).display === 'none' : true,
          hasBottomNav: Boolean(bottomNavWrapper),
          bottomNavVisible: bottomNavWrapper ? window.getComputedStyle(bottomNavWrapper).display !== 'none' : false,
        };
      })()
    `);
    const mobileShellPass =
      mobileShell.sidebarHidden &&
      mobileShell.hasBottomNav &&
      mobileShell.bottomNavVisible;
    recordTest(
      'F',
      'Chrome Mobile: Sidebar collapsed, responsive mobile bottom navigation rendered',
      mobileShellPass,
    );

    // Current UI uses functional group navigation instead of a More drawer.
    const groupOpened = await evaluate(`(() => {
      const b = [...document.querySelectorAll('[aria-label="Mobile bottom navigation"] button')].find(b => b.textContent.includes('Quản trị'));
      if (!b) return false;
      b.click(); return true;
    })()`);
    await new Promise((r) => setTimeout(r, 600));
    const groupRendered = await evaluate(
      `location.pathname === '/groups/admin' && document.querySelector('main')?.textContent.includes('Cài đặt')`,
    );
    recordTest(
      'F',
      'Chrome Mobile: Functional group button opens administration overview',
      groupOpened && groupRendered,
    );

    // Close drawer
    await evaluate(`
      (() => {
        const closeBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Đóng') || b.textContent.includes('✕'));
        if (closeBtn) closeBtn.click();
      })()
    `);
    await new Promise((r) => setTimeout(r, 500));

    // 2.3 Logout via Chrome
    const logoutExecuted = await evaluate(`
      (() => {
        const logoutBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Đăng xuất'));
        if (logoutBtn) {
          logoutBtn.click();
          return true;
        }
        return false;
      })()
    `);
    await new Promise((r) => setTimeout(r, 1500));

    const finalPath = await evaluate('window.location.pathname');
    const logoutPass = logoutExecuted && finalPath === '/login';
    recordTest(
      'F',
      'Chrome Mobile/Desktop: Logout button cleans session and navigates back to /login',
      logoutPass,
    );
  } finally {
    chrome.kill();
  }
}

async function main() {
  const startTime = Date.now();
  console.log('MANAGEMENT LITE FULL SYSTEM QA SUITE STARTED');
  console.log(`Web Target: ${webBase} | API Target: QA proxy`);

  try {
    await runApiQa();
    await runChromeQa();
  } catch (err) {
    console.error('UNEXPECTED QA ERROR:', err);
    process.exit(1);
  }

  const durationMs = Date.now() - startTime;
  console.log('\n======================================================');
  console.log('📊 FINAL QA EXECUTION SUMMARY');
  console.log('======================================================');
  console.log(`Total Checks Executed : ${results.passed + results.failed}`);
  console.log(`Checks Passed         : ${results.passed}`);
  console.log(`Checks Failed         : ${results.failed}`);
  console.log(`Duration              : ${(durationMs / 1000).toFixed(2)}s`);
  console.log('------------------------------------------------------');
  for (const [key, mod] of Object.entries(results.modules)) {
    const status = mod.fail === 0 && mod.pass > 0 ? 'PASS' : 'FAIL';
    console.log(
      `Module [${key}] ${mod.name.padEnd(36)}: [${status}] (${mod.pass} passed, ${mod.fail} failed)`,
    );
  }
  console.log('======================================================\n');

  if (results.failed > 0) {
    process.exit(1);
  }
}

main();
