import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardScreen } from '../../dist/apps/web/src/screens/DashboardScreen.js';

const root = process.cwd();

test('CROSS-SYSTEM-BRIDGE-01: management-lite API & Web expose full data bridge with hoaiphuong.click (TikTok AI Factory V4)', () => {
  const bridgeServicePath = path.resolve(
    root,
    'apps/api/src/bridge/service.ts',
  );
  const appPath = path.resolve(root, 'apps/api/src/app.ts');
  const dashboardPath = path.resolve(
    root,
    'apps/web/src/screens/DashboardScreen.tsx',
  );

  assert.ok(
    fs.existsSync(bridgeServicePath),
    'BridgeService must exist in apps/api/src/bridge/service.ts',
  );
  const bridgeSrc = fs.readFileSync(bridgeServicePath, 'utf8');
  assert.ok(
    bridgeSrc.includes('/api/bridge/summary') &&
      bridgeSrc.includes('/api/bridge/sync-members') &&
      bridgeSrc.includes('BRIDGE_TIKTOK_V4_SYNCED'),
    'BridgeService must integrate /api/bridge/summary, /api/bridge/sync-members, and audit logging',
  );

  const appSrc = fs.readFileSync(appPath, 'utf8');
  assert.ok(
    appSrc.includes('/api/v1/bridge/public-summary') &&
      appSrc.includes('/api/v1/bridge/tiktok-v4') &&
      appSrc.includes('/api/v1/bridge/tiktok-v4/sync'),
    'app.ts must register all 3 cross-system bridge routes',
  );

  const dashSrc = fs.readFileSync(dashboardPath, 'utf8');
  assert.ok(
    dashSrc.includes('/api/v1/bridge/tiktok-v4') &&
      dashSrc.includes('/api/v1/bridge/tiktok-v4/sync'),
    'DashboardScreen.tsx must connect to /api/v1/bridge/tiktok-v4 and /api/v1/bridge/tiktok-v4/sync',
  );
  assert.ok(
    dashSrc.includes("'https://hoaiphuong.click'") &&
      !dashSrc.includes('/api/auth/management/start'),
    'DashboardScreen.tsx must open https://hoaiphuong.click directly without hitting unmounted /api/auth/management/start',
  );

  const ownerHtml = renderToStaticMarkup(
    React.createElement(DashboardScreen, {
      role: 'owner',
      workspaceName: 'Hoài Phương Studio',
      onNavigate: () => {},
    }),
  );

  assert.ok(
    ownerHtml.includes('Liên thông TikTok AI Factory (hoaiphuong.click)'),
    'Owner Dashboard must render the TikTok AI Factory cross-system integration card',
  );
  assert.ok(
    ownerHtml.includes('Chi tiết V4'),
    'Owner Dashboard must expose the (collapsed by default) V4 details toggle',
  );
  assert.ok(
    ownerHtml.includes('Đồng bộ') &&
      ownerHtml.includes('nhân sự &amp; công việc'),
    'Owner Dashboard must offer the sync action and label its supported scope (personnel & work items)',
  );
  assert.ok(
    dashSrc.includes('Đồng bộ nhân sự và công việc với hoaiphuong.click'),
    'DashboardScreen must describe the supported sync scope in the expandable V4 details',
  );
  assert.ok(
    !ownerHtml.includes('Đồng bộ nhân sự và công việc với hoaiphuong.click'),
    'V4 details must stay collapsed by default',
  );

  const staffHtml = renderToStaticMarkup(
    React.createElement(DashboardScreen, {
      role: 'staff',
      workspaceName: 'Hoài Phương Studio',
      onNavigate: () => {},
    }),
  );

  assert.ok(
    !staffHtml.includes('Liên thông TikTok AI Factory (hoaiphuong.click)'),
    'Staff Dashboard must not render the TikTok AI Factory cross-system integration card',
  );
  assert.ok(
    !staffHtml.includes('Chi tiết V4') &&
      !staffHtml.includes('nhân sự &amp; công việc'),
    'Staff Dashboard must not expose V4 details or the sync action',
  );
});
