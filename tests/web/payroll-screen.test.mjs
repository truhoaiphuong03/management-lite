import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('V0.2 PAY-01: web route registry, navigation, and PayrollScreen business rules', async () => {
  const { ROUTE_REGISTRY } = await import(
    `file://${resolve(root, 'dist/apps/web/src/types.js')}`
  );
  const { NAV_ITEMS } = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/Navigation.js')}`
  );
  const { matchRoute } = await import(
    `file://${resolve(root, 'dist/apps/web/src/router.js')}`
  );

  // 1. Verify /payroll route in registry
  const payrollRoute = ROUTE_REGISTRY['/payroll'];
  assert.ok(payrollRoute, 'Payroll route must exist in ROUTE_REGISTRY');
  assert.equal(payrollRoute.id, 'UI14');
  assert.equal(payrollRoute.title, 'Bảng lương tổng quan');
  assert.equal(
    payrollRoute.implemented,
    true,
    'Payroll screen is fully implemented',
  );
  assert.equal(payrollRoute.category, 'payroll');
  assert.equal(payrollRoute.ownerOnly, true, 'Payroll is Owner only');

  // 2. Verify /my-pay route in registry
  const myPayRoute = ROUTE_REGISTRY['/my-pay'];
  assert.ok(myPayRoute, 'My-pay route must exist in ROUTE_REGISTRY');
  assert.equal(myPayRoute.id, 'UI16');
  assert.equal(myPayRoute.title, 'Lương cá nhân của tôi');
  assert.equal(
    myPayRoute.implemented,
    true,
    'My-pay screen is fully implemented',
  );
  assert.equal(myPayRoute.category, 'payroll');
  assert.equal(myPayRoute.staffOnly, true, 'My-pay is Staff only');

  // 3. Verify router matching
  const matchPayroll = matchRoute('/payroll');
  assert.equal(matchPayroll.route?.id, 'UI14');
  assert.equal(matchPayroll.isExact, true);

  const matchPayrollTrailing = matchRoute('/payroll/');
  assert.equal(matchPayrollTrailing.route?.id, 'UI14');
  assert.equal(matchPayrollTrailing.isExact, true);

  const matchMyPay = matchRoute('/my-pay');
  assert.equal(matchMyPay.route?.id, 'UI16');
  assert.equal(matchMyPay.isExact, true);

  const matchMyPayTrailing = matchRoute('/my-pay/');
  assert.equal(matchMyPayTrailing.route?.id, 'UI16');
  assert.equal(matchMyPayTrailing.isExact, true);

  // 4. Verify NAV_ITEMS
  const payrollNav = NAV_ITEMS.find((item) => item.id === 'payroll');
  assert.ok(payrollNav, 'Payroll item must exist in NAV_ITEMS');
  assert.equal(payrollNav.path, '/payroll');
  assert.equal(payrollNav.ownerOnly, true);

  const myPayNav = NAV_ITEMS.find((item) => item.id === 'my-pay');
  assert.ok(myPayNav, 'My-pay item must exist in NAV_ITEMS');
  assert.equal(myPayNav.path, '/my-pay');
  assert.equal(myPayNav.staffOnly, true);

  // 5. Desktop Sidebar role filtering
  const ownerVisible = NAV_ITEMS.filter((item) => {
    if (item.staffOnly || item.id === 'my-pay') return false;
    return true;
  });
  assert.ok(
    ownerVisible.some((i) => i.id === 'payroll'),
    'Owner sees payroll in DesktopSidebar',
  );
  assert.ok(
    !ownerVisible.some((i) => i.id === 'my-pay'),
    'Owner does NOT see my-pay (PAY-025)',
  );

  const staffVisible = NAV_ITEMS.filter((item) => {
    if (item.ownerOnly) return false;
    return true;
  });
  assert.ok(
    staffVisible.some((i) => i.id === 'my-pay'),
    'Staff sees my-pay in DesktopSidebar',
  );
  assert.ok(
    !staffVisible.some((i) => i.id === 'payroll'),
    'Staff does NOT see payroll management in DesktopSidebar',
  );

  // 6. Verify PayrollScreen implementation details
  const screenContent = readFileSync(
    resolve(root, 'apps/web/src/screens/PayrollScreen.tsx'),
    'utf8',
  );

  // Verifies 3 income tiers
  assert.ok(
    screenContent.includes('1. ĐÃ DUYỆT (CONFIRMED)') ||
      screenContent.includes('1. THU NHẬP ĐÃ DUYỆT (CONFIRMED)'),
    'Must display Tier 1 Confirmed earnings',
  );
  assert.ok(
    screenContent.includes('2. CHỜ DUYỆT (PENDING)') ||
      screenContent.includes('2. CA CHỜ DUYỆT (PENDING REVIEW)'),
    'Must display Tier 2 Pending-review earnings',
  );
  assert.ok(
    screenContent.includes('3. CA HIỆN TẠI (LIVE)') ||
      screenContent.includes('3. CA ĐANG CHẠY (LIVE PROVISIONAL)'),
    'Must display Tier 3 Live provisional earnings',
  );

  // Verifies policy & guards
  assert.ok(
    screenContent.includes('POLICY-01'),
    'Must implement and reference POLICY-01 daily rounding rules',
  );
  assert.ok(
    screenContent.includes('OVERPAYMENT_BLOCKED') ||
      screenContent.includes('vượt quá số tiền còn lại'),
    'Must enforce overpayment guard',
  );
  assert.ok(
    screenContent.includes('If-Match'),
    'Must include If-Match optimistic concurrency headers',
  );

  // 7. Verify API-PAY-06: POST /api/v1/payroll/periods/:month/adjustments
  assert.ok(
    screenContent.includes(
      '/api/v1/payroll/periods/${selectedMonth}/adjustments',
    ),
    'Must call locked API-PAY-06 endpoint /adjustments',
  );
  assert.ok(
    !screenContent.includes(
      '/api/v1/payroll/periods/${selectedMonth}/paid-leaves',
    ),
    'Must NOT call old /paid-leaves endpoint',
  );
  assert.ok(
    screenContent.includes("adjustment_type: 'paid_leave'"),
    'Must set adjustment_type to paid_leave in payload',
  );
  assert.ok(
    screenContent.includes('X-CSRF-Token'),
    'Must send X-CSRF-Token on mutating requests',
  );
  // 8. Verify /hourly-rates endpoint is used
  assert.ok(
    screenContent.includes('/api/v1/payroll/hourly-rates'),
    'Must use /api/v1/payroll/hourly-rates for hourly rate configuration',
  );

  // 9. Verify Idempotency-Key for finalize and disbursement
  assert.ok(
    screenContent.includes('Idempotency-Key'),
    'Must send Idempotency-Key for finalize and disbursement',
  );
  assert.ok(
    screenContent.includes('finalizeIdempotencyKey'),
    'Must track finalizeIdempotencyKey state',
  );
  assert.ok(
    screenContent.includes('disburseIdempotencyKey'),
    'Must track disburseIdempotencyKey state',
  );

  // 10. Verify disbursement requires finalized status (cannot disburse draft)
  assert.ok(
    screenContent.includes("period?.status !== 'finalized'") ||
      screenContent.includes("period?.status === 'finalized'"),
    'Must guard disbursement to finalized periods only',
  );
});

test('V0.2 PAY-01: adjustment contract scope guard - paid_leave only', () => {
  const contractContent = readFileSync(
    resolve(root, 'packages/contracts/src/payroll.ts'),
    'utf8',
  );

  // 1. PayrollAdjustmentType is strictly 'paid_leave'
  assert.match(
    contractContent,
    /export type PayrollAdjustmentType\s*=\s*'paid_leave';/,
    'PayrollAdjustmentType must be strictly paid_leave',
  );

  // 2. Must NOT include bonus, allowance, or deduction
  assert.ok(
    !contractContent.includes("'bonus'"),
    'Must not permit bonus in contract',
  );
  assert.ok(
    !contractContent.includes("'allowance'"),
    'Must not permit allowance in contract',
  );
  assert.ok(
    !contractContent.includes("'deduction'"),
    'Must not permit deduction in contract',
  );

  // 3. CreateAdjustmentRequest must use PayrollAdjustmentType
  assert.match(
    contractContent,
    /adjustment_type:\s*PayrollAdjustmentType;/,
    'CreateAdjustmentRequest must use PayrollAdjustmentType',
  );

  // 4. No unused alias types remain
  assert.ok(
    !contractContent.includes('PayrollPaidLeaveData'),
    'Unused alias PayrollPaidLeaveData must be removed',
  );
  assert.ok(
    !contractContent.includes('CreatePaidLeaveRequest'),
    'Unused alias CreatePaidLeaveRequest must be removed',
  );
});

test('V0.2 PAY-INTEGRATION-01: DTO sync and contract semantics', () => {
  const contractContent = readFileSync(
    resolve(root, 'packages/contracts/src/payroll.ts'),
    'utf8',
  );
  const screenContent = readFileSync(
    resolve(root, 'apps/web/src/screens/PayrollScreen.tsx'),
    'utf8',
  );

  // 1. PayrollEmployeeItemData.hourly_rate_vnd = number | null
  assert.match(
    contractContent,
    /hourly_rate_vnd:\s*number\s*\|\s*null;/,
    'PayrollEmployeeItemData must define hourly_rate_vnd as number | null',
  );

  // 2. PayrollPeriodData.id = string | null (virtual draft has null id)
  assert.match(
    contractContent,
    /id:\s*string\s*\|\s*null;/,
    'PayrollPeriodData must define id as string | null for virtual draft support',
  );

  // 3. Screen safely renders "Chưa thiết lập" when hourly_rate_vnd is null/missing
  assert.ok(
    screenContent.includes('Chưa thiết lập'),
    'PayrollScreen must render "Chưa thiết lập" when hourly_rate_vnd is missing or null',
  );

  // 4. Virtual draft state is distinguished
  assert.ok(
    screenContent.includes('period.id === null'),
    'PayrollScreen must distinguish virtual draft (id === null) from finalized periods',
  );

  // 5. If-Match header is sent on adjustments
  assert.ok(
    screenContent.includes('\'If-Match\': `"${period?.version ?? 1}"`'),
    'PayrollScreen must send If-Match header on adjustments',
  );

  // 6. Close modal helpers reset idempotency keys
  assert.ok(
    screenContent.includes('closeFinalizeModal'),
    'PayrollScreen must have closeFinalizeModal helper',
  );
  assert.ok(
    screenContent.includes('closeDisburseModal'),
    'PayrollScreen must have closeDisburseModal helper',
  );
});

test('UI: PayrollScreen uses shared ActionIconButton and client-side Pagination', async () => {
  const screen = readFileSync(
    resolve(root, 'apps/web/src/screens/PayrollScreen.tsx'),
    'utf8',
  );
  assert.ok(screen.includes('<ActionIconButton'));
  assert.ok(screen.includes('<Pagination'));
  assert.ok(screen.includes('pagedItems.map'));
  // Primary actions/testids stay
  assert.ok(screen.includes('btn-disburse-'));
  assert.ok(screen.includes('aggregateMetrics'));

  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const ui = await import(
    `file://${resolve(root, 'dist/packages/ui/src/components/index.js')}`
  );
  const html = renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      ...['view', 'edit'].map((a) =>
        React.createElement(ui.ActionIconButton, {
          key: a,
          action: a,
          target: 'NV01',
        }),
      ),
      React.createElement(ui.Pagination, {
        testId: 'payroll-items-pagination',
        total: 45,
        page: 0,
        pageSize: 20,
        onPage: () => {},
        onPageSize: () => {},
      }),
    ),
  );
  for (const l of ['Xem chi tiết', 'Sửa']) {
    assert.ok(html.includes(`aria-label="${l}: NV01"`), l);
    assert.ok(html.includes(`title="${l}"`), l);
  }
  assert.ok(html.includes('data-testid="payroll-items-pagination-next"'));
  assert.ok(html.includes('Trang 1 / 3'));
});

test('ACCEPTANCE PAY-003 -> PAY-007: Staff payslip, Owner lockout, Clocked hours, Adjustments, Finalize & Payout', async () => {
  const screen = readFileSync(
    resolve(root, 'apps/web/src/screens/PayrollScreen.tsx'),
    'utf8',
  );

  // PAY-003: Staff personal payslip view
  assert.ok(
    screen.includes('data-testid="staff-payslip"'),
    'Must render staff-payslip container for personal payslip',
  );
  assert.ok(
    screen.includes('data-testid="staff-net-pay"'),
    'Must render staff-net-pay for total take-home pay',
  );
  assert.ok(
    screen.includes('/api/v1/payroll/periods/${targetMonth}/me'),
    'Must fetch personal payslip from /me endpoint for staff',
  );

  // PAY-004: Owner lockout from staff personal payslip (C04)
  const service = readFileSync(
    resolve(root, 'apps/api/src/payroll/service.ts'),
    'utf8',
  );
  assert.ok(
    service.includes("fail('FORBIDDEN', 'Not payroll eligible', 403)"),
    'Backend must reject Owner accounts from personal payslip /me with 403 Not payroll eligible',
  );

  // PAY-005: Clocked hours aggregated into payroll
  assert.ok(
    screen.includes('data-testid="staff-approved-hours"'),
    'Must render staff-approved-hours for aggregated clocked minutes',
  );
  assert.ok(
    screen.includes('approved_worked_minutes'),
    'Must aggregate and display approved_worked_minutes',
  );

  // PAY-006: Payroll adjustments restricted to paid_leave
  assert.ok(
    screen.includes('data-testid="adjustment-modal"'),
    'Must render adjustment-modal dialog',
  );
  assert.ok(
    screen.includes('data-testid="adjustment-amount-input"'),
    'Must render adjustment-amount-input',
  );
  assert.ok(
    screen.includes('data-testid="adjustment-reason-input"'),
    'Must render adjustment-reason-input',
  );
  assert.ok(
    screen.includes('data-testid="adjustment-submit-btn"'),
    'Must render adjustment-submit-btn',
  );
  assert.ok(
    screen.includes("adjustment_type: 'paid_leave'"),
    'Must restrict adjustments to paid_leave type only',
  );

  // PAY-007: Finalize payroll period & payout disbursement
  assert.ok(
    screen.includes('data-testid="btn-finalize-period"'),
    'Must render btn-finalize-period button',
  );
  assert.ok(
    screen.includes('data-testid="finalize-modal"'),
    'Must render finalize-modal dialog',
  );
  assert.ok(
    screen.includes('data-testid="finalize-submit-btn"'),
    'Must render finalize-submit-btn',
  );
  assert.ok(
    screen.includes('/api/v1/payroll/periods/${selectedMonth}/finalize'),
    'Must call finalize endpoint with If-Match',
  );
  assert.ok(
    screen.includes('data-testid="disburse-submit-btn"'),
    'Must render disburse-submit-btn for payout',
  );
  assert.ok(
    screen.includes(
      '/api/v1/payroll/items/${disburseEmployee.id}/disbursements',
    ),
    'Must call disbursements payout endpoint',
  );
});

/* -------------------------------------------------------------------------- */
/* MOUNTED COMPONENT REGRESSIONS: PAYROLL IDEMPOTENCY & LOGICAL OPERATIONS   */
/* -------------------------------------------------------------------------- */

test('Mounted PAY: retry after lost response preserves logical-operation key', async () => {
  const { installFakeDom } = await import('./helpers/fake-dom.mjs');
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { PayrollScreen } = await import(
    `file://${resolve(root, 'dist/apps/web/src/screens/PayrollScreen.js')}`
  );

  const dom = installFakeDom();
  const sent = [];
  const item = {
    id: 'pay1',
    employee_id: 'emp1',
    employee_code: 'QA01',
    full_name: 'Synthetic Staff',
    hourly_rate_vnd: 40000,
    total_hours: 160,
    gross_pay_vnd: 6400000,
    net_pay_vnd: 6400000,
    confirmed: { net_pay_vnd: 6400000, paid_amount_vnd: 0 },
    work_shifts: [],
    adjustments: [],
    paid_leaves: [],
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (url.includes('/adjustments')) {
      sent.push({ key: opts.headers['Idempotency-Key'], body: opts.body });
      throw new Error('Synthetic lost response after server commit');
    }
    if (url.includes('/auth/me'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            csrf_token: 'synthetic-csrf',
            user: { id: 'u1' },
            active_workspace: { id: 'w1', role: 'owner' },
          },
        }),
      };
    if (url.includes('/payroll/periods'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            period: { id: 'p1', month: '2026-10', status: 'draft', version: 1 },
            items: [item],
          },
        }),
      };
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { items: [] } }),
    };
  };

  const c = dom.container();
  const rootEl = createRoot(c);
  const byId = (id) =>
    dom.find(c, (n) => dom.props(n)['data-testid'] === id)[0];

  try {
    await act(async () =>
      rootEl.render(
        React.createElement(PayrollScreen, {
          role: 'owner',
          onNavigate: () => {},
        }),
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });

    await act(async () => dom.props(byId('btn-add-adjustment-emp1')).onClick());
    await act(async () =>
      dom.props(byId('adjustment-reason-input')).onChange({
        target: { value: 'Synthetic paid leave' },
      }),
    );
    await act(async () => dom.props(byId('adjustment-submit-btn')).onClick());
    await act(async () => dom.props(byId('adjustment-submit-btn')).onClick());

    assert.equal(sent.length, 2);
    assert.equal(sent[0].body, sent[1].body);
    assert.equal(
      sent[0].key,
      sent[1].key,
      'Same pending logical operation must reuse key on retry after lost response',
    );
  } finally {
    globalThis.fetch = originalFetch;
    await act(async () => rootEl.unmount());
  }
});

test('Mounted PAY: changing form payload while previous operation is unresolved warns user and blocks silent mutation', async () => {
  const { installFakeDom } = await import('./helpers/fake-dom.mjs');
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { PayrollScreen } = await import(
    `file://${resolve(root, 'dist/apps/web/src/screens/PayrollScreen.js')}`
  );

  const dom = installFakeDom();
  const sent = [];
  const item = {
    id: 'pay1',
    employee_id: 'emp1',
    employee_code: 'QA01',
    full_name: 'Synthetic Staff',
    hourly_rate_vnd: 40000,
    total_hours: 160,
    gross_pay_vnd: 6400000,
    net_pay_vnd: 6400000,
    confirmed: { net_pay_vnd: 6400000, paid_amount_vnd: 0 },
    work_shifts: [],
    adjustments: [],
    paid_leaves: [],
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (url.includes('/adjustments')) {
      sent.push({ key: opts.headers['Idempotency-Key'], body: opts.body });
      throw new Error('Synthetic network timeout');
    }
    if (url.includes('/auth/me'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            csrf_token: 'synthetic-csrf',
            user: { id: 'u1' },
            active_workspace: { id: 'w1', role: 'owner' },
          },
        }),
      };
    if (url.includes('/payroll/periods'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            period: { id: 'p1', month: '2026-10', status: 'draft', version: 1 },
            items: [item],
          },
        }),
      };
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { items: [] } }),
    };
  };

  const c = dom.container();
  const rootEl = createRoot(c);
  const byId = (id) =>
    dom.find(c, (n) => dom.props(n)['data-testid'] === id)[0];

  try {
    await act(async () =>
      rootEl.render(
        React.createElement(PayrollScreen, {
          role: 'owner',
          onNavigate: () => {},
        }),
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });

    await act(async () => dom.props(byId('btn-add-adjustment-emp1')).onClick());
    await act(async () =>
      dom.props(byId('adjustment-reason-input')).onChange({
        target: { value: 'Original reason' },
      }),
    );
    await act(async () => dom.props(byId('adjustment-submit-btn')).onClick());
    assert.equal(sent.length, 1);

    // Now change reason while previous operation result is unresolved
    await act(async () =>
      dom.props(byId('adjustment-reason-input')).onChange({
        target: { value: 'Modified reason' },
      }),
    );
    await act(async () => dom.props(byId('adjustment-submit-btn')).onClick());

    // Second request must be BLOCKED (sent.length remains 1)
    assert.equal(
      sent.length,
      1,
      'Must not silently send new payload with old or new key when previous operation is unresolved',
    );
    assert.ok(
      c.textContent.includes('chưa rõ kết quả') ||
        c.textContent.includes('không thể thay đổi thông tin'),
      'Must warn user to resolve or cancel previous operation',
    );
  } finally {
    globalThis.fetch = originalFetch;
    await act(async () => rootEl.unmount());
  }
});

test('Mounted PAY: separate logical operations generate distinct idempotency keys', async () => {
  const { installFakeDom } = await import('./helpers/fake-dom.mjs');
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { PayrollScreen } = await import(
    `file://${resolve(root, 'dist/apps/web/src/screens/PayrollScreen.js')}`
  );

  const dom = installFakeDom();
  const sent = [];
  const items = [
    {
      id: 'pay1',
      employee_id: 'emp1',
      employee_code: 'QA01',
      full_name: 'Staff 1',
      hourly_rate_vnd: 40000,
      total_hours: 160,
      gross_pay_vnd: 6400000,
      net_pay_vnd: 6400000,
      confirmed: { net_pay_vnd: 6400000, paid_amount_vnd: 0 },
      work_shifts: [],
      adjustments: [],
      paid_leaves: [],
    },
    {
      id: 'pay2',
      employee_id: 'emp2',
      employee_code: 'QA02',
      full_name: 'Staff 2',
      hourly_rate_vnd: 40000,
      total_hours: 160,
      gross_pay_vnd: 6400000,
      net_pay_vnd: 6400000,
      confirmed: { net_pay_vnd: 6400000, paid_amount_vnd: 0 },
      work_shifts: [],
      adjustments: [],
      paid_leaves: [],
    },
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (url.includes('/adjustments')) {
      sent.push({ key: opts.headers['Idempotency-Key'], body: opts.body });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: 'adj-' + sent.length, amount_vnd: 200000 },
        }),
      };
    }
    if (url.includes('/auth/me'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            csrf_token: 'synthetic-csrf',
            user: { id: 'u1' },
            active_workspace: { id: 'w1', role: 'owner' },
          },
        }),
      };
    if (url.includes('/payroll/periods'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            period: { id: 'p1', month: '2026-10', status: 'draft', version: 1 },
            items,
          },
        }),
      };
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { items: [] } }),
    };
  };

  const c = dom.container();
  const rootEl = createRoot(c);
  const byId = (id) =>
    dom.find(c, (n) => dom.props(n)['data-testid'] === id)[0];

  try {
    await act(async () =>
      rootEl.render(
        React.createElement(PayrollScreen, {
          role: 'owner',
          onNavigate: () => {},
        }),
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });

    // Operation 1 for emp1
    await act(async () => dom.props(byId('btn-add-adjustment-emp1')).onClick());
    await act(async () =>
      dom.props(byId('adjustment-reason-input')).onChange({
        target: { value: 'Paid leave 1' },
      }),
    );
    await act(async () => dom.props(byId('adjustment-submit-btn')).onClick());

    // Operation 2 for emp2
    await act(async () => dom.props(byId('btn-add-adjustment-emp2')).onClick());
    await act(async () =>
      dom.props(byId('adjustment-reason-input')).onChange({
        target: { value: 'Paid leave 2' },
      }),
    );
    await act(async () => dom.props(byId('adjustment-submit-btn')).onClick());

    assert.equal(sent.length, 2);
    assert.notEqual(
      sent[0].key,
      sent[1].key,
      'Distinct logical operations must generate different idempotency keys',
    );
  } finally {
    globalThis.fetch = originalFetch;
    await act(async () => rootEl.unmount());
  }
});

test('Mounted PAY: unmount and remount restores unresolved operation from scoped storage', async () => {
  const { installFakeDom } = await import('./helpers/fake-dom.mjs');
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { PayrollScreen } = await import(
    `file://${resolve(root, 'dist/apps/web/src/screens/PayrollScreen.js')}`
  );

  const dom = installFakeDom();
  const sent = [];
  const item = {
    id: 'pay1',
    employee_id: 'emp1',
    employee_code: 'QA01',
    full_name: 'Synthetic Staff',
    hourly_rate_vnd: 40000,
    total_hours: 160,
    gross_pay_vnd: 6400000,
    net_pay_vnd: 6400000,
    confirmed: { net_pay_vnd: 6400000, paid_amount_vnd: 0 },
    work_shifts: [],
    adjustments: [],
    paid_leaves: [],
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (url.includes('/adjustments')) {
      sent.push({ key: opts.headers['Idempotency-Key'], body: opts.body });
      throw new Error('Synthetic network timeout');
    }
    if (url.includes('/auth/me'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            csrf_token: 'synthetic-csrf',
            user: { id: 'u1' },
            active_workspace: { id: 'w1', role: 'owner' },
          },
        }),
      };
    if (url.includes('/payroll/periods'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            period: { id: 'p1', month: '2026-10', status: 'draft', version: 1 },
            items: [item],
          },
        }),
      };
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { items: [] } }),
    };
  };

  const c1 = dom.container();
  const root1 = createRoot(c1);
  const byId1 = (id) =>
    dom.find(c1, (n) => dom.props(n)['data-testid'] === id)[0];

  try {
    // Mount 1
    await act(async () =>
      root1.render(
        React.createElement(PayrollScreen, {
          role: 'owner',
          onNavigate: () => {},
        }),
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });

    await act(async () =>
      dom.props(byId1('btn-add-adjustment-emp1')).onClick(),
    );
    await act(async () =>
      dom.props(byId1('adjustment-reason-input')).onChange({
        target: { value: 'Persistent reason' },
      }),
    );
    await act(async () => dom.props(byId1('adjustment-submit-btn')).onClick());
    assert.equal(sent.length, 1);
  } finally {
    await act(async () => root1.unmount());
  }

  // Mount 2 (remount)
  const c2 = dom.container();
  const root2 = createRoot(c2);
  const byId2 = (id) =>
    dom.find(c2, (n) => dom.props(n)['data-testid'] === id)[0];

  try {
    await act(async () =>
      root2.render(
        React.createElement(PayrollScreen, {
          role: 'owner',
          onNavigate: () => {},
        }),
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });

    await act(async () =>
      dom.props(byId2('btn-add-adjustment-emp1')).onClick(),
    );
    await act(async () => dom.props(byId2('adjustment-submit-btn')).onClick());

    assert.equal(sent.length, 2);
    assert.equal(
      sent[0].key,
      sent[1].key,
      'Remounted component must restore unresolved logical operation and reuse key',
    );
  } finally {
    globalThis.fetch = originalFetch;
    await act(async () => root2.unmount());
  }
});

test('Mounted PAY: workspace change isolates pending operations', async () => {
  const { installFakeDom } = await import('./helpers/fake-dom.mjs');
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { PayrollScreen } = await import(
    `file://${resolve(root, 'dist/apps/web/src/screens/PayrollScreen.js')}`
  );

  const dom = installFakeDom();
  const sent = [];
  const item = {
    id: 'pay1',
    employee_id: 'emp1',
    employee_code: 'QA01',
    full_name: 'Synthetic Staff',
    hourly_rate_vnd: 40000,
    total_hours: 160,
    gross_pay_vnd: 6400000,
    net_pay_vnd: 6400000,
    confirmed: { net_pay_vnd: 6400000, paid_amount_vnd: 0 },
    work_shifts: [],
    adjustments: [],
    paid_leaves: [],
  };

  let activeWs = 'w1';
  let activeActor = 'u1';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (url.includes('/adjustments')) {
      sent.push({
        ws: activeWs,
        key: opts.headers['Idempotency-Key'],
        body: opts.body,
      });
      throw new Error('Synthetic network timeout');
    }
    if (url.includes('/auth/me'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            csrf_token: 'synthetic-csrf',
            user: { id: activeActor },
            active_workspace: { id: activeWs, role: 'owner' },
          },
        }),
      };
    if (url.includes('/payroll/periods'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            period: { id: 'p1', month: '2026-10', status: 'draft', version: 1 },
            items: [item],
          },
        }),
      };
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { items: [] } }),
    };
  };

  // Operation in workspace 1
  const c1 = dom.container();
  const root1 = createRoot(c1);
  const byId1 = (id) =>
    dom.find(c1, (n) => dom.props(n)['data-testid'] === id)[0];

  try {
    await act(async () =>
      root1.render(
        React.createElement(PayrollScreen, {
          role: 'owner',
          onNavigate: () => {},
        }),
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });

    await act(async () =>
      dom.props(byId1('btn-add-adjustment-emp1')).onClick(),
    );
    await act(async () =>
      dom.props(byId1('adjustment-reason-input')).onChange({
        target: { value: 'WS1 leave' },
      }),
    );
    await act(async () => dom.props(byId1('adjustment-submit-btn')).onClick());
    assert.equal(sent.length, 1);
  } finally {
    await act(async () => root1.unmount());
  }

  // Switch to workspace 2 / actor 2
  activeWs = 'w2';
  activeActor = 'u2';

  const c2 = dom.container();
  const root2 = createRoot(c2);
  const byId2 = (id) =>
    dom.find(c2, (n) => dom.props(n)['data-testid'] === id)[0];

  try {
    await act(async () =>
      root2.render(
        React.createElement(PayrollScreen, {
          role: 'owner',
          onNavigate: () => {},
        }),
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });

    await act(async () =>
      dom.props(byId2('btn-add-adjustment-emp1')).onClick(),
    );
    await act(async () =>
      dom.props(byId2('adjustment-reason-input')).onChange({
        target: { value: 'WS2 leave' },
      }),
    );
    await act(async () => dom.props(byId2('adjustment-submit-btn')).onClick());

    assert.equal(sent.length, 2);
    assert.notEqual(
      sent[0].key,
      sent[1].key,
      'Operations across different workspaces/actors must never share idempotency keys',
    );
  } finally {
    globalThis.fetch = originalFetch;
    await act(async () => root2.unmount());
  }
});

test('Mounted PAY: session change while request is pending discards stale response', async () => {
  const { installFakeDom } = await import('./helpers/fake-dom.mjs');
  const React = (await import('react')).default;
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { PayrollScreen } = await import(
    `file://${resolve(root, 'dist/apps/web/src/screens/PayrollScreen.js')}`
  );

  const dom = installFakeDom();
  let resolveAdjustment;
  const pendingAdjustment = new Promise((r) => {
    resolveAdjustment = r;
  });

  let activeWs = 'w1';
  let activeActor = 'u1';

  const item = {
    id: 'pay1',
    employee_id: 'emp1',
    employee_code: 'QA01',
    full_name: 'Synthetic Staff',
    hourly_rate_vnd: 40000,
    total_hours: 160,
    gross_pay_vnd: 6400000,
    net_pay_vnd: 6400000,
    confirmed: { net_pay_vnd: 6400000, paid_amount_vnd: 0 },
    work_shifts: [],
    adjustments: [],
    paid_leaves: [],
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.includes('/adjustments')) {
      return pendingAdjustment;
    }
    if (url.includes('/auth/me'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            csrf_token: 'synthetic-csrf',
            user: { id: activeActor },
            active_workspace: { id: activeWs, role: 'owner' },
          },
        }),
      };
    if (url.includes('/payroll/periods'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            period: { id: 'p1', month: '2026-10', status: 'draft', version: 1 },
            items: [item],
          },
        }),
      };
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { items: [] } }),
    };
  };

  const c = dom.container();
  const rootEl = createRoot(c);
  const byId = (id) =>
    dom.find(c, (n) => dom.props(n)['data-testid'] === id)[0];

  try {
    await act(async () =>
      rootEl.render(
        React.createElement(PayrollScreen, {
          role: 'owner',
          onNavigate: () => {},
        }),
      ),
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });

    await act(async () => dom.props(byId('btn-add-adjustment-emp1')).onClick());
    await act(async () =>
      dom.props(byId('adjustment-reason-input')).onChange({
        target: { value: 'In-flight leave' },
      }),
    );
    let submitTask;
    await act(async () => {
      submitTask = dom.props(byId('adjustment-submit-btn')).onClick();
      await Promise.resolve();
    });

    // While request is in-flight, session changes to w2 / u2
    activeWs = 'w2';
    activeActor = 'u2';
    // Trigger session update event
    globalThis.window.dispatchEvent(new Event('storage'));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    // Now resolve the old in-flight request
    await act(async () => {
      resolveAdjustment({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { id: 'adj-old' } }),
      });
      await submitTask;
    });

    // Verify: Stale response was discarded and did not leak into current view
    assert.equal(
      c.textContent.includes('Đã ghi nhận nghỉ có lương'),
      false,
      'Old session response must not update state or show success banner after session change',
    );
  } finally {
    globalThis.fetch = originalFetch;
    await act(async () => rootEl.unmount());
  }
});
