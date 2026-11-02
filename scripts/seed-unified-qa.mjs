import { loadConfirmedTestConfig } from './explicit-database.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

import { loadQaCredentials } from './qa-credentials-reader.mjs';

async function main() {
  const { sanitizeDatabaseConfig } = await import(
    `file://${resolve(root, 'dist/packages/database/src/config.js')}`
  );
  const { createDatabasePool, closeDatabasePool, checkDatabaseHealth } =
    await import(
      `file://${resolve(root, 'dist/packages/database/src/pool.js')}`
    );
  const { hashPassword } = await import(
    `file://${resolve(root, 'dist/packages/security/src/password.js')}`
  );
  const { encryptSecretAead, normalizeEncryptionKey } = await import(
    `file://${resolve(root, 'dist/packages/security/src/aead.js')}`
  );

  const creds = loadQaCredentials('.env.qa-credentials.local', {
    requiredKeys: [
      'OWNER_PASSWORD',
      'STAFF_PASSWORD',
      'STAFF2_PASSWORD',
      'ADMIN_PASSWORD',
    ],
  });

  const ownerPassword = creds.OWNER_PASSWORD;
  const staffPassword = creds.STAFF_PASSWORD;
  const staff2Password = creds.STAFF2_PASSWORD;
  const adminPassword = creds.ADMIN_PASSWORD;

  const config = loadConfirmedTestConfig();
  console.log('Seeding target database:', sanitizeDatabaseConfig(config));

  const pool = createDatabasePool(config);

  try {
    const health = await checkDatabaseHealth(pool);
    if (!health.connected) {
      console.error(`Database unreachable: ${health.error}`);
      process.exit(1);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Workspace
      let workspaceId;
      const wsRes = await client.query(
        `SELECT id, name FROM workspaces WHERE status = 'active' LIMIT 1;`,
      );
      if (wsRes.rows.length > 0) {
        workspaceId = wsRes.rows[0].id;
        console.log(
          `Using existing workspace: "${wsRes.rows[0].name}" (${workspaceId})`,
        );
      } else {
        workspaceId = '5c3bb47c-7566-4784-a262-11ff6cd32cbd';
        await client.query(
          `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, 'Cửa hàng Management Lite - Staging', 'Asia/Ho_Chi_Minh', 'active');`,
          [workspaceId],
        );
        console.log(
          `Created workspace: Cửa hàng Management Lite - Staging (${workspaceId})`,
        );
      }

      // Helper to upsert user
      async function upsertUser(
        username,
        email,
        password,
        role,
        preferredId = null,
      ) {
        const hash = await hashPassword(password);
        let userId;
        const uRes = await client.query(
          `SELECT id FROM users WHERE username_normalized = $1;`,
          [username.toLowerCase()],
        );
        if (uRes.rows.length > 0) {
          userId = uRes.rows[0].id;
          await client.query(
            `UPDATE user_credentials SET password_hash = $1, credential_version = credential_version + 1 WHERE user_id = $2;`,
            [hash, userId],
          );
        } else {
          userId = preferredId || crypto.randomUUID();
          await client.query(
            `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, $2, $3, 'active');`,
            [userId, username.toLowerCase(), email.toLowerCase()],
          );
          await client.query(
            `INSERT INTO user_credentials (user_id, password_hash, credential_version) VALUES ($1, $2, 1);`,
            [userId, hash],
          );
        }

        // Membership
        await client.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role, status)
           VALUES ($1, $2, $3, 'active')
           ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = $3, status = 'active';`,
          [workspaceId, userId, role],
        );

        // Binding
        await client.query(
          `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version)
           VALUES ($1, $2, 'active', 1)
           ON CONFLICT (user_id) WHERE status = 'active'
           DO UPDATE SET workspace_id = $1, status = 'active';`,
          [workspaceId, userId],
        );

        return userId;
      }

      const ownerId = await upsertUser(
        'owner',
        'owner@management-lite.local',
        ownerPassword,
        'owner',
      );
      const adminId = await upsertUser(
        'admin',
        'admin@management-lite.local',
        adminPassword,
        'owner',
        '2a565b98-868c-4d8b-821e-fdd9da94dacc',
      );
      const staffId = await upsertUser(
        'staff',
        'staff@management-lite.local',
        staffPassword,
        'staff',
        '13b98f3e-5292-4d9f-a91f-517d2b98c17d',
      );
      const staff2Id = await upsertUser(
        'staff2',
        'staff2@management-lite.local',
        staff2Password,
        'staff',
      );

      console.log('Upserted users: owner, admin, staff, staff2');

      // Helper to upsert employee
      async function upsertEmployee(
        code,
        fullName,
        userId,
        isPayrollEligible = true,
      ) {
        let empId;
        const eRes = await client.query(
          `SELECT id FROM employees WHERE workspace_id = $1 AND employee_code = $2;`,
          [workspaceId, code],
        );
        if (eRes.rows.length > 0) {
          empId = eRes.rows[0].id;
          await client.query(
            `UPDATE employees SET user_id = $1, full_name = $2, employment_status = 'active', is_payroll_eligible = $3 WHERE id = $4;`,
            [userId, fullName, isPayrollEligible, empId],
          );
        } else {
          empId = crypto.randomUUID();
          await client.query(
            `INSERT INTO employees (id, workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible)
             VALUES ($1, $2, $3, $4, $5, 'active', $6);`,
            [empId, workspaceId, userId, code, fullName, isPayrollEligible],
          );
        }
        return empId;
      }

      const empOwnerId = await upsertEmployee(
        'OWNER',
        'Chủ cơ sở',
        ownerId,
        false,
      );
      await upsertEmployee('ADMIN', 'Quản trị viên', adminId, false);
      const empNV001Id = await upsertEmployee(
        'NV001',
        'Nguyễn Văn Một',
        staffId,
        true,
      );
      const empNV002Id = await upsertEmployee(
        'NV002',
        'Trần Thị Hai',
        staff2Id,
        true,
      );
      const empNV003Id = await upsertEmployee('NV003', 'Lê Văn Ba', null, true);

      console.log('Upserted employees: OWNER, ADMIN, NV001, NV002, NV003');

      // 3. Hourly rates
      async function upsertHourlyRate(empId, rateVnd) {
        const rRes = await client.query(
          `SELECT id FROM employee_hourly_rates WHERE workspace_id = $1 AND employee_id = $2 AND effective_to IS NULL;`,
          [workspaceId, empId],
        );
        if (rRes.rows.length === 0) {
          await client.query(
            `INSERT INTO employee_hourly_rates (workspace_id, employee_id, hourly_rate_vnd, effective_from, created_by)
             VALUES ($1, $2, $3, '2026-01-01T00:00:00Z', $4);`,
            [workspaceId, empId, rateVnd, ownerId],
          );
        }
      }

      await upsertHourlyRate(empNV001Id, 50000);
      await upsertHourlyRate(empNV002Id, 45000);
      await upsertHourlyRate(empNV003Id, 40000);

      // 4. Attendance Shifts
      const attRes = await client.query(
        `SELECT id FROM attendance_shifts WHERE workspace_id = $1 LIMIT 1;`,
        [workspaceId],
      );
      if (attRes.rows.length === 0) {
        const shift1Id = crypto.randomUUID();
        const v1Id = crypto.randomUUID();
        await client.query(
          `INSERT INTO attendance_shifts (
            id, workspace_id, employee_id, clock_in_at, clock_out_at, run_state, review_state, version
          ) VALUES (
            $1, $2, $3, '2026-10-05T08:00:00+07:00', '2026-10-05T17:00:00+07:00', 'completed', 'approved', 1
          );`,
          [shift1Id, workspaceId, empNV001Id],
        );
        await client.query(
          `INSERT INTO attendance_shift_versions (
            id, workspace_id, shift_id, version_number, clock_in_at, clock_out_at, breaks_snapshot, worked_seconds, snapshot_hash, created_by
          ) VALUES (
            $1, $2, $3, 1, '2026-10-05T08:00:00+07:00', '2026-10-05T17:00:00+07:00', '[]'::jsonb, 32400, 'qa-snapshot-hash-1', $4
          );`,
          [v1Id, workspaceId, shift1Id, ownerId],
        );
        await client.query(
          `UPDATE attendance_shifts SET current_version_id = $1 WHERE id = $2;`,
          [v1Id, shift1Id],
        );
        await client.query(
          `INSERT INTO attendance_approvals (
            workspace_id, shift_id, shift_version_id, reviewer_user_id, decision
          ) VALUES ($1, $2, $3, $4, 'approved');`,
          [workspaceId, shift1Id, v1Id, ownerId],
        );

        const shift2Id = crypto.randomUUID();
        const v2Id = crypto.randomUUID();
        await client.query(
          `INSERT INTO attendance_shifts (
            id, workspace_id, employee_id, clock_in_at, clock_out_at, run_state, review_state, version
          ) VALUES (
            $1, $2, $3, '2026-10-06T08:05:00+07:00', '2026-10-06T17:00:00+07:00', 'completed', 'approved', 1
          );`,
          [shift2Id, workspaceId, empNV002Id],
        );
        await client.query(
          `INSERT INTO attendance_shift_versions (
            id, workspace_id, shift_id, version_number, clock_in_at, clock_out_at, breaks_snapshot, worked_seconds, snapshot_hash, created_by
          ) VALUES (
            $1, $2, $3, 1, '2026-10-06T08:05:00+07:00', '2026-10-06T17:00:00+07:00', '[]'::jsonb, 32100, 'qa-snapshot-hash-2', $4
          );`,
          [v2Id, workspaceId, shift2Id, ownerId],
        );
        await client.query(
          `UPDATE attendance_shifts SET current_version_id = $1 WHERE id = $2;`,
          [v2Id, shift2Id],
        );
        await client.query(
          `INSERT INTO attendance_approvals (
            workspace_id, shift_id, shift_version_id, reviewer_user_id, decision
          ) VALUES ($1, $2, $3, $4, 'approved');`,
          [workspaceId, shift2Id, v2Id, ownerId],
        );

        console.log(
          'Seeded attendance shifts with immutable versions and approvals',
        );
      } else {
        // Fix existing shifts if current_version_id is null
        const unversioned = await client.query(
          `SELECT id, workspace_id, clock_in_at, clock_out_at, review_state FROM attendance_shifts WHERE current_version_id IS NULL AND clock_out_at IS NOT NULL;`,
        );
        for (const s of unversioned.rows) {
          const vId = crypto.randomUUID();
          await client.query(
            `INSERT INTO attendance_shift_versions (
              id, workspace_id, shift_id, version_number, clock_in_at, clock_out_at, breaks_snapshot, worked_seconds, snapshot_hash, created_by
            ) VALUES (
              $1, $2, $3, 1, $4, $5, '[]'::jsonb, 32400, 'qa-snapshot-hash-fix', $6
            );`,
            [vId, s.workspace_id, s.id, s.clock_in_at, s.clock_out_at, ownerId],
          );
          await client.query(
            `UPDATE attendance_shifts SET current_version_id = $1, review_state = 'approved' WHERE id = $2;`,
            [vId, s.id],
          );
          await client.query(
            `INSERT INTO attendance_approvals (
              workspace_id, shift_id, shift_version_id, reviewer_user_id, decision
            ) VALUES ($1, $2, $3, $4, 'approved');`,
            [s.workspace_id, s.id, vId, ownerId],
          );
        }
      }

      // 5. Schedules
      const schedRes = await client.query(
        `SELECT id FROM staff_schedules WHERE workspace_id = $1 LIMIT 1;`,
        [workspaceId],
      );
      if (schedRes.rows.length === 0) {
        const schedId = crypto.randomUUID();
        await client.query(
          `INSERT INTO staff_schedules (id, workspace_id, employee_id, week_start_date, week_end_date, status, current_revision, version)
           VALUES ($1, $2, $3, '2026-10-05', '2026-10-11', 'registered', 1, 1);`,
          [schedId, workspaceId, empNV001Id],
        );
        await client.query(
          `INSERT INTO staff_schedule_entries (
            workspace_id, schedule_id, work_date, day_of_week, start_time, notes
          ) VALUES (
            $1, $2, '2026-10-07', 3, '08:00', 'Ca sáng'
          );`,
          [workspaceId, schedId],
        );
        console.log('Seeded schedules');
      }

      // 6. Payroll Period
      const payRes = await client.query(
        `SELECT id FROM payroll_periods WHERE workspace_id = $1 AND period_month = '2026-10';`,
        [workspaceId],
      );
      if (payRes.rows.length === 0) {
        const periodId = crypto.randomUUID();
        await client.query(
          `INSERT INTO payroll_periods (id, workspace_id, period_month, starts_on, ends_on, status, calculation_revision, version)
           VALUES ($1, $2, '2026-10', '2026-10-01', '2026-10-31', 'draft', 1, 1);`,
          [periodId, workspaceId],
        );
        await client.query(
          `INSERT INTO payroll_employee_items (
            period_id, workspace_id, employee_id, approved_worked_seconds, approved_worked_minutes, base_pay_vnd, paid_leave_pay_vnd, net_pay_vnd, version
          ) VALUES
            ($1, $2, $3, 576000, 9600, 8000000, 0, 8000000, 1),
            ($1, $2, $4, 576000, 9600, 7200000, 0, 7200000, 1);`,
          [periodId, workspaceId, empNV001Id, empNV002Id],
        );
        console.log('Seeded payroll period 2026-10');
      }

      // 7. WORK Items
      const workRes = await client.query(
        `SELECT id FROM work_items WHERE workspace_id = $1 LIMIT 1;`,
        [workspaceId],
      );
      if (workRes.rows.length === 0) {
        const item1Id = crypto.randomUUID();
        await client.query(
          `INSERT INTO work_items (id, workspace_id, title, description, work_type, status, priority, created_by, version)
           VALUES ($1, $2, 'Thiết kế banner khuyến mãi mùa thu', 'Yêu cầu kích thước 1200x630px, định dạng PNG', 'design', 'todo', 'high', $3, 1);`,
          [item1Id, workspaceId, ownerId],
        );
        const assign1Id = crypto.randomUUID();
        await client.query(
          `INSERT INTO work_assignments (id, workspace_id, work_item_id, employee_id, stage, status, assigned_by)
           VALUES ($1, $2, $3, $4, 'primary', 'todo', $5);`,
          [assign1Id, workspaceId, item1Id, empNV001Id, ownerId],
        );

        const item2Id = crypto.randomUUID();
        await client.query(
          `INSERT INTO work_items (id, workspace_id, title, description, work_type, status, priority, created_by, version)
           VALUES ($1, $2, 'Kiểm kê định kỳ kho hàng tháng 10', 'Đối soát tồn kho thực tế và trên phần mềm', 'general', 'todo', 'medium', $3, 1);`,
          [item2Id, workspaceId, ownerId],
        );
        const assign2Id = crypto.randomUUID();
        await client.query(
          `INSERT INTO work_assignments (id, workspace_id, work_item_id, employee_id, stage, status, assigned_by)
           VALUES ($1, $2, $3, $4, 'primary', 'todo', $5);`,
          [assign2Id, workspaceId, item2Id, empNV002Id, ownerId],
        );
        console.log('Seeded WORK items');
      }

      // 8. ACC Accounts & Secrets
      const accRes = await client.query(
        `SELECT id FROM managed_accounts WHERE workspace_id = $1 LIMIT 1;`,
        [workspaceId],
      );
      if (accRes.rows.length === 0) {
        const rawVaultKey = process.env['ACCOUNT_SECRET_KEY'];
        let vaultKey;
        if (rawVaultKey) {
          vaultKey = normalizeEncryptionKey(rawVaultKey);
        }

        const acc1Id = crypto.randomUUID();
        await client.query(
          `INSERT INTO managed_accounts (id, workspace_id, platform, platform_account_id, username, status, notes, version)
           VALUES ($1, $2, 'tiktok', 'shop_mglite_qa', 'shop_admin', 'active', 'Tài khoản chính TikTok Shop QA Staging', 1);`,
          [acc1Id, workspaceId],
        );

        const acc2Id = crypto.randomUUID();
        await client.query(
          `INSERT INTO managed_accounts (id, workspace_id, platform, platform_account_id, username, status, notes, version)
           VALUES ($1, $2, 'gmail', 'support_mglite_qa', 'support@mglite.vn', 'active', 'Hòm thư hỗ trợ khách hàng QA Staging', 1);`,
          [acc2Id, workspaceId],
        );

        if (vaultKey) {
          const aad1 = `${workspaceId}:${acc1Id}:password:1`;
          const enc1 = encryptSecretAead(
            'TikTokPass2026!Secure',
            vaultKey,
            aad1,
          );
          await client.query(
            `INSERT INTO account_secrets (workspace_id, account_id, secret_type, ciphertext, nonce, auth_tag, key_version, encryption_schema_version, secret_version)
             VALUES ($1, $2, 'password', $3, $4, $5, 'v1', 1, 1);`,
            [workspaceId, acc1Id, enc1.ciphertext, enc1.nonce, enc1.authTag],
          );

          const aad2 = `${workspaceId}:${acc2Id}:password:1`;
          const enc2 = encryptSecretAead(
            'GmailPass2026!Secure',
            vaultKey,
            aad2,
          );
          await client.query(
            `INSERT INTO account_secrets (workspace_id, account_id, secret_type, ciphertext, nonce, auth_tag, key_version, encryption_schema_version, secret_version)
             VALUES ($1, $2, 'password', $3, $4, $5, 'v1', 1, 1);`,
            [workspaceId, acc2Id, enc2.ciphertext, enc2.nonce, enc2.authTag],
          );
        }
        console.log('Seeded ACC managed accounts & encrypted secrets');
      }

      // 9. FILE Storage Folders
      const fileRes = await client.query(
        `SELECT id FROM storage_folders WHERE workspace_id = $1 LIMIT 1;`,
        [workspaceId],
      );
      if (fileRes.rows.length === 0) {
        const srcFolderId = crypto.randomUUID();
        await client.query(
          `INSERT INTO storage_folders (
            id, workspace_id, name, provider, provider_folder_id, drive_url,
            folder_type, status, assigned_employee_id, created_by_employee_id, version
          ) VALUES (
            $1, $2, 'Tài liệu nguồn thiết kế tháng 10', 'google_drive', 'gdrive_src_folder_001',
            'https://drive.google.com/drive/folders/gdrive_src_folder_001',
            'source', 'ready_for_download', $3, $4, 1
          );`,
          [srcFolderId, workspaceId, empNV001Id, empOwnerId],
        );

        await client.query(
          `INSERT INTO folder_assignments (workspace_id, folder_id, employee_id, source_download_confirmed)
           VALUES ($1, $2, $3, false);`,
          [workspaceId, srcFolderId, empNV001Id],
        );

        const outFolderId = crypto.randomUUID();
        await client.query(
          `INSERT INTO storage_folders (
            id, workspace_id, name, provider, provider_folder_id, drive_url,
            folder_type, status, parent_folder_id, assigned_employee_id, created_by_employee_id, version
          ) VALUES (
            $1, $2, 'Thành phẩm banner hoàn thiện', 'google_drive', 'gdrive_out_folder_001',
            'https://drive.google.com/drive/folders/gdrive_out_folder_001',
            'deliverable', 'ready_for_download', $3, $4, $5, 1
          );`,
          [outFolderId, workspaceId, srcFolderId, empNV001Id, empOwnerId],
        );

        await client.query(
          `INSERT INTO folder_assignments (workspace_id, folder_id, employee_id, source_download_confirmed)
           VALUES ($1, $2, $3, false);`,
          [workspaceId, outFolderId, empNV001Id],
        );

        console.log('Seeded FILE storage folders');
      }

      await client.query('COMMIT');
      console.log('\n=============================================');
      console.log('✅ SEED UNIFIED STAGING SUCCESSFUL');
      console.log('=============================================');
      console.log(
        `Workspace: Cửa hàng Management Lite - Staging (${workspaceId})`,
      );
      console.log(
        'Modules seeded: Users, Employees, Attendance, Schedules, Payroll, WORK, ACC, FILE',
      );
      console.log('=============================================\n');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await closeDatabasePool(pool);
  }
}

main().catch((err) => {
  console.error('Unified staging seed failed:', err);
  process.exit(1);
});
