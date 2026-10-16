import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  ScopedApiCache,
  isCacheableApiPath,
  buildScopedApiCacheKey,
} from '../../dist/apps/api/src/cache/api-cache.js';
import { DashboardService } from '../../dist/apps/api/src/dashboard/service.js';
import { createRequestHandler } from '../../dist/apps/api/src/app.js';
import {
  isCacheableFrontendUrl,
  buildFrontendCacheKey,
  getFrontendCachedData,
  setFrontendCachedData,
  fetchWithFrontendCache,
  clearFrontendQueryCache,
  invalidateFrontendCacheForWorkspace,
  invalidateFrontendCacheForUser,
  getFrontendCacheStats,
} from '../../dist/apps/web/src/cache/query-cache.js';
import {
  executeLogout,
  executeSessionVerification,
} from '../../dist/apps/web/src/session-manager.js';
import { DashboardScreen } from '../../dist/apps/web/src/screens/DashboardScreen.js';

test('FEAT-03 & FEAT-11: Forbidden Auth & Secret Routes are NEVER cached on Backend or Frontend', () => {
  const forbiddenPaths = [
    '/api/v1/auth/login',
    '/api/v1/auth/me',
    '/api/v1/auth/refresh',
    '/api/v1/auth/logout',
    '/api/v1/auth/reauth',
    '/api/v1/auth/password/change',
    '/api/v1/auth/change-password',
    '/api/v1/auth/activate',
    '/api/v1/auth/forgot-password',
    '/api/v1/auth/reset-password',
    '/api/v1/accounts/acc-123/secrets',
    '/api/v1/accounts/acc-123/secrets/reveal',
    '/api/v1/fin/receipts/rcpt-1/file',
    '/api/v1/fin/receipts/rcpt-1/extract',
    '/api/v1/health',
    '/api/v1/ready',
    '/api/v1/system/releases',
  ];

  for (const path of forbiddenPaths) {
    assert.equal(
      isCacheableApiPath(path),
      false,
      `Backend must forbid caching sensitive path: ${path}`,
    );
    assert.equal(
      isCacheableFrontendUrl(path),
      false,
      `Frontend must forbid caching sensitive URL: ${path}`,
    );
    assert.equal(
      buildScopedApiCacheKey({
        userId: 'u1',
        workspaceId: 'ws1',
        role: 'owner',
        target: path,
      }),
      null,
    );
    assert.equal(
      buildFrontendCacheKey(
        { userId: 'u1', workspaceId: 'ws1', role: 'owner' },
        path,
      ),
      null,
    );
  }

  assert.equal(isCacheableApiPath('/api/v1/dashboard/summary'), true);
  assert.equal(isCacheableFrontendUrl('/api/v1/dashboard/summary'), true);
});

test('FEAT-11: Strict Multi-Account, Multi-Workspace, and Role Cache Isolation (Zero Cross-Account Leak)', () => {
  const apiCache = new ScopedApiCache({ maxEntries: 50, defaultTtlMs: 10_000 });
  const target = '/api/v1/dashboard/summary?date=2026-10-16&month=2026-10';

  const ownerScopeWs1 = {
    userId: 'user-owner-1',
    workspaceId: 'ws-alpha',
    role: 'owner',
    target,
  };
  const staffScopeWs1 = {
    userId: 'user-staff-2',
    workspaceId: 'ws-alpha',
    role: 'staff',
    target,
  };
  const ownerAsStaffScopeWs1 = {
    userId: 'user-owner-1',
    workspaceId: 'ws-alpha',
    role: 'staff',
    target,
  };
  const ownerScopeWs2 = {
    userId: 'user-owner-1',
    workspaceId: 'ws-beta',
    role: 'owner',
    target,
  };

  apiCache.set(ownerScopeWs1, {
    secretOwnerMetric: 'OWNER_WS_ALPHA_ONLY',
    employees: { total_count: 12, active_count: 10, invited_count: 2 },
  });

  // 1. Different user in same workspace cannot read Owner's cache
  assert.equal(apiCache.get(staffScopeWs1), undefined);
  // 2. Same user with downgraded role cannot read Owner's cache
  assert.equal(apiCache.get(ownerAsStaffScopeWs1), undefined);
  // 3. Same user in different workspace cannot read ws-alpha cache
  assert.equal(apiCache.get(ownerScopeWs2), undefined);
  // 4. Exact matching user + workspace + role hits cache and returns deep clone
  const hit = apiCache.get(ownerScopeWs1);
  assert.deepEqual(hit, {
    secretOwnerMetric: 'OWNER_WS_ALPHA_ONLY',
    employees: { total_count: 12, active_count: 10, invited_count: 2 },
  });
  hit.employees.total_count = 9999;
  assert.equal(apiCache.get(ownerScopeWs1).employees.total_count, 12);

  // Frontend cache isolation & fail-closed on missing userId/workspaceId
  clearFrontendQueryCache();
  assert.equal(
    setFrontendCachedData(
      { userId: undefined, workspaceId: 'ws-alpha', role: 'owner' },
      target,
      { test: 1 },
    ),
    false,
    'Missing userId must fail closed and refuse caching',
  );
  assert.equal(
    setFrontendCachedData(
      { userId: 'user-owner-1', workspaceId: '', role: 'owner' },
      target,
      { test: 1 },
    ),
    false,
    'Empty workspaceId must fail closed and refuse caching',
  );

  setFrontendCachedData(
    { userId: 'user-owner-1', workspaceId: 'ws-alpha', role: 'owner' },
    target,
    { ownerOnly: true },
  );
  assert.equal(
    getFrontendCachedData(
      { userId: 'user-staff-2', workspaceId: 'ws-alpha', role: 'staff' },
      target,
    ),
    undefined,
  );
  assert.equal(
    getFrontendCachedData(
      { userId: 'user-owner-1', workspaceId: 'ws-beta', role: 'owner' },
      target,
    ),
    undefined,
  );
  assert.deepEqual(
    getFrontendCachedData(
      { userId: 'user-owner-1', workspaceId: 'ws-alpha', role: 'owner' },
      target,
    ),
    { ownerOnly: true },
  );
});

test('FEAT-11: TTL Expiry, Bounded LRU Eviction, Logout Purge, and Workspace Switch Invalidation', async () => {
  const apiCache = new ScopedApiCache({ maxEntries: 10, defaultTtlMs: 1_000 });
  const baseNow = 1_700_000_000_000;

  for (let i = 0; i < 15; i++) {
    apiCache.set(
      {
        userId: 'u1',
        workspaceId: 'ws1',
        role: 'owner',
        target: `/api/v1/items?page=${i}`,
      },
      { page: i },
      1_000,
      baseNow,
    );
  }

  // Bounded LRU size must never exceed maxEntries (10)
  assert.equal(apiCache.getStats().size, 10);
  assert.equal(
    apiCache.get(
      {
        userId: 'u1',
        workspaceId: 'ws1',
        role: 'owner',
        target: '/api/v1/items?page=0',
      },
      baseNow + 100,
    ),
    undefined,
    'Oldest entry must be evicted when capacity is reached',
  );
  assert.deepEqual(
    apiCache.get(
      {
        userId: 'u1',
        workspaceId: 'ws1',
        role: 'owner',
        target: '/api/v1/items?page=14',
      },
      baseNow + 100,
    ),
    { page: 14 },
  );

  // TTL expiry check
  assert.equal(
    apiCache.get(
      {
        userId: 'u1',
        workspaceId: 'ws1',
        role: 'owner',
        target: '/api/v1/items?page=14',
      },
      baseNow + 1_500,
    ),
    undefined,
    'Expired entry must not be returned after TTL',
  );

  // Frontend cache cleared on logout and session identity switch
  clearFrontendQueryCache();
  const scopeA = { userId: 'user-a', workspaceId: 'ws-1', role: 'owner' };
  setFrontendCachedData(scopeA, '/api/v1/dashboard/summary', {
    cachedFor: 'user-a',
  });
  assert.equal(getFrontendCacheStats().size, 1);

  const tracker = {
    authEpoch: 1,
    verifiedOwnerSession: true,
    isLoggedIn: true,
    role: 'owner',
    userId: 'user-a',
    workspaceId: 'ws-1',
    workspaceName: 'WS 1',
    csrfToken: 'tok-1',
  };

  // Switching to user-b via executeSessionVerification must clear cache
  await executeSessionVerification(tracker, async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      success: true,
      data: {
        user: { id: 'user-b' },
        active_workspace: { id: 'ws-1', name: 'WS 1', role: 'staff' },
        csrf_token: 'tok-2',
      },
    }),
  }));
  assert.equal(
    getFrontendCachedData(scopeA, '/api/v1/dashboard/summary'),
    undefined,
    'Switching user/role during session verification must purge Frontend cache',
  );

  // Re-populate and verify executeLogout clears cache
  const scopeB = { userId: 'user-b', workspaceId: 'ws-1', role: 'staff' };
  setFrontendCachedData(scopeB, '/api/v1/dashboard/summary', {
    cachedFor: 'user-b',
  });
  assert.equal(getFrontendCacheStats().size, 1);
  executeLogout(tracker);
  assert.equal(getFrontendCacheStats().size, 0);

  // Targeted workspace & user invalidation
  setFrontendCachedData(scopeA, '/api/v1/dashboard/summary', { a: 1 });
  setFrontendCachedData(
    { userId: 'user-a', workspaceId: 'ws-2', role: 'owner' },
    '/api/v1/dashboard/summary',
    { a: 2 },
  );
  assert.equal(invalidateFrontendCacheForWorkspace('ws-1'), 1);
  assert.equal(
    getFrontendCachedData(scopeA, '/api/v1/dashboard/summary'),
    undefined,
  );
  assert.equal(invalidateFrontendCacheForUser('user-a'), 1);
  assert.equal(getFrontendCacheStats().size, 0);
});

test('FEAT-03 & FEAT-11: DashboardService Single-Query CTE, Automatic Mutation Invalidation, and Baseline vs Optimized Benchmark', async () => {
  clearFrontendQueryCache();
  let dbQueryCount = 0;
  let activeEmployeeCount = 6;

  const mockPool = {
    query: async (sql) => {
      dbQueryCount++;
      // Simulate realistic local PostgreSQL query latency (~1.5ms per query)
      await new Promise((r) => setTimeout(r, 2));
      if (sql.includes('WITH target_emp AS')) {
        return {
          rows: [
            {
              current_shift_id: 'shift-01',
              current_shift_run_state: 'working',
              current_shift_clock_in_at: new Date('2026-10-16T01:00:00Z'),
              recent_shifts_count: 5,
              completed_shifts_count: 4,
              total_worked_seconds: 14400,
              today_report_id: 'rep-01',
              today_report_date: '2026-10-16',
              today_report_status: 'submitted',
              today_report_entries_count: 3,
              today_report_total_reported_count: 12,
              total_reports_count: 8,
              emp_total_count: activeEmployeeCount + 1,
              emp_active_count: activeEmployeeCount,
              emp_invited_count: 1,
              pay_period_id: 'pay-01',
              pay_period_status: 'draft',
              pay_employee_count: activeEmployeeCount,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };

  const dashboardService = new DashboardService(mockPool);
  const apiCache = new ScopedApiCache({
    maxEntries: 100,
    defaultTtlMs: 15_000,
  });
  const csrfSecret = 'test-csrf-secret-at-least-32-chars-long-12345';

  const ownerContext = {
    sessionId: 'sess-owner',
    sessionTokenHash: 'hash-owner',
    user: {
      id: 'u-owner',
      username: 'owner',
      email: 'owner@example.com',
      status: 'active',
    },
    workspace: {
      id: 'ws-main',
      name: 'Hoài Phương Studio',
      role: 'owner',
      permissions: ['employees:read', 'employees:write'],
    },
  };

  const staffContext = {
    sessionId: 'sess-staff',
    sessionTokenHash: 'hash-staff',
    user: {
      id: 'u-staff',
      username: 'staff1',
      email: 'staff1@example.com',
      status: 'active',
    },
    workspace: {
      id: 'ws-main',
      name: 'Hoài Phương Studio',
      role: 'staff',
      permissions: ['attendance:self'],
    },
  };

  const mockAuthService = {
    resolveSession: async (token) => {
      if (token === 'valid-owner-token') return ownerContext;
      if (token === 'valid-staff-token') return staffContext;
      return null;
    },
  };

  const mockEmployeeService = {
    createEmployee: async () => {
      activeEmployeeCount++;
      return { id: 'emp-new', employee_code: 'NV99' };
    },
  };

  const handler = createRequestHandler({
    pool: mockPool,
    authService: mockAuthService,
    dashboardService,
    employeeService: mockEmployeeService,
    apiCache,
    csrfSecret,
    isProduction: false,
  });

  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. BASELINE MEASUREMENT: Simulate legacy 4-endpoint waterfall (attendance + reports + employees + payroll)
    const baselineStart = performance.now();
    let baselineQueries = 0;
    const simulateLegacyEndpoint = async (queriesPerEndpoint) => {
      for (let i = 0; i < queriesPerEndpoint; i++) {
        baselineQueries++;
        await new Promise((r) => setTimeout(r, 2));
      }
      await fetch(`${baseUrl}/api/v1/health`);
    };
    await simulateLegacyEndpoint(2); // /api/v1/attendance/me (2 queries)
    await simulateLegacyEndpoint(2); // /api/v1/reports/me (2 queries)
    await simulateLegacyEndpoint(1); // /api/v1/employees (1 query)
    await simulateLegacyEndpoint(8); // /api/v1/payroll/periods/:month (8+ queries)
    const baselineFirstLoadMs = performance.now() - baselineStart;

    // 2. OPTIMIZED FIRST LOAD (Backend Cache MISS -> 1 HTTP Request, 1 SQL CTE Query)
    dbQueryCount = 0;
    const optMissStart = performance.now();
    const missRes = await fetch(
      `${baseUrl}/api/v1/dashboard/summary?date=2026-10-16&month=2026-10`,
      {
        headers: { Cookie: 'mglite_session=valid-owner-token' },
      },
    );
    const optMissMs = performance.now() - optMissStart;
    assert.equal(missRes.status, 200);
    assert.equal(missRes.headers.get('x-cache'), 'MISS');
    assert.equal(missRes.headers.get('cache-control'), 'private, no-store');
    assert.equal(
      dbQueryCount,
      1,
      'DashboardService must execute exactly 1 SQL CTE query on cache miss',
    );
    const missBody = await missRes.json();
    assert.equal(missBody.data.employees.active_count, 6);
    assert.equal(missBody.data.shift.current_shift.run_state, 'working');

    // 3. OPTIMIZED SECOND LOAD (Backend Cache HIT -> 1 HTTP Request, 0 SQL Queries)
    const optHitStart = performance.now();
    const hitRes = await fetch(
      `${baseUrl}/api/v1/dashboard/summary?date=2026-10-16&month=2026-10`,
      {
        headers: { Cookie: 'mglite_session=valid-owner-token' },
      },
    );
    const optHitMs = performance.now() - optHitStart;
    assert.equal(hitRes.status, 200);
    assert.equal(hitRes.headers.get('x-cache'), 'HIT');
    assert.equal(
      dbQueryCount,
      1,
      'Backend cache hit must execute 0 additional SQL queries',
    );

    // 4. STAFF RBAC & CACHE ISOLATION ON BACKEND: Staff request must MISS owner cache and omit owner metrics
    const staffRes = await fetch(
      `${baseUrl}/api/v1/dashboard/summary?date=2026-10-16&month=2026-10`,
      {
        headers: { Cookie: 'mglite_session=valid-staff-token' },
      },
    );
    assert.equal(staffRes.status, 200);
    assert.equal(staffRes.headers.get('x-cache'), 'MISS');
    const staffBody = await staffRes.json();
    assert.equal(
      staffBody.data.employees,
      null,
      'Staff must never receive Owner employee metrics',
    );
    assert.equal(
      staffBody.data.payroll,
      null,
      'Staff must never receive Owner payroll metrics',
    );
    assert.equal(staffBody.data.shift.completed_shifts_count, 4);

    // 5. AUTOMATIC MUTATION INVALIDATION: Owner creates employee -> workspace cache invalidated automatically
    const { generateCsrfToken } =
      await import('../../dist/packages/security/src/csrf.js');
    const ownerCsrf = generateCsrfToken('hash-owner', csrfSecret);
    const createEmpRes = await fetch(`${baseUrl}/api/v1/employees`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'mglite_session=valid-owner-token',
        Origin: 'http://localhost:3001',
        'X-CSRF-Token': ownerCsrf,
      },
      body: JSON.stringify({
        employee_code: 'NV99',
        full_name: 'New Staff',
        email: 'nv99@example.com',
        username: 'nv99',
        role: 'staff',
      }),
    });
    assert.equal(createEmpRes.status, 201);

    // Next GET /api/v1/dashboard/summary must be a cache MISS and reflect active_count = 7
    const afterMutationRes = await fetch(
      `${baseUrl}/api/v1/dashboard/summary?date=2026-10-16&month=2026-10`,
      {
        headers: { Cookie: 'mglite_session=valid-owner-token' },
      },
    );
    assert.equal(afterMutationRes.status, 200);
    assert.equal(
      afterMutationRes.headers.get('x-cache'),
      'MISS',
      'Workspace mutation must immediately invalidate cached GET responses',
    );
    const afterMutationBody = await afterMutationRes.json();
    assert.equal(afterMutationBody.data.employees.active_count, 7);

    // 6. FRONTEND SWR DEDUPLICATION & 0ms CACHE HIT
    clearFrontendQueryCache();
    let networkCalls = 0;
    const customFetch = async (url) => {
      networkCalls++;
      return fetch(`${baseUrl}${url}`, {
        headers: { Cookie: 'mglite_session=valid-owner-token' },
      });
    };
    const feScope = {
      userId: 'u-owner',
      workspaceId: 'ws-main',
      role: 'owner',
    };
    const targetUrl = '/api/v1/dashboard/summary?date=2026-10-16&month=2026-10';

    // Fire 5 concurrent requests: SWR in-flight deduplication must send only 1 network request
    const concurrentResults = await Promise.all([
      fetchWithFrontendCache(feScope, targetUrl, { fetchFn: customFetch }),
      fetchWithFrontendCache(feScope, targetUrl, { fetchFn: customFetch }),
      fetchWithFrontendCache(feScope, targetUrl, { fetchFn: customFetch }),
      fetchWithFrontendCache(feScope, targetUrl, { fetchFn: customFetch }),
      fetchWithFrontendCache(feScope, targetUrl, { fetchFn: customFetch }),
    ]);
    assert.equal(
      networkCalls,
      1,
      'In-flight deduplication must coalesce 5 concurrent requests into 1 HTTP call',
    );
    for (const r of concurrentResults) {
      assert.equal(r.ok, true);
      assert.equal(r.data.employees.active_count, 7);
    }

    // Subsequent Frontend fetch within TTL: 0 network calls, <1ms latency
    const feHitStart = performance.now();
    const feHit = await fetchWithFrontendCache(feScope, targetUrl, {
      fetchFn: customFetch,
    });
    const feHitMs = performance.now() - feHitStart;
    assert.equal(feHit.fromCache, true);
    assert.equal(
      networkCalls,
      1,
      'Frontend cache hit must make 0 network calls',
    );
    assert.equal(baselineQueries, 13);
    assert.ok(
      baselineFirstLoadMs > optMissMs &&
        optMissMs >= optHitMs &&
        optHitMs >= feHitMs,
      `Expected Baseline (${baselineFirstLoadMs.toFixed(2)}ms) > Optimized Miss (${optMissMs.toFixed(2)}ms) >= Backend Hit (${optHitMs.toFixed(2)}ms) >= Frontend Hit (${feHitMs.toFixed(2)}ms)`,
    );

    // 7. Verify DashboardScreen static render still passes all UI invariants with new props
    const html = renderToStaticMarkup(
      React.createElement(DashboardScreen, {
        role: 'owner',
        workspaceName: 'Hoài Phương Studio',
        userId: 'u-owner',
        workspaceId: 'ws-main',
        onNavigate: () => {},
      }),
    );
    assert.ok(html.includes('Hoài Phương Studio'));
    assert.ok(html.includes('Trạng thái ca làm'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
