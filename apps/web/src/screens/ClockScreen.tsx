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
  DownloadIcon,
  AppDialog,
  AppToast,
  useAutoDismiss,
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
  userDisplayName?: string | undefined;
  onNavigate?: (path: string) => void;
}

export const ClockScreen: React.FC<ClockScreenProps> = ({
  role = 'owner',
  mode = 'clock',
  userDisplayName,
  onNavigate,
}) => {
  const [activeTab, setActiveTab] = useState<'my_clock' | 'owner_review'>(
    mode === 'review' || (mode === 'history' && role === 'owner')
      ? 'owner_review'
      : 'my_clock',
  );

  // Auth / CSRF State
  const [csrfToken, setCsrfToken] = useState<string>('');
  const [myUserName, setMyUserName] = useState<string>('');

  // Self Attendance State
  const [currentShift, setCurrentShift] = useState<ShiftData | null>(null);
  const [recentShifts, setRecentShifts] = useState<ShiftData[]>([]);
  const [mySelectedMonth, setMySelectedMonth] = useState<string>('all');
  const [myFromDate, setMyFromDate] = useState<string>('');
  const [myToDate, setMyToDate] = useState<string>('');
  const [myReviewStateFilter, setMyReviewStateFilter] = useState<string>('all');
  const [myShiftPage, setMyShiftPage] = useState<number>(0);
  const [myShiftPageSize, setMyShiftPageSize] =
    useState<number>(DEFAULT_PAGE_SIZE);
  const [showMyAdvancedFilters, setShowMyAdvancedFilters] =
    useState<boolean>(false);

  const getShiftYearMonth = (isoString: string): string => {
    try {
      const d = new Date(isoString);
      if (Number.isNaN(d.getTime())) return '';
      const enCa = d.toLocaleDateString('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
      });
      return enCa.slice(0, 7);
    } catch {
      return '';
    }
  };

  const currentVnYearMonth = React.useMemo(() => {
    return new Date()
      .toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
      .slice(0, 7);
  }, []);

  const formatYearMonthLabel = (ym: string): string => {
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return 'Tất cả các tháng';
    const [y, m] = ym.split('-');
    return `Tháng ${Number(m)}/${y}`;
  };

  const myAvailableMonths = React.useMemo(() => {
    const map = new Map<
      string,
      { ym: string; count: number; totalSeconds: number }
    >();
    for (const s of recentShifts) {
      const ym = getShiftYearMonth(s.clock_in_at);
      if (!ym) continue;
      const cur = map.get(ym) || { ym, count: 0, totalSeconds: 0 };
      cur.count += 1;
      cur.totalSeconds += s.worked_seconds || 0;
      map.set(ym, cur);
    }
    if (!map.has(currentVnYearMonth)) {
      map.set(currentVnYearMonth, {
        ym: currentVnYearMonth,
        count: 0,
        totalSeconds: 0,
      });
    }
    return Array.from(map.values()).sort((a, b) => b.ym.localeCompare(a.ym));
  }, [recentShifts, currentVnYearMonth]);

  const filteredRecentShifts = React.useMemo(() => {
    return recentShifts.filter((shift) => {
      if (
        mySelectedMonth !== 'all' &&
        getShiftYearMonth(shift.clock_in_at) !== mySelectedMonth
      ) {
        return false;
      }
      if (
        myReviewStateFilter !== 'all' &&
        shift.review_state !== myReviewStateFilter
      ) {
        return false;
      }
      if (myFromDate) {
        const start = new Date(`${myFromDate}T00:00:00+07:00`);
        if (new Date(shift.clock_in_at) < start) return false;
      }
      if (myToDate) {
        const end = new Date(`${myToDate}T23:59:59.999+07:00`);
        if (new Date(shift.clock_in_at) > end) return false;
      }
      return true;
    });
  }, [
    recentShifts,
    mySelectedMonth,
    myReviewStateFilter,
    myFromDate,
    myToDate,
  ]);

  const [nowTick, setNowTick] = useState<number>(() => Date.now());

  useEffect(() => {
    if (
      !currentShift ||
      (currentShift.run_state !== 'working' &&
        currentShift.run_state !== 'paused')
    ) {
      return;
    }
    setNowTick(Date.now());
    const timerId = setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => clearInterval(timerId);
  }, [currentShift?.id, currentShift?.run_state]);

  const liveShiftMetrics = React.useMemo(() => {
    if (!currentShift) {
      return { liveWorkedSeconds: 0, currentBreakSeconds: 0 };
    }
    const clockInMs = new Date(currentShift.clock_in_at).getTime();
    if (Number.isNaN(clockInMs)) {
      return {
        liveWorkedSeconds: currentShift.worked_seconds || 0,
        currentBreakSeconds: 0,
      };
    }
    let unpaidBreakMs = 0;
    let activeBreakSec = 0;
    for (const br of currentShift.breaks || []) {
      const startMs = new Date(br.started_at).getTime();
      if (Number.isNaN(startMs)) continue;
      if (br.ended_at) {
        const endMs = new Date(br.ended_at).getTime();
        if (!Number.isNaN(endMs) && br.unpaid) {
          unpaidBreakMs += Math.max(0, endMs - startMs);
        }
      } else {
        const curDurMs = Math.max(0, nowTick - startMs);
        activeBreakSec = Math.floor(curDurMs / 1000);
        if (br.unpaid) {
          unpaidBreakMs += curDurMs;
        }
      }
    }
    const totalElapsedMs = Math.max(0, nowTick - clockInMs - unpaidBreakMs);
    return {
      liveWorkedSeconds: Math.max(
        currentShift.worked_seconds || 0,
        Math.floor(totalElapsedMs / 1000),
      ),
      currentBreakSeconds: activeBreakSec,
    };
  }, [currentShift, nowTick]);

  const todaySummary = React.useMemo(() => {
    const todayVnIso = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    let todayShiftsCount = 0;
    let todayWorkedSeconds = 0;
    for (const s of recentShifts) {
      const shiftDay = new Date(s.clock_in_at).toLocaleDateString('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
      });
      if (shiftDay === todayVnIso) {
        todayShiftsCount += 1;
        todayWorkedSeconds += s.worked_seconds || 0;
      }
    }
    if (currentShift) {
      const curDay = new Date(currentShift.clock_in_at).toLocaleDateString(
        'en-CA',
        { timeZone: 'Asia/Ho_Chi_Minh' },
      );
      if (
        curDay === todayVnIso &&
        !recentShifts.some((s) => s.id === currentShift.id)
      ) {
        todayShiftsCount += 1;
        todayWorkedSeconds += liveShiftMetrics.liveWorkedSeconds;
      }
    }
    return { todayVnIso, todayShiftsCount, todayWorkedSeconds };
  }, [recentShifts, currentShift, liveShiftMetrics.liveWorkedSeconds]);

  const toVnDateTimeLocalValue = (isoString?: string | null): string => {
    try {
      const dt = isoString ? new Date(isoString) : new Date();
      if (Number.isNaN(dt.getTime())) return '';
      const sv = dt.toLocaleString('sv-SE', {
        timeZone: 'Asia/Ho_Chi_Minh',
      });
      return sv.replace(' ', 'T').slice(0, 16);
    } catch {
      return '';
    }
  };

  const formatHmsCounter = (totalSecs: number): string => {
    const safe = Math.max(0, Math.floor(totalSecs));
    const hrs = Math.floor(safe / 3600);
    const mins = Math.floor((safe % 3600) / 60);
    const secs = safe % 60;
    return [hrs, mins, secs].map((v) => String(v).padStart(2, '0')).join(':');
  };

  const formatCompactHoursMinutes = (totalSecs: number): string => {
    const safe = Math.max(0, Math.floor(totalSecs));
    const hrs = Math.floor(safe / 3600);
    const mins = Math.floor((safe % 3600) / 60);
    return `${hrs}g${String(mins).padStart(2, '0')}`;
  };

  const resolvedMyFullName = React.useMemo(() => {
    const candidates = [
      userDisplayName,
      myUserName,
      currentShift?.employee_name,
      recentShifts[0]?.employee_name,
    ];
    for (const c of candidates) {
      const trimmed = (c || '').trim();
      if (
        trimmed &&
        !['staff', 'owner', 'admin'].includes(trimmed.toLowerCase())
      ) {
        return trimmed;
      }
    }
    return (
      userDisplayName ||
      currentShift?.employee_name ||
      recentShifts[0]?.employee_name ||
      myUserName ||
      ''
    ).trim();
  }, [userDisplayName, myUserName, currentShift?.employee_name, recentShifts]);

  const greetingShortName = React.useMemo(() => {
    if (
      !resolvedMyFullName ||
      ['staff', 'owner', 'admin'].includes(resolvedMyFullName.toLowerCase())
    ) {
      return role === 'owner' ? 'Phương' : 'Vinh';
    }
    const parts = resolvedMyFullName.split(/\s+/).filter(Boolean);
    return parts[parts.length - 1] || resolvedMyFullName;
  }, [resolvedMyFullName, role]);

  const greetingInitial = React.useMemo(() => {
    if (
      resolvedMyFullName &&
      !['staff', 'owner', 'admin'].includes(resolvedMyFullName.toLowerCase())
    ) {
      const words = resolvedMyFullName.split(/\s+/).filter(Boolean);
      const firstWord = words[0] ?? '';
      const lastWord = words[words.length - 1] ?? '';
      if (words.length >= 2 && firstWord.length > 0 && lastWord.length > 0) {
        return `${firstWord[0]}${lastWord[0]}`.toUpperCase();
      }
      if (firstWord.length > 0) {
        return firstWord.slice(0, 2).toUpperCase();
      }
    }
    const ch = greetingShortName.charAt(0).toUpperCase();
    return ch || 'V';
  }, [resolvedMyFullName, greetingShortName]);

  const myMonthlySummary = React.useMemo(() => {
    let totalWorkedSeconds = 0;
    let approvedCount = 0;
    let approvedSeconds = 0;
    let pendingCount = 0;
    for (const s of filteredRecentShifts) {
      totalWorkedSeconds += s.worked_seconds || 0;
      if (s.review_state === 'approved' || s.is_self_shift) {
        approvedCount += 1;
        approvedSeconds += s.worked_seconds || 0;
      } else if (
        s.review_state === 'unreviewed' ||
        s.review_state === 'needs_review' ||
        Boolean(s.pending_correction)
      ) {
        pendingCount += 1;
      }
    }
    return {
      totalShifts: filteredRecentShifts.length,
      totalWorkedSeconds,
      approvedCount,
      approvedSeconds,
      pendingCount,
    };
  }, [filteredRecentShifts]);

  const heroSummaryMonth = React.useMemo(() => {
    if (mySelectedMonth !== 'all') {
      const found = myAvailableMonths.find((m) => m.ym === mySelectedMonth);
      return (
        found || {
          ym: mySelectedMonth,
          count: filteredRecentShifts.length,
          totalSeconds: myMonthlySummary.totalWorkedSeconds,
        }
      );
    }
    const curMonthEntry = myAvailableMonths.find(
      (m) => m.ym === currentVnYearMonth,
    );
    if (curMonthEntry && curMonthEntry.count > 0) {
      return curMonthEntry;
    }
    const latestWithData = myAvailableMonths.find((m) => m.count > 0);
    return (
      latestWithData ||
      curMonthEntry || {
        ym: currentVnYearMonth,
        count: 0,
        totalSeconds: 0,
      }
    );
  }, [
    mySelectedMonth,
    myAvailableMonths,
    currentVnYearMonth,
    filteredRecentShifts.length,
    myMonthlySummary.totalWorkedSeconds,
  ]);

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
  useAutoDismiss(successMessage, () => setSuccessMessage(null), 4000);
  useAutoDismiss(errorMessage, () => setErrorMessage(null), 5000);
  useAutoDismiss(toast, () => setToast(null), 4000);
  const [clockActionDialog, setClockActionDialog] = useState<
    | { type: 'confirm_clock_out' }
    | { type: 'reset_today'; scope: 'me_today' | 'workspace_clock' }
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
  const [ownerViewMode, setOwnerViewMode] = useState<
    'by_employee' | 'by_shift'
  >(mode === 'review' ? 'by_shift' : 'by_employee');
  const [collapsedEmployeeIds, setCollapsedEmployeeIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [expandedShiftListEmployeeIds, setExpandedShiftListEmployeeIds] =
    useState<Set<string>>(() => new Set());
  const [ownerSelectedMonth, setOwnerSelectedMonth] = useState<string>('all');
  const [employeeSelectedMonths, setEmployeeSelectedMonths] = useState<
    Record<string, string>
  >({});
  const [showOwnerAdvancedFilters, setShowOwnerAdvancedFilters] =
    useState<boolean>(false);

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
      const authTask = (async () => {
        const authRes = await fetch('/api/v1/auth/me', authInit);
        if (authRes.ok) {
          const authData = await authRes.json();
          if (signal?.aborted) return;
          if (authData.data?.csrf_token) {
            setCsrfToken(authData.data.csrf_token);
          }
          const nameFromAuth =
            authData.data?.user?.full_name ||
            authData.data?.full_name ||
            authData.data?.user?.display_name ||
            authData.data?.display_name ||
            authData.data?.employee?.full_name ||
            '';
          if (nameFromAuth) {
            setMyUserName(String(nameFromAuth));
          } else {
            try {
              const empRes = await fetch('/api/v1/employees/me', authInit);
              if (empRes.ok && !signal?.aborted) {
                const empJson = await empRes.json().catch(() => null);
                const empName = empJson?.data?.full_name;
                if (typeof empName === 'string' && empName.trim().length > 0) {
                  setMyUserName(empName.trim());
                }
              }
            } catch {
              // ignore optional employee profile lookup failure
            }
          }
        }
      })();

      if (role === 'owner') {
        await Promise.all([
          authTask,
          fetchMyAttendance(signal),
          fetchOwnerEmployees(signal),
          fetchOwnerShifts(signal),
        ]);
      } else {
        await Promise.all([authTask, fetchMyAttendance(signal)]);
      }
    } catch (err: unknown) {
      if (
        signal?.aborted ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        return;
      }
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
      const res = await fetch('/api/v1/attendance/me?limit=500', attInit);
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
        const start = new Date(`${selectedDate}T00:00:00+07:00`);
        params.append('from_date', start.toISOString());
      }
      if (selectedToDate) {
        const end = new Date(`${selectedToDate}T23:59:59.999+07:00`);
        params.append('to_date', end.toISOString());
      } else if (selectedDate) {
        const end = new Date(`${selectedDate}T23:59:59.999+07:00`);
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
      params.append('limit', '500');
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

  const employeeOptions = React.useMemo(() => {
    const map = new Map<
      string,
      { id: string; full_name: string; employee_code: string }
    >();
    for (const emp of employees) {
      map.set(emp.id, {
        id: emp.id,
        full_name: emp.full_name,
        employee_code: emp.employee_code,
      });
    }
    for (const s of ownerShifts) {
      if (s.employee_id && !map.has(s.employee_id)) {
        map.set(s.employee_id, {
          id: s.employee_id,
          full_name: s.employee_name || 'Nhân viên',
          employee_code: s.employee_code || 'NV',
        });
      }
    }
    return Array.from(map.values());
  }, [employees, ownerShifts]);

  const ownerAvailableMonths = React.useMemo(() => {
    const map = new Map<
      string,
      { ym: string; count: number; totalSeconds: number }
    >();
    for (const s of ownerShifts) {
      const ym = getShiftYearMonth(s.clock_in_at);
      if (!ym) continue;
      const cur = map.get(ym) || { ym, count: 0, totalSeconds: 0 };
      cur.count += 1;
      cur.totalSeconds += s.worked_seconds || 0;
      map.set(ym, cur);
    }
    if (!map.has(currentVnYearMonth)) {
      map.set(currentVnYearMonth, {
        ym: currentVnYearMonth,
        count: 0,
        totalSeconds: 0,
      });
    }
    return Array.from(map.values()).sort((a, b) => b.ym.localeCompare(a.ym));
  }, [ownerShifts, currentVnYearMonth]);

  const filteredOwnerShifts = React.useMemo(() => {
    return ownerShifts.filter((shift) => {
      if (
        ownerSelectedMonth !== 'all' &&
        getShiftYearMonth(shift.clock_in_at) !== ownerSelectedMonth
      ) {
        return false;
      }
      if (
        selectedEmployeeId !== 'all' &&
        shift.employee_id !== selectedEmployeeId
      ) {
        return false;
      }
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
  }, [
    ownerShifts,
    ownerSelectedMonth,
    selectedEmployeeId,
    selectedReviewState,
    selectedRunState,
  ]);

  const groupedOwnerShiftsByEmployee = React.useMemo(() => {
    const groups = new Map<
      string,
      {
        employeeId: string;
        employeeName: string;
        employeeCode: string;
        shifts: ShiftData[];
        totalWorkedSeconds: number;
        approvedWorkedSeconds: number;
        approvedCount: number;
        pendingCount: number;
        workingCount: number;
        monthsMap: Map<
          string,
          {
            ym: string;
            count: number;
            totalSeconds: number;
            approvedCount: number;
          }
        >;
        monthsBreakdown: Array<{
          ym: string;
          count: number;
          totalSeconds: number;
          approvedCount: number;
        }>;
      }
    >();

    for (const shift of filteredOwnerShifts) {
      const empId = shift.employee_id || 'unknown';
      let grp = groups.get(empId);
      if (!grp) {
        grp = {
          employeeId: empId,
          employeeName: shift.employee_name || 'Nhân viên',
          employeeCode: shift.employee_code || 'NV',
          shifts: [],
          totalWorkedSeconds: 0,
          approvedWorkedSeconds: 0,
          approvedCount: 0,
          pendingCount: 0,
          workingCount: 0,
          monthsMap: new Map(),
          monthsBreakdown: [],
        };
        groups.set(empId, grp);
      }
      grp.shifts.push(shift);
      grp.totalWorkedSeconds += shift.worked_seconds || 0;
      const isApproved =
        shift.review_state === 'approved' || Boolean(shift.is_self_shift);
      if (isApproved) {
        grp.approvedCount += 1;
        grp.approvedWorkedSeconds += shift.worked_seconds || 0;
      }
      if (isActionablePending(shift)) {
        grp.pendingCount += 1;
      }
      if (shift.run_state !== 'completed') {
        grp.workingCount += 1;
      }
      const ym = getShiftYearMonth(shift.clock_in_at);
      if (ym) {
        const mInfo = grp.monthsMap.get(ym) || {
          ym,
          count: 0,
          totalSeconds: 0,
          approvedCount: 0,
        };
        mInfo.count += 1;
        mInfo.totalSeconds += shift.worked_seconds || 0;
        if (isApproved) mInfo.approvedCount += 1;
        grp.monthsMap.set(ym, mInfo);
      }
    }

    for (const grp of groups.values()) {
      grp.monthsBreakdown = Array.from(grp.monthsMap.values()).sort((a, b) =>
        b.ym.localeCompare(a.ym),
      );
    }

    return Array.from(groups.values()).sort((a, b) => {
      if (b.pendingCount !== a.pendingCount)
        return b.pendingCount - a.pendingCount;
      return b.totalWorkedSeconds - a.totalWorkedSeconds;
    });
  }, [filteredOwnerShifts]);

  const [showPersonalHistory, setShowPersonalHistory] = useState(
    mode === 'history',
  );

  useEffect(() => {
    setShowPersonalHistory(mode === 'history');
    if (mode === 'review') {
      setActiveTab('owner_review');
      setSelectedReviewState('pending_all');
      setOwnerViewMode('by_shift');
    } else if (mode === 'history') {
      setActiveTab(role === 'owner' ? 'owner_review' : 'my_clock');
      setSelectedReviewState('all');
      setOwnerViewMode('by_employee');
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

  const formatVnTimeShort = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatReviewNoteLabel = (reason: string): string => {
    const trimmed = reason.trim();
    if (/^imported from timesheet$/i.test(trimmed)) {
      return 'Nhập từ bảng chấm công Excel';
    }
    return trimmed;
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
      if (currentShift.run_state === 'paused') {
        const resumeRes = await fetch(
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
        const resumeBody = await resumeRes.json().catch(() => null);
        if (!resumeRes.ok || !resumeBody?.success) {
          throw new Error(
            resumeBody?.error?.message ||
              'Không thể kết thúc tạm nghỉ trước khi đóng ca.',
          );
        }
      }

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
        role === 'owner'
          ? 'Kết thúc ca thành công! Ca làm của Chủ sở hữu đã được tự động ghi nhận.'
          : 'Kết thúc ca thành công! Ca làm đã được chuyển đến Owner để duyệt.';
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

  const handleResetClockToday = () => {
    setClockActionDialog({
      type: 'reset_today',
      scope: 'me_today',
    });
  };

  const executeResetClockToday = async (
    scope: 'me_today' | 'workspace_clock',
  ) => {
    setDialogLoading(true);
    setActionLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const res = await fetch('/api/v1/attendance/reset-today', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify({ scope }),
      });

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(
          body.error?.message || 'Không thể đặt lại trạng thái chấm công.',
        );
      }

      const resetCount = Number(body.data?.reset_shifts_count ?? 0);
      setCurrentShift(null);
      setJustClockedOut(false);
      setMySelectedMonth('all');
      setMyFromDate('');
      setMyToDate('');
      setMyReviewStateFilter('all');
      setMyShiftPage(0);
      setClockActionDialog(null);

      const msg =
        resetCount > 0
          ? `Đã đặt lại ${resetCount} ca bấm giờ thử nghiệm — Sẵn sàng bắt đầu làm việc từ hôm nay!`
          : 'Trạng thái chấm công đã sạch sẽ — Sẵn sàng bắt đầu làm việc từ hôm nay!';
      setSuccessMessage(msg);
      setToast({ message: msg, variant: 'success' });
      await fetchMyAttendance();
      if (role === 'owner') {
        await fetchOwnerShifts();
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Không thể đặt lại chấm công';
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

  const handleApproveAllEmployeeShifts = async (group: {
    employeeId: string;
    employeeName: string;
    employeeCode: string;
    shifts: ShiftData[];
  }) => {
    const actionableShifts = group.shifts.filter((s) =>
      isActionableUnreviewed(s),
    );
    if (actionableShifts.length === 0) return;

    setOwnerLoading(true);
    try {
      let approvedCount = 0;
      for (const s of actionableShifts) {
        const res = await fetch(`/api/v1/attendance/shifts/${s.id}/reviews`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          credentials: 'include',
          body: JSON.stringify({
            decision: 'approved',
            reason: 'Duyệt nhanh toàn bộ ca hợp lệ của nhân viên',
          }),
        });
        const body = await res.json().catch(() => null);
        if (res.ok && body?.success) {
          approvedCount += 1;
        }
      }
      if (approvedCount === 0) {
        throw new Error('Không thể duyệt nhanh các ca làm việc của nhân viên.');
      }
      const msg = `Đã duyệt nhanh ${approvedCount} ca làm việc của ${group.employeeName} (${group.employeeCode})!`;
      setSuccessMessage(msg);
      setToast({ message: msg, variant: 'success' });
      await fetchOwnerShifts();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Không thể duyệt nhanh ca làm.';
      setToast({ message: msg, variant: 'error' });
    } finally {
      setOwnerLoading(false);
    }
  };

  const handleExportAttendanceSummaryCsv = () => {
    if (groupedOwnerShiftsByEmployee.length === 0) return;
    const escapeCsv = (val: unknown) => {
      const raw = String(val ?? '');
      const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replace(/"/g, '""')}"`;
    };

    const lines: string[] = [];
    lines.push(
      [
        'Mã nhân viên',
        'Họ và tên',
        'Tổng số ca',
        'Số ca đã duyệt',
        'Số ca chờ xử lý',
        'Tổng giờ làm (giờ)',
        'Tổng giờ đã duyệt (giờ)',
        'Thời lượng hiển thị',
      ]
        .map(escapeCsv)
        .join(','),
    );

    for (const grp of groupedOwnerShiftsByEmployee) {
      const totalHours = (grp.totalWorkedSeconds / 3600).toFixed(2);
      const approvedHours = (grp.approvedWorkedSeconds / 3600).toFixed(2);
      lines.push(
        [
          grp.employeeCode,
          grp.employeeName,
          grp.shifts.length,
          grp.approvedCount,
          grp.pendingCount,
          totalHours,
          approvedHours,
          formatHoursMinutes(grp.totalWorkedSeconds),
        ]
          .map(escapeCsv)
          .join(','),
      );
    }

    lines.push('');
    lines.push(
      [
        'Mã nhân viên',
        'Họ và tên',
        'Ngày vào ca',
        'Giờ vào ca',
        'Giờ ra ca',
        'Thời lượng tính công',
        'Trạng thái ca',
        'Trạng thái duyệt',
        'Ghi chú duyệt',
      ]
        .map(escapeCsv)
        .join(','),
    );

    for (const shift of filteredOwnerShifts) {
      lines.push(
        [
          shift.employee_code || 'NV',
          shift.employee_name || 'Nhân viên',
          formatVnDate(shift.clock_in_at),
          formatVnTime(shift.clock_in_at),
          shift.clock_out_at ? formatVnTime(shift.clock_out_at) : 'Đang mở',
          formatHoursMinutes(shift.worked_seconds),
          shift.run_state === 'completed' ? 'Đã đóng ca' : 'Đang mở',
          shift.is_self_shift
            ? 'Ca Chủ sở hữu'
            : shift.review_state === 'approved'
              ? 'Đã duyệt'
              : shift.review_state === 'rejected'
                ? 'Đã từ chối'
                : shift.review_state === 'needs_review'
                  ? 'Cần giải trình'
                  : 'Chờ duyệt',
          shift.review_reason || '',
        ]
          .map(escapeCsv)
          .join(','),
      );
    }

    const csvContent = `\uFEFF${lines.join('\r\n')}`;
    if (
      typeof document !== 'undefined' &&
      typeof Blob !== 'undefined' &&
      typeof URL !== 'undefined' &&
      typeof URL.createObjectURL === 'function'
    ) {
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bang-tong-hop-cham-cong-${selectedDate || 'toan-bo'}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
    const msg = 'Đã xuất file CSV tổng hợp chấm công theo nhân viên.';
    setSuccessMessage(msg);
    setToast({ message: msg, variant: 'success' });
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
      const defaultDate = toVnDateTimeLocalValue(
        shift.pending_correction?.claimed_clock_out_at ||
          shift.clock_out_at ||
          new Date().toISOString(),
      );

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
    if (decision === 'accept' && !clockOutAt) {
      const msg = 'Vui lòng nhập giờ kết thúc ca hợp lệ.';
      setErrorMessage(msg);
      setToast({ message: msg, variant: 'warning' });
      return;
    }
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
    return <LoadingState message="Đang nạp dữ liệu chấm công…" />;
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
    <div
      className={activeTab === 'my_clock' ? 'clock-self-page' : undefined}
      data-role={role}
    >
      {activeTab !== 'my_clock' && (
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
      )}

      {/* Tab Switcher for Owner (hidden when AppShell subnav is active via onNavigate) */}
      {role === 'owner' && (
        <div
          style={{
            display: onNavigate ? 'none' : 'flex',
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
            borderRadius: '16px',
            backgroundColor: 'rgba(16, 185, 129, 0.14)',
            border: '1px solid rgba(16, 185, 129, 0.35)',
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
          <div className="clock-self-main-fold">
            <header className="clock-self-header">
              <h1 className="clock-self-title">Chào {greetingShortName}</h1>
              <a
                href="#ca-nhan"
                aria-label="Trang cá nhân"
                className="clock-self-avatar"
                onClick={(e) => {
                  if (onNavigate) {
                    e.preventDefault();
                    onNavigate('/my-pay');
                  }
                }}
              >
                {greetingInitial}
              </a>
            </header>
            <p className="page-header-subtitle" style={{ margin: 0 }}>
              {headerSubtitle}
            </p>

            {justClockedOut && onNavigate && (
              <div
                data-testid="post-clockout-report-prompt"
                className="clock-self-card"
                style={{
                  padding: '14px 16px',
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: '14px',
                      fontWeight: 700,
                      color: 'var(--text-color)',
                    }}
                  >
                    Bạn vừa kết thúc ca làm việc — Đừng quên nộp báo cáo ngày!
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                      marginTop: '2px',
                    }}
                  >
                    Ghi nhận ngay tiến độ và kết quả công việc trong ca hôm nay
                    để Owner đối chiếu.
                  </div>
                </div>
                <div
                  style={{ display: 'flex', gap: '8px', alignItems: 'center' }}
                >
                  <AppButton
                    variant="primary"
                    data-testid="btn-post-clockout-create-report"
                    onClick={() => onNavigate('/reports/new')}
                  >
                    Nộp báo cáo công việc hôm nay →
                  </AppButton>
                  <AppButton
                    variant="secondary"
                    className="clock-self-secondary-btn"
                    onClick={() => setJustClockedOut(false)}
                  >
                    Để sau
                  </AppButton>
                </div>
              </div>
            )}

            <div className="clock-self-hero">
              <div className="clock-self-timer-group">
                <span className="clock-self-status">
                  {currentShift?.run_state === 'working'
                    ? 'Đang trong ca'
                    : currentShift?.run_state === 'paused'
                      ? 'Đang tạm nghỉ'
                      : 'Chưa vào ca'}
                </span>
                <div className="sr-only">
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

                {currentShift ? (
                  <>
                    <span
                      data-testid="live-shift-timer"
                      className="clock-self-timer clock-self-timer-live"
                      style={{
                        color:
                          currentShift.run_state === 'paused'
                            ? 'var(--warning-text)'
                            : undefined,
                      }}
                    >
                      {formatHmsCounter(liveShiftMetrics.liveWorkedSeconds)}
                    </span>
                    {currentShift.run_state === 'paused' && (
                      <div
                        style={{
                          fontSize: '12.5px',
                          color: 'var(--warning-text)',
                          fontWeight: 600,
                        }}
                      >
                        Đang tạm nghỉ:{' '}
                        {formatHmsCounter(liveShiftMetrics.currentBreakSeconds)}
                      </div>
                    )}
                    <div className="clock-self-shift-meta">
                      Bắt đầu ca: {formatVnTime(currentShift.clock_in_at)} ngày{' '}
                      {formatVnDate(currentShift.clock_in_at)}
                      {currentShift.breaks.length > 0 &&
                        ` • ${currentShift.breaks.length} lần tạm nghỉ`}
                    </div>
                  </>
                ) : (
                  <span className="clock-self-timer">0:00</span>
                )}
              </div>

              {!currentShift && (
                <button
                  type="button"
                  aria-label="Vào ca"
                  className="clock-self-circle-btn"
                  disabled={actionLoading}
                  onClick={handleClockIn}
                >
                  <svg
                    width="36"
                    height="36"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M7 4v16l13-8z" />
                  </svg>
                  <span className="clock-self-circle-btn-label">Vào ca</span>
                  <span className="sr-only"> làm việc</span>
                </button>
              )}

              {currentShift?.run_state === 'working' && (
                <>
                  <button
                    type="button"
                    aria-label="Kết thúc ca"
                    className="clock-self-circle-btn"
                    disabled={actionLoading}
                    onClick={handleClockOut}
                  >
                    <StopIcon size={36} />
                    <span className="clock-self-circle-btn-label">
                      Kết thúc ca
                    </span>
                  </button>
                  <div className="clock-self-sub-actions">
                    <button
                      type="button"
                      className="clock-self-secondary-btn"
                      disabled={actionLoading}
                      onClick={handleStartBreak}
                    >
                      <PauseIcon size={16} /> Tạm nghỉ
                    </button>
                  </div>
                </>
              )}

              {currentShift?.run_state === 'paused' && (
                <>
                  <button
                    type="button"
                    aria-label="Tiếp tục làm việc"
                    className="clock-self-circle-btn"
                    disabled={actionLoading}
                    onClick={handleResume}
                  >
                    <PlayIcon size={36} />
                    <span className="clock-self-circle-btn-label">
                      Tiếp tục
                    </span>
                    <span className="sr-only"> làm việc</span>
                  </button>
                  <div className="clock-self-sub-actions">
                    <button
                      type="button"
                      className="clock-self-secondary-btn clock-self-secondary-btn-danger"
                      disabled={actionLoading}
                      onClick={handleClockOut}
                    >
                      <StopIcon size={16} /> Kết thúc ca
                    </button>
                  </div>
                </>
              )}

              <div className="clock-self-aux-row">
                <span
                  data-testid="today-attendance-summary"
                  className="clock-self-today-pill"
                >
                  Hôm nay
                  <span className="sr-only">
                    {' '}
                    ({formatIsoToVnLabel(todaySummary.todayVnIso)})
                  </span>
                  :{' '}
                  <strong style={{ color: 'var(--text-color)' }}>
                    {todaySummary.todayShiftsCount} ca
                  </strong>{' '}
                  •{' '}
                  <strong style={{ color: 'var(--accent-text)' }}>
                    {formatHoursMinutes(todaySummary.todayWorkedSeconds)}
                  </strong>
                </span>
                {currentShift && (
                  <button
                    type="button"
                    data-testid="clock-correction-btn"
                    className="clock-self-link-btn"
                    onClick={() => {
                      setTargetShiftForCorrection(currentShift);
                      setClaimedClockOut(
                        toVnDateTimeLocalValue(
                          currentShift.clock_out_at || new Date().toISOString(),
                        ),
                      );
                      setShowCorrectionModal(true);
                    }}
                  >
                    Quên bấm giờ hoặc cần giải trình ca này?
                  </button>
                )}
                <button
                  type="button"
                  data-testid="btn-reset-clock-today"
                  className="clock-self-reset-pill"
                  disabled={actionLoading}
                  onClick={handleResetClockToday}
                >
                  Đặt lại hôm nay
                </button>
              </div>
            </div>

            <div className="clock-self-summary-card">
              <div className="clock-self-summary-row">
                <span className="clock-self-summary-label">
                  Tháng {Number(heroSummaryMonth.ym.split('-')[1]) || 11}
                </span>
                <span className="clock-self-summary-value">
                  {heroSummaryMonth.count} ca ·{' '}
                  {formatCompactHoursMinutes(heroSummaryMonth.totalSeconds)}
                </span>
              </div>
              <a
                href="#nop-bao-cao"
                className="clock-self-report-row"
                onClick={(e) => {
                  if (onNavigate) {
                    e.preventDefault();
                    onNavigate('/reports/new');
                  }
                }}
              >
                <span
                  className="clock-self-dot"
                  style={{ backgroundColor: '#d97706' }}
                />
                <span className="clock-self-report-label">
                  Nộp báo cáo hôm nay
                </span>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#94a3b8"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </a>
            </div>
          </div>

          {/* Personal History */}
          <div className="clock-self-history-section">
            <div className="clock-self-history-header">
              <button
                type="button"
                data-testid="toggle-personal-history-btn"
                aria-expanded={showPersonalHistory}
                onClick={() => setShowPersonalHistory((prev) => !prev)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  background: 'transparent',
                  border: 'none',
                  padding: '4px 0',
                  cursor: 'pointer',
                  color: 'var(--text-color)',
                }}
              >
                <h3
                  className="clock-self-history-title"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    margin: 0,
                  }}
                >
                  <CalendarIcon size={18} /> Lịch sử chấm công cá nhân (
                  {filteredRecentShifts.length}){' '}
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--muted-color)',
                    }}
                  >
                    {showPersonalHistory ? '▴ Thu gọn' : '▾ Xem chi tiết'}
                  </span>
                </h3>
              </button>
              {showPersonalHistory && filteredRecentShifts.length > 0 && (
                <AppButton
                  variant="secondary"
                  className="clock-self-secondary-btn"
                  data-testid="btn-export-attendance-csv"
                  onClick={() => {
                    const escapeCsvCell = (val: unknown) => {
                      const raw = String(val ?? '');
                      const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
                      return `"${safe.replace(/"/g, '""')}"`;
                    };
                    const headers = [
                      'Ngày làm việc',
                      'Giờ vào ca',
                      'Giờ ra ca',
                      'Thời lượng làm việc',
                      'Tổng phút',
                      'Trạng thái duyệt',
                      'Ghi chú duyệt',
                    ];
                    const rows = filteredRecentShifts.map((s) => [
                      formatVnDate(s.clock_in_at),
                      formatVnTimeShort(s.clock_in_at),
                      s.clock_out_at
                        ? formatVnTimeShort(s.clock_out_at)
                        : 'Đang mở',
                      formatHoursMinutes(s.worked_seconds ?? 0),
                      String(Math.round((s.worked_seconds ?? 0) / 60)),
                      s.review_state === 'approved' || s.is_self_shift
                        ? 'Đã duyệt'
                        : s.review_state === 'rejected'
                          ? 'Bị từ chối'
                          : s.review_state === 'needs_review'
                            ? 'Cần giải trình'
                            : 'Chờ duyệt',
                      formatReviewNoteLabel(s.review_reason || ''),
                    ]);
                    const csv =
                      '\uFEFF' +
                      [headers, ...rows]
                        .map((r) => r.map(escapeCsvCell).join(','))
                        .join('\r\n');
                    if (
                      typeof Blob !== 'undefined' &&
                      typeof URL !== 'undefined' &&
                      typeof URL.createObjectURL === 'function'
                    ) {
                      const blob = new Blob([csv], {
                        type: 'text/csv;charset=utf-8;',
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `lich-su-cham-cong-${todaySummary.todayVnIso}.csv`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }
                  }}
                >
                  <DownloadIcon size={15} /> Xuất CSV (
                  {filteredRecentShifts.length})
                </AppButton>
              )}
            </div>

            <div
              style={{
                display: showPersonalHistory ? 'flex' : 'none',
                flexDirection: 'column',
                gap: '12px',
              }}
            >
              {/* Personal History Month Selector + Filter Bar */}
              <AppCard
                data-testid="my-history-filter-bar"
                className="clock-self-card"
                style={{ padding: '12px 16px' }}
              >
                <div
                  data-testid="staff-month-selector-bar"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '10px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <select
                      aria-label="Chọn tháng chấm công cá nhân"
                      value={mySelectedMonth}
                      onChange={(e) => {
                        setMySelectedMonth(e.target.value);
                        setMyFromDate('');
                        setMyToDate('');
                        setMyShiftPage(0);
                      }}
                      style={{
                        padding: '8px 12px',
                        borderRadius: '12px',
                        backgroundColor: 'var(--surface-color)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-color)',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      <option value="all">
                        Tất cả các tháng ({recentShifts.length} ca)
                      </option>
                      {myAvailableMonths
                        .filter(
                          (m) => m.count > 0 || m.ym === currentVnYearMonth,
                        )
                        .map((mItem) => (
                          <option key={mItem.ym} value={mItem.ym}>
                            {formatYearMonthLabel(mItem.ym)} ({mItem.count} ca
                            {mItem.totalSeconds > 0
                              ? ` • ${formatHoursMinutes(mItem.totalSeconds)}`
                              : ''}
                            )
                          </option>
                        ))}
                    </select>

                    <span
                      data-testid="staff-monthly-summary-strip"
                      style={{
                        fontSize: '13px',
                        color: 'var(--muted-color)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '8px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span>
                        Tổng giờ:{' '}
                        <strong style={{ color: 'var(--accent-text)' }}>
                          {formatHoursMinutes(
                            myMonthlySummary.totalWorkedSeconds,
                          )}
                        </strong>
                      </span>
                      <span>•</span>
                      <span>
                        Đã duyệt:{' '}
                        <strong style={{ color: 'var(--success-text)' }}>
                          {myMonthlySummary.approvedCount}/
                          {myMonthlySummary.totalShifts} ca
                        </strong>
                      </span>
                    </span>
                  </div>

                  <button
                    type="button"
                    className="clock-self-secondary-btn"
                    onClick={() => setShowMyAdvancedFilters((v) => !v)}
                  >
                    {showMyAdvancedFilters ? '▴ Ẩn bộ lọc' : '▾ Lọc nâng cao'}
                  </button>
                </div>

                <div
                  style={{
                    display: showMyAdvancedFilters ? 'block' : 'none',
                    paddingTop: '12px',
                    marginTop: '12px',
                    borderTop: '1px solid var(--surface-subtle)',
                  }}
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
                    <span
                      style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                    >
                      Chọn nhanh:
                    </span>
                    {[
                      { id: 'today' as const, label: 'Hôm nay' },
                      { id: 'last7d' as const, label: '7 ngày qua' },
                      { id: 'month' as const, label: 'Tháng này' },
                      { id: 'all' as const, label: 'Toàn thời gian' },
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setMySelectedMonth('all');
                          applyQuickDateRange(p.id, 'my');
                        }}
                        style={{
                          padding: '4px 10px',
                          borderRadius: '999px',
                          border: '1px solid var(--border-subtle)',
                          backgroundColor: 'var(--surface-color)',
                          color: 'var(--text-secondary)',
                          fontSize: '12px',
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
                        <span>Từ ngày</span>
                        <span
                          style={{
                            color: 'var(--accent-text)',
                            fontWeight: 500,
                          }}
                        >
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
                          setMySelectedMonth('all');
                          setMyFromDate(e.target.value);
                          setMyShiftPage(0);
                        }}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          borderRadius: '12px',
                          backgroundColor: 'var(--surface-color)',
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
                        <span>Đến ngày</span>
                        <span
                          style={{
                            color: 'var(--accent-text)',
                            fontWeight: 500,
                          }}
                        >
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
                          setMySelectedMonth('all');
                          setMyToDate(e.target.value);
                          setMyShiftPage(0);
                        }}
                        style={{
                          width: '100%',
                          padding: '8px 12px',
                          borderRadius: '12px',
                          backgroundColor: 'var(--surface-color)',
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
                          borderRadius: '12px',
                          backgroundColor: 'var(--surface-color)',
                          border: '1px solid var(--border-color)',
                          color: 'var(--text-color)',
                          fontSize: '14px',
                          minHeight: '44px',
                          boxSizing: 'border-box',
                        }}
                      >
                        <option value="all">Tất cả trạng thái</option>
                        <option value="unreviewed">Chờ duyệt</option>
                        <option value="needs_review">
                          Cần xử lý / Giải trình
                        </option>
                        <option value="approved">Đã duyệt</option>
                        <option value="rejected">Bị từ chối</option>
                      </select>
                    </div>
                    {(mySelectedMonth !== 'all' ||
                      myFromDate ||
                      myToDate ||
                      myReviewStateFilter !== 'all') && (
                      <AppButton
                        variant="secondary"
                        className="clock-self-secondary-btn"
                        onClick={() => {
                          setMySelectedMonth('all');
                          setMyFromDate('');
                          setMyToDate('');
                          setMyReviewStateFilter('all');
                          setMyShiftPage(0);
                        }}
                      >
                        Xóa lọc
                      </AppButton>
                    )}
                  </div>
                </div>
              </AppCard>

              {filteredRecentShifts.length === 0 ? (
                <EmptyState
                  title="Chưa có dữ liệu"
                  description="Không có ca làm việc nào phù hợp với tháng hoặc bộ lọc hiện tại."
                />
              ) : (
                <div className="clock-self-history-list">
                  {pagedRecentShifts.map((shift) => {
                    const dotColor =
                      shift.review_state === 'approved' || shift.is_self_shift
                        ? '#10b981'
                        : shift.review_state === 'rejected'
                          ? '#ef4444'
                          : '#d97706';
                    return (
                      <div key={shift.id} className="clock-self-history-item">
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: '10px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '12px',
                              minWidth: 0,
                              flex: '1 1 200px',
                            }}
                          >
                            <span
                              className="clock-self-dot"
                              style={{ backgroundColor: dotColor }}
                            />
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontWeight: 600,
                                  fontSize: '15px',
                                  color: 'var(--text-color)',
                                }}
                              >
                                {formatVnDate(shift.clock_in_at, {
                                  weekday: 'short',
                                  year: 'numeric',
                                  month: '2-digit',
                                  day: '2-digit',
                                })}
                              </div>
                              <div
                                style={{
                                  fontSize: '12.5px',
                                  color: 'var(--muted-color)',
                                  marginTop: '2px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                  gap: '6px',
                                }}
                              >
                                <span>
                                  {formatVnTimeShort(shift.clock_in_at)}
                                  {shift.clock_out_at
                                    ? ` – ${formatVnTimeShort(shift.clock_out_at)}`
                                    : ' (Đang mở)'}
                                </span>
                                {isOvernightShift(
                                  shift.clock_in_at,
                                  shift.clock_out_at,
                                ) && (
                                  <span
                                    data-testid="overnight-badge"
                                    style={{
                                      fontSize: '12px',
                                      padding: '2px 8px',
                                      borderRadius: '6px',
                                      backgroundColor:
                                        'rgba(139, 92, 246, 0.14)',
                                      color: 'var(--purple-text)',
                                      fontWeight: 500,
                                    }}
                                  >
                                    Ca qua đêm (+1 ngày)
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div
                            style={{
                              display: 'flex',
                              gap: '8px',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                            }}
                          >
                            <strong
                              style={{
                                fontSize: '14px',
                                color: 'var(--text-color)',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {formatHoursMinutes(shift.worked_seconds)}
                            </strong>
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
                              backgroundColor: 'var(--surface-subtle)',
                              padding: '6px 10px',
                              borderRadius: '8px',
                              marginLeft: '22px',
                              overflowWrap: 'anywhere',
                              wordBreak: 'break-word',
                            }}
                          >
                            Ghi chú duyệt:{' '}
                            <em>
                              "{formatReviewNoteLabel(shift.review_reason)}"
                            </em>
                            {shift.reviewed_at &&
                              ` • ${formatVnDate(shift.reviewed_at)} ${formatVnTimeShort(shift.reviewed_at)}`}
                          </div>
                        )}

                        {(shift.breaks.length > 0 ||
                          (shift.run_state === 'completed' &&
                            !shift.pending_correction)) && (
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontSize: '12px',
                              color: 'var(--muted-color)',
                              marginLeft: '22px',
                            }}
                          >
                            <span>
                              {shift.breaks.length > 0
                                ? `${shift.breaks.length} lần nghỉ`
                                : ''}
                            </span>
                            {shift.run_state === 'completed' &&
                              !shift.pending_correction && (
                                <button
                                  type="button"
                                  data-testid="shift-correction-btn"
                                  className="clock-self-link-btn"
                                  onClick={() => {
                                    setTargetShiftForCorrection(shift);
                                    setClaimedClockOut(
                                      toVnDateTimeLocalValue(
                                        shift.clock_out_at ||
                                          new Date().toISOString(),
                                      ),
                                    );
                                    setShowCorrectionModal(true);
                                  }}
                                >
                                  Giải trình / Sửa giờ
                                </button>
                              )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {filteredRecentShifts.length > 0 && (
                <div style={{ marginTop: '8px' }}>
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
        </div>
      ) : (
        /* Owner Review & History Tab */
        <div>
          {/* Single Compact Top Control Bar */}
          <div
            data-testid="owner-month-selector-bar"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
              marginBottom: '14px',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
              }}
            >
              <div
                data-testid="owner-attendance-view-switcher"
                style={{
                  display: 'inline-flex',
                  gap: '4px',
                  padding: '3px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <button
                  type="button"
                  data-testid="attendance-view-by-employee"
                  onClick={() => setOwnerViewMode('by_employee')}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor:
                      ownerViewMode === 'by_employee'
                        ? 'rgba(20, 184, 166, 0.16)'
                        : 'transparent',
                    color:
                      ownerViewMode === 'by_employee'
                        ? 'var(--accent-text)'
                        : 'var(--muted-color)',
                    fontSize: '12.5px',
                    fontWeight: ownerViewMode === 'by_employee' ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  Theo từng nhân viên ({groupedOwnerShiftsByEmployee.length})
                </button>
                <button
                  type="button"
                  data-testid="attendance-view-by-shift"
                  onClick={() => setOwnerViewMode('by_shift')}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor:
                      ownerViewMode === 'by_shift'
                        ? 'rgba(20, 184, 166, 0.16)'
                        : 'transparent',
                    color:
                      ownerViewMode === 'by_shift'
                        ? 'var(--accent-text)'
                        : 'var(--muted-color)',
                    fontSize: '12.5px',
                    fontWeight: ownerViewMode === 'by_shift' ? 700 : 500,
                    cursor: 'pointer',
                  }}
                >
                  Theo từng ca ({filteredOwnerShifts.length})
                </button>
              </div>

              <select
                aria-label="Chọn tháng chấm công nhân sự"
                value={ownerSelectedMonth}
                onChange={(e) => {
                  const val = e.target.value;
                  setOwnerSelectedMonth(val || 'all');
                  setEmployeeSelectedMonths({});
                  setSelectedDate('');
                  setSelectedToDate('');
                  setShiftPage(0);
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--surface-color)',
                  color: 'var(--text-color)',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <option value="all">
                  Tất cả các tháng ({ownerShifts.length} ca)
                </option>
                {ownerAvailableMonths
                  .filter((m) => m.count > 0 || m.ym === currentVnYearMonth)
                  .map((mItem) => (
                    <option key={mItem.ym} value={mItem.ym}>
                      {formatYearMonthLabel(mItem.ym)} ({mItem.count} ca
                      {mItem.totalSeconds > 0
                        ? ` • ${formatHoursMinutes(mItem.totalSeconds)}`
                        : ''}
                      )
                    </option>
                  ))}
              </select>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
              }}
            >
              {groupedOwnerShiftsByEmployee.length > 0 && (
                <button
                  type="button"
                  data-testid="export-attendance-summary-csv"
                  onClick={handleExportAttendanceSummaryCsv}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--surface-subtle)',
                    color: 'var(--text-color)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <DownloadIcon size={14} />
                  <span>
                    Xuất CSV
                    <span className="mobile-hide-label"> tổng hợp công</span>
                  </span>
                </button>
              )}

              <button
                type="button"
                data-testid="goto-payroll-reconcile"
                onClick={() => {
                  if (onNavigate) {
                    onNavigate('/payroll');
                  } else if (typeof window !== 'undefined') {
                    window.location.href = '/payroll';
                  }
                }}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid rgba(20, 184, 166, 0.35)',
                  backgroundColor: 'rgba(20, 184, 166, 0.12)',
                  color: 'var(--accent-text)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <span>
                  <span className="mobile-hide-label">Đối soát </span>Bảng lương
                  →
                </span>
              </button>

              <button
                type="button"
                onClick={() => setShowOwnerAdvancedFilters((v) => !v)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border:
                    showOwnerAdvancedFilters ||
                    selectedEmployeeId !== 'all' ||
                    selectedDate ||
                    selectedToDate ||
                    selectedReviewState !== 'all' ||
                    selectedRunState !== 'all'
                      ? '1px solid #14B8A6'
                      : '1px solid var(--border-color)',
                  backgroundColor:
                    showOwnerAdvancedFilters ||
                    selectedEmployeeId !== 'all' ||
                    selectedDate ||
                    selectedToDate ||
                    selectedReviewState !== 'all' ||
                    selectedRunState !== 'all'
                      ? 'rgba(20, 184, 166, 0.14)'
                      : 'var(--surface-subtle)',
                  color:
                    showOwnerAdvancedFilters ||
                    selectedEmployeeId !== 'all' ||
                    selectedDate ||
                    selectedToDate ||
                    selectedReviewState !== 'all' ||
                    selectedRunState !== 'all'
                      ? 'var(--accent-text)'
                      : 'var(--muted-color)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <span>
                  {showOwnerAdvancedFilters ? '▴ Ẩn bộ lọc' : '▾ Bộ lọc'}
                </span>
              </button>
            </div>
          </div>

          {/* Collapsible Advanced Filters (Hidden by default on both Desktop & Mobile) */}
          <div
            style={{
              display: showOwnerAdvancedFilters ? 'block' : 'none',
            }}
          >
            {/* Quick Status Filter Pills */}
            <div
              data-testid="owner-review-quick-tabs"
              style={{
                display: 'flex',
                gap: '6px',
                flexWrap: 'nowrap',
                overflowX: 'auto',
                paddingBottom: '4px',
                marginBottom: '10px',
                scrollbarWidth: 'none',
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
                    padding: '6px 12px',
                    borderRadius: '999px',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    minHeight: '34px',
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    border:
                      selectedReviewState === pill.id
                        ? '1px solid #14B8A6'
                        : '1px solid var(--border-color)',
                    backgroundColor:
                      selectedReviewState === pill.id
                        ? 'rgba(20, 184, 166, 0.16)'
                        : 'var(--surface-color)',
                    color:
                      selectedReviewState === pill.id
                        ? 'var(--accent-text)'
                        : 'var(--muted-color)',
                  }}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            {employeeOptions.length > 0 && (
              <div
                data-testid="quick-employee-filter-chips"
                style={{
                  display: 'flex',
                  gap: '6px',
                  flexWrap: 'nowrap',
                  overflowX: 'auto',
                  alignItems: 'center',
                  paddingBottom: '4px',
                  marginBottom: '12px',
                  scrollbarWidth: 'none',
                }}
              >
                <span
                  className="mobile-hide-label"
                  style={{
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Nhân sự:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedEmployeeId('all');
                    setShiftPage(0);
                  }}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '999px',
                    border:
                      selectedEmployeeId === 'all'
                        ? '1px solid #14B8A6'
                        : '1px solid var(--border-color)',
                    backgroundColor:
                      selectedEmployeeId === 'all'
                        ? 'rgba(20, 184, 166, 0.16)'
                        : 'var(--surface-color)',
                    color:
                      selectedEmployeeId === 'all'
                        ? 'var(--accent-text)'
                        : 'var(--text-secondary)',
                    fontSize: '12px',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    cursor: 'pointer',
                  }}
                >
                  Tất cả NV ({employeeOptions.length})
                </button>
                {employeeOptions.map((emp) => {
                  const isSelected = selectedEmployeeId === emp.id;
                  return (
                    <button
                      key={emp.id}
                      type="button"
                      onClick={() => {
                        setSelectedEmployeeId(isSelected ? 'all' : emp.id);
                        setShiftPage(0);
                      }}
                      style={{
                        padding: '5px 10px',
                        borderRadius: '999px',
                        border: isSelected
                          ? '1px solid #14B8A6'
                          : '1px solid var(--border-color)',
                        backgroundColor: isSelected
                          ? 'rgba(20, 184, 166, 0.16)'
                          : 'var(--surface-color)',
                        color: isSelected
                          ? 'var(--accent-text)'
                          : 'var(--text-secondary)',
                        fontSize: '12px',
                        fontWeight: isSelected ? 700 : 500,
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        cursor: 'pointer',
                      }}
                    >
                      {emp.full_name} ({emp.employee_code})
                    </button>
                  );
                })}
              </div>
            )}

            {/* Filter Bar */}
            <AppCard
              data-testid="owner-shifts-filter-bar"
              style={{ marginBottom: '16px', padding: '14px' }}
            >
              {employeesError && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    marginBottom: '12px',
                    backgroundColor: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
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
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      minHeight: '36px',
                      minWidth: '44px',
                    }}
                  >
                    {employeesLoading ? 'Đang tải…' : 'Thử lại'}
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
                      fontSize: '12px',
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
                    {employeeOptions.map((emp) => (
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
                    <span
                      style={{
                        color: 'var(--accent-text)',
                        fontWeight: 500,
                        fontSize: '12px',
                      }}
                    >
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
                    <span
                      style={{
                        color: 'var(--accent-text)',
                        fontWeight: 500,
                        fontSize: '12px',
                      }}
                    >
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
          </div>

          {ownerLoading ? (
            <LoadingState message="Đang tải danh sách ca làm việc…" />
          ) : filteredOwnerShifts.length === 0 ? (
            <EmptyState
              title="Không tìm thấy ca làm"
              description="Không có ca làm việc nào phù hợp với bộ lọc."
            />
          ) : ownerViewMode === 'by_employee' ? (
            <div
              data-testid="owner-shifts-grouped-by-employee"
              style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
            >
              {groupedOwnerShiftsByEmployee.map((group) => {
                const isCollapsed = collapsedEmployeeIds.has(group.employeeId);
                const defaultEmpYm =
                  ownerSelectedMonth !== 'all'
                    ? 'all'
                    : group.monthsBreakdown.length > 1
                      ? group.monthsBreakdown[0]?.ym || 'all'
                      : 'all';
                const empSelectedYm =
                  employeeSelectedMonths[group.employeeId] || defaultEmpYm;
                const empActiveShifts =
                  empSelectedYm === 'all'
                    ? group.shifts
                    : group.shifts.filter(
                        (s) =>
                          getShiftYearMonth(s.clock_in_at) === empSelectedYm,
                      );
                const empTotalWorkedSeconds = empActiveShifts.reduce(
                  (acc, s) => acc + (s.worked_seconds || 0),
                  0,
                );
                const empApprovedCount = empActiveShifts.filter(
                  (s) =>
                    s.review_state === 'approved' || Boolean(s.is_self_shift),
                ).length;
                const isExpandedAllShifts = expandedShiftListEmployeeIds.has(
                  group.employeeId,
                );
                const VISIBLE_SHIFT_LIMIT = 5;
                const sortedEmpShifts = [...empActiveShifts].sort((a, b) => {
                  const aPending = isActionablePending(a) ? 1 : 0;
                  const bPending = isActionablePending(b) ? 1 : 0;
                  if (bPending !== aPending) return bPending - aPending;
                  return (
                    new Date(b.clock_in_at).getTime() -
                    new Date(a.clock_in_at).getTime()
                  );
                });
                const visibleEmpShifts = isExpandedAllShifts
                  ? sortedEmpShifts
                  : sortedEmpShifts.slice(0, VISIBLE_SHIFT_LIMIT);
                const hiddenShiftCount = Math.max(
                  0,
                  sortedEmpShifts.length - visibleEmpShifts.length,
                );
                const activeMonthDisplayLabel =
                  empSelectedYm !== 'all'
                    ? formatYearMonthLabel(empSelectedYm)
                    : ownerSelectedMonth !== 'all'
                      ? formatYearMonthLabel(ownerSelectedMonth)
                      : group.monthsBreakdown.length === 1
                        ? formatYearMonthLabel(
                            group.monthsBreakdown[0]?.ym || '',
                          )
                        : 'Tất cả các tháng';

                return (
                  <AppCard
                    key={group.employeeId}
                    data-testid={`employee-shift-group-${group.employeeId}`}
                    style={{ padding: '14px' }}
                  >
                    {/* Employee Card Top Header */}
                    <div
                      onClick={() => {
                        setCollapsedEmployeeIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(group.employeeId)) {
                            next.delete(group.employeeId);
                          } else {
                            next.add(group.employeeId);
                          }
                          return next;
                        });
                      }}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '10px',
                        cursor: 'pointer',
                        paddingBottom: isCollapsed ? 0 : '10px',
                        marginBottom: isCollapsed ? 0 : '10px',
                        borderBottom: isCollapsed
                          ? 'none'
                          : '1px solid var(--border-subtle)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          flexWrap: 'nowrap',
                          minWidth: 0,
                          flex: '1 1 220px',
                        }}
                      >
                        <div
                          style={{
                            minWidth: '54px',
                            height: '32px',
                            padding: '0 10px',
                            borderRadius: '8px',
                            backgroundColor: 'rgba(20, 184, 166, 0.14)',
                            border: '1px solid rgba(20, 184, 166, 0.32)',
                            color: 'var(--accent-text)',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: '12px',
                            letterSpacing: '0.02em',
                            whiteSpace: 'nowrap',
                            flexShrink: 0,
                          }}
                        >
                          {group.employeeCode}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              fontWeight: 700,
                              fontSize: '15px',
                              color: 'var(--text-color)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {group.employeeName}
                          </div>
                          <div
                            style={{
                              fontSize: '12px',
                              color: 'var(--muted-color)',
                              marginTop: '3px',
                              display: 'flex',
                              gap: '6px',
                              flexWrap: 'wrap',
                              alignItems: 'center',
                            }}
                          >
                            <span>
                              <strong style={{ color: 'var(--text-color)' }}>
                                {empActiveShifts.length} ca
                              </strong>
                            </span>
                            <span>•</span>
                            <span>
                              Tổng:{' '}
                              <strong style={{ color: 'var(--accent-text)' }}>
                                {formatHoursMinutes(empTotalWorkedSeconds)}
                              </strong>
                            </span>
                            <span>•</span>
                            <span>
                              Duyệt:{' '}
                              <strong style={{ color: 'var(--success-text)' }}>
                                {empApprovedCount}/{empActiveShifts.length}
                              </strong>
                            </span>
                          </div>
                        </div>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          flexWrap: 'wrap',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Clean Single Dropdown for Employee's Month */}
                        <select
                          data-testid={`employee-month-selector-${group.employeeId}`}
                          aria-label={`Chọn tháng cho ${group.employeeName}`}
                          value={empSelectedYm}
                          onChange={(e) =>
                            setEmployeeSelectedMonths((prev) => ({
                              ...prev,
                              [group.employeeId]: e.target.value,
                            }))
                          }
                          style={{
                            padding: '5px 10px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-color)',
                            color: 'var(--text-color)',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {group.monthsBreakdown.map((m) => (
                            <option key={m.ym} value={m.ym}>
                              {formatYearMonthLabel(m.ym)} ({m.count} ca •{' '}
                              {formatHoursMinutes(m.totalSeconds)})
                            </option>
                          ))}
                          {group.monthsBreakdown.length > 1 && (
                            <option value="all">
                              Tất cả các tháng ({group.shifts.length} ca •{' '}
                              {formatHoursMinutes(group.totalWorkedSeconds)})
                            </option>
                          )}
                        </select>

                        {group.workingCount > 0 && (
                          <StatusBadge status="success" label="Đang trong ca" />
                        )}
                        {group.pendingCount > 0 && (
                          <StatusBadge
                            status="warning"
                            label={`${group.pendingCount} chờ xử lý`}
                          />
                        )}
                        {group.shifts.some((s) =>
                          isActionableUnreviewed(s),
                        ) && (
                          <button
                            type="button"
                            data-testid={`approve-all-employee-shifts-${group.employeeId}`}
                            onClick={() =>
                              handleApproveAllEmployeeShifts(group)
                            }
                            disabled={ownerLoading}
                            style={{
                              padding: '5px 10px',
                              borderRadius: '6px',
                              border: '1px solid rgba(16, 185, 129, 0.4)',
                              backgroundColor: 'rgba(16, 185, 129, 0.14)',
                              color: 'var(--success-text)',
                              fontSize: '12px',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            ✓ Duyệt nhanh{' '}
                            {
                              group.shifts.filter((s) =>
                                isActionableUnreviewed(s),
                              ).length
                            }{' '}
                            ca
                          </button>
                        )}
                        <button
                          type="button"
                          className="mobile-hide-label"
                          data-testid={`employee-payroll-link-${group.employeeId}`}
                          onClick={() => {
                            if (onNavigate) {
                              onNavigate('/payroll');
                            } else if (typeof window !== 'undefined') {
                              window.location.href = '/payroll';
                            }
                          }}
                          style={{
                            padding: '5px 10px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--surface-subtle)',
                            color: 'var(--accent-text)',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          Bảng lương →
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCollapsedEmployeeIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(group.employeeId)) {
                                next.delete(group.employeeId);
                              } else {
                                next.add(group.employeeId);
                              }
                              return next;
                            });
                          }}
                          style={{
                            padding: '5px 10px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            backgroundColor: 'var(--surface-subtle)',
                            color: 'var(--text-secondary)',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {isCollapsed
                            ? `▾ Xem ${empActiveShifts.length} ca`
                            : '▴ Thu gọn'}
                        </button>
                      </div>
                    </div>

                    {!isCollapsed && (
                      <div>
                        {/* Shift Rows List */}
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                          }}
                        >
                          {visibleEmpShifts.map((shift) => {
                            const isImportedTimesheet =
                              Boolean(shift.review_reason) &&
                              /^imported from timesheet$/i.test(
                                (shift.review_reason || '').trim(),
                              );
                            return (
                              <div
                                key={shift.id}
                                style={{
                                  padding: '10px 12px',
                                  borderRadius: '8px',
                                  backgroundColor: 'var(--bg-color)',
                                  border: '1px solid var(--border-subtle)',
                                  minWidth: 0,
                                  maxWidth: '100%',
                                  boxSizing: 'border-box',
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    flexWrap: 'wrap',
                                    gap: '8px',
                                    minWidth: 0,
                                  }}
                                >
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '8px',
                                      flexWrap: 'wrap',
                                      minWidth: 0,
                                      flex: '1 1 210px',
                                    }}
                                  >
                                    <span
                                      style={{
                                        fontWeight: 600,
                                        fontSize: '13.5px',
                                        color: 'var(--text-color)',
                                      }}
                                    >
                                      {formatVnDate(shift.clock_in_at)} •{' '}
                                      {formatVnTimeShort(shift.clock_in_at)}
                                      {shift.clock_out_at
                                        ? ` – ${formatVnTimeShort(shift.clock_out_at)}`
                                        : ' (Đang mở)'}
                                    </span>
                                    <span
                                      style={{
                                        fontSize: '12px',
                                        padding: '2px 8px',
                                        borderRadius: '6px',
                                        backgroundColor:
                                          'rgba(20, 184, 166, 0.12)',
                                        color: 'var(--accent-text)',
                                        fontWeight: 700,
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      {formatHoursMinutes(shift.worked_seconds)}
                                    </span>
                                    {isOvernightShift(
                                      shift.clock_in_at,
                                      shift.clock_out_at,
                                    ) && (
                                      <span
                                        style={{
                                          fontSize: '12px',
                                          padding: '2px 7px',
                                          borderRadius: '4px',
                                          backgroundColor:
                                            'rgba(139, 92, 246, 0.18)',
                                          color: 'var(--purple-text)',
                                          fontWeight: 500,
                                          whiteSpace: 'nowrap',
                                        }}
                                      >
                                        Ca qua đêm (+1 ngày)
                                      </span>
                                    )}
                                    {isImportedTimesheet && (
                                      <span
                                        style={{
                                          fontSize: '12px',
                                          padding: '2px 7px',
                                          borderRadius: '4px',
                                          backgroundColor:
                                            'var(--surface-subtle)',
                                          border:
                                            '1px solid var(--border-subtle)',
                                          color: 'var(--muted-color)',
                                          fontWeight: 500,
                                          whiteSpace: 'nowrap',
                                        }}
                                      >
                                        Bảng công Excel
                                      </span>
                                    )}
                                  </div>

                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '6px',
                                      flexWrap: 'wrap',
                                    }}
                                  >
                                    <StatusBadge
                                      status={
                                        shift.review_state === 'approved' ||
                                        shift.is_self_shift
                                          ? 'success'
                                          : shift.review_state === 'rejected'
                                            ? 'error'
                                            : shift.review_state ===
                                                'needs_review'
                                              ? 'warning'
                                              : 'neutral'
                                      }
                                      label={
                                        shift.is_self_shift
                                          ? 'Ca Chủ sở hữu'
                                          : shift.review_state === 'approved'
                                            ? 'Đã duyệt'
                                            : shift.review_state === 'rejected'
                                              ? 'Đã từ chối'
                                              : shift.review_state ===
                                                  'needs_review'
                                                ? 'Cần giải trình'
                                                : 'Chờ duyệt'
                                      }
                                    />
                                    {shift.run_state !== 'completed' &&
                                      !shift.pending_correction && (
                                        <AppButton
                                          variant="primary"
                                          onClick={() =>
                                            handleOwnerCloseShift(shift)
                                          }
                                          style={{
                                            minHeight: '32px',
                                            padding: '4px 10px',
                                            fontSize: '12px',
                                          }}
                                        >
                                          <CheckIcon size={13} /> Đóng & Xác
                                          nhận
                                        </AppButton>
                                      )}
                                    {shift.run_state === 'completed' &&
                                      shift.review_state === 'unreviewed' &&
                                      !shift.pending_correction &&
                                      !shift.is_self_shift &&
                                      shift.is_payroll_eligible !== false && (
                                        <>
                                          <AppButton
                                            variant="secondary"
                                            onClick={() =>
                                              handleReviewShift(
                                                shift,
                                                'rejected',
                                              )
                                            }
                                            style={{
                                              minHeight: '32px',
                                              padding: '4px 10px',
                                              fontSize: '12px',
                                            }}
                                          >
                                            Từ chối
                                          </AppButton>
                                          <AppButton
                                            variant="primary"
                                            onClick={() =>
                                              handleReviewShift(
                                                shift,
                                                'approved',
                                              )
                                            }
                                            style={{
                                              minHeight: '32px',
                                              padding: '4px 10px',
                                              fontSize: '12px',
                                            }}
                                          >
                                            <CheckIcon size={13} /> Duyệt ca
                                          </AppButton>
                                        </>
                                      )}
                                  </div>
                                </div>

                                {shift.review_reason &&
                                  !isImportedTimesheet && (
                                    <div
                                      style={{
                                        fontSize: '12px',
                                        color: 'var(--muted-color)',
                                        marginTop: '6px',
                                        lineHeight: 1.45,
                                        whiteSpace: 'normal',
                                        overflowWrap: 'anywhere',
                                        wordBreak: 'break-word',
                                      }}
                                    >
                                      Ghi chú duyệt:{' '}
                                      <em>
                                        "
                                        {formatReviewNoteLabel(
                                          shift.review_reason,
                                        )}
                                        "
                                      </em>
                                      {shift.reviewed_at
                                        ? ` • ${formatVnDate(shift.reviewed_at)} ${formatVnTimeShort(shift.reviewed_at)}`
                                        : ''}
                                    </div>
                                  )}

                                {shift.pending_correction && (
                                  <div
                                    style={{
                                      marginTop: '8px',
                                      padding: '10px 12px',
                                      backgroundColor:
                                        'rgba(245, 158, 11, 0.1)',
                                      borderLeft: '3px solid #F59E0B',
                                      borderRadius: '6px',
                                      fontSize: '12.5px',
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
                                      <AlertTriangleIcon size={14} /> Đơn giải
                                      trình chấm công từ nhân viên
                                    </div>
                                    <div
                                      style={{
                                        color: 'var(--text-color)',
                                        marginBottom: '4px',
                                      }}
                                    >
                                      Lý do:{' '}
                                      <em>
                                        "{shift.pending_correction.reason}"
                                      </em>
                                    </div>
                                    {shift.pending_correction
                                      .claimed_clock_out_at && (
                                      <div
                                        style={{ color: 'var(--muted-color)' }}
                                      >
                                        Giờ báo kết thúc:{' '}
                                        {formatVnDate(
                                          shift.pending_correction
                                            .claimed_clock_out_at,
                                        )}{' '}
                                        {formatVnTimeShort(
                                          shift.pending_correction
                                            .claimed_clock_out_at,
                                        )}
                                      </div>
                                    )}
                                    {shift.pending_correction.evidence_note && (
                                      <div
                                        style={{ color: 'var(--muted-color)' }}
                                      >
                                        Minh chứng:{' '}
                                        {shift.pending_correction.evidence_note}
                                      </div>
                                    )}
                                    <div
                                      style={{
                                        display: 'flex',
                                        gap: '8px',
                                        marginTop: '8px',
                                        flexWrap: 'wrap',
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
                                        style={{
                                          minHeight: '32px',
                                          padding: '4px 10px',
                                          fontSize: '12px',
                                        }}
                                      >
                                        <CheckIcon size={13} /> Chấp nhận điều
                                        chỉnh
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
                                        style={{
                                          minHeight: '32px',
                                          padding: '4px 10px',
                                          fontSize: '12px',
                                        }}
                                      >
                                        <CloseIcon size={13} /> Từ chối
                                      </AppButton>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {/* Expand / Collapse More Shifts Button inside Employee Card */}
                        {sortedEmpShifts.length > VISIBLE_SHIFT_LIMIT && (
                          <button
                            type="button"
                            data-testid={`toggle-more-shifts-${group.employeeId}`}
                            onClick={() => {
                              setExpandedShiftListEmployeeIds((prev) => {
                                const next = new Set(prev);
                                if (next.has(group.employeeId)) {
                                  next.delete(group.employeeId);
                                } else {
                                  next.add(group.employeeId);
                                }
                                return next;
                              });
                            }}
                            style={{
                              width: '100%',
                              marginTop: '10px',
                              padding: '8px 12px',
                              borderRadius: '8px',
                              border: '1px dashed var(--border-color)',
                              backgroundColor: 'var(--surface-subtle)',
                              color: 'var(--accent-text)',
                              fontSize: '12.5px',
                              fontWeight: 600,
                              cursor: 'pointer',
                              textAlign: 'center',
                            }}
                          >
                            {isExpandedAllShifts
                              ? `▴ Thu gọn danh sách ca của ${group.employeeName} (Chỉ hiện ${VISIBLE_SHIFT_LIMIT} ca mới nhất)`
                              : `▾ Xem thêm ${hiddenShiftCount} ca trong ${activeMonthDisplayLabel} (Tổng ${sortedEmpShifts.length} ca)`}
                          </button>
                        )}
                      </div>
                    )}
                  </AppCard>
                );
              })}
            </div>
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
                                fontSize: '12px',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                backgroundColor: 'rgba(139, 92, 246, 0.18)',
                                color: 'var(--purple-text)',
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
                          backgroundColor: 'rgba(245, 158, 11, 0.1)',
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
                        <div
                          style={{
                            color: 'var(--text-color)',
                            marginBottom: '4px',
                          }}
                        >
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
                          <span
                            style={{
                              fontSize: '12px',
                              color: 'var(--muted-color)',
                            }}
                          >
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
                  placeholder="Ví dụ: Quên bấm kết thúc ca lúc 18:00 do hỗ trợ khách hàng…"
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
                  placeholder="Ví dụ: Đã báo trực tiếp với Quản trị viên…"
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
          description={
            role === 'owner'
              ? 'Bạn có chắc chắn muốn kết thúc ca làm việc này? Ca làm của Chủ sở hữu sẽ được lưu và tự động ghi nhận.'
              : 'Bạn có chắc chắn muốn kết thúc ca làm việc này? Dữ liệu ca làm sẽ được lưu và chuyển sang trạng thái chờ duyệt.'
          }
          confirmLabel="Kết thúc ca"
          cancelLabel="Hủy"
          onConfirm={executeClockOut}
          confirmVariant="primary"
          isLoading={dialogLoading}
        />
      )}

      {clockActionDialog?.type === 'reset_today' && (
        <AppDialog
          isOpen
          onClose={() => !dialogLoading && setClockActionDialog(null)}
          title="Đặt lại chấm công để bắt đầu từ hôm nay"
          description={
            role === 'owner'
              ? 'Thao tác này sẽ đóng và xóa các ca bấm giờ thử nghiệm hoặc ca đang treo trên web để bắt đầu làm việc mới từ hôm nay. Toàn bộ 61 ca bảng công Google Sheet của NV001 (Tháng 6 – Tháng 11) và các kỳ lương đã chốt vẫn được giữ nguyên 100%.'
              : 'Thao tác này sẽ xóa các ca bấm giờ thử nghiệm trong ngày hôm nay hoặc ca đang mở của bạn để bắt đầu làm việc mới từ hôm nay.'
          }
          confirmLabel="Xác nhận đặt lại"
          cancelLabel="Hủy"
          onConfirm={() => executeResetClockToday(clockActionDialog.scope)}
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
              placeholder="Ví dụ: Đúng giờ quy định…"
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
              placeholder="Nhập lý do từ chối…"
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
              placeholder="Nhập lý do từ chối…"
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
          onConfirm={() => {
            const parsedDt = clockActionDialog.time
              ? new Date(clockActionDialog.time)
              : null;
            const validIso =
              parsedDt && !Number.isNaN(parsedDt.getTime())
                ? parsedDt.toISOString()
                : undefined;
            executeDecideCorrection(
              clockActionDialog.crId,
              'accept',
              clockActionDialog.reason,
              validIso,
            );
          }}
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
                placeholder="Nhập ghi chú…"
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
