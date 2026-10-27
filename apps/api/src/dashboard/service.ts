import type { DatabasePool } from '../../../../packages/database/src/pool.js';
import { AuthError, type AuthenticatedContext } from '../auth/service.js';
import type { DashboardSummaryResponseData } from '../../../../packages/contracts/src/dashboard.js';

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

export class DashboardService {
  constructor(private readonly pool: DatabasePool) {}

  /**
   * GET /api/v1/dashboard/summary
   * Single-roundtrip PostgreSQL CTE aggregation for Dashboard metrics.
   * Strictly enforces C06 workspace isolation and Owner/Staff RBAC boundaries.
   */
  async getSummary(
    context: AuthenticatedContext,
    options: { date?: string | undefined; month?: string | undefined } = {},
  ): Promise<DashboardSummaryResponseData> {
    const todayIso = options.date?.trim() || getVietnamTodayIso();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(todayIso)) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Invalid date parameter format (expected YYYY-MM-DD)',
        400,
      );
    }

    const currentMonth = options.month?.trim() || todayIso.slice(0, 7);
    if (!/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/.test(currentMonth)) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Invalid month parameter format (expected YYYY-MM)',
        400,
      );
    }

    const isOwner = context.workspace.role === 'owner';

    const query = `
      WITH target_emp AS (
        SELECT id
        FROM employees
        WHERE workspace_id = $1 AND user_id = $2
        LIMIT 1
      ),
      recent_shifts AS (
        SELECT
          s.id,
          s.run_state,
          s.clock_in_at,
          s.clock_out_at,
          GREATEST(
            0,
            FLOOR(
              EXTRACT(
                EPOCH FROM (COALESCE(s.clock_out_at, now()) - s.clock_in_at)
              )
            )::bigint - COALESCE(
              (
                SELECT SUM(
                  GREATEST(
                    0,
                    FLOOR(EXTRACT(EPOCH FROM (b.ended_at - b.started_at)))::bigint
                  )
                )
                FROM attendance_breaks b
                WHERE b.shift_id = s.id AND b.ended_at IS NOT NULL
              ),
              0
            )
          )::int AS worked_seconds
        FROM attendance_shifts s
        JOIN target_emp te ON te.id = s.employee_id
        WHERE s.workspace_id = $1
        ORDER BY s.clock_in_at DESC
        LIMIT 30
      ),
      open_shift AS (
        SELECT id, run_state, clock_in_at
        FROM recent_shifts
        WHERE run_state IN ('working', 'paused')
        ORDER BY clock_in_at DESC
        LIMIT 1
      ),
      shift_stats AS (
        SELECT
          COUNT(*)::int AS recent_count,
          COUNT(*) FILTER (WHERE run_state = 'completed')::int AS completed_count,
          COALESCE(SUM(worked_seconds), 0)::int AS total_worked_seconds
        FROM recent_shifts
      ),
      recent_reports AS (
        SELECT
          r.id,
          r.report_date::text AS report_date,
          r.status,
          COUNT(e.id)::int AS entries_count,
          COALESCE(SUM(e.reported_count), 0)::int AS total_reported_count
        FROM daily_reports r
        JOIN target_emp te ON te.id = r.employee_id
        LEFT JOIN daily_report_entries e
          ON e.report_id = r.id AND e.workspace_id = r.workspace_id
        WHERE r.workspace_id = $1
        GROUP BY r.id, r.report_date, r.status, r.created_at
        ORDER BY r.report_date DESC, r.created_at DESC, r.id DESC
        LIMIT 30
      ),
      today_rep AS (
        SELECT id, report_date, status, entries_count, total_reported_count
        FROM recent_reports
        WHERE report_date = $3
        LIMIT 1
      ),
      emp_counts AS (
        SELECT
          COUNT(*)::int AS total_count,
          COUNT(*) FILTER (WHERE employment_status = 'active')::int AS active_count,
          COUNT(*) FILTER (WHERE employment_status = 'invited')::int AS invited_count
        FROM employees
        WHERE workspace_id = $1 AND $5::boolean = true
      ),
      pay_period AS (
        SELECT id, status
        FROM payroll_periods
        WHERE workspace_id = $1 AND period_month = $4 AND $5::boolean = true
        LIMIT 1
      ),
      pay_emp_count AS (
        SELECT
          CASE
            WHEN NOT $5::boolean THEN 0
            WHEN EXISTS (SELECT 1 FROM pay_period WHERE status = 'finalized') THEN (
              SELECT COUNT(*)::int
              FROM payroll_employee_items i
              JOIN pay_period pp ON pp.id = i.period_id
              WHERE i.workspace_id = $1
            )
            ELSE (
              SELECT COUNT(*)::int
              FROM employees e
              WHERE e.workspace_id = $1
                AND e.is_payroll_eligible = true
                AND NOT EXISTS (
                  SELECT 1
                  FROM workspace_memberships m
                  WHERE m.workspace_id = e.workspace_id
                    AND m.user_id = e.user_id
                    AND m.role = 'owner'
                )
            )
          END AS employee_count
      )
      SELECT
        os.id AS current_shift_id,
        os.run_state AS current_shift_run_state,
        os.clock_in_at AS current_shift_clock_in_at,
        ss.recent_count AS recent_shifts_count,
        ss.completed_count AS completed_shifts_count,
        ss.total_worked_seconds AS total_worked_seconds,
        tr.id AS today_report_id,
        tr.report_date AS today_report_date,
        tr.status AS today_report_status,
        tr.entries_count AS today_report_entries_count,
        tr.total_reported_count AS today_report_total_reported_count,
        (SELECT COUNT(*)::int FROM recent_reports) AS total_reports_count,
        ec.total_count AS emp_total_count,
        ec.active_count AS emp_active_count,
        ec.invited_count AS emp_invited_count,
        pp.id AS pay_period_id,
        pp.status AS pay_period_status,
        pec.employee_count AS pay_employee_count
      FROM shift_stats ss
      CROSS JOIN emp_counts ec
      CROSS JOIN pay_emp_count pec
      LEFT JOIN open_shift os ON true
      LEFT JOIN today_rep tr ON true
      LEFT JOIN pay_period pp ON true;
    `;

    const res = await this.pool.query<{
      current_shift_id: string | null;
      current_shift_run_state: 'working' | 'paused' | 'completed' | null;
      current_shift_clock_in_at: Date | null;
      recent_shifts_count: number;
      completed_shifts_count: number;
      total_worked_seconds: number;
      today_report_id: string | null;
      today_report_date: string | null;
      today_report_status: 'draft' | 'submitted' | null;
      today_report_entries_count: number | null;
      today_report_total_reported_count: number | null;
      total_reports_count: number;
      emp_total_count: number;
      emp_active_count: number;
      emp_invited_count: number;
      pay_period_id: string | null;
      pay_period_status: 'draft' | 'finalized' | null;
      pay_employee_count: number;
    }>(query, [
      context.workspace.id,
      context.user.id,
      todayIso,
      currentMonth,
      isOwner,
    ]);

    const row = res.rows[0];

    return {
      shift: {
        current_shift:
          row?.current_shift_id &&
          row.current_shift_run_state &&
          row.current_shift_clock_in_at
            ? {
                id: row.current_shift_id,
                run_state: row.current_shift_run_state,
                clock_in_at: row.current_shift_clock_in_at.toISOString(),
              }
            : null,
        recent_shifts_count: row?.recent_shifts_count ?? 0,
        completed_shifts_count: row?.completed_shifts_count ?? 0,
        total_worked_seconds: row?.total_worked_seconds ?? 0,
      },
      report: {
        today_report:
          row?.today_report_id &&
          row.today_report_date &&
          row.today_report_status
            ? {
                id: row.today_report_id,
                report_date: row.today_report_date,
                status: row.today_report_status,
                entries_count: row.today_report_entries_count ?? 0,
                total_reported_count:
                  row.today_report_total_reported_count ?? 0,
              }
            : null,
        total_reports_count: row?.total_reports_count ?? 0,
      },
      employees: isOwner
        ? {
            total_count: row?.emp_total_count ?? 0,
            active_count: row?.emp_active_count ?? 0,
            invited_count: row?.emp_invited_count ?? 0,
          }
        : null,
      payroll: isOwner
        ? {
            period_month: currentMonth,
            status:
              row?.pay_period_status === 'finalized' ? 'finalized' : 'draft',
            employee_count: row?.pay_employee_count ?? 0,
            has_period_record: Boolean(row?.pay_period_id),
          }
        : null,
    };
  }
}
