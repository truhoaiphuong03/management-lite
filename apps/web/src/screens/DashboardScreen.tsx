import React, { useEffect, useState } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  StatusBadge,
  ClockIcon,
  FileTextIcon,
  BanknoteIcon,
  SettingsIcon,
  NavIcon,
} from '../../../../packages/ui/src/components/index.js';
import type { UserRole } from '../types.js';
import type { AttendanceMeResponseData } from '../../../../packages/contracts/src/attendance.js';
import type { DailyReportListItem } from '../../../../packages/contracts/src/reports.js';
import type { EmployeeData } from '../../../../packages/contracts/src/employees.js';
import type { PayrollMonthOverviewData } from '../../../../packages/contracts/src/payroll.js';

export interface DashboardScreenProps {
  role: UserRole;
  workspaceName?: string | undefined;
  onNavigate: (path: string) => void;
}

type BadgeStatus = 'success' | 'warning' | 'error' | 'muted' | 'neutral';

interface MetricCardState {
  badgeStatus: BadgeStatus;
  badgeLabel: string;
  value: string;
  subtext: string;
}

function getVietnamTodayIso(): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
    const m = parts.find((p) => p.type === 'month')?.value ?? '01';
    const d = parts.find((p) => p.type === 'day')?.value ?? '01';
    return `${y}-${m}-${d}`;
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  role,
  workspaceName,
  onNavigate,
}) => {
  const [shiftMetric, setShiftMetric] = useState<MetricCardState>({
    badgeStatus: 'neutral',
    badgeLabel: 'Chưa có dữ liệu',
    value: '--',
    subtext: 'Chưa có thông tin ca làm hiện tại',
  });

  const [reportMetric, setReportMetric] = useState<MetricCardState>({
    badgeStatus: 'neutral',
    badgeLabel: 'Chưa có dữ liệu',
    value: '--',
    subtext: 'Chưa có báo cáo hôm nay',
  });

  const [employeesMetric, setEmployeesMetric] = useState<MetricCardState>({
    badgeStatus: 'neutral',
    badgeLabel: 'Owner view',
    value: '--',
    subtext: 'Chưa có dữ liệu nhân sự',
  });

  const [payrollMetric, setPayrollMetric] = useState<MetricCardState>({
    badgeStatus: 'muted',
    badgeLabel: 'Chưa có dữ liệu',
    value: '--',
    subtext: 'Chưa có dữ liệu kỳ lương',
  });

  const [staffAttendanceMetric, setStaffAttendanceMetric] =
    useState<MetricCardState>({
      badgeStatus: 'neutral',
      badgeLabel: 'Staff view',
      value: '--',
      subtext: 'Chưa có dữ liệu ca làm việc',
    });

  useEffect(() => {
    if (typeof fetch !== 'function') return;
    const controller = new AbortController();
    let active = true;
    const todayIso = getVietnamTodayIso();
    const currentMonth = todayIso.slice(0, 7);

    const loadSummary = async () => {
      try {
        const attRes = await fetch('/api/v1/attendance/me', {
          credentials: 'include',
          signal: controller.signal,
        });
        if (active && attRes && attRes.ok) {
          const body: { success?: boolean; data?: AttendanceMeResponseData } =
            await attRes.json();
          if (active && body?.data) {
            const currentShift = body.data.current_shift;
            const recentShifts = Array.isArray(body.data.recent_shifts)
              ? body.data.recent_shifts
              : [];

            if (currentShift?.run_state === 'working') {
              setShiftMetric({
                badgeStatus: 'success',
                badgeLabel: 'Đang làm việc',
                value: 'Đang trong ca',
                subtext: 'Ca làm việc hiện tại đang mở',
              });
            } else if (currentShift?.run_state === 'paused') {
              setShiftMetric({
                badgeStatus: 'warning',
                badgeLabel: 'Tạm nghỉ',
                value: 'Nghỉ giải lao',
                subtext: 'Ca làm việc đang tạm dừng',
              });
            } else if (body.data.current_shift !== undefined) {
              setShiftMetric({
                badgeStatus: 'neutral',
                badgeLabel: 'Ngoài ca',
                value: 'Chưa vào ca',
                subtext:
                  recentShifts.length > 0
                    ? `${recentShifts.length} ca làm gần đây`
                    : 'Sẵn sàng bắt đầu ca mới',
              });
            }

            if (role !== 'owner' && Array.isArray(body.data.recent_shifts)) {
              const completedCount = recentShifts.filter(
                (s) => s.run_state === 'completed',
              ).length;
              const totalWorkedSeconds = recentShifts.reduce(
                (acc, s) => acc + (s.worked_seconds || 0),
                0,
              );
              const hours = Math.round((totalWorkedSeconds / 3600) * 10) / 10;
              setStaffAttendanceMetric({
                badgeStatus: completedCount > 0 ? 'success' : 'neutral',
                badgeLabel: 'Staff view',
                value: `${completedCount} ca hoàn tất`,
                subtext: `${hours} giờ làm việc đã ghi nhận`,
              });
            }
          }
        }
      } catch {
        // Keep safe default fallback
      }

      try {
        const repRes = await fetch('/api/v1/reports/me', {
          credentials: 'include',
          signal: controller.signal,
        });
        if (active && repRes && repRes.ok) {
          const body: {
            success?: boolean;
            data?: { items?: DailyReportListItem[] };
          } = await repRes.json();
          if (active && Array.isArray(body?.data?.items)) {
            const items = body.data.items;
            const todayReport = items.find((r) => r.report_date === todayIso);
            if (todayReport) {
              const isSubmitted = todayReport.status === 'submitted';
              setReportMetric({
                badgeStatus: isSubmitted ? 'success' : 'warning',
                badgeLabel: isSubmitted ? 'Đã nộp' : 'Bản nháp',
                value: isSubmitted ? 'Đã nộp hôm nay' : 'Đang lưu nháp',
                subtext: `${todayReport.total_reported_count ?? todayReport.entries_count ?? 0} hạng mục công việc`,
              });
            } else {
              setReportMetric({
                badgeStatus: 'neutral',
                badgeLabel: 'Chưa nộp',
                value: `${items.length} báo cáo`,
                subtext: 'Chưa có báo cáo hôm nay',
              });
            }
          }
        }
      } catch {
        // Keep safe default fallback
      }

      if (role === 'owner') {
        try {
          const empRes = await fetch('/api/v1/employees', {
            credentials: 'include',
            signal: controller.signal,
          });
          if (active && empRes && empRes.ok) {
            const body: {
              success?: boolean;
              data?: { items?: EmployeeData[] };
            } = await empRes.json();
            if (active && Array.isArray(body?.data?.items)) {
              const items = body.data.items;
              const activeCount = items.filter(
                (e) => e.employment_status === 'active',
              ).length;
              const invitedCount = items.filter(
                (e) => e.employment_status === 'invited',
              ).length;
              setEmployeesMetric({
                badgeStatus: 'success',
                badgeLabel: 'Owner view',
                value: `${activeCount} nhân sự hoạt động`,
                subtext: `Tổng ${items.length} hồ sơ (${invitedCount} chờ kích hoạt)`,
              });
            }
          }
        } catch {
          // Keep safe default fallback
        }

        try {
          const payRes = await fetch(
            `/api/v1/payroll/periods/${currentMonth}`,
            {
              credentials: 'include',
              signal: controller.signal,
            },
          );
          if (active && payRes && payRes.ok) {
            const body: {
              success?: boolean;
              data?: PayrollMonthOverviewData;
            } = await payRes.json();
            if (active && body?.data?.period) {
              const period = body.data.period;
              const isFinalized = period.status === 'finalized';
              const empCount = Array.isArray(body.data.items)
                ? body.data.items.length
                : 0;
              setPayrollMetric({
                badgeStatus: isFinalized ? 'success' : 'warning',
                badgeLabel: isFinalized ? 'Đã chốt sổ' : 'Bản nháp',
                value: `Kỳ ${period.period_month}`,
                subtext: `${empCount} nhân sự trong kỳ lương`,
              });
            }
          }
        } catch {
          // Keep safe default fallback
        }
      }
    };

    void loadSummary();

    return () => {
      active = false;
      controller.abort();
    };
  }, [role]);

  return (
    <div>
      <PageHeader
        title="Tổng quan hoạt động"
        subtitle={`Workspace: ${workspaceName || 'Studio Media Lite'} | Múi giờ: Asia/Ho_Chi_Minh`}
        badge={
          <StatusBadge
            status={role === 'owner' ? 'neutral' : 'muted'}
            label={
              role === 'owner' ? 'Chủ sở hữu (Owner)' : 'Nhân viên (Staff)'
            }
          />
        }
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            <AppButton
              variant="primary"
              onClick={() => onNavigate('/clock')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <ClockIcon size={16} />
              <span>Vào Chấm công</span>
            </AppButton>
          </div>
        }
      />

      {/* Summary metric cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '16px',
          marginBottom: '24px',
        }}
      >
        <AppCard padding="16px">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <span style={{ fontSize: '13px', color: '#94A3B8' }}>
              Trạng thái ca làm
            </span>
            <StatusBadge
              status={shiftMetric.badgeStatus}
              label={shiftMetric.badgeLabel}
            />
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              margin: '8px 0',
              color: '#F8FAFC',
            }}
          >
            {shiftMetric.value}
          </div>
          <div style={{ fontSize: '12px', color: '#94A3B8' }}>
            {shiftMetric.subtext}
          </div>
        </AppCard>

        <AppCard padding="16px">
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
            }}
          >
            <span style={{ fontSize: '13px', color: '#94A3B8' }}>
              Báo cáo hàng ngày
            </span>
            <StatusBadge
              status={reportMetric.badgeStatus}
              label={reportMetric.badgeLabel}
            />
          </div>
          <div
            style={{
              fontSize: '24px',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              margin: '8px 0',
              color: '#F8FAFC',
            }}
          >
            {reportMetric.value}
          </div>
          <div style={{ fontSize: '12px', color: '#94A3B8' }}>
            {reportMetric.subtext}
          </div>
        </AppCard>

        {role === 'owner' ? (
          <>
            <AppCard padding="16px">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                }}
              >
                <span style={{ fontSize: '13px', color: '#94A3B8' }}>
                  Nhân sự trực tiếp
                </span>
                <StatusBadge
                  status={employeesMetric.badgeStatus}
                  label={employeesMetric.badgeLabel}
                />
              </div>
              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  margin: '8px 0',
                  color: '#F8FAFC',
                }}
              >
                {employeesMetric.value}
              </div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                {employeesMetric.subtext}
              </div>
            </AppCard>

            <AppCard padding="16px">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                }}
              >
                <span style={{ fontSize: '13px', color: '#94A3B8' }}>
                  Kỳ lương
                </span>
                <StatusBadge
                  status={payrollMetric.badgeStatus}
                  label={payrollMetric.badgeLabel}
                />
              </div>
              <div
                style={{
                  fontSize: '24px',
                  fontWeight: 700,
                  margin: '8px 0',
                  color: '#F8FAFC',
                }}
              >
                {payrollMetric.value}
              </div>
              <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                {payrollMetric.subtext}
              </div>
            </AppCard>
          </>
        ) : (
          <AppCard padding="16px">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
              }}
            >
              <span style={{ fontSize: '13px', color: '#94A3B8' }}>
                Công tháng hiện tại
              </span>
              <StatusBadge
                status={staffAttendanceMetric.badgeStatus}
                label={staffAttendanceMetric.badgeLabel}
              />
            </div>
            <div
              style={{
                fontSize: '24px',
                fontWeight: 700,
                margin: '8px 0',
                color: '#F8FAFC',
              }}
            >
              {staffAttendanceMetric.value}
            </div>
            <div style={{ fontSize: '12px', color: '#94A3B8' }}>
              {staffAttendanceMetric.subtext}
            </div>
          </AppCard>
        )}
      </div>

      {/* Quick Action Navigation Grid */}
      <h3
        style={{
          fontSize: '16px',
          fontWeight: 600,
          marginBottom: '12px',
          color: '#F8FAFC',
        }}
      >
        Lối tắt thao tác nhanh
      </h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: '12px',
        }}
      >
        <AppCard
          padding="16px"
          interactive
          style={{ cursor: 'pointer' }}
          onClick={() => onNavigate('/clock')}
        >
          <div style={{ color: '#14B8A6', marginBottom: '8px' }}>
            <ClockIcon size={24} />
          </div>
          <div
            style={{ fontWeight: 600, color: '#F8FAFC', marginBottom: '4px' }}
          >
            Chấm công
          </div>
          <div style={{ fontSize: '13px', color: '#94A3B8' }}>
            Vào ca, tạm dừng nghỉ, kết thúc ca
          </div>
        </AppCard>

        <AppCard
          padding="16px"
          interactive
          style={{ cursor: 'pointer' }}
          onClick={() => onNavigate('/reports')}
        >
          <div style={{ color: '#14B8A6', marginBottom: '8px' }}>
            <FileTextIcon size={24} />
          </div>
          <div
            style={{ fontWeight: 600, color: '#F8FAFC', marginBottom: '4px' }}
          >
            Báo cáo
          </div>
          <div style={{ fontSize: '13px', color: '#94A3B8' }}>
            Xem danh sách báo cáo hàng ngày
          </div>
        </AppCard>

        <AppCard
          padding="16px"
          interactive
          style={{ cursor: 'pointer' }}
          onClick={() => onNavigate('/work')}
        >
          <div style={{ color: '#14B8A6', marginBottom: '8px' }}>
            <NavIcon id="work" size={24} />
          </div>
          <div
            style={{ fontWeight: 600, color: '#F8FAFC', marginBottom: '4px' }}
          >
            Công việc
          </div>
          <div style={{ fontSize: '13px', color: '#94A3B8' }}>
            Giao việc, tiến độ và nghiệm thu
          </div>
        </AppCard>

        <AppCard
          padding="16px"
          interactive
          style={{ cursor: 'pointer' }}
          onClick={() => onNavigate('/schedule')}
        >
          <div style={{ color: '#14B8A6', marginBottom: '8px' }}>
            <NavIcon id="schedule" size={24} />
          </div>
          <div
            style={{ fontWeight: 600, color: '#F8FAFC', marginBottom: '4px' }}
          >
            Lịch làm việc
          </div>
          <div style={{ fontSize: '13px', color: '#94A3B8' }}>
            Xếp ca và theo dõi lịch tuần
          </div>
        </AppCard>

        <AppCard
          padding="16px"
          interactive
          style={{ cursor: 'pointer' }}
          onClick={() => onNavigate('/storage')}
        >
          <div style={{ color: '#14B8A6', marginBottom: '8px' }}>
            <NavIcon id="storage" size={24} />
          </div>
          <div
            style={{ fontWeight: 600, color: '#F8FAFC', marginBottom: '4px' }}
          >
            Lưu trữ & Drive
          </div>
          <div style={{ fontSize: '13px', color: '#94A3B8' }}>
            Thư mục nguồn và bàn giao sản phẩm
          </div>
        </AppCard>

        {role === 'owner' ? (
          <>
            <AppCard
              padding="16px"
              interactive
              style={{ cursor: 'pointer' }}
              onClick={() => onNavigate('/employees')}
            >
              <div style={{ color: '#14B8A6', marginBottom: '8px' }}>
                <NavIcon id="employees" size={24} />
              </div>
              <div
                style={{
                  fontWeight: 600,
                  color: '#F8FAFC',
                  marginBottom: '4px',
                }}
              >
                Nhân viên
              </div>
              <div style={{ fontSize: '13px', color: '#94A3B8' }}>
                Hồ sơ nhân sự, lời mời và trạng thái
              </div>
            </AppCard>

            <AppCard
              padding="16px"
              interactive
              style={{ cursor: 'pointer' }}
              onClick={() => onNavigate('/payroll')}
            >
              <div style={{ color: '#14B8A6', marginBottom: '8px' }}>
                <BanknoteIcon size={24} />
              </div>
              <div
                style={{
                  fontWeight: 600,
                  color: '#F8FAFC',
                  marginBottom: '4px',
                }}
              >
                Bảng lương
              </div>
              <div style={{ fontSize: '13px', color: '#94A3B8' }}>
                Xem bảng lương kỳ hiện tại
              </div>
            </AppCard>

            <AppCard
              padding="16px"
              interactive
              style={{ cursor: 'pointer' }}
              onClick={() => onNavigate('/finance')}
            >
              <div style={{ color: '#14B8A6', marginBottom: '8px' }}>
                <NavIcon id="accounts" size={24} />
              </div>
              <div
                style={{
                  fontWeight: 600,
                  color: '#F8FAFC',
                  marginBottom: '4px',
                }}
              >
                Tài chính
              </div>
              <div style={{ fontSize: '13px', color: '#94A3B8' }}>
                Thu chi cá nhân, kế hoạch và hóa đơn
              </div>
            </AppCard>

            <AppCard
              padding="16px"
              interactive
              style={{ cursor: 'pointer' }}
              onClick={() => onNavigate('/accounts')}
            >
              <div style={{ color: '#14B8A6', marginBottom: '8px' }}>
                <NavIcon id="accounts" size={24} />
              </div>
              <div
                style={{
                  fontWeight: 600,
                  color: '#F8FAFC',
                  marginBottom: '4px',
                }}
              >
                Tài khoản ACC
              </div>
              <div style={{ fontSize: '13px', color: '#94A3B8' }}>
                Quản lý tài khoản và phân quyền
              </div>
            </AppCard>

            <AppCard
              padding="16px"
              interactive
              style={{ cursor: 'pointer' }}
              onClick={() => onNavigate('/issues')}
            >
              <div style={{ color: '#14B8A6', marginBottom: '8px' }}>
                <NavIcon id="issues" size={24} />
              </div>
              <div
                style={{
                  fontWeight: 600,
                  color: '#F8FAFC',
                  marginBottom: '4px',
                }}
              >
                Vấn đề & Issues
              </div>
              <div style={{ fontSize: '13px', color: '#94A3B8' }}>
                Theo dõi lỗi và tiến độ xử lý
              </div>
            </AppCard>
          </>
        ) : (
          <AppCard
            padding="16px"
            interactive
            style={{ cursor: 'pointer' }}
            onClick={() => onNavigate('/my-pay')}
          >
            <div style={{ color: '#14B8A6', marginBottom: '8px' }}>
              <BanknoteIcon size={24} />
            </div>
            <div
              style={{ fontWeight: 600, color: '#F8FAFC', marginBottom: '4px' }}
            >
              Lương cá nhân
            </div>
            <div style={{ fontSize: '13px', color: '#94A3B8' }}>
              Xem phiếu lương và chi tiết công
            </div>
          </AppCard>
        )}

        <AppCard
          padding="16px"
          interactive
          style={{ cursor: 'pointer' }}
          onClick={() => onNavigate('/settings')}
        >
          <div style={{ color: '#14B8A6', marginBottom: '8px' }}>
            <SettingsIcon size={24} />
          </div>
          <div
            style={{ fontWeight: 600, color: '#F8FAFC', marginBottom: '4px' }}
          >
            Cài đặt
          </div>
          <div style={{ fontSize: '13px', color: '#94A3B8' }}>
            Tùy chọn hiển thị & tài khoản
          </div>
        </AppCard>
      </div>
    </div>
  );
};
