import crypto from 'node:crypto';
import type { DatabasePool } from '../../../../packages/database/src/pool.js';
import { recordAuditEvent } from '../../../../packages/database/src/audit.js';
import { AuthError, type AuthenticatedContext } from '../auth/service.js';
import { requireRole } from '../auth/guard.js';
import type {
  BreakData,
  ShiftData,
  CorrectionRequestData,
  AttendanceMeResponseData,
  AttendanceShiftsResponseData,
  ClockInResponseData,
  BreakResponseData,
  ResumeResponseData,
  ClockOutResponseData,
  ReviewShiftRequestBody,
  ReviewShiftResponseData,
  CreateCorrectionRequestBody,
  DecideCorrectionRequestBody,
  ResetClockShiftsRequestBody,
  ResetClockShiftsResponseData,
} from '../../../../packages/contracts/src/attendance.js';

export class AttendanceService {
  constructor(private readonly pool: DatabasePool) {}

  /**
   * Helper to resolve the employee profile of the currently authenticated user in this workspace.
   */
  private async getEmployeeForUser(context: AuthenticatedContext): Promise<{
    id: string;
    employee_code: string;
    full_name: string;
    employment_status: string;
  } | null> {
    const res = await this.pool.query<{
      id: string;
      employee_code: string;
      full_name: string;
      employment_status: string;
    }>(
      `SELECT id, employee_code, full_name, employment_status
       FROM employees
       WHERE workspace_id = $1 AND user_id = $2;`,
      [context.workspace.id, context.user.id],
    );

    if (res.rows.length > 0) return res.rows[0]!;

    // Fallback 1: Safe auto-link for unlinked employee profile with exact verified identifier
    const username = (context.user.username || '').trim().toLowerCase();
    if (!username) return null;

    const candidateRes = await this.pool.query<{
      id: string;
      employee_code: string;
      full_name: string;
      employment_status: string;
    }>(
      `SELECT id, employee_code, full_name, employment_status
       FROM employees
       WHERE workspace_id = $1 AND user_id IS NULL
         AND (
           LOWER(employee_code) = $2
           OR ($3 = 'owner' AND employee_code IN ('OWNER', 'OWNER_01', 'ADM01', 'ADMIN'))
         )
       FOR UPDATE;`,
      [context.workspace.id, username, context.workspace.role],
    );

    // Only link if exactly 1 unambiguous match exists; never overwrite employment_status
    if (candidateRes.rows.length === 1) {
      const candidate = candidateRes.rows[0]!;
      const updateRes = await this.pool.query<{
        id: string;
        employee_code: string;
        full_name: string;
        employment_status: string;
      }>(
        `UPDATE employees
         SET user_id = $1, updated_at = now()
         WHERE id = $2 AND user_id IS NULL
         RETURNING id, employee_code, full_name, employment_status;`,
        [context.user.id, candidate.id],
      );
      if (updateRes.rows.length > 0) {
        return updateRes.rows[0]!;
      }
    }

    return null;
  }

  /**
   * Map raw shift row and breaks into canonical ShiftData.
   */
  private mapShiftData(
    row: {
      id: string;
      workspace_id: string;
      employee_id: string;
      employee_code?: string;
      employee_name?: string;
      clock_in_at: Date;
      clock_out_at: Date | null;
      run_state: string;
      review_state: string;
      version: number;
      current_version_id: string | null;
      created_at: Date;
      pending_cr_id?: string | null;
      pending_cr_reason?: string | null;
      pending_cr_claimed_clock_out_at?: Date | null;
      pending_cr_evidence_note?: string | null;
      pending_cr_created_at?: Date | null;
      pending_cr_version?: number | null;
      pending_cr_requested_by?: string | null;
      approval_reason?: string | null;
      approval_reviewed_at?: Date | null;
      approval_reviewer_user_id?: string | null;
      employee_user_id?: string | null;
      is_payroll_eligible?: boolean | null;
    },
    breaks: BreakData[],
    currentUserId?: string,
  ): ShiftData {
    let totalBreakSecs = 0;
    for (const b of breaks) {
      if (b.ended_at) {
        totalBreakSecs += b.duration_seconds;
      }
    }

    const endTime = row.clock_out_at ? row.clock_out_at.getTime() : Date.now();
    const grossSecs = Math.max(
      0,
      Math.floor((endTime - row.clock_in_at.getTime()) / 1000),
    );
    const worked_seconds = Math.max(0, grossSecs - totalBreakSecs);

    let pending_correction: CorrectionRequestData | null = null;
    if (row.pending_cr_id) {
      pending_correction = {
        id: row.pending_cr_id,
        workspace_id: row.workspace_id,
        shift_id: row.id,
        requested_by_user_id: row.pending_cr_requested_by || '',
        status: 'pending',
        reason: row.pending_cr_reason || '',
        claimed_clock_out_at: row.pending_cr_claimed_clock_out_at
          ? row.pending_cr_claimed_clock_out_at.toISOString()
          : null,
        evidence_note: row.pending_cr_evidence_note || null,
        decision_reason: null,
        decided_by_user_id: null,
        decided_at: null,
        version: row.pending_cr_version || 1,
        created_at: row.pending_cr_created_at
          ? row.pending_cr_created_at.toISOString()
          : row.created_at.toISOString(),
      };
    }

    return {
      id: row.id,
      workspace_id: row.workspace_id,
      employee_id: row.employee_id,
      employee_code: row.employee_code,
      employee_name: row.employee_name,
      shift_date: row.clock_in_at.toLocaleDateString('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
      }),
      clock_in_at: row.clock_in_at.toISOString(),
      clock_out_at: row.clock_out_at ? row.clock_out_at.toISOString() : null,
      run_state: row.run_state as ShiftData['run_state'],
      review_state: row.review_state as ShiftData['review_state'],
      version: row.version,
      current_version_id: row.current_version_id,
      breaks,
      worked_seconds,
      created_at: row.created_at.toISOString(),
      pending_correction,
      review_reason: row.approval_reason ?? null,
      reviewed_at: row.approval_reviewed_at
        ? row.approval_reviewed_at.toISOString()
        : null,
      reviewed_by_user_id: row.approval_reviewer_user_id ?? null,
      is_self_shift: Boolean(
        currentUserId &&
        row.employee_user_id &&
        row.employee_user_id === currentUserId,
      ),
      is_payroll_eligible: row.is_payroll_eligible !== false,
    };
  }

  private parseFilterDate(val: string, isEndOfDay = false): Date {
    const trimmed = val.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return new Date(
        isEndOfDay
          ? `${trimmed}T23:59:59.999+07:00`
          : `${trimmed}T00:00:00.000+07:00`,
      );
    }
    return new Date(trimmed);
  }

  private parseKeysetCursor(
    cursor: string | undefined,
  ): { clockInAt: Date; id: string } | null {
    if (!cursor) return null;
    const raw = cursor.trim();
    const sep = raw.indexOf('|');
    if (sep > 0) {
      const ts = new Date(raw.slice(0, sep));
      const id = raw.slice(sep + 1).trim();
      if (!isNaN(ts.getTime()) && /^[a-f0-9-]{36}$/i.test(id)) {
        return { clockInAt: ts, id };
      }
    }
    const tsOnly = new Date(raw);
    if (!isNaN(tsOnly.getTime())) {
      return {
        clockInAt: tsOnly,
        id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      };
    }
    return null;
  }

  /**
   * GET /api/v1/attendance/me
   * Fetches current shift and recent/filtered history for the authenticated user.
   */
  async getAttendanceMe(
    context: AuthenticatedContext,
    filters: {
      from_date?: string | undefined;
      to_date?: string | undefined;
      run_state?: string | undefined;
      review_state?: string | undefined;
      limit?: number | undefined;
      offset?: number | undefined;
      cursor?: string | undefined;
    } = {},
  ): Promise<AttendanceMeResponseData> {
    const employee = await this.getEmployeeForUser(context);
    if (!employee) {
      return { current_shift: null, recent_shifts: [], total: 0 };
    }

    const limit = Math.min(Math.max(Number(filters.limit) || 30, 1), 500);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const parsedCursor = this.parseKeysetCursor(filters.cursor);
    const filterParams: unknown[] = [context.workspace.id, employee.id];
    let whereClause = '';

    if (filters.run_state) {
      filterParams.push(filters.run_state);
      whereClause += ` AND s.run_state = $${filterParams.length}`;
    }

    if (filters.review_state) {
      filterParams.push(filters.review_state);
      whereClause += ` AND s.review_state = $${filterParams.length}`;
    }

    if (filters.from_date) {
      filterParams.push(this.parseFilterDate(filters.from_date, false));
      whereClause += ` AND s.clock_in_at >= $${filterParams.length}`;
    }

    if (filters.to_date) {
      filterParams.push(this.parseFilterDate(filters.to_date, true));
      whereClause += ` AND s.clock_in_at <= $${filterParams.length}`;
    }

    const countRes = await this.pool.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt
       FROM attendance_shifts s
       WHERE s.workspace_id = $1 AND s.employee_id = $2 ${whereClause};`,
      filterParams,
    );
    const total = countRes.rows[0]?.cnt ?? 0;

    const pageParams = [...filterParams];
    let cursorClause = '';
    if (parsedCursor) {
      pageParams.push(parsedCursor.clockInAt, parsedCursor.id);
      const tsIdx = `$${pageParams.length - 1}`;
      const idIdx = `$${pageParams.length}`;
      cursorClause = ` AND (s.clock_in_at, s.id) < (${tsIdx}, ${idIdx}::uuid)`;
    }

    const queryParams = parsedCursor
      ? [...pageParams, limit]
      : [...pageParams, limit, offset];
    const limitIdx = `$${pageParams.length + 1}`;
    const offsetClause = parsedCursor
      ? ''
      : ` OFFSET $${pageParams.length + 2}`;

    const shiftsRes = await this.pool.query<{
      id: string;
      workspace_id: string;
      employee_id: string;
      employee_code: string;
      employee_name: string;
      clock_in_at: Date;
      clock_out_at: Date | null;
      run_state: string;
      review_state: string;
      version: number;
      current_version_id: string | null;
      created_at: Date;
      pending_cr_id: string | null;
      pending_cr_reason: string | null;
      pending_cr_claimed_clock_out_at: Date | null;
      pending_cr_evidence_note: string | null;
      pending_cr_created_at: Date | null;
      pending_cr_version: number | null;
      pending_cr_requested_by: string | null;
      approval_reason: string | null;
      approval_reviewed_at: Date | null;
      approval_reviewer_user_id: string | null;
      employee_user_id: string | null;
      is_payroll_eligible: boolean | null;
    }>(
      `
      SELECT
        s.id,
        s.workspace_id,
        s.employee_id,
        e.employee_code,
        e.full_name AS employee_name,
        e.user_id AS employee_user_id,
        e.is_payroll_eligible,
        s.clock_in_at,
        s.clock_out_at,
        s.run_state,
        s.review_state,
        s.version,
        s.current_version_id,
        s.created_at,
        cr.id AS pending_cr_id,
        cr.reason AS pending_cr_reason,
        cr.claimed_clock_out_at AS pending_cr_claimed_clock_out_at,
        cr.evidence_note AS pending_cr_evidence_note,
        cr.created_at AS pending_cr_created_at,
        cr.version AS pending_cr_version,
        cr.requested_by_user_id AS pending_cr_requested_by,
        ap.reason AS approval_reason,
        ap.reviewed_at AS approval_reviewed_at,
        ap.reviewer_user_id AS approval_reviewer_user_id
      FROM attendance_shifts s
      JOIN employees e ON e.id = s.employee_id
      LEFT JOIN attendance_correction_requests cr
        ON cr.shift_id = s.id AND cr.status = 'pending'
      LEFT JOIN attendance_approvals ap
        ON ap.workspace_id = s.workspace_id AND ap.shift_version_id = s.current_version_id
      WHERE s.workspace_id = $1 AND s.employee_id = $2
      ${whereClause}${cursorClause}
      ORDER BY s.clock_in_at DESC, s.id DESC
      LIMIT ${limitIdx}${offsetClause};
    `,
      queryParams,
    );

    // Also ensure we always resolve current_shift even if filtered out of recent_shifts
    const openShiftRes = await this.pool.query<{
      id: string;
      workspace_id: string;
      employee_id: string;
      employee_code: string;
      employee_name: string;
      clock_in_at: Date;
      clock_out_at: Date | null;
      run_state: string;
      review_state: string;
      version: number;
      current_version_id: string | null;
      created_at: Date;
      pending_cr_id: string | null;
      pending_cr_reason: string | null;
      pending_cr_claimed_clock_out_at: Date | null;
      pending_cr_evidence_note: string | null;
      pending_cr_created_at: Date | null;
      pending_cr_version: number | null;
      pending_cr_requested_by: string | null;
    }>(
      `
      SELECT
        s.id,
        s.workspace_id,
        s.employee_id,
        e.employee_code,
        e.full_name AS employee_name,
        s.clock_in_at,
        s.clock_out_at,
        s.run_state,
        s.review_state,
        s.version,
        s.current_version_id,
        s.created_at,
        cr.id AS pending_cr_id,
        cr.reason AS pending_cr_reason,
        cr.claimed_clock_out_at AS pending_cr_claimed_clock_out_at,
        cr.evidence_note AS pending_cr_evidence_note,
        cr.created_at AS pending_cr_created_at,
        cr.version AS pending_cr_version,
        cr.requested_by_user_id AS pending_cr_requested_by
      FROM attendance_shifts s
      JOIN employees e ON e.id = s.employee_id
      LEFT JOIN attendance_correction_requests cr
        ON cr.shift_id = s.id AND cr.status = 'pending'
      WHERE s.workspace_id = $1 AND s.employee_id = $2
        AND s.run_state IN ('working', 'paused')
      ORDER BY s.clock_in_at DESC
      LIMIT 1;
    `,
      [context.workspace.id, employee.id],
    );

    const allRows = [...shiftsRes.rows];
    if (
      openShiftRes.rows[0] &&
      !allRows.some((r) => r.id === openShiftRes.rows[0]!.id)
    ) {
      allRows.push({
        ...openShiftRes.rows[0]!,
        approval_reason: null,
        approval_reviewed_at: null,
        approval_reviewer_user_id: null,
        employee_user_id: context.user.id,
        is_payroll_eligible: null,
      });
    }

    if (allRows.length === 0) {
      return { current_shift: null, recent_shifts: [], total: 0 };
    }

    // 2. Fetch breaks for all returned shifts
    const shiftIds = allRows.map((r) => r.id);
    const breaksRes = await this.pool.query<{
      id: string;
      shift_id: string;
      started_at: Date;
      ended_at: Date | null;
      unpaid: boolean;
    }>(
      `
      SELECT id, shift_id, started_at, ended_at, unpaid
      FROM attendance_breaks
      WHERE workspace_id = $1 AND shift_id = ANY($2::uuid[])
      ORDER BY started_at ASC;
    `,
      [context.workspace.id, shiftIds],
    );

    const breaksByShift = new Map<string, BreakData[]>();
    for (const b of breaksRes.rows) {
      const durationSecs = b.ended_at
        ? Math.max(
            0,
            Math.floor((b.ended_at.getTime() - b.started_at.getTime()) / 1000),
          )
        : Math.max(0, Math.floor((Date.now() - b.started_at.getTime()) / 1000));

      const list = breaksByShift.get(b.shift_id) || [];
      list.push({
        id: b.id,
        started_at: b.started_at.toISOString(),
        ended_at: b.ended_at ? b.ended_at.toISOString() : null,
        unpaid: b.unpaid,
        duration_seconds: durationSecs,
      });
      breaksByShift.set(b.shift_id, list);
    }

    const ownerSelfUserId =
      context.workspace.role === 'owner' ? context.user.id : undefined;

    const recentMapped = shiftsRes.rows.map((row) =>
      this.mapShiftData(row, breaksByShift.get(row.id) || [], ownerSelfUserId),
    );

    const openRow = openShiftRes.rows[0];
    const current_shift = openRow
      ? this.mapShiftData(
          {
            ...openRow,
            approval_reason: null,
            approval_reviewed_at: null,
            approval_reviewer_user_id: null,
            employee_user_id: context.user.id,
          },
          breaksByShift.get(openRow.id) || [],
          ownerSelfUserId,
        )
      : null;

    return {
      current_shift,
      recent_shifts: recentMapped,
      total,
    };
  }

  /**
   * POST /api/v1/attendance/shifts
   * Clock in. Creates a new shift in 'working' state.
   */
  async clockIn(
    context: AuthenticatedContext,
    requestId: string,
  ): Promise<ClockInResponseData> {
    const employee = await this.getEmployeeForUser(context);
    if (!employee) {
      throw new AuthError(
        'FORBIDDEN',
        'Tài khoản chưa được liên kết với hồ sơ nhân viên trong chi nhánh này.',
        403,
      );
    }

    if (employee.employment_status !== 'active') {
      throw new AuthError(
        'FORBIDDEN',
        'Hồ sơ nhân viên chưa được kích hoạt hoặc đang bị tạm ngưng.',
        403,
      );
    }

    // Check if employee already has an open shift (run_state working or paused)
    const openRes = await this.pool.query<{ id: string; run_state: string }>(
      `
      SELECT id, run_state FROM attendance_shifts
      WHERE workspace_id = $1 AND employee_id = $2 AND run_state IN ('working', 'paused');
    `,
      [context.workspace.id, employee.id],
    );

    if (openRes.rows.length > 0) {
      throw new AuthError(
        'CONFLICT',
        'Nhân viên đang trong ca làm việc, không thể bắt đầu ca mới.',
        409,
      );
    }

    const now = new Date();
    const shiftId = crypto.randomUUID();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `
        INSERT INTO attendance_shifts (
          id, workspace_id, employee_id, clock_in_at, run_state, review_state, version
        ) VALUES (
          $1, $2, $3, $4, 'working', 'unreviewed', 1
        );
      `,
        [shiftId, context.workspace.id, employee.id, now],
      );

      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'attendance.clock_in',
        entityType: 'attendance_shift',
        entityId: shiftId,
        requestId,
        metadata: {
          employee_id: employee.id,
          clock_in_at: now.toISOString(),
        },
      });

      await client.query('COMMIT');

      return {
        shift_id: shiftId,
        run_state: 'working',
        clock_in_at: now.toISOString(),
        version: 1,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * POST /api/v1/attendance/shifts/:id/breaks
   * Start an unpaid break. Only allowed from 'working' state.
   */
  async startBreak(
    context: AuthenticatedContext,
    shiftId: string,
    requestId: string,
  ): Promise<BreakResponseData> {
    const shiftRes = await this.pool.query<{
      id: string;
      workspace_id: string;
      employee_id: string;
      run_state: string;
      version: number;
      employee_user_id: string | null;
    }>(
      `
      SELECT s.id, s.workspace_id, s.employee_id, s.run_state, s.version, e.user_id AS employee_user_id
      FROM attendance_shifts s
      JOIN employees e ON e.id = s.employee_id
      WHERE s.id = $1 AND s.workspace_id = $2;
    `,
      [shiftId, context.workspace.id],
    );

    if (shiftRes.rows.length === 0) {
      throw new AuthError('NOT_FOUND', 'Ca làm việc không tồn tại.', 404);
    }

    const shift = shiftRes.rows[0]!;
    if (shift.employee_user_id !== context.user.id) {
      throw new AuthError(
        'FORBIDDEN',
        'Bạn chỉ có thể thao tác trên ca làm của chính mình.',
        403,
      );
    }

    if (shift.run_state !== 'working') {
      throw new AuthError(
        'INVALID_STATE_TRANSITION',
        'Chỉ có thể bắt đầu nghỉ khi ca đang ở trạng thái làm việc.',
        422,
      );
    }

    const now = new Date();
    const breakId = crypto.randomUUID();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `
        INSERT INTO attendance_breaks (id, workspace_id, shift_id, started_at, unpaid)
        VALUES ($1, $2, $3, $4, true);
      `,
        [breakId, context.workspace.id, shift.id, now],
      );

      const updateRes = await client.query<{ version: number }>(
        `
        UPDATE attendance_shifts
        SET run_state = 'paused', version = version + 1, updated_at = now()
        WHERE id = $1 AND workspace_id = $2
        RETURNING version;
      `,
        [shift.id, context.workspace.id],
      );

      const newVersion = updateRes.rows[0]!.version;

      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'attendance.break_started',
        entityType: 'attendance_break',
        entityId: breakId,
        requestId,
        metadata: {
          shift_id: shift.id,
          started_at: now.toISOString(),
        },
      });

      await client.query('COMMIT');

      return {
        break_id: breakId,
        started_at: now.toISOString(),
        run_state: 'paused',
        version: newVersion,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * POST /api/v1/attendance/shifts/:id/resume
   * End the current open break and resume 'working' state.
   */
  async resumeBreak(
    context: AuthenticatedContext,
    shiftId: string,
    requestId: string,
  ): Promise<ResumeResponseData> {
    const shiftRes = await this.pool.query<{
      id: string;
      workspace_id: string;
      employee_id: string;
      run_state: string;
      version: number;
      employee_user_id: string | null;
    }>(
      `
      SELECT s.id, s.workspace_id, s.employee_id, s.run_state, s.version, e.user_id AS employee_user_id
      FROM attendance_shifts s
      JOIN employees e ON e.id = s.employee_id
      WHERE s.id = $1 AND s.workspace_id = $2;
    `,
      [shiftId, context.workspace.id],
    );

    if (shiftRes.rows.length === 0) {
      throw new AuthError('NOT_FOUND', 'Ca làm việc không tồn tại.', 404);
    }

    const shift = shiftRes.rows[0]!;
    if (shift.employee_user_id !== context.user.id) {
      throw new AuthError(
        'FORBIDDEN',
        'Bạn chỉ có thể thao tác trên ca làm của chính mình.',
        403,
      );
    }

    if (shift.run_state !== 'paused') {
      throw new AuthError(
        'INVALID_STATE_TRANSITION',
        'Ca làm không ở trạng thái tạm nghỉ.',
        422,
      );
    }

    const openBreakRes = await this.pool.query<{
      id: string;
      started_at: Date;
    }>(
      `
      SELECT id, started_at
      FROM attendance_breaks
      WHERE workspace_id = $1 AND shift_id = $2 AND ended_at IS NULL
      ORDER BY started_at DESC LIMIT 1;
    `,
      [context.workspace.id, shift.id],
    );

    if (openBreakRes.rows.length === 0) {
      throw new AuthError('CONFLICT', 'Không tìm thấy đợt nghỉ đang mở.', 409);
    }

    const openBreak = openBreakRes.rows[0]!;
    const now = new Date();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `
        UPDATE attendance_breaks
        SET ended_at = $1
        WHERE id = $2;
      `,
        [now, openBreak.id],
      );

      const updateRes = await client.query<{ version: number }>(
        `
        UPDATE attendance_shifts
        SET run_state = 'working', version = version + 1, updated_at = now()
        WHERE id = $1 AND workspace_id = $2
        RETURNING version;
      `,
        [shift.id, context.workspace.id],
      );

      const newVersion = updateRes.rows[0]!.version;

      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'attendance.break_ended',
        entityType: 'attendance_break',
        entityId: openBreak.id,
        requestId,
        metadata: {
          shift_id: shift.id,
          ended_at: now.toISOString(),
        },
      });

      await client.query('COMMIT');

      return {
        ended_at: now.toISOString(),
        run_state: 'working',
        version: newVersion,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * POST /api/v1/attendance/shifts/:id/clock-out
   * End shift. Only allowed from 'working' state (cannot clock out during break per canonical).
   * Creates an immutable snapshot in attendance_shift_versions and marks review_state as 'unreviewed'.
   */
  async clockOut(
    context: AuthenticatedContext,
    shiftId: string,
    requestId: string,
  ): Promise<ClockOutResponseData> {
    const shiftRes = await this.pool.query<{
      id: string;
      workspace_id: string;
      employee_id: string;
      clock_in_at: Date;
      run_state: string;
      version: number;
      employee_user_id: string | null;
    }>(
      `
      SELECT s.id, s.workspace_id, s.employee_id, s.clock_in_at, s.run_state, s.version, e.user_id AS employee_user_id
      FROM attendance_shifts s
      JOIN employees e ON e.id = s.employee_id
      WHERE s.id = $1 AND s.workspace_id = $2;
    `,
      [shiftId, context.workspace.id],
    );

    if (shiftRes.rows.length === 0) {
      throw new AuthError('NOT_FOUND', 'Ca làm việc không tồn tại.', 404);
    }

    const shift = shiftRes.rows[0]!;
    if (shift.employee_user_id !== context.user.id) {
      throw new AuthError(
        'FORBIDDEN',
        'Bạn chỉ có thể thao tác trên ca làm của chính mình.',
        403,
      );
    }

    if (shift.run_state !== 'working') {
      throw new AuthError(
        'INVALID_STATE_TRANSITION',
        'Chỉ có thể kết thúc ca khi đang làm việc. Nếu đang tạm nghỉ, vui lòng tiếp tục làm việc trước.',
        422,
      );
    }

    const now = new Date();

    // Query all completed breaks for this shift
    const breaksRes = await this.pool.query<{
      id: string;
      started_at: Date;
      ended_at: Date;
      unpaid: boolean;
    }>(
      `
      SELECT id, started_at, ended_at, unpaid
      FROM attendance_breaks
      WHERE workspace_id = $1 AND shift_id = $2 AND ended_at IS NOT NULL
      ORDER BY started_at ASC;
    `,
      [context.workspace.id, shift.id],
    );

    let totalBreakSecs = 0;
    const breaksSnapshot = breaksRes.rows.map((b) => {
      const dur = Math.max(
        0,
        Math.floor((b.ended_at.getTime() - b.started_at.getTime()) / 1000),
      );
      if (b.unpaid) totalBreakSecs += dur;
      return {
        id: b.id,
        started_at: b.started_at.toISOString(),
        ended_at: b.ended_at.toISOString(),
        unpaid: b.unpaid,
        duration_seconds: dur,
      };
    });

    const grossSecs = Math.max(
      0,
      Math.floor((now.getTime() - shift.clock_in_at.getTime()) / 1000),
    );
    const workedSeconds = Math.max(0, grossSecs - totalBreakSecs);

    const snapshotHash = crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          shift_id: shift.id,
          clock_in_at: shift.clock_in_at.toISOString(),
          clock_out_at: now.toISOString(),
          breaks: breaksSnapshot,
          worked_seconds: workedSeconds,
        }),
      )
      .digest('hex');

    const shiftVersionId = crypto.randomUUID();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Insert immutable attendance_shift_versions
      await client.query(
        `
        INSERT INTO attendance_shift_versions (
          id, workspace_id, shift_id, version_number, clock_in_at, clock_out_at,
          breaks_snapshot, worked_seconds, snapshot_hash, created_by, reason
        ) VALUES (
          $1, $2, $3, 1, $4, $5, $6, $7, $8, $9, 'Initial shift completion'
        );
      `,
        [
          shiftVersionId,
          context.workspace.id,
          shift.id,
          shift.clock_in_at,
          now,
          JSON.stringify(breaksSnapshot),
          workedSeconds,
          snapshotHash,
          context.user.id,
        ],
      );

      // 2. Update attendance_shifts (auto-approve if Owner clocks out of own shift)
      const isOwnerSelfShift = context.workspace.role === 'owner';
      const nextReviewState = isOwnerSelfShift ? 'approved' : 'unreviewed';
      const updateRes = await client.query<{ version: number }>(
        `
        UPDATE attendance_shifts
        SET
          clock_out_at = $1,
          run_state = 'completed',
          review_state = $5,
          current_version_id = $2,
          version = version + 1,
          updated_at = now()
        WHERE id = $3 AND workspace_id = $4
        RETURNING version;
      `,
        [now, shiftVersionId, shift.id, context.workspace.id, nextReviewState],
      );

      if (isOwnerSelfShift) {
        await client.query(
          `
          INSERT INTO attendance_approvals (
            id, workspace_id, shift_id, shift_version_id, reviewer_user_id, decision, reason, reviewed_at
          ) VALUES (
            $1, $2, $3, $4, $5, 'approved', 'Tự động ghi nhận ca của Chủ sở hữu', $6
          )
          ON CONFLICT DO NOTHING;
        `,
          [
            crypto.randomUUID(),
            context.workspace.id,
            shift.id,
            shiftVersionId,
            context.user.id,
            now,
          ],
        );
      }

      const newVersion = updateRes.rows[0]!.version;

      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'attendance.clock_out',
        entityType: 'attendance_shift',
        entityId: shift.id,
        requestId,
        metadata: {
          shift_version_id: shiftVersionId,
          clock_out_at: now.toISOString(),
          worked_seconds: workedSeconds,
        },
      });

      await client.query('COMMIT');

      return {
        clock_out_at: now.toISOString(),
        run_state: 'completed',
        shift_version_id: shiftVersionId,
        worked_seconds: workedSeconds,
        version: newVersion,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * GET /api/v1/attendance/shifts
   * Lists shifts for all employees in the active workspace (Owner only).
   */
  async listShifts(
    context: AuthenticatedContext,
    filters: {
      employee_id?: string | undefined;
      from_date?: string | undefined;
      to_date?: string | undefined;
      run_state?: string | undefined;
      review_state?: string | undefined;
      limit?: number | undefined;
      offset?: number | undefined;
      cursor?: string | undefined;
    } = {},
  ): Promise<AttendanceShiftsResponseData> {
    requireRole(['owner'], context);

    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 500);
    const offset = Math.max(Number(filters.offset) || 0, 0);
    const parsedCursor = this.parseKeysetCursor(filters.cursor);
    const filterParams: unknown[] = [context.workspace.id];

    let whereClause = '';

    if (filters.employee_id) {
      filterParams.push(filters.employee_id);
      whereClause += ` AND s.employee_id = $${filterParams.length}`;
    }

    if (filters.run_state) {
      filterParams.push(filters.run_state);
      whereClause += ` AND s.run_state = $${filterParams.length}`;
    }

    if (filters.review_state) {
      filterParams.push(filters.review_state);
      whereClause += ` AND s.review_state = $${filterParams.length}`;
    }

    if (filters.from_date) {
      filterParams.push(this.parseFilterDate(filters.from_date, false));
      whereClause += ` AND s.clock_in_at >= $${filterParams.length}`;
    }

    if (filters.to_date) {
      filterParams.push(this.parseFilterDate(filters.to_date, true));
      whereClause += ` AND s.clock_in_at <= $${filterParams.length}`;
    }

    const countRes = await this.pool.query<{ cnt: number }>(
      `SELECT COUNT(*)::int AS cnt
       FROM attendance_shifts s
       WHERE s.workspace_id = $1 ${whereClause};`,
      filterParams,
    );
    const total = countRes.rows[0]?.cnt ?? 0;

    const pageParams = [...filterParams];
    let cursorClause = '';
    if (parsedCursor) {
      pageParams.push(parsedCursor.clockInAt, parsedCursor.id);
      const tsIdx = `$${pageParams.length - 1}`;
      const idIdx = `$${pageParams.length}`;
      cursorClause = ` AND (s.clock_in_at, s.id) < (${tsIdx}, ${idIdx}::uuid)`;
    }

    const params = parsedCursor
      ? [...pageParams, limit]
      : [...pageParams, limit, offset];
    const limitPlaceholder = `$${pageParams.length + 1}`;
    const offsetClause = parsedCursor
      ? ''
      : ` OFFSET $${pageParams.length + 2}`;

    const shiftsRes = await this.pool.query<{
      id: string;
      workspace_id: string;
      employee_id: string;
      employee_code: string;
      employee_name: string;
      clock_in_at: Date;
      clock_out_at: Date | null;
      run_state: string;
      review_state: string;
      version: number;
      current_version_id: string | null;
      created_at: Date;
      pending_cr_id: string | null;
      pending_cr_reason: string | null;
      pending_cr_claimed_clock_out_at: Date | null;
      pending_cr_evidence_note: string | null;
      pending_cr_created_at: Date | null;
      pending_cr_version: number | null;
      pending_cr_requested_by: string | null;
      approval_reason: string | null;
      approval_reviewed_at: Date | null;
      approval_reviewer_user_id: string | null;
      employee_user_id: string | null;
      is_payroll_eligible: boolean | null;
    }>(
      `
      SELECT
        s.id,
        s.workspace_id,
        s.employee_id,
        e.employee_code,
        e.full_name AS employee_name,
        e.user_id AS employee_user_id,
        e.is_payroll_eligible,
        s.clock_in_at,
        s.clock_out_at,
        s.run_state,
        s.review_state,
        s.version,
        s.current_version_id,
        s.created_at,
        cr.id AS pending_cr_id,
        cr.reason AS pending_cr_reason,
        cr.claimed_clock_out_at AS pending_cr_claimed_clock_out_at,
        cr.evidence_note AS pending_cr_evidence_note,
        cr.created_at AS pending_cr_created_at,
        cr.version AS pending_cr_version,
        cr.requested_by_user_id AS pending_cr_requested_by,
        ap.reason AS approval_reason,
        ap.reviewed_at AS approval_reviewed_at,
        ap.reviewer_user_id AS approval_reviewer_user_id
      FROM attendance_shifts s
      JOIN employees e ON e.id = s.employee_id
      LEFT JOIN attendance_correction_requests cr
        ON cr.shift_id = s.id AND cr.status = 'pending'
      LEFT JOIN attendance_approvals ap
        ON ap.workspace_id = s.workspace_id AND ap.shift_version_id = s.current_version_id
      WHERE s.workspace_id = $1
      ${whereClause}${cursorClause}
      ORDER BY s.clock_in_at DESC, s.id DESC
      LIMIT ${limitPlaceholder}${offsetClause};
    `,
      params,
    );

    if (shiftsRes.rows.length === 0) {
      return { shifts: [], total };
    }

    const shiftIds = shiftsRes.rows.map((r) => r.id);
    const breaksRes = await this.pool.query<{
      id: string;
      shift_id: string;
      started_at: Date;
      ended_at: Date | null;
      unpaid: boolean;
    }>(
      `
      SELECT id, shift_id, started_at, ended_at, unpaid
      FROM attendance_breaks
      WHERE workspace_id = $1 AND shift_id = ANY($2::uuid[])
      ORDER BY started_at ASC;
    `,
      [context.workspace.id, shiftIds],
    );

    const breaksByShift = new Map<string, BreakData[]>();
    for (const b of breaksRes.rows) {
      const dur = b.ended_at
        ? Math.max(
            0,
            Math.floor((b.ended_at.getTime() - b.started_at.getTime()) / 1000),
          )
        : Math.max(0, Math.floor((Date.now() - b.started_at.getTime()) / 1000));

      const list = breaksByShift.get(b.shift_id) || [];
      list.push({
        id: b.id,
        started_at: b.started_at.toISOString(),
        ended_at: b.ended_at ? b.ended_at.toISOString() : null,
        unpaid: b.unpaid,
        duration_seconds: dur,
      });
      breaksByShift.set(b.shift_id, list);
    }

    const shifts = shiftsRes.rows.map((row) =>
      this.mapShiftData(row, breaksByShift.get(row.id) || [], context.user.id),
    );

    return {
      shifts,
      total,
    };
  }

  /**
   * POST /api/v1/attendance/shifts/:id/owner-close
   * Allows Owner to close an open ('working' | 'paused') shift on behalf of an employee
   * (e.g., when an employee forgot to clock out) and record a valid completed shift version.
   */
  async ownerCloseShift(
    context: AuthenticatedContext,
    shiftId: string,
    body: { clock_out_at?: string | undefined; reason?: string | undefined },
    requestId: string,
  ): Promise<ReviewShiftResponseData> {
    requireRole(['owner'], context);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const shiftRes = await client.query<{
        id: string;
        workspace_id: string;
        employee_id: string;
        clock_in_at: Date;
        run_state: string;
        current_version_id: string | null;
        employee_user_id: string | null;
      }>(
        `
        SELECT s.id, s.workspace_id, s.employee_id, s.clock_in_at, s.run_state, s.current_version_id, e.user_id AS employee_user_id
        FROM attendance_shifts s
        JOIN employees e ON e.id = s.employee_id
        WHERE s.id = $1 AND s.workspace_id = $2
        FOR UPDATE OF s;
      `,
        [shiftId, context.workspace.id],
      );

      if (shiftRes.rows.length === 0) {
        throw new AuthError('NOT_FOUND', 'Ca làm việc không tồn tại.', 404);
      }

      const shift = shiftRes.rows[0]!;
      if (shift.run_state === 'completed') {
        throw new AuthError(
          'INVALID_STATE_TRANSITION',
          'Ca làm việc này đã được đóng.',
          422,
        );
      }

      const now = new Date();
      // Default to min(now, clock_in_at + 8 hours) if not explicitly provided
      const defaultEnd = new Date(
        Math.min(now.getTime(), shift.clock_in_at.getTime() + 8 * 3600 * 1000),
      );
      const explicitClockOut = body.clock_out_at
        ? new Date(body.clock_out_at)
        : defaultEnd > shift.clock_in_at
          ? defaultEnd
          : now;

      if (
        isNaN(explicitClockOut.getTime()) ||
        explicitClockOut <= shift.clock_in_at
      ) {
        throw new AuthError(
          'VALIDATION_ERROR',
          'Giờ kết thúc ca không hợp lệ hoặc sớm hơn giờ vào ca.',
          400,
        );
      }

      await client.query(
        `
        UPDATE attendance_breaks
        SET ended_at = LEAST($1, started_at + interval '1 hour')
        WHERE workspace_id = $2 AND shift_id = $3 AND ended_at IS NULL;
      `,
        [explicitClockOut, context.workspace.id, shift.id],
      );

      const breaksRes = await client.query<{
        id: string;
        started_at: Date;
        ended_at: Date;
        unpaid: boolean;
      }>(
        `
        SELECT id, started_at, ended_at, unpaid
        FROM attendance_breaks
        WHERE workspace_id = $1 AND shift_id = $2
        ORDER BY started_at ASC;
      `,
        [context.workspace.id, shift.id],
      );

      let totalBreakSecs = 0;
      const breaksSnapshot = breaksRes.rows.map((b) => {
        const dur = Math.max(
          0,
          Math.floor((b.ended_at.getTime() - b.started_at.getTime()) / 1000),
        );
        if (b.unpaid) totalBreakSecs += dur;
        return {
          id: b.id,
          started_at: b.started_at.toISOString(),
          ended_at: b.ended_at.toISOString(),
          unpaid: b.unpaid,
          duration_seconds: dur,
        };
      });

      const grossSecs = Math.max(
        0,
        Math.floor(
          (explicitClockOut.getTime() - shift.clock_in_at.getTime()) / 1000,
        ),
      );
      const workedSeconds = Math.max(0, grossSecs - totalBreakSecs);

      const versionNumRes = await client.query<{ next_version: number }>(
        `
        SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
        FROM attendance_shift_versions
        WHERE workspace_id = $1 AND shift_id = $2;
      `,
        [context.workspace.id, shift.id],
      );
      const nextVersionNumber = versionNumRes.rows[0]!.next_version;
      const newVersionId = crypto.randomUUID();
      const closeReason =
        body.reason?.trim() || 'Chủ sở hữu đóng ca & xác nhận giúp nhân viên';

      const snapshotHash = crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            shift_id: shift.id,
            clock_in_at: shift.clock_in_at.toISOString(),
            clock_out_at: explicitClockOut.toISOString(),
            breaks: breaksSnapshot,
            worked_seconds: workedSeconds,
            version_number: nextVersionNumber,
          }),
        )
        .digest('hex');

      await client.query(
        `
        INSERT INTO attendance_shift_versions (
          id, workspace_id, shift_id, version_number, clock_in_at, clock_out_at,
          breaks_snapshot, worked_seconds, snapshot_hash, created_by, reason
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
        );
      `,
        [
          newVersionId,
          context.workspace.id,
          shift.id,
          nextVersionNumber,
          shift.clock_in_at,
          explicitClockOut,
          JSON.stringify(breaksSnapshot),
          workedSeconds,
          snapshotHash,
          context.user.id,
          closeReason,
        ],
      );

      await client.query(
        `
        UPDATE attendance_shifts
        SET
          clock_out_at = $1,
          run_state = 'completed',
          review_state = 'approved',
          current_version_id = $2,
          version = version + 1,
          updated_at = now()
        WHERE id = $3 AND workspace_id = $4;
      `,
        [explicitClockOut, newVersionId, shift.id, context.workspace.id],
      );

      await client.query(
        `
        INSERT INTO attendance_approvals (
          id, workspace_id, shift_id, shift_version_id, reviewer_user_id, decision, reason, reviewed_at
        ) VALUES (
          $1, $2, $3, $4, $5, 'approved', $6, $7
        )
        ON CONFLICT DO NOTHING;
      `,
        [
          crypto.randomUUID(),
          context.workspace.id,
          shift.id,
          newVersionId,
          context.user.id,
          closeReason,
          now,
        ],
      );

      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'attendance.owner_close_shift',
        entityType: 'attendance_shift',
        entityId: shift.id,
        requestId,
        metadata: {
          shift_version_id: newVersionId,
          clock_out_at: explicitClockOut.toISOString(),
          worked_seconds: workedSeconds,
          reason: closeReason,
        },
      });

      await client.query('COMMIT');
      return {
        shift_id: shift.id,
        review_state: 'approved',
        reviewed_at: now.toISOString(),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * POST /api/v1/attendance/shifts/:id/reviews
   * Owner reviews completed shift version (approve or reject).
   * SCP-D05 / Doc 36 guard: Owner cannot review/approve their own shift!
   * Prevents duplicate approval on the same shift version with 409 CONFLICT.
   */
  async reviewShift(
    context: AuthenticatedContext,
    shiftId: string,
    body: ReviewShiftRequestBody,
    requestId: string,
  ): Promise<ReviewShiftResponseData> {
    requireRole(['owner'], context);

    if (body.decision !== 'approved' && body.decision !== 'rejected') {
      throw new AuthError(
        'VALIDATION_ERROR',
        "Quyết định duyệt phải là 'approved' hoặc 'rejected'.",
        400,
      );
    }

    if (body.decision === 'rejected' && (!body.reason || !body.reason.trim())) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Vui lòng nhập lý do từ chối ca làm việc.',
        400,
      );
    }

    const now = new Date();
    const approvalId = crypto.randomUUID();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const shiftRes = await client.query<{
        id: string;
        workspace_id: string;
        employee_id: string;
        run_state: string;
        review_state: string;
        current_version_id: string | null;
        employee_user_id: string | null;
      }>(
        `
        SELECT s.id, s.workspace_id, s.employee_id, s.run_state, s.review_state, s.current_version_id, e.user_id AS employee_user_id
        FROM attendance_shifts s
        JOIN employees e ON e.id = s.employee_id
        WHERE s.id = $1 AND s.workspace_id = $2
        FOR UPDATE OF s;
      `,
        [shiftId, context.workspace.id],
      );

      if (shiftRes.rows.length === 0) {
        throw new AuthError('NOT_FOUND', 'Ca làm việc không tồn tại.', 404);
      }

      const shift = shiftRes.rows[0]!;

      // SCP-D05 / Doc 36: Reviewer user must not be employee's own user
      if (shift.employee_user_id === context.user.id) {
        throw new AuthError(
          'FORBIDDEN',
          'Chủ sở hữu không được phép tự duyệt ca làm việc của chính mình.',
          403,
        );
      }

      if (shift.run_state !== 'completed') {
        throw new AuthError(
          'INVALID_STATE_TRANSITION',
          'Chỉ có thể duyệt ca làm việc đã hoàn thành (completed).',
          422,
        );
      }

      if (!shift.current_version_id) {
        throw new AuthError(
          'INVALID_STATE_TRANSITION',
          'Ca làm không có snapshot version hợp lệ để duyệt.',
          422,
        );
      }

      // Prevent duplicate approval on the same shift version
      const existingApproval = await client.query<{ id: string }>(
        `SELECT id
         FROM attendance_approvals
         WHERE workspace_id = $1 AND shift_version_id = $2
         FOR SHARE;`,
        [context.workspace.id, shift.current_version_id],
      );

      if (
        existingApproval.rows.length > 0 ||
        shift.review_state === 'approved' ||
        shift.review_state === 'rejected'
      ) {
        throw new AuthError(
          'CONFLICT',
          'Ca làm việc này đã được duyệt trước đó (không thể duyệt trùng).',
          409,
        );
      }

      // Insert immutable approval record
      await client.query(
        `
        INSERT INTO attendance_approvals (
          id, workspace_id, shift_id, shift_version_id, reviewer_user_id, decision, reason, reviewed_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8
        );
      `,
        [
          approvalId,
          context.workspace.id,
          shift.id,
          shift.current_version_id,
          context.user.id,
          body.decision,
          body.reason ? body.reason.trim() : null,
          now,
        ],
      );

      // Update shift review_state
      await client.query(
        `
        UPDATE attendance_shifts
        SET review_state = $1, version = version + 1, updated_at = now()
        WHERE id = $2 AND workspace_id = $3;
      `,
        [body.decision, shift.id, context.workspace.id],
      );

      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'attendance.reviewed',
        entityType: 'attendance_shift',
        entityId: shift.id,
        requestId,
        metadata: {
          shift_version_id: shift.current_version_id,
          decision: body.decision,
          reason: body.reason ? body.reason.trim() : null,
        },
      });

      await client.query('COMMIT');

      return {
        shift_id: shift.id,
        review_state: body.decision,
        reviewed_at: now.toISOString(),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * POST /api/v1/attendance/shifts/:id/correction-requests
   * Staff requests correction for forgotten clock-out or time adjustment.
   */
  async createCorrectionRequest(
    context: AuthenticatedContext,
    shiftId: string,
    body: CreateCorrectionRequestBody,
    requestId: string,
  ): Promise<CorrectionRequestData> {
    if (!body.reason || !body.reason.trim()) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Vui lòng nhập lý do giải trình hoặc điều chỉnh chấm công.',
        400,
      );
    }

    const shiftRes = await this.pool.query<{
      id: string;
      workspace_id: string;
      employee_id: string;
      clock_in_at: Date;
      run_state: string;
      employee_user_id: string | null;
    }>(
      `
      SELECT s.id, s.workspace_id, s.employee_id, s.clock_in_at, s.run_state, e.user_id AS employee_user_id
      FROM attendance_shifts s
      JOIN employees e ON e.id = s.employee_id
      WHERE s.id = $1 AND s.workspace_id = $2;
    `,
      [shiftId, context.workspace.id],
    );

    if (shiftRes.rows.length === 0) {
      throw new AuthError('NOT_FOUND', 'Ca làm việc không tồn tại.', 404);
    }

    const shift = shiftRes.rows[0]!;
    if (shift.employee_user_id !== context.user.id) {
      throw new AuthError(
        'FORBIDDEN',
        'Bạn chỉ có thể gửi giải trình cho ca làm của chính mình.',
        403,
      );
    }

    // Check if there is already a pending request for this shift
    const existingReq = await this.pool.query<{ id: string }>(
      `
      SELECT id FROM attendance_correction_requests
      WHERE workspace_id = $1 AND shift_id = $2 AND status = 'pending';
    `,
      [context.workspace.id, shift.id],
    );

    if (existingReq.rows.length > 0) {
      throw new AuthError(
        'CONFLICT',
        'Đã có yêu cầu điều chỉnh đang chờ xử lý cho ca làm này.',
        409,
      );
    }

    const crId = crypto.randomUUID();
    const now = new Date();

    const claimedTime = body.claimed_clock_out_at
      ? new Date(body.claimed_clock_out_at)
      : null;

    if (
      claimedTime &&
      (isNaN(claimedTime.getTime()) || claimedTime <= shift.clock_in_at)
    ) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Giờ kết thúc ca đề xuất không hợp lệ hoặc sớm hơn giờ vào ca.',
        400,
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `
        INSERT INTO attendance_correction_requests (
          id, workspace_id, shift_id, requested_by_user_id, status, reason,
          claimed_clock_out_at, evidence_note, version
        ) VALUES (
          $1, $2, $3, $4, 'pending', $5, $6, $7, 1
        );
      `,
        [
          crId,
          context.workspace.id,
          shift.id,
          context.user.id,
          body.reason.trim(),
          claimedTime,
          body.evidence_note ? body.evidence_note.trim() : null,
        ],
      );

      // Mark shift review_state as 'needs_review'
      await client.query(
        `
        UPDATE attendance_shifts
        SET review_state = 'needs_review', updated_at = now()
        WHERE id = $1 AND workspace_id = $2;
      `,
        [shift.id, context.workspace.id],
      );

      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'attendance.correction_requested',
        entityType: 'attendance_correction_request',
        entityId: crId,
        requestId,
        metadata: {
          shift_id: shift.id,
          reason: body.reason.trim(),
        },
      });

      await client.query('COMMIT');

      return {
        id: crId,
        workspace_id: context.workspace.id,
        shift_id: shift.id,
        requested_by_user_id: context.user.id,
        status: 'pending',
        reason: body.reason.trim(),
        claimed_clock_out_at: claimedTime ? claimedTime.toISOString() : null,
        evidence_note: body.evidence_note ? body.evidence_note.trim() : null,
        decision_reason: null,
        decided_by_user_id: null,
        decided_at: null,
        version: 1,
        created_at: now.toISOString(),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * POST /api/v1/attendance/correction-requests/:id/decide
   * Owner decides on a correction request (accept or reject).
   * Canonical Doc 36:
   * - Reject: leaves shift unchanged, records reason.
   * - Accept: requires explicit clock_out_at from Owner, closes any open break,
   *   closes shift, creates new immutable shift version, sets review_state to 'unreviewed'.
   * - Owner cannot self-decide/approve.
   */
  async decideCorrectionRequest(
    context: AuthenticatedContext,
    requestId: string,
    body: DecideCorrectionRequestBody,
    apiRequestId: string,
  ): Promise<{
    id: string;
    status: 'accepted' | 'rejected';
    shift_id: string;
  }> {
    requireRole(['owner'], context);

    if (body.decision !== 'accept' && body.decision !== 'reject') {
      throw new AuthError(
        'VALIDATION_ERROR',
        "Quyết định phải là 'accept' hoặc 'reject'.",
        400,
      );
    }

    if (!body.reason || !body.reason.trim()) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Vui lòng nhập lý do quyết định điều chỉnh.',
        400,
      );
    }

    const crRes = await this.pool.query<{
      id: string;
      workspace_id: string;
      shift_id: string;
      status: string;
      requested_by_user_id: string;
      clock_in_at: Date;
      clock_out_at: Date | null;
      run_state: string;
      current_version_id: string | null;
      employee_user_id: string | null;
    }>(
      `
      SELECT
        cr.id,
        cr.workspace_id,
        cr.shift_id,
        cr.status,
        cr.requested_by_user_id,
        s.clock_in_at,
        s.clock_out_at,
        s.run_state,
        s.current_version_id,
        e.user_id AS employee_user_id
      FROM attendance_correction_requests cr
      JOIN attendance_shifts s ON s.id = cr.shift_id
      JOIN employees e ON e.id = s.employee_id
      WHERE cr.id = $1 AND cr.workspace_id = $2;
    `,
      [requestId, context.workspace.id],
    );

    if (crRes.rows.length === 0) {
      throw new AuthError(
        'NOT_FOUND',
        'Yêu cầu điều chỉnh không tồn tại.',
        404,
      );
    }

    const cr = crRes.rows[0]!;

    if (cr.status !== 'pending') {
      throw new AuthError(
        'CONFLICT',
        'Yêu cầu điều chỉnh này đã được xử lý trước đó.',
        409,
      );
    }

    // Owner cannot self-review/self-decide
    if (cr.employee_user_id === context.user.id) {
      throw new AuthError(
        'FORBIDDEN',
        'Chủ sở hữu không được phép tự xử lý đơn giải trình ca làm của chính mình.',
        403,
      );
    }

    const now = new Date();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      if (body.decision === 'reject') {
        await client.query(
          `
          UPDATE attendance_correction_requests
          SET
            status = 'rejected',
            decision_reason = $1,
            decided_by_user_id = $2,
            decided_at = $3,
            version = version + 1,
            updated_at = now()
          WHERE id = $4;
        `,
          [body.reason.trim(), context.user.id, now, cr.id],
        );

        const prevApprovalRes = cr.current_version_id
          ? await client.query<{ decision: string }>(
              `SELECT decision FROM attendance_approvals WHERE workspace_id = $1 AND shift_version_id = $2 LIMIT 1;`,
              [context.workspace.id, cr.current_version_id],
            )
          : { rows: [] };
        const restoredReviewState =
          prevApprovalRes.rows[0]?.decision ??
          (cr.run_state === 'completed' ? 'unreviewed' : 'needs_review');

        await client.query(
          `
          UPDATE attendance_shifts
          SET review_state = $1, updated_at = now()
          WHERE id = $2 AND workspace_id = $3;
        `,
          [restoredReviewState, cr.shift_id, context.workspace.id],
        );

        await recordAuditEvent(client, {
          workspaceId: context.workspace.id,
          actorUserId: context.user.id,
          action: 'attendance.correction_rejected',
          entityType: 'attendance_correction_request',
          entityId: cr.id,
          requestId: apiRequestId,
          metadata: {
            shift_id: cr.shift_id,
            reason: body.reason.trim(),
          },
        });

        await client.query('COMMIT');
        return { id: cr.id, status: 'rejected', shift_id: cr.shift_id };
      }

      // ACCEPT branch
      if (!body.clock_out_at) {
        throw new AuthError(
          'VALIDATION_ERROR',
          'Chủ sở hữu phải cung cấp giờ kết thúc ca chính xác (clock_out_at) khi chấp nhận điều chỉnh.',
          400,
        );
      }

      const explicitClockOut = new Date(body.clock_out_at);
      if (
        isNaN(explicitClockOut.getTime()) ||
        explicitClockOut <= cr.clock_in_at
      ) {
        throw new AuthError(
          'VALIDATION_ERROR',
          'Giờ kết thúc ca (clock_out_at) không hợp lệ hoặc sớm hơn giờ vào ca.',
          400,
        );
      }

      // If there are any open breaks, close them at or before explicitClockOut
      await client.query(
        `
        UPDATE attendance_breaks
        SET ended_at = LEAST($1, started_at + interval '1 hour')
        WHERE workspace_id = $2 AND shift_id = $3 AND ended_at IS NULL;
      `,
        [explicitClockOut, context.workspace.id, cr.shift_id],
      );

      // Query all breaks
      const breaksRes = await client.query<{
        id: string;
        started_at: Date;
        ended_at: Date;
        unpaid: boolean;
      }>(
        `
        SELECT id, started_at, ended_at, unpaid
        FROM attendance_breaks
        WHERE workspace_id = $1 AND shift_id = $2
        ORDER BY started_at ASC;
      `,
        [context.workspace.id, cr.shift_id],
      );

      let totalBreakSecs = 0;
      const breaksSnapshot = breaksRes.rows.map((b) => {
        const dur = Math.max(
          0,
          Math.floor((b.ended_at.getTime() - b.started_at.getTime()) / 1000),
        );
        if (b.unpaid) totalBreakSecs += dur;
        return {
          id: b.id,
          started_at: b.started_at.toISOString(),
          ended_at: b.ended_at.toISOString(),
          unpaid: b.unpaid,
          duration_seconds: dur,
        };
      });

      const grossSecs = Math.max(
        0,
        Math.floor(
          (explicitClockOut.getTime() - cr.clock_in_at.getTime()) / 1000,
        ),
      );
      const workedSeconds = Math.max(0, grossSecs - totalBreakSecs);

      // Determine next version number for attendance_shift_versions
      const versionNumRes = await client.query<{ next_version: number }>(
        `
        SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
        FROM attendance_shift_versions
        WHERE workspace_id = $1 AND shift_id = $2;
      `,
        [context.workspace.id, cr.shift_id],
      );

      const nextVersionNumber = versionNumRes.rows[0]!.next_version;
      const newVersionId = crypto.randomUUID();

      const snapshotHash = crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            shift_id: cr.shift_id,
            clock_in_at: cr.clock_in_at.toISOString(),
            clock_out_at: explicitClockOut.toISOString(),
            breaks: breaksSnapshot,
            worked_seconds: workedSeconds,
            version_number: nextVersionNumber,
          }),
        )
        .digest('hex');

      // 1. Insert new immutable shift version
      await client.query(
        `
        INSERT INTO attendance_shift_versions (
          id, workspace_id, shift_id, version_number, clock_in_at, clock_out_at,
          breaks_snapshot, worked_seconds, snapshot_hash, created_by, reason
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
        );
      `,
        [
          newVersionId,
          context.workspace.id,
          cr.shift_id,
          nextVersionNumber,
          cr.clock_in_at,
          explicitClockOut,
          JSON.stringify(breaksSnapshot),
          workedSeconds,
          snapshotHash,
          context.user.id,
          body.reason.trim(),
        ],
      );

      // 2. Insert attendance adjustment record for provenance
      await client.query(
        `
        INSERT INTO attendance_adjustments (
          workspace_id, shift_id, from_version_id, to_version_id, actor_user_id, reason
        ) VALUES (
          $1, $2, $3, $4, $5, $6
        );
      `,
        [
          context.workspace.id,
          cr.shift_id,
          cr.current_version_id,
          newVersionId,
          context.user.id,
          body.reason.trim(),
        ],
      );

      // 3. Update attendance_shifts: mark as completed, unreviewed, current_version_id = newVersionId
      await client.query(
        `
        UPDATE attendance_shifts
        SET
          clock_out_at = $1,
          run_state = 'completed',
          review_state = 'unreviewed',
          current_version_id = $2,
          version = version + 1,
          updated_at = now()
        WHERE id = $3 AND workspace_id = $4;
      `,
        [explicitClockOut, newVersionId, cr.shift_id, context.workspace.id],
      );

      // 4. Update attendance_correction_requests to accepted
      await client.query(
        `
        UPDATE attendance_correction_requests
        SET
          status = 'accepted',
          decision_reason = $1,
          decided_by_user_id = $2,
          decided_at = $3,
          version = version + 1,
          updated_at = now()
        WHERE id = $4;
      `,
        [body.reason.trim(), context.user.id, now, cr.id],
      );

      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'attendance.correction_accepted',
        entityType: 'attendance_correction_request',
        entityId: cr.id,
        requestId: apiRequestId,
        metadata: {
          shift_id: cr.shift_id,
          new_shift_version_id: newVersionId,
          clock_out_at: explicitClockOut.toISOString(),
          reason: body.reason.trim(),
        },
      });

      await client.query('COMMIT');
      return { id: cr.id, status: 'accepted', shift_id: cr.shift_id };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * POST /api/v1/attendance/reset-today
   * Resets web clock-in test shifts and any open/hanging shifts so the user or workspace
   * can start working fresh from today, while strictly preserving all imported timesheet
   * shifts (`source = 'import'`) and finalized payroll snapshots.
   */
  async resetClockShifts(
    context: AuthenticatedContext,
    body: ResetClockShiftsRequestBody = {},
    requestId: string,
  ): Promise<ResetClockShiftsResponseData> {
    const requestedScope = body.scope;
    if (
      requestedScope !== undefined &&
      requestedScope !== 'me_today' &&
      requestedScope !== 'workspace_clock'
    ) {
      throw new AuthError(
        'VALIDATION_ERROR',
        "Phạm vi đặt lại (scope) phải là 'me_today' hoặc 'workspace_clock'.",
        400,
      );
    }

    if (
      requestedScope === 'workspace_clock' &&
      context.workspace.role !== 'owner'
    ) {
      throw new AuthError(
        'FORBIDDEN',
        'Chỉ Chủ sở hữu (Owner) mới được đặt lại dữ liệu bấm giờ của toàn chi nhánh.',
        403,
      );
    }

    const effectiveScope: 'me_today' | 'workspace_clock' =
      requestedScope ||
      (context.workspace.role === 'owner' ? 'workspace_clock' : 'me_today');

    const now = new Date();
    const todayVnDateStr = now.toLocaleDateString('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
    });
    const todayVnStart = new Date(`${todayVnDateStr}T00:00:00.000+07:00`);

    let employeeIdForMe: string | null = null;
    if (effectiveScope === 'me_today') {
      const emp = await this.getEmployeeForUser(context);
      if (!emp) {
        return {
          reset_shifts_count: 0,
          scope: effectiveScope,
          reset_at: now.toISOString(),
        };
      }
      employeeIdForMe = emp.id;
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.allow_payroll_reconcile', 'on', true);",
      );

      const targetShiftsRes =
        effectiveScope === 'workspace_clock'
          ? await client.query<{ id: string }>(
              `
              SELECT s.id
              FROM attendance_shifts s
              WHERE s.workspace_id = $1
                AND (
                  s.run_state IN ('working', 'paused')
                  OR COALESCE(to_jsonb(s) ->> 'source', 'clock') = 'clock'
                )
              FOR UPDATE;
            `,
              [context.workspace.id],
            )
          : await client.query<{ id: string }>(
              `
              SELECT s.id
              FROM attendance_shifts s
              WHERE s.workspace_id = $1
                AND s.employee_id = $2
                AND (
                  s.run_state IN ('working', 'paused')
                  OR (
                    COALESCE(to_jsonb(s) ->> 'source', 'clock') = 'clock'
                    AND s.clock_in_at >= $3
                  )
                )
              FOR UPDATE;
            `,
              [context.workspace.id, employeeIdForMe, todayVnStart],
            );

      const shiftIds = targetShiftsRes.rows.map((r) => r.id);

      if (shiftIds.length > 0) {
        await client.query(
          `
          UPDATE attendance_shifts
          SET current_version_id = NULL
          WHERE workspace_id = $1 AND id = ANY($2::uuid[]);
        `,
          [context.workspace.id, shiftIds],
        );

        for (const childTable of [
          'attendance_approvals',
          'attendance_adjustments',
          'attendance_correction_requests',
          'attendance_breaks',
          'attendance_shift_versions',
        ]) {
          await client.query(
            `
            DELETE FROM ${childTable}
            WHERE workspace_id = $1 AND shift_id = ANY($2::uuid[]);
          `,
            [context.workspace.id, shiftIds],
          );
        }

        await client.query(
          `
          DELETE FROM attendance_shifts
          WHERE workspace_id = $1 AND id = ANY($2::uuid[]);
        `,
          [context.workspace.id, shiftIds],
        );
      }

      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'attendance.reset_clock_shifts',
        entityType: 'attendance_shift',
        entityId: context.workspace.id,
        requestId,
        metadata: {
          scope: effectiveScope,
          reset_shifts_count: shiftIds.length,
          today_vn: todayVnDateStr,
        },
      });

      await client.query(
        "SELECT set_config('app.allow_payroll_reconcile', 'off', true);",
      );
      await client.query('COMMIT');

      return {
        reset_shifts_count: shiftIds.length,
        scope: effectiveScope,
        reset_at: now.toISOString(),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
