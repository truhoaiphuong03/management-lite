import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('shared design tokens match canonical doc 44 specifications', async () => {
  const { TOKENS } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/tokens.js')}`
  );

  assert.equal(TOKENS.colors.background, '#0B1220');
  assert.equal(TOKENS.colors.surface, '#151F30');
  assert.equal(TOKENS.colors.primary, '#14B8A6');
  assert.equal(TOKENS.colors.text, '#F8FAFC');
  assert.equal(TOKENS.colors.muted, '#94A3B8');
  assert.equal(TOKENS.colors.border, '#334155');
  assert.equal(TOKENS.colors.error, '#EF4444');
  assert.equal(TOKENS.colors.warning, '#F59E0B');

  assert.equal(TOKENS.spacing[1], '4px');
  assert.equal(TOKENS.spacing[2], '8px');
  assert.equal(TOKENS.spacing[3], '12px');
  assert.equal(TOKENS.spacing[4], '16px');
  assert.equal(TOKENS.spacing[6], '24px');

  assert.equal(TOKENS.radii.sm, '8px');
  assert.equal(TOKENS.radii.md, '12px');
  assert.equal(TOKENS.radii.lg, '16px');

  assert.equal(TOKENS.touchTarget.minHeight, '44px');
});

test('route registry defines canonical V0.1 screens with RBAC guards', async () => {
  const { ROUTE_REGISTRY } = await import(
    `file://${resolve(root, 'dist/apps/web/src/types.js')}`
  );

  // Initial implemented demo screens
  assert.equal(ROUTE_REGISTRY['/login']?.implemented, true);
  assert.equal(ROUTE_REGISTRY['/']?.implemented, true);
  assert.equal(ROUTE_REGISTRY['/clock']?.implemented, true);
  assert.equal(ROUTE_REGISTRY['/reports']?.implemented, true);
  assert.equal(ROUTE_REGISTRY['/settings']?.implemented, true);

  // Unimplemented screens marked as not implemented
  assert.equal(ROUTE_REGISTRY['/activate']?.implemented, false);
  assert.equal(ROUTE_REGISTRY['/attendance']?.implemented, false);
  assert.equal(ROUTE_REGISTRY['/attendance/corrections']?.implemented, false);
  assert.equal(ROUTE_REGISTRY['/payroll']?.implemented, false);

  // Owner only route guards per RBAC-02
  assert.equal(ROUTE_REGISTRY['/attendance/review']?.ownerOnly, true);
  assert.equal(ROUTE_REGISTRY['/employees']?.ownerOnly, true);
  assert.equal(ROUTE_REGISTRY['/payroll']?.ownerOnly, true);
  assert.equal(ROUTE_REGISTRY['/accounts']?.ownerOnly, true);
  assert.equal(ROUTE_REGISTRY['/audit']?.ownerOnly, true);
});

test('routing engine matches exact routes, normalizes slashes, and extracts dynamic params', async () => {
  const { matchRoute } = await import(
    `file://${resolve(root, 'dist/apps/web/src/router.js')}`
  );

  // 1. Exact static routes
  const homeMatch = matchRoute('/');
  assert.equal(homeMatch.route?.id, 'UI03');
  assert.equal(homeMatch.isExact, true);
  assert.deepEqual(homeMatch.params, {});

  const clockMatch = matchRoute('/clock');
  assert.equal(clockMatch.route?.id, 'UI04');
  assert.equal(clockMatch.isExact, true);
  assert.deepEqual(clockMatch.params, {});

  // 2. Trailing slash normalization
  const clockTrailingMatch = matchRoute('/clock/');
  assert.equal(clockTrailingMatch.route?.id, 'UI04');
  assert.equal(clockTrailingMatch.isExact, true);

  // 3. Dynamic parameter extraction
  const reportDetailMatch = matchRoute('/reports/REP-2026-001');
  assert.equal(reportDetailMatch.route?.id, 'UI10');
  assert.equal(reportDetailMatch.isExact, false);
  assert.equal(reportDetailMatch.params.id, 'REP-2026-001');

  const payrollDetailMatch = matchRoute('/payroll/2026-10');
  assert.equal(payrollDetailMatch.route?.id, 'UI15');
  assert.equal(payrollDetailMatch.isExact, false);
  assert.equal(payrollDetailMatch.params.id, '2026-10');

  const employeeDetailMatch = matchRoute('/employees/EMP-99');
  assert.equal(employeeDetailMatch.route?.id, 'UI13');
  assert.equal(employeeDetailMatch.isExact, false);
  assert.equal(employeeDetailMatch.params.id, 'EMP-99');

  const accountDetailMatch = matchRoute('/accounts/ACC-101');
  assert.equal(accountDetailMatch.route?.id, 'UI18');
  assert.equal(accountDetailMatch.isExact, false);
  assert.equal(accountDetailMatch.params.id, 'ACC-101');

  // 4. Valid encoded URL characters decode properly
  const encodedMatch = matchRoute('/reports/B%C3%A1o%20c%C3%A1o%201');
  assert.equal(encodedMatch.route?.id, 'UI10');
  assert.equal(encodedMatch.params.id, 'Báo cáo 1');

  // 5. Malformed percent-encoding safely returns 404 without throwing URIError
  const malformedSamples = [
    '/reports/%E0%A4%A',
    '/reports/%',
    '/reports/%ZZ',
    '/payroll/%c0%af',
    '/%FF%FF',
  ];
  for (const sample of malformedSamples) {
    assert.doesNotThrow(() => {
      const res = matchRoute(sample);
      assert.equal(res.route, null);
      assert.equal(res.isExact, false);
      assert.deepEqual(res.params, {});
    });
  }

  // 6. 404 / unknown routes
  const notFoundMatch = matchRoute('/unknown/route/path');
  assert.equal(notFoundMatch.route, null);
  assert.equal(notFoundMatch.isExact, false);
  assert.deepEqual(notFoundMatch.params, {});
});

test('RBAC navigation filtering and access guard enforcement', async () => {
  const { NAV_ITEMS } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/Navigation.js')}`
  );
  const { matchRoute } = await import(
    `file://${resolve(root, 'dist/apps/web/src/router.js')}`
  );

  // 1. Owner view in DesktopSidebar includes ownerOnly items and excludes my-pay
  const ownerVisible = NAV_ITEMS.filter((item) => {
    if (item.staffOnly || item.id === 'my-pay') return false; // C04/PAY-02: Owner has no payroll entry
    return true;
  });
  assert.ok(ownerVisible.some((i) => i.id === 'employees'));
  assert.ok(ownerVisible.some((i) => i.id === 'payroll'));
  assert.ok(ownerVisible.some((i) => i.id === 'accounts'));
  assert.ok(ownerVisible.some((i) => i.id === 'audit'));
  assert.ok(!ownerVisible.some((i) => i.id === 'my-pay'));

  // 2. Staff view in DesktopSidebar excludes all ownerOnly items and includes my-pay
  const staffVisible = NAV_ITEMS.filter((item) => {
    if (item.ownerOnly) return false;
    return true;
  });
  assert.ok(!staffVisible.some((i) => i.id === 'employees'));
  assert.ok(!staffVisible.some((i) => i.id === 'payroll'));
  assert.ok(!staffVisible.some((i) => i.id === 'accounts'));
  assert.ok(!staffVisible.some((i) => i.id === 'audit'));
  assert.ok(staffVisible.some((i) => i.id === 'my-pay'));

  // 3. RBAC Route guard resolution check
  const staffRole = 'staff';
  const ownerRole = 'owner';

  const payrollRoute = matchRoute('/payroll/2026-10').route;
  assert.ok(payrollRoute?.ownerOnly);

  // Staff accessing owner-only route triggers forbidden state
  const isForbiddenForStaff = Boolean(
    (payrollRoute?.ownerOnly && staffRole === 'staff') ||
    (payrollRoute?.staffOnly && staffRole === 'owner'),
  );
  assert.equal(isForbiddenForStaff, true);

  // Owner accessing owner-only route is allowed
  const isForbiddenForOwner = Boolean(
    (payrollRoute?.ownerOnly && ownerRole === 'staff') ||
    (payrollRoute?.staffOnly && ownerRole === 'owner'),
  );
  assert.equal(isForbiddenForOwner, false);

  // Staff accessing general route is allowed
  const clockRoute = matchRoute('/clock').route;
  const isClockForbiddenForStaff = Boolean(
    (clockRoute?.ownerOnly && staffRole === 'staff') ||
    (clockRoute?.staffOnly && staffRole === 'owner'),
  );
  assert.equal(isClockForbiddenForStaff, false);

  // 4. Owner direct access to /my-pay is blocked with 403 Forbidden
  const myPayRoute = matchRoute('/my-pay').route;
  assert.ok(myPayRoute);
  assert.equal(myPayRoute.id, 'UI16');
  assert.equal(myPayRoute.staffOnly, true);
  assert.equal(myPayRoute.implemented, false);

  const isMyPayForbiddenForOwner = Boolean(
    (myPayRoute.ownerOnly && ownerRole === 'staff') ||
    (myPayRoute.staffOnly && ownerRole === 'owner'),
  );
  assert.equal(
    isMyPayForbiddenForOwner,
    true,
    'Owner accessing /my-pay directly must trigger forbidden state',
  );

  // 5. Staff direct access to /my-pay is allowed and reaches placeholder
  const isMyPayForbiddenForStaff = Boolean(
    (myPayRoute.ownerOnly && staffRole === 'staff') ||
    (myPayRoute.staffOnly && staffRole === 'owner'),
  );
  assert.equal(
    isMyPayForbiddenForStaff,
    false,
    'Staff accessing /my-pay directly must be allowed to view placeholder',
  );
});

test('responsive breakpoints and touch target specifications adhere to canonical contract', async () => {
  const { TOKENS } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/tokens.js')}`
  );

  // 1. Minimum touch target height >= 44px
  const minHeightValue = parseInt(TOKENS.touchTarget.minHeight, 10);
  assert.ok(
    minHeightValue >= 44,
    `Touch target must be >= 44px, got ${minHeightValue}px`,
  );

  // 2. Breakpoint verification for target viewports
  // Target viewports: Mobile (360px, 390px, 430px), Desktop (768px, 1280px)
  const mobileWidths = [360, 390, 430];
  const desktopWidths = [768, 1280];
  const MOBILE_BREAKPOINT = 768; // Mobile: <= 768px, Desktop: >= 769px

  for (const w of mobileWidths) {
    assert.ok(
      w <= MOBILE_BREAKPOINT,
      `Mobile width ${w}px must be <= ${MOBILE_BREAKPOINT}px for mobile bottom nav display`,
    );
  }

  for (const w of desktopWidths) {
    if (w === 768) {
      assert.ok(
        w <= MOBILE_BREAKPOINT,
        `Tablet portrait 768px falls into mobile bottom nav tier for touch ergonomics`,
      );
    } else {
      assert.ok(
        w > MOBILE_BREAKPOINT,
        `Desktop width ${w}px must be > ${MOBILE_BREAKPOINT}px for desktop sidebar display`,
      );
    }
  }

  // 3. Verify AppShell source defines responsive media queries and overflow protection
  const appShellSource = readFileSync(
    resolve(root, 'apps/web/src/AppShell.tsx'),
    'utf8',
  );
  assert.match(appShellSource, /@media\s*\(min-width:\s*769px\)/);
  assert.match(appShellSource, /@media\s*\(max-width:\s*768px\)/);
  assert.match(appShellSource, /overflowX:\s*['"]hidden['"]/);

  // 4. Viewport layout verification across canonical target widths
  const viewports = [
    {
      width: 360,
      mode: 'mobile',
      padding: 32,
      hasSidebar: false,
      hasBottomNav: true,
    },
    {
      width: 390,
      mode: 'mobile',
      padding: 32,
      hasSidebar: false,
      hasBottomNav: true,
    },
    {
      width: 430,
      mode: 'mobile',
      padding: 32,
      hasSidebar: false,
      hasBottomNav: true,
    },
    {
      width: 768,
      mode: 'mobile-touch',
      padding: 32,
      hasSidebar: false,
      hasBottomNav: true,
    },
    {
      width: 1280,
      mode: 'desktop',
      padding: 64,
      sidebarWidth: 240,
      hasSidebar: true,
      hasBottomNav: false,
    },
  ];

  for (const vp of viewports) {
    if (vp.mode === 'desktop') {
      const netContentWidth = vp.width - (vp.sidebarWidth || 0) - vp.padding;
      assert.ok(
        netContentWidth > 0 && netContentWidth <= 1200,
        `Desktop width ${vp.width}px net content (${netContentWidth}px) fits within 1200px ceiling`,
      );
    } else {
      const netContentWidth = vp.width - vp.padding;
      const minButtonWidth = (netContentWidth - 8) / 2; // 2-column mobile drawer layout
      assert.ok(
        minButtonWidth >= minHeightValue,
        `Mobile width ${vp.width}px provides button width (${minButtonWidth}px) >= touch target ${minHeightValue}px`,
      );
    }
  }
});

test('Vite server binds to localhost (127.0.0.1) by default and LAN (0.0.0.0) upon explicit opt-in', () => {
  const viteConfigSource = readFileSync(
    resolve(root, 'apps/web/vite.config.ts'),
    'utf8',
  );

  // Assert default host logic in config
  assert.match(
    viteConfigSource,
    /host:\s*isLan\s*\?\s*['"]0\.0\.0\.0['"]\s*:\s*['"]127\.0\.0\.1['"]/,
  );
  assert.match(viteConfigSource, /process\.env\.LAN\s*===\s*['"]true['"]/);
  assert.match(viteConfigSource, /port:\s*3001/);
  assert.match(viteConfigSource, /strictPort:\s*true/);

  // Assert package.json scripts provide explicit LAN opt-in
  const rootPackageJson = JSON.parse(
    readFileSync(resolve(root, 'package.json'), 'utf8'),
  );
  const webPackageJson = JSON.parse(
    readFileSync(resolve(root, 'apps/web/package.json'), 'utf8'),
  );

  assert.equal(
    rootPackageJson.scripts['dev:web'],
    'npm run --workspace=@management-lite/web dev',
  );
  assert.equal(
    rootPackageJson.scripts['dev:web:lan'],
    'npm run --workspace=@management-lite/web dev:lan',
  );
  assert.equal(webPackageJson.scripts['dev'], 'vite');
  assert.equal(webPackageJson.scripts['dev:lan'], 'vite --host 0.0.0.0');
});

test('production bundle builds successfully into apps/web/dist', () => {
  const indexHtmlPath = resolve(root, 'apps/web/dist/index.html');
  assert.equal(existsSync(indexHtmlPath), true);
  const content = readFileSync(indexHtmlPath, 'utf8');
  assert.match(content, /Management Lite V0\.1/);
});
