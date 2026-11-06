import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTestDatabaseConfig } from '../../dist/packages/database/src/config.js';
import { createDatabasePool } from '../../dist/packages/database/src/pool.js';
import {
  runMigrations,
  loadMigrationFiles,
} from '../../dist/packages/database/src/migrator.js';
import { createRequestHandler } from '../../dist/apps/api/src/app.js';
import { generateCsrfToken } from '../../dist/packages/security/src/csrf.js';
import { hashToken } from '../../dist/packages/security/src/tokens.js';
import {
  calculatePrintQuote,
  createQuoteOrderSnapshot,
  VendorCostMode,
  ProfitMode,
  ProfitScope,
} from '../../dist/packages/contracts/src/printquote.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const CSRF_SECRET = 'test-csrf-secret-pq-codex-qa-0036-32chars!!';
const ALLOWED_ORIGIN = 'http://127.0.0.1:3000';

async function apiRequest(
  baseUrl,
  method,
  urlPath,
  { cookie, csrfToken, idempotencyKey, body } = {},
) {
  const headers = {
    Origin: ALLOWED_ORIGIN,
  };
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

async function seedWorkspaceActors(pool, label) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const workspaceId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const adminId = crypto.randomUUID();

  await pool.query(
    `INSERT INTO workspaces (id, name, timezone, status)
     VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active')`,
    [workspaceId, `WS ${label} ${suffix}`],
  );

  const mkSession = async (userId, emailPrefix, role, subPerms = []) => {
    const membershipRole = role === 'owner' ? 'owner' : 'staff';
    const empSubRole = role === 'admin' ? 'admin' : 'staff';
    await pool.query(
      `INSERT INTO users (id, username_normalized, email_normalized, status)
       VALUES ($1, $2, $3, 'active')`,
      [
        userId,
        `${emailPrefix}_${suffix}`,
        `${emailPrefix}-${suffix}@mglite.local`,
      ],
    );
    await pool.query(
      `INSERT INTO user_credentials (user_id, password_hash, credential_version)
       VALUES ($1, 'argon2id$stub', 1)`,
      [userId],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [crypto.randomUUID(), workspaceId, userId, membershipRole],
    );
    await pool.query(
      `INSERT INTO user_workspace_bindings (user_id, workspace_id, status, version)
       VALUES ($1, $2, 'active', 1)`,
      [userId, workspaceId],
    );
    await pool.query(
      `INSERT INTO employees (
         id, workspace_id, user_id, employee_code, full_name, employment_status, sub_role, sub_permissions
       ) VALUES ($1, $2, $3, $4, $5, 'active', $6, $7::jsonb)`,
      [
        crypto.randomUUID(),
        workspaceId,
        userId,
        `${role.toUpperCase().slice(0, 3)}-${suffix.slice(0, 4)}`,
        `${role} ${label}`,
        empSubRole,
        JSON.stringify(subPerms),
      ],
    );
    const rawToken = `tok-${role}-${crypto.randomUUID()}`;
    const tokenHash = hashToken(rawToken);
    await pool.query(
      `INSERT INTO auth_sessions (
         id, workspace_id, user_id, session_token_hash,
         credential_version_at_issue, idle_expires_at, absolute_expires_at, remember_me
       ) VALUES ($1, $2, $3, $4, 1, now() + interval '4 hours', now() + interval '24 hours', false)`,
      [crypto.randomUUID(), workspaceId, userId, tokenHash],
    );
    return {
      userId,
      cookie: `mglite_session=${rawToken}`,
      csrf: generateCsrfToken(tokenHash, CSRF_SECRET),
    };
  };

  const owner = await mkSession(ownerId, 'owner', 'owner', []);
  const admin = await mkSession(adminId, 'admin', 'admin', [
    'attendance:review',
    'work:manage',
    'employees:manage',
    'accounts:manage',
    'payroll:manage',
    'finance:manage',
  ]);

  return { workspaceId, owner, admin };
}

async function seedLegacyQuoteAndOrderPre0036(
  pool,
  {
    workspaceId,
    userId,
    quoteCode,
    orderCode,
    customerId = null,
    customerName,
    totalQuoteAmount,
    depositPaid,
    totalPaidAmount,
    remainingDebtAmount,
    paymentStatus = 'DEPOSIT_PAID',
  },
) {
  const quoteId = crypto.randomUUID();
  const qVerId = crypto.randomUUID();
  const orderId = crypto.randomUUID();

  const vendorCost = Math.round(totalQuoteAmount * 0.7);
  const profit = totalQuoteAmount - vendorCost;
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
        baseCostRate: vendorCost,
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

  await pool.query(
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
      vendorCost,
      profit,
      totalQuoteAmount,
      JSON.stringify(snap.lines),
      JSON.stringify(snap),
      snap.integrityHash,
      userId,
    ],
  );
  await pool.query(
    `INSERT INTO print_quote_versions (
       id, workspace_id, quote_id, version_number, status, total_quantity,
       total_vendor_cost, total_profit, shipping_fee, total_extra_cost,
       total_quote_amount, total_rounding_adjustment, snapshot_json, customer_pdf_json, integrity_hash, created_by
     ) VALUES ($1, $2, $3, 1, 'CONVERTED', 1, $4, $5, 0, 0, $6, 0, $7::jsonb, '{}'::jsonb, $8, $9)`,
    [
      qVerId,
      workspaceId,
      quoteId,
      vendorCost,
      profit,
      totalQuoteAmount,
      JSON.stringify(snap),
      snap.integrityHash,
      userId,
    ],
  );
  await pool.query(
    `INSERT INTO print_orders (
       id, workspace_id, order_code, quote_id, quote_code, quote_version, customer_id, customer_name, title,
       total_quote_amount, expected_vendor_cost, actual_vendor_cost,
       expected_shipping_fee, actual_shipping_fee, expected_extra_cost, actual_extra_cost,
       expected_profit, actual_profit, deposit_paid, total_paid_amount, remaining_debt_amount,
       payment_status, vendor_paid_amount, snapshot_json, integrity_hash, created_by
     ) VALUES (
       $1, $2, $3, $4, $5, 1, $6, $7, $8,
       $9, $10, 0,
       0, 0, 0, 0,
       $11, 0, $12, $13, $14,
       $15, 0, $16::jsonb, $17, $18
     )`,
    [
      orderId,
      workspaceId,
      orderCode,
      quoteId,
      quoteCode,
      customerId,
      customerName,
      `Đơn cũ ${orderCode}`,
      totalQuoteAmount,
      vendorCost,
      profit,
      depositPaid,
      totalPaidAmount,
      remainingDebtAmount,
      paymentStatus,
      JSON.stringify(snap),
      snap.integrityHash,
      userId,
    ],
  );

  return { quoteId, orderId, integrityHash: snap.integrityHash };
}

describe('Codex QA Remediation — Migration 0036 Legacy AR Reconciliation Gate & Mandatory customer_id Guard', () => {
  it('1. Migration 0036 trên DB có dữ liệu cũ: KHÔNG tự ghi POSTED AR, giữ nguyên dữ liệu gốc, phát hiện đủ bất thường, chạy lại idempotent & đối chiếu từng dòng (thu hợp lệ, hoàn tiền, thiếu customer_id, lệch số dư, chặn dòng sai)', async () => {
    const baseCfg = loadTestDatabaseConfig();
    const parsedUrl = new URL(baseCfg.connectionString);
    let adminUser = decodeURIComponent(parsedUrl.username || 'postgres');
    let adminPw = decodeURIComponent(parsedUrl.password || '');
    try {
      adminPw = (
        await fs.readFile('C:\\ML-Test\\secrets\\admin.pw', 'utf8')
      ).trim();
      adminUser = 'ml_test_admin';
    } catch {
      // On disposable Linux CI containers, parsedUrl already carries ci_test superuser credentials.
    }
    const tempDbName = `mglite_qa0036_test_${crypto.randomUUID().slice(0, 8)}`;

    const adminPool = createDatabasePool({
      host: parsedUrl.hostname,
      port: Number(parsedUrl.port || 55433),
      user: adminUser,
      password: adminPw,
      database: 'postgres',
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
    await adminPool.query(
      `CREATE DATABASE "${tempDbName}" OWNER "${adminUser}"`,
    );

    const tempPool = createDatabasePool({
      host: parsedUrl.hostname,
      port: Number(parsedUrl.port || 55433),
      user: adminUser,
      password: adminPw,
      database: tempDbName,
      max: 6,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });

    let tempServer = null;
    try {
      const allMigs = await loadMigrationFiles();
      const pre0036 = allMigs.filter((m) => m.id < '0036_');
      const upTo0036 = allMigs.filter((m) => m.id < '0037_');
      await runMigrations(tempPool, pre0036);

      await tempPool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hp_app_runtime') THEN
            CREATE ROLE hp_app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
          END IF;
        END $$;
      `);

      const { workspaceId, owner, admin } = await seedWorkspaceActors(
        tempPool,
        'QA0036-Legacy',
      );

      // Seed active customer C1 + a customer with the EXACT same name as a legacy missing-ID order (must NOT auto-match!)
      const custValidId = crypto.randomUUID();
      const custSameNameId = crypto.randomUUID();
      await tempPool.query(
        `INSERT INTO print_customers (id, workspace_id, code, name, phone, is_active)
         VALUES ($1, $2, 'KH-QA-001', 'Công ty Hợp Lệ C1', '0901000111', true),
                ($3, $2, 'KH-QA-002', 'Khách Trùng Tên Chưa Gắn ID', '0901000222', true)`,
        [custValidId, workspaceId, custSameNameId],
      );

      // Case A: Valid order (1,200,000) with receipt 600,000 + refund 100,000 => net 500,000 == total_paid_amount (500,000), debt == 700,000
      const ordValid = await seedLegacyQuoteAndOrderPre0036(tempPool, {
        workspaceId,
        userId: owner.userId,
        quoteCode: 'BG-QA-VALID',
        orderCode: 'DH-QA-VALID',
        customerId: custValidId,
        customerName: 'Công ty Hợp Lệ C1',
        totalQuoteAmount: 1_200_000,
        depositPaid: 600_000,
        totalPaidAmount: 500_000,
        remainingDebtAmount: 700_000,
        paymentStatus: 'PARTIALLY_PAID',
      });
      const payValidReceiptId = crypto.randomUUID();
      const payValidRefundId = crypto.randomUUID();
      await tempPool.query(
        `INSERT INTO print_order_payments (id, workspace_id, order_id, payment_type, amount, payment_method, reference_code, note, recorded_by, created_at)
         VALUES ($1, $2, $3, 'DEPOSIT', 600000, 'BANK_TRANSFER', 'LEG-REC-600', 'Thu cọc hợp lệ', $4, now() - interval '2 days'),
                ($5, $2, $3, 'REFUND', 100000, 'BANK_TRANSFER', 'LEG-REF-100', 'Hoàn bớt 100k hợp lệ', $4, now() - interval '1 day')`,
        [
          payValidReceiptId,
          workspaceId,
          ordValid.orderId,
          owner.userId,
          payValidRefundId,
        ],
      );

      // Case B: Order missing customer_id (even though print_customers has 'Khách Trùng Tên Chưa Gắn ID')
      const ordMissingCust = await seedLegacyQuoteAndOrderPre0036(tempPool, {
        workspaceId,
        userId: owner.userId,
        quoteCode: 'BG-QA-NOCUST',
        orderCode: 'DH-QA-NOCUST',
        customerId: null,
        customerName: 'Khách Trùng Tên Chưa Gắn ID',
        totalQuoteAmount: 900_000,
        depositPaid: 300_000,
        totalPaidAmount: 300_000,
        remainingDebtAmount: 600_000,
      });
      const payMissingCustId = crypto.randomUUID();
      await tempPool.query(
        `INSERT INTO print_order_payments (id, workspace_id, order_id, payment_type, amount, payment_method, reference_code, note, recorded_by)
         VALUES ($1, $2, $3, 'DEPOSIT', 300000, 'CASH', 'LEG-NOCUST-300', 'Cọc đơn thiếu mã KH', $4)`,
        [payMissingCustId, workspaceId, ordMissingCust.orderId, owner.userId],
      );

      // Case C: Order with balance mismatch (order says paid 450,000 / debt 550,000, but payment rows sum to 200,000)
      const ordMismatch = await seedLegacyQuoteAndOrderPre0036(tempPool, {
        workspaceId,
        userId: owner.userId,
        quoteCode: 'BG-QA-MISMATCH',
        orderCode: 'DH-QA-MISMATCH',
        customerId: custValidId,
        customerName: 'Công ty Hợp Lệ C1',
        totalQuoteAmount: 1_000_000,
        depositPaid: 200_000,
        totalPaidAmount: 450_000,
        remainingDebtAmount: 550_000,
      });
      const payMismatchId = crypto.randomUUID();
      await tempPool.query(
        `INSERT INTO print_order_payments (id, workspace_id, order_id, payment_type, amount, payment_method, reference_code, note, recorded_by)
         VALUES ($1, $2, $3, 'INSTALLMENT', 200000, 'BANK_TRANSFER', 'LEG-MIS-200', 'Phiếu thu lệch số dư đơn', $4)`,
        [payMismatchId, workspaceId, ordMismatch.orderId, owner.userId],
      );

      // Case D: Anomalous refund exceeding receipts (0 receipts, 150,000 refund)
      const ordBadRefund = await seedLegacyQuoteAndOrderPre0036(tempPool, {
        workspaceId,
        userId: owner.userId,
        quoteCode: 'BG-QA-BADREF',
        orderCode: 'DH-QA-BADREF',
        customerId: custValidId,
        customerName: 'Công ty Hợp Lệ C1',
        totalQuoteAmount: 800_000,
        depositPaid: 0,
        totalPaidAmount: 0,
        remainingDebtAmount: 800_000,
        paymentStatus: 'UNPAID',
      });
      const payBadRefundId = crypto.randomUUID();
      await tempPool.query(
        `INSERT INTO print_order_payments (id, workspace_id, order_id, payment_type, amount, payment_method, reference_code, note, recorded_by)
         VALUES ($1, $2, $3, 'REFUND', 150000, 'CASH', 'LEG-BADREF-150', 'Hoàn tiền vượt tổng thu', $4)`,
        [payBadRefundId, workspaceId, ordBadRefund.orderId, owner.userId],
      );

      // Case E: Orphan paid order (total_paid_amount = 250,000 with ZERO rows in print_order_payments)
      const ordOrphanPaid = await seedLegacyQuoteAndOrderPre0036(tempPool, {
        workspaceId,
        userId: owner.userId,
        quoteCode: 'BG-QA-ORPHAN',
        orderCode: 'DH-QA-ORPHAN',
        customerId: custValidId,
        customerName: 'Công ty Hợp Lệ C1',
        totalQuoteAmount: 700_000,
        depositPaid: 250_000,
        totalPaidAmount: 250_000,
        remainingDebtAmount: 450_000,
      });

      // Run migration 0036!
      const migRes = await runMigrations(tempPool, upTo0036);
      assert.equal(migRes.appliedCount, 1);

      // 1a. ZERO auto-posted rows in Official AR!
      const arTxAfterMig = await tempPool.query(
        `SELECT COUNT(*)::int AS cnt FROM print_ar_transactions WHERE workspace_id = $1`,
        [workspaceId],
      );
      const arAllocAfterMig = await tempPool.query(
        `SELECT COUNT(*)::int AS cnt FROM print_ar_allocations WHERE workspace_id = $1`,
        [workspaceId],
      );
      assert.equal(arTxAfterMig.rows[0].cnt, 0);
      assert.equal(arAllocAfterMig.rows[0].cnt, 0);

      // 1b. Missing customer_id MUST remain NULL (never guessed by customer_name!)
      const noCustOrderRow = await tempPool.query(
        `SELECT customer_id, total_paid_amount, remaining_debt_amount, pre0036_total_paid_snapshot, pre0036_remaining_debt_snapshot
         FROM print_orders WHERE id = $1`,
        [ordMissingCust.orderId],
      );
      assert.equal(noCustOrderRow.rows[0].customer_id, null);
      assert.equal(Number(noCustOrderRow.rows[0].total_paid_amount), 300_000);
      assert.equal(
        Number(noCustOrderRow.rows[0].pre0036_total_paid_snapshot),
        300_000,
      );
      assert.equal(
        Number(noCustOrderRow.rows[0].pre0036_remaining_debt_snapshot),
        600_000,
      );

      // 1c. Idempotent re-run of migration 0036 (both via migrator & raw SQL execution)
      const migRerun = await runMigrations(tempPool, upTo0036);
      assert.equal(migRerun.appliedCount, 0);
      const raw0036Sql = await fs.readFile(
        path.join(
          REPO_ROOT,
          'packages/database/src/migrations/0036_printquote_ar_ap_ledger.sql',
        ),
        'utf8',
      );
      await tempPool.query(raw0036Sql);

      const queueRowsAfterRerun = await tempPool.query(
        `SELECT legacy_payment_id, status, anomaly_codes
         FROM print_legacy_ar_reconciliations
         WHERE workspace_id = $1`,
        [workspaceId],
      );
      assert.equal(
        queueRowsAfterRerun.rows.length,
        5,
        'Re-running 0036 SQL must not duplicate queued reconciliation rows',
      );
      const histAfterRerun = await tempPool.query(
        `SELECT COUNT(*)::int AS cnt FROM print_legacy_ar_reconciliation_history WHERE workspace_id = $1`,
        [workspaceId],
      );
      assert.equal(
        histAfterRerun.rows[0].cnt,
        5,
        'Re-running 0036 SQL must not duplicate QUEUED_BY_MIGRATION history rows',
      );

      // Start ephemeral API server against tempPool to test reconciliation API end-to-end
      const handler = createRequestHandler({
        pool: tempPool,
        csrfSecret: CSRF_SECRET,
        allowedOrigins: [ALLOWED_ORIGIN],
        isProduction: false,
      });
      tempServer = http.createServer(handler);
      await new Promise((resolve) =>
        tempServer.listen(0, '127.0.0.1', resolve),
      );
      const baseUrl = `http://127.0.0.1:${tempServer.address().port}`;

      // RBAC check: Sub-admin with finance:manage MUST get 403 on legacy reconciliation endpoints
      const adminBlocked = await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/receivables/legacy-reconciliation',
        { cookie: admin.cookie, csrfToken: admin.csrf },
      );
      assert.equal(adminBlocked.status, 403);

      // Owner inspects before-reconciliation overview
      const ovBeforeRes = await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/receivables/legacy-reconciliation',
        { cookie: owner.cookie, csrfToken: owner.csrf },
      );
      assert.equal(ovBeforeRes.status, 200);
      const ovBefore = ovBeforeRes.body.data;
      assert.equal(ovBefore.summary.legacy_payments_total_count, 5);
      assert.equal(ovBefore.summary.pending_count, 5);
      assert.equal(ovBefore.summary.confirmed_to_ar_count, 0);
      assert.equal(ovBefore.summary.confirmed_to_ar_net_amount, 0);
      assert.equal(ovBefore.summary.orders_missing_customer_count, 1);
      assert.ok(ovBefore.summary.orders_balance_mismatch_count >= 2);

      const byPayId = new Map(
        ovBefore.items.map((it) => [it.legacy_payment_id, it]),
      );
      assert.equal(byPayId.get(payValidReceiptId).can_confirm, true);
      assert.equal(byPayId.get(payValidRefundId).can_confirm, false);
      assert.ok(
        byPayId
          .get(payValidRefundId)
          .anomaly_codes.includes('REFUND_AWAITING_CONFIRMED_RECEIPT'),
      );
      assert.equal(byPayId.get(payMissingCustId).can_confirm, false);
      assert.ok(
        byPayId
          .get(payMissingCustId)
          .anomaly_codes.includes('MISSING_CUSTOMER_ID'),
      );
      assert.equal(byPayId.get(payMismatchId).can_confirm, false);
      assert.ok(
        byPayId
          .get(payMismatchId)
          .anomaly_codes.includes('ORDER_BALANCE_MISMATCH'),
      );
      assert.equal(byPayId.get(payBadRefundId).can_confirm, false);
      assert.ok(
        byPayId
          .get(payBadRefundId)
          .anomaly_codes.includes('REFUND_EXCEEDS_RECEIPTS'),
      );
      assert.ok(
        ovBefore.order_gaps.some(
          (g) =>
            g.order_id === ordOrphanPaid.orderId &&
            g.anomaly_codes.includes('ORPHAN_PAID_WITHOUT_PAYMENT_ROWS'),
        ),
      );

      // 1d. Attempt confirming valid refund BEFORE receipt -> blocked 409 REFUND_REQUIRES_CONFIRMED_RECEIPT!
      const prematureRefund = await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/receivables/legacy-payments/${payValidRefundId}/confirm`,
        {
          cookie: owner.cookie,
          csrfToken: owner.csrf,
          idempotencyKey: 'idem-premature-refund',
          body: { note: 'Thử xác nhận hoàn tiền trước phiếu thu' },
        },
      );
      assert.equal(prematureRefund.status, 409);
      assert.equal(
        prematureRefund.body.error.code,
        'REFUND_REQUIRES_CONFIRMED_RECEIPT',
      );

      // 1e. Confirm valid receipt (600,000) + verify Idempotency-Key replay & duplicate rejection!
      const confirmValidRec = await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/receivables/legacy-payments/${payValidReceiptId}/confirm`,
        {
          cookie: owner.cookie,
          csrfToken: owner.csrf,
          idempotencyKey: 'idem-confirm-valid-rec-1',
          body: { note: 'Đã đối chiếu sao kê ngân hàng 600k' },
        },
      );
      assert.equal(confirmValidRec.status, 200);
      assert.equal(
        confirmValidRec.body.data.after_snapshot.status,
        'CONFIRMED',
      );
      assert.match(
        confirmValidRec.body.data.ar_transaction.tx_code,
        /^PT-MIG-/,
      );
      assert.equal(confirmValidRec.body.data.ar_transaction.amount, 600_000);
      assert.equal(
        confirmValidRec.body.data.ar_transaction.legacy_order_payment_id,
        payValidReceiptId,
      );

      // Replay with same Idempotency-Key -> 200 same transaction, NO duplicate AR row!
      const replayValidRec = await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/receivables/legacy-payments/${payValidReceiptId}/confirm`,
        {
          cookie: owner.cookie,
          csrfToken: owner.csrf,
          idempotencyKey: 'idem-confirm-valid-rec-1',
          body: { note: 'Đã đối chiếu sao kê ngân hàng 600k' },
        },
      );
      assert.equal(replayValidRec.status, 200);
      assert.equal(
        replayValidRec.body.data.ar_transaction.id,
        confirmValidRec.body.data.ar_transaction.id,
      );

      // Second confirm with a NEW Idempotency-Key -> blocked 409 ALREADY_CONFIRMED_TO_AR!
      const secondConfirmRec = await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/receivables/legacy-payments/${payValidReceiptId}/confirm`,
        {
          cookie: owner.cookie,
          csrfToken: owner.csrf,
          idempotencyKey: 'idem-confirm-valid-rec-2',
          body: { note: 'Gọi lần 2' },
        },
      );
      assert.equal(secondConfirmRec.status, 409);
      assert.equal(secondConfirmRec.body.error.code, 'ALREADY_CONFIRMED_TO_AR');

      // Mid-transition check on ORD_VALID (receipt 600k confirmed, refund 100k still PENDING):
      // Order paid MUST stay 500,000 and remaining debt MUST stay 700,000 (NO double-counting!)
      const ordValidMid = await tempPool.query(
        `SELECT total_paid_amount, remaining_debt_amount, legacy_ar_reconciliation_status
         FROM print_orders WHERE id = $1`,
        [ordValid.orderId],
      );
      assert.equal(Number(ordValidMid.rows[0].total_paid_amount), 500_000);
      assert.equal(Number(ordValidMid.rows[0].remaining_debt_amount), 700_000);
      assert.equal(
        ordValidMid.rows[0].legacy_ar_reconciliation_status,
        'PENDING',
      );

      // Re-executing 0036 SQL AFTER confirming a row MUST preserve CONFIRMED state and NOT touch AR!
      await tempPool.query(raw0036Sql);
      const confirmedStillIntact = await tempPool.query(
        `SELECT status, posted_ar_transaction_id FROM print_legacy_ar_reconciliations WHERE legacy_payment_id = $1`,
        [payValidReceiptId],
      );
      assert.equal(confirmedStillIntact.rows[0].status, 'CONFIRMED');
      assert.equal(
        confirmedStillIntact.rows[0].posted_ar_transaction_id,
        confirmValidRec.body.data.ar_transaction.id,
      );

      // Now confirm valid refund (100,000) -> succeeds 200!
      const confirmValidRef = await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/receivables/legacy-payments/${payValidRefundId}/confirm`,
        {
          cookie: owner.cookie,
          csrfToken: owner.csrf,
          idempotencyKey: 'idem-confirm-valid-ref-1',
          body: { note: 'Xác nhận hoàn 100k sau khi đã có thu 600k' },
        },
      );
      assert.equal(confirmValidRef.status, 200);
      assert.equal(
        confirmValidRef.body.data.after_snapshot.status,
        'CONFIRMED',
      );
      assert.match(
        confirmValidRef.body.data.ar_transaction.tx_code,
        /^HT-MIG-/,
      );

      const ordValidAfter = await tempPool.query(
        `SELECT total_paid_amount, remaining_debt_amount, legacy_ar_reconciliation_status
         FROM print_orders WHERE id = $1`,
        [ordValid.orderId],
      );
      assert.equal(Number(ordValidAfter.rows[0].total_paid_amount), 500_000);
      assert.equal(
        Number(ordValidAfter.rows[0].remaining_debt_amount),
        700_000,
      );
      assert.equal(
        ordValidAfter.rows[0].legacy_ar_reconciliation_status,
        'RECONCILED',
      );

      // 1f. Missing customer_id row: blocked -> link customer explicitly -> confirm succeeds!
      const blockNoCust = await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/receivables/legacy-payments/${payMissingCustId}/confirm`,
        {
          cookie: owner.cookie,
          csrfToken: owner.csrf,
          body: { note: 'Thử xác nhận khi chưa gắn mã khách' },
        },
      );
      assert.equal(blockNoCust.status, 409);
      assert.equal(
        blockNoCust.body.error.code,
        'MISSING_CUSTOMER_ID_FOR_RECONCILIATION',
      );

      const linkCustRes = await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/orders/${ordMissingCust.orderId}/link-customer`,
        {
          cookie: owner.cookie,
          csrfToken: owner.csrf,
          body: {
            customer_id: custSameNameId,
            reason: 'Chủ xưởng xác nhận gắn đúng hồ sơ khách hàng',
          },
        },
      );
      assert.equal(linkCustRes.status, 200);
      assert.equal(linkCustRes.body.data.customer_id, custSameNameId);

      const confirmLinkedCust = await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/receivables/legacy-payments/${payMissingCustId}/confirm`,
        {
          cookie: owner.cookie,
          csrfToken: owner.csrf,
          idempotencyKey: 'idem-confirm-linked-cust',
          body: { note: 'Đã gắn mã khách và đối chiếu phiếu thu 300k' },
        },
      );
      assert.equal(confirmLinkedCust.status, 200);
      assert.equal(
        confirmLinkedCust.body.data.after_snapshot.status,
        'CONFIRMED',
      );

      // 1g. Mismatched balance row: blocked -> put ON_HOLD -> reconcile order balance -> confirm succeeds!
      const blockMismatch = await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/receivables/legacy-payments/${payMismatchId}/confirm`,
        {
          cookie: owner.cookie,
          csrfToken: owner.csrf,
          body: { note: 'Thử xác nhận khi số dư đơn đang lệch' },
        },
      );
      assert.equal(blockMismatch.status, 409);
      assert.equal(
        blockMismatch.body.error.code,
        'LEGACY_ANOMALY_BLOCKS_CONFIRMATION',
      );

      const holdRes = await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/receivables/legacy-payments/${payMismatchId}/hold`,
        {
          cookie: owner.cookie,
          csrfToken: owner.csrf,
          body: { reason: 'Tạm giữ chờ kiểm tra lại sổ tay thu tiền mặt' },
        },
      );
      assert.equal(holdRes.status, 200);
      assert.equal(holdRes.body.data.status, 'ON_HOLD');

      const reconcileBalRes = await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/orders/${ordMismatch.orderId}/reconcile-legacy-balance`,
        {
          cookie: owner.cookie,
          csrfToken: owner.csrf,
          body: {
            reason:
              'Đã kiểm tra chứng từ: thực thu cũ đúng bằng 200.000đ, số 450.000đ nhập tay nhầm trước đây',
          },
        },
      );
      assert.equal(reconcileBalRes.status, 200);
      assert.equal(
        reconcileBalRes.body.data.aligned_total_paid_amount,
        200_000,
      );
      assert.equal(
        reconcileBalRes.body.data.aligned_remaining_debt_amount,
        800_000,
      );

      const confirmAfterBalFix = await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/receivables/legacy-payments/${payMismatchId}/confirm`,
        {
          cookie: owner.cookie,
          csrfToken: owner.csrf,
          idempotencyKey: 'idem-confirm-after-bal-fix',
          body: { note: 'Xác nhận phiếu thu 200k sau khi chuẩn hóa số dư đơn' },
        },
      );
      assert.equal(confirmAfterBalFix.status, 200);
      assert.equal(
        confirmAfterBalFix.body.data.after_snapshot.status,
        'CONFIRMED',
      );

      // 1h. Bad refund exceeding receipts MUST STILL BE BLOCKED!
      const blockBadRefund = await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/receivables/legacy-payments/${payBadRefundId}/confirm`,
        {
          cookie: owner.cookie,
          csrfToken: owner.csrf,
          body: { note: 'Không bao giờ được phép tự duyệt hoàn vượt thu' },
        },
      );
      assert.equal(blockBadRefund.status, 409);

      // 1i. Verify before/after summary & immutable history after confirming 4 valid/reconciled rows (net = 600k - 100k + 300k + 200k = 1,000,000)
      const ovAfterRes = await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/receivables/legacy-reconciliation',
        { cookie: owner.cookie, csrfToken: owner.csrf },
      );
      assert.equal(ovAfterRes.status, 200);
      assert.equal(ovAfterRes.body.data.summary.confirmed_to_ar_count, 4);
      assert.equal(ovAfterRes.body.data.summary.pending_count, 1);
      assert.equal(
        ovAfterRes.body.data.summary.confirmed_to_ar_net_amount,
        1_000_000,
      );
      const actionsRecorded = new Set(
        ovAfterRes.body.data.history.map((h) => h.action),
      );
      assert.ok(actionsRecorded.has('QUEUED_BY_MIGRATION'));
      assert.ok(actionsRecorded.has('CUSTOMER_LINKED'));
      assert.ok(actionsRecorded.has('HELD'));
      assert.ok(actionsRecorded.has('BALANCE_DISCREPANCY_RESOLVED'));
      assert.ok(actionsRecorded.has('CONFIRMED_TO_AR'));

      // 1j. Rollback MUST block with ROLLBACK_BLOCKED now that rows were confirmed!
      const rollbackSql = await fs.readFile(
        path.join(
          REPO_ROOT,
          'scripts/db/rollback-0036-printquote-ar-ap-ledger.sql',
        ),
        'utf8',
      );
      await assert.rejects(
        () => tempPool.query(rollbackSql),
        /ROLLBACK_BLOCKED/,
      );
    } finally {
      if (tempServer) {
        tempServer.closeAllConnections?.();
        await new Promise((resolve) => tempServer.close(resolve));
      }
      await tempPool.end();
      await adminPool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [tempDbName],
      );
      await adminPool.query(`DROP DATABASE IF EXISTS "${tempDbName}"`);
      await adminPool.end();
    }
  });

  describe('2 & 3. Chống tính trùng sổ cũ/sổ mới trong giai đoạn chuyển tiếp & Backend Guard customer_id cho đơn MỚI', () => {
    let pool;
    let server;
    let baseUrl;

    before(async () => {
      const dbConfig = loadTestDatabaseConfig();
      pool = createDatabasePool(dbConfig);
      const migrations = await loadMigrationFiles();
      await runMigrations(pool, migrations);

      const handler = createRequestHandler({
        pool,
        csrfSecret: CSRF_SECRET,
        allowedOrigins: [ALLOWED_ORIGIN],
        isProduction: false,
      });
      server = http.createServer(handler);
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      baseUrl = `http://127.0.0.1:${server.address().port}`;
    });

    after(async () => {
      if (server) {
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
      }
      if (pool) {
        await pool.end();
      }
    });

    it('2. Không tính trùng giữa print_order_payments chờ đối chiếu và sổ AR chính thức khi phát sinh thu mới + xác nhận đồng thời', async () => {
      const { workspaceId, owner } = await seedWorkspaceActors(
        pool,
        'QA0036-NoDouble',
      );
      const custRes = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/customers',
        {
          cookie: owner.cookie,
          csrfToken: owner.csrf,
          body: {
            name: 'Khách Chuyển Tiếp Không Nhân Đôi',
            phone: '0908111222',
          },
        },
      );
      assert.equal(custRes.status, 201);
      const cust = custRes.body.data;

      // Simulate a migrated pre-0036 order (1,000,000) with 400,000 PENDING legacy deposit
      const leg1 = await seedLegacyQuoteAndOrderPre0036(pool, {
        workspaceId,
        userId: owner.userId,
        quoteCode: 'BG-TRANS-01',
        orderCode: 'DH-TRANS-01',
        customerId: cust.id,
        customerName: cust.name,
        totalQuoteAmount: 1_000_000,
        depositPaid: 400_000,
        totalPaidAmount: 400_000,
        remainingDebtAmount: 600_000,
      });
      await pool.query(
        `UPDATE print_orders
         SET valid_receivable_amount = 1000000,
             pre0036_total_paid_snapshot = 400000,
             pre0036_remaining_debt_snapshot = 600000,
             pre0036_deposit_paid_snapshot = 400000,
             legacy_ar_reconciliation_status = 'PENDING'
         WHERE id = $1`,
        [leg1.orderId],
      );
      const legPay1Id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO print_order_payments (id, workspace_id, order_id, payment_type, amount, payment_method, reference_code, note, recorded_by)
         VALUES ($1, $2, $3, 'DEPOSIT', 400000, 'BANK_TRANSFER', 'TRANS-DEP-400', 'Cọc cũ chờ đối chiếu', $4)`,
        [legPay1Id, workspaceId, leg1.orderId, owner.userId],
      );
      const rec1Res = await pool.query(
        `INSERT INTO print_legacy_ar_reconciliations (
           workspace_id, legacy_payment_id, order_id, status, anomaly_codes, pre_reconciliation_json
         ) VALUES ($1, $2, $3, 'PENDING', '[]'::jsonb, $4::jsonb)
         RETURNING id`,
        [
          workspaceId,
          legPay1Id,
          leg1.orderId,
          JSON.stringify({
            legacy_payment_id: legPay1Id,
            amount: 400000,
            pre0036_total_paid_snapshot: 400000,
            pre0036_remaining_debt_snapshot: 600000,
          }),
        ],
      );
      await pool.query(
        `INSERT INTO print_legacy_ar_reconciliation_history (workspace_id, reconciliation_id, legacy_payment_id, order_id, action, after_json)
         VALUES ($1, $2, $3, $4, 'QUEUED_BY_MIGRATION', '{"status":"PENDING"}'::jsonb)`,
        [workspaceId, rec1Res.rows[0].id, legPay1Id, leg1.orderId],
      );

      // Step A: Before confirmation -> Official AR = 0 (remaining 1,000,000), Pending Legacy = 400,000, Effective remaining = 600,000
      const arBefore = await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/receivables',
        { cookie: owner.cookie, csrfToken: owner.csrf },
      );
      assert.equal(arBefore.status, 200);
      const rowBefore = arBefore.body.data.summaries.find(
        (it) => it.customer_id === cust.id,
      );
      assert.equal(rowBefore.net_allocated_receipt_total, 0);
      assert.equal(rowBefore.remaining_receivable_total, 1_000_000);
      assert.equal(rowBefore.legacy_pending_ar_total, 400_000);
      assert.equal(rowBefore.effective_remaining_after_pending_total, 600_000);

      // Step B: Record NEW Official AR receipt of 250,000 allocated to DH-TRANS-01 during transition
      const newRec = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/receivables/receipts',
        {
          cookie: owner.cookie,
          csrfToken: owner.csrf,
          body: {
            customer_id: cust.id,
            amount: 250_000,
            reference_code: 'NEW-AR-250',
            allocations: [{ order_id: leg1.orderId, amount: 250_000 }],
          },
        },
      );
      assert.equal(newRec.status, 201);

      // Over-allocation guard during transition: remaining effective debt is 350,000 (1,000,000 - 250,000 official - 400,000 pending).
      // Attempting to allocate 400,000 MUST be blocked 400 so confirming the legacy 400,000 later can never exceed 1,000,000!
      const overAlloc = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/receivables/receipts',
        {
          cookie: owner.cookie,
          csrfToken: owner.csrf,
          body: {
            customer_id: cust.id,
            amount: 400_000,
            reference_code: 'OVER-400',
            allocations: [{ order_id: leg1.orderId, amount: 400_000 }],
          },
        },
      );
      assert.equal(overAlloc.status, 400);

      const arMid = await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/receivables',
        { cookie: owner.cookie, csrfToken: owner.csrf },
      );
      const rowMid = arMid.body.data.summaries.find(
        (it) => it.customer_id === cust.id,
      );
      assert.equal(rowMid.net_allocated_receipt_total, 250_000);
      assert.equal(rowMid.remaining_receivable_total, 750_000);
      assert.equal(rowMid.legacy_pending_ar_total, 400_000);
      assert.equal(rowMid.effective_remaining_after_pending_total, 350_000);

      // Step C: Fire 5 concurrent confirmations on legPay1Id -> ONLY 1 succeeds (200), 4 blocked (409), ZERO double-counting!
      const concConfirm = await Promise.all(
        Array.from({ length: 5 }, (_, idx) =>
          apiRequest(
            baseUrl,
            'POST',
            `/api/v1/print-quotes/receivables/legacy-payments/${legPay1Id}/confirm`,
            {
              cookie: owner.cookie,
              csrfToken: owner.csrf,
              idempotencyKey: `idem-conc-leg1-${idx}`,
              body: { note: 'Xác nhận cọc cũ 400k' },
            },
          ),
        ),
      );
      assert.equal(
        concConfirm.filter((r) => r.status === 200).length,
        1,
        'Exactly 1 concurrent confirmation may succeed',
      );
      assert.equal(
        concConfirm.filter((r) => r.status === 409).length,
        4,
        'Remaining 4 concurrent confirmations must receive 409',
      );

      // Step D: After confirmation -> Official AR = 650,000 (remaining 350,000), Pending Legacy = 0, Order paid = 650,000, debt = 350,000!
      const arAfter = await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/receivables',
        { cookie: owner.cookie, csrfToken: owner.csrf },
      );
      const rowAfter = arAfter.body.data.summaries.find(
        (it) => it.customer_id === cust.id,
      );
      assert.equal(rowAfter.net_allocated_receipt_total, 650_000);
      assert.equal(rowAfter.remaining_receivable_total, 350_000);
      assert.equal(rowAfter.legacy_pending_ar_total, 0);
      assert.equal(rowAfter.effective_remaining_after_pending_total, 350_000);

      const ordList = await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/orders',
        { cookie: owner.cookie, csrfToken: owner.csrf },
      );
      const ordItem = ordList.body.data.items.find(
        (o) => o.id === leg1.orderId,
      );
      assert.equal(ordItem.total_paid_amount, 650_000);
      assert.equal(ordItem.remaining_debt_amount, 350_000);

      const repAfter = await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/financial-report',
        { cookie: owner.cookie, csrfToken: owner.csrf },
      );
      assert.equal(
        repAfter.body.data.cashflow_and_debt.customer_cash_collected_gross,
        650_000,
      );
      assert.equal(
        repAfter.body.data.cashflow_and_debt.legacy_pending_ar_net_total,
        0,
      );
      assert.equal(
        repAfter.body.data.cashflow_and_debt.remaining_receivable_total,
        350_000,
      );
    });

    it('3. Backend Guard cho đơn MỚI (POST /api/v1/print-quotes/orders): chặn thiếu customer_id, UUID sai, khác workspace, khách ngừng hoạt động; hỗ trợ tạo nhanh khách inline & không tự đoán theo tên', async () => {
      const wsA = await seedWorkspaceActors(pool, 'QA0036-GuardA');
      const wsB = await seedWorkspaceActors(pool, 'QA0036-GuardB');

      const finCountBefore = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM fin_entries WHERE workspace_id = $1`,
        [wsA.workspaceId],
      );

      // Customer in Workspace B (cross-workspace)
      const custBRes = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/customers',
        {
          cookie: wsB.owner.cookie,
          csrfToken: wsB.owner.csrf,
          body: { name: 'Khách Workspace B' },
        },
      );
      assert.equal(custBRes.status, 201);
      const custB = custBRes.body.data;

      // Active customer in Workspace A with SAME name as unlinked quote (must NEVER be auto-guessed!)
      const sameNameCustRes = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/customers',
        {
          cookie: wsA.owner.cookie,
          csrfToken: wsA.owner.csrf,
          body: { name: 'Công ty Trùng Tên Không Tự Gắn' },
        },
      );
      assert.equal(sameNameCustRes.status, 201);

      // Inactive customer in Workspace A
      const inactiveCustRes = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/customers',
        {
          cookie: wsA.owner.cookie,
          csrfToken: wsA.owner.csrf,
          body: { name: 'Khách Đã Ngừng Giao Dịch' },
        },
      );
      assert.equal(inactiveCustRes.status, 201);
      const inactiveCustId = inactiveCustRes.body.data.id;
      const deactRes = await apiRequest(
        baseUrl,
        'PATCH',
        `/api/v1/print-quotes/customers/${inactiveCustId}`,
        {
          cookie: wsA.owner.cookie,
          csrfToken: wsA.owner.csrf,
          body: { is_active: false },
        },
      );
      assert.equal(deactRes.status, 200);

      // Create finalized quote WITHOUT customer_id (only customer_name matching sameNameCust!)
      const qNoCustRes = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/quotes',
        {
          cookie: wsA.owner.cookie,
          csrfToken: wsA.owner.csrf,
          body: {
            title: 'Báo giá chưa gắn mã khách',
            customer_name: 'Công ty Trùng Tên Không Tự Gắn',
            status: 'FINALIZED',
            items: [
              {
                name: 'Tờ rơi A4',
                unit: 'tờ',
                quantity: 500,
                vendorCostMode: VendorCostMode.PER_UNIT,
                baseCostRate: 1_000,
                profitMode: ProfitMode.FIXED_AMOUNT,
                profitScope: ProfitScope.PER_UNIT,
                profitValue: 500,
              },
            ],
          },
        },
      );
      assert.equal(qNoCustRes.status, 201);
      const quoteNoCust = qNoCustRes.body.data;
      assert.equal(quoteNoCust.customer_id, null);

      // 3a. Direct POST /orders without customer_id -> 400 CUSTOMER_REQUIRED_FOR_ORDER (does NOT guess by name!)
      const missingRes = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/orders',
        {
          cookie: wsA.owner.cookie,
          csrfToken: wsA.owner.csrf,
          body: { quote_id: quoteNoCust.id },
        },
      );
      assert.equal(missingRes.status, 400);
      assert.equal(missingRes.body.error.code, 'CUSTOMER_REQUIRED_FOR_ORDER');

      // 3b. Malformed UUID -> 400 INVALID_CUSTOMER_FOR_WORKSPACE
      const badUuidRes = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/orders',
        {
          cookie: wsA.owner.cookie,
          csrfToken: wsA.owner.csrf,
          body: { quote_id: quoteNoCust.id, customer_id: 'not-a-valid-uuid' },
        },
      );
      assert.equal(badUuidRes.status, 400);
      assert.equal(
        badUuidRes.body.error.code,
        'INVALID_CUSTOMER_FOR_WORKSPACE',
      );

      // 3c. Cross-workspace customer_id -> 400 INVALID_CUSTOMER_FOR_WORKSPACE
      const crossWsRes = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/orders',
        {
          cookie: wsA.owner.cookie,
          csrfToken: wsA.owner.csrf,
          body: { quote_id: quoteNoCust.id, customer_id: custB.id },
        },
      );
      assert.equal(crossWsRes.status, 400);
      assert.equal(
        crossWsRes.body.error.code,
        'INVALID_CUSTOMER_FOR_WORKSPACE',
      );

      // 3d. Inactive customer in same workspace -> 400 INACTIVE_CUSTOMER_FOR_ORDER
      const inactiveOrderRes = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/orders',
        {
          cookie: wsA.owner.cookie,
          csrfToken: wsA.owner.csrf,
          body: { quote_id: quoteNoCust.id, customer_id: inactiveCustId },
        },
      );
      assert.equal(inactiveOrderRes.status, 400);
      assert.equal(
        inactiveOrderRes.body.error.code,
        'INACTIVE_CUSTOMER_FOR_ORDER',
      );

      // 3e. Inline quick_customer -> 201, creates customer in Workspace A and links both order & quote!
      const quickOrderRes = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/orders',
        {
          cookie: wsA.owner.cookie,
          csrfToken: wsA.owner.csrf,
          body: {
            quote_id: quoteNoCust.id,
            quick_customer: {
              name: 'Khách Tạo Nhanh Khi Chuyển Đơn',
              phone: '0909777888',
            },
            deposit_paid: 250_000,
          },
        },
      );
      assert.equal(quickOrderRes.status, 201);
      assert.ok(quickOrderRes.body.data.customer_id);
      assert.equal(
        quickOrderRes.body.data.customer_name,
        'Khách Tạo Nhanh Khi Chuyển Đơn',
      );
      assert.equal(quickOrderRes.body.data.total_paid_amount, 250_000);

      // Verify /finance isolation untouched
      const finCountAfter = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM fin_entries WHERE workspace_id = $1`,
        [wsA.workspaceId],
      );
      assert.equal(finCountAfter.rows[0].cnt, finCountBefore.rows[0].cnt);
    });
  });
});
