import crypto from 'node:crypto';
import type { DatabasePool } from '../../../../packages/database/src/pool.js';
import { AuthError, type AuthenticatedContext } from '../auth/service.js';
import { requireRole } from '../auth/guard.js';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogSource = 'api' | 'web';

export interface SystemLogInput {
  level: LogLevel;
  source: LogSource;
  workspaceId?: string | null | undefined;
  userId?: string | null | undefined;
  requestId?: string | null | undefined;
  method?: string | null | undefined;
  route?: string | null | undefined;
  status?: number | null | undefined;
  durationMs?: number | null | undefined;
  errorCode?: string | null | undefined;
  message: string;
  stack?: string | null | undefined;
  release?: string | null | undefined;
  userAgent?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

const RETENTION_DAYS = 30;
const MAX_QUEUE = 500;
const MAX_MESSAGE = 600;
const MAX_STACK = 4000;
const PURGE_EVERY_MS = 60 * 60 * 1000;
const UUID_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Removes secrets that must never reach a log row. */
export function sanitizeLogText(
  text: string | null | undefined,
  max: number,
): string {
  if (!text) return '';
  return String(text)
    .replace(/(postgres(?:ql)?:\/\/)[^\s@/]+@/gi, '$1[REDACTED]@')
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .replace(
      /((?:password|passwd|secret|token|api[_-]?key|authorization|cookie|csrf|client_secret)["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi,
      '$1[REDACTED]',
    )
    .replace(
      /\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
      '[REDACTED_JWT]',
    )
    .slice(0, max);
}

/** Path only (no query string), ids replaced so identical routes group together. */
export function normalizeRoute(pathOrUrl: string | null | undefined): string {
  if (!pathOrUrl) return '';
  let p = String(pathOrUrl);
  try {
    if (/^https?:\/\//i.test(p)) p = new URL(p).pathname;
  } catch {
    /* keep raw */
  }
  p = p.split('?')[0]!.split('#')[0]!;
  return p
    .replace(UUID_RE, ':id')
    .replace(/\/\d{3,}(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{20,}(?=\/|$)/gi, '/:id')
    .slice(0, 200);
}

export function logFingerprint(parts: {
  level: string;
  source: string;
  route?: string | null | undefined;
  errorCode?: string | null | undefined;
  message: string;
  stack?: string | null | undefined;
}): string {
  const firstFrame =
    (parts.stack ?? '')
      .split('\n')
      .find((l) => /^\s+at\s/.test(l))
      ?.replace(/:\d+:\d+\)?$/, '')
      .trim() ?? '';
  const basis = [
    parts.source,
    parts.route ?? '',
    parts.errorCode ?? '',
    firstFrame || parts.message.replace(/\d+/g, '#').slice(0, 120),
  ].join('|');
  return crypto.createHash('sha1').update(basis).digest('hex').slice(0, 16);
}

export interface SystemLogRow {
  id: string;
  occurred_at: string;
  level: LogLevel;
  source: LogSource;
  workspace_id: string | null;
  user_id: string | null;
  request_id: string | null;
  method: string | null;
  route: string | null;
  status: number | null;
  duration_ms: number | null;
  error_code: string | null;
  message: string;
  stack?: string | null;
  fingerprint: string;
  release: string | null;
  user_agent: string | null;
  metadata: Record<string, unknown>;
}

export interface SystemLogQuery {
  level?: string | undefined;
  source?: string | undefined;
  status_min?: string | undefined;
  route?: string | undefined;
  request_id?: string | undefined;
  fingerprint?: string | undefined;
  q?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  limit?: string | undefined;
  cursor?: string | undefined;
}

const isIso = (v: string | undefined): v is string =>
  !!v && !Number.isNaN(Date.parse(v));

export class SystemLogService {
  private queue: SystemLogInput[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing = false;
  private lastPurge = 0;
  private lastFlushError = 0;
  private readonly clientErrorWindow = new Map<string, number[]>();

  constructor(private readonly pool: DatabasePool) {}

  /** Fire-and-forget. Never throws and never blocks the request. */
  record(entry: SystemLogInput): void {
    try {
      if (this.queue.length >= MAX_QUEUE) this.queue.shift();
      this.queue.push(entry);
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.flush();
        }, 250);
        this.timer.unref?.();
      }
    } catch {
      /* logging must never break the app */
    }
  }

  /** Allows at most 20 browser error reports per user per minute. */
  allowClientError(userId: string): boolean {
    const now = Date.now();
    const list = (this.clientErrorWindow.get(userId) ?? []).filter(
      (t) => now - t < 60_000,
    );
    if (list.length >= 20) {
      this.clientErrorWindow.set(userId, list);
      return false;
    }
    list.push(now);
    this.clientErrorWindow.set(userId, list);
    if (this.clientErrorWindow.size > 1000) this.clientErrorWindow.clear();
    return true;
  }

  async flush(): Promise<void> {
    if (this.flushing || this.queue.length === 0) return;
    this.flushing = true;
    const batch = this.queue.splice(0, 100);
    try {
      const values: unknown[] = [];
      const rows = batch.map((e, i) => {
        const message =
          sanitizeLogText(e.message, MAX_MESSAGE) || '(no message)';
        const stack = sanitizeLogText(e.stack, MAX_STACK) || null;
        const route = e.route ? normalizeRoute(e.route) : null;
        const fp = logFingerprint({
          level: e.level,
          source: e.source,
          route,
          errorCode: e.errorCode,
          message,
          stack,
        });
        const o = i * 15;
        values.push(
          e.level,
          e.source,
          e.workspaceId ?? null,
          e.userId ?? null,
          e.requestId ? e.requestId.slice(0, 80) : null,
          e.method ?? null,
          route,
          e.status ?? null,
          e.durationMs ?? null,
          e.errorCode ? e.errorCode.slice(0, 80) : null,
          message,
          stack,
          fp,
          e.release ?? null,
          JSON.stringify({
            ...(e.metadata ?? {}),
            ...(e.userAgent
              ? { user_agent: sanitizeLogText(e.userAgent, 200) }
              : {}),
          }),
        );
        return `(${Array.from({ length: 15 }, (_x, k) => `$${o + k + 1}`).join(',')})`;
      });
      await this.pool.query(
        `INSERT INTO system_logs (level, source, workspace_id, user_id, request_id, method, route, status, duration_ms, error_code, message, stack, fingerprint, release, metadata)
         VALUES ${rows.join(',')}`,
        values,
      );
      if (Date.now() - this.lastPurge > PURGE_EVERY_MS) {
        this.lastPurge = Date.now();
        await this.pool.query(
          `DELETE FROM system_logs WHERE occurred_at < now() - ($1 || ' days')::interval`,
          [String(RETENTION_DAYS)],
        );
      }
    } catch (err) {
      if (Date.now() - this.lastFlushError > 60_000) {
        this.lastFlushError = Date.now();
        console.error('[SYSTEM_LOG_FLUSH_FAILED]', (err as Error)?.message);
      }
    } finally {
      this.flushing = false;
      if (this.queue.length > 0 && !this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.flush();
        }, 250);
        this.timer.unref?.();
      }
    }
  }

  // ------------------------------------------------------------------ reads

  private scope(auth: AuthenticatedContext): string {
    return auth.workspace.id;
  }

  async list(
    auth: AuthenticatedContext,
    q: SystemLogQuery,
  ): Promise<{ items: SystemLogRow[]; next_cursor: string | null }> {
    requireRole(['owner'], auth);
    const where: string[] = ['(workspace_id = $1 OR workspace_id IS NULL)'];
    const params: unknown[] = [this.scope(auth)];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.level) {
      if (!['info', 'warn', 'error'].includes(q.level))
        throw new AuthError('VALIDATION_ERROR', 'level không hợp lệ.', 400);
      add('level = ?', q.level);
    }
    if (q.source) {
      if (!['api', 'web'].includes(q.source))
        throw new AuthError('VALIDATION_ERROR', 'source không hợp lệ.', 400);
      add('source = ?', q.source);
    }
    if (q.status_min) {
      const n = Number(q.status_min);
      if (!Number.isInteger(n) || n < 100 || n > 599)
        throw new AuthError(
          'VALIDATION_ERROR',
          'status_min không hợp lệ.',
          400,
        );
      add('status >= ?', n);
    }
    const like = (s: string) => `%${s.replace(/[\\%_]/g, '\\$&')}%`;
    if (q.route) add("route ILIKE ? ESCAPE '\\'", like(q.route.slice(0, 120)));
    if (q.request_id) add('request_id = ?', q.request_id.slice(0, 80));
    if (q.fingerprint) add('fingerprint = ?', q.fingerprint.slice(0, 32));
    if (q.q) {
      params.push(like(q.q.slice(0, 120)));
      const n = params.length;
      where.push(
        `(message ILIKE $${n} ESCAPE '\\' OR error_code ILIKE $${n} ESCAPE '\\' OR request_id ILIKE $${n} ESCAPE '\\')`,
      );
    }
    if (q.from) {
      if (!isIso(q.from))
        throw new AuthError('VALIDATION_ERROR', 'from không hợp lệ.', 400);
      add('occurred_at >= ?', new Date(q.from));
    }
    if (q.to) {
      if (!isIso(q.to))
        throw new AuthError('VALIDATION_ERROR', 'to không hợp lệ.', 400);
      add('occurred_at <= ?', new Date(q.to));
    }
    if (q.cursor) {
      try {
        const c = JSON.parse(
          Buffer.from(q.cursor, 'base64url').toString('utf8'),
        ) as {
          t: string;
          id: string;
        };
        if (!isIso(c.t) || !/^[0-9a-f-]{36}$/i.test(c.id)) throw new Error();
        params.push(new Date(c.t), c.id);
        where.push(
          `(occurred_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      } catch {
        throw new AuthError('VALIDATION_ERROR', 'cursor không hợp lệ.', 400);
      }
    }
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    params.push(limit + 1);
    const res = await this.pool.query<
      Omit<SystemLogRow, 'occurred_at'> & { occurred_at: Date }
    >(
      `SELECT id, occurred_at, level, source, workspace_id, user_id, request_id, method, route, status,
              duration_ms, error_code, message, fingerprint, release, metadata
         FROM system_logs
        WHERE ${where.join(' AND ')}
        ORDER BY occurred_at DESC, id DESC
        LIMIT $${params.length}`,
      params,
    );
    const rows = res.rows.slice(0, limit);
    const last = rows[rows.length - 1];
    return {
      items: rows.map((r) => ({
        ...r,
        occurred_at: r.occurred_at.toISOString(),
      })),
      next_cursor:
        res.rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                t: last.occurred_at.toISOString(),
                id: last.id,
              }),
            ).toString('base64url')
          : null,
    };
  }

  async summary(auth: AuthenticatedContext, hoursRaw?: string) {
    requireRole(['owner'], auth);
    const hours = Math.min(
      Math.max(Number(hoursRaw) || 24, 1),
      24 * RETENTION_DAYS,
    );
    const ws = this.scope(auth);
    const base = `(workspace_id = $1 OR workspace_id IS NULL) AND occurred_at >= now() - ($2 || ' hours')::interval`;
    const args = [ws, String(hours)];
    const [levels, timeline, top, routes, slow] = await Promise.all([
      this.pool.query<{ level: LogLevel; n: number }>(
        `SELECT level, count(*)::int AS n FROM system_logs WHERE ${base} GROUP BY level`,
        args,
      ),
      this.pool.query<{ bucket: Date; level: LogLevel; n: number }>(
        `SELECT date_trunc($3, occurred_at) AS bucket, level, count(*)::int AS n
           FROM system_logs WHERE ${base} GROUP BY 1, 2 ORDER BY 1`,
        [...args, hours > 72 ? 'day' : 'hour'],
      ),
      this.pool.query(
        `SELECT fingerprint, count(*)::int AS count, min(occurred_at) AS first_seen, max(occurred_at) AS last_seen,
                (array_agg(id ORDER BY occurred_at DESC))[1] AS last_id,
                (array_agg(message ORDER BY occurred_at DESC))[1] AS message,
                (array_agg(route ORDER BY occurred_at DESC))[1] AS route,
                (array_agg(error_code ORDER BY occurred_at DESC))[1] AS error_code,
                (array_agg(status ORDER BY occurred_at DESC))[1] AS status,
                (array_agg(source ORDER BY occurred_at DESC))[1] AS source,
                count(DISTINCT user_id)::int AS users
           FROM system_logs WHERE ${base} AND level IN ('warn','error')
          GROUP BY fingerprint ORDER BY count(*) DESC, max(occurred_at) DESC LIMIT 10`,
        args,
      ),
      this.pool.query(
        `SELECT route, count(*)::int AS count,
                count(*) FILTER (WHERE status >= 500)::int AS server_errors,
                round(avg(duration_ms))::int AS avg_ms
           FROM system_logs WHERE ${base} AND route IS NOT NULL AND source = 'api'
          GROUP BY route ORDER BY count(*) DESC LIMIT 10`,
        args,
      ),
      this.pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM system_logs WHERE ${base} AND duration_ms >= 3000`,
        args,
      ),
    ]);
    const by = (l: LogLevel) => levels.rows.find((r) => r.level === l)?.n ?? 0;
    return {
      hours,
      totals: {
        error: by('error'),
        warn: by('warn'),
        info: by('info'),
        slow: slow.rows[0]?.n ?? 0,
      },
      timeline: timeline.rows.map((r) => ({
        bucket: r.bucket.toISOString(),
        level: r.level,
        count: r.n,
      })),
      top_errors: top.rows.map((r) => ({
        ...r,
        first_seen: (r.first_seen as Date).toISOString(),
        last_seen: (r.last_seen as Date).toISOString(),
      })),
      top_routes: routes.rows,
      retention_days: RETENTION_DAYS,
    };
  }

  async detail(auth: AuthenticatedContext, id: string) {
    requireRole(['owner'], auth);
    if (!/^[0-9a-f-]{36}$/i.test(id))
      throw new AuthError('VALIDATION_ERROR', 'id không hợp lệ.', 400);
    const ws = this.scope(auth);
    const res = await this.pool.query<
      Omit<SystemLogRow, 'occurred_at'> & { occurred_at: Date }
    >(
      `SELECT * FROM system_logs WHERE id = $1 AND (workspace_id = $2 OR workspace_id IS NULL)`,
      [id, ws],
    );
    const row = res.rows[0];
    if (!row) throw new AuthError('NOT_FOUND', 'Không tìm thấy nhật ký.', 404);
    const [audit, siblings, occurrences] = row.request_id
      ? await Promise.all([
          this.pool.query(
            `SELECT id, action, entity_type, entity_id, created_at
               FROM audit_events WHERE workspace_id = $1 AND request_id = $2 ORDER BY created_at`,
            [ws, row.request_id],
          ),
          this.pool.query(
            `SELECT id, occurred_at, level, message, status FROM system_logs
              WHERE request_id = $1 AND id <> $2 AND (workspace_id = $3 OR workspace_id IS NULL)
              ORDER BY occurred_at LIMIT 20`,
            [row.request_id, id, ws],
          ),
          this.pool.query<{ n: number; first: Date; last: Date }>(
            `SELECT count(*)::int AS n, min(occurred_at) AS first, max(occurred_at) AS last
               FROM system_logs WHERE fingerprint = $1 AND (workspace_id = $2 OR workspace_id IS NULL)`,
            [row.fingerprint, ws],
          ),
        ])
      : [
          { rows: [] },
          { rows: [] },
          await this.pool.query<{ n: number; first: Date; last: Date }>(
            `SELECT count(*)::int AS n, min(occurred_at) AS first, max(occurred_at) AS last
               FROM system_logs WHERE fingerprint = $1 AND (workspace_id = $2 OR workspace_id IS NULL)`,
            [row.fingerprint, ws],
          ),
        ];
    const occ = occurrences.rows[0] as
      { n: number; first: Date; last: Date } | undefined;
    return {
      log: { ...row, occurred_at: row.occurred_at.toISOString() },
      related_audit_events: audit.rows,
      same_request_logs: siblings.rows,
      occurrences: occ
        ? {
            count: occ.n,
            first_seen: occ.first.toISOString(),
            last_seen: occ.last.toISOString(),
          }
        : null,
    };
  }

  buildAiFixPrompt(row: SystemLogRow, occurrencesCount = 1): string {
    const cleanMsg = sanitizeLogText(row.message, MAX_MESSAGE) || 'Lỗi hệ thống';
    const cleanStack = row.stack ? sanitizeLogText(row.stack, MAX_STACK) : '';
    const cleanRoute = row.route || '/';
    return [
      '🛠️ [YÊU CẦU AI SỬA LỖI HỆ THỐNG — MANAGEMENT LITE]',
      `- Mã lỗi / HTTP: ${row.error_code ?? 'ERROR'} (HTTP ${row.status ?? '—'})`,
      `- Thông điệp lỗi: ${cleanMsg}`,
      `- Đường dẫn (Route): ${row.method ?? 'GET'} ${cleanRoute}`,
      `- Nguồn: ${row.source === 'web' ? 'Trình duyệt (Web)' : 'Máy chủ (API)'} | Phiên bản: ${row.release ?? 'latest'}`,
      `- Số lần lặp lại: ${occurrencesCount} lần | Fingerprint: ${row.fingerprint}`,
      `- Request ID mẫu: ${row.request_id ?? '—'}`,
      cleanStack ? `- Stack trace:\n\`\`\`\n${cleanStack}\n\`\`\`` : '',
      '👉 Yêu cầu: Tìm nguyên nhân gốc rễ theo đúng file trong MODULE_FILE_MAP (AGENTS.md), sửa triệt để, chạy kiểm thử và cập nhật lên web.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  async dismiss(
    auth: AuthenticatedContext,
    opts: { fingerprint?: string | undefined; beforeIso?: string | undefined },
  ): Promise<{ deleted_count: number }> {
    requireRole(['owner'], auth);
    const ws = this.scope(auth);
    const fp = opts.fingerprint?.trim();
    if (fp) {
      if (!/^[0-9a-f]{8,32}$/i.test(fp)) {
        throw new AuthError('VALIDATION_ERROR', 'fingerprint không hợp lệ.', 400);
      }
      this.queue = this.queue.filter(
        (e) =>
          logFingerprint({
            level: e.level,
            source: e.source,
            route: e.route ? normalizeRoute(e.route) : null,
            errorCode: e.errorCode,
            message: sanitizeLogText(e.message, MAX_MESSAGE) || '(no message)',
            stack: sanitizeLogText(e.stack, MAX_STACK) || null,
          }) !== fp,
      );
      const res = await this.pool.query(
        `DELETE FROM system_logs
          WHERE (workspace_id = $1 OR workspace_id IS NULL)
            AND fingerprint = $2`,
        [ws, fp],
      );
      return { deleted_count: res.rowCount ?? 0 };
    }

    if (opts.beforeIso && !isIso(opts.beforeIso)) {
      throw new AuthError('VALIDATION_ERROR', 'before không hợp lệ.', 400);
    }
    const cutoff = opts.beforeIso ? new Date(opts.beforeIso) : new Date();
    this.queue = [];
    const res = await this.pool.query(
      `DELETE FROM system_logs
        WHERE (workspace_id = $1 OR workspace_id IS NULL)
          AND occurred_at <= $2`,
      [ws, cutoff],
    );
    return { deleted_count: res.rowCount ?? 0 };
  }

  async escalate(
    auth: AuthenticatedContext,
    input: { fingerprint?: string | undefined; log_id?: string | undefined },
  ): Promise<{
    issue_id: string | null;
    bug_code: string | null;
    ai_fix_prompt: string;
    deduplicated: boolean;
  }> {
    requireRole(['owner'], auth);
    await this.flush();
    const ws = this.scope(auth);
    const fp = input.fingerprint?.trim();
    const logId = input.log_id?.trim();

    if (!fp && !logId) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Cần cung cấp fingerprint hoặc log_id để tạo yêu cầu sửa lỗi.',
        400,
      );
    }
    if (logId && !/^[0-9a-f-]{36}$/i.test(logId)) {
      throw new AuthError('VALIDATION_ERROR', 'log_id không hợp lệ.', 400);
    }
    if (fp && !/^[0-9a-f]{8,32}$/i.test(fp)) {
      throw new AuthError('VALIDATION_ERROR', 'fingerprint không hợp lệ.', 400);
    }

    const logRes = await this.pool.query<
      Omit<SystemLogRow, 'occurred_at'> & { occurred_at: Date }
    >(
      logId
        ? `SELECT * FROM system_logs
            WHERE id = $1 AND (workspace_id = $2 OR workspace_id IS NULL)
            LIMIT 1`
        : `SELECT * FROM system_logs
            WHERE fingerprint = $1 AND (workspace_id = $2 OR workspace_id IS NULL)
            ORDER BY occurred_at DESC
            LIMIT 1`,
      [logId || fp, ws],
    );

    const row = logRes.rows[0];
    if (!row) {
      throw new AuthError(
        'NOT_FOUND',
        'Không tìm thấy bản ghi nhật ký lỗi tương ứng.',
        404,
      );
    }

    const occRes = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM system_logs
        WHERE fingerprint = $1 AND (workspace_id = $2 OR workspace_id IS NULL)`,
      [row.fingerprint, ws],
    );
    const occurrencesCount = occRes.rows[0]?.n ?? 1;
    const normalizedRow: SystemLogRow = {
      ...row,
      occurred_at: row.occurred_at.toISOString(),
    };
    const aiFixPrompt = this.buildAiFixPrompt(normalizedRow, occurrencesCount);

    const existingRes = await this.pool.query<{
      id: string;
      bug_code: string | null;
    }>(
      `SELECT id, bug_code
         FROM issues
        WHERE workspace_id = $1
          AND status <> 'closed'
          AND metadata_context->>'log_fingerprint' = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [ws, row.fingerprint],
    );
    if (existingRes.rows[0]) {
      return {
        issue_id: existingRes.rows[0].id,
        bug_code: existingRes.rows[0].bug_code,
        ai_fix_prompt: aiFixPrompt,
        deduplicated: true,
      };
    }

    const seqRes = await this.pool.query<{ max_num: number | null }>(
      `SELECT MAX(CAST(SUBSTRING(bug_code FROM 5) AS INTEGER)) AS max_num
         FROM issues
        WHERE workspace_id = $1 AND bug_code ~ '^BUG-[0-9]+`,
      [ws],
    );
    const nextNum = (seqRes.rows[0]?.max_num ?? 0) + 1;
    const bugCode = `BUG-${String(nextNum).padStart(4, '0')}`;

    const rawRoute = (row.route || '/system-logs').split('?')[0]!.split('#')[0]!;
    const safeRoute = /^\/[a-zA-Z0-9_\-\/:]*$/.test(rawRoute)
      ? rawRoute.slice(0, 128)
      : '/system-logs';
    const severity =
      (row.status && row.status >= 500) || row.level === 'error' ? 'P1' : 'P2';
    const title = `[${row.error_code || `HTTP ${row.status || 'ERR'}`}] ${sanitizeLogText(row.message, 120)}`.slice(
      0,
      250,
    );
    const analysis = {
      analyzed_at: new Date().toISOString(),
      model: 'system-log-escalator',
      summary: `Tự động chuyển từ Nhật ký hệ thống (${occurrencesCount} lần lặp lại tại ${safeRoute})`,
      root_cause: sanitizeLogText(row.message, 400),
      affected_files: [safeRoute],
      suggested_fix:
        'Đối chiếu bảng MODULE_FILE_MAP trong AGENTS.md và kế hoạch Phase 21 để xử lý tại gốc.',
      severity,
      can_auto_verify: true,
      suggested_tests: [`Kiểm tra ${row.method || 'GET'} ${safeRoute}`],
    };

    const insertRes = await this.pool.query<{ id: string; bug_code: string }>(
      `INSERT INTO issues (
         workspace_id, reporter_user_id, type, title, description,
         route_template, status, version, bug_code, severity,
         gemini_analysis, metadata_context
       ) VALUES (
         $1, $2, 'bug', $3, $4,
         $5, 'open', 1, $6, $7,
         $8::jsonb, $9::jsonb
       ) RETURNING id, bug_code`,
      [
        ws,
        auth.user.id,
        title,
        aiFixPrompt,
        safeRoute,
        bugCode,
        severity,
        JSON.stringify(analysis),
        JSON.stringify({
          log_fingerprint: row.fingerprint,
          log_id: row.id,
          request_id: row.request_id,
          status: row.status,
          source: row.source,
        }),
      ],
    );

    return {
      issue_id: insertRes.rows[0]?.id ?? null,
      bug_code: insertRes.rows[0]?.bug_code ?? bugCode,
      ai_fix_prompt: aiFixPrompt,
      deduplicated: false,
    };
  }
}
