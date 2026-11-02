import type { DatabasePool } from '../../../../packages/database/src/pool.js';
import { sanitizeAuditMetadata } from '../../../../packages/database/src/audit.js';
import type { AuthenticatedContext } from '../auth/service.js';
import type {
  AuditEventData,
  ListAuditEventsQuery,
  ListAuditEventsResponseData,
} from '../../../../packages/contracts/src/audit.js';

export class AuditServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'AuditServiceError';
  }
}

export class AuditService {
  constructor(private readonly pool: DatabasePool) {}

  /**
   * Lists audit events for the authenticated workspace.
   * Strictly Owner-only. Staff access fails closed with 403 FORBIDDEN.
   * Implements cursor-based pagination and deep redaction of sensitive metadata.
   */
  async listEvents(
    context: AuthenticatedContext,
    options: ListAuditEventsQuery = {},
  ): Promise<ListAuditEventsResponseData> {
    // 1. Owner-only authorization check
    if (context.workspace.role !== 'owner') {
      throw new AuditServiceError(
        'FORBIDDEN',
        'Truy cập bị từ chối: Nhật ký kiểm toán hệ thống chỉ dành cho Chủ sở hữu (Owner).',
        403,
      );
    }

    const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 100);
    const params: unknown[] = [context.workspace.id];

    let filterClauses = '';
    if (options.action) {
      params.push(options.action);
      filterClauses += ` AND a.action = $${params.length}`;
    }
    if (options.entity_type) {
      params.push(options.entity_type);
      filterClauses += ` AND a.entity_type = $${params.length}`;
    }

    // Cursor pagination (created_at DESC, id DESC)
    if (options.cursor) {
      try {
        const decodedStr = Buffer.from(options.cursor, 'base64url').toString(
          'utf8',
        );
        const decoded = JSON.parse(decodedStr);
        if (
          !decoded ||
          typeof decoded !== 'object' ||
          typeof decoded.created_at !== 'string' ||
          typeof decoded.id !== 'string' ||
          isNaN(Date.parse(decoded.created_at)) ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            decoded.id,
          )
        ) {
          throw new Error('Malformed cursor payload');
        }
        params.push(decoded.created_at, decoded.id);
        filterClauses += ` AND (a.created_at, a.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
      } catch (err: unknown) {
        if (err instanceof AuditServiceError) throw err;
        throw new AuditServiceError(
          'INVALID_CURSOR',
          'Mã phân trang (cursor) không hợp lệ hoặc bị lỗi định dạng.',
          400,
        );
      }
    }

    params.push(limit + 1);
    const limitPlaceholder = `$${params.length}`;

    const query = `
      SELECT
        a.id,
        a.workspace_id,
        a.actor_user_id,
        u.username_normalized AS actor_username,
        a.action,
        a.entity_type,
        a.entity_id,
        a.request_id,
        a.metadata_sanitized,
        a.created_at
      FROM audit_events a
      LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.workspace_id = $1
      ${filterClauses}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${limitPlaceholder};
    `;

    const res = await this.pool.query<{
      id: string;
      workspace_id: string;
      actor_user_id: string | null;
      actor_username: string | null;
      action: string;
      entity_type: string;
      entity_id: string;
      request_id: string;
      metadata_sanitized: Record<string, unknown>;
      created_at: Date;
    }>(query, params);

    const rows = res.rows;
    let nextCursor: string | null = null;
    if (rows.length > limit) {
      rows.pop();
      const last = rows[rows.length - 1];
      if (last) {
        nextCursor = Buffer.from(
          JSON.stringify({
            created_at: last.created_at.toISOString(),
            id: last.id,
          }),
        ).toString('base64url');
      }
    }

    // Count total events for workspace matching filter
    const countQuery = `
      SELECT count(*)::int AS total
      FROM audit_events a
      WHERE a.workspace_id = $1
      ${options.action ? 'AND a.action = $2' : ''}
      ${options.entity_type ? `AND a.entity_type = $${options.action ? 3 : 2}` : ''};
    `;
    const countParams: unknown[] = [context.workspace.id];
    if (options.action) countParams.push(options.action);
    if (options.entity_type) countParams.push(options.entity_type);

    const countRes = await this.pool.query<{ total: number }>(
      countQuery,
      countParams,
    );
    const totalCount = countRes.rows[0]?.total ?? 0;

    const items: AuditEventData[] = rows.map((r) => ({
      id: r.id,
      workspace_id: r.workspace_id,
      actor_user_id: r.actor_user_id,
      actor_username:
        r.actor_username || (r.actor_user_id ? 'User' : 'Hệ thống (System)'),
      action: r.action,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      request_id: r.request_id,
      metadata: sanitizeAuditMetadata(r.metadata_sanitized || {}),
      created_at: r.created_at.toISOString(),
    }));

    return { items, next_cursor: nextCursor, total_count: totalCount };
  }
}
