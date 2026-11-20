import { OAuth2Client } from 'google-auth-library';
import type pg from 'pg';
import type { DatabasePool } from '../../../../packages/database/src/pool.js';
import { recordAuditEvent } from '../../../../packages/database/src/audit.js';
import {
  generateCsprngToken,
  hashToken,
} from '../../../../packages/security/src/tokens.js';
import type {
  WebCustomerAccountExportData,
  WebCustomerProfile,
  WebCustomerSessionMetadata,
  WebCustomerStatus,
} from '../../../../packages/contracts/src/web-customers.js';
import { AuthError } from '../auth/service.js';
import { RateLimiter } from '../rate-limiter.js';
import {
  CUSTOMER_SESSION_MAX_AGE_SECONDS,
  generateCustomerCsrfToken,
  type AuthenticatedCustomerContext,
} from './guard.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ATTRIBUTION_VALUE_RE = /^[A-Za-z0-9._-]{1,64}$/;
const SAFE_UTM_KEY_RE = /^utm_[A-Za-z0-9._-]{1,60}$/;
const MAX_UTM_KEYS = 5;
const SLIDING_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const VALID_GOOGLE_ISSUERS = new Set([
  'accounts.google.com',
  'https://accounts.google.com',
]);

export interface GoogleIdTokenPayload {
  sub?: string | undefined;
  email?: string | undefined;
  email_verified?: boolean | undefined;
  name?: string | undefined;
  picture?: string | undefined;
  aud?: string | string[] | undefined;
  iss?: string | undefined;
  exp?: number | undefined;
}

export type GoogleIdTokenVerifier = (
  idToken: string,
  audience: string,
) => Promise<GoogleIdTokenPayload | undefined>;

export interface WebCustomerServiceOptions {
  googleClientId?: string | undefined;
  publicCustomerWorkspaceId?: string | undefined;
  privacyPolicyVersion?: string | undefined;
  isProduction?: boolean | undefined;
  idTokenVerifier?: GoogleIdTokenVerifier | undefined;
  authGoogleLimiter?: RateLimiter | undefined;
  deleteAccountLimiter?: RateLimiter | undefined;
}

export interface LoginWithGoogleParams {
  credential: unknown;
  consent?: unknown;
  ref?: unknown;
  utm?: unknown;
  landing?: unknown;
  clientIp: string;
  userAgent: string | null;
  requestId: string;
}

export interface LoginWithGoogleResult {
  sessionToken: string;
  sessionTokenHash: string;
  csrfToken: string;
  customer: WebCustomerProfile;
  isNewCustomer: boolean;
}

interface WebCustomerRow {
  id: string;
  workspace_id: string;
  google_sub: string;
  email_normalized: string;
  display_name: string;
  avatar_url: string | null;
  status: WebCustomerStatus;
  consent_version: string;
  consent_at: Date | string;
  signup_ref: string | null;
  signup_utm: Record<string, string> | null;
  signup_landing: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  last_login_at: Date | string;
}

interface SessionJoinRow extends WebCustomerRow {
  session_id: string;
  expires_at: Date | string;
  revoked_at: Date | string | null;
  last_seen_at: Date | string;
}

interface SessionMetaRow {
  id: string;
  created_at: Date | string;
  last_seen_at: Date | string;
  expires_at: Date | string;
  created_ip: string | null;
  user_agent: string | null;
}

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function sanitizeUtmStored(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(result).length >= MAX_UTM_KEYS) break;
    if (
      SAFE_UTM_KEY_RE.test(k) &&
      typeof v === 'string' &&
      SAFE_ATTRIBUTION_VALUE_RE.test(v)
    ) {
      result[k] = v;
    }
  }
  return result;
}

/**
 * Sanitizes signup_ref: allows ONLY ASCII letters, digits, '-', '_', '.' up to 64 chars.
 * Rejects/drops invalid or overlong values by returning null.
 */
export function sanitizeSignupRef(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (!SAFE_ATTRIBUTION_VALUE_RE.test(raw)) return null;
  return raw;
}

/**
 * Sanitizes signup_utm: allows ONLY up to 5 keys matching utm_* with ASCII [A-Za-z0-9._-]
 * values up to 64 characters. Drops invalid keys, invalid values, and excess keys.
 */
export function sanitizeSignupUtm(raw: unknown): Record<string, string> {
  return sanitizeUtmStored(raw);
}

/**
 * Sanitizes signup_landing: allows safe relative paths ('/...') or https URLs up to 255 chars
 * with no whitespace, angle brackets, or control characters.
 */
export function sanitizeSignupLanding(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 255) return null;
  if (/[\u0000-\u001f\u007f\s<>]/.test(trimmed)) return null;
  if (trimmed.startsWith('/')) {
    return trimmed;
  }
  if (trimmed.startsWith('https://')) {
    try {
      const parsed = new URL(trimmed);
      if (
        parsed.protocol === 'https:' &&
        !parsed.username &&
        !parsed.password
      ) {
        return trimmed;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function sanitizeAvatarUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 1024) return null;
  if (!trimmed.startsWith('https://')) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    return trimmed;
  } catch {
    return null;
  }
}

function sanitizeUserAgent(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (cleaned.length === 0) return null;
  return cleaned.slice(0, 500);
}

function mapCustomerRow(row: WebCustomerRow): WebCustomerProfile {
  return {
    id: row.id,
    email: row.email_normalized,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    status: row.status,
    consent_version: row.consent_version,
    consent_at: toIso(row.consent_at),
    signup_ref: row.signup_ref,
    signup_utm: sanitizeUtmStored(row.signup_utm),
    signup_landing: row.signup_landing,
    created_at: toIso(row.created_at),
    last_login_at: toIso(row.last_login_at),
  };
}

export class WebCustomerService {
  public readonly authGoogleLimiter: RateLimiter;
  public readonly deleteAccountLimiter: RateLimiter;

  private readonly googleClientId: string | undefined;
  private readonly publicCustomerWorkspaceId: string | undefined;
  private readonly privacyPolicyVersion: string;
  private readonly isProduction: boolean;
  private readonly idTokenVerifier: GoogleIdTokenVerifier;
  private readonly oauthClient: OAuth2Client | null;

  constructor(
    private readonly pool: DatabasePool,
    private readonly csrfSecret: string,
    options: WebCustomerServiceOptions = {},
  ) {
    this.isProduction =
      options.isProduction ?? process.env['NODE_ENV'] === 'production';
    const rawGoogleClientId = (
      options.googleClientId ??
      process.env['GOOGLE_CLIENT_ID'] ??
      ''
    ).trim();
    this.googleClientId =
      rawGoogleClientId.length > 0 ? rawGoogleClientId : undefined;

    const rawWorkspaceId = (
      options.publicCustomerWorkspaceId ??
      process.env['PUBLIC_CUSTOMER_WORKSPACE_ID'] ??
      ''
    ).trim();
    this.publicCustomerWorkspaceId =
      rawWorkspaceId.length > 0 ? rawWorkspaceId : undefined;

    const rawPolicyVersion = (
      options.privacyPolicyVersion ??
      process.env['PRIVACY_POLICY_VERSION'] ??
      '2026-04-01'
    ).trim();
    this.privacyPolicyVersion =
      rawPolicyVersion.length > 0 ? rawPolicyVersion : '2026-04-01';

    this.oauthClient = this.googleClientId
      ? new OAuth2Client(this.googleClientId)
      : null;

    this.idTokenVerifier =
      options.idTokenVerifier ??
      (async (idToken: string, audience: string) => {
        const client = this.oauthClient ?? new OAuth2Client(audience);
        const ticket = await client.verifyIdToken({
          idToken,
          audience,
        });
        return ticket.getPayload();
      });

    this.authGoogleLimiter =
      options.authGoogleLimiter ??
      new RateLimiter({
        windowMs: 15 * 60 * 1000,
        maxAttempts: 20,
      });

    this.deleteAccountLimiter =
      options.deleteAccountLimiter ??
      new RateLimiter({
        windowMs: 60 * 60 * 1000,
        maxAttempts: 3,
      });
  }

  /**
   * Fails closed in production if PUBLIC_CUSTOMER_WORKSPACE_ID is missing or malformed.
   */
  public assertPublicWorkspaceConfigured(): void {
    if (this.publicCustomerWorkspaceId) {
      if (!UUID_RE.test(this.publicCustomerWorkspaceId)) {
        throw new AuthError(
          'SERVICE_UNAVAILABLE',
          'Dịch vụ đăng nhập khách hàng chưa được cấu hình hợp lệ.',
          503,
        );
      }
      return;
    }
    if (this.isProduction) {
      throw new AuthError(
        'SERVICE_UNAVAILABLE',
        'Dịch vụ đăng nhập khách hàng chưa được cấu hình.',
        503,
      );
    }
  }

  private async resolveWorkspaceId(client: pg.PoolClient): Promise<string> {
    this.assertPublicWorkspaceConfigured();

    if (this.publicCustomerWorkspaceId) {
      const wsRes = await client.query<{ id: string }>(
        `SELECT id FROM workspaces WHERE id = $1 AND status = 'active' LIMIT 1`,
        [this.publicCustomerWorkspaceId],
      );
      if (!wsRes.rows[0]) {
        throw new AuthError(
          'SERVICE_UNAVAILABLE',
          'Không tìm thấy không gian làm việc cho khách hàng.',
          503,
        );
      }
      return wsRes.rows[0].id;
    }

    // Non-production fallback ONLY when PUBLIC_CUSTOMER_WORKSPACE_ID is omitted in dev/test
    const fallbackRes = await client.query<{ id: string }>(
      `SELECT id FROM workspaces WHERE status = 'active' ORDER BY created_at ASC LIMIT 1`,
    );
    if (!fallbackRes.rows[0]) {
      throw new AuthError(
        'SERVICE_UNAVAILABLE',
        'Không tìm thấy không gian làm việc khả dụng.',
        503,
      );
    }
    return fallbackRes.rows[0].id;
  }

  private async verifyGoogleCredential(credential: unknown): Promise<{
    sub: string;
    emailNormalized: string;
    displayName: string;
    avatarUrl: string | null;
  }> {
    if (!this.googleClientId) {
      throw new AuthError(
        'SERVICE_UNAVAILABLE',
        'Dịch vụ đăng nhập Google chưa được cấu hình.',
        503,
      );
    }

    if (
      typeof credential !== 'string' ||
      credential.trim().length === 0 ||
      credential.length > 8192
    ) {
      throw new AuthError(
        'UNAUTHENTICATED',
        'Mã xác thực Google không hợp lệ.',
        401,
      );
    }

    let payload: GoogleIdTokenPayload | undefined;
    try {
      payload = await this.idTokenVerifier(credential, this.googleClientId);
    } catch {
      // Never log raw ID token or verifier internals
      throw new AuthError(
        'UNAUTHENTICATED',
        'Mã xác thực Google không hợp lệ hoặc đã hết hạn.',
        401,
      );
    }

    if (!payload || typeof payload !== 'object') {
      throw new AuthError(
        'UNAUTHENTICATED',
        'Mã xác thực Google không hợp lệ.',
        401,
      );
    }

    // Strict claim verification (defense in depth)
    const audMatches =
      payload.aud === this.googleClientId ||
      (Array.isArray(payload.aud) && payload.aud.includes(this.googleClientId));
    if (!audMatches) {
      throw new AuthError(
        'UNAUTHENTICATED',
        'Mã xác thực Google không khớp ứng dụng được phép.',
        401,
      );
    }

    if (
      typeof payload.iss !== 'string' ||
      !VALID_GOOGLE_ISSUERS.has(payload.iss)
    ) {
      throw new AuthError(
        'UNAUTHENTICATED',
        'Nguồn phát hành mã xác thực Google không hợp lệ.',
        401,
      );
    }

    if (
      typeof payload.exp !== 'number' ||
      !Number.isFinite(payload.exp) ||
      payload.exp * 1000 <= Date.now()
    ) {
      throw new AuthError(
        'UNAUTHENTICATED',
        'Mã xác thực Google đã hết hạn.',
        401,
      );
    }

    if (payload.email_verified !== true) {
      throw new AuthError(
        'UNAUTHENTICATED',
        'Email Google chưa được xác minh.',
        401,
      );
    }

    const sub = typeof payload.sub === 'string' ? payload.sub.trim() : '';
    const rawEmail =
      typeof payload.email === 'string' ? payload.email.trim() : '';
    if (
      sub.length === 0 ||
      sub.length > 255 ||
      rawEmail.length < 3 ||
      rawEmail.length > 320 ||
      !rawEmail.includes('@')
    ) {
      throw new AuthError(
        'UNAUTHENTICATED',
        'Thông tin tài khoản Google không đầy đủ.',
        401,
      );
    }

    const emailNormalized = rawEmail.toLowerCase();
    const rawName = typeof payload.name === 'string' ? payload.name.trim() : '';
    const fallbackName = emailNormalized.split('@')[0] || 'Khách hàng';
    const displayName = (rawName.length > 0 ? rawName : fallbackName).slice(
      0,
      200,
    );
    const avatarUrl = sanitizeAvatarUrl(payload.picture);

    return {
      sub,
      emailNormalized,
      displayName,
      avatarUrl,
    };
  }

  /**
   * Authenticates or signs up an isolated web customer with a Google ID token.
   */
  public async loginWithGoogle(
    params: LoginWithGoogleParams,
  ): Promise<LoginWithGoogleResult> {
    this.assertPublicWorkspaceConfigured();
    const verified = await this.verifyGoogleCredential(params.credential);
    const safeUserAgent = sanitizeUserAgent(params.userAgent);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const workspaceId = await this.resolveWorkspaceId(client);

      const existingRes = await client.query<WebCustomerRow>(
        `
        SELECT
          id, workspace_id, google_sub, email_normalized, display_name, avatar_url,
          status, consent_version, consent_at, signup_ref, signup_utm, signup_landing,
          created_at, updated_at, last_login_at
        FROM web_customers
        WHERE workspace_id = $1 AND google_sub = $2
        FOR UPDATE
        `,
        [workspaceId, verified.sub],
      );

      const existing = existingRes.rows[0];

      if (existing) {
        if (existing.status === 'blocked') {
          await recordAuditEvent(client, {
            workspaceId,
            actorUserId: null,
            action: 'web_customer.login_blocked',
            entityType: 'web_customer',
            entityId: existing.id,
            requestId: params.requestId,
            metadata: {
              customer_id: existing.id,
            },
          });
          await client.query('COMMIT');
          throw new AuthError(
            'CUSTOMER_BLOCKED',
            'Tài khoản khách hàng đã bị tạm khóa.',
            403,
          );
        }

        const updatedRes = await client.query<WebCustomerRow>(
          `
          UPDATE web_customers
          SET
            email_normalized = $1,
            display_name = $2,
            avatar_url = $3,
            updated_at = NOW(),
            last_login_at = NOW()
          WHERE id = $4
          RETURNING
            id, workspace_id, google_sub, email_normalized, display_name, avatar_url,
            status, consent_version, consent_at, signup_ref, signup_utm, signup_landing,
            created_at, updated_at, last_login_at
          `,
          [
            verified.emailNormalized,
            verified.displayName,
            verified.avatarUrl,
            existing.id,
          ],
        );

        const customerRow = updatedRes.rows[0]!;
        const rawSessionToken = generateCsprngToken(32);
        const sessionTokenHash = hashToken(rawSessionToken);
        const expiresAt = new Date(
          Date.now() + CUSTOMER_SESSION_MAX_AGE_SECONDS * 1000,
        );

        const sessionRes = await client.query<{ id: string }>(
          `
          INSERT INTO web_customer_sessions (
            customer_id, token_hash, expires_at, created_ip, user_agent
          )
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id
          `,
          [
            customerRow.id,
            sessionTokenHash,
            expiresAt,
            params.clientIp,
            safeUserAgent,
          ],
        );

        await recordAuditEvent(client, {
          workspaceId,
          actorUserId: null,
          action: 'web_customer.login',
          entityType: 'web_customer',
          entityId: customerRow.id,
          requestId: params.requestId,
          metadata: {
            customer_id: customerRow.id,
            session_id: sessionRes.rows[0]?.id ?? null,
          },
        });

        await client.query('COMMIT');

        return {
          sessionToken: rawSessionToken,
          sessionTokenHash,
          csrfToken: generateCustomerCsrfToken(
            sessionTokenHash,
            this.csrfSecret,
          ),
          customer: mapCustomerRow(customerRow),
          isNewCustomer: false,
        };
      }

      // New customer: explicit consent === true is mandatory
      if (params.consent !== true) {
        await client.query('ROLLBACK');
        throw new AuthError(
          'CONSENT_REQUIRED',
          'Bạn cần đồng ý với Chính sách quyền riêng tư trước khi tạo tài khoản.',
          400,
        );
      }

      const signupRef = sanitizeSignupRef(params.ref);
      const signupUtm = sanitizeSignupUtm(params.utm);
      const signupLanding = sanitizeSignupLanding(params.landing);

      const insertedRes = await client.query<WebCustomerRow>(
        `
        INSERT INTO web_customers (
          workspace_id,
          google_sub,
          email_normalized,
          display_name,
          avatar_url,
          status,
          consent_version,
          consent_at,
          signup_ref,
          signup_utm,
          signup_landing,
          created_at,
          updated_at,
          last_login_at
        )
        VALUES (
          $1, $2, $3, $4, $5, 'active', $6, NOW(), $7, $8::jsonb, $9, NOW(), NOW(), NOW()
        )
        RETURNING
          id, workspace_id, google_sub, email_normalized, display_name, avatar_url,
          status, consent_version, consent_at, signup_ref, signup_utm, signup_landing,
          created_at, updated_at, last_login_at
        `,
        [
          workspaceId,
          verified.sub,
          verified.emailNormalized,
          verified.displayName,
          verified.avatarUrl,
          this.privacyPolicyVersion,
          signupRef,
          JSON.stringify(signupUtm),
          signupLanding,
        ],
      );

      const createdRow = insertedRes.rows[0]!;
      const rawSessionToken = generateCsprngToken(32);
      const sessionTokenHash = hashToken(rawSessionToken);
      const expiresAt = new Date(
        Date.now() + CUSTOMER_SESSION_MAX_AGE_SECONDS * 1000,
      );

      const sessionRes = await client.query<{ id: string }>(
        `
        INSERT INTO web_customer_sessions (
          customer_id, token_hash, expires_at, created_ip, user_agent
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        `,
        [
          createdRow.id,
          sessionTokenHash,
          expiresAt,
          params.clientIp,
          safeUserAgent,
        ],
      );

      await recordAuditEvent(client, {
        workspaceId,
        actorUserId: null,
        action: 'web_customer.signup',
        entityType: 'web_customer',
        entityId: createdRow.id,
        requestId: params.requestId,
        metadata: {
          customer_id: createdRow.id,
          session_id: sessionRes.rows[0]?.id ?? null,
          consent_version: createdRow.consent_version,
          signup_ref: createdRow.signup_ref,
        },
      });

      await client.query('COMMIT');

      return {
        sessionToken: rawSessionToken,
        sessionTokenHash,
        csrfToken: generateCustomerCsrfToken(sessionTokenHash, this.csrfSecret),
        customer: mapCustomerRow(createdRow),
        isNewCustomer: true,
      };
    } catch (err) {
      if (!(err instanceof AuthError && err.code === 'CUSTOMER_BLOCKED')) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Ignore rollback error if transaction already closed
        }
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Resolves an active customer session by raw cookie token.
   * Rejects revoked, expired, or blocked customers immediately.
   * Performs sliding 30-day extension when last_seen_at is older than 24 hours.
   */
  public async resolveSession(
    rawToken: string,
  ): Promise<AuthenticatedCustomerContext | null> {
    this.assertPublicWorkspaceConfigured();

    if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 32) {
      return null;
    }

    const tokenHash = hashToken(rawToken);
    const params: unknown[] = [tokenHash];
    let workspaceClause = '';
    if (this.publicCustomerWorkspaceId) {
      params.push(this.publicCustomerWorkspaceId);
      workspaceClause = 'AND c.workspace_id = $2';
    }

    const res = await this.pool.query<SessionJoinRow>(
      `
      SELECT
        s.id AS session_id,
        s.expires_at,
        s.revoked_at,
        s.last_seen_at,
        c.id,
        c.workspace_id,
        c.google_sub,
        c.email_normalized,
        c.display_name,
        c.avatar_url,
        c.status,
        c.consent_version,
        c.consent_at,
        c.signup_ref,
        c.signup_utm,
        c.signup_landing,
        c.created_at,
        c.updated_at,
        c.last_login_at
      FROM web_customer_sessions s
      INNER JOIN web_customers c ON c.id = s.customer_id
      WHERE s.token_hash = $1
        ${workspaceClause}
      LIMIT 1
      `,
      params,
    );

    const row = res.rows[0];
    if (!row) return null;
    if (row.revoked_at !== null) return null;
    if (new Date(row.expires_at).getTime() <= Date.now()) return null;
    if (row.status !== 'active') return null;

    // Sliding window renewal when last_seen_at > 24h
    const lastSeenMs = new Date(row.last_seen_at).getTime();
    if (Date.now() - lastSeenMs > SLIDING_REFRESH_THRESHOLD_MS) {
      const nextExpiresAt = new Date(
        Date.now() + CUSTOMER_SESSION_MAX_AGE_SECONDS * 1000,
      );
      await this.pool.query(
        `
        UPDATE web_customer_sessions
        SET last_seen_at = NOW(), expires_at = $2
        WHERE id = $1 AND revoked_at IS NULL
        `,
        [row.session_id, nextExpiresAt],
      );
    }

    return {
      sessionId: row.session_id,
      sessionTokenHash: tokenHash,
      workspaceId: row.workspace_id,
      customer: mapCustomerRow(row),
    };
  }

  /**
   * Revokes the current customer session and records a web_customer.logout audit event.
   */
  public async logout(
    customerContext: AuthenticatedCustomerContext,
    requestId: string,
  ): Promise<void> {
    this.assertPublicWorkspaceConfigured();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `
        UPDATE web_customer_sessions
        SET revoked_at = NOW()
        WHERE id = $1 AND customer_id = $2 AND revoked_at IS NULL
        `,
        [customerContext.sessionId, customerContext.customer.id],
      );

      await recordAuditEvent(client, {
        workspaceId: customerContext.workspaceId,
        actorUserId: null,
        action: 'web_customer.logout',
        entityType: 'web_customer',
        entityId: customerContext.customer.id,
        requestId,
        metadata: {
          customer_id: customerContext.customer.id,
          session_id: customerContext.sessionId,
        },
      });
      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback error
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Exports customer personal data and non-secret session metadata (never includes token hashes).
   */
  public async exportAccount(
    customerContext: AuthenticatedCustomerContext,
  ): Promise<WebCustomerAccountExportData> {
    this.assertPublicWorkspaceConfigured();

    const customerRes = await this.pool.query<WebCustomerRow>(
      `
      SELECT
        id, workspace_id, google_sub, email_normalized, display_name, avatar_url,
        status, consent_version, consent_at, signup_ref, signup_utm, signup_landing,
        created_at, updated_at, last_login_at
      FROM web_customers
      WHERE id = $1 AND workspace_id = $2 AND status = 'active'
      LIMIT 1
      `,
      [customerContext.customer.id, customerContext.workspaceId],
    );

    const customerRow = customerRes.rows[0];
    if (!customerRow) {
      throw new AuthError(
        'UNAUTHENTICATED',
        'Phiên đăng nhập không hợp lệ hoặc tài khoản không tồn tại.',
        401,
      );
    }

    const sessionsRes = await this.pool.query<SessionMetaRow>(
      `
      SELECT id, created_at, last_seen_at, expires_at, created_ip, user_agent
      FROM web_customer_sessions
      WHERE customer_id = $1 AND revoked_at IS NULL
      ORDER BY created_at DESC
      `,
      [customerRow.id],
    );

    const sessions: WebCustomerSessionMetadata[] = sessionsRes.rows.map(
      (s) => ({
        id: s.id,
        created_at: toIso(s.created_at),
        last_seen_at: toIso(s.last_seen_at),
        expires_at: toIso(s.expires_at),
        created_ip: s.created_ip,
        user_agent: s.user_agent,
      }),
    );

    return {
      exported_at: new Date().toISOString(),
      customer: mapCustomerRow(customerRow),
      sessions,
    };
  }

  /**
   * Permanently deletes the customer row (cascading all sessions).
   * Audit event web_customer.deleted records ONLY the customer ID (zero email or PII).
   */
  public async deleteAccount(
    customerContext: AuthenticatedCustomerContext,
    requestId: string,
  ): Promise<void> {
    this.assertPublicWorkspaceConfigured();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const delRes = await client.query<{ id: string }>(
        `
        DELETE FROM web_customers
        WHERE id = $1 AND workspace_id = $2
        RETURNING id
        `,
        [customerContext.customer.id, customerContext.workspaceId],
      );

      if (!delRes.rows[0]) {
        await client.query('ROLLBACK');
        throw new AuthError(
          'UNAUTHENTICATED',
          'Tài khoản không tồn tại hoặc đã bị xóa.',
          401,
        );
      }

      // Strictly ID-only metadata: zero email, display_name, avatar_url, or referral PII
      await recordAuditEvent(client, {
        workspaceId: customerContext.workspaceId,
        actorUserId: null,
        action: 'web_customer.deleted',
        entityType: 'web_customer',
        entityId: customerContext.customer.id,
        requestId,
        metadata: {
          customer_id: customerContext.customer.id,
        },
      });

      await client.query('COMMIT');
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback error
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
