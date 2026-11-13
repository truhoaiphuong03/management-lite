import type { Pool, PoolClient } from 'pg';
import { AuthError, type AuthenticatedContext } from '../auth/service.js';
import { requireRole } from '../auth/guard.js';
import { recordAuditEvent } from '../../../../packages/database/src/audit.js';
import {
  claimIdempotency,
  completeIdempotency,
  computeRequestFingerprint,
} from '../../../../packages/database/src/idempotency.js';
const fail = (code: string, message: string, status = 409): never => {
  throw new AuthError(code, message, status);
};
const uuid = (v: unknown): string => {
  if (
    typeof v !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)
  )
    return fail('VALIDATION_ERROR', 'Invalid identifier', 400);
  return v.toLowerCase();
};
function text(v: unknown, max: number, required = false): string | null {
  if (v === undefined || v === null) {
    if (required) fail('VALIDATION_ERROR', 'Text required', 400);
    return null;
  }
  if (typeof v !== 'string' || v.length > max || (required && !v.trim()))
    fail('VALIDATION_ERROR', 'Invalid text', 400);
  return (v as string).trim();
}
function fields(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some((k) => !allowed.includes(k)))
    fail('VALIDATION_ERROR', 'Unknown request field', 400);
}
function ids(v: unknown): string[] {
  if (!Array.isArray(v) || !v.length || v.length > 100)
    fail('VALIDATION_ERROR', 'Employee list required', 400);
  const out = (v as unknown[]).map(uuid);
  if (new Set(out).size !== out.length)
    fail('VALIDATION_ERROR', 'Duplicate employee', 400);
  return out.sort();
}
function checkVersion(current: number, match: string | undefined) {
  if (!match) fail('PRECONDITION_REQUIRED', 'If-Match required', 428);
  if (
    !/^"[1-9][0-9]*"$/.test(match!) ||
    Number(match!.slice(1, -1)) !== current
  )
    fail('PRECONDITION_FAILED', 'Stale work item version', 412);
}
function attributes(body: Record<string, unknown>, create = false) {
  const out: Record<string, unknown> = {};
  for (const k of ['title', 'description'])
    if (k in body || create)
      out[k] = text(body[k], k === 'title' ? 200 : 20000, k === 'title');
  for (const [k, options, def] of [
    ['priority', ['low', 'medium', 'high', 'urgent'], 'medium'],
    [
      'work_type',
      ['general', 'content', 'video', 'design', 'other'],
      'general',
    ],
  ] as const) {
    if (k in body || create) {
      const v = body[k] ?? def;
      if (!options.some((x) => x === v))
        fail('VALIDATION_ERROR', 'Invalid ' + k, 400);
      out[k] = v;
    }
  }
  if ('due_at' in body || create) {
    const v = body.due_at;
    if (
      v !== undefined &&
      v !== null &&
      (typeof v !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) ||
        !Number.isFinite(Date.parse(v)))
    )
      fail('VALIDATION_ERROR', 'Invalid due_at', 400);
    out.due_at = v ?? null;
  }
  if (!create && 'status' in body && body.status !== undefined) {
    const v = body.status;
    if (
      !['todo', 'in_progress', 'in_review', 'completed', 'cancelled'].includes(
        String(v),
      )
    )
      fail('VALIDATION_ERROR', 'Invalid status', 400);
    out.status = String(v);
  }
  return out;
}
export class WorkService {
  constructor(private readonly pool: Pool) {}
  private async authorized(
    c: PoolClient,
    auth: AuthenticatedContext,
    owner: boolean,
  ): Promise<void> {
    // Lock order: global user -> binding -> membership -> session -> WORK parent -> assignment -> history -> audit.
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
      // Auth reload updates session rows; READ COMMITTED avoids stale lock snapshots.
      // The WORK namespace lock keeps all projections stable against WORK writers.
      await c.query('BEGIN');
      await this.authorized(c, auth, owner);
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('work:' || $1,0))",
        [auth.workspace.id],
      );
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
    owner: boolean,
    requestId: string,
    fn: (c: PoolClient) => Promise<T>,
  ): Promise<T> {
    if (owner) requireRole(['owner'], auth);
    if (key && !/^[\x21-\x7e]{1,128}$/.test(key))
      fail('VALIDATION_ERROR', 'Invalid Idempotency-Key', 400);
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await this.authorized(c, auth, owner);
      await c.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('work:' || $1,0))",
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
        entityType: 'work_item',
        entityId:
          typeof out === 'object' && out !== null && 'id' in out
            ? String(out.id)
            : auth.workspace.id,
        requestId,
        metadata: { operation },
      });
      if (key)
        await completeIdempotency(c, {
          workspaceId: auth.workspace.id,
          actorUserId: auth.user.id,
          operationKey,
          responseCode: ['WORK_CREATE', 'WORK_ASSIGN', 'WORK_SUBMIT'].some(
            (x) => operation.startsWith(x),
          )
            ? 201
            : 200,
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

  private async employee(c: PoolClient, auth: AuthenticatedContext) {
    const e = (
      await c.query(
        "SELECT id FROM employees WHERE workspace_id=$1 AND user_id=$2 AND employment_status='active'",
        [auth.workspace.id, auth.user.id],
      )
    ).rows[0];
    if (!e) fail('FORBIDDEN', 'Active employee required', 403);
    return e!.id as string;
  }
  private async item(
    c: PoolClient,
    auth: AuthenticatedContext,
    id: string,
    lock = false,
  ) {
    uuid(id);
    const row = (
      await c.query(
        'SELECT * FROM work_items WHERE workspace_id=$1 AND id=$2' +
          (lock ? ' FOR UPDATE' : ''),
        [auth.workspace.id, id],
      )
    ).rows[0];
    if (!row) fail('NOT_FOUND', 'Work item not found', 404);
    if (auth.workspace.role !== 'owner') {
      const employee = await this.employee(c, auth);
      if (
        !(
          await c.query(
            'SELECT id FROM work_assignments WHERE workspace_id=$1 AND work_item_id=$2 AND employee_id=$3',
            [auth.workspace.id, id, employee],
          )
        ).rowCount
      )
        fail('NOT_FOUND', 'Work item not found', 404);
    }
    return row!;
  }
  private async detail(c: PoolClient, auth: AuthenticatedContext, id: string) {
    const item = await this.item(c, auth, id);
    const employee =
      auth.workspace.role === 'owner' ? null : await this.employee(c, auth);
    const assignments = (
      await c.query(
        'SELECT a.*,e.employee_code,e.full_name FROM work_assignments a JOIN employees e ON e.workspace_id=a.workspace_id AND e.id=a.employee_id WHERE a.workspace_id=$1 AND a.work_item_id=$2 AND ($3::uuid IS NULL OR a.employee_id=$3) ORDER BY a.id',
        [auth.workspace.id, id, employee],
      )
    ).rows;
    for (const a of assignments) {
      a.schedule_links = (
        await c.query(
          `SELECT l.schedule_id,to_char(l.work_date,'YYYY-MM-DD') AS work_date,e.start_time,s.status
           FROM work_schedule_links l JOIN staff_schedules s ON s.workspace_id=l.workspace_id AND s.id=l.schedule_id
           JOIN staff_schedule_entries e ON e.workspace_id=l.workspace_id AND e.schedule_id=l.schedule_id AND e.work_date=l.work_date
           WHERE l.workspace_id=$1 AND l.assignment_id=$2 ORDER BY l.work_date`,
          [auth.workspace.id, a.id],
        )
      ).rows;
      a.submissions = (
        await c.query(
          'SELECT * FROM work_submissions WHERE workspace_id=$1 AND assignment_id=$2 ORDER BY revision_number',
          [auth.workspace.id, a.id],
        )
      ).rows;
      a.reviews = (
        await c.query(
          'SELECT * FROM work_reviews WHERE workspace_id=$1 AND assignment_id=$2 ORDER BY reviewed_at,id',
          [auth.workspace.id, a.id],
        )
      ).rows;
      a.latest_review = a.reviews.at(-1) ?? null;
    }
    return { ...item, assignments };
  }
  async get(auth: AuthenticatedContext, id: string) {
    return this.read(auth, false, (c) => this.detail(c, auth, id));
  }
  async list(auth: AuthenticatedContext, q: URLSearchParams) {
    for (const k of q.keys())
      if (
        ![
          'status',
          'priority',
          'assignee_id',
          'search',
          'schedule_id',
          'work_date',
          'limit',
        ].includes(k)
      )
        fail('VALIDATION_ERROR', 'Invalid filter', 400);
    let parsedLimit: number | null = null;
    if (q.has('limit')) {
      const rawLimit = q.get('limit') ?? '';
      if (!/^[1-9][0-9]*$/.test(rawLimit))
        fail('VALIDATION_ERROR', 'Invalid filter', 400);
      parsedLimit = Math.min(Number(rawLimit), 200);
    }
    const status = q.get('status') ?? 'all',
      priority = q.get('priority'),
      search = q.get('search') ?? '';
    if (
      ![
        'all',
        'todo',
        'in_progress',
        'in_review',
        'completed',
        'cancelled',
      ].includes(status) ||
      (priority && !['low', 'medium', 'high', 'urgent'].includes(priority)) ||
      search.length > 200
    )
      fail('VALIDATION_ERROR', 'Invalid filter', 400);
    if (q.has('assignee_id')) uuid(q.get('assignee_id'));
    if (q.has('schedule_id')) uuid(q.get('schedule_id'));
    if (q.has('work_date') && !/^\d{4}-\d{2}-\d{2}$/.test(q.get('work_date')!))
      fail('VALIDATION_ERROR', 'Invalid work date', 400);
    return this.read(auth, false, async (c) => {
      const own =
        auth.workspace.role === 'owner' ? null : await this.employee(c, auth);
      if (own && q.get('assignee_id') && q.get('assignee_id') !== own)
        fail('FORBIDDEN', 'Cannot filter other employee', 403);
      const filter = own ?? q.get('assignee_id');
      const rows = (
        await c.query(
          `SELECT w.id FROM work_items w WHERE w.workspace_id=$1 AND ($2='all' OR w.status=$2) AND ($3::text IS NULL OR w.priority=$3) AND strpos(lower(w.title),lower($4))>0 AND ($5::uuid IS NULL OR EXISTS(SELECT 1 FROM work_assignments a WHERE a.workspace_id=w.workspace_id AND a.work_item_id=w.id AND a.employee_id=$5))
           AND (($6::uuid IS NULL AND $7::date IS NULL) OR EXISTS(SELECT 1 FROM work_schedule_links l JOIN work_assignments a ON a.workspace_id=l.workspace_id AND a.id=l.assignment_id WHERE a.workspace_id=w.workspace_id AND a.work_item_id=w.id AND ($5::uuid IS NULL OR a.employee_id=$5) AND ($6::uuid IS NULL OR l.schedule_id=$6) AND ($7::date IS NULL OR l.work_date=$7)))
           ORDER BY CASE WHEN w.status IN ('completed','cancelled') THEN 1 ELSE 0 END ASC, CASE WHEN w.status NOT IN ('completed','cancelled') AND w.due_at IS NOT NULL AND w.due_at < clock_timestamp() THEN 0 ELSE 1 END ASC, CASE w.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END ASC, w.due_at ASC NULLS LAST, w.created_at DESC, w.id`,
          [
            auth.workspace.id,
            status,
            priority,
            search,
            filter,
            q.get('schedule_id'),
            q.get('work_date'),
          ],
        )
      ).rows;
      const targetRows =
        parsedLimit !== null ? rows.slice(0, parsedLimit) : rows;
      const items = [];
      for (const r of targetRows) items.push(await this.detail(c, auth, r.id));
      return { items, total: rows.length };
    });
  }
  private async assign(
    c: PoolClient,
    auth: AuthenticatedContext,
    id: string,
    employees: string[],
    stage: string,
  ) {
    for (const emp of employees) {
      const e = await c.query(
        "SELECT id FROM employees WHERE workspace_id=$1 AND id=$2 AND employment_status='active' FOR SHARE",
        [auth.workspace.id, emp],
      );
      if (!e.rowCount) fail('NOT_FOUND', 'Employee not found', 404);
      if (
        (
          await c.query(
            'SELECT id FROM work_assignments WHERE workspace_id=$1 AND work_item_id=$2 AND employee_id=$3',
            [auth.workspace.id, id, emp],
          )
        ).rowCount
      )
        fail('DUPLICATE_ASSIGNMENT', 'Employee already assigned', 409);
      await c.query(
        'INSERT INTO work_assignments(workspace_id,work_item_id,employee_id,stage,assigned_by) VALUES($1,$2,$3,$4,$5)',
        [auth.workspace.id, id, emp, stage, auth.user.id],
      );
    }
  }
  private async aggregate(
    c: PoolClient,
    auth: AuthenticatedContext,
    id: string,
  ) {
    await c.query(
      "UPDATE work_items SET status=(SELECT CASE WHEN count(*)=0 OR bool_and(status='todo') THEN 'todo' WHEN bool_and(status='completed') THEN 'completed' WHEN bool_and(status='in_review') THEN 'in_review' ELSE 'in_progress' END FROM work_assignments WHERE workspace_id=$1 AND work_item_id=$2),version=version+1,updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2",
      [auth.workspace.id, id],
    );
  }
  async create(
    auth: AuthenticatedContext,
    body: Record<string, unknown>,
    key: string | undefined,
    requestId: string,
  ) {
    fields(body, [
      'title',
      'description',
      'work_type',
      'priority',
      'due_at',
      'assignee_ids',
    ]);
    const attrs = attributes(body, true),
      employees = body.assignee_ids === undefined ? [] : ids(body.assignee_ids);
    return this.write(
      auth,
      'WORK_CREATE',
      body,
      key,
      true,
      requestId,
      async (c) => {
        const row = (
          await c.query(
            'INSERT INTO work_items(workspace_id,title,description,work_type,priority,due_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',
            [
              auth.workspace.id,
              attrs.title,
              attrs.description,
              attrs.work_type,
              attrs.priority,
              attrs.due_at,
              auth.user.id,
            ],
          )
        ).rows[0]!;
        await this.assign(c, auth, row.id, employees, 'primary');
        return this.detail(c, auth, row.id);
      },
    );
  }
  async mutate(
    auth: AuthenticatedContext,
    id: string,
    action: string,
    assignmentId: string | undefined,
    submissionId: string | undefined,
    body: Record<string, unknown>,
    match: string | undefined,
    key: string | undefined,
    requestId: string,
  ) {
    const isStaffChecklistToggle =
      action === 'edit' &&
      auth.workspace.role !== 'owner' &&
      Object.keys(body).length > 0 &&
      Object.keys(body).every((k) => k === 'description' || k === 'status') &&
      typeof body.description === 'string' &&
      (body.status === undefined || body.status === 'in_progress');
    const owner =
      ['edit', 'assign', 'review', 'cancel', 'schedule'].includes(action) &&
      !isStaffChecklistToggle;
    const allowed: Record<string, string[]> = {
      edit: [
        'title',
        'description',
        'work_type',
        'priority',
        'due_at',
        'status',
      ],
      assign: ['employee_ids', 'stage'],
      start: ['note'],
      submit: ['submission_note', 'attachments'],
      review: ['submission_id', 'decision', 'feedback'],
      cancel: ['reason'],
      schedule: ['assignment_id', 'schedule_id', 'work_date'],
    };
    fields(body, allowed[action] ?? []);
    return this.write(
      auth,
      'WORK_' + action.toUpperCase() + ':' + id + ':' + (assignmentId ?? ''),
      {
        ...body,
        if_match: match,
        ...(submissionId ? { submission_id_path: submissionId } : {}),
      },
      key,
      owner,
      requestId,
      async (c) => {
        const item = await this.item(c, auth, id, true);
        checkVersion(item.version, match);
        if (item.status === 'cancelled')
          fail('INVALID_TRANSITION', 'Work item is closed', 409);
        if (action === 'schedule') {
          if (item.status === 'completed')
            fail(
              'INVALID_TRANSITION',
              'Completed work cannot be rescheduled',
              409,
            );
          const aid = uuid(body.assignment_id);
          const date = body.work_date;
          if (
            typeof date !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
            !Number.isFinite(Date.parse(date)) ||
            new Date(date).toISOString().slice(0, 10) !== date
          )
            fail('VALIDATION_ERROR', 'Invalid work date', 400);
          const assignment = (
            await c.query(
              'SELECT employee_id FROM work_assignments WHERE workspace_id=$1 AND work_item_id=$2 AND id=$3',
              [auth.workspace.id, id, aid],
            )
          ).rows[0];
          if (!assignment) fail('NOT_FOUND', 'Assignment not found', 404);
          if (body.schedule_id === null) {
            await c.query(
              'DELETE FROM work_schedule_links WHERE workspace_id=$1 AND assignment_id=$2 AND work_date=$3',
              [auth.workspace.id, aid, date],
            );
          } else {
            const sid = uuid(body.schedule_id);
            const schedule = await c.query(
              `SELECT s.id FROM staff_schedules s JOIN staff_schedule_entries e ON e.workspace_id=s.workspace_id AND e.schedule_id=s.id JOIN employees emp ON emp.workspace_id=s.workspace_id AND emp.id=s.employee_id WHERE s.workspace_id=$1 AND s.id=$2 AND s.employee_id=$3 AND s.status='registered' AND emp.employment_status='active' AND e.work_date=$4 FOR SHARE OF s,emp`,
              [auth.workspace.id, sid, assignment.employee_id, date],
            );
            if (!schedule.rowCount)
              fail(
                'NOT_FOUND',
                'No registered shift for this assignee and date',
                404,
              );
            await c.query(
              `INSERT INTO work_schedule_links(workspace_id,assignment_id,employee_id,schedule_id,work_date,linked_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(workspace_id,assignment_id,work_date) DO UPDATE SET schedule_id=EXCLUDED.schedule_id,linked_by=EXCLUDED.linked_by,linked_at=now()`,
              [
                auth.workspace.id,
                aid,
                assignment.employee_id,
                sid,
                date,
                auth.user.id,
              ],
            );
          }
          await this.aggregate(c, auth, id);
          await recordAuditEvent(c, {
            workspaceId: auth.workspace.id,
            actorUserId: auth.user.id,
            action: 'work.schedule_link_changed',
            entityType: 'work_item',
            entityId: id,
            requestId,
            metadata: {
              assignment_id: aid,
              schedule_id: body.schedule_id,
              work_date: date,
            },
          });
        } else if (action === 'edit') {
          const attrs = attributes(body);
          if (!Object.keys(attrs).length)
            fail('VALIDATION_ERROR', 'No editable attributes', 400);
          const targetStatus =
            typeof attrs.status === 'string' ? attrs.status : undefined;
          delete attrs.status;

          if (auth.workspace.role !== 'owner' && item.status === 'completed')
            fail(
              'INVALID_TRANSITION',
              'Completed work cannot be modified',
              409,
            );
          if (auth.workspace.role !== 'owner') {
            const empId = await this.employee(c, auth);
            const assigned = await c.query(
              'SELECT 1 FROM work_assignments WHERE workspace_id=$1 AND work_item_id=$2 AND employee_id=$3',
              [auth.workspace.id, id, empId],
            );
            if (!assigned.rowCount)
              fail('FORBIDDEN', 'Not assigned to this work item', 403);
          }
          if (targetStatus === 'in_progress') {
            if (auth.workspace.role === 'owner') {
              await c.query(
                "UPDATE work_assignments SET status='in_progress' WHERE workspace_id=$1 AND work_item_id=$2 AND status='todo'",
                [auth.workspace.id, id],
              );
            } else {
              const empId = await this.employee(c, auth);
              await c.query(
                "UPDATE work_assignments SET status='in_progress' WHERE workspace_id=$1 AND work_item_id=$2 AND employee_id=$3 AND status='todo'",
                [auth.workspace.id, id, empId],
              );
            }
          } else if (
            targetStatus === 'completed' &&
            item.status !== 'completed'
          ) {
            let assigns = (
              await c.query(
                'SELECT a.id, a.status, a.employee_id, e.user_id AS emp_user_id FROM work_assignments a JOIN employees e ON e.workspace_id=a.workspace_id AND e.id=a.employee_id WHERE a.workspace_id=$1 AND a.work_item_id=$2 FOR UPDATE OF a',
                [auth.workspace.id, id],
              )
            ).rows;
            if (assigns.length === 0) {
              const ownerEmp = (
                await c.query(
                  "SELECT id, user_id FROM employees WHERE workspace_id=$1 AND user_id=$2 AND employment_status='active' LIMIT 1",
                  [auth.workspace.id, auth.user.id],
                )
              ).rows[0];
              if (ownerEmp?.id) {
                await c.query(
                  'INSERT INTO work_assignments(workspace_id,work_item_id,employee_id,stage,assigned_by) VALUES($1,$2,$3,$4,$5)',
                  [auth.workspace.id, id, ownerEmp.id, 'primary', auth.user.id],
                );
                assigns = (
                  await c.query(
                    'SELECT a.id, a.status, a.employee_id, e.user_id AS emp_user_id FROM work_assignments a JOIN employees e ON e.workspace_id=a.workspace_id AND e.id=a.employee_id WHERE a.workspace_id=$1 AND a.work_item_id=$2 FOR UPDATE OF a',
                    [auth.workspace.id, id],
                  )
                ).rows;
              }
            }
            for (const a of assigns) {
              if (a.status === 'completed') continue;
              const submitterUserId = a.emp_user_id ?? auth.user.id;
              if (a.status === 'todo') {
                await c.query(
                  "UPDATE work_assignments SET status='in_progress' WHERE workspace_id=$1 AND id=$2",
                  [auth.workspace.id, a.id],
                );
              }
              if (a.status === 'todo' || a.status === 'in_progress') {
                await c.query(
                  'INSERT INTO work_submissions(workspace_id,work_item_id,assignment_id,revision_number,submission_note,attachments,submitted_by) SELECT $1,$2,$3,coalesce(max(revision_number),0)+1,$4,$5,$6 FROM work_submissions WHERE workspace_id=$1 AND assignment_id=$3',
                  [
                    auth.workspace.id,
                    id,
                    a.id,
                    'Đã hoàn thành (Xác nhận bởi Chủ sở hữu / Đồng bộ AI Work Atlas)',
                    '[]',
                    submitterUserId,
                  ],
                );
                await c.query(
                  "UPDATE work_assignments SET status='in_review' WHERE workspace_id=$1 AND id=$2",
                  [auth.workspace.id, a.id],
                );
              }
              const latestSub = (
                await c.query(
                  'SELECT id FROM work_submissions WHERE workspace_id=$1 AND work_item_id=$2 AND assignment_id=$3 ORDER BY revision_number DESC LIMIT 1',
                  [auth.workspace.id, id, a.id],
                )
              ).rows[0];
              if (latestSub?.id) {
                await c.query(
                  'INSERT INTO work_reviews(workspace_id,work_item_id,assignment_id,submission_id,reviewer_user_id,decision,feedback) VALUES($1,$2,$3,$4,$5,$6,$7)',
                  [
                    auth.workspace.id,
                    id,
                    a.id,
                    latestSub.id,
                    auth.user.id,
                    'approved',
                    'Đã nghiệm thu hoàn thành',
                  ],
                );
                await c.query(
                  "UPDATE work_assignments SET status='completed' WHERE workspace_id=$1 AND id=$2",
                  [auth.workspace.id, a.id],
                );
              }
            }
          }

          const columns = Object.keys(attrs);
          const setClauses = columns.map((x, i) => x + '=$' + (i + 3));
          if (targetStatus === 'cancelled') {
            setClauses.push("status='cancelled'");
          } else if (targetStatus) {
            setClauses.push(
              "status=(SELECT CASE WHEN count(*)=0 OR bool_and(status='todo') THEN 'todo' WHEN bool_and(status='completed') THEN 'completed' WHEN bool_and(status='in_review') THEN 'in_review' ELSE 'in_progress' END FROM work_assignments WHERE workspace_id=$1 AND work_item_id=$2)",
            );
          }
          await c.query(
            'UPDATE work_items SET ' +
              setClauses.join(',') +
              ',version=version+1,updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2',
            [auth.workspace.id, id, ...Object.values(attrs)],
          );
        } else if (action === 'assign') {
          await this.assign(
            c,
            auth,
            id,
            ids(body.employee_ids),
            body.stage === undefined ? 'primary' : text(body.stage, 100, true)!,
          );
          await this.aggregate(c, auth, id);
        } else if (action === 'cancel') {
          text(body.reason, 2000);
          await c.query(
            "UPDATE work_items SET status='cancelled',version=version+1,updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2",
            [auth.workspace.id, id],
          );
        } else {
          uuid(assignmentId);
          const a = (
            await c.query(
              'SELECT * FROM work_assignments WHERE workspace_id=$1 AND work_item_id=$2 AND id=$3 FOR UPDATE',
              [auth.workspace.id, id, assignmentId],
            )
          ).rows[0];
          if (!a) fail('NOT_FOUND', 'Assignment not found', 404);
          if (action === 'submit' || auth.workspace.role !== 'owner') {
            if (a!.employee_id !== (await this.employee(c, auth)))
              fail('FORBIDDEN', 'Assignment does not belong to actor', 403);
          }
          let next: string;
          if (action === 'start') {
            text(body.note, 2000);
            if (a!.status !== 'todo')
              fail('INVALID_TRANSITION', 'Assignment already started');
            next = 'in_progress';
          } else if (action === 'submit') {
            if (a!.status !== 'in_progress')
              fail('INVALID_TRANSITION', 'Assignment is not in progress');
            const note = text(body.submission_note, 20000, true);
            const attachments = body.attachments ?? [];
            if (!Array.isArray(attachments) || attachments.length > 20)
              fail('VALIDATION_ERROR', 'Invalid attachments', 400);
            for (const value of attachments as unknown[]) {
              const v = value as Record<string, unknown>;
              if (!v || typeof v !== 'object' || Array.isArray(v))
                fail('VALIDATION_ERROR', 'Invalid attachment', 400);
              fields(v as Record<string, unknown>, ['name', 'url']);
              text(v.name, 200, true);
              const link = text(v.url, 2000, true);
              try {
                const url = new URL(link!);
                if (url.protocol !== 'https:' || url.username || url.password)
                  throw Error();
              } catch {
                fail(
                  'VALIDATION_ERROR',
                  'Attachment must be HTTPS without credentials',
                  400,
                );
              }
            }
            await c.query(
              'INSERT INTO work_submissions(workspace_id,work_item_id,assignment_id,revision_number,submission_note,attachments,submitted_by) SELECT $1,$2,$3,coalesce(max(revision_number),0)+1,$4,$5,$6 FROM work_submissions WHERE workspace_id=$1 AND assignment_id=$3',
              [
                auth.workspace.id,
                id,
                assignmentId,
                note,
                JSON.stringify(attachments),
                auth.user.id,
              ],
            );
            next = 'in_review';
          } else {
            const sid = uuid(submissionId ?? body.submission_id);
            if (
              submissionId &&
              body.submission_id !== undefined &&
              body.submission_id !== sid
            )
              fail('VALIDATION_ERROR', 'Submission identifiers mismatch', 400);
            if (
              !['approved', 'request_changes'].includes(String(body.decision))
            )
              fail('VALIDATION_ERROR', 'Invalid decision', 400);
            const feedback = text(
              body.feedback,
              20000,
              body.decision === 'request_changes',
            );
            const latest = (
              await c.query(
                'SELECT id FROM work_submissions WHERE workspace_id=$1 AND work_item_id=$2 AND assignment_id=$3 ORDER BY revision_number DESC LIMIT 1',
                [auth.workspace.id, id, assignmentId],
              )
            ).rows[0];
            if (a!.status !== 'in_review' || latest?.id !== sid)
              fail(
                'INVALID_TRANSITION',
                'Only latest pending submission can be reviewed',
              );
            await c.query(
              'INSERT INTO work_reviews(workspace_id,work_item_id,assignment_id,submission_id,reviewer_user_id,decision,feedback) VALUES($1,$2,$3,$4,$5,$6,$7)',
              [
                auth.workspace.id,
                id,
                assignmentId,
                sid,
                auth.user.id,
                body.decision,
                feedback,
              ],
            );
            next = body.decision === 'approved' ? 'completed' : 'in_progress';
          }
          await c.query(
            'UPDATE work_assignments SET status=$1 WHERE workspace_id=$2 AND work_item_id=$3 AND id=$4',
            [next, auth.workspace.id, id, assignmentId],
          );
          await this.aggregate(c, auth, id);
        }
        return this.detail(c, auth, id);
      },
    );
  }
}
