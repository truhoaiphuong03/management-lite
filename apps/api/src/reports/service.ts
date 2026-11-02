import type { Pool, PoolClient } from 'pg';
import { AuthError } from '../auth/service.js';
import type { AuthenticatedContext } from '../auth/service.js';
import { requireRole } from '../auth/guard.js';
import type {
  DailyReportData,
  DailyReportListItem,
  ReportEntryData,
  ReportRevisionData,
  ReportDetailResponseData,
  CreateReportRequestBody,
  UpdateReportRequestBody,
  ReviseReportRequestBody,
  SubmitReportResponseData,
  ReviseReportResponseData,
  ListReportsResponseData,
} from '../../../../packages/contracts/src/reports.js';

export class ReportsService {
  constructor(private readonly pool: Pool) {}

  /**
   * Helper: Resolves active employee for current authenticated user in workspace.
   */
  private async resolveEmployeeForUser(
    client: PoolClient | Pool,
    workspaceId: string,
    userId: string,
  ): Promise<{ id: string; full_name: string }> {
    const res = await client.query<{ id: string; full_name: string }>(
      `SELECT e.id, e.full_name
       FROM employees e
       JOIN workspace_memberships m ON m.workspace_id = e.workspace_id AND m.user_id = e.user_id
       WHERE e.workspace_id = $1 AND e.user_id = $2 AND e.employment_status = 'active' AND m.status = 'active'
       LIMIT 1;`,
      [workspaceId, userId],
    );

    if (res.rows.length === 0 || !res.rows[0]) {
      throw new AuthError(
        'EMPLOYEE_NOT_FOUND',
        'Active employee profile required in workspace',
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
        `If-Match header is required for report ${action}`,
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
   * Replaces nothing; inserts report entries in order. An entry may link to a
   * work item, but only one that is assigned to the report's own employee.
   */
  private async insertEntries(
    client: PoolClient,
    workspaceId: string,
    reportId: string,
    entries: Array<{
      work_type: string;
      reported_count: number;
      notes?: string | null | undefined;
      work_item_id?: string | null | undefined;
    }>,
  ): Promise<ReportEntryData[]> {
    const linked = [
      ...new Set(
        entries.map((e) => e.work_item_id).filter((v): v is string => !!v),
      ),
    ];
    const titles = new Map<string, string>();
    if (linked.length > 0) {
      const ok = await client.query(
        `SELECT w.id, w.title
           FROM work_assignments a
           JOIN work_items w ON w.workspace_id = a.workspace_id AND w.id = a.work_item_id
           JOIN daily_reports r ON r.workspace_id = a.workspace_id AND r.employee_id = a.employee_id
          WHERE a.workspace_id = $1 AND r.id = $2 AND a.work_item_id = ANY($3::uuid[])`,
        [workspaceId, reportId, linked],
      );
      for (const row of ok.rows)
        titles.set(row.id as string, row.title as string);
      const missing = linked.filter((id) => !titles.has(id));
      if (missing.length > 0)
        throw new AuthError(
          'INVALID_WORK_ITEM',
          'Công việc liên kết không tồn tại hoặc chưa được giao cho bạn.',
          422,
          [{ field: 'work_item_id', message: missing[0]! }],
        );
    }
    const created: ReportEntryData[] = [];
    for (let i = 0; i < entries.length; i++) {
      const item = entries[i]!;
      const res = await client.query(
        `INSERT INTO daily_report_entries (
           workspace_id, report_id, work_type, reported_count, notes, sort_order, work_item_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, work_type, reported_count, notes, sort_order, work_item_id;`,
        [
          workspaceId,
          reportId,
          item.work_type.trim(),
          Number(item.reported_count),
          item.notes || null,
          i,
          item.work_item_id ?? null,
        ],
      );
      const row = res.rows[0] as ReportEntryData;
      created.push({
        ...row,
        work_item_title: row.work_item_id
          ? (titles.get(row.work_item_id) ?? null)
          : null,
      });
    }
    return created;
  }

  /**
   * Helper: Validates report entries array.
   */
  private validateEntries(
    entries: Array<{
      work_type: string;
      reported_count: number;
      notes?: string | null | undefined;
      work_item_id?: string | null | undefined;
    }>,
  ): void {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new AuthError(
        'INVALID_REQUEST',
        'At least one report entry is required',
        400,
      );
    }

    for (const [index, entry] of entries.entries()) {
      if (
        !entry.work_type ||
        typeof entry.work_type !== 'string' ||
        entry.work_type.trim() === ''
      ) {
        throw new AuthError(
          'INVALID_REQUEST',
          `Entry at index ${index} must have a valid work_type`,
          400,
        );
      }

      const link = (entry as { work_item_id?: unknown }).work_item_id;
      if (
        link !== undefined &&
        link !== null &&
        (typeof link !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            link,
          ))
      ) {
        throw new AuthError(
          'INVALID_REQUEST',
          `Entry at index ${index} has an invalid work_item_id`,
          400,
        );
      }

      const count = Number(entry.reported_count);
      if (!Number.isInteger(count) || count < 0) {
        throw new AuthError(
          'INVALID_REQUEST',
          `Entry at index ${index} must have a non-negative integer reported_count`,
          400,
        );
      }
    }
  }

  /**
   * Helper: Validates and parses report cursor.
   * Preserves full PostgreSQL timestamp precision (including microseconds)
   * and verifies real calendar date and format correctness.
   */
  private parseReportCursor(cursor: string): {
    report_date: string;
    created_at: string;
    id: string;
  } {
    try {
      const decodedStr = Buffer.from(cursor, 'base64url').toString('utf8');
      const decoded = JSON.parse(decodedStr);
      // prettier-ignore
      if (
        !decoded ||
        typeof decoded !== 'object' ||
        typeof decoded.report_date !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(decoded.report_date) ||
        typeof decoded.created_at !== 'string' ||
        typeof decoded.id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded.id)
      ) {
        throw new Error('Malformed cursor structure');
      }

      // 1. Validate real calendar date (reject e.g. 2026-02-30 or 2026-04-31)
      const [yearStr, monthStr, dayStr] = decoded.report_date.split('-');
      const y = parseInt(yearStr, 10);
      const m = parseInt(monthStr, 10);
      const d = parseInt(dayStr, 10);
      if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1970 || y > 2100) {
        throw new Error('Calendar date out of range');
      }
      const testDate = new Date(Date.UTC(y, m - 1, d));
      if (
        testDate.getUTCFullYear() !== y ||
        testDate.getUTCMonth() !== m - 1 ||
        testDate.getUTCDate() !== d
      ) {
        throw new Error('Non-existent calendar date');
      }

      // 2. Validate timestamp format and validity (preserve original string, do not round-trip via JS Date)
      const tsTrimmed = decoded.created_at.trim();
      if (
        !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)?$/.test(
          tsTrimmed,
        )
      ) {
        throw new Error('Invalid timestamp format');
      }
      const parsedMs = Date.parse(tsTrimmed);
      if (isNaN(parsedMs) || parsedMs < 0 || parsedMs > 4102444800000) {
        throw new Error('Timestamp value out of valid range');
      }

      return {
        report_date: decoded.report_date,
        created_at: tsTrimmed,
        id: decoded.id.toLowerCase(),
      };
    } catch (err: unknown) {
      if (err instanceof AuthError) throw err;
      throw new AuthError(
        'INVALID_CURSOR',
        'Mã phân trang (cursor) không hợp lệ hoặc bị lỗi định dạng.',
        400,
      );
    }
  }

  /**
   * GET /api/v1/reports/me
   * Staff/Owner retrieves their own daily reports.
   */
  async getReportsMe(
    context: AuthenticatedContext,
    options: {
      start_date?: string | undefined;
      end_date?: string | undefined;
      status?: string | undefined;
      limit?: number | undefined;
      cursor?: string | undefined;
    } = {},
  ): Promise<ListReportsResponseData> {
    const employee = await this.resolveEmployeeForUser(
      this.pool,
      context.workspace.id,
      context.user.id,
    );

    const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100);
    const conditions: string[] = ['r.workspace_id = $1', 'r.employee_id = $2'];
    const params: unknown[] = [context.workspace.id, employee.id];

    if (options.status) {
      params.push(options.status);
      conditions.push(`r.status = $${params.length}`);
    }

    if (options.start_date) {
      params.push(options.start_date);
      conditions.push(`r.report_date >= $${params.length}`);
    }

    if (options.end_date) {
      params.push(options.end_date);
      conditions.push(`r.report_date <= $${params.length}`);
    }

    if (options.cursor) {
      const parsedCursor = this.parseReportCursor(options.cursor);
      params.push(
        parsedCursor.report_date,
        parsedCursor.created_at,
        parsedCursor.id,
      );
      conditions.push(
        `(r.report_date, r.created_at, r.id) < ($${params.length - 2}::date, $${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }

    params.push(limit + 1);

    const res = await this.pool.query<DailyReportListItem>(
      `
      SELECT
        r.id,
        r.workspace_id,
        r.employee_id,
        emp.full_name as employee_name,
        r.report_date::text,
        r.status,
        r.current_revision,
        r.version,
        r.notes,
        count(e.id)::int as entries_count,
        coalesce(sum(e.reported_count), 0)::int as total_reported_count,
        r.created_at::text,
        r.updated_at::text,
        r.submitted_at::text
      FROM daily_reports r
      JOIN employees emp ON emp.workspace_id = r.workspace_id AND emp.id = r.employee_id
      LEFT JOIN daily_report_entries e ON e.workspace_id = r.workspace_id AND e.report_id = r.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY r.id, emp.full_name
      ORDER BY r.report_date DESC, r.created_at DESC, r.id DESC
      LIMIT $${params.length};
    `,
      params,
    );

    const rows = res.rows;
    let nextCursor: string | null = null;
    if (rows.length > limit) {
      rows.pop();
      const last = rows[rows.length - 1];
      if (last) {
        const rawVal: unknown = last.created_at;
        const createdAtStr =
          typeof rawVal === 'string'
            ? rawVal
            : rawVal instanceof Date
              ? rawVal.toISOString()
              : String(rawVal ?? '');
        nextCursor = Buffer.from(
          JSON.stringify({
            report_date: String(last.report_date),
            created_at: createdAtStr,
            id: String(last.id),
          }),
        ).toString('base64url');
      }
    }

    return {
      items: rows,
      next_cursor: nextCursor,
    };
  }

  /**
   * GET /api/v1/reports/daily
   * Owner-only view of workspace reports across all employees.
   */
  async listDailyReports(
    context: AuthenticatedContext,
    options: {
      employee_id?: string | undefined;
      start_date?: string | undefined;
      end_date?: string | undefined;
      status?: string | undefined;
      limit?: number | undefined;
      cursor?: string | undefined;
    } = {},
  ): Promise<ListReportsResponseData> {
    requireRole(['owner'], context);

    const limit = Math.min(Math.max(Number(options.limit) || 50, 1), 100);
    const conditions: string[] = ['r.workspace_id = $1'];
    const params: unknown[] = [context.workspace.id];

    if (options.employee_id) {
      params.push(options.employee_id);
      conditions.push(`r.employee_id = $${params.length}`);
    }

    if (options.status) {
      params.push(options.status);
      conditions.push(`r.status = $${params.length}`);
    }

    if (options.start_date) {
      params.push(options.start_date);
      conditions.push(`r.report_date >= $${params.length}`);
    }

    if (options.end_date) {
      params.push(options.end_date);
      conditions.push(`r.report_date <= $${params.length}`);
    }

    if (options.cursor) {
      const parsedCursor = this.parseReportCursor(options.cursor);
      params.push(
        parsedCursor.report_date,
        parsedCursor.created_at,
        parsedCursor.id,
      );
      conditions.push(
        `(r.report_date, r.created_at, r.id) < ($${params.length - 2}::date, $${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }

    params.push(limit + 1);

    const res = await this.pool.query<DailyReportListItem>(
      `
      SELECT
        r.id,
        r.workspace_id,
        r.employee_id,
        emp.full_name as employee_name,
        r.report_date::text,
        r.status,
        r.current_revision,
        r.version,
        r.notes,
        count(e.id)::int as entries_count,
        coalesce(sum(e.reported_count), 0)::int as total_reported_count,
        r.created_at::text,
        r.updated_at::text,
        r.submitted_at::text
      FROM daily_reports r
      JOIN employees emp ON emp.workspace_id = r.workspace_id AND emp.id = r.employee_id
      LEFT JOIN daily_report_entries e ON e.workspace_id = r.workspace_id AND e.report_id = r.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY r.id, emp.full_name
      ORDER BY r.report_date DESC, r.created_at DESC, r.id DESC
      LIMIT $${params.length};
    `,
      params,
    );

    const rows = res.rows;
    let nextCursor: string | null = null;
    if (rows.length > limit) {
      rows.pop();
      const last = rows[rows.length - 1];
      if (last) {
        const rawVal: unknown = last.created_at;
        const createdAtStr =
          typeof rawVal === 'string'
            ? rawVal
            : rawVal instanceof Date
              ? rawVal.toISOString()
              : String(rawVal ?? '');
        nextCursor = Buffer.from(
          JSON.stringify({
            report_date: String(last.report_date),
            created_at: createdAtStr,
            id: String(last.id),
          }),
        ).toString('base64url');
      }
    }

    return {
      items: rows,
      next_cursor: nextCursor,
    };
  }

  /**
   * GET /api/v1/reports/daily/:id
   * Get report details with entries and revision history.
   * Scoped to Owner or report owner.
   */
  async getReportById(
    context: AuthenticatedContext,
    reportId: string,
  ): Promise<ReportDetailResponseData> {
    const reportRes = await this.pool.query<{
      id: string;
      workspace_id: string;
      employee_id: string;
      employee_name: string;
      report_date: string;
      status: 'draft' | 'submitted';
      current_revision: number;
      version: number;
      notes: string | null;
      created_at: string;
      updated_at: string;
      submitted_at: string | null;
      report_user_id: string;
    }>(
      `SELECT
         r.id,
         r.workspace_id,
         r.employee_id,
         emp.full_name as employee_name,
         emp.user_id as report_user_id,
         r.report_date::text,
         r.status,
         r.current_revision,
         r.version,
         r.notes,
         r.created_at::text,
         r.updated_at::text,
         r.submitted_at::text
       FROM daily_reports r
       JOIN employees emp ON emp.workspace_id = r.workspace_id AND emp.id = r.employee_id
       WHERE r.workspace_id = $1 AND r.id = $2;`,
      [context.workspace.id, reportId],
    );

    if (reportRes.rows.length === 0 || !reportRes.rows[0]) {
      throw new AuthError('REPORT_NOT_FOUND', 'Daily report not found', 404);
    }

    const report = reportRes.rows[0];

    // Scoped access: Owner or the report owner (Staff)
    const isOwner = context.workspace.role === 'owner';
    const isReportOwner = report.report_user_id === context.user.id;

    if (!isOwner && !isReportOwner) {
      // Hidden cross-resource per canonical Doc 36
      throw new AuthError('REPORT_NOT_FOUND', 'Daily report not found', 404);
    }

    // Fetch entries
    const entriesRes = await this.pool.query<ReportEntryData>(
      `SELECT e.id, e.work_type, e.reported_count, e.notes, e.sort_order,
              e.work_item_id, w.title AS work_item_title
       FROM daily_report_entries e
       LEFT JOIN work_items w ON w.workspace_id = e.workspace_id AND w.id = e.work_item_id
       WHERE e.workspace_id = $1 AND e.report_id = $2
       ORDER BY e.sort_order ASC, e.created_at ASC;`,
      [context.workspace.id, reportId],
    );

    // Fetch revisions
    const revisions = await this.listRevisions(context, reportId);

    return {
      id: report.id,
      workspace_id: report.workspace_id,
      employee_id: report.employee_id,
      employee_name: report.employee_name,
      report_date: report.report_date,
      status: report.status,
      current_revision: report.current_revision,
      version: report.version,
      notes: report.notes,
      created_at: report.created_at,
      updated_at: report.updated_at,
      submitted_at: report.submitted_at,
      entries: entriesRes.rows,
      revisions,
    };
  }

  /**
   * POST /api/v1/reports/daily
   * Creates a new draft daily report with initial entries and draft revision.
   */
  async createReport(
    context: AuthenticatedContext,
    payload: CreateReportRequestBody,
  ): Promise<DailyReportData> {
    const employee = await this.resolveEmployeeForUser(
      this.pool,
      context.workspace.id,
      context.user.id,
    );

    if (
      !payload.report_date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(payload.report_date.trim())
    ) {
      throw new AuthError(
        'INVALID_REQUEST',
        'Valid report_date (YYYY-MM-DD) is required',
        400,
      );
    }

    const reportDate = payload.report_date.trim();
    this.validateEntries(payload.entries);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Check duplicate report for this date
      const checkRes = await client.query(
        `SELECT id FROM daily_reports
         WHERE workspace_id = $1 AND employee_id = $2 AND report_date = $3;`,
        [context.workspace.id, employee.id, reportDate],
      );

      if (checkRes.rows.length > 0) {
        throw new AuthError(
          'REPORT_ALREADY_EXISTS',
          `Daily report already exists for ${reportDate}`,
          409,
        );
      }

      // Create report in draft status
      const insertReportRes = await client.query<{
        id: string;
        workspace_id: string;
        employee_id: string;
        report_date: string;
        status: 'draft' | 'submitted';
        current_revision: number;
        version: number;
        notes: string | null;
        created_at: string;
        updated_at: string;
        submitted_at: string | null;
      }>(
        `INSERT INTO daily_reports (
           workspace_id,
           employee_id,
           report_date,
           status,
           current_revision,
           version,
           notes
         ) VALUES ($1, $2, $3, 'draft', 1, 1, $4)
         RETURNING id, workspace_id, employee_id, report_date::text, status, current_revision, version, notes, created_at::text, updated_at::text, submitted_at::text;`,
        [context.workspace.id, employee.id, reportDate, payload.notes || null],
      );

      const report = insertReportRes.rows[0]!;

      // Insert entries
      const createdEntries = await this.insertEntries(
        client,
        context.workspace.id,
        report.id,
        payload.entries,
      );

      await client.query('COMMIT');

      return {
        id: report.id,
        workspace_id: report.workspace_id,
        employee_id: report.employee_id,
        employee_name: employee.full_name,
        report_date: report.report_date,
        status: report.status,
        current_revision: report.current_revision,
        version: report.version,
        notes: report.notes,
        created_at: report.created_at,
        updated_at: report.updated_at,
        submitted_at: report.submitted_at,
        entries: createdEntries,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * PATCH /api/v1/reports/daily/:id
   * Updates an existing draft report. Draft only; submitted reports require revise.
   * Concurrency guarded with If-Match.
   */
  async updateDraftReport(
    context: AuthenticatedContext,
    reportId: string,
    payload: UpdateReportRequestBody,
    ifMatch: string | undefined,
  ): Promise<DailyReportData> {
    const expectedVersion = this.parseIfMatch(ifMatch, 'update');
    this.validateEntries(payload.entries);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const selectRes = await client.query<{
        id: string;
        workspace_id: string;
        employee_id: string;
        report_user_id: string;
        employee_name: string;
        report_date: string;
        status: 'draft' | 'submitted';
        current_revision: number;
        version: number;
        notes: string | null;
        created_at: string;
        updated_at: string;
        submitted_at: string | null;
      }>(
        `SELECT
           r.id,
           r.workspace_id,
           r.employee_id,
           emp.user_id as report_user_id,
           emp.full_name as employee_name,
           r.report_date::text,
           r.status,
           r.current_revision,
           r.version,
           r.notes,
           r.created_at::text,
           r.updated_at::text,
           r.submitted_at::text
         FROM daily_reports r
         JOIN employees emp ON emp.workspace_id = r.workspace_id AND emp.id = r.employee_id
         WHERE r.workspace_id = $1 AND r.id = $2
         FOR UPDATE;`,
        [context.workspace.id, reportId],
      );

      if (selectRes.rows.length === 0 || !selectRes.rows[0]) {
        throw new AuthError('REPORT_NOT_FOUND', 'Daily report not found', 404);
      }

      const report = selectRes.rows[0];

      // Only report owner can edit draft
      if (report.report_user_id !== context.user.id) {
        throw new AuthError('REPORT_NOT_FOUND', 'Daily report not found', 404);
      }

      // Check draft only per Doc 36 REP C02
      if (report.status !== 'draft') {
        throw new AuthError(
          'INVALID_TRANSITION',
          'Only draft reports can be updated via PATCH; submitted reports require new revision',
          422,
        );
      }

      // Check version
      if (report.version !== expectedVersion) {
        throw new AuthError(
          'PRECONDITION_FAILED',
          'Version mismatch (stale version)',
          412,
        );
      }

      // Delete old entries and insert new entries
      await client.query(
        `DELETE FROM daily_report_entries WHERE workspace_id = $1 AND report_id = $2;`,
        [context.workspace.id, reportId],
      );

      const createdEntries = await this.insertEntries(
        client,
        context.workspace.id,
        reportId,
        payload.entries,
      );

      // Update report record
      const updateRes = await client.query<{
        id: string;
        workspace_id: string;
        employee_id: string;
        report_date: string;
        status: 'draft' | 'submitted';
        current_revision: number;
        version: number;
        notes: string | null;
        created_at: string;
        updated_at: string;
        submitted_at: string | null;
      }>(
        `UPDATE daily_reports
         SET notes = $1,
             version = version + 1,
             updated_at = now()
         WHERE workspace_id = $2 AND id = $3
         RETURNING id, workspace_id, employee_id, report_date::text, status, current_revision, version, notes, created_at::text, updated_at::text, submitted_at::text;`,
        [
          payload.notes !== undefined ? payload.notes : report.notes,
          context.workspace.id,
          reportId,
        ],
      );

      await client.query('COMMIT');

      const updated = updateRes.rows[0]!;
      return {
        id: updated.id,
        workspace_id: updated.workspace_id,
        employee_id: updated.employee_id,
        employee_name: report.employee_name,
        report_date: updated.report_date,
        status: updated.status,
        current_revision: updated.current_revision,
        version: updated.version,
        notes: updated.notes,
        created_at: updated.created_at,
        updated_at: updated.updated_at,
        submitted_at: updated.submitted_at,
        entries: createdEntries,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * POST /api/v1/reports/daily/:id/submit
   * Submits a draft report. Transitions draft -> submitted.
   * Concurrency guarded with If-Match.
   */
  async submitReport(
    context: AuthenticatedContext,
    reportId: string,
    ifMatch: string | undefined,
  ): Promise<SubmitReportResponseData> {
    const expectedVersion = this.parseIfMatch(ifMatch, 'submit');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const selectRes = await client.query<{
        id: string;
        workspace_id: string;
        employee_id: string;
        report_user_id: string;
        status: 'draft' | 'submitted';
        current_revision: number;
        version: number;
        notes: string | null;
      }>(
        `SELECT
           r.id,
           r.workspace_id,
           r.employee_id,
           emp.user_id as report_user_id,
           r.status,
           r.current_revision,
           r.version,
           r.notes
         FROM daily_reports r
         JOIN employees emp ON emp.workspace_id = r.workspace_id AND emp.id = r.employee_id
         WHERE r.workspace_id = $1 AND r.id = $2
         FOR UPDATE;`,
        [context.workspace.id, reportId],
      );

      if (selectRes.rows.length === 0 || !selectRes.rows[0]) {
        throw new AuthError('REPORT_NOT_FOUND', 'Daily report not found', 404);
      }

      const report = selectRes.rows[0];

      if (report.report_user_id !== context.user.id) {
        throw new AuthError('REPORT_NOT_FOUND', 'Daily report not found', 404);
      }

      if (report.status === 'submitted') {
        throw new AuthError(
          'INVALID_TRANSITION',
          'Report is already submitted; use revisions endpoint to revise',
          422,
        );
      }

      if (report.version !== expectedVersion) {
        throw new AuthError(
          'PRECONDITION_FAILED',
          'Version mismatch (stale version)',
          412,
        );
      }

      // Fetch entries for snapshot
      const entriesRes = await client.query<ReportEntryData>(
        `SELECT work_type, reported_count, notes, work_item_id
         FROM daily_report_entries
         WHERE workspace_id = $1 AND report_id = $2
         ORDER BY sort_order ASC;`,
        [context.workspace.id, reportId],
      );

      if (entriesRes.rows.length === 0) {
        throw new AuthError(
          'INVALID_REQUEST',
          'Cannot submit report without entries',
          400,
        );
      }

      // Update report status to submitted
      const updateRes = await client.query<{
        submitted_at: string;
        version: number;
      }>(
        `UPDATE daily_reports
         SET status = 'submitted',
             submitted_at = now(),
             version = version + 1,
             updated_at = now()
         WHERE workspace_id = $1 AND id = $2
         RETURNING submitted_at::text, version;`,
        [context.workspace.id, reportId],
      );

      const updated = updateRes.rows[0]!;

      // Insert immutable submitted revision
      const revRes = await client.query<{ id: string }>(
        `INSERT INTO daily_report_revisions (
           workspace_id,
           report_id,
           revision_number,
           status,
           snapshot,
           reason,
           edited_by
         ) VALUES ($1, $2, $3, 'submitted', $4, 'Nộp báo cáo', $5)
         RETURNING id;`,
        [
          context.workspace.id,
          reportId,
          report.current_revision,
          JSON.stringify({
            entries: entriesRes.rows,
            notes: report.notes,
          }),
          context.user.id,
        ],
      );

      await client.query('COMMIT');

      return {
        report_id: report.id,
        revision_id: revRes.rows[0]!.id,
        revision_number: report.current_revision,
        status: 'submitted',
        submitted_at: updated.submitted_at,
        version: updated.version,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * POST /api/v1/reports/daily/:id/revisions
   * REP C02: Revises a submitted report. Report owner only.
   * Concurrency guarded with If-Match.
   */
  async reviseReport(
    context: AuthenticatedContext,
    reportId: string,
    payload: ReviseReportRequestBody,
    ifMatch: string | undefined,
  ): Promise<ReviseReportResponseData> {
    const expectedVersion = this.parseIfMatch(ifMatch, 'revision');
    this.validateEntries(payload.entries);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const selectRes = await client.query<{
        id: string;
        workspace_id: string;
        employee_id: string;
        report_user_id: string;
        status: 'draft' | 'submitted';
        current_revision: number;
        version: number;
        notes: string | null;
        submitted_at: string;
      }>(
        `SELECT
           r.id,
           r.workspace_id,
           r.employee_id,
           emp.user_id as report_user_id,
           r.status,
           r.current_revision,
           r.version,
           r.notes,
           r.submitted_at::text
         FROM daily_reports r
         JOIN employees emp ON emp.workspace_id = r.workspace_id AND emp.id = r.employee_id
         WHERE r.workspace_id = $1 AND r.id = $2
         FOR UPDATE;`,
        [context.workspace.id, reportId],
      );

      if (selectRes.rows.length === 0 || !selectRes.rows[0]) {
        throw new AuthError('REPORT_NOT_FOUND', 'Daily report not found', 404);
      }

      const report = selectRes.rows[0];

      if (report.report_user_id !== context.user.id) {
        throw new AuthError('REPORT_NOT_FOUND', 'Daily report not found', 404);
      }

      // Only submitted reports can be revised per Doc 36 REP C02
      if (report.status !== 'submitted') {
        throw new AuthError(
          'INVALID_TRANSITION',
          'Only submitted reports can be revised; draft reports must use PATCH',
          422,
        );
      }

      if (report.version !== expectedVersion) {
        throw new AuthError(
          'PRECONDITION_FAILED',
          'Version mismatch (stale version)',
          412,
        );
      }

      const nextRevision = report.current_revision + 1;

      // Update entries
      await client.query(
        `DELETE FROM daily_report_entries WHERE workspace_id = $1 AND report_id = $2;`,
        [context.workspace.id, reportId],
      );

      const createdEntries = await this.insertEntries(
        client,
        context.workspace.id,
        reportId,
        payload.entries,
      );

      // Update report record with new current_revision and incremented version
      const updateRes = await client.query<{
        version: number;
        submitted_at: string;
      }>(
        `UPDATE daily_reports
         SET current_revision = $1,
             notes = $2,
             version = version + 1,
             updated_at = now()
         WHERE workspace_id = $3 AND id = $4
         RETURNING version, submitted_at::text;`,
        [
          nextRevision,
          payload.notes !== undefined ? payload.notes : report.notes,
          context.workspace.id,
          reportId,
        ],
      );

      const updated = updateRes.rows[0]!;

      // Insert immutable revision record
      const revRes = await client.query<{ id: string }>(
        `INSERT INTO daily_report_revisions (
           workspace_id,
           report_id,
           revision_number,
           status,
           snapshot,
           reason,
           edited_by
         ) VALUES ($1, $2, $3, 'submitted', $4, $5, $6)
         RETURNING id;`,
        [
          context.workspace.id,
          reportId,
          nextRevision,
          JSON.stringify({
            entries: createdEntries.map((e) => ({
              work_type: e.work_type,
              reported_count: e.reported_count,
              notes: e.notes,
              work_item_id: e.work_item_id ?? null,
            })),
            notes: payload.notes !== undefined ? payload.notes : report.notes,
          }),
          payload.reason || 'Chỉnh sửa báo cáo sau khi nộp',
          context.user.id,
        ],
      );

      await client.query('COMMIT');

      return {
        report_id: report.id,
        revision_id: revRes.rows[0]!.id,
        revision_number: nextRevision,
        status: 'submitted',
        submitted_at: updated.submitted_at,
        version: updated.version,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * GET /api/v1/reports/daily/:id/revisions
   * Retrieves immutable revision history for a report.
   * Scoped to Owner or report owner.
   */
  async listRevisions(
    context: AuthenticatedContext,
    reportId: string,
  ): Promise<ReportRevisionData[]> {
    const reportRes = await this.pool.query<{
      workspace_id: string;
      report_user_id: string;
    }>(
      `SELECT r.workspace_id, emp.user_id as report_user_id
       FROM daily_reports r
       JOIN employees emp ON emp.workspace_id = r.workspace_id AND emp.id = r.employee_id
       WHERE r.workspace_id = $1 AND r.id = $2;`,
      [context.workspace.id, reportId],
    );

    if (reportRes.rows.length === 0 || !reportRes.rows[0]) {
      throw new AuthError('REPORT_NOT_FOUND', 'Daily report not found', 404);
    }

    const isOwner = context.workspace.role === 'owner';
    const isReportOwner = reportRes.rows[0].report_user_id === context.user.id;

    if (!isOwner && !isReportOwner) {
      throw new AuthError('REPORT_NOT_FOUND', 'Daily report not found', 404);
    }

    const res = await this.pool.query<{
      id: string;
      report_id: string;
      revision_number: number;
      status: 'draft' | 'submitted';
      snapshot: string | object;
      reason: string | null;
      edited_by: string;
      edited_by_name: string;
      edited_at: string;
    }>(
      `SELECT
         rev.id,
         rev.report_id,
         rev.revision_number,
         rev.status,
         rev.snapshot,
         rev.reason,
         rev.edited_by,
         u.username_normalized as edited_by_name,
         rev.edited_at::text
       FROM daily_report_revisions rev
       JOIN users u ON u.id = rev.edited_by
       WHERE rev.workspace_id = $1 AND rev.report_id = $2
       ORDER BY rev.revision_number DESC;`,
      [context.workspace.id, reportId],
    );

    return res.rows.map((r) => ({
      id: r.id,
      report_id: r.report_id,
      revision_number: r.revision_number,
      status: r.status,
      snapshot:
        typeof r.snapshot === 'string' ? JSON.parse(r.snapshot) : r.snapshot,
      reason: r.reason,
      edited_by: r.edited_by,
      edited_by_name: r.edited_by_name,
      edited_at: r.edited_at,
    }));
  }
}
