import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '../..');

test('generateCsrfToken and verifyCsrfToken enforce cryptographic binding and timing-safe equality', async () => {
  const { generateCsrfToken, verifyCsrfToken } = await import(
    `file://${resolve(root, 'dist/packages/security/src/csrf.js')}`
  );

  const sessionHash1 = 'a'.repeat(64);
  const sessionHash2 = 'b'.repeat(64);
  const secret = 'test-secret-key-32-bytes-minimum-length-safe';

  const token1 = generateCsrfToken(sessionHash1, secret);
  const token2 = generateCsrfToken(sessionHash2, secret);

  assert.equal(typeof token1, 'string');
  assert.equal(token1.length, 64);
  assert.notEqual(token1, token2);

  // Exact verification
  assert.equal(verifyCsrfToken(token1, sessionHash1, secret), true);
  assert.equal(verifyCsrfToken(token2, sessionHash2, secret), true);

  // Mismatched session hash
  assert.equal(verifyCsrfToken(token1, sessionHash2, secret), false);

  // Mismatched secret
  assert.equal(
    verifyCsrfToken(token1, sessionHash1, 'different-secret-key-safe'),
    false,
  );

  // Tampered token
  const tampered = token1.slice(0, -1) + (token1.slice(-1) === 'a' ? 'b' : 'a');
  assert.equal(verifyCsrfToken(tampered, sessionHash1, secret), false);

  // Empty or invalid types
  assert.equal(verifyCsrfToken('', sessionHash1, secret), false);
  assert.equal(verifyCsrfToken(null, sessionHash1, secret), false);
  assert.equal(verifyCsrfToken(undefined, sessionHash1, secret), false);
  assert.equal(verifyCsrfToken(12345, sessionHash1, secret), false);

  // Validation errors on empty arguments
  assert.throws(() => generateCsrfToken('', secret), /sessionTokenHash/);
  assert.throws(() => generateCsrfToken(sessionHash1, ''), /secretKey/);
});

test('verifyOrigin validates Origin and Referer headers against allowed origins and fails closed', async () => {
  const { verifyOrigin } = await import(
    `file://${resolve(root, 'dist/packages/security/src/csrf.js')}`
  );

  const allowed = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://app.management-lite.test',
  ];

  // Valid Origin
  assert.equal(
    verifyOrigin({ origin: 'http://localhost:3000' }, allowed),
    true,
  );
  assert.equal(
    verifyOrigin({ origin: 'https://app.management-lite.test' }, allowed),
    true,
  );

  // Disallowed Origin
  assert.equal(
    verifyOrigin({ origin: 'http://evil-attacker.com' }, allowed),
    false,
  );

  // Referer fallback when Origin is omitted
  assert.equal(
    verifyOrigin({ referer: 'http://localhost:3000/dashboard' }, allowed),
    true,
  );
  assert.equal(
    verifyOrigin(
      { referer: 'https://app.management-lite.test/login' },
      allowed,
    ),
    true,
  );
  assert.equal(
    verifyOrigin({ referer: 'http://evil-attacker.com/csrf-page' }, allowed),
    false,
  );

  // Fail closed when both headers are missing
  assert.equal(verifyOrigin({}, allowed), false);
  assert.equal(verifyOrigin({ origin: '' }, allowed), false);
  assert.equal(verifyOrigin({ referer: '' }, allowed), false);
  assert.equal(verifyOrigin({ referer: 'not-a-valid-url' }, allowed), false);

  // Empty allowed origins fails closed
  assert.equal(verifyOrigin({ origin: 'http://localhost:3000' }, []), false);
});

test('Cookie parser and serializers enforce security flags and environment-specific naming', async () => {
  const {
    parseCookies,
    serializeSessionCookie,
    serializeClearSessionCookie,
    getSessionCookieName,
  } = await import(`file://${resolve(root, 'dist/apps/api/src/cookie.js')}`);

  // Cookie names
  assert.equal(getSessionCookieName(false), 'mglite_session');
  assert.equal(getSessionCookieName(true), '__Host-mglite_session');

  // Serialization (Development)
  const devCookie = serializeSessionCookie('dummy-session-token-1234', {
    isProduction: false,
  });
  assert.ok(devCookie.includes('mglite_session=dummy-session-token-1234'));
  assert.ok(devCookie.includes('HttpOnly'));
  assert.ok(devCookie.includes('SameSite=Lax'));
  assert.ok(devCookie.includes('Path=/'));
  assert.ok(devCookie.includes('Max-Age=43200'));
  assert.ok(!devCookie.includes('Secure'));

  // Serialization (Production)
  const prodCookie = serializeSessionCookie('dummy-session-token-1234', {
    isProduction: true,
  });
  assert.ok(
    prodCookie.includes('__Host-mglite_session=dummy-session-token-1234'),
  );
  assert.ok(prodCookie.includes('HttpOnly'));
  assert.ok(prodCookie.includes('SameSite=Lax'));
  assert.ok(prodCookie.includes('Path=/'));
  assert.ok(prodCookie.includes('Secure'));

  // Clear cookie serialization
  const clearCookie = serializeClearSessionCookie({ isProduction: false });
  assert.ok(clearCookie.includes('mglite_session='));
  assert.ok(clearCookie.includes('Max-Age=0'));
  assert.ok(clearCookie.includes('HttpOnly'));

  // Parsing
  const parsed = parseCookies(
    'mglite_session=dummy-token-val; other_cookie=hello%20world; empty_val=',
  );
  assert.equal(parsed['mglite_session'], 'dummy-token-val');
  assert.equal(parsed['other_cookie'], 'hello world');
  assert.equal(parsed['empty_val'], '');
  assert.deepEqual(parseCookies(undefined), {});
  assert.deepEqual(parseCookies(''), {});
});

test('RateLimiter enforces sliding window limits, blocks abuse, and reports retryAfterSeconds', async () => {
  const { RateLimiter } = await import(
    `file://${resolve(root, 'dist/apps/api/src/rate-limiter.js')}`
  );

  const limiter = new RateLimiter({ windowMs: 1000, maxAttempts: 3 });
  const key = '127.0.0.1:auth_test';

  const r1 = limiter.increment(key);
  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining, 2);

  const r2 = limiter.increment(key);
  assert.equal(r2.allowed, true);
  assert.equal(r2.remaining, 1);

  const r3 = limiter.increment(key);
  assert.equal(r3.allowed, true);
  assert.equal(r3.remaining, 0);

  // Exceeded
  const r4 = limiter.increment(key);
  assert.equal(r4.allowed, false);
  assert.equal(r4.remaining, 0);
  assert.ok(r4.retryAfterSeconds >= 1);

  // Check without increment
  const rCheck = limiter.check(key);
  assert.equal(rCheck.allowed, false);

  // Reset
  limiter.reset(key);
  const rAfterReset = limiter.increment(key);
  assert.equal(rAfterReset.allowed, true);
  assert.equal(rAfterReset.remaining, 2);
});

test('CSRF configuration fails closed in production when secret is missing, short, weak, or default', async () => {
  const { loadApiConfig, DEV_DEFAULT_CSRF_SECRET } = await import(
    `file://${resolve(root, 'dist/apps/api/src/config.js')}`
  );
  const { createRequestHandler } = await import(
    `file://${resolve(root, 'dist/apps/api/src/app.js')}`
  );

  // 1. Missing CSRF_SECRET in production
  assert.throws(
    () => loadApiConfig({ NODE_ENV: 'production' }),
    /FATAL: CSRF_SECRET environment variable is required in production/,
  );

  // 2. Secret too short (< 32 chars) in production
  assert.throws(
    () =>
      loadApiConfig({ NODE_ENV: 'production', CSRF_SECRET: 'short_key_123' }),
    /FATAL: CSRF_SECRET must be at least 32 characters in production/,
  );

  // 3. Dev default secret used in production
  assert.throws(
    () =>
      loadApiConfig({
        NODE_ENV: 'production',
        CSRF_SECRET: DEV_DEFAULT_CSRF_SECRET,
      }),
    /FATAL: CSRF_SECRET in production must not use the development default secret/,
  );

  // 4. Repeated character or trivial weak secret in production
  assert.throws(
    () =>
      loadApiConfig({
        NODE_ENV: 'production',
        CSRF_SECRET: 'a'.repeat(32),
      }),
    /FATAL: CSRF_SECRET in production is too weak/,
  );

  // 5. Valid strong production secret passes
  const validProductionSecret =
    'c09f87b6451e0f6b48d655f4124976c72834b9cf05952f4477123985faefcb50';
  const validConfig = loadApiConfig({
    NODE_ENV: 'production',
    CSRF_SECRET: validProductionSecret,
    TRUSTED_PROXIES: '10.0.0.1, 10.0.0.2',
  });
  assert.equal(validConfig.isProduction, true);
  assert.equal(validConfig.csrfSecret, validProductionSecret);
  assert.deepEqual(validConfig.trustedProxies, ['10.0.0.1', '10.0.0.2']);

  // 6. createRequestHandler fails closed when instantiated in production without secure secret
  assert.throws(
    () => createRequestHandler({ isProduction: true }),
    /FATAL: CSRF_SECRET environment variable is required in production/,
  );
  assert.throws(
    () =>
      createRequestHandler({
        isProduction: true,
        csrfSecret: DEV_DEFAULT_CSRF_SECRET,
      }),
    /FATAL: CSRF_SECRET in production must not use the development default secret/,
  );
});

test('getClientIp ignores spoofed X-Forwarded-For headers from untrusted connections and respects trusted proxies', async () => {
  const { getClientIp } = await import(
    `file://${resolve(root, 'dist/apps/api/src/app.js')}`
  );

  // Fake request helper
  function makeFakeReq(remoteAddress, xForwardedFor) {
    return {
      socket: { remoteAddress },
      headers: xForwardedFor ? { 'x-forwarded-for': xForwardedFor } : {},
    };
  }

  // Untrusted client: trustedProxies is empty (default)
  const reqUntrusted = makeFakeReq('203.0.113.195', '198.51.100.1, 10.0.0.1');
  const ip1 = getClientIp(reqUntrusted, []);
  assert.equal(
    ip1,
    '203.0.113.195',
    'Must ignore spoofed header when proxy untrusted',
  );

  // Untrusted client: trustedProxies configured with other IPs
  const ip2 = getClientIp(reqUntrusted, ['10.0.0.1', '10.0.0.2']);
  assert.equal(
    ip2,
    '203.0.113.195',
    'Must ignore spoofed header when socket IP is not in trustedProxies',
  );

  // Trusted proxy connection: remoteAddress matches trustedProxies
  const reqFromTrustedProxy = makeFakeReq('10.0.0.1', '203.0.113.50, 10.0.0.1');
  const ip3 = getClientIp(reqFromTrustedProxy, ['10.0.0.1']);
  assert.equal(
    ip3,
    '203.0.113.50',
    'Must resolve real client IP when forwarded by trusted proxy',
  );
});
