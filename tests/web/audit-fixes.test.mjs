import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('MGL-AUDIT-FIX-01: FIX-A (AUDIT-005) - Test Safety Guard in issues-fix-03.test.mjs', () => {
  const testFile = resolve(root, 'tests/web/issues-fix-03.test.mjs');
  assert.ok(existsSync(testFile), 'issues-fix-03.test.mjs must exist');

  const content = readFileSync(testFile, 'utf-8');

  // Verify DB isolation checks
  assert.ok(content.includes('FAIL-CLOSED SAFETY GUARD (AUDIT-005'), 'Must include AUDIT-005 safety guard comment');
  assert.ok(content.includes('_qa|_test|qa_test'), 'Must check QA database suffix pattern');
  assert.ok(content.includes('Halting test without mutation'), 'Must fail-closed without mutation on non-QA environment');
  assert.ok(content.includes('prod'), 'Must explicitly reject production database names');
  assert.ok(content.includes('127.0.0.1'), 'Must enforce localhost / 127.0.0.1 API target');
  assert.ok(content.includes('staging') || content.includes('qa'), 'Must enforce QA staging workspace pattern');
});

test('MGL-AUDIT-FIX-01: FIX-B (AUDIT-002) - Report Retry & Idempotency Key Preservation in ReportBugWidget.tsx', () => {
  const widgetFile = resolve(root, 'apps/web/src/components/ReportBugWidget.tsx');
  assert.ok(existsSync(widgetFile), 'ReportBugWidget.tsx must exist');

  const content = readFileSync(widgetFile, 'utf-8');

  // Verify storage key and functions
  assert.ok(content.includes('mglite_pending_report_v1'), 'Must use dedicated session storage key');
  assert.ok(content.includes('loadPendingReport') || content.includes('readPendingReportFromStorage'), 'Must define storage read function');
  assert.ok(content.includes('savePendingReport') || content.includes('writePendingReportToStorage'), 'Must define storage write function');

  // Verify idempotency preservation
  assert.ok(content.includes('idempotencyKeyRef'), 'Must track idempotency key in ref');
  assert.ok(content.includes('isUnknownOutcome') || content.includes('isUnconfirmed'), 'Must track unknown/unconfirmed state');
  assert.ok(content.includes('handleDiscardAndNew'), 'Must provide discard & reset handler');

  // Verify retry button text
  assert.ok(content.includes('Gửi lại'), 'Must show retry button text');
});

test('MGL-AUDIT-FIX-01: FIX-C (AUDIT-003) - Dashboard Fake Data Elimination in DashboardScreen.tsx', () => {
  const dashFile = resolve(root, 'apps/web/src/screens/DashboardScreen.tsx');
  assert.ok(existsSync(dashFile), 'DashboardScreen.tsx must exist');

  const content = readFileSync(dashFile, 'utf-8');

  // Verify removal of hardcoded fake data
  const forbiddenMockData = [
    '03:42:15',
    '8 Nhân viên',
    '6 đang làm việc, 2 nghỉ phép',
    'Tháng 10/2026',
    'C04 kiểm tra: Không có net âm',
    '18 Ca hoàn thành',
    '144 giờ làm việc tích lũy',
  ];

  for (const fakeString of forbiddenMockData) {
    assert.equal(
      content.includes(fakeString),
      false,
      `DashboardScreen.tsx must NOT contain fake string: "${fakeString}"`,
    );
  }

  // Verify neutral fallback values
  assert.ok(content.includes('--'), 'Must use neutral placeholder "--"');
  assert.ok(content.includes('Chưa có dữ liệu'), 'Must state "Chưa có dữ liệu" for unpopulated metrics');
});

test('MGL-AUDIT-FIX-01: FIX-D (AUDIT-004) - Audit Filter Race Condition Guard in AuditScreen.tsx', () => {
  const auditFile = resolve(root, 'apps/web/src/screens/AuditScreen.tsx');
  assert.ok(existsSync(auditFile), 'AuditScreen.tsx must exist');

  const content = readFileSync(auditFile, 'utf-8');

  // Verify generation counter & AbortController refs
  assert.ok(content.includes('requestSeqRef'), 'Must use requestSeqRef generation counter');
  assert.ok(content.includes('abortControllerRef'), 'Must use abortControllerRef to cancel in-flight requests');

  // Verify abort call before starting request
  assert.ok(content.includes('abortControllerRef.current.abort()'), 'Must abort prior in-flight request');

  // Verify sequence comparison
  assert.ok(content.includes('seq !== requestSeqRef.current'), 'Must discard response if sequence is stale');
  assert.ok(content.includes('seq === requestSeqRef.current'), 'Must guard loading and error state with sequence match');

  // Verify unmount abort cleanup
  assert.ok(content.includes('return () => {'), 'Must include cleanup hook');
});
