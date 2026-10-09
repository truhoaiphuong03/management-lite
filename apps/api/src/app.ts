import http from 'node:http';
import crypto from 'node:crypto';
import type { DatabasePool } from '../../../packages/database/src/pool.js';
import { checkDatabaseHealth } from '../../../packages/database/src/pool.js';
import {
  createSuccessEnvelope,
  createErrorEnvelope,
  sendJson,
} from './envelope.js';
import { AuthService, AuthError } from './auth/service.js';
import { EmployeeService } from './employees/service.js';
import { AttendanceService } from './attendance/service.js';
import { ReportsService } from './reports/service.js';
import { requireAuth, requireCsrf, extractSessionToken } from './auth/guard.js';
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

export interface AppDependencies {
  pool?: DatabasePool | null | undefined;
  authService?: AuthService;
  employeeService?: EmployeeService;
  attendanceService?: AttendanceService;
  reportsService?: ReportsService;
  csrfSecret?: string;
  allowedOrigins?: string[];
  trustedProxies?: string[];
  isProduction?: boolean;
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

/**
 * Parses request body as JSON with maximum length bound to prevent DoS.
 */
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
 * NEVER trusts client-supplied headers (X-Forwarded-For) unless the direct
 * connecting peer (remoteAddress) is explicitly listed in trustedProxies.
 */
export function getClientIp(
  req: http.IncomingMessage,
  trustedProxies: string[] = [],
): string {
  const remoteIp = req.socket.remoteAddress || '127.0.0.1';

  // Only trust forwarded headers if the immediate peer is explicitly in trustedProxies
  if (trustedProxies.length > 0 && trustedProxies.includes(remoteIp)) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      const firstIp = forwarded.split(',')[0]?.trim();
      if (firstIp && firstIp.length > 0) {
        return firstIp;
      }
    }
  }

  return remoteIp;
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
    (deps.pool ? new AuthService(deps.pool, csrfSecret) : null);

  const employeeService =
    deps.employeeService ?? (deps.pool ? new EmployeeService(deps.pool) : null);

  const attendanceService =
    deps.attendanceService ??
    (deps.pool ? new AttendanceService(deps.pool) : null);

  const reportsService =
    deps.reportsService ?? (deps.pool ? new ReportsService(deps.pool) : null);

  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    // 1. Assign deterministic or header-provided request_id
    const headerRequestId = req.headers['x-request-id'];
    const requestId =
      typeof headerRequestId === 'string' && headerRequestId.length > 0
        ? headerRequestId
        : crypto.randomUUID();

    try {
      const pathname = parseRequestPath(req);
      const method = req.method?.toUpperCase() || 'GET';
      // 2. Health / Liveness endpoint: GET /api/v1/health
      if (method === 'GET' && pathname === '/api/v1/health') {
        const body = createSuccessEnvelope(
          {
            status: 'pass',
            service: '@management-lite/api',
            version: '0.1.0',
            uptime: process.uptime(),
          },
          requestId,
        );
        return sendJson(res, 200, body);
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
        assertAllowedFields(body, ['identifier', 'password']);

        const clientIp = getClientIp(req, trustedProxies);
        const result = await authService.loginUser({
          identifier:
            typeof body['identifier'] === 'string' ? body['identifier'] : '',
          password:
            typeof body['password'] === 'string' ? body['password'] : '',
          clientIp,
          requestId,
        });

        const sessionCookie = serializeSessionCookie(result.sessionToken, {
          isProduction,
        });

        return sendJson(
          res,
          200,
          createSuccessEnvelope(result.responseData, requestId),
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
        );
        requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);

        const token = extractSessionToken(req, isProduction);
        await authService.logoutSession({ sessionToken: token, requestId });

        const clearCookie = serializeClearSessionCookie({ isProduction });
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

      // 7. POST /api/v1/auth/password/change
      if (method === 'POST' && pathname === '/api/v1/auth/password/change') {
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
        assertAllowedFields(body, ['current_password', 'new_password']);

        const clientIp = getClientIp(req, trustedProxies);
        const result = await authService.changePassword({
          context: sessionContext,
          currentPassword: body['current_password'],
          newPassword: body['new_password'],
          clientIp,
          requestId,
        });

        return sendJson(res, 200, createSuccessEnvelope(result, requestId));
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
          assertAllowedFields(body, ['full_name', 'is_payroll_eligible']);

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
        const data = await attendanceService.getAttendanceMe(sessionContext);
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

        const data = await attendanceService.listShifts(sessionContext, {
          employee_id,
          from_date,
          to_date,
          run_state,
          review_state,
          limit,
        });
        return sendJson(res, 200, createSuccessEnvelope(data, requestId));
      }

      // 16. Dynamic /api/v1/attendance/shifts/:id/(breaks|resume|clock-out|reviews|correction-requests)
      const shiftActionMatch = pathname.match(
        /^\/api\/v1\/attendance\/shifts\/([a-zA-Z0-9_-]+)\/(breaks|resume|clock-out|reviews|correction-requests)$/,
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
        const limitStr = parsedUrl.searchParams.get('limit');
        const limit = limitStr ? parseInt(limitStr, 10) : undefined;

        const data = await reportsService.getReportsMe(sessionContext, {
          start_date,
          end_date,
          status,
          limit,
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
        const limitStr = parsedUrl.searchParams.get('limit');
        const limit = limitStr ? parseInt(limitStr, 10) : undefined;

        const data = await reportsService.listDailyReports(sessionContext, {
          employee_id,
          start_date,
          end_date,
          status,
          limit,
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

      // Default 404 for unknown endpoints (Doc 24 compliant)
      const body = createErrorEnvelope(
        'NOT_FOUND',
        `Endpoint ${method} ${pathname} not found`,
        requestId,
      );
      return sendJson(res, 404, body);
    } catch (err) {
      if (err instanceof AuthError) {
        const errorBody = createErrorEnvelope(
          err.code,
          err.message,
          requestId,
          err.details,
        );
        return sendJson(res, err.statusCode, errorBody);
      }

      // Global error fallback: sanitized, zero credential leaks, no stack traces
      const body = createErrorEnvelope(
        'INTERNAL_SERVER_ERROR',
        'An unexpected internal error occurred',
        requestId,
      );
      return sendJson(res, 500, body);
    }
  };
}
