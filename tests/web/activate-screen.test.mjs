import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installFakeDom } from './helpers/fake-dom.mjs';

installFakeDom();
if (typeof window !== 'undefined' && !window.location) {
  window.location = { search: '', origin: 'http://localhost:3000' };
}

const { ActivateScreen } =
  await import('../../dist/apps/web/src/screens/ActivateScreen.js');

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

test('AUTH-011: ActivateScreen token parsing, form validation, and atomic submission', async (t) => {
  await t.test(
    'Extracts invite token from URL query params and auto-populates token field',
    async () => {
      window.location = {
        search: '?token=test-invite-token-123',
        origin: 'http://localhost:3000',
      };
      const { container, root, flush, cleanup } = createTestContainer();

      try {
        await act(async () => {
          root.render(
            React.createElement(ActivateScreen, {
              onNavigate: () => {},
            }),
          );
        });
        await flush();

        const tokenInput = container.querySelector(
          '[data-testid="token-input"]',
        );
        assert.ok(tokenInput, 'Must render token input');
        assert.equal(tokenInput.value, 'test-invite-token-123');
      } finally {
        await cleanup();
        window.location = { search: '', origin: 'http://localhost:3000' };
      }
    },
  );

  await t.test(
    'Client-side validation rejects empty token, short password, and password mismatch',
    async () => {
      const { container, root, flush, cleanup } = createTestContainer();

      try {
        await act(async () => {
          root.render(
            React.createElement(ActivateScreen, {
              onNavigate: () => {},
            }),
          );
        });
        await flush();

        const form = container.querySelector('form');
        assert.ok(form, 'Form must be present');

        // 1. Submit empty form
        await act(async () => {
          getProps(form).onSubmit({ preventDefault: () => {} });
        });
        await flush();

        assert.ok(
          container.textContent.includes('Mã kích hoạt không được để trống'),
          'Must show empty token validation error',
        );

        // 2. Set token but short password (< 8 chars)
        const tokenInput = container.querySelector(
          '[data-testid="token-input"]',
        );
        const passInput = container.querySelector(
          '[data-testid="new-password-input"]',
        );
        const confirmInput = container.querySelector(
          '[data-testid="confirm-password-input"]',
        );

        await act(async () => {
          getProps(tokenInput).onChange({ target: { value: 'tok-123' } });
          getProps(passInput).onChange({ target: { value: 'short' } });
          getProps(confirmInput).onChange({ target: { value: 'short' } });
        });
        await flush();

        await act(async () => {
          getProps(form).onSubmit({ preventDefault: () => {} });
        });
        await flush();

        assert.ok(
          container.textContent.includes('tối thiểu 8 ký tự'),
          'Must show password length validation error',
        );

        // 3. Set valid password length but mismatch confirmation
        await act(async () => {
          getProps(passInput).onChange({ target: { value: 'password123' } });
          getProps(confirmInput).onChange({ target: { value: 'password456' } });
        });
        await flush();

        await act(async () => {
          getProps(form).onSubmit({ preventDefault: () => {} });
        });
        await flush();

        assert.ok(
          container.textContent.includes('Xác nhận mật khẩu không khớp'),
          'Must show password mismatch validation error',
        );
      } finally {
        await cleanup();
      }
    },
  );

  await t.test(
    'Successful activation sends POST /api/v1/auth/activate and displays success state',
    async () => {
      window.location = {
        search: '?token=valid-tok-789',
        origin: 'http://localhost:3000',
      };
      const { container, root, flush, cleanup } = createTestContainer();

      let postCalledWith = null;
      globalThis.fetch = async (url, options = {}) => {
        if (url === '/api/v1/auth/activate' && options.method === 'POST') {
          postCalledWith = JSON.parse(options.body);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: { message: 'Tài khoản đã được kích hoạt thành công!' },
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      };

      try {
        await act(async () => {
          root.render(
            React.createElement(ActivateScreen, {
              onNavigate: () => {},
            }),
          );
        });
        await flush();

        const passInput = container.querySelector(
          '[data-testid="new-password-input"]',
        );
        const confirmInput = container.querySelector(
          '[data-testid="confirm-password-input"]',
        );
        const form = container.querySelector('form');

        await act(async () => {
          getProps(passInput).onChange({
            target: { value: 'SuperSecret@2026' },
          });
          getProps(confirmInput).onChange({
            target: { value: 'SuperSecret@2026' },
          });
        });
        await flush();

        await act(async () => {
          getProps(form).onSubmit({ preventDefault: () => {} });
        });
        await flush();

        assert.ok(postCalledWith, 'POST /api/v1/auth/activate must be called');
        assert.equal(postCalledWith.token, 'valid-tok-789');
        assert.equal(postCalledWith.new_password, 'SuperSecret@2026');

        assert.ok(
          container.textContent.includes('kích hoạt thành công'),
          'Must display activation success message',
        );
      } finally {
        await cleanup();
        window.location = { search: '', origin: 'http://localhost:3000' };
      }
    },
  );

  await t.test(
    'Server error (expired token / 410) displays error message from backend',
    async () => {
      window.location = {
        search: '?token=expired-tok',
        origin: 'http://localhost:3000',
      };
      const { container, root, flush, cleanup } = createTestContainer();

      globalThis.fetch = async () => ({
        ok: false,
        status: 410,
        json: async () => ({
          success: false,
          error: {
            message: 'Liên kết kích hoạt đã hết hạn hoặc đã được sử dụng',
          },
        }),
      });

      try {
        await act(async () => {
          root.render(
            React.createElement(ActivateScreen, {
              onNavigate: () => {},
            }),
          );
        });
        await flush();

        const passInput = container.querySelector(
          '[data-testid="new-password-input"]',
        );
        const confirmInput = container.querySelector(
          '[data-testid="confirm-password-input"]',
        );
        const form = container.querySelector('form');

        await act(async () => {
          getProps(passInput).onChange({ target: { value: 'ValidPass123' } });
          getProps(confirmInput).onChange({
            target: { value: 'ValidPass123' },
          });
        });
        await flush();

        await act(async () => {
          getProps(form).onSubmit({ preventDefault: () => {} });
        });
        await flush();

        assert.ok(
          container.textContent.includes('Liên kết kích hoạt đã hết hạn'),
          'Must display server error message',
        );
      } finally {
        await cleanup();
        window.location = { search: '', origin: 'http://localhost:3000' };
      }
    },
  );

  await t.test(
    'Prevents concurrent double submission using synchronous lock ref',
    async () => {
      window.location = {
        search: '?token=lock-test-token',
        origin: 'http://localhost:3000',
      };
      const { container, root, flush, cleanup } = createTestContainer();

      let postCount = 0;
      globalThis.fetch = async (url, options = {}) => {
        if (url === '/api/v1/auth/activate' && options.method === 'POST') {
          postCount++;
          // Simulate latency
          await new Promise((r) => setTimeout(r, 50));
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              data: { message: 'Tài khoản đã kích hoạt!' },
            }),
          };
        }
        return { ok: false, status: 404, json: async () => ({}) };
      };

      try {
        await act(async () => {
          root.render(
            React.createElement(ActivateScreen, {
              onNavigate: () => {},
            }),
          );
        });
        await flush();

        const passInput = container.querySelector(
          '[data-testid="new-password-input"]',
        );
        const confirmInput = container.querySelector(
          '[data-testid="confirm-password-input"]',
        );
        const form = container.querySelector('form');

        await act(async () => {
          getProps(passInput).onChange({
            target: { value: 'ValidPassword123' },
          });
          getProps(confirmInput).onChange({
            target: { value: 'ValidPassword123' },
          });
        });
        await flush();

        // Simulate rapid double click before the first resolves
        await act(async () => {
          const p1 = getProps(form).onSubmit({ preventDefault: () => {} });
          const p2 = getProps(form).onSubmit({ preventDefault: () => {} });
          await Promise.all([p1, p2]);
        });
        await flush(60);

        assert.equal(
          postCount,
          1,
          'Synchronous lock must guarantee exactly 1 submission even on concurrent clicks',
        );
      } finally {
        await cleanup();
        window.location = { search: '', origin: 'http://localhost:3000' };
      }
    },
  );
});
