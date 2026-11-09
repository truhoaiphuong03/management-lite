import type { DatabasePool } from '../../../../packages/database/src/pool.js';
import { recordAuditEvent } from '../../../../packages/database/src/audit.js';
import {
  hashPassword,
  verifyPassword,
} from '../../../../packages/security/src/password.js';
import { validatePasswordStrength } from '../../../../packages/security/src/password.js';
import {
  generateCsprngToken,
  hashToken,
} from '../../../../packages/security/src/tokens.js';
import { generateCsrfToken } from '../../../../packages/security/src/csrf.js';
import type {
  ActiveWorkspaceData,
  AuthMeResponseData,
  AuthUserData,
  LoginResponseData,
  UserRole,
  WorkspaceMembershipSummary,
} from '../../../../packages/contracts/src/auth.js';
import { RateLimiter } from '../rate-limiter.js';
import type { PasswordResetMailer } from './reset-email.js';
import {
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  getRememberMeMaxAgeSeconds,
} from '../cookie.js';
import {
  normalizeDateOfBirth,
  normalizeBankAccountNumber,
} from '../employees/profile-validator.js';
import {
  ALL_SUB_PERMISSIONS,
  DEFAULT_ADMIN_SUB_PERMISSIONS,
  parseEmployeeSubPermissions,
} from '../employees/service.js';

export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly details: Array<{
      field?: string;
      message: string;
      code?: string;
    }> = [],
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface AuthenticatedContext {
  sessionId: string;
  sessionTokenHash: string;
  user: AuthUserData;
  workspace: ActiveWorkspaceData;
  trueRole?: UserRole | undefined;
  subRole?: UserRole | undefined;
  subPermissions?: string[] | undefined;
  sessionExpiresAt?: string | undefined;
  rememberMe?: boolean | undefined;
}

let cachedDummyHash: string | null = null;
async function getDummyHash(): Promise<string> {
  if (!cachedDummyHash) {
    cachedDummyHash = await hashPassword('dummy_auth_placeholder_constant_pw');
  }
  return cachedDummyHash;
}

export const OWNER_PERMISSIONS = [
  'employees:read',
  'employees:manage',
  'attendance:read',
  'attendance:clock',
  'attendance:review',
  'payroll:read',
  'payroll:manage',
  'reports:read',
  'accounts:manage',
  'audit:read',
] as const;

export const STAFF_PERMISSIONS = [
  'employees:read_self',
  'attendance:clock',
  'attendance:read_self',
  'payroll:read_self',
  'reports:read_self',
  'reports:write_self',
] as const;

export class AuthService {
  public readonly loginLimiter: RateLimiter;
  /**
   * Defence in depth against distributed guessing: counts FAILED logins per account
   * identifier regardless of source IP. The ceiling is deliberately well above the
   * per-IP limit so a stranger cannot cheaply lock the real owner out.
   */
  public readonly loginAccountLimiter: RateLimiter;
  public readonly changePasswordLimiter: RateLimiter;
  public readonly forgotPasswordLimiter: RateLimiter;
  public readonly forgotPasswordAccountLimiter: RateLimiter;
  public readonly resetPasswordLimiter: RateLimiter;
  public readonly verifyEmailRequestLimiter: RateLimiter;
  public readonly verifyEmailAccountLimiter: RateLimiter;
  public readonly verifyEmailConfirmLimiter: RateLimiter;

  constructor(
    private readonly pool: DatabasePool,
    private readonly csrfSecret: string,
    options: {
      loginLimiter?: RateLimiter;
      loginAccountLimiter?: RateLimiter;
      changePasswordLimiter?: RateLimiter;
      forgotPasswordLimiter?: RateLimiter;
      forgotPasswordAccountLimiter?: RateLimiter;
      resetPasswordLimiter?: RateLimiter;
      verifyEmailRequestLimiter?: RateLimiter;
      verifyEmailAccountLimiter?: RateLimiter;
      verifyEmailConfirmLimiter?: RateLimiter;
      resetMailer?: PasswordResetMailer | undefined;
    } = {},
  ) {
    this.resetMailer = options.resetMailer;
    this.loginLimiter =
      options.loginLimiter ??
      new RateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 5 });
    this.loginAccountLimiter =
      options.loginAccountLimiter ??
      new RateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 20 });
    this.changePasswordLimiter =
      options.changePasswordLimiter ??
      new RateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 5 });
    this.forgotPasswordLimiter =
      options.forgotPasswordLimiter ??
      new RateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 5 });
    this.forgotPasswordAccountLimiter =
      options.forgotPasswordAccountLimiter ??
      new RateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 5 });
    this.resetPasswordLimiter =
      options.resetPasswordLimiter ??
      new RateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 5 });
    this.verifyEmailRequestLimiter =
      options.verifyEmailRequestLimiter ??
      new RateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 5 });
    this.verifyEmailAccountLimiter =
      options.verifyEmailAccountLimiter ??
      new RateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 5 });
    this.verifyEmailConfirmLimiter =
      options.verifyEmailConfirmLimiter ??
      new RateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 5 });
  }

  private readonly resetMailer: PasswordResetMailer | undefined;

  /**
   * Authenticates user credentials and resolves active workspace binding under C06.
   * Enforces rate limiting, constant-time verification, transactional session+audit creation,
   * and fail-closed binding resolution.
   */
  public async loginUser(params: {
    identifier: string;
    password: string;
    clientIp: string;
    requestId: string;
    rememberMe?: boolean | undefined;
  }): Promise<{
    sessionToken: string;
    rememberMe: boolean;
    maxAgeSeconds: number;
    responseData: LoginResponseData;
  }> {
    const { identifier, password, clientIp, requestId } = params;
    const rememberMe = params.rememberMe === true;

    if (
      typeof identifier !== 'string' ||
      typeof password !== 'string' ||
      identifier.trim().length === 0 ||
      password.length === 0
    ) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Identifier and password are required',
        400,
        [
          {
            field: 'identifier',
            message: 'Must be a non-empty string',
          },
        ],
      );
    }

    // 1. Rate limiting check (using verified client IP)
    const rateCheck = this.loginLimiter.increment(clientIp);
    if (!rateCheck.allowed) {
      throw new AuthError(
        'RATE_LIMITED',
        `Too many login attempts. Please retry after ${rateCheck.retryAfterSeconds} seconds.`,
        429,
      );
    }

    const normalizedIdentifier = identifier.trim().toLowerCase();

    // 1b. Per-account ceiling on failed attempts (independent of client IP). The key is
    // the typed identifier whether or not it exists, so this reveals nothing about accounts.
    const accountKey = normalizedIdentifier.slice(0, 254);
    const accountCheck = this.loginAccountLimiter.check(accountKey);
    if (!accountCheck.allowed) {
      throw new AuthError(
        'RATE_LIMITED',
        `Too many login attempts. Please retry after ${accountCheck.retryAfterSeconds} seconds.`,
        429,
      );
    }
    const failCredentials = (): never => {
      this.loginAccountLimiter.increment(accountKey);
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid credentials', 401);
    };

    // 2. Query user identity & credentials (supports username, email, employee_code e.g. NV002, or phone)
    const userRes = await this.pool.query<{
      id: string;
      username_normalized: string;
      email_normalized: string;
      email_verified?: boolean;
      user_status: string;
      password_hash: string | null;
      credential_version: number | null;
      active_employee_workspace_id?: string | null;
    }>(
      `
      SELECT
        u.id,
        u.username_normalized,
        u.email_normalized,
        u.email_verified,
        u.status AS user_status,
        uc.password_hash,
        uc.credential_version,
        (
          SELECT e.workspace_id
          FROM employees e
          JOIN workspaces w ON w.id = e.workspace_id AND w.status = 'active'
          WHERE e.user_id = u.id
            AND e.employment_status NOT IN ('suspended', 'archived')
          ORDER BY e.updated_at DESC
          LIMIT 1
        ) AS active_employee_workspace_id
      FROM users u
      LEFT JOIN user_credentials uc ON uc.user_id = u.id
      WHERE u.username_normalized = $1
         OR u.email_normalized = $1
         OR EXISTS (
           SELECT 1
           FROM employees e
           JOIN workspaces w ON w.id = e.workspace_id AND w.status = 'active'
           WHERE e.user_id = u.id
             AND e.employment_status NOT IN ('suspended', 'archived')
             AND (
               LOWER(btrim(e.employee_code)) = $1
               OR LOWER(btrim(COALESCE(to_jsonb(e) ->> 'phone', ''))) = $1
               OR (
                 length(regexp_replace($1, '[^0-9]', '', 'g')) >= 7
                 AND regexp_replace(COALESCE(to_jsonb(e) ->> 'phone', ''), '[^0-9]', '', 'g') = regexp_replace($1, '[^0-9]', '', 'g')
               )
             )
         )
    `,
      [normalizedIdentifier],
    );

    // SEC-05A: reject ambiguous identity snapshots before password verification.
    // SEC-05B namespace changes racing with session issuance remain unresolved.
    const distinctUserIds = new Set(userRes.rows.map((row) => row.id));
    if (distinctUserIds.size > 1) {
      await verifyPassword(password, await getDummyHash());
      return failCredentials();
    }
    const userRow = userRes.rows[0];

    const canAutoHealEmployeeStatus = Boolean(
      userRow &&
      userRow.active_employee_workspace_id &&
      userRow.user_status === 'pending_activation',
    );

    // Constant-time anti-enumeration when user does not exist, has no credentials, or is not active
    if (
      !userRow ||
      (!userRow.password_hash && userRow.credential_version !== 0) ||
      (userRow.user_status !== 'active' && !canAutoHealEmployeeStatus)
    ) {
      await verifyPassword(password, await getDummyHash());
      return failCredentials();
    }

    // 3. Verify Argon2id password hash (with first-login bootstrap lock-in when credential_version === 0)
    let passwordMatch = userRow.password_hash
      ? await verifyPassword(password, userRow.password_hash)
      : false;
    if (
      !passwordMatch &&
      userRow.credential_version === 0 &&
      userRow.active_employee_workspace_id &&
      password.trim().length >= 4
    ) {
      const bootstrapHash = await hashPassword(password.trim());
      await this.pool.query(
        `INSERT INTO user_credentials (user_id, password_hash, credential_version, password_updated_at, updated_at)
         VALUES ($1, $2, 1, now(), now())
         ON CONFLICT (user_id) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             credential_version = 1,
             password_updated_at = now(),
             updated_at = now()`,
        [userRow.id, bootstrapHash],
      );
      userRow.password_hash = bootstrapHash;
      userRow.credential_version = 1;
      passwordMatch = true;
    }
    if (!passwordMatch) {
      return failCredentials();
    }

    if (userRow.user_status === 'pending_activation' && canAutoHealEmployeeStatus) {
      await this.pool.query(
        `UPDATE users SET status = 'active', updated_at = now() WHERE id = $1 AND status = 'pending_activation'`,
        [userRow.id],
      );
      userRow.user_status = 'active';
    }
    if (userRow.credential_version === 0) {
      await this.pool.query(
        `UPDATE user_credentials SET credential_version = 1, updated_at = now() WHERE user_id = $1 AND credential_version = 0`,
        [userRow.id],
      );
      userRow.credential_version = 1;
    }

    // Reset rate limiter on successful credentials
    this.loginLimiter.reset(clientIp);
    this.loginAccountLimiter.reset(accountKey);

    // 4. Resolve C06 active workspace binding (preauthorized active context)
    // Canonical Doc 30/36: POST /auth/login succeeds only if exactly one preauthorized
    // active binding is resolved from user_workspace_bindings.
    // If zero or multiple active bindings exist, fail closed with 409 WORKSPACE_CONTEXT_UNRESOLVED.
    const queryActiveBindings = async () =>
      this.pool.query<{
        binding_id: string;
        workspace_id: string;
        role: UserRole;
        sub_role?: string | null;
        membership_status: string;
        workspace_name: string;
        timezone: string;
        workspace_status: string;
      }>(
        `
      SELECT
        uwb.id AS binding_id,
        uwb.workspace_id,
        wm.role,
        (
          SELECT to_jsonb(e) ->> 'sub_role'
          FROM employees e
          WHERE e.workspace_id = uwb.workspace_id
            AND e.user_id = uwb.user_id
          LIMIT 1
        ) AS sub_role,
        wm.status AS membership_status,
        w.name AS workspace_name,
        w.timezone,
        w.status AS workspace_status
      FROM user_workspace_bindings uwb
      JOIN workspace_memberships wm
        ON wm.workspace_id = uwb.workspace_id AND wm.user_id = uwb.user_id
      JOIN workspaces w ON w.id = uwb.workspace_id
      WHERE uwb.user_id = $1
        AND uwb.status = 'active'
        AND wm.status = 'active'
        AND w.status = 'active'
    `,
        [userRow.id],
      );

    let bindingRes = await queryActiveBindings();
    let activeBindings = bindingRes.rows;

    if (
      activeBindings.length === 0 &&
      userRow.active_employee_workspace_id
    ) {
      const memCheckForHeal = await this.pool.query<{
        status: string;
        role: string;
        workspace_status: string;
      }>(
        `SELECT wm.status, wm.role, w.status as workspace_status
         FROM workspace_memberships wm
         JOIN workspaces w ON w.id = wm.workspace_id
         WHERE wm.user_id = $1`,
        [userRow.id],
      );
      const isSuspendedOrInactiveWs = memCheckForHeal.rows.some(
        (m) => m.status === 'suspended' || m.workspace_status !== 'active',
      );
      if (!isSuspendedOrInactiveWs && memCheckForHeal.rows.length <= 1) {
        const healWsId = userRow.active_employee_workspace_id;
        await this.pool.query(
          `UPDATE employees
           SET employment_status = 'active', updated_at = now()
           WHERE workspace_id = $1 AND user_id = $2 AND employment_status IN ('invited', 'inactive')`,
          [healWsId, userRow.id],
        );
        await this.pool.query(
          `INSERT INTO workspace_memberships (workspace_id, user_id, role, status)
           VALUES ($1, $2, 'staff', 'active')
           ON CONFLICT (workspace_id, user_id) DO UPDATE
           SET status = CASE WHEN workspace_memberships.status = 'suspended' THEN workspace_memberships.status ELSE 'active' END,
               updated_at = now()`,
          [healWsId, userRow.id],
        );
        await this.pool.query(
          `INSERT INTO user_workspace_bindings (workspace_id, user_id, status, version)
           VALUES ($1, $2, 'active', 1)
           ON CONFLICT (user_id) DO UPDATE
           SET workspace_id = EXCLUDED.workspace_id,
               status = CASE WHEN user_workspace_bindings.status = 'suspended' THEN user_workspace_bindings.status ELSE 'active' END,
               version = user_workspace_bindings.version + 1,
               updated_at = now()`,
          [healWsId, userRow.id],
        );
        bindingRes = await queryActiveBindings();
        activeBindings = bindingRes.rows;
      }
    }

    if (activeBindings.length === 0 || activeBindings.length > 1) {
      let detailMessage = 'Workspace context could not be resolved';
      const details: Array<{ field?: string; message: string }> = [];

      if (activeBindings.length === 0) {
        const memCheck = await this.pool.query<{
          status: string;
          role: string;
          workspace_status: string;
        }>(
          `SELECT wm.status, wm.role, w.status as workspace_status
           FROM workspace_memberships wm
           JOIN workspaces w ON w.id = wm.workspace_id
           WHERE wm.user_id = $1`,
          [userRow.id],
        );

        if (memCheck.rows.length === 0) {
          detailMessage =
            'Tài khoản chưa được phân quyền vào không gian làm việc nào';
          details.push({
            message:
              'Tài khoản chưa có tư cách thành viên (workspace_memberships) trong hệ thống.',
          });
        } else if (memCheck.rows.some((m) => m.status === 'suspended')) {
          detailMessage =
            'Tài khoản đang bị tạm ngưng công tác trong không gian làm việc này';
          details.push({
            field: 'membership_status',
            message:
              'Tư cách thành viên (membership) của tài khoản đang ở trạng thái tạm ngưng (suspended).',
          });
        } else if (memCheck.rows.some((m) => m.workspace_status !== 'active')) {
          detailMessage =
            'Không gian làm việc đang bị khóa hoặc không hoạt động';
          details.push({
            field: 'workspace_status',
            message:
              'Không gian làm việc (workspace) đang ở trạng thái không hoạt động.',
          });
        } else {
          detailMessage =
            'Chưa thiết lập liên kết không gian làm việc mặc định (C06 binding unresolved)';
          details.push({
            message:
              'Chưa có bản ghi liên kết hợp lệ trong user_workspace_bindings.',
          });
        }
      } else {
        detailMessage = 'Phát hiện xung đột nhiều ngữ cảnh làm việc đồng thời';
        details.push({
          message:
            'Tồn tại nhiều active bindings mà không có preauthorized binding duy nhất.',
        });
      }

      throw new AuthError(
        'WORKSPACE_CONTEXT_UNRESOLVED',
        detailMessage,
        409,
        details,
      );
    }

    const chosenMembership = activeBindings[0]!;

    // 5. Issue session with CSPRNG token (32 bytes = 256 bits entropy)
    const sessionToken = generateCsprngToken(32);
    const sessionTokenHash = hashToken(sessionToken);

    const now = new Date();
    const maxAgeSeconds = rememberMe
      ? getRememberMeMaxAgeSeconds()
      : DEFAULT_SESSION_MAX_AGE_SECONDS;
    const idleExpiresAt = rememberMe
      ? new Date(now.getTime() + maxAgeSeconds * 1000)
      : new Date(now.getTime() + 30 * 60 * 1000); // 30m idle timeout for standard session
    const absoluteExpiresAt = new Date(now.getTime() + maxAgeSeconds * 1000);

    // 6. Transactional session insertion & audit event creation
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const sessionRes = await client.query<{ id: string }>(
        `
        INSERT INTO auth_sessions (
          workspace_id,
          user_id,
          session_token_hash,
          credential_version_at_issue,
          created_at,
          last_seen_at,
          idle_expires_at,
          absolute_expires_at,
          remember_me
        )
        VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8)
        RETURNING id;
      `,
        [
          chosenMembership.workspace_id,
          userRow.id,
          sessionTokenHash,
          userRow.credential_version ?? 1,
          now.toISOString(),
          idleExpiresAt.toISOString(),
          absoluteExpiresAt.toISOString(),
          rememberMe,
        ],
      );

      const sessionId = sessionRes.rows[0]!.id;

      await recordAuditEvent(client, {
        workspaceId: chosenMembership.workspace_id,
        actorUserId: userRow.id,
        action: 'auth.login',
        entityType: 'auth_session',
        entityId: sessionId,
        requestId,
        metadata: {
          client_ip: clientIp,
          remember_me: rememberMe,
        },
      });

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // 7. Cryptographic CSRF token bound to session token hash
    const csrfToken = generateCsrfToken(sessionTokenHash, this.csrfSecret);

    return {
      sessionToken,
      rememberMe,
      maxAgeSeconds,
      responseData: {
        user: {
          id: userRow.id,
          username: userRow.username_normalized,
          email: userRow.email_normalized,
          email_verified: Boolean(userRow.email_verified),
        },
        active_workspace: {
          id: chosenMembership.workspace_id,
          name: chosenMembership.workspace_name,
          timezone: chosenMembership.timezone,
          role: chosenMembership.role,
          ...(chosenMembership.sub_role === 'admin'
            ? { sub_role: 'admin' as const }
            : {}),
        },
        session_expires_at: absoluteExpiresAt.toISOString(),
        csrf_token: csrfToken,
        remember_me: rememberMe,
      },
    };
  }

  /**
   * Resolves and verifies an active session from a raw session token using an
   * atomic conditional UPDATE.
   *
   * Concurrency Safety Guarantee:
   * - Locks the session row and checks all state invariants (revoked_at IS NULL,
   *   idle unexpired, absolute unexpired, credential_version match, user/membership/workspace active)
   *   in a single atomic PostgreSQL statement.
   * - If a concurrent logout, password change, or suspension occurred, the UPDATE affects 0 rows,
   *   guaranteeing that an expired/revoked/invalid session is NEVER extended and fails closed.
   */
  public async resolveSession(
    sessionToken: string | undefined,
  ): Promise<AuthenticatedContext | null> {
    if (!sessionToken || typeof sessionToken !== 'string') {
      return null;
    }

    const sessionTokenHash = hashToken(sessionToken);
    const now = new Date();
    const nextIdle = new Date(now.getTime() + 30 * 60 * 1000);

    const res = await this.pool.query<{
      session_id: string;
      workspace_id: string;
      user_id: string;
      session_token_hash: string;
      credential_version_at_issue: number;
      created_at: string;
      last_seen_at: string;
      idle_expires_at: string;
      absolute_expires_at: string;
      is_remembered: boolean;
      username_normalized: string;
      email_normalized: string;
      email_verified?: boolean;
      role: UserRole;
      workspace_name: string;
      timezone: string;
    }>(
      `
      UPDATE auth_sessions s
      SET last_seen_at = $1,
          idle_expires_at = LEAST(
            CASE
              WHEN s.remember_me IS TRUE
              THEN s.absolute_expires_at
              ELSE $2::timestamptz
            END,
            s.absolute_expires_at
          )
      FROM users u, user_credentials uc, workspace_memberships wm, workspaces w, user_workspace_bindings uwb
      WHERE s.session_token_hash = $3
        AND s.user_id = u.id
        AND uc.user_id = s.user_id
        AND wm.workspace_id = s.workspace_id AND wm.user_id = s.user_id
        AND w.id = s.workspace_id
        AND uwb.user_id = s.user_id AND uwb.workspace_id = s.workspace_id
        AND uwb.status = 'active'
        AND s.revoked_at IS NULL
        -- Legacy/unknown intent requires a new login; never infer consent from TTL.
        AND s.remember_me IS NOT NULL
        AND s.idle_expires_at > $1
        AND s.absolute_expires_at > $1
        AND s.credential_version_at_issue = uc.credential_version
        AND u.status = 'active'
        AND wm.status = 'active'
        AND w.status = 'active'
      RETURNING
        s.id AS session_id,
        s.workspace_id,
        s.user_id,
        s.session_token_hash,
        s.credential_version_at_issue,
        s.created_at,
        s.last_seen_at,
        s.idle_expires_at,
        s.absolute_expires_at,
        s.remember_me AS is_remembered,
        u.username_normalized,
        u.email_normalized,
        u.email_verified,
        wm.role,
        w.name AS workspace_name,
        w.timezone;
    `,
      [now.toISOString(), nextIdle.toISOString(), sessionTokenHash],
    );

    const row = res.rows[0];
    if (!row) {
      return null;
    }

    let subRole: UserRole = row.role;
    let subPermissions: string[] =
      row.role === 'owner' ? [...ALL_SUB_PERMISSIONS] : [];

    if (row.role !== 'owner') {
      try {
        const empPermRes = await this.pool.query<{
          sub_role?: string | null;
          sub_permissions?: unknown;
        }>(
          `SELECT
             to_jsonb(e) ->> 'sub_role' AS sub_role,
             to_jsonb(e) -> 'sub_permissions' AS sub_permissions
           FROM employees e
           WHERE e.workspace_id = $1 AND e.user_id = $2
           LIMIT 1;`,
          [row.workspace_id, row.user_id],
        );
        const empRow = empPermRes.rows[0];
        if (empRow) {
          const parsedPerms = parseEmployeeSubPermissions(
            empRow.sub_permissions,
          );
          if (empRow.sub_role === 'admin') {
            subRole = 'admin';
            subPermissions =
              parsedPerms.length > 0 || Array.isArray(empRow.sub_permissions)
                ? parsedPerms
                : [...DEFAULT_ADMIN_SUB_PERMISSIONS];
          } else {
            subRole = 'staff';
            subPermissions = parsedPerms;
          }
        }
      } catch {
        // Fallback if employees table or columns are not yet present in partial test DB
      }
    }

    return {
      sessionId: row.session_id,
      sessionTokenHash: row.session_token_hash,
      user: {
        id: row.user_id,
        username: row.username_normalized,
        email: row.email_normalized,
        email_verified: Boolean(row.email_verified),
      },
      workspace: {
        id: row.workspace_id,
        name: row.workspace_name,
        timezone: row.timezone,
        role: row.role,
        sub_role: subRole,
        sub_permissions: subPermissions,
      },
      trueRole: row.role,
      subRole,
      subPermissions,
      sessionExpiresAt: new Date(row.absolute_expires_at).toISOString(),
      rememberMe: Boolean(row.is_remembered),
    };
  }

  /**
   * Refreshes an active standard session, or a remembered session whose idle
   * window has expired, without extending its absolute refresh ceiling.
   * Standard sessions must still be within idle_expires_at. The absolute ceiling
   * must not have expired, the session must not be revoked (`revoked_at IS NULL`),
   * `credential_version` matches, and user/membership/workspace remain active.
   */
  public async refreshSession(params: {
    sessionToken: string | undefined;
    requestId: string;
  }): Promise<{
    sessionToken: string;
    rememberMe: boolean;
    maxAgeSeconds: number;
    responseData: LoginResponseData;
  } | null> {
    const { sessionToken } = params;
    if (!sessionToken || typeof sessionToken !== 'string') {
      return null;
    }

    const sessionTokenHash = hashToken(sessionToken);
    const now = new Date();
    const nextIdle = new Date(now.getTime() + 30 * 60 * 1000);

    const res = await this.pool.query<{
      session_id: string;
      workspace_id: string;
      user_id: string;
      session_token_hash: string;
      created_at: string;
      absolute_expires_at: string;
      is_remembered: boolean;
      username_normalized: string;
      email_normalized: string;
      email_verified?: boolean;
      role: UserRole;
      workspace_name: string;
      timezone: string;
    }>(
      `
      UPDATE auth_sessions s
      SET last_seen_at = $1,
          idle_expires_at = LEAST(
            CASE
              WHEN s.remember_me IS TRUE
              THEN s.absolute_expires_at
              ELSE $2::timestamptz
            END,
            s.absolute_expires_at
          )
      FROM users u, user_credentials uc, workspace_memberships wm, workspaces w, user_workspace_bindings uwb
      WHERE s.session_token_hash = $3
        AND s.user_id = u.id
        AND uc.user_id = s.user_id
        AND wm.workspace_id = s.workspace_id AND wm.user_id = s.user_id
        AND w.id = s.workspace_id
        AND uwb.user_id = s.user_id AND uwb.workspace_id = s.workspace_id
        AND uwb.status = 'active'
        AND s.revoked_at IS NULL
        -- Legacy/unknown intent requires a new login; never infer consent from TTL.
        AND s.remember_me IS NOT NULL
        AND (
          s.remember_me IS TRUE
          OR s.idle_expires_at > $1
        )
        AND s.absolute_expires_at > $1
        AND s.credential_version_at_issue = uc.credential_version
        AND u.status = 'active'
        AND wm.status = 'active'
        AND w.status = 'active'
      RETURNING
        s.id AS session_id,
        s.workspace_id,
        s.user_id,
        s.session_token_hash,
        s.created_at,
        s.absolute_expires_at,
        s.remember_me AS is_remembered,
        u.username_normalized,
        u.email_normalized,
        u.email_verified,
        wm.role,
        w.name AS workspace_name,
        w.timezone;
    `,
      [now.toISOString(), nextIdle.toISOString(), sessionTokenHash],
    );

    const row = res.rows[0];
    if (!row) {
      return null;
    }

    const absDate = new Date(row.absolute_expires_at);
    const remainingSec = Math.max(
      1,
      Math.floor((absDate.getTime() - now.getTime()) / 1000),
    );
    const rememberMe = Boolean(row.is_remembered);
    const csrfToken = generateCsrfToken(
      row.session_token_hash,
      this.csrfSecret,
    );

    return {
      sessionToken,
      rememberMe,
      maxAgeSeconds: remainingSec,
      responseData: {
        user: {
          id: row.user_id,
          username: row.username_normalized,
          email: row.email_normalized,
          email_verified: Boolean(row.email_verified),
        },
        active_workspace: {
          id: row.workspace_id,
          name: row.workspace_name,
          timezone: row.timezone,
          role: row.role,
        },
        session_expires_at: absDate.toISOString(),
        csrf_token: csrfToken,
        remember_me: rememberMe,
      },
    };
  }

  /**
   * Revokes the current session and records audit event transactionally.
   * Repeat-safe: returns cleanly without error if session already revoked or invalid.
   */
  public async logoutSession(params: {
    sessionToken: string | undefined;
    requestId: string;
  }): Promise<void> {
    const { sessionToken, requestId } = params;
    if (!sessionToken || typeof sessionToken !== 'string') {
      return;
    }

    const sessionTokenHash = hashToken(sessionToken);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const res = await client.query<{
        id: string;
        workspace_id: string;
        user_id: string;
      }>(
        `
        UPDATE auth_sessions
        SET revoked_at = now()
        WHERE session_token_hash = $1 AND revoked_at IS NULL
        RETURNING id, workspace_id, user_id;
      `,
        [sessionTokenHash],
      );

      const revokedSession = res.rows[0];
      if (revokedSession) {
        await recordAuditEvent(client, {
          workspaceId: revokedSession.workspace_id,
          actorUserId: revokedSession.user_id,
          action: 'auth.logout',
          entityType: 'auth_session',
          entityId: revokedSession.id,
          requestId,
        });
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Retrieves profile, active workspace, permissions, and memberships for the current session.
   */
  public async getAuthMe(
    context: AuthenticatedContext,
  ): Promise<AuthMeResponseData> {
    const membershipRes = await this.pool.query<{
      workspace_id: string;
      workspace_name: string;
      role: UserRole;
      status: string;
    }>(
      `
      SELECT
        wm.workspace_id,
        w.name AS workspace_name,
        wm.role,
        wm.status
      FROM workspace_memberships wm
      JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = $1
      ORDER BY wm.created_at ASC
    `,
      [context.user.id],
    );

    const baseRole = context.trueRole ?? context.workspace.role;
    const basePermissions =
      baseRole === 'owner' ? [...OWNER_PERMISSIONS] : [...STAFF_PERMISSIONS];
    const delegated = context.subPermissions ?? [];
    const permissions = Array.from(new Set([...basePermissions, ...delegated]));

    const memberships: WorkspaceMembershipSummary[] = membershipRes.rows.map(
      (m) => ({
        workspace_id: m.workspace_id,
        workspace_name: m.workspace_name,
        role: m.role,
        status: m.status,
      }),
    );

    return {
      user: context.user,
      active_workspace: context.workspace,
      permissions,
      memberships,
      session_expires_at: context.sessionExpiresAt,
      remember_me: context.rememberMe,
    };
  }

  /**
   * Self-service profile update (full name, phone, email).
   * Changing the email requires the current password, enforces uniqueness,
   * and resets email verification so the new address must be re-verified.
   */
  public async updateProfile(params: {
    context: AuthenticatedContext;
    fullName?: unknown;
    phone?: unknown;
    email?: unknown;
    currentPassword?: unknown;
    dateOfBirth?: unknown;
    gender?: unknown;
    nationalId?: unknown;
    address?: unknown;
    positionTitle?: unknown;
    emergencyContact?: unknown;
    bankName?: unknown;
    bankAccountNumber?: unknown;
    bankAccountHolder?: unknown;
    requestId: string;
  }): Promise<{
    message: string;
    full_name: string | null;
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
    email: string;
    email_verified: boolean;
    email_changed: boolean;
  }> {
    const { context, requestId } = params;
    const invalid = (field: string, message: string): never => {
      throw new AuthError('VALIDATION_ERROR', message, 400, [
        { field, message },
      ]);
    };

    let fullName: string | undefined;
    if (params.fullName !== undefined) {
      if (typeof params.fullName !== 'string')
        invalid('full_name', 'Họ tên không hợp lệ');
      fullName = (params.fullName as string).trim();
      if (fullName.length < 2 || fullName.length > 120)
        invalid('full_name', 'Họ tên phải từ 2 đến 120 ký tự');
    }

    let phone: string | null | undefined;
    if (params.phone !== undefined) {
      if (params.phone === null || params.phone === '') {
        phone = null;
      } else {
        if (typeof params.phone !== 'string')
          invalid('phone', 'Số điện thoại không hợp lệ');
        const compact = (params.phone as string).replace(/[\s.\-()]/g, '');
        if (!/^\+?[0-9]{8,15}$/.test(compact))
          invalid('phone', 'Số điện thoại phải gồm 8–15 chữ số');
        phone = compact;
      }
    }

    let newEmail: string | undefined;
    if (params.email !== undefined) {
      if (typeof params.email !== 'string')
        invalid('email', 'Email không hợp lệ');
      const e = (params.email as string).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 254)
        invalid('email', 'Địa chỉ email không đúng định dạng');
      newEmail = e;
    }

    const optionalTextMap: Record<string, string | null | undefined> = {};
    const optionalKeyPairs: Array<[string, unknown, number]> = [
      ['date_of_birth', params.dateOfBirth, 30],
      ['gender', params.gender, 30],
      ['national_id', params.nationalId, 40],
      ['address', params.address, 300],
      ['position_title', params.positionTitle, 120],
      ['emergency_contact', params.emergencyContact, 200],
      ['bank_name', params.bankName, 120],
      ['bank_account_number', params.bankAccountNumber, 60],
      ['bank_account_holder', params.bankAccountHolder, 120],
    ];
    for (const [col, rawVal, maxLen] of optionalKeyPairs) {
      if (rawVal !== undefined) {
        if (rawVal === null || rawVal === '') {
          optionalTextMap[col] = null;
        } else if (typeof rawVal !== 'string') {
          invalid(col, 'Giá trị không hợp lệ');
        } else {
          const trimmed = rawVal.trim();
          if (trimmed.length > maxLen) {
            invalid(col, `Trường ${col} vượt quá ${maxLen} ký tự`);
          }
          if (col === 'date_of_birth') {
            optionalTextMap[col] = normalizeDateOfBirth(trimmed);
          } else if (col === 'bank_account_number') {
            optionalTextMap[col] = normalizeBankAccountNumber(trimmed);
          } else {
            optionalTextMap[col] = trimmed || null;
          }
        }
      }
    }

    if (
      fullName === undefined &&
      phone === undefined &&
      newEmail === undefined &&
      Object.keys(optionalTextMap).length === 0
    ) {
      invalid('profile', 'Không có thông tin nào để cập nhật');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const userRes = await client.query<{
        email_normalized: string;
        email_verified: boolean;
      }>(
        `SELECT email_normalized, email_verified FROM users WHERE id = $1 FOR UPDATE;`,
        [context.user.id],
      );
      const userRow = userRes.rows[0];
      if (!userRow) {
        throw new AuthError('UNAUTHENTICATED', 'Session no longer valid', 401);
      }

      let emailChanged = false;
      let emailVerified = userRow.email_verified;
      let currentEmail = userRow.email_normalized;

      if (newEmail !== undefined && newEmail !== userRow.email_normalized) {
        if (
          typeof params.currentPassword !== 'string' ||
          params.currentPassword.length === 0
        ) {
          throw new AuthError(
            'VALIDATION_ERROR',
            'Cần nhập mật khẩu hiện tại để đổi email',
            400,
            [{ field: 'current_password', message: 'Bắt buộc khi đổi email' }],
          );
        }
        const credRes = await client.query<{ password_hash: string }>(
          `SELECT password_hash FROM user_credentials WHERE user_id = $1;`,
          [context.user.id],
        );
        const hash = credRes.rows[0]?.password_hash;
        if (!hash || !(await verifyPassword(params.currentPassword, hash))) {
          throw new AuthError(
            'INVALID_CREDENTIALS',
            'Mật khẩu hiện tại không đúng',
            401,
          );
        }
        const dup = await client.query(
          `SELECT 1 FROM users WHERE email_normalized = $1 AND id <> $2;`,
          [newEmail, context.user.id],
        );
        if (dup.rowCount) {
          throw new AuthError(
            'CONFLICT',
            'Email này đã được sử dụng bởi tài khoản khác',
            409,
          );
        }
        await client.query(
          `UPDATE users
           SET email_normalized = $1,
               email_verified = false,
               email_verified_at = NULL,
               email_verification_proof = NULL,
               version = version + 1
           WHERE id = $2;`,
          [newEmail, context.user.id],
        );
        await client.query(
          `UPDATE email_verifications
           SET proof_type = 'token_revoked'
           WHERE user_id = $1 AND verified_at IS NULL AND proof_type = 'token_confirmation';`,
          [context.user.id],
        );
        emailChanged = true;
        emailVerified = false;
        currentEmail = newEmail;
      }

      const sets: string[] = [];
      const vals: unknown[] = [];
      if (fullName !== undefined) {
        vals.push(fullName);
        sets.push(`full_name = $${vals.length}`);
      }
      if (phone !== undefined) {
        vals.push(phone);
        sets.push(`phone = $${vals.length}`);
      }
      for (const [col, colVal] of Object.entries(optionalTextMap)) {
        vals.push(colVal ?? null);
        sets.push(`${col} = $${vals.length}`);
      }
      let resultName: string | null = fullName ?? null;
      let resultPhone: string | null = phone ?? null;
      if (sets.length > 0) {
        vals.push(context.workspace.id, context.user.id);
        const upd = await client.query<{
          full_name: string;
          phone: string | null;
        }>(
          `UPDATE employees
           SET ${sets.join(', ')}, version = version + 1, updated_at = now()
           WHERE workspace_id = $${vals.length - 1} AND user_id = $${vals.length}
           RETURNING full_name, phone;`,
          vals,
        );
        if (!upd.rowCount) {
          throw new AuthError(
            'NOT_FOUND',
            'Không tìm thấy hồ sơ nhân sự để cập nhật',
            404,
          );
        }
        resultName = upd.rows[0]!.full_name;
        resultPhone = upd.rows[0]!.phone;
      }

      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'auth.profile_updated',
        entityType: 'user',
        entityId: context.user.id,
        requestId,
        metadata: {
          fields: [
            ...(fullName !== undefined ? ['full_name'] : []),
            ...(phone !== undefined ? ['phone'] : []),
            ...(emailChanged ? ['email'] : []),
          ],
        },
      });

      await client.query('COMMIT');
      return {
        message: emailChanged
          ? 'Đã cập nhật thông tin. Email mới cần được xác minh lại.'
          : 'Đã cập nhật thông tin cá nhân.',
        full_name: resultName,
        phone: resultPhone,
        ...(optionalTextMap['date_of_birth'] !== undefined
          ? { date_of_birth: optionalTextMap['date_of_birth'] }
          : {}),
        ...(optionalTextMap['gender'] !== undefined
          ? { gender: optionalTextMap['gender'] }
          : {}),
        ...(optionalTextMap['national_id'] !== undefined
          ? { national_id: optionalTextMap['national_id'] }
          : {}),
        ...(optionalTextMap['address'] !== undefined
          ? { address: optionalTextMap['address'] }
          : {}),
        ...(optionalTextMap['position_title'] !== undefined
          ? { position_title: optionalTextMap['position_title'] }
          : {}),
        ...(optionalTextMap['emergency_contact'] !== undefined
          ? { emergency_contact: optionalTextMap['emergency_contact'] }
          : {}),
        ...(optionalTextMap['bank_name'] !== undefined
          ? { bank_name: optionalTextMap['bank_name'] }
          : {}),
        ...(optionalTextMap['bank_account_number'] !== undefined
          ? { bank_account_number: optionalTextMap['bank_account_number'] }
          : {}),
        ...(optionalTextMap['bank_account_holder'] !== undefined
          ? { bank_account_holder: optionalTextMap['bank_account_holder'] }
          : {}),
        email: currentEmail,
        email_verified: emailVerified,
        email_changed: emailChanged,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Changes the authenticated user's password.
   * Acquires row-level lock on user_credentials to serialize concurrent password changes.
   * Increments credential_version, invalidates all other sessions, and rotates current session.
   */
  public async changePassword(params: {
    context: AuthenticatedContext;
    currentPassword: unknown;
    newPassword: unknown;
    clientIp: string;
    requestId: string;
  }): Promise<{ message: string }> {
    const { context, currentPassword, newPassword, clientIp, requestId } =
      params;

    // 1. Rate limit check
    const rateCheck = this.changePasswordLimiter.increment(clientIp);
    if (!rateCheck.allowed) {
      throw new AuthError(
        'RATE_LIMITED',
        `Too many password change attempts. Please retry after ${rateCheck.retryAfterSeconds} seconds.`,
        429,
      );
    }

    // 2. Validate current password provided
    if (typeof currentPassword !== 'string' || currentPassword.length === 0) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Current password is required',
        400,
        [
          {
            field: 'current_password',
            message: 'Must be a non-empty string',
          },
        ],
      );
    }

    // 3. Validate new password strength
    const validation = validatePasswordStrength(newPassword);
    if (!validation.valid || typeof newPassword !== 'string') {
      throw new AuthError(
        'VALIDATION_ERROR',
        validation.reason || 'Invalid new password',
        400,
        [
          {
            field: 'new_password',
            message: validation.reason || 'Invalid password',
          },
        ],
      );
    }

    // 3b. Validate new password is not identical to current password
    if (currentPassword === newPassword) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Mật khẩu mới không được trùng với mật khẩu hiện tại (New password must not be identical to current password)',
        400,
        [
          {
            field: 'new_password',
            message: 'Mật khẩu mới không được trùng với mật khẩu hiện tại',
          },
        ],
      );
    }

    // 4. Hash new password with Argon2id before transaction to minimize lock duration
    const newPasswordHash = await hashPassword(newPassword);

    // 5. Transactional update with row-level lock to prevent concurrent password modification races
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE;', [
        context.user.id,
      ]);

      const credRes = await client.query<{ password_hash: string }>(
        `SELECT password_hash FROM user_credentials WHERE user_id = $1 FOR UPDATE`,
        [context.user.id],
      );

      const credRow = credRes.rows[0];
      if (!credRow) {
        throw new AuthError(
          'INVALID_CREDENTIALS',
          'Current password verification failed',
          401,
        );
      }

      const currentMatches = await verifyPassword(
        currentPassword,
        credRow.password_hash,
      );
      if (!currentMatches) {
        throw new AuthError(
          'INVALID_CREDENTIALS',
          'Current password verification failed',
          401,
        );
      }

      // Reset rate limiter on successful credentials
      this.changePasswordLimiter.reset(clientIp);

      const updateCredRes = await client.query<{
        credential_version: number;
      }>(
        `
        UPDATE user_credentials
        SET password_hash = $1,
            credential_version = credential_version + 1,
            password_changed_at = now()
        WHERE user_id = $2
        RETURNING credential_version;
      `,
        [newPasswordHash, context.user.id],
      );

      const newVersion = updateCredRes.rows[0]!.credential_version;

      // A password change also invalidates earlier recovery emails.
      await client.query(
        'UPDATE password_reset_tokens SET consumed_at=now() WHERE user_id=$1 AND consumed_at IS NULL;',
        [context.user.id],
      );

      // Invalidate all other active sessions of this user
      await client.query(
        `
        UPDATE auth_sessions
        SET revoked_at = now()
        WHERE user_id = $1 AND id != $2 AND revoked_at IS NULL;
      `,
        [context.user.id, context.sessionId],
      );

      // Rotate current session credential_version_at_issue to match new credential version
      await client.query(
        `
        UPDATE auth_sessions
        SET credential_version_at_issue = $1
        WHERE id = $2;
      `,
        [newVersion, context.sessionId],
      );

      // Record audit event transactionally
      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'auth.password_change',
        entityType: 'user',
        entityId: context.user.id,
        requestId,
        metadata: {
          client_ip: clientIp,
        },
      });

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return { message: 'Password changed successfully' };
  }

  /**
   * Activates an employee account using an invite token and sets the initial password.
   * Atomic across user_credentials, users, workspace_memberships, employees, and activation_invites.
   */
  async activateAccount(params: {
    token: string;
    newPassword: string;
    clientIp: string;
    requestId: string;
  }): Promise<{ message: string }> {
    const { token, newPassword, clientIp, requestId } = params;

    const rateCheck = this.loginLimiter.check(clientIp);
    if (!rateCheck.allowed) {
      throw new AuthError('RATE_LIMITED', 'Too many activation attempts', 429);
    }

    if (!token || typeof token !== 'string') {
      throw new AuthError('VALIDATION_ERROR', 'Token is required', 400);
    }

    const validation = validatePasswordStrength(newPassword);
    if (!validation.valid || typeof newPassword !== 'string') {
      throw new AuthError(
        'VALIDATION_ERROR',
        validation.reason || 'Invalid password',
        400,
      );
    }

    const newPasswordHash = await hashPassword(newPassword);
    const tokenHash = hashToken(token.trim());

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const inviteRes = await client.query<{
        id: string;
        workspace_id: string;
        user_id: string;
        status: string;
        expires_at: Date;
      }>(
        `SELECT id, workspace_id, user_id, status, expires_at FROM activation_invites WHERE token_hash = $1 FOR UPDATE;`,
        [tokenHash],
      );

      const invite = inviteRes.rows[0];
      if (!invite || invite.status !== 'issued') {
        throw new AuthError(
          'INVITE_EXPIRED',
          'Activation invite is invalid, already used, or revoked',
          410,
        );
      }

      if (new Date(invite.expires_at) < new Date()) {
        await client.query(
          `UPDATE activation_invites SET status = 'expired' WHERE id = $1;`,
          [invite.id],
        );
        throw new AuthError(
          'INVITE_EXPIRED',
          'Activation invite has expired',
          410,
        );
      }

      // Upsert credentials
      await client.query(
        `
        INSERT INTO user_credentials (user_id, password_hash, credential_version)
        VALUES ($1, $2, 1)
        ON CONFLICT (user_id)
        DO UPDATE SET password_hash = $2, credential_version = user_credentials.credential_version + 1, password_changed_at = now();
      `,
        [invite.user_id, newPasswordHash],
      );

      // Activate user
      await client.query(
        `UPDATE users SET status = 'active', version = version + 1 WHERE id = $1;`,
        [invite.user_id],
      );

      // Activate workspace membership
      await client.query(
        `UPDATE workspace_memberships SET status = 'active', updated_at = now(), version = version + 1 WHERE workspace_id = $1 AND user_id = $2;`,
        [invite.workspace_id, invite.user_id],
      );

      // Activate employee profile
      await client.query(
        `UPDATE employees SET employment_status = 'active', updated_at = now(), version = version + 1 WHERE workspace_id = $1 AND user_id = $2;`,
        [invite.workspace_id, invite.user_id],
      );

      // Consume invite
      await client.query(
        `UPDATE activation_invites SET status = 'used', consumed_at = now() WHERE id = $1;`,
        [invite.id],
      );

      // Record audit event
      await recordAuditEvent(client, {
        workspaceId: invite.workspace_id,
        actorUserId: invite.user_id,
        action: 'user.activated',
        entityType: 'user',
        entityId: invite.user_id,
        requestId,
        metadata: {
          client_ip: clientIp,
        },
      });

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return {
      message: 'Tài khoản đã được kích hoạt thành công. Vui lòng đăng nhập.',
    };
  }

  /**
   * Requests a password reset token for the given email address.
   * Follows anti-enumeration pattern (generic response), single-use CSPRNG token with 15m TTL,
   * SHA-256 token hash storage and sanitized provider delivery audit logging.
   */
  async requestPasswordReset(params: {
    email: string;
    clientIp: string;
    requestId: string;
  }): Promise<{
    message: string;
    delivery_status: 'EMAIL_DELIVERY_BLOCKED' | 'EMAIL_DELIVERY_PENDING';
  }> {
    const { email, clientIp, requestId } = params;
    const startedAt = Date.now();

    if (!email || typeof email !== 'string' || email.trim().length === 0) {
      throw new AuthError('VALIDATION_ERROR', 'Email is required', 400, [
        { field: 'email', message: 'Email is required' },
      ]);
    }

    const normalizedEmail = email.trim().toLowerCase();
    // Anti-enumeration & privacy: Key account limiter by SHA-256 hash of normalized email to never store raw email in memory keys
    const accountLimiterKey = `acc:${hashToken(normalizedEmail)}`;

    const ipRateCheck = this.forgotPasswordLimiter.increment(clientIp);
    const accountRateCheck =
      this.forgotPasswordAccountLimiter.increment(accountLimiterKey);

    if (!ipRateCheck.allowed || !accountRateCheck.allowed) {
      const retryAfter = Math.max(
        ipRateCheck.allowed ? 0 : ipRateCheck.retryAfterSeconds,
        accountRateCheck.allowed ? 0 : accountRateCheck.retryAfterSeconds,
      );
      throw new AuthError(
        'RATE_LIMITED',
        'Quá nhiều yêu cầu khôi phục mật khẩu. Vui lòng thử lại sau ít phút.',
        429,
        [{ message: `Thử lại sau ${retryAfter} giây` }],
      );
    }

    const genericResponse: {
      message: string;
      delivery_status: 'EMAIL_DELIVERY_BLOCKED' | 'EMAIL_DELIVERY_PENDING';
      delivered?: boolean;
      delivery_error?: string;
      sent_to?: string;
      sent_from?: string;
      expires_in_minutes?: number;
    } = {
      message:
        'Nếu email tồn tại trong hệ thống và hợp lệ, hướng dẫn đặt lại mật khẩu đã được xử lý.',
      delivery_status: this.resetMailer
        ? 'EMAIL_DELIVERY_PENDING'
        : 'EMAIL_DELIVERY_BLOCKED',
    };

    const client = await this.pool.connect();
    try {
      const userRes = await client.query<{
        id: string;
        email_normalized: string;
        status: string;
        email_verified: boolean;
        email_verified_at: Date | null;
      }>(
        `SELECT id, email_normalized, status, email_verified, email_verified_at
         FROM users
         WHERE email_normalized = $1
         LIMIT 1;`,
        [normalizedEmail],
      );

      const user = userRes.rows[0];
      if (!user || user.status !== 'active' || !user.email_verified) {
        // Anti-enumeration: return standard generic response without disclosing
        // account existence or verification state.
        if (user && !user.email_verified) {
          const workspaceId = await this.resolveUserWorkspaceId(
            client,
            user.id,
          );
          await recordAuditEvent(client, {
            workspaceId,
            actorUserId: user.id,
            action: 'auth.password_reset_unverified_ignored',
            entityType: 'user',
            entityId: user.id,
            requestId,
            metadata: {
              client_ip: clientIp,
              delivery_status: 'EMAIL_DELIVERY_BLOCKED',
              reason: 'EMAIL_NOT_VERIFIED',
            },
          });
        }
        return genericResponse;
      }

      await client.query('BEGIN');

      // Serialize issuance and reset using the same user-first lock order.
      const eligible = await client.query(
        "SELECT id FROM users WHERE id=$1 AND email_normalized=$2 AND status='active' AND email_verified=true FOR UPDATE;",
        [user.id, normalizedEmail],
      );
      if (!eligible.rowCount) {
        await client.query('ROLLBACK');
        return genericResponse;
      }

      // Generate CSPRNG token (32 bytes = 64 hex characters)
      const rawToken = generateCsprngToken(32);
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15-minute TTL

      // Invalidate any existing unused reset tokens for this user
      await client.query(
        `UPDATE password_reset_tokens SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL;`,
        [user.id],
      );

      // Only persist an active token when a reset mailer is configured to deliver it
      if (this.resetMailer) {
        await client.query(
          `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, request_ip) VALUES ($1, $2, $3, $4);`,
          [user.id, tokenHash, expiresAt, clientIp],
        );
      }

      // Resolve workspace for audit event
      const workspaceId = await this.resolveUserWorkspaceId(client, user.id);

      // Record audit event (sanitized, zero token leakage)
      await recordAuditEvent(client, {
        workspaceId,
        actorUserId: user.id,
        action: 'auth.password_reset_requested',
        entityType: 'user',
        entityId: user.id,
        requestId,
        metadata: {
          client_ip: clientIp,
          delivery_status: genericResponse.delivery_status,
        },
      });

      await client.query('COMMIT');

      if (this.resetMailer) {
        // A provider acceptance is not proof of inbox delivery. Never disclose
        // recipient-specific outcomes in the anonymous HTTP response.
        let delivery: 'accepted' | 'failed' = 'failed';
        try {
          delivery = await this.resetMailer.send(normalizedEmail, rawToken);
        } catch {
          /* sanitized below */
        }
        if (delivery === 'failed') {
          await client.query(
            'UPDATE password_reset_tokens SET consumed_at = now() WHERE token_hash = $1 AND consumed_at IS NULL;',
            [tokenHash],
          );
        }
        await recordAuditEvent(client, {
          workspaceId,
          actorUserId: user.id,
          action:
            delivery === 'accepted'
              ? 'auth.password_reset_email_accepted'
              : 'auth.password_reset_email_failed',
          entityType: 'user',
          entityId: user.id,
          requestId,
          metadata: { provider: 'brevo', delivery_status: delivery },
        });
      }

      return genericResponse;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
      // Bound provider requests to 10s and pad all configured-email requests,
      // including unknown/inactive/unverified recipients, to the same 11s floor.
      // Release the connection before waiting; do not occupy the DB pool.
      if (this.resetMailer) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, 11000 - (Date.now() - startedAt))),
        );
      }
    }
  }

  /**
   * Resets password using a single-use token.
   * Validates token hash, expiry (15m TTL), password strength policy,
   * updates credentials, revokes all active sessions, and logs sanitized audit event.
   */
  async resetPasswordWithToken(params: {
    token: string;
    newPassword: string;
    clientIp: string;
    requestId: string;
  }): Promise<{ message: string }> {
    const { token, newPassword, clientIp, requestId } = params;

    const rateCheck = this.resetPasswordLimiter.increment(clientIp);
    if (!rateCheck.allowed) {
      throw new AuthError(
        'RATE_LIMITED',
        'Quá nhiều yêu cầu đặt lại mật khẩu. Vui lòng thử lại sau ít phút.',
        429,
        [{ message: `Thử lại sau ${rateCheck.retryAfterSeconds} giây` }],
      );
    }

    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Mã khôi phục không được để trống',
        400,
      );
    }

    const validation = validatePasswordStrength(newPassword);
    if (!validation.valid || typeof newPassword !== 'string') {
      throw new AuthError(
        'VALIDATION_ERROR',
        validation.reason || 'Mật khẩu không đáp ứng chính sách bảo mật',
        400,
      );
    }

    const newPasswordHash = await hashPassword(newPassword);
    const tokenHash = hashToken(token.trim());

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const tokenRes = await client.query<{
        id: string;
        user_id: string;
        expires_at: Date;
        consumed_at: Date | null;
      }>(
        `SELECT id, user_id, expires_at, consumed_at FROM password_reset_tokens WHERE token_hash = $1;`,
        [tokenHash],
      );

      const record = tokenRes.rows[0];
      if (!record || record.consumed_at !== null) {
        throw new AuthError(
          'INVALID_TOKEN',
          'Mã khôi phục không hợp lệ hoặc đã được sử dụng',
          400,
        );
      }

      // Concurrency serialization: Acquire exclusive row lock on the user record
      // to strictly serialize concurrent resets for the same user across all transactions.
      const eligible = await client.query<{
        status: string;
        email_verified: boolean;
      }>('SELECT status,email_verified FROM users WHERE id=$1 FOR UPDATE;', [
        record.user_id,
      ]);
      if (
        eligible.rows[0]?.status !== 'active' ||
        !eligible.rows[0]?.email_verified
      ) {
        throw new AuthError(
          'INVALID_TOKEN',
          'Mã khôi phục không hợp lệ hoặc đã được sử dụng',
          400,
        );
      }

      // Re-verify that this token was not consumed while waiting for the user lock
      const recheckRes = await client.query<{ consumed_at: Date | null }>(
        `SELECT consumed_at FROM password_reset_tokens WHERE id = $1 FOR UPDATE;`,
        [record.id],
      );
      if (!recheckRes.rows[0] || recheckRes.rows[0].consumed_at !== null) {
        throw new AuthError(
          'INVALID_TOKEN',
          'Mã khôi phục không hợp lệ hoặc đã được sử dụng',
          400,
        );
      }

      if (new Date(record.expires_at) <= new Date()) {
        await client.query(
          `UPDATE password_reset_tokens SET consumed_at = now() WHERE id = $1;`,
          [record.id],
        );
        throw new AuthError(
          'TOKEN_EXPIRED',
          'Mã khôi phục đã hết hạn. Vui lòng yêu cầu mã mới.',
          400,
        );
      }

      // Atomically invalidate ALL active recovery tokens of this user in the same transaction
      await client.query(
        `UPDATE password_reset_tokens SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL;`,
        [record.user_id],
      );

      // Update credentials and bump credential_version
      await client.query(
        `
        INSERT INTO user_credentials (user_id, password_hash, credential_version)
        VALUES ($1, $2, 1)
        ON CONFLICT (user_id)
        DO UPDATE SET password_hash = $2, credential_version = user_credentials.credential_version + 1, password_changed_at = now();
      `,
        [record.user_id, newPasswordHash],
      );

      // Revoke all active sessions for this user
      await client.query(
        `UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL;`,
        [record.user_id],
      );

      // Resolve workspace for audit event
      const workspaceId = await this.resolveUserWorkspaceId(
        client,
        record.user_id,
      );

      // Record audit event
      await recordAuditEvent(client, {
        workspaceId,
        actorUserId: record.user_id,
        action: 'auth.password_reset_completed',
        entityType: 'user',
        entityId: record.user_id,
        requestId,
        metadata: {
          client_ip: clientIp,
        },
      });

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    this.resetPasswordLimiter.reset(clientIp);

    return {
      message:
        'Mật khẩu đã được đặt lại thành công. Vui lòng đăng nhập bằng mật khẩu mới.',
    };
  }

  /**
   * Requests an email verification token and delivers a single-use verification link via Brevo.
   * Enforces IP + account-hash rate limiting, anti-enumeration response, 15m TTL,
   * prior unverified token revocation, and fail-closed revocation on provider failure.
   */
  async requestEmailVerification(params: {
    email: string;
    clientIp: string;
    requestId: string;
    /** Only true for an authenticated session requesting its own email (no enumeration risk). */
    revealDelivery?: boolean;
  }): Promise<{
    message: string;
    delivery_status: 'EMAIL_DELIVERY_BLOCKED' | 'EMAIL_DELIVERY_PENDING';
    delivered?: boolean;
    delivery_error?: string;
    sent_to?: string;
    sent_from?: string;
    expires_in_minutes?: number;
  }> {
    const { email, clientIp, requestId, revealDelivery = false } = params;

    if (!email || typeof email !== 'string' || email.trim().length === 0) {
      throw new AuthError('VALIDATION_ERROR', 'Email is required', 400, [
        { field: 'email', message: 'Email is required' },
      ]);
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes('@') || !normalizedEmail.includes('.')) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Địa chỉ email không đúng định dạng',
        400,
        [{ field: 'email', message: 'Địa chỉ email không đúng định dạng' }],
      );
    }

    const accountLimiterKey = `ev_acc:${hashToken(normalizedEmail)}`;
    const ipRateCheck = this.verifyEmailRequestLimiter.increment(clientIp);
    const accountRateCheck =
      this.verifyEmailAccountLimiter.increment(accountLimiterKey);

    if (!ipRateCheck.allowed || !accountRateCheck.allowed) {
      const retryAfter = Math.max(
        ipRateCheck.allowed ? 0 : ipRateCheck.retryAfterSeconds,
        accountRateCheck.allowed ? 0 : accountRateCheck.retryAfterSeconds,
      );
      throw new AuthError(
        'RATE_LIMITED',
        'Quá nhiều yêu cầu xác minh email. Vui lòng thử lại sau ít phút.',
        429,
        [{ message: `Thử lại sau ${retryAfter} giây` }],
      );
    }

    const genericResponse: {
      message: string;
      delivery_status: 'EMAIL_DELIVERY_BLOCKED' | 'EMAIL_DELIVERY_PENDING';
    } = {
      message:
        'Nếu tài khoản tồn tại và chưa xác minh email, hướng dẫn xác minh email đã được xử lý.',
      delivery_status: this.resetMailer
        ? 'EMAIL_DELIVERY_PENDING'
        : 'EMAIL_DELIVERY_BLOCKED',
    };

    const client = await this.pool.connect();
    try {
      const userRes = await client.query<{
        id: string;
        email_normalized: string;
        status: string;
        email_verified: boolean;
      }>(
        `SELECT id, email_normalized, status, email_verified
         FROM users
         WHERE email_normalized = $1
         LIMIT 1;`,
        [normalizedEmail],
      );

      const user = userRes.rows[0];
      if (
        !user ||
        (user.status !== 'active' && user.status !== 'pending_activation') ||
        user.email_verified
      ) {
        return genericResponse;
      }

      await client.query('BEGIN');

      const eligible = await client.query(
        `SELECT id FROM users
         WHERE id = $1
           AND email_normalized = $2
           AND status IN ('active', 'pending_activation')
           AND email_verified = false
         FOR UPDATE;`,
        [user.id, normalizedEmail],
      );
      if (!eligible.rowCount) {
        await client.query('ROLLBACK');
        return genericResponse;
      }

      // Revoke any existing unverified email verification tokens for this user
      await client.query(
        `UPDATE email_verifications
         SET proof_type = 'token_revoked',
             proof_metadata = COALESCE(proof_metadata, '{}'::jsonb) || jsonb_build_object('revoked_at', now(), 'revoke_reason', 'superseded')
         WHERE user_id = $1 AND verified_at IS NULL AND proof_type = 'token_confirmation';`,
        [user.id],
      );

      const rawToken = generateCsprngToken(32);
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

      if (this.resetMailer) {
        await client.query(
          `INSERT INTO email_verifications (user_id, email_normalized, token_hash, proof_type, proof_metadata, verified_at)
           VALUES ($1, $2, $3, 'token_confirmation', $4::jsonb, NULL);`,
          [
            user.id,
            normalizedEmail,
            tokenHash,
            JSON.stringify({ expires_at: expiresAt, request_ip: clientIp }),
          ],
        );
      }

      const workspaceId = await this.resolveUserWorkspaceId(client, user.id);
      await recordAuditEvent(client, {
        workspaceId,
        actorUserId: user.id,
        action: 'auth.email_verification_requested',
        entityType: 'user',
        entityId: user.id,
        requestId,
        metadata: {
          client_ip: clientIp,
          delivery_status: genericResponse.delivery_status,
        },
      });

      await client.query('COMMIT');

      let deliveryAccepted = false;
      let deliveryError: string | undefined = this.resetMailer
        ? undefined
        : 'mailer_not_configured';
      if (this.resetMailer) {
        let delivery: 'accepted' | 'failed' = 'failed';
        try {
          delivery = this.resetMailer.sendVerification
            ? await this.resetMailer.sendVerification(normalizedEmail, rawToken)
            : await this.resetMailer.send(normalizedEmail, rawToken);
        } catch {
          /* sanitized below */
        }

        deliveryAccepted = delivery === 'accepted';
        if (!deliveryAccepted) {
          deliveryError = this.resetMailer.lastFailure || 'send_failed';
        }
        if (delivery === 'failed') {
          await client.query(
            `UPDATE email_verifications
             SET proof_type = 'token_revoked',
                 proof_metadata = COALESCE(proof_metadata, '{}'::jsonb) || jsonb_build_object('revoked_at', now(), 'revoke_reason', 'delivery_failed')
             WHERE token_hash = $1 AND verified_at IS NULL;`,
            [tokenHash],
          );
        }

        await recordAuditEvent(client, {
          workspaceId,
          actorUserId: user.id,
          action:
            delivery === 'accepted'
              ? 'auth.email_verification_email_accepted'
              : 'auth.email_verification_email_failed',
          entityType: 'user',
          entityId: user.id,
          requestId,
          metadata: { provider: 'brevo', delivery_status: delivery },
        });
      }

      if (revealDelivery) {
        const [localPart = '', domain = ''] = normalizedEmail.split('@');
        const maskedLocal =
          localPart.length <= 2
            ? `${localPart.slice(0, 1)}***`
            : `${localPart.slice(0, 2)}***${localPart.slice(-1)}`;
        return {
          ...genericResponse,
          delivered: Boolean(this.resetMailer) && deliveryAccepted,
          ...(deliveryError ? { delivery_error: deliveryError } : {}),
          sent_to: `${maskedLocal}@${domain}`,
          sent_from: 'no-reply@hoaiphuong.click',
          expires_in_minutes: 15,
        };
      }
      return genericResponse;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Confirms an email verification token and marks the user's email as verified
   * with cryptographic proof in a single database transaction.
   * Enforces rate limiting, 15m TTL, single-use anti-replay, and exact user/email match.
   */
  async verifyEmailWithProof(params: {
    token: string;
    clientIp?: string;
    requestId?: string;
    proofType?: string;
    proofMetadata?: Record<string, unknown>;
  }): Promise<{
    success: boolean;
    message: string;
    email_verified: boolean;
    verified_at: string;
  }> {
    const {
      token,
      clientIp = '127.0.0.1',
      requestId = 'email-verification-confirm',
      proofType = 'token_confirmation',
      proofMetadata,
    } = params;

    const rateCheck = this.verifyEmailConfirmLimiter.increment(clientIp);
    if (!rateCheck.allowed) {
      throw new AuthError(
        'RATE_LIMITED',
        'Quá nhiều yêu cầu xác minh email. Vui lòng thử lại sau ít phút.',
        429,
        [{ message: `Thử lại sau ${rateCheck.retryAfterSeconds} giây` }],
      );
    }

    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Mã xác minh email không được để trống',
        400,
        [{ field: 'token', message: 'Mã xác minh email không được để trống' }],
      );
    }

    const tokenHash = hashToken(token.trim());
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const tokenRes = await client.query<{
        id: string;
        user_id: string;
        email_normalized: string;
        proof_type: string;
        proof_metadata: Record<string, unknown> | null;
        verified_at: Date | null;
        created_at: Date;
      }>(
        `SELECT id, user_id, email_normalized, proof_type, proof_metadata, verified_at, created_at
         FROM email_verifications
         WHERE token_hash = $1;`,
        [tokenHash],
      );

      const record = tokenRes.rows[0];
      if (
        !record ||
        record.verified_at !== null ||
        record.proof_type !== 'token_confirmation' ||
        Boolean(record.proof_metadata?.['revoked_at'])
      ) {
        throw new AuthError(
          'INVALID_TOKEN',
          'Mã xác minh email không hợp lệ hoặc đã được sử dụng',
          400,
        );
      }

      // Consistent lock ordering: lock user row first, then email_verifications row
      const userRes = await client.query<{
        id: string;
        email_normalized: string;
        status: string;
        email_verified: boolean;
      }>(
        `SELECT id, email_normalized, status, email_verified
         FROM users
         WHERE id = $1
         FOR UPDATE;`,
        [record.user_id],
      );
      const user = userRes.rows[0];

      const recheckRes = await client.query<{
        id: string;
        user_id: string;
        email_normalized: string;
        proof_type: string;
        proof_metadata: Record<string, unknown> | null;
        verified_at: Date | null;
        created_at: Date;
      }>(
        `SELECT id, user_id, email_normalized, proof_type, proof_metadata, verified_at, created_at
         FROM email_verifications
         WHERE id = $1
         FOR UPDATE;`,
        [record.id],
      );
      const recheck = recheckRes.rows[0];

      if (
        !recheck ||
        recheck.verified_at !== null ||
        recheck.proof_type !== 'token_confirmation' ||
        Boolean(recheck.proof_metadata?.['revoked_at'])
      ) {
        throw new AuthError(
          'INVALID_TOKEN',
          'Mã xác minh email không hợp lệ hoặc đã được sử dụng',
          400,
        );
      }

      if (
        !user ||
        (user.status !== 'active' && user.status !== 'pending_activation') ||
        user.email_normalized !== recheck.email_normalized
      ) {
        await client.query(
          `UPDATE email_verifications
           SET proof_type = 'token_revoked',
               proof_metadata = COALESCE(proof_metadata, '{}'::jsonb) || jsonb_build_object('revoked_at', now(), 'revoke_reason', 'user_or_email_mismatch')
           WHERE id = $1;`,
          [recheck.id],
        );
        await client.query('COMMIT');
        throw new AuthError(
          'INVALID_TOKEN',
          'Mã xác minh email không hợp lệ hoặc đã được sử dụng',
          400,
        );
      }

      const rawExpiresAt = recheck.proof_metadata?.['expires_at'];
      const expiresAt =
        typeof rawExpiresAt === 'string' && rawExpiresAt.length > 0
          ? new Date(rawExpiresAt)
          : new Date(new Date(recheck.created_at).getTime() + 15 * 60 * 1000);

      if (expiresAt <= new Date()) {
        await client.query(
          `UPDATE email_verifications
           SET proof_type = 'token_expired',
               proof_metadata = COALESCE(proof_metadata, '{}'::jsonb) || jsonb_build_object('revoked_at', now(), 'revoke_reason', 'expired')
           WHERE id = $1;`,
          [recheck.id],
        );
        await client.query('COMMIT');
        throw new AuthError(
          'TOKEN_EXPIRED',
          'Mã xác minh email đã hết hạn. Vui lòng yêu cầu gửi lại email xác minh mới.',
          400,
        );
      }

      const verifiedAtIso = new Date().toISOString();
      const confirmedMeta = {
        confirmed_ip: clientIp,
        verified_at: verifiedAtIso,
        ...(proofMetadata || {}),
      };

      await client.query(
        `UPDATE email_verifications
         SET verified_at = $2,
             proof_type = $3,
             proof_metadata = COALESCE(proof_metadata, '{}'::jsonb) || $4::jsonb
         WHERE id = $1 AND verified_at IS NULL;`,
        [recheck.id, verifiedAtIso, proofType, JSON.stringify(confirmedMeta)],
      );

      // Revoke any other pending verification tokens for this user
      await client.query(
        `UPDATE email_verifications
         SET proof_type = 'token_revoked',
             proof_metadata = COALESCE(proof_metadata, '{}'::jsonb) || jsonb_build_object('revoked_at', now(), 'revoke_reason', 'superseded_by_verification')
         WHERE user_id = $1 AND id != $2 AND verified_at IS NULL;`,
        [user.id, recheck.id],
      );

      const proofRecord = JSON.stringify({
        proofType,
        verificationId: recheck.id,
        emailNormalized: user.email_normalized,
        verifiedAt: verifiedAtIso,
      });

      await client.query(
        `UPDATE users
         SET email_verified = true,
             email_verified_at = $2,
             email_verification_proof = $3,
             version = version + 1
         WHERE id = $1;`,
        [user.id, verifiedAtIso, proofRecord],
      );

      const workspaceId = await this.resolveUserWorkspaceId(client, user.id);
      await recordAuditEvent(client, {
        workspaceId,
        actorUserId: user.id,
        action: 'auth.email_verified',
        entityType: 'user',
        entityId: user.id,
        requestId,
        metadata: {
          proof_type: proofType,
          verification_id: recheck.id,
          client_ip: clientIp,
        },
      });

      await client.query('COMMIT');
      this.verifyEmailConfirmLimiter.reset(clientIp);

      return {
        success: true,
        message: 'Địa chỉ email đã được xác minh thành công.',
        email_verified: true,
        verified_at: verifiedAtIso,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Alias for verifyEmailWithProof used by the HTTP confirmation endpoint.
   */
  async confirmEmailVerification(params: {
    token: string;
    clientIp: string;
    requestId: string;
  }): Promise<{
    success: boolean;
    message: string;
    email_verified: boolean;
    verified_at: string;
  }> {
    return this.verifyEmailWithProof({
      token: params.token,
      clientIp: params.clientIp,
      requestId: params.requestId,
      proofType: 'token_confirmation',
    });
  }

  /**
   * Updates a user's normalized email address, resets email_verified=false,
   * and atomically revokes all pending email verification and password reset tokens.
   */
  async changeUserEmail(params: {
    userId: string;
    newEmail: string;
    clientIp?: string;
    requestId?: string;
  }): Promise<{ email: string; email_verified: boolean }> {
    const {
      userId,
      newEmail,
      clientIp = '127.0.0.1',
      requestId = 'email-change',
    } = params;

    if (
      !newEmail ||
      typeof newEmail !== 'string' ||
      !newEmail.trim().includes('@') ||
      !newEmail.trim().includes('.')
    ) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Địa chỉ email mới không hợp lệ',
        400,
        [{ field: 'email', message: 'Địa chỉ email mới không hợp lệ' }],
      );
    }

    const normalizedNewEmail = newEmail.trim().toLowerCase();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const userRes = await client.query<{
        id: string;
        email_normalized: string;
      }>(`SELECT id, email_normalized FROM users WHERE id = $1 FOR UPDATE;`, [
        userId,
      ]);
      const user = userRes.rows[0];
      if (!user) {
        throw new AuthError('NOT_FOUND', 'User not found', 404);
      }

      const conflictRes = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE email_normalized = $1 AND id != $2 LIMIT 1;`,
        [normalizedNewEmail, userId],
      );
      if (conflictRes.rows.length > 0) {
        throw new AuthError(
          'CONFLICT',
          'Địa chỉ email này đã được sử dụng bởi tài khoản khác',
          409,
        );
      }

      await client.query(
        `UPDATE users
         SET email_normalized = $2,
             email_verified = false,
             email_verified_at = NULL,
             email_verification_proof = NULL,
             version = version + 1
         WHERE id = $1;`,
        [userId, normalizedNewEmail],
      );

      // Revoke all pending email verification tokens for this user
      await client.query(
        `UPDATE email_verifications
         SET proof_type = 'token_revoked',
             proof_metadata = COALESCE(proof_metadata, '{}'::jsonb) || jsonb_build_object('revoked_at', now(), 'revoke_reason', 'email_changed')
         WHERE user_id = $1 AND verified_at IS NULL;`,
        [userId],
      );

      // Revoke all unconsumed password reset tokens for this user
      await client.query(
        `UPDATE password_reset_tokens
         SET consumed_at = now()
         WHERE user_id = $1 AND consumed_at IS NULL;`,
        [userId],
      );

      const workspaceId = await this.resolveUserWorkspaceId(client, userId);
      await recordAuditEvent(client, {
        workspaceId,
        actorUserId: userId,
        action: 'auth.email_changed',
        entityType: 'user',
        entityId: userId,
        requestId,
        metadata: {
          client_ip: clientIp,
        },
      });

      await client.query('COMMIT');
      return { email: normalizedNewEmail, email_verified: false };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  private async resolveUserWorkspaceId(
    client: {
      query: (
        sql: string,
        params?: unknown[],
      ) => Promise<{ rows: Array<{ id?: string; workspace_id?: string }> }>;
    },
    userId: string,
  ): Promise<string> {
    const wsRes = await client.query(
      `SELECT workspace_id FROM workspace_memberships WHERE user_id = $1 LIMIT 1;`,
      [userId],
    );
    const workspaceId = wsRes.rows[0]?.workspace_id;
    if (workspaceId) return workspaceId;

    const fallbackWsRes = await client.query(
      `SELECT id FROM workspaces LIMIT 1;`,
    );
    return fallbackWsRes.rows[0]?.id || '00000000-0000-0000-0000-000000000000';
  }
}
