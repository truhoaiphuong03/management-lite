import {
  createErrorEnvelope,
  createSuccessEnvelope,
  sendJson,
} from '../envelope.js';
import { AuthError } from '../auth/service.js';
import type {
  WebCustomerAuthResponseData,
  WebCustomerDeleteResponseData,
  WebCustomerLogoutResponseData,
} from '../../../../packages/contracts/src/web-customers.js';
import {
  generateCustomerCsrfToken,
  requireCustomer,
  requireCustomerCsrf,
  resolveCustomerClientIp,
  serializeClearCustomerCookie,
  serializeCustomerCookie,
} from '../web-customers/guard.js';
import type { RouteRequestContext } from './router.js';

function buildPublicHeaders(
  originHeader: string | string[] | undefined,
  allowedOrigins: string[],
  extra: Record<string, string | string[]> = {},
): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {
    'Cache-Control': 'private, no-store',
    ...extra,
  };
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (typeof origin === 'string' && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Vary'] = 'Origin';
    headers['Cross-Origin-Resource-Policy'] = 'cross-origin';
  }
  return headers;
}

/**
 * Isolated public customer routes under /api/v1/public/*.
 * NEVER invokes staff requireAuth() and NEVER accepts internal staff session cookies.
 */
export async function handleWebCustomerPublicRoutes(
  ctx: RouteRequestContext,
): Promise<boolean> {
  const {
    req,
    res,
    method,
    pathname,
    requestId,
    isProduction,
    csrfSecret,
    allowedOrigins,
    parseJsonBody,
    assertAllowedFields,
    requireLoginOrigin,
    requireLoginJson,
    getClientIp,
    webCustomerService,
    gcnProxySecret,
  } = ctx;

  // Handle CORS preflight strictly for allowed origins on /api/v1/public/*
  if (method === 'OPTIONS') {
    const rawOrigin = req.headers.origin;
    const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
    if (typeof origin !== 'string' || !allowedOrigins.includes(origin)) {
      sendJson(
        res,
        403,
        createErrorEnvelope(
          'FORBIDDEN',
          'Nguồn truy cập (Origin) không được phép.',
          requestId,
        ),
      );
      return true;
    }
    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
      'X-Request-Id': requestId,
    });
    res.end();
    return true;
  }

  const isKnownRoute =
    (method === 'POST' && pathname === '/api/v1/public/auth/google') ||
    (method === 'POST' && pathname === '/api/v1/public/auth/logout') ||
    (method === 'GET' && pathname === '/api/v1/public/auth/me') ||
    (method === 'DELETE' && pathname === '/api/v1/public/account') ||
    (method === 'GET' && pathname === '/api/v1/public/account/export');

  if (!isKnownRoute) {
    return false;
  }

  const baseHeaders = buildPublicHeaders(req.headers.origin, allowedOrigins);

  if (!webCustomerService) {
    sendJson(
      res,
      503,
      createErrorEnvelope(
        'SERVICE_UNAVAILABLE',
        'Dịch vụ đăng nhập khách hàng tạm thời không khả dụng.',
        requestId,
      ),
      baseHeaders,
    );
    return true;
  }

  // Production fail-closed when PUBLIC_CUSTOMER_WORKSPACE_ID is missing
  webCustomerService.assertPublicWorkspaceConfigured();

  // 1. POST /api/v1/public/auth/google
  if (method === 'POST' && pathname === '/api/v1/public/auth/google') {
    try {
      requireLoginOrigin(req, allowedOrigins, isProduction);
    } catch {
      throw new AuthError(
        'FORBIDDEN',
        'Nguồn truy cập (Origin) không được phép.',
        403,
      );
    }
    try {
      requireLoginJson(req);
    } catch {
      throw new AuthError(
        'UNSUPPORTED_MEDIA_TYPE',
        'Yêu cầu đăng nhập phải có Content-Type là application/json.',
        415,
      );
    }

    const fallbackIp = getClientIp(req);
    const clientIp = resolveCustomerClientIp(req, fallbackIp, gcnProxySecret);
    const rl = webCustomerService.authGoogleLimiter.increment(clientIp);
    if (!rl.allowed) {
      sendJson(
        res,
        429,
        createErrorEnvelope(
          'RATE_LIMITED',
          'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau ít phút.',
          requestId,
        ),
        buildPublicHeaders(req.headers.origin, allowedOrigins, {
          'Retry-After': String(rl.retryAfterSeconds),
        }),
      );
      return true;
    }

    let body: Record<string, unknown>;
    try {
      body = await parseJsonBody<Record<string, unknown>>(req);
    } catch (err) {
      if (err instanceof AuthError && err.statusCode === 413) {
        throw new AuthError(
          'VALIDATION_ERROR',
          'Dữ liệu yêu cầu vượt quá dung lượng cho phép.',
          413,
        );
      }
      throw new AuthError(
        'VALIDATION_ERROR',
        'Dữ liệu JSON gửi lên không hợp lệ.',
        400,
      );
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Dữ liệu yêu cầu phải là đối tượng JSON hợp lệ.',
        400,
      );
    }

    try {
      assertAllowedFields(body, [
        'credential',
        'consent',
        'ref',
        'utm',
        'landing',
      ]);
    } catch (err) {
      if (err instanceof AuthError) {
        throw new AuthError(
          'VALIDATION_ERROR',
          'Yêu cầu chứa trường dữ liệu không được phép.',
          400,
          err.details,
        );
      }
      throw err;
    }

    if (body['consent'] !== undefined && typeof body['consent'] !== 'boolean') {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Trường đồng ý (consent) phải là giá trị đúng/sai.',
        400,
        [{ field: 'consent', message: 'Phải là kiểu boolean' }],
      );
    }

    const rawUa = req.headers['user-agent'];
    const userAgent =
      typeof rawUa === 'string'
        ? rawUa
        : Array.isArray(rawUa)
          ? (rawUa[0] ?? null)
          : null;

    const result = await webCustomerService.loginWithGoogle({
      credential: body['credential'],
      consent: body['consent'],
      ref: body['ref'],
      utm: body['utm'],
      landing: body['landing'],
      clientIp,
      userAgent,
      requestId,
    });

    const cookieHeader = serializeCustomerCookie(
      result.sessionToken,
      isProduction,
    );
    const responseData: WebCustomerAuthResponseData = {
      customer: result.customer,
      csrf_token: result.csrfToken,
    };

    sendJson(
      res,
      200,
      createSuccessEnvelope(responseData, requestId),
      buildPublicHeaders(req.headers.origin, allowedOrigins, {
        'Set-Cookie': cookieHeader,
      }),
    );
    return true;
  }

  // 2. GET /api/v1/public/auth/me
  if (method === 'GET' && pathname === '/api/v1/public/auth/me') {
    const customerCtx = await requireCustomer(
      webCustomerService,
      req,
      isProduction,
    );
    const responseData: WebCustomerAuthResponseData = {
      customer: customerCtx.customer,
      csrf_token: generateCustomerCsrfToken(
        customerCtx.sessionTokenHash,
        csrfSecret,
      ),
    };
    sendJson(
      res,
      200,
      createSuccessEnvelope(responseData, requestId),
      baseHeaders,
    );
    return true;
  }

  // 3. POST /api/v1/public/auth/logout
  if (method === 'POST' && pathname === '/api/v1/public/auth/logout') {
    const customerCtx = await requireCustomer(
      webCustomerService,
      req,
      isProduction,
    );
    requireCustomerCsrf(req, customerCtx, csrfSecret, allowedOrigins);

    await webCustomerService.logout(customerCtx, requestId);
    const responseData: WebCustomerLogoutResponseData = { logged_out: true };
    sendJson(
      res,
      200,
      createSuccessEnvelope(responseData, requestId),
      buildPublicHeaders(req.headers.origin, allowedOrigins, {
        'Set-Cookie': serializeClearCustomerCookie(isProduction),
      }),
    );
    return true;
  }

  // 4. GET /api/v1/public/account/export
  if (method === 'GET' && pathname === '/api/v1/public/account/export') {
    const customerCtx = await requireCustomer(
      webCustomerService,
      req,
      isProduction,
    );
    const exportData = await webCustomerService.exportAccount(customerCtx);
    sendJson(
      res,
      200,
      createSuccessEnvelope(exportData, requestId),
      baseHeaders,
    );
    return true;
  }

  // 5. DELETE /api/v1/public/account
  if (method === 'DELETE' && pathname === '/api/v1/public/account') {
    const customerCtx = await requireCustomer(
      webCustomerService,
      req,
      isProduction,
    );
    requireCustomerCsrf(req, customerCtx, csrfSecret, allowedOrigins);

    const rl = webCustomerService.deleteAccountLimiter.increment(
      customerCtx.customer.id,
    );
    if (!rl.allowed) {
      sendJson(
        res,
        429,
        createErrorEnvelope(
          'RATE_LIMITED',
          'Bạn đã gửi yêu cầu xóa tài khoản quá nhiều lần. Vui lòng thử lại sau.',
          requestId,
        ),
        buildPublicHeaders(req.headers.origin, allowedOrigins, {
          'Retry-After': String(rl.retryAfterSeconds),
        }),
      );
      return true;
    }

    await webCustomerService.deleteAccount(customerCtx, requestId);
    const responseData: WebCustomerDeleteResponseData = { deleted: true };
    sendJson(
      res,
      200,
      createSuccessEnvelope(responseData, requestId),
      buildPublicHeaders(req.headers.origin, allowedOrigins, {
        'Set-Cookie': serializeClearCustomerCookie(isProduction),
      }),
    );
    return true;
  }

  return false;
}
