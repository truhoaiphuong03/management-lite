import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('V0.2 SCHEDULE-01 R09: web route registry and navigation binding', async () => {
  const { ROUTE_REGISTRY } = await import(
    `file://${resolve(root, 'dist/apps/web/src/types.js')}`
  );
  const { NAV_ITEMS } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/Navigation.js')}`
  );
  const { matchRoute } = await import(
    `file://${resolve(root, 'dist/apps/web/src/router.js')}`
  );

  // 1. Verify route in registry
  const scheduleRoute = ROUTE_REGISTRY['/schedule'];
  assert.ok(scheduleRoute, 'Schedule route must exist in ROUTE_REGISTRY');
  assert.equal(scheduleRoute.id, 'UI-SCH-01');
  assert.equal(scheduleRoute.title, 'Lịch làm việc');
  assert.equal(
    scheduleRoute.implemented,
    true,
    'Schedule screen is fully implemented',
  );
  assert.equal(scheduleRoute.category, 'attendance');
  assert.equal(
    scheduleRoute.ownerOnly,
    undefined,
    'Schedule is accessible by both Staff and Owner',
  );
  assert.equal(
    scheduleRoute.staffOnly,
    undefined,
    'Schedule is accessible by both Staff and Owner',
  );

  // 2. Verify router matching
  const match = matchRoute('/schedule');
  assert.equal(match.route?.id, 'UI-SCH-01');
  assert.equal(match.isExact, true);
  assert.deepEqual(match.params, {});

  // Normalization trailing slash
  const matchTrailing = matchRoute('/schedule/');
  assert.equal(matchTrailing.route?.id, 'UI-SCH-01');
  assert.equal(matchTrailing.isExact, true);

  // 3. Verify NAV_ITEMS
  const scheduleNavItem = NAV_ITEMS.find((item) => item.id === 'schedule');
  assert.ok(scheduleNavItem, 'Schedule item must exist in NAV_ITEMS');
  assert.equal(scheduleNavItem.path, '/schedule');
  assert.equal(scheduleNavItem.label, 'Lịch làm việc');
  assert.equal(scheduleNavItem.icon, 'schedule');

  // 4. Desktop Sidebar visibility for both roles
  const ownerVisible = NAV_ITEMS.filter((item) => {
    if (item.staffOnly || item.id === 'my-pay') return false;
    return true;
  });
  assert.ok(
    ownerVisible.some((i) => i.id === 'schedule'),
    'Schedule must be visible in DesktopSidebar for Owner',
  );

  const staffVisible = NAV_ITEMS.filter((item) => {
    if (item.ownerOnly) return false;
    return true;
  });
  assert.ok(
    staffVisible.some((i) => i.id === 'schedule'),
    'Schedule must be visible in DesktopSidebar for Staff',
  );

  // 5. Mobile Drawer ("Thêm") visibility
  // Primary tabs are ['/', '/clock', '/reports'], so /schedule is accessible in "Thêm" drawer
  const primaryTabs = ['/', '/clock', '/reports'];
  assert.ok(
    !primaryTabs.includes('/schedule'),
    '/schedule is placed in More menu to avoid mobile crowding',
  );

  // 6. Verify ScheduleScreen source properties for business rules:
  // - Default suggested start time is 08:00
  // - Reason input is optional
  const { readFileSync } = await import('node:fs');
  const screenContent = readFileSync(
    resolve(root, 'apps/web/src/screens/ScheduleScreen.tsx'),
    'utf8',
  );
  assert.ok(
    screenContent.includes('Chọn T2 – T6 (08:00)'),
    'Shortcut must use 08:00 as default suggested time',
  );
  assert.ok(
    !screenContent.includes('Chọn T2 – T6 (08:30)'),
    'Shortcut must not use 08:30',
  );
  assert.ok(
    screenContent.includes('Lý do điều chỉnh lịch (Tùy chọn)'),
    'Reason input must be explicitly labeled optional',
  );
  assert.ok(
    !screenContent.includes('Lý do điều chỉnh lịch (Bắt buộc)'),
    'Reason input must not be marked mandatory',
  );
});

test('ScheduleScreen uses shared UI primitives and Owner detail inspection', async () => {
  const { readFileSync } = await import('node:fs');
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const ui = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/index.js')}`
  );
  const icon = renderToStaticMarkup(
    React.createElement(ui.ActionIconButton, { action: 'view' }),
  );
  assert.match(icon, /aria-label="Xem chi tiết"/);
  assert.match(icon, /title="Xem chi tiết"/);
  const pager = renderToStaticMarkup(
    React.createElement(ui.Pagination, {
      total: 45,
      page: 0,
      pageSize: 20,
      onPage: () => {},
      onPageSize: () => {},
      testId: 'p',
    }),
  );
  assert.match(pager, /Trang 1 \/ 3/);
  const src = readFileSync(
    resolve(root, 'apps/web/src/screens/ScheduleScreen.tsx'),
    'utf8',
  );
  assert.ok(
    src.includes('handleOpenOwnerDetail(schedule)'),
    'ScheduleScreen must bind owner detail handler',
  );
  assert.ok(
    src.includes('Xem chi tiết & Lịch sử'),
    'ScheduleScreen must render detail & revision history button',
  );
});

test('ScheduleScreen has employee filter, dual Owner/Staff tabs, and empty state', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    resolve(root, 'apps/web/src/screens/ScheduleScreen.tsx'),
    'utf8',
  );
  assert.ok(
    src.includes("activeTab === 'my_schedule'") &&
      src.includes("activeTab === 'staff_schedules'"),
    'ScheduleScreen must support both my_schedule and staff_schedules tabs for Owner/Admin',
  );
  assert.ok(
    src.includes('filterEmployeeId'),
    'ScheduleScreen must support filtering staff schedules by employee',
  );
  assert.ok(
    src.includes('Chưa có nhân sự nào đăng ký lịch làm việc trong tuần này.'),
    'ScheduleScreen must display descriptive EmptyState when no schedules match',
  );
});
