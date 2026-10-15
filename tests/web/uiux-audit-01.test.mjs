import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppShell } from '../../dist/apps/web/src/AppShell.js';
import { DashboardScreen } from '../../dist/apps/web/src/screens/DashboardScreen.js';
import {
  MobileBottomNav,
  AppDialog,
} from '../../dist/packages/ui/src/components/index.js';

const ROOT_DIR = process.cwd();

test('ANTY-UIUX-AUDIT-01: index.html enables mobile pinch-to-zoom (no user-scalable=no or maximum-scale=1.0)', () => {
  const html = fs.readFileSync(
    path.join(ROOT_DIR, 'apps/web/index.html'),
    'utf8',
  );
  assert.ok(
    html.includes('name="viewport"'),
    'index.html must include a viewport meta tag',
  );
  assert.ok(
    !html.includes('user-scalable=no'),
    'viewport meta tag must not disable pinch-to-zoom via user-scalable=no',
  );
  assert.ok(
    !html.includes('maximum-scale=1.0'),
    'viewport meta tag must not cap zoom at maximum-scale=1.0',
  );
});

test('ANTY-UIUX-AUDIT-01: tokens.css enforces visible :focus-visible outline for keyboard navigation', () => {
  const css = fs.readFileSync(
    path.join(ROOT_DIR, 'packages/ui/src/tokens.css'),
    'utf8',
  );
  assert.ok(
    css.includes('button:focus-visible') &&
      css.includes('input:focus-visible') &&
      css.includes('outline: 2px solid var(--focus-ring) !important'),
    'tokens.css must enforce visible 2px solid var(--focus-ring) focus ring on interactive controls',
  );
});

test('ANTY-UIUX-AUDIT-01: AppShell top header prevents mobile text wrapping overflow and includes accessible labels', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      AppShell,
      {
        currentPath: '/dashboard',
        role: 'owner',
        userName: 'Chủ sở hữu',
        workspaceName: 'Studio Media Lite',
        onNavigate: () => {},
        onLogout: () => {},
      },
      React.createElement('div', null, 'Main Content'),
    ),
  );

  assert.ok(
    html.includes('header-settings-prefix'),
    'AppShell should wrap settings button prefix in .header-settings-prefix for mobile responsive condensation',
  );
  assert.ok(
    html.includes('aria-label="Đổi mật khẩu / Cài đặt"'),
    'AppShell settings button should have descriptive aria-label',
  );
  assert.ok(
    html.includes('aria-label="Đăng xuất"'),
    'AppShell logout button should have descriptive aria-label',
  );
});

test('ANTY-UIUX-AUDIT-01: MobileBottomNav prevents 6-item label collision and marks active tab with aria-current', () => {
  const html = renderToStaticMarkup(
    React.createElement(MobileBottomNav, {
      currentPath: '/employees',
      role: 'owner',
      onNavigate: () => {},
    }),
  );

  assert.ok(
    html.includes('aria-current="page"'),
    'MobileBottomNav should mark the active item with aria-current="page"',
  );
  assert.ok(
    !html.includes('max-width:68px'),
    'MobileBottomNav labels should not overflow 60px slots with fixed max-width:68px',
  );
});

test('ANTY-UIUX-AUDIT-01: AppDialog sets overscroll-behavior: contain and accessible close button', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      AppDialog,
      {
        isOpen: true,
        onClose: () => {},
        title: 'Xác nhận thao tác',
        description: 'Kiểm tra modal',
      },
      React.createElement('div', null, 'Nội dung'),
    ),
  );

  assert.ok(
    html.includes('overscroll-behavior:contain'),
    'AppDialog should include overscroll-behavior:contain to prevent background scroll chaining',
  );
  assert.ok(
    html.includes('aria-label="Đóng hộp thoại"'),
    'AppDialog close button should include Vietnamese aria-label',
  );
});

test('ANTY-UIUX-AUDIT-01: No transition: all 0.15s ease anti-pattern remains in web screens', () => {
  const filesToCheck = [
    'apps/web/src/components/ReportBugWidget.tsx',
    'apps/web/src/screens/IssuesScreen.tsx',
    'apps/web/src/screens/WorkScreen.tsx',
  ];

  for (const relPath of filesToCheck) {
    const content = fs.readFileSync(path.join(ROOT_DIR, relPath), 'utf8');
    assert.ok(
      !content.includes("transition: 'all"),
      `${relPath} must use explicit property transitions instead of transition: 'all'`,
    );
  }
});

test('ANTY-UIUX-AUDIT-01: DashboardScreen renders live-ready summary cards and complete module quick-links for Owner and Staff', () => {
  const ownerHtml = renderToStaticMarkup(
    React.createElement(DashboardScreen, {
      role: 'owner',
      workspaceName: 'Hoài Phương Studio',
      onNavigate: () => {},
    }),
  );

  for (const expectedLabel of [
    'Hoài Phương Studio',
    'Trạng thái ca làm',
    'Báo cáo hàng ngày',
    'Nhân sự trực tiếp',
    'Kỳ lương',
    'Chấm công',
    'Báo cáo',
    'Công việc',
    'Lịch làm việc',
    'Lưu trữ &amp; Drive',
    'Nhân viên',
    'Bảng lương',
    'Tài chính',
    'Tài khoản ACC',
    'Vấn đề &amp; Issues',
    'Cài đặt',
  ]) {
    assert.ok(
      ownerHtml.includes(expectedLabel),
      `Owner DashboardScreen should render "${expectedLabel}"`,
    );
  }

  const staffHtml = renderToStaticMarkup(
    React.createElement(DashboardScreen, {
      role: 'staff',
      workspaceName: 'Hoài Phương Studio',
      onNavigate: () => {},
    }),
  );

  assert.ok(
    staffHtml.includes('Công tháng hiện tại') &&
      staffHtml.includes('Lương cá nhân'),
    'Staff DashboardScreen should render staff-specific summary and quick-link cards',
  );
  assert.ok(
    !staffHtml.includes('Tài khoản ACC') && !staffHtml.includes('Tài chính'),
    'Staff DashboardScreen must not expose Owner-only module cards',
  );
});
