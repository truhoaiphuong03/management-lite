import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AreaInputMode,
  assertCustomerSafePdfPayload,
  buildCustomerSafePdfPayload,
  calculatePrintQuote,
  enrichCustomerSafePdfWithAreaBounds,
  formatCustomerAreaDisclosure,
  LineCostSource,
  ProfitMode,
  ProfitScope,
  RoundingMode,
  ShippingAllocationStrategy,
  VendorCostMode,
} from '../../dist/packages/contracts/src/printquote.js';
import {
  buildServerA4Html,
  renderCustomerSafeA4PdfBuffer,
} from '../../dist/apps/api/src/printquote/pdf-renderer.js';
import {
  buildPrintQuoteA4Html,
  formatAreaSqmVn,
  formatCustomerLinePriceDisplay,
  validateQuoteDraftInputs,
} from '../../dist/apps/web/src/screens/helpers/printquote-helpers.js';
import { CreateQuoteTab } from '../../dist/apps/web/src/screens/printquote/CreateQuoteTab.js';
import { QuoteDetailView } from '../../dist/apps/web/src/screens/printquote/QuoteDetailView.js';

/**
 * Decompresses FlateDecode streams in a Chromium-generated PDF and decodes
 * glyph hex runs via embedded /ToUnicode CMap tables so tests can verify the
 * actual visible text rendered inside the binary %PDF- file.
 */
function extractVisibleTextFromPdfBuffer(pdfBuffer) {
  const raw = pdfBuffer.toString('latin1');
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  const decompressedStreams = [];
  let match;
  while ((match = streamRegex.exec(raw)) !== null) {
    const chunk = Buffer.from(match[1], 'latin1');
    try {
      decompressedStreams.push(zlib.inflateSync(chunk).toString('latin1'));
    } catch {
      // Non-Flate stream (e.g. raw font/metadata) — ignore
    }
  }

  const glyphToUnicode = new Map();
  for (const s of decompressedStreams) {
    if (!s.includes('begincmap')) continue;
    const bfcharBlocks = s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g);
    for (const block of bfcharBlocks) {
      const pairs = block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g);
      for (const pair of pairs) {
        const glyphHex = pair[1].toUpperCase();
        const uniHex = pair[2];
        let str = '';
        for (let i = 0; i < uniHex.length; i += 4) {
          str += String.fromCodePoint(parseInt(uniHex.slice(i, i + 4), 16));
        }
        glyphToUnicode.set(glyphHex, str);
      }
    }
    const bfrangeBlocks = s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g);
    for (const block of bfrangeBlocks) {
      const ranges = block[1].matchAll(
        /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g,
      );
      for (const r of ranges) {
        const start = parseInt(r[1], 16);
        const end = parseInt(r[2], 16);
        const targetStart = parseInt(r[3], 16);
        const width = r[1].length;
        for (let code = start; code <= end; code++) {
          const hexKey = code.toString(16).toUpperCase().padStart(width, '0');
          glyphToUnicode.set(
            hexKey,
            String.fromCodePoint(targetStart + (code - start)),
          );
        }
      }
    }
  }

  let decodedText = '';
  for (const s of decompressedStreams) {
    if (s.includes('begincmap')) continue;
    const hexTokens = s.matchAll(/<([0-9A-Fa-f]+)>/g);
    for (const tok of hexTokens) {
      const hex = tok[1].toUpperCase();
      if (hex.length % 4 === 0) {
        let piece = '';
        let matched = false;
        for (let i = 0; i < hex.length; i += 4) {
          const g = hex.slice(i, i + 4);
          if (glyphToUnicode.has(g)) {
            piece += glyphToUnicode.get(g);
            matched = true;
          }
        }
        if (matched) decodedText += piece;
      }
    }
    const literalTokens = s.matchAll(/\(([^()\\]*(?:\\.[^()\\]*)*)\)/g);
    for (const lit of literalTokens) {
      decodedText += lit[1];
    }
  }
  return decodedText;
}

function renderLiveCustomerCardHtml(calc, customerPdf, draftLines) {
  return renderToStaticMarkup(
    React.createElement(CreateQuoteTab, {
      editingQuoteId: null,
      editingQuoteCode: null,
      editingQuoteVersion: 1,
      onBackToQuotes: () => {},
      quoteTitle: 'Báo giá kiểm thử độ chính xác m²',
      onChangeQuoteTitle: () => {},
      selectedCustomerId: '',
      onChangeSelectedCustomerId: () => {},
      customers: [],
      priceItems: [],
      validUntil: '',
      onChangeValidUntil: () => {},
      shippingFee: calc.shippingFee,
      shippingFeeInput: String(calc.shippingFee),
      onChangeShippingFee: () => {},
      includeShippingInUnitPrice: calc.includeShippingInUnitPrice,
      onChangeIncludeShippingInUnitPrice: () => {},
      shippingAllocation:
        ShippingAllocationStrategy.PROPORTIONAL_BY_BASE_AMOUNT,
      onChangeShippingAllocation: () => {},
      roundingMode: RoundingMode.NEAREST,
      onChangeRoundingMode: () => {},
      roundingStep: 1,
      onChangeRoundingStep: () => {},
      customerNotes: '',
      onChangeCustomerNotes: () => {},
      internalNotes: '',
      onChangeInternalNotes: () => {},
      versionChangeNote: '',
      onChangeVersionChangeNote: () => {},
      draftLines,
      setDraftLines: () => {},
      onSelectCatalogItem: () => {},
      livePricingResult: {
        calc,
        customerPdf,
        error: null,
      },
      onResetNewQuote: () => {},
      onSaveQuote: () => {},
      onDownloadLivePdf: () => {},
      onOpenLivePreview: () => {},
      onQuickCreateCustomer: async () => null,
    }),
  );
}

describe('PrintQuote PDF & Web Preview Area Precision (5-6 decimals, odd rates, non-exact reconciliation)', () => {
  it('1. Tái hiện lỗi thực tế tại 550935b: diện tích 1,234567 m² × 1.000.000 đ/m² = 1.234.567 đ phải hiển thị đúng 1,234567 trên cả PDF Server (HTML + file .pdf) và Web Preview, không làm tròn thành 1,2346 và không lộ giá vốn/lợi nhuận', async () => {
    const calc = calculatePrintQuote({
      quoteId: 'BG-AREA-1234567',
      customerName: 'Công ty TNHH Đối Chiếu Minh Bạch',
      shippingFee: 0,
      includeShippingInUnitPrice: false,
      items: [
        {
          id: 'ITEM-SQM-6DEC',
          name: 'In PP cán format khổ tùy chỉnh',
          specification: 'PP ngoài trời mực dầu, cán bóng',
          unit: 'm²',
          quantity: 3,
          vendorCostMode: VendorCostMode.PER_SQM,
          baseCostRate: 700_000,
          areaSpec: {
            mode: AreaInputMode.DIRECT_AREA,
            actualAreaSqm: 1.234567,
            billableAreaSqm: 1.234567,
          },
          profit: {
            mode: ProfitMode.FIXED_AMOUNT,
            scope: ProfitScope.PER_SQM,
            value: 300_000,
          },
        },
      ],
    });

    // Không thay đổi số tiền đã tính hoặc âm thầm làm tròn diện tích tính tiền
    assert.equal(calc.lines[0].areaSpec.billableAreaSqm, 1.234567);
    assert.equal(calc.totalVendorCost, 864_197);
    assert.equal(calc.totalProfit, 370_370);
    assert.equal(calc.totalQuoteAmount, 1_234_567);

    const customerPdf = buildCustomerSafePdfPayload(calc, {
      quoteCode: 'BG-202611-601',
    });
    assertCustomerSafePdfPayload(customerPdf);
    assert.equal(customerPdf.lines[0].displayAreaSqm, 1.234567);
    assert.equal(customerPdf.lines[0].lineTotal, 1_234_567);
    assert.equal(customerPdf.grandTotalPayable, 1_234_567);

    // 1a) Server A4 HTML
    const serverHtml = buildServerA4Html(customerPdf, {
      quoteCode: 'BG-202611-601',
      quoteTitle: 'Báo giá in PP khổ lẻ',
      customerName: 'Công ty TNHH Đối Chiếu Minh Bạch',
    });
    assert.equal(serverHtml.includes('1,234567'), true);
    assert.equal(serverHtml.includes('1,2346'), false);
    assert.equal(serverHtml.includes('1.000.000 ₫'), true);
    assert.equal(serverHtml.includes('1.234.567 ₫'), true);
    assert.equal(serverHtml.includes('700.000'), false);
    assert.equal(serverHtml.includes('864.197'), false);
    assert.equal(serverHtml.includes('300.000'), false);
    assert.equal(serverHtml.includes('370.370'), false);

    // 1b) Server real binary A4 PDF (%PDF-)
    const pdfBuf = await renderCustomerSafeA4PdfBuffer(customerPdf, {
      quoteCode: 'BG-202611-601',
      quoteTitle: 'Báo giá in PP khổ lẻ',
      customerName: 'Công ty TNHH Đối Chiếu Minh Bạch',
    });
    assert.equal(pdfBuf.subarray(0, 5).toString('ascii'), '%PDF-');
    const pdfVisibleText = extractVisibleTextFromPdfBuffer(pdfBuf);
    assert.equal(
      pdfVisibleText.includes('1,234567'),
      true,
      `Expected binary PDF text to contain exact 1,234567, got snippet: ${pdfVisibleText.slice(0, 500)}`,
    );
    assert.equal(pdfVisibleText.includes('1,2346'), false);
    assert.equal(pdfVisibleText.includes('1.000.000'), true);
    assert.equal(pdfVisibleText.includes('1.234.567'), true);
    assert.equal(pdfVisibleText.includes('864.197'), false);
    assert.equal(pdfVisibleText.includes('370.370'), false);

    // 1c) Web A4 HTML preview (dùng cho PdfPreviewModal & QuoteDetailView)
    const webA4Html = buildPrintQuoteA4Html(customerPdf, {
      workspaceName: 'Hoài Phương Media',
      quoteCode: 'BG-202611-601',
      quoteTitle: 'Báo giá in PP khổ lẻ',
      customerName: 'Công ty TNHH Đối Chiếu Minh Bạch',
    });
    assert.equal(webA4Html.includes('1,234567'), true);
    assert.equal(webA4Html.includes('1,2346'), false);
    assert.equal(webA4Html.includes('1.000.000 ₫'), true);
    assert.equal(webA4Html.includes('1.234.567 ₫'), true);
    assert.equal(webA4Html.includes('864.197'), false);
    assert.equal(webA4Html.includes('370.370'), false);

    // 1d) Web live "Bản gửi khách" card trên CreateQuoteTab: cột SL phải hiển thị 1,234567 m² (không phải 3 hay 1,2346) để khách nhân 1,234567 × 1.000.000 ₫ = 1.234.567 ₫ khớp 100%
    const createTabHtml = renderLiveCustomerCardHtml(calc, customerPdf, [
      {
        id: 'ITEM-SQM-6DEC',
        name: 'In PP cán format khổ tùy chỉnh',
        specification: 'PP ngoài trời mực dầu, cán bóng',
        vendorPriceItemId: '',
        baseCostSource: LineCostSource.MANUAL,
        unit: 'm²',
        quantity: 3,
        quantityInput: '3',
        areaMode: AreaInputMode.DIRECT_AREA,
        actualAreaInput: '1.234567',
        vendorCostMode: VendorCostMode.PER_SQM,
        vendorCostValue: 700_000,
        vendorCostInput: '700000',
        finishingStages: [],
        profitMode: ProfitMode.FIXED_AMOUNT,
        profitScope: ProfitScope.PER_SQM,
        profitValue: 300_000,
        profitInput: '300000',
        extraCost: 0,
        extraCostInput: '0',
      },
    ]);
    const customerCardMatch = createTabHtml.match(
      /data-testid="pq-customer-safe-card"[\s\S]*$/,
    );
    assert.ok(
      customerCardMatch,
      'Expected pq-customer-safe-card in CreateQuoteTab',
    );
    const customerCardHtml = customerCardMatch[0];
    assert.equal(customerCardHtml.includes('1,234567'), true);
    assert.equal(customerCardHtml.includes('1,2346'), false);
    assert.equal(customerCardHtml.includes('1.000.000 ₫'), true);
    assert.equal(customerCardHtml.includes('1.234.567 ₫'), true);
    // Cột SL trong bảng Bản gửi khách phải mang diện tích tính tiền 1,234567 m², không phải số tấm ">3</td>"
    assert.equal(customerCardHtml.includes('>3</td>'), false);
    assert.equal(customerCardHtml.includes('864.197'), false);
    assert.equal(customerCardHtml.includes('370.370'), false);

    // 1e) QuoteDetailView nhúng iframe A4 cũng giữ nguyên 1,234567
    const detailHtml = renderToStaticMarkup(
      React.createElement(QuoteDetailView, {
        quote: {
          id: 'q-6dec-1',
          workspace_id: 'ws-1',
          quote_code: 'BG-202611-601',
          title: 'Báo giá in PP khổ lẻ',
          customer_id: null,
          customer_name: 'Công ty TNHH Đối Chiếu Minh Bạch',
          customer_phone: '0901234567',
          customer_address: 'TP.HCM',
          status: 'SENT',
          pricing_status: 'COMPLETE',
          current_version: 1,
          valid_until: null,
          include_shipping_in_unit_price: false,
          shipping_allocation_strategy: 'PROPORTIONAL_BY_BASE_AMOUNT',
          rounding_mode: 'NEAREST',
          rounding_step: 1,
          shipping_fee: 0,
          extra_cost: 0,
          total_quantity: 3,
          total_vendor_cost: 864_197,
          total_profit: 370_370,
          total_quote_amount: 1_234_567,
          single_product_final_unit_price: 411_522,
          total_rounding_adjustment: 0,
          notes: null,
          internal_notes: 'Ghi chú nội bộ mật',
          lines_json: calc.lines,
          snapshot_json: null,
          customer_pdf_json: customerPdf,
          created_at: '2026-11-04T06:00:00.000Z',
          updated_at: '2026-11-04T06:00:00.000Z',
        },
        customers: [],
        workspaceName: 'Hoài Phương Media',
        loading: false,
        onBackToList: () => {},
        onOpenFullPdfModal: () => {},
        onDownloadPdfFile: () => {},
        onEditQuote: () => {},
        onCloneQuoteAsNew: () => {},
        onFinalizeQuote: () => {},
        onConvertQuoteToOrder: () => {},
      }),
    );
    assert.equal(detailHtml.includes('1,234567'), true);
    assert.equal(detailHtml.includes('1,2346'), false);
  });

  it('2. Diện tích 5–6 chữ số thập phân kết hợp đơn giá lẻ (nguyên & 2 chữ số thập phân hữu hạn) và kiểm tra nhập liệu 6 chữ số thập phân từ 0,000001 m²', () => {
    // 5 chữ số thập phân: 1,23456 m² × 31.250 đ/m² = 38.580 đ (khớp tuyệt đối)
    const calc5Dec = calculatePrintQuote({
      quoteId: 'BG-AREA-5DEC',
      customerName: 'Khách 5 chữ số thập phân',
      shippingFee: 0,
      includeShippingInUnitPrice: false,
      items: [
        {
          id: 'ITEM-5DEC',
          name: 'Decal sữa cán mờ',
          unit: 'm²',
          quantity: 1,
          vendorCostMode: VendorCostMode.PER_SQM,
          baseCostRate: 20_000,
          areaSpec: {
            mode: AreaInputMode.DIRECT_AREA,
            actualAreaSqm: 1.23456,
            billableAreaSqm: 1.23456,
          },
          profit: {
            mode: ProfitMode.FIXED_AMOUNT,
            scope: ProfitScope.PER_SQM,
            value: 11_250,
          },
        },
      ],
    });
    // 20.000 × 1.23456 = 24.691,2 -> 24.691; 11.250 × 1.23456 = 13.888,8 -> 13.889; tổng = 38.580 đ; 38.580 / 1,23456 = 31.250 đ/m² khớp tuyệt đối!
    assert.equal(calc5Dec.totalQuoteAmount, 38_580);
    const pdf5Dec = buildCustomerSafePdfPayload(calc5Dec, {
      quoteCode: 'BG-5DEC',
    });
    const server5Html = buildServerA4Html(pdf5Dec, { quoteCode: 'BG-5DEC' });
    const web5Html = buildPrintQuoteA4Html(pdf5Dec, { quoteCode: 'BG-5DEC' });
    assert.equal(server5Html.includes('1,23456'), true);
    assert.equal(server5Html.includes('1,2346'), false);
    assert.equal(server5Html.includes('31.250 ₫'), true);
    assert.equal(server5Html.includes('38.580 ₫'), true);
    assert.equal(web5Html.includes('1,23456'), true);
    assert.equal(web5Html.includes('31.250 ₫'), true);

    // 6 chữ số thập phân + đơn giá lẻ có phần thập phân hữu hạn (1,015625 m² × 100.006,4 ₫ = 101.569 ₫ chính xác tuyệt đối)
    const calc6DecFracPrice = calculatePrintQuote({
      quoteId: 'BG-AREA-6DEC-FRAC',
      customerName: 'Khách đơn giá thập phân hữu hạn',
      shippingFee: 0,
      includeShippingInUnitPrice: false,
      items: [
        {
          id: 'ITEM-6DEC-FRAC',
          name: 'Backlit film xuyên sáng',
          unit: 'm²',
          quantity: 1,
          vendorCostMode: VendorCostMode.PER_SQM,
          baseCostRate: 70_000, // 70.000 × 1.015625 = 71.093,75 -> 71.094 đ
          areaSpec: {
            mode: AreaInputMode.DIRECT_AREA,
            actualAreaSqm: 1.015625,
            billableAreaSqm: 1.015625,
          },
          profit: {
            mode: ProfitMode.FIXED_AMOUNT,
            scope: ProfitScope.TOTAL_BATCH,
            value: 30_475, // 71.094 + 30.475 = 101.569 đ -> 101.569 ÷ 1,015625 = 100.006,4 ₫
          },
        },
      ],
    });
    assert.equal(calc6DecFracPrice.totalQuoteAmount, 101_569);
    const dispFrac = formatCustomerLinePriceDisplay(101_569, 1, 'm²', 1.015625);
    assert.deepEqual(dispFrac, {
      unitPriceDisplay: '100.006,4 ₫',
      priceSubNote: null,
      isExact: true,
    });
    const pdf6Frac = buildCustomerSafePdfPayload(calc6DecFracPrice, {
      quoteCode: 'BG-6DEC-FRAC',
    });
    const server6FracHtml = buildServerA4Html(pdf6Frac, {
      quoteCode: 'BG-6DEC-FRAC',
    });
    const web6FracHtml = buildPrintQuoteA4Html(pdf6Frac, {
      quoteCode: 'BG-6DEC-FRAC',
    });
    assert.equal(server6FracHtml.includes('1,015625'), true);
    assert.equal(server6FracHtml.includes('1,0156<'), false);
    assert.equal(server6FracHtml.includes('100.006,4 ₫'), true);
    assert.equal(server6FracHtml.includes('101.569 ₫'), true);
    assert.equal(web6FracHtml.includes('1,015625'), true);
    assert.equal(web6FracHtml.includes('100.006,4 ₫'), true);

    // Kiểm tra formatAreaSqmVn & validateQuoteDraftInputs cho diện tích nhỏ 6 chữ số thập phân (0,000005 m²)
    assert.equal(formatAreaSqmVn(0.000005), '0,000005');
    assert.equal(formatAreaSqmVn(1.23456), '1,23456');
    assert.equal(formatAreaSqmVn(1.234567), '1,234567');
    assert.equal(formatAreaSqmVn(2.88), '2,88');

    const draftCheck = validateQuoteDraftInputs(
      [
        {
          id: 'TINY-SQM',
          name: 'Tem decal siêu nhỏ tính theo m²',
          unit: 'm²',
          quantity: 1,
          quantityInput: '1',
          areaMode: AreaInputMode.DIRECT_AREA,
          actualAreaInput: '0,000005',
          adjustBillableArea: true,
          billableAreaInput: '0,000006',
          areaAdjustmentReason: 'Cộng hao hụt viền cắt laser',
          vendorCostMode: VendorCostMode.PER_SQM,
          vendorCostValue: 500_000,
          vendorCostInput: '500000',
          profitMode: ProfitMode.FIXED_AMOUNT,
          profitScope: ProfitScope.TOTAL_BATCH,
          profitValue: 10_000,
          profitInput: '10000',
        },
      ],
      '0',
    );
    assert.equal(draftCheck.isValid, true, draftCheck.errors.join(' | '));
    assert.equal(draftCheck.lines[0]?.areaSpec?.actualAreaSqm, 0.000005);
    assert.equal(draftCheck.lines[0]?.areaSpec?.billableAreaSqm, 0.000006);
  });

  it('3. Trường hợp KHÔNG THỂ hiển thị phép nhân chính xác (đơn giá lẻ + làm tròn VND / gộp phí ship): phải ghi chú minh bạch ~... ₫ (Tính trọn gói 1,234567 m²), tổng PDF khớp tuyệt đối báo giá, tuyệt đối không lộ giá vốn/lợi nhuận', async () => {
    const calcNonExact = calculatePrintQuote({
      quoteId: 'BG-NON-EXACT-SQM',
      customerName: 'Công ty Sự Kiện Ánh Dương',
      shippingFee: 50_000,
      includeShippingInUnitPrice: true,
      shippingAllocationStrategy:
        ShippingAllocationStrategy.PROPORTIONAL_BY_BASE_AMOUNT,
      roundingPolicy: { mode: RoundingMode.NEAREST, step: 1 },
      items: [
        {
          id: 'NE-1',
          name: 'Bạt Hiflex 2 da chống xuyên sáng',
          specification: 'Khổ lẻ thực tế, đóng khoen 4 góc',
          unit: 'm²',
          quantity: 2,
          vendorCostMode: VendorCostMode.PER_SQM,
          baseCostRate: 200_000, // 200.000 × 1.234567 = 246.913 đ
          areaSpec: {
            mode: AreaInputMode.DIRECT_AREA,
            actualAreaSqm: 1.234567,
            billableAreaSqm: 1.234567,
          },
          profit: {
            mode: ProfitMode.FIXED_AMOUNT,
            scope: ProfitScope.PER_SQM,
            value: 133_333, // 133.333 × 1.234567 = 164.609 đ
          },
        },
        {
          id: 'NE-2',
          name: 'Standee PP cán mờ ngoài trời',
          specification: 'Gia công xỏ cây 2 đầu',
          unit: 'm²',
          quantity: 1,
          vendorCostMode: VendorCostMode.PER_SQM,
          baseCostRate: 123_457, // 123.457 × 0.98765 = 121.932 đ
          areaSpec: {
            mode: AreaInputMode.DIRECT_AREA,
            actualAreaSqm: 0.98765,
            billableAreaSqm: 0.98765,
          },
          profit: {
            mode: ProfitMode.PERCENTAGE,
            scope: ProfitScope.PER_UNIT,
            value: 17, // 17% trên vốn 121.932 = 20.728 đ
          },
        },
      ],
    });

    const customerPdf = buildCustomerSafePdfPayload(calcNonExact, {
      quoteCode: 'BG-202611-603',
    });
    assertCustomerSafePdfPayload(customerPdf);

    // Tổng thành tiền từng dòng trên PDF phải cộng khớp 100% với tổng báo giá
    const sumPdfLines = customerPdf.lines.reduce(
      (acc, l) => acc + l.lineTotal,
      0,
    );
    assert.equal(sumPdfLines, calcNonExact.totalQuoteAmount);
    assert.equal(customerPdf.grandTotalPayable, calcNonExact.totalQuoteAmount);

    const dispLine1 = formatCustomerLinePriceDisplay(
      customerPdf.lines[0].lineTotal,
      customerPdf.lines[0].quantity,
      customerPdf.lines[0].unit,
      customerPdf.lines[0].displayAreaSqm,
    );
    const dispLine2 = formatCustomerLinePriceDisplay(
      customerPdf.lines[1].lineTotal,
      customerPdf.lines[1].quantity,
      customerPdf.lines[1].unit,
      customerPdf.lines[1].displayAreaSqm,
    );

    assert.equal(dispLine1.isExact, false);
    assert.match(dispLine1.unitPriceDisplay, /^~[\d.]+\s*₫$/);
    assert.equal(dispLine1.priceSubNote, 'Tính trọn gói 1,234567 m²');

    assert.equal(dispLine2.isExact, false);
    assert.match(dispLine2.unitPriceDisplay, /^~[\d.]+\s*₫$/);
    assert.equal(dispLine2.priceSubNote, 'Tính trọn gói 0,98765 m²');

    const serverHtml = buildServerA4Html(customerPdf, {
      quoteCode: 'BG-202611-603',
      customerName: 'Công ty Sự Kiện Ánh Dương',
    });
    const webHtml = buildPrintQuoteA4Html(customerPdf, {
      workspaceName: 'Hoài Phương Media',
      quoteCode: 'BG-202611-603',
      customerName: 'Công ty Sự Kiện Ánh Dương',
    });
    const pdfBuf = await renderCustomerSafeA4PdfBuffer(customerPdf, {
      quoteCode: 'BG-202611-603',
      customerName: 'Công ty Sự Kiện Ánh Dương',
    });
    const pdfText = extractVisibleTextFromPdfBuffer(pdfBuf);

    const createTabNonExactHtml = renderLiveCustomerCardHtml(
      calcNonExact,
      customerPdf,
      [
        {
          id: 'NE-1',
          name: 'Bạt Hiflex 2 da chống xuyên sáng',
          specification: 'Khổ lẻ thực tế, đóng khoen 4 góc',
          vendorPriceItemId: '',
          baseCostSource: LineCostSource.MANUAL,
          unit: 'm²',
          quantity: 2,
          quantityInput: '2',
          areaMode: AreaInputMode.DIRECT_AREA,
          actualAreaInput: '1.234567',
          vendorCostMode: VendorCostMode.PER_SQM,
          vendorCostValue: 200_000,
          vendorCostInput: '200000',
          finishingStages: [],
          profitMode: ProfitMode.FIXED_AMOUNT,
          profitScope: ProfitScope.PER_SQM,
          profitValue: 133_333,
          profitInput: '133333',
          extraCost: 0,
          extraCostInput: '0',
        },
        {
          id: 'NE-2',
          name: 'Standee PP cán mờ ngoài trời',
          specification: 'Gia công xỏ cây 2 đầu',
          vendorPriceItemId: '',
          baseCostSource: LineCostSource.MANUAL,
          unit: 'm²',
          quantity: 1,
          quantityInput: '1',
          areaMode: AreaInputMode.DIRECT_AREA,
          actualAreaInput: '0.98765',
          vendorCostMode: VendorCostMode.PER_SQM,
          vendorCostValue: 123_457,
          vendorCostInput: '123457',
          finishingStages: [],
          profitMode: ProfitMode.PERCENTAGE,
          profitScope: ProfitScope.PER_UNIT,
          profitValue: 17,
          profitInput: '17',
          extraCost: 0,
          extraCostInput: '0',
        },
      ],
    );
    const liveCardMatch = createTabNonExactHtml.match(
      /data-testid="pq-customer-safe-card"[\s\S]*$/,
    );
    assert.ok(liveCardMatch);
    const liveCardHtml = liveCardMatch[0];

    for (const rendered of [serverHtml, webHtml, liveCardHtml]) {
      // Đủ độ chính xác 5 và 6 chữ số thập phân ở cả cột SL lẫn ghi chú trọn gói
      assert.equal(rendered.includes('1,234567'), true);
      assert.equal(rendered.includes('1,2346'), false);
      assert.equal(rendered.includes('0,98765'), true);
      assert.equal(rendered.includes('0,9877'), false);
      assert.equal(rendered.includes('(Tính trọn gói 1,234567 m²)'), true);
      assert.equal(rendered.includes('(Tính trọn gói 0,98765 m²)'), true);
      assert.equal(
        rendered.includes(
          `${calcNonExact.totalQuoteAmount.toLocaleString('vi-VN')} ₫`,
        ),
        true,
      );
      // Không dùng thuật ngữ kế toán khó hiểu và tuyệt đối không lộ vốn/lợi nhuận/phí ship gốc đã gộp
      assert.equal(rendered.includes('Hiệu chỉnh làm tròn'), false);
      assert.equal(rendered.includes('246.913'), false);
      assert.equal(rendered.includes('164.609'), false);
      assert.equal(rendered.includes('121.932'), false);
      assert.equal(rendered.includes('20.728'), false);
      assert.equal(rendered.includes('50.000 ₫'), false);
    }

    const pdfTextCompact = pdfText.replace(/\s+/g, '');
    assert.equal(pdfTextCompact.includes('1,234567'), true);
    assert.equal(pdfTextCompact.includes('1,2346'), false);
    assert.equal(pdfTextCompact.includes('0,98765'), true);
    assert.equal(pdfTextCompact.includes('0,9877'), false);
    assert.equal(pdfTextCompact.includes('Tínhtrọngói1,234567m²'), true);
    assert.equal(pdfTextCompact.includes('Tínhtrọngói0,98765m²'), true);
    assert.equal(
      pdfTextCompact.includes(
        calcNonExact.totalQuoteAmount.toLocaleString('vi-VN'),
      ),
      true,
    );
    assert.equal(pdfTextCompact.includes('246.913'), false);
    assert.equal(pdfTextCompact.includes('164.609'), false);
    assert.equal(pdfTextCompact.includes('121.932'), false);
    assert.equal(pdfTextCompact.includes('20.728'), false);
  });

  it('4. [D-02] Diện tích thực tế bằng vs khác diện tích tính tiền: hiển thị cả hai trên PDF & Web Preview, dùng nhãn trung tính khi chưa có giải thích gửi khách, không tự khẳng định "tối thiểu", không lộ lý do nội bộ xưởng và giữ nguyên tổng tiền + 6 chữ số thập phân', async () => {
    // 4a) Khi hai diện tích BẰNG NHAU (2,88 m² === 2,88 m²): không sinh dòng chênh lệch thừa
    assert.equal(
      formatCustomerAreaDisclosure({
        actualAreaSqm: 2.88,
        billableAreaSqm: 2.88,
        customerAreaNote: 'Tính tiền tối thiểu 2,88 m²',
      }),
      null,
    );

    // 4b) Khi hai diện tích KHÁC NHAU nhưng CHƯA có giải thích gửi khách (chỉ có lý do nội bộ xưởng):
    // Bắt buộc hiển thị trung tính "Thực tế 2,88 m² · Diện tích tính tiền: 3 m²", KHÔNG tự khẳng định "tối thiểu" và KHÔNG lộ lý do nội bộ xưởng
    const calcNeutral = calculatePrintQuote({
      quoteId: 'BG-D02-NEUTRAL',
      customerName: 'Công ty Quảng Cáo Minh Tâm',
      requireAreaAdjustmentReason: true,
      shippingFee: 0,
      includeShippingInUnitPrice: false,
      items: [
        {
          id: 'D02-N1',
          name: 'In bạt Hiflex sự kiện khổ lẻ',
          specification: 'Bạt dày 3.6zem, đóng khoen 4 góc',
          unit: 'm²',
          quantity: 3,
          vendorCostMode: VendorCostMode.PER_SQM,
          baseCostRate: 50_000, // 50.000 × 3 = 150.000
          areaSpec: {
            mode: AreaInputMode.DIMENSIONS,
            widthM: 0.8,
            heightM: 1.2,
            sheetsCount: 3, // thực tế = 2.88 m²
            billableAreaSqm: 3,
            adjustmentReason:
              'Xưởng Hoàng Gia ép tính tối thiểu 1m²/tấm lẻ, bù hao đầu cuộn 15cm',
          },
          profit: {
            mode: ProfitMode.FIXED_AMOUNT,
            scope: ProfitScope.PER_SQM,
            value: 30_000, // 30.000 × 3 = 90.000 -> tổng = 240.000 đ (80.000 đ/m²)
          },
        },
      ],
    });

    assert.equal(calcNeutral.totalVendorCost, 150_000);
    assert.equal(calcNeutral.totalProfit, 90_000);
    assert.equal(calcNeutral.totalQuoteAmount, 240_000);

    const pdfNeutral = buildCustomerSafePdfPayload(calcNeutral, {
      quoteCode: 'BG-202611-D02A',
    });
    assertCustomerSafePdfPayload(pdfNeutral);
    assert.equal(JSON.stringify(pdfNeutral).includes('Xưởng Hoàng Gia'), false);
    assert.equal(JSON.stringify(pdfNeutral).includes('bù hao đầu cuộn'), false);
    assert.equal(JSON.stringify(pdfNeutral).includes('tối thiểu'), false);

    const serverNeutralHtml = buildServerA4Html(pdfNeutral, {
      quoteCode: 'BG-202611-D02A',
      customerName: 'Công ty Quảng Cáo Minh Tâm',
    });
    const webNeutralHtml = buildPrintQuoteA4Html(pdfNeutral, {
      workspaceName: 'Hoài Phương Media',
      quoteCode: 'BG-202611-D02A',
      customerName: 'Công ty Quảng Cáo Minh Tâm',
    });
    const liveNeutralHtml = renderLiveCustomerCardHtml(
      calcNeutral,
      pdfNeutral,
      [
        {
          id: 'D02-N1',
          name: 'In bạt Hiflex sự kiện khổ lẻ',
          specification: 'Bạt dày 3.6zem, đóng khoen 4 góc',
          vendorPriceItemId: '',
          baseCostSource: LineCostSource.MANUAL,
          unit: 'm²',
          quantity: 3,
          quantityInput: '3',
          areaMode: AreaInputMode.DIMENSIONS,
          widthMInput: '0.8',
          heightMInput: '1.2',
          sheetsCountInput: '3',
          adjustBillableArea: true,
          billableAreaInput: '3',
          areaAdjustmentReason:
            'Xưởng Hoàng Gia ép tính tối thiểu 1m²/tấm lẻ, bù hao đầu cuộn 15cm',
          vendorCostMode: VendorCostMode.PER_SQM,
          vendorCostValue: 50_000,
          vendorCostInput: '50000',
          finishingStages: [],
          profitMode: ProfitMode.FIXED_AMOUNT,
          profitScope: ProfitScope.PER_SQM,
          profitValue: 30_000,
          profitInput: '30000',
          extraCost: 0,
          extraCostInput: '0',
        },
      ],
    );
    const liveNeutralCard = liveNeutralHtml.match(
      /data-testid="pq-customer-safe-card"[\s\S]*$/,
    )?.[0];
    assert.ok(liveNeutralCard);

    const pdfNeutralBuf = await renderCustomerSafeA4PdfBuffer(pdfNeutral, {
      quoteCode: 'BG-202611-D02A',
      customerName: 'Công ty Quảng Cáo Minh Tâm',
    });
    const pdfNeutralTextCompact = extractVisibleTextFromPdfBuffer(
      pdfNeutralBuf,
    ).replace(/\s+/g, '');

    for (const view of [serverNeutralHtml, webNeutralHtml, liveNeutralCard]) {
      assert.equal(
        view.includes('Thực tế 2,88 m² · Diện tích tính tiền: 3 m²'),
        true,
      );
      assert.equal(view.includes('tối thiểu'), false);
      assert.equal(view.includes('Xưởng Hoàng Gia'), false);
      assert.equal(view.includes('bù hao đầu cuộn'), false);
      assert.equal(view.includes('150.000'), false);
      assert.equal(view.includes('90.000'), false);
      assert.equal(view.includes('80.000 ₫'), true);
      assert.equal(view.includes('240.000 ₫'), true);
    }
    assert.equal(
      pdfNeutralTextCompact.includes('Thựctế2,88m²·Diệntíchtínhtiền:3m²'),
      true,
    );
    assert.equal(pdfNeutralTextCompact.includes('tốithiểu'), false);
    assert.equal(pdfNeutralTextCompact.includes('XưởngHoàngGia'), false);

    // 4c) Khi Owner nhập giải thích ngắn phù hợp gửi khách ("Tính tiền tối thiểu 3 m²") + kịch bản 6 chữ số thập phân (1,111111 m² -> 1,234567 m²):
    const calcExplained = calculatePrintQuote({
      quoteId: 'BG-D02-EXPLAINED',
      customerName: 'Công ty Sự Kiện Sao Việt',
      requireAreaAdjustmentReason: true,
      shippingFee: 0,
      includeShippingInUnitPrice: false,
      items: [
        {
          id: 'D02-E1',
          name: 'Backdrop Hiflex khung sắt',
          unit: 'm²',
          quantity: 3,
          vendorCostMode: VendorCostMode.PER_SQM,
          baseCostRate: 50_000,
          areaSpec: {
            mode: AreaInputMode.DIMENSIONS,
            widthM: 0.8,
            heightM: 1.2,
            sheetsCount: 3,
            billableAreaSqm: 3,
            adjustmentReason:
              'Ghi chú nội bộ: xưởng tính cọc cuộn tối thiểu 3m²',
            customerAreaNote: 'Tính tiền tối thiểu 3 m²',
          },
          profit: {
            mode: ProfitMode.FIXED_AMOUNT,
            scope: ProfitScope.PER_SQM,
            value: 30_000,
          },
        },
        {
          id: 'D02-E2',
          name: 'Tem UV khổ siêu lẻ 6 chữ số thập phân',
          unit: 'm²',
          quantity: 1,
          vendorCostMode: VendorCostMode.PER_SQM,
          baseCostRate: 700_000,
          areaSpec: {
            mode: AreaInputMode.DIRECT_AREA,
            actualAreaSqm: 1.111111,
            billableAreaSqm: 1.234567,
            adjustmentReason: 'Nội bộ: xưởng cắt laser hao phôi 0,123456m²',
            customerAreaNote: 'Cộng viền bế thành phẩm',
          },
          profit: {
            mode: ProfitMode.FIXED_AMOUNT,
            scope: ProfitScope.PER_SQM,
            value: 300_000,
          },
        },
      ],
    });

    // Tổng tiền không đổi: 240.000 + 1.234.567 = 1.474.567 đ
    assert.equal(calcExplained.totalQuoteAmount, 1_474_567);
    const pdfExplained = buildCustomerSafePdfPayload(calcExplained, {
      quoteCode: 'BG-202611-D02B',
    });
    assertCustomerSafePdfPayload(pdfExplained);
    assert.equal(pdfExplained.grandTotalPayable, 1_474_567);

    const serverExplainedHtml = buildServerA4Html(pdfExplained, {
      quoteCode: 'BG-202611-D02B',
      customerName: 'Công ty Sự Kiện Sao Việt',
    });
    const webExplainedHtml = buildPrintQuoteA4Html(pdfExplained, {
      workspaceName: 'Hoài Phương Media',
      quoteCode: 'BG-202611-D02B',
      customerName: 'Công ty Sự Kiện Sao Việt',
    });
    const pdfExplainedBuf = await renderCustomerSafeA4PdfBuffer(pdfExplained, {
      quoteCode: 'BG-202611-D02B',
      customerName: 'Công ty Sự Kiện Sao Việt',
    });
    const pdfExplainedCompact = extractVisibleTextFromPdfBuffer(
      pdfExplainedBuf,
    ).replace(/\s+/g, '');

    for (const view of [serverExplainedHtml, webExplainedHtml]) {
      assert.equal(
        view.includes('Thực tế 2,88 m² · Tính tiền tối thiểu 3 m²'),
        true,
      );
      assert.equal(
        view.includes(
          'Thực tế 1,111111 m² · Diện tích tính tiền: 1,234567 m² (Cộng viền bế thành phẩm)',
        ),
        true,
      );
      assert.equal(view.includes('1,1111'), true); // prefix of 1,111111
      assert.equal(view.includes('1,2346'), false);
      assert.equal(view.includes('cọc cuộn'), false);
      assert.equal(view.includes('hao phôi'), false);
      assert.equal(view.includes('1.474.567 ₫'), true);
    }
    assert.equal(
      pdfExplainedCompact.includes('Thựctế2,88m²·Tínhtiềntốithiểu3m²'),
      true,
    );
    assert.equal(
      pdfExplainedCompact.includes(
        'Thựctế1,111111m²·Diệntíchtínhtiền:1,234567m²(Cộngviềnbếthànhphẩm)',
      ),
      true,
    );
    assert.equal(pdfExplainedCompact.includes('cọccuộn'), false);
    assert.equal(pdfExplainedCompact.includes('haophôi'), false);

    // 4d) Tương thích báo giá cũ đã lưu trước D-02 (chỉ có displayAreaSqm trên customer_pdf_json, lý do nội bộ nằm trong lines_json):
    const legacyCustomerPdf = {
      ...pdfNeutral,
      lines: pdfNeutral.lines.map((l) => {
        const copy = { ...l };
        delete copy.actualAreaSqm;
        delete copy.billableAreaSqm;
        delete copy.customerAreaNote;
        return copy;
      }),
    };
    const enrichedLegacy = enrichCustomerSafePdfWithAreaBounds(
      legacyCustomerPdf,
      calcNeutral.lines,
    );
    assertCustomerSafePdfPayload(enrichedLegacy);
    const legacyWebHtml = buildPrintQuoteA4Html(enrichedLegacy, {
      quoteCode: 'BG-LEGACY-D02',
    });
    assert.equal(
      legacyWebHtml.includes('Thực tế 2,88 m² · Diện tích tính tiền: 3 m²'),
      true,
    );
    assert.equal(legacyWebHtml.includes('Xưởng Hoàng Gia'), false);
    assert.equal(legacyWebHtml.includes('tối thiểu'), false);
  });
});
