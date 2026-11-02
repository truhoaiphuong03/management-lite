import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DesktopSidebar,
  MobileBottomNav,
} from '../../dist/packages/ui/src/components/Navigation.js';
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

describe('MGL-PRINTQUOTE V1 — Phase 3 Web UI & Vietnamese A4 PDF Tests', () => {
  it('1. Nhóm menu "Báo giá in ấn" hiển thị cho Owner trên Desktop/Mobile và ẩn hoàn toàn với Staff', () => {
    const ownerSidebar = renderToStaticMarkup(
      React.createElement(DesktopSidebar, {
        currentPath: '/print-quotes',
        onNavigate: () => {},
        role: 'owner',
        isOwnerVerified: true,
      }),
    );
    assert.equal(ownerSidebar.includes('Báo giá in ấn'), true);

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

    const adminMobile = renderToStaticMarkup(
      React.createElement(MobileBottomNav, {
        currentPath: '/',
        onNavigate: () => {},
        role: 'admin',
        isOwnerVerified: false,
      }),
    );
    assert.equal(adminMobile.includes('Báo giá'), false);
  });

  it('2. PrintQuoteScreen hiển thị 4 nhóm điều hướng chính, chỉ hiện tab con của nhóm đang chọn và tính trực tiếp bài toán chuẩn trên Tab 1 (Tạo báo giá)', () => {
    const html = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        workspaceName: 'Hoài Phương Media',
        initialTab: 'create',
      }),
    );

    // 4 nhóm chính luôn hiện
    assert.equal(html.includes('Báo giá'), true);
    assert.equal(html.includes('Đơn hàng'), true);
    assert.equal(html.includes('Danh mục'), true);
    assert.equal(html.includes('Báo cáo'), true);

    // Khi đang ở nhóm Báo giá: chỉ hiện 2 màn hình con thuộc nhóm Báo giá, không hiện đồng thời 6 tab gây rối
    assert.equal(html.includes('1. Tạo báo giá'), true);
    assert.equal(html.includes('2. Danh sách báo giá'), true);
    assert.equal(html.includes('3. Nhà in &amp; Bảng giá'), false);
    assert.equal(html.includes('6. Lợi nhuận &amp; Công nợ'), false);

    // Khi chuyển sang nhóm Danh mục (initialTab: 'vendors'): chỉ hiện 2 màn hình con thuộc Danh mục
    const catalogHtml = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        workspaceName: 'Hoài Phương Media',
        initialTab: 'vendors',
      }),
    );
    assert.equal(catalogHtml.includes('3. Nhà in &amp; Bảng giá'), true);
    assert.equal(catalogHtml.includes('4. Khách hàng'), true);
    assert.equal(catalogHtml.includes('1. Tạo báo giá'), false);

    // Default draft line: 100 tờ x (300đ vốn + 200đ lời) + 50.000đ ship = 100.000đ
    assert.equal(html.includes('30.000 ₫'), true);
    assert.equal(html.includes('+20.000 ₫'), true);
    assert.equal(html.includes('50.000 ₫'), true);
    assert.equal(html.includes('100.000 ₫'), true);
    assert.equal(html.includes('Một trăm nghìn đồng chẵn'), true);

    // Staff bị chặn quyền truy cập
    const staffHtml = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'staff',
      }),
    );
    assert.equal(staffHtml.includes('printquote-forbidden'), true);
  });

  it('3. PrintQuoteScreen hiển thị đúng các Tab 2 (Danh sách báo giá), Tab 3 (Nhà in), Tab 4 (Khách hàng), Tab 5 (Đơn hàng), Tab 6 (Lợi nhuận & Công nợ)', () => {
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
        customer_pdf_json: {},
        integrity_hash: 'abcdef1234567890',
        valid_until: '2026-11-15',
        notes: 'Giao nội thành',
        created_by: null,
        finalized_at: null,
        created_at: '2026-11-02T00:00:00Z',
        updated_at: '2026-11-02T00:00:00Z',
      },
    ];

    const quotesTabHtml = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        initialTab: 'quotes',
        initialQuotes: sampleQuotes,
      }),
    );
    assert.equal(quotesTabHtml.includes('BG-2026-0001'), true);
    assert.equal(quotesTabHtml.includes('Báo giá hộp cứng cao cấp'), true);
    assert.equal(quotesTabHtml.includes('550.000 ₫'), true);

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
        initialTab: 'orders',
        initialOrders: sampleOrders,
      }),
    );
    assert.equal(ordersTabHtml.includes('DH-2026-0001'), true);
    assert.equal(ordersTabHtml.includes('SX: Đang in ấn'), true);
    assert.equal(ordersTabHtml.includes('Giao: Đang đóng gói'), true);
    assert.equal(ordersTabHtml.includes('300.000 ₫'), true); // remaining debt

    const analyticsTabHtml = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        initialTab: 'analytics',
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
    assert.equal(analyticsTabHtml.includes('550.000 ₫'), true);
    assert.equal(analyticsTabHtml.includes('225.000 ₫'), true);
    assert.equal(analyticsTabHtml.includes('300.000 ₫'), true);
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

  it('5. PrintQuote v0.8.1 UX/UI Redesign: 4 nhóm điều hướng, 4 khối thu gọn linh hoạt trên Tab Tạo báo giá, thêm khách nhanh inline, bảng tổng kết chuyển đổi và tùy chọn nâng cao thu gọn', () => {
    const html = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        workspaceName: 'Hoài Phương Media',
        initialTab: 'create',
      }),
    );

    // 4 nhóm điều hướng rõ ràng: Báo giá, Đơn hàng, Danh mục, Báo cáo
    assert.equal(html.includes('pq-nav-group-quotes'), true);
    assert.equal(html.includes('pq-nav-group-orders'), true);
    assert.equal(html.includes('pq-nav-group-catalog'), true);
    assert.equal(html.includes('pq-nav-group-analytics'), true);

    // Thanh nhảy nhanh và 4 nhóm thông tin có thể thu gọn trên 1 màn hình
    assert.equal(html.includes('pq-section-jump-bar'), true);
    assert.equal(html.includes('pq-sec-customer'), true);
    assert.equal(html.includes('pq-sec-products'), true);
    assert.equal(html.includes('pq-sec-summary'), true);
    assert.equal(html.includes('pq-sec-actions'), true);
    assert.equal(html.includes('pq-jump-customer'), true);
    assert.equal(html.includes('pq-jump-products'), true);
    assert.equal(html.includes('pq-jump-summary'), true);
    assert.equal(html.includes('pq-jump-actions'), true);

    // Nút thêm khách hàng mới ngay trong màn hình Tạo báo giá
    assert.equal(html.includes('pq-inline-new-customer-btn'), true);

    // Một bảng tổng kết duy nhất có nút chuyển đổi Bản gửi khách / Bóc tách nội bộ
    assert.equal(html.includes('pq-view-mode-customer'), true);
    assert.equal(html.includes('pq-view-mode-internal'), true);

    // Tùy chọn nâng cao mặc định thu gọn
    assert.equal(html.includes('pq-advanced-options-toggle'), true);
    assert.equal(html.includes('pq-advanced-options-panel'), false);

    // Thanh hành động Lưu / Xuất PDF luôn dễ truy cập
    assert.equal(html.includes('pq-action-bar'), true);
  });

  it('6. Hiển thị đơn giá gửi khách trên PDF A4 & Bản gửi khách: Khớp 763,16 ₫ × 100 tờ = 76.316 ₫, xử lý số thập phân vô hạn (~22.895 ₫ Tính trọn gói 3 tờ), không dùng thuật ngữ kỹ thuật "Hiệu chỉnh làm tròn" và không lộ giá vốn/lợi nhuận', () => {
    // 6a. Kiểm tra hàm formatCustomerLinePriceDisplay cho 3 trường hợp
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

    // 6b. Kiểm tra báo giá đa sản phẩm thực tế:
    // Dòng 1: 100 tờ (vốn 30.000đ + lời 20.000đ = 50.000đ) + phân bổ ship 26.316đ = 76.316đ (đơn giá chính xác 763,16 đ/tờ, làm tròn nguyên 764đ, lệch -84đ)
    // Dòng 2: 3 tờ (vốn 30.000đ + lời 15.000đ = 45.000đ) + phân bổ ship 23.684đ = 68.684đ (đơn giá vô hạn tuần hoàn 22.894,666... đ/tờ)
    // Tổng thanh toán = 145.000 ₫
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

    // Pricing engine giữ nguyên 100% logic gốc
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

    // Hiển thị rõ 763,16 ₫ × 100 = 76.316 ₫ và ~22.895 ₫ (Tính trọn gói 3 tờ) = 68.684 ₫
    assert.equal(a4Html.includes('763,16 ₫'), true);
    assert.equal(a4Html.includes('76.316 ₫'), true);
    assert.equal(a4Html.includes('~22.895 ₫'), true);
    assert.equal(a4Html.includes('(Tính trọn gói 3 tờ)'), true);
    assert.equal(a4Html.includes('68.684 ₫'), true);
    assert.equal(a4Html.includes('145.000 ₫'), true);

    // Tuyệt đối KHÔNG xuất hiện thuật ngữ kỹ thuật gây khó hiểu cho khách hàng
    assert.equal(a4Html.includes('Hiệu chỉnh làm tròn'), false);
    assert.equal(a4Html.includes('Tạm tính theo đơn giá làm tròn'), false);
    assert.equal(a4Html.includes('-84 ₫'), false);
    assert.equal(a4Html.includes('76.400 ₫'), false);

    // Tuyệt đối KHÔNG lộ giá vốn (30.000 / 60.000) hay lợi nhuận (20.000 / 15.000 / 35.000)
    assert.equal(a4Html.includes('30.000'), false);
    assert.equal(a4Html.includes('60.000'), false);
    assert.equal(a4Html.includes('20.000'), false);
    assert.equal(a4Html.includes('15.000'), false);
    assert.equal(a4Html.includes('35.000'), false);
  });
});
