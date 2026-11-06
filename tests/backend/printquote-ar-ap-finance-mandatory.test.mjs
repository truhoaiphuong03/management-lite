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
  verifyQuoteSnapshotIntegrity,
  VendorCostMode,
  ProfitMode,
  ProfitScope,
} from '../../dist/packages/contracts/src/printquote.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const CSRF_SECRET = 'test-csrf-secret-pq-arap-mandatory-32chars!!';
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
  const staffId = crypto.randomUUID();

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
  const staff = await mkSession(staffId, 'staff', 'staff', ['finance:manage']);

  return { workspaceId, owner, admin, staff };
}

async function createFinalizedQuoteAndOrder(
  baseUrl,
  actor,
  {
    title,
    customerId,
    customerName,
    vendorId,
    shippingFee = 0,
    extraCost = 0,
    depositRequired = 0,
    lines,
  },
) {
  const normalizedLines = lines.map((line) => ({
    ...line,
    ...(line.baseCostRate === undefined && line.vendorCostValue !== undefined
      ? { baseCostRate: line.vendorCostValue }
      : {}),
    ...(Array.isArray(line.finishingStages)
      ? {
          finishingStages: line.finishingStages.map((stg) => ({
            ...stg,
            ...(stg.rate === undefined && stg.costValue !== undefined
              ? { rate: stg.costValue }
              : {}),
          })),
        }
      : {}),
  }));
  const qRes = await apiRequest(
    baseUrl,
    'POST',
    '/api/v1/print-quotes/quotes',
    {
      cookie: actor.cookie,
      csrfToken: actor.csrf,
      body: {
        title,
        customer_id: customerId ?? null,
        customer_name: customerName,
        status: 'FINALIZED',
        shipping_fee: shippingFee,
        extra_cost: extraCost,
        items: normalizedLines,
      },
    },
  );
  assert.equal(
    qRes.status,
    201,
    `Expected quote 201, got ${qRes.status}: ${JSON.stringify(qRes.body)}`,
  );
  const quote = qRes.body.data;

  const ordRes = await apiRequest(
    baseUrl,
    'POST',
    '/api/v1/print-quotes/orders',
    {
      cookie: actor.cookie,
      csrfToken: actor.csrf,
      body: {
        quote_id: quote.id,
        customer_id: customerId ?? undefined,
        ...(!customerId
          ? {
              quick_customer: {
                name: customerName || `Khách ${title}`,
              },
            }
          : {}),
        vendor_id: vendorId ?? null,
        deposit_required: depositRequired,
        due_date: '2026-11-20',
      },
    },
  );
  assert.equal(
    ordRes.status,
    201,
    `Expected order 201, got ${ordRes.status}: ${JSON.stringify(ordRes.body)}`,
  );
  return { quote, order: ordRes.body.data };
}

describe('MGL-PRINTQUOTE — Sổ Công Nợ Khách (AR), Công Nợ Xưởng (AP), Đa Xưởng, Đơn Hủy & Đối Soát Lịch Sử (Mandatory Tests #1..#10)', () => {
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

  it('Test #1: 1 sản phẩm, 1 xưởng, đặt cọc -> hoàn thành & xác nhận chi phí -> thu nốt -> trả xưởng (đối soát AR, AP, Lợi nhuận từng bước)', async () => {
    const { owner } = await seedWorkspaceActors(pool, 'T1');

    // Create customer & vendor
    const custRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/customers',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { name: 'Công ty TNHH Minh Anh', phone: '0901112233' },
      },
    );
    assert.equal(custRes.status, 201);
    const customer = custRes.body.data;

    const vendRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/vendors',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          name: 'Xưởng In Nhanh Sài Gòn',
          phone: '0909888777',
          bank_name: 'Vietcombank',
          bank_account_number: '0071001234567',
          bank_account_holder: 'XUONG IN NHANH SG',
        },
      },
    );
    assert.equal(vendRes.status, 201);
    const vendor = vendRes.body.data;

    // 1000 tờ A4: vốn 600.000đ + lời 400.000đ + ship 40.000đ = báo giá 1.040.000đ (Lời dự kiến = 400.000đ)
    const { order } = await createFinalizedQuoteAndOrder(baseUrl, owner, {
      title: 'Tờ rơi A4 C200 Minh Anh',
      customerId: customer.id,
      customerName: customer.name,
      vendorId: vendor.id,
      shippingFee: 40_000,
      extraCost: 0,
      depositRequired: 500_000,
      lines: [
        {
          name: 'Tờ rơi A4 C200 in 2 mặt',
          unit: 'tờ',
          quantity: 1000,
          vendorCostMode: VendorCostMode.PER_UNIT,
          vendorCostValue: 600,
          vendorId: vendor.id,
          vendorName: vendor.name,
          profitMode: ProfitMode.FIXED_AMOUNT,
          profitScope: ProfitScope.TOTAL_BATCH,
          profitValue: 400_000,
        },
      ],
    });
    assert.equal(order.total_quote_amount, 1_040_000);
    assert.equal(order.expected_profit, 400_000);

    // Step 1: Init workshop job from quote lines -> UNVERIFIED -> AP valid_payable = 0
    const initJobRes = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/orders/${order.id}/workshop-jobs/init`,
      { cookie: owner.cookie, csrfToken: owner.csrf, body: {} },
    );
    assert.equal(initJobRes.status, 201);
    assert.equal(initJobRes.body.data.items.length, 1);
    const job1 = initJobRes.body.data.items[0];
    assert.equal(job1.expected_cost, 600_000);
    assert.equal(job1.cost_status, 'UNVERIFIED');
    assert.equal(job1.valid_payable_amount, 0);

    // Step 2: Collect 500,000 VND deposit via AR ledger
    const depRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/receivables/receipts',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          customer_id: customer.id,
          receipt_subtype: 'DEPOSIT',
          amount: 500_000,
          payment_method: 'BANK_TRANSFER',
          reference_code: 'UNC-T1-DEP-01',
          allocations: [{ order_id: order.id, amount: 500_000 }],
        },
      },
    );
    assert.equal(depRes.status, 201);
    assert.equal(depRes.body.data.allocated_amount, 500_000);
    assert.equal(depRes.body.data.unallocated_amount, 0);

    // Verify report after deposit (before cost confirmation):
    // AR remaining = 540,000; AP valid = 0 (unconfirmed cost = 600,000); Reconciled orders = 0!
    const repAfterDep = (
      await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/financial-report',
        { cookie: owner.cookie },
      )
    ).body.data;
    assert.equal(repAfterDep.projected.expected_profit, 400_000);
    assert.equal(repAfterDep.reconciled.reconciled_orders_count, 0);
    assert.equal(repAfterDep.reconciled.reconciled_profit, 0);
    assert.equal(
      repAfterDep.cashflow_and_debt.valid_receivable_total,
      1_040_000,
    );
    assert.equal(
      repAfterDep.cashflow_and_debt.net_allocated_customer_receipt,
      500_000,
    );
    assert.equal(
      repAfterDep.cashflow_and_debt.remaining_receivable_total,
      540_000,
    );
    assert.equal(repAfterDep.cashflow_and_debt.valid_payable_total, 0);
    assert.equal(
      repAfterDep.cashflow_and_debt.expected_unconfirmed_workshop_cost_total,
      600_000,
    );

    // Step 3: Confirm workshop job actual cost = 580,000 VND (saved 20k vs expected) + confirm order shipping = 40,000, extra = 0
    const confJobRes = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/workshop-jobs/${job1.id}`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          job_status: 'COMPLETED',
          entered_cost: 580_000,
          confirm_cost: true,
        },
      },
    );
    assert.equal(confJobRes.status, 200);
    assert.equal(confJobRes.body.data.cost_status, 'CONFIRMED');
    assert.equal(confJobRes.body.data.valid_payable_amount, 580_000);
    assert.equal(confJobRes.body.data.remaining_payable_amount, 580_000);

    const confOrdRes = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/orders/${order.id}`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          production_status: 'COMPLETED',
          delivery_status: 'DELIVERED',
          entered_vendor_cost: 580_000,
          entered_shipping_fee: 40_000,
          entered_extra_cost: 0,
          actual_cost_confirmed: true,
        },
      },
    );
    assert.equal(confOrdRes.status, 200);
    assert.equal(confOrdRes.body.data.actual_cost_confirmed, true);
    assert.equal(confOrdRes.body.data.actual_profit, 420_000);

    // Notice: BEFORE paying vendor or collecting final customer installment, Reconciled Profit is ALREADY 420,000
    // AND Remaining Payable is STILL 580,000 (confirming actual cost NEVER marks vendor as paid!)
    const repAfterConf = (
      await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/financial-report',
        { cookie: owner.cookie },
      )
    ).body.data;
    assert.equal(repAfterConf.reconciled.reconciled_orders_count, 1);
    assert.equal(repAfterConf.reconciled.confirmed_total_revenue, 1_040_000);
    assert.equal(repAfterConf.reconciled.confirmed_vendor_cost, 580_000);
    assert.equal(repAfterConf.reconciled.confirmed_shipping_fee, 40_000);
    assert.equal(repAfterConf.reconciled.reconciled_profit, 420_000);
    assert.equal(repAfterConf.cashflow_and_debt.valid_payable_total, 580_000);
    assert.equal(repAfterConf.cashflow_and_debt.net_allocated_vendor_payout, 0);
    assert.equal(
      repAfterConf.cashflow_and_debt.remaining_payable_total,
      580_000,
    );

    // Step 4: Collect remaining 540,000 VND from customer -> Remaining AR = 0
    const finRecRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/receivables/receipts',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          customer_id: customer.id,
          receipt_subtype: 'FINAL',
          amount: 540_000,
          payment_method: 'QR_VIETQR',
          reference_code: 'UNC-T1-FIN-02',
          allocations: [{ order_id: order.id, amount: 540_000 }],
        },
      },
    );
    assert.equal(finRecRes.status, 201);

    // Step 5: Pay workshop 580,000 VND via AP ledger -> Remaining AP = 0
    const payVendRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/payables/payouts',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          vendor_id: vendor.id,
          payout_subtype: 'SETTLEMENT',
          amount: 580_000,
          payment_method: 'BANK_TRANSFER',
          reference_code: 'UNC-T1-AP-01',
          allocations: [{ workshop_job_id: job1.id, amount: 580_000 }],
        },
      },
    );
    assert.equal(payVendRes.status, 201);

    const repFinal = (
      await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/financial-report',
        { cookie: owner.cookie },
      )
    ).body.data;
    assert.equal(repFinal.cashflow_and_debt.remaining_receivable_total, 0);
    assert.equal(repFinal.cashflow_and_debt.remaining_payable_total, 0);
    assert.equal(
      repFinal.cashflow_and_debt.customer_cash_net_received,
      1_040_000,
    );
    assert.equal(repFinal.cashflow_and_debt.vendor_cash_net_paid, 580_000);
    assert.equal(repFinal.reconciled.reconciled_profit, 420_000);
  });

  it('Test #2: 2 sản phẩm, 2 xưởng (in + gia công), thu nhiều đợt, chi từng xưởng nhiều đợt; chặn chốt lợi nhuận đơn khi còn 1 xưởng chưa xác nhận', async () => {
    const { owner } = await seedWorkspaceActors(pool, 'T2');

    const cust = (
      await apiRequest(baseUrl, 'POST', '/api/v1/print-quotes/customers', {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { name: 'Thương hiệu Mỹ Phẩm ЛаВи', phone: '0912000111' },
      })
    ).body.data;

    const vendPrint = (
      await apiRequest(baseUrl, 'POST', '/api/v1/print-quotes/vendors', {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { name: 'Xưởng Offset Đông Á' },
      })
    ).body.data;

    const vendFinish = (
      await apiRequest(baseUrl, 'POST', '/api/v1/print-quotes/vendors', {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { name: 'Xưởng Gia Công Ép Kim Hoàng Gia' },
      })
    ).body.data;

    // 2 products using 2 workshops:
    // SP1: Hộp giấy (In Offset 1.200.000 + Ép kim Hoàng Gia 500.000 + Lời 600.000 = 2.300.000)
    // SP2: Tem nhãn (In Offset 400.000 + Lời 200.000 = 600.000)
    // Ship: 100.000 -> Tổng báo khách = 3.000.000 (Vốn dự kiến = 2.100.000 + ship 100.000, Lời dự kiến = 800.000)
    const { order } = await createFinalizedQuoteAndOrder(baseUrl, owner, {
      title: 'Bộ hộp + tem Mỹ Phẩm LaVi',
      customerId: cust.id,
      customerName: cust.name,
      vendorId: vendPrint.id,
      shippingFee: 100_000,
      extraCost: 0,
      lines: [
        {
          name: 'Hộp Ivory 350gsm',
          unit: 'hộp',
          quantity: 500,
          vendorCostMode: VendorCostMode.TOTAL_BATCH,
          vendorCostValue: 1_200_000,
          vendorId: vendPrint.id,
          vendorName: vendPrint.name,
          finishingStages: [
            {
              name: 'Ép kim logo nhũ vàng',
              unit: 'lô',
              pricingMode: VendorCostMode.TOTAL_BATCH,
              costValue: 500_000,
              vendorId: vendFinish.id,
              vendorName: vendFinish.name,
            },
          ],
          profitMode: ProfitMode.FIXED_AMOUNT,
          profitScope: ProfitScope.TOTAL_BATCH,
          profitValue: 600_000,
        },
        {
          name: 'Tem decal bể niêm phong',
          unit: 'tem',
          quantity: 1000,
          vendorCostMode: VendorCostMode.TOTAL_BATCH,
          vendorCostValue: 400_000,
          vendorId: vendPrint.id,
          vendorName: vendPrint.name,
          profitMode: ProfitMode.FIXED_AMOUNT,
          profitScope: ProfitScope.TOTAL_BATCH,
          profitValue: 200_000,
        },
      ],
    });
    assert.equal(order.total_quote_amount, 3_000_000);
    assert.equal(order.expected_vendor_cost, 2_100_000);
    assert.equal(order.expected_profit, 800_000);

    // Init workshop jobs -> automatically splits into 2 jobs (Offset Đông Á = 1,600,000; Ép Kim Hoàng Gia = 500,000)
    const initRes = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/orders/${order.id}/workshop-jobs/init`,
      { cookie: owner.cookie, csrfToken: owner.csrf, body: {} },
    );
    assert.equal(initRes.status, 201);
    const jobs = initRes.body.data.items;
    assert.equal(jobs.length, 2);
    const jobPrint = jobs.find((j) => j.vendor_id === vendPrint.id);
    const jobFinish = jobs.find((j) => j.vendor_id === vendFinish.id);
    assert.equal(jobPrint.expected_cost, 1_600_000);
    assert.equal(jobFinish.expected_cost, 500_000);

    // Confirm ONLY jobPrint (1,600,000), while jobFinish only has entered_cost (520,000) unconfirmed!
    await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/workshop-jobs/${jobPrint.id}`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { entered_cost: 1_600_000, confirm_cost: true },
      },
    );
    await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/workshop-jobs/${jobFinish.id}`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { entered_cost: 520_000 }, // NOT confirmed
      },
    );

    // Attempting to confirm order-level actual cost while jobFinish is unconfirmed MUST fail 400 INCOMPLETE_WORKSHOP_JOB_CONFIRMATION
    const prematureConfirm = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/orders/${order.id}`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          entered_shipping_fee: 100_000,
          entered_extra_cost: 0,
          actual_cost_confirmed: true,
        },
      },
    );
    assert.equal(prematureConfirm.status, 400);
    assert.equal(
      prematureConfirm.body.error.code,
      'INCOMPLETE_WORKSHOP_JOB_CONFIRMATION',
    );

    // Attempting to allocate AP payout directly to unconfirmed jobFinish MUST fail 409 JOB_COST_NOT_CONFIRMED
    const prematureAlloc = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/payables/payouts',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          vendor_id: vendFinish.id,
          amount: 200_000,
          allocations: [{ workshop_job_id: jobFinish.id, amount: 200_000 }],
        },
      },
    );
    assert.equal(prematureAlloc.status, 409);
    assert.equal(prematureAlloc.body.error.code, 'JOB_COST_NOT_CONFIRMED');

    // Pay Offset Đông Á in 2 installments (1,000,000 + 600,000) and collect customer in 2 installments (1,500,000 + 1,000,000)
    assert.equal(
      (
        await apiRequest(
          baseUrl,
          'POST',
          '/api/v1/print-quotes/payables/payouts',
          {
            cookie: owner.cookie,
            csrfToken: owner.csrf,
            body: {
              vendor_id: vendPrint.id,
              amount: 1_000_000,
              reference_code: 'UNC-T2-PA1',
              allocations: [
                { workshop_job_id: jobPrint.id, amount: 1_000_000 },
              ],
            },
          },
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await apiRequest(
          baseUrl,
          'POST',
          '/api/v1/print-quotes/payables/payouts',
          {
            cookie: owner.cookie,
            csrfToken: owner.csrf,
            body: {
              vendor_id: vendPrint.id,
              amount: 600_000,
              reference_code: 'UNC-T2-PA2',
              allocations: [{ workshop_job_id: jobPrint.id, amount: 600_000 }],
            },
          },
        )
      ).status,
      201,
    );

    await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/receivables/receipts',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          customer_id: cust.id,
          amount: 1_500_000,
          reference_code: 'UNC-T2-R1',
          allocations: [{ order_id: order.id, amount: 1_500_000 }],
        },
      },
    );
    await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/receivables/receipts',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          customer_id: cust.id,
          amount: 1_000_000,
          reference_code: 'UNC-T2-R2',
          allocations: [{ order_id: order.id, amount: 1_000_000 }],
        },
      },
    );

    // Now confirm jobFinish (520,000) and pay 300,000 first installment -> Remaining AP on Hoàng Gia = 220,000
    assert.equal(
      (
        await apiRequest(
          baseUrl,
          'PATCH',
          `/api/v1/print-quotes/workshop-jobs/${jobFinish.id}`,
          {
            cookie: owner.cookie,
            csrfToken: owner.csrf,
            body: { entered_cost: 520_000, confirm_cost: true },
          },
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await apiRequest(
          baseUrl,
          'POST',
          '/api/v1/print-quotes/payables/payouts',
          {
            cookie: owner.cookie,
            csrfToken: owner.csrf,
            body: {
              vendor_id: vendFinish.id,
              amount: 300_000,
              reference_code: 'UNC-T2-PB1',
              allocations: [{ workshop_job_id: jobFinish.id, amount: 300_000 }],
            },
          },
        )
      ).status,
      201,
    );

    // Confirm order shipping (100,000) & extra (0) -> Reconciled Profit = 3,000,000 - (1,600,000 + 520,000) - 100,000 = 780,000
    const finalOrd = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/orders/${order.id}`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          entered_shipping_fee: 100_000,
          entered_extra_cost: 0,
          actual_cost_confirmed: true,
        },
      },
    );
    assert.equal(finalOrd.status, 200);
    assert.equal(finalOrd.body.data.actual_vendor_cost, 2_120_000);
    assert.equal(finalOrd.body.data.actual_profit, 780_000);

    const apList = (
      await apiRequest(baseUrl, 'GET', '/api/v1/print-quotes/payables', {
        cookie: owner.cookie,
      })
    ).body.data;
    const sumPrint = apList.summaries.find((s) => s.vendor_id === vendPrint.id);
    const sumFinish = apList.summaries.find(
      (s) => s.vendor_id === vendFinish.id,
    );
    assert.equal(sumPrint.remaining_payable_total, 0);
    assert.equal(sumFinish.valid_payable_total, 520_000);
    assert.equal(sumFinish.net_allocated_payout_total, 300_000);
    assert.equal(sumFinish.remaining_payable_total, 220_000);

    const rep = (
      await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/financial-report',
        { cookie: owner.cookie },
      )
    ).body.data;
    assert.equal(rep.reconciled.reconciled_profit, 780_000);
    assert.equal(rep.cashflow_and_debt.remaining_receivable_total, 500_000);
    assert.equal(rep.cashflow_and_debt.remaining_payable_total, 220_000);
  });

  it('Test #3: 1 khoản thu khách phân bổ cho 2 đơn + còn tiền dư chưa phân bổ + chặn trùng chứng từ + phân bổ tiếp & hoàn tiền dư', async () => {
    const { owner } = await seedWorkspaceActors(pool, 'T3');

    const cust = (
      await apiRequest(baseUrl, 'POST', '/api/v1/print-quotes/customers', {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { name: 'Chuỗi Trà Sữa ZenTea' },
      })
    ).body.data;

    const mkOrd = async (title, amount) =>
      (
        await createFinalizedQuoteAndOrder(baseUrl, owner, {
          title,
          customerId: cust.id,
          customerName: cust.name,
          lines: [
            {
              name: title,
              unit: 'lô',
              quantity: 1,
              vendorCostMode: VendorCostMode.TOTAL_BATCH,
              vendorCostValue: amount - 200_000,
              profitMode: ProfitMode.FIXED_AMOUNT,
              profitScope: ProfitScope.TOTAL_BATCH,
              profitValue: 200_000,
            },
          ],
        })
      ).order;

    const ord1 = await mkOrd('Menu ZenTea Đợt 1', 1_000_000);
    const ord2 = await mkOrd('Voucher ZenTea Đợt 2', 900_000);
    const ord3 = await mkOrd('Standee ZenTea Đợt 3', 700_000);

    // 1 single receipt of 2,500,000 allocated to ord1 (1,000,000) + ord2 (900,000) -> 600,000 unallocated!
    const recRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/receivables/receipts',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          customer_id: cust.id,
          amount: 2_500_000,
          reference_code: 'UNC-ZENTEA-2M5',
          allocations: [
            { order_id: ord1.id, amount: 1_000_000 },
            { order_id: ord2.id, amount: 900_000 },
          ],
        },
      },
    );
    assert.equal(recRes.status, 201);
    const receipt = recRes.body.data;
    assert.equal(receipt.allocated_amount, 1_900_000);
    assert.equal(receipt.unallocated_amount, 600_000);

    // Duplicate reference_code without confirmation MUST fail 409 DUPLICATE_REFERENCE_CODE
    const dupRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/receivables/receipts',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          customer_id: cust.id,
          amount: 100_000,
          reference_code: '  unc-zentea-2m5  ',
          allocations: [],
        },
      },
    );
    assert.equal(dupRes.status, 409);
    assert.equal(dupRes.body.error.code, 'DUPLICATE_REFERENCE_CODE');

    // Allocate 400,000 of the unallocated 600,000 onto ord3 -> 200,000 left unallocated, ord3 remaining = 300,000
    const alloc3 = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/receivables/receipts/${receipt.id}/allocate`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          allocations: [{ order_id: ord3.id, amount: 400_000 }],
        },
      },
    );
    assert.equal(alloc3.status, 200);
    assert.equal(alloc3.body.data.allocated_amount, 2_300_000);
    assert.equal(alloc3.body.data.unallocated_amount, 200_000);

    // Refund remaining 200,000 unallocated advance back to customer
    const refAdv = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/receivables/refunds',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          customer_id: cust.id,
          source: 'UNALLOCATED_ADVANCE',
          amount: 200_000,
          reference_code: 'UNC-ZENTEA-REF200',
          reason: 'Hoàn trả tiền ứng dư cuối tháng theo yêu cầu khách',
        },
      },
    );
    assert.equal(refAdv.status, 201);

    const arData = (
      await apiRequest(baseUrl, 'GET', '/api/v1/print-quotes/receivables', {
        cookie: owner.cookie,
      })
    ).body.data;
    const sum = arData.summaries[0];
    assert.equal(sum.valid_receivable_total, 2_600_000);
    assert.equal(sum.net_allocated_receipt_total, 2_300_000);
    assert.equal(sum.remaining_receivable_total, 300_000);
    assert.equal(sum.unallocated_credit_total, 0);
  });

  it('Test #4: 1 khoản chi xưởng phân bổ cho 2 phiếu đặt xưởng + còn tạm ứng chưa phân bổ + xưởng hoàn tiền tạm ứng + đảo bút toán (VOID)', async () => {
    const { owner } = await seedWorkspaceActors(pool, 'T4');

    const vend = (
      await apiRequest(baseUrl, 'POST', '/api/v1/print-quotes/vendors', {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { name: 'Xưởng Bạt KTS Tân Bình' },
      })
    ).body.data;

    const mkConfirmedJob = async (title, cost) => {
      const { order } = await createFinalizedQuoteAndOrder(baseUrl, owner, {
        title,
        customerName: 'Khách Lẻ Sự Kiện',
        vendorId: vend.id,
        lines: [
          {
            name: title,
            unit: 'tấm',
            quantity: 10,
            vendorCostMode: VendorCostMode.TOTAL_BATCH,
            vendorCostValue: cost,
            vendorId: vend.id,
            vendorName: vend.name,
            profitMode: ProfitMode.FIXED_AMOUNT,
            profitScope: ProfitScope.TOTAL_BATCH,
            profitValue: 300_000,
          },
        ],
      });
      const init = await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/orders/${order.id}/workshop-jobs/init`,
        { cookie: owner.cookie, csrfToken: owner.csrf, body: {} },
      );
      const job = init.body.data.items[0];
      const conf = await apiRequest(
        baseUrl,
        'PATCH',
        `/api/v1/print-quotes/workshop-jobs/${job.id}`,
        {
          cookie: owner.cookie,
          csrfToken: owner.csrf,
          body: { entered_cost: cost, confirm_cost: true },
        },
      );
      return conf.body.data;
    };

    const jobA = await mkConfirmedJob('Backdrop Hội Nghị A', 700_000);
    const jobB = await mkConfirmedJob('Banner Đường Phố B', 500_000);

    // 1 vendor payout of 1,500,000 allocated to jobA (700k) + jobB (500k) -> 300k unallocated advance!
    const payoutRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/payables/payouts',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          vendor_id: vend.id,
          amount: 1_500_000,
          reference_code: 'UNC-T4-PAY1M5',
          allocations: [
            { workshop_job_id: jobA.id, amount: 700_000 },
            { workshop_job_id: jobB.id, amount: 500_000 },
          ],
        },
      },
    );
    assert.equal(payoutRes.status, 201);
    assert.equal(payoutRes.body.data.allocated_amount, 1_200_000);
    assert.equal(payoutRes.body.data.unallocated_amount, 300_000);

    // Vendor refunds 300,000 from unallocated advance
    const vendRef = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/payables/refunds',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          vendor_id: vend.id,
          source: 'UNALLOCATED_ADVANCE',
          amount: 300_000,
          reference_code: 'UNC-T4-VREF300',
          reason: 'Xưởng hoàn lại khoản tạm ứng dư không đặt in tiếp',
        },
      },
    );
    assert.equal(vendRef.status, 201);

    // Also test voiding a mistaken payout (with no refund attached) restores payable cleanly without deleting original row
    const jobC = await mkConfirmedJob('Phướn Khai Trương C', 400_000);
    const mistakenPayout = (
      await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/payables/payouts',
        {
          cookie: owner.cookie,
          csrfToken: owner.csrf,
          body: {
            vendor_id: vend.id,
            amount: 400_000,
            reference_code: 'UNC-T4-MISTAKEN',
            allocations: [{ workshop_job_id: jobC.id, amount: 400_000 }],
          },
        },
      )
    ).body.data;

    // Missing void reason MUST fail 400 REASON_REQUIRED
    const badVoid = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/payables/transactions/${mistakenPayout.id}/void`,
      { cookie: owner.cookie, csrfToken: owner.csrf, body: { reason: '   ' } },
    );
    assert.equal(badVoid.status, 400);
    assert.equal(badVoid.body.error.code, 'REASON_REQUIRED');

    const okVoid = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/payables/transactions/${mistakenPayout.id}/void`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { reason: 'Nhập nhầm UNC của tháng trước' },
      },
    );
    assert.equal(okVoid.status, 200);
    assert.equal(okVoid.body.data.tx_kind, 'REVERSAL');

    const apData = (
      await apiRequest(baseUrl, 'GET', '/api/v1/print-quotes/payables', {
        cookie: owner.cookie,
      })
    ).body.data;
    const sum = apData.summaries[0];
    assert.equal(sum.valid_payable_total, 1_600_000); // 700k + 500k + 400k
    assert.equal(sum.net_allocated_payout_total, 1_200_000); // jobC restored to unpaid!
    assert.equal(sum.remaining_payable_total, 400_000);
    assert.equal(sum.unallocated_advance_total, 0);
  });

  it('Test #5: Điều chỉnh giảm giá AR / trừ hàng lỗi AP sau thanh toán đủ (không âm nợ sai, ghi nhận credit trả thừa & hoàn tiền) + bắt buộc lý do khi sửa chi phí xưởng đã xác nhận', async () => {
    const { owner } = await seedWorkspaceActors(pool, 'T5');

    const cust = (
      await apiRequest(baseUrl, 'POST', '/api/v1/print-quotes/customers', {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { name: 'Nhà Hàng Hải Sản Biển Đông' },
      })
    ).body.data;
    const vend = (
      await apiRequest(baseUrl, 'POST', '/api/v1/print-quotes/vendors', {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { name: 'Xưởng Menu Da & Nhựa PVC' },
      })
    ).body.data;

    const { order } = await createFinalizedQuoteAndOrder(baseUrl, owner, {
      title: 'Menu nhựa chống nước',
      customerId: cust.id,
      customerName: cust.name,
      vendorId: vend.id,
      lines: [
        {
          name: 'Menu PVC đóng gáy lò xo',
          unit: 'cuốn',
          quantity: 50,
          vendorCostMode: VendorCostMode.TOTAL_BATCH,
          vendorCostValue: 800_000,
          vendorId: vend.id,
          vendorName: vend.name,
          profitMode: ProfitMode.FIXED_AMOUNT,
          profitScope: ProfitScope.TOTAL_BATCH,
          profitValue: 200_000,
        },
      ],
    });

    const job = (
      await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/orders/${order.id}/workshop-jobs/init`,
        { cookie: owner.cookie, csrfToken: owner.csrf, body: {} },
      )
    ).body.data.items[0];

    // Confirm job cost = 800,000
    await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/workshop-jobs/${job.id}`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { entered_cost: 800_000, confirm_cost: true },
      },
    );

    // Modifying an already CONFIRMED workshop job cost WITHOUT reason MUST fail 400 REASON_REQUIRED!
    const editNoReason = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/workshop-jobs/${job.id}`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { entered_cost: 790_000, confirm_cost: true },
      },
    );
    assert.equal(editNoReason.status, 400);
    assert.equal(editNoReason.body.error.code, 'REASON_REQUIRED');

    // Unconfirming without reason ALSO fails 400 REASON_REQUIRED!
    const unconfNoReason = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/workshop-jobs/${job.id}`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { confirm_cost: false },
      },
    );
    assert.equal(unconfNoReason.status, 400);
    assert.equal(unconfNoReason.body.error.code, 'REASON_REQUIRED');

    // Editing WITH non-empty reason succeeds and records COST_ADJUSTED in append-only history
    const editWithReason = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/workshop-jobs/${job.id}`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          entered_cost: 800_000,
          confirm_cost: true,
          reason: 'Xác nhận lại đúng hóa đơn xưởng 800.000đ',
        },
      },
    );
    assert.equal(editWithReason.status, 200);

    // Pay full AR (1,000,000) & full AP (800,000)
    await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/receivables/receipts',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          customer_id: cust.id,
          amount: 1_000_000,
          allocations: [{ order_id: order.id, amount: 1_000_000 }],
        },
      },
    );
    await apiRequest(baseUrl, 'POST', '/api/v1/print-quotes/payables/payouts', {
      cookie: owner.cookie,
      csrfToken: owner.csrf,
      body: {
        vendor_id: vend.id,
        amount: 800_000,
        allocations: [{ workshop_job_id: job.id, amount: 800_000 }],
      },
    });

    // Post-payment AR discount (-200,000) due to 5 scratched menus -> Valid AR becomes 800,000, Remaining AR = 0 (NOT -200,000!), Overpayment = 200,000
    const arAdjRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/receivables/adjustments',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          order_id: order.id,
          adjustment_type: 'RETURN_CREDIT',
          delta_amount: -200_000,
          reason: 'Giảm trừ 5 cuốn menu bị trầy gáy cho khách sau giao hàng',
        },
      },
    );
    assert.equal(arAdjRes.status, 201);

    // Post-payment AP defect deduction (-150,000) -> Valid AP becomes 650,000, Remaining AP = 0 (NOT -150,000!), Vendor Overpaid Credit = 150,000
    const apAdjRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/payables/adjustments',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          workshop_job_id: job.id,
          adjustment_type: 'DEFECT_DEDUCTION',
          delta_amount: -150_000,
          reason: 'Xưởng đồng ý trừ tiền lỗi cán màng 5 cuốn menu',
        },
      },
    );
    assert.equal(apAdjRes.status, 201);

    const ordAfterAdj = (
      await apiRequest(
        baseUrl,
        'GET',
        `/api/v1/print-quotes/orders/${order.id}`,
        { cookie: owner.cookie },
      )
    ).body.data;
    assert.equal(ordAfterAdj.valid_receivable_amount, 800_000);
    assert.equal(ordAfterAdj.remaining_debt_amount, 0);

    // Over-refunding 200,001 on ORDER_OVERPAYMENT MUST fail 400
    assert.equal(
      (
        await apiRequest(
          baseUrl,
          'POST',
          '/api/v1/print-quotes/receivables/refunds',
          {
            cookie: owner.cookie,
            csrfToken: owner.csrf,
            body: {
              source: 'ORDER_OVERPAYMENT',
              order_id: order.id,
              amount: 200_001,
              reason: 'Thử hoàn vượt số tiền khách trả thừa',
            },
          },
        )
      ).status,
      400,
    );

    // Exact refund 200,000 to customer & 150,000 refund received from vendor succeed cleanly
    assert.equal(
      (
        await apiRequest(
          baseUrl,
          'POST',
          '/api/v1/print-quotes/receivables/refunds',
          {
            cookie: owner.cookie,
            csrfToken: owner.csrf,
            body: {
              source: 'ORDER_OVERPAYMENT',
              order_id: order.id,
              amount: 200_000,
              reason: 'Hoàn trả tiền giảm giá 5 cuốn menu lỗi cho khách',
            },
          },
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await apiRequest(
          baseUrl,
          'POST',
          '/api/v1/print-quotes/payables/refunds',
          {
            cookie: owner.cookie,
            csrfToken: owner.csrf,
            body: {
              source: 'JOB_OVERPAYMENT',
              workshop_job_id: job.id,
              amount: 150_000,
              reason: 'Nhận tiền xưởng hoàn lại khoản khấu trừ hàng lỗi',
            },
          },
        )
      ).status,
      201,
    );

    const rep = (
      await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/financial-report',
        { cookie: owner.cookie },
      )
    ).body.data;
    assert.equal(rep.cashflow_and_debt.valid_receivable_total, 800_000);
    assert.equal(rep.cashflow_and_debt.customer_cash_net_received, 800_000);
    assert.equal(rep.cashflow_and_debt.remaining_receivable_total, 0);
    assert.equal(rep.cashflow_and_debt.valid_payable_total, 650_000);
    assert.equal(rep.cashflow_and_debt.vendor_cash_net_paid, 650_000);
    assert.equal(rep.cashflow_and_debt.remaining_payable_total, 0);
  });

  it('Test #6: Đơn hủy sau đặt cọc và đã phát sinh chi phí xưởng — giữ ở diện chờ quyết toán (không tự giả định hoàn 100% hay phí 100%), chốt quyết toán & hoàn tiền đúng thỏa thuận', async () => {
    const { owner } = await seedWorkspaceActors(pool, 'T6');

    const cust = (
      await apiRequest(baseUrl, 'POST', '/api/v1/print-quotes/customers', {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { name: 'Sự Kiện Ánh Sao' },
      })
    ).body.data;
    const vend = (
      await apiRequest(baseUrl, 'POST', '/api/v1/print-quotes/vendors', {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { name: 'Xưởng Standee & POSM Quận 10' },
      })
    ).body.data;

    const { order } = await createFinalizedQuoteAndOrder(baseUrl, owner, {
      title: 'Bộ POSM Sự Kiện Ánh Sao',
      customerId: cust.id,
      customerName: cust.name,
      vendorId: vend.id,
      lines: [
        {
          name: 'Booth sampling + Standee',
          unit: 'bộ',
          quantity: 5,
          vendorCostMode: VendorCostMode.TOTAL_BATCH,
          vendorCostValue: 1_500_000,
          vendorId: vend.id,
          vendorName: vend.name,
          profitMode: ProfitMode.FIXED_AMOUNT,
          profitScope: ProfitScope.TOTAL_BATCH,
          profitValue: 900_000,
        },
      ],
    });

    const job = (
      await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/orders/${order.id}/workshop-jobs/init`,
        { cookie: owner.cookie, csrfToken: owner.csrf, body: {} },
      )
    ).body.data.items[0];

    // Customer deposits 1,200,000; workshop incurred 500,000 confirmed cost before cancellation; already paid workshop 300,000
    await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/receivables/receipts',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          customer_id: cust.id,
          receipt_subtype: 'DEPOSIT',
          amount: 1_200_000,
          allocations: [{ order_id: order.id, amount: 1_200_000 }],
        },
      },
    );
    await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/workshop-jobs/${job.id}`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { entered_cost: 500_000, confirm_cost: true },
      },
    );
    await apiRequest(baseUrl, 'POST', '/api/v1/print-quotes/payables/payouts', {
      cookie: owner.cookie,
      csrfToken: owner.csrf,
      body: {
        vendor_id: vend.id,
        amount: 300_000,
        allocations: [{ workshop_job_id: job.id, amount: 300_000 }],
      },
    });

    // Cancel the order (confirming incurred cost 500k, shipping 0, extra 0)
    const cancelRes = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/orders/${order.id}`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          production_status: 'CANCELLED',
          entered_vendor_cost: 500_000,
          entered_shipping_fee: 0,
          entered_extra_cost: 0,
          actual_cost_confirmed: true,
        },
      },
    );
    assert.equal(cancelRes.status, 200);
    assert.equal(
      cancelRes.body.data.cancellation_settlement_status,
      'PENDING_SETTLEMENT',
    );

    // Before settlement: report shows 1 pending cancelled order holding 1,200,000, 0 reconciled orders, and 200,000 remaining vendor payable!
    const repPending = (
      await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/financial-report',
        { cookie: owner.cookie },
      )
    ).body.data;
    assert.equal(
      repPending.cancelled_and_pending.pending_settlement_orders_count,
      1,
    );
    assert.equal(
      repPending.cancelled_and_pending.customer_holding_pending_decision,
      1_200_000,
    );
    assert.equal(
      repPending.cancelled_and_pending.cancelled_vendor_remaining_payable,
      200_000,
    );
    assert.equal(repPending.reconciled.reconciled_orders_count, 0);

    // Refunding via AR ledger BEFORE cancellation settlement MUST be blocked (409 CANCELLATION_SETTLEMENT_REQUIRED)
    const prematureRefund = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/receivables/refunds',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          source: 'CANCELLED_ORDER',
          order_id: order.id,
          amount: 700_000,
          reason: 'Hoàn cọc khi chưa chốt quyết toán',
        },
      },
    );
    assert.equal(prematureRefund.status, 409);
    assert.equal(
      prematureRefund.body.error.code,
      'CANCELLATION_SETTLEMENT_REQUIRED',
    );

    // Settlement where agreed_refund + retained_fee != 1,200,000 MUST fail 400
    assert.equal(
      (
        await apiRequest(
          baseUrl,
          'POST',
          `/api/v1/print-quotes/orders/${order.id}/cancel-settlement`,
          {
            cookie: owner.cookie,
            csrfToken: owner.csrf,
            body: {
              agreed_customer_refund_amount: 600_000,
              retained_cancellation_fee: 500_000,
              reason: 'Tổng lệch 1.100.000 != 1.200.000',
            },
          },
        )
      ).status,
      400,
    );

    // Settle cancelled order: refund 700,000 + retain 500,000 fee = 1,200,000
    const settleRes = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/orders/${order.id}/cancel-settlement`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          agreed_customer_refund_amount: 700_000,
          retained_cancellation_fee: 500_000,
          reason:
            'Khách báo hủy sự kiện; thống nhất giữ lại 500k bù tiền in bạt đã chạy, hoàn lại 700k',
        },
      },
    );
    assert.equal(settleRes.status, 201);

    // Execute customer refund of 700,000
    const refOk = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/receivables/refunds',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          source: 'CANCELLED_ORDER',
          order_id: order.id,
          amount: 700_000,
          reference_code: 'UNC-T6-REFCANCEL',
          reason: 'Chi hoàn cọc 700k theo biên bản hủy đơn',
        },
      },
    );
    assert.equal(refOk.status, 201);

    const repSettled = (
      await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/financial-report',
        { cookie: owner.cookie },
      )
    ).body.data;
    assert.equal(
      repSettled.cancelled_and_pending.settled_cancelled_orders_count,
      1,
    );
    assert.equal(
      repSettled.cancelled_and_pending.agreed_customer_refund_remaining,
      0,
    );
    assert.equal(
      repSettled.cancelled_and_pending.retained_cancellation_fee_total,
      500_000,
    );
    // Remaining AP to workshop stays 200,000 (500k incurred - 300k paid)!
    assert.equal(repSettled.cashflow_and_debt.remaining_payable_total, 200_000);
    // Reconciled profit of cancelled order = 500k retained fee - 500k confirmed cost = 0!
    assert.equal(repSettled.reconciled.reconciled_orders_count, 1);
    assert.equal(
      repSettled.reconciled.confirmed_cancellation_fee_revenue,
      500_000,
    );
    assert.equal(repSettled.reconciled.reconciled_profit, 0);
  });

  it('Test #7: Nhập lịch sử 2 Google Sheet (RIÊNG & HVGROUP) có ô trống, thiếu số tiền/chứng từ, tổng tiền hàng không tự thành nợ, dòng trùng, lưu nguồn Sheet/Tab/Dòng & không tự gộp sổ', async () => {
    const { owner } = await seedWorkspaceActors(pool, 'T7');

    // Sheet 1 (Tab RIÊNG):
    // Row 2: Hợp lệ có chứng từ (Khách An Phát nợ đầu kỳ 1.800.000) -> READY
    // Row 3: Ô số tiền trống hoàn toàn -> EMPTY_CELL_NOT_ZERO + MISSING_AMOUNT -> UNDECIDED
    // Row 4: Có tổng tiền hàng 5.000.000 nhưng ô công nợ trống -> TOTAL_GOODS_NOT_AUTO_DEBT -> UNDECIDED
    // Row 5: Xưởng Gia Công Hùng Vương phải trả 950.000 nhưng thiếu mã chứng từ -> MISSING_VOUCHER -> UNDECIDED
    // Row 6: Dòng trùng y hệt Row 2 trong cùng lô -> DUPLICATE_IN_BATCH -> SKIP
    const sheet1Tsv = [
      'Đối tượng\tVai trò\tTổng tiền hàng\tCông nợ còn lại\tMã chứng từ\tNgày\tGhi chú',
      'Công ty An Phát\tKhách hàng\t4.500.000\t1.800.000\tCT-RIENG-01\t15/10/2026\tCông nợ tồn tháng 10',
      'Shop Thời Trang Mây\tKhách hàng\t\t\tCT-RIENG-02\t16/10/2026\tÔ số tiền để trống chưa chốt',
      'Thẩm Mỹ Viện Ngọc Lan\tKhách hàng\t5.000.000\t\tCT-RIENG-03\t17/10/2026\tCó tổng đơn nhưng chưa rõ đã thu chưa',
      'Xưởng Bế Hùng Vương\tXưởng in\t2.200.000\t950.000\t\t18/10/2026\tCòn nợ tiền khuôn bế',
      'Công ty An Phát\tKhách hàng\t4.500.000\t1.800.000\tCT-RIENG-01\t15/10/2026\tDòng copy trùng',
    ].join('\n');

    const prev1Res = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/import-history/preview',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          source_sheet_name: 'Google Sheet 1 - Sổ In Ấn Nội Bộ',
          source_tab_name: 'CongNo_RIENG',
          default_ledger_scope: 'RIENG',
          raw_text: sheet1Tsv,
        },
      },
    );
    assert.equal(prev1Res.status, 201);
    const batch1 = prev1Res.body.data;
    assert.equal(batch1.total_rows, 5);
    assert.equal(batch1.ready_rows_count, 1);
    assert.equal(batch1.duplicate_rows_count, 1);
    assert.equal(batch1.needs_confirmation_rows_count, 3);

    const r2 = batch1.rows.find((r) => r.source_row_number === 2);
    const r3 = batch1.rows.find((r) => r.source_row_number === 3);
    const r4 = batch1.rows.find((r) => r.source_row_number === 4);
    const r5 = batch1.rows.find((r) => r.source_row_number === 5);
    const r6 = batch1.rows.find((r) => r.source_row_number === 6);

    assert.equal(r2.row_status, 'READY');
    assert.equal(r2.owner_resolution, 'IMPORT_OPENING_RECEIVABLE');
    // Blank cell MUST NOT be coerced to 0!
    assert.equal(r3.parsed_amount, null);
    assert(r3.flags.includes('EMPTY_CELL_NOT_ZERO'));
    assert.equal(r3.owner_resolution, 'UNDECIDED');
    // Total goods without debt MUST NOT be assumed as unpaid debt!
    assert.equal(r4.parsed_goods_total, 5_000_000);
    assert.equal(r4.parsed_amount, null);
    assert(r4.flags.includes('TOTAL_GOODS_NOT_AUTO_DEBT'));
    assert.equal(r4.owner_resolution, 'UNDECIDED');
    // Missing voucher MUST require confirmation!
    assert(r5.flags.includes('MISSING_VOUCHER'));
    assert.equal(r5.owner_resolution, 'UNDECIDED');
    // Duplicate in batch flagged & defaulted to SKIP
    assert(r6.flags.includes('DUPLICATE_IN_BATCH'));
    assert.equal(r6.owner_resolution, 'SKIP');

    // Confirming while UNDECIDED rows remain MUST fail 400 UNRESOLVED_IMPORT_ROWS
    const prematureConfirm = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/import-history/batches/${batch1.id}/confirm`,
      { cookie: owner.cookie, csrfToken: owner.csrf, body: {} },
    );
    assert.equal(prematureConfirm.status, 400);
    assert.equal(prematureConfirm.body.error.code, 'UNRESOLVED_IMPORT_ROWS');

    // Owner explicitly resolves rows 3, 4, 5:
    await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/import-history/batches/${batch1.id}/rows/${r3.id}`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { owner_resolution: 'HOLD_FOR_REVIEW' },
      },
    );
    await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/import-history/batches/${batch1.id}/rows/${r4.id}`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { owner_resolution: 'SKIP' },
      },
    );
    await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/import-history/batches/${batch1.id}/rows/${r5.id}`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          owner_resolution: 'IMPORT_OPENING_PAYABLE',
          voucher_code: 'XN-HV-20261018',
        },
      },
    );

    const conf1 = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/import-history/batches/${batch1.id}/confirm`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { auto_create_missing_vendors: true },
      },
    );
    assert.equal(conf1.status, 200);
    assert.equal(conf1.body.data.imported_rows_count, 2);

    // Sheet 2 (Tab HVGROUP) — includes 1 row identical to Sheet 1 Row 2 + 1 HVGROUP customer receivable (3,200,000) + 1 HVGROUP customer advance (600,000)
    const sheet2Tsv = [
      'Đối tượng\tVai trò\tCông nợ còn lại\tMã chứng từ\tNgày\tGhi chú',
      'Công ty An Phát\tKhách hàng\t1.800.000\tCT-RIENG-01\t15/10/2026\tCopy nhầm từ Sheet 1',
      'Tập Đoàn HVGroup Chi Nhánh 1\tKhách hàng\t3.200.000\tHV-AR-101\t20/10/2026\tPhải thu HVGroup đầu kỳ',
      'Đối Tác HVGroup Sự Kiện\tKhách hàng\t600.000\tHV-ADV-102\t21/10/2026\tKhách ứng trước dư chưa gán đơn',
    ].join('\n');

    const prev2Res = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/import-history/preview',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          source_sheet_name: 'Google Sheet 2 - Đối Soát HVGROUP',
          source_tab_name: 'HVGROUP_T10',
          default_ledger_scope: 'HVGROUP',
          raw_text: sheet2Tsv,
        },
      },
    );
    assert.equal(prev2Res.status, 201);
    const batch2 = prev2Res.body.data;
    // Note: row 2 in Sheet 2 has scope HVGROUP unless tagged RIENG, let's also test cross-batch exact duplicate detection by previewing Sheet 1 again!
    const prevDupSheet1 = (
      await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/import-history/preview',
        {
          cookie: owner.cookie,
          csrfToken: owner.csrf,
          body: {
            source_sheet_name: 'Google Sheet 1 - Sổ In Ấn Nội Bộ',
            source_tab_name: 'CongNo_RIENG',
            default_ledger_scope: 'RIENG',
            raw_text: [
              'Đối tượng\tVai trò\tCông nợ còn lại\tMã chứng từ\tNgày',
              'Công ty An Phát\tKhách hàng\t1.800.000\tCT-RIENG-01\t15/10/2026',
            ].join('\n'),
          },
        },
      )
    ).body.data;
    assert(
      prevDupSheet1.rows[0].flags.includes('DUPLICATE_EXISTING_ROW'),
      'Cross-batch duplicate row must be flagged DUPLICATE_EXISTING_ROW',
    );
    assert.equal(prevDupSheet1.rows[0].owner_resolution, 'SKIP');

    // On Sheet 2: skip row 2 ("Copy nhầm từ Sheet 1"), import row 3 as HVGROUP opening receivable, row 4 as HVGROUP customer advance
    const s2r2 = batch2.rows.find((r) => r.source_row_number === 2);
    const s2r4 = batch2.rows.find((r) => r.source_row_number === 4);
    await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/import-history/batches/${batch2.id}/rows/${s2r2.id}`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { owner_resolution: 'SKIP' },
      },
    );
    await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/import-history/batches/${batch2.id}/rows/${s2r4.id}`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { owner_resolution: 'IMPORT_CUSTOMER_ADVANCE' },
      },
    );
    const conf2 = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/import-history/batches/${batch2.id}/confirm`,
      { cookie: owner.cookie, csrfToken: owner.csrf, body: {} },
    );
    assert.equal(conf2.status, 200);
    assert.equal(conf2.body.data.imported_rows_count, 2);

    // Verify Sheet / Tab / Row provenance & strict separation between RIENG and HVGROUP!
    const obs = (
      await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/opening-balances',
        { cookie: owner.cookie },
      )
    ).body.data.items;
    const obRiengAr = obs.find(
      (o) =>
        o.ledger_scope === 'RIENG' && o.direction === 'CUSTOMER_RECEIVABLE',
    );
    assert.equal(
      obRiengAr.source_sheet_name,
      'Google Sheet 1 - Sổ In Ấn Nội Bộ',
    );
    assert.equal(obRiengAr.source_tab_name, 'CongNo_RIENG');
    assert.equal(obRiengAr.source_row_number, 2);
    assert.equal(obRiengAr.remaining_amount, 1_800_000);

    // Trying to allocate HVGROUP advance onto RIENG opening balance MUST fail 400 SCOPE_MISMATCH!
    const hvReceipts = (
      await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/receivables?ledger_scope=HVGROUP',
        { cookie: owner.cookie },
      )
    ).body.data.transactions;
    assert.equal(hvReceipts.length, 1);
    const crossScopeAlloc = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/receivables/receipts/${hvReceipts[0].id}/allocate`,
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          allocations: [{ opening_balance_id: obRiengAr.id, amount: 500_000 }],
        },
      },
    );
    assert.equal(crossScopeAlloc.status, 400);
    assert.equal(crossScopeAlloc.body.error.code, 'SCOPE_MISMATCH');

    const rep = (
      await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/financial-report',
        { cookie: owner.cookie },
      )
    ).body.data;
    assert.equal(rep.by_ledger_scope.RIENG.remaining_receivable, 1_800_000);
    assert.equal(rep.by_ledger_scope.RIENG.remaining_payable, 950_000);
    assert.equal(rep.by_ledger_scope.HVGROUP.remaining_receivable, 3_200_000);
    assert.equal(rep.by_ledger_scope.HVGROUP.customer_unallocated, 600_000);
    assert.equal(rep.by_ledger_scope.GENERAL.remaining_receivable, 0);
  });

  it('Test #8: Migration 0036 trên bản sao DB có báo giá & đơn cũ — giữ nguyên integrity_hash, đưa payment cũ vào hàng đợi chờ đối chiếu (KHÔNG tự ghi POSTED AR), KHÔNG tự chuyển vendor_paid_amount sang AP, kiểm chứng rollback & quyền bất biến hp_app_runtime', async () => {
    const baseCfg = loadTestDatabaseConfig();
    const parsedUrl = new URL(baseCfg.connectionString);
    const adminPw = (
      await fs.readFile('C:\\ML-Test\\secrets\\admin.pw', 'utf8')
    ).trim();
    const tempDbName = `mglite_mig0036_test_${crypto.randomUUID().slice(0, 8)}`;

    const adminPool = createDatabasePool({
      host: parsedUrl.hostname,
      port: Number(parsedUrl.port || 55433),
      user: 'ml_test_admin',
      password: adminPw,
      database: 'postgres',
      max: 2,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });
    await adminPool.query(
      `CREATE DATABASE "${tempDbName}" OWNER ml_test_admin`,
    );

    const tempPool = createDatabasePool({
      host: parsedUrl.hostname,
      port: Number(parsedUrl.port || 55433),
      user: 'ml_test_admin',
      password: adminPw,
      database: tempDbName,
      max: 4,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 5_000,
    });

    try {
      const allMigs = await loadMigrationFiles();
      const pre0036 = allMigs.filter((m) => m.id < '0036_');
      const upTo0036 = allMigs.filter((m) => m.id < '0037_');
      await runMigrations(tempPool, pre0036);

      // Ensure hp_app_runtime exists to verify least-privilege grants
      await tempPool.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hp_app_runtime') THEN
            CREATE ROLE hp_app_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
          END IF;
        END $$;
      `);

      // Seed legacy pre-0036 quote + snapshot hash + order with customer deposit (400,000) AND legacy vendor_paid_amount = 450,000
      const wsId = crypto.randomUUID();
      const userId = crypto.randomUUID();
      const quoteId = crypto.randomUUID();
      const qVerId = crypto.randomUUID();
      const orderId = crypto.randomUUID();
      const legacyPayId = crypto.randomUUID();

      const calc = calculatePrintQuote({
        quoteId: 'BG-LEG-0036',
        customerName: 'Khách Trước 0036',
        shippingFee: 50_000,
        extraCost: 0,
        items: [
          {
            id: 'L1',
            name: 'Catalogue A4',
            unit: 'cuốn',
            quantity: 100,
            vendorCostMode: VendorCostMode.PER_UNIT,
            baseCostRate: 8_000,
            profit: {
              mode: ProfitMode.FIXED_AMOUNT,
              scope: ProfitScope.TOTAL_BATCH,
              value: 350_000,
            },
          },
        ],
      });
      const snap = createQuoteOrderSnapshot(calc, {
        orderId: 'SNAP-BG-LEG-0036-V1',
        status: 'CONVERTED',
      });
      assert.equal(verifyQuoteSnapshotIntegrity(snap), true);

      await tempPool.query(
        `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, 'Legacy Pre-0036 WS', 'Asia/Ho_Chi_Minh', 'active')`,
        [wsId],
      );
      await tempPool.query(
        `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, 'leg0036', 'leg0036@mglite.local', 'active')`,
        [userId],
      );
      await tempPool.query(
        `INSERT INTO print_quotes (
           id, workspace_id, quote_code, title, customer_name, status, current_version,
           total_quantity, total_vendor_cost, total_profit, shipping_fee, total_extra_cost,
           total_quote_amount, total_rounding_adjustment, lines_json, snapshot_json, customer_pdf_json, integrity_hash, created_by
         ) VALUES ($1, $2, 'BG-LEG-0036', 'Catalogue cũ', 'Khách Trước 0036', 'CONVERTED', 1, 100, 800000, 350000, 50000, 0, 1200000, 0, $3::jsonb, $4::jsonb, '{}'::jsonb, $5, $6)`,
        [
          quoteId,
          wsId,
          JSON.stringify(snap.lines),
          JSON.stringify(snap),
          snap.integrityHash,
          userId,
        ],
      );
      await tempPool.query(
        `INSERT INTO print_quote_versions (
           id, workspace_id, quote_id, version_number, status, total_quantity,
           total_vendor_cost, total_profit, shipping_fee, total_extra_cost,
           total_quote_amount, total_rounding_adjustment, snapshot_json, customer_pdf_json, integrity_hash, created_by
         ) VALUES ($1, $2, $3, 1, 'CONVERTED', 100, 800000, 350000, 50000, 0, 1200000, 0, $4::jsonb, '{}'::jsonb, $5, $6)`,
        [
          qVerId,
          wsId,
          quoteId,
          JSON.stringify(snap),
          snap.integrityHash,
          userId,
        ],
      );
      await tempPool.query(
        `INSERT INTO print_orders (
           id, workspace_id, order_code, quote_id, quote_code, quote_version, customer_name, title,
           total_quote_amount, expected_vendor_cost, actual_vendor_cost,
           expected_shipping_fee, actual_shipping_fee, expected_extra_cost, actual_extra_cost,
           expected_profit, actual_profit, deposit_paid, total_paid_amount, remaining_debt_amount,
           payment_status, vendor_paid_amount, snapshot_json, integrity_hash, created_by
         ) VALUES (
           $1, $2, 'DH-LEG-0036', $3, 'BG-LEG-0036', 1, 'Khách Trước 0036', 'Catalogue cũ',
           1200000, 800000, 0,
           50000, 0, 0, 0,
           350000, 0, 400000, 400000, 800000,
           'DEPOSIT_PAID', 450000, $4::jsonb, $5, $6
         )`,
        [
          orderId,
          wsId,
          quoteId,
          JSON.stringify(snap),
          snap.integrityHash,
          userId,
        ],
      );
      await tempPool.query(
        `INSERT INTO print_order_payments (
           id, workspace_id, order_id, payment_type, amount, payment_method, reference_code, note, recorded_by
         ) VALUES ($1, $2, $3, 'DEPOSIT', 400000, 'BANK_TRANSFER', 'LEG-DEP-400', 'Đặt cọc cũ trước 0036', $4)`,
        [legacyPayId, wsId, orderId, userId],
      );

      // Apply 0036 forward!
      const migRes = await runMigrations(tempPool, upTo0036);
      assert.equal(migRes.appliedCount, 1);

      // 1. Quote snapshot & integrity hash 100% untouched
      const qCheck = await tempPool.query(
        `SELECT snapshot_json, integrity_hash FROM print_quotes WHERE id = $1`,
        [quoteId],
      );
      assert.equal(qCheck.rows[0].integrity_hash, snap.integrityHash);
      assert.equal(
        verifyQuoteSnapshotIntegrity(qCheck.rows[0].snapshot_json),
        true,
      );

      // 2. Legacy customer payment MUST NOT auto-create POSTED AR transactions/allocations — queued in PENDING reconciliation!
      const arCheck = await tempPool.query(
        `SELECT * FROM print_ar_transactions WHERE workspace_id = $1`,
        [wsId],
      );
      assert.equal(arCheck.rows.length, 0);
      const arAllocCheck = await tempPool.query(
        `SELECT COUNT(*)::int AS cnt FROM print_ar_allocations WHERE workspace_id = $1`,
        [wsId],
      );
      assert.equal(arAllocCheck.rows[0].cnt, 0);

      const recQueueCheck = await tempPool.query(
        `SELECT r.status, r.anomaly_codes, r.pre_reconciliation_json, p.amount, p.payment_type
         FROM print_legacy_ar_reconciliations r
         JOIN print_order_payments p ON p.id = r.legacy_payment_id
         WHERE r.workspace_id = $1 AND r.legacy_payment_id = $2`,
        [wsId, legacyPayId],
      );
      assert.equal(recQueueCheck.rows.length, 1);
      assert.equal(recQueueCheck.rows[0].status, 'PENDING');
      assert.equal(Number(recQueueCheck.rows[0].amount), 400_000);
      assert.equal(recQueueCheck.rows[0].payment_type, 'DEPOSIT');
      assert.ok(
        Array.isArray(recQueueCheck.rows[0].anomaly_codes) &&
          recQueueCheck.rows[0].anomaly_codes.includes('MISSING_CUSTOMER_ID'),
      );
      assert.equal(
        Number(
          recQueueCheck.rows[0].pre_reconciliation_json
            .pre0036_total_paid_snapshot,
        ),
        400_000,
      );
      assert.equal(
        Number(
          recQueueCheck.rows[0].pre_reconciliation_json
            .pre0036_remaining_debt_snapshot,
        ),
        800_000,
      );

      // 3. Legacy vendor_paid_amount (450,000) MUST NOT auto-create AP payouts!
      const apCheck = await tempPool.query(
        `SELECT COUNT(*)::int AS cnt FROM print_ap_transactions WHERE workspace_id = $1`,
        [wsId],
      );
      assert.equal(apCheck.rows[0].cnt, 0);
      const ordCheck = await tempPool.query(
        `SELECT valid_receivable_amount, remaining_debt_amount, vendor_paid_amount, legacy_vendor_paid_reconciled, legacy_ar_reconciliation_status
         FROM print_orders WHERE id = $1`,
        [orderId],
      );
      assert.equal(Number(ordCheck.rows[0].valid_receivable_amount), 1_200_000);
      assert.equal(Number(ordCheck.rows[0].remaining_debt_amount), 800_000);
      assert.equal(Number(ordCheck.rows[0].vendor_paid_amount), 450_000);
      assert.equal(ordCheck.rows[0].legacy_vendor_paid_reconciled, false);
      assert.equal(ordCheck.rows[0].legacy_ar_reconciliation_status, 'PENDING');

      // 4. Verify hp_app_runtime privileges: NO UPDATE/DELETE on append-only tables, NO DELETE on financial headers/reconciliation queue
      const privRes = await tempPool.query(`
        SELECT
          has_table_privilege('hp_app_runtime', 'print_workshop_job_history', 'UPDATE') AS jh_upd,
          has_table_privilege('hp_app_runtime', 'print_workshop_job_history', 'DELETE') AS jh_del,
          has_table_privilege('hp_app_runtime', 'print_ar_allocations', 'UPDATE') AS ara_upd,
          has_table_privilege('hp_app_runtime', 'print_ar_allocations', 'DELETE') AS ara_del,
          has_table_privilege('hp_app_runtime', 'print_ap_allocations', 'UPDATE') AS apa_upd,
          has_table_privilege('hp_app_runtime', 'print_ap_allocations', 'DELETE') AS apa_del,
          has_table_privilege('hp_app_runtime', 'print_legacy_ar_reconciliation_history', 'UPDATE') AS lrh_upd,
          has_table_privilege('hp_app_runtime', 'print_legacy_ar_reconciliation_history', 'DELETE') AS lrh_del,
          has_table_privilege('hp_app_runtime', 'print_legacy_ar_reconciliations', 'DELETE') AS lr_del,
          has_table_privilege('hp_app_runtime', 'print_order_cancellation_settlements', 'UPDATE') AS cs_upd,
          has_table_privilege('hp_app_runtime', 'print_ar_transactions', 'DELETE') AS artx_del,
          has_table_privilege('hp_app_runtime', 'print_ap_transactions', 'DELETE') AS aptx_del
      `);
      for (const [k, val] of Object.entries(privRes.rows[0])) {
        assert.equal(val, false, `Expected privilege ${k} to be false`);
      }

      // Also verify DB-level append-only trigger blocks even superuser UPDATE/DELETE on print_ar_allocations & print_legacy_ar_reconciliation_history!
      await assert.rejects(
        () =>
          tempPool.query(
            `DELETE FROM print_legacy_ar_reconciliation_history WHERE workspace_id = $1`,
            [wsId],
          ),
        /append-only/,
      );

      // 5. Rollback cleanly when legacy queue is untouched PENDING -> succeeds & preserves print_order_payments!
      const rollbackSql = await fs.readFile(
        path.join(
          REPO_ROOT,
          'scripts/db/rollback-0036-printquote-ar-ap-ledger.sql',
        ),
        'utf8',
      );
      await tempPool.query(rollbackSql);
      const legPayStillIntact = await tempPool.query(
        `SELECT COUNT(*)::int AS cnt FROM print_order_payments WHERE id = $1`,
        [legacyPayId],
      );
      assert.equal(legPayStillIntact.rows[0].cnt, 1);

      // Re-apply 0036 idempotently -> insert a new opening balance -> rollback MUST block with ROLLBACK_BLOCKED!
      const reapply = await runMigrations(tempPool, upTo0036);
      assert.equal(reapply.appliedCount, 1);
      await tempPool.query(
        `INSERT INTO print_opening_balances (
           workspace_id, doc_code, direction, ledger_scope, customer_name,
           original_amount, valid_amount, remaining_amount
         ) VALUES ($1, 'DK-TEST-01', 'CUSTOMER_RECEIVABLE', 'GENERAL', 'Khách Mới 0036', 500000, 500000, 500000)`,
        [wsId],
      );
      await assert.rejects(
        () => tempPool.query(rollbackSql),
        /ROLLBACK_BLOCKED/,
      );
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

  it('Test #9: RBAC Owner-only (chặn 401 ẩn danh, 403 cho cả Staff và Admin đủ 6 quyền phụ) & kiểm chứng tuyệt đối KHÔNG ghi/đụng vào sổ /finance (fin_entries / fin_categories / fin_plan_items)', async () => {
    const { workspaceId, owner, admin, staff } = await seedWorkspaceActors(
      pool,
      'T9',
    );

    const beforeFin = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM fin_entries WHERE workspace_id = $1) AS entries_cnt,
         (SELECT COUNT(*)::int FROM fin_categories WHERE workspace_id = $1) AS cat_cnt,
         (SELECT COUNT(*)::int FROM fin_plan_items WHERE workspace_id = $1) AS plan_cnt,
         (SELECT COUNT(*)::int FROM fin_entry_corrections WHERE workspace_id = $1) AS corr_cnt`,
      [workspaceId],
    );
    assert.equal(beforeFin.rows[0].entries_cnt, 0);
    assert.equal(beforeFin.rows[0].cat_cnt, 0);
    assert.equal(beforeFin.rows[0].plan_cnt, 0);
    assert.equal(beforeFin.rows[0].corr_cnt, 0);

    const protectedEndpoints = [
      ['GET', '/api/v1/print-quotes/receivables'],
      ['POST', '/api/v1/print-quotes/receivables/receipts'],
      ['POST', '/api/v1/print-quotes/receivables/refunds'],
      ['POST', '/api/v1/print-quotes/receivables/adjustments'],
      ['GET', '/api/v1/print-quotes/payables'],
      ['POST', '/api/v1/print-quotes/payables/payouts'],
      ['POST', '/api/v1/print-quotes/payables/refunds'],
      ['POST', '/api/v1/print-quotes/payables/adjustments'],
      ['GET', '/api/v1/print-quotes/workshop-jobs'],
      ['GET', '/api/v1/print-quotes/opening-balances'],
      ['POST', '/api/v1/print-quotes/opening-balances'],
      ['GET', '/api/v1/print-quotes/transactions'],
      ['GET', '/api/v1/print-quotes/financial-report'],
      ['GET', '/api/v1/print-quotes/import-history/batches'],
      ['POST', '/api/v1/print-quotes/import-history/preview'],
    ];

    for (const [method, endpoint] of protectedEndpoints) {
      // Anonymous -> 401
      const anonRes = await apiRequest(baseUrl, method, endpoint, {
        body: method === 'POST' ? {} : undefined,
      });
      assert.equal(
        anonRes.status,
        401,
        `Expected 401 for anonymous on ${method} ${endpoint}`,
      );

      // Staff -> 403
      const staffRes = await apiRequest(baseUrl, method, endpoint, {
        cookie: staff.cookie,
        csrfToken: staff.csrf,
        body: method === 'POST' ? {} : undefined,
      });
      assert.equal(
        staffRes.status,
        403,
        `Expected 403 for staff on ${method} ${endpoint}`,
      );

      // Sub-Admin with ALL 6 sub-permissions (including finance:manage) -> STILL 403!
      const adminRes = await apiRequest(baseUrl, method, endpoint, {
        cookie: admin.cookie,
        csrfToken: admin.csrf,
        body: method === 'POST' ? {} : undefined,
      });
      assert.equal(
        adminRes.status,
        403,
        `Expected 403 for sub-admin on ${method} ${endpoint}`,
      );
    }

    // Owner executes AR + AP + Opening Balance operations -> fin_transactions MUST remain 0!
    const vend = (
      await apiRequest(baseUrl, 'POST', '/api/v1/print-quotes/vendors', {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: { name: 'Xưởng Kiểm Chứng Không Ghi Finance' },
      })
    ).body.data;

    await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/receivables/receipts',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          customer_name: 'Khách Tách Biệt Finance',
          amount: 750_000,
          allocations: [],
        },
      },
    );
    await apiRequest(baseUrl, 'POST', '/api/v1/print-quotes/payables/payouts', {
      cookie: owner.cookie,
      csrfToken: owner.csrf,
      body: {
        vendor_id: vend.id,
        amount: 350_000,
        allocations: [],
      },
    });

    const afterFin = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM fin_entries WHERE workspace_id = $1) AS entries_cnt,
         (SELECT COUNT(*)::int FROM fin_categories WHERE workspace_id = $1) AS cat_cnt,
         (SELECT COUNT(*)::int FROM fin_plan_items WHERE workspace_id = $1) AS plan_cnt,
         (SELECT COUNT(*)::int FROM fin_entry_corrections WHERE workspace_id = $1) AS corr_cnt`,
      [workspaceId],
    );
    assert.equal(
      afterFin.rows[0].entries_cnt,
      0,
      'PrintQuote AR/AP MUST NEVER write to /finance fin_entries!',
    );
    assert.equal(afterFin.rows[0].cat_cnt, 0);
    assert.equal(afterFin.rows[0].plan_cnt, 0);
    assert.equal(afterFin.rows[0].corr_cnt, 0);
  });

  it('Test #10: Idempotency replay, xung đột payload cùng key, cạnh tranh phân bổ đồng thời (FOR UPDATE chống thu vượt) & rollback toàn bộ khi giao dịch lỗi giữa chừng', async () => {
    const { workspaceId, owner } = await seedWorkspaceActors(pool, 'T10');

    const { order } = await createFinalizedQuoteAndOrder(baseUrl, owner, {
      title: 'Đơn Test Concurrency & Idempotency',
      customerName: 'Khách Concurrency',
      lines: [
        {
          name: 'In poster A2',
          unit: 'tờ',
          quantity: 100,
          vendorCostMode: VendorCostMode.TOTAL_BATCH,
          vendorCostValue: 400_000,
          profitMode: ProfitMode.FIXED_AMOUNT,
          profitScope: ProfitScope.TOTAL_BATCH,
          profitValue: 200_000,
        },
      ],
    });
    assert.equal(order.total_quote_amount, 600_000);

    // 1. Idempotency replay with identical key & payload -> returns exact same tx_code without creating duplicate row
    const idemKey = `idem-ar-${crypto.randomUUID()}`;
    const payload = {
      customer_name: 'Khách Concurrency',
      amount: 150_000,
      allocations: [],
    };
    const r1 = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/receivables/receipts',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        idempotencyKey: idemKey,
        body: payload,
      },
    );
    const r2 = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/receivables/receipts',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        idempotencyKey: idemKey,
        body: payload,
      },
    );
    assert.equal(r1.status, 201);
    assert.equal(r2.status, 201);
    assert.equal(r1.body.data.id, r2.body.data.id);
    assert.equal(r1.body.data.tx_code, r2.body.data.tx_code);

    // Same Idempotency-Key with DIFFERENT payload -> 409 IDEMPOTENCY_CONFLICT
    const rMismatch = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/receivables/receipts',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        idempotencyKey: idemKey,
        body: { ...payload, amount: 999_000 },
      },
    );
    assert.equal(rMismatch.status, 409);
    assert.equal(rMismatch.body.error.code, 'IDEMPOTENCY_CONFLICT');

    // 2. Atomic rollback when 2nd allocation target in a multi-order receipt overflows:
    // Order 1 owes 600,000; create Order 2 owing 300,000 -> try allocating 600k to Order 1 + 400k to Order 2 in 1 transaction
    const { order: order2 } = await createFinalizedQuoteAndOrder(
      baseUrl,
      owner,
      {
        title: 'Đơn Test Atomic Rollback',
        customerName: 'Khách Concurrency',
        lines: [
          {
            name: 'Namecard C300',
            unit: 'hộp',
            quantity: 5,
            vendorCostMode: VendorCostMode.TOTAL_BATCH,
            vendorCostValue: 200_000,
            profitMode: ProfitMode.FIXED_AMOUNT,
            profitScope: ProfitScope.TOTAL_BATCH,
            profitValue: 100_000,
          },
        ],
      },
    );
    const txCountBefore = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM print_ar_transactions WHERE workspace_id = $1`,
      [workspaceId],
    );

    const atomicFail = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/receivables/receipts',
      {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          customer_name: 'Khách Concurrency',
          amount: 1_000_000,
          allocations: [
            { order_id: order.id, amount: 600_000 },
            { order_id: order2.id, amount: 400_000 }, // Overflows order2 (300,000)!
          ],
        },
      },
    );
    assert.equal(atomicFail.status, 400);
    assert.equal(atomicFail.body.error.code, 'OVER_ALLOCATION');

    const txCountAfter = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM print_ar_transactions WHERE workspace_id = $1`,
      [workspaceId],
    );
    assert.equal(
      txCountAfter.rows[0].cnt,
      txCountBefore.rows[0].cnt,
      'Failed multi-order allocation MUST roll back the entire AR transaction!',
    );
    const ord1StillUnpaid = (
      await apiRequest(
        baseUrl,
        'GET',
        `/api/v1/print-quotes/orders/${order.id}`,
        { cookie: owner.cookie },
      )
    ).body.data;
    assert.equal(ord1StillUnpaid.remaining_debt_amount, 600_000);

    // 3. Concurrent FOR UPDATE race: 2 simultaneous receipts both trying to allocate 600,000 onto `order` (owes 600,000)
    const [raceA, raceB] = await Promise.all([
      apiRequest(baseUrl, 'POST', '/api/v1/print-quotes/receivables/receipts', {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          customer_name: 'Khách Concurrency',
          amount: 600_000,
          allocations: [{ order_id: order.id, amount: 600_000 }],
        },
      }),
      apiRequest(baseUrl, 'POST', '/api/v1/print-quotes/receivables/receipts', {
        cookie: owner.cookie,
        csrfToken: owner.csrf,
        body: {
          customer_name: 'Khách Concurrency',
          amount: 600_000,
          allocations: [{ order_id: order.id, amount: 600_000 }],
        },
      }),
    ]);

    const statuses = [raceA.status, raceB.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [201, 400]);

    const ord1AfterRace = (
      await apiRequest(
        baseUrl,
        'GET',
        `/api/v1/print-quotes/orders/${order.id}`,
        { cookie: owner.cookie },
      )
    ).body.data;
    assert.equal(ord1AfterRace.total_paid_amount, 600_000);
    assert.equal(ord1AfterRace.remaining_debt_amount, 0);
  });
});
