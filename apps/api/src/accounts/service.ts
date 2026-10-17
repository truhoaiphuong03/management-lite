import type { DatabasePool } from '../../../../packages/database/src/pool.js';
import { recordAuditEvent } from '../../../../packages/database/src/audit.js';
import {
  claimIdempotency,
  completeIdempotency,
  computeRequestFingerprint,
} from '../../../../packages/database/src/idempotency.js';
import {
  generateCsprngToken,
  hashToken,
} from '../../../../packages/security/src/tokens.js';
import { verifyPassword } from '../../../../packages/security/src/password.js';
import {
  encryptSecretAead,
  decryptSecretAead,
} from '../../../../packages/security/src/aead.js';
import { AuthError, type AuthenticatedContext } from '../auth/service.js';
import { requireRole } from '../auth/guard.js';
import type {
  AccountPlatform,
  AccountSecretType,
  ManagedAccountData,
  ManagedAccountDetailData,
  CreateAccountRequest,
  UpdateAccountRequest,
  ArchiveAccountRequest,
  PutAccountSecretRequest,
  PutAccountSecretResponseData,
  RevealAccountSecretRequest,
  RevealAccountSecretResponseData,
  AccountListResponseData,
} from '../../../../packages/contracts/src/accounts.js';
import type {
  ReauthRequestBody,
  ReauthResponseData,
} from '../../../../packages/contracts/src/auth.js';

export const ALLOWED_PLATFORMS: AccountPlatform[] = [
  'tiktok',
  'gmail',
  'ai',
  'pm',
  'other',
];

export const ALLOWED_SECRET_TYPES: AccountSecretType[] = [
  'password',
  'api_key',
  'recovery_code',
  'totp_secret',
  'two_fa_secret',
  'email_password',
];

export class AccountsService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly encryptionKey?: Buffer | undefined,
  ) {}

  private normalizeOptionalEmail(
    val: unknown,
    fieldName = 'recovery_email',
  ): string | null {
    if (val === undefined || val === null) return null;
    if (typeof val !== 'string') {
      throw new AuthError(
        'VALIDATION_ERROR',
        `${fieldName} must be a string`,
        400,
      );
    }
    const trimmed = val.trim().toLowerCase();
    if (!trimmed) return null;
    if (trimmed.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      throw new AuthError(
        'VALIDATION_ERROR',
        `Email khôi phục (${fieldName}) không hợp lệ`,
        400,
      );
    }
    return trimmed;
  }

  private normalizeOptionalGroup(val: unknown): string | null {
    if (val === undefined || val === null) return null;
    if (typeof val !== 'string') {
      throw new AuthError(
        'VALIDATION_ERROR',
        'account_group must be a string',
        400,
      );
    }
    const trimmed = val.trim();
    if (!trimmed) return null;
    if (trimmed.length > 100) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'Nhóm tài khoản tối đa 100 ký tự',
        400,
      );
    }
    return trimmed;
  }

  private mapAccountRow(r: Record<string, any>): ManagedAccountData {
    return {
      id: r.id,
      workspace_id: r.workspace_id,
      platform: r.platform,
      username: r.username ?? null,
      platform_account_id: r.platform_account_id ?? null,
      recovery_email: r.recovery_email ?? null,
      account_group: r.account_group ?? null,
      assigned_employee_id: r.assigned_employee_id ?? null,
      assigned_employee_name: r.assigned_employee_name ?? null,
      assigned_employee_code: r.assigned_employee_code ?? null,
      status: r.status,
      notes: r.notes ?? null,
      version: r.version,
      created_at: new Date(r.created_at).toISOString(),
      updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null,
    };
  }

  /**
   * Asserts valid UUID format to prevent malformed queries.
   */
  private assertUuid(val: unknown, paramName = 'id'): string {
    if (
      typeof val !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        val,
      )
    ) {
      throw new AuthError(
        'VALIDATION_ERROR',
        `Invalid ${paramName}: must be a valid UUID`,
        400,
      );
    }
    return val.toLowerCase();
  }

  /**
   * Asserts and parses strong If-Match header value.
   */
  private assertIfMatchVersion(ifMatch: string | undefined): number {
    if (!ifMatch) {
      throw new AuthError(
        'PRECONDITION_REQUIRED',
        'If-Match header is required for state mutation',
        428,
      );
    }
    const match = ifMatch.match(/^"?([0-9]+)"?$/);
    if (!match || !match[1]) {
      throw new AuthError(
        'PRECONDITION_FAILED',
        'Malformed If-Match header',
        412,
      );
    }
    const parsed = Number.parseInt(match[1], 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new AuthError(
        'PRECONDITION_FAILED',
        'Invalid version in If-Match header',
        412,
      );
    }
    return parsed;
  }

  /**
   * POST /api/v1/auth/reauth
   * Issues a short-lived (5 min max), single-use reauthentication proof
   * bound to the current user, session, target account, and action.
   */
  async reauth(
    context: AuthenticatedContext,
    body: ReauthRequestBody,
    requestId: string,
  ): Promise<ReauthResponseData> {
    requireRole(['owner'], context);

    if (!body || typeof body !== 'object') {
      throw new AuthError('VALIDATION_ERROR', 'Request body required', 400);
    }

    const { password, action, account_id } = body;
    if (typeof password !== 'string' || !password) {
      throw new AuthError('VALIDATION_ERROR', 'Password is required', 400);
    }
    if (action !== 'secret_write' && action !== 'secret_reveal') {
      throw new AuthError(
        'VALIDATION_ERROR',
        "Action must be 'secret_write' or 'secret_reveal'",
        400,
      );
    }
    const cleanAccountId = this.assertUuid(account_id, 'account_id');

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Verify account exists in active workspace
      const accRes = await client.query(
        'SELECT id FROM managed_accounts WHERE id = $1 AND workspace_id = $2 FOR SHARE;',
        [cleanAccountId, context.workspace.id],
      );
      if (accRes.rows.length === 0) {
        throw new AuthError('NOT_FOUND', 'Managed account not found', 404);
      }

      // 2. Verify Owner's current password
      const credRes = await client.query(
        'SELECT password_hash FROM user_credentials WHERE user_id = $1;',
        [context.user.id],
      );
      if (credRes.rows.length === 0) {
        throw new AuthError(
          'UNAUTHENTICATED',
          'User credentials not found',
          401,
        );
      }
      const isValid = await verifyPassword(
        password,
        credRes.rows[0].password_hash,
      );
      if (!isValid) {
        throw new AuthError(
          'UNAUTHENTICATED',
          'Mật khẩu xác thực lại không chính xác',
          401,
        );
      }

      // 3. Verify current session is not revoked
      const sessRes = await client.query(
        'SELECT id FROM auth_sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND idle_expires_at > clock_timestamp() AND absolute_expires_at > clock_timestamp();',
        [context.sessionId, context.user.id],
      );
      if (sessRes.rows.length === 0) {
        throw new AuthError(
          'UNAUTHENTICATED',
          'Session is invalid, revoked, or expired',
          401,
        );
      }

      // 4. Generate 256-bit CSPRNG token (64 hex characters) and its SHA-256 hash
      const rawProof = generateCsprngToken(32);
      const proofHash = hashToken(rawProof);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes TTL

      // 5. Insert proof into account_reauth_proofs
      await client.query(
        `INSERT INTO account_reauth_proofs (
          workspace_id, user_id, session_id, account_id, action, proof_hash, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7);`,
        [
          context.workspace.id,
          context.user.id,
          context.sessionId,
          cleanAccountId,
          action,
          proofHash,
          expiresAt,
        ],
      );

      // 6. Record audit event (NEVER include rawProof or proofHash in audit)
      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'account_reauth_issue',
        entityType: 'managed_account',
        entityId: cleanAccountId,
        requestId,
        metadata: {
          action,
          expires_at: expiresAt.toISOString(),
        },
      });

      await client.query('COMMIT');

      return {
        reauth_proof: rawProof,
        expires_at: expiresAt.toISOString(),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Consumes a single-use reauthentication proof within a transaction.
   * Fails closed with 403 REAUTH_REQUIRED if proof is invalid, expired, already used,
   * or not bound to the exact workspace, user, session, account, and action.
   */
  private async consumeReauthProof(
    client: { query: DatabasePool['query'] },
    context: AuthenticatedContext,
    accountId: string,
    action: 'secret_write' | 'secret_reveal',
    rawProof: string,
  ): Promise<void> {
    if (typeof rawProof !== 'string' || !rawProof.trim()) {
      throw new AuthError(
        'REAUTH_REQUIRED',
        'Reauthentication proof is required',
        403,
      );
    }

    const proofHash = hashToken(rawProof.trim());

    // 1. Lock and check the proof record
    const res = await client.query(
      `SELECT id, expires_at, used_at, user_id, session_id, action, account_id
       FROM account_reauth_proofs
       WHERE proof_hash = $1
         AND workspace_id = $2
         AND account_id = $3
         AND action = $4
       FOR UPDATE;`,
      [proofHash, context.workspace.id, accountId, action],
    );

    if (res.rows.length === 0) {
      throw new AuthError(
        'REAUTH_REQUIRED',
        'Invalid or unauthorized reauthentication proof',
        403,
      );
    }

    const row = res.rows[0];

    // 2. Validate single-use status
    if (row.used_at !== null) {
      throw new AuthError(
        'REAUTH_REQUIRED',
        'Reauthentication proof has already been used',
        403,
      );
    }

    // 3. Validate expiration (maximum 5 minutes)
    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw new AuthError(
        'REAUTH_REQUIRED',
        'Reauthentication proof has expired',
        403,
      );
    }

    // 4. Validate user and session binding
    if (
      row.user_id !== context.user.id ||
      row.session_id !== context.sessionId
    ) {
      throw new AuthError(
        'REAUTH_REQUIRED',
        'Reauthentication proof does not match current session',
        403,
      );
    }

    // 5. Verify the associated session is not revoked
    const sessRes = await client.query(
      'SELECT id FROM auth_sessions WHERE id = $1 AND revoked_at IS NULL;',
      [context.sessionId],
    );
    if (sessRes.rows.length === 0) {
      throw new AuthError(
        'UNAUTHENTICATED',
        'Session has been revoked or terminated',
        401,
      );
    }

    // 6. Atomically mark proof as used
    await client.query(
      'UPDATE account_reauth_proofs SET used_at = clock_timestamp() WHERE id = $1;',
      [row.id],
    );
  }

  /**
   * GET /api/v1/accounts
   * Lists managed account metadata for the active workspace.
   * Owner only. NEVER returns secret ciphertext or plaintext.
   */
  async listAccounts(
    context: AuthenticatedContext,
    query: URLSearchParams,
  ): Promise<AccountListResponseData> {
    requireRole(['owner'], context);

    const platform = query.get('platform');
    const status = query.get('status') || 'active';
    const accountGroup = (query.get('account_group') || '').trim();
    const assignedEmployeeId = (query.get('assigned_employee_id') || '').trim();
    const search = (query.get('search') || '').trim();

    if (platform && !ALLOWED_PLATFORMS.includes(platform as AccountPlatform)) {
      throw new AuthError('VALIDATION_ERROR', 'Invalid platform filter', 400);
    }
    if (status !== 'active' && status !== 'archived' && status !== 'all') {
      throw new AuthError('VALIDATION_ERROR', 'Invalid status filter', 400);
    }

    const conditions: string[] = ['ma.workspace_id = $1'];
    const params: unknown[] = [context.workspace.id];

    if (status !== 'all') {
      params.push(status);
      conditions.push(`ma.status = $${params.length}`);
    }

    if (platform) {
      params.push(platform);
      conditions.push(`ma.platform = $${params.length}`);
    }

    if (accountGroup && accountGroup !== 'all') {
      params.push(accountGroup.toLowerCase());
      conditions.push(
        `LOWER(COALESCE(ma.account_group, '')) = $${params.length}`,
      );
    }

    if (assignedEmployeeId && assignedEmployeeId !== 'all') {
      if (assignedEmployeeId === 'unassigned') {
        conditions.push('ma.assigned_employee_id IS NULL');
      } else {
        const cleanAssignee = this.assertUuid(
          assignedEmployeeId,
          'assigned_employee_id',
        );
        params.push(cleanAssignee);
        conditions.push(`ma.assigned_employee_id = $${params.length}`);
      }
    }

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      const pIdx = params.length;
      conditions.push(
        `(LOWER(COALESCE(ma.username, '')) LIKE $${pIdx} OR LOWER(COALESCE(ma.platform_account_id, '')) LIKE $${pIdx} OR LOWER(COALESCE(ma.recovery_email, '')) LIKE $${pIdx} OR LOWER(COALESCE(ma.account_group, '')) LIKE $${pIdx} OR LOWER(COALESCE(ma.notes, '')) LIKE $${pIdx} OR LOWER(COALESCE(e.full_name, '')) LIKE $${pIdx} OR LOWER(COALESCE(e.employee_code, '')) LIKE $${pIdx})`,
      );
    }

    const sql = `
      SELECT
        ma.id, ma.workspace_id, ma.platform, ma.platform_account_id, ma.username,
        ma.recovery_email, ma.account_group, ma.assigned_employee_id,
        e.full_name AS assigned_employee_name, e.employee_code AS assigned_employee_code,
        ma.status, ma.notes, ma.version, ma.created_at, ma.updated_at
      FROM managed_accounts ma
      LEFT JOIN employees e
        ON e.workspace_id = ma.workspace_id AND e.id = ma.assigned_employee_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ma.created_at DESC;
    `;

    const res = await this.pool.query(sql, params);
    const items: ManagedAccountData[] = res.rows.map((r) =>
      this.mapAccountRow(r),
    );

    return {
      items,
      total: items.length,
    };
  }

  /**
   * POST /api/v1/accounts
   * Creates new managed account metadata (and optional AEAD-encrypted initial secrets).
   * Owner only. Idempotency supported.
   */
  async createAccount(
    context: AuthenticatedContext,
    body: CreateAccountRequest,
    requestId: string,
    idempotencyKey?: string,
  ): Promise<ManagedAccountData> {
    requireRole(['owner'], context);

    if (!body || typeof body !== 'object') {
      throw new AuthError('VALIDATION_ERROR', 'Request body required', 400);
    }

    const {
      platform,
      username,
      platform_account_id,
      recovery_email,
      account_group,
      assigned_employee_id,
      status,
      notes,
      initial_secrets,
    } = body;
    if (!platform || !ALLOWED_PLATFORMS.includes(platform)) {
      throw new AuthError(
        'VALIDATION_ERROR',
        `Platform must be one of: ${ALLOWED_PLATFORMS.join(', ')}`,
        400,
      );
    }

    const cleanStatus = status === 'archived' ? 'archived' : 'active';
    if (status !== undefined && status !== 'active' && status !== 'archived') {
      throw new AuthError(
        'VALIDATION_ERROR',
        "status must be 'active' or 'archived'",
        400,
      );
    }

    const cleanUsername =
      typeof username === 'string' && username.trim() ? username.trim() : null;
    const cleanPlatformAccId =
      typeof platform_account_id === 'string' && platform_account_id.trim()
        ? platform_account_id.trim()
        : null;
    const cleanRecoveryEmail = this.normalizeOptionalEmail(
      recovery_email,
      'recovery_email',
    );
    const cleanAccountGroup = this.normalizeOptionalGroup(account_group);
    const cleanAssignedEmployeeId =
      typeof assigned_employee_id === 'string' && assigned_employee_id.trim()
        ? this.assertUuid(assigned_employee_id.trim(), 'assigned_employee_id')
        : null;
    const cleanNotes =
      typeof notes === 'string' && notes.trim() ? notes.trim() : null;

    const validInitialSecrets: Array<{
      secret_type: AccountSecretType;
      secret_value: string;
    }> = [];
    if (Array.isArray(initial_secrets)) {
      for (const item of initial_secrets) {
        if (!item || typeof item !== 'object') continue;
        const st = item.secret_type;
        const sv =
          typeof item.secret_value === 'string' ? item.secret_value : '';
        if (!sv) continue;
        if (!st || !ALLOWED_SECRET_TYPES.includes(st)) {
          throw new AuthError(
            'VALIDATION_ERROR',
            `secret_type must be one of: ${ALLOWED_SECRET_TYPES.join(', ')}`,
            400,
          );
        }
        if (sv.length > 4096) {
          throw new AuthError(
            'VALIDATION_ERROR',
            'secret_value is too long',
            400,
          );
        }
        validInitialSecrets.push({ secret_type: st, secret_value: sv });
      }
    }

    if (validInitialSecrets.length > 0 && !this.encryptionKey) {
      throw new AuthError(
        'SERVICE_UNAVAILABLE',
        'Secret vault encryption key is unavailable or unconfigured',
        503,
      );
    }

    const operationKey = `ACCOUNT_CREATE:${idempotencyKey || ''}`;
    const fingerprintPayload = {
      platform,
      username: cleanUsername,
      platform_account_id: cleanPlatformAccId,
      recovery_email: cleanRecoveryEmail,
      account_group: cleanAccountGroup,
      assigned_employee_id: cleanAssignedEmployeeId,
      status: cleanStatus,
      notes: cleanNotes,
      initial_secret_hashes: validInitialSecrets.map((s) => ({
        secret_type: s.secret_type,
        hash: hashToken(s.secret_value),
      })),
    };

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      if (idempotencyKey) {
        const claim = await claimIdempotency(client, {
          workspaceId: context.workspace.id,
          actorUserId: context.user.id,
          operationKey,
          requestFingerprint: computeRequestFingerprint(
            'POST',
            '/api/v1/accounts',
            fingerprintPayload,
          ),
        });
        if (claim.status === 'replay') {
          await client.query('COMMIT');
          return claim.sanitizedResponse as ManagedAccountData;
        }
        if (claim.status !== 'claimed') {
          throw new AuthError(
            'IDEMPOTENCY_CONFLICT',
            'Idempotency request cannot be replayed',
            409,
          );
        }
      }

      let assignedEmployeeName: string | null = null;
      let assignedEmployeeCode: string | null = null;
      if (cleanAssignedEmployeeId) {
        const empRes = await client.query(
          'SELECT id, full_name, employee_code FROM employees WHERE workspace_id = $1 AND id = $2 FOR SHARE;',
          [context.workspace.id, cleanAssignedEmployeeId],
        );
        if (empRes.rows.length === 0) {
          throw new AuthError(
            'VALIDATION_ERROR',
            'Nhân viên phụ trách không tồn tại trong workspace này',
            400,
          );
        }
        assignedEmployeeName = empRes.rows[0].full_name;
        assignedEmployeeCode = empRes.rows[0].employee_code;
      }

      const insertRes = await client.query(
        `INSERT INTO managed_accounts (
          workspace_id, platform, username, platform_account_id,
          recovery_email, account_group, assigned_employee_id,
          notes, status, version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)
        RETURNING id, workspace_id, platform, platform_account_id, username,
          recovery_email, account_group, assigned_employee_id,
          status, notes, version, created_at, updated_at;`,
        [
          context.workspace.id,
          platform,
          cleanUsername,
          cleanPlatformAccId,
          cleanRecoveryEmail,
          cleanAccountGroup,
          cleanAssignedEmployeeId,
          cleanNotes,
          cleanStatus,
        ],
      );

      const r = insertRes.rows[0];
      const createdData: ManagedAccountData = this.mapAccountRow({
        ...r,
        assigned_employee_name: assignedEmployeeName,
        assigned_employee_code: assignedEmployeeCode,
      });

      if (validInitialSecrets.length > 0 && this.encryptionKey) {
        for (const sec of validInitialSecrets) {
          const schemaVersion = 1;
          const aad = `${context.workspace.id}:${createdData.id}:${sec.secret_type}:${schemaVersion}`;
          const encrypted = encryptSecretAead(
            sec.secret_value,
            this.encryptionKey,
            aad,
          );

          await client.query(
            `INSERT INTO account_secrets (
              workspace_id, account_id, secret_type, ciphertext, nonce, auth_tag,
              key_version, encryption_schema_version, secret_version
            ) VALUES ($1, $2, $3, $4, $5, $6, 'v1', $7, 1)
            ON CONFLICT (workspace_id, account_id, secret_type)
            DO UPDATE SET
              ciphertext = EXCLUDED.ciphertext,
              nonce = EXCLUDED.nonce,
              auth_tag = EXCLUDED.auth_tag,
              encryption_schema_version = EXCLUDED.encryption_schema_version,
              secret_version = account_secrets.secret_version + 1,
              updated_at = clock_timestamp();`,
            [
              context.workspace.id,
              createdData.id,
              sec.secret_type,
              encrypted.ciphertext,
              encrypted.nonce,
              encrypted.authTag,
              schemaVersion,
            ],
          );

          await client.query(
            `INSERT INTO secret_access_events (
              workspace_id, actor_user_id, account_id, action, request_id
            ) VALUES ($1, $2, $3, 'write', $4);`,
            [context.workspace.id, context.user.id, createdData.id, requestId],
          );

          await recordAuditEvent(client, {
            workspaceId: context.workspace.id,
            actorUserId: context.user.id,
            action: 'account_secret_write',
            entityType: 'managed_account',
            entityId: createdData.id,
            requestId,
            metadata: {
              secret_type: sec.secret_type,
              secret_version: 1,
            },
          });
        }
      }

      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'account_create',
        entityType: 'managed_account',
        entityId: createdData.id,
        requestId,
        metadata: {
          platform: createdData.platform,
          username: createdData.username,
          account_group: createdData.account_group,
          assigned_employee_id: createdData.assigned_employee_id,
        },
      });

      if (idempotencyKey) {
        await completeIdempotency(client, {
          workspaceId: context.workspace.id,
          actorUserId: context.user.id,
          operationKey,
          responseCode: 201,
          sanitizedResponse: createdData,
        });
      }

      await client.query('COMMIT');
      return createdData;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * GET /api/v1/accounts/:id
   * Returns managed account detail metadata with configured secret types list.
   * Owner only. Cross-workspace access returns 404 Not Found.
   * NEVER returns secret ciphertext or plaintext.
   */
  async getAccount(
    context: AuthenticatedContext,
    id: string,
  ): Promise<ManagedAccountDetailData> {
    requireRole(['owner'], context);
    const cleanId = this.assertUuid(id);

    const res = await this.pool.query(
      `SELECT
        ma.id, ma.workspace_id, ma.platform, ma.platform_account_id, ma.username,
        ma.recovery_email, ma.account_group, ma.assigned_employee_id,
        e.full_name AS assigned_employee_name, e.employee_code AS assigned_employee_code,
        ma.status, ma.notes, ma.version, ma.created_at, ma.updated_at
      FROM managed_accounts ma
      LEFT JOIN employees e
        ON e.workspace_id = ma.workspace_id AND e.id = ma.assigned_employee_id
      WHERE ma.id = $1 AND ma.workspace_id = $2;`,
      [cleanId, context.workspace.id],
    );

    if (res.rows.length === 0) {
      throw new AuthError('NOT_FOUND', 'Managed account not found', 404);
    }

    const r = res.rows[0];

    // Retrieve list of configured secret types (without any cipher/nonce values)
    const secretRes = await this.pool.query(
      `SELECT secret_type
       FROM account_secrets
       WHERE account_id = $1 AND workspace_id = $2
       ORDER BY secret_type;`,
      [cleanId, context.workspace.id],
    );

    const secretTypes: AccountSecretType[] = secretRes.rows.map(
      (s) => s.secret_type,
    );

    return {
      ...this.mapAccountRow(r),
      has_secret: secretTypes.length > 0,
      secret_types: secretTypes,
    };
  }

  /**
   * PATCH /api/v1/accounts/:id
   * Updates account metadata with If-Match concurrency guard.
   * Owner only.
   */
  async updateAccount(
    context: AuthenticatedContext,
    id: string,
    body: UpdateAccountRequest,
    ifMatch: string | undefined,
    requestId: string,
  ): Promise<ManagedAccountData> {
    requireRole(['owner'], context);
    const cleanId = this.assertUuid(id);
    const expectedVersion = this.assertIfMatchVersion(ifMatch);

    if (!body || typeof body !== 'object') {
      throw new AuthError('VALIDATION_ERROR', 'Request body required', 400);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const accRes = await client.query(
        'SELECT * FROM managed_accounts WHERE id = $1 AND workspace_id = $2 FOR UPDATE;',
        [cleanId, context.workspace.id],
      );

      if (accRes.rows.length === 0) {
        throw new AuthError('NOT_FOUND', 'Managed account not found', 404);
      }

      const existing = accRes.rows[0];
      if (existing.version !== expectedVersion) {
        throw new AuthError(
          'PRECONDITION_FAILED',
          `Stale entity version: expected ${expectedVersion}, found ${existing.version}`,
          412,
        );
      }

      const newUsername =
        body.username !== undefined
          ? (typeof body.username === 'string' && body.username.trim()) || null
          : existing.username;
      const newPlatformAccId =
        body.platform_account_id !== undefined
          ? (typeof body.platform_account_id === 'string' &&
              body.platform_account_id.trim()) ||
            null
          : existing.platform_account_id;
      const newRecoveryEmail =
        body.recovery_email !== undefined
          ? this.normalizeOptionalEmail(body.recovery_email, 'recovery_email')
          : existing.recovery_email;
      const newAccountGroup =
        body.account_group !== undefined
          ? this.normalizeOptionalGroup(body.account_group)
          : existing.account_group;
      const newAssignedEmployeeId =
        body.assigned_employee_id !== undefined
          ? typeof body.assigned_employee_id === 'string' &&
            body.assigned_employee_id.trim()
            ? this.assertUuid(
                body.assigned_employee_id.trim(),
                'assigned_employee_id',
              )
            : null
          : existing.assigned_employee_id;
      const newStatus =
        body.status !== undefined ? body.status : existing.status;
      if (newStatus !== 'active' && newStatus !== 'archived') {
        throw new AuthError(
          'VALIDATION_ERROR',
          "status must be 'active' or 'archived'",
          400,
        );
      }
      const newNotes =
        body.notes !== undefined
          ? (typeof body.notes === 'string' && body.notes.trim()) || null
          : existing.notes;

      let assignedEmployeeName: string | null = null;
      let assignedEmployeeCode: string | null = null;
      if (newAssignedEmployeeId) {
        const empRes = await client.query(
          'SELECT id, full_name, employee_code FROM employees WHERE workspace_id = $1 AND id = $2 FOR SHARE;',
          [context.workspace.id, newAssignedEmployeeId],
        );
        if (empRes.rows.length === 0) {
          throw new AuthError(
            'VALIDATION_ERROR',
            'Nhân viên phụ trách không tồn tại trong workspace này',
            400,
          );
        }
        assignedEmployeeName = empRes.rows[0].full_name;
        assignedEmployeeCode = empRes.rows[0].employee_code;
      }

      const updateRes = await client.query(
        `UPDATE managed_accounts SET
          username = $1,
          platform_account_id = $2,
          recovery_email = $3,
          account_group = $4,
          assigned_employee_id = $5,
          status = $6,
          notes = $7,
          version = version + 1,
          updated_at = clock_timestamp()
        WHERE id = $8 AND workspace_id = $9
        RETURNING id, workspace_id, platform, platform_account_id, username,
          recovery_email, account_group, assigned_employee_id,
          status, notes, version, created_at, updated_at;`,
        [
          newUsername,
          newPlatformAccId,
          newRecoveryEmail,
          newAccountGroup,
          newAssignedEmployeeId,
          newStatus,
          newNotes,
          cleanId,
          context.workspace.id,
        ],
      );

      const r = updateRes.rows[0];
      const updatedData: ManagedAccountData = this.mapAccountRow({
        ...r,
        assigned_employee_name: assignedEmployeeName,
        assigned_employee_code: assignedEmployeeCode,
      });

      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'account_update',
        entityType: 'managed_account',
        entityId: updatedData.id,
        requestId,
        metadata: {
          version: updatedData.version,
          account_group: updatedData.account_group,
          assigned_employee_id: updatedData.assigned_employee_id,
          status: updatedData.status,
        },
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
   * POST /api/v1/accounts/:id/archive
   * Soft-archives managed account. Preserves all data and audit history.
   * Owner only. If-Match guard required.
   */
  async archiveAccount(
    context: AuthenticatedContext,
    id: string,
    body: ArchiveAccountRequest,
    ifMatch: string | undefined,
    requestId: string,
  ): Promise<ManagedAccountData> {
    requireRole(['owner'], context);
    const cleanId = this.assertUuid(id);
    const expectedVersion = this.assertIfMatchVersion(ifMatch);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const accRes = await client.query(
        'SELECT * FROM managed_accounts WHERE id = $1 AND workspace_id = $2 FOR UPDATE;',
        [cleanId, context.workspace.id],
      );

      if (accRes.rows.length === 0) {
        throw new AuthError('NOT_FOUND', 'Managed account not found', 404);
      }

      const existing = accRes.rows[0];
      if (existing.version !== expectedVersion) {
        throw new AuthError(
          'PRECONDITION_FAILED',
          `Stale entity version: expected ${expectedVersion}, found ${existing.version}`,
          412,
        );
      }

      if (existing.status === 'archived') {
        throw new AuthError(
          'INVALID_TRANSITION',
          'Account is already archived',
          409,
        );
      }

      const reason =
        typeof body?.reason === 'string' && body.reason.trim()
          ? body.reason.trim()
          : null;

      const updateRes = await client.query(
        `UPDATE managed_accounts SET
          status = 'archived',
          version = version + 1,
          updated_at = clock_timestamp()
        WHERE id = $1 AND workspace_id = $2
        RETURNING id, workspace_id, platform, platform_account_id, username,
          recovery_email, account_group, assigned_employee_id,
          status, notes, version, created_at, updated_at;`,
        [cleanId, context.workspace.id],
      );

      const r = updateRes.rows[0];
      const archivedData: ManagedAccountData = this.mapAccountRow(r);

      // Record immutable audit event
      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'account_archive',
        entityType: 'managed_account',
        entityId: cleanId,
        requestId,
        metadata: {
          reason,
          version: archivedData.version,
        },
      });

      // Record secret access event (immutable audit log)
      await client.query(
        `INSERT INTO secret_access_events (
          workspace_id, actor_user_id, account_id, action, request_id
        ) VALUES ($1, $2, $3, 'archive', $4);`,
        [context.workspace.id, context.user.id, cleanId, requestId],
      );

      await client.query('COMMIT');
      return archivedData;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * POST /api/v1/accounts/:id/restore
   * Restores an archived managed account back to active.
   * Owner only. If-Match guard required.
   */
  async restoreAccount(
    context: AuthenticatedContext,
    id: string,
    ifMatch: string | undefined,
    requestId: string,
  ): Promise<ManagedAccountData> {
    requireRole(['owner'], context);
    const cleanId = this.assertUuid(id);
    const expectedVersion = this.assertIfMatchVersion(ifMatch);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const accRes = await client.query(
        'SELECT * FROM managed_accounts WHERE id = $1 AND workspace_id = $2 FOR UPDATE;',
        [cleanId, context.workspace.id],
      );

      if (accRes.rows.length === 0) {
        throw new AuthError('NOT_FOUND', 'Managed account not found', 404);
      }

      const existing = accRes.rows[0];
      if (existing.version !== expectedVersion) {
        throw new AuthError(
          'PRECONDITION_FAILED',
          `Stale entity version: expected ${expectedVersion}, found ${existing.version}`,
          412,
        );
      }

      if (existing.status !== 'archived') {
        throw new AuthError(
          'INVALID_TRANSITION',
          'Account is not archived',
          409,
        );
      }

      const updateRes = await client.query(
        `UPDATE managed_accounts SET
          status = 'active',
          version = version + 1,
          updated_at = clock_timestamp()
        WHERE id = $1 AND workspace_id = $2
        RETURNING id, workspace_id, platform, platform_account_id, username,
          recovery_email, account_group, assigned_employee_id,
          status, notes, version, created_at, updated_at;`,
        [cleanId, context.workspace.id],
      );

      const r = updateRes.rows[0];
      const restoredData: ManagedAccountData = this.mapAccountRow(r);

      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'account_restore',
        entityType: 'managed_account',
        entityId: cleanId,
        requestId,
        metadata: {
          version: restoredData.version,
        },
      });

      await client.query(
        `INSERT INTO secret_access_events (
          workspace_id, actor_user_id, account_id, action, request_id
        ) VALUES ($1, $2, $3, 'restore', $4);`,
        [context.workspace.id, context.user.id, cleanId, requestId],
      );

      await client.query('COMMIT');
      return restoredData;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * PUT /api/v1/accounts/:id/secrets
   * Encrypts and writes new secret using AES-256-GCM with AAD binding.
   * Atomically consumes a single-use reauth_proof for action 'secret_write'.
   * Increments account version. Owner only.
   */
  async putAccountSecret(
    context: AuthenticatedContext,
    id: string,
    body: PutAccountSecretRequest,
    ifMatch: string | undefined,
    requestId: string,
  ): Promise<PutAccountSecretResponseData> {
    requireRole(['owner'], context);
    const cleanId = this.assertUuid(id);
    const expectedVersion = this.assertIfMatchVersion(ifMatch);

    if (!this.encryptionKey) {
      throw new AuthError(
        'SERVICE_UNAVAILABLE',
        'Secret vault encryption key is unavailable or unconfigured',
        503,
      );
    }

    if (!body || typeof body !== 'object') {
      throw new AuthError('VALIDATION_ERROR', 'Request body required', 400);
    }

    const { secret_type, secret_value, reauth_proof } = body;
    if (!secret_type || !ALLOWED_SECRET_TYPES.includes(secret_type)) {
      throw new AuthError(
        'VALIDATION_ERROR',
        `secret_type must be one of: ${ALLOWED_SECRET_TYPES.join(', ')}`,
        400,
      );
    }
    if (typeof secret_value !== 'string' || !secret_value) {
      throw new AuthError(
        'VALIDATION_ERROR',
        'secret_value must be a non-empty string',
        400,
      );
    }
    if (secret_value.length > 4096) {
      throw new AuthError('VALIDATION_ERROR', 'secret_value is too long', 400);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock and verify managed account
      const accRes = await client.query(
        'SELECT * FROM managed_accounts WHERE id = $1 AND workspace_id = $2 FOR UPDATE;',
        [cleanId, context.workspace.id],
      );

      if (accRes.rows.length === 0) {
        throw new AuthError('NOT_FOUND', 'Managed account not found', 404);
      }

      const existingAcc = accRes.rows[0];
      if (existingAcc.version !== expectedVersion) {
        throw new AuthError(
          'PRECONDITION_FAILED',
          `Stale entity version: expected ${expectedVersion}, found ${existingAcc.version}`,
          412,
        );
      }

      // 2. Atomically validate and consume single-use reauth_proof for 'secret_write'
      await this.consumeReauthProof(
        client,
        context,
        cleanId,
        'secret_write',
        reauth_proof,
      );

      // 3. Encrypt secret with AEAD (AES-256-GCM)
      // AAD binds workspace_id, account_id, secret_type, and encryption schema version
      const schemaVersion = 1;
      const aad = `${context.workspace.id}:${cleanId}:${secret_type}:${schemaVersion}`;
      const encrypted = encryptSecretAead(
        secret_value,
        this.encryptionKey,
        aad,
      );

      // 4. Upsert encrypted secret into account_secrets
      const upsertRes = await client.query(
        `INSERT INTO account_secrets (
          workspace_id, account_id, secret_type, ciphertext, nonce, auth_tag,
          key_version, encryption_schema_version, secret_version
        ) VALUES ($1, $2, $3, $4, $5, $6, 'v1', $7, 1)
        ON CONFLICT (workspace_id, account_id, secret_type)
        DO UPDATE SET
          ciphertext = EXCLUDED.ciphertext,
          nonce = EXCLUDED.nonce,
          auth_tag = EXCLUDED.auth_tag,
          encryption_schema_version = EXCLUDED.encryption_schema_version,
          secret_version = account_secrets.secret_version + 1,
          updated_at = clock_timestamp()
        RETURNING secret_version, updated_at;`,
        [
          context.workspace.id,
          cleanId,
          secret_type,
          encrypted.ciphertext,
          encrypted.nonce,
          encrypted.authTag,
          schemaVersion,
        ],
      );

      const secretRow = upsertRes.rows[0];

      // 5. Increment account version
      await client.query(
        'UPDATE managed_accounts SET version = version + 1, updated_at = clock_timestamp() WHERE id = $1;',
        [cleanId],
      );

      // 6. Record immutable secret access event (audit)
      await client.query(
        `INSERT INTO secret_access_events (
          workspace_id, actor_user_id, account_id, action, request_id
        ) VALUES ($1, $2, $3, 'write', $4);`,
        [context.workspace.id, context.user.id, cleanId, requestId],
      );

      // 7. Record system audit event (NEVER include secret value or ciphertext)
      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'account_secret_write',
        entityType: 'managed_account',
        entityId: cleanId,
        requestId,
        metadata: {
          secret_type,
          secret_version: secretRow.secret_version,
        },
      });

      await client.query('COMMIT');

      return {
        secret_version: secretRow.secret_version,
        updated_at: new Date(secretRow.updated_at).toISOString(),
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * POST /api/v1/accounts/:id/secrets/reveal
   * Decrypts and reveals secret value using AES-256-GCM.
   * Atomically consumes a single-use reauth_proof for action 'secret_reveal'.
   * Owner only. Returns Cache-Control: no-store.
   */
  async revealAccountSecret(
    context: AuthenticatedContext,
    id: string,
    body: RevealAccountSecretRequest,
    requestId: string,
  ): Promise<RevealAccountSecretResponseData> {
    requireRole(['owner'], context);
    const cleanId = this.assertUuid(id);

    if (!this.encryptionKey) {
      throw new AuthError(
        'SERVICE_UNAVAILABLE',
        'Secret vault encryption key is unavailable or unconfigured',
        503,
      );
    }

    if (!body || typeof body !== 'object') {
      throw new AuthError('VALIDATION_ERROR', 'Request body required', 400);
    }

    const { secret_type, reauth_proof } = body;
    if (!secret_type || !ALLOWED_SECRET_TYPES.includes(secret_type)) {
      throw new AuthError(
        'VALIDATION_ERROR',
        `secret_type must be one of: ${ALLOWED_SECRET_TYPES.join(', ')}`,
        400,
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Lock and verify managed account
      const accRes = await client.query(
        'SELECT id FROM managed_accounts WHERE id = $1 AND workspace_id = $2 FOR SHARE;',
        [cleanId, context.workspace.id],
      );

      if (accRes.rows.length === 0) {
        throw new AuthError('NOT_FOUND', 'Managed account not found', 404);
      }

      // 2. Atomically validate and consume single-use reauth_proof for 'secret_reveal'
      await this.consumeReauthProof(
        client,
        context,
        cleanId,
        'secret_reveal',
        reauth_proof,
      );

      // 3. Retrieve encrypted secret from account_secrets
      const secRes = await client.query(
        `SELECT ciphertext, nonce, auth_tag, encryption_schema_version
         FROM account_secrets
         WHERE workspace_id = $1 AND account_id = $2 AND secret_type = $3;`,
        [context.workspace.id, cleanId, secret_type],
      );

      if (secRes.rows.length === 0) {
        throw new AuthError(
          'NOT_FOUND',
          'Không tìm thấy bí mật nào cho loại yêu cầu này',
          404,
        );
      }

      const secRow = secRes.rows[0];

      // 4. Decrypt secret with AEAD
      const aad = `${context.workspace.id}:${cleanId}:${secret_type}:${secRow.encryption_schema_version}`;
      let plaintext: string;
      try {
        plaintext = decryptSecretAead(
          {
            ciphertext: secRow.ciphertext,
            nonce: secRow.nonce,
            authTag: secRow.auth_tag,
          },
          this.encryptionKey,
          aad,
        );
      } catch {
        throw new AuthError(
          'INTERNAL_ERROR',
          'AEAD integrity check failed: secret ciphertext corrupted or mismatched',
          500,
        );
      }

      // 5. Record immutable secret access event
      await client.query(
        `INSERT INTO secret_access_events (
          workspace_id, actor_user_id, account_id, action, request_id
        ) VALUES ($1, $2, $3, 'reveal', $4);`,
        [context.workspace.id, context.user.id, cleanId, requestId],
      );

      // 6. Record system audit event (NEVER include secret value)
      await recordAuditEvent(client, {
        workspaceId: context.workspace.id,
        actorUserId: context.user.id,
        action: 'account_secret_reveal',
        entityType: 'managed_account',
        entityId: cleanId,
        requestId,
        metadata: {
          secret_type,
        },
      });

      await client.query('COMMIT');

      return {
        secret_value: plaintext,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
