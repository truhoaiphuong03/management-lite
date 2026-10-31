#!/usr/bin/env node
/**
 * Phase 19 — Task 19.4: Employee Profile Data Integrity Verifier
 *
 * Scans employee records for malformed date_of_birth or non-digit bank_account_number
 * values using the canonical profile-validator helpers.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeDateOfBirth,
  normalizeBankAccountNumber,
} from '../../dist/apps/api/src/employees/profile-validator.js';

export function auditEmployeeProfileRows(rows) {
  const anomalies = [];
  for (const row of rows) {
    if (row.date_of_birth) {
      try {
        normalizeDateOfBirth(row.date_of_birth);
      } catch (err) {
        anomalies.push({
          employeeId: row.id,
          employeeCode: row.employee_code,
          field: 'date_of_birth',
          value: row.date_of_birth,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (row.bank_account_number) {
      try {
        normalizeBankAccountNumber(row.bank_account_number);
      } catch (err) {
        anomalies.push({
          employeeId: row.id,
          employeeCode: row.employee_code,
          field: 'bank_account_number',
          value: row.bank_account_number,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return {
    scannedCount: rows.length,
    anomalyCount: anomalies.length,
    anomalies,
  };
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const { createDatabasePool } = await import(
    '../../dist/packages/database/src/pool.js'
  );
  const { loadDatabaseConfig } = await import(
    '../../dist/packages/database/src/config.js'
  );
  const pool = createDatabasePool(loadDatabaseConfig(process.env));
  try {
    await pool.connect();
    const res = await pool.query(`
      SELECT
        id,
        employee_code,
        to_jsonb(employees) ->> 'date_of_birth' AS date_of_birth,
        to_jsonb(employees) ->> 'bank_account_number' AS bank_account_number
      FROM employees
      ORDER BY created_at ASC;
    `);
    const report = auditEmployeeProfileRows(res.rows);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.close();
  }
}
