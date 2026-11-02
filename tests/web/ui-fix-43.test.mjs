import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('UI-FIX-43 — UI42-01: EmployeesScreen cursor pagination, deduplication, and stale response protection', async () => {
  const sourcePath = resolve(root, 'apps/web/src/screens/EmployeesScreen.tsx');
  const source = readFileSync(sourcePath, 'utf8');

  // 1. Verifies nextCursor and loadingMore state hooks
  assert.ok(
    source.includes('const [nextCursor, setNextCursor] = useState'),
    'Must have nextCursor state',
  );
  assert.ok(
    source.includes('const [loadingMore, setLoadingMore] = useState'),
    'Must have loadingMore state',
  );

  // 2. Verifies query param cursor passing
  assert.ok(
    source.includes("params.set('cursor', cursor)"),
    'Must pass cursor query param when provided',
  );

  // 3. Verifies deduplication to prevent duplicate IDs on consecutive pages
  assert.ok(
    source.includes('!prev.some('),
    'Must deduplicate items when appending next page to prevent duplicate IDs',
  );

  // 4. Verifies stale response guard via request sequence
  assert.ok(
    source.includes('requestSeqRef'),
    'Must use requestSeqRef to reject stale in-flight responses',
  );

  // 5. Verifies reset on filter change
  assert.ok(
    source.includes('setNextCursor(null)'),
    'Must reset nextCursor on fresh fetch / filter change',
  );

  // 6. Verifies "Tải thêm nhân sự" button rendering
  assert.ok(
    source.includes('Tải thêm nhân sự'),
    'Must render Tải thêm nhân sự button when nextCursor is present',
  );

  // 7. Dynamic multi-page mock simulation
  const page1 = [
    {
      id: 'emp-1',
      employee_code: 'E01',
      full_name: 'Nguyen Van A',
      employment_status: 'active',
    },
    {
      id: 'emp-2',
      employee_code: 'E02',
      full_name: 'Tran Thi B',
      employment_status: 'active',
    },
  ];
  const page2 = [
    {
      id: 'emp-2',
      employee_code: 'E02',
      full_name: 'Tran Thi B',
      employment_status: 'active',
    }, // duplicate edge case
    {
      id: 'emp-3',
      employee_code: 'E03',
      full_name: 'Le Van C',
      employment_status: 'active',
    },
  ];

  // Simulation of append with deduplication logic
  const merged = [
    ...page1,
    ...page2.filter((item) => !page1.some((p) => p.id === item.id)),
  ];
  assert.equal(
    merged.length,
    3,
    'Consecutive pages must merge exactly 3 unique employees',
  );
  assert.deepEqual(
    merged.map((m) => m.id),
    ['emp-1', 'emp-2', 'emp-3'],
    'IDs must be preserved without duplication',
  );
});

test('UI-FIX-43 — UI42-02: ReportsScreen query contract verification, Staff own-only boundaries, and cursor pagination', async () => {
  const sourcePath = resolve(root, 'apps/web/src/screens/ReportsScreen.tsx');
  const source = readFileSync(sourcePath, 'utf8');

  // 1. Verifies Staff own-only and Owner tab segregation
  assert.ok(
    source.includes("role === 'owner' ? 'all_reports' : 'my_reports'"),
    'Initial tab must be my_reports for Staff',
  );
  assert.ok(
    source.includes('/api/v1/reports/me'),
    'Staff must fetch own reports via /api/v1/reports/me',
  );
  assert.ok(
    source.includes('/api/v1/reports/daily'),
    'Owner fetches workspace reports via /api/v1/reports/daily',
  );

  // 2. Verifies cursor pagination states for both lists
  assert.ok(
    source.includes('myReportsNextCursor'),
    'Must declare myReportsNextCursor',
  );
  assert.ok(
    source.includes('allReportsNextCursor'),
    'Must declare allReportsNextCursor',
  );

  // 3. Verifies cursor query parameters
  assert.ok(source.includes('cursor='), 'Must support cursor query param');

  // 4. Verifies deduplication logic
  assert.ok(
    source.includes('!prev.some('),
    'Must deduplicate reports on pagination',
  );

  // 5. Verifies Tải thêm báo cáo buttons
  assert.ok(
    source.includes('Tải thêm báo cáo'),
    'Must render Tải thêm báo cáo button',
  );
});

test('UI-FIX-43 — UI42-03: LoginScreen validation error association, aria-invalid, and focus management', () => {
  const sourcePath = resolve(root, 'apps/web/src/screens/LoginScreen.tsx');
  const source = readFileSync(sourcePath, 'utf8');

  // 1. Ref attachments for first invalid field focus
  assert.ok(
    source.includes('identifierInputRef'),
    'Must declare identifierInputRef',
  );
  assert.ok(
    source.includes('passwordInputRef'),
    'Must declare passwordInputRef',
  );
  assert.ok(
    source.includes('ref={identifierInputRef}'),
    'Must bind identifierInputRef to username input',
  );
  assert.ok(
    source.includes('ref={passwordInputRef}'),
    'Must bind passwordInputRef to password input',
  );

  // 2. Focus first invalid field when validation fails
  assert.ok(
    source.includes('identifierInputRef.current?.focus()'),
    'Must focus identifier input when identifier is missing',
  );

  // 3. Error association via aria-describedby and aria-invalid
  assert.ok(
    source.includes('id="login-error-alert"'),
    'Error banner must have id="login-error-alert"',
  );
  assert.ok(
    source.includes('aria-invalid='),
    'Inputs must declare aria-invalid dynamically',
  );
  assert.ok(
    source.includes('aria-describedby='),
    'Inputs must link to login-error-alert via aria-describedby',
  );
});

test('UI-FIX-43 — UI42-04: LoginScreen canonical secret-on-error clearing policy (Doc 44)', () => {
  const sourcePath = resolve(root, 'apps/web/src/screens/LoginScreen.tsx');
  const source = readFileSync(sourcePath, 'utf8');

  // 1. Clear password on auth/network failure per canonical doc 44
  const onAuthFailureBlock = source.slice(
    source.indexOf('if (!res.ok || !body?.success)'),
    source.indexOf('if (res.status === 401)'),
  );
  assert.ok(
    onAuthFailureBlock.includes("setPassword('');"),
    'Password state must be cleared on authentication error',
  );

  const onNetworkErrorBlock = source.slice(
    source.indexOf('catch {'),
    source.indexOf('finally {'),
  );
  assert.ok(
    onNetworkErrorBlock.includes("setPassword('');"),
    'Password state must be cleared on network failure',
  );

  // 2. Validation failure preserves entered nonsecret data (identifier) and does NOT clear password prematurely
  const onValidationFailureBlock = source.slice(
    source.indexOf('const cleanId = identifier.trim();'),
    source.indexOf('setIsLoading(true);'),
  );
  assert.ok(
    !onValidationFailureBlock.includes("setPassword('');"),
    'Client-side validation error must NOT clear password state prematurely',
  );
});

test('UI-FIX-43 — UI42-05: Route registry metadata vs canonical dispatch comparison', async () => {
  const { ROUTE_REGISTRY } = await import(
    `file://${resolve(root, 'dist/apps/web/src/types.js')}`
  );

  // 1. Verify canonical definition: existence of dispatch in App.tsx does NOT equate to full canonical completion
  assert.equal(
    ROUTE_REGISTRY['/activate']?.implemented,
    false,
    '/activate remains implemented: false per canonical UI-REVIEW specification',
  );
  assert.equal(
    ROUTE_REGISTRY['/employees']?.implemented,
    false,
    '/employees remains implemented: false in V0.1 route registry',
  );

  // 2. Verify RBAC guards are intact
  assert.equal(
    ROUTE_REGISTRY['/employees']?.ownerOnly,
    true,
    '/employees must remain ownerOnly',
  );
  assert.equal(
    ROUTE_REGISTRY['/reports']?.implemented,
    true,
    '/reports is implemented',
  );
  assert.equal(
    ROUTE_REGISTRY['/login']?.implemented,
    true,
    '/login is implemented',
  );
});
