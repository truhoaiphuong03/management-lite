import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('REPORTS-PAGINATION — Contract & Implementation Verification', async (t) => {
  const servicePath = resolve(root, 'apps/api/src/reports/service.ts');
  const serviceCode = readFileSync(servicePath, 'utf8');

  const appPath = resolve(root, 'apps/api/src/app.ts');
  const appCode = readFileSync(appPath, 'utf8');

  const screenPath = resolve(root, 'apps/web/src/screens/ReportsScreen.tsx');
  const screenCode = readFileSync(screenPath, 'utf8');

  // 1. ReportsService parses cursor strictly with validation
  await t.test('1. parseReportCursor validates report_date, created_at, and id UUID', () => {
    assert.ok(serviceCode.includes('private parseReportCursor(cursor: string)'), 'Must implement parseReportCursor helper');
    assert.ok(serviceCode.includes('/^\\d{4}-\\d{2}-\\d{2}$/.test(decoded.report_date)'), 'Must validate YYYY-MM-DD date format');
    assert.ok(serviceCode.includes('Non-existent calendar date'), 'Must validate real calendar date');
    assert.ok(serviceCode.includes('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded.id)'), 'Must validate UUID v4/v7 id');
    assert.ok(serviceCode.includes("'INVALID_CURSOR'"), 'Must throw INVALID_CURSOR on malformed cursor');
  });

  // 2. getReportsMe & listDailyReports support cursor option and generate next_cursor
  await t.test('2. getReportsMe and listDailyReports handle cursor & generate base64url next_cursor', () => {
    assert.ok(serviceCode.includes('cursor?: string | undefined;'), 'Interface must accept optional cursor parameter');
    assert.ok(serviceCode.includes('(r.report_date, r.created_at, r.id) <'), 'Must use tuple comparison for stable cursor sorting');
    assert.ok(serviceCode.includes('ORDER BY r.report_date DESC, r.created_at DESC, r.id DESC'), 'Must enforce deterministic tie-breaker');
    assert.ok(serviceCode.includes('params.push(limit + 1)'), 'Must query limit + 1 to detect next page');
    assert.ok(serviceCode.includes("toString('base64url')"), 'Must generate base64url next_cursor');
  });

  // 3. app.ts routes extract cursor parameter and pass to service
  await t.test('3. app.ts passes cursor to reportsService', () => {
    assert.ok(appCode.includes("parsedUrl.searchParams.get('cursor')"), 'app.ts must extract cursor from searchParams');
    assert.ok(appCode.includes('cursor,\n        });\n        return sendJson(res, 200'), 'app.ts must forward cursor to reportsService');
  });

  // 4. ReportsScreen binds cursor and renders pagination controls
  await t.test('4. ReportsScreen connects cursor pagination and renders load-more controls', () => {
    assert.ok(screenCode.includes('allReportsNextCursor'), 'Must track allReportsNextCursor');
    assert.ok(screenCode.includes('myReportsNextCursor'), 'Must track myReportsNextCursor');
    assert.ok(screenCode.includes('loadingMoreAllReports'), 'Must track loadingMoreAllReports');
    assert.ok(screenCode.includes('loadingMoreMyReports'), 'Must track loadingMoreMyReports');
    assert.ok(screenCode.includes('fetchAllReports(allReportsNextCursor, true)'), 'Button triggers fetchAllReports with cursor');
    assert.ok(screenCode.includes('fetchMyReports(myReportsNextCursor, true)'), 'Button triggers fetchMyReports with cursor');
    assert.ok(screenCode.includes('Tải thêm báo cáo'), 'Must render Tải thêm báo cáo label');
  });

  // 5. Runtime ReportsService cursor parsing, microsecond precision & calendar validation
  await t.test('5. Runtime ReportsService parses microseconds and validates calendar dates', async () => {
    const { ReportsService } = await import(`file://${resolve(root, 'dist/apps/api/src/reports/service.js')}`);
    const mockPool = {
      query: async () => {
        // Return dummy rows
        return { rows: [] };
      },
    };
    const service = new ReportsService(mockPool);

    // Context for Owner
    const ownerContext = {
      user: { id: '11111111-1111-1111-1111-111111111111' },
      workspace: {
        id: '22222222-2222-2222-2222-222222222222',
        role: 'owner',
      },
    };

    // Valid cursor with microsecond precision: .123456Z
    const validCursorPayload = {
      report_date: '2026-10-10',
      created_at: '2026-10-10T18:30:00.123456Z',
      id: '33333333-3333-3333-3333-333333333333',
    };
    const validCursor = Buffer.from(JSON.stringify(validCursorPayload)).toString('base64url');

    let capturedQuery = null;
    let capturedParams = null;
    mockPool.query = async (q, p) => {
      capturedQuery = q;
      capturedParams = p;
      return { rows: [] };
    };

    await service.listDailyReports(ownerContext, { cursor: validCursor, limit: 10 });
    assert.ok(capturedQuery.includes('(r.report_date, r.created_at, r.id) <'), 'Tuple comparison in query');
    // Ensure microsecond precision was not truncated by JS Date
    assert.ok(capturedParams.includes('2026-10-10T18:30:00.123456Z'), 'Microseconds preserved in query params');

    // Invalid calendar date: 2026-02-30 (non-existent February 30th)
    const invalidDateCursor = Buffer.from(
      JSON.stringify({
        report_date: '2026-02-30',
        created_at: '2026-02-28T18:30:00.123456Z',
        id: '33333333-3333-3333-3333-333333333333',
      }),
    ).toString('base64url');

    await assert.rejects(
      async () => service.listDailyReports(ownerContext, { cursor: invalidDateCursor }),
      (err) => {
        assert.equal(err.code, 'INVALID_CURSOR');
        assert.equal(err.statusCode, 400);
        return true;
      },
      'Should reject non-existent calendar date with 400 INVALID_CURSOR',
    );

    // Invalid UUID
    const invalidIdCursor = Buffer.from(
      JSON.stringify({
        report_date: '2026-10-10',
        created_at: '2026-10-10T18:30:00.123456Z',
        id: 'not-a-valid-uuid',
      }),
    ).toString('base64url');

    await assert.rejects(
      async () => service.listDailyReports(ownerContext, { cursor: invalidIdCursor }),
      (err) => {
        assert.equal(err.code, 'INVALID_CURSOR');
        assert.equal(err.statusCode, 400);
        return true;
      },
      'Should reject invalid UUID with 400 INVALID_CURSOR',
    );

    // Multi-page next_cursor preserves exact PostgreSQL microsecond string
    const mockRows = [
      {
        id: '33333333-3333-3333-3333-333333333331',
        workspace_id: ownerContext.workspaceId,
        employee_id: '44444444-4444-4444-4444-444444444444',
        employee_name: 'Test Staff',
        report_date: '2026-10-10',
        status: 'submitted',
        current_revision: 1,
        version: 1,
        created_at: '2026-10-10 18:30:00.987654+00',
      },
      {
        id: '33333333-3333-3333-3333-333333333332',
        workspace_id: ownerContext.workspaceId,
        employee_id: '44444444-4444-4444-4444-444444444444',
        employee_name: 'Test Staff',
        report_date: '2026-10-10',
        status: 'submitted',
        current_revision: 1,
        version: 1,
        created_at: '2026-10-10 18:30:00.987653+00',
      },
    ];

    mockPool.query = async () => ({ rows: [...mockRows] });
    const result = await service.listDailyReports(ownerContext, { limit: 1 });
    assert.equal(result.items.length, 1);
    assert.ok(result.next_cursor);
    const decodedNext = JSON.parse(Buffer.from(result.next_cursor, 'base64url').toString('utf8'));
    assert.equal(decodedNext.created_at, '2026-10-10 18:30:00.987654+00', 'Must keep exact raw microsecond string');

    // 6. Staff getReportsMe with adjacent microsecond cursor
    const staffContext = {
      user: { id: '55555555-5555-5555-5555-555555555555' },
      workspace: {
        id: '22222222-2222-2222-2222-222222222222',
        role: 'staff',
      },
    };

    let staffQueryCaptured = null;
    let staffParamsCaptured = null;
    mockPool.query = async (q, p) => {
      // Mock employee lookup query first, then reports query
      if (q.includes('FROM employees e')) {
        return {
          rows: [
            {
              id: '44444444-4444-4444-4444-444444444444',
              full_name: 'Test Staff',
            },
          ],
        };
      }
      staffQueryCaptured = q;
      staffParamsCaptured = p;
      return { rows: [] };
    };

    const adjacentCursor = Buffer.from(
      JSON.stringify({
        report_date: '2026-10-10',
        created_at: '2026-10-10 18:30:00.123455+00',
        id: '33333333-3333-3333-3333-333333333332',
      }),
    ).toString('base64url');

    await service.getReportsMe(staffContext, { cursor: adjacentCursor, limit: 5 });
    assert.ok(staffQueryCaptured.includes('(r.report_date, r.created_at, r.id) <'), 'Tuple filter for staff');
    assert.ok(staffParamsCaptured.includes('2026-10-10 18:30:00.123455+00'), 'Microsecond preserved in staff query params');
  });

  // 6. REP-005: ReportsScreen renders eye-icon ActionIconButton to view report detail
  await t.test('6. REP-005: ReportsScreen renders ActionIconButton view for details & revision history', () => {
    const screen = readFileSync(screenPath, 'utf8');
    assert.ok(screen.includes('action="view"'), 'Must render ActionIconButton action="view"');
    assert.ok(screen.includes('handleOpenDetailModal'), 'Must trigger handleOpenDetailModal on view action');
    assert.ok(screen.includes('showDetailModal'), 'Must toggle showDetailModal');
    assert.ok(screen.includes('/api/v1/reports/daily/'), 'Must fetch report details via canonical endpoint');
  });

  // 7. REP-006: ReportsScreen renders unified Pagination with 20 items default & page-size selector
  await t.test('7. REP-006: ReportsScreen renders shared Pagination component and pagedReports slicing', () => {
    const screen = readFileSync(screenPath, 'utf8');
    assert.ok(screen.includes('<Pagination'), 'Must render shared Pagination component');
    assert.ok(screen.includes('testId="reports-pager"'), 'Must define testId="reports-pager"');
    assert.ok(screen.includes('pageSizes={PAGINATION_PAGE_SIZES}'), 'Must bind standard pageSizes [10, 20, 50, 100]');
    assert.ok(screen.includes('pagedReports.map'), 'Must map over pagedReports for client-side pagination');
  });

  // 8. REP-008: Staff blocked from viewing other employees' reports
  await t.test('8. REP-008: ReportsService enforces role check and fail-closed isolation', () => {
    assert.ok(serviceCode.includes("requireRole(['owner'], context)"), 'listDailyReports must require owner role');
    assert.ok(serviceCode.includes('if (!isOwner && !isReportOwner)'), 'getReportById must check isOwner or isReportOwner');
    assert.ok(serviceCode.includes("throw new AuthError('REPORT_NOT_FOUND'"), 'Must fail closed with 404 for unauthorized staff');
  });

  // 9. REP-003: C02 Revision workflow for submitted daily reports
  await t.test('9. REP-003: Staff revise submitted reports (C02 Revision) with version control and reason', () => {
    const screen = readFileSync(screenPath, 'utf8');
    assert.ok(screen.includes('data-testid="revise-report-btn"'), 'Must render revise-report-btn for submitted reports');
    assert.ok(screen.includes('data-testid="revise-report-modal"'), 'Must render revise-report-modal dialog');
    assert.ok(screen.includes('data-testid="revise-reason-input"'), 'Must render revise-reason-input for mandatory revision reason');
    assert.ok(screen.includes('data-testid="revise-submit-btn"'), 'Must render revise-submit-btn');
    assert.ok(screen.includes('/api/v1/reports/daily/${revisingReport.id}/revisions'), 'Must call POST revisions endpoint');
    assert.ok(screen.includes('\'If-Match\': `"${revisingReport.version}"`'), 'Must provide If-Match header with report version');
    assert.ok(appCode.includes("action === 'revisions' && method === 'POST'"), 'app.ts must handle POST /revisions');
    assert.ok(appCode.includes("assertAllowedFields(body, ['entries', 'notes', 'reason'])"), 'app.ts must enforce revision fields');
  });

  // 10. REP-007: Owner filter reset and dedicated empty filter state
  await t.test('10. REP-007: ReportsScreen provides dedicated reports-empty-filter state and clear-all-filters button', () => {
    const screen = readFileSync(screenPath, 'utf8');
    assert.ok(screen.includes('data-testid="reports-empty-filter"'), 'Must render data-testid="reports-empty-filter" when filters return 0 results');
    assert.ok(screen.includes('Không tìm thấy báo cáo công việc nào theo bộ lọc đã chọn.'), 'Must show descriptive filter empty text');
    assert.ok(screen.includes('Xóa tất cả bộ lọc'), 'Must offer button to clear all filters');
  });
});

