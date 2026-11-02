import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('V0.2 AUDIT-01: route registry, navigation binding, and AuditScreen UI19 invariants', async () => {
  const { ROUTE_REGISTRY } = await import(
    `file://${resolve(root, 'dist/apps/web/src/types.js')}`
  );
  const { matchRoute } = await import(
    `file://${resolve(root, 'dist/apps/web/src/router.js')}`
  );

  // 1. Verify /audit route in registry (UI19)
  const auditRoute = ROUTE_REGISTRY['/audit'];
  assert.ok(auditRoute, 'Audit route must exist in ROUTE_REGISTRY');
  assert.equal(auditRoute.id, 'UI19');
  assert.equal(auditRoute.path, '/audit');
  assert.equal(
    auditRoute.implemented,
    true,
    'Audit route must be marked implemented',
  );
  assert.equal(auditRoute.ownerOnly, true, 'Audit route must be Owner-only');
  assert.equal(auditRoute.category, 'audit');

  // 2. Verify router matching
  const matchAudit = matchRoute('/audit');
  assert.ok(matchAudit.route, 'Route matching must succeed for /audit');
  assert.equal(matchAudit.route.id, 'UI19');
});

test('V0.2 AUDIT-02: AuditScreen.tsx security redaction, Q3-OPS-003, Q3-ACC-006, Owner guard, and timeline invariants', () => {
  const auditPath = resolve(root, 'apps/web/src/screens/AuditScreen.tsx');
  assert.ok(existsSync(auditPath), 'AuditScreen.tsx must exist');

  const content = readFileSync(auditPath, 'utf-8');

  // 1. Invariants: Security assurance and canonical references
  assert.ok(
    content.includes('Q3-OPS-003'),
    'Must reference Q3-OPS-003 log redaction standard',
  );
  assert.ok(
    content.includes('Q3-ACC-006'),
    'Must reference Q3-ACC-006 secret protection standard',
  );
  assert.ok(content.includes('UI19'), 'Must identify as UI19');
  assert.ok(
    content.includes('Nhật ký kiểm toán hệ thống'),
    'Must include Vietnamese screen title',
  );

  // 2. Invariants: Owner-only RBAC guard
  assert.ok(
    content.includes("role !== 'owner'"),
    'Must enforce client-side Owner-only access guard',
  );
  assert.ok(
    content.includes('Truy cập bị từ chối (403 Forbidden)'),
    'Must render 403 Forbidden when accessed by non-owner',
  );

  // 3. Invariants: API Endpoint and parameters
  assert.ok(
    content.includes('/api/v1/audit'),
    'Must query canonical /api/v1/audit endpoint',
  );
  assert.ok(
    content.includes('cursor'),
    'Must support cursor pagination parameter',
  );
  assert.ok(content.includes('action'), 'Must support action filter parameter');
  assert.ok(
    content.includes('entity_type'),
    'Must support entity_type filter parameter',
  );
  assert.ok(
    content.includes("credentials: 'include'"),
    'Must send session credentials',
  );

  // 4. Invariants: Action mapping and metadata sanitization
  assert.ok(content.includes('auth.login'), 'Must handle auth.login action');
  assert.ok(
    content.includes('auth.password_change'),
    'Must handle auth.password_change action',
  );
  assert.ok(content.includes('work.create'), 'Must handle work.create action');
  assert.ok(
    content.includes('storage.trash_confirm'),
    'Must handle storage actions',
  );
  assert.ok(
    content.includes('account.secret_reveal'),
    'Must handle account.secret_reveal action',
  );
  assert.ok(
    content.includes('SANITIZED METADATA'),
    'Must explicitly display sanitized metadata notice',
  );
  assert.ok(
    content.includes('Không chứa mã băm, token hay secret'),
    'Must confirm zero secrets leaked',
  );

  // 5. Invariants: Pagination
  assert.ok(
    content.includes('nextCursor'),
    'Must handle nextCursor for cursor pagination',
  );
  assert.ok(
    content.includes('Tải thêm sự kiện cũ hơn'),
    'Must provide load more button for pagination',
  );
});

test('AUDIT-003: AuditScreen implements cursor-based pagination with shared Pagination component', () => {
  const auditPath = resolve(root, 'apps/web/src/screens/AuditScreen.tsx');
  const content = readFileSync(auditPath, 'utf-8');

  assert.ok(
    content.includes('<Pagination'),
    'Must render shared Pagination component',
  );
  assert.ok(
    content.includes('testId="audit-pager"'),
    'Must define testId="audit-pager"',
  );
  assert.ok(
    content.includes('cursorHistory'),
    'Must maintain cursorHistory for prev/next navigation',
  );
  assert.ok(
    content.includes('handleNextPage'),
    'Must implement handleNextPage',
  );
  assert.ok(
    content.includes('handlePrevPage'),
    'Must implement handlePrevPage',
  );
  assert.ok(
    content.includes('PAGINATION_PAGE_SIZES'),
    'Must bind PAGINATION_PAGE_SIZES [10, 20, 50, 100]',
  );
  assert.ok(
    content.includes('hasNext={Boolean(nextCursor)}'),
    'Must pass hasNext cursor status to Pagination',
  );
});
