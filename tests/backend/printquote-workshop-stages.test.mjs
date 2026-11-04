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
import {
  AreaInputMode,
  assertCustomerSafePdfPayload,
  buildCompactProductSummary,
  buildCustomerSafePdfPayload,
  calculatePrintQuote,
  computeExactAreaSqm,
  createQuoteOrderSnapshot,
  detectIncludedStageOverlaps,
  evaluatePendingCostDraftLines,
  FORBIDDEN_CUSTOMER_PDF_KEYS,
  multiplyRateByAreaSqmToVnd,
  PriceItemType,
  ProfitMode,
  ProfitScope,
  QuotePricingStatus,
  VendorCostMode,
  verifyQuoteSnapshotIntegrity,
} from '../../dist/packages/contracts/src/printquote.js';

const CSRF_SECRET = 'test-csrf-secret-pq-workshop-stages-32chars!';
const ALLOWED_ORIGIN = 'http://127.0.0.1:3000';

async function apiRequest(
  baseUrl,
  method,
  path,
  { cookie, csrfToken, idempotencyKey, body, rawResponse = false } = {},
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
  if (rawResponse) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, buffer: buf };
  }
  const json = await res.json();
  return { status: res.status, body: json };
}

describe('MGL-PRINTQUOTE — Giá Xưởng, Đa Công Đoạn Gia Công, m² Chính Xác & Nháp Chờ Giá Xưởng', () => {
  describe('A. Toán học Pricing Engine, Diện tích m², Chống cộng trùng & Tương thích dữ liệu cũ', () => {
    it('1. Tính chuẩn toàn bộ kịch bản bắt buộc: Cơ bản 4.000đ/tờ + Cán màng 1 mặt 2.000đ/tờ (1 tờ, 100 tờ, lời 1.000đ/tờ, ship 40.000đ 1 lần, gia công trọn lô 2.000đ)', () => {
      // 1a. 1 tờ -> vốn = 4.000 + 2.000 = 6.000đ
      const res1Sheet = calculatePrintQuote({
        items: [
          {
            id: 'L-1',
            name: 'Tờ rơi A4 C200',
            specification: 'A4 C200, in màu 2 mặt',
            unit: 'tờ',
            quantity: 1,
            vendorCostMode: VendorCostMode.PER_UNIT,
            baseCostRate: 4000,
            finishingStages: [
              {
                id: 'STG-1',
                name: 'Cán màng 1 mặt',
                pricingMode: VendorCostMode.PER_UNIT,
                rate: 2000,
                unit: 'tờ',
              },
            ],
            profit: {
              mode: ProfitMode.FIXED_AMOUNT,
              scope: ProfitScope.PER_UNIT,
              value: 0,
            },
          },
        ],
        shippingFee: 0,
      });
      assert.equal(res1Sheet.lines[0].baseVendorCost, 4000);
      assert.equal(res1Sheet.lines[0].finishingVendorCost, 2000);
      assert.equal(res1Sheet.totalVendorCost, 6000);

      // 1b. 100 tờ, lời 1.000đ/tờ, không phí phụ -> vốn 600.000đ, lời 100.000đ, báo khách 700.000đ
      const res100Sheets = calculatePrintQuote({
        items: [
          {
            id: 'L-100',
            name: 'Tờ rơi A4 C200',
            specification: 'A4 C200, in màu 2 mặt',
            unit: 'tờ',
            quantity: 100,
            vendorCostMode: VendorCostMode.PER_UNIT,
            baseCostRate: 4000,
            finishingStages: [
              {
                id: 'STG-1',
                name: 'Cán màng 1 mặt',
                pricingMode: VendorCostMode.PER_UNIT,
                rate: 2000,
                unit: 'tờ',
              },
            ],
            profit: {
              mode: ProfitMode.FIXED_AMOUNT,
              scope: ProfitScope.PER_UNIT,
              value: 1000,
            },
          },
        ],
        shippingFee: 0,
      });
      assert.equal(res100Sheets.lines[0].baseVendorCost, 400000);
      assert.equal(res100Sheets.lines[0].finishingVendorCost, 200000);
      assert.equal(res100Sheets.totalVendorCost, 600000);
      assert.equal(res100Sheets.totalProfit, 100000);
      assert.equal(res100Sheets.totalQuoteAmount, 700000);

      // 1c. Cộng thêm phí giao hàng toàn đơn 40.000đ -> tổng báo khách = 740.000đ (KHÔNG nhân 100 tờ)
      const resWithShipping = calculatePrintQuote({
        items: [
          {
            id: 'L-100-SHIP',
            name: 'Tờ rơi A4 C200',
            unit: 'tờ',
            quantity: 100,
            vendorCostMode: VendorCostMode.PER_UNIT,
            baseCostRate: 4000,
            finishingStages: [
              {
                id: 'STG-1',
                name: 'Cán màng 1 mặt',
                pricingMode: VendorCostMode.PER_UNIT,
                rate: 2000,
                unit: 'tờ',
              },
            ],
            profit: {
              mode: ProfitMode.FIXED_AMOUNT,
              scope: ProfitScope.PER_UNIT,
              value: 1000,
            },
          },
        ],
        shippingFee: 40000,
        includeShippingInUnitPrice: true,
      });
      assert.equal(resWithShipping.totalVendorCost, 600000);
      assert.equal(resWithShipping.totalProfit, 100000);
      assert.equal(resWithShipping.shippingFee, 40000);
      assert.equal(resWithShipping.totalQuoteAmount, 740000);

      // 1d. Gia công 2.000đ tính TRỌN LÔ cho 100 tờ -> vốn = 400.000 + 2.000 = 402.000đ (KHÔNG thành 600.000đ)
      const resBatchStage = calculatePrintQuote({
        items: [
          {
            id: 'L-100-BATCH-STG',
            name: 'Tờ rơi A4 C200',
            unit: 'tờ',
            quantity: 100,
            vendorCostMode: VendorCostMode.PER_UNIT,
            baseCostRate: 4000,
            finishingStages: [
              {
                id: 'STG-BATCH',
                name: 'Bế demi trọn lô',
                pricingMode: VendorCostMode.TOTAL_BATCH,
                rate: 2000,
                unit: 'lô',
              },
            ],
            profit: {
              mode: ProfitMode.FIXED_AMOUNT,
              scope: ProfitScope.TOTAL_BATCH,
              value: 0,
            },
          },
        ],
        shippingFee: 0,
      });
      assert.equal(resBatchStage.lines[0].baseVendorCost, 400000);
      assert.equal(resBatchStage.lines[0].finishingVendorCost, 2000);
      assert.equal(resBatchStage.totalVendorCost, 402000);

      // PDF gửi khách tuyệt đối không rò rỉ giá vốn cơ bản, giá vốn gia công hay lợi nhuận
      const safePdf = buildCustomerSafePdfPayload(resWithShipping);
      assertCustomerSafePdfPayload(safePdf);
      const serializedPdf = JSON.stringify(safePdf);
      for (const forbidden of FORBIDDEN_CUSTOMER_PDF_KEYS) {
        assert.equal(
          serializedPdf.includes(`"${forbidden}"`),
          false,
          `Customer PDF must not leak ${forbidden}`,
        );
      }
    });

    it('2. Tính chính xác diện tích m² không lệch dấu phẩy động: 0,8m × 1,2m × 3 tấm = 2,88m² × 50.000đ/m² = 144.000đ; lưu tách biệt m² thực tế và m² tính tiền', () => {
      const exactSqm = computeExactAreaSqm(0.8, 1.2, 3);
      assert.equal(exactSqm, 2.88);
      assert.equal(multiplyRateByAreaSqmToVnd(50000, exactSqm), 144000);

      const calcExact = calculatePrintQuote({
        items: [
          {
            id: 'BANNER-1',
            name: 'Bạt Hiflex khổ lớn',
            unit: 'tấm',
            quantity: 3,
            vendorCostMode: VendorCostMode.PER_SQM,
            baseCostRate: 50000,
            areaSpec: {
              mode: AreaInputMode.DIMENSIONS,
              widthM: 0.8,
              heightM: 1.2,
              sheetsCount: 3,
            },
            profit: {
              mode: ProfitMode.FIXED_AMOUNT,
              scope: ProfitScope.PER_SQM,
              value: 10000,
            },
          },
        ],
        shippingFee: 0,
      });
      assert.equal(calcExact.lines[0].areaSpec.actualAreaSqm, 2.88);
      assert.equal(calcExact.lines[0].areaSpec.billableAreaSqm, 2.88);
      assert.equal(calcExact.totalVendorCost, 144000);
      assert.equal(calcExact.totalProfit, 28800);
      assert.equal(calcExact.totalQuoteAmount, 172800);

      // Khi Owner chủ động nhập m² tính tiền riêng (3.0 m²), vẫn lưu rõ cả thực tế 2.88 m² và tính tiền 3.0 m²
      const calcAdjustedArea = calculatePrintQuote({
        items: [
          {
            id: 'BANNER-ADJ',
            name: 'PP ngoài trời',
            unit: 'tấm',
            quantity: 3,
            vendorCostMode: VendorCostMode.PER_SQM,
            baseCostRate: 50000,
            areaSpec: {
              mode: AreaInputMode.DIMENSIONS,
              widthM: 0.8,
              heightM: 1.2,
              sheetsCount: 3,
              billableAreaSqm: 3,
            },
            profit: {
              mode: ProfitMode.FIXED_AMOUNT,
              scope: ProfitScope.TOTAL_BATCH,
              value: 0,
            },
          },
        ],
        shippingFee: 0,
      });
      assert.equal(calcAdjustedArea.lines[0].areaSpec.actualAreaSqm, 2.88);
      assert.equal(calcAdjustedArea.lines[0].areaSpec.billableAreaSqm, 3);
      assert.equal(calcAdjustedArea.totalVendorCost, 150000);
    });

    it('3. Cảnh báo cộng trùng công đoạn đã bao gồm trong giá cơ bản, chặn công đoạn trùng lặp, phân biệt rõ giá trống (null) với giá 0, và giữ nguyên hash snapshot cũ', () => {
      const overlaps = detectIncludedStageOverlaps({
        baseIncludedStages: ['Cán màng 1 mặt'],
        finishingStages: [
          { id: 's1', name: 'Cán màng mờ 1 mặt' },
          { id: 's2', name: 'Bo góc' },
        ],
      });
      assert.equal(overlaps.length, 1);
      assert.equal(overlaps[0].stageId, 's1');

      const summary = buildCompactProductSummary({
        specification: 'A4 C200, In màu 2 mặt',
        finishingStageNames: ['Cán màng 1 mặt'],
      });
      assert.equal(summary, 'A4 C200 · In màu 2 mặt · Cán màng 1 mặt');

      // Chặn thêm trùng 2 công đoạn giống hệt nhau trên cùng 1 dòng
      assert.throws(
        () =>
          calculatePrintQuote({
            items: [
              {
                id: 'DUP-1',
                name: 'Danh thiếp',
                quantity: 5,
                vendorCostMode: VendorCostMode.PER_UNIT,
                baseCostRate: 20000,
                finishingStages: [
                  {
                    id: 's1',
                    name: 'Bo góc',
                    pricingMode: VendorCostMode.PER_UNIT,
                    rate: 5000,
                  },
                  {
                    id: 's2',
                    name: 'bo goc',
                    pricingMode: VendorCostMode.PER_UNIT,
                    rate: 5000,
                  },
                ],
              },
            ],
          }),
        /nhập trùng/i,
      );

      // Phân biệt giá 0 (hợp lệ, không pending) với giá trống null (pending)
      const zeroEval = evaluatePendingCostDraftLines([
        {
          id: 'Z1',
          name: 'Tờ hướng dẫn tặng kèm',
          quantity: 1,
          baseCostRate: 0,
          finishingStages: [{ name: 'Cắt tay', rate: 0 }],
        },
      ]);
      assert.equal(zeroEval.hasPendingCost, false);

      const nullEval = evaluatePendingCostDraftLines([
        {
          id: 'N1',
          name: 'Hộp cứng ép kim',
          quantity: 1,
          baseCostRate: 15000,
          finishingStages: [
            {
              id: 'st-1',
              name: 'Ép kim logo',
              pricingMode: VendorCostMode.PER_UNIT,
              rate: null,
            },
          ],
        },
      ]);
      assert.equal(nullEval.hasPendingCost, true);
      assert.deepEqual(nullEval.pendingSummary[0].missingStageNames, [
        'Ép kim logo',
      ]);

      // Đảm bảo snapshot cũ (không có trường mở rộng) vẫn khớp SHA-256 100%
      const legacyCalc = calculatePrintQuote({
        items: [
          {
            id: 'OLD-1',
            name: 'Tờ rơi cũ',
            unit: 'tờ',
            quantity: 100,
            unitVendorCost: 500,
            profit: {
              mode: ProfitMode.FIXED_AMOUNT,
              scope: ProfitScope.PER_UNIT,
              value: 200,
            },
          },
        ],
        shippingFee: 30000,
      });
      const legacySnap = createQuoteOrderSnapshot(legacyCalc, {
        orderId: 'ORD-OLD',
        quoteId: 'BG-OLD',
        status: 'FINALIZED',
        createdAt: '2026-11-01T00:00:00.000Z',
        finalizedAt: '2026-11-01T01:00:00.000Z',
      });
      assert.equal(verifyQuoteSnapshotIntegrity(legacySnap), true);
    });
  });

  describe('B. Tích hợp PostgreSQL Cô Lập (:55433) — Bảng Giá Xưởng, Lịch Sử Bất Biến, Nháp Chờ Giá Xưởng & Phân Quyền Owner', () => {
    let pool;
    let server;
    let baseUrl;
    let workspaceId;
    let ownerCookie;
    let ownerCsrf;
    let staffCookie;
    let staffCsrf;
    let adminCookie;
    let adminCsrf;

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
      const adminUserId = crypto.randomUUID();
      const shortId = workspaceId.slice(0, 8);

      await pool.query(
        `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active')`,
        [workspaceId, `PQ Stages Test WS ${shortId}`],
      );

      await pool.query(
        `INSERT INTO users (id, username_normalized, email_normalized, status)
         VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active'), ($7, $8, $9, 'active')`,
        [
          ownerUserId,
          `owner_st_${shortId}`,
          `owner-st-${shortId}@test.local`,
          staffUserId,
          `staff_st_${shortId}`,
          `staff-st-${shortId}@test.local`,
          adminUserId,
          `admin_st_${shortId}`,
          `admin-st-${shortId}@test.local`,
        ],
      );

      await pool.query(
        `INSERT INTO user_credentials (user_id, password_hash, credential_version)
         VALUES ($1, 'argon2id$stub', 1), ($2, 'argon2id$stub', 1), ($3, 'argon2id$stub', 1)`,
        [ownerUserId, staffUserId, adminUserId],
      );

      await pool.query(
        `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, status)
         VALUES ($1, $2, $3, 'owner', 'active'),
                ($4, $2, $5, 'staff', 'active'),
                ($6, $2, $7, 'staff', 'active')`,
        [
          crypto.randomUUID(),
          workspaceId,
          ownerUserId,
          crypto.randomUUID(),
          staffUserId,
          crypto.randomUUID(),
          adminUserId,
        ],
      );

      await pool.query(
        `INSERT INTO user_workspace_bindings (user_id, workspace_id, status, version)
         VALUES ($1, $2, 'active', 1), ($3, $2, 'active', 1), ($4, $2, 'active', 1)`,
        [ownerUserId, workspaceId, staffUserId, adminUserId],
      );

      await pool.query(
        `INSERT INTO employees (id, workspace_id, user_id, employee_code, full_name, employment_status, sub_role, sub_permissions)
         VALUES ($1, $2, $3, 'ADM01', 'Sub-Admin Test', 'active', 'admin', $4::jsonb)`,
        [
          crypto.randomUUID(),
          workspaceId,
          adminUserId,
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

      const issueSession = async (uid, prefix) => {
        const rawTok = `${prefix}-tok-${crypto.randomUUID()}`;
        const tokHash = hashToken(rawTok);
        await pool.query(
          `INSERT INTO auth_sessions (
             id, workspace_id, user_id, session_token_hash,
             credential_version_at_issue, idle_expires_at, absolute_expires_at, remember_me
           ) VALUES ($1, $2, $3, $4, 1, now() + interval '4 hours', now() + interval '24 hours', false)`,
          [crypto.randomUUID(), workspaceId, uid, tokHash],
        );
        return {
          cookie: `mglite_session=${rawTok}`,
          csrf: generateCsrfToken(tokHash, CSRF_SECRET),
        };
      };

      const ownerSess = await issueSession(ownerUserId, 'owner');
      ownerCookie = ownerSess.cookie;
      ownerCsrf = ownerSess.csrf;

      const staffSess = await issueSession(staffUserId, 'staff');
      staffCookie = staffSess.cookie;
      staffCsrf = staffSess.csrf;

      const adminSess = await issueSession(adminUserId, 'admin');
      adminCookie = adminSess.cookie;
      adminCsrf = adminSess.csrf;

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

    it('1. Không tự nạp giá mẫu khi workspace mới tạo; cho phép tạo Giá xưởng chung (vendor_id = null) cả BASE_PRINT lẫn FINISHING', async () => {
      const initialList = await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/price-items',
        { cookie: ownerCookie },
      );
      assert.equal(initialList.status, 200);
      assert.equal(initialList.body.data.items.length, 0);

      // Tạo giá cơ bản không cần chọn nhà in (vendor_id = null)
      const baseRes = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/price-items',
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          idempotencyKey: 'idem-base-a4-c200',
          body: {
            vendor_id: null,
            name: 'A4 C200, in màu 2 mặt',
            item_type: PriceItemType.BASE_PRINT,
            category: 'Giấy',
            specification: 'A4, Couche C200, In màu 2 mặt',
            included_stages: [],
            conditions_note: 'Áp dụng từ 50 tờ trở lên',
            unit: 'tờ',
            pricing_mode: VendorCostMode.PER_UNIT,
            unit_cost: 4000,
            default_profit_mode: ProfitMode.FIXED_AMOUNT,
            default_profit_scope: ProfitScope.PER_UNIT,
            default_profit_value: 1000,
          },
        },
      );
      assert.equal(baseRes.status, 201);
      assert.equal(baseRes.body.data.vendor_id, null);
      assert.equal(baseRes.body.data.item_type, 'BASE_PRINT');
      assert.equal(baseRes.body.data.unit_cost, 4000);

      // Tạo giá gia công (FINISHING)
      const finRes = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/price-items',
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          idempotencyKey: 'idem-fin-canmang1',
          body: {
            vendor_id: null,
            name: 'Cán màng 1 mặt',
            item_type: PriceItemType.FINISHING,
            category: 'Công đoạn gia công',
            specification: 'Màng mờ hoặc bóng 1 mặt',
            unit: 'tờ',
            pricing_mode: VendorCostMode.PER_UNIT,
            unit_cost: 2000,
          },
        },
      );
      assert.equal(finRes.status, 201);
      assert.equal(finRes.body.data.item_type, 'FINISHING');
      assert.equal(finRes.body.data.unit_cost, 2000);
    });

    it('2. Sửa giá xưởng ghi lịch sử (CREATED -> UPDATED), KHÔNG làm đổi báo giá đã lưu; chặn xóa mục đã dùng (409 PRICE_ITEM_IN_USE), cho phép Ngừng dùng & Khôi phục, cho xóa mục chưa dùng', async () => {
      const itemsRes = await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/price-items',
        { cookie: ownerCookie },
      );
      const baseItem = itemsRes.body.data.items.find(
        (i) => i.item_type === 'BASE_PRINT',
      );
      const finItem = itemsRes.body.data.items.find(
        (i) => i.item_type === 'FINISHING',
      );
      assert.ok(baseItem && finItem);

      // Lưu báo giá 100 tờ x (4.000 + 2.000 + lời 1.000) + ship 40.000 = 740.000đ
      const savedQuoteRes = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/quotes',
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          idempotencyKey: 'idem-quote-740k',
          body: {
            title: 'Báo giá 100 tờ A4 C200 cán màng 1 mặt',
            shipping_fee: 40000,
            include_shipping_in_unit_price: true,
            items: [
              {
                id: 'LINE-100',
                vendor_price_item_id: baseItem.id,
                name: baseItem.name,
                specification: baseItem.specification,
                unit: 'tờ',
                quantity: 100,
                vendorCostMode: VendorCostMode.PER_UNIT,
                baseCostRate: 4000,
                finishingStages: [
                  {
                    id: 'STG-1',
                    priceItemId: finItem.id,
                    name: finItem.name,
                    pricingMode: VendorCostMode.PER_UNIT,
                    rate: 2000,
                    unit: 'tờ',
                  },
                ],
                profitMode: ProfitMode.FIXED_AMOUNT,
                profitScope: ProfitScope.PER_UNIT,
                profitValue: 1000,
              },
            ],
          },
        },
      );
      assert.equal(savedQuoteRes.status, 201);
      const savedQuote = savedQuoteRes.body.data;
      assert.equal(savedQuote.total_vendor_cost, 600000);
      assert.equal(savedQuote.total_profit, 100000);
      assert.equal(savedQuote.total_quote_amount, 740000);
      const originalHash = savedQuote.integrity_hash;

      // Sửa giá bảng giá gốc từ 4.000đ -> 5.500đ
      const patchBase = await apiRequest(
        baseUrl,
        'PATCH',
        `/api/v1/print-quotes/price-items/${baseItem.id}`,
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          body: {
            unit_cost: 5500,
            change_note: 'Xưởng tăng giá giấy C200',
          },
        },
      );
      assert.equal(patchBase.status, 200);
      assert.equal(patchBase.body.data.unit_cost, 5500);
      assert.equal(patchBase.body.data.version, 2);

      // Kiểm tra lịch sử bảng giá lưu đủ CREATED & UPDATED kèm người sửa và thời gian
      const histRes = await apiRequest(
        baseUrl,
        'GET',
        `/api/v1/print-quotes/price-items/${baseItem.id}/history`,
        { cookie: ownerCookie },
      );
      assert.equal(histRes.status, 200);
      const actions = histRes.body.data.items.map((h) => h.action);
      assert.equal(actions.includes('CREATED'), true);
      assert.equal(actions.includes('UPDATED'), true);

      // Kiểm tra báo giá đã lưu trước đó KHÔNG BỊ ĐỔI SỐ LIỆU HAY HASH
      const rereadQuote = await apiRequest(
        baseUrl,
        'GET',
        `/api/v1/print-quotes/quotes/${savedQuote.id}`,
        { cookie: ownerCookie },
      );
      assert.equal(rereadQuote.status, 200);
      assert.equal(rereadQuote.body.data.total_vendor_cost, 600000);
      assert.equal(rereadQuote.body.data.total_quote_amount, 740000);
      assert.equal(rereadQuote.body.data.integrity_hash, originalHash);

      // Chặn xóa vĩnh viễn mục giá đã dùng trong báo giá (409 PRICE_ITEM_IN_USE)
      const delUsed = await apiRequest(
        baseUrl,
        'DELETE',
        `/api/v1/print-quotes/price-items/${baseItem.id}`,
        { cookie: ownerCookie, csrfToken: ownerCsrf },
      );
      assert.equal(delUsed.status, 409);
      assert.equal(delUsed.body.error.code, 'PRICE_ITEM_IN_USE');

      // Ngừng dùng -> chặn dùng cho báo giá mới -> Khôi phục lại thành công
      const deactRes = await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/price-items/${finItem.id}/deactivate`,
        { cookie: ownerCookie, csrfToken: ownerCsrf, body: {} },
      );
      assert.equal(deactRes.status, 200);
      assert.equal(deactRes.body.data.is_active, false);

      const quoteWithInactiveStage = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/quotes',
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          idempotencyKey: 'idem-inactive-stage-block',
          body: {
            title: 'Thử dùng gia công đã ngừng',
            items: [
              {
                id: 'L1',
                name: 'Tờ rơi',
                quantity: 50,
                vendorCostMode: VendorCostMode.PER_UNIT,
                baseCostRate: 4000,
                finishingStages: [
                  {
                    id: 'S1',
                    priceItemId: finItem.id,
                    name: finItem.name,
                    pricingMode: VendorCostMode.PER_UNIT,
                    rate: 2000,
                  },
                ],
                profitMode: ProfitMode.FIXED_AMOUNT,
                profitScope: ProfitScope.PER_UNIT,
                profitValue: 500,
              },
            ],
          },
        },
      );
      assert.equal(quoteWithInactiveStage.status, 409);

      const restoreRes = await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/price-items/${finItem.id}/restore`,
        { cookie: ownerCookie, csrfToken: ownerCsrf, body: {} },
      );
      assert.equal(restoreRes.status, 200);
      assert.equal(restoreRes.body.data.is_active, true);

      // Mục mới tạo chưa từng dùng trong báo giá -> cho phép xóa vĩnh viễn (200)
      const unusedItem = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/price-items',
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          idempotencyKey: 'idem-unused-temp',
          body: {
            vendor_id: null,
            name: 'Mục nháp gõ nhầm chưa dùng',
            item_type: PriceItemType.FINISHING,
            unit: 'lô',
            pricing_mode: VendorCostMode.TOTAL_BATCH,
            batch_total_cost: 30000,
          },
        },
      );
      assert.equal(unusedItem.status, 201);
      const delUnused = await apiRequest(
        baseUrl,
        'DELETE',
        `/api/v1/print-quotes/price-items/${unusedItem.body.data.id}`,
        { cookie: ownerCookie, csrfToken: ownerCsrf },
      );
      assert.equal(delUnused.status, 200);
    });

    it('3. Vòng đời Nháp "Chờ giá xưởng" (PENDING_COST): cho lưu nháp khi trống giá, chặn tuyệt đối PDF/Chốt/Tạo đơn (409), mở khóa khi điền đủ giá & cho xóa nháp DRAFT', async () => {
      // Lưu nháp khi công đoạn Ép kim chưa có giá (rate: null)
      const pendingRes = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/quotes',
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          idempotencyKey: 'idem-pending-quote-1',
          body: {
            title: 'Báo giá hộp quà chờ giá ép kim',
            pricing_status: QuotePricingStatus.PENDING_COST,
            shipping_fee: 30000,
            items: [
              {
                id: 'BOX-1',
                name: 'Hộp giấy Ivory 350gsm',
                specification: 'In màu 1 mặt, bế dán thành phẩm',
                unit: 'hộp',
                quantity: 200,
                vendorCostMode: VendorCostMode.PER_UNIT,
                baseCostRate: 12000,
                baseCostPending: false,
                finishingStages: [
                  {
                    id: 'STG-FOIL',
                    name: 'Ép kim logo nhũ vàng',
                    pricingMode: VendorCostMode.TOTAL_BATCH,
                    rate: null,
                    ratePending: true,
                    unit: 'lô',
                  },
                ],
                profitMode: ProfitMode.FIXED_AMOUNT,
                profitScope: ProfitScope.PER_UNIT,
                profitValue: 3000,
              },
            ],
          },
        },
      );
      assert.equal(pendingRes.status, 201);
      const pendingQuote = pendingRes.body.data;
      assert.equal(pendingQuote.status, 'DRAFT');
      assert.equal(pendingQuote.pricing_status, 'PENDING_COST');
      assert.equal(pendingQuote.customer_pdf_json, null);

      // Chặn xuất PDF JSON, tải file PDF, Chốt báo giá và Chuyển thành đơn hàng khi đang PENDING_COST
      const pdfJsonBlocked = await apiRequest(
        baseUrl,
        'GET',
        `/api/v1/print-quotes/quotes/${pendingQuote.id}/pdf`,
        { cookie: ownerCookie },
      );
      assert.equal(pdfJsonBlocked.status, 409);
      assert.equal(pdfJsonBlocked.body.error.code, 'QUOTE_PENDING_VENDOR_COST');

      const pdfFileBlocked = await apiRequest(
        baseUrl,
        'GET',
        `/api/v1/print-quotes/quotes/${pendingQuote.id}/pdf-file`,
        { cookie: ownerCookie },
      );
      assert.equal(pdfFileBlocked.status, 409);
      assert.equal(pdfFileBlocked.body.error.code, 'QUOTE_PENDING_VENDOR_COST');

      const finalizeBlocked = await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/quotes/${pendingQuote.id}/finalize`,
        { cookie: ownerCookie, csrfToken: ownerCsrf, body: {} },
      );
      assert.equal(finalizeBlocked.status, 409);
      assert.equal(
        finalizeBlocked.body.error.code,
        'QUOTE_PENDING_VENDOR_COST',
      );

      const orderBlocked = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/orders',
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          idempotencyKey: 'idem-order-blocked-pending',
          body: { quote_id: pendingQuote.id },
        },
      );
      assert.equal(orderBlocked.status, 409);
      assert.equal(orderBlocked.body.error.code, 'QUOTE_PENDING_VENDOR_COST');

      // Điền giá Ép kim trọn lô = 500.000đ -> tự động chuyển sang COMPLETE & tính chuẩn
      // Vốn = (200 * 12.000) + 500.000 = 2.900.000đ; Lời = 200 * 3.000 = 600.000đ; Ship = 30.000đ -> Tổng = 3.530.000đ
      const completedRes = await apiRequest(
        baseUrl,
        'PATCH',
        `/api/v1/print-quotes/quotes/${pendingQuote.id}`,
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          body: {
            title: 'Báo giá hộp quà đã có giá ép kim',
            shipping_fee: 30000,
            include_shipping_in_unit_price: true,
            change_note: 'Đã nhận báo giá khuôn ép kim từ xưởng',
            items: [
              {
                id: 'BOX-1',
                name: 'Hộp giấy Ivory 350gsm',
                specification: 'In màu 1 mặt, bế dán thành phẩm',
                unit: 'hộp',
                quantity: 200,
                vendorCostMode: VendorCostMode.PER_UNIT,
                baseCostRate: 12000,
                finishingStages: [
                  {
                    id: 'STG-FOIL',
                    name: 'Ép kim logo nhũ vàng',
                    pricingMode: VendorCostMode.TOTAL_BATCH,
                    rate: 500000,
                    unit: 'lô',
                  },
                ],
                profitMode: ProfitMode.FIXED_AMOUNT,
                profitScope: ProfitScope.PER_UNIT,
                profitValue: 3000,
              },
            ],
          },
        },
      );
      assert.equal(completedRes.status, 200);
      assert.equal(completedRes.body.data.pricing_status, 'COMPLETE');
      assert.equal(completedRes.body.data.total_vendor_cost, 2900000);
      assert.equal(completedRes.body.data.total_profit, 600000);
      assert.equal(completedRes.body.data.total_quote_amount, 3530000);
      assert.ok(completedRes.body.data.customer_pdf_json);

      // Chốt báo giá -> sau khi chốt không cho xóa nháp (409)
      const finOk = await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/quotes/${pendingQuote.id}/finalize`,
        { cookie: ownerCookie, csrfToken: ownerCsrf, body: {} },
      );
      assert.equal(finOk.status, 200);

      const delFinalizedBlocked = await apiRequest(
        baseUrl,
        'DELETE',
        `/api/v1/print-quotes/quotes/${pendingQuote.id}`,
        { cookie: ownerCookie, csrfToken: ownerCsrf },
      );
      assert.equal(delFinalizedBlocked.status, 409);

      // Bản nháp DRAFT chưa chốt -> cho phép xóa sạch (200)
      const tempDraft = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/quotes',
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          idempotencyKey: 'idem-temp-draft-del',
          body: {
            title: 'Nháp tạm cần xóa',
            pricing_status: QuotePricingStatus.PENDING_COST,
            items: [
              {
                id: 'TMP-1',
                name: 'Banner nháp',
                unit: 'tấm',
                quantity: 2,
                vendorCostMode: VendorCostMode.PER_UNIT,
                baseCostRate: null,
                baseCostPending: true,
                profitMode: ProfitMode.FIXED_AMOUNT,
                profitScope: ProfitScope.PER_UNIT,
                profitValue: 0,
              },
            ],
          },
        },
      );
      assert.equal(tempDraft.status, 201);
      const delDraftOk = await apiRequest(
        baseUrl,
        'DELETE',
        `/api/v1/print-quotes/quotes/${tempDraft.body.data.id}`,
        { cookie: ownerCookie, csrfToken: ownerCsrf },
      );
      assert.equal(delDraftOk.status, 200);
    });

    it('4. Bảo mật phân quyền: Staff và Admin bị từ chối 403 FORBIDDEN trên toàn bộ endpoint Giá xưởng & Báo giá mới', async () => {
      for (const actor of [
        { label: 'staff', cookie: staffCookie, csrf: staffCsrf },
        { label: 'admin', cookie: adminCookie, csrf: adminCsrf },
      ]) {
        const listRes = await apiRequest(
          baseUrl,
          'GET',
          '/api/v1/print-quotes/price-items',
          { cookie: actor.cookie },
        );
        assert.equal(listRes.status, 403, `${actor.label} GET price-items`);

        const histRes = await apiRequest(
          baseUrl,
          'GET',
          `/api/v1/print-quotes/price-items/${crypto.randomUUID()}/history`,
          { cookie: actor.cookie },
        );
        assert.equal(histRes.status, 403, `${actor.label} GET history`);

        const deactRes = await apiRequest(
          baseUrl,
          'POST',
          `/api/v1/print-quotes/price-items/${crypto.randomUUID()}/deactivate`,
          { cookie: actor.cookie, csrfToken: actor.csrf, body: {} },
        );
        assert.equal(deactRes.status, 403, `${actor.label} POST deactivate`);

        const delQuoteRes = await apiRequest(
          baseUrl,
          'DELETE',
          `/api/v1/print-quotes/quotes/${crypto.randomUUID()}`,
          { cookie: actor.cookie, csrfToken: actor.csrf },
        );
        assert.equal(delQuoteRes.status, 403, `${actor.label} DELETE quote`);
      }
    });
  });
});
