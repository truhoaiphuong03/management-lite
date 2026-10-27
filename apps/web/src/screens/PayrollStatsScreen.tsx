import React, { useCallback, useEffect, useState } from 'react';
import {
  AppCard,
  AppButton,
  PageHeader,
  LoadingState,
  EmptyState,
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
}
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
  border: '1px solid #cbd5e1',
  font: 'inherit',
  minWidth: 0,
};
const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  borderBottom: '1px solid #e2e8f0',
  fontSize: 12,
  opacity: 0.75,
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid #f1f5f9',
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
  const [preview, setPreview] = useState<ImportResult | null>(null);

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
        const items = (body?.data?.items ?? []) as EmployeeOption[];
        setEmployees(items);
        if (items[0]) setXlsEmployee(items[0].id);
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
      ) : !data || data.buckets.length === 0 ? (
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
                          style={{ ...td, background: '#f8fafc' }}
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
