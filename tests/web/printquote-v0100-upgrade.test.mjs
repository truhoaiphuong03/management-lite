import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  LineCostSource,
  ProfitMode,
  ProfitScope,
  VendorCostMode,
  buildCustomerSafePdfPayload,
  calculatePrintQuote,
} from '../../dist/packages/contracts/src/printquote.js';
import {
  buildVietQrImageUrl,
  resolveVietQrBankCode,
} from '../../dist/packages/contracts/src/vietqr.js';
import {
  buildPrintQuoteA4Html,
  refreshClonedLinesFromCatalog,
} from '../../dist/apps/web/src/screens/helpers/printquote-helpers.js';
import { buildServerA4Html } from '../../dist/apps/api/src/printquote/pdf-renderer.js';
import { syncPrintLedgerToFinanceTx } from '../../dist/apps/api/src/printquote/ledger-ar-ap-ops.js';
import { QuotesListTab } from '../../dist/apps/web/src/screens/printquote/QuotesListTab.js';

describe('Phase 2 (v0.10.0) — PrintQuote VietQR, Finance Auto-Sync & 1-Click Clone Refresh', () => {
  it('1. VietQR helper resolves bank codes accurately and rejects empty/short account numbers', () => {
    assert.equal(
      resolveVietQrBankCode('Ngân hàng TMCP Ngoại thương Vietcombank'),
      'VCB',
    );
    assert.equal(resolveVietQrBankCode('MB Bank Quân Đội'), 'MB');
    assert.equal(
      buildVietQrImageUrl({
        bankName: 'Vietcombank',
        bankAccountNumber: '123',
        amountVnd: 500000,
      }),
      null,
    );

    const url = buildVietQrImageUrl({
      bankName: 'Techcombank',
      bankAccountNumber: '1903 6688 9999',
      bankAccountHolder: 'HOAI PHUONG MEDIA',
      amountVnd: 2500000,
      addInfo: 'COC BG-202611-009',
    });
    assert.ok(
      url &&
        url.startsWith(
          'https://img.vietqr.io/image/TCB-190366889999-compact2.png?',
        ),
    );
    const parsedUrl = new URL(url);
    assert.equal(parsedUrl.searchParams.get('amount'), '2500000');
    assert.equal(parsedUrl.searchParams.get('addInfo'), 'COC BG-202611-009');
  });

  it('2. Web & Server A4 Quote HTML embed customer-safe VietQR payment instructions without leaking vendor cost or profit', () => {
    const calc = calculatePrintQuote({
      items: [
        {
          id: 'L1',
          name: 'Tờ rơi A5 C150',
          quantity: 1000,
          unitVendorCost: 1200, // 1.200.000đ vốn
          profit: {
            mode: ProfitMode.FIXED_AMOUNT,
            scope: ProfitScope.PER_UNIT,
            value: 800, // 800.000đ lời -> tổng 2.000.000đ
          },
        },
      ],
    });
    const safePdf = buildCustomerSafePdfPayload(calc);

    const webHtml = buildPrintQuoteA4Html(safePdf, {
      quoteCode: 'BG-202611-088',
      quoteTitle: 'Báo giá tờ rơi A5',
      workspaceName: 'Hoài Phương Media',
      customerName: 'Công ty TNHH Sao Mai',
      paymentBank: {
        bankName: 'Vietcombank',
        bankAccountNumber: '1031739417',
        bankAccountHolder: 'TRUONG HOAI PHUONG',
      },
    });
    assert.ok(webHtml.includes('1031739417'));
    assert.ok(webHtml.includes('COC BG-202611-088'));
    assert.ok(webHtml.includes('1.000.000 ₫')); // 50% suggested deposit
    assert.ok(
      webHtml.includes(
        'https://img.vietqr.io/image/VCB-1031739417-compact2.png',
      ),
    );
    // Strictly zero cost/profit leakage
    assert.equal(webHtml.includes('1.200.000'), false);
    assert.equal(webHtml.includes('800.000'), false);
    assert.equal(webHtml.toLowerCase().includes('lợi nhuận'), false);
    assert.equal(webHtml.toLowerCase().includes('giá vốn'), false);

    // Offline server fallback: no QR data URI -> renders clean bank box without broken external <img>
    const serverHtmlOffline = buildServerA4Html(safePdf, {
      quoteCode: 'BG-202611-088',
      workspaceName: 'Hoài Phương Media',
      paymentBank: {
        bankName: 'Vietcombank',
        bankAccountNumber: '1031739417',
        bankAccountHolder: 'TRUONG HOAI PHUONG',
        qrDataUri: null,
      },
    });
    assert.ok(serverHtmlOffline.includes('1031739417'));
    assert.ok(serverHtmlOffline.includes('COC BG-202611-088'));
    assert.equal(serverHtmlOffline.includes('<img'), false);
  });

  it('3. 1-click Clone button renders on ALL quote statuses (including DRAFT) and refreshes updated catalog rates', () => {
    const sampleDraftQuote = {
      id: 'q-1',
      workspace_id: 'ws-1',
      quote_code: 'BG-202611-101',
      title: 'Hộp giấy Kraft',
      customer_id: 'c-1',
      customer_name: 'Khách A',
      customer_phone: '0909000111',
      customer_address: null,
      status: 'DRAFT',
      pricing_status: 'PRICED',
      current_version: 1,
      shipping_fee: 0,
      include_shipping_in_unit_price: false,
      shipping_allocation_strategy: 'PROPORTIONAL_REVENUE',
      rounding_mode: 'NONE',
      rounding_step: 1,
      total_vendor_cost: 500000,
      total_profit: 200000,
      subtotal_before_shipping: 700000,
      grand_total: 700000,
      lines_json: [],
      customer_pdf_json: {
        quoteCode: 'BG-202611-101',
        lines: [],
        linesSubtotal: 700000,
        shippingAmountToAddOnPdfFooter: 0,
        includeShippingInUnitPrice: false,
        grandTotalPayable: 700000,
        generatedAt: '2026-11-14T00:00:00Z',
      },
      notes: null,
      internal_notes: null,
      valid_until: null,
      created_by: 'u-1',
      created_at: '2026-11-14T00:00:00Z',
      updated_at: '2026-11-14T00:00:00Z',
    };

    const html = renderToStaticMarkup(
      React.createElement(QuotesListTab, {
        quotes: [sampleDraftQuote],
        expandedQuoteHistoryId: null,
        setExpandedQuoteHistoryId: () => {},
        onStartNewQuote: () => {},
        onOpenQuoteDetail: () => {},
        onDownloadSavedQuotePdfFile: () => {},
        onOpenSavedQuotePdf: () => {},
        onLoadQuoteForEdit: () => {},
        onCloneQuoteAsNew: () => {},
        onFinalizeQuote: () => {},
        onConvertQuoteToOrder: () => {},
      }),
    );
    assert.ok(
      html.includes('data-testid="pq-quote-clone-BG-202611-101"'),
      'DRAFT quote must also expose 1-click Clone button',
    );

    const { lines, updatedCount } = refreshClonedLinesFromCatalog(
      [
        {
          id: 'ITEM-1',
          vendorPriceItemId: 'pi-1',
          vendorPriceItemCode: 'GX-001',
          vendorPriceItemVersion: 1,
          name: 'In Offset C150',
          specification: '',
          unit: 'tờ',
          quantity: 1000,
          quantityInput: '1000',
          vendorCostMode: VendorCostMode.PER_UNIT,
          vendorCostValue: 500,
          vendorCostInput: '500',
          baseCostSource: LineCostSource.CATALOG,
          baseCatalogOriginalRate: 500,
          profitMode: ProfitMode.FIXED_AMOUNT,
          profitScope: ProfitScope.PER_UNIT,
          profitValue: 200,
          profitInput: '200',
        },
      ],
      [
        {
          id: 'pi-1',
          workspace_id: 'ws-1',
          vendor_id: 'v-1',
          vendor_name: 'Xưởng A',
          code: 'GX-001',
          name: 'In Offset C150',
          item_type: 'BASE_PRINT',
          category: null,
          specification: null,
          included_stages: [],
          structured_spec: null,
          conditions_note: null,
          unit: 'tờ',
          pricing_mode: VendorCostMode.PER_UNIT,
          unit_cost: 580,
          batch_quantity: 1,
          batch_total_cost: 580,
          default_profit_mode: ProfitMode.FIXED_AMOUNT,
          default_profit_scope: ProfitScope.PER_UNIT,
          default_profit_value: 200,
          note: null,
          is_active: true,
          version: 2,
          created_at: '2026-11-14T00:00:00Z',
          updated_at: '2026-11-14T00:00:00Z',
        },
      ],
    );
    assert.equal(updatedCount, 1);
    assert.equal(lines[0].vendorCostValue, 580);
    assert.equal(lines[0].vendorCostInput, '580');
    assert.equal(lines[0].vendorPriceItemVersion, 2);
  });

  it('4. syncPrintLedgerToFinanceTx writes idempotent fin_entries inside SAVEPOINT for PT/PC/VOID', async () => {
    const executedSql = [];
    const mockClient = {
      async query(sql, params) {
        executedSql.push({ sql: String(sql), params });
        if (String(sql).includes('FROM workspace_memberships')) {
          return { rows: [{ user_id: 'owner-uuid-1' }] };
        }
        if (String(sql).includes('INSERT INTO fin_categories')) {
          return { rows: [{ id: 'cat-uuid-1', name: params[2] }] };
        }
        return { rows: [] };
      },
    };

    await syncPrintLedgerToFinanceTx(mockClient, {
      workspaceId: 'ws-uuid-1',
      fallbackOwnerUserId: 'actor-uuid-1',
      direction: 'income',
      categoryName: 'Thu tiền đơn in ấn',
      amountVnd: 5000000,
      occurredAt: new Date('2026-11-14T08:00:00+07:00'),
      operationKey: 'pq_ar_receipt:tx-123',
      note: 'Phiếu thu in ấn PT-202611-003 - Công ty TNHH Kiểm Thử QA',
    });

    assert.ok(
      executedSql.some((q) => q.sql.includes('SAVEPOINT sp_pq_fin_sync')),
    );
    const finInsert = executedSql.find((q) =>
      q.sql.includes('INSERT INTO fin_entries'),
    );
    assert.ok(finInsert, 'Must insert into fin_entries');
    assert.ok(
      finInsert.sql.includes(
        'ON CONFLICT (workspace_id, owner_user_id, operation_key) DO NOTHING',
      ),
    );
    assert.equal(finInsert.params[2], 'owner-uuid-1');
    assert.equal(finInsert.params[6], 5000000);
    assert.equal(finInsert.params[9], 'pq_ar_receipt:tx-123');
    assert.ok(
      executedSql.some((q) =>
        q.sql.includes('RELEASE SAVEPOINT sp_pq_fin_sync'),
      ),
    );
  });
});
