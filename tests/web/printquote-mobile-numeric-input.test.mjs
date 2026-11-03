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

  const savedQuotes = [
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
  ];

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
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
        });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              ...savedQuotes[0],
              id: 'saved-new-1',
              quote_code: 'BG-202611-099',
              current_version: 1,
              title: parsed.title || 'Báo giá mới',
            },
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
    getCounters: () => ({ postQuotesCount, postPdfCount }),
    resetCounters: () => {
      postQuotesCount = 0;
      postPdfCount = 0;
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

    // SSR markup kiểm tra inputMode="numeric" (không dùng type="number" gây lỗi iOS)
    const html = renderToStaticMarkup(
      React.createElement(PrintQuoteScreen, {
        role: 'owner',
        workspaceName: 'Hoài Phương Media',
        initialTab: 'create',
      }),
    );
    assert.equal(html.includes('inputMode="numeric"'), true);
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

          await page.goto(`${server.webUrl}/print-quotes`, {
            waitUntil: 'networkidle',
          });
          await page.waitForSelector('[data-testid="panel-create-quote"]', {
            timeout: 15000,
          });

          const qtyInput = page.locator('input[aria-label="Số lượng dòng 1"]');
          const costInput = page.locator(
            'input[aria-label="Giá trị giá vốn dòng 1"]',
          );
          const profitInput = page.locator(
            'input[aria-label="Giá trị lợi nhuận dòng 1"]',
          );
          const shipInput = page.locator('[data-testid="pq-shipping-input"]');

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
          await page.waitForTimeout(180);

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
            `[${target.label}] MobileBottomNav phải tự ẩn khi bàn phím di động đang mở`,
          );
          assert.equal(
            kbOpenOverlayState.bugHidden,
            true,
            `[${target.label}] Nút Báo lỗi nổi phải tự ẩn khi bàn phím di động đang mở`,
          );
          assert.ok(
            kbOpenOverlayState.inputTop >= 40 &&
              kbOpenOverlayState.inputBottom <= kbOpenOverlayState.innerHeight,
            `[${target.label}] Ô đang nhập phải tự cuộn nằm trọn trong vùng nhìn thấy (${kbOpenOverlayState.inputTop}..${kbOpenOverlayState.inputBottom} / ${kbOpenOverlayState.innerHeight})`,
          );

          // --- SCENARIO B: Giá nhà in 300 -> xóa hết -> nhập 5000 -> kết quả 5000 (KHÔNG PHẢI 05000) ---
          await costInput.click();
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
          await page.waitForTimeout(180);

          const kbClosedState = await page.evaluate(() => {
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
            kbClosedState.navVisible,
            true,
            `[${target.label}] Khi đóng bàn phím, MobileBottomNav phải hiển thị trở lại`,
          );
          assert.equal(
            kbClosedState.bugVisible,
            true,
            `[${target.label}] Khi đóng bàn phím, nút Báo lỗi nổi phải hiển thị trở lại`,
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

          // Kiểm tra tải báo giá đã lưu (TOTAL_BATCH 3 tờ = 10.000đ vốn + 5.000đ lời + 25.000đ ship = 40.000đ) -> giữ nguyên 100%
          await page.click('[data-testid="tab-quotes-list"]');
          await page.waitForSelector('[data-testid="quote-row-BG-202611-088"]');
          await page
            .locator('[data-testid="quote-row-BG-202611-088"]')
            .locator('button:has-text("Sửa / Tạo phiên bản")')
            .click();
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
});
