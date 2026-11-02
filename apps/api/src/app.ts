import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { DatabasePool } from '../../../packages/database/src/pool.js';
import { checkDatabaseHealth } from '../../../packages/database/src/pool.js';
import {
  SYSTEM_COMMIT,
  RELEASE_NOTES_CATALOG,
  type ReleaseHistoryEntry,
} from '../../../packages/contracts/src/version.js';
import {
  createSuccessEnvelope,
  createErrorEnvelope,
  sendJson,
} from './envelope.js';
import { resolveReleaseState } from './release-info.js';
import { AuthService, AuthError } from './auth/service.js';
import { createBrevoResetMailer } from './auth/reset-email.js';
import { EmployeeService } from './employees/service.js';
import { AttendanceService } from './attendance/service.js';
import { ReportsService } from './reports/service.js';
import { WorkService } from './work/service.js';
import { PayrollService } from './payroll/service.js';
import { TimesheetService } from './payroll/timesheet-service.js';
import { SystemLogService } from './system-log/service.js';
import { SchedulesService } from './schedules/service.js';
import { AccountsService } from './accounts/service.js';
import {
  requireAuth as rawRequireAuth,
  requireCsrf,
  extractSessionToken,
} from './auth/guard.js';
import {
  serializeSessionCookie,
  serializeClearSessionCookie,
} from './cookie.js';
import { generateCsrfToken } from '../../../packages/security/src/csrf.js';
import { DEV_DEFAULT_CSRF_SECRET } from './config.js';
import type {
  CreateEmployeeRequestBody,
  UpdateEmployeeRequestBody,
} from '../../../packages/contracts/src/employees.js';
import type {
  ReviewShiftRequestBody,
  CreateCorrectionRequestBody,
  DecideCorrectionRequestBody,
} from '../../../packages/contracts/src/attendance.js';
import type {
  CreateReportRequestBody,
  UpdateReportRequestBody,
  ReviseReportRequestBody,
} from '../../../packages/contracts/src/reports.js';
import type { ReauthRequestBody } from '../../../packages/contracts/src/auth.js';
import { StorageService } from './storage/service.js';
import { AuditService, AuditServiceError } from './audit/service.js';
import { IssuesService } from './issues/service.js';
import { FinanceService } from './finance/service.js';
import { DashboardService } from './dashboard/service.js';
import { BridgeService } from './bridge/service.js';
import { ManagementSsoIssuer } from './bridge/sso.js';
import { ScopedApiCache } from './cache/api-cache.js';
import { FinanceValidationError } from '../../../packages/contracts/src/finance.js';
import { RouteTable } from './routes/router.js';
import { handleSchedulesRoutes } from './routes/schedules-routes.js';
import { handleAccountsRoutes } from './routes/accounts-routes.js';
import { handleStorageRoutes } from './routes/storage-routes.js';
import { handleAuditAndIssuesRoutes } from './routes/issues-routes.js';
import { handlePrintQuoteRoutes } from './routes/printquote-routes.js';
import { PrintQuoteService } from './printquote/service.js';

export interface AppDependencies {
  pool?: DatabasePool | null | undefined;
  authService?: AuthService;
  employeeService?: EmployeeService;
  attendanceService?: AttendanceService;
  reportsService?: ReportsService;
  schedulesService?: SchedulesService;
  payrollService?: PayrollService;
  timesheetService?: TimesheetService;
  systemLogService?: SystemLogService;
  workService?: WorkService;
  accountsService?: AccountsService;
  storageService?: StorageService;
  auditService?: AuditService;
  issuesService?: IssuesService;
  financeService?: FinanceService;
  dashboardService?: DashboardService;
  bridgeService?: BridgeService;
  printQuoteService?: PrintQuoteService;
  apiCache?: ScopedApiCache;
  accountSecretKey?: Buffer | undefined;
  csrfSecret?: string;
  allowedOrigins?: string[];
  trustedProxies?: string[];
  isProduction?: boolean;
  sessionCookieName?: string | undefined;
}

/**
 * Validates that an object contains ONLY the allowed keys.
 * Fails closed with 400 VALIDATION_ERROR if any unknown field is present.
 */
function assertAllowedFields(body: unknown, allowedFields: string[]): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return;
  }
  const keys = Object.keys(body as Record<string, unknown>);
  const unknownKeys = keys.filter((k) => !allowedFields.includes(k));
  if (unknownKeys.length > 0) {
    throw new AuthError(
      'VALIDATION_ERROR',
      `Unrecognized request field(s) not allowed: ${unknownKeys.join(', ')}`,
      400,
      unknownKeys.map((f) => ({
        field: f,
        message: `Unknown field '${f}' is not allowed`,
      })),
    );
  }
}

/** Reads a bounded raw body (receipt images); the limit is enforced while streaming. */
async function readRawBody(
  req: http.IncomingMessage,
  maxBytes: number,
): Promise<Uint8Array> {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new AuthError('VALIDATION_ERROR', 'Request payload too large', 413);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let n = 0;
    req.on('data', (chunk: Buffer) => {
      n += chunk.length;
      if (n > maxBytes) {
        req.destroy();
        reject(
          new AuthError('VALIDATION_ERROR', 'Request payload too large', 413),
        );
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

/**
 * Parses request body as JSON with maximum length bound to prevent DoS.
 */
/** Errors thrown while handling a request, read by the system-log finish hook. */
const errorByResponse = new WeakMap<http.ServerResponse, unknown>();

async function parseJsonBody<T = unknown>(
  req: http.IncomingMessage,
  maxBytes = 64 * 1024,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let bytesRead = 0;
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      bytesRead += chunk.length;
      if (bytesRead > maxBytes) {
        req.destroy();
        reject(
          new AuthError('VALIDATION_ERROR', 'Request payload too large', 413),
        );
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({} as T);
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw.length === 0) {
        resolve({} as T);
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed as T);
      } catch {
        reject(
          new AuthError(
            'VALIDATION_ERROR',
            'Malformed JSON in request body',
            400,
          ),
        );
      }
    });

    req.on('error', (err) => reject(err));
  });
}

/**
 * Securely resolves the client IP address.
 * NEVER trusts client-supplied headers unless the direct connecting peer
 * (remoteAddress) is explicitly listed in trustedProxies. Behind a trusted proxy:
 *  1. `CF-Connecting-IP` (set/overwritten by Cloudflare, cannot be forged by a client
 *     that reaches us through it) when it is a valid IP;
 *  2. otherwise the right-most `X-Forwarded-For` entry that is not itself a trusted
 *     proxy. The LEFT-most entry is attacker-controlled (clients may pre-fill the
 *     header), so it is never used.
 * Falls back to the socket peer address.
 */
export function getClientIp(
  req: http.IncomingMessage,
  trustedProxies: string[] = [],
): string {
  const remoteIp = req.socket.remoteAddress || '127.0.0.1';
  if (
    trustedProxies.length === 0 ||
    !isTrustedProxy(remoteIp, trustedProxies)
  ) {
    return remoteIp;
  }

  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string') {
    const candidate = cf.trim();
    if (net.isIP(candidate) !== 0) return candidate;
  }

  const forwarded = req.headers['x-forwarded-for'];
  const rawForwarded = Array.isArray(forwarded)
    ? forwarded.join(',')
    : forwarded;
  if (typeof rawForwarded === 'string' && rawForwarded.length > 0) {
    const hops = rawForwarded
      .split(',')
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0);
    for (let i = hops.length - 1; i >= 0; i--) {
      const hop = hops[i]!;
      if (net.isIP(hop) === 0) break;
      if (!isTrustedProxy(hop, trustedProxies)) return hop;
    }
  }

  return remoteIp;
}

function isTrustedProxy(ip: string, trustedProxies: string[]): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  return (
    trustedProxies.includes(ip) ||
    trustedProxies.includes(v4) ||
    trustedProxies.includes(`::ffff:${v4}`)
  );
}

/** Reject malformed authority and request targets before route dispatch. */
function parseRequestPath(req: http.IncomingMessage): string {
  try {
    const host = req.headers.host;
    if (host !== undefined) {
      if (typeof host !== 'string' || !host || /[\s/?#@\\,]/.test(host)) {
        throw new Error('Invalid authority');
      }
      new URL(`http://${host}`);
    }
    const target = req.url;
    if (
      !target ||
      !target.startsWith('/') ||
      target.startsWith('//') ||
      /[\s#\\]/.test(target) ||
      /%(?![\da-f]{2})/i.test(target)
    ) {
      throw new Error('Invalid request target');
    }
    return new URL(target, 'http://localhost').pathname;
  } catch {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Malformed request URL or Host',
      400,
    );
  }
}

/** Login policy is separate from the existing authenticated-endpoint CSRF policy. */
function requireLoginOrigin(
  req: http.IncomingMessage,
  allowedOrigins: string[],
  isProduction: boolean,
): void {
  const origin = req.headers.origin;
  const value = origin === undefined ? req.headers.referer : origin;
  let allowed = false;
  if (
    typeof value === 'string' &&
    /^https?:\/\/[^/?#]+(?:[/?#]|$)/.test(value) &&
    !/[\s\\]/.test(value) &&
    !/%(?![\da-f]{2})/i.test(value)
  ) {
    try {
      const url = new URL(value);
      const localHttp =
        !isProduction &&
        url.protocol === 'http:' &&
        (url.hostname === 'localhost' ||
          url.hostname === '[::1]' ||
          /^127(?:\.\d{1,3}){3}$/.test(url.hostname));
      allowed =
        !url.username &&
        !url.password &&
        !url.hash &&
        (origin === undefined || value === url.origin) &&
        (url.protocol === 'https:' || localHttp) &&
        allowedOrigins.includes(url.origin);
    } catch {
      allowed = false;
    }
  }
  if (!allowed) {
    throw new AuthError(
      'FORBIDDEN',
      'Login Origin or Referer is not allowed',
      403,
    );
  }
}

function requireLoginJson(req: http.IncomingMessage): void {
  const contentType = req.headers['content-type'];
  if (
    typeof contentType !== 'string' ||
    // Accept only the supported JSON media type and a single optional UTF-8 charset.
    !/^application\/json(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*(?:utf-8|"utf-8"))?[ \t]*$/i.test(
      contentType.trim(),
    )
  ) {
    throw new AuthError(
      'UNSUPPORTED_MEDIA_TYPE',
      'Login requires application/json with an optional UTF-8 charset',
      415,
    );
  }
}

/**
 * Creates the HTTP request handler for the Management Lite backend API.
 */
export function createRequestHandler(
  deps: AppDependencies = {},
): http.RequestListener {
  const isProduction =
    deps.isProduction ?? process.env['NODE_ENV'] === 'production';
  const sessionCookieName =
    deps.sessionCookieName ||
    process.env['SESSION_COOKIE_NAME']?.trim() ||
    undefined;
  const rawCsrfSecret = deps.csrfSecret ?? process.env['CSRF_SECRET'];

  if (isProduction) {
    if (!rawCsrfSecret || typeof rawCsrfSecret !== 'string') {
      throw new Error(
        'FATAL: CSRF_SECRET environment variable is required in production',
      );
    }
    if (rawCsrfSecret.length < 32) {
      throw new Error(
        'FATAL: CSRF_SECRET must be at least 32 characters in production',
      );
    }
    if (rawCsrfSecret === DEV_DEFAULT_CSRF_SECRET) {
      throw new Error(
        'FATAL: CSRF_SECRET in production must not use the development default secret',
      );
    }
    if (
      /^(.)\1+$/.test(rawCsrfSecret) ||
      rawCsrfSecret === '12345678901234567890123456789012'
    ) {
      throw new Error('FATAL: CSRF_SECRET in production is too weak');
    }
  }

  const csrfSecret = rawCsrfSecret || DEV_DEFAULT_CSRF_SECRET;

  const allowedOrigins = deps.allowedOrigins ?? [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    'http://localhost:3002',
    'http://127.0.0.1:3002',
    'http://localhost:3004',
    'http://127.0.0.1:3004',
    'http://localhost:3005',
    'http://127.0.0.1:3005',
    'http://localhost:3007',
    'http://127.0.0.1:3007',
    'http://localhost:3008',
    'http://127.0.0.1:3008',
  ];

  const trustedProxies =
    deps.trustedProxies ??
    (process.env['TRUSTED_PROXIES']
      ? process.env['TRUSTED_PROXIES']
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []);

  const authService =
    deps.authService ??
    (deps.pool
      ? new AuthService(deps.pool, csrfSecret, {
          resetMailer: createBrevoResetMailer(),
        })
      : null);

  const employeeService =
    deps.employeeService ?? (deps.pool ? new EmployeeService(deps.pool) : null);

  const attendanceService =
    deps.attendanceService ??
    (deps.pool ? new AttendanceService(deps.pool) : null);

  const reportsService =
    deps.reportsService ?? (deps.pool ? new ReportsService(deps.pool) : null);

  const workService =
    deps.workService ?? (deps.pool ? new WorkService(deps.pool) : null);
  const payrollService =
    deps.payrollService ?? (deps.pool ? new PayrollService(deps.pool) : null);
  const systemLogService =
    deps.systemLogService ??
    (deps.pool ? new SystemLogService(deps.pool) : null);
  const timesheetService =
    deps.timesheetService ??
    (deps.pool && payrollService
      ? new TimesheetService(deps.pool, payrollService)
      : null);
  const schedulesService =
    deps.schedulesService ??
    (deps.pool ? new SchedulesService(deps.pool) : null);
  const accountsService =
    deps.accountsService ??
    (deps.pool ? new AccountsService(deps.pool, deps.accountSecretKey) : null);
  const storageService =
    deps.storageService ??
    (deps.pool
      ? new StorageService(deps.pool, undefined, deps.accountSecretKey)
      : null);
  const auditService =
    deps.auditService ?? (deps.pool ? new AuditService(deps.pool) : null);
  const issuesService =
    deps.issuesService ?? (deps.pool ? new IssuesService(deps.pool) : null);
  const financeService =
    deps.financeService ?? (deps.pool ? new FinanceService(deps.pool) : null);
  const dashboardService =
    deps.dashboardService ??
    (deps.pool ? new DashboardService(deps.pool) : null);
  const ssoIssuer = new ManagementSsoIssuer(async (token) =>
    authService ? authService.resolveSession(token) : null,
  );
  const bridgeService =
    deps.bridgeService ?? (deps.pool ? new BridgeService(deps.pool) : null);
  const printQuoteService =
    deps.printQuoteService ??
    (deps.pool ? new PrintQuoteService(deps.pool) : null);
  const apiCache = deps.apiCache ?? new ScopedApiCache();

  const routeTable = new RouteTable()
    .registerExact('GET', '/api/v1/schedules/me', handleSchedulesRoutes)
    .registerExact('GET', '/api/v1/schedules', handleSchedulesRoutes)
    .registerExact('POST', '/api/v1/schedules', handleSchedulesRoutes)
    .registerPrefix('/api/v1/schedules', handleSchedulesRoutes)
    .registerExact('GET', '/api/v1/accounts', handleAccountsRoutes)
    .registerExact('POST', '/api/v1/accounts', handleAccountsRoutes)
    .registerPrefix('/api/v1/accounts', handleAccountsRoutes)
    .registerExact('GET', '/api/v1/storage/folders', handleStorageRoutes)
    .registerExact('POST', '/api/v1/storage/folders', handleStorageRoutes)
    .registerExact(
      'GET',
      '/api/v1/storage/drive/connection',
      handleStorageRoutes,
    )
    .registerExact(
      'GET',
      '/api/v1/storage/drive/oauth/url',
      handleStorageRoutes,
    )
    .registerPrefix('/api/v1/storage', handleStorageRoutes)
    .registerExact('GET', '/api/v1/audit', handleAuditAndIssuesRoutes)
    .registerExact('GET', '/api/v1/audit-events', handleAuditAndIssuesRoutes)
    .registerExact('POST', '/api/v1/reports', handleAuditAndIssuesRoutes)
    .registerPrefix('/api/v1/reports', (ctx) =>
      ctx.pathname === '/api/v1/reports'
        ? handleAuditAndIssuesRoutes(ctx)
        : Promise.resolve(false),
    )
    .registerExact('GET', '/api/v1/issues', handleAuditAndIssuesRoutes)
    .registerExact('POST', '/api/v1/issues', handleAuditAndIssuesRoutes)
    .registerPrefix('/api/v1/issues', handleAuditAndIssuesRoutes)
    .registerPrefix('/api/v1/print-quotes', handlePrintQuoteRoutes);

  // Resolve release info once at boot so the one-time git fallback never runs while a
  // (public) health request is waiting on it.
  try {
    resolveReleaseState(isProduction);
  } catch {
    // Release metadata is informational; never block startup on it.
  }

  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    // 1. Assign a deterministic request_id. A client-supplied id is only honoured when it
    // is a short, log-safe token; anything else is replaced to prevent log/header injection.
    const headerRequestId = req.headers['x-request-id'];
    const requestId =
      typeof headerRequestId === 'string' &&
      /^[A-Za-z0-9._-]{1,64}$/.test(headerRequestId)
        ? headerRequestId
        : crypto.randomUUID();

    try {
      const pathname = parseRequestPath(req);
      const method = req.method?.toUpperCase() || 'GET';

      let authenticatedWorkspaceId: string | null = null;
      let authenticatedUserId: string | null = null;
      const requestStartedAt = Date.now();
      res.once('finish', () => {
        if (!systemLogService || pathname === '/api/v1/health') return;
        const status = res.statusCode;
        const durationMs = Date.now() - requestStartedAt;
        const slow = durationMs >= 3000;
        if (status < 400 && !slow) return;
        if (status === 401 || (status === 404 && !pathname.startsWith('/api/')))
          return;
        const err = errorByResponse.get(res);
        const errObj = err instanceof Error ? err : null;
        const isAppError =
          err instanceof AuthError || err instanceof AuditServiceError;
        systemLogService.record({
          level: status >= 500 ? 'error' : 'warn',
          source: 'api',
          workspaceId: authenticatedWorkspaceId,
          userId: authenticatedUserId,
          requestId,
          method,
          route: pathname,
          status,
          durationMs,
          errorCode: isAppError
            ? (err as AuthError).code
            : status >= 500
              ? 'INTERNAL_SERVER_ERROR'
              : slow && status < 400
                ? 'SLOW_REQUEST'
                : status === 404
                  ? 'NOT_FOUND'
                  : `HTTP_${status}`,
          message:
            errObj?.message ??
            (slow && status < 400
              ? `Slow request (${durationMs} ms)`
              : `HTTP ${status}`),
          stack: !isAppError || status >= 500 ? (errObj?.stack ?? null) : null,
          release: SYSTEM_COMMIT.slice(0, 7),
          metadata: {
            query_keys: Object.keys(
              Object.fromEntries(
                new URL(req.url ?? '/', 'http://x').searchParams,
              ),
            ).slice(0, 20),
          },
        });
      });

      const requireAuth: typeof rawRequireAuth = async (
        svc,
        r,
        prod,
        cookieName,
      ) => {
        // Bind the configured session cookie name once so no call site can forget it.
        const ctx = await rawRequireAuth(
          svc,
          r,
          prod,
          cookieName ?? sessionCookieName,
        );
        authenticatedWorkspaceId = ctx.workspace.id;
        authenticatedUserId = ctx.user.id;
        return ctx;
      };

      const origWriteHead = res.writeHead.bind(res);
      res.writeHead = ((statusCode: number, ...args: unknown[]) => {
        if (
          method !== 'GET' &&
          method !== 'HEAD' &&
          method !== 'OPTIONS' &&
          statusCode >= 200 &&
          statusCode < 400
        ) {
          if (authenticatedWorkspaceId) {
            apiCache.invalidateWorkspace(authenticatedWorkspaceId);
          }
          if (
            authenticatedUserId &&
            (pathname === '/api/v1/auth/logout' ||
              pathname.startsWith('/api/v1/auth/password') ||
              pathname === '/api/v1/auth/change-password')
          ) {
            apiCache.invalidateUser(authenticatedUserId);
          }
          if (
            pathname === '/api/v1/auth/reset-password' ||
            pathname === '/api/v1/auth/activate' ||
            pathname.startsWith('/api/v1/auth/verify-email')
          ) {
            apiCache.clearAll();
          }
        }
        return (origWriteHead as (...a: unknown[]) => http.ServerResponse)(
          statusCode,
          ...args,
        );
      }) as typeof res.writeHead;

      if (method === 'GET' && pathname === '/api/v1/dashboard/summary') {
        if (!authService || !dashboardService) {
          return sendJson(
            res,
            503,
            createErrorEnvelope(
              'DATABASE_UNAVAILABLE',
              'Service unavailable',
              requestId,
            ),
          );
        }

        const sessionContext = await requireAuth(
          authService,
          req,
          isProduction,
          sessionCookieName,
        );
        const parsedUrl = new URL(req.url || '/', 'http://localhost');
        const dateParam = parsedUrl.searchParams.get('date') || undefined;
        const monthParam = parsedUrl.searchParams.get('month') || undefined;
        const bypassCache =
          req.headers['x-cache-bypass'] === '1' ||
          String(req.headers['cache-control'] || '').includes('no-cache');

        const { data, cacheStatus } = await apiCache.getOrLoad(
          sessionContext,
          req.url || pathname,
          () =>
            dashboardService.getSummary(sessionContext, {
              date: dateParam,
              month: monthParam,
            }),
          { bypassCache, ttlMs: 15_000 },
        );

        return sendJson(res, 200, createSuccessEnvelope(data, requestId), {
          'Cache-Control': 'private, no-store',
          'X-Cache': cacheStatus,
        });
      }

      if (method === 'GET' && pathname === '/api/v1/bridge/sso/authorize') {
        if (!authService)
          throw new AuthError(
            'DATABASE_UNAVAILABLE',
            'Authentication unavailable',
            503,
          );
        const state = new URL(
          req.url || '/',
          'http://localhost',
        ).searchParams.get('state');
        if (!state || !/^[a-f0-9]{64}$/.test(state))
          throw new AuthError(
            'SSO_INVALID_STATE',
            'Phiên đăng nhập liên thông không hợp lệ.',
            400,
          );
        let auth: Awaited<ReturnType<typeof requireAuth>>;
        try {
          auth = await requireAuth(
            authService,
            req,
            isProduction,
            sessionCookieName,
          );
        } catch (error) {
          if (error instanceof AuthError && error.statusCode === 401) {
            res.writeHead(303, {
              Location: `/login?sso_state=${state}`,
              'Cache-Control': 'no-store',
              'Referrer-Policy': 'no-referrer',
            });
            return res.end();
          }
          throw error;
        }
        const location = ssoIssuer.authorize(
          auth,
          extractSessionToken(req, isProduction, sessionCookieName) || '',
          state,
        );
        res.writeHead(303, {
          Location: location,
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
        });
        return res.end();
      }
      if (method === 'POST' && pathname === '/api/v1/bridge/sso/exchange') {
        const body = await parseJsonBody<{ code?: unknown; state?: unknown }>(
          req,
        );
        const data = await ssoIssuer.exchange(
          req.headers['x-hp-bridge-key'],
          body?.code,
          body?.state,
        );
        return sendJson(res, 200, createSuccessEnvelope(data, requestId), {
          'Cache-Control': 'no-store',
        });
      }

      // Cross-System Bridge endpoints: ql.hoaiphuong.click <-> hoaiphuong.click
      if (method === 'GET' && pathname === '/api/v1/bridge/public-summary') {
        if (!bridgeService)
          throw new AuthError(
            'DATABASE_UNAVAILABLE',
            'Bridge service unavailable',
            503,
          );
        const summary = await bridgeService.getPublicSummary();
        return sendJson(res, 200, createSuccessEnvelope(summary, requestId));
      }

      if (method === 'GET' && pathname === '/api/v1/bridge/tiktok-v4') {
        if (!authService || !bridgeService) {
          return sendJson(
            res,
            503,
            createErrorEnvelope(
              'DATABASE_UNAVAILABLE',
              'Bridge service unavailable',
              requestId,
            ),
          );
        }
        const sessionContext = await requireAuth(
          authService,
          req,
          isProduction,
          sessionCookieName,
        );
        const statusData =
          await bridgeService.getTikTokV4Status(sessionContext);
        return sendJson(
          res,
          200,
          createSuccessEnvelope(statusData, requestId),
          {
            'Cache-Control': 'private, no-store',
          },
        );
      }

      if (method === 'POST' && pathname === '/api/v1/bridge/tiktok-v4/sync') {
        if (!authService || !bridgeService) {
          return sendJson(
            res,
            503,
            createErrorEnvelope(
              'DATABASE_UNAVAILABLE',
              'Bridge service unavailable',
              requestId,
            ),
          );
        }
        const sessionContext = await requireAuth(
          authService,
          req,
          isProduction,
          sessionCookieName,
        );
        requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
        const syncResult = await bridgeService.syncWithTikTokV4(
          sessionContext,
          requestId,
        );
        apiCache.invalidateWorkspace(sessionContext.workspace.id);
        return sendJson(
          res,
          200,
          createSuccessEnvelope(syncResult, requestId),
          {
            'Cache-Control': 'private, no-store',
          },
        );
      }

      if (pathname === '/api/v1/fin' || pathname.startsWith('/api/v1/fin/')) {
        if (!authService || !financeService)
          throw new AuthError(
            'SERVICE_UNAVAILABLE',
            'Finance unavailable',
            503,
          );
        const auth = await requireAuth(authService, req, isProduction);
        if (auth.workspace.role !== 'owner')
          throw new AuthError('FORBIDDEN', 'Owner permission required', 403);
        const rcpt = pathname.match(
          /^\/api\/v1\/fin\/receipts(?:\/([^/]+?)(?:\/(file|extract))?)?$/,
        );
        if (rcpt) {
          const rid = rcpt[1],
            raction = rcpt[2];
          if (method === 'GET' && rid && raction === 'file') {
            const f = await financeService.receiptFile(auth, rid);
            res.writeHead(200, {
              'Content-Type': f.mime,
              'Content-Length': f.bytes.length,
              'Cache-Control': 'private, no-store',
              'X-Content-Type-Options': 'nosniff',
              'Content-Disposition': 'inline',
              'Content-Security-Policy': "default-src 'none'; sandbox",
              'Cross-Origin-Resource-Policy': 'same-origin',
              'X-Request-Id': requestId,
            });
            res.end(Buffer.from(f.bytes));
            return;
          }
          const ok =
            (method === 'POST' && !rid && !raction) ||
            (method === 'POST' && rid && raction === 'extract') ||
            (method === 'DELETE' && rid && !raction);
          if (!ok) throw new AuthError('NOT_FOUND', 'Endpoint not found', 404);
          requireCsrf(req, auth, csrfSecret, allowedOrigins);
          if (new URL(req.url ?? '/', 'http://localhost').searchParams.size)
            throw new AuthError('VALIDATION_ERROR', 'Unexpected query', 400);
          if (method === 'DELETE') {
            const out = await financeService.discardReceipt(
              auth,
              rid!,
              requestId,
            );
            return sendJson(res, out.status, out.body);
          }
          if (raction === 'extract') {
            const abort = new AbortController();
            res.once('close', () => {
              if (!res.writableEnded) abort.abort();
            });
            const data = await financeService.extractReceipt(
              auth,
              rid!,
              abort.signal,
              requestId,
            );
            if (abort.signal.aborted) return;
            return sendJson(res, 200, createSuccessEnvelope(data, requestId));
          }
          const bytes = await readRawBody(req, 4 * 1024 * 1024);
          const declared =
            typeof req.headers['content-type'] === 'string'
              ? req.headers['content-type']
              : undefined;
          const out = await financeService.uploadReceipt(
            auth,
            bytes,
            declared,
            requestId,
          );
          return sendJson(res, out.status, out.body);
        }
        const route = pathname.match(
          /^\/api\/v1\/fin\/(categories|entries|summary|plan|plan-items)(?:\/([^/]+))?(?:\/(corrections|correct))?$/,
        );
        if (!route) throw new AuthError('NOT_FOUND', 'Endpoint not found', 404);
        const resource = route[1],
          id = route[2],
          action = route[3];
        const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
        if (method === 'GET') {
          let data: unknown;
          if (resource === 'categories' && !id && !action)
            data = await financeService.categories(auth, query);
          else if (resource === 'entries' && !id && !action)
            data = await financeService.entries(auth, query);
          else if (resource === 'entries' && id && action === 'corrections')
            data = await financeService.corrections(auth, id, query);
          else if (resource === 'entries' && id && !action) {
            if ([...query].length)
              throw new AuthError('VALIDATION_ERROR', 'Unexpected query', 400);
            data = await financeService.detail(auth, id);
          } else if (resource === 'summary' && !id && !action)
            data = await financeService.summary(auth, query);
          else if (resource === 'plan' && !id && !action)
            data = await financeService.plan(auth, query);
          else throw new AuthError('NOT_FOUND', 'Endpoint not found', 404);
          return sendJson(res, 200, createSuccessEnvelope(data, requestId));
        }
        const supported =
          (method === 'POST' &&
            !id &&
            !action &&
            (resource === 'categories' ||
              resource === 'entries' ||
              resource === 'plan-items')) ||
          (method === 'PATCH' &&
            (resource === 'categories' || resource === 'plan-items') &&
            id &&
            !action) ||
          (method === 'POST' &&
            resource === 'entries' &&
            id &&
            action === 'correct');
        if (!supported)
          throw new AuthError('NOT_FOUND', 'Endpoint not found', 404);
        requireCsrf(req, auth, csrfSecret, allowedOrigins);
        if ([...query].length)
          throw new AuthError('VALIDATION_ERROR', 'Unexpected query', 400);
        const body = await parseJsonBody(req);
        const key =
          typeof req.headers['idempotency-key'] === 'string'
            ? req.headers['idempotency-key']
            : undefined;
        const match =
          typeof req.headers['if-match'] === 'string'
            ? req.headers['if-match']
            : undefined;
        const result =
          resource === 'plan-items'
            ? id
              ? await financeService.updatePlanItem(
                  auth,
                  id,
                  body,
                  key,
                  match,
                  requestId,
                )
              : await financeService.createPlanItem(auth, body, key, requestId)
            : resource === 'categories'
              ? id
                ? await financeService.updateCategory(
                    auth,
                    id,
                    body,
                    key,
                    match,
                    requestId,
                  )
                : await financeService.createCategory(
                    auth,
                    body,
                    key,
                    requestId,
                  )
              : id
                ? await financeService.correct(
                    auth,
                    id,
                    body,
                    key,
                    match,
                    requestId,
                  )
                : await financeService.createEntry(auth, body, key, requestId);
        return sendJson(res, result.status, result.body);
      }
      const resolveRuntimeReleaseState = () =>
        resolveReleaseState(isProduction);

      // 2. Health / Liveness & Version endpoint: GET /api/v1/health | GET /api/v1/system/version
      if (
        method === 'GET' &&
        (pathname === '/api/v1/health' || pathname === '/api/v1/system/version')
      ) {
        const runtime = resolveRuntimeReleaseState();
        const body = createSuccessEnvelope(
          {
            status: 'pass',
            service: '@management-lite/api',
            version: runtime.version,
            commit: runtime.commit,
            sha: runtime.sha,
            released_at: runtime.releasedAt,
            environment: runtime.environment,
            production_status: runtime.productionStatus,
            uptime: process.uptime(),
          },
          requestId,
        );
        return sendJson(res, 200, body);
      }

      // 2A. System log console (Owner only) + browser error intake
      if (
        pathname.startsWith('/api/v1/system/logs') ||
        pathname === '/api/v1/system/client-errors'
      ) {
        if (!authService || !systemLogService)
          throw new AuthError(
            'SERVICE_UNAVAILABLE',
            'System log service unavailable',
            503,
          );
        const logAuth = await requireAuth(
          authService,
          req,
          isProduction,
          sessionCookieName,
        );
        const sp = new URL(req.url ?? '/', 'http://localhost').searchParams;
        if (method === 'GET' && pathname === '/api/v1/system/logs') {
          const data = await systemLogService.list(logAuth, {
            level: sp.get('level') ?? undefined,
            source: sp.get('source') ?? undefined,
            status_min: sp.get('status_min') ?? undefined,
            route: sp.get('route') ?? undefined,
            request_id: sp.get('request_id') ?? undefined,
            fingerprint: sp.get('fingerprint') ?? undefined,
            q: sp.get('q') ?? undefined,
            from: sp.get('from') ?? undefined,
            to: sp.get('to') ?? undefined,
            limit: sp.get('limit') ?? undefined,
            cursor: sp.get('cursor') ?? undefined,
          });
          return sendJson(res, 200, createSuccessEnvelope(data, requestId));
        }
        if (method === 'GET' && pathname === '/api/v1/system/logs/summary') {
          const data = await systemLogService.summary(
            logAuth,
            sp.get('hours') ?? undefined,
          );
          return sendJson(res, 200, createSuccessEnvelope(data, requestId));
        }
        if (method === 'DELETE' && pathname === '/api/v1/system/logs') {
          requireCsrf(req, logAuth, csrfSecret, allowedOrigins);
          const data = await systemLogService.dismiss(logAuth, {
            fingerprint: sp.get('fingerprint') ?? undefined,
            beforeIso: sp.get('before') ?? undefined,
          });
          return sendJson(res, 200, createSuccessEnvelope(data, requestId));
        }
        if (method === 'POST' && pathname === '/api/v1/system/logs/escalate') {
          requireCsrf(req, logAuth, csrfSecret, allowedOrigins);
          const body = await parseJsonBody<Record<string, unknown>>(
            req,
            16 * 1024,
          );
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new AuthError(
              'VALIDATION_ERROR',
              'Object body required',
              400,
            );
          }
          assertAllowedFields(body, ['fingerprint', 'log_id']);
          const data = await systemLogService.escalate(logAuth, {
            fingerprint:
              typeof body['fingerprint'] === 'string'
                ? body['fingerprint']
                : undefined,
            log_id:
              typeof body['log_id'] === 'string' ? body['log_id'] : undefined,
          });
          return sendJson(res, 200, createSuccessEnvelope(data, requestId));
        }
        const logId = /^\/api\/v1\/system\/logs\/([0-9a-f-]{36})$/i.exec(
          pathname,
        );
        if (method === 'GET' && logId) {
          const data = await systemLogService.detail(logAuth, logId[1]!);
          return sendJson(res, 200, createSuccessEnvelope(data, requestId));
        }
        if (method === 'POST' && pathname === '/api/v1/system/client-errors') {
          requireCsrf(req, logAuth, csrfSecret, allowedOrigins);
          if (!systemLogService.allowClientError(logAuth.user.id))
            throw new AuthError('RATE_LIMITED', 'Too many error reports', 429);
          const body = await parseJsonBody<Record<string, unknown>>(
            req,
            16 * 1024,
          );
          if (!body || typeof body !== 'object' || Array.isArray(body))
            throw new AuthError(
              'VALIDATION_ERROR',
              'Object body required',
              400,
            );
          assertAllowedFields(body, ['message', 'stack', 'url', 'component']);
          const str = (v: unknown, n: number) =>
            typeof v === 'string' ? v.slice(0, n) : '';
          systemLogService.record({
            level: 'error',
            source: 'web',
            workspaceId: logAuth.workspace.id,
            userId: logAuth.user.id,
            requestId,
            method: 'UI',
            route: str(body['url'], 300),
            errorCode: 'CLIENT_ERROR',
            message: str(body['message'], 600) || 'Client error',
            stack: str(body['stack'], 4000) || null,
            release: SYSTEM_COMMIT.slice(0, 7),
            userAgent: str(req.headers['user-agent'], 200),
            metadata: { component: str(body['component'], 120) },
          });
          return sendJson(
            res,
            202,
            createSuccessEnvelope({ accepted: true }, requestId),
          );
        }
        throw new AuthError('NOT_FOUND', 'Endpoint not found', 404);
      }

      // 2B. System Release History endpoint (Admin / Owner ONLY): GET /api/v1/system/releases
      if (method === 'GET' && pathname === '/api/v1/system/releases') {
        if (!authService) {
          const body = createErrorEnvelope(
            'DATABASE_UNAVAILABLE',
            'Authentication service is unavailable',
            requestId,
          );
          return sendJson(res, 503, body);
        }
        const auth = await requireAuth(
          authService,
          req,
          isProduction,
          sessionCookieName,
        );
        if (auth.workspace.role !== 'owner') {
          throw new AuthError(
            'FORBIDDEN',
            'Chỉ Admin (Chủ sở hữu) mới có quyền xem lịch sử cập nhật hệ thống',
            403,
          );
        }

        const runtime = resolveRuntimeReleaseState();
        const currentShort = runtime.commit.slice(0, 7).toLowerCase();

        const deployLogPath =
          process.env['SERVER_DEPLOY_HISTORY_LOG'] ||
          path.join(
            process.env['SERVER_LOGS_DIR'] || 'C:\\HoaiPhuong-Server\\logs',
            'deploy-history.log',
          );

        const successfulDeploysBySha = new Map<
          string,
          { shortSha: string; timestamp: string; version?: string }
        >();
        const orderedSuccessShas: string[] = [];

        try {
          if (fs.existsSync(deployLogPath)) {
            const rawLines = fs
              .readFileSync(deployLogPath, 'utf8')
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean);

            for (const line of rawLines) {
              try {
                const parsed = JSON.parse(line) as {
                  timestamp?: string;
                  sha?: string;
                  status?: string;
                  sandbox?: boolean;
                  version?: string;
                };
                if (
                  parsed.status === 'SUCCESS' &&
                  parsed.sandbox !== true &&
                  typeof parsed.sha === 'string' &&
                  parsed.sha.trim().length >= 7 &&
                  !/^0+$/.test(parsed.sha.trim())
                ) {
                  const sSha = parsed.sha.trim().slice(0, 7).toLowerCase();
                  successfulDeploysBySha.set(sSha, {
                    shortSha: sSha,
                    timestamp:
                      parsed.timestamp ||
                      runtime.releasedAt ||
                      new Date().toISOString(),
                    ...(parsed.version
                      ? { version: String(parsed.version).replace(/^v/i, '') }
                      : {}),
                  });
                  const existingIdx = orderedSuccessShas.indexOf(sSha);
                  if (existingIdx !== -1) {
                    orderedSuccessShas.splice(existingIdx, 1);
                  }
                  orderedSuccessShas.push(sSha);
                }
              } catch {
                // Ignore malformed log line
              }
            }
          }
        } catch {
          // Ignore optional deploy log read error
        }

        const historicalEntries = RELEASE_NOTES_CATALOG.filter(
          (item) => item.commit !== 'latest',
        );
        const historicalByShortSha = new Map(
          historicalEntries.map((item) => [
            item.commit.slice(0, 7).toLowerCase(),
            item,
          ]),
        );
        const latestTemplate =
          RELEASE_NOTES_CATALOG.find((item) => item.commit === 'latest') ||
          RELEASE_NOTES_CATALOG[0]!;

        const releases: ReleaseHistoryEntry[] = [];
        const seenShas = new Set<string>();

        if (!historicalByShortSha.has(currentShort)) {
          const matchingDeploy = successfulDeploysBySha.get(currentShort);
          releases.push({
            version: runtime.version,
            commit: currentShort,
            released_at:
              matchingDeploy?.timestamp ||
              runtime.releasedAt ||
              latestTemplate.released_at,
            summary: latestTemplate.summary,
            added: [...latestTemplate.added],
            improved: [...latestTemplate.improved],
            fixed: [...latestTemplate.fixed],
            is_current: true,
          });
          seenShas.add(currentShort);
        }

        for (let i = orderedSuccessShas.length - 1; i >= 0; i--) {
          const sSha = orderedSuccessShas[i]!;
          if (seenShas.has(sSha) || historicalByShortSha.has(sSha)) {
            continue;
          }
          const rec = successfulDeploysBySha.get(sSha)!;
          releases.push({
            version: rec.version || latestTemplate.version.replace(/^v/i, ''),
            commit: sSha,
            released_at: rec.timestamp,
            summary: latestTemplate.summary,
            added: [...latestTemplate.added],
            improved: [...latestTemplate.improved],
            fixed: [...latestTemplate.fixed],
            is_current: sSha === currentShort,
          });
          seenShas.add(sSha);
        }

        for (const hist of historicalEntries) {
          const sSha = hist.commit.slice(0, 7).toLowerCase();
          if (seenShas.has(sSha)) continue;
          const matchingDeploy = successfulDeploysBySha.get(sSha);
          releases.push({
            version: hist.version.replace(/^v/i, ''),
            commit: sSha,
            released_at:
              matchingDeploy?.timestamp ||
              (sSha === currentShort && runtime.releasedAt
                ? runtime.releasedAt
                : hist.released_at),
            summary: hist.summary,
            added: [...hist.added],
            improved: [...hist.improved],
            fixed: [...hist.fixed],
            is_current: sSha === currentShort,
          });
          seenShas.add(sSha);
        }

        return sendJson(
          res,
          200,
          createSuccessEnvelope(
            {
              current: {
                version: runtime.version,
                commit: runtime.commit,
                sha: runtime.sha,
                released_at: runtime.releasedAt,
                environment: runtime.environment,
                production_status: runtime.productionStatus,
              },
              releases,
            },
            requestId,
          ),
        );
      }

      // 3. Readiness endpoint: GET /api/v1/ready
      if (method === 'GET' && pathname === '/api/v1/ready') {
        if (!deps.pool) {
          const body = createErrorEnvelope(
            'DATABASE_UNAVAILABLE',
            'Database pool is not configured or uninitialized',
            requestId,
          );
          return sendJson(res, 503, body);
        }

        const health = await checkDatabaseHealth(deps.pool);
        if (health.connected) {
          const body = createSuccessEnvelope(
            {
              status: 'ready',
              database: 'connected',
              latency_ms: health.latencyMs,
            },
            requestId,
          );
          return sendJson(res, 200, body);
        }

        // Database unavailable -> 503 Service Unavailable
        const body = createErrorEnvelope(
          'DATABASE_UNAVAILABLE',
          'Database connection is not ready',
          requestId,
        );
        return sendJson(res, 503, body);
      }

      // 4. POST /api/v1/auth/login
      if (method === 'POST' && pathname === '/api/v1/auth/login') {
        requireLoginOrigin(req, allowedOrigins, isProduction);
        requireLoginJson(req);

        if (!authService) {
          const body = createErrorEnvelope(
            'DATABASE_UNAVAILABLE',
            'Authentication service is unavailable',
            requestId,
          );
          return sendJson(res, 503, body);
        }

        const body = await parseJsonBody<Record<string, unknown>>(req);
        assertAllowedFields(body, [
          'identifier',
          'password',
          'remember_me',
          'rememberMe',
        ]);

        const rawRemember = body['remember_me'] ?? body['rememberMe'];
        if (rawRemember !== undefined && typeof rawRemember !== 'boolean') {
          throw new AuthError(
            'VALIDATION_ERROR',
            'remember_me must be a boolean',
            400,
            [{ field: 'remember_me', message: 'Must be a boolean' }],
          );
        }
        const rememberMe = rawRemember === true;

        const clientIp = getClientIp(req, trustedProxies);
        const result = await authService.loginUser({
          identifier:
            typeof body['identifier'] === 'string' ? body['identifier'] : '',
          password:
            typeof body['password'] === 'string' ? body['password'] : '',
          clientIp,
          requestId,
          rememberMe,
        });

        const sessionCookie = serializeSessionCookie(result.sessionToken, {
          isProduction,
          cookieName: sessionCookieName,
          rememberMe: result.rememberMe,
          maxAgeSeconds: result.maxAgeSeconds,
          sessionOnly: !result.rememberMe,
        });

        return sendJson(
          res,
          200,
          createSuccessEnvelope(result.responseData, requestId),
          { 'Set-Cookie': sessionCookie },
        );
      }

      // 4b. POST /api/v1/auth/refresh
      if (method === 'POST' && pathname === '/api/v1/auth/refresh') {
        requireLoginOrigin(req, allowedOrigins, isProduction);

        if (!authService) {
          const body = createErrorEnvelope(
            'DATABASE_UNAVAILABLE',
            'Authentication service is unavailable',
            requestId,
          );
          return sendJson(res, 503, body);
        }

        const body = await parseJsonBody<Record<string, unknown>>(req);
        assertAllowedFields(body, []);

        const token = extractSessionToken(req, isProduction, sessionCookieName);
        const refreshed = await authService.refreshSession({
          sessionToken: token,
          requestId,
        });

        if (!refreshed) {
          const clearCookie = serializeClearSessionCookie({
            isProduction,
            cookieName: sessionCookieName,
          });
          return sendJson(
            res,
            401,
            createErrorEnvelope(
              'UNAUTHENTICATED',
              'Session has expired or been revoked',
              requestId,
            ),
            { 'Set-Cookie': clearCookie },
          );
        }

        const sessionCookie = serializeSessionCookie(refreshed.sessionToken, {
          isProduction,
          cookieName: sessionCookieName,
          rememberMe: refreshed.rememberMe,
          maxAgeSeconds: refreshed.maxAgeSeconds,
          sessionOnly: !refreshed.rememberMe,
        });

        return sendJson(
          res,
          200,
          createSuccessEnvelope(refreshed.responseData, requestId),
          { 'Set-Cookie': sessionCookie },
        );
      }

      // 5. POST /api/v1/auth/logout
      if (method === 'POST' && pathname === '/api/v1/auth/logout') {
        if (!authService) {
          const body = createErrorEnvelope(
            'DATABASE_UNAVAILABLE',
            'Authentication service is unavailable',
            requestId,
          );
          return sendJson(res, 503, body);
        }

        const body = await parseJsonBody<Record<string, unknown>>(req);
        assertAllowedFields(body, []);

        const sessionContext = await requireAuth(
          authService,
          req,
          isProduction,
          sessionCookieName,
        );
        requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);

        const token = extractSessionToken(req, isProduction, sessionCookieName);
        await authService.logoutSession({ sessionToken: token, requestId });

        const clearCookie = serializeClearSessionCookie({
          isProduction,
          cookieName: sessionCookieName,
        });
        res.writeHead(204, {
          'Set-Cookie': clearCookie,
          'X-Request-Id': requestId,
        });
        return res.end();
      }

      // 6. GET /api/v1/auth/me
      if (method === 'GET' && pathname === '/api/v1/auth/me') {
        if (!authService) {
          const body = createErrorEnvelope(
            'DATABASE_UNAVAILABLE',
            'Authentication service is unavailable',
            requestId,
          );
          return sendJson(res, 503, body);
        }

        const sessionContext = await requireAuth(
          authService,
          req,
          isProduction,
          sessionCookieName,
        );
        const authMeData = await authService.getAuthMe(sessionContext);
        const csrfToken = generateCsrfToken(
          sessionContext.sessionTokenHash,
          csrfSecret,
        );

        return sendJson(
          res,
          200,
          createSuccessEnvelope(
            { ...authMeData, csrf_token: csrfToken },
            requestId,
          ),
        );
      }

      // 6B. PATCH /api/v1/auth/profile (self-service profile: name, phone, email)
      if (method === 'PATCH' && pathname === '/api/v1/auth/profile') {
        if (!authService) {
          return sendJson(
            res,
            503,
            createErrorEnvelope(
              'DATABASE_UNAVAILABLE',
              'Authentication service is unavailable',
              requestId,
            ),
          );
        }
        const sessionContext = await requireAuth(
          authService,
          req,
          isProduction,
          sessionCookieName,
        );
        requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
        const body = await parseJsonBody<Record<string, unknown>>(req);
        assertAllowedFields(body, [
          'full_name',
          'phone',
          'email',
          'current_password',
          'date_of_birth',
          'gender',
          'national_id',
          'address',
          'position_title',
          'emergency_contact',
          'bank_name',
          'bank_account_number',
          'bank_account_holder',
        ]);
        const result = await authService.updateProfile({
          context: sessionContext,
          fullName: body['full_name'],
          phone: body['phone'],
          email: body['email'],
          currentPassword: body['current_password'],
          dateOfBirth: body['date_of_birth'],
          gender: body['gender'],
          nationalId: body['national_id'],
          address: body['address'],
          positionTitle: body['position_title'],
          emergencyContact: body['emergency_contact'],
          bankName: body['bank_name'],
          bankAccountNumber: body['bank_account_number'],
          bankAccountHolder: body['bank_account_holder'],
          requestId,
        });
        return sendJson(res, 200, createSuccessEnvelope(result, requestId));
      }

      // 7. POST /api/v1/auth/password/change (and aliases /api/v1/auth/password, /api/v1/auth/change-password)
      const isPasswordChangeRoute =
        pathname === '/api/v1/auth/password/change' ||
        pathname === '/api/v1/auth/password' ||
        pathname === '/api/v1/auth/change-password';
      if (method === 'POST' && isPasswordChangeRoute) {
        if (!authService) {
          const body = createErrorEnvelope(
            'DATABASE_UNAVAILABLE',
            'Authentication service is unavailable',
            requestId,
          );
          return sendJson(res, 503, body);
        }

        const sessionContext = await requireAuth(
          authService,
          req,
          isProduction,
        );
        requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);

        const body = await parseJsonBody<Record<string, unknown>>(req);
        assertAllowedFields(body, [
          'current_password',
          'new_password',
          'confirm_password',
          'currentPassword',
          'newPassword',
          'confirmPassword',
        ]);

        const currentPassword = (body['current_password'] ??
          body['currentPassword']) as string | undefined;
        const newPassword = (body['new_password'] ?? body['newPassword']) as
          string | undefined;
        const confirmPassword = (body['confirm_password'] ??
          body['confirmPassword']) as string | undefined;

        if (confirmPassword !== undefined && confirmPassword !== newPassword) {
          throw new AuthError(
            'VALIDATION_ERROR',
            'Xác nhận mật khẩu mới không khớp (Confirm password does not match new password)',
            400,
            [
              {
                field: 'confirm_password',
                message: 'Mật khẩu xác nhận không khớp',
              },
            ],
          );
        }

        const clientIp = getClientIp(req, trustedProxies);
        const result = await authService.changePassword({
          context: sessionContext,
          currentPassword,
          newPassword,
          clientIp,
          requestId,
        });

        // Generate refreshed CSRF token for the rotated session
        const refreshedCsrf = generateCsrfToken(
          sessionContext.sessionTokenHash,
          csrfSecret,
        );

        return sendJson(
          res,
          200,
          createSuccessEnvelope(
            { ...result, csrf_token: refreshedCsrf },
            requestId,
          ),
        );
      }

      // 8. POST /api/v1/auth/activate (Anonymous)
      if (method === 'POST' && pathname === '/api/v1/auth/activate') {
        requireLoginOrigin(req, allowedOrigins, isProduction);
        requireLoginJson(req);

        if (!authService) {
          const body = createErrorEnvelope(
            'DATABASE_UNAVAILABLE',
            'Authentication service is unavailable',
            requestId,
          );
          return sendJson(res, 503, body);
        }

        const body = await parseJsonBody<Record<string, unknown>>(req);
        assertAllowedFields(body, ['token', 'new_password']);

        const clientIp = getClientIp(req, trustedProxies);
        const result = await authService.activateAccount({
          token: typeof body['token'] === 'string' ? body['token'] : '',
          newPassword:
            typeof body['new_password'] === 'string'
              ? body['new_password']
              : '',
          clientIp,
          requestId,
        });

        return sendJson(res, 200, createSuccessEnvelope(result, requestId));
      }

      // 8a. POST /api/v1/auth/forgot-password (Anonymous)
      if (method === 'POST' && pathname === '/api/v1/auth/forgot-password') {
        requireLoginOrigin(req, allowedOrigins, isProduction);
        requireLoginJson(req);

        if (!authService) {
          const body = createErrorEnvelope(
            'DATABASE_UNAVAILABLE',
            'Authentication service is unavailable',
            requestId,
          );
          return sendJson(res, 503, body);
        }

        const body = await parseJsonBody<Record<string, unknown>>(req);
        assertAllowedFields(body, ['email']);

        const clientIp = getClientIp(req, trustedProxies);
        const result = await authService.requestPasswordReset({
          email: typeof body['email'] === 'string' ? body['email'] : '',
          clientIp,
          requestId,
        });

        return sendJson(res, 200, createSuccessEnvelope(result, requestId));
      }

      // 8b. POST /api/v1/auth/reset-password (Anonymous)
      if (method === 'POST' && pathname === '/api/v1/auth/reset-password') {
        requireLoginOrigin(req, allowedOrigins, isProduction);
        requireLoginJson(req);

        if (!authService) {
          const body = createErrorEnvelope(
            'DATABASE_UNAVAILABLE',
            'Authentication service is unavailable',
            requestId,
          );
          return sendJson(res, 503, body);
        }

        const body = await parseJsonBody<Record<string, unknown>>(req);
        assertAllowedFields(body, ['token', 'new_password']);

        const clientIp = getClientIp(req, trustedProxies);
        const result = await authService.resetPasswordWithToken({
          token: typeof body['token'] === 'string' ? body['token'] : '',
          newPassword:
            typeof body['new_password'] === 'string'
              ? body['new_password']
              : '',
          clientIp,
          requestId,
        });

        return sendJson(res, 200, createSuccessEnvelope(result, requestId));
      }

      // 8c. POST /api/v1/auth/verify-email/request (or /resend)
      if (
        method === 'POST' &&
        (pathname === '/api/v1/auth/verify-email/request' ||
          pathname === '/api/v1/auth/verify-email/resend')
      ) {
        requireLoginOrigin(req, allowedOrigins, isProduction);
        requireLoginJson(req);

        if (!authService) {
          const body = createErrorEnvelope(
            'DATABASE_UNAVAILABLE',
            'Authentication service is unavailable',
            requestId,
          );
          return sendJson(res, 503, body);
        }

        const body = await parseJsonBody<Record<string, unknown>>(req);
        assertAllowedFields(body, ['email']);

        let email =
          typeof body['email'] === 'string' ? body['email'].trim() : '';
        let revealDelivery = false;
        try {
          const sessionContext = await requireAuth(
            authService,
            req,
            isProduction,
          );
          if (
            !email ||
            email.toLowerCase() === sessionContext.user.email.toLowerCase()
          ) {
            email = sessionContext.user.email;
            revealDelivery = true;
          }
        } catch {
          // Unauthenticated: anti-enumeration generic response only
        }

        const clientIp = getClientIp(req, trustedProxies);
        const result = await authService.requestEmailVerification({
          email,
          clientIp,
          requestId,
          revealDelivery,
        });

        return sendJson(res, 200, createSuccessEnvelope(result, requestId));
      }

      // 8d. POST /api/v1/auth/verify-email/confirm (or /verify-email)
      if (
        method === 'POST' &&
        (pathname === '/api/v1/auth/verify-email/confirm' ||
          pathname === '/api/v1/auth/verify-email')
      ) {
        requireLoginOrigin(req, allowedOrigins, isProduction);
        requireLoginJson(req);

        if (!authService) {
          const body = createErrorEnvelope(
            'DATABASE_UNAVAILABLE',
            'Authentication service is unavailable',
            requestId,
          );
          return sendJson(res, 503, body);
        }

        const body = await parseJsonBody<Record<string, unknown>>(req);
        assertAllowedFields(body, ['token']);

        const clientIp = getClientIp(req, trustedProxies);
        const result = await authService.confirmEmailVerification({
          token: typeof body['token'] === 'string' ? body['token'] : '',
          clientIp,
          requestId,
        });

        return sendJson(res, 200, createSuccessEnvelope(result, requestId));
      }

      // 9. POST /api/v1/auth/reauth (Owner reauthentication for secret actions)
      if (method === 'POST' && pathname === '/api/v1/auth/reauth') {
        if (!authService || !accountsService) {
          const body = createErrorEnvelope(
            'SERVICE_UNAVAILABLE',
            'Accounts service is unavailable',
            requestId,
          );
          return sendJson(res, 503, body);
        }

        const sessionContext = await requireAuth(
          authService,
          req,
          isProduction,
        );
        requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);

        const body = await parseJsonBody<Record<string, unknown>>(req);
        assertAllowedFields(body, ['password', 'action', 'account_id']);

        const result = await accountsService.reauth(
          sessionContext,
          body as unknown as ReauthRequestBody,
          requestId,
        );

        return sendJson(res, 200, createSuccessEnvelope(result, requestId), {
          'Cache-Control': 'no-store',
        });
      }

      // 9. GET /api/v1/employees/me (Self employee profile)
      if (method === 'GET' && pathname === '/api/v1/employees/me') {
        if (!authService || !employeeService) {
          return sendJson(
            res,
            503,
            createErrorEnvelope(
              'DATABASE_UNAVAILABLE',
              'Service unavailable',
              requestId,
            ),
          );
        }

        const sessionContext = await requireAuth(
          authService,
          req,
          isProduction,
        );
        const emp = await employeeService.getEmployeeMe(sessionContext);
        return sendJson(res, 200, createSuccessEnvelope(emp, requestId));
      }

      // 9a. GET /api/v1/employees/next-code (Next sequential NV code - Owner only)
      if (method === 'GET' && pathname === '/api/v1/employees/next-code') {
        if (!authService || !employeeService) {
          return sendJson(
            res,
            503,
            createErrorEnvelope(
              'DATABASE_UNAVAILABLE',
              'Service unavailable',
              requestId,
            ),
          );
        }

        const sessionContext = await requireAuth(
          authService,
          req,
          isProduction,
        );
        const data = await employeeService.getNextEmployeeCode(sessionContext);
        return sendJson(res, 200, createSuccessEnvelope(data, requestId));
      }

      // 10. GET /api/v1/employees (List employees - Owner only)
      if (method === 'GET' && pathname === '/api/v1/employees') {
        if (!authService || !employeeService) {
          return sendJson(
            res,
            503,
            createErrorEnvelope(
              'DATABASE_UNAVAILABLE',
              'Service unavailable',
              requestId,
            ),
          );
        }

        const sessionContext = await requireAuth(
          authService,
          req,
          isProduction,
        );
        const parsedUrl = new URL(req.url || '/', 'http://localhost');
        const status = parsedUrl.searchParams.get('status') || undefined;
        const limitStr = parsedUrl.searchParams.get('limit');
        const limit = limitStr ? parseInt(limitStr, 10) : undefined;
        const cursor = parsedUrl.searchParams.get('cursor') || undefined;

        const list = await employeeService.listEmployees(sessionContext, {
          status,
          limit,
          cursor,
        });
        return sendJson(res, 200, createSuccessEnvelope(list, requestId));
      }

      // 11. POST /api/v1/employees (Create employee - Owner only)
      if (method === 'POST' && pathname === '/api/v1/employees') {
        if (!authService || !employeeService) {
          return sendJson(
            res,
            503,
            createErrorEnvelope(
              'DATABASE_UNAVAILABLE',
              'Service unavailable',
              requestId,
            ),
          );
        }

        const sessionContext = await requireAuth(
          authService,
          req,
          isProduction,
        );
        requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);

        const body = await parseJsonBody<Record<string, unknown>>(req);
        assertAllowedFields(body, [
          'employee_code',
          'full_name',
          'email',
          'username',
          'role',
          'phone',
          'date_of_birth',
          'gender',
          'national_id',
          'address',
          'position_title',
          'emergency_contact',
          'bank_name',
          'bank_account_number',
          'bank_account_holder',
        ]);

        const result = await employeeService.createEmployee(
          sessionContext,
          body as unknown as CreateEmployeeRequestBody,
          requestId,
        );
        return sendJson(res, 201, createSuccessEnvelope(result, requestId));
      }

      // 12. Dynamic /api/v1/employees/:id routes
      const employeeRouteMatch = pathname.match(
        /^\/api\/v1\/employees\/([a-zA-Z0-9_-]+)(?:\/(suspend|reactivate|activation-invites|activation-status))?$/,
      );

      if (employeeRouteMatch) {
        if (!authService || !employeeService) {
          return sendJson(
            res,
            503,
            createErrorEnvelope(
              'DATABASE_UNAVAILABLE',
              'Service unavailable',
              requestId,
            ),
          );
        }

        const empId = employeeRouteMatch[1]!;
        const subAction = employeeRouteMatch[2];

        if (subAction === 'suspend' && method === 'POST') {
          const sessionContext = await requireAuth(
            authService,
            req,
            isProduction,
          );
          requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);

          const body = await parseJsonBody<Record<string, unknown>>(req);
          assertAllowedFields(body, ['reason']);

          const ifMatch = req.headers['if-match'];
          const result = await employeeService.suspendEmployee(
            sessionContext,
            empId,
            String(body['reason'] || ''),
            ifMatch,
            requestId,
          );
          return sendJson(res, 200, createSuccessEnvelope(result, requestId));
        }

        if (subAction === 'reactivate' && method === 'POST') {
          const sessionContext = await requireAuth(
            authService,
            req,
            isProduction,
          );
          requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);

          const body = await parseJsonBody<Record<string, unknown>>(req);
          assertAllowedFields(body, ['reason']);

          const ifMatch = req.headers['if-match'];
          const result = await employeeService.reactivateEmployee(
            sessionContext,
            empId,
            String(body['reason'] || ''),
            ifMatch,
            requestId,
          );
          return sendJson(res, 200, createSuccessEnvelope(result, requestId));
        }

        if (subAction === 'activation-invites' && method === 'POST') {
          const sessionContext = await requireAuth(
            authService,
            req,
            isProduction,
          );
          requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);

          const result = await employeeService.issueActivationInvite(
            sessionContext,
            empId,
            requestId,
          );
          return sendJson(res, 202, createSuccessEnvelope(result, requestId));
        }

        if (subAction === 'activation-status' && method === 'GET') {
          const sessionContext = await requireAuth(
            authService,
            req,
            isProduction,
          );
          const result = await employeeService.getActivationStatus(
            sessionContext,
            empId,
          );
          return sendJson(res, 200, createSuccessEnvelope(result, requestId));
        }

        if (!subAction && method === 'GET') {
          const sessionContext = await requireAuth(
            authService,
            req,
            isProduction,
          );
          const emp = await employeeService.getEmployeeById(
            sessionContext,
            empId,
          );
          return sendJson(res, 200, createSuccessEnvelope(emp, requestId));
        }

        if (!subAction && method === 'PATCH') {
          const sessionContext = await requireAuth(
            authService,
            req,
            isProduction,
          );
          requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);

          const body = await parseJsonBody<Record<string, unknown>>(req);
          assertAllowedFields(body, [
            'full_name',
            'role',
            'sub_permissions',
            'is_payroll_eligible',
            'phone',
            'date_of_birth',
            'gender',
            'national_id',
            'address',
            'position_title',
            'emergency_contact',
            'bank_name',
            'bank_account_number',
            'bank_account_holder',
          ]);

          const ifMatch = req.headers['if-match'];
          const result = await employeeService.updateEmployee(
            sessionContext,
            empId,
            body as unknown as UpdateEmployeeRequestBody,
            ifMatch,
            requestId,
          );
          return sendJson(res, 200, createSuccessEnvelope(result, requestId));
        }
      }

      // ==========================================
      // ATTENDANCE MODULE ROUTES (UI04, UI05, UI06, UI07)
      // ==========================================

      // 13. GET /api/v1/attendance/me (Self current shift & recent history)
      if (method === 'GET' && pathname === '/api/v1/attendance/me') {
        if (!authService || !attendanceService) {
          return sendJson(
            res,
            503,
            createErrorEnvelope(
              'DATABASE_UNAVAILABLE',
              'Service unavailable',
              requestId,
            ),
          );
        }

        const sessionContext = await requireAuth(
          authService,
          req,
          isProduction,
        );
        const parsedUrl = new URL(req.url || '/', 'http://localhost');
        const from_date = parsedUrl.searchParams.get('from_date') || undefined;
        const to_date = parsedUrl.searchParams.get('to_date') || undefined;
        const run_state = parsedUrl.searchParams.get('run_state') || undefined;
        const review_state =
          parsedUrl.searchParams.get('review_state') || undefined;
        const limitStr = parsedUrl.searchParams.get('limit');
        const limit = limitStr ? parseInt(limitStr, 10) : undefined;
        const offsetStr = parsedUrl.searchParams.get('offset');
        const offset = offsetStr ? parseInt(offsetStr, 10) : undefined;
        const cursor = parsedUrl.searchParams.get('cursor') || undefined;

        const data = await attendanceService.getAttendanceMe(sessionContext, {
          from_date,
          to_date,
          run_state,
          review_state,
          limit,
          offset,
          cursor,
        });
        return sendJson(res, 200, createSuccessEnvelope(data, requestId));
      }

      // 14. POST /api/v1/attendance/shifts (Clock in)
      if (method === 'POST' && pathname === '/api/v1/attendance/shifts') {
        if (!authService || !attendanceService) {
          return sendJson(
            res,
            503,
            createErrorEnvelope(
              'DATABASE_UNAVAILABLE',
              'Service unavailable',
              requestId,
            ),
          );
        }

        const sessionContext = await requireAuth(
          authService,
          req,
          isProduction,
        );
        requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);

        const data = await attendanceService.clockIn(sessionContext, requestId);
        return sendJson(res, 201, createSuccessEnvelope(data, requestId));
      }

      // 15. GET /api/v1/attendance/shifts (List workspace shifts - Owner only)
      if (method === 'GET' && pathname === '/api/v1/attendance/shifts') {
        if (!authService || !attendanceService) {
          return sendJson(
            res,
            503,
            createErrorEnvelope(
              'DATABASE_UNAVAILABLE',
              'Service unavailable',
              requestId,
            ),
          );
        }

        const sessionContext = await requireAuth(
          authService,
          req,
          isProduction,
        );
        const parsedUrl = new URL(req.url || '/', 'http://localhost');
        const employee_id =
          parsedUrl.searchParams.get('employee_id') || undefined;
        const from_date = parsedUrl.searchParams.get('from_date') || undefined;
        const to_date = parsedUrl.searchParams.get('to_date') || undefined;
        const run_state = parsedUrl.searchParams.get('run_state') || undefined;
        const review_state =
          parsedUrl.searchParams.get('review_state') || undefined;
        const limitStr = parsedUrl.searchParams.get('limit');
        const limit = limitStr ? parseInt(limitStr, 10) : undefined;
        const offsetStr = parsedUrl.searchParams.get('offset');
        const offset = offsetStr ? parseInt(offsetStr, 10) : undefined;
        const cursor = parsedUrl.searchParams.get('cursor') || undefined;

        const data = await attendanceService.listShifts(sessionContext, {
          employee_id,
          from_date,
          to_date,
          run_state,
          review_state,
          limit,
          offset,
          cursor,
        });
        return sendJson(res, 200, createSuccessEnvelope(data, requestId));
      }

      // 16. Dynamic /api/v1/attendance/shifts/:id/(breaks|resume|clock-out|reviews|correction-requests|owner-close)
      const shiftActionMatch = pathname.match(
        /^\/api\/v1\/attendance\/shifts\/([a-zA-Z0-9_-]+)\/(breaks|resume|clock-out|reviews|correction-requests|owner-close)$/,
      );

      if (shiftActionMatch && method === 'POST') {
        if (!authService || !attendanceService) {
          return sendJson(
            res,
            503,
            createErrorEnvelope(
              'DATABASE_UNAVAILABLE',
              'Service unavailable',
              requestId,
            ),
          );
        }

        const shiftId = shiftActionMatch[1]!;
        const action = shiftActionMatch[2];
        const sessionContext = await requireAuth(
          authService,
          req,
          isProduction,
        );
        requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);

        if (action === 'breaks') {
          const result = await attendanceService.startBreak(
            sessionContext,
            shiftId,
            requestId,
          );
          return sendJson(res, 200, createSuccessEnvelope(result, requestId));
        }

        if (action === 'resume') {
          const result = await attendanceService.resumeBreak(
            sessionContext,
            shiftId,
            requestId,
          );
          return sendJson(res, 200, createSuccessEnvelope(result, requestId));
        }

        if (action === 'clock-out') {
          const result = await attendanceService.clockOut(
            sessionContext,
            shiftId,
            requestId,
          );
          return sendJson(res, 200, createSuccessEnvelope(result, requestId));
        }

        if (action === 'reviews') {
          const body = await parseJsonBody<Record<string, unknown>>(req);
          assertAllowedFields(body, ['decision', 'reason']);
          const result = await attendanceService.reviewShift(
            sessionContext,
            shiftId,
            body as unknown as ReviewShiftRequestBody,
            requestId,
          );
          return sendJson(res, 200, createSuccessEnvelope(result, requestId));
        }

        if (action === 'owner-close') {
          const body = await parseJsonBody<Record<string, unknown>>(req);
          assertAllowedFields(body, ['clock_out_at', 'reason']);
          const result = await attendanceService.ownerCloseShift(
            sessionContext,
            shiftId,
            {
              clock_out_at:
                typeof body['clock_out_at'] === 'string'
                  ? body['clock_out_at']
                  : undefined,
              reason:
                typeof body['reason'] === 'string' ? body['reason'] : undefined,
            },
            requestId,
          );
          return sendJson(res, 200, createSuccessEnvelope(result, requestId));
        }

        if (action === 'correction-requests') {
          const body = await parseJsonBody<Record<string, unknown>>(req);
          assertAllowedFields(body, [
            'reason',
            'claimed_clock_out_at',
            'evidence_note',
          ]);
          const result = await attendanceService.createCorrectionRequest(
            sessionContext,
            shiftId,
            body as unknown as CreateCorrectionRequestBody,
            requestId,
          );
          return sendJson(res, 201, createSuccessEnvelope(result, requestId));
        }
      }

      // 17. Dynamic /api/v1/attendance/correction-requests/:id/decide
      const decideCorrectionMatch = pathname.match(
        /^\/api\/v1\/attendance\/correction-requests\/([a-zA-Z0-9_-]+)\/decide$/,
      );

      if (decideCorrectionMatch && method === 'POST') {
        if (!authService || !attendanceService) {
          return sendJson(
            res,
            503,
            createErrorEnvelope(
              'DATABASE_UNAVAILABLE',
              'Service unavailable',
              requestId,
            ),
          );
        }

        const crId = decideCorrectionMatch[1]!;
        const sessionContext = await requireAuth(
          authService,
          req,
          isProduction,
        );
        requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);

        const body = await parseJsonBody<Record<string, unknown>>(req);
        assertAllowedFields(body, ['decision', 'reason', 'clock_out_at']);

        const result = await attendanceService.decideCorrectionRequest(
          sessionContext,
          crId,
          body as unknown as DecideCorrectionRequestBody,
          requestId,
        );
        return sendJson(res, 200, createSuccessEnvelope(result, requestId));
      }

      // ==========================================
      // REPORTS MODULE ROUTES (UI08, UI09, UI10, REP C02)
      // ==========================================

      // 18. GET /api/v1/reports/me (Self daily reports list)
      if (method === 'GET' && pathname === '/api/v1/reports/me') {
        if (!authService || !reportsService) {
          return sendJson(
            res,
            503,
            createErrorEnvelope(
              'DATABASE_UNAVAILABLE',
              'Service unavailable',
              requestId,
            ),
          );
        }

        const sessionContext = await requireAuth(
          authService,
          req,
          isProduction,
        );
        const parsedUrl = new URL(req.url || '/', 'http://localhost');
        const start_date =
          parsedUrl.searchParams.get('start_date') || undefined;
        const end_date = parsedUrl.searchParams.get('end_date') || undefined;
        const status = parsedUrl.searchParams.get('status') || undefined;
        const cursor = parsedUrl.searchParams.get('cursor') || undefined;
        const limitStr = parsedUrl.searchParams.get('limit');
        const limit = limitStr ? parseInt(limitStr, 10) : undefined;

        const data = await reportsService.getReportsMe(sessionContext, {
          start_date,
          end_date,
          status,
          limit,
          cursor,
        });
        return sendJson(res, 200, createSuccessEnvelope(data, requestId));
      }

      // 19. GET /api/v1/reports/daily (Workspace reports list - Owner only)
      if (method === 'GET' && pathname === '/api/v1/reports/daily') {
        if (!authService || !reportsService) {
          return sendJson(
            res,
            503,
            createErrorEnvelope(
              'DATABASE_UNAVAILABLE',
              'Service unavailable',
              requestId,
            ),
          );
        }

        const sessionContext = await requireAuth(
          authService,
          req,
          isProduction,
        );
        const parsedUrl = new URL(req.url || '/', 'http://localhost');
        const employee_id =
          parsedUrl.searchParams.get('employee_id') || undefined;
        const start_date =
          parsedUrl.searchParams.get('start_date') || undefined;
        const end_date = parsedUrl.searchParams.get('end_date') || undefined;
        const status = parsedUrl.searchParams.get('status') || undefined;
        const cursor = parsedUrl.searchParams.get('cursor') || undefined;
        const limitStr = parsedUrl.searchParams.get('limit');
        const limit = limitStr ? parseInt(limitStr, 10) : undefined;

        const data = await reportsService.listDailyReports(sessionContext, {
          employee_id,
          start_date,
          end_date,
          status,
          limit,
          cursor,
        });
        return sendJson(res, 200, createSuccessEnvelope(data, requestId));
      }

      // 20. POST /api/v1/reports/daily (Create daily report draft)
      if (method === 'POST' && pathname === '/api/v1/reports/daily') {
        if (!authService || !reportsService) {
          return sendJson(
            res,
            503,
            createErrorEnvelope(
              'DATABASE_UNAVAILABLE',
              'Service unavailable',
              requestId,
            ),
          );
        }

        const sessionContext = await requireAuth(
          authService,
          req,
          isProduction,
        );
        requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);

        const body = await parseJsonBody<Record<string, unknown>>(req);
        assertAllowedFields(body, ['report_date', 'entries', 'notes']);

        const data = await reportsService.createReport(
          sessionContext,
          body as unknown as CreateReportRequestBody,
        );
        return sendJson(res, 201, createSuccessEnvelope(data, requestId));
      }

      // 21. Dynamic /api/v1/reports/daily/:id/(submit|revisions)
      const reportActionMatch = pathname.match(
        /^\/api\/v1\/reports\/daily\/([a-zA-Z0-9_-]+)\/(submit|revisions)$/,
      );

      if (reportActionMatch) {
        if (!authService || !reportsService) {
          return sendJson(
            res,
            503,
            createErrorEnvelope(
              'DATABASE_UNAVAILABLE',
              'Service unavailable',
              requestId,
            ),
          );
        }

        const reportId = reportActionMatch[1]!;
        const action = reportActionMatch[2];

        if (action === 'submit' && method === 'POST') {
          const sessionContext = await requireAuth(
            authService,
            req,
            isProduction,
          );
          requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);

          const ifMatch = req.headers['if-match'];
          const result = await reportsService.submitReport(
            sessionContext,
            reportId,
            ifMatch,
          );
          return sendJson(res, 200, createSuccessEnvelope(result, requestId));
        }

        if (action === 'revisions' && method === 'POST') {
          const sessionContext = await requireAuth(
            authService,
            req,
            isProduction,
          );
          requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);

          const body = await parseJsonBody<Record<string, unknown>>(req);
          assertAllowedFields(body, ['entries', 'notes', 'reason']);

          const ifMatch = req.headers['if-match'];
          const result = await reportsService.reviseReport(
            sessionContext,
            reportId,
            body as unknown as ReviseReportRequestBody,
            ifMatch,
          );
          return sendJson(res, 201, createSuccessEnvelope(result, requestId));
        }

        if (action === 'revisions' && method === 'GET') {
          const sessionContext = await requireAuth(
            authService,
            req,
            isProduction,
          );
          const revisions = await reportsService.listRevisions(
            sessionContext,
            reportId,
          );
          return sendJson(
            res,
            200,
            createSuccessEnvelope(revisions, requestId),
          );
        }
      }

      // 22. Dynamic /api/v1/reports/daily/:id (GET detail, PATCH update draft)
      const reportDetailMatch = pathname.match(
        /^\/api\/v1\/reports\/daily\/([a-zA-Z0-9_-]+)$/,
      );

      if (reportDetailMatch) {
        if (!authService || !reportsService) {
          return sendJson(
            res,
            503,
            createErrorEnvelope(
              'DATABASE_UNAVAILABLE',
              'Service unavailable',
              requestId,
            ),
          );
        }

        const reportId = reportDetailMatch[1]!;

        if (method === 'GET') {
          const sessionContext = await requireAuth(
            authService,
            req,
            isProduction,
          );
          const report = await reportsService.getReportById(
            sessionContext,
            reportId,
          );
          return sendJson(res, 200, createSuccessEnvelope(report, requestId));
        }

        if (method === 'PATCH') {
          const sessionContext = await requireAuth(
            authService,
            req,
            isProduction,
          );
          requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);

          const body = await parseJsonBody<Record<string, unknown>>(req);
          assertAllowedFields(body, ['entries', 'notes']);

          const ifMatch = req.headers['if-match'];
          const result = await reportsService.updateDraftReport(
            sessionContext,
            reportId,
            body as unknown as UpdateReportRequestBody,
            ifMatch,
          );
          return sendJson(res, 200, createSuccessEnvelope(result, requestId));
        }
      }

      // =======================================================================
      // 23. MODULAR DOMAIN ROUTER (SCHEDULES / ACCOUNTS / STORAGE / AUDIT / ISSUES)
      // =======================================================================
      const routeCtx = {
        req,
        res,
        method,
        pathname,
        requestId,
        isProduction,
        csrfSecret,
        allowedOrigins,
        requireAuth,
        parseJsonBody,
        assertAllowedFields,
        authService: authService ?? undefined,
        schedulesService: schedulesService ?? undefined,
        accountsService: accountsService ?? undefined,
        storageService: storageService ?? undefined,
        auditService: auditService ?? undefined,
        issuesService: issuesService ?? undefined,
        printQuoteService: printQuoteService ?? undefined,
      };
      if (await routeTable.dispatch(routeCtx)) {
        return;
      }

      const workPath = pathname.match(
        /^\/api\/v1\/work-items(?:\/([a-f0-9-]{36})(?:\/(cancel|assignments|schedule-links)(?:\/([a-f0-9-]{36})\/(start|submissions|reviews)(?:\/([a-f0-9-]{36})\/(reviews))?)?)?)?$/i,
      );
      if (workPath) {
        if (
          (['cancel', 'schedule-links'].includes(workPath[2] ?? '') &&
            workPath[3]) ||
          (workPath[5] && workPath[4] !== 'submissions')
        )
          throw new AuthError('NOT_FOUND', 'Endpoint not found', 404);
        if (!authService || !workService)
          throw new AuthError(
            'SERVICE_UNAVAILABLE',
            'Work service unavailable',
            503,
          );
        const auth = await requireAuth(authService, req, isProduction);
        const [, id, section, assignment, operation, submission] = workPath;
        let result: unknown;
        let status = 200;
        if (method === 'GET' && !section)
          result = id
            ? await workService.get(auth, id)
            : await workService.list(
                auth,
                new URL(req.url || '/', 'http://localhost').searchParams,
              );
        else {
          const action =
            !id && method === 'POST'
              ? 'create'
              : id && !section && method === 'PATCH'
                ? 'edit'
                : method === 'POST' && section === 'cancel'
                  ? 'cancel'
                  : method === 'POST' && section === 'schedule-links'
                    ? 'schedule'
                    : method === 'POST' &&
                        section === 'assignments' &&
                        !assignment
                      ? 'assign'
                      : method === 'POST' && assignment
                        ? operation === 'start'
                          ? 'start'
                          : operation === 'submissions' && !submission
                            ? 'submit'
                            : operation === 'reviews' || submission
                              ? 'review'
                              : null
                        : null;
          if (!action)
            throw new AuthError('NOT_FOUND', 'Endpoint not found', 404);
          requireCsrf(req, auth, csrfSecret, allowedOrigins);
          const body = await parseJsonBody<Record<string, unknown>>(req);
          if (!body || typeof body !== 'object' || Array.isArray(body))
            throw new AuthError(
              'VALIDATION_ERROR',
              'Object body required',
              400,
            );
          const key =
            typeof req.headers['idempotency-key'] === 'string'
              ? req.headers['idempotency-key']
              : undefined;
          const match =
            typeof req.headers['if-match'] === 'string'
              ? req.headers['if-match']
              : undefined;
          result =
            action === 'create'
              ? await workService.create(auth, body, key, requestId)
              : await workService.mutate(
                  auth,
                  id!,
                  action,
                  assignment,
                  submission,
                  body,
                  match,
                  key,
                  requestId,
                );
          if (['create', 'assign', 'submit'].includes(action)) status = 201;
        }
        sendJson(res, status, createSuccessEnvelope(result, requestId));
        return;
      }

      // Payroll tools (Owner): statistics by day/week/month/year and timesheet xlsx export/import.
      if (
        pathname === '/api/v1/payroll-tools/stats' ||
        pathname === '/api/v1/payroll-tools/timesheet/export' ||
        pathname === '/api/v1/payroll-tools/timesheet/import'
      ) {
        if (!authService || !timesheetService)
          throw new AuthError(
            'SERVICE_UNAVAILABLE',
            'Payroll service unavailable',
            503,
          );
        const toolAuth = await requireAuth(authService, req, isProduction);
        const sp = new URL(req.url ?? '/', 'http://localhost').searchParams;
        if (method === 'GET' && pathname.endsWith('/stats')) {
          const data = await timesheetService.stats(toolAuth, {
            granularity: sp.get('granularity') ?? undefined,
            from: sp.get('from') ?? undefined,
            to: sp.get('to') ?? undefined,
            employee_id: sp.get('employee_id') ?? undefined,
          });
          sendJson(res, 200, createSuccessEnvelope(data, requestId));
          return;
        }
        if (method === 'GET' && pathname.endsWith('/export')) {
          const file = await timesheetService.exportYear(
            toolAuth,
            sp.get('employee_id') ?? '',
            Number(sp.get('year') ?? new Date().getFullYear()),
          );
          res.writeHead(200, {
            'Content-Type':
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="${file.filename}"`,
            'Content-Length': file.buffer.length,
            'Cache-Control': 'no-store',
          });
          res.end(file.buffer);
          return;
        }
        if (method === 'POST' && pathname.endsWith('/import')) {
          requireCsrf(req, toolAuth, csrfSecret, allowedOrigins);
          const body = await parseJsonBody<Record<string, unknown>>(
            req,
            3 * 1024 * 1024,
          );
          if (!body || typeof body !== 'object' || Array.isArray(body))
            throw new AuthError(
              'VALIDATION_ERROR',
              'Object body required',
              400,
            );
          assertAllowedFields(body, [
            'file_base64',
            'year',
            'employee_id',
            'new_employee_name',
            'commit',
          ]);
          const data = await timesheetService.importWorkbook(
            toolAuth,
            body as unknown as Parameters<
              TimesheetService['importWorkbook']
            >[1],
            requestId,
          );
          sendJson(
            res,
            data.committed ? 201 : 200,
            createSuccessEnvelope(data, requestId),
          );
          return;
        }
        throw new AuthError('NOT_FOUND', 'Endpoint not found', 404);
      }

      // Default 404 for unknown endpoints (Doc 24 compliant)
      // PAY-01: exactly the eight extension endpoints; no paid-leaves alias.
      const payPath = pathname.match(
        /^\/api\/v1\/payroll\/(hourly-rates|periods(?:\/([1-9][0-9]{3}-(?:0[1-9]|1[0-2]))(?:\/(me|adjustments|finalize))?)?|items\/([a-f0-9-]{36})\/disbursements)$/i,
      );
      if (payPath && ['GET', 'POST'].includes(method)) {
        if (!authService || !payrollService)
          throw new AuthError(
            'SERVICE_UNAVAILABLE',
            'Payroll service unavailable',
            503,
          );
        const auth = await requireAuth(authService, req, isProduction);
        const month = payPath[2],
          action = payPath[3],
          item = payPath[4];
        let result: unknown;
        if (method === 'GET') {
          if (payPath[1] === 'hourly-rates')
            result = await payrollService.rates(auth);
          else if (payPath[1] === 'periods')
            result = await payrollService.periods(auth);
          else if (month && action === 'me')
            result = await payrollService.me(auth, month);
          else if (month && !action)
            result = await payrollService.overview(auth, month);
          else throw new AuthError('NOT_FOUND', 'Endpoint not found', 404);
        } else {
          requireCsrf(req, auth, csrfSecret, allowedOrigins);
          const body = await parseJsonBody<Record<string, unknown>>(req);
          if (!body || typeof body !== 'object' || Array.isArray(body))
            throw new AuthError(
              'VALIDATION_ERROR',
              'Object body required',
              400,
            );
          const key =
            typeof req.headers['idempotency-key'] === 'string'
              ? req.headers['idempotency-key']
              : undefined;
          const match =
            typeof req.headers['if-match'] === 'string'
              ? req.headers['if-match']
              : undefined;
          if (payPath[1] === 'hourly-rates') {
            assertAllowedFields(body, [
              'employee_id',
              'hourly_rate_vnd',
              'effective_from',
            ]);
            result = await payrollService.setRate(auth, body, key, requestId);
          } else if (month && action === 'adjustments') {
            assertAllowedFields(body, [
              'employee_id',
              'adjustment_type',
              'attributable_date',
              'amount_vnd',
              'reason',
            ]);
            result = await payrollService.adjustment(
              auth,
              month,
              body,
              key,
              requestId,
            );
          } else if (month && action === 'finalize') {
            assertAllowedFields(body, []);
            result = await payrollService.finalize(
              auth,
              month,
              match,
              key,
              requestId,
            );
          } else if (item) {
            assertAllowedFields(body, [
              'amount_vnd',
              'payment_method',
              'payment_date',
              'reference_note',
            ]);
            result = await payrollService.disburse(
              auth,
              item,
              body,
              key,
              requestId,
            );
          } else throw new AuthError('NOT_FOUND', 'Endpoint not found', 404);
        }
        return sendJson(
          res,
          method === 'POST' && action !== 'finalize' ? 201 : 200,
          createSuccessEnvelope(result, requestId),
        );
      }

      const body = createErrorEnvelope(
        'NOT_FOUND',
        `Endpoint ${method} ${pathname} not found`,
        requestId,
      );
      return sendJson(res, 404, body);
    } catch (err) {
      errorByResponse.set(res, err);
      if (err instanceof FinanceValidationError) {
        return sendJson(
          res,
          400,
          createErrorEnvelope(
            'VALIDATION_ERROR',
            'Invalid finance request',
            requestId,
            [{ field: err.field, message: 'Invalid field' }],
          ),
        );
      }
      if (err instanceof AuthError) {
        const errorBody = createErrorEnvelope(
          err.code,
          err.message,
          requestId,
          err.details,
        );
        return sendJson(res, err.statusCode, errorBody);
      }

      if (err instanceof AuditServiceError) {
        const errorBody = createErrorEnvelope(err.code, err.message, requestId);
        return sendJson(res, err.statusCode, errorBody);
      }

      // Global error fallback: sanitized, zero credential leaks, no stack traces
      console.error(`[INTERNAL_SERVER_ERROR] [req:${requestId}]`, err);
      const body = createErrorEnvelope(
        'INTERNAL_SERVER_ERROR',
        'An unexpected internal error occurred',
        requestId,
      );
      return sendJson(res, 500, body);
    }
  };
}
