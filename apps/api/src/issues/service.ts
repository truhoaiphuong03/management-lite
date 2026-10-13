import type { DatabasePool } from '../../../../packages/database/src/pool.js';
import type { PoolClient } from 'pg';
import { recordAuditEvent } from '../../../../packages/database/src/audit.js';
import {
  claimIdempotency,
  completeIdempotency,
  computeRequestFingerprint,
} from '../../../../packages/database/src/idempotency.js';
import { AuthError, type AuthenticatedContext } from '../auth/service.js';
import { requireRole } from '../auth/guard.js';
import type {
  IssueData,
  IssueActivityData,
  IssueType,
  IssueStatus,
  CreateIssueRequest,
  CreateReportRequest,
  UpdateIssueRequest,
  ConfirmFixRequest,
  ReopenIssueRequest,
  ListIssuesQuery,
  ListIssuesResponseData,
  IssueDetailResponseData,
} from '../../../../packages/contracts/src/issues.js';

function fail(code: string, message: string, status = 400): never {
  throw new AuthError(code, message, status);
}

function validateUuid(v: unknown, fieldName = 'id'): string {
  if (
    typeof v !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  ) {
    fail('VALIDATION_ERROR', `Mã định danh ${fieldName} không đúng định dạng UUID.`, 400);
  }
  return v.toLowerCase();
}

function validateRouteTemplate(route: unknown): string {
  if (typeof route !== 'string' || !route.trim()) {
    fail('VALIDATION_ERROR', 'Đường dẫn giao diện (route_template) là bắt buộc.', 400);
  }
  const trimmed = route.trim();
  if (trimmed.length > 128) {
    fail('VALIDATION_ERROR', 'Đường dẫn giao diện không được vượt quá 128 ký tự.', 400);
  }
  if (!trimmed.startsWith('/')) {
    fail('VALIDATION_ERROR', 'Đường dẫn giao diện phải bắt đầu bằng "/".', 400);
  }
  if (trimmed.includes('?') || trimmed.includes('#')) {
    fail(
      'VALIDATION_ERROR',
      'Đường dẫn giao diện an toàn không được chứa query string (?) hoặc fragment (#).',
      400,
    );
  }
  if (!/^\/[a-zA-Z0-9_\-\/:]*$/.test(trimmed)) {
    fail('VALIDATION_ERROR', 'Đường dẫn giao diện chứa ký tự không hợp lệ.', 400);
  }
  return trimmed;
}

function checkVersionMatch(currentVersion: number, ifMatchHeader: string | undefined): void {
  if (!ifMatchHeader) {
    fail('PRECONDITION_REQUIRED', 'Tiêu đề If-Match là bắt buộc cho thao tác cập nhật.', 428);
  }
  const cleanMatch = ifMatchHeader.replace(/^"|"$/g, '').trim();
  const matchNum = Number(cleanMatch);
  if (isNaN(matchNum) || matchNum !== currentVersion) {
    fail(
      'PRECONDITION_FAILED',
      `Phiên bản dữ liệu không khớp (hiện tại: ${currentVersion}, yêu cầu: ${cleanMatch}).`,
      412,
    );
  }
}

function validateIdempotencyKey(key: unknown): string {
  if (typeof key !== 'string' || !key.trim()) {
    fail('VALIDATION_ERROR', 'Tiêu đề Idempotency-Key là bắt buộc đối với thao tác này.', 400);
  }
  const cleanKey = key.trim();
  if (!/^[\x21-\x7e]{1,128}$/.test(cleanKey)) {
    fail('VALIDATION_ERROR', 'Tiêu đề Idempotency-Key không hợp lệ.', 400);
  }
  return cleanKey;
}

export class IssuesService {
  constructor(private readonly pool: DatabasePool) {}

  /**
   * Helper to ensure active Owner role
   */
  private assertOwner(context: AuthenticatedContext): void {
    requireRole(['owner'], context);
  }

  /**
   * Helper to map raw issue database row to IssueData contract
   */
  private mapIssueRow(row: Record<string, unknown>): IssueData {
    return {
      id: String(row.id),
      workspace_id: String(row.workspace_id),
      reporter_user_id: String(row.reporter_user_id),
      reporter_name: row.reporter_name ? String(row.reporter_name) : undefined,
      type: row.type as IssueType,
      title: String(row.title),
      description: String(row.description),
      route_template: String(row.route_template),
      status: row.status as IssueStatus,
      version: Number(row.version),
      created_at: new Date(String(row.created_at)).toISOString(),
      updated_at: new Date(String(row.updated_at)).toISOString(),
      closed_at: row.closed_at ? new Date(String(row.closed_at)).toISOString() : null,
    };
  }

  /**
   * Helper to map raw activity database row to IssueActivityData contract
   */
  private mapActivityRow(row: Record<string, unknown>): IssueActivityData {
    return {
      id: String(row.id),
      workspace_id: String(row.workspace_id),
      issue_id: String(row.issue_id),
      actor_user_id: String(row.actor_user_id),
      actor_name: row.actor_name ? String(row.actor_name) : undefined,
      action: row.action as IssueActivityData['action'],
      metadata_sanitized: (row.metadata_sanitized as Record<string, unknown>) || {},
      created_at: new Date(String(row.created_at)).toISOString(),
    };
  }

  /**
   * 1. POST /api/v1/issues: Create Issue
   */
  async createIssue(
    context: AuthenticatedContext,
    body: CreateIssueRequest,
    requestId: string,
    idempotencyKey?: string,
  ): Promise<IssueData> {
    this.assertOwner(context);
    const validIdempotencyKey = validateIdempotencyKey(idempotencyKey);

    // Strict input validation
    if (!body || typeof body !== 'object') {
      fail('VALIDATION_ERROR', 'Payload yêu cầu không hợp lệ.', 400);
    }

    const allowedFields = ['type', 'title', 'description', 'route_template'];
    for (const key of Object.keys(body)) {
      if (!allowedFields.includes(key)) {
        fail('VALIDATION_ERROR', `Trường không được phép: '${key}'.`, 400);
      }
    }

    if (!body.type || !['bug', 'improvement'].includes(body.type)) {
      fail('VALIDATION_ERROR', 'Loại vấn đề (type) phải là "bug" hoặc "improvement".', 400);
    }

    if (typeof body.title !== 'string' || !body.title.trim()) {
      fail('VALIDATION_ERROR', 'Tiêu đề vấn đề (title) là bắt buộc.', 400);
    }
    const cleanTitle = body.title.trim();
    if (cleanTitle.length > 255) {
      fail('VALIDATION_ERROR', 'Tiêu đề không được vượt quá 255 ký tự.', 400);
    }

    if (typeof body.description !== 'string' || !body.description.trim()) {
      fail('VALIDATION_ERROR', 'Mô tả chi tiết (description) là bắt buộc.', 400);
    }
    const cleanDescription = body.description.trim();
    if (cleanDescription.length > 4000) {
      fail('VALIDATION_ERROR', 'Mô tả không được vượt quá 4000 ký tự.', 400);
    }

    const cleanRoute = validateRouteTemplate(body.route_template);

    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Idempotency claim (mandatory)
      const fingerprint = computeRequestFingerprint('POST', '/api/v1/issues', body);
      const claim = await claimIdempotency(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        operationKey: validIdempotencyKey,
        requestFingerprint: fingerprint,
      });

      if (claim.status === 'replay' && claim.sanitizedResponse) {
        await client.query('COMMIT');
        return claim.sanitizedResponse as unknown as IssueData;
      }
      if (claim.status === 'mismatch') {
        fail('CONFLICT', 'Trùng khóa Idempotency với nội dung yêu cầu khác nhau.', 409);
      }
      if (claim.status === 'in_progress') {
        fail('CONFLICT', 'Yêu cầu trùng lặp đang được xử lý đồng thời.', 409);
      }

      // 1. Insert into issues
      const issueRes = await client.query(
        `INSERT INTO issues (
          workspace_id,
          reporter_user_id,
          type,
          title,
          description,
          route_template,
          status,
          version
        ) VALUES ($1, $2, $3, $4, $5, $6, 'open', 1)
        RETURNING *`,
        [
          context.workspace.id,
          context.user.id,
          body.type,
          cleanTitle,
          cleanDescription,
          cleanRoute,
        ],
      );
      const createdRow = issueRes.rows[0];

      // 2. Insert into issue_activity (append-only)
      await client.query(
        `INSERT INTO issue_activity (
          workspace_id,
          issue_id,
          actor_user_id,
          action,
          metadata_sanitized
        ) VALUES ($1, $2, $3, 'created', $4)`,
        [
          context.workspace.id,
          createdRow.id,
          context.user.id,
          JSON.stringify({
            type: body.type,
            route_template: cleanRoute,
          }),
        ],
      );

      // 3. Record Audit Event
      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'issue.created',
        entityType: 'issue',
        entityId: createdRow.id,
        requestId,
        metadata: {
          type: body.type,
          title: cleanTitle,
          route_template: cleanRoute,
        },
      });

      const issueData = this.mapIssueRow(createdRow);

      // Complete idempotency record
      await completeIdempotency(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        operationKey: validIdempotencyKey,
        responseCode: 201,
        sanitizedResponse: issueData,
      });

      await client.query('COMMIT');
      return issueData;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * POST /api/v1/reports: User Bug Report (UI-REPORT-01)
   * Accessible by both Owner and Staff.
   */
  async createReport(
    context: AuthenticatedContext,
    body: CreateReportRequest,
    requestId: string,
    idempotencyKey?: string,
  ): Promise<IssueData> {
    requireRole(['owner', 'staff'], context);

    const validIdempotencyKey = idempotencyKey ? validateIdempotencyKey(idempotencyKey) : undefined;

    if (!body || typeof body !== 'object') {
      fail('VALIDATION_ERROR', 'Payload yêu cầu không hợp lệ.', 400);
    }

    if (typeof body.description !== 'string' || !body.description.trim()) {
      fail('VALIDATION_ERROR', 'Nội dung mô tả lỗi (description) là bắt buộc.', 400);
    }
    if (body.description.length > 3500) {
      fail('VALIDATION_ERROR', 'Mô tả không được vượt quá 3500 ký tự.', 400);
    }

    // Preserve verbatim original description without trimming or prepending [Module: ...]
    const rawDescription = body.description;

    let cleanTitle = typeof body.title === 'string' ? body.title.trim() : '';
    if (!cleanTitle) {
      const truncated = rawDescription.trim().slice(0, 60).replace(/\r?\n/g, ' ');
      cleanTitle = `[Báo lỗi] ${truncated}${rawDescription.trim().length > 60 ? '...' : ''}`;
    }
    if (cleanTitle.length > 255) {
      cleanTitle = cleanTitle.slice(0, 252) + '...';
    }

    let cleanRoute = '/';
    if (typeof body.route_template === 'string' && body.route_template.trim()) {
      try {
        cleanRoute = validateRouteTemplate(body.route_template);
      } catch {
        cleanRoute = '/';
      }
    }

    const cleanModule =
      typeof body.module_name === 'string'
        ? body.module_name.trim().slice(0, 64)
        : '';

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Idempotency claim (FIX-03A)
      if (validIdempotencyKey) {
        const fingerprint = computeRequestFingerprint('POST', '/api/v1/reports', body);
        const claim = await claimIdempotency(client, {
          workspaceId: context.workspace.id,
          actorUserId: context.user.id,
          operationKey: validIdempotencyKey,
          requestFingerprint: fingerprint,
        });

        if (claim.status === 'replay' && claim.sanitizedResponse) {
          await client.query('COMMIT');
          return claim.sanitizedResponse as unknown as IssueData;
        }
        if (claim.status === 'mismatch') {
          fail('CONFLICT', 'Trùng khóa Idempotency với nội dung yêu cầu khác nhau.', 409);
        }
        if (claim.status === 'in_progress') {
          fail('CONFLICT', 'Yêu cầu trùng lặp đang được xử lý đồng thời.', 409);
        }
      }

      const insertQuery = `
        INSERT INTO issues (
          workspace_id,
          reporter_user_id,
          type,
          title,
          description,
          route_template,
          status,
          version,
          created_at,
          updated_at
        ) VALUES ($1, $2, 'bug', $3, $4, $5, 'open', 1, clock_timestamp(), clock_timestamp())
        RETURNING *
      `;
      const res = await client.query(insertQuery, [
        context.workspace.id,
        context.user.id,
        cleanTitle,
        rawDescription,
        cleanRoute,
      ]);
      const createdRow = res.rows[0];

      await client.query(
        `INSERT INTO issue_activity (
          workspace_id,
          issue_id,
          actor_user_id,
          action,
          metadata_sanitized,
          created_at
        ) VALUES ($1, $2, $3, 'created', $4, clock_timestamp())`,
        [
          context.workspace.id,
          createdRow.id,
          context.user.id,
          JSON.stringify({
            source: 'ui_report_widget',
            module_name: cleanModule || undefined,
            route_template: cleanRoute,
            reporter_role: context.workspace.role,
          }),
        ],
      );

      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'issue.report_created',
        entityType: 'issue',
        entityId: createdRow.id,
        requestId,
        metadata: {
          route_template: cleanRoute,
          module_name: cleanModule,
        },
      });

      const issueData: IssueData = {
        ...this.mapIssueRow(createdRow),
        reporter_name: context.user.username,
      };

      if (validIdempotencyKey) {
        await completeIdempotency(client, {
          workspaceId: context.workspace.id,
          actorUserId: context.user.id,
          operationKey: validIdempotencyKey,
          responseCode: 201,
          sanitizedResponse: issueData,
        });
      }

      await client.query('COMMIT');

      return issueData;
    } catch (err) {
      console.error('CREATE_REPORT_ERROR:', err);
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 2. GET /api/v1/issues: List Issues
   */
  async listIssues(
    context: AuthenticatedContext,
    query: ListIssuesQuery = {},
  ): Promise<ListIssuesResponseData> {
    this.assertOwner(context);

    const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    const params: unknown[] = [context.workspace.id];
    let filterClauses = '';

    // Filter by type
    if (query.type) {
      if (!['bug', 'improvement'].includes(query.type)) {
        fail('VALIDATION_ERROR', 'Loại vấn đề (type) không hợp lệ.', 400);
      }
      params.push(query.type);
      filterClauses += ` AND i.type = $${params.length}`;
    }

    // Filter by status or active/archived tabs or groups
    if (query.status) {
      if (query.status === 'active') {
        filterClauses += ` AND i.status IN ('open', 'analyzing', 'fixing', 'awaiting_owner')`;
      } else if (query.status === 'archived') {
        filterClauses += ` AND i.status = 'closed'`;
      } else if (query.status === 'in_progress') {
        filterClauses += ` AND i.status IN ('analyzing', 'fixing')`;
      } else if (query.status === 'new') {
        filterClauses += ` AND i.status = 'open'`;
      } else if (['open', 'analyzing', 'fixing', 'awaiting_owner', 'closed'].includes(query.status)) {
        params.push(query.status);
        filterClauses += ` AND i.status = $${params.length}`;
      } else {
        fail('VALIDATION_ERROR', 'Trạng thái lọc (status) không hợp lệ.', 400);
      }
    }

    // Cursor pagination (created_at DESC, id DESC)
    if (query.cursor) {
      try {
        const decodedStr = Buffer.from(query.cursor, 'base64url').toString('utf8');
        const decoded = JSON.parse(decodedStr);
        if (
          !decoded ||
          typeof decoded !== 'object' ||
          typeof decoded.created_at !== 'string' ||
          typeof decoded.id !== 'string' ||
          isNaN(Date.parse(decoded.created_at)) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decoded.id)
        ) {
          throw new Error('Malformed cursor');
        }
        params.push(decoded.created_at, decoded.id);
        filterClauses += ` AND (i.created_at, i.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
      } catch (err: unknown) {
        if (err instanceof AuthError) throw err;
        fail('INVALID_CURSOR', 'Mã phân trang (cursor) không hợp lệ hoặc bị lỗi định dạng.', 400);
      }
    }

    // Calculate workspace-wide counts across the 4 groups and all
    const countsRes = await this.pool.query(
      `SELECT
         COUNT(*)::int AS all_count,
         COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
         COUNT(*) FILTER (WHERE status IN ('analyzing', 'fixing'))::int AS in_progress_count,
         COUNT(*) FILTER (WHERE status = 'awaiting_owner')::int AS awaiting_owner_count,
         COUNT(*) FILTER (WHERE status = 'closed')::int AS closed_count
       FROM issues
       WHERE workspace_id = $1`,
      [context.workspace.id],
    );
    const countsRow = countsRes.rows[0];
    const counts = {
      all: Number(countsRow?.all_count ?? 0),
      open: Number(countsRow?.open_count ?? 0),
      in_progress: Number(countsRow?.in_progress_count ?? 0),
      awaiting_owner: Number(countsRow?.awaiting_owner_count ?? 0),
      closed: Number(countsRow?.closed_count ?? 0),
    };

    params.push(limit + 1);
    const sql = `
      SELECT i.*, u.username_normalized AS reporter_name
      FROM issues i
      LEFT JOIN users u ON i.reporter_user_id = u.id
      WHERE i.workspace_id = $1
      ${filterClauses}
      ORDER BY i.created_at DESC, i.id DESC
      LIMIT $${params.length}
    `;

    const result = await this.pool.query(sql, params);
    const hasMore = result.rows.length > limit;
    const items = hasMore ? result.rows.slice(0, limit) : result.rows;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      const payload = JSON.stringify({
        created_at: new Date(lastItem.created_at).toISOString(),
        id: lastItem.id,
      });
      nextCursor = Buffer.from(payload, 'utf8').toString('base64url');
    }

    return {
      items: items.map((r) => this.mapIssueRow(r)),
      next_cursor: nextCursor,
      has_more: hasMore,
      counts,
    };
  }

  /**
   * 3. GET /api/v1/issues/:id: Detail & Activity History
   */
  async getIssueDetail(
    context: AuthenticatedContext,
    id: string,
  ): Promise<IssueDetailResponseData> {
    this.assertOwner(context);
    const issueId = validateUuid(id, 'issue_id');

    const issueRes = await this.pool.query(
      `SELECT i.*, u.username_normalized AS reporter_name
       FROM issues i
       LEFT JOIN users u ON i.reporter_user_id = u.id
       WHERE i.workspace_id = $1 AND i.id = $2`,
      [context.workspace.id, issueId],
    );

    if (issueRes.rows.length === 0) {
      fail('NOT_FOUND', 'Không tìm thấy vấn đề (issue) yêu cầu.', 404);
    }

    const activityRes = await this.pool.query(
      `SELECT a.*, u.username_normalized AS actor_name
       FROM issue_activity a
       LEFT JOIN users u ON a.actor_user_id = u.id
       WHERE a.workspace_id = $1 AND a.issue_id = $2
       ORDER BY a.created_at ASC`,
      [context.workspace.id, issueId],
    );

    return {
      issue: this.mapIssueRow(issueRes.rows[0]),
      activities: activityRes.rows.map((r) => this.mapActivityRow(r)),
    };
  }

  /**
   * 4. PATCH /api/v1/issues/:id: Edit fields & state transitions
   */
  async updateIssue(
    context: AuthenticatedContext,
    id: string,
    body: UpdateIssueRequest,
    ifMatch: string | undefined,
    requestId: string,
    idempotencyKey?: string,
  ): Promise<IssueData> {
    this.assertOwner(context);
    const issueId = validateUuid(id, 'issue_id');
    const validIdempotencyKey = validateIdempotencyKey(idempotencyKey);

    if (!body || typeof body !== 'object') {
      fail('VALIDATION_ERROR', 'Payload cập nhật không hợp lệ.', 400);
    }

    const allowedFields = ['title', 'description', 'type', 'status', 'reason'];
    for (const key of Object.keys(body)) {
      if (!allowedFields.includes(key)) {
        fail('VALIDATION_ERROR', `Trường không được phép cập nhật: '${key}'.`, 400);
      }
    }

    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Idempotency replay check (mandatory)
      const fingerprint = computeRequestFingerprint(
        'PATCH',
        `/api/v1/issues/${issueId}`,
        body,
      );
      const claim = await claimIdempotency(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        operationKey: validIdempotencyKey,
        requestFingerprint: fingerprint,
      });

      if (claim.status === 'replay' && claim.sanitizedResponse) {
        await client.query('COMMIT');
        return claim.sanitizedResponse as unknown as IssueData;
      }
      if (claim.status === 'mismatch') {
        fail('CONFLICT', 'Trùng khóa Idempotency với nội dung yêu cầu khác nhau.', 409);
      }
      if (claim.status === 'in_progress') {
        fail('CONFLICT', 'Yêu cầu trùng lặp đang được xử lý đồng thời.', 409);
      }

      // Lock row FOR UPDATE
      const curRes = await client.query(
        `SELECT * FROM issues WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
        [context.workspace.id, issueId],
      );

      if (curRes.rows.length === 0) {
        fail('NOT_FOUND', 'Không tìm thấy vấn đề (issue) yêu cầu.', 404);
      }

      const current = curRes.rows[0];
      checkVersionMatch(Number(current.version), ifMatch);

      // C-01: Validate reason strictly for awaiting_owner -> fixing
      const isAwaitingOwnerToFixing =
        current.status === 'awaiting_owner' && body.status === 'fixing';

      let cleanReason: string | undefined;
      if (isAwaitingOwnerToFixing) {
        if (
          body.reason === undefined ||
          typeof body.reason !== 'string' ||
          !body.reason.trim()
        ) {
          fail(
            'VALIDATION_ERROR',
            'Lý do yêu cầu sửa đổi (reason) là bắt buộc khi chuyển từ awaiting_owner sang fixing.',
            400,
          );
        }
        cleanReason = body.reason.trim();
        if (cleanReason.length > 1000) {
          fail(
            'VALIDATION_ERROR',
            'Lý do yêu cầu sửa đổi không được vượt quá 1000 ký tự.',
            400,
          );
        }
      } else if (body.reason !== undefined) {
        fail(
          'VALIDATION_ERROR',
          'Trường lý do (reason) chỉ được phép khi chuyển trạng thái từ awaiting_owner sang fixing.',
          400,
        );
      }

      // Validate status transition rules
      let targetStatus = current.status as IssueStatus;
      let statusChanged = false;
      if (body.status !== undefined && body.status !== current.status) {
        // Disallow closing via generic PATCH
        if (body.status === 'closed') {
          fail(
            'CANONICAL_VIOLATION',
            'Để đóng vấn đề, Owner phải thực hiện qua endpoint xác nhận sửa lỗi POST /confirm-fix.',
            400,
          );
        }

        // Closed issues cannot be modified or transitioned via PATCH
        if (current.status === 'closed') {
          fail(
            'INVALID_STATE_TRANSITION',
            'Vấn đề đã đóng, không thể thay đổi trạng thái trừ khi được mở lại qua POST /reopen.',
            400,
          );
        }

        // Allowed transitions: open -> analyzing -> fixing -> awaiting_owner
        const allowedTransitions: Record<string, string[]> = {
          open: ['analyzing'],
          analyzing: ['fixing'],
          fixing: ['awaiting_owner'],
          awaiting_owner: ['fixing'], // Can move back to fixing if rework needed
        };

        const validNext = allowedTransitions[current.status] || [];
        if (!validNext.includes(body.status)) {
          fail(
            'INVALID_STATE_TRANSITION',
            `Chuyển đổi trạng thái không hợp lệ: từ "${current.status}" sang "${body.status}".`,
            400,
          );
        }

        targetStatus = body.status;
        statusChanged = true;
      }

      // Validate title if supplied
      let targetTitle = current.title;
      let titleChanged = false;
      if (body.title !== undefined) {
        if (typeof body.title !== 'string' || !body.title.trim()) {
          fail('VALIDATION_ERROR', 'Tiêu đề không được để trống.', 400);
        }
        const clean = body.title.trim();
        if (clean.length > 255) {
          fail('VALIDATION_ERROR', 'Tiêu đề không được vượt quá 255 ký tự.', 400);
        }
        if (clean !== current.title) {
          targetTitle = clean;
          titleChanged = true;
        }
      }

      // Validate description if supplied
      let targetDesc = current.description;
      let descChanged = false;
      if (body.description !== undefined) {
        if (typeof body.description !== 'string' || !body.description.trim()) {
          fail('VALIDATION_ERROR', 'Mô tả không được để trống.', 400);
        }
        const clean = body.description.trim();
        if (clean.length > 4000) {
          fail('VALIDATION_ERROR', 'Mô tả không được vượt quá 4000 ký tự.', 400);
        }
        if (clean !== current.description) {
          targetDesc = clean;
          descChanged = true;
        }
      }

      // Validate type if supplied
      let targetType = current.type;
      let typeChanged = false;
      if (body.type !== undefined) {
        if (!['bug', 'improvement'].includes(body.type)) {
          fail('VALIDATION_ERROR', 'Loại vấn đề phải là "bug" hoặc "improvement".', 400);
        }
        if (body.type !== current.type) {
          targetType = body.type;
          typeChanged = true;
        }
      }

      if (!statusChanged && !titleChanged && !descChanged && !typeChanged) {
        await client.query('COMMIT');
        return this.mapIssueRow(current);
      }

      const newVersion = Number(current.version) + 1;
      const updateRes = await client.query(
        `UPDATE issues
         SET title = $1,
             description = $2,
             type = $3,
             status = $4,
             version = $5,
             updated_at = clock_timestamp()
         WHERE workspace_id = $6 AND id = $7
         RETURNING *`,
        [
          targetTitle,
          targetDesc,
          targetType,
          targetStatus,
          newVersion,
          context.workspace.id,
          issueId,
        ],
      );
      const updatedRow = updateRes.rows[0];

      // Insert Activity
      if (statusChanged) {
        const metadata: Record<string, unknown> = {
          from_status: current.status,
          to_status: targetStatus,
          version: newVersion,
        };
        if (isAwaitingOwnerToFixing && cleanReason) {
          metadata.reason = cleanReason;
        }

        await client.query(
          `INSERT INTO issue_activity (
            workspace_id,
            issue_id,
            actor_user_id,
            action,
            metadata_sanitized
          ) VALUES ($1, $2, $3, 'status_changed', $4)`,
          [
            context.workspace.id,
            issueId,
            context.user.id,
            JSON.stringify(metadata),
          ],
        );
      }

      if (titleChanged || descChanged || typeChanged) {
        await client.query(
          `INSERT INTO issue_activity (
            workspace_id,
            issue_id,
            actor_user_id,
            action,
            metadata_sanitized
          ) VALUES ($1, $2, $3, 'edited', $4)`,
          [
            context.workspace.id,
            issueId,
            context.user.id,
            JSON.stringify({
              edited_fields: [
                titleChanged ? 'title' : null,
                descChanged ? 'description' : null,
                typeChanged ? 'type' : null,
              ].filter(Boolean),
              version: newVersion,
            }),
          ],
        );
      }

      // Record Audit Event (no raw reason, only issue ID, prev/new status, prev/new version, action)
      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: statusChanged ? 'issue.status_changed' : 'issue.updated',
        entityType: 'issue',
        entityId: issueId,
        requestId,
        metadata: {
          previous_version: current.version,
          new_version: newVersion,
          previous_status: current.status,
          new_status: targetStatus,
        },
      });

      const updatedData = this.mapIssueRow(updatedRow);

      // Complete idempotency record
      await completeIdempotency(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        operationKey: validIdempotencyKey,
        responseCode: 200,
        sanitizedResponse: updatedData,
      });

      await client.query('COMMIT');
      return updatedData;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 5. POST /api/v1/issues/:id/confirm-fix: Owner confirms fix & closes issue
   */
  async confirmFix(
    context: AuthenticatedContext,
    id: string,
    body: ConfirmFixRequest = {},
    ifMatch: string | undefined,
    requestId: string,
    idempotencyKey?: string,
  ): Promise<IssueData> {
    this.assertOwner(context);
    const issueId = validateUuid(id, 'issue_id');
    const validIdempotencyKey = validateIdempotencyKey(idempotencyKey);

    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Mandatory Idempotency claim
      const fingerprint = computeRequestFingerprint(
        'POST',
        `/api/v1/issues/${issueId}/confirm-fix`,
        body,
      );
      const claim = await claimIdempotency(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        operationKey: validIdempotencyKey,
        requestFingerprint: fingerprint,
      });

      if (claim.status === 'replay' && claim.sanitizedResponse) {
        await client.query('COMMIT');
        return claim.sanitizedResponse as unknown as IssueData;
      }
      if (claim.status === 'mismatch') {
        fail('CONFLICT', 'Trùng khóa Idempotency với nội dung yêu cầu khác nhau.', 409);
      }
      if (claim.status === 'in_progress') {
        fail('CONFLICT', 'Yêu cầu trùng lặp đang được xử lý đồng thời.', 409);
      }

      const curRes = await client.query(
        `SELECT * FROM issues WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
        [context.workspace.id, issueId],
      );

      if (curRes.rows.length === 0) {
        fail('NOT_FOUND', 'Không tìm thấy vấn đề (issue) yêu cầu.', 404);
      }

      const current = curRes.rows[0];
      checkVersionMatch(Number(current.version), ifMatch);

      if (current.status === 'closed') {
        fail('INVALID_STATE_TRANSITION', 'Vấn đề này đã được đóng trước đó.', 400);
      }

      const cleanComment =
        typeof body.comment === 'string' && body.comment.trim()
          ? body.comment.trim().slice(0, 1000)
          : undefined;

      const newVersion = Number(current.version) + 1;
      const updateRes = await client.query(
        `UPDATE issues
         SET status = 'closed',
             closed_at = clock_timestamp(),
             version = $1,
             updated_at = clock_timestamp()
         WHERE workspace_id = $2 AND id = $3
         RETURNING *`,
        [newVersion, context.workspace.id, issueId],
      );
      const closedRow = updateRes.rows[0];

      // Insert Activity
      await client.query(
        `INSERT INTO issue_activity (
          workspace_id,
          issue_id,
          actor_user_id,
          action,
          metadata_sanitized
        ) VALUES ($1, $2, $3, 'fix_confirmed', $4)`,
        [
          context.workspace.id,
          issueId,
          context.user.id,
          JSON.stringify({
            previous_status: current.status,
            to_status: 'closed',
            comment: cleanComment,
            version: newVersion,
          }),
        ],
      );

      // Record Audit Event
      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'issue.fix_confirmed',
        entityType: 'issue',
        entityId: issueId,
        requestId,
        metadata: {
          previous_status: current.status,
          new_status: 'closed',
          previous_version: current.version,
          new_version: newVersion,
        },
      });

      const closedData = this.mapIssueRow(closedRow);

      // Complete idempotency record
      await completeIdempotency(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        operationKey: validIdempotencyKey,
        responseCode: 200,
        sanitizedResponse: closedData,
      });

      await client.query('COMMIT');
      return closedData;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 6. POST /api/v1/issues/:id/reopen: Owner reopens closed issue
   */
  async reopenIssue(
    context: AuthenticatedContext,
    id: string,
    body: ReopenIssueRequest,
    ifMatch: string | undefined,
    requestId: string,
    idempotencyKey?: string,
  ): Promise<IssueData> {
    this.assertOwner(context);
    const issueId = validateUuid(id, 'issue_id');
    const validIdempotencyKey = validateIdempotencyKey(idempotencyKey);

    if (!body || typeof body.reason !== 'string' || !body.reason.trim()) {
      fail('VALIDATION_ERROR', 'Lý do mở lại vấn đề (reason) là bắt buộc.', 400);
    }
    const cleanReason = body.reason.trim();
    if (cleanReason.length > 1000) {
      fail('VALIDATION_ERROR', 'Lý do mở lại không được vượt quá 1000 ký tự.', 400);
    }

    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Mandatory Idempotency claim
      const fingerprint = computeRequestFingerprint(
        'POST',
        `/api/v1/issues/${issueId}/reopen`,
        body,
      );
      const claim = await claimIdempotency(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        operationKey: validIdempotencyKey,
        requestFingerprint: fingerprint,
      });

      if (claim.status === 'replay' && claim.sanitizedResponse) {
        await client.query('COMMIT');
        return claim.sanitizedResponse as unknown as IssueData;
      }
      if (claim.status === 'mismatch') {
        fail('CONFLICT', 'Trùng khóa Idempotency với nội dung yêu cầu khác nhau.', 409);
      }
      if (claim.status === 'in_progress') {
        fail('CONFLICT', 'Yêu cầu trùng lặp đang được xử lý đồng thời.', 409);
      }

      const curRes = await client.query(
        `SELECT * FROM issues WHERE workspace_id = $1 AND id = $2 FOR UPDATE`,
        [context.workspace.id, issueId],
      );

      if (curRes.rows.length === 0) {
        fail('NOT_FOUND', 'Không tìm thấy vấn đề (issue) yêu cầu.', 404);
      }

      const current = curRes.rows[0];
      checkVersionMatch(Number(current.version), ifMatch);

      if (current.status !== 'closed') {
        fail('INVALID_STATE_TRANSITION', 'Chỉ có thể mở lại vấn đề đang ở trạng thái closed.', 400);
      }

      const newVersion = Number(current.version) + 1;
      const updateRes = await client.query(
        `UPDATE issues
         SET status = 'open',
             closed_at = NULL,
             version = $1,
             updated_at = clock_timestamp()
         WHERE workspace_id = $2 AND id = $3
         RETURNING *`,
        [newVersion, context.workspace.id, issueId],
      );
      const reopenedRow = updateRes.rows[0];

      // Insert Activity
      await client.query(
        `INSERT INTO issue_activity (
          workspace_id,
          issue_id,
          actor_user_id,
          action,
          metadata_sanitized
        ) VALUES ($1, $2, $3, 'reopened', $4)`,
        [
          context.workspace.id,
          issueId,
          context.user.id,
          JSON.stringify({
            previous_status: 'closed',
            to_status: 'open',
            reason: cleanReason,
            version: newVersion,
          }),
        ],
      );

      // Record Audit Event (no raw reason, only issue ID, prev/new status, prev/new version, action)
      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'issue.reopened',
        entityType: 'issue',
        entityId: issueId,
        requestId,
        metadata: {
          previous_status: 'closed',
          new_status: 'open',
          previous_version: current.version,
          new_version: newVersion,
        },
      });

      const reopenedData = this.mapIssueRow(reopenedRow);

      // Complete idempotency record
      await completeIdempotency(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        operationKey: validIdempotencyKey,
        responseCode: 200,
        sanitizedResponse: reopenedData,
      });

      await client.query('COMMIT');
      return reopenedData;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
