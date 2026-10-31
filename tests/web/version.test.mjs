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
  const pkgVersion = JSON.parse(
    readFileSync(resolve(root, 'package.json'), 'utf8'),
  ).version;

  // 1. Single source of truth values
  assert.equal(SYSTEM_NAME, 'Management Lite');
  assert.equal(SYSTEM_VERSION, pkgVersion);
  assert.match(SYSTEM_COMMIT, /^[0-9a-f]{7}$/i);
  assert.equal(SYSTEM_ENV, 'staging');

  // 2. Helper contract
  const info = getSystemInfo();
  assert.deepEqual(info, {
    name: 'Management Lite',
    version: pkgVersion,
    commit: SYSTEM_COMMIT,
    environment: 'staging',
  });

  // 3. Re-exported from contracts index
  const contractsIndex = await import(
    `file://${resolve(root, 'dist/packages/contracts/src/index.js')}`
  );
  assert.equal(contractsIndex.SYSTEM_VERSION, pkgVersion);
  assert.equal(contractsIndex.SYSTEM_COMMIT, SYSTEM_COMMIT);
});

test('MGL-UI-CLEANUP-VERSION-24: Shared Navigation displays canonical subtle version and no Demo tags', async () => {
  const { DesktopSidebar } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/Navigation.js')}`
  );
  const { SYSTEM_VERSION } = await import(
    `file://${resolve(root, 'dist/packages/contracts/src/version.js')}`
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
    markup.includes(`v${SYSTEM_VERSION}`),
    `DesktopSidebar must display canonical version v${SYSTEM_VERSION}`,
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

test('MGL-RELEASE-HISTORY-ADMIN: SettingsScreen enforces Admin-only visibility and Vietnamese release note sections', async () => {
  const settingsPath = resolve(root, 'apps/web/src/screens/SettingsScreen.tsx');
  const content = readFileSync(settingsPath, 'utf8');

  assert.ok(
    content.includes('Phiên bản và Lịch sử cập nhật'),
    'SettingsScreen must display "Phiên bản và Lịch sử cập nhật"',
  );
  assert.ok(
    content.includes('/api/v1/system/releases'),
    'SettingsScreen must query /api/v1/system/releases for Admin',
  );
  assert.ok(
    content.includes("role === 'owner'"),
    'SettingsScreen must guard release history by role === "owner"',
  );
  assert.ok(
    content.includes('data-testid="admin-release-history"'),
    'SettingsScreen must render data-testid="admin-release-history" inside owner guard',
  );
  assert.ok(
    content.includes('Chức năng đã thêm') &&
      content.includes('Chức năng đã cải tiến') &&
      content.includes('Lỗi đã sửa'),
    'SettingsScreen must display added, improved, and fixed sections in Vietnamese',
  );

  const { RELEASE_NOTES_CATALOG } = await import(
    `file://${resolve(root, 'dist/packages/contracts/src/version.js')}`
  );
  assert.ok(
    Array.isArray(RELEASE_NOTES_CATALOG) && RELEASE_NOTES_CATALOG.length >= 2,
    'RELEASE_NOTES_CATALOG must contain release note items',
  );
  for (const item of RELEASE_NOTES_CATALOG) {
    assert.ok(item.version, 'Each release note must have version');
    assert.ok(item.commit, 'Each release note must have commit');
    assert.ok(item.released_at, 'Each release note must have released_at');
    assert.ok(item.summary, 'Each release note must have Vietnamese summary');
    assert.ok(Array.isArray(item.added) && item.added.length > 0);
    assert.ok(Array.isArray(item.improved) && item.improved.length > 0);
    assert.ok(Array.isArray(item.fixed) && item.fixed.length > 0);
  }
});

test('MGL-RELEASE-HISTORY-ADMIN: Backend /api/v1/system/releases enforces Admin RBAC, excludes failed deploys, and reflects rollback accurately', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const http = await import('node:http');
  const { createRequestHandler } = await import(
    `file://${resolve(root, 'dist/apps/api/src/app.js')}`
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mglite-rel-hist-'));
  const deployLogFile = path.join(tmpDir, 'deploy-history.log');
  const reportsDir = path.join(tmpDir, 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });

  // Write deploy-history.log with 1 valid SUCCESS and 3 non-success/sandbox entries
  const logLines = [
    JSON.stringify({
      timestamp: '2026-10-15T10:00:00.000Z',
      version: '0.1.0',
      sha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      previous_sha: '3743e991dc97a7215f04444f0f6b0cfd6941533c',
      status: 'SUCCESS',
      sandbox: false,
      message: 'Deployment completed and verified',
    }),
    JSON.stringify({
      timestamp: '2026-10-15T11:00:00.000Z',
      version: '0.1.1',
      sha: 'badbeef000000000000000000000000000000000',
      previous_sha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      status: 'FAILED',
      sandbox: false,
      message: 'Simulated failure',
    }),
    JSON.stringify({
      timestamp: '2026-10-15T11:30:00.000Z',
      version: '0.1.2',
      sha: 'deadc0de00000000000000000000000000000000',
      previous_sha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      status: 'ROLLED_BACK',
      sandbox: false,
      message: 'Rolled back after smoke check fail',
    }),
    JSON.stringify({
      timestamp: '2026-10-15T12:00:00.000Z',
      version: '0.1.3',
      sha: '5a4db0x000000000000000000000000000000000',
      previous_sha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      status: 'SUCCESS',
      sandbox: true,
      message: 'Sandbox deploy must not appear in production history',
    }),
  ];
  fs.writeFileSync(deployLogFile, logLines.join('\n') + '\n', 'utf8');

  // Set active running SHA to a1b2c3d4e5f6...
  fs.writeFileSync(
    path.join(reportsDir, 'running-components-sha.json'),
    JSON.stringify({
      sha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
      verified_at_utc: '2026-10-15T10:00:05.000Z',
    }),
    'utf8',
  );

  const prevLogEnv = process.env.SERVER_DEPLOY_HISTORY_LOG;
  const prevReportsEnv = process.env.SERVER_REPORTS_DIR;
  process.env.SERVER_DEPLOY_HISTORY_LOG = deployLogFile;
  process.env.SERVER_REPORTS_DIR = reportsDir;

  const mockAuthService = {
    async resolveSession(token) {
      if (token === 'owner-token') {
        return {
          user: { id: 'u1', email: 'owner@example.com', status: 'active' },
          workspace: { id: 'w1', name: 'HP', role: 'owner' },
          session: { id: 's1' },
        };
      }
      if (token === 'staff-token') {
        return {
          user: { id: 'u2', email: 'staff@example.com', status: 'active' },
          workspace: { id: 'w1', name: 'HP', role: 'staff' },
          session: { id: 's2' },
        };
      }
      return null;
    },
  };

  const server = http.createServer(
    createRequestHandler({
      authService: mockAuthService,
      isProduction: false,
    }),
  );

  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Unauthenticated -> 401
    const unauthRes = await fetch(`${baseUrl}/api/v1/system/releases`);
    assert.equal(unauthRes.status, 401);

    // 2. Staff -> 403 FORBIDDEN
    const staffRes = await fetch(`${baseUrl}/api/v1/system/releases`, {
      headers: { Cookie: 'mglite_session=staff-token' },
    });
    assert.equal(staffRes.status, 403);

    // 3. Owner (Admin) -> 200 OK with current = a1b2c3d and no failed/sandbox entries
    const ownerRes = await fetch(`${baseUrl}/api/v1/system/releases`, {
      headers: { Cookie: 'mglite_session=owner-token' },
    });
    assert.equal(ownerRes.status, 200);
    const ownerBody = await ownerRes.json();
    assert.equal(ownerBody.success, true);
    assert.equal(ownerBody.data.current.commit, 'a1b2c3d');

    const commits = ownerBody.data.releases.map((r) => r.commit);
    assert.ok(commits.includes('a1b2c3d'), 'Must include successful deploy');
    assert.ok(
      !commits.includes('badbeef'),
      'Must NOT include FAILED deploy in release history',
    );
    assert.ok(
      !commits.includes('deadc0d'),
      'Must NOT include ROLLED_BACK deploy in release history',
    );
    assert.ok(
      !commits.includes('5a4db0x'),
      'Must NOT include sandbox deploy in release history',
    );

    const activeEntry = ownerBody.data.releases.find(
      (r) => r.commit === 'a1b2c3d',
    );
    assert.equal(activeEntry.is_current, true);
    assert.ok(activeEntry.added.length > 0);
    assert.ok(activeEntry.improved.length > 0);
    assert.ok(activeEntry.fixed.length > 0);

    // 4. Simulate Rollback to 3743e99 -> current version must become 0.0.9 (3743e99)
    fs.writeFileSync(
      path.join(reportsDir, 'running-components-sha.json'),
      JSON.stringify({
        sha: '3743e991dc97a7215f04444f0f6b0cfd6941533c',
        verified_at_utc: '2026-10-15T12:30:00.000Z',
      }),
      'utf8',
    );

    const rbRes = await fetch(`${baseUrl}/api/v1/system/releases`, {
      headers: { Cookie: 'mglite_session=owner-token' },
    });
    assert.equal(rbRes.status, 200);
    const rbBody = await rbRes.json();
    assert.equal(rbBody.data.current.commit, '3743e99');
    assert.equal(rbBody.data.current.version, '0.0.9');

    const rbCurrentEntry = rbBody.data.releases.find((r) => r.is_current);
    assert.ok(rbCurrentEntry, 'Rolled back release must be marked is_current');
    assert.equal(rbCurrentEntry.commit, '3743e99');
    assert.equal(rbCurrentEntry.version, '0.0.9');

    const prevEntryAfterRb = rbBody.data.releases.find(
      (r) => r.commit === 'a1b2c3d',
    );
    assert.equal(prevEntryAfterRb.is_current, false);
  } finally {
    await new Promise((res) => server.close(res));
    if (prevLogEnv === undefined) delete process.env.SERVER_DEPLOY_HISTORY_LOG;
    else process.env.SERVER_DEPLOY_HISTORY_LOG = prevLogEnv;
    if (prevReportsEnv === undefined) delete process.env.SERVER_REPORTS_DIR;
    else process.env.SERVER_REPORTS_DIR = prevReportsEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
