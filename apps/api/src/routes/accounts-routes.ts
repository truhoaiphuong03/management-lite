import {
  createSuccessEnvelope,
  createErrorEnvelope,
  sendJson,
} from '../envelope.js';
import { AuthError } from '../auth/service.js';
import { requireCsrf } from '../auth/guard.js';
import type {
  CreateAccountRequest,
  UpdateAccountRequest,
  ArchiveAccountRequest,
  PutAccountSecretRequest,
  RevealAccountSecretRequest,
} from '../../../../packages/contracts/src/accounts.js';
import type { RouteRequestContext } from './router.js';

const ACCOUNTS_ROUTE_RE =
  /^\/api\/v1\/accounts(?:\/([a-zA-Z0-9_-]+)(?:\/(archive|restore|secrets)(?:\/(reveal))?)?)?$/;

export async function handleAccountsRoutes(
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
    requireAuth,
    parseJsonBody,
    assertAllowedFields,
    authService,
    accountsService,
  } = ctx;

  const accRouteMatch = pathname.match(ACCOUNTS_ROUTE_RE);
  if (!accRouteMatch) return false;

  if (!authService || !accountsService) {
    const body = createErrorEnvelope(
      'SERVICE_UNAVAILABLE',
      'Accounts service is unavailable',
      requestId,
    );
    sendJson(res, 503, body);
    return true;
  }

  const sessionContext = await requireAuth(authService, req, isProduction);
  const [, accountId, subResource, subSub] = accRouteMatch;

  // 1. GET /api/v1/accounts
  if (!accountId && !subResource && method === 'GET') {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const result = await accountsService.listAccounts(
      sessionContext,
      parsedUrl.searchParams,
    );
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 2. POST /api/v1/accounts
  if (!accountId && !subResource && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    assertAllowedFields(body, [
      'platform',
      'username',
      'platform_account_id',
      'recovery_email',
      'account_group',
      'assigned_employee_id',
      'status',
      'health_status',
      'phone_number',
      'phone_note',
      'parent_account_id',
      'recovery_account_id',
      'authenticator_account_id',
      'create_child_platforms',
      'notes',
      'initial_secrets',
    ]);
    const idempotencyKey =
      typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : undefined;
    const result = await accountsService.createAccount(
      sessionContext,
      body as unknown as CreateAccountRequest,
      requestId,
      idempotencyKey,
    );
    sendJson(res, 201, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 3. GET /api/v1/accounts/:id
  if (accountId && !subResource && method === 'GET') {
    const result = await accountsService.getAccount(sessionContext, accountId);
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 4. PATCH /api/v1/accounts/:id
  if (accountId && !subResource && method === 'PATCH') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    assertAllowedFields(body, [
      'username',
      'platform_account_id',
      'recovery_email',
      'account_group',
      'assigned_employee_id',
      'status',
      'health_status',
      'phone_number',
      'phone_note',
      'parent_account_id',
      'recovery_account_id',
      'authenticator_account_id',
      'notes',
    ]);
    const ifMatch =
      typeof req.headers['if-match'] === 'string'
        ? req.headers['if-match']
        : undefined;
    const result = await accountsService.updateAccount(
      sessionContext,
      accountId,
      body as unknown as UpdateAccountRequest,
      ifMatch,
      requestId,
    );
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 5. POST /api/v1/accounts/:id/archive
  if (
    accountId &&
    subResource === 'archive' &&
    !subSub &&
    method === 'POST'
  ) {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    assertAllowedFields(body, ['reason']);
    const ifMatch =
      typeof req.headers['if-match'] === 'string'
        ? req.headers['if-match']
        : undefined;
    const result = await accountsService.archiveAccount(
      sessionContext,
      accountId,
      body as unknown as ArchiveAccountRequest,
      ifMatch,
      requestId,
    );
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 6. POST /api/v1/accounts/:id/restore
  if (
    accountId &&
    subResource === 'restore' &&
    !subSub &&
    method === 'POST'
  ) {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    assertAllowedFields(body, []);
    const ifMatch =
      typeof req.headers['if-match'] === 'string'
        ? req.headers['if-match']
        : undefined;
    const result = await accountsService.restoreAccount(
      sessionContext,
      accountId,
      ifMatch,
      requestId,
    );
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 7. PUT /api/v1/accounts/:id/secrets
  if (
    accountId &&
    subResource === 'secrets' &&
    !subSub &&
    method === 'PUT'
  ) {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    assertAllowedFields(body, [
      'secret_type',
      'secret_value',
      'reauth_proof',
    ]);
    const ifMatch =
      typeof req.headers['if-match'] === 'string'
        ? req.headers['if-match']
        : undefined;
    const result = await accountsService.putAccountSecret(
      sessionContext,
      accountId,
      body as unknown as PutAccountSecretRequest,
      ifMatch,
      requestId,
    );
    sendJson(res, 200, createSuccessEnvelope(result, requestId), {
      'Cache-Control': 'no-store',
    });
    return true;
  }

  // 8. POST /api/v1/accounts/:id/secrets/reveal
  if (
    accountId &&
    subResource === 'secrets' &&
    subSub === 'reveal' &&
    method === 'POST'
  ) {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    assertAllowedFields(body, ['secret_type', 'reauth_proof', 'history_id']);
    const result = await accountsService.revealAccountSecret(
      sessionContext,
      accountId,
      body as unknown as RevealAccountSecretRequest,
      requestId,
    );
    sendJson(res, 200, createSuccessEnvelope(result, requestId), {
      'Cache-Control': 'no-store',
    });
    return true;
  }

  throw new AuthError(
    'NOT_FOUND',
    `Endpoint ${method} ${pathname} not found`,
    404,
  );
}
