import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('UI-SHELL-02 — Phương án A: 5-Group Navigation Architecture and RBAC', async (t) => {
  const {
    NAV_GROUPS,
    NAV_ITEMS,
    DesktopSidebar,
    MobileBottomNav,
    isGroupActiveForPath,
  } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/Navigation.js')}`
  );
  const { GroupOverviewScreen } = await import(
    `file://${resolve(root, 'dist/apps/web/src/screens/GroupOverviewScreen.js')}`
  );
  const { ROUTE_REGISTRY } = await import(
    `file://${resolve(root, 'dist/apps/web/src/types.js')}`
  );
  const { matchRoute } = await import(
    `file://${resolve(root, 'dist/apps/web/src/router.js')}`
  );

  // 1. Navigation Groups Specification (including independent finance and accounts groups)
  await t.test(
    '1. NAV_GROUPS defines the approved groups including independent finance and accounts',
    () => {
      assert.ok(NAV_ITEMS.length > 0, 'NAV_ITEMS must contain items');
      assert.equal(NAV_GROUPS.length, 8, 'Must define 8 groups including print-quotes');
      const groupIds = NAV_GROUPS.map((g) => g.id);
      assert.deepEqual(
        groupIds,
        [
          'overview',
          'work',
          'attendance',
          'hr-payroll',
          'accounts',
          'finance',
          'print-quotes',
          'admin',
        ],
        'Groups must match approved order including Báo giá in ấn',
      );
      const groupTitles = NAV_GROUPS.map((g) => g.title);
      assert.deepEqual(groupTitles, [
        'Tổng quan',
        'Công việc',
        'Chấm công',
        'Nhân sự',
        'Tài khoản',
        'Thu chi',
        'Báo giá in ấn',
        'Quản trị',
      ]);
    },
  );

  // 2. DesktopSidebar: rendering and RBAC
  await t.test('2. DesktopSidebar renders buttons and respects RBAC', () => {
    // Owner view
    const ownerHtml = renderToStaticMarkup(
      React.createElement(DesktopSidebar, {
        currentPath: '/',
        onNavigate: () => {},
        role: 'owner',
        isOwnerVerified: true,
      }),
    );
    assert.ok(ownerHtml.includes('Tổng quan'), 'Must render Tổng quan');
    assert.ok(ownerHtml.includes('Chấm công'), 'Must render Chấm công');
    assert.ok(ownerHtml.includes('Công việc'), 'Must render Công việc');
    assert.ok(ownerHtml.includes('Nhân sự'), 'Must render Nhân sự');
    assert.ok(
      ownerHtml.includes('Tài khoản'),
      'Owner sidebar must include Tài khoản',
    );
    assert.ok(
      ownerHtml.includes('Thu chi'),
      'Owner sidebar must include Thu chi',
    );
    assert.ok(ownerHtml.includes('Quản trị'), 'Must render Quản trị');
    assert.ok(
      ownerHtml.includes('Sổ tay lỗi'),
      'Owner sidebar must include Sổ tay lỗi in title tooltip/accessibility',
    );

    // Staff view
    const staffHtml = renderToStaticMarkup(
      React.createElement(DesktopSidebar, {
        currentPath: '/',
        onNavigate: () => {},
        role: 'staff',
        isOwnerVerified: false,
      }),
    );
    assert.equal(
      staffHtml.includes('Thu chi'),
      false,
      'Staff sidebar must NEVER render Thu chi',
    );
    assert.equal(
      staffHtml.includes('Sổ tay lỗi'),
      false,
      'Staff sidebar must NEVER render or preview Sổ tay lỗi',
    );
    assert.equal(
      staffHtml.includes('Nhật ký Audit'),
      false,
      'Staff sidebar must NEVER preview Nhật ký Audit',
    );
    assert.equal(
      staffHtml.includes('Tài khoản'),
      false,
      'Staff sidebar must NEVER preview Tài khoản',
    );

    // Active path detection for detail and child routes
    const itemMap = new Map(NAV_ITEMS.map((i) => [i.id, i]));
    const adminGroup = NAV_GROUPS.find((g) => g.id === 'admin');
    const finGroup = NAV_GROUPS.find((g) => g.id === 'finance');
    assert.ok(adminGroup, 'Admin group exists');
    assert.ok(finGroup, 'Finance group exists');
    assert.equal(
      isGroupActiveForPath('/issues/ISS-001', adminGroup, itemMap),
      true,
      'Admin group active on issue detail',
    );
    assert.equal(
      isGroupActiveForPath('/issues', adminGroup, itemMap),
      true,
      'Admin group active on issue list',
    );
    assert.equal(
      isGroupActiveForPath('/groups/admin', adminGroup, itemMap),
      true,
      'Admin group active on group hub',
    );
    assert.equal(
      isGroupActiveForPath('/clock', adminGroup, itemMap),
      false,
      'Admin group inactive on clock',
    );
    assert.equal(
      isGroupActiveForPath('/finance', finGroup, itemMap),
      true,
      'Finance group active on /finance',
    );
    assert.equal(
      isGroupActiveForPath('/finance/history', finGroup, itemMap),
      true,
      'Finance group active on history',
    );
    assert.equal(
      isGroupActiveForPath('/finance', adminGroup, itemMap),
      false,
      'Admin group inactive on /finance',
    );
  });

  // 3. MobileBottomNav: shares group structure and respects RBAC
  await t.test(
    '3. MobileBottomNav renders groups and respects RBAC on mobile',
    () => {
      const ownerMobileHtml = renderToStaticMarkup(
        React.createElement(MobileBottomNav, {
          currentPath: '/',
          onNavigate: () => {},
          role: 'owner',
          isOwnerVerified: true,
        }),
      );
      assert.ok(ownerMobileHtml.includes('Tổng quan'));
      assert.ok(ownerMobileHtml.includes('Chấm công'));
      assert.ok(ownerMobileHtml.includes('Công việc'));
      assert.ok(ownerMobileHtml.includes('Nhân sự'));
      assert.ok(ownerMobileHtml.includes('Tài khoản'));
      assert.ok(ownerMobileHtml.includes('Thu chi'));
      assert.ok(ownerMobileHtml.includes('Quản trị'));

      const staffMobileHtml = renderToStaticMarkup(
        React.createElement(MobileBottomNav, {
          currentPath: '/',
          onNavigate: () => {},
          role: 'staff',
          isOwnerVerified: false,
        }),
      );
      assert.equal(
        staffMobileHtml.includes('Thu chi'),
        false,
        'Staff mobile nav must NEVER render Thu chi',
      );
    },
  );

  // 4. GroupOverviewScreen: Card-based sub-function overview
  await t.test(
    '4. GroupOverviewScreen renders child cards with canonical status & RBAC',
    () => {
      // Owner Admin Group: Audit, System Logs, Issues, Settings (Accounts moved to top-level sidebar)
      const ownerAdminHtml = renderToStaticMarkup(
        React.createElement(GroupOverviewScreen, {
          groupId: 'admin',
          role: 'owner',
          isOwnerVerified: true,
          onNavigate: () => {},
        }),
      );
      assert.equal(
        ownerAdminHtml.includes('Tài khoản dùng chung'),
        false,
        'Accounts is now a top-level sidebar item, not inside Admin',
      );
      assert.ok(ownerAdminHtml.includes('Nhật ký Audit'));
      assert.ok(ownerAdminHtml.includes('Sổ tay lỗi'));
      assert.ok(ownerAdminHtml.includes('Cài đặt'));
      // REFINEMENT-53: Do not attach "Khả dụng" badge on every card
      assert.equal(
        ownerAdminHtml.includes('Khả dụng'),
        false,
        'Do not show Khả dụng badge on cards',
      );
      // REFINEMENT-53: Remove large "Truy cập" button
      assert.equal(
        ownerAdminHtml.includes('Truy cập'),
        false,
        'No large Truy cập button',
      );
      // REFINEMENT-53: Remove internal codes
      assert.equal(ownerAdminHtml.includes('UI-WORK-01'), false);
      assert.equal(ownerAdminHtml.includes('UI08'), false);
      assert.equal(ownerAdminHtml.includes('/accounts'), false);

      // Staff Admin Group: only Settings
      const staffAdminHtml = renderToStaticMarkup(
        React.createElement(GroupOverviewScreen, {
          groupId: 'admin',
          role: 'staff',
          isOwnerVerified: false,
          onNavigate: () => {},
        }),
      );
      assert.ok(staffAdminHtml.includes('Cài đặt'));
      assert.equal(
        staffAdminHtml.includes('Tài khoản dùng chung'),
        false,
        'Staff cannot see Accounts',
      );
      assert.equal(
        staffAdminHtml.includes('Nhật ký Audit'),
        false,
        'Staff cannot see Audit',
      );
      assert.equal(
        staffAdminHtml.includes('Sổ tay lỗi'),
        false,
        'Staff cannot see Issues',
      );

      // Attendance Group: all 4 items (Chấm công, Lịch làm việc, Lịch sử công, Duyệt công) are implemented & dispatched
      const attendanceHtml = renderToStaticMarkup(
        React.createElement(GroupOverviewScreen, {
          groupId: 'attendance',
          role: 'owner',
          isOwnerVerified: true,
          onNavigate: () => {},
        }),
      );
      assert.ok(attendanceHtml.includes('Chấm công'));
      assert.ok(attendanceHtml.includes('Lịch làm việc'));
      assert.ok(attendanceHtml.includes('Lịch sử công'));
      assert.ok(attendanceHtml.includes('Duyệt công'));
      assert.equal(
        attendanceHtml.includes('Chưa triển khai'),
        false,
        'All attendance group items are implemented and must not show Chưa triển khai',
      );

      // HR-Payroll: Owner can access Employees directly
      const hrHtml = renderToStaticMarkup(
        React.createElement(GroupOverviewScreen, {
          groupId: 'hr-payroll',
          role: 'owner',
          isOwnerVerified: true,
          onNavigate: () => {},
        }),
      );
      assert.ok(hrHtml.includes('Nhân sự'), 'Owner sees Nhân sự card');
      assert.ok(hrHtml.includes('Bảng lương'), 'Owner sees Bảng lương card');
      assert.equal(
        hrHtml.includes('Chưa triển khai'),
        false,
        'Dispatched items like Employees must not be locked as Chưa triển khai',
      );
    },
  );

  // 5. Router and Route Registry Mapping
  await t.test('5. Router matches /groups/:groupId dynamically', () => {
    assert.ok(
      ROUTE_REGISTRY['/groups/:groupId'],
      'ROUTE_REGISTRY must register /groups/:groupId',
    );
    const match = matchRoute('/groups/attendance');
    assert.equal(match.isExact, false);
    assert.ok(match.route, 'Must match dynamic route');
    assert.equal(match.route?.id, 'UI-GROUP-HUB');
    assert.equal(match.params['groupId'], 'attendance');

    const matchAdmin = matchRoute('/groups/admin');
    assert.equal(matchAdmin.params['groupId'], 'admin');
  });
});
