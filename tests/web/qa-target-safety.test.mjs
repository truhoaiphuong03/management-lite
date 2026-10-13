import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  validateQaTarget,
  sanitizeErrorMessage,
  verifyIsolatedQaService,
} from '../../scripts/qa-target-safety.mjs';

test('QA Target Safety: Fails closed when QA_WEB_BASE is missing or empty', () => {
  assert.throws(
    () => validateQaTarget(undefined),
    /Explicit isolated QA_WEB_BASE is required/,
  );
  assert.throws(
    () => validateQaTarget(''),
    /Explicit isolated QA_WEB_BASE is required/,
  );
  assert.throws(
    () => validateQaTarget('   '),
    /Explicit isolated QA_WEB_BASE is required/,
  );
});

test('QA Target Safety: Rejects production domains, public IPs, and LAN IPs', () => {
  // Production domains
  assert.throws(
    () => validateQaTarget('http://management-lite.com:3037'),
    /Non-loopback QA target refused/,
  );
  assert.throws(
    () => validateQaTarget('http://app.production.internal:3037'),
    /Non-loopback QA target refused/,
  );

  // Public IPs
  assert.throws(
    () => validateQaTarget('http://8.8.8.8:3037'),
    /Non-loopback QA target refused/,
  );
  assert.throws(
    () => validateQaTarget('http://1.1.1.1:3037'),
    /Non-loopback QA target refused/,
  );

  // Private LAN IPs (RFC 1918)
  assert.throws(
    () => validateQaTarget('http://192.168.1.100:3037'),
    /Non-loopback QA target refused/,
  );
  assert.throws(
    () => validateQaTarget('http://10.0.0.5:3037'),
    /Non-loopback QA target refused/,
  );
  assert.throws(
    () => validateQaTarget('http://172.16.0.2:3037'),
    /Non-loopback QA target refused/,
  );
});

test('QA Target Safety: Rejects URLs with embedded credentials', () => {
  assert.throws(
    () => validateQaTarget('http://admin:secret123@127.0.0.1:3037'),
    /embedded user credentials/,
  );
  assert.throws(
    () => validateQaTarget('http://user@127.0.0.1:3037'),
    /embedded user credentials/,
  );
});

test('QA Target Safety: Rejects non-HTTP protocols', () => {
  assert.throws(
    () => validateQaTarget('https://127.0.0.1:3037'),
    /must use http protocol/,
  );
  assert.throws(
    () => validateQaTarget('ftp://127.0.0.1:3037'),
    /must use http protocol/,
  );
});

test('QA Target Safety: Rejects missing port and operational/blocked ports', () => {
  // Missing port
  assert.throws(
    () => validateQaTarget('http://127.0.0.1'),
    /specify an explicit non-operational port/,
  );

  // Blocked operational and privileged ports
  for (const port of ['80', '443', '3000', '3004', '3005', '3017', '3018', '3027', '3028', '8080']) {
    assert.throws(
      () => validateQaTarget(`http://127.0.0.1:${port}`),
      /(?:refused|outside valid unprivileged port range)/,
      `Port ${port} must be refused or out of range`,
    );
  }
});

test('QA Target Safety: Allows valid isolated loopback QA target', () => {
  assert.equal(
    validateQaTarget('http://127.0.0.1:3037'),
    'http://127.0.0.1:3037',
  );
  assert.equal(
    validateQaTarget('http://127.0.0.1:3038/'),
    'http://127.0.0.1:3038',
  );
});

test('QA Target Safety: Rejects redirects to untrusted or external hosts', async () => {
  // Mock globalThis.fetch to simulate redirect to external host
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      status: 302,
      headers: {
        get: (h) => (h.toLowerCase() === 'location' ? 'https://malicious-external-site.com/login' : null),
      },
    });

    await assert.rejects(
      () => verifyIsolatedQaService('http://127.0.0.1:3037'),
      /redirects to external or untrusted host/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('QA Target Safety: sanitizeErrorMessage redacts credentials, secrets, and raw CDP timeouts', () => {
  const leakedMsg = 'Error: Authentication failed with password="super_secret_pass_123" and token: abcdef0123456789abcdef0123456789';
  const sanitized = sanitizeErrorMessage(leakedMsg);
  assert.ok(!sanitized.includes('super_secret_pass_123'), 'Password must be redacted');
  assert.ok(!sanitized.includes('abcdef0123456789abcdef0123456789'), 'Hex token must be redacted');
  assert.ok(sanitized.includes('[REDACTED]'), 'Must contain [REDACTED]');

  const cdpTimeout = 'Timeout: (() => { const secret = "123456"; return secret; })()';
  const sanitizedCdp = sanitizeErrorMessage(cdpTimeout);
  assert.equal(sanitizedCdp, 'Browser evaluation timed out');
});
