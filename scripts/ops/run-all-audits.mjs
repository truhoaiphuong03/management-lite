#!/usr/bin/env node
/**
 * Phase 19 — Unified Read-Only Operational Audit & Backup-Restore Drill Runner
 *
 * Runs all 5 read-only / non-destructive verification checks:
 *  1. Secrets Hygiene Audit (without exposing secret values)
 *  2. Workspace Synthetic/Test Audit
 *  3. Isolated Backup & Restore Verification Drill (inside ROLLBACK transaction)
 *  4. Employee Profile Data Integrity Audit (date_of_birth & bank_account_number)
 *  5. Hot-Query EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) Benchmark
 */
import fs from 'node:fs';
import {
  parseEnvContent,
  auditEnvSecretsHygiene,
} from './audit-secrets-hygiene.mjs';
import { auditWorkspaces } from './audit-test-workspaces.mjs';
import { runBackupRestoreDrill } from './backup-restore-drill.mjs';
import { auditEmployeeProfileRows } from './verify-profile-data.mjs';
import { runExplainBenchmark } from '../perf/explain-hot-queries.mjs';

const defaultEnvPath = 'C:/HoaiPhuong-Server/config/test-secrets/api.env';
const envMap = fs.existsSync(defaultEnvPath)
  ? parseEnvContent(fs.readFileSync(defaultEnvPath, 'utf8'))
  : process.env;
for (const [k, v] of Object.entries(envMap)) {
  if (process.env[k] === undefined && typeof v === 'string') {
    process.env[k] = v;
  }
}

const secretsAudit = auditEnvSecretsHygiene(envMap);

const { createDatabasePool } = await import(
  '../../dist/packages/database/src/pool.js'
);
const { loadDatabaseConfig } = await import(
  '../../dist/packages/database/src/config.js'
);

const pool = createDatabasePool(loadDatabaseConfig(process.env));
try {
  
  const workspacesAudit = await auditWorkspaces(pool);
  const backupDrill = await runBackupRestoreDrill(pool);

  const empRes = await pool.query(`
    SELECT
      id,
      employee_code,
      to_jsonb(employees) ->> 'date_of_birth' AS date_of_birth,
      to_jsonb(employees) ->> 'bank_account_number' AS bank_account_number
    FROM employees
    ORDER BY created_at ASC;
  `);
  const profileAudit = auditEmployeeProfileRows(empRes.rows);
  const explainBenchmark = await runExplainBenchmark(pool, {
    applyIndexes: false,
  });

  console.log(
    JSON.stringify(
      {
        secretsAudit,
        workspacesAudit,
        backupDrill,
        profileAudit,
        explainBenchmark,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end?.();
}
