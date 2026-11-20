import type http from 'node:http';
import net from 'node:net';
import type { WebCustomerProfile } from '../../../../packages/contracts/src/web-customers.js';
import {
  generateCsrfToken,
  verifyCsrfToken,
  verifyOrigin,
} from '../../../../packages/security/src/csrf.js';
import { timingSafeEqualTokens } from '../../../../packages/security/src/tokens.js';
import { parseCookies } from '../cookie.js';
import { AuthError } from '../auth/service.js';

export const CUSTOMER_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface AuthenticatedCustomerContext {
  sessionId: string;
  sessionTokenHash: string;
  workspaceId: string;
  customer: WebCustomerProfile;
}

export interface WebCustomerSessionResolver {
  resolveSession(
    rawToken: string,
  ): Promise<AuthenticatedCustomerContext | null>;
}

/**
 * Returns the canonical isolated customer session cookie name.
 * Completely separate from staff session cookies (__Host-mglite_session / mglite_session).
 */
export function getCustomerCookieName(isProduction: boolean): string {
  return isProduction ? '__Host-gcn_customer' : 'gcn_customer';
}

/**
 * Derives the customer-scoped CSRF secret, domain-separated from staff CSRF tokens.
 */
export function getCustomerCsrfSecret(csrfSecret: string): string {
  return `${csrfSecret}:customer`;
}

/**
 * Generates an HMAC-SHA256 CSRF token cryptographically bound to the customer session token hash.
 */
export function generateCustomerCsrfToken(
  sessionTokenHash: string,
  csrfSecret: string,
): string {
  return generateCsrfToken(sessionTokenHash, getCustomerCsrfSecret(csrfSecret));
}

/**
 * Serializes the customer session cookie (30-day TTL, HttpOnly, SameSite=Lax, Path=/, Secure in prod).
 */
export function serializeCustomerCookie(
  token: string,
  isProduction: boolean,
  options: { secure?: boolean | undefined } = {},
): string {
  const cookieName = getCustomerCookieName(isProduction);
  const secure = options.secure ?? isProduction;
  const expiresDate = new Date(
    Date.now() + CUSTOMER_SESSION_MAX_AGE_SECONDS * 1000,
  );
  const parts = [
    `${cookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${CUSTOMER_SESSION_MAX_AGE_SECONDS}`,
    `Expires=${expiresDate.toUTCString()}`,
    'SameSite=Lax',
    'HttpOnly',
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * Serializes an expired customer session cookie to clear it on logout or account deletion.
 */
export function serializeClearCustomerCookie(
  isProduction: boolean,
  options: { secure?: boolean | undefined } = {},
): string {
  const cookieName = getCustomerCookieName(isProduction);
  const secure = options.secure ?? isProduction;
  const parts = [
    `${cookieName}=`,
    'Path=/',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'SameSite=Lax',
    'HttpOnly',
  ];
  if (secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * Extracts ONLY the customer session cookie token from the request.
 * Never reads or falls back to internal staff session cookies.
 */
export function extractCustomerToken(
  req: http.IncomingMessage,
  isProduction: boolean,
): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;
  const cookies = parseCookies(cookieHeader);
  return cookies[getCustomerCookieName(isProduction)];
}

/**
 * Enforces isolated customer session authentication.
 * Rejects staff cookies, missing/expired/revoked sessions, and non-active customers with 401.
 */
export async function requireCustomer(
  service: WebCustomerSessionResolver,
  req: http.IncomingMessage,
  isProduction: boolean,
): Promise<AuthenticatedCustomerContext> {
  const token = extractCustomerToken(req, isProduction);
  if (!token) {
    throw new AuthError(
      'UNAUTHENTICATED',
      'Vui lòng đăng nhập để tiếp tục.',
      401,
    );
  }

  const context = await service.resolveSession(token);
  if (!context || context.customer.status !== 'active') {
    throw new AuthError(
      'UNAUTHENTICATED',
      'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
      401,
    );
  }

  return context;
}

/**
 * Enforces Origin/Referer verification and customer-scoped CSRF token for mutating customer requests.
 * Fails closed with 403 FORBIDDEN on mismatch or missing header.
 */
export function requireCustomerCsrf(
  req: http.IncomingMessage,
  customerContext: AuthenticatedCustomerContext,
  csrfSecret: string,
  allowedOrigins: string[],
): void {
  const method = req.method?.toUpperCase() || 'GET';
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return;
  }

  const originValid = verifyOrigin(
    req.headers as Record<string, string | string[] | undefined>,
    allowedOrigins,
  );
  if (!originValid) {
    throw new AuthError(
      'FORBIDDEN',
      'Nguồn truy cập (Origin) không được phép.',
      403,
    );
  }

  const submittedToken = req.headers['x-csrf-token'];
  const tokenValid = verifyCsrfToken(
    submittedToken,
    customerContext.sessionTokenHash,
    getCustomerCsrfSecret(csrfSecret),
  );
  if (!tokenValid) {
    throw new AuthError(
      'FORBIDDEN',
      'Mã bảo mật CSRF không hợp lệ hoặc bị thiếu.',
      403,
    );
  }
}

/**
 * Resolves the customer's client IP.
 * ONLY trusts X-GCN-Client-IP when X-GCN-Proxy-Secret matches configured GCN_PROXY_SECRET
 * in constant time and X-GCN-Client-IP is a valid IPv4/IPv6 literal.
 * Otherwise ignores X-GCN-Client-IP and returns fallbackIp (computed by getClientIp).
 */
export function resolveCustomerClientIp(
  req: http.IncomingMessage,
  fallbackIp: string,
  gcnProxySecret?: string,
): string {
  const expectedSecret = gcnProxySecret?.trim() ?? '';
  if (expectedSecret.length > 0) {
    const rawSecret = req.headers['x-gcn-proxy-secret'];
    const providedSecret = Array.isArray(rawSecret) ? rawSecret[0] : rawSecret;
    if (
      typeof providedSecret === 'string' &&
      providedSecret.length > 0 &&
      timingSafeEqualTokens(providedSecret, expectedSecret)
    ) {
      const rawClientIp = req.headers['x-gcn-client-ip'];
      const candidate = (
        Array.isArray(rawClientIp) ? rawClientIp[0] : rawClientIp
      )?.trim();
      if (candidate && net.isIP(candidate) !== 0) {
        return candidate;
      }
    }
  }
  return fallbackIp;
}
