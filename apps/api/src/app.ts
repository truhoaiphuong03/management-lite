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
import { requireAuth, requireCsrf, extractSessionToken } from './auth/guard.js';
import {
  serializeSessionCookie,
  serializeClearSessionCookie,
} from './cookie.js';

export interface AppDependencies {
  pool?: DatabasePool | null | undefined;
  authService?: AuthService;
  csrfSecret?: string;
  allowedOrigins?: string[];
  isProduction?: boolean;
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

function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

/**
 * Creates the HTTP request handler for the Management Lite backend API.
 */
export function createRequestHandler(
  deps: AppDependencies = {},
): http.RequestListener {
  const isProduction =
    deps.isProduction ?? process.env['NODE_ENV'] === 'production';
  const csrfSecret =
    deps.csrfSecret ??
    process.env['CSRF_SECRET'] ??
    'mglite_dev_csrf_secret_min_32_bytes_safe_default_key_test';
  const allowedOrigins = deps.allowedOrigins ?? [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3002',
    'http://127.0.0.1:3002',
  ];

  const authService =
    deps.authService ??
    (deps.pool ? new AuthService(deps.pool, csrfSecret) : null);

  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    // 1. Assign deterministic or header-provided request_id
    const headerRequestId = req.headers['x-request-id'];
    const requestId =
      typeof headerRequestId === 'string' && headerRequestId.length > 0
        ? headerRequestId
        : crypto.randomUUID();

    const url = new URL(
      req.url || '/',
      `http://${req.headers.host || 'localhost'}`,
    );
    const pathname = url.pathname;
    const method = req.method?.toUpperCase() || 'GET';

    try {
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
        if (!authService) {
          const body = createErrorEnvelope(
            'DATABASE_UNAVAILABLE',
            'Authentication service is unavailable',
            requestId,
          );
          return sendJson(res, 503, body);
        }

        const body = await parseJsonBody<{
          identifier?: string;
          password?: string;
        }>(req);

        const clientIp = getClientIp(req);
        const result = await authService.loginUser({
          identifier: body.identifier ?? '',
          password: body.password ?? '',
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

        return sendJson(res, 200, createSuccessEnvelope(authMeData, requestId));
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

        const body = await parseJsonBody<{
          current_password?: unknown;
          new_password?: unknown;
        }>(req);

        const clientIp = getClientIp(req);
        const result = await authService.changePassword({
          context: sessionContext,
          currentPassword: body.current_password,
          newPassword: body.new_password,
          clientIp,
          requestId,
        });

        return sendJson(res, 200, createSuccessEnvelope(result, requestId));
      }

      // 8. Default 404 for unknown endpoints (Doc 24 compliant)
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
