import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('V0.2 WORK-01: route registry, navigation binding, and WorkScreen business rules', async () => {
  const { ROUTE_REGISTRY } = await import(
    `file://${resolve(root, 'dist/apps/web/src/types.js')}`
  );
  const { NAV_ITEMS } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/Navigation.js')}`
  );
  const { matchRoute } = await import(
    `file://${resolve(root, 'dist/apps/web/src/router.js')}`
  );

  // 1. Verify /work route in registry
  const workRoute = ROUTE_REGISTRY['/work'];
  assert.ok(workRoute, 'Work route must exist in ROUTE_REGISTRY');
  assert.equal(workRoute.id, 'UI-WORK-01');
  assert.equal(workRoute.title, 'Quản lý công việc');
  assert.equal(workRoute.implemented, true);
  assert.equal(workRoute.category, 'work');

  // 2. Verify /work/new route in registry (Owner only)
  const workNewRoute = ROUTE_REGISTRY['/work/new'];
  assert.ok(workNewRoute, 'Work new route must exist in ROUTE_REGISTRY');
  assert.equal(workNewRoute.id, 'UI-WORK-02');
  assert.equal(workNewRoute.title, 'Giao việc mới');
  assert.equal(workNewRoute.ownerOnly, true);
  assert.equal(workNewRoute.implemented, true);

  // 3. Verify /work/:id route in registry
  const workDetailRoute = ROUTE_REGISTRY['/work/:id'];
  assert.ok(workDetailRoute, 'Work detail route must exist in ROUTE_REGISTRY');
  assert.equal(workDetailRoute.id, 'UI-WORK-03');
  assert.equal(workDetailRoute.title, 'Chi tiết công việc');
  assert.equal(workDetailRoute.implemented, true);

  // 4. Verify router matching
  const matchWork = matchRoute('/work');
  assert.equal(matchWork.route?.id, 'UI-WORK-01');
  assert.equal(matchWork.isExact, true);

  const matchWorkNew = matchRoute('/work/new');
  assert.equal(matchWorkNew.route?.id, 'UI-WORK-02');
  assert.equal(matchWorkNew.isExact, true);

  const matchWorkDetail = matchRoute('/work/WORK-ITEM-99');
  assert.equal(matchWorkDetail.route?.id, 'UI-WORK-03');
  assert.equal(matchWorkDetail.isExact, false);
  assert.equal(matchWorkDetail.params.id, 'WORK-ITEM-99');

  // 5. Verify NAV_ITEMS
  const workNav = NAV_ITEMS.find((item) => item.id === 'work');
  assert.ok(workNav, 'Work item must exist in NAV_ITEMS');
  assert.equal(workNav.path, '/work');
  assert.equal(workNav.label, 'Công việc');
  assert.equal(workNav.icon, 'work');

  // Both Owner and Staff see Work in Navigation
  const ownerVisible = NAV_ITEMS.filter((item) => {
    if (item.staffOnly || item.id === 'my-pay') return false;
    return true;
  });
  assert.ok(
    ownerVisible.some((i) => i.id === 'work'),
    'Owner sees work in Navigation',
  );

  const staffVisible = NAV_ITEMS.filter((item) => {
    if (item.ownerOnly) return false;
    return true;
  });
  assert.ok(
    staffVisible.some((i) => i.id === 'work'),
    'Staff sees work in Navigation',
  );

  // 6. Verify WorkScreen implementation details
  const screenContent = readFileSync(
    resolve(root, 'apps/web/src/screens/WorkScreen.tsx'),
    'utf8',
  );

  assert.ok(
    screenContent.includes('CẦN LÀM') &&
      screenContent.includes('ĐANG LÀM') &&
      screenContent.includes('CHỜ DUYỆT') &&
      screenContent.includes('HOÀN THÀNH'),
    'Must display 4 KPI status stats',
  );

  assert.ok(
    screenContent.includes('Giao việc mới'),
    'Must allow Owner to navigate to create view',
  );

  assert.ok(
    screenContent.includes('/start'),
    'Must call /start endpoint when Staff starts work',
  );

  assert.ok(
    screenContent.includes('/submissions'),
    'Must call /submissions endpoint when Staff submits work',
  );

  assert.ok(
    screenContent.includes('/reviews') &&
      screenContent.includes('submission_id'),
    'Must send review with submission_id when Owner reviews work',
  );

  assert.ok(
    screenContent.includes('/cancel') &&
      screenContent.includes('Hủy công việc'),
    'Must support Owner cancel work item while preserving history',
  );

  assert.ok(
    screenContent.includes('Duyệt đạt') &&
      screenContent.includes('Yêu cầu sửa lại'),
    'Must support Owner approving or requesting changes',
  );

  assert.ok(
    screenContent.includes('X-CSRF-Token'),
    'Must include CSRF token on mutating requests',
  );

  assert.ok(
    screenContent.includes("headers['If-Match']"),
    'Must include If-Match concurrency guard on mutating requests',
  );

  assert.ok(
    screenContent.includes('setSubmitting(true)') &&
      screenContent.includes('scheduleEntries'),
    'Must guard concurrent form submissions and integrate read-only weekly schedule context',
  );

  assert.ok(
    screenContent.includes('Asia/Ho_Chi_Minh'),
    'Must display timestamps in Asia/Ho_Chi_Minh',
  );
});

test('V0.2 WORK-01: contracts and assignment lifecycle lock', () => {
  const contractContent = readFileSync(
    resolve(root, 'packages/contracts/src/work.ts'),
    'utf8',
  );

  // 1. Assignment lifecycle must be todo, in_progress, in_review, completed
  assert.match(
    contractContent,
    /export type WorkAssignmentStatus\s*=\s*\n?\s*\|?\s*'todo'\s*\|\s*'in_progress'\s*\|\s*'in_review'\s*\|\s*'completed';/,
    'WorkAssignmentStatus must be locked to todo, in_progress, in_review, completed',
  );

  // 2. WorkItemStatus must include cancelled for root item
  assert.match(
    contractContent,
    /export type WorkItemStatus\s*=\s*\n?\s*\|?\s*'todo'\s*\|\s*'in_progress'\s*\|\s*'in_review'\s*\|\s*'completed'\s*\|\s*'cancelled';/,
    'WorkItemStatus must include cancelled for root item',
  );

  // 3. Review decisions must be approved and request_changes
  assert.match(
    contractContent,
    /export type WorkReviewDecision\s*=\s*'approved'\s*\|\s*'request_changes';/,
    'WorkReviewDecision must support approved and request_changes',
  );

  // 4. WorkPriority must include urgent, high, medium, low
  assert.ok(
    contractContent.includes("'urgent'") &&
      contractContent.includes("'high'") &&
      contractContent.includes("'medium'") &&
      contractContent.includes("'low'"),
    'Must define standard priorities',
  );

  // 5. Multiple assignments supported on WorkItemData
  assert.match(
    contractContent,
    /assignments\?: WorkAssignmentData\[\]/,
    'WorkItemData must support multiple assignments',
  );

  // 6. WorkSubmissionData tied to assignment_id
  assert.match(
    contractContent,
    /assignment_id:\s*string;/,
    'WorkSubmissionData must be scoped to assignment_id',
  );

  // 7. StartWorkRequest, SubmitWorkRequest, ReviewWorkRequest, CancelWorkItemRequest defined
  assert.ok(
    contractContent.includes('export interface StartWorkRequest'),
    'Must define StartWorkRequest',
  );
  assert.ok(
    contractContent.includes('export interface SubmitWorkRequest'),
    'Must define SubmitWorkRequest',
  );
  assert.ok(
    contractContent.includes('export interface ReviewWorkRequest'),
    'Must define ReviewWorkRequest',
  );
  assert.ok(
    contractContent.includes('export interface CancelWorkItemRequest'),
    'Must define CancelWorkItemRequest',
  );

  // 8. ReviewWorkRequest requires submission_id (no quick completion without submission)
  assert.match(
    contractContent,
    /submission_id:\s*string;/,
    'ReviewWorkRequest must require submission_id',
  );
});

test('V0.2 WORK-01: strict review guards, If-Match concurrency, and SCOPE-EXT-03 contract lock', () => {
  const docContent = readFileSync(
    resolve(root, 'docs/extensions/SCOPE-EXT-03-WORK-01.md'),
    'utf8',
  );
  const screenContent = readFileSync(
    resolve(root, 'apps/web/src/screens/WorkScreen.tsx'),
    'utf8',
  );

  // 1. SCOPE-EXT-03 is marked OWNER APPROVED — CONTRACT LOCKED
  assert.ok(
    docContent.includes('OWNER APPROVED — CONTRACT LOCKED'),
    'SCOPE-EXT-03 must be marked OWNER APPROVED — CONTRACT LOCKED',
  );

  // 2. Document explicitly specifies strict review without quick completion
  assert.ok(
    docContent.includes('Không duyệt nhanh thiếu submission') ||
      docContent.includes('Không cho phép duyệt nhanh hoàn thành'),
    'SCOPE-EXT-03 must forbid quick completion without submission',
  );

  // 3. Screen requires valid submission before review
  assert.ok(
    screenContent.includes('hasValidSubmission'),
    'WorkScreen must guard canReview with hasValidSubmission',
  );
  assert.ok(
    screenContent.includes('!reviewSubmissionId'),
    'WorkScreen must check reviewSubmissionId exists before submitting review',
  );

  // 4. Concurrency guard If-Match is sent on mutating requests
  assert.ok(
    screenContent.includes(
      'headers[\'If-Match\'] = `"${selectedWorkItem.version}"`',
    ),
    'WorkScreen must pass If-Match on mutation requests',
  );
});

test('WORK-002 & WORK-010: WorkScreen supports status filtering and Owner cancellation with audit trail', () => {
  const screenContent = readFileSync(
    resolve(root, 'apps/web/src/screens/WorkScreen.tsx'),
    'utf8',
  );

  // WORK-002: Status filtering
  assert.ok(
    screenContent.includes('statusFilter'),
    'Must maintain statusFilter state',
  );
  assert.ok(
    screenContent.includes('item.status !== statusFilter'),
    'Must filter items by status',
  );
  assert.ok(
    screenContent.includes('value="todo"'),
    'Must have todo filter option',
  );
  assert.ok(
    screenContent.includes('value="in_progress"'),
    'Must have in_progress filter option',
  );
  assert.ok(
    screenContent.includes('value="completed"'),
    'Must have completed filter option',
  );
  assert.ok(
    screenContent.includes('value="cancelled"'),
    'Must have cancelled filter option',
  );

  // WORK-010: Owner cancel work item with audit reason
  assert.ok(
    screenContent.includes('showCancelModal'),
    'Must have showCancelModal state',
  );
  assert.ok(
    screenContent.includes('cancelReason'),
    'Must have cancelReason state',
  );
  assert.ok(
    screenContent.includes('handleCancelWorkItem'),
    'Must implement handleCancelWorkItem',
  );
  assert.ok(
    screenContent.includes('/api/v1/work-items/${workId}/cancel'),
    'Must POST to cancel endpoint',
  );
  assert.ok(
    screenContent.includes('Lý do hủy'),
    'Must require/prompt cancellation reason',
  );

  // ML-03 & ML-04: Smart Focus filters (Today / Overdue / Blocked / Pending Review), Executor Packet presets, and Evidence drill-down
  assert.ok(
    screenContent.includes('work-ml04-focus-bar'),
    'Must render ML-04 smart focus filter bar',
  );
  assert.ok(
    screenContent.includes('[EXECUTOR:'),
    'Must support ML-03 Executor task packet presets and badge detection',
  );
  assert.ok(
    screenContent.includes('Xem bằng chứng'),
    'Must support ML-04 direct evidence drill-down from work cards',
  );
});

test('v0.9.20 WORK-UX-REDESIGN: smart sorting, 3-section grouping, interactive checklist, and clean Breadcrumb', async () => {
  const helpers = await import(
    `file://${resolve(root, 'dist/apps/web/src/screens/helpers/work-helpers.js')}`
  );
  const { resolveNavigationBreadcrumbs } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/Breadcrumb.js')}`
  );
  const screenContent = readFileSync(
    resolve(root, 'apps/web/src/screens/WorkScreen.tsx'),
    'utf8',
  );

  // 1. Breadcrumb on /work/:id and /work/new must NOT duplicate "Công việc"
  const detailTrail = resolveNavigationBreadcrumbs(
    '/work/6009a634-4b2e-487e-86a9-8fc2d8d6b440',
  );
  assert.deepEqual(
    detailTrail?.items.map((x) => x.label),
    ['Công việc', 'Chi tiết công việc'],
  );
  const newTrail = resolveNavigationBreadcrumbs('/work/new');
  assert.deepEqual(
    newTrail?.items.map((x) => x.label),
    ['Công việc', 'Giao việc mới'],
  );

  // 2. Smart sorting: completed/cancelled NEVER mix above open items; overdue & urgent rank first
  const nowMs = Date.parse('2026-11-11T08:30:00+07:00');
  const sampleItems = [
    {
      id: 'done-recent',
      workspace_id: 'w1',
      title: 'Việc đã xong',
      work_type: 'general',
      status: 'completed',
      priority: 'urgent',
      due_at: '2026-11-10T10:00:00Z',
      created_by: 'u1',
      version: 2,
      created_at: '2026-11-11T01:00:00Z',
      updated_at: '2026-11-11T01:10:00Z',
    },
    {
      id: 'normal-tomorrow',
      workspace_id: 'w1',
      title: 'Việc ngày mai P3',
      work_type: 'general',
      status: 'todo',
      priority: 'medium',
      due_at: '2026-11-12T10:00:00Z',
      created_by: 'u1',
      version: 1,
      created_at: '2026-11-11T01:00:00Z',
      updated_at: '2026-11-11T01:00:00Z',
    },
    {
      id: 'overdue-p2',
      workspace_id: 'w1',
      title: 'Việc quá hạn',
      work_type: 'general',
      status: 'in_progress',
      priority: 'high',
      due_at: '2026-11-10T10:00:00Z',
      created_by: 'u1',
      version: 1,
      created_at: '2026-11-10T01:00:00Z',
      updated_at: '2026-11-10T01:00:00Z',
    },
    {
      id: 'today-p1',
      workspace_id: 'w1',
      title: 'Việc hôm nay khẩn cấp',
      work_type: 'video',
      status: 'todo',
      priority: 'urgent',
      due_at: '2026-11-11T10:00:00Z',
      created_by: 'u1',
      version: 1,
      created_at: '2026-11-11T00:30:00Z',
      updated_at: '2026-11-11T00:30:00Z',
    },
  ];

  const sorted = [...sampleItems].sort((a, b) =>
    helpers.compareWorkItems(a, b, 'smart', nowMs),
  );
  assert.deepEqual(
    sorted.map((x) => x.id),
    ['overdue-p2', 'today-p1', 'normal-tomorrow', 'done-recent'],
  );
  assert.equal(helpers.classifyWorkSection(sorted[0], nowMs), 'attention');
  assert.equal(helpers.classifyWorkSection(sorted[1], nowMs), 'attention');
  assert.equal(helpers.classifyWorkSection(sorted[2], nowMs), 'active');
  assert.equal(helpers.classifyWorkSection(sorted[3], nowMs), 'closed');

  // 3. Checklist parser & toggler preserve [AtlasRef:...] and plain notes
  const rawDesc =
    '- [ ] Test 1\n- [x] Test 2\n- [ ] Test 3\nGhi chú riêng cho nhân sự\n\n[AtlasRef:atlas-999]';
  const parsed = helpers.parseWorkDescriptionChecklist(rawDesc);
  assert.equal(parsed.totalCount, 3);
  assert.equal(parsed.completedCount, 1);
  assert.equal(parsed.atlasRef, 'atlas-999');
  assert.equal(parsed.cleanNotes, 'Ghi chú riêng cho nhân sự');

  const toggled = helpers.toggleChecklistItemInDescription(rawDesc, 0, true);
  assert.ok(toggled.includes('- [x] Test 1'));
  assert.ok(toggled.includes('[AtlasRef:atlas-999]'));

  const appended = helpers.appendChecklistItemToDescription(toggled, 'Test 4');
  const reparsed = helpers.parseWorkDescriptionChecklist(appended);
  assert.equal(reparsed.totalCount, 4);
  assert.equal(reparsed.checklistItems[3].text, 'Test 4');
  assert.equal(reparsed.atlasRef, 'atlas-999');

  // 4. Redesigned UI testids & capabilities exist in WorkScreen.tsx
  assert.ok(screenContent.includes('work-detail-summary-grid'));
  assert.ok(screenContent.includes('work-detail-checklist'));
  assert.ok(screenContent.includes('work-sort-select'));
  assert.ok(screenContent.includes('work-toggle-closed-section'));
  assert.ok(screenContent.includes('btn-edit-work-item'));
});
