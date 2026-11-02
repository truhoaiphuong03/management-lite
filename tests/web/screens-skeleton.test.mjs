import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installFakeDom } from './helpers/fake-dom.mjs';

installFakeDom();

const { EmployeesScreen } =
  await import('../../dist/apps/web/src/screens/EmployeesScreen.js');
const { FinanceHistoryScreen } =
  await import('../../dist/apps/web/src/screens/FinanceHistoryScreen.js');
const { PayrollScreen } =
  await import('../../dist/apps/web/src/screens/PayrollScreen.js');

function createTestContainer() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  return {
    container,
    root,
    flush: async (ms = 25) => {
      await act(async () => {
        await new Promise((r) => setTimeout(r, ms));
      });
    },
    cleanup: async () => {
      try {
        await act(async () => {
          root.unmount();
        });
      } catch {}
      try {
        container.remove();
      } catch {}
    },
  };
}

// -------------------------------------------------------------------------
// 1. EMPLOYEES SCREEN: MOUNTED 4-STATE LIFECYCLE TESTS (Controlled Delayed Fetch)
// -------------------------------------------------------------------------
test('EmployeesScreen: Mounted component lifecycle tests (Loading, Success, Error, Empty)', async (t) => {
  await t.test(
    'Loading & Success: Skeleton shows during delayed fetch, then data replaces skeleton',
    async () => {
      const { container, root, cleanup } = createTestContainer();
      let delayedResolve;
      const delayedPromise = new Promise((r) => {
        delayedResolve = r;
      });

      globalThis.fetch = async (url) => {
        if (url.includes('/auth/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: { csrf_token: 'dummy-csrf' },
            }),
          };
        }
        if (url.includes('/employees')) {
          return delayedPromise;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: {} }),
        };
      };

      try {
        // 1. Mount component while fetch is delayed
        await act(async () => {
          root.render(
            React.createElement(EmployeesScreen, { onNavigate: () => {} }),
          );
        });

        // 2. Verify Loading State: AppSkeleton container is mounted with aria-busy="true"
        const skeleton = container.querySelector(
          '[data-testid="employees-skeleton-container"]',
        );
        assert.ok(
          skeleton,
          'Employees skeleton container must be rendered while loading',
        );
        assert.equal(
          skeleton.getAttribute('aria-busy'),
          'true',
          'Skeleton container must declare aria-busy=true',
        );

        // 3. Resolve controlled delayed response with employee data
        await act(async () => {
          delayedResolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                items: [
                  {
                    id: 'emp-01',
                    full_name: 'Nguyen Van A',
                    role: 'staff',
                    status: 'active',
                    employee_code: 'EMP001',
                  },
                ],
              },
            }),
          });
        });

        // 4. Verify Success State: Skeleton is removed and employee data is displayed
        const skeletonAfter = container.querySelector(
          '[data-testid="employees-skeleton-container"]',
        );
        assert.equal(
          skeletonAfter,
          null,
          'Skeleton must be unmounted once data arrives',
        );
        assert.ok(
          container.textContent.includes('Nguyen Van A'),
          'Employee name must be rendered in DOM on success',
        );
      } finally {
        await cleanup();
      }
    },
  );

  await t.test(
    'Error State: Displays ErrorState when employee fetch fails',
    async () => {
      const { container, root, cleanup } = createTestContainer();

      globalThis.fetch = async (url) => {
        if (url.includes('/auth/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: { csrf_token: 'dummy-csrf' },
            }),
          };
        }
        if (url.includes('/employees')) {
          return {
            ok: false,
            status: 500,
            json: async () => ({
              error: { message: 'Không thể kết nối máy chủ nhân sự' },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: {} }),
        };
      };

      try {
        await act(async () => {
          root.render(
            React.createElement(EmployeesScreen, { onNavigate: () => {} }),
          );
        });

        const skeleton = container.querySelector(
          '[data-testid="employees-skeleton-container"]',
        );
        assert.equal(skeleton, null, 'Skeleton must be removed on error');
        assert.ok(
          container.textContent.includes('Không thể kết nối máy chủ nhân sự'),
          'Must render error message in DOM',
        );
      } finally {
        await cleanup();
      }
    },
  );

  await t.test(
    'Empty State: Displays EmptyState when no employees exist',
    async () => {
      const { container, root, cleanup } = createTestContainer();

      globalThis.fetch = async (url) => {
        if (url.includes('/auth/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: { csrf_token: 'dummy-csrf' },
            }),
          };
        }
        if (url.includes('/employees')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: { items: [] },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: {} }),
        };
      };

      try {
        await act(async () => {
          root.render(
            React.createElement(EmployeesScreen, { onNavigate: () => {} }),
          );
        });

        const skeleton = container.querySelector(
          '[data-testid="employees-skeleton-container"]',
        );
        assert.equal(skeleton, null, 'Skeleton must not be displayed on empty');
        assert.ok(
          container.textContent.includes('Chưa có nhân viên nào'),
          'Must render empty state message in DOM',
        );
      } finally {
        await cleanup();
      }
    },
  );

  await t.test(
    'Search State: Filters employee list by name/code and shows empty search state when no matches found',
    async () => {
      const { container, root, cleanup } = createTestContainer();

      const items = [
        {
          id: 'emp-01',
          full_name: 'Nguyen Van A',
          role: 'staff',
          employment_status: 'active',
          employee_code: 'EMP001',
        },
        {
          id: 'emp-02',
          full_name: 'Tran Thi B',
          role: 'staff',
          employment_status: 'active',
          employee_code: 'EMP002',
        },
      ];

      globalThis.fetch = async (url) => {
        if (url.includes('/auth/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: { csrf_token: 'dummy-csrf' },
            }),
          };
        }
        if (url.includes('/employees')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: { items },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: {} }),
        };
      };

      try {
        await act(async () => {
          root.render(
            React.createElement(EmployeesScreen, { onNavigate: () => {} }),
          );
        });

        // 1. Initial: Both employees are rendered
        assert.ok(container.textContent.includes('Nguyen Van A'));
        assert.ok(container.textContent.includes('Tran Thi B'));

        // 2. Search input exists
        const searchInput = container.querySelector(
          '[data-testid="employee-search-input"]',
        );
        assert.ok(searchInput, 'Must render employee-search-input');

        // 3. Filter by 'Nguyen'
        await act(async () => {
          const reactProps = Object.keys(searchInput).find((k) =>
            k.startsWith('__reactProps$'),
          );
          if (reactProps && searchInput[reactProps]?.onChange) {
            searchInput[reactProps].onChange({ target: { value: 'Nguyen' } });
          }
        });

        assert.ok(container.textContent.includes('Nguyen Van A'));
        assert.equal(container.textContent.includes('Tran Thi B'), false);

        // 4. Search with non-matching query
        await act(async () => {
          const reactProps = Object.keys(searchInput).find((k) =>
            k.startsWith('__reactProps$'),
          );
          if (reactProps && searchInput[reactProps]?.onChange) {
            searchInput[reactProps].onChange({
              target: { value: 'NonExistentXYZ' },
            });
          }
        });

        assert.ok(
          container.textContent.includes('Không tìm thấy nhân viên'),
          'Must display Không tìm thấy nhân viên empty search state',
        );
      } finally {
        await cleanup();
      }
    },
  );
});

// -------------------------------------------------------------------------
// 2. FINANCE HISTORY SCREEN: MOUNTED 4-STATE LIFECYCLE TESTS (Controlled Delayed Fetch)
// -------------------------------------------------------------------------
test('FinanceHistoryScreen: Mounted component lifecycle tests (Loading, Success, Error, Empty)', async (t) => {
  await t.test(
    'Loading & Success: Table skeleton displays while fetching, then rows mount',
    async () => {
      const { container, root, cleanup } = createTestContainer();
      let delayedResolve;
      const delayedPromise = new Promise((r) => {
        delayedResolve = r;
      });

      globalThis.fetch = async (url) => {
        if (url.includes('/auth/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                user: { id: 'u1' },
                active_workspace: { id: 'w1', role: 'owner' },
                csrf_token: 'dummy-csrf',
              },
            }),
          };
        }
        if (url.includes('/fin/categories')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                items: [
                  {
                    id: 'c1',
                    name: 'Chi phí văn phòng',
                    direction: 'expense',
                    is_active: true,
                  },
                ],
              },
            }),
          };
        }
        if (url.includes('/fin/entries')) {
          return delayedPromise;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: {} }),
        };
      };

      try {
        await act(async () => {
          root.render(
            React.createElement(FinanceHistoryScreen, {
              identity: { userId: 'u1', workspaceId: 'w1' },
              onNavigate: () => {},
            }),
          );
        });

        await act(async () => {
          await new Promise((r) => setTimeout(r, 10));
        });

        // 1. Verify Loading State
        const skeleton = container.querySelector(
          '[data-testid="history-skeleton-container"]',
        );
        assert.ok(
          skeleton,
          'Finance history skeleton container must be rendered while loading',
        );
        assert.equal(
          skeleton.getAttribute('aria-busy'),
          'true',
          'Skeleton container must declare aria-busy=true',
        );

        // 2. Resolve entries fetch
        await act(async () => {
          delayedResolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                total: 1,
                items: [
                  {
                    id: 'ent-1',
                    direction: 'expense',
                    category_id: 'c1',
                    category_name_snapshot: 'Chi phí văn phòng',
                    amount_vnd: '50000',
                    occurred_on: '2026-10-13',
                    note: 'Văn phòng phẩm',
                    version: 1,
                  },
                ],
              },
            }),
          });
        });

        await act(async () => {
          await new Promise((r) => setTimeout(r, 10));
        });

        // 3. Verify Success State
        const skeletonAfter = container.querySelector(
          '[data-testid="history-skeleton-container"]',
        );
        assert.equal(
          skeletonAfter,
          null,
          'History skeleton must be unmounted on data arrival',
        );
        assert.ok(
          container.textContent.includes('Chi phí văn phòng'),
          'Transaction category must be in DOM',
        );
      } finally {
        await cleanup();
      }
    },
  );

  await t.test(
    'Error State: Displays error status when entries fetch fails',
    async () => {
      const { container, root, cleanup } = createTestContainer();

      globalThis.fetch = async (url) => {
        if (url.includes('/auth/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                user: { id: 'u1' },
                active_workspace: { id: 'w1', role: 'owner' },
                csrf_token: 'dummy-csrf',
              },
            }),
          };
        }
        if (url.includes('/fin/categories')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: { items: [] } }),
          };
        }
        if (url.includes('/fin/entries')) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ error: { message: 'Lỗi tải lịch sử' } }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: {} }),
        };
      };

      try {
        await act(async () => {
          root.render(
            React.createElement(FinanceHistoryScreen, {
              identity: { userId: 'u1', workspaceId: 'w1' },
              onNavigate: () => {},
            }),
          );
        });

        await act(async () => {
          await new Promise((r) => setTimeout(r, 15));
        });

        const skeleton = container.querySelector(
          '[data-testid="history-skeleton-container"]',
        );
        assert.equal(skeleton, null, 'Skeleton must be removed on error');
        assert.ok(
          container.textContent.includes('Không tải được dữ liệu') ||
            container.textContent.includes('Lỗi'),
          'Error status must be displayed',
        );
      } finally {
        await cleanup();
      }
    },
  );

  await t.test(
    'Empty State: Displays empty message when transaction list is empty',
    async () => {
      const { container, root, cleanup } = createTestContainer();

      globalThis.fetch = async (url) => {
        if (url.includes('/auth/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                user: { id: 'u1' },
                active_workspace: { id: 'w1', role: 'owner' },
                csrf_token: 'dummy-csrf',
              },
            }),
          };
        }
        if (url.includes('/fin/categories')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: { items: [] } }),
          };
        }
        if (url.includes('/fin/entries')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: { total: 0, items: [] },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: {} }),
        };
      };

      try {
        await act(async () => {
          root.render(
            React.createElement(FinanceHistoryScreen, {
              identity: { userId: 'u1', workspaceId: 'w1' },
              onNavigate: () => {},
            }),
          );
        });

        await act(async () => {
          await new Promise((r) => setTimeout(r, 15));
        });

        const skeleton = container.querySelector(
          '[data-testid="history-skeleton-container"]',
        );
        assert.equal(skeleton, null, 'Skeleton must not be present on empty');
        assert.ok(
          container.textContent.includes('Chưa có giao dịch'),
          'Empty state message must be displayed',
        );
      } finally {
        await cleanup();
      }
    },
  );

  await t.test(
    'Search State: Filters finance transactions by note/category and shows empty search message when no matches found',
    async () => {
      const { container, root, cleanup } = createTestContainer();

      const items = [
        {
          id: 'ent-01',
          direction: 'expense',
          category_id: 'c1',
          category_name_snapshot: 'Ăn uống',
          amount_vnd: '120000',
          occurred_on: '2026-10-13',
          note: 'Cơm trưa văn phòng',
          version: 1,
        },
        {
          id: 'ent-02',
          direction: 'expense',
          category_id: 'c2',
          category_name_snapshot: 'Thuê nhà',
          amount_vnd: '5000000',
          occurred_on: '2026-10-10',
          note: 'Tiền mặt bằng tháng 10',
          version: 1,
        },
      ];

      globalThis.fetch = async (url) => {
        if (url.includes('/auth/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                csrf_token: 'dummy-csrf',
                user: { id: 'u1' },
                active_workspace: { id: 'w1', role: 'owner' },
              },
            }),
          };
        }
        if (url.includes('/categories')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: { items: [] } }),
          };
        }
        if (url.includes('/entries')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: { total: 2, items },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: {} }),
        };
      };

      try {
        await act(async () => {
          root.render(
            React.createElement(FinanceHistoryScreen, {
              identity: { userId: 'u1', workspaceId: 'w1' },
              onNavigate: () => {},
            }),
          );
        });

        await act(async () => {
          await new Promise((r) => setTimeout(r, 20));
        });

        // 1. Initial: Both entries rendered
        assert.ok(container.textContent.includes('Cơm trưa văn phòng'));
        assert.ok(container.textContent.includes('Tiền mặt bằng tháng 10'));

        // 2. Search input exists
        const searchInput = container.querySelector(
          '[data-testid="history-search-input"]',
        );
        assert.ok(searchInput, 'Must render history-search-input');

        // 3. Filter by 'Cơm'
        await act(async () => {
          const reactProps = Object.keys(searchInput).find((k) =>
            k.startsWith('__reactProps$'),
          );
          if (reactProps && searchInput[reactProps]?.onChange) {
            searchInput[reactProps].onChange({ target: { value: 'Cơm' } });
          }
        });

        assert.ok(container.textContent.includes('Cơm trưa văn phòng'));
        assert.equal(
          container.textContent.includes('Tiền mặt bằng tháng 10'),
          false,
        );

        // 4. Search with non-matching query
        await act(async () => {
          const reactProps = Object.keys(searchInput).find((k) =>
            k.startsWith('__reactProps$'),
          );
          if (reactProps && searchInput[reactProps]?.onChange) {
            searchInput[reactProps].onChange({
              target: { value: 'NonExistentXYZ' },
            });
          }
        });

        assert.ok(
          container.querySelector('[data-testid="history-empty-search"]') ||
            container.textContent.includes(
              'Không tìm thấy giao dịch nào khớp với từ khóa',
            ),
          'Must display empty search notice',
        );
      } finally {
        await cleanup();
      }
    },
  );
});

// -------------------------------------------------------------------------
// 3. PAYROLL SCREEN: MOUNTED 4-STATE LIFECYCLE TESTS (Controlled Delayed Fetch)
// -------------------------------------------------------------------------
test('PayrollScreen: Mounted component lifecycle tests (Loading, Success, Error, Empty)', async (t) => {
  await t.test(
    'Loading & Success: KPI & table skeleton displays during delayed fetch, then data replaces it',
    async () => {
      const { container, root, cleanup } = createTestContainer();
      let delayedResolve;
      const delayedPromise = new Promise((r) => {
        delayedResolve = r;
      });

      globalThis.fetch = async (url) => {
        if (url.includes('/auth/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                csrf_token: 'dummy-csrf',
                user: { id: 'u1' },
                active_workspace: { id: 'w1', role: 'owner' },
              },
            }),
          };
        }
        if (url.includes('/payroll/periods')) {
          return delayedPromise;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: {} }),
        };
      };

      try {
        await act(async () => {
          root.render(
            React.createElement(PayrollScreen, {
              role: 'owner',
              onNavigate: () => {},
            }),
          );
        });

        await act(async () => {
          await new Promise((r) => setTimeout(r, 10));
        });

        // 1. Verify Loading State
        const skeleton = container.querySelector(
          '[data-testid="payroll-skeleton-container"]',
        );
        assert.ok(
          skeleton,
          'Payroll skeleton container must be rendered while loading',
        );
        assert.equal(
          skeleton.getAttribute('aria-busy'),
          'true',
          'Payroll skeleton must declare aria-busy=true',
        );

        // 2. Resolve payroll period fetch
        await act(async () => {
          delayedResolve({
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                period: {
                  id: 'p1',
                  month: '2026-10',
                  status: 'draft',
                  version: 1,
                },
                items: [
                  {
                    id: 'pay-1',
                    employee_id: 'emp-1',
                    employee_code: 'NV01',
                    full_name: 'Tran Van B',
                    hourly_rate_vnd: 40000,
                    total_hours: 160,
                    gross_pay_vnd: 6400000,
                    net_pay_vnd: 6400000,
                    confirmed: { net_pay_vnd: 6400000, paid_amount_vnd: 0 },
                    work_shifts: [],
                    adjustments: [],
                    paid_leaves: [],
                  },
                ],
              },
            }),
          });
        });

        await act(async () => {
          await new Promise((r) => setTimeout(r, 10));
        });

        // 3. Verify Success State
        const skeletonAfter = container.querySelector(
          '[data-testid="payroll-skeleton-container"]',
        );
        assert.equal(
          skeletonAfter,
          null,
          'Payroll skeleton must be unmounted once data arrives',
        );
        assert.ok(
          container.textContent.includes('Tran Van B'),
          'Employee payroll must be rendered in DOM on success',
        );
      } finally {
        await cleanup();
      }
    },
  );

  await t.test(
    'Error State: Displays error card when payroll fetch fails',
    async () => {
      const { container, root, cleanup } = createTestContainer();

      globalThis.fetch = async (url) => {
        if (url.includes('/auth/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                csrf_token: 'dummy-csrf',
                user: { id: 'u1' },
                active_workspace: { id: 'w1', role: 'owner' },
              },
            }),
          };
        }
        if (url.includes('/payroll/periods')) {
          return {
            ok: false,
            status: 500,
            json: async () => ({
              error: { message: 'Lỗi tải dữ liệu kỳ tính lương' },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: {} }),
        };
      };

      try {
        await act(async () => {
          root.render(
            React.createElement(PayrollScreen, {
              role: 'owner',
              onNavigate: () => {},
            }),
          );
        });

        await act(async () => {
          await new Promise((r) => setTimeout(r, 15));
        });

        const skeleton = container.querySelector(
          '[data-testid="payroll-skeleton-container"]',
        );
        assert.equal(
          skeleton,
          null,
          'Payroll skeleton must be removed on error',
        );
        assert.ok(
          container.textContent.includes('Lỗi tải dữ liệu kỳ tính lương'),
          'Error message must be present in DOM',
        );
      } finally {
        await cleanup();
      }
    },
  );

  await t.test(
    'Empty State: Displays EmptyState when no employees in payroll',
    async () => {
      const { container, root, cleanup } = createTestContainer();

      globalThis.fetch = async (url) => {
        if (url.includes('/auth/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                csrf_token: 'dummy-csrf',
                user: { id: 'u1' },
                active_workspace: { id: 'w1', role: 'owner' },
              },
            }),
          };
        }
        if (url.includes('/payroll/periods')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                period: {
                  id: 'p1',
                  month: '2026-10',
                  status: 'draft',
                  version: 1,
                },
                items: [],
              },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: {} }),
        };
      };

      try {
        await act(async () => {
          root.render(
            React.createElement(PayrollScreen, {
              role: 'owner',
              onNavigate: () => {},
            }),
          );
        });

        await act(async () => {
          await new Promise((r) => setTimeout(r, 15));
        });

        const skeleton = container.querySelector(
          '[data-testid="payroll-skeleton-container"]',
        );
        assert.equal(
          skeleton,
          null,
          'Payroll skeleton must not be shown on empty',
        );
        assert.ok(
          container.textContent.includes(
            'Không có nhân sự nào trong danh sách',
          ),
          'Empty state message must be displayed',
        );
      } finally {
        await cleanup();
      }
    },
  );
});
