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
import { TOKENS } from '../../../../packages/ui/src/tokens.js';
import type { UserRole } from '../types.js';
import type {
  ShiftData,
  AttendanceMeResponseData,
} from '../../../../packages/contracts/src/attendance.js';
import type { EmployeeData } from '../../../../packages/contracts/src/employees.js';

export interface ClockScreenProps {
  role?: UserRole;
  onNavigate?: (path: string) => void;
}

export const ClockScreen: React.FC<ClockScreenProps> = ({ role = 'owner' }) => {
  const [activeTab, setActiveTab] = useState<'my_clock' | 'owner_review'>(
    'my_clock',
  );

  // Auth / CSRF State
  const [csrfToken, setCsrfToken] = useState<string>('');

  // Self Attendance State
  const [currentShift, setCurrentShift] = useState<ShiftData | null>(null);
  const [recentShifts, setRecentShifts] = useState<ShiftData[]>([]);
  const [myShiftPage, setMyShiftPage] = useState<number>(0);
  const [myShiftPageSize, setMyShiftPageSize] =
    useState<number>(DEFAULT_PAGE_SIZE);

  const safeMyShiftPage = clampPage(
    myShiftPage,
    recentShifts.length,
    myShiftPageSize,
  );
  const pagedRecentShifts = React.useMemo(() => {
    return recentShifts.slice(
      safeMyShiftPage * myShiftPageSize,
      (safeMyShiftPage + 1) * myShiftPageSize,
    );
  }, [recentShifts, safeMyShiftPage, myShiftPageSize]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    variant?: ToastVariant;
  } | null>(null);
  const [clockActionDialog, setClockActionDialog] = useState<
    | { type: 'confirm_clock_out' }
    | { type: 'review_approve'; shift: ShiftData }
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

  // Owner Review State
  const [ownerShifts, setOwnerShifts] = useState<ShiftData[]>([]);
  const [shiftPage, setShiftPage] = useState<number>(0);
  const [shiftPageSize, setShiftPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [employees, setEmployees] = useState<EmployeeData[]>([]);
  const [employeesError, setEmployeesError] = useState<string | null>(null);
  const [employeesLoading, setEmployeesLoading] = useState<boolean>(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>('');
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
        const start = new Date(selectedDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(selectedDate);
        end.setHours(23, 59, 59, 999);
        params.append('from_date', start.toISOString());
        params.append('to_date', end.toISOString());
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
  }, [selectedEmployeeId, selectedDate, activeTab]);

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
      });
    }
  };

  const executeReviewShift = async (
    shift: ShiftData,
    decision: 'approved' | 'rejected',
    reason?: string,
  ) => {
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
      setErrorMessage(msg);
      setToast({ message: msg, variant: 'error' });
    } finally {
      setDialogLoading(false);
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
      setErrorMessage(msg);
      setToast({ message: msg, variant: 'error' });
    } finally {
      setDialogLoading(false);
      setOwnerLoading(false);
    }
  };

  if (loading) {
    return <LoadingState message="Đang nạp dữ liệu chấm công..." />;
  }

  return (
    <div>
      <PageHeader
        title="Quản lý Chấm công (ATT)"
        subtitle="Hệ thống chấm công thời gian thực, tạm nghỉ và duyệt công chuẩn xác (Doc 20/36)"
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
            borderBottom: '1px solid #334155',
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
            <UserIcon size={16} /> Duyệt công nhân viên
          </AppButton>
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
            color: '#6EE7B7',
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
                    color: '#94A3B8',
                    marginBottom: '20px',
                    backgroundColor: '#1E293B',
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
                      color: '#14B8A6',
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
            <h3
              style={{
                fontSize: '18px',
                fontWeight: 700,
                color: '#F8FAFC',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <CalendarIcon size={20} /> Lịch sử chấm công gần đây
            </h3>

            {recentShifts.length === 0 ? (
              <EmptyState
                title="Chưa có dữ liệu"
                description="Bạn chưa có ca làm việc nào được ghi nhận."
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
                            color: '#F8FAFC',
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
                            color: '#94A3B8',
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

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '13px',
                        color: '#94A3B8',
                        borderTop: '1px solid #334155',
                        paddingTop: '10px',
                        marginTop: '10px',
                      }}
                    >
                      <div>
                        Tổng làm việc:{' '}
                        <strong style={{ color: '#14B8A6' }}>
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
                              color: '#14B8A6',
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
            {recentShifts.length > 0 && (
              <div style={{ marginTop: '16px' }}>
                <Pagination
                  testId="my-shifts-pager"
                  total={recentShifts.length}
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
        /* Owner Review Tab */
        <div>
          {/* Filter Bar */}
          <AppCard style={{ marginBottom: '20px', padding: '16px' }}>
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
                  color: '#FCA5A5',
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
              style={{
                display: 'flex',
                gap: '16px',
                flexWrap: 'wrap',
                alignItems: 'flex-end',
              }}
            >
              <div style={{ flex: 1, minWidth: '180px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#94A3B8',
                    marginBottom: '6px',
                  }}
                >
                  Nhân viên
                </label>
                <select
                  value={selectedEmployeeId}
                  onChange={(e) => setSelectedEmployeeId(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    backgroundColor: '#0B1220',
                    border: '1px solid #334155',
                    color: '#F8FAFC',
                    fontSize: '14px',
                    minHeight: '44px',
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

              <div style={{ flex: 1, minWidth: '180px' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#94A3B8',
                    marginBottom: '6px',
                  }}
                >
                  Ngày làm việc
                </label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    backgroundColor: '#0B1220',
                    border: '1px solid #334155',
                    color: '#F8FAFC',
                    fontSize: '14px',
                    minHeight: '44px',
                  }}
                />
              </div>

              {selectedDate && (
                <AppButton
                  variant="secondary"
                  onClick={() => setSelectedDate('')}
                  style={{ minHeight: '44px' }}
                >
                  Xóa ngày
                </AppButton>
              )}
            </div>
          </AppCard>

          {ownerLoading ? (
            <LoadingState message="Đang tải danh sách ca làm việc..." />
          ) : ownerShifts.length === 0 ? (
            <EmptyState
              title="Không tìm thấy ca làm"
              description="Không có ca làm việc nào phù hợp với bộ lọc."
            />
          ) : (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
            >
              {ownerShifts
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
                            color: '#F8FAFC',
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
                              color: '#94A3B8',
                              backgroundColor: '#1E293B',
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
                            color: '#94A3B8',
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
                        color: '#CBD5E1',
                        backgroundColor: '#0B1220',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        marginBottom: '12px',
                      }}
                    >
                      Thời gian làm việc tính công:{' '}
                      <strong style={{ color: '#14B8A6' }}>
                        {formatHoursMinutes(shift.worked_seconds)}
                      </strong>
                      {shift.breaks.length > 0 &&
                        ` (${shift.breaks.length} lần tạm nghỉ không tính công)`}
                    </div>

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
                            color: '#F59E0B',
                            marginBottom: '4px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <AlertTriangleIcon size={16} /> Đơn giải trình chấm
                          công từ nhân viên
                        </div>
                        <div style={{ color: '#F8FAFC', marginBottom: '4px' }}>
                          Lý do: <em>"{shift.pending_correction.reason}"</em>
                        </div>
                        {shift.pending_correction.claimed_clock_out_at && (
                          <div style={{ color: '#94A3B8' }}>
                            Giờ nhân viên báo kết thúc:{' '}
                            {new Date(
                              shift.pending_correction.claimed_clock_out_at,
                            ).toLocaleString('vi-VN')}
                          </div>
                        )}
                        {shift.pending_correction.evidence_note && (
                          <div style={{ color: '#94A3B8' }}>
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

                    {/* Standard Owner Review Actions */}
                    {shift.run_state === 'completed' &&
                      shift.review_state === 'unreviewed' &&
                      !shift.pending_correction && (
                        <div
                          style={{
                            display: 'flex',
                            gap: '8px',
                            justifyContent: 'flex-end',
                            borderTop: '1px solid #334155',
                            paddingTop: '12px',
                          }}
                        >
                          <AppButton
                            variant="secondary"
                            onClick={() => handleReviewShift(shift, 'rejected')}
                            style={{ minHeight: '38px', fontSize: '13px' }}
                          >
                            <CloseIcon size={14} /> Từ chối ca
                          </AppButton>
                          <AppButton
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
              {ownerShifts.length > 0 && (
                <div style={{ marginTop: '16px' }}>
                  <Pagination
                    testId="shifts-pager"
                    total={ownerShifts.length}
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
              backgroundColor: '#151F30',
              borderRadius: '12px',
              border: '1px solid #334155',
              padding: '24px',
              maxWidth: '480px',
              width: '100%',
              color: '#F8FAFC',
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
                color: '#94A3B8',
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
                    backgroundColor: '#0B1220',
                    border: '1px solid #334155',
                    color: '#F8FAFC',
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
                    backgroundColor: '#0B1220',
                    border: '1px solid #334155',
                    color: '#F8FAFC',
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
                    backgroundColor: '#0B1220',
                    border: '1px solid #334155',
                    color: '#F8FAFC',
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
            executeReviewShift(clockActionDialog.shift, 'approved')
          }
          confirmVariant="primary"
          isLoading={dialogLoading}
        />
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
              style={{ fontSize: '13px', color: TOKENS.colors.muted }}
            >
              Nhập lý do từ chối ca làm của{' '}
              {clockActionDialog.shift.employee_name ||
                clockActionDialog.shift.employee_code}
              :
            </label>
            <input
              id="clock-review-reject-reason"
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
                border: `1px solid ${TOKENS.colors.border}`,
                backgroundColor: TOKENS.colors.background,
                color: TOKENS.colors.text,
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
              style={{ fontSize: '13px', color: TOKENS.colors.muted }}
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
                border: `1px solid ${TOKENS.colors.border}`,
                backgroundColor: TOKENS.colors.background,
                color: TOKENS.colors.text,
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
                  color: TOKENS.colors.muted,
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
                  border: `1px solid ${TOKENS.colors.border}`,
                  backgroundColor: TOKENS.colors.background,
                  color: TOKENS.colors.text,
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
                  color: TOKENS.colors.muted,
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
                  border: `1px solid ${TOKENS.colors.border}`,
                  backgroundColor: TOKENS.colors.background,
                  color: TOKENS.colors.text,
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
