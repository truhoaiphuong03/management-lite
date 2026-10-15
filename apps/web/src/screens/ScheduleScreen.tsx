import React, { useState, useEffect, useRef } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  StatusBadge,
  LoadingState,
  EmptyState,
  CalendarIcon,
  ClockIcon,
  CheckIcon,
  CloseIcon,
  UserIcon,
  RotateCcwIcon,
  EyeIcon,
  InfoIcon,
} from '@management-lite/ui/components';
import type { UserRole } from '../types.js';
import type {
  ScheduleData,
  ScheduleEntryData,
  ScheduleRevisionData,
  ScheduleDetailResponseData,
  CreateScheduleRequest,
  UpdateScheduleRequest,
} from '../../../../packages/contracts/src/schedules.js';
import type { EmployeeData } from '../../../../packages/contracts/src/employees.js';

export interface ScheduleScreenProps {
  role?: UserRole;
  onNavigate?: (path: string) => void;
}

interface DayFormItem {
  dateStr: string; // YYYY-MM-DD
  dayLabel: string; // Thứ Hai, Thứ Ba...
  dayIndex: number; // 1 = Monday, ..., 7 = Sunday
  isWorking: boolean;
  startTime: string; // HH:mm
  notes?: string; // Ghi chú công việc / ca
}

const VIETNAMESE_DAYS = [
  'Thứ Hai',
  'Thứ Ba',
  'Thứ Tư',
  'Thứ Năm',
  'Thứ Sáu',
  'Thứ Bảy',
  'Chủ Nhật',
];

// Helper: Formats a Date object to YYYY-MM-DD in local time
function formatDateIso(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper: Formats YYYY-MM-DD to DD/MM/YYYY
function formatDateDisplay(isoDate: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// Helper: Given any Date, return the Date of Monday for that week
function getMondayOfWeek(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay(); // 0 is Sunday, 1 is Monday ... 6 is Saturday
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(date.setDate(diff));
  mon.setHours(0, 0, 0, 0);
  return mon;
}

// Helper: Build the 7 days of the week starting from Monday YYYY-MM-DD
function buildWeekDays(
  mondayIso: string,
): { dateStr: string; dayLabel: string; dayIndex: number }[] {
  const parts = mondayIso.split('-').map(Number);
  const mon = new Date(parts[0]!, parts[1]! - 1, parts[2]!);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    days.push({
      dateStr: formatDateIso(d),
      dayLabel: VIETNAMESE_DAYS[i]!,
      dayIndex: i + 1, // 1=Mon .. 7=Sun
    });
  }
  return days;
}

export const ScheduleScreen: React.FC<ScheduleScreenProps> = ({
  role = 'owner',
}) => {
  // Current selected week's Monday (default to next week per SCHEDULE-01 R09)
  const [selectedMonday, setSelectedMonday] = useState<string>(() => {
    const today = new Date();
    const nextWeekDate = new Date(today);
    nextWeekDate.setDate(today.getDate() + 7);
    return formatDateIso(getMondayOfWeek(nextWeekDate));
  });

  // CSRF token
  const [csrfToken, setCsrfToken] = useState<string>('');

  const isAdminOrOwner = role === 'admin' || role === 'owner';
  const [activeTab, setActiveTab] = useState<'my_schedule' | 'staff_schedules'>(
    'my_schedule',
  );

  // Staff / Self schedule state
  const [mySchedule, setMySchedule] = useState<ScheduleData | null>(null);
  const [myEntries, setMyEntries] = useState<ScheduleEntryData[]>([]);
  const [myRevisions, setMyRevisions] = useState<ScheduleRevisionData[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState<boolean>(true);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editReason, setEditReason] = useState<string>('');
  const [dayEntries, setDayEntries] = useState<DayFormItem[]>([]);

  // Revisions modal
  const [showHistoryModal, setShowHistoryModal] = useState<boolean>(false);

  // Owner / Admin state
  const [allSchedules, setAllSchedules] = useState<ScheduleData[]>([]);
  const [employees, setEmployees] = useState<EmployeeData[]>([]);
  const [filterEmployeeId, setFilterEmployeeId] = useState<string>('all');
  const [ownerDetailSchedule, setOwnerDetailSchedule] =
    useState<ScheduleData | null>(null);
  const [ownerDetailRevisions, setOwnerDetailRevisions] = useState<
    ScheduleRevisionData[]
  >([]);
  const [showOwnerDetailModal, setShowOwnerDetailModal] =
    useState<boolean>(false);

  // General feedback
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Q65-05: Multi-page employee selector generation and abort management
  const employeesFetchIdRef = useRef<number>(0);
  const employeesAbortControllerRef = useRef<AbortController | null>(null);

  // Initialize CSRF and initial data
  useEffect(() => {
    const controller = new AbortController();
    initAuthAndData(controller.signal);
    return () => {
      controller.abort();
      employeesAbortControllerRef.current?.abort();
    };
  }, [role]);

  // When selected week or active tab changes, re-fetch
  useEffect(() => {
    if (!isAdminOrOwner || activeTab === 'my_schedule') {
      fetchStaffSchedule(selectedMonday);
    } else {
      fetchOwnerSchedules(selectedMonday);
    }
  }, [selectedMonday, role, activeTab]);

  const initAuthAndData = async (signal?: AbortSignal) => {
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

      if (isAdminOrOwner) {
        await fetchEmployees(signal);
      }
    } catch {
      // Ignore transport errors on mount
    }
  };

  const fetchEmployees = async (externalSignal?: AbortSignal) => {
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
        if (!res.ok) break;
        const body = await res.json();
        if (isAborted()) return;
        const items: EmployeeData[] = body.data?.items || [];
        for (const item of items) {
          if (!seenIds.has(item.id)) {
            seenIds.add(item.id);
            all.push(item);
          }
        }
        cursor = body.data?.next_cursor || null;
        if (cursor) {
          if (seenCursors.has(cursor)) break;
          seenCursors.add(cursor);
        }
        if (!cursor || items.length === 0) break;
      }

      if (isAborted()) return;
      setEmployees(all);
    } catch {
      // Ignored
    }
  };

  // Staff: Fetch my schedule for the selected week
  const fetchStaffSchedule = async (mondayIso: string) => {
    setScheduleLoading(true);
    setErrorMessage(null);
    setIsEditing(false);
    setEditReason('');
    try {
      const res = await fetch(
        `/api/v1/schedules/me?week_start_date=${mondayIso}`,
        {
          credentials: 'include',
        },
      );
      if (res.ok) {
        const body = await res.json();
        const data: ScheduleDetailResponseData = body.data;
        if (data && data.schedule && data.schedule.id) {
          setMySchedule(data.schedule);
          setMyEntries(data.entries || []);
          setMyRevisions(data.revisions || []);
          initFormFromEntries(data.entries || [], mondayIso);
        } else {
          setMySchedule(null);
          setMyEntries([]);
          setMyRevisions([]);
          initFormFromEntries([], mondayIso);
        }
      } else {
        setMySchedule(null);
        setMyEntries([]);
        setMyRevisions([]);
        initFormFromEntries([], mondayIso);
      }
    } catch {
      setErrorMessage('Không thể tải lịch làm việc.');
    } finally {
      setScheduleLoading(false);
    }
  };

  // Owner: Fetch all staff schedules for the selected week
  const fetchOwnerSchedules = async (mondayIso: string) => {
    setScheduleLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch(
        `/api/v1/schedules?week_start_date=${mondayIso}`,
        {
          credentials: 'include',
        },
      );
      if (res.ok) {
        const body = await res.json();
        setAllSchedules(body.data?.items || []);
      }
    } catch {
      setErrorMessage('Không thể tải danh sách lịch nhân viên.');
    } finally {
      setScheduleLoading(false);
    }
  };

  // Pre-fill form from entries (or blank week)
  const initFormFromEntries = (
    entries: ScheduleEntryData[],
    mondayIso: string,
  ) => {
    const days = buildWeekDays(mondayIso);
    const entryMap = new Map<string, ScheduleEntryData>();
    for (const e of entries) {
      entryMap.set(e.work_date, e);
    }

    setDayEntries(
      days.map((d) => {
        const entry = entryMap.get(d.dateStr);
        return {
          dateStr: d.dateStr,
          dayLabel: d.dayLabel,
          dayIndex: d.dayIndex,
          isWorking: Boolean(entry),
          startTime:
            entry && entry.start_time ? entry.start_time.slice(0, 5) : '08:00',
          notes: entry?.notes || '',
        };
      }),
    );
  };

  // Week navigation helpers
  const handleShiftWeek = (offsetWeeks: number) => {
    const parts = selectedMonday.split('-').map(Number);
    const curr = new Date(parts[0]!, parts[1]! - 1, parts[2]!);
    curr.setDate(curr.getDate() + offsetWeeks * 7);
    setSelectedMonday(formatDateIso(curr));
  };

  const handleSelectThisWeek = () => {
    setSelectedMonday(formatDateIso(getMondayOfWeek(new Date())));
  };

  const handleSelectNextWeek = () => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    setSelectedMonday(formatDateIso(getMondayOfWeek(d)));
  };

  // Quick toggle all weekdays (Mon-Fri 08:00)
  const handleQuickSelectWeekdays = () => {
    setDayEntries((prev) =>
      prev.map((item, idx) => {
        if (idx < 5) {
          // Mon-Fri
          return { ...item, isWorking: true, startTime: '08:00' };
        }
        return { ...item, isWorking: false };
      }),
    );
  };

  const handleQuickClearAll = () => {
    setDayEntries((prev) =>
      prev.map((item) => ({ ...item, isWorking: false })),
    );
  };

  // Staff Submit Registration (POST /api/v1/schedules)
  const handleSubmitRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const workingDays = dayEntries.filter((d) => d.isWorking);
    for (const d of workingDays) {
      if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(d.startTime)) {
        setErrorMessage(
          `Giờ bắt đầu của ${d.dayLabel} (${d.startTime}) không hợp lệ (HH:mm, từ 00:00 đến 23:59).`,
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload: CreateScheduleRequest = {
        week_start_date: selectedMonday,
        entries: workingDays.map((d) => ({
          work_date: d.dateStr,
          day_of_week: d.dayIndex,
          start_time: d.startTime,
          ...(d.notes?.trim() ? { notes: d.notes.trim() } : {}),
        })),
      };

      const res = await fetch('/api/v1/schedules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(
          body.error?.message || 'Đăng ký lịch làm việc thất bại.',
        );
      }

      const data: ScheduleDetailResponseData = body.data;
      setSuccessMessage('Đăng ký lịch làm việc thành công!');
      setMySchedule(data.schedule);
      setMyEntries(data.entries || []);
      setMyRevisions(data.revisions || []);
      setIsEditing(false);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Lỗi khi gửi yêu cầu đăng ký lịch.';
      setErrorMessage(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // Staff Submit Update (PUT /api/v1/schedules/:id)
  const handleSubmitUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mySchedule) return;

    setErrorMessage(null);
    setSuccessMessage(null);

    const workingDays = dayEntries.filter((d) => d.isWorking);
    for (const d of workingDays) {
      if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(d.startTime)) {
        setErrorMessage(
          `Giờ bắt đầu của ${d.dayLabel} (${d.startTime}) không hợp lệ (HH:mm, từ 00:00 đến 23:59).`,
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload: UpdateScheduleRequest = {
        entries: workingDays.map((d) => ({
          work_date: d.dateStr,
          day_of_week: d.dayIndex,
          start_time: d.startTime,
          ...(d.notes?.trim() ? { notes: d.notes.trim() } : {}),
        })),
        ...(editReason.trim() ? { reason: editReason.trim() } : {}),
      };

      const res = await fetch(`/api/v1/schedules/${mySchedule.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken,
          'If-Match': `"${mySchedule.version}"`,
        },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(
          body.error?.message || 'Cập nhật lịch làm việc thất bại.',
        );
      }

      const data: ScheduleDetailResponseData = body.data;
      setSuccessMessage('Cập nhật lịch và lưu lịch sử điều chỉnh thành công!');
      setMySchedule(data.schedule);
      setMyEntries(data.entries || []);
      setMyRevisions(data.revisions || []);
      setIsEditing(false);
      setEditReason('');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Lỗi khi lưu điều chỉnh lịch.';
      setErrorMessage(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // Owner: View Schedule Detail & Revisions
  const handleOpenOwnerDetail = async (schedule: ScheduleData) => {
    setOwnerDetailSchedule(schedule);
    setShowOwnerDetailModal(true);
    try {
      const res = await fetch(`/api/v1/schedules/${schedule.id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const body = await res.json();
        const data: ScheduleDetailResponseData = body.data;
        setOwnerDetailRevisions(data.revisions || []);
      }
    } catch {
      // Ignored
    }
  };

  // Selected week range text
  const weekDays = buildWeekDays(selectedMonday);
  const sundayIso = weekDays[6]!.dateStr;
  const weekRangeLabel = `${formatDateDisplay(selectedMonday)} – ${formatDateDisplay(sundayIso)}`;

  return (
    <div
      style={{ maxWidth: '960px', margin: '0 auto', boxSizing: 'border-box' }}
    >
      <PageHeader
        title="Lịch làm việc"
        subtitle={
          !isAdminOrOwner || activeTab === 'my_schedule'
            ? 'Đăng ký và điều chỉnh lịch làm việc theo tuần'
            : 'Theo dõi lịch làm việc đã đăng ký của nhân sự'
        }
      />

      {/* Admin/Owner Tabs */}
      {isAdminOrOwner && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button
            type="button"
            onClick={() => setActiveTab('my_schedule')}
            style={{
              padding: '10px 18px',
              borderRadius: '8px',
              border:
                activeTab === 'my_schedule'
                  ? '1px solid #14B8A6'
                  : '1px solid #334155',
              backgroundColor:
                activeTab === 'my_schedule'
                  ? 'rgba(20, 184, 166, 0.15)'
                  : '#1E293B',
              color: activeTab === 'my_schedule' ? '#14B8A6' : '#94A3B8',
              fontWeight: 600,
              fontSize: '14px',
              cursor: 'pointer',
              minHeight: '44px',
            }}
          >
            Lịch của tôi (Đăng ký lịch)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('staff_schedules')}
            style={{
              padding: '10px 18px',
              borderRadius: '8px',
              border:
                activeTab === 'staff_schedules'
                  ? '1px solid #14B8A6'
                  : '1px solid #334155',
              backgroundColor:
                activeTab === 'staff_schedules'
                  ? 'rgba(20, 184, 166, 0.15)'
                  : '#1E293B',
              color: activeTab === 'staff_schedules' ? '#14B8A6' : '#94A3B8',
              fontWeight: 600,
              fontSize: '14px',
              cursor: 'pointer',
              minHeight: '44px',
            }}
          >
            Lịch tất cả nhân sự
          </button>
        </div>
      )}

      {/* Global Alerts */}
      {successMessage && (
        <div
          role="status"
          style={{
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            border: '1px solid #10B981',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '16px',
            color: '#10B981',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckIcon size={18} />
            <span>{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#10B981',
              cursor: 'pointer',
              padding: '4px',
              minHeight: '44px',
              minWidth: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Đóng thông báo"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          style={{
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid #EF4444',
            borderRadius: '8px',
            padding: '12px 16px',
            marginBottom: '16px',
            color: '#EF4444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <InfoIcon size={18} />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#EF4444',
              cursor: 'pointer',
              padding: '4px',
              minHeight: '44px',
              minWidth: '44px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Đóng thông báo"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      )}

      {/* Week Selector Bar */}
      <AppCard
        style={{
          marginBottom: '20px',
          padding: '16px',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CalendarIcon size={20} style={{ color: '#14B8A6' }} />
            <div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                Tuần làm việc
              </div>
              <div
                style={{ fontSize: '16px', fontWeight: 700, color: '#F8FAFC' }}
              >
                {weekRangeLabel}
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <AppButton
              variant="secondary"
              onClick={() => handleShiftWeek(-1)}
              style={{ minHeight: '44px' }}
            >
              ← Tuần trước
            </AppButton>
            <AppButton
              variant="secondary"
              onClick={handleSelectThisWeek}
              style={{ minHeight: '44px' }}
            >
              Tuần này
            </AppButton>
            <AppButton
              variant="primary"
              onClick={handleSelectNextWeek}
              style={{ minHeight: '44px' }}
            >
              Tuần tới
            </AppButton>
            <AppButton
              variant="secondary"
              onClick={() => handleShiftWeek(1)}
              style={{ minHeight: '44px' }}
            >
              Tuần sau →
            </AppButton>
          </div>
        </div>
      </AppCard>

      {/* ========================================================================= */}
      {/* STAFF / SELF SCHEDULE VIEW                                                */}
      {/* ========================================================================= */}
      {(!isAdminOrOwner || activeTab === 'my_schedule') && (
        <div>
          {scheduleLoading ? (
            <LoadingState message="Đang tải lịch làm việc..." />
          ) : mySchedule && !isEditing ? (
            /* VIEW REGISTERED SCHEDULE (Only show selected days + start time) */
            <div>
              <AppCard
                style={{
                  marginBottom: '20px',
                  padding: '20px',
                  boxSizing: 'border-box',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    borderBottom: '1px solid #334155',
                    paddingBottom: '16px',
                    marginBottom: '16px',
                  }}
                >
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
                          fontSize: '18px',
                          fontWeight: 700,
                          color: '#F8FAFC',
                        }}
                      >
                        Lịch đã đăng ký
                      </span>
                      <StatusBadge
                        status={
                          mySchedule.status === 'registered'
                            ? 'success'
                            : 'muted'
                        }
                        label={
                          mySchedule.status === 'registered'
                            ? 'Đã đăng ký'
                            : 'Đã hủy'
                        }
                      />
                      <span
                        style={{
                          fontSize: '12px',
                          color: '#14B8A6',
                          backgroundColor: 'rgba(20, 184, 166, 0.1)',
                          border: '1px solid rgba(20, 184, 166, 0.3)',
                          borderRadius: '4px',
                          padding: '2px 8px',
                          fontWeight: 600,
                        }}
                      >
                        v{mySchedule.version} (Lần #
                        {mySchedule.current_revision})
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: '13px',
                        color: '#94A3B8',
                        marginTop: '4px',
                      }}
                    >
                      Chỉ hiển thị các ngày làm việc đã đăng ký cùng giờ bắt đầu
                    </div>
                  </div>

                  <div
                    style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}
                  >
                    <AppButton
                      variant="secondary"
                      onClick={() => setShowHistoryModal(true)}
                      style={{ minHeight: '44px' }}
                    >
                      <RotateCcwIcon size={16} style={{ marginRight: '6px' }} />
                      Lịch sử điều chỉnh ({myRevisions.length})
                    </AppButton>
                    <AppButton
                      variant="primary"
                      onClick={() => {
                        initFormFromEntries(myEntries, selectedMonday);
                        setIsEditing(true);
                      }}
                      style={{ minHeight: '44px' }}
                    >
                      Sửa lịch
                    </AppButton>
                  </div>
                </div>

                {/* Display ONLY selected working days with start time */}
                {(() => {
                  if (myEntries.length === 0) {
                    return (
                      <EmptyState
                        title="Tuần nghỉ ngơi"
                        description="Bạn không đăng ký ngày làm việc nào trong tuần này."
                      />
                    );
                  }

                  return (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px',
                      }}
                    >
                      {myEntries.map((entry: ScheduleEntryData) => {
                        const dayName =
                          VIETNAMESE_DAYS[entry.day_of_week - 1] ||
                          `Thứ ${entry.day_of_week}`;
                        return (
                          <div
                            key={entry.id || entry.work_date}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              backgroundColor: '#1E293B',
                              border: '1px solid #334155',
                              borderRadius: '8px',
                              padding: '12px 16px',
                              boxSizing: 'border-box',
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
                                  backgroundColor: 'rgba(20, 184, 166, 0.15)',
                                  color: '#14B8A6',
                                  width: '40px',
                                  height: '40px',
                                  borderRadius: '8px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontWeight: 700,
                                  fontSize: '13px',
                                  flexShrink: 0,
                                }}
                              >
                                {entry.day_of_week === 7
                                  ? 'CN'
                                  : `T${entry.day_of_week + 1}`}
                              </div>
                              <div>
                                <div
                                  style={{
                                    fontSize: '15px',
                                    fontWeight: 600,
                                    color: '#F8FAFC',
                                  }}
                                >
                                  {dayName}
                                </div>
                                <div
                                  style={{ fontSize: '13px', color: '#94A3B8' }}
                                >
                                  {formatDateDisplay(entry.work_date)}
                                  <a
                                    style={{
                                      display: 'block',
                                      color: '#14B8A6',
                                      marginTop: '6px',
                                    }}
                                    href={`/work?schedule_id=${mySchedule?.id}&work_date=${entry.work_date}`}
                                  >
                                    Công việc trong ca
                                  </a>
                                </div>
                                {entry.notes && (
                                  <div
                                    style={{
                                      fontSize: '12px',
                                      color: '#CBD5E1',
                                      marginTop: '2px',
                                      fontStyle: 'italic',
                                    }}
                                  >
                                    Ghi chú: {entry.notes}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                borderRadius: '6px',
                                padding: '6px 12px',
                                color: '#10B981',
                                fontWeight: 700,
                                fontSize: '14px',
                              }}
                            >
                              <ClockIcon size={16} />
                              <span>
                                Bắt đầu:{' '}
                                {entry.start_time
                                  ? entry.start_time.slice(0, 5)
                                  : '--:--'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </AppCard>
            </div>
          ) : (
            /* REGISTRATION / EDIT FORM */
            <AppCard
              style={{
                marginBottom: '20px',
                padding: '20px',
                boxSizing: 'border-box',
              }}
            >
              <div style={{ marginBottom: '16px' }}>
                <div
                  style={{
                    fontSize: '18px',
                    fontWeight: 700,
                    color: '#F8FAFC',
                  }}
                >
                  {isEditing
                    ? 'Sửa lịch làm việc'
                    : 'Đăng ký lịch làm việc mới'}
                </div>
                <div
                  style={{
                    fontSize: '13px',
                    color: '#94A3B8',
                    marginTop: '4px',
                  }}
                >
                  {isEditing
                    ? 'Bạn có thể sửa lịch làm việc bất kỳ lúc nào (kể cả quá khứ). Lý do điều chỉnh là tùy chọn.'
                    : 'Chọn các ngày làm việc trong tuần và nhập giờ bắt đầu. Các ngày không chọn mặc định là nghỉ.'}
                </div>
              </div>

              {/* Quick actions for form */}
              <div
                style={{
                  display: 'flex',
                  gap: '8px',
                  marginBottom: '16px',
                  flexWrap: 'wrap',
                }}
              >
                <AppButton
                  type="button"
                  variant="secondary"
                  onClick={handleQuickSelectWeekdays}
                  style={{ minHeight: '44px' }}
                >
                  Chọn T2 – T6 (08:00)
                </AppButton>
                <AppButton
                  type="button"
                  variant="secondary"
                  onClick={handleQuickClearAll}
                  style={{ minHeight: '44px' }}
                >
                  Bỏ chọn tất cả
                </AppButton>
              </div>

              <form
                onSubmit={isEditing ? handleSubmitUpdate : handleSubmitRegister}
              >
                {/* 7 Days Matrix */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    marginBottom: '16px',
                  }}
                >
                  {dayEntries.map((dayItem, index) => (
                    <div
                      key={dayItem.dateStr}
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                        padding: '12px 14px',
                        borderRadius: '8px',
                        backgroundColor: dayItem.isWorking
                          ? 'rgba(20, 184, 166, 0.08)'
                          : '#1E293B',
                        border: `1px solid ${dayItem.isWorking ? 'rgba(20, 184, 166, 0.4)' : '#334155'}`,
                        boxSizing: 'border-box',
                      }}
                    >
                      {/* Left: Checkbox & Day Info */}
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          cursor: 'pointer',
                          minHeight: '44px',
                          userSelect: 'none',
                          flex: 1,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={dayItem.isWorking}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setDayEntries((prev) =>
                              prev.map((item, idx) =>
                                idx === index
                                  ? { ...item, isWorking: checked }
                                  : item,
                              ),
                            );
                          }}
                          style={{
                            width: '20px',
                            height: '20px',
                            cursor: 'pointer',
                            accentColor: '#14B8A6',
                          }}
                        />
                        <div>
                          <div
                            style={{
                              fontSize: '14px',
                              fontWeight: 600,
                              color: '#F8FAFC',
                            }}
                          >
                            {dayItem.dayLabel}
                          </div>
                          <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                            {formatDateDisplay(dayItem.dateStr)}
                          </div>
                        </div>
                      </label>

                      {/* Right: Start Time Picker and Notes */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          flexWrap: 'wrap',
                          justifyContent: 'flex-end',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                          }}
                        >
                          <span
                            style={{
                              fontSize: '13px',
                              color: dayItem.isWorking ? '#CBD5E1' : '#64748B',
                            }}
                          >
                            Giờ bắt đầu:
                          </span>
                          <input
                            type="time"
                            value={dayItem.startTime}
                            disabled={!dayItem.isWorking}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDayEntries((prev) =>
                                prev.map((item, idx) =>
                                  idx === index
                                    ? { ...item, startTime: val }
                                    : item,
                                ),
                              );
                            }}
                            style={{
                              backgroundColor: dayItem.isWorking
                                ? '#0F172A'
                                : '#1E293B',
                              color: dayItem.isWorking ? '#F8FAFC' : '#64748B',
                              border: `1px solid ${dayItem.isWorking ? '#14B8A6' : '#334155'}`,
                              borderRadius: '6px',
                              padding: '6px 10px',
                              fontSize: '14px',
                              fontWeight: 600,
                              minHeight: '44px',
                              boxSizing: 'border-box',
                              cursor: dayItem.isWorking
                                ? 'text'
                                : 'not-allowed',
                            }}
                          />
                        </div>

                        {dayItem.isWorking && (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                            }}
                          >
                            <input
                              type="text"
                              placeholder="Ghi chú ca (tùy chọn)..."
                              value={dayItem.notes || ''}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDayEntries((prev) =>
                                  prev.map((item, idx) =>
                                    idx === index
                                      ? { ...item, notes: val }
                                      : item,
                                  ),
                                );
                              }}
                              style={{
                                backgroundColor: '#0F172A',
                                color: '#F8FAFC',
                                border: '1px solid #334155',
                                borderRadius: '6px',
                                padding: '6px 10px',
                                fontSize: '13px',
                                minHeight: '44px',
                                minWidth: '180px',
                                boxSizing: 'border-box',
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Reason Input (OPTIONAL if Editing) */}
                {isEditing && (
                  <div style={{ marginBottom: '16px' }}>
                    <label
                      htmlFor="schedule-edit-reason"
                      style={{
                        display: 'block',
                        fontSize: '13px',
                        fontWeight: 600,
                        color: '#94A3B8',
                        marginBottom: '6px',
                      }}
                    >
                      Lý do điều chỉnh lịch (Tùy chọn)
                    </label>
                    <input
                      id="schedule-edit-reason"
                      type="text"
                      value={editReason}
                      onChange={(e) => setEditReason(e.target.value)}
                      placeholder="Nhập lý do đổi lịch nếu có (tùy chọn)..."
                      style={{
                        width: '100%',
                        backgroundColor: '#1E293B',
                        border: '1px solid #334155',
                        borderRadius: '6px',
                        color: '#F8FAFC',
                        padding: '10px 12px',
                        fontSize: '14px',
                        minHeight: '44px',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                )}

                {/* Action Buttons */}
                <div
                  style={{
                    display: 'flex',
                    gap: '10px',
                    justifyContent: 'flex-end',
                    flexWrap: 'wrap',
                  }}
                >
                  {isEditing && (
                    <AppButton
                      type="button"
                      variant="secondary"
                      onClick={() => setIsEditing(false)}
                      disabled={submitting}
                      style={{ minHeight: '44px' }}
                    >
                      Hủy bỏ
                    </AppButton>
                  )}
                  <AppButton
                    type="submit"
                    variant="primary"
                    disabled={submitting}
                    style={{ minHeight: '44px' }}
                  >
                    {submitting
                      ? 'Đang lưu...'
                      : isEditing
                        ? 'Lưu điều chỉnh lịch'
                        : 'Đăng ký lịch tuần'}
                  </AppButton>
                </div>
              </form>
            </AppCard>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* OWNER / ADMIN VIEW: ALL STAFF SCHEDULES                                    */}
      {/* ========================================================================= */}
      {isAdminOrOwner && activeTab === 'staff_schedules' && (
        <div>
          {/* Owner / Admin Notice Banner */}
          <div
            style={{
              backgroundColor: 'rgba(56, 189, 248, 0.1)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              borderRadius: '8px',
              padding: '12px 16px',
              marginBottom: '16px',
              color: '#38BDF8',
              fontSize: '13px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxSizing: 'border-box',
            }}
          >
            <InfoIcon size={18} />
            <span>
              Chủ sở hữu / Quản lý có quyền xem lịch và lịch sử điều chỉnh của
              nhân sự. Theo quy tắc RBAC-SCH-02, Quản lý không được chỉnh sửa
              lịch thay cho nhân viên.
            </span>
          </div>

          {/* Filter Bar */}
          <AppCard
            style={{
              marginBottom: '20px',
              padding: '16px',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                flexWrap: 'wrap',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <UserIcon size={16} style={{ color: '#94A3B8' }} />
                <span style={{ fontSize: '13px', color: '#CBD5E1' }}>
                  Lọc theo nhân sự:
                </span>
              </div>
              <select
                value={filterEmployeeId}
                onChange={(e) => setFilterEmployeeId(e.target.value)}
                style={{
                  backgroundColor: '#1E293B',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  color: '#F8FAFC',
                  padding: '8px 12px',
                  fontSize: '13px',
                  minHeight: '44px',
                  boxSizing: 'border-box',
                }}
              >
                <option value="all">
                  Tất cả nhân sự ({allSchedules.length})
                </option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name} ({emp.employee_code})
                  </option>
                ))}
              </select>
            </div>
          </AppCard>

          {/* Schedules List */}
          {scheduleLoading ? (
            <LoadingState message="Đang tải danh sách lịch nhân viên..." />
          ) : (
            (() => {
              const filtered =
                filterEmployeeId === 'all'
                  ? allSchedules
                  : allSchedules.filter(
                      (s: ScheduleData) => s.employee_id === filterEmployeeId,
                    );

              if (filtered.length === 0) {
                return (
                  <EmptyState
                    title="Chưa có lịch làm việc"
                    description="Chưa có nhân sự nào đăng ký lịch làm việc trong tuần này."
                  />
                );
              }

              return (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '16px',
                  }}
                >
                  {filtered.map((schedule: ScheduleData) => {
                    const workingEntries = schedule.entries || [];
                    return (
                      <AppCard
                        key={schedule.id}
                        style={{ padding: '16px', boxSizing: 'border-box' }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '12px',
                            borderBottom: '1px solid #334155',
                            paddingBottom: '12px',
                            marginBottom: '12px',
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '10px',
                            }}
                          >
                            <div
                              style={{
                                backgroundColor: 'rgba(56, 189, 248, 0.15)',
                                color: '#38BDF8',
                                padding: '8px',
                                borderRadius: '8px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              <UserIcon size={18} />
                            </div>
                            <div>
                              <div
                                style={{
                                  fontSize: '15px',
                                  fontWeight: 700,
                                  color: '#F8FAFC',
                                }}
                              >
                                {schedule.employee_name || 'Nhân viên'}
                              </div>
                              <div
                                style={{ fontSize: '12px', color: '#94A3B8' }}
                              >
                                Mã NV: {schedule.employee_code || '--'} • Bản
                                ghi v{schedule.version} (Lần #
                                {schedule.current_revision})
                              </div>
                            </div>
                          </div>

                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                            }}
                          >
                            <StatusBadge
                              status={
                                schedule.status === 'registered'
                                  ? 'success'
                                  : 'muted'
                              }
                              label={
                                schedule.status === 'registered'
                                  ? 'Đã đăng ký'
                                  : 'Đã hủy'
                              }
                            />
                            <AppButton
                              variant="secondary"
                              onClick={() => handleOpenOwnerDetail(schedule)}
                              style={{ minHeight: '44px' }}
                            >
                              <EyeIcon
                                size={16}
                                style={{ marginRight: '6px' }}
                              />
                              Xem chi tiết & Lịch sử
                            </AppButton>
                          </div>
                        </div>

                        {/* Display ONLY selected working days with start time */}
                        {workingEntries.length === 0 ? (
                          <div
                            style={{
                              fontSize: '13px',
                              color: '#94A3B8',
                              fontStyle: 'italic',
                            }}
                          >
                            Nhân viên không đăng ký ngày làm việc nào trong tuần
                            này.
                          </div>
                        ) : (
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: '8px',
                            }}
                          >
                            {workingEntries.map((e: ScheduleEntryData) => {
                              const dayName =
                                VIETNAMESE_DAYS[e.day_of_week - 1] ||
                                `Thứ ${e.day_of_week}`;
                              return (
                                <div
                                  key={e.id || e.work_date}
                                  style={{
                                    backgroundColor: '#1E293B',
                                    border: '1px solid #334155',
                                    borderRadius: '6px',
                                    padding: '8px 12px',
                                    fontSize: '13px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    boxSizing: 'border-box',
                                  }}
                                >
                                  <span
                                    style={{
                                      fontWeight: 600,
                                      color: '#14B8A6',
                                    }}
                                  >
                                    {dayName} ({formatDateDisplay(e.work_date)}
                                    ):
                                    <a
                                      style={{
                                        display: 'block',
                                        color: '#14B8A6',
                                      }}
                                      href={`/work?schedule_id=${schedule.id}&work_date=${e.work_date}`}
                                    >
                                      Công việc trong ca
                                    </a>
                                  </span>
                                  <span
                                    style={{
                                      color: '#F8FAFC',
                                      fontWeight: 700,
                                    }}
                                  >
                                    {e.start_time
                                      ? e.start_time.slice(0, 5)
                                      : '--:--'}
                                  </span>
                                  {e.notes && (
                                    <span
                                      style={{
                                        color: '#94A3B8',
                                        fontSize: '11px',
                                        fontStyle: 'italic',
                                      }}
                                    >
                                      ({e.notes})
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </AppCard>
                    );
                  })}
                </div>
              );
            })()
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* REVISION HISTORY MODAL (Staff)                                            */}
      {/* ========================================================================= */}
      {showHistoryModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Lịch sử điều chỉnh lịch làm việc"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(11, 18, 32, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 1000,
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              backgroundColor: '#151F30',
              border: '1px solid #334155',
              borderRadius: '12px',
              maxWidth: '640px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '20px',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid #334155',
                paddingBottom: '12px',
                marginBottom: '16px',
              }}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
              >
                <RotateCcwIcon size={20} style={{ color: '#14B8A6' }} />
                <span
                  style={{
                    fontSize: '16px',
                    fontWeight: 700,
                    color: '#F8FAFC',
                  }}
                >
                  Lịch sử điều chỉnh lịch làm việc
                </span>
              </div>
              <button
                type="button"
                onClick={() => setShowHistoryModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94A3B8',
                  cursor: 'pointer',
                  padding: '4px',
                  minHeight: '44px',
                  minWidth: '44px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label="Đóng"
              >
                <CloseIcon size={20} />
              </button>
            </div>

            {myRevisions.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  padding: '24px 0',
                  color: '#94A3B8',
                  fontSize: '14px',
                }}
              >
                Chưa có lịch sử điều chỉnh nào (phiên bản gốc v1).
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                }}
              >
                {myRevisions.map((rev: ScheduleRevisionData) => (
                  <div
                    key={rev.id}
                    style={{
                      backgroundColor: '#1E293B',
                      border: '1px solid #334155',
                      borderRadius: '8px',
                      padding: '12px 14px',
                      boxSizing: 'border-box',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '6px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '12px',
                          color: '#14B8A6',
                          backgroundColor: 'rgba(20, 184, 166, 0.1)',
                          border: '1px solid rgba(20, 184, 166, 0.3)',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontWeight: 700,
                        }}
                      >
                        Bản sửa đổi #{rev.revision_number}
                      </span>
                      <span style={{ fontSize: '12px', color: '#94A3B8' }}>
                        {new Date(rev.edited_at).toLocaleString('vi-VN')}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: '14px',
                        color: '#F8FAFC',
                        marginBottom: '4px',
                      }}
                    >
                      <strong style={{ color: '#F59E0B' }}>Lý do: </strong>
                      {rev.reason || '(Không có lý do)'}
                    </div>
                    {rev.edited_by_name && (
                      <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                        Người sửa: {rev.edited_by_name}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div
              style={{
                marginTop: '20px',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              <AppButton
                variant="secondary"
                onClick={() => setShowHistoryModal(false)}
                style={{ minHeight: '44px' }}
              >
                Đóng
              </AppButton>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* OWNER DETAIL MODAL                                                        */}
      {/* ========================================================================= */}
      {showOwnerDetailModal && ownerDetailSchedule && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Chi tiết lịch nhân sự"
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(11, 18, 32, 0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            zIndex: 1000,
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              backgroundColor: '#151F30',
              border: '1px solid #334155',
              borderRadius: '12px',
              maxWidth: '680px',
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              padding: '20px',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid #334155',
                paddingBottom: '12px',
                marginBottom: '16px',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: '16px',
                    fontWeight: 700,
                    color: '#F8FAFC',
                  }}
                >
                  Lịch làm việc: {ownerDetailSchedule.employee_name}
                </div>
                <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                  Mã NV: {ownerDetailSchedule.employee_code} • Tuần:{' '}
                  {weekRangeLabel}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowOwnerDetailModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94A3B8',
                  cursor: 'pointer',
                  padding: '4px',
                  minHeight: '44px',
                  minWidth: '44px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                aria-label="Đóng"
              >
                <CloseIcon size={20} />
              </button>
            </div>

            {/* Selected days */}
            <div style={{ marginBottom: '16px' }}>
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#94A3B8',
                  marginBottom: '8px',
                }}
              >
                Các ngày làm việc đã đăng ký:
              </div>
              {(() => {
                const working = ownerDetailSchedule.entries || [];
                if (working.length === 0) {
                  return (
                    <div
                      style={{
                        fontSize: '13px',
                        color: '#94A3B8',
                        fontStyle: 'italic',
                      }}
                    >
                      Không có ngày làm việc nào.
                    </div>
                  );
                }
                return (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    {working.map((e: ScheduleEntryData) => {
                      const dayName =
                        VIETNAMESE_DAYS[e.day_of_week - 1] ||
                        `Thứ ${e.day_of_week}`;
                      return (
                        <div
                          key={e.id || e.work_date}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            backgroundColor: '#1E293B',
                            border: '1px solid #334155',
                            borderRadius: '6px',
                            padding: '10px 14px',
                            boxSizing: 'border-box',
                          }}
                        >
                          <div>
                            <span style={{ fontWeight: 600, color: '#F8FAFC' }}>
                              {dayName} ({formatDateDisplay(e.work_date)})
                            </span>
                            {e.notes && (
                              <div
                                style={{
                                  fontSize: '12px',
                                  color: '#94A3B8',
                                  marginTop: '2px',
                                  fontStyle: 'italic',
                                }}
                              >
                                Ghi chú: {e.notes}
                              </div>
                            )}
                          </div>
                          <span style={{ color: '#10B981', fontWeight: 700 }}>
                            Bắt đầu:{' '}
                            {e.start_time ? e.start_time.slice(0, 5) : '--:--'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* Revisions timeline */}
            <div style={{ marginBottom: '16px' }}>
              <div
                style={{
                  fontSize: '13px',
                  fontWeight: 600,
                  color: '#94A3B8',
                  marginBottom: '8px',
                }}
              >
                Lịch sử các lần chỉnh sửa ({ownerDetailRevisions.length}):
              </div>
              {ownerDetailRevisions.length === 0 ? (
                <div
                  style={{
                    fontSize: '13px',
                    color: '#94A3B8',
                    fontStyle: 'italic',
                  }}
                >
                  Chưa có lần chỉnh sửa nào.
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  {ownerDetailRevisions.map((rev: ScheduleRevisionData) => (
                    <div
                      key={rev.id}
                      style={{
                        backgroundColor: '#0F172A',
                        border: '1px solid #334155',
                        borderRadius: '6px',
                        padding: '10px 12px',
                        fontSize: '13px',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          color: '#94A3B8',
                          marginBottom: '4px',
                        }}
                      >
                        <span>
                          Lần #{rev.revision_number} •{' '}
                          {rev.edited_by_name || 'Nhân viên'}
                        </span>
                        <span>
                          {new Date(rev.edited_at).toLocaleString('vi-VN')}
                        </span>
                      </div>
                      <div style={{ color: '#F59E0B' }}>
                        <strong>Lý do: </strong>
                        {rev.reason || '(Không có lý do)'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                marginTop: '16px',
              }}
            >
              <AppButton
                variant="secondary"
                onClick={() => setShowOwnerDetailModal(false)}
                style={{ minHeight: '44px' }}
              >
                Đóng
              </AppButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
