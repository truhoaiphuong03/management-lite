import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { loadTestDatabaseConfig } from '../../dist/packages/database/src/config.js';
import { createDatabasePool } from '../../dist/packages/database/src/pool.js';
import {
  runMigrations,
  loadMigrationFiles,
} from '../../dist/packages/database/src/migrator.js';
import { createRequestHandler } from '../../dist/apps/api/src/app.js';
import { generateCsrfToken } from '../../dist/packages/security/src/csrf.js';
import { hashToken } from '../../dist/packages/security/src/tokens.js';

const CSRF_SECRET = 'test-csrf-secret-printquote-postgres-32chars!';
const ALLOWED_ORIGIN = 'http://127.0.0.1:3000';

async function apiRequest(
  baseUrl,
  method,
  path,
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
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: payload,
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

describe('MGL-PRINTQUOTE V1 — Phase 2 & 4 PostgreSQL Integration Tests', () => {
  let pool;
  let server;
  let baseUrl;
  let workspaceId;
  let ownerCookie;
  let ownerCsrf;
  let staffCookie;
  let staffCsrf;

  before(async () => {
    const dbConfig = loadTestDatabaseConfig(process.env);
    pool = createDatabasePool(dbConfig);
    await runMigrations(
      pool,
      loadMigrationFiles('packages/database/src/migrations'),
    );

    workspaceId = crypto.randomUUID();
    const ownerUserId = crypto.randomUUID();
    const staffUserId = crypto.randomUUID();

    await pool.query(
      `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active')`,
      [workspaceId, `PrintQuote Test WS ${workspaceId.slice(0, 8)}`],
    );

    const shortId = workspaceId.slice(0, 8);
    await pool.query(
      `INSERT INTO users (id, username_normalized, email_normalized, status)
       VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
      [
        ownerUserId,
        `owner_${shortId}`,
        `owner-${shortId}@test.local`,
        staffUserId,
        `staff_${shortId}`,
        `staff-${shortId}@test.local`,
      ],
    );

    await pool.query(
      `INSERT INTO user_credentials (user_id, password_hash, credential_version)
       VALUES ($1, 'argon2id$stub', 1), ($2, 'argon2id$stub', 1)`,
      [ownerUserId, staffUserId],
    );

    await pool.query(
      `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status)
       VALUES ($1, $2, $3, 'owner', 'active'), ($4, $2, $5, 'staff', 'active')`,
      [
        crypto.randomUUID(),
        workspaceId,
        ownerUserId,
        crypto.randomUUID(),
        staffUserId,
      ],
    );

    await pool.query(
      `INSERT INTO user_workspace_bindings (user_id, workspace_id, status, version)
       VALUES ($1, $2, 'active', 1), ($3, $2, 'active', 1)`,
      [ownerUserId, workspaceId, staffUserId],
    );

    const ownerRawToken = `owner-tok-${crypto.randomUUID()}`;
    const ownerTokenHash = hashToken(ownerRawToken);
    await pool.query(
      `INSERT INTO auth_sessions (
         id, workspace_id, user_id, session_token_hash,
         credential_version_at_issue, idle_expires_at, absolute_expires_at, remember_me
       ) VALUES ($1, $2, $3, $4, 1, now() + interval '4 hours', now() + interval '24 hours', false)`,
      [crypto.randomUUID(), workspaceId, ownerUserId, ownerTokenHash],
    );
    ownerCookie = `mglite_session=${ownerRawToken}`;
    ownerCsrf = generateCsrfToken(ownerTokenHash, CSRF_SECRET);

    const staffRawToken = `staff-tok-${crypto.randomUUID()}`;
    const staffTokenHash = hashToken(staffRawToken);
    await pool.query(
      `INSERT INTO auth_sessions (
         id, workspace_id, user_id, session_token_hash,
         credential_version_at_issue, idle_expires_at, absolute_expires_at, remember_me
       ) VALUES ($1, $2, $3, $4, 1, now() + interval '4 hours', now() + interval '24 hours', false)`,
      [crypto.randomUUID(), workspaceId, staffUserId, staffTokenHash],
    );
    staffCookie = `mglite_session=${staffRawToken}`;
    staffCsrf = generateCsrfToken(staffTokenHash, CSRF_SECRET);

    const handler = createRequestHandler({
      pool,
      csrfSecret: CSRF_SECRET,
      allowedOrigins: [ALLOWED_ORIGIN],
      isProduction: false,
    });
    server = http.createServer(handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
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

  it('1. Bảo vệ quyền truy cập Owner: Nhân viên (staff) bị từ chối 403 FORBIDDEN trên toàn bộ API Báo giá in ấn', async () => {
    const res1 = await apiRequest(
      baseUrl,
      'GET',
      '/api/v1/print-quotes/quotes',
      {
        cookie: staffCookie,
      },
    );
    assert.equal(res1.status, 403);
    assert.equal(res1.body.error.code, 'FORBIDDEN');

    const res2 = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/vendors',
      {
        cookie: staffCookie,
        csrfToken: staffCsrf,
        body: { name: 'Nhà in Test' },
      },
    );
    assert.equal(res2.status, 403);
  });

  it('2. Quản lý Nhà in, Bảng giá, Khách hàng + Idempotency & Transaction trên PostgreSQL DEV', async () => {
    const idemKey = `idem-vendor-${crypto.randomUUID()}`;
    const vCreate = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/vendors',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        idempotencyKey: idemKey,
        body: {
          name: 'Nhà in Nhanh Sài Gòn',
          phone: '0909111222',
          bank_name: 'Vietcombank',
          bank_account_number: '0071000888999',
          bank_account_holder: 'CONG TY IN NHANH SG',
        },
      },
    );
    assert.equal(vCreate.status, 201);
    const vendor = vCreate.body.data;
    assert.equal(vendor.code, 'NI001');
    assert.equal(vendor.name, 'Nhà in Nhanh Sài Gòn');

    // Replay cùng Idempotency-Key trả về cùng bản ghi, không tạo trùng
    const vReplay = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/vendors',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        idempotencyKey: idemKey,
        body: {
          name: 'Nhà in Nhanh Sài Gòn',
          phone: '0909111222',
          bank_name: 'Vietcombank',
          bank_account_number: '0071000888999',
          bank_account_holder: 'CONG TY IN NHANH SG',
        },
      },
    );
    assert.equal(vReplay.status, 201);
    assert.equal(vReplay.body.data.id, vendor.id);

    // Dùng cùng Idempotency-Key nhưng đổi payload -> 409 IDEMPOTENCY_CONFLICT
    const vConflict = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/vendors',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        idempotencyKey: idemKey,
        body: { name: 'Nhà in Khác' },
      },
    );
    assert.equal(vConflict.status, 409);
    assert.equal(vConflict.body.error.code, 'IDEMPOTENCY_CONFLICT');

    // Tạo bảng giá nhà in
    const pCreate = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/price-items',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          vendor_id: vendor.id,
          name: 'Tờ rơi A5 C150',
          category: 'Tờ rơi',
          specification: 'In Offset 4 màu 2 mặt',
          unit: 'tờ',
          pricing_mode: 'PER_UNIT',
          unit_cost: 300,
          default_profit_mode: 'FIXED_AMOUNT',
          default_profit_scope: 'PER_UNIT',
          default_profit_value: 200,
        },
      },
    );
    assert.equal(pCreate.status, 201);
    const priceItem = pCreate.body.data;
    assert.equal(priceItem.unit_cost, 300);

    // Tạo khách hàng
    const cCreate = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/customers',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          name: 'Chị Lan Anh',
          company_name: 'Thẩm mỹ viện Hoa Lan',
          phone: '0912333444',
          address: '123 Nguyễn Huệ, Q.1, TP.HCM',
        },
      },
    );
    assert.equal(cCreate.status, 201);
    const customer = cCreate.body.data;
    assert.equal(customer.code, 'KH001');

    // 3. Tạo báo giá v1 từ bảng giá nhà in (100 tờ x (300đ + 200đ) + 50.000đ ship = 100.000đ)
    const qCreate = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/quotes',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          customer_id: customer.id,
          title: 'Báo giá tờ rơi khai trương',
          shipping_fee: 50_000,
          include_shipping_in_unit_price: true,
          items: [
            {
              id: 'LINE-1',
              vendor_price_item_id: priceItem.id,
              quantity: 100,
            },
          ],
        },
      },
    );
    assert.equal(qCreate.status, 201);
    const quoteV1 = qCreate.body.data;
    assert.equal(quoteV1.current_version, 1);
    assert.equal(quoteV1.total_vendor_cost, 30_000);
    assert.equal(quoteV1.total_profit, 20_000);
    assert.equal(quoteV1.shipping_fee, 50_000);
    assert.equal(quoteV1.total_quote_amount, 100_000);
    assert.equal(quoteV1.single_product_final_unit_price, 1_000);
    assert.equal(quoteV1.versions.length, 1);

    // 4. Cập nhật bảng giá nhà in lên 800đ/tờ -> Báo giá cũ v1 KHÔNG bị thay đổi
    const pUpdate = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/price-items/${priceItem.id}`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: { unit_cost: 800 },
      },
    );
    assert.equal(pUpdate.status, 200);
    assert.equal(pUpdate.body.data.unit_cost, 800);
    assert.equal(pUpdate.body.data.version, 2);

    const qCheckAfterCatalogChange = await apiRequest(
      baseUrl,
      'GET',
      `/api/v1/print-quotes/quotes/${quoteV1.id}`,
      { cookie: ownerCookie },
    );
    assert.equal(qCheckAfterCatalogChange.status, 200);
    assert.equal(qCheckAfterCatalogChange.body.data.total_vendor_cost, 30_000);
    assert.equal(
      qCheckAfterCatalogChange.body.data.total_quote_amount,
      100_000,
    );

    // 5. Cập nhật báo giá sang v2 (giữ lịch sử cả v1 và v2)
    const qUpdateV2 = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/quotes/${quoteV1.id}`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          title: 'Báo giá tờ rơi khai trương (Bản sửa v2)',
          change_note: 'Cập nhật ghi chú cho khách',
        },
      },
    );
    assert.equal(qUpdateV2.status, 200);
    assert.equal(qUpdateV2.body.data.current_version, 2);
    assert.equal(qUpdateV2.body.data.versions.length, 2);

    // 6. Kiểm tra API xuất dữ liệu PDF khách hàng (Tuyệt đối không chứa giá vốn hay lợi nhuận)
    const pdfRes = await apiRequest(
      baseUrl,
      'GET',
      `/api/v1/print-quotes/quotes/${quoteV1.id}/pdf`,
      { cookie: ownerCookie },
    );
    assert.equal(pdfRes.status, 200);
    const pdfData = pdfRes.body.data;
    assert.equal(pdfData.grandTotalPayable, 100_000);
    assert.equal(pdfData.shippingAmountToAddOnPdfFooter, 0);
    const rawPdfJson = JSON.stringify(pdfData);
    assert.equal(rawPdfJson.includes('unitVendorCost'), false);
    assert.equal(rawPdfJson.includes('totalVendorCost'), false);
    assert.equal(rawPdfJson.includes('totalProfit'), false);

    // 7. Chuyển báo giá thành Đơn hàng sản xuất (Phase 4) + đặt cọc 40.000đ
    const ordCreate = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/orders',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          quote_id: quoteV1.id,
          print_ordered_at: '2026-11-02',
          due_date: '2026-11-05',
          deposit_required: 40_000,
          deposit_paid: 40_000,
          payment_method: 'QR_VIETQR',
        },
      },
    );
    assert.equal(ordCreate.status, 201);
    const order = ordCreate.body.data;
    assert.equal(order.total_quote_amount, 100_000);
    assert.equal(order.expected_vendor_cost, 30_000);
    assert.equal(order.expected_profit, 20_000);
    assert.equal(order.deposit_paid, 40_000);
    assert.equal(order.total_paid_amount, 40_000);
    assert.equal(order.remaining_debt_amount, 60_000);
    assert.equal(order.payment_status, 'DEPOSIT_PAID');
    assert.equal(order.production_status, 'PENDING');
    assert.equal(order.delivery_status, 'NOT_SHIPPED');

    // Khi báo giá đã chuyển thành đơn (CONVERTED), không thể sửa báo giá đó nữa
    const qForbiddenEdit = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/quotes/${quoteV1.id}`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: { shipping_fee: 99_000 },
      },
    );
    assert.equal(qForbiddenEdit.status, 409);

    // 8. Cập nhật độc lập trạng thái sản xuất & giao hàng + xác nhận đủ 3 khoản chi phí thực tế
    const ordUpd = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/orders/${order.id}`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          production_status: 'COMPLETED',
          delivery_status: 'SHIPPING',
          actual_cost_confirmed: true,
          actual_vendor_cost: 28_000, // tiết kiệm 2.000đ giá in
          actual_shipping_fee: 45_000, // tiết kiệm 5.000đ ship
          actual_extra_cost: 0,
        },
      },
    );
    assert.equal(ordUpd.status, 200);
    assert.equal(ordUpd.body.data.production_status, 'COMPLETED');
    assert.equal(ordUpd.body.data.delivery_status, 'SHIPPING');
    assert.equal(ordUpd.body.data.expected_profit, 20_000);
    assert.equal(ordUpd.body.data.actual_profit, 27_000); // 100k - 28k - 45k = 27k

    // 9. Thanh toán nốt 60.000đ công nợ còn lại
    const payFinal = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/orders/${order.id}/payments`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          payment_type: 'FINAL',
          amount: 60_000,
          payment_method: 'BANK_TRANSFER',
          note: 'Tất toán khi giao hàng',
        },
      },
    );
    assert.equal(payFinal.status, 201);
    assert.equal(payFinal.body.data.total_paid_amount, 100_000);
    assert.equal(payFinal.body.data.remaining_debt_amount, 0);
    assert.equal(payFinal.body.data.payment_status, 'PAID');
    assert.equal(payFinal.body.data.payments.length, 2);

    // 10. Kiểm tra Dashboard thống kê
    const statsRes = await apiRequest(
      baseUrl,
      'GET',
      '/api/v1/print-quotes/stats',
      {
        cookie: ownerCookie,
      },
    );
    assert.equal(statsRes.status, 200);
    const stats = statsRes.body.data;
    assert.equal(stats.total_vendors, 1);
    assert.equal(stats.total_price_items, 1);
    assert.equal(stats.total_customers, 1);
    assert.equal(stats.total_quotes, 1);
    assert.equal(stats.finalized_quotes, 1);
    assert.equal(stats.total_orders, 1);
    assert.equal(stats.total_order_revenue, 100_000);
    assert.equal(stats.total_expected_profit, 20_000);
    assert.equal(stats.total_actual_profit, 27_000);
    assert.equal(stats.total_paid_amount, 100_000);
    assert.equal(stats.total_remaining_debt, 0);
  });
});
