import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';

import {
  getAcceptanceOwnerCredentials,
  getAcceptanceStaffCredentials,
} from '../../scripts/qa-credentials-reader.mjs';

test('UNIFIED STAGING 01: All modules in single session, single cookie, Owner/Staff RBAC, AEAD Vault, and Session Revocation', async (t) => {
  const webBase = process.env.QA_WEB_BASE;
  const apiBase = process.env.QA_API_BASE;
  const origin = webBase;
  assert.ok(webBase && apiBase, 'Explicit isolated QA endpoints are required');
  for (const endpoint of [webBase, apiBase]) {
    const u = new URL(endpoint);
    assert.equal(u.hostname, '127.0.0.1');
    assert.ok(
      ![
        '3000',
        '3001',
        '3002',
        '3017',
        '3018',
        '3027',
        '3028',
        '3008',
        '55432',
      ].includes(u.port),
      'Operational endpoint refused',
    );
  }

  const ownerCreds = getAcceptanceOwnerCredentials();
  const staffCreds = getAcceptanceStaffCredentials();

  const { loadTestDatabaseConfig } =
    await import('../../dist/packages/database/src/config.js');
  const { createDatabasePool, closeDatabasePool } =
    await import('../../dist/packages/database/src/pool.js');
  const pool = createDatabasePool(loadTestDatabaseConfig());

  try {
    // 1. Health checks on both Web (proxy) and API
    await t.test(
      '1. Verify Web proxy (3017) and API (3018) are online and healthy',
      async () => {
        const apiHealth = await fetch(`${apiBase}/api/v1/health`);
        assert.equal(apiHealth.status, 200);
        const apiHealthJson = await apiHealth.json();
        assert.equal(apiHealthJson.data?.status, 'pass');

        const webRes = await fetch(`${webBase}/`);
        assert.equal(webRes.status, 200);

        const proxyHealth = await fetch(`${webBase}/api/v1/health`);
        assert.equal(proxyHealth.status, 200);
        const proxyJson = await proxyHealth.json();
        assert.equal(proxyJson.data?.status, 'pass');
      },
    );

    // Helper for requests via Web proxy (port 3017)
    async function apiRequest(
      path,
      method = 'GET',
      data = null,
      cookie = null,
      csrf = null,
      customOrigin = origin,
    ) {
      const headers = {};
      if (customOrigin) headers['Origin'] = customOrigin;
      if (cookie) headers['Cookie'] = cookie;
      if (csrf) headers['X-CSRF-Token'] = csrf;
      if (data) headers['Content-Type'] = 'application/json';

      const res = await fetch(`${webBase}${path}`, {
        method,
        headers,
        body: data ? JSON.stringify(data) : undefined,
        redirect: 'manual',
      });

      let json = null;
      try {
        const text = await res.text();
        json = text ? JSON.parse(text) : null;
      } catch {}

      return {
        status: res.status,
        headers: res.headers,
        data: json?.data,
        error: json?.error,
        raw: json,
      };
    }

    let ownerCookie = '';
    let ownerCsrf = '';
    let ownerSessionToken = '';

    // 2. Single Login & Single Session Cookie (mglite_session)
    await t.test(
      '2. Owner login sets single mglite_session cookie and yields active context',
      async () => {
        const loginRes = await apiRequest('/api/v1/auth/login', 'POST', {
          identifier: ownerCreds.identifier,
          password: ownerCreds.password,
        });

        assert.equal(loginRes.status, 200);
        assert.equal(
          loginRes.data?.user?.id,
          ownerCreds.id,
          'Must match Acceptance Owner ID',
        );
        assert.equal(loginRes.data?.user?.username, ownerCreds.identifier);
        assert.equal(
          loginRes.data?.active_workspace?.id,
          '5c3bb47c-7566-4784-a262-11ff6cd32cbd',
          'Must match Acceptance Workspace ID',
        );
        assert.equal(loginRes.data?.active_workspace?.role, 'owner');
        assert.ok(loginRes.data?.csrf_token);
        ownerCsrf = loginRes.data.csrf_token;

        const setCookie = loginRes.headers.get('set-cookie');
        assert.ok(setCookie, 'Set-Cookie header must be present');
        assert.ok(
          setCookie.includes('mglite_session='),
          'Cookie must be mglite_session',
        );
        assert.ok(
          !setCookie.includes('mglite_work_session='),
          'Must not use isolated work cookie',
        );
        assert.ok(
          !setCookie.includes('mglite_acc_session='),
          'Must not use isolated acc cookie',
        );
        assert.ok(setCookie.includes('HttpOnly'), 'Cookie must be HttpOnly');
        assert.ok(
          setCookie.includes('SameSite=Lax'),
          'Cookie must be SameSite=Lax',
        );

        ownerCookie = setCookie.split(';')[0];
        ownerSessionToken = ownerCookie.replace('mglite_session=', '');

        // Verify /auth/me
        const meRes = await apiRequest(
          '/api/v1/auth/me',
          'GET',
          null,
          ownerCookie,
        );
        assert.equal(meRes.status, 200);
        assert.equal(
          meRes.data?.user?.id,
          ownerCreds.id,
          'Must match Acceptance Owner ID',
        );
        assert.equal(meRes.data?.user?.username, ownerCreds.identifier);
        assert.equal(
          meRes.data?.active_workspace?.id,
          '5c3bb47c-7566-4784-a262-11ff6cd32cbd',
          'Must match Acceptance Workspace ID',
        );
        assert.equal(meRes.data?.active_workspace?.role, 'owner');
      },
    );

    // 3. Module: Nhân sự (Employees) in single session
    await t.test(
      '3. Module Nhân sự: Owner accesses employees list and details',
      async () => {
        const empRes = await apiRequest(
          '/api/v1/employees?limit=50',
          'GET',
          null,
          ownerCookie,
        );
        assert.equal(empRes.status, 200);
        assert.ok(Array.isArray(empRes.data?.items));
        assert.ok(
          empRes.data.items.length >= 4,
          'Must have at least 4 employees (OWNER, ADMIN, NV001, NV002)',
        );
        const codes = empRes.data.items.map((e) => e.employee_code);
        assert.ok(codes.includes('NV001'));
        assert.ok(codes.includes('NV002'));

        // Detail view
        const nv001 = empRes.data.items.find(
          (e) => e.employee_code === 'NV001',
        );
        const detailRes = await apiRequest(
          `/api/v1/employees/${nv001.id}`,
          'GET',
          null,
          ownerCookie,
        );
        assert.equal(detailRes.status, 200);
        assert.equal(detailRes.data?.employee_code, 'NV001');
      },
    );

    // 4. Module: Chấm công (Attendance) in single session
    await t.test(
      '4. Module Chấm công: Owner accesses attendance shifts',
      async () => {
        const attRes = await apiRequest(
          '/api/v1/attendance/shifts',
          'GET',
          null,
          ownerCookie,
        );
        assert.equal(attRes.status, 200);
        assert.ok(Array.isArray(attRes.data?.shifts));
        assert.ok(
          attRes.data.shifts.length >= 2,
          'Must have seeded attendance shifts',
        );
      },
    );

    // 5. Module: Lịch làm việc (Schedules) in single session
    await t.test(
      '5. Module Lịch làm việc: Owner accesses weekly schedule',
      async () => {
        const schedRes = await apiRequest(
          '/api/v1/schedules?week_start_date=2026-10-05',
          'GET',
          null,
          ownerCookie,
        );
        assert.equal(schedRes.status, 200);
        assert.ok(schedRes.data !== undefined);
      },
    );

    // 6. Module: Bảng lương (Payroll) in single session
    await t.test(
      '6. Module Bảng lương: Owner accesses payroll periods and calculations',
      async () => {
        const payRes = await apiRequest(
          '/api/v1/payroll/periods',
          'GET',
          null,
          ownerCookie,
        );
        assert.equal(payRes.status, 200);
        assert.ok(Array.isArray(payRes.data));
        const period = payRes.data.find((p) => p.period_month === '2026-10');
        assert.ok(period, 'Must have seeded 2026-10 payroll period');

        // Detail view of payroll period overview (2026-10)
        const payDetailRes = await apiRequest(
          '/api/v1/payroll/periods/2026-10',
          'GET',
          null,
          ownerCookie,
        );
        assert.equal(payDetailRes.status, 200);
        assert.equal(payDetailRes.data?.period?.period_month, '2026-10');
        assert.ok(Array.isArray(payDetailRes.data?.items));
        assert.ok(payDetailRes.data.items.length >= 2);
      },
    );

    // 7. Module: WORK in single session
    let seededWorkItemId = '';
    await t.test(
      '7. Module WORK: Owner accesses work items and assignments',
      async () => {
        const workRes = await apiRequest(
          '/api/v1/work-items',
          'GET',
          null,
          ownerCookie,
        );
        assert.equal(workRes.status, 200);
        assert.ok(Array.isArray(workRes.data?.items));
        const item =
          workRes.data.items.find(
            (w) =>
              w.title.includes('Thiết kế banner') ||
              w.title.includes('Kiểm kê kho hàng'),
          ) || workRes.data.items[0];
        assert.ok(item, 'Must find seeded work item');
        seededWorkItemId = item.id;

        // Detail view
        const itemDetail = await apiRequest(
          `/api/v1/work-items/${seededWorkItemId}`,
          'GET',
          null,
          ownerCookie,
        );
        assert.equal(itemDetail.status, 200);
        assert.equal(itemDetail.data?.id, seededWorkItemId);
      },
    );

    // 8. Module: ACC in single session with Reauth Protocol & AEAD Vault
    let seededAccountId = '';
    await t.test(
      '8. Module ACC: Owner accesses accounts, completes reauth, and reveals AEAD secret',
      async () => {
        const accRes = await apiRequest(
          '/api/v1/accounts',
          'GET',
          null,
          ownerCookie,
        );
        assert.equal(accRes.status, 200);
        assert.ok(Array.isArray(accRes.data?.items));
        const acc =
          accRes.data.items.find(
            (a) => a.platform === 'tiktok' && a.username === 'shop_admin',
          ) || accRes.data.items.find((a) => a.platform === 'tiktok');
        assert.ok(acc, 'Must find TikTok account');
        seededAccountId = acc.id;

        // Unauthenticated / unreauthenticated reveal MUST fail with 401
        const unreauthReveal = await apiRequest(
          `/api/v1/accounts/${seededAccountId}/secrets/reveal`,
          'POST',
          { secret_type: 'password' },
          ownerCookie,
          ownerCsrf,
        );
        assert.equal(unreauthReveal.status, 403);
        assert.equal(unreauthReveal.error?.code, 'REAUTH_REQUIRED');

        // Perform step-up reauthentication
        const reauthRes = await apiRequest(
          '/api/v1/auth/reauth',
          'POST',
          {
            password: ownerCreds.password,
            account_id: seededAccountId,
            action: 'secret_reveal',
          },
          ownerCookie,
          ownerCsrf,
        );
        assert.equal(reauthRes.status, 200);
        assert.ok(
          reauthRes.data?.reauth_proof,
          'Must return reauth proof token',
        );
        const proof = reauthRes.data.reauth_proof;

        // Reveal secret with proof
        const revealRes = await apiRequest(
          `/api/v1/accounts/${seededAccountId}/secrets/reveal`,
          'POST',
          { secret_type: 'password', reauth_proof: proof },
          ownerCookie,
          ownerCsrf,
        );
        assert.equal(revealRes.status, 200);
        assert.equal(revealRes.data?.secret_value, 'TikTokPass2026!Secure');

        // Single-use proof invariant: second attempt with same proof MUST fail
        const reuseReveal = await apiRequest(
          `/api/v1/accounts/${seededAccountId}/secrets/reveal`,
          'POST',
          { secret_type: 'password', reauth_proof: proof },
          ownerCookie,
          ownerCsrf,
        );
        assert.equal(reuseReveal.status, 403);
        assert.equal(reuseReveal.error?.code, 'REAUTH_REQUIRED');
      },
    );

    // 9. Module: FILE in single session
    let rootFolderId = '';
    await t.test(
      '9. Module FILE: Owner views storage folders and delete_readiness',
      async () => {
        const fileRes = await apiRequest(
          '/api/v1/storage/folders',
          'GET',
          null,
          ownerCookie,
        );
        assert.equal(fileRes.status, 200);
        assert.ok(Array.isArray(fileRes.data));
        assert.ok(fileRes.data.length >= 2, 'Must have seeded storage folders');
        const srcFolder = fileRes.data.find((f) => f.folder_type === 'source');
        assert.ok(srcFolder, 'Must find source folder');
        rootFolderId = srcFolder.id;

        // Detail view
        const detailRes = await apiRequest(
          `/api/v1/storage/folders/${rootFolderId}`,
          'GET',
          null,
          ownerCookie,
        );
        assert.equal(detailRes.status, 200);
        assert.ok(detailRes.data?.delete_readiness);
        // Readiness is computed fail-closed (deliverables not yet completed/approved)
        assert.equal(
          typeof detailRes.data.delete_readiness.is_ready,
          'boolean',
        );
      },
    );

    // 10. Staff Login & Strict RBAC Enforcement
    let staffCookie = '';
    let staffCsrf = '';
    await t.test(
      '10. Staff Login & Strict RBAC: Staff permitted WORK/FILE, blocked from ACC/PAY/EMP',
      async () => {
        const staffLogin = await apiRequest('/api/v1/auth/login', 'POST', {
          identifier: staffCreds.identifier,
          password: staffCreds.password,
        });
        assert.equal(staffLogin.status, 200);
        assert.equal(
          staffLogin.data?.user?.id,
          staffCreds.id,
          'Must match Acceptance Staff ID',
        );
        assert.equal(staffLogin.data?.user?.username, staffCreds.identifier);
        assert.equal(
          staffLogin.data?.active_workspace?.id,
          '5c3bb47c-7566-4784-a262-11ff6cd32cbd',
          'Must match Acceptance Workspace ID',
        );
        assert.equal(staffLogin.data?.active_workspace?.role, 'staff');

        const staffSetCookie = staffLogin.headers.get('set-cookie');
        staffCookie = staffSetCookie.split(';')[0];
        staffCsrf = staffLogin.data.csrf_token;
        assert.ok(staffCsrf, 'Staff login must provide valid CSRF token');

        // Staff CAN access WORK
        const staffWork = await apiRequest(
          '/api/v1/work-items',
          'GET',
          null,
          staffCookie,
        );
        assert.equal(staffWork.status, 200);

        // Staff CAN access FILE
        const staffFile = await apiRequest(
          '/api/v1/storage/folders',
          'GET',
          null,
          staffCookie,
        );
        assert.equal(staffFile.status, 200);

        // Staff CANNOT access ACC (403 FORBIDDEN)
        const staffAcc = await apiRequest(
          '/api/v1/accounts',
          'GET',
          null,
          staffCookie,
        );
        assert.equal(staffAcc.status, 403);
        assert.equal(staffAcc.error?.code, 'FORBIDDEN');

        // Staff CANNOT access Payroll overview (403 FORBIDDEN)
        const staffPay = await apiRequest(
          '/api/v1/payroll/periods/2026-10',
          'GET',
          null,
          staffCookie,
        );
        assert.equal(staffPay.status, 403);
        assert.equal(staffPay.error?.code, 'FORBIDDEN');

        // Staff CANNOT access Hourly rates (403 FORBIDDEN)
        const staffRates = await apiRequest(
          '/api/v1/payroll/hourly-rates',
          'GET',
          null,
          staffCookie,
        );
        assert.equal(staffRates.status, 403);
        assert.equal(staffRates.error?.code, 'FORBIDDEN');

        // Staff CANNOT access Employees (403 FORBIDDEN)
        const staffEmp = await apiRequest(
          '/api/v1/employees',
          'GET',
          null,
          staffCookie,
        );
        assert.equal(staffEmp.status, 403);
        assert.equal(staffEmp.error?.code, 'FORBIDDEN');
      },
    );

    // 11. CSRF and Origin Protection
    await t.test(
      '11. Security Protection: Missing CSRF and Invalid Origin rejected with 403',
      async () => {
        // Missing CSRF on state-changing route
        const noCsrf = await apiRequest(
          '/api/v1/auth/reauth',
          'POST',
          { password: ownerCreds.password, action: 'secret_reveal' },
          ownerCookie,
          null, // No CSRF
        );
        assert.equal(noCsrf.status, 403);
        assert.equal(noCsrf.error?.code, 'FORBIDDEN');
        assert.ok(noCsrf.error?.message?.includes('CSRF'));

        // Invalid Origin on state-changing route
        const badOrigin = await apiRequest(
          '/api/v1/auth/reauth',
          'POST',
          { password: ownerCreds.password, action: 'secret_reveal' },
          ownerCookie,
          ownerCsrf,
          'http://malicious-attacker.com',
        );
        assert.equal(badOrigin.status, 403);
        assert.equal(badOrigin.error?.code, 'FORBIDDEN');
        assert.ok(badOrigin.error?.message?.includes('Origin'));
      },
    );

    // 12. Logout & Session Revocation
    await t.test(
      '12. Logout revokes session token and clears mglite_session cookie',
      async () => {
        const logoutRes = await apiRequest(
          '/api/v1/auth/logout',
          'POST',
          {},
          ownerCookie,
          ownerCsrf,
        );
        assert.equal(logoutRes.status, 204);

        const clearCookie = logoutRes.headers.get('set-cookie');
        assert.ok(clearCookie, 'Set-Cookie must be returned on logout');
        assert.ok(
          clearCookie.includes('mglite_session='),
          'Must clear mglite_session',
        );
        assert.ok(clearCookie.includes('Max-Age=0'), 'Must set Max-Age=0');

        // Subsequent /auth/me with revoked cookie MUST return 401 UNAUTHENTICATED
        const postLogoutMe = await apiRequest(
          '/api/v1/auth/me',
          'GET',
          null,
          ownerCookie,
        );
        assert.equal(postLogoutMe.status, 401);
        assert.equal(postLogoutMe.error?.code, 'UNAUTHENTICATED');

        // Invariant: Session row in DB must be revoked
        const sessionRow = await pool.query(
          'SELECT revoked_at FROM auth_sessions WHERE session_token_hash = $1;',
          [crypto.createHash('sha256').update(ownerSessionToken).digest('hex')],
        );
        if (sessionRow.rows.length > 0) {
          assert.ok(
            sessionRow.rows[0].revoked_at !== null,
            'Session must be marked revoked_at',
          );
        }
      },
    );
  } finally {
    await closeDatabasePool(pool);
  }
});
