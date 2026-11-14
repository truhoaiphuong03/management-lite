import crypto from 'node:crypto';
import type pg from 'pg';
import { recordAuditEvent } from '../../../../packages/database/src/audit.js';
import {
  PrintProductionStatus,
  LedgerScope,
  WorkshopJobStatus,
  WorkshopJobCostStatus,
  WorkshopJobHistoryAction,
  ArTransactionKind,
  ArReceiptSubtype,
  ArAdjustmentType,
  ApTransactionKind,
  ApPayoutSubtype,
  ApAdjustmentType,
  LedgerTxStatus,
  CancellationSettlementStatus,
  OpeningBalanceDirection,
  assertSafePositiveVnd,
  assertSafeNonNegativeVnd,
  assertTransactionConservationInvariant,
  normalizeLedgerScopeInput,
  evaluateLegacyPaymentReconciliationAnomalies,
  LegacyArHistoryAction,
  LegacyArReconciliationStatus,
  type PersistedQuoteLineSnapshot,
  type WorkshopJobLineRef,
  type WorkshopJobStatusType,
  type WorkshopJobCostStatusType,
  type WorkshopJobHistoryActionType,
  type PrintWorkshopJobData,
  type PrintOpeningBalanceData,
  type PrintArTransactionData,
  type PrintArAdjustmentData,
  type PrintApTransactionData,
  type PrintApAdjustmentData,
  type PrintOrderCancellationSettlementData,
  type ArReceiptSubtypeType,
  type ApPayoutSubtypeType,
  type ArAdjustmentTypeVal,
  type ApAdjustmentTypeVal,
} from '../../../../packages/contracts/src/printquote.js';
import { AuthError, type AuthenticatedContext } from '../auth/service.js';
import {
  toInt,
  toDateStr,
  allocateNextLedgerCode,
  recomputeOrderReceivableState,
  recomputeOpeningBalanceState,
  recomputeWorkshopJobState,
  syncOrderFromWorkshopJobs,
  mapWorkshopJobRow,
  mapWorkshopJobHistoryRow,
  mapArTransactionRow,
  mapArAllocationRow,
  mapArAdjustmentRow,
  mapApTransactionRow,
  mapApAllocationRow,
  mapApAdjustmentRow,
  mapCancellationSettlementRow,
  isValidUuid,
  resolveMandatoryWorkspaceCustomerInTx,
} from './ledger-helpers.js';

function normalizePaymentMethod(
  raw: unknown,
): 'BANK_TRANSFER' | 'CASH' | 'QR_VIETQR' | 'OTHER' {
  if (raw === 'CASH' || raw === 'QR_VIETQR' || raw === 'OTHER') return raw;
  return 'BANK_TRANSFER';
}

export interface SyncPrintLedgerToFinanceInput {
  workspaceId: string;
  fallbackOwnerUserId: string;
  direction: 'income' | 'expense';
  categoryName: string;
  amountVnd: number;
  occurredAt?: Date | string | null | undefined;
  operationKey: string;
  note: string;
}

/**
 * Automatically mirrors PrintQuote AR/AP cash receipts, workshop payouts, and void
 * reversals into the master `/finance` ledger (`fin_entries`) using `SAVEPOINT` +
 * idempotent `operation_key` (`ON CONFLICT DO NOTHING`) so cashflow is unified
 * without risking duplicate rows or breaking PrintQuote ledger transactions.
 */
export async function syncPrintLedgerToFinanceTx(
  client: Pick<pg.PoolClient, 'query'>,
  input: SyncPrintLedgerToFinanceInput,
): Promise<void> {
  const amount = Math.round(Number(input.amountVnd) || 0);
  if (amount <= 0) return;

  await client.query('SAVEPOINT sp_pq_fin_sync');
  try {
    const ownerRes = await client.query<{ user_id: string }>(
      `SELECT user_id
       FROM workspace_memberships
       WHERE workspace_id = $1 AND role = 'owner' AND status = 'active'
       ORDER BY created_at ASC
       LIMIT 1`,
      [input.workspaceId],
    );
    const ownerUserId = ownerRes.rows[0]?.user_id || input.fallbackOwnerUserId;

    const cleanCategoryName = input.categoryName.trim().slice(0, 100);
    let catRes = await client.query<{ id: string; name: string }>(
      `SELECT id, name
       FROM fin_categories
       WHERE workspace_id = $1
         AND owner_user_id = $2
         AND direction = $3
         AND normalized_name = lower(btrim($4))
         AND is_active = true
       LIMIT 1`,
      [input.workspaceId, ownerUserId, input.direction, cleanCategoryName],
    );
    if (!catRes.rows[0]) {
      catRes = await client.query<{ id: string; name: string }>(
        `INSERT INTO fin_categories (workspace_id, owner_user_id, direction, name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id, owner_user_id, direction, normalized_name) WHERE is_active
         DO NOTHING
         RETURNING id, name`,
        [input.workspaceId, ownerUserId, input.direction, cleanCategoryName],
      );
      if (!catRes.rows[0]) {
        catRes = await client.query<{ id: string; name: string }>(
          `SELECT id, name
           FROM fin_categories
           WHERE workspace_id = $1
             AND owner_user_id = $2
             AND direction = $3
             AND normalized_name = lower(btrim($4))
             AND is_active = true
           LIMIT 1`,
          [input.workspaceId, ownerUserId, input.direction, cleanCategoryName],
        );
      }
    }
    const cat = catRes.rows[0];
    if (cat) {
      const d =
        input.occurredAt instanceof Date
          ? input.occurredAt
          : input.occurredAt
            ? new Date(input.occurredAt)
            : new Date();
      const safeDate = Number.isNaN(d.getTime()) ? new Date() : d;
      const vnOffsetMs = 7 * 60 * 60 * 1000;
      const dayStr = new Date(safeDate.getTime() + vnOffsetMs)
        .toISOString()
        .slice(0, 10);
      const entryId = crypto.randomUUID();
      const fp = crypto
        .createHash('sha256')
        .update(`${input.operationKey}:${amount}:${dayStr}`)
        .digest('hex');

      await client.query(
        `INSERT INTO fin_entries (
          id, root_entry_id, workspace_id, owner_user_id, revision_number,
          direction, category_id, category_name_snapshot, amount_vnd,
          occurred_on, note, operation_key, request_fingerprint
        ) VALUES ($1, $1, $2, $3, 1, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (workspace_id, owner_user_id, operation_key) DO NOTHING`,
        [
          entryId,
          input.workspaceId,
          ownerUserId,
          input.direction,
          cat.id,
          cat.name,
          amount,
          dayStr,
          input.note.slice(0, 2000),
          input.operationKey,
          fp,
        ],
      );
    }
    await client.query('RELEASE SAVEPOINT sp_pq_fin_sync');
  } catch {
    await client
      .query('ROLLBACK TO SAVEPOINT sp_pq_fin_sync')
      .catch(() => undefined);
  }
}

function requireNonEmptyReason(raw: unknown, fieldLabel = 'Lý do'): string {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (!reason) {
    throw new AuthError(
      'REASON_REQUIRED',
      `${fieldLabel} là bắt buộc để lưu vết kiểm toán tài chính.`,
      400,
    );
  }
  return reason;
}

async function checkDuplicateReferenceCode(
  client: pg.PoolClient,
  params: {
    workspaceId: string;
    table: 'print_ar_transactions' | 'print_ap_transactions';
    referenceCode: string | null;
    confirmDuplicate: boolean;
  },
): Promise<void> {
  if (!params.referenceCode || params.confirmDuplicate) return;
  const dupRes = await client.query<{ tx_code: string }>(
    `SELECT tx_code
     FROM ${params.table}
     WHERE workspace_id = $1
       AND status = 'POSTED'
       AND reference_code IS NOT NULL
       AND lower(btrim(reference_code)) = lower(btrim($2))
     LIMIT 1`,
    [params.workspaceId, params.referenceCode],
  );
  if (dupRes.rows[0]) {
    throw new AuthError(
      'DUPLICATE_REFERENCE_CODE',
      `Mã tham chiếu/chứng từ "${params.referenceCode}" trùng với phiếu ${dupRes.rows[0].tx_code}. Vui lòng kiểm tra chống nhập trùng hoặc xác nhận cố ý dùng chung chứng từ.`,
      409,
    );
  }
}

// ============================================================================
// 1. WORKSHOP JOBS OPS (§B)
// ============================================================================

export async function initOrderWorkshopJobsTx(
  client: pg.PoolClient,
  ctx: AuthenticatedContext,
  orderId: string,
  input: Record<string, unknown>,
  requestId: string,
): Promise<PrintWorkshopJobData[]> {
  const ordRes = await client.query(
    `SELECT * FROM print_orders WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [orderId, ctx.workspace.id],
  );
  const ord = ordRes.rows[0];
  if (!ord) {
    throw new AuthError('NOT_FOUND', 'Không tìm thấy đơn hàng in ấn.', 404);
  }

  const existingJobs = await client.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM print_workshop_jobs
     WHERE workspace_id = $1 AND order_id = $2 AND job_status <> 'CANCELLED'`,
    [ctx.workspace.id, orderId],
  );
  if (
    toInt(existingJobs.rows[0]?.cnt, 0) > 0 &&
    input['allow_additional'] !== true
  ) {
    throw new AuthError(
      'CONFLICT',
      'Đơn hàng đã có phiếu đặt xưởng đang hoạt động. Dùng thêm phiếu lẻ nếu cần tách xưởng bổ sung.',
      409,
    );
  }

  const snap = ord['snapshot_json'] as { lines?: PersistedQuoteLineSnapshot[] };
  const lines = Array.isArray(snap?.lines) ? snap.lines : [];
  const defaultVendorId = ord['vendor_id'] ? String(ord['vendor_id']) : null;
  const defaultVendorName = ord['vendor_name']
    ? String(ord['vendor_name'])
    : null;
  const orderScope = normalizeLedgerScopeInput(ord['ledger_scope']);
  const splitPerStage = input['split_mode'] === 'PER_STAGE';

  interface DraftBucket {
    key: string;
    vendorId: string | null;
    vendorName: string | null;
    titleParts: string[];
    refs: WorkshopJobLineRef[];
    expectedCost: number;
  }
  const buckets = new Map<string, DraftBucket>();

  const pushRef = (
    bucketKey: string,
    vendorId: string | null,
    vendorName: string | null,
    titlePart: string,
    ref: WorkshopJobLineRef,
  ) => {
    const existing = buckets.get(bucketKey);
    if (existing) {
      if (!existing.titleParts.includes(titlePart)) {
        existing.titleParts.push(titlePart);
      }
      existing.refs.push(ref);
      existing.expectedCost += ref.expectedAmount;
    } else {
      buckets.set(bucketKey, {
        key: bucketKey,
        vendorId,
        vendorName,
        titleParts: [titlePart],
        refs: [ref],
        expectedCost: ref.expectedAmount,
      });
    }
  };

  for (const line of lines) {
    const baseVendorId = line.vendorId ?? defaultVendorId;
    const baseVendorName = line.vendorName ?? defaultVendorName;
    const stages = Array.isArray(line.finishingStages)
      ? line.finishingStages
      : [];
    const resolveStageExpectedCost = (st: (typeof stages)[number]): number => {
      const rec = st as unknown as Record<string, unknown>;
      return toInt(rec['vendorCost'] ?? rec['totalStageVendorCost'], 0);
    };
    const stagesCostSum = stages.reduce(
      (s, st) => s + resolveStageExpectedCost(st),
      0,
    );
    const baseCost =
      line.baseVendorCost !== undefined
        ? toInt(line.baseVendorCost, 0)
        : Math.max(0, toInt(line.totalVendorCost, 0) - stagesCostSum);

    const baseKey = splitPerStage
      ? `BASE:${line.id}`
      : `VENDOR:${baseVendorId ?? 'UNASSIGNED'}`;
    pushRef(baseKey, baseVendorId, baseVendorName, line.name, {
      lineId: line.id,
      lineName: line.name,
      itemRole: 'BASE_PRINT',
      quantity: line.quantity,
      unit: line.unit,
      billableAreaSqm: line.areaSpec?.billableAreaSqm ?? null,
      expectedAmount: baseCost,
    });

    for (const st of stages) {
      const stVendorId = st.vendorId ?? baseVendorId;
      const stVendorName = st.vendorName ?? baseVendorName;
      const stCost = resolveStageExpectedCost(st);
      const stKey =
        splitPerStage || stVendorId !== baseVendorId
          ? `STAGE:${line.id}:${st.id}:${stVendorId ?? 'UNASSIGNED'}`
          : `VENDOR:${stVendorId ?? 'UNASSIGNED'}`;
      pushRef(stKey, stVendorId, stVendorName, `${line.name} (${st.name})`, {
        lineId: line.id,
        lineName: line.name,
        stageId: st.id,
        stageName: st.name,
        itemRole: 'FINISHING',
        quantity: line.quantity,
        unit: st.unit || line.unit,
        billableAreaSqm: line.areaSpec?.billableAreaSqm ?? null,
        expectedAmount: stCost,
      });
    }
  }

  if (buckets.size === 0) {
    buckets.set('DEFAULT', {
      key: 'DEFAULT',
      vendorId: defaultVendorId,
      vendorName: defaultVendorName,
      titleParts: [String(ord['title'])],
      refs: [],
      expectedCost: toInt(ord['expected_vendor_cost'], 0),
    });
  }

  const createdJobs: PrintWorkshopJobData[] = [];
  for (const b of buckets.values()) {
    const jobCode = await allocateNextLedgerCode(
      client,
      ctx.workspace.id,
      'WORKSHOP_JOB',
    );
    const title = b.titleParts.slice(0, 3).join(' + ');
    const insRes = await client.query(
      `INSERT INTO print_workshop_jobs (
         workspace_id, job_code, order_id, vendor_id, vendor_name, ledger_scope,
         title, source_line_refs, job_status, cost_status, expected_cost,
         due_date, created_by
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8::jsonb, 'ORDERED', 'UNVERIFIED', $9,
         $10, $11
       ) RETURNING *`,
      [
        ctx.workspace.id,
        jobCode,
        orderId,
        b.vendorId,
        b.vendorName,
        orderScope,
        title,
        JSON.stringify(b.refs),
        b.expectedCost,
        toDateStr(ord['due_date']),
        ctx.user.id,
      ],
    );
    const job = mapWorkshopJobRow(insRes.rows[0]!);
    await client.query(
      `INSERT INTO print_workshop_job_history (
         workspace_id, workshop_job_id, order_id, action, before_json, after_json, reason, changed_by
       ) VALUES ($1, $2, $3, 'CREATED', '{}'::jsonb, $4::jsonb, $5, $6)`,
      [
        ctx.workspace.id,
        job.id,
        orderId,
        JSON.stringify({
          job_code: job.job_code,
          vendor_id: job.vendor_id,
          expected_cost: job.expected_cost,
          cost_status: job.cost_status,
        }),
        'Khởi tạo phiếu đặt xưởng từ dòng báo giá',
        ctx.user.id,
      ],
    );
    createdJobs.push(job);
  }

  await syncOrderFromWorkshopJobs(client, {
    workspaceId: ctx.workspace.id,
    orderId,
    actorId: ctx.user.id,
    note: 'Tách phiếu đặt xưởng từ đơn hàng',
  });

  await recordAuditEvent(client, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: 'printquote.workshop_jobs.init',
    entityType: 'print_order',
    entityId: orderId,
    requestId,
    metadata: { count: createdJobs.length },
  });

  return createdJobs;
}

export async function createWorkshopJobTx(
  client: pg.PoolClient,
  ctx: AuthenticatedContext,
  orderId: string,
  input: Record<string, unknown>,
  requestId: string,
): Promise<PrintWorkshopJobData> {
  const ordRes = await client.query(
    `SELECT * FROM print_orders WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [orderId, ctx.workspace.id],
  );
  const ord = ordRes.rows[0];
  if (!ord) {
    throw new AuthError('NOT_FOUND', 'Không tìm thấy đơn hàng in ấn.', 404);
  }

  const title = typeof input['title'] === 'string' ? input['title'].trim() : '';
  if (!title) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Tên công việc / hạng mục đặt xưởng là bắt buộc.',
      400,
    );
  }

  let vendorId: string | null =
    typeof input['vendor_id'] === 'string' && input['vendor_id'].trim()
      ? input['vendor_id'].trim()
      : null;
  let vendorName: string | null =
    typeof input['vendor_name'] === 'string' && input['vendor_name'].trim()
      ? input['vendor_name'].trim()
      : null;

  if (vendorId) {
    const vRes = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM print_vendors WHERE id = $1 AND workspace_id = $2`,
      [vendorId, ctx.workspace.id],
    );
    if (!vRes.rows[0]) {
      throw new AuthError('NOT_FOUND', 'Không tìm thấy xưởng / nhà in.', 404);
    }
    vendorId = vRes.rows[0].id;
    vendorName = vRes.rows[0].name;
  }

  const expectedCost = assertSafeNonNegativeVnd(
    toInt(input['expected_cost'], 0),
    'Chi phí dự kiến đặt xưởng',
  );
  const hasEntered =
    input['entered_cost'] !== undefined && input['entered_cost'] !== null;
  const enteredCost = hasEntered
    ? assertSafeNonNegativeVnd(
        toInt(input['entered_cost'], -1),
        'Chi phí thực tế nhập',
      )
    : null;
  const wantsConfirm = input['confirm_cost'] === true;

  if (wantsConfirm && (!vendorId || enteredCost === null)) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Phải chọn Xưởng thực hiện và nhập Chi phí thực tế trước khi xác nhận công nợ xưởng.',
      400,
    );
  }

  const costStatus: WorkshopJobCostStatusType = wantsConfirm
    ? WorkshopJobCostStatus.CONFIRMED
    : enteredCost !== null
      ? WorkshopJobCostStatus.ENTERED_UNCONFIRMED
      : WorkshopJobCostStatus.UNVERIFIED;
  const confirmedCost = wantsConfirm ? enteredCost : null;
  const scope = normalizeLedgerScopeInput(
    input['ledger_scope'],
    normalizeLedgerScopeInput(ord['ledger_scope']),
  );

  const jobCode = await allocateNextLedgerCode(
    client,
    ctx.workspace.id,
    'WORKSHOP_JOB',
    input['job_code'],
  );

  const insRes = await client.query(
    `INSERT INTO print_workshop_jobs (
       workspace_id, job_code, order_id, vendor_id, vendor_name, ledger_scope,
       title, source_line_refs, job_status, cost_status,
       expected_cost, entered_cost, confirmed_cost, confirmed_at, confirmed_by,
       valid_payable_amount, remaining_payable_amount,
       ordered_at, due_date, note, created_by
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8::jsonb, $9, $10,
       $11, $12, $13, $14, $15,
       $16, $16,
       $17, $18, $19, $20
     ) RETURNING *`,
    [
      ctx.workspace.id,
      jobCode,
      orderId,
      vendorId,
      vendorName,
      scope,
      title,
      JSON.stringify(
        Array.isArray(input['source_line_refs'])
          ? input['source_line_refs']
          : [],
      ),
      typeof input['job_status'] === 'string' ? input['job_status'] : 'ORDERED',
      costStatus,
      expectedCost,
      enteredCost,
      confirmedCost,
      wantsConfirm ? new Date() : null,
      wantsConfirm ? ctx.user.id : null,
      wantsConfirm ? confirmedCost! : 0,
      input['ordered_at'] ? new Date(String(input['ordered_at'])) : new Date(),
      toDateStr(input['due_date']) ?? toDateStr(ord['due_date']),
      typeof input['note'] === 'string' ? input['note'].trim() || null : null,
      ctx.user.id,
    ],
  );

  const created = await recomputeWorkshopJobState(
    client,
    ctx.workspace.id,
    String(insRes.rows[0]!['id']),
  );

  await client.query(
    `INSERT INTO print_workshop_job_history (
       workspace_id, workshop_job_id, order_id, action, before_json, after_json, reason, changed_by
     ) VALUES ($1, $2, $3, $4, '{}'::jsonb, $5::jsonb, $6, $7)`,
    [
      ctx.workspace.id,
      created.id,
      orderId,
      wantsConfirm
        ? WorkshopJobHistoryAction.COST_CONFIRMED
        : WorkshopJobHistoryAction.CREATED,
      JSON.stringify({
        job_code: created.job_code,
        vendor_id: created.vendor_id,
        expected_cost: created.expected_cost,
        entered_cost: created.entered_cost,
        confirmed_cost: created.confirmed_cost,
        cost_status: created.cost_status,
      }),
      typeof input['reason'] === 'string'
        ? input['reason'].trim() || null
        : null,
      ctx.user.id,
    ],
  );

  await syncOrderFromWorkshopJobs(client, {
    workspaceId: ctx.workspace.id,
    orderId,
    actorId: ctx.user.id,
    note: `Thêm phiếu đặt xưởng ${created.job_code}`,
    autoConfirmOrderIfComplete: input['auto_confirm_order'] === true,
  });

  await recordAuditEvent(client, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: 'printquote.workshop_job.create',
    entityType: 'print_workshop_job',
    entityId: created.id,
    requestId,
    metadata: {
      job_code: created.job_code,
      order_id: orderId,
      cost_status: created.cost_status,
    },
  });

  return created;
}

export async function updateOrConfirmWorkshopJobTx(
  client: pg.PoolClient,
  ctx: AuthenticatedContext,
  jobId: string,
  input: Record<string, unknown>,
  requestId: string,
): Promise<PrintWorkshopJobData> {
  const jobRes = await client.query(
    `SELECT * FROM print_workshop_jobs WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [jobId, ctx.workspace.id],
  );
  const existing = jobRes.rows[0];
  if (!existing) {
    throw new AuthError('NOT_FOUND', 'Không tìm thấy phiếu đặt xưởng.', 404);
  }

  const prevCostStatus = existing['cost_status'] as WorkshopJobCostStatusType;
  const wasConfirmed = prevCostStatus === WorkshopJobCostStatus.CONFIRMED;
  const prevEntered =
    existing['entered_cost'] !== null && existing['entered_cost'] !== undefined
      ? toInt(existing['entered_cost'], 0)
      : null;
  const prevConfirmedCost =
    existing['confirmed_cost'] !== null &&
    existing['confirmed_cost'] !== undefined
      ? toInt(existing['confirmed_cost'], 0)
      : null;
  const prevVendorId = existing['vendor_id']
    ? String(existing['vendor_id'])
    : null;
  const allocatedPaid = toInt(existing['allocated_paid_amount'], 0);

  let nextVendorId = prevVendorId;
  let nextVendorName = existing['vendor_name']
    ? String(existing['vendor_name'])
    : null;
  if (input['vendor_id'] !== undefined) {
    if (allocatedPaid > 0 && input['vendor_id'] !== prevVendorId) {
      throw new AuthError(
        'CONFLICT',
        'Không thể đổi xưởng thực hiện khi phiếu đặt xưởng đã có bút toán chi tiền phân bổ.',
        409,
      );
    }
    if (typeof input['vendor_id'] === 'string' && input['vendor_id'].trim()) {
      const vRes = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM print_vendors WHERE id = $1 AND workspace_id = $2`,
        [input['vendor_id'].trim(), ctx.workspace.id],
      );
      if (!vRes.rows[0]) {
        throw new AuthError('NOT_FOUND', 'Không tìm thấy xưởng / nhà in.', 404);
      }
      nextVendorId = vRes.rows[0].id;
      nextVendorName = vRes.rows[0].name;
    } else {
      nextVendorId = null;
      nextVendorName = null;
    }
  }

  const nextJobStatus: WorkshopJobStatusType =
    typeof input['job_status'] === 'string'
      ? (input['job_status'] as WorkshopJobStatusType)
      : (existing['job_status'] as WorkshopJobStatusType);

  let nextEntered = prevEntered;
  if (input['entered_cost'] !== undefined) {
    nextEntered =
      input['entered_cost'] === null
        ? null
        : assertSafeNonNegativeVnd(
            toInt(input['entered_cost'], -1),
            'Chi phí thực tế phiếu xưởng',
          );
  }

  let nextCostStatus = prevCostStatus;
  let nextConfirmedCost = prevConfirmedCost;

  if (input['confirm_cost'] === false) {
    if (allocatedPaid > 0) {
      throw new AuthError(
        'CONFLICT',
        'Phiếu đặt xưởng đã có tiền chi phân bổ. Nếu giảm/tăng giá sau thanh toán, hãy lập Bút toán điều chỉnh công nợ xưởng (AP Adjustment) hoặc hủy phiếu chi trước.',
        409,
      );
    }
    nextCostStatus =
      nextEntered !== null
        ? WorkshopJobCostStatus.ENTERED_UNCONFIRMED
        : WorkshopJobCostStatus.UNVERIFIED;
    nextConfirmedCost = null;
  } else if (input['confirm_cost'] === true) {
    if (!nextVendorId || nextEntered === null) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Phải chọn Xưởng và nhập Chi phí thực tế trước khi xác nhận công nợ xưởng.',
        400,
      );
    }
    nextCostStatus = WorkshopJobCostStatus.CONFIRMED;
    nextConfirmedCost = nextEntered;
  } else if (input['entered_cost'] !== undefined) {
    if (wasConfirmed) {
      // Editing cost on an already confirmed job without explicit confirm_cost=true requires explicit confirmation choice
      throw new AuthError(
        'CONFIRMATION_DECISION_REQUIRED',
        'Phiếu xưởng đã xác nhận trước đó. Khi sửa chi phí, phải chọn rõ: Xác nhận mức chi phí mới (confirm_cost: true) hoặc Bỏ xác nhận (confirm_cost: false) kèm lý do.',
        400,
      );
    }
    nextCostStatus =
      nextEntered !== null
        ? WorkshopJobCostStatus.ENTERED_UNCONFIRMED
        : WorkshopJobCostStatus.UNVERIFIED;
    nextConfirmedCost = null;
  }

  const modifiesConfirmedRecord =
    wasConfirmed &&
    (nextCostStatus !== WorkshopJobCostStatus.CONFIRMED ||
      nextConfirmedCost !== prevConfirmedCost ||
      nextVendorId !== prevVendorId ||
      nextJobStatus === WorkshopJobStatus.CANCELLED);

  const reason = modifiesConfirmedRecord
    ? requireNonEmptyReason(
        input['reason'],
        'Lý do điều chỉnh/bỏ xác nhận chi phí xưởng đã chốt',
      )
    : typeof input['reason'] === 'string' && input['reason'].trim()
      ? input['reason'].trim()
      : null;

  if (
    nextConfirmedCost !== null &&
    allocatedPaid >
      nextConfirmedCost + toInt(existing['net_ap_adjustment_amount'], 0) &&
    input['allow_overpaid_credit'] !== true
  ) {
    // Allowed when explicitly acknowledged or via AP adjustment; keep vendorOverpaidCreditAmount accurate
  }

  const nextTitle =
    typeof input['title'] === 'string' && input['title'].trim()
      ? input['title'].trim()
      : String(existing['title']);
  const nextExpected =
    input['expected_cost'] !== undefined
      ? assertSafeNonNegativeVnd(
          toInt(input['expected_cost'], 0),
          'Chi phí dự kiến',
        )
      : toInt(existing['expected_cost'], 0);
  const nextNote =
    input['note'] !== undefined
      ? typeof input['note'] === 'string'
        ? input['note'].trim() || null
        : null
      : existing['note']
        ? String(existing['note'])
        : null;

  await client.query(
    `UPDATE print_workshop_jobs
     SET vendor_id = $1,
         vendor_name = $2,
         title = $3,
         job_status = $4,
         cost_status = $5,
         expected_cost = $6,
         entered_cost = $7,
         confirmed_cost = $8,
         confirmed_at = CASE
           WHEN $5 <> 'CONFIRMED' THEN NULL
           WHEN $9 = true OR confirmed_at IS NULL THEN now()
           ELSE confirmed_at
         END,
         confirmed_by = CASE
           WHEN $5 <> 'CONFIRMED' THEN NULL
           WHEN $9 = true OR confirmed_by IS NULL THEN $10::uuid
           ELSE confirmed_by
         END,
         due_date = $11,
         note = $12,
         updated_at = now()
     WHERE id = $13 AND workspace_id = $14`,
    [
      nextVendorId,
      nextVendorName,
      nextTitle,
      nextJobStatus,
      nextCostStatus,
      nextExpected,
      nextEntered,
      nextConfirmedCost,
      nextConfirmedCost !== prevConfirmedCost || !wasConfirmed,
      ctx.user.id,
      input['due_date'] !== undefined
        ? toDateStr(input['due_date'])
        : toDateStr(existing['due_date']),
      nextNote,
      jobId,
      ctx.workspace.id,
    ],
  );

  const updated = await recomputeWorkshopJobState(
    client,
    ctx.workspace.id,
    jobId,
  );

  let historyAction: WorkshopJobHistoryActionType =
    WorkshopJobHistoryAction.UPDATED;
  if (
    nextJobStatus === WorkshopJobStatus.CANCELLED &&
    existing['job_status'] !== WorkshopJobStatus.CANCELLED
  ) {
    historyAction = WorkshopJobHistoryAction.CANCELLED;
  } else if (
    wasConfirmed &&
    nextCostStatus !== WorkshopJobCostStatus.CONFIRMED
  ) {
    historyAction = WorkshopJobHistoryAction.COST_UNCONFIRMED;
  } else if (
    wasConfirmed &&
    nextCostStatus === WorkshopJobCostStatus.CONFIRMED &&
    nextConfirmedCost !== prevConfirmedCost
  ) {
    historyAction = WorkshopJobHistoryAction.COST_ADJUSTED;
  } else if (
    !wasConfirmed &&
    nextCostStatus === WorkshopJobCostStatus.CONFIRMED
  ) {
    historyAction = WorkshopJobHistoryAction.COST_CONFIRMED;
  } else if (nextEntered !== prevEntered) {
    historyAction = WorkshopJobHistoryAction.COST_ENTERED;
  } else if (nextVendorId !== prevVendorId) {
    historyAction = WorkshopJobHistoryAction.VENDOR_ASSIGNED;
  }

  await client.query(
    `INSERT INTO print_workshop_job_history (
       workspace_id, workshop_job_id, order_id, action, before_json, after_json, reason, changed_by
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8)`,
    [
      ctx.workspace.id,
      jobId,
      updated.order_id,
      historyAction,
      JSON.stringify({
        vendor_id: prevVendorId,
        job_status: existing['job_status'],
        cost_status: prevCostStatus,
        entered_cost: prevEntered,
        confirmed_cost: prevConfirmedCost,
      }),
      JSON.stringify({
        vendor_id: updated.vendor_id,
        job_status: updated.job_status,
        cost_status: updated.cost_status,
        entered_cost: updated.entered_cost,
        confirmed_cost: updated.confirmed_cost,
        valid_payable_amount: updated.valid_payable_amount,
      }),
      reason,
      ctx.user.id,
    ],
  );

  await syncOrderFromWorkshopJobs(client, {
    workspaceId: ctx.workspace.id,
    orderId: updated.order_id,
    actorId: ctx.user.id,
    note: reason ?? `Cập nhật phiếu đặt xưởng ${updated.job_code}`,
    autoConfirmOrderIfComplete: input['auto_confirm_order'] === true,
  });

  const histRes = await client.query(
    `SELECT * FROM print_workshop_job_history
     WHERE workspace_id = $1 AND workshop_job_id = $2
     ORDER BY created_at DESC`,
    [ctx.workspace.id, jobId],
  );
  updated.history = histRes.rows.map(mapWorkshopJobHistoryRow);

  await recordAuditEvent(client, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: `printquote.workshop_job.${historyAction.toLowerCase()}`,
    entityType: 'print_workshop_job',
    entityId: jobId,
    requestId,
    metadata: {
      job_code: updated.job_code,
      cost_status: updated.cost_status,
      confirmed_cost: updated.confirmed_cost,
      reason,
    },
  });

  return updated;
}

// ============================================================================
// 2. OPENING BALANCES & CUSTOMER RECEIVABLES (AR — §C)
// ============================================================================

export async function createOpeningBalanceTx(
  client: pg.PoolClient,
  ctx: AuthenticatedContext,
  input: Record<string, unknown>,
  requestId: string,
): Promise<PrintOpeningBalanceData> {
  const direction =
    input['direction'] === OpeningBalanceDirection.VENDOR_PAYABLE
      ? OpeningBalanceDirection.VENDOR_PAYABLE
      : OpeningBalanceDirection.CUSTOMER_RECEIVABLE;
  const amount = assertSafePositiveVnd(
    toInt(input['original_amount'] ?? input['amount'], 0),
    'Số dư đầu kỳ',
  );
  const scope = normalizeLedgerScopeInput(input['ledger_scope']);

  let customerId: string | null =
    typeof input['customer_id'] === 'string' && input['customer_id'].trim()
      ? input['customer_id'].trim()
      : null;
  let customerName: string | null =
    typeof input['customer_name'] === 'string' && input['customer_name'].trim()
      ? input['customer_name'].trim()
      : null;
  let vendorId: string | null =
    typeof input['vendor_id'] === 'string' && input['vendor_id'].trim()
      ? input['vendor_id'].trim()
      : null;
  let vendorName: string | null =
    typeof input['vendor_name'] === 'string' && input['vendor_name'].trim()
      ? input['vendor_name'].trim()
      : null;

  if (direction === OpeningBalanceDirection.CUSTOMER_RECEIVABLE) {
    vendorId = null;
    vendorName = null;
    if (customerId) {
      const cRes = await client.query<{ id: string; name: string }>(
        `SELECT id, name FROM print_customers WHERE id = $1 AND workspace_id = $2`,
        [customerId, ctx.workspace.id],
      );
      if (!cRes.rows[0]) {
        throw new AuthError('NOT_FOUND', 'Không tìm thấy khách hàng.', 404);
      }
      customerId = cRes.rows[0].id;
      customerName = cRes.rows[0].name;
    }
    if (!customerName) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Phải nhập tên khách hàng cho công nợ phải thu đầu kỳ.',
        400,
      );
    }
  } else {
    customerId = null;
    customerName = null;
    if (!vendorId) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Phải chọn xưởng / nhà in cho công nợ phải trả đầu kỳ.',
        400,
      );
    }
    const vRes = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM print_vendors WHERE id = $1 AND workspace_id = $2`,
      [vendorId, ctx.workspace.id],
    );
    if (!vRes.rows[0]) {
      throw new AuthError('NOT_FOUND', 'Không tìm thấy xưởng / nhà in.', 404);
    }
    vendorId = vRes.rows[0].id;
    vendorName = vRes.rows[0].name;
  }

  const docCode = await allocateNextLedgerCode(
    client,
    ctx.workspace.id,
    'OPENING_BAL',
    input['doc_code'],
  );

  const insRes = await client.query(
    `INSERT INTO print_opening_balances (
       workspace_id, doc_code, direction, ledger_scope,
       customer_id, customer_name, vendor_id, vendor_name,
       original_amount, valid_amount, remaining_amount,
       as_of_date, reference_code,
       source_sheet_name, source_tab_name, source_row_number, import_row_id,
       note, recorded_by
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6, $7, $8,
       $9, $9, $9,
       $10, $11,
       $12, $13, $14, $15,
       $16, $17
     ) RETURNING id`,
    [
      ctx.workspace.id,
      docCode,
      direction,
      scope,
      customerId,
      customerName,
      vendorId,
      vendorName,
      amount,
      toDateStr(input['as_of_date']) ?? new Date().toISOString().slice(0, 10),
      typeof input['reference_code'] === 'string'
        ? input['reference_code'].trim() || null
        : null,
      typeof input['source_sheet_name'] === 'string'
        ? input['source_sheet_name'].trim() || null
        : null,
      typeof input['source_tab_name'] === 'string'
        ? input['source_tab_name'].trim() || null
        : null,
      typeof input['source_row_number'] === 'number'
        ? toInt(input['source_row_number'], 0)
        : null,
      typeof input['import_row_id'] === 'string'
        ? input['import_row_id']
        : null,
      typeof input['note'] === 'string' ? input['note'].trim() || null : null,
      ctx.user.id,
    ],
  );

  const ob = await recomputeOpeningBalanceState(
    client,
    ctx.workspace.id,
    String(insRes.rows[0]!['id']),
  );

  await recordAuditEvent(client, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: 'printquote.opening_balance.create',
    entityType: 'print_opening_balance',
    entityId: ob.id,
    requestId,
    metadata: { doc_code: ob.doc_code, direction, scope, amount },
  });

  return ob;
}

interface ParsedArTargetAllocation {
  orderId: string | null;
  openingBalanceId: string | null;
  amount: number;
  note: string | null;
}

function parseArAllocationsInput(raw: unknown): ParsedArTargetAllocation[] {
  if (!Array.isArray(raw)) return [];
  const list: ParsedArTargetAllocation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const amt = assertSafePositiveVnd(
      toInt(rec['amount'], 0),
      'Số tiền phân bổ thu khách',
    );
    const orderId =
      typeof rec['order_id'] === 'string' && rec['order_id'].trim()
        ? rec['order_id'].trim()
        : null;
    const openingBalanceId =
      typeof rec['opening_balance_id'] === 'string' &&
      rec['opening_balance_id'].trim()
        ? rec['opening_balance_id'].trim()
        : null;
    if ((orderId && openingBalanceId) || (!orderId && !openingBalanceId)) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Mỗi dòng phân bổ thu tiền khách phải chọn đúng 1 đích: Đơn hàng (order_id) hoặc Số dư đầu kỳ (opening_balance_id).',
        400,
      );
    }
    list.push({
      orderId,
      openingBalanceId,
      amount: amt,
      note: typeof rec['note'] === 'string' ? rec['note'].trim() || null : null,
    });
  }
  return list;
}

async function applyArAllocationsInternal(
  client: pg.PoolClient,
  params: {
    workspaceId: string;
    arTxId: string;
    customerId: string | null;
    customerName: string;
    ledgerScope: string;
    allocations: ParsedArTargetAllocation[];
    actorId: string;
  },
): Promise<void> {
  // Lock target orders and opening balances in deterministic UUID order to prevent deadlocks
  const orderIds = [
    ...new Set(
      params.allocations
        .map((a) => a.orderId)
        .filter((id): id is string => Boolean(id)),
    ),
  ].sort();
  const obIds = [
    ...new Set(
      params.allocations
        .map((a) => a.openingBalanceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ].sort();

  const lockedOrders = new Map<string, Record<string, unknown>>();
  for (const oid of orderIds) {
    const state = await recomputeOrderReceivableState(
      client,
      params.workspaceId,
      oid,
    );
    lockedOrders.set(oid, state.orderRow);
  }

  const lockedObs = new Map<string, PrintOpeningBalanceData>();
  for (const obid of obIds) {
    const ob = await recomputeOpeningBalanceState(
      client,
      params.workspaceId,
      obid,
    );
    lockedObs.set(obid, ob);
  }

  // Track cumulative allocation per target within this single call
  const runningByTarget = new Map<string, number>();

  for (const alloc of params.allocations) {
    if (alloc.orderId) {
      const ord = lockedOrders.get(alloc.orderId);
      if (!ord) {
        throw new AuthError(
          'NOT_FOUND',
          'Không tìm thấy đơn hàng phân bổ.',
          404,
        );
      }
      if (ord['production_status'] === PrintProductionStatus.CANCELLED) {
        throw new AuthError(
          'ORDER_CANCELLED',
          `Không thể phân bổ thu tiền vào đơn đã hủy (${String(ord['order_code'])}).`,
          409,
        );
      }
      if (!ord['customer_id']) {
        throw new AuthError(
          'CUSTOMER_REQUIRED_BEFORE_PAYMENT',
          `Đơn hàng cũ ${String(ord['order_code'])} chưa gắn mã khách hàng (customer_id). Vui lòng gắn khách hàng trong phần Đối chiếu công nợ trước khi phân bổ phiếu thu.`,
          409,
        );
      }
      const ordScope = normalizeLedgerScopeInput(ord['ledger_scope']);
      if (ordScope !== params.ledgerScope) {
        throw new AuthError(
          'SCOPE_MISMATCH',
          `Không thể phân bổ phiếu thu nhóm ${params.ledgerScope} sang đơn hàng nhóm ${ordScope} (cấm tự bù trừ giữa các sổ RIÊNG / HVGROUP / GENERAL).`,
          400,
        );
      }
      if (
        params.customerId &&
        ord['customer_id'] &&
        String(ord['customer_id']) !== params.customerId
      ) {
        throw new AuthError(
          'COUNTERPARTY_MISMATCH',
          `Đơn hàng ${String(ord['order_code'])} thuộc khách hàng khác, không thể phân bổ chung.`,
          400,
        );
      }
      const remaining = toInt(ord['remaining_debt_amount'], 0);
      const nextCum =
        (runningByTarget.get(`O:${alloc.orderId}`) ?? 0) + alloc.amount;
      if (nextCum > remaining) {
        throw new AuthError(
          'OVER_ALLOCATION',
          `Số tiền phân bổ (${nextCum} VND) vượt quá Còn phải thu (${remaining} VND) của đơn ${String(ord['order_code'])}. Hãy để phần dư nằm ở Tiền khách ứng trước chưa phân bổ.`,
          400,
        );
      }
      runningByTarget.set(`O:${alloc.orderId}`, nextCum);
    } else if (alloc.openingBalanceId) {
      const ob = lockedObs.get(alloc.openingBalanceId);
      if (!ob || ob.direction !== OpeningBalanceDirection.CUSTOMER_RECEIVABLE) {
        throw new AuthError(
          'NOT_FOUND',
          'Không tìm thấy công nợ phải thu đầu kỳ.',
          404,
        );
      }
      if (ob.ledger_scope !== params.ledgerScope) {
        throw new AuthError(
          'SCOPE_MISMATCH',
          `Không thể phân bổ phiếu thu nhóm ${params.ledgerScope} sang số dư đầu kỳ nhóm ${ob.ledger_scope}.`,
          400,
        );
      }
      if (
        params.customerId &&
        ob.customer_id &&
        ob.customer_id !== params.customerId
      ) {
        throw new AuthError(
          'COUNTERPARTY_MISMATCH',
          `Số dư đầu kỳ ${ob.doc_code} thuộc khách hàng khác.`,
          400,
        );
      }
      const nextCum =
        (runningByTarget.get(`OB:${alloc.openingBalanceId}`) ?? 0) +
        alloc.amount;
      if (nextCum > ob.remaining_amount) {
        throw new AuthError(
          'OVER_ALLOCATION',
          `Số tiền phân bổ (${nextCum} VND) vượt quá Còn phải thu (${ob.remaining_amount} VND) của ${ob.doc_code}.`,
          400,
        );
      }
      runningByTarget.set(`OB:${alloc.openingBalanceId}`, nextCum);
    }
  }

  for (const alloc of params.allocations) {
    await client.query(
      `INSERT INTO print_ar_allocations (
         workspace_id, ar_transaction_id, order_id, opening_balance_id,
         direction, amount, note, recorded_by
       ) VALUES ($1, $2, $3, $4, 'APPLY', $5, $6, $7)`,
      [
        params.workspaceId,
        params.arTxId,
        alloc.orderId,
        alloc.openingBalanceId,
        alloc.amount,
        alloc.note,
        params.actorId,
      ],
    );
  }

  for (const oid of orderIds) {
    await recomputeOrderReceivableState(client, params.workspaceId, oid);
  }
  for (const obid of obIds) {
    await recomputeOpeningBalanceState(client, params.workspaceId, obid);
  }
}

export async function createCustomerReceiptTx(
  client: pg.PoolClient,
  ctx: AuthenticatedContext,
  input: Record<string, unknown>,
  requestId: string,
): Promise<PrintArTransactionData> {
  const amount = assertSafePositiveVnd(
    toInt(input['amount'], 0),
    'Số tiền phiếu thu khách',
  );
  const allocations = parseArAllocationsInput(input['allocations']);
  const totalAllocated = allocations.reduce((s, a) => s + a.amount, 0);
  if (totalAllocated > amount) {
    throw new AuthError(
      'VALIDATION_ERROR',
      `Tổng phân bổ (${totalAllocated} VND) không được vượt quá số tiền phiếu thu (${amount} VND).`,
      400,
    );
  }

  let customerId: string | null =
    typeof input['customer_id'] === 'string' && input['customer_id'].trim()
      ? input['customer_id'].trim()
      : null;
  let customerName =
    typeof input['customer_name'] === 'string'
      ? input['customer_name'].trim()
      : '';
  let scope = normalizeLedgerScopeInput(input['ledger_scope']);

  if (customerId) {
    const cRes = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM print_customers WHERE id = $1 AND workspace_id = $2`,
      [customerId, ctx.workspace.id],
    );
    if (!cRes.rows[0]) {
      throw new AuthError('NOT_FOUND', 'Không tìm thấy khách hàng.', 404);
    }
    customerId = cRes.rows[0].id;
    customerName = customerName || cRes.rows[0].name;
  } else if (!customerName && allocations[0]?.orderId) {
    const ordRes = await client.query(
      `SELECT customer_id, customer_name, ledger_scope FROM print_orders WHERE id = $1 AND workspace_id = $2`,
      [allocations[0].orderId, ctx.workspace.id],
    );
    if (ordRes.rows[0]) {
      customerId = ordRes.rows[0]['customer_id']
        ? String(ordRes.rows[0]['customer_id'])
        : null;
      customerName = String(ordRes.rows[0]['customer_name']);
      if (input['ledger_scope'] === undefined) {
        scope = normalizeLedgerScopeInput(ordRes.rows[0]['ledger_scope']);
      }
    }
  }

  if (!customerName) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Phải chọn hoặc nhập tên khách hàng nộp tiền.',
      400,
    );
  }

  const referenceCode =
    typeof input['reference_code'] === 'string' &&
    input['reference_code'].trim()
      ? input['reference_code'].trim()
      : null;

  await checkDuplicateReferenceCode(client, {
    workspaceId: ctx.workspace.id,
    table: 'print_ar_transactions',
    referenceCode,
    confirmDuplicate: input['confirm_duplicate_reference'] === true,
  });

  const unallocatedAmount = amount - totalAllocated;
  assertTransactionConservationInvariant({
    label: 'createCustomerReceipt',
    amount,
    allocatedAmount: totalAllocated,
    refundedUnallocatedAmount: 0,
    unallocatedAmount,
  });

  const subtypeRaw = input['receipt_subtype'];
  const subtype: ArReceiptSubtypeType =
    subtypeRaw === ArReceiptSubtype.DEPOSIT ||
    subtypeRaw === ArReceiptSubtype.INSTALLMENT ||
    subtypeRaw === ArReceiptSubtype.FINAL ||
    subtypeRaw === ArReceiptSubtype.ADVANCE ||
    subtypeRaw === ArReceiptSubtype.OPENING_ADVANCE
      ? subtypeRaw
      : totalAllocated === 0
        ? ArReceiptSubtype.ADVANCE
        : ArReceiptSubtype.INSTALLMENT;

  const txCode = await allocateNextLedgerCode(
    client,
    ctx.workspace.id,
    'AR_TX',
    input['tx_code'],
  );

  const txRes = await client.query(
    `INSERT INTO print_ar_transactions (
       workspace_id, tx_code, customer_id, customer_name, ledger_scope,
       tx_kind, receipt_subtype, amount, allocated_amount,
       refunded_unallocated_amount, unallocated_amount,
       payment_method, occurred_at, reference_code, attachment_url, note,
       status, related_order_id,
       source_sheet_name, source_tab_name, source_row_number, recorded_by
     ) VALUES (
       $1, $2, $3, $4, $5,
       'RECEIPT', $6, $7, $8,
       0, $9,
       $10, $11, $12, $13, $14,
       'POSTED', $15,
       $16, $17, $18, $19
     ) RETURNING *`,
    [
      ctx.workspace.id,
      txCode,
      customerId,
      customerName,
      scope,
      subtype,
      amount,
      totalAllocated,
      unallocatedAmount,
      normalizePaymentMethod(input['payment_method']),
      input['occurred_at']
        ? new Date(String(input['occurred_at']))
        : new Date(),
      referenceCode,
      typeof input['attachment_url'] === 'string'
        ? input['attachment_url'].trim() || null
        : null,
      typeof input['note'] === 'string' ? input['note'].trim() || null : null,
      allocations.length === 1 ? allocations[0]!.orderId : null,
      typeof input['source_sheet_name'] === 'string'
        ? input['source_sheet_name'].trim() || null
        : null,
      typeof input['source_tab_name'] === 'string'
        ? input['source_tab_name'].trim() || null
        : null,
      typeof input['source_row_number'] === 'number'
        ? toInt(input['source_row_number'], 0)
        : null,
      ctx.user.id,
    ],
  );

  const tx = mapArTransactionRow(txRes.rows[0]!);

  if (allocations.length > 0) {
    await applyArAllocationsInternal(client, {
      workspaceId: ctx.workspace.id,
      arTxId: tx.id,
      customerId: tx.customer_id,
      customerName: tx.customer_name,
      ledgerScope: tx.ledger_scope,
      allocations,
      actorId: ctx.user.id,
    });
  }

  const allocRows = await client.query(
    `SELECT a.*, o.order_code, ob.doc_code AS opening_doc_code
     FROM print_ar_allocations a
     LEFT JOIN print_orders o ON o.id = a.order_id
     LEFT JOIN print_opening_balances ob ON ob.id = a.opening_balance_id
     WHERE a.workspace_id = $1 AND a.ar_transaction_id = $2
     ORDER BY a.created_at ASC`,
    [ctx.workspace.id, tx.id],
  );
  tx.allocations = allocRows.rows.map(mapArAllocationRow);

  await recordAuditEvent(client, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: 'printquote.ar_receipt.create',
    entityType: 'print_ar_transaction',
    entityId: tx.id,
    requestId,
    metadata: {
      tx_code: tx.tx_code,
      amount: tx.amount,
      allocated_amount: tx.allocated_amount,
      unallocated_amount: tx.unallocated_amount,
    },
  });

  const orderCodesLabel = tx.allocations
    ?.map((a) => a.order_code)
    .filter(Boolean)
    .join(', ');
  await syncPrintLedgerToFinanceTx(client, {
    workspaceId: ctx.workspace.id,
    fallbackOwnerUserId: ctx.user.id,
    direction: 'income',
    categoryName: 'Thu tiền đơn in ấn',
    amountVnd: tx.amount,
    occurredAt: tx.occurred_at,
    operationKey: `pq_ar_receipt:${tx.id}`,
    note: `Phiếu thu in ấn ${tx.tx_code} — KH: ${tx.customer_name}${orderCodesLabel ? ` (${orderCodesLabel})` : ''}${tx.note ? ` — ${tx.note}` : ''}`,
  });

  return tx;
}

export async function allocateCustomerReceiptTx(
  client: pg.PoolClient,
  ctx: AuthenticatedContext,
  arTxId: string,
  input: Record<string, unknown>,
  requestId: string,
): Promise<PrintArTransactionData> {
  const txRes = await client.query(
    `SELECT * FROM print_ar_transactions WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [arTxId, ctx.workspace.id],
  );
  const existing = txRes.rows[0];
  if (!existing) {
    throw new AuthError(
      'NOT_FOUND',
      'Không tìm thấy phiếu thu khách hàng.',
      404,
    );
  }
  if (
    existing['status'] !== LedgerTxStatus.POSTED ||
    existing['tx_kind'] !== ArTransactionKind.RECEIPT
  ) {
    throw new AuthError(
      'CONFLICT',
      'Chỉ có thể phân bổ từ phiếu thu khách hàng đang có hiệu lực (POSTED).',
      409,
    );
  }

  const allocations = parseArAllocationsInput(input['allocations']);
  if (allocations.length === 0) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Phải chọn ít nhất 1 đơn hàng hoặc số dư đầu kỳ để phân bổ.',
      400,
    );
  }
  const addAlloc = allocations.reduce((s, a) => s + a.amount, 0);
  const currentUnalloc = toInt(existing['unallocated_amount'], 0);
  if (addAlloc > currentUnalloc) {
    throw new AuthError(
      'OVER_ALLOCATION',
      `Số tiền phân bổ thêm (${addAlloc} VND) vượt quá số dư chưa phân bổ của phiếu thu (${currentUnalloc} VND).`,
      400,
    );
  }

  const nextAllocated = toInt(existing['allocated_amount'], 0) + addAlloc;
  const nextUnallocated = currentUnalloc - addAlloc;
  const refundedUnalloc = toInt(existing['refunded_unallocated_amount'], 0);
  const totalAmt = toInt(existing['amount'], 0);

  assertTransactionConservationInvariant({
    label: `allocateCustomerReceipt(${String(existing['tx_code'])})`,
    amount: totalAmt,
    allocatedAmount: nextAllocated,
    refundedUnallocatedAmount: refundedUnalloc,
    unallocatedAmount: nextUnallocated,
  });

  await applyArAllocationsInternal(client, {
    workspaceId: ctx.workspace.id,
    arTxId,
    customerId: existing['customer_id']
      ? String(existing['customer_id'])
      : null,
    customerName: String(existing['customer_name']),
    ledgerScope: String(existing['ledger_scope']),
    allocations,
    actorId: ctx.user.id,
  });

  const updRes = await client.query(
    `UPDATE print_ar_transactions
     SET allocated_amount = $1,
         unallocated_amount = $2
     WHERE id = $3 AND workspace_id = $4
     RETURNING *`,
    [nextAllocated, nextUnallocated, arTxId, ctx.workspace.id],
  );
  const updated = mapArTransactionRow(updRes.rows[0]!);

  const allocRows = await client.query(
    `SELECT a.*, o.order_code, ob.doc_code AS opening_doc_code
     FROM print_ar_allocations a
     LEFT JOIN print_orders o ON o.id = a.order_id
     LEFT JOIN print_opening_balances ob ON ob.id = a.opening_balance_id
     WHERE a.workspace_id = $1 AND a.ar_transaction_id = $2
     ORDER BY a.created_at ASC`,
    [ctx.workspace.id, arTxId],
  );
  updated.allocations = allocRows.rows.map(mapArAllocationRow);

  await recordAuditEvent(client, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: 'printquote.ar_receipt.allocate',
    entityType: 'print_ar_transaction',
    entityId: arTxId,
    requestId,
    metadata: { added_allocated: addAlloc, unallocated_left: nextUnallocated },
  });

  return updated;
}

export async function createCustomerRefundTx(
  client: pg.PoolClient,
  ctx: AuthenticatedContext,
  input: Record<string, unknown>,
  requestId: string,
): Promise<PrintArTransactionData> {
  const amount = assertSafePositiveVnd(
    toInt(input['amount'], 0),
    'Số tiền hoàn trả khách',
  );
  const reason = requireNonEmptyReason(
    input['reason'] ?? input['note'],
    'Lý do hoàn tiền cho khách',
  );
  const referenceCode =
    typeof input['reference_code'] === 'string' &&
    input['reference_code'].trim()
      ? input['reference_code'].trim()
      : null;

  await checkDuplicateReferenceCode(client, {
    workspaceId: ctx.workspace.id,
    table: 'print_ar_transactions',
    referenceCode,
    confirmDuplicate: input['confirm_duplicate_reference'] === true,
  });

  const source =
    input['source'] === 'CANCELLED_ORDER' ||
    input['source'] === 'ORDER_OVERPAYMENT'
      ? input['source']
      : 'UNALLOCATED_ADVANCE';

  const txCode = await allocateNextLedgerCode(
    client,
    ctx.workspace.id,
    'AR_TX',
    input['tx_code'],
  );

  if (source === 'CANCELLED_ORDER' || source === 'ORDER_OVERPAYMENT') {
    const orderId =
      typeof input['order_id'] === 'string' ? input['order_id'].trim() : '';
    if (!orderId) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Phải chọn đơn hàng (order_id) khi hoàn tiền theo đơn.',
        400,
      );
    }
    const state = await recomputeOrderReceivableState(
      client,
      ctx.workspace.id,
      orderId,
    );
    const ord = state.orderRow;

    if (source === 'CANCELLED_ORDER') {
      if (ord['production_status'] !== PrintProductionStatus.CANCELLED) {
        throw new AuthError(
          'VALIDATION_ERROR',
          'Đơn hàng chưa ở trạng thái Đã hủy.',
          400,
        );
      }
      if (
        ord['cancellation_settlement_status'] !==
        CancellationSettlementStatus.SETTLED
      ) {
        throw new AuthError(
          'CANCELLATION_SETTLEMENT_REQUIRED',
          'Đơn hủy chưa có quyết định chốt mức hoàn tiền / phí hủy giữ lại. Vui lòng chốt quyết toán hủy đơn trước khi chi hoàn tiền.',
          409,
        );
      }
      const agreed = toInt(ord['agreed_customer_refund_amount'], 0);
      const alreadyRefunded = toInt(ord['refunded_after_cancel_amount'], 0);
      const refundableLeft = Math.max(0, agreed - alreadyRefunded);
      if (amount > refundableLeft) {
        throw new AuthError(
          'VALIDATION_ERROR',
          `Số tiền hoàn (${amount} VND) vượt quá số tiền hoàn đã thỏa thuận còn lại (${refundableLeft} VND).`,
          400,
        );
      }
    } else {
      if (amount > state.overAllocatedAmount) {
        throw new AuthError(
          'VALIDATION_ERROR',
          `Số tiền hoàn (${amount} VND) vượt quá số tiền khách trả thừa trên đơn (${state.overAllocatedAmount} VND).`,
          400,
        );
      }
    }

    const scope = normalizeLedgerScopeInput(ord['ledger_scope']);
    const txRes = await client.query(
      `INSERT INTO print_ar_transactions (
         workspace_id, tx_code, customer_id, customer_name, ledger_scope,
         tx_kind, amount, allocated_amount, refunded_unallocated_amount, unallocated_amount,
         payment_method, occurred_at, reference_code, note, status, related_order_id, recorded_by
       ) VALUES (
         $1, $2, $3, $4, $5,
         'REFUND', $6, $6, 0, 0,
         $7, $8, $9, $10, 'POSTED', $11, $12
       ) RETURNING *`,
      [
        ctx.workspace.id,
        txCode,
        ord['customer_id'] ?? null,
        String(ord['customer_name']),
        scope,
        amount,
        normalizePaymentMethod(input['payment_method']),
        input['occurred_at']
          ? new Date(String(input['occurred_at']))
          : new Date(),
        referenceCode,
        reason,
        orderId,
        ctx.user.id,
      ],
    );

    const tx = mapArTransactionRow(txRes.rows[0]!);
    await client.query(
      `INSERT INTO print_ar_allocations (
         workspace_id, ar_transaction_id, order_id, direction, amount, note, recorded_by
       ) VALUES ($1, $2, $3, 'REFUND_RELEASE', $4, $5, $6)`,
      [ctx.workspace.id, tx.id, orderId, amount, reason, ctx.user.id],
    );

    if (source === 'CANCELLED_ORDER') {
      await client.query(
        `UPDATE print_orders
         SET refunded_after_cancel_amount = refunded_after_cancel_amount + $1
         WHERE id = $2 AND workspace_id = $3`,
        [amount, orderId, ctx.workspace.id],
      );
    }

    await recomputeOrderReceivableState(client, ctx.workspace.id, orderId);

    await recordAuditEvent(client, {
      workspaceId: ctx.workspace.id,
      actorUserId: ctx.user.id,
      action: 'printquote.ar_refund.create',
      entityType: 'print_ar_transaction',
      entityId: tx.id,
      requestId,
      metadata: {
        tx_code: tx.tx_code,
        source,
        order_id: orderId,
        amount,
        reason,
      },
    });

    return tx;
  }

  // Refund from unallocated customer advance (`UNALLOCATED_ADVANCE`)
  const customerId =
    typeof input['customer_id'] === 'string' && input['customer_id'].trim()
      ? input['customer_id'].trim()
      : null;
  const customerNameInput =
    typeof input['customer_name'] === 'string'
      ? input['customer_name'].trim()
      : '';
  const scope = normalizeLedgerScopeInput(input['ledger_scope']);

  if (!customerId && !customerNameInput) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Phải chọn khách hàng để hoàn tiền ứng trước chưa phân bổ.',
      400,
    );
  }

  const advRes = await client.query(
    customerId
      ? `SELECT * FROM print_ar_transactions
         WHERE workspace_id = $1
           AND customer_id = $2
           AND ledger_scope = $3
           AND tx_kind = 'RECEIPT'
           AND status = 'POSTED'
           AND unallocated_amount > 0
         ORDER BY occurred_at ASC, id ASC
         FOR UPDATE`
      : `SELECT * FROM print_ar_transactions
         WHERE workspace_id = $1
           AND customer_id IS NULL
           AND lower(btrim(customer_name)) = lower(btrim($2))
           AND ledger_scope = $3
           AND tx_kind = 'RECEIPT'
           AND status = 'POSTED'
           AND unallocated_amount > 0
         ORDER BY occurred_at ASC, id ASC
         FOR UPDATE`,
    [ctx.workspace.id, customerId ?? customerNameInput, scope],
  );

  const availableAdvance = advRes.rows.reduce(
    (s, r) => s + toInt(r['unallocated_amount'], 0),
    0,
  );
  if (amount > availableAdvance) {
    throw new AuthError(
      'VALIDATION_ERROR',
      `Số tiền hoàn (${amount} VND) vượt quá số dư ứng trước chưa phân bổ của khách (${availableAdvance} VND).`,
      400,
    );
  }

  let leftToConsume = amount;
  for (const r of advRes.rows) {
    if (leftToConsume <= 0) break;
    const rowUnalloc = toInt(r['unallocated_amount'], 0);
    const take = Math.min(leftToConsume, rowUnalloc);
    const nextRefUnalloc = toInt(r['refunded_unallocated_amount'], 0) + take;
    const nextUnalloc = rowUnalloc - take;
    assertTransactionConservationInvariant({
      label: `consumeCustomerAdvance(${String(r['tx_code'])})`,
      amount: toInt(r['amount'], 0),
      allocatedAmount: toInt(r['allocated_amount'], 0),
      refundedUnallocatedAmount: nextRefUnalloc,
      unallocatedAmount: nextUnalloc,
    });
    await client.query(
      `UPDATE print_ar_transactions
       SET refunded_unallocated_amount = $1,
           unallocated_amount = $2
       WHERE id = $3 AND workspace_id = $4`,
      [nextRefUnalloc, nextUnalloc, r['id'], ctx.workspace.id],
    );
    leftToConsume -= take;
  }

  const resolvedCustomerName =
    customerNameInput || String(advRes.rows[0]!['customer_name']);

  const txRes = await client.query(
    `INSERT INTO print_ar_transactions (
       workspace_id, tx_code, customer_id, customer_name, ledger_scope,
       tx_kind, amount, allocated_amount, refunded_unallocated_amount, unallocated_amount,
       payment_method, occurred_at, reference_code, note, status, recorded_by
     ) VALUES (
       $1, $2, $3, $4, $5,
       'REFUND', $6, 0, $6, 0,
       $7, $8, $9, $10, 'POSTED', $11
     ) RETURNING *`,
    [
      ctx.workspace.id,
      txCode,
      customerId,
      resolvedCustomerName,
      scope,
      amount,
      normalizePaymentMethod(input['payment_method']),
      input['occurred_at']
        ? new Date(String(input['occurred_at']))
        : new Date(),
      referenceCode,
      reason,
      ctx.user.id,
    ],
  );

  const tx = mapArTransactionRow(txRes.rows[0]!);
  await recordAuditEvent(client, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: 'printquote.ar_refund.create',
    entityType: 'print_ar_transaction',
    entityId: tx.id,
    requestId,
    metadata: { tx_code: tx.tx_code, source, amount, reason },
  });

  return tx;
}

export async function createArAdjustmentTx(
  client: pg.PoolClient,
  ctx: AuthenticatedContext,
  input: Record<string, unknown>,
  requestId: string,
): Promise<PrintArAdjustmentData> {
  const reason = requireNonEmptyReason(
    input['reason'],
    'Lý do điều chỉnh phải thu',
  );
  const adjType = (input['adjustment_type'] ??
    ArAdjustmentType.DISCOUNT) as ArAdjustmentTypeVal;
  const rawDelta = toInt(input['delta_amount'], 0);
  if (rawDelta === 0) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Giá trị điều chỉnh (delta_amount) phải khác 0 VND.',
      400,
    );
  }
  if (
    (adjType === ArAdjustmentType.DISCOUNT ||
      adjType === ArAdjustmentType.RETURN_CREDIT) &&
    rawDelta > 0
  ) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Chiết khấu / giảm trừ hàng lỗi phải có delta_amount âm (giảm phải thu).',
      400,
    );
  }
  if (adjType === ArAdjustmentType.SURCHARGE && rawDelta < 0) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Phụ thu phát sinh phải có delta_amount dương (tăng phải thu).',
      400,
    );
  }

  const orderId =
    typeof input['order_id'] === 'string' && input['order_id'].trim()
      ? input['order_id'].trim()
      : null;
  const openingBalanceId =
    typeof input['opening_balance_id'] === 'string' &&
    input['opening_balance_id'].trim()
      ? input['opening_balance_id'].trim()
      : null;

  if ((orderId && openingBalanceId) || (!orderId && !openingBalanceId)) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Phải chọn đúng 1 đích điều chỉnh: Đơn hàng (order_id) hoặc Số dư đầu kỳ (opening_balance_id).',
      400,
    );
  }

  let customerId: string | null = null;
  let customerName = '';
  let scope = LedgerScope.GENERAL as string;

  if (orderId) {
    const ordRes = await client.query(
      `SELECT customer_id, customer_name, ledger_scope, production_status
       FROM print_orders WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
      [orderId, ctx.workspace.id],
    );
    const ord = ordRes.rows[0];
    if (!ord) {
      throw new AuthError('NOT_FOUND', 'Không tìm thấy đơn hàng.', 404);
    }
    if (ord['production_status'] === PrintProductionStatus.CANCELLED) {
      throw new AuthError(
        'ORDER_CANCELLED',
        'Đơn hàng đã hủy dùng quy trình Quyết toán hủy đơn thay vì điều chỉnh giá đơn hoạt động.',
        409,
      );
    }
    customerId = ord['customer_id'] ? String(ord['customer_id']) : null;
    customerName = String(ord['customer_name']);
    scope = normalizeLedgerScopeInput(ord['ledger_scope']);
  } else if (openingBalanceId) {
    const obRes = await client.query(
      `SELECT * FROM print_opening_balances WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
      [openingBalanceId, ctx.workspace.id],
    );
    const ob = obRes.rows[0];
    if (
      !ob ||
      ob['direction'] !== OpeningBalanceDirection.CUSTOMER_RECEIVABLE
    ) {
      throw new AuthError(
        'NOT_FOUND',
        'Không tìm thấy công nợ phải thu đầu kỳ.',
        404,
      );
    }
    customerId = ob['customer_id'] ? String(ob['customer_id']) : null;
    customerName = String(ob['customer_name']);
    scope = normalizeLedgerScopeInput(ob['ledger_scope']);
  }

  const adjCode = await allocateNextLedgerCode(
    client,
    ctx.workspace.id,
    'AR_ADJ',
    input['adj_code'],
  );

  const insRes = await client.query(
    `INSERT INTO print_ar_adjustments (
       workspace_id, adj_code, order_id, opening_balance_id,
       customer_id, customer_name, ledger_scope,
       adjustment_type, delta_amount, reference_code, reason, recorded_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      ctx.workspace.id,
      adjCode,
      orderId,
      openingBalanceId,
      customerId,
      customerName,
      scope,
      adjType,
      rawDelta,
      typeof input['reference_code'] === 'string'
        ? input['reference_code'].trim() || null
        : null,
      reason,
      ctx.user.id,
    ],
  );

  if (orderId) {
    await recomputeOrderReceivableState(client, ctx.workspace.id, orderId);
  } else if (openingBalanceId) {
    await recomputeOpeningBalanceState(
      client,
      ctx.workspace.id,
      openingBalanceId,
    );
  }

  const adj = mapArAdjustmentRow(insRes.rows[0]!);
  await recordAuditEvent(client, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: 'printquote.ar_adjustment.create',
    entityType: 'print_ar_adjustment',
    entityId: adj.id,
    requestId,
    metadata: {
      adj_code: adj.adj_code,
      adjustment_type: adj.adjustment_type,
      delta_amount: adj.delta_amount,
      reason,
    },
  });

  return adj;
}

export async function voidArTransactionTx(
  client: pg.PoolClient,
  ctx: AuthenticatedContext,
  arTxId: string,
  input: Record<string, unknown>,
  requestId: string,
): Promise<PrintArTransactionData> {
  const reason = requireNonEmptyReason(
    input['reason'],
    'Lý do hủy/đảo bút toán thu khách',
  );
  const txRes = await client.query(
    `SELECT * FROM print_ar_transactions WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [arTxId, ctx.workspace.id],
  );
  const orig = txRes.rows[0];
  if (!orig) {
    throw new AuthError('NOT_FOUND', 'Không tìm thấy phiếu thu khách.', 404);
  }
  if (orig['status'] !== LedgerTxStatus.POSTED) {
    throw new AuthError('CONFLICT', 'Phiếu này đã bị hủy trước đó.', 409);
  }
  if (orig['tx_kind'] !== ArTransactionKind.RECEIPT) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Chỉ hỗ trợ đảo bút toán trực tiếp cho phiếu thu (RECEIPT).',
      400,
    );
  }
  if (toInt(orig['refunded_unallocated_amount'], 0) > 0) {
    throw new AuthError(
      'CONFLICT',
      'Phiếu thu này đã có phần tiền dư được chi hoàn cho khách nên không thể hủy ngang.',
      409,
    );
  }

  await client.query(
    `UPDATE print_ar_transactions
     SET status = 'VOIDED',
         void_reason = $1,
         voided_at = now(),
         voided_by = $2
     WHERE id = $3 AND workspace_id = $4`,
    [reason, ctx.user.id, arTxId, ctx.workspace.id],
  );

  const revCode = await allocateNextLedgerCode(
    client,
    ctx.workspace.id,
    'AR_TX',
  );
  const revRes = await client.query(
    `INSERT INTO print_ar_transactions (
       workspace_id, tx_code, customer_id, customer_name, ledger_scope,
       tx_kind, amount, allocated_amount, refunded_unallocated_amount, unallocated_amount,
       payment_method, occurred_at, note, status, reversal_of_tx_id, recorded_by
     ) VALUES (
       $1, $2, $3, $4, $5,
       'REVERSAL', $6, $7, 0, $8,
       $9, now(), $10, 'POSTED', $11, $12
     ) RETURNING *`,
    [
      ctx.workspace.id,
      revCode,
      orig['customer_id'] ?? null,
      String(orig['customer_name']),
      String(orig['ledger_scope']),
      toInt(orig['amount'], 0),
      toInt(orig['allocated_amount'], 0),
      toInt(orig['unallocated_amount'], 0),
      orig['payment_method'],
      `Đảo bút toán phiếu ${String(orig['tx_code'])}: ${reason}`,
      arTxId,
      ctx.user.id,
    ],
  );
  const revTx = mapArTransactionRow(revRes.rows[0]!);

  const origAllocs = await client.query(
    `SELECT * FROM print_ar_allocations
     WHERE workspace_id = $1 AND ar_transaction_id = $2 AND direction = 'APPLY'`,
    [ctx.workspace.id, arTxId],
  );

  const orderIdsToRefresh = new Set<string>();
  const obIdsToRefresh = new Set<string>();

  for (const a of origAllocs.rows) {
    await client.query(
      `INSERT INTO print_ar_allocations (
         workspace_id, ar_transaction_id, order_id, opening_balance_id,
         direction, amount, note, recorded_by
       ) VALUES ($1, $2, $3, $4, 'UNAPPLY_REVERSAL', $5, $6, $7)`,
      [
        ctx.workspace.id,
        revTx.id,
        a['order_id'] ?? null,
        a['opening_balance_id'] ?? null,
        toInt(a['amount'], 0),
        reason,
        ctx.user.id,
      ],
    );
    if (a['order_id']) orderIdsToRefresh.add(String(a['order_id']));
    if (a['opening_balance_id']) {
      obIdsToRefresh.add(String(a['opening_balance_id']));
    }
  }

  for (const oid of [...orderIdsToRefresh].sort()) {
    await recomputeOrderReceivableState(client, ctx.workspace.id, oid);
  }
  for (const obid of [...obIdsToRefresh].sort()) {
    await recomputeOpeningBalanceState(client, ctx.workspace.id, obid);
  }

  await recordAuditEvent(client, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: 'printquote.ar_receipt.void',
    entityType: 'print_ar_transaction',
    entityId: arTxId,
    requestId,
    metadata: { reversal_tx_code: revTx.tx_code, reason },
  });

  await syncPrintLedgerToFinanceTx(client, {
    workspaceId: ctx.workspace.id,
    fallbackOwnerUserId: ctx.user.id,
    direction: 'expense',
    categoryName: 'Hoàn / Đảo phiếu thu in ấn',
    amountVnd: toInt(orig['amount'], 0),
    occurredAt: revTx.occurred_at,
    operationKey: `pq_ar_void:${arTxId}`,
    note: `Đảo phiếu thu in ấn ${String(orig['tx_code'])} (${revTx.tx_code}) — Lý do: ${reason}`,
  });

  return revTx;
}

// ============================================================================
// 3. WORKSHOP PAYABLES (AP — §D)
// ============================================================================

interface ParsedApTargetAllocation {
  workshopJobId: string | null;
  openingBalanceId: string | null;
  amount: number;
  note: string | null;
}

function parseApAllocationsInput(raw: unknown): ParsedApTargetAllocation[] {
  if (!Array.isArray(raw)) return [];
  const list: ParsedApTargetAllocation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const amt = assertSafePositiveVnd(
      toInt(rec['amount'], 0),
      'Số tiền phân bổ trả xưởng',
    );
    const workshopJobId =
      typeof rec['workshop_job_id'] === 'string' &&
      rec['workshop_job_id'].trim()
        ? rec['workshop_job_id'].trim()
        : null;
    const openingBalanceId =
      typeof rec['opening_balance_id'] === 'string' &&
      rec['opening_balance_id'].trim()
        ? rec['opening_balance_id'].trim()
        : null;
    if (
      (workshopJobId && openingBalanceId) ||
      (!workshopJobId && !openingBalanceId)
    ) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Mỗi dòng phân bổ chi xưởng phải chọn đúng 1 đích: Phiếu đặt xưởng (workshop_job_id) hoặc Công nợ đầu kỳ (opening_balance_id).',
        400,
      );
    }
    list.push({
      workshopJobId,
      openingBalanceId,
      amount: amt,
      note: typeof rec['note'] === 'string' ? rec['note'].trim() || null : null,
    });
  }
  return list;
}

async function applyApAllocationsInternal(
  client: pg.PoolClient,
  params: {
    workspaceId: string;
    apTxId: string;
    vendorId: string;
    ledgerScope: string;
    allocations: ParsedApTargetAllocation[];
    actorId: string;
  },
): Promise<void> {
  const jobIds = [
    ...new Set(
      params.allocations
        .map((a) => a.workshopJobId)
        .filter((id): id is string => Boolean(id)),
    ),
  ].sort();
  const obIds = [
    ...new Set(
      params.allocations
        .map((a) => a.openingBalanceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ].sort();

  const lockedJobs = new Map<string, PrintWorkshopJobData>();
  for (const jid of jobIds) {
    const job = await recomputeWorkshopJobState(
      client,
      params.workspaceId,
      jid,
    );
    lockedJobs.set(jid, job);
  }

  const lockedObs = new Map<string, PrintOpeningBalanceData>();
  for (const obid of obIds) {
    const ob = await recomputeOpeningBalanceState(
      client,
      params.workspaceId,
      obid,
    );
    lockedObs.set(obid, ob);
  }

  const runningByTarget = new Map<string, number>();

  for (const alloc of params.allocations) {
    if (alloc.workshopJobId) {
      const job = lockedJobs.get(alloc.workshopJobId);
      if (!job) {
        throw new AuthError(
          'NOT_FOUND',
          'Không tìm thấy phiếu đặt xưởng phân bổ.',
          404,
        );
      }
      if (job.vendor_id !== params.vendorId) {
        throw new AuthError(
          'COUNTERPARTY_MISMATCH',
          `Phiếu đặt xưởng ${job.job_code} thuộc xưởng khác, không thể phân bổ từ cùng một phiếu chi.`,
          400,
        );
      }
      if (job.ledger_scope !== params.ledgerScope) {
        throw new AuthError(
          'SCOPE_MISMATCH',
          `Không thể phân bổ phiếu chi nhóm ${params.ledgerScope} sang phiếu đặt xưởng nhóm ${job.ledger_scope}.`,
          400,
        );
      }
      if (job.cost_status !== WorkshopJobCostStatus.CONFIRMED) {
        throw new AuthError(
          'JOB_COST_NOT_CONFIRMED',
          `Phiếu đặt xưởng ${job.job_code} chưa xác nhận chi phí thực tế nên chưa tạo Phải trả hợp lệ. Hãy lưu khoản chi vào Tạm ứng xưởng chưa phân bổ, sau khi xác nhận chi phí xưởng thì phân bổ vào phiếu.`,
          409,
        );
      }
      const nextCum =
        (runningByTarget.get(`J:${alloc.workshopJobId}`) ?? 0) + alloc.amount;
      if (nextCum > job.remaining_payable_amount) {
        throw new AuthError(
          'OVER_ALLOCATION',
          `Số tiền phân bổ (${nextCum} VND) vượt quá Còn phải trả (${job.remaining_payable_amount} VND) của phiếu ${job.job_code}. Phần dư phải để ở Tạm ứng xưởng chưa phân bổ.`,
          400,
        );
      }
      runningByTarget.set(`J:${alloc.workshopJobId}`, nextCum);
    } else if (alloc.openingBalanceId) {
      const ob = lockedObs.get(alloc.openingBalanceId);
      if (!ob || ob.direction !== OpeningBalanceDirection.VENDOR_PAYABLE) {
        throw new AuthError(
          'NOT_FOUND',
          'Không tìm thấy công nợ phải trả đầu kỳ.',
          404,
        );
      }
      if (ob.vendor_id !== params.vendorId) {
        throw new AuthError(
          'COUNTERPARTY_MISMATCH',
          `Số dư đầu kỳ ${ob.doc_code} thuộc xưởng khác.`,
          400,
        );
      }
      if (ob.ledger_scope !== params.ledgerScope) {
        throw new AuthError(
          'SCOPE_MISMATCH',
          `Không thể phân bổ phiếu chi nhóm ${params.ledgerScope} sang số dư đầu kỳ nhóm ${ob.ledger_scope}.`,
          400,
        );
      }
      const nextCum =
        (runningByTarget.get(`OB:${alloc.openingBalanceId}`) ?? 0) +
        alloc.amount;
      if (nextCum > ob.remaining_amount) {
        throw new AuthError(
          'OVER_ALLOCATION',
          `Số tiền phân bổ (${nextCum} VND) vượt quá Còn phải trả (${ob.remaining_amount} VND) của ${ob.doc_code}.`,
          400,
        );
      }
      runningByTarget.set(`OB:${alloc.openingBalanceId}`, nextCum);
    }
  }

  for (const alloc of params.allocations) {
    const job = alloc.workshopJobId
      ? lockedJobs.get(alloc.workshopJobId)
      : undefined;
    await client.query(
      `INSERT INTO print_ap_allocations (
         workspace_id, ap_transaction_id, workshop_job_id, order_id, opening_balance_id,
         direction, amount, note, recorded_by
       ) VALUES ($1, $2, $3, $4, $5, 'APPLY', $6, $7, $8)`,
      [
        params.workspaceId,
        params.apTxId,
        alloc.workshopJobId,
        job?.order_id ?? null,
        alloc.openingBalanceId,
        alloc.amount,
        alloc.note,
        params.actorId,
      ],
    );
  }

  for (const jid of jobIds) {
    await recomputeWorkshopJobState(client, params.workspaceId, jid);
  }
  for (const obid of obIds) {
    await recomputeOpeningBalanceState(client, params.workspaceId, obid);
  }
}

export async function createVendorPayoutTx(
  client: pg.PoolClient,
  ctx: AuthenticatedContext,
  input: Record<string, unknown>,
  requestId: string,
): Promise<PrintApTransactionData> {
  const vendorId =
    typeof input['vendor_id'] === 'string' ? input['vendor_id'].trim() : '';
  if (!vendorId) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Phải chọn xưởng / nhà in nhận tiền (vendor_id).',
      400,
    );
  }
  const vRes = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM print_vendors WHERE id = $1 AND workspace_id = $2`,
    [vendorId, ctx.workspace.id],
  );
  if (!vRes.rows[0]) {
    throw new AuthError('NOT_FOUND', 'Không tìm thấy xưởng / nhà in.', 404);
  }

  const amount = assertSafePositiveVnd(
    toInt(input['amount'], 0),
    'Số tiền phiếu chi xưởng',
  );
  const allocations = parseApAllocationsInput(input['allocations']);
  const totalAllocated = allocations.reduce((s, a) => s + a.amount, 0);
  if (totalAllocated > amount) {
    throw new AuthError(
      'VALIDATION_ERROR',
      `Tổng phân bổ (${totalAllocated} VND) vượt quá số tiền phiếu chi xưởng (${amount} VND).`,
      400,
    );
  }

  const scope = normalizeLedgerScopeInput(input['ledger_scope']);
  const referenceCode =
    typeof input['reference_code'] === 'string' &&
    input['reference_code'].trim()
      ? input['reference_code'].trim()
      : null;

  await checkDuplicateReferenceCode(client, {
    workspaceId: ctx.workspace.id,
    table: 'print_ap_transactions',
    referenceCode,
    confirmDuplicate: input['confirm_duplicate_reference'] === true,
  });

  const unallocatedAmount = amount - totalAllocated;
  assertTransactionConservationInvariant({
    label: 'createVendorPayout',
    amount,
    allocatedAmount: totalAllocated,
    refundedUnallocatedAmount: 0,
    unallocatedAmount,
  });

  const subtypeRaw = input['payout_subtype'];
  const subtype: ApPayoutSubtypeType =
    subtypeRaw === ApPayoutSubtype.ADVANCE ||
    subtypeRaw === ApPayoutSubtype.JOB_PAYMENT ||
    subtypeRaw === ApPayoutSubtype.SETTLEMENT ||
    subtypeRaw === ApPayoutSubtype.OPENING_ADVANCE
      ? subtypeRaw
      : totalAllocated === 0
        ? ApPayoutSubtype.ADVANCE
        : ApPayoutSubtype.JOB_PAYMENT;

  const txCode = await allocateNextLedgerCode(
    client,
    ctx.workspace.id,
    'AP_TX',
    input['tx_code'],
  );

  const txRes = await client.query(
    `INSERT INTO print_ap_transactions (
       workspace_id, tx_code, vendor_id, vendor_name, ledger_scope,
       tx_kind, payout_subtype, amount, allocated_amount,
       refunded_unallocated_amount, unallocated_amount,
       payment_method, occurred_at, reference_code, attachment_url, note,
       status, reconciled_from_order_id,
       source_sheet_name, source_tab_name, source_row_number, recorded_by
     ) VALUES (
       $1, $2, $3, $4, $5,
       'PAYOUT', $6, $7, $8,
       0, $9,
       $10, $11, $12, $13, $14,
       'POSTED', $15,
       $16, $17, $18, $19
     ) RETURNING *`,
    [
      ctx.workspace.id,
      txCode,
      vRes.rows[0].id,
      vRes.rows[0].name,
      scope,
      subtype,
      amount,
      totalAllocated,
      unallocatedAmount,
      normalizePaymentMethod(input['payment_method']),
      input['occurred_at']
        ? new Date(String(input['occurred_at']))
        : new Date(),
      referenceCode,
      typeof input['attachment_url'] === 'string'
        ? input['attachment_url'].trim() || null
        : null,
      typeof input['note'] === 'string' ? input['note'].trim() || null : null,
      typeof input['reconciled_from_order_id'] === 'string'
        ? input['reconciled_from_order_id']
        : null,
      typeof input['source_sheet_name'] === 'string'
        ? input['source_sheet_name'].trim() || null
        : null,
      typeof input['source_tab_name'] === 'string'
        ? input['source_tab_name'].trim() || null
        : null,
      typeof input['source_row_number'] === 'number'
        ? toInt(input['source_row_number'], 0)
        : null,
      ctx.user.id,
    ],
  );

  const tx = mapApTransactionRow(txRes.rows[0]!);

  if (allocations.length > 0) {
    await applyApAllocationsInternal(client, {
      workspaceId: ctx.workspace.id,
      apTxId: tx.id,
      vendorId: tx.vendor_id,
      ledgerScope: tx.ledger_scope,
      allocations,
      actorId: ctx.user.id,
    });
  }

  const allocRows = await client.query(
    `SELECT a.*, j.job_code, o.order_code, ob.doc_code AS opening_doc_code
     FROM print_ap_allocations a
     LEFT JOIN print_workshop_jobs j ON j.id = a.workshop_job_id
     LEFT JOIN print_orders o ON o.id = a.order_id
     LEFT JOIN print_opening_balances ob ON ob.id = a.opening_balance_id
     WHERE a.workspace_id = $1 AND a.ap_transaction_id = $2
     ORDER BY a.created_at ASC`,
    [ctx.workspace.id, tx.id],
  );
  tx.allocations = allocRows.rows.map(mapApAllocationRow);

  await recordAuditEvent(client, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: 'printquote.ap_payout.create',
    entityType: 'print_ap_transaction',
    entityId: tx.id,
    requestId,
    metadata: {
      tx_code: tx.tx_code,
      vendor_id: tx.vendor_id,
      amount: tx.amount,
      allocated_amount: tx.allocated_amount,
      unallocated_amount: tx.unallocated_amount,
    },
  });

  const jobCodesLabel = tx.allocations
    ?.map((a) => a.job_code || a.order_code)
    .filter(Boolean)
    .join(', ');
  await syncPrintLedgerToFinanceTx(client, {
    workspaceId: ctx.workspace.id,
    fallbackOwnerUserId: ctx.user.id,
    direction: 'expense',
    categoryName: 'Chi trả xưởng gia công in',
    amountVnd: tx.amount,
    occurredAt: tx.occurred_at,
    operationKey: `pq_ap_payout:${tx.id}`,
    note: `Phiếu chi xưởng in ${tx.tx_code} — ${tx.vendor_name}${jobCodesLabel ? ` (${jobCodesLabel})` : ''}${tx.note ? ` — ${tx.note}` : ''}`,
  });

  return tx;
}

export async function allocateVendorPayoutTx(
  client: pg.PoolClient,
  ctx: AuthenticatedContext,
  apTxId: string,
  input: Record<string, unknown>,
  requestId: string,
): Promise<PrintApTransactionData> {
  const txRes = await client.query(
    `SELECT * FROM print_ap_transactions WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [apTxId, ctx.workspace.id],
  );
  const existing = txRes.rows[0];
  if (!existing) {
    throw new AuthError('NOT_FOUND', 'Không tìm thấy phiếu chi xưởng.', 404);
  }
  if (
    existing['status'] !== LedgerTxStatus.POSTED ||
    existing['tx_kind'] !== ApTransactionKind.PAYOUT
  ) {
    throw new AuthError(
      'CONFLICT',
      'Chỉ có thể phân bổ từ phiếu chi xưởng đang có hiệu lực (POSTED).',
      409,
    );
  }

  const allocations = parseApAllocationsInput(input['allocations']);
  if (allocations.length === 0) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Phải chọn ít nhất 1 phiếu đặt xưởng hoặc số dư đầu kỳ để phân bổ.',
      400,
    );
  }

  const addAlloc = allocations.reduce((s, a) => s + a.amount, 0);
  const currentUnalloc = toInt(existing['unallocated_amount'], 0);
  if (addAlloc > currentUnalloc) {
    throw new AuthError(
      'OVER_ALLOCATION',
      `Số tiền phân bổ thêm (${addAlloc} VND) vượt quá số dư tạm ứng chưa phân bổ của phiếu chi (${currentUnalloc} VND).`,
      400,
    );
  }

  const nextAllocated = toInt(existing['allocated_amount'], 0) + addAlloc;
  const nextUnallocated = currentUnalloc - addAlloc;
  const refundedUnalloc = toInt(existing['refunded_unallocated_amount'], 0);

  assertTransactionConservationInvariant({
    label: `allocateVendorPayout(${String(existing['tx_code'])})`,
    amount: toInt(existing['amount'], 0),
    allocatedAmount: nextAllocated,
    refundedUnallocatedAmount: refundedUnalloc,
    unallocatedAmount: nextUnallocated,
  });

  await applyApAllocationsInternal(client, {
    workspaceId: ctx.workspace.id,
    apTxId,
    vendorId: String(existing['vendor_id']),
    ledgerScope: String(existing['ledger_scope']),
    allocations,
    actorId: ctx.user.id,
  });

  const updRes = await client.query(
    `UPDATE print_ap_transactions
     SET allocated_amount = $1,
         unallocated_amount = $2
     WHERE id = $3 AND workspace_id = $4
     RETURNING *`,
    [nextAllocated, nextUnallocated, apTxId, ctx.workspace.id],
  );
  const updated = mapApTransactionRow(updRes.rows[0]!);

  const allocRows = await client.query(
    `SELECT a.*, j.job_code, o.order_code, ob.doc_code AS opening_doc_code
     FROM print_ap_allocations a
     LEFT JOIN print_workshop_jobs j ON j.id = a.workshop_job_id
     LEFT JOIN print_orders o ON o.id = a.order_id
     LEFT JOIN print_opening_balances ob ON ob.id = a.opening_balance_id
     WHERE a.workspace_id = $1 AND a.ap_transaction_id = $2
     ORDER BY a.created_at ASC`,
    [ctx.workspace.id, apTxId],
  );
  updated.allocations = allocRows.rows.map(mapApAllocationRow);

  await recordAuditEvent(client, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: 'printquote.ap_payout.allocate',
    entityType: 'print_ap_transaction',
    entityId: apTxId,
    requestId,
    metadata: { added_allocated: addAlloc, unallocated_left: nextUnallocated },
  });

  return updated;
}

export async function createVendorRefundTx(
  client: pg.PoolClient,
  ctx: AuthenticatedContext,
  input: Record<string, unknown>,
  requestId: string,
): Promise<PrintApTransactionData> {
  const amount = assertSafePositiveVnd(
    toInt(input['amount'], 0),
    'Số tiền xưởng hoàn lại',
  );
  const reason = requireNonEmptyReason(
    input['reason'] ?? input['note'],
    'Lý do xưởng hoàn tiền',
  );
  const referenceCode =
    typeof input['reference_code'] === 'string' &&
    input['reference_code'].trim()
      ? input['reference_code'].trim()
      : null;

  await checkDuplicateReferenceCode(client, {
    workspaceId: ctx.workspace.id,
    table: 'print_ap_transactions',
    referenceCode,
    confirmDuplicate: input['confirm_duplicate_reference'] === true,
  });

  const source =
    input['source'] === 'JOB_OVERPAYMENT'
      ? 'JOB_OVERPAYMENT'
      : 'UNALLOCATED_ADVANCE';
  const txCode = await allocateNextLedgerCode(
    client,
    ctx.workspace.id,
    'AP_TX',
    input['tx_code'],
  );

  if (source === 'JOB_OVERPAYMENT') {
    const jobId =
      typeof input['workshop_job_id'] === 'string'
        ? input['workshop_job_id'].trim()
        : '';
    if (!jobId) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Phải chọn phiếu đặt xưởng (workshop_job_id) khi nhận tiền hoàn trên phiếu xưởng trả thừa.',
        400,
      );
    }
    const job = await recomputeWorkshopJobState(
      client,
      ctx.workspace.id,
      jobId,
    );
    if (!job.vendor_id || !job.vendor_name) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Phiếu đặt xưởng chưa gắn nhà in.',
        400,
      );
    }
    if (amount > job.vendor_overpaid_credit_amount) {
      throw new AuthError(
        'VALIDATION_ERROR',
        `Số tiền xưởng hoàn (${amount} VND) vượt quá khoản đã chi vượt phải trả hợp lệ (${job.vendor_overpaid_credit_amount} VND) trên phiếu ${job.job_code}.`,
        400,
      );
    }

    const txRes = await client.query(
      `INSERT INTO print_ap_transactions (
         workspace_id, tx_code, vendor_id, vendor_name, ledger_scope,
         tx_kind, amount, allocated_amount, refunded_unallocated_amount, unallocated_amount,
         payment_method, occurred_at, reference_code, note, status, recorded_by
       ) VALUES (
         $1, $2, $3, $4, $5,
         'VENDOR_REFUND', $6, $6, 0, 0,
         $7, $8, $9, $10, 'POSTED', $11
       ) RETURNING *`,
      [
        ctx.workspace.id,
        txCode,
        job.vendor_id,
        job.vendor_name,
        job.ledger_scope,
        amount,
        normalizePaymentMethod(input['payment_method']),
        input['occurred_at']
          ? new Date(String(input['occurred_at']))
          : new Date(),
        referenceCode,
        reason,
        ctx.user.id,
      ],
    );
    const tx = mapApTransactionRow(txRes.rows[0]!);

    await client.query(
      `INSERT INTO print_ap_allocations (
         workspace_id, ap_transaction_id, workshop_job_id, order_id,
         direction, amount, note, recorded_by
       ) VALUES ($1, $2, $3, $4, 'VENDOR_REFUND_RELEASE', $5, $6, $7)`,
      [
        ctx.workspace.id,
        tx.id,
        jobId,
        job.order_id,
        amount,
        reason,
        ctx.user.id,
      ],
    );

    await recomputeWorkshopJobState(client, ctx.workspace.id, jobId);

    await recordAuditEvent(client, {
      workspaceId: ctx.workspace.id,
      actorUserId: ctx.user.id,
      action: 'printquote.ap_vendor_refund.create',
      entityType: 'print_ap_transaction',
      entityId: tx.id,
      requestId,
      metadata: { tx_code: tx.tx_code, source, workshop_job_id: jobId, amount },
    });

    return tx;
  }

  const vendorId =
    typeof input['vendor_id'] === 'string' ? input['vendor_id'].trim() : '';
  if (!vendorId) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Phải chọn xưởng / nhà in hoàn tiền tạm ứng.',
      400,
    );
  }
  const vRes = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM print_vendors WHERE id = $1 AND workspace_id = $2`,
    [vendorId, ctx.workspace.id],
  );
  if (!vRes.rows[0]) {
    throw new AuthError('NOT_FOUND', 'Không tìm thấy xưởng / nhà in.', 404);
  }

  const scope = normalizeLedgerScopeInput(input['ledger_scope']);
  const advRes = await client.query(
    `SELECT * FROM print_ap_transactions
     WHERE workspace_id = $1
       AND vendor_id = $2
       AND ledger_scope = $3
       AND tx_kind = 'PAYOUT'
       AND status = 'POSTED'
       AND unallocated_amount > 0
     ORDER BY occurred_at ASC, id ASC
     FOR UPDATE`,
    [ctx.workspace.id, vendorId, scope],
  );

  const availableAdv = advRes.rows.reduce(
    (s, r) => s + toInt(r['unallocated_amount'], 0),
    0,
  );
  if (amount > availableAdv) {
    throw new AuthError(
      'VALIDATION_ERROR',
      `Số tiền xưởng hoàn (${amount} VND) vượt quá số dư tạm ứng chưa phân bổ của xưởng (${availableAdv} VND).`,
      400,
    );
  }

  let leftToConsume = amount;
  for (const r of advRes.rows) {
    if (leftToConsume <= 0) break;
    const rowUnalloc = toInt(r['unallocated_amount'], 0);
    const take = Math.min(leftToConsume, rowUnalloc);
    const nextRefUnalloc = toInt(r['refunded_unallocated_amount'], 0) + take;
    const nextUnalloc = rowUnalloc - take;
    assertTransactionConservationInvariant({
      label: `consumeVendorAdvance(${String(r['tx_code'])})`,
      amount: toInt(r['amount'], 0),
      allocatedAmount: toInt(r['allocated_amount'], 0),
      refundedUnallocatedAmount: nextRefUnalloc,
      unallocatedAmount: nextUnalloc,
    });
    await client.query(
      `UPDATE print_ap_transactions
       SET refunded_unallocated_amount = $1,
           unallocated_amount = $2
       WHERE id = $3 AND workspace_id = $4`,
      [nextRefUnalloc, nextUnalloc, r['id'], ctx.workspace.id],
    );
    leftToConsume -= take;
  }

  const txRes = await client.query(
    `INSERT INTO print_ap_transactions (
       workspace_id, tx_code, vendor_id, vendor_name, ledger_scope,
       tx_kind, amount, allocated_amount, refunded_unallocated_amount, unallocated_amount,
       payment_method, occurred_at, reference_code, note, status, recorded_by
     ) VALUES (
       $1, $2, $3, $4, $5,
       'VENDOR_REFUND', $6, 0, $6, 0,
       $7, $8, $9, $10, 'POSTED', $11
     ) RETURNING *`,
    [
      ctx.workspace.id,
      txCode,
      vRes.rows[0].id,
      vRes.rows[0].name,
      scope,
      amount,
      normalizePaymentMethod(input['payment_method']),
      input['occurred_at']
        ? new Date(String(input['occurred_at']))
        : new Date(),
      referenceCode,
      reason,
      ctx.user.id,
    ],
  );

  const tx = mapApTransactionRow(txRes.rows[0]!);
  await recordAuditEvent(client, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: 'printquote.ap_vendor_refund.create',
    entityType: 'print_ap_transaction',
    entityId: tx.id,
    requestId,
    metadata: { tx_code: tx.tx_code, source, vendor_id: vendorId, amount },
  });

  return tx;
}

export async function createApAdjustmentTx(
  client: pg.PoolClient,
  ctx: AuthenticatedContext,
  input: Record<string, unknown>,
  requestId: string,
): Promise<PrintApAdjustmentData> {
  const reason = requireNonEmptyReason(
    input['reason'],
    'Lý do điều chỉnh phải trả xưởng',
  );
  const adjType = (input['adjustment_type'] ??
    ApAdjustmentType.DEFECT_DEDUCTION) as ApAdjustmentTypeVal;
  const rawDelta = toInt(input['delta_amount'], 0);
  if (rawDelta === 0) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Giá trị điều chỉnh (delta_amount) phải khác 0 VND.',
      400,
    );
  }
  if (
    (adjType === ApAdjustmentType.DISCOUNT ||
      adjType === ApAdjustmentType.DEFECT_DEDUCTION) &&
    rawDelta > 0
  ) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Chiết khấu xưởng / khấu trừ lỗi in phải có delta_amount âm (giảm phải trả).',
      400,
    );
  }
  if (adjType === ApAdjustmentType.SURCHARGE && rawDelta < 0) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Phụ phí xưởng phải có delta_amount dương (tăng phải trả).',
      400,
    );
  }

  const jobId =
    typeof input['workshop_job_id'] === 'string' &&
    input['workshop_job_id'].trim()
      ? input['workshop_job_id'].trim()
      : null;
  const openingBalanceId =
    typeof input['opening_balance_id'] === 'string' &&
    input['opening_balance_id'].trim()
      ? input['opening_balance_id'].trim()
      : null;

  if ((jobId && openingBalanceId) || (!jobId && !openingBalanceId)) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Phải chọn đúng 1 đích điều chỉnh: Phiếu đặt xưởng (workshop_job_id) hoặc Công nợ đầu kỳ (opening_balance_id).',
      400,
    );
  }

  let vendorId = '';
  let vendorName = '';
  let orderId: string | null = null;
  let scope = LedgerScope.GENERAL as string;

  if (jobId) {
    const jRes = await client.query(
      `SELECT * FROM print_workshop_jobs WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
      [jobId, ctx.workspace.id],
    );
    const job = jRes.rows[0];
    if (!job) {
      throw new AuthError('NOT_FOUND', 'Không tìm thấy phiếu đặt xưởng.', 404);
    }
    if (
      job['cost_status'] !== WorkshopJobCostStatus.CONFIRMED ||
      !job['vendor_id']
    ) {
      throw new AuthError(
        'JOB_COST_NOT_CONFIRMED',
        'Chỉ điều chỉnh công nợ phải trả trên phiếu đặt xưởng đã xác nhận chi phí và gắn nhà in.',
        409,
      );
    }
    vendorId = String(job['vendor_id']);
    vendorName = String(job['vendor_name']);
    orderId = String(job['order_id']);
    scope = normalizeLedgerScopeInput(job['ledger_scope']);
  } else if (openingBalanceId) {
    const obRes = await client.query(
      `SELECT * FROM print_opening_balances WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
      [openingBalanceId, ctx.workspace.id],
    );
    const ob = obRes.rows[0];
    if (!ob || ob['direction'] !== OpeningBalanceDirection.VENDOR_PAYABLE) {
      throw new AuthError(
        'NOT_FOUND',
        'Không tìm thấy công nợ phải trả đầu kỳ.',
        404,
      );
    }
    vendorId = String(ob['vendor_id']);
    vendorName = String(ob['vendor_name']);
    scope = normalizeLedgerScopeInput(ob['ledger_scope']);
  }

  const adjCode = await allocateNextLedgerCode(
    client,
    ctx.workspace.id,
    'AP_ADJ',
    input['adj_code'],
  );

  const insRes = await client.query(
    `INSERT INTO print_ap_adjustments (
       workspace_id, adj_code, workshop_job_id, order_id, opening_balance_id,
       vendor_id, vendor_name, ledger_scope,
       adjustment_type, delta_amount, reference_code, reason, recorded_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      ctx.workspace.id,
      adjCode,
      jobId,
      orderId,
      openingBalanceId,
      vendorId,
      vendorName,
      scope,
      adjType,
      rawDelta,
      typeof input['reference_code'] === 'string'
        ? input['reference_code'].trim() || null
        : null,
      reason,
      ctx.user.id,
    ],
  );

  if (jobId && orderId) {
    await recomputeWorkshopJobState(client, ctx.workspace.id, jobId);
    await syncOrderFromWorkshopJobs(client, {
      workspaceId: ctx.workspace.id,
      orderId,
      actorId: ctx.user.id,
      note: `Điều chỉnh AP ${adjCode}: ${reason}`,
    });
  } else if (openingBalanceId) {
    await recomputeOpeningBalanceState(
      client,
      ctx.workspace.id,
      openingBalanceId,
    );
  }

  const adj = mapApAdjustmentRow(insRes.rows[0]!);
  await recordAuditEvent(client, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: 'printquote.ap_adjustment.create',
    entityType: 'print_ap_adjustment',
    entityId: adj.id,
    requestId,
    metadata: {
      adj_code: adj.adj_code,
      delta_amount: adj.delta_amount,
      reason,
    },
  });

  return adj;
}

export async function voidApTransactionTx(
  client: pg.PoolClient,
  ctx: AuthenticatedContext,
  apTxId: string,
  input: Record<string, unknown>,
  requestId: string,
): Promise<PrintApTransactionData> {
  const reason = requireNonEmptyReason(
    input['reason'],
    'Lý do hủy/đảo phiếu chi xưởng',
  );
  const txRes = await client.query(
    `SELECT * FROM print_ap_transactions WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [apTxId, ctx.workspace.id],
  );
  const orig = txRes.rows[0];
  if (!orig) {
    throw new AuthError('NOT_FOUND', 'Không tìm thấy phiếu chi xưởng.', 404);
  }
  if (orig['status'] !== LedgerTxStatus.POSTED) {
    throw new AuthError('CONFLICT', 'Phiếu chi này đã bị hủy trước đó.', 409);
  }
  if (orig['tx_kind'] !== ApTransactionKind.PAYOUT) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Chỉ hỗ trợ đảo bút toán trực tiếp cho phiếu chi xưởng (PAYOUT).',
      400,
    );
  }
  if (toInt(orig['refunded_unallocated_amount'], 0) > 0) {
    throw new AuthError(
      'CONFLICT',
      'Phiếu chi này đã có phần tiền tạm ứng được nhà in hoàn lại nên không thể hủy ngang.',
      409,
    );
  }

  await client.query(
    `UPDATE print_ap_transactions
     SET status = 'VOIDED',
         void_reason = $1,
         voided_at = now(),
         voided_by = $2
     WHERE id = $3 AND workspace_id = $4`,
    [reason, ctx.user.id, apTxId, ctx.workspace.id],
  );

  const revCode = await allocateNextLedgerCode(
    client,
    ctx.workspace.id,
    'AP_TX',
  );
  const revRes = await client.query(
    `INSERT INTO print_ap_transactions (
       workspace_id, tx_code, vendor_id, vendor_name, ledger_scope,
       tx_kind, amount, allocated_amount, refunded_unallocated_amount, unallocated_amount,
       payment_method, occurred_at, note, status, reversal_of_tx_id, recorded_by
     ) VALUES (
       $1, $2, $3, $4, $5,
       'REVERSAL', $6, $7, 0, $8,
       $9, now(), $10, 'POSTED', $11, $12
     ) RETURNING *`,
    [
      ctx.workspace.id,
      revCode,
      orig['vendor_id'],
      String(orig['vendor_name']),
      String(orig['ledger_scope']),
      toInt(orig['amount'], 0),
      toInt(orig['allocated_amount'], 0),
      toInt(orig['unallocated_amount'], 0),
      orig['payment_method'],
      `Đảo bút toán phiếu chi ${String(orig['tx_code'])}: ${reason}`,
      apTxId,
      ctx.user.id,
    ],
  );
  const revTx = mapApTransactionRow(revRes.rows[0]!);

  const origAllocs = await client.query(
    `SELECT * FROM print_ap_allocations
     WHERE workspace_id = $1 AND ap_transaction_id = $2 AND direction = 'APPLY'`,
    [ctx.workspace.id, apTxId],
  );

  const jobIds = new Set<string>();
  const obIds = new Set<string>();

  for (const a of origAllocs.rows) {
    await client.query(
      `INSERT INTO print_ap_allocations (
         workspace_id, ap_transaction_id, workshop_job_id, order_id, opening_balance_id,
         direction, amount, note, recorded_by
       ) VALUES ($1, $2, $3, $4, $5, 'UNAPPLY_REVERSAL', $6, $7, $8)`,
      [
        ctx.workspace.id,
        revTx.id,
        a['workshop_job_id'] ?? null,
        a['order_id'] ?? null,
        a['opening_balance_id'] ?? null,
        toInt(a['amount'], 0),
        reason,
        ctx.user.id,
      ],
    );
    if (a['workshop_job_id']) jobIds.add(String(a['workshop_job_id']));
    if (a['opening_balance_id']) obIds.add(String(a['opening_balance_id']));
  }

  for (const jid of [...jobIds].sort()) {
    await recomputeWorkshopJobState(client, ctx.workspace.id, jid);
  }
  for (const obid of [...obIds].sort()) {
    await recomputeOpeningBalanceState(client, ctx.workspace.id, obid);
  }

  await recordAuditEvent(client, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: 'printquote.ap_payout.void',
    entityType: 'print_ap_transaction',
    entityId: apTxId,
    requestId,
    metadata: { reversal_tx_code: revTx.tx_code, reason },
  });

  await syncPrintLedgerToFinanceTx(client, {
    workspaceId: ctx.workspace.id,
    fallbackOwnerUserId: ctx.user.id,
    direction: 'income',
    categoryName: 'Hoàn / Đảo phiếu chi xưởng in',
    amountVnd: toInt(orig['amount'], 0),
    occurredAt: revTx.occurred_at,
    operationKey: `pq_ap_void:${apTxId}`,
    note: `Đảo phiếu chi xưởng in ${String(orig['tx_code'])} (${revTx.tx_code}) — Lý do: ${reason}`,
  });

  return revTx;
}

export async function reconcileLegacyVendorNoteTx(
  client: pg.PoolClient,
  ctx: AuthenticatedContext,
  orderId: string,
  input: Record<string, unknown>,
  requestId: string,
): Promise<{
  reconciled: boolean;
  payout?: PrintApTransactionData | undefined;
}> {
  const ordRes = await client.query(
    `SELECT * FROM print_orders WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [orderId, ctx.workspace.id],
  );
  const ord = ordRes.rows[0];
  if (!ord) {
    throw new AuthError('NOT_FOUND', 'Không tìm thấy đơn hàng.', 404);
  }
  if (Boolean(ord['legacy_vendor_paid_reconciled'])) {
    throw new AuthError(
      'CONFLICT',
      'Ghi chú chi xưởng cấp đơn cũ đã được đối soát trước đó.',
      409,
    );
  }

  const reason = requireNonEmptyReason(
    input['reason'],
    'Ghi chú đối soát khoản chi xưởng cũ',
  );
  const action =
    input['action'] === 'DISMISS_NOTE' ? 'DISMISS_NOTE' : 'CREATE_PAYOUT';

  let payout: PrintApTransactionData | undefined;
  if (action === 'CREATE_PAYOUT') {
    const amount = toInt(input['amount'] ?? ord['vendor_paid_amount'], 0);
    payout = await createVendorPayoutTx(
      client,
      ctx,
      {
        ...input,
        amount,
        reconciled_from_order_id: orderId,
        note: reason,
      },
      requestId,
    );
  }

  await client.query(
    `UPDATE print_orders
     SET legacy_vendor_paid_reconciled = true,
         legacy_vendor_paid_reconciled_at = now(),
         legacy_vendor_paid_reconciled_by = $1,
         updated_at = now()
     WHERE id = $2 AND workspace_id = $3`,
    [ctx.user.id, orderId, ctx.workspace.id],
  );

  await recordAuditEvent(client, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: 'printquote.legacy_vendor_note.reconcile',
    entityType: 'print_order',
    entityId: orderId,
    requestId,
    metadata: { action, payout_tx_code: payout?.tx_code ?? null, reason },
  });

  return { reconciled: true, payout };
}

// ============================================================================
// 4. CANCELLED ORDER SETTLEMENT (§E)
// ============================================================================

export async function settleCancelledOrderTx(
  client: pg.PoolClient,
  ctx: AuthenticatedContext,
  orderId: string,
  input: Record<string, unknown>,
  requestId: string,
): Promise<PrintOrderCancellationSettlementData> {
  const reason = requireNonEmptyReason(
    input['reason'],
    'Quyết định / biên bản xử lý đơn hủy',
  );

  const ordCheck = await client.query(
    `SELECT * FROM print_orders WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [orderId, ctx.workspace.id],
  );
  const ordBefore = ordCheck.rows[0];
  if (!ordBefore) {
    throw new AuthError('NOT_FOUND', 'Không tìm thấy đơn hàng.', 404);
  }

  if (
    ordBefore['production_status'] !== PrintProductionStatus.CANCELLED &&
    input['cancel_order'] === true
  ) {
    await client.query(
      `UPDATE print_orders
       SET production_status = 'CANCELLED',
           cancellation_settlement_status = 'PENDING_SETTLEMENT',
           updated_at = now()
       WHERE id = $1 AND workspace_id = $2`,
      [orderId, ctx.workspace.id],
    );
  }

  const state = await recomputeOrderReceivableState(
    client,
    ctx.workspace.id,
    orderId,
  );
  const ord = state.orderRow;
  if (ord['production_status'] !== PrintProductionStatus.CANCELLED) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Chỉ quyết toán hủy cho đơn hàng ở trạng thái CANCELLED.',
      400,
    );
  }

  if (state.pendingLegacyCount > 0) {
    throw new AuthError(
      'LEGACY_AR_RECONCILIATION_REQUIRED',
      `Đơn hủy ${String(ord['order_code'])} đang còn ${state.pendingLegacyCount} phiếu thu/hoàn cũ chờ đối chiếu. Vui lòng đối chiếu và xác nhận vào sổ AR chính thức trước khi lập biên bản quyết toán hủy.`,
      409,
    );
  }

  const holding = state.netAllocatedReceiptAmount;
  const agreedRefund = assertSafeNonNegativeVnd(
    toInt(input['agreed_customer_refund_amount'], -1),
    'Số tiền thỏa thuận hoàn trả khách',
  );
  const retainedFee = assertSafeNonNegativeVnd(
    toInt(input['retained_cancellation_fee'], -1),
    'Phí hủy đơn giữ lại (bù chi phí đã phát sinh)',
  );

  if (agreedRefund + retainedFee !== holding) {
    throw new AuthError(
      'VALIDATION_ERROR',
      `Tổng tiền thỏa thuận hoàn khách (${agreedRefund} VND) + phí hủy giữ lại (${retainedFee} VND) phải khớp chính xác số tiền khách đang giữ trên đơn (${holding} VND).`,
      400,
    );
  }

  const apAllocRes = await client.query<{ paid_sum: string }>(
    `SELECT COALESCE(
       SUM(amount) FILTER (WHERE direction = 'APPLY') -
       SUM(amount) FILTER (WHERE direction IN ('UNAPPLY_REVERSAL', 'VENDOR_REFUND_RELEASE')),
       0
     )::text AS paid_sum
     FROM print_ap_allocations
     WHERE workspace_id = $1 AND order_id = $2`,
    [ctx.workspace.id, orderId],
  );
  const vendorPaidSnapshot =
    toInt(apAllocRes.rows[0]?.paid_sum, 0) ||
    toInt(ord['vendor_paid_amount'], 0);
  const incurredCostSnapshot = Boolean(ord['actual_cost_confirmed'])
    ? toInt(ord['actual_vendor_cost'], 0) +
      toInt(ord['actual_shipping_fee'], 0) +
      toInt(ord['actual_extra_cost'], 0)
    : 0;

  const insRes = await client.query(
    `INSERT INTO print_order_cancellation_settlements (
       workspace_id, order_id,
       customer_paid_holding_snapshot, agreed_customer_refund_amount, retained_cancellation_fee,
       incurred_vendor_cost_snapshot, vendor_paid_snapshot,
       reference_code, reason, settled_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      ctx.workspace.id,
      orderId,
      holding,
      agreedRefund,
      retainedFee,
      incurredCostSnapshot,
      vendorPaidSnapshot,
      typeof input['reference_code'] === 'string'
        ? input['reference_code'].trim() || null
        : null,
      reason,
      ctx.user.id,
    ],
  );

  await client.query(
    `UPDATE print_orders
     SET cancellation_settlement_status = 'SETTLED',
         agreed_customer_refund_amount = $1,
         refunded_after_cancel_amount = 0,
         retained_cancellation_fee = $2,
         updated_at = now()
     WHERE id = $3 AND workspace_id = $4`,
    [agreedRefund, retainedFee, orderId, ctx.workspace.id],
  );

  await recomputeOrderReceivableState(client, ctx.workspace.id, orderId);

  const settlement = mapCancellationSettlementRow(insRes.rows[0]!);
  await recordAuditEvent(client, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: 'printquote.order.cancel_settlement',
    entityType: 'print_order',
    entityId: orderId,
    requestId,
    metadata: {
      holding,
      agreed_customer_refund_amount: agreedRefund,
      retained_cancellation_fee: retainedFee,
      reason,
    },
  });

  return settlement;
}

// ============================================================================
// 5. LEGACY print_order_payments -> OFFICIAL AR RECONCILIATION GATE (0036 QA)
// ============================================================================

export async function refreshOrderPendingLegacyAnomaliesTx(
  client: pg.PoolClient,
  workspaceId: string,
  orderId: string,
): Promise<void> {
  const ordRes = await client.query(
    `SELECT o.*, c.id AS verified_customer_id
     FROM print_orders o
     LEFT JOIN print_customers c ON c.id = o.customer_id AND c.workspace_id = o.workspace_id
     WHERE o.id = $1 AND o.workspace_id = $2`,
    [orderId, workspaceId],
  );
  const ord = ordRes.rows[0];
  if (!ord) return;

  const payTotalsRes = await client.query<{
    rec_sum: string;
    ref_sum: string;
  }>(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE payment_type <> 'REFUND'), 0)::text AS rec_sum,
       COALESCE(SUM(amount) FILTER (WHERE payment_type = 'REFUND'), 0)::text AS ref_sum
     FROM print_order_payments
     WHERE workspace_id = $1 AND order_id = $2`,
    [workspaceId, orderId],
  );
  const arAllocRes = await client.query<{
    apply_sum: string;
    unapply_sum: string;
    refund_sum: string;
  }>(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE direction = 'APPLY'), 0)::text AS apply_sum,
       COALESCE(SUM(amount) FILTER (WHERE direction = 'UNAPPLY_REVERSAL'), 0)::text AS unapply_sum,
       COALESCE(SUM(amount) FILTER (WHERE direction = 'REFUND_RELEASE'), 0)::text AS refund_sum
     FROM print_ar_allocations
     WHERE workspace_id = $1 AND order_id = $2`,
    [workspaceId, orderId],
  );
  const pendingRowsRes = await client.query<{
    reconciliation_id: string;
    payment_type: string;
    amount: string;
  }>(
    `SELECT r.id AS reconciliation_id, p.payment_type, p.amount::text AS amount
     FROM print_legacy_ar_reconciliations r
     JOIN print_order_payments p ON p.id = r.legacy_payment_id
     WHERE r.workspace_id = $1 AND r.order_id = $2 AND r.status IN ('PENDING', 'ON_HOLD')`,
    [workspaceId, orderId],
  );

  const grossReceipts = toInt(payTotalsRes.rows[0]?.rec_sum, 0);
  const grossRefunds = toInt(payTotalsRes.rows[0]?.ref_sum, 0);
  const officialNet = Math.max(
    0,
    toInt(arAllocRes.rows[0]?.apply_sum, 0) -
      toInt(arAllocRes.rows[0]?.unapply_sum, 0) -
      toInt(arAllocRes.rows[0]?.refund_sum, 0),
  );
  const grossQuote = toInt(ord['total_quote_amount'], 0);
  const validRec = toInt(ord['valid_receivable_amount'], grossQuote);
  const prePaid =
    ord['pre0036_total_paid_snapshot'] !== null &&
    ord['pre0036_total_paid_snapshot'] !== undefined
      ? toInt(ord['pre0036_total_paid_snapshot'], 0)
      : toInt(ord['total_paid_amount'], 0);
  const preRem =
    ord['pre0036_remaining_debt_snapshot'] !== null &&
    ord['pre0036_remaining_debt_snapshot'] !== undefined
      ? toInt(ord['pre0036_remaining_debt_snapshot'], 0)
      : Math.max(0, grossQuote - prePaid);

  for (const row of pendingRowsRes.rows) {
    const evalRes = evaluateLegacyPaymentReconciliationAnomalies({
      paymentType: row.payment_type,
      paymentAmount: toInt(row.amount, 0),
      hasValidSameWorkspaceCustomer: Boolean(ord['verified_customer_id']),
      isOrderCancelled:
        ord['production_status'] === PrintProductionStatus.CANCELLED,
      cancellationSettlementStatus: String(
        ord['cancellation_settlement_status'] || 'NOT_APPLICABLE',
      ),
      orderGrossQuoteAmount: grossQuote,
      orderValidReceivableAmount: validRec,
      pre0036TotalPaidSnapshot: prePaid,
      pre0036RemainingDebtSnapshot: preRem,
      orderLegacyGrossReceipts: grossReceipts,
      orderLegacyGrossRefunds: grossRefunds,
      officialArNetAllocatedOnOrder: officialNet,
      balanceDiscrepancyResolved: Boolean(
        ord['legacy_balance_discrepancy_resolved'],
      ),
    });

    await client.query(
      `UPDATE print_legacy_ar_reconciliations
       SET anomaly_codes = $1::jsonb,
           updated_at = now()
       WHERE id = $2 AND workspace_id = $3`,
      [
        JSON.stringify(evalRes.anomalyCodes),
        row.reconciliation_id,
        workspaceId,
      ],
    );
  }
}

export async function linkCustomerToLegacyOrderTx(
  client: pg.PoolClient,
  ctx: AuthenticatedContext,
  orderId: string,
  input: Record<string, unknown>,
  requestId: string,
): Promise<{
  order_id: string;
  order_code: string;
  customer_id: string;
  customer_code: string;
  customer_name: string;
}> {
  if (!isValidUuid(orderId)) {
    throw new AuthError('VALIDATION_ERROR', 'Mã đơn hàng không hợp lệ.', 400);
  }
  const reason = requireNonEmptyReason(
    input['reason'],
    'Lý do gắn khách hàng cho đơn hàng cũ',
  );

  const ordRes = await client.query(
    `SELECT * FROM print_orders WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [orderId, ctx.workspace.id],
  );
  const ord = ordRes.rows[0];
  if (!ord) {
    throw new AuthError('NOT_FOUND', 'Không tìm thấy đơn hàng in ấn.', 404);
  }

  if (ord['customer_id']) {
    throw new AuthError(
      'ORDER_ALREADY_HAS_CUSTOMER',
      `Đơn hàng ${String(ord['order_code'])} đã có mã khách hàng (${String(ord['customer_id'])}), không thể ghi đè tự động.`,
      409,
    );
  }

  const verifiedCustomer = await resolveMandatoryWorkspaceCustomerInTx(
    client,
    ctx.workspace.id,
    {
      explicitCustomerId: input['customer_id'],
      quickCustomer: input['quick_customer'],
    },
  );

  const beforeJson = {
    order_id: orderId,
    order_code: String(ord['order_code']),
    customer_id: null,
    customer_name: String(ord['customer_name']),
    customer_phone: ord['customer_phone'] ?? null,
  };

  await client.query(
    `UPDATE print_orders
     SET customer_id = $1,
         customer_phone = COALESCE(customer_phone, $2),
         customer_address = COALESCE(customer_address, $3),
         updated_at = now()
     WHERE id = $4 AND workspace_id = $5`,
    [
      verifiedCustomer.id,
      verifiedCustomer.phone,
      verifiedCustomer.address,
      orderId,
      ctx.workspace.id,
    ],
  );

  if (ord['quote_id']) {
    await client.query(
      `UPDATE print_quotes
       SET customer_id = COALESCE(customer_id, $1)
       WHERE id = $2 AND workspace_id = $3`,
      [verifiedCustomer.id, String(ord['quote_id']), ctx.workspace.id],
    );
  }

  await refreshOrderPendingLegacyAnomaliesTx(client, ctx.workspace.id, orderId);
  await recomputeOrderReceivableState(client, ctx.workspace.id, orderId);

  const afterJson = {
    order_id: orderId,
    order_code: String(ord['order_code']),
    customer_id: verifiedCustomer.id,
    customer_code: verifiedCustomer.code,
    linked_customer_name: verifiedCustomer.name,
  };

  await client.query(
    `INSERT INTO print_legacy_ar_reconciliation_history (
       workspace_id, reconciliation_id, legacy_payment_id, order_id,
       action, before_json, after_json, reason, actor_id
     ) VALUES ($1, NULL, NULL, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
    [
      ctx.workspace.id,
      orderId,
      LegacyArHistoryAction.CUSTOMER_LINKED,
      JSON.stringify(beforeJson),
      JSON.stringify(afterJson),
      reason,
      ctx.user.id,
    ],
  );

  await recordAuditEvent(client, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: 'printquote.legacy_ar.link_customer',
    entityType: 'print_order',
    entityId: orderId,
    requestId,
    metadata: { ...afterJson, reason },
  });

  return {
    order_id: orderId,
    order_code: String(ord['order_code']),
    customer_id: verifiedCustomer.id,
    customer_code: verifiedCustomer.code,
    customer_name: verifiedCustomer.name,
  };
}

export async function reconcileLegacyOrderBalanceDiscrepancyTx(
  client: pg.PoolClient,
  ctx: AuthenticatedContext,
  orderId: string,
  input: Record<string, unknown>,
  requestId: string,
): Promise<{
  order_id: string;
  order_code: string;
  aligned_total_paid_amount: number;
  aligned_remaining_debt_amount: number;
}> {
  if (!isValidUuid(orderId)) {
    throw new AuthError('VALIDATION_ERROR', 'Mã đơn hàng không hợp lệ.', 400);
  }
  const reason = requireNonEmptyReason(
    input['reason'],
    'Biên bản/lý do xác nhận đối chiếu chênh lệch số dư đơn cũ',
  );

  const ordRes = await client.query(
    `SELECT * FROM print_orders WHERE id = $1 AND workspace_id = $2 FOR UPDATE`,
    [orderId, ctx.workspace.id],
  );
  const ord = ordRes.rows[0];
  if (!ord) {
    throw new AuthError('NOT_FOUND', 'Không tìm thấy đơn hàng.', 404);
  }
  if (!ord['customer_id']) {
    throw new AuthError(
      'MISSING_CUSTOMER_ID_FOR_RECONCILIATION',
      'Phải gắn mã khách hàng hợp lệ (customer_id) cho đơn cũ trước khi chốt đối chiếu chênh lệch số dư.',
      409,
    );
  }

  const payTotalsRes = await client.query<{
    rec_sum: string;
    ref_sum: string;
  }>(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE payment_type <> 'REFUND'), 0)::text AS rec_sum,
       COALESCE(SUM(amount) FILTER (WHERE payment_type = 'REFUND'), 0)::text AS ref_sum
     FROM print_order_payments
     WHERE workspace_id = $1 AND order_id = $2`,
    [ctx.workspace.id, orderId],
  );
  const grossReceipts = toInt(payTotalsRes.rows[0]?.rec_sum, 0);
  const grossRefunds = toInt(payTotalsRes.rows[0]?.ref_sum, 0);
  const legacyNet = grossReceipts - grossRefunds;
  const grossQuote = toInt(ord['total_quote_amount'], 0);
  const maxCap =
    ord['production_status'] === PrintProductionStatus.CANCELLED
      ? grossQuote
      : toInt(ord['valid_receivable_amount'], grossQuote);

  if (grossRefunds > grossReceipts || legacyNet > maxCap) {
    throw new AuthError(
      'UNRESOLVABLE_LEGACY_OVERFLOW',
      `Các dòng thanh toán cũ của đơn ${String(ord['order_code'])} vượt giới hạn hợp lệ (thu=${grossReceipts}, hoàn=${grossRefunds}, phải thu tối đa=${maxCap}). Vui lòng tạm giữ dòng sai lệch thay vì đồng bộ số dư.`,
      409,
    );
  }

  const beforeJson = {
    pre0036_total_paid_snapshot: toInt(ord['pre0036_total_paid_snapshot'], 0),
    pre0036_remaining_debt_snapshot: toInt(
      ord['pre0036_remaining_debt_snapshot'],
      0,
    ),
    current_total_paid_amount: toInt(ord['total_paid_amount'], 0),
    current_remaining_debt_amount: toInt(ord['remaining_debt_amount'], 0),
    legacy_gross_receipts: grossReceipts,
    legacy_gross_refunds: grossRefunds,
    legacy_net_payments: legacyNet,
  };

  await client.query(
    `UPDATE print_orders
     SET legacy_balance_discrepancy_resolved = true,
         updated_at = now()
     WHERE id = $1 AND workspace_id = $2`,
    [orderId, ctx.workspace.id],
  );

  await refreshOrderPendingLegacyAnomaliesTx(client, ctx.workspace.id, orderId);
  const stateAfter = await recomputeOrderReceivableState(
    client,
    ctx.workspace.id,
    orderId,
  );

  const afterJson = {
    legacy_balance_discrepancy_resolved: true,
    aligned_total_paid_amount: stateAfter.effectiveTotalPaidAmount,
    aligned_remaining_debt_amount: stateAfter.remainingReceivableAmount,
    official_ar_allocated: stateAfter.netAllocatedReceiptAmount,
    legacy_pending_net: stateAfter.legacyPendingNetAmount,
  };

  await client.query(
    `INSERT INTO print_legacy_ar_reconciliation_history (
       workspace_id, reconciliation_id, legacy_payment_id, order_id,
       action, before_json, after_json, reason, actor_id
     ) VALUES ($1, NULL, NULL, $2, $3, $4::jsonb, $5::jsonb, $6, $7)`,
    [
      ctx.workspace.id,
      orderId,
      LegacyArHistoryAction.BALANCE_DISCREPANCY_RESOLVED,
      JSON.stringify(beforeJson),
      JSON.stringify(afterJson),
      reason,
      ctx.user.id,
    ],
  );

  await recordAuditEvent(client, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: 'printquote.legacy_ar.resolve_balance_discrepancy',
    entityType: 'print_order',
    entityId: orderId,
    requestId,
    metadata: { ...afterJson, reason },
  });

  return {
    order_id: orderId,
    order_code: String(ord['order_code']),
    aligned_total_paid_amount: stateAfter.effectiveTotalPaidAmount,
    aligned_remaining_debt_amount: stateAfter.remainingReceivableAmount,
  };
}

export async function confirmLegacyPaymentToArTx(
  client: pg.PoolClient,
  ctx: AuthenticatedContext,
  targetId: string,
  input: Record<string, unknown>,
  requestId: string,
): Promise<{
  reconciliation_id: string;
  legacy_payment_id: string;
  ar_transaction: PrintArTransactionData;
  before_snapshot: Record<string, unknown>;
  after_snapshot: Record<string, unknown>;
}> {
  if (!isValidUuid(targetId)) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Mã phiếu đối chiếu không hợp lệ.',
      400,
    );
  }

  const lookupRes = await client.query<{
    reconciliation_id: string;
    order_id: string;
  }>(
    `SELECT id AS reconciliation_id, order_id
     FROM print_legacy_ar_reconciliations
     WHERE workspace_id = $1 AND (id = $2 OR legacy_payment_id = $2)
     LIMIT 1`,
    [ctx.workspace.id, targetId],
  );
  const lookup = lookupRes.rows[0];
  if (!lookup) {
    throw new AuthError(
      'NOT_FOUND',
      'Không tìm thấy phiếu thu/hoàn cũ trong danh sách đối chiếu.',
      404,
    );
  }

  // Lock parent order first, then reconciliation row in deterministic order
  const ordLockRes = await client.query(
    `SELECT o.*, c.id AS verified_customer_id, c.name AS verified_customer_name
     FROM print_orders o
     LEFT JOIN print_customers c ON c.id = o.customer_id AND c.workspace_id = o.workspace_id
     WHERE o.id = $1 AND o.workspace_id = $2
     FOR UPDATE OF o`,
    [lookup.order_id, ctx.workspace.id],
  );
  const ord = ordLockRes.rows[0];
  if (!ord) {
    throw new AuthError('NOT_FOUND', 'Không tìm thấy đơn hàng liên kết.', 404);
  }

  const recRes = await client.query(
    `SELECT r.*,
            p.payment_type, p.amount, p.payment_method, p.paid_at,
            p.reference_code, p.note AS payment_note, p.recorded_by AS payment_recorded_by
     FROM print_legacy_ar_reconciliations r
     JOIN print_order_payments p ON p.id = r.legacy_payment_id
     WHERE r.id = $1 AND r.workspace_id = $2
     FOR UPDATE OF r`,
    [lookup.reconciliation_id, ctx.workspace.id],
  );
  const rec = recRes.rows[0]!;

  if (
    rec['status'] === LegacyArReconciliationStatus.CONFIRMED ||
    rec['status'] === LegacyArReconciliationStatus.POSTED_DIRECT
  ) {
    throw new AuthError(
      'ALREADY_CONFIRMED_TO_AR',
      'Phiếu thu/hoàn cũ này đã được xác nhận vào sổ AR chính thức trước đó, không ghi nhận trùng.',
      409,
    );
  }

  const stateBefore = await recomputeOrderReceivableState(
    client,
    ctx.workspace.id,
    lookup.order_id,
  );

  const payTotalsRes = await client.query<{
    rec_sum: string;
    ref_sum: string;
  }>(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE payment_type <> 'REFUND'), 0)::text AS rec_sum,
       COALESCE(SUM(amount) FILTER (WHERE payment_type = 'REFUND'), 0)::text AS ref_sum
     FROM print_order_payments
     WHERE workspace_id = $1 AND order_id = $2`,
    [ctx.workspace.id, lookup.order_id],
  );

  const grossReceipts = toInt(payTotalsRes.rows[0]?.rec_sum, 0);
  const grossRefunds = toInt(payTotalsRes.rows[0]?.ref_sum, 0);
  const paymentType = String(rec['payment_type'] || 'INSTALLMENT');
  const paymentAmount = toInt(rec['amount'], 0);
  const grossQuote = toInt(ord['total_quote_amount'], 0);
  const prePaid =
    ord['pre0036_total_paid_snapshot'] !== null &&
    ord['pre0036_total_paid_snapshot'] !== undefined
      ? toInt(ord['pre0036_total_paid_snapshot'], 0)
      : toInt(ord['total_paid_amount'], 0);
  const preRem =
    ord['pre0036_remaining_debt_snapshot'] !== null &&
    ord['pre0036_remaining_debt_snapshot'] !== undefined
      ? toInt(ord['pre0036_remaining_debt_snapshot'], 0)
      : Math.max(0, grossQuote - prePaid);

  const evalRes = evaluateLegacyPaymentReconciliationAnomalies({
    paymentType,
    paymentAmount,
    hasValidSameWorkspaceCustomer: Boolean(ord['verified_customer_id']),
    isOrderCancelled:
      ord['production_status'] === PrintProductionStatus.CANCELLED,
    cancellationSettlementStatus: String(
      ord['cancellation_settlement_status'] || 'NOT_APPLICABLE',
    ),
    orderGrossQuoteAmount: grossQuote,
    orderValidReceivableAmount: stateBefore.validReceivableAmount,
    pre0036TotalPaidSnapshot: prePaid,
    pre0036RemainingDebtSnapshot: preRem,
    orderLegacyGrossReceipts: grossReceipts,
    orderLegacyGrossRefunds: grossRefunds,
    officialArNetAllocatedOnOrder: stateBefore.netAllocatedReceiptAmount,
    balanceDiscrepancyResolved: Boolean(
      ord['legacy_balance_discrepancy_resolved'],
    ),
  });

  if (!evalRes.canConfirm) {
    if (evalRes.anomalyCodes.includes('MISSING_CUSTOMER_ID')) {
      throw new AuthError(
        'MISSING_CUSTOMER_ID_FOR_RECONCILIATION',
        'Đơn hàng cũ chưa gắn mã khách hàng hợp lệ (customer_id) thuộc cùng workspace. Vui lòng gắn khách hàng trước khi xác nhận vào sổ AR chính thức.',
        409,
      );
    }
    if (
      evalRes.anomalyCodes.length === 1 &&
      evalRes.anomalyCodes[0] === 'REFUND_AWAITING_CONFIRMED_RECEIPT'
    ) {
      throw new AuthError(
        'REFUND_REQUIRES_CONFIRMED_RECEIPT',
        'Phải xác nhận phiếu thu gốc trên đơn hàng này vào sổ AR chính thức trước khi xác nhận phiếu hoàn tiền.',
        409,
      );
    }
    throw new AuthError(
      'LEGACY_ANOMALY_BLOCKS_CONFIRMATION',
      `Không thể xác nhận dòng phiếu cũ đang có bất thường (${evalRes.anomalyCodes.join(', ')}). Hệ thống không tự xác nhận dòng không khớp.`,
      409,
    );
  }

  const paymentId = String(rec['legacy_payment_id']);
  const isRefund = paymentType === 'REFUND';
  const scope = normalizeLedgerScopeInput(ord['ledger_scope']);
  const resolutionNote =
    typeof input['note'] === 'string' && input['note'].trim()
      ? input['note'].trim()
      : typeof input['reason'] === 'string' && input['reason'].trim()
        ? input['reason'].trim()
        : null;

  const preferredTxCode = `${isRefund ? 'HT-MIG-' : 'PT-MIG-'}${paymentId.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  const codeCollisionRes = await client.query(
    `SELECT 1 FROM print_ar_transactions WHERE workspace_id = $1 AND tx_code = $2 LIMIT 1`,
    [ctx.workspace.id, preferredTxCode],
  );
  const txCode =
    codeCollisionRes.rows.length === 0
      ? preferredTxCode
      : await allocateNextLedgerCode(client, ctx.workspace.id, 'AR_TX');

  assertTransactionConservationInvariant({
    label: `confirmLegacyPayment(${txCode})`,
    amount: paymentAmount,
    allocatedAmount: paymentAmount,
    refundedUnallocatedAmount: 0,
    unallocatedAmount: 0,
  });

  const beforeSnapshot: Record<string, unknown> = {
    status: String(rec['status']),
    order_code: String(ord['order_code']),
    official_ar_allocated_before: stateBefore.netAllocatedReceiptAmount,
    legacy_pending_net_before: stateBefore.legacyPendingNetAmount,
    effective_order_paid_before: stateBefore.effectiveTotalPaidAmount,
    order_remaining_before: stateBefore.remainingReceivableAmount,
  };

  const txInsRes = await client.query(
    `INSERT INTO print_ar_transactions (
       workspace_id, tx_code, customer_id, customer_name, ledger_scope,
       tx_kind, receipt_subtype, amount, allocated_amount,
       refunded_unallocated_amount, unallocated_amount,
       payment_method, occurred_at, reference_code, note,
       status, related_order_id, legacy_order_payment_id, recorded_by
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $8,
       0, 0,
       $9, $10, $11, $12,
       'POSTED', $13, $14, $15
     ) RETURNING *`,
    [
      ctx.workspace.id,
      txCode,
      String(ord['verified_customer_id']),
      String(ord['verified_customer_name'] || ord['customer_name']),
      scope,
      isRefund ? ArTransactionKind.REFUND : ArTransactionKind.RECEIPT,
      isRefund ? null : paymentType,
      paymentAmount,
      normalizePaymentMethod(rec['payment_method']),
      rec['paid_at'] ?? new Date(),
      rec['reference_code'] ?? null,
      resolutionNote ??
        (rec['payment_note'] ? String(rec['payment_note']) : null),
      lookup.order_id,
      paymentId,
      ctx.user.id,
    ],
  );

  const arTx = mapArTransactionRow(txInsRes.rows[0]!);

  const allocInsRes = await client.query(
    `INSERT INTO print_ar_allocations (
       workspace_id, ar_transaction_id, order_id, direction, amount, note, recorded_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      ctx.workspace.id,
      arTx.id,
      lookup.order_id,
      isRefund ? 'REFUND_RELEASE' : 'APPLY',
      paymentAmount,
      resolutionNote ??
        (rec['payment_note'] ? String(rec['payment_note']) : null),
      ctx.user.id,
    ],
  );
  arTx.allocations = [
    mapArAllocationRow({
      ...allocInsRes.rows[0]!,
      order_code: ord['order_code'],
    }),
  ];

  // Mark reconciliation row CONFIRMED BEFORE recomputing order receivable state so legacyPendingNet drops atomically!
  await client.query(
    `UPDATE print_legacy_ar_reconciliations
     SET status = 'CONFIRMED',
         anomaly_codes = '[]'::jsonb,
         posted_ar_transaction_id = $1,
         resolution_note = $2,
         confirmed_at = now(),
         confirmed_by = $3,
         updated_at = now()
     WHERE id = $4 AND workspace_id = $5`,
    [
      arTx.id,
      resolutionNote,
      ctx.user.id,
      lookup.reconciliation_id,
      ctx.workspace.id,
    ],
  );

  const stateAfter = await recomputeOrderReceivableState(
    client,
    ctx.workspace.id,
    lookup.order_id,
  );
  await refreshOrderPendingLegacyAnomaliesTx(
    client,
    ctx.workspace.id,
    lookup.order_id,
  );

  // Hard runtime guard: transition confirmation MUST NEVER double-count on the order!
  if (
    stateAfter.effectiveTotalPaidAmount !== stateBefore.effectiveTotalPaidAmount
  ) {
    throw new AuthError(
      'INTERNAL_ERROR',
      `Vi phạm bất biến chống cộng trùng khi đối chiếu đơn ${String(ord['order_code'])}: trước=${stateBefore.effectiveTotalPaidAmount}, sau=${stateAfter.effectiveTotalPaidAmount}.`,
      500,
    );
  }

  const afterSnapshot: Record<string, unknown> = {
    status: LegacyArReconciliationStatus.CONFIRMED,
    posted_ar_transaction_id: arTx.id,
    posted_ar_tx_code: arTx.tx_code,
    official_ar_allocated_after: stateAfter.netAllocatedReceiptAmount,
    legacy_pending_net_after: stateAfter.legacyPendingNetAmount,
    effective_order_paid_after: stateAfter.effectiveTotalPaidAmount,
    order_remaining_after: stateAfter.remainingReceivableAmount,
  };

  await client.query(
    `UPDATE print_legacy_ar_reconciliations
     SET post_reconciliation_json = $1::jsonb,
         updated_at = now()
     WHERE id = $2 AND workspace_id = $3`,
    [JSON.stringify(afterSnapshot), lookup.reconciliation_id, ctx.workspace.id],
  );

  await client.query(
    `INSERT INTO print_legacy_ar_reconciliation_history (
       workspace_id, reconciliation_id, legacy_payment_id, order_id,
       action, before_json, after_json, reason, actor_id
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
    [
      ctx.workspace.id,
      lookup.reconciliation_id,
      paymentId,
      lookup.order_id,
      LegacyArHistoryAction.CONFIRMED_TO_AR,
      JSON.stringify(beforeSnapshot),
      JSON.stringify(afterSnapshot),
      resolutionNote ?? 'Xác nhận đối chiếu phiếu cũ vào sổ AR chính thức',
      ctx.user.id,
    ],
  );

  await recordAuditEvent(client, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: 'printquote.legacy_ar.confirm',
    entityType: 'print_ar_transaction',
    entityId: arTx.id,
    requestId,
    metadata: {
      reconciliation_id: lookup.reconciliation_id,
      legacy_payment_id: paymentId,
      tx_code: arTx.tx_code,
      amount: paymentAmount,
      tx_kind: arTx.tx_kind,
      ...afterSnapshot,
    },
  });

  return {
    reconciliation_id: lookup.reconciliation_id,
    legacy_payment_id: paymentId,
    ar_transaction: arTx,
    before_snapshot: beforeSnapshot,
    after_snapshot: afterSnapshot,
  };
}

export async function holdLegacyPaymentReconciliationTx(
  client: pg.PoolClient,
  ctx: AuthenticatedContext,
  targetId: string,
  input: Record<string, unknown>,
  requestId: string,
): Promise<{
  reconciliation_id: string;
  legacy_payment_id: string;
  status: 'PENDING' | 'ON_HOLD';
  hold_reason: string | null;
}> {
  if (!isValidUuid(targetId)) {
    throw new AuthError(
      'VALIDATION_ERROR',
      'Mã phiếu đối chiếu không hợp lệ.',
      400,
    );
  }
  const unhold = input['unhold'] === true;
  const reason = requireNonEmptyReason(
    input['reason'],
    unhold
      ? 'Lý do mở lại đối chiếu phiếu cũ'
      : 'Lý do tạm giữ phiếu cũ chưa đưa vào sổ AR',
  );

  const recRes = await client.query(
    `SELECT * FROM print_legacy_ar_reconciliations
     WHERE workspace_id = $1 AND (id = $2 OR legacy_payment_id = $2)
     FOR UPDATE`,
    [ctx.workspace.id, targetId],
  );
  const rec = recRes.rows[0];
  if (!rec) {
    throw new AuthError(
      'NOT_FOUND',
      'Không tìm thấy phiếu cũ trong danh sách đối chiếu.',
      404,
    );
  }

  if (
    rec['status'] === LegacyArReconciliationStatus.CONFIRMED ||
    rec['status'] === LegacyArReconciliationStatus.POSTED_DIRECT
  ) {
    throw new AuthError(
      'ALREADY_CONFIRMED_TO_AR',
      'Phiếu này đã được xác nhận vào sổ AR chính thức nên không thể chuyển sang tạm giữ.',
      409,
    );
  }

  const nextStatus = unhold ? 'PENDING' : 'ON_HOLD';
  const nextHoldReason = unhold ? null : reason;
  const recId = String(rec['id']);
  const paymentId = String(rec['legacy_payment_id']);
  const orderId = String(rec['order_id']);

  await client.query(
    `UPDATE print_legacy_ar_reconciliations
     SET status = $1,
         hold_reason = $2,
         updated_at = now()
     WHERE id = $3 AND workspace_id = $4`,
    [nextStatus, nextHoldReason, recId, ctx.workspace.id],
  );

  await client.query(
    `INSERT INTO print_legacy_ar_reconciliation_history (
       workspace_id, reconciliation_id, legacy_payment_id, order_id,
       action, before_json, after_json, reason, actor_id
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
    [
      ctx.workspace.id,
      recId,
      paymentId,
      orderId,
      unhold ? LegacyArHistoryAction.UNHELD : LegacyArHistoryAction.HELD,
      JSON.stringify({
        status: rec['status'],
        hold_reason: rec['hold_reason'] ?? null,
      }),
      JSON.stringify({
        status: nextStatus,
        hold_reason: nextHoldReason,
      }),
      reason,
      ctx.user.id,
    ],
  );

  await recordAuditEvent(client, {
    workspaceId: ctx.workspace.id,
    actorUserId: ctx.user.id,
    action: unhold
      ? 'printquote.legacy_ar.unhold'
      : 'printquote.legacy_ar.hold',
    entityType: 'print_legacy_ar_reconciliation',
    entityId: recId,
    requestId,
    metadata: { legacy_payment_id: paymentId, order_id: orderId, reason },
  });

  return {
    reconciliation_id: recId,
    legacy_payment_id: paymentId,
    status: nextStatus,
    hold_reason: nextHoldReason,
  };
}
