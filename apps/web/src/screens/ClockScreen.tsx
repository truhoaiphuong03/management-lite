import React, { useState, useEffect } from 'react';
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
} from '@management-lite/ui/components';
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
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Live Timer Seconds
  const [workedSeconds, setWorkedSeconds] = useState(0);
  const [breakSeconds, setBreakSeconds] = useState(0);

  // Correction Request Modal State (Staff)
  const [showCorrectionModal, setShowCorrectionModal] = useState(false);
  const [targetShiftForCorrection, setTargetShiftForCorrection] =
    useState<ShiftData | null>(null);
  const [correctionReason, setCorrectionReason] = useState('');
  const [claimedClockOut, setClaimedClockOut] = useState('');
  const [evidenceNote, setEvidenceNote] = useState('');

  // Owner Review State
  const [ownerShifts, setOwnerShifts] = useState<ShiftData[]>([]);
  const [employees, setEmployees] = useState<EmployeeData[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [ownerLoading, setOwnerLoading] = useState(false);

  // 1. Fetch CSRF token and initial data
  const initData = async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const authRes = await fetch('/api/v1/auth/me', {
        credentials: 'include',
      });
      if (authRes.ok) {
        const authData = await authRes.json();
        if (authData.data?.csrf_token) {
          setCsrfToken(authData.data.csrf_token);
        }
      }

      await fetchMyAttendance();

      if (role === 'owner') {
        await fetchOwnerEmployees();
        await fetchOwnerShifts();
      }
    } catch {
      setErrorMessage('Không thể kết nối đến máy chủ.');
    } finally {
      setLoading(false);
    }
  };

  const fetchMyAttendance = async () => {
    try {
      const res = await fetch('/api/v1/attendance/me', {
        credentials: 'include',
      });
      if (!res.ok) {
        throw new Error('Lỗi khi tải dữ liệu chấm công.');
      }
      const data: { success: boolean; data: AttendanceMeResponseData } =
        await res.json();
      if (data.success && data.data) {
        setCurrentShift(data.data.current_shift);
        setRecentShifts(data.data.recent_shifts || []);
      }
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Lỗi tải dữ liệu cá nhân',
      );
    }
  };

  const fetchOwnerEmployees = async () => {
    try {
      const res = await fetch('/api/v1/employees', {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.data?.items || []);
      }
    } catch {
      // Non-critical if employees list fails
    }
  };

  const fetchOwnerShifts = async () => {
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
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setOwnerShifts(data.data?.shifts || []);
      }
    } catch {
      setErrorMessage('Không thể tải danh sách ca làm việc nhân viên.');
    } finally {
      setOwnerLoading(false);
    }
  };

  useEffect(() => {
    initData();
  }, [role]);

  useEffect(() => {
    if (activeTab === 'owner_review' && role === 'owner') {
      fetchOwnerShifts();
    }
  }, [selectedEmployeeId, selectedDate, activeTab]);

  // 2. Real-time timer calculation
  useEffect(() => {
    if (!currentShift) {
      setWorkedSeconds(0);
      setBreakSeconds(0);
      return;
    }

    const updateTimers = () => {
      const now = Date.now();
      const clockInMs = new Date(currentShift.clock_in_at).getTime();

      let totalBreakMs = 0;
      let openBreakMs = 0;

      for (const b of currentShift.breaks) {
        const startMs = new Date(b.started_at).getTime();
        if (b.ended_at) {
          totalBreakMs += new Date(b.ended_at).getTime() - startMs;
        } else {
          openBreakMs = now - startMs;
        }
      }

      if (currentShift.run_state === 'paused') {
        setBreakSeconds(Math.max(0, Math.floor(openBreakMs / 1000)));
      } else {
        setBreakSeconds(0);
      }

      const totalElapsedMs = now - clockInMs;
      const effectiveWorkedMs = Math.max(
        0,
        totalElapsedMs - totalBreakMs - openBreakMs,
      );
      setWorkedSeconds(Math.max(0, Math.floor(effectiveWorkedMs / 1000)));
    };

    updateTimers();
    const interval = setInterval(updateTimers, 1000);
    return () => clearInterval(interval);
  }, [currentShift]);

  const formatDuration = (totalSecs: number) => {
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatHoursMinutes = (totalSecs: number) => {
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    if (hrs === 0 && mins === 0) return `${totalSecs} giây`;
    if (hrs === 0) return `${mins} phút`;
    return `${hrs}h ${mins}m`;
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

  const handleClockOut = async () => {
    if (!currentShift) return;
    if (
      !window.confirm(
        'Bạn có chắc chắn muốn kết thúc ca làm việc này? Dữ liệu ca làm sẽ được lưu và chuyển sang trạng thái chờ duyệt.',
      )
    ) {
      return;
    }

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

      setSuccessMessage(
        'Kết thúc ca thành công! Ca làm đã được chuyển đến Owner để duyệt.',
      );
      await fetchMyAttendance();
      if (role === 'owner') fetchOwnerShifts();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Thao tác thất bại');
    } finally {
      setActionLoading(false);
    }
  };

  // Submit Correction Request (Staff)
  const handleSubmitCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetShiftForCorrection || !correctionReason.trim()) {
      alert('Vui lòng nhập lý do giải trình');
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

      setSuccessMessage('Đã gửi đơn giải trình thành công (C01)!');
      setShowCorrectionModal(false);
      setCorrectionReason('');
      setClaimedClockOut('');
      setEvidenceNote('');
      await fetchMyAttendance();
      if (role === 'owner') fetchOwnerShifts();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Thao tác thất bại');
    } finally {
      setActionLoading(false);
    }
  };

  // Owner Review Shift (Approve / Reject)
  const handleReviewShift = async (
    shift: ShiftData,
    decision: 'approved' | 'rejected',
  ) => {
    let reason: string | undefined = undefined;
    if (decision === 'rejected') {
      const input = window.prompt(
        `Nhập lý do từ chối ca làm của ${shift.employee_name || shift.employee_code}:`,
        'Giờ làm việc không khớp thực tế',
      );
      if (!input || !input.trim()) return;
      reason = input.trim();
    } else {
      if (
        !window.confirm(`Xác nhận duyệt ca làm của ${shift.employee_name}?`)
      ) {
        return;
      }
    }

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
          reason,
        }),
      });

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(body.error?.message || 'Không thể duyệt ca làm việc.');
      }

      setSuccessMessage(
        decision === 'approved'
          ? `Đã duyệt ca làm của ${shift.employee_name}!`
          : `Đã từ chối ca làm của ${shift.employee_name}.`,
      );
      await fetchOwnerShifts();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Thao tác thất bại');
    } finally {
      setOwnerLoading(false);
    }
  };

  // Owner Decide on Correction Request
  const handleDecideCorrection = async (
    crId: string,
    decision: 'accept' | 'reject',
    shift: ShiftData,
  ) => {
    let explicitClockOut: string | undefined = undefined;
    let reason = '';

    if (decision === 'reject') {
      const input = window.prompt(
        'Nhập lý do từ chối đơn giải trình chấm công:',
        'Không đủ bằng chứng xác thực',
      );
      if (!input || !input.trim()) return;
      reason = input.trim();
    } else {
      const defaultDate = shift.pending_correction?.claimed_clock_out_at
        ? new Date(shift.pending_correction.claimed_clock_out_at)
            .toISOString()
            .slice(0, 16)
        : new Date().toISOString().slice(0, 16);

      const timeInput = window.prompt(
        'Xác nhận giờ kết thúc ca chính xác (YYYY-MM-DDTHH:MM):',
        defaultDate,
      );
      if (!timeInput) return;
      explicitClockOut = new Date(timeInput).toISOString();

      const reasonInput = window.prompt(
        'Nhập ghi chú chấp nhận điều chỉnh:',
        'Đã đối chiếu với quản lý cửa hàng',
      );
      if (!reasonInput || !reasonInput.trim()) return;
      reason = reasonInput.trim();
    }

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
            reason,
            clock_out_at: explicitClockOut,
          }),
        },
      );

      const body = await res.json();
      if (!res.ok || !body.success) {
        throw new Error(
          body.error?.message || 'Không thể xử lý yêu cầu điều chỉnh.',
        );
      }

      setSuccessMessage(
        decision === 'accept'
          ? 'Đã chấp nhận điều chỉnh ca làm việc thành công!'
          : 'Đã từ chối đơn giải trình.',
      );
      await fetchOwnerShifts();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Thao tác thất bại');
    } finally {
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
                  fontSize: '14px',
                  fontWeight: 600,
                  color: '#94A3B8',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: '8px',
                }}
              >
                {currentShift?.run_state === 'working'
                  ? 'Thời gian làm việc hiện tại'
                  : currentShift?.run_state === 'paused'
                    ? 'Thời gian tạm nghỉ (Unpaid)'
                    : 'Chưa vào ca làm việc'}
              </div>

              <div
                style={{
                  fontSize: '44px',
                  fontWeight: 800,
                  fontFamily: 'monospace',
                  color:
                    currentShift?.run_state === 'working'
                      ? '#14B8A6'
                      : currentShift?.run_state === 'paused'
                        ? '#F59E0B'
                        : '#94A3B8',
                  letterSpacing: '2px',
                  margin: '8px 0 16px',
                }}
              >
                {currentShift?.run_state === 'paused'
                  ? formatDuration(breakSeconds)
                  : formatDuration(workedSeconds)}
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
                  Bắt đầu ca:{' '}
                  {new Date(currentShift.clock_in_at).toLocaleTimeString(
                    'vi-VN',
                  )}{' '}
                  ngày{' '}
                  {new Date(currentShift.clock_in_at).toLocaleDateString(
                    'vi-VN',
                  )}
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
                {recentShifts.map((shift) => (
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
                          {new Date(shift.clock_in_at).toLocaleDateString(
                            'vi-VN',
                            {
                              weekday: 'long',
                              year: 'numeric',
                              month: 'numeric',
                              day: 'numeric',
                            },
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: '13px',
                            color: '#94A3B8',
                            marginTop: '2px',
                          }}
                        >
                          Vào ca:{' '}
                          {new Date(shift.clock_in_at).toLocaleTimeString(
                            'vi-VN',
                          )}
                          {shift.clock_out_at &&
                            ` - Ra ca: ${new Date(shift.clock_out_at).toLocaleTimeString('vi-VN')}`}
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
          </div>
        </div>
      ) : (
        /* Owner Review Tab */
        <div>
          {/* Filter Bar */}
          <AppCard style={{ marginBottom: '20px', padding: '16px' }}>
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
              {ownerShifts.map((shift) => (
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
                        {new Date(shift.clock_in_at).toLocaleDateString(
                          'vi-VN',
                        )}{' '}
                        •{' '}
                        {new Date(shift.clock_in_at).toLocaleTimeString(
                          'vi-VN',
                        )}
                        {shift.clock_out_at &&
                          ` đến ${new Date(shift.clock_out_at).toLocaleTimeString('vi-VN')}`}
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
                        <AlertTriangleIcon size={16} /> Đơn giải trình chấm công
                        từ nhân viên
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
            </div>
          )}
        </div>
      )}

      {/* Staff Correction Request Modal */}
      {showCorrectionModal && targetShiftForCorrection && (
        <div
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
                  type="button"
                  variant="secondary"
                  onClick={() => setShowCorrectionModal(false)}
                >
                  Hủy
                </AppButton>
                <AppButton
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
    </div>
  );
};
