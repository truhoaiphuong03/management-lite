import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

const ML_TEST_ROOT = 'C:\\ML-Test';
const PG_BIN_DIR = path.join(ML_TEST_ROOT, 'pgsql', 'bin');
const PG_DATA_DIR = path.join(ML_TEST_ROOT, 'pgdata');
const ADMIN_PW_FILE = path.join(ML_TEST_ROOT, 'secrets', 'admin.pw');

const CSRF_SECRET = 'staging-rehearsal-0036-csrf-secret-32chars!';
const ALLOWED_ORIGIN = 'http://127.0.0.1:4001';

async function ensureIsolatedWindowsPostgres55433() {
  const pgIsReady = path.join(PG_BIN_DIR, 'pg_isready.exe');
  const check = spawnSync(pgIsReady, ['-h', '127.0.0.1', '-p', '55433'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (check.status === 0) {
    return { startedByTest: false };
  }
  const postgresExe = path.join(PG_BIN_DIR, 'postgres.exe');
  const child = spawn(postgresExe, ['-D', PG_DATA_DIR], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 300));
    const ready = spawnSync(pgIsReady, ['-h', '127.0.0.1', '-p', '55433'], {
      encoding: 'utf8',
      timeout: 3000,
    });
    if (ready.status === 0) {
      return { startedByTest: true };
    }
  }
  throw new Error('Failed to start isolated PostgreSQL on 127.0.0.1:55433');
}

function stopIsolatedWindowsPostgres55433() {
  const pgCtl = path.join(PG_BIN_DIR, 'pg_ctl.exe');
  if (fs.existsSync(pgCtl)) {
    spawnSync(pgCtl, ['-D', PG_DATA_DIR, 'stop', '-m', 'fast'], {
      encoding: 'utf8',
      timeout: 10000,
    });
  }
}

function resolvePgBinary(toolName) {
  if (process.platform === 'win32') {
    const winCandidate = path.join(PG_BIN_DIR, `${toolName}.exe`);
    if (fs.existsSync(winCandidate)) return winCandidate;
  }
  const probe = spawnSync(toolName, ['--version'], {
    encoding: 'utf8',
    timeout: 3000,
  });
  if (probe.status === 0) return toolName;
  return null;
}

async function apiRequest(
  baseUrl,
  method,
  urlPath,
  { cookie, csrfToken, idempotencyKey, body } = {},
) {
  const headers = { Origin: ALLOWED_ORIGIN };
  if (cookie) headers['Cookie'] = cookie;
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers,
    body: payload,
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

test('Staging Migration 0036 Rehearsal: pre/post reconciliation, receipts/refunds/missing-customer/mismatch/cancelled orders, anti-double-counting & 3-layer fail-closed rollback', async (t) => {
  const { loadTestDatabaseConfig } = await import(
    pathToFileURL(path.join(REPO_ROOT, 'dist/packages/database/src/config.js'))
      .href
  );
  const { createDatabasePool } = await import(
    pathToFileURL(path.join(REPO_ROOT, 'dist/packages/database/src/pool.js'))
      .href
  );
  const { loadMigrationFiles, runMigrations } = await import(
    pathToFileURL(
      path.join(REPO_ROOT, 'dist/packages/database/src/migrator.js'),
    ).href
  );
  const { createRequestHandler } = await import(
    pathToFileURL(path.join(REPO_ROOT, 'dist/apps/api/src/app.js')).href
  );
  const { generateCsrfToken } = await import(
    pathToFileURL(path.join(REPO_ROOT, 'dist/packages/security/src/csrf.js'))
      .href
  );
  const { hashToken } = await import(
    pathToFileURL(path.join(REPO_ROOT, 'dist/packages/security/src/tokens.js'))
      .href
  );
  const {
    calculatePrintQuote,
    createQuoteOrderSnapshot,
    VendorCostMode,
    ProfitMode,
    ProfitScope,
  } = await import(
    pathToFileURL(
      path.join(REPO_ROOT, 'dist/packages/contracts/src/printquote.js'),
    ).href
  );

  let pgState = { startedByTest: false };
  let host = '127.0.0.1';
  let port = 55433;
  let adminUser = 'ml_test_admin';
  let adminPw = '';

  if (process.env.TEST_DATABASE_URL) {
    const cfg = loadTestDatabaseConfig();
    const parsed = new URL(cfg.connectionString);
    host = parsed.hostname;
    port = Number(parsed.port || 5432);
    if (process.platform === 'win32' && fs.existsSync(ADMIN_PW_FILE)) {
      adminUser = 'ml_test_admin';
      adminPw = fs.readFileSync(ADMIN_PW_FILE, 'utf8').trim();
    } else {
      adminUser = decodeURIComponent(parsed.username || 'postgres');
      adminPw = decodeURIComponent(parsed.password || '');
    }
  } else if (process.platform === 'win32' && fs.existsSync(ADMIN_PW_FILE)) {
    pgState = await ensureIsolatedWindowsPostgres55433();
    adminPw = fs.readFileSync(ADMIN_PW_FILE, 'utf8').trim();
  } else {
    t.diagnostic(
      'Requires isolated TEST_DATABASE_URL or Windows C:\\ML-Test :55433',
    );
    return;
  }

  // Verify isolation against Production port 55432 on non-CI hosts
  if (process.env.GITHUB_ACTIONS !== 'true') {
    assert.notEqual(
      port,
      55432,
      'Staging rehearsal MUST NEVER connect to Production port 55432',
    );
    assert.notEqual(
      adminUser.toLowerCase(),
      'hp_test_admin',
      'Staging rehearsal MUST NEVER use Production DB user hp_test_admin',
    );
  }

  const suffix = crypto.randomBytes(4).toString('hex');
  const drillDbName = `ml_stg0036_drill_test_${suffix}`;
  const restoreDbName = `ml_stg0036_restore_test_${suffix}`;
  const tmpDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ml-stg0036-rehearsal-'),
  );

  const adminPool = createDatabasePool({
    host,
    port,
    user: adminUser,
    password: adminPw,
    database: 'postgres',
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

  await adminPool.query(
    `CREATE DATABASE "${drillDbName}" OWNER "${adminUser}"`,
  );
  await adminPool.query(
    `CREATE DATABASE "${restoreDbName}" OWNER "${adminUser}"`,
  );

  const drillPool = createDatabasePool({
    host,
    port,
    user: adminUser,
    password: adminPw,
    database: drillDbName,
    max: 6,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  });

  let restorePool = null;
  let stagingServer = null;

  try {
    // =========================================================================
    // STEP 1: Apply pre-0036 schema (0001..0035) & seed simulated historical data
    // =========================================================================
    const allMigs = loadMigrationFiles(
      path.join(REPO_ROOT, 'packages/database/src/migrations'),
    );
    const pre0036Migs = allMigs.filter((m) => m.id < '0036_');
    assert.equal(
      pre0036Migs.length,
      35,
      'Pre-0036 baseline must contain 0001..0035 (35 migrations)',
    );
    await runMigrations(drillPool, pre0036Migs);

    await drillPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hp_app_runtime') THEN
          CREATE ROLE hp_app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
        END IF;
      END $$;
    `);

    const workspaceId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    await drillPool.query(
      `INSERT INTO workspaces (id, name, timezone, status)
       VALUES ($1, 'Staging Rehearsal 0036 Workspace', 'Asia/Ho_Chi_Minh', 'active')`,
      [workspaceId],
    );
    await drillPool.query(
      `INSERT INTO users (id, username_normalized, email_normalized, status)
       VALUES ($1, $2, $3, 'active')`,
      [ownerId, `owner_stg_${suffix}`, `owner-stg-${suffix}@mglite.local`],
    );
    await drillPool.query(
      `INSERT INTO user_credentials (user_id, password_hash, credential_version)
       VALUES ($1, 'argon2id$stub', 1)`,
      [ownerId],
    );
    await drillPool.query(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status)
       VALUES ($1, $2, $3, 'owner', 'active')`,
      [crypto.randomUUID(), workspaceId, ownerId],
    );
    await drillPool.query(
      `INSERT INTO user_workspace_bindings (user_id, workspace_id, status, version)
       VALUES ($1, $2, 'active', 1)`,
      [ownerId, workspaceId],
    );
    await drillPool.query(
      `INSERT INTO employees (
         id, workspace_id, user_id, employee_code, full_name, employment_status, sub_role, sub_permissions
       ) VALUES ($1, $2, $3, 'OWN01', 'Owner Staging Rehearsal', 'active', 'staff', '[]'::jsonb)`,
      [crypto.randomUUID(), workspaceId, ownerId],
    );

    const rawOwnerToken = `tok-stg-owner-${crypto.randomUUID()}`;
    const ownerTokenHash = hashToken(rawOwnerToken);
    await drillPool.query(
      `INSERT INTO auth_sessions (
         id, workspace_id, user_id, session_token_hash,
         credential_version_at_issue, idle_expires_at, absolute_expires_at, remember_me
       ) VALUES ($1, $2, $3, $4, 1, now() + interval '4 hours', now() + interval '24 hours', false)`,
      [crypto.randomUUID(), workspaceId, ownerId, ownerTokenHash],
    );
    const ownerCookie = `ml_staging_session=${rawOwnerToken}`;
    const ownerCsrf = generateCsrfToken(ownerTokenHash, CSRF_SECRET);

    // Seed /finance sentinel (fin_categories + fin_entries) to prove 0 cross-module impact
    const finIncomeCatId = crypto.randomUUID();
    const finExpenseCatId = crypto.randomUUID();
    const finIncomeEntryId = crypto.randomUUID();
    const finExpenseEntryId = crypto.randomUUID();
    await drillPool.query(
      `INSERT INTO fin_categories (id, workspace_id, owner_user_id, direction, name)
       VALUES ($1, $2, $3, 'income', 'Doanh thu Media'),
              ($4, $2, $3, 'expense', 'Chi phí Văn phòng')`,
      [finIncomeCatId, workspaceId, ownerId, finExpenseCatId],
    );
    await drillPool.query(
      `INSERT INTO fin_entries (
         id, root_entry_id, workspace_id, owner_user_id, revision_number,
         direction, category_id, category_name_snapshot, amount_vnd,
         occurred_on, note, operation_key, request_fingerprint
       ) VALUES
         ($1, $1, $2, $3, 1, 'income', $4, 'Doanh thu Media', 15000000, DATE '2026-11-01', 'Sentinel thu /finance', 'op-fin-inc-1', $6),
         ($5, $5, $2, $3, 1, 'expense', $7, 'Chi phí Văn phòng', 4200000, DATE '2026-11-02', 'Sentinel chi /finance', 'op-fin-exp-1', $8)`,
      [
        finIncomeEntryId,
        workspaceId,
        ownerId,
        finIncomeCatId,
        finExpenseEntryId,
        'a'.repeat(64),
        finExpenseCatId,
        'b'.repeat(64),
      ],
    );

    // Seed PrintQuote customers & workshop vendor
    const cust1Id = crypto.randomUUID();
    const cust2Id = crypto.randomUUID();
    const custSameNameId = crypto.randomUUID();
    const vendor1Id = crypto.randomUUID();
    await drillPool.query(
      `INSERT INTO print_customers (id, workspace_id, code, name, phone, is_active)
       VALUES ($1, $2, 'KH-STG-001', 'Công ty TNHH Minh Phát', '0901111001', true),
              ($3, $2, 'KH-STG-002', 'Xưởng Quảng Cáo Đại Việt', '0901111002', true),
              ($4, $2, 'KH-STG-003', 'Công ty Ánh Dương Trùng Tên', '0901111003', true)`,
      [cust1Id, workspaceId, cust2Id, custSameNameId],
    );
    await drillPool.query(
      `INSERT INTO print_vendors (id, workspace_id, code, name, phone, is_active)
       VALUES ($1, $2, 'XG-STG-001', 'Nhà In Gia Công Hoàng Gia', '0909888777', true)`,
      [vendor1Id, workspaceId],
    );

    const seedPre0036Order = async ({
      quoteCode,
      orderCode,
      customerId,
      customerName,
      vendorId = vendor1Id,
      vendorName = 'Nhà In Gia Công Hoàng Gia',
      productionStatus = 'PRINTING',
      paymentStatus = 'PARTIALLY_PAID',
      totalQuoteAmount,
      expectedVendorCost,
      enteredVendorCost = null,
      depositPaid,
      totalPaidAmount,
      remainingDebtAmount,
      vendorPaidAmount = 0,
    }) => {
      const quoteId = crypto.randomUUID();
      const qVerId = crypto.randomUUID();
      const orderId = crypto.randomUUID();
      const profit = totalQuoteAmount - expectedVendorCost;

      const calc = calculatePrintQuote({
        quoteId: quoteCode,
        customerName,
        shippingFee: 0,
        extraCost: 0,
        items: [
          {
            id: 'L1',
            name: `Ấn phẩm ${orderCode}`,
            unit: 'lô',
            quantity: 1,
            vendorCostMode: VendorCostMode.TOTAL_BATCH,
            baseCostRate: expectedVendorCost,
            profit: {
              mode: ProfitMode.FIXED_AMOUNT,
              scope: ProfitScope.TOTAL_BATCH,
              value: profit,
            },
          },
        ],
      });
      const snap = createQuoteOrderSnapshot(calc, {
        orderId: `SNAP-${orderCode}`,
        status: 'CONVERTED',
      });

      await drillPool.query(
        `INSERT INTO print_quotes (
           id, workspace_id, quote_code, title, customer_id, customer_name, status, current_version,
           total_quantity, total_vendor_cost, total_profit, shipping_fee, total_extra_cost,
           total_quote_amount, total_rounding_adjustment, lines_json, snapshot_json, customer_pdf_json, integrity_hash, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, 'CONVERTED', 1, 1, $7, $8, 0, 0, $9, 0, $10::jsonb, $11::jsonb, '{}'::jsonb, $12, $13)`,
        [
          quoteId,
          workspaceId,
          quoteCode,
          `Báo giá ${orderCode}`,
          customerId,
          customerName,
          expectedVendorCost,
          profit,
          totalQuoteAmount,
          JSON.stringify(snap.lines),
          JSON.stringify(snap),
          snap.integrityHash,
          ownerId,
        ],
      );
      await drillPool.query(
        `INSERT INTO print_quote_versions (
           id, workspace_id, quote_id, version_number, status, total_quantity,
           total_vendor_cost, total_profit, shipping_fee, total_extra_cost,
           total_quote_amount, total_rounding_adjustment, snapshot_json, customer_pdf_json, integrity_hash, created_by
         ) VALUES ($1, $2, $3, 1, 'CONVERTED', 1, $4, $5, 0, 0, $6, 0, $7::jsonb, '{}'::jsonb, $8, $9)`,
        [
          qVerId,
          workspaceId,
          quoteId,
          expectedVendorCost,
          profit,
          totalQuoteAmount,
          JSON.stringify(snap),
          snap.integrityHash,
          ownerId,
        ],
      );
      await drillPool.query(
        `INSERT INTO print_orders (
           id, workspace_id, order_code, quote_id, quote_code, quote_version,
           customer_id, customer_name, vendor_id, vendor_name, title,
           production_status, payment_status,
           total_quote_amount, expected_vendor_cost, actual_vendor_cost, entered_vendor_cost,
           expected_shipping_fee, actual_shipping_fee, expected_extra_cost, actual_extra_cost,
           expected_profit, actual_profit,
           deposit_paid, total_paid_amount, remaining_debt_amount, vendor_paid_amount,
           snapshot_json, integrity_hash, created_by
         ) VALUES (
           $1, $2, $3, $4, $5, 1,
           $6, $7, $8, $9, $10,
           $11, $12,
           $13, $14, 0, $15,
           0, 0, 0, 0,
           $16, 0,
           $17, $18, $19, $20,
           $21::jsonb, $22, $23
         )`,
        [
          orderId,
          workspaceId,
          orderCode,
          quoteId,
          quoteCode,
          customerId,
          customerName,
          vendorId,
          vendorName,
          `Đơn lịch sử ${orderCode}`,
          productionStatus,
          paymentStatus,
          totalQuoteAmount,
          expectedVendorCost,
          enteredVendorCost,
          profit,
          depositPaid,
          totalPaidAmount,
          remainingDebtAmount,
          vendorPaidAmount,
          JSON.stringify(snap),
          snap.integrityHash,
          ownerId,
        ],
      );
      return orderId;
    };

    // 1) DH-STG-001: Valid receipts (4M deposit + 3M installment = 7M on 10M quote, debt 3M, vendor advance 2M)
    const ord1Id = await seedPre0036Order({
      quoteCode: 'BG-STG-001',
      orderCode: 'DH-STG-001',
      customerId: cust1Id,
      customerName: 'Công ty TNHH Minh Phát',
      totalQuoteAmount: 10_000_000,
      expectedVendorCost: 6_500_000,
      depositPaid: 4_000_000,
      totalPaidAmount: 7_000_000,
      remainingDebtAmount: 3_000_000,
      vendorPaidAmount: 2_000_000,
    });
    const pay1aId = crypto.randomUUID();
    const pay1bId = crypto.randomUUID();

    // 2) DH-STG-002: Valid receipt (5M) + valid refund (1.5M) => net 3.5M on 8M quote, debt 4.5M
    const ord2Id = await seedPre0036Order({
      quoteCode: 'BG-STG-002',
      orderCode: 'DH-STG-002',
      customerId: cust1Id,
      customerName: 'Công ty TNHH Minh Phát',
      totalQuoteAmount: 8_000_000,
      expectedVendorCost: 5_200_000,
      depositPaid: 5_000_000,
      totalPaidAmount: 3_500_000,
      remainingDebtAmount: 4_500_000,
    });
    const pay2RecId = crypto.randomUUID();
    const pay2RefId = crypto.randomUUID();

    // 2B) DH-STG-002B: Anomalous refund exceeding receipt (receipt 2M, refund 2.5M)
    const ord2bId = await seedPre0036Order({
      quoteCode: 'BG-STG-002B',
      orderCode: 'DH-STG-002B',
      customerId: cust2Id,
      customerName: 'Xưởng Quảng Cáo Đại Việt',
      totalQuoteAmount: 5_000_000,
      expectedVendorCost: 3_500_000,
      depositPaid: 2_000_000,
      totalPaidAmount: 0,
      remainingDebtAmount: 5_000_000,
      paymentStatus: 'UNPAID',
    });
    const pay2bRecId = crypto.randomUUID();
    const pay2bBadRefId = crypto.randomUUID();

    // 3) DH-STG-003: Legacy order missing customer_id (even though print_customers has exact same name!)
    const ord3NoCustId = await seedPre0036Order({
      quoteCode: 'BG-STG-003',
      orderCode: 'DH-STG-003',
      customerId: null,
      customerName: 'Công ty Ánh Dương Trùng Tên',
      totalQuoteAmount: 6_000_000,
      expectedVendorCost: 4_000_000,
      depositPaid: 2_500_000,
      totalPaidAmount: 2_500_000,
      remainingDebtAmount: 3_500_000,
    });
    const pay3NoCustId = crypto.randomUUID();

    // 4) DH-STG-004: Balance mismatch (header paid 5.5M / debt 7M on 12M quote vs 4M payment row)
    const ord4MismatchId = await seedPre0036Order({
      quoteCode: 'BG-STG-004',
      orderCode: 'DH-STG-004',
      customerId: cust2Id,
      customerName: 'Xưởng Quảng Cáo Đại Việt',
      totalQuoteAmount: 12_000_000,
      expectedVendorCost: 8_400_000,
      depositPaid: 4_000_000,
      totalPaidAmount: 5_500_000,
      remainingDebtAmount: 7_000_000,
    });
    const pay4MismatchId = crypto.randomUUID();

    // 4B) DH-STG-004B: Orphan paid order (header paid 1.8M with 0 rows in print_order_payments)
    const ord4bOrphanId = await seedPre0036Order({
      quoteCode: 'BG-STG-004B',
      orderCode: 'DH-STG-004B',
      customerId: cust2Id,
      customerName: 'Xưởng Quảng Cáo Đại Việt',
      totalQuoteAmount: 4_000_000,
      expectedVendorCost: 2_800_000,
      depositPaid: 1_800_000,
      totalPaidAmount: 1_800_000,
      remainingDebtAmount: 2_200_000,
    });

    // 5) DH-STG-005: Cancelled order WITH financial obligations (3M customer deposit + 1.2M entered vendor cost + 1M vendor paid)
    const ord5CancelledWithFundsId = await seedPre0036Order({
      quoteCode: 'BG-STG-005',
      orderCode: 'DH-STG-005',
      customerId: cust1Id,
      customerName: 'Công ty TNHH Minh Phát',
      productionStatus: 'CANCELLED',
      paymentStatus: 'DEPOSIT_PAID',
      totalQuoteAmount: 9_000_000,
      expectedVendorCost: 6_000_000,
      enteredVendorCost: 1_200_000,
      depositPaid: 3_000_000,
      totalPaidAmount: 3_000_000,
      remainingDebtAmount: 0,
      vendorPaidAmount: 1_000_000,
    });
    const pay5CancelledDepId = crypto.randomUUID();

    // 6) DH-STG-006: Clean cancelled order with 0 VND obligations
    const ord6CancelledZeroId = await seedPre0036Order({
      quoteCode: 'BG-STG-006',
      orderCode: 'DH-STG-006',
      customerId: cust1Id,
      customerName: 'Công ty TNHH Minh Phát',
      productionStatus: 'CANCELLED',
      paymentStatus: 'UNPAID',
      totalQuoteAmount: 3_000_000,
      expectedVendorCost: 2_000_000,
      depositPaid: 0,
      totalPaidAmount: 0,
      remainingDebtAmount: 0,
      vendorPaidAmount: 0,
    });

    await drillPool.query(
      `INSERT INTO print_order_payments (
         id, workspace_id, order_id, payment_type, amount, payment_method, reference_code, note, recorded_by, created_at
       ) VALUES
         ($1, $10, $11, 'DEPOSIT', 4000000, 'BANK_TRANSFER', 'LEG-STG-001A', 'Cọc đợt 1 Minh Phát', $17, now() - interval '10 days'),
         ($2, $10, $11, 'INSTALLMENT', 3000000, 'BANK_TRANSFER', 'LEG-STG-001B', 'Thu đợt 2 Minh Phát', $17, now() - interval '8 days'),
         ($3, $10, $12, 'DEPOSIT', 5000000, 'BANK_TRANSFER', 'LEG-STG-002A', 'Thu cọc 5tr', $17, now() - interval '7 days'),
         ($4, $10, $12, 'REFUND', 1500000, 'BANK_TRANSFER', 'LEG-STG-002B', 'Hoàn bớt 1.5tr do giảm số lượng', $17, now() - interval '6 days'),
         ($5, $10, $13, 'DEPOSIT', 2000000, 'CASH', 'LEG-STG-002BA', 'Thu cọc 2tr', $17, now() - interval '5 days'),
         ($6, $10, $13, 'REFUND', 2500000, 'CASH', 'LEG-STG-002BB', 'Phiếu hoàn nhập sai vượt thu', $17, now() - interval '4 days'),
         ($7, $10, $14, 'DEPOSIT', 2500000, 'QR_VIETQR', 'LEG-STG-003', 'Cọc đơn chưa gắn customer_id', $17, now() - interval '3 days'),
         ($8, $10, $15, 'DEPOSIT', 4000000, 'BANK_TRANSFER', 'LEG-STG-004', 'Phiếu 4tr nhưng đơn ghi 5.5tr', $17, now() - interval '2 days'),
         ($9, $10, $16, 'DEPOSIT', 3000000, 'BANK_TRANSFER', 'LEG-STG-005', 'Cọc 3tr trên đơn sau đó bị hủy', $17, now() - interval '1 day')`,
      [
        pay1aId,
        pay1bId,
        pay2RecId,
        pay2RefId,
        pay2bRecId,
        pay2bBadRefId,
        pay3NoCustId,
        pay4MismatchId,
        pay5CancelledDepId,
        workspaceId,
        ord1Id,
        ord2Id,
        ord2bId,
        ord3NoCustId,
        ord4MismatchId,
        ord5CancelledWithFundsId,
        ownerId,
      ],
    );

    const captureBaselineDigest = async (pool) => {
      const ordSnap = await pool.query(
        `SELECT order_code, customer_id, production_status,
                total_quote_amount::bigint AS quote_amt,
                deposit_paid::bigint AS dep_paid,
                total_paid_amount::bigint AS paid_amt,
                remaining_debt_amount::bigint AS rem_amt,
                vendor_paid_amount::bigint AS vnd_paid
         FROM print_orders
         WHERE workspace_id = $1
         ORDER BY order_code ASC`,
        [workspaceId],
      );
      const paySnap = await pool.query(
        `SELECT reference_code, payment_type, amount::bigint AS amt
         FROM print_order_payments
         WHERE workspace_id = $1
         ORDER BY reference_code ASC`,
        [workspaceId],
      );
      const finSnap = await pool.query(
        `SELECT direction, amount_vnd::bigint AS amt
         FROM fin_entries
         WHERE workspace_id = $1
         ORDER BY direction ASC`,
        [workspaceId],
      );
      const migSnap = await pool.query(
        `SELECT count(*)::int AS cnt, max(id) AS max_id FROM schema_migrations`,
      );
      return {
        orders: ordSnap.rows,
        payments: paySnap.rows,
        finEntries: finSnap.rows,
        migrationCount: migSnap.rows[0].cnt,
        maxMigrationId: migSnap.rows[0].max_id,
      };
    };

    const pre0036Baseline = await captureBaselineDigest(drillPool);
    assert.equal(pre0036Baseline.migrationCount, 35);
    assert.equal(
      pre0036Baseline.maxMigrationId,
      '0035_printquote_financial_control_gate',
    );
    assert.equal(pre0036Baseline.orders.length, 8);
    assert.equal(pre0036Baseline.payments.length, 9);

    // Take pre-0036 pg_dump backup for full maintenance restore drill
    const pgDumpBin = resolvePgBinary('pg_dump');
    const pgRestoreBin = resolvePgBinary('pg_restore');
    const dumpFilePath = path.join(tmpDir, 'pre0036-staging-backup.dump');
    if (pgDumpBin && pgRestoreBin) {
      const dumpRun = spawnSync(
        pgDumpBin,
        [
          '-h',
          host,
          '-p',
          String(port),
          '-U',
          adminUser,
          '-d',
          drillDbName,
          '-Fc',
          '--file',
          dumpFilePath,
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, PGPASSWORD: adminPw },
          timeout: 30_000,
        },
      );
      assert.equal(
        dumpRun.status,
        0,
        `pg_dump pre-0036 failed: ${dumpRun.stderr}`,
      );
    }

    // =========================================================================
    // STEP 2: Run Migration 0036 -> Verify Pre/Post Reconciliation & Clean Rollback
    // =========================================================================
    const mig0036Res = await runMigrations(drillPool, allMigs);
    assert.equal(mig0036Res.appliedCount, 1);
    assert.deepEqual(mig0036Res.appliedIds, ['0036_printquote_ar_ap_ledger']);

    // 2a. Verify ZERO auto-posted rows in Official AR or AP
    const officialCounts = await drillPool.query(
      `SELECT
         (SELECT count(*)::int FROM print_ar_transactions WHERE workspace_id = $1) AS ar_tx,
         (SELECT count(*)::int FROM print_ar_allocations WHERE workspace_id = $1) AS ar_alloc,
         (SELECT count(*)::int FROM print_ap_transactions WHERE workspace_id = $1) AS ap_tx,
         (SELECT count(*)::int FROM print_ap_allocations WHERE workspace_id = $1) AS ap_alloc,
         (SELECT count(*)::int FROM print_legacy_ar_reconciliations WHERE workspace_id = $1 AND status = 'PENDING') AS pending_queue,
         (SELECT count(*)::int FROM print_legacy_ar_reconciliation_history WHERE workspace_id = $1 AND action = 'QUEUED_BY_MIGRATION') AS queue_hist`,
      [workspaceId],
    );
    assert.deepEqual(officialCounts.rows[0], {
      ar_tx: 0,
      ar_alloc: 0,
      ap_tx: 0,
      ap_alloc: 0,
      pending_queue: 9,
      queue_hist: 9,
    });

    // 2b. Verify cancelled orders post-0036 state
    const cancelledOrdersPostMig = await drillPool.query(
      `SELECT order_code, valid_receivable_amount::bigint AS valid_rec,
              cancellation_settlement_status, legacy_vendor_paid_reconciled,
              legacy_ar_reconciliation_status
       FROM print_orders
       WHERE id IN ($1, $2)
       ORDER BY order_code ASC`,
      [ord5CancelledWithFundsId, ord6CancelledZeroId],
    );
    assert.deepEqual(cancelledOrdersPostMig.rows, [
      {
        order_code: 'DH-STG-005',
        valid_rec: '0',
        cancellation_settlement_status: 'PENDING_SETTLEMENT',
        legacy_vendor_paid_reconciled: false,
        legacy_ar_reconciliation_status: 'PENDING',
      },
      {
        order_code: 'DH-STG-006',
        valid_rec: '0',
        cancellation_settlement_status: 'SETTLED',
        legacy_vendor_paid_reconciled: true,
        legacy_ar_reconciliation_status: 'NOT_REQUIRED',
      },
    ]);

    // 2c. Exercise clean pre-confirmation rollback (rollback-0036-printquote-ar-ap-ledger.sql)
    //     when ONLY untouched PENDING (QUEUED_BY_MIGRATION) rows exist -> 100% lossless!
    const rollbackSqlPath = path.join(
      REPO_ROOT,
      'scripts/db/rollback-0036-printquote-ar-ap-ledger.sql',
    );
    const rollbackSql = fs.readFileSync(rollbackSqlPath, 'utf8');
    await drillPool.query(rollbackSql);

    const afterCleanRollback = await captureBaselineDigest(drillPool);
    assert.deepEqual(
      afterCleanRollback,
      pre0036Baseline,
      'Clean rollback before any post-0036 confirmation must restore exact pre-0036 state & 35 migrations',
    );

    // 2d. Re-apply 0036 via migrator + test idempotent re-execution of 0036 SQL
    const reapplyRes = await runMigrations(drillPool, allMigs);
    assert.equal(reapplyRes.appliedCount, 1);
    const raw0036Sql = fs.readFileSync(
      path.join(
        REPO_ROOT,
        'packages/database/src/migrations/0036_printquote_ar_ap_ledger.sql',
      ),
      'utf8',
    );
    await drillPool.query(raw0036Sql);

    const queueAfterReapply = await drillPool.query(
      `SELECT count(*)::int AS cnt FROM print_legacy_ar_reconciliations WHERE workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(queueAfterReapply.rows[0].cnt, 9);

    // =========================================================================
    // STEP 3: Boot Isolated Staging API & Rehearse Queue, Anti-Double-Count & Cancelled Order
    // =========================================================================
    const handler = createRequestHandler({
      pool: drillPool,
      csrfSecret: CSRF_SECRET,
      allowedOrigins: [ALLOWED_ORIGIN],
      sessionCookieName: 'ml_staging_session',
      isProduction: false,
    });
    stagingServer = http.createServer(handler);
    await new Promise((resolve) =>
      stagingServer.listen(0, '127.0.0.1', resolve),
    );
    const baseUrl = `http://127.0.0.1:${stagingServer.address().port}`;

    // 3a. Inspect pre-confirmation reconciliation overview
    const ovInitRes = await apiRequest(
      baseUrl,
      'GET',
      '/api/v1/print-quotes/receivables/legacy-reconciliation',
      { cookie: ownerCookie, csrfToken: ownerCsrf },
    );
    assert.equal(ovInitRes.status, 200);
    const ovInit = ovInitRes.body.data;
    assert.equal(ovInit.summary.legacy_payments_total_count, 9);
    assert.equal(ovInit.summary.legacy_payments_gross_receipts, 23_500_000);
    assert.equal(ovInit.summary.legacy_payments_gross_refunds, 4_000_000);
    assert.equal(ovInit.summary.legacy_payments_net_amount, 19_500_000);
    assert.equal(ovInit.summary.confirmed_to_ar_count, 0);
    assert.equal(ovInit.summary.confirmed_to_ar_net_amount, 0);
    assert.equal(ovInit.summary.pending_count, 9);
    assert.equal(ovInit.summary.orders_missing_customer_count, 1);
    assert.ok(
      ovInit.order_gaps.some(
        (g) =>
          g.order_id === ord4bOrphanId &&
          g.anomaly_codes.includes('ORPHAN_PAID_WITHOUT_PAYMENT_ROWS'),
      ),
    );

    const itemByPayId = new Map(
      ovInit.items.map((it) => [it.legacy_payment_id, it]),
    );
    assert.ok(
      itemByPayId
        .get(pay5CancelledDepId)
        .warning_codes.includes('CANCELLED_ORDER_UNSETTLED'),
      'Cancelled order deposit must carry CANCELLED_ORDER_UNSETTLED warning',
    );

    // 3b. Verify fail-closed blocks on invalid/premature actions
    // - Settling cancelled DH-STG-005 BEFORE confirming its 3M legacy deposit -> 409 LEGACY_AR_RECONCILIATION_REQUIRED
    const prematureCancelSettle = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/orders/${ord5CancelledWithFundsId}/cancel-settlement`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        idempotencyKey: 'stg-premature-cancel-settle',
        body: {
          agreed_customer_refund_amount: 2_000_000,
          retained_cancellation_fee: 1_000_000,
          reason: 'Thử quyết toán hủy trước khi đối chiếu phiếu cọc cũ',
        },
      },
    );
    assert.equal(prematureCancelSettle.status, 409);
    assert.equal(
      prematureCancelSettle.body.error.code,
      'LEGACY_AR_RECONCILIATION_REQUIRED',
    );

    // - Confirming refund on DH-STG-002 before receipt -> 409 REFUND_REQUIRES_CONFIRMED_RECEIPT
    const prematureRefund = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/receivables/legacy-payments/${pay2RefId}/confirm`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: { note: 'Thử xác nhận hoàn tiền trước phiếu thu' },
      },
    );
    assert.equal(prematureRefund.status, 409);
    assert.equal(
      prematureRefund.body.error.code,
      'REFUND_REQUIRES_CONFIRMED_RECEIPT',
    );

    // - Confirming missing-customer DH-STG-003 -> 409 MISSING_CUSTOMER_ID_FOR_RECONCILIATION
    const blockedNoCust = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/receivables/legacy-payments/${pay3NoCustId}/confirm`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: { note: 'Thử xác nhận đơn thiếu mã khách' },
      },
    );
    assert.equal(blockedNoCust.status, 409);
    assert.equal(
      blockedNoCust.body.error.code,
      'MISSING_CUSTOMER_ID_FOR_RECONCILIATION',
    );

    // - Confirming mismatched balance DH-STG-004 -> 409 LEGACY_ANOMALY_BLOCKS_CONFIRMATION
    const blockedMismatch = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/receivables/legacy-payments/${pay4MismatchId}/confirm`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: { note: 'Thử xác nhận đơn lệch số dư' },
      },
    );
    assert.equal(blockedMismatch.status, 409);
    assert.equal(
      blockedMismatch.body.error.code,
      'LEGACY_ANOMALY_BLOCKS_CONFIRMATION',
    );

    // - Confirming bad refund exceeding receipts DH-STG-002B -> 409 LEGACY_ANOMALY_BLOCKS_CONFIRMATION
    const blockedBadRefund = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/receivables/legacy-payments/${pay2bBadRefId}/confirm`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: { note: 'Thử xác nhận hoàn vượt thu' },
      },
    );
    assert.equal(blockedBadRefund.status, 409);

    // 3c. Confirm DH-STG-001 (4M + 3M) & verify ZERO double-counting mid-transition and post-confirmation
    const c1a = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/receivables/legacy-payments/${pay1aId}/confirm`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        idempotencyKey: 'stg-c1a',
        body: { note: 'Đối chiếu sao kê đợt 1: 4tr' },
      },
    );
    assert.equal(c1a.status, 200);
    assert.equal(
      c1a.body.data.after_snapshot.official_ar_allocated_after,
      4_000_000,
    );
    assert.equal(
      c1a.body.data.after_snapshot.legacy_pending_net_after,
      3_000_000,
    );
    assert.equal(
      c1a.body.data.after_snapshot.effective_order_paid_after,
      7_000_000,
    );
    assert.equal(c1a.body.data.after_snapshot.order_remaining_after, 3_000_000);

    const c1b = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/receivables/legacy-payments/${pay1bId}/confirm`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        idempotencyKey: 'stg-c1b',
        body: { note: 'Đối chiếu sao kê đợt 2: 3tr' },
      },
    );
    assert.equal(c1b.status, 200);
    assert.equal(
      c1b.body.data.after_snapshot.official_ar_allocated_after,
      7_000_000,
    );
    assert.equal(c1b.body.data.after_snapshot.legacy_pending_net_after, 0);
    assert.equal(
      c1b.body.data.after_snapshot.effective_order_paid_after,
      7_000_000,
    );
    assert.equal(c1b.body.data.after_snapshot.order_remaining_after, 3_000_000);

    // 3d. Confirm DH-STG-002 (5M receipt -> 1.5M refund) & verify net 3.5M / debt 4.5M without double-counting
    const c2Rec = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/receivables/legacy-payments/${pay2RecId}/confirm`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        idempotencyKey: 'stg-c2rec',
        body: { note: 'Đối chiếu thu 5tr' },
      },
    );
    assert.equal(c2Rec.status, 200);
    assert.equal(
      c2Rec.body.data.after_snapshot.effective_order_paid_after,
      3_500_000,
    );
    assert.equal(
      c2Rec.body.data.after_snapshot.order_remaining_after,
      4_500_000,
    );

    const c2Ref = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/receivables/legacy-payments/${pay2RefId}/confirm`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        idempotencyKey: 'stg-c2ref',
        body: { note: 'Đối chiếu hoàn 1.5tr' },
      },
    );
    assert.equal(c2Ref.status, 200);
    assert.equal(
      c2Ref.body.data.after_snapshot.official_ar_allocated_after,
      3_500_000,
    );
    assert.equal(c2Ref.body.data.after_snapshot.legacy_pending_net_after, 0);
    assert.equal(
      c2Ref.body.data.after_snapshot.effective_order_paid_after,
      3_500_000,
    );
    assert.equal(
      c2Ref.body.data.after_snapshot.order_remaining_after,
      4_500_000,
    );

    // 3e. Link customer to DH-STG-003 -> confirm 2.5M
    const link3 = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/orders/${ord3NoCustId}/link-customer`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          customer_id: custSameNameId,
          reason: 'Xác nhận gắn hồ sơ Công ty Ánh Dương (KH-STG-003)',
        },
      },
    );
    assert.equal(link3.status, 200);
    const c3 = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/receivables/legacy-payments/${pay3NoCustId}/confirm`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        idempotencyKey: 'stg-c3',
        body: { note: 'Đối chiếu cọc 2.5tr sau khi gắn mã khách' },
      },
    );
    assert.equal(c3.status, 200);
    assert.equal(
      c3.body.data.after_snapshot.effective_order_paid_after,
      2_500_000,
    );
    assert.equal(c3.body.data.after_snapshot.order_remaining_after, 3_500_000);

    // 3f. Resolve balance discrepancy on DH-STG-004 (5.5M -> 4.0M, debt 8.0M) -> confirm 4.0M
    const fixBal4 = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/orders/${ord4MismatchId}/reconcile-legacy-balance`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          reason:
            'Kiểm tra sao kê thực thu đúng 4.000.000đ theo phiếu LEG-STG-004',
        },
      },
    );
    assert.equal(fixBal4.status, 200);
    assert.equal(fixBal4.body.data.aligned_total_paid_amount, 4_000_000);
    assert.equal(fixBal4.body.data.aligned_remaining_debt_amount, 8_000_000);

    const c4 = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/receivables/legacy-payments/${pay4MismatchId}/confirm`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        idempotencyKey: 'stg-c4',
        body: { note: 'Xác nhận 4tr sau chuẩn hóa số dư' },
      },
    );
    assert.equal(c4.status, 200);
    assert.equal(
      c4.body.data.after_snapshot.effective_order_paid_after,
      4_000_000,
    );
    assert.equal(c4.body.data.after_snapshot.order_remaining_after, 8_000_000);

    // Put anomalous DH-STG-002B rows on explicit ON_HOLD
    for (const pid of [pay2bRecId, pay2bBadRefId]) {
      const hRes = await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/receivables/legacy-payments/${pid}/hold`,
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          body: {
            reason: 'Tạm giữ kiểm tra chứng từ hoàn vượt thu trên DH-STG-002B',
          },
        },
      );
      assert.equal(hRes.status, 200);
    }

    // 3g. Confirm 3M deposit on CANCELLED order DH-STG-005 -> then settle cancellation (refund 2M, retain 1M fee)
    const c5 = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/receivables/legacy-payments/${pay5CancelledDepId}/confirm`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        idempotencyKey: 'stg-c5',
        body: {
          note: 'Xác nhận khoản cọc 3tr khách đã chuyển trước khi hủy đơn',
        },
      },
    );
    assert.equal(c5.status, 200);
    assert.equal(
      c5.body.data.after_snapshot.official_ar_allocated_after,
      3_000_000,
    );

    const settle5 = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/orders/${ord5CancelledWithFundsId}/cancel-settlement`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        idempotencyKey: 'stg-settle5',
        body: {
          agreed_customer_refund_amount: 2_000_000,
          retained_cancellation_fee: 1_000_000,
          reference_code: 'BB-HUY-STG-005',
          reason: 'Thỏa thuận giữ 1tr phí bình bài/in thử, hoàn lại khách 2tr',
        },
      },
    );
    assert.equal(settle5.status, 201);
    assert.equal(settle5.body.data.customer_paid_holding_snapshot, 3_000_000);
    assert.equal(settle5.body.data.agreed_customer_refund_amount, 2_000_000);
    assert.equal(settle5.body.data.retained_cancellation_fee, 1_000_000);

    const ord5AfterSettle = await drillPool.query(
      `SELECT valid_receivable_amount::bigint AS valid_rec,
              cancellation_settlement_status,
              agreed_customer_refund_amount::bigint AS agreed_ref,
              retained_cancellation_fee::bigint AS retained_fee,
              legacy_ar_reconciliation_status
       FROM print_orders WHERE id = $1`,
      [ord5CancelledWithFundsId],
    );
    assert.deepEqual(ord5AfterSettle.rows[0], {
      valid_rec: '1000000',
      cancellation_settlement_status: 'SETTLED',
      agreed_ref: '2000000',
      retained_fee: '1000000',
      legacy_ar_reconciliation_status: 'RECONCILED',
    });

    // Final reconciliation summary check:
    // 7 confirmed rows (4M + 3M + 5M - 1.5M + 2.5M + 4M + 3M = 20,000,000 net), 0 pending, 2 ON_HOLD (-500,000 net)
    const ovFinalRes = await apiRequest(
      baseUrl,
      'GET',
      '/api/v1/print-quotes/receivables/legacy-reconciliation',
      { cookie: ownerCookie, csrfToken: ownerCsrf },
    );
    assert.equal(ovFinalRes.status, 200);
    const ovFinal = ovFinalRes.body.data.summary;
    assert.equal(ovFinal.confirmed_to_ar_count, 7);
    assert.equal(ovFinal.confirmed_to_ar_receipts, 21_500_000);
    assert.equal(ovFinal.confirmed_to_ar_refunds, 1_500_000);
    assert.equal(ovFinal.confirmed_to_ar_net_amount, 20_000_000);
    assert.equal(ovFinal.pending_count, 0);
    assert.equal(ovFinal.on_hold_count, 2);

    // =========================================================================
    // STEP 4: 3-Layer Fail-Closed Rollback Verification & Backup Restore Drill
    // =========================================================================
    // Layer 1: SQL rollback script MUST block fail-closed (ROLLBACK_BLOCKED) once post-0036 state exists
    await assert.rejects(
      () => drillPool.query(rollbackSql),
      /ROLLBACK_BLOCKED/,
      'rollback-0036-printquote-ar-ap-ledger.sql must abort fail-closed after confirmations/settlements',
    );
    const txCountStill7 = await drillPool.query(
      `SELECT count(*)::int AS cnt FROM print_ar_transactions WHERE workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(
      txCountStill7.rows[0].cnt,
      7,
      'Failed rollback transaction must leave all 7 confirmed AR transactions completely intact',
    );

    // Layer 2: Database append-only & status-downgrade triggers MUST block destructive mutations
    await assert.rejects(
      () =>
        drillPool.query(
          `DELETE FROM print_ar_transactions WHERE workspace_id = $1`,
          [workspaceId],
        ),
      /cannot be deleted/,
    );
    await assert.rejects(
      () =>
        drillPool.query(
          `UPDATE print_legacy_ar_reconciliations SET status = 'PENDING', posted_ar_transaction_id = NULL WHERE legacy_payment_id = $1`,
          [pay1aId],
        ),
      /Confirmed legacy AR reconciliation cannot be reverted/,
    );

    // Layer 3: Release Controller Schema Compatibility Gate (Rollback-Release.ps1 -Simulation)
    // Proves code-only rollback from 0036 (36 migrations) to pre-0036 (35 migrations) is blocked fail-closed!
    const psExe =
      process.platform === 'win32'
        ? 'powershell.exe'
        : spawnSync('pwsh', ['-v']).status === 0
          ? 'pwsh'
          : null;
    if (psExe) {
      const simRoot = path.join(tmpDir, 'controller-rb-sim');
      const prevSha = '0f78bee341b1997ae69fd5aaba6aec104fc851b8';
      const relDir = path.join(simRoot, 'releases', prevSha);
      fs.mkdirSync(path.join(relDir, 'dist'), { recursive: true });
      fs.mkdirSync(path.join(simRoot, 'backups'), { recursive: true });
      fs.writeFileSync(
        path.join(simRoot, '.management-lite-managed-root'),
        'isolated-sim\n',
      );
      fs.writeFileSync(path.join(simRoot, 'simulation-current.txt'), relDir);

      const dummyFile = path.join(relDir, 'dist', 'app.js');
      const dummyBytes = Buffer.from('// pre-0036 v0.8.4 runtime\n', 'utf8');
      fs.writeFileSync(dummyFile, dummyBytes);
      const dummySha = crypto
        .createHash('sha256')
        .update(dummyBytes)
        .digest('hex');

      const schemaPre0036 = crypto
        .createHash('sha256')
        .update(
          JSON.stringify(
            pre0036Migs.map((m) => ({ id: m.id, checksum: m.checksum })),
          ),
        )
        .digest('hex');
      const schemaPost0036 = crypto
        .createHash('sha256')
        .update(
          JSON.stringify(
            allMigs.map((m) => ({ id: m.id, checksum: m.checksum })),
          ),
        )
        .digest('hex');

      fs.writeFileSync(
        path.join(relDir, 'release.json'),
        JSON.stringify(
          {
            sha: prevSha,
            platform: 'win32',
            arch: 'x64',
            node: '22.14.0',
            schemaIdentity: schemaPre0036,
            authPolicyVersion: 'auth-remember-01',
            files: [
              {
                path: 'dist/app.js',
                size: dummyBytes.length,
                sha256: dummySha,
              },
            ],
          },
          null,
          2,
        ),
      );
      const simCfgPath = path.join(tmpDir, 'deploy-sim-config.json');
      fs.writeFileSync(
        simCfgPath,
        JSON.stringify(
          {
            Enabled: true,
            Environment: 'staging',
            AllowSimulation: true,
            Root: simRoot,
            SimulationSchema: schemaPost0036,
            SimulationAuthPolicy: 'auth-remember-01',
          },
          null,
          2,
        ),
      );

      const rbSim = spawnSync(
        psExe,
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(REPO_ROOT, 'scripts/deployment/Rollback-Release.ps1'),
          '-ConfigPath',
          simCfgPath,
          '-Sha',
          prevSha,
          '-Simulation',
        ],
        { encoding: 'utf8', timeout: 15_000 },
      );
      assert.notEqual(
        rbSim.status,
        0,
        'Code-only rollback to pre-0036 release must fail closed when DB is at 0036 schemaIdentity',
      );
      assert.match(
        `${rbSim.stdout}\n${rbSim.stderr}`,
        /Schema mismatch; migration is manual only/,
      );
    }

    // Full Maintenance Restore Drill: restore pre-0036 dump into isolated restoreDbName
    if (pgDumpBin && pgRestoreBin && fs.existsSync(dumpFilePath)) {
      const restoreRun = spawnSync(
        pgRestoreBin,
        [
          '-h',
          host,
          '-p',
          String(port),
          '-U',
          adminUser,
          '-d',
          restoreDbName,
          '--no-owner',
          '--no-privileges',
          dumpFilePath,
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, PGPASSWORD: adminPw },
          timeout: 30_000,
        },
      );
      assert.equal(
        restoreRun.status,
        0,
        `pg_restore pre-0036 failed: ${restoreRun.stderr}`,
      );

      restorePool = createDatabasePool({
        host,
        port,
        user: adminUser,
        password: adminPw,
        database: restoreDbName,
        max: 2,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 5_000,
      });
      const restoredDigest = await captureBaselineDigest(restorePool);
      assert.deepEqual(
        restoredDigest,
        pre0036Baseline,
        'Restored pre-0036 backup must match pre-0036 baseline 100%',
      );
    }

    // Verify /finance sentinel remained 100% untouched throughout migration, confirmations, and settlements
    const finAfter = await drillPool.query(
      `SELECT direction, amount_vnd::bigint AS amt
       FROM fin_entries
       WHERE workspace_id = $1
       ORDER BY direction ASC`,
      [workspaceId],
    );
    assert.deepEqual(finAfter.rows, pre0036Baseline.finEntries);

    t.diagnostic(
      `[REHEARSAL-0036-SUMMARY] ${JSON.stringify({
        pre0036: {
          migrations: pre0036Baseline.migrationCount,
          orders: pre0036Baseline.orders.length,
          legacyPayments: pre0036Baseline.payments.length,
          legacyGrossReceipts: 23_500_000,
          legacyGrossRefunds: 4_000_000,
          legacyNet: 19_500_000,
        },
        immediatelyAfter0036: {
          migrations: 36,
          autoPostedArTx: 0,
          autoPostedApTx: 0,
          pendingQueue: 9,
          cancelledPendingSettlement: 'DH-STG-005 (holding=3M, valid_rec=0)',
          cancelledZeroSettled: 'DH-STG-006 (valid_rec=0)',
          cleanRollbackVerified: true,
        },
        afterOwnerReconciliation: {
          confirmedCount: ovFinal.confirmed_to_ar_count,
          confirmedNetVnd: ovFinal.confirmed_to_ar_net_amount,
          pendingCount: ovFinal.pending_count,
          onHoldAnomalousCount: ovFinal.on_hold_count,
          settledCancelledOrder:
            'DH-STG-005 (refund=2M, retainedFee=1M, status=SETTLED)',
          postConfirmRollbackBlocked: true,
          controllerCodeOnlyRollbackBlocked: Boolean(psExe),
          pgDumpRestoreDrillVerified: Boolean(pgDumpBin && pgRestoreBin),
          financeSentinelUntouched: true,
        },
      })}`,
    );
  } finally {
    if (stagingServer) {
      stagingServer.closeAllConnections?.();
      await new Promise((resolve) => stagingServer.close(resolve));
    }
    if (restorePool) await restorePool.end();
    await drillPool.end();
    for (const db of [drillDbName, restoreDbName]) {
      await adminPool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [db],
      );
      await adminPool.query(`DROP DATABASE IF EXISTS "${db}"`);
    }
    await adminPool.end();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (pgState.startedByTest) {
      stopIsolatedWindowsPostgres55433();
    }
  }
});
