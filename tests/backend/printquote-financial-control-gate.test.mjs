import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
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
import { generateCsrfToken } from '../../dist/packages/security/src/csrf.js';
import { hashToken } from '../../dist/packages/security/src/tokens.js';
import {
  AreaInputMode,
  assertCustomerSafePdfPayload,
  buildCustomerSafePdfPayload,
  calculatePrintQuote,
  createPendingCostQuoteSnapshot,
  FORBIDDEN_CUSTOMER_PDF_KEYS,
  LineCostSource,
  PriceItemType,
  ProfitBasis,
  ProfitMode,
  ProfitScope,
  QuotePricingStatus,
  RoundingMode,
  ShippingAllocationStrategy,
  VendorCostMode,
  verifyQuoteSnapshotIntegrity,
} from '../../dist/packages/contracts/src/printquote.js';

import { validateQuoteDraftInputs } from '../../dist/apps/web/src/screens/helpers/printquote-helpers.js';
import { EMPTY_DRAFT_LINE } from '../../dist/apps/web/src/screens/printquote/types.js';
import { OrdersTab } from '../../dist/apps/web/src/screens/printquote/OrdersTab.js';
import { AnalyticsTab } from '../../dist/apps/web/src/screens/printquote/AnalyticsTab.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const CSRF_SECRET = 'test-csrf-secret-pq-fin-control-32chars!!';
const ALLOWED_ORIGIN = 'http://127.0.0.1:3000';

async function apiRequest(
  baseUrl,
  method,
  urlPath,
  { cookie, csrfToken, idempotencyKey, body, rawResponse = false } = {},
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
  if (rawResponse) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, buffer: buf };
  }
  const json = await res.json();
  return { status: res.status, body: json };
}

describe('MGL-PRINTQUOTE — Cổng Kiểm Soát Tính Toán Tài Chính (Phase 1..3 Independent Verification)', () => {
  describe('A. Bộ đối soát tính tay độc lập (TC-01 -> TC-08 & Giới hạn biên)', () => {
    it('TC-01A & TC-01B: Cơ bản PER_UNIT 4.000đ + Gia công PER_UNIT 2.000đ (1 tờ = 6.000đ; 100 tờ + lời 1.000đ/tờ = vốn 600.000đ, lời 100.000đ, báo khách 700.000đ)', () => {
      // Hand-calculated expected values (NOT computed via engine)
      const calc1 = calculatePrintQuote({
        items: [
          {
            id: 'TC01A',
            name: 'A4 C200 in 2 mặt',
            unit: 'tờ',
            quantity: 1,
            vendorCostMode: VendorCostMode.PER_UNIT,
            baseCostRate: 4000,
            finishingStages: [
              {
                id: 'S1',
                name: 'Cán màng 1 mặt',
                pricingMode: VendorCostMode.PER_UNIT,
                rate: 2000,
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
      assert.equal(calc1.lines[0].baseVendorCost, 4000);
      assert.equal(calc1.lines[0].finishingVendorCost, 2000);
      assert.equal(calc1.totalVendorCost, 6000);
      assert.equal(calc1.totalProfit, 0);
      assert.equal(calc1.totalQuoteAmount, 6000);

      const calc100 = calculatePrintQuote({
        items: [
          {
            id: 'TC01B',
            name: 'A4 C200 in 2 mặt',
            unit: 'tờ',
            quantity: 100,
            vendorCostMode: VendorCostMode.PER_UNIT,
            baseCostRate: 4000,
            finishingStages: [
              {
                id: 'S1',
                name: 'Cán màng 1 mặt',
                pricingMode: VendorCostMode.PER_UNIT,
                rate: 2000,
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
      assert.equal(calc100.lines[0].baseVendorCost, 400_000);
      assert.equal(calc100.lines[0].finishingVendorCost, 200_000);
      assert.equal(calc100.totalVendorCost, 600_000);
      assert.equal(calc100.totalProfit, 100_000);
      assert.equal(calc100.totalQuoteAmount, 700_000);
      const pdf100 = buildCustomerSafePdfPayload(calc100);
      assert.equal(pdf100.grandTotalPayable, 700_000);
    });

    it('TC-02: Kết hợp Gia công PER_UNIT (2.000×100=200.000) + Gia công TOTAL_BATCH (2.000 trọn lô) + Ship 40.000đ cộng đúng 1 lần = 742.000đ', () => {
      const calc = calculatePrintQuote({
        items: [
          {
            id: 'TC02',
            name: 'Tờ rơi A4 C200 bế khuôn',
            unit: 'tờ',
            quantity: 100,
            vendorCostMode: VendorCostMode.PER_UNIT,
            baseCostRate: 4000,
            finishingStages: [
              {
                id: 'S1',
                name: 'Cán màng 1 mặt',
                pricingMode: VendorCostMode.PER_UNIT,
                rate: 2000,
              },
              {
                id: 'S2',
                name: 'Lên khuôn bế trọn lô',
                pricingMode: VendorCostMode.TOTAL_BATCH,
                rate: 2000,
              },
            ],
            profit: {
              mode: ProfitMode.FIXED_AMOUNT,
              scope: ProfitScope.PER_UNIT,
              value: 1000,
            },
          },
        ],
        shippingFee: 40_000,
        includeShippingInUnitPrice: true,
      });
      assert.equal(calc.lines[0].baseVendorCost, 400_000);
      assert.equal(calc.lines[0].finishingVendorCost, 202_000);
      assert.equal(calc.totalVendorCost, 602_000);
      assert.equal(calc.totalProfit, 100_000);
      assert.equal(calc.shippingFee, 40_000);
      assert.equal(calc.totalQuoteAmount, 742_000);
      const pdf = buildCustomerSafePdfPayload(calc);
      assert.equal(pdf.shippingAmountToAddOnPdfFooter, 0);
      assert.equal(pdf.lines[0].unitPrice, 7420);
      assert.equal(pdf.lines[0].lineTotal, 742_000);
      assert.equal(pdf.grandTotalPayable, 742_000);
    });

    it('TC-03: Diện tích thập phân 0.85m × 1.25m × 3 tấm = 3.1875 m² (làm tròn HALF_UP cuối dòng: 143.437,5 -> 143.438; tổng báo khách = 263.563đ)', () => {
      const calc = calculatePrintQuote({
        items: [
          {
            id: 'TC03',
            name: 'Standee PP cán mờ đóng khoen',
            unit: 'tấm',
            quantity: 3,
            vendorCostMode: VendorCostMode.PER_SQM,
            baseCostRate: 45_000,
            areaSpec: {
              mode: AreaInputMode.DIMENSIONS,
              widthM: 0.85,
              heightM: 1.25,
              sheetsCount: 3,
            },
            finishingStages: [
              {
                id: 'S1',
                name: 'Cán mờ khổ lớn',
                pricingMode: VendorCostMode.PER_SQM,
                rate: 12_000,
              },
              {
                id: 'S2',
                name: 'Đóng khoen trọn bộ',
                pricingMode: VendorCostMode.TOTAL_BATCH,
                rate: 15_000,
              },
            ],
            profit: {
              mode: ProfitMode.FIXED_AMOUNT,
              scope: ProfitScope.PER_SQM,
              value: 10_000,
            },
          },
        ],
        shippingFee: 35_000,
        includeShippingInUnitPrice: false,
      });

      assert.equal(calc.lines[0].areaSpec?.actualAreaSqm, 3.1875);
      assert.equal(calc.lines[0].areaSpec?.billableAreaSqm, 3.1875);
      // 3.1875 * 45000 = 143437.5 -> HALF_UP = 143438
      assert.equal(calc.lines[0].baseVendorCost, 143_438);
      // 3.1875 * 12000 = 38250 + 15000 = 53250
      assert.equal(calc.lines[0].finishingVendorCost, 53_250);
      assert.equal(calc.totalVendorCost, 196_688);
      // 3.1875 * 10000 = 31875
      assert.equal(calc.totalProfit, 31_875);
      // 196688 + 31875 + 35000 = 263563
      assert.equal(calc.totalQuoteAmount, 263_563);

      const pdf = buildCustomerSafePdfPayload(calc);
      assert.equal(pdf.lines[0].lineTotal, 228_563);
      assert.equal(pdf.shippingAmountToAddOnPdfFooter, 35_000);
      assert.equal(
        pdf.lines.reduce((s, l) => s + l.lineTotal, 0) +
          pdf.shippingAmountToAddOnPdfFooter,
        pdf.grandTotalPayable,
      );
      assert.equal(pdf.grandTotalPayable, 263_563);
    });

    it('TC-04: Chênh lệch billableAreaSqm (3.0) != actualAreaSqm (2.88) bắt buộc có adjustmentReason khi bật cổng kiểm soát, và không rò rỉ ra PDF', () => {
      assert.throws(
        () =>
          calculatePrintQuote({
            requireAreaAdjustmentReason: true,
            items: [
              {
                id: 'TC04-ERR',
                name: 'Bạt Hiflex 0.8×1.2m × 3 tấm',
                unit: 'm²',
                quantity: 3,
                vendorCostMode: VendorCostMode.PER_SQM,
                baseCostRate: 45_000,
                areaSpec: {
                  mode: AreaInputMode.DIMENSIONS,
                  widthM: 0.8,
                  heightM: 1.2,
                  sheetsCount: 3,
                  billableAreaSqm: 3.0,
                },
                profit: {
                  mode: ProfitMode.FIXED_AMOUNT,
                  scope: ProfitScope.PER_SQM,
                  value: 15_000,
                },
              },
            ],
          }),
        /bắt buộc nhập lý do điều chỉnh/i,
      );

      const calc = calculatePrintQuote({
        requireAreaAdjustmentReason: true,
        items: [
          {
            id: 'TC04-OK',
            name: 'Bạt Hiflex 0.8×1.2m × 3 tấm',
            unit: 'm²',
            quantity: 3,
            vendorCostMode: VendorCostMode.PER_SQM,
            baseCostRate: 45_000,
            areaSpec: {
              mode: AreaInputMode.DIMENSIONS,
              widthM: 0.8,
              heightM: 1.2,
              sheetsCount: 3,
              billableAreaSqm: 3.0,
              adjustmentReason: 'Xưởng tính tối thiểu 1m² mỗi tấm bạt lẻ',
            },
            finishingStages: [
              {
                id: 'S1',
                name: 'Đóng khoen viền',
                pricingMode: VendorCostMode.PER_SQM,
                rate: 12_000,
              },
            ],
            profit: {
              mode: ProfitMode.FIXED_AMOUNT,
              scope: ProfitScope.PER_SQM,
              value: 15_000,
            },
          },
        ],
        shippingFee: 0,
      });

      assert.equal(calc.lines[0].areaSpec?.actualAreaSqm, 2.88);
      assert.equal(calc.lines[0].areaSpec?.billableAreaSqm, 3);
      assert.equal(
        calc.lines[0].areaSpec?.adjustmentReason,
        'Xưởng tính tối thiểu 1m² mỗi tấm bạt lẻ',
      );
      assert.equal(calc.lines[0].baseVendorCost, 135_000);
      assert.equal(calc.lines[0].finishingVendorCost, 36_000);
      assert.equal(calc.totalVendorCost, 171_000);
      assert.equal(calc.totalProfit, 45_000);
      assert.equal(calc.totalQuoteAmount, 216_000);

      const pdf = buildCustomerSafePdfPayload(calc);
      assertCustomerSafePdfPayload(pdf);
      const pdfStr = JSON.stringify(pdf);
      assert.ok(!pdfStr.includes('Xưởng tính tối thiểu'));
      assert.ok(!pdfStr.includes('171000'));
    });

    it('TC-05A/B: Lợi nhuận phần trăm (12.5%) tính trên Tổng vốn SP (400k + 200k = 600k -> lời 75.000đ), KHÔNG tính % lên phí giao hàng 50.000đ', () => {
      const calc = calculatePrintQuote({
        items: [
          {
            id: 'TC05',
            name: 'Catalogue A4 cán mờ',
            unit: 'cuốn',
            quantity: 100,
            vendorCostMode: VendorCostMode.PER_UNIT,
            baseCostRate: 4000,
            finishingStages: [
              {
                id: 'S1',
                name: 'Cán màng mờ bìa',
                pricingMode: VendorCostMode.PER_UNIT,
                rate: 2000,
              },
            ],
            profit: {
              mode: ProfitMode.PERCENTAGE,
              scope: ProfitScope.TOTAL_BATCH,
              value: 12.5,
            },
          },
        ],
        shippingFee: 50_000,
        includeShippingInUnitPrice: true,
      });

      assert.equal(
        calc.lines[0].profitBasis,
        ProfitBasis.LINE_TOTAL_VENDOR_COST,
      );
      assert.equal(calc.totalVendorCost, 600_000);
      assert.equal(calc.totalProfit, 75_000);
      assert.equal(calc.totalQuoteAmount, 725_000);
    });

    it('TC-06A/B & TC-07: Chia lẻ 100.000/3 (CEIL step 1 & NEAREST step 1.000) và phân bổ ship đa SP Largest Remainder — KHÔNG lấy đơn giá làm tròn nhân ngược SL', () => {
      // TC-06A: 100.000 / 3 with CEIL step 1 -> unitPrice = 33.334, billedSubtotal = 100.002, adj = -2, reconciledLineTotal = 100.000
      const calcCeil = calculatePrintQuote({
        items: [
          {
            id: 'TC06A',
            name: 'Hộp cứng mẫu',
            unit: 'hộp',
            quantity: 3,
            vendorCostMode: VendorCostMode.TOTAL_BATCH,
            baseCostRate: 70_000,
            profit: {
              mode: ProfitMode.FIXED_AMOUNT,
              scope: ProfitScope.TOTAL_BATCH,
              value: 30_000,
            },
          },
        ],
        shippingFee: 0,
        roundingPolicy: { mode: RoundingMode.CEIL, step: 1 },
      });
      assert.equal(calcCeil.lines[0].finalUnitPrice, 33_334);
      assert.equal(calcCeil.lines[0].billedLineSubtotal, 100_002);
      assert.equal(calcCeil.lines[0].roundingAdjustment, -2);
      assert.equal(calcCeil.lines[0].reconciledLineTotal, 100_000);
      assert.equal(calcCeil.totalQuoteAmount, 100_000);
      const pdfCeil = buildCustomerSafePdfPayload(calcCeil);
      assert.equal(pdfCeil.lines[0].lineTotal, 100_000);
      assert.equal(pdfCeil.grandTotalPayable, 100_000);
      assert.equal(
        calcCeil.lines[0].exactSplitSchedule.reduce(
          (s, seg) => s + seg.subtotal,
          0,
        ),
        100_000,
      );

      // TC-06B: 100.000 / 3 with NEAREST step 1000 -> unitPrice = 33.000, billedSubtotal = 99.000, adj = +1.000, reconciledLineTotal = 100.000
      const calcStep1k = calculatePrintQuote({
        items: [
          {
            id: 'TC06B',
            name: 'Hộp cứng mẫu',
            unit: 'hộp',
            quantity: 3,
            vendorCostMode: VendorCostMode.TOTAL_BATCH,
            baseCostRate: 70_000,
            profit: {
              mode: ProfitMode.FIXED_AMOUNT,
              scope: ProfitScope.TOTAL_BATCH,
              value: 30_000,
            },
          },
        ],
        shippingFee: 0,
        roundingPolicy: { mode: RoundingMode.NEAREST, step: 1000 },
      });
      assert.equal(calcStep1k.lines[0].finalUnitPrice, 33_000);
      assert.equal(calcStep1k.lines[0].roundingAdjustment, 1000);
      assert.equal(calcStep1k.lines[0].reconciledLineTotal, 100_000);
      const pdfStep1k = buildCustomerSafePdfPayload(calcStep1k);
      assert.equal(pdfStep1k.grandTotalPayable, 100_000);

      // TC-07: Multi-item Largest Remainder shipping allocation (50.000 across 3 equal lines of 100.000 -> 16.667 + 16.667 + 16.666 = 50.000)
      const calcMulti = calculatePrintQuote({
        items: [
          {
            id: 'M1',
            name: 'SP 1',
            quantity: 10,
            unitVendorCost: 8000,
            profit: {
              mode: ProfitMode.FIXED_AMOUNT,
              scope: ProfitScope.TOTAL_BATCH,
              value: 20_000,
            },
          },
          {
            id: 'M2',
            name: 'SP 2',
            quantity: 10,
            unitVendorCost: 8000,
            profit: {
              mode: ProfitMode.FIXED_AMOUNT,
              scope: ProfitScope.TOTAL_BATCH,
              value: 20_000,
            },
          },
          {
            id: 'M3',
            name: 'SP 3',
            quantity: 10,
            unitVendorCost: 8000,
            profit: {
              mode: ProfitMode.FIXED_AMOUNT,
              scope: ProfitScope.TOTAL_BATCH,
              value: 20_000,
            },
          },
        ],
        shippingFee: 50_000,
        includeShippingInUnitPrice: true,
        shippingAllocationStrategy:
          ShippingAllocationStrategy.PROPORTIONAL_BY_BASE_AMOUNT,
      });
      const sumShip = calcMulti.lines.reduce(
        (s, l) => s + l.allocatedShippingFee,
        0,
      );
      assert.equal(sumShip, 50_000);
      assert.equal(calcMulti.totalQuoteAmount, 350_000);
      const pdfMulti = buildCustomerSafePdfPayload(calcMulti);
      assert.equal(
        pdfMulti.lines.reduce((s, l) => s + l.lineTotal, 0),
        350_000,
      );
      assert.equal(pdfMulti.grandTotalPayable, 350_000);
    });

    it('TC-08 & Biên an toàn: Phân biệt giá rỗng (PENDING_COST) vs 0đ tường minh, và chặn NaN / Infinity / âm / vượt ngưỡng trần', () => {
      // Explicit 0đ vendor cost -> COMPLETE, quote = 50.000đ
      const zeroCostCalc = calculatePrintQuote({
        items: [
          {
            id: 'ZERO-1',
            name: 'In bù lỗi miễn phí vốn xưởng',
            quantity: 50,
            vendorCostMode: VendorCostMode.PER_UNIT,
            baseCostRate: 0,
            finishingStages: [
              {
                id: 'S0',
                name: 'Cắt xén tại chỗ',
                pricingMode: VendorCostMode.PER_UNIT,
                rate: 0,
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
      assert.equal(zeroCostCalc.totalVendorCost, 0);
      assert.equal(zeroCostCalc.totalProfit, 50_000);
      assert.equal(zeroCostCalc.totalQuoteAmount, 50_000);

      // Empty stage cost (rate = null) -> PENDING_COST snapshot with pdfPayload = null
      const pendingBuilt = createPendingCostQuoteSnapshot({
        quoteId: 'BG-PEND-01',
        customerName: 'Khách thử chờ giá',
        includeShippingInUnitPrice: true,
        shippingAllocationStrategy:
          ShippingAllocationStrategy.PROPORTIONAL_BY_BASE_AMOUNT,
        shippingFee: 0,
        lines: [
          {
            id: 'PEND-1',
            name: 'Hộp mỹ thuật ép kim',
            quantity: 100,
            vendorCostMode: VendorCostMode.PER_UNIT,
            baseCostRate: 5000,
            finishingStages: [
              {
                id: 'S-NULL',
                name: 'Khuôn ép kim',
                pricingMode: VendorCostMode.TOTAL_BATCH,
                rate: null,
              },
            ],
            profit: {
              mode: ProfitMode.FIXED_AMOUNT,
              scope: ProfitScope.PER_UNIT,
              value: 2000,
            },
          },
        ],
      });
      assert.equal(
        pendingBuilt.snapshot.pricingStatus,
        QuotePricingStatus.PENDING_COST,
      );
      assert.equal(pendingBuilt.snapshot.pdfPayload, null);

      // Upper & invalid numeric bounds
      assert.throws(() =>
        calculatePrintQuote({
          items: [
            {
              id: 'B1',
              name: 'Quá SL',
              quantity: 10_000_001,
              unitVendorCost: 1000,
              profit: {
                mode: ProfitMode.FIXED_AMOUNT,
                scope: ProfitScope.PER_UNIT,
                value: 100,
              },
            },
          ],
        }),
      );
      assert.throws(() =>
        calculatePrintQuote({
          items: [
            {
              id: 'B2',
              name: 'Quá đơn giá',
              quantity: 1,
              unitVendorCost: 100_000_000_001,
              profit: {
                mode: ProfitMode.FIXED_AMOUNT,
                scope: ProfitScope.PER_UNIT,
                value: 0,
              },
            },
          ],
        }),
      );
      assert.throws(() =>
        calculatePrintQuote({
          items: [
            {
              id: 'B3',
              name: 'Quá %',
              quantity: 1,
              unitVendorCost: 1000,
              profit: {
                mode: ProfitMode.PERCENTAGE,
                scope: ProfitScope.TOTAL_BATCH,
                value: 10_001,
              },
            },
          ],
        }),
      );
      assert.throws(() =>
        calculatePrintQuote({
          items: [
            {
              id: 'B4',
              name: 'Âm giá vốn',
              quantity: 1,
              unitVendorCost: -1,
              profit: {
                mode: ProfitMode.FIXED_AMOUNT,
                scope: ProfitScope.PER_UNIT,
                value: 0,
              },
            },
          ],
        }),
      );
    });
  });

  describe('B. Tích hợp PostgreSQL :55433 — TOTAL_BATCH Guard, Nguồn/Lịch sử Giá, 3 Tầng Tài chính Đơn in, Concurrency & Migration 0035', () => {
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
      const dbConfig = loadTestDatabaseConfig();
      pool = createDatabasePool(dbConfig);
      await runMigrations(pool);

      const shortId = crypto.randomUUID().slice(0, 8);
      workspaceId = crypto.randomUUID();
      const ownerUserId = crypto.randomUUID();
      const staffUserId = crypto.randomUUID();
      const adminUserId = crypto.randomUUID();

      await pool.query(
        `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, $2, 'Asia/Ho_Chi_Minh', 'active')`,
        [workspaceId, `PQ FinGate WS ${shortId}`],
      );
      await pool.query(
        `INSERT INTO users (id, username_normalized, email_normalized, status)
         VALUES ($1, $2, $3, 'active'), ($4, $5, $6, 'active'), ($7, $8, $9, 'active')`,
        [
          ownerUserId,
          `owner_fg_${shortId}`,
          `owner-fg-${shortId}@test.local`,
          staffUserId,
          `staff_fg_${shortId}`,
          `staff-fg-${shortId}@test.local`,
          adminUserId,
          `admin_fg_${shortId}`,
          `admin-fg-${shortId}@test.local`,
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
         VALUES ($1, $2, $3, 'ADM01', 'Sub-Admin FinGate', 'active', 'admin', $4::jsonb)`,
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
        const rawTok = `${prefix}-fg-${crypto.randomUUID()}`;
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

    it('TC-09: Mục giá trọn lô (TOTAL_BATCH, SL chuẩn = 1.000 hộp = 180.000đ) chặn tự động áp dụng khi nhập SL = 2.000 nếu chưa xác nhận giá riêng', async () => {
      const createBatchItem = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/price-items',
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          body: {
            name: 'Namecard C300 cán mờ 1.000 tấm',
            item_type: PriceItemType.BASE_PRINT,
            specification: 'C300 · Cán mờ 2 mặt',
            unit: 'tấm',
            pricing_mode: VendorCostMode.TOTAL_BATCH,
            unit_cost: 0,
            batch_quantity: 1000,
            batch_total_cost: 180_000,
            structured_spec: { batch_qty_policy: 'EXACT' },
            default_profit_mode: ProfitMode.FIXED_AMOUNT,
            default_profit_scope: ProfitScope.TOTAL_BATCH,
            default_profit_value: 70_000,
          },
        },
      );
      assert.equal(createBatchItem.status, 201);
      const batchItem = createBatchItem.body.data;
      assert.equal(batchItem.batch_quantity, 1000);

      // 1) Exact matching quantity = 1000 -> 201 Created
      const okQuote = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/quotes',
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          body: {
            title: 'Namecard đúng lô 1.000 tấm',
            shipping_fee: 0,
            items: [
              {
                id: 'NC-1000',
                vendor_price_item_id: batchItem.id,
                name: batchItem.name,
                unit: 'tấm',
                quantity: 1000,
                vendorCostMode: VendorCostMode.TOTAL_BATCH,
                totalVendorCost: 180_000,
                profitMode: ProfitMode.FIXED_AMOUNT,
                profitScope: ProfitScope.TOTAL_BATCH,
                profitValue: 70_000,
              },
            ],
          },
        },
      );
      assert.equal(okQuote.status, 201);
      assert.equal(okQuote.body.data.total_vendor_cost, 180_000);
      assert.equal(okQuote.body.data.total_quote_amount, 250_000);
      assert.equal(
        okQuote.body.data.lines_json[0].vendorPriceItemCode,
        batchItem.code,
      );
      assert.equal(okQuote.body.data.lines_json[0].vendorPriceItemVersion, 1);

      // 2) Mismatched quantity = 2000 while keeping catalog batch item -> MUST reject 409 BATCH_QUANTITY_MISMATCH
      const mismatchQuote = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/quotes',
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          body: {
            title: 'Namecard sai số lượng lô 2.000 tấm',
            shipping_fee: 0,
            items: [
              {
                id: 'NC-2000-BAD',
                vendor_price_item_id: batchItem.id,
                name: batchItem.name,
                unit: 'tấm',
                quantity: 2000,
                vendorCostMode: VendorCostMode.TOTAL_BATCH,
                totalVendorCost: 180_000,
                profitMode: ProfitMode.FIXED_AMOUNT,
                profitScope: ProfitScope.TOTAL_BATCH,
                profitValue: 70_000,
              },
            ],
          },
        },
      );
      assert.equal(mismatchQuote.status, 409);
      assert.equal(mismatchQuote.body.error.code, 'BATCH_QUANTITY_MISMATCH');

      // 3) Explicit one-off override (`CATALOG_OVERRIDDEN`, 330.000đ for 2.000 tấm) -> allowed, records both original 180k & overridden 330k, catalog untouched
      const overrideQuote = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/quotes',
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          body: {
            title: 'Namecard 2.000 tấm đã xác nhận giá riêng',
            shipping_fee: 0,
            items: [
              {
                id: 'NC-2000-OVR',
                vendor_price_item_id: batchItem.id,
                name: batchItem.name,
                unit: 'tấm',
                quantity: 2000,
                vendorCostMode: VendorCostMode.TOTAL_BATCH,
                baseCostRate: 330_000,
                baseCostSource: LineCostSource.CATALOG_OVERRIDDEN,
                profitMode: ProfitMode.FIXED_AMOUNT,
                profitScope: ProfitScope.TOTAL_BATCH,
                profitValue: 120_000,
              },
            ],
          },
        },
      );
      assert.equal(overrideQuote.status, 201);
      const ovrLine = overrideQuote.body.data.lines_json[0];
      assert.equal(ovrLine.baseCostSource, LineCostSource.CATALOG_OVERRIDDEN);
      assert.equal(ovrLine.catalogOriginalRate, 180_000);
      assert.equal(ovrLine.baseCostRate, 330_000);
      assert.equal(overrideQuote.body.data.total_quote_amount, 450_000);

      // Verify catalog item still 180.000đ
      const listCatalog = await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/price-items',
        { cookie: ownerCookie },
      );
      const stillOriginal = listCatalog.body.data.items.find(
        (x) => x.id === batchItem.id,
      );
      assert.equal(stillOriginal.batch_total_cost, 180_000);
      assert.equal(stillOriginal.version, 1);
    });

    it('TC-10, TC-11 & TC-12: Truy vết mã/phiên bản giá, bất biến snapshot khi bảng giá tăng/ngừng dùng, Concurrency FOR UPDATE, Idempotency & Rollback giao dịch lỗi', async () => {
      const baseRes = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/price-items',
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          body: {
            name: 'Tờ rơi A4 C200 chuẩn',
            item_type: PriceItemType.BASE_PRINT,
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
      const baseCatalog = baseRes.body.data;

      const stageRes = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/price-items',
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          body: {
            name: 'Cán màng bóng 1 mặt',
            item_type: PriceItemType.FINISHING,
            unit: 'tờ',
            pricing_mode: VendorCostMode.PER_UNIT,
            unit_cost: 2000,
          },
        },
      );
      assert.equal(stageRes.status, 201);
      const stageCatalog = stageRes.body.data;

      // Idempotency check on POST /quotes
      const idemKey = `idem-fin-gate-${crypto.randomUUID()}`;
      const quotePayload = {
        title: 'Báo giá kiểm chứng bất biến & đồng thời',
        shipping_fee: 40_000,
        include_shipping_in_unit_price: true,
        items: [
          {
            id: 'LINE-IMM-1',
            vendor_price_item_id: baseCatalog.id,
            name: baseCatalog.name,
            unit: 'tờ',
            quantity: 100,
            vendorCostMode: VendorCostMode.PER_UNIT,
            baseCostRate: 4000,
            baseCostSource: LineCostSource.CATALOG,
            finishingStages: [
              {
                id: 'STG-IMM-1',
                priceItemId: stageCatalog.id,
                code: stageCatalog.code,
                name: stageCatalog.name,
                pricingMode: VendorCostMode.PER_UNIT,
                rate: 2000,
                unit: 'tờ',
                costSource: LineCostSource.CATALOG,
              },
            ],
            profitMode: ProfitMode.FIXED_AMOUNT,
            profitScope: ProfitScope.PER_UNIT,
            profitValue: 1000,
          },
        ],
      };

      const qCreate1 = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/quotes',
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          idempotencyKey: idemKey,
          body: quotePayload,
        },
      );
      const qCreate2 = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/quotes',
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          idempotencyKey: idemKey,
          body: quotePayload,
        },
      );
      assert.equal(qCreate1.status, 201);
      assert.equal(qCreate2.status, 201);
      assert.equal(qCreate1.body.data.id, qCreate2.body.data.id);

      const savedQuote = qCreate1.body.data;
      assert.equal(savedQuote.total_vendor_cost, 600_000);
      assert.equal(savedQuote.total_profit, 100_000);
      assert.equal(savedQuote.total_quote_amount, 740_000);
      assert.equal(
        savedQuote.lines_json[0].vendorPriceItemCode,
        baseCatalog.code,
      );
      assert.equal(savedQuote.lines_json[0].vendorPriceItemVersion, 1);
      assert.equal(
        savedQuote.lines_json[0].finishingStages[0].priceItemVersion,
        1,
      );
      assert.ok(savedQuote.lines_json[0].priceAppliedAt);

      // Update catalog base item to 5.500đ (v2), then deactivate it
      const patchCat = await apiRequest(
        baseUrl,
        'PATCH',
        `/api/v1/print-quotes/price-items/${baseCatalog.id}`,
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          body: {
            unit_cost: 5500,
            change_note: 'Xưởng tăng giá giấy C200',
          },
        },
      );
      assert.equal(patchCat.status, 200);
      assert.equal(patchCat.body.data.version, 2);

      const deactCat = await apiRequest(
        baseUrl,
        'POST',
        `/api/v1/print-quotes/price-items/${baseCatalog.id}/deactivate`,
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          body: { change_note: 'Ngừng gói C200 cũ' },
        },
      );
      assert.equal(deactCat.status, 200);

      // Saved quote MUST NOT silently recalculate (still 4.000đ v1 -> total 740.000đ)
      const rereadQuote = await apiRequest(
        baseUrl,
        'GET',
        `/api/v1/print-quotes/quotes/${savedQuote.id}`,
        { cookie: ownerCookie },
      );
      assert.equal(rereadQuote.status, 200);
      assert.equal(rereadQuote.body.data.total_vendor_cost, 600_000);
      assert.equal(rereadQuote.body.data.total_quote_amount, 740_000);
      assert.equal(
        rereadQuote.body.data.lines_json[0].vendorPriceItemVersion,
        1,
      );
      assert.equal(
        verifyQuoteSnapshotIntegrity(rereadQuote.body.data.snapshot_json),
        true,
      );
      assert.equal(
        verifyQuoteSnapshotIntegrity(
          rereadQuote.body.data.versions[0].snapshot_json,
        ),
        true,
      );
      assert.equal(
        rereadQuote.body.data.snapshot_json.integrityHash,
        rereadQuote.body.data.versions[0].integrity_hash,
      );

      // New quote trying to pick deactivated catalog item -> 409 PRICE_ITEM_INACTIVE
      const newWithInactive = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/quotes',
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          body: quotePayload,
        },
      );
      assert.equal(newWithInactive.status, 409);
      assert.equal(newWithInactive.body.error.code, 'PRICE_ITEM_INACTIVE');

      // Concurrent PATCH on existing quote -> serialized cleanly by FOR UPDATE into v2 and v3
      const [conc1, conc2] = await Promise.all([
        apiRequest(
          baseUrl,
          'PATCH',
          `/api/v1/print-quotes/quotes/${savedQuote.id}`,
          {
            cookie: ownerCookie,
            csrfToken: ownerCsrf,
            body: {
              ...quotePayload,
              shipping_fee: 45_000,
              change_note: 'Cập nhật ship đồng thời A',
            },
          },
        ),
        apiRequest(
          baseUrl,
          'PATCH',
          `/api/v1/print-quotes/quotes/${savedQuote.id}`,
          {
            cookie: ownerCookie,
            csrfToken: ownerCsrf,
            body: {
              ...quotePayload,
              shipping_fee: 50_000,
              change_note: 'Cập nhật ship đồng thời B',
            },
          },
        ),
      ]);
      assert.equal(conc1.status, 200);
      assert.equal(conc2.status, 200);

      const afterConc = await apiRequest(
        baseUrl,
        'GET',
        `/api/v1/print-quotes/quotes/${savedQuote.id}`,
        { cookie: ownerCookie },
      );
      assert.equal(afterConc.body.data.current_version, 3);
      assert.equal(afterConc.body.data.versions.length, 3);

      // Failed PATCH (missing adjustmentReason when billable != actual) -> full rollback, stays at v3
      const badPatch = await apiRequest(
        baseUrl,
        'PATCH',
        `/api/v1/print-quotes/quotes/${savedQuote.id}`,
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          body: {
            title: 'Lỗi thiếu lý do lệch m2',
            items: [
              {
                id: 'BAD-AREA',
                name: 'Bạt lỗi',
                unit: 'm²',
                quantity: 1,
                vendorCostMode: VendorCostMode.PER_SQM,
                baseCostRate: 50_000,
                areaSpec: {
                  mode: AreaInputMode.DIRECT_AREA,
                  actualAreaSqm: 2.5,
                  billableAreaSqm: 3.0,
                },
                profitMode: ProfitMode.FIXED_AMOUNT,
                profitScope: ProfitScope.PER_SQM,
                profitValue: 10_000,
              },
            ],
          },
        },
      );
      assert.equal(badPatch.status, 400);

      const afterRollback = await apiRequest(
        baseUrl,
        'GET',
        `/api/v1/print-quotes/quotes/${savedQuote.id}`,
        { cookie: ownerCookie },
      );
      assert.equal(afterRollback.body.data.current_version, 3);

      // Verify binary PDF & JSON customer PDF reconciliation + zero internal leakage
      const pdfJsonRes = await apiRequest(
        baseUrl,
        'GET',
        `/api/v1/print-quotes/quotes/${savedQuote.id}/pdf`,
        { cookie: ownerCookie },
      );
      assert.equal(pdfJsonRes.status, 200);
      const safePdf = pdfJsonRes.body.data;
      assertCustomerSafePdfPayload(safePdf);
      assert.equal(
        safePdf.lines.reduce((s, l) => s + l.lineTotal, 0) +
          safePdf.shippingAmountToAddOnPdfFooter,
        safePdf.grandTotalPayable,
      );
      assert.equal(
        safePdf.grandTotalPayable,
        afterRollback.body.data.total_quote_amount,
      );
      for (const forbidden of FORBIDDEN_CUSTOMER_PDF_KEYS) {
        assert.equal(forbidden in safePdf, false);
        assert.equal(forbidden in safePdf.lines[0], false);
      }

      const pdfBin = await apiRequest(
        baseUrl,
        'GET',
        `/api/v1/print-quotes/quotes/${savedQuote.id}/pdf-file`,
        { cookie: ownerCookie, rawResponse: true },
      );
      if (pdfBin.status === 200) {
        assert.equal(pdfBin.buffer.subarray(0, 5).toString('ascii'), '%PDF-');
      }
    });

    it('TC-13 & RBAC: Tách bạch 3 tầng tài chính Đơn in (Dự kiến báo giá vs Chi phí thực tế đã xác nhận vs Thực thu/Thực chi) & Chặn 403 Staff/Sub-Admin', async () => {
      // Create clean quote: Vốn 600k + Lời 100k + Ship 40k = 740k
      const qRes = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/quotes',
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          body: {
            title: 'Đơn đối soát 3 tầng tài chính',
            shipping_fee: 40_000,
            include_shipping_in_unit_price: true,
            items: [
              {
                id: 'ORD-LINE-1',
                name: 'Tờ rơi A4 C200 cán màng',
                unit: 'tờ',
                quantity: 100,
                vendorCostMode: VendorCostMode.PER_UNIT,
                baseCostRate: 4000,
                finishingStages: [
                  {
                    id: 'ST-O1',
                    name: 'Cán màng 1 mặt',
                    pricingMode: VendorCostMode.PER_UNIT,
                    rate: 2000,
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
      assert.equal(qRes.status, 201);
      const quote = qRes.body.data;

      // Convert to order WITHOUT actual cost confirmation
      const ordRes = await apiRequest(
        baseUrl,
        'POST',
        '/api/v1/print-quotes/orders',
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          body: {
            quote_id: quote.id,
            deposit_required: 300_000,
            deposit_paid: 300_000,
          },
        },
      );
      assert.equal(ordRes.status, 201);
      const order = ordRes.body.data;

      // Tier 1 (Expected): preserved from quote
      assert.equal(order.expected_vendor_cost, 600_000);
      assert.equal(order.expected_shipping_fee, 40_000);
      assert.equal(order.expected_profit, 100_000);

      // Tier 2 (Confirmed Actual): MUST be unconfirmed (false), null on API, and NOT fake-copied from expected!
      assert.equal(order.actual_cost_confirmed, false);
      assert.equal(order.cost_reconciliation_status, 'UNVERIFIED');
      assert.equal(order.actual_vendor_cost, null);
      assert.equal(order.actual_profit, null);

      // Tier 3 (Actual Cash In / Out): customer paid 300k, vendor paid 0
      assert.equal(order.total_paid_amount, 300_000);
      assert.equal(order.remaining_debt_amount, 440_000);
      assert.equal(order.vendor_paid_amount, 0);

      // Dashboard stats BEFORE actual cost confirmation -> total_actual_profit MUST be 0 (not 100.000!)
      const statsBefore = await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/stats',
        { cookie: ownerCookie },
      );
      assert.equal(statsBefore.status, 200);
      assert.equal(statsBefore.body.data.confirmed_actual_orders_count, 0);
      assert.equal(statsBefore.body.data.total_expected_profit, 100_000);
      assert.equal(statsBefore.body.data.total_actual_profit, 0);
      assert.equal(statsBefore.body.data.total_paid_amount, 300_000);
      assert.equal(statsBefore.body.data.total_vendor_paid_amount, 0);

      // Owner explicitly confirms all 3 actual workshop/shipping/extra cost components + cash paid to workshop
      const confirmRes = await apiRequest(
        baseUrl,
        'PATCH',
        `/api/v1/print-quotes/orders/${order.id}`,
        {
          cookie: ownerCookie,
          csrfToken: ownerCsrf,
          body: {
            actual_cost_confirmed: true,
            actual_vendor_cost: 580_000,
            actual_shipping_fee: 35_000,
            actual_extra_cost: 5_000,
            vendor_paid_amount: 400_000,
          },
        },
      );
      assert.equal(confirmRes.status, 200);
      const confirmed = confirmRes.body.data;
      assert.equal(confirmed.actual_cost_confirmed, true);
      assert.ok(confirmed.actual_cost_confirmed_at);
      // 740.000 - (580.000 + 35.000 + 5.000) = 120.000
      assert.equal(confirmed.actual_profit, 120_000);
      // Expected profit stays untouched at 100.000
      assert.equal(confirmed.expected_profit, 100_000);
      assert.equal(confirmed.vendor_paid_amount, 400_000);

      const statsAfter = await apiRequest(
        baseUrl,
        'GET',
        '/api/v1/print-quotes/stats',
        { cookie: ownerCookie },
      );
      assert.equal(statsAfter.body.data.confirmed_actual_orders_count, 1);
      assert.equal(statsAfter.body.data.total_expected_profit, 100_000);
      assert.equal(statsAfter.body.data.total_actual_profit, 120_000);
      assert.equal(statsAfter.body.data.total_vendor_paid_amount, 400_000);

      // RBAC check: Staff & Sub-Admin (ADM01) strictly 403
      for (const [cookie, csrf] of [
        [staffCookie, staffCsrf],
        [adminCookie, adminCsrf],
      ]) {
        const rStats = await apiRequest(
          baseUrl,
          'GET',
          '/api/v1/print-quotes/stats',
          { cookie },
        );
        assert.equal(rStats.status, 403);
        const rCalc = await apiRequest(
          baseUrl,
          'POST',
          '/api/v1/print-quotes/calculate',
          { cookie, csrfToken: csrf, body: { items: [] } },
        );
        assert.equal(rCalc.status, 403);
      }
    });

    it('Migration 0035: Kiểm chứng dữ liệu đơn cũ trước 0035, chặn rollback khi đã có dữ liệu xác nhận thực tế, rollback sạch & chạy lại idempotent', async () => {
      const baseCfg = loadTestDatabaseConfig();
      const adminPwPath = 'C:\\ML-Test\\secrets\\admin.pw';
      let adminPassword = baseCfg.password;
      try {
        adminPassword = (await fs.readFile(adminPwPath, 'utf8')).trim();
      } catch {
        // Fallback if running with unified test superuser credentials
      }
      const parsedTestUrl = baseCfg.connectionString
        ? new URL(baseCfg.connectionString)
        : null;
      const pgHost = parsedTestUrl?.hostname || baseCfg.host || '127.0.0.1';
      const pgPort = parsedTestUrl?.port
        ? Number(parsedTestUrl.port)
        : baseCfg.port || 55433;
      const tempDbName = `mglite_mig0035_test_${crypto.randomUUID().slice(0, 8)}`;
      const adminMaintenancePool = createDatabasePool({
        host: pgHost,
        port: pgPort,
        user: 'ml_test_admin',
        password: adminPassword,
        database: 'postgres',
        max: 4,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 5_000,
      });

      await adminMaintenancePool.query(
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
        const pre0035 = allMigs.filter((m) => m.id < '0035_');
        const upTo0035 = allMigs.filter((m) => m.id < '0036_');
        const only0035 = allMigs.filter((m) => m.id.startsWith('0035_'));
        assert.equal(only0035.length, 1);

        // 1. Apply 0001..0034 on clean DB
        await runMigrations(tempPool, pre0035);

        // 2. Seed a pre-0035 legacy workspace, quote, quote_version, and unconfirmed order (where actual == expected was copied automatically)
        const wsId = crypto.randomUUID();
        const userId = crypto.randomUUID();
        const quoteId = crypto.randomUUID();
        const qVerId = crypto.randomUUID();
        const legacyOrderUnconfirmedId = crypto.randomUUID();
        const legacyOrderEditedId = crypto.randomUUID();

        await tempPool.query(
          `INSERT INTO workspaces (id, name, timezone, status) VALUES ($1, 'Legacy 0034 WS', 'Asia/Ho_Chi_Minh', 'active')`,
          [wsId],
        );
        await tempPool.query(
          `INSERT INTO users (id, username_normalized, email_normalized, status) VALUES ($1, 'u0034', 'u0034@test.local', 'active')`,
          [userId],
        );
        await tempPool.query(
          `INSERT INTO print_quotes (
             id, workspace_id, quote_code, title, customer_name, status, current_version,
             total_quantity, total_vendor_cost, total_profit, shipping_fee, total_extra_cost,
             total_quote_amount, total_rounding_adjustment, lines_json, snapshot_json, customer_pdf_json, integrity_hash, created_by
           ) VALUES ($1, $2, 'BG-OLD-001', 'Báo giá cũ', 'Khách cũ A', 'CONVERTED', 1, 100, 300000, 100000, 20000, 0, 420000, 0, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, 'hash-old', $3)`,
          [quoteId, wsId, userId],
        );
        await tempPool.query(
          `INSERT INTO print_quote_versions (
             id, workspace_id, quote_id, version_number, status, total_quantity,
             total_vendor_cost, total_profit, shipping_fee, total_extra_cost,
             total_quote_amount, total_rounding_adjustment, snapshot_json, customer_pdf_json, integrity_hash, created_by
           ) VALUES ($1, $2, $3, 1, 'CONVERTED', 100, 300000, 100000, 20000, 0, 420000, 0, '{}'::jsonb, '{}'::jsonb, 'hash-old', $4)`,
          [qVerId, wsId, quoteId, userId],
        );

        // Legacy order A: actual == expected (never reconciled)
        await tempPool.query(
          `INSERT INTO print_orders (
             id, workspace_id, order_code, quote_id, quote_code, quote_version, customer_name, title,
             total_quote_amount, expected_vendor_cost, actual_vendor_cost,
             expected_shipping_fee, actual_shipping_fee, expected_extra_cost, actual_extra_cost,
             expected_profit, actual_profit, remaining_debt_amount, snapshot_json, integrity_hash, created_by
           ) VALUES ($1, $2, 'DH-OLD-A', $3, 'BG-OLD-001', 1, 'Khách cũ A', 'Đơn cũ A', 420000, 300000, 300000, 20000, 20000, 0, 0, 100000, 100000, 420000, '{}'::jsonb, 'hash-old', $4)`,
          [legacyOrderUnconfirmedId, wsId, quoteId, userId],
        );

        // Legacy order B: Owner had already edited actual_vendor_cost = 280000 != 300000 before migration 0035
        const quoteId2 = crypto.randomUUID();
        const qVerId2 = crypto.randomUUID();
        await tempPool.query(
          `INSERT INTO print_quotes (
             id, workspace_id, quote_code, title, customer_name, status, current_version,
             total_quantity, total_vendor_cost, total_profit, shipping_fee, total_extra_cost,
             total_quote_amount, total_rounding_adjustment, lines_json, snapshot_json, customer_pdf_json, integrity_hash, created_by
           ) VALUES ($1, $2, 'BG-OLD-002', 'Báo giá cũ 2', 'Khách cũ B', 'CONVERTED', 1, 100, 300000, 100000, 20000, 0, 420000, 0, '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, 'hash-old-2', $3)`,
          [quoteId2, wsId, userId],
        );
        await tempPool.query(
          `INSERT INTO print_quote_versions (
             id, workspace_id, quote_id, version_number, status, total_quantity,
             total_vendor_cost, total_profit, shipping_fee, total_extra_cost,
             total_quote_amount, total_rounding_adjustment, snapshot_json, customer_pdf_json, integrity_hash, created_by
           ) VALUES ($1, $2, $3, 1, 'CONVERTED', 100, 300000, 100000, 20000, 0, 420000, 0, '{}'::jsonb, '{}'::jsonb, 'hash-old-2', $4)`,
          [qVerId2, wsId, quoteId2, userId],
        );
        await tempPool.query(
          `INSERT INTO print_orders (
             id, workspace_id, order_code, quote_id, quote_code, quote_version, customer_name, title,
             total_quote_amount, expected_vendor_cost, actual_vendor_cost,
             expected_shipping_fee, actual_shipping_fee, expected_extra_cost, actual_extra_cost,
             expected_profit, actual_profit, remaining_debt_amount, snapshot_json, integrity_hash, created_by
           ) VALUES ($1, $2, 'DH-OLD-B', $3, 'BG-OLD-002', 1, 'Khách cũ B', 'Đơn cũ B', 420000, 300000, 280000, 20000, 20000, 0, 0, 100000, 120000, 420000, '{}'::jsonb, 'hash-old-2', $4)`,
          [legacyOrderEditedId, wsId, quoteId2, userId],
        );

        // 3. Apply 0035 forward
        const applyRes = await runMigrations(tempPool, upTo0035);
        assert.equal(applyRes.appliedCount, 1);

        const checkOrders = await tempPool.query(
          `SELECT id, actual_cost_confirmed, cost_reconciliation_status, actual_vendor_cost, vendor_paid_amount FROM print_orders ORDER BY order_code ASC`,
        );
        // Zero guesswork: BOTH DH-OLD-A and DH-OLD-B stay actual_cost_confirmed = false, placed into NEEDS_REVIEW, with raw numbers untouched!
        assert.equal(checkOrders.rows[0].actual_cost_confirmed, false);
        assert.equal(
          checkOrders.rows[0].cost_reconciliation_status,
          'NEEDS_REVIEW',
        );
        assert.equal(Number(checkOrders.rows[0].actual_vendor_cost), 300_000);
        assert.equal(Number(checkOrders.rows[0].vendor_paid_amount), 0);

        assert.equal(checkOrders.rows[1].actual_cost_confirmed, false);
        assert.equal(
          checkOrders.rows[1].cost_reconciliation_status,
          'NEEDS_REVIEW',
        );
        assert.equal(Number(checkOrders.rows[1].actual_vendor_cost), 280_000);

        // 4. Once an order records entered/confirmed actual costs, rollback script MUST block (ROLLBACK_BLOCKED)
        await tempPool.query(
          `UPDATE print_orders
           SET entered_vendor_cost = 280000,
               entered_shipping_fee = 20000,
               entered_extra_cost = 0,
               cost_reconciliation_status = 'CONFIRMED',
               actual_cost_confirmed = true
           WHERE id = $1`,
          [legacyOrderEditedId],
        );
        const rollbackSql = await fs.readFile(
          path.join(
            REPO_ROOT,
            'scripts/db/rollback-0035-printquote-financial-control-gate.sql',
          ),
          'utf8',
        );
        await assert.rejects(
          () => tempPool.query(rollbackSql),
          /ROLLBACK_BLOCKED/,
        );

        // 5. Clear entered/confirmed data -> rollback succeeds cleanly -> re-apply 0035 is idempotent
        await tempPool.query(
          `UPDATE print_orders
           SET actual_cost_confirmed = false,
               cost_reconciliation_status = 'NEEDS_REVIEW',
               entered_vendor_cost = NULL,
               entered_shipping_fee = NULL,
               entered_extra_cost = NULL,
               vendor_paid_amount = 0`,
        );
        await tempPool.query(rollbackSql);

        const reapply1 = await runMigrations(tempPool, upTo0035);
        assert.equal(reapply1.appliedCount, 1);
        const reapply2 = await runMigrations(tempPool, upTo0035);
        assert.equal(reapply2.appliedCount, 0);
      } finally {
        await tempPool.end();
        await adminMaintenancePool.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [tempDbName],
        );
        await adminMaintenancePool.query(
          `DROP DATABASE IF EXISTS "${tempDbName}"`,
        );
        await adminMaintenancePool.end();
      }
    });
  });

  describe('C. Giao diện Web SSR & Cổng validateQuoteDraftInputs (Chênh lệch m², TOTAL_BATCH Guard, 3 Tầng Tài chính)', () => {
    it('validateQuoteDraftInputs chặn thiếu lý do chênh lệch m² & chặn đổi SL trên mục TOTAL_BATCH chưa xác nhận; OrdersTab & AnalyticsTab tách rõ 3 tầng tài chính', () => {
      // 1. Missing areaAdjustmentReason when adjustBillableArea differs from actual area -> structuralError
      const areaLine = EMPTY_DRAFT_LINE(1);
      areaLine.name = 'Bạt Hiflex 0.8×1.2m × 3 tấm';
      areaLine.unit = 'm²';
      areaLine.quantity = 3;
      areaLine.quantityInput = '3';
      areaLine.vendorCostMode = VendorCostMode.PER_SQM;
      areaLine.vendorCostInput = '45000';
      areaLine.vendorCostValue = 45000;
      areaLine.areaMode = AreaInputMode.DIMENSIONS;
      areaLine.widthMInput = '0.8';
      areaLine.heightMInput = '1.2';
      areaLine.sheetsCountInput = '3';
      areaLine.adjustBillableArea = true;
      areaLine.billableAreaInput = '3';
      areaLine.areaAdjustmentReason = '';
      areaLine.profitInput = '15000';
      areaLine.profitValue = 15000;
      areaLine.profitScope = ProfitScope.PER_SQM;

      const areaFail = validateQuoteDraftInputs([areaLine], '0', []);
      assert.equal(areaFail.isValid, false);
      assert.ok(areaFail.structuralErrors.length > 0);
      assert.match(
        areaFail.lineErrors['ITEM-1']?.area ?? '',
        /bắt buộc nhập lý do điều chỉnh/i,
      );

      areaLine.areaAdjustmentReason = 'Xưởng tính tối thiểu 1m²/tấm';
      const areaPass = validateQuoteDraftInputs([areaLine], '0', []);
      assert.equal(areaPass.isValid, true);
      assert.equal(areaPass.structuralErrors.length, 0);

      // 2. TOTAL_BATCH catalog item (batch_quantity = 500) with line quantity = 1000 and baseCostSource = 'CATALOG' -> blocked
      const batchCatalog = {
        id: 'cat-batch-500',
        workspace_id: 'ws-1',
        vendor_id: null,
        vendor_name: 'Xưởng Hộp B',
        code: 'BX500',
        name: 'Tờ rơi A5 trọn lô 500 tờ',
        item_type: PriceItemType.BASE_PRINT,
        category: 'Giấy',
        specification: 'A5 C150',
        included_stages: [],
        structured_spec: null,
        conditions_note: null,
        unit: 'tờ',
        pricing_mode: VendorCostMode.TOTAL_BATCH,
        unit_cost: 700,
        batch_quantity: 500,
        batch_total_cost: 350_000,
        default_profit_mode: ProfitMode.FIXED_AMOUNT,
        default_profit_scope: ProfitScope.TOTAL_BATCH,
        default_profit_value: 100_000,
        note: null,
        is_active: true,
        version: 1,
        created_at: '2026-11-04T00:00:00.000Z',
        updated_at: '2026-11-04T00:00:00.000Z',
      };
      const batchLine = EMPTY_DRAFT_LINE(1);
      batchLine.name = 'Tờ rơi A5';
      batchLine.unit = 'tờ';
      batchLine.quantity = 1000;
      batchLine.quantityInput = '1000';
      batchLine.vendorPriceItemId = 'cat-batch-500';
      batchLine.vendorCostMode = VendorCostMode.TOTAL_BATCH;
      batchLine.baseCostSource = LineCostSource.CATALOG;
      batchLine.vendorCostInput = '350000';
      batchLine.vendorCostValue = 350_000;
      batchLine.profitMode = ProfitMode.FIXED_AMOUNT;
      batchLine.profitScope = ProfitScope.TOTAL_BATCH;
      batchLine.profitInput = '100000';
      batchLine.profitValue = 100_000;

      const batchFail = validateQuoteDraftInputs([batchLine], '0', [
        batchCatalog,
      ]);
      assert.equal(batchFail.isValid, false);
      assert.match(batchFail.lineErrors['ITEM-1']?.costMode ?? '', /500/);

      batchLine.baseCostSource = LineCostSource.CATALOG_OVERRIDDEN;
      batchLine.vendorCostInput = '620000';
      batchLine.vendorCostValue = 620_000;
      const batchOverridden = validateQuoteDraftInputs([batchLine], '0', [
        batchCatalog,
      ]);
      assert.equal(batchOverridden.isValid, true);

      // 3. OrdersTab & AnalyticsTab SSR: unconfirmed order NEVER renders expected cost as confirmed actual cost
      const unconfirmedOrder = {
        id: 'ord-u1',
        workspace_id: 'ws-1',
        order_code: 'DH0009',
        quote_id: 'q-1',
        quote_code: 'BG0009',
        quote_version: 1,
        customer_id: null,
        customer_name: 'Công ty Sao Việt',
        customer_phone: '0909000111',
        customer_address: null,
        vendor_id: null,
        vendor_name: 'Xưởng In Nhanh',
        title: 'Đơn hộp quà',
        order_date: '2026-11-04',
        print_ordered_at: null,
        due_date: null,
        completed_at: null,
        delivered_at: null,
        production_status: 'PENDING',
        delivery_status: 'NOT_SHIPPED',
        payment_status: 'DEPOSIT_PAID',
        total_quote_amount: 1_120_000,
        expected_vendor_cost: 750_000,
        expected_shipping_fee: 70_000,
        expected_extra_cost: 0,
        expected_profit: 300_000,
        cost_reconciliation_status: 'UNVERIFIED',
        actual_cost_confirmed: false,
        actual_cost_confirmed_at: null,
        actual_cost_confirmed_by: null,
        entered_vendor_cost: null,
        entered_shipping_fee: null,
        entered_extra_cost: null,
        actual_vendor_cost: null,
        actual_shipping_fee: null,
        actual_extra_cost: null,
        actual_profit: null,
        vendor_paid_amount: 0,
        deposit_required: 500_000,
        deposit_paid: 500_000,
        total_paid_amount: 500_000,
        remaining_debt_amount: 620_000,
        snapshot_json: {},
        integrity_hash: 'h1',
        notes: null,
        created_by: null,
        created_at: '2026-11-04T00:00:00.000Z',
        updated_at: '2026-11-04T00:00:00.000Z',
      };

      const ordersHtml = renderToStaticMarkup(
        React.createElement(OrdersTab, {
          orders: [unconfirmedOrder],
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
      assert.match(ordersHtml, /Vốn dự kiến/);
      assert.match(ordersHtml, /Chi phí thực tế/);
      assert.match(ordersHtml, /Chưa xác nhận từ xưởng/);
      assert.match(ordersHtml, /Thực chi xưởng/);
      assert.match(ordersHtml, /Xác nhận chi phí thực tế/);

      const analyticsUnconfirmedHtml = renderToStaticMarkup(
        React.createElement(AnalyticsTab, {
          stats: {
            total_vendors: 1,
            total_price_items: 2,
            total_customers: 1,
            total_quotes: 1,
            total_orders: 1,
            confirmed_actual_orders_count: 0,
            quotes_by_status: {},
            orders_by_production_status: { PENDING: 1 },
            orders_by_delivery_status: { NOT_SHIPPED: 1 },
            orders_by_payment_status: { DEPOSIT_PAID: 1 },
            total_quoted_revenue: 1_120_000,
            total_order_revenue: 1_120_000,
            total_expected_vendor_cost: 750_000,
            total_actual_vendor_cost: 0,
            total_expected_profit: 300_000,
            total_actual_profit: 0,
            total_paid_collected: 500_000,
            total_vendor_paid_amount: 0,
            total_remaining_debt: 620_000,
          },
          orders: [unconfirmedOrder],
          quotes: [],
        }),
      );
      assert.match(analyticsUnconfirmedHtml, /Lợi nhuận dự kiến/);
      assert.match(analyticsUnconfirmedHtml, /Chưa xác nhận/);
      assert.equal(
        analyticsUnconfirmedHtml.toLowerCase().includes('đã đối soát'),
        false,
      );
    });
  });
});
