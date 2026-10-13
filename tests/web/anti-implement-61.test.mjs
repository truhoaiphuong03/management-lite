import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

/**
 * ANTI-IMPLEMENT-61 VERIFICATION SUITE
 *
 * Verifies all findings addressed in IMPLEMENT-61:
 * - FA60-01: EMP backend cursor pagination & keyset tuple filtering
 * - FA60-02: PAY stale response / month race condition guards
 * - FA60-04: PAY unresolved disbursement idempotency key preservation
 * - FA60-03: Multi-page employee selectors in Schedule, Work, Storage
 * - FA60-06: EmployeesScreen clipboard await & error handling
 * - FA60-07: AppToast action button 44x44px touch target
 * - FA60-08: DashboardScreen verified workspace label binding
 */
test('ANTI-IMPLEMENT-61 — Full Verification of Audit-60 Findings', async (t) => {
  // 1. FA60-01: EmployeeService Keyset Pagination & Cursor Handling
  await t.test('1. FA60-01: EmployeeService implements keyset cursor pagination with microsecond tie-break', async () => {
    const { EmployeeService } = await import(
      `file://${resolve(root, 'dist/apps/api/src/employees/service.js')}`
    );

    let recordedQuery = '';
    let recordedParams = [];

    const mockPool = {
      query: async (sql, params) => {
        recordedQuery = sql;
        recordedParams = params;
        return {
          rows: [
            {
              id: '11111111-1111-4000-8000-000000000001',
              workspace_id: 'ws-test',
              user_id: null,
              employee_code: 'EMP-01',
              full_name: 'Test Employee 1',
              employment_status: 'active',
              is_payroll_eligible: true,
              version: 1,
              created_at: new Date('2026-10-01T12:00:00.123456Z'),
              updated_at: new Date('2026-10-01T12:00:00.123456Z'),
              user_username: null,
              user_email: null,
              user_status: null,
            },
            {
              id: '22222222-2222-4000-8000-000000000002',
              workspace_id: 'ws-test',
              user_id: null,
              employee_code: 'EMP-02',
              full_name: 'Test Employee 2',
              employment_status: 'active',
              is_payroll_eligible: true,
              version: 1,
              created_at: new Date('2026-10-01T12:00:00.000000Z'),
              updated_at: new Date('2026-10-01T12:00:00.000000Z'),
              user_username: null,
              user_email: null,
              user_status: null,
            },
          ],
        };
      },
    };

    const service = new EmployeeService(mockPool);
    const ownerContext = {
      workspace: { id: 'ws-test', role: 'owner' },
      user: { id: 'u-owner' },
      membership: { role: 'owner' },
    };

    // A. Initial page without cursor
    const page1 = await service.listEmployees(ownerContext, { limit: 20 });
    assert.ok(!recordedQuery.includes('(e.created_at, e.id) <'), 'Page 1 must not include cursor clause');
    assert.ok(recordedQuery.includes('ORDER BY e.created_at DESC, e.id DESC'), 'Must order by created_at DESC, id DESC');
    assert.equal(page1.items.length, 2);

    // B. Page 2 with valid cursor
    const validCursor = Buffer.from(
      JSON.stringify({
        created_at: '2026-10-01T12:00:00.123456Z',
        id: '11111111-1111-4000-8000-000000000001',
      }),
    ).toString('base64url');

    await service.listEmployees(ownerContext, { limit: 20, cursor: validCursor });
    assert.ok(
      recordedQuery.includes('(e.created_at, e.id) < ($2::timestamptz, $3::uuid)'),
      'Must use tuple comparison for keyset pagination',
    );
    assert.equal(recordedParams[1], '2026-10-01T12:00:00.123456Z');
    assert.equal(recordedParams[2], '11111111-1111-4000-8000-000000000001');

    // C. Malformed cursor fail-closed validation
    let threw = false;
    try {
      await service.listEmployees(ownerContext, { cursor: 'invalid_base64_json' });
    } catch (err) {
      threw = true;
      assert.equal(err.code, 'INVALID_CURSOR');
      assert.equal(err.statusCode, 400);
    }
    assert.ok(threw, 'Must throw 400 INVALID_CURSOR on malformed cursor string');
  });

  // 2. FA60-02: PayrollScreen Stale Month Response & Race Condition Guards
  await t.test('2. FA60-02: PayrollScreen source code enforces request generation, abort controller & period checks', () => {
    const payrollCode = readFileSync(
      resolve(root, 'apps/web/src/screens/PayrollScreen.tsx'),
      'utf8',
    );

    assert.ok(
      payrollCode.includes('const fetchRequestIdRef = useRef<number>(0);'),
      'Must define fetchRequestIdRef for monotonic request sequence tracking',
    );
    assert.ok(
      payrollCode.includes('const activeAbortControllerRef = useRef<AbortController | null>(null);'),
      'Must track active AbortController ref for cancelation',
    );
    assert.ok(
      payrollCode.includes('activeAbortControllerRef.current.abort();'),
      'Must abort previous in-flight fetch before initiating new month request',
    );
    assert.ok(
      payrollCode.includes('if (requestId !== fetchRequestIdRef.current) return;'),
      'Must check sequence after fetch headers and after res.json() to prevent stale overwrites',
    );
    assert.ok(
      payrollCode.includes('if (period?.period_month !== selectedMonth)'),
      'Must guard disburse action against period/month mismatch',
    );
  });

  // 3. FA60-04: PayrollScreen Unresolved Disbursement Idempotency Key Preservation
  await t.test('3. FA60-04: PayrollScreen preserves idempotency key and payload for unresolved disbursement retry', () => {
    const payrollCode = readFileSync(
      resolve(root, 'apps/web/src/screens/PayrollScreen.tsx'),
      'utf8',
    );

    assert.ok(
      payrollCode.includes('const [unresolvedDisbursements, setUnresolvedDisbursements]'),
      'Must maintain state map for unresolved disbursements',
    );
    assert.ok(
      payrollCode.includes('const [isUnresolvedRetry, setIsUnresolvedRetry]'),
      'Must track whether current disburse modal is retrying an unresolved operation',
    );
    assert.ok(
      payrollCode.includes('setDisburseIdempotencyKey(existingUnresolved.idempotencyKey);'),
      'openDisburseModal must reuse preserved idempotency key when an unresolved payment exists',
    );
    assert.ok(
      payrollCode.includes('if (!unresolvedDisbursements.has(unresolvedKey))'),
      'closeDisburseModal must not wipe idempotency key if operation is unresolved',
    );
    assert.ok(
      payrollCode.includes('Giao dịch chưa xác nhận kết quả:'),
      'Must render warning banner informing user of safe retry with same Idempotency Key',
    );
    assert.ok(
      payrollCode.includes('Thử lại an toàn'),
      'Disburse button must indicate safe retry action',
    );
  });

  // 4. FA60-03: Multi-page Employee Selectors in Schedule, Work, and Storage
  await t.test('4. FA60-03: ScheduleScreen, WorkScreen, and StorageScreen loop through next_cursor to fetch all employees', () => {
    const scheduleCode = readFileSync(
      resolve(root, 'apps/web/src/screens/ScheduleScreen.tsx'),
      'utf8',
    );
    const workCode = readFileSync(
      resolve(root, 'apps/web/src/screens/WorkScreen.tsx'),
      'utf8',
    );
    const storageCode = readFileSync(
      resolve(root, 'apps/web/src/screens/StorageScreen.tsx'),
      'utf8',
    );

    // ScheduleScreen checks
    assert.ok(
      scheduleCode.includes('while (page < maxPages)'),
      'ScheduleScreen must loop through employee pages',
    );
    assert.ok(
      scheduleCode.includes('cursor = body.data?.next_cursor || null;'),
      'ScheduleScreen must follow next_cursor',
    );

    // WorkScreen checks
    assert.ok(
      workCode.includes('while (page < maxPages && active)'),
      'WorkScreen must loop through employee pages',
    );
    assert.ok(
      workCode.includes('cursor = empBody.data?.next_cursor || null;'),
      'WorkScreen must follow next_cursor',
    );

    // StorageScreen checks
    assert.ok(
      storageCode.includes('while (page < maxPages)'),
      'StorageScreen must loop through employee pages',
    );
    assert.ok(
      storageCode.includes('cursor = empData.data?.next_cursor || null;'),
      'StorageScreen must follow next_cursor',
    );
  });

  // 5. FA60-06: EmployeesScreen Clipboard Async/Await and Error Toast
  await t.test('5. FA60-06: EmployeesScreen awaits clipboard.writeText and displays error toast on rejection', () => {
    const employeesCode = readFileSync(
      resolve(root, 'apps/web/src/screens/EmployeesScreen.tsx'),
      'utf8',
    );

    assert.ok(
      employeesCode.includes('await navigator.clipboard.writeText(activeInviteUrl);'),
      'EmployeesScreen must await clipboard.writeText',
    );
    assert.ok(
      employeesCode.includes("variant: 'error'"),
      'EmployeesScreen must render error toast if clipboard writeText throws/rejects',
    );
  });

  // 6. FA60-07: AppToast Action Touch Target 44x44px
  await t.test('6. FA60-07: AppToast action button conforms to >= 44x44px touch target specification', () => {
    const toastCode = readFileSync(
      resolve(root, 'packages/ui/src/components/AppToast.tsx'),
      'utf8',
    );

    assert.ok(
      toastCode.includes("minHeight: '44px'"),
      'AppToast action button must enforce minHeight 44px',
    );
    assert.ok(
      toastCode.includes("minWidth: '44px'"),
      'AppToast action button must enforce minWidth 44px',
    );
    assert.ok(
      toastCode.includes("display: 'inline-flex'"),
      'AppToast action button must use inline-flex for centered touch target',
    );
  });

  // 7. FA60-08: DashboardScreen Workspace Name Context Binding
  await t.test('7. FA60-08: DashboardScreen receives and displays verified workspaceName from session context', () => {
    const dashboardCode = readFileSync(
      resolve(root, 'apps/web/src/screens/DashboardScreen.tsx'),
      'utf8',
    );
    const appCode = readFileSync(
      resolve(root, 'apps/web/src/App.tsx'),
      'utf8',
    );

    assert.ok(
      dashboardCode.includes('workspaceName?: string | undefined;'),
      'DashboardScreenProps must accept optional workspaceName',
    );
    assert.ok(
      dashboardCode.includes("subtitle={`Workspace: ${workspaceName || 'Studio Media Lite'}"),
      'DashboardScreen must interpolate verified workspaceName',
    );
    assert.ok(
      appCode.includes('workspaceName={workspaceName}'),
      'App.tsx must pass session-verified workspaceName to DashboardScreen',
    );
  });
});
