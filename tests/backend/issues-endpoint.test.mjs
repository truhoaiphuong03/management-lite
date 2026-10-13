import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import { loadConfirmedTestConfig, loadQaEndpoint } from '../../scripts/explicit-database.mjs';

import {
  getAcceptanceOwnerCredentials,
  getAcceptanceStaffCredentials,
} from '../../scripts/qa-credentials-reader.mjs';

test('ISSUES LITE V0.1 CP1: Database, API Contracts, RBAC, Idempotency, Concurrency, and Immutability', async (t) => {
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
    const etag = res.headers.get('etag');

    return { status: res.status, headers: res.headers, json, text, setCookie, etag };
  }

  // Helper to extract session cookie
  function extractCookie(setCookieHeader) {
    if (!setCookieHeader) return null;
    return setCookieHeader.split(';')[0].trim();
  }

  // Authenticate Owner
  const ownerLoginRes = await apiRequest('/api/v1/auth/login', 'POST', {
    identifier: ownerCreds.identifier,
    password: ownerCreds.password,
  });
  assert.equal(ownerLoginRes.status, 200, 'Owner login must succeed');
  assert.equal(ownerLoginRes.json?.data?.user?.id, ownerCreds.id, 'Must be exact Acceptance Owner (admin)');
  const ownerCookie = extractCookie(ownerLoginRes.setCookie);
  const ownerCsrf = ownerLoginRes.json?.data?.csrf_token;
  const activeWorkspaceId = ownerLoginRes.json?.data?.active_workspace?.id;
  assert.ok(ownerCookie, 'Must have owner session cookie');
  assert.ok(ownerCsrf, 'Must have owner CSRF token');
  assert.ok(activeWorkspaceId, 'Must have active workspace ID');

  // Authenticate Staff
  const staffLoginRes = await apiRequest('/api/v1/auth/login', 'POST', {
    identifier: staffCreds.identifier,
    password: staffCreds.password,
  });
  assert.equal(staffLoginRes.status, 200, 'Staff login must succeed');
  assert.equal(staffLoginRes.json?.data?.user?.id, staffCreds.id, 'Must be exact Acceptance Staff');
  const staffCookie = extractCookie(staffLoginRes.setCookie);
  const staffCsrf = staffLoginRes.json?.data?.csrf_token;
  assert.ok(staffCookie, 'Must have staff session cookie');
  assert.ok(staffCsrf, 'Must have staff CSRF token');

  let testBugId = '';
  let testImprovementId = '';
  let currentBugVersion = 1;

  // 1. Owner creates a bug
  await t.test('1. Owner creates a bug successfully', async () => {
    const idempotencyKey = `create-bug-${Date.now()}`;
    const payload = {
      type: 'bug',
      title: 'Lỗi hiển thị tiêu đề trong modal phân lịch',
      description: 'Khi mở modal phân lịch trên trình duyệt, tiêu đề bị che khuất bởi header cố định.',
      route_template: '/schedules',
    };

    const res = await apiRequest(
      '/api/v1/issues',
      'POST',
      payload,
      ownerCookie,
      ownerCsrf,
      { 'idempotency-key': idempotencyKey },
    );

    assert.equal(res.status, 201);
    assert.equal(res.json?.success, true);
    assert.equal(res.json?.data?.type, 'bug');
    assert.equal(res.json?.data?.title, payload.title);
    assert.equal(res.json?.data?.description, payload.description);
    assert.equal(res.json?.data?.route_template, payload.route_template);
    assert.equal(res.json?.data?.status, 'open');
    assert.equal(res.json?.data?.version, 1);
    assert.equal(res.etag, '"1"');

    testBugId = res.json?.data?.id;
    currentBugVersion = res.json?.data?.version;
    assert.ok(testBugId, 'Must return issue id');
  });

  // 2. Owner creates an improvement
  await t.test('2. Owner creates an improvement successfully', async () => {
    const payload = {
      type: 'improvement',
      title: 'Bổ sung phím tắt nhanh để duyệt chấm công',
      description: 'Cho phép Owner bấm phím D để duyệt nhanh ca làm việc đang xem.',
      route_template: '/clock',
    };

    const res = await apiRequest(
      '/api/v1/issues',
      'POST',
      payload,
      ownerCookie,
      ownerCsrf,
      { 'idempotency-key': `create-imp-${Date.now()}` },
    );

    assert.equal(res.status, 201);
    assert.equal(res.json?.success, true);
    assert.equal(res.json?.data?.type, 'improvement');
    assert.equal(res.json?.data?.status, 'open');

    testImprovementId = res.json?.data?.id;
    assert.ok(testImprovementId, 'Must return improvement id');
  });

  // 3. Staff create/list/detail/mutation denied
  await t.test('3. Staff access is completely denied (403 FORBIDDEN)', async () => {
    // 3.1 Staff create
    const createRes = await apiRequest(
      '/api/v1/issues',
      'POST',
      {
        type: 'bug',
        title: 'Staff unauthorized bug',
        description: 'Should be rejected',
        route_template: '/work',
      },
      staffCookie,
      staffCsrf,
    );
    assert.equal(createRes.status, 403);
    assert.equal(createRes.json?.error?.code, 'FORBIDDEN');

    // 3.2 Staff list
    const listRes = await apiRequest('/api/v1/issues', 'GET', null, staffCookie);
    assert.equal(listRes.status, 403);
    assert.equal(listRes.json?.error?.code, 'FORBIDDEN');

    // 3.3 Staff detail
    const detailRes = await apiRequest(`/api/v1/issues/${testBugId}`, 'GET', null, staffCookie);
    assert.equal(detailRes.status, 403);
    assert.equal(detailRes.json?.error?.code, 'FORBIDDEN');

    // 3.4 Staff mutation
    const updateRes = await apiRequest(
      `/api/v1/issues/${testBugId}`,
      'PATCH',
      { title: 'Hacked by staff' },
      staffCookie,
      staffCsrf,
      { 'if-match': '"1"' },
    );
    assert.equal(updateRes.status, 403);
    assert.equal(updateRes.json?.error?.code, 'FORBIDDEN');
  });

  // 4. Anonymous access denied
  await t.test('4. Anonymous access returns 401 UNAUTHENTICATED', async () => {
    const res = await apiRequest('/api/v1/issues', 'GET');
    assert.equal(res.status, 401);
    assert.equal(res.json?.error?.code, 'UNAUTHENTICATED');
  });

  // 5. Cross-workspace ID concealed as 404
  await t.test('5. Non-existent or cross-workspace ID returns concealed 404', async () => {
    const fakeUuid = '00000000-0000-0000-0000-000000000000';
    const res = await apiRequest(`/api/v1/issues/${fakeUuid}`, 'GET', null, ownerCookie);
    assert.equal(res.status, 404);
    assert.equal(res.json?.error?.code, 'NOT_FOUND');
  });

  // 6. Client-supplied workspace/actor fields rejected
  await t.test('6. Client-supplied workspace/actor fields rejected with VALIDATION_ERROR', async () => {
    const res = await apiRequest(
      '/api/v1/issues',
      'POST',
      {
        type: 'bug',
        title: 'Tampered fields issue',
        description: 'Trying to inject workspace_id',
        route_template: '/employees',
        workspace_id: '00000000-0000-0000-0000-000000000000',
      },
      ownerCookie,
      ownerCsrf,
      { 'idempotency-key': `tamper-${Date.now()}` },
    );
    assert.equal(res.status, 400);
    assert.equal(res.json?.error?.code, 'VALIDATION_ERROR');
  });

  // 7. Invalid title, description, type, and route rejected
  await t.test('7. Input validation rejects invalid title, description, type, and route', async () => {
    // 7.1 Empty title
    const emptyTitleRes = await apiRequest(
      '/api/v1/issues',
      'POST',
      { type: 'bug', title: '   ', description: 'desc', route_template: '/work' },
      ownerCookie,
      ownerCsrf,
      { 'idempotency-key': `empty-title-${Date.now()}` },
    );
    assert.equal(emptyTitleRes.status, 400);

    // 7.2 Invalid type
    const badTypeRes = await apiRequest(
      '/api/v1/issues',
      'POST',
      { type: 'critical_bug', title: 'Title', description: 'desc', route_template: '/work' },
      ownerCookie,
      ownerCsrf,
      { 'idempotency-key': `bad-type-${Date.now()}` },
    );
    assert.equal(badTypeRes.status, 400);

    // 7.3 Unsafe route containing query string (?)
    const badRouteRes = await apiRequest(
      '/api/v1/issues',
      'POST',
      { type: 'bug', title: 'Title', description: 'desc', route_template: '/work?token=secret123' },
      ownerCookie,
      ownerCsrf,
      { 'idempotency-key': `bad-route-${Date.now()}` },
    );
    assert.equal(badRouteRes.status, 400);
  });

  // 8. Pagination cursor and filters validated
  await t.test('8. List endpoint filters and cursor pagination', async () => {
    // 8.1 Filter by type = 'bug'
    const bugListRes = await apiRequest('/api/v1/issues?type=bug', 'GET', null, ownerCookie);
    assert.equal(bugListRes.status, 200);
    for (const item of bugListRes.json.data.items) {
      assert.equal(item.type, 'bug');
    }

    // 8.2 Filter by status = 'active'
    const activeListRes = await apiRequest('/api/v1/issues?status=active', 'GET', null, ownerCookie);
    assert.equal(activeListRes.status, 200);
    assert.ok(activeListRes.json.data.items.length >= 2);

    // 8.3 Malformed cursor returns 400 INVALID_CURSOR
    const badCursorRes = await apiRequest('/api/v1/issues?cursor=bad-base64-string', 'GET', null, ownerCookie);
    assert.equal(badCursorRes.status, 400);
    assert.equal(badCursorRes.json?.error?.code, 'INVALID_CURSOR');
  });

  // 9. Mandatory Idempotency-Key validation on all mutations
  await t.test('9. Mandatory Idempotency-Key enforcement on all four mutations', async () => {
    // 9.1 Missing Idempotency-Key on POST /issues -> 400 VALIDATION_ERROR
    const noKeyCreateRes = await apiRequest(
      '/api/v1/issues',
      'POST',
      { type: 'bug', title: 'No key bug', description: 'desc', route_template: '/work' },
      ownerCookie,
      ownerCsrf,
    );
    assert.equal(noKeyCreateRes.status, 400);
    assert.equal(noKeyCreateRes.json?.error?.code, 'VALIDATION_ERROR');

    // 9.2 Missing Idempotency-Key on PATCH /issues/:id -> 400 VALIDATION_ERROR
    const noKeyPatchRes = await apiRequest(
      `/api/v1/issues/${testBugId}`,
      'PATCH',
      { title: 'No key title' },
      ownerCookie,
      ownerCsrf,
      { 'if-match': '"1"' },
    );
    assert.equal(noKeyPatchRes.status, 400);
    assert.equal(noKeyPatchRes.json?.error?.code, 'VALIDATION_ERROR');

    // 9.3 Missing Idempotency-Key on POST /confirm-fix -> 400 VALIDATION_ERROR
    const noKeyConfirmRes = await apiRequest(
      `/api/v1/issues/${testBugId}/confirm-fix`,
      'POST',
      { comment: 'test' },
      ownerCookie,
      ownerCsrf,
      { 'if-match': '"1"' },
    );
    assert.equal(noKeyConfirmRes.status, 400);
    assert.equal(noKeyConfirmRes.json?.error?.code, 'VALIDATION_ERROR');

    // 9.4 Missing Idempotency-Key on POST /reopen -> 400 VALIDATION_ERROR
    const noKeyReopenRes = await apiRequest(
      `/api/v1/issues/${testBugId}/reopen`,
      'POST',
      { reason: 'reopen reason' },
      ownerCookie,
      ownerCsrf,
      { 'if-match': '"1"' },
    );
    assert.equal(noKeyReopenRes.status, 400);
    assert.equal(noKeyReopenRes.json?.error?.code, 'VALIDATION_ERROR');

    // 9.5 Blank / whitespace Idempotency-Key -> 400 VALIDATION_ERROR
    const blankKeyRes = await apiRequest(
      '/api/v1/issues',
      'POST',
      { type: 'bug', title: 'Blank key bug', description: 'desc', route_template: '/work' },
      ownerCookie,
      ownerCsrf,
      { 'idempotency-key': '    ' },
    );
    assert.equal(blankKeyRes.status, 400);
    assert.equal(blankKeyRes.json?.error?.code, 'VALIDATION_ERROR');

    // 9.6 Malformed Idempotency-Key (spaces / non-printable / oversized > 128) -> 400 VALIDATION_ERROR
    const spacesKeyRes = await apiRequest(
      '/api/v1/issues',
      'POST',
      { type: 'bug', title: 'Spaces key bug', description: 'desc', route_template: '/work' },
      ownerCookie,
      ownerCsrf,
      { 'idempotency-key': 'invalid key with spaces' },
    );
    assert.equal(spacesKeyRes.status, 400);
    assert.equal(spacesKeyRes.json?.error?.code, 'VALIDATION_ERROR');

    const oversizedKeyRes = await apiRequest(
      '/api/v1/issues',
      'POST',
      { type: 'bug', title: 'Oversized key bug', description: 'desc', route_template: '/work' },
      ownerCookie,
      ownerCsrf,
      { 'idempotency-key': 'k'.repeat(129) },
    );
    assert.equal(oversizedKeyRes.status, 400);
    assert.equal(oversizedKeyRes.json?.error?.code, 'VALIDATION_ERROR');
  });

  // 10. Idempotency replay, fingerprint conflict, and concurrent duplicate handling
  await t.test('10. Idempotency replay, fingerprint conflict, and concurrent handling', async () => {
    const key = `idem-key-test-${Date.now()}`;
    const payload = {
      type: 'bug',
      title: 'Idempotency test issue',
      description: 'Testing idempotent replay',
      route_template: '/settings',
    };

    const firstRes = await apiRequest(
      '/api/v1/issues',
      'POST',
      payload,
      ownerCookie,
      ownerCsrf,
      { 'idempotency-key': key },
    );
    assert.equal(firstRes.status, 201, 'First create returns 201');
    const createdId = firstRes.json.data.id;

    // Replay identical request: must preserve 201 Created and return same ID
    const replayRes = await apiRequest(
      '/api/v1/issues',
      'POST',
      payload,
      ownerCookie,
      ownerCsrf,
      { 'idempotency-key': key },
    );
    assert.equal(replayRes.status, 201, 'Replay preserves original 201 Created HTTP status');
    assert.equal(replayRes.json.data.id, createdId);

    // Fingerprint mismatch with same key returns 409 CONFLICT
    const mismatchRes = await apiRequest(
      '/api/v1/issues',
      'POST',
      { ...payload, title: 'Altered title with same key' },
      ownerCookie,
      ownerCsrf,
      { 'idempotency-key': key },
    );
    assert.equal(mismatchRes.status, 409);
    assert.equal(mismatchRes.json?.error?.code, 'CONFLICT');

    // Concurrent duplicate requests with same key must not produce duplicate writes
    const concurrentTitle = `Concurrent idempotency issue ${Date.now()}`;
    const concurrentKey = `concurrent-test-${Date.now()}`;
    const concurrentPayload = {
      type: 'improvement',
      title: concurrentTitle,
      description: 'Testing concurrent barrier',
      route_template: '/employees',
    };

    const [cRes1, cRes2] = await Promise.all([
      apiRequest(
        '/api/v1/issues',
        'POST',
        concurrentPayload,
        ownerCookie,
        ownerCsrf,
        { 'idempotency-key': concurrentKey },
      ),
      apiRequest(
        '/api/v1/issues',
        'POST',
        concurrentPayload,
        ownerCookie,
        ownerCsrf,
        { 'idempotency-key': concurrentKey },
      ),
    ]);

    // One succeeds with 201; the other either replays with 201 or is rejected with 409 in_progress
    assert.ok(
      cRes1.status === 201 || cRes2.status === 201,
      'At least one concurrent request must succeed with 201',
    );
    if (cRes1.status === 201 && cRes2.status === 201) {
      assert.equal(cRes1.json.data.id, cRes2.json.data.id, 'Both return same issue if replayed');
    } else {
      const other = cRes1.status === 201 ? cRes2 : cRes1;
      assert.equal(other.status, 409, 'Concurrent competitor receives 409 in_progress conflict');
    }

    // Database row count verification: exactly 1 row created for concurrentPayload.title
    const dbCountRes = await pool.query(
      "SELECT count(*)::int as c FROM issues WHERE title = $1",
      [concurrentTitle],
    );
    assert.equal(dbCountRes.rows[0].c, 1, 'Exactly one row created in database despite concurrent requests');
  });

  // 11. Missing If-Match returns 428
  await t.test('11. Missing If-Match header returns 428 PRECONDITION_REQUIRED', async () => {
    const res = await apiRequest(
      `/api/v1/issues/${testBugId}`,
      'PATCH',
      { title: 'New title without if-match' },
      ownerCookie,
      ownerCsrf,
      { 'idempotency-key': `no-if-match-${Date.now()}` },
    );
    assert.equal(res.status, 428);
    assert.equal(res.json?.error?.code, 'PRECONDITION_REQUIRED');
  });

  // 12. Stale version returns 412
  await t.test('12. Stale If-Match version returns 412 PRECONDITION_FAILED', async () => {
    const res = await apiRequest(
      `/api/v1/issues/${testBugId}`,
      'PATCH',
      { title: 'New title with stale version' },
      ownerCookie,
      ownerCsrf,
      { 'if-match': '"999"', 'idempotency-key': `stale-if-match-${Date.now()}` },
    );
    assert.equal(res.status, 412);
    assert.equal(res.json?.error?.code, 'PRECONDITION_FAILED');
  });

  // 13 & 14. Status transitions and invalid transitions
  await t.test('13 & 14. Valid status transition succeeds; invalid transition rejected', async () => {
    // 14.1 Invalid transition: open -> awaiting_owner
    const badJumpRes = await apiRequest(
      `/api/v1/issues/${testBugId}`,
      'PATCH',
      { status: 'awaiting_owner' },
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${currentBugVersion}"`, 'idempotency-key': `bad-jump-${Date.now()}` },
    );
    assert.equal(badJumpRes.status, 400);
    assert.equal(badJumpRes.json?.error?.code, 'INVALID_STATE_TRANSITION');

    // 14.2 Generic PATCH cannot close issue
    const patchCloseRes = await apiRequest(
      `/api/v1/issues/${testBugId}`,
      'PATCH',
      { status: 'closed' },
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${currentBugVersion}"`, 'idempotency-key': `patch-close-${Date.now()}` },
    );
    assert.equal(patchCloseRes.status, 400);
    assert.equal(patchCloseRes.json?.error?.code, 'CANONICAL_VIOLATION');

    // Valid transition: open -> analyzing
    const analyzingRes = await apiRequest(
      `/api/v1/issues/${testBugId}`,
      'PATCH',
      { status: 'analyzing' },
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${currentBugVersion}"`, 'idempotency-key': `analyzing-${Date.now()}` },
    );
    assert.equal(analyzingRes.status, 200);
    assert.equal(analyzingRes.json?.data?.status, 'analyzing');
    assert.equal(analyzingRes.json?.data?.version, currentBugVersion + 1);
    currentBugVersion = analyzingRes.json?.data?.version;

    // Valid transition: analyzing -> fixing
    const fixingRes = await apiRequest(
      `/api/v1/issues/${testBugId}`,
      'PATCH',
      { status: 'fixing' },
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${currentBugVersion}"`, 'idempotency-key': `fixing-${Date.now()}` },
    );
    assert.equal(fixingRes.status, 200);
    assert.equal(fixingRes.json?.data?.status, 'fixing');
    currentBugVersion = fixingRes.json?.data?.version;

    // Valid transition: fixing -> awaiting_owner
    const awaitingRes = await apiRequest(
      `/api/v1/issues/${testBugId}`,
      'PATCH',
      { status: 'awaiting_owner' },
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${currentBugVersion}"`, 'idempotency-key': `awaiting-${Date.now()}` },
    );
    assert.equal(awaitingRes.status, 200);
    assert.equal(awaitingRes.json?.data?.status, 'awaiting_owner');
    currentBugVersion = awaitingRes.json?.data?.version;
  });

  // 14b. C-01: Failed Owner Verification (awaiting_owner -> fixing)
  await t.test('14b. C-01: Failed Owner Verification rules (awaiting_owner -> fixing)', async () => {
    // 14b.1 Missing reason rejected
    const noReasonRes = await apiRequest(
      `/api/v1/issues/${testBugId}`,
      'PATCH',
      { status: 'fixing' },
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${currentBugVersion}"`, 'idempotency-key': `c01-no-reason-${Date.now()}` },
    );
    assert.equal(noReasonRes.status, 400);
    assert.equal(noReasonRes.json?.error?.code, 'VALIDATION_ERROR');

    // 14b.2 Whitespace-only reason rejected
    const blankReasonRes = await apiRequest(
      `/api/v1/issues/${testBugId}`,
      'PATCH',
      { status: 'fixing', reason: '   ' },
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${currentBugVersion}"`, 'idempotency-key': `c01-blank-reason-${Date.now()}` },
    );
    assert.equal(blankReasonRes.status, 400);
    assert.equal(blankReasonRes.json?.error?.code, 'VALIDATION_ERROR');

    // 14b.3 Non-string reason rejected
    const nonStringReasonRes = await apiRequest(
      `/api/v1/issues/${testBugId}`,
      'PATCH',
      { status: 'fixing', reason: 12345 },
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${currentBugVersion}"`, 'idempotency-key': `c01-non-string-${Date.now()}` },
    );
    assert.equal(nonStringReasonRes.status, 400);
    assert.equal(nonStringReasonRes.json?.error?.code, 'VALIDATION_ERROR');

    // 14b.4 Reason over 1000 characters rejected
    const longReasonRes = await apiRequest(
      `/api/v1/issues/${testBugId}`,
      'PATCH',
      { status: 'fixing', reason: 'a'.repeat(1001) },
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${currentBugVersion}"`, 'idempotency-key': `c01-long-reason-${Date.now()}` },
    );
    assert.equal(longReasonRes.status, 400);
    assert.equal(longReasonRes.json?.error?.code, 'VALIDATION_ERROR');

    // 14b.5 Reason rejected on ordinary edits
    const editReasonRes = await apiRequest(
      `/api/v1/issues/${testBugId}`,
      'PATCH',
      { title: 'New title with reason', reason: 'Unrelated reason' },
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${currentBugVersion}"`, 'idempotency-key': `c01-edit-reason-${Date.now()}` },
    );
    assert.equal(editReasonRes.status, 400);
    assert.equal(editReasonRes.json?.error?.code, 'VALIDATION_ERROR');

    // 14b.6 Reason rejected on other status transitions
    const openTransitionReasonRes = await apiRequest(
      `/api/v1/issues/${testImprovementId}`,
      'PATCH',
      { status: 'analyzing', reason: 'Should not have reason' },
      ownerCookie,
      ownerCsrf,
      { 'if-match': '"1"', 'idempotency-key': `c01-unrelated-trans-${Date.now()}` },
    );
    assert.equal(openTransitionReasonRes.status, 400);
    assert.equal(openTransitionReasonRes.json?.error?.code, 'VALIDATION_ERROR');

    // 14b.7 Stale If-Match returns 412
    const staleFixRes = await apiRequest(
      `/api/v1/issues/${testBugId}`,
      'PATCH',
      { status: 'fixing', reason: 'Valid reason but stale version' },
      ownerCookie,
      ownerCsrf,
      { 'if-match': '"999"', 'idempotency-key': `c01-stale-${Date.now()}` },
    );
    assert.equal(staleFixRes.status, 412);
    assert.equal(staleFixRes.json?.error?.code, 'PRECONDITION_FAILED');

    // 14b.8 Valid awaiting_owner -> fixing succeeds
    const validRejectReason = 'Giao diện vẫn bị lệch 4px trên Safari iOS khi co màn hình.';
    const rejectIdemKey = `awaiting-to-fixing-${Date.now()}`;
    const rejectFixRes = await apiRequest(
      `/api/v1/issues/${testBugId}`,
      'PATCH',
      { status: 'fixing', reason: validRejectReason },
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${currentBugVersion}"`, 'idempotency-key': rejectIdemKey },
    );
    assert.equal(rejectFixRes.status, 200);
    assert.equal(rejectFixRes.json?.data?.status, 'fixing');
    assert.equal(rejectFixRes.json?.data?.id, testBugId, 'Issue ID must be unchanged');
    assert.equal(rejectFixRes.json?.data?.version, currentBugVersion + 1, 'Version must increment exactly once');
    currentBugVersion = rejectFixRes.json?.data?.version;

    // Verify activity contains validated reason
    const actRes = await pool.query(
      'SELECT * FROM issue_activity WHERE issue_id = $1 ORDER BY created_at DESC LIMIT 1',
      [testBugId],
    );
    assert.equal(actRes.rows[0]?.action, 'status_changed');
    assert.equal(actRes.rows[0]?.metadata_sanitized?.from_status, 'awaiting_owner');
    assert.equal(actRes.rows[0]?.metadata_sanitized?.to_status, 'fixing');
    assert.equal(actRes.rows[0]?.metadata_sanitized?.reason, validRejectReason);

    // Verify audit event does NOT contain raw reason
    const auditRowRes = await pool.query(
      "SELECT * FROM audit_events WHERE entity_id = $1 AND action = 'issue.status_changed' ORDER BY created_at DESC LIMIT 1",
      [testBugId],
    );
    assert.equal(auditRowRes.rows[0]?.action, 'issue.status_changed');
    assert.equal(auditRowRes.rows[0]?.metadata_sanitized?.previous_status, 'awaiting_owner');
    assert.equal(auditRowRes.rows[0]?.metadata_sanitized?.new_status, 'fixing');
    assert.equal(auditRowRes.rows[0]?.metadata_sanitized?.new_version, currentBugVersion);
    assert.equal(auditRowRes.rows[0]?.metadata_sanitized?.reason, undefined, 'Audit MUST NOT contain raw reason');

    // Repeated request with same idempotency key returns cached response without duplicate activity/audit
    const actCountBefore = await pool.query('SELECT count(*)::int as c FROM issue_activity WHERE issue_id = $1', [testBugId]);
    const auditCountBefore = await pool.query("SELECT count(*)::int as c FROM audit_events WHERE entity_id = $1", [testBugId]);

    const replayRejectRes = await apiRequest(
      `/api/v1/issues/${testBugId}`,
      'PATCH',
      { status: 'fixing', reason: validRejectReason },
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${currentBugVersion - 1}"`, 'idempotency-key': rejectIdemKey },
    );
    assert.equal(replayRejectRes.status, 200);
    assert.equal(replayRejectRes.json?.data?.status, 'fixing');
    assert.equal(replayRejectRes.json?.data?.version, currentBugVersion);

    const actCountAfter = await pool.query('SELECT count(*)::int as c FROM issue_activity WHERE issue_id = $1', [testBugId]);
    const auditCountAfter = await pool.query("SELECT count(*)::int as c FROM audit_events WHERE entity_id = $1", [testBugId]);
    assert.equal(actCountAfter.rows[0].c, actCountBefore.rows[0].c, 'No duplicate activity writes on replay');
    assert.equal(auditCountAfter.rows[0].c, auditCountBefore.rows[0].c, 'No duplicate audit writes on replay');

    // Move back from fixing -> awaiting_owner for the next test (confirm-fix)
    const reAwaitingRes = await apiRequest(
      `/api/v1/issues/${testBugId}`,
      'PATCH',
      { status: 'awaiting_owner' },
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${currentBugVersion}"`, 'idempotency-key': `re-awaiting-${Date.now()}` },
    );
    assert.equal(reAwaitingRes.status, 200);
    assert.equal(reAwaitingRes.json?.data?.status, 'awaiting_owner');
    currentBugVersion = reAwaitingRes.json?.data?.version;
  });

  // 15. Confirm-fix closes and archives the issue
  await t.test('15. Owner confirms fix via dedicated endpoint: closes and archives issue', async () => {
    const res = await apiRequest(
      `/api/v1/issues/${testBugId}/confirm-fix`,
      'POST',
      { comment: 'Đã kiểm tra bản vá, giao diện hiển thị đúng chuẩn.' },
      ownerCookie,
      ownerCsrf,
      {
        'if-match': `"${currentBugVersion}"`,
        'idempotency-key': `confirm-fix-${Date.now()}`,
      },
    );

    assert.equal(res.status, 200);
    assert.equal(res.json?.data?.status, 'closed');
    assert.ok(res.json?.data?.closed_at, 'Must have closed_at timestamp');
    currentBugVersion = res.json?.data?.version;

    // Verify detail shows activity history
    const detailRes = await apiRequest(`/api/v1/issues/${testBugId}`, 'GET', null, ownerCookie);
    assert.equal(detailRes.status, 200);
    assert.equal(detailRes.json?.data?.issue?.status, 'closed');
    const activities = detailRes.json?.data?.activities || [];
    assert.ok(activities.some((a) => a.action === 'created'));
    assert.ok(activities.some((a) => a.action === 'status_changed'));
    assert.ok(activities.some((a) => a.action === 'fix_confirmed'));
  });

  // 16. Reopen creates an append-only history event
  await t.test('16. Owner reopens closed issue: status resets to open with reason', async () => {
    const res = await apiRequest(
      `/api/v1/issues/${testBugId}/reopen`,
      'POST',
      { reason: 'Tái hiện lại lỗi khi thu nhỏ màn hình xuống 375px.' },
      ownerCookie,
      ownerCsrf,
      {
        'if-match': `"${currentBugVersion}"`,
        'idempotency-key': `reopen-${Date.now()}`,
      },
    );

    assert.equal(res.status, 200);
    assert.equal(res.json?.data?.status, 'open');
    assert.equal(res.json?.data?.closed_at, null);
    currentBugVersion = res.json?.data?.version;

    // Verify detail has reopened activity
    const detailRes = await apiRequest(`/api/v1/issues/${testBugId}`, 'GET', null, ownerCookie);
    const activities = detailRes.json?.data?.activities || [];
    const reopenAct = activities.find((a) => a.action === 'reopened');
    assert.ok(reopenAct, 'Must contain reopened activity');
    assert.equal(reopenAct.metadata_sanitized?.reason, 'Tái hiện lại lỗi khi thu nhỏ màn hình xuống 375px.');
  });

  // 17. Activity UPDATE/DELETE rejected by database trigger
  await t.test('17. Database trigger prevents UPDATE and DELETE on issue_activity (append-only)', async () => {
    const actRow = await pool.query(
      'SELECT id FROM issue_activity WHERE issue_id = $1 LIMIT 1',
      [testBugId],
    );
    assert.ok(actRow.rows[0]?.id, 'Must find activity record');
    const actId = actRow.rows[0].id;

    // Test UPDATE prohibited
    await assert.rejects(
      async () => {
        await pool.query('UPDATE issue_activity SET action = $1 WHERE id = $2', ['edited', actId]);
      },
      (err) => {
        return err.message.includes('issue_activity is append-only');
      },
      'UPDATE must be blocked by trigger',
    );

    // Test DELETE prohibited
    await assert.rejects(
      async () => {
        await pool.query('DELETE FROM issue_activity WHERE id = $1', [actId]);
      },
      (err) => {
        return err.message.includes('issue_activity is append-only');
      },
      'DELETE must be blocked by trigger',
    );
  });

  // 18. Composite workspace FK blocks cross-workspace activity
  await t.test('18. Composite FK enforces workspace tenant isolation on issue_activity', async () => {
    // Create dummy workspace
    const wsRes = await pool.query(
      "INSERT INTO workspaces (name, timezone, status) VALUES ('Other WS', 'Asia/Ho_Chi_Minh', 'active') RETURNING id",
    );
    const otherWsId = wsRes.rows[0].id;

    try {
      // Attempt to link activity from other workspace to testBugId (which belongs to activeWorkspaceId)
      await assert.rejects(
        async () => {
          await pool.query(
            `INSERT INTO issue_activity (workspace_id, issue_id, actor_user_id, action)
             VALUES ($1, $2, (SELECT id FROM users LIMIT 1), 'created')`,
            [otherWsId, testBugId],
          );
        },
        (err) => {
          return err.code === '23503'; // foreign_key_violation
        },
        'Composite FK must block cross-workspace activity insertion',
      );
    } finally {
      await pool.query('DELETE FROM workspaces WHERE id = $1', [otherWsId]);
    }
  });

  // 19. Audit and issue writes roll back atomically on failure
  await t.test('19. Failure during transaction rolls back changes completely', async () => {
    const beforeCount = await pool.query('SELECT count(*)::int as count FROM issues');

    // Attempt create with invalid payload that fails mid-flight or invalid route
    const failRes = await apiRequest(
      '/api/v1/issues',
      'POST',
      {
        type: 'bug',
        title: 'Will fail',
        description: 'desc',
        route_template: 'invalid-no-leading-slash',
      },
      ownerCookie,
      ownerCsrf,
      { 'idempotency-key': `fail-rollback-${Date.now()}` },
    );
    assert.equal(failRes.status, 400);

    const afterCount = await pool.query('SELECT count(*)::int as count FROM issues');
    assert.equal(afterCount.rows[0].count, beforeCount.rows[0].count, 'Row count must not change on failure');
  });

  // 20. Existing modules remain unaffected
  await t.test('20. Existing modules (Auth, Audit, Work, Storage) continue working seamlessly', async () => {
    const meRes = await apiRequest('/api/v1/auth/me', 'GET', null, ownerCookie);
    assert.equal(meRes.status, 200);

    const auditRes = await apiRequest('/api/v1/audit?limit=5', 'GET', null, ownerCookie);
    assert.equal(auditRes.status, 200);

    const workRes = await apiRequest('/api/v1/work-items', 'GET', null, ownerCookie);
    assert.equal(workRes.status, 200);

    const storageRes = await apiRequest('/api/v1/storage/folders', 'GET', null, ownerCookie);
    assert.equal(storageRes.status, 200);
  });

  // 21. QA-02 Group A: Cross-workspace isolation (read, patch, confirm-fix, reopen)
  await t.test('21. QA-02 Group A: Cross-workspace isolation concealed 404 and zero side-effects', async () => {
    let workspaceBId = null;
    let userBId = null;
    let issueBId = null;

    try {
      // Create an isolated Workspace B
      const wsBRes = await pool.query(
        "INSERT INTO workspaces (name, timezone, status) VALUES ('Workspace B QA Isolation', 'Asia/Ho_Chi_Minh', 'active') RETURNING id",
      );
      workspaceBId = wsBRes.rows[0].id;

      // Create an isolated user for Workspace B reporter to satisfy FK
      const userBRes = await pool.query(
        "INSERT INTO users (username_normalized, email_normalized, status) VALUES ($1, $2, 'active') RETURNING id",
        [`user_b_${Date.now()}`, `user_b_${Date.now()}@example.com`],
      );
      userBId = userBRes.rows[0].id;

      // Create membership in Workspace B
      await pool.query(
        "INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, 'staff', 'active')",
        [workspaceBId, userBId],
      );

      // Create real issue in Workspace B
      const issueBRes = await pool.query(
        `INSERT INTO issues (
          workspace_id, reporter_user_id, type, title, description, route_template, status, version
        ) VALUES ($1, $2, 'bug', 'Workspace B secret issue', 'Private details', '/settings', 'open', 1)
        RETURNING id, version, status`,
        [workspaceBId, userBId],
      );
      issueBId = issueBRes.rows[0].id;

      // 1. GET issue B by Owner A -> 404 NOT_FOUND
      const getBRes = await apiRequest(`/api/v1/issues/${issueBId}`, 'GET', null, ownerCookie);
      assert.equal(getBRes.status, 404);
      assert.equal(getBRes.json?.error?.code, 'NOT_FOUND');

      // 2. PATCH issue B by Owner A -> 404 NOT_FOUND
      const patchBRes = await apiRequest(
        `/api/v1/issues/${issueBId}`,
        'PATCH',
        { title: 'Attempted cross-workspace hijack' },
        ownerCookie,
        ownerCsrf,
        { 'if-match': '"1"', 'idempotency-key': `cross-patch-${Date.now()}` },
      );
      assert.equal(patchBRes.status, 404);
      assert.equal(patchBRes.json?.error?.code, 'NOT_FOUND');

      // 3. POST confirm-fix on issue B by Owner A -> 404 NOT_FOUND
      const confirmBRes = await apiRequest(
        `/api/v1/issues/${issueBId}/confirm-fix`,
        'POST',
        { comment: 'Attempted close' },
        ownerCookie,
        ownerCsrf,
        { 'if-match': '"1"', 'idempotency-key': `cross-confirm-${Date.now()}` },
      );
      assert.equal(confirmBRes.status, 404);
      assert.equal(confirmBRes.json?.error?.code, 'NOT_FOUND');

      // Set issue B to closed in DB to prepare for reopen test
      await pool.query("UPDATE issues SET status = 'closed', version = 2 WHERE id = $1", [issueBId]);

      // 4. POST reopen on issue B by Owner A -> 404 NOT_FOUND
      const reopenBRes = await apiRequest(
        `/api/v1/issues/${issueBId}/reopen`,
        'POST',
        { reason: 'Attempted cross-workspace reopen' },
        ownerCookie,
        ownerCsrf,
        { 'if-match': '"2"', 'idempotency-key': `cross-reopen-${Date.now()}` },
      );
      assert.equal(reopenBRes.status, 404);
      assert.equal(reopenBRes.json?.error?.code, 'NOT_FOUND');

      // Verify issue B status & version in DB remained untouched by Owner A's attempts
      const finalBRes = await pool.query('SELECT status, version FROM issues WHERE id = $1', [issueBId]);
      assert.equal(finalBRes.rows[0].status, 'closed');
      assert.equal(finalBRes.rows[0].version, 2);

      // Verify zero activity written for issue B
      const actCountB = await pool.query('SELECT count(*)::int as c FROM issue_activity WHERE issue_id = $1', [issueBId]);
      assert.equal(actCountB.rows[0].c, 0, 'Zero activity records created on cross-workspace attempts');

      // Verify zero audit events written for issue B
      const auditCountB = await pool.query('SELECT count(*)::int as c FROM audit_events WHERE entity_id = $1', [issueBId]);
      assert.equal(auditCountB.rows[0].c, 0, 'Zero audit events created on cross-workspace attempts');
    } finally {
      // Clean up isolated test fixtures safely
      if (issueBId) await pool.query('DELETE FROM issues WHERE id = $1', [issueBId]);
      if (workspaceBId) await pool.query('DELETE FROM workspace_memberships WHERE workspace_id = $1', [workspaceBId]);
      if (workspaceBId) await pool.query('DELETE FROM workspaces WHERE id = $1', [workspaceBId]);
      if (userBId) await pool.query('DELETE FROM users WHERE id = $1', [userBId]);
    }
  });

  // 22. QA-02 Group B: Concurrent transitions (awaiting_owner -> fixing)
  await t.test('22. QA-02 Group B: Concurrent status transitions with same If-Match version', async () => {
    // 1. Create a dedicated issue and advance to awaiting_owner
    const createRes = await apiRequest(
      '/api/v1/issues',
      'POST',
      {
        type: 'bug',
        title: `Concurrent transition issue ${Date.now()}`,
        description: 'Testing race conditions on status transition',
        route_template: '/employees',
      },
      ownerCookie,
      ownerCsrf,
      { 'idempotency-key': `conc-trans-create-${Date.now()}` },
    );
    assert.equal(createRes.status, 201);
    const concIssueId = createRes.json.data.id;
    let concVersion = createRes.json.data.version; // 1

    // open -> analyzing (version 2)
    const toAnalyzing = await apiRequest(
      `/api/v1/issues/${concIssueId}`,
      'PATCH',
      { status: 'analyzing' },
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${concVersion}"`, 'idempotency-key': `conc-trans-ana-${Date.now()}` },
    );
    assert.equal(toAnalyzing.status, 200);
    concVersion = toAnalyzing.json.data.version; // 2

    // analyzing -> fixing (version 3)
    const toFixing = await apiRequest(
      `/api/v1/issues/${concIssueId}`,
      'PATCH',
      { status: 'fixing' },
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${concVersion}"`, 'idempotency-key': `conc-trans-fix-${Date.now()}` },
    );
    assert.equal(toFixing.status, 200);
    concVersion = toFixing.json.data.version; // 3

    // fixing -> awaiting_owner (version 4)
    const toAwaiting = await apiRequest(
      `/api/v1/issues/${concIssueId}`,
      'PATCH',
      { status: 'awaiting_owner' },
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${concVersion}"`, 'idempotency-key': `conc-trans-await-${Date.now()}` },
    );
    assert.equal(toAwaiting.status, 200);
    concVersion = toAwaiting.json.data.version; // 4
    assert.equal(toAwaiting.json.data.status, 'awaiting_owner');

    const actCountBefore = await pool.query('SELECT count(*)::int as c FROM issue_activity WHERE issue_id = $1', [concIssueId]);
    const auditCountBefore = await pool.query("SELECT count(*)::int as c FROM audit_events WHERE entity_id = $1 AND action = 'issue.status_changed'", [concIssueId]);

    // 2. Fire two concurrent requests with distinct idempotency keys but identical If-Match
    const [p1, p2] = await Promise.all([
      apiRequest(
        `/api/v1/issues/${concIssueId}`,
        'PATCH',
        { status: 'fixing', reason: 'Winner reason A: verification failed on iOS.' },
        ownerCookie,
        ownerCsrf,
        { 'if-match': `"${concVersion}"`, 'idempotency-key': `race-patch-A-${Date.now()}` },
      ),
      apiRequest(
        `/api/v1/issues/${concIssueId}`,
        'PATCH',
        { status: 'fixing', reason: 'Winner reason B: verification failed on Android.' },
        ownerCookie,
        ownerCsrf,
        { 'if-match': `"${concVersion}"`, 'idempotency-key': `race-patch-B-${Date.now()}` },
      ),
    ]);

    // Exactly one must succeed (200) and the other must fail with PRECONDITION_FAILED (412)
    const winner = p1.status === 200 ? p1 : p2;
    const loser = p1.status === 200 ? p2 : p1;

    assert.equal(winner.status, 200, 'Winning concurrent transition returns 200');
    assert.equal(winner.json.data.status, 'fixing');
    assert.equal(winner.json.data.version, concVersion + 1, 'Version increments exactly once');

    assert.equal(loser.status, 412, 'Losing concurrent transition returns 412 PRECONDITION_FAILED');
    assert.equal(loser.json?.error?.code, 'PRECONDITION_FAILED');

    // 3. Verify database state
    const issueFinal = await pool.query('SELECT status, version FROM issues WHERE id = $1', [concIssueId]);
    assert.equal(issueFinal.rows[0].status, 'fixing');
    assert.equal(issueFinal.rows[0].version, concVersion + 1);

    const actCountAfter = await pool.query('SELECT count(*)::int as c FROM issue_activity WHERE issue_id = $1', [concIssueId]);
    assert.equal(actCountAfter.rows[0].c, actCountBefore.rows[0].c + 1, 'Exactly one new activity record created');

    const auditCountAfter = await pool.query("SELECT count(*)::int as c FROM audit_events WHERE entity_id = $1 AND action = 'issue.status_changed'", [concIssueId]);
    assert.equal(auditCountAfter.rows[0].c, auditCountBefore.rows[0].c + 1, 'Exactly one new audit event created');
  });

  // 23. QA-02 Group C: Replay integrity across all four mutations
  await t.test('23. QA-02 Group C: Full response replay integrity and zero duplicate writes for all 4 mutations', async () => {
    // --- Mutation A: POST /api/v1/issues ---
    const createKey = `replay-create-${Date.now()}`;
    const createPayload = {
      type: 'improvement',
      title: `Replay integrity test issue ${Date.now()}`,
      description: 'Testing byte-for-byte replay equality',
      route_template: '/schedules',
    };

    const origCreate = await apiRequest(
      '/api/v1/issues',
      'POST',
      createPayload,
      ownerCookie,
      ownerCsrf,
      { 'idempotency-key': createKey },
    );
    assert.equal(origCreate.status, 201);
    const replayIssueId = origCreate.json.data.id;
    let replayIssueVersion = origCreate.json.data.version;

    // Check DB counts before replay
    const actAfterCreate = await pool.query('SELECT count(*)::int as c FROM issue_activity WHERE issue_id = $1', [replayIssueId]);
    const auditAfterCreate = await pool.query('SELECT count(*)::int as c FROM audit_events WHERE entity_id = $1', [replayIssueId]);

    // Replay POST /api/v1/issues
    const replayCreate = await apiRequest(
      '/api/v1/issues',
      'POST',
      createPayload,
      ownerCookie,
      ownerCsrf,
      { 'idempotency-key': createKey },
    );
    assert.equal(replayCreate.status, 201, 'Replay preserves 201 Created');
    assert.equal(replayCreate.etag, origCreate.etag, 'Replay preserves ETag');
    assert.deepStrictEqual(replayCreate.json.data, origCreate.json.data, 'Replay preserves exact body');

    const actAfterReplayCreate = await pool.query('SELECT count(*)::int as c FROM issue_activity WHERE issue_id = $1', [replayIssueId]);
    const auditAfterReplayCreate = await pool.query('SELECT count(*)::int as c FROM audit_events WHERE entity_id = $1', [replayIssueId]);
    assert.equal(actAfterReplayCreate.rows[0].c, actAfterCreate.rows[0].c, 'No duplicate activity on create replay');
    assert.equal(auditAfterReplayCreate.rows[0].c, auditAfterCreate.rows[0].c, 'No duplicate audit on create replay');

    // --- Mutation B: PATCH /api/v1/issues/:id ---
    const patchKey = `replay-patch-${Date.now()}`;
    const patchPayload = { title: 'Updated title for replay test' };

    const origPatch = await apiRequest(
      `/api/v1/issues/${replayIssueId}`,
      'PATCH',
      patchPayload,
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${replayIssueVersion}"`, 'idempotency-key': patchKey },
    );
    assert.equal(origPatch.status, 200);
    replayIssueVersion = origPatch.json.data.version;

    const actAfterPatch = await pool.query('SELECT count(*)::int as c FROM issue_activity WHERE issue_id = $1', [replayIssueId]);
    const auditAfterPatch = await pool.query('SELECT count(*)::int as c FROM audit_events WHERE entity_id = $1', [replayIssueId]);

    // Replay PATCH
    const replayPatch = await apiRequest(
      `/api/v1/issues/${replayIssueId}`,
      'PATCH',
      patchPayload,
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${replayIssueVersion - 1}"`, 'idempotency-key': patchKey },
    );
    assert.equal(replayPatch.status, 200, 'Replay preserves 200 OK');
    assert.equal(replayPatch.etag, origPatch.etag, 'Replay preserves ETag');
    assert.deepStrictEqual(replayPatch.json.data, origPatch.json.data, 'Replay preserves exact body');

    const actAfterReplayPatch = await pool.query('SELECT count(*)::int as c FROM issue_activity WHERE issue_id = $1', [replayIssueId]);
    const auditAfterReplayPatch = await pool.query('SELECT count(*)::int as c FROM audit_events WHERE entity_id = $1', [replayIssueId]);
    assert.equal(actAfterReplayPatch.rows[0].c, actAfterPatch.rows[0].c, 'No duplicate activity on patch replay');
    assert.equal(auditAfterReplayPatch.rows[0].c, auditAfterPatch.rows[0].c, 'No duplicate audit on patch replay');

    // --- Mutation C: POST /api/v1/issues/:id/confirm-fix ---
    const confirmKey = `replay-confirm-${Date.now()}`;
    const confirmPayload = { comment: 'Confirmed for replay test' };

    const origConfirm = await apiRequest(
      `/api/v1/issues/${replayIssueId}/confirm-fix`,
      'POST',
      confirmPayload,
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${replayIssueVersion}"`, 'idempotency-key': confirmKey },
    );
    assert.equal(origConfirm.status, 200);
    replayIssueVersion = origConfirm.json.data.version;

    const actAfterConfirm = await pool.query('SELECT count(*)::int as c FROM issue_activity WHERE issue_id = $1', [replayIssueId]);
    const auditAfterConfirm = await pool.query('SELECT count(*)::int as c FROM audit_events WHERE entity_id = $1', [replayIssueId]);

    // Replay confirm-fix
    const replayConfirm = await apiRequest(
      `/api/v1/issues/${replayIssueId}/confirm-fix`,
      'POST',
      confirmPayload,
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${replayIssueVersion - 1}"`, 'idempotency-key': confirmKey },
    );
    assert.equal(replayConfirm.status, 200, 'Replay preserves 200 OK');
    assert.equal(replayConfirm.etag, origConfirm.etag, 'Replay preserves ETag');
    assert.deepStrictEqual(replayConfirm.json.data, origConfirm.json.data, 'Replay preserves exact body');

    const actAfterReplayConfirm = await pool.query('SELECT count(*)::int as c FROM issue_activity WHERE issue_id = $1', [replayIssueId]);
    const auditAfterReplayConfirm = await pool.query('SELECT count(*)::int as c FROM audit_events WHERE entity_id = $1', [replayIssueId]);
    assert.equal(actAfterReplayConfirm.rows[0].c, actAfterConfirm.rows[0].c, 'No duplicate activity on confirm-fix replay');
    assert.equal(auditAfterReplayConfirm.rows[0].c, auditAfterConfirm.rows[0].c, 'No duplicate audit on confirm-fix replay');

    // --- Mutation D: POST /api/v1/issues/:id/reopen ---
    const reopenKey = `replay-reopen-${Date.now()}`;
    const reopenPayload = { reason: 'Reopened for replay test' };

    const origReopen = await apiRequest(
      `/api/v1/issues/${replayIssueId}/reopen`,
      'POST',
      reopenPayload,
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${replayIssueVersion}"`, 'idempotency-key': reopenKey },
    );
    assert.equal(origReopen.status, 200);
    replayIssueVersion = origReopen.json.data.version;

    const actAfterReopen = await pool.query('SELECT count(*)::int as c FROM issue_activity WHERE issue_id = $1', [replayIssueId]);
    const auditAfterReopen = await pool.query('SELECT count(*)::int as c FROM audit_events WHERE entity_id = $1', [replayIssueId]);

    // Replay reopen
    const replayReopen = await apiRequest(
      `/api/v1/issues/${replayIssueId}/reopen`,
      'POST',
      reopenPayload,
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${replayIssueVersion - 1}"`, 'idempotency-key': reopenKey },
    );
    assert.equal(replayReopen.status, 200, 'Replay preserves 200 OK');
    assert.equal(replayReopen.etag, origReopen.etag, 'Replay preserves ETag');
    assert.deepStrictEqual(replayReopen.json.data, origReopen.json.data, 'Replay preserves exact body');

    const actAfterReplayReopen = await pool.query('SELECT count(*)::int as c FROM issue_activity WHERE issue_id = $1', [replayIssueId]);
    const auditAfterReplayReopen = await pool.query('SELECT count(*)::int as c FROM audit_events WHERE entity_id = $1', [replayIssueId]);
    assert.equal(actAfterReplayReopen.rows[0].c, actAfterReopen.rows[0].c, 'No duplicate activity on reopen replay');
    assert.equal(auditAfterReplayReopen.rows[0].c, auditAfterReopen.rows[0].c, 'No duplicate audit on reopen replay');

    // Final verification: issue version is strictly unchanged
    const finalRow = await pool.query('SELECT version FROM issues WHERE id = $1', [replayIssueId]);
    assert.equal(finalRow.rows[0].version, replayIssueVersion, 'Version strictly unchanged after all replays');
  });

  // 24. QA-02 Group D: Reopen audit privacy
  await t.test('24. QA-02 Group D: Reopen audit privacy: reason retained in activity, completely omitted from audit', async () => {
    // 1. Create issue and close it
    const createRes = await apiRequest(
      '/api/v1/issues',
      'POST',
      {
        type: 'bug',
        title: `Privacy test issue ${Date.now()}`,
        description: 'Testing audit redaction on reopen',
        route_template: '/accounts',
      },
      ownerCookie,
      ownerCsrf,
      { 'idempotency-key': `priv-create-${Date.now()}` },
    );
    assert.equal(createRes.status, 201);
    const privIssueId = createRes.json.data.id;
    let privVersion = createRes.json.data.version;

    // Confirm-fix to close it
    const closeRes = await apiRequest(
      `/api/v1/issues/${privIssueId}/confirm-fix`,
      'POST',
      { comment: 'Close before reopen privacy test' },
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${privVersion}"`, 'idempotency-key': `priv-close-${Date.now()}` },
    );
    assert.equal(closeRes.status, 200);
    assert.equal(closeRes.json.data.status, 'closed');
    privVersion = closeRes.json.data.version;

    // 2. Reopen with a distinctive reason containing secret-like string
    const distinctiveReason = `SENSITIVE_REOPEN_REASON_${Date.now()}_SECRET_TOKEN_XYZ`;
    const reopenRes = await apiRequest(
      `/api/v1/issues/${privIssueId}/reopen`,
      'POST',
      { reason: distinctiveReason },
      ownerCookie,
      ownerCsrf,
      { 'if-match': `"${privVersion}"`, 'idempotency-key': `priv-reopen-${Date.now()}` },
    );
    assert.equal(reopenRes.status, 200);
    assert.equal(reopenRes.json.data.status, 'open');
    assert.equal(reopenRes.json.data.version, privVersion + 1, 'Version increments exactly once on reopen');

    // 3. Verify issue_activity retains the validated reason
    const actRow = await pool.query(
      "SELECT * FROM issue_activity WHERE issue_id = $1 AND action = 'reopened' ORDER BY created_at DESC LIMIT 1",
      [privIssueId],
    );
    assert.equal(actRow.rows.length, 1, 'Must have reopened activity');
    assert.equal(actRow.rows[0].metadata_sanitized?.reason, distinctiveReason, 'Activity must retain reason');
    assert.equal(actRow.rows[0].metadata_sanitized?.previous_status, 'closed');
    assert.equal(actRow.rows[0].metadata_sanitized?.to_status, 'open');

    // 4. Verify audit_events contains permitted metadata ONLY, NO raw reason
    const auditRow = await pool.query(
      "SELECT * FROM audit_events WHERE entity_id = $1 AND action = 'issue.reopened' ORDER BY created_at DESC LIMIT 1",
      [privIssueId],
    );
    assert.equal(auditRow.rows.length, 1, 'Must have issue.reopened audit event');
    const auditMeta = auditRow.rows[0].metadata_sanitized;
    assert.equal(auditMeta.previous_status, 'closed');
    assert.equal(auditMeta.new_status, 'open');
    assert.equal(auditMeta.previous_version, privVersion);
    assert.equal(auditMeta.new_version, privVersion + 1);
    assert.equal(auditMeta.reason, undefined, 'audit_events.metadata_sanitized MUST NOT contain reason property');

    // 5. Ensure the sensitive string appears nowhere in audit_events table for this entity or workspace
    const auditTextSearch = await pool.query(
      "SELECT count(*)::int as c FROM audit_events WHERE entity_id = $1 AND metadata_sanitized::text LIKE $2",
      [privIssueId, `%${distinctiveReason}%`],
    );
    assert.equal(auditTextSearch.rows[0].c, 0, 'Sensitive reason string must not appear anywhere in audit_events');
  });
});
