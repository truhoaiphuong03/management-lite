import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WorkService } from '../../dist/apps/api/src/work/service.js';
import { PrintQuoteService } from '../../dist/apps/api/src/printquote/service.js';

const ROOT = process.cwd();

describe('Phase 3 (v0.10.1) — 4G Chunk Splitting & Backward-Compatible API Pagination', () => {
  it('1. Vite production bundle splits PrintQuote into sub-195KB chunks and emits lazy StorageDriveOAuthModal chunk', () => {
    const assetsDir = path.join(ROOT, 'apps/web/dist/assets');
    assert.ok(
      fs.existsSync(assetsDir),
      'apps/web/dist/assets must exist after build:web',
    );
    const jsFiles = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'));

    const pqChunks = jsFiles.filter(
      (f) =>
        f.toLowerCase().startsWith('printquote') ||
        f.startsWith('PrintQuoteScreen-'),
    );
    assert.ok(
      pqChunks.length >= 4,
      `Expected PrintQuote to be split into >= 4 chunks, got ${pqChunks.length}: ${pqChunks.join(', ')}`,
    );

    const MAX_PQ_CHUNK_BYTES = 195 * 1024;
    for (const file of pqChunks) {
      const size = fs.statSync(path.join(assetsDir, file)).size;
      assert.ok(
        size < MAX_PQ_CHUNK_BYTES,
        `Chunk ${file} is ${(size / 1024).toFixed(1)} KB, exceeding 195 KB budget`,
      );
    }

    const oauthModalChunk = jsFiles.find((f) =>
      f.startsWith('StorageDriveOAuthModal-'),
    );
    assert.ok(
      oauthModalChunk,
      `Expected lazy StorageDriveOAuthModal chunk in dist/assets, got: ${jsFiles.join(', ')}`,
    );
  });

  it('2. WorkService.list supports validated limit & offset while keeping omitted-param contract unchanged', async () => {
    const mockRows = [
      { id: '11111111-1111-4111-8111-000000000001' },
      { id: '11111111-1111-4111-8111-000000000002' },
      { id: '11111111-1111-4111-8111-000000000003' },
      { id: '11111111-1111-4111-8111-000000000004' },
    ];
    const mockClient = {
      async query(sql, params) {
        const s = String(sql);
        if (s.includes('FROM users ')) {
          return { rowCount: 1, rows: [{ id: params[0] }] };
        }
        if (s.includes('FROM user_workspace_bindings')) {
          return { rowCount: 1, rows: [{ id: 'bind-1' }] };
        }
        if (s.includes('FROM workspace_memberships')) {
          return {
            rowCount: 1,
            rows: [{ role: 'owner', status: 'active' }],
          };
        }
        if (s.includes('FROM auth_sessions')) {
          return { rowCount: 1, rows: [{ id: 'sess-1' }] };
        }
        if (s.includes('FROM workspaces ')) {
          return { rowCount: 1, rows: [{ id: params[0] }] };
        }
        if (s.includes('SELECT w.id FROM work_items')) {
          return { rowCount: mockRows.length, rows: mockRows };
        }
        if (s.includes('FROM work_items WHERE workspace_id=$1 AND id=$2')) {
          return {
            rowCount: 1,
            rows: [
              {
                id: params[1],
                workspace_id: params[0],
                title: `Task ${params[1].slice(-1)}`,
                description: null,
                status: 'todo',
                priority: 'medium',
                due_at: null,
                created_by_user_id: '33333333-3333-4333-8333-333333333333',
                updated_by_user_id: '33333333-3333-4333-8333-333333333333',
                version: 1,
                created_at: new Date('2026-11-14T00:00:00Z'),
                updated_at: new Date('2026-11-14T00:00:00Z'),
              },
            ],
          };
        }
        return { rowCount: 0, rows: [] };
      },
      release() {},
    };
    const svc = new WorkService({
      connect: async () => mockClient,
    });
    const auth = {
      workspace: { id: '22222222-2222-4222-8222-222222222222', role: 'owner' },
      user: { id: '33333333-3333-4333-8333-333333333333' },
      sessionId: 'sess-1',
      sessionTokenHash: 'hash-1',
    };

    const full = await svc.list(auth, new URLSearchParams());
    assert.equal(full.total, 4);
    assert.equal(full.items.length, 4);
    assert.equal('offset' in full, false);

    const paged = await svc.list(auth, new URLSearchParams('limit=2&offset=1'));
    assert.equal(paged.total, 4);
    assert.equal(paged.items.length, 2);
    assert.equal(paged.limit, 2);
    assert.equal(paged.offset, 1);
    assert.equal(paged.items[0].id, '11111111-1111-4111-8111-000000000002');
    assert.equal(paged.items[1].id, '11111111-1111-4111-8111-000000000003');

    await assert.rejects(
      () => svc.list(auth, new URLSearchParams('limit=0')),
      (err) => err.statusCode === 400,
    );
    await assert.rejects(
      () => svc.list(auth, new URLSearchParams('limit=101')),
      (err) => err.statusCode === 400,
    );
    await assert.rejects(
      () => svc.list(auth, new URLSearchParams('offset=-1')),
      (err) => err.statusCode === 400,
    );
  });

  it('3. PrintQuoteService.listQuotes & listQuotesPaginated enforce deterministic sort and safe limit/offset', async () => {
    const sampleRows = [
      {
        id: 'q-3',
        workspace_id: 'ws-1',
        quote_code: 'BG-003',
        title: 'Quote 3',
        status: 'DRAFT',
        pricing_status: 'COMPLETE',
        current_version: 1,
        shipping_fee: 0,
        include_shipping_in_unit_price: false,
        shipping_allocation_strategy: 'PROPORTIONAL_BY_BASE_AMOUNT',
        rounding_mode: 'CEIL',
        rounding_step: 1,
        total_vendor_cost: 1000,
        total_profit: 500,
        total_quote_amount: 1500,
        lines_json: [],
        customer_pdf_json: null,
        created_at: new Date('2026-11-14T03:00:00Z'),
        updated_at: new Date('2026-11-14T03:00:00Z'),
      },
      {
        id: 'q-2',
        workspace_id: 'ws-1',
        quote_code: 'BG-002',
        title: 'Quote 2',
        status: 'DRAFT',
        pricing_status: 'COMPLETE',
        current_version: 1,
        shipping_fee: 0,
        include_shipping_in_unit_price: false,
        shipping_allocation_strategy: 'PROPORTIONAL_BY_BASE_AMOUNT',
        rounding_mode: 'CEIL',
        rounding_step: 1,
        total_vendor_cost: 1000,
        total_profit: 500,
        total_quote_amount: 1500,
        lines_json: [],
        customer_pdf_json: null,
        created_at: new Date('2026-11-14T02:00:00Z'),
        updated_at: new Date('2026-11-14T02:00:00Z'),
      },
    ];
    const seenSql = [];
    const svc = new PrintQuoteService({
      async query(sql, params) {
        seenSql.push({ sql: String(sql), params });
        if (String(sql).includes('COUNT(*)')) {
          return { rows: [{ total: 5 }] };
        }
        return { rows: sampleRows };
      },
    });
    const ctx = {
      workspace: { id: 'ws-1', role: 'owner' },
      user: { id: 'u-1' },
    };

    const legacyItems = await svc.listQuotes(ctx);
    assert.equal(Array.isArray(legacyItems), true);
    assert.equal(legacyItems.length, 2);
    assert.ok(
      seenSql[0].sql.includes('ORDER BY created_at DESC, id DESC'),
      'listQuotes must order deterministically by created_at DESC, id DESC',
    );

    const paged = await svc.listQuotesPaginated(ctx, { limit: 2, offset: 2 });
    assert.equal(paged.total, 5);
    assert.equal(paged.limit, 2);
    assert.equal(paged.offset, 2);
    assert.equal(paged.items.length, 2);

    await assert.rejects(
      () => svc.listQuotesPaginated(ctx, { limit: 0, offset: 0 }),
      (err) => err.statusCode === 400,
    );
    await assert.rejects(
      () => svc.listQuotesPaginated(ctx, { limit: 101, offset: 0 }),
      (err) => err.statusCode === 400,
    );
    await assert.rejects(
      () => svc.listQuotesPaginated(ctx, { limit: 20, offset: -5 }),
      (err) => err.statusCode === 400,
    );

    const hotIdxSql = fs.readFileSync(
      path.join(ROOT, 'scripts/perf/ensure-hot-indexes.sql'),
      'utf8',
    );
    assert.ok(hotIdxSql.includes('idx_print_quotes_ws_created_id'));
    assert.ok(hotIdxSql.includes('idx_work_items_ws_status_due_created'));
  });
});
