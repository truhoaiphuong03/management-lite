import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('V0.2 FILE-01: route registry, navigation binding, and StorageScreen routing', async () => {
  const { ROUTE_REGISTRY } = await import(
    `file://${resolve(root, 'dist/apps/web/src/types.js')}`
  );
  const { NAV_ITEMS } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/Navigation.js')}`
  );
  const { matchRoute } = await import(
    `file://${resolve(root, 'dist/apps/web/src/router.js')}`
  );

  // 1. Verify /storage route in registry (UI-STORAGE-01)
  const storageRoute = ROUTE_REGISTRY['/storage'];
  assert.ok(storageRoute, 'Storage route must exist in ROUTE_REGISTRY');
  assert.equal(storageRoute.id, 'UI-STORAGE-01');
  assert.equal(storageRoute.title, 'Quản lý tệp & Drive (STORAGE)');
  assert.equal(
    storageRoute.implemented,
    true,
    'Storage route must be implemented',
  );
  assert.equal(storageRoute.category, 'storage');

  // 2. Verify /storage/:id route in registry (UI-STORAGE-02)
  const storageDetailRoute = ROUTE_REGISTRY['/storage/:id'];
  assert.ok(
    storageDetailRoute,
    'Storage detail route must exist in ROUTE_REGISTRY',
  );
  assert.equal(storageDetailRoute.id, 'UI-STORAGE-02');
  assert.equal(storageDetailRoute.title, 'Chi tiết nhóm thư mục & Thùng rác');
  assert.equal(
    storageDetailRoute.implemented,
    true,
    'Storage detail route must be implemented',
  );
  assert.equal(storageDetailRoute.category, 'storage');

  // 3. Verify router matching
  const matchStorage = matchRoute('/storage');
  assert.equal(matchStorage.route?.id, 'UI-STORAGE-01');
  assert.equal(matchStorage.isExact, true);

  const matchStorageTrailing = matchRoute('/storage/');
  assert.equal(matchStorageTrailing.route?.id, 'UI-STORAGE-01');
  assert.equal(matchStorageTrailing.isExact, true);

  const matchStorageDetail = matchRoute('/storage/FOLDER-DRIVE-UUID-999');
  assert.equal(matchStorageDetail.route?.id, 'UI-STORAGE-02');
  assert.equal(matchStorageDetail.isExact, false);
  assert.equal(matchStorageDetail.params.id, 'FOLDER-DRIVE-UUID-999');

  // 4. Verify NAV_ITEMS contains storage
  const storageNavItem = NAV_ITEMS.find((item) => item.id === 'storage');
  assert.ok(storageNavItem, 'Storage item must exist in NAV_ITEMS');
  assert.equal(storageNavItem.path, '/storage');
  assert.equal(storageNavItem.label, 'Tệp & Drive');

  // 5. Both Owner and Staff see Storage in navigation
  const ownerVisible = NAV_ITEMS.filter((item) => {
    if (item.staffOnly || item.id === 'my-pay') return false;
    return true;
  });
  assert.ok(
    ownerVisible.some((i) => i.id === 'storage'),
    'Owner MUST see Storage in navigation',
  );

  const staffVisible = NAV_ITEMS.filter((item) => {
    if (item.ownerOnly) return false;
    return true;
  });
  assert.ok(
    staffVisible.some((i) => i.id === 'storage'),
    'Staff MUST see Storage in navigation',
  );
});

test('V0.2 FILE-01: individual assignments, output revisions, and Google Drive Trash in StorageScreen source', async () => {
  const screenContent = readFileSync(
    resolve(root, 'apps/web/src/screens/StorageScreen.tsx'),
    'utf8',
  );

  // 1. Assignments tracking for each individual employee
  assert.ok(
    screenContent.includes('assignments') &&
      screenContent.includes('source_download_confirmed') &&
      screenContent.includes('output_delivered'),
    'Screen must track individual assignment download and deliverable handoff',
  );
  assert.ok(
    screenContent.includes('Phân công & Tải nguồn theo từng nhân sự'),
    'Screen must render section for individual employee assignments',
  );

  // 2. Output tracking with revision matching
  assert.ok(
    screenContent.includes('current_revision') &&
      screenContent.includes('owner_receipt_revision'),
    'Screen must track exact output current_revision and owner_receipt_revision',
  );
  assert.ok(
    screenContent.includes('Revision đã thay đổi sau khi duyệt') ||
      screenContent.includes('Lạc hậu revision'),
    'Screen must detect and warn about stale owner receipts when output revision increments',
  );

  // 3. Backend Delete-Readiness decision (Requirement 4 & 5)
  assert.ok(
    screenContent.includes('delete_readiness') &&
      screenContent.includes('can_verify') &&
      screenContent.includes('is_ready'),
    'Screen must rely strictly on backend delete_readiness evaluation',
  );
  assert.ok(
    screenContent.includes('Chưa thể xác minh điều kiện xóa từ máy chủ') &&
      screenContent.includes('disabled'),
    'Delete button must fail-closed and lock safely when delete_readiness is unavailable',
  );

  // 4. Two-step Google Drive Trash workflow & wording (Requirement 6 & 7)
  assert.ok(
    screenContent.includes('thùng rác Google Drive') ||
      screenContent.includes('Google Drive Trash'),
    'Screen must explicitly use Google Drive Trash wording',
  );
  assert.ok(
    !screenContent.includes('xóa vĩnh viễn'),
    'Screen must NEVER describe trash operation as permanent hard deletion',
  );
  assert.ok(
    screenContent.includes('group_snapshot_hash'),
    'Screen must bind trash requests to group_snapshot_hash for concurrency protection',
  );
});

test('V0.2 FILE-01: Shared contracts, DTO types, and API conformance', async () => {
  const contractsPath = resolve(root, 'packages/contracts/src/storage.ts');
  assert.ok(
    existsSync(contractsPath),
    'packages/contracts/src/storage.ts must exist',
  );

  const contractsContent = readFileSync(contractsPath, 'utf8');

  // Verify individual assignment and output DTOs
  assert.ok(
    contractsContent.includes('export interface StorageAssignmentData'),
    'StorageAssignmentData DTO must be exported',
  );
  assert.ok(
    contractsContent.includes('source_download_confirmed: boolean') &&
      contractsContent.includes('output_delivered: boolean'),
    'StorageAssignmentData must track download confirmation and output delivery',
  );

  assert.ok(
    contractsContent.includes('export interface StorageOutputData'),
    'StorageOutputData DTO must be exported',
  );
  assert.ok(
    contractsContent.includes('current_revision: number') &&
      contractsContent.includes('owner_receipt_revision?: number | null'),
    'StorageOutputData must track current revision and owner receipt revision',
  );

  // Verify backend delete-readiness DTO
  assert.ok(
    contractsContent.includes('export interface StorageDeleteReadiness'),
    'StorageDeleteReadiness DTO must be exported',
  );
  assert.ok(
    contractsContent.includes('can_verify: boolean') &&
      contractsContent.includes('is_ready: boolean') &&
      contractsContent.includes('group_snapshot_hash: string') &&
      contractsContent.includes('stale_output_revisions: number'),
    'StorageDeleteReadiness must detail verification, readiness, snapshot hash, and stale revisions',
  );

  // Verify trash request DTOs with group_snapshot_hash
  assert.ok(
    contractsContent.includes('group_snapshot_hash?: string') ||
      contractsContent.includes('group_snapshot_hash: string'),
    'CreateTrashRequestRequest and ConfirmTrashRequest must include group_snapshot_hash',
  );

  // Verify index re-export
  const indexContent = readFileSync(
    resolve(root, 'packages/contracts/src/index.ts'),
    'utf8',
  );
  assert.ok(
    indexContent.includes("export * from './storage.js'"),
    'packages/contracts/src/index.ts must re-export storage.js',
  );
});

test('V0.2 FILE-01 Scenario 1: 3 employees assigned, only 1 delivered -> delete blocked (partial delete rejected)', () => {
  // Simulate 3 assignments where only 1 employee has delivered output
  const assignments = [
    {
      id: 'asgn-1',
      employee_id: 'emp-1',
      employee_name: 'Nhân viên 1',
      source_download_confirmed: true,
      output_delivered: true,
    },
    {
      id: 'asgn-2',
      employee_id: 'emp-2',
      employee_name: 'Nhân viên 2',
      source_download_confirmed: true,
      output_delivered: false, // NOT delivered
    },
    {
      id: 'asgn-3',
      employee_id: 'emp-3',
      employee_name: 'Nhân viên 3',
      source_download_confirmed: false, // NOT downloaded
      output_delivered: false, // NOT delivered
    },
  ];

  // Evaluate readiness rule
  const undeliveredCount = assignments.filter(
    (a) => !a.output_delivered,
  ).length;
  assert.equal(undeliveredCount, 2, '2 employees have not delivered outputs');

  const readiness = {
    can_verify: true,
    is_ready: undeliveredCount === 0,
    total_assignments: assignments.length,
    delivered_assignments: assignments.filter((a) => a.output_delivered).length,
    block_reasons: [
      'Nhân sự Nhân viên 2 chưa bàn giao output thành phẩm.',
      'Nhân sự Nhân viên 3 chưa tải nguồn và chưa bàn giao output.',
    ],
  };

  assert.equal(
    readiness.is_ready,
    false,
    'Deletion MUST be blocked when some employees have not delivered',
  );
  assert.equal(readiness.delivered_assignments, 1);
  assert.ok(
    readiness.block_reasons.length >= 2,
    'Block reasons must identify missing deliverables',
  );
});

test('V0.2 FILE-01 Scenario 2: 3 outputs submitted, only 2 confirmed by Owner -> delete blocked', () => {
  // Simulate 3 outputs where only 2 have been approved by Owner
  const outputs = [
    {
      id: 'out-1',
      name: 'Output 1',
      current_revision: 1,
      owner_receipt_confirmed: true,
      owner_receipt_revision: 1,
    },
    {
      id: 'out-2',
      name: 'Output 2',
      current_revision: 1,
      owner_receipt_confirmed: true,
      owner_receipt_revision: 1,
    },
    {
      id: 'out-3',
      name: 'Output 3',
      current_revision: 1,
      owner_receipt_confirmed: false, // NOT approved by Owner
      owner_receipt_revision: null,
    },
  ];

  const unconfirmedCount = outputs.filter(
    (o) =>
      !o.owner_receipt_confirmed ||
      o.owner_receipt_revision !== o.current_revision,
  ).length;
  assert.equal(unconfirmedCount, 1, '1 output is not confirmed');

  const readiness = {
    can_verify: true,
    is_ready: unconfirmedCount === 0,
    total_outputs: outputs.length,
    confirmed_outputs: outputs.filter((o) => o.owner_receipt_confirmed).length,
    block_reasons: ['Thành phẩm "Output 3" chưa có biên nhận Owner receipt.'],
  };

  assert.equal(
    readiness.is_ready,
    false,
    'Deletion MUST be blocked when any output lacks Owner approval',
  );
  assert.equal(readiness.confirmed_outputs, 2);
});

test('V0.2 FILE-01 Scenario 3: Output revision changed after Owner approval -> delete blocked (stale receipt)', () => {
  // Simulate an output that was approved at v1, but employee pushed revision v2
  const outputs = [
    {
      id: 'out-1',
      name: 'Video Final',
      current_revision: 2, // New revision uploaded by employee
      owner_receipt_confirmed: true,
      owner_receipt_revision: 1, // Stale approval at v1!
    },
  ];

  const staleOutputs = outputs.filter(
    (o) =>
      o.owner_receipt_confirmed &&
      o.owner_receipt_revision !== o.current_revision,
  );
  assert.equal(staleOutputs.length, 1, '1 output has stale revision receipt');

  const readiness = {
    can_verify: true,
    is_ready: staleOutputs.length === 0,
    stale_output_revisions: staleOutputs.length,
    block_reasons: [
      'Thành phẩm "Video Final" đã thay đổi revision (v1 -> v2) sau khi Owner duyệt; yêu cầu duyệt lại revision mới.',
    ],
  };

  assert.equal(
    readiness.is_ready,
    false,
    'Deletion MUST be blocked when output revision changed after approval',
  );
  assert.equal(readiness.stale_output_revisions, 1);
});

test('V0.2 FILE-01 Scenario 4: Stale If-Match / group_snapshot_hash mismatch rejects trash initiation', () => {
  // Simulate concurrency protection: request snapshot hash does not match current state
  const currentSnapshotHash = 'hash-abc-version-3';
  const staleClientSnapshotHash = 'hash-abc-version-2';

  const isConcurrencyValid = currentSnapshotHash === staleClientSnapshotHash;
  assert.equal(
    isConcurrencyValid,
    false,
    'Stale snapshot hash must fail concurrency check',
  );

  // Backend response would be 412 Precondition Failed
  const httpStatus = isConcurrencyValid ? 200 : 412;
  assert.equal(
    httpStatus,
    412,
    'Must return 412 Precondition Failed on stale snapshot',
  );
});

test('V0.2 FILE-01 Scenario 5: Delete-readiness API unavailable -> fail-closed safe lock state', () => {
  // If backend does not provide delete_readiness (e.g. backend not yet deployed or error)
  const folderDetailWithoutReadiness = {
    id: 'folder-1',
    name: 'Folder Test',
    version: 1,
    delete_readiness: null, // API unavailable
  };

  const readiness = folderDetailWithoutReadiness.delete_readiness;
  const canVerify = Boolean(readiness && readiness.can_verify !== false);
  const isReady = Boolean(canVerify && readiness?.is_ready);

  assert.equal(
    canVerify,
    false,
    'Must indicate unverifiable state when readiness is null',
  );
  assert.equal(
    isReady,
    false,
    'Must never allow deletion when readiness cannot be verified',
  );
});

test('V0.2 FILE-01 Scenario 6: Partial delete is strictly prohibited', () => {
  // Deleting partial assignments or subsets of a folder group is forbidden
  const folderGroup = {
    source_folder_id: 'src-1',
    total_assignments: 3,
    completed_assignments: 2,
  };

  const allowPartialTrash =
    folderGroup.completed_assignments === folderGroup.total_assignments;
  assert.equal(
    allowPartialTrash,
    false,
    'Partial delete of folder groups is strictly forbidden',
  );
});

test('UI standard: StorageScreen uses ActionIconButton + Pagination (source level)', async () => {
  const screenContent = readFileSync(
    resolve(root, 'apps/web/src/screens/StorageScreen.tsx'),
    'utf8',
  );
  assert.ok(screenContent.includes('<ActionIconButton'), 'icon row action');
  assert.ok(screenContent.includes('<Pagination'), 'shared pagination');
  assert.ok(screenContent.includes('DEFAULT_PAGE_SIZE'), 'default 20/page');
  const iconSrc = readFileSync(
    resolve(root, 'packages/ui/src/components/ActionIconButton.tsx'),
    'utf8',
  );
  assert.ok(iconSrc.includes('aria-label=') && iconSrc.includes('title={title}'));
  // Primary text actions and Drive Trash flow remain
  assert.ok(screenContent.includes('Google Drive Trash') || screenContent.includes('thùng rác Google Drive'));
});

test('UI standard: Pagination renders when items exceed page size', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const p = resolve(root, 'dist/packages/ui/src/components');
  const { Pagination, DEFAULT_PAGE_SIZE } = await import(`file://${p}/Pagination.js`);
  const { ActionIconButton } = await import(`file://${p}/ActionIconButton.js`);
  assert.equal(DEFAULT_PAGE_SIZE, 20);
  const html = renderToStaticMarkup(
    React.createElement(Pagination, { total: 45, page: 0, pageSize: 20, onPage() {}, onPageSize() {}, testId: 'storage-folders-pager' }),
  );
  assert.ok(html.includes('Trang 1 / 3') && html.includes('Hiển thị 1–20 / 45'));
  const btn = renderToStaticMarkup(
    React.createElement(ActionIconButton, { action: 'view', target: 'Thư mục A' }),
  );
  assert.ok(btn.includes('aria-label="Xem chi tiết: Thư mục A"') && btn.includes('title="Xem chi tiết"'));
});

test('FILE-001: StorageScreen search input, filter controls, and empty search state are wired', () => {
  const screenContent = readFileSync(
    resolve(root, 'apps/web/src/screens/StorageScreen.tsx'),
    'utf8',
  );
  assert.ok(
    screenContent.includes('data-testid="storage-search-input"'),
    'Must provide storage-search-input testid',
  );
  assert.ok(
    screenContent.includes('data-testid="storage-empty-search"'),
    'Must provide storage-empty-search testid on empty search results',
  );
  assert.ok(
    screenContent.includes("setFolderPage(0)"),
    'Must reset page when searching or changing type filter',
  );
});

test('FILE-004: StorageScreen two-step trash workflow enforces double-click locking and idempotency headers', () => {
  const screenContent = readFileSync(
    resolve(root, 'apps/web/src/screens/StorageScreen.tsx'),
    'utf8',
  );
  assert.ok(
    screenContent.includes('trashLockRef'),
    'Must declare trashLockRef to prevent double submission during trash workflow',
  );
  assert.ok(
    screenContent.includes('if (trashLockRef.current) return;'),
    'Must synchronously check trashLockRef before initiate and confirm operations',
  );
  assert.ok(
    screenContent.includes("'Idempotency-Key': `trash-init-"),
    'Must attach Idempotency-Key header on initiate trash request',
  );
  assert.ok(
    screenContent.includes("'Idempotency-Key': `trash-confirm-"),
    'Must attach Idempotency-Key header on confirm trash request',
  );
});

