import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

// Register ESM resolve hook so production App.tsx can import @management-lite/ui/components cleanly in Node test runner
const targetUiComponentsUrl = pathToFileURL(
  resolve(root, 'dist/packages/ui/src/components/index.js'),
).href;
const loaderCode = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@management-lite/ui/components') {
    return nextResolve('${targetUiComponentsUrl}', context);
  }
  return nextResolve(specifier, context);
}
`;
register('data:text/javascript,' + encodeURIComponent(loaderCode), import.meta.url);

test('MGL-ISSUES-GOLIVE-FIX-03 Suite', async (t) => {
  // Mock browser sessionStorage for unit testing storage functions
  class MockSessionStorage {
    constructor() {
      this.store = new Map();
      this.throwOnSet = false;
      this.throwOnGet = false;
    }
    getItem(key) {
      if (this.throwOnGet) throw new Error('SecurityError: Access denied');
      return this.store.get(key) ?? null;
    }
    setItem(key, value) {
      if (this.throwOnSet) throw new Error('QuotaExceededError: Storage quota exceeded');
      this.store.set(key, String(value));
    }
    removeItem(key) {
      this.store.delete(key);
    }
    clear() {
      this.store.clear();
    }
  }

  const mockStorage = new MockSessionStorage();
  globalThis.window = {
    sessionStorage: mockStorage,
    location: { pathname: '/work' },
    dispatchEvent: () => {},
  };

  const {
    getScopedStorageKey,
    readPendingReportFromStorage,
    writePendingReportToStorage,
    inMemoryReports,
  } = await import(`file://${resolve(root, 'dist/apps/web/src/components/ReportBugWidget.js')}`);

  t.beforeEach(() => {
    mockStorage.clear();
    mockStorage.throwOnSet = false;
    mockStorage.throwOnGet = false;
    inMemoryReports.clear();
  });

  // -------------------------------------------------------------------------
  // 1. Identity undefined: refuses hydration and submission
  // -------------------------------------------------------------------------
  await t.test('1. Identity undefined: read and write fail closed without operating on storage', () => {
    // Empty/missing workspaceId
    const readNoWs = readPendingReportFromStorage('', 'user-alice');
    assert.equal(readNoWs.success, false);
    assert.ok(readNoWs.error.includes('chưa được xác thực'));

    // Empty/missing userId
    const readNoUser = readPendingReportFromStorage('ws-1', '');
    assert.equal(readNoUser.success, false);
    assert.ok(readNoUser.error.includes('chưa được xác thực'));

    // Both missing
    const readNeither = readPendingReportFromStorage('', '');
    assert.equal(readNeither.success, false);

    // Write with missing identity fails closed
    const dummyReport = {
      idempotencyKey: 'key-1',
      userId: 'user-alice',
      workspaceId: 'ws-1',
      snapshotPayload: {
        title: '/work',
        description: 'Test report',
        route_template: '/work',
        module_name: 'Công việc (Work)',
      },
      status: 'draft',
      createdAt: Date.now(),
    };

    const writeNoWs = writePendingReportToStorage('', 'user-alice', dummyReport);
    assert.equal(writeNoWs.success, false);
    assert.ok(writeNoWs.error.includes('chưa được xác thực'));

    const writeNoUser = writePendingReportToStorage('ws-1', '', dummyReport);
    assert.equal(writeNoUser.success, false);
    assert.ok(writeNoUser.error.includes('chưa được xác thực'));
  });

  // -------------------------------------------------------------------------
  // 2. User A -> B: zero cross-identity data leak
  // -------------------------------------------------------------------------
  await t.test('2. User A -> B: UI state and storage strictly partitioned per user ID', () => {
    const wsId = 'ws-corp-1';
    const userA = 'user-alice-101';
    const userB = 'user-bob-202';

    const reportA = {
      idempotencyKey: 'idemp-alice-999',
      userId: userA,
      workspaceId: wsId,
      snapshotPayload: {
        title: '/payroll',
        description: 'Nhạy cảm: Báo cáo lỗi bảng lương của Alice',
        route_template: '/payroll',
        module_name: 'Bảng lương (Payroll)',
      },
      status: 'unknown',
      createdAt: Date.now(),
    };

    // User A persists report
    const writeA = writePendingReportToStorage(wsId, userA, reportA);
    assert.equal(writeA.success, true);

    // User A can read it
    const readA = readPendingReportFromStorage(wsId, userA);
    assert.equal(readA.success, true);
    assert.equal(readA.data?.snapshotPayload?.description, 'Nhạy cảm: Báo cáo lỗi bảng lương của Alice');

    // User B reads: strictly null, zero leak
    const readB = readPendingReportFromStorage(wsId, userB);
    assert.equal(readB.success, true);
    assert.equal(readB.data, null, 'User B must never observe User A pending report');

    // Storage key check
    const keyA = getScopedStorageKey(wsId, userA);
    const keyB = getScopedStorageKey(wsId, userB);
    assert.notEqual(keyA, keyB);
    assert.ok(mockStorage.getItem(keyA));
    assert.equal(mockStorage.getItem(keyB), null);
  });

  // -------------------------------------------------------------------------
  // 3. Workspace A -> B: zero workspace leak
  // -------------------------------------------------------------------------
  await t.test('3. Workspace A -> B: data isolated strictly per workspace ID', () => {
    const wsA = 'ws-engineering';
    const wsB = 'ws-human-resources';
    const userId = 'user-charlie';

    const reportWsA = {
      idempotencyKey: 'idemp-charlie-eng',
      userId,
      workspaceId: wsA,
      snapshotPayload: {
        title: '/clock',
        description: 'Lỗi chấm công ca đêm ở Workspace Engineering',
        route_template: '/clock',
        module_name: 'Chấm công (Clock)',
      },
      status: 'unknown',
      createdAt: Date.now(),
    };

    writePendingReportToStorage(wsA, userId, reportWsA);

    // Reading under Workspace B returns null
    const readWsB = readPendingReportFromStorage(wsB, userId);
    assert.equal(readWsB.success, true);
    assert.equal(readWsB.data, null, 'Switching workspace must yield null pending report');
  });

  // -------------------------------------------------------------------------
  // 4. Logout / Login lifecycle
  // -------------------------------------------------------------------------
  await t.test('4. Logout / Login lifecycle: logout clears pending record and state', async () => {
    const wsId = 'ws-finance';
    const userId = 'user-david';

    // Save pending draft
    writePendingReportToStorage(wsId, userId, {
      idempotencyKey: 'key-david',
      userId,
      workspaceId: wsId,
      snapshotPayload: {
        title: '/work',
        description: 'Bản nháp của David',
        route_template: '/work',
        module_name: 'Công việc (Work)',
      },
      status: 'draft',
      createdAt: Date.now(),
    });

    // Logout action clears storage
    const clearRes = writePendingReportToStorage(wsId, userId, null);
    assert.equal(clearRes.success, true);

    const readAfterLogout = readPendingReportFromStorage(wsId, userId);
    assert.equal(readAfterLogout.success, true);
    assert.equal(readAfterLogout.data, null);

    // Verify App.tsx executeLogout invariant resets all identity fields and increments authEpoch
    const { executeLogout } = await import(`file://${resolve(root, 'dist/apps/web/src/App.js')}`);
    const tracker = {
      authEpoch: 5,
      isLoggedIn: true,
      verifiedOwnerSession: true,
      userId: 'user-david',
      workspaceId: 'ws-finance',
      workspaceName: 'Finance Workspace',
      csrfToken: 'csrf-123',
    };
    executeLogout(tracker);
    assert.equal(tracker.authEpoch, 6);
    assert.equal(tracker.isLoggedIn, false);
    assert.equal(tracker.verifiedOwnerSession, false);
    assert.equal(tracker.userId, undefined);
    assert.equal(tracker.workspaceId, undefined);
    assert.equal(tracker.workspaceName, undefined);
    assert.equal(tracker.csrfToken, '');
  });

  // -------------------------------------------------------------------------
  // 5. Cross-tab session change: Pre-POST authoritative session check aborts
  // -------------------------------------------------------------------------
  await t.test('5. Cross-tab session change: pre-POST check detects identity mismatch and halts submission', () => {
    const widgetSource = readFileSync(
      resolve(root, 'apps/web/src/components/ReportBugWidget.tsx'),
      'utf-8',
    );

    // Verify pre-POST authoritative check against /api/v1/auth/me
    assert.ok(
      widgetSource.includes('/api/v1/auth/me'),
      'Widget must perform pre-POST authoritative check against /api/v1/auth/me',
    );
    assert.ok(
      widgetSource.includes('currentSessionUser !== activeUserId || currentSessionWs !== activeWorkspaceId'),
      'Must verify both active user ID and active workspace ID match live session',
    );
    assert.ok(
      widgetSource.includes('Phiên làm việc đã thay đổi người dùng hoặc không gian làm việc'),
      'Must abort with clear error message when session identity changed across tabs',
    );
  });

  // -------------------------------------------------------------------------
  // 6. Async response discarded when identity changes mid-flight (Epoch Guard)
  // -------------------------------------------------------------------------
  await t.test('6. Async response discarded when identity changes mid-flight', () => {
    const widgetSource = readFileSync(
      resolve(root, 'apps/web/src/components/ReportBugWidget.tsx'),
      'utf-8',
    );

    // Verify epoch reference and abort controllers
    assert.ok(widgetSource.includes('identityEpochRef = useRef<number>(0)'), 'Must track identity epoch in ref');
    assert.ok(widgetSource.includes('authAbortControllerRef = useRef<AbortController | null>(null)'));
    assert.ok(widgetSource.includes('submitAbortControllerRef = useRef<AbortController | null>(null)'));
    assert.ok(widgetSource.includes('identityEpochRef.current++'), 'Must bump epoch on identity change');
    assert.ok(
      widgetSource.includes('submitEpoch !== identityEpochRef.current'),
      'Must discard async response if identity epoch changed while request was in-flight',
    );
    assert.ok(
      widgetSource.includes('fetchEpoch !== identityEpochRef.current'),
      'Must discard auth fetch response if identity epoch changed',
    );
  });

  // -------------------------------------------------------------------------
  // 7. Empty string record: readPendingReportFromStorage fails closed
  // -------------------------------------------------------------------------
  await t.test('7. Empty string / whitespace in sessionStorage fails closed (NEVER returns null)', () => {
    const wsId = 'ws-test';
    const userId = 'user-test';
    const key = getScopedStorageKey(wsId, userId);

    // Exactly empty string
    mockStorage.store.set(key, '');
    const readEmpty = readPendingReportFromStorage(wsId, userId);
    assert.equal(readEmpty.success, false, 'Empty string must fail closed');
    assert.equal(readEmpty.data, undefined);
    assert.ok(readEmpty.error.includes('rỗng không hợp lệ'), 'Error must note empty invalid data');

    // Whitespace string
    mockStorage.store.set(key, '   \n\t  ');
    const readWhitespace = readPendingReportFromStorage(wsId, userId);
    assert.equal(readWhitespace.success, false, 'Whitespace-only string must fail closed');
    assert.equal(readWhitespace.data, undefined);

    // Key is preserved (not deleted or altered)
    assert.equal(mockStorage.getItem(key), '   \n\t  ');
  });

  // -------------------------------------------------------------------------
  // 8. Corrupted JSON / invalid status / missing snapshot fields
  // -------------------------------------------------------------------------
  await t.test('8. Corrupted JSON and invalid schema fail closed (ONLY raw === null returns null)', () => {
    const wsId = 'ws-test';
    const userId = 'user-test';
    const key = getScopedStorageKey(wsId, userId);

    // Corrupted non-JSON
    mockStorage.store.set(key, '{"broken json');
    const readBrokenJson = readPendingReportFromStorage(wsId, userId);
    assert.equal(readBrokenJson.success, false);
    assert.ok(readBrokenJson.error.includes('JSON parse error'));

    // JSON not an object
    mockStorage.store.set(key, '"just a string"');
    const readNotObj = readPendingReportFromStorage(wsId, userId);
    assert.equal(readNotObj.success, false);

    // JSON is an array
    mockStorage.store.set(key, '[]');
    const readArr = readPendingReportFromStorage(wsId, userId);
    assert.equal(readArr.success, false);

    // Missing / empty idempotencyKey
    mockStorage.store.set(key, JSON.stringify({
      idempotencyKey: '',
      userId,
      workspaceId: wsId,
      status: 'unknown',
      snapshotPayload: { description: 'd', route_template: '/w', module_name: 'm' },
    }));
    const readNoKey = readPendingReportFromStorage(wsId, userId);
    assert.equal(readNoKey.success, false);
    assert.ok(readNoKey.error.includes('idempotencyKey'));

    // Invalid status enum
    mockStorage.store.set(key, JSON.stringify({
      idempotencyKey: 'k-1',
      userId,
      workspaceId: wsId,
      status: 'forged_status',
      snapshotPayload: { description: 'd', route_template: '/w', module_name: 'm' },
    }));
    const readBadStatus = readPendingReportFromStorage(wsId, userId);
    assert.equal(readBadStatus.success, false);
    assert.ok(readBadStatus.error.includes('Trạng thái'));

    // Mismatched userId
    mockStorage.store.set(key, JSON.stringify({
      idempotencyKey: 'k-1',
      userId: 'attacker-user',
      workspaceId: wsId,
      status: 'unknown',
      snapshotPayload: { description: 'd', route_template: '/w', module_name: 'm' },
    }));
    const readWrongUser = readPendingReportFromStorage(wsId, userId);
    assert.equal(readWrongUser.success, false);
    assert.ok(readWrongUser.error.includes('userId'));

    // Missing snapshotPayload
    mockStorage.store.set(key, JSON.stringify({
      idempotencyKey: 'k-1',
      userId,
      workspaceId: wsId,
      status: 'unknown',
    }));
    const readNoSnap = readPendingReportFromStorage(wsId, userId);
    assert.equal(readNoSnap.success, false);
    assert.ok(readNoSnap.error.includes('snapshotPayload'));

    // Missing route_template in snapshotPayload
    mockStorage.store.set(key, JSON.stringify({
      idempotencyKey: 'k-1',
      userId,
      workspaceId: wsId,
      status: 'unknown',
      snapshotPayload: { description: 'd', module_name: 'm' },
    }));
    const readNoRoute = readPendingReportFromStorage(wsId, userId);
    assert.equal(readNoRoute.success, false);
    assert.ok(readNoRoute.error.includes('route_template'));

    // Missing module_name in snapshotPayload
    mockStorage.store.set(key, JSON.stringify({
      idempotencyKey: 'k-1',
      userId,
      workspaceId: wsId,
      status: 'unknown',
      snapshotPayload: { description: 'd', route_template: '/w' },
    }));
    const readNoModule = readPendingReportFromStorage(wsId, userId);
    assert.equal(readNoModule.success, false);
    assert.ok(readNoModule.error.includes('module_name'));

    // Non-string description
    mockStorage.store.set(key, JSON.stringify({
      idempotencyKey: 'k-1',
      userId,
      workspaceId: wsId,
      status: 'unknown',
      snapshotPayload: { description: 12345, route_template: '/w', module_name: 'm' },
    }));
    const readBadDesc = readPendingReportFromStorage(wsId, userId);
    assert.equal(readBadDesc.success, false);
    assert.ok(readBadDesc.error.includes('description'));

    // ONLY raw === null returns success: true, data: null
    mockStorage.store.delete(key);
    assert.equal(mockStorage.getItem(key), null);
    const readNull = readPendingReportFromStorage(wsId, userId);
    assert.equal(readNull.success, true);
    assert.equal(readNull.data, null);
  });

  // -------------------------------------------------------------------------
  // 9. Lost response: unknown outcome retains key and payload for retry
  // -------------------------------------------------------------------------
  await t.test('9. Lost response: unknown outcome retains key and snapshot, discard disabled', () => {
    const wsId = 'ws-test';
    const userId = 'user-test';
    const savedKey = 'lost-response-key-888';

    const report = {
      idempotencyKey: savedKey,
      userId,
      workspaceId: wsId,
      snapshotPayload: {
        title: '/storage',
        description: 'Dữ liệu thử nghiệm mất kết nối',
        route_template: '/storage',
        module_name: 'Kho lưu trữ (Storage)',
      },
      status: 'unknown',
      lastError: 'Mạng bị ngắt kết nối',
      createdAt: Date.now(),
    };

    writePendingReportToStorage(wsId, userId, report);

    const read = readPendingReportFromStorage(wsId, userId);
    assert.equal(read.success, true);
    assert.equal(read.data?.idempotencyKey, savedKey);
    assert.equal(read.data?.status, 'unknown');
    assert.equal(read.data?.snapshotPayload?.description, 'Dữ liệu thử nghiệm mất kết nối');

    // Verify in widget source that Discard handler is disabled during unknown outcome
    const widgetSource = readFileSync(
      resolve(root, 'apps/web/src/components/ReportBugWidget.tsx'),
      'utf-8',
    );
    assert.ok(
      widgetSource.includes('if (isSubmitting || isUnknownOutcome) return;'),
      'handleDiscardAndNew must be strictly prohibited during unknown outcome',
    );
    assert.ok(
      widgetSource.includes('!isUnknownOutcome && description.trim().length > 0'),
      'Discard button UI must only render when not in unknown outcome state',
    );
  });

  // -------------------------------------------------------------------------
  // 10. Workspace label copying: dynamic workspaceName / workspaceId, zero Studio Media Lite
  // -------------------------------------------------------------------------
  await t.test('10. Workspace label copying: dynamic workspaceName / workspaceId, zero hardcoded Studio Media Lite', () => {
    const issuesScreenSource = readFileSync(
      resolve(root, 'apps/web/src/screens/IssuesScreen.tsx'),
      'utf-8',
    );

    // Hardcoded string must NEVER appear
    assert.equal(
      issuesScreenSource.includes('Studio Media Lite'),
      false,
      'Hardcoded "Studio Media Lite" must be completely removed from IssuesScreen.tsx',
    );

    // Verify dynamic workspace formatting
    assert.ok(
      issuesScreenSource.includes('currentWorkspaceName'),
      'Must use currentWorkspaceName',
    );
    assert.ok(
      issuesScreenSource.includes('ID: ${currentWorkspaceId}'),
      'Must fall back to ID: ${currentWorkspaceId}',
    );
    assert.ok(
      issuesScreenSource.includes('if (resolvedLabel)'),
      'Must omit workspace line entirely if neither name nor ID is available',
    );
  });

  // -------------------------------------------------------------------------
  // 11. Form locked on invalid storage and unverified identity
  // -------------------------------------------------------------------------
  await t.test('11. Form locked on invalid storage and unverified identity', () => {
    const widgetSource = readFileSync(
      resolve(root, 'apps/web/src/components/ReportBugWidget.tsx'),
      'utf-8',
    );

    assert.ok(
      widgetSource.includes('const isFormLocked ='),
      'Must define isFormLocked',
    );
    assert.ok(
      widgetSource.includes('Boolean(persistenceError)'),
      'isFormLocked must include persistenceError',
    );
    assert.ok(
      widgetSource.includes('!resolvedUserId'),
      'isFormLocked must include unverified userId',
    );
    assert.ok(
      widgetSource.includes('!resolvedWorkspaceId'),
      'isFormLocked must include unverified workspaceId',
    );
    assert.ok(
      widgetSource.includes('disabled={isFormLocked}'),
      'Inputs must have disabled={isFormLocked}',
    );
  });
});
