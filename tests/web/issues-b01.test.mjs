import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

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
try {
  register(
    'data:text/javascript,' + encodeURIComponent(loaderCode),
    import.meta.url,
  );
} catch {}

test('ISSUES-B01: Contract and static source verification', () => {
  const contractsPath = resolve(root, 'packages/contracts/src/issues.ts');
  const contractsContent = readFileSync(contractsPath, 'utf8');
  assert.ok(
    contractsContent.includes('IssueGroupCounts'),
    'Must define IssueGroupCounts',
  );
  assert.ok(
    contractsContent.includes('counts?: IssueGroupCounts'),
    'Must include optional counts in ListIssuesResponseData',
  );
  assert.ok(
    contractsContent.includes("'in_progress'"),
    'Must include in_progress in ListIssuesQuery status',
  );

  const screenPath = resolve(root, 'apps/web/src/screens/IssuesScreen.tsx');
  const screenContent = readFileSync(screenPath, 'utf8');
  assert.ok(screenContent.includes('tab-status'), 'Must render status tabs');
  assert.ok(screenContent.includes('STATUS_TABS'), 'Must define STATUS_TABS');
  assert.ok(
    screenContent.includes('data-testid="checkbox-select-all"'),
    'Must render select all checkbox',
  );
  assert.ok(
    screenContent.includes('data-testid="btn-copy-selected-issues"'),
    'Must render bulk copy button',
  );
  assert.ok(
    screenContent.includes('btn-deselect-all'),
    'Must render deselect all button',
  );
  assert.ok(
    screenContent.includes('e.stopPropagation()'),
    'Must stop propagation on checkbox click to prevent navigation',
  );

  // Zero mutation invariants preserved
  const nonBulkPostCount = (screenContent.match(/method:\s*'POST'/g) || []).length - (screenContent.includes('/api/v1/issues/bulk-confirm') ? 1 : 0);
  assert.equal(
    nonBulkPostCount,
    0,
    'IssuesScreen MUST NOT perform single-issue POST mutations (only bulk-confirm allowed)',
  );
  assert.ok(
    !screenContent.includes("method: 'PATCH'"),
    'IssuesScreen MUST NOT perform PATCH mutation on issues',
  );
  assert.ok(
    !screenContent.includes("method: 'DELETE'"),
    'IssuesScreen MUST NOT perform DELETE mutation on issues',
  );
  assert.ok(
    !screenContent.includes('confirm-fix'),
    'IssuesScreen MUST NOT contain confirm-fix handlers',
  );
  assert.ok(
    !screenContent.includes('/reopen'),
    'IssuesScreen MUST NOT contain reopen mutation handlers',
  );
});

test('ISSUES-B01: Backend API group counts and in_progress filtering conformance', async () => {
  const { IssuesService } = await import(
    `file://${resolve(root, 'dist/apps/api/src/issues/service.js')}`
  );

  // Mock database pool
  let capturedQuery = '';
  let capturedCountsQuery = '';
  const mockRows = [
    {
      id: '11111111-1111-1111-1111-111111111111',
      workspace_id: 'ws-1',
      reporter_user_id: 'user-1',
      type: 'bug',
      title: 'Lỗi A',
      description: 'Mô tả A',
      route_template: '/clock',
      status: 'fixing',
      version: 2,
      created_at: '2026-10-10T00:00:00.000Z',
      updated_at: '2026-10-10T01:00:00.000Z',
      closed_at: null,
      reporter_name: 'test_user',
    },
  ];

  const mockPool = {
    query: async (sql) => {
      if (sql.includes('COUNT(*) FILTER')) {
        capturedCountsQuery = sql;
        return {
          rows: [
            {
              all_count: 10,
              open_count: 4,
              in_progress_count: 3,
              awaiting_owner_count: 2,
              closed_count: 1,
            },
          ],
        };
      }
      capturedQuery = sql;
      return { rows: mockRows };
    },
  };

  const service = new IssuesService(mockPool);
  const context = {
    user: { id: 'user-1', username: 'owner_user' },
    workspace: { id: 'ws-1', role: 'owner' },
  };

  // 1. Query with in_progress status
  const res = await service.listIssues(context, {
    status: 'in_progress',
    limit: 20,
  });
  assert.ok(
    capturedQuery.includes("i.status IN ('analyzing', 'fixing'"),
    'Must filter by analyzing and fixing',
  );
  assert.ok(
    capturedCountsQuery.includes('COUNT(*)'),
    'Must execute counts query',
  );
  assert.deepEqual(res.counts, {
    all: 10,
    open: 4,
    in_progress: 3,
    awaiting_owner: 2,
    closed: 1,
  });
  assert.equal(res.items.length, 1);
  assert.equal(res.items[0].id, '11111111-1111-1111-1111-111111111111');
});
