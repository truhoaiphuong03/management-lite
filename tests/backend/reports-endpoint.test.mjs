import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { loadConfirmedTestConfig, loadQaEndpoint } from '../../scripts/explicit-database.mjs';

import {
  getAcceptanceOwnerCredentials,
  getAcceptanceStaffCredentials,
} from '../../scripts/qa-credentials-reader.mjs';

test('UI-REPORT-01: User Bug Reports Endpoint (POST /api/v1/reports) and RBAC', async (t) => {
  const apiBase = loadQaEndpoint(process.env.QA_API_BASE);
  const origin = loadQaEndpoint(process.env.QA_WEB_BASE);

  const ownerCreds = getAcceptanceOwnerCredentials();
  const staffCreds = getAcceptanceStaffCredentials();

  const pool = new pg.Pool(loadConfirmedTestConfig());

  t.after(async () => {
    await pool.end();
  });

  async function apiRequest(path, method = 'GET', data = null, cookie = null, csrf = null, extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (cookie) headers['cookie'] = cookie;
    if (csrf) headers['x-csrf-token'] = csrf;
    if (data) headers['content-type'] = 'application/json';
    headers['origin'] = origin;

    const res = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      body: data ? JSON.stringify(data) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}

    const setCookie = res.headers.get('set-cookie');
    return { status: res.status, headers: res.headers, json, text, setCookie };
  }

  function extractCookie(setCookieHeader) {
    if (!setCookieHeader) return null;
    return setCookieHeader.split(';')[0].trim();
  }

  // 1. Authenticate Owner
  const ownerLoginRes = await apiRequest('/api/v1/auth/login', 'POST', {
    identifier: ownerCreds.identifier,
    password: ownerCreds.password,
  });
  assert.equal(ownerLoginRes.status, 200, 'Owner login must succeed');
  const ownerCookie = extractCookie(ownerLoginRes.setCookie);
  const ownerCsrf = ownerLoginRes.json?.data?.csrf_token;
  const ownerUserId = ownerLoginRes.json?.data?.user?.id;
  const activeWorkspaceId = ownerLoginRes.json?.data?.active_workspace?.id;
  assert.ok(ownerCookie);
  assert.ok(ownerCsrf);
  assert.ok(ownerUserId);
  assert.equal(ownerUserId, ownerCreds.id, 'Must be exact Acceptance Owner (admin)');

  // 2. Authenticate Staff
  const staffLoginRes = await apiRequest('/api/v1/auth/login', 'POST', {
    identifier: staffCreds.identifier,
    password: staffCreds.password,
  });
  assert.equal(staffLoginRes.status, 200, 'Staff login must succeed');
  const staffCookie = extractCookie(staffLoginRes.setCookie);
  const staffCsrf = staffLoginRes.json?.data?.csrf_token;
  const staffUserId = staffLoginRes.json?.data?.user?.id;
  assert.ok(staffCookie);
  assert.ok(staffCsrf);
  assert.ok(staffUserId);
  assert.equal(staffUserId, staffCreds.id, 'Must be exact Acceptance Staff');

  let staffReportId = '';
  let ownerReportId = '';

  // -------------------------------------------------------------------------
  // Test 1: Staff submits bug report via POST /api/v1/reports
  // -------------------------------------------------------------------------
  await t.test('1. Staff submits bug report successfully (201 Created)', async () => {
    const payload = {
      title: 'Lỗi không tải được tài liệu đính kèm',
      description: 'Khi bấm tải file trong màn hình công việc, thông báo lỗi xuất hiện liên tục.',
      route_template: '/work',
      module_name: 'Công việc (Work)',
    };

    const res = await apiRequest('/api/v1/reports', 'POST', payload, staffCookie, staffCsrf);
    assert.equal(res.status, 201, `Staff report should succeed: ${res.text}`);
    assert.equal(res.json?.success, true);
    assert.equal(res.json?.data?.type, 'bug');
    assert.equal(res.json?.data?.title, payload.title);
    assert.ok(res.json?.data?.description.includes(payload.description));
    assert.equal(res.json?.data?.status, 'open');
    assert.equal(res.json?.data?.reporter_user_id, staffUserId);

    staffReportId = res.json?.data?.id;
    assert.ok(staffReportId);

    // Verify durable storage in database
    const dbRes = await pool.query('SELECT * FROM issues WHERE id = $1', [staffReportId]);
    assert.equal(dbRes.rows.length, 1, 'Issue record must exist in PostgreSQL');
    assert.equal(dbRes.rows[0].workspace_id, activeWorkspaceId);
    assert.equal(dbRes.rows[0].reporter_user_id, staffUserId);
    assert.equal(dbRes.rows[0].status, 'open');

    // Verify activity record in database
    const actRes = await pool.query('SELECT * FROM issue_activity WHERE issue_id = $1', [staffReportId]);
    assert.equal(actRes.rows.length, 1, 'Activity record must exist in PostgreSQL');
    assert.equal(actRes.rows[0].action, 'created');
    assert.equal(actRes.rows[0].actor_user_id, staffUserId);
  });

  // -------------------------------------------------------------------------
  // Test 2: Owner submits bug report via POST /api/v1/reports
  // -------------------------------------------------------------------------
  await t.test('2. Owner submits bug report successfully (201 Created)', async () => {
    const payload = {
      title: 'Sai lệch số dư tài khoản sau giao dịch',
      description: 'Số dư sau chuyển khoản chưa trừ đúng giá trị.',
      route_template: '/accounts',
      module_name: 'Tài khoản (Accounts)',
    };

    const res = await apiRequest('/api/v1/reports', 'POST', payload, ownerCookie, ownerCsrf);
    assert.equal(res.status, 201, `Owner report should succeed: ${res.text}`);
    assert.equal(res.json?.success, true);
    assert.equal(res.json?.data?.reporter_user_id, ownerUserId);

    ownerReportId = res.json?.data?.id;
    assert.ok(ownerReportId);
  });

  // -------------------------------------------------------------------------
  // Test 3: Auto title generation when title is omitted
  // -------------------------------------------------------------------------
  await t.test('3. Auto title generation when title is omitted', async () => {
    const payload = {
      description: 'Giao diện bảng lương bị tràn lề ngang trên màn hình điện thoại di động.',
      route_template: '/payroll',
      module_name: 'Bảng lương (Payroll)',
    };

    const res = await apiRequest('/api/v1/reports', 'POST', payload, staffCookie, staffCsrf);
    assert.equal(res.status, 201);
    assert.ok(res.json?.data?.title.startsWith('[Báo lỗi]'));
    assert.ok(res.json?.data?.title.includes('Giao diện bảng lương'));
  });

  // -------------------------------------------------------------------------
  // Test 4: Validation errors (empty description)
  // -------------------------------------------------------------------------
  await t.test('4. Empty description returns 400 VALIDATION_ERROR', async () => {
    const emptyPayload = {
      description: '   ',
      route_template: '/work',
    };

    const res = await apiRequest('/api/v1/reports', 'POST', emptyPayload, staffCookie, staffCsrf);
    assert.equal(res.status, 400);
    assert.equal(res.json?.error?.code, 'VALIDATION_ERROR');
  });

  // -------------------------------------------------------------------------
  // Test 5: CSRF protection enforcement
  // -------------------------------------------------------------------------
  await t.test('5. Missing or invalid CSRF token rejected with 403', async () => {
    const payload = {
      description: 'Valid error description',
      route_template: '/work',
    };

    const missingCsrfRes = await apiRequest('/api/v1/reports', 'POST', payload, staffCookie, null);
    assert.equal(missingCsrfRes.status, 403, 'Missing CSRF must be rejected');

    const invalidCsrfRes = await apiRequest('/api/v1/reports', 'POST', payload, staffCookie, 'invalid-csrf-token');
    assert.equal(invalidCsrfRes.status, 403, 'Invalid CSRF must be rejected');
  });

  // -------------------------------------------------------------------------
  // Test 6: Unauthenticated request enforcement
  // -------------------------------------------------------------------------
  await t.test('6. Unauthenticated request rejected with 401', async () => {
    const payload = {
      description: 'Anonymous bug report',
      route_template: '/work',
    };

    const res = await apiRequest('/api/v1/reports', 'POST', payload, null, null);
    assert.equal(res.status, 401, 'Unauthenticated request must be rejected');
  });

  // -------------------------------------------------------------------------
  // Test 7: Owner views both reports in existing Issues list
  // -------------------------------------------------------------------------
  await t.test('7. Owner can view newly created reports in GET /api/v1/issues', async () => {
    const res = await apiRequest('/api/v1/issues', 'GET', null, ownerCookie);
    assert.equal(res.status, 200, 'Owner list issues must succeed');
    assert.equal(res.json?.success, true);

    const items = res.json?.data?.items || [];
    const staffReport = items.find((i) => i.id === staffReportId);
    const ownerReport = items.find((i) => i.id === ownerReportId);

    assert.ok(staffReport, 'Staff-submitted report must appear in Owner issue list');
    assert.ok(ownerReport, 'Owner-submitted report must appear in Owner issue list');
    assert.equal(staffReport.reporter_user_id, staffUserId);
    assert.equal(ownerReport.reporter_user_id, ownerUserId);
  });

  // -------------------------------------------------------------------------
  // Test 8: Staff CANNOT list issues or view other users' reports
  // -------------------------------------------------------------------------
  await t.test('8. Staff cannot access GET /api/v1/issues (403 FORBIDDEN)', async () => {
    const res = await apiRequest('/api/v1/issues', 'GET', null, staffCookie);
    assert.equal(res.status, 403, 'Staff must be forbidden from listing all issues');
  });

  // -------------------------------------------------------------------------
  // Test 9: Existing POST /api/v1/issues contract remains locked
  // -------------------------------------------------------------------------
  await t.test('9. Existing POST /api/v1/issues remains locked: Staff is 403 FORBIDDEN', async () => {
    const payload = {
      type: 'bug',
      title: 'Staff direct issue creation attempt',
      description: 'Should be rejected because POST /api/v1/issues is owner-only',
      route_template: '/work',
    };

    const res = await apiRequest('/api/v1/issues', 'POST', payload, staffCookie, staffCsrf);
    assert.equal(res.status, 403, 'POST /api/v1/issues must remain strictly owner-only');
  });
});
