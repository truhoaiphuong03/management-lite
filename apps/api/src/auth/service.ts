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
  public readonly changePasswordLimiter: RateLimiter;

  constructor(
    private readonly pool: DatabasePool,
    private readonly csrfSecret: string,
    options: {
      loginLimiter?: RateLimiter;
      changePasswordLimiter?: RateLimiter;
    } = {},
  ) {
    this.loginLimiter =
      options.loginLimiter ??
      new RateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 5 });
    this.changePasswordLimiter =
      options.changePasswordLimiter ??
      new RateLimiter({ windowMs: 15 * 60 * 1000, maxAttempts: 5 });
  }

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
  }): Promise<{ sessionToken: string; responseData: LoginResponseData }> {
    const { identifier, password, clientIp, requestId } = params;

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

    // 2. Query user identity & credentials
    const userRes = await this.pool.query<{
      id: string;
      username_normalized: string;
      email_normalized: string;
      user_status: string;
      password_hash: string | null;
      credential_version: number | null;
    }>(
      `
      SELECT
        u.id,
        u.username_normalized,
        u.email_normalized,
        u.status AS user_status,
        uc.password_hash,
        uc.credential_version
      FROM users u
      LEFT JOIN user_credentials uc ON uc.user_id = u.id
      WHERE u.username_normalized = $1 OR u.email_normalized = $1
    `,
      [normalizedIdentifier],
    );

    // SEC-05A: reject ambiguous identity snapshots before password verification.
    // SEC-05B namespace changes racing with session issuance remain unresolved.
    const distinctUserIds = new Set(userRes.rows.map((row) => row.id));
    if (distinctUserIds.size > 1) {
      await verifyPassword(password, await getDummyHash());
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid credentials', 401);
    }
    const userRow = userRes.rows[0];

    // Constant-time anti-enumeration when user does not exist, has no credentials, or is not active
    if (
      !userRow ||
      !userRow.password_hash ||
      userRow.user_status !== 'active'
    ) {
      await verifyPassword(password, await getDummyHash());
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid credentials', 401);
    }

    // 3. Verify Argon2id password hash
    const passwordMatch = await verifyPassword(password, userRow.password_hash);
    if (!passwordMatch) {
      throw new AuthError('INVALID_CREDENTIALS', 'Invalid credentials', 401);
    }

    // Reset rate limiter on successful credentials
    this.loginLimiter.reset(clientIp);

    // 4. Resolve C06 active workspace binding
    // Architectural Note: An active membership represents membership existence.
    // A preauthorized active binding is an explicitly provisioned binding authorizing login session context.
    // When 0 active memberships exist: fail closed 409 WORKSPACE_CONTEXT_UNRESOLVED.
    // When > 1 active memberships exist: without an explicit preauthorized binding flag/table,
    // the backend cannot determine which workspace was preauthorized, and MUST fail closed 409.
    // Client-supplied workspace_id is NEVER accepted as authority.
    const membershipRes = await this.pool.query<{
      membership_id: string;
      workspace_id: string;
      role: UserRole;
      membership_status: string;
      workspace_name: string;
      timezone: string;
      workspace_status: string;
    }>(
      `
      SELECT
        wm.id AS membership_id,
        wm.workspace_id,
        wm.role,
        wm.status AS membership_status,
        w.name AS workspace_name,
        w.timezone,
        w.status AS workspace_status
      FROM workspace_memberships wm
      JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = $1
        AND wm.status = 'active'
        AND w.status = 'active'
    `,
      [userRow.id],
    );

    const activeMemberships = membershipRes.rows;

    if (activeMemberships.length === 0) {
      throw new AuthError(
        'WORKSPACE_CONTEXT_UNRESOLVED',
        'Workspace context could not be resolved',
        409,
      );
    }

    if (activeMemberships.length > 1) {
      throw new AuthError(
        'WORKSPACE_CONTEXT_UNRESOLVED',
        'Workspace context could not be resolved',
        409,
      );
    }

    const chosenMembership = activeMemberships[0]!;

    // 5. Issue session with CSPRNG token (32 bytes = 256 bits entropy)
    const sessionToken = generateCsprngToken(32);
    const sessionTokenHash = hashToken(sessionToken);

    const now = new Date();
    const idleExpiresAt = new Date(now.getTime() + 30 * 60 * 1000); // 30m idle timeout
    const absoluteExpiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000); // 12h absolute timeout

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
          absolute_expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $5, $6, $7)
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
      responseData: {
        user: {
          id: userRow.id,
          username: userRow.username_normalized,
          email: userRow.email_normalized,
        },
        active_workspace: {
          id: chosenMembership.workspace_id,
          name: chosenMembership.workspace_name,
          timezone: chosenMembership.timezone,
          role: chosenMembership.role,
        },
        session_expires_at: absoluteExpiresAt.toISOString(),
        csrf_token: csrfToken,
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
      username_normalized: string;
      email_normalized: string;
      role: UserRole;
      workspace_name: string;
      timezone: string;
    }>(
      `
      UPDATE auth_sessions s
      SET last_seen_at = $1,
          idle_expires_at = LEAST($2, s.absolute_expires_at)
      FROM users u, user_credentials uc, workspace_memberships wm, workspaces w
      WHERE s.session_token_hash = $3
        AND s.user_id = u.id
        AND uc.user_id = s.user_id
        AND wm.workspace_id = s.workspace_id AND wm.user_id = s.user_id
        AND w.id = s.workspace_id
        AND s.revoked_at IS NULL
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
        u.username_normalized,
        u.email_normalized,
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

    return {
      sessionId: row.session_id,
      sessionTokenHash: row.session_token_hash,
      user: {
        id: row.user_id,
        username: row.username_normalized,
        email: row.email_normalized,
      },
      workspace: {
        id: row.workspace_id,
        name: row.workspace_name,
        timezone: row.timezone,
        role: row.role,
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

    const permissions =
      context.workspace.role === 'owner'
        ? [...OWNER_PERMISSIONS]
        : [...STAFF_PERMISSIONS];

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
    };
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

    // 4. Hash new password with Argon2id before transaction to minimize lock duration
    const newPasswordHash = await hashPassword(newPassword);

    // 5. Transactional update with row-level lock to prevent concurrent password modification races
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

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
}
