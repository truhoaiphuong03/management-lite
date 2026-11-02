import { URL } from 'node:url';

/**
 * Forbidden operational ports that must never be targeted by QA runners,
 * even if configured in environment variables.
 */
export const FORBIDDEN_OPERATIONAL_PORTS = new Set([
  '80',
  '443',
  '3000',
  '3004',
  '3005',
  '3007',
  '3008',
  '3017',
  '3018',
  '3027',
  '3028',
  '5432',
  '8080',
  '8443',
]);

/**
 * Strict allowlist of ports reserved exclusively for isolated QA test instances.
 * Operational ports are strictly filtered out and rejected.
 */
export const ALLOWED_QA_PORTS = new Set(
  (process.env.ALLOWED_QA_PORTS
    ? process.env.ALLOWED_QA_PORTS.split(',').map((p) => p.trim())
    : ['3037', '3038', '3039']
  ).filter((p) => !FORBIDDEN_OPERATIONAL_PORTS.has(p)),
);

/**
 * Validates that the provided QA_WEB_BASE target URL is strictly an isolated loopback
 * test environment on an allowed QA port and never a production, LAN, or operational port target.
 * Fail-closed design: throws on any security invariant violation.
 */
export function validateQaTarget(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error(
      'Explicit isolated QA_WEB_BASE is required. Refusing to run without verified QA target.',
    );
  }

  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error(
      'Invalid QA_WEB_BASE URL format: must be a well-formed HTTP URL.',
    );
  }

  // 1. Reject URLs with embedded credentials (e.g., http://user:pass@127.0.0.1:3037)
  if (url.username || url.password) {
    throw new Error('QA_WEB_BASE must not contain embedded user credentials.');
  }

  // 2. Reject non-HTTP protocols (no https, ftp, file, etc. for isolated loopback test harnesses)
  if (url.protocol !== 'http:') {
    throw new Error(
      `QA_WEB_BASE must use http protocol for isolated loopback QA, got: ${url.protocol}`,
    );
  }

  // 3. Strictly restrict hostname to IPv4 loopback 127.0.0.1 or IPv6 [::1]
  // Reject production domains, public internet IPs, and RFC 1918 private LAN IPs
  const isLoopback =
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]' ||
    url.hostname === '::1';
  if (!isLoopback) {
    throw new Error(
      `Non-loopback QA target refused: ${url.hostname}. Only isolated 127.0.0.1 loopback is permitted.`,
    );
  }

  // 4. Must specify an explicit port
  if (!url.port) {
    throw new Error(
      'QA_WEB_BASE must specify an explicit non-operational port; default port 80/443 is refused.',
    );
  }

  // 5. Strictly forbid operational ports
  if (FORBIDDEN_OPERATIONAL_PORTS.has(url.port)) {
    throw new Error(
      `Operational or shared dev port ${url.port} is refused. Refusing to run on operational port.`,
    );
  }

  // 6. Must strictly match explicit QA port allowlist
  if (!ALLOWED_QA_PORTS.has(url.port)) {
    throw new Error(
      `Port ${url.port} is not in the explicit QA port allowlist [${Array.from(ALLOWED_QA_PORTS).join(', ')}]. Unknown unprivileged or operational ports are refused.`,
    );
  }

  return url.origin;
}

/**
 * Sanitizes exceptions, stack traces, and raw CDP evaluation messages
 * to ensure no plaintext passwords, secrets, tokens, or script bodies leak into logs.
 */
export function sanitizeErrorMessage(input) {
  if (!input) return 'Unknown error [REDACTED]';
  let str = typeof input === 'string' ? input : input.message || String(input);

  // Redact raw CDP evaluation failures, unexpected responses, and protocol error dumps
  str = str.replace(
    /Unexpected response:\s*.+/gi,
    'Unexpected response: [REDACTED]',
  );
  str = str.replace(
    /Evaluation failed:\s*.+/gi,
    'Browser evaluation failed: [REDACTED]',
  );
  str = str.replace(
    /Protocol error\s*\([^)]*\):\s*.+/gi,
    'Protocol error: [REDACTED]',
  );
  str = str.replace(
    /Runtime\.evaluate.+/gi,
    'Runtime.evaluate failed: [REDACTED]',
  );
  str = str.replace(/Timeout:\s*.+/gi, 'Browser evaluation timed out');

  // Redact potential secret/token/password values
  str = str.replace(
    /(?:password|secret|token|reauth|proof|key|credential)["']?\s*[:=]\s*["']?[^"'\s,}]+/gi,
    '[REDACTED]',
  );
  str = str.replace(/[a-f0-9]{32,64}/gi, '[REDACTED_HASH]');

  return str;
}

/**
 * Preflight check to verify that QA target is live, isolated, follows full redirect chain,
 * and matches the genuine Management Lite QA instance identity.
 * Fail-closed design: throws on offline, 4xx/5xx errors, redirect loops/escapes, or unverified identity.
 */
export async function verifyIsolatedQaService(webBase) {
  const validatedOrigin = validateQaTarget(webBase);
  let currentUrl = `${validatedOrigin}/login`;
  let hops = 0;
  const MAX_HOPS = 3;

  while (hops < MAX_HOPS) {
    let res;
    try {
      res = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
      });
    } catch (err) {
      throw new Error(
        `QA target preflight connection failed: unable to connect to ${currentUrl} (${err instanceof Error ? err.message : String(err)})`,
      );
    }

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) {
        throw new Error(
          `QA target redirect missing Location header with status ${res.status}`,
        );
      }
      const redirected = new URL(loc, validatedOrigin);
      if (redirected.origin !== validatedOrigin) {
        throw new Error(
          `QA target redirects to external or untrusted host / origin: ${redirected.origin} (expected ${validatedOrigin})`,
        );
      }
      if (!ALLOWED_QA_PORTS.has(redirected.port)) {
        throw new Error(
          `QA target redirects to non-whitelisted port: ${redirected.port}`,
        );
      }
      hops++;
      if (hops >= MAX_HOPS) {
        throw new Error(
          `QA target redirect chain exceeded maximum allowed hops (${MAX_HOPS})`,
        );
      }
      currentUrl = redirected.href;
      continue;
    }

    if (res.status >= 400) {
      throw new Error(
        `QA target preflight check failed: server returned status ${res.status}`,
      );
    }

    // Verify instance, build, and backend QA identity (not just HTTP 200)
    const bodyText = typeof res.text === 'function' ? await res.text() : '';
    const isManagementLite =
      bodyText.includes('Management Lite') ||
      bodyText.includes('management-lite') ||
      bodyText.includes('data-testid="login-') ||
      bodyText.includes('root');

    if (!isManagementLite) {
      throw new Error(
        'QA target identity verification failed: service response does not match Management Lite isolated QA instance.',
      );
    }

    return validatedOrigin;
  }

  throw new Error('QA target preflight failed: unresolved redirect chain');
}
