import crypto from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { AuthError, type AuthenticatedContext } from '../auth/service.js';
import { requireRole } from '../auth/guard.js';
import { recordAuditEvent } from '../../../../packages/database/src/audit.js';
import {
  claimIdempotency,
  completeIdempotency,
  computeRequestFingerprint,
} from '../../../../packages/database/src/idempotency.js';
import {
  calculateDays,
  exactMoney,
  instant,
  monthBounds,
  subtractBreaks,
  type PayRate,
} from './calculation.js';

interface Period extends QueryResultRow {
  id: string;
  workspace_id: string;
  period_month: string;
  status: string;
  version: number;
  [key: string]: unknown;
}
interface Employee extends QueryResultRow {
  id: string;
  employee_code: string;
  full_name: string;
  user_id: string | null;
}
interface Shift extends QueryResultRow {
  id: string;
  employee_id: string;
  run_state: string;
  review_state: string;
  clock_in_at: string;
  clock_out_at: string | null;
  breaks_snapshot: {
    started_at: string;
    ended_at: string | null;
    unpaid?: boolean;
  }[];
  current_version_id: string | null;
  approved: boolean;
}
const fail = (code: string, message: string, status = 422): never => {
  throw new AuthError(code, message, status);
};
function amount(v: unknown, zero = false): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < (zero ? 0 : 1))
    return fail('VALIDATION_ERROR', 'Invalid integer amount', 400);
  return v;
}
function uuid(v: unknown): string {
  if (
    typeof v !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)
  )
    return fail('VALIDATION_ERROR', 'Invalid identifier', 400);
  return v;
}
function date(v: unknown): string {
  if (
    typeof v !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    !Number.isFinite(Date.parse(v)) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    return fail('VALIDATION_ERROR', 'Invalid date', 400);
  return v;
}
function version(v: string | undefined): number {
  if (!v) return fail('PRECONDITION_REQUIRED', 'If-Match required', 428);
  if (!/^"[1-9][0-9]*"$/.test(v))
    return fail('PRECONDITION_FAILED', 'Invalid If-Match', 412);
  return Number(v.slice(1, -1));
}

export class PayrollService {
  constructor(private readonly pool: Pool) {}
  private async authorized(
    c: PoolClient,
    auth: AuthenticatedContext,
    owner: boolean,
  ): Promise<void> {
    // Lock order: global user -> binding -> membership -> session -> PAY -> audit.
    const u = await c.query(
      "SELECT id FROM users WHERE id=$1 AND status='active' FOR SHARE",
      [auth.user.id],
    );
    const b = await c.query(
      "SELECT id FROM user_workspace_bindings WHERE user_id=$1 AND workspace_id=$2 AND status='active' FOR SHARE",
      [auth.user.id, auth.workspace.id],
    );
    const m = await c.query(
      "SELECT role FROM workspace_memberships WHERE user_id=$1 AND workspace_id=$2 AND status='active' FOR SHARE",
      [auth.user.id, auth.workspace.id],
    );
    const s = await c.query(
      `SELECT s.id FROM auth_sessions s JOIN user_credentials cr ON cr.user_id=s.user_id
      WHERE s.id=$1 AND s.user_id=$2 AND s.workspace_id=$3 AND s.session_token_hash=$4 AND s.revoked_at IS NULL
      AND s.idle_expires_at > clock_timestamp() AND s.absolute_expires_at > clock_timestamp()
      AND s.credential_version_at_issue=cr.credential_version FOR SHARE OF s, cr`,
      [auth.sessionId, auth.user.id, auth.workspace.id, auth.sessionTokenHash],
    );
    const w = await c.query(
      "SELECT id FROM workspaces WHERE id=$1 AND status='active' FOR SHARE",
      [auth.workspace.id],
    );
    if (!u.rowCount || !b.rowCount || !m.rowCount || !s.rowCount || !w.rowCount)
      fail('UNAUTHENTICATED', 'Session no longer authorized', 401);
    if (m.rows[0]?.role !== auth.workspace.role)
      fail('UNAUTHENTICATED', 'Workspace permission changed', 401);
    if (owner && m.rows[0]?.role !== 'owner')
      fail('FORBIDDEN', 'Owner permission required', 403);
  }
  private async read<T>(
    auth: AuthenticatedContext,
    owner: boolean,
    fn: (c: PoolClient) => Promise<T>,
  ): Promise<T> {
    if (owner) requireRole(['owner'], auth);
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      await this.authorized(c, auth, owner);
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  private async write<T>(
    auth: AuthenticatedContext,
    operation: string,
    body: Record<string, unknown>,
    key: string | undefined,
    required: boolean,
    requestId: string,
    fn: (c: PoolClient) => Promise<T>,
  ): Promise<T> {
    requireRole(['owner'], auth);
    if (required && !key)
      fail('PRECONDITION_REQUIRED', 'Idempotency-Key required', 428);
    if (key && !/^[\x21-\x7e]{1,128}$/.test(key))
      fail('VALIDATION_ERROR', 'Invalid Idempotency-Key', 400);
    const c = await this.pool.connect();
    try {
      await c.query(
        operation.startsWith('PAY_FINALIZE:')
          ? 'BEGIN ISOLATION LEVEL REPEATABLE READ'
          : 'BEGIN',
      );
      await this.authorized(c, auth, true);
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('pay:' || $1,0))",
        [auth.workspace.id],
      );
      const operationKey = operation + ':' + key;
      if (key) {
        const claim = await claimIdempotency(c, {
          workspaceId: auth.workspace.id,
          actorUserId: auth.user.id,
          operationKey,
          requestFingerprint: computeRequestFingerprint(
            'POST',
            operation,
            body,
          ),
        });
        if (claim.status === 'replay') {
          await c.query('COMMIT');
          return claim.sanitizedResponse as T;
        }
        if (claim.status !== 'claimed')
          fail(
            'IDEMPOTENCY_CONFLICT',
            'Idempotency request cannot be replayed',
            409,
          );
      }
      const out = await fn(c);
      await recordAuditEvent(c, {
        workspaceId: auth.workspace.id,
        actorUserId: auth.user.id,
        action: operation,
        entityType: 'payroll',
        entityId: auth.workspace.id,
        requestId,
        metadata: { operation },
      });
      if (key)
        await completeIdempotency(c, {
          workspaceId: auth.workspace.id,
          actorUserId: auth.user.id,
          operationKey,
          responseCode: operation.startsWith('PAY_FINALIZE:') ? 200 : 201,
          sanitizedResponse: out,
        });
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK');
      if (
        typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        ['40001', '40P01'].includes(String(e.code))
      )
        fail(
          'CONCURRENT_MODIFICATION',
          'Retry with the same idempotency request',
          409,
        );
      throw e;
    } finally {
      c.release();
    }
  }
  private async period(
    c: PoolClient,
    workspace: string,
    month: string,
    create = false,
  ): Promise<Period | undefined> {
    const b = monthBounds(month);
    if (create)
      await c.query(
        `INSERT INTO payroll_periods(workspace_id,period_month,starts_on,ends_on) VALUES($1,$2,$3,$4) ON CONFLICT(workspace_id,period_month) DO NOTHING`,
        [workspace, month, b.starts_on, b.ends_on],
      );
    return (
      await c.query<Period>(
        'SELECT *,starts_on::text AS starts_on,ends_on::text AS ends_on FROM payroll_periods WHERE workspace_id=$1 AND period_month=$2' +
          (create ? ' FOR UPDATE' : ''),
        [workspace, month],
      )
    ).rows[0];
  }
  async rates(auth: AuthenticatedContext): Promise<unknown> {
    return this.read(auth, true, async (c) =>
      (
        await c.query(
          `SELECT r.*,e.employee_code,e.full_name FROM employee_hourly_rates r JOIN employees e ON e.workspace_id=r.workspace_id AND e.id=r.employee_id WHERE r.workspace_id=$1 ORDER BY e.employee_code,r.effective_from DESC`,
          [auth.workspace.id],
        )
      ).rows.map((r) => ({ ...r, hourly_rate_vnd: Number(r.hourly_rate_vnd) })),
    );
  }
  async setRate(
    auth: AuthenticatedContext,
    body: Record<string, unknown>,
    key: string | undefined,
    requestId: string,
  ): Promise<unknown> {
    const employee = uuid(body.employee_id),
      rate = amount(body.hourly_rate_vnd, true);
    // Client effective_from is accepted for wire compatibility but never used.
    return this.write(
      auth,
      'PAY_RATE_CONFIGURED',
      body,
      key,
      false,
      requestId,
      async (c) => {
        const e = await c.query(
          'SELECT id FROM employees WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
          [auth.workspace.id, employee],
        );
        if (!e.rowCount) fail('NOT_FOUND', 'Employee not found', 404);
        const now = (
          await c.query("SELECT date_trunc('second',clock_timestamp()) AS at")
        ).rows[0]!.at;
        const old = (
          await c.query(
            'SELECT * FROM employee_hourly_rates WHERE workspace_id=$1 AND employee_id=$2 AND effective_to IS NULL FOR UPDATE',
            [auth.workspace.id, employee],
          )
        ).rows[0];
        if (old && instant(old.effective_from) >= instant(now))
          fail(
            'INVALID_TRANSITION',
            'Rate already saved in this server second',
            409,
          );
        if (old)
          await c.query(
            'UPDATE employee_hourly_rates SET effective_to=$1 WHERE id=$2',
            [now, old.id],
          );
        const r = (
          await c.query(
            'INSERT INTO employee_hourly_rates(workspace_id,employee_id,hourly_rate_vnd,effective_from,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *',
            [auth.workspace.id, employee, rate, now, auth.user.id],
          )
        ).rows[0]!;
        return { ...r, hourly_rate_vnd: Number(r.hourly_rate_vnd) };
      },
    );
  }
  async periods(auth: AuthenticatedContext): Promise<unknown> {
    return this.read(
      auth,
      false,
      async (c) =>
        (
          await c.query(
            `SELECT p.*,p.starts_on::text AS starts_on,p.ends_on::text AS ends_on FROM payroll_periods p WHERE p.workspace_id=$1 AND ($2='owner' OR EXISTS(SELECT 1 FROM payroll_employee_items i JOIN employees e ON e.id=i.employee_id AND e.workspace_id=i.workspace_id WHERE i.period_id=p.id AND i.workspace_id=p.workspace_id AND e.user_id=$3)) ORDER BY p.period_month DESC`,
            [auth.workspace.id, auth.workspace.role, auth.user.id],
          )
        ).rows,
    );
  }
  private async projection(
    c: PoolClient,
    workspace: string,
    month: string,
    onlyEmployee?: string,
  ) {
    const b = monthBounds(month),
      asOf = (
        await c.query("SELECT date_trunc('second',clock_timestamp()) AS at")
      ).rows[0]!.at as Date;
    const p = await this.period(c, workspace, month);
    const es = (
      await c.query<Employee>(
        `SELECT e.* FROM employees e WHERE e.workspace_id=$1 AND ($2::uuid IS NULL OR e.id=$2) AND (($4::boolean AND EXISTS(SELECT 1 FROM payroll_employee_items i JOIN payroll_periods p ON p.workspace_id=i.workspace_id AND p.id=i.period_id WHERE i.workspace_id=e.workspace_id AND i.employee_id=e.id AND p.period_month=$3 AND p.status='finalized')) OR (NOT $4::boolean AND e.is_payroll_eligible AND NOT EXISTS(SELECT 1 FROM workspace_memberships m WHERE m.workspace_id=e.workspace_id AND m.user_id=e.user_id AND m.role='owner'))) ORDER BY e.id`,
        [workspace, onlyEmployee ?? null, month, p?.status === 'finalized'],
      )
    ).rows;
    const output = [];
    for (const e of es) {
      const rates = (
        await c.query<PayRate & QueryResultRow>(
          'SELECT * FROM employee_hourly_rates WHERE workspace_id=$1 AND employee_id=$2 ORDER BY effective_from',
          [workspace, e.id],
        )
      ).rows.map((r) => ({ ...r, hourly_rate_vnd: Number(r.hourly_rate_vnd) }));
      const shifts = (
        await c.query<Shift>(
          `SELECT s.id,s.employee_id,s.run_state,s.review_state,s.current_version_id,COALESCE(v.clock_in_at,s.clock_in_at)::text AS clock_in_at,COALESCE(v.clock_out_at,s.clock_out_at)::text AS clock_out_at,COALESCE(v.breaks_snapshot,'[]') AS breaks_snapshot,
        EXISTS(SELECT 1 FROM attendance_approvals a WHERE a.workspace_id=s.workspace_id AND a.shift_id=s.id AND a.shift_version_id=v.id AND a.decision='approved') AS approved
        FROM attendance_shifts s LEFT JOIN attendance_shift_versions v ON v.workspace_id=s.workspace_id AND v.shift_id=s.id AND v.id=s.current_version_id
        WHERE s.workspace_id=$1 AND s.employee_id=$2 AND COALESCE(v.clock_in_at,s.clock_in_at)<$3 AND (COALESCE(v.clock_out_at,s.clock_out_at) IS NULL OR COALESCE(v.clock_out_at,s.clock_out_at)>$4)`,
          [workspace, e.id, new Date(b.end), new Date(b.start)],
        )
      ).rows;
      const daysFor = (intervals: ReturnType<typeof subtractBreaks>) => {
        try {
          return calculateDays(intervals, rates, month);
        } catch (error) {
          if (
            error instanceof AuthError &&
            error.code === 'MISSING_HOURLY_RATE'
          )
            throw new AuthError(error.code, error.message, 422, [
              { field: 'employee_id', message: e.id },
              ...(error.details ?? []),
            ]);
          throw error;
        }
      };
      const buckets = {
        confirmed: [] as ReturnType<typeof subtractBreaks>,
        pending: [] as ReturnType<typeof subtractBreaks>,
        live: [] as ReturnType<typeof subtractBreaks>,
      };
      let pendingCount = 0,
        open: Shift | undefined;
      const counts = new Map<string, number>();
      for (const s of shifts) {
        if (
          p?.status === 'finalized' &&
          s.run_state === 'completed' &&
          s.review_state === 'approved'
        )
          continue;
        if (
          s.run_state === 'completed' &&
          (!s.current_version_id || !s.clock_out_at)
        )
          fail(
            'INVALID_ATTENDANCE_SOURCE',
            'Completed shift has no immutable version',
          );
        const live = s.run_state === 'working' || s.run_state === 'paused';
        const breaks = live
          ? ((
              await c.query(
                'SELECT started_at::text,ended_at::text,unpaid FROM attendance_breaks WHERE workspace_id=$1 AND shift_id=$2',
                [workspace, s.id],
              )
            ).rows as Shift['breaks_snapshot'])
          : s.breaks_snapshot;
        const intervals = subtractBreaks(
          {
            start: instant(s.clock_in_at),
            end: live ? asOf.getTime() : instant(s.clock_out_at!),
          },
          breaks,
          asOf.getTime(),
        );
        if (live) {
          buckets.live.push(...intervals);
          open = s;
        } else if (s.review_state === 'approved') {
          if (!s.approved)
            fail('INVALID_ATTENDANCE_SOURCE', 'Current version lacks approval');
          buckets.confirmed.push(...intervals);
          for (const day of daysFor(intervals))
            counts.set(day.work_date, (counts.get(day.work_date) ?? 0) + 1);
        } else if (['unreviewed', 'needs_review'].includes(s.review_state)) {
          buckets.pending.push(...intervals);
          pendingCount++;
        }
      }
      let days =
        p?.status === 'finalized'
          ? []
          : daysFor(buckets.confirmed).map((d) => ({
              ...d,
              shift_count: counts.get(d.work_date) ?? 0,
            }));
      const pending = daysFor(buckets.pending),
        live = daysFor(buckets.live);
      const item = p
        ? (
            await c.query(
              'SELECT * FROM payroll_employee_items WHERE workspace_id=$1 AND period_id=$2 AND employee_id=$3',
              [workspace, p.id, e.id],
            )
          ).rows[0]
        : undefined;
      const adjustments = item
        ? (
            await c.query(
              'SELECT *,attributable_date::text AS attributable_date FROM payroll_adjustments WHERE workspace_id=$1 AND payroll_item_id=$2',
              [workspace, item.id],
            )
          ).rows
        : [];
      const ledger = item
        ? (
            await c.query(
              'SELECT *,payment_date::text AS payment_date FROM payroll_disbursements WHERE workspace_id=$1 AND payroll_item_id=$2 ORDER BY disbursement_order',
              [workspace, item.id],
            )
          ).rows
        : [];
      if (p?.status === 'finalized' && item)
        days = (
          await c.query(
            'SELECT d.*,d.work_date::text AS work_date FROM payroll_daily_breakdowns d WHERE workspace_id=$1 AND payroll_item_id=$2 ORDER BY d.work_date',
            [workspace, item.id],
          )
        ).rows.map((d) => ({
          ...d,
          worked_seconds: Number(d.worked_seconds),
          worked_minutes: Number(d.worked_minutes),
          hourly_rate_vnd_snapshot: Number(d.hourly_rate_vnd_snapshot),
          raw_wage_vnd: Number(d.raw_wage_vnd),
          rounded_wage_vnd: Number(d.rounded_wage_vnd),
        }));
      const seconds = (
        ds: { worked_seconds: number; rounded_wage_vnd: number }[],
      ) => ds.reduce((s, d) => s + d.worked_seconds, 0);
      const sum = (
        ds: { worked_seconds: number; rounded_wage_vnd: number }[],
      ) => exactMoney(ds.reduce((s, d) => s + BigInt(d.rounded_wage_vnd), 0n));
      const base =
        p?.status === 'finalized' && item
          ? Number(item.base_pay_vnd)
          : sum(days);
      const leave = exactMoney(
        adjustments.reduce((s, a) => s + BigInt(a.amount_vnd), 0n),
      );
      const net =
        p?.status === 'finalized' && item
          ? Number(item.net_pay_vnd)
          : exactMoney(BigInt(base) + BigInt(leave));
      const paid = exactMoney(
        ledger.reduce((s, a) => s + BigInt(a.amount_vnd), 0n),
      );
      output.push({
        id: item?.id,
        version: item?.version,
        employee_id: e.id,
        employee_code: e.employee_code,
        full_name: e.full_name,
        // Display-only rate at server_as_of; never recalculate frozen wages.
        hourly_rate_vnd:
          rates.find(
            (r) =>
              instant(r.effective_from) <= asOf.getTime() &&
              (r.effective_to === null ||
                instant(r.effective_to) > asOf.getTime()),
          )?.hourly_rate_vnd ?? null,
        confirmed: {
          approved_worked_seconds: seconds(days),
          approved_worked_minutes: Math.floor(seconds(days) / 60),
          base_pay_vnd: base,
          paid_leave_pay_vnd: leave,
          allowance_vnd: 0,
          bonus_vnd: 0,
          deduction_vnd: 0,
          net_pay_vnd: net,
          paid_amount_vnd: paid,
          remaining_balance_vnd: net - paid,
          payment_status:
            paid === 0 ? 'unpaid' : paid === net ? 'paid' : 'partially_paid',
        },
        pending_review: {
          shift_count: pendingCount,
          pending_seconds: seconds(pending),
          pending_minutes: Math.floor(seconds(pending) / 60),
          estimated_pay_vnd: sum(pending),
        },
        live_provisional: {
          has_open_shift: !!open,
          current_shift_id: open?.id ?? null,
          working_state: open?.run_state ?? null,
          live_seconds: seconds(live),
          live_minutes: Math.floor(seconds(live) / 60),
          live_pay_vnd: sum(live),
        },
        daily_breakdowns: days.map((d) => ({
          ...d,
          hourly_rate_vnd: d.hourly_rate_vnd_snapshot,
        })),
        adjustments: adjustments.map((a) => ({
          ...a,
          amount_vnd: Number(a.amount_vnd),
        })),
        disbursements: ledger.map((a) => ({
          ...a,
          amount_vnd: Number(a.amount_vnd),
        })),
      });
    }
    return {
      period: {
        ...(p ?? {
          id: null,
          workspace_id: workspace,
          period_month: month,
          starts_on: b.starts_on,
          ends_on: b.ends_on,
          timezone: 'Asia/Ho_Chi_Minh',
          status: 'draft',
          calculation_revision: 1,
          finalized_at: null,
          finalized_by: null,
          finalized_snapshot_hash: null,
          version: 1,
        }),
        server_as_of: asOf.toISOString(),
      },
      server_as_of: asOf.toISOString(),
      items: output,
    };
  }
  async overview(auth: AuthenticatedContext, month: string): Promise<unknown> {
    return this.read(auth, true, (c) =>
      this.projection(c, auth.workspace.id, month),
    );
  }
  async me(auth: AuthenticatedContext, month: string): Promise<unknown> {
    // C04 also applies to frozen history from before a Staff-to-Owner promotion.
    // read() rechecks the locked membership against this authenticated role.
    requireRole(['staff'], auth);
    return this.read(auth, false, async (c) => {
      const e = (
        await c.query(
          'SELECT id FROM employees WHERE workspace_id=$1 AND user_id=$2',
          [auth.workspace.id, auth.user.id],
        )
      ).rows[0];
      if (!e) fail('FORBIDDEN', 'No employee profile', 403);
      const p = await this.projection(c, auth.workspace.id, month, e.id);
      const found = p.items[0];
      if (!found) fail('FORBIDDEN', 'Not payroll eligible', 403);
      const i = found!;
      return {
        period_month: month,
        status: p.period.status,
        server_as_of: p.server_as_of,
        employee: {
          id: i.employee_id,
          employee_code: i.employee_code,
          full_name: i.full_name,
        },
        ...i,
      };
    });
  }
  async adjustment(
    auth: AuthenticatedContext,
    month: string,
    body: Record<string, unknown>,
    key: string | undefined,
    requestId: string,
  ): Promise<unknown> {
    const employee = uuid(body.employee_id),
      v = amount(body.amount_vnd),
      day = date(body.attributable_date);
    if (body.adjustment_type !== 'paid_leave')
      fail('VALIDATION_ERROR', 'Only paid_leave is permitted', 400);
    if (
      typeof body.reason !== 'string' ||
      !body.reason.trim() ||
      body.reason.length > 1000
    )
      fail('VALIDATION_ERROR', 'Reason required', 400);
    if (!day.startsWith(month + '-'))
      fail('VALIDATION_ERROR', 'Leave date outside period', 400);
    return this.write(
      auth,
      'PAY_ADJUSTMENT:' + month,
      body,
      key,
      false,
      requestId,
      async (c) => {
        const p = (await this.period(c, auth.workspace.id, month, true))!;
        if (p.status === 'finalized')
          fail('INVALID_TRANSITION', 'Finalized snapshot', 409);
        const e = (
          await c.query(
            `SELECT e.id FROM employees e WHERE e.workspace_id=$1 AND e.id=$2 AND e.is_payroll_eligible AND NOT EXISTS(SELECT 1 FROM workspace_memberships m WHERE m.workspace_id=e.workspace_id AND m.user_id=e.user_id AND m.role='owner')`,
            [auth.workspace.id, employee],
          )
        ).rows[0];
        if (!e) fail('NOT_FOUND', 'Employee not found', 404);
        const i = (
          await c.query(
            'INSERT INTO payroll_employee_items(workspace_id,period_id,employee_id,net_pay_vnd) VALUES($1,$2,$3,0) ON CONFLICT(workspace_id,period_id,employee_id) DO UPDATE SET updated_at=clock_timestamp() RETURNING id',
            [auth.workspace.id, p.id, employee],
          )
        ).rows[0]!;
        const a = (
          await c.query(
            "INSERT INTO payroll_adjustments(workspace_id,payroll_item_id,adjustment_type,attributable_date,amount_vnd,reason,created_by) VALUES($1,$2,'paid_leave',$3,$4,$5,$6) RETURNING *,attributable_date::text AS attributable_date",
            [auth.workspace.id, i.id, day, v, body.reason, auth.user.id],
          )
        ).rows[0]!;
        await c.query(
          'UPDATE payroll_periods SET version=version+1,updated_at=clock_timestamp() WHERE id=$1',
          [p.id],
        );
        return { ...a, amount_vnd: Number(a.amount_vnd) };
      },
    );
  }
  async finalize(
    auth: AuthenticatedContext,
    month: string,
    match: string | undefined,
    key: string | undefined,
    requestId: string,
  ): Promise<unknown> {
    const expected = version(match);
    return this.write(
      auth,
      'PAY_FINALIZE:' + month,
      { if_match: match },
      key,
      true,
      requestId,
      async (c) => {
        const p = (await this.period(c, auth.workspace.id, month, true))!;
        if (p.status === 'finalized')
          fail('INVALID_TRANSITION', 'Already finalized', 409);
        if (p.version !== expected)
          fail('PRECONDITION_FAILED', 'Stale payroll version', 412);
        // Stabilize ATT reads without mutating ATT. Locks are deterministic.
        await c.query(
          'SELECT id FROM employees WHERE workspace_id=$1 ORDER BY id FOR SHARE',
          [auth.workspace.id],
        );
        await c.query(
          'SELECT id FROM attendance_shifts WHERE workspace_id=$1 ORDER BY id FOR SHARE',
          [auth.workspace.id],
        );
        await c.query(
          'SELECT id FROM attendance_shift_versions WHERE workspace_id=$1 ORDER BY id FOR SHARE',
          [auth.workspace.id],
        );
        await c.query(
          'SELECT id FROM attendance_approvals WHERE workspace_id=$1 ORDER BY id FOR SHARE',
          [auth.workspace.id],
        );
        if (
          (
            await c.query(
              "SELECT id FROM attendance_correction_requests WHERE workspace_id=$1 AND status='pending' FOR SHARE",
              [auth.workspace.id],
            )
          ).rowCount
        )
          fail(
            'UNRESOLVED_CORRECTION',
            'Resolve attendance corrections before finalizing',
          );
        const view = await this.projection(c, auth.workspace.id, month);
        for (const i of view.items) {
          const conf = i.confirmed;
          const row = (
            await c.query(
              `INSERT INTO payroll_employee_items(workspace_id,period_id,employee_id,approved_worked_seconds,approved_worked_minutes,base_pay_vnd,paid_leave_pay_vnd,net_pay_vnd) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(workspace_id,period_id,employee_id) DO UPDATE SET approved_worked_seconds=$4,approved_worked_minutes=$5,base_pay_vnd=$6,paid_leave_pay_vnd=$7,net_pay_vnd=$8 RETURNING id`,
              [
                auth.workspace.id,
                p.id,
                i.employee_id,
                conf.approved_worked_seconds,
                conf.approved_worked_minutes,
                conf.base_pay_vnd,
                conf.paid_leave_pay_vnd,
                conf.net_pay_vnd,
              ],
            )
          ).rows[0]!;
          for (const d of i.daily_breakdowns)
            await c.query(
              'INSERT INTO payroll_daily_breakdowns(workspace_id,payroll_item_id,work_date,shift_count,worked_seconds,worked_minutes,hourly_rate_vnd_snapshot,raw_wage_vnd,rounded_wage_vnd) VALUES($1,$2,$3,$9,$4,$5,$6,$7,$8)',
              [
                auth.workspace.id,
                row.id,
                d.work_date,
                d.worked_seconds,
                d.worked_minutes,
                d.hourly_rate_vnd_snapshot,
                d.raw_wage_vnd,
                d.rounded_wage_vnd,
                d.shift_count ?? 0,
              ],
            );
        }
        const hash = crypto
          .createHash('sha256')
          .update(
            JSON.stringify({
              workspace_id: auth.workspace.id,
              period_month: month,
              items: view.items.map((i) => ({
                employee_id: i.employee_id,
                approved_worked_seconds: i.confirmed.approved_worked_seconds,
                base_pay_vnd: i.confirmed.base_pay_vnd,
                paid_leave_pay_vnd: i.confirmed.paid_leave_pay_vnd,
                net_pay_vnd: i.confirmed.net_pay_vnd,
                daily_breakdowns: i.daily_breakdowns.map((d) => ({
                  work_date: d.work_date,
                  shift_count: d.shift_count,
                  worked_seconds: d.worked_seconds,
                  worked_minutes: d.worked_minutes,
                  hourly_rate_vnd_snapshot: d.hourly_rate_vnd_snapshot,
                  raw_wage_vnd: d.raw_wage_vnd,
                  rounded_wage_vnd: d.rounded_wage_vnd,
                })),
                adjustments: i.adjustments,
              })),
            }),
          )
          .digest('hex');
        const out = (
          await c.query(
            "UPDATE payroll_periods SET status='finalized',finalized_at=clock_timestamp(),finalized_by=$1,finalized_snapshot_hash=$2,version=version+1 WHERE id=$3 RETURNING *,starts_on::text AS starts_on,ends_on::text AS ends_on",
            [auth.user.id, hash, p.id],
          )
        ).rows[0]!;
        return {
          ...out,
          pending_review_shift_count: view.items.reduce(
            (s, i) => s + i.pending_review.shift_count,
            0,
          ),
        };
      },
    );
  }
  async disburse(
    auth: AuthenticatedContext,
    itemId: string,
    body: Record<string, unknown>,
    key: string | undefined,
    requestId: string,
  ): Promise<unknown> {
    uuid(itemId);
    const v = amount(body.amount_vnd),
      day = date(body.payment_date);
    const method = body.payment_method ?? 'bank_transfer';
    if (!['bank_transfer', 'cash', 'other'].includes(String(method)))
      fail('VALIDATION_ERROR', 'Invalid payment method', 400);
    if (
      body.reference_note !== undefined &&
      (typeof body.reference_note !== 'string' ||
        body.reference_note.length > 1000)
    )
      fail('VALIDATION_ERROR', 'Invalid reference note', 400);
    return this.write(
      auth,
      'PAY_DISBURSE:' + itemId,
      body,
      key,
      true,
      requestId,
      async (c) => {
        const i = (
          await c.query(
            'SELECT i.*,p.status FROM payroll_employee_items i JOIN payroll_periods p ON p.workspace_id=i.workspace_id AND p.id=i.period_id WHERE i.workspace_id=$1 AND i.id=$2 FOR UPDATE OF i,p',
            [auth.workspace.id, itemId],
          )
        ).rows[0];
        if (!i) fail('NOT_FOUND', 'Payroll item not found', 404);
        if (i.status !== 'finalized')
          fail('INVALID_TRANSITION', 'Finalize before disbursement', 409);
        const ledger = (
          await c.query(
            'SELECT COALESCE(sum(amount_vnd),0)::text AS paid,COALESCE(max(disbursement_order),0)+1 AS ord FROM payroll_disbursements WHERE workspace_id=$1 AND payroll_item_id=$2',
            [auth.workspace.id, itemId],
          )
        ).rows[0]!;
        if (BigInt(ledger.paid) + BigInt(v) > BigInt(i.net_pay_vnd))
          fail('OVERPAYMENT_BLOCKED', 'Payment exceeds remaining balance');
        const result = (
          await c.query(
            'INSERT INTO payroll_disbursements(workspace_id,payroll_item_id,disbursement_order,amount_vnd,payment_method,payment_date,reference_note,paid_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *,payment_date::text AS payment_date',
            [
              auth.workspace.id,
              itemId,
              ledger.ord,
              v,
              method,
              day,
              body.reference_note ?? null,
              auth.user.id,
            ],
          )
        ).rows[0]!;
        return { ...result, amount_vnd: Number(result.amount_vnd) };
      },
    );
  }
}
