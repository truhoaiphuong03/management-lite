#!/usr/bin/env node
/**
 * Phase 19 — Task 19.1: Safe Audit of Synthetic / Test Workspaces (Read-Only Dry-Run by Default)
 *
 * Usage:
 *   node scripts/ops/audit-test-workspaces.mjs [--json]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTestWorkspaceRecord } from '../../dist/apps/api/src/employees/profile-validator.js';

export async function auditWorkspaces(pool) {
  const res = await pool.query(`
    SELECT
      w.id,
      w.name,
      w.status,
      w.created_at,
      (to_jsonb(w) ->> 'is_test')::boolean AS is_test,
      COUNT(DISTINCT m.user_id)::int AS member_count,
      COUNT(DISTINCT e.id)::int AS employee_count
    FROM workspaces w
    LEFT JOIN workspace_memberships m ON m.workspace_id = w.id
    LEFT JOIN employees e ON e.workspace_id = w.id
    GROUP BY w.id, w.name, w.status, w.created_at
    ORDER BY w.created_at ASC;
  `);

  return res.rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    memberCount: row.member_count,
    employeeCount: row.employee_count,
    isTestCandidate: isTestWorkspaceRecord({
      name: row.name,
      is_test: row.is_test,
    }),
  }));
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const { createDatabasePool } =
    await import('../../dist/packages/database/src/pool.js');
  const { loadDatabaseConfig } =
    await import('../../dist/packages/database/src/config.js');
  const pool = createDatabasePool(loadDatabaseConfig(process.env));
  try {
    const report = await auditWorkspaces(pool);
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.table(report);
    }
  } finally {
    await pool.end?.();
  }
}
