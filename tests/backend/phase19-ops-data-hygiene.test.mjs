import test from 'node:test';
import assert from 'node:assert/strict';

test('Phase 19.4: normalizeDateOfBirth and normalizeBankAccountNumber enforce strict profile data hygiene', async () => {
  const {
    normalizeDateOfBirth,
    normalizeBankAccountNumber,
    isTestWorkspaceRecord,
  } = await import('../../dist/apps/api/src/employees/profile-validator.js');

  // Valid ISO and Vietnamese DD/MM/YYYY dates normalize to YYYY-MM-DD
  assert.equal(normalizeDateOfBirth('1998-05-20'), '1998-05-20');
  assert.equal(normalizeDateOfBirth('20/05/1998'), '1998-05-20');
  assert.equal(normalizeDateOfBirth(''), null);
  assert.equal(normalizeDateOfBirth(null), null);

  // Impossible calendar date (Feb 30) is rejected
  assert.throws(
    () => normalizeDateOfBirth('1998-02-30'),
    /không tồn tại trên lịch/,
  );

  // Malformed text date is rejected
  assert.throws(
    () => normalizeDateOfBirth('not-a-date'),
    /Ngày sinh không hợp lệ/,
  );

  // Valid bank account numbers (with or without spaces/dashes) normalize to digits-only
  assert.equal(normalizeBankAccountNumber('1903 4567 8901 23'), '19034567890123');
  assert.equal(normalizeBankAccountNumber('0071001234567'), '0071001234567');
  assert.equal(normalizeBankAccountNumber(''), null);

  // Non-numeric or too-short bank account numbers are rejected
  assert.throws(
    () => normalizeBankAccountNumber('12345ABC'),
    /chỉ được chứa chữ số/,
  );
  assert.throws(
    () => normalizeBankAccountNumber('123'),
    /chỉ được chứa chữ số/,
  );

  // Task 19.1: isTestWorkspaceRecord honors explicit is_test flag and synthetic prefixes
  assert.equal(
    isTestWorkspaceRecord({ name: 'Hoài Phương Media', is_test: false }),
    false,
  );
  assert.equal(
    isTestWorkspaceRecord({ name: 'Custom Workspace', is_test: true }),
    true,
  );
  assert.equal(
    isTestWorkspaceRecord({ name: 'SYNTHETIC BACKUP RESTORE WS' }),
    true,
  );
  assert.equal(
    isTestWorkspaceRecord({ name: 'TestWS_1791936671841' }),
    true,
  );
});

test('Phase 19.4: EmployeeService.updateEmployee binds SQL placeholders ($3, $4...) and normalizes profile fields', async () => {
  const { EmployeeService } = await import(
    '../../dist/apps/api/src/employees/service.js'
  );

  const clientQueries = [];
  const mockPool = {
    query: async () => ({
      rows: [
        {
          id: '00000000-0000-4000-8000-000000000005',
          workspace_id: '00000000-0000-4000-8000-000000000001',
          user_id: '00000000-0000-4000-8000-000000000009',
          employee_code: 'NV001',
          full_name: 'Nguyễn Văn A',
          date_of_birth: '1999-08-15',
          bank_account_number: '1903456789012',
          employment_status: 'active',
          is_payroll_eligible: true,
          version: 2,
          created_at: new Date(),
          updated_at: new Date(),
          user_username: 'nv001',
          user_email: 'nv001@example.com',
          user_status: 'active',
          user_email_verified: true,
        },
      ],
    }),
    connect: async () => ({
      query: async (sql, params) => {
        clientQueries.push({ sql, params });
        if (sql.includes('FOR UPDATE')) {
          return {
            rows: [
              {
                id: '00000000-0000-4000-8000-000000000005',
                full_name: 'Nguyễn Văn A',
                employment_status: 'active',
                is_payroll_eligible: true,
                version: 1,
              },
            ],
          };
        }
        return { rows: [{ id: '00000000-0000-4000-8000-000000000099' }] };
      },
      release: () => {},
    }),
  };

  const svc = new EmployeeService(mockPool);
  const ownerCtx = {
    user: { id: '00000000-0000-4000-8000-000000000001', username: 'owner' },
    workspace: { id: '00000000-0000-4000-8000-000000000001', role: 'owner' },
  };

  await svc.updateEmployee(
    ownerCtx,
    '00000000-0000-4000-8000-000000000005',
    {
      full_name: 'Nguyễn Văn A',
      date_of_birth: '15/08/1999',
      bank_account_number: '1903 4567 8901 2',
    },
    '"1"',
    'req-phase19-test',
  );

  const updateCall = clientQueries.find((q) =>
    q.sql.startsWith('UPDATE employees SET full_name = $1'),
  );
  assert.ok(updateCall, 'Expected UPDATE employees query');
  assert.match(
    updateCall.sql,
    /date_of_birth = \$3, bank_account_number = \$4/,
    'Expected valid $-prefixed SQL placeholders for extra columns',
  );
  assert.match(
    updateCall.sql,
    /WHERE workspace_id = \$5 AND id = \$6/,
    'Expected valid $-prefixed WHERE placeholders',
  );
  assert.equal(updateCall.params[2], '1999-08-15');
  assert.equal(updateCall.params[3], '1903456789012');
});

test('Phase 19.2 & 19.3: Secret hygiene auditor and isolated backup-restore drill work as expected', async () => {
  const { auditEnvSecretsHygiene, generateRotationKeyBundle } = await import(
    '../../scripts/ops/audit-secrets-hygiene.mjs'
  );
  const { runBackupRestoreDrill } = await import(
    '../../scripts/ops/backup-restore-drill.mjs'
  );
  const { auditEmployeeProfileRows } = await import(
    '../../scripts/ops/verify-profile-data.mjs'
  );

  const bundle = generateRotationKeyBundle();
  assert.match(bundle.CSRF_SECRET, /^[0-9a-f]{64}$/);
  assert.match(bundle.ACCOUNT_SECRET_KEY, /^[0-9a-f]{64}$/);

  const cleanAudit = auditEnvSecretsHygiene({
    CSRF_SECRET: bundle.CSRF_SECRET,
    ACCOUNT_SECRET_KEY: bundle.ACCOUNT_SECRET_KEY,
  });
  assert.equal(cleanAudit.healthy, true);
  assert.equal(cleanAudit.findingCount, 0);

  const dirtyAudit = auditEnvSecretsHygiene({
    ADMIN_PASSWORD: 'leftover-bootstrap-pass',
    CSRF_SECRET: 'short',
    ACCOUNT_SECRET_KEY: 'not-hex',
  });
  assert.equal(dirtyAudit.healthy, false);
  assert.equal(dirtyAudit.findingCount, 3);

  const mockDrillPool = {
    connect: async () => ({
      query: async (sql, params) => {
        if (sql.includes('SELECT COUNT(*)')) {
          return { rows: [{ cnt: 12 }] };
        }
        if (sql.includes('SELECT manifest_sha256')) {
          return { rows: [{ manifest_sha256: params[0], payload: {} }] };
        }
        return { rows: [{ id: '00000000-0000-4000-8000-000000000099' }] };
      },
      release: () => {},
    }),
  };
  const drillReport = await runBackupRestoreDrill(mockDrillPool);
  assert.equal(drillReport.status, 'PASS');
  assert.equal(drillReport.tableCounts.workspaces, 12);
  assert.equal(drillReport.tableCounts.fin_entries, 12);

  const profileAudit = auditEmployeeProfileRows([
    {
      id: 'e1',
      employee_code: 'NV001',
      date_of_birth: '1995-10-20',
      bank_account_number: '0123456789',
    },
    {
      id: 'e2',
      employee_code: 'NV002',
      date_of_birth: '2026-02-30',
      bank_account_number: 'INVALID-ACC',
    },
  ]);
  assert.equal(profileAudit.scannedCount, 2);
  assert.equal(profileAudit.anomalyCount, 2);
});
