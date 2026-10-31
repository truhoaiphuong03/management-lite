#!/usr/bin/env node
/**
 * Phase 18 — Task 18.4: Hot-Query EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) Benchmark
 *
 * Usage:
 *   node scripts/perf/explain-hot-queries.mjs [--apply-indexes]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMO_WS = '00000000-0000-4000-8000-000000000001';
const DEMO_EMP = '00000000-0000-4000-8000-000000000002';

export const HOT_QUERY_SPECS = [
  {
    id: 'attendance_shifts_keyset',
    description: 'Owner attendance shifts list with keyset cursor pagination',
    sql: `SELECT s.id, s.workspace_id, s.employee_id, s.clock_in_at, s.clock_out_at, s.run_state, s.review_state
          FROM attendance_shifts s
          WHERE s.workspace_id = $1
            AND (s.clock_in_at, s.id) < ($2::timestamptz, $3::uuid)
          ORDER BY s.clock_in_at DESC, s.id DESC
          LIMIT 50`,
    params: [DEMO_WS, '2026-12-31T23:59:59.999Z', DEMO_EMP],
  },
  {
    id: 'work_items_v4_ref_lookup',
    description: 'TikTok V4 Bridge deduplication lookup by [TIKTOK_V4_REF:...]',
    sql: `SELECT id FROM work_items
          WHERE workspace_id = $1
            AND split_part(description, chr(10), 1) = $2
          LIMIT 1`,
    params: [DEMO_WS, '[TIKTOK_V4_REF:v4_job_benchmark]'],
  },
  {
    id: 'daily_reports_keyset',
    description: 'Daily reports keyset cursor pagination',
    sql: `SELECT r.id, r.report_date, r.status, r.updated_at
          FROM daily_reports r
          WHERE r.workspace_id = $1
          ORDER BY r.report_date DESC, r.id DESC
          LIMIT 30`,
    params: [DEMO_WS],
  },
  {
    id: 'finance_entries_ledger',
    description: 'Finance ledger date-ordered listing',
    sql: `SELECT id, entry_type, amount_vnd, entry_date, status
          FROM finance_entries
          WHERE workspace_id = $1
          ORDER BY entry_date DESC, created_at DESC
          LIMIT 50`,
    params: [DEMO_WS],
  },
  {
    id: 'storage_files_by_folder',
    description: 'Storage files listing for a folder',
    sql: `SELECT id, name, mime_type, size_bytes, review_status, created_at
          FROM storage_files
          WHERE workspace_id = $1 AND folder_id = $2
          ORDER BY created_at DESC
          LIMIT 50`,
    params: [DEMO_WS, DEMO_EMP],
  },
];

export async function runExplainBenchmark(pool, options = {}) {
  if (options.applyIndexes) {
    const sqlPath = path.join(__dirname, 'ensure-hot-indexes.sql');
    const ddl = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(ddl);
  }

  const results = [];
  for (const spec of HOT_QUERY_SPECS) {
    const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${spec.sql}`;
    const res = await pool.query(explainSql, spec.params);
    const planPayload = res.rows[0]?.['QUERY PLAN']?.[0] ?? {};
    results.push({
      id: spec.id,
      description: spec.description,
      executionTimeMs: planPayload['Execution Time'] ?? null,
      planningTimeMs: planPayload['Planning Time'] ?? null,
      nodeType: planPayload.Plan?.['Node Type'] ?? null,
      indexName: planPayload.Plan?.['Index Name'] ?? null,
    });
  }
  return results;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const applyIndexes = process.argv.includes('--apply-indexes');
  const { createDatabasePool } = await import(
    '../../dist/packages/database/src/pool.js'
  );
  const { loadDatabaseConfig } = await import(
    '../../dist/packages/database/src/config.js'
  );
  const config = loadDatabaseConfig(process.env);
  const pool = createDatabasePool(config);
  try {
    await pool.connect();
    const report = await runExplainBenchmark(pool, { applyIndexes });
    console.table(report);
  } finally {
    await pool.close();
  }
}
