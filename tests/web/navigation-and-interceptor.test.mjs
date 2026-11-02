import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizePostLoginRedirect } from '../../dist/apps/web/src/navigation-guard.js';
import { isTargetAuthenticatedApiUrl } from '../../dist/apps/web/src/auth-interceptor.js';

test('NAVIGATION GUARD: Open redirect and malicious path rejection', () => {
  // Protocol-relative evasion
  assert.equal(sanitizePostLoginRedirect('//evil.com'), '/');
  assert.equal(sanitizePostLoginRedirect('//evil.com/path'), '/');
  assert.equal(sanitizePostLoginRedirect('///evil.com'), '/');
  assert.equal(sanitizePostLoginRedirect('/\\evil.com'), '/');
  assert.equal(sanitizePostLoginRedirect('\\\\evil.com'), '/');

  // Scheme injections
  assert.equal(sanitizePostLoginRedirect('javascript:alert(1)'), '/');
  assert.equal(
    sanitizePostLoginRedirect('data:text/html,<script>alert(1)</script>'),
    '/',
  );
  assert.equal(sanitizePostLoginRedirect('https://evil.com'), '/');
  assert.equal(sanitizePostLoginRedirect('http://evil.com'), '/');

  // Control characters and NULL bytes
  assert.equal(sanitizePostLoginRedirect('/clock\x00'), '/');
  assert.equal(sanitizePostLoginRedirect('/clock\r\n'), '/');
  assert.equal(sanitizePostLoginRedirect('/clock\x1b[31m'), '/');

  // Double encoding and encoded slashes
  assert.equal(sanitizePostLoginRedirect('/%2f%2fevil.com'), '/');
  assert.equal(sanitizePostLoginRedirect('%2f%2fevil.com'), '/');
  assert.equal(sanitizePostLoginRedirect('/path%00evil'), '/');

  // Backslashes anywhere in path
  assert.equal(sanitizePostLoginRedirect('/clock\\issues'), '/');

  // Colons anywhere in path
  assert.equal(sanitizePostLoginRedirect('/clock:8080'), '/');

  // Public auth pages (should not loop back to auth pages after login)
  assert.equal(sanitizePostLoginRedirect('/login'), '/');
  assert.equal(sanitizePostLoginRedirect('/forgot-password'), '/');
  assert.equal(sanitizePostLoginRedirect('/reset-password?token=xyz123'), '/');

  // Non-string or empty inputs
  assert.equal(sanitizePostLoginRedirect(null), '/');
  assert.equal(sanitizePostLoginRedirect(undefined), '/');
  assert.equal(sanitizePostLoginRedirect(''), '/');
  assert.equal(sanitizePostLoginRedirect('   '), '/');
  assert.equal(sanitizePostLoginRedirect(12345), '/');
  assert.equal(sanitizePostLoginRedirect({}), '/');

  // Legitimate internal routes (must be preserved!)
  assert.equal(sanitizePostLoginRedirect('/clock'), '/clock');
  assert.equal(sanitizePostLoginRedirect('/issues'), '/issues');
  assert.equal(
    sanitizePostLoginRedirect('/employees?filter=active'),
    '/employees?filter=active',
  );
  assert.equal(
    sanitizePostLoginRedirect('/reports/payroll#section-1'),
    '/reports/payroll#section-1',
  );
  assert.equal(sanitizePostLoginRedirect('/'), '/');
});

test('AUTH INTERCEPTOR: URL evaluation security and precision', () => {
  const localOrigin = 'http://127.0.0.1:3001';

  // 1. External services must NEVER be intercepted (never redirect on 3rd party 401s)
  assert.equal(
    isTargetAuthenticatedApiUrl(
      'https://api.external-partner.com/api/v1/sync',
      localOrigin,
    ),
    false,
    'External origins must be rejected',
  );
  assert.equal(
    isTargetAuthenticatedApiUrl('https://google.com/api/v1/oauth', localOrigin),
    false,
    'External google origin must be rejected',
  );

  // 2. Exact public authentication routes must NOT be intercepted (bad password login, forgot, reset)
  assert.equal(
    isTargetAuthenticatedApiUrl('/api/v1/auth/login', localOrigin),
    false,
    'POST /api/v1/auth/login must NOT be intercepted on wrong password',
  );
  assert.equal(
    isTargetAuthenticatedApiUrl(
      'http://127.0.0.1:3002/api/v1/auth/login',
      localOrigin,
    ),
    false,
    'Full URL login endpoint must NOT be intercepted',
  );
  assert.equal(
    isTargetAuthenticatedApiUrl('/api/v1/auth/forgot-password', localOrigin),
    false,
    'Forgot password endpoint must NOT be intercepted',
  );
  assert.equal(
    isTargetAuthenticatedApiUrl('/api/v1/auth/reset-password', localOrigin),
    false,
    'Reset password endpoint must NOT be intercepted',
  );
  assert.equal(
    isTargetAuthenticatedApiUrl('/api/v1/auth/refresh', localOrigin),
    false,
    'Silent session refresh endpoint must NOT be intercepted recursively',
  );

  // 3. Legitimate APIs with "login" in query parameters MUST be intercepted (Codex P2 item 13 fix)
  assert.equal(
    isTargetAuthenticatedApiUrl('/api/v1/audit?search=login', localOrigin),
    true,
    'Audits API with query ?search=login MUST be intercepted',
  );
  assert.equal(
    isTargetAuthenticatedApiUrl(
      '/api/v1/issues?filter=login_issue',
      localOrigin,
    ),
    true,
    'Issues API with query ?filter=login_issue MUST be intercepted',
  );
  assert.equal(
    isTargetAuthenticatedApiUrl(
      'http://127.0.0.1:3002/api/v1/reports?tag=login',
      localOrigin,
    ),
    true,
    'Reports API with tag=login MUST be intercepted',
  );

  // 4. Standard internal authenticated APIs MUST be intercepted
  assert.equal(
    isTargetAuthenticatedApiUrl('/api/v1/attendance/me', localOrigin),
    true,
  );
  assert.equal(
    isTargetAuthenticatedApiUrl('/api/v1/auth/me', localOrigin),
    true,
  );
  assert.equal(
    isTargetAuthenticatedApiUrl('/api/v1/employees', localOrigin),
    true,
  );
  assert.equal(
    isTargetAuthenticatedApiUrl(
      'http://127.0.0.1:3002/api/v1/issues',
      localOrigin,
    ),
    true,
  );

  // 5. Non-API paths should not be intercepted
  assert.equal(
    isTargetAuthenticatedApiUrl('/static/bundle.js', localOrigin),
    false,
  );
  assert.equal(
    isTargetAuthenticatedApiUrl('/assets/icon.png', localOrigin),
    false,
  );
});
