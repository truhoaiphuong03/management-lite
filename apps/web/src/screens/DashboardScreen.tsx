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
  ErrorState,
  useAutoDismiss,
} from '../../../../packages/ui/src/components/index.js';
import { THEME_COLORS } from '../../../../packages/ui/src/tokens.js';
import type { UserRole } from '../types.js';
import type { AttendanceMeResponseData } from '../../../../packages/contracts/src/attendance.js';
import type { DailyReportListItem } from '../../../../packages/contracts/src/reports.js';
import type { EmployeeData } from '../../../../packages/contracts/src/employees.js';
import type { PayrollMonthOverviewData } from '../../../../packages/contracts/src/payroll.js';
import type { DashboardSummaryResponseData } from '../../../../packages/contracts/src/dashboard.js';
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
  userId,
  workspaceId,
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

    void loadSummary();
    void loadBridgeData();
    void loadSystemLogAlert();

    return () => {
      active = false;
      controller.abort();
    };
  }, [role, userId, workspaceId]);

  return (
    <div>
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
        className="kpi-grid-4"
        style={{
          display: 'grid',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
          gap: '14px',
          marginBottom: '20px',
        }}
      >
        <AppCard
          padding="16px"
          interactive
          style={{ cursor: 'pointer' }}
          onClick={() => onNavigate('/clock')}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              gap: '4px',
            }}
          >
            <span
              style={{
                fontSize: '13px',
                color: 'var(--muted-color)',
                fontWeight: 500,
              }}
            >
              Trạng thái ca làm
            </span>
            <StatusBadge
              status={shiftMetric.badgeStatus}
              label={shiftMetric.badgeLabel}
            />
          </div>
          <div
            style={{
              fontSize: '22px',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              margin: '8px 0 4px 0',
              color: 'var(--text-color)',
            }}
          >
            {shiftMetric.value}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
            {shiftMetric.subtext}
          </div>
        </AppCard>

        <AppCard
          padding="16px"
          interactive
          style={{ cursor: 'pointer' }}
          onClick={() => onNavigate('/reports')}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
              gap: '4px',
            }}
          >
            <span
              style={{
                fontSize: '13px',
                color: 'var(--muted-color)',
                fontWeight: 500,
              }}
            >
              Báo cáo hàng ngày
            </span>
            <StatusBadge
              status={reportMetric.badgeStatus}
              label={reportMetric.badgeLabel}
            />
          </div>
          <div
            style={{
              fontSize: '22px',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              margin: '8px 0 4px 0',
              color: 'var(--text-color)',
            }}
          >
            {reportMetric.value}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
            {reportMetric.subtext}
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
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: '4px',
                }}
              >
                <span
                  style={{
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                    fontWeight: 500,
                  }}
                >
                  Nhân sự trực tiếp
                </span>
                <StatusBadge
                  status={employeesMetric.badgeStatus}
                  label={employeesMetric.badgeLabel}
                />
              </div>
              <div
                style={{
                  fontSize: '22px',
                  fontWeight: 700,
                  margin: '8px 0 4px 0',
                  color: 'var(--text-color)',
                }}
              >
                {employeesMetric.value}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                {employeesMetric.subtext}
              </div>
            </AppCard>

            <AppCard
              padding="16px"
              interactive
              style={{ cursor: 'pointer' }}
              onClick={() => onNavigate('/payroll')}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: '4px',
                }}
              >
                <span
                  style={{
                    fontSize: '13px',
                    color: 'var(--muted-color)',
                    fontWeight: 500,
                  }}
                >
                  Kỳ lương
                </span>
                <StatusBadge
                  status={payrollMetric.badgeStatus}
                  label={payrollMetric.badgeLabel}
                />
              </div>
              <div
                style={{
                  fontSize: '22px',
                  fontWeight: 700,
                  margin: '8px 0 4px 0',
                  color: 'var(--text-color)',
                }}
              >
                {payrollMetric.value}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
                {payrollMetric.subtext}
              </div>
            </AppCard>
          </>
        ) : (
          <AppCard
            padding="16px"
            interactive
            style={{ cursor: 'pointer' }}
            onClick={() => onNavigate('/attendance')}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
              }}
            >
              <span
                style={{
                  fontSize: '13px',
                  color: 'var(--muted-color)',
                  fontWeight: 500,
                }}
              >
                Công tháng hiện tại
              </span>
              <StatusBadge
                status={staffAttendanceMetric.badgeStatus}
                label={staffAttendanceMetric.badgeLabel}
              />
            </div>
            <div
              style={{
                fontSize: '22px',
                fontWeight: 700,
                margin: '8px 0 4px 0',
                color: 'var(--text-color)',
              }}
            >
              {staffAttendanceMetric.value}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--muted-color)' }}>
              {staffAttendanceMetric.subtext}
            </div>
          </AppCard>
        )}
      </div>

      {/* Action Center — Trung tâm Việc cần xử lý */}
      <div
        data-testid="dashboard-action-center"
        style={{
          marginBottom: '20px',
          padding: '14px 16px',
          borderRadius: '12px',
          backgroundColor: 'var(--surface-subtle)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          <h3
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--text-color)',
              margin: 0,
            }}
          >
            Việc cần xử lý hôm nay
          </h3>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns:
              'repeat(auto-fit, minmax(min(100%, 210px), 1fr))',
            gap: '10px',
          }}
        >
          {role === 'owner' ? (
            <>
              {systemErrorAlert && (
                <button
                  type="button"
                  data-testid="action-center-system-errors"
                  onClick={() => onNavigate('/system-logs')}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    textAlign: 'left',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid rgba(239, 68, 68, 0.45)',
                    backgroundColor: 'rgba(239, 68, 68, 0.1)',
                    color: 'var(--text-color)',
                    cursor: 'pointer',
                    gap: '8px',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '12px',
                        fontWeight: 700,
                        color: 'var(--danger-text)',
                      }}
                    >
                      {systemErrorAlert.errorCount} lỗi ·{' '}
                      {systemErrorAlert.warnCount} cảnh báo (24h)
                    </div>
                    <div
                      style={{
                        fontSize: '12px',
                        color: 'var(--muted-color)',
                        marginTop: '2px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {systemErrorAlert.topRoute ||
                        systemErrorAlert.topMessage ||
                        'Bấm để xem & yêu cầu AI sửa'}
                    </div>
                  </div>
                  <span
                    style={{
                      fontSize: '12px',
                      color: 'var(--danger-text)',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Xử lý →
                  </span>
                </button>
              )}
              <button
                type="button"
                data-testid="action-center-attendance"
                onClick={() => onNavigate('/attendance')}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--surface-hover)',
                  color: 'var(--text-color)',
                  cursor: 'pointer',
                  gap: '8px',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--text-color)',
                    }}
                  >
                    Duyệt ca làm việc
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                      marginTop: '2px',
                    }}
                  >
                    {shiftMetric.value}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: '12px',
                    color: 'var(--accent-text)',
                    fontWeight: 600,
                  }}
                >
                  Mở →
                </span>
              </button>

              <button
                type="button"
                data-testid="action-center-reports"
                onClick={() => onNavigate('/reports')}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--surface-hover)',
                  color: 'var(--text-color)',
                  cursor: 'pointer',
                  gap: '8px',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--text-color)',
                    }}
                  >
                    Báo cáo ngày
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                      marginTop: '2px',
                    }}
                  >
                    {reportMetric.value}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: '12px',
                    color: 'var(--accent-text)',
                    fontWeight: 600,
                  }}
                >
                  Xem →
                </span>
              </button>

              <button
                type="button"
                data-testid="action-center-employees"
                onClick={() => onNavigate('/employees')}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--surface-hover)',
                  color: 'var(--text-color)',
                  cursor: 'pointer',
                  gap: '8px',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--text-color)',
                    }}
                  >
                    Hồ sơ & Ngân hàng
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                      marginTop: '2px',
                    }}
                  >
                    {employeesMetric.value}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: '12px',
                    color: 'var(--accent-text)',
                    fontWeight: 600,
                  }}
                >
                  Mở →
                </span>
              </button>

              <button
                type="button"
                data-testid="action-center-payroll"
                onClick={() => onNavigate('/payroll')}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--surface-hover)',
                  color: 'var(--text-color)',
                  cursor: 'pointer',
                  gap: '8px',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--text-color)',
                    }}
                  >
                    Chi trả lương VietQR
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                      marginTop: '2px',
                    }}
                  >
                    {payrollMetric.value} ({payrollMetric.badgeLabel})
                  </div>
                </div>
                <span
                  style={{
                    fontSize: '12px',
                    color: 'var(--accent-text)',
                    fontWeight: 600,
                  }}
                >
                  Mở →
                </span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                data-testid="action-center-staff-clock"
                onClick={() => onNavigate('/clock')}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--surface-hover)',
                  color: 'var(--text-color)',
                  cursor: 'pointer',
                  gap: '8px',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--text-color)',
                    }}
                  >
                    Trạng thái ca làm
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                      marginTop: '2px',
                    }}
                  >
                    {shiftMetric.value}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: '12px',
                    color: 'var(--accent-text)',
                    fontWeight: 600,
                  }}
                >
                  Vào/ra ca →
                </span>
              </button>

              <button
                type="button"
                data-testid="action-center-staff-report"
                onClick={() => onNavigate('/reports/new')}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--surface-hover)',
                  color: 'var(--text-color)',
                  cursor: 'pointer',
                  gap: '8px',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--text-color)',
                    }}
                  >
                    Báo cáo hôm nay
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                      marginTop: '2px',
                    }}
                  >
                    {reportMetric.value}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: '12px',
                    color: 'var(--accent-text)',
                    fontWeight: 600,
                  }}
                >
                  Nộp →
                </span>
              </button>

              <button
                type="button"
                data-testid="action-center-staff-work"
                onClick={() => onNavigate('/work')}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--surface-hover)',
                  color: 'var(--text-color)',
                  cursor: 'pointer',
                  gap: '8px',
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      color: 'var(--text-color)',
                    }}
                  >
                    Công việc được giao
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--muted-color)',
                      marginTop: '2px',
                    }}
                  >
                    {staffAttendanceMetric.value}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: '12px',
                    color: 'var(--accent-text)',
                    fontWeight: 600,
                  }}
                >
                  Xem →
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Quick Action Navigation Grid */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: showQuickActions ? '12px' : '0',
        }}
      >
        <h3
          style={{
            fontSize: '13px',
            fontWeight: 600,
            margin: 0,
            color: 'var(--muted-color)',
          }}
        >
          Lối tắt thao tác nhanh
        </h3>
        <button
          type="button"
          onClick={() => setShowQuickActions((v) => !v)}
          style={{
            border: '1px solid var(--border-color)',
            backgroundColor: 'transparent',
            color: 'var(--muted-color)',
            borderRadius: '6px',
            padding: '4px 10px',
            fontSize: '12px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {showQuickActions ? 'Thu gọn lối tắt' : 'Mở tất cả lối tắt'}
        </button>
      </div>
      <div
        className="quick-actions-grid"
        style={{
          display: showQuickActions ? 'grid' : 'none',
          gridTemplateColumns:
            'repeat(auto-fill, minmax(min(100%, 240px), 1fr))',
          gap: '10px',
        }}
      >
        {(
          [
            {
              path: '/clock',
              icon: <ClockIcon size={20} />,
              title: 'Chấm công',
              desc: 'Vào ca, tạm nghỉ, kết thúc ca',
              show: true,
            },
            {
              path: '/work',
              icon: <NavIcon id="work" size={20} />,
              title: 'Công việc',
              desc: 'Giao việc, tiến độ & nghiệm thu',
              show: true,
            },
            {
              path: '/reports',
              icon: <FileTextIcon size={20} />,
              title: 'Báo cáo',
              desc: 'Báo cáo công việc hàng ngày',
              show: true,
            },
            {
              path: '/schedule',
              icon: <NavIcon id="schedule" size={20} />,
              title: 'Lịch làm việc',
              desc: 'Xếp ca và theo dõi lịch tuần',
              show: true,
            },
            {
              path: '/storage',
              icon: <NavIcon id="storage" size={20} />,
              title: 'Lưu trữ & Drive',
              desc: 'Thư mục nguồn & thành phẩm',
              show: true,
            },
            {
              path: '/employees',
              icon: <NavIcon id="employees" size={20} />,
              title: 'Nhân viên',
              desc: 'Hồ sơ nhân sự & ngân hàng',
              show: role === 'owner',
            },
            {
              path: '/payroll',
              icon: <BanknoteIcon size={20} />,
              title: 'Bảng lương',
              desc: 'Kỳ lương & chi trả VietQR',
              show: role === 'owner',
            },
            {
              path: '/finance',
              icon: <NavIcon id="finance" size={20} />,
              title: 'Tài chính',
              desc: 'Sổ thu chi & kế hoạch',
              show: role === 'owner',
            },
            {
              path: '/accounts',
              icon: <NavIcon id="accounts" size={20} />,
              title: 'Tài khoản dùng chung',
              desc: 'Quản lý tài khoản dùng chung',
              show: role === 'owner',
            },
            {
              path: '/issues',
              icon: <NavIcon id="issues" size={20} />,
              title: 'Vấn đề & Issues',
              desc: 'Ghi nhận lỗi & đề xuất cải tiến',
              show: role === 'owner',
            },
            {
              path: '/my-pay',
              icon: <BanknoteIcon size={20} />,
              title: 'Lương cá nhân',
              desc: 'Xem phiếu lương & chi tiết công',
              show: role !== 'owner',
            },
            {
              path: '/settings',
              icon: <SettingsIcon size={20} />,
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
              padding="12px 14px"
              interactive
              style={{
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
              onClick={() => onNavigate(item.path)}
            >
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '10px',
                  backgroundColor: 'rgba(20, 184, 166, 0.12)',
                  border: '1px solid rgba(45, 212, 191, 0.25)',
                  color: 'var(--accent-text)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {item.icon}
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: '14px',
                    color: 'var(--text-color)',
                    marginBottom: '2px',
                  }}
                >
                  {item.title}
                </div>
                <div
                  className="quick-action-desc"
                  style={{
                    fontSize: '12px',
                    color: 'var(--muted-color)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {item.desc}
                </div>
              </div>
            </AppCard>
          ))}
      </div>

      {/* Cross-System Data Bridge: ql.hoaiphuong.click <-> hoaiphuong.click (Owner only) */}
      {role === 'owner' && (
        <div style={{ marginTop: '20px' }}>
          <AppCard padding="16px">
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '12px',
                marginBottom: showBridgeDetails ? '16px' : '0',
              }}
            >
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    flexWrap: 'wrap',
                  }}
                >
                  <h2
                    style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: 'var(--text-color)',
                      margin: 0,
                    }}
                  >
                    Liên thông TikTok AI Factory (hoaiphuong.click)
                  </h2>
                  <StatusBadge
                    status={bridgeStatus?.connected ? 'success' : 'neutral'}
                    label={
                      bridgeStatus?.connected ? 'Đã kết nối' : 'Chưa kết nối'
                    }
                  />
                </div>
                {showBridgeDetails && (
                  <div
                    style={{
                      fontSize: '13px',
                      color: 'var(--muted-color)',
                      marginTop: '4px',
                    }}
                  >
                    Đồng bộ nhân sự và công việc với hoaiphuong.click. Báo cáo
                    sản lượng chỉ tự ghi khi có ánh xạ nhân viên và ngày nghiệp
                    vụ đã xác minh.
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {role === 'owner' && (
                  <AppButton
                    variant="primary"
                    onClick={() => void handleSyncTikTokV4()}
                    disabled={bridgeSyncing}
                    style={{ padding: '6px 12px', fontSize: '12.5px' }}
                  >
                    {bridgeSyncing ? (
                      'Đang đồng bộ…'
                    ) : (
                      <span>
                        Đồng bộ
                        <span className="mobile-hide-label">
                          {' '}
                          nhân sự & công việc
                        </span>
                      </span>
                    )}
                  </AppButton>
                )}
                <AppButton
                  variant="secondary"
                  onClick={() => setShowBridgeDetails((v) => !v)}
                  style={{ padding: '6px 12px', fontSize: '12.5px' }}
                >
                  {showBridgeDetails ? 'Ẩn chi tiết V4' : 'Chi tiết V4'}
                </AppButton>
                <AppButton
                  variant="secondary"
                  onClick={() => {
                    if (typeof window !== 'undefined') {
                      window.open(
                        'https://hoaiphuong.click',
                        '_blank',
                        'noopener,noreferrer',
                      );
                    }
                  }}
                  style={{ padding: '6px 12px', fontSize: '12.5px' }}
                >
                  <span>
                    Mở
                    <span className="mobile-hide-label"> hoaiphuong.click</span>
                  </span>
                </AppButton>
              </div>
            </div>

            {bridgeReadError && !bridgeFeedback && (
              <p
                role="status"
                style={{ color: THEME_COLORS.warning, marginBottom: '12px' }}
              >
                {bridgeReadError}
              </p>
            )}
            {bridgeFeedback && bridgeFeedbackError && (
              <ErrorState message={bridgeFeedback} />
            )}
            {bridgeFeedback && !bridgeFeedbackError && (
              <div
                role="status"
                aria-live="polite"
                style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  backgroundColor: THEME_COLORS.warningSubtle,
                  border: `1px solid ${THEME_COLORS.warning}`,
                  color: THEME_COLORS.text,
                  fontSize: '13px',
                  marginBottom: '16px',
                }}
              >
                {bridgeFeedback}
              </div>
            )}

            <div
              style={{
                display: showBridgeDetails ? 'block' : 'none',
                marginTop: '14px',
              }}
            >
              <div
                className="kpi-grid-4"
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid rgba(148, 163, 184, 0.15)',
                  }}
                >
                  <div
                    style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                  >
                    Nhân sự &amp; Member đồng bộ
                  </div>
                  <div
                    style={{
                      fontSize: '20px',
                      fontWeight: 700,
                      color: 'var(--text-color)',
                      marginTop: '4px',
                    }}
                  >
                    {bridgeStatus?.counts.active_members ?? '--'}
                  </div>
                </div>

                <div
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid rgba(148, 163, 184, 0.15)',
                  }}
                >
                  <div
                    style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                  >
                    Sản phẩm &amp; Kênh TikTok
                  </div>
                  <div
                    style={{
                      fontSize: '20px',
                      fontWeight: 700,
                      color: 'var(--text-color)',
                      marginTop: '4px',
                    }}
                  >
                    {bridgeStatus
                      ? `${bridgeStatus.counts.products} SP / ${bridgeStatus.counts.channels} Kênh`
                      : '--'}
                  </div>
                </div>

                <div
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid rgba(148, 163, 184, 0.15)',
                  }}
                >
                  <div
                    style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                  >
                    Kịch bản &amp; Prompt AI
                  </div>
                  <div
                    style={{
                      fontSize: '20px',
                      fontWeight: 700,
                      color: 'var(--text-color)',
                      marginTop: '4px',
                    }}
                  >
                    {bridgeStatus
                      ? `${bridgeStatus.counts.scripts} KB / ${bridgeStatus.counts.prompts} Prompt`
                      : '--'}
                  </div>
                </div>

                <div
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    backgroundColor: 'var(--surface-subtle)',
                    border: '1px solid rgba(148, 163, 184, 0.15)',
                  }}
                >
                  <div
                    style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                  >
                    Thành phẩm Video / Audio Drive
                  </div>
                  <div
                    style={{
                      fontSize: '20px',
                      fontWeight: 700,
                      color: 'var(--text-color)',
                      marginTop: '4px',
                    }}
                  >
                    {bridgeStatus
                      ? `${bridgeStatus.counts.video_deliverables} MP4 / ${bridgeStatus.counts.audio_deliverables} WAV`
                      : '--'}
                  </div>
                </div>
              </div>

              {/* Bảng xác nhận ánh xạ nhân sự cố định giữa ql.hoaiphuong.click (NV001..NV00n) & hoaiphuong.click */}
              <div
                data-testid="bridge-employee-mapping-table"
                style={{
                  marginTop: '16px',
                  padding: '12px 14px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--surface-subtle)',
                  border: '1px solid rgba(56, 189, 248, 0.22)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '8px',
                    marginBottom: '8px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '13px',
                      fontWeight: 600,
                      color: 'var(--text-color)',
                    }}
                  >
                    🔗 Bảng xác nhận ánh xạ nhân sự cố định (Management Lite ↔
                    TikTok AI Factory V4)
                  </span>
                  <span
                    style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                  >
                    Khóa định danh: Mã NV cố định + Email tài khoản xác thực
                  </span>
                </div>
                {bridgeStatus?.management_lite?.employee_mappings &&
                bridgeStatus.management_lite.employee_mappings.length > 0 ? (
                  <div
                    style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}
                  >
                    {bridgeStatus.management_lite.employee_mappings.map(
                      (emp) => (
                        <div
                          key={emp.employee_code}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '6px 10px',
                            borderRadius: '6px',
                            backgroundColor: 'var(--surface-hover)',
                            border: `1px solid ${emp.v4_linked ? 'rgba(16, 185, 129, 0.35)' : 'rgba(245, 158, 11, 0.35)'}`,
                            fontSize: '12px',
                          }}
                        >
                          <strong style={{ color: 'var(--info-text)' }}>
                            {emp.employee_code}
                          </strong>
                          <span style={{ color: 'var(--text-color)' }}>
                            {emp.full_name}
                          </span>
                          <span style={{ color: 'var(--muted-color)' }}>
                            ({emp.email || 'Chưa có email'})
                          </span>
                          <span
                            style={{
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
                    style={{ fontSize: '12px', color: 'var(--muted-color)' }}
                  >
                    Đang tải danh sách ánh xạ mã nhân viên cố định (NV001,
                    NV002…) với tài khoản V4…
                  </div>
                )}
              </div>
            </div>
          </AppCard>
        </div>
      )}
    </div>
  );
};
