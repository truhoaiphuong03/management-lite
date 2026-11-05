import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import {
  findChromeBinary,
  installScriptWatchdog,
  withIsolatedViteDevServer,
} from '../../scripts/qa-chrome-harness.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

function buildMockReport(index, emp) {
  const day = String(((index - 1) % 28) + 1).padStart(2, '0');
  return {
    id: `rep-qa-${String(index).padStart(3, '0')}`,
    workspace_id: 'ws-reports-qa',
    employee_id: emp.id,
    employee_code: emp.employee_code,
    employee_name: emp.full_name,
    report_date: `2026-10-${day}`,
    status: index % 4 === 0 ? 'draft' : 'submitted',
    current_revision: 1,
    total_reported_count: index * 3,
    entries_count: 2,
    notes: `Ghi chú báo cáo tiến độ số #${index} của ${emp.full_name}`,
    submitted_at:
      index % 4 === 0
        ? null
        : `2026-10-${day}T10:${String(index % 60).padStart(2, '0')}:00.000Z`,
    created_at: `2026-10-${day}T09:00:00.000Z`,
    updated_at: `2026-10-${day}T10:00:00.000Z`,
  };
}

test(
  'REPORTS-BY-EMPLOYEE QA (>25 reports): Cursor load-more, dedup, isLoadingMore, error/retry, desktop/mobile & Owner/Staff RBAC',
  { timeout: 90_000 },
  async (t) => {
    const chromeBin = findChromeBinary();
    if (!chromeBin) {
      t.skip('Headless Chrome/Edge binary not found on host');
      return;
    }

    const employees = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        employee_code: 'NV001',
        full_name: 'Nguyễn Văn An',
        status: 'active',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        employee_code: 'NV002',
        full_name: 'Trần Thị Bình',
        status: 'active',
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        employee_code: 'NV003',
        full_name: 'Lê Hoàng Cường',
        status: 'active',
      },
    ];

    // Page 1: 28 unique reports (> 25 threshold): 12 for NV001, 10 for NV002, 6 for NV003
    const page1Items = [];
    for (let i = 1; i <= 12; i++)
      page1Items.push(buildMockReport(i, employees[0]));
    for (let i = 13; i <= 22; i++)
      page1Items.push(buildMockReport(i, employees[1]));
    for (let i = 23; i <= 28; i++)
      page1Items.push(buildMockReport(i, employees[2]));

    // Page 2: 9 items = 2 duplicate IDs from Page 1 (rep-qa-012, rep-qa-022) + 7 brand-new reports (29..35)
    // Expected final unique count = 28 + 7 = 35 (15 NV001, 12 NV002, 8 NV003)
    const page2Items = [
      page1Items[11], // duplicate rep-qa-012
      page1Items[21], // duplicate rep-qa-022
      buildMockReport(29, employees[0]),
      buildMockReport(30, employees[0]),
      buildMockReport(31, employees[0]),
      buildMockReport(32, employees[1]),
      buildMockReport(33, employees[1]),
      buildMockReport(34, employees[2]),
      buildMockReport(35, employees[2]),
    ];

    const clearWatchdog = installScriptWatchdog(
      'reports-by-employee-qa',
      90_000,
    );
    try {
      await withIsolatedViteDevServer(root, async (webBase) => {
        const browser = await chromium.launch({
          executablePath: chromeBin,
          headless: true,
        });
        try {
          await t.test(
            '1. Owner by_employee (>25 reports): Page 1, desktop/mobile layout, isLoadingMore, HTTP 500 + network error & retry, zero data loss / zero duplicates',
            async () => {
              const context = await browser.newContext({
                viewport: { width: 1280, height: 800 },
              });
              await context.addInitScript(() => {
                window.sessionStorage.setItem(
                  'mglite_phone_prompt_dismissed',
                  '1',
                );
              });
              const page = await context.newPage();

              let page2Attempt = 0;
              let releaseInFlightPage2 = null;
              let markInFlightReached = null;
              const inFlightReachedPromise = new Promise((res) => {
                markInFlightReached = res;
              });

              await page.route('**/api/v1/**', async (route) => {
                const url = new URL(route.request().url());
                const path = url.pathname;

                if (path === '/api/v1/auth/me') {
                  await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                      success: true,
                      data: {
                        user: {
                          id: 'owner-qa-id',
                          username: 'owner',
                          full_name: 'Owner QA',
                          phone_number: '0901234567',
                        },
                        active_workspace: {
                          id: 'ws-reports-qa',
                          name: 'Hoài Phương Media',
                          role: 'owner',
                          permissions: [],
                        },
                        csrf_token: 'csrf-reports-qa-token',
                      },
                    }),
                  });
                  return;
                }

                if (path === '/api/v1/employees') {
                  await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                      success: true,
                      data: { items: employees, next_cursor: null },
                    }),
                  });
                  return;
                }

                if (path === '/api/v1/reports/me') {
                  await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                      success: true,
                      data: { items: [], next_cursor: null },
                    }),
                  });
                  return;
                }

                if (path === '/api/v1/reports/daily') {
                  const cursor = url.searchParams.get('cursor');
                  if (!cursor) {
                    await route.fulfill({
                      status: 200,
                      contentType: 'application/json',
                      body: JSON.stringify({
                        success: true,
                        data: {
                          items: page1Items,
                          next_cursor: 'cursor-page-2',
                        },
                      }),
                    });
                    return;
                  }

                  assert.equal(
                    cursor,
                    'cursor-page-2',
                    'Load-more must pass exact cursor-page-2',
                  );
                  page2Attempt++;

                  if (page2Attempt === 1) {
                    // Hold in-flight until test verifies isLoadingMore state, then fail with HTTP 500
                    markInFlightReached();
                    await new Promise((res) => {
                      releaseInFlightPage2 = res;
                    });
                    await route.fulfill({
                      status: 500,
                      contentType: 'application/json',
                      body: JSON.stringify({
                        success: false,
                        error: {
                          code: 'INTERNAL_ERROR',
                          message: 'Server error',
                        },
                      }),
                    });
                    return;
                  }

                  if (page2Attempt === 2) {
                    // Fail with network drop on 2nd attempt
                    await route.abort('internetdisconnected');
                    return;
                  }

                  // 3rd attempt ("Thử lại"): succeed with 2 duplicates + 7 new items and next_cursor: null
                  await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                      success: true,
                      data: {
                        items: page2Items,
                        next_cursor: null,
                      },
                    }),
                  });
                  return;
                }

                await route.fulfill({
                  status: 200,
                  contentType: 'application/json',
                  body: JSON.stringify({ success: true, data: { items: [] } }),
                });
              });

              try {
                await page.goto(`${webBase}/reports`, {
                  waitUntil: 'domcontentloaded',
                });
                await page.waitForSelector(
                  '[data-testid="reports-grouped-by-employee"]',
                  { timeout: 15_000 },
                );

                // Verify Page 1 (>25 reports = 28 items) grouped across 3 employee cards
                const footerInfo = page.locator('.list-footer-info');
                await footerInfo.waitFor({ state: 'visible' });
                assert.equal(
                  (await footerInfo.textContent())?.trim(),
                  'Đang hiển thị 28 mục',
                  'Page 1 must display all 28 reports in ListFooter counter',
                );

                const loadMoreBtn = page.locator(
                  '[data-testid="btn-load-more"]',
                );
                assert.equal(await loadMoreBtn.isVisible(), true);
                assert.equal(
                  (await loadMoreBtn.textContent())?.trim(),
                  'Tải thêm báo cáo',
                );

                // Verify NV001 card shows 12 reports total, collapsed to 5 with expand toggle for 7 hidden reports
                const groupText = await page
                  .locator('[data-testid="reports-grouped-by-employee"]')
                  .textContent();
                assert.match(groupText || '', /Nguyễn Văn An/);
                assert.match(groupText || '', /Trần Thị Bình/);
                assert.match(groupText || '', /Lê Hoàng Cường/);
                assert.match(
                  groupText || '',
                  /Xem thêm 7 báo cáo/,
                  'NV001 (12 reports) must collapse to 5 and offer expand button for 7 remaining reports',
                );

                // Check Desktop (1280x800) zero horizontal overflow
                const desktopOverflow = await page.evaluate(
                  () =>
                    document.documentElement.scrollWidth >
                    document.documentElement.clientWidth,
                );
                assert.equal(
                  desktopOverflow,
                  false,
                  'Desktop 1280px by_employee view must not overflow horizontally',
                );

                // Check Mobile (375x812) zero horizontal overflow & footer visibility
                await page.setViewportSize({ width: 375, height: 812 });
                await page.waitForTimeout(150);
                const mobileOverflow = await page.evaluate(
                  () =>
                    document.documentElement.scrollWidth >
                    document.documentElement.clientWidth,
                );
                assert.equal(
                  mobileOverflow,
                  false,
                  'Mobile 375px by_employee view must not overflow horizontally',
                );
                assert.equal(
                  await loadMoreBtn.isVisible(),
                  true,
                  'Load-more button must remain accessible on Mobile 375px viewport',
                );

                // Restore Desktop viewport and trigger Attempt 1 (held in-flight -> check isLoadingMore -> HTTP 500)
                await page.setViewportSize({ width: 1280, height: 800 });
                await loadMoreBtn.click();
                await inFlightReachedPromise;

                assert.equal(
                  await loadMoreBtn.isDisabled(),
                  true,
                  'Load-more button must be disabled while isLoadingMore is true',
                );
                assert.match(
                  (await loadMoreBtn.textContent()) || '',
                  /Đang tải/,
                  'Load-more button must display loading text while request is in-flight',
                );

                // Release Attempt 1 -> HTTP 500
                releaseInFlightPage2();

                const footerAlert = page
                  .locator('footer[aria-label="Điều hướng danh sách"]')
                  .locator('[role="alert"]');
                await footerAlert.waitFor({
                  state: 'visible',
                  timeout: 10_000,
                });
                assert.match(
                  (await footerAlert.textContent()) || '',
                  /HTTP 500/,
                  'ListFooter must surface HTTP 500 load-more error',
                );
                assert.equal(
                  (await footerInfo.textContent())?.trim(),
                  'Đang hiển thị 28 mục',
                  'Existing 28 Page 1 reports must remain intact on HTTP 500 failure',
                );

                const retryBtn = footerAlert.locator('button', {
                  hasText: 'Thử lại',
                });
                assert.equal(await retryBtn.isVisible(), true);
                const retryBox = await retryBtn.boundingBox();
                assert.ok(
                  retryBox && retryBox.height >= 44 && retryBox.width >= 44,
                  'Retry button must meet 44x44px touch target minimum',
                );

                // Trigger Attempt 2 via "Thử lại" -> Network error
                await retryBtn.click();
                await page.waitForFunction(
                  () =>
                    document
                      .querySelector(
                        'footer[aria-label="Điều hướng danh sách"] [role="alert"]',
                      )
                      ?.textContent?.includes('Không thể kết nối máy chủ'),
                  null,
                  { timeout: 10_000 },
                );
                assert.equal(
                  (await footerInfo.textContent())?.trim(),
                  'Đang hiển thị 28 mục',
                  'Existing 28 Page 1 reports must remain intact on network failure',
                );

                // Trigger Attempt 3 via "Thử lại" -> 200 OK (2 duplicates + 7 new = 35 unique, next_cursor: null)
                await retryBtn.click();
                await page.waitForFunction(
                  () =>
                    document
                      .querySelector('.list-footer-info')
                      ?.textContent?.trim() === 'Đang hiển thị 35 mục',
                  null,
                  { timeout: 10_000 },
                );

                assert.equal(
                  await footerAlert.count(),
                  0,
                  'Error alert must clear after successful retry',
                );
                assert.equal(
                  await loadMoreBtn.count(),
                  0,
                  'Load-more button must hide when next_cursor becomes null',
                );

                // Expand NV001 card and verify 15 unique items (12 Page 1 + 3 new, rep-qa-012 NOT duplicated)
                const nv1ExpandBtn = page.locator('button', {
                  hasText: 'Xem thêm 10 báo cáo',
                });
                await nv1ExpandBtn.waitFor({ state: 'visible' });
                await nv1ExpandBtn.click();

                const allRenderedNotes = await page
                  .locator('[data-testid="reports-grouped-by-employee"]')
                  .textContent();
                const occurrencesOf012 = (
                  allRenderedNotes?.match(/Ghi chú báo cáo tiến độ số #12 /g) ||
                  []
                ).length;
                assert.equal(
                  occurrencesOf012,
                  1,
                  'Duplicate report rep-qa-012 across cursor pages must appear strictly once',
                );
                assert.match(
                  allRenderedNotes || '',
                  /Ghi chú báo cáo tiến độ số #31 /,
                  'Newly loaded Page 2 report #31 for NV001 must render after expanding',
                );
              } finally {
                await context.close();
              }
            },
          );

          await t.test(
            '2. Staff RBAC on /reports: Cannot access all_reports / by_employee or trigger /api/v1/reports/daily',
            async () => {
              const context = await browser.newContext({
                viewport: { width: 390, height: 844 },
              });
              await context.addInitScript(() => {
                window.sessionStorage.setItem(
                  'mglite_phone_prompt_dismissed',
                  '1',
                );
              });
              const page = await context.newPage();

              const forbiddenOwnerCalls = [];
              const staffReports = [
                buildMockReport(1, employees[0]),
                buildMockReport(2, employees[0]),
              ];

              await page.route('**/api/v1/**', async (route) => {
                const url = new URL(route.request().url());
                const path = url.pathname;

                if (
                  path === '/api/v1/reports/daily' ||
                  path === '/api/v1/employees'
                ) {
                  forbiddenOwnerCalls.push(path);
                  await route.fulfill({
                    status: 403,
                    body: '{"success":false}',
                  });
                  return;
                }

                if (path === '/api/v1/auth/me') {
                  await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                      success: true,
                      data: {
                        user: {
                          id: employees[0].id,
                          username: 'nv001',
                          full_name: employees[0].full_name,
                          phone_number: '0901234567',
                        },
                        active_workspace: {
                          id: 'ws-reports-qa',
                          name: 'Hoài Phương Media',
                          role: 'staff',
                          permissions: [],
                        },
                        csrf_token: 'csrf-staff-qa-token',
                      },
                    }),
                  });
                  return;
                }

                if (path === '/api/v1/reports/me') {
                  await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    body: JSON.stringify({
                      success: true,
                      data: { items: staffReports, next_cursor: null },
                    }),
                  });
                  return;
                }

                await route.fulfill({
                  status: 200,
                  contentType: 'application/json',
                  body: JSON.stringify({ success: true, data: { items: [] } }),
                });
              });

              try {
                await page.goto(`${webBase}/reports`, {
                  waitUntil: 'domcontentloaded',
                });
                await page.waitForSelector('.list-footer-info', {
                  timeout: 15_000,
                });

                assert.equal(
                  (await page.textContent('.list-footer-info'))?.trim(),
                  'Đang hiển thị 2 mục',
                  'Staff user must see their own 2 reports',
                );
                assert.equal(
                  await page
                    .locator('[data-testid="reports-owner-toolbar"]')
                    .count(),
                  0,
                  'Owner filter/view-mode toolbar must NOT render for Staff',
                );
                assert.equal(
                  await page
                    .locator('[data-testid="reports-grouped-by-employee"]')
                    .count(),
                  0,
                  'Owner by_employee view must NOT render for Staff',
                );
                assert.equal(
                  await page
                    .locator('button', { hasText: 'Tất cả báo cáo' })
                    .count(),
                  0,
                  'All-reports tab button must NOT render for Staff',
                );
                assert.deepEqual(
                  forbiddenOwnerCalls,
                  [],
                  'Staff session must never call Owner /api/v1/reports/daily or /api/v1/employees',
                );
              } finally {
                await context.close();
              }
            },
          );
        } finally {
          await browser.close().catch(() => {});
        }
      });
    } finally {
      clearWatchdog();
    }
  },
);
