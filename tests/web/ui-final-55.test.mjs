import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('UI-FINAL-55 — Unified Breadcrumb, ListFooter, RBAC & Reports Pagination', async (t) => {
  const { resolveNavigationBreadcrumbs, Breadcrumb } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/Breadcrumb.js')}`
  );
  const { ListFooter } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/ListFooter.js')}`
  );
  const { GroupOverviewScreen } = await import(
    `file://${resolve(root, 'dist/apps/web/src/screens/GroupOverviewScreen.js')}`
  );
  const { ReportsService } = await import(
    `file://${resolve(root, 'dist/apps/api/src/reports/service.js')}`
  );

  // 1. Unified Breadcrumb & Deterministic Parent Routing
  await t.test('1. resolveNavigationBreadcrumbs resolves exact hierarchy and deterministic parent', () => {
    // Root has no breadcrumbs
    assert.equal(resolveNavigationBreadcrumbs('/'), null);

    // Group overview route
    const adminGroup = resolveNavigationBreadcrumbs('/groups/admin');
    assert.ok(adminGroup);
    assert.deepEqual(adminGroup.items, [
      { label: 'Tổng quan', path: '/' },
      { label: 'Quản trị' },
    ]);
    assert.equal(adminGroup.parentPath, '/');
    assert.equal(adminGroup.parentLabel, 'Tổng quan');

    // Function route: Group > Function
    const clock = resolveNavigationBreadcrumbs('/clock');
    assert.ok(clock);
    assert.deepEqual(clock.items, [
      { label: 'Chấm công', path: '/groups/attendance' },
      { label: 'Chấm công' },
    ]);
    assert.equal(clock.parentPath, '/groups/attendance');
    assert.equal(clock.parentLabel, 'Chấm công');

    const issues = resolveNavigationBreadcrumbs('/issues');
    assert.ok(issues);
    assert.deepEqual(issues.items, [
      { label: 'Quản trị', path: '/groups/admin' },
      { label: 'Sổ tay lỗi' },
    ]);
    assert.equal(issues.parentPath, '/groups/admin');

    const employees = resolveNavigationBreadcrumbs('/employees');
    assert.ok(employees);
    assert.deepEqual(employees.items, [
      { label: 'Nhân sự', path: '/groups/hr-payroll' },
      { label: 'Nhân sự' },
    ]);
    assert.equal(employees.parentPath, '/groups/hr-payroll');

    // Detail route: Group > List > Current
    const issueDetail = resolveNavigationBreadcrumbs('/issues/ISS-001');
    assert.ok(issueDetail);
    assert.deepEqual(issueDetail.items, [
      { label: 'Quản trị', path: '/groups/admin' },
      { label: 'Sổ tay lỗi', path: '/issues' },
      { label: 'Chi tiết ISS-001' },
    ]);
    assert.equal(issueDetail.parentPath, '/issues');
    assert.equal(issueDetail.parentLabel, 'Sổ tay lỗi');

    const employeeNew = resolveNavigationBreadcrumbs('/employees/new');
    assert.ok(employeeNew);
    assert.deepEqual(employeeNew.items, [
      { label: 'Nhân sự & Lương', path: '/groups/hr-payroll' },
      { label: 'Nhân sự', path: '/employees' },
      { label: 'Thêm nhân viên' },
    ]);
    assert.equal(employeeNew.parentPath, '/employees');
    assert.equal(employeeNew.parentLabel, 'Nhân sự');
  });

  // 2. Breadcrumb Component React Rendering
  await t.test('2. Breadcrumb renders desktop trail and mobile back button with >=44px hit-target', () => {
    const html = renderToStaticMarkup(
      React.createElement(Breadcrumb, {
        currentPath: '/issues/ISS-002',
        onNavigate: () => {},
      }),
    );
    // Desktop trail
    assert.ok(html.includes('Quản trị'), 'Must include Group link');
    assert.ok(html.includes('Sổ tay lỗi'), 'Must include List link');
    assert.ok(html.includes('Chi tiết ISS-002'), 'Must include current item');
    assert.ok(html.includes('aria-current="page"'), 'Must set aria-current="page" on current item');

    // Mobile back button
    assert.ok(html.includes('mobile-breadcrumb-back'), 'Must have mobile back wrapper');
    assert.ok(html.includes('min-height:44px'), 'Mobile back button must have >= 44px min-height');
    assert.ok(html.includes('min-width:44px'), 'Mobile back button must have >= 44px min-width');
    assert.ok(html.includes('Quay lại Sổ tay lỗi'), 'Mobile back button aria-label');
  });

  // 3. ListFooter Presentation (Exact total, unknown total, empty)
  await t.test('3. ListFooter formats exact total, unknown total, and empty counts accurately', () => {
    // 3A. Exact total known: "1–10 / 2.653" + "‹ Trước", "Sau ›"
    const totalHtml = renderToStaticMarkup(
      React.createElement(ListFooter, {
        itemCount: 10,
        totalCount: 2653,
        currentPage: 1,
        pageSize: 10,
        hasPrevPage: false,
        hasNextPage: true,
        onPrevPage: () => {},
        onNextPage: () => {},
      }),
    );
    assert.ok(totalHtml.includes('1–10 / 2.653') || totalHtml.includes('1–10 / 2,653'), 'Must format exact range and thousands total');
    assert.ok(totalHtml.includes('‹ Trước'), 'Must include Prev button');
    assert.ok(totalHtml.includes('Sau ›'), 'Must include Next button');

    // 3B. Unknown total: "Đang hiển thị N mục" + "Tải thêm"
    const appendHtml = renderToStaticMarkup(
      React.createElement(ListFooter, {
        itemCount: 25,
        hasNextPage: true,
        onLoadMore: () => {},
        loadMoreLabel: 'Tải thêm báo cáo',
      }),
    );
    assert.ok(appendHtml.includes('Đang hiển thị 25 mục'), 'Must display active item count');
    assert.ok(appendHtml.includes('Tải thêm báo cáo'), 'Must display load more button');

    // 3C. Empty state: "0 mục" (never "1–0 / 0")
    const emptyHtml = renderToStaticMarkup(
      React.createElement(ListFooter, {
        itemCount: 0,
        totalCount: 0,
      }),
    );
    assert.ok(emptyHtml.includes('0 mục'), 'Must display 0 mục on empty');
    assert.equal(emptyHtml.includes('1–0'), false, 'Must never display inverted range');
  });

  // 4. RBAC Group Navigation Verification (Staff /my-pay, Staff /settings, Owner /employees)
  await t.test('4. GroupOverviewScreen RBAC respects Staff /my-pay, Staff /settings, and Owner /employees', () => {
    // Staff in hr-payroll
    const staffHrHtml = renderToStaticMarkup(
      React.createElement(GroupOverviewScreen, {
        groupId: 'hr-payroll',
        role: 'staff',
        onNavigate: () => {},
      }),
    );
    assert.ok(staffHrHtml.includes('Lương cá nhân'), 'Staff must see Lương cá nhân in hr-payroll');
    assert.equal(staffHrHtml.includes('Quản lý danh sách nhân sự'), false, 'Staff must NOT see Employees');

    // Staff in admin
    const staffAdminHtml = renderToStaticMarkup(
      React.createElement(GroupOverviewScreen, {
        groupId: 'admin',
        role: 'staff',
        onNavigate: () => {},
      }),
    );
    assert.ok(staffAdminHtml.includes('Cài đặt'), 'Staff must see Cài đặt in admin');
    assert.equal(staffAdminHtml.includes('Sổ tay lỗi'), false, 'Staff must NOT see Issues');
    assert.equal(staffAdminHtml.includes('Nhật ký kiểm toán'), false, 'Staff must NOT see Audit');

    // Owner in hr-payroll
    const ownerHrHtml = renderToStaticMarkup(
      React.createElement(GroupOverviewScreen, {
        groupId: 'hr-payroll',
        role: 'owner',
        onNavigate: () => {},
      }),
    );
    assert.ok(ownerHrHtml.includes('Nhân sự'), 'Owner must see Nhân sự in hr-payroll');
    assert.ok(ownerHrHtml.includes('Bảng lương'), 'Owner must see Bảng lương in hr-payroll');
  });

  // 5. ReportsService Real Microsecond Preservation & Validation
  await t.test('5. ReportsService real service validates cursor and handles adjacent microsecond timestamps', async () => {
    let capturedQuery = '';
    let capturedParams = [];

    const mockPool = {
      query: async (queryText, params) => {
        capturedQuery = String(queryText);
        capturedParams = params || [];
        // Simulate query result with adjacent microsecond timestamps
        return {
          rows: [
            {
              id: 'a0000000-0000-0000-0000-000000000001',
              report_date: '2026-10-10',
              created_at: '2026-10-10 12:00:00.123456+00',
              employee_name: 'Nguyen Van A',
              status: 'submitted',
              current_revision: 1,
              version: 1,
              notes: 'First row',
              entries_count: 2,
              total_reported_count: 5,
            },
            {
              id: 'a0000000-0000-0000-0000-000000000002',
              report_date: '2026-10-10',
              created_at: '2026-10-10 12:00:00.123455+00',
              employee_name: 'Nguyen Van B',
              status: 'submitted',
              current_revision: 1,
              version: 1,
              notes: 'Second row (1 microsecond apart)',
              entries_count: 1,
              total_reported_count: 2,
            },
          ],
        };
      },
    };

    const service = new ReportsService(mockPool);

    // Rejection of non-calendar date 2026-02-30
    const fakeDateCursor = Buffer.from(
      JSON.stringify({
        report_date: '2026-02-30',
        created_at: '2026-02-30T12:00:00.000Z',
        id: 'a0000000-0000-0000-0000-000000000001',
      }),
    ).toString('base64url');

    const ownerContext = {
      workspace: { id: 'w0000000-0000-0000-0000-000000000001', name: 'Test WS', role: 'owner' },
      user: { id: 'u0000000-0000-0000-0000-000000000001', email: 'owner@test.com' },
    };

    await assert.rejects(
      async () => {
        await service.listDailyReports(ownerContext, { cursor: fakeDateCursor });
      },
      (err) => {
        assert.equal(err.code, 'INVALID_CURSOR');
        assert.equal(err.statusCode, 400);
        return true;
      },
      'Must reject non-calendar date 2026-02-30 with 400 INVALID_CURSOR',
    );

    // Valid cursor with microseconds
    const validMicrosecondCursor = Buffer.from(
      JSON.stringify({
        report_date: '2026-10-10',
        created_at: '2026-10-10 12:00:00.123456+00',
        id: 'a0000000-0000-0000-0000-000000000001',
      }),
    ).toString('base64url');

    const result = await service.listDailyReports(ownerContext, {
      cursor: validMicrosecondCursor,
      limit: 10,
    });

    assert.ok(result.items.length > 0, 'Must return rows');
    assert.ok(capturedQuery.includes('(r.report_date, r.created_at, r.id) < ($'), 'Query must use tuple comparison');
    assert.ok(capturedParams.includes('2026-10-10 12:00:00.123456+00'), 'Must pass exact microsecond timestamp parameter');
  });
});
