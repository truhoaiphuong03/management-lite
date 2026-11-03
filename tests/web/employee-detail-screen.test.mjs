import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installFakeDom } from './helpers/fake-dom.mjs';

installFakeDom();

const { EmployeeDetailScreen } =
  await import('../../dist/apps/web/src/screens/EmployeeDetailScreen.js');

function getProps(element) {
  if (!element) return {};
  const k = Object.keys(element).find((key) => key.startsWith('__reactProps$'));
  return k ? element[k] : {};
}

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

test('EmployeeDetailScreen & EMP-009: Mounted lifecycle & hourly rate configuration', async (t) => {
  await t.test(
    'Loads employee detail, displays active hourly rate, and allows Owner to update hourly rate (EMP-009)',
    async () => {
      const { container, root, flush, cleanup } = createTestContainer();

      const mockEmployee = {
        id: 'emp-101',
        full_name: 'Nguyen Van Dev',
        employee_code: 'EMP101',
        employment_status: 'active',
        is_payroll_eligible: true,
        version: 1,
        created_at: '2026-01-01T00:00:00Z',
        user: { email: 'dev@company.local', username: 'vandev' },
      };

      let currentRates = [
        {
          id: 'rate-01',
          workspace_id: 'ws-01',
          employee_id: 'emp-101',
          hourly_rate_vnd: 35000,
          effective_from: '2026-01-01T00:00:00Z',
          effective_to: null,
        },
      ];

      let postRateCalledWith = null;

      globalThis.fetch = async (url, options = {}) => {
        if (url.includes('/auth/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                csrf_token: 'test-csrf-token-123',
                user: { id: 'owner-01' },
              },
            }),
          };
        }
        if (url.includes('/api/v1/employees/emp-101')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: mockEmployee,
            }),
          };
        }
        if (url.includes('/api/v1/payroll/hourly-rates')) {
          if (options.method === 'POST') {
            const body = JSON.parse(options.body);
            postRateCalledWith = {
              body,
              headers: options.headers,
            };
            const newRate = {
              id: 'rate-02',
              workspace_id: 'ws-01',
              employee_id: 'emp-101',
              hourly_rate_vnd: body.hourly_rate_vnd,
              effective_from: body.effective_from,
              effective_to: null,
            };
            currentRates = [
              { ...currentRates[0], effective_to: body.effective_from },
              newRate,
            ];
            return {
              ok: true,
              status: 201,
              json: async () => ({
                success: true,
                data: newRate,
              }),
            };
          }
          // GET
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: currentRates,
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
            React.createElement(EmployeeDetailScreen, {
              employeeId: 'emp-101',
              role: 'owner',
              onNavigate: () => {},
            }),
          );
        });
        await flush();

        // 1. Employee name rendered
        assert.ok(container.textContent.includes('Nguyen Van Dev'));
        assert.ok(container.textContent.includes('EMP101'));

        // 2. Active hourly rate rendered
        const rateDisplay = container.querySelector(
          '[data-testid="current-hourly-rate-value"]',
        );
        assert.ok(rateDisplay, 'Must render current-hourly-rate-value');
        assert.ok(
          rateDisplay.textContent.includes('35.000'),
          'Must display initial 35.000 rate',
        );

        // 3. Open Rate Modal button exists
        const openModalBtn = container.querySelector(
          '[data-testid="open-rate-modal-btn"]',
        );
        assert.ok(openModalBtn, 'Must render open-rate-modal-btn');

        // Click open modal
        await act(async () => {
          getProps(openModalBtn).onClick();
        });
        await flush();

        // 4. Rate input exists in modal
        const rateInput = container.querySelector(
          '[data-testid="hourly-rate-input"]',
        );
        assert.ok(rateInput, 'Must render hourly-rate-input inside modal');

        // Simulate typing 50000 into the input
        await act(async () => {
          getProps(rateInput).onChange({ target: { value: '50000' } });
        });

        // 5. Submit update
        const dialogConfirmBtn = Array.from(
          container.querySelectorAll('button'),
        ).find((b) => b.textContent.includes('Lưu mức lương'));
        assert.ok(dialogConfirmBtn, 'Must have Lưu mức lương confirm button');

        await act(async () => {
          getProps(dialogConfirmBtn).onClick();
        });
        await flush();

        // 6. Verify POST payload & headers
        assert.ok(postRateCalledWith, 'POST /hourly-rates must be called');
        assert.equal(postRateCalledWith.body.employee_id, 'emp-101');
        assert.equal(postRateCalledWith.body.hourly_rate_vnd, 50000);
        assert.equal(
          postRateCalledWith.headers['X-CSRF-Token'],
          'test-csrf-token-123',
        );
        assert.ok(
          postRateCalledWith.headers['Idempotency-Key'],
          'Must supply Idempotency-Key header',
        );

        // 7. Verify updated rate displayed in UI
        assert.ok(
          rateDisplay.textContent.includes('50.000'),
          'Must update display to 50.000 ₫/giờ',
        );
      } finally {
        await cleanup();
      }
    },
  );

  await t.test(
    'Non-payroll eligible employee displays not-eligible notice and hides update rate button',
    async () => {
      const { container, root, flush, cleanup } = createTestContainer();

      const mockOwnerEmp = {
        id: 'emp-owner',
        full_name: 'Super Owner',
        employee_code: 'OWNER',
        employment_status: 'active',
        is_payroll_eligible: false,
        version: 1,
        created_at: '2026-01-01T00:00:00Z',
        user: { email: 'owner@company.local', username: 'owner' },
      };

      globalThis.fetch = async (url) => {
        if (url.includes('/auth/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: { csrf_token: 'dummy-csrf', user: { id: 'emp-owner' } },
            }),
          };
        }
        if (url.includes('/api/v1/employees/emp-owner')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: mockOwnerEmp,
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        };
      };

      try {
        await act(async () => {
          root.render(
            React.createElement(EmployeeDetailScreen, {
              employeeId: 'emp-owner',
              role: 'owner',
              onNavigate: () => {},
            }),
          );
        });
        await flush();

        // 1. Employee loaded
        assert.ok(container.textContent.includes('Super Owner'));

        // 2. Open rate modal button must NOT exist
        const openModalBtn = container.querySelector(
          '[data-testid="open-rate-modal-btn"]',
        );
        assert.equal(
          openModalBtn,
          null,
          'Must not render open-rate-modal-btn for non-payroll employee',
        );

        // 3. Notice text is rendered
        assert.ok(
          container.textContent.includes('không thuộc diện tính lương'),
          'Must display non-payroll eligible notice',
        );
      } finally {
        await cleanup();
      }
    },
  );

  await t.test(
    'EMP-009: Hourly rate update preserves Idempotency-Key on retry and resets upon input change',
    async () => {
      const { container, root, flush, cleanup } = createTestContainer();

      const mockEmployee = {
        id: 'emp-202',
        full_name: 'Tran Thi Accountant',
        employee_code: 'EMP202',
        employment_status: 'active',
        is_payroll_eligible: true,
        version: 1,
        created_at: '2026-01-01T00:00:00Z',
        user: { email: 'acc@company.local', username: 'acc' },
      };

      const capturedKeys = [];
      let postCount = 0;

      globalThis.fetch = async (url, options = {}) => {
        if (url.includes('/auth/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: { csrf_token: 'csrf-xyz', user: { id: 'owner-id' } },
            }),
          };
        }
        if (url.includes('/api/v1/employees/emp-202')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: mockEmployee,
            }),
          };
        }
        if (url.includes('/api/v1/payroll/hourly-rates')) {
          if (options.method === 'POST') {
            postCount++;
            capturedKeys.push(options.headers['Idempotency-Key']);
            if (postCount === 1) {
              // Simulate transient network or server error on first attempt
              return {
                ok: false,
                status: 500,
                json: async () => ({
                  success: false,
                  error: { message: 'Tạm thời gián đoạn kết nối' },
                }),
              };
            }
            // Second attempt succeeds
            return {
              ok: true,
              status: 201,
              json: async () => ({
                success: true,
                data: {
                  id: 'rate-new',
                  employee_id: 'emp-202',
                  hourly_rate_vnd: JSON.parse(options.body).hourly_rate_vnd,
                  effective_from: new Date().toISOString(),
                },
              }),
            };
          }
          // GET
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: [] }),
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
            React.createElement(EmployeeDetailScreen, {
              employeeId: 'emp-202',
              role: 'owner',
              onNavigate: () => {},
            }),
          );
        });
        await flush();

        // 1. Open modal
        const openModalBtn = container.querySelector(
          '[data-testid="open-rate-modal-btn"]',
        );
        assert.ok(openModalBtn, 'Open rate modal button should exist');

        await act(async () => {
          getProps(openModalBtn).onClick();
        });
        await flush();

        // 2. Type rate 45000
        const rateInput = container.querySelector(
          '[data-testid="hourly-rate-input"]',
        );
        await act(async () => {
          getProps(rateInput).onChange({ target: { value: '45000' } });
        });

        // 3. First submission attempt -> will fail with 500
        const dialogConfirmBtn = Array.from(
          container.querySelectorAll('button'),
        ).find((b) => b.textContent.includes('Lưu mức lương'));
        assert.ok(dialogConfirmBtn, 'Confirm button should exist');

        await act(async () => {
          getProps(dialogConfirmBtn).onClick();
        });
        await flush();

        assert.equal(postCount, 1, 'First POST must be triggered');
        assert.ok(capturedKeys[0], 'First attempt must have Idempotency-Key');
        assert.ok(
          container.textContent.includes('Tạm thời gián đoạn kết nối'),
          'Error message must be shown',
        );

        // 4. Retry without changing input -> should reuse the exact same Idempotency-Key
        await act(async () => {
          getProps(dialogConfirmBtn).onClick();
        });
        await flush();

        assert.equal(postCount, 2, 'Second POST (retry) must be triggered');
        assert.equal(
          capturedKeys[1],
          capturedKeys[0],
          'Retry without changing input must reuse exact same Idempotency-Key',
        );
      } finally {
        await cleanup();
      }
    },
  );

  await t.test(
    'Owner can reassign employee role in Edit mode (staff <-> owner) via PATCH /api/v1/employees/:id',
    async () => {
      const { container, root, flush, cleanup } = createTestContainer();

      let currentEmp = {
        id: 'emp-303',
        user_id: 'user-303',
        full_name: 'Le Van Staff',
        employee_code: 'NV303',
        role: 'staff',
        employment_status: 'active',
        is_payroll_eligible: true,
        version: 2,
        created_at: '2026-01-01T00:00:00Z',
        user: {
          id: 'user-303',
          email: 'staff303@company.local',
          username: 'staff303',
          role: 'staff',
        },
      };

      let patchPayload = null;

      globalThis.fetch = async (url, options = {}) => {
        if (url.includes('/auth/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: { csrf_token: 'csrf-role-test', user: { id: 'owner-id' } },
            }),
          };
        }
        if (url.includes('/api/v1/employees/emp-303')) {
          if (options.method === 'PATCH') {
            patchPayload = JSON.parse(options.body);
            currentEmp = {
              ...currentEmp,
              full_name: patchPayload.full_name,
              role: patchPayload.role,
              sub_permissions: patchPayload.sub_permissions,
              is_payroll_eligible: patchPayload.is_payroll_eligible,
              version: currentEmp.version + 1,
              user: {
                ...currentEmp.user,
                role: patchPayload.role,
                sub_permissions: patchPayload.sub_permissions,
              },
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: currentEmp,
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        };
      };

      try {
        await act(async () => {
          root.render(
            React.createElement(EmployeeDetailScreen, {
              employeeId: 'emp-303',
              role: 'owner',
              onNavigate: () => {},
            }),
          );
        });
        await flush();

        const roleBadge = container.querySelector(
          '[data-testid="employee-detail-role-badge"]',
        );
        assert.ok(roleBadge, 'Role badge should be displayed in detail view');
        assert.ok(
          roleBadge.textContent.includes('Nhân viên (Staff)'),
          'Initial role badge must show Staff',
        );

        const editBtn = Array.from(container.querySelectorAll('button')).find(
          (b) => b.textContent.includes('Chỉnh sửa thông tin'),
        );
        assert.ok(editBtn, 'Edit button must exist for Owner');

        await act(async () => {
          getProps(editBtn).onClick();
        });
        await flush();

        const roleSelect = container.querySelector(
          '[data-testid="edit-employee-role-select"]',
        );
        assert.ok(roleSelect, 'Role select must render in Edit mode');
        assert.equal(roleSelect.disabled, false);

        await act(async () => {
          getProps(roleSelect).onChange({ target: { value: 'owner' } });
        });
        await flush();

        const form = container.querySelector('form');
        assert.ok(form, 'Edit form must exist');

        await act(async () => {
          getProps(form).onSubmit({ preventDefault() {} });
        });
        await flush();

        assert.ok(patchPayload, 'PATCH /api/v1/employees/emp-303 must be sent');
        assert.equal(
          patchPayload.role,
          'owner',
          'PATCH body must include reassigned role=owner',
        );
        assert.equal(
          patchPayload.is_payroll_eligible,
          false,
          'Promoting to owner defaults is_payroll_eligible to false',
        );

        const updatedBadge = container.querySelector(
          '[data-testid="employee-detail-role-badge"]',
        );
        assert.ok(
          updatedBadge.textContent.includes('Quản trị / Chủ sở hữu (Owner)'),
          'Updated role badge must reflect Owner role',
        );
      } finally {
        await cleanup();
      }
    },
  );

  await t.test(
    'Owner can assign Sub-Admin (admin) role with custom sub_permissions checkboxes',
    async () => {
      const { container, root, flush, cleanup } = createTestContainer();

      let currentEmp = {
        id: 'emp-404',
        full_name: 'Pham Thi SubAdmin',
        employee_code: 'NV004',
        role: 'staff',
        sub_permissions: [],
        employment_status: 'active',
        is_payroll_eligible: true,
        version: 1,
        created_at: '2026-01-01T00:00:00Z',
        user_id: 'staff-user-04',
        user: {
          id: 'staff-user-04',
          email: 'subadmin@company.local',
          username: 'subadmin',
          role: 'staff',
          sub_permissions: [],
        },
      };

      let patchPayload = null;

      globalThis.fetch = async (url, options = {}) => {
        if (url.includes('/auth/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                csrf_token: 'test-csrf-token-404',
                user: { id: 'owner-01' },
              },
            }),
          };
        }
        if (url.includes('/api/v1/employees/emp-404')) {
          if (options.method === 'PATCH') {
            patchPayload = JSON.parse(options.body);
            currentEmp = {
              ...currentEmp,
              full_name: patchPayload.full_name,
              role: patchPayload.role,
              sub_permissions: patchPayload.sub_permissions,
              is_payroll_eligible: patchPayload.is_payroll_eligible,
              version: currentEmp.version + 1,
              user: {
                ...currentEmp.user,
                role: patchPayload.role,
                sub_permissions: patchPayload.sub_permissions,
              },
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: currentEmp,
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: [] }),
        };
      };

      try {
        await act(async () => {
          root.render(
            React.createElement(EmployeeDetailScreen, {
              employeeId: 'emp-404',
              role: 'owner',
              onNavigate: () => {},
            }),
          );
        });
        await flush();

        const editBtn = Array.from(container.querySelectorAll('button')).find(
          (b) => b.textContent.includes('Chỉnh sửa thông tin'),
        );
        assert.ok(editBtn, 'Edit button must exist');

        await act(async () => {
          getProps(editBtn).onClick();
        });
        await flush();

        const roleSelect = container.querySelector(
          '[data-testid="edit-employee-role-select"]',
        );
        const subPermsPanel = container.querySelector(
          '[data-testid="employee-sub-permissions-panel"]',
        );
        assert.ok(roleSelect, 'Role select must render');
        assert.ok(subPermsPanel, 'Sub-permissions panel must render');

        // Select 'admin' -> pre-checks 4 operational sub-permissions
        await act(async () => {
          getProps(roleSelect).onChange({ target: { value: 'admin' } });
        });
        await flush();

        // Also check 'payroll:manage'
        const payrollCheckbox = container.querySelector(
          '[data-testid="sub-perm-checkbox-payroll:manage"]',
        );
        assert.ok(
          payrollCheckbox,
          'Payroll sub-permission checkbox must exist',
        );
        assert.equal(payrollCheckbox.checked, false);

        await act(async () => {
          getProps(payrollCheckbox).onChange({ target: { checked: true } });
        });
        await flush();

        const form = container.querySelector('form');
        await act(async () => {
          getProps(form).onSubmit({ preventDefault() {} });
        });
        await flush();

        assert.ok(patchPayload, 'PATCH request must be sent');
        assert.equal(patchPayload.role, 'admin');
        assert.deepEqual(patchPayload.sub_permissions, [
          'attendance:review',
          'work:manage',
          'employees:manage',
          'accounts:manage',
          'payroll:manage',
        ]);

        const updatedBadge = container.querySelector(
          '[data-testid="employee-detail-role-badge"]',
        );
        assert.ok(
          updatedBadge.textContent.includes('Quản lý phụ (Admin vận hành)'),
          'Badge must show Sub-Admin role',
        );
        const subPermBadges = container.querySelector(
          '[data-testid="employee-detail-sub-permissions"]',
        );
        assert.ok(subPermBadges, 'Sub-permission badges must be rendered');
        assert.ok(
          subPermBadges.textContent.includes('Quản lý & Chốt Bảng lương'),
          'Granted payroll permission badge must be visible',
        );
      } finally {
        await cleanup();
      }
    },
  );

  await t.test(
    'Sanitizes ?edit=1 query suffix on employeeId so API never calls /employees/<id>%3Fedit%3D1 and opens edit mode directly',
    async () => {
      const { container, root, flush, cleanup } = createTestContainer();
      const targetUuid = 'aa1f9877-dc6b-4f8a-a4c2-593d251db34b';
      const requestedUrls = [];

      globalThis.fetch = async (url) => {
        requestedUrls.push(String(url));
        if (url.includes('/auth/me')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: { csrf_token: 'csrf-edit-1', user: { id: 'owner-01' } },
            }),
          };
        }
        if (url === `/api/v1/employees/${targetUuid}`) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: {
                id: targetUuid,
                full_name: 'Tran Thi Media',
                employee_code: 'NV002',
                employment_status: 'active',
                is_payroll_eligible: true,
                role: 'staff',
                sub_permissions: [],
                version: 1,
                created_at: '2026-01-01T00:00:00Z',
              },
            }),
          };
        }
        if (url.includes('/api/v1/payroll/hourly-rates')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: [] }),
          };
        }
        return {
          ok: false,
          status: 404,
          json: async () => ({
            success: false,
            error: { message: `Endpoint GET ${url} not found` },
          }),
        };
      };

      try {
        await act(async () => {
          root.render(
            React.createElement(EmployeeDetailScreen, {
              employeeId: `${targetUuid}?edit=1`,
              role: 'owner',
              onNavigate: () => {},
            }),
          );
        });
        await flush();

        assert.equal(
          requestedUrls.some((u) => u.includes('%3Fedit%3D1')),
          false,
          `Must never encode ?edit=1 into employee API path, got: ${requestedUrls.join(', ')}`,
        );
        assert.equal(
          requestedUrls.includes(`/api/v1/employees/${targetUuid}`),
          true,
          'Must fetch clean /api/v1/employees/<uuid>',
        );
        assert.ok(
          container.querySelector('form'),
          'Must automatically open edit form when ?edit=1 is passed',
        );
      } finally {
        await cleanup();
      }
    },
  );
});
