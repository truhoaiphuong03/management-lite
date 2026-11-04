import { createSuccessEnvelope, sendJson } from '../envelope.js';
import type { AuthenticatedContext } from '../auth/service.js';
import { requireCsrf } from '../auth/guard.js';
import type { RouteRequestContext } from './router.js';
import type { PrintQuoteLedgerService } from '../printquote/ledger-service.js';

export async function handlePrintQuoteLedgerSubRoutes(params: {
  ctx: RouteRequestContext;
  sessionContext: AuthenticatedContext;
  ledger: PrintQuoteLedgerService;
  subPath: string;
  idempotencyKey?: string | undefined;
}): Promise<boolean> {
  const { ctx, sessionContext, ledger, subPath, idempotencyKey } = params;
  const {
    req,
    res,
    method,
    requestId,
    csrfSecret,
    allowedOrigins,
    parseJsonBody,
  } = ctx;

  const searchParams = new URL(req.url ?? '/', 'http://localhost').searchParams;

  // 1. Workshop Jobs
  if (subPath === '/workshop-jobs' && method === 'GET') {
    const items = await ledger.listWorkshopJobs(sessionContext, {
      order_id: searchParams.get('order_id') ?? undefined,
      vendor_id: searchParams.get('vendor_id') ?? undefined,
      ledger_scope: searchParams.get('ledger_scope') ?? undefined,
    });
    sendJson(res, 200, createSuccessEnvelope({ items }, requestId));
    return true;
  }

  const orderJobsInitMatch = subPath.match(
    /^\/orders\/([a-zA-Z0-9_-]+)\/workshop-jobs\/init$/,
  );
  if (orderJobsInitMatch && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const items = await ledger.initOrderWorkshopJobs(
      sessionContext,
      orderJobsInitMatch[1]!,
      body,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 201, createSuccessEnvelope({ items }, requestId));
    return true;
  }

  const orderJobsMatch = subPath.match(
    /^\/orders\/([a-zA-Z0-9_-]+)\/workshop-jobs$/,
  );
  if (orderJobsMatch && method === 'GET') {
    const items = await ledger.listWorkshopJobs(sessionContext, {
      order_id: orderJobsMatch[1]!,
    });
    sendJson(res, 200, createSuccessEnvelope({ items }, requestId));
    return true;
  }
  if (orderJobsMatch && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const item = await ledger.createWorkshopJob(
      sessionContext,
      orderJobsMatch[1]!,
      body,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 201, createSuccessEnvelope(item, requestId));
    return true;
  }

  const jobPatchMatch = subPath.match(/^\/workshop-jobs\/([a-zA-Z0-9_-]+)$/);
  if (jobPatchMatch && method === 'PATCH') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const updated = await ledger.updateWorkshopJob(
      sessionContext,
      jobPatchMatch[1]!,
      body,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 200, createSuccessEnvelope(updated, requestId));
    return true;
  }

  // 2. Order Cancellation Settlement & Legacy Vendor Payment Reconciliation
  const cancelSettleMatch = subPath.match(
    /^\/orders\/([a-zA-Z0-9_-]+)\/cancel-settlement$/,
  );
  if (cancelSettleMatch && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const settlement = await ledger.settleCancelledOrder(
      sessionContext,
      cancelSettleMatch[1]!,
      body,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 201, createSuccessEnvelope(settlement, requestId));
    return true;
  }

  const reconLegacyMatch = subPath.match(
    /^\/orders\/([a-zA-Z0-9_-]+)\/reconcile-legacy-vendor-note$/,
  );
  if (reconLegacyMatch && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const outcome = await ledger.reconcileLegacyVendorNote(
      sessionContext,
      reconLegacyMatch[1]!,
      body,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 200, createSuccessEnvelope(outcome, requestId));
    return true;
  }

  // 3. Opening Balances
  if (subPath === '/opening-balances' && method === 'GET') {
    const items = await ledger.listOpeningBalances(sessionContext, {
      direction: searchParams.get('direction') ?? undefined,
      ledger_scope: searchParams.get('ledger_scope') ?? undefined,
    });
    sendJson(res, 200, createSuccessEnvelope({ items }, requestId));
    return true;
  }
  if (subPath === '/opening-balances' && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const created = await ledger.createOpeningBalance(
      sessionContext,
      body,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 201, createSuccessEnvelope(created, requestId));
    return true;
  }

  // 4. Customer Receivables (AR)
  if (subPath === '/receivables' && method === 'GET') {
    const data = await ledger.listCustomerReceivables(sessionContext, {
      ledger_scope: searchParams.get('ledger_scope') ?? undefined,
    });
    sendJson(res, 200, createSuccessEnvelope(data, requestId));
    return true;
  }
  if (subPath === '/receivables/receipts' && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const tx = await ledger.createCustomerReceipt(
      sessionContext,
      body,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 201, createSuccessEnvelope(tx, requestId));
    return true;
  }
  const arAllocMatch = subPath.match(
    /^\/receivables\/receipts\/([a-zA-Z0-9_-]+)\/allocate$/,
  );
  if (arAllocMatch && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const tx = await ledger.allocateCustomerReceipt(
      sessionContext,
      arAllocMatch[1]!,
      body,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 200, createSuccessEnvelope(tx, requestId));
    return true;
  }
  if (subPath === '/receivables/refunds' && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const tx = await ledger.createCustomerRefund(
      sessionContext,
      body,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 201, createSuccessEnvelope(tx, requestId));
    return true;
  }
  if (subPath === '/receivables/adjustments' && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const adj = await ledger.createArAdjustment(
      sessionContext,
      body,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 201, createSuccessEnvelope(adj, requestId));
    return true;
  }
  const arVoidMatch = subPath.match(
    /^\/receivables\/transactions\/([a-zA-Z0-9_-]+)\/void$/,
  );
  if (arVoidMatch && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const rev = await ledger.voidArTransaction(
      sessionContext,
      arVoidMatch[1]!,
      body,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 200, createSuccessEnvelope(rev, requestId));
    return true;
  }

  // 5. Workshop Payables (AP)
  if (subPath === '/payables' && method === 'GET') {
    const data = await ledger.listVendorPayables(sessionContext, {
      ledger_scope: searchParams.get('ledger_scope') ?? undefined,
    });
    sendJson(res, 200, createSuccessEnvelope(data, requestId));
    return true;
  }
  if (subPath === '/payables/payouts' && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const tx = await ledger.createVendorPayout(
      sessionContext,
      body,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 201, createSuccessEnvelope(tx, requestId));
    return true;
  }
  const apAllocMatch = subPath.match(
    /^\/payables\/payouts\/([a-zA-Z0-9_-]+)\/allocate$/,
  );
  if (apAllocMatch && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const tx = await ledger.allocateVendorPayout(
      sessionContext,
      apAllocMatch[1]!,
      body,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 200, createSuccessEnvelope(tx, requestId));
    return true;
  }
  if (subPath === '/payables/refunds' && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const tx = await ledger.createVendorRefund(
      sessionContext,
      body,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 201, createSuccessEnvelope(tx, requestId));
    return true;
  }
  if (subPath === '/payables/adjustments' && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const adj = await ledger.createApAdjustment(
      sessionContext,
      body,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 201, createSuccessEnvelope(adj, requestId));
    return true;
  }
  const apVoidMatch = subPath.match(
    /^\/payables\/transactions\/([a-zA-Z0-9_-]+)\/void$/,
  );
  if (apVoidMatch && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const rev = await ledger.voidApTransaction(
      sessionContext,
      apVoidMatch[1]!,
      body,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 200, createSuccessEnvelope(rev, requestId));
    return true;
  }

  // 6. Unified Transactions & 3-Mode Financial Report
  if (subPath === '/transactions' && method === 'GET') {
    const items = await ledger.listUnifiedTransactions(sessionContext, {
      side: searchParams.get('side') ?? undefined,
      ledger_scope: searchParams.get('ledger_scope') ?? undefined,
      unallocated_only: searchParams.get('unallocated_only') === 'true',
      q: searchParams.get('q') ?? undefined,
    });
    sendJson(res, 200, createSuccessEnvelope({ items }, requestId));
    return true;
  }

  if (subPath === '/financial-report' && method === 'GET') {
    const report = await ledger.getFinancialReport(sessionContext, {
      ledger_scope: searchParams.get('ledger_scope') ?? undefined,
    });
    sendJson(res, 200, createSuccessEnvelope(report, requestId));
    return true;
  }

  // 7. Historical Google Sheet Preview & Confirmed Import
  if (subPath === '/import-history/batches' && method === 'GET') {
    const items = await ledger.listHistoricalImportBatches(sessionContext);
    sendJson(res, 200, createSuccessEnvelope({ items }, requestId));
    return true;
  }
  if (subPath === '/import-history/preview' && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const batch = await ledger.previewHistoricalImport(
      sessionContext,
      body,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 201, createSuccessEnvelope(batch, requestId));
    return true;
  }
  const importBatchGetMatch = subPath.match(
    /^\/import-history\/batches\/([a-zA-Z0-9_-]+)$/,
  );
  if (importBatchGetMatch && method === 'GET') {
    const batch = await ledger.getHistoricalImportBatch(
      sessionContext,
      importBatchGetMatch[1]!,
    );
    sendJson(res, 200, createSuccessEnvelope(batch, requestId));
    return true;
  }
  const importRowPatchMatch = subPath.match(
    /^\/import-history\/batches\/([a-zA-Z0-9_-]+)\/rows\/([a-zA-Z0-9_-]+)$/,
  );
  if (importRowPatchMatch && method === 'PATCH') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const row = await ledger.updateHistoricalImportRow(
      sessionContext,
      importRowPatchMatch[1]!,
      importRowPatchMatch[2]!,
      body,
    );
    sendJson(res, 200, createSuccessEnvelope(row, requestId));
    return true;
  }
  const importConfirmMatch = subPath.match(
    /^\/import-history\/batches\/([a-zA-Z0-9_-]+)\/confirm$/,
  );
  if (importConfirmMatch && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    const batch = await ledger.confirmHistoricalImportBatch(
      sessionContext,
      importConfirmMatch[1]!,
      body,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 200, createSuccessEnvelope(batch, requestId));
    return true;
  }

  return false;
}
