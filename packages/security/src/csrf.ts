import crypto from 'node:crypto';
import { timingSafeEqualTokens } from './tokens.js';

/**
 * Generates an HMAC-SHA256 CSRF token cryptographically bound to the session token hash.
 */
export function generateCsrfToken(
  sessionTokenHash: string,
  secretKey: string,
): string {
  if (!sessionTokenHash || typeof sessionTokenHash !== 'string') {
    throw new Error('sessionTokenHash must be a non-empty string');
  }
  if (!secretKey || typeof secretKey !== 'string') {
    throw new Error('secretKey must be a non-empty string');
  }

  return crypto
    .createHmac('sha256', secretKey)
    .update(`csrf:${sessionTokenHash}`, 'utf8')
    .digest('hex');
}

/**
 * Verifies that a submitted CSRF token matches the expected HMAC for the session in constant time.
 */
export function verifyCsrfToken(
  submittedToken: unknown,
  sessionTokenHash: string,
  secretKey: string,
): boolean {
  if (typeof submittedToken !== 'string' || submittedToken.length === 0) {
    return false;
  }

  try {
    const expected = generateCsrfToken(sessionTokenHash, secretKey);
    return timingSafeEqualTokens(submittedToken, expected);
  } catch {
    return false;
  }
}

/**
 * Verifies that the Origin or Referer header matches an allowed origin to prevent cross-origin state-changing attacks.
 * Fails closed if neither Origin nor Referer is present on unsafe HTTP methods.
 */
export function verifyOrigin(
  headers: Record<string, string | string[] | undefined>,
  allowedOrigins: string[],
): boolean {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    return false;
  }

  // 1. Origin header check (preferred)
  const rawOrigin = headers['origin'];
  const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
  if (typeof origin === 'string' && origin.length > 0) {
    return allowedOrigins.includes(origin);
  }

  // 2. Referer fallback check
  const rawReferer = headers['referer'];
  const referer = Array.isArray(rawReferer) ? rawReferer[0] : rawReferer;
  if (typeof referer === 'string' && referer.length > 0) {
    try {
      const refererUrl = new URL(referer);
      return allowedOrigins.includes(refererUrl.origin);
    } catch {
      return false;
    }
  }

  // Fail closed if neither Origin nor Referer is present
  return false;
}
