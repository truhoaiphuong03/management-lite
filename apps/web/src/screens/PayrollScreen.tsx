import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  StatusBadge,
  EmptyState,
  BanknoteIcon,
  CalendarIcon,
  CheckIcon,
  CloseIcon,
  UserIcon,
  RotateCcwIcon,
  InfoIcon,
  ActionIconButton,
  Pagination,
  AppSkeleton,
  DEFAULT_PAGE_SIZE,
  clampPage,
} from '../../../../packages/ui/src/components/index.js';
import type { UserRole } from '../types.js';
import type {
  PayrollPeriodData,
  PayrollEmployeeItemData,
  StaffPayslipData,
  PayrollMonthOverviewData,
  SetHourlyRateRequest,
  CreateAdjustmentRequest,
  CreateDisbursementRequest,
} from '../../../../packages/contracts/src/payroll.js';

export interface PayrollScreenProps {
  role?: UserRole;
  onNavigate?: (path: string) => void;
  workspaceId?: string;
  currentUserId?: string;
}

import {
  formatVnd,
  resolveVietQrBankCode,
  formatMinutes,
  formatDateDisplay,
  getCurrentMonth,
  shiftMonth,
} from './helpers/payroll-helpers.js';

export interface UnresolvedDisbursementRecord {
  workspaceId: string;
  userId: string;
  itemId: string;
  employeeId: string;
  periodMonth: string;
  idempotencyKey: string;
  amount: string;
  method: 'bank_transfer' | 'cash' | 'other';
  date: string;
  note: string;
  createdAt: number;
}

const DISBURSEMENT_STORAGE_PREFIX = 'mgmt_lite_unresolved_disbursements_v2_';

export function getScopedDisbursementStorageKey(
  workspaceId: string,
  userId: string,
): string {
  if (!workspaceId || !userId) {
    return '';
  }
  return `${DISBURSEMENT_STORAGE_PREFIX}${workspaceId}_${userId}`;
}

export function getDisbursementKey(
  workspaceId: string | undefined,
  userId: string | undefined,
  itemId: string,
  periodMonth: string,
): string {
  if (!workspaceId || !userId) {
    return '';
  }
  return `${workspaceId}:${userId}:${itemId}:${periodMonth}`;
}

export interface StorageVerificationResult {
  success: boolean;
  error?: string;
}

export function validateUnresolvedDisbursementRecord(
  raw: unknown,
  expectedWs?: string,
  expectedUser?: string,
): UnresolvedDisbursementRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const item = raw as Record<string, unknown>;
  if (
    typeof item.workspaceId !== 'string' ||
    item.workspaceId.trim().length === 0 ||
    (expectedWs && item.workspaceId !== expectedWs)
  ) {
    return null;
  }
  if (
    typeof item.userId !== 'string' ||
    item.userId.trim().length === 0 ||
    (expectedUser && item.userId !== expectedUser)
  ) {
    return null;
  }
  if (typeof item.itemId !== 'string' || item.itemId.trim().length === 0) {
    return null;
  }
  if (
    typeof item.employeeId !== 'string' ||
    item.employeeId.trim().length === 0
  ) {
    return null;
  }
  if (
    typeof item.periodMonth !== 'string' ||
    !/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/.test(item.periodMonth)
  ) {
    return null;
  }
  if (
    typeof item.idempotencyKey !== 'string' ||
    item.idempotencyKey.trim().length === 0
  ) {
    return null;
  }
  if (
    typeof item.amount !== 'string' ||
    isNaN(Number(item.amount)) ||
    Number(item.amount) <= 0
  ) {
    return null;
  }
  if (
    typeof item.method !== 'string' ||
    !['bank_transfer', 'cash', 'other'].includes(item.method)
  ) {
    return null;
  }
  if (typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
    return null;
  }
  if (typeof item.note !== 'string') {
    return null;
  }
  if (
    typeof item.createdAt !== 'number' ||
    isNaN(item.createdAt) ||
    item.createdAt <= 0
  ) {
    return null;
  }

  return {
    workspaceId: item.workspaceId,
    userId: item.userId,
    itemId: item.itemId,
    employeeId: item.employeeId,
    periodMonth: item.periodMonth,
    idempotencyKey: item.idempotencyKey,
    amount: item.amount,
    method: item.method as 'bank_transfer' | 'cash' | 'other',
    date: item.date,
    note: item.note,
    createdAt: item.createdAt,
  };
}

export interface ValidateDisbursementSuccessParams {
  amount: number;
  payment_method: string;
  payment_date: string;
  reference_note?: string | undefined;
}

/**
 * Q67-01: Strict canonical DTO response validation matching original operation payload.
 * Verifies that the server response matches all required fields of PayrollDisbursementData
 * and matches the requested amount, payment method, payment date, and reference note.
 */
export function validateDisbursementSuccessResponse(
  resOk: boolean,
  resBody: unknown,
  expectedDisbursement: ValidateDisbursementSuccessParams,
): boolean {
  if (!resOk || !resBody || typeof resBody !== 'object') {
    return false;
  }
  const body = resBody as Record<string, unknown>;
  if (body.success !== true || !body.data || typeof body.data !== 'object') {
    return false;
  }
  const data = body.data as Record<string, unknown>;

  // 1. Mandatory ID check: valid non-empty string
  if (typeof data.id !== 'string' || data.id.trim().length === 0) {
    return false;
  }

  // 2. Mandatory disbursement_order check: positive integer
  if (
    typeof data.disbursement_order !== 'number' ||
    !Number.isInteger(data.disbursement_order) ||
    data.disbursement_order <= 0
  ) {
    return false;
  }

  // 3. Mandatory amount_vnd check: exact match with expected amount
  if (
    typeof data.amount_vnd !== 'number' ||
    data.amount_vnd !== expectedDisbursement.amount
  ) {
    return false;
  }

  // 4. Mandatory payment_method check: exact match with expected method
  if (
    typeof data.payment_method !== 'string' ||
    data.payment_method !== expectedDisbursement.payment_method
  ) {
    return false;
  }

  // 5. Mandatory payment_date check: exact match with expected date (YYYY-MM-DD)
  if (
    typeof data.payment_date !== 'string' ||
    data.payment_date !== expectedDisbursement.payment_date
  ) {
    return false;
  }

  // 6. reference_note is part of the canonical DTO (string | null): the field must be
  // present and equal the requested note (null when no note was requested).
  if (!Object.prototype.hasOwnProperty.call(data, 'reference_note')) {
    return false;
  }
  const expectedNote = expectedDisbursement.reference_note?.trim() || null;
  const rawNote = data.reference_note;
  if (rawNote !== null && typeof rawNote !== 'string') {
    return false;
  }
  const actualNote = typeof rawNote === 'string' ? rawNote.trim() : null;
  if (actualNote !== expectedNote) {
    return false;
  }

  return true;
}

export type PendingAdjustmentStatus =
  'in_flight' | 'unresolved' | 'error_unresolved' | 'confirmed' | 'rejected';

export interface PendingAdjustmentOperation {
  operationId: string;
  workspaceId: string;
  actorId: string;
  employeeId: string;
  month: string;
  key: string;
  payload: CreateAdjustmentRequest;
  fingerprint: string;
  status: PendingAdjustmentStatus;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export const PENDING_ADJUSTMENT_STORAGE_PREFIX =
  'mgmt_lite_pending_adjustments_v1_';

export function computeAdjustmentFingerprint(
  payload: CreateAdjustmentRequest,
): string {
  return JSON.stringify({
    adjustment_type: payload.adjustment_type,
    amount_vnd: Number(payload.amount_vnd),
    attributable_date: String(payload.attributable_date).trim(),
    employee_id: String(payload.employee_id).trim(),
    reason: String(payload.reason).trim(),
  });
}

export function getScopedAdjustmentStorageKey(
  workspaceId: string,
  actorId: string,
): string {
  if (!workspaceId || !actorId) return '';
  return `${PENDING_ADJUSTMENT_STORAGE_PREFIX}${workspaceId}_${actorId}`;
}

export interface AdjustmentOperationRegistry {
  [operationKey: string]: PendingAdjustmentOperation;
}

export function getAdjustmentOperationKey(
  employeeId: string,
  month: string,
): string {
  return `${employeeId.trim()}:${month.trim()}`;
}

export function loadAdjustmentRegistryFromStorage(
  workspaceId: string,
  actorId: string,
): AdjustmentOperationRegistry {
  if (typeof window === 'undefined' || !window.sessionStorage) return {};
  const storageKey = getScopedAdjustmentStorageKey(workspaceId, actorId);
  if (!storageKey) return {};
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const registry: AdjustmentOperationRegistry = {};
    for (const [key, item] of Object.entries(parsed)) {
      if (
        item &&
        typeof item === 'object' &&
        (item as PendingAdjustmentOperation).workspaceId === workspaceId &&
        (item as PendingAdjustmentOperation).actorId === actorId &&
        (item as PendingAdjustmentOperation).key &&
        (item as PendingAdjustmentOperation).operationId
      ) {
        registry[key] = item as PendingAdjustmentOperation;
      }
    }
    return registry;
  } catch {
    return {};
  }
}

export function loadPendingAdjustmentFromStorage(
  workspaceId: string,
  actorId: string,
  employeeId: string,
  month: string,
): PendingAdjustmentOperation | null {
  const reg = loadAdjustmentRegistryFromStorage(workspaceId, actorId);
  const opKey = getAdjustmentOperationKey(employeeId, month);
  const op = reg[opKey];
  if (!op) return null;
  if (
    op.workspaceId !== workspaceId ||
    op.actorId !== actorId ||
    op.employeeId !== employeeId ||
    op.month !== month
  ) {
    return null;
  }
  return op;
}

export function savePendingAdjustmentToStorage(
  op: PendingAdjustmentOperation,
): boolean {
  if (typeof window === 'undefined' || !window.sessionStorage) return false;
  const storageKey = getScopedAdjustmentStorageKey(op.workspaceId, op.actorId);
  if (!storageKey) return false;
  try {
    const reg = loadAdjustmentRegistryFromStorage(op.workspaceId, op.actorId);
    const opKey = getAdjustmentOperationKey(op.employeeId, op.month);
    reg[opKey] = op;
    const serialized = JSON.stringify(reg);
    window.sessionStorage.setItem(storageKey, serialized);
    const readBack = window.sessionStorage.getItem(storageKey);
    return readBack === serialized;
  } catch {
    return false;
  }
}

export function clearPendingAdjustmentFromStorage(
  workspaceId: string,
  actorId: string,
  operationId: string,
  employeeId?: string,
  month?: string,
): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return;
  const storageKey = getScopedAdjustmentStorageKey(workspaceId, actorId);
  if (!storageKey) return;
  try {
    const reg = loadAdjustmentRegistryFromStorage(workspaceId, actorId);
    let changed = false;
    for (const [k, op] of Object.entries(reg)) {
      if (op.operationId === operationId) {
        delete reg[k];
        changed = true;
      }
    }
    if (
      employeeId &&
      month &&
      reg[getAdjustmentOperationKey(employeeId, month)]?.operationId ===
        operationId
    ) {
      delete reg[getAdjustmentOperationKey(employeeId, month)];
      changed = true;
    }
    if (changed) {
      window.sessionStorage.setItem(storageKey, JSON.stringify(reg));
    }
  } catch {
    // Ignore
  }
}

/**
 * FIX-70 (Q69 cross-tab/identity): re-verify the canonical session at submit time,
 * so a session/workspace change while the component stays mounted is detected.
 */
export async function fetchCanonicalSessionIdentity(): Promise<{
  userId: string;
  workspaceId: string;
} | null> {
  try {
    const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
    if (!res.ok) return null;
    const body = await res.json();
    const uid = body?.data?.user?.id;
    const wid = body?.data?.active_workspace?.id;
    if (
      body?.success !== true ||
      typeof uid !== 'string' ||
      uid.trim().length === 0 ||
      typeof wid !== 'string' ||
      wid.trim().length === 0
    ) {
      return null;
    }
    return { userId: uid.trim(), workspaceId: wid.trim() };
  } catch {
    return null;
  }
}

/** FIX-70: write then require an exact read-back; returns an error string or null. */
function writeVerifiedItem(key: string, value: string): string | null {
  try {
    window.sessionStorage.setItem(key, value);
    const back = window.sessionStorage.getItem(key);
    if (back !== value) return 'đọc lại không khớp dữ liệu vừa ghi';
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** FIX-70: remove and require the key to be gone; returns an error string or null. */
function removeVerifiedItem(key: string): string | null {
  try {
    window.sessionStorage.removeItem(key);
    if (window.sessionStorage.getItem(key) !== null) {
      return 'khóa vẫn còn sau khi xóa';
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** FIX-72: operation identity = idempotency key + immutable payload fields. */
function disbursementSignature(r: UnresolvedDisbursementRecord): string {
  return JSON.stringify([r.idempotencyKey, r.amount, r.method, r.date, r.note]);
}

/** FIX-72: sessionStorage key of the recovery marker that guards a scoped cleanup. */
function getRecoveryStorageKey(v2Key: string): string {
  return `${v2Key}__recovery`;
}

export type StorageInspectionStatus =
  'absent' | 'valid' | 'corrupt' | 'blocked';

export interface StorageInspectionResult {
  status: StorageInspectionStatus;
  records: Map<string, UnresolvedDisbursementRecord>;
  ambiguousLegacyKeys: Set<string>;
  error?: string | undefined;
}

/**
 * Q67-02 & Q67-03: Typed absent/valid/corrupt/blocked storage inspection.
 * - Inspects scoped v2 storage.
 * - Discovers and safely migrates exact-matching legacy v1 records into v2.
 * - Detects ambiguous legacy records (different/missing user) and blocks them for reconciliation.
 * - Rejects corrupt/invalid JSON and read failures without fail-open data wipe.
 */
export function inspectUnresolvedDisbursementStorage(
  workspaceId?: string,
  userId?: string,
): StorageInspectionResult {
  const emptyMap = new Map<string, UnresolvedDisbursementRecord>();
  const emptyAmbiguous = new Set<string>();

  if (!workspaceId || !userId) {
    return {
      status: 'blocked',
      records: emptyMap,
      ambiguousLegacyKeys: emptyAmbiguous,
      error:
        'Thiếu định danh workspace hoặc user để kiểm tra bộ nhớ giao dịch.',
    };
  }

  if (typeof window === 'undefined' || !window.sessionStorage) {
    return {
      status: 'blocked',
      records: emptyMap,
      ambiguousLegacyKeys: emptyAmbiguous,
      error: 'Bộ nhớ sessionStorage không khả dụng trên môi trường hiện tại.',
    };
  }

  const v2Key = getScopedDisbursementStorageKey(workspaceId, userId);
  const records = new Map<string, UnresolvedDisbursementRecord>();
  const ambiguousLegacyKeys = new Set<string>();
  let hasValidV2 = false;

  // 1. Inspect V2 Scoped Storage
  try {
    const rawV2 = window.sessionStorage.getItem(v2Key);
    if (rawV2 !== null) {
      if (rawV2.trim().length === 0) {
        return {
          status: 'corrupt',
          records: emptyMap,
          ambiguousLegacyKeys: emptyAmbiguous,
          error: 'Dữ liệu lưu trữ giao dịch (v2) rỗng bất thường.',
        };
      }
      let parsedV2: unknown;
      try {
        parsedV2 = JSON.parse(rawV2);
      } catch (parseErr) {
        return {
          status: 'corrupt',
          records: emptyMap,
          ambiguousLegacyKeys: emptyAmbiguous,
          error: `Dữ liệu lưu trữ giao dịch (v2) bị lỗi JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
        };
      }
      if (!Array.isArray(parsedV2)) {
        return {
          status: 'corrupt',
          records: emptyMap,
          ambiguousLegacyKeys: emptyAmbiguous,
          error:
            'Dữ liệu lưu trữ giao dịch (v2) không phải là danh sách mảng hợp lệ.',
        };
      }
      // FIX-72 (Q71-02): every record is validated and compared BEFORE the Map is
      // built. Same identity/item/month with a different key or payload is a
      // conflict: block, preserve storage, never pick first/last. An identical
      // duplicate is the same operation and is treated as one record (no rewrite).
      for (const item of parsedV2) {
        const valid = validateUnresolvedDisbursementRecord(
          item,
          workspaceId,
          userId,
        );
        if (!valid) {
          return {
            status: 'corrupt',
            records: emptyMap,
            ambiguousLegacyKeys: emptyAmbiguous,
            error:
              'Bản ghi giao dịch trong bộ nhớ (v2) không hợp lệ theo chuẩn schema.',
          };
        }
        const k = getDisbursementKey(
          valid.workspaceId,
          valid.userId,
          valid.itemId,
          valid.periodMonth,
        );
        if (k) {
          const prior = records.get(k);
          if (
            prior &&
            disbursementSignature(prior) !== disbursementSignature(valid)
          ) {
            return {
              status: 'corrupt',
              records: emptyMap,
              ambiguousLegacyKeys: emptyAmbiguous,
              error:
                'Phát hiện nhiều bản ghi chưa rõ kết quả xung đột khóa/nội dung cho cùng khoản lương và tháng (v2). Giữ nguyên bản ghi để đối soát.',
            };
          }
          records.set(k, valid);
        }
      }
      hasValidV2 = true;
    }
  } catch (readErr) {
    return {
      status: 'blocked',
      records: emptyMap,
      ambiguousLegacyKeys: emptyAmbiguous,
      error: `Lỗi đọc sessionStorage (v2): ${readErr instanceof Error ? readErr.message : String(readErr)}`,
    };
  }

  // FIX-72 (Q71-01): recovery marker written by a scoped cleanup before it touches
  // v2. It holds the original key/payload, so any cleanup step that fails can never
  // make an unreconciled operation look like "no pending". Restore it verified,
  // and only then remove the marker; any failure blocks (fail-closed).
  const recoveryKey = getRecoveryStorageKey(v2Key);
  {
    let rawRec: string | null;
    try {
      rawRec = window.sessionStorage.getItem(recoveryKey);
    } catch (e) {
      return {
        status: 'blocked',
        records: emptyMap,
        ambiguousLegacyKeys: emptyAmbiguous,
        error: `Lỗi đọc dấu khôi phục giao dịch: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    if (rawRec !== null) {
      let parsedRec: unknown;
      try {
        parsedRec = JSON.parse(rawRec);
      } catch {
        parsedRec = null;
      }
      if (!Array.isArray(parsedRec)) {
        return {
          status: 'corrupt',
          records: emptyMap,
          ambiguousLegacyKeys: emptyAmbiguous,
          error:
            'Dấu khôi phục giao dịch bị hỏng định dạng. Giữ nguyên để đối soát.',
        };
      }
      let restored = false;
      for (const item of parsedRec) {
        const valid = validateUnresolvedDisbursementRecord(
          item,
          workspaceId,
          userId,
        );
        const k = valid
          ? getDisbursementKey(
              valid.workspaceId,
              valid.userId,
              valid.itemId,
              valid.periodMonth,
            )
          : '';
        if (!valid || !k) {
          return {
            status: 'corrupt',
            records: emptyMap,
            ambiguousLegacyKeys: emptyAmbiguous,
            error:
              'Dấu khôi phục giao dịch chứa bản ghi không hợp lệ. Giữ nguyên để đối soát.',
          };
        }
        const prior = records.get(k);
        if (prior) {
          if (disbursementSignature(prior) !== disbursementSignature(valid)) {
            return {
              status: 'corrupt',
              records: emptyMap,
              ambiguousLegacyKeys: emptyAmbiguous,
              error:
                'Dấu khôi phục xung đột khóa/nội dung với bản ghi hiện tại. Giữ nguyên để đối soát.',
            };
          }
          continue;
        }
        records.set(k, valid);
        restored = true;
      }
      if (restored) {
        const restoreErr = writeVerifiedItem(
          v2Key,
          JSON.stringify(Array.from(records.values())),
        );
        if (restoreErr) {
          return {
            status: 'blocked',
            records: emptyMap,
            ambiguousLegacyKeys: emptyAmbiguous,
            error: `Không thể khôi phục và xác minh bản ghi chưa đối soát (${restoreErr}). Dấu khôi phục được giữ nguyên.`,
          };
        }
      }
      const markerErr = removeVerifiedItem(recoveryKey);
      if (markerErr) {
        return {
          status: 'blocked',
          records: emptyMap,
          ambiguousLegacyKeys: emptyAmbiguous,
          error: `Không thể xóa dấu khôi phục sau khi xác minh (${markerErr}). Cần đối soát.`,
        };
      }
      hasValidV2 = true;
    }
  }

  // 2. Inspect Legacy V1 Storage (mgmt_lite_unresolved_disbursements_v1 & management_lite_unresolved_disbursements_${workspaceId})
  // FIX-70 (Q69-01/02/04): classify first, verify destination write + exact read-back,
  // and only then remove verified source records. Never choose between conflicting
  // keys and never attribute records with missing identity to the current user.
  type LegacyEntry = {
    legKey: string;
    raw: unknown;
    kind: 'foreign' | 'ambiguous' | 'exact';
    k?: string;
    rec?: UnresolvedDisbursementRecord;
  };
  const signatureOf = (r: UnresolvedDisbursementRecord) =>
    JSON.stringify([r.idempotencyKey, r.amount, r.method, r.date, r.note]);
  const legacyKeys = [
    'mgmt_lite_unresolved_disbursements_v1',
    `management_lite_unresolved_disbursements_${workspaceId}`,
  ];
  const corruptResult = (error: string): StorageInspectionResult => ({
    status: 'corrupt',
    records: emptyMap,
    ambiguousLegacyKeys: emptyAmbiguous,
    error,
  });
  const entries: LegacyEntry[] = [];
  const legacyPresent: string[] = [];

  for (const legKey of legacyKeys) {
    let rawLeg: string | null;
    try {
      rawLeg = window.sessionStorage.getItem(legKey);
    } catch (legErr) {
      return {
        status: 'blocked',
        records: emptyMap,
        ambiguousLegacyKeys: emptyAmbiguous,
        error: `Lỗi đọc sessionStorage (${legKey}): ${legErr instanceof Error ? legErr.message : String(legErr)}`,
      };
    }
    if (rawLeg === null) continue;
    if (rawLeg.trim().length === 0) {
      return corruptResult(
        `Dữ liệu lưu trữ giao dịch phiên bản cũ (${legKey}) rỗng bất thường.`,
      );
    }
    let parsedLeg: unknown;
    try {
      parsedLeg = JSON.parse(rawLeg);
    } catch (parseErr) {
      return corruptResult(
        `Dữ liệu lưu trữ phiên bản cũ (${legKey}) bị lỗi JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      );
    }
    if (!Array.isArray(parsedLeg)) {
      return corruptResult(
        `Dữ liệu lưu trữ phiên bản cũ (${legKey}) không phải là mảng hợp lệ.`,
      );
    }
    legacyPresent.push(legKey);
    for (const rawItem of parsedLeg) {
      if (!rawItem || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
        return corruptResult(
          `Phát hiện phần tử không hợp lệ trong dữ liệu phiên bản cũ (${legKey}).`,
        );
      }
      const o = rawItem as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
      const itemWs = str(o.workspaceId);
      const itemUser = str(o.userId);
      const itemId = str(o.itemId);
      const itemPeriod = str(o.periodMonth);
      if (!itemId || !itemPeriod) {
        return corruptResult(
          `Bản ghi phiên bản cũ (${legKey}) thiếu itemId/periodMonth, cần đối soát thủ công.`,
        );
      }
      if (itemWs && itemWs !== workspaceId) {
        entries.push({ legKey, raw: rawItem, kind: 'foreign' });
        continue;
      }
      if (!itemWs || !itemUser || itemUser !== userId) {
        // Missing identity or another user: cannot be proven to belong to us.
        ambiguousLegacyKeys.add(`${workspaceId}:${itemId}:${itemPeriod}`);
        entries.push({ legKey, raw: rawItem, kind: 'ambiguous' });
        continue;
      }
      const valid = validateUnresolvedDisbursementRecord(
        o,
        workspaceId,
        userId,
      );
      if (!valid) {
        return corruptResult(
          'Bản ghi phiên bản cũ (v1) cho người dùng hiện tại không hợp lệ theo chuẩn schema.',
        );
      }
      const k = getDisbursementKey(
        valid.workspaceId,
        valid.userId,
        valid.itemId,
        valid.periodMonth,
      );
      entries.push({ legKey, raw: rawItem, kind: 'exact', k, rec: valid });
    }
  }

  // Detect conflicting keys/payloads for the same item-month (v2 vs v1 or v1 vs v1).
  const sigs = new Map<string, Set<string>>();
  const note = (k: string, s: string) => {
    if (!sigs.has(k)) sigs.set(k, new Set());
    sigs.get(k)!.add(s);
  };
  for (const [k, r] of records) note(k, signatureOf(r));
  for (const e of entries) {
    if (e.kind === 'exact' && e.k && e.rec) note(e.k, signatureOf(e.rec));
  }
  const conflictKeys = new Set<string>();
  for (const [k, s] of sigs) if (s.size > 1) conflictKeys.add(k);
  for (const e of entries) {
    if (e.kind === 'exact' && e.k && conflictKeys.has(e.k) && e.rec) {
      ambiguousLegacyKeys.add(
        `${workspaceId}:${e.rec.itemId}:${e.rec.periodMonth}`,
      );
      e.kind = 'ambiguous';
    }
  }

  // Migrate verified-safe exact records into v2: write + exact read-back first.
  const migrating = new Map<string, UnresolvedDisbursementRecord>();
  for (const e of entries) {
    if (e.kind === 'exact' && e.k && e.rec && !records.has(e.k)) {
      migrating.set(e.k, e.rec);
    }
  }
  if (migrating.size > 0) {
    const merged = new Map(records);
    for (const [k, r] of migrating) merged.set(k, r);
    const expected = JSON.stringify(Array.from(merged.values()));
    const previous = (() => {
      try {
        return window.sessionStorage.getItem(v2Key);
      } catch {
        return null;
      }
    })();
    const writeErr = writeVerifiedItem(v2Key, expected);
    if (writeErr) {
      // Best-effort restore of the previous destination; sources stay untouched.
      try {
        if (previous === null) window.sessionStorage.removeItem(v2Key);
        else window.sessionStorage.setItem(v2Key, previous);
      } catch {
        // ignore: sources are preserved either way
      }
      return {
        status: 'blocked',
        records: emptyMap,
        ambiguousLegacyKeys: emptyAmbiguous,
        error: `Không thể ghi và xác minh bản ghi chuyển đổi v1→v2 (${writeErr}). Bản ghi gốc được giữ nguyên để đối soát.`,
      };
    }
    for (const [k, r] of migrating) records.set(k, r);
    hasValidV2 = true;
  }

  // Remove only verified sources (destination already holds identical records).
  for (const legKey of legacyPresent) {
    const mine = entries.filter((e) => e.legKey === legKey);
    const removable = mine.filter((e) => e.kind === 'exact');
    if (removable.length === 0) continue;
    const remaining = mine.filter((e) => e.kind !== 'exact').map((e) => e.raw);
    const err =
      remaining.length === 0
        ? removeVerifiedItem(legKey)
        : writeVerifiedItem(legKey, JSON.stringify(remaining));
    if (err) {
      return {
        status: 'blocked',
        records: emptyMap,
        ambiguousLegacyKeys: emptyAmbiguous,
        error: `Không thể dọn bản ghi phiên bản cũ (${legKey}): ${err}. Giữ nguyên trạng thái chặn để đối soát.`,
      };
    }
  }

  return {
    status: hasValidV2 || records.size > 0 ? 'valid' : 'absent',
    records,
    ambiguousLegacyKeys,
  };
}

export function loadAllUnresolvedDisbursements(
  workspaceId?: string,
  userId?: string,
): Map<string, UnresolvedDisbursementRecord> {
  const inspection = inspectUnresolvedDisbursementStorage(workspaceId, userId);
  return inspection.records;
}

/**
 * Q65-01 & Q67-02: Fail-closed persistence check with mandatory read-back verification before payment POST.
 * In-memory fallback is strictly disallowed from passing this gate.
 * Corrupt or blocked storage stops the operation and does not overwrite existing records.
 */
export function saveAndVerifyUnresolvedDisbursement(
  record: UnresolvedDisbursementRecord,
): StorageVerificationResult {
  const validRecord = validateUnresolvedDisbursementRecord(
    record,
    record.workspaceId,
    record.userId,
  );
  if (!validRecord) {
    return {
      success: false,
      error:
        'Dữ liệu giao dịch chưa rõ kết quả không hợp lệ theo chuẩn schema.',
    };
  }

  if (typeof window === 'undefined' || !window.sessionStorage) {
    return {
      success: false,
      error:
        'Bộ nhớ sessionStorage không khả dụng. Thao tác bị dừng để đảm bảo an toàn tài chính.',
    };
  }

  const storageKey = getScopedDisbursementStorageKey(
    record.workspaceId,
    record.userId,
  );
  if (!storageKey) {
    return {
      success: false,
      error:
        'Không thể xác định storage key do thiếu thông tin định danh workspace hoặc user.',
    };
  }

  // Pre-inspect storage health: corrupt or blocked storage must halt immediately
  const inspection = inspectUnresolvedDisbursementStorage(
    record.workspaceId,
    record.userId,
  );
  if (inspection.status === 'corrupt' || inspection.status === 'blocked') {
    return {
      success: false,
      error: `Bộ nhớ lưu trữ giao dịch đang ở trạng thái không an toàn (${inspection.error}).`,
    };
  }

  try {
    const all = inspection.records;
    const itemKey = getDisbursementKey(
      record.workspaceId,
      record.userId,
      record.itemId,
      record.periodMonth,
    );
    if (!itemKey) {
      return {
        success: false,
        error: 'Không thể tạo khóa định danh giao dịch.',
      };
    }
    all.set(itemKey, validRecord);

    // 1. Write to sessionStorage
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify(Array.from(all.values())),
    );

    // 2. Mandatory read-back verification
    const readBackRaw = window.sessionStorage.getItem(storageKey);
    if (!readBackRaw) {
      return {
        success: false,
        error: 'Đọc lại từ sessionStorage trả về rỗng sau khi ghi.',
      };
    }

    const readBackParsed = JSON.parse(readBackRaw);
    if (!Array.isArray(readBackParsed)) {
      return {
        success: false,
        error:
          'Dữ liệu đọc lại từ sessionStorage không phải là danh sách hợp lệ.',
      };
    }

    const readBackRecord = readBackParsed.find(
      (r: unknown): r is Record<string, unknown> =>
        typeof r === 'object' &&
        r !== null &&
        (r as Record<string, unknown>).itemId === record.itemId &&
        (r as Record<string, unknown>).periodMonth === record.periodMonth &&
        (r as Record<string, unknown>).workspaceId === record.workspaceId &&
        (r as Record<string, unknown>).userId === record.userId,
    );

    if (!readBackRecord) {
      return {
        success: false,
        error:
          'Không tìm thấy bản ghi giao dịch trong dữ liệu đọc lại từ sessionStorage.',
      };
    }

    // Verify critical idempotency and payload fields match verbatim
    if (
      readBackRecord.idempotencyKey !== record.idempotencyKey ||
      readBackRecord.amount !== record.amount ||
      readBackRecord.method !== record.method ||
      readBackRecord.date !== record.date ||
      readBackRecord.note !== record.note
    ) {
      return {
        success: false,
        error:
          'Dữ liệu đọc lại từ sessionStorage không khớp với dữ liệu giao dịch cần lưu.',
      };
    }

    // Verify record count preserved
    if (readBackParsed.length !== all.size) {
      return {
        success: false,
        error:
          'Số lượng bản ghi sau khi đọc lại không khớp với số lượng cần lưu.',
      };
    }

    return { success: true };
  } catch (err: unknown) {
    return {
      success: false,
      error: `Lỗi truy xuất sessionStorage: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * FIX-70 (Q69-04): scoped, verified cleanup after a confirmed success.
 * Legacy duplicates for the same identity/item/month are purged first so they can
 * never resurrect; any failure keeps the pending record and reports the error.
 */
export function removeUnresolvedDisbursement(
  workspaceId: string | undefined,
  userId: string | undefined,
  itemId: string,
  periodMonth: string,
): StorageVerificationResult {
  if (!workspaceId || !userId) {
    return {
      success: false,
      error: 'Thiếu định danh workspace hoặc user để dọn bản ghi chờ.',
    };
  }
  const inspection = inspectUnresolvedDisbursementStorage(workspaceId, userId);
  if (inspection.status !== 'valid' && inspection.status !== 'absent') {
    return {
      success: false,
      error: inspection.error || 'Bộ nhớ giao dịch không an toàn.',
    };
  }
  for (const legKey of [
    'mgmt_lite_unresolved_disbursements_v1',
    `management_lite_unresolved_disbursements_${workspaceId}`,
  ]) {
    try {
      const raw = window.sessionStorage.getItem(legKey);
      if (raw === null) continue;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return { success: false, error: `Dữ liệu cũ ${legKey} không hợp lệ.` };
      }
      const remaining = parsed.filter((r) => {
        const o = (r && typeof r === 'object' ? r : {}) as Record<
          string,
          unknown
        >;
        return !(
          o.workspaceId === workspaceId &&
          o.userId === userId &&
          o.itemId === itemId &&
          o.periodMonth === periodMonth
        );
      });
      if (remaining.length === parsed.length) continue;
      const err =
        remaining.length === 0
          ? removeVerifiedItem(legKey)
          : writeVerifiedItem(legKey, JSON.stringify(remaining));
      if (err) return { success: false, error: err };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
  const all = inspection.records;
  const k = getDisbursementKey(workspaceId, userId, itemId, periodMonth);
  if (k && all.has(k)) {
    // FIX-72 (Q71-01): 1) persist + verify a recovery marker holding the original
    // key/payload; if that cannot be guaranteed, v2 is NOT touched. 2) write + verify
    // the reduced v2. 3) only then remove the marker. A failure at any step leaves the
    // marker (or the untouched record) so the operation is restored on next inspect
    // and is never mistaken for "no pending". No reliance on best-effort restore.
    const v2Key = getScopedDisbursementStorageKey(workspaceId, userId);
    if (!v2Key) {
      return { success: false, error: 'Không xác định được khóa lưu trữ.' };
    }
    const recoveryKey = getRecoveryStorageKey(v2Key);
    const markerErr = writeVerifiedItem(
      recoveryKey,
      JSON.stringify(Array.from(all.values())),
    );
    if (markerErr) {
      return {
        success: false,
        error: `Không thể lưu dấu khôi phục trước khi dọn (${markerErr}); bản ghi chờ giữ nguyên`,
      };
    }
    all.delete(k);
    const persistErr = writeVerifiedItem(
      v2Key,
      JSON.stringify(Array.from(all.values())),
    );
    if (persistErr) {
      return {
        success: false,
        error: `${persistErr}; dấu khôi phục được giữ để khôi phục khóa gốc`,
      };
    }
    const removeErr = removeVerifiedItem(recoveryKey);
    if (removeErr) {
      return {
        success: false,
        error: `Không xóa được dấu khôi phục (${removeErr}); khóa gốc sẽ được khôi phục khi kiểm tra lại`,
      };
    }
  }
  return { success: true };
}

export const PayrollScreen: React.FC<PayrollScreenProps> = ({
  role = 'owner',
  onNavigate,
  workspaceId: propWorkspaceId,
  currentUserId: propCurrentUserId,
}) => {
  // Current selected month
  const [selectedMonth, setSelectedMonth] = useState<string>(getCurrentMonth);

  // CSRF token, user and workspace context
  const [csrfToken, setCsrfToken] = useState<string>('');
  const [internalWorkspaceId, setInternalWorkspaceId] = useState<string>('');
  const [internalCurrentUserId, setInternalCurrentUserId] =
    useState<string>('');
  const workspaceId = propWorkspaceId ?? internalWorkspaceId;
  const currentUserId = propCurrentUserId ?? internalCurrentUserId;
  const setWorkspaceId = setInternalWorkspaceId;
  const setCurrentUserId = setInternalCurrentUserId;

  // Common UI states
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // OWNER STATE
  const [period, setPeriod] = useState<PayrollPeriodData | null>(null);
  const [items, setItems] = useState<PayrollEmployeeItemData[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<string | null>(
    null,
  );

  // STAFF STATE
  const [myPayslip, setMyPayslip] = useState<StaffPayslipData | null>(null);

  // MODAL STATES (Owner)
  const [showRateModal, setShowRateModal] = useState<boolean>(false);
  const [rateEmployee, setRateEmployee] =
    useState<PayrollEmployeeItemData | null>(null);
  const [rateAmount, setRateAmount] = useState<string>('30000');

  const [showLeaveModal, setShowLeaveModal] = useState<boolean>(false);
  const [leaveEmployee, setLeaveEmployee] =
    useState<PayrollEmployeeItemData | null>(null);
  const [leaveDate, setLeaveDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [leaveAmount, setLeaveAmount] = useState<string>('200000');
  const [leaveReason, setLeaveReason] = useState<string>('');

  const [showDisburseModal, setShowDisburseModal] = useState<boolean>(false);
  const [disburseEmployee, setDisburseEmployee] =
    useState<PayrollEmployeeItemData | null>(null);
  const [disburseAmount, setDisburseAmount] = useState<string>('');
  const [disburseMethod, setDisburseMethod] = useState<
    'bank_transfer' | 'cash' | 'other'
  >('bank_transfer');
  const [disburseDate, setDisburseDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [disburseNote, setDisburseNote] = useState<string>('');

  const [showFinalizeModal, setShowFinalizeModal] = useState<boolean>(false);

  // Stable Idempotency Keys for Finalize & Disbursement (Retries reuse key, new actions generate new key)
  const [finalizeIdempotencyKey, setFinalizeIdempotencyKey] =
    useState<string>('');
  const [disburseIdempotencyKey, setDisburseIdempotencyKey] =
    useState<string>('');
  const [isUnresolvedRetry, setIsUnresolvedRetry] = useState<boolean>(false);

  // Logical operation tracking for Paid Leave Adjustments (P1 - PAYROLL IDEMPOTENCY)
  const [pendingAdjustment, setPendingAdjustment] =
    useState<PendingAdjustmentOperation | null>(null);
  const pendingAdjustmentRef = useRef<PendingAdjustmentOperation | null>(null);
  const isSubmittingAdjustmentRef = useRef<boolean>(false);
  const sessionGenerationRef = useRef<number>(0);

  // Tracking unresolved disbursements per employee and month (QA62-02/03 & FA60-04)
  const [unresolvedDisbursements, setUnresolvedDisbursements] = useState<
    Map<string, UnresolvedDisbursementRecord>
  >(new Map());

  const refreshUnresolved = () => {
    if (workspaceId && currentUserId) {
      const inspection = inspectUnresolvedDisbursementStorage(
        workspaceId,
        currentUserId,
      );
      setUnresolvedDisbursements(inspection.records);
      if (inspection.status === 'corrupt' || inspection.status === 'blocked') {
        setErrorMessage(
          `Cảnh báo: Bộ nhớ lưu trữ giao dịch chi lương đang bị lỗi hoặc hỏng định dạng (${inspection.error}). Cần đối soát thủ công trước khi thực hiện chi trả.`,
        );
      }
    } else {
      setUnresolvedDisbursements(new Map());
    }
  };

  useEffect(() => {
    sessionGenerationRef.current++;
    refreshUnresolved();
    pendingAdjustmentRef.current = null;
    setPendingAdjustment(null);

    // FIX-70: pending records changed by another tab sharing this session or session switched
    const onStorage = async () => {
      try {
        const id = await fetchCanonicalSessionIdentity();
        if (
          id &&
          (id.workspaceId !== workspaceId || id.userId !== currentUserId)
        ) {
          sessionGenerationRef.current++;
          setWorkspaceId(id.workspaceId);
          setCurrentUserId(id.userId);
        }
      } catch {
        // Fallback silently if session check fails
      }
      refreshUnresolved();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [workspaceId, currentUserId]);

  // Stale request guards & cancellation for month switching (FA60-02)
  const fetchRequestIdRef = useRef<number>(0);
  const activeAbortControllerRef = useRef<AbortController | null>(null);

  // 1. Initial Load: Fetch CSRF token and auth context (Q67-04 strict canonical)
  useEffect(() => {
    let active = true;
    const fetchSession = async () => {
      try {
        const res = await fetch('/api/v1/auth/me', { credentials: 'include' });
        if (res.ok) {
          const body = await res.json();
          if (
            active &&
            body &&
            body.success === true &&
            body.data &&
            typeof body.data === 'object'
          ) {
            if (typeof body.data.csrf_token === 'string') {
              setCsrfToken(body.data.csrf_token);
            }
            const rawUserId = body.data.user?.id;
            if (typeof rawUserId === 'string' && rawUserId.trim().length > 0) {
              setCurrentUserId(rawUserId.trim());
            } else {
              setCurrentUserId('');
            }
            // Q67-04: Strict canonical active_workspace.id validation without fallback alias
            const rawWsId = body.data.active_workspace?.id;
            if (typeof rawWsId === 'string' && rawWsId.trim().length > 0) {
              setWorkspaceId(rawWsId.trim());
            } else {
              setWorkspaceId('');
            }
          } else if (active) {
            setCurrentUserId('');
            setWorkspaceId('');
          }
        } else if (active) {
          setCurrentUserId('');
          setWorkspaceId('');
        }
      } catch {
        // Ignored
      }
    };
    fetchSession();
    return () => {
      active = false;
    };
  }, []);

  // 2. Fetch payroll data whenever selectedMonth or role changes (with stale response guard)
  const loadData = async (targetMonth = selectedMonth, targetRole = role) => {
    // Abort previous in-flight request
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    activeAbortControllerRef.current = controller;
    const requestId = ++fetchRequestIdRef.current;

    setLoading(true);
    setErrorMessage(null);

    try {
      if (targetRole === 'owner') {
        const res = await fetch(`/api/v1/payroll/periods/${targetMonth}`, {
          credentials: 'include',
          signal: controller.signal,
        });

        // Sequence check after headers
        if (requestId !== fetchRequestIdRef.current) return;

        if (res.ok) {
          const body: { success: boolean; data: PayrollMonthOverviewData } =
            await res.json();
          // Sequence check after JSON
          if (requestId !== fetchRequestIdRef.current) return;

          if (body.success && body.data) {
            setPeriod(body.data.period);
            setItems(
              (body.data.items || []).map((it) => ({
                ...it,
                confirmed: it.confirmed ?? {
                  approved_worked_minutes: 0,
                  base_pay_vnd: 0,
                  paid_leave_pay_vnd: 0,
                  net_pay_vnd: 0,
                  paid_amount_vnd: 0,
                  payment_status: 'unpaid',
                },
              })),
            );
          }
        } else {
          const err = await res.json().catch(() => ({}));
          if (requestId !== fetchRequestIdRef.current) return;

          if (err.error?.code === 'MISSING_HOURLY_RATE') {
            const empDetail = err.error?.details?.find(
              (d: { field?: string; message?: string }) =>
                d.field === 'employee_id',
            );
            setErrorMessage(
              `Chưa thiết lập mức lương theo giờ cho nhân sự có ca làm việc trong kỳ${empDetail ? ` (ID: ${empDetail.message})` : ''}. Vui lòng thiết lập đơn giá theo giờ để hệ thống tính toán bảng lương.`,
            );
          } else {
            setErrorMessage(
              err.error?.message || 'Không thể tải dữ liệu bảng lương tháng.',
            );
          }
        }
      } else {
        // Staff view own payslip
        const res = await fetch(`/api/v1/payroll/periods/${targetMonth}/me`, {
          credentials: 'include',
          signal: controller.signal,
        });

        if (requestId !== fetchRequestIdRef.current) return;

        if (res.ok) {
          const body: { success: boolean; data: StaffPayslipData } =
            await res.json();
          if (requestId !== fetchRequestIdRef.current) return;

          if (body.success && body.data) {
            setMyPayslip(body.data);
          }
        } else {
          const err = await res.json().catch(() => ({}));
          if (requestId !== fetchRequestIdRef.current) return;

          setErrorMessage(
            err.error?.message ||
              'Không tìm thấy phiếu lương cá nhân cho tháng này.',
          );
          setMyPayslip(null);
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Aborted request: discard silently without overwriting active state
        return;
      }
      if (requestId === fetchRequestIdRef.current) {
        setErrorMessage('Lỗi mạng khi tải dữ liệu bảng lương.');
      }
    } finally {
      if (requestId === fetchRequestIdRef.current) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadData(selectedMonth, role);
    return () => {
      // Invalidate sequence and abort on unmount or dependency change
      ++fetchRequestIdRef.current;
      if (activeAbortControllerRef.current) {
        activeAbortControllerRef.current.abort();
      }
    };
  }, [selectedMonth, role]);

  // Filtered employees list for Owner view
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase().trim();
    return items.filter(
      (item) =>
        item.employee_code.toLowerCase().includes(q) ||
        item.full_name.toLowerCase().includes(q),
    );
  }, [items, searchQuery]);

  // Client-side pagination over the already-loaded list (totals use ALL rows)
  const [itemsPage, setItemsPage] = useState<number>(0);
  const [itemsPageSize, setItemsPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const safeItemsPage = clampPage(
    itemsPage,
    filteredItems.length,
    itemsPageSize,
  );
  const pagedItems = useMemo(
    () =>
      filteredItems.slice(
        safeItemsPage * itemsPageSize,
        (safeItemsPage + 1) * itemsPageSize,
      ),
    [filteredItems, safeItemsPage, itemsPageSize],
  );

  // Aggregate metrics for Owner view
  const aggregateMetrics = useMemo(() => {
    let totalBasePay = 0;
    let totalPaidLeave = 0;
    let totalNetPay = 0;
    let totalPaid = 0;
    let totalPendingPay = 0;
    let totalPendingMinutes = 0;
    let totalLivePay = 0;
    let workingEmployeesCount = 0;

    for (const item of items) {
      totalBasePay += item.confirmed.base_pay_vnd || 0;
      totalPaidLeave += item.confirmed.paid_leave_pay_vnd || 0;
      totalNetPay += item.confirmed.net_pay_vnd || 0;
      totalPaid += item.confirmed.paid_amount_vnd || 0;

      totalPendingPay += item.pending_review?.estimated_pay_vnd || 0;
      totalPendingMinutes += item.pending_review?.pending_minutes || 0;

      totalLivePay += item.live_provisional?.live_pay_vnd || 0;
      if (item.live_provisional?.has_open_shift) {
        workingEmployeesCount += 1;
      }
    }

    return {
      totalBasePay,
      totalPaidLeave,
      totalNetPay,
      totalPaid,
      remainingToPay: Math.max(0, totalNetPay - totalPaid),
      totalPendingPay,
      totalPendingMinutes,
      totalLivePay,
      workingEmployeesCount,
    };
  }, [items]);

  // Action: Save Hourly Rate (API-PAY-02)
  const handleSaveRate = async () => {
    if (!rateEmployee) return;
    const amount = parseInt(rateAmount, 10);
    if (isNaN(amount) || amount <= 0) {
      setErrorMessage('Đơn giá theo giờ phải là số nguyên dương.');
      return;
    }

    setActionLoading(true);
    setErrorMessage(null);
    try {
      const payload: Omit<SetHourlyRateRequest, 'effective_from'> = {
        employee_id: rateEmployee.employee_id,
        hourly_rate_vnd: amount,
      };

      const res = await fetch('/api/v1/payroll/hourly-rates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setSuccessMessage(
          `Đã thiết lập đơn giá ${formatVnd(amount)}/giờ cho ${rateEmployee.full_name}.`,
        );
        setShowRateModal(false);
        await loadData();
      } else {
        const err = await res.json().catch(() => ({}));
        setErrorMessage(
          err.error?.message || 'Không thể lưu đơn giá theo giờ.',
        );
      }
    } catch {
      setErrorMessage('Lỗi kết nối khi lưu đơn giá.');
    } finally {
      setActionLoading(false);
    }
  };

  // Action: Add Paid Leave (API-PAY-06) with Idempotent Pending Operation Tracking
  const handleSavePaidLeave = async () => {
    // 1. Synchronous lock ref before ANY await: concurrent submit drops immediately
    if (isSubmittingAdjustmentRef.current) {
      return;
    }
    isSubmittingAdjustmentRef.current = true;

    if (!leaveEmployee) {
      setErrorMessage('Không xác định được nhân viên.');
      isSubmittingAdjustmentRef.current = false;
      return;
    }

    // 2. Strict identity verification: NO fallbacks to 'w1' or 'u1'
    if (
      !workspaceId ||
      typeof workspaceId !== 'string' ||
      workspaceId.trim().length === 0 ||
      !currentUserId ||
      typeof currentUserId !== 'string' ||
      currentUserId.trim().length === 0
    ) {
      setErrorMessage(
        'Không thể xác minh danh tính người dùng hoặc không gian làm việc. Thao tác bị từ chối để bảo vệ dữ liệu.',
      );
      isSubmittingAdjustmentRef.current = false;
      return;
    }

    const sessionIdentity = await fetchCanonicalSessionIdentity();
    if (
      !sessionIdentity ||
      sessionIdentity.workspaceId !== workspaceId ||
      sessionIdentity.userId !== currentUserId
    ) {
      setErrorMessage(
        'Phiên làm việc hoặc không gian làm việc đã thay đổi hoặc không hợp lệ. Vui lòng tải lại trang.',
      );
      isSubmittingAdjustmentRef.current = false;
      return;
    }

    const currentSessionGen = sessionGenerationRef.current;
    const activeWs = workspaceId;
    const activeActor = currentUserId;

    const amount = Number(leaveAmount);
    if (isNaN(amount) || amount <= 0) {
      setErrorMessage('Số tiền trợ cấp nghỉ phép phải là số nguyên dương.');
      isSubmittingAdjustmentRef.current = false;
      return;
    }
    if (!leaveReason.trim()) {
      setErrorMessage('Lý do nghỉ có lương là bắt buộc.');
      isSubmittingAdjustmentRef.current = false;
      return;
    }
    if (!leaveDate) {
      setErrorMessage('Vui lòng chọn ngày áp dụng nghỉ phép.');
      isSubmittingAdjustmentRef.current = false;
      return;
    }

    const payload: CreateAdjustmentRequest = {
      employee_id: leaveEmployee.employee_id,
      adjustment_type: 'paid_leave',
      attributable_date: leaveDate,
      amount_vnd: amount,
      reason: leaveReason.trim(),
    };

    const currentFingerprint = computeAdjustmentFingerprint(payload);

    // Logical operation check (PAYROLL IDEMPOTENCY) from multi-op registry
    const existing =
      loadPendingAdjustmentFromStorage(
        activeWs,
        activeActor,
        leaveEmployee.employee_id,
        selectedMonth,
      ) ||
      (pendingAdjustmentRef.current?.employeeId === leaveEmployee.employee_id &&
      pendingAdjustmentRef.current?.month === selectedMonth
        ? pendingAdjustmentRef.current
        : null);

    let idempotencyKey: string;
    let operationId: string;

    if (
      existing &&
      (existing.status === 'unresolved' ||
        existing.status === 'error_unresolved' ||
        existing.status === 'in_flight')
    ) {
      if (existing.fingerprint === currentFingerprint) {
        // Reuse exact same key on retry of unresolved operation!
        idempotencyKey = existing.key;
        operationId = existing.operationId;
      } else {
        setErrorMessage(
          'Thao tác điều chỉnh trước đó chưa rõ kết quả trên máy chủ. Bạn không thể thay đổi thông tin khi thao tác cũ chưa được giải quyết. Vui lòng thử lại với thông tin ban đầu hoặc kiểm tra trạng thái.',
        );
        isSubmittingAdjustmentRef.current = false;
        return;
      }
    } else {
      idempotencyKey = crypto.randomUUID();
      operationId = crypto.randomUUID();
    }

    const currentOp: PendingAdjustmentOperation = {
      operationId,
      workspaceId: activeWs,
      actorId: activeActor,
      employeeId: leaveEmployee.employee_id,
      month: selectedMonth,
      key: idempotencyKey,
      payload,
      fingerprint: currentFingerprint,
      status: 'in_flight',
      createdAt: existing?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };
    pendingAdjustmentRef.current = currentOp;
    setPendingAdjustment(currentOp);

    // Fail-closed storage write: If storage write fails, do not silently send request
    const writeOk = savePendingAdjustmentToStorage(currentOp);
    if (!writeOk) {
      isSubmittingAdjustmentRef.current = false;
      setErrorMessage(
        'Không thể lưu vết thao tác cục bộ để đảm bảo an toàn giao dịch. Yêu cầu đã bị hủy để tránh rủi ro trùng lặp.',
      );
      return;
    }

    setActionLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/v1/payroll/periods/${selectedMonth}/adjustments`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
            'If-Match': `"${period?.version ?? 1}"`,
            'Idempotency-Key': idempotencyKey,
          },
          credentials: 'include',
          body: JSON.stringify(payload),
        },
      );

      // Verify session identity has not changed while request was in flight
      if (
        sessionGenerationRef.current !== currentSessionGen ||
        workspaceId !== activeWs ||
        currentUserId !== activeActor
      ) {
        return;
      }

      const latestSession = await fetchCanonicalSessionIdentity();
      if (
        !latestSession ||
        latestSession.workspaceId !== activeWs ||
        latestSession.userId !== activeActor
      ) {
        sessionGenerationRef.current++;
        return;
      }

      if (res.ok) {
        currentOp.status = 'confirmed';
        currentOp.updatedAt = Date.now();
        clearPendingAdjustmentFromStorage(
          activeWs,
          activeActor,
          operationId,
          leaveEmployee.employee_id,
          selectedMonth,
        );
        if (pendingAdjustmentRef.current?.operationId === operationId) {
          pendingAdjustmentRef.current = null;
          setPendingAdjustment(null);
        }
        setSuccessMessage(
          `Đã ghi nhận nghỉ có lương ${formatVnd(amount)} cho ${leaveEmployee.full_name}.`,
        );
        setShowLeaveModal(false);
        setLeaveReason('');
        await loadData();
      } else {
        const err = await res.json().catch(() => ({}));
        if (res.status === 409) {
          currentOp.status = 'rejected';
          currentOp.updatedAt = Date.now();
          clearPendingAdjustmentFromStorage(
            activeWs,
            activeActor,
            operationId,
            leaveEmployee.employee_id,
            selectedMonth,
          );
          if (pendingAdjustmentRef.current?.operationId === operationId) {
            pendingAdjustmentRef.current = null;
            setPendingAdjustment(null);
          }
          setErrorMessage(
            'Kỳ tính lương đã chốt sổ bất biến, không thể thêm điều chỉnh hoặc ngày nghỉ có lương.',
          );
        } else if (res.status === 412) {
          currentOp.status = 'rejected';
          currentOp.updatedAt = Date.now();
          clearPendingAdjustmentFromStorage(
            activeWs,
            activeActor,
            operationId,
            leaveEmployee.employee_id,
            selectedMonth,
          );
          if (pendingAdjustmentRef.current?.operationId === operationId) {
            pendingAdjustmentRef.current = null;
            setPendingAdjustment(null);
          }
          setErrorMessage(
            'Dữ liệu kỳ lương đã được cập nhật bởi phiên làm việc khác. Vui lòng tải lại trang.',
          );
        } else {
          currentOp.status = 'unresolved';
          currentOp.updatedAt = Date.now();
          currentOp.error = err.error?.message || 'Lỗi xử lý yêu cầu';
          savePendingAdjustmentToStorage(currentOp);
          if (pendingAdjustmentRef.current?.operationId === operationId) {
            pendingAdjustmentRef.current = currentOp;
            setPendingAdjustment(currentOp);
          }
          setErrorMessage(
            err.error?.message ||
              'Không thể ghi nhận điều chỉnh / nghỉ có lương.',
          );
        }
      }
    } catch {
      if (
        sessionGenerationRef.current !== currentSessionGen ||
        workspaceId !== activeWs ||
        currentUserId !== activeActor
      ) {
        return;
      }
      const latestSession = await fetchCanonicalSessionIdentity();
      if (
        !latestSession ||
        latestSession.workspaceId !== activeWs ||
        latestSession.userId !== activeActor
      ) {
        sessionGenerationRef.current++;
        return;
      }
      currentOp.status = 'unresolved';
      currentOp.updatedAt = Date.now();
      currentOp.error = 'Lỗi kết nối';
      savePendingAdjustmentToStorage(currentOp);
      if (pendingAdjustmentRef.current?.operationId === operationId) {
        pendingAdjustmentRef.current = currentOp;
        setPendingAdjustment(currentOp);
      }
      setErrorMessage(
        'Lỗi kết nối khi ghi nhận nghỉ có lương. Thao tác có thể đã được tiếp nhận; vui lòng thử lại.',
      );
    } finally {
      isSubmittingAdjustmentRef.current = false;
      setActionLoading(false);
    }
  };

  // Helper: Open finalize modal with freshly generated Idempotency-Key
  const openFinalizeModal = () => {
    setFinalizeIdempotencyKey(crypto.randomUUID());
    setErrorMessage(null);
    setShowFinalizeModal(true);
  };

  // Action: Finalize Period (API-PAY-07)
  const handleFinalizePeriod = async () => {
    if (!period) return;
    setActionLoading(true);
    setErrorMessage(null);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        'If-Match': `"${period.version ?? 1}"`,
      };
      if (finalizeIdempotencyKey) {
        headers['Idempotency-Key'] = finalizeIdempotencyKey;
      }

      const res = await fetch(
        `/api/v1/payroll/periods/${selectedMonth}/finalize`,
        {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify({}),
        },
      );

      if (res.ok) {
        const body = await res.json();
        setSuccessMessage(
          `Đã chốt sổ bảng lương tháng ${selectedMonth} thành công. Dữ liệu đã chuyển sang trạng thái bất biến.`,
        );
        setShowFinalizeModal(false);
        setFinalizeIdempotencyKey('');
        setPeriod(body.data);
        await loadData();
      } else {
        const err = await res.json().catch(() => ({}));
        if (err.error?.code === 'MISSING_HOURLY_RATE') {
          setErrorMessage(
            'Không thể chốt kỳ lương: Một số nhân viên chưa được thiết lập đơn giá theo giờ.',
          );
        } else if (err.error?.code === 'NEGATIVE_NET_PAY') {
          setErrorMessage(
            'Không thể chốt kỳ lương: Có nhân viên có tổng thực nhận âm (< 0 đ).',
          );
        } else if (res.status === 412) {
          setErrorMessage(
            'Dữ liệu kỳ lương đã được cập nhật bởi phiên làm việc khác. Vui lòng tải lại trang.',
          );
        } else {
          setErrorMessage(err.error?.message || 'Không thể chốt kỳ lương.');
        }
      }
    } catch {
      setErrorMessage('Lỗi kết nối khi chốt kỳ lương.');
    } finally {
      setActionLoading(false);
    }
  };

  // Action: Record Disbursement (API-PAY-08)
  const handleSaveDisbursement = async () => {
    if (period?.status !== 'finalized') {
      setErrorMessage(
        'Không thể chi lương: Kỳ lương hiện tại là bản nháp tạm tính, chưa chốt sổ (phải ở trạng thái finalized).',
      );
      return;
    }
    if (period?.period_month !== selectedMonth) {
      setErrorMessage(
        'Không thể chi lương: Kỳ lương đang thao tác không khớp với tháng được chọn.',
      );
      return;
    }
    if (!disburseEmployee || !disburseEmployee.id) {
      setErrorMessage(
        'Không thể ghi nhận chi lương: Khoản lương chưa được chốt hoặc thiếu ID bản ghi.',
      );
      return;
    }
    const amount = parseInt(disburseAmount, 10);
    if (isNaN(amount) || amount <= 0) {
      setErrorMessage('Số tiền chi lương phải là số nguyên dương.');
      return;
    }
    const remaining =
      (disburseEmployee.confirmed.net_pay_vnd || 0) -
      (disburseEmployee.confirmed.paid_amount_vnd || 0);
    if (!isUnresolvedRetry && amount > remaining) {
      setErrorMessage(
        `Số tiền chi ${formatVnd(amount)} vượt quá số tiền còn lại cần chi ${formatVnd(remaining)}.`,
      );
      return;
    }
    if (!disburseDate) {
      setErrorMessage('Vui lòng chọn ngày chi trả.');
      return;
    }

    // 1. Identity & Workspace Verification Gate (Q65-02 & Q67-04)
    if (!workspaceId || !currentUserId) {
      setErrorMessage(
        'Danh tính người dùng hoặc không gian làm việc chưa được xác thực (active_workspace.id hoặc user.id không hợp lệ). Thao tác chi trả bị chặn để bảo vệ an toàn tài chính.',
      );
      return;
    }

    // 1b. Live canonical session re-verification (cross-tab / identity change while mounted)
    setActionLoading(true);
    const live = await fetchCanonicalSessionIdentity();
    if (
      !live ||
      live.userId !== currentUserId ||
      live.workspaceId !== workspaceId
    ) {
      setActionLoading(false);
      if (live) {
        setCurrentUserId(live.userId);
        setWorkspaceId(live.workspaceId);
        setShowDisburseModal(false);
        setDisburseEmployee(null);
        setDisburseIdempotencyKey('');
        setDisburseNote('');
        setIsUnresolvedRetry(false);
      }
      setErrorMessage(
        live
          ? 'Phiên đăng nhập hoặc không gian làm việc đã thay đổi. Thao tác chi trả bị hủy, chưa gửi yêu cầu nào; vui lòng mở lại từ đầu.'
          : 'Không xác minh được danh tính hiện tại từ máy chủ. Thao tác chi trả bị chặn, chưa gửi yêu cầu nào.',
      );
      return;
    }

    // 2. Storage Inspection & Ambiguous Legacy Gate (Q67-02 & Q67-03)
    const inspection = inspectUnresolvedDisbursementStorage(
      workspaceId,
      currentUserId,
    );
    if (inspection.status === 'corrupt' || inspection.status === 'blocked') {
      setActionLoading(false);
      setErrorMessage(
        `Không thể thực hiện chi trả: Bộ nhớ giao dịch đang bị lỗi hoặc hỏng định dạng (${inspection.error}). Thao tác bị dừng để bảo vệ an toàn tài chính và dữ liệu đối soát.`,
      );
      return;
    }

    const itemKeyId = disburseEmployee.id || disburseEmployee.employee_id;
    if (
      inspection.ambiguousLegacyKeys.has(
        `${workspaceId}:${itemKeyId}:${selectedMonth}`,
      )
    ) {
      setActionLoading(false);
      setErrorMessage(
        'Phát hiện giao dịch chưa rõ kết quả phiên bản cũ (v1) cho khoản lương này nhưng không xác minh được danh tính người tạo hoặc khóa xung đột. Thao tác chi lương bị khóa để đối soát.',
      );
      return;
    }

    const storeKey = getDisbursementKey(
      workspaceId,
      currentUserId,
      disburseEmployee.id,
      selectedMonth,
    );
    const existingRecord = inspection.records.get(storeKey);

    // QA62-02/03 + FIX-70: any stored pending record for this item-month (also one
    // written by another tab while mounted) must match key and payload exactly.
    if (existingRecord) {
      if (
        existingRecord.amount !== String(amount) ||
        existingRecord.method !== disburseMethod ||
        existingRecord.date !== disburseDate ||
        existingRecord.note !== disburseNote ||
        existingRecord.idempotencyKey !== disburseIdempotencyKey
      ) {
        setActionLoading(false);
        setErrorMessage(
          'Thao tác bị chặn: Không được phép sửa đổi dữ liệu khi đang thử lại giao dịch chưa rõ kết quả. Phải giữ nguyên Idempotency Key và toàn bộ nội dung ban đầu.',
        );
        return;
      }
    }

    const currentKey =
      disburseIdempotencyKey ||
      (existingRecord ? existingRecord.idempotencyKey : crypto.randomUUID());
    const pendingOp: UnresolvedDisbursementRecord = {
      workspaceId,
      userId: currentUserId,
      itemId: disburseEmployee.id,
      employeeId: disburseEmployee.employee_id,
      periodMonth: selectedMonth,
      idempotencyKey: currentKey,
      amount: String(amount),
      method: disburseMethod,
      date: disburseDate,
      note: disburseNote,
      createdAt: existingRecord ? existingRecord.createdAt : Date.now(),
    };

    // 2. Fail-Closed Persistence & Read-Back Gate BEFORE POST (Q65-01)
    const saveResult = saveAndVerifyUnresolvedDisbursement(pendingOp);
    if (!saveResult.success) {
      setActionLoading(false);
      setErrorMessage(
        `Không thể lưu và xác thực trạng thái giao dịch an toàn vào phiên làm việc: ${saveResult.error}. Thao tác chi trả bị dừng để đảm bảo an toàn tài chính, tránh trùng lặp.`,
      );
      return;
    }
    refreshUnresolved();

    setActionLoading(true);
    setErrorMessage(null);
    try {
      const payload: CreateDisbursementRequest = {
        amount_vnd: amount,
        payment_method: disburseMethod,
        payment_date: disburseDate,
        ...(disburseNote.trim() ? { reference_note: disburseNote.trim() } : {}),
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        'If-Match': `"${disburseEmployee.version || 1}"`,
      };
      if (currentKey) {
        headers['Idempotency-Key'] = currentKey;
      }

      const res = await fetch(
        `/api/v1/payroll/items/${disburseEmployee.id}/disbursements`,
        {
          method: 'POST',
          headers,
          credentials: 'include',
          body: JSON.stringify(payload),
        },
      );

      // Q67-01: Strict canonical DTO response validation matching original operation payload
      let resBody: {
        success?: boolean;
        data?: unknown;
        [key: string]: unknown;
      } | null = null;
      try {
        resBody = await res.json();
      } catch {
        resBody = null;
      }

      const isSuccessEnvelope =
        Boolean(res.ok && resBody && resBody.success === true) &&
        validateDisbursementSuccessResponse(res.ok, resBody, {
          amount,
          payment_method: disburseMethod,
          payment_date: disburseDate,
          reference_note: disburseNote,
        });

      if (isSuccessEnvelope) {
        // Operation definitively succeeded: remove from unresolved store
        const cleanup = removeUnresolvedDisbursement(
          workspaceId,
          currentUserId,
          disburseEmployee.id,
          selectedMonth,
        );
        refreshUnresolved();
        if (!cleanup.success) {
          // Server confirmed, but local pending cleanup failed: keep the pending
          // operation (same key/payload) so no new key can replace it.
          setIsUnresolvedRetry(true);
          await loadData(selectedMonth, role);
          setErrorMessage(
            `Máy chủ đã xác nhận chi trả nhưng không thể dọn bản ghi chờ cục bộ (${cleanup.error}). Giữ nguyên khóa gốc và nội dung; KHÔNG tạo giao dịch mới. Bấm thử lại an toàn để hoàn tất đối soát.`,
          );
          return;
        }
        setSuccessMessage(
          `Đã chi ${formatVnd(amount)} cho nhân viên ${disburseEmployee.full_name}.`,
        );
        setShowDisburseModal(false);
        setDisburseIdempotencyKey('');
        setDisburseNote('');
        setIsUnresolvedRetry(false);
        await loadData(selectedMonth, role);
      } else {
        // QA62-02/03, Q65-03, Q67-01: On error, malformed envelope, or mismatch,
        // NEVER delete the unresolved operation! Retain pending record and original key.
        setIsUnresolvedRetry(true);
        refreshUnresolved();

        const errorObj =
          resBody && typeof resBody === 'object'
            ? (resBody as { error?: { code?: string; message?: string } }).error
            : undefined;

        if (res.status === 401) {
          setErrorMessage(
            'Phiên đăng nhập đã hết hạn (HTTP 401). Kết quả giao dịch chưa được xác nhận; thông tin chi lương và Idempotency Key được bảo lưu an toàn. Vui lòng đăng nhập lại để thử lại.',
          );
        } else if (res.status === 403) {
          setErrorMessage(
            'Bạn không có quyền thực hiện chi trả (HTTP 403). Giao dịch chưa rõ kết quả được bảo lưu an toàn để đối soát.',
          );
        } else if (res.status === 409) {
          setErrorMessage(
            'Xung đột trạng thái kỳ lương hoặc phiên bản bản ghi (HTTP 409). Giao dịch chưa rõ kết quả được bảo lưu để đối soát an toàn.',
          );
        } else if (errorObj?.code === 'OVERPAYMENT_BLOCKED') {
          setErrorMessage(
            'Thao tác bị chặn (OVERPAYMENT_BLOCKED): Số tiền chi vượt quá tổng thực nhận còn lại của nhân viên (giao dịch ban đầu có thể đã được ghi nhận trên máy chủ). Giao dịch được bảo lưu để đối soát.',
          );
        } else if (errorObj?.message) {
          setErrorMessage(`Lỗi từ máy chủ: ${errorObj.message}`);
        } else if (res.ok) {
          setErrorMessage(
            'Phản hồi từ máy chủ không khớp với giao dịch chi lương hoặc sai định dạng hợp đồng. Giao dịch được bảo lưu an toàn để đối soát, không ghi nhận thành công.',
          );
        } else {
          setErrorMessage(
            `Giao dịch chi lương chưa được xác nhận (HTTP ${res.status}). Thông tin giao dịch được bảo lưu an toàn với cùng Idempotency Key để thử lại.`,
          );
        }
      }
    } catch {
      // Network failure / connection lost / timeout: keep key for safe retry!
      setIsUnresolvedRetry(true);
      refreshUnresolved();
      setErrorMessage(
        'Lỗi kết nối khi chi lương. Kết quả giao dịch chưa được xác nhận từ máy chủ. Vui lòng bấm thử lại để tiếp tục với cùng mã giao dịch an toàn (Idempotency Key).',
      );
    } finally {
      setActionLoading(false);
    }
  };

  // Helper: Open disburse modal with prefilled remaining amount and fresh or preserved Idempotency-Key
  const openDisburseModal = (item: PayrollEmployeeItemData) => {
    if (period?.status !== 'finalized') {
      setErrorMessage(
        'Kỳ lương hiện tại là bản nháp tạm tính (chưa chốt). Chỉ có thể chi lương sau khi kỳ lương đã được chốt sổ (finalized).',
      );
      return;
    }
    if (period?.period_month !== selectedMonth) {
      setErrorMessage(
        'Dữ liệu kỳ lương đang xem không khớp với tháng được chọn. Vui lòng tải lại trang.',
      );
      return;
    }

    // Storage health & ambiguous legacy check before modal opening & key generation (Q67-02 & Q67-03)
    if (workspaceId && currentUserId) {
      const inspection = inspectUnresolvedDisbursementStorage(
        workspaceId,
        currentUserId,
      );
      if (inspection.status === 'corrupt' || inspection.status === 'blocked') {
        setErrorMessage(
          `Không thể thực hiện chi trả: Bộ nhớ giao dịch đang bị lỗi hoặc hỏng định dạng (${inspection.error}). Cần đối soát thủ công trước khi thực hiện.`,
        );
        return;
      }
      const itemKeyId = item.id || item.employee_id;
      if (
        itemKeyId &&
        inspection.ambiguousLegacyKeys.has(
          `${workspaceId}:${itemKeyId}:${selectedMonth}`,
        )
      ) {
        setErrorMessage(
          'Phát hiện giao dịch chưa rõ kết quả phiên bản cũ (v1) cho khoản lương này nhưng không xác minh được danh tính người tạo. Thao tác chi lương bị khóa để đối soát.',
        );
        return;
      }
    }

    setDisburseEmployee(item);
    const storeKey = getDisbursementKey(
      workspaceId,
      currentUserId,
      item.id || item.employee_id,
      selectedMonth,
    );
    const existingUnresolved = loadAllUnresolvedDisbursements(
      workspaceId,
      currentUserId,
    ).get(storeKey);

    if (existingUnresolved) {
      // FA60-04 & QA62-02/03: Retain exact idempotency key and immutable payload for unresolved operation retry
      setDisburseIdempotencyKey(existingUnresolved.idempotencyKey);
      setDisburseAmount(existingUnresolved.amount);
      setDisburseMethod(existingUnresolved.method);
      setDisburseDate(existingUnresolved.date);
      setDisburseNote(existingUnresolved.note);
      setIsUnresolvedRetry(true);
    } else {
      const rem =
        (item.confirmed.net_pay_vnd || 0) -
        (item.confirmed.paid_amount_vnd || 0);
      setDisburseAmount(rem > 0 ? String(rem) : '0');
      setDisburseNote('');
      setDisburseMethod('bank_transfer');
      const d = new Date();
      setDisburseDate(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      );
      setDisburseIdempotencyKey(crypto.randomUUID());
      setIsUnresolvedRetry(false);
    }
    setErrorMessage(null);
    setShowDisburseModal(true);
  };

  // Helper: Close disburse modal without discarding unresolved operations
  const closeDisburseModal = () => {
    setShowDisburseModal(false);
    const unresolvedKey = disburseEmployee
      ? getDisbursementKey(
          workspaceId,
          currentUserId,
          disburseEmployee.id || disburseEmployee.employee_id,
          selectedMonth,
        )
      : '';
    if (!unresolvedDisbursements.has(unresolvedKey)) {
      setDisburseIdempotencyKey('');
      setDisburseNote('');
      setIsUnresolvedRetry(false);
    }
    setDisburseEmployee(null);
  };

  // Helper: Close finalize modal and reset idempotency key
  const closeFinalizeModal = () => {
    setShowFinalizeModal(false);
    setFinalizeIdempotencyKey('');
  };

  // Helper: Open hourly rate modal with safe null rate check
  const openRateModal = (item: PayrollEmployeeItemData) => {
    setRateEmployee(item);
    setRateAmount(
      item.hourly_rate_vnd != null && item.hourly_rate_vnd > 0
        ? String(item.hourly_rate_vnd)
        : '30000',
    );
    setShowRateModal(true);
  };

  // Helper: Open paid leave modal
  const openLeaveModal = (item: PayrollEmployeeItemData) => {
    setLeaveEmployee(item);
    if (!workspaceId || !currentUserId) {
      setLeaveAmount('200000');
      setLeaveReason('');
      const d = new Date();
      setLeaveDate(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      );
      setShowLeaveModal(true);
      return;
    }

    const existing =
      pendingAdjustmentRef.current &&
      pendingAdjustmentRef.current.employeeId === item.employee_id &&
      pendingAdjustmentRef.current.month === selectedMonth
        ? pendingAdjustmentRef.current
        : loadPendingAdjustmentFromStorage(
            workspaceId,
            currentUserId,
            item.employee_id,
            selectedMonth,
          );

    if (
      existing &&
      (existing.status === 'unresolved' ||
        existing.status === 'error_unresolved' ||
        existing.status === 'in_flight')
    ) {
      setLeaveAmount(String(existing.payload.amount_vnd));
      setLeaveReason(existing.payload.reason);
      setLeaveDate(existing.payload.attributable_date || '');
      pendingAdjustmentRef.current = existing;
      setPendingAdjustment(existing);
    } else {
      setLeaveAmount('200000');
      setLeaveReason('');
      const d = new Date();
      setLeaveDate(
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      );
      if (pendingAdjustmentRef.current?.employeeId !== item.employee_id) {
        setPendingAdjustment(null);
      }
    }
    setShowLeaveModal(true);
  };

  const closeLeaveModal = () => {
    setShowLeaveModal(false);
  };

  return (
    <div
      style={{
        padding: '0',
        width: '100%',
        color: 'var(--text-color)',
      }}
    >
      {/* 1. Page Header */}
      <PageHeader
        title={role === 'owner' ? 'Quản lý bảng lương' : 'Phiếu lương của tôi'}
        subtitle={
          role === 'owner'
            ? 'Theo dõi tiền lương, chốt kỳ lương và ghi nhận chi trả theo nguyên tắc POLICY-01'
            : 'Chi tiết tiền công được tính theo giờ làm thực tế và các khoản thanh toán'
        }
        actions={
          role === 'owner' ? (
            <AppButton
              variant="secondary"
              onClick={() => onNavigate?.('/payroll/stats')}
            >
              Thống kê & Excel
            </AppButton>
          ) : undefined
        }
      />

      {/* 2. Global Feedback Alerts */}
      {successMessage && (
        <div
          style={{
            marginTop: '16px',
            padding: '12px 16px',
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid #10B981',
            borderRadius: '8px',
            color: 'var(--success-text)',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckIcon size={16} />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--success-text)',
              cursor: 'pointer',
            }}
          >
            <CloseIcon size={16} />
          </button>
        </div>
      )}

      {errorMessage && (
        <div
          style={{
            marginTop: '16px',
            padding: '12px 16px',
            backgroundColor: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid #EF4444',
            borderRadius: '8px',
            color: 'var(--danger-text)',
            fontSize: '14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <InfoIcon size={16} />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--danger-text)',
              cursor: 'pointer',
            }}
          >
            <CloseIcon size={16} />
          </button>
        </div>
      )}

      {/* 3. Month & Period Toolbar */}
      <AppCard style={{ marginTop: '20px', padding: '16px 20px' }}>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
          }}
        >
          {/* Month selector controls */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              flexWrap: 'nowrap',
              maxWidth: '100%',
            }}
          >
            <button
              type="button"
              aria-label="Tháng trước"
              onClick={() => setSelectedMonth((m) => shiftMonth(m, -1))}
              disabled={loading || actionLoading}
              style={{
                boxSizing: 'border-box',
                minHeight: '36px',
                padding: '6px 10px',
                backgroundColor: 'var(--surface-hover)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                color: 'var(--text-color)',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              &larr;<span className="payroll-nav-label"> Tháng trước</span>
            </button>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                flex: '1 1 auto',
                minWidth: 0,
              }}
            >
              <CalendarIcon
                size={18}
                className="payroll-nav-label"
                style={{ color: 'var(--accent-text)', flexShrink: 0 }}
              />
              <input
                type="month"
                aria-label="Chọn tháng bảng lương"
                value={selectedMonth}
                onChange={(e) => {
                  if (e.target.value) setSelectedMonth(e.target.value);
                }}
                disabled={loading || actionLoading}
                style={{
                  boxSizing: 'border-box',
                  minHeight: '36px',
                  width: '100%',
                  minWidth: 0,
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-color)',
                  padding: '6px 10px',
                  fontSize: '13.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              />
            </div>

            <button
              type="button"
              aria-label="Tháng sau"
              onClick={() => setSelectedMonth((m) => shiftMonth(m, 1))}
              disabled={loading || actionLoading}
              style={{
                boxSizing: 'border-box',
                minHeight: '36px',
                padding: '6px 10px',
                backgroundColor: 'var(--surface-hover)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                color: 'var(--text-color)',
                cursor: 'pointer',
                fontSize: '13px',
                fontWeight: 500,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <span className="payroll-nav-label">Tháng sau </span>&rarr;
            </button>

            <button
              type="button"
              aria-label="Tải lại"
              onClick={() => loadData(selectedMonth, role)}
              disabled={loading || actionLoading}
              style={{
                boxSizing: 'border-box',
                minHeight: '36px',
                padding: '6px 10px',
                backgroundColor: 'transparent',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                color: 'var(--muted-color)',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <RotateCcwIcon size={14} />
              <span className="payroll-nav-label">Tải lại</span>
            </button>
          </div>

          {/* Period Status & Finalize Action */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              flexWrap: 'wrap',
            }}
          >
            {role === 'owner' && period && (
              <>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <span
                    style={{ fontSize: '13px', color: 'var(--muted-color)' }}
                  >
                    Trạng thái kỳ lương:
                  </span>
                  {period.status === 'finalized' ? (
                    <StatusBadge status="success" label="Đã chốt lương" />
                  ) : (
                    <StatusBadge
                      status="neutral"
                      label={
                        period.id === null
                          ? 'Bản nháp tạm tính (Chưa chốt)'
                          : 'Bản nháp tạm tính'
                      }
                    />
                  )}
                </div>

                {period.status === 'draft' ? (
                  <AppButton
                    data-testid="btn-finalize-period"
                    variant="primary"
                    onClick={openFinalizeModal}
                    disabled={loading || actionLoading || items.length === 0}
                  >
                    <CheckIcon size={16} />
                    <span>Chốt kỳ lương</span>
                  </AppButton>
                ) : (
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--success-text)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '4px 10px',
                      backgroundColor: 'rgba(16, 185, 129, 0.1)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      borderRadius: '6px',
                    }}
                    title={`Snapshot Hash: ${period.finalized_snapshot_hash || ''}`}
                  >
                    <CheckIcon size={14} />
                    <span>Đã khóa bất biến</span>
                  </div>
                )}
              </>
            )}

            {role === 'staff' && myPayslip && (
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <span style={{ fontSize: '13px', color: 'var(--muted-color)' }}>
                  Trạng thái:
                </span>
                {myPayslip.status === 'finalized' ? (
                  <StatusBadge status="success" label="Đã chốt sổ" />
                ) : (
                  <StatusBadge status="neutral" label="Tạm tính" />
                )}
              </div>
            )}
          </div>
        </div>
      </AppCard>

      {/* 4. Main Content Area */}
      {loading ? (
        <div
          data-testid="payroll-skeleton-container"
          style={{ marginTop: '24px' }}
          aria-busy="true"
          aria-label="Đang tính toán bảng lương"
        >
          {/* Summary Stat Cards Skeleton */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
              gap: '16px',
              marginBottom: '24px',
            }}
          >
            {[1, 2, 3, 4].map((k) => (
              <AppCard key={k} padding="16px">
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <AppSkeleton variant="text" width="100px" height="14px" />
                  <AppSkeleton variant="text" width="140px" height="24px" />
                </div>
              </AppCard>
            ))}
          </div>

          {/* Table Skeleton */}
          <AppCard padding="0">
            <div
              style={{
                padding: '16px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <AppSkeleton variant="text" width="160px" height="20px" />
              <AppSkeleton variant="text" width="100px" height="20px" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {[1, 2, 3, 4].map((k) => (
                <div
                  key={k}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '8px',
                    padding: '14px 16px',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      gap: '12px',
                      alignItems: 'center',
                    }}
                  >
                    <AppSkeleton variant="circle" width={36} height={36} />
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                      }}
                    >
                      <AppSkeleton variant="text" width="140px" height="16px" />
                      <AppSkeleton variant="text" width="80px" height="12px" />
                    </div>
                  </div>
                  <AppSkeleton variant="text" width="100px" height="16px" />
                  <AppSkeleton variant="text" width="120px" height="18px" />
                  <AppSkeleton variant="rect" width="80px" height="32px" />
                </div>
              ))}
            </div>
          </AppCard>
        </div>
      ) : role === 'owner' ? (
        /* ======================== OWNER DASHBOARD VIEW ======================== */
        <div
          data-testid="owner-payroll-dashboard"
          style={{ marginTop: '24px' }}
        >
          {/* Summary Stat Cards */}
          <div
            className="kpi-grid-4"
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
              gap: '16px',
              marginBottom: '24px',
            }}
          >
            <AppCard style={{ padding: '16px' }}>
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--muted-color)',
                  fontWeight: 600,
                }}
              >
                LƯƠNG CƠ BẢN ĐÃ DUYỆT
              </div>
              <div
                style={{
                  fontSize: '20px',
                  fontWeight: 700,
                  color: 'var(--info-text)',
                  marginTop: '6px',
                }}
              >
                {formatVnd(aggregateMetrics.totalBasePay)}
              </div>
              <div
                className="quick-action-desc"
                style={{
                  fontSize: '12px',
                  color: 'var(--muted-color)',
                  marginTop: '4px',
                }}
              >
                Tính từ các ca hoàn tất đã duyệt
              </div>
            </AppCard>

            <AppCard style={{ padding: '16px' }}>
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--muted-color)',
                  fontWeight: 600,
                }}
              >
                NGHỈ CÓ LƯƠNG
              </div>
              <div
                style={{
                  fontSize: '20px',
                  fontWeight: 700,
                  color: 'var(--purple-text, #A78BFA)',
                  marginTop: '6px',
                }}
              >
                {formatVnd(aggregateMetrics.totalPaidLeave)}
              </div>
              <div
                className="quick-action-desc"
                style={{
                  fontSize: '12px',
                  color: 'var(--muted-color)',
                  marginTop: '4px',
                }}
              >
                Trợ cấp nghỉ phép có lý do
              </div>
            </AppCard>

            <AppCard style={{ padding: '16px', border: '1px solid #14B8A6' }}>
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--accent-text)',
                  fontWeight: 700,
                }}
              >
                TỔNG THỰC NHẬN (NET)
              </div>
              <div
                style={{
                  fontSize: '22px',
                  fontWeight: 800,
                  color: 'var(--text-color)',
                  marginTop: '6px',
                }}
              >
                {formatVnd(aggregateMetrics.totalNetPay)}
              </div>
              <div
                className="quick-action-desc"
                style={{
                  fontSize: '12px',
                  color: 'var(--accent-text)',
                  marginTop: '4px',
                }}
              >
                Lương cơ bản + Nghỉ có lương
              </div>
            </AppCard>

            <AppCard style={{ padding: '16px' }}>
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--muted-color)',
                  fontWeight: 600,
                }}
              >
                ĐÃ CHI TRẢ
              </div>
              <div
                style={{
                  fontSize: '20px',
                  fontWeight: 700,
                  color: 'var(--success-text)',
                  marginTop: '6px',
                }}
              >
                {formatVnd(aggregateMetrics.totalPaid)}
              </div>
              <div
                className="quick-action-desc"
                style={{
                  fontSize: '12px',
                  color: 'var(--muted-color)',
                  marginTop: '4px',
                }}
              >
                Thanh toán qua chuyển khoản / tiền mặt
              </div>
            </AppCard>

            <AppCard style={{ padding: '16px' }}>
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--muted-color)',
                  fontWeight: 600,
                }}
              >
                CÒN LẠI CẦN CHI
              </div>
              <div
                style={{
                  fontSize: '20px',
                  fontWeight: 700,
                  color:
                    aggregateMetrics.remainingToPay > 0
                      ? 'var(--warning-text)'
                      : 'var(--success-text)',
                  marginTop: '6px',
                }}
              >
                {formatVnd(aggregateMetrics.remainingToPay)}
              </div>
              <div
                style={{
                  fontSize: '12px',
                  color: 'var(--muted-color)',
                  marginTop: '4px',
                }}
              >
                {aggregateMetrics.remainingToPay > 0
                  ? 'Chưa chi đủ 100%'
                  : 'Đã chi hoàn tất'}
              </div>
            </AppCard>
          </div>

          {/* 3-Tier Context Banner */}
          <div
            style={{
              padding: '14px 18px',
              backgroundColor: 'var(--surface-hover)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              marginBottom: '24px',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              fontSize: '13px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                flexWrap: 'wrap',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: '#F59E0B',
                    display: 'inline-block',
                  }}
                />
                <span style={{ color: 'var(--muted-color)' }}>
                  Chờ duyệt (Pending):
                </span>
                <span style={{ fontWeight: 600, color: 'var(--warning-text)' }}>
                  {formatMinutes(aggregateMetrics.totalPendingMinutes)} (~{' '}
                  {formatVnd(aggregateMetrics.totalPendingPay)})
                </span>
              </div>

              <div
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: '#38BDF8',
                    display: 'inline-block',
                  }}
                />
                <span style={{ color: 'var(--muted-color)' }}>
                  Ca đang chạy (Live):
                </span>
                <span style={{ fontWeight: 600, color: 'var(--info-text)' }}>
                  {aggregateMetrics.workingEmployeesCount} nhân viên (~{' '}
                  {formatVnd(aggregateMetrics.totalLivePay)})
                </span>
              </div>
            </div>

            <div style={{ color: 'var(--muted-color)', fontSize: '12px' }}>
              Chính sách POLICY-01: Làm tròn ROUND_HALF_UP đến 1 VNĐ cấp ngày
            </div>
          </div>

          {/* Search Toolbar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              marginBottom: '16px',
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                position: 'relative',
                minWidth: '240px',
                flex: 1,
                maxWidth: '400px',
              }}
            >
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm nhân viên theo tên hoặc mã…"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  minHeight: '38px',
                  backgroundColor: 'var(--surface-color)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-color)',
                  padding: '6px 12px',
                  fontSize: '13px',
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--muted-color)',
                    cursor: 'pointer',
                  }}
                >
                  <CloseIcon size={14} />
                </button>
              )}
            </div>

            <div style={{ fontSize: '13px', color: 'var(--muted-color)' }}>
              Hiển thị <strong>{filteredItems.length}</strong> / {items.length}{' '}
              nhân viên (Owner không tính lương)
            </div>
          </div>

          {/* Employee Items List */}
          {filteredItems.length === 0 ? (
            <EmptyState
              title="Không có nhân sự nào trong danh sách"
              description={
                searchQuery
                  ? 'Không tìm thấy kết quả phù hợp với từ khóa.'
                  : 'Chưa có nhân viên nào có thể tính lương.'
              }
            />
          ) : (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
            >
              {pagedItems.map((item) => {
                const isExpanded = expandedEmployeeId === item.employee_id;
                const rem =
                  (item.confirmed.net_pay_vnd || 0) -
                  (item.confirmed.paid_amount_vnd || 0);

                return (
                  <AppCard
                    key={item.employee_id || item.id || item.employee_code}
                    style={{
                      padding: '18px 20px',
                      backgroundColor: 'var(--surface-color)',
                      border: '1px solid var(--border-color)',
                    }}
                  >
                    {/* Header line: Emp Info + Quick Actions */}
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                        borderBottom: '1px solid var(--border-subtle)',
                        paddingBottom: '14px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                        }}
                      >
                        <div
                          style={{
                            width: '38px',
                            height: '38px',
                            borderRadius: '50%',
                            backgroundColor: 'var(--surface-hover)',
                            border: '1px solid var(--border-color)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--accent-text)',
                          }}
                        >
                          <UserIcon size={20} />
                        </div>
                        <div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                            }}
                          >
                            <span
                              style={{
                                fontWeight: 700,
                                fontSize: '16px',
                                color: 'var(--text-color)',
                              }}
                            >
                              {item.full_name}
                            </span>
                            <span
                              style={{
                                fontSize: '12px',
                                padding: '2px 6px',
                                backgroundColor: 'var(--surface-hover)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '4px',
                                color: 'var(--muted-color)',
                                fontWeight: 600,
                              }}
                            >
                              {item.employee_code}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: '13px',
                              color: 'var(--muted-color)',
                              marginTop: '2px',
                            }}
                          >
                            Đơn giá:{' '}
                            {item.hourly_rate_vnd != null &&
                            item.hourly_rate_vnd > 0 ? (
                              <strong style={{ color: 'var(--text-color)' }}>
                                {formatVnd(item.hourly_rate_vnd)}/giờ
                              </strong>
                            ) : (
                              <span
                                style={{
                                  color: 'var(--danger-text)',
                                  fontWeight: 600,
                                }}
                              >
                                Chưa thiết lập
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <ActionIconButton
                          action="edit"
                          label="Sửa đơn giá"
                          target={item.full_name}
                          testId={`btn-payroll-rate-${item.employee_id}`}
                          onClick={() => openRateModal(item)}
                          disabled={actionLoading}
                        />

                        {period?.status === 'draft' && (
                          <button
                            type="button"
                            data-testid={`btn-add-adjustment-${item.employee_id}`}
                            onClick={() => openLeaveModal(item)}
                            disabled={actionLoading}
                            style={{
                              boxSizing: 'border-box',
                              minHeight: '34px',
                              padding: '6px 12px',
                              backgroundColor: 'var(--surface-hover)',
                              border: '1px solid var(--border-color)',
                              borderRadius: '6px',
                              color: 'var(--purple-text, #A78BFA)',
                              cursor: 'pointer',
                              fontSize: '12px',
                              fontWeight: 600,
                            }}
                          >
                            + Nghỉ phép
                          </button>
                        )}

                        {(() => {
                          const itemUnresolved = unresolvedDisbursements.get(
                            getDisbursementKey(
                              workspaceId,
                              currentUserId,
                              item.id || item.employee_id,
                              selectedMonth,
                            ),
                          );
                          const canDisburse =
                            (period?.status === 'finalized' && rem > 0) ||
                            Boolean(itemUnresolved);

                          return (
                            <button
                              type="button"
                              data-testid={`btn-disburse-${item.employee_id}`}
                              onClick={() => openDisburseModal(item)}
                              disabled={
                                actionLoading ||
                                period?.status !== 'finalized' ||
                                !canDisburse
                              }
                              title={
                                itemUnresolved
                                  ? 'Giao dịch chi trả trước đó chưa rõ kết quả — Bấm để thử lại an toàn'
                                  : period?.status !== 'finalized'
                                    ? 'Chỉ có thể chi lương sau khi đã chốt sổ kỳ lương (finalized)'
                                    : rem <= 0
                                      ? 'Đã chi trả đủ tiền lương'
                                      : 'Ghi nhận chi trả lương'
                              }
                              style={{
                                boxSizing: 'border-box',
                                minHeight: '34px',
                                padding: '6px 14px',
                                backgroundColor: itemUnresolved
                                  ? '#D97706'
                                  : canDisburse
                                    ? 'var(--primary-color)'
                                    : 'var(--surface-hover)',
                                border: itemUnresolved
                                  ? '1px solid #F59E0B'
                                  : canDisburse
                                    ? 'none'
                                    : '1px solid var(--border-color)',
                                borderRadius: '6px',
                                color: itemUnresolved
                                  ? '#FFFFFF'
                                  : canDisburse
                                    ? 'var(--inverse-text, #FFFFFF)'
                                    : 'var(--muted-color)',
                                cursor: canDisburse ? 'pointer' : 'not-allowed',
                                fontSize: '12px',
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              <BanknoteIcon size={14} />
                              <span>
                                {itemUnresolved
                                  ? 'Chi lương (Thử lại an toàn)'
                                  : 'Chi lương'}
                              </span>
                            </button>
                          );
                        })()}

                        <ActionIconButton
                          action="view"
                          label={
                            isExpanded ? 'Thu gọn chi tiết' : 'Xem chi tiết'
                          }
                          target={item.full_name}
                          testId={`btn-payroll-detail-${item.employee_id}`}
                          onClick={() =>
                            setExpandedEmployeeId(
                              isExpanded ? null : item.employee_id,
                            )
                          }
                        />
                      </div>
                    </div>

                    {/* 3-Tier Earnings Grid */}
                    <div
                      className="payroll-earnings-grid"
                      style={{
                        display: 'grid',
                        gridTemplateColumns:
                          'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
                        gap: '12px',
                        marginTop: '14px',
                      }}
                    >
                      {/* Tier 1: Confirmed */}
                      <div
                        style={{
                          backgroundColor: 'var(--surface-subtle)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '6px',
                          padding: '10px 12px',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '12px',
                            color: 'var(--accent-text)',
                            fontWeight: 700,
                          }}
                        >
                          1. ĐÃ DUYỆT (CONFIRMED)
                        </div>
                        <div
                          style={{
                            fontSize: '14px',
                            fontWeight: 600,
                            color: 'var(--text-color)',
                            marginTop: '4px',
                          }}
                        >
                          {formatMinutes(
                            item.confirmed.approved_worked_minutes,
                          )}{' '}
                          ({formatVnd(item.confirmed.base_pay_vnd)})
                        </div>
                        {(item.confirmed.paid_leave_pay_vnd > 0 ||
                          (item.confirmed.deduction_vnd ?? 0) > 0) && (
                          <div
                            style={{
                              fontSize: '12px',
                              color: 'var(--purple-text, #A78BFA)',
                              marginTop: '2px',
                            }}
                          >
                            + Phép:{' '}
                            {formatVnd(item.confirmed.paid_leave_pay_vnd)}
                            {(item.confirmed.bonus_vnd ?? 0) > 0 && (
                              <div
                                style={{
                                  color: 'var(--success-text)',
                                  marginTop: '2px',
                                }}
                              >
                                + Thưởng:{' '}
                                {formatVnd(item.confirmed.bonus_vnd ?? 0)}
                              </div>
                            )}
                            {(item.confirmed.allowance_vnd ?? 0) > 0 && (
                              <div
                                style={{
                                  color: 'var(--info-text)',
                                  marginTop: '2px',
                                }}
                              >
                                + Phụ cấp:{' '}
                                {formatVnd(item.confirmed.allowance_vnd ?? 0)}
                              </div>
                            )}
                            {(item.confirmed.deduction_vnd ?? 0) > 0 && (
                              <div
                                style={{
                                  color: 'var(--danger-text)',
                                  marginTop: '2px',
                                }}
                              >
                                - Khấu trừ:{' '}
                                {formatVnd(item.confirmed.deduction_vnd ?? 0)}
                              </div>
                            )}
                          </div>
                        )}
                        <div
                          style={{
                            fontSize: '13px',
                            fontWeight: 700,
                            color: 'var(--info-text)',
                            marginTop: '4px',
                          }}
                        >
                          Net: {formatVnd(item.confirmed.net_pay_vnd)}
                        </div>
                      </div>

                      {/* Tier 2: Pending-Review */}
                      <div
                        style={{
                          backgroundColor: 'var(--surface-subtle)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '6px',
                          padding: '10px 12px',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '12px',
                            color: 'var(--warning-text)',
                            fontWeight: 700,
                          }}
                        >
                          2. CHỜ DUYỆT (PENDING)
                        </div>
                        <div
                          style={{
                            fontSize: '14px',
                            fontWeight: 600,
                            color: 'var(--warning-text)',
                            marginTop: '4px',
                          }}
                        >
                          {item.pending_review?.shift_count || 0} ca (
                          {formatMinutes(
                            item.pending_review?.pending_minutes || 0,
                          )}
                          )
                        </div>
                        <div
                          style={{
                            fontSize: '12px',
                            color: 'var(--muted-color)',
                            marginTop: '2px',
                          }}
                        >
                          Ước tính: ~
                          {formatVnd(
                            item.pending_review?.estimated_pay_vnd || 0,
                          )}
                        </div>
                      </div>

                      {/* Tier 3: Live Provisional */}
                      <div
                        style={{
                          backgroundColor: 'var(--surface-subtle)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '6px',
                          padding: '10px 12px',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '12px',
                            color: 'var(--info-text)',
                            fontWeight: 700,
                          }}
                        >
                          3. CA HIỆN TẠI (LIVE)
                        </div>
                        {item.live_provisional?.has_open_shift ? (
                          <>
                            <div
                              style={{
                                fontSize: '14px',
                                fontWeight: 600,
                                color: 'var(--info-text)',
                                marginTop: '4px',
                              }}
                            >
                              {item.live_provisional.working_state === 'working'
                                ? 'Đang làm'
                                : 'Tạm nghỉ'}
                              :{' '}
                              {formatMinutes(
                                item.live_provisional.live_minutes,
                              )}
                            </div>
                            <div
                              style={{
                                fontSize: '12px',
                                color: 'var(--muted-color)',
                                marginTop: '2px',
                              }}
                            >
                              Tạm tính: ~
                              {formatVnd(item.live_provisional.live_pay_vnd)}
                            </div>
                          </>
                        ) : (
                          <div
                            style={{
                              fontSize: '13px',
                              color: 'var(--muted-color)',
                              marginTop: '6px',
                            }}
                          >
                            Không có ca đang chạy
                          </div>
                        )}
                      </div>

                      {/* Disbursement Status */}
                      <div
                        style={{
                          backgroundColor: 'var(--surface-subtle)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '6px',
                          padding: '10px 12px',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '12px',
                            color: 'var(--muted-color)',
                            fontWeight: 700,
                          }}
                        >
                          TÌNH TRẠNG CHI TRẢ
                        </div>
                        <div style={{ marginTop: '4px' }}>
                          {item.confirmed.payment_status === 'paid' ? (
                            <StatusBadge status="success" label="Đã chi đủ" />
                          ) : item.confirmed.payment_status ===
                            'partially_paid' ? (
                            <StatusBadge
                              status="warning"
                              label="Chi một phần"
                            />
                          ) : (
                            <StatusBadge status="neutral" label="Chưa chi" />
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: '12px',
                            color: 'var(--muted-color)',
                            marginTop: '4px',
                          }}
                        >
                          Đã chi: {formatVnd(item.confirmed.paid_amount_vnd)} /{' '}
                          {formatVnd(item.confirmed.net_pay_vnd)}
                        </div>
                      </div>
                    </div>

                    {/* Expandable Section: Daily Breakdowns, Paid Leaves, Disbursements */}
                    {isExpanded && (
                      <div
                        style={{
                          marginTop: '16px',
                          paddingTop: '16px',
                          borderTop: '1px solid var(--border-color)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '16px',
                        }}
                      >
                        {/* Daily breakdown table */}
                        <div>
                          <div
                            style={{
                              fontSize: '13px',
                              fontWeight: 700,
                              color: 'var(--info-text)',
                              marginBottom: '8px',
                            }}
                          >
                            Bảng tính công theo ngày (POLICY-01):
                          </div>
                          {item.daily_breakdowns &&
                          item.daily_breakdowns.length > 0 ? (
                            <div style={{ overflowX: 'auto' }}>
                              <table
                                style={{
                                  width: '100%',
                                  borderCollapse: 'collapse',
                                  fontSize: '12px',
                                  textAlign: 'left',
                                }}
                              >
                                <thead>
                                  <tr
                                    style={{
                                      backgroundColor: 'var(--surface-subtle)',
                                      color: 'var(--muted-color)',
                                    }}
                                  >
                                    <th
                                      style={{
                                        padding: '6px 10px',
                                        borderBottom:
                                          '1px solid var(--border-color)',
                                      }}
                                    >
                                      Ngày làm
                                    </th>
                                    <th
                                      style={{
                                        padding: '6px 10px',
                                        borderBottom:
                                          '1px solid var(--border-color)',
                                      }}
                                    >
                                      Số ca
                                    </th>
                                    <th
                                      style={{
                                        padding: '6px 10px',
                                        borderBottom:
                                          '1px solid var(--border-color)',
                                      }}
                                    >
                                      Thời gian
                                    </th>
                                    <th
                                      style={{
                                        padding: '6px 10px',
                                        borderBottom:
                                          '1px solid var(--border-color)',
                                      }}
                                    >
                                      Đơn giá
                                    </th>
                                    <th
                                      style={{
                                        padding: '6px 10px',
                                        borderBottom:
                                          '1px solid var(--border-color)',
                                        textAlign: 'right',
                                      }}
                                    >
                                      Tiền thô
                                    </th>
                                    <th
                                      style={{
                                        padding: '6px 10px',
                                        borderBottom:
                                          '1px solid var(--border-color)',
                                        textAlign: 'right',
                                      }}
                                    >
                                      Thành tiền (1 đ)
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {item.daily_breakdowns.map((bd) => (
                                    <tr
                                      key={bd.work_date}
                                      style={{
                                        borderBottom:
                                          '1px solid var(--border-subtle)',
                                      }}
                                    >
                                      <td
                                        style={{
                                          padding: '6px 10px',
                                          fontWeight: 600,
                                        }}
                                      >
                                        {formatDateDisplay(bd.work_date)}
                                      </td>
                                      <td style={{ padding: '6px 10px' }}>
                                        {bd.shift_count}
                                      </td>
                                      <td style={{ padding: '6px 10px' }}>
                                        {formatMinutes(bd.worked_minutes)}
                                      </td>
                                      <td style={{ padding: '6px 10px' }}>
                                        {formatVnd(bd.hourly_rate_vnd_snapshot)}
                                        /giờ
                                      </td>
                                      <td
                                        style={{
                                          padding: '6px 10px',
                                          textAlign: 'right',
                                          color: 'var(--muted-color)',
                                        }}
                                      >
                                        {bd.raw_wage_vnd.toFixed(2)} đ
                                      </td>
                                      <td
                                        style={{
                                          padding: '6px 10px',
                                          textAlign: 'right',
                                          fontWeight: 700,
                                          color: 'var(--success-text)',
                                        }}
                                      >
                                        {formatVnd(bd.rounded_wage_vnd)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div
                              style={{
                                fontSize: '12px',
                                color: 'var(--muted-color)',
                              }}
                            >
                              Chưa có ca làm việc nào được duyệt trong tháng.
                            </div>
                          )}
                        </div>

                        {/* Adjustments & Paid leaves list */}
                        {((item.adjustments && item.adjustments.length > 0) ||
                          (item.paid_leaves &&
                            item.paid_leaves.length > 0)) && (
                          <div>
                            <div
                              style={{
                                fontSize: '13px',
                                fontWeight: 700,
                                color: 'var(--purple-text, #A78BFA)',
                                marginBottom: '8px',
                              }}
                            >
                              Các khoản điều chỉnh & Nghỉ có lương:
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px',
                              }}
                            >
                              {(item.adjustments || item.paid_leaves || []).map(
                                (pl) => (
                                  <div
                                    key={
                                      pl.id ||
                                      `${pl.attributable_date}-${pl.reason}`
                                    }
                                    style={{
                                      backgroundColor: 'var(--surface-subtle)',
                                      border: '1px solid var(--border-subtle)',
                                      borderRadius: '4px',
                                      padding: '8px 12px',
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      fontSize: '12px',
                                    }}
                                  >
                                    <div>
                                      {pl.attributable_date && (
                                        <span
                                          style={{
                                            fontWeight: 600,
                                            color: 'var(--text-color)',
                                          }}
                                        >
                                          {formatDateDisplay(
                                            pl.attributable_date,
                                          )}
                                        </span>
                                      )}
                                      <span
                                        style={{
                                          color: 'var(--muted-color)',
                                          marginLeft: pl.attributable_date
                                            ? '12px'
                                            : '0',
                                        }}
                                      >
                                        {pl.reason}
                                      </span>
                                    </div>
                                    <div
                                      style={{
                                        fontWeight: 700,
                                        color: 'var(--purple-text, #A78BFA)',
                                      }}
                                    >
                                      {/^\[?\s*(KHẤU TRỪ|KHAU TRU|PHẠT|PHAT|TẠM ỨNG|TAM UNG)/i.test(
                                        pl.reason || '',
                                      ) ? (
                                        <span
                                          style={{
                                            color: 'var(--danger-text)',
                                          }}
                                        >
                                          -{formatVnd(pl.amount_vnd)}
                                        </span>
                                      ) : (
                                        <>+{formatVnd(pl.amount_vnd)}</>
                                      )}
                                    </div>
                                  </div>
                                ),
                              )}
                            </div>
                          </div>
                        )}

                        {/* Disbursements history */}
                        {item.disbursements &&
                          item.disbursements.length > 0 && (
                            <div>
                              <div
                                style={{
                                  fontSize: '13px',
                                  fontWeight: 700,
                                  color: 'var(--success-text)',
                                  marginBottom: '8px',
                                }}
                              >
                                Lịch sử chi trả lương:
                              </div>
                              <div
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '6px',
                                }}
                              >
                                {item.disbursements.map((d) => (
                                  <div
                                    key={d.id || d.disbursement_order}
                                    style={{
                                      backgroundColor: 'var(--surface-subtle)',
                                      border: '1px solid var(--border-subtle)',
                                      borderRadius: '4px',
                                      padding: '8px 12px',
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      fontSize: '12px',
                                    }}
                                  >
                                    <div>
                                      <span
                                        style={{
                                          fontWeight: 700,
                                          color: 'var(--text-color)',
                                        }}
                                      >
                                        Đợt {d.disbursement_order}
                                      </span>
                                      <span
                                        style={{
                                          color: 'var(--muted-color)',
                                          marginLeft: '10px',
                                        }}
                                      >
                                        {formatDateDisplay(d.payment_date)} •{' '}
                                        {d.payment_method === 'bank_transfer'
                                          ? 'Chuyển khoản'
                                          : d.payment_method === 'cash'
                                            ? 'Tiền mặt'
                                            : 'Khác'}
                                      </span>
                                      {d.reference_note && (
                                        <span
                                          style={{
                                            color: 'var(--muted-color)',
                                            marginLeft: '10px',
                                            fontStyle: 'italic',
                                          }}
                                        >
                                          ({d.reference_note})
                                        </span>
                                      )}
                                    </div>
                                    <div
                                      style={{
                                        fontWeight: 700,
                                        color: 'var(--success-text)',
                                      }}
                                    >
                                      {formatVnd(d.amount_vnd)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                      </div>
                    )}
                  </AppCard>
                );
              })}
              <Pagination
                total={filteredItems.length}
                page={safeItemsPage}
                pageSize={itemsPageSize}
                onPage={setItemsPage}
                onPageSize={(s) => {
                  setItemsPageSize(s);
                  setItemsPage(0);
                }}
                testId="payroll-items-pagination"
              />
            </div>
          )}
        </div>
      ) : (
        /* ======================== STAFF PAYSLIP VIEW ======================== */
        <div style={{ marginTop: '24px' }}>
          {!myPayslip ? (
            <EmptyState
              title="Chưa có dữ liệu phiếu lương"
              description="Không tìm thấy bản ghi lương cho tháng này. Vui lòng chọn tháng khác hoặc liên hệ Quản lý."
            />
          ) : (
            <div
              data-testid="staff-payslip"
              style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}
            >
              {/* Staff Profile Card */}
              <AppCard
                style={{
                  padding: '20px',
                  backgroundColor: 'var(--surface-color)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '16px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px',
                    }}
                  >
                    <div
                      style={{
                        width: '46px',
                        height: '46px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--surface-hover)',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--info-text)',
                      }}
                    >
                      <UserIcon size={24} />
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: '18px',
                          fontWeight: 700,
                          color: 'var(--text-color)',
                        }}
                      >
                        {myPayslip.employee?.full_name || 'Nhân viên'}
                      </div>
                      <div
                        style={{
                          fontSize: '13px',
                          color: 'var(--muted-color)',
                          marginTop: '2px',
                        }}
                      >
                        Mã NV:{' '}
                        <strong>
                          {myPayslip.employee?.employee_code || '--'}
                        </strong>{' '}
                        • Đơn giá:{' '}
                        {myPayslip.hourly_rate_vnd != null &&
                        myPayslip.hourly_rate_vnd > 0 ? (
                          <strong>
                            {formatVnd(myPayslip.hourly_rate_vnd)}/giờ
                          </strong>
                        ) : (
                          <span
                            style={{
                              color: 'var(--danger-text)',
                              fontWeight: 600,
                            }}
                          >
                            Chưa thiết lập
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div
                      style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                    >
                      TỔNG THỰC NHẬN (NET)
                    </div>
                    <div
                      data-testid="staff-net-pay"
                      style={{
                        fontSize: '24px',
                        fontWeight: 800,
                        color: 'var(--success-text)',
                        marginTop: '4px',
                      }}
                    >
                      {formatVnd(myPayslip.confirmed.net_pay_vnd)}
                    </div>
                    <div
                      data-testid="staff-bank-info"
                      style={{ fontSize: '12px', marginTop: '6px' }}
                    >
                      {myPayslip.employee?.bank_name &&
                      myPayslip.employee?.bank_account_number ? (
                        <span style={{ color: 'var(--success-text)' }}>
                          🏦 Nhận lương: {myPayslip.employee.bank_name} •{' '}
                          <strong>
                            {myPayslip.employee.bank_account_number}
                          </strong>
                          {myPayslip.employee.bank_account_holder
                            ? ` (${myPayslip.employee.bank_account_holder})`
                            : ''}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--warning-text)' }}>
                          ⚠️ Chưa cập nhật TK ngân hàng nhận lương
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Progress bar of payment */}
                <div
                  style={{
                    marginTop: '20px',
                    paddingTop: '16px',
                    borderTop: '1px solid var(--border-subtle)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    <span>
                      Tiến độ thanh toán:{' '}
                      <strong>
                        {formatVnd(myPayslip.confirmed.paid_amount_vnd)}
                      </strong>{' '}
                      / {formatVnd(myPayslip.confirmed.net_pay_vnd)}
                    </span>
                    <span>
                      {myPayslip.confirmed.payment_status === 'paid' ? (
                        <span
                          style={{
                            color: 'var(--success-text)',
                            fontWeight: 700,
                          }}
                        >
                          Đã nhận đủ 100%
                        </span>
                      ) : myPayslip.confirmed.payment_status ===
                        'partially_paid' ? (
                        <span
                          style={{
                            color: 'var(--warning-text)',
                            fontWeight: 600,
                          }}
                        >
                          Còn lại:{' '}
                          {formatVnd(
                            myPayslip.confirmed.net_pay_vnd -
                              myPayslip.confirmed.paid_amount_vnd,
                          )}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--muted-color)' }}>
                          Chưa thanh toán
                        </span>
                      )}
                    </span>
                  </div>
                  <div
                    style={{
                      width: '100%',
                      height: '8px',
                      backgroundColor: 'var(--surface-subtle)',
                      borderRadius: '9999px',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${
                          myPayslip.confirmed.net_pay_vnd > 0
                            ? Math.min(
                                100,
                                Math.round(
                                  (myPayslip.confirmed.paid_amount_vnd /
                                    myPayslip.confirmed.net_pay_vnd) *
                                    100,
                                ),
                              )
                            : 0
                        }%`,
                        height: '100%',
                        backgroundColor: '#10B981',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>
              </AppCard>

              {/* 3-Tier Pay Summary Cards */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
                  gap: '16px',
                }}
              >
                {/* Tier 1 */}
                <AppCard style={{ padding: '16px' }}>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--accent-text)',
                      fontWeight: 700,
                    }}
                  >
                    1. THU NHẬP ĐÃ DUYỆT (CONFIRMED)
                  </div>
                  <div
                    style={{
                      fontSize: '18px',
                      fontWeight: 700,
                      color: 'var(--text-color)',
                      marginTop: '6px',
                    }}
                  >
                    {formatVnd(myPayslip.confirmed.net_pay_vnd)}
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                      marginTop: '4px',
                    }}
                  >
                    Lương giờ làm: {formatVnd(myPayslip.confirmed.base_pay_vnd)}{' '}
                    (
                    <span data-testid="staff-approved-hours">
                      {formatMinutes(
                        myPayslip.confirmed.approved_worked_minutes,
                      )}
                    </span>
                    )
                  </div>
                  {(myPayslip.confirmed.paid_leave_pay_vnd > 0 ||
                    (myPayslip.confirmed.deduction_vnd ?? 0) > 0) && (
                    <div
                      style={{
                        fontSize: '12px',
                        color: 'var(--purple-text, #A78BFA)',
                        marginTop: '2px',
                      }}
                    >
                      Nghỉ có lương: +
                      {formatVnd(myPayslip.confirmed.paid_leave_pay_vnd)}
                      {(myPayslip.confirmed.bonus_vnd ?? 0) > 0 && (
                        <div
                          style={{
                            color: 'var(--success-text)',
                            marginTop: '2px',
                          }}
                        >
                          🎁 Thưởng: +
                          {formatVnd(myPayslip.confirmed.bonus_vnd ?? 0)}
                        </div>
                      )}
                      {(myPayslip.confirmed.allowance_vnd ?? 0) > 0 && (
                        <div
                          style={{
                            color: 'var(--info-text)',
                            marginTop: '2px',
                          }}
                        >
                          🍱 Phụ cấp: +
                          {formatVnd(myPayslip.confirmed.allowance_vnd ?? 0)}
                        </div>
                      )}
                      {(myPayslip.confirmed.deduction_vnd ?? 0) > 0 && (
                        <div
                          style={{
                            color: 'var(--danger-text)',
                            marginTop: '2px',
                          }}
                        >
                          ➖ Khấu trừ: -
                          {formatVnd(myPayslip.confirmed.deduction_vnd ?? 0)}
                        </div>
                      )}
                    </div>
                  )}
                </AppCard>

                {/* Tier 2 */}
                <AppCard style={{ padding: '16px' }}>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--warning-text)',
                      fontWeight: 700,
                    }}
                  >
                    2. CA CHỜ DUYỆT (PENDING REVIEW)
                  </div>
                  <div
                    style={{
                      fontSize: '18px',
                      fontWeight: 700,
                      color: 'var(--warning-text)',
                      marginTop: '6px',
                    }}
                  >
                    ~
                    {formatVnd(
                      myPayslip.pending_review?.estimated_pay_vnd || 0,
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                      marginTop: '4px',
                    }}
                  >
                    {myPayslip.pending_review?.shift_count || 0} ca hoàn tất (
                    {formatMinutes(
                      myPayslip.pending_review?.pending_minutes || 0,
                    )}
                    )
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                      marginTop: '2px',
                    }}
                  >
                    Đang chờ Owner duyệt công
                  </div>
                </AppCard>

                {/* Tier 3 */}
                <AppCard style={{ padding: '16px' }}>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--info-text)',
                      fontWeight: 700,
                    }}
                  >
                    3. CA ĐANG CHẠY (LIVE PROVISIONAL)
                  </div>
                  {myPayslip.live_provisional?.has_open_shift ? (
                    <>
                      <div
                        style={{
                          fontSize: '18px',
                          fontWeight: 700,
                          color: 'var(--info-text)',
                          marginTop: '6px',
                        }}
                      >
                        ~{formatVnd(myPayslip.live_provisional.live_pay_vnd)}
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--muted-color)',
                          marginTop: '4px',
                        }}
                      >
                        {myPayslip.live_provisional.working_state === 'working'
                          ? 'Đang làm việc'
                          : 'Tạm nghỉ'}
                        :{' '}
                        {formatMinutes(myPayslip.live_provisional.live_minutes)}
                      </div>
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--muted-color)',
                          marginTop: '2px',
                        }}
                      >
                        Tính tạm đến server as of
                      </div>
                    </>
                  ) : (
                    <div
                      style={{
                        fontSize: '13px',
                        color: 'var(--muted-color)',
                        marginTop: '12px',
                      }}
                    >
                      Hiện tại bạn chưa vào ca làm việc
                    </div>
                  )}
                </AppCard>
              </div>

              {/* Daily breakdown table */}
              <AppCard style={{ padding: '20px' }}>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    color: 'var(--text-color)',
                    marginBottom: '12px',
                  }}
                >
                  Chi tiết ngày làm việc đã duyệt (POLICY-01)
                </div>
                {myPayslip.daily_breakdowns.length > 0 ? (
                  <div style={{ overflowX: 'auto' }}>
                    <table
                      style={{
                        width: '100%',
                        borderCollapse: 'collapse',
                        fontSize: '13px',
                        textAlign: 'left',
                      }}
                    >
                      <thead>
                        <tr
                          style={{
                            backgroundColor: 'var(--surface-subtle)',
                            color: 'var(--muted-color)',
                          }}
                        >
                          <th
                            style={{
                              padding: '8px 12px',
                              borderBottom: '1px solid var(--border-color)',
                            }}
                          >
                            Ngày làm việc
                          </th>
                          <th
                            style={{
                              padding: '8px 12px',
                              borderBottom: '1px solid var(--border-color)',
                            }}
                          >
                            Số ca
                          </th>
                          <th
                            style={{
                              padding: '8px 12px',
                              borderBottom: '1px solid var(--border-color)',
                            }}
                          >
                            Thời gian
                          </th>
                          <th
                            style={{
                              padding: '8px 12px',
                              borderBottom: '1px solid var(--border-color)',
                            }}
                          >
                            Đơn giá
                          </th>
                          <th
                            style={{
                              padding: '8px 12px',
                              borderBottom: '1px solid var(--border-color)',
                              textAlign: 'right',
                            }}
                          >
                            Tiền công (VNĐ)
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {myPayslip.daily_breakdowns.map((bd) => (
                          <tr
                            key={bd.work_date}
                            style={{
                              borderBottom: '1px solid var(--border-subtle)',
                            }}
                          >
                            <td
                              style={{ padding: '8px 12px', fontWeight: 600 }}
                            >
                              {formatDateDisplay(bd.work_date)}
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                              {bd.shift_count}
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                              {formatMinutes(bd.worked_minutes)}
                            </td>
                            <td style={{ padding: '8px 12px' }}>
                              {formatVnd(bd.hourly_rate_vnd_snapshot)}/giờ
                            </td>
                            <td
                              style={{
                                padding: '8px 12px',
                                textAlign: 'right',
                                fontWeight: 700,
                                color: 'var(--success-text)',
                              }}
                            >
                              {formatVnd(bd.rounded_wage_vnd)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div
                    style={{ fontSize: '13px', color: 'var(--muted-color)' }}
                  >
                    Chưa có ca làm việc nào được duyệt trong kỳ này.
                  </div>
                )}
              </AppCard>

              {/* Adjustments & Paid leaves list */}
              {((myPayslip.adjustments && myPayslip.adjustments.length > 0) ||
                (myPayslip.paid_leaves &&
                  myPayslip.paid_leaves.length > 0)) && (
                <AppCard style={{ padding: '20px' }}>
                  <div
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      color: 'var(--purple-text, #A78BFA)',
                      marginBottom: '12px',
                    }}
                  >
                    Các khoản điều chỉnh & Nghỉ có lương
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    {(myPayslip.adjustments || myPayslip.paid_leaves || []).map(
                      (pl) => (
                        <div
                          key={pl.id || `${pl.attributable_date}-${pl.reason}`}
                          style={{
                            backgroundColor: 'var(--surface-subtle)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: '6px',
                            padding: '10px 14px',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            fontSize: '13px',
                          }}
                        >
                          <div>
                            {pl.attributable_date && (
                              <span
                                style={{
                                  fontWeight: 600,
                                  color: 'var(--text-color)',
                                }}
                              >
                                {formatDateDisplay(pl.attributable_date)}
                              </span>
                            )}
                            <span
                              style={{
                                color: 'var(--muted-color)',
                                marginLeft: pl.attributable_date ? '12px' : '0',
                              }}
                            >
                              {pl.reason}
                            </span>
                          </div>
                          <div
                            style={{
                              fontWeight: 700,
                              color: 'var(--purple-text, #A78BFA)',
                              fontSize: '14px',
                            }}
                          >
                            {/^\[?\s*(KHẤU TRỪ|KHAU TRU|PHẠT|PHAT|TẠM ỨNG|TAM UNG)/i.test(
                              pl.reason || '',
                            ) ? (
                              <span style={{ color: 'var(--danger-text)' }}>
                                -{formatVnd(pl.amount_vnd)}
                              </span>
                            ) : (
                              <>+{formatVnd(pl.amount_vnd)}</>
                            )}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </AppCard>
              )}

              {/* Disbursements list */}
              {myPayslip.disbursements.length > 0 && (
                <AppCard style={{ padding: '20px' }}>
                  <div
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      color: 'var(--success-text)',
                      marginBottom: '12px',
                    }}
                  >
                    Các đợt nhận tiền lương
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    {myPayslip.disbursements.map((d) => (
                      <div
                        key={d.id || d.disbursement_order}
                        style={{
                          backgroundColor: 'var(--surface-subtle)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '6px',
                          padding: '10px 14px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          fontSize: '13px',
                        }}
                      >
                        <div>
                          <span
                            style={{
                              fontWeight: 700,
                              color: 'var(--text-color)',
                            }}
                          >
                            Đợt {d.disbursement_order}
                          </span>
                          <span
                            style={{
                              color: 'var(--muted-color)',
                              marginLeft: '12px',
                            }}
                          >
                            {formatDateDisplay(d.payment_date)} •{' '}
                            {d.payment_method === 'bank_transfer'
                              ? 'Chuyển khoản'
                              : d.payment_method === 'cash'
                                ? 'Tiền mặt'
                                : 'Khác'}
                          </span>
                          {d.reference_note && (
                            <span
                              style={{
                                color: 'var(--muted-color)',
                                marginLeft: '10px',
                              }}
                            >
                              ({d.reference_note})
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontWeight: 700,
                            color: 'var(--success-text)',
                            fontSize: '14px',
                          }}
                        >
                          +{formatVnd(d.amount_vnd)}
                        </div>
                      </div>
                    ))}
                  </div>
                </AppCard>
              )}
            </div>
          )}
        </div>
      )}

      {/* ======================== MODAL: HOURLY RATE ======================== */}
      {showRateModal && rateEmployee && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 1000,
          }}
        >
          <AppCard
            style={{
              width: '100%',
              maxWidth: '440px',
              maxHeight: 'calc(100dvh - 28px)',
              overflowY: 'auto',
              boxSizing: 'border-box',
              padding: '20px',
              backgroundColor: 'var(--surface-color)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <div
                style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  color: 'var(--text-color)',
                }}
              >
                Thiết lập đơn giá theo giờ
              </div>
              <button
                type="button"
                onClick={() => setShowRateModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted-color)',
                  cursor: 'pointer',
                }}
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <div
              style={{
                fontSize: '13px',
                color: 'var(--muted-color)',
                marginBottom: '16px',
              }}
            >
              Nhân viên: <strong>{rateEmployee.full_name}</strong> (
              {rateEmployee.employee_code})
            </div>

            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
            >
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Đơn giá theo giờ (VNĐ/giờ):
                </label>
                <input
                  type="number"
                  step="1000"
                  min="1000"
                  value={rateAmount}
                  onChange={(e) => setRateAmount(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    minHeight: '38px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--text-color)',
                    padding: '8px 12px',
                    fontSize: '14px',
                    fontWeight: 600,
                  }}
                />
              </div>

              <p
                style={{
                  fontSize: '13px',
                  color: 'var(--muted-color)',
                  margin: 0,
                }}
              >
                Đơn giá mới có hiệu lực từ thời điểm máy chủ lưu. Không áp dụng
                hồi tố cho tiền công trước thời điểm này.
              </p>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
                marginTop: '24px',
              }}
            >
              <button
                type="button"
                onClick={() => setShowRateModal(false)}
                disabled={actionLoading}
                style={{
                  boxSizing: 'border-box',
                  minHeight: '36px',
                  padding: '6px 14px',
                  backgroundColor: 'var(--surface-hover)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--muted-color)',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Hủy
              </button>
              <AppButton
                variant="primary"
                onClick={handleSaveRate}
                disabled={actionLoading}
              >
                {actionLoading ? 'Đang lưu…' : 'Lưu đơn giá'}
              </AppButton>
            </div>
          </AppCard>
        </div>
      )}

      {/* ======================== MODAL: PAID LEAVE ======================== */}
      {showLeaveModal && leaveEmployee && (
        <div
          data-testid="adjustment-modal"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 1000,
          }}
        >
          <AppCard
            style={{
              width: '100%',
              maxWidth: '440px',
              maxHeight: 'calc(100dvh - 28px)',
              overflowY: 'auto',
              boxSizing: 'border-box',
              padding: '20px',
              backgroundColor: 'var(--surface-color)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <div
                style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  color: 'var(--text-color)',
                }}
              >
                Ghi nhận nghỉ có lương / Thưởng / Phụ cấp / Khấu trừ
              </div>
              <button
                type="button"
                onClick={closeLeaveModal}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted-color)',
                  cursor: 'pointer',
                }}
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <div
              style={{
                fontSize: '13px',
                color: 'var(--muted-color)',
                marginBottom: '16px',
              }}
            >
              Nhân viên: <strong>{leaveEmployee.full_name}</strong> (
              {leaveEmployee.employee_code})
            </div>

            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
            >
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Ngày nghỉ (trong tháng {selectedMonth}):
                </label>
                <input
                  data-testid="adjustment-date-input"
                  type="date"
                  value={leaveDate}
                  onChange={(e) => setLeaveDate(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    minHeight: '38px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--text-color)',
                    padding: '8px 12px',
                    fontSize: '14px',
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Số tiền trợ cấp (VNĐ):
                </label>
                <input
                  data-testid="adjustment-amount-input"
                  type="number"
                  step="10000"
                  min="1000"
                  value={leaveAmount}
                  onChange={(e) => setLeaveAmount(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    minHeight: '38px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--text-color)',
                    padding: '8px 12px',
                    fontSize: '14px',
                    fontWeight: 600,
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Phân loại điều chỉnh nhanh:
                </label>
                <div
                  data-testid="adjustment-category-pills"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: '6px',
                    marginBottom: '12px',
                  }}
                >
                  {[
                    { label: '🏖️ Nghỉ có lương (+)', prefix: '' },
                    {
                      label: '🎁 Thưởng KPI/Chuyên cần (+)',
                      prefix: '[THƯỞNG] ',
                    },
                    {
                      label: '🍱 Phụ cấp ca/Ăn trưa (+)',
                      prefix: '[PHỤ CẤP] ',
                    },
                    {
                      label: '➖ Khấu trừ / Tạm ứng (-)',
                      prefix: '[KHẤU TRỪ] ',
                    },
                  ].map((opt) => {
                    const stripped = leaveReason.replace(
                      /^\[(THƯỞNG|THUONG|PHỤ CẤP|PHU CAP|KHẤU TRỪ|KHAU TRU|TẠM ỨNG|TAM UNG|PHẠT|PHAT)\]\s*/i,
                      '',
                    );
                    const isActive = opt.prefix
                      ? leaveReason.toUpperCase().startsWith(opt.prefix.trim())
                      : !/^\[(THƯỞNG|THUONG|PHỤ CẤP|PHU CAP|KHẤU TRỪ|KHAU TRU|TẠM ỨNG|TAM UNG|PHẠT|PHAT)\]/i.test(
                          leaveReason.trim(),
                        );
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() =>
                          setLeaveReason(
                            opt.prefix
                              ? `${opt.prefix}${stripped || (opt.prefix.includes('THƯỞNG') ? 'Thưởng chuyên cần / hiệu suất' : opt.prefix.includes('PHỤ CẤP') ? 'Phụ cấp ca làm việc' : 'Khấu trừ / tạm ứng lương')}`
                              : stripped,
                          )
                        }
                        style={{
                          padding: '7px 10px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          textAlign: 'left',
                          border: isActive
                            ? '1px solid #14B8A6'
                            : '1px solid var(--border-color)',
                          backgroundColor: isActive
                            ? 'rgba(20, 184, 166, 0.15)'
                            : 'var(--surface-subtle)',
                          color: isActive
                            ? 'var(--accent-text)'
                            : 'var(--text-secondary)',
                        }}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Lý do nghỉ có lương / điều chỉnh (Bắt buộc):
                </label>
                <textarea
                  data-testid="adjustment-reason-input"
                  rows={3}
                  value={leaveReason}
                  onChange={(e) => setLeaveReason(e.target.value)}
                  placeholder="Ví dụ: Nghỉ phép năm, nghỉ ốm có giấy khám…"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: 'var(--text-color)',
                    padding: '8px 12px',
                    fontSize: '13px',
                    resize: 'vertical',
                  }}
                />
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
                marginTop: '24px',
              }}
            >
              <button
                data-testid="adjustment-cancel-btn"
                type="button"
                onClick={closeLeaveModal}
                disabled={actionLoading}
                style={{
                  boxSizing: 'border-box',
                  minHeight: '36px',
                  padding: '6px 14px',
                  backgroundColor: 'var(--surface-hover)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--muted-color)',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Hủy
              </button>
              <AppButton
                data-testid="adjustment-submit-btn"
                variant="primary"
                onClick={handleSavePaidLeave}
                disabled={actionLoading}
              >
                {actionLoading
                  ? 'Đang lưu…'
                  : pendingAdjustment?.status === 'error_unresolved' ||
                      pendingAdjustment?.status === 'unresolved'
                    ? 'Thử lại gửi điều chỉnh'
                    : 'Lưu nghỉ phép'}
              </AppButton>
            </div>
          </AppCard>
        </div>
      )}

      {/* ======================== MODAL: DISBURSEMENT ======================== */}
      {showDisburseModal && disburseEmployee && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 1000,
          }}
        >
          <AppCard
            style={{
              width: '100%',
              maxWidth: '460px',
              maxHeight: 'calc(100dvh - 28px)',
              overflowY: 'auto',
              boxSizing: 'border-box',
              padding: '20px',
              backgroundColor: 'var(--surface-color)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <div
                style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  color: 'var(--text-color)',
                }}
              >
                Ghi nhận chi trả tiền lương
              </div>
              <button
                type="button"
                onClick={closeDisburseModal}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted-color)',
                  cursor: 'pointer',
                }}
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <div
              style={{
                fontSize: '13px',
                color: 'var(--muted-color)',
                marginBottom: '16px',
              }}
            >
              Nhân viên: <strong>{disburseEmployee.full_name}</strong> (
              {disburseEmployee.employee_code})
            </div>

            {isUnresolvedRetry && (
              <div
                data-testid="unresolved-disbursement-banner"
                style={{
                  backgroundColor: 'rgba(245, 158, 11, 0.15)',
                  border: '1px solid #F59E0B',
                  borderRadius: '6px',
                  padding: '12px',
                  marginBottom: '16px',
                  fontSize: '12px',
                  color: 'var(--warning-text)',
                  lineHeight: '1.5',
                }}
              >
                <div
                  style={{
                    fontWeight: 700,
                    marginBottom: '4px',
                    color: 'var(--warning-text)',
                  }}
                >
                  ⚠️ Giao dịch chưa xác nhận kết quả: GIAO DỊCH CHƯA RÕ KẾT QUẢ
                  TỪ MÁY CHỦ
                </div>
                <div>
                  Mã xác thực (Idempotency Key):{' '}
                  <code style={{ wordBreak: 'break-all', color: '#67E8F9' }}>
                    {disburseIdempotencyKey}
                  </code>
                </div>
                <div style={{ marginTop: '4px' }}>
                  Toàn bộ thông tin giao dịch (số tiền, hình thức, ngày, ghi
                  chú) đã được <strong>khóa bất biến</strong>. Bấm{' '}
                  <strong>"Thử lại giao dịch gốc"</strong> để gửi lại cùng khóa
                  xác thực, tránh phát sinh chi trả trùng lặp.
                </div>
              </div>
            )}

            <div
              style={{
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                padding: '12px',
                marginBottom: '16px',
                fontSize: '13px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: 'var(--muted-color)',
                }}
              >
                <span>Tổng thực nhận (Net):</span>
                <strong style={{ color: 'var(--text-color)' }}>
                  {formatVnd(disburseEmployee.confirmed.net_pay_vnd)}
                </strong>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: 'var(--muted-color)',
                  marginTop: '4px',
                }}
              >
                <span>Đã chi trước đó:</span>
                <strong style={{ color: 'var(--success-text)' }}>
                  {formatVnd(disburseEmployee.confirmed.paid_amount_vnd)}
                </strong>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: 'var(--warning-text)',
                  fontWeight: 700,
                  marginTop: '6px',
                  paddingTop: '6px',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <span>Còn lại được phép chi:</span>
                <span>
                  {formatVnd(
                    (disburseEmployee.confirmed.net_pay_vnd || 0) -
                      (disburseEmployee.confirmed.paid_amount_vnd || 0),
                  )}
                </span>
              </div>
            </div>

            {/* Thông tin Ngân hàng nhận lương & Mã QR chuyển khoản VietQR */}
            <div
              data-testid="disburse-bank-qr-card"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid rgba(56, 189, 248, 0.3)',
                borderRadius: '8px',
                padding: '12px',
                marginBottom: '16px',
                fontSize: '12px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}
              >
                <span
                  style={{
                    fontWeight: 700,
                    color: 'var(--info-text)',
                    fontSize: '13px',
                  }}
                >
                  🏦 Tài khoản ngân hàng nhận lương (VietQR)
                </span>
                {disburseEmployee.bank_account_number && (
                  <button
                    type="button"
                    onClick={() => {
                      if (navigator.clipboard) {
                        void navigator.clipboard.writeText(
                          disburseEmployee.bank_account_number || '',
                        );
                      }
                    }}
                    style={{
                      padding: '3px 8px',
                      borderRadius: '4px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--surface-hover)',
                      color: 'var(--info-text)',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Sao chép STK
                  </button>
                )}
              </div>
              {disburseEmployee.bank_name &&
              disburseEmployee.bank_account_number ? (
                <div
                  style={{
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <div
                    style={{
                      flex: '1 1 180px',
                      lineHeight: 1.6,
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <div>
                      Ngân hàng:{' '}
                      <strong style={{ color: 'var(--text-color)' }}>
                        {disburseEmployee.bank_name}
                      </strong>
                    </div>
                    <div>
                      Số TK:{' '}
                      <strong
                        style={{
                          color: 'var(--success-text)',
                          fontFamily: 'var(--font-sans)',
                          fontVariantNumeric: 'tabular-nums',
                          letterSpacing: '0.015em',
                          fontSize: '14px',
                        }}
                      >
                        {disburseEmployee.bank_account_number}
                      </strong>
                    </div>
                    <div>
                      Chủ TK:{' '}
                      <strong style={{ color: 'var(--text-color)' }}>
                        {disburseEmployee.bank_account_holder ||
                          disburseEmployee.full_name}
                      </strong>
                    </div>
                    {disburseEmployee.phone && (
                      <div>
                        SĐT: <strong>{disburseEmployee.phone}</strong>
                      </div>
                    )}
                  </div>
                  {disburseMethod === 'bank_transfer' &&
                    Number(disburseAmount) > 0 && (
                      <div
                        style={{
                          backgroundColor: '#FFFFFF',
                          padding: '6px',
                          borderRadius: '8px',
                          textAlign: 'center',
                        }}
                      >
                        <img
                          data-testid="disburse-vietqr-img"
                          src={`https://img.vietqr.io/image/${resolveVietQrBankCode(disburseEmployee.bank_name)}-${encodeURIComponent(disburseEmployee.bank_account_number.trim())}-compact2.png?amount=${Math.max(0, parseInt(disburseAmount, 10) || 0)}&addInfo=${encodeURIComponent(`LUONG ${selectedMonth} ${disburseEmployee.employee_code} ${disburseEmployee.full_name}`)}&accountName=${encodeURIComponent(disburseEmployee.bank_account_holder || disburseEmployee.full_name)}`}
                          alt="VietQR chuyển khoản lương"
                          style={{
                            width: '132px',
                            height: '132px',
                            objectFit: 'contain',
                            display: 'block',
                          }}
                        />
                        <div
                          style={{
                            fontSize: '12px',
                            color: '#0F172A',
                            fontWeight: 700,
                            marginTop: '2px',
                          }}
                        >
                          Quét mã VietQR
                        </div>
                      </div>
                    )}
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                    color: 'var(--warning-text)',
                  }}
                >
                  <span>
                    Nhân sự chưa cập nhật Số tài khoản ngân hàng trong hồ sơ.
                  </span>
                  {onNavigate && (
                    <button
                      type="button"
                      onClick={() => {
                        closeDisburseModal();
                        onNavigate(
                          `/employees/${disburseEmployee.employee_id}`,
                        );
                      }}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        border: '1px solid #F59E0B',
                        backgroundColor: 'rgba(245, 158, 11, 0.15)',
                        color: 'var(--warning-text)',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Cập nhật TK ngân hàng →
                    </button>
                  )}
                </div>
              )}
              <div
                style={{
                  marginTop: '8px',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--border-subtle)',
                  color: 'var(--success-text)',
                  fontSize: '12px',
                }}
              >
                ✓ Khi xác nhận chi trả, hệ thống tự động ghi nhận Phiếu chi
                lương vào Sổ thu chi (/finance).
              </div>
            </div>

            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
            >
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '6px',
                  }}
                >
                  <label
                    style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                  >
                    Số tiền chi đợt này (VNĐ):
                  </label>
                  {!isUnresolvedRetry && (
                    <button
                      type="button"
                      onClick={() => {
                        const rem =
                          (disburseEmployee.confirmed.net_pay_vnd || 0) -
                          (disburseEmployee.confirmed.paid_amount_vnd || 0);
                        setDisburseAmount(String(rem));
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent-text)',
                        fontSize: '12px',
                        cursor: 'pointer',
                        fontWeight: 600,
                        textDecoration: 'underline',
                      }}
                    >
                      Chi hết phần còn lại
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  step="10000"
                  min="1"
                  disabled={isUnresolvedRetry}
                  value={disburseAmount}
                  onChange={(e) => setDisburseAmount(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    minHeight: '38px',
                    backgroundColor: isUnresolvedRetry
                      ? 'var(--surface-hover)'
                      : 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: isUnresolvedRetry
                      ? 'var(--muted-color)'
                      : 'var(--text-color)',
                    padding: '8px 12px',
                    fontSize: '14px',
                    fontWeight: 700,
                    cursor: isUnresolvedRetry ? 'not-allowed' : 'text',
                    opacity: isUnresolvedRetry ? 0.7 : 1,
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Hình thức thanh toán:
                </label>
                <select
                  disabled={isUnresolvedRetry}
                  value={disburseMethod}
                  onChange={(e) =>
                    setDisburseMethod(
                      e.target.value as 'bank_transfer' | 'cash' | 'other',
                    )
                  }
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    minHeight: '38px',
                    backgroundColor: isUnresolvedRetry
                      ? 'var(--surface-hover)'
                      : 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: isUnresolvedRetry
                      ? 'var(--muted-color)'
                      : 'var(--text-color)',
                    padding: '8px 12px',
                    fontSize: '13px',
                    cursor: isUnresolvedRetry ? 'not-allowed' : 'pointer',
                    opacity: isUnresolvedRetry ? 0.7 : 1,
                  }}
                >
                  <option value="bank_transfer">Chuyển khoản ngân hàng</option>
                  <option value="cash">Tiền mặt</option>
                  <option value="other">Hình thức khác</option>
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Ngày thanh toán:
                </label>
                <input
                  type="date"
                  disabled={isUnresolvedRetry}
                  value={disburseDate}
                  onChange={(e) => setDisburseDate(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    minHeight: '38px',
                    backgroundColor: isUnresolvedRetry
                      ? 'var(--surface-hover)'
                      : 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: isUnresolvedRetry
                      ? 'var(--muted-color)'
                      : 'var(--text-color)',
                    padding: '8px 12px',
                    fontSize: '14px',
                    cursor: isUnresolvedRetry ? 'not-allowed' : 'pointer',
                    opacity: isUnresolvedRetry ? 0.7 : 1,
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Ghi chú tham chiếu / chứng từ:
                </label>
                <input
                  type="text"
                  disabled={isUnresolvedRetry}
                  value={disburseNote}
                  onChange={(e) => setDisburseNote(e.target.value)}
                  placeholder="Ví dụ: Mã giao dịch Vietcombank, biên nhận…"
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    minHeight: '38px',
                    backgroundColor: isUnresolvedRetry
                      ? 'var(--surface-hover)'
                      : 'var(--surface-subtle)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    color: isUnresolvedRetry
                      ? 'var(--muted-color)'
                      : 'var(--text-color)',
                    padding: '8px 12px',
                    fontSize: '13px',
                    cursor: isUnresolvedRetry ? 'not-allowed' : 'text',
                    opacity: isUnresolvedRetry ? 0.7 : 1,
                  }}
                />
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
                marginTop: '24px',
              }}
            >
              <button
                type="button"
                onClick={closeDisburseModal}
                disabled={actionLoading}
                style={{
                  boxSizing: 'border-box',
                  minHeight: '36px',
                  padding: '6px 14px',
                  backgroundColor: 'var(--surface-hover)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--muted-color)',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Hủy
              </button>
              <AppButton
                variant="primary"
                onClick={handleSaveDisbursement}
                disabled={actionLoading}
                data-testid="disburse-submit-btn"
              >
                {actionLoading
                  ? 'Đang xử lý…'
                  : isUnresolvedRetry
                    ? 'Xác nhận chi (Thử lại an toàn)'
                    : 'Xác nhận chi'}
              </AppButton>
            </div>
          </AppCard>
        </div>
      )}

      {/* ======================== MODAL: FINALIZE PERIOD ======================== */}
      {showFinalizeModal && period && (
        <div
          data-testid="finalize-modal"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 1000,
          }}
        >
          <AppCard
            style={{
              width: '100%',
              maxWidth: '480px',
              padding: '24px',
              backgroundColor: 'var(--surface-color)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '16px',
              }}
            >
              <div
                style={{
                  fontSize: '16px',
                  fontWeight: 700,
                  color: 'var(--text-color)',
                }}
              >
                Xác nhận chốt bảng lương tháng {selectedMonth}
              </div>
              <button
                type="button"
                onClick={closeFinalizeModal}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--muted-color)',
                  cursor: 'pointer',
                }}
              >
                <CloseIcon size={18} />
              </button>
            </div>

            <div
              style={{
                padding: '12px 14px',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                borderRadius: '6px',
                color: 'var(--warning-text)',
                fontSize: '13px',
                marginBottom: '16px',
                lineHeight: '1.5',
              }}
            >
              <strong>Lưu ý quan trọng:</strong> Sau khi chốt sổ, toàn bộ dữ
              liệu giờ làm, đơn giá, lương cơ bản và nghỉ phép của kỳ lương sẽ
              chuyển sang trạng thái <strong>BẤT BIẾN</strong> và không thể
              chỉnh sửa hay hủy chốt.
            </div>

            <div
              style={{
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                padding: '12px 16px',
                marginBottom: '20px',
                fontSize: '13px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: 'var(--muted-color)',
                  marginBottom: '6px',
                }}
              >
                <span>Tổng số nhân sự tính lương:</span>
                <strong style={{ color: 'var(--text-color)' }}>
                  {items.length} nhân viên
                </strong>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: 'var(--muted-color)',
                  marginBottom: '6px',
                }}
              >
                <span>Tổng lương cơ bản đã duyệt:</span>
                <strong style={{ color: 'var(--info-text)' }}>
                  {formatVnd(aggregateMetrics.totalBasePay)}
                </strong>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: 'var(--muted-color)',
                  marginBottom: '6px',
                }}
              >
                <span>Tổng tiền nghỉ có lương:</span>
                <strong style={{ color: 'var(--purple-text, #A78BFA)' }}>
                  {formatVnd(aggregateMetrics.totalPaidLeave)}
                </strong>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  color: 'var(--text-color)',
                  fontWeight: 700,
                  fontSize: '14px',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <span>Tổng thực nhận (Net):</span>
                <span style={{ color: 'var(--success-text)' }}>
                  {formatVnd(aggregateMetrics.totalNetPay)}
                </span>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
              }}
            >
              <button
                data-testid="finalize-cancel-btn"
                type="button"
                onClick={closeFinalizeModal}
                disabled={actionLoading}
                style={{
                  boxSizing: 'border-box',
                  minHeight: '36px',
                  padding: '6px 14px',
                  backgroundColor: 'var(--surface-hover)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--muted-color)',
                  cursor: 'pointer',
                  fontSize: '13px',
                }}
              >
                Hủy
              </button>
              <AppButton
                data-testid="finalize-submit-btn"
                variant="primary"
                onClick={handleFinalizePeriod}
                disabled={actionLoading}
              >
                {actionLoading ? 'Đang chốt sổ…' : 'Xác nhận chốt kỳ lương'}
              </AppButton>
            </div>
          </AppCard>
        </div>
      )}
    </div>
  );
};
