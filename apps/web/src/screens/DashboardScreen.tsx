import React, { useEffect, useState } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  StatusBadge,
  ClockIcon,
  ErrorState,
  useAutoDismiss,
} from '../../../../packages/ui/src/components/index.js';
import { THEME_COLORS } from '../../../../packages/ui/src/tokens.js';
import type { UserRole } from '../types.js';
import type { AttendanceMeResponseData } from '../../../../packages/contracts/src/attendance.js';
import type { DailyReportListItem } from '../../../../packages/contracts/src/reports.js';
import type { EmployeeData } from '../../../../packages/contracts/src/employees.js';
import type { PayrollMonthOverviewData } from '../../../../packages/contracts/src/payroll.js';
import type {
  DashboardPrintQuoteAlertSummary,
  DashboardSummaryResponseData,
} from '../../../../packages/contracts/src/dashboard.js';
import {
  fetchWithFrontendCache,
  getFrontendCachedData,
  type FrontendCacheScope,
} from '../cache/query-cache.js';

export interface DashboardScreenProps {
  role: UserRole;
  workspaceName?: string | undefined;
  userId?: string | undefined;
  workspaceId?: string | undefined;
  onNavigate: (path: string) => void;
  initialPrintQuoteAlert?: DashboardPrintQuoteAlertSummary | null | undefined;
  initialAccountsHealthCount?: number | null | undefined;
}

type BadgeStatus = 'success' | 'warning' | 'error' | 'muted' | 'neutral';

interface MetricCardState {
  badgeStatus: BadgeStatus;
  badgeLabel: string;
  value: string;
  subtext: string;
}

function getStatusColor(status: BadgeStatus): string {
  switch (status) {
    case 'success':
      return 'var(--success-text, #047857)';
    case 'warning':
      return 'var(--warning-text, #92400e)';
    case 'error':
      return 'var(--danger-text, #b91c1c)';
    case 'muted':
    case 'neutral':
    default:
      return 'var(--muted-color, #475569)';
  }
}

const ChevronRightSvg: React.FC = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="dashboard-row-chevron"
  >
    <path d="m9 6 6 6-6 6" />
  </svg>
);

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
  userId,
  workspaceId,
  onNavigate,
  initialPrintQuoteAlert,
  initialAccountsHealthCount,
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
    badgeLabel: 'Quản lý',
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
      badgeLabel: 'Cá nhân',
      value: '--',
      subtext: 'Chưa có dữ liệu ca làm việc',
    });

  const [staffWorkMetric, setStaffWorkMetric] = useState<MetricCardState>({
    badgeStatus: 'neutral',
    badgeLabel: 'Cá nhân',
    value: 'Xem danh sách',
    subtext: 'Công việc được phân công cho bạn',
  });

  const [bridgeStatus, setBridgeStatus] = useState<{
    connected: boolean;
    last_synced_at: string | null;
    counts: {
      products: number;
      channels: number;
      scripts: number;
      prompts: number;
      audio_deliverables: number;
      video_deliverables: number;
      active_members: number;
    };
    management_lite: {
      active_employees: number;
      synced_work_items: number;
      synced_daily_reports: number;
      storage_drive_connected: boolean;
      storage_google_email: string | null;
      employee_mappings?: Array<{
        employee_code: string;
        full_name: string;
        email: string | null;
        position_title: string | null;
        v4_linked: boolean;
      }>;
    };
  } | null>(null);
  const [bridgeReadError, setBridgeReadError] = useState<string | null>(null);
  const [bridgeSyncing, setBridgeSyncing] = useState(false);
  const [showBridgeDetails, setShowBridgeDetails] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [bridgeFeedbackError, setBridgeFeedbackError] = useState(false);
  const [bridgeFeedback, setBridgeFeedback] = useState<string | null>(null);
  useAutoDismiss(
    bridgeFeedback,
    () => {
      setBridgeFeedback(null);
      setBridgeFeedbackError(false);
    },
    bridgeFeedbackError ? 5000 : 4000,
  );
  const [systemErrorAlert, setSystemErrorAlert] = useState<{
    errorCount: number;
    warnCount: number;
    topMessage: string | null;
    topRoute: string | null;
    topFingerprint: string | null;
  } | null>(null);
  const [printQuoteAlert, setPrintQuoteAlert] =
    useState<DashboardPrintQuoteAlertSummary | null>(
      role === 'owner' ? (initialPrintQuoteAlert ?? null) : null,
    );
  const [accountsHealthCount, setAccountsHealthCount] = useState<number>(
    role === 'owner' ? Math.max(0, initialAccountsHealthCount ?? 0) : 0,
  );

  const handleSyncTikTokV4 = async () => {
    if (typeof fetch !== 'function' || bridgeSyncing) return;
    setBridgeSyncing(true);
    setBridgeFeedback(null);
    setBridgeFeedbackError(false);
    try {
      let csrfToken = '';
      const sessionRes = await fetch('/api/v1/auth/me', {
        method: 'GET',
        credentials: 'include',
      });
      if (!sessionRes.ok)
        throw new Error(
          'Không xác minh được phiên đăng nhập. Hãy đăng nhập lại.',
        );
      if (sessionRes.ok) {
        const sessionJson = (await sessionRes.json()) as {
          data?: { csrf_token?: string };
        };
        csrfToken = sessionJson?.data?.csrf_token ?? '';
        if (!csrfToken)
          throw new Error(
            'Không lấy được mã xác thực phiên. Hãy tải lại trang.',
          );
      }

      const syncRes = await fetch('/api/v1/bridge/tiktok-v4/sync', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        body: JSON.stringify({}),
      });
      if (!syncRes.ok) {
        const failure = (await syncRes.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(
          failure?.error?.message || `Đồng bộ thất bại (${syncRes.status})`,
        );
      }
      const syncJson = (await syncRes.json()) as {
        data?: {
          employees_synced?: number;
          reports_synced?: number;
          work_items_synced?: number;
          warnings?: string[];
        };
      };
      const warnings =
        syncJson.data?.warnings?.filter(
          (warning) => typeof warning === 'string',
        ) ?? [];
      setBridgeFeedback(
        `Đã đồng bộ thành công: ${syncJson?.data?.employees_synced ?? 0} nhân sự, ${syncJson?.data?.reports_synced ?? 0} báo cáo sản lượng, ${syncJson?.data?.work_items_synced ?? 0} công việc từ hoaiphuong.click.${warnings.length ? ` ${warnings.join(' ')}` : ''}`,
      );

      const statusRes = await fetch('/api/v1/bridge/tiktok-v4', {
        method: 'GET',
        credentials: 'include',
      });
      if (statusRes.ok) {
        const statusJson = (await statusRes.json()) as {
          data?: {
            connected?: boolean;
            last_synced_at?: string | null;
            tiktok_v4?: {
              counts?: {
                products?: number;
                channels?: number;
                scripts?: number;
                prompts?: number;
                audio_deliverables?: number;
                video_deliverables?: number;
                active_members?: number;
              };
            };
            management_lite?: {
              active_employees?: number;
              synced_work_items?: number;
              synced_daily_reports?: number;
              storage_drive_connected?: boolean;
              storage_google_email?: string | null;
            };
          };
        };
        if (statusJson?.data) {
          setBridgeStatus({
            connected: Boolean(statusJson.data.connected),
            last_synced_at: statusJson.data.last_synced_at ?? null,
            counts: {
              products: statusJson.data.tiktok_v4?.counts?.products ?? 0,
              channels: statusJson.data.tiktok_v4?.counts?.channels ?? 0,
              scripts: statusJson.data.tiktok_v4?.counts?.scripts ?? 0,
              prompts: statusJson.data.tiktok_v4?.counts?.prompts ?? 0,
              audio_deliverables:
                statusJson.data.tiktok_v4?.counts?.audio_deliverables ?? 0,
              video_deliverables:
                statusJson.data.tiktok_v4?.counts?.video_deliverables ?? 0,
              active_members:
                statusJson.data.tiktok_v4?.counts?.active_members ?? 0,
            },
            management_lite: {
              active_employees:
                statusJson.data.management_lite?.active_employees ?? 0,
              synced_work_items:
                statusJson.data.management_lite?.synced_work_items ?? 0,
              synced_daily_reports:
                statusJson.data.management_lite?.synced_daily_reports ?? 0,
              storage_drive_connected: Boolean(
                statusJson.data.management_lite?.storage_drive_connected,
              ),
              storage_google_email:
                statusJson.data.management_lite?.storage_google_email ?? null,
              employee_mappings: Array.isArray(
                (
                  statusJson.data.management_lite as {
                    employee_mappings?: unknown;
                  }
                )?.employee_mappings,
              )
                ? (
                    statusJson.data.management_lite as {
                      employee_mappings: Array<{
                        employee_code: string;
                        full_name: string;
                        email: string | null;
                        position_title: string | null;
                        v4_linked: boolean;
                      }>;
                    }
                  ).employee_mappings
                : [],
            },
          });
        }
      }
    } catch (err) {
      setBridgeFeedbackError(true);
      setBridgeFeedback(
        err instanceof Error ? err.message : 'Không thể đồng bộ lúc này.',
      );
    } finally {
      setBridgeSyncing(false);
    }
  };

  useEffect(() => {
    if (typeof fetch !== 'function') return;
    const controller = new AbortController();
    let active = true;
    const todayIso = getVietnamTodayIso();
    const currentMonth = todayIso.slice(0, 7);
    const cacheScope: FrontendCacheScope = {
      userId,
      workspaceId,
      role,
    };
    const summaryUrl = `/api/v1/dashboard/summary?date=${encodeURIComponent(todayIso)}&month=${encodeURIComponent(currentMonth)}`;

    const applySummaryData = (summary: DashboardSummaryResponseData) => {
      if (!active) return;

      const currentShift = summary.shift?.current_shift;
      const recentCount = summary.shift?.recent_shifts_count ?? 0;

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
      } else if (summary.shift) {
        setShiftMetric({
          badgeStatus: 'neutral',
          badgeLabel: 'Ngoài ca',
          value: 'Chưa vào ca',
          subtext:
            recentCount > 0
              ? `${recentCount} ca làm gần đây`
              : 'Sẵn sàng bắt đầu ca mới',
        });
      }

      if (role !== 'owner' && summary.shift) {
        const completedCount = summary.shift.completed_shifts_count ?? 0;
        const totalWorkedSeconds = summary.shift.total_worked_seconds ?? 0;
        const hours = Math.round((totalWorkedSeconds / 3600) * 10) / 10;
        setStaffAttendanceMetric({
          badgeStatus: completedCount > 0 ? 'success' : 'neutral',
          badgeLabel: 'Cá nhân',
          value: `${completedCount} ca hoàn tất`,
          subtext: `${hours} giờ làm việc đã ghi nhận`,
        });
      }

      if (summary.report) {
        const todayReport = summary.report.today_report;
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
            value: `${summary.report.total_reports_count ?? 0} báo cáo`,
            subtext: 'Chưa có báo cáo hôm nay',
          });
        }
      }

      if (role === 'owner') {
        if (summary.employees) {
          setEmployeesMetric({
            badgeStatus: 'success',
            badgeLabel: 'Quản lý',
            value: `${summary.employees.active_count} nhân sự`,
            subtext: `${summary.employees.total_count} hồ sơ (${summary.employees.invited_count} chờ duyệt)`,
          });
        }
        if (summary.payroll) {
          const isFinalized = summary.payroll.status === 'finalized';
          setPayrollMetric({
            badgeStatus: isFinalized ? 'success' : 'warning',
            badgeLabel: isFinalized ? 'Đã chốt sổ' : 'Bản nháp',
            value: `Kỳ ${summary.payroll.period_month}`,
            subtext: `${summary.payroll.employee_count} nhân sự trong kỳ lương`,
          });
        }
        if (summary.print_quotes !== undefined) {
          setPrintQuoteAlert(summary.print_quotes ?? null);
        }
        if (summary.accounts_health !== undefined) {
          setAccountsHealthCount(
            Math.max(0, summary.accounts_health?.attention_count ?? 0),
          );
        }
      }
    };

    const cachedSummary = getFrontendCachedData<DashboardSummaryResponseData>(
      cacheScope,
      summaryUrl,
    );
    if (cachedSummary && cachedSummary.shift) {
      applySummaryData(cachedSummary);
      return () => {
        active = false;
        controller.abort();
      };
    }

    const loadAttendanceFallback = async () => {
      try {
        const attRes = await fetchWithFrontendCache<AttendanceMeResponseData>(
          cacheScope,
          '/api/v1/attendance/me',
          { signal: controller.signal },
        );
        if (active && attRes.ok && attRes.data) {
          const currentShift = attRes.data.current_shift;
          const recentShifts = Array.isArray(attRes.data.recent_shifts)
            ? attRes.data.recent_shifts
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
          } else if (attRes.data.current_shift !== undefined) {
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

          if (role !== 'owner' && Array.isArray(attRes.data.recent_shifts)) {
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
              badgeLabel: 'Cá nhân',
              value: `${completedCount} ca hoàn tất`,
              subtext: `${hours} giờ làm việc đã ghi nhận`,
            });
          }
        }
      } catch {
        // Keep safe default fallback
      }
    };

    const loadReportsFallback = async () => {
      try {
        const repRes = await fetchWithFrontendCache<{
          items?: DailyReportListItem[];
        }>(cacheScope, '/api/v1/reports/me', {
          signal: controller.signal,
        });
        if (active && repRes.ok && Array.isArray(repRes.data?.items)) {
          const items = repRes.data.items;
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
      } catch {
        // Keep safe default fallback
      }
    };

    const loadEmployeesFallback = async () => {
      if (role !== 'owner') return;
      try {
        const allEmployees: EmployeeData[] = [];
        const seenIds = new Set<string>();
        let cursor: string | null = null;
        for (let page = 0; page < 10; page++) {
          const url: string = cursor
            ? `/api/v1/employees?limit=100&cursor=${encodeURIComponent(cursor)}`
            : '/api/v1/employees?limit=100';
          const empRes = await fetchWithFrontendCache<{
            items?: EmployeeData[];
            next_cursor?: string | null;
            has_next?: boolean;
          }>(cacheScope, url, { signal: controller.signal });
          if (!active || !empRes.ok || !Array.isArray(empRes.data?.items)) {
            break;
          }
          for (const emp of empRes.data.items) {
            if (emp && emp.id && !seenIds.has(emp.id)) {
              seenIds.add(emp.id);
              allEmployees.push(emp);
            }
          }
          if (empRes.data.has_next && empRes.data.next_cursor) {
            cursor = empRes.data.next_cursor;
          } else {
            break;
          }
        }
        if (active && allEmployees.length > 0) {
          const activeCount = allEmployees.filter(
            (e) => e.employment_status === 'active',
          ).length;
          const invitedCount = allEmployees.filter(
            (e) => e.employment_status === 'invited',
          ).length;
          setEmployeesMetric({
            badgeStatus: 'success',
            badgeLabel: 'Quản lý',
            value: `${activeCount} nhân sự`,
            subtext: `${allEmployees.length} hồ sơ (${invitedCount} chờ duyệt)`,
          });
        } else if (active) {
          setEmployeesMetric({
            badgeStatus: 'success',
            badgeLabel: 'Quản lý',
            value: '0 nhân sự',
            subtext: '0 hồ sơ (0 chờ duyệt)',
          });
        }
      } catch {
        // Keep safe default fallback
      }
    };

    const loadPayrollFallback = async () => {
      if (role !== 'owner') return;
      try {
        const payRes = await fetchWithFrontendCache<PayrollMonthOverviewData>(
          cacheScope,
          `/api/v1/payroll/periods/${currentMonth}`,
          { signal: controller.signal },
        );
        if (active && payRes.ok && payRes.data?.period) {
          const period = payRes.data.period;
          const isFinalized = period.status === 'finalized';
          const empCount = Array.isArray(payRes.data.items)
            ? payRes.data.items.length
            : 0;
          setPayrollMetric({
            badgeStatus: isFinalized ? 'success' : 'warning',
            badgeLabel: isFinalized ? 'Đã chốt sổ' : 'Bản nháp',
            value: `Kỳ ${period.period_month}`,
            subtext: `${empCount} nhân sự trong kỳ lương`,
          });
        }
      } catch {
        // Keep safe default fallback
      }
    };

    const loadSummary = async () => {
      try {
        const summaryRes =
          await fetchWithFrontendCache<DashboardSummaryResponseData>(
            cacheScope,
            summaryUrl,
            { signal: controller.signal },
          );
        if (active && summaryRes.ok && summaryRes.data?.shift) {
          applySummaryData(summaryRes.data);
          return;
        }
      } catch {
        // Fallback to parallel individual endpoints below
      }

      if (!active) return;
      await Promise.all([
        loadAttendanceFallback(),
        loadReportsFallback(),
        loadEmployeesFallback(),
        loadPayrollFallback(),
      ]);
    };

    const loadBridgeData = async () => {
      if (role !== 'owner') return;
      try {
        const res = await fetch('/api/v1/bridge/tiktok-v4', {
          method: 'GET',
          credentials: 'include',
          signal: controller.signal,
        });
        if (!active) return;
        if (!res.ok) {
          const failure = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          setBridgeReadError(
            failure?.error?.message ||
              'Không đọc được dữ liệu từ hệ thống liên kết.',
          );
          return;
        }
        setBridgeReadError(null);
        const json = (await res.json()) as {
          data?: {
            connected?: boolean;
            last_synced_at?: string | null;
            tiktok_v4?: {
              counts?: {
                products?: number;
                channels?: number;
                scripts?: number;
                prompts?: number;
                audio_deliverables?: number;
                video_deliverables?: number;
                active_members?: number;
              };
            };
            management_lite?: {
              active_employees?: number;
              synced_work_items?: number;
              synced_daily_reports?: number;
              storage_drive_connected?: boolean;
              storage_google_email?: string | null;
            };
          };
        };
        if (json?.data && active) {
          setBridgeStatus({
            connected: Boolean(json.data.connected),
            last_synced_at: json.data.last_synced_at ?? null,
            counts: {
              products: json.data.tiktok_v4?.counts?.products ?? 0,
              channels: json.data.tiktok_v4?.counts?.channels ?? 0,
              scripts: json.data.tiktok_v4?.counts?.scripts ?? 0,
              prompts: json.data.tiktok_v4?.counts?.prompts ?? 0,
              audio_deliverables:
                json.data.tiktok_v4?.counts?.audio_deliverables ?? 0,
              video_deliverables:
                json.data.tiktok_v4?.counts?.video_deliverables ?? 0,
              active_members: json.data.tiktok_v4?.counts?.active_members ?? 0,
            },
            management_lite: {
              active_employees:
                json.data.management_lite?.active_employees ?? 0,
              synced_work_items:
                json.data.management_lite?.synced_work_items ?? 0,
              synced_daily_reports:
                json.data.management_lite?.synced_daily_reports ?? 0,
              storage_drive_connected: Boolean(
                json.data.management_lite?.storage_drive_connected,
              ),
              storage_google_email:
                json.data.management_lite?.storage_google_email ?? null,
              employee_mappings: Array.isArray(
                (json.data.management_lite as { employee_mappings?: unknown })
                  ?.employee_mappings,
              )
                ? (
                    json.data.management_lite as {
                      employee_mappings: Array<{
                        employee_code: string;
                        full_name: string;
                        email: string | null;
                        position_title: string | null;
                        v4_linked: boolean;
                      }>;
                    }
                  ).employee_mappings
                : [],
            },
          });
        }
      } catch {
        // Ignore bridge poll error in offline mode
      }
    };

    const loadSystemLogAlert = async () => {
      if (role !== 'owner') return;
      try {
        const res = await fetch('/api/v1/system/logs/summary?hours=24', {
          method: 'GET',
          credentials: 'include',
          signal: controller.signal,
        });
        if (!res.ok || !active) return;
        const json = (await res.json().catch(() => null)) as {
          data?: {
            totals?: { error?: number; warn?: number };
            top_errors?: Array<{
              fingerprint?: string;
              message?: string;
              route?: string | null;
            }>;
          };
        } | null;
        const errCnt = json?.data?.totals?.error ?? 0;
        const warnCnt = json?.data?.totals?.warn ?? 0;
        const top = json?.data?.top_errors?.[0];
        if (active && (errCnt > 0 || (top && warnCnt > 0))) {
          setSystemErrorAlert({
            errorCount: errCnt,
            warnCount: warnCnt,
            topMessage: top?.message ?? null,
            topRoute: top?.route ?? null,
            topFingerprint: top?.fingerprint ?? null,
          });
        } else if (active) {
          setSystemErrorAlert(null);
        }
      } catch {
        // Ignore system log poll failure
      }
    };

    const loadStaffWork = async () => {
      if (role === 'owner') return;
      try {
        const res = await fetch('/api/v1/work-items?limit=100', {
          method: 'GET',
          credentials: 'include',
          signal: controller.signal,
        });
        if (!active || !res.ok) return;
        const json = (await res.json().catch(() => null)) as {
          data?: {
            items?: Array<{ status?: string }>;
          };
        } | null;
        if (!active || !Array.isArray(json?.data?.items)) return;
        const items = json.data.items;
        const openCount = items.filter(
          (i) => i.status !== 'completed' && i.status !== 'cancelled',
        ).length;
        setStaffWorkMetric({
          badgeStatus: openCount > 0 ? 'warning' : 'success',
          badgeLabel: openCount > 0 ? 'Cần làm' : 'Hoàn tất',
          value:
            openCount > 0
              ? `${openCount} việc đang mở`
              : `${items.length} việc`,
          subtext: `${items.length} công việc được phân công`,
        });
      } catch {
        // Keep safe default fallback
      }
    };

    void loadSummary();
    void loadStaffWork();
    void loadBridgeData();
    void loadSystemLogAlert();

    return () => {
      active = false;
      controller.abort();
    };
  }, [role, userId, workspaceId]);

  return (
    <div className="dashboard-page">
      <PageHeader
        title="Tổng quan hoạt động"
        subtitle={`Workspace: ${workspaceName || 'THIẾT KẾ IN ẤN TOÀN GIA PHÁT'} | Múi giờ: Asia/Ho_Chi_Minh`}
        badge={
          <StatusBadge
            status={role === 'owner' ? 'neutral' : 'muted'}
            label={
              role === 'owner' ? 'Chủ sở hữu (Owner)' : 'Nhân viên (Staff)'
            }
          />
        }
        actions={
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
            }}
          >
            {role === 'owner' && (
              <AppButton
                variant="secondary"
                data-testid="dashboard-create-work-btn"
                onClick={() => onNavigate('/work/new')}
              >
                <span>+ Giao việc mới</span>
              </AppButton>
            )}
            <AppButton
              variant="primary"
              className="dashboard-primary-btn"
              onClick={() => onNavigate('/clock')}
            >
              <ClockIcon size={20} />
              <span>Vào Chấm công</span>
            </AppButton>
          </div>
        }
      />

      {/* Summary metric cards */}
      <section aria-label="Số liệu hôm nay" className="dashboard-kpi-grid">
        <AppCard
          padding="20px"
          interactive
          className="dashboard-kpi-card"
          onClick={() => onNavigate('/clock')}
        >
          <span className="dashboard-kpi-label">Trạng thái ca làm</span>
          <span className="dashboard-kpi-value tabular-nums">
            {shiftMetric.value}
          </span>
          <span
            className="dashboard-kpi-status sr-only"
            style={{ color: getStatusColor(shiftMetric.badgeStatus) }}
          >
            {shiftMetric.badgeLabel}
          </span>
          <span className="dashboard-kpi-subtext sr-only">
            {shiftMetric.subtext}
          </span>
        </AppCard>

        <AppCard
          padding="20px"
          interactive
          className="dashboard-kpi-card"
          onClick={() => onNavigate('/reports')}
        >
          <span className="dashboard-kpi-label">Báo cáo hàng ngày</span>
          <span className="dashboard-kpi-value tabular-nums">
            {reportMetric.value}
          </span>
          <span
            className="dashboard-kpi-status sr-only"
            style={{ color: getStatusColor(reportMetric.badgeStatus) }}
          >
            {reportMetric.badgeLabel}
          </span>
          <span className="dashboard-kpi-subtext sr-only">
            {reportMetric.subtext}
          </span>
        </AppCard>

        {role === 'owner' ? (
          <>
            <AppCard
              padding="20px"
              interactive
              className="dashboard-kpi-card"
              onClick={() => onNavigate('/employees')}
            >
              <span className="dashboard-kpi-label">Nhân sự trực tiếp</span>
              <span className="dashboard-kpi-value tabular-nums">
                {employeesMetric.value}
              </span>
              <span
                className="dashboard-kpi-status sr-only"
                style={{ color: getStatusColor(employeesMetric.badgeStatus) }}
              >
                {employeesMetric.badgeLabel}
              </span>
              <span className="dashboard-kpi-subtext sr-only">
                {employeesMetric.subtext}
              </span>
            </AppCard>

            <AppCard
              padding="20px"
              interactive
              className="dashboard-kpi-card"
              onClick={() => onNavigate('/payroll')}
            >
              <span className="dashboard-kpi-label">Kỳ lương</span>
              <span className="dashboard-kpi-value tabular-nums">
                {payrollMetric.value}
              </span>
              <span
                className="dashboard-kpi-status sr-only"
                style={{ color: getStatusColor(payrollMetric.badgeStatus) }}
              >
                {payrollMetric.badgeLabel}
              </span>
              <span className="dashboard-kpi-subtext sr-only">
                {payrollMetric.subtext}
              </span>
            </AppCard>
          </>
        ) : (
          <AppCard
            padding="20px"
            interactive
            className="dashboard-kpi-card"
            onClick={() => onNavigate('/attendance')}
          >
            <span className="dashboard-kpi-label">Công tháng hiện tại</span>
            <span className="dashboard-kpi-value tabular-nums">
              {staffAttendanceMetric.value}
            </span>
            <span
              className="dashboard-kpi-status sr-only"
              style={{
                color: getStatusColor(staffAttendanceMetric.badgeStatus),
              }}
            >
              {staffAttendanceMetric.badgeLabel}
            </span>
            <span className="dashboard-kpi-subtext sr-only">
              {staffAttendanceMetric.subtext}
            </span>
          </AppCard>
        )}
      </section>

      <div className="dashboard-columns">
        {/* Left column: Action Center — Trung tâm Việc cần xử lý */}
        <div className="dashboard-col-left">
          <section
            data-testid="dashboard-action-center"
            className="dashboard-section"
          >
            <div className="dashboard-section-header">
              <h2 className="dashboard-section-title">
                Việc cần xử lý hôm nay
              </h2>
            </div>
            <div className="dashboard-list-card">
              {role === 'owner' ? (
                <>
                  {systemErrorAlert && (
                    <button
                      type="button"
                      data-testid="action-center-system-errors"
                      className="dashboard-list-row"
                      onClick={() => onNavigate('/system-logs')}
                    >
                      <span
                        className="dashboard-dot"
                        style={{
                          backgroundColor: 'var(--danger-color, #b91c1c)',
                        }}
                        aria-hidden="true"
                      />
                      <div className="dashboard-row-body">
                        <span
                          className="dashboard-row-title"
                          style={{ color: 'var(--danger-text, #b91c1c)' }}
                        >
                          {systemErrorAlert.errorCount} lỗi ·{' '}
                          {systemErrorAlert.warnCount} cảnh báo (24h)
                        </span>
                        <span className="dashboard-row-meta">
                          {systemErrorAlert.topRoute ||
                            systemErrorAlert.topMessage ||
                            'Bấm để xem & yêu cầu AI sửa'}
                        </span>
                      </div>
                      <span
                        className="dashboard-row-right"
                        style={{ color: 'var(--danger-text, #b91c1c)' }}
                      >
                        <span>Xử lý</span>
                        <ChevronRightSvg />
                      </span>
                    </button>
                  )}

                  {printQuoteAlert &&
                    (printQuoteAlert.active_orders_count > 0 ||
                      printQuoteAlert.total_receivable_vnd > 0) && (
                      <button
                        type="button"
                        data-testid="action-center-printquote-alerts"
                        className="dashboard-list-row"
                        onClick={() =>
                          onNavigate(
                            printQuoteAlert.total_receivable_vnd > 0
                              ? '/print-quotes/receivables'
                              : '/print-quotes/orders',
                          )
                        }
                      >
                        <span
                          className="dashboard-dot"
                          style={{
                            backgroundColor:
                              printQuoteAlert.total_receivable_vnd > 0
                                ? 'var(--warning-color, #d97706)'
                                : 'var(--accent-color, #0d9488)',
                          }}
                          aria-hidden="true"
                        />
                        <div className="dashboard-row-body">
                          <span className="dashboard-row-title tabular-nums">
                            {printQuoteAlert.total_receivable_vnd > 0
                              ? `${printQuoteAlert.receivable_orders_count} đơn in còn công nợ · ${printQuoteAlert.total_receivable_vnd.toLocaleString('vi-VN')} ₫`
                              : `${printQuoteAlert.active_orders_count} đơn in đang sản xuất / chờ giao`}
                          </span>
                          <span className="dashboard-row-meta">
                            {printQuoteAlert.total_receivable_vnd > 0 &&
                            printQuoteAlert.active_orders_count > 0
                              ? `${printQuoteAlert.active_orders_count} đơn đang xử lý · Bấm để thu tiền / đối soát`
                              : printQuoteAlert.total_receivable_vnd > 0
                                ? 'Bấm để mở Công nợ Phải thu & tạo phiếu thu VietQR'
                                : 'Bấm để theo dõi tiến độ đơn hàng in ấn'}
                          </span>
                        </div>
                        <span
                          className="dashboard-row-right"
                          style={{
                            color:
                              printQuoteAlert.total_receivable_vnd > 0
                                ? 'var(--warning-text, #92400e)'
                                : 'var(--accent-text, #0f766e)',
                          }}
                        >
                          <span>
                            {printQuoteAlert.total_receivable_vnd > 0
                              ? 'Thu nợ'
                              : 'Xem đơn'}
                          </span>
                          <ChevronRightSvg />
                        </span>
                      </button>
                    )}

                  {accountsHealthCount > 0 && (
                    <button
                      type="button"
                      data-testid="action-center-accounts-health"
                      className="dashboard-list-row"
                      onClick={() => onNavigate('/accounts')}
                    >
                      <span
                        className="dashboard-dot"
                        style={{
                          backgroundColor: 'var(--warning-color, #d97706)',
                        }}
                        aria-hidden="true"
                      />
                      <div className="dashboard-row-body">
                        <span
                          className="dashboard-row-title"
                          style={{ color: 'var(--warning-text, #92400e)' }}
                        >
                          {accountsHealthCount} tài khoản cần kiểm tra trạng
                          thái
                        </span>
                        <span className="dashboard-row-meta">
                          Cần xác minh hoặc đang bị khóa — bấm để kiểm tra ngay
                        </span>
                      </div>
                      <span
                        className="dashboard-row-right"
                        style={{ color: 'var(--warning-text, #92400e)' }}
                      >
                        <span>Kiểm tra</span>
                        <ChevronRightSvg />
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    data-testid="action-center-attendance"
                    className="dashboard-list-row"
                    onClick={() => onNavigate('/attendance')}
                  >
                    <span
                      className="dashboard-dot"
                      style={{
                        backgroundColor: 'var(--success-color, #047857)',
                      }}
                      aria-hidden="true"
                    />
                    <div className="dashboard-row-body">
                      <span className="dashboard-row-title">
                        Duyệt ca làm việc
                      </span>
                    </div>
                    <span className="dashboard-row-right">
                      <span>{shiftMetric.value}</span>
                      <ChevronRightSvg />
                    </span>
                  </button>

                  <button
                    type="button"
                    data-testid="action-center-reports"
                    className="dashboard-list-row"
                    onClick={() => onNavigate('/reports')}
                  >
                    <span
                      className="dashboard-dot"
                      style={{
                        backgroundColor: 'var(--info-color, #0369a1)',
                      }}
                      aria-hidden="true"
                    />
                    <div className="dashboard-row-body">
                      <span className="dashboard-row-title">Báo cáo ngày</span>
                    </div>
                    <span className="dashboard-row-right">
                      <span>{reportMetric.value}</span>
                      <ChevronRightSvg />
                    </span>
                  </button>

                  <button
                    type="button"
                    data-testid="action-center-employees"
                    className="dashboard-list-row"
                    onClick={() => onNavigate('/employees')}
                  >
                    <span
                      className="dashboard-dot"
                      style={{
                        backgroundColor: 'var(--primary-color, #0f766e)',
                      }}
                      aria-hidden="true"
                    />
                    <div className="dashboard-row-body">
                      <span className="dashboard-row-title">
                        Hồ sơ &amp; Ngân hàng
                      </span>
                    </div>
                    <span className="dashboard-row-right">
                      <span>{employeesMetric.value}</span>
                      <ChevronRightSvg />
                    </span>
                  </button>

                  <button
                    type="button"
                    data-testid="action-center-payroll"
                    className="dashboard-list-row"
                    onClick={() => onNavigate('/payroll')}
                  >
                    <span
                      className="dashboard-dot"
                      style={{
                        backgroundColor: 'var(--warning-hover, #d97706)',
                      }}
                      aria-hidden="true"
                    />
                    <div className="dashboard-row-body">
                      <span className="dashboard-row-title">
                        Chi trả lương VietQR
                      </span>
                    </div>
                    <span className="dashboard-row-right">
                      <span>
                        {payrollMetric.value} ({payrollMetric.badgeLabel})
                      </span>
                      <ChevronRightSvg />
                    </span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    data-testid="action-center-staff-clock"
                    className="dashboard-list-row"
                    onClick={() => onNavigate('/clock')}
                  >
                    <span
                      className="dashboard-dot"
                      style={{
                        backgroundColor: 'var(--success-color, #047857)',
                      }}
                      aria-hidden="true"
                    />
                    <div className="dashboard-row-body">
                      <span className="dashboard-row-title">
                        Trạng thái ca làm
                      </span>
                    </div>
                    <span className="dashboard-row-right">
                      <span>{shiftMetric.value}</span>
                      <ChevronRightSvg />
                    </span>
                  </button>

                  <button
                    type="button"
                    data-testid="action-center-staff-report"
                    className="dashboard-list-row"
                    onClick={() => onNavigate('/reports/new')}
                  >
                    <span
                      className="dashboard-dot"
                      style={{
                        backgroundColor: 'var(--info-color, #0369a1)',
                      }}
                      aria-hidden="true"
                    />
                    <div className="dashboard-row-body">
                      <span className="dashboard-row-title">
                        Báo cáo hôm nay
                      </span>
                    </div>
                    <span className="dashboard-row-right">
                      <span>{reportMetric.value}</span>
                      <ChevronRightSvg />
                    </span>
                  </button>

                  <button
                    type="button"
                    data-testid="action-center-staff-work"
                    className="dashboard-list-row"
                    onClick={() => onNavigate('/work')}
                  >
                    <span
                      className="dashboard-dot"
                      style={{
                        backgroundColor: 'var(--primary-color, #0f766e)',
                      }}
                      aria-hidden="true"
                    />
                    <div className="dashboard-row-body">
                      <span className="dashboard-row-title">
                        Công việc được giao
                      </span>
                    </div>
                    <span className="dashboard-row-right">
                      <span>{staffWorkMetric.value}</span>
                      <ChevronRightSvg />
                    </span>
                  </button>
                </>
              )}
            </div>
          </section>
        </div>

        {/* Right column: Cross-System V4 Bridge & Quick Action Navigation */}
        <div className="dashboard-col-right">
          {role === 'owner' && (
            <section className="dashboard-section">
              <div className="dashboard-section-header">
                <h2 className="dashboard-section-title">
                  Liên thông TikTok AI Factory (hoaiphuong.click)
                </h2>
                <span
                  style={{
                    fontSize: '13px',
                    fontWeight: 600,
                    color: bridgeStatus?.connected
                      ? 'var(--success-text, #047857)'
                      : 'var(--muted-color, #475569)',
                  }}
                >
                  {bridgeStatus?.connected ? 'Đã kết nối' : 'Chưa kết nối'}
                </span>
              </div>

              <div className="dashboard-list-card">
                <button
                  type="button"
                  className="dashboard-list-row"
                  onClick={() => void handleSyncTikTokV4()}
                  disabled={bridgeSyncing}
                >
                  <span
                    className="dashboard-dot"
                    style={{
                      backgroundColor: bridgeStatus?.connected
                        ? 'var(--success-color, #047857)'
                        : 'var(--primary-color, #0f766e)',
                    }}
                    aria-hidden="true"
                  />
                  <span className="dashboard-row-title" style={{ flexGrow: 1 }}>
                    {bridgeSyncing ? (
                      'Đang đồng bộ…'
                    ) : (
                      <span>
                        Đồng bộ
                        <span className="mobile-hide-label">
                          {' '}
                          nhân sự &amp; công việc
                        </span>
                      </span>
                    )}
                  </span>
                  <ChevronRightSvg />
                </button>

                <button
                  type="button"
                  className="dashboard-list-row"
                  onClick={() => setShowBridgeDetails((v) => !v)}
                >
                  <span
                    className="dashboard-dot"
                    style={{
                      backgroundColor: 'var(--primary-color, #0f766e)',
                    }}
                    aria-hidden="true"
                  />
                  <div className="dashboard-row-body">
                    <span className="dashboard-row-title">
                      {showBridgeDetails ? 'Ẩn chi tiết V4' : 'Chi tiết V4'}
                    </span>
                    {showBridgeDetails && (
                      <span
                        className="dashboard-row-meta"
                        style={{ whiteSpace: 'normal' }}
                      >
                        Đồng bộ nhân sự và công việc với hoaiphuong.click. Báo
                        cáo sản lượng chỉ tự ghi khi có ánh xạ nhân viên và ngày
                        nghiệp vụ đã xác minh.
                      </span>
                    )}
                  </div>
                  <ChevronRightSvg />
                </button>

                <button
                  type="button"
                  className="dashboard-list-row"
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      window.open(
                        'https://hoaiphuong.click',
                        '_blank',
                        'noopener,noreferrer',
                      );
                    }
                  }}
                >
                  <span
                    className="dashboard-dot"
                    style={{
                      backgroundColor: 'var(--info-color, #0369a1)',
                    }}
                    aria-hidden="true"
                  />
                  <span className="dashboard-row-title" style={{ flexGrow: 1 }}>
                    Mở hoaiphuong.click
                  </span>
                  <ChevronRightSvg />
                </button>

                {bridgeReadError && !bridgeFeedback && (
                  <div
                    role="status"
                    style={{
                      padding: '12px 16px',
                      color: THEME_COLORS.warning,
                      fontSize: '13px',
                      borderTop: '1px solid var(--surface-subtle, #f1f5f9)',
                    }}
                  >
                    {bridgeReadError}
                  </div>
                )}
                {bridgeFeedback && bridgeFeedbackError && (
                  <div style={{ padding: '12px 16px' }}>
                    <ErrorState message={bridgeFeedback} />
                  </div>
                )}
                {bridgeFeedback && !bridgeFeedbackError && (
                  <div
                    role="status"
                    aria-live="polite"
                    style={{
                      padding: '12px 16px',
                      backgroundColor: THEME_COLORS.warningSubtle,
                      color: THEME_COLORS.text,
                      fontSize: '13px',
                      borderTop: '1px solid var(--surface-subtle, #f1f5f9)',
                    }}
                  >
                    {bridgeFeedback}
                  </div>
                )}

                <div
                  style={{
                    display: showBridgeDetails ? 'flex' : 'none',
                    flexDirection: 'column',
                  }}
                >
                  <div className="dashboard-list-row dashboard-list-row-static">
                    <span
                      className="dashboard-dot"
                      style={{
                        backgroundColor: 'var(--primary-color, #0f766e)',
                      }}
                      aria-hidden="true"
                    />
                    <span
                      className="dashboard-row-title"
                      style={{ flexGrow: 1 }}
                    >
                      Nhân sự &amp; Member đồng bộ
                    </span>
                    <span className="dashboard-row-right tabular-nums">
                      {bridgeStatus?.counts.active_members ?? '--'}
                    </span>
                  </div>

                  <div className="dashboard-list-row dashboard-list-row-static">
                    <span
                      className="dashboard-dot"
                      style={{
                        backgroundColor: 'var(--info-color, #0369a1)',
                      }}
                      aria-hidden="true"
                    />
                    <span
                      className="dashboard-row-title"
                      style={{ flexGrow: 1 }}
                    >
                      Sản phẩm &amp; Kênh TikTok
                    </span>
                    <span className="dashboard-row-right tabular-nums">
                      {bridgeStatus
                        ? `${bridgeStatus.counts.products} SP / ${bridgeStatus.counts.channels} Kênh`
                        : '--'}
                    </span>
                  </div>

                  <div className="dashboard-list-row dashboard-list-row-static">
                    <span
                      className="dashboard-dot"
                      style={{
                        backgroundColor: 'var(--warning-hover, #d97706)',
                      }}
                      aria-hidden="true"
                    />
                    <span
                      className="dashboard-row-title"
                      style={{ flexGrow: 1 }}
                    >
                      Kịch bản &amp; Prompt AI
                    </span>
                    <span className="dashboard-row-right tabular-nums">
                      {bridgeStatus
                        ? `${bridgeStatus.counts.scripts} KB / ${bridgeStatus.counts.prompts} Prompt`
                        : '--'}
                    </span>
                  </div>

                  <div className="dashboard-list-row dashboard-list-row-static">
                    <span
                      className="dashboard-dot"
                      style={{
                        backgroundColor: 'var(--success-color, #047857)',
                      }}
                      aria-hidden="true"
                    />
                    <span
                      className="dashboard-row-title"
                      style={{ flexGrow: 1 }}
                    >
                      Thành phẩm Video / Audio Drive
                    </span>
                    <span className="dashboard-row-right tabular-nums">
                      {bridgeStatus
                        ? `${bridgeStatus.counts.video_deliverables} MP4 / ${bridgeStatus.counts.audio_deliverables} WAV`
                        : '--'}
                    </span>
                  </div>

                  {/* Bảng xác nhận ánh xạ nhân sự cố định giữa ql.hoaiphuong.click (NV001..NV00n) & hoaiphuong.click */}
                  <div
                    data-testid="bridge-employee-mapping-table"
                    style={{
                      padding: '14px 16px',
                      borderTop: '1px solid var(--surface-subtle, #f1f5f9)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '8px',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          color: 'var(--text-color)',
                        }}
                      >
                        Bảng xác nhận ánh xạ nhân sự cố định (Management Lite ↔
                        TikTok AI Factory V4)
                      </span>
                      <span
                        style={{
                          fontSize: '12px',
                          color: 'var(--muted-color)',
                        }}
                      >
                        Khóa định danh: Mã NV cố định + Email tài khoản xác thực
                      </span>
                    </div>
                    {bridgeStatus?.management_lite?.employee_mappings &&
                    bridgeStatus.management_lite.employee_mappings.length >
                      0 ? (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                        }}
                      >
                        {bridgeStatus.management_lite.employee_mappings.map(
                          (emp) => (
                            <div
                              key={emp.employee_code}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                flexWrap: 'wrap',
                                fontSize: '13px',
                              }}
                            >
                              <span
                                className="dashboard-dot"
                                style={{
                                  backgroundColor: emp.v4_linked
                                    ? 'var(--success-color, #047857)'
                                    : 'var(--warning-hover, #d97706)',
                                }}
                                aria-hidden="true"
                              />
                              <strong style={{ color: 'var(--info-text)' }}>
                                {emp.employee_code}
                              </strong>
                              <span
                                style={{
                                  color: 'var(--text-color)',
                                  fontWeight: 600,
                                }}
                              >
                                {emp.full_name}
                              </span>
                              <span style={{ color: 'var(--muted-color)' }}>
                                ({emp.email || 'Chưa có email'})
                              </span>
                              <span
                                style={{
                                  marginLeft: 'auto',
                                  fontSize: '12px',
                                  fontWeight: 600,
                                  color: emp.v4_linked
                                    ? 'var(--success-text)'
                                    : 'var(--warning-text)',
                                }}
                              >
                                {emp.v4_linked
                                  ? '✓ Đã ánh xạ V4'
                                  : '⚠️ Thiếu email'}
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--muted-color)',
                        }}
                      >
                        Đang tải danh sách ánh xạ mã nhân viên cố định (NV001,
                        NV002…) với tài khoản V4…
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Quick Action Navigation Grid */}
          <section className="dashboard-section">
            <div className="dashboard-section-header">
              <h2 className="dashboard-section-title">
                Lối tắt thao tác nhanh
              </h2>
              <button
                type="button"
                className="dashboard-link-btn"
                onClick={() => setShowQuickActions((v) => !v)}
              >
                {showQuickActions ? 'Thu gọn lối tắt' : 'Mở tất cả lối tắt'}
              </button>
            </div>

            <div
              className="quick-actions-grid dashboard-quick-grid"
              style={{
                display: showQuickActions ? 'grid' : 'none',
                gridTemplateColumns:
                  'repeat(auto-fill, minmax(min(100%, 240px), 1fr))',
                gap: '12px',
              }}
            >
              {(
                [
                  {
                    path: '/clock',
                    dot: 'var(--success-color, #047857)',
                    title: 'Chấm công',
                    desc: 'Vào ca, tạm nghỉ, kết thúc ca',
                    show: true,
                  },
                  {
                    path: '/work',
                    dot: 'var(--primary-color, #0f766e)',
                    title: 'Công việc',
                    desc: 'Giao việc, tiến độ & nghiệm thu',
                    show: true,
                  },
                  {
                    path: '/reports',
                    dot: 'var(--info-color, #0369a1)',
                    title: 'Báo cáo',
                    desc: 'Báo cáo công việc hàng ngày',
                    show: true,
                  },
                  {
                    path: '/schedule',
                    dot: 'var(--primary-color, #0f766e)',
                    title: 'Lịch làm việc',
                    desc: 'Xếp ca và theo dõi lịch tuần',
                    show: true,
                  },
                  {
                    path: '/storage',
                    dot: 'var(--info-color, #0369a1)',
                    title: 'Lưu trữ & Drive',
                    desc: 'Thư mục nguồn & thành phẩm',
                    show: true,
                  },
                  {
                    path: '/employees',
                    dot: 'var(--primary-color, #0f766e)',
                    title: 'Nhân viên',
                    desc: 'Hồ sơ nhân sự & ngân hàng',
                    show: role === 'owner',
                  },
                  {
                    path: '/payroll',
                    dot: 'var(--warning-hover, #d97706)',
                    title: 'Bảng lương',
                    desc: 'Kỳ lương & chi trả VietQR',
                    show: role === 'owner',
                  },
                  {
                    path: '/finance',
                    dot: 'var(--success-color, #047857)',
                    title: 'Tài chính',
                    desc: 'Sổ thu chi & kế hoạch',
                    show: role === 'owner',
                  },
                  {
                    path: '/accounts',
                    dot: 'var(--primary-color, #0f766e)',
                    title: 'Tài khoản dùng chung',
                    desc: 'Quản lý tài khoản dùng chung',
                    show: role === 'owner',
                  },
                  {
                    path: '/issues',
                    dot: 'var(--danger-color, #b91c1c)',
                    title: 'Vấn đề & Issues',
                    desc: 'Ghi nhận lỗi & đề xuất cải tiến',
                    show: role === 'owner',
                  },
                  {
                    path: '/my-pay',
                    dot: 'var(--warning-hover, #d97706)',
                    title: 'Lương cá nhân',
                    desc: 'Xem phiếu lương & chi tiết công',
                    show: role !== 'owner',
                  },
                  {
                    path: '/settings',
                    dot: 'var(--disabled-color, #94a3b8)',
                    title: 'Cài đặt',
                    desc: 'Hồ sơ cá nhân & giao diện',
                    show: true,
                  },
                ] as const
              )
                .filter((item) => item.show)
                .map((item) => (
                  <AppCard
                    key={item.path}
                    padding="12px 16px"
                    interactive
                    className="dashboard-quick-card"
                    onClick={() => onNavigate(item.path)}
                  >
                    <span
                      className="dashboard-dot"
                      style={{ backgroundColor: item.dot }}
                      aria-hidden="true"
                    />
                    <div className="dashboard-row-body">
                      <div className="dashboard-row-title">{item.title}</div>
                      <div className="quick-action-desc dashboard-row-meta">
                        {item.desc}
                      </div>
                    </div>
                    <ChevronRightSvg />
                  </AppCard>
                ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
