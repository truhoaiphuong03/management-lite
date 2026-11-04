import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadTestDatabaseConfig } from '../../dist/packages/database/src/config.js';
import { createDatabasePool } from '../../dist/packages/database/src/pool.js';
import {
  runMigrations,
  loadMigrationFiles,
} from '../../dist/packages/database/src/migrator.js';
import { createRequestHandler } from '../../dist/apps/api/src/app.js';
import { startServer } from '../../dist/apps/api/src/server.js';
import { generateCsrfToken } from '../../dist/packages/security/src/csrf.js';
import { hashToken } from '../../dist/packages/security/src/tokens.js';
import {
  AreaInputMode,
  ProfitMode,
  ProfitScope,
  VendorCostMode,
  verifyQuoteSnapshotIntegrity,
  formatCustomerAreaDisclosure,
} from '../../dist/packages/contracts/src/printquote.js';
import { OrdersTab } from '../../dist/apps/web/src/screens/printquote/OrdersTab.js';
import { AnalyticsTab } from '../../dist/apps/web/src/screens/printquote/AnalyticsTab.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const CSRF_SECRET = 'test-csrf-secret-pq-codex-qa-32chars!!';
const ALLOWED_ORIGIN = 'http://127.0.0.1:3000';

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

async function createApprovedQuoteAndId(baseUrl, cookie, csrfToken, title) {
  const createRes = await apiRequest(
    baseUrl,
    'POST',
    '/api/v1/print-quotes/quotes',
    {
      cookie,
      csrfToken,
      body: {
        title,
        customer_name: `Khách ${title}`,
        shipping_fee: 70_000,
        items: [
          {
            id: 'LINE-1',
            name: 'Catalogue A4 C200',
            unit: 'cuốn',
            quantity: 100,
            vendor_cost_mode: VendorCostMode.PER_UNIT,
            base_cost_rate: 7_500,
            profit_mode: ProfitMode.FIXED_AMOUNT,
            profit_scope: ProfitScope.TOTAL_BATCH,
            profit_value: 300_000,
          },
        ],
      },
    },
  );
  assert.equal(createRes.status, 201);
  const quoteId = createRes.body.data.id;

  const approveRes = await apiRequest(
    baseUrl,
    'POST',
    `/api/v1/print-quotes/quotes/${quoteId}/finalize`,
    {
      cookie,
      csrfToken,
    },
  );
  assert.equal(approveRes.status, 200);
  return quoteId;
}

describe('Codex QA Regressions — MGL-PRINTQUOTE DEV (Findings #1..#5)', () => {
  let pool;
  let server;
  let baseUrl;
  let workspaceId;
  let ownerCookie;
  let ownerCsrf;

  before(async () => {
    const dbConfig = loadTestDatabaseConfig();
    pool = createDatabasePool(dbConfig);
    await runMigrations(pool);

    const shortId = crypto.randomUUID().slice(0, 8);
    workspaceId = crypto.randomUUID();
    const ownerUserId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active')`,
      [workspaceId, `PQ Codex QA WS ${shortId}`],
    );
    await pool.query(
      `INSERT INTO users (id, username_normalized, email_normalized, status)
       VALUES ($1, $2, $3, 'active')`,
      [ownerUserId, `owner_cqa_${shortId}`, `owner-cqa-${shortId}@test.local`],
    );
    await pool.query(
      `INSERT INTO user_credentials (user_id, password_hash, credential_version)
       VALUES ($1, 'argon2id$stub', 1)`,
      [ownerUserId],
    );
    await pool.query(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status)
       VALUES ($1, $2, $3, 'owner', 'active')`,
      [crypto.randomUUID(), workspaceId, ownerUserId],
    );
    await pool.query(
      `INSERT INTO user_workspace_bindings (user_id, workspace_id, status, version)
       VALUES ($1, $2, 'active', 1)`,
      [ownerUserId, workspaceId],
    );

    const rawTok = `owner-cqa-${crypto.randomUUID()}`;
    const tokHash = hashToken(rawTok);
    await pool.query(
      `INSERT INTO auth_sessions (
         id, workspace_id, user_id, session_token_hash,
         credential_version_at_issue, idle_expires_at, absolute_expires_at, remember_me
       ) VALUES ($1, $2, $3, $4, 1, now() + interval '4 hours', now() + interval '24 hours', false)`,
      [crypto.randomUUID(), workspaceId, ownerUserId, tokHash],
    );
    ownerCookie = `mglite_session=${rawTok}`;
    ownerCsrf = generateCsrfToken(tokHash, CSRF_SECRET);

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

  it('Finding #1: Nhập một khoản chi phí thực tế KHÔNG tự xác nhận và KHÔNG mượn expected_* cho khoản thiếu; giữ nguyên số đã nhập + lịch sử khi điều chỉnh hoặc bỏ xác nhận', async () => {
    const quoteId = await createApprovedQuoteAndId(
      baseUrl,
      ownerCookie,
      ownerCsrf,
      'F1 Partial Cost',
    );

    // 1. Create order WITH partial actual_vendor_cost (without actual_cost_confirmed: true)
    const createOrderRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/orders',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          quote_id: quoteId,
          actual_vendor_cost: 720_000,
        },
      },
    );
    assert.equal(createOrderRes.status, 201);
    const created = createOrderRes.body.data;
    assert.equal(created.actual_cost_confirmed, false);
    assert.equal(created.cost_reconciliation_status, 'PARTIAL_ENTERED');
    assert.equal(created.entered_vendor_cost, 720_000);
    assert.equal(created.entered_shipping_fee, null);
    assert.equal(created.entered_extra_cost, null);
    assert.equal(created.actual_vendor_cost, null);
    assert.equal(created.actual_profit, null);

    // 2. Attempting to confirm while shipping_fee and extra_cost are still missing MUST fail 400 (never borrow expected_shipping_fee = 70_000)
    const badConfirmRes = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/orders/${created.id}`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          actual_cost_confirmed: true,
        },
      },
    );
    assert.equal(badConfirmRes.status, 400);
    assert.equal(
      badConfirmRes.body.error.code,
      'INCOMPLETE_ACTUAL_COST_CONFIRMATION',
    );

    // 3. Enter remaining two items WITHOUT confirming -> ENTERED_UNCONFIRMED, still actual_profit === null
    const enterAllUnconfirmedRes = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/orders/${created.id}`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          actual_shipping_fee: 65_000,
          actual_extra_cost: 15_000,
          cost_note: 'Nhập nháp từ phiếu giao hàng, chờ kế toán duyệt',
        },
      },
    );
    assert.equal(enterAllUnconfirmedRes.status, 200);
    assert.equal(enterAllUnconfirmedRes.body.data.actual_cost_confirmed, false);
    assert.equal(
      enterAllUnconfirmedRes.body.data.cost_reconciliation_status,
      'ENTERED_UNCONFIRMED',
    );
    assert.equal(enterAllUnconfirmedRes.body.data.entered_vendor_cost, 720_000);
    assert.equal(enterAllUnconfirmedRes.body.data.entered_shipping_fee, 65_000);
    assert.equal(enterAllUnconfirmedRes.body.data.entered_extra_cost, 15_000);
    assert.equal(enterAllUnconfirmedRes.body.data.actual_profit, null);

    // 4. Confirm now that all 3 items are explicitly entered -> 1_120_000 - (720_000 + 65_000 + 15_000) = 320_000
    const confirmRes = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/orders/${created.id}`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          actual_cost_confirmed: true,
          cost_note: 'Đã đối chiếu hóa đơn xưởng #HD-901',
        },
      },
    );
    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.body.data.actual_cost_confirmed, true);
    assert.equal(confirmRes.body.data.cost_reconciliation_status, 'CONFIRMED');
    assert.equal(confirmRes.body.data.actual_vendor_cost, 720_000);
    assert.equal(confirmRes.body.data.actual_shipping_fee, 65_000);
    assert.equal(confirmRes.body.data.actual_extra_cost, 15_000);
    assert.equal(confirmRes.body.data.actual_profit, 320_000);

    // 5. Adjust extra_cost while confirmed -> 310_000, history logs ADJUSTED
    const adjustRes = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/orders/${created.id}`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          actual_extra_cost: 25_000,
          actual_cost_confirmed: true,
          cost_note: 'Bổ sung phí bốc xếp ngoài giờ',
        },
      },
    );
    assert.equal(adjustRes.status, 200);
    assert.equal(adjustRes.body.data.actual_profit, 310_000);

    // 6. Unconfirm -> actual_cost_confirmed = false, NEEDS_REVIEW, actual_profit = null, entered_* PRESERVED (NOT zeroed!), history preserved
    const unconfirmRes = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/orders/${created.id}`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          actual_cost_confirmed: false,
          cost_note: 'Xưởng báo đính chính phụ phí, tạm mở lại đối soát',
        },
      },
    );
    assert.equal(unconfirmRes.status, 200);
    const unconfirmed = unconfirmRes.body.data;
    assert.equal(unconfirmed.actual_cost_confirmed, false);
    assert.equal(unconfirmed.cost_reconciliation_status, 'NEEDS_REVIEW');
    assert.equal(unconfirmed.actual_profit, null);
    assert.equal(unconfirmed.entered_vendor_cost, 720_000);
    assert.equal(unconfirmed.entered_shipping_fee, 65_000);
    assert.equal(unconfirmed.entered_extra_cost, 25_000);
    assert.ok(Array.isArray(unconfirmed.cost_history));
    const actions = unconfirmed.cost_history.map((h) => h.action);
    assert.ok(actions.includes('ENTERED'));
    assert.ok(actions.includes('CONFIRMED'));
    assert.ok(actions.includes('ADJUSTED'));
    assert.ok(actions.includes('UNCONFIRMED'));
  });

  it('Finding #2: Migration 0035 KHÔNG tự suy đoán đơn cũ có actual != expected là đã xác nhận; giữ nguyên 100% số gốc và đưa toàn bộ đơn thiếu bằng chứng vào NEEDS_REVIEW', async () => {
    const baseCfg = loadTestDatabaseConfig();
    const adminPwPath = 'C:\\ML-Test\\secrets\\admin.pw';
    let adminPassword = baseCfg.password;
    try {
      adminPassword = (await fs.readFile(adminPwPath, 'utf8')).trim();
    } catch {
      // fallback
    }
    const parsedTestUrl = baseCfg.connectionString
      ? new URL(baseCfg.connectionString)
      : null;
    const pgHost = parsedTestUrl?.hostname || baseCfg.host || '127.0.0.1';
    const pgPort = parsedTestUrl?.port
      ? Number(parsedTestUrl.port)
      : baseCfg.port || 55433;
    const tempDbName = `mglite_cqa_mig0035_${crypto.randomUUID().slice(0, 8)}`;

    const adminPool = createDatabasePool({
      host: pgHost,
      port: pgPort,
      user: 'ml_test_admin',
      password: adminPassword,
      database: 'postgres',
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
    await adminPool.query(
      `CREATE DATABASE "${tempDbName}" OWNER ml_test_admin`,
    );

    const tempPool = createDatabasePool({
      host: pgHost,
      port: pgPort,
      user: 'ml_test_admin',
      password: adminPassword,
      database: tempDbName,
      max: 4,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });

    try {
      const allMigs = await loadMigrationFiles();
      const pre0035 = allMigs.filter((m) => !m.id.startsWith('0035_'));
      await runMigrations(tempPool, pre0035);

      const wsId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const quoteId = crypto.randomUUID();
      const qVerId = crypto.randomUUID();
      const orderSameId = crypto.randomUUID();
      const orderDiffId = crypto.randomUUID();

      await tempPool.query(
        `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, 'Legacy 0034 CQA', 'Asia/Ho_Chi_Minh', 'active')`,
        [wsId],
      );
      await tempPool.query(
        `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, 'u_cqa_0034', 'ucqa0034@test.local', 'active')`,
        [userId],
      );
      await tempPool.query(
        `INSERT INTO print_quotes (
           id, workspace_id, quote_code, title, customer_name, status, current_version,
           total_quantity, total_vendor_cost, total_profit, shipping_fee, total_extra_cost,
           total_quote_amount, total_rounding_adjustment, lines_json, snapshot_json, customer_pdf_json, integrity_hash, created_by
         ) VALUES ($1, $2, 'BG-CQA-01', 'Báo giá lịch sử', 'Khách Lịch Sử', 'CONVERTED', 1, 100, 300000, 100000, 20000, 0, 420000, 0, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, 'hash-cqa', $3)`,
        [quoteId, wsId, userId],
      );
      await tempPool.query(
        `INSERT INTO print_quote_versions (
           id, workspace_id, quote_id, version_number, status, total_quantity,
           total_vendor_cost, total_profit, shipping_fee, total_extra_cost,
           total_quote_amount, total_rounding_adjustment, snapshot_json, customer_pdf_json, integrity_hash, created_by
         ) VALUES ($1, $2, $3, 1, 'CONVERTED', 100, 300000, 100000, 20000, 0, 420000, 0, '{}'::jsonb, '{}'::jsonb, 'hash-cqa', $4)`,
        [qVerId, wsId, quoteId, userId],
      );

      // Order 1: actual == expected
      await tempPool.query(
        `INSERT INTO print_orders (
           id, workspace_id, order_code, quote_id, quote_code, quote_version, customer_name, title,
           total_quote_amount, expected_vendor_cost, actual_vendor_cost,
           expected_shipping_fee, actual_shipping_fee, expected_extra_cost, actual_extra_cost,
           expected_profit, actual_profit, remaining_debt_amount, snapshot_json, integrity_hash, created_by
         ) VALUES ($1, $2, 'DH-LEG-01', $3, 'BG-CQA-01', 1, 'Khách A', 'Đơn lịch sử A', 420000, 300000, 300000, 20000, 20000, 0, 0, 100000, 100000, 420000, '{}'::jsonb, 'hash-cqa', $4)`,
        [orderSameId, wsId, quoteId, userId],
      );

      // Order 2: actual != expected (280000 != 300000) — MUST NOT be guessed as confirmed!
      const quoteId2 = crypto.randomUUID();
      const qVerId2 = crypto.randomUUID();
      await tempPool.query(
        `INSERT INTO print_quotes (
           id, workspace_id, quote_code, title, customer_name, status, current_version,
           total_quantity, total_vendor_cost, total_profit, shipping_fee, total_extra_cost,
           total_quote_amount, total_rounding_adjustment, lines_json, snapshot_json, customer_pdf_json, integrity_hash, created_by
         ) VALUES ($1, $2, 'BG-CQA-02', 'Báo giá lịch sử 2', 'Khách Lịch Sử B', 'CONVERTED', 1, 100, 300000, 100000, 20000, 0, 420000, 0, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, 'hash-cqa2', $3)`,
        [quoteId2, wsId, userId],
      );
      await tempPool.query(
        `INSERT INTO print_quote_versions (
           id, workspace_id, quote_id, version_number, status, total_quantity,
           total_vendor_cost, total_profit, shipping_fee, total_extra_cost,
           total_quote_amount, total_rounding_adjustment, snapshot_json, customer_pdf_json, integrity_hash, created_by
         ) VALUES ($1, $2, $3, 1, 'CONVERTED', 100, 300000, 100000, 20000, 0, 420000, 0, '{}'::jsonb, '{}'::jsonb, 'hash-cqa2', $4)`,
        [qVerId2, wsId, quoteId2, userId],
      );
      await tempPool.query(
        `INSERT INTO print_orders (
           id, workspace_id, order_code, quote_id, quote_code, quote_version, customer_name, title,
           total_quote_amount, expected_vendor_cost, actual_vendor_cost,
           expected_shipping_fee, actual_shipping_fee, expected_extra_cost, actual_extra_cost,
           expected_profit, actual_profit, remaining_debt_amount, snapshot_json, integrity_hash, created_by
         ) VALUES ($1, $2, 'DH-LEG-02', $3, 'BG-CQA-02', 1, 'Khách B', 'Đơn lịch sử B', 420000, 300000, 280000, 20000, 20000, 0, 0, 100000, 120000, 420000, '{}'::jsonb, 'hash-cqa2', $4)`,
        [orderDiffId, wsId, quoteId2, userId],
      );

      await runMigrations(tempPool, allMigs);

      const rowsRes = await tempPool.query(
        `SELECT * FROM print_orders ORDER BY order_code ASC`,
      );
      assert.equal(rowsRes.rows.length, 2);

      // DH-LEG-02 (actual != expected): MUST NOT be guessed as actual_cost_confirmed = true!
      assert.equal(rowsRes.rows[1].actual_cost_confirmed, false);
      assert.equal(rowsRes.rows[1].cost_reconciliation_status, 'NEEDS_REVIEW');
      assert.equal(Number(rowsRes.rows[1].actual_vendor_cost), 280_000);
      assert.equal(Number(rowsRes.rows[1].actual_shipping_fee), 20_000);
      assert.equal(Number(rowsRes.rows[1].actual_extra_cost), 0);
      assert.equal(Number(rowsRes.rows[1].actual_profit), 120_000);

      // DH-LEG-01: unconfirmed + NEEDS_REVIEW + raw numbers untouched
      assert.equal(rowsRes.rows[0].actual_cost_confirmed, false);
      assert.equal(rowsRes.rows[0].cost_reconciliation_status, 'NEEDS_REVIEW');
      assert.equal(Number(rowsRes.rows[0].actual_vendor_cost), 300_000);

      // Rollback guard: clean NEEDS_REVIEW legacy state CAN roll back safely and re-apply without mutating raw legacy numbers
      const rollbackSql = await fs.readFile(
        path.join(
          REPO_ROOT,
          'scripts/db/rollback-0035-printquote-financial-control-gate.sql',
        ),
        'utf8',
      );
      await tempPool.query(rollbackSql);
      const reapplyRes = await runMigrations(tempPool, allMigs);
      assert.equal(reapplyRes.appliedCount, 1);

      const afterReapply = await tempPool.query(
        `SELECT * FROM print_orders WHERE id = $1`,
        [orderDiffId],
      );
      assert.equal(afterReapply.rows[0].actual_cost_confirmed, false);
      assert.equal(
        afterReapply.rows[0].cost_reconciliation_status,
        'NEEDS_REVIEW',
      );
      assert.equal(Number(afterReapply.rows[0].actual_vendor_cost), 280_000);
    } finally {
      await tempPool.end();
      await adminPool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [tempDbName],
      );
      await adminPool.query(`DROP DATABASE IF EXISTS "${tempDbName}"`);
      await adminPool.end();
    }
  });

  it('Finding #3: Dashboard phản ánh riêng các khoản đã thu/đã chi/chi phí phát sinh của đơn CANCELLED (không làm biến mất, không tự xóa, không tự bù trừ; cho phép REFUND cọc trên đơn hủy nhưng chặn thu thêm)', async () => {
    const quoteId = await createApprovedQuoteAndId(
      baseUrl,
      ownerCookie,
      ownerCsrf,
      'F3 Cancelled Order Obligations',
    );
    const orderRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/orders',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: { quote_id: quoteId, deposit_required: 500_000 },
      },
    );
    assert.equal(orderRes.status, 201);
    const orderId = orderRes.body.data.id;

    // Customer pays 500,000 deposit
    const depRes = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/orders/${orderId}/payments`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          amount: 500_000,
          payment_type: 'DEPOSIT',
          payment_method: 'BANK_TRANSFER',
          note: 'Khách đặt cọc trước khi in',
        },
      },
    );
    assert.equal(depRes.status, 201);

    // Workshop already incurred 200,000 confirmed plate/setup cost, and 150,000 paid to workshop
    const costRes = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/orders/${orderId}`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          actual_vendor_cost: 200_000,
          actual_shipping_fee: 0,
          actual_extra_cost: 0,
          actual_cost_confirmed: true,
          vendor_paid_amount: 150_000,
          cost_note: 'Phí bình bài & kẽm đã phát sinh trước khi hủy',
        },
      },
    );
    assert.equal(costRes.status, 200);

    // Cancel the order
    const cancelRes = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/orders/${orderId}`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: { production_status: 'CANCELLED' },
      },
    );
    assert.equal(cancelRes.status, 200);

    // Check Dashboard stats: cancelled order MUST NOT vanish!
    const statsRes = await apiRequest(
      baseUrl,
      'GET',
      '/api/v1/print-quotes/stats',
      { cookie: ownerCookie },
    );
    assert.equal(statsRes.status, 200);
    const stats = statsRes.body.data;
    assert.equal(stats.orders_by_production_status.CANCELLED, 1);
    assert.ok(stats.cancelled_orders_summary);
    assert.equal(stats.cancelled_orders_summary.cancelled_orders_count, 1);
    assert.equal(
      stats.cancelled_orders_summary.cancelled_orders_with_obligations_count,
      1,
    );
    // Explicitly separate — NOT netted (500k - 200k or 500k - 150k)!
    assert.equal(
      stats.cancelled_orders_summary.cancelled_customer_paid_holding,
      500_000,
    );
    assert.equal(
      stats.cancelled_orders_summary.cancelled_vendor_paid_amount,
      150_000,
    );
    assert.equal(
      stats.cancelled_orders_summary.cancelled_confirmed_incurred_cost,
      200_000,
    );

    // Collecting additional positive payment on CANCELLED order is blocked (409 ORDER_CANCELLED)
    const blockedCollect = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/orders/${orderId}/payments`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          amount: 100_000,
          payment_type: 'INSTALLMENT',
          payment_method: 'CASH',
        },
      },
    );
    assert.equal(blockedCollect.status, 409);
    assert.equal(blockedCollect.body.error.code, 'ORDER_CANCELLED');

    // Refunding customer's held deposit on CANCELLED order is allowed
    const refundRes = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/orders/${orderId}/payments`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          amount: 500_000,
          payment_type: 'REFUND',
          payment_method: 'BANK_TRANSFER',
          note: 'Hoàn cọc cho khách sau khi hủy đơn',
        },
      },
    );
    assert.equal(refundRes.status, 201);

    const statsAfterRefund = await apiRequest(
      baseUrl,
      'GET',
      '/api/v1/print-quotes/stats',
      { cookie: ownerCookie },
    );
    assert.equal(
      statsAfterRefund.body.data.cancelled_orders_summary
        .cancelled_customer_paid_holding,
      0,
    );
    // Workshop obligation/cash paid remains visible until separately handled
    assert.equal(
      statsAfterRefund.body.data.cancelled_orders_summary
        .cancelled_vendor_paid_amount,
      150_000,
    );
  });

  it('Finding #4: vendor_paid_amount lưu lịch sử thay đổi (VENDOR_PAYMENT_NOTE) và giao diện ghi trung thực phạm vi ghi chú tổng cấp đơn (chưa tách sổ công nợ từng xưởng)', async () => {
    const quoteId = await createApprovedQuoteAndId(
      baseUrl,
      ownerCookie,
      ownerCsrf,
      'F4 Vendor Paid Scope',
    );
    const orderRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/orders',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: { quote_id: quoteId },
      },
    );
    assert.equal(orderRes.status, 201);
    const orderId = orderRes.body.data.id;

    const noteRes = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/orders/${orderId}`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          vendor_paid_amount: 400_000,
          cost_note: 'Chuyển khoản tạm ứng xưởng in bìa',
        },
      },
    );
    assert.equal(noteRes.status, 200);
    assert.equal(noteRes.body.data.vendor_paid_amount, 400_000);
    assert.ok(
      noteRes.body.data.cost_history?.some(
        (h) => h.action === 'VENDOR_PAYMENT_NOTE',
      ),
    );

    const ordersHtml = renderToStaticMarkup(
      React.createElement(OrdersTab, {
        orders: [noteRes.body.data],
        onUpdateOrderField: () => {},
        paymentOrderTarget: null,
        setPaymentOrderTarget: () => {},
        paymentAmount: 0,
        setPaymentAmount: () => {},
        paymentType: 'DEPOSIT',
        setPaymentType: () => {},
        paymentMethod: 'BANK_TRANSFER',
        setPaymentMethod: () => {},
        paymentNote: '',
        setPaymentNote: () => {},
        onRecordPayment: () => {},
      }),
    );
    assert.match(ordersHtml, /cấp đơn/i);
    assert.match(ordersHtml, /chưa tách sổ công nợ/i);

    const statsRes = await apiRequest(
      baseUrl,
      'GET',
      '/api/v1/print-quotes/stats',
      { cookie: ownerCookie },
    );
    const analyticsHtml = renderToStaticMarkup(
      React.createElement(AnalyticsTab, {
        stats: statsRes.body.data,
        orders: [noteRes.body.data],
        quotes: [],
      }),
    );
    assert.match(analyticsHtml, /cấp đơn/i);
    assert.match(analyticsHtml, /Đơn đã hủy/i);
  });

  it('Finding #5: Đóng server + pool.end() ngay sau phản hồi >= 400 KHÔNG phát sinh cảnh báo SYSTEM_LOG_FLUSH_FAILED: Cannot use a pool after calling end on the pool', async () => {
    const dbConfig = loadTestDatabaseConfig();
    const shortLivedPool = createDatabasePool(dbConfig);
    const shortLivedHandler = createRequestHandler({
      pool: shortLivedPool,
      csrfSecret: CSRF_SECRET,
      allowedOrigins: [ALLOWED_ORIGIN],
      isProduction: false,
    });
    const shortLivedServer = http.createServer(shortLivedHandler);
    await new Promise((resolve) =>
      shortLivedServer.listen(0, '127.0.0.1', resolve),
    );
    const tempUrl = `http://127.0.0.1:${shortLivedServer.address().port}`;

    const capturedErrors = [];
    const origError = console.error;
    console.error = (...args) => {
      capturedErrors.push(args.map((a) => String(a)).join(' '));
      origError.apply(console, args);
    };

    try {
      // Trigger a 403/400 response so SystemLogService schedules its 250ms async flush
      const badRes = await fetch(`${tempUrl}/api/v1/print-quotes/quotes`, {
        method: 'POST',
        headers: {
          Origin: ALLOWED_ORIGIN,
          Cookie: ownerCookie,
          // Deliberately omit X-CSRF-Token -> 403 -> res.once('finish') -> systemLogService.record()
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      assert.equal(badRes.status, 403);

      // Immediately close HTTP server & end DB pool BEFORE the 250ms timer fires
      shortLivedServer.closeAllConnections?.();
      await new Promise((resolve) => shortLivedServer.close(resolve));
      await shortLivedPool.end();

      // Also verify startServer().close() drains final logs before closing pool cleanly
      const srvPool = createDatabasePool(dbConfig);
      const running = await startServer(
        {
          port: 0,
          host: '127.0.0.1',
          csrfSecret: CSRF_SECRET,
          allowedOrigins: [ALLOWED_ORIGIN],
          trustedProxies: [],
          isProduction: false,
          sessionCookieName: 'mglite_session',
        },
        srvPool,
      );
      const srvPort = running.server.address().port;
      const reqId = `cqa-stop-${crypto.randomUUID().slice(0, 8)}`;
      const badRes2 = await fetch(
        `http://127.0.0.1:${srvPort}/api/v1/print-quotes/quotes`,
        {
          method: 'POST',
          headers: {
            Origin: ALLOWED_ORIGIN,
            Cookie: ownerCookie,
            'X-Request-Id': reqId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        },
      );
      assert.equal(badRes2.status, 403);
      running.server.closeAllConnections?.();
      await running.close();

      // Verify startServer().close() flushed reqId into system_logs BEFORE closing srvPool
      const logCheck = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM system_logs WHERE request_id = $1`,
        [reqId],
      );
      assert.equal(logCheck.rows[0].cnt, 1);

      // Wait 350ms past the 250ms SystemLogService flush timer
      await new Promise((resolve) => setTimeout(resolve, 350));
    } finally {
      console.error = origError;
    }

    const flushFailures = capturedErrors.filter(
      (line) =>
        line.includes('SYSTEM_LOG_FLUSH_FAILED') ||
        line.includes('Cannot use a pool after calling end on the pool'),
    );
    assert.deepEqual(flushFailures, []);
  });

  it('Finding #6 (e7e9e18 QA #2): Migration 0035 & migrate.mjs chỉ cấp SELECT, INSERT trên print_order_cost_history, chặn UPDATE/DELETE/TRUNCATE & cascade delete, vẫn chạy đủ luồng API dưới quyền hp_app_runtime và kiểm chứng rollback bảo toàn lịch sử', async () => {
    const execFileAsync = promisify(execFile);
    const dbConfig = loadTestDatabaseConfig();
    const adminUrl = new URL(dbConfig.connectionString);
    adminUrl.pathname = '/postgres';
    const adminPool = createDatabasePool({
      ...dbConfig,
      connectionString: adminUrl.toString(),
    });

    const tempDbName = `mglite_cqa_priv0035_${crypto.randomUUID().slice(0, 8)}`;
    await adminPool.query(`CREATE DATABASE "${tempDbName}"`);

    const tempUrl = new URL(dbConfig.connectionString);
    tempUrl.pathname = `/${tempDbName}`;
    const tempPool = createDatabasePool({
      ...dbConfig,
      connectionString: tempUrl.toString(),
    });

    let runtimePool = null;
    let runtimeServer = null;

    try {
      const allMigs = loadMigrationFiles(
        path.join(REPO_ROOT, 'packages/database/src/migrations'),
      );
      const pre0035 = allMigs.filter((m) => !m.id.startsWith('0035_'));
      await runMigrations(tempPool, pre0035);

      // Ensure hp_app_runtime & hp_app_test exist on this cluster and hold baseline pre-0035 runtime grants
      for (const roleName of ['hp_app_runtime', 'hp_app_test']) {
        await tempPool.query(`
          DO $$
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${roleName}') THEN
              CREATE ROLE ${roleName} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
            END IF;
          END $$;
        `);
        await tempPool.query(`
          GRANT USAGE ON SCHEMA public TO ${roleName};
          GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${roleName};
          REVOKE UPDATE, DELETE ON audit_events FROM ${roleName};
          REVOKE UPDATE, DELETE ON issue_activity FROM ${roleName};
          REVOKE ALL ON schema_migrations FROM ${roleName};
          GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${roleName};
        `);
      }

      // Run the real migration CLI (applies 0035 + post-migration role grants in scripts/migrate.mjs)
      await execFileAsync(process.execPath, ['scripts/migrate.mjs'], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          DATABASE_URL: tempUrl.toString(),
        },
      });

      // 1. Verify least-privilege grants on print_order_cost_history & required grants on print_orders
      for (const roleName of ['hp_app_runtime', 'hp_app_test']) {
        const privRes = await tempPool.query(
          `SELECT
             has_table_privilege($1, 'print_order_cost_history', 'SELECT') AS hist_select,
             has_table_privilege($1, 'print_order_cost_history', 'INSERT') AS hist_insert,
             has_table_privilege($1, 'print_order_cost_history', 'UPDATE') AS hist_update,
             has_table_privilege($1, 'print_order_cost_history', 'DELETE') AS hist_delete,
             has_table_privilege($1, 'print_order_cost_history', 'TRUNCATE') AS hist_truncate,
             has_table_privilege($1, 'print_orders', 'SELECT') AS ord_select,
             has_table_privilege($1, 'print_orders', 'INSERT') AS ord_insert,
             has_table_privilege($1, 'print_orders', 'UPDATE') AS ord_update`,
          [roleName],
        );
        const p = privRes.rows[0];
        assert.equal(
          p.hist_select,
          true,
          `${roleName} must have SELECT on print_order_cost_history`,
        );
        assert.equal(
          p.hist_insert,
          true,
          `${roleName} must have INSERT on print_order_cost_history`,
        );
        assert.equal(
          p.hist_update,
          false,
          `${roleName} MUST NOT have UPDATE on print_order_cost_history`,
        );
        assert.equal(
          p.hist_delete,
          false,
          `${roleName} MUST NOT have DELETE on print_order_cost_history`,
        );
        assert.equal(
          p.hist_truncate,
          false,
          `${roleName} MUST NOT have TRUNCATE on print_order_cost_history`,
        );
        assert.equal(
          p.ord_select,
          true,
          `${roleName} must keep SELECT on print_orders`,
        );
        assert.equal(
          p.ord_insert,
          true,
          `${roleName} must keep INSERT on print_orders`,
        );
        assert.equal(
          p.ord_update,
          true,
          `${roleName} must keep UPDATE on print_orders`,
        );
      }

      // 2. Test clean rollback + idempotent re-apply BEFORE inserting audit history rows
      const rollbackSql = await fs.readFile(
        path.join(
          REPO_ROOT,
          'scripts/db/rollback-0035-printquote-financial-control-gate.sql',
        ),
        'utf8',
      );
      await tempPool.query(rollbackSql);
      await execFileAsync(process.execPath, ['scripts/migrate.mjs'], {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          DATABASE_URL: tempUrl.toString(),
        },
      });

      // Re-verify privileges remain strict after rollback + re-migrate
      const recheckPriv = await tempPool.query(
        `SELECT
           has_table_privilege('hp_app_runtime', 'print_order_cost_history', 'UPDATE') AS rt_upd,
           has_table_privilege('hp_app_runtime', 'print_order_cost_history', 'DELETE') AS rt_del,
           has_table_privilege('hp_app_test', 'print_order_cost_history', 'UPDATE') AS tst_upd,
           has_table_privilege('hp_app_test', 'print_order_cost_history', 'DELETE') AS tst_del`,
      );
      assert.deepEqual(recheckPriv.rows[0], {
        rt_upd: false,
        rt_del: false,
        tst_upd: false,
        tst_del: false,
      });

      // 3. Seed workspace + owner session, then boot API executing EVERY query as hp_app_runtime
      const rtShort = crypto.randomUUID().slice(0, 8);
      const rtWsId = crypto.randomUUID();
      const rtOwnerId = crypto.randomUUID();
      const rtSessionId = crypto.randomUUID();
      const rtRawToken = `priv-rt-${crypto.randomUUID()}`;
      const rtTokenHash = hashToken(rtRawToken);
      const rtCsrf = generateCsrfToken(rtTokenHash, CSRF_SECRET);
      const rtCookie = `mglite_session=${rtRawToken}`;

      await tempPool.query(
        `INSERT INTO workspaces (id, name, timezone, status)
         VALUES ($1, 'QA Priv WS', 'Asia/Ho_Chi_Minh', 'active')`,
        [rtWsId],
      );
      await tempPool.query(
        `INSERT INTO users (id, username_normalized, email_normalized, status)
         VALUES ($1, $2, $3, 'active')`,
        [rtOwnerId, `priv_owner_${rtShort}`, `priv_owner_${rtShort}@qa.local`],
      );
      await tempPool.query(
        `INSERT INTO user_credentials (user_id, password_hash, credential_version)
         VALUES ($1, 'argon2id$stub', 1)`,
        [rtOwnerId],
      );
      await tempPool.query(
        `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status)
         VALUES ($1, $2, $3, 'owner', 'active')`,
        [crypto.randomUUID(), rtWsId, rtOwnerId],
      );
      await tempPool.query(
        `INSERT INTO user_workspace_bindings (user_id, workspace_id, status, version)
         VALUES ($1, $2, 'active', 1)`,
        [rtOwnerId, rtWsId],
      );
      await tempPool.query(
        `INSERT INTO auth_sessions (
           id, workspace_id, user_id, session_token_hash,
           credential_version_at_issue, idle_expires_at, absolute_expires_at, remember_me
         ) VALUES ($1, $2, $3, $4, 1, now() + interval '4 hours', now() + interval '24 hours', false)`,
        [rtSessionId, rtWsId, rtOwnerId, rtTokenHash],
      );

      const rawRuntimePool = createDatabasePool({
        ...dbConfig,
        connectionString: tempUrl.toString(),
      });
      runtimePool = {
        async query(sql, params) {
          const client = await rawRuntimePool.connect();
          try {
            await client.query('SET SESSION AUTHORIZATION hp_app_runtime');
            return await client.query(sql, params);
          } finally {
            client.release();
          }
        },
        async connect() {
          const client = await rawRuntimePool.connect();
          await client.query('SET SESSION AUTHORIZATION hp_app_runtime');
          return client;
        },
        async end() {
          await rawRuntimePool.end();
        },
      };

      const whoRes = await runtimePool.query(
        `SELECT current_user AS cur, session_user AS sess`,
      );
      assert.equal(whoRes.rows[0].cur, 'hp_app_runtime');
      assert.equal(whoRes.rows[0].sess, 'hp_app_runtime');

      const rtHandler = createRequestHandler({
        pool: runtimePool,
        csrfSecret: CSRF_SECRET,
        allowedOrigins: [ALLOWED_ORIGIN],
        isProduction: false,
      });
      runtimeServer = http.createServer(rtHandler);
      await new Promise((resolve) =>
        runtimeServer.listen(0, '127.0.0.1', resolve),
      );
      const rtBaseUrl = `http://127.0.0.1:${runtimeServer.address().port}`;

      // Execute full PrintQuote lifecycle as hp_app_runtime
      const rtQuoteId = await createApprovedQuoteAndId(
        rtBaseUrl,
        rtCookie,
        rtCsrf,
        'Đơn kiểm thử quyền hp_app_runtime',
      );
      const createOrdRes = await apiRequest(
        rtBaseUrl,
        'POST',
        '/api/v1/print-quotes/orders',
        {
          cookie: rtCookie,
          csrfToken: rtCsrf,
          idempotencyKey: `idem-priv-create-${crypto.randomUUID()}`,
          body: { quote_id: rtQuoteId },
        },
      );
      assert.equal(createOrdRes.status, 201);
      const createdOrder = createOrdRes.body.data;

      const enterRes = await apiRequest(
        rtBaseUrl,
        'PATCH',
        `/api/v1/print-quotes/orders/${createdOrder.id}`,
        {
          cookie: rtCookie,
          csrfToken: rtCsrf,
          idempotencyKey: `idem-priv-enter-${crypto.randomUUID()}`,
          body: {
            actual_vendor_cost: 305_000,
            cost_note: 'Nhập tạm dưới hp_app_runtime',
          },
        },
      );
      assert.equal(enterRes.status, 200);

      const confirmRes = await apiRequest(
        rtBaseUrl,
        'PATCH',
        `/api/v1/print-quotes/orders/${createdOrder.id}`,
        {
          cookie: rtCookie,
          csrfToken: rtCsrf,
          idempotencyKey: `idem-priv-confirm-${crypto.randomUUID()}`,
          body: {
            actual_cost_confirmed: true,
            actual_vendor_cost: 305_000,
            actual_shipping_fee: 30_000,
            actual_extra_cost: 0,
            vendor_paid_amount: 150_000,
            cost_note: 'Xác nhận đủ 3 khoản dưới hp_app_runtime',
          },
        },
      );
      assert.equal(confirmRes.status, 200);
      assert.equal(confirmRes.body.data.actual_cost_confirmed, true);

      const unconfirmRes = await apiRequest(
        rtBaseUrl,
        'PATCH',
        `/api/v1/print-quotes/orders/${createdOrder.id}`,
        {
          cookie: rtCookie,
          csrfToken: rtCsrf,
          idempotencyKey: `idem-priv-unconfirm-${crypto.randomUUID()}`,
          body: {
            actual_cost_confirmed: false,
            cost_note: 'Mở khóa kiểm tra lại dưới hp_app_runtime',
          },
        },
      );
      assert.equal(unconfirmRes.status, 200);
      assert.equal(unconfirmRes.body.data.cost_history.length, 4);

      const historyId = unconfirmRes.body.data.cost_history[0].id;

      // 4. Verify hp_app_runtime CANNOT UPDATE, DELETE, TRUNCATE print_order_cost_history or cascade-delete order
      await assert.rejects(
        () =>
          runtimePool.query(
            `UPDATE print_order_cost_history SET note = 'tampered' WHERE id = $1`,
            [historyId],
          ),
        /permission denied|append-only/i,
      );
      await assert.rejects(
        () =>
          runtimePool.query(
            `DELETE FROM print_order_cost_history WHERE id = $1`,
            [historyId],
          ),
        /permission denied|append-only/i,
      );
      await assert.rejects(
        () => runtimePool.query(`TRUNCATE print_order_cost_history`),
        /permission denied|append-only/i,
      );
      await assert.rejects(
        () =>
          runtimePool.query(`DELETE FROM print_orders WHERE id = $1`, [
            createdOrder.id,
          ]),
        /fk_print_order_cost_history_order|violates.*foreign key constraint|permission denied/i,
      );

      // 5. Even DB owner/superuser CANNOT UPDATE, DELETE, TRUNCATE print_order_cost_history or delete parent order
      await assert.rejects(
        () =>
          tempPool.query(
            `UPDATE print_order_cost_history SET note = 'owner-tamper' WHERE id = $1`,
            [historyId],
          ),
        /print_order_cost_history is append-only/i,
      );
      await assert.rejects(
        () =>
          tempPool.query(`DELETE FROM print_order_cost_history WHERE id = $1`, [
            historyId,
          ]),
        /print_order_cost_history is append-only/i,
      );
      await assert.rejects(
        () => tempPool.query(`TRUNCATE print_order_cost_history`),
        /print_order_cost_history is append-only/i,
      );
      await assert.rejects(
        () =>
          tempPool.query(`DELETE FROM print_orders WHERE id = $1`, [
            createdOrder.id,
          ]),
        /fk_print_order_cost_history_order|violates.*foreign key constraint/i,
      );

      // 6. Rollback MUST block fail-closed and preserve 100% of history rows
      await assert.rejects(
        () => tempPool.query(rollbackSql),
        /ROLLBACK_BLOCKED/,
      );
      const countAfterBlockedRollback = await tempPool.query(
        `SELECT COUNT(*)::int AS cnt FROM print_order_cost_history WHERE order_id = $1`,
        [createdOrder.id],
      );
      assert.equal(countAfterBlockedRollback.rows[0].cnt, 4);
    } finally {
      if (runtimeServer) {
        runtimeServer.closeAllConnections?.();
        await new Promise((resolve) => runtimeServer.close(resolve));
      }
      if (runtimePool) await runtimePool.end();
      await tempPool.end();
      await adminPool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [tempDbName],
      );
      await adminPool.query(`DROP DATABASE IF EXISTS "${tempDbName}"`);
      await adminPool.end();
    }
  });

  // =========================================================================
  // Finding #7 (550935b + D-02): HTTP + PostgreSQL round-trip for 6-decimal
  // area precision, equal/neutral/explained area disclosure, legacy JSON
  // enrichment, and zero internalworkshop/cost/profit leakage.
  // =========================================================================
  it('Finding #7 + D-02: persists 6-decimal area & D-02 customerAreaNote via HTTP API, enriches legacy rows, and blocks adjustmentReason/cost/profit leaks on /pdf & /pdf-file', async () => {
    const createRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/quotes',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          title: 'Báo giá kiểm thử D-02 + 6 chữ số thập phân',
          customer_name: 'Công ty Kiểm Thử D-02',
          shipping_fee: 0,
          items: [
            {
              id: 'D02-EQUAL',
              name: 'Decal PP cán bóng đúng khổ',
              unit: 'tấm',
              quantity: 2,
              vendor_cost_mode: VendorCostMode.PER_SQM,
              base_cost_rate: 150_000,
              area_spec: {
                mode: AreaInputMode.DIRECT_AREA,
                actualAreaSqm: 2.5,
                billableAreaSqm: 2.5,
              },
              profit_mode: ProfitMode.FIXED_AMOUNT,
              profit_scope: ProfitScope.PER_SQM,
              profit_value: 50_000,
            },
            {
              id: 'D02-NEUTRAL',
              name: 'Bạt Hiflex không ghi chú khách',
              unit: 'tấm',
              quantity: 1,
              vendor_cost_mode: VendorCostMode.PER_SQM,
              base_cost_rate: 100_000,
              area_spec: {
                mode: AreaInputMode.DIRECT_AREA,
                actualAreaSqm: 2.88,
                billableAreaSqm: 3,
                adjustmentReason: 'NOI_BO_XUONG_EP_KHO_3M2_TUYET_MAT',
              },
              profit_mode: ProfitMode.FIXED_AMOUNT,
              profit_scope: ProfitScope.PER_SQM,
              profit_value: 50_000,
            },
            {
              id: 'D02-EXPLAINED-6DEC',
              name: 'Tem UV 6 chữ số thập phân',
              unit: 'bộ',
              quantity: 1,
              vendor_cost_mode: VendorCostMode.PER_SQM,
              base_cost_rate: 600_000,
              area_spec: {
                mode: AreaInputMode.DIRECT_AREA,
                actualAreaSqm: 1.111111,
                billableAreaSqm: 1.234567,
                adjustmentReason: 'HAO_PHOI_LASER_NOI_BO_KHONG_XUAT',
                customerAreaNote: 'Tính tiền tối thiểu 1,234567 m²',
              },
              profit_mode: ProfitMode.FIXED_AMOUNT,
              profit_scope: ProfitScope.PER_SQM,
              profit_value: 400_000,
            },
          ],
        },
      },
    );
    assert.equal(createRes.status, 201);
    const quote = createRes.body.data;
    const quoteId = quote.id;

    // Totals remain exact integer VND:
    // Line 1: 2.5 * (150k + 50k) = 500,000
    // Line 2: 3 * (100k + 50k) = 450,000
    // Line 3: 1.234567 * (600k + 400k) = 1,234,567
    // Grand total = 2,184,567
    assert.equal(quote.total_quote_amount, 2_184_567);
    assert.equal(
      verifyQuoteSnapshotIntegrity(quote.snapshot_json, quote.integrity_hash),
      true,
    );

    // 1. GET /quotes/:id/pdf returns safe JSON with 6-dec areas, customerAreaNote only where entered, ZERO internal fields
    const pdfJsonRes = await apiRequest(
      baseUrl,
      'GET',
      `/api/v1/print-quotes/quotes/${quoteId}/pdf`,
      { cookie: ownerCookie },
    );
    assert.equal(pdfJsonRes.status, 200);
    const safePdf = pdfJsonRes.body.data;
    assert.equal(safePdf.grandTotalPayable, 2_184_567);
    const rawSafeJson = JSON.stringify(safePdf);
    assert.ok(!rawSafeJson.includes('NOI_BO_XUONG_EP_KHO_3M2_TUYET_MAT'));
    assert.ok(!rawSafeJson.includes('HAO_PHOI_LASER_NOI_BO_KHONG_XUAT'));
    assert.ok(!rawSafeJson.includes('adjustmentReason'));
    assert.ok(!rawSafeJson.includes('150000'));
    assert.ok(!rawSafeJson.includes('600000'));

    assert.equal(formatCustomerAreaDisclosure(safePdf.lines[0]), null);
    assert.equal(
      formatCustomerAreaDisclosure(safePdf.lines[1]),
      'Thực tế 2,88 m² · Diện tích tính tiền: 3 m²',
    );
    assert.equal(
      formatCustomerAreaDisclosure(safePdf.lines[2]),
      'Thực tế 1,111111 m² · Tính tiền tối thiểu 1,234567 m²',
    );

    // 2. GET /quotes/:id/pdf-file returns real binary %PDF- matching quote total
    const pdfFileRes = await fetch(
      `${baseUrl}/api/v1/print-quotes/quotes/${quoteId}/pdf-file`,
      {
        method: 'GET',
        headers: { Origin: ALLOWED_ORIGIN, Cookie: ownerCookie },
      },
    );
    assert.equal(pdfFileRes.status, 200);
    assert.equal(pdfFileRes.headers.get('content-type'), 'application/pdf');
    const pdfBytes = Buffer.from(await pdfFileRes.arrayBuffer());
    assert.equal(pdfBytes.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok(
      !pdfBytes.toString('utf8').includes('NOI_BO_XUONG_EP_KHO_3M2_TUYET_MAT'),
    );
    assert.ok(
      !pdfBytes.toString('utf8').includes('HAO_PHOI_LASER_NOI_BO_KHONG_XUAT'),
    );

    // 3. Simulate legacy pre-D-02 persisted customer_pdf_json missing actualAreaSqm/billableAreaSqm
    await pool.query(
      `UPDATE print_quotes
       SET customer_pdf_json = jsonb_set(
         customer_pdf_json,
         '{lines}',
         (
           SELECT jsonb_agg(l - 'actualAreaSqm' - 'billableAreaSqm' - 'customerAreaNote')
           FROM jsonb_array_elements(customer_pdf_json->'lines') AS l
         )
       )
       WHERE id = $1`,
      [quoteId],
    );

    const legacyPdfRes = await apiRequest(
      baseUrl,
      'GET',
      `/api/v1/print-quotes/quotes/${quoteId}/pdf`,
      { cookie: ownerCookie },
    );
    assert.equal(legacyPdfRes.status, 200);
    const enrichedPdf = legacyPdfRes.body.data;
    assert.equal(enrichedPdf.grandTotalPayable, 2_184_567);
    assert.equal(enrichedPdf.lines[1].actualAreaSqm, 2.88);
    assert.equal(enrichedPdf.lines[1].billableAreaSqm, 3);
    assert.equal(
      formatCustomerAreaDisclosure(enrichedPdf.lines[1]),
      'Thực tế 2,88 m² · Diện tích tính tiền: 3 m²',
    );
    assert.equal(enrichedPdf.lines[2].actualAreaSqm, 1.111111);
    assert.equal(enrichedPdf.lines[2].billableAreaSqm, 1.234567);
    assert.equal(
      formatCustomerAreaDisclosure(enrichedPdf.lines[2]),
      'Thực tế 1,111111 m² · Tính tiền tối thiểu 1,234567 m²',
    );
    assert.ok(
      !JSON.stringify(enrichedPdf).includes(
        'NOI_BO_XUONG_EP_KHO_3M2_TUYET_MAT',
      ),
    );
  });
});
