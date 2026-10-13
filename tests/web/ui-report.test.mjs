import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';

const root = resolve(process.cwd());

test('UI-REPORT-01: getModuleNameFromPath mapping and ReportBugWidget markup', async () => {
  const { getModuleNameFromPath, ReportBugWidget } = await import(
    `file://${resolve(root, 'dist/apps/web/src/components/ReportBugWidget.js')}`
  );

  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');

  // 1. Path to module name mapping
  assert.equal(getModuleNameFromPath('/'), 'Tổng quan (Dashboard)');
  assert.equal(getModuleNameFromPath(''), 'Tổng quan (Dashboard)');
  assert.equal(getModuleNameFromPath('/work'), 'Công việc (Work)');
  assert.equal(getModuleNameFromPath('/work/123'), 'Công việc (Work)');
  assert.equal(getModuleNameFromPath('/storage'), 'Kho lưu trữ (Storage)');
  assert.equal(getModuleNameFromPath('/payroll'), 'Bảng lương (Payroll)');
  assert.equal(getModuleNameFromPath('/my-pay'), 'Bảng lương (Payroll)');
  assert.equal(getModuleNameFromPath('/clock'), 'Chấm công (Clock)');
  assert.equal(getModuleNameFromPath('/schedule'), 'Lịch làm việc (Schedule)');
  assert.equal(getModuleNameFromPath('/reports'), 'Báo cáo chấm công (Reports)');
  assert.equal(getModuleNameFromPath('/employees'), 'Nhân sự (Employees)');
  assert.equal(getModuleNameFromPath('/accounts'), 'Tài khoản liên kết (Accounts)');
  assert.equal(getModuleNameFromPath('/audit'), 'Nhật ký kiểm toán (Audit)');
  assert.equal(getModuleNameFromPath('/settings'), 'Cài đặt hệ thống (Settings)');
  assert.equal(getModuleNameFromPath('/issues'), 'Báo lỗi & Góp ý (Issues)');
  assert.equal(getModuleNameFromPath('/custom-unknown'), '/custom-unknown');

  // 2. ReportBugWidget initial markup renders floating button
  const html = renderToStaticMarkup(
    React.createElement(ReportBugWidget, {
      currentPath: '/work',
      csrfToken: 'test-csrf-token',
    }),
  );

  assert.ok(html.includes('data-testid="btn-open-report-bug"'), 'Must render floating button');
  assert.ok(html.includes('Báo lỗi'), 'Must display "Báo lỗi" text');
  assert.ok(html.includes('btn-floating-report-bug'), 'Must have responsive class');
  assert.equal(html.includes('data-testid="report-bug-modal-overlay"'), false, 'Modal should not be open by default');
});

test('UI-REPORT-01: AppShell integrates ReportBugWidget for both Owner and Staff', async () => {
  const { AppShell } = await import(
    `file://${resolve(root, 'dist/apps/web/src/AppShell.js')}`
  );

  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');

  // Test Owner view
  const ownerHtml = renderToStaticMarkup(
    React.createElement(
      AppShell,
      {
        currentPath: '/work',
        onNavigate: () => {},
        role: 'owner',
        isOwnerVerified: true,
        csrfToken: 'owner-csrf',
      },
      React.createElement('div', { id: 'inner-screen-content' }, 'Nội dung trang công việc'),
    ),
  );

  assert.ok(ownerHtml.includes('data-testid="btn-open-report-bug"'), 'Owner AppShell must include floating Báo lỗi button');
  assert.ok(ownerHtml.includes('id="inner-screen-content"'), 'Must preserve in-page screen content');
  assert.ok(ownerHtml.includes('Nội dung trang công việc'));

  // Test Staff view
  const staffHtml = renderToStaticMarkup(
    React.createElement(
      AppShell,
      {
        currentPath: '/work',
        onNavigate: () => {},
        role: 'staff',
        isOwnerVerified: false,
        csrfToken: 'staff-csrf',
      },
      React.createElement('div', { id: 'staff-screen-content' }, 'Màn hình nhân viên làm việc'),
    ),
  );

  assert.ok(staffHtml.includes('data-testid="btn-open-report-bug"'), 'Staff AppShell must also include floating Báo lỗi button');
  assert.ok(staffHtml.includes('id="staff-screen-content"'), 'Must preserve Staff in-page screen content');
  assert.ok(staffHtml.includes('Màn hình nhân viên làm việc'));
});
