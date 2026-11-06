import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright-core';
import {
  RoundingMode,
  ShippingAllocationStrategy,
} from '../../dist/packages/contracts/src/printquote.js';
import {
  filterPrintCustomersByNameOrPhone,
  formatSelectedPrintCustomerLabel,
  isLikelyCustomerPhoneQuery,
  normalizeCustomerPhoneDigits,
  normalizeCustomerSearchText,
} from '../../dist/apps/web/src/screens/helpers/printquote-helpers.js';
import { CreateQuoteTab } from '../../dist/apps/web/src/screens/printquote/CreateQuoteTab.js';
import { EMPTY_DRAFT_LINE } from '../../dist/apps/web/src/screens/printquote/types.js';

const REPO_ROOT = path.resolve('.');
const DIST_ROOT = path.join(REPO_ROOT, 'apps/web/dist');

const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function startDistServer() {
  return http.createServer((req, res) => {
    const reqPath = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    const safeRel = path
      .normalize(reqPath)
      .replace(/^(\.\.(\/|\\|$))+/, '')
      .replace(/^[/\\]+/, '');
    const candidate = path.join(DIST_ROOT, safeRel);
    if (
      safeRel &&
      candidate.startsWith(DIST_ROOT) &&
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isFile()
    ) {
      const ext = path.extname(candidate).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_BY_EXT[ext] || 'application/octet-stream',
      });
      res.end(fs.readFileSync(candidate));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(path.join(DIST_ROOT, 'index.html')));
  });
}

const SAMPLE_CUSTOMERS = [
  {
    id: 'cust-1',
    workspace_id: 'ws-1',
    code: 'KH001',
    name: 'Chị Lan',
    company_name: 'Spa Hoa Hồng',
    phone: '0909 123 456',
    email: null,
    address: null,
    tax_code: null,
    note: null,
    is_active: true,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
  },
  {
    id: 'cust-2',
    workspace_id: 'ws-1',
    code: 'KH002',
    name: 'Dương Hoàng',
    company_name: null,
    phone: '+84 918 888 999',
    email: null,
    address: null,
    tax_code: null,
    note: null,
    is_active: true,
    created_at: '2026-11-02T00:00:00Z',
    updated_at: '2026-11-02T00:00:00Z',
  },
  {
    id: 'cust-3',
    workspace_id: 'ws-1',
    code: 'KH003',
    name: 'Anh Minh Trà Sữa',
    company_name: 'Công ty F&B Minh Phát',
    phone: '0987.654.321',
    email: null,
    address: null,
    tax_code: null,
    note: null,
    is_active: true,
    created_at: '2026-11-03T00:00:00Z',
    updated_at: '2026-11-03T00:00:00Z',
  },
  {
    id: 'cust-inactive',
    workspace_id: 'ws-1',
    code: 'KH099',
    name: 'Khách Đã Ngưng',
    company_name: null,
    phone: '0900000000',
    email: null,
    address: null,
    tax_code: null,
    note: null,
    is_active: false,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  },
];

describe('PrintQuote CreateQuoteTab — Customer Search by Name or Phone', () => {
  it('normalizes Vietnamese diacritics and phone prefixes (+84 / 0 / spaces / dots)', () => {
    assert.equal(normalizeCustomerSearchText('  DƯƠNG   Đức  '), 'duong duc');
    assert.deepEqual(normalizeCustomerPhoneDigits('+84 909.123-456'), {
      rawDigits: '84909123456',
      localZeroDigits: '0909123456',
    });
    assert.equal(isLikelyCustomerPhoneQuery('0909 123'), true);
    assert.equal(isLikelyCustomerPhoneQuery('+84918888'), true);
    assert.equal(isLikelyCustomerPhoneQuery('Chị Lan 09'), false);
  });

  it('filters customers by Vietnamese name (with or without accents) and company', () => {
    const byUnaccented = filterPrintCustomersByNameOrPhone(
      SAMPLE_CUSTOMERS,
      'duong',
    );
    assert.deepEqual(
      byUnaccented.map((c) => c.id),
      ['cust-2'],
    );

    const byName = filterPrintCustomersByNameOrPhone(
      SAMPLE_CUSTOMERS,
      'chi lan',
    );
    assert.deepEqual(
      byName.map((c) => c.id),
      ['cust-1'],
    );

    const byCompany = filterPrintCustomersByNameOrPhone(
      SAMPLE_CUSTOMERS,
      'spa hoa',
    );
    assert.deepEqual(
      byCompany.map((c) => c.id),
      ['cust-1'],
    );
  });

  it('filters customers by phone prefix, last digits, formatted digits, and +84 <-> 0', () => {
    // Stored as "0909 123 456", searched with "+84909123"
    const byIntlQuery = filterPrintCustomersByNameOrPhone(
      SAMPLE_CUSTOMERS,
      '+84909123',
    );
    assert.deepEqual(
      byIntlQuery.map((c) => c.id),
      ['cust-1'],
    );

    // Stored as "+84 918 888 999", searched with local "091888"
    const byLocalZeroQuery = filterPrintCustomersByNameOrPhone(
      SAMPLE_CUSTOMERS,
      '091888',
    );
    assert.deepEqual(
      byLocalZeroQuery.map((c) => c.id),
      ['cust-2'],
    );

    // Search by last 4 digits ("4321" -> 0987.654.321)
    const byLastFourDigits = filterPrintCustomersByNameOrPhone(
      SAMPLE_CUSTOMERS,
      '4321',
    );
    assert.deepEqual(
      byLastFourDigits.map((c) => c.id),
      ['cust-3'],
    );
  });

  it('hides inactive customers unless currently selected on an edited quote', () => {
    const defaultActiveOnly = filterPrintCustomersByNameOrPhone(
      SAMPLE_CUSTOMERS,
      '',
    );
    assert.equal(
      defaultActiveOnly.some((c) => c.id === 'cust-inactive'),
      false,
    );

    const withSelectedInactive = filterPrintCustomersByNameOrPhone(
      SAMPLE_CUSTOMERS,
      '',
      'cust-inactive',
    );
    assert.equal(
      withSelectedInactive.some((c) => c.id === 'cust-inactive'),
      true,
    );
  });

  it('renders accessible combobox for "Khách hàng nhận báo giá" with selected label & clear action', () => {
    const noop = () => {};
    const emptyHtml = renderToStaticMarkup(
      React.createElement(CreateQuoteTab, {
        editingQuoteId: null,
        editingQuoteCode: null,
        editingQuoteVersion: 1,
        onBackToQuotes: noop,
        quoteTitle: '',
        onChangeQuoteTitle: noop,
        selectedCustomerId: '',
        onChangeSelectedCustomerId: noop,
        customers: SAMPLE_CUSTOMERS,
        priceItems: [],
        validUntil: '',
        onChangeValidUntil: noop,
        shippingFee: 0,
        onChangeShippingFee: noop,
        includeShippingInUnitPrice: false,
        onChangeIncludeShippingInUnitPrice: noop,
        shippingAllocation: ShippingAllocationStrategy.PROPORTIONAL_SUBTOTAL,
        onChangeShippingAllocation: noop,
        roundingMode: RoundingMode.NONE,
        onChangeRoundingMode: noop,
        roundingStep: 1000,
        onChangeRoundingStep: noop,
        customerNotes: '',
        onChangeCustomerNotes: noop,
        internalNotes: '',
        onChangeInternalNotes: noop,
        versionChangeNote: '',
        onChangeVersionChangeNote: noop,
        draftLines: [EMPTY_DRAFT_LINE(1)],
        setDraftLines: noop,
        onSelectCatalogItem: noop,
        livePricingResult: {
          calc: null,
          customerPdf: null,
          error: 'incomplete',
        },
        onResetNewQuote: noop,
        onSaveQuote: noop,
        onDownloadLivePdf: noop,
        onOpenLivePreview: noop,
        onQuickCreateCustomer: async () => null,
      }),
    );

    assert.match(emptyHtml, /Khách hàng nhận báo giá/);
    assert.match(emptyHtml, /data-testid="pq-customer-search-input"/);
    assert.match(emptyHtml, /role="combobox"/);
    assert.match(emptyHtml, /Tìm theo tên hoặc SĐT/);
    assert.doesNotMatch(emptyHtml, /data-testid="pq-customer-clear-btn"/);

    const selectedHtml = renderToStaticMarkup(
      React.createElement(CreateQuoteTab, {
        editingQuoteId: null,
        editingQuoteCode: null,
        editingQuoteVersion: 1,
        onBackToQuotes: noop,
        quoteTitle: 'Báo giá test',
        onChangeQuoteTitle: noop,
        selectedCustomerId: 'cust-1',
        onChangeSelectedCustomerId: noop,
        customers: SAMPLE_CUSTOMERS,
        priceItems: [],
        validUntil: '',
        onChangeValidUntil: noop,
        shippingFee: 0,
        onChangeShippingFee: noop,
        includeShippingInUnitPrice: false,
        onChangeIncludeShippingInUnitPrice: noop,
        shippingAllocation: ShippingAllocationStrategy.PROPORTIONAL_SUBTOTAL,
        onChangeShippingAllocation: noop,
        roundingMode: RoundingMode.NONE,
        onChangeRoundingMode: noop,
        roundingStep: 1000,
        onChangeRoundingStep: noop,
        customerNotes: '',
        onChangeCustomerNotes: noop,
        internalNotes: '',
        onChangeInternalNotes: noop,
        versionChangeNote: '',
        onChangeVersionChangeNote: noop,
        draftLines: [EMPTY_DRAFT_LINE(1)],
        setDraftLines: noop,
        onSelectCatalogItem: noop,
        livePricingResult: {
          calc: null,
          customerPdf: null,
          error: 'incomplete',
        },
        onResetNewQuote: noop,
        onSaveQuote: noop,
        onDownloadLivePdf: noop,
        onOpenLivePreview: noop,
        onQuickCreateCustomer: async () => null,
      }),
    );

    assert.equal(
      formatSelectedPrintCustomerLabel(SAMPLE_CUSTOMERS[0]),
      'Chị Lan (Spa Hoa Hồng) — 0909 123 456',
    );
    assert.match(selectedHtml, /Chị Lan \(Spa Hoa Hồng\) — 0909 123 456/);
    assert.match(selectedHtml, /data-testid="pq-customer-clear-btn"/);
  });

  it('supports interactive name/phone search, clear, quick-add phone prefill, desktop alignment & 320px zero-overflow in real Chrome', async () => {
    const server = startDistServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    let browser;
    try {
      browser = await chromium.launch({ channel: 'chrome', headless: true });
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: 'light',
      });

      await ctx.route('**/api/v1/**', async (route) => {
        const u = new URL(route.request().url());
        const p = u.pathname;
        if (p === '/api/v1/auth/me') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                user: {
                  id: '11111111-1111-4111-8111-111111111111',
                  username: 'owner_hp',
                  full_name: 'Trương Hoài Phương',
                  email: 'truhoaiphuong03@gmail.com',
                  email_verified: true,
                  phone: '0901234567',
                },
                active_workspace: {
                  id: '22222222-2222-4222-8222-222222222222',
                  name: 'Hoài Phương Media',
                  role: 'owner',
                  permissions: [],
                },
                csrf_token: 'csrf-cust-search-token',
              },
            }),
          });
        }
        if (p === '/api/v1/print-quotes/customers') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: { items: SAMPLE_CUSTOMERS },
            }),
          });
        }
        if (p === '/api/v1/print-quotes/stats') {
          return route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              data: {
                total_quotes: 0,
                total_orders: 0,
                expected_revenue: 0,
                expected_profit: 0,
                total_receivable: 0,
              },
            }),
          });
        }
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            data: {
              items: [],
              quotes: [],
              orders: [],
              summaries: [],
              entries: [],
              logs: [],
              issues: [],
              shifts: [],
            },
          }),
        });
      });

      const page = await ctx.newPage();
      await page.goto(`${baseUrl}/print-quotes/new`, {
        waitUntil: 'networkidle',
      });

      const searchInput = page.locator(
        '[data-testid="pq-customer-search-input"]',
      );
      const titleInput = page.locator('[data-testid="pq-title-input"]');
      await searchInput.waitFor({ state: 'visible' });

      // 1. Desktop vertical alignment with "Tên báo giá" input
      const [custBox, titleBox] = await Promise.all([
        searchInput.boundingBox(),
        titleInput.boundingBox(),
      ]);
      assert.ok(custBox && titleBox);
      assert.ok(
        Math.abs(custBox.y - titleBox.y) <= 1,
        `Expected customer input y (${custBox.y}) to align with title input y (${titleBox.y})`,
      );
      assert.ok(
        Math.abs(custBox.height - titleBox.height) <= 1,
        `Expected customer input height (${custBox.height}) to match title input height (${titleBox.height})`,
      );

      // 2. Search by unaccented Vietnamese name: "duong" -> "Dương Hoàng" (+84 918 888 999)
      await searchInput.click();
      await searchInput.fill('duong');
      const listbox = page.locator('[data-testid="pq-customer-listbox"]');
      await listbox.waitFor({ state: 'visible' });
      const optCust2 = page.locator(
        '[data-testid="pq-customer-option-cust-2"]',
      );
      await optCust2.waitFor({ state: 'visible' });
      assert.equal(
        await page.locator('[data-testid="pq-customer-option-cust-1"]').count(),
        0,
      );
      assert.match(await optCust2.innerText(), /Dương Hoàng/);
      assert.match(await optCust2.innerText(), /\+84 918 888 999/);

      // 3. Search by phone number ("0909123") and select via Enter key
      await searchInput.fill('0909123');
      const optCust1 = page.locator(
        '[data-testid="pq-customer-option-cust-1"]',
      );
      await optCust1.waitFor({ state: 'visible' });
      await searchInput.press('Enter');
      assert.equal(
        await searchInput.inputValue(),
        'Chị Lan (Spa Hoa Hồng) — 0909 123 456',
      );

      // 4. Clear back to walk-in ("Khách lẻ")
      await page.locator('[data-testid="pq-customer-clear-btn"]').click();
      assert.equal(await searchInput.inputValue(), '');

      // 5. Unknown phone query offers 1-click quick-add with phone pre-filled
      await searchInput.fill('0933777888');
      await page
        .locator('[data-testid="pq-customer-no-results"]')
        .waitFor({ state: 'visible' });
      await page
        .locator('[data-testid="pq-customer-search-quick-add"]')
        .click();
      await page
        .locator('[data-testid="pq-quick-customer-dialog"]')
        .waitFor({ state: 'visible' });
      assert.equal(
        await page.locator('[data-testid="pq-quick-cust-phone"]').inputValue(),
        '0933777888',
      );
      await page.keyboard.press('Escape');

      // 6. Mobile 320px zero horizontal overflow in both light and dark themes (even with dropdown open)
      await page.setViewportSize({ width: 320, height: 640 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate((t) => {
          localStorage.setItem('mglite_theme', t);
          document.documentElement.setAttribute('data-theme', t);
        }, theme);
        await searchInput.click();
        await searchInput.fill('0987');
        await page
          .locator('[data-testid="pq-customer-option-cust-3"]')
          .waitFor({ state: 'visible' });
        const overflowPx = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        assert.ok(
          overflowPx <= 0,
          `Expected 0 horizontal overflow on 320px (${theme}), got ${overflowPx}px`,
        );
      }
    } finally {
      if (browser) await browser.close();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
