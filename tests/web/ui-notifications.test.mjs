import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('UI NOTIFICATION HARMONIZATION — AppToast, AppDialog, and Complete Native Dialog Elimination', async (t) => {
  const { AppToast, AppDialog } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/index.js')}`
  );

  // 1. AppToast rendering, accessibility roles, and styling
  await t.test('1. AppToast renders accessible toast banner with role="alert" for errors and role="status" for info', () => {
    // Error variant
    const errorHtml = renderToStaticMarkup(
      React.createElement(AppToast, {
        message: 'Lỗi tải dữ liệu kiểm tra',
        variant: 'error',
        onClose: () => {},
      }),
    );
    assert.ok(errorHtml.includes('role="alert"'), 'Error toast must render role="alert"');
    assert.ok(errorHtml.includes('aria-live="assertive"'), 'Error toast must be assertive');
    assert.ok(errorHtml.includes('Lỗi tải dữ liệu kiểm tra'), 'Toast must display message');
    assert.ok(errorHtml.includes('aria-label="Đóng thông báo"'), 'Dismiss button must have accessible label');

    // Success variant
    const successHtml = renderToStaticMarkup(
      React.createElement(AppToast, {
        message: 'Đã sao chép liên kết mời thành công',
        variant: 'success',
        onClose: () => {},
      }),
    );
    assert.ok(successHtml.includes('role="status"'), 'Success toast must render role="status"');
    assert.ok(successHtml.includes('aria-live="polite"'), 'Success toast must be polite');
    assert.ok(successHtml.includes('Đã sao chép liên kết'), 'Toast must display message');

    // Touch target for dismiss button
    assert.ok(
      successHtml.includes('min-width:44px') ||
      successHtml.includes('min-height:44px') ||
      successHtml.includes('minWidth:44') ||
      successHtml.includes('min-height: 44px') ||
      successHtml.includes('min-width: 44px'),
      'Dismiss button must preserve >=44px touch target on mobile',
    );
  });

  // 2. AppDialog rendering, modal attributes, and double-click protection
  await t.test('2. AppDialog renders accessible modal dialog with backdrop and loading guard', () => {
    const dialogHtml = renderToStaticMarkup(
      React.createElement(AppDialog, {
        isOpen: true,
        title: 'Tạm ngưng nhân viên',
        description: 'Vui lòng nhập lý do tạm ngưng tài khoản nhân viên này.',
        confirmLabel: 'Xác nhận tạm ngưng',
        isDestructive: true,
        isLoading: false,
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );

    assert.ok(dialogHtml.includes('role="dialog"'), 'AppDialog must render role="dialog"');
    assert.ok(dialogHtml.includes('aria-modal="true"'), 'AppDialog must set aria-modal="true"');
    assert.ok(dialogHtml.includes('Tạm ngưng nhân viên'), 'Dialog must display title');
    assert.ok(dialogHtml.includes('Vui lòng nhập lý do'), 'Dialog must display description');
    assert.ok(dialogHtml.includes('Xác nhận tạm ngưng'), 'Dialog must display confirm button');

    // Loading guard (prevents double submissions)
    const loadingDialogHtml = renderToStaticMarkup(
      React.createElement(AppDialog, {
        isOpen: true,
        title: 'Đang xử lý',
        confirmLabel: 'Lưu',
        isLoading: true,
        onConfirm: () => {},
        onCancel: () => {},
      }),
    );
    assert.ok(loadingDialogHtml.includes('disabled'), 'Buttons must be disabled when isLoading=true');
  });

  // 3. Complete elimination of native alert, confirm, prompt across web screens
  await t.test('3. Verification that window.alert, window.confirm, window.prompt are completely eliminated', () => {
    const screensToCheck = [
      'apps/web/src/screens/EmployeeNewScreen.tsx',
      'apps/web/src/screens/EmployeeDetailScreen.tsx',
      'apps/web/src/screens/EmployeesScreen.tsx',
      'apps/web/src/screens/ClockScreen.tsx',
      'apps/web/src/screens/ReportsScreen.tsx',
      'apps/web/src/screens/LoginScreen.tsx',
      'apps/web/src/screens/IssuesScreen.tsx',
      'apps/web/src/screens/IssueDetailScreen.tsx',
      'apps/web/src/screens/AccountsScreen.tsx',
      'apps/web/src/screens/SettingsScreen.tsx',
    ];

    for (const file of screensToCheck) {
      const content = readFileSync(resolve(root, file), 'utf8');
      assert.ok(
        !/(?:window\.)?alert\s*\(/.test(content),
        `${file} must not contain any calls to alert()`,
      );
      assert.ok(
        !/(?:window\.)?confirm\s*\(/.test(content),
        `${file} must not contain any calls to confirm()`,
      );
      assert.ok(
        !/(?:window\.)?prompt\s*\(/.test(content),
        `${file} must not contain any calls to prompt()`,
      );
    }
  });

  // 4. Verification that updated screens import and bind AppToast or AppDialog
  await t.test('4. EmployeesScreen, EmployeeDetailScreen, EmployeeNewScreen, ClockScreen bind AppToast and AppDialog', () => {
    const empNew = readFileSync(resolve(root, 'apps/web/src/screens/EmployeeNewScreen.tsx'), 'utf8');
    assert.ok(empNew.includes('AppToast'), 'EmployeeNewScreen must import and render AppToast');
    assert.ok(empNew.includes('setToastMessage'), 'EmployeeNewScreen must manage toast message');

    const empDetail = readFileSync(resolve(root, 'apps/web/src/screens/EmployeeDetailScreen.tsx'), 'utf8');
    assert.ok(empDetail.includes('AppToast'), 'EmployeeDetailScreen must import and render AppToast');
    assert.ok(empDetail.includes('AppDialog'), 'EmployeeDetailScreen must import and render AppDialog');
    assert.ok(empDetail.includes('confirmDialog'), 'EmployeeDetailScreen must manage confirmDialog state');

    const empList = readFileSync(resolve(root, 'apps/web/src/screens/EmployeesScreen.tsx'), 'utf8');
    assert.ok(empList.includes('AppToast'), 'EmployeesScreen must import and render AppToast');
    assert.ok(empList.includes('AppDialog'), 'EmployeesScreen must import and render AppDialog');

    const clock = readFileSync(resolve(root, 'apps/web/src/screens/ClockScreen.tsx'), 'utf8');
    assert.ok(clock.includes('AppToast'), 'ClockScreen must import and render AppToast');
    assert.ok(clock.includes('AppDialog'), 'ClockScreen must import and render AppDialog');
    assert.ok(clock.includes('clockActionDialog'), 'ClockScreen must manage clockActionDialog state');
  });

  // 5. NOTI-002: Error banner warning notification
  await t.test('5. NOTI-002: AppToast renders system error banner with role="alert" and warning styling', () => {
    const errorHtml = renderToStaticMarkup(
      React.createElement(AppToast, {
        message: 'Cảnh báo lỗi kết nối hệ thống',
        variant: 'error',
        testId: 'system-error-banner',
      }),
    );
    assert.ok(errorHtml.includes('role="alert"'), 'Must have role="alert"');
    assert.ok(errorHtml.includes('data-testid="system-error-banner"'), 'Must match testId');
    assert.ok(errorHtml.includes('Cảnh báo lỗi kết nối hệ thống'), 'Must render error banner text');
  });

  // 6. NOTI-004: Interactive action navigation link within toast notification
  await t.test('6. NOTI-004: AppToast renders actionable navigation link button', () => {
    const actionHtml = renderToStaticMarkup(
      React.createElement(AppToast, {
        message: 'Công việc mới được giao',
        variant: 'info',
        action: {
          label: 'Xem chi tiết',
          onClick: () => {},
        },
      }),
    );
    assert.ok(actionHtml.includes('Xem chi tiết'), 'Must render action button label');
    assert.ok(actionHtml.includes('button'), 'Action must render as an interactive button element');
  });
});
