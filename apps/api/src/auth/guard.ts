import type http from 'node:http';
import type { UserRole } from '../../../../packages/contracts/src/auth.js';
import {
  verifyCsrfToken,
  verifyOrigin,
} from '../../../../packages/security/src/csrf.js';
import { getSessionCookieName, parseCookies } from '../cookie.js';
import {
  AuthError,
  type AuthenticatedContext,
  type AuthService,
} from './service.js';

/**
 * Extracts raw session token from HTTP request Cookie header.
 * When a custom session cookie name is explicitly configured (via customCookieName
 * or SESSION_COOKIE_NAME env var), strict isolation is enforced: ONLY that configured
 * cookie name is accepted (no fallback to default) to prevent cross-session leakage.
 * When no custom cookie name is configured, standard default cookie naming is used.
 */
export function extractSessionToken(
  req: http.IncomingMessage,
  isProduction: boolean,
  customCookieName?: string,
): string | undefined {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return undefined;
  const cookies = parseCookies(cookieHeader);

  const rawConfigured = (
    customCookieName ??
    process.env['SESSION_COOKIE_NAME'] ??
    ''
  ).trim();

  if (rawConfigured.length > 0) {
    const configuredName = getSessionCookieName(isProduction, rawConfigured);
    return cookies[configuredName];
  }

  const defaultName = isProduction ? '__Host-mglite_session' : 'mglite_session';
  return cookies[defaultName];
}

function elevateDelegatedContextForRequest(
  context: AuthenticatedContext,
  rawUrl: string,
): AuthenticatedContext {
  if (context.workspace.role === 'owner') {
    return context;
  }
  const perms = context.subPermissions;
  if (!perms || perms.length === 0) {
    return context;
  }
  const pathname = rawUrl.split('?')[0] || '/';
  const has = (p: string) => perms.includes(p);

  let matched = false;
  if (
    has('attendance:review') &&
    (pathname.startsWith('/api/v1/attendance/shifts') ||
      pathname.startsWith('/api/v1/attendance/import') ||
      (pathname.startsWith('/api/v1/schedules') &&
        pathname !== '/api/v1/schedules/my-week'))
  ) {
    matched = true;
  } else if (
    has('work:manage') &&
    (pathname.startsWith('/api/v1/work-items') ||
      (pathname.startsWith('/api/v1/daily-reports') &&
        pathname !== '/api/v1/daily-reports/me') ||
      pathname === '/api/v1/dashboard/summary')
  ) {
    matched = true;
  } else if (
    has('employees:manage') &&
    ((pathname.startsWith('/api/v1/employees') &&
      pathname !== '/api/v1/employees/me') ||
      pathname === '/api/v1/dashboard/summary')
  ) {
    matched = true;
  } else if (
    has('accounts:manage') &&
    (pathname.startsWith('/api/v1/accounts') ||
      pathname.startsWith('/api/v1/storage') ||
      pathname === '/api/v1/auth/reauth')
  ) {
    matched = true;
  } else if (
    has('payroll:manage') &&
    pathname.startsWith('/api/v1/payroll') &&
    pathname !== '/api/v1/payroll/me'
  ) {
    matched = true;
  } else if (has('finance:manage') && pathname.startsWith('/api/v1/finance')) {
    matched = true;
  }

  if (!matched) {
    return context;
  }

  return {
    ...context,
    trueRole: context.trueRole ?? context.workspace.role,
    workspace: {
      ...context.workspace,
      role: 'owner',
    },
  };
}

/**
 * Enforces session authentication for protected routes.
 * Throws 401 UNAUTHENTICATED if session is missing, expired, or invalid.
 */
export async function requireAuth(
  authService: AuthService,
  req: http.IncomingMessage,
  isProduction: boolean,
  customCookieName?: string,
): Promise<AuthenticatedContext> {
  const token = extractSessionToken(req, isProduction, customCookieName);
  if (!token) {
    throw new AuthError('UNAUTHENTICATED', 'Authentication required', 401);
  }

  const context = await authService.resolveSession(token);
  if (!context) {
    throw new AuthError(
      'UNAUTHENTICATED',
      'Session is invalid, expired, or revoked',
      401,
    );
  }

  return elevateDelegatedContextForRequest(context, req.url || '/');
}

/**
 * Enforces Origin/Referer check and HMAC-SHA256 CSRF token for mutating requests.
 * Fails closed with 403 FORBIDDEN if check fails.
 */
export function requireCsrf(
  req: http.IncomingMessage,
  sessionContext: AuthenticatedContext,
  csrfSecret: string,
  allowedOrigins: string[],
): void {
  const method = req.method?.toUpperCase() || 'GET';
  const isMutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
  if (!isMutating) return;

  // 1. Origin / Referer validation
  const originValid = verifyOrigin(
    req.headers as Record<string, string | string[] | undefined>,
    allowedOrigins,
  );
  if (!originValid) {
    throw new AuthError(
      'FORBIDDEN',
      'Origin or Referer verification failed for mutating request',
      403,
    );
  }

  // 2. CSRF Token header validation
  const submittedToken = req.headers['x-csrf-token'];
  const tokenValid = verifyCsrfToken(
    submittedToken,
    sessionContext.sessionTokenHash,
    csrfSecret,
  );
  if (!tokenValid) {
    throw new AuthError(
      'FORBIDDEN',
      'Invalid, missing, or mismatched CSRF token',
      403,
    );
  }
}

/**
 * Enforces Role-Based Access Control (RBAC) on the active workspace membership.
 * Fails closed with 403 FORBIDDEN if role is not allowed.
 */
export function requireRole(
  allowedRoles: UserRole[],
  sessionContext: AuthenticatedContext,
): void {
  if (!allowedRoles.includes(sessionContext.workspace.role)) {
    throw new AuthError(
      'FORBIDDEN',
      'Insufficient permissions for this operation',
      403,
    );
  }
}

/**
 * Enforces strict workspace resource isolation.
 * Per canonical Doc 04 & Doc 24, cross-workspace resources are concealed with 404 NOT_FOUND.
 */
export function assertWorkspaceResource(
  resourceWorkspaceId: string,
  sessionContext: AuthenticatedContext,
): void {
  if (resourceWorkspaceId !== sessionContext.workspace.id) {
    throw new AuthError('NOT_FOUND', 'Resource not found', 404);
  }
}
