import {
  createSuccessEnvelope,
  createErrorEnvelope,
  sendJson,
} from '../envelope.js';
import { requireCsrf } from '../auth/guard.js';
import type {
  CreateScheduleRequest,
  UpdateScheduleRequest,
} from '../../../../packages/contracts/src/schedules.js';
import type { RouteRequestContext } from './router.js';

const SCHEDULE_DETAIL_RE = /^\/api\/v1\/schedules\/([a-zA-Z0-9_-]+)$/;

export async function handleSchedulesRoutes(
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
    schedulesService,
  } = ctx;

  // 23.1 GET /api/v1/schedules/me: Staff view own schedule for week
  if (method === 'GET' && pathname === '/api/v1/schedules/me') {
    if (!authService || !schedulesService) {
      sendJson(
        res,
        503,
        createErrorEnvelope(
          'DATABASE_UNAVAILABLE',
          'Service unavailable',
          requestId,
        ),
      );
      return true;
    }

    const sessionContext = await requireAuth(authService, req, isProduction);
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const weekStartDate =
      parsedUrl.searchParams.get('week_start_date') || undefined;

    const result = await schedulesService.getStaffSchedule(
      sessionContext,
      weekStartDate,
    );
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 23.2 POST /api/v1/schedules: Staff register schedule
  if (method === 'POST' && pathname === '/api/v1/schedules') {
    if (!authService || !schedulesService) {
      sendJson(
        res,
        503,
        createErrorEnvelope(
          'DATABASE_UNAVAILABLE',
          'Service unavailable',
          requestId,
        ),
      );
      return true;
    }

    const sessionContext = await requireAuth(authService, req, isProduction);
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);

    const body = await parseJsonBody<Record<string, unknown>>(req);
    assertAllowedFields(body, ['week_start_date', 'entries']);

    const result = await schedulesService.createStaffSchedule(
      sessionContext,
      body as unknown as CreateScheduleRequest,
      requestId,
    );
    sendJson(res, 201, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 23.3 GET /api/v1/schedules: Owner view staff schedules by week
  if (method === 'GET' && pathname === '/api/v1/schedules') {
    if (!authService || !schedulesService) {
      sendJson(
        res,
        503,
        createErrorEnvelope(
          'DATABASE_UNAVAILABLE',
          'Service unavailable',
          requestId,
        ),
      );
      return true;
    }

    const sessionContext = await requireAuth(authService, req, isProduction);
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const weekStartDate =
      parsedUrl.searchParams.get('week_start_date') || undefined;
    const employeeId = parsedUrl.searchParams.get('employee_id') || undefined;

    const result = await schedulesService.listSchedulesForOwner(
      sessionContext,
      weekStartDate,
      employeeId,
    );
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 23.4 Dynamic /api/v1/schedules/:id (GET detail, PUT update & revise)
  const scheduleDetailMatch = pathname.match(SCHEDULE_DETAIL_RE);
  if (scheduleDetailMatch) {
    if (!authService || !schedulesService) {
      sendJson(
        res,
        503,
        createErrorEnvelope(
          'DATABASE_UNAVAILABLE',
          'Service unavailable',
          requestId,
        ),
      );
      return true;
    }

    const scheduleId = scheduleDetailMatch[1]!;

    if (method === 'GET') {
      const sessionContext = await requireAuth(authService, req, isProduction);
      const result = await schedulesService.getScheduleDetail(
        sessionContext,
        scheduleId,
      );
      sendJson(res, 200, createSuccessEnvelope(result, requestId));
      return true;
    }

    if (method === 'PUT') {
      const sessionContext = await requireAuth(authService, req, isProduction);
      requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);

      const body = await parseJsonBody<Record<string, unknown>>(req);
      assertAllowedFields(body, ['entries', 'reason']);

      const ifMatch = req.headers['if-match'];
      const result = await schedulesService.updateStaffSchedule(
        sessionContext,
        scheduleId,
        ifMatch,
        body as unknown as UpdateScheduleRequest,
        requestId,
      );
      sendJson(res, 200, createSuccessEnvelope(result, requestId));
      return true;
    }
  }

  return false;
}
