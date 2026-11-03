import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DesktopSidebar,
  MobileBottomNav,
} from '../../dist/packages/ui/src/components/Navigation.js';
import { matchRoute } from '../../dist/apps/web/src/router.js';
import {
  determinePostVerificationRoute,
  evaluateRouteAccess,
  executeLogout,
  executeSessionVerification,
  isPublicAuthRoute,
} from '../../dist/apps/web/src/session-manager.js';
import {
  attemptSilentSessionRefresh,
  triggerSessionExpired,
} from '../../dist/apps/web/src/auth-interceptor.js';
import {
  clearPrintQuoteRamDraft,
  clearPrintQuoteSessionIdentity,
  confirmLeavePrintQuoteIfNeeded,
  discardAndProceedPrintQuoteFallbackLeave,
  getPrintQuoteDraftOwner,
  getPrintQuoteRamDraft,
  getVerifiedActivePrintQuoteEditorPath,
  handlePrintQuoteBeforeUnload,
  hasPendingPrintQuoteFallbackLeave,
  hasPrintQuoteLeaveInterceptor,
  isPrintQuoteDraftDirty,
  registerPrintQuoteLeaveInterceptor,
  setPrintQuoteRamDraft,
  stayOnPrintQuoteFallbackLeave,
} from '../../dist/apps/web/src/printquote-draft-bridge.js';
import { PrintQuoteScreen } from '../../dist/apps/web/src/screens/PrintQuoteScreen.js';
import {
  buildPrintQuoteA4Html,
  formatCustomerLinePriceDisplay,
  numberToVietnameseWords,
} from '../../dist/apps/web/src/screens/helpers/printquote-helpers.js';
import {
  calculatePrintQuote,
  buildCustomerSafePdfPayload,
  ProfitMode,
  ProfitScope,
  RoundingMode,
} from '../../dist/packages/contracts/src/printquote.js';

const CANONICAL_DRAFT_QUOTE = {
  id: 'q-draft-100k',
  workspace_id: 'ws-1',
  quote_code: 'BG-202611-001',
  title: 'Báo giá Tờ rơi A5 khai trương',
  customer_id: 'c-1',
  customer_name: 'Anh Minh',
  customer_phone: '0909123456',
  customer_address: 'Quận 1, TP.HCM',
  status: 'DRAFT',
  current_version: 1,
  shipping_fee: 50000,
  include_shipping_in_unit_price: true,
  shipping_allocation_strategy: 'PROPORTIONAL_BY_BASE_AMOUNT',
  rounding_mode: 'CEIL',
  rounding_step: 1,
  total_quantity: 100,
  total_vendor_cost: 30000,
  total_profit: 20000,
  total_extra_cost: 0,
  total_rounding_adjustment: 0,
  total_quote_amount: 100000,
  single_product_final_unit_price: 1000,
  lines_json: [
    {
      id: 'LINE-1',
      name: 'Tờ rơi A5 Couche 150gsm (In 2 mặt)',
      specification: 'In Offset 4 màu, cán bóng 2 mặt',
      vendorId: null,
      vendorName: null,
      vendorPriceItemId: null,
      unit: 'tờ',
      quantity: 100,
      unitVendorCost: 300,
      totalVendorCost: 30000,
      vendorCostMode: 'PER_UNIT',
      profitMode: 'FIXED_AMOUNT',
      profitScope: 'PER_UNIT',
      profitInputValue: 200,
      unitProfit: 200,
      totalProfit: 20000,
      allocatedShippingFee: 50000,
      totalExtraCost: 0,
      rawFinalUnitPrice: 1000,
      finalUnitPrice: 1000,
      billedLineSubtotal: 100000,
      roundingAdjustment: 0,
      reconciledLineTotal: 100000,
    },
  ],
  snapshot_json: {},
  customer_pdf_json: {
    quoteId: 'q-draft-100k',
    quoteCode: 'BG-202611-001',
    customerName: 'Anh Minh',
    generatedAt: '2026-11-03T00:00:00Z',
    includeShippingInUnitPrice: true,
    lines: [
      {
        index: 1,
        id: 'LINE-1',
        name: 'Tờ rơi A5 Couche 150gsm (In 2 mặt)',
        specification: 'In Offset 4 màu, cán bóng 2 mặt',
        unit: 'tờ',
        quantity: 100,
        unitPrice: 1000,
        billedSubtotal: 100000,
        roundingAdjustment: 0,
        lineTotal: 100000,
        shippingIncludedInUnitPrice: true,
      },
    ],
    subtotalFromLines: 100000,
    totalRoundingAdjustment: 0,
    shippingAmountToAddOnPdfFooter: 0,
    shippingFooterNote: 'Đã gộp trong đơn giá',
    grandTotalPayable: 100000,
  },
  integrity_hash: 'abcdef1234567890',
  valid_until: '2026-11-20',
  notes: 'Giao nội thành TP.HCM',
  created_by: 'u-owner',
  finalized_at: null,
  created_at: '2026-11-03T00:00:00Z',
  updated_at: '2026-11-03T00:00:00Z',
};

describe('MGL-PRINTQUOTE UX V2 — Web Routes, RBAC, Modal Catalogs, Honest KPIs & Vietnamese A4 PDF Tests', () => {
  it('1. Nhóm menu "Báo giá in ấn" và toàn bộ 10 route /print-quotes* chỉ mở cho Owner đã xác thực phiên, chặn hoàn toàn Staff/Admin/Owner chưa xác thực', () => {
    const ownerSidebar = renderToStaticMarkup(
      React.createElement(DesktopSidebar, {
        currentPath: '/print-quotes',
        onNavigate: () => {},
        role: 'owner',
        isOwnerVerified: true,
      }),
    );
    assert.equal(ownerSidebar.includes('Báo giá in ấn'), true);

    const unverifiedOwnerSidebar = renderToStaticMarkup(
      React.createElement(DesktopSidebar, {
        currentPath: '/',
        onNavigate: () => {},
        role: 'owner',
        isOwnerVerified: false,
      }),
    );
    assert.equal(unverifiedOwnerSidebar.includes('Báo giá in ấn'), false);

    const staffSidebar = renderToStaticMarkup(
      React.createElement(DesktopSidebar, {
        currentPath: '/',
        onNavigate: () => {},
        role: 'staff',
        isOwnerVerified: false,
      }),
    );
    assert.equal(staffSidebar.includes('Báo giá in ấn'), false);

    const adminSidebar = renderToStaticMarkup(
      React.createElement(DesktopSidebar, {
        currentPath: '/',
        onNavigate: () => {},
        role: 'admin',
        isOwnerVerified: false,
      }),
    );
    assert.equal(adminSidebar.includes('Báo giá in ấn'), false);

    const ownerMobile = renderToStaticMarkup(
      React.createElement(MobileBottomNav, {
        currentPath: '/print-quotes',
        onNavigate: () => {},
        role: 'owner',
        isOwnerVerified: true,
      }),
    );
    assert.equal(ownerMobile.includes('Báo giá'), true);

    const unverifiedOwnerMobile = renderToStaticMarkup(
      React.createElement(MobileBottomNav, {
        currentPath: '/',
        onNavigate: () => {},
        role: 'owner',
        isOwnerVerified: false,
      }),
    );
    assert.equal(unverifiedOwnerMobile.includes('Báo giá'), false);

    const adminMobile = renderToStaticMarkup(
      React.createElement(MobileBottomNav, {
        currentPath: '/',
        onNavigate: () => {},
        role: 'admin',
        isOwnerVerified: false,
      }),
    );
    assert.equal(adminMobile.includes('Báo giá'), false);

    const allPrintQuoteSamplePaths = [
      '/print-quotes',
      '/print-quotes/new',
      '/print-quotes/orders',
      '/print-quotes/catalog',
      '/print-quotes/catalog/prices',
      '/print-quotes/catalog/customers',
      '/print-quotes/catalog/vendors',
      '/print-quotes/reports',
      '/print-quotes/q-123',
      '/print-quotes/q-123/edit',
    ];
    for (const samplePath of allPrintQuoteSamplePaths) {
      const matched = matchRoute(samplePath);
      assert.ok(matched.route, `Route ${samplePath} must be registered`);
      assert.equal(matched.route.category, 'print-quotes');
      assert.equal(matched.route.ownerOnly, true);

      assert.equal(
        evaluateRouteAccess(samplePath, true, 'owner').isForbidden,
        false,
      );
      assert.equal(
        evaluateRouteAccess(samplePath, false, 'owner').isForbidden,
        true,
      );
      assert.equal(
        evaluateRouteAccess(samplePath, true, 'admin').isForbidden,
        true,
      );
      assert.equal(
        evaluateRouteAccess(samplePath, true, 'staff').isForbidden,
        true,
      );
    }
  });

  it('2. UX V2: /print-quotes mặc định mở Danh sách báo giá + nút "+ Tạo báo giá mới"; /print-quotes/new mở form sạch không số giả; /print-quotes/:id/edit tính trực tiếp bài toán chuẩn', () => {
    // 2a. Mặc định /print-quotes mở Danh sách báo giá + 1 thanh subnav gọn 4 mục + nút CTA "+ Tạo báo giá mới"
    const defaultHtml = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        workspaceName: 'Hoài Phương Media',
        initialQuotes: [CANONICAL_DRAFT_QUOTE],
      }),
    );
    assert.equal(defaultHtml.includes('data-testid="panel-quotes-list"'), true);
    assert.equal(defaultHtml.includes('data-testid="pq-new-quote-cta"'), true);
    assert.equal(defaultHtml.includes('+ Tạo báo giá mới'), true);
    assert.equal(defaultHtml.includes('pq-nav-group-quotes'), true);
    assert.equal(defaultHtml.includes('pq-nav-group-orders'), true);
    assert.equal(defaultHtml.includes('pq-nav-group-catalog'), true);
    assert.equal(defaultHtml.includes('pq-nav-group-analytics'), true);
    assert.equal(defaultHtml.includes('1. Tạo báo giá'), false);
    assert.equal(defaultHtml.includes('3. Nhà in &amp; Bảng giá'), false);
    assert.equal(defaultHtml.includes('6. Lợi nhuận &amp; Công nợ'), false);

    // 2b. /print-quotes/new mở màn hình soạn thảo tập trung (ẩn subnav phân hệ, form rỗng không số giả)
    const newQuoteHtml = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        workspaceName: 'Hoài Phương Media',
        currentPath: '/print-quotes/new',
      }),
    );
    assert.equal(
      newQuoteHtml.includes('data-testid="panel-create-quote"'),
      true,
    );
    assert.equal(newQuoteHtml.includes('pq-nav-group-quotes'), false);
    assert.equal(
      newQuoteHtml.includes('data-testid="pq-empty-guidance-notice"'),
      true,
    );
    assert.equal(
      newQuoteHtml.includes('data-testid="pq-live-breakdown"'),
      false,
    );
    assert.equal(newQuoteHtml.includes('100.000 ₫'), false);

    // 2c. /print-quotes/:id/edit nạp báo giá 100 tờ x (300đ vốn + 200đ lời) + 50.000đ ship = 100.000đ
    const editQuoteHtml = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        workspaceName: 'Hoài Phương Media',
        currentPath: `/print-quotes/${CANONICAL_DRAFT_QUOTE.id}/edit`,
        routePattern: '/print-quotes/:id/edit',
        routeParams: { id: CANONICAL_DRAFT_QUOTE.id },
        initialQuotes: [CANONICAL_DRAFT_QUOTE],
      }),
    );
    assert.equal(editQuoteHtml.includes('30.000 ₫'), true);
    assert.equal(editQuoteHtml.includes('+20.000 ₫'), true);
    assert.equal(editQuoteHtml.includes('50.000 ₫'), true);
    assert.equal(editQuoteHtml.includes('100.000 ₫'), true);
    assert.equal(editQuoteHtml.includes('Một trăm nghìn đồng chẵn'), true);

    // 2d. Staff, Admin và Owner chưa xác thực bị chặn quyền truy cập
    for (const deniedProps of [
      { role: 'staff' },
      { role: 'admin' },
      { role: 'owner', isOwnerVerified: false },
    ]) {
      const deniedHtml = renderToStaticMarkup(
        React.createElement(PrintQuoteScreen, deniedProps),
      );
      assert.equal(deniedHtml.includes('printquote-forbidden'), true);
    }
  });

  it('3. UX V2: Chi tiết báo giá (/print-quotes/:id), 3 trang Danh mục tách riêng thêm bằng Dialog (/catalog/prices|customers|vendors), Đơn hàng (/orders) và Báo cáo trung thực (/reports)', () => {
    const sampleQuotes = [
      {
        id: 'q-1',
        workspace_id: 'ws-1',
        quote_code: 'BG-2026-0001',
        title: 'Báo giá hộp cứng cao cấp',
        customer_id: 'c-1',
        customer_name: 'Chị Minh Thư',
        customer_phone: '0909888777',
        customer_address: null,
        status: 'FINALIZED',
        current_version: 2,
        shipping_fee: 50000,
        include_shipping_in_unit_price: true,
        shipping_allocation_strategy: 'PROPORTIONAL_BY_BASE_AMOUNT',
        rounding_mode: 'CEIL',
        rounding_step: 1,
        total_quantity: 100,
        total_vendor_cost: 300000,
        total_profit: 200000,
        total_extra_cost: 0,
        total_rounding_adjustment: 0,
        total_quote_amount: 550000,
        single_product_final_unit_price: 5500,
        lines_json: [],
        snapshot_json: {},
        customer_pdf_json: {
          quoteId: 'q-1',
          quoteCode: 'BG-2026-0001',
          customerName: 'Chị Minh Thư',
          generatedAt: '2026-11-02T00:00:00Z',
          includeShippingInUnitPrice: true,
          lines: [],
          subtotalFromLines: 550000,
          totalRoundingAdjustment: 0,
          shippingAmountToAddOnPdfFooter: 0,
          shippingFooterNote: 'Đã gộp trong đơn giá',
          grandTotalPayable: 550000,
        },
        integrity_hash: 'abcdef1234567890',
        valid_until: '2026-11-15',
        notes: 'Giao nội thành',
        created_by: null,
        finalized_at: '2026-11-02T01:00:00Z',
        created_at: '2026-11-02T00:00:00Z',
        updated_at: '2026-11-02T00:00:00Z',
      },
    ];

    // 3a. Danh sách báo giá (/print-quotes): báo giá FINALIZED chỉ hiện Tạo bản mới (clone), không cho sửa đè trực tiếp
    const quotesTabHtml = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        currentPath: '/print-quotes',
        initialQuotes: sampleQuotes,
      }),
    );
    assert.equal(quotesTabHtml.includes('BG-2026-0001'), true);
    assert.equal(quotesTabHtml.includes('Báo giá hộp cứng cao cấp'), true);
    assert.equal(quotesTabHtml.includes('550.000 ₫'), true);
    assert.equal(
      quotesTabHtml.includes('pq-quote-open-detail-BG-2026-0001'),
      true,
    );
    assert.equal(quotesTabHtml.includes('pq-quote-clone-BG-2026-0001'), true);
    assert.equal(quotesTabHtml.includes('pq-quote-edit-BG-2026-0001'), false);

    // 3b. Chi tiết báo giá (/print-quotes/:id): đích đến sau khi lưu báo giá
    const detailHtml = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        currentPath: '/print-quotes/q-1',
        routePattern: '/print-quotes/:id',
        routeParams: { id: 'q-1' },
        initialQuotes: sampleQuotes,
      }),
    );
    assert.equal(detailHtml.includes('data-testid="panel-quote-detail"'), true);
    assert.equal(detailHtml.includes('data-testid="pq-detail-back-btn"'), true);
    assert.equal(detailHtml.includes('BG-2026-0001'), true);
    assert.equal(detailHtml.includes('300.000 ₫'), true);
    assert.equal(detailHtml.includes('+200.000 ₫'), true);
    assert.equal(detailHtml.includes('550.000 ₫'), true);
    assert.equal(detailHtml.includes('Tạo báo giá mới từ bản này'), true);

    // 3c. Danh mục tách 3 trang riêng (/catalog/prices, /catalog/customers, /catalog/vendors), mặc định KHÔNG hiện form inline cố định đầu trang
    const pricesCatalogHtml = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        currentPath: '/print-quotes/catalog/prices',
      }),
    );
    assert.equal(pricesCatalogHtml.includes('pq-catalog-tabs'), true);
    assert.equal(pricesCatalogHtml.includes('pq-open-price-dialog-btn'), true);
    assert.equal(pricesCatalogHtml.includes('pq-open-vendor-dialog-btn'), false);
    assert.equal(pricesCatalogHtml.includes('<form'), false);

    const customersCatalogHtml = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        currentPath: '/print-quotes/catalog/customers',
      }),
    );
    assert.equal(
      customersCatalogHtml.includes('data-testid="panel-customers"'),
      true,
    );
    assert.equal(
      customersCatalogHtml.includes('pq-open-customer-dialog-btn'),
      true,
    );
    assert.equal(customersCatalogHtml.includes('<form'), false);

    const vendorsCatalogHtml = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        currentPath: '/print-quotes/catalog/vendors',
      }),
    );
    assert.equal(
      vendorsCatalogHtml.includes('pq-open-vendor-dialog-btn'),
      true,
    );
    assert.equal(
      vendorsCatalogHtml.includes('pq-open-price-dialog-btn'),
      false,
    );
    assert.equal(vendorsCatalogHtml.includes('<form'), false);

    // 3d. Đơn hàng (/print-quotes/orders) & Báo cáo trung thực (/print-quotes/reports)
    const sampleOrders = [
      {
        id: 'ord-1',
        workspace_id: 'ws-1',
        order_code: 'DH-2026-0001',
        quote_id: 'q-1',
        quote_code: 'BG-2026-0001',
        quote_version: 2,
        customer_id: 'c-1',
        customer_name: 'Chị Minh Thư',
        customer_phone: '0909888777',
        customer_address: null,
        vendor_id: 'v-1',
        vendor_name: 'Nhà in Sài Gòn',
        title: 'Đơn hộp cứng',
        order_date: '2026-11-02',
        print_ordered_at: '2026-11-02',
        due_date: '2026-11-06',
        completed_at: null,
        delivered_at: null,
        production_status: 'PRINTING',
        delivery_status: 'PACKING',
        payment_status: 'DEPOSIT_PAID',
        total_quote_amount: 550000,
        expected_vendor_cost: 300000,
        expected_shipping_fee: 50000,
        expected_extra_cost: 0,
        expected_profit: 200000,
        actual_vendor_cost: 280000,
        actual_shipping_fee: 45000,
        actual_extra_cost: 0,
        actual_profit: 225000,
        deposit_required: 250000,
        deposit_paid: 250000,
        total_paid_amount: 250000,
        remaining_debt_amount: 300000,
        snapshot_json: {},
        integrity_hash: 'abcdef',
        notes: null,
        created_by: null,
        created_at: '2026-11-02T00:00:00Z',
        updated_at: '2026-11-02T00:00:00Z',
      },
    ];

    const ordersTabHtml = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        currentPath: '/print-quotes/orders',
        initialOrders: sampleOrders,
      }),
    );
    assert.equal(ordersTabHtml.includes('DH-2026-0001'), true);
    assert.equal(ordersTabHtml.includes('SX: Đang in ấn'), true);
    assert.equal(ordersTabHtml.includes('Giao: Đang đóng gói'), true);
    assert.equal(ordersTabHtml.includes('300.000 ₫'), true);
    assert.equal(ordersTabHtml.includes('đã đối soát'), false);

    const analyticsTabHtml = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        currentPath: '/print-quotes/reports',
        initialOrders: sampleOrders,
        initialStats: {
          total_vendors: 1,
          total_price_items: 2,
          total_customers: 1,
          total_quotes: 1,
          finalized_quotes: 0,
          total_orders: 1,
          total_order_revenue: 550000,
          total_expected_vendor_cost: 300000,
          total_actual_vendor_cost: 280000,
          total_expected_profit: 200000,
          total_actual_profit: 225000,
          total_paid_amount: 250000,
          total_remaining_debt: 300000,
          orders_by_production_status: {
            PENDING: 0,
            PREPRESS: 0,
            PRINTING: 1,
            FINISHING: 0,
            COMPLETED: 0,
            CANCELLED: 0,
          },
          orders_by_delivery_status: {
            NOT_SHIPPED: 0,
            PACKING: 1,
            SHIPPING: 0,
            DELIVERED: 0,
            RETURNED: 0,
          },
          orders_by_payment_status: {
            UNPAID: 0,
            DEPOSIT_PAID: 1,
            PARTIALLY_PAID: 0,
            PAID: 0,
          },
        },
      }),
    );
    assert.equal(
      analyticsTabHtml.includes('data-testid="pq-reports-scope-note"'),
      true,
    );
    assert.equal(
      analyticsTabHtml.includes('Lợi nhuận dự kiến theo báo giá'),
      true,
    );
    assert.equal(analyticsTabHtml.includes('550.000 ₫'), true);
    assert.equal(analyticsTabHtml.includes('200.000 ₫'), true); // expected_profit
    assert.equal(analyticsTabHtml.includes('250.000 ₫'), true); // paid
    assert.equal(analyticsTabHtml.includes('300.000 ₫'), true); // remaining_debt
    // Tuyệt đối ẩn actual_profit chưa có sổ đối soát hóa đơn xưởng và không gọi "đã đối soát"
    assert.equal(analyticsTabHtml.includes('225.000 ₫'), false);
    assert.equal(analyticsTabHtml.includes('đã đối soát'), false);
  });

  it('4. Xuất PDF A4 tiếng Việt: Chỉ hiển thị giá bán, tuyệt đối KHÔNG lộ giá vốn nhà in, lợi nhuận hay cộng trùng ship', () => {
    const calc = calculatePrintQuote({
      items: [
        {
          id: 'SP-01',
          name: 'Catalogue A4 16 trang',
          quantity: 100,
          unitVendorCost: 3777, // 377.700đ vốn
          profit: {
            mode: ProfitMode.FIXED_AMOUNT,
            scope: ProfitScope.PER_UNIT,
            value: 2223, // 222.300đ lời
          },
        },
      ],
      shippingFee: 50000, // 50.000đ ship gộp vào đơn giá -> tổng 650.000đ
      includeShippingInUnitPrice: true,
    });
    const safePdf = buildCustomerSafePdfPayload(calc);
    const a4Html = buildPrintQuoteA4Html(safePdf, {
      quoteCode: 'BG-2026-0099',
      quoteTitle: 'Báo giá Catalogue A4',
      versionNo: 1,
      workspaceName: 'Hoài Phương Media',
      customerName: 'Công ty Cổ phần Sao Việt',
      customerPhone: '0901234567',
      itemSpecifications: {
        'SP-01': {
          specification: 'Bìa C250 cán mờ, ruột C150 đóng kim',
          unit: 'cuốn',
        },
      },
    });

    assert.equal(a4Html.includes('BẢNG BÁO GIÁ IN ẤN'), true);
    assert.equal(a4Html.includes('BG-2026-0099'), true);
    assert.equal(a4Html.includes('Catalogue A4 16 trang'), true);
    assert.equal(a4Html.includes('Đã gộp trong đơn giá'), true);
    assert.equal(a4Html.includes('6.500 ₫'), true);
    assert.equal(a4Html.includes('650.000 ₫'), true);
    assert.equal(
      a4Html.includes(numberToVietnameseWords(safePdf.grandTotalPayable)),
      true,
    );

    // Tuyệt đối không lộ giá vốn nhà in (3.777 / 377.700), lợi nhuận (2.223 / 222.300) hoặc tiền ship ẩn (>50.000 ₫<)
    assert.equal(a4Html.includes('3.777'), false);
    assert.equal(a4Html.includes('377.700'), false);
    assert.equal(a4Html.includes('2.223'), false);
    assert.equal(a4Html.includes('222.300'), false);
    assert.equal(a4Html.includes('>50.000 ₫<'), false);
  });

  it('5. UX V2 Focused Quote Editor (/print-quotes/new & /print-quotes/:id/edit): Bố cục 2 cột, thêm khách qua Dialog, bảng tổng kết chuyển đổi, tùy chọn nâng cao thu gọn và bảo vệ báo giá đã khóa', () => {
    const editorHtml = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        workspaceName: 'Hoài Phương Media',
        currentPath: `/print-quotes/${CANONICAL_DRAFT_QUOTE.id}/edit`,
        routePattern: '/print-quotes/:id/edit',
        routeParams: { id: CANONICAL_DRAFT_QUOTE.id },
        initialQuotes: [CANONICAL_DRAFT_QUOTE],
      }),
    );

    assert.equal(editorHtml.includes('pq-editor-back-btn'), true);
    assert.equal(editorHtml.includes('pq-sec-customer'), true);
    assert.equal(editorHtml.includes('pq-sec-products'), true);
    assert.equal(editorHtml.includes('pq-sec-summary'), true);
    assert.equal(editorHtml.includes('pq-sec-actions'), true);

    // Nút mở Dialog thêm khách hàng mới trên màn hình Tạo/Sửa (mặc định đóng Dialog)
    assert.equal(editorHtml.includes('pq-inline-new-customer-btn'), true);
    assert.equal(editorHtml.includes('pq-inline-customer-form'), false);

    // Một bảng tổng kết duy nhất có nút chuyển đổi Bản gửi khách / Bóc tách nội bộ
    assert.equal(editorHtml.includes('pq-view-mode-customer'), true);
    assert.equal(editorHtml.includes('pq-view-mode-internal'), true);

    // Tùy chọn nâng cao mặc định thu gọn
    assert.equal(editorHtml.includes('pq-advanced-options-toggle'), true);
    assert.equal(editorHtml.includes('pq-advanced-options-panel'), false);

    // Thanh hành động Lưu / Xuất PDF luôn dễ truy cập
    assert.equal(editorHtml.includes('pq-action-bar'), true);

    // Khi truy cập trực tiếp /print-quotes/:id/edit của báo giá FINALIZED: chặn sửa đè, hướng sang Tạo bản mới
    const lockedEditHtml = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        workspaceName: 'Hoài Phương Media',
        currentPath: '/print-quotes/q-locked/edit',
        routePattern: '/print-quotes/:id/edit',
        routeParams: { id: 'q-locked' },
        initialQuotes: [
          {
            ...CANONICAL_DRAFT_QUOTE,
            id: 'q-locked',
            quote_code: 'BG-202611-LOCKED',
            status: 'FINALIZED',
          },
        ],
      }),
    );
    assert.equal(
      lockedEditHtml.includes('data-testid="pq-locked-quote-edit-card"'),
      true,
    );
    assert.equal(
      lockedEditHtml.includes('data-testid="pq-clone-locked-quote-btn"'),
      true,
    );
  });

  it('6. Hiển thị đơn giá gửi khách trên PDF A4 & Bản gửi khách: Khớp 763,16 ₫ × 100 tờ = 76.316 ₫, xử lý số thập phân vô hạn (~22.895 ₫ Tính trọn gói 3 tờ), không dùng thuật ngữ kỹ thuật "Hiệu chỉnh làm tròn" và không lộ giá vốn/lợi nhuận', () => {
    const exactInt = formatCustomerLinePriceDisplay(100000, 100, 'tờ');
    assert.deepEqual(exactInt, {
      unitPriceDisplay: '1.000 ₫',
      priceSubNote: null,
      isExact: true,
    });

    const exactDec2 = formatCustomerLinePriceDisplay(76316, 100, 'tờ');
    assert.deepEqual(exactDec2, {
      unitPriceDisplay: '763,16 ₫',
      priceSubNote: null,
      isExact: true,
    });

    const repeatingDec = formatCustomerLinePriceDisplay(68684, 3, 'tờ');
    assert.deepEqual(repeatingDec, {
      unitPriceDisplay: '~22.895 ₫',
      priceSubNote: 'Tính trọn gói 3 tờ',
      isExact: false,
    });

    const multiCalc = calculatePrintQuote({
      items: [
        {
          id: 'LINE-100',
          name: 'Tờ rơi A5 Couche 150gsm',
          unit: 'tờ',
          quantity: 100,
          unitVendorCost: 300,
          profit: {
            mode: ProfitMode.FIXED_AMOUNT,
            scope: ProfitScope.PER_UNIT,
            value: 200,
          },
        },
        {
          id: 'LINE-3',
          name: 'Voucher giảm giá 20%',
          unit: 'tờ',
          quantity: 3,
          unitVendorCost: 10000,
          profit: {
            mode: ProfitMode.FIXED_AMOUNT,
            scope: ProfitScope.PER_UNIT,
            value: 5000,
          },
        },
      ],
      shippingFee: 50000,
      includeShippingInUnitPrice: true,
      roundingPolicy: { mode: RoundingMode.CEIL, step: 1 },
    });

    assert.equal(multiCalc.lines[0].reconciledLineTotal, 76316);
    assert.equal(multiCalc.lines[0].finalUnitPrice, 764);
    assert.equal(multiCalc.lines[0].roundingAdjustment, -84);
    assert.equal(multiCalc.lines[1].reconciledLineTotal, 68684);
    assert.equal(multiCalc.totalQuoteAmount, 145000);

    const safePdf = buildCustomerSafePdfPayload(multiCalc);
    const a4Html = buildPrintQuoteA4Html(safePdf, {
      quoteCode: 'BG-2026-0763',
      quoteTitle: 'Báo giá Tờ rơi & Voucher khai trương',
      workspaceName: 'Hoài Phương Media',
      customerName: 'Chuỗi Trà Sữa Sài Gòn',
    });

    assert.equal(a4Html.includes('763,16 ₫'), true);
    assert.equal(a4Html.includes('76.316 ₫'), true);
    assert.equal(a4Html.includes('~22.895 ₫'), true);
    assert.equal(a4Html.includes('(Tính trọn gói 3 tờ)'), true);
    assert.equal(a4Html.includes('68.684 ₫'), true);
    assert.equal(a4Html.includes('145.000 ₫'), true);

    assert.equal(a4Html.includes('Hiệu chỉnh làm tròn'), false);
    assert.equal(a4Html.includes('Tạm tính theo đơn giá làm tròn'), false);
    assert.equal(a4Html.includes('-84 ₫'), false);
    assert.equal(a4Html.includes('76.400 ₫'), false);

    assert.equal(a4Html.includes('30.000'), false);
    assert.equal(a4Html.includes('60.000'), false);
    assert.equal(a4Html.includes('20.000'), false);
    assert.equal(a4Html.includes('15.000'), false);
    assert.equal(a4Html.includes('35.000'), false);
  });

  it('7. Fail-closed RAM Draft Bridge: Khi dirty nhưng leaveInterceptor=null, tuyệt đối không tự xóa nháp hay gọi proceed() âm thầm; quản lý beforeunload theo trạng thái dirty', () => {
    try {
      clearPrintQuoteRamDraft();
      registerPrintQuoteLeaveInterceptor(null);

      // Khi chưa có nháp bẩn: không chặn điều hướng và không chặn beforeunload
      let proceedCount = 0;
      assert.equal(
        confirmLeavePrintQuoteIfNeeded(() => {
          proceedCount += 1;
        }),
        false,
      );
      assert.equal(proceedCount, 0);

      let cleanPrevented = false;
      const cleanUnloadEvent = {
        preventDefault: () => {
          cleanPrevented = true;
        },
        returnValue: undefined,
      };
      assert.equal(handlePrintQuoteBeforeUnload(cleanUnloadEvent), undefined);
      assert.equal(cleanPrevented, false);

      // Nạp bản nháp bẩn trong khi leaveInterceptor đang là null (chưa gắn interceptor màn hình)
      setPrintQuoteRamDraft({
        mode: 'new',
        editingQuoteId: null,
        editingQuoteCode: null,
        editingQuoteVersion: 1,
        editorPath: '/print-quotes/new',
        quoteTitle: 'Nháp bảo vệ fail-closed',
        selectedCustomerId: '',
        validUntil: '',
        shippingFee: 0,
        shippingFeeInput: '0',
        includeShippingInUnitPrice: true,
        shippingAllocation: 'PROPORTIONAL_BY_BASE_AMOUNT',
        roundingMode: 'CEIL',
        roundingStep: 1,
        customerNotes: '',
        internalNotes: '',
        versionChangeNote: '',
        draftLines: [
          {
            id: 'ITEM-1',
            vendorPriceItemId: '',
            name: 'Hộp giấy Ivory 350gsm',
            specification: 'Cán mờ, ép kim',
            unit: 'hộp',
            quantity: 500,
            quantityInput: '500',
            vendorCostMode: 'PER_UNIT',
            vendorCostValue: 4500,
            vendorCostInput: '4500',
            ambiguousLegacyCost: null,
            profitMode: 'FIXED_AMOUNT',
            profitScope: 'PER_UNIT',
            profitValue: 1500,
            profitInput: '1500',
          },
        ],
        hasTouchedFields: true,
        isDirty: true,
      });

      assert.equal(hasPrintQuoteLeaveInterceptor(), false);
      assert.equal(isPrintQuoteDraftDirty(), true);

      // Kiểm tra beforeunload khi đang có nháp bẩn
      let dirtyPrevented = false;
      const dirtyUnloadEvent = {
        preventDefault: () => {
          dirtyPrevented = true;
        },
        returnValue: 'initial',
      };
      assert.equal(handlePrintQuoteBeforeUnload(dirtyUnloadEvent), '');
      assert.equal(dirtyPrevented, true);
      assert.equal(dirtyUnloadEvent.returnValue, '');

      // Gọi confirmLeavePrintQuoteIfNeeded khi leaveInterceptor === null -> PHẢI chặn (return true), KHÔNG gọi proceed, KHÔNG xóa nháp
      const blocked = confirmLeavePrintQuoteIfNeeded(() => {
        proceedCount += 1;
      });
      assert.equal(blocked, true);
      assert.equal(
        proceedCount,
        0,
        'Tuyệt đối không được gọi proceed() âm thầm khi chưa có xác nhận của người dùng',
      );
      assert.equal(
        isPrintQuoteDraftDirty(),
        true,
        'Tuyệt đối không được xóa nháp RAM âm thầm khi leaveInterceptor là null',
      );
      assert.equal(
        getPrintQuoteRamDraft()?.quoteTitle,
        'Nháp bảo vệ fail-closed',
      );
      assert.equal(hasPendingPrintQuoteFallbackLeave(), true);

      // Người dùng chọn "Ở lại giữ bản nháp" trên hộp thoại dự phòng -> hủy rời trang, giữ nguyên nháp
      stayOnPrintQuoteFallbackLeave();
      assert.equal(hasPendingPrintQuoteFallbackLeave(), false);
      assert.equal(proceedCount, 0);
      assert.equal(isPrintQuoteDraftDirty(), true);
      assert.equal(
        getPrintQuoteRamDraft()?.draftLines[0]?.name,
        'Hộp giấy Ivory 350gsm',
      );

      // Thử rời lại và xác nhận tường minh "Rời trang & xóa nháp" -> xóa nháp RAM và thực thi proceed() đúng 1 lần
      assert.equal(
        confirmLeavePrintQuoteIfNeeded(() => {
          proceedCount += 1;
        }),
        true,
      );
      assert.equal(proceedCount, 0);
      discardAndProceedPrintQuoteFallbackLeave();
      assert.equal(proceedCount, 1);
      assert.equal(hasPendingPrintQuoteFallbackLeave(), false);
      assert.equal(isPrintQuoteDraftDirty(), false);
      assert.equal(getPrintQuoteRamDraft(), null);
    } finally {
      clearPrintQuoteSessionIdentity();
      clearPrintQuoteRamDraft();
      registerPrintQuoteLeaveInterceptor(null);
    }
  });

  it('8. Session Verification & Security Lifecycle: Giữ nháp khi lỗi tạm (500/502/503/429/network/non-JSON) kèm fail-closed quyền truy cập; XÓA SẠCH khi 401/403/logout hoặc đổi userId/workspaceId/role (kể cả sau lỗi 500/network)', async () => {
    const makeTracker = () => ({
      authEpoch: 0,
      verifiedOwnerSession: false,
      isLoggedIn: false,
      role: 'owner',
      userId: undefined,
      userEmail: undefined,
      emailVerified: undefined,
      workspaceId: undefined,
      workspaceName: undefined,
      csrfToken: '',
    });

    const makeJsonResponse = (status, payload) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload,
    });

    const makeAuthEnvelope = ({
      userId = 'u-owner-1',
      email = 'owner1@hoaiphuong.local',
      workspaceId = 'ws-1',
      workspaceName = 'Hoài Phương Media',
      role = 'owner',
      csrfToken = 'csrf-tok-1',
    } = {}) => ({
      success: true,
      data: {
        user: { id: userId, email, email_verified: true },
        active_workspace: { id: workspaceId, name: workspaceName, role },
        csrf_token: csrfToken,
      },
    });

    const makeDirtyDraft = (title = 'Nháp Báo Giá Bảo Mật Giá Vốn') => ({
      mode: 'new',
      editingQuoteId: null,
      editingQuoteCode: null,
      editingQuoteVersion: 1,
      editorPath: '/print-quotes/new',
      quoteTitle: title,
      selectedCustomerId: 'c-vip',
      validUntil: '2026-12-01',
      shippingFee: 35000,
      shippingFeeInput: '35000',
      includeShippingInUnitPrice: true,
      shippingAllocation: 'PROPORTIONAL_BY_BASE_AMOUNT',
      roundingMode: 'CEIL',
      roundingStep: 1,
      customerNotes: 'Giao gấp',
      internalNotes: 'Giá vốn xưởng bí mật 2.800đ',
      versionChangeNote: '',
      draftLines: [
        {
          id: 'SEC-LINE-1',
          vendorPriceItemId: '',
          name: 'Túi giấy Kraft quai xoắn',
          specification: 'In 2 màu',
          unit: 'cái',
          quantity: 1000,
          quantityInput: '1000',
          vendorCostMode: 'PER_UNIT',
          vendorCostValue: 2800,
          vendorCostInput: '2800',
          ambiguousLegacyCost: null,
          profitMode: 'FIXED_AMOUNT',
          profitScope: 'PER_UNIT',
          profitValue: 1200,
          profitInput: '1200',
        },
      ],
      hasTouchedFields: true,
      isDirty: true,
    });

    try {
      clearPrintQuoteSessionIdentity();
      clearPrintQuoteRamDraft();
      registerPrintQuoteLeaveInterceptor(null);

      // --- 8A. Lỗi tạm thời (HTTP 500, 502, 503, 429, 200 HTML gateway, lỗi mạng) GIỮ NHÁP của Owner A nhưng FAIL-CLOSED phiên ---
      const tracker = makeTracker();
      assert.equal(
        await executeSessionVerification(tracker, async () =>
          makeJsonResponse(200, makeAuthEnvelope()),
        ),
        true,
      );
      assert.equal(tracker.verifiedOwnerSession, true);
      assert.equal(tracker.isLoggedIn, true);
      assert.equal(tracker.userId, 'u-owner-1');
      assert.equal(tracker.workspaceId, 'ws-1');

      setPrintQuoteRamDraft(makeDirtyDraft('Nháp Của Owner A'));
      assert.deepEqual(getPrintQuoteDraftOwner(), {
        userId: 'u-owner-1',
        workspaceId: 'ws-1',
        role: 'owner',
      });
      assert.equal(
        getVerifiedActivePrintQuoteEditorPath(),
        '/print-quotes/new',
      );

      const transientFailures = [
        {
          label: 'HTTP 500 Internal Server Error',
          fn: async () =>
            makeJsonResponse(500, {
              success: false,
              error: { code: 'INTERNAL_ERROR' },
            }),
        },
        {
          label: 'Network TypeError (offline / DNS)',
          fn: async () => {
            throw new TypeError('Failed to fetch');
          },
        },
        {
          label: 'HTTP 503 Database Unavailable',
          fn: async () =>
            makeJsonResponse(503, {
              success: false,
              error: { code: 'DATABASE_UNAVAILABLE' },
            }),
        },
        {
          label: 'HTTP 502 Bad Gateway',
          fn: async () => makeJsonResponse(502, null),
        },
        {
          label: 'HTTP 429 Rate Limited',
          fn: async () =>
            makeJsonResponse(429, {
              success: false,
              error: { code: 'RATE_LIMITED' },
            }),
        },
        {
          label: 'HTTP 200 Non-JSON Gateway HTML',
          fn: async () => ({
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError('Unexpected token < in JSON');
            },
          }),
        },
      ];

      for (const failure of transientFailures) {
        const ok = await executeSessionVerification(tracker, failure.fn);
        assert.equal(
          ok,
          false,
          `[${failure.label}] executeSessionVerification phải trả về false`,
        );
        // Fail-closed quyền phiên làm việc: chặn truy cập route /print-quotes* khi chưa xác thực lại
        assert.equal(tracker.verifiedOwnerSession, false);
        assert.equal(tracker.isLoggedIn, false);
        assert.equal(tracker.userId, undefined);
        assert.equal(tracker.workspaceId, undefined);
        assert.equal(
          evaluateRouteAccess(
            '/print-quotes/new',
            tracker.verifiedOwnerSession,
            tracker.role,
          ).isForbidden,
          true,
          `[${failure.label}] Quyền truy cập /print-quotes/new phải fail-closed khi phiên chưa xác thực`,
        );
        assert.equal(
          getVerifiedActivePrintQuoteEditorPath(),
          null,
          `[${failure.label}] Khi chưa xác thực lại thì chưa mở đường dẫn editor tự động`,
        );
        // Nhưng nháp RAM gắn với Owner A PHẢI được giữ nguyên 100%
        assert.equal(
          isPrintQuoteDraftDirty(),
          true,
          `[${failure.label}] Không được xóa nháp RAM khi gặp lỗi kết nối/máy chủ tạm thời`,
        );
        assert.equal(
          getPrintQuoteRamDraft()?.quoteTitle,
          'Nháp Của Owner A',
          `[${failure.label}] Tiêu đề nháp phải còn nguyên`,
        );
        assert.equal(
          getPrintQuoteRamDraft()?.draftLines[0]?.vendorCostValue,
          2800,
          `[${failure.label}] Giá vốn trong nháp RAM phải còn nguyên`,
        );
      }

      // Khi đúng chính Owner A (cùng userId + workspaceId + role='owner') kết nối lại thành công -> GIỮ NGUYÊN nháp và định tuyến về /print-quotes/new
      assert.equal(
        await executeSessionVerification(tracker, async () =>
          makeJsonResponse(200, makeAuthEnvelope()),
        ),
        true,
      );
      assert.equal(tracker.verifiedOwnerSession, true);
      assert.equal(isPrintQuoteDraftDirty(), true);
      assert.equal(getPrintQuoteRamDraft()?.quoteTitle, 'Nháp Của Owner A');
      assert.equal(
        determinePostVerificationRoute('/login', true),
        '/print-quotes/new',
      );

      // --- 8B. CHỐNG RÒ RỈ SANG NGƯỜI KHÁC SAU LỖI 500/NETWORK (khi tracker.userId đã bị reset về undefined!) ---
      const crossIdentityMatrix = [
        {
          label: 'Owner B khác userId đăng nhập sau lỗi 500',
          nextPayload: makeAuthEnvelope({
            userId: 'u-owner-2',
            email: 'owner2@hoaiphuong.local',
            workspaceId: 'ws-1',
            role: 'owner',
          }),
          expectVerified: true,
        },
        {
          label: 'Cùng userId nhưng sang Workspace khác (ws-2) sau lỗi mạng',
          nextPayload: makeAuthEnvelope({
            userId: 'u-owner-1',
            workspaceId: 'ws-2',
            role: 'owner',
          }),
          expectVerified: true,
        },
        {
          label: 'Nhân viên (staff) đăng nhập sau lỗi 500',
          nextPayload: makeAuthEnvelope({
            userId: 'u-staff-1',
            workspaceId: 'ws-1',
            role: 'staff',
          }),
          expectVerified: true,
        },
        {
          label: 'Quản lý phụ (admin) đăng nhập sau lỗi 500',
          nextPayload: makeAuthEnvelope({
            userId: 'u-admin-1',
            workspaceId: 'ws-1',
            role: 'admin',
          }),
          expectVerified: false,
        },
        {
          label: 'Phản hồi Owner thiếu userId (không thể chứng minh cùng chủ sở hữu)',
          nextPayload: {
            success: true,
            data: {
              user: { id: '', email: 'anon@local' },
              active_workspace: { id: 'ws-1', name: 'WS', role: 'owner' },
            },
          },
          expectVerified: true,
        },
      ];

      for (const scenario of crossIdentityMatrix) {
        const t = makeTracker();
        await executeSessionVerification(t, async () =>
          makeJsonResponse(200, makeAuthEnvelope()),
        );
        setPrintQuoteRamDraft(makeDirtyDraft(`Nháp Bí Mật — ${scenario.label}`));
        assert.equal(isPrintQuoteDraftDirty(), true);

        // Giả lập lỗi 500 làm t.userId = undefined trước khi người tiếp theo đăng nhập
        assert.equal(
          await executeSessionVerification(t, async () =>
            makeJsonResponse(500, { success: false }),
          ),
          false,
        );
        assert.equal(t.userId, undefined);
        assert.equal(isPrintQuoteDraftDirty(), true);

        // Người/phiên khác xác thực -> PHẢI xóa sạch nháp của Owner A ngay lập tức!
        const nextOk = await executeSessionVerification(t, async () =>
          makeJsonResponse(200, scenario.nextPayload),
        );
        assert.equal(nextOk, scenario.expectVerified, scenario.label);
        assert.equal(
          getPrintQuoteRamDraft(),
          null,
          `[${scenario.label}] Tuyệt đối không được lộ nháp RAM sang người/workspace/vai trò khác`,
        );
        assert.equal(isPrintQuoteDraftDirty(), false, scenario.label);
        assert.equal(getPrintQuoteDraftOwner(), null, scenario.label);
        if (nextOk) {
          assert.equal(
            determinePostVerificationRoute('/login', true),
            '/',
            `[${scenario.label}] Sau khi xóa nháp của phiên cũ, đăng nhập từ /login phải về "/" bình thường`,
          );
        }
      }

      // Nháp mồ côi không gắn chủ sở hữu (tạo khi chưa có phiên xác thực) -> fail-closed XÓA ngay khi gặp 500 hoặc khi bất kỳ ai đăng nhập
      clearPrintQuoteSessionIdentity();
      clearPrintQuoteRamDraft();
      setPrintQuoteRamDraft(makeDirtyDraft('Nháp Mồ Côi Không Chủ'));
      assert.equal(getPrintQuoteDraftOwner(), null);
      const orphanTracker = makeTracker();
      await executeSessionVerification(orphanTracker, async () =>
        makeJsonResponse(500, { success: false }),
      );
      assert.equal(
        getPrintQuoteRamDraft(),
        null,
        'Nháp không gắn định danh Owner phải bị xóa fail-closed ngay cả khi lỗi 500',
      );

      // --- 8C. 401 (kèm refresh thành công vs thất bại), 403, đổi trực tiếp identity & executeLogout ---
      const authTracker = makeTracker();
      await executeSessionVerification(authTracker, async () =>
        makeJsonResponse(200, makeAuthEnvelope()),
      );
      setPrintQuoteRamDraft(makeDirtyDraft('Nháp Kiểm Tra 401 Refresh'));

      // 401 trên /auth/me nhưng silent refresh (/auth/refresh) thành công cho CÙNG Owner A -> GIỮ nháp
      const refreshedSameOwner = await executeSessionVerification(
        authTracker,
        async (url) => {
          if (url === '/api/v1/auth/me') {
            return makeJsonResponse(401, { success: false });
          }
          return makeJsonResponse(
            200,
            makeAuthEnvelope({ csrfToken: 'csrf-refreshed-2' }),
          );
        },
      );
      assert.equal(refreshedSameOwner, true);
      assert.equal(authTracker.csrfToken, 'csrf-refreshed-2');
      assert.equal(isPrintQuoteDraftDirty(), true);
      assert.equal(
        getPrintQuoteRamDraft()?.quoteTitle,
        'Nháp Kiểm Tra 401 Refresh',
      );

      // 401 trên /auth/me và /auth/refresh cũng trả về 401 -> XÓA SẠCH nháp để bảo mật
      const expired401 = await executeSessionVerification(
        authTracker,
        async () => makeJsonResponse(401, { success: false }),
      );
      assert.equal(expired401, false);
      assert.equal(authTracker.verifiedOwnerSession, false);
      assert.equal(authTracker.isLoggedIn, false);
      assert.equal(getPrintQuoteRamDraft(), null);
      assert.equal(isPrintQuoteDraftDirty(), false);

      // 401 trên /auth/me và /auth/refresh gặp lỗi 500/network (không khôi phục được phiên) -> vẫn là 401 chưa xác thực, PHẢI XÓA nháp
      await executeSessionVerification(authTracker, async () =>
        makeJsonResponse(200, makeAuthEnvelope()),
      );
      setPrintQuoteRamDraft(makeDirtyDraft('Nháp 401 Refresh Lỗi 500'));
      const unrecovered401 = await executeSessionVerification(
        authTracker,
        async (url) => {
          if (url === '/api/v1/auth/me') {
            return makeJsonResponse(401, { success: false });
          }
          return makeJsonResponse(500, { success: false });
        },
      );
      assert.equal(unrecovered401, false);
      assert.equal(getPrintQuoteRamDraft(), null);

      // 403 Forbidden trên /auth/me -> XÓA SẠCH nháp
      await executeSessionVerification(authTracker, async () =>
        makeJsonResponse(200, makeAuthEnvelope()),
      );
      setPrintQuoteRamDraft(makeDirtyDraft('Nháp Kiểm Tra 403'));
      const forbidden403 = await executeSessionVerification(
        authTracker,
        async () => makeJsonResponse(403, { success: false }),
      );
      assert.equal(forbidden403, false);
      assert.equal(getPrintQuoteRamDraft(), null);

      // Đổi trực tiếp sang Owner khác (không qua lỗi 500) -> XÓA SẠCH nháp
      await executeSessionVerification(authTracker, async () =>
        makeJsonResponse(200, makeAuthEnvelope()),
      );
      setPrintQuoteRamDraft(makeDirtyDraft('Nháp Đổi Trực Tiếp Sang Owner B'));
      await executeSessionVerification(authTracker, async () =>
        makeJsonResponse(
          200,
          makeAuthEnvelope({ userId: 'u-owner-99', workspaceId: 'ws-1' }),
        ),
      );
      assert.equal(getPrintQuoteRamDraft(), null);

      // executeLogout xóa sạch nháp ngay lập tức và vô hiệu hóa phản hồi /auth/me trễ (authEpoch guard)
      await executeSessionVerification(authTracker, async () =>
        makeJsonResponse(200, makeAuthEnvelope()),
      );
      setPrintQuoteRamDraft(makeDirtyDraft('Nháp Trước Khi Logout'));
      let resolveInFlight;
      const slowVerifyPromise = executeSessionVerification(
        authTracker,
        () =>
          new Promise((resolve) => {
            resolveInFlight = resolve;
          }),
      );
      executeLogout(authTracker);
      assert.equal(getPrintQuoteRamDraft(), null);
      assert.equal(isPrintQuoteDraftDirty(), false);
      assert.equal(authTracker.isLoggedIn, false);
      resolveInFlight(makeJsonResponse(200, makeAuthEnvelope()));
      assert.equal(await slowVerifyPromise, false);
      assert.equal(authTracker.isLoggedIn, false);
      assert.equal(getPrintQuoteDraftOwner(), null);

      // Global auth-interceptor: attemptSilentSessionRefresh đổi sang Staff & triggerSessionExpired khi hết hạn
      await executeSessionVerification(authTracker, async () =>
        makeJsonResponse(200, makeAuthEnvelope()),
      );
      setPrintQuoteRamDraft(makeDirtyDraft('Nháp Kiểm Tra Interceptor'));
      await attemptSilentSessionRefresh(async () =>
        makeJsonResponse(
          200,
          makeAuthEnvelope({ userId: 'u-staff-2', role: 'staff' }),
        ),
      );
      assert.equal(
        getPrintQuoteRamDraft(),
        null,
        'Silent refresh trả về phiên Staff phải xóa ngay nháp Owner cũ',
      );

      await executeSessionVerification(authTracker, async () =>
        makeJsonResponse(200, makeAuthEnvelope()),
      );
      setPrintQuoteRamDraft(makeDirtyDraft('Nháp Hết Hạn Qua Interceptor'));
      triggerSessionExpired('/api/v1/print-quotes/quotes');
      assert.equal(
        getPrintQuoteRamDraft(),
        null,
        'triggerSessionExpired phải xóa nháp RAM ngay cả ở môi trường headless không gắn listener',
      );
    } finally {
      clearPrintQuoteSessionIdentity();
      clearPrintQuoteRamDraft();
      registerPrintQuoteLeaveInterceptor(null);
    }
  });

  it('9. Page-Leave & Public Auth Route Guard: Rời trang nội bộ / sang phân hệ khác / chuyển hướng /login khi lỗi tạm vs sau khi xóa nháp bảo mật', async () => {
    try {
      clearPrintQuoteSessionIdentity();
      clearPrintQuoteRamDraft();
      registerPrintQuoteLeaveInterceptor(null);

      // Nhận diện chính xác các route xác thực công khai vs route nghiệp vụ nội bộ
      for (const pub of [
        '/login',
        '/login?redirect=%2Fprint-quotes%2Fnew',
        '/forgot-password',
        '/activate/token-1',
        '/reset-password?token=abc',
        '/verify-email/xyz',
      ]) {
        assert.equal(isPublicAuthRoute(pub), true, `${pub} phải là public auth`);
        assert.equal(determinePostVerificationRoute(pub, false), null);
      }
      for (const priv of ['/', '/work', '/clock', '/print-quotes', '/print-quotes/new']) {
        assert.equal(isPublicAuthRoute(priv), false, `${priv} phải là route bảo vệ`);
        assert.equal(determinePostVerificationRoute(priv, false), '/login');
      }

      // Khi Owner đang giữ nháp bẩn (kể cả vừa khôi phục sau lỗi 500): rời sang /work PHẢI chặn xác nhận
      const tracker = {
        authEpoch: 0,
        verifiedOwnerSession: true,
        isLoggedIn: true,
        role: 'owner',
        userId: 'u-owner-1',
        userEmail: 'owner1@local',
        emailVerified: true,
        workspaceId: 'ws-1',
        workspaceName: 'WS',
        csrfToken: 'tok',
      };
      await executeSessionVerification(tracker, async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            user: { id: 'u-owner-1', email: 'owner1@local', email_verified: true },
            active_workspace: { id: 'ws-1', name: 'WS', role: 'owner' },
            csrf_token: 'tok',
          },
        }),
      }));

      setPrintQuoteRamDraft({
        mode: 'new',
        editingQuoteId: null,
        editingQuoteCode: null,
        editingQuoteVersion: 1,
        editorPath: '/print-quotes/new',
        quoteTitle: 'Nháp Kiểm Tra Rời Trang',
        selectedCustomerId: '',
        validUntil: '',
        shippingFee: 0,
        shippingFeeInput: '0',
        includeShippingInUnitPrice: true,
        shippingAllocation: 'PROPORTIONAL_BY_BASE_AMOUNT',
        roundingMode: 'CEIL',
        roundingStep: 1,
        customerNotes: '',
        internalNotes: '',
        versionChangeNote: '',
        draftLines: [],
        hasTouchedFields: true,
        isDirty: true,
      });

      let navigatedTo = null;
      assert.equal(
        confirmLeavePrintQuoteIfNeeded(() => {
          navigatedTo = '/work';
        }),
        true,
      );
      assert.equal(navigatedTo, null);
      stayOnPrintQuoteFallbackLeave();
      assert.equal(isPrintQuoteDraftDirty(), true);

      // Ngược lại, sau khi gặp 401 hoặc logout xóa nháp để bảo mật -> điều hướng không còn bị kẹt hộp thoại rời trang
      await executeSessionVerification(tracker, async () => ({
        ok: false,
        status: 401,
        json: async () => ({ success: false }),
      }));
      assert.equal(isPrintQuoteDraftDirty(), false);
      assert.equal(
        confirmLeavePrintQuoteIfNeeded(() => {
          navigatedTo = '/login';
        }),
        false,
      );
      assert.equal(hasPendingPrintQuoteFallbackLeave(), false);
    } finally {
      clearPrintQuoteSessionIdentity();
      clearPrintQuoteRamDraft();
      registerPrintQuoteLeaveInterceptor(null);
    }
  });
});
