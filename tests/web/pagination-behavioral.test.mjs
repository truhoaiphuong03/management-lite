import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

/**
 * BEHAVIORAL PAGINATION TEST SUITE
 *
 * NOTE: All tests in this suite utilize isolated in-memory mock pools and synthetic fixtures.
 * Zero database connections, credentials, or network requests are executed.
 */
test('BEHAVIORAL PAGINATION — Multi-page, Tie-Break, Deduplication & Isolation', async (t) => {
  const { ReportsService } = await import(
    `file://${resolve(root, 'dist/apps/api/src/reports/service.js')}`
  );

  const mockWorkspaceId = '00000000-0000-0000-0000-000000000001';
  const mockStaffUserId = '11111111-1111-1111-1111-111111111111';

  const baseContextStaff = {
    workspace: { id: mockWorkspaceId, role: 'staff' },
    user: { id: mockStaffUserId, username: 'staff1', role: 'staff' },
  };

  const baseContextOwner = {
    workspace: { id: mockWorkspaceId, role: 'owner' },
    user: {
      id: '33333333-3333-3333-3333-333333333333',
      username: 'owner1',
      role: 'owner',
    },
  };

  // 1. Multi-page traversal with cursor continuity
  await t.test(
    '1. Multi-page pagination traversal yields continuous non-overlapping pages',
    async () => {
      // 5 items in total, limit 2 per page -> 3 pages: [2 items], [2 items], [1 item]
      const syntheticDb = [
        {
          id: 'aaaaaaaa-0000-4000-8000-000000000005',
          workspace_id: mockWorkspaceId,
          author_user_id: mockStaffUserId,
          author_name: 'Staff 1',
          author_code: 'NV001',
          report_date: '2026-10-10',
          content: 'Report 5',
          blockers: null,
          created_at: new Date('2026-10-10T15:00:00.000Z'),
          updated_at: new Date('2026-10-10T15:00:00.000Z'),
        },
        {
          id: 'aaaaaaaa-0000-4000-8000-000000000004',
          workspace_id: mockWorkspaceId,
          author_user_id: mockStaffUserId,
          author_name: 'Staff 1',
          author_code: 'NV001',
          report_date: '2026-10-09',
          content: 'Report 4',
          blockers: null,
          created_at: new Date('2026-10-09T15:00:00.000Z'),
          updated_at: new Date('2026-10-09T15:00:00.000Z'),
        },
        {
          id: 'aaaaaaaa-0000-4000-8000-000000000003',
          workspace_id: mockWorkspaceId,
          author_user_id: mockStaffUserId,
          author_name: 'Staff 1',
          author_code: 'NV001',
          report_date: '2026-10-08',
          content: 'Report 3',
          blockers: null,
          created_at: new Date('2026-10-08T15:00:00.000Z'),
          updated_at: new Date('2026-10-08T15:00:00.000Z'),
        },
        {
          id: 'aaaaaaaa-0000-4000-8000-000000000002',
          workspace_id: mockWorkspaceId,
          author_user_id: mockStaffUserId,
          author_name: 'Staff 1',
          author_code: 'NV001',
          report_date: '2026-10-07',
          content: 'Report 2',
          blockers: null,
          created_at: new Date('2026-10-07T15:00:00.000Z'),
          updated_at: new Date('2026-10-07T15:00:00.000Z'),
        },
        {
          id: 'aaaaaaaa-0000-4000-8000-000000000001',
          workspace_id: mockWorkspaceId,
          author_user_id: mockStaffUserId,
          author_name: 'Staff 1',
          author_code: 'NV001',
          report_date: '2026-10-06',
          content: 'Report 1',
          blockers: null,
          created_at: new Date('2026-10-06T15:00:00.000Z'),
          updated_at: new Date('2026-10-06T15:00:00.000Z'),
        },
      ];

      const mockPool = {
        query: async (sql, params) => {
          if (sql.includes('FROM employees e')) {
            return { rows: [{ id: 'mock-emp-1', full_name: 'Staff 1' }] };
          }

          // Find if cursor is used
          const limitParam = params[params.length - 1]; // limit + 1
          let filtered = [...syntheticDb];

          if (sql.includes('(r.report_date, r.created_at, r.id) <')) {
            const cursorDate = params[params.length - 4];
            const cursorCreatedAt = new Date(params[params.length - 3]);
            const cursorId = params[params.length - 2];

            filtered = filtered.filter((row) => {
              if (row.report_date < cursorDate) return true;
              if (row.report_date > cursorDate) return false;
              if (row.created_at.getTime() < cursorCreatedAt.getTime())
                return true;
              if (row.created_at.getTime() > cursorCreatedAt.getTime())
                return false;
              return row.id < cursorId;
            });
          }

          const sliced = filtered.slice(0, limitParam);
          return {
            rows: sliced.map((r) => ({
              ...r,
              created_at: r.created_at.toISOString(),
              updated_at: r.updated_at.toISOString(),
            })),
          };
        },
      };

      const service = new ReportsService(mockPool);

      // Page 1
      const page1 = await service.getReportsMe(baseContextStaff, { limit: 2 });
      assert.equal(page1.items.length, 2);
      assert.equal(page1.items[0].id, 'aaaaaaaa-0000-4000-8000-000000000005');
      assert.equal(page1.items[1].id, 'aaaaaaaa-0000-4000-8000-000000000004');
      assert.ok(page1.next_cursor, 'Page 1 must return next_cursor');

      // Page 2
      const page2 = await service.getReportsMe(baseContextStaff, {
        limit: 2,
        cursor: page1.next_cursor,
      });
      assert.equal(page2.items.length, 2);
      assert.equal(page2.items[0].id, 'aaaaaaaa-0000-4000-8000-000000000003');
      assert.equal(page2.items[1].id, 'aaaaaaaa-0000-4000-8000-000000000002');
      assert.ok(page2.next_cursor, 'Page 2 must return next_cursor');

      // Page 3 (final)
      const page3 = await service.getReportsMe(baseContextStaff, {
        limit: 2,
        cursor: page2.next_cursor,
      });
      assert.equal(page3.items.length, 1);
      assert.equal(page3.items[0].id, 'aaaaaaaa-0000-4000-8000-000000000001');
      assert.equal(
        page3.next_cursor,
        null,
        'Final page must return null next_cursor',
      );

      // Collect all IDs
      const allIds = [
        ...page1.items.map((r) => r.id),
        ...page2.items.map((r) => r.id),
        ...page3.items.map((r) => r.id),
      ];
      assert.equal(allIds.length, 5);
      assert.equal(
        new Set(allIds).size,
        5,
        'Zero duplicates across page boundaries',
      );
    },
  );

  // 2. Identical timestamp + ID tie-break
  await t.test(
    '2. Identical report_date and microsecond timestamps tie-broken deterministically by UUID',
    async () => {
      const identicalTimestamp = '2026-10-10T12:00:00.123456Z';
      const reportDate = '2026-10-10';

      // Two records with identical date and exact microsecond created_at
      const idHigher = 'bbbbbbbb-0000-4000-8000-000000000002';
      const idLower = 'bbbbbbbb-0000-4000-8000-000000000001';

      const syntheticDb = [
        {
          id: idHigher,
          workspace_id: mockWorkspaceId,
          author_user_id: mockStaffUserId,
          author_name: 'Staff 1',
          author_code: 'NV001',
          report_date: reportDate,
          content: 'Report B',
          blockers: null,
          created_at: identicalTimestamp,
          updated_at: identicalTimestamp,
        },
        {
          id: idLower,
          workspace_id: mockWorkspaceId,
          author_user_id: mockStaffUserId,
          author_name: 'Staff 1',
          author_code: 'NV001',
          report_date: reportDate,
          content: 'Report A',
          blockers: null,
          created_at: identicalTimestamp,
          updated_at: identicalTimestamp,
        },
      ];

      let capturedParams = [];
      const mockPool = {
        query: async (sql, params) => {
          if (sql.includes('FROM employees e')) {
            return { rows: [{ id: 'mock-emp-1', full_name: 'Staff 1' }] };
          }
          capturedParams = params;
          if (sql.includes('(r.report_date, r.created_at, r.id) <')) {
            const cursorId = params[params.length - 2];
            const filtered = syntheticDb.filter((r) => r.id < cursorId);
            return { rows: filtered };
          }
          return { rows: syntheticDb.slice(0, params[params.length - 1]) };
        },
      };

      const service = new ReportsService(mockPool);

      // Fetch Page 1 (limit 1)
      const page1 = await service.getReportsMe(baseContextStaff, { limit: 1 });
      assert.equal(page1.items.length, 1);
      assert.equal(
        page1.items[0].id,
        idHigher,
        'Higher UUID must appear first in DESC order',
      );
      assert.ok(page1.next_cursor);

      // Fetch Page 2 with cursor from Page 1
      const page2 = await service.getReportsMe(baseContextStaff, {
        limit: 1,
        cursor: page1.next_cursor,
      });
      assert.equal(page2.items.length, 1);
      assert.equal(
        page2.items[0].id,
        idLower,
        'Lower UUID must appear second without collision or skipping',
      );
      assert.equal(
        capturedParams[capturedParams.length - 2],
        idHigher,
        'Cursor must supply idHigher as tie-break parameter',
      );
    },
  );

  // 3. Zero ID loss / duplication across high-cardinality pages
  await t.test(
    '3. No ID loss or duplication across multi-page traversals',
    async () => {
      const totalCount = 15;
      const generated = Array.from({ length: totalCount }, (_, i) => {
        const pad = String(i + 1).padStart(4, '0');
        return {
          id: `cccccccc-0000-4000-8000-${pad}00000000`,
          workspace_id: mockWorkspaceId,
          author_user_id: mockStaffUserId,
          author_name: 'Staff 1',
          author_code: 'NV001',
          report_date: `2026-09-${String((i % 28) + 1).padStart(2, '0')}`,
          content: `Bulk report ${i + 1}`,
          blockers: null,
          created_at: new Date(1760000000000 + i * 1000).toISOString(),
          updated_at: new Date(1760000000000 + i * 1000).toISOString(),
        };
      }).sort((a, b) => {
        if (a.report_date !== b.report_date)
          return b.report_date.localeCompare(a.report_date);
        if (a.created_at !== b.created_at)
          return b.created_at.localeCompare(a.created_at);
        return b.id.localeCompare(a.id);
      });

      const mockPool = {
        query: async (sql, params) => {
          if (sql.includes('FROM employees e')) {
            return { rows: [{ id: 'mock-emp-1', full_name: 'Staff 1' }] };
          }
          const limitParam = params[params.length - 1];
          let items = [...generated];
          if (sql.includes('(r.report_date, r.created_at, r.id) <')) {
            const cDate = params[params.length - 4];
            const cCreated = params[params.length - 3];
            const cId = params[params.length - 2];
            items = items.filter((row) => {
              if (row.report_date < cDate) return true;
              if (row.report_date > cDate) return false;
              if (row.created_at < cCreated) return true;
              if (row.created_at > cCreated) return false;
              return row.id < cId;
            });
          }
          return { rows: items.slice(0, limitParam) };
        },
      };

      const service = new ReportsService(mockPool);
      const collected = [];
      let currentCursor = undefined;
      let pageCount = 0;

      do {
        pageCount++;
        const res = await service.getReportsMe(baseContextStaff, {
          limit: 4,
          cursor: currentCursor,
        });
        collected.push(...res.items);
        currentCursor = res.next_cursor || undefined;
      } while (currentCursor && pageCount < 10);

      assert.equal(
        collected.length,
        totalCount,
        'Must recover exactly all 15 items',
      );
      const uniqueIds = new Set(collected.map((r) => r.id));
      assert.equal(
        uniqueIds.size,
        totalCount,
        'All IDs across pages must be strictly unique',
      );
    },
  );

  // 4. Staff own-only isolation & Workspace boundary isolation
  await t.test(
    '4. Staff own-only queries strictly enforce employee_id and workspace_id boundaries',
    async () => {
      let executedSql = '';
      let executedParams = [];

      const mockPool = {
        query: async (sql, params) => {
          if (sql.includes('FROM employees e')) {
            return { rows: [{ id: 'mock-emp-1', full_name: 'Staff 1' }] };
          }
          executedSql = sql;
          executedParams = params;
          return { rows: [] };
        },
      };

      const service = new ReportsService(mockPool);

      // Call as Staff
      await service.getReportsMe(baseContextStaff, { limit: 10 });
      assert.ok(
        executedSql.includes('r.workspace_id = $1'),
        'SQL must enforce workspace_id',
      );
      assert.ok(
        executedSql.includes('r.employee_id = $2'),
        'SQL must enforce employee_id for Staff',
      );
      assert.equal(
        executedParams[0],
        mockWorkspaceId,
        'Workspace param must match context workspace',
      );
      assert.equal(
        executedParams[1],
        'mock-emp-1',
        'Employee param must match resolved Staff employee ID',
      );

      // Call as Owner on listDailyReports
      await service.listDailyReports(baseContextOwner, { limit: 10 });
      assert.ok(
        executedSql.includes('r.workspace_id = $1'),
        'SQL must enforce workspace_id for Owner',
      );
      assert.ok(
        !executedSql.includes('r.employee_id = $2'),
        'Owner listDailyReports does not restrict to own employee by default',
      );
      assert.equal(executedParams[0], mockWorkspaceId);
    },
  );
});
