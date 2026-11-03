import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium, webkit } from 'playwright-core';
import { PrintQuoteScreen } from '../../dist/apps/web/src/screens/PrintQuoteScreen.js';
import * as pqHelpers from '../../dist/apps/web/src/screens/helpers/printquote-helpers.js';
import { PrintQuoteService } from '../../dist/apps/api/src/printquote/service.js';
import { verifyQuoteSnapshotIntegrity } from '../../dist/packages/contracts/src/printquote.js';

const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function startInMemoryPrintQuoteWebServer() {
  const distDir = path.resolve(process.cwd(), 'apps/web/dist');
  const indexHtmlPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error(
      `Missing built web bundle at ${indexHtmlPath}. Run "npm run build:web" first.`,
    );
  }

  let postQuotesCount = 0;
  let postPdfCount = 0;
  let lastSavedPayload = null;
  let forcedQuoteSaveFailure = null;

  const initialSavedQuotes = [
    {
      id: 'saved-quote-batch-3',
      workspace_id: 'ws-test-mobile',
      quote_code: 'BG-202611-088',
      title: 'Báo giá tem nhãn bế demi đã lưu',
      customer_id: 'cust-1',
      customer_name: 'Chị Hương — Mỹ phẩm Thiên Nhiên',
      customer_phone: '0909111222',
      customer_address: 'Quận 3, TP.HCM',
      status: 'DRAFT',
      current_version: 1,
      include_shipping_in_unit_price: false,
      shipping_allocation_strategy: 'PROPORTIONAL_BY_BASE_AMOUNT',
      rounding_mode: 'CEIL',
      rounding_step: 1,
      total_quantity: 3,
      total_vendor_cost: 10000,
      total_profit: 5000,
      shipping_fee: 25000,
      total_extra_cost: 0,
      total_quote_amount: 40000,
      total_rounding_adjustment: 0,
      single_product_final_unit_price: 5000,
      lines_json: [
        {
          id: 'SAVED-LINE-1',
          name: 'Tem nhãn decal nhựa 3 tờ trọn lô',
          specification: 'In UV chống nước',
          vendorId: null,
          vendorName: null,
          vendorPriceItemId: null,
          unit: 'tờ',
          quantity: 3,
          unitVendorCost: 10000 / 3,
          totalVendorCost: 10000,
          profitMode: 'FIXED_AMOUNT',
          profitScope: 'TOTAL_BATCH',
          profitInputValue: 5000,
          unitProfit: 5000 / 3,
          totalProfit: 5000,
          allocatedShippingFee: 0,
          totalExtraCost: 0,
          rawFinalUnitPrice: 5000,
          finalUnitPrice: 5000,
          billedLineSubtotal: 15000,
          roundingAdjustment: 0,
          reconciledLineTotal: 15000,
        },
      ],
      snapshot_json: {},
      customer_pdf_json: {
        quoteId: 'saved-quote-batch-3',
        quoteCode: 'BG-202611-088',
        customerName: 'Chị Hương — Mỹ phẩm Thiên Nhiên',
        generatedAt: '2026-11-03T00:00:00.000Z',
        includeShippingInUnitPrice: false,
        lines: [
          {
            index: 1,
            id: 'SAVED-LINE-1',
            name: 'Tem nhãn decal nhựa 3 tờ trọn lô',
            specification: 'In UV chống nước',
            unit: 'tờ',
            quantity: 3,
            unitPrice: 5000,
            billedSubtotal: 15000,
            roundingAdjustment: 0,
            lineTotal: 15000,
            shippingIncludedInUnitPrice: false,
          },
        ],
        subtotalFromLines: 15000,
        totalRoundingAdjustment: 0,
        shippingAmountToAddOnPdfFooter: 25000,
        shippingFooterNote: 'Cước vận chuyển: 25.000 ₫',
        grandTotalPayable: 40000,
      },
      integrity_hash: 'hash-saved-quote-batch-3',
      valid_until: '2026-11-20',
      notes: 'Báo giá đã lưu giữ nguyên số liệu gốc.',
      created_by: 'user-owner-1',
      finalized_at: null,
      created_at: '2026-11-03T00:00:00.000Z',
      updated_at: '2026-11-03T00:00:00.000Z',
    },
    {
      id: 'saved-quote-batch-30k-100',
      workspace_id: 'ws-test-mobile',
      quote_code: 'BG-202611-089',
      title: 'Báo giá trọn lô 30.000đ / 100 tờ',
      customer_id: 'cust-1',
      customer_name: 'Anh Minh — Quán Cà Phê',
      customer_phone: '0909333444',
      customer_address: 'Quận 1, TP.HCM',
      status: 'DRAFT',
      current_version: 1,
      include_shipping_in_unit_price: false,
      shipping_allocation_strategy: 'PROPORTIONAL_BY_BASE_AMOUNT',
      rounding_mode: 'CEIL',
      rounding_step: 1,
      total_quantity: 100,
      total_vendor_cost: 30000,
      total_profit: 10000,
      shipping_fee: 0,
      total_extra_cost: 0,
      total_quote_amount: 40000,
      total_rounding_adjustment: 0,
      single_product_final_unit_price: 400,
      lines_json: [
        {
          id: 'SAVED-BATCH-100',
          name: 'Tờ rơi A5 trọn lô 30k',
          specification: 'In nhanh KTS',
          vendorId: null,
          vendorName: null,
          vendorPriceItemId: null,
          unit: 'tờ',
          quantity: 100,
          unitVendorCost: 300,
          totalVendorCost: 30000,
          vendorCostMode: 'TOTAL_BATCH',
          profitMode: 'FIXED_AMOUNT',
          profitScope: 'TOTAL_BATCH',
          profitInputValue: 10000,
          unitProfit: 100,
          totalProfit: 10000,
          allocatedShippingFee: 0,
          totalExtraCost: 0,
          rawFinalUnitPrice: 400,
          finalUnitPrice: 400,
          billedLineSubtotal: 40000,
          roundingAdjustment: 0,
          reconciledLineTotal: 40000,
        },
      ],
      snapshot_json: {},
      customer_pdf_json: {
        quoteId: 'saved-quote-batch-30k-100',
        quoteCode: 'BG-202611-089',
        customerName: 'Anh Minh — Quán Cà Phê',
        generatedAt: '2026-11-03T00:00:00.000Z',
        includeShippingInUnitPrice: false,
        lines: [
          {
            index: 1,
            id: 'SAVED-BATCH-100',
            name: 'Tờ rơi A5 trọn lô 30k',
            specification: 'In nhanh KTS',
            unit: 'tờ',
            quantity: 100,
            unitPrice: 400,
            billedSubtotal: 40000,
            roundingAdjustment: 0,
            lineTotal: 40000,
            shippingIncludedInUnitPrice: false,
          },
        ],
        subtotalFromLines: 40000,
        totalRoundingAdjustment: 0,
        shippingAmountToAddOnPdfFooter: 0,
        shippingFooterNote: 'Miễn phí vận chuyển',
        grandTotalPayable: 40000,
      },
      integrity_hash: 'hash-saved-quote-batch-30k-100',
      valid_until: '2026-11-25',
      notes: 'Giá nhà in trọn lô 30.000đ.',
      created_by: 'user-owner-1',
      finalized_at: null,
      created_at: '2026-11-03T00:00:00.000Z',
      updated_at: '2026-11-03T00:00:00.000Z',
    },
    {
      id: 'saved-quote-legacy-ambiguous',
      workspace_id: 'ws-test-mobile',
      quote_code: 'BG-202611-090',
      title: 'Báo giá cũ chưa lưu kiểu giá vốn (30.000đ / 100 tờ)',
      customer_id: 'cust-1',
      customer_name: 'Chị Lan — Thời trang',
      customer_phone: '0909555666',
      customer_address: 'Quận 7, TP.HCM',
      status: 'DRAFT',
      current_version: 1,
      include_shipping_in_unit_price: false,
      shipping_allocation_strategy: 'PROPORTIONAL_BY_BASE_AMOUNT',
      rounding_mode: 'CEIL',
      rounding_step: 1,
      total_quantity: 100,
      total_vendor_cost: 30000,
      total_profit: 10000,
      shipping_fee: 0,
      total_extra_cost: 0,
      total_quote_amount: 40000,
      total_rounding_adjustment: 0,
      single_product_final_unit_price: 400,
      lines_json: [
        {
          id: 'SAVED-LEGACY-100',
          name: 'Tag quần áo cũ chưa lưu mode',
          specification: 'Giấy C300',
          vendorId: null,
          vendorName: null,
          vendorPriceItemId: null,
          unit: 'tờ',
          quantity: 100,
          unitVendorCost: 300,
          totalVendorCost: 30000,
          profitMode: 'FIXED_AMOUNT',
          profitScope: 'TOTAL_BATCH',
          profitInputValue: 10000,
          unitProfit: 100,
          totalProfit: 10000,
          allocatedShippingFee: 0,
          totalExtraCost: 0,
          rawFinalUnitPrice: 400,
          finalUnitPrice: 400,
          billedLineSubtotal: 40000,
          roundingAdjustment: 0,
          reconciledLineTotal: 40000,
        },
      ],
      snapshot_json: {},
      customer_pdf_json: {
        quoteId: 'saved-quote-legacy-ambiguous',
        quoteCode: 'BG-202611-090',
        customerName: 'Chị Lan — Thời trang',
        generatedAt: '2026-11-03T00:00:00.000Z',
        includeShippingInUnitPrice: false,
        lines: [
          {
            index: 1,
            id: 'SAVED-LEGACY-100',
            name: 'Tag quần áo cũ chưa lưu mode',
            specification: 'Giấy C300',
            unit: 'tờ',
            quantity: 100,
            unitPrice: 400,
            billedSubtotal: 40000,
            roundingAdjustment: 0,
            lineTotal: 40000,
            shippingIncludedInUnitPrice: false,
          },
        ],
        subtotalFromLines: 40000,
        totalRoundingAdjustment: 0,
        shippingAmountToAddOnPdfFooter: 0,
        shippingFooterNote: 'Miễn phí vận chuyển',
        grandTotalPayable: 40000,
      },
      integrity_hash: 'hash-saved-quote-legacy-ambiguous',
      valid_until: '2026-11-25',
      notes: 'Báo giá legacy trước v0.8.3.',
      created_by: 'user-owner-1',
      finalized_at: null,
      created_at: '2026-11-03T00:00:00.000Z',
      updated_at: '2026-11-03T00:00:00.000Z',
    },
  ];
  let savedQuotes = structuredClone(initialSavedQuotes);

  const server = http.createServer((req, res) => {
    const reqUrl = req.url || '/';
    const cleanPath = reqUrl.split('?')[0].split('#')[0];

    if (cleanPath === '/api/v1/auth/me') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          success: true,
          data: {
            user: {
              id: 'user-owner-1',
              email: 'owner@test.local',
              email_verified: true,
              phone: '0909123456',
            },
            employee: {
              id: 'emp-owner-1',
              phone: '0909123456',
            },
            active_workspace: {
              id: 'ws-test-mobile',
              name: 'Hoài Phương Media',
              role: 'owner',
            },
            csrf_token: 'csrf-mobile-test-token',
          },
        }),
      );
      return;
    }

    if (cleanPath === '/api/v1/print-quotes/quotes' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, data: { items: savedQuotes } }));
      return;
    }

    const singleQuoteGetMatch = /^\/api\/v1\/print-quotes\/quotes\/([^/]+)$/.exec(
      cleanPath,
    );
    if (singleQuoteGetMatch && req.method === 'GET') {
      const targetId = decodeURIComponent(singleQuoteGetMatch[1]);
      const found = savedQuotes.find(
        (q) => q.id === targetId || q.quote_code === targetId,
      );
      if (!found) {
        res.writeHead(404, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Không tìm thấy báo giá.' },
          }),
        );
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, data: found }));
      return;
    }

    if (
      cleanPath.startsWith('/api/v1/print-quotes/quotes') &&
      (req.method === 'POST' || req.method === 'PATCH')
    ) {
      postQuotesCount += 1;
      let rawBody = '';
      req.on('data', (chunk) => {
        rawBody += chunk;
      });
      req.on('end', () => {
        const parsed = JSON.parse(rawBody || '{}');
        lastSavedPayload = parsed;
        if (forcedQuoteSaveFailure) {
          const failSpec = forcedQuoteSaveFailure;
          forcedQuoteSaveFailure = null;
          res.writeHead(failSpec.statusCode, {
            'Content-Type': 'application/json; charset=utf-8',
          });
          res.end(
            JSON.stringify({
              success: false,
              error: {
                code: 'SAVE_FAILED',
                message: failSpec.message,
              },
            }),
          );
          return;
        }
        const patchMatch = /^\/api\/v1\/print-quotes\/quotes\/([^/]+)$/.exec(
          cleanPath,
        );
        let savedRecord;
        if (req.method === 'PATCH' && patchMatch) {
          const patchId = decodeURIComponent(patchMatch[1]);
          const existing =
            savedQuotes.find((q) => q.id === patchId) || savedQuotes[0];
          savedRecord = {
            ...existing,
            current_version: (existing.current_version || 1) + 1,
            title: parsed.title || existing.title,
          };
          savedQuotes = savedQuotes.map((q) =>
            q.id === patchId ? savedRecord : q,
          );
        } else {
          savedRecord = {
            ...savedQuotes[0],
            id: 'saved-new-1',
            quote_code: 'BG-202611-099',
            current_version: 1,
            title: parsed.title || 'Báo giá mới',
          };
          savedQuotes = [
            savedRecord,
            ...savedQuotes.filter((q) => q.id !== 'saved-new-1'),
          ];
        }
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({
            success: true,
            data: savedRecord,
          }),
        );
      });
      return;
    }

    if (cleanPath.includes('/pdf-file')) {
      postPdfCount += 1;
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      res.end('%PDF-1.4 mock');
      return;
    }

    if (cleanPath.startsWith('/api/v1/print-quotes/')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, data: { items: [] } }));
      return;
    }

    if (cleanPath.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, data: {} }));
      return;
    }

    const relPath = cleanPath === '/' ? 'index.html' : cleanPath.slice(1);
    const candidatePath = path.resolve(distDir, relPath);
    if (
      candidatePath.startsWith(distDir) &&
      fs.existsSync(candidatePath) &&
      fs.statSync(candidatePath).isFile()
    ) {
      const ext = path.extname(candidatePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_BY_EXT[ext] || 'application/octet-stream',
      });
      res.end(fs.readFileSync(candidatePath));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(indexHtmlPath));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  return {
    webUrl: `http://127.0.0.1:${port}`,
    getCounters: () => ({ postQuotesCount, postPdfCount, lastSavedPayload }),
    failNextQuoteSave: (
      statusCode = 500,
      message = 'Máy chủ bận tạm thời, vui lòng thử lại.',
    ) => {
      forcedQuoteSaveFailure = { statusCode, message };
    },
    resetCounters: () => {
      postQuotesCount = 0;
      postPdfCount = 0;
      lastSavedPayload = null;
      forcedQuoteSaveFailure = null;
      savedQuotes = structuredClone(initialSavedQuotes);
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

describe('PrintQuote P0 Mobile Numeric Input & iPhone Keyboard Hotfix Regression Suite', () => {
  it('1. Unit & SSR: Helpers phân biệt chuỗi rỗng vs 0 hợp lệ, chuẩn hóa 05000 -> 5000 khi hoàn tất nhập, và gắn đúng inputMode cho iPhone', () => {
    assert.equal(typeof pqHelpers.sanitizeNumericDraftInput, 'function');
    assert.equal(typeof pqHelpers.normalizeNumericDraftOnBlur, 'function');
    assert.equal(typeof pqHelpers.validateQuoteDraftInputs, 'function');

    // Cho phép xóa trắng hoàn toàn (không tự ép về 1 hoặc 0)
    assert.equal(pqHelpers.sanitizeNumericDraftInput('', false), '');
    assert.equal(pqHelpers.normalizeNumericDraftOnBlur('', false), '');

    // Chuẩn hóa số có 0 ở đầu khi hoàn tất nhập (onBlur)
    assert.equal(pqHelpers.normalizeNumericDraftOnBlur('05000', false), '5000');
    assert.equal(pqHelpers.normalizeNumericDraftOnBlur('0500', false), '500');
    assert.equal(pqHelpers.normalizeNumericDraftOnBlur('000', false), '0');
    assert.equal(pqHelpers.normalizeNumericDraftOnBlur('0', false), '0');

    // Dán chuỗi tiền Việt có dấu chấm/phẩy/ký hiệu đ
    assert.equal(
      pqHelpers.sanitizeNumericDraftInput(' 5.000 đ ', false),
      '5000',
    );

    // Chế độ phần trăm thập phân (hỗ trợ dấu phẩy bàn phím iPhone tiếng Việt)
    assert.equal(pqHelpers.sanitizeNumericDraftInput('12,5', true), '12.5');
    assert.equal(pqHelpers.normalizeNumericDraftOnBlur('012,50', true), '12.5');

    // Phân biệt trường chưa nhập ("") và giá trị 0 hợp lệ ("0")
    const emptyCostValidation = pqHelpers.validateQuoteDraftInputs(
      [
        {
          id: 'L1',
          name: 'Tờ rơi',
          unit: 'tờ',
          quantity: 500,
          quantityInput: '500',
          vendorCostMode: 'PER_UNIT',
          vendorCostValue: 0,
          vendorCostInput: '',
          profitMode: 'FIXED_AMOUNT',
          profitScope: 'PER_UNIT',
          profitValue: 500,
          profitInput: '500',
        },
      ],
      '0',
    );
    assert.equal(emptyCostValidation.isValid, false);

    const explicitZeroCostValidation = pqHelpers.validateQuoteDraftInputs(
      [
        {
          id: 'L1',
          name: 'Tờ rơi khuyến mãi',
          unit: 'tờ',
          quantity: 500,
          quantityInput: '500',
          vendorCostMode: 'PER_UNIT',
          vendorCostValue: 0,
          vendorCostInput: '0',
          profitMode: 'FIXED_AMOUNT',
          profitScope: 'PER_UNIT',
          profitValue: 0,
          profitInput: '0',
        },
      ],
      '0',
    );
    assert.equal(explicitZeroCostValidation.isValid, true);

    // SSR markup kiểm tra UX V2: /print-quotes mặc định là Danh sách, /print-quotes/new gắn đúng inputMode="numeric" với ô rỗng
    const defaultListHtml = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        workspaceName: 'Hoài Phương Media',
      }),
    );
    assert.equal(
      defaultListHtml.includes('data-testid="panel-quotes-list"'),
      true,
    );

    const html = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        workspaceName: 'Hoài Phương Media',
        currentPath: '/print-quotes/new',
      }),
    );
    assert.equal(html.includes('inputMode="numeric"'), true);
    assert.equal(html.includes('data-testid="pq-empty-guidance-notice"'), true);
  });

  it('1b. Regression TASK 1: Báo giá Trọn lô 30.000đ / 100 tờ lưu đúng vendorCostMode=TOTAL_BATCH, giữ nguyên 30.000đ khi đổi lên 200 tờ, và không suy đoán trên dữ liệu cũ mơ hồ', async () => {
    let capturedInsertParams = null;
    let capturedUpdateParams = null;
    let storedRow = null;

    const fakeClient = {
      async query(sql, params) {
        if (sql.includes('BEGIN') || sql.includes('COMMIT')) {
          return { rows: [] };
        }
        if (sql.includes('print_code_counters')) {
          return { rows: [{ last_value: 1 }] };
        }
        if (sql.includes('INSERT INTO print_quotes (')) {
          capturedInsertParams = params;
          storedRow = {
            id: 'quote-db-batch-1',
            workspace_id: params[0],
            quote_code: params[1],
            title: params[2],
            customer_id: params[3],
            customer_name: params[4],
            customer_phone: params[5],
            customer_address: params[6],
            status: params[7],
            current_version: 1,
            include_shipping_in_unit_price: params[8],
            shipping_allocation_strategy: params[9],
            rounding_mode: params[10],
            rounding_step: params[11],
            total_quantity: params[12],
            total_vendor_cost: params[13],
            total_profit: params[14],
            shipping_fee: params[15],
            total_extra_cost: params[16],
            total_quote_amount: params[17],
            total_rounding_adjustment: params[18],
            single_product_final_unit_price: params[19],
            lines_json: JSON.parse(params[20]),
            snapshot_json: JSON.parse(params[21]),
            customer_pdf_json: JSON.parse(params[22]),
            integrity_hash: params[23],
            valid_until: params[24],
            notes: params[25],
            created_by: params[26],
            finalized_at: params[27],
            created_at: new Date(),
            updated_at: new Date(),
          };
          return { rows: [storedRow] };
        }
        if (sql.includes('INSERT INTO print_quote_versions')) {
          return {
            rows: [
              {
                id: 'ver-1',
                quote_id: 'quote-db-batch-1',
                version_number: 1,
                status: 'DRAFT',
                total_quantity: 100,
                total_vendor_cost: 30000,
                total_profit: 10000,
                shipping_fee: 0,
                total_extra_cost: 0,
                total_quote_amount: 40000,
                total_rounding_adjustment: 0,
                snapshot_json: storedRow.snapshot_json,
                customer_pdf_json: storedRow.customer_pdf_json,
                integrity_hash: storedRow.integrity_hash,
                change_note: 'v1',
                created_by: 'user-owner-1',
                created_at: new Date(),
              },
            ],
          };
        }
        if (sql.includes('SELECT * FROM print_quotes WHERE id = $1')) {
          return { rows: [storedRow] };
        }
        if (sql.includes('UPDATE print_quotes')) {
          capturedUpdateParams = params;
          storedRow = {
            ...storedRow,
            lines_json: JSON.parse(params[18]),
            snapshot_json: JSON.parse(params[19]),
            integrity_hash: params[21],
          };
          return { rows: [storedRow] };
        }
        if (sql.includes('SELECT * FROM print_quote_versions')) {
          return { rows: [] };
        }
        return { rows: [] };
      },
      release() {},
    };

    const service = new PrintQuoteService({
      connect: async () => fakeClient,
      query: (sql, params) => fakeClient.query(sql, params),
    });
    const ownerCtx = {
      user: { id: 'user-owner-1', email: 'owner@test.local' },
      workspace: { id: 'ws-test-1', name: 'Test WS', role: 'owner' },
    };

    const created = await service.createQuote(ownerCtx, {
      title: 'Trọn lô 30.000đ / 100 tờ',
      shipping_fee: 0,
      include_shipping_in_unit_price: false,
      items: [
        {
          id: 'ITEM-1',
          name: 'Tờ rơi A5',
          unit: 'tờ',
          quantity: 100,
          vendorCostMode: 'TOTAL_BATCH',
          totalVendorCost: 30000,
          profitMode: 'FIXED_AMOUNT',
          profitScope: 'TOTAL_BATCH',
          profitValue: 10000,
        },
      ],
    });

    assert.ok(capturedInsertParams, 'Phải thực hiện INSERT INTO print_quotes');
    assert.equal(created.lines_json[0].unitVendorCost, 300);
    assert.equal(created.lines_json[0].totalVendorCost, 30000);
    assert.equal(
      created.lines_json[0].vendorCostMode,
      'TOTAL_BATCH',
      'lines_json phải lưu tường minh vendorCostMode = TOTAL_BATCH',
    );
    assert.equal(
      verifyQuoteSnapshotIntegrity(created.snapshot_json),
      true,
      'Snapshot integrityHash phải toàn vẹn 100% mà không sửa Pricing Engine',
    );

    const updatedTitleOnly = await service.updateQuote(ownerCtx, created.id, {
      title: 'Trọn lô 30.000đ / 100 tờ (đổi tiêu đề)',
    });
    assert.ok(capturedUpdateParams);
    assert.equal(updatedTitleOnly.lines_json[0].vendorCostMode, 'TOTAL_BATCH');
    assert.equal(
      verifyQuoteSnapshotIntegrity(updatedTitleOnly.snapshot_json),
      true,
    );

    const resolvedExplicitBatch = pqHelpers.resolveSavedQuoteLineCostState({
      quantity: 100,
      unitVendorCost: 300,
      totalVendorCost: 30000,
      vendorCostMode: 'TOTAL_BATCH',
    });
    assert.equal(resolvedExplicitBatch.vendorCostMode, 'TOTAL_BATCH');
    assert.equal(resolvedExplicitBatch.vendorCostValue, 30000);
    assert.equal(resolvedExplicitBatch.ambiguousLegacyCost, null);

    const resolvedLegacyAmbiguous = pqHelpers.resolveSavedQuoteLineCostState({
      quantity: 100,
      unitVendorCost: 300,
      totalVendorCost: 30000,
    });
    assert.ok(
      resolvedLegacyAmbiguous.ambiguousLegacyCost,
      'Dữ liệu cũ không đủ căn cứ phân biệt 300đ/tờ hay 30.000đ/lô phải đánh dấu ambiguousLegacyCost',
    );

    const validAt100 = pqHelpers.validateQuoteDraftInputs(
      [
        {
          id: 'L1',
          name: 'Tag cũ',
          unit: 'tờ',
          quantity: 100,
          quantityInput: '100',
          vendorCostMode: resolvedLegacyAmbiguous.vendorCostMode,
          vendorCostValue: resolvedLegacyAmbiguous.vendorCostValue,
          vendorCostInput: resolvedLegacyAmbiguous.vendorCostInput,
          ambiguousLegacyCost: resolvedLegacyAmbiguous.ambiguousLegacyCost,
          profitMode: 'FIXED_AMOUNT',
          profitScope: 'TOTAL_BATCH',
          profitValue: 10000,
          profitInput: '10000',
        },
      ],
      '0',
    );
    assert.equal(validAt100.isValid, true);

    const blockedAt200 = pqHelpers.validateQuoteDraftInputs(
      [
        {
          id: 'L1',
          name: 'Tag cũ',
          unit: 'tờ',
          quantity: 200,
          quantityInput: '200',
          vendorCostMode: resolvedLegacyAmbiguous.vendorCostMode,
          vendorCostValue: resolvedLegacyAmbiguous.vendorCostValue,
          vendorCostInput: resolvedLegacyAmbiguous.vendorCostInput,
          ambiguousLegacyCost: resolvedLegacyAmbiguous.ambiguousLegacyCost,
          profitMode: 'FIXED_AMOUNT',
          profitScope: 'TOTAL_BATCH',
          profitValue: 10000,
          profitInput: '10000',
        },
      ],
      '0',
    );
    assert.equal(
      blockedAt200.isValid,
      false,
      'Không được tự ý suy đoán thành 60.000đ hay 30.000đ khi đổi số lượng trên báo giá cũ thiếu vendorCostMode',
    );
    assert.ok(blockedAt200.lineErrors.L1?.costMode);
  });

  it('2. Real Browser (Chrome + Playwright WebKit trên iPhone 390x844, 320x568 & Landscape): Kịch bản A–F, con trỏ sửa giữa chuỗi, dán số, ẩn MobileBottomNav/ReportBugWidget khi mở bàn phím', async () => {
    const server = await startInMemoryPrintQuoteWebServer();

    const browserTargets = [
      {
        label: 'Chrome Mobile iPhone',
        launch: () =>
          chromium.launch({
            channel: 'chrome',
            headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage'],
          }),
      },
    ];

    if (fs.existsSync(webkit.executablePath())) {
      browserTargets.push({
        label: 'Playwright WebKit iPhone (Safari Engine)',
        launch: () => webkit.launch({ headless: true }),
      });
    }

    try {
      for (const target of browserTargets) {
        const browser = await target.launch();
        try {
          const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
            userAgent:
              'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
          });
          const page = await context.newPage();
          server.resetCounters();

          // UX V2: /print-quotes mặc định mở Danh sách báo giá + nút "+ Tạo báo giá mới"
          await page.goto(`${server.webUrl}/print-quotes`, {
            waitUntil: 'networkidle',
          });
          await page.waitForSelector('[data-testid="panel-quotes-list"]', {
            timeout: 15000,
          });
          await page.waitForSelector('[data-testid="quote-row-BG-202611-088"]');

          // Trên màn hình danh sách (/print-quotes): khi bàn phím đóng MobileBottomNav & ReportBugWidget hiển thị; khi bàn phím mở tự ẩn
          const listClosedOverlay = await page.evaluate(() => {
            const navWrap = document.querySelector(
              '.mobile-bottom-nav-wrapper',
            );
            const bugBtn = document.querySelector('.btn-floating-report-bug');
            const navStyle = navWrap ? window.getComputedStyle(navWrap) : null;
            const bugStyle = bugBtn ? window.getComputedStyle(bugBtn) : null;
            return {
              navVisible:
                Boolean(navStyle) &&
                navStyle.visibility !== 'hidden' &&
                navStyle.display !== 'none' &&
                navStyle.opacity !== '0',
              bugVisible:
                Boolean(bugStyle) &&
                bugStyle.visibility !== 'hidden' &&
                bugStyle.display !== 'none' &&
                bugStyle.opacity !== '0',
            };
          });
          assert.equal(
            listClosedOverlay.navVisible,
            true,
            `[${target.label}] Trên /print-quotes khi đóng bàn phím, MobileBottomNav phải hiển thị`,
          );
          assert.equal(
            listClosedOverlay.bugVisible,
            true,
            `[${target.label}] Trên /print-quotes khi đóng bàn phím, nút Báo lỗi nổi phải hiển thị`,
          );

          await page.setViewportSize({ width: 390, height: 420 });
          await page.locator('#pq-quotes-search-input').focus();
          await page.waitForFunction(
            () =>
              window.innerHeight === 420 &&
              document.documentElement.getAttribute('data-mobile-keyboard') ===
                'open',
            { timeout: 3000 },
          );
          const listKbOpenOverlay = await page.evaluate(() => {
            const navWrap = document.querySelector(
              '.mobile-bottom-nav-wrapper',
            );
            const bugBtn = document.querySelector('.btn-floating-report-bug');
            const navStyle = navWrap ? window.getComputedStyle(navWrap) : null;
            const bugStyle = bugBtn ? window.getComputedStyle(bugBtn) : null;
            return {
              navHidden:
                !navStyle ||
                navStyle.visibility === 'hidden' ||
                navStyle.display === 'none' ||
                navStyle.opacity === '0',
              bugHidden:
                !bugStyle ||
                bugStyle.visibility === 'hidden' ||
                bugStyle.display === 'none' ||
                bugStyle.opacity === '0',
            };
          });
          assert.equal(listKbOpenOverlay.navHidden, true);
          assert.equal(listKbOpenOverlay.bugHidden, true);

          await page
            .locator('#pq-quotes-search-input')
            .evaluate((el) => el.blur());
          await page.setViewportSize({ width: 390, height: 844 });
          await page.waitForFunction(
            () =>
              window.innerHeight === 844 &&
              document.documentElement.getAttribute('data-mobile-keyboard') ===
                'closed',
            { timeout: 3000 },
          );

          // Bấm "+ Tạo báo giá mới" -> mở /print-quotes/new với form sạch rỗng
          await page.click('[data-testid="pq-new-quote-cta"]');
          await page.waitForSelector('[data-testid="panel-create-quote"]', {
            timeout: 15000,
          });
          assert.ok(
            page.url().endsWith('/print-quotes/new'),
            `[${target.label}] Bấm + Tạo báo giá mới phải chuyển sang /print-quotes/new`,
          );

          const qtyInput = page.locator('input[aria-label="Số lượng dòng 1"]');
          const costInput = page.locator(
            'input[aria-label="Giá trị giá vốn dòng 1"]',
          );
          const profitInput = page.locator(
            'input[aria-label="Giá trị lợi nhuận dòng 1"]',
          );
          const shipInput = page.locator('[data-testid="pq-shipping-input"]');

          // Form /print-quotes/new khởi tạo sạch rỗng, không điền sẵn số mẫu 100 / 300 / 200
          assert.equal(await qtyInput.inputValue(), '');
          assert.equal(await costInput.inputValue(), '');
          assert.equal(await profitInput.inputValue(), '');
          assert.equal(
            await page
              .locator('[data-testid="pq-empty-guidance-notice"]')
              .count(),
            1,
          );

          // --- SCENARIO A: Số lượng 1 -> xóa hết -> phải rỗng ("") -> nhập 500 -> kết quả 500 (KHÔNG PHẢI 1500) ---
          await qtyInput.click();
          await qtyInput.fill('1');
          assert.equal(await qtyInput.inputValue(), '1');
          await qtyInput.press('Backspace');
          assert.equal(
            await qtyInput.inputValue(),
            '',
            `[${target.label}] Xóa hết số lượng phải rỗng hoàn toàn, không được tự chèn 1`,
          );

          // --- SCENARIO E (khi đang trống): Không hiện tổng tiền giả & khóa nút Lưu / Xuất PDF ---
          assert.equal(
            await page.locator('[data-testid="pq-live-breakdown"]').count(),
            0,
            `[${target.label}] Khi số lượng đang trống không được hiển thị bảng tổng tiền giả`,
          );
          assert.equal(
            await page
              .locator('[data-testid="pq-save-quote-btn"]')
              .isDisabled(),
            true,
            `[${target.label}] Nút Lưu báo giá phải khóa khi trường bắt buộc đang trống`,
          );
          assert.equal(
            await page
              .locator('[data-testid="pq-download-pdf-btn"]')
              .isDisabled(),
            true,
            `[${target.label}] Nút Tải PDF phải khóa khi trường bắt buộc đang trống`,
          );

          await qtyInput.pressSequentially('500');
          assert.equal(
            await qtyInput.inputValue(),
            '500',
            `[${target.label}] Nhập 500 sau khi xóa 1 phải ra 500, tuyệt đối không thành 1500`,
          );

          // Kiểm tra thêm SCENARIO E khi nhập số lượng không hợp lệ ("0"): chặn tính giả & chặn Lưu/Xuất PDF
          await qtyInput.fill('0');
          assert.equal(await qtyInput.inputValue(), '0');
          assert.equal(
            await page.locator('[data-testid="pq-live-breakdown"]').count(),
            0,
            `[${target.label}] Khi số lượng = 0 không được hiển thị bảng tổng tiền giả`,
          );
          assert.equal(
            await page
              .locator('[data-testid="pq-save-quote-btn"]')
              .isDisabled(),
            true,
          );
          assert.equal(server.getCounters().postQuotesCount, 0);
          assert.equal(server.getCounters().postPdfCount, 0);

          // Xóa "0" về rỗng rồi nhập lại "500"
          await qtyInput.press('Backspace');
          assert.equal(await qtyInput.inputValue(), '');
          await qtyInput.pressSequentially('500');
          assert.equal(await qtyInput.inputValue(), '500');

          // --- TASK 2: Khi bàn phím mở (ô nhập đang focus trên iPhone), MobileBottomNav & ReportBugWidget không che ô nhập ---
          await page.setViewportSize({ width: 390, height: 420 }); // Mô phỏng chiều cao còn lại khi bàn phím iPhone bật
          await qtyInput.focus();
          await page.waitForFunction(
            () =>
              window.innerHeight === 420 &&
              document.documentElement.getAttribute('data-mobile-keyboard') ===
                'open',
            { timeout: 3000 },
          );
          // Chờ 1 nhịp layout/frame sau khi sự kiện resize đã cập nhật xong viewport
          await page.evaluate(
            () =>
              new Promise((resolve) =>
                window.requestAnimationFrame(() =>
                  window.requestAnimationFrame(resolve),
                ),
              ),
          );

          const kbOpenOverlayState = await page.evaluate(() => {
            const navWrap = document.querySelector(
              '.mobile-bottom-nav-wrapper',
            );
            const bugBtn = document.querySelector('.btn-floating-report-bug');
            const navStyle = navWrap ? window.getComputedStyle(navWrap) : null;
            const bugStyle = bugBtn ? window.getComputedStyle(bugBtn) : null;
            const activeEl = document.activeElement;
            const rect = activeEl ? activeEl.getBoundingClientRect() : null;
            return {
              mobileKeyboardAttr: document.documentElement.getAttribute(
                'data-mobile-keyboard',
              ),
              navHidden:
                !navStyle ||
                navStyle.visibility === 'hidden' ||
                navStyle.display === 'none' ||
                navStyle.opacity === '0',
              bugHidden:
                !bugStyle ||
                bugStyle.visibility === 'hidden' ||
                bugStyle.display === 'none' ||
                bugStyle.opacity === '0',
              inputTop: rect ? rect.top : 0,
              inputBottom: rect ? rect.bottom : 0,
              innerHeight: window.innerHeight,
            };
          });
          assert.equal(
            kbOpenOverlayState.navHidden,
            true,
            `[${target.label}] MobileBottomNav phải ẩn trên màn hình tạo/sửa báo giá và khi bàn phím mở`,
          );
          assert.equal(
            kbOpenOverlayState.bugHidden,
            true,
            `[${target.label}] Nút Báo lỗi nổi phải ẩn trên màn hình tạo/sửa báo giá và khi bàn phím mở`,
          );
          assert.ok(
            kbOpenOverlayState.inputTop >= 40 &&
              kbOpenOverlayState.inputBottom <= kbOpenOverlayState.innerHeight,
            `[${target.label}] Ô đang nhập phải tự cuộn nằm trọn trong vùng nhìn thấy (${kbOpenOverlayState.inputTop}..${kbOpenOverlayState.inputBottom} / ${kbOpenOverlayState.innerHeight})`,
          );

          // Kiểm tra độ ổn định chống race qua nhiều chu kỳ:
          // (a) Chuyển focus liên tiếp từ đầu trang xuống cuối trang khi bàn phím đang mở (390x420)
          // (b) Ô đã focus sẵn ở 390x844 (scrollY=0), sau đó thu hẹp đột ngột về 390x420 mà KHÔNG gọi lại focus()
          for (const focusTarget of [
            page.locator('[data-testid="pq-title-input"]'),
            qtyInput,
            costInput,
            profitInput,
            shipInput,
          ]) {
            await focusTarget.focus();
            await page.evaluate(
              () =>
                new Promise((resolve) =>
                  window.requestAnimationFrame(() =>
                    window.requestAnimationFrame(resolve),
                  ),
                ),
            );
            const focusRect = await page.evaluate(() => {
              const el = document.activeElement;
              const r = el ? el.getBoundingClientRect() : null;
              return {
                top: r ? r.top : 0,
                bottom: r ? r.bottom : 0,
                innerHeight: window.innerHeight,
              };
            });
            assert.ok(
              focusRect.top >= 40 && focusRect.bottom <= focusRect.innerHeight,
              `[${target.label}] Khi nhảy focus sang ô khác lúc bàn phím mở, ô phải nằm trọn trong viewport (${focusRect.top}..${focusRect.bottom} / ${focusRect.innerHeight})`,
            );
          }

          for (let cycle = 1; cycle <= 3; cycle += 1) {
            await page.setViewportSize({ width: 390, height: 844 });
            await page.waitForFunction(() => window.innerHeight === 844, {
              timeout: 3000,
            });
            await qtyInput.focus();
            await page.evaluate(() => window.scrollTo(0, 0));
            // Không gọi lại qtyInput.focus() — thu hẹp trực tiếp viewport 844 -> 420 như khi bàn phím iOS/Android bật lên trên ô đang focus
            await page.setViewportSize({ width: 390, height: 420 });
            await page.waitForFunction(() => window.innerHeight === 420, {
              timeout: 3000,
            });
            await page.evaluate(
              () =>
                new Promise((resolve) =>
                  window.requestAnimationFrame(() =>
                    window.requestAnimationFrame(resolve),
                  ),
                ),
            );
            const cycleRect = await page.evaluate(() => {
              const el = document.activeElement;
              const r = el ? el.getBoundingClientRect() : null;
              return {
                top: r ? r.top : 0,
                bottom: r ? r.bottom : 0,
                innerHeight: window.innerHeight,
              };
            });
            assert.ok(
              cycleRect.top >= 40 && cycleRect.bottom <= cycleRect.innerHeight,
              `[${target.label}] Chu kỳ ổn định #${cycle}: thu hẹp viewport 844->420 khi ô đang focus sẵn phải tự cuộn vào vùng nhìn thấy (${cycleRect.top}..${cycleRect.bottom} / ${cycleRect.innerHeight})`,
            );
          }

          // --- SCENARIO B: Giá nhà in 300 -> xóa hết -> nhập 5000 -> kết quả 5000 (KHÔNG PHẢI 05000) ---
          await costInput.click();
          await costInput.fill('300');
          await costInput.selectText();
          await costInput.press('Backspace');
          assert.equal(
            await costInput.inputValue(),
            '',
            `[${target.label}] Xóa hết Giá nhà in phải rỗng hoàn toàn, không tự chèn 0`,
          );
          await costInput.pressSequentially('5000');
          assert.equal(
            await costInput.inputValue(),
            '5000',
            `[${target.label}] Nhập Giá nhà in 5000 phải hiển thị đúng 5000, không phải 05000`,
          );

          // Kiểm tra chuẩn hóa 05000 -> 5000 khi hoàn tất nhập (blur)
          await costInput.fill('05000');
          await profitInput.focus();
          assert.equal(
            await costInput.inputValue(),
            '5000',
            `[${target.label}] Chuỗi 05000 phải tự chuẩn hóa thành 5000 sau khi rời ô nhập`,
          );

          // --- SCENARIO C: Tiền lời 200 -> xóa hết -> nhập 500 -> kết quả 500 (KHÔNG PHẢI 0500) ---
          await profitInput.fill('200');
          await profitInput.selectText();
          await profitInput.press('Backspace');
          assert.equal(
            await profitInput.inputValue(),
            '',
            `[${target.label}] Xóa hết Tiền lời phải rỗng hoàn toàn, không tự chèn 0`,
          );
          await profitInput.pressSequentially('500');
          assert.equal(
            await profitInput.inputValue(),
            '500',
            `[${target.label}] Nhập Tiền lời 500 phải hiển thị đúng 500, không phải 0500`,
          );

          // Chuẩn hóa 0500 -> 500 khi blur
          await profitInput.fill('0500');
          await shipInput.focus();
          assert.equal(
            await profitInput.inputValue(),
            '500',
            `[${target.label}] Chuỗi 0500 phải tự chuẩn hóa thành 500 sau khi rời ô nhập`,
          );

          // Kiểm tra sửa ở giữa chuỗi & giữ ổn định vị trí con trỏ + dán số
          await costInput.focus();
          await costInput.evaluate((el) => {
            el.setSelectionRange(1, 1); // "5|000"
          });
          await page.keyboard.type('2');
          const midEditState = await costInput.evaluate((el) => ({
            value: el.value,
            selectionStart: el.selectionStart,
          }));
          assert.equal(midEditState.value, '52000');
          assert.equal(
            midEditState.selectionStart,
            2,
            `[${target.label}] Con trỏ phải giữ nguyên tại vị trí 2 sau khi gõ ở giữa chuỗi`,
          );
          // Dán chuỗi tiền tệ định dạng "5.000 đ" -> "5000"
          await costInput.fill(' 5.000 đ ');
          assert.equal(await costInput.inputValue(), '5000');

          // --- SCENARIO D: SL 500, Giá nhà in 5000đ/đv, Lời 500đ/đv, Ship 0đ ---
          await shipInput.click();
          await shipInput.selectText();
          await shipInput.press('Backspace');
          await shipInput.pressSequentially('0');
          assert.equal(await shipInput.inputValue(), '0');

          // Đóng bàn phím & khôi phục chiều cao màn hình iPhone 390x844
          await shipInput.evaluate((el) => el.blur());
          await page.setViewportSize({ width: 390, height: 844 });
          await page.waitForFunction(
            () =>
              window.innerHeight === 844 &&
              document.documentElement.getAttribute('data-mobile-keyboard') ===
                'closed',
            { timeout: 3000 },
          );

          // UX V2: Trên route soạn thảo tập trung (/print-quotes/new), MobileBottomNav & ReportBugWidget luôn ẩn trên mobile <=768px để không che CTA Lưu
          const editorOverlayState = await page.evaluate(() => {
            const navWrap = document.querySelector(
              '.mobile-bottom-nav-wrapper',
            );
            const bugBtn = document.querySelector('.btn-floating-report-bug');
            const navStyle = navWrap ? window.getComputedStyle(navWrap) : null;
            const bugStyle = bugBtn ? window.getComputedStyle(bugBtn) : null;
            return {
              pqEditorAttr: document
                .querySelector('.app-shell-root')
                ?.getAttribute('data-pq-editor'),
              navHidden:
                !navStyle ||
                navStyle.visibility === 'hidden' ||
                navStyle.display === 'none' ||
                navStyle.opacity === '0',
              bugHidden:
                !bugStyle ||
                bugStyle.visibility === 'hidden' ||
                bugStyle.display === 'none' ||
                bugStyle.opacity === '0',
            };
          });
          assert.equal(editorOverlayState.pqEditorAttr, 'true');
          assert.equal(
            editorOverlayState.navHidden,
            true,
            `[${target.label}] Trên /print-quotes/new di động, MobileBottomNav giữ ẩn để không che nút Lưu`,
          );
          assert.equal(
            editorOverlayState.bugHidden,
            true,
            `[${target.label}] Trên /print-quotes/new di động, nút Báo lỗi nổi giữ ẩn để không che ô nhập`,
          );

          assert.match(
            await page.textContent('[data-testid="pq-summary-vendor-cost"]'),
            /2\.500\.000\s*₫/,
          );
          assert.match(
            await page.textContent('[data-testid="pq-summary-profit"]'),
            /\+250\.000\s*₫/,
          );
          assert.match(
            await page.textContent('[data-testid="pq-summary-total"]'),
            /2\.750\.000\s*₫/,
          );

          // --- SCENARIO F: Giá vốn 0, Tiền lời 0, % lợi nhuận, Trọn lô, Nhiều sản phẩm, & Không tự sửa báo giá đã lưu ---
          await costInput.fill('0');
          await profitInput.fill('0');
          assert.match(
            await page.textContent('[data-testid="pq-summary-vendor-cost"]'),
            /^0\s*₫$/,
          );
          assert.match(
            await page.textContent('[data-testid="pq-summary-profit"]'),
            /^\+0\s*₫$/,
          );
          assert.match(
            await page.textContent('[data-testid="pq-summary-total"]'),
            /^0\s*₫$/,
          );

          // Chế độ trọn lô + % lợi nhuận thập phân ("12,5")
          await page.selectOption(
            'select[aria-label="Kiểu giá vốn dòng 1"]',
            'TOTAL_BATCH',
          );
          await costInput.fill('2000000');
          await page.selectOption(
            'select[aria-label="Kiểu lợi nhuận dòng 1"]',
            'PERCENTAGE',
          );
          assert.equal(await profitInput.getAttribute('inputmode'), 'decimal');
          await profitInput.fill('12,5');
          await profitInput.evaluate((el) => el.blur());
          assert.equal(await profitInput.inputValue(), '12.5');
          assert.match(
            await page.textContent('[data-testid="pq-summary-profit"]'),
            /\+250\.000\s*₫/,
          );

          // Thêm sản phẩm thứ 2
          await page.click('[data-testid="pq-add-line-btn"]');
          await page.waitForSelector('[data-testid="pq-line-card-1"]');
          await page.fill('input[aria-label="Số lượng dòng 2"]', '200');
          await page.fill('input[aria-label="Giá trị giá vốn dòng 2"]', '1000');
          await page.fill(
            'input[aria-label="Giá trị lợi nhuận dòng 2"]',
            '250',
          );
          // Line 1 = 2.250.000, Line 2 = 200 * 1250 = 250.000 -> Total = 2.500.000 ₫
          assert.match(
            await page.textContent('[data-testid="pq-summary-total"]'),
            /2\.500\.000\s*₫/,
          );

          // Quay lại Danh sách (/print-quotes): kiểm tra nháp chỉ nằm trong RAM (0 localStorage/sessionStorage) và cảnh báo khi mở sửa báo giá khác
          await page.click('[data-testid="pq-editor-back-btn"]');
          await page.waitForSelector('[data-testid="panel-quotes-list"]');
          await page.waitForSelector('[data-testid="pq-ram-draft-banner"]');

          const storageDump = await page.evaluate(() => ({
            localKeys: Object.keys(window.localStorage),
            sessionKeys: Object.keys(window.sessionStorage),
          }));
          assert.equal(
            storageDump.localKeys.some((k) => /quote|vendor|cost|pq/i.test(k)),
            false,
            `[${target.label}] Tuyệt đối không ghi nháp giá vốn/báo giá xuống localStorage`,
          );
          assert.equal(
            storageDump.sessionKeys.some((k) =>
              /quote|vendor|cost|pq/i.test(k),
            ),
            false,
            `[${target.label}] Tuyệt đối không ghi nháp giá vốn/báo giá xuống sessionStorage`,
          );

          // Kiểm tra tải báo giá đã lưu (TOTAL_BATCH 3 tờ = 10.000đ vốn + 5.000đ lời + 25.000đ ship = 40.000đ) -> giữ nguyên 100%
          await page.waitForSelector('[data-testid="quote-row-BG-202611-088"]');
          await page.click('[data-testid="pq-quote-edit-BG-202611-088"]');
          await page.waitForSelector('[data-testid="pq-replace-draft-dialog"]');
          await page.click('[data-testid="pq-replace-confirm-btn"]');
          await page.waitForSelector('[data-testid="panel-create-quote"]');
          assert.equal(await qtyInput.inputValue(), '3');
          assert.match(
            await page.textContent('[data-testid="pq-summary-vendor-cost"]'),
            /10\.000\s*₫/,
          );
          assert.match(
            await page.textContent('[data-testid="pq-summary-profit"]'),
            /\+5\.000\s*₫/,
          );
          assert.match(
            await page.textContent('[data-testid="pq-summary-total"]'),
            /40\.000\s*₫/,
          );

          // --- SCENARIO G (TASK 1): Báo giá TRỌN LÔ 30.000đ / 100 tờ -> mở lại -> đổi SL thành 200 tờ -> giữ nguyên Trọn lô & 30.000đ (KHÔNG thành 60.000đ) ---
          await page.click('[data-testid="pq-editor-back-btn"]');
          await page.waitForSelector('[data-testid="panel-quote-detail"]');
          await page.click('[data-testid="pq-detail-back-btn"]');
          await page.waitForSelector('[data-testid="quote-row-BG-202611-089"]');
          await page.click('[data-testid="pq-quote-edit-BG-202611-089"]');
          await page.waitForSelector('[data-testid="panel-create-quote"]');

          const costModeSelect = page.locator(
            'select[aria-label="Kiểu giá vốn dòng 1"]',
          );
          assert.equal(
            await costModeSelect.inputValue(),
            'TOTAL_BATCH',
            `[${target.label}] Mở lại báo giá Trọn lô 30.000đ / 100 tờ phải giữ đúng chế độ TOTAL_BATCH`,
          );
          assert.equal(await costInput.inputValue(), '30000');

          // Đổi số lượng từ 100 -> 200 tờ
          await qtyInput.fill('200');
          assert.equal(
            await costModeSelect.inputValue(),
            'TOTAL_BATCH',
            `[${target.label}] Đổi số lượng lên 200 tờ không được tự nhảy sang Theo từng tờ (PER_UNIT)`,
          );
          assert.match(
            await page.textContent('[data-testid="pq-summary-vendor-cost"]'),
            /^30\.000\s*₫$/,
            `[${target.label}] Giá vốn trọn lô phải giữ nguyên 30.000 ₫ (tuyệt đối không tăng lên 60.000 ₫)`,
          );
          assert.match(
            await page.textContent('[data-testid="pq-summary-total"]'),
            /^40\.000\s*₫$/,
          );

          // Lưu phiên bản mới -> kiểm tra payload gửi lên API mang đúng vendorCostMode = TOTAL_BATCH, totalVendorCost = 30000 VÀ UX V2 tự chuyển sang Chi tiết báo giá (/print-quotes/:id)
          const saveBtn = page.locator('[data-testid="pq-save-quote-btn"]');
          server.resetCounters();
          await saveBtn.click();
          await page.waitForSelector('[data-testid="panel-quote-detail"]');
          assert.ok(
            page.url().endsWith('/print-quotes/saved-quote-batch-30k-100'),
            `[${target.label}] Sau khi lưu báo giá phải tự mở trang Chi tiết báo giá (/print-quotes/:id)`,
          );
          assert.equal(server.getCounters().postQuotesCount, 1);
          assert.equal(
            server.getCounters().lastSavedPayload?.items?.[0]?.vendorCostMode,
            'TOTAL_BATCH',
          );
          assert.equal(
            server.getCounters().lastSavedPayload?.items?.[0]?.totalVendorCost,
            30000,
          );

          // --- SCENARIO H (TASK 1): Báo giá CŨ (legacy) thiếu vendorCostMode (30.000đ / 100 tờ) -> đổi SL 200 tờ -> KHÔNG SUY ĐOÁN cho tới khi xác nhận ---
          await page.click('[data-testid="pq-detail-back-btn"]');
          await page.waitForSelector('[data-testid="quote-row-BG-202611-090"]');
          await page.click('[data-testid="pq-quote-edit-BG-202611-090"]');
          await page.waitForSelector('[data-testid="panel-create-quote"]');

          assert.equal(
            await costModeSelect.inputValue(),
            '',
            `[${target.label}] Báo giá cũ mơ hồ không được tự gán sẵn PER_UNIT trên dropdown`,
          );
          // Đổi số lượng từ 100 -> 200 tờ trước khi xác nhận kiểu giá vốn
          await qtyInput.fill('200');
          assert.equal(
            await saveBtn.isDisabled(),
            true,
            `[${target.label}] Khi đổi SL trên báo giá cũ chưa rõ kiểu giá vốn, phải khóa Lưu thay vì suy đoán`,
          );
          assert.equal(
            await page.locator('[data-testid="pq-live-breakdown"]').count(),
            0,
            `[${target.label}] Không được hiển thị bảng tổng tiền suy đoán (60.000đ hay 30.000đ) khi chưa xác nhận`,
          );

          // Bấm xác nhận 1 chạm "Giữ trọn lô: 30.000 ₫" -> tính đúng 30.000 ₫ và mở khóa Lưu
          await page.click('[data-testid="pq-confirm-legacy-batch-0"]');
          assert.equal(await costModeSelect.inputValue(), 'TOTAL_BATCH');
          assert.match(
            await page.textContent('[data-testid="pq-summary-vendor-cost"]'),
            /^30\.000\s*₫$/,
          );
          assert.equal(await saveBtn.isDisabled(), false);

          // Kiểm tra xoay ngang màn hình (Landscape 844x390) & iPhone SE 320x568 không tràn ngang
          await page.setViewportSize({ width: 844, height: 390 });
          await page.waitForTimeout(100);
          assert.equal(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth >
                document.documentElement.clientWidth,
            ),
            false,
            `[${target.label}] Xoay ngang 844x390 không được tràn ngang`,
          );

          await page.setViewportSize({ width: 320, height: 568 });
          await page.waitForTimeout(100);
          assert.equal(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth >
                document.documentElement.clientWidth,
            ),
            false,
            `[${target.label}] iPhone SE 320x568 không được tràn ngang`,
          );

          await context.close();
        } finally {
          await browser.close();
        }
      }
    } finally {
      await server.close();
    }
  });

  it('3. Real Browser RAM Draft Guard: nhập nháp -> sang danh mục -> Back/Forward giữ dữ liệu; lỗi lưu giữ nháp; beforeunload; rời phân hệ ở lại / xóa & fail-closed khi không có interceptor', async () => {
    const server = await startInMemoryPrintQuoteWebServer();

    const browserTargets = [
      {
        label: 'Chrome Mobile iPhone',
        launch: () =>
          chromium.launch({
            channel: 'chrome',
            headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage'],
          }),
      },
    ];

    if (fs.existsSync(webkit.executablePath())) {
      browserTargets.push({
        label: 'Playwright WebKit iPhone (Safari Engine)',
        launch: () => webkit.launch({ headless: true }),
      });
    }

    try {
      for (const target of browserTargets) {
        const browser = await target.launch();
        try {
          const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
            userAgent:
              'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
          });
          const page = await context.newPage();
          server.resetCounters();

          // Khởi đầu từ "/" rồi vào "/print-quotes" qua thanh điều hướng SPA
          await page.goto(`${server.webUrl}/`, { waitUntil: 'networkidle' });
          await page.click('nav.mobile-bottom-nav button:has-text("Báo giá")');
          await page.waitForSelector('[data-testid="panel-quotes-list"]', {
            timeout: 15000,
          });

          // 1) Kiểm tra beforeunload khi chưa có nháp bẩn -> không chặn
          const cleanBeforeUnload = await page.evaluate(() => {
            const ev = new Event('beforeunload', { cancelable: true });
            window.dispatchEvent(ev);
            return ev.defaultPrevented;
          });
          assert.equal(
            cleanBeforeUnload,
            false,
            `[${target.label}] Khi chưa nhập nháp, beforeunload không được chặn tải lại trang`,
          );

          // Mở tạo báo giá mới và nhập dữ liệu nháp
          await page.click('[data-testid="pq-new-quote-cta"]');
          await page.waitForSelector('[data-testid="panel-create-quote"]');

          const titleInput = page.locator('[data-testid="pq-title-input"]');
          const prodNameInput = page.locator(
            'input[aria-label="Tên sản phẩm dòng 1"]',
          );
          const qtyInput = page.locator('input[aria-label="Số lượng dòng 1"]');
          const costInput = page.locator(
            'input[aria-label="Giá trị giá vốn dòng 1"]',
          );
          const profitInput = page.locator(
            'input[aria-label="Giá trị lợi nhuận dòng 1"]',
          );
          const shipInput = page.locator('[data-testid="pq-shipping-input"]');

          await titleInput.fill('Báo giá Catalogue Tết 2027');
          await prodNameInput.fill('Catalogue A4 16 trang C200');
          await qtyInput.fill('250');
          await costInput.fill('10000');
          await profitInput.fill('2000');
          await shipInput.fill('40000');

          assert.match(
            await page.textContent('[data-testid="pq-summary-total"]'),
            /3\.040\.000\s*₫/,
          );

          // 2) Kiểm tra beforeunload khi đang có nháp bẩn -> PHẢI chặn (defaultPrevented = true)
          const dirtyBeforeUnload = await page.evaluate(() => {
            const ev = new Event('beforeunload', { cancelable: true });
            window.dispatchEvent(ev);
            return ev.defaultPrevented;
          });
          assert.equal(
            dirtyBeforeUnload,
            true,
            `[${target.label}] Khi có nháp bẩn chưa lưu, beforeunload phải kích hoạt preventDefault`,
          );

          // 3) Nhập nháp -> sang các trang Danh mục -> Back / Forward trình duyệt giữ nguyên 100% dữ liệu
          await page.click('[data-testid="pq-editor-back-btn"]');
          await page.waitForSelector('[data-testid="panel-quotes-list"]');
          await page.waitForSelector('[data-testid="pq-ram-draft-banner"]');

          await page.click('[data-testid="pq-nav-group-catalog"]');
          await page.waitForSelector('[data-testid="pq-open-price-dialog-btn"]');
          assert.ok(page.url().endsWith('/print-quotes/catalog/prices'));
          await page.waitForSelector('[data-testid="pq-ram-draft-banner"]');

          await page.click('[data-testid="pq-catalog-tab-customers"]');
          await page.waitForSelector('[data-testid="panel-customers"]');
          assert.ok(page.url().endsWith('/print-quotes/catalog/customers'));
          await page.waitForSelector('[data-testid="pq-ram-draft-banner"]');

          await page.click('[data-testid="pq-catalog-tab-vendors"]');
          await page.waitForSelector(
            '[data-testid="pq-open-vendor-dialog-btn"]',
          );
          assert.ok(page.url().endsWith('/print-quotes/catalog/vendors'));
          await page.waitForSelector('[data-testid="pq-ram-draft-banner"]');

          // Nhấn Back trình duyệt 4 bước quay về /print-quotes/new -> toàn bộ dữ liệu nháp còn nguyên
          await page.goBack();
          await page.waitForSelector('[data-testid="panel-customers"]');
          await page.goBack();
          await page.waitForSelector('[data-testid="pq-open-price-dialog-btn"]');
          await page.goBack();
          await page.waitForSelector('[data-testid="panel-quotes-list"]');
          await page.goBack();
          await page.waitForSelector('[data-testid="panel-create-quote"]');
          assert.ok(page.url().endsWith('/print-quotes/new'));

          assert.equal(
            await titleInput.inputValue(),
            'Báo giá Catalogue Tết 2027',
            `[${target.label}] Back từ Danh mục về /print-quotes/new phải giữ nguyên Tên báo giá`,
          );
          assert.equal(
            await prodNameInput.inputValue(),
            'Catalogue A4 16 trang C200',
          );
          assert.equal(await qtyInput.inputValue(), '250');
          assert.equal(await costInput.inputValue(), '10000');
          assert.equal(await profitInput.inputValue(), '2000');
          assert.equal(await shipInput.inputValue(), '40000');
          assert.match(
            await page.textContent('[data-testid="pq-summary-total"]'),
            /3\.040\.000\s*₫/,
          );

          // Nhấn Forward trình duyệt sang lại Danh mục rồi bấm Tiếp tục nhập -> vẫn giữ nguyên 100%
          await page.goForward();
          await page.waitForSelector('[data-testid="panel-quotes-list"]');
          await page.goForward();
          await page.waitForSelector('[data-testid="pq-open-price-dialog-btn"]');
          assert.ok(page.url().endsWith('/print-quotes/catalog/prices'));
          await page.click('[data-testid="pq-resume-draft-btn"]');
          await page.waitForSelector('[data-testid="panel-create-quote"]');
          assert.equal(
            await titleInput.inputValue(),
            'Báo giá Catalogue Tết 2027',
          );
          assert.equal(await qtyInput.inputValue(), '250');
          assert.match(
            await page.textContent('[data-testid="pq-summary-total"]'),
            /3\.040\.000\s*₫/,
          );

          // 4) Lỗi lưu (HTTP 500) -> hiện thông báo lỗi, KHÔNG điều hướng mất trang, giữ nguyên toàn bộ nháp
          server.failNextQuoteSave(
            500,
            'Máy chủ bận tạm thời, vui lòng thử lại.',
          );
          await page.click('[data-testid="pq-save-quote-btn"]');
          await page.waitForSelector('[data-testid="printquote-banner"]');
          assert.match(
            await page.textContent('[data-testid="printquote-banner"]'),
            /Máy chủ bận tạm thời, vui lòng thử lại\./,
          );
          assert.ok(
            page.url().endsWith('/print-quotes/new'),
            `[${target.label}] Khi lưu lỗi phải giữ nguyên tại /print-quotes/new`,
          );
          assert.equal(
            await titleInput.inputValue(),
            'Báo giá Catalogue Tết 2027',
          );
          assert.equal(
            await prodNameInput.inputValue(),
            'Catalogue A4 16 trang C200',
          );
          assert.equal(await qtyInput.inputValue(), '250');
          assert.equal(await costInput.inputValue(), '10000');
          assert.equal(await profitInput.inputValue(), '2000');
          assert.equal(await shipInput.inputValue(), '40000');
          assert.match(
            await page.textContent('[data-testid="pq-summary-total"]'),
            /3\.040\.000\s*₫/,
          );

          // 5) Rời phân hệ khi có screen interceptor: chọn Ở lại giữ nháp -> sau đó chọn Rời trang & xóa nháp
          await page.click('[data-testid="pq-editor-back-btn"]');
          await page.waitForSelector('[data-testid="panel-quotes-list"]');

          await page.click('nav.mobile-bottom-nav button:has-text("Chấm công")');
          await page.waitForSelector('[data-testid="pq-leave-draft-dialog"]');
          assert.ok(
            page.url().endsWith('/print-quotes'),
            `[${target.label}] Chưa xác nhận rời phân hệ thì không được tự chuyển sang /clock`,
          );

          // Chọn "Ở lại tiếp tục nhập" -> đóng dialog, giữ nguyên nháp
          await page.click('[data-testid="pq-leave-stay-btn"]');
          assert.equal(
            await page.locator('[data-testid="pq-leave-draft-dialog"]').count(),
            0,
          );
          assert.ok(page.url().endsWith('/print-quotes'));
          assert.equal(
            await page.locator('[data-testid="pq-ram-draft-banner"]').count(),
            1,
          );

          // Chọn "Rời trang & xóa nháp" -> chuyển sang /clock và xóa sạch nháp trong RAM
          await page.click('nav.mobile-bottom-nav button:has-text("Chấm công")');
          await page.waitForSelector('[data-testid="pq-leave-draft-dialog"]');
          await page.click('[data-testid="pq-leave-discard-btn"]');
          await page.waitForFunction(() =>
            window.location.pathname.startsWith('/clock'),
          );
          assert.equal(
            await page.evaluate(() => {
              const ev = new Event('beforeunload', { cancelable: true });
              window.dispatchEvent(ev);
              return ev.defaultPrevented;
            }),
            false,
            `[${target.label}] Sau khi xác nhận xóa nháp rời trang, beforeunload phải được gỡ bỏ`,
          );

          // Quay lại Báo giá qua SPA (không reload trang) -> chứng minh nháp RAM đã xóa sạch
          await page.click('nav.mobile-bottom-nav button:has-text("Báo giá")');
          await page.waitForSelector('[data-testid="panel-quotes-list"]');
          assert.equal(
            await page.locator('[data-testid="pq-ram-draft-banner"]').count(),
            0,
          );
          await page.click('[data-testid="pq-new-quote-cta"]');
          await page.waitForSelector('[data-testid="panel-create-quote"]');
          assert.equal(await titleInput.inputValue(), '');
          assert.equal(await qtyInput.inputValue(), '');

          // 6) Trạng thái KHÔNG CÓ screen leaveInterceptor (PrintQuoteScreen đã unmount trên đường dẫn con 404):
          // Fail-closed: tuyệt đối không tự xóa nháp hay rời trang âm thầm; hiển thị hộp thoại xác nhận gốc của App
          await titleInput.fill('Báo giá Hộp Cứng Fail-Closed');
          await prodNameInput.fill('Hộp nam châm cao cấp');
          await qtyInput.fill('120');
          await costInput.fill('15000');
          await profitInput.fill('5000');
          await shipInput.fill('0');
          assert.match(
            await page.textContent('[data-testid="pq-summary-total"]'),
            /2\.400\.000\s*₫/,
          );

          // Đẩy sang đường dẫn con không khớp route trong /print-quotes/* -> NotFoundScreen mount & PrintQuoteScreen unmount (registerPrintQuoteLeaveInterceptor(null))
          await page.evaluate(() => {
            window.history.pushState(
              null,
              '',
              '/print-quotes/unmatched/sub/route',
            );
            window.dispatchEvent(new PopStateEvent('popstate'));
          });
          await page.waitForSelector(
            'h1:has-text("404 — Không tìm thấy trang")',
          );
          assert.equal(
            await page.locator('[data-testid="printquote-screen"]').count(),
            0,
            `[${target.label}] PrintQuoteScreen phải đã unmount để kiểm tra đúng trạng thái không có screen leaveInterceptor`,
          );
          // Ngay cả khi PrintQuoteScreen đã unmount, beforeunload cấp cầu nối RAM vẫn phải bảo vệ nháp
          assert.equal(
            await page.evaluate(() => {
              const ev = new Event('beforeunload', { cancelable: true });
              window.dispatchEvent(ev);
              return ev.defaultPrevented;
            }),
            true,
          );

          // Bấm nút rời về "/" khi không có screen interceptor -> phải hiện dialog xác nhận dự phòng (role="dialog", data-fallback-guard="true"), KHÔNG tự xóa nháp
          await page.click('button:has-text("Quay lại Trang tổng quan")');
          await page.waitForSelector(
            '[data-testid="pq-leave-draft-dialog"][data-fallback-guard="true"]',
          );
          assert.equal(
            await page
              .locator('[data-testid="pq-leave-draft-dialog"]')
              .getAttribute('role'),
            'dialog',
          );
          assert.equal(
            await page
              .locator('[data-testid="pq-leave-draft-dialog"]')
              .getAttribute('aria-modal'),
            'true',
          );
          assert.ok(
            page.url().endsWith('/print-quotes/unmatched/sub/route'),
            `[${target.label}] Khi chưa xác nhận trên fallback dialog, không được tự ý điều hướng sang "/"`,
          );

          // Chọn "Ở lại giữ bản nháp" -> đóng dialog, không mất nháp
          await page.click('[data-testid="pq-leave-stay-btn"]');
          assert.equal(
            await page.locator('[data-testid="pq-leave-draft-dialog"]').count(),
            0,
          );
          assert.ok(page.url().endsWith('/print-quotes/unmatched/sub/route'));

          // Bấm rời lần 2 -> chọn "Mở lại bản nháp" -> quay thẳng về /print-quotes/new với nguyên vẹn 100% dữ liệu nháp
          await page.click('button:has-text("Quay lại Trang tổng quan")');
          await page.waitForSelector(
            '[data-testid="pq-leave-draft-dialog"][data-fallback-guard="true"]',
          );
          await page.click('[data-testid="pq-leave-return-editor-btn"]');
          await page.waitForSelector('[data-testid="panel-create-quote"]');
          assert.ok(page.url().endsWith('/print-quotes/new'));
          assert.equal(
            await titleInput.inputValue(),
            'Báo giá Hộp Cứng Fail-Closed',
          );
          assert.equal(await prodNameInput.inputValue(), 'Hộp nam châm cao cấp');
          assert.equal(await qtyInput.inputValue(), '120');
          assert.match(
            await page.textContent('[data-testid="pq-summary-total"]'),
            /2\.400\.000\s*₫/,
          );

          // Quay lại trạng thái không có interceptor rồi xác nhận "Rời trang & xóa nháp" -> điều hướng về "/" và xóa sạch nháp RAM
          await page.evaluate(() => {
            window.history.pushState(
              null,
              '',
              '/print-quotes/unmatched/sub/route',
            );
            window.dispatchEvent(new PopStateEvent('popstate'));
          });
          await page.waitForSelector(
            'h1:has-text("404 — Không tìm thấy trang")',
          );
          await page.click('button:has-text("Quay lại Trang tổng quan")');
          await page.waitForSelector(
            '[data-testid="pq-leave-draft-dialog"][data-fallback-guard="true"]',
          );
          await page.click('[data-testid="pq-leave-discard-btn"]');
          await page.waitForFunction(() => window.location.pathname === '/');
          assert.equal(
            await page.evaluate(() => {
              const ev = new Event('beforeunload', { cancelable: true });
              window.dispatchEvent(ev);
              return ev.defaultPrevented;
            }),
            false,
          );

          // Mở lại Báo giá -> Tạo báo giá mới qua SPA -> form sạch rỗng hoàn toàn
          await page.click('nav.mobile-bottom-nav button:has-text("Báo giá")');
          await page.waitForSelector('[data-testid="panel-quotes-list"]');
          assert.equal(
            await page.locator('[data-testid="pq-ram-draft-banner"]').count(),
            0,
          );
          await page.click('[data-testid="pq-new-quote-cta"]');
          await page.waitForSelector('[data-testid="panel-create-quote"]');
          assert.equal(await titleInput.inputValue(), '');
          assert.equal(await qtyInput.inputValue(), '');

          await context.close();
        } finally {
          await browser.close();
        }
      }
    } finally {
      await server.close();
    }
  });
});
