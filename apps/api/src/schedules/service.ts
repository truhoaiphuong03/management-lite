import crypto from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { AuthError } from '../auth/service.js';
import type { AuthenticatedContext } from '../auth/service.js';
import { requireRole } from '../auth/guard.js';
import { recordAuditEvent } from '../../../../packages/database/src/audit.js';
import type {
  ScheduleData,
  ScheduleEntryData,
  ScheduleRevisionData,
  ScheduleDetailResponseData,
  ScheduleListResponseData,
  CreateScheduleRequest,
  UpdateScheduleRequest,
  CreateScheduleEntryInput,
} from '../../../../packages/contracts/src/schedules.js';

export class SchedulesService {
  constructor(private readonly pool: Pool) {}

  /**
   * Helper: Resolves active employee for current authenticated user in workspace.
   */
  private async resolveEmployeeForUser(
    client: PoolClient | Pool,
    workspaceId: string,
    userId: string,
  ): Promise<{ id: string; full_name: string; employee_code: string }> {
    const res = await client.query<{
      id: string;
      full_name: string;
      employee_code: string;
    }>(
      `SELECT e.id, e.full_name, e.employee_code
       FROM employees e
       JOIN workspace_memberships m ON m.workspace_id = e.workspace_id AND m.user_id = e.user_id
       WHERE e.workspace_id = $1 AND e.user_id = $2 AND e.employment_status = 'active' AND m.status = 'active'
       LIMIT 1;`,
      [workspaceId, userId],
    );

    if (res.rows.length === 0 || !res.rows[0]) {
      throw new AuthError(
        'EMPLOYEE_NOT_FOUND',
        'Active employee profile required in workspace to register or manage schedule',
        404,
      );
    }

    return res.rows[0];
  }

  /**
   * Helper: Validates and parses If-Match header.
   */
  private parseIfMatch(ifMatch: string | undefined, action: string): number {
    if (ifMatch === undefined || ifMatch === null || ifMatch.trim() === '') {
      throw new AuthError(
        'PRECONDITION_REQUIRED',
        `If-Match header is required for schedule ${action}`,
        428,
      );
    }

    const expectedVersion = parseInt(ifMatch.replace(/["']/g, ''), 10);
    if (isNaN(expectedVersion)) {
      throw new AuthError(
        'PRECONDITION_FAILED',
        'Invalid If-Match version header',
        412,
      );
    }

    return expectedVersion;
  }

  /**
   * Helper: Given a date YYYY-MM-DD, returns the ISO Monday date YYYY-MM-DD.
   */
  public getMonday(dateStr: string): string {
    const parts = dateStr.split('-');
    if (parts.length !== 3) {
      throw new AuthError(
        'INVALID_REQUEST',
        'Invalid date format, expected YYYY-MM-DD',
        400,
      );
    }
    const year = parseInt(parts[0]!, 10);
    const month = parseInt(parts[1]!, 10) - 1;
    const day = parseInt(parts[2]!, 10);

    const d = new Date(Date.UTC(year, month, day));
    if (isNaN(d.getTime())) {
      throw new AuthError('INVALID_REQUEST', 'Invalid date value', 400);
    }

    // day of week: Sunday = 0, Monday = 1, ..., Saturday = 6
    const dayOfWeek = d.getUTCDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    d.setUTCDate(d.getUTCDate() + diffToMonday);

    return d.toISOString().split('T')[0]!;
  }

  /**
   * Helper: Given an ISO Monday YYYY-MM-DD, returns Sunday YYYY-MM-DD (+6 days).
   */
  public getSunday(mondayStr: string): string {
    const parts = mondayStr.split('-');
    const year = parseInt(parts[0]!, 10);
    const month = parseInt(parts[1]!, 10) - 1;
    const day = parseInt(parts[2]!, 10);

    const d = new Date(Date.UTC(year, month, day));
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().split('T')[0]!;
  }

  /**
   * Helper: Calculates Monday of next week relative to today (Asia/Ho_Chi_Minh).
   */
  public getNextWeekMonday(): string {
    const now = new Date();
    // Offset for Asia/Ho_Chi_Minh (+7 hours)
    const tzNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const todayStr = tzNow.toISOString().split('T')[0]!;
    const thisMonday = this.getMonday(todayStr);

    const parts = thisMonday.split('-');
    const year = parseInt(parts[0]!, 10);
    const month = parseInt(parts[1]!, 10) - 1;
    const day = parseInt(parts[2]!, 10);

    const nextMonday = new Date(Date.UTC(year, month, day + 7));
    return nextMonday.toISOString().split('T')[0]!;
  }

  /**
   * Helper: Validates schedule entries.
   */
  private validateEntries(
    entries: CreateScheduleEntryInput[],
    weekStart: string,
    weekEnd: string,
  ): void {
    if (!Array.isArray(entries)) {
      throw new AuthError('INVALID_REQUEST', 'Entries must be an array', 400);
    }

    const seenDates = new Set<string>();

    for (const [idx, entry] of entries.entries()) {
      if (!entry.work_date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.work_date)) {
        throw new AuthError(
          'INVALID_REQUEST',
          `Entry at index ${idx} has invalid work_date (expected YYYY-MM-DD)`,
          400,
        );
      }

      if (entry.work_date < weekStart || entry.work_date > weekEnd) {
        throw new AuthError(
          'INVALID_REQUEST',
          `Entry date ${entry.work_date} must fall within week [${weekStart} to ${weekEnd}]`,
          400,
        );
      }

      if (seenDates.has(entry.work_date)) {
        throw new AuthError(
          'INVALID_REQUEST',
          `Duplicate work date ${entry.work_date} in schedule entries`,
          400,
        );
      }
      seenDates.add(entry.work_date);

      // Validate start_time format: HH:MM, 00:00 to 23:59 strictly. 24:00 must be rejected.
      if (
        !entry.start_time ||
        typeof entry.start_time !== 'string' ||
        !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(entry.start_time)
      ) {
        throw new AuthError(
          'INVALID_REQUEST',
          `Entry at index ${idx} has invalid start_time '${entry.start_time}'. Must be between 00:00 and 23:59`,
          400,
        );
      }

      // Validate day_of_week
      if (
        typeof entry.day_of_week !== 'number' ||
        entry.day_of_week < 1 ||
        entry.day_of_week > 7
      ) {
        throw new AuthError(
          'INVALID_REQUEST',
          `Entry at index ${idx} has invalid day_of_week (must be 1-7)`,
          400,
        );
      }
    }
  }

  /**
   * Staff: Get own schedule for a given week.
   */
  async getStaffSchedule(
    ctx: AuthenticatedContext,
    requestedWeekStart?: string,
  ): Promise<ScheduleDetailResponseData> {
    const emp = await this.resolveEmployeeForUser(
      this.pool,
      ctx.workspace.id,
      ctx.user.id,
    );

    const weekStart = requestedWeekStart
      ? this.getMonday(requestedWeekStart)
      : this.getNextWeekMonday();
    const weekEnd = this.getSunday(weekStart);

    const schedRes = await this.pool.query<ScheduleData>(
      `SELECT s.id, s.workspace_id, s.employee_id, s.week_start_date::text AS week_start_date, s.week_end_date::text AS week_end_date,
              s.timezone, s.status, s.current_revision, s.version, s.created_at, s.updated_at
       FROM staff_schedules s
       WHERE s.workspace_id = $1 AND s.employee_id = $2 AND s.week_start_date = $3
       LIMIT 1;`,
      [ctx.workspace.id, emp.id, weekStart],
    );

    if (schedRes.rows.length === 0 || !schedRes.rows[0]) {
      return {
        schedule: {
          id: '',
          workspace_id: ctx.workspace.id,
          employee_id: emp.id,
          employee_name: emp.full_name,
          employee_code: emp.employee_code,
          week_start_date: weekStart,
          week_end_date: weekEnd,
          timezone: 'Asia/Ho_Chi_Minh',
          status: 'registered',
          current_revision: 0,
          version: 0,
          entries: [],
          created_at: '',
          updated_at: '',
        },
        entries: [],
        revisions: [],
      };
    }

    const schedule = schedRes.rows[0];
    schedule.employee_name = emp.full_name;
    schedule.employee_code = emp.employee_code;

    // Fetch entries
    const entriesRes = await this.pool.query<ScheduleEntryData>(
      `SELECT id, schedule_id, work_date::text AS work_date, day_of_week, start_time, notes
       FROM staff_schedule_entries
       WHERE workspace_id = $1 AND schedule_id = $2
       ORDER BY work_date ASC;`,
      [ctx.workspace.id, schedule.id],
    );

    // Fetch revisions
    const revsRes = await this.pool.query<ScheduleRevisionData>(
      `SELECT r.id, r.schedule_id, r.revision_number, r.snapshot, r.reason,
              r.edited_by, u.username_normalized AS edited_by_name, r.edited_at
       FROM staff_schedule_revisions r
       JOIN users u ON u.id = r.edited_by
       WHERE r.workspace_id = $1 AND r.schedule_id = $2
       ORDER BY r.revision_number ASC;`,
      [ctx.workspace.id, schedule.id],
    );

    schedule.entries = entriesRes.rows;

    return {
      schedule,
      entries: entriesRes.rows,
      revisions: revsRes.rows,
    };
  }

  /**
   * Staff: Register new schedule for next week.
   */
  async createStaffSchedule(
    ctx: AuthenticatedContext,
    body: CreateScheduleRequest,
    requestId?: string,
  ): Promise<ScheduleDetailResponseData> {
    const emp = await this.resolveEmployeeForUser(
      this.pool,
      ctx.workspace.id,
      ctx.user.id,
    );

    if (!body.week_start_date) {
      throw new AuthError(
        'INVALID_REQUEST',
        'week_start_date is required',
        400,
      );
    }

    const weekStart = this.getMonday(body.week_start_date);
    const weekEnd = this.getSunday(weekStart);

    this.validateEntries(body.entries || [], weekStart, weekEnd);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Check if schedule already exists
      const existing = await client.query(
        `SELECT id FROM staff_schedules
         WHERE workspace_id = $1 AND employee_id = $2 AND week_start_date = $3
         LIMIT 1;`,
        [ctx.workspace.id, emp.id, weekStart],
      );

      if (existing.rows.length > 0) {
        throw new AuthError(
          'CONFLICT',
          `Lịch làm việc tuần ${weekStart} đã được đăng ký. Vui lòng sử dụng tính năng Sửa lịch.`,
          409,
        );
      }

      // Insert staff_schedules
      const schedRes = await client.query<ScheduleData>(
        `INSERT INTO staff_schedules (
           workspace_id, employee_id, week_start_date, week_end_date, timezone, status, current_revision, version
         ) VALUES ($1, $2, $3, $4, 'Asia/Ho_Chi_Minh', 'registered', 1, 1)
         RETURNING id, workspace_id, employee_id, week_start_date::text AS week_start_date, week_end_date::text AS week_end_date,
                   timezone, status, current_revision, version, created_at, updated_at;`,
        [ctx.workspace.id, emp.id, weekStart, weekEnd],
      );
      const schedule = schedRes.rows[0]!;

      // Insert entries
      const createdEntries: ScheduleEntryData[] = [];
      for (const entry of body.entries) {
        const entRes = await client.query<ScheduleEntryData>(
          `INSERT INTO staff_schedule_entries (
             workspace_id, schedule_id, work_date, day_of_week, start_time, notes
           ) VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, workspace_id, schedule_id, work_date::text AS work_date, day_of_week, start_time, notes, created_at;`,
          [
            ctx.workspace.id,
            schedule.id,
            entry.work_date,
            entry.day_of_week,
            entry.start_time,
            entry.notes || null,
          ],
        );
        createdEntries.push(entRes.rows[0]!);
      }

      // Insert revision 1
      const snapshot = {
        entries: createdEntries.map((e) => ({
          work_date: e.work_date,
          day_of_week: e.day_of_week,
          start_time: e.start_time,
          notes: e.notes || null,
        })),
      };

      const revRes = await client.query<ScheduleRevisionData>(
        `INSERT INTO staff_schedule_revisions (
           workspace_id, schedule_id, revision_number, snapshot, reason, edited_by
         ) VALUES ($1, $2, 1, $3, 'Đăng ký lịch ban đầu', $4)
         RETURNING *;`,
        [ctx.workspace.id, schedule.id, JSON.stringify(snapshot), ctx.user.id],
      );

      // Record audit event
      await recordAuditEvent(client, {
        workspaceId: ctx.workspace.id,
        actorUserId: ctx.user.id,
        action: 'schedule.create',
        entityType: 'staff_schedule',
        entityId: schedule.id,
        requestId: requestId || crypto.randomUUID(),
        metadata: {
          employee_id: emp.id,
          week_start_date: weekStart,
          entries_count: createdEntries.length,
        },
      });

      await client.query('COMMIT');

      schedule.employee_name = emp.full_name;
      schedule.employee_code = emp.employee_code;
      schedule.entries = createdEntries;

      return {
        schedule,
        entries: createdEntries,
        revisions: [revRes.rows[0]!],
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Staff: Update registered schedule (adds/removes days, edits start time, past/future).
   */
  async updateStaffSchedule(
    ctx: AuthenticatedContext,
    scheduleId: string,
    ifMatch: string | undefined,
    body: UpdateScheduleRequest,
    requestId?: string,
  ): Promise<ScheduleDetailResponseData> {
    const expectedVersion = this.parseIfMatch(ifMatch, 'update');

    const emp = await this.resolveEmployeeForUser(
      this.pool,
      ctx.workspace.id,
      ctx.user.id,
    );

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Fetch and lock schedule
      const schedRes = await client.query<ScheduleData>(
        `SELECT id, workspace_id, employee_id, week_start_date::text AS week_start_date, week_end_date::text AS week_end_date,
                timezone, status, current_revision, version, created_at, updated_at
         FROM staff_schedules
         WHERE workspace_id = $1 AND id = $2
         FOR UPDATE;`,
        [ctx.workspace.id, scheduleId],
      );

      if (schedRes.rows.length === 0 || !schedRes.rows[0]) {
        throw new AuthError('NOT_FOUND', 'Không tìm thấy lịch làm việc', 404);
      }

      const schedule = schedRes.rows[0];

      // RBAC: Only Staff owning this schedule can edit. Owner cannot edit on behalf of staff!
      if (schedule.employee_id !== emp.id) {
        throw new AuthError(
          'FORBIDDEN',
          'Chỉ nhân viên sở hữu lịch mới có quyền chỉnh sửa lịch của mình. Owner không được sửa thay nhân viên.',
          403,
        );
      }

      // Check version guard (If-Match)
      if (schedule.version !== expectedVersion) {
        throw new AuthError(
          'PRECONDITION_FAILED',
          `Schedule version mismatch (current: ${schedule.version}, expected: ${expectedVersion}). Please reload and retry.`,
          412,
        );
      }

      const weekStart = schedule.week_start_date;
      const weekEnd = schedule.week_end_date;

      this.validateEntries(body.entries || [], weekStart, weekEnd);

      // Fetch existing entries to compare for changes
      const existingEntriesRes = await client.query<ScheduleEntryData>(
        `SELECT id, schedule_id, work_date::text AS work_date, day_of_week, start_time, notes
         FROM staff_schedule_entries
         WHERE workspace_id = $1 AND schedule_id = $2
         ORDER BY work_date ASC;`,
        [ctx.workspace.id, schedule.id],
      );
      const existingEntries = existingEntriesRes.rows;

      // Sort and normalize incoming entries
      const incomingEntries = [...(body.entries || [])].sort((a, b) =>
        a.work_date.localeCompare(b.work_date),
      );

      // Check if entries changed
      let hasChanges = false;
      if (existingEntries.length !== incomingEntries.length) {
        hasChanges = true;
      } else {
        for (let i = 0; i < existingEntries.length; i++) {
          const oldE = existingEntries[i]!;
          const newE = incomingEntries[i]!;
          const oldTime = (oldE.start_time || '').slice(0, 5);
          const newTime = (newE.start_time || '').slice(0, 5);
          const oldNotes = (oldE.notes || '').trim() || null;
          const newNotes = (newE.notes || '').trim() || null;

          if (
            oldE.work_date !== newE.work_date ||
            oldE.day_of_week !== newE.day_of_week ||
            oldTime !== newTime ||
            oldNotes !== newNotes
          ) {
            hasChanges = true;
            break;
          }
        }
      }

      // If no changes to schedule entries, do not increment revision or create new snapshot
      if (!hasChanges) {
        await client.query('COMMIT');

        const revsRes = await this.pool.query<ScheduleRevisionData>(
          `SELECT r.id, r.schedule_id, r.revision_number, r.snapshot, r.reason,
                  r.edited_by, u.username_normalized AS edited_by_name, r.edited_at
           FROM staff_schedule_revisions r
           LEFT JOIN users u ON u.id = r.edited_by
           WHERE r.workspace_id = $1 AND r.schedule_id = $2
           ORDER BY r.revision_number ASC;`,
          [ctx.workspace.id, schedule.id],
        );

        schedule.employee_name = emp.full_name;
        schedule.employee_code = emp.employee_code;
        schedule.entries = existingEntries;

        return {
          schedule,
          entries: existingEntries,
          revisions: revsRes.rows,
        };
      }

      // Delete existing entries
      await client.query(
        `DELETE FROM staff_schedule_entries
         WHERE workspace_id = $1 AND schedule_id = $2;`,
        [ctx.workspace.id, schedule.id],
      );

      // Insert new entries
      const updatedEntries: ScheduleEntryData[] = [];
      for (const entry of body.entries) {
        const entRes = await client.query<ScheduleEntryData>(
          `INSERT INTO staff_schedule_entries (
             workspace_id, schedule_id, work_date, day_of_week, start_time, notes
           ) VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, workspace_id, schedule_id, work_date::text AS work_date, day_of_week, start_time, notes, created_at;`,
          [
            ctx.workspace.id,
            schedule.id,
            entry.work_date,
            entry.day_of_week,
            entry.start_time,
            entry.notes || null,
          ],
        );
        updatedEntries.push(entRes.rows[0]!);
      }

      const nextRevision = schedule.current_revision + 1;
      const nextVersion = schedule.version + 1;

      // Update schedule record
      const updatedSchedRes = await client.query<ScheduleData>(
        `UPDATE staff_schedules
         SET current_revision = $1, version = $2, updated_at = now()
         WHERE id = $3
         RETURNING id, workspace_id, employee_id, week_start_date::text AS week_start_date, week_end_date::text AS week_end_date,
                   timezone, status, current_revision, version, created_at, updated_at;`,
        [nextRevision, nextVersion, schedule.id],
      );
      const updatedSchedule = updatedSchedRes.rows[0]!;

      // Insert revision snapshot
      const snapshot = {
        entries: updatedEntries.map((e) => ({
          work_date: e.work_date,
          day_of_week: e.day_of_week,
          start_time: e.start_time,
          notes: e.notes || null,
        })),
      };

      await client.query(
        `INSERT INTO staff_schedule_revisions (
           workspace_id, schedule_id, revision_number, snapshot, reason, edited_by
         ) VALUES ($1, $2, $3, $4, $5, $6);`,
        [
          ctx.workspace.id,
          schedule.id,
          nextRevision,
          JSON.stringify(snapshot),
          body.reason ? body.reason.trim() : null,
          ctx.user.id,
        ],
      );

      // Record audit event
      await recordAuditEvent(client, {
        workspaceId: ctx.workspace.id,
        actorUserId: ctx.user.id,
        action: 'schedule.update',
        entityType: 'staff_schedule',
        entityId: schedule.id,
        requestId: requestId || crypto.randomUUID(),
        metadata: {
          employee_id: emp.id,
          revision_number: nextRevision,
          reason: body.reason || null,
          entries_count: updatedEntries.length,
        },
      });

      await client.query('COMMIT');

      // Fetch all revisions
      const revsRes = await this.pool.query<ScheduleRevisionData>(
        `SELECT r.id, r.schedule_id, r.revision_number, r.snapshot, r.reason,
                r.edited_by, u.username_normalized AS edited_by_name, r.edited_at
         FROM staff_schedule_revisions r
         JOIN users u ON u.id = r.edited_by
         WHERE r.workspace_id = $1 AND r.schedule_id = $2
         ORDER BY r.revision_number ASC;`,
        [ctx.workspace.id, schedule.id],
      );

      updatedSchedule.employee_name = emp.full_name;
      updatedSchedule.employee_code = emp.employee_code;
      updatedSchedule.entries = updatedEntries;

      return {
        schedule: updatedSchedule,
        entries: updatedEntries,
        revisions: revsRes.rows,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Owner: List all staff schedules for a given week.
   */
  async listSchedulesForOwner(
    ctx: AuthenticatedContext,
    weekStartDate?: string,
    employeeIdFilter?: string,
  ): Promise<ScheduleListResponseData> {
    requireRole(['owner'], ctx);

    const weekStart = weekStartDate
      ? this.getMonday(weekStartDate)
      : this.getNextWeekMonday();
    const weekEnd = this.getSunday(weekStart);

    const params: unknown[] = [ctx.workspace.id, weekStart];
    let query = `
      SELECT s.id, s.workspace_id, s.employee_id, e.full_name AS employee_name, e.employee_code,
             s.week_start_date::text AS week_start_date, s.week_end_date::text AS week_end_date, s.timezone, s.status, s.current_revision,
             s.version, s.created_at, s.updated_at
      FROM staff_schedules s
      JOIN employees e ON e.id = s.employee_id
      WHERE s.workspace_id = $1 AND s.week_start_date = $2
    `;

    if (employeeIdFilter && employeeIdFilter !== 'all') {
      params.push(employeeIdFilter);
      query += ` AND s.employee_id = $${params.length}`;
    }

    query += ` ORDER BY e.full_name ASC;`;

    const schedRes = await this.pool.query<ScheduleData>(query, params);

    // Fetch entries for all matching schedules
    const schedules = schedRes.rows;
    if (schedules.length > 0) {
      const scheduleIds = schedules.map((s) => s.id);
      const entriesRes = await this.pool.query<ScheduleEntryData>(
        `SELECT id, schedule_id, work_date::text AS work_date, day_of_week, start_time, notes
         FROM staff_schedule_entries
         WHERE workspace_id = $1 AND schedule_id = ANY($2::uuid[])
         ORDER BY work_date ASC;`,
        [ctx.workspace.id, scheduleIds],
      );

      const entriesBySchedule = new Map<string, ScheduleEntryData[]>();
      for (const entry of entriesRes.rows) {
        if (!entry.schedule_id) continue;
        const list = entriesBySchedule.get(entry.schedule_id) || [];
        list.push(entry);
        entriesBySchedule.set(entry.schedule_id, list);
      }

      for (const s of schedules) {
        s.entries = entriesBySchedule.get(s.id) || [];
      }
    }

    return {
      items: schedules,
      week_start_date: weekStart,
      week_end_date: weekEnd,
    };
  }

  /**
   * Detail: View schedule and complete revision history.
   */
  async getScheduleDetail(
    ctx: AuthenticatedContext,
    scheduleId: string,
  ): Promise<ScheduleDetailResponseData> {
    const schedRes = await this.pool.query<ScheduleData>(
      `SELECT s.id, s.workspace_id, s.employee_id, e.full_name AS employee_name, e.employee_code,
              s.week_start_date::text AS week_start_date, s.week_end_date::text AS week_end_date, s.timezone, s.status, s.current_revision,
              s.version, s.created_at, s.updated_at
       FROM staff_schedules s
       JOIN employees e ON e.id = s.employee_id
       WHERE s.workspace_id = $1 AND s.id = $2
       LIMIT 1;`,
      [ctx.workspace.id, scheduleId],
    );

    if (schedRes.rows.length === 0 || !schedRes.rows[0]) {
      throw new AuthError('NOT_FOUND', 'Không tìm thấy lịch làm việc', 404);
    }

    const schedule = schedRes.rows[0];

    // RBAC: Owner can view any schedule. Staff can ONLY view their own schedule!
    if (ctx.workspace.role !== 'owner') {
      const emp = await this.resolveEmployeeForUser(
        this.pool,
        ctx.workspace.id,
        ctx.user.id,
      );
      if (schedule.employee_id !== emp.id) {
        throw new AuthError(
          'FORBIDDEN',
          'Bạn không có quyền truy cập lịch làm việc của người khác',
          403,
        );
      }
    }

    const entriesRes = await this.pool.query<ScheduleEntryData>(
      `SELECT id, schedule_id, work_date::text AS work_date, day_of_week, start_time, notes
       FROM staff_schedule_entries
       WHERE workspace_id = $1 AND schedule_id = $2
       ORDER BY work_date ASC;`,
      [ctx.workspace.id, schedule.id],
    );

    const revsRes = await this.pool.query<ScheduleRevisionData>(
      `SELECT r.id, r.schedule_id, r.revision_number, r.snapshot, r.reason,
              r.edited_by, u.username_normalized AS edited_by_name, r.edited_at
       FROM staff_schedule_revisions r
       JOIN users u ON u.id = r.edited_by
       WHERE r.workspace_id = $1 AND r.schedule_id = $2
       ORDER BY r.revision_number ASC;`,
      [ctx.workspace.id, schedule.id],
    );

    schedule.entries = entriesRes.rows;

    return {
      schedule,
      entries: entriesRes.rows,
      revisions: revsRes.rows,
    };
  }
}
