import React, { useCallback, useEffect, useState } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  LoadingState,
  EmptyState,
  useAutoDismiss,
} from '../../../../packages/ui/src/components/index.js';
import type { UserRole } from '../types.js';

export interface PayrollStatsScreenProps {
  role?: UserRole;
  onNavigate?: (path: string) => void;
}

type Granularity = 'day' | 'week' | 'month' | 'year';
interface ReportLink {
  id: string;
  status: 'draft' | 'submitted';
  total_reported_count: number;
  notes: string | null;
}
interface DayRow {
  employee_id: string;
  employee_name: string;
  employee_code: string;
  work_date: string;
  worked_seconds: number;
  wage_vnd: number;
  hourly_rate_vnd: number;
  report: ReportLink | null;
}
interface EmployeeTotal {
  employee_id: string;
  employee_name: string;
  employee_code: string;
  worked_seconds: number;
  wage_vnd: number;
  work_days: number;
  report_days: number;
}
interface Bucket {
  key: string;
  label: string;
  from: string;
  to: string;
  worked_hours: number;
  work_days: number;
  wage_vnd: number;
  report_days: number;
  reported_clips: number;
  missing_report_days: number;
  employees: EmployeeTotal[];
  days?: DayRow[];
}
interface StatsData {
  granularity: Granularity;
  from: string;
  to: string;
  totals: Omit<Bucket, 'key' | 'label' | 'from' | 'to' | 'days'>;
  buckets: Bucket[];
  notes: string[];
}
interface EmployeeOption {
  id: string;
  employee_code: string;
  full_name: string;
  is_payroll_eligible?: boolean;
}
interface GoogleSheetDayRecon {
  date: string;
  month: number;
  rate_vnd: number;
  system_start: string | null;
  system_end: string | null;
  system_minutes: number;
  system_hours: number;
  system_wage_vnd: number;
  system_source: 'clock' | 'import' | 'mixed' | null;
  excel_start: string | null;
  excel_end: string | null;
  excel_minutes: number;
  excel_hours: number;
  excel_wage_vnd: number;
  task: string;
  diff_minutes: number;
  diff_wage_vnd: number;
  status: 'matched' | 'diff_hours' | 'only_excel' | 'only_system';
}
interface GoogleSheetMonthRecon {
  month: string;
  rate_vnd: number;
  system_days: number;
  system_minutes: number;
  system_hours: number;
  system_wage_vnd: number;
  excel_days: number;
  excel_minutes: number;
  excel_hours: number;
  excel_wage_vnd: number;
  excel_formula_wage_vnd: number;
  diff_days: number;
  diff_minutes: number;
  diff_hours: number;
  diff_wage_vnd: number;
  matched_days: number;
  diff_hours_days: number;
  only_excel_days: number;
  only_system_days: number;
  status: 'matched' | 'mismatch';
}
interface GoogleSheetReconSummary {
  months: GoogleSheetMonthRecon[];
  days: GoogleSheetDayRecon[];
  totals: {
    system_days: number;
    system_minutes: number;
    system_hours: number;
    system_wage_vnd: number;
    excel_days: number;
    excel_minutes: number;
    excel_hours: number;
    excel_wage_vnd: number;
    excel_formula_wage_vnd: number;
    diff_days: number;
    diff_minutes: number;
    diff_hours: number;
    diff_wage_vnd: number;
    matched_days: number;
    diff_hours_days: number;
    only_excel_days: number;
    only_system_days: number;
  };
}
interface GoogleSheetSyncResponse {
  committed: boolean;
  sheet_id: string;
  sheet_url: string;
  source_mode: 'live_google_sheet' | 'uploaded_file' | 'canonical_fallback';
  year: number;
  employee: {
    id: string;
    code: string;
    full_name: string;
    bank_name: string | null;
    bank_account_number: string | null;
  };
  nv002_status: {
    found: boolean;
    removed_from_payroll: boolean;
    shifts_removed: number;
  };
  before_reconciliation: GoogleSheetReconSummary;
  reconciliation: GoogleSheetReconSummary;
  warnings: string[];
}

const DEFAULT_GOOGLE_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/11n-8Q2hjTZL9eC2RfHZoPTi6a5XHgQSVzFFl2qE-ktw/edit?usp=drive_link';
interface ImportResult {
  committed: boolean;
  year: number;
  employee: { id: string; code: string; full_name: string; created: boolean };
  months: {
    month: string;
    shifts_new: number;
    shifts_skipped: number;
    hours: number;
    expected_wage_vnd: number | null;
    rate_vnd: number | null;
  }[];
  totals: {
    shifts_new: number;
    shifts_skipped: number;
    hours: number;
    expected_wage_vnd: number | null;
    rates_created: number;
    reports_created: number;
  };
  warnings: string[];
}

const GRAN_LABEL: Record<Granularity, string> = {
  day: 'Ngày',
  week: 'Tuần',
  month: 'Tháng',
  year: 'Năm',
};
const fmtVnd = (n: number): string =>
  `${Math.round(n).toLocaleString('vi-VN')} đ`;
const fmtDate = (d: string): string =>
  `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const todayVn = (): string =>
  new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

const card: React.CSSProperties = { marginBottom: 16 };
const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
  gap: 12,
};
const field: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 13,
  minWidth: 0,
};
const input: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 8,
  border: '1px solid var(--border-color)',
  background: 'var(--bg-color)',
  color: 'var(--text-color)',
  font: 'inherit',
  minWidth: 0,
};
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid var(--border-color)',
  fontSize: 12,
  opacity: 0.75,
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--border-subtle)',
  fontSize: 14,
  verticalAlign: 'top',
};
const num: React.CSSProperties = {
  ...td,
  textAlign: 'right',
  whiteSpace: 'nowrap',
};

export const PayrollStatsScreen: React.FC<PayrollStatsScreenProps> = ({
  role = 'owner',
  onNavigate,
}) => {
  const year = Number(todayVn().slice(0, 4));
  const [granularity, setGranularity] = useState<Granularity>('month');
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(todayVn());
  const [employeeId, setEmployeeId] = useState('');
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [csrf, setCsrf] = useState('');

  const [xlsYear, setXlsYear] = useState(year);
  const [xlsEmployee, setXlsEmployee] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [newName, setNewName] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  useAutoDismiss(importMsg, () => setImportMsg(null), 4000);
  const [preview, setPreview] = useState<ImportResult | null>(null);

  const [sheetUrl, setSheetUrl] = useState(DEFAULT_GOOGLE_SHEET_URL);
  const [removeNv002, setRemoveNv002] = useState(true);
  const [preserveNewerWeb, setPreserveNewerWeb] = useState(true);
  const [gsBusy, setGsBusy] = useState(false);
  const [gsMsg, setGsMsg] = useState<string | null>(null);
  useAutoDismiss(gsMsg, () => setGsMsg(null), 5000);
  const [gsResult, setGsResult] = useState<GoogleSheetSyncResponse | null>(
    null,
  );
  const [reconFilter, setReconFilter] = useState<
    'all' | 'mismatch_only' | string
  >('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ granularity, from, to });
      if (employeeId) q.set('employee_id', employeeId);
      const res = await fetch(`/api/v1/payroll-tools/stats?${q.toString()}`, {
        credentials: 'include',
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success)
        throw new Error(
          body?.error?.message ?? `Lỗi tải thống kê (HTTP ${res.status}).`,
        );
      setData(body.data as StatsData);
      setOpen(null);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : 'Không tải được thống kê.');
    } finally {
      setLoading(false);
    }
  }, [granularity, from, to, employeeId]);

  useEffect(() => {
    if (role === 'owner') void load();
  }, [load, role]);

  useEffect(() => {
    if (role !== 'owner') return;
    void (async () => {
      try {
        const me = await fetch('/api/v1/auth/me', { credentials: 'include' });
        const mb = await me.json().catch(() => null);
        if (typeof mb?.data?.csrf_token === 'string')
          setCsrf(mb.data.csrf_token);
        const res = await fetch('/api/v1/employees?limit=50', {
          credentials: 'include',
        });
        const body = await res.json().catch(() => null);
        const rawItems = (body?.data?.items ?? []) as EmployeeOption[];
        const eligibleItems = rawItems.filter(
          (e) => e.is_payroll_eligible !== false && e.employee_code !== 'NV002',
        );
        const items = eligibleItems.length > 0 ? eligibleItems : rawItems;
        setEmployees(items);
        const nv001 =
          items.find((e) => e.employee_code === 'NV001') ?? items[0];
        if (nv001) setXlsEmployee(nv001.id);
      } catch {
        /* optional */
      }
    })();
  }, [role]);

  if (role !== 'owner') {
    return (
      <EmptyState
        title="Chỉ dành cho Chủ sở hữu"
        description="Thống kê lương toàn bộ nhân sự chỉ hiển thị cho Owner. Nhân viên xem lương tại mục Lương của tôi."
      />
    );
  }

  const openReport = (employee: string, date: string) => {
    window.history.pushState(
      null,
      '',
      `/reports?employee=${encodeURIComponent(employee)}&date=${encodeURIComponent(date)}`,
    );
    onNavigate?.('/reports');
  };

  const runGoogleSheetSync = async (commit: boolean) => {
    setGsBusy(true);
    setGsMsg(null);
    try {
      let token = csrf;
      if (!token) {
        const me = await fetch('/api/v1/auth/me', { credentials: 'include' });
        const mb = await me.json().catch(() => null);
        if (typeof mb?.data?.csrf_token === 'string') {
          token = mb.data.csrf_token;
          setCsrf(token);
        }
      }
      const payload: Record<string, unknown> = {
        sheet_url: sheetUrl.trim() || DEFAULT_GOOGLE_SHEET_URL,
        year: xlsYear,
        remove_nv002_payroll: removeNv002,
        preserve_newer_web_clockins: preserveNewerWeb,
        commit,
      };
      if (xlsEmployee) payload['employee_id'] = xlsEmployee;
      const res = await fetch(
        '/api/v1/payroll-tools/timesheet/sync-google-sheet',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': token,
          },
          body: JSON.stringify(payload),
        },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        throw new Error(
          body?.error?.message ??
            `Lỗi đồng bộ Google Sheet (HTTP ${res.status}).`,
        );
      }
      const result = body.data as GoogleSheetSyncResponse;
      setGsResult(result);
      if (commit) {
        setGsMsg(
          `Đã đồng bộ chuẩn bảng lương ${result.employee.code} (${result.employee.full_name}): ${result.reconciliation.totals.excel_days} ngày công · ${result.reconciliation.totals.excel_hours} giờ · Tổng lương ${fmtVnd(result.reconciliation.totals.excel_wage_vnd)}${result.nv002_status.removed_from_payroll ? ' · Đã loại bỏ lương NV002' : ''}.`,
        );
        const yStart = `${result.year}-01-01`;
        const yEnd = `${result.year}-12-31`;
        if (from > yStart) setFrom(yStart);
        if (to < yEnd) setTo(yEnd);
        void load();
      } else {
        const diffDays =
          result.reconciliation.totals.diff_hours_days +
          result.reconciliation.totals.only_excel_days +
          result.reconciliation.totals.only_system_days;
        setGsMsg(
          diffDays === 0
            ? `✓ Đối chiếu hoàn tất: Hệ thống khớp 100% với Google Sheet (${result.reconciliation.totals.excel_days} ngày công · ${fmtVnd(result.reconciliation.totals.excel_wage_vnd)}).`
            : `Phát hiện ${diffDays} ngày có chênh lệch giữa Hệ thống và Google Sheet. Bấm "⚡ Đồng bộ chuẩn theo Google Sheet" để chuẩn hóa.`,
        );
      }
    } catch (e) {
      setGsMsg(
        e instanceof Error
          ? e.message
          : 'Không thể kết nối hoặc đồng bộ Google Sheet.',
      );
    } finally {
      setGsBusy(false);
    }
  };

  const runImport = async (commit: boolean) => {
    if (!file) {
      setImportMsg('Vui lòng chọn tệp .xlsx.');
      return;
    }
    setImportBusy(true);
    setImportMsg(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000)
        bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      const payload: Record<string, unknown> = {
        file_base64: btoa(bin),
        year: xlsYear,
        commit,
      };
      if (xlsEmployee && !newName.trim()) payload['employee_id'] = xlsEmployee;
      else if (newName.trim()) payload['new_employee_name'] = newName.trim();
      const res = await fetch('/api/v1/payroll-tools/timesheet/import', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success)
        throw new Error(
          body?.error?.message ?? `Lỗi nhập tệp (HTTP ${res.status}).`,
        );
      const result = body.data as ImportResult;
      setPreview(commit ? null : result);
      if (commit) {
        setImportMsg(
          `Đã nhập ${result.totals.shifts_new} ca, ${result.totals.reports_created} báo cáo, ${result.totals.rates_created} mức đơn giá.`,
        );
        if (result.employee.created) {
          setEmployees((prev) =>
            prev.some((e) => e.id === result.employee.id)
              ? prev
              : [
                  ...prev,
                  {
                    id: result.employee.id,
                    employee_code: result.employee.code,
                    full_name: result.employee.full_name,
                  },
                ],
          );
          setXlsEmployee(result.employee.id);
        }
        setFile(null);
        const yStart = `${result.year}-01-01`;
        const yEnd = `${result.year}-12-31`;
        if (from > yStart) setFrom(yStart);
        if (to < yEnd) setTo(yEnd);
        void load();
      }
    } catch (e) {
      setPreview(null);
      setImportMsg(e instanceof Error ? e.message : 'Không nhập được tệp.');
    } finally {
      setImportBusy(false);
    }
  };

  const t = data?.totals;
  return (
    <div>
      <PageHeader
        title="Thống kê lương nhân sự"
        subtitle="Theo ngày, tuần, tháng, năm — số liệu lấy từ ca đã duyệt, liên kết với báo cáo công việc"
        actions={
          <AppButton
            variant="secondary"
            onClick={() => onNavigate?.('/payroll')}
          >
            Bảng lương tháng
          </AppButton>
        }
      />

      <AppCard style={card}>
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 12,
          }}
        >
          {(Object.keys(GRAN_LABEL) as Granularity[]).map((g) => (
            <AppButton
              key={g}
              size="sm"
              variant={granularity === g ? 'primary' : 'secondary'}
              onClick={() => setGranularity(g)}
            >
              {GRAN_LABEL[g]}
            </AppButton>
          ))}
        </div>
        <div style={grid}>
          <label style={field}>
            Từ ngày
            <input
              type="date"
              style={input}
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label style={field}>
            Đến ngày
            <input
              type="date"
              style={input}
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <label style={field}>
            Nhân viên
            <select
              style={input}
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
            >
              <option value="">Tất cả</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employee_code} — {e.full_name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </AppCard>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <AppCard style={card}>
          <p role="alert" style={{ color: '#b91c1c' }}>
            {error}
          </p>
        </AppCard>
      ) : !data || !Array.isArray(data.buckets) || data.buckets.length === 0 ? (
        <EmptyState
          title="Chưa có dữ liệu lương trong khoảng này"
          description="Chỉ tính ca đã hoàn tất và được duyệt. Hãy duyệt ca chấm công hoặc nhập tệp Excel bên dưới."
        />
      ) : (
        <>
          <div style={{ ...grid, marginBottom: 16 }}>
            <AppCard>
              <strong>{fmtVnd(t!.wage_vnd)}</strong>
              <div>Tổng lương</div>
            </AppCard>
            <AppCard>
              <strong>{t!.worked_hours.toLocaleString('vi-VN')} giờ</strong>
              <div>Tổng giờ làm</div>
            </AppCard>
            <AppCard>
              <strong>{t!.work_days}</strong>
              <div>Ngày công</div>
            </AppCard>
            <AppCard>
              <strong>
                {t!.report_days}/{t!.work_days}
              </strong>
              <div>Ngày có báo cáo</div>
            </AppCard>
            <AppCard>
              <strong>{t!.reported_clips}</strong>
              <div>Sản lượng báo cáo</div>
            </AppCard>
          </div>
          <AppCard style={{ ...card, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>{GRAN_LABEL[data.granularity]}</th>
                  <th style={{ ...th, textAlign: 'right' }}>Giờ</th>
                  <th style={{ ...th, textAlign: 'right' }}>Ngày công</th>
                  <th style={{ ...th, textAlign: 'right' }}>Lương</th>
                  <th style={{ ...th, textAlign: 'right' }}>Báo cáo</th>
                  <th style={{ ...th, textAlign: 'right' }}>Sản lượng</th>
                </tr>
              </thead>
              <tbody>
                {data.buckets.map((b) => (
                  <React.Fragment key={b.key}>
                    <tr
                      onClick={() => setOpen(open === b.key ? null : b.key)}
                      style={{ cursor: 'pointer' }}
                      aria-expanded={open === b.key}
                    >
                      <td style={td}>
                        {open === b.key ? '▾ ' : '▸ '}
                        {b.label}
                      </td>
                      <td style={num}>
                        {b.worked_hours.toLocaleString('vi-VN')}
                      </td>
                      <td style={num}>{b.work_days}</td>
                      <td style={num}>
                        <strong>{fmtVnd(b.wage_vnd)}</strong>
                      </td>
                      <td style={num}>
                        {b.report_days}/{b.work_days}
                        {b.missing_report_days > 0 && (
                          <span
                            title="Có ngày làm nhưng chưa có báo cáo"
                            style={{ color: '#b45309' }}
                          >
                            {' '}
                            ⚠
                          </span>
                        )}
                      </td>
                      <td style={num}>{b.reported_clips}</td>
                    </tr>
                    {open === b.key && (
                      <tr>
                        <td
                          colSpan={6}
                          style={{
                            ...td,
                            background: 'var(--surface-subtle)',
                          }}
                        >
                          {granularity === 'day' && b.days
                            ? b.days.map((d) => (
                                <div
                                  key={d.employee_id}
                                  style={{ marginBottom: 6 }}
                                >
                                  <strong>
                                    {d.employee_code} — {d.employee_name}
                                  </strong>
                                  {' · '}
                                  {(d.worked_seconds / 3600).toFixed(2)} giờ ×{' '}
                                  {fmtVnd(d.hourly_rate_vnd)} ={' '}
                                  {fmtVnd(d.wage_vnd)}
                                  {' · '}
                                  {d.report ? (
                                    <a
                                      href={`/reports?employee=${d.employee_id}&date=${d.work_date}`}
                                      onClick={(ev) => {
                                        ev.preventDefault();
                                        openReport(d.employee_id, d.work_date);
                                      }}
                                    >
                                      Xem báo cáo (
                                      {d.report.total_reported_count} sản phẩm)
                                    </a>
                                  ) : (
                                    <span style={{ color: '#b45309' }}>
                                      Chưa có báo cáo công việc
                                    </span>
                                  )}
                                  {d.report?.notes && (
                                    <div
                                      style={{ opacity: 0.75, fontSize: 13 }}
                                    >
                                      {d.report.notes}
                                    </div>
                                  )}
                                </div>
                              ))
                            : b.employees.map((e) => (
                                <div
                                  key={e.employee_id}
                                  style={{ marginBottom: 6 }}
                                >
                                  <strong>
                                    {e.employee_code} — {e.employee_name}
                                  </strong>
                                  {' · '}
                                  {(e.worked_seconds / 3600).toFixed(2)} giờ ·{' '}
                                  {e.work_days} ngày · {fmtVnd(e.wage_vnd)} ·
                                  báo cáo {e.report_days}/{e.work_days}
                                  {' · '}
                                  <a
                                    href={`/reports?employee=${e.employee_id}`}
                                    onClick={(ev) => {
                                      ev.preventDefault();
                                      window.history.pushState(
                                        null,
                                        '',
                                        `/reports?employee=${encodeURIComponent(e.employee_id)}`,
                                      );
                                      onNavigate?.('/reports');
                                    }}
                                  >
                                    Báo cáo của nhân viên
                                  </a>
                                </div>
                              ))}
                          <div style={{ opacity: 0.65, fontSize: 12 }}>
                            {fmtDate(b.from)} – {fmtDate(b.to)}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </AppCard>
          <ul style={{ opacity: 0.65, fontSize: 12, marginBottom: 16 }}>
            {data.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </>
      )}

      <AppCard
        data-testid="google-sheet-sync-card"
        style={{
          ...card,
          border: '1px solid rgba(20, 184, 166, 0.35)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 8,
          }}
        >
          <h3 style={{ margin: 0 }}>
            🔄 Tự động Đồng bộ & Đối chiếu Bảng lương từ Google Sheet
          </h3>
          <a
            href={sheetUrl.trim() || DEFAULT_GOOGLE_SHEET_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--accent-text, #0d9488)',
              textDecoration: 'none',
            }}
          >
            Mở Google Sheet gốc ↗
          </a>
        </div>
        <p style={{ opacity: 0.8, fontSize: 13, marginTop: 0 }}>
          Giai đoạn đầu nhân viên chấm công trực tiếp trên Web (
          <code>/clock</code>) và đối chiếu song song với Google Sheet để kiểm
          tra độ chính xác từng ngày/tháng. Bạn có thể bấm{' '}
          <strong>Đối chiếu Hệ thống ↔ Excel</strong> để xem so sánh chi tiết
          hoặc <strong>Đồng bộ chuẩn theo Google Sheet</strong> để chuẩn hóa
          lương <strong>NV001</strong> và loại bỏ lương <strong>NV002</strong>.
        </p>

        <div style={grid}>
          <label style={{ ...field, gridColumn: '1 / -1' }}>
            Đường dẫn Google Sheet bảng chấm công
            <input
              data-testid="google-sheet-url-input"
              style={input}
              value={sheetUrl}
              placeholder={DEFAULT_GOOGLE_SHEET_URL}
              onChange={(e) => setSheetUrl(e.target.value)}
            />
          </label>
          <label style={field}>
            Năm đối chiếu
            <input
              type="number"
              style={input}
              min={2000}
              max={2100}
              value={xlsYear}
              onChange={(e) => setXlsYear(Number(e.target.value))}
            />
          </label>
          <label style={field}>
            Nhân sự áp dụng (Mặc định NV001)
            <select
              style={input}
              value={xlsEmployee}
              onChange={(e) => setXlsEmployee(e.target.value)}
            >
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employee_code} — {e.full_name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div
          style={{
            display: 'flex',
            gap: 16,
            flexWrap: 'wrap',
            marginTop: 12,
            fontSize: 13,
          }}
        >
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={preserveNewerWeb}
              onChange={(e) => setPreserveNewerWeb(e.target.checked)}
            />
            <span>
              Giữ nguyên các ca nhân viên chấm công trên Web phát sinh sau ngày
              cuối trên Excel
            </span>
          </label>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={removeNv002}
              onChange={(e) => setRemoveNv002(e.target.checked)}
            />
            <span>Loại bỏ hoàn toàn lương & ca trùng của NV002</span>
          </label>
        </div>

        <div
          style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}
        >
          <AppButton
            data-testid="btn-reconcile-google-sheet"
            variant="secondary"
            isLoading={gsBusy}
            onClick={() => void runGoogleSheetSync(false)}
          >
            🔍 Đối chiếu Hệ thống ↔ Excel
          </AppButton>
          <AppButton
            data-testid="btn-sync-google-sheet"
            variant="primary"
            isLoading={gsBusy}
            onClick={() => void runGoogleSheetSync(true)}
          >
            ⚡ Đồng bộ chuẩn theo Google Sheet (Chuẩn hóa NV001 & Loại bỏ NV002)
          </AppButton>
        </div>

        {gsMsg && (
          <div
            role="status"
            style={{
              marginTop: 12,
              padding: '10px 14px',
              borderRadius: 8,
              backgroundColor: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {gsMsg}
          </div>
        )}

        {gsResult && (
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                padding: '10px 14px',
                borderRadius: 8,
                backgroundColor: 'var(--surface-subtle, rgba(15,23,42,0.04))',
                border: '1px solid var(--border-color, #e2e8f0)',
                fontSize: 13,
                marginBottom: 14,
              }}
            >
              <strong>
                {gsResult.employee.code} — {gsResult.employee.full_name}
              </strong>
              {gsResult.employee.bank_account_number && (
                <span>
                  {' '}
                  · TK: {gsResult.employee.bank_name ?? 'VCB'}{' '}
                  {gsResult.employee.bank_account_number}
                </span>
              )}
              {' · '}Tổng Hệ thống:{' '}
              <strong>
                {gsResult.reconciliation.totals.system_days} ngày (
                {gsResult.reconciliation.totals.system_hours}h) ={' '}
                {fmtVnd(gsResult.reconciliation.totals.system_wage_vnd)}
              </strong>
              {' · '}Tổng Excel:{' '}
              <strong>
                {gsResult.reconciliation.totals.excel_days} ngày (
                {gsResult.reconciliation.totals.excel_hours}h) ={' '}
                {fmtVnd(gsResult.reconciliation.totals.excel_wage_vnd)}
              </strong>
              {' · '}Chênh lệch:{' '}
              <strong
                style={{
                  color:
                    gsResult.reconciliation.totals.diff_wage_vnd === 0
                      ? 'var(--success-text, #059669)'
                      : 'var(--warning-text, #d97706)',
                }}
              >
                {fmtVnd(gsResult.reconciliation.totals.diff_wage_vnd)}
              </strong>
              {gsResult.nv002_status.removed_from_payroll && (
                <span
                  style={{
                    marginLeft: 8,
                    color: 'var(--success-text, #059669)',
                  }}
                >
                  · ✓ Đã loại bỏ lương NV002
                </span>
              )}
            </div>

            <h4 style={{ margin: '0 0 8px 0', fontSize: 14 }}>
              1. Bảng tổng hợp đối chiếu theo tháng (Hệ thống ↔ File Excel)
            </h4>
            <div style={{ overflowX: 'auto', marginBottom: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Tháng</th>
                    <th style={{ ...th, textAlign: 'right' }}>Đơn giá/giờ</th>
                    <th style={{ ...th, textAlign: 'right' }}>
                      Ngày (HT / Excel)
                    </th>
                    <th style={{ ...th, textAlign: 'right' }}>
                      Số giờ (HT / Excel)
                    </th>
                    <th style={{ ...th, textAlign: 'right' }}>
                      Lương Hệ thống
                    </th>
                    <th style={{ ...th, textAlign: 'right' }}>
                      Lương File Excel
                    </th>
                    <th style={{ ...th, textAlign: 'right' }}>Chênh lệch</th>
                    <th style={th}>Trạng thái</th>
                  </tr>
                </thead>
                <tbody>
                  {gsResult.reconciliation.months.map((m) => (
                    <tr key={m.month}>
                      <td style={td}>
                        <strong>{m.month}</strong>
                      </td>
                      <td style={num}>{fmtVnd(m.rate_vnd)}</td>
                      <td style={num}>
                        {m.system_days} / {m.excel_days} ngày
                      </td>
                      <td style={num}>
                        {m.system_hours}h / {m.excel_hours}h
                      </td>
                      <td style={num}>
                        <strong>{fmtVnd(m.system_wage_vnd)}</strong>
                      </td>
                      <td style={num}>
                        <strong>{fmtVnd(m.excel_wage_vnd)}</strong>
                      </td>
                      <td
                        style={{
                          ...num,
                          color:
                            m.diff_wage_vnd === 0
                              ? 'var(--success-text, #059669)'
                              : 'var(--danger-text, #dc2626)',
                          fontWeight: 700,
                        }}
                      >
                        {m.diff_wage_vnd === 0
                          ? '0 đ'
                          : `${m.diff_wage_vnd > 0 ? '+' : ''}${fmtVnd(m.diff_wage_vnd)}`}
                      </td>
                      <td style={td}>
                        {m.status === 'matched' ? (
                          <span
                            style={{
                              color: 'var(--success-text, #059669)',
                              fontWeight: 600,
                            }}
                          >
                            ✓ Khớp 100% ({m.matched_days} ngày)
                          </span>
                        ) : (
                          <span
                            style={{
                              color: 'var(--warning-text, #d97706)',
                              fontWeight: 600,
                            }}
                          >
                            ⚠ Lệch (Khớp {m.matched_days}, Lệch giờ{' '}
                            {m.diff_hours_days}, Thiếu {m.only_excel_days}, Dư{' '}
                            {m.only_system_days})
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                marginBottom: 8,
              }}
            >
              <h4 style={{ margin: 0, fontSize: 14 }}>
                2. Đối chiếu chi tiết từng ngày chấm công (Web ↔ Excel)
              </h4>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <AppButton
                  variant={reconFilter === 'all' ? 'primary' : 'secondary'}
                  type="button"
                  onClick={() => setReconFilter('all')}
                >
                  Tất cả ({gsResult.reconciliation.days.length})
                </AppButton>
                <AppButton
                  variant={
                    reconFilter === 'mismatch_only' ? 'primary' : 'secondary'
                  }
                  type="button"
                  onClick={() => setReconFilter('mismatch_only')}
                >
                  Chỉ ngày lệch (
                  {
                    gsResult.reconciliation.days.filter(
                      (d) => d.status !== 'matched',
                    ).length
                  }
                  )
                </AppButton>
                {gsResult.reconciliation.months.map((m) => (
                  <AppButton
                    key={m.month}
                    variant={reconFilter === m.month ? 'primary' : 'secondary'}
                    type="button"
                    onClick={() => setReconFilter(m.month)}
                  >
                    T{Number(m.month.slice(5, 7))}
                  </AppButton>
                ))}
              </div>
            </div>

            <div style={{ overflowX: 'auto', maxHeight: 360 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Ngày</th>
                    <th style={th}>Giờ Hệ thống</th>
                    <th style={th}>Giờ Excel</th>
                    <th style={{ ...th, textAlign: 'right' }}>Số giờ HT</th>
                    <th style={{ ...th, textAlign: 'right' }}>Số giờ Excel</th>
                    <th style={{ ...th, textAlign: 'right' }}>Lương ngày</th>
                    <th style={th}>Công việc (Excel)</th>
                    <th style={th}>Kết quả</th>
                  </tr>
                </thead>
                <tbody>
                  {gsResult.reconciliation.days
                    .filter((d) => {
                      if (reconFilter === 'mismatch_only')
                        return d.status !== 'matched';
                      if (reconFilter !== 'all')
                        return d.date.startsWith(reconFilter);
                      return true;
                    })
                    .map((d) => (
                      <tr key={d.date}>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          {fmtDate(d.date)}
                        </td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          {d.system_start && d.system_end
                            ? `${d.system_start} – ${d.system_end} (${d.system_source === 'clock' ? 'Web' : 'Excel'})`
                            : '—'}
                        </td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          {d.excel_start && d.excel_end
                            ? `${d.excel_start} – ${d.excel_end}`
                            : '—'}
                        </td>
                        <td style={num}>{d.system_hours}h</td>
                        <td style={num}>{d.excel_hours}h</td>
                        <td style={num}>{fmtVnd(d.excel_wage_vnd)}</td>
                        <td style={{ ...td, maxWidth: 280 }}>
                          {d.task || '—'}
                        </td>
                        <td style={{ ...td, whiteSpace: 'nowrap' }}>
                          {d.status === 'matched' ? (
                            <span
                              style={{
                                color: 'var(--success-text, #059669)',
                                fontWeight: 600,
                              }}
                            >
                              ✓ Khớp
                            </span>
                          ) : d.status === 'diff_hours' ? (
                            <span
                              style={{
                                color: 'var(--warning-text, #d97706)',
                                fontWeight: 600,
                              }}
                            >
                              ⚠ Lệch {d.diff_minutes > 0 ? '+' : ''}
                              {d.diff_minutes} phút
                            </span>
                          ) : d.status === 'only_excel' ? (
                            <span
                              style={{
                                color: 'var(--danger-text, #dc2626)',
                                fontWeight: 600,
                              }}
                            >
                              📌 Thiếu trên HT
                            </span>
                          ) : (
                            <span
                              style={{
                                color: 'var(--info-text, #0284c7)',
                                fontWeight: 600,
                              }}
                            >
                              🖥️ Chỉ có trên Web
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </AppCard>

      <AppCard style={card}>
        <h3 style={{ marginTop: 0 }}>Excel chấm công theo năm</h3>
        <p style={{ opacity: 0.75, fontSize: 13 }}>
          Mỗi tháng có dữ liệu là một tab (T1–T12), đúng mẫu bảng chấm công hiện
          tại. Tháng không có dữ liệu sẽ không xuất. Tệp xuất ra có thể chỉnh
          sửa rồi nhập lại; ca đã có trong hệ thống được bỏ qua, không bị ghi
          đè.
        </p>
        <div style={grid}>
          <label style={field}>
            Năm
            <input
              type="number"
              style={input}
              min={2000}
              max={2100}
              value={xlsYear}
              onChange={(e) => setXlsYear(Number(e.target.value))}
            />
          </label>
          <label style={field}>
            Nhân viên
            <select
              style={input}
              value={xlsEmployee}
              onChange={(e) => setXlsEmployee(e.target.value)}
            >
              <option value="">— Chọn —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.employee_code} — {e.full_name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div style={{ marginTop: 12 }}>
          <a
            href={
              xlsEmployee
                ? `/api/v1/payroll-tools/timesheet/export?employee_id=${encodeURIComponent(xlsEmployee)}&year=${xlsYear}`
                : undefined
            }
            aria-disabled={!xlsEmployee}
            download
          >
            <AppButton
              variant="secondary"
              disabled={!xlsEmployee}
              type="button"
            >
              Xuất Excel năm {xlsYear}
            </AppButton>
          </a>
        </div>
        <hr
          style={{
            margin: '16px 0',
            border: 0,
            borderTop: '1px solid #e2e8f0',
          }}
        />
        <div style={grid}>
          <label style={field}>
            Tệp .xlsx để nhập
            <input
              type="file"
              accept=".xlsx"
              style={input}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
                setImportMsg(null);
              }}
            />
          </label>
          <label style={field}>
            Hoặc tên nhân viên mới
            <input
              style={input}
              value={newName}
              maxLength={120}
              placeholder="Để trống nếu dùng nhân viên đã chọn"
              onChange={(e) => setNewName(e.target.value)}
            />
          </label>
        </div>
        <div
          style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}
        >
          <AppButton
            variant="secondary"
            isLoading={importBusy}
            onClick={() => void runImport(false)}
          >
            Xem trước
          </AppButton>
          <AppButton
            disabled={!preview || importBusy || preview.totals.shifts_new === 0}
            onClick={() => void runImport(true)}
          >
            Xác nhận nhập
          </AppButton>
        </div>
        {importMsg && <p role="status">{importMsg}</p>}
        {preview && (
          <div style={{ marginTop: 12 }}>
            <p>
              <strong>
                {preview.employee.code} — {preview.employee.full_name}
              </strong>
              {preview.employee.created ? ' (sẽ tạo mới)' : ''} ·{' '}
              {preview.totals.shifts_new} ca mới · {preview.totals.hours} giờ ·{' '}
              {preview.totals.reports_created} báo cáo ·{' '}
              {preview.totals.rates_created} mức đơn giá
              {preview.totals.expected_wage_vnd !== null && (
                <> · lương dự kiến {fmtVnd(preview.totals.expected_wage_vnd)}</>
              )}
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>Tháng</th>
                    <th style={th}>Ca mới</th>
                    <th style={th}>Bỏ qua</th>
                    <th style={th}>Giờ</th>
                    <th style={th}>Đơn giá</th>
                    <th style={th}>Lương dự kiến</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.months.map((m) => (
                    <tr key={m.month}>
                      <td style={td}>{m.month}</td>
                      <td style={num}>{m.shifts_new}</td>
                      <td style={num}>{m.shifts_skipped}</td>
                      <td style={num}>{m.hours}</td>
                      <td style={num}>
                        {m.rate_vnd !== null ? fmtVnd(m.rate_vnd) : '—'}
                      </td>
                      <td style={num}>
                        {m.expected_wage_vnd !== null
                          ? fmtVnd(m.expected_wage_vnd)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.warnings.length > 0 && (
              <ul style={{ color: '#b45309', fontSize: 13 }}>
                {preview.warnings.slice(0, 30).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </AppCard>
    </div>
  );
};
