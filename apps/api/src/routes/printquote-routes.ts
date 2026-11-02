import {
  createSuccessEnvelope,
  createErrorEnvelope,
  sendJson,
} from '../envelope.js';
import { AuthError } from '../auth/service.js';
import { requireCsrf } from '../auth/guard.js';
import {
  calculatePrintQuote,
  buildCustomerSafePdfPayload,
  type QuoteCalculationInput,
} from '../../../../packages/contracts/src/printquote.js';
import type { RouteRequestContext } from './router.js';

export async function handlePrintQuoteRoutes(
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
    printQuoteService,
  } = ctx;

  if (
    pathname !== '/api/v1/print-quotes' &&
    !pathname.startsWith('/api/v1/print-quotes/')
  ) {
    return false;
  }

  if (!authService || !printQuoteService) {
    sendJson(
      res,
      503,
      createErrorEnvelope(
        'SERVICE_UNAVAILABLE',
        'PrintQuote service is unavailable',
        requestId,
      ),
    );
    return true;
  }

  const sessionContext = await requireAuth(authService, req, isProduction);
  if (sessionContext.workspace.role !== 'owner') {
    throw new AuthError(
      'FORBIDDEN',
      'Chỉ Chủ sở hữu (Owner) mới được phép truy cập phân hệ Báo giá in ấn.',
      403,
    );
  }

  const subPath = pathname.slice('/api/v1/print-quotes'.length);
  const idempotencyKey =
    typeof req.headers['idempotency-key'] === 'string'
      ? req.headers['idempotency-key']
      : undefined;

  // 1. GET /api/v1/print-quotes/stats
  if (subPath === '/stats' && method === 'GET') {
    const stats = await printQuoteService.getDashboardStats(sessionContext);
    sendJson(res, 200, createSuccessEnvelope(stats, requestId));
    return true;
  }

  // 2. POST /api/v1/print-quotes/calculate (Live calculation preview)
  if (subPath === '/calculate' && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<QuoteCalculationInput>(req);
    try {
      const calc = calculatePrintQuote(body);
      const customerPdf = buildCustomerSafePdfPayload(calc);
      sendJson(
        res,
        200,
        createSuccessEnvelope(
          { calculation: calc, customer_pdf: customerPdf },
          requestId,
        ),
      );
      return true;
    } catch (err) {
      throw new AuthError(
        'VALIDATION_ERROR',
        err instanceof Error ? err.message : 'Dữ liệu tính báo giá không hợp lệ.',
        400,
      );
    }
  }

  // 3. Vendors: /vendors & /vendors/:id
  if (subPath === '/vendors' && method === 'GET') {
    const vendors = await printQuoteService.listVendors(sessionContext);
    sendJson(res, 200, createSuccessEnvelope({ items: vendors }, requestId));
    return true;
  }
  if (subPath === '/vendors' && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const created = await printQuoteService.createVendor(
      sessionContext,
      body,
      idempotencyKey,
    );
    sendJson(res, 201, createSuccessEnvelope(created, requestId));
    return true;
  }
  const vendorMatch = subPath.match(/^\/vendors\/([a-zA-Z0-9_-]+)$/);
  if (vendorMatch && method === 'PATCH') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const updated = await printQuoteService.updateVendor(
      sessionContext,
      vendorMatch[1]!,
      body,
    );
    sendJson(res, 200, createSuccessEnvelope(updated, requestId));
    return true;
  }

  // 4. Vendor Price Catalog: /price-items & /price-items/:id
  if (subPath === '/price-items' && method === 'GET') {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const vendorId = parsedUrl.searchParams.get('vendor_id');
    const items = await printQuoteService.listPriceItems(
      sessionContext,
      vendorId,
    );
    sendJson(res, 200, createSuccessEnvelope({ items }, requestId));
    return true;
  }
  if (subPath === '/price-items' && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const created = await printQuoteService.createPriceItem(
      sessionContext,
      body,
      idempotencyKey,
    );
    sendJson(res, 201, createSuccessEnvelope(created, requestId));
    return true;
  }
  const priceItemMatch = subPath.match(/^\/price-items\/([a-zA-Z0-9_-]+)$/);
  if (priceItemMatch && method === 'PATCH') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const updated = await printQuoteService.updatePriceItem(
      sessionContext,
      priceItemMatch[1]!,
      body,
    );
    sendJson(res, 200, createSuccessEnvelope(updated, requestId));
    return true;
  }

  // 5. Customers: /customers & /customers/:id
  if (subPath === '/customers' && method === 'GET') {
    const items = await printQuoteService.listCustomers(sessionContext);
    sendJson(res, 200, createSuccessEnvelope({ items }, requestId));
    return true;
  }
  if (subPath === '/customers' && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const created = await printQuoteService.createCustomer(
      sessionContext,
      body,
      idempotencyKey,
    );
    sendJson(res, 201, createSuccessEnvelope(created, requestId));
    return true;
  }
  const customerMatch = subPath.match(/^\/customers\/([a-zA-Z0-9_-]+)$/);
  if (customerMatch && method === 'PATCH') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const updated = await printQuoteService.updateCustomer(
      sessionContext,
      customerMatch[1]!,
      body,
    );
    sendJson(res, 200, createSuccessEnvelope(updated, requestId));
    return true;
  }

  // 6. Quotes: /quotes, /quotes/:id, /quotes/:id/finalize, /quotes/:id/pdf
  if (subPath === '/quotes' && method === 'GET') {
    const items = await printQuoteService.listQuotes(sessionContext);
    sendJson(res, 200, createSuccessEnvelope({ items }, requestId));
    return true;
  }
  if (subPath === '/quotes' && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    try {
      const created = await printQuoteService.createQuote(
        sessionContext,
        body,
        idempotencyKey,
      );
      sendJson(res, 201, createSuccessEnvelope(created, requestId));
      return true;
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError(
        'VALIDATION_ERROR',
        err instanceof Error ? err.message : 'Lỗi tạo báo giá.',
        400,
      );
    }
  }
  const quoteMatch = subPath.match(
    /^\/quotes\/([a-zA-Z0-9_-]+)(?:\/(finalize|pdf))?$/,
  );
  if (quoteMatch) {
    const quoteId = quoteMatch[1]!;
    const subAction = quoteMatch[2];
    if (!subAction && method === 'GET') {
      const quote = await printQuoteService.getQuote(sessionContext, quoteId);
      sendJson(res, 200, createSuccessEnvelope(quote, requestId));
      return true;
    }
    if (!subAction && method === 'PATCH') {
      requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
      const body = await parseJsonBody<Record<string, unknown>>(req);
      try {
        const updated = await printQuoteService.updateQuote(
          sessionContext,
          quoteId,
          body,
        );
        sendJson(res, 200, createSuccessEnvelope(updated, requestId));
        return true;
      } catch (err) {
        if (err instanceof AuthError) throw err;
        throw new AuthError(
          'VALIDATION_ERROR',
          err instanceof Error ? err.message : 'Lỗi cập nhật báo giá.',
          400,
        );
      }
    }
    if (subAction === 'finalize' && method === 'POST') {
      requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
      const finalized = await printQuoteService.finalizeQuote(
        sessionContext,
        quoteId,
      );
      sendJson(res, 200, createSuccessEnvelope(finalized, requestId));
      return true;
    }
    if (subAction === 'pdf' && method === 'GET') {
      const safePdf = await printQuoteService.getCustomerSafePdf(
        sessionContext,
        quoteId,
      );
      sendJson(res, 200, createSuccessEnvelope(safePdf, requestId));
      return true;
    }
  }

  // 7. Orders: /orders, /orders/:id, /orders/:id/payments
  if (subPath === '/orders' && method === 'GET') {
    const items = await printQuoteService.listOrders(sessionContext);
    sendJson(res, 200, createSuccessEnvelope({ items }, requestId));
    return true;
  }
  if (subPath === '/orders' && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const created = await printQuoteService.createOrderFromQuote(
      sessionContext,
      body,
      idempotencyKey,
    );
    sendJson(res, 201, createSuccessEnvelope(created, requestId));
    return true;
  }
  const orderMatch = subPath.match(
    /^\/orders\/([a-zA-Z0-9_-]+)(?:\/(payments))?$/,
  );
  if (orderMatch) {
    const orderId = orderMatch[1]!;
    const subAction = orderMatch[2];
    if (!subAction && method === 'GET') {
      const order = await printQuoteService.getOrder(sessionContext, orderId);
      sendJson(res, 200, createSuccessEnvelope(order, requestId));
      return true;
    }
    if (!subAction && method === 'PATCH') {
      requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
      const body = await parseJsonBody<Record<string, unknown>>(req);
      const updated = await printQuoteService.updateOrder(
        sessionContext,
        orderId,
        body,
      );
      sendJson(res, 200, createSuccessEnvelope(updated, requestId));
      return true;
    }
    if (subAction === 'payments' && method === 'POST') {
      requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
      const body = await parseJsonBody<Record<string, unknown>>(req);
      const updated = await printQuoteService.recordOrderPayment(
        sessionContext,
        orderId,
        body,
        idempotencyKey,
      );
      sendJson(res, 201, createSuccessEnvelope(updated, requestId));
      return true;
    }
  }

  return false;
}
