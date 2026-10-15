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

test('MGL-UI-CLEANUP-VERSION-24: Canonical global version contract and single source of truth', async () => {
  const {
    SYSTEM_NAME,
    SYSTEM_VERSION,
    SYSTEM_COMMIT,
    SYSTEM_ENV,
    getSystemInfo,
  } = await import(
    `file://${resolve(root, 'dist/packages/contracts/src/version.js')}`
  );

  // 1. Single source of truth values
  assert.equal(SYSTEM_NAME, 'Management Lite');
  assert.equal(SYSTEM_VERSION, '0.1.0-dev');
  assert.equal(SYSTEM_COMMIT, 'ab7500c');
  assert.equal(SYSTEM_ENV, 'staging');

  // 2. Helper contract
  const info = getSystemInfo();
  assert.deepEqual(info, {
    name: 'Management Lite',
    version: '0.1.0-dev',
    commit: 'ab7500c',
    environment: 'staging',
  });

  // 3. Re-exported from contracts index
  const contractsIndex = await import(
    `file://${resolve(root, 'dist/packages/contracts/src/index.js')}`
  );
  assert.equal(contractsIndex.SYSTEM_VERSION, '0.1.0-dev');
  assert.equal(contractsIndex.SYSTEM_COMMIT, 'ab7500c');
});

test('MGL-UI-CLEANUP-VERSION-24: Shared Navigation displays canonical subtle version and no Demo tags', async () => {
  const { DesktopSidebar } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/Navigation.js')}`
  );

  const markup = renderToStaticMarkup(
    React.createElement(DesktopSidebar, {
      currentPath: '/',
      onNavigate: () => {},
      role: 'owner',
      isOwnerVerified: true,
    }),
  );

  // 1. Displays canonical version
  assert.ok(
    markup.includes('v0.1.0-dev'),
    'DesktopSidebar must display canonical version v0.1.0-dev',
  );

  // 2. No hardcoded Demo tag
  assert.ok(
    !markup.includes('V0.1 Demo'),
    'DesktopSidebar must NOT contain hardcoded "V0.1 Demo"',
  );
});

test('MGL-UI-CLEANUP-VERSION-24: SettingsScreen displays System Information without secrets', () => {
  const settingsPath = resolve(root, 'apps/web/src/screens/SettingsScreen.tsx');
  const content = readFileSync(settingsPath, 'utf8');

  // 1. System Information card exists with canonical fallbacks and live runtime hydration
  assert.ok(
    content.includes('Thông tin hệ thống'),
    'SettingsScreen must include "Thông tin hệ thống" card',
  );
  assert.ok(
    content.includes('SYSTEM_VERSION'),
    'SettingsScreen must reference canonical SYSTEM_VERSION',
  );
  assert.ok(
    content.includes('SYSTEM_COMMIT'),
    'SettingsScreen must reference canonical SYSTEM_COMMIT',
  );
  assert.ok(
    content.includes('SYSTEM_ENV'),
    'SettingsScreen must reference canonical SYSTEM_ENV',
  );
  assert.ok(
    content.includes('/api/v1/health'),
    'SettingsScreen must dynamically query /api/v1/health',
  );
  assert.ok(
    content.includes('/release-version.json'),
    'SettingsScreen must dynamically query /release-version.json',
  );
  assert.ok(
    content.includes('Phiên bản ứng dụng'),
    'SettingsScreen must display Phiên bản ứng dụng',
  );
  assert.ok(
    content.includes('Commit đang chạy'),
    'SettingsScreen must display Commit đang chạy',
  );
  assert.ok(
    content.includes('Thời gian phát hành'),
    'SettingsScreen must display Thời gian phát hành',
  );
  assert.ok(
    content.includes('Trạng thái Production'),
    'SettingsScreen must display Trạng thái Production',
  );
  assert.ok(
    content.includes('.slice(0, 7)'),
    'SettingsScreen must enforce 7-character Git SHA display',
  );

  // 2. Zero leak of DB addresses, ports, or credentials
  assert.ok(
    !content.includes('55499'),
    'Must NOT display internal DB port 55499',
  );
  assert.ok(
    !content.includes('mglite_unified_qa_test'),
    'Must NOT display internal DB name',
  );
  assert.ok(
    !content.includes('postgres://'),
    'Must NOT display DB connection strings',
  );
});

test('MGL-UI-CLEANUP-VERSION-24: LoginScreen copy cleanup removes developer jargon and C06 badges', () => {
  const loginPath = resolve(root, 'apps/web/src/screens/LoginScreen.tsx');
  const content = readFileSync(loginPath, 'utf8');

  // 1. Explicit C06 badge removed from ordinary login markup
  assert.ok(
    !content.includes(
      '<StatusBadge status="success" label="Phiên bảo mật C06" />',
    ),
    'Must NOT contain visible C06 StatusBadge',
  );

  // 2. Jargon removed from footer
  assert.ok(
    !content.includes('Băm mật khẩu Argon2id'),
    'Must NOT contain Argon2id jargon in ordinary login footer',
  );
  assert.ok(
    !content.includes('Rate Limiting'),
    'Must NOT contain Rate Limiting technical text in login footer',
  );

  // 3. Subtle system version reference present
  assert.ok(
    content.includes('SYSTEM_VERSION'),
    'LoginScreen must reference canonical SYSTEM_VERSION',
  );
});
