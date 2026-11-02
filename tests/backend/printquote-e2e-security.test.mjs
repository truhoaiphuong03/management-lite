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
import { buildPrintQuoteA4Html } from '../../dist/apps/web/src/screens/helpers/printquote-helpers.js';
import {
  renderCustomerSafeA4PdfBuffer,
  PdfRendererUnavailableError,
} from '../../dist/apps/api/src/printquote/pdf-renderer.js';

const CSRF_SECRET = 'test-csrf-secret-printquote-e2e-sec-32chars!';
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

describe('MGL-PRINTQUOTE V1 — Phase 4 End-to-End Lifecycle, Order Fulfillment & Security Audit', () => {
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
    const shortId = workspaceId.slice(0, 8);

    await pool.query(
      `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active')`,
      [workspaceId, `PrintQuote E2E WS ${shortId}`],
    );

    await pool.query(
      `INSERT INTO users (id, username_normalized, email_normalized, status)
       VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active')`,
      [
        ownerUserId,
        `owner_e2e_${shortId}`,
        `owner-e2e-${shortId}@test.local`,
        staffUserId,
        `staff_e2e_${shortId}`,
        `staff-e2e-${shortId}@test.local`,
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

    await pool.query(
      `INSERT INTO employees (id, workspace_id, user_id, employee_code, full_name, employment_status, sub_role, sub_permissions)
       VALUES ($1, $2, $3, 'NV001', 'Sub-Admin E2E', 'active', 'admin', $4::jsonb)`,
      [
        crypto.randomUUID(),
        workspaceId,
        staffUserId,
        JSON.stringify([
          'attendance:review',
          'work:manage',
          'employees:manage',
          'accounts:manage',
          'payroll:manage',
          'finance:manage',
        ]),
      ],
    );

    const ownerRawToken = `owner-e2e-tok-${crypto.randomUUID()}`;
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

    const staffRawToken = `staff-e2e-tok-${crypto.randomUUID()}`;
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

  it('1. Security Guard: Chặn truy cập ẩn danh (401), chặn Staff & Sub-Admin có đủ 6 quyền phụ (403), chỉ cho phép Owner và bắt buộc CSRF trên mọi thao tác ghi', async () => {
    const unauth = await apiRequest(
      baseUrl,
      'GET',
      '/api/v1/print-quotes/stats',
    );
    assert.equal(unauth.status, 401);

    const staffStats = await apiRequest(
      baseUrl,
      'GET',
      '/api/v1/print-quotes/stats',
      { cookie: staffCookie },
    );
    assert.equal(staffStats.status, 403);

    const staffWrite = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/vendors',
      {
        cookie: staffCookie,
        csrfToken: staffCsrf,
        body: { name: 'Nhà in Staff Cố Tạo' },
      },
    );
    assert.equal(staffWrite.status, 403);

    const missingCsrf = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/vendors',
      {
        cookie: ownerCookie,
        body: { name: 'Nhà in Không CSRF' },
      },
    );
    assert.equal(missingCsrf.status, 403);
  });

  it('2. E2E Full Workflow: Nhà in -> Bảng giá (Đơn vị & Lô) -> Khách hàng -> Báo giá đa sản phẩm -> Xuất PDF A4 không lộ giá vốn -> Đơn hàng (Ngày đặt in, SX/Giao độc lập, Đặt cọc & Thanh toán từng đợt, Lợi nhuận Dự kiến vs Thực tế) -> Dashboard', async () => {
    // Bước 1: Tạo Nhà in
    const vRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/vendors',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: { name: 'Nhà in Offset Gia Định', phone: '0908999111' },
      },
    );
    assert.equal(vRes.status, 201);
    const vendor = vRes.body.data;

    // Bước 2: Tạo 2 mục Bảng giá (1 tính theo đơn vị, 1 tính trọn lô)
    const p1Res = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/price-items',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          vendor_id: vendor.id,
          name: 'Namecard C300 cán mờ',
          unit: 'hộp',
          pricing_mode: 'PER_UNIT',
          unit_cost: 25000,
          default_profit_mode: 'FIXED_AMOUNT',
          default_profit_scope: 'PER_UNIT',
          default_profit_value: 15000,
        },
      },
    );
    assert.equal(p1Res.status, 201);
    const itemPerUnit = p1Res.body.data;

    const p2Res = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/price-items',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          vendor_id: vendor.id,
          name: 'Standee cuốn nhôm 80x200cm',
          unit: 'bộ',
          pricing_mode: 'TOTAL_BATCH',
          batch_quantity: 5,
          batch_total_cost: 500000,
          default_profit_mode: 'PERCENTAGE',
          default_profit_scope: 'TOTAL_BATCH',
          default_profit_value: 30, // 30% của 500.000đ = 150.000đ
        },
      },
    );
    assert.equal(p2Res.status, 201);
    const itemBatch = p2Res.body.data;

    // Bước 3: Tạo Khách hàng
    const cRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/customers',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          name: 'Anh Hoàng Nam',
          company_name: 'Chuỗi Cafe Góc Phố',
          phone: '0933444555',
        },
      },
    );
    assert.equal(cRes.status, 201);
    const customer = cRes.body.data;

    // Bước 4: Tạo Báo giá đa sản phẩm có phân bổ ship 70.000đ (gộp vào đơn giá khách)
    // Dòng 1: 10 hộp Namecard * (25k vốn + 15k lời) = 400k
    // Dòng 2: 5 bộ Standee trọn lô 500k vốn + 30% lời (150k) = 650k
    // Tổng trước ship = 1.050.000đ (Vốn 750.000đ + Lời 300.000đ) + Ship 70.000đ = 1.120.000đ
    const qRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/quotes',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          customer_id: customer.id,
          title: 'Báo giá bộ nhận diện khai trương Cafe Góc Phố',
          shipping_fee: 70000,
          include_shipping_in_unit_price: true,
          items: [
            {
              id: 'L1',
              vendor_price_item_id: itemPerUnit.id,
              quantity: 10,
            },
            {
              id: 'L2',
              vendor_price_item_id: itemBatch.id,
              quantity: 5,
            },
          ],
        },
      },
    );
    assert.equal(qRes.status, 201);
    const quote = qRes.body.data;
    assert.equal(quote.total_vendor_cost, 750000);
    assert.equal(quote.total_profit, 300000);
    assert.equal(quote.shipping_fee, 70000);
    assert.equal(quote.total_quote_amount, 1120000);

    // Bước 5: Xuất PDF A4 tiếng Việt từ dữ liệu API `/pdf` và kiểm toán bảo mật không lộ giá vốn/lời
    const pdfApiRes = await apiRequest(
      baseUrl,
      'GET',
      `/api/v1/print-quotes/quotes/${quote.id}/pdf`,
      { cookie: ownerCookie },
    );
    assert.equal(pdfApiRes.status, 200);
    const a4Html = buildPrintQuoteA4Html(pdfApiRes.body.data, {
      quoteCode: quote.quote_code,
      quoteTitle: quote.title,
      workspaceName: 'Hoài Phương Media',
    });
    assert.equal(a4Html.includes('1.120.000 ₫'), true);
    assert.equal(a4Html.includes('750.000'), false); // Không lộ tổng giá vốn
    assert.equal(a4Html.includes('300.000'), false); // Không lộ tổng lợi nhuận
    assert.equal(a4Html.includes('25.000'), false); // Không lộ đơn giá vốn namecard

    // Bước 6: Lên Đơn hàng + Đặt cọc lần 1 (500.000đ) + Quản lý ngày đặt in
    const ordRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/orders',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          quote_id: quote.id,
          print_ordered_at: '2026-11-02',
          due_date: '2026-11-06',
          deposit_required: 500000,
          deposit_paid: 500000,
          payment_method: 'BANK_TRANSFER',
        },
      },
    );
    assert.equal(ordRes.status, 201);
    const order = ordRes.body.data;
    assert.equal(order.print_ordered_at, '2026-11-02');
    assert.equal(order.total_paid_amount, 500000);
    assert.equal(order.remaining_debt_amount, 620000);
    assert.equal(order.payment_status, 'DEPOSIT_PAID');

    // Bước 7: Thanh toán đợt 2 (Installment: 320.000đ) -> Còn nợ 300.000đ (PARTIALLY_PAID)
    const pay2Res = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/orders/${order.id}/payments`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          payment_type: 'INSTALLMENT',
          amount: 320000,
          payment_method: 'QR_VIETQR',
          note: 'Thanh toán đợt 2 khi duyệt mẫu in',
        },
      },
    );
    assert.equal(pay2Res.status, 201);
    assert.equal(pay2Res.body.data.total_paid_amount, 820000);
    assert.equal(pay2Res.body.data.remaining_debt_amount, 300000);
    assert.equal(pay2Res.body.data.payment_status, 'PARTIALLY_PAID');

    // Bước 8: Cập nhật trạng thái Sản xuất (FINISHING) và Giao hàng (PACKING) độc lập + Chi phí thực tế
    const statusRes = await apiRequest(
      baseUrl,
      'PATCH',
      `/api/v1/print-quotes/orders/${order.id}`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          production_status: 'FINISHING',
          delivery_status: 'PACKING',
          actual_vendor_cost: 720000,
          actual_shipping_fee: 60000,
        },
      },
    );
    assert.equal(statusRes.status, 200);
    assert.equal(statusRes.body.data.production_status, 'FINISHING');
    assert.equal(statusRes.body.data.delivery_status, 'PACKING');
    assert.equal(statusRes.body.data.expected_profit, 300000);
    assert.equal(statusRes.body.data.actual_profit, 340000); // 1.120.000 - 720.000 - 60.000 = 340.000

    // Bước 9: Kiểm tra Dashboard Thống kê
    const statsRes = await apiRequest(
      baseUrl,
      'GET',
      '/api/v1/print-quotes/stats',
      { cookie: ownerCookie },
    );
    assert.equal(statsRes.status, 200);
    const stats = statsRes.body.data;
    assert.equal(stats.total_quotes, 1);
    assert.equal(stats.total_orders, 1);
    assert.equal(stats.total_order_revenue, 1120000);
    assert.equal(stats.total_expected_profit, 300000);
    assert.equal(stats.total_actual_profit, 340000);
    assert.equal(stats.total_paid_amount, 820000);
    assert.equal(stats.total_remaining_debt, 300000);
    assert.equal(stats.orders_by_production_status.FINISHING, 1);
    assert.equal(stats.orders_by_delivery_status.PACKING, 1);
  });

  it('3. QA-01: Chặn chuyển cùng một báo giá thành nhiều đơn hàng (Sequential & 5 Concurrent Requests)', async () => {
    const qRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/quotes',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          title: 'Báo giá Kiểm tra Chống Trùng Đơn',
          shipping_fee: 50000,
          items: [
            {
              id: 'DUP-1',
              name: 'Tờ rơi A5',
              quantity: 100,
              unitVendorCost: 300,
              profitMode: 'FIXED_AMOUNT',
              profitScope: 'PER_UNIT',
              profitValue: 200,
            },
          ],
        },
      },
    );
    assert.equal(qRes.status, 201);
    const quoteId = qRes.body.data.id;

    // Bắn đồng thời 5 request chuyển cùng 1 báo giá thành đơn hàng
    const concurrentResults = await Promise.all(
      Array.from({ length: 5 }, () =>
        apiRequest(baseUrl, 'POST', '/api/v1/print-quotes/orders', {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          body: { quote_id: quoteId, deposit_paid: 20000 },
        }),
      ),
    );

    const createdCount = concurrentResults.filter(
      (r) => r.status === 201,
    ).length;
    const conflictCount = concurrentResults.filter(
      (r) => r.status === 409,
    ).length;
    assert.equal(
      createdCount,
      1,
      'Chỉ duy nhất 1 request được phép tạo đơn hàng',
    );
    assert.equal(
      conflictCount,
      4,
      '4 request đồng thời còn lại phải bị chặn với 409 CONFLICT',
    );

    // Gọi tuần tự thêm 1 lần nữa cũng phải bị chặn 409 CONFLICT
    const seqRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/orders',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: { quote_id: quoteId },
      },
    );
    assert.equal(seqRes.status, 409);
    assert.equal(seqRes.body.error.code, 'CONFLICT');
  });

  it('4. QA-01: Cấp mã báo giá và mã đơn hàng đồng thời (Concurrency) & Không tái sử dụng mã khi xóa bản ghi', async () => {
    // 1. Tạo đồng thời 8 báo giá không truyền quote_code
    const quoteResponses = await Promise.all(
      Array.from({ length: 8 }, (_, idx) =>
        apiRequest(baseUrl, 'POST', '/api/v1/print-quotes/quotes', {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          body: {
            title: `Báo giá Đồng thời #${idx + 1}`,
            shipping_fee: 10000,
            items: [
              {
                id: `CONC-${idx + 1}`,
                name: 'Danh thiếp',
                quantity: 100,
                unitVendorCost: 500,
                profitMode: 'FIXED_AMOUNT',
                profitScope: 'PER_UNIT',
                profitValue: 300,
              },
            ],
          },
        }),
      ),
    );

    for (const r of quoteResponses) {
      assert.equal(r.status, 201);
    }
    const quoteCodes = quoteResponses.map((r) => r.body.data.quote_code);
    assert.equal(
      new Set(quoteCodes).size,
      8,
      '8 báo giá tạo đồng thời phải có 8 mã quote_code duy nhất không trùng',
    );

    // 2. Chuyển đồng thời 8 báo giá đó sang 8 đơn hàng
    const orderResponses = await Promise.all(
      quoteResponses.map((qr) =>
        apiRequest(baseUrl, 'POST', '/api/v1/print-quotes/orders', {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          body: { quote_id: qr.body.data.id },
        }),
      ),
    );

    for (const r of orderResponses) {
      assert.equal(r.status, 201);
    }
    const orderCodes = orderResponses.map((r) => r.body.data.order_code);
    assert.equal(
      new Set(orderCodes).size,
      8,
      '8 đơn hàng tạo đồng thời phải có 8 mã order_code duy nhất không trùng',
    );

    // 3. Xóa 1 báo giá nháp trong DB và tạo báo giá mới -> Mã mới phải tăng tiếp, không được lùi về mã cũ (chứng minh không dùng COUNT(*) + 1)
    const tempQuoteRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/quotes',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          title: 'Báo giá Tạm để xóa',
          shipping_fee: 0,
          items: [
            {
              id: 'DEL-1',
              name: 'Nhãn dán',
              quantity: 10,
              unitVendorCost: 1000,
              profitMode: 'FIXED_AMOUNT',
              profitScope: 'PER_UNIT',
              profitValue: 500,
            },
          ],
        },
      },
    );
    assert.equal(tempQuoteRes.status, 201);
    const deletedQuoteCode = tempQuoteRes.body.data.quote_code;
    await pool.query(`DELETE FROM print_quotes WHERE id = $1`, [
      tempQuoteRes.body.data.id,
    ]);

    const afterDeleteRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/quotes',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          title: 'Báo giá Sau khi xóa',
          shipping_fee: 0,
          items: [
            {
              id: 'AFTER-DEL-1',
              name: 'Nhãn dán 2',
              quantity: 10,
              unitVendorCost: 1000,
              profitMode: 'FIXED_AMOUNT',
              profitScope: 'PER_UNIT',
              profitValue: 500,
            },
          ],
        },
      },
    );
    assert.equal(afterDeleteRes.status, 201);
    assert.notEqual(
      afterDeleteRes.body.data.quote_code,
      deletedQuoteCode,
      'Không được tái sử dụng mã báo giá đã xóa',
    );
  });

  it('5. QA-01: Kiểm tra chính xác công nợ khi Đặt cọc, Thanh toán nhiều đợt, Hoàn tiền (REFUND) và Chặn thanh toán vượt tổng đơn (Overpayment)', async () => {
    // Tạo báo giá chuẩn 100.000đ (100 tờ x (300đ vốn + 200đ lời) + 50.000đ ship)
    const qRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/quotes',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          title: 'Báo giá Kiểm tra Công nợ 100k',
          shipping_fee: 50000,
          items: [
            {
              id: 'DEBT-100',
              name: 'Tờ rơi A5 Chuẩn',
              quantity: 100,
              unitVendorCost: 300,
              profitMode: 'FIXED_AMOUNT',
              profitScope: 'PER_UNIT',
              profitValue: 200,
            },
          ],
        },
      },
    );
    assert.equal(qRes.status, 201);
    const quote = qRes.body.data;
    assert.equal(quote.total_quote_amount, 100000);
    assert.equal(quote.single_product_final_unit_price, 1000);

    // A. Chặn đặt cọc vượt tổng đơn (150.000đ > 100.000đ)
    const overDepositOrder = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/orders',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          quote_id: quote.id,
          deposit_paid: 150000,
        },
      },
    );
    assert.equal(overDepositOrder.status, 400);

    // B. Tạo đơn với đặt cọc 30.000đ -> Đã trả 30.000đ, Còn nợ 70.000đ (DEPOSIT_PAID)
    const ordRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/orders',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          quote_id: quote.id,
          deposit_required: 30000,
          deposit_paid: 30000,
        },
      },
    );
    assert.equal(ordRes.status, 201);
    const orderId = ordRes.body.data.id;
    assert.equal(ordRes.body.data.total_paid_amount, 30000);
    assert.equal(ordRes.body.data.remaining_debt_amount, 70000);
    assert.equal(ordRes.body.data.payment_status, 'DEPOSIT_PAID');

    // C. Thanh toán đợt 2: 40.000đ -> Đã trả 70.000đ, Còn nợ 30.000đ (PARTIALLY_PAID)
    const pay1 = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/orders/${orderId}/payments`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: { payment_type: 'INSTALLMENT', amount: 40000 },
      },
    );
    assert.equal(pay1.status, 201);
    assert.equal(pay1.body.data.total_paid_amount, 70000);
    assert.equal(pay1.body.data.remaining_debt_amount, 30000);
    assert.equal(pay1.body.data.payment_status, 'PARTIALLY_PAID');

    // D. Chặn thanh toán vượt công nợ còn lại (đang nợ 30.000đ nhưng thu 50.000đ)
    const overPay = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/orders/${orderId}/payments`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: { payment_type: 'FINAL', amount: 50000 },
      },
    );
    assert.equal(overPay.status, 400);

    // E. Tất toán đúng 30.000đ còn lại -> Đã trả 100.000đ, Còn nợ 0đ (PAID)
    const payFinal = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/orders/${orderId}/payments`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: { payment_type: 'FINAL', amount: 30000 },
      },
    );
    assert.equal(payFinal.status, 201);
    assert.equal(payFinal.body.data.total_paid_amount, 100000);
    assert.equal(payFinal.body.data.remaining_debt_amount, 0);
    assert.equal(payFinal.body.data.payment_status, 'PAID');

    // F. Hoàn tiền (REFUND) 25.000đ -> Đã trả giảm về 75.000đ, Công nợ tăng lên 25.000đ (PARTIALLY_PAID)
    const refundOk = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/orders/${orderId}/payments`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          payment_type: 'REFUND',
          amount: 25000,
          note: 'Hoàn tiền chiết khấu',
        },
      },
    );
    assert.equal(refundOk.status, 201);
    assert.equal(refundOk.body.data.total_paid_amount, 75000);
    assert.equal(refundOk.body.data.remaining_debt_amount, 25000);
    assert.equal(refundOk.body.data.payment_status, 'PARTIALLY_PAID');

    // G. Chặn hoàn tiền vượt quá số tiền đã thu (đã thu ròng 75.000đ nhưng hoàn 80.000đ)
    const overRefund = await apiRequest(
      baseUrl,
      'POST',
      `/api/v1/print-quotes/orders/${orderId}/payments`,
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: { payment_type: 'REFUND', amount: 80000 },
      },
    );
    assert.equal(overRefund.status, 400);
  });

  it('6. QA-02: Xuất file .PDF A4 trực tiếp theo mã báo giá & Kiểm tra đơn giá sau phân bổ vận chuyển có làm tròn', async () => {
    // Tạo báo giá có số lượng lẻ (3 hộp) để kiểm tra làm tròn đơn giá sau phân bổ vận chuyển:
    // 3 hộp x (10.000đ vốn + 5.000đ lời) = 45.000đ + 55.000đ vận chuyển = 100.000đ
    // Đơn giá sau gộp ship = round(100.000 / 3) = 33.333đ; 33.333 x 3 = 99.999đ; Hiệu chỉnh làm tròn = +1đ -> Tổng = 100.000đ
    const qRes = await apiRequest(
      baseUrl,
      'POST',
      '/api/v1/print-quotes/quotes',
      {
        cookie: ownerCookie,
        csrfToken: ownerCsrf,
        body: {
          title: 'Báo giá Kiểm tra Làm tròn & Xuất PDF',
          shipping_fee: 55000,
          include_shipping_in_unit_price: true,
          items: [
            {
              id: 'ROUND-3',
              name: 'Hộp giấy Ivory 350gsm',
              unit: 'hộp',
              quantity: 3,
              unitVendorCost: 10000,
              profitMode: 'FIXED_AMOUNT',
              profitScope: 'PER_UNIT',
              profitValue: 5000,
            },
          ],
        },
      },
    );
    assert.equal(qRes.status, 201);
    const quote = qRes.body.data;
    assert.equal(quote.total_quote_amount, 100000);
    assert.equal(quote.single_product_final_unit_price, 33333);
    assert.equal(quote.total_rounding_adjustment, 1);

    // Tải trực tiếp file .pdf A4 theo mã báo giá
    const pdfRes = await fetch(
      `${baseUrl}/api/v1/print-quotes/quotes/${quote.id}/pdf-file`,
      {
        headers: { Cookie: ownerCookie },
      },
    );
    assert.equal(pdfRes.status, 200);
    assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');
    assert.equal(
      pdfRes.headers.get('content-disposition'),
      `attachment; filename="${quote.quote_code}.pdf"`,
    );
    const pdfBytes = Buffer.from(await pdfRes.arrayBuffer());
    assert.ok(
      pdfBytes.length > 10000,
      `Expected real Chromium A4 PDF with embedded Vietnamese Unicode font (>10KB), got ${pdfBytes.length} bytes`,
    );
    assert.equal(pdfBytes.subarray(0, 5).toString('ascii'), '%PDF-');
    const pdfRawLatin1 = pdfBytes.toString('latin1');
    assert.ok(
      pdfRawLatin1.includes('/CIDFontType2') ||
        pdfRawLatin1.includes('/TrueType') ||
        pdfRawLatin1.includes('/ToUnicode'),
      'PDF must contain embedded Unicode font / ToUnicode CMap for Vietnamese diacritics',
    );
    assert.ok(
      !pdfRawLatin1.includes('/BaseFont /Helvetica'),
      'PDF must not fall back to Type1 Helvetica ASCII without Vietnamese diacritics',
    );

    // Chặn fail-closed khi không có trình duyệt Chromium/Chrome/Edge (tuyệt đối không âm thầm trả về PDF mất dấu)
    await assert.rejects(
      () =>
        renderCustomerSafeA4PdfBuffer(
          quote.customer_pdf_json,
          { quoteCode: quote.quote_code },
          {
            CHROME_BIN: 'Z:\\nonexistent\\chrome.exe',
            EDGE_BIN: 'Z:\\nonexistent\\msedge.exe',
            ProgramFiles: 'Z:\\nonexistent',
            'ProgramFiles(x86)': 'Z:\\nonexistent',
            LOCALAPPDATA: 'Z:\\nonexistent',
          },
        ),
      (err) =>
        err instanceof PdfRendererUnavailableError &&
        /Không thể kết xuất file PDF A4 tiếng Việt/.test(err.message),
    );

    // Kiểm chứng Chrome/Edge headless chạy thành công dưới môi trường Windows Service (NT AUTHORITY\LocalService)
    // nơi USERPROFILE / LOCALAPPDATA / APPDATA / HOME bị khóa hoặc không truy cập được
    const servicePdfBuf = await renderCustomerSafeA4PdfBuffer(
      quote.customer_pdf_json,
      { quoteCode: quote.quote_code },
      {
        USERPROFILE: 'C:\\Windows\\ServiceProfiles\\LocalService',
        LOCALAPPDATA:
          'C:\\Windows\\ServiceProfiles\\LocalService\\AppData\\Local',
        APPDATA: 'C:\\Windows\\ServiceProfiles\\LocalService\\AppData\\Roaming',
        HOME: 'C:\\Windows\\ServiceProfiles\\LocalService',
      },
    );
    assert.ok(
      servicePdfBuf.length > 10000 &&
        servicePdfBuf.subarray(0, 5).toString('ascii') === '%PDF-',
      'PDF renderer must succeed under non-interactive Windows Service profile environment',
    );
  });
});
