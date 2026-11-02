import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  ProfitMode,
  ProfitScope,
  VendorCostMode,
  ShippingAllocationStrategy,
  RoundingMode,
  QuoteOrderStatus,
  sha256Hex,
  roundByPolicy,
  allocateIntegerAmount,
  calculatePrintQuote,
  buildPdfQuotePayload,
  buildCustomerSafePdfPayload,
  assertCustomerSafePdfPayload,
  createQuoteOrderSnapshot,
  finalizeQuoteOrder,
  verifyQuoteSnapshotIntegrity,
  QuoteOrderRepository,
  buildQuoteLineFromVendorCatalogItem,
} from '../../dist/packages/contracts/src/index.js';

describe('MGL-PRINTQUOTE V1 — Phase 1 Pricing Engine Unit Tests', () => {
  it('1. Isomorphic SHA-256 matches Node.js crypto.createHash("sha256") for ASCII and Vietnamese UTF-8', () => {
    const samples = [
      '',
      'abc',
      '100 tờ × (300đ vốn + 200đ lợi nhuận) + 50.000đ vận chuyển = 100.000đ',
      JSON.stringify({ quoteId: 'PQ-001', totalQuoteAmount: 100000, lines: [1, 2, 3] }),
    ];
    for (const s of samples) {
      const expected = crypto.createHash('sha256').update(s).digest('hex');
      assert.equal(sha256Hex(s), expected);
    }
  });

  it('2. Yêu cầu chuẩn: 100 tờ × (300đ vốn + 200đ lợi nhuận) + 50.000đ vận chuyển = 100.000đ; đơn giá khách = 1.000đ/tờ; lợi nhuận = 20.000đ', () => {
    const result = calculatePrintQuote({
      quoteId: 'PQ-REQ-10',
      customerName: 'Khách hàng Chuẩn',
      items: [
        {
          id: 'FLYER-100',
          name: 'In tờ rơi A5',
          unit: 'tờ',
          quantity: 100,
          unitVendorCost: 300,
          profit: {
            mode: ProfitMode.FIXED_AMOUNT,
            scope: ProfitScope.PER_UNIT,
            value: 200,
          },
        },
      ],
      shippingFee: 50_000,
      includeShippingInUnitPrice: true,
    });

    assert.equal(result.totalVendorCost, 30_000);
    assert.equal(result.totalProfit, 20_000);
    assert.equal(result.shippingFee, 50_000);
    assert.equal(result.totalQuoteAmount, 100_000);
    assert.equal(result.singleProductFinalUnitPrice, 1_000);
    assert.equal(result.lines[0].finalUnitPrice, 1_000);
    assert.equal(result.lines[0].reconciledLineTotal, 100_000);
    assert.equal(result.isReconciled, true);
    assert.equal(result.reconciliationDelta, 0);
  });

  it('3. Giá nhà in theo 1 đơn vị hoặc toàn lô + Lợi nhuận bằng tiền VND hoặc % theo đơn vị hoặc tổng lô', () => {
    // 3a: Giá vốn đơn vị + Lợi nhuận tiền VND cả lô
    const q1 = calculatePrintQuote({
      items: [
        {
          id: 'ITEM-A',
          name: 'Namecard C300',
          quantity: 200,
          unitVendorCost: 500, // tổng vốn = 100.000đ
          profit: {
            mode: ProfitMode.FIXED_AMOUNT,
            scope: ProfitScope.TOTAL_BATCH,
            value: 40_000,
          },
        },
      ],
      shippingFee: 0,
    });
    assert.equal(q1.totalVendorCost, 100_000);
    assert.equal(q1.totalProfit, 40_000);
    assert.equal(q1.totalQuoteAmount, 140_000);
    assert.equal(q1.singleProductFinalUnitPrice, 700);

    // 3b: Giá vốn cả lô (totalVendorCost) + Lợi nhuận % theo đơn vị & cả lô
    const q2 = calculatePrintQuote({
      items: [
        {
          id: 'ITEM-B',
          name: 'Catalogue A4',
          quantity: 50,
          totalVendorCost: 1_000_000,
          profit: {
            mode: ProfitMode.PERCENTAGE,
            scope: ProfitScope.PER_UNIT,
            value: 25, // 25% = 250.000đ
          },
        },
      ],
      shippingFee: 50_000,
    });
    assert.equal(q2.totalVendorCost, 1_000_000);
    assert.equal(q2.totalProfit, 250_000);
    assert.equal(q2.totalQuoteAmount, 1_300_000);
    assert.equal(q2.singleProductFinalUnitPrice, 26_000);
  });

  it('4. Cước vận chuyển tính 1 lần toàn đơn, gộp vào đơn giá khách và PDF khách hàng tuyệt đối không lộ giá vốn/lợi nhuận', () => {
    const quote = calculatePrintQuote({
      quoteId: 'PQ-PDF-SAFE',
      customerName: 'Công ty Truyền thông X',
      items: [
        {
          id: 'ITEM-1',
          name: 'Tờ rơi A5',
          specification: 'Giấy C150, in 2 mặt',
          vendorId: 'VEN-01',
          vendorName: 'Nhà in Gia Định',
          quantity: 100,
          unitVendorCost: 300,
          profit: {
            mode: ProfitMode.FIXED_AMOUNT,
            scope: ProfitScope.PER_UNIT,
            value: 200,
          },
        },
      ],
      shippingFee: 50_000,
      includeShippingInUnitPrice: true,
    });

    const safePdf = buildCustomerSafePdfPayload(quote, {
      quoteCode: 'BG-202611-001',
      customerPhone: '0901234567',
      customerAddress: 'Q.1, TP.HCM',
    });

    assert.equal(safePdf.shippingAmountToAddOnPdfFooter, 0);
    assert.equal(safePdf.grandTotalPayable, 100_000);
    assert.equal(safePdf.lines[0].unitPrice, 1_000);
    assert.equal(safePdf.lines[0].lineTotal, 100_000);

    // Đảm bảo không có bất kỳ trường giá vốn, lợi nhuận hay nhà in nào lọt ra ngoài
    assert.doesNotThrow(() => assertCustomerSafePdfPayload(safePdf));
    const serialized = JSON.stringify(safePdf);
    assert.equal(serialized.includes('unitVendorCost'), false);
    assert.equal(serialized.includes('totalVendorCost'), false);
    assert.equal(serialized.includes('totalProfit'), false);
    assert.equal(serialized.includes('unitProfit'), false);
    assert.equal(serialized.includes('originalShippingFee'), false);
    assert.equal(serialized.includes('Nhà in Gia Định'), false);

    // Nếu cố tình chèn trường cấm vào payload PDF khách hàng -> phải bị chặn
    assert.throws(
      () => assertCustomerSafePdfPayload({ ...safePdf, totalVendorCost: 30_000 }),
      /Forbidden internal cost\/profit field "totalVendorCost"/,
    );
  });

  it('5. Nhiều sản phẩm với phân bổ cước vận chuyển chính xác (Largest Remainder) & xử lý làm tròn đơn giá lẻ', () => {
    const multiQuote = calculatePrintQuote({
      quoteId: 'PQ-MULTI-01',
      items: [
        {
          id: 'P1',
          name: 'Poster A2',
          quantity: 3,
          totalVendorCost: 60_000,
          profit: {
            mode: ProfitMode.FIXED_AMOUNT,
            scope: ProfitScope.TOTAL_BATCH,
            value: 10_000,
          },
        },
        {
          id: 'P2',
          name: 'Tem nhãn decal',
          quantity: 7,
          totalVendorCost: 140_000,
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

    assert.equal(multiQuote.totalVendorCost, 200_000);
    assert.equal(multiQuote.totalProfit, 30_000);
    assert.equal(multiQuote.shippingFee, 50_000);
    assert.equal(multiQuote.totalAllocatedShippingFee, 50_000);
    assert.equal(multiQuote.totalQuoteAmount, 280_000);
    assert.equal(multiQuote.totalReconciledLinesAmount, 280_000);
    assert.equal(multiQuote.isReconciled, true);
    assert.equal(multiQuote.reconciliationDelta, 0);
    assert.equal(multiQuote.singleProductFinalUnitPrice, null);

    for (const line of multiQuote.lines) {
      const segTotal = line.exactSplitSchedule.reduce(
        (acc, s) => acc + s.subtotal,
        0,
      );
      assert.equal(segTotal, line.reconciledLineTotal);
    }
  });

  it('6. Lưu riêng giá vốn, giá bán, lợi nhuận và KHÔNG tự thay đổi giá đơn cũ khi bảng giá nhà in cập nhật', () => {
    const vendorCatalogItem = {
      id: 'CAT-01',
      vendorId: 'VEN-01',
      vendorName: 'Nhà in Á Châu',
      code: 'TOROI-A5-C150',
      name: 'In tờ rơi A5 C150',
      specification: 'Khổ A5, C150, cán bóng',
      unit: 'tờ',
      pricingMode: VendorCostMode.PER_UNIT,
      unitCost: 300,
      batchQuantity: 1,
      batchTotalCost: 300,
      defaultProfitMode: ProfitMode.FIXED_AMOUNT,
      defaultProfitScope: ProfitScope.PER_UNIT,
      defaultProfitValue: 200,
    };

    // Tạo báo giá từ bảng giá nhà in tại thời điểm T1
    const lineT1 = buildQuoteLineFromVendorCatalogItem(vendorCatalogItem, {
      lineId: 'L-1',
      quantity: 100,
    });
    const quoteT1 = calculatePrintQuote({
      quoteId: 'PQ-HIST-01',
      customerName: 'Khách hàng Cũ',
      items: [lineT1],
      shippingFee: 50_000,
    });

    const repo = new QuoteOrderRepository();
    const draft = createQuoteOrderSnapshot(quoteT1, { orderId: 'ORD-HIST-01' });
    repo.save(draft);
    const finalized = repo.finalize('ORD-HIST-01');

    // Thời điểm T2: Bảng giá nhà in tăng gấp đôi (300đ -> 600đ) và lợi nhuận mặc định đổi sang 500đ
    vendorCatalogItem.unitCost = 600;
    vendorCatalogItem.batchTotalCost = 600;
    vendorCatalogItem.defaultProfitValue = 500;

    // Kiểm tra đơn cũ đã lưu hoàn toàn bất biến (không bị đổi giá theo bảng giá mới)
    const savedOrder = repo.getById('ORD-HIST-01');
    assert.ok(savedOrder);
    assert.equal(savedOrder.status, QuoteOrderStatus.FINALIZED);
    assert.equal(savedOrder.totalVendorCost, 30_000);
    assert.equal(savedOrder.totalProfit, 20_000);
    assert.equal(savedOrder.shippingFee, 50_000);
    assert.equal(savedOrder.finalUnitPrice, 1_000);
    assert.equal(savedOrder.totalQuoteAmount, 100_000);
    assert.equal(savedOrder.lines[0].unitVendorCost, 300);
    assert.equal(savedOrder.lines[0].finalUnitPrice, 1_000);
    assert.equal(verifyQuoteSnapshotIntegrity(savedOrder), true);

    // Mọi nỗ lực ghi đè đơn đã chốt đều bị chặn
    assert.throws(() => repo.save(draft), /đã chốt \(FINALIZED\)/);
  });

  it('7. Kiểm tra roundByPolicy và allocateIntegerAmount trên các biên làm tròn', () => {
    assert.equal(roundByPolicy(333.33, RoundingMode.NEAREST, 1), 333);
    assert.equal(roundByPolicy(333.33, RoundingMode.CEIL, 1), 334);
    assert.equal(roundByPolicy(333.89, RoundingMode.FLOOR, 1), 333);
    assert.equal(roundByPolicy(1240, RoundingMode.NEAREST, 100), 1200);
    assert.deepEqual(allocateIntegerAmount(100, [1, 1, 1]), [34, 33, 33]);
  });
});
