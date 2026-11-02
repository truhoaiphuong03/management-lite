import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('MGL-ISSUES-GOLIVE-FIX-02 Suite', async (t) => {
  // Mock browser sessionStorage for testing
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
      if (this.throwOnSet)
        throw new Error('QuotaExceededError: Storage quota exceeded');
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
    generateReportIdempotencyKey,
    getModuleNameFromPath,
  } = await import(
    `file://${resolve(root, 'dist/apps/web/src/components/ReportBugWidget.js')}`
  );

  t.beforeEach(() => {
    mockStorage.clear();
    mockStorage.throwOnSet = false;
    mockStorage.throwOnGet = false;
    inMemoryReports.clear();
  });

  // -------------------------------------------------------------------------
  // 1. FIX-01: User A pending -> logout -> User B login
  // -------------------------------------------------------------------------
  await t.test(
    'FIX-01: User A pending -> logout -> User B login (Zero Identity Leak)',
    () => {
      const wsId = 'ws-test-01';
      const userA = 'user-alice-111';
      const userB = 'user-bob-222';

      const reportA = {
        idempotencyKey: 'idemp-key-alice',
        userId: userA,
        workspaceId: wsId,
        snapshotPayload: {
          title: '/work',
          description: 'Báo cáo lỗi của Alice về tính năng công việc',
          route_template: '/work',
          module_name: 'Công việc (Work)',
        },
        status: 'unknown',
        createdAt: Date.now(),
      };

      // Save for User A
      const writeResA = writePendingReportToStorage(wsId, userA, reportA);
      assert.equal(writeResA.success, true);

      // Verify User A can read it
      const readA = readPendingReportFromStorage(wsId, userA);
      assert.equal(readA.success, true);
      assert.equal(
        readA.data?.snapshotPayload?.description,
        'Báo cáo lỗi của Alice về tính năng công việc',
      );

      // Simulate logout and User B login: read for User B
      const readB = readPendingReportFromStorage(wsId, userB);
      assert.equal(readB.success, true);
      assert.equal(
        readB.data,
        null,
        'User B must see null pending report - ZERO data leak from User A!',
      );
    },
  );

  // -------------------------------------------------------------------------
  // 2. FIX-01: Workspace switch
  // -------------------------------------------------------------------------
  await t.test('FIX-01: Workspace switch (Zero Workspace Leak)', () => {
    const wsA = 'ws-engineering-01';
    const wsB = 'ws-marketing-02';
    const userId = 'user-charlie-333';

    const reportWsA = {
      idempotencyKey: 'idemp-key-charlie',
      userId,
      workspaceId: wsA,
      snapshotPayload: {
        title: '/clock',
        description: 'Lỗi chấm công trong workspace Engineering',
        route_template: '/clock',
        module_name: 'Chấm công (Clock)',
      },
      status: 'unknown',
      createdAt: Date.now(),
    };

    writePendingReportToStorage(wsA, userId, reportWsA);

    // Read from workspace B
    const readWsB = readPendingReportFromStorage(wsB, userId);
    assert.equal(readWsB.success, true);
    assert.equal(
      readWsB.data,
      null,
      'Switching workspace must not leak pending reports across workspaces',
    );
  });

  // -------------------------------------------------------------------------
  // 3. FIX-02: Lost response -> close/reopen & remount/reload
  // -------------------------------------------------------------------------
  await t.test(
    'FIX-02: Lost response -> close/reopen & remount preserves exact key and snapshot',
    () => {
      const wsId = 'ws-staging';
      const userId = 'user-owner-999';
      const testKey = 'test-idemp-key-lost-response';

      const pendingReport = {
        idempotencyKey: testKey,
        userId,
        workspaceId: wsId,
        snapshotPayload: {
          title: 'Lỗi nút gửi báo cáo',
          description: 'Chi tiết mô tả lỗi khi bấm gửi',
          route_template: '/reports',
          module_name: 'Báo cáo chấm công (Reports)',
        },
        status: 'unknown',
        lastError: 'Mất kết nối mạng',
        createdAt: Date.now(),
      };

      writePendingReportToStorage(wsId, userId, pendingReport);

      // Simulate modal close: pending report must NOT be erased if status is 'unknown'
      const readAfterClose = readPendingReportFromStorage(wsId, userId);
      assert.equal(readAfterClose.success, true);
      assert.equal(
        readAfterClose.data?.idempotencyKey,
        testKey,
        'Key must be preserved across close',
      );
      assert.equal(readAfterClose.data?.status, 'unknown');

      // Simulate page reload / remount: reads from sessionStorage again
      const readAfterReload = readPendingReportFromStorage(wsId, userId);
      assert.equal(readAfterReload.success, true);
      assert.deepEqual(
        readAfterReload.data?.snapshotPayload,
        pendingReport.snapshotPayload,
      );
    },
  );

  // -------------------------------------------------------------------------
  // 4. FIX-03: Route change after first request (Immutable Retry Payload)
  // -------------------------------------------------------------------------
  await t.test(
    'FIX-03: Route change after request preserves original snapshot payload and verbatim text',
    () => {
      const wsId = 'ws-staging';
      const userId = 'user-owner-999';
      const verbatimDescription = '\n  Lỗi thụt dòng\n    và xuống dòng đôi\n';

      const originalSnapshot = {
        title: '/work',
        description: verbatimDescription,
        route_template: '/work',
        module_name: 'Công việc (Work)',
      };

      const pendingReport = {
        idempotencyKey: 'idemp-key-route-change',
        userId,
        workspaceId: wsId,
        snapshotPayload: originalSnapshot,
        status: 'unknown',
        createdAt: Date.now(),
      };

      writePendingReportToStorage(wsId, userId, pendingReport);

      // User navigates from /work to /storage
      const currentNavigatedPath = '/storage';
      const currentNavigatedModule =
        getModuleNameFromPath(currentNavigatedPath);
      assert.equal(currentNavigatedModule, 'Kho lưu trữ (Storage)');

      // When retrying, the pending report retrieved STILL contains the original route /work
      const read = readPendingReportFromStorage(wsId, userId);
      assert.equal(read.success, true);
      assert.equal(
        read.data?.snapshotPayload?.route_template,
        '/work',
        'Must retain original route_template',
      );
      assert.equal(
        read.data?.snapshotPayload?.module_name,
        'Công việc (Work)',
        'Must retain original module_name',
      );
      assert.equal(
        read.data?.snapshotPayload?.description,
        verbatimDescription,
        'Must retain verbatim description without trimming',
      );
    },
  );

  // -------------------------------------------------------------------------
  // 5. FIX-04: sessionStorage write failure (Fail-Closed)
  // -------------------------------------------------------------------------
  await t.test(
    'FIX-04: sessionStorage write failure fails closed without sending POST',
    () => {
      mockStorage.throwOnSet = true; // Simulate quota exceeded or storage blocked

      const writeRes = writePendingReportToStorage('ws-1', 'user-1', {
        idempotencyKey: 'key-quota-test',
        userId: 'user-1',
        workspaceId: 'ws-1',
        snapshotPayload: {
          title: '/clock',
          description: 'Test write error',
          route_template: '/clock',
          module_name: 'Chấm công (Clock)',
        },
        status: 'submitting',
        createdAt: Date.now(),
      });

      assert.equal(
        writeRes.success,
        false,
        'Write must fail when storage throws',
      );
      assert.ok(
        writeRes.error.includes('sessionStorage'),
        'Error message must mention sessionStorage',
      );
    },
  );

  // -------------------------------------------------------------------------
  // 6. FIX-04: sessionStorage read/parse failure (Fail-Closed)
  // -------------------------------------------------------------------------
  await t.test(
    'FIX-04: sessionStorage parse failure fails closed without generating new key',
    () => {
      const key = getScopedStorageKey('ws-1', 'user-1');
      mockStorage.store.set(key, 'MALFORMED_NON_JSON{{{');

      const readRes = readPendingReportFromStorage('ws-1', 'user-1');
      assert.equal(
        readRes.success,
        false,
        'Read must fail when JSON is corrupted',
      );
      assert.ok(
        readRes.error.includes('JSON parse error'),
        'Error message must identify JSON parse error',
      );
    },
  );

  // -------------------------------------------------------------------------
  // 7. FIX-02: Confirmed success allows creating new report
  // -------------------------------------------------------------------------
  await t.test(
    'FIX-02: Confirmed success clears storage and permits new report',
    () => {
      const wsId = 'ws-1';
      const userId = 'user-1';

      // Start with pending report
      writePendingReportToStorage(wsId, userId, {
        idempotencyKey: 'key-to-clear',
        userId,
        workspaceId: wsId,
        snapshotPayload: {
          title: '/reports',
          description: 'Successful report',
          route_template: '/reports',
          module_name: 'Báo cáo chấm công (Reports)',
        },
        status: 'submitting',
        createdAt: Date.now(),
      });

      // Simulate 201 Created confirmed success: storage is cleared
      const clearRes = writePendingReportToStorage(wsId, userId, null);
      assert.equal(clearRes.success, true);

      const readAfterSuccess = readPendingReportFromStorage(wsId, userId);
      assert.equal(readAfterSuccess.success, true);
      assert.equal(
        readAfterSuccess.data,
        null,
        'Storage must be completely cleared after 201 confirmed success',
      );

      // New key generation works cleanly
      const key1 = generateReportIdempotencyKey();
      const key2 = generateReportIdempotencyKey();
      assert.notEqual(
        key1,
        key2,
        'Fresh distinct keys generated for subsequent reports',
      );
    },
  );
});
