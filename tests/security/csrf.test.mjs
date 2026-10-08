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
