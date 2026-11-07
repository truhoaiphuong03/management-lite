import type { DatabasePool } from '../../../../packages/database/src/pool.js';
import { recordAuditEvent } from '../../../../packages/database/src/audit.js';
import {
  generateCsprngToken,
  hashToken,
} from '../../../../packages/security/src/tokens.js';
import { AuthError, type AuthenticatedContext } from '../auth/service.js';
import { requireRole } from '../auth/guard.js';
import {
  normalizeDateOfBirth,
  normalizeBankAccountNumber,
} from './profile-validator.js';
import type {
  EmployeeData,
  EmployeeMemberRole,
  EmployeeSubPermission,
  CreateEmployeeRequestBody,
  CreateEmployeeResponseData,
  UpdateEmployeeRequestBody,
  ActivationStatusResponseData,
} from '../../../../packages/contracts/src/employees.js';

export const ALL_SUB_PERMISSIONS: readonly EmployeeSubPermission[] = [
  'attendance:review',
  'work:manage',
  'employees:manage',
  'accounts:manage',
  'payroll:manage',
  'finance:manage',
] as const;

export const DEFAULT_ADMIN_SUB_PERMISSIONS: readonly EmployeeSubPermission[] = [
  'attendance:review',
  'work:manage',
  'employees:manage',
  'accounts:manage',
] as const;

export function parseEmployeeSubPermissions(
  raw: unknown,
): EmployeeSubPermission[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  const seen = new Set<EmployeeSubPermission>();
  for (const item of list) {
    if (
      typeof item === 'string' &&
      (ALL_SUB_PERMISSIONS as readonly string[]).includes(item)
    ) {
      seen.add(item as EmployeeSubPermission);
    }
  }
  return Array.from(seen);
}

function resolveEmployeeRoleAndPermissions(row: {
  user_role?: string | null | undefined;
  employee_code: string;
  sub_role?: string | null | undefined;
  sub_permissions?: unknown;
}): {
  role: EmployeeMemberRole;
  sub_permissions: EmployeeSubPermission[];
} {
  if (row.user_role === 'owner' || row.employee_code === 'OWNER') {
    return {
      role: 'owner',
      sub_permissions: [...ALL_SUB_PERMISSIONS],
    };
  }
  const parsedPerms = parseEmployeeSubPermissions(row.sub_permissions);
  if (row.sub_role === 'admin') {
    return {
      role: 'admin',
      sub_permissions:
        parsedPerms.length > 0 || Array.isArray(row.sub_permissions)
          ? parsedPerms
          : [...DEFAULT_ADMIN_SUB_PERMISSIONS],
    };
  }
  return {
    role: 'staff',
    sub_permissions: parsedPerms,
  };
}

export class EmployeeService {
  constructor(private readonly pool: DatabasePool) {}

  /**
   * Helper: Validates and parses employee cursor.
   * Format: base64url JSON { created_at: string, id: string }
   * Preserves full PostgreSQL microsecond timestamp precision and UUID tie-break.
   */
  private parseEmployeeCursor(cursor: string): {
    created_at: string;
    id: string;
  } {
    try {
      const decodedStr = Buffer.from(cursor, 'base64url').toString('utf8');
      const decoded = JSON.parse(decodedStr);
      if (
        !decoded ||
        typeof decoded !== 'object' ||
        typeof decoded.created_at !== 'string' ||
        typeof decoded.id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          decoded.id,
        )
      ) {
        throw new Error('Malformed employee cursor structure');
      }

      const tsTrimmed = decoded.created_at.trim();
      // Validate ISO 8601 timestamp with optional fractional seconds (up to microseconds) and timezone
      if (
        !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)?$/.test(
          tsTrimmed,
        )
      ) {
        throw new Error('Invalid timestamp format');
      }

      // Validate real calendar date (reject e.g. 2026-02-31 or 2026-13-40)
      const datePart = tsTrimmed.slice(0, 10);
      const [yearStr, monthStr, dayStr] = datePart.split('-');
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

      const parsedMs = Date.parse(tsTrimmed);
      if (isNaN(parsedMs) || parsedMs < 0 || parsedMs > 4102444800000) {
        throw new Error('Timestamp value out of valid range');
      }

      return {
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
   * Computes the next sequential employee code (e.g. NV001, NV002) for the active workspace.
   * Owner only.
   */
  async getNextEmployeeCode(
    context: AuthenticatedContext,
  ): Promise<{ next_employee_code: string }> {
    requireRole(['owner'], context);
    const countRes = await this.pool.query<{ max_num: number | null }>(
      `SELECT COALESCE(MAX(SUBSTRING(employee_code FROM '^NV([0-9]+)$')::integer), 0) AS max_num
       FROM employees
       WHERE workspace_id = $1 AND employee_code ~ '^NV[0-9]+$';`,
      [context.workspace.id],
    );
    const nextNum = (countRes.rows[0]?.max_num || 0) + 1;
    return {
      next_employee_code: `NV${String(nextNum).padStart(3, '0')}`,
    };
  }

  /**
   * Lists employees for the active workspace.
   * Owner only. Redacted list per doc 25.
   */
  async listEmployees(
    context: AuthenticatedContext,
    options: {
      status?: string | undefined;
      limit?: number | undefined;
      cursor?: string | undefined;
    } = {},
  ): Promise<{ items: EmployeeData[]; next_cursor: string | null }> {
    requireRole(['owner'], context);

    const limit = Math.min(Math.max(Number(options.limit) || 20, 1), 50);
    const conditions: string[] = ['e.workspace_id = $1'];
    const params: unknown[] = [context.workspace.id];

    if (options.status) {
      params.push(options.status);
      conditions.push(`e.employment_status = $${params.length}`);
    }

    if (options.cursor) {
      const parsedCursor = this.parseEmployeeCursor(options.cursor);
      params.push(parsedCursor.created_at, parsedCursor.id);
      conditions.push(
        `(e.created_at, e.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }

    params.push(limit + 1);
    const limitPlaceholder = `$${params.length}`;

    const query = `
      SELECT
        e.id,
        e.workspace_id,
        e.user_id,
        e.employee_code,
        e.full_name,
        e.employment_status,
        e.is_payroll_eligible,
        e.version,
        e.created_at,
        to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_cursor,
        e.updated_at,
        u.username_normalized AS user_username,
        u.email_normalized AS user_email,
        u.status AS user_status,
        wm.role AS user_role,
        to_jsonb(e) ->> 'phone' AS phone,
        to_jsonb(e) ->> 'date_of_birth' AS date_of_birth,
        to_jsonb(e) ->> 'gender' AS gender,
        to_jsonb(e) ->> 'national_id' AS national_id,
        to_jsonb(e) ->> 'address' AS address,
        to_jsonb(e) ->> 'position_title' AS position_title,
        to_jsonb(e) ->> 'emergency_contact' AS emergency_contact,
        to_jsonb(e) ->> 'bank_name' AS bank_name,
        to_jsonb(e) ->> 'bank_account_number' AS bank_account_number,
        to_jsonb(e) ->> 'bank_account_holder' AS bank_account_holder,
        to_jsonb(e) ->> 'sub_role' AS sub_role,
        to_jsonb(e) -> 'sub_permissions' AS sub_permissions
      FROM employees e
      LEFT JOIN users u ON u.id = e.user_id
      LEFT JOIN workspace_memberships wm ON wm.workspace_id = e.workspace_id AND wm.user_id = e.user_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT ${limitPlaceholder};
    `;

    const res = await this.pool.query<{
      id: string;
      workspace_id: string;
      user_id: string | null;
      employee_code: string;
      full_name: string;
      employment_status: string;
      is_payroll_eligible: boolean;
      version: number;
      created_at: Date;
      created_at_cursor: string;
      updated_at: Date;
      user_username: string | null;
      user_email: string | null;
      user_status: string | null;
      user_role?: string | null;
      phone?: string | null;
      date_of_birth?: string | null;
      gender?: string | null;
      national_id?: string | null;
      address?: string | null;
      position_title?: string | null;
      emergency_contact?: string | null;
      bank_name?: string | null;
      bank_account_number?: string | null;
      bank_account_holder?: string | null;
      sub_role?: string | null;
      sub_permissions?: unknown;
    }>(query, params);

    const rows = res.rows;
    let nextCursor: string | null = null;
    if (rows.length > limit) {
      rows.pop();
      const last = rows[rows.length - 1];
      if (last) {
        nextCursor = Buffer.from(
          JSON.stringify({
            created_at: last.created_at_cursor,
            id: last.id,
          }),
        ).toString('base64url');
      }
    }

    const items: EmployeeData[] = rows.map((r) => {
      const { role: resolvedRole, sub_permissions: resolvedSubPermissions } =
        resolveEmployeeRoleAndPermissions(r);
      return {
        id: r.id,
        workspace_id: r.workspace_id,
        user_id: r.user_id,
        employee_code: r.employee_code,
        full_name: r.full_name,
        role: resolvedRole,
        sub_permissions: resolvedSubPermissions,
        phone: r.phone ?? null,
        date_of_birth: r.date_of_birth ?? null,
        gender: r.gender ?? null,
        national_id: r.national_id ?? null,
        address: r.address ?? null,
        position_title: r.position_title ?? null,
        emergency_contact: r.emergency_contact ?? null,
        bank_name: r.bank_name ?? null,
        bank_account_number: r.bank_account_number ?? null,
        bank_account_holder: r.bank_account_holder ?? null,
        employment_status:
          r.employment_status as EmployeeData['employment_status'],
        is_payroll_eligible: r.is_payroll_eligible,
        version: r.version,
        created_at: r.created_at.toISOString(),
        updated_at: r.updated_at.toISOString(),
        user: r.user_id
          ? {
              id: r.user_id,
              username: r.user_username || '',
              email: r.user_email || '',
              status: r.user_status || '',
              role: resolvedRole,
              sub_permissions: resolvedSubPermissions,
            }
          : null,
      };
    });

    return { items, next_cursor: nextCursor };
  }

  /**
   * Retrieves single employee profile.
   * Accessible by Owner or the employee themselves. Staff cannot see other employees (404 concealed per doc 04/24).
   */
  async getEmployeeById(
    context: AuthenticatedContext,
    employeeId: string,
  ): Promise<EmployeeData> {
    const res = await this.pool.query<{
      id: string;
      workspace_id: string;
      user_id: string | null;
      employee_code: string;
      full_name: string;
      employment_status: string;
      is_payroll_eligible: boolean;
      version: number;
      created_at: Date;
      updated_at: Date;
      user_username: string | null;
      user_email: string | null;
      user_status: string | null;
      user_role?: string | null;
      phone?: string | null;
      date_of_birth?: string | null;
      gender?: string | null;
      national_id?: string | null;
      address?: string | null;
      position_title?: string | null;
      emergency_contact?: string | null;
      bank_name?: string | null;
      bank_account_number?: string | null;
      bank_account_holder?: string | null;
      sub_role?: string | null;
      sub_permissions?: unknown;
    }>(
      `
      SELECT
        e.id,
        e.workspace_id,
        e.user_id,
        e.employee_code,
        e.full_name,
        e.employment_status,
        e.is_payroll_eligible,
        e.version,
        e.created_at,
        e.updated_at,
        u.username_normalized AS user_username,
        u.email_normalized AS user_email,
        u.status AS user_status,
        wm.role AS user_role,
        to_jsonb(e) ->> 'phone' AS phone,
        to_jsonb(e) ->> 'date_of_birth' AS date_of_birth,
        to_jsonb(e) ->> 'gender' AS gender,
        to_jsonb(e) ->> 'national_id' AS national_id,
        to_jsonb(e) ->> 'address' AS address,
        to_jsonb(e) ->> 'position_title' AS position_title,
        to_jsonb(e) ->> 'emergency_contact' AS emergency_contact,
        to_jsonb(e) ->> 'bank_name' AS bank_name,
        to_jsonb(e) ->> 'bank_account_number' AS bank_account_number,
        to_jsonb(e) ->> 'bank_account_holder' AS bank_account_holder,
        to_jsonb(e) ->> 'sub_role' AS sub_role,
        to_jsonb(e) -> 'sub_permissions' AS sub_permissions
      FROM employees e
      LEFT JOIN users u ON u.id = e.user_id
      LEFT JOIN workspace_memberships wm ON wm.workspace_id = e.workspace_id AND wm.user_id = e.user_id
      WHERE e.workspace_id = $1 AND e.id = $2;
    `,
      [context.workspace.id, employeeId],
    );

    const row = res.rows[0];
    if (!row) {
      throw new AuthError('NOT_FOUND', 'Employee not found', 404);
    }

    // Role check: Owner or self
    if (context.workspace.role !== 'owner' && row.user_id !== context.user.id) {
      throw new AuthError('NOT_FOUND', 'Employee not found', 404);
    }

    const { role: resolvedRole, sub_permissions: resolvedSubPermissions } =
      resolveEmployeeRoleAndPermissions(row);

    return {
      id: row.id,
      workspace_id: row.workspace_id,
      user_id: row.user_id,
      employee_code: row.employee_code,
      full_name: row.full_name,
      role: resolvedRole,
      sub_permissions: resolvedSubPermissions,
      phone: row.phone ?? null,
      date_of_birth: row.date_of_birth ?? null,
      gender: row.gender ?? null,
      national_id: row.national_id ?? null,
      address: row.address ?? null,
      position_title: row.position_title ?? null,
      emergency_contact: row.emergency_contact ?? null,
      bank_name: row.bank_name ?? null,
      bank_account_number: row.bank_account_number ?? null,
      bank_account_holder: row.bank_account_holder ?? null,
      employment_status:
        row.employment_status as EmployeeData['employment_status'],
      is_payroll_eligible: row.is_payroll_eligible,
      version: row.version,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      user: row.user_id
        ? {
            id: row.user_id,
            username: row.user_username || '',
            email: row.user_email || '',
            status: row.user_status || '',
            role: resolvedRole,
            sub_permissions: resolvedSubPermissions,
          }
        : null,
    };
  }

  /**
   * Retrieves authenticated staff's own employee profile.
   */
  async getEmployeeMe(context: AuthenticatedContext): Promise<EmployeeData> {
    const res = await this.pool.query<{
      id: string;
      workspace_id: string;
      user_id: string | null;
      employee_code: string;
      full_name: string;
      employment_status: string;
      is_payroll_eligible: boolean;
      version: number;
      created_at: Date;
      updated_at: Date;
      user_username: string | null;
      user_email: string | null;
      user_status: string | null;
      user_role?: string | null;
      phone: string | null;
      date_of_birth?: string | null;
      gender?: string | null;
      national_id?: string | null;
      address?: string | null;
      position_title?: string | null;
      emergency_contact?: string | null;
      bank_name?: string | null;
      bank_account_number?: string | null;
      bank_account_holder?: string | null;
      sub_role?: string | null;
      sub_permissions?: unknown;
      user_email_verified: boolean | null;
    }>(
      `
      SELECT
        e.id,
        e.workspace_id,
        e.user_id,
        e.employee_code,
        e.full_name,
        e.employment_status,
        e.is_payroll_eligible,
        e.version,
        e.created_at,
        e.updated_at,
        u.username_normalized AS user_username,
        u.email_normalized AS user_email,
        u.status AS user_status,
        wm.role AS user_role,
        to_jsonb(e) ->> 'phone' AS phone,
        to_jsonb(e) ->> 'date_of_birth' AS date_of_birth,
        to_jsonb(e) ->> 'gender' AS gender,
        to_jsonb(e) ->> 'national_id' AS national_id,
        to_jsonb(e) ->> 'address' AS address,
        to_jsonb(e) ->> 'position_title' AS position_title,
        to_jsonb(e) ->> 'emergency_contact' AS emergency_contact,
        to_jsonb(e) ->> 'bank_name' AS bank_name,
        to_jsonb(e) ->> 'bank_account_number' AS bank_account_number,
        to_jsonb(e) ->> 'bank_account_holder' AS bank_account_holder,
        to_jsonb(e) ->> 'sub_role' AS sub_role,
        to_jsonb(e) -> 'sub_permissions' AS sub_permissions,
        u.email_verified AS user_email_verified
      FROM employees e
      LEFT JOIN users u ON u.id = e.user_id
      LEFT JOIN workspace_memberships wm ON wm.workspace_id = e.workspace_id AND wm.user_id = e.user_id
      WHERE e.workspace_id = $1 AND e.user_id = $2;
    `,
      [context.workspace.id, context.user.id],
    );

    const row = res.rows[0];
    if (!row) {
      throw new AuthError(
        'NOT_FOUND',
        'Employee profile not found for active user',
        404,
      );
    }

    const { role: resolvedRole, sub_permissions: resolvedSubPermissions } =
      resolveEmployeeRoleAndPermissions(row);

    return {
      id: row.id,
      workspace_id: row.workspace_id,
      user_id: row.user_id,
      employee_code: row.employee_code,
      full_name: row.full_name,
      role: resolvedRole,
      sub_permissions: resolvedSubPermissions,
      phone: row.phone ?? null,
      date_of_birth: row.date_of_birth ?? null,
      gender: row.gender ?? null,
      national_id: row.national_id ?? null,
      address: row.address ?? null,
      position_title: row.position_title ?? null,
      emergency_contact: row.emergency_contact ?? null,
      bank_name: row.bank_name ?? null,
      bank_account_number: row.bank_account_number ?? null,
      bank_account_holder: row.bank_account_holder ?? null,
      employment_status:
        row.employment_status as EmployeeData['employment_status'],
      is_payroll_eligible: row.is_payroll_eligible,
      version: row.version,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      user: row.user_id
        ? {
            id: row.user_id,
            username: row.user_username || '',
            email: row.user_email || '',
            status: row.user_status || '',
            role: resolvedRole,
            sub_permissions: resolvedSubPermissions,
            email_verified: Boolean(row.user_email_verified),
          }
        : null,
    };
  }

  /**
   * Creates a new employee with an invitation.
   * Owner only. Atomic transaction. Generates single-use activation invite token.
   */
  async createEmployee(
    context: AuthenticatedContext,
    body: CreateEmployeeRequestBody,
    requestId: string,
  ): Promise<CreateEmployeeResponseData> {
    requireRole(['owner'], context);

    let code = (body.employee_code || '').trim();
    const fullName = (body.full_name || '').trim();
    const email = (body.email || '').trim().toLowerCase();
    const username = (
      body.username ||
      email.split('@')[0] ||
      (code ? code.toLowerCase() : 'staff')
    )
      .trim()
      .toLowerCase();

    if (!fullName) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Họ và tên không được để trống',
        400,
        [{ field: 'full_name', message: 'Họ tên bắt buộc' }],
      );
    }
    if (!email || !email.includes('@')) {
      throw new AuthError('VALIDATION_ERROR', 'Email không hợp lệ', 400, [
        { field: 'email', message: 'Email không đúng định dạng' },
      ]);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Auto-generate or check unique employee_code in workspace
      if (!code) {
        // Prevent concurrent MAX + 1 race conditions using transaction-scoped advisory lock per workspace
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext('emp_code_' || $1));`,
          [context.workspace.id],
        );

        const countRes = await client.query<{ max_num: number | null }>(
          `SELECT COALESCE(MAX(SUBSTRING(employee_code FROM '^NV([0-9]+)$')::integer), 0) AS max_num
           FROM employees
           WHERE workspace_id = $1 AND employee_code ~ '^NV[0-9]+$';`,
          [context.workspace.id],
        );
        const nextNum = (countRes.rows[0]?.max_num || 0) + 1;
        code = `NV${String(nextNum).padStart(3, '0')}`;
      } else {
        const existingCode = await client.query(
          `SELECT id FROM employees WHERE workspace_id = $1 AND employee_code = $2 FOR UPDATE;`,
          [context.workspace.id, code],
        );
        if (existingCode.rows.length > 0) {
          throw new AuthError(
            'CONFLICT',
            `Mã nhân viên "${code}" đã tồn tại trong workspace này`,
            409,
          );
        }
      }

      // 2. Check / Create User
      let userId: string;
      const existingUser = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE email_normalized = $1 OR username_normalized = $2 FOR UPDATE;`,
        [email, username],
      );

      if (existingUser.rows.length > 0) {
        userId = existingUser.rows[0]!.id;

        // Check if user already member in this workspace
        const existingMembership = await client.query(
          `SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2;`,
          [context.workspace.id, userId],
        );
        if (existingMembership.rows.length > 0) {
          throw new AuthError(
            'CONFLICT',
            'Người dùng với email này đã là thành viên của cửa hàng',
            409,
          );
        }
      } else {
        const userInsert = await client.query<{ id: string }>(
          `INSERT INTO users (username_normalized, email_normalized, status) VALUES ($1, $2, 'pending_activation') RETURNING id;`,
          [username, email],
        );
        userId = userInsert.rows[0]!.id;
      }

      if (body.role && body.role !== 'staff') {
        throw new AuthError(
          'NOT_IMPLEMENTED',
          'Chức năng phân quyền admin khi tạo nhân viên chưa được hỗ trợ trong baseline CP2.2 do ràng buộc cơ sở dữ liệu workspace_memberships_role_check chỉ chấp nhận owner hoặc staff. Cần phê duyệt migration từ Owner.',
          400,
        );
      }

      // 3. Insert workspace_membership with staff role (only owner/staff supported in CP2.2)
      const memberRole = 'staff';
      await client.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'invited')
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = $3, status = 'invited';`,
        [context.workspace.id, userId, memberRole],
      );

      // 4. Insert user_workspace_binding
      await client.query(
        `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version) VALUES ($1, $2, 'active', 1)
         ON CONFLICT (user_id) WHERE status = 'active' DO UPDATE SET workspace_id = $1, status = 'active';`,
        [context.workspace.id, userId],
      );

      // 5. Insert employee
      const empRes = await client.query<{ id: string; version: number }>(
        `
        INSERT INTO employees (
          workspace_id, user_id, employee_code, full_name, employment_status, is_payroll_eligible, version
        ) VALUES (
          $1, $2, $3, $4, 'invited', true, 1
        ) RETURNING id, version;
      `,
        [context.workspace.id, userId, code, fullName],
      );
      const employeeId = empRes.rows[0]!.id;
      const extraCols = [
        'phone',
        'date_of_birth',
        'gender',
        'national_id',
        'address',
        'position_title',
        'emergency_contact',
        'bank_name',
        'bank_account_number',
        'bank_account_holder',
      ] as const;
      const createSets: string[] = [];
      const createVals: unknown[] = [];
      for (const col of extraCols) {
        const raw = body[col];
        if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
          const normalizedVal =
            col === 'date_of_birth'
              ? normalizeDateOfBirth(String(raw))
              : col === 'bank_account_number'
                ? normalizeBankAccountNumber(String(raw))
                : String(raw).trim();
          if (normalizedVal !== null) {
            createVals.push(normalizedVal);
            createSets.push(`${col} = $${createVals.length}`);
          }
        }
      }
      if (createSets.length > 0) {
        createVals.push(context.workspace.id, employeeId);
        await client.query(
          `UPDATE employees SET ${createSets.join(', ')} WHERE workspace_id = $${createVals.length - 1} AND id = $${createVals.length};`,
          createVals,
        );
      }

      // 6. Generate activation invite token (CSPRNG 32 bytes)
      const rawToken = generateCsprngToken(32);
      const tokenHash = hashToken(rawToken);

      // Invalidate any previous invites for this user in this workspace
      await client.query(
        `UPDATE activation_invites SET status = 'revoked', revoked_at = now() WHERE workspace_id = $1 AND user_id = $2 AND status = 'issued';`,
        [context.workspace.id, userId],
      );

      // Insert new invite
      await client.query(
        `
        INSERT INTO activation_invites (
          workspace_id, user_id, token_hash, token_version, status, expires_at
        ) VALUES (
          $1, $2, $3, 1, 'issued', now() + interval '24 hours'
        );
      `,
        [context.workspace.id, userId, tokenHash],
      );

      // 7. Audit Event
      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'employee.created',
        entityType: 'employee',
        entityId: employeeId,
        requestId,
        metadata: {
          employee_code: code,
          full_name: fullName,
          user_id: userId,
        },
      });

      await client.query('COMMIT');

      return {
        id: employeeId,
        user_id: userId,
        employee_code: code,
        full_name: fullName,
        employment_status: 'invited',
        version: 1,
        invite_token: rawToken,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Updates an employee profile (e.g. full_name, is_payroll_eligible).
   * Owner only. Concurrency guarded with If-Match (428 missing, 412 stale).
   */
  async updateEmployee(
    context: AuthenticatedContext,
    employeeId: string,
    body: UpdateEmployeeRequestBody,
    ifMatch: string | undefined,
    requestId: string,
  ): Promise<EmployeeData> {
    requireRole(['owner'], context);

    if (ifMatch === undefined || ifMatch === null || ifMatch.trim() === '') {
      throw new AuthError(
        'PRECONDITION_REQUIRED',
        'If-Match header is required for employee update',
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

    if (
      body.role !== undefined &&
      body.role !== 'owner' &&
      body.role !== 'admin' &&
      body.role !== 'staff'
    ) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Vai trò phân quyền không hợp lệ (chỉ chấp nhận owner, admin hoặc staff)',
        400,
        [{ field: 'role', message: 'Vai trò không hợp lệ' }],
      );
    }

    let validatedBodySubPermissions: EmployeeSubPermission[] | undefined;
    if (body.sub_permissions !== undefined) {
      if (!Array.isArray(body.sub_permissions)) {
        throw new AuthError(
          'VALIDATION_ERROR',
          'Danh sách quyền phụ (sub_permissions) phải là mảng',
          400,
          [
            {
              field: 'sub_permissions',
              message: 'sub_permissions phải là mảng',
            },
          ],
        );
      }
      const seen = new Set<EmployeeSubPermission>();
      for (const perm of body.sub_permissions) {
        if (
          typeof perm !== 'string' ||
          !(ALL_SUB_PERMISSIONS as readonly string[]).includes(perm)
        ) {
          throw new AuthError(
            'VALIDATION_ERROR',
            `Quyền phụ không hợp lệ: "${String(perm)}"`,
            400,
            [{ field: 'sub_permissions', message: 'Quyền phụ không hợp lệ' }],
          );
        }
        seen.add(perm as EmployeeSubPermission);
      }
      validatedBodySubPermissions = Array.from(seen);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      if (body.role !== undefined || body.sub_permissions !== undefined) {
        await client.query(
          `SELECT id FROM workspaces WHERE id = $1 FOR UPDATE;`,
          [context.workspace.id],
        );
      }

      const empRes = await client.query<{
        id: string;
        version: number;
        full_name: string;
        is_payroll_eligible: boolean;
        user_id: string | null;
        employee_code: string;
        sub_role?: string | null;
        sub_permissions?: unknown;
      }>(
        `SELECT
           id,
           version,
           full_name,
           is_payroll_eligible,
           user_id,
           employee_code,
           to_jsonb(employees) ->> 'sub_role' AS sub_role,
           to_jsonb(employees) -> 'sub_permissions' AS sub_permissions
         FROM employees
         WHERE workspace_id = $1 AND id = $2
         FOR UPDATE;`,
        [context.workspace.id, employeeId],
      );

      const emp = empRes.rows[0];
      if (!emp) {
        throw new AuthError('NOT_FOUND', 'Employee not found', 404);
      }

      if (emp.version !== expectedVersion) {
        throw new AuthError(
          'PRECONDITION_FAILED',
          `Stale employee version. Expected ${expectedVersion}, found ${emp.version}`,
          412,
        );
      }

      let previousRole: EmployeeMemberRole | undefined;
      let nextSubRoleToSave: EmployeeMemberRole | undefined;
      let nextSubPermissionsToSave: EmployeeSubPermission[] | undefined;
      let roleChanged = false;
      let subPermissionsChanged = false;

      if (
        body.role !== undefined ||
        validatedBodySubPermissions !== undefined
      ) {
        if (!emp.user_id) {
          if (
            body.role &&
            body.role !== 'staff' &&
            emp.employee_code !== 'OWNER'
          ) {
            throw new AuthError(
              'VALIDATION_ERROR',
              'Nhân viên chưa có tài khoản đăng nhập liên kết để phân quyền',
              400,
              [
                {
                  field: 'role',
                  message: 'Chưa liên kết tài khoản người dùng',
                },
              ],
            );
          }
          const existingResolved = resolveEmployeeRoleAndPermissions({
            user_role: 'staff',
            employee_code: emp.employee_code,
            sub_role: emp.sub_role,
            sub_permissions: emp.sub_permissions,
          });
          previousRole = existingResolved.role;
          nextSubRoleToSave = body.role ?? existingResolved.role;
          nextSubPermissionsToSave =
            validatedBodySubPermissions ??
            (body.role === 'staff' ? [] : existingResolved.sub_permissions);
        } else {
          const memRes = await client.query<{ role: string; status: string }>(
            `SELECT role, status FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE;`,
            [context.workspace.id, emp.user_id],
          );
          const currentMem = memRes.rows[0];
          const previousMemRole: 'owner' | 'staff' =
            currentMem?.role === 'owner' ? 'owner' : 'staff';
          const existingResolved = resolveEmployeeRoleAndPermissions({
            user_role: previousMemRole,
            employee_code: emp.employee_code,
            sub_role: emp.sub_role,
            sub_permissions: emp.sub_permissions,
          });
          previousRole = existingResolved.role;

          const targetRole: EmployeeMemberRole =
            body.role !== undefined ? body.role : existingResolved.role;

          // Delegated sub-admin cannot modify an Owner or promote anyone to Owner
          if (
            context.trueRole &&
            context.trueRole !== 'owner' &&
            (previousRole === 'owner' ||
              targetRole === 'owner' ||
              emp.employee_code === 'OWNER')
          ) {
            throw new AuthError(
              'FORBIDDEN',
              'Quản lý phụ không được chỉnh sửa quyền của Chủ sở hữu hoặc cấp quyền Chủ sở hữu',
              403,
            );
          }

          if (
            targetRole !== 'owner' &&
            (emp.user_id === context.user.id ||
              emp.employee_code === 'OWNER') &&
            previousMemRole === 'owner'
          ) {
            throw new AuthError(
              'FORBIDDEN',
              'Chủ sở hữu không thể tự hạ quyền tài khoản của chính mình',
              403,
            );
          }

          const targetMemRole: 'owner' | 'staff' =
            targetRole === 'owner' ? 'owner' : 'staff';

          if (targetMemRole !== previousMemRole) {
            if (
              previousMemRole === 'owner' &&
              targetMemRole === 'staff' &&
              currentMem?.status === 'active'
            ) {
              const activeOwnersRes = await client.query<{ user_id: string }>(
                `SELECT user_id FROM workspace_memberships WHERE workspace_id = $1 AND role = 'owner' AND status = 'active' FOR UPDATE;`,
                [context.workspace.id],
              );
              if (activeOwnersRes.rows.length <= 1) {
                throw new AuthError(
                  'CONFLICT',
                  'Không thể hạ quyền Chủ sở hữu duy nhất còn hoạt động của workspace',
                  409,
                );
              }
            }

            await client.query(
              `UPDATE workspace_memberships
               SET role = $1,
                   version = version + 1,
                   updated_at = now()
               WHERE workspace_id = $2 AND user_id = $3;`,
              [targetMemRole, context.workspace.id, emp.user_id],
            );
          }

          if (targetRole === 'owner') {
            nextSubRoleToSave = 'owner';
            nextSubPermissionsToSave = [...ALL_SUB_PERMISSIONS];
          } else if (targetRole === 'admin') {
            nextSubRoleToSave = 'admin';
            nextSubPermissionsToSave =
              validatedBodySubPermissions !== undefined
                ? validatedBodySubPermissions
                : existingResolved.role === 'admin'
                  ? existingResolved.sub_permissions
                  : [...DEFAULT_ADMIN_SUB_PERMISSIONS];
          } else {
            nextSubRoleToSave = 'staff';
            nextSubPermissionsToSave =
              validatedBodySubPermissions !== undefined
                ? validatedBodySubPermissions
                : body.role === 'staff'
                  ? []
                  : existingResolved.sub_permissions;
          }

          roleChanged = targetRole !== previousRole;
          subPermissionsChanged =
            JSON.stringify(nextSubPermissionsToSave) !==
            JSON.stringify(existingResolved.sub_permissions);
        }
      }

      const newFullName =
        body.full_name !== undefined ? body.full_name.trim() : emp.full_name;
      const newEligibility =
        body.is_payroll_eligible !== undefined
          ? Boolean(body.is_payroll_eligible)
          : emp.is_payroll_eligible;

      const extraCols = [
        'phone',
        'date_of_birth',
        'gender',
        'national_id',
        'address',
        'position_title',
        'emergency_contact',
        'bank_name',
        'bank_account_number',
        'bank_account_holder',
      ] as const;
      const extraSets: string[] = [];
      const extraVals: unknown[] = [newFullName, newEligibility];
      for (const col of extraCols) {
        if (body[col] !== undefined) {
          const rawVal =
            body[col] === null || String(body[col]).trim() === ''
              ? null
              : String(body[col]).trim();
          const v =
            rawVal === null
              ? null
              : col === 'date_of_birth'
                ? normalizeDateOfBirth(rawVal)
                : col === 'bank_account_number'
                  ? normalizeBankAccountNumber(rawVal)
                  : rawVal;
          extraVals.push(v);
          extraSets.push(`${col} = $${extraVals.length}`);
        }
      }
      if (
        nextSubRoleToSave !== undefined &&
        nextSubPermissionsToSave !== undefined
      ) {
        extraVals.push(nextSubRoleToSave);
        extraSets.push(`sub_role = $${extraVals.length}`);
        extraVals.push(JSON.stringify(nextSubPermissionsToSave));
        extraSets.push(`sub_permissions = $${extraVals.length}::jsonb`);
      }
      if (extraSets.length === 0) {
        await client.query(
          `
        UPDATE employees
        SET full_name = $1,
            is_payroll_eligible = $2,
            version = version + 1,
            updated_at = now()
        WHERE workspace_id = $3 AND id = $4;
      `,
          [newFullName, newEligibility, context.workspace.id, employeeId],
        );
      } else {
        extraVals.push(context.workspace.id, employeeId);
        await client.query(
          `UPDATE employees SET full_name = $1, is_payroll_eligible = $2, ${extraSets.join(', ')}, version = version + 1, updated_at = now() WHERE workspace_id = $${extraVals.length - 1} AND id = $${extraVals.length};`,
          extraVals,
        );
      }

      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'employee.updated',
        entityType: 'employee',
        entityId: employeeId,
        requestId,
        metadata: {
          previous_version: expectedVersion,
          new_full_name: newFullName,
          is_payroll_eligible: newEligibility,
          ...(roleChanged || subPermissionsChanged
            ? {
                role_changed: roleChanged,
                previous_role: previousRole,
                new_role: nextSubRoleToSave,
                sub_permissions: nextSubPermissionsToSave,
              }
            : {}),
        },
      });

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return this.getEmployeeById(context, employeeId);
  }

  /**
   * Suspends an employee.
   * Owner only. Revokes active membership and active sessions. Guarded with If-Match.
   */
  async suspendEmployee(
    context: AuthenticatedContext,
    employeeId: string,
    reason: string,
    ifMatch: string | undefined,
    requestId: string,
  ): Promise<{ id: string; employment_status: string; version: number }> {
    requireRole(['owner'], context);

    if (ifMatch === undefined || ifMatch === null || ifMatch.trim() === '') {
      throw new AuthError(
        'PRECONDITION_REQUIRED',
        'If-Match header is required for employee suspend',
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

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock workspace row to serialize owner-modifying transactions and prevent concurrent race conditions
      await client.query(
        `SELECT id FROM workspaces WHERE id = $1 FOR UPDATE;`,
        [context.workspace.id],
      );

      const empRes = await client.query<{
        id: string;
        version: number;
        user_id: string | null;
        employment_status: string;
        employee_code: string;
      }>(
        `SELECT id, version, user_id, employment_status, employee_code FROM employees WHERE workspace_id = $1 AND id = $2 FOR UPDATE;`,
        [context.workspace.id, employeeId],
      );

      const emp = empRes.rows[0];
      if (!emp) {
        throw new AuthError('NOT_FOUND', 'Employee not found', 404);
      }

      if (emp.version !== expectedVersion) {
        throw new AuthError(
          'PRECONDITION_FAILED',
          `Stale employee version. Expected ${expectedVersion}, found ${emp.version}`,
          412,
        );
      }

      // 2. Self-lockout check: Owner cannot suspend their own employee record or user account
      if (emp.user_id && emp.user_id === context.user.id) {
        throw new AuthError(
          'FORBIDDEN',
          'Chủ sở hữu không thể tự tạm ngưng hoặc khóa tài khoản của chính mình',
          403,
        );
      }

      if (emp.employee_code === 'OWNER' && context.workspace.role === 'owner') {
        const userEmpRes = await client.query<{ id: string }>(
          `SELECT id FROM employees WHERE workspace_id = $1 AND user_id = $2;`,
          [context.workspace.id, context.user.id],
        );
        if (userEmpRes.rows[0]?.id === employeeId) {
          throw new AuthError(
            'FORBIDDEN',
            'Chủ sở hữu không thể tự tạm ngưng hoặc khóa tài khoản của chính mình',
            403,
          );
        }
      }

      // 3. Last-owner protection: If target is an active Owner, ensure there is at least one other active Owner
      if (emp.user_id) {
        const memRes = await client.query<{ role: string; status: string }>(
          `SELECT role, status FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2 FOR UPDATE;`,
          [context.workspace.id, emp.user_id],
        );
        const targetMem = memRes.rows[0];
        if (targetMem?.role === 'owner' && targetMem?.status === 'active') {
          // Lock all active owner memberships in this workspace and check count
          const activeOwnersRes = await client.query<{ user_id: string }>(
            `SELECT user_id FROM workspace_memberships WHERE workspace_id = $1 AND role = 'owner' AND status = 'active' FOR UPDATE;`,
            [context.workspace.id],
          );
          if (activeOwnersRes.rows.length <= 1) {
            throw new AuthError(
              'CONFLICT',
              'Không thể tạm ngưng Chủ sở hữu duy nhất còn hoạt động của workspace',
              409,
            );
          }
        }
      }

      const updateRes = await client.query<{ version: number }>(
        `
        UPDATE employees
        SET employment_status = 'suspended',
            version = version + 1,
            updated_at = now()
        WHERE workspace_id = $1 AND id = $2
        RETURNING version;
      `,
        [context.workspace.id, employeeId],
      );
      const newVersion = updateRes.rows[0]!.version;

      if (emp.user_id) {
        // Suspend membership
        await client.query(
          `UPDATE workspace_memberships SET status = 'suspended', updated_at = now(), version = version + 1 WHERE workspace_id = $1 AND user_id = $2;`,
          [context.workspace.id, emp.user_id],
        );

        // Revoke active sessions for this user in this workspace
        await client.query(
          `UPDATE auth_sessions SET revoked_at = now() WHERE workspace_id = $1 AND user_id = $2 AND revoked_at IS NULL;`,
          [context.workspace.id, emp.user_id],
        );
      }

      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'employee.suspended',
        entityType: 'employee',
        entityId: employeeId,
        requestId,
        metadata: {
          reason,
          previous_version: expectedVersion,
          target_user_id: emp.user_id,
          employee_code: emp.employee_code,
        },
      });

      await client.query('COMMIT');

      return {
        id: employeeId,
        employment_status: 'suspended',
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
   * Reactivates a suspended employee.
   * Owner only. Guarded with If-Match.
   */
  async reactivateEmployee(
    context: AuthenticatedContext,
    employeeId: string,
    reason: string,
    ifMatch: string | undefined,
    requestId: string,
  ): Promise<{ id: string; employment_status: string; version: number }> {
    requireRole(['owner'], context);

    if (ifMatch === undefined || ifMatch === null || ifMatch.trim() === '') {
      throw new AuthError(
        'PRECONDITION_REQUIRED',
        'If-Match header is required for employee reactivate',
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

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const empRes = await client.query<{
        id: string;
        version: number;
        user_id: string | null;
        employment_status: string;
      }>(
        `SELECT id, version, user_id, employment_status FROM employees WHERE workspace_id = $1 AND id = $2 FOR UPDATE;`,
        [context.workspace.id, employeeId],
      );

      const emp = empRes.rows[0];
      if (!emp) {
        throw new AuthError('NOT_FOUND', 'Employee not found', 404);
      }

      if (emp.version !== expectedVersion) {
        throw new AuthError(
          'PRECONDITION_FAILED',
          `Stale employee version. Expected ${expectedVersion}, found ${emp.version}`,
          412,
        );
      }

      const updateRes = await client.query<{ version: number }>(
        `
        UPDATE employees
        SET employment_status = 'active',
            version = version + 1,
            updated_at = now()
        WHERE workspace_id = $1 AND id = $2
        RETURNING version;
      `,
        [context.workspace.id, employeeId],
      );
      const newVersion = updateRes.rows[0]!.version;

      if (emp.user_id) {
        await client.query(
          `UPDATE workspace_memberships SET status = 'active', updated_at = now(), version = version + 1 WHERE workspace_id = $1 AND user_id = $2;`,
          [context.workspace.id, emp.user_id],
        );
      }

      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'employee.reactivated',
        entityType: 'employee',
        entityId: employeeId,
        requestId,
        metadata: {
          reason,
          previous_version: expectedVersion,
        },
      });

      await client.query('COMMIT');

      return {
        id: employeeId,
        employment_status: 'active',
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
   * Issues a new activation invite token for an employee.
   * Owner only. Revokes prior usable invite.
   */
  async issueActivationInvite(
    context: AuthenticatedContext,
    employeeId: string,
    requestId: string,
  ): Promise<{ invite_id: string; delivery_status: string; token: string }> {
    requireRole(['owner'], context);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const empRes = await client.query<{
        id: string;
        user_id: string | null;
      }>(
        `SELECT id, user_id FROM employees WHERE workspace_id = $1 AND id = $2 FOR UPDATE;`,
        [context.workspace.id, employeeId],
      );

      const emp = empRes.rows[0];
      if (!emp || !emp.user_id) {
        throw new AuthError(
          'NOT_FOUND',
          'Employee or associated user not found',
          404,
        );
      }

      // Revoke prior active invites
      await client.query(
        `UPDATE activation_invites SET status = 'revoked', revoked_at = now() WHERE workspace_id = $1 AND user_id = $2 AND status = 'issued';`,
        [context.workspace.id, emp.user_id],
      );

      const rawToken = generateCsprngToken(32);
      const tokenHash = hashToken(rawToken);

      const inviteRes = await client.query<{ id: string }>(
        `
        INSERT INTO activation_invites (
          workspace_id, user_id, token_hash, token_version, status, expires_at
        ) VALUES (
          $1, $2, $3, 1, 'issued', now() + interval '24 hours'
        ) RETURNING id;
      `,
        [context.workspace.id, emp.user_id, tokenHash],
      );

      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'employee.invite_issued',
        entityType: 'employee',
        entityId: employeeId,
        requestId,
        metadata: {
          invite_id: inviteRes.rows[0]!.id,
        },
      });

      await client.query('COMMIT');

      return {
        invite_id: inviteRes.rows[0]!.id,
        delivery_status: 'queued',
        token: rawToken,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves activation status of an employee.
   * Owner only. Does not expose token.
   */
  async getActivationStatus(
    context: AuthenticatedContext,
    employeeId: string,
  ): Promise<ActivationStatusResponseData> {
    requireRole(['owner'], context);

    const empRes = await this.pool.query<{
      user_id: string | null;
      user_status: string | null;
      invite_status: string | null;
      expires_at: Date | null;
    }>(
      `
      SELECT
        e.user_id,
        u.status AS user_status,
        ai.status AS invite_status,
        ai.expires_at
      FROM employees e
      LEFT JOIN users u ON u.id = e.user_id
      LEFT JOIN LATERAL (
        SELECT status, expires_at
        FROM activation_invites
        WHERE workspace_id = e.workspace_id AND user_id = e.user_id
        ORDER BY created_at DESC
        LIMIT 1
      ) ai ON true
      WHERE e.workspace_id = $1 AND e.id = $2;
    `,
      [context.workspace.id, employeeId],
    );

    const row = empRes.rows[0];
    if (!row) {
      throw new AuthError('NOT_FOUND', 'Employee not found', 404);
    }

    return {
      activation_status: row.user_status === 'active' ? 'active' : 'pending',
      invite_status: row.invite_status || 'none',
      expires_at: row.expires_at ? row.expires_at.toISOString() : null,
    };
  }
}
