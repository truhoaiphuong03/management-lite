import React, { useState, useEffect, useRef } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  StatusBadge,
  LoadingState,
  ErrorState,
  EmptyState,
  AlertTriangleIcon,
  PlayIcon,
  PauseIcon,
  StopIcon,
  ClockIcon,
  CheckIcon,
  CloseIcon,
  UserIcon,
  CalendarIcon,
  FileTextIcon,
  AppDialog,
  AppToast,
  Pagination,
  PAGINATION_PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  clampPage,
  type ToastVariant,
} from '../../../../packages/ui/src/components/index.js';
import { TOKENS, THEME_COLORS } from '../../../../packages/ui/src/tokens.js';
import type { UserRole } from '../types.js';
import type {
  ShiftData,
  AttendanceMeResponseData,
} from '../../../../packages/contracts/src/attendance.js';
import type { EmployeeData } from '../../../../packages/contracts/src/employees.js';

export interface ClockScreenProps {
  role?: UserRole;
  mode?: 'clock' | 'history' | 'review';
  onNavigate?: (path: string) => void;
}

export const ClockScreen: React.FC<ClockScreenProps> = ({
  role = 'owner',
  mode = 'clock',
  onNavigate,
}) => {
  const [activeTab, setActiveTab] = useState<'my_clock' | 'owner_review'>(
    mode === 'review' || (mode === 'history' && role === 'owner')
      ? 'owner_review'
      : 'my_clock',
  );

  // Auth / CSRF State
  const [csrfToken, setCsrfToken] = useState<string>('');

  // Self Attendance State
  const [currentShift, setCurrentShift] = useState<ShiftData | null>(null);
  const [recentShifts, setRecentShifts] = useState<ShiftData[]>([]);
  const [myFromDate, setMyFromDate] = useState<string>('');
  const [myToDate, setMyToDate] = useState<string>('');
  const [myReviewStateFilter, setMyReviewStateFilter] = useState<string>('all');
  const [myShiftPage, setMyShiftPage] = useState<number>(0);
  const [myShiftPageSize, setMyShiftPageSize] =
    useState<number>(DEFAULT_PAGE_SIZE);

  const filteredRecentShifts = React.useMemo(() => {
    return recentShifts.filter((shift) => {
      if (
        myReviewStateFilter !== 'all' &&
        shift.review_state !== myReviewStateFilter
      ) {
        return false;
      }
      if (myFromDate) {
        const start = new Date(`${myFromDate}T00:00:00`);
        if (new Date(shift.clock_in_at) < start) return false;
      }
      if (myToDate) {
        const end = new Date(`${myToDate}T23:59:59.999`);
        if (new Date(shift.clock_in_at) > end) return false;
      }
      return true;
    });
  }, [recentShifts, myReviewStateFilter, myFromDate, myToDate]);

  const safeMyShiftPage = clampPage(
    myShiftPage,
    filteredRecentShifts.length,
    myShiftPageSize,
  );
  const pagedRecentShifts = React.useMemo(() => {
    return filteredRecentShifts.slice(
      safeMyShiftPage * myShiftPageSize,
      (safeMyShiftPage + 1) * myShiftPageSize,
    );
  }, [filteredRecentShifts, safeMyShiftPage, myShiftPageSize]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [justClockedOut, setJustClockedOut] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    variant?: ToastVariant;
  } | null>(null);
  const [clockActionDialog, setClockActionDialog] = useState<
    | { type: 'confirm_clock_out' }
    | { type: 'review_approve'; shift: ShiftData; reason: string }
    | { type: 'review_reject'; shift: ShiftData; reason: string }
    | {
        type: 'correction_reject';
        crId: string;
        shift: ShiftData;
        reason: string;
      }
    | {
        type: 'correction_accept';
        crId: string;
        shift: ShiftData;
        time: string;
        reason: string;
      }
    | null
  >(null);
  const [dialogLoading, setDialogLoading] = useState(false);

  // Correction Request Modal State (Staff)
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [targetShiftForCorrection, setTargetShiftForCorrection] =
    useState<ShiftData | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [claimedClockOut, setClaimedClockOut] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');

  // Owner Review & History State
  const [ownerShifts, setOwnerShifts] = useState<ShiftData[]>([]);
  const [shiftPage, setShiftPage] = useState<number>(0);
  const [shiftPageSize, setShiftPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [employees, setEmployees] = useState<EmployeeData[]>([]);
  const [employeesError, setEmployeesError] = useState<string | null>(null);
  const [employeesLoading, setEmployeesLoading] = useState<boolean>(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedToDate, setSelectedToDate] = useState<string>('');
  const [selectedReviewState, setSelectedReviewState] = useState<string>(
    mode === 'review' ? 'pending_all' : 'all',
  );
  const [selectedRunState, setSelectedRunState] = useState<string>('all');
  const [ownerLoading, setOwnerLoading] = useState(false);

  // Q65-05: Multi-page employee selector generation and abort management
  const employeesFetchIdRef = useRef<number>(0);
  const employeesAbortControllerRef = useRef<AbortController | null>(null);

  // 1. Fetch CSRF token and initial data
  const initData = async (signal?: AbortSignal) => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const authInit: RequestInit = { credentials: 'include' };
      if (signal) authInit.signal = signal;
      const authRes = await fetch('/api/v1/auth/me', authInit);
      if (authRes.ok) {
        const authData = await authRes.json();
        if (signal?.aborted) return;
        if (authData.data?.csrf_token) {
          setCsrfToken(authData.data.csrf_token);
        }
      }

      await fetchMyAttendance(signal);

      if (role === 'owner') {
        await fetchOwnerEmployees(signal);
        await fetchOwnerShifts(signal);
      }
    } catch {
      setErrorMessage('Không thể kết nối đến máy chủ.');
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  };

  const fetchMyAttendance = async (signal?: AbortSignal) => {
    try {
      const attInit: RequestInit = { credentials: 'include' };
      if (signal) attInit.signal = signal;
      const res = await fetch('/api/v1/attendance/me', attInit);
      if (!res.ok) {
        throw new Error('Lỗi khi tải dữ liệu chấm công.');
      }
      const data: { success: boolean; data: AttendanceMeResponseData } =
        await res.json();
      if (signal?.aborted) return;
      if (data.success && data.data) {
        setCurrentShift(data.data.current_shift);
        setRecentShifts(data.data.recent_shifts || []);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi tải dữ liệu cá nhân',
      );
    }
  };

  const fetchOwnerEmployees = async (externalSignal?: AbortSignal) => {
    if (employeesAbortControllerRef.current) {
      employeesAbortControllerRef.current.abort();
    }
    const controller = new AbortController();
    employeesAbortControllerRef.current = controller;
    const requestId = ++employeesFetchIdRef.current;

    const isAborted = () =>
      controller.signal.aborted ||
      Boolean(externalSignal?.aborted) ||
      requestId !== employeesFetchIdRef.current;

    setEmployeesLoading(true);
    setEmployeesError(null);
    try {
      const all: EmployeeData[] = [];
      const seenIds = new Set<string>();
      const seenCursors = new Set<string>();
      let cursor: string | null = null;
      let page = 0;
      const maxPages = 20;

      while (page < maxPages) {
        if (isAborted()) return;
        page++;
        const url: string = cursor
          ? `/api/v1/employees?limit=50&cursor=${encodeURIComponent(cursor)}`
          : '/api/v1/employees?limit=50';
        const res = await fetch(url, {
          credentials: 'include',
          signal: controller.signal,
        });
        if (isAborted()) return;
        if (!res.ok) {
          throw new Error(
            `Lỗi tải danh sách nhân viên (HTTP ${res.status}). Danh sách có thể chưa đầy đủ.`,
          );
        }
        const data = await res.json();
        if (isAborted()) return;
        const items: EmployeeData[] = data.data?.items || [];
        for (const item of items) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            all.push(item);
          }
        }
        const nextCursor = data.data?.next_cursor || null;
        if (nextCursor) {
          if (seenCursors.has(nextCursor)) {
            throw new Error(
              'Phát hiện vòng lặp phân trang cursor từ máy chủ. Danh sách có thể chưa đầy đủ.',
            );
          }
          seenCursors.add(nextCursor);
        }
        cursor = nextCursor;
        if (!cursor || items.length === 0) break;
      }

      if (isAborted()) return;

      if (cursor && page >= maxPages) {
        setEmployees(all);
        setEmployeesError(
          `Đã tải tối đa ${maxPages} trang (${all.length} nhân viên). Danh sách có thể chưa đầy đủ.`,
        );
        return;
      }

      setEmployees(all);
      setEmployeesError(null);
    } catch (err: unknown) {
      if (isAborted()) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      setEmployeesError(
        err instanceof Error ? err.message : 'Lỗi tải danh sách nhân viên',
      );
    } finally {
      if (!isAborted()) {
        setEmployeesLoading(false);
      }
    }
  };

  const fetchOwnerShifts = async (signal?: AbortSignal) => {
    setOwnerLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedEmployeeId !== 'all') {
        params.append('employee_id', selectedEmployeeId);
      }
      if (selectedDate) {
        const start = new Date(`${selectedDate}T00:00:00`);
        params.append('from_date', start.toISOString());
      }
      if (selectedToDate) {
        const end = new Date(`${selectedToDate}T23:59:59.999`);
        params.append('to_date', end.toISOString());
      } else if (selectedDate) {
        const end = new Date(`${selectedDate}T23:59:59.999`);
        params.append('to_date', end.toISOString());
      }
      if (
        selectedReviewState !== 'all' &&
        selectedReviewState !== 'pending_all'
      ) {
        params.append('review_state', selectedReviewState);
      }
      if (selectedRunState !== 'all') {
        params.append('run_state', selectedRunState);
      }
      const url = `/api/v1/attendance/shifts?${params.toString()}`;
      const shiftInit: RequestInit = { credentials: 'include' };
      if (signal) shiftInit.signal = signal;
      const res = await fetch(url, shiftInit);
      if (res.ok) {
        const data = await res.json();
        if (signal?.aborted) return;
        setOwnerShifts(data.data?.shifts || []);
      }
    } catch {
      setErrorMessage('Không thể tải danh sách ca làm việc nhân viên.');
    } finally {
      if (!signal?.aborted) {
        setOwnerLoading(false);
      }
    }
  };

  const formatIsoToVnLabel = (iso: string): string => {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
      return 'Ngày / Tháng / Năm';
    }
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };

  const applyQuickDateRange = (
    preset: 'today' | 'last7d' | 'month' | 'all',
    target: 'owner' | 'my',
  ) => {
    const now = new Date();
    const toIso = (dt: Date) =>
      dt.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    const todayIso = toIso(now);

    if (preset === 'all') {
      if (target === 'owner') {
        setSelectedDate('');
        setSelectedToDate('');
      } else {
        setMyFromDate('');
        setMyToDate('');
        setMyShiftPage(0);
      }
      return;
    }

    if (preset === 'today') {
      if (target === 'owner') {
        setSelectedDate(todayIso);
        setSelectedToDate(todayIso);
      } else {
        setMyFromDate(todayIso);
        setMyToDate(todayIso);
        setMyShiftPage(0);
      }
      return;
    }

    if (preset === 'last7d') {
      const d7 = new Date(now.getTime() - 6 * 24 * 3600 * 1000);
      const fromIso = toIso(d7);
      if (target === 'owner') {
        setSelectedDate(fromIso);
        setSelectedToDate(todayIso);
      } else {
        setMyFromDate(fromIso);
        setMyToDate(todayIso);
        setMyShiftPage(0);
      }
      return;
    }

    const [y, m] = todayIso.split('-');
    const monthStart = `${y}-${m}-01`;
    if (target === 'owner') {
      setSelectedDate(monthStart);
      setSelectedToDate(todayIso);
    } else {
      setMyFromDate(monthStart);
      setMyToDate(todayIso);
      setMyShiftPage(0);
    }
  };

  const isActionableUnreviewed = (shift: ShiftData) =>
    shift.run_state === 'completed' &&
    shift.review_state === 'unreviewed' &&
    !shift.is_self_shift &&
    shift.is_payroll_eligible !== false;

  const isActionablePending = (shift: ShiftData) =>
    isActionableUnreviewed(shift) ||
    shift.review_state === 'needs_review' ||
    Boolean(shift.pending_correction) ||
    shift.run_state !== 'completed';

  const filteredOwnerShifts = React.useMemo(() => {
    return ownerShifts.filter((shift) => {
      if (selectedReviewState === 'pending_all') {
        return isActionablePending(shift);
      }
      if (selectedReviewState === 'unreviewed') {
        return isActionableUnreviewed(shift);
      }
      if (
        selectedReviewState !== 'all' &&
        shift.review_state !== selectedReviewState
      ) {
        return false;
      }
      if (selectedRunState !== 'all' && shift.run_state !== selectedRunState) {
        return false;
      }
      return true;
    });
  }, [ownerShifts, selectedReviewState, selectedRunState]);

  useEffect(() => {
    if (mode === 'review') {
      setActiveTab('owner_review');
      setSelectedReviewState('pending_all');
    } else if (mode === 'history') {
      setActiveTab(role === 'owner' ? 'owner_review' : 'my_clock');
      setSelectedReviewState('all');
    } else {
      setActiveTab('my_clock');
    }
  }, [mode, role]);

  useEffect(() => {
    const controller = new AbortController();
    initData(controller.signal);
    return () => {
      controller.abort();
      employeesAbortControllerRef.current?.abort();
    };
  }, [role]);

  useEffect(() => {
    if (activeTab === 'owner_review' && role === 'owner') {
      setShiftPage(0);
      fetchOwnerShifts();
    }
  }, [
    selectedEmployeeId,
    selectedDate,
    selectedToDate,
    selectedReviewState,
    selectedRunState,
    activeTab,
  ]);

  const formatHoursMinutes = (totalSecs: number) => {
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    if (hrs === 0 && mins === 0) return `${totalSecs} giây`;
    if (hrs === 0) return `${mins} phút`;
    return `${hrs}h ${mins}m`;
  };

  const formatVnTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatVnDate = (
    isoString: string,
    options?: Intl.DateTimeFormatOptions,
  ) => {
    return new Date(isoString).toLocaleDateString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      ...options,
    });
  };

  const isOvernightShift = (inIso: string, outIso: string | null): boolean => {
    if (!outIso) return false;
    const inDay = new Date(inIso).toLocaleDateString('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    const outDay = new Date(outIso).toLocaleDateString('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    return inDay !== outDay;
  };

  // 3. API Actions
  const handleClockIn = async () => {
    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await fetch('/api/v1/attendance/shifts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({}),
      });

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || 'Không thể bắt đầu ca làm.');
      }

      setSuccessMessage('Vào ca thành công!');
      await fetchMyAttendance();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Thao tác thất bại');
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartBreak = async () => {
    if (!currentShift) return;
    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(
        `/api/v1/attendance/shifts/${currentShift.id}/breaks`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'include',
          body: JSON.stringify({}),
        },
      );

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || 'Không thể bắt đầu tạm nghỉ.');
      }

      setSuccessMessage('Bắt đầu tạm nghỉ (nghỉ không tính công theo PAY-02).');
      await fetchMyAttendance();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Thao tác thất bại');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResume = async () => {
    if (!currentShift) return;
    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(
        `/api/v1/attendance/shifts/${currentShift.id}/resume`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'include',
          body: JSON.stringify({}),
        },
      );

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || 'Không thể tiếp tục làm việc.');
      }

      setSuccessMessage('Đã kết thúc nghỉ, tiếp tục ca làm việc!');
      await fetchMyAttendance();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Thao tác thất bại');
    } finally {
      setActionLoading(false);
    }
  };

  const handleClockOut = () => {
    if (!currentShift) return;
    setClockActionDialog({ type: 'confirm_clock_out' });
  };

  const executeClockOut = async () => {
    if (!currentShift) return;
    setDialogLoading(true);
    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(
        `/api/v1/attendance/shifts/${currentShift.id}/clock-out`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'include',
          body: JSON.stringify({}),
        },
      );

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || 'Không thể kết thúc ca làm.');
      }

      const msg =
        'Kết thúc ca thành công! Ca làm đã được chuyển đến Owner để duyệt.';
      setJustClockedOut(true);
      setSuccessMessage(msg);
      setToast({ message: msg, variant: 'success' });
      setClockActionDialog(null);
      await fetchMyAttendance();
      if (role === 'owner') fetchOwnerShifts();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Thao tác thất bại';
      setErrorMessage(msg);
      setToast({ message: msg, variant: 'error' });
    } finally {
      setDialogLoading(false);
      setActionLoading(false);
    }
  };

  // Submit Correction Request (Staff)
  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetShiftForCorrection || !correctionReason.trim()) {
      const msg = 'Vui lòng nhập lý do giải trình';
      setErrorMessage(msg);
      setToast({ message: msg, variant: 'warning' });
      return;
    }

    setActionLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/v1/attendance/shifts/${targetShiftForCorrection.id}/correction-requests`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'include',
          body: JSON.stringify({
            reason: correctionReason.trim(),
            claimed_clock_out_at: claimedClockOut
              ? new Date(claimedClockOut).toISOString()
              : undefined,
            evidence_note: evidenceNote.trim() || undefined,
          }),
        },
      );

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || 'Không thể gửi đơn giải trình.');
      }

      const msg = 'Đã gửi đơn giải trình thành công (C01)!';
      setSuccessMessage(msg);
      setToast({ message: msg, variant: 'success' });
      setShowCorrectionModal(false);
      setCorrectionReason('');
      setClaimedClockOut('');
      setEvidenceNote('');
      await fetchMyAttendance();
      if (role === 'owner') fetchOwnerShifts();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Thao tác thất bại';
      setErrorMessage(msg);
      setToast({ message: msg, variant: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  // Owner Review Shift (Approve / Reject)
  const handleReviewShift = (
    shift: ShiftData,
    decision: 'approved' | 'rejected',
  ) => {
    if (decision === 'rejected') {
      setClockActionDialog({
        type: 'review_reject',
        shift,
        reason: 'Giờ làm việc không khớp thực tế',
      });
    } else {
      setClockActionDialog({
        type: 'review_approve',
        shift,
        reason: 'Xác nhận ca làm việc hợp lệ',
      });
    }
  };

  const executeReviewShift = async (
    shift: ShiftData,
    decision: 'approved' | 'rejected',
    reason?: string,
  ) => {
    if (decision === 'rejected' && (!reason || !reason.trim())) {
      const msg = 'Vui lòng nhập lý do từ chối ca làm việc.';
      setErrorMessage(msg);
      setToast({ message: msg, variant: 'warning' });
      return;
    }
    setDialogLoading(true);
    setOwnerLoading(true);
    try {
      const res = await fetch(`/api/v1/attendance/shifts/${shift.id}/reviews`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({
          decision,
          reason: reason?.trim(),
        }),
      });

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || 'Không thể duyệt ca làm việc.');
      }

      const msg =
        decision === 'approved'
          ? `Đã duyệt ca làm của ${shift.employee_name || shift.employee_code}!`
          : `Đã từ chối ca làm của ${shift.employee_name || shift.employee_code}.`;
      setSuccessMessage(msg);
      setToast({ message: msg, variant: 'success' });
      setClockActionDialog(null);
      await fetchOwnerShifts();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Thao tác thất bại';
      setToast({ message: msg, variant: 'error' });
      setClockActionDialog(null);
    } finally {
      setDialogLoading(false);
      setOwnerLoading(false);
    }
  };

  const handleOwnerCloseShift = async (shift: ShiftData) => {
    setOwnerLoading(true);
    try {
      const res = await fetch(
        `/api/v1/attendance/shifts/${shift.id}/owner-close`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'include',
          body: JSON.stringify({
            reason: 'Chủ sở hữu đóng ca & xác nhận giúp nhân viên',
          }),
        },
      );
      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || 'Không thể đóng ca làm việc.');
      }
      const msg = `Đã đóng và xác nhận ca làm của ${shift.employee_name || shift.employee_code}!`;
      setSuccessMessage(msg);
      setToast({ message: msg, variant: 'success' });
      await fetchOwnerShifts();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Không thể đóng ca';
      setToast({ message: msg, variant: 'error' });
    } finally {
      setOwnerLoading(false);
    }
  };

  // Owner Decide on Correction Request
  const handleDecideCorrection = (
    crId: string,
    decision: 'accept' | 'reject',
    shift: ShiftData,
  ) => {
    if (decision === 'reject') {
      setClockActionDialog({
        type: 'correction_reject',
        crId,
        shift,
        reason: 'Không đủ bằng chứng xác thực',
      });
    } else {
      const defaultDate = shift.pending_correction?.claimed_clock_out_at
        ? new Date(shift.pending_correction.claimed_clock_out_at)
            .toISOString()
            .slice(0, 16)
        : new Date().toISOString().slice(0, 16);

      setClockActionDialog({
        type: 'correction_accept',
        crId,
        shift,
        time: defaultDate,
        reason: 'Đã đối chiếu với quản lý cửa hàng',
      });
    }
  };

  const executeDecideCorrection = async (
    crId: string,
    decision: 'accept' | 'reject',
    reason: string,
    clockOutAt?: string,
  ) => {
    setDialogLoading(true);
    setOwnerLoading(true);
    try {
      const res = await fetch(
        `/api/v1/attendance/correction-requests/${crId}/decide`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'include',
          body: JSON.stringify({
            decision,
            reason: reason.trim(),
            clock_out_at: clockOutAt,
          }),
        },
      );

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(
          body.error?.message || 'Không thể xử lý yêu cầu điều chỉnh.',
        );
      }

      const msg =
        decision === 'accept'
          ? 'Đã chấp nhận điều chỉnh ca làm việc thành công!'
          : 'Đã từ chối đơn giải trình.';
      setSuccessMessage(msg);
      setToast({ message: msg, variant: 'success' });
      setClockActionDialog(null);
      await fetchOwnerShifts();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Thao tác thất bại';
      setToast({ message: msg, variant: 'error' });
      setClockActionDialog(null);
    } finally {
      setDialogLoading(false);
      setOwnerLoading(false);
    }
  };

  if (loading) {
    return <LoadingState message="Đang nạp dữ liệu chấm công..." />;
  }

  const headerTitle =
    mode === 'review'
      ? 'Duyệt công nhân viên'
      : mode === 'history'
        ? 'Lịch sử ca làm'
        : 'Quản lý Chấm công (ATT)';

  const headerSubtitle =
    mode === 'review'
      ? 'Kiểm duyệt danh sách ca làm chờ xử lý, phê duyệt hoặc từ chối có lý do và đối chiếu giải trình (Doc 20/36)'
      : mode === 'history'
        ? 'Tra cứu lịch sử chấm công theo nhân viên, khoảng thời gian, giờ vào/ra, tổng giờ công và trạng thái duyệt'
        : 'Hệ thống chấm công thời gian thực, tạm nghỉ và duyệt công chuẩn xác (Doc 20/36)';

  return (
    <div>
      <PageHeader
        title={headerTitle}
        subtitle={headerSubtitle}
        badge={
          <StatusBadge
            status={
              currentShift?.run_state === 'working'
                ? 'success'
                : currentShift?.run_state === 'paused'
                  ? 'warning'
                  : 'neutral'
            }
            label={
              currentShift?.run_state === 'working'
                ? 'Đang trong ca làm'
                : currentShift?.run_state === 'paused'
                  ? 'Đang tạm nghỉ'
                  : 'Sẵn sàng vào ca'
            }
          />
        }
      />

      {/* Tab Switcher for Owner */}
      {role === 'owner' && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            marginBottom: '20px',
            borderBottom: '1px solid var(--border-color)',
            paddingBottom: '8px',
          }}
        >
          <AppButton
            variant={activeTab === 'my_clock' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('my_clock')}
          >
            <ClockIcon size={16} /> Chấm công cá nhân
          </AppButton>
          <AppButton
            variant={activeTab === 'owner_review' ? 'primary' : 'secondary'}
            onClick={() => setActiveTab('owner_review')}
          >
            <UserIcon size={16} />{' '}
            {mode === 'history'
              ? 'Lịch sử & Duyệt công nhân viên'
              : 'Duyệt công nhân viên'}
          </AppButton>
          {onNavigate && mode !== 'clock' && (
            <AppButton variant="secondary" onClick={() => onNavigate('/clock')}>
              Mở Bấm giờ trực tiếp
            </AppButton>
          )}
        </div>
      )}

      {/* Notifications */}
      {errorMessage && (
        <div style={{ marginBottom: '16px' }}>
          <ErrorState message={errorMessage} onRetry={initData} />
        </div>
      )}
      {successMessage && (
        <div
          style={{
            marginBottom: '16px',
            padding: '12px 16px',
            borderRadius: '8px',
            backgroundColor: '#064E3B',
            color: 'var(--success-text)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '14px',
            fontWeight: 500,
          }}
        >
          <CheckIcon size={18} />
          {successMessage}
        </div>
      )}

      {activeTab === 'my_clock' ? (
        <div>
          {/* Main Clock-in/out Card */}
          {justClockedOut && onNavigate && (
            <div
              data-testid="post-clockout-report-prompt"
              style={{
                marginBottom: '16px',
                padding: '14px 16px',
                borderRadius: '10px',
                backgroundColor: 'rgba(59, 130, 246, 0.12)',
                border: '1px solid rgba(59, 130, 246, 0.35)',
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
              }}
            >
              <div>
                <div style={{ fontSize: '14px', fontWeight: 700, color: '#93C5FD' }}>
                  📝 Bạn vừa kết thúc ca làm việc — Đừng quên nộp báo cáo ngày!
                </div>
                <div style={{ fontSize: '12px', color: 'var(--muted-color)', marginTop: '2px' }}>
                  Ghi nhận ngay tiến độ và kết quả công việc trong ca hôm nay để Owner đối chiếu.
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <AppButton
                  variant="primary"
                  data-testid="btn-post-clockout-create-report"
                  onClick={() => onNavigate('/reports/new')}
                >
                  Nộp báo cáo công việc hôm nay →
                </AppButton>
                <AppButton
                  variant="secondary"
                  onClick={() => setJustClockedOut(false)}
                >
                  Để sau
                </AppButton>
              </div>
            </div>
          )}
          <AppCard style={{ marginBottom: '24px' }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                padding: '16px 8px',
              }}
            >
              <div
                style={{
                  marginBottom: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <StatusBadge
                  status={
                    currentShift?.run_state === 'working'
                      ? 'success'
                      : currentShift?.run_state === 'paused'
                        ? 'warning'
                        : 'neutral'
                  }
                  label={
                    currentShift?.run_state === 'working'
                      ? 'Đang trong ca làm việc'
                      : currentShift?.run_state === 'paused'
                        ? 'Đang tạm nghỉ'
                        : 'Chưa vào ca làm việc'
                  }
                />
              </div>

              {currentShift && (
                <div
                  style={{
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                    marginBottom: '20px',
                    backgroundColor: 'var(--surface-hover)',
                    padding: '6px 14px',
                    borderRadius: '20px',
                  }}
                >
                  Bắt đầu ca: {formatVnTime(currentShift.clock_in_at)} ngày{' '}
                  {formatVnDate(currentShift.clock_in_at)}
                  {currentShift.breaks.length > 0 &&
                    ` • ${currentShift.breaks.length} lần tạm nghỉ`}
                </div>
              )}

              {/* Action Buttons */}
              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  width: '100%',
                  maxWidth: '440px',
                }}
              >
                {!currentShift && (
                  <AppButton
                    variant="primary"
                    disabled={actionLoading}
                    onClick={handleClockIn}
                    style={{
                      flex: 1,
                      minWidth: '180px',
                      height: '48px',
                      fontSize: '16px',
                    }}
                  >
                    <PlayIcon size={20} /> Vào ca làm việc
                  </AppButton>
                )}

                {currentShift?.run_state === 'working' && (
                  <>
                    <AppButton
                      variant="secondary"
                      disabled={actionLoading}
                      onClick={handleStartBreak}
                      style={{ flex: 1, minWidth: '140px' }}
                    >
                      <PauseIcon size={18} /> Tạm nghỉ
                    </AppButton>
                    <AppButton
                      variant="destructive"
                      disabled={actionLoading}
                      onClick={handleClockOut}
                      style={{ flex: 1, minWidth: '140px' }}
                    >
                      <StopIcon size={18} /> Kết thúc ca
                    </AppButton>
                  </>
                )}

                {currentShift?.run_state === 'paused' && (
                  <AppButton
                    variant="primary"
                    disabled={actionLoading}
                    onClick={handleResume}
                    style={{
                      flex: 1,
                      minWidth: '220px',
                      height: '48px',
                      fontSize: '16px',
                    }}
                  >
                    <PlayIcon size={20} /> Tiếp tục làm việc
                  </AppButton>
                )}
              </div>

              {/* Forgotten Clock Out / Correction link */}
              {currentShift && (
                <div style={{ marginTop: '16px' }}>
                  <button
                    type="button"
                    data-testid="clock-correction-btn"
                    onClick={() => {
                      setTargetShiftForCorrection(currentShift);
                      setShowCorrectionModal(true);
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--accent-text)',
                      fontSize: '13px',
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      padding: '4px',
                    }}
                  >
                    Quên bấm giờ hoặc cần giải trình ca này?
                  </button>
                </div>
              )}
            </div>
          </AppCard>

          {/* Personal History */}
          <div style={{ marginTop: '32px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '8px',
                marginBottom: '16px',
              }}
            >
              <h3
                style={{
                  fontSize: '18px',
                  fontWeight: 700,
                  color: 'var(--text-color)',
                  margin: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <CalendarIcon size={20} /> Lịch sử chấm công cá nhân
              </h3>
              {recentShifts.length > 0 && (
                <AppButton
                  variant="secondary"
                  data-testid="btn-export-attendance-csv"
                  onClick={() => {
                    const headers = [
                      'Mã ca',
                      'Vào ca',
                      'Ra ca',
                      'Trạng thái',
                      'Tổng phút',
                    ];
                    const rows = recentShifts.map((s) => [
                      s.id,
                      s.clock_in_at,
                      s.clock_out_at || '',
                      s.review_state || s.run_state,
                      String(Math.round((s.worked_seconds ?? 0) / 60)),
                    ]);
                    const csv =
                      '\uFEFF' +
                      [headers, ...rows]
                        .map((r) =>
                          r
                            .map((c) => `"${String(c).replace(/"/g, '""')}"`)
                            .join(','),
                        )
                        .join('\n');
                    const blob = new Blob([csv], {
                      type: 'text/csv;charset=utf-8;',
                    });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `attendance-${new Date().toISOString().slice(0, 10)}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  📥 Xuất Excel/CSV ({recentShifts.length})
                </AppButton>
              )}
            </div>

            {/* Personal History Filter Bar */}
            <AppCard
              data-testid="my-history-filter-bar"
              style={{ marginBottom: '16px', padding: '14px' }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  marginBottom: '10px',
                }}
              >
                <span style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                  Chọn nhanh:
                </span>
                {[
                  { id: 'today' as const, label: '📅 Hôm nay' },
                  { id: 'last7d' as const, label: '📆 7 ngày qua' },
                  { id: 'month' as const, label: '🗓️ Tháng này' },
                  { id: 'all' as const, label: '🔄 Toàn thời gian' },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => applyQuickDateRange(p.id, 'my')}
                    style={{
                      padding: '4px 10px',
                      borderRadius: '999px',
                      border: '1px solid var(--border-color)',
                      backgroundColor: 'var(--bg-color)',
                      color: 'var(--text-secondary)',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  flexWrap: 'wrap',
                  alignItems: 'flex-end',
                }}
              >
                <div style={{ flex: 1, minWidth: '160px' }}>
                  <label
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    <span>Từ ngày (Ngày/Tháng/Năm)</span>
                    <span style={{ color: 'var(--accent-text)', fontWeight: 500 }}>
                      {formatIsoToVnLabel(myFromDate)}
                    </span>
                  </label>
                  <input
                    data-testid="my-filter-from-date"
                    type="date"
                    value={myFromDate}
                    onClick={(e) =>
                      (
                        e.currentTarget as HTMLInputElement & {
                          showPicker?: () => void;
                        }
                      ).showPicker?.()
                    }
                    onChange={(e) => {
                      setMyFromDate(e.target.value);
                      setMyShiftPage(0);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-color)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-color)',
                      fontSize: '14px',
                      minHeight: '44px',
                      boxSizing: 'border-box',
                      cursor: 'pointer',
                    }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: '160px' }}>
                  <label
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    <span>Đến ngày (Ngày/Tháng/Năm)</span>
                    <span style={{ color: 'var(--accent-text)', fontWeight: 500 }}>
                      {formatIsoToVnLabel(myToDate)}
                    </span>
                  </label>
                  <input
                    data-testid="my-filter-to-date"
                    type="date"
                    value={myToDate}
                    onClick={(e) =>
                      (
                        e.currentTarget as HTMLInputElement & {
                          showPicker?: () => void;
                        }
                      ).showPicker?.()
                    }
                    onChange={(e) => {
                      setMyToDate(e.target.value);
                      setMyShiftPage(0);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-color)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-color)',
                      fontSize: '14px',
                      minHeight: '44px',
                      boxSizing: 'border-box',
                      cursor: 'pointer',
                    }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: '170px' }}>
                  <label
                    style={{
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--muted-color)',
                      marginBottom: '6px',
                    }}
                  >
                    Trạng thái duyệt
                  </label>
                  <select
                    data-testid="my-filter-review-state"
                    value={myReviewStateFilter}
                    onChange={(e) => {
                      setMyReviewStateFilter(e.target.value);
                      setMyShiftPage(0);
                    }}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '8px',
                      backgroundColor: 'var(--bg-color)',
                      border: '1px solid var(--border-color)',
                      color: 'var(--text-color)',
                      fontSize: '14px',
                      minHeight: '44px',
                      boxSizing: 'border-box',
                    }}
                  >
                    <option value="all">Tất cả trạng thái</option>
                    <option value="unreviewed">Chờ duyệt</option>
                    <option value="needs_review">Cần xử lý / Giải trình</option>
                    <option value="approved">Đã duyệt</option>
                    <option value="rejected">Bị từ chối</option>
                  </select>
                </div>
                {(myFromDate || myToDate || myReviewStateFilter !== 'all') && (
                  <AppButton
                    variant="secondary"
                    onClick={() => {
                      setMyFromDate('');
                      setMyToDate('');
                      setMyReviewStateFilter('all');
                      setMyShiftPage(0);
                    }}
                    style={{ minHeight: '44px' }}
                  >
                    Xóa lọc
                  </AppButton>
                )}
              </div>
            </AppCard>

            {filteredRecentShifts.length === 0 ? (
              <EmptyState
                title="Chưa có dữ liệu"
                description="Không có ca làm việc nào phù hợp với bộ lọc hiện tại."
              />
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                {pagedRecentShifts.map((shift) => (
                  <AppCard key={shift.id} style={{ padding: '16px' }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        flexWrap: 'wrap',
                        gap: '8px',
                        marginBottom: '8px',
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: '15px',
                            color: 'var(--text-color)',
                          }}
                        >
                          {formatVnDate(shift.clock_in_at, {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'numeric',
                            day: 'numeric',
                          })}
                        </div>
                        <div
                          style={{
                            fontSize: '13px',
                            color: 'var(--muted-color)',
                            marginTop: '2px',
                          }}
                        >
                          Vào ca: {formatVnTime(shift.clock_in_at)}
                          {shift.clock_out_at &&
                            ` - Ra ca: ${formatVnTime(shift.clock_out_at)}`}
                          {isOvernightShift(
                            shift.clock_in_at,
                            shift.clock_out_at,
                          ) && (
                            <span
                              data-testid="overnight-badge"
                              style={{
                                marginLeft: '8px',
                                fontSize: '11px',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                backgroundColor: 'rgba(139, 92, 246, 0.2)',
                                color: '#C4B5FD',
                                border: '1px solid rgba(139, 92, 246, 0.4)',
                                fontWeight: 500,
                              }}
                            >
                              Ca qua đêm (+1 ngày)
                            </span>
                          )}
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          gap: '6px',
                          alignItems: 'center',
                        }}
                      >
                        <StatusBadge
                          status={
                            shift.review_state === 'approved'
                              ? 'success'
                              : shift.review_state === 'rejected'
                                ? 'error'
                                : shift.review_state === 'needs_review'
                                  ? 'warning'
                                  : 'neutral'
                          }
                          label={
                            shift.review_state === 'approved'
                              ? 'Đã duyệt'
                              : shift.review_state === 'rejected'
                                ? 'Bị từ chối'
                                : shift.review_state === 'needs_review'
                                  ? 'Cần xử lý'
                                  : 'Chờ duyệt'
                          }
                        />

                        {shift.pending_correction && (
                          <StatusBadge
                            status="warning"
                            label="Đang chờ giải trình"
                          />
                        )}
                      </div>
                    </div>

                    {shift.review_reason && (
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--text-secondary)',
                          backgroundColor: 'var(--bg-color)',
                          padding: '8px 12px',
                          borderRadius: '6px',
                          marginTop: '8px',
                          borderLeft:
                            shift.review_state === 'rejected'
                              ? '3px solid #EF4444'
                              : '3px solid #10B981',
                        }}
                      >
                        Phản hồi duyệt: <em>"{shift.review_reason}"</em>
                        {shift.reviewed_at &&
                          ` • ${formatVnDate(shift.reviewed_at)} ${formatVnTime(shift.reviewed_at)}`}
                      </div>
                    )}

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '13px',
                        color: 'var(--muted-color)',
                        borderTop: '1px solid var(--border-color)',
                        paddingTop: '10px',
                        marginTop: '10px',
                      }}
                    >
                      <div>
                        Tổng làm việc:{' '}
                        <strong style={{ color: 'var(--accent-text)' }}>
                          {formatHoursMinutes(shift.worked_seconds)}
                        </strong>
                        {shift.breaks.length > 0 &&
                          ` (${shift.breaks.length} lần nghỉ)`}
                      </div>

                      {shift.run_state === 'completed' &&
                        !shift.pending_correction && (
                          <button
                            type="button"
                            data-testid="shift-correction-btn"
                            onClick={() => {
                              setTargetShiftForCorrection(shift);
                              setShowCorrectionModal(true);
                            }}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--accent-text)',
                              fontSize: '12px',
                              cursor: 'pointer',
                              textDecoration: 'underline',
                            }}
                          >
                            Giải trình / Sửa giờ
                          </button>
                        )}
                    </div>
                  </AppCard>
                ))}
              </div>
            )}
            {filteredRecentShifts.length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <Pagination
                  testId="my-shifts-pager"
                  total={filteredRecentShifts.length}
                  page={safeMyShiftPage}
                  pageSize={myShiftPageSize}
                  onPage={setMyShiftPage}
                  onPageSize={(size) => {
                    setMyShiftPageSize(size);
                    setMyShiftPage(0);
                  }}
                  pageSizes={PAGINATION_PAGE_SIZES}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Owner Review & History Tab */
        <div>
          {/* Quick Status Filter Pills */}
          <div
            data-testid="owner-review-quick-tabs"
            style={{
              display: 'flex',
              gap: '8px',
              flexWrap: 'wrap',
              marginBottom: '16px',
            }}
          >
            {[
              { id: 'all', label: `Tất cả (${ownerShifts.length})` },
              {
                id: 'pending_all',
                label: `Chờ xử lý (${ownerShifts.filter((s) => isActionablePending(s)).length})`,
              },
              {
                id: 'unreviewed',
                label: `Chờ duyệt (${ownerShifts.filter((s) => isActionableUnreviewed(s)).length})`,
              },
              {
                id: 'needs_review',
                label: `Giải trình (${ownerShifts.filter((s) => s.review_state === 'needs_review' || Boolean(s.pending_correction)).length})`,
              },
              {
                id: 'approved',
                label: `Đã duyệt (${ownerShifts.filter((s) => s.review_state === 'approved').length})`,
              },
              {
                id: 'rejected',
                label: `Đã từ chối (${ownerShifts.filter((s) => s.review_state === 'rejected').length})`,
              },
            ].map((pill) => (
              <button
                key={pill.id}
                type="button"
                data-testid={`review-tab-${pill.id}`}
                onClick={() => {
                  setSelectedReviewState(pill.id);
                  setShiftPage(0);
                }}
                style={{
                  padding: '8px 14px',
                  borderRadius: '20px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  minHeight: '38px',
                  border:
                    selectedReviewState === pill.id
                      ? '1px solid #14B8A6'
                      : '1px solid var(--border-color)',
                  backgroundColor:
                    selectedReviewState === pill.id
                      ? 'rgba(20, 184, 166, 0.16)'
                      : 'var(--surface-color)',
                  color:
                    selectedReviewState === pill.id ? 'var(--accent-text)' : 'var(--muted-color)',
                }}
              >
                {pill.label}
              </button>
            ))}
          </div>

          {/* Filter Bar */}
          <AppCard
            data-testid="owner-shifts-filter-bar"
            style={{ marginBottom: '20px', padding: '16px' }}
          >
            {employeesError && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  marginBottom: '12px',
                  backgroundColor: '#451A1A',
                  border: '1px solid #7F1D1D',
                  borderRadius: '6px',
                  color: 'var(--danger-text)',
                  fontSize: '12px',
                  gap: '8px',
                }}
              >
                <span>⚠️ {employeesError}</span>
                <button
                  type="button"
                  onClick={() => fetchOwnerEmployees()}
                  disabled={employeesLoading}
                  style={{
                    backgroundColor: '#DC2626',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    minHeight: '36px',
                    minWidth: '44px',
                  }}
                >
                  {employeesLoading ? 'Đang tải...' : 'Thử lại'}
                </button>
              </div>
            )}
            <div
              data-testid="quick-date-range-bar"
              style={{
                display: 'flex',
                gap: '6px',
                flexWrap: 'wrap',
                alignItems: 'center',
                marginBottom: '12px',
              }}
            >
              <span style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                Chọn nhanh khoảng ngày:
              </span>
              {[
                { id: 'today' as const, label: '📅 Hôm nay' },
                { id: 'last7d' as const, label: '📆 7 ngày qua' },
                { id: 'month' as const, label: '🗓️ Tháng này' },
                { id: 'all' as const, label: '🔄 Toàn thời gian' },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyQuickDateRange(p.id, 'owner')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: '999px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-color)',
                    color: 'var(--text-secondary)',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div
              style={{
                display: 'flex',
                gap: '12px',
                flexWrap: 'wrap',
                alignItems: 'flex-end',
              }}
            >
              <div style={{ flex: 1, minWidth: '170px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Nhân viên
                </label>
                <select
                  data-testid="filter-employee-select"
                  value={selectedEmployeeId}
                  onChange={(e) => setSelectedEmployeeId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-color)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                    minHeight: '44px',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="all">Tất cả nhân viên</option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name} ({emp.employee_code})
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ flex: 1, minWidth: '160px' }}>
                <label
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  <span>Từ ngày (Ngày/Tháng/Năm)</span>
                  <span style={{ color: 'var(--accent-text)', fontWeight: 500, fontSize: '12px' }}>
                    {formatIsoToVnLabel(selectedDate)}
                  </span>
                </label>
                <input
                  data-testid="filter-from-date"
                  type="date"
                  value={selectedDate}
                  onClick={(e) =>
                    (
                      e.currentTarget as HTMLInputElement & {
                        showPicker?: () => void;
                      }
                    ).showPicker?.()
                  }
                  onChange={(e) => setSelectedDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-color)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                    minHeight: '44px',
                    boxSizing: 'border-box',
                    cursor: 'pointer',
                  }}
                />
              </div>

              <div style={{ flex: 1, minWidth: '160px' }}>
                <label
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  <span>Đến ngày (Ngày/Tháng/Năm)</span>
                  <span style={{ color: 'var(--accent-text)', fontWeight: 500, fontSize: '12px' }}>
                    {formatIsoToVnLabel(selectedToDate)}
                  </span>
                </label>
                <input
                  data-testid="filter-to-date"
                  type="date"
                  value={selectedToDate}
                  onClick={(e) =>
                    (
                      e.currentTarget as HTMLInputElement & {
                        showPicker?: () => void;
                      }
                    ).showPicker?.()
                  }
                  onChange={(e) => setSelectedToDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-color)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                    minHeight: '44px',
                    boxSizing: 'border-box',
                    cursor: 'pointer',
                  }}
                />
              </div>

              <div style={{ flex: 1, minWidth: '160px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Trạng thái duyệt
                </label>
                <select
                  data-testid="filter-review-state"
                  value={selectedReviewState}
                  onChange={(e) => setSelectedReviewState(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-color)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                    minHeight: '44px',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="all">Tất cả trạng thái duyệt</option>
                  <option value="pending_all">Chờ xử lý (Tất cả)</option>
                  <option value="unreviewed">Chờ duyệt</option>
                  <option value="needs_review">Cần giải trình</option>
                  <option value="approved">Đã duyệt</option>
                  <option value="rejected">Đã từ chối</option>
                </select>
              </div>

              <div style={{ flex: 1, minWidth: '150px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: 'var(--muted-color)',
                    marginBottom: '6px',
                  }}
                >
                  Trạng thái ca
                </label>
                <select
                  data-testid="filter-run-state"
                  value={selectedRunState}
                  onChange={(e) => setSelectedRunState(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-color)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                    minHeight: '44px',
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="all">Tất cả ca</option>
                  <option value="completed">Đã đóng ca</option>
                  <option value="working">Đang trong ca</option>
                  <option value="paused">Đang tạm nghỉ</option>
                </select>
              </div>

              {(selectedEmployeeId !== 'all' ||
                selectedDate ||
                selectedToDate ||
                selectedReviewState !== 'all' ||
                selectedRunState !== 'all') && (
                <AppButton
                  variant="secondary"
                  onClick={() => {
                    setSelectedEmployeeId('all');
                    setSelectedDate('');
                    setSelectedToDate('');
                    setSelectedReviewState('all');
                    setSelectedRunState('all');
                  }}
                  style={{ minHeight: '44px' }}
                >
                  Đặt lại bộ lọc
                </AppButton>
              )}
            </div>
          </AppCard>

          {ownerLoading ? (
            <LoadingState message="Đang tải danh sách ca làm việc..." />
          ) : filteredOwnerShifts.length === 0 ? (
            <EmptyState
              title="Không tìm thấy ca làm"
              description="Không có ca làm việc nào phù hợp với bộ lọc."
            />
          ) : (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
            >
              {filteredOwnerShifts
                .slice(
                  shiftPage * shiftPageSize,
                  (shiftPage + 1) * shiftPageSize,
                )
                .map((shift) => (
                  <AppCard key={shift.id} style={{ padding: '18px' }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        flexWrap: 'wrap',
                        gap: '8px',
                        marginBottom: '12px',
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: '16px',
                            color: 'var(--text-color)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          {shift.employee_name}
                          <span
                            style={{
                              fontSize: '12px',
                              fontWeight: 400,
                              color: 'var(--muted-color)',
                              backgroundColor: 'var(--surface-hover)',
                              padding: '2px 8px',
                              borderRadius: '4px',
                            }}
                          >
                            {shift.employee_code}
                          </span>
                        </div>
                        <div
                          style={{
                            fontSize: '13px',
                            color: 'var(--muted-color)',
                            marginTop: '4px',
                          }}
                        >
                          {formatVnDate(shift.clock_in_at)} •{' '}
                          {formatVnTime(shift.clock_in_at)}
                          {shift.clock_out_at &&
                            ` đến ${formatVnTime(shift.clock_out_at)}`}
                          {isOvernightShift(
                            shift.clock_in_at,
                            shift.clock_out_at,
                          ) && (
                            <span
                              data-testid="owner-overnight-badge"
                              style={{
                                marginLeft: '8px',
                                fontSize: '11px',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                backgroundColor: 'rgba(139, 92, 246, 0.2)',
                                color: '#C4B5FD',
                                border: '1px solid rgba(139, 92, 246, 0.4)',
                                fontWeight: 500,
                              }}
                            >
                              Ca qua đêm (+1 ngày)
                            </span>
                          )}
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          gap: '6px',
                          alignItems: 'center',
                        }}
                      >
                        {shift.is_self_shift ||
                        shift.is_payroll_eligible === false ? (
                          <StatusBadge
                            status="success"
                            label="Ca Chủ sở hữu (Tự ghi nhận)"
                          />
                        ) : shift.run_state !== 'completed' &&
                          shift.review_state === 'unreviewed' &&
                          !shift.pending_correction ? (
                          shift.worked_seconds > 12 * 3600 ? (
                            <StatusBadge
                              status="warning"
                              label="Quá hạn chưa đóng ca"
                            />
                          ) : null
                        ) : (
                          <StatusBadge
                            status={
                              shift.review_state === 'approved'
                                ? 'success'
                                : shift.review_state === 'rejected'
                                  ? 'error'
                                  : shift.review_state === 'needs_review'
                                    ? 'warning'
                                    : 'neutral'
                            }
                            label={
                              shift.review_state === 'approved'
                                ? 'Đã duyệt'
                                : shift.review_state === 'rejected'
                                  ? 'Đã từ chối'
                                  : shift.review_state === 'needs_review'
                                    ? 'Cần giải trình'
                                    : 'Chờ duyệt'
                            }
                          />
                        )}

                        <StatusBadge
                          status={
                            shift.run_state === 'working'
                              ? 'success'
                              : shift.run_state === 'paused'
                                ? 'warning'
                                : 'neutral'
                          }
                          label={
                            shift.run_state === 'working'
                              ? 'Đang làm'
                              : shift.run_state === 'paused'
                                ? 'Đang nghỉ'
                                : 'Đã đóng ca'
                          }
                        />
                      </div>
                    </div>

                    <div
                      style={{
                        fontSize: '13px',
                        color: 'var(--text-secondary)',
                        backgroundColor: 'var(--bg-color)',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        marginBottom: '12px',
                      }}
                    >
                      Thời gian làm việc tính công:{' '}
                      <strong style={{ color: 'var(--accent-text)' }}>
                        {formatHoursMinutes(shift.worked_seconds)}
                      </strong>
                      {shift.breaks.length > 0 &&
                        ` (${shift.breaks.length} lần tạm nghỉ không tính công)`}
                    </div>

                    {shift.review_reason && (
                      <div
                        data-testid="shift-review-reason"
                        style={{
                          fontSize: '13px',
                          color: 'var(--text-secondary)',
                          backgroundColor: 'var(--bg-color)',
                          padding: '10px 14px',
                          borderRadius: '8px',
                          marginBottom: '12px',
                          borderLeft:
                            shift.review_state === 'rejected'
                              ? '4px solid #EF4444'
                              : '4px solid #10B981',
                        }}
                      >
                        <div>
                          Ghi chú duyệt: <em>"{shift.review_reason}"</em>
                        </div>
                        {shift.reviewed_at && (
                          <div
                            style={{
                              fontSize: '12px',
                              color: 'var(--muted-color)',
                              marginTop: '4px',
                            }}
                          >
                            Thời điểm duyệt: {formatVnDate(shift.reviewed_at)}{' '}
                            {formatVnTime(shift.reviewed_at)}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Pending Correction Details */}
                    {shift.pending_correction && (
                      <div
                        style={{
                          padding: '12px',
                          backgroundColor: '#27272A',
                          borderLeft: '4px solid #F59E0B',
                          borderRadius: '6px',
                          marginBottom: '14px',
                          fontSize: '13px',
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 600,
                            color: 'var(--warning-text)',
                            marginBottom: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <AlertTriangleIcon size={16} /> Đơn giải trình chấm
                          công từ nhân viên
                        </div>
                        <div style={{ color: 'var(--text-color)', marginBottom: '4px' }}>
                          Lý do: <em>"{shift.pending_correction.reason}"</em>
                        </div>
                        {shift.pending_correction.claimed_clock_out_at && (
                          <div style={{ color: 'var(--muted-color)' }}>
                            Giờ nhân viên báo kết thúc:{' '}
                            {new Date(
                              shift.pending_correction.claimed_clock_out_at,
                            ).toLocaleString('vi-VN')}
                          </div>
                        )}
                        {shift.pending_correction.evidence_note && (
                          <div style={{ color: 'var(--muted-color)' }}>
                            Minh chứng: {shift.pending_correction.evidence_note}
                          </div>
                        )}

                        {/* Owner Decisions on Correction */}
                        <div
                          style={{
                            display: 'flex',
                            gap: '8px',
                            marginTop: '10px',
                          }}
                        >
                          <AppButton
                            variant="primary"
                            onClick={() =>
                              handleDecideCorrection(
                                shift.pending_correction!.id,
                                'accept',
                                shift,
                              )
                            }
                            style={{ height: '36px', fontSize: '13px' }}
                          >
                            <CheckIcon size={14} /> Chấp nhận điều chỉnh
                          </AppButton>
                          <AppButton
                            variant="destructive"
                            onClick={() =>
                              handleDecideCorrection(
                                shift.pending_correction!.id,
                                'reject',
                                shift,
                              )
                            }
                            style={{ height: '36px', fontSize: '13px' }}
                          >
                            <CloseIcon size={14} /> Từ chối
                          </AppButton>
                        </div>
                      </div>
                    )}

                    {/* Open Shift Owner Close Action (for stuck/active shifts) */}
                    {shift.run_state !== 'completed' &&
                      !shift.pending_correction && (
                        <div
                          style={{
                            display: 'flex',
                            gap: '8px',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            borderTop: '1px solid var(--border-color)',
                            paddingTop: '12px',
                          }}
                        >
                          <span style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                            {shift.worked_seconds > 12 * 3600
                              ? '⚠️ Nhân viên quên bấm kết thúc ca — Chủ sở hữu có thể đóng và xác nhận ca ngay:'
                              : '💡 Nhân viên đang trong ca làm việc:'}
                          </span>
                          <AppButton
                            data-testid="owner-close-shift-btn"
                            variant="primary"
                            onClick={() => handleOwnerCloseShift(shift)}
                            style={{ minHeight: '38px', fontSize: '13px' }}
                          >
                            <CheckIcon size={14} /> Đóng ca & Xác nhận giúp NV
                          </AppButton>
                        </div>
                      )}

                    {/* Standard Owner Review Actions */}
                    {shift.run_state === 'completed' &&
                      shift.review_state === 'unreviewed' &&
                      !shift.pending_correction &&
                      !shift.is_self_shift &&
                      shift.is_payroll_eligible !== false && (
                        <div
                          style={{
                            display: 'flex',
                            gap: '8px',
                            justifyContent: 'flex-end',
                            borderTop: '1px solid var(--border-color)',
                            paddingTop: '12px',
                          }}
                        >
                          <AppButton
                            data-testid="review-reject-btn"
                            variant="secondary"
                            onClick={() => handleReviewShift(shift, 'rejected')}
                            style={{ minHeight: '38px', fontSize: '13px' }}
                          >
                            <CloseIcon size={14} /> Từ chối ca
                          </AppButton>
                          <AppButton
                            data-testid="review-approve-btn"
                            variant="primary"
                            onClick={() => handleReviewShift(shift, 'approved')}
                            style={{ minHeight: '38px', fontSize: '13px' }}
                          >
                            <CheckIcon size={14} /> Duyệt ca làm
                          </AppButton>
                        </div>
                      )}
                  </AppCard>
                ))}
              {filteredOwnerShifts.length > 0 && (
                <div style={{ marginTop: '16px' }}>
                  <Pagination
                    testId="shifts-pager"
                    total={filteredOwnerShifts.length}
                    page={shiftPage}
                    pageSize={shiftPageSize}
                    onPage={setShiftPage}
                    onPageSize={(size) => {
                      setShiftPageSize(size);
                      setShiftPage(0);
                    }}
                    pageSizes={PAGINATION_PAGE_SIZES}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Staff Correction Request Modal */}
      {showCorrectionModal && targetShiftForCorrection && (
        <div
          data-testid="correction-modal"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
          }}
        >
          <div
            style={{
              backgroundColor: 'var(--surface-color)',
              borderRadius: '12px',
              border: '1px solid var(--border-color)',
              padding: '24px',
              maxWidth: '480px',
              width: '100%',
              color: 'var(--text-color)',
            }}
          >
            <h3
              style={{
                fontSize: '18px',
                fontWeight: 700,
                marginBottom: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <FileTextIcon size={20} /> Giải trình & Điều chỉnh chấm công
            </h3>
            <p
              style={{
                fontSize: '13px',
                color: 'var(--muted-color)',
                marginBottom: '16px',
              }}
            >
              Gửi đơn giải trình quên chấm công hoặc điều chỉnh giờ làm việc đến
              Chủ sở hữu (Owner) duyệt theo quy chuẩn C01.
            </p>

            <form onSubmit={handleSubmitCorrection}>
              <div style={{ marginBottom: '14px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    marginBottom: '6px',
                  }}
                >
                  Lý do điều chỉnh *
                </label>
                <textarea
                  data-testid="correction-reason-input"
                  required
                  rows={3}
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  placeholder="Ví dụ: Quên bấm kết thúc ca lúc 18:00 do hỗ trợ khách hàng..."
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-color)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              <div style={{ marginBottom: '14px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    marginBottom: '6px',
                  }}
                >
                  Giờ kết thúc ca thực tế (đề xuất)
                </label>
                <input
                  data-testid="correction-clockout-input"
                  type="datetime-local"
                  value={claimedClockOut}
                  onChange={(e) => setClaimedClockOut(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-color)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                    minHeight: '44px',
                  }}
                />
              </div>

              <div style={{ marginBottom: '20px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    marginBottom: '6px',
                  }}
                >
                  Ghi chú minh chứng (nếu có)
                </label>
                <input
                  data-testid="correction-evidence-input"
                  type="text"
                  value={evidenceNote}
                  onChange={(e) => setEvidenceNote(e.target.value)}
                  placeholder="Ví dụ: Đã báo trực tiếp với Quản trị viên..."
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--bg-color)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-color)',
                    fontSize: '14px',
                    minHeight: '44px',
                  }}
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: '12px',
                  justifyContent: 'flex-end',
                }}
              >
                <AppButton
                  data-testid="correction-cancel-btn"
                  type="button"
                  variant="secondary"
                  onClick={() => setShowCorrectionModal(false)}
                >
                  Hủy
                </AppButton>
                <AppButton
                  data-testid="correction-submit-btn"
                  type="submit"
                  variant="primary"
                  disabled={actionLoading}
                >
                  Gửi đơn giải trình
                </AppButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {clockActionDialog?.type === 'confirm_clock_out' && (
        <AppDialog
          isOpen
          onClose={() => !dialogLoading && setClockActionDialog(null)}
          title="Xác nhận kết thúc ca làm việc"
          description="Bạn có chắc chắn muốn kết thúc ca làm việc này? Dữ liệu ca làm sẽ được lưu và chuyển sang trạng thái chờ duyệt."
          confirmLabel="Kết thúc ca"
          cancelLabel="Hủy"
          onConfirm={executeClockOut}
          confirmVariant="primary"
          isLoading={dialogLoading}
        />
      )}

      {clockActionDialog?.type === 'review_approve' && (
        <AppDialog
          isOpen
          onClose={() => !dialogLoading && setClockActionDialog(null)}
          title="Duyệt ca làm việc"
          description={`Xác nhận duyệt ca làm của ${clockActionDialog.shift.employee_name || clockActionDialog.shift.employee_code}?`}
          confirmLabel="Duyệt ca"
          cancelLabel="Hủy"
          onConfirm={() =>
            executeReviewShift(
              clockActionDialog.shift,
              'approved',
              clockActionDialog.reason,
            )
          }
          confirmVariant="primary"
          isLoading={dialogLoading}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: TOKENS.spacing[3],
            }}
          >
            <label
              htmlFor="clock-review-approve-reason"
              style={{ fontSize: '13px', color: THEME_COLORS.muted }}
            >
              Ghi chú / lý do duyệt (tùy chọn):
            </label>
            <input
              id="clock-review-approve-reason"
              data-testid="review-approve-reason-input"
              type="text"
              value={clockActionDialog.reason}
              onChange={(e) =>
                setClockActionDialog({
                  ...clockActionDialog,
                  reason: e.target.value,
                })
              }
              placeholder="Ví dụ: Đúng giờ quy định..."
              disabled={dialogLoading}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: TOKENS.radii.md,
                border: `1px solid ${THEME_COLORS.border}`,
                backgroundColor: THEME_COLORS.background,
                color: THEME_COLORS.text,
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </AppDialog>
      )}

      {clockActionDialog?.type === 'review_reject' && (
        <AppDialog
          isOpen
          onClose={() => !dialogLoading && setClockActionDialog(null)}
          title="Từ chối ca làm việc"
          confirmLabel="Xác nhận từ chối"
          cancelLabel="Hủy"
          onConfirm={() =>
            executeReviewShift(
              clockActionDialog.shift,
              'rejected',
              clockActionDialog.reason,
            )
          }
          confirmVariant="destructive"
          isLoading={dialogLoading}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: TOKENS.spacing[3],
            }}
          >
            <label
              htmlFor="clock-review-reject-reason"
              style={{ fontSize: '13px', color: THEME_COLORS.muted }}
            >
              Nhập lý do từ chối ca làm của{' '}
              {clockActionDialog.shift.employee_name ||
                clockActionDialog.shift.employee_code}{' '}
              *
            </label>
            <input
              id="clock-review-reject-reason"
              data-testid="review-reject-reason-input"
              type="text"
              value={clockActionDialog.reason}
              onChange={(e) =>
                setClockActionDialog({
                  ...clockActionDialog,
                  reason: e.target.value,
                })
              }
              placeholder="Nhập lý do từ chối..."
              disabled={dialogLoading}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: TOKENS.radii.md,
                border: `1px solid ${THEME_COLORS.border}`,
                backgroundColor: THEME_COLORS.background,
                color: THEME_COLORS.text,
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              autoFocus
            />
          </div>
        </AppDialog>
      )}

      {clockActionDialog?.type === 'correction_reject' && (
        <AppDialog
          isOpen
          onClose={() => !dialogLoading && setClockActionDialog(null)}
          title="Từ chối đơn giải trình chấm công"
          confirmLabel="Từ chối đơn"
          cancelLabel="Hủy"
          onConfirm={() =>
            executeDecideCorrection(
              clockActionDialog.crId,
              'reject',
              clockActionDialog.reason,
            )
          }
          confirmVariant="destructive"
          isLoading={dialogLoading}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: TOKENS.spacing[3],
            }}
          >
            <label
              htmlFor="clock-correction-reject-reason"
              style={{ fontSize: '13px', color: THEME_COLORS.muted }}
            >
              Nhập lý do từ chối đơn giải trình:
            </label>
            <input
              id="clock-correction-reject-reason"
              type="text"
              value={clockActionDialog.reason}
              onChange={(e) =>
                setClockActionDialog({
                  ...clockActionDialog,
                  reason: e.target.value,
                })
              }
              placeholder="Nhập lý do từ chối..."
              disabled={dialogLoading}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: TOKENS.radii.md,
                border: `1px solid ${THEME_COLORS.border}`,
                backgroundColor: THEME_COLORS.background,
                color: THEME_COLORS.text,
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              autoFocus
            />
          </div>
        </AppDialog>
      )}

      {clockActionDialog?.type === 'correction_accept' && (
        <AppDialog
          isOpen
          onClose={() => !dialogLoading && setClockActionDialog(null)}
          title="Chấp nhận điều chỉnh ca làm việc"
          confirmLabel="Chấp nhận điều chỉnh"
          cancelLabel="Hủy"
          onConfirm={() =>
            executeDecideCorrection(
              clockActionDialog.crId,
              'accept',
              clockActionDialog.reason,
              new Date(clockActionDialog.time).toISOString(),
            )
          }
          confirmVariant="primary"
          isLoading={dialogLoading}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: TOKENS.spacing[3],
            }}
          >
            <div>
              <label
                htmlFor="clock-correction-accept-time"
                style={{
                  fontSize: '13px',
                  color: THEME_COLORS.muted,
                  display: 'block',
                  marginBottom: '6px',
                }}
              >
                Xác nhận giờ kết thúc ca chính xác (YYYY-MM-DDTHH:MM):
              </label>
              <input
                id="clock-correction-accept-time"
                type="datetime-local"
                value={clockActionDialog.time}
                onChange={(e) =>
                  setClockActionDialog({
                    ...clockActionDialog,
                    time: e.target.value,
                  })
                }
                disabled={dialogLoading}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: TOKENS.radii.md,
                  border: `1px solid ${THEME_COLORS.border}`,
                  backgroundColor: THEME_COLORS.background,
                  color: THEME_COLORS.text,
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <label
                htmlFor="clock-correction-accept-reason"
                style={{
                  fontSize: '13px',
                  color: THEME_COLORS.muted,
                  display: 'block',
                  marginBottom: '6px',
                }}
              >
                Nhập ghi chú chấp nhận điều chỉnh:
              </label>
              <input
                id="clock-correction-accept-reason"
                type="text"
                value={clockActionDialog.reason}
                onChange={(e) =>
                  setClockActionDialog({
                    ...clockActionDialog,
                    reason: e.target.value,
                  })
                }
                placeholder="Nhập ghi chú..."
                disabled={dialogLoading}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: TOKENS.radii.md,
                  border: `1px solid ${THEME_COLORS.border}`,
                  backgroundColor: THEME_COLORS.background,
                  color: THEME_COLORS.text,
                  fontSize: '14px',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
                autoFocus
              />
            </div>
          </div>
        </AppDialog>
      )}

      {toast && (
        <AppToast
          message={toast.message}
          variant={toast.variant}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
};
