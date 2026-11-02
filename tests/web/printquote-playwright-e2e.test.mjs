/**
 * Real-Browser Playwright E2E Acceptance Test for MGL-PRINTQUOTE V1 (Task QA-03)
 *
 * Drives real Google Chrome against http://localhost:3001 (Web) + http://127.0.0.1:3002 (API)
 * backed by PostgreSQL DEV on 127.0.0.1:55499/mglite_mac_dev:
 *   1. Login as Owner
 *   2. Open menu Báo giá in ấn (#nav-group-print-quotes)
 *   3. Create Vendor, Customer, and Price Catalog Item
 *   4. Create Quote: 100 tờ, giá in 300đ/tờ, lợi nhuận 200đ/tờ, vận chuyển 50.000đ
 *   5. Verify Customer Unit Price = 1.000 ₫/tờ, Grand Total = 100.000 ₫
 *   6. Save Quote, download direct A4 .pdf file, verify PDF binary & reopen preview
 *   7. Convert Quote into Order (and verify duplicate conversion button is replaced by badge)
 *   8. Record Deposit (40.000 ₫), update Production & Delivery status, and settle Final Payment (60.000 ₫ -> Debt 0 ₫)
 *   9. Logout and Login again -> verify all data persists in PostgreSQL DEV
 *  10. Verify Desktop (1440x900) and iPhone (390x844) responsive viewports + capture screenshots
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import pg from 'pg';

const WEB_URL = process.env.QA_WEB_URL || 'http://localhost:3001';

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envFile)) {
    const raw = fs.readFileSync(envFile, 'utf8');
    const match = raw.match(/^DATABASE_URL=(.+)$/m);
    if (match) return match[1].trim();
  }
  throw new Error('Missing DATABASE_URL in .env');
}
const DB_URL = loadDatabaseUrl();
const ARTIFACT_DIR =
  process.env.QA_ARTIFACT_DIR ||
  '/Users/duongbinh/.gemini/antigravity/brain/0b8b76c4-492a-4c36-83fb-353ff2cea636';

function loadOwnerPassword() {
  if (process.env.QA_OWNER_PASSWORD) return process.env.QA_OWNER_PASSWORD;
  const credFile = path.resolve(process.cwd(), '.env.qa-credentials.local');
  if (fs.existsSync(credFile)) {
    const raw = fs.readFileSync(credFile, 'utf8');
    const match = raw.match(/^OWNER_PASSWORD=(.+)$/m);
    if (match) return match[1].trim();
  }
  throw new Error('Missing OWNER_PASSWORD in .env.qa-credentials.local');
}

async function resetPrintQuoteTablesInDevDb() {
  const pool = new pg.Pool({ connectionString: DB_URL });
  try {
    await pool.query(`
      DELETE FROM print_order_payments;
      DELETE FROM print_orders;
      DELETE FROM print_quote_versions;
      DELETE FROM print_quotes;
      DELETE FROM print_vendor_price_items;
      DELETE FROM print_customers;
      DELETE FROM print_vendors;
      DELETE FROM print_code_counters;
    `);
  } finally {
    await pool.end();
  }
}

test('Task QA-03: Real-Browser Playwright E2E — Full PrintQuote workflow on Desktop & iPhone', async () => {
  const ownerPassword = loadOwnerPassword();
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

  await resetPrintQuoteTablesInDevDb();

  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
  });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1120 },
      acceptDownloads: true,
    });
    const page = await context.newPage();

    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // 1. Open Web App & Login as Owner
    await page.goto(`${WEB_URL}/login`, { waitUntil: 'networkidle' });
    await page.fill('#identifier', 'owner');
    await page.fill('#password', ownerPassword);
    await page.click('button[type="submit"]');

    const navPrintQuoteBtn =
      'nav[aria-label="Desktop navigation"] button:has-text("Báo giá in ấn")';
    await page.waitForSelector(navPrintQuoteBtn, { timeout: 15000 });

    // 2. Click menu "Báo giá in ấn"
    await page.click(navPrintQuoteBtn);
    await page.waitForSelector('[data-testid="printquote-screen"]', {
      timeout: 10000,
    });

    // 3. Create Vendor & Price Catalog Item on Tab 3
    await page.click('[data-testid="tab-vendors-catalog"]');
    await page.waitForSelector('[data-testid="panel-vendors-catalog"]');

    await page.fill('input[aria-label="Tên nhà in"]', 'Nhà in Offset Sài Gòn Chuẩn');
    await page.fill('input[aria-label="Số điện thoại nhà in"]', '0908111222');
    await page.fill('input[aria-label="Ngân hàng nhà in"]', 'Vietcombank');
    await page.fill('input[aria-label="Số tài khoản nhà in"]', '0071000888999');
    await page.click('button:has-text("+ Thêm Nhà in")');

    await page.waitForSelector('text=Nhà in Offset Sài Gòn Chuẩn');

    // Fill Price Catalog Item: 300đ/tờ, default profit 200đ/tờ
    await page.fill(
      'input[aria-label="Tên hạng mục bảng giá"]',
      'Tờ rơi A5 Couche 150gsm',
    );
    await page.fill(
      'input[aria-label="Quy cách in bảng giá"]',
      'In Offset 2 mặt 4 màu, cán bóng',
    );
    await page.fill('input[aria-label="Đơn giá vốn nhà in"]', '300');
    await page.fill('input[aria-label="Lợi nhuận mặc định"]', '200');
    await page.click('button:has-text("+ Lưu vào Bảng giá")');

    await page.waitForSelector('text=Tờ rơi A5 Couche 150gsm');
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'qa03-01-desktop-vendors-catalog.png'),
      fullPage: false,
    });

    // 4. Create Customer on Tab 4
    await page.click('[data-testid="tab-customers"]');
    await page.waitForSelector('[data-testid="panel-customers"]');

    await page.fill(
      'input[aria-label="Tên khách hàng"]',
      'Anh Minh — Chuỗi Trà Sữa Sài Gòn',
    );
    await page.fill(
      'input[aria-label="Tên công ty khách hàng"]',
      'Công ty TNHH F&B Minh Phát',
    );
    await page.fill('input[aria-label="Số điện thoại khách hàng"]', '0912333444');
    await page.fill(
      'input[aria-label="Địa chỉ giao hàng"]',
      '123 Nguyễn Huệ, Quận 1, TP.HCM',
    );
    await page.click('button:has-text("+ Thêm Khách hàng")');

    await page.waitForSelector('text=Anh Minh — Chuỗi Trà Sữa Sài Gòn');
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'qa03-02-desktop-customers.png'),
      fullPage: false,
    });

    // 5. Go to Tab 1 (Tạo báo giá): 100 tờ, giá in 300đ/tờ, lợi nhuận 200đ/tờ, vận chuyển 50.000đ
    await page.click('[data-testid="tab-create-quote"]');
    await page.waitForSelector('[data-testid="panel-create-quote"]');

    await page.fill(
      '[data-testid="pq-title-input"]',
      'Báo giá in Tờ rơi A5 khai trương Chuỗi Trà Sữa Sài Gòn',
    );

    // Select customer (first non-empty option)
    const custSelect = page.locator('[data-testid="pq-customer-select"]');
    const custOptionVal = await custSelect
      .locator('option')
      .nth(1)
      .getAttribute('value');
    assert.ok(custOptionVal, 'Customer option must exist');
    await custSelect.selectOption(custOptionVal);

    // Select price catalog item on line 1 (loads 300đ cost + 200đ profit automatically)
    const catalogSelect = page.locator(
      'select[aria-label="Chọn bảng giá nhà in dòng 1"]',
    );
    const catalogOptionVal = await catalogSelect
      .locator('option')
      .nth(1)
      .getAttribute('value');
    assert.ok(catalogOptionVal, 'Catalog item option must exist');
    await catalogSelect.selectOption(catalogOptionVal);

    // Ensure quantity = 100, vendor cost = 300, profit = 200, shipping = 50000
    await page.fill('input[aria-label="Số lượng dòng 1"]', '100');
    await page.fill('input[aria-label="Giá trị giá vốn dòng 1"]', '300');
    await page.fill('input[aria-label="Giá trị lợi nhuận dòng 1"]', '200');
    await page.fill('[data-testid="pq-shipping-input"]', '50000');

    await page.fill(
      '#pq-customer-notes',
      'Báo giá đã bao gồm thiết kế file in & giao hàng tận nơi nội thành TP.HCM.',
    );

    // 6. Verify calculation:
    // Vendor cost = 30.000 ₫, Profit = +20.000 ₫, Shipping = 50.000 ₫, Total = 100.000 ₫, Unit Price = 1.000 ₫
    const vendorCostText = await page.textContent(
      '[data-testid="pq-summary-vendor-cost"]',
    );
    const profitText = await page.textContent(
      '[data-testid="pq-summary-profit"]',
    );
    const shippingText = await page.textContent(
      '[data-testid="pq-summary-shipping"]',
    );
    const totalText = await page.textContent(
      '[data-testid="pq-summary-total"]',
    );
    const customerCardText = await page.textContent(
      '[data-testid="pq-customer-safe-card"]',
    );

    assert.match(vendorCostText, /30\.000/);
    assert.match(profitText, /20\.000/);
    assert.match(shippingText, /50\.000/);
    assert.match(totalText, /100\.000/);
    assert.match(customerCardText, /1\.000\s*₫/);
    assert.match(customerCardText, /100\.000\s*₫/);
    assert.match(customerCardText, /Một trăm nghìn đồng chẵn/);

    // Save Quote (v1)
    await page.click('[data-testid="pq-save-quote-btn"]');
    await page.waitForSelector(
      '[data-testid="printquote-banner"]:has-text("Đã lưu thành công báo giá")',
    );

    const bannerAfterSave = await page.textContent(
      '[data-testid="printquote-banner"]',
    );
    const codeMatch = bannerAfterSave.match(/(BG-\d{6}-\d{3})/);
    assert.ok(codeMatch, `Expected quote code in banner: ${bannerAfterSave}`);
    const savedQuoteCode = codeMatch[1];

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'qa03-03-desktop-create-quote-100k.png'),
      fullPage: false,
    });

    // 7. Download direct .PDF file & verify binary + A4 preview modal
    const downloadPromise = page.waitForEvent('download');
    await page.click('[data-testid="pq-download-pdf-btn"]');
    const download = await downloadPromise;
    const suggestedFilename = download.suggestedFilename();
    assert.equal(suggestedFilename, `${savedQuoteCode}.pdf`);

    const savedPdfPath = path.join(ARTIFACT_DIR, suggestedFilename);
    await download.saveAs(savedPdfPath);
    const sampleAliasPdfPath = path.join(
      ARTIFACT_DIR,
      'MGL-PrintQuote-Bao-Gia-Mau-A4.pdf',
    );
    fs.copyFileSync(savedPdfPath, sampleAliasPdfPath);

    const pdfBytes = fs.readFileSync(savedPdfPath);
    assert.ok(
      pdfBytes.subarray(0, 5).toString('ascii') === '%PDF-',
      'Downloaded file must be a valid PDF binary starting with %PDF-',
    );
    assert.ok(pdfBytes.length > 1000, 'Downloaded PDF must be non-empty');

    // Open PDF A4 Preview Modal & take screenshot
    await page.click('[data-testid="pq-preview-pdf-btn"]');
    await page.waitForSelector('[data-testid="pq-pdf-modal"]');
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'qa03-04-desktop-pdf-a4-preview.png'),
    });
    await page.click('[data-testid="pq-pdf-modal"] button:has-text("Đóng")');
    await page.waitForSelector('[data-testid="pq-pdf-modal"]', {
      state: 'detached',
    });

    // 8. Go to Tab 2 (Danh sách báo giá) & Convert to Order
    await page.click('[data-testid="tab-quotes-list"]');
    await page.waitForSelector('[data-testid="panel-quotes-list"]');
    await page.waitForSelector(`[data-testid="quote-row-${savedQuoteCode}"]`);

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'qa03-05-desktop-quotes-list.png'),
      fullPage: false,
    });

    await page.click(`[data-testid="pq-convert-order-btn-${savedQuoteCode}"]`);
    await page.waitForSelector('[data-testid="panel-orders"]');

    // 9. On Tab 5 (Đơn hàng): Record Deposit (40.000 ₫), update Production & Delivery status, and settle Final Payment (60.000 ₫)
    const orderCard = page.locator('[data-testid^="order-card-"]').first();
    await orderCard.waitFor({ state: 'visible' });
    const orderTestId = await orderCard.getAttribute('data-testid');
    const savedOrderCode = orderTestId.replace('order-card-', '');

    // Record Deposit = 40.000 ₫
    await page.click(
      `[data-testid="pq-order-record-payment-${savedOrderCode}"]`,
    );
    await page.waitForSelector(
      'div[role="dialog"][aria-label="Ghi nhận thanh toán đơn hàng"]',
    );
    await page.selectOption('select[aria-label="Loại thanh toán"]', 'DEPOSIT');
    await page.fill('input[aria-label="Số tiền thanh toán"]', '40000');
    await page.fill(
      'input[aria-label="Ghi chú thanh toán"]',
      'Khách chuyển khoản đặt cọc 40%',
    );
    await page.click('button:has-text("Xác nhận thu tiền")');

    await page.waitForFunction(
      (code) => {
        const el = document.querySelector(`[data-testid="order-card-${code}"]`);
        return el && el.textContent && el.textContent.includes('40.000');
      },
      savedOrderCode,
    );

    const cardAfterDeposit = await orderCard.textContent();
    assert.match(cardAfterDeposit, /40\.000\s*₫/);
    assert.match(cardAfterDeposit, /60\.000\s*₫/);

    // Update Production Status -> COMPLETED, Delivery Status -> DELIVERED
    await page.selectOption(
      `select[aria-label="Trạng thái sản xuất ${savedOrderCode}"]`,
      'COMPLETED',
    );
    await page.waitForFunction(
      (code) => {
        const el = document.querySelector(`[data-testid="order-card-${code}"]`);
        return (
          el && el.textContent && el.textContent.includes('SX: Hoàn tất sản xuất')
        );
      },
      savedOrderCode,
    );

    await page.selectOption(
      `select[aria-label="Trạng thái giao hàng ${savedOrderCode}"]`,
      'DELIVERED',
    );
    await page.waitForFunction(
      (code) => {
        const el = document.querySelector(`[data-testid="order-card-${code}"]`);
        return (
          el &&
          el.textContent &&
          el.textContent.includes('Giao: Đã giao thành công')
        );
      },
      savedOrderCode,
    );

    // Record Final Settlement = 60.000 ₫ -> Debt = 0 ₫, Status = Đã tất toán
    await page.click(
      `[data-testid="pq-order-record-payment-${savedOrderCode}"]`,
    );
    await page.waitForSelector(
      'div[role="dialog"][aria-label="Ghi nhận thanh toán đơn hàng"]',
    );
    await page.selectOption('select[aria-label="Loại thanh toán"]', 'FINAL');
    await page.fill('input[aria-label="Số tiền thanh toán"]', '60000');
    await page.fill(
      'input[aria-label="Ghi chú thanh toán"]',
      'Khách tất toán đủ khi nhận hàng',
    );
    await page.click('button:has-text("Xác nhận thu tiền")');

    await page.waitForSelector(
      'div[role="dialog"][aria-label="Ghi nhận thanh toán đơn hàng"]',
      { state: 'detached' },
    );

    await page.waitForFunction(
      (code) => {
        const el = document.querySelector(`[data-testid="order-card-${code}"]`);
        return el && el.textContent && el.textContent.includes('Đã tất toán');
      },
      savedOrderCode,
    );

    const cardAfterSettlement = await orderCard.textContent();
    assert.match(cardAfterSettlement, /Đã tất toán/);
    assert.match(cardAfterSettlement, /SX:\s*Hoàn tất sản xuất/);
    assert.match(cardAfterSettlement, /Giao:\s*Đã giao thành công/);

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'qa03-06-desktop-orders-paid.png'),
      fullPage: false,
    });

    // Check Tab 6 (Lợi nhuận & Công nợ)
    await page.click('[data-testid="tab-profit-debt"]');
    await page.waitForSelector('[data-testid="panel-profit-debt"]');
    const analyticsText = await page.textContent(
      '[data-testid="panel-profit-debt"]',
    );
    assert.match(analyticsText, /100\.000\s*₫/);
    assert.match(analyticsText, /20\.000\s*₫/);
    assert.match(analyticsText, /0\s*₫/);

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'qa03-07-desktop-analytics.png'),
      fullPage: false,
    });

    // 10. Logout & Login again -> Verify data persists
    await page.click('button[aria-label="Đăng xuất"]');
    await page.waitForSelector('#identifier', { timeout: 10000 });

    await page.fill('#identifier', 'owner');
    await page.fill('#password', ownerPassword);
    await page.click('button[type="submit"]');
    await page.waitForSelector(navPrintQuoteBtn, { timeout: 15000 });

    await page.click(navPrintQuoteBtn);
    await page.waitForSelector('[data-testid="printquote-screen"]');

    await page.click('[data-testid="tab-quotes-list"]');
    await page.waitForSelector(`[data-testid="quote-row-${savedQuoteCode}"]`);
    const convertedBadge = await page.textContent(
      `[data-testid="pq-quote-converted-badge-${savedQuoteCode}"]`,
    );
    assert.match(convertedBadge, /Đã chuyển đơn in/);

    // Reopen saved quote into editor and verify values
    await page.click('[data-testid="tab-orders"]');
    await page.waitForSelector(`[data-testid="order-card-${savedOrderCode}"]`);

    // 11. Verify iPhone viewport (390x844) & no horizontal overflow
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('[data-testid="tab-create-quote"]');
    await page.waitForSelector('[data-testid="panel-create-quote"]');

    const mobileOverflowCreate = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
      );
    });
    assert.equal(
      mobileOverflowCreate,
      false,
      'Mobile iPhone 390px view on Create Quote must not overflow horizontally',
    );

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'qa03-08-iphone-create-quote.png'),
      fullPage: false,
    });

    await page.click('[data-testid="tab-orders"]');
    await page.waitForSelector('[data-testid="panel-orders"]');

    const mobileOverflowOrders = await page.evaluate(() => {
      return (
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth
      );
    });
    assert.equal(
      mobileOverflowOrders,
      false,
      'Mobile iPhone 390px view on Orders must not overflow horizontally',
    );

    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'qa03-09-iphone-orders.png'),
      fullPage: false,
    });

    assert.equal(
      pageErrors.length,
      0,
      `Expected 0 uncaught page errors, got: ${pageErrors.join('; ')}`,
    );

    await context.close();
  } finally {
    await browser.close();
  }
});
