import {
  createSuccessEnvelope,
  createErrorEnvelope,
  sendJson,
} from '../envelope.js';
import { requireCsrf } from '../auth/guard.js';
import type {
  CreateIssueRequest,
  CreateReportRequest,
  UpdateIssueRequest,
  ConfirmFixRequest,
  ReopenIssueRequest,
  VerifyIssueRequest,
  ListIssuesQuery,
  IssueStatus,
  IssueType,
} from '../../../../packages/contracts/src/issues.js';
import type { RouteRequestContext } from './router.js';

const ISSUES_ROUTE_RE =
  /^\/api\/v1\/issues(?:\/([a-zA-Z0-9_-]+)(?:\/(confirm-fix|reopen|analyze|verify))?)?$/;

export async function handleAuditAndIssuesRoutes(
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
    authService,
    auditService,
    issuesService,
  } = ctx;

  // AUDIT MODULE ROUTES (Owner only, UI19, Data Dictionary doc 03/20)
  if (
    (pathname === '/api/v1/audit' || pathname === '/api/v1/audit-events') &&
    method === 'GET'
  ) {
    if (!authService || !auditService) {
      const body = createErrorEnvelope(
        'DATABASE_UNAVAILABLE',
        'Audit service is unavailable',
        requestId,
      );
      sendJson(res, 503, body);
      return true;
    }

    const sessionContext = await requireAuth(authService, req, isProduction);

    if (sessionContext.workspace.role !== 'owner') {
      const body = createErrorEnvelope(
        'FORBIDDEN',
        'Truy cập bị từ chối: Nhật ký kiểm toán chỉ dành cho Chủ sở hữu (Owner).',
        requestId,
      );
      sendJson(res, 403, body);
      return true;
    }

    const urlObj = new URL(req.url ?? '/', 'http://127.0.0.1');
    const limitParam = urlObj.searchParams.get('limit');
    const cursor = urlObj.searchParams.get('cursor') ?? undefined;
    const action = urlObj.searchParams.get('action') ?? undefined;
    const entityType = urlObj.searchParams.get('entity_type') ?? undefined;

    const result = await auditService.listEvents(sessionContext, {
      limit: limitParam ? Number(limitParam) : undefined,
      cursor,
      action,
      entity_type: entityType,
    });

    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // UI-REPORT-01 ROUTER: /api/v1/reports (Global Bug Report submission)
  if (pathname === '/api/v1/reports') {
    if (!authService || !issuesService) {
      const body = createErrorEnvelope(
        'DATABASE_UNAVAILABLE',
        'Issues service is unavailable',
        requestId,
      );
      sendJson(res, 503, body);
      return true;
    }

    const sessionContext = await requireAuth(authService, req, isProduction);

    if (method === 'POST') {
      requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
      const rawBody = await parseJsonBody<Record<string, unknown>>(req);
      const idempotencyKey =
        typeof req.headers['idempotency-key'] === 'string'
          ? req.headers['idempotency-key']
          : undefined;

      const result = await issuesService.createReport(
        sessionContext,
        rawBody as unknown as CreateReportRequest,
        requestId,
        idempotencyKey,
      );

      sendJson(res, 201, createSuccessEnvelope(result, requestId));
      return true;
    }

    const body = createErrorEnvelope(
      'METHOD_NOT_ALLOWED',
      `Method ${method} not allowed on /api/v1/reports`,
      requestId,
    );
    sendJson(res, 405, body);
    return true;
  }

  // ISSUES LITE V0.1 ROUTER: /api/v1/issues
  const issuesRouteMatch = pathname.match(ISSUES_ROUTE_RE);
  if (!issuesRouteMatch) return false;

  if (!authService || !issuesService) {
    const body = createErrorEnvelope(
      'DATABASE_UNAVAILABLE',
      'Issues service is unavailable',
      requestId,
    );
    sendJson(res, 503, body);
    return true;
  }

  const sessionContext = await requireAuth(authService, req, isProduction);

  if (sessionContext.workspace.role !== 'owner') {
    const body = createErrorEnvelope(
      'FORBIDDEN',
      'Truy cập bị từ chối: Quản lý Báo lỗi & Góp ý (Issues) chỉ dành cho Chủ sở hữu (Owner).',
      requestId,
    );
    sendJson(res, 403, body);
    return true;
  }

  const issueId = issuesRouteMatch[1];
  const subAction = issuesRouteMatch[2];

  // 1. POST /api/v1/issues - Create Issue
  if (!issueId && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const rawBody = await parseJsonBody<Record<string, unknown>>(req);
    const idempotencyKey =
      typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : undefined;

    const result = await issuesService.createIssue(
      sessionContext,
      rawBody as unknown as CreateIssueRequest,
      requestId,
      idempotencyKey,
    );

    res.setHeader('ETag', `"${result.version}"`);
    sendJson(res, 201, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 2. GET /api/v1/issues - List Issues
  if (!issueId && method === 'GET') {
    const urlObj = new URL(req.url ?? '/', 'http://127.0.0.1');
    const limitParam = urlObj.searchParams.get('limit');
    const cursor = urlObj.searchParams.get('cursor') ?? undefined;
    const status = urlObj.searchParams.get('status') ?? undefined;
    const type = urlObj.searchParams.get('type') ?? undefined;

    const query: ListIssuesQuery = {};
    if (limitParam) query.limit = Number(limitParam);
    if (cursor) query.cursor = cursor;
    if (status) query.status = status as IssueStatus;
    if (type) query.type = type as IssueType;

    const result = await issuesService.listIssues(sessionContext, query);
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 3. GET /api/v1/issues/:id
  if (issueId && !subAction && method === 'GET') {
    const result = await issuesService.getIssueDetail(sessionContext, issueId);
    res.setHeader('ETag', `"${result.issue.version}"`);
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 4. PATCH /api/v1/issues/:id
  if (issueId && !subAction && method === 'PATCH') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const rawBody = await parseJsonBody<Record<string, unknown>>(req);
    const ifMatch =
      typeof req.headers['if-match'] === 'string'
        ? req.headers['if-match']
        : undefined;
    const idempotencyKey =
      typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : undefined;

    const result = await issuesService.updateIssue(
      sessionContext,
      issueId,
      rawBody as unknown as UpdateIssueRequest,
      ifMatch,
      requestId,
      idempotencyKey,
    );

    res.setHeader('ETag', `"${result.version}"`);
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 5. POST /api/v1/issues/:id/confirm-fix
  if (issueId && subAction === 'confirm-fix' && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const rawBody = await parseJsonBody<Record<string, unknown>>(req);
    const ifMatch =
      typeof req.headers['if-match'] === 'string'
        ? req.headers['if-match']
        : undefined;
    const idempotencyKey =
      typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : undefined;

    const result = await issuesService.confirmFix(
      sessionContext,
      issueId,
      rawBody as unknown as ConfirmFixRequest,
      ifMatch,
      requestId,
      idempotencyKey,
    );

    res.setHeader('ETag', `"${result.version}"`);
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 6. POST /api/v1/issues/:id/reopen
  if (issueId && subAction === 'reopen' && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const rawBody = await parseJsonBody<Record<string, unknown>>(req);
    const ifMatch =
      typeof req.headers['if-match'] === 'string'
        ? req.headers['if-match']
        : undefined;
    const idempotencyKey =
      typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : undefined;

    const result = await issuesService.reopenIssue(
      sessionContext,
      issueId,
      rawBody as unknown as ReopenIssueRequest,
      ifMatch,
      requestId,
      idempotencyKey,
    );

    res.setHeader('ETag', `"${result.version}"`);
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 7. POST /api/v1/issues/:id/analyze
  if (issueId && subAction === 'analyze' && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const result = await issuesService.analyzeIssue(
      sessionContext,
      issueId,
      requestId,
    );

    res.setHeader('ETag', `"${result.issue.version}"`);
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 8. POST /api/v1/issues/:id/verify
  if (issueId && subAction === 'verify' && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const rawBody = await parseJsonBody<Record<string, unknown>>(req);
    const result = await issuesService.verifyIssueFix(
      sessionContext,
      issueId,
      rawBody as unknown as VerifyIssueRequest,
      requestId,
    );

    res.setHeader('ETag', `"${result.version}"`);
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  const body = createErrorEnvelope(
    'NOT_FOUND',
    `Endpoint ${method} ${pathname} not found`,
    requestId,
  );
  sendJson(res, 404, body);
  return true;
}
