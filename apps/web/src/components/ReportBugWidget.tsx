import React, { useState, useEffect, useRef } from 'react';
import {
  AlertTriangleIcon,
  CloseIcon,
  AppButton,
} from '../../../../packages/ui/src/components/index.js';
import { TOKENS, THEME_COLORS } from '../../../../packages/ui/src/tokens.js';

export interface ReportBugWidgetProps {
  currentPath: string;
  csrfToken?: string | undefined;
  userId?: string | undefined;
  workspaceId?: string | undefined;
}

export function generateReportIdempotencyKey(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `report-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getModuleNameFromPath(path: string): string {
  if (path === '/' || path === '') return 'Tổng quan (Dashboard)';
  if (path.startsWith('/clock')) return 'Chấm công (Clock)';
  if (path.startsWith('/schedule')) return 'Lịch làm việc (Schedule)';
  if (path.startsWith('/reports')) return 'Báo cáo chấm công (Reports)';
  if (path.startsWith('/payroll') || path.startsWith('/my-pay'))
    return 'Bảng lương (Payroll)';
  if (path.startsWith('/employees')) return 'Nhân sự (Employees)';
  if (path.startsWith('/work')) return 'Công việc (Work)';
  if (path.startsWith('/accounts')) return 'Tài khoản liên kết (Accounts)';
  if (path.startsWith('/storage')) return 'Kho lưu trữ (Storage)';
  if (path.startsWith('/audit')) return 'Nhật ký kiểm toán (Audit)';
  if (path.startsWith('/settings')) return 'Cài đặt hệ thống (Settings)';
  if (path.startsWith('/issues')) return 'Báo lỗi & Góp ý (Issues)';
  return path;
}

export interface BugReportSnapshotPayload {
  title?: string | undefined;
  description: string;
  route_template: string;
  module_name: string;
  severity?: 'P0' | 'P1' | 'P2' | 'P3' | undefined;
  screenshot_url?: string | undefined;
  metadata_context?: Record<string, unknown> | undefined;
}

export interface PendingBugReport {
  idempotencyKey: string;
  userId: string;
  workspaceId: string;
  snapshotPayload: BugReportSnapshotPayload;
  status: 'draft' | 'submitting' | 'unknown' | 'confirmed_error';
  lastError?: string | undefined;
  createdAt: number;
}

export const STORAGE_PREFIX = 'mglite_pending_report_v1';
export const inMemoryReports = new Map<string, PendingBugReport>();

export function getScopedStorageKey(
  workspaceId: string,
  userId: string,
): string {
  return `${STORAGE_PREFIX}:${workspaceId}:${userId}`;
}

export type StorageResult<T> =
  { success: true; data: T } | { success: false; error: string };

const ALLOWED_STATUSES = new Set([
  'draft',
  'submitting',
  'unknown',
  'confirmed_error',
]);

/**
 * Reads pending report scoped by workspace ID and user ID (FIX-01, FIX-04, FIX-02).
 * Fails closed if storage is restricted, unreadable, empty string, or corrupted.
 * ONLY raw === null is considered as no record.
 */
export function readPendingReportFromStorage(
  workspaceId: string,
  userId: string,
): StorageResult<PendingBugReport | null> {
  if (!workspaceId || !userId) {
    return {
      success: false,
      error:
        'Danh tính người dùng hoặc không gian làm việc chưa được xác thực.',
    };
  }

  const key = getScopedStorageKey(workspaceId, userId);

  if (typeof window === 'undefined' || !window.sessionStorage) {
    const mem = inMemoryReports.get(key);
    return { success: true, data: mem || null };
  }

  try {
    const raw = window.sessionStorage.getItem(key);

    // ONLY null means no record!
    if (raw === null) {
      const mem = inMemoryReports.get(key);
      return { success: true, data: mem || null };
    }

    // Empty string or whitespace is corrupted (fail-closed)
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return {
        success: false,
        error:
          'Dữ liệu phiên làm việc (sessionStorage) rỗng không hợp lệ. Thao tác báo lỗi bị khóa để đảm bảo an toàn.',
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        success: false,
        error:
          'Dữ liệu phiên làm việc (sessionStorage) bị lỗi phân tích cú pháp (JSON parse error). Thao tác báo lỗi bị khóa để đảm bảo an toàn.',
      };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {
        success: false,
        error:
          'Cấu trúc dữ liệu báo lỗi dở dang trong phiên không phải đối tượng hợp lệ.',
      };
    }

    const obj = parsed as Record<string, unknown>;

    // Validate idempotencyKey
    if (
      typeof obj.idempotencyKey !== 'string' ||
      obj.idempotencyKey.trim().length === 0
    ) {
      return {
        success: false,
        error: 'Dữ liệu báo lỗi dở dang thiếu khóa idempotencyKey hợp lệ.',
      };
    }

    // Validate status enum
    if (typeof obj.status !== 'string' || !ALLOWED_STATUSES.has(obj.status)) {
      return {
        success: false,
        error: `Trạng thái báo lỗi dở dang không hợp lệ (${String(obj.status)}).`,
      };
    }

    // Validate userId and workspaceId
    if (typeof obj.userId !== 'string' || obj.userId !== userId) {
      return {
        success: false,
        error:
          'Dữ liệu báo lỗi dở dang không khớp userId của người dùng hiện tại.',
      };
    }

    if (
      typeof obj.workspaceId !== 'string' ||
      obj.workspaceId !== workspaceId
    ) {
      return {
        success: false,
        error:
          'Dữ liệu báo lỗi dở dang không khớp workspaceId của phiên làm việc hiện tại.',
      };
    }

    // Validate snapshotPayload
    if (
      !obj.snapshotPayload ||
      typeof obj.snapshotPayload !== 'object' ||
      Array.isArray(obj.snapshotPayload)
    ) {
      return {
        success: false,
        error: 'Dữ liệu báo lỗi dở dang thiếu snapshotPayload hợp lệ.',
      };
    }

    const snap = obj.snapshotPayload as Record<string, unknown>;
    if (typeof snap.description !== 'string') {
      return {
        success: false,
        error: 'snapshotPayload thiếu trường description hợp lệ.',
      };
    }

    if (
      typeof snap.route_template !== 'string' ||
      snap.route_template.trim().length === 0
    ) {
      return {
        success: false,
        error: 'snapshotPayload thiếu trường route_template hợp lệ.',
      };
    }

    if (
      typeof snap.module_name !== 'string' ||
      snap.module_name.trim().length === 0
    ) {
      return {
        success: false,
        error: 'snapshotPayload thiếu trường module_name hợp lệ.',
      };
    }

    if (snap.title !== undefined && typeof snap.title !== 'string') {
      return {
        success: false,
        error: 'snapshotPayload chứa trường title không hợp lệ.',
      };
    }

    const validReport: PendingBugReport = {
      idempotencyKey: obj.idempotencyKey,
      userId: obj.userId,
      workspaceId: obj.workspaceId,
      snapshotPayload: {
        title: snap.title,
        description: snap.description,
        route_template: snap.route_template,
        module_name: snap.module_name,
      },
      status: obj.status as PendingBugReport['status'],
      lastError: typeof obj.lastError === 'string' ? obj.lastError : undefined,
      createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : Date.now(),
    };

    inMemoryReports.set(key, validReport);
    return { success: true, data: validReport };
  } catch (err: unknown) {
    return {
      success: false,
      error: `Không thể đọc dữ liệu từ bộ nhớ phiên làm việc (sessionStorage): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Writes pending report scoped by workspace ID and user ID (FIX-01, FIX-04).
 * Fails closed if storage is restricted or quota exceeded.
 */
export function writePendingReportToStorage(
  workspaceId: string,
  userId: string,
  report: PendingBugReport | null,
): StorageResult<void> {
  if (!workspaceId || !userId) {
    return {
      success: false,
      error:
        'Danh tính người dùng hoặc không gian làm việc chưa được xác thực.',
    };
  }

  const key = getScopedStorageKey(workspaceId, userId);

  if (typeof window === 'undefined' || !window.sessionStorage) {
    if (report) {
      inMemoryReports.set(key, report);
    } else {
      inMemoryReports.delete(key);
    }
    return { success: true, data: undefined };
  }

  try {
    if (report) {
      const serialized = JSON.stringify(report);
      window.sessionStorage.setItem(key, serialized);
      inMemoryReports.set(key, report);
    } else {
      window.sessionStorage.removeItem(key);
      inMemoryReports.delete(key);
    }
    return { success: true, data: undefined };
  } catch (err: unknown) {
    return {
      success: false,
      error: `Không thể lưu vào bộ nhớ phiên làm việc (sessionStorage): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// Backwards compatible wrappers
export function loadPendingReport(
  workspaceId = 'default-ws',
  userId = 'default-user',
): PendingBugReport | null {
  const res = readPendingReportFromStorage(workspaceId, userId);
  return res.success ? res.data : null;
}

export function savePendingReport(
  report: PendingBugReport | null,
  workspaceId = 'default-ws',
  userId = 'default-user',
): void {
  writePendingReportToStorage(workspaceId, userId, report);
}

export const ReportBugWidget: React.FC<ReportBugWidgetProps> = ({
  currentPath,
  csrfToken,
  userId,
  workspaceId,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [resolvedUserId, setResolvedUserId] = useState<string | undefined>(
    userId,
  );
  const [resolvedWorkspaceId, setResolvedWorkspaceId] = useState<
    string | undefined
  >(workspaceId);
  const [resolvedCsrf, setResolvedCsrf] = useState<string | undefined>(
    csrfToken,
  );

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<'P0' | 'P1' | 'P2' | 'P3'>('P2');
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);

  // Unknown Outcome & Snapshot State (FIX-02, FIX-03)
  const [isUnknownOutcome, setIsUnknownOutcome] = useState(false);
  const [pendingSnapshot, setPendingSnapshot] =
    useState<BugReportSnapshotPayload | null>(null);

  // Draggable floating button state (mouse + touch pointer events)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem('mglite_bug_btn_pos');
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { x?: unknown; y?: unknown };
      if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
        const maxX = Math.max(8, window.innerWidth - 116);
        const maxY = Math.max(52, window.innerHeight - (window.innerWidth <= 768 ? 112 : 56));
        return {
          x: Math.min(Math.max(8, parsed.x), maxX),
          y: Math.min(Math.max(52, parsed.y), maxY),
        };
      }
    } catch {}
    return null;
  });
  const [isDraggingBtn, setIsDraggingBtn] = useState(false);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    width: number;
    height: number;
    moved: boolean;
  } | null>(null);
  const justDraggedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      setDragPos((prev) => {
        if (!prev) return null;
        const maxX = Math.max(8, window.innerWidth - 116);
        const maxY = Math.max(52, window.innerHeight - (window.innerWidth <= 768 ? 112 : 56));
        return {
          x: Math.min(Math.max(8, prev.x), maxX),
          y: Math.min(Math.max(52, prev.y), maxY),
        };
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleBtnPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: rect.left,
      origY: rect.top,
      width: rect.width || 108,
      height: rect.height || 44,
      moved: false,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  const handleBtnPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const st = dragStateRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    const dx = e.clientX - st.startX;
    const dy = e.clientY - st.startY;
    if (!st.moved && Math.hypot(dx, dy) < 6) return;
    st.moved = true;
    if (!isDraggingBtn) setIsDraggingBtn(true);
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const bottomInset = vw <= 768 ? 68 : 12;
    const nextX = Math.min(Math.max(8, Math.round(st.origX + dx)), Math.max(8, vw - st.width - 8));
    const nextY = Math.min(Math.max(52, Math.round(st.origY + dy)), Math.max(52, vh - st.height - bottomInset));
    setDragPos({ x: nextX, y: nextY });
  };

  const handleBtnPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const st = dragStateRef.current;
    if (!st || st.pointerId !== e.pointerId) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    if (st.moved) {
      justDraggedRef.current = true;
      setTimeout(() => {
        justDraggedRef.current = false;
      }, 250);
      setDragPos((latest) => {
        if (latest) {
          try {
            localStorage.setItem('mglite_bug_btn_pos', JSON.stringify(latest));
          } catch {}
        }
        return latest;
      });
    }
    setIsDraggingBtn(false);
    dragStateRef.current = null;
  };

  const idempotencyKeyRef = useRef<string>(generateReportIdempotencyKey());

  // Generation counter and AbortControllers for identity isolation (FIX-01)
  const identityEpochRef = useRef<number>(0);
  const authAbortControllerRef = useRef<AbortController | null>(null);
  const submitAbortControllerRef = useRef<AbortController | null>(null);
  const prevIdentityRef = useRef<{
    userId?: string | undefined;
    workspaceId?: string | undefined;
  }>({
    userId,
    workspaceId,
  });

  // IDENTITY LIFECYCLE (FIX-01):
  // When userId or workspaceId changes (including A -> B, A -> undefined, undefined -> A):
  // 1. Invalidate in-flight async operations
  // 2. Clear UI state immediately so no data of previous identity is visible
  // 3. Clear resolved identity and CSRF if undefined
  useEffect(() => {
    const prev = prevIdentityRef.current;
    const hasChanged =
      prev.userId !== userId || prev.workspaceId !== workspaceId;
    if (!hasChanged) return;

    prevIdentityRef.current = { userId, workspaceId };
    identityEpochRef.current++;

    // Abort in-flight requests
    if (authAbortControllerRef.current) {
      authAbortControllerRef.current.abort();
      authAbortControllerRef.current = null;
    }
    if (submitAbortControllerRef.current) {
      submitAbortControllerRef.current.abort();
      submitAbortControllerRef.current = null;
    }

    // Invalidate UI state
    setIsOpen(false);
    setTitle('');
    setDescription('');
    setIsSubmitting(false);
    setIsSuccess(false);
    setIsUnknownOutcome(false);
    setPendingSnapshot(null);
    setErrorMessage(null);
    setPersistenceError(null);
    idempotencyKeyRef.current = generateReportIdempotencyKey();

    setResolvedUserId(userId);
    setResolvedWorkspaceId(workspaceId);
    setResolvedCsrf(csrfToken);
  }, [userId, workspaceId, csrfToken]);

  // Keep CSRF in sync if parent updates it
  useEffect(() => {
    if (csrfToken !== undefined) setResolvedCsrf(csrfToken);
  }, [csrfToken]);

  // Fallback: Authoritative identity check from /api/v1/auth/me ONLY when identity is entirely unpassed
  useEffect(() => {
    if (resolvedUserId && resolvedWorkspaceId) return;
    if (userId !== undefined || workspaceId !== undefined) {
      // Identity explicitly managed by parent
      return;
    }

    const controller = new AbortController();
    authAbortControllerRef.current = controller;
    const fetchEpoch = identityEpochRef.current;

    fetch('/api/v1/auth/me', {
      credentials: 'include',
      signal: controller.signal,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (fetchEpoch !== identityEpochRef.current) return;
        if (!body?.success || !body?.data) return;
        const uId = body.data.user?.id;
        const wId = body.data.active_workspace?.id;
        const csrf = body.data.csrf_token;
        if (typeof uId === 'string' && typeof wId === 'string') {
          setResolvedUserId(uId);
          setResolvedWorkspaceId(wId);
          if (typeof csrf === 'string') setResolvedCsrf(csrf);
        }
      })
      .catch(() => {});

    return () => {
      controller.abort();
    };
  }, [userId, workspaceId, resolvedUserId, resolvedWorkspaceId]);

  const handleOpen = () => {
    setPersistenceError(null);
    setErrorMessage(null);

    // FIX-01: Guard unverified identity. Never hydrate if identity not verified!
    if (!resolvedUserId || !resolvedWorkspaceId) {
      setErrorMessage(
        'Phiên làm việc chưa được xác thực. Vui lòng đăng nhập để gửi báo lỗi hệ thống.',
      );
      setIsOpen(true);
      return;
    }

    // FIX-04, FIX-02: Fail-closed persistence read with strict schema validation
    const readRes = readPendingReportFromStorage(
      resolvedWorkspaceId,
      resolvedUserId,
    );
    if (!readRes.success) {
      setPersistenceError(readRes.error);
      setErrorMessage(readRes.error);
      setIsOpen(true);
      return;
    }

    const pending = readRes.data;
    if (pending) {
      if (pending.status === 'unknown' || pending.status === 'submitting') {
        // FIX-02, FIX-03: Restore exact unknown key and immutable snapshot payload
        setTitle(pending.snapshotPayload.title || '');
        setDescription(pending.snapshotPayload.description);
        idempotencyKeyRef.current = pending.idempotencyKey;
        setIsUnknownOutcome(true);
        setPendingSnapshot(pending.snapshotPayload);
        setErrorMessage(
          pending.lastError ||
            'Báo cáo lỗi trước đó chưa nhận được xác nhận từ máy chủ (mất kết nối hoặc gián đoạn). Bấm "Gửi lại" để hoàn tất an toàn.',
        );
      } else if (pending.status === 'draft') {
        // Local draft: restore draft
        setTitle(pending.snapshotPayload.title || '');
        setDescription(pending.snapshotPayload.description);
        idempotencyKeyRef.current = pending.idempotencyKey;
        setIsUnknownOutcome(false);
        setPendingSnapshot(null);
      } else {
        // Confirmed error
        setTitle(pending.snapshotPayload.title || '');
        setDescription(pending.snapshotPayload.description);
        idempotencyKeyRef.current = pending.idempotencyKey;
        setIsUnknownOutcome(false);
        setPendingSnapshot(null);
        setErrorMessage(pending.lastError || null);
      }
    } else {
      // Defensive purge of any legacy draft in sessionStorage
      try {
        sessionStorage.removeItem('mgmt_bug_report_draft');
      } catch {}

      // Fresh clean draft
      const defaultTitle =
        currentPath ||
        (typeof window !== 'undefined' ? window.location.pathname : '/');
      const newKey = generateReportIdempotencyKey();
      idempotencyKeyRef.current = newKey;
      setTitle(defaultTitle);
      setDescription('');
      setIsUnknownOutcome(false);
      setPendingSnapshot(null);
    }

    setIsOpen(true);
    setIsSuccess(false);
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setIsOpen(false);
    // Do NOT delete unknown outcome reports on close! They remain safely persisted.
    if (
      !description.trim() &&
      !isUnknownOutcome &&
      resolvedWorkspaceId &&
      resolvedUserId
    ) {
      writePendingReportToStorage(resolvedWorkspaceId, resolvedUserId, null);
    }
  };

  // FIX-02: Discard is strictly disabled during unknown outcome to prevent losing reconciliation
  const handleDiscardAndNew = () => {
    if (isSubmitting || isUnknownOutcome) return;
    if (resolvedWorkspaceId && resolvedUserId) {
      writePendingReportToStorage(resolvedWorkspaceId, resolvedUserId, null);
    }
    const defaultTitle =
      currentPath ||
      (typeof window !== 'undefined' ? window.location.pathname : '/');
    const newKey = generateReportIdempotencyKey();
    idempotencyKeyRef.current = newKey;
    setTitle(defaultTitle);
    setDescription('');
    setErrorMessage(null);
    setPersistenceError(null);
    setIsUnknownOutcome(false);
    setPendingSnapshot(null);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setErrorMessage('Ảnh đính kèm vượt quá 2MB. Vui lòng chọn ảnh nhỏ hơn.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      if (typeof event.target?.result === 'string') {
        setScreenshotUrl(event.target.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleClearImage = () => {
    setScreenshotUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!resolvedUserId || !resolvedWorkspaceId) {
      setErrorMessage(
        'Phiên làm việc chưa được xác thực. Không thể gửi báo lỗi.',
      );
      return;
    }

    if (persistenceError) {
      setErrorMessage(
        'Bộ nhớ phiên làm việc (sessionStorage) đang gặp sự cố. Báo lỗi bị khóa để đảm bảo an toàn.',
      );
      return;
    }

    if (!description.trim()) {
      setErrorMessage('Vui lòng nhập mô tả chi tiết lỗi gặp phải.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const submitEpoch = identityEpochRef.current;
    const activeUserId = resolvedUserId;
    const activeWorkspaceId = resolvedWorkspaceId;

    const controller = new AbortController();
    submitAbortControllerRef.current = controller;

    // PRE-POST AUTHORITATIVE SESSION VERIFICATION (FIX-01):
    // Before executing POST, verify that the current session still matches activeUserId and activeWorkspaceId!
    // Prevents races where user logged out or switched workspace in another tab.
    let effectiveCsrf = resolvedCsrf;
    try {
      const meRes = await fetch('/api/v1/auth/me', {
        credentials: 'include',
        signal: controller.signal,
      });

      if (submitEpoch !== identityEpochRef.current) return;

      if (!meRes.ok) {
        // Security hotfix: Do NOT store verbatim form drafts or tokens into shared sessionStorage
        try {
          sessionStorage.removeItem('mgmt_bug_report_draft');
        } catch {}

        setIsSubmitting(false);
        setErrorMessage(
          'Phiên làm việc đã hết hạn hoặc không hợp lệ. Đang chuyển về trang đăng nhập…',
        );
        return;
      }

      const meData = await meRes.json().catch(() => null);
      if (submitEpoch !== identityEpochRef.current) return;

      const currentSessionUser = meData?.data?.user?.id;
      const currentSessionWs = meData?.data?.active_workspace?.id;

      // prettier-ignore
      if (currentSessionUser !== activeUserId || currentSessionWs !== activeWorkspaceId) {
        setIsSubmitting(false);
        setErrorMessage(
          'Phiên làm việc đã thay đổi người dùng hoặc không gian làm việc. Báo lỗi bị hủy để bảo đảm an toàn dữ liệu.',
        );
        setIsOpen(false);
        return;
      }

      if (meData?.data?.csrf_token) {
        effectiveCsrf = meData.data.csrf_token;
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setIsSubmitting(false);
      setErrorMessage(
        'Không thể xác minh phiên làm việc trước khi gửi báo lỗi.',
      );
      return;
    }

    const currentKey = idempotencyKeyRef.current;

    // FIX-03: If retrying an unknown request, use exact snapshot payload without modification
    let payloadToSubmit: BugReportSnapshotPayload;
    if (isUnknownOutcome && pendingSnapshot) {
      payloadToSubmit = {
        title: pendingSnapshot.title,
        description: pendingSnapshot.description,
        route_template: pendingSnapshot.route_template,
        module_name: pendingSnapshot.module_name,
        severity: pendingSnapshot.severity || severity,
        screenshot_url:
          pendingSnapshot.screenshot_url || screenshotUrl || undefined,
        metadata_context: pendingSnapshot.metadata_context,
      };
    } else {
      const moduleName = getModuleNameFromPath(currentPath);
      payloadToSubmit = {
        title: title.trim() || undefined,
        description, // Preserve verbatim description (no trim)
        route_template: currentPath || '/',
        module_name: moduleName,
        severity,
        screenshot_url: screenshotUrl || undefined,
        metadata_context: {
          url:
            typeof window !== 'undefined' ? window.location.href : currentPath,
          route_template: currentPath || '/',
          client_timestamp: new Date().toISOString(),
          user_agent:
            typeof navigator !== 'undefined' ? navigator.userAgent : '',
          error_id: `ERR-${Date.now().toString(36).toUpperCase()}`,
          request_id: currentKey,
          release_sha:
            (typeof window !== 'undefined' &&
              (window as unknown as { __LIVE_SHA__?: string }).__LIVE_SHA__) ||
            (typeof document !== 'undefined' &&
              document
                .querySelector('meta[name="release-sha"]')
                ?.getAttribute('content')) ||
            'production-live',
        },
      };
    }

    // FIX-04: FAIL-CLOSED PERSISTENCE CHECK BEFORE HTTP POST
    const writePreRes = writePendingReportToStorage(
      activeWorkspaceId,
      activeUserId,
      {
        idempotencyKey: currentKey,
        userId: activeUserId,
        workspaceId: activeWorkspaceId,
        snapshotPayload: payloadToSubmit,
        status: 'submitting',
        createdAt: Date.now(),
      },
    );

    if (!writePreRes.success) {
      setIsSubmitting(false);
      setPersistenceError(writePreRes.error);
      setErrorMessage(
        `Không thể lưu trạng thái phiên làm việc: ${writePreRes.error}. Thao tác gửi bị chặn để bảo vệ an toàn idempotency.`,
      );
      return;
    }

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Idempotency-Key': currentKey,
      };
      if (effectiveCsrf) {
        headers['X-CSRF-Token'] = effectiveCsrf;
      }

      const res = await fetch('/api/v1/reports', {
        method: 'POST',
        headers,
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify(payloadToSubmit),
      });

      if (submitEpoch !== identityEpochRef.current) return;

      const data = await res.json().catch(() => null);
      if (submitEpoch !== identityEpochRef.current) return;

      if (res.status === 201) {
        // CONFIRMED SUCCESS (FIX-02): Clean up pending operation and permit new reports
        setIsSuccess(true);
        setIsUnknownOutcome(false);
        setPendingSnapshot(null);
        writePendingReportToStorage(activeWorkspaceId, activeUserId, null);
        try {
          sessionStorage.removeItem('mgmt_bug_report_draft');
        } catch {}
        idempotencyKeyRef.current = generateReportIdempotencyKey();

        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('issues-updated', { detail: data?.data }),
          );
          window.dispatchEvent(
            new CustomEvent('audit-updated', { detail: data?.data }),
          );
        }

        setTimeout(() => {
          if (submitEpoch !== identityEpochRef.current) return;
          setIsOpen(false);
          setIsSuccess(false);
          setTitle('');
          setDescription('');
        }, 1200);
        return;
      }

      // Check if server returned a definitive client rejection (400 validation error / 403 forbidden)
      const isConfirmedClientFailure = res.status === 400 || res.status === 403;

      if (isConfirmedClientFailure) {
        // Confirmed client failure: Server rejected without creating an issue
        const msg =
          data?.error?.message || `Yêu cầu không hợp lệ (${res.status}).`;
        setIsUnknownOutcome(false);
        setErrorMessage(msg);
        writePendingReportToStorage(activeWorkspaceId, activeUserId, {
          idempotencyKey: currentKey,
          userId: activeUserId,
          workspaceId: activeWorkspaceId,
          snapshotPayload: payloadToSubmit,
          status: 'confirmed_error',
          lastError: msg,
          createdAt: Date.now(),
        });
        return;
      }

      // UNKNOWN OUTCOME (FIX-02, FIX-03): Server returned 5xx, 502, 503, 504, or unexpected status
      const unknownMsg =
        data?.error?.message ||
        `Máy chủ phản hồi mã lỗi ${res.status}. Báo lỗi có thể đã được tiếp nhận. Vui lòng bấm "Gửi lại" để hoàn tất an toàn.`;
      setIsUnknownOutcome(true);
      setPendingSnapshot(payloadToSubmit);
      setErrorMessage(unknownMsg);
      writePendingReportToStorage(activeWorkspaceId, activeUserId, {
        idempotencyKey: currentKey,
        userId: activeUserId,
        workspaceId: activeWorkspaceId,
        snapshotPayload: payloadToSubmit,
        status: 'unknown',
        lastError: unknownMsg,
        createdAt: Date.now(),
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (submitEpoch !== identityEpochRef.current) return;

      // UNKNOWN OUTCOME (FIX-02, FIX-03): Network error, timeout, or lost response
      const networkMsg =
        'Mất kết nối mạng hoặc không nhận được phản hồi từ máy chủ. Báo lỗi có thể đã được lưu. Vui lòng bấm "Gửi lại" để hoàn tất an toàn.';
      setIsUnknownOutcome(true);
      setPendingSnapshot(payloadToSubmit);
      setErrorMessage(networkMsg);
      writePendingReportToStorage(activeWorkspaceId, activeUserId, {
        idempotencyKey: currentKey,
        userId: activeUserId,
        workspaceId: activeWorkspaceId,
        snapshotPayload: payloadToSubmit,
        status: 'unknown',
        lastError: networkMsg,
        createdAt: Date.now(),
      });
    } finally {
      if (submitEpoch === identityEpochRef.current) {
        setIsSubmitting(false);
      }
    }
  };

  const currentDisplayModule =
    isUnknownOutcome && pendingSnapshot
      ? pendingSnapshot.module_name
      : getModuleNameFromPath(currentPath);

  const currentDisplayRoute =
    isUnknownOutcome && pendingSnapshot
      ? pendingSnapshot.route_template
      : currentPath || '/';

  const isFormLocked =
    isSubmitting ||
    isSuccess ||
    isUnknownOutcome ||
    Boolean(persistenceError) ||
    !resolvedUserId ||
    !resolvedWorkspaceId;

  const canDiscardDraft =
    !isUnknownOutcome && description.trim().length > 0 && !isSuccess;

  return (
    <>
      {/* Floating & Draggable Trigger Button */}
      <button
        type="button"
        onClick={() => {
          if (justDraggedRef.current) {
            justDraggedRef.current = false;
            return;
          }
          handleOpen();
        }}
        onPointerDown={handleBtnPointerDown}
        onPointerMove={handleBtnPointerMove}
        onPointerUp={handleBtnPointerUp}
        onPointerCancel={handleBtnPointerUp}
        data-testid="btn-open-report-bug"
        data-dragged={dragPos ? "true" : "false"}
        aria-label="Báo lỗi hệ thống (có thể kéo để di chuyển)"
        title="Bấm để báo lỗi • Giữ và kéo để di chuyển vị trí nút"
        className="btn-floating-report-bug"
        style={{
          position: 'fixed',
          ...(dragPos
            ? { left: `${dragPos.x}px`, top: `${dragPos.y}px`, right: 'auto', bottom: 'auto' }
            : { bottom: TOKENS.spacing[6], right: TOKENS.spacing[6] }),
          zIndex: 900,
          display: 'flex',
          alignItems: 'center',
          gap: TOKENS.spacing[2],
          padding: `${TOKENS.spacing[2]} ${TOKENS.spacing[4]}`,
          borderRadius: TOKENS.radii.full,
          backgroundColor: THEME_COLORS.surfaceHover,
          color: THEME_COLORS.text,
          border: `1px solid ${THEME_COLORS.border}`,
          boxShadow: isDraggingBtn ? TOKENS.shadows.lg : TOKENS.shadows.sm,
          fontSize: TOKENS.typography.fontSize.base,
          fontWeight: TOKENS.typography.fontWeight.semibold,
          cursor: isDraggingBtn ? 'grabbing' : 'grab',
          touchAction: 'none',
          userSelect: 'none',
          outline: 'none',
          minHeight: TOKENS.touchTarget.minHeight,
          minWidth: TOKENS.touchTarget.minWidth,
          transition: isDraggingBtn ? 'none' : TOKENS.motion.transitionBase,
        }}
      >
        <AlertTriangleIcon size={16} style={{ color: THEME_COLORS.danger }} />
        <span>Báo lỗi</span>
      </button>

      {/* Modal Dialog */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-modal-title"
          data-testid="report-bug-modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            backgroundColor: 'rgba(11, 18, 32, 0.8)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            boxSizing: 'border-box',
            overscrollBehavior: 'contain',
          }}
        >
          <div
            data-testid="report-bug-modal-container"
            style={{
              width: '100%',
              maxWidth: '520px',
              maxHeight: 'calc(100dvh - 32px)',
              overflowY: 'auto',
              overscrollBehavior: 'contain',
              backgroundColor: 'var(--surface-color)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '20px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
              boxSizing: 'border-box',
              color: 'var(--text-color)',
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                marginBottom: '16px',
              }}
            >
              <div>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <AlertTriangleIcon size={20} style={{ color: 'var(--danger-text)' }} />
                  <h3
                    id="report-modal-title"
                    style={{
                      margin: 0,
                      fontSize: '17px',
                      fontWeight: 700,
                      color: 'var(--text-color)',
                    }}
                  >
                    Báo lỗi hệ thống
                  </h3>
                </div>
                <p
                  style={{
                    margin: '4px 0 0 0',
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                  }}
                >
                  Phản hồi sự cố kỹ thuật hoặc lỗi hiển thị trên màn hình hiện
                  tại.
                </p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                disabled={isSubmitting}
                data-testid="btn-close-report-modal"
                aria-label="Đóng popup báo lỗi"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--muted-color)',
                  cursor: isSubmitting ? 'not-allowed' : 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: '6px',
                }}
              >
                <CloseIcon size={20} />
              </button>
            </div>

            {/* Auto System Metadata Info (FIX-03: Displays snapshot metadata if retrying unknown request) */}
            <div
              data-testid="report-metadata-box"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '10px 14px',
                marginBottom: '18px',
                fontSize: '12px',
                color: 'var(--muted-color)',
                lineHeight: '1.6',
              }}
            >
              <div>
                <strong style={{ color: 'var(--text-secondary)' }}>Hệ thống Web:</strong>{' '}
                <span style={{ color: 'var(--accent-text)', fontWeight: 600 }}>
                  ql.hoaiphuong.click
                </span>
              </div>
              <div>
                <strong style={{ color: 'var(--text-secondary)' }}>Vị trí phát sinh:</strong>{' '}
                <span style={{ color: 'var(--info-text)' }}>{currentDisplayModule}</span>
                {isUnknownOutcome &&
                  currentDisplayModule !==
                    getModuleNameFromPath(currentPath) && (
                    <span
                      style={{
                        color: 'var(--warning-text)',
                        marginLeft: '6px',
                        fontSize: '12px',
                      }}
                    >
                      (Gốc khi gửi)
                    </span>
                  )}
              </div>
              <div>
                <strong style={{ color: 'var(--text-secondary)' }}>Đường dẫn:</strong>{' '}
                <code style={{ color: 'var(--text-color)' }}>{currentDisplayRoute}</code>
                {isUnknownOutcome &&
                  currentDisplayRoute !== (currentPath || '/') && (
                    <span
                      style={{
                        color: 'var(--warning-text)',
                        marginLeft: '6px',
                        fontSize: '12px',
                      }}
                    >
                      (Gốc khi gửi)
                    </span>
                  )}
              </div>
            </div>

            {/* Error Banner */}
            {errorMessage && (
              <div
                role="alert"
                data-testid="report-error-alert"
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid #EF4444',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  marginBottom: '16px',
                  color: 'var(--danger-text)',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <AlertTriangleIcon
                  size={16}
                  style={{ color: 'var(--danger-text)', flexShrink: 0 }}
                />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Success Banner */}
            {isSuccess && (
              <div
                role="status"
                data-testid="report-success-alert"
                style={{
                  backgroundColor: 'rgba(34, 197, 94, 0.1)',
                  border: '1px solid #22C55E',
                  borderRadius: '8px',
                  padding: '12px 14px',
                  marginBottom: '16px',
                  color: '#86EFAC',
                  fontSize: '13px',
                  fontWeight: 600,
                  textAlign: 'center',
                }}
              >
                ✓ Báo lỗi đã được gửi thành công. Cảm ơn bạn đã phản hồi!
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} noValidate>
              <div style={{ marginBottom: '16px' }}>
                <label
                  htmlFor="report-title"
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--text-color)',
                    marginBottom: '6px',
                  }}
                >
                  Đường link / Tiêu đề sự cố
                </label>
                <input
                  id="report-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Đường dẫn màn hình hoặc tiêu đề ngắn gọn…"
                  maxLength={200}
                  disabled={isFormLocked}
                  data-testid="input-report-title"
                  style={{
                    width: '100%',
                    minHeight: '40px',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: isFormLocked ? 'var(--surface-hover)' : 'var(--bg-color)',
                    color: isFormLocked ? 'var(--muted-color)' : 'var(--text-color)',
                    cursor: isFormLocked ? 'not-allowed' : 'text',
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '6px',
                  }}
                >
                  <label
                    htmlFor="report-description"
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: 'var(--text-color)',
                    }}
                  >
                    Mô tả chi tiết lỗi{' '}
                    <span style={{ color: 'var(--danger-text)' }}>*</span>
                  </label>
                  <span style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                    {description.length}/2000
                  </span>
                </div>
                <textarea
                  id="report-description"
                  autoFocus={!isFormLocked}
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Vui lòng mô tả cụ thể thao tác của bạn và hiện tượng bất thường xuất hiện…"
                  maxLength={2000}
                  disabled={isFormLocked}
                  data-testid="input-report-description"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: isFormLocked ? 'var(--surface-hover)' : 'var(--bg-color)',
                    color: isFormLocked ? 'var(--muted-color)' : 'var(--text-color)',
                    cursor: isFormLocked ? 'not-allowed' : 'text',
                    fontSize: '14px',
                    outline: 'none',
                    boxSizing: 'border-box',
                    resize: 'vertical',
                    minHeight: '90px',
                  }}
                />
              </div>

              {/* Severity Selection */}
              <div style={{ marginBottom: '16px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--text-color)',
                    marginBottom: '8px',
                  }}
                >
                  Mức độ nghiêm trọng
                </label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {[
                    { id: 'P0', label: 'P0 - Khẩn cấp', color: 'var(--danger-text)' },
                    { id: 'P1', label: 'P1 - Cao', color: '#F97316' },
                    { id: 'P2', label: 'P2 - Bình thường', color: 'var(--info-text)' },
                    { id: 'P3', label: 'P3 - Thấp', color: 'var(--muted-color)' },
                  ].map((item) => {
                    const isSelected = severity === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() =>
                          setSeverity(item.id as 'P0' | 'P1' | 'P2' | 'P3')
                        }
                        disabled={isFormLocked}
                        style={{
                          padding: '6px 12px',
                          borderRadius: '6px',
                          border: isSelected
                            ? `2px solid ${item.color}`
                            : '1px solid var(--border-color)',
                          backgroundColor: isSelected
                            ? 'rgba(56, 189, 248, 0.15)'
                            : 'var(--surface-hover)',
                          color: isSelected ? '#FFFFFF' : 'var(--muted-color)',
                          fontSize: '12px',
                          fontWeight: isSelected ? 700 : 500,
                          cursor: isFormLocked ? 'not-allowed' : 'pointer',
                          transition:
                            'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease',
                        }}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Screenshot Upload */}
              <div style={{ marginBottom: '20px' }}>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  onChange={handleImageChange}
                  style={{ display: 'none' }}
                  disabled={isFormLocked}
                />
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--text-color)',
                    marginBottom: '6px',
                  }}
                >
                  Ảnh chụp sự cố (Tùy chọn)
                </label>
                {screenshotUrl ? (
                  <div
                    style={{
                      position: 'relative',
                      display: 'inline-block',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      border: '1px solid var(--border-color)',
                      maxWidth: '100%',
                    }}
                  >
                    <img
                      src={screenshotUrl}
                      alt="Ảnh đính kèm"
                      style={{
                        maxHeight: '120px',
                        maxWidth: '100%',
                        display: 'block',
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleClearImage}
                      disabled={isFormLocked}
                      style={{
                        position: 'absolute',
                        top: '4px',
                        right: '4px',
                        backgroundColor: 'rgba(0, 0, 0, 0.7)',
                        border: 'none',
                        color: 'var(--danger-text)',
                        borderRadius: '50%',
                        width: '24px',
                        height: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                      }}
                      title="Xóa ảnh"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isFormLocked}
                    style={{
                      padding: '8px 14px',
                      borderRadius: '6px',
                      border: '1px dashed var(--border-hover)',
                      backgroundColor: 'var(--surface-subtle)',
                      color: 'var(--muted-color)',
                      fontSize: '13px',
                      cursor: isFormLocked ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    📷 Chọn ảnh chụp màn hình (tối đa 2MB)
                  </button>
                )}
              </div>

              {/* Action Buttons */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  gap: '10px',
                }}
              >
                {/* FIX-02: Discard is only permitted for local drafts / client errors, NEVER during unknown outcome */}
                {canDiscardDraft && (
                  <button
                    type="button"
                    onClick={handleDiscardAndNew}
                    disabled={isSubmitting}
                    data-testid="btn-discard-pending-report"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--muted-color)',
                      fontSize: '13px',
                      textDecoration: 'underline',
                      cursor: isSubmitting ? 'not-allowed' : 'pointer',
                      padding: 0,
                      marginRight: 'auto',
                    }}
                  >
                    Hủy bản nháp
                  </button>
                )}

                <AppButton
                  type="button"
                  variant="secondary"
                  onClick={handleClose}
                  disabled={isSubmitting}
                  data-testid="btn-cancel-report"
                  style={{ minHeight: '40px', minWidth: '80px' }}
                >
                  Đóng
                </AppButton>

                <AppButton
                  type="submit"
                  variant="destructive"
                  isLoading={isSubmitting}
                  disabled={
                    isSubmitting ||
                    isSuccess ||
                    Boolean(persistenceError) ||
                    !resolvedUserId ||
                    !resolvedWorkspaceId
                  }
                  data-testid="btn-submit-report"
                  style={{
                    minHeight: '40px',
                    minWidth: '120px',
                    backgroundColor: '#DC2626',
                    borderColor: '#EF4444',
                    color: '#FFFFFF',
                  }}
                >
                  {isSubmitting
                    ? isUnknownOutcome
                      ? 'Đang gửi lại…'
                      : 'Đang gửi…'
                    : isUnknownOutcome
                      ? 'Gửi lại'
                      : 'Gửi báo lỗi'}
                </AppButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Floating button responsive styles */}
      <style>{`
        .app-shell-report-dock .btn-floating-report-bug {
          position: fixed;
          z-index: 900;
        }
        @media (max-width: 768px) {
          .btn-floating-report-bug:not([data-dragged="true"]) {
            bottom: calc(68px + env(safe-area-inset-bottom, 0px)) !important;
            right: 16px !important;
          }
          .btn-floating-report-bug {
            padding: 8px 14px !important;
            font-size: 12px !important;
            min-height: 44px !important;
          }
        }
      `}</style>
    </>
  );
};
