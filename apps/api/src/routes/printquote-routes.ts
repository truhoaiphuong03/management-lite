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
  assertCustomerSafePdfPayload,
  type CustomerSafePdfPayload,
  type QuoteCalculationInput,
} from '../../../../packages/contracts/src/printquote.js';
import {
  PdfRendererUnavailableError,
  renderCustomerSafeA4PdfBuffer,
  sanitizePdfFilename,
  type ServerA4PdfMeta,
} from '../printquote/pdf-renderer.js';
import type { RouteRequestContext } from './router.js';
import { handlePrintQuoteLedgerSubRoutes } from './printquote-ledger-routes.js';

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
      const calc = calculatePrintQuote({
        ...body,
        requireAreaAdjustmentReason: body?.requireAreaAdjustmentReason ?? true,
      });
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
        err instanceof Error
          ? err.message
          : 'Dữ liệu tính báo giá không hợp lệ.',
        400,
      );
    }
  }

  // 2B. POST /api/v1/print-quotes/pdf-file (Direct binary A4 .pdf download for live/draft quote)
  if (subPath === '/pdf-file' && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<{
      customer_pdf: CustomerSafePdfPayload | null;
      pricing_status?: string;
      meta?: ServerA4PdfMeta;
    }>(req);
    if (body?.pricing_status === 'PENDING_COST') {
      throw new AuthError(
        'QUOTE_PENDING_VENDOR_COST',
        'Báo giá đang ở trạng thái Chờ giá xưởng nên chưa thể xuất file PDF A4.',
        409,
      );
    }
    if (
      !body?.customer_pdf ||
      !Array.isArray(body.customer_pdf.lines) ||
      body.customer_pdf.lines.length === 0
    ) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Thiếu dữ liệu customer_pdf hoàn chỉnh để xuất file PDF A4.',
        400,
      );
    }
    assertCustomerSafePdfPayload(body.customer_pdf);
    const quoteCode =
      body.meta?.quoteCode || body.customer_pdf.quoteCode || 'BG-DRAFT';
    let pdfBuf: Buffer;
    try {
      pdfBuf = await renderCustomerSafeA4PdfBuffer(body.customer_pdf, {
        ...body.meta,
        workspaceName:
          body.meta?.workspaceName || sessionContext.workspace.name,
        quoteCode,
      });
    } catch (err) {
      if (err instanceof PdfRendererUnavailableError) {
        throw new AuthError('SERVICE_UNAVAILABLE', err.message, 503);
      }
      throw err;
    }
    const filename = sanitizePdfFilename(quoteCode);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdfBuf.length),
      'Cache-Control': 'no-store',
    });
    res.end(pdfBuf);
    return true;
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

  // 4. Workshop & Vendor Price Catalog: /price-items, /price-items/:id, /deactivate, /restore, /history
  if (subPath === '/price-items' && method === 'GET') {
    const parsedUrl = new URL(req.url || '/', 'http://localhost');
    const vendorId = parsedUrl.searchParams.get('vendor_id');
    const itemType = parsedUrl.searchParams.get('item_type');
    const includeInactiveParam = parsedUrl.searchParams.get('include_inactive');
    const items = await printQuoteService.listPriceItems(sessionContext, {
      vendorId,
      itemType,
      includeInactive: includeInactiveParam === 'false' ? false : true,
    });
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
  const priceItemMatch = subPath.match(
    /^\/price-items\/([a-zA-Z0-9_-]+)(?:\/(deactivate|restore|history))?$/,
  );
  if (priceItemMatch) {
    const priceItemId = priceItemMatch[1]!;
    const subAction = priceItemMatch[2];
    if (!subAction && method === 'PATCH') {
      requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
      const body = await parseJsonBody<Record<string, unknown>>(req);
      const updated = await printQuoteService.updatePriceItem(
        sessionContext,
        priceItemId,
        body,
      );
      sendJson(res, 200, createSuccessEnvelope(updated, requestId));
      return true;
    }
    if (!subAction && method === 'DELETE') {
      requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
      const deleted = await printQuoteService.deletePriceItem(
        sessionContext,
        priceItemId,
      );
      sendJson(res, 200, createSuccessEnvelope(deleted, requestId));
      return true;
    }
    if (subAction === 'deactivate' && method === 'POST') {
      requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
      let changeNote: string | null = null;
      try {
        const body = await parseJsonBody<Record<string, unknown>>(req);
        if (typeof body?.['change_note'] === 'string') {
          changeNote = body['change_note'];
        }
      } catch {
        // Optional body on deactivate
      }
      const updated = await printQuoteService.deactivatePriceItem(
        sessionContext,
        priceItemId,
        changeNote,
      );
      sendJson(res, 200, createSuccessEnvelope(updated, requestId));
      return true;
    }
    if (subAction === 'restore' && method === 'POST') {
      requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
      let changeNote: string | null = null;
      try {
        const body = await parseJsonBody<Record<string, unknown>>(req);
        if (typeof body?.['change_note'] === 'string') {
          changeNote = body['change_note'];
        }
      } catch {
        // Optional body on restore
      }
      const updated = await printQuoteService.restorePriceItem(
        sessionContext,
        priceItemId,
        changeNote,
      );
      sendJson(res, 200, createSuccessEnvelope(updated, requestId));
      return true;
    }
    if (subAction === 'history' && method === 'GET') {
      const items = await printQuoteService.listPriceItemHistory(
        sessionContext,
        priceItemId,
      );
      sendJson(res, 200, createSuccessEnvelope({ items }, requestId));
      return true;
    }
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
    /^\/quotes\/([a-zA-Z0-9_-]+)(?:\/(finalize|pdf|pdf-file))?$/,
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
    if (!subAction && method === 'DELETE') {
      requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
      const deleted = await printQuoteService.deleteQuote(
        sessionContext,
        quoteId,
      );
      sendJson(res, 200, createSuccessEnvelope(deleted, requestId));
      return true;
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
    if (subAction === 'pdf-file' && method === 'GET') {
      const quote = await printQuoteService.getQuote(sessionContext, quoteId);
      if (quote.pricing_status === 'PENDING_COST' || !quote.customer_pdf_json) {
        throw new AuthError(
          'QUOTE_PENDING_VENDOR_COST',
          'Báo giá đang ở trạng thái Chờ giá xưởng nên chưa thể tải file PDF báo khách. Vui lòng nhập đầy đủ giá xưởng trước.',
          409,
        );
      }
      const safePdf = quote.customer_pdf_json;
      assertCustomerSafePdfPayload(safePdf);
      let pdfBuf: Buffer;
      try {
        pdfBuf = await renderCustomerSafeA4PdfBuffer(safePdf, {
          workspaceName: sessionContext.workspace.name,
          quoteCode: quote.quote_code,
          quoteTitle: quote.title,
          versionNo: quote.current_version,
          createdAt: quote.created_at,
          validUntil: quote.valid_until,
          customerName: quote.customer_name,
          customerPhone: quote.customer_phone,
          customerAddress: quote.customer_address,
          customerNotes: quote.notes,
        });
      } catch (err) {
        if (err instanceof PdfRendererUnavailableError) {
          throw new AuthError('SERVICE_UNAVAILABLE', err.message, 503);
        }
        throw err;
      }
      const filename = sanitizePdfFilename(quote.quote_code);
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(pdfBuf.length),
        'Cache-Control': 'no-store',
      });
      res.end(pdfBuf);
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

  return handlePrintQuoteLedgerSubRoutes({
    ctx,
    sessionContext,
    ledger: printQuoteService.ledger,
    subPath,
    idempotencyKey,
  });
}
