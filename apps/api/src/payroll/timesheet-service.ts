import crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import type { DatabasePool } from '../../../../packages/database/src/pool.js';
import { recordAuditEvent } from '../../../../packages/database/src/audit.js';
import { AuthError, type AuthenticatedContext } from '../auth/service.js';
import { requireRole } from '../auth/guard.js';
import {
  calculateDays,
  instant,
  localDate,
  subtractBreaks,
  type PayInterval,
  type PayRate,
} from './calculation.js';
import type { PayrollService } from './service.js';
import {
  buildTimesheetXlsx,
  parseTimesheetXlsx,
  type TimesheetDay,
  type TimesheetMonth,
} from './timesheet.js';
import {
  aggregateStats,
  GRANULARITIES,
  type Granularity,
  type StatsBucket,
  type StatsDayRow,
  type StatsReportLink,
} from './stats.js';

const OFFSET = 7 * 3600 * 1000;
const DAY = 86400000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_STATS_MONTHS = 24;
const IMPORT_SOURCE = 'Imported from timesheet';

const isDate = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
const isUuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const daysInMonth = (y: number, m: number): number =>
  new Date(Date.UTC(y, m, 0)).getUTCDate();
const localMs = (y: number, m: number, d: number, minutes: number): number =>
  Date.UTC(y, m - 1, d, 0, minutes) - OFFSET;
const minuteOfDay = (ms: number): number =>
  Math.floor(((((ms + OFFSET) % DAY) + DAY) % DAY) / 60000);
const pgDate = (v: unknown): string => {
  if (typeof v === 'string') return v.slice(0, 10);
  const d = v as Date;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export interface TimesheetImportInput {
  file_base64: string;
  year?: number;
  employee_id?: string;
  new_employee_name?: string;
  commit?: boolean;
}
export interface TimesheetImportMonthSummary {
  month: string;
  shifts_new: number;
  shifts_skipped: number;
  hours: number;
  expected_wage_vnd: number | null;
  rate_vnd: number | null;
}
export interface TimesheetImportResult {
  committed: boolean;
  year: number;
  employee: { id: string; code: string; full_name: string; created: boolean };
  months: TimesheetImportMonthSummary[];
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

interface PlannedShift {
  month: number;
  date: string;
  clockIn: number;
  clockOut: number;
  task: string;
}

export class TimesheetService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly payroll: PayrollService,
  ) {}

  // ------------------------------------------------------------------ stats

  async stats(
    auth: AuthenticatedContext,
    q: {
      granularity?: string | undefined;
      from?: string | undefined;
      to?: string | undefined;
      employee_id?: string | undefined;
    },
  ): Promise<{
    granularity: Granularity;
    from: string;
    to: string;
    employee_id: string | null;
    totals: Omit<StatsBucket, 'key' | 'label' | 'from' | 'to' | 'days'>;
    buckets: StatsBucket[];
    notes: string[];
  }> {
    requireRole(['owner'], auth);
    const g = (q.granularity ?? 'month') as Granularity;
    if (!GRANULARITIES.includes(g))
      throw new AuthError('VALIDATION_ERROR', 'granularity không hợp lệ.', 400);
    const today = localDate(Date.now());
    const to = q.to ?? today;
    const from = q.from ?? `${to.slice(0, 4)}-01-01`;
    if (!isDate(from) || !isDate(to) || from > to)
      throw new AuthError('VALIDATION_ERROR', 'Khoảng ngày không hợp lệ.', 400);
    if (q.employee_id && !isUuid(q.employee_id))
      throw new AuthError('VALIDATION_ERROR', 'employee_id không hợp lệ.', 400);
    const months: string[] = [];
    {
      let y = Number(from.slice(0, 4));
      let m = Number(from.slice(5, 7));
      const ey = Number(to.slice(0, 4));
      const em = Number(to.slice(5, 7));
      while (y < ey || (y === ey && m <= em)) {
        months.push(`${y}-${String(m).padStart(2, '0')}`);
        if (++m > 12) {
          m = 1;
          y++;
        }
      }
    }
    if (months.length > MAX_STATS_MONTHS)
      throw new AuthError(
        'VALIDATION_ERROR',
        `Khoảng thời gian tối đa ${MAX_STATS_MONTHS} tháng.`,
        400,
      );

    const reports = await this.reportMap(auth.workspace.id, from, to);
    const rows: StatsDayRow[] = [];
    for (const month of months) {
      const ov = (await this.payroll.overview(auth, month)) as {
        items: {
          employee_id: string;
          employee_code: string;
          full_name: string;
          daily_breakdowns: {
            work_date: unknown;
            shift_count?: number;
            worked_seconds: number;
            rounded_wage_vnd: number;
            hourly_rate_vnd_snapshot: number;
          }[];
        }[];
      };
      for (const it of ov.items) {
        if (q.employee_id && it.employee_id !== q.employee_id) continue;
        for (const d of it.daily_breakdowns) {
          const date = pgDate(d.work_date);
          if (date < from || date > to) continue;
          rows.push({
            employee_id: it.employee_id,
            employee_code: it.employee_code,
            employee_name: it.full_name,
            work_date: date,
            worked_seconds: Number(d.worked_seconds),
            shift_count: d.shift_count ?? 1,
            wage_vnd: Number(d.rounded_wage_vnd),
            hourly_rate_vnd: Number(d.hourly_rate_vnd_snapshot),
            report: reports.get(`${it.employee_id}|${date}`) ?? null,
          });
        }
      }
    }
    const buckets = aggregateStats(rows, g);
    const totals = aggregateStats(
      rows.map((r) => ({ ...r, work_date: '2000-01-01' })),
      'year',
    )[0] ?? {
      worked_seconds: 0,
      worked_hours: 0,
      work_days: 0,
      shift_count: 0,
      wage_vnd: 0,
      report_days: 0,
      reported_clips: 0,
      missing_report_days: 0,
      employees: [],
    };
    const {
      key: _k,
      label: _l,
      from: _f,
      to: _t,
      days: _d,
      ...totalOnly
    } = totals as StatsBucket;
    void _k;
    void _l;
    void _f;
    void _t;
    void _d;
    return {
      granularity: g,
      from,
      to,
      employee_id: q.employee_id ?? null,
      totals: totalOnly,
      buckets,
      notes: [
        'Chỉ tính ca đã hoàn tất và đã được duyệt (PAY-026).',
        'Tiền lương làm tròn theo từng ngày (half-up, 1 VND) giống bảng lương tháng.',
        'Tuần tính từ Thứ Hai đến Chủ nhật theo múi giờ Asia/Ho_Chi_Minh.',
      ],
    };
  }

  private async reportMap(
    workspaceId: string,
    from: string,
    to: string,
    employeeId?: string,
  ): Promise<Map<string, StatsReportLink>> {
    const res = await this.pool.query<{
      id: string;
      employee_id: string;
      report_date: string;
      status: 'draft' | 'submitted';
      notes: string | null;
      total: number;
    }>(
      `SELECT r.id, r.employee_id, r.report_date::text AS report_date, r.status, r.notes,
              COALESCE(SUM(e.reported_count), 0)::int AS total
         FROM daily_reports r
         LEFT JOIN daily_report_entries e ON e.workspace_id = r.workspace_id AND e.report_id = r.id
        WHERE r.workspace_id = $1 AND r.report_date BETWEEN $2::date AND $3::date
          AND ($4::uuid IS NULL OR r.employee_id = $4)
        GROUP BY r.id`,
      [workspaceId, from, to, employeeId ?? null],
    );
    const map = new Map<string, StatsReportLink>();
    for (const r of res.rows)
      map.set(`${r.employee_id}|${r.report_date}`, {
        id: r.id,
        status: r.status,
        total_reported_count: r.total,
        notes: r.notes,
      });
    return map;
  }

  // ----------------------------------------------------------------- export

  async exportYear(
    auth: AuthenticatedContext,
    employeeId: string,
    year: number,
  ): Promise<{ filename: string; buffer: Buffer }> {
    requireRole(['owner'], auth);
    if (!isUuid(employeeId))
      throw new AuthError('VALIDATION_ERROR', 'employee_id không hợp lệ.', 400);
    if (!Number.isInteger(year) || year < 2000 || year > 2100)
      throw new AuthError('VALIDATION_ERROR', 'Năm không hợp lệ.', 400);
    const ws = auth.workspace.id;
    const emp = (
      await this.pool.query<{ employee_code: string; full_name: string }>(
        'SELECT employee_code, full_name FROM employees WHERE workspace_id=$1 AND id=$2',
        [ws, employeeId],
      )
    ).rows[0];
    if (!emp) throw new AuthError('NOT_FOUND', 'Nhân viên không tồn tại.', 404);
    const yStart = localMs(year, 1, 1, 0);
    const yEnd = localMs(year + 1, 1, 1, 0);
    const shifts = (
      await this.pool.query<{
        clock_in_at: Date;
        clock_out_at: Date;
        breaks_snapshot: {
          started_at: string;
          ended_at: string | null;
          unpaid?: boolean;
        }[];
        worked_seconds: string;
      }>(
        `SELECT v.clock_in_at, v.clock_out_at, v.breaks_snapshot, v.worked_seconds
           FROM attendance_shifts s
           JOIN attendance_shift_versions v ON v.workspace_id = s.workspace_id AND v.id = s.current_version_id
          WHERE s.workspace_id=$1 AND s.employee_id=$2 AND s.run_state='completed'
            AND s.review_state='approved' AND v.clock_in_at >= $3 AND v.clock_in_at < $4
          ORDER BY v.clock_in_at`,
        [ws, employeeId, new Date(yStart), new Date(yEnd)],
      )
    ).rows;
    const rates = (
      await this.pool.query<PayRate>(
        'SELECT hourly_rate_vnd::int AS hourly_rate_vnd, effective_from, effective_to FROM employee_hourly_rates WHERE workspace_id=$1 AND employee_id=$2 ORDER BY effective_from',
        [ws, employeeId],
      )
    ).rows;
    const reports = await this.pool.query<{
      report_date: string;
      notes: string | null;
    }>(
      `SELECT report_date::text AS report_date, notes FROM daily_reports
        WHERE workspace_id=$1 AND employee_id=$2 AND report_date BETWEEN $3::date AND $4::date`,
      [ws, employeeId, `${year}-01-01`, `${year}-12-31`],
    );
    const taskByDate = new Map(
      reports.rows.map((r) => [r.report_date, r.notes ?? '']),
    );

    const byMonth = new Map<number, typeof shifts>();
    for (const s of shifts) {
      const m = Number(localDate(s.clock_in_at.getTime()).slice(5, 7));
      (byMonth.get(m) ?? byMonth.set(m, []).get(m)!).push(s);
    }
    const months: TimesheetMonth[] = [];
    const asOf = Date.now();
    for (const m of [...byMonth.keys()].sort((a, b) => a - b)) {
      const list = byMonth.get(m)!;
      const intervals: PayInterval[] = list.flatMap((s) =>
        subtractBreaks(
          { start: instant(s.clock_in_at), end: instant(s.clock_out_at) },
          s.breaks_snapshot ?? [],
          asOf,
        ),
      );
      let wageByDate = new Map<string, { wage: number; rate: number }>();
      try {
        wageByDate = new Map(
          calculateDays(
            intervals,
            rates,
            `${year}-${String(m).padStart(2, '0')}`,
          ).map((d) => [
            d.work_date,
            { wage: d.rounded_wage_vnd, rate: d.hourly_rate_vnd_snapshot },
          ]),
        );
      } catch {
        // Missing rate: leave wage cells to the sheet formula.
      }
      const monthRate = wageByDate.size
        ? [...wageByDate.entries()].sort(([a], [b]) =>
            a.localeCompare(b),
          )[0]![1].rate
        : null;
      const perDay = new Map<string, typeof list>();
      for (const s of list) {
        const d = localDate(s.clock_in_at.getTime());
        (perDay.get(d) ?? perDay.set(d, []).get(d)!).push(s);
      }
      const days: TimesheetDay[] = [];
      for (const [date, ss] of [...perDay.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const first = ss[0]!;
        const last = ss[ss.length - 1]!;
        const startMin = minuteOfDay(first.clock_in_at.getTime());
        const endMin = minuteOfDay(last.clock_out_at.getTime());
        const actual =
          ss.reduce((t, s) => t + Number(s.worked_seconds), 0) / 3600;
        const computed = ((((endMin - startMin) % 1440) + 1440) % 1440) / 60;
        const w = wageByDate.get(date);
        const hoursDiffers = Math.abs(actual - computed) > 1 / 120;
        const rateDiffers =
          w !== undefined && monthRate !== null && w.rate !== monthRate;
        const day: TimesheetDay = {
          day: Number(date.slice(8, 10)),
          start_min: startMin,
          end_min: endMin,
          task: taskByDate.get(date) ?? '',
          bonus: 0,
        };
        if (hoursDiffers) day.hours_override = actual;
        if ((hoursDiffers || rateDiffers) && w) day.wage_override = w.wage;
        if (ss.length > 1) day.note = `Gồm ${ss.length} ca trong ngày`;
        else if (hoursDiffers) day.note = 'Đã trừ giờ nghỉ / qua ngày';
        days.push(day);
      }
      months.push({ month: m, rate: monthRate, days });
    }
    const buffer = buildTimesheetXlsx({
      employee_name: emp.full_name,
      year,
      months,
    });
    return {
      filename: `chamcong-${emp.employee_code.toLowerCase().replace(/[^a-z0-9]/g, '')}-${year}.xlsx`,
      buffer,
    };
  }

  // ----------------------------------------------------------------- import

  async importWorkbook(
    auth: AuthenticatedContext,
    input: TimesheetImportInput,
    requestId: string,
  ): Promise<TimesheetImportResult> {
    requireRole(['owner'], auth);
    if (typeof input.file_base64 !== 'string' || !input.file_base64)
      throw new AuthError('VALIDATION_ERROR', 'Thiếu tệp .xlsx.', 400);
    const buf = Buffer.from(input.file_base64, 'base64');
    if (buf.length === 0 || buf.length > MAX_FILE_BYTES)
      throw new AuthError(
        'VALIDATION_ERROR',
        'Tệp rỗng hoặc lớn hơn 2 MB.',
        413,
      );
    let parsed: ReturnType<typeof parseTimesheetXlsx>;
    try {
      parsed = parseTimesheetXlsx(buf);
    } catch (e) {
      throw new AuthError(
        'VALIDATION_ERROR',
        e instanceof Error ? e.message : 'Không đọc được tệp .xlsx.',
        422,
      );
    }
    const year = input.year ?? parsed.year;
    if (!year || !Number.isInteger(year) || year < 2000 || year > 2100)
      throw new AuthError('VALIDATION_ERROR', 'Cần chọn năm (2000–2100).', 400);
    if (input.employee_id !== undefined && !isUuid(input.employee_id))
      throw new AuthError('VALIDATION_ERROR', 'employee_id không hợp lệ.', 400);
    const newName = (
      input.new_employee_name ??
      parsed.employee_name ??
      ''
    ).trim();
    if (!input.employee_id && !newName)
      throw new AuthError(
        'VALIDATION_ERROR',
        'Cần chọn nhân viên hoặc nhập tên nhân viên mới.',
        400,
      );
    if (newName.length > 120)
      throw new AuthError('VALIDATION_ERROR', 'Tên nhân viên quá dài.', 400);
    if (parsed.months.length === 0)
      throw new AuthError(
        'VALIDATION_ERROR',
        'Không có tab tháng (T1..T12) nào.',
        422,
      );

    const warnings = [...parsed.warnings];
    const commit = input.commit === true;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `ts_import_${auth.workspace.id}`,
      ]);
      const result = await this.applyImport(
        client,
        auth,
        parsed.months,
        year,
        input.employee_id ?? null,
        newName,
        warnings,
        requestId,
        commit,
      );
      if (commit) await client.query('COMMIT');
      else await client.query('ROLLBACK');
      return { ...result, committed: commit };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private async applyImport(
    c: PoolClient,
    auth: AuthenticatedContext,
    parsedMonths: ReturnType<typeof parseTimesheetXlsx>['months'],
    year: number,
    employeeId: string | null,
    newName: string,
    warnings: string[],
    requestId: string,
    commit: boolean,
  ): Promise<Omit<TimesheetImportResult, 'committed'>> {
    const ws = auth.workspace.id;
    // 1. Employee
    let employee: {
      id: string;
      code: string;
      full_name: string;
      created: boolean;
    };
    if (employeeId) {
      const e = (
        await c.query<{ id: string; employee_code: string; full_name: string }>(
          'SELECT id, employee_code, full_name FROM employees WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
          [ws, employeeId],
        )
      ).rows[0];
      if (!e) throw new AuthError('NOT_FOUND', 'Nhân viên không tồn tại.', 404);
      employee = {
        id: e.id,
        code: e.employee_code,
        full_name: e.full_name,
        created: false,
      };
    } else {
      const same = (
        await c.query<{ id: string; employee_code: string; full_name: string }>(
          'SELECT id, employee_code, full_name FROM employees WHERE workspace_id=$1 AND lower(full_name)=lower($2) ORDER BY created_at LIMIT 2',
          [ws, newName],
        )
      ).rows;
      if (same.length > 1)
        throw new AuthError(
          'CONFLICT',
          'Có nhiều nhân viên trùng tên, hãy chọn nhân viên cụ thể.',
          409,
        );
      if (same.length === 1) {
        const e = same[0]!;
        employee = {
          id: e.id,
          code: e.employee_code,
          full_name: e.full_name,
          created: false,
        };
        warnings.push(`Dùng nhân viên đã có cùng tên: ${e.employee_code}.`);
      } else {
        const max = (
          await c.query<{ n: number }>(
            `SELECT COALESCE(MAX(SUBSTRING(employee_code FROM '^NV([0-9]+)$')::integer), 0) AS n
               FROM employees WHERE workspace_id=$1 AND employee_code ~ '^NV[0-9]+$'`,
            [ws],
          )
        ).rows[0]!.n;
        const code = `NV${String(max + 1).padStart(3, '0')}`;
        const ins = await c.query<{ id: string }>(
          `INSERT INTO employees (workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible, version)
           VALUES ($1, NULL, $2, $3, 'active', true, 1) RETURNING id`,
          [ws, code, newName],
        );
        employee = {
          id: ins.rows[0]!.id,
          code,
          full_name: newName,
          created: true,
        };
        warnings.push(
          'Nhân viên mới chưa có tài khoản đăng nhập; có thể mời tài khoản sau.',
        );
      }
    }
    const owner = (
      await c.query(
        `SELECT 1 FROM workspace_memberships m JOIN employees e ON e.workspace_id=m.workspace_id AND e.user_id=m.user_id
          WHERE e.workspace_id=$1 AND e.id=$2 AND m.role='owner'`,
        [ws, employee.id],
      )
    ).rowCount;
    if (owner)
      throw new AuthError(
        'FORBIDDEN',
        'Chủ sở hữu không thuộc diện tính lương (PAY-025).',
        403,
      );

    // 2. Plan shifts
    const now = Date.now();
    const planned: PlannedShift[] = [];
    const skipped = new Map<number, number>();
    const skip = (m: number, why: string) => {
      skipped.set(m, (skipped.get(m) ?? 0) + 1);
      warnings.push(why);
    };
    let ignoredBonus = 0;
    const monthsWithData: { month: number; rate: number | null }[] = [];
    for (const pm of parsedMonths) {
      const dim = daysInMonth(year, pm.month);
      const seen = new Set<number>();
      let any = false;
      for (const d of pm.days) {
        const tag = `T${pm.month} ngày ${d.day}`;
        if (d.bonus > 0) ignoredBonus += d.bonus;
        if (d.day < 1 || d.day > dim) {
          skip(pm.month, `${tag}: ngày không tồn tại trong tháng, bỏ qua.`);
          continue;
        }
        if (seen.has(d.day)) {
          skip(pm.month, `${tag}: bị lặp, bỏ qua.`);
          continue;
        }
        seen.add(d.day);
        if (d.start_min === null && d.end_min === null) continue; // note-only row
        if (d.start_min === null || d.end_min === null) {
          skip(pm.month, `${tag}: thiếu giờ bắt đầu hoặc kết thúc, bỏ qua.`);
          continue;
        }
        if (d.start_min === d.end_min) {
          skip(pm.month, `${tag}: giờ bắt đầu trùng giờ kết thúc, bỏ qua.`);
          continue;
        }
        const dur = (((d.end_min - d.start_min) % 1440) + 1440) % 1440;
        if (d.sheet_hours !== null && Math.abs(d.sheet_hours - dur / 60) > 0.02)
          warnings.push(
            `${tag}: cột SỐ GIỜ (${d.sheet_hours.toFixed(2)}) khác giờ vào/ra (${(dur / 60).toFixed(2)}); hệ thống dùng giờ vào/ra.`,
          );
        const clockIn = localMs(year, pm.month, d.day, d.start_min);
        if (clockIn + dur * 60000 > now) {
          skip(pm.month, `${tag}: ca nằm trong tương lai, bỏ qua.`);
          continue;
        }
        const date = `${year}-${String(pm.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
        planned.push({
          month: pm.month,
          date,
          clockIn,
          clockOut: clockIn + dur * 60000,
          task: d.task,
        });
        any = true;
      }
      // task-only rows still produce reports, but rate is needed only with shifts
      if (any) monthsWithData.push({ month: pm.month, rate: pm.rate });
      else
        for (const d of pm.days)
          if (d.start_min === null && d.end_min === null && d.task)
            warnings.push(
              `T${pm.month} ngày ${d.day}: chỉ có công việc, không có giờ — không tạo ca.`,
            );
    }
    if (ignoredBonus > 0)
      warnings.push(
        `Cột THƯỞNG (${ignoredBonus.toLocaleString('vi-VN')} đ) chưa được hệ thống lương hỗ trợ nên không nhập.`,
      );

    // 3. Rates
    const existingRates = (
      await c.query<PayRate>(
        'SELECT hourly_rate_vnd::int AS hourly_rate_vnd, effective_from, effective_to FROM employee_hourly_rates WHERE workspace_id=$1 AND employee_id=$2 ORDER BY effective_from FOR UPDATE',
        [ws, employee.id],
      )
    ).rows;
    const segments: { rate: number; from: number; to: number | null }[] = [];
    for (const m of monthsWithData) {
      if (m.rate === null || m.rate <= 0) {
        warnings.push(
          `T${m.month}: thiếu đơn giá/giờ (ô B36) — các ca tháng này không được nhập.`,
        );
        continue;
      }
      const from = localMs(year, m.month, 1, 0);
      const last = segments[segments.length - 1];
      if (last && last.rate === m.rate) continue;
      if (last) last.to = from;
      segments.push({ rate: m.rate, from, to: null });
    }
    const overlaps = (a: number, b: number | null, r: PayRate) => {
      const rs = instant(r.effective_from);
      const re = r.effective_to ? instant(r.effective_to) : Infinity;
      return a < re && (b === null ? Infinity : b) > rs;
    };
    let ratesCreated = 0;
    const newRates: PayRate[] = [];
    for (const s of segments) {
      if (existingRates.some((r) => overlaps(s.from, s.to, r))) {
        warnings.push(
          `Đơn giá ${s.rate.toLocaleString('vi-VN')} đ từ ${localDate(s.from)} trùng đơn giá đã có — giữ đơn giá hiện có.`,
        );
        continue;
      }
      await c.query(
        `INSERT INTO employee_hourly_rates (workspace_id, employee_id, hourly_rate_vnd, effective_from, effective_to, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          ws,
          employee.id,
          s.rate,
          new Date(s.from),
          s.to === null ? null : new Date(s.to),
          auth.user.id,
        ],
      );
      newRates.push({
        hourly_rate_vnd: s.rate,
        effective_from: new Date(s.from),
        effective_to: s.to === null ? null : new Date(s.to),
      });
      ratesCreated++;
    }
    const allRates = [...existingRates, ...newRates];
    const covered = (a: number, b: number) => {
      let t = a;
      for (const r of [...allRates].sort(
        (x, y) => instant(x.effective_from) - instant(y.effective_from),
      )) {
        const rs = instant(r.effective_from);
        const re = r.effective_to ? instant(r.effective_to) : Infinity;
        if (rs <= t && re > t) t = re;
        if (t >= b) return true;
      }
      return t >= b;
    };

    // 4. Insert shifts, approvals and reports
    const perMonth = new Map<
      number,
      { hours: number; intervals: PayInterval[]; new: number }
    >();
    let reportsCreated = 0;
    for (const p of planned) {
      if (!covered(p.clockIn, p.clockOut)) {
        skip(p.month, `${p.date}: chưa có đơn giá bao phủ ca này, bỏ qua.`);
        continue;
      }
      const ref = `timesheet:${employee.id}:${p.date}`;
      const dup = await c.query(
        `SELECT 1 FROM attendance_shifts
          WHERE workspace_id=$1 AND employee_id=$2
            AND (import_ref=$3 OR tstzrange(clock_in_at, COALESCE(clock_out_at,'infinity'),'[)') && tstzrange($4,$5,'[)'))
          LIMIT 1`,
        [ws, employee.id, ref, new Date(p.clockIn), new Date(p.clockOut)],
      );
      if (dup.rowCount) {
        skip(p.month, `${p.date}: đã có ca chấm công trùng thời gian, bỏ qua.`);
        continue;
      }
      const workedSeconds = Math.round((p.clockOut - p.clockIn) / 1000);
      const shiftId = crypto.randomUUID();
      const versionId = crypto.randomUUID();
      const hash = crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            shift_id: shiftId,
            clock_in_at: new Date(p.clockIn).toISOString(),
            clock_out_at: new Date(p.clockOut).toISOString(),
            breaks: [],
            worked_seconds: workedSeconds,
          }),
        )
        .digest('hex');
      await c.query(
        `INSERT INTO attendance_shifts (id, workspace_id, employee_id, clock_in_at, clock_out_at, run_state, review_state, version, source, import_ref)
         VALUES ($1,$2,$3,$4,$5,'completed','approved',3,'import',$6)`,
        [
          shiftId,
          ws,
          employee.id,
          new Date(p.clockIn),
          new Date(p.clockOut),
          ref,
        ],
      );
      await c.query(
        `INSERT INTO attendance_shift_versions (id, workspace_id, shift_id, version_number, clock_in_at, clock_out_at, breaks_snapshot, worked_seconds, snapshot_hash, created_by, reason)
         VALUES ($1,$2,$3,1,$4,$5,'[]'::jsonb,$6,$7,$8,$9)`,
        [
          versionId,
          ws,
          shiftId,
          new Date(p.clockIn),
          new Date(p.clockOut),
          workedSeconds,
          hash,
          auth.user.id,
          IMPORT_SOURCE,
        ],
      );
      await c.query(
        'UPDATE attendance_shifts SET current_version_id=$1 WHERE id=$2 AND workspace_id=$3',
        [versionId, shiftId, ws],
      );
      await c.query(
        `INSERT INTO attendance_approvals (workspace_id, shift_id, shift_version_id, reviewer_user_id, decision, reason)
         VALUES ($1,$2,$3,$4,'approved',$5)`,
        [ws, shiftId, versionId, auth.user.id, IMPORT_SOURCE],
      );
      const agg = perMonth.get(p.month) ?? { hours: 0, intervals: [], new: 0 };
      agg.hours += workedSeconds / 3600;
      agg.intervals.push({ start: p.clockIn, end: p.clockOut });
      agg.new += 1;
      perMonth.set(p.month, agg);

      if (p.task) {
        const has = await c.query(
          'SELECT 1 FROM daily_reports WHERE workspace_id=$1 AND employee_id=$2 AND report_date=$3::date',
          [ws, employee.id, p.date],
        );
        if (has.rowCount) {
          warnings.push(
            `${p.date}: đã có báo cáo công việc, giữ nguyên báo cáo cũ.`,
          );
        } else {
          const clips = [...p.task.matchAll(/(\d+)\s*clip/gi)].reduce(
            (t, m) => t + Number(m[1]),
            0,
          );
          const entry = {
            work_type: clips > 0 ? 'video_editing' : 'other',
            reported_count: Math.min(clips, 100000),
            notes: p.task.slice(0, 1000),
          };
          const rep = await c.query<{ id: string }>(
            `INSERT INTO daily_reports (workspace_id, employee_id, report_date, status, current_revision, version, notes, submitted_at)
             VALUES ($1,$2,$3::date,'submitted',1,2,$4,$5) RETURNING id`,
            [
              ws,
              employee.id,
              p.date,
              p.task.slice(0, 2000),
              new Date(p.clockOut),
            ],
          );
          const rid = rep.rows[0]!.id;
          await c.query(
            `INSERT INTO daily_report_entries (workspace_id, report_id, work_type, reported_count, notes, sort_order)
             VALUES ($1,$2,$3,$4,$5,0)`,
            [ws, rid, entry.work_type, entry.reported_count, entry.notes],
          );
          await c.query(
            `INSERT INTO daily_report_revisions (workspace_id, report_id, revision_number, status, snapshot, reason, edited_by)
             VALUES ($1,$2,1,'submitted',$3,$4,$5)`,
            [
              ws,
              rid,
              JSON.stringify({
                entries: [entry],
                notes: p.task.slice(0, 2000),
              }),
              IMPORT_SOURCE,
              auth.user.id,
            ],
          );
          reportsCreated++;
        }
      }
    }

    // 5. Summaries
    const months = parsedMonths
      .map((pm) => {
        const agg = perMonth.get(pm.month);
        let wage: number | null = null;
        if (agg) {
          try {
            wage = calculateDays(
              agg.intervals,
              allRates,
              `${year}-${String(pm.month).padStart(2, '0')}`,
            ).reduce((t, d) => t + d.rounded_wage_vnd, 0);
          } catch {
            wage = null;
          }
        }
        return {
          month: `${year}-${String(pm.month).padStart(2, '0')}`,
          shifts_new: agg?.new ?? 0,
          shifts_skipped: skipped.get(pm.month) ?? 0,
          hours: Math.round((agg?.hours ?? 0) * 100) / 100,
          expected_wage_vnd: wage,
          rate_vnd: pm.rate,
        };
      })
      .filter((m) => m.shifts_new > 0 || m.shifts_skipped > 0);
    const totals = {
      shifts_new: months.reduce((t, m) => t + m.shifts_new, 0),
      shifts_skipped: months.reduce((t, m) => t + m.shifts_skipped, 0),
      hours: Math.round(months.reduce((t, m) => t + m.hours, 0) * 100) / 100,
      expected_wage_vnd: months.every((m) => m.expected_wage_vnd !== null)
        ? months.reduce((t, m) => t + (m.expected_wage_vnd ?? 0), 0)
        : null,
      rates_created: ratesCreated,
      reports_created: reportsCreated,
    };
    if (commit)
      await recordAuditEvent(c, {
        workspaceId: ws,
        actorUserId: auth.user.id,
        action: 'payroll.timesheet_import',
        entityType: 'employee',
        entityId: employee.id,
        requestId,
        metadata: { year, ...totals, created_employee: employee.created },
      });
    return { year, employee, months, totals, warnings };
  }
}
