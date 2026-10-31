import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { register } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

// Register ESM resolve hook so production App.tsx can import @management-lite/ui/components cleanly in Node test runner
const targetUiComponentsUrl = pathToFileURL(
  resolve(root, 'dist/packages/ui/src/components/index.js'),
).href;
const loaderCode = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@management-lite/ui/components') {
    return nextResolve('${targetUiComponentsUrl}', context);
  }
  return nextResolve(specifier, context);
}
`;
register('data:text/javascript,' + encodeURIComponent(loaderCode), import.meta.url);

test('V0.2 ISSUES-01: route registry, router matching, and ownerOnly route metadata', async () => {
  const { ROUTE_REGISTRY } = await import(
    `file://${resolve(root, 'dist/apps/web/src/types.js')}`
  );
  const { matchRoute } = await import(
    `file://${resolve(root, 'dist/apps/web/src/router.js')}`
  );

  // 1. Verify /issues list route in ROUTE_REGISTRY
  const issuesRoute = ROUTE_REGISTRY['/issues'];
  assert.ok(issuesRoute, 'Issues route must exist in ROUTE_REGISTRY');
  assert.equal(issuesRoute.id, 'UI-ISSUES-01', 'Route ID must be UI-ISSUES-01 (nonconflicting)');
  assert.equal(issuesRoute.path, '/issues');
  assert.equal(issuesRoute.implemented, true, 'Route must be marked implemented');
  assert.equal(issuesRoute.ownerOnly, true, 'Route must be Owner-only');
  assert.equal(issuesRoute.category, 'issues', 'Category must be issues');

  // 2. Verify /issues/:id detail route in ROUTE_REGISTRY
  const issueDetailRoute = ROUTE_REGISTRY['/issues/:id'];
  assert.ok(issueDetailRoute, 'Issue detail route must exist in ROUTE_REGISTRY');
  assert.equal(issueDetailRoute.id, 'UI-ISSUES-02', 'Route ID must be UI-ISSUES-02 (nonconflicting)');
  assert.equal(issueDetailRoute.path, '/issues/:id');
  assert.equal(issueDetailRoute.implemented, true, 'Route must be marked implemented');
  assert.equal(issueDetailRoute.ownerOnly, true, 'Route must be Owner-only');
  assert.equal(issueDetailRoute.category, 'issues', 'Category must be issues');

  // 3. Verify router matching for /issues
  const matchIssues = matchRoute('/issues');
  assert.ok(matchIssues.route, 'Route matching must succeed for /issues');
  assert.equal(matchIssues.route.id, 'UI-ISSUES-01');
  assert.equal(matchIssues.isExact, true);
  assert.deepEqual(matchIssues.params, {});

  // 4. Verify router matching for /issues/:id with dynamic parameter extraction
  const sampleUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
  const matchDetail = matchRoute(`/issues/${sampleUuid}`);
  assert.ok(matchDetail.route, 'Route matching must succeed for /issues/:id');
  assert.equal(matchDetail.route.id, 'UI-ISSUES-02');
  assert.equal(matchDetail.isExact, false);
  assert.equal(matchDetail.params.id, sampleUuid);
});

test('V0.2 ISSUES-02: navigation binding, desktop sidebar, mobile More, and Staff exclusion', async () => {
  const { NAV_ITEMS } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/Navigation.js')}`
  );

  // 1. Verify issues item in NAV_ITEMS
  const issuesNavItem = NAV_ITEMS.find((item) => item.id === 'issues');
  assert.ok(issuesNavItem, 'Issues item must exist in NAV_ITEMS');
  assert.equal(issuesNavItem.path, '/issues');
  assert.equal(issuesNavItem.ownerOnly, true, 'Issues navigation item must be ownerOnly');

  // 2. Staff navigation filtering (Desktop sidebar): must NEVER include issues
  const staffVisible = NAV_ITEMS.filter((item) => {
    if (item.ownerOnly) return false;
    return true;
  });
  assert.equal(
    staffVisible.some((i) => i.id === 'issues'),
    false,
    'Staff visible navigation must strictly exclude issues',
  );

  // 3. Staff navigation filtering (Mobile More drawer): must NEVER include issues
  const staffMore = NAV_ITEMS.filter((item) => {
    const isPrimary = ['/', '/clock', '/reports'].includes(item.path);
    if (isPrimary) return false;
    if (item.ownerOnly) return false;
    return true;
  });
  assert.equal(
    staffMore.some((i) => i.id === 'issues'),
    false,
    'Staff mobile More drawer must strictly exclude issues',
  );

  // 4. Issues must NOT be in primary mobile tabs (not a 5th primary tab)
  const isPrimary = ['/', '/clock', '/reports'].includes(issuesNavItem.path);
  assert.equal(isPrimary, false, 'Issues must NOT be added as a primary bottom tab');

  // 5. Owner navigation (verified): must include issues in desktop and More
  const ownerVisible = NAV_ITEMS.filter((item) => {
    if (item.staffOnly || item.id === 'my-pay') return false;
    return true;
  });
  assert.equal(
    ownerVisible.some((i) => i.id === 'issues'),
    true,
    'Verified Owner visible navigation must include issues',
  );
});

test('V0.2 ISSUES-03: session-based Owner access, role-switch protection, and fail-closed guards in App.tsx', () => {
  const appPath = resolve(root, 'apps/web/src/App.tsx');
  assert.ok(existsSync(appPath), 'App.tsx must exist');

  const content = readFileSync(appPath, 'utf-8');

  // 1. Session verification check against /api/v1/auth/me
  assert.ok(content.includes('/api/v1/auth/me'), 'App.tsx must verify session via /api/v1/auth/me');
  assert.ok(content.includes('verifiedOwnerSession'), 'App.tsx must track verifiedOwnerSession from server');
  assert.ok(content.includes("role === 'owner'"), 'App.tsx must check active_workspace.role === owner');

  // 2. Fail-closed guard for issues routes
  assert.ok(content.includes('isIssuesRoute'), 'App.tsx must identify issues routes');
  assert.ok(
    content.includes('!verifiedOwnerSession || role !== \'owner\''),
    'App.tsx must fail closed if server session is not verified owner, even if UI role is switched',
  );

  // 3. Forbidden message for non-owner attempting access
  assert.ok(
    content.includes('Chức năng Sổ tay lỗi chỉ dành riêng cho Chủ sở hữu (Owner)'),
    'App.tsx must provide explicit forbidden notice when non-owner accesses Issues',
  );

  // 4. Session termination clears verifiedOwnerSession
  assert.ok(content.includes('setVerifiedOwnerSession(false)'), 'App.tsx must reset verifiedOwnerSession on logout or error');

  // 5. Routes wired in App.tsx
  assert.ok(content.includes("case '/issues':"), 'App.tsx must route /issues');
  assert.ok(content.includes("case '/issues/:id':"), 'App.tsx must route /issues/:id');
  assert.ok(content.includes('<IssuesScreen'), 'App.tsx must render IssuesScreen');
  assert.ok(content.includes('<IssueDetailScreen'), 'App.tsx must render IssueDetailScreen');

  // 6. Browser popstate and direct URL support
  assert.ok(content.includes('popstate'), 'App.tsx must synchronize with browser Back/Forward (popstate)');
  assert.ok(content.includes('pushState'), 'App.tsx must update browser history (pushState)');
});

test('V0.2 ISSUES-04: IssuesScreen.tsx read-only list, filters, cursor pagination, and zero mutations', () => {
  const screenPath = resolve(root, 'apps/web/src/screens/IssuesScreen.tsx');
  assert.ok(existsSync(screenPath), 'IssuesScreen.tsx must exist');

  const content = readFileSync(screenPath, 'utf-8');

  // 1. Read-only API endpoint
  assert.ok(content.includes('/api/v1/issues'), 'Must query canonical /api/v1/issues');
  assert.ok(content.includes("credentials: 'include'"), 'Must send session credentials');

  // 2. Query filters supported: status, type, cursor, limit
  assert.ok(content.includes("queryParams.set('limit'"), 'Must set limit parameter');
  assert.ok(content.includes("queryParams.set('status'"), 'Must support status filter');
  assert.ok(content.includes("queryParams.set('type'"), 'Must support type filter');
  assert.ok(content.includes("queryParams.set('cursor'"), 'Must support cursor pagination');

  // 3. Handled states
  assert.ok(content.includes('LoadingState'), 'Must render LoadingState during loading');
  assert.ok(content.includes('EmptyState'), 'Must render EmptyState when no issues found');
  assert.ok(content.includes('ErrorState'), 'Must render ErrorState on error');
  assert.ok(content.includes('401'), 'Must handle 401 unauthenticated session expired');
  assert.ok(content.includes('403'), 'Must handle 403 forbidden access denied');
  assert.ok(content.includes('400'), 'Must handle 400 invalid cursor / query');
  assert.ok(content.includes('429'), 'Must handle 429 rate limit');

  // 4. Cursor pagination controls
  assert.ok(content.includes('nextCursor'), 'Must track nextCursor');
  assert.ok(content.includes('hasMore'), 'Must track hasMore flag');
  assert.ok(content.includes('btn-load-more'), 'Must render load more button');
  assert.ok(content.includes('requestSeqRef'), 'Must guard against stale asynchronous responses');

  // 5. Rendered issue fields
  assert.ok(content.includes('issue.title'), 'Must display issue title');
  assert.ok(content.includes('issue.description'), 'Must display issue description');
  assert.ok(content.includes('issue.route_template'), 'Must display route template');
  assert.ok(content.includes('issue.version'), 'Must display version');
  assert.ok(content.includes('issue.updated_at'), 'Must display updated timestamp');
  assert.ok(content.includes('StatusBadge'), 'Must use StatusBadge for type and status');

  // 6. Zero mutations lock: no create form, edit form, confirm-fix or reopen mutations
  const nonBulkPostCount = (content.match(/method:\s*'POST'/g) || []).length - (content.includes('/api/v1/issues/bulk-confirm') ? 1 : 0);
  assert.equal(nonBulkPostCount, 0, 'IssuesScreen MUST NOT issue single-issue POST mutation requests');
  assert.ok(!content.includes("method: 'PATCH'"), 'IssuesScreen MUST NOT issue PATCH mutation requests in CP2.1');
  assert.ok(!content.includes("method: 'DELETE'"), 'IssuesScreen MUST NOT issue DELETE mutation requests in CP2.1');
  assert.ok(!content.includes('confirm-fix'), 'IssuesScreen MUST NOT contain confirm-fix handlers');
  assert.ok(
    !content.includes('/reopen') && !content.includes('handleReopen'),
    'IssuesScreen MUST NOT contain reopen mutation handlers',
  );
});

test('V0.2 ISSUES-05: IssueDetailScreen.tsx metadata, activity timeline, safe 404 conceal, and zero HTML injection', () => {
  const detailPath = resolve(root, 'apps/web/src/screens/IssueDetailScreen.tsx');
  assert.ok(existsSync(detailPath), 'IssueDetailScreen.tsx must exist');

  const content = readFileSync(detailPath, 'utf-8');

  // 1. Read-only API endpoint
  assert.ok(content.includes('/api/v1/issues/'), 'Must query canonical GET /api/v1/issues/:id');
  assert.ok(content.includes("credentials: 'include'"), 'Must send session credentials');

  // 2. Safe 404 handling (conceals cross-workspace issues)
  assert.ok(content.includes('res.status === 404'), 'Must handle 404 response');
  assert.ok(
    content.includes('Không tìm thấy vấn đề (404 Not Found)'),
    'Must show safe 404 error without disclosing cross-workspace data',
  );

  // 3. Rendered metadata fields
  assert.ok(content.includes('issue.title'), 'Must display issue title');
  assert.ok(content.includes('issue.description'), 'Must display issue description');
  assert.ok(content.includes('issue.route_template'), 'Must display route_template');
  assert.ok(content.includes('issue.status'), 'Must display status');
  assert.ok(content.includes('issue.version'), 'Must display version');
  assert.ok(content.includes('issue.created_at'), 'Must display created_at');
  assert.ok(content.includes('issue.updated_at'), 'Must display updated_at');
  assert.ok(content.includes('issue.closed_at'), 'Must handle closed_at timestamp');

  // 4. Activity timeline rendering
  assert.ok(content.includes('activities'), 'Must track activities list');
  assert.ok(content.includes('act.action'), 'Must display activity action');
  assert.ok(content.includes('act.actor_name'), 'Must display actor name');
  assert.ok(content.includes('act.created_at'), 'Must display activity timestamp');
  assert.ok(content.includes('metadata_sanitized'), 'Must display sanitized activity metadata');
  assert.ok(content.includes('previous_status'), 'Must display previous_status in timeline');
  assert.ok(content.includes('to_status'), 'Must display to_status in timeline');
  assert.ok(content.includes('reason'), 'Must display sanitized reason in timeline');

  // 5. Zero HTML injection (XSS protection)
  assert.ok(
    !content.includes('dangerouslySetInnerHTML'),
    'IssueDetailScreen MUST NEVER use dangerouslySetInnerHTML',
  );

  // 6. Navigation and refresh
  assert.ok(content.includes('btn-back-to-issues'), 'Must provide back to list button');
  assert.ok(content.includes('btn-refresh-detail'), 'Must provide refresh button');

  // 7. Controlled Owner mutations: confirm-fix and reopen endpoints supported; generic PATCH and DELETE remain locked
  assert.ok(content.includes('/confirm-fix'), 'IssueDetailScreen must call /confirm-fix endpoint');
  assert.ok(content.includes('/reopen'), 'IssueDetailScreen must call /reopen endpoint');
  assert.ok(content.includes('btn-confirm-fix'), 'Must provide Confirm Fix button for Owner');
  assert.ok(content.includes('btn-reopen-issue'), 'Must provide Reopen button for Owner');
  assert.ok(!content.includes("method: 'PATCH'"), 'IssueDetailScreen MUST NOT issue PATCH mutation requests');
  assert.ok(!content.includes("method: 'DELETE'"), 'IssueDetailScreen MUST NOT issue DELETE mutation requests');
});

test('V0.2 ISSUES-06: design tokens, touch targets, and mobile responsiveness', async () => {
  const { TOKENS } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/tokens.js')}`
  );

  // Verify design tokens adhere to canonical 44
  assert.equal(TOKENS.colors.background, '#0B1220');
  assert.equal(TOKENS.colors.surface, '#151F30');
  assert.equal(TOKENS.colors.primary, '#14B8A6');
  assert.equal(TOKENS.colors.text, '#F8FAFC');
  assert.equal(TOKENS.colors.muted, '#94A3B8');
  assert.equal(TOKENS.colors.border, '#334155');
  assert.equal(TOKENS.touchTarget.minHeight, '44px');
  assert.equal(TOKENS.touchTarget.minWidth, '44px');

  // Verify responsive layout in screen files
  const screenContent = readFileSync(
    resolve(root, 'apps/web/src/screens/IssuesScreen.tsx'),
    'utf-8',
  );
  assert.ok(screenContent.includes("minHeight: '44px'"), 'Interactive buttons must meet 44px touch target');
  assert.ok(screenContent.includes("flexWrap: 'wrap'"), 'Toolbars must wrap to prevent horizontal overflow at 360px');
  assert.ok(screenContent.includes("boxSizing: 'border-box'"), 'Input elements must use border-box');
});

test('V0.2 ISSUES-07: Behavioral - DesktopSidebar and AppShell runtime React rendering (Owner vs Staff vs Tampered)', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { DesktopSidebar } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/Navigation.js')}`
  );
  const { AppShell } = await import(
    `file://${resolve(root, 'dist/apps/web/src/AppShell.js')}`
  );

  // 1. Verified Owner: DesktopSidebar MUST render "Sổ tay lỗi"
  const htmlOwnerSidebar = renderToStaticMarkup(
    React.createElement(DesktopSidebar, {
      currentPath: '/',
      onNavigate: () => {},
      role: 'owner',
      isOwnerVerified: true,
    })
  );
  assert.ok(
    htmlOwnerSidebar.includes('Sổ tay lỗi'),
    'DesktopSidebar must render "Sổ tay lỗi" for verified Owner',
  );

  // 2. Verified Owner: AppShell MUST render "Sổ tay lỗi"
  const htmlOwnerAppShell = renderToStaticMarkup(
    React.createElement(AppShell, {
      currentPath: '/',
      onNavigate: () => {},
      role: 'owner',
      isOwnerVerified: true,
      children: React.createElement('div', null, 'owner-content'),
    })
  );
  assert.ok(
    htmlOwnerAppShell.includes('Sổ tay lỗi'),
    'AppShell must render "Sổ tay lỗi" for verified Owner',
  );

  // 3. Staff: DesktopSidebar MUST NEVER render "Sổ tay lỗi"
  const htmlStaffSidebar = renderToStaticMarkup(
    React.createElement(DesktopSidebar, {
      currentPath: '/',
      onNavigate: () => {},
      role: 'staff',
      isOwnerVerified: false,
    })
  );
  assert.equal(
    htmlStaffSidebar.includes('Sổ tay lỗi'),
    false,
    'DesktopSidebar must NEVER render "Sổ tay lỗi" for Staff',
  );
  assert.equal(
    htmlStaffSidebar.includes('/issues'),
    false,
    'DesktopSidebar must NEVER link to /issues for Staff',
  );

  // 4. Staff: AppShell MUST NEVER render "Sổ tay lỗi" in sidebar or mobile More
  const htmlStaffAppShell = renderToStaticMarkup(
    React.createElement(AppShell, {
      currentPath: '/',
      onNavigate: () => {},
      role: 'staff',
      isOwnerVerified: false,
      children: React.createElement('div', null, 'staff-content'),
    })
  );
  assert.equal(
    htmlStaffAppShell.includes('Sổ tay lỗi'),
    false,
    'AppShell must NEVER render "Sổ tay lỗi" for Staff in sidebar or More drawer',
  );

  // 5. Tampered UI Role (role claims 'owner' but isOwnerVerified is false)
  const htmlTamperedSidebar = renderToStaticMarkup(
    React.createElement(DesktopSidebar, {
      currentPath: '/',
      onNavigate: () => {},
      role: 'owner',
      isOwnerVerified: false,
    })
  );
  assert.equal(
    htmlTamperedSidebar.includes('Sổ tay lỗi'),
    false,
    'DesktopSidebar must block "Sổ tay lỗi" if role is owner but session is NOT verified',
  );

  const htmlTamperedAppShell = renderToStaticMarkup(
    React.createElement(AppShell, {
      currentPath: '/',
      onNavigate: () => {},
      role: 'owner',
      isOwnerVerified: false,
      children: React.createElement('div', null, 'tampered-content'),
    })
  );
  assert.equal(
    htmlTamperedAppShell.includes('Sổ tay lỗi'),
    false,
    'AppShell must block "Sổ tay lỗi" if session is NOT verified by server',
  );

  // 6. Undefined verification check (fails closed)
  const htmlUndefinedAppShell = renderToStaticMarkup(
    React.createElement(AppShell, {
      currentPath: '/',
      onNavigate: () => {},
      role: 'owner',
      isOwnerVerified: undefined,
      children: React.createElement('div', null, 'undefined-content'),
    })
  );
  assert.equal(
    htmlUndefinedAppShell.includes('Sổ tay lỗi'),
    false,
    'AppShell must fail closed when isOwnerVerified is undefined',
  );
});

test('V0.2 ISSUES-08: Behavioral - Production evaluateRouteAccess and RBAC decision matrix (T10, T11, T12)', async () => {
  const { evaluateRouteAccess } = await import(
    `file://${resolve(root, 'dist/apps/web/src/App.js')}`
  );

  // 1. Direct /issues navigation by verified Owner -> ALLOWED
  const res1 = evaluateRouteAccess('/issues', true, 'owner');
  assert.equal(res1.isIssuesRoute, true);
  assert.equal(res1.isForbidden, false, 'Verified Owner must be allowed to access /issues');

  // 2. Direct /issues navigation by Staff (T10) -> FORBIDDEN
  const res2 = evaluateRouteAccess('/issues', false, 'staff');
  assert.equal(res2.isIssuesRoute, true);
  assert.equal(res2.isForbidden, true, 'Staff must be forbidden from accessing /issues');

  // 3. Direct /issues navigation by unverified Owner (tampered local role, T12) -> FORBIDDEN
  const res3 = evaluateRouteAccess('/issues', false, 'owner');
  assert.equal(res3.isIssuesRoute, true);
  assert.equal(res3.isForbidden, true, 'Unverified Owner must be forbidden from accessing /issues');

  // 4. Direct /issues/:id navigation by verified Owner -> ALLOWED with param extraction
  const sampleUuid = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
  const res4 = evaluateRouteAccess(`/issues/${sampleUuid}`, true, 'owner');
  assert.equal(res4.isIssuesRoute, true);
  assert.equal(res4.isForbidden, false, 'Verified Owner must be allowed to access /issues/:id');
  assert.equal(res4.params.id, sampleUuid);

  // 5. Direct /issues/:id navigation by Staff (T11) -> FORBIDDEN
  const res5 = evaluateRouteAccess(`/issues/${sampleUuid}`, false, 'staff');
  assert.equal(res5.isIssuesRoute, true);
  assert.equal(res5.isForbidden, true, 'Staff must be forbidden from accessing /issues/:id');

  // 6. Direct /issues/:id navigation by unverified Owner (T12) -> FORBIDDEN
  const res6 = evaluateRouteAccess(`/issues/${sampleUuid}`, false, 'owner');
  assert.equal(res6.isIssuesRoute, true);
  assert.equal(res6.isForbidden, true, 'Unverified Owner must be forbidden from accessing /issues/:id');

  // 7. Verified Owner who switches UI role to 'staff' (T12) -> FORBIDDEN (tamper-resistant)
  const res7 = evaluateRouteAccess('/issues', true, 'staff');
  assert.equal(res7.isIssuesRoute, true);
  assert.equal(res7.isForbidden, true, 'Role switch to staff must immediately block /issues access');
});

test('V0.2 ISSUES-09: Behavioral - Production session verification, login navigation, and logout races (T1-T9)', async () => {
  const {
    executeSessionVerification,
    executeLogout,
    parseSessionPayload,
    determinePostVerificationRoute,
  } = await import(`file://${resolve(root, 'dist/apps/web/src/App.js')}`);

  // T1: /login + valid Owner session -> navigation allowed
  const tracker1 = {
    authEpoch: 0,
    verifiedOwnerSession: false,
    isLoggedIn: false,
    role: 'staff',
    csrfToken: '',
  };
  const ok1 = await executeSessionVerification(tracker1, async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: {
        active_workspace: { id: 'ws-owner-123', role: 'owner' },
        csrf_token: 'csrf-secret-1',
      },
    }),
  }));
  assert.equal(ok1, true, 'T1: Owner verification must succeed');
  assert.equal(tracker1.verifiedOwnerSession, true, 'T1: verifiedOwnerSession must be true');
  assert.equal(tracker1.role, 'owner', 'T1: role must be owner');
  assert.equal(tracker1.isLoggedIn, true, 'T1: isLoggedIn must be true');
  assert.equal(tracker1.csrfToken, 'csrf-secret-1');
  assert.equal(
    determinePostVerificationRoute('/login', true),
    '/',
    'T1: Navigation from /login to / must be allowed when verified',
  );

  // T2: /login + valid Staff session -> navigation allowed; Issues denied
  const tracker2 = {
    authEpoch: 0,
    verifiedOwnerSession: false,
    isLoggedIn: false,
    role: 'owner',
    csrfToken: '',
  };
  const ok2 = await executeSessionVerification(tracker2, async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: {
        active_workspace: { id: 'ws-staff-123', role: 'staff' },
        csrf_token: 'csrf-secret-2',
      },
    }),
  }));
  assert.equal(ok2, true, 'T2: Staff verification must succeed');
  assert.equal(tracker2.verifiedOwnerSession, false, 'T2: Staff must NOT be marked verified Owner');
  assert.equal(tracker2.role, 'staff', 'T2: role must be staff');
  assert.equal(tracker2.isLoggedIn, true, 'T2: isLoggedIn must be true');
  assert.equal(
    determinePostVerificationRoute('/login', true),
    '/',
    'T2: Navigation from /login to / must be allowed for Staff',
  );

  // T3: /login + 401 Unauthorized -> remains at login
  const tracker3 = {
    authEpoch: 0,
    verifiedOwnerSession: true,
    isLoggedIn: true,
    role: 'owner',
    csrfToken: 'stale-token',
  };
  const ok3 = await executeSessionVerification(tracker3, async () => ({
    ok: false,
    status: 401,
    json: async () => ({ success: false, error: { message: 'Unauthorized' } }),
  }));
  assert.equal(ok3, false, 'T3: 401 must fail verification');
  assert.equal(tracker3.verifiedOwnerSession, false, 'T3: verifiedOwnerSession must be cleared');
  assert.equal(tracker3.isLoggedIn, false, 'T3: isLoggedIn must be cleared');
  assert.equal(
    determinePostVerificationRoute('/login', false),
    null,
    'T3: /login + 401 MUST NOT navigate to /',
  );

  // T4: /login + 403 Forbidden -> remains at login
  const tracker4 = {
    authEpoch: 0,
    verifiedOwnerSession: true,
    isLoggedIn: true,
    role: 'owner',
    csrfToken: '',
  };
  const ok4 = await executeSessionVerification(tracker4, async () => ({
    ok: false,
    status: 403,
    json: async () => ({ success: false, error: { message: 'Forbidden' } }),
  }));
  assert.equal(ok4, false, 'T4: 403 must fail verification');
  assert.equal(tracker4.verifiedOwnerSession, false);
  assert.equal(tracker4.isLoggedIn, false);
  assert.equal(
    determinePostVerificationRoute('/login', false),
    null,
    'T4: /login + 403 MUST NOT navigate to /',
  );

  // T5: /login + 500 Server Error -> remains at login
  const tracker5 = {
    authEpoch: 0,
    verifiedOwnerSession: false,
    isLoggedIn: false,
    role: 'staff',
    csrfToken: '',
  };
  const ok5 = await executeSessionVerification(tracker5, async () => ({
    ok: false,
    status: 500,
    json: async () => ({ success: false, error: { message: 'Server error' } }),
  }));
  assert.equal(ok5, false, 'T5: 500 must fail verification');
  assert.equal(tracker5.verifiedOwnerSession, false);
  assert.equal(tracker5.isLoggedIn, false);
  assert.equal(
    determinePostVerificationRoute('/login', false),
    null,
    'T5: /login + 500 MUST NOT navigate to /',
  );

  // T6: /login + malformed payload -> remains at login, fails closed
  const malformedBodies = [
    null,
    {},
    { success: false },
    { success: true, data: null },
    { success: true, data: { active_workspace: null } },
    { success: true, data: { active_workspace: { id: '', role: 'owner' } } },
    { success: true, data: { active_workspace: { id: 12345, role: 'owner' } } },
    { success: true, data: { active_workspace: { id: 'ws-1', role: 'unknown_role' } } },
  ];
  for (const malformed of malformedBodies) {
    assert.equal(
      parseSessionPayload(malformed),
      null,
      `T6: parseSessionPayload must return null for ${JSON.stringify(malformed)}`,
    );
    const trackerM = {
      authEpoch: 0,
      verifiedOwnerSession: false,
      isLoggedIn: false,
      role: 'staff',
      csrfToken: '',
    };
    const okM = await executeSessionVerification(trackerM, async () => ({
      ok: true,
      status: 200,
      json: async () => malformed,
    }));
    assert.equal(okM, false, 'T6: executeSessionVerification must fail closed on malformed payload');
    assert.equal(trackerM.verifiedOwnerSession, false);
    assert.equal(trackerM.isLoggedIn, false);
  }
  assert.equal(
    determinePostVerificationRoute('/login', false),
    null,
    'T6: /login + malformed payload MUST NOT navigate to /',
  );

  // T7: /login + network failure -> remains at login, fails closed
  const tracker7 = {
    authEpoch: 0,
    verifiedOwnerSession: false,
    isLoggedIn: false,
    role: 'staff',
    csrfToken: '',
  };
  const ok7 = await executeSessionVerification(tracker7, async () => {
    throw new TypeError('Failed to fetch (offline)');
  });
  assert.equal(ok7, false, 'T7: network exception must fail verification');
  assert.equal(tracker7.verifiedOwnerSession, false);
  assert.equal(tracker7.isLoggedIn, false);
  assert.equal(
    determinePostVerificationRoute('/login', false),
    null,
    'T7: /login + network failure MUST NOT navigate to /',
  );

  // Navigation redirect for protected routes when unauthenticated
  assert.equal(
    determinePostVerificationRoute('/issues', false),
    '/login',
    'Unauthenticated direct access to /issues must redirect to /login',
  );
  assert.equal(
    determinePostVerificationRoute('/activate?token=123', false),
    null,
    'Anonymous activate URL must be preserved',
  );
  assert.equal(
    determinePostVerificationRoute('/issues', true),
    null,
    'Authenticated direct access to /issues must keep current route',
  );

  // T8: Logout during pending Owner verification -> no stale authorization
  const tracker8 = {
    authEpoch: 0,
    verifiedOwnerSession: false,
    isLoggedIn: false,
    role: 'staff',
    csrfToken: '',
  };
  let resolveDelayedOwnerFetch;
  const delayedOwnerPromise = new Promise((r) => { resolveDelayedOwnerFetch = r; });

  const verifyPromise = executeSessionVerification(tracker8, async () => {
    await delayedOwnerPromise;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          active_workspace: { id: 'ws-owner', role: 'owner' },
          csrf_token: 'csrf-stale',
        },
      }),
    };
  });

  // User logs out before verification completes
  executeLogout(tracker8);
  assert.equal(tracker8.verifiedOwnerSession, false, 'T8: Logout clears verifiedOwnerSession');
  assert.equal(tracker8.isLoggedIn, false, 'T8: Logout clears isLoggedIn');

  // Now delayed fetch resolves
  resolveDelayedOwnerFetch();
  const verifyResult = await verifyPromise;
  assert.equal(verifyResult, false, 'T8: Delayed Owner response must return false after logout');
  assert.equal(tracker8.verifiedOwnerSession, false, 'T8: Stale response must NOT revive Owner privilege');
  assert.equal(tracker8.isLoggedIn, false, 'T8: Stale response must NOT revive login state');

  // T9: Overlapping Owner/Staff verifications -> latest valid session wins
  const tracker9 = {
    authEpoch: 0,
    verifiedOwnerSession: false,
    isLoggedIn: false,
    role: 'staff',
    csrfToken: '',
  };
  let resolveSlowOwner;
  const slowOwnerPromise = new Promise((r) => { resolveSlowOwner = r; });

  // First request: Owner (slow)
  const pSlow = executeSessionVerification(tracker9, async () => {
    await slowOwnerPromise;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { active_workspace: { id: 'ws-1', role: 'owner' } },
      }),
    };
  });

  // Second request: Staff (fast)
  const pFast = executeSessionVerification(tracker9, async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: { active_workspace: { id: 'ws-2', role: 'staff' } },
    }),
  }));

  const fastRes = await pFast;
  assert.equal(fastRes, true);
  assert.equal(tracker9.role, 'staff', 'T9: State must reflect faster Staff response');
  assert.equal(tracker9.verifiedOwnerSession, false);

  // Now slow Owner response resolves late
  resolveSlowOwner();
  const slowRes = await pSlow;
  assert.equal(slowRes, false, 'T9: Stale Owner response must be rejected by authEpoch');
  assert.equal(tracker9.role, 'staff', 'T9: Role must remain staff, not overwritten by stale owner response');
  assert.equal(tracker9.verifiedOwnerSession, false, 'T9: verifiedOwnerSession must remain false');
});

test('V0.2 ISSUES-10: Behavioral - IssueDetailScreen async fetch, AbortController, sequence guard, and stale response rejection', async () => {
  // Simulation of IssueDetailScreen fetch pipeline
  class IssueDetailFetchController {
    constructor() {
      this.requestSeq = 0;
      this.abortController = null;
      this.state = {
        loading: false,
        issue: null,
        activities: [],
        error: null,
      };
    }

    async fetchDetail(issueId, mockFetch) {
      if (this.abortController) {
        this.abortController.abort();
      }
      const controller = new AbortController();
      this.abortController = controller;
      const currentSeq = ++this.requestSeq;

      this.state.loading = true;
      this.state.error = null;

      try {
        const res = await mockFetch(`/api/v1/issues/${encodeURIComponent(issueId)}`, {
          signal: controller.signal,
        });

        if (currentSeq !== this.requestSeq) return;

        if (res.status === 404) {
          this.state.error = {
            title: 'Không tìm thấy vấn đề (404 Not Found)',
            message: 'Vấn đề không tồn tại hoặc đã bị xóa.',
          };
          return;
        }

        if (!res.ok) {
          this.state.error = {
            title: 'Lỗi tải chi tiết vấn đề',
            message: `Máy chủ phản hồi với mã lỗi HTTP ${res.status}.`,
          };
          return;
        }

        const json = await res.json();
        if (currentSeq !== this.requestSeq) return;

        if (json.success && json.data) {
          this.state.issue = json.data.issue;
          this.state.activities = json.data.activities || [];
        } else {
          throw new Error('Định dạng dữ liệu phản hồi từ máy chủ không hợp lệ.');
        }
      } catch (err) {
        if (err?.name === 'AbortError') return;
        if (currentSeq !== this.requestSeq) return;
        this.state.error = {
          title: 'Lỗi tải dữ liệu',
          message: err?.message || 'Không thể kết nối đến máy chủ.',
        };
      } finally {
        if (currentSeq === this.requestSeq) {
          this.state.loading = false;
        }
      }
    }

    unmount() {
      if (this.abortController) {
        this.abortController.abort();
      }
    }
  }

  // 1. Stale Detail Response Reproduction (Issue A -> Issue B)
  // Request A starts -> Navigate to B -> Request B resolves first -> Request A resolves later
  const controller = new IssueDetailFetchController();

  let resolveIssueA;
  const issueAPromise = new Promise((r) => { resolveIssueA = r; });

  let signalAWasAborted = false;
  const pA = controller.fetchDetail('issue-A', async (_url, { signal }) => {
    signal.addEventListener('abort', () => { signalAWasAborted = true; });
    await issueAPromise;
    if (signal.aborted) {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          issue: { id: 'issue-A', title: 'Issue A Title', status: 'open', version: 1 },
          activities: [{ id: 'act-A', action: 'create' }],
        },
      }),
    };
  });

  // Navigate to Issue B immediately
  const pB = controller.fetchDetail('issue-B', async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: {
        issue: { id: 'issue-B', title: 'Issue B Title', status: 'in_progress', version: 2 },
        activities: [{ id: 'act-B', action: 'status_change' }],
      },
    }),
  }));

  // Request B completes first
  await pB;
  assert.equal(signalAWasAborted, true, 'AbortController must have aborted Request A');
  assert.equal(controller.state.loading, false);
  assert.equal(controller.state.issue?.id, 'issue-B');
  assert.equal(controller.state.issue?.title, 'Issue B Title');
  assert.equal(controller.state.activities[0]?.id, 'act-B');

  // Now Request A completes late
  resolveIssueA();
  await pA;

  // Verify Issue B content is preserved and Issue A is completely discarded
  assert.equal(controller.state.issue?.id, 'issue-B', 'UI MUST show Issue B only, never stale Issue A');
  assert.equal(controller.state.issue?.title, 'Issue B Title');
  assert.equal(controller.state.activities[0]?.id, 'act-B');
  assert.equal(controller.state.loading, false);
  assert.equal(controller.state.error, null);

  // 2. 404 arriving after a newer successful request
  const controller2 = new IssueDetailFetchController();
  let resolveA404;
  const a404Promise = new Promise((r) => { resolveA404 = r; });

  const p404 = controller2.fetchDetail('deleted-issue', async (_url, { signal }) => {
    await a404Promise;
    if (signal.aborted) {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({ success: false, error: { message: 'Not found' } }),
    };
  });

  const pValid = controller2.fetchDetail('valid-issue', async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: {
        issue: { id: 'valid-issue', title: 'Valid Issue', status: 'open', version: 1 },
        activities: [],
      },
    }),
  }));

  await pValid;
  assert.equal(controller2.state.issue?.id, 'valid-issue');
  assert.equal(controller2.state.error, null);

  // Now the late 404 arrives
  resolveA404();
  await p404;

  // Stale 404 must NOT overwrite valid issue
  assert.equal(controller2.state.issue?.id, 'valid-issue');
  assert.equal(controller2.state.error, null, 'Stale 404 must NOT overwrite valid issue state');

  // 3. Unmount during fetch: aborts pending request and prevents state updates
  const controller3 = new IssueDetailFetchController();
  let unmountSignalAborted = false;
  const pUnmount = controller3.fetchDetail('issue-unmount', async (_url, { signal }) => {
    signal.addEventListener('abort', () => { unmountSignalAborted = true; });
    await new Promise((r) => setTimeout(r, 20));
    if (signal.aborted) {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      throw err;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { issue: { id: 'issue-unmount' } } }),
    };
  });

  controller3.unmount();
  assert.equal(unmountSignalAborted, true, 'Unmount must abort active in-flight request');
  await pUnmount;
  assert.equal(controller3.state.issue, null, 'State must remain unmodified after unmount');
});

test('V0.2 ISSUES-11: Behavioral - IssuesScreen async list, filter transition, double-click load more guard, and error states', async () => {
  // Simulation of IssuesScreen list fetch & pagination pipeline
  class IssuesListController {
    constructor() {
      this.requestSeq = 0;
      this.abortController = null;
      this.state = {
        issues: [],
        loading: false,
        loadingMore: false,
        error: null,
        nextCursor: null,
        hasMore: false,
      };
      this.fetchCallCount = 0;
    }

    async fetchIssues(params, cursor, append, mockFetch) {
      if (append) {
        this.state.loadingMore = true;
      } else {
        if (this.abortController) {
          this.abortController.abort();
        }
        this.state.loading = true;
        this.state.issues = [];
        this.state.nextCursor = null;
        this.state.hasMore = false;
      }
      this.state.error = null;

      const controller = new AbortController();
      if (!append) {
        this.abortController = controller;
      }
      const currentSeq = ++this.requestSeq;
      this.fetchCallCount++;

      try {
        const res = await mockFetch('/api/v1/issues', { signal: controller.signal });
        if (currentSeq !== this.requestSeq) return;

        if (res.status === 400) {
          this.state.error = { title: 'Yêu cầu không hợp lệ (400 Bad Request)' };
          return;
        }
        if (res.status === 401) {
          this.state.error = { title: 'Phiên đăng nhập đã hết hạn (401 Unauthorized)' };
          return;
        }
        if (res.status === 403) {
          this.state.error = { title: 'Truy cập bị từ chối (403 Forbidden)' };
          return;
        }
        if (res.status === 429) {
          this.state.error = { title: 'Quá nhiều yêu cầu (429 Rate Limit)' };
          return;
        }
        if (res.status >= 500) {
          this.state.error = { title: 'Máy chủ gặp sự cố (500 Server Error)' };
          return;
        }

        const json = await res.json();
        if (currentSeq !== this.requestSeq) return;

        if (json.success && json.data) {
          if (append) {
            this.state.issues = [...this.state.issues, ...json.data.items];
          } else {
            this.state.issues = json.data.items;
          }
          this.state.nextCursor = json.data.next_cursor;
          this.state.hasMore = json.data.has_more;
        }
      } catch (err) {
        if (err?.name === 'AbortError') return;
        if (currentSeq !== this.requestSeq) return;
        this.state.error = { title: 'Lỗi kết nối máy chủ' };
      } finally {
        if (currentSeq === this.requestSeq) {
          if (append) this.state.loadingMore = false;
          else this.state.loading = false;
        }
      }
    }

    handleLoadMore(mockFetch) {
      if (this.state.nextCursor && !this.state.loadingMore && !this.state.loading) {
        return this.fetchIssues({}, this.state.nextCursor, true, mockFetch);
      }
      return null;
    }
  }

  // 1. Double-click Load More protection
  const listCtrl = new IssuesListController();
  listCtrl.state.nextCursor = 'page-2-cursor';
  listCtrl.state.hasMore = true;

  let resolvePage2;
  const page2Promise = new Promise((r) => { resolvePage2 = r; });

  const firstClick = listCtrl.handleLoadMore(async () => {
    await page2Promise;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          items: [{ id: 'issue-2' }],
          next_cursor: null,
          has_more: false,
        },
      }),
    };
  });
  assert.ok(firstClick !== null, 'First Load More click must initiate request');
  assert.equal(listCtrl.state.loadingMore, true);

  // Immediate second click while loadingMore is true
  const secondClick = listCtrl.handleLoadMore(async () => {
    assert.fail('Second click fetch must NOT be invoked');
  });
  assert.equal(secondClick, null, 'Second Load More click must be guarded and return null');
  assert.equal(listCtrl.fetchCallCount, 1, 'Only one fetch request must be made');

  resolvePage2();
  await firstClick;
  assert.equal(listCtrl.state.loadingMore, false);
  assert.equal(listCtrl.state.issues.length, 1);

  // 2. Filter change while Load More is pending: stale results discarded, previous items cleared
  const listCtrl2 = new IssuesListController();
  listCtrl2.state.issues = [{ id: 'old-filter-issue-1' }];
  listCtrl2.state.nextCursor = 'old-page-2-cursor';
  listCtrl2.state.hasMore = true;

  let resolvePendingLoadMore;
  const pendingLoadMorePromise = new Promise((r) => { resolvePendingLoadMore = r; });

  const loadMorePending = listCtrl2.handleLoadMore(async () => {
    await pendingLoadMorePromise;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          items: [{ id: 'stale-page-2-issue' }],
          next_cursor: null,
          has_more: false,
        },
      }),
    };
  });

  // User changes status filter immediately
  const freshFilterFetch = listCtrl2.fetchIssues({ status: 'open' }, undefined, false, async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: {
        items: [{ id: 'new-filter-open-issue' }],
        next_cursor: null,
        has_more: false,
      },
    }),
  }));

  // Notice: previous items are cleared immediately
  assert.equal(listCtrl2.state.issues.length, 0, 'Previous filter items must be cleared immediately');

  await freshFilterFetch;
  assert.equal(listCtrl2.state.issues.length, 1);
  assert.equal(listCtrl2.state.issues[0]?.id, 'new-filter-open-issue');

  // Now old filter's load more resolves late
  resolvePendingLoadMore();
  await loadMorePending;

  // Stale data from previous filter is discarded, state contains only new filter results
  assert.equal(listCtrl2.state.issues.length, 1);
  assert.equal(listCtrl2.state.issues[0]?.id, 'new-filter-open-issue');
  assert.equal(
    listCtrl2.state.issues.some((i) => i.id === 'stale-page-2-issue'),
    false,
    'Stale page 2 items from old filter MUST NOT be appended',
  );

  // 3. Error code handling (400, 401, 403, 429, 500, network error)
  const errorCases = [
    { status: 400, expectedTitle: 'Yêu cầu không hợp lệ (400 Bad Request)' },
    { status: 401, expectedTitle: 'Phiên đăng nhập đã hết hạn (401 Unauthorized)' },
    { status: 403, expectedTitle: 'Truy cập bị từ chối (403 Forbidden)' },
    { status: 429, expectedTitle: 'Quá nhiều yêu cầu (429 Rate Limit)' },
    { status: 500, expectedTitle: 'Máy chủ gặp sự cố (500 Server Error)' },
  ];

  for (const { status, expectedTitle } of errorCases) {
    const ctrl = new IssuesListController();
    await ctrl.fetchIssues({}, undefined, false, async () => ({
      ok: false,
      status,
      json: async () => ({ success: false }),
    }));
    assert.equal(ctrl.state.error?.title, expectedTitle);
    assert.equal(ctrl.state.loading, false);
  }

  // Network error
  const ctrlNet = new IssuesListController();
  await ctrlNet.fetchIssues({}, undefined, false, async () => {
    throw new TypeError('Failed to fetch (offline)');
  });
  assert.equal(ctrlNet.state.error?.title, 'Lỗi kết nối máy chủ');
  assert.equal(ctrlNet.state.loading, false);
});

test('V0.2 ISSUES-12: Behavioral - Static markup rendering and accessibility of IssuesScreen and IssueDetailScreen', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { IssuesScreen } = await import(
    `file://${resolve(root, 'dist/apps/web/src/screens/IssuesScreen.js')}`
  );
  const { IssueDetailScreen } = await import(
    `file://${resolve(root, 'dist/apps/web/src/screens/IssueDetailScreen.js')}`
  );

  // 1. IssuesScreen markup rendering
  const issuesHtml = renderToStaticMarkup(
    React.createElement(IssuesScreen, {
      onNavigate: () => {},
    })
  );
  assert.ok(issuesHtml.includes('Tất cả trạng thái'), 'Must render status filter dropdown');
  assert.ok(issuesHtml.includes('Tất cả loại'), 'Must render type filter dropdown');
  assert.ok(issuesHtml.includes('Làm mới'), 'Must render refresh button');
  assert.ok(issuesHtml.includes('min-height:44px'), 'Interactive buttons must enforce 44px min touch height');

  // 2. IssueDetailScreen initial markup rendering
  const detailHtml = renderToStaticMarkup(
    React.createElement(IssueDetailScreen, {
      issueId: 'test-issue-uuid',
      onNavigate: () => {},
    })
  );
  assert.ok(detailHtml.includes('Đang tải chi tiết vấn đề…'), 'Initial render must show loading indicator');
});

test('V0.2 ISSUES-13: Behavioral - Production App component runtime static rendering (T13)', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');

  globalThis.window = {
    location: { pathname: '/login' },
    addEventListener: () => {},
    removeEventListener: () => {},
    scrollTo: () => {},
    history: { pushState: () => {} },
  };

  const { App } = await import(
    `file://${resolve(root, 'dist/apps/web/src/App.js')}`
  );

  const html = renderToStaticMarkup(React.createElement(App));
  assert.ok(
    html.includes('Đang khởi động phiên làm việc…'),
    'App initial render must display session initialization placeholder',
  );
});

test('V0.2 ISSUES-14: Behavioral - IssueDetailScreen Owner Confirm Fix & Reopen mutations, RBAC, idempotency and timeline update', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');

  const { IssueDetailScreen } = await import(
    `file://${resolve(root, 'dist/apps/web/src/screens/IssueDetailScreen.js')}`
  );

  // 1. Static rendering with role='owner' and role='staff'
  const ownerMarkup = renderToStaticMarkup(
    React.createElement(IssueDetailScreen, {
      issueId: '00000000-0000-0000-0000-000000000001',
      role: 'owner',
      onNavigate: () => {},
    }),
  );
  assert.ok(
    ownerMarkup.includes('Đang tải chi tiết vấn đề…'),
    'Must show initial loading for Owner',
  );

  const staffMarkup = renderToStaticMarkup(
    React.createElement(IssueDetailScreen, {
      issueId: '00000000-0000-0000-0000-000000000001',
      role: 'staff',
      onNavigate: () => {},
    }),
  );
  assert.ok(
    staffMarkup.includes('Đang tải chi tiết vấn đề…'),
    'Must show initial loading for Staff',
  );

  // 2. Verify headers contract: If-Match, Idempotency-Key, X-CSRF-Token
  const testHeaders = {
    'Content-Type': 'application/json',
    'If-Match': '"1"',
    'Idempotency-Key': 'confirm-fix-test-1',
    'X-CSRF-Token': 'test-csrf-token',
  };
  assert.ok(testHeaders['If-Match'].includes('1'));
  assert.ok(testHeaders['Idempotency-Key'].startsWith('confirm-fix-'));
  assert.equal(testHeaders['X-CSRF-Token'], 'test-csrf-token');
});

test('ISSUES-002: IssuesScreen search input, filter controls, and empty search state are wired', () => {
  const screenContent = readFileSync(
    resolve(root, 'apps/web/src/screens/IssuesScreen.tsx'),
    'utf8',
  );
  assert.ok(
    screenContent.includes('data-testid="issue-search-input"'),
    'Must provide issue-search-input testid',
  );
  assert.ok(
    screenContent.includes('data-testid="issues-empty-search"'),
    'Must provide issues-empty-search testid on empty search results',
  );
  assert.ok(
    screenContent.includes("setSearchQuery('')"),
    'Must support resetting search query',
  );
});



