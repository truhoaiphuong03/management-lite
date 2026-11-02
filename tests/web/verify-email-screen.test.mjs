import assert from 'node:assert/strict';
import { test } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { installFakeDom } from './helpers/fake-dom.mjs';

installFakeDom();
if (typeof window !== 'undefined' && !window.location) {
  window.location = {
    pathname: '/verify-email',
    search: '',
    hash: '',
    origin: 'http://localhost:3000',
  };
}
if (typeof window !== 'undefined' && !window.history) {
  window.history = { replaceState: () => {}, pushState: () => {} };
}

const { VerifyEmailScreen } =
  await import('../../dist/apps/web/src/screens/VerifyEmailScreen.js');
const { parseSessionPayload, determinePostVerificationRoute } =
  await import('../../dist/apps/web/src/session-manager.js');

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

test('VerifyEmailScreen UI: unverified notice, resend button, and confirmation success/failure states', async (t) => {
  await t.test(
    'session-manager parses email_verified and allows /verify-email anonymously',
    async () => {
      const parsed = parseSessionPayload({
        success: true,
        data: {
          user: {
            id: 'u-1',
            email: 'test@example.com',
            email_verified: false,
          },
          active_workspace: {
            id: 'ws-1',
            name: 'WS',
            role: 'staff',
          },
          csrf_token: 'csrf-1',
        },
      });
      assert.ok(parsed);
      assert.equal(parsed.userEmail, 'test@example.com');
      assert.equal(parsed.emailVerified, false);
      assert.equal(
        determinePostVerificationRoute('/verify-email', false),
        null,
        '/verify-email must remain accessible when unauthenticated',
      );
    },
  );

  await t.test(
    'renders unverified notice and sends resend verification request on submit',
    async () => {
      const origFetch = globalThis.fetch;
      const calls = [];
      globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              message: 'Đã gửi liên kết xác minh qua email.',
              delivery_status: 'EMAIL_SENT',
            },
          }),
        };
      };

      const { container, root, flush, cleanup } = createTestContainer();
      try {
        await act(async () => {
          root.render(
            React.createElement(VerifyEmailScreen, {
              initialEmail: 'unverified@example.com',
              isEmailVerified: false,
              isLoggedIn: true,
              onNavigate: () => {},
            }),
          );
        });
        await flush();

        const notice = container.querySelector(
          '[data-testid="verify-email-unverified-notice"]',
        );
        assert.ok(notice, 'Must display unverified email notice');

        const resendForm = container.querySelector(
          '[data-testid="verify-email-resend-form"]',
        );
        assert.ok(resendForm, 'Must render resend form');

        await act(async () => {
          await getProps(resendForm).onSubmit({ preventDefault: () => {} });
        });
        await flush();

        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, '/api/v1/auth/verify-email/request');
        const successBanner = container.querySelector(
          '[data-testid="verify-email-resend-success"]',
        );
        assert.ok(successBanner, 'Must display resend success message');
      } finally {
        globalThis.fetch = origFetch;
        await cleanup();
      }
    },
  );

  await t.test(
    'auto-confirms valid token and renders confirmation success state',
    async () => {
      const origFetch = globalThis.fetch;
      let verifiedCallbackFired = false;
      globalThis.fetch = async (url) => {
        assert.equal(url, '/api/v1/auth/verify-email/confirm');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              email_verified: true,
              message: 'Xác minh email thành công!',
            },
          }),
        };
      };

      const { container, root, flush, cleanup } = createTestContainer();
      try {
        await act(async () => {
          root.render(
            React.createElement(VerifyEmailScreen, {
              initialToken: 'valid-verification-token-abc1234567890',
              isEmailVerified: false,
              onNavigate: () => {},
              onVerified: () => {
                verifiedCallbackFired = true;
              },
            }),
          );
        });
        await flush(40);

        const successEl = container.querySelector(
          '[data-testid="verify-email-success"]',
        );
        assert.ok(successEl, 'Must render confirmation success state');
        assert.equal(verifiedCallbackFired, true);
      } finally {
        globalThis.fetch = origFetch;
        await cleanup();
      }
    },
  );

  await t.test(
    'renders failure state when token is expired or invalid',
    async () => {
      const origFetch = globalThis.fetch;
      globalThis.fetch = async () => ({
        ok: false,
        status: 400,
        json: async () => ({
          success: false,
          error: {
            code: 'TOKEN_EXPIRED',
            message: 'Mã xác minh đã hết hạn.',
          },
        }),
      });

      const { container, root, flush, cleanup } = createTestContainer();
      try {
        await act(async () => {
          root.render(
            React.createElement(VerifyEmailScreen, {
              initialToken: 'expired-verification-token-xyz',
              isEmailVerified: false,
              onNavigate: () => {},
            }),
          );
        });
        await flush(40);

        const errorEl = container.querySelector(
          '[data-testid="verify-email-error"]',
        );
        assert.ok(errorEl, 'Must render confirmation error state');
        assert.ok(
          errorEl.textContent.includes('hết hạn'),
          'Error banner must mention token expiration',
        );
      } finally {
        globalThis.fetch = origFetch;
        await cleanup();
      }
    },
  );

  await t.test(
    'extracts #token from location.hash and confirms even when another session has isEmailVerified=true, without triggering session-expired redirect',
    async () => {
      const {
        isTargetAuthenticatedApiUrl,
        triggerSessionExpired,
        addSessionExpiredListener,
        resetSessionExpiredState,
      } = await import('../../dist/apps/web/src/auth-interceptor.js');

      assert.equal(
        isTargetAuthenticatedApiUrl(
          '/api/v1/auth/verify-email/confirm',
          'http://localhost:3101',
        ),
        false,
      );
      assert.equal(
        isTargetAuthenticatedApiUrl(
          '/api/v1/auth/verify-email/request',
          'http://localhost:3101',
        ),
        false,
      );

      window.location.pathname = '/verify-email';
      window.location.hash = '#token=hash-token-from-email-link';
      resetSessionExpiredState();
      let expiredFired = false;
      const unsub = addSessionExpiredListener(() => {
        expiredFired = true;
      });
      triggerSessionExpired('/api/v1/auth/me');
      assert.equal(
        expiredFired,
        false,
        'Must not trigger session-expired redirect on /verify-email',
      );
      unsub();

      let confirmSubmittedToken = null;
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        if (String(url).includes('/api/v1/auth/verify-email/confirm')) {
          confirmSubmittedToken = JSON.parse(init.body).token;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              email_verified: true,
              verified_at: new Date().toISOString(),
              message: 'Xác minh email thành công.',
            },
          }),
        };
      };

      const { container, root, flush, cleanup } = createTestContainer();
      try {
        // First: render without hash token while isEmailVerified=true -> must NOT show false success banner
        window.location.hash = '';
        await act(async () => {
          root.render(
            React.createElement(VerifyEmailScreen, {
              isEmailVerified: true,
              isLoggedIn: true,
              onNavigate: () => {},
            }),
          );
        });
        await flush(30);

        assert.equal(
          container.querySelector('[data-testid="verify-email-success"]'),
          null,
          'Must never show false success banner before POST /api/v1/auth/verify-email/confirm succeeds',
        );
        assert.ok(
          container.querySelector('[data-testid="verify-email-confirm-form"]'),
          'Token input form must remain visible when opening /verify-email to paste token',
        );

        // Second: simulate pasting #token=... into address bar of already-open /verify-email tab (hashchange)
        window.location.hash = '#token=hash-token-from-email-link';
        await act(async () => {
          window.dispatchEvent(new Event('hashchange'));
        });
        await flush(40);

        assert.equal(confirmSubmittedToken, 'hash-token-from-email-link');
        const successEl = container.querySelector(
          '[data-testid="verify-email-success"]',
        );
        assert.ok(successEl);
      } finally {
        globalThis.fetch = origFetch;
        window.location.hash = '';
        await cleanup();
      }
    },
  );
});
