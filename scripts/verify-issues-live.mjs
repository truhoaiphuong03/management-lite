import pg from 'pg';
import assert from 'node:assert/strict';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const API = 'http://127.0.0.1:3002';
const WEB = 'http://127.0.0.1:3001';

async function run() {
  console.log('=== STARTING DEEP LIVE VERIFICATION OF ISSUES-001 TO ISSUES-009 ===');
  
  // 1. Authenticate Owner
  const ownerLoginRes = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': WEB },
    body: JSON.stringify({ identifier: 'qa_owner', password: 'QAOwnerPassword123!' })
  });
  assert.equal(ownerLoginRes.status, 200, 'Owner login failed');
  const ownerCookie = ownerLoginRes.headers.get('set-cookie').split(';')[0];
  const ownerData = (await ownerLoginRes.json()).data;
  const ownerCsrf = ownerData.csrf_token;
  const ownerId = ownerData.user.id;
  const workspaceId = ownerData.active_workspace.id;
  console.log('Authenticated Owner:', ownerId, 'Workspace:', workspaceId);

  // 2. Authenticate Staff
  const staffLoginRes = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': WEB },
    body: JSON.stringify({ identifier: 'qa_staff', password: 'QAStaffPassword123!' })
  });
  assert.equal(staffLoginRes.status, 200, 'Staff login failed');
  const staffCookie = staffLoginRes.headers.get('set-cookie').split(';')[0];
  const staffData = (await staffLoginRes.json()).data;
  const staffCsrf = staffData.csrf_token;
  const staffId = staffData.user.id;
  console.log('Authenticated Staff:', staffId);

  // Helper request
  async function api(path, method = 'GET', body = null, cookie = ownerCookie, csrf = ownerCsrf, extraHeaders = {}) {
    const headers = { 'Origin': WEB, ...extraHeaders };
    if (cookie) headers['Cookie'] = cookie;
    if (csrf) headers['X-CSRF-Token'] = csrf;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, headers: res.headers, json, text };
  }

  // =========================================================================
  // --- TEST ISSUES-001: Xem sổ tay quản lý vấn đề & lỗi hệ thống ---
  // =========================================================================
  console.log('\n--- TESTING ISSUES-001: Xem sổ tay quản lý vấn đề & lỗi hệ thống ---');
  const listRes = await api('/api/v1/issues?limit=20');
  assert.equal(listRes.status, 200, 'GET /api/v1/issues must return 200: ' + listRes.text);
  assert.equal(listRes.json.success, true);
  assert.ok(Array.isArray(listRes.json.data.items), 'Must return items array');
  assert.ok(listRes.json.data.counts, 'Must return counts object');
  console.log('ISSUES-001 PASS: Returned', listRes.json.data.items.length, 'issues, counts:', listRes.json.data.counts);

  // =========================================================================
  // --- TEST ISSUES-003: Tạo vấn đề lỗi mới kèm Idempotency-Key ---
  // =========================================================================
  console.log('\n--- TESTING ISSUES-003: Tạo vấn đề lỗi mới kèm Idempotency-Key ---');
  const idemKey = 'test-issue-' + Date.now();
  const createPayload = {
    type: 'bug',
    title: 'Lỗi kiểm thử tự động trên localhost - ISSUES-003',
    description: 'Chi tiết mô tả lỗi kiểm thử tự động đảm bảo tính năng hoạt động thực tế trên database QA.',
    route_template: '/issues'
  };
  const createRes = await api('/api/v1/issues', 'POST', createPayload, ownerCookie, ownerCsrf, {
    'Idempotency-Key': idemKey
  });
  assert.equal(createRes.status, 201, 'POST /api/v1/issues must return 201: ' + createRes.text);
  assert.equal(createRes.json.success, true);
  const createdIssue = createRes.json.data;
  assert.ok(createdIssue.id, 'Must have issue id');
  assert.equal(createdIssue.version, 1);
  assert.equal(createdIssue.status, 'open');
  console.log('Created issue id:', createdIssue.id, 'version:', createdIssue.version);

  // Verify in PostgreSQL database directly!
  const dbIssue = await pool.query('SELECT * FROM issues WHERE id = $1', [createdIssue.id]);
  assert.equal(dbIssue.rows.length, 1, 'Issue must exist in PostgreSQL');
  assert.equal(dbIssue.rows[0].title, createPayload.title);
  assert.equal(dbIssue.rows[0].description, createPayload.description);
  assert.equal(dbIssue.rows[0].workspace_id, workspaceId);
  console.log('PostgreSQL verification PASS: issue found in DB with correct workspace_id and version');

  // Verify Idempotency replay on duplicate key
  const replayRes = await api('/api/v1/issues', 'POST', createPayload, ownerCookie, ownerCsrf, {
    'Idempotency-Key': idemKey
  });
  assert.equal(replayRes.status, 201, 'Idempotency replay must succeed');
  assert.equal(replayRes.json.data.id, createdIssue.id, 'Idempotency replay must return same id');
  console.log('ISSUES-003 PASS: Creation, DB persistence and Idempotency replay verified!');

  // Verify validation: missing title, invalid type, etc.
  const invalidTypeRes = await api('/api/v1/issues', 'POST', { type: 'invalid_type', title: 'Test', description: 'Test', route_template: '/' }, ownerCookie, ownerCsrf, { 'Idempotency-Key': idemKey + '-inv' });
  assert.equal(invalidTypeRes.status, 400, 'Invalid type must return 400');
  console.log('ISSUES-003 Validation PASS: Invalid type rejected with 400');

  // Also create an improvement issue
  const createImpRes = await api('/api/v1/issues', 'POST', {
    type: 'improvement',
    title: 'Cải tiến giao diện màn hình Báo lỗi - ISSUES-003',
    description: 'Thêm bộ lọc nhanh và tối ưu hóa thời gian tải trang.',
    route_template: '/issues'
  }, ownerCookie, ownerCsrf, { 'Idempotency-Key': idemKey + '-imp' });
  assert.equal(createImpRes.status, 201);
  assert.equal(createImpRes.json.data.type, 'improvement');
  console.log('Created improvement issue id:', createImpRes.json.data.id);

  // =========================================================================
  // --- TEST ISSUES-002: Lọc lỗi theo loại & trạng thái ---
  // =========================================================================
  console.log('\n--- TESTING ISSUES-002: Lọc lỗi theo loại & trạng thái ---');
  const filterBugRes = await api('/api/v1/issues?type=bug');
  assert.equal(filterBugRes.status, 200);
  assert.ok(filterBugRes.json.data.items.every(i => i.type === 'bug'), 'All filtered issues must be bugs');
  const filterImpRes = await api('/api/v1/issues?type=improvement');
  assert.equal(filterImpRes.status, 200);
  assert.ok(filterImpRes.json.data.items.every(i => i.type === 'improvement'), 'All filtered issues must be improvements');
  const filterOpenRes = await api('/api/v1/issues?status=open');
  assert.equal(filterOpenRes.status, 200);
  assert.ok(filterOpenRes.json.data.items.every(i => i.status === 'open'), 'All filtered issues must be open');
  console.log('ISSUES-002 PASS: Filtering by type=bug, type=improvement and status=open verified!');

  // =========================================================================
  // --- TEST ISSUES-004: Xem chi tiết vấn đề và dòng thời gian xử lý ---
  // =========================================================================
  console.log('\n--- TESTING ISSUES-004: Xem chi tiết vấn đề và dòng thời gian xử lý ---');
  const detailRes = await api(`/api/v1/issues/${createdIssue.id}`);
  assert.equal(detailRes.status, 200, 'GET detail must return 200');
  assert.equal(detailRes.json.data.issue.id, createdIssue.id);
  assert.ok(Array.isArray(detailRes.json.data.activities), 'Must have activities array');
  assert.ok(detailRes.json.data.activities.length >= 1, 'Must have at least created activity');
  assert.equal(detailRes.json.data.activities[0].action, 'created');
  console.log('ISSUES-004 PASS: Detail and activity timeline verified! Activities count:', detailRes.json.data.activities.length);

  // =========================================================================
  // --- TEST ISSUES-005: Chuyển trạng thái có kiểm soát phiên bản If-Match ---
  // =========================================================================
  console.log('\n--- TESTING ISSUES-005: Chuyển trạng thái có kiểm soát phiên bản If-Match ---');
  // First test conflict: If-Match with wrong version
  const conflictRes = await api(`/api/v1/issues/${createdIssue.id}`, 'PATCH', { status: 'analyzing' }, ownerCookie, ownerCsrf, {
    'If-Match': '"999"',
    'Idempotency-Key': 'patch-conflict-' + Date.now()
  });
  assert.equal(conflictRes.status, 412, 'If-Match mismatch must return 412 Precondition Failed');
  console.log('If-Match conflict guard PASS: Returned 412 Precondition Failed on version mismatch');

  // Now valid update with matching version
  const patchRes = await api(`/api/v1/issues/${createdIssue.id}`, 'PATCH', { status: 'analyzing' }, ownerCookie, ownerCsrf, {
    'If-Match': `"${createdIssue.version}"`,
    'Idempotency-Key': 'patch-valid-' + Date.now()
  });
  assert.equal(patchRes.status, 200, 'Valid status transition must return 200: ' + patchRes.text);
  assert.equal(patchRes.json.data.status, 'analyzing');
  assert.equal(patchRes.json.data.version, createdIssue.version + 1);
  const updatedVersion = patchRes.json.data.version;
  console.log('Status updated to analyzing, new version:', updatedVersion);

  // Transition analyzing -> fixing -> awaiting_owner
  const patch2 = await api(`/api/v1/issues/${createdIssue.id}`, 'PATCH', { status: 'fixing' }, ownerCookie, ownerCsrf, {
    'If-Match': `"${updatedVersion}"`,
    'Idempotency-Key': 'patch-fixing-' + Date.now()
  });
  assert.equal(patch2.status, 200);
  assert.equal(patch2.json.data.status, 'fixing');

  const patch3 = await api(`/api/v1/issues/${createdIssue.id}`, 'PATCH', { status: 'awaiting_owner' }, ownerCookie, ownerCsrf, {
    'If-Match': `"${patch2.json.data.version}"`,
    'Idempotency-Key': 'patch-awaiting-' + Date.now()
  });
  assert.equal(patch3.status, 200);
  assert.equal(patch3.json.data.status, 'awaiting_owner');
  const awaitingVersion = patch3.json.data.version;
  console.log('ISSUES-005 PASS: Sequential status transitions with If-Match concurrency control verified!');

  // =========================================================================
  // --- TEST ISSUES-006: Chủ sở hữu xác nhận đã xử lý xong và đóng lỗi ---
  // =========================================================================
  console.log('\n--- TESTING ISSUES-006: Chủ sở hữu xác nhận đã xử lý xong và đóng lỗi ---');
  const confirmFixRes = await api(`/api/v1/issues/${createdIssue.id}/confirm-fix`, 'POST', {
    comment: 'Đã kiểm tra và xác nhận sửa lỗi thành công trên localhost QA.'
  }, ownerCookie, ownerCsrf, {
    'If-Match': `"${awaitingVersion}"`,
    'Idempotency-Key': 'confirm-fix-' + Date.now()
  });
  assert.equal(confirmFixRes.status, 200, 'confirm-fix must return 200: ' + confirmFixRes.text);
  assert.equal(confirmFixRes.json.data.status, 'closed');
  assert.ok(confirmFixRes.json.data.closed_at, 'closed_at must be populated');
  const closedVersion = confirmFixRes.json.data.version;
  console.log('Closed issue version:', closedVersion, 'closed_at:', confirmFixRes.json.data.closed_at);

  // Check DB for closed status
  const dbClosed = await pool.query('SELECT status, closed_at, version FROM issues WHERE id = $1', [createdIssue.id]);
  assert.equal(dbClosed.rows[0].status, 'closed');
  assert.ok(dbClosed.rows[0].closed_at);
  console.log('ISSUES-006 PASS: Issue closed and verified in PostgreSQL!');

  // =========================================================================
  // --- TEST ISSUES-007: Mở lại lỗi đã đóng kèm lý do cụ thể ---
  // =========================================================================
  console.log('\n--- TESTING ISSUES-007: Mở lại lỗi đã đóng kèm lý do cụ thể ---');
  // Attempt reopen without reason -> must fail with 400
  const noReasonRes = await api(`/api/v1/issues/${createdIssue.id}/reopen`, 'POST', {
    comment: 'Missing reason'
  }, ownerCookie, ownerCsrf, {
    'If-Match': `"${closedVersion}"`,
    'Idempotency-Key': 'reopen-fail-' + Date.now()
  });
  assert.equal(noReasonRes.status, 400, 'Reopen without reason must return 400');
  console.log('Reopen validation PASS: Missing reason rejected with 400');

  // Valid reopen
  const reopenRes = await api(`/api/v1/issues/${createdIssue.id}/reopen`, 'POST', {
    reason: 'Phát hiện lỗi hồi quy khi kiểm thử tải lại trang.',
    comment: 'Cần đội kỹ thuật kiểm tra lại luồng xử lý.'
  }, ownerCookie, ownerCsrf, {
    'If-Match': `"${closedVersion}"`,
    'Idempotency-Key': 'reopen-valid-' + Date.now()
  });
  assert.equal(reopenRes.status, 200, 'Valid reopen must return 200: ' + reopenRes.text);
  assert.equal(reopenRes.json.data.status, 'open');
  assert.equal(reopenRes.json.data.closed_at, null);
  console.log('Reopened issue status:', reopenRes.json.data.status, 'closed_at reset to null');

  // Verify in PostgreSQL
  const dbReopened = await pool.query('SELECT status, closed_at FROM issues WHERE id = $1', [createdIssue.id]);
  assert.equal(dbReopened.rows[0].status, 'open');
  assert.equal(dbReopened.rows[0].closed_at, null);

  // Verify activity timeline has reopen event
  const actRes = await pool.query('SELECT action, metadata_sanitized FROM issue_activity WHERE issue_id = $1 ORDER BY created_at ASC', [createdIssue.id]);
  const actions = actRes.rows.map(r => r.action);
  console.log('All activities recorded in DB:', actions);
  assert.ok(actions.includes('created'));
  assert.ok(actions.includes('status_changed'));
  assert.ok(actions.includes('fix_confirmed'));
  assert.ok(actions.includes('reopened'));
  console.log('ISSUES-007 PASS: Reopen verified with reason and full immutable activity log!');

  // =========================================================================
  // --- TEST ISSUES-008: Nhân viên gửi báo cáo lỗi nhanh từ giao diện ---
  // =========================================================================
  console.log('\n--- TESTING ISSUES-008: Nhân viên gửi báo cáo lỗi nhanh từ giao diện (/api/v1/reports) ---');
  const staffReportPayload = {
    title: 'Báo lỗi từ giao diện nhân viên QA (Staff Widget)',
    description: 'Nhân viên phát hiện nút bấm phản hồi chậm trên màn hình chấm công.',
    route_template: '/clock',
    module_name: 'Chấm công (Clock)'
  };
  const staffReportRes = await api('/api/v1/reports', 'POST', staffReportPayload, staffCookie, staffCsrf, {
    'Idempotency-Key': 'staff-rep-' + Date.now()
  });
  assert.equal(staffReportRes.status, 201, 'Staff POST /api/v1/reports must return 201: ' + staffReportRes.text);
  assert.equal(staffReportRes.json.success, true);
  const staffReportIssue = staffReportRes.json.data;
  assert.ok(staffReportIssue.id);
  console.log('Staff reported issue id:', staffReportIssue.id);

  // Verify in PostgreSQL: reporter_user_id must be staffId
  const dbStaffRep = await pool.query('SELECT reporter_user_id, title, route_template, status FROM issues WHERE id = $1', [staffReportIssue.id]);
  assert.equal(dbStaffRep.rows[0].reporter_user_id, staffId, 'Reporter must be staff user');
  assert.equal(dbStaffRep.rows[0].status, 'open');
  console.log('ISSUES-008 PASS: Staff successfully reported bug via widget API and saved to DB!');

  // =========================================================================
  // --- TEST ISSUES-009: Chặn Staff truy cập sổ tay lỗi trực tiếp ---
  // =========================================================================
  console.log('\n--- TESTING ISSUES-009: Chặn Staff truy cập sổ tay lỗi trực tiếp ---');
  const staffListRes = await api('/api/v1/issues', 'GET', null, staffCookie, staffCsrf);
  assert.equal(staffListRes.status, 403, 'Staff GET /api/v1/issues must return 403');
  assert.equal(staffListRes.json.error.code, 'FORBIDDEN');
  console.log('Staff GET /api/v1/issues blocked with 403:', staffListRes.json.error.message);

  const staffCreateRes = await api('/api/v1/issues', 'POST', createPayload, staffCookie, staffCsrf);
  assert.equal(staffCreateRes.status, 403, 'Staff POST /api/v1/issues must return 403');
  console.log('Staff POST /api/v1/issues blocked with 403');

  const staffDetailRes = await api(`/api/v1/issues/${createdIssue.id}`, 'GET', null, staffCookie, staffCsrf);
  assert.equal(staffDetailRes.status, 403, 'Staff GET /api/v1/issues/:id must return 403');
  console.log('Staff GET /api/v1/issues/:id blocked with 403');

  const staffPatchRes = await api(`/api/v1/issues/${createdIssue.id}`, 'PATCH', { status: 'fixing' }, staffCookie, staffCsrf);
  assert.equal(staffPatchRes.status, 403, 'Staff PATCH /api/v1/issues/:id must return 403');
  console.log('Staff PATCH /api/v1/issues/:id blocked with 403');

  const staffConfirmRes = await api(`/api/v1/issues/${createdIssue.id}/confirm-fix`, 'POST', {}, staffCookie, staffCsrf);
  assert.equal(staffConfirmRes.status, 403, 'Staff POST /confirm-fix must return 403');
  console.log('Staff confirm-fix blocked with 403');

  const staffReopenRes = await api(`/api/v1/issues/${createdIssue.id}/reopen`, 'POST', { reason: 'test' }, staffCookie, staffCsrf);
  assert.equal(staffReopenRes.status, 403, 'Staff POST /reopen must return 403');
  console.log('Staff reopen blocked with 403');

  console.log('ISSUES-009 PASS: All /api/v1/issues endpoints strictly block Staff with 403 Forbidden fail-closed!');

  // =========================================================================
  // --- VERIFY DATA PERSISTENCE ACROSS PAGE RELOAD / NEW QUERIES ---
  // =========================================================================
  console.log('\n--- VERIFYING PERSISTENCE: Tải lại dữ liệu sau chuỗi thao tác ---');
  const reloadListRes = await api('/api/v1/issues?limit=20');
  assert.equal(reloadListRes.status, 200);
  const reloadedItems = reloadListRes.json.data.items;
  const foundCreated = reloadedItems.find(i => i.id === createdIssue.id);
  const foundStaffRep = reloadedItems.find(i => i.id === staffReportIssue.id);
  assert.ok(foundCreated, 'Previously modified issue must persist on list reload');
  assert.ok(foundStaffRep, 'Staff reported issue must persist on list reload');
  assert.equal(foundCreated.status, 'open', 'Reopened status must persist');
  assert.equal(foundCreated.version, 6, 'Version must be 6 after create -> analyzing -> fixing -> awaiting_owner -> closed -> reopen');
  console.log('PERSISTENCE PASS: Both issues and their updated versions persisted in database!');

  console.log('\n=========================================================================');
  console.log('>>> ALL 9/9 ISSUES FUNCTIONS VERIFIED 100% OPERATIONAL ON LOCALHOST QA <<<');
  console.log('=========================================================================');
}

run().catch(err => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
}).finally(() => pool.end());
