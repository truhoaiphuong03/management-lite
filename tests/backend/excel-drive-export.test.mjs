import assert from 'node:assert/strict';
import { test } from 'node:test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { resolve } from 'node:path';

test('Excel 4-Sheet Export to Private Google Drive: UI wiring + StorageService + XLSX 4 sheets + Zero Public Sharing', async (t) => {
  await t.test(
    '1. UI screens include ExportDriveExcelButton across Employees, Attendance, Payroll, and Finance',
    () => {
      const btnFile = fs.readFileSync(
        resolve('apps/web/src/components/ExportDriveExcelButton.tsx'),
        'utf8',
      );
      assert.ok(btnFile.includes('/api/v1/storage/drive/export-excel'));

      const empScreen = fs.readFileSync(
        resolve('apps/web/src/screens/EmployeesScreen.tsx'),
        'utf8',
      );
      assert.ok(empScreen.includes('ExportDriveExcelButton'));
      assert.ok(empScreen.includes('btn-export-excel-drive-employees'));

      const clockScreen = fs.readFileSync(
        resolve('apps/web/src/screens/ClockScreen.tsx'),
        'utf8',
      );
      assert.ok(clockScreen.includes('ExportDriveExcelButton'));
      assert.ok(clockScreen.includes('btn-export-excel-drive-attendance'));

      const payrollScreen = fs.readFileSync(
        resolve('apps/web/src/screens/PayrollScreen.tsx'),
        'utf8',
      );
      assert.ok(payrollScreen.includes('ExportDriveExcelButton'));
      assert.ok(payrollScreen.includes('btn-export-excel-drive-payroll'));

      const financeUi = fs.readFileSync(
        resolve('apps/web/src/finance/ui.tsx'),
        'utf8',
      );
      assert.ok(financeUi.includes('ExportDriveExcelButton'));
      assert.ok(financeUi.includes('btn-export-excel-drive-finance'));
    },
  );

  await t.test(
    '2. StorageService.exportWorkspaceExcelToDrive builds 4-sheet XLSX (Nhân viên, Chấm công, Lương, Thu chi) and uploads to private Google Drive folder without public sharing',
    async () => {
      const { StorageService } =
        await import('../../dist/apps/api/src/storage/service.js');
      const { MockGoogleDriveProvider } =
        await import('../../dist/apps/api/src/storage/provider.js');
      const { readXlsx } =
        await import('../../dist/apps/api/src/payroll/xlsx.js');
      const { encryptSecretAead, normalizeEncryptionKey } =
        await import('../../dist/packages/security/src/aead.js');

      const workspaceId = crypto.randomUUID();
      const ownerId = crypto.randomUUID();
      const staffId = crypto.randomUUID();
      const folderUuid = crypto.randomUUID();
      const fileUuid = crypto.randomUUID();

      const key = normalizeEncryptionKey(
        '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0',
      );
      const encryptedToken = encryptSecretAead(
        '1//mock-gdrive-refresh-token-private',
        key,
        `storage_drive_connection:${workspaceId}`,
      );

      let driveConnected = false;
      const insertedFolders = [];
      const insertedFiles = [];
      const insertedGrants = [];

      const mockClient = {
        async query(sql, params = []) {
          const s = String(sql).trim();
          if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') {
            return { rows: [], rowCount: 0 };
          }
          if (s.includes('FROM storage_drive_connections')) {
            if (!driveConnected) return { rows: [], rowCount: 0 };
            return {
              rows: [
                {
                  id: crypto.randomUUID(),
                  google_email: 'owner-private@hoaiphuong.click',
                  root_folder_id: 'gdrive_root_private123',
                  root_folder_url:
                    'https://drive.google.com/drive/folders/gdrive_root_private123',
                  status: 'active',
                  encrypted_refresh_token: encryptedToken.ciphertext,
                  encryption_iv: encryptedToken.iv,
                  encryption_auth_tag: encryptedToken.authTag,
                  key_version: 1,
                },
              ],
              rowCount: 1,
            };
          }
          if (
            s.includes('FROM storage_folders f') &&
            s.includes('AND f.name = $2')
          ) {
            return { rows: [], rowCount: 0 };
          }
          if (s.startsWith('INSERT INTO storage_folders')) {
            insertedFolders.push(params);
            return { rows: [{ id: folderUuid }], rowCount: 1 };
          }
          if (s.includes('FROM employees e') && s.includes('LEFT JOIN users u')) {
            return {
              rows: [
                {
                  employee_code: 'ADM01',
                  full_name: 'Chủ cơ sở Hoài Phương',
                  role: 'owner',
                  job_title: 'Giám đốc',
                  phone: '0901234567',
                  email: 'owner@hoaiphuong.click',
                  date_of_birth: '1990-01-01',
                  bank_name: 'Vietcombank',
                  bank_account_number: '0011001234567',
                  bank_account_holder: 'TRU HOAI PHUONG',
                  payroll_calculation_enabled: false,
                  status: 'active',
                  created_at_vn: '2026-01-01 08:00',
                },
                {
                  employee_code: 'NV001',
                  full_name: 'Nhân viên Nguyễn Văn A',
                  role: 'staff',
                  job_title: 'Kỹ thuật in',
                  phone: '0909888777',
                  email: 'nv001@hoaiphuong.click',
                  date_of_birth: '1998-05-15',
                  bank_name: 'Techcombank',
                  bank_account_number: '190333444555',
                  bank_account_holder: 'NGUYEN VAN A',
                  payroll_calculation_enabled: true,
                  status: 'active',
                  created_at_vn: '2026-02-01 08:30',
                },
              ],
              rowCount: 2,
            };
          }
          if (s.includes('FROM attendance_shifts s')) {
            return {
              rows: [
                {
                  employee_code: 'NV001',
                  employee_name: 'Nhân viên Nguyễn Văn A',
                  shift_date_vn: '2026-11-10',
                  clock_in_vn: '2026-11-10 08:00:00',
                  clock_out_vn: '2026-11-10 17:00:00',
                  worked_seconds: 28800,
                  run_state: 'completed',
                  review_state: 'approved',
                  approval_reason: 'Đúng giờ',
                },
              ],
              rowCount: 1,
            };
          }
          if (
            s.includes('FROM employees e') &&
            s.includes('LEFT JOIN payroll_employee_items i')
          ) {
            return {
              rows: [
                {
                  period_month: '2026-11',
                  period_status: 'finalized',
                  employee_code: 'NV001',
                  full_name: 'Nhân viên Nguyễn Văn A',
                  hourly_rate_vnd: 35000,
                  approved_worked_minutes: 480,
                  base_pay_vnd: 280000,
                  paid_leave_pay_vnd: 20000,
                  net_pay_vnd: 300000,
                  paid_amount_vnd: 100000,
                  bank_name: 'Techcombank',
                  bank_account_number: '190333444555',
                  bank_account_holder: 'NGUYEN VAN A',
                },
              ],
              rowCount: 1,
            };
          }
          if (s.includes('FROM fin_entries e')) {
            return {
              rows: [
                {
                  occurred_on: '2026-11-10',
                  occurred_at_vn: '2026-11-10 10:30:00',
                  direction: 'income',
                  category_name_snapshot: 'Doanh thu bán hàng',
                  amount_vnd: 1500000,
                  note: 'Thu tiền đơn hàng in ấn',
                  root_entry_id: '11111111-2222-3333-4444-555555555555',
                  revision_number: 1,
                },
              ],
              rowCount: 1,
            };
          }
          if (s.includes('SELECT to_char(clock_timestamp()')) {
            return { rows: [{ stamp: '2026-11-11_22-30-00' }], rowCount: 1 };
          }
          if (s.startsWith('INSERT INTO storage_files')) {
            insertedFiles.push(params);
            return {
              rows: [{ id: fileUuid, created_at: new Date('2026-11-11T15:30:00Z') }],
              rowCount: 1,
            };
          }
          if (s.startsWith('INSERT INTO resource_access_grants')) {
            insertedGrants.push(params);
            return { rows: [], rowCount: 1 };
          }
          if (s.includes('audit_events')) {
            return { rows: [{ id: crypto.randomUUID() }], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        },
        release() {},
      };

      const mockPool = {
        async connect() {
          return mockClient;
        },
        async query(sql, params) {
          return mockClient.query(sql, params);
        },
      };

      const mockProvider = new MockGoogleDriveProvider();
      let capturedUploadChunk = null;
      const origUploadChunk = mockProvider.uploadResumableChunk.bind(mockProvider);
      mockProvider.uploadResumableChunk = async (input, token) => {
        capturedUploadChunk = input;
        return origUploadChunk(input, token);
      };
      const service = new StorageService(mockPool, mockProvider);

      const ownerAuth = {
        user: {
          id: ownerId,
          email: 'owner@hoaiphuong.click',
          username: 'owner',
          status: 'active',
        },
        workspace: {
          id: workspaceId,
          name: 'Hoài Phương Workspace',
          role: 'owner',
        },
        session: {
          id: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 3600_000),
        },
      };

      const staffAuth = {
        ...ownerAuth,
        user: {
          id: staffId,
          email: 'nv001@hoaiphuong.click',
          username: 'nv001',
          status: 'active',
        },
        workspace: {
          ...ownerAuth.workspace,
          role: 'staff',
        },
      };

      // 2a. Non-owner staff is forbidden (403)
      await assert.rejects(
        () => service.exportWorkspaceExcelToDrive(staffAuth, {}),
        (err) => err.statusCode === 403,
      );

      // 2b. Disconnected Google Drive returns 400 DRIVE_NOT_CONNECTED
      await assert.rejects(
        () => service.exportWorkspaceExcelToDrive(ownerAuth, {}),
        (err) =>
          err.statusCode === 400 && err.code === 'DRIVE_NOT_CONNECTED',
      );

      // 2c. Connected Google Drive exports 4-sheet workbook into private folder
      driveConnected = true;
      const result = await service.exportWorkspaceExcelToDrive(ownerAuth, {});

      assert.equal(result.private_only, true);
      assert.equal(result.public_shared, false);
      assert.equal(result.folder_name, 'Báo cáo Excel Nội bộ (Riêng tư)');
      assert.equal(
        result.file_name,
        'Bao-cao-Noi-bo-4-Sheet_2026-11-11_22-30-00.xlsx',
      );
      assert.deepEqual(result.sheets, {
        employees: 2,
        attendance: 1,
        payroll: 1,
        finance: 1,
      });

      // Verify uploaded XLSX buffer passed to provider has all 4 sheets and exact data
      assert.ok(capturedUploadChunk?.chunkDataBase64, 'Uploaded XLSX chunk base64 must be passed to provider');
      const xlsxBuffer = Buffer.from(capturedUploadChunk.chunkDataBase64, 'base64');
      assert.ok(xlsxBuffer && xlsxBuffer.length > 0);

      const workbook = readXlsx(xlsxBuffer);
      assert.deepEqual(
        workbook.map((s) => s.name),
        ['Nhân viên', 'Chấm công', 'Lương', 'Thu chi'],
      );

      // Sheet 1: Nhân viên
      const empSheet = workbook[0];
      assert.equal(empSheet.cells.get('A1'), 'Mã NV');
      assert.equal(empSheet.cells.get('A2'), 'ADM01');
      assert.equal(empSheet.cells.get('A3'), 'NV001');
      assert.equal(empSheet.cells.get('B3'), 'Nhân viên Nguyễn Văn A');

      // Sheet 2: Chấm công
      const attSheet = workbook[1];
      assert.equal(attSheet.cells.get('A1'), 'Ngày ca (VN)');
      assert.equal(attSheet.cells.get('B2'), 'NV001');
      assert.equal(attSheet.cells.get('F2'), 480); // 480 worked minutes
      assert.equal(attSheet.cells.get('G2'), 8); // 8 worked hours

      // Sheet 3: Lương
      const paySheet = workbook[2];
      assert.equal(paySheet.cells.get('A1'), 'Kỳ lương (YYYY-MM)');
      assert.equal(paySheet.cells.get('C2'), 'NV001');
      assert.equal(paySheet.cells.get('E2'), 35000); // hourly_rate_vnd
      assert.equal(paySheet.cells.get('J2'), 300000); // net_pay_vnd
      assert.equal(paySheet.cells.get('K2'), 100000); // paid_amount_vnd
      assert.equal(paySheet.cells.get('L2'), 200000); // remaining

      // Sheet 4: Thu chi
      const finSheet = workbook[3];
      assert.equal(finSheet.cells.get('A1'), 'Ngày ghi sổ');
      assert.equal(finSheet.cells.get('D2'), 'Doanh thu bán hàng');
      assert.equal(finSheet.cells.get('E2'), 1500000);

      // Verify zero public/staff permissions granted
      assert.equal(insertedGrants.length, 0);
      assert.equal(
        mockProvider.permissionsByResource.has(result.provider_folder_id),
        false,
      );
      assert.equal(
        mockProvider.permissionsByResource.has(result.provider_file_id),
        false,
      );
    },
  );
});
