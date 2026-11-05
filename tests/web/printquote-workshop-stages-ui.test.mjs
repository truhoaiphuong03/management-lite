/**
 * Web SSR + Real-Browser Playwright Acceptance & Responsive Audit for:
 * PRINTQUOTE: GIÁ XƯỞNG + CÔNG ĐOẠN GIA CÔNG + TÍNH M² + NHÁP CHỜ GIÁ XƯỞNG
 */
import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright-core';

import {
  AreaInputMode,
  buildCustomerSafePdfPayload,
  calculatePrintQuote,
  evaluatePendingCostDraftLines,
  LineCostSource,
  PriceItemType,
  ProfitMode,
  ProfitScope,
  QuotePricingStatus,
  RoundingMode,
  ShippingAllocationStrategy,
  VendorCostMode,
} from '../../dist/packages/contracts/src/printquote.js';
import { PrintQuoteScreen } from '../../dist/apps/web/src/screens/PrintQuoteScreen.js';
import { CreateQuoteTab } from '../../dist/apps/web/src/screens/printquote/CreateQuoteTab.js';
import { QuotesListTab } from '../../dist/apps/web/src/screens/printquote/QuotesListTab.js';
import { QuoteDetailView } from '../../dist/apps/web/src/screens/printquote/QuoteDetailView.js';
import { buildPrintQuoteA4Html } from '../../dist/apps/web/src/screens/helpers/printquote-helpers.js';
import {
  loadTestDatabaseConfig,
  assertSafeTestDatabase,
} from '../../dist/packages/database/src/config.js';
import { createDatabasePool } from '../../dist/packages/database/src/pool.js';
import {
  runMigrations,
  loadMigrationFiles,
} from '../../dist/packages/database/src/migrator.js';
import { createRequestHandler } from '../../dist/apps/api/src/app.js';
import { hashPassword } from '../../dist/packages/security/src/password.js';

function assertSafeTarget(env = process.env) {
  const dbConfig = loadTestDatabaseConfig(env);
  assertSafeTestDatabase(dbConfig, env);
  const e2eConfirm = (env['CONFIRM_PRINTQUOTE_E2E_RESET'] || '')
    .trim()
    .toLowerCase();
  if (e2eConfirm !== 'true' && e2eConfirm !== '1') {
    throw new Error(
      'Set CONFIRM_PRINTQUOTE_E2E_RESET=true in addition to TEST_DATABASE_URL and CONFIRM_ISOLATED_TEST_DB=true.',
    );
  }
  return dbConfig;
}

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

async function startEphemeralStagingServers(pool) {
  const distDir = path.resolve(process.cwd(), 'apps/web/dist');
  const indexHtmlPath = path.join(distDir, 'index.html');
  if (!fs.existsSync(indexHtmlPath)) {
    throw new Error(
      `Missing built web assets at ${indexHtmlPath}. Run "npm run build:web" before E2E.`,
    );
  }

  let webOrigin = 'http://127.0.0.1';
  const csrfSecret = 'isolated-pq-workshop-stages-e2e-csrf-32chars!';
  const apiHandlerWithOrigin = createRequestHandler({
    pool,
    isProduction: false,
    csrfSecret,
    allowedOrigins: ['http://127.0.0.1:3000'],
  });

  const apiServer = http.createServer((req, res) => {
    if (req.headers.origin === webOrigin) {
      req.headers.origin = 'http://127.0.0.1:3000';
    }
    apiHandlerWithOrigin(req, res);
  });

  await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve));
  const apiPort = apiServer.address().port;

  const webServer = http.createServer((req, res) => {
    const reqUrl = req.url || '/';
    if (reqUrl.startsWith('/api/')) {
      const proxyReq = http.request(
        {
          hostname: '127.0.0.1',
          port: apiPort,
          path: reqUrl,
          method: req.method,
          headers: {
            ...req.headers,
            host: `127.0.0.1:${apiPort}`,
          },
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );
      proxyReq.on('error', (err) => {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Bad Gateway: ${err.message}`);
      });
      req.pipe(proxyReq);
      return;
    }

    const cleanPath = reqUrl.split('?')[0].split('#')[0];
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

  await new Promise((resolve) => webServer.listen(0, '127.0.0.1', resolve));
  const webPort = webServer.address().port;
  webOrigin = `http://127.0.0.1:${webPort}`;

  return {
    webUrl: webOrigin,
    close: async () => {
      webServer.closeAllConnections?.();
      apiServer.closeAllConnections?.();
      await new Promise((resolve) => webServer.close(resolve));
      await new Promise((resolve) => apiServer.close(resolve));
    },
  };
}

async function seedIsolatedOwnerOnly(
  pool,
  testOwnerUsername,
  testOwnerPassword,
) {
  const passwordHash = await hashPassword(testOwnerPassword);
  const workspaceId = crypto.randomUUID();
  const ownerUserId = crypto.randomUUID();

  await pool.query(
    `INSERT INTO workspaces (id, name, timezone, status)
     VALUES ($1, 'Hoài Phương Media', 'Asia/Ho_Chi_Minh', 'active')`,
    [workspaceId],
  );
  await pool.query(
    `INSERT INTO users (id, username_normalized, email_normalized, status)
     VALUES ($1, $2, $3, 'active')`,
    [
      ownerUserId,
      testOwnerUsername,
      `${testOwnerUsername}@pq-stages-test.local`,
    ],
  );
  await pool.query(
    `INSERT INTO user_credentials (user_id, password_hash, credential_version)
     VALUES ($1, $2, 1)`,
    [ownerUserId, passwordHash],
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
  await pool.query(
    `INSERT INTO employees (id, workspace_id, user_id, employee_code, full_name, phone, employment_status)
     VALUES ($1, $2, $3, 'OWN01', 'Chủ sở hữu (Test)', '0909123456', 'active')`,
    [crypto.randomUUID(), workspaceId, ownerUserId],
  );
}

describe('PrintQuote Giá Xưởng + Công Đoạn Gia Công + m² + Chờ Giá — Web SSR & PDF Contracts', () => {
  it('1. Bảng giá xưởng (/catalog/prices): phân tách Giá in cơ bản / Công đoạn gia công / Đã ngừng dùng, không có inline form, không tự nạp giá mẫu', () => {
    const emptyHtml = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        isOwnerVerified: true,
        workspaceName: 'Hoài Phương Media',
        currentPath: '/print-quotes/catalog/prices',
        onNavigate: () => {},
        initialPriceItems: [],
      }),
    );

    assert.match(emptyHtml, /Bảng giá xưởng/);
    assert.match(emptyHtml, /Giá in cơ bản/);
    assert.match(emptyHtml, /Công đoạn gia công/);
    assert.match(emptyHtml, /Đã ngừng dùng/);
    assert.match(emptyHtml, /Hệ thống không tự thêm giá mẫu/);
    assert.equal(emptyHtml.includes('<form'), false);

    const populatedHtml = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        isOwnerVerified: true,
        workspaceName: 'Hoài Phương Media',
        currentPath: '/print-quotes/catalog/prices',
        onNavigate: () => {},
        initialPriceItems: [
          {
            id: 'p-base-1',
            workspace_id: 'ws-1',
            vendor_id: null,
            vendor_name: null,
            code: 'BGX001',
            name: 'A4 C200, in màu 2 mặt',
            item_type: PriceItemType.BASE_PRINT,
            category: 'Giấy',
            specification: 'A4 · Couche C200 · In màu 2 mặt',
            included_stages: ['Cắt thành phẩm'],
            structured_spec: null,
            conditions_note: 'Áp dụng từ 100 tờ',
            unit: 'tờ',
            pricing_mode: VendorCostMode.PER_UNIT,
            unit_cost: 4000,
            batch_quantity: 1,
            batch_total_cost: 4000,
            default_profit_mode: ProfitMode.FIXED_AMOUNT,
            default_profit_scope: ProfitScope.PER_UNIT,
            default_profit_value: 1000,
            note: null,
            is_active: true,
            version: 2,
            is_used_in_quotes: true,
            created_at: '2026-11-04T00:00:00.000Z',
            updated_at: '2026-11-04T00:00:00.000Z',
          },
          {
            id: 'p-fin-1',
            workspace_id: 'ws-1',
            vendor_id: null,
            vendor_name: null,
            code: 'GC001',
            name: 'Cán màng 1 mặt',
            item_type: PriceItemType.FINISHING,
            category: 'Gia công',
            specification: 'Màng mờ 1 mặt',
            included_stages: [],
            structured_spec: null,
            conditions_note: null,
            unit: 'tờ',
            pricing_mode: VendorCostMode.PER_UNIT,
            unit_cost: 2000,
            batch_quantity: 1,
            batch_total_cost: 2000,
            default_profit_mode: ProfitMode.FIXED_AMOUNT,
            default_profit_scope: ProfitScope.PER_UNIT,
            default_profit_value: 0,
            note: null,
            is_active: true,
            version: 1,
            is_used_in_quotes: false,
            created_at: '2026-11-04T00:00:00.000Z',
            updated_at: '2026-11-04T00:00:00.000Z',
          },
        ],
      }),
    );

    assert.match(populatedHtml, /A4 C200, in màu 2 mặt/);
    assert.match(populatedHtml, /Cán màng 1 mặt/);
    assert.match(populatedHtml, /Xưởng chung/);
    assert.match(populatedHtml, /Cắt thành phẩm/);
    assert.match(populatedHtml, /Áp dụng từ 100 tờ/);
  });

  it('2. CreateQuoteTab & PDF A4: hiển thị chip tóm tắt "A4 C200 · In màu 2 mặt · Cán màng 1 mặt", cảnh báo cộng trùng, tính m² chính xác 2,88 m² trên PDF mà không lộ giá vốn/gia công', () => {
    const calcStages = calculatePrintQuote({
      quoteId: 'BG-STG-100',
      customerName: 'Chị Lan',
      shippingFee: 40000,
      includeShippingInUnitPrice: true,
      shippingAllocationStrategy:
        ShippingAllocationStrategy.PROPORTIONAL_BY_BASE_AMOUNT,
      roundingPolicy: { mode: RoundingMode.NEAREST, step: 1 },
      items: [
        {
          id: 'L-1',
          name: 'Tờ rơi A4',
          specification: 'A4 C200, In màu 2 mặt',
          unit: 'tờ',
          quantity: 100,
          vendorCostMode: VendorCostMode.PER_UNIT,
          baseCostRate: 4000,
          baseIncludedStages: ['Cán màng 1 mặt'],
          finishingStages: [
            {
              id: 'S-1',
              priceItemId: 'p-fin-1',
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
    });
    const pdfStages = buildCustomerSafePdfPayload(calcStages, {
      quoteCode: 'BG-STG-100',
    });

    const editorHtml = renderToStaticMarkup(
      React.createElement(CreateQuoteTab, {
        editingQuoteId: null,
        editingQuoteCode: null,
        editingQuoteVersion: 1,
        onBackToQuotes: () => {},
        quoteTitle: 'Báo giá tờ rơi A4 cán màng',
        onChangeQuoteTitle: () => {},
        selectedCustomerId: '',
        onChangeSelectedCustomerId: () => {},
        customers: [],
        priceItems: [],
        validUntil: '',
        onChangeValidUntil: () => {},
        shippingFee: 40000,
        shippingFeeInput: '40000',
        onChangeShippingFee: () => {},
        includeShippingInUnitPrice: true,
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
        draftLines: [
          {
            id: 'L-1',
            name: 'Tờ rơi A4',
            specification: 'A4 C200, In màu 2 mặt',
            vendorPriceItemId: 'p-base-1',
            baseCostSource: LineCostSource.CATALOG_OVERRIDDEN,
            baseCatalogOriginalRate: 3800,
            baseIncludedStages: ['Cán màng 1 mặt'],
            unit: 'tờ',
            quantity: 100,
            quantityInput: '100',
            vendorCostMode: VendorCostMode.PER_UNIT,
            vendorCostValue: 4000,
            vendorCostInput: '4000',
            finishingStages: [
              {
                id: 'S-1',
                priceItemId: 'p-fin-1',
                code: 'GC001',
                name: 'Cán màng 1 mặt',
                pricingMode: VendorCostMode.PER_UNIT,
                rateValue: 2000,
                rateInput: '2000',
                unit: 'tờ',
                costSource: LineCostSource.CATALOG,
                catalogOriginalRate: 2000,
              },
            ],
            profitMode: ProfitMode.FIXED_AMOUNT,
            profitScope: ProfitScope.PER_UNIT,
            profitValue: 1000,
            profitInput: '1000',
            extraCost: 0,
            extraCostInput: '0',
          },
        ],
        setDraftLines: () => {},
        onSelectCatalogItem: () => {},
        livePricingResult: {
          calc: calcStages,
          customerPdf: pdfStages,
          error: null,
        },
        onResetNewQuote: () => {},
        onSaveQuote: () => {},
        onDownloadLivePdf: () => {},
        onOpenLivePreview: () => {},
        onQuickCreateCustomer: async () => null,
      }),
    );

    assert.match(editorHtml, /A4 C200 · In màu 2 mặt · Cán màng 1 mặt/);
    assert.match(editorHtml, /pq-stage-overlap-warning-0/);
    assert.match(editorHtml, /Cảnh báo cộng trùng/);
    assert.match(editorHtml, /740\.000\s*₫/);

    // Kiểm tra dòng m² (0,8m × 1,2m × 3 tấm = 2,88 m²) trên bản in A4 HTML
    const calcSqm = calculatePrintQuote({
      quoteId: 'BG-SQM-288',
      customerName: 'Anh Hải',
      shippingFee: 0,
      includeShippingInUnitPrice: true,
      items: [
        {
          id: 'SQM-1',
          name: 'In bạt Hiflex sự kiện',
          specification: 'Bạt dày 3.6zem, đóng khoen 4 góc',
          unit: 'm²',
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
            scope: ProfitScope.TOTAL_BATCH,
            value: 56000,
          },
        },
      ],
    });
    const pdfSqm = buildCustomerSafePdfPayload(calcSqm, {
      quoteCode: 'BG-SQM-288',
    });
    const a4Html = buildPrintQuoteA4Html(pdfSqm, {
      workspaceName: 'Hoài Phương Media',
      quoteCode: 'BG-SQM-288',
      quoteTitle: 'Báo giá in bạt Hiflex',
      customerName: 'Anh Hải',
      customerPhone: '0909888777',
      customerAddress: 'TP.HCM',
    });

    assert.match(a4Html, /2,88/);
    assert.match(a4Html, /200\.000\s*₫/);
    assert.equal(a4Html.includes('144.000'), false);
    assert.equal(a4Html.includes('56.000'), false);
    assert.equal(a4Html.includes('Giá vốn'), false);
  });

  it('3. Trạng thái Nháp "Chờ giá xưởng" (PENDING_COST): hiển thị rõ hạng mục thiếu giá, không sinh tổng tiền giả và khóa nút PDF / Chốt / Lên đơn', () => {
    const pendingEval = evaluatePendingCostDraftLines([
      {
        id: 'P-1',
        name: 'Hộp giấy mỹ thuật ép kim',
        quantity: 200,
        vendorCostMode: VendorCostMode.PER_UNIT,
        baseCostRate: 8000,
        finishingStages: [
          {
            id: 'ST-1',
            name: 'Ép kim logo nhũ vàng',
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
    ]);

    const pendingEditorHtml = renderToStaticMarkup(
      React.createElement(CreateQuoteTab, {
        editingQuoteId: null,
        editingQuoteCode: null,
        editingQuoteVersion: 1,
        onBackToQuotes: () => {},
        quoteTitle: 'Nháp hộp mỹ thuật chờ giá khuôn ép kim',
        onChangeQuoteTitle: () => {},
        selectedCustomerId: '',
        onChangeSelectedCustomerId: () => {},
        customers: [],
        priceItems: [],
        validUntil: '',
        onChangeValidUntil: () => {},
        shippingFee: 0,
        shippingFeeInput: '0',
        onChangeShippingFee: () => {},
        includeShippingInUnitPrice: true,
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
        draftLines: [
          {
            id: 'P-1',
            name: 'Hộp giấy mỹ thuật ép kim',
            specification: 'Giấy mỹ thuật 250gsm',
            vendorPriceItemId: '',
            unit: 'hộp',
            quantity: 200,
            quantityInput: '200',
            vendorCostMode: VendorCostMode.PER_UNIT,
            vendorCostValue: 8000,
            vendorCostInput: '8000',
            finishingStages: [
              {
                id: 'ST-1',
                priceItemId: null,
                code: null,
                name: 'Ép kim logo nhũ vàng',
                pricingMode: VendorCostMode.TOTAL_BATCH,
                rateValue: null,
                rateInput: '',
                unit: 'lô',
                costSource: LineCostSource.MANUAL,
              },
            ],
            profitMode: ProfitMode.FIXED_AMOUNT,
            profitScope: ProfitScope.PER_UNIT,
            profitValue: 2000,
            profitInput: '2000',
            extraCost: 0,
            extraCostInput: '0',
          },
        ],
        setDraftLines: () => {},
        onSelectCatalogItem: () => {},
        livePricingResult: {
          calc: null,
          customerPdf: null,
          error: 'Đang chờ giá xưởng cho công đoạn Ép kim logo nhũ vàng.',
          canSavePendingDraft: true,
          isPendingCost: true,
          pendingSummary: pendingEval.pendingSummary,
        },
        onResetNewQuote: () => {},
        onSaveQuote: () => {},
        onSavePendingDraftQuote: () => {},
        onDownloadLivePdf: () => {},
        onOpenLivePreview: () => {},
        onQuickCreateCustomer: async () => null,
      }),
    );

    assert.match(pendingEditorHtml, /pq-pending-cost-summary-card/);
    assert.match(pendingEditorHtml, /pq-save-pending-draft-btn/);
    assert.match(pendingEditorHtml, /Ép kim logo nhũ vàng/);
    assert.match(
      pendingEditorHtml,
      /data-testid="pq-save-quote-btn"\s+disabled=""/,
    );

    const pendingQuoteRecord = {
      id: 'q-pending-1',
      workspace_id: 'ws-1',
      quote_code: 'BG-202611-099',
      title: 'Nháp hộp mỹ thuật chờ giá khuôn ép kim',
      customer_id: null,
      customer_name: 'Công ty Mỹ Phẩm Aura',
      customer_phone: '0909111222',
      customer_address: null,
      status: 'DRAFT',
      pricing_status: QuotePricingStatus.PENDING_COST,
      pending_cost_summary: pendingEval.pendingSummary,
      current_version: 1,
      include_shipping_in_unit_price: true,
      shipping_allocation_strategy:
        ShippingAllocationStrategy.PROPORTIONAL_BY_BASE_AMOUNT,
      rounding_mode: RoundingMode.NEAREST,
      rounding_step: 1,
      total_quantity: 200,
      total_vendor_cost: 0,
      total_profit: 0,
      shipping_fee: 0,
      total_extra_cost: 0,
      total_quote_amount: 0,
      total_rounding_adjustment: 0,
      single_product_final_unit_price: null,
      lines_json: [
        {
          id: 'P-1',
          name: 'Hộp giấy mỹ thuật ép kim',
          specification: 'Giấy mỹ thuật 250gsm',
          unit: 'hộp',
          quantity: 200,
          vendorCostMode: VendorCostMode.PER_UNIT,
          baseCostRate: 8000,
          baseVendorCost: 1600000,
          finishingVendorCost: null,
          isPendingCost: true,
          finishingStages: [
            {
              id: 'ST-1',
              name: 'Ép kim logo nhũ vàng',
              pricingMode: VendorCostMode.TOTAL_BATCH,
              rate: null,
            },
          ],
          unitVendorCost: 0,
          totalVendorCost: 0,
          profitMode: ProfitMode.FIXED_AMOUNT,
          profitScope: ProfitScope.PER_UNIT,
          profitInputValue: 2000,
          unitProfit: 0,
          totalProfit: 0,
          allocatedShippingFee: 0,
          totalExtraCost: 0,
          rawFinalUnitPrice: 0,
          finalUnitPrice: 0,
          billedLineSubtotal: 0,
          roundingAdjustment: 0,
          reconciledLineTotal: 0,
        },
      ],
      snapshot_json: {},
      customer_pdf_json: null,
      integrity_hash: 'stub-hash',
      valid_until: null,
      notes: null,
      created_by: 'u-1',
      finalized_at: null,
      created_at: '2026-11-04T00:00:00.000Z',
      updated_at: '2026-11-04T00:00:00.000Z',
    };

    const listHtml = renderToStaticMarkup(
      React.createElement(QuotesListTab, {
        quotes: [pendingQuoteRecord],
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
    assert.match(listHtml, /pq-metric-total-val[^>]*>Chờ giá xưởng</);
    assert.match(listHtml, /Chưa tính/);
    assert.match(
      listHtml,
      /data-testid="pq-quote-download-pdf-BG-202611-099"\s+disabled=""/,
    );

    const detailHtml = renderToStaticMarkup(
      React.createElement(QuoteDetailView, {
        quote: pendingQuoteRecord,
        loading: false,
        workspaceName: 'Hoài Phương Media',
        customers: [],
        onBackToList: () => {},
        onDownloadSavedPdf: () => {},
        onOpenFullPreview: () => {},
        onPrintWindow: () => {},
        onEditQuote: () => {},
        onCloneQuoteAsNew: () => {},
        onFinalizeQuote: () => {},
        onConvertQuoteToOrder: () => {},
      }),
    );
    assert.match(detailHtml, /pq-detail-pending-cost-notice/);
    assert.match(
      detailHtml,
      /data-testid="pq-detail-download-pdf-btn"\s+disabled=""/,
    );
    assert.equal(detailHtml.includes('pq-detail-finalize-btn'), false);
    assert.match(
      detailHtml,
      /data-testid="pq-detail-convert-btn"\s+disabled=""/,
    );
  });
});

test('Real-Browser Playwright E2E + Desktop/iPhone Overflow Audit: Bảng giá xưởng -> Tạo báo giá đa công đoạn -> Sửa giá 1 lần -> Nháp Chờ giá xưởng & Responsive 1440/390/320px', async () => {
  const dbConfig = assertSafeTarget(process.env);

  const screenshotDir =
    process.env.PQ_SCREENSHOT_DIR ||
    path.resolve(process.cwd(), '.artifacts', 'pq-workshop-stages');
  fs.mkdirSync(screenshotDir, { recursive: true });

  const testOwnerUsername = `owner_stages_${crypto.randomUUID().slice(0, 8)}`;
  const testOwnerPassword = 'TestOwnerStages#2026!';
  const pool = createDatabasePool(dbConfig);
  let ephemeral = null;
  let browser = null;

  try {
    await runMigrations(
      pool,
      loadMigrationFiles('packages/database/src/migrations'),
    );
    await seedIsolatedOwnerOnly(pool, testOwnerUsername, testOwnerPassword);
    ephemeral = await startEphemeralStagingServers(pool);

    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    const context = await browser.newContext({
      viewport: { width: 1440, height: 920 },
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const assertNoHorizontalOverflow = async (label) => {
      const metrics = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        storageKeys:
          Object.keys(window.localStorage).filter((k) =>
            k.toLowerCase().includes('printquote'),
          ).length +
          Object.keys(window.sessionStorage).filter((k) =>
            k.toLowerCase().includes('printquote'),
          ).length,
      }));
      assert.ok(
        metrics.scrollWidth <= metrics.innerWidth + 1,
        `[${label}] Tràn ngang: scrollWidth=${metrics.scrollWidth} > innerWidth=${metrics.innerWidth}`,
      );
      assert.equal(
        metrics.storageKeys,
        0,
        `[${label}] Rò rỉ localStorage/sessionStorage cho PrintQuote`,
      );
    };

    // 1) Đăng nhập Owner
    await page.goto(`${ephemeral.webUrl}/login`, { waitUntil: 'networkidle' });
    await page.fill('#identifier', testOwnerUsername);
    await page.fill('#password', testOwnerPassword);
    await page.click('button[type="submit"]');
    await page.waitForSelector(
      'nav[aria-label="Desktop navigation"] button:has-text("Báo giá in ấn")',
      { timeout: 15000 },
    );

    // 2) Mở Bảng giá xưởng (/print-quotes/catalog/prices) — xác minh trống 100%, không tự nạp giá mẫu
    await page.goto(`${ephemeral.webUrl}/print-quotes/catalog/prices`, {
      waitUntil: 'networkidle',
    });
    await page.waitForSelector('[data-testid="panel-catalog-prices"]');
    const emptyText = await page.textContent(
      '[data-testid="panel-catalog-prices"]',
    );
    assert.match(emptyText, /Chưa có mục giá xưởng nào được lưu/);

    // 3) Tạo Giá in cơ bản: "A4 C200, in màu 2 mặt" — 4.000đ/tờ
    await page.click('[data-testid="pq-open-price-dialog-btn"]');
    await page.waitForSelector('[data-testid="pq-price-dialog"]');
    await page.fill('#pq-dialog-price-name', 'A4 C200, in màu 2 mặt');
    await page.fill('#pq-dialog-price-spec', 'A4 C200, In màu 2 mặt');
    await page.fill('#pq-dialog-price-unit', 'tờ');
    await page.fill('#pq-dialog-price-unit-cost', '4000');
    await page.fill('#pq-dialog-price-profit', '1000');
    await page.fill('#pq-dialog-conditions-note', 'Áp dụng từ 50 tờ trở lên');
    await page.click('[data-testid="pq-price-dialog"] button[type="submit"]');
    await page.waitForSelector('[data-testid="pq-price-dialog"]', {
      state: 'detached',
    });
    await page.waitForSelector('text=A4 C200, in màu 2 mặt');

    // 4) Tạo Công đoạn gia công: "Cán màng 1 mặt" — 2.000đ/tờ
    await page.click('[data-testid="pq-open-finishing-price-dialog-btn"]');
    await page.waitForSelector('[data-testid="pq-price-dialog"]');
    await page.fill('#pq-dialog-price-name', 'Cán màng 1 mặt');
    await page.fill('#pq-dialog-price-spec', 'Cán màng mờ 1 mặt');
    await page.fill('#pq-dialog-price-unit', 'tờ');
    await page.fill('#pq-dialog-price-unit-cost', '2000');
    await page.click('[data-testid="pq-price-dialog"] button[type="submit"]');
    await page.waitForSelector('[data-testid="pq-price-dialog"]', {
      state: 'detached',
    });
    await page.waitForSelector('text=Cán màng 1 mặt');

    await assertNoHorizontalOverflow('Desktop Catalog Prices');
    await page.screenshot({
      path: path.join(screenshotDir, 'workshop-catalog-desktop.png'),
      fullPage: true,
    });

    // 5) Mở Tạo báo giá mới (/print-quotes/new) -> Chọn Giá cơ bản + Thêm Công đoạn gia công
    await page.goto(`${ephemeral.webUrl}/print-quotes/new`, {
      waitUntil: 'networkidle',
    });
    await page.waitForSelector('#pq-line-catalog-0');
    await page.waitForSelector('#pq-line-catalog-0 option:nth-child(2)', {
      state: 'attached',
    });
    await page.waitForSelector(
      '[data-testid="pq-stage-catalog-select-0"] option:nth-child(2)',
      { state: 'attached' },
    );
    await page.fill(
      '#pq-title-input',
      'Báo giá tờ rơi A4 C200 cán màng (100 tờ)',
    );

    const baseOptVal = await page.$eval(
      '#pq-line-catalog-0 option:nth-child(2)',
      (el) => el.getAttribute('value'),
    );
    await page.selectOption('#pq-line-catalog-0', baseOptVal);

    // Chọn công đoạn gia công đã lưu "Cán màng 1 mặt"
    const finSelect = page.locator('[data-testid="pq-stage-catalog-select-0"]');
    const finOptVal = await finSelect
      .locator('option')
      .nth(1)
      .getAttribute('value');
    await finSelect.selectOption(finOptVal);

    await page.fill('#pq-line-qty-0', '100');
    await page.fill('[data-testid="pq-shipping-input"]', '40000');

    // Kiểm tra chip tóm tắt ngắn gọn & con số chính xác (vốn 600.000, lời 100.000, tổng khách 740.000)
    await page.waitForSelector('[data-testid="pq-line-summary-pill-0"]');
    const pillText = await page.textContent(
      '[data-testid="pq-line-summary-pill-0"]',
    );
    assert.equal(pillText.trim(), 'A4 C200 · In màu 2 mặt · Cán màng 1 mặt');

    const summaryPanelText = await page.textContent('#pq-sec-summary');
    assert.match(summaryPanelText, /740\.000\s*₫/);

    await assertNoHorizontalOverflow('Desktop Quote Builder Multi-Stage');
    await page.screenshot({
      path: path.join(screenshotDir, 'quote-builder-stages-desktop.png'),
      fullPage: true,
    });

    // Kiểm tra trên khung nhìn iPhone 14 (390×844) & màn nhỏ (320×568)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(120);
    await assertNoHorizontalOverflow(
      'iPhone 390x844 Quote Builder Multi-Stage',
    );
    await page.screenshot({
      path: path.join(screenshotDir, 'quote-builder-stages-iphone.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(100);
    await assertNoHorizontalOverflow(
      'Mobile 320x568 Quote Builder Multi-Stage',
    );

    await page.setViewportSize({ width: 1440, height: 920 });
    await page.waitForTimeout(100);

    // 6) Sửa giá 1 lần trên báo giá (4.500đ) -> KHÔNG tự sửa bảng giá gốc
    await page.fill('#pq-line-cost-val-0', '4500');
    await page.waitForSelector('[data-testid="pq-override-notice-0"]');
    const overrideNoticeText = await page.textContent(
      '[data-testid="pq-override-notice-0"]',
    );
    assert.match(overrideNoticeText, /Giá sửa riêng trên báo giá/);
    // Khôi phục về 4000đ, thu gọn dòng sản phẩm thành 1 dòng gọn
    await page.fill('#pq-line-cost-val-0', '4000');
    await page.click('[data-testid="pq-line-toggle-0"]');
    await page.waitForSelector('[data-testid="pq-line-collapsed-0"]');

    // Lưu báo giá hoàn chỉnh -> tự chuyển sang Chi tiết báo giá (/print-quotes/:id)
    await page.click('[data-testid="pq-save-quote-btn"]');
    await page.waitForSelector('[data-testid="panel-quote-detail"]', {
      timeout: 10000,
    });
    const detailCompleteText = await page.textContent(
      '[data-testid="panel-quote-detail"]',
    );
    assert.match(detailCompleteText, /740\.000\s*₫/);
    assert.match(detailCompleteText, /600\.000\s*₫/);

    // 7) Tạo báo giá Nháp "Chờ giá xưởng" (m² 0,8 × 1,2 × 3 = 2,88 m² + gia công để trống giá)
    await page.goto(`${ephemeral.webUrl}/print-quotes/new`, {
      waitUntil: 'networkidle',
    });
    await page.waitForSelector('#pq-line-name-0');
    await page.fill('#pq-title-input', 'Báo giá Decal sữa khổ lớn chờ giá bế');
    await page.fill('#pq-line-name-0', 'Decal sữa dán kính');
    await page.selectOption('#pq-line-cost-mode-0', VendorCostMode.PER_SQM);
    await page.waitForSelector('[data-testid="pq-area-panel-0"]');
    await page.fill('[data-testid="pq-line-width-0"]', '0.8');
    await page.fill('[data-testid="pq-line-height-0"]', '1.2');
    await page.fill('#pq-line-qty-0', '3');
    await page.fill('[data-testid="pq-line-sheets-0"]', '3');
    await page.fill('#pq-line-cost-val-0', '50000');
    await page.fill('#pq-line-profit-val-0', '30000');

    const areaBadge = await page.textContent(
      '[data-testid="pq-area-live-badge-0"]',
    );
    assert.match(areaBadge, /2,88\s*m²/);

    // Thêm gia công thủ công nhưng ĐỂ TRỐNG GIÁ -> kích hoạt trạng thái Chờ giá xưởng
    await page.click('[data-testid="pq-add-manual-stage-0"]');
    await page.fill('[data-testid="pq-stage-name-0-0"]', 'Bế demi theo file');
    // rate để trống ""

    await page.waitForSelector('[data-testid="pq-pending-cost-summary-card"]');
    const isMainSaveDisabled = await page.isDisabled(
      '[data-testid="pq-save-quote-btn"]',
    );
    assert.equal(isMainSaveDisabled, true);

    await page.click('[data-testid="pq-save-pending-draft-btn"]');
    await page.waitForSelector(
      '[data-testid="pq-detail-pending-cost-notice"]',
      {
        timeout: 10000,
      },
    );

    assert.equal(
      await page.isDisabled('[data-testid="pq-detail-download-pdf-btn"]'),
      true,
    );
    assert.equal(
      await page.locator('[data-testid="pq-detail-finalize-btn"]').count(),
      0,
    );
    assert.equal(
      await page.isDisabled('[data-testid="pq-detail-convert-btn"]'),
      true,
    );

    await assertNoHorizontalOverflow('Desktop Pending Cost Quote Detail');
    await page.screenshot({
      path: path.join(screenshotDir, 'pending-cost-detail-desktop.png'),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    await assertNoHorizontalOverflow(
      'iPhone 390x844 Pending Cost Quote Detail',
    );

    assert.deepEqual(
      pageErrors,
      [],
      `Phát hiện lỗi runtime trên trang: ${pageErrors.join(' | ')}`,
    );
  } finally {
    if (browser) await browser.close();
    if (ephemeral) await ephemeral.close();
    await pool.end();
  }
});
