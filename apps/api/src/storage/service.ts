/**
 * Storage Service (FILE-01 / FILE-02 — Canonical STORAGE & Google Drive Storage V2)
 *
 * Implements Canonical STORAGE endpoints plus Google Drive API v3 Direct Integration:
 * - OAuth 2.0 Connection with AEAD (AES-256-GCM) encrypted refresh_token at rest
 * - Least-privilege drive.file scope enforcement
 * - Direct folder creation on Google Drive (saving folderId, parentId, owner, createdTime)
 * - Resumable video upload with progress tracking, interruption simulation & retry
 * - Staff permission grants/revocations by employee Google email (reader/writer), forbidding anyoneWithLink
 * - Non-destructive record detachment (preserving Google Drive data when removing Lite record)
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabasePool } from '../../../../packages/database/src/pool.js';
import type { PoolClient } from 'pg';
import { recordAuditEvent } from '../../../../packages/database/src/audit.js';
import {
  claimIdempotency,
  completeIdempotency,
  computeRequestFingerprint,
} from '../../../../packages/database/src/idempotency.js';
import {
  encryptSecretAead,
  decryptSecretAead,
  normalizeEncryptionKey,
} from '../../../../packages/security/src/aead.js';
import { AuthError, type AuthenticatedContext } from '../auth/service.js';
import { requireRole } from '../auth/guard.js';
import type {
  StorageFolderData,
  StorageFolderDetailData,
  StorageAssignmentData,
  StorageOutputData,
  StorageReceiptData,
  StorageDeleteReadiness,
  CreateStorageFolderRequest,
  CreateStorageReceiptRequest,
  CreateTrashRequestRequest,
  CreateTrashRequestResponseData,
  ConfirmTrashRequest,
  ConfirmTrashResponseData,
  StorageFileData,
  StorageOperationData,
  StorageDriveConnectionData,
  ConnectDriveOAuthRequest,
  StoragePermissionGrantData,
  GrantDrivePermissionRequest,
  RevokeDrivePermissionRequest,
  DrivePermissionRole,
  InitiateVideoUploadRequest,
  UploadVideoChunkRequest,
  ReviewStorageFileRequest,
} from '../../../../packages/contracts/src/storage.js';
import {
  type IStorageProvider,
  type StorageProviderResult,
  MockGoogleDriveProvider,
  getGoogleOAuthConfig,
  isLiveGoogleDriveEnabled,
} from './provider.js';

const DEFAULT_DRIVE_KEY_HEX =
  '9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0';

function getDriveEncryptionKey(overrideKey?: string | Buffer): {
  key: Buffer;
  keyVersion: number;
} {
  const configuredRaw =
    overrideKey ||
    process.env['STORAGE_DRIVE_ENCRYPTION_KEY_HEX'] ||
    process.env['ACCOUNTS_SECRET_KEY_HEX'] ||
    process.env['ACCOUNT_SECRET_KEY'];

  if (!configuredRaw) {
    if (
      isLiveGoogleDriveEnabled() ||
      process.env['NODE_ENV'] === 'production'
    ) {
      fail(
        'DRIVE_ENCRYPTION_KEY_NOT_CONFIGURED',
        'STORAGE_DRIVE_ENCRYPTION_KEY_HEX is required for Google Drive token encryption in live or production mode',
        500,
      );
    }
    return {
      key: normalizeEncryptionKey(DEFAULT_DRIVE_KEY_HEX),
      keyVersion: 1,
    };
  }

  if (
    typeof configuredRaw === 'string' &&
    configuredRaw.trim().toLowerCase() === DEFAULT_DRIVE_KEY_HEX &&
    (isLiveGoogleDriveEnabled() || process.env['NODE_ENV'] === 'production')
  ) {
    fail(
      'DRIVE_ENCRYPTION_KEY_INSECURE',
      'Default test encryption key is forbidden in live Google Drive or production mode',
      500,
    );
  }

  const key = normalizeEncryptionKey(configuredRaw);
  return { key, keyVersion: 1 };
}

function buildDriveTokenAad(workspaceId: string, googleEmail: string): string {
  return `storage_drive_connection:${workspaceId}:${googleEmail.toLowerCase()}:refresh_token:v1`;
}

const OAUTH_STATE_TTL_SECONDS = 15 * 60;
const consumedOAuthStateNonces = new Set<string>();
const OAUTH_STATE_LEDGER_FILE = path.join(
  os.tmpdir(),
  'management-lite-oauth-state-nonces.json',
);

function createSignedOAuthState(
  workspaceId: string,
  userId: string,
  key: Buffer,
): string {
  const nonce = crypto.randomBytes(12).toString('hex');
  const expSec = Math.floor(Date.now() / 1000) + OAUTH_STATE_TTL_SECONDS;
  const sig = crypto
    .createHmac('sha256', key)
    .update(`${workspaceId}:${userId}:${nonce}:${expSec}`)
    .digest('hex')
    .slice(0, 24);
  return `${nonce}.${expSec}.${sig}`;
}

function verifyOAuthStateSignatureAndExpiry(
  state: string,
  workspaceId: string,
  userId: string,
  key: Buffer,
): { valid: boolean; nonce: string; expSec: number } {
  const parts = state.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    return { valid: false, nonce: '', expSec: 0 };
  }
  const [nonce, expStr, sig] = parts;
  if (!/^[a-f0-9]{16,64}$/i.test(nonce) || !/^[0-9]{10}$/.test(expStr)) {
    return { valid: false, nonce: '', expSec: 0 };
  }
  const expSec = Number.parseInt(expStr, 10);
  const nowSec = Math.floor(Date.now() / 1000);
  if (
    !Number.isFinite(expSec) ||
    expSec < nowSec ||
    expSec > nowSec + OAUTH_STATE_TTL_SECONDS + 60
  ) {
    return { valid: false, nonce, expSec: 0 };
  }
  const expected = crypto
    .createHmac('sha256', key)
    .update(`${workspaceId}:${userId}:${nonce}:${expStr}`)
    .digest('hex')
    .slice(0, 24);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, nonce, expSec: 0 };
  }
  return { valid: true, nonce, expSec };
}

function readDurableOAuthStateLedger(nowSec: number): Record<string, number> {
  try {
    if (!fs.existsSync(OAUTH_STATE_LEDGER_FILE)) {
      return {};
    }
    const raw = fs.readFileSync(OAUTH_STATE_LEDGER_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const active: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= nowSec) {
        active[k] = v;
      }
    }
    return active;
  } catch {
    return {};
  }
}

function writeDurableOAuthStateLedger(ledger: Record<string, number>): void {
  try {
    fs.writeFileSync(OAUTH_STATE_LEDGER_FILE, JSON.stringify(ledger), {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    // Ignore filesystem errors when PostgreSQL idempotency_records is primary
  }
}

async function consumeOAuthStateNonceDurably(
  pool: DatabasePool,
  workspaceId: string,
  userId: string,
  nonce: string,
  expSec: number,
  key: Buffer,
): Promise<{ replayed: boolean }> {
  const nowSec = Math.floor(Date.now() / 1000);
  const stateKey = crypto
    .createHmac('sha256', key)
    .update(`oauth_state_replay:${workspaceId}:${userId}:${nonce}`)
    .digest('hex');

  if (consumedOAuthStateNonces.has(stateKey)) {
    return { replayed: true };
  }

  const ledger = readDurableOAuthStateLedger(nowSec);
  if (ledger[stateKey] && ledger[stateKey] >= nowSec) {
    consumedOAuthStateNonces.add(stateKey);
    return { replayed: true };
  }

  const poolWithQuery = pool as unknown as {
    query?: (
      text: string,
      values?: unknown[],
    ) => Promise<{ rows: Array<{ id: string }> }>;
  };

  if (typeof poolWithQuery?.query === 'function') {
    const insertRes = await poolWithQuery.query(
      `INSERT INTO idempotency_records (
         workspace_id,
         actor_user_id,
         operation_key,
         request_fingerprint,
         state,
         response_code,
         expires_at
       )
       VALUES ($1, $2, $3, $4, 'completed', 200, to_timestamp($5))
       ON CONFLICT (workspace_id, actor_user_id, operation_key) DO NOTHING
       RETURNING id`,
      [workspaceId, userId, `oauth_state:${nonce}`, stateKey, expSec],
    );
    if (insertRes.rows.length === 0) {
      consumedOAuthStateNonces.add(stateKey);
      ledger[stateKey] = expSec;
      writeDurableOAuthStateLedger(ledger);
      return { replayed: true };
    }
  }

  consumedOAuthStateNonces.add(stateKey);
  ledger[stateKey] = expSec;
  writeDurableOAuthStateLedger(ledger);
  return { replayed: false };
}

const APPROVED_DRIVE_SCOPES = new Set([
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid',
  'email',
  'profile',
]);

function fail(code: string, message: string, status = 409): never {
  throw new AuthError(code, message, status);
}

const assertUuid = (v: unknown, name = 'identifier'): string => {
  if (
    typeof v !== 'string' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v)
  ) {
    fail('VALIDATION_ERROR', `Invalid ${name}: must be a valid UUID`, 400);
  }
  return (v as string).toLowerCase();
};

const assertText = (
  v: unknown,
  max: number,
  required = false,
  field = 'text',
): string => {
  if (v === undefined || v === null) {
    if (required) fail('VALIDATION_ERROR', `${field} is required`, 400);
    return '';
  }
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) {
    fail('VALIDATION_ERROR', `Invalid ${field}`, 400);
  }
  return (v as string).trim();
};

const assertEmail = (v: unknown, field = 'email'): string => {
  const val = assertText(v, 320, true, field).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
    fail('VALIDATION_ERROR', `Invalid email format for ${field}`, 400);
  }
  return val;
};

export class StorageService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly provider: IStorageProvider = new MockGoogleDriveProvider(),
    private readonly encryptionKey?: string | Buffer,
  ) {}

  /**
   * Helper: Resolves staff employee record for the current user in this workspace.
   */
  private async getEmployeeId(
    c: PoolClient,
    auth: AuthenticatedContext,
  ): Promise<string> {
    const res = await c.query(
      "SELECT id FROM employees WHERE workspace_id=$1 AND user_id=$2 AND employment_status='active'",
      [auth.workspace.id, auth.user.id],
    );
    if (res.rows.length === 0) {
      fail(
        'FORBIDDEN',
        'Active employee record required for staff actions',
        403,
      );
    }
    return res.rows[0].id;
  }

  /**
   * Helper: Resolves or derives Google email for an employee and persists if missing.
   */
  private async resolveEmployeeGoogleEmail(
    c: PoolClient,
    workspaceId: string,
    empRow: {
      id: string;
      employee_code: string;
      full_name: string;
      google_email?: string | null;
      user_id?: string | null;
    },
  ): Promise<string> {
    if (empRow.google_email && empRow.google_email.trim()) {
      return empRow.google_email.trim().toLowerCase();
    }
    if (empRow.user_id) {
      const uRes = await c.query(
        'SELECT email_normalized FROM users WHERE id = $1 AND email_normalized IS NOT NULL',
        [empRow.user_id],
      );
      if (uRes.rows.length > 0 && uRes.rows[0].email_normalized) {
        const email = String(uRes.rows[0].email_normalized)
          .trim()
          .toLowerCase();
        await c.query(
          'UPDATE employees SET google_email = $1 WHERE workspace_id = $2 AND id = $3',
          [email, workspaceId, empRow.id],
        );
        return email;
      }
    }
    const cleanCode = empRow.employee_code
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '');
    const derived = `${cleanCode || 'staff'}@hoaiphuong.click`;
    await c.query(
      'UPDATE employees SET google_email = $1 WHERE workspace_id = $2 AND id = $3 AND google_email IS NULL',
      [derived, workspaceId, empRow.id],
    );
    return derived;
  }

  /**
   * Helper: Query permissions for a resource (folder or file).
   */
  private async getResourcePermissionsInternal(
    c: PoolClient,
    workspaceId: string,
    resourceType: 'storage_folder' | 'storage_file',
    resourceId: string,
  ): Promise<StoragePermissionGrantData[]> {
    const res = await c.query(
      `SELECT g.*, e.full_name AS employee_name
       FROM resource_access_grants g
       JOIN employees e ON e.workspace_id = g.workspace_id AND e.id = g.employee_id
       WHERE g.workspace_id = $1 AND g.resource_type = $2 AND g.resource_id = $3
       ORDER BY g.granted_at DESC`,
      [workspaceId, resourceType, resourceId],
    );
    return res.rows.map((row) => ({
      id: row.id,
      workspace_id: row.workspace_id,
      resource_type: row.resource_type,
      resource_id: row.resource_id,
      employee_id: row.employee_id,
      employee_name: row.employee_name,
      google_email:
        row.google_email ?? `${row.employee_id.slice(0, 8)}@hoaiphuong.click`,
      drive_role: (row.drive_role ??
        (row.access_level === 'write'
          ? 'writer'
          : 'reader')) as DrivePermissionRole,
      access_level: row.access_level,
      drive_permission_id: row.drive_permission_id ?? null,
      inherited_from_resource_id: row.inherited_from_resource_id ?? null,
      granted_by: row.granted_by ?? null,
      granted_at: row.granted_at.toISOString(),
      revoked_at: row.revoked_at ? row.revoked_at.toISOString() : null,
    }));
  }

  /**
   * Helper: Query files for a folder.
   */
  private async getFolderFilesInternal(
    c: PoolClient,
    workspaceId: string,
    folderId: string,
  ): Promise<StorageFileData[]> {
    const filesRes = await c.query(
      `SELECT f.*, e.full_name AS assigned_employee_name
       FROM storage_files f
       LEFT JOIN employees e ON e.workspace_id = f.workspace_id AND e.id = f.assigned_employee_id
       WHERE f.workspace_id = $1 AND f.folder_id = $2
         AND COALESCE(f.status, 'active') != 'detached'
       ORDER BY f.created_at DESC`,
      [workspaceId, folderId],
    );

    return filesRes.rows.map((row) => ({
      id: row.id,
      workspace_id: row.workspace_id,
      folder_id: row.folder_id,
      provider_file_id: row.provider_file_id,
      provider_revision_id: row.provider_revision_id,
      drive_url:
        row.drive_url ??
        `https://drive.google.com/file/d/${row.provider_file_id}/view`,
      parent_provider_folder_id: row.parent_provider_folder_id ?? null,
      drive_owner_email: row.drive_owner_email ?? null,
      drive_created_at: row.drive_created_at
        ? row.drive_created_at.toISOString()
        : null,
      name: row.name,
      size_bytes: row.size_bytes ? Number(row.size_bytes) : undefined,
      mime_type: row.mime_type,
      status: row.status,
      upload_status: row.upload_status ?? 'completed',
      upload_session_id: row.upload_session_id ?? null,
      uploaded_bytes:
        row.uploaded_bytes !== undefined && row.uploaded_bytes !== null
          ? Number(row.uploaded_bytes)
          : undefined,
      upload_progress_pct: row.upload_progress_pct ?? 100,
      upload_retry_count: row.upload_retry_count ?? 0,
      upload_error_message: row.upload_error_message ?? null,
      assigned_employee_id: row.assigned_employee_id ?? null,
      assigned_employee_name: row.assigned_employee_name ?? undefined,
      review_status: row.review_status ?? 'pending_review',
      reviewed_by: row.reviewed_by ?? null,
      reviewed_at: row.reviewed_at ? row.reviewed_at.toISOString() : null,
      review_notes: row.review_notes ?? null,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at ? row.updated_at.toISOString() : undefined,
    }));
  }

  /**
   * Helper: Check if staff has access to a folder (either assigned or creator).
   */
  private async assertStaffFolderAccess(
    c: PoolClient,
    folderId: string,
    workspaceId: string,
    employeeId: string,
  ): Promise<void> {
    const res = await c.query(
      `SELECT 1 FROM storage_folders f
       WHERE f.workspace_id = $1 AND f.id = $2
         AND COALESCE(f.record_status, 'active') != 'detached'
         AND (
           f.assigned_employee_id = $3
           OR f.created_by_employee_id = $3
           OR EXISTS (
             SELECT 1 FROM folder_assignments a
             WHERE a.workspace_id = $1 AND a.folder_id = $2 AND a.employee_id = $3
           )
           OR EXISTS (
             SELECT 1 FROM storage_folders parent
             JOIN folder_assignments pa ON pa.workspace_id = $1 AND pa.folder_id = parent.id AND pa.employee_id = $3
             WHERE parent.workspace_id = $1 AND parent.id = f.parent_folder_id
           )
           OR EXISTS (
             SELECT 1 FROM resource_access_grants g
             WHERE g.workspace_id = $1 AND g.resource_id = $2 AND g.employee_id = $3 AND g.revoked_at IS NULL
           )
         )`,
      [workspaceId, folderId, employeeId],
    );

    if (res.rows.length === 0) {
      fail('NOT_FOUND', 'Folder not found', 404);
    }
  }

  /**
   * Helper: Reads and decrypts the workspace's active Google Drive refresh token using AES-256-GCM.
   * Never exposes or logs the plaintext refresh token.
   */
  private async getDecryptedWorkspaceRefreshToken(
    c: PoolClient,
    workspaceId: string,
  ): Promise<string | null> {
    const res = await c.query(
      `SELECT google_email, refresh_token_ciphertext, refresh_token_nonce, refresh_token_auth_tag
       FROM storage_drive_connections
       WHERE workspace_id = $1 AND status = 'active'`,
      [workspaceId],
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    if (
      !row.refresh_token_ciphertext ||
      !row.refresh_token_nonce ||
      !row.refresh_token_auth_tag ||
      !row.google_email
    ) {
      return null;
    }
    const { key } = getDriveEncryptionKey(this.encryptionKey);
    const aad = buildDriveTokenAad(workspaceId, row.google_email);
    try {
      return decryptSecretAead(
        {
          ciphertext: row.refresh_token_ciphertext,
          nonce: row.refresh_token_nonce,
          authTag: row.refresh_token_auth_tag,
        },
        key,
        aad,
      );
    } catch {
      fail(
        'DRIVE_TOKEN_INTEGRITY_ERROR',
        'Failed to verify and decrypt stored Google Drive refresh token (AEAD authentication failed)',
        500,
      );
    }
  }

  /**
   * 0a. GET /api/v1/storage/drive/oauth/url
   * Generates OAuth 2.0 consent URL with least-privilege drive.file scope (Owner only).
   */
  async getDriveOAuthUrl(auth: AuthenticatedContext): Promise<{
    auth_url: string;
    authorization_url: string;
    state: string;
    scope: string;
    requested_scopes: string[];
    oauth_mode: 'mock' | 'live';
    live_credentials_configured: boolean;
    redirect_uri: string;
  }> {
    requireRole(['owner'], auth);
    const { key } = getDriveEncryptionKey(this.encryptionKey);
    const state = createSignedOAuthState(auth.workspace.id, auth.user.id, key);
    const cfg = getGoogleOAuthConfig();
    const requestedScopes = ['https://www.googleapis.com/auth/drive.file'];
    const authUrl = this.provider.getOAuthAuthorizationUrl
      ? this.provider.getOAuthAuthorizationUrl({
          workspaceId: auth.workspace.id,
          state,
          redirectUri: cfg.redirectUri,
        })
      : `https://accounts.google.com/o/oauth2/v2/auth?response_type=code&access_type=offline&prompt=consent&scope=${encodeURIComponent(requestedScopes.join(' '))}&state=${encodeURIComponent(state)}`;
    return {
      auth_url: authUrl,
      authorization_url: authUrl,
      state,
      scope: requestedScopes[0] ?? 'https://www.googleapis.com/auth/drive.file',
      requested_scopes: requestedScopes,
      oauth_mode: isLiveGoogleDriveEnabled() ? 'live' : 'mock',
      live_credentials_configured: cfg.credentialsConfigured,
      redirect_uri: cfg.redirectUri,
    };
  }

  /**
   * 0b. GET /api/v1/storage/drive/connection
   * Returns current Google Drive OAuth connection metadata (NEVER returns refresh_token or ciphertext).
   */
  async getDriveConnection(
    auth: AuthenticatedContext,
  ): Promise<StorageDriveConnectionData> {
    const cfg = getGoogleOAuthConfig();
    const oauthMode: 'mock' | 'live' = isLiveGoogleDriveEnabled()
      ? 'live'
      : 'mock';
    const c = await this.pool.connect();
    try {
      const res = await c.query(
        'SELECT * FROM storage_drive_connections WHERE workspace_id = $1',
        [auth.workspace.id],
      );
      if (res.rows.length === 0) {
        return {
          connected: false,
          provider: 'google_drive',
          oauth_mode: oauthMode,
          live_credentials_configured: cfg.credentialsConfigured,
          redirect_uri: cfg.redirectUri,
          google_email: null,
          scopes: ['https://www.googleapis.com/auth/drive.file'],
          root_folder_id: null,
          root_folder_url: null,
          token_encrypted_at_rest: false,
          key_version: 1,
          status: 'disconnected',
          connected_at: null,
          last_synced_at: null,
        };
      }
      const row = res.rows[0];
      const isConnected = row.status === 'active';
      const isSimulatedRoot = String(row.root_folder_id ?? '').startsWith(
        'gdrive_root_',
      );
      const effectiveOauthMode: 'mock' | 'live' =
        oauthMode === 'live' && !isSimulatedRoot ? 'live' : 'mock';
      return {
        id: row.id,
        workspace_id: row.workspace_id,
        connected: isConnected,
        provider: 'google_drive',
        oauth_mode: effectiveOauthMode,
        live_credentials_configured: cfg.credentialsConfigured,
        redirect_uri: cfg.redirectUri,
        google_email: row.google_email,
        scopes: Array.isArray(row.scopes)
          ? row.scopes
          : ['https://www.googleapis.com/auth/drive.file'],
        root_folder_id: row.root_folder_id,
        root_folder_url: row.root_folder_url,
        token_encrypted_at_rest: Boolean(
          row.refresh_token_ciphertext &&
          row.refresh_token_nonce &&
          row.refresh_token_auth_tag,
        ),
        key_version: row.key_version ?? 1,
        status: row.status,
        connected_at: row.connected_at ? row.connected_at.toISOString() : null,
        last_synced_at: row.last_synced_at
          ? row.last_synced_at.toISOString()
          : null,
      };
    } finally {
      c.release();
    }
  }

  /**
   * 0c. POST /api/v1/storage/drive/connect
   * Connects Google Drive account via OAuth 2.0, enforces drive.file least-privilege scope,
   * encrypts refresh_token at rest with AES-256-GCM, and initializes root folder on Drive.
   */
  async connectDriveOAuth(
    auth: AuthenticatedContext,
    body: ConnectDriveOAuthRequest,
    requestId: string = crypto.randomUUID(),
  ): Promise<StorageDriveConnectionData> {
    requireRole(['owner'], auth);

    // Validate scopes — enforce least-privilege drive.file (Requirement 2)
    const rawSingleScope = (body as unknown as Record<string, unknown>)[
      'scope'
    ];
    const requestedScopes =
      body.scopes && Array.isArray(body.scopes) && body.scopes.length > 0
        ? body.scopes
        : typeof rawSingleScope === 'string' && rawSingleScope.trim()
          ? [rawSingleScope.trim()]
          : ['https://www.googleapis.com/auth/drive.file'];

    for (const s of requestedScopes) {
      if (typeof s !== 'string' || !APPROVED_DRIVE_SCOPES.has(s.trim())) {
        fail(
          'FORBIDDEN_DRIVE_SCOPE',
          `Scope "${String(s)}" is not allowed. Management Lite enforces least-privilege scope "https://www.googleapis.com/auth/drive.file" unless explicitly approved by Owner.`,
          400,
        );
      }
    }

    const { key, keyVersion } = getDriveEncryptionKey(this.encryptionKey);
    if (!body.state || typeof body.state !== 'string' || !body.state.trim()) {
      fail('INVALID_OAUTH_STATE', 'OAuth 2.0 state parameter is required', 400);
    }

    const stateStr = assertText(body.state, 200, true, 'state');
    const stateCheck = verifyOAuthStateSignatureAndExpiry(
      stateStr,
      auth.workspace.id,
      auth.user.id,
      key,
    );
    if (!stateCheck.valid) {
      fail(
        'INVALID_OAUTH_STATE',
        'OAuth 2.0 state parameter verification failed (possible CSRF, expired state, or session mismatch)',
        400,
      );
    }

    const consumeRes = await consumeOAuthStateNonceDurably(
      this.pool,
      auth.workspace.id,
      auth.user.id,
      stateCheck.nonce,
      stateCheck.expSec,
      key,
    );
    if (consumeRes.replayed) {
      fail(
        'OAUTH_STATE_REPLAYED',
        'OAuth 2.0 state token has already been consumed (replay blocked)',
        400,
      );
    }

    const code = body.code
      ? assertText(body.code, 500, false, 'code')
      : '4/0AVGzR1-oauth-code';
    const emailHint = body.google_email
      ? assertEmail(body.google_email, 'google_email')
      : 'drive-admin@hoaiphuong.click';
    const rootFolderName = body.root_folder_name
      ? assertText(body.root_folder_name, 200, false, 'root_folder_name')
      : 'Management Lite - Google Drive Root';

    let refreshToken = body.refresh_token
      ? assertText(body.refresh_token, 2000, false, 'refresh_token')
      : '';
    let googleEmail = emailHint;
    let grantedScopes = requestedScopes;
    let exchangedRootFolderId: string | null = null;
    let exchangedRootFolderUrl: string | null = null;

    if (this.provider.exchangeOAuthCode) {
      const exchanged = await this.provider.exchangeOAuthCode({
        code,
        googleEmail: emailHint,
        scopes: requestedScopes,
        rootFolderName,
      });
      if (!refreshToken) {
        refreshToken = exchanged.refreshToken;
      }
      googleEmail = exchanged.googleEmail;
      grantedScopes = exchanged.scopes;
      exchangedRootFolderId = exchanged.rootFolderId;
      exchangedRootFolderUrl = exchanged.rootFolderUrl;
    } else if (!refreshToken) {
      refreshToken = `1//0g-${crypto.randomBytes(24).toString('hex')}`;
    }

    // Encrypt OAuth refresh token with AEAD AES-256-GCM using key outside DB (Requirement 3)
    const aad = buildDriveTokenAad(auth.workspace.id, googleEmail);
    const encrypted = encryptSecretAead(refreshToken, key, aad);

    // Verify decryption round-trip immediately
    const verifiedPlaintext = decryptSecretAead(encrypted, key, aad);
    if (verifiedPlaintext !== refreshToken) {
      fail('INTERNAL_ERROR', 'Failed to verify encrypted OAuth token', 500);
    }

    // Create or resolve application-managed root folder on Google Drive
    let rootFolderId = exchangedRootFolderId || 'gdrive_root_default';
    let rootFolderUrl =
      exchangedRootFolderUrl ||
      'https://drive.google.com/drive/folders/gdrive_root_default';
    if (!exchangedRootFolderId && this.provider.createDriveFolder) {
      const rootFolder = await this.provider.createDriveFolder(
        {
          name: rootFolderName,
          parentFolderId: null,
          ownerEmail: googleEmail,
        },
        refreshToken,
      );
      rootFolderId = rootFolder.folderId;
      rootFolderUrl = rootFolder.webViewLink;
    }

    const cfg = getGoogleOAuthConfig();
    const isIncomingMockCode =
      !body.refresh_token &&
      (code.startsWith('4/0AVGzR1-') ||
        code.startsWith('mock-') ||
        code.startsWith('test-'));

    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');

      // Guard: Never overwrite an existing LIVE Google Drive connection with a mock code when live credentials are enabled
      if (isLiveGoogleDriveEnabled() && isIncomingMockCode) {
        const existingLiveRes = await c.query(
          `SELECT * FROM storage_drive_connections
           WHERE workspace_id = $1 AND status = 'active'
           FOR UPDATE`,
          [auth.workspace.id],
        );
        const existingRow = existingLiveRes.rows[0];
        if (
          existingRow &&
          !String(existingRow.root_folder_id || '').startsWith('gdrive_root_')
        ) {
          await c.query('COMMIT');
          return {
            id: existingRow.id,
            workspace_id: existingRow.workspace_id,
            connected: true,
            provider: 'google_drive',
            oauth_mode: 'live',
            live_credentials_configured: cfg.credentialsConfigured,
            redirect_uri: cfg.redirectUri,
            google_email: existingRow.google_email,
            scopes: existingRow.scopes,
            root_folder_id: existingRow.root_folder_id,
            root_folder_url: existingRow.root_folder_url,
            token_encrypted_at_rest: true,
            key_version: existingRow.key_version,
            status: 'active',
            connected_at: existingRow.connected_at.toISOString(),
            last_synced_at: existingRow.last_synced_at
              ? existingRow.last_synced_at.toISOString()
              : null,
          };
        }
      }

      const isMockRoot = String(rootFolderId || '').startsWith('gdrive_root_');
      const oauthMode: 'mock' | 'live' =
        isLiveGoogleDriveEnabled() && !isMockRoot ? 'live' : 'mock';

      const upsertRes = await c.query(
        `INSERT INTO storage_drive_connections (
           workspace_id, connected_by, google_email, scopes,
           root_folder_id, root_folder_url,
           refresh_token_ciphertext, refresh_token_nonce, refresh_token_auth_tag,
           key_version, status, connected_at, last_synced_at, disconnected_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', clock_timestamp(), clock_timestamp(), NULL, clock_timestamp())
         ON CONFLICT (workspace_id) DO UPDATE SET
           connected_by = EXCLUDED.connected_by,
           google_email = EXCLUDED.google_email,
           scopes = EXCLUDED.scopes,
           root_folder_id = EXCLUDED.root_folder_id,
           root_folder_url = EXCLUDED.root_folder_url,
           refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
           refresh_token_nonce = EXCLUDED.refresh_token_nonce,
           refresh_token_auth_tag = EXCLUDED.refresh_token_auth_tag,
           key_version = EXCLUDED.key_version,
           status = 'active',
           connected_at = clock_timestamp(),
           last_synced_at = clock_timestamp(),
           disconnected_at = NULL,
           updated_at = clock_timestamp()
         RETURNING *`,
        [
          auth.workspace.id,
          auth.user.id,
          googleEmail,
          grantedScopes,
          rootFolderId,
          rootFolderUrl,
          encrypted.ciphertext,
          encrypted.nonce,
          encrypted.authTag,
          keyVersion,
        ],
      );
      const row = upsertRes.rows[0];

      // Auto-upgrade any simulated folders (gdrive_fld_*) in this workspace when live OAuth is connected
      if (oauthMode === 'live' && this.provider.createDriveFolder) {
        const mockFoldersRes = await c.query(
          `SELECT id, name FROM storage_folders
           WHERE workspace_id = $1
             AND status <> 'trashed'
             AND (provider_folder_id IS NULL OR provider_folder_id LIKE 'gdrive_fld_%')
           ORDER BY created_at ASC
           LIMIT 10`,
          [auth.workspace.id],
        );
        for (const mf of mockFoldersRes.rows) {
          try {
            const createdReal = await this.provider.createDriveFolder(
              {
                name: mf.name,
                parentFolderId: rootFolderId,
                ownerEmail: googleEmail,
              },
              refreshToken,
            );
            if (
              createdReal.folderId &&
              !createdReal.folderId.startsWith('gdrive_fld_')
            ) {
              await c.query(
                `UPDATE storage_folders
                 SET provider_folder_id = $1,
                     provider_parent_id = $2,
                     drive_url = $3,
                     drive_owner_email = $4,
                     updated_at = clock_timestamp()
                 WHERE id = $5 AND workspace_id = $6`,
                [
                  createdReal.folderId,
                  rootFolderId,
                  createdReal.webViewLink,
                  googleEmail,
                  mf.id,
                  auth.workspace.id,
                ],
              );
            }
          } catch {
            // Keep transaction alive even if individual folder upgrade fails
          }
        }
      }

      await recordAuditEvent(c, {
        workspaceId: auth.workspace.id,
        actorUserId: auth.user.id,
        action: 'storage.drive_oauth_connect',
        entityType: 'storage_drive_connection',
        entityId: row.id,
        requestId,
        metadata: {
          google_email: googleEmail,
          scopes: grantedScopes,
          root_folder_id: rootFolderId,
          oauth_mode: oauthMode,
          token_encrypted_at_rest: true,
          key_version: keyVersion,
        },
      });

      await c.query('COMMIT');

      return {
        id: row.id,
        workspace_id: row.workspace_id,
        connected: true,
        provider: 'google_drive',
        oauth_mode: oauthMode,
        live_credentials_configured: cfg.credentialsConfigured,
        redirect_uri: cfg.redirectUri,
        google_email: row.google_email,
        scopes: row.scopes,
        root_folder_id: row.root_folder_id,
        root_folder_url: row.root_folder_url,
        token_encrypted_at_rest: true,
        key_version: row.key_version,
        status: 'active',
        connected_at: row.connected_at.toISOString(),
        last_synced_at: row.last_synced_at
          ? row.last_synced_at.toISOString()
          : null,
      };
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  }

  /**
   * 0d. POST /api/v1/storage/drive/disconnect
   * Disconnects Google Drive OAuth connection and wipes encrypted refresh token at rest (Owner only).
   */
  async disconnectDriveOAuth(
    auth: AuthenticatedContext,
    requestId: string = crypto.randomUUID(),
  ): Promise<StorageDriveConnectionData> {
    requireRole(['owner'], auth);
    const cfg = getGoogleOAuthConfig();
    const oauthMode: 'mock' | 'live' = isLiveGoogleDriveEnabled()
      ? 'live'
      : 'mock';
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const res = await c.query(
        `UPDATE storage_drive_connections
         SET status = 'disconnected',
             refresh_token_ciphertext = NULL,
             refresh_token_nonce = NULL,
             refresh_token_auth_tag = NULL,
             disconnected_at = clock_timestamp(),
             updated_at = clock_timestamp()
         WHERE workspace_id = $1
         RETURNING *`,
        [auth.workspace.id],
      );

      if (res.rows.length > 0) {
        const row = res.rows[0];
        await recordAuditEvent(c, {
          workspaceId: auth.workspace.id,
          actorUserId: auth.user.id,
          action: 'storage.drive_oauth_disconnect',
          entityType: 'storage_drive_connection',
          entityId: row.id,
          requestId,
          metadata: {
            google_email: row.google_email,
            token_wiped_at_rest: true,
          },
        });
      }

      await c.query('COMMIT');
      return {
        connected: false,
        provider: 'google_drive',
        oauth_mode: oauthMode,
        live_credentials_configured: cfg.credentialsConfigured,
        redirect_uri: cfg.redirectUri,
        google_email: res.rows[0]?.google_email ?? null,
        scopes: ['https://www.googleapis.com/auth/drive.file'],
        root_folder_id: res.rows[0]?.root_folder_id ?? null,
        root_folder_url: res.rows[0]?.root_folder_url ?? null,
        token_encrypted_at_rest: false,
        key_version: 1,
        status: 'disconnected',
        connected_at: null,
        last_synced_at: null,
      };
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  }

  /**
   * 1. GET /api/v1/storage/folders
   * Lists folders in the workspace.
   * Owner sees all; Staff sees assigned only.
   */
  async listFolders(
    auth: AuthenticatedContext,
    query?: {
      folder_type?: string | undefined;
      parent_folder_id?: string | undefined;
    },
  ): Promise<StorageFolderData[]> {
    const c = await this.pool.connect();
    try {
      let staffEmployeeId: string | null = null;
      if (auth.workspace.role !== 'owner') {
        staffEmployeeId = await this.getEmployeeId(c, auth);
      }

      const params: unknown[] = [auth.workspace.id];
      let sql = `
        SELECT f.*,
               e.full_name AS assigned_employee_name,
               (SELECT COUNT(*)::int FROM storage_folders df WHERE df.workspace_id = f.workspace_id AND df.parent_folder_id = f.id AND COALESCE(df.record_status, 'active') != 'detached') AS deliverable_count
        FROM storage_folders f
        LEFT JOIN employees e ON e.workspace_id = f.workspace_id AND e.id = f.assigned_employee_id
        WHERE f.workspace_id = $1
          AND COALESCE(f.record_status, 'active') != 'detached'
      `;

      if (staffEmployeeId) {
        params.push(staffEmployeeId);
        sql += `
          AND (
            f.assigned_employee_id = $${params.length}
            OR f.created_by_employee_id = $${params.length}
            OR EXISTS (
              SELECT 1 FROM folder_assignments a
              WHERE a.workspace_id = f.workspace_id AND a.folder_id = f.id AND a.employee_id = $${params.length}
            )
            OR EXISTS (
              SELECT 1 FROM storage_folders pf
              JOIN folder_assignments pa ON pa.workspace_id = pf.workspace_id AND pa.folder_id = pf.id AND pa.employee_id = $${params.length}
              WHERE pf.workspace_id = f.workspace_id AND pf.id = f.parent_folder_id
            )
            OR EXISTS (
              SELECT 1 FROM resource_access_grants g
              WHERE g.workspace_id = f.workspace_id AND g.resource_id = f.id AND g.employee_id = $${params.length} AND g.revoked_at IS NULL
            )
          )
        `;
      }

      if (query?.folder_type) {
        params.push(query.folder_type);
        sql += ` AND f.folder_type = $${params.length}`;
      }

      if (query?.parent_folder_id) {
        const parentId = assertUuid(query.parent_folder_id, 'parent_folder_id');
        params.push(parentId);
        sql += ` AND f.parent_folder_id = $${params.length}`;
      }

      sql += ` ORDER BY f.created_at DESC`;

      const result = await c.query(sql, params);

      // Load active permission grants for all returned folders
      const folderIds = result.rows.map((r) => r.id);
      const grantsByFolder = new Map<string, StoragePermissionGrantData[]>();
      if (folderIds.length > 0) {
        const grantsRes = await c.query(
          `SELECT g.*, e.full_name AS employee_name
           FROM resource_access_grants g
           JOIN employees e ON e.workspace_id = g.workspace_id AND e.id = g.employee_id
           WHERE g.workspace_id = $1 AND g.resource_type = 'storage_folder' AND g.resource_id = ANY($2::uuid[]) AND g.revoked_at IS NULL
           ORDER BY g.granted_at DESC`,
          [auth.workspace.id, folderIds],
        );
        for (const g of grantsRes.rows) {
          const list = grantsByFolder.get(g.resource_id) ?? [];
          list.push({
            id: g.id,
            workspace_id: g.workspace_id,
            resource_type: g.resource_type,
            resource_id: g.resource_id,
            employee_id: g.employee_id,
            employee_name: g.employee_name,
            google_email:
              g.google_email ?? `${g.employee_id.slice(0, 8)}@hoaiphuong.click`,
            drive_role: (g.drive_role ??
              (g.access_level === 'write'
                ? 'writer'
                : 'reader')) as DrivePermissionRole,
            access_level: g.access_level,
            drive_permission_id: g.drive_permission_id ?? null,
            inherited_from_resource_id: g.inherited_from_resource_id ?? null,
            granted_by: g.granted_by ?? null,
            granted_at: g.granted_at.toISOString(),
            revoked_at: null,
          });
          grantsByFolder.set(g.resource_id, list);
        }
      }

      return result.rows.map((row) => ({
        id: row.id,
        workspace_id: row.workspace_id,
        name: row.name,
        provider: row.provider,
        provider_folder_id: row.provider_folder_id,
        provider_parent_id: row.provider_parent_id ?? null,
        drive_owner_email: row.drive_owner_email ?? null,
        drive_created_at: row.drive_created_at
          ? row.drive_created_at.toISOString()
          : row.created_at.toISOString(),
        record_status: row.record_status ?? 'active',
        drive_url: row.drive_url,
        folder_type: row.folder_type,
        status: row.status,
        assigned_employee_id: row.assigned_employee_id,
        assigned_employee_name: row.assigned_employee_name ?? undefined,
        parent_folder_id: row.parent_folder_id,
        deliverable_count: row.deliverable_count ?? 0,
        staff_download_confirmed: row.status !== 'ready_for_download',
        staff_downloaded_at: undefined,
        owner_review_confirmed: row.owner_receipt_confirmed ?? false,
        owner_reviewed_at: row.owner_reviewed_at
          ? row.owner_reviewed_at.toISOString()
          : undefined,
        notes: row.notes,
        version: row.version,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at ? row.updated_at.toISOString() : undefined,
        permission_grants: grantsByFolder.get(row.id) ?? [],
      }));
    } finally {
      c.release();
    }
  }

  /**
   * 2. POST /api/v1/storage/folders
   * Creates a source folder (Owner only) or deliverable folder (Staff or Owner).
   * Supports direct creation on Google Drive via Drive API v3 (saving folderId, parentId, owner, createdTime)
   * OR linking an existing Drive folder URL.
   */
  async createFolder(
    auth: AuthenticatedContext,
    body: CreateStorageFolderRequest,
    idempotencyKey?: string | undefined,
    requestId: string = crypto.randomUUID(),
  ): Promise<StorageFolderData> {
    const name = assertText(body.name, 200, true, 'name');
    const folderType = assertText(body.folder_type, 50, true, 'folder_type');

    if (folderType !== 'source' && folderType !== 'deliverable') {
      fail(
        'VALIDATION_ERROR',
        "folder_type must be 'source' or 'deliverable'",
        400,
      );
    }

    const permissionRole: DrivePermissionRole =
      body.permission_role === 'writer' ? 'writer' : 'reader';

    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');

      // Idempotency check
      if (idempotencyKey) {
        const fingerprint = computeRequestFingerprint(
          'POST',
          '/api/v1/storage/folders',
          body,
        );
        const claim = await claimIdempotency(c, {
          workspaceId: auth.workspace.id,
          actorUserId: auth.user.id,
          operationKey: idempotencyKey,
          requestFingerprint: fingerprint,
        });
        if (claim.status === 'replay' && claim.sanitizedResponse) {
          await c.query('ROLLBACK');
          return claim.sanitizedResponse as unknown as StorageFolderData;
        }
        if (claim.status === 'in_progress' || claim.status === 'mismatch') {
          await c.query('ROLLBACK');
          fail('CONFLICT', claim.error, 409);
        }
      }

      let assignedEmployeeId: string | null = null;
      let createdByEmployeeId: string | null = null;
      let parentFolderId: string | null = null;
      let parentProviderFolderId: string | null = null;
      let assignmentId: string | null = null;

      if (folderType === 'source') {
        // Source folders can ONLY be created by Owner
        if (auth.workspace.role !== 'owner') {
          fail('FORBIDDEN', 'Only owner can create source folders', 403);
        }
        if (body.parent_folder_id) {
          fail(
            'VALIDATION_ERROR',
            'Source folder cannot have parent_folder_id',
            400,
          );
        }

        if (body.assigned_employee_id) {
          assignedEmployeeId = assertUuid(
            body.assigned_employee_id,
            'assigned_employee_id',
          );
        }
      } else {
        // Deliverable folders require parent_folder_id
        if (!body.parent_folder_id) {
          fail(
            'VALIDATION_ERROR',
            'Deliverable folder requires parent_folder_id',
            400,
          );
        }
        parentFolderId = assertUuid(body.parent_folder_id, 'parent_folder_id');

        // Verify parent folder exists and is in same workspace
        const parentRes = await c.query(
          'SELECT id, folder_type, status, provider_folder_id FROM storage_folders WHERE id=$1 AND workspace_id=$2',
          [parentFolderId, auth.workspace.id],
        );
        if (parentRes.rows.length === 0) {
          fail('NOT_FOUND', 'Parent source folder not found', 404);
        }
        if (parentRes.rows[0].folder_type !== 'source') {
          fail(
            'VALIDATION_ERROR',
            'Parent folder must be a source folder',
            400,
          );
        }
        parentProviderFolderId = parentRes.rows[0].provider_folder_id ?? null;

        // Determine creator employee
        if (auth.workspace.role !== 'owner') {
          createdByEmployeeId = await this.getEmployeeId(c, auth);

          // Verify staff is assigned to parent folder
          const assignCheck = await c.query(
            'SELECT id FROM folder_assignments WHERE workspace_id=$1 AND folder_id=$2 AND employee_id=$3',
            [auth.workspace.id, parentFolderId, createdByEmployeeId],
          );
          if (assignCheck.rows.length === 0) {
            fail(
              'FORBIDDEN',
              'Staff must be assigned to the source folder to submit deliverable',
              403,
            );
          }
          assignmentId = assignCheck.rows[0].id;
        } else if (body.assignment_id) {
          assignmentId = assertUuid(body.assignment_id, 'assignment_id');
        }
      }

      // Resolve workspace Google Drive connection for owner email, root folder & AEAD-decrypted refresh token
      const connRes = await c.query(
        'SELECT google_email, root_folder_id FROM storage_drive_connections WHERE workspace_id = $1 AND status = $2',
        [auth.workspace.id, 'active'],
      );
      const driveOwnerEmail =
        connRes.rows[0]?.google_email ?? 'drive-admin@hoaiphuong.click';
      const rootDriveFolderId =
        connRes.rows[0]?.root_folder_id ?? 'gdrive_root_default';
      const decryptedRefreshToken =
        await this.getDecryptedWorkspaceRefreshToken(c, auth.workspace.id);

      let providerFolderId: string;
      let providerParentId: string | null =
        parentProviderFolderId ?? rootDriveFolderId;
      let driveUrl: string;
      let driveCreatedAt = new Date();

      const shouldCreateOnDrive =
        body.create_on_drive === true ||
        !body.drive_url ||
        !String(body.drive_url).trim();

      if (shouldCreateOnDrive && this.provider.createDriveFolder) {
        const createdDrive = await this.provider.createDriveFolder(
          {
            name,
            parentFolderId: providerParentId,
            ownerEmail: driveOwnerEmail,
          },
          decryptedRefreshToken,
        );
        providerFolderId = createdDrive.folderId;
        providerParentId = createdDrive.parentId;
        driveUrl = createdDrive.webViewLink;
        driveCreatedAt = new Date(createdDrive.createdTime);
      } else {
        driveUrl = assertText(body.drive_url, 1000, true, 'drive_url');
        providerFolderId =
          this.provider.parseFolderId(driveUrl) ??
          `gdrive_fld_${crypto.randomBytes(6).toString('hex')}`;
      }

      const initialStatus =
        folderType === 'source'
          ? 'ready_for_download'
          : 'deliverable_submitted';

      // Insert folder with Google Drive V2 metadata (Requirement 4: folderId, parentId, owner, createdTime)
      const insertRes = await c.query(
        `INSERT INTO storage_folders (
           workspace_id, name, provider, provider_folder_id, provider_parent_id,
           drive_owner_email, drive_created_at, record_status, drive_url,
           folder_type, status, parent_folder_id, assigned_employee_id,
           created_by_employee_id, assignment_id, notes, current_revision_number, version
         ) VALUES ($1, $2, 'google_drive', $3, $4, $5, $6, 'active', $7, $8, $9, $10, $11, $12, $13, $14, 1, 1)
         RETURNING *`,
        [
          auth.workspace.id,
          name,
          providerFolderId,
          providerParentId,
          driveOwnerEmail,
          driveCreatedAt,
          driveUrl,
          folderType,
          initialStatus,
          parentFolderId,
          assignedEmployeeId,
          createdByEmployeeId,
          assignmentId,
          body.notes ? assertText(body.notes, 2000, false, 'notes') : null,
        ],
      );
      const folderRow = insertRes.rows[0];

      // Record durable create_folder operation
      await c.query(
        `INSERT INTO storage_operations (
           workspace_id, folder_id, operation_type, status,
           requested_by, provider, completed_at
         ) VALUES ($1, $2, 'create_folder', 'completed', $3, 'google_drive', clock_timestamp())`,
        [auth.workspace.id, folderRow.id, auth.user.id],
      );

      // Initial folder revision (Doc 03 / Doc 26)
      const initialSnapshot = crypto
        .createHash('sha256')
        .update(`${folderRow.id}:${folderRow.name}:${folderRow.drive_url}:rev1`)
        .digest('hex');

      await c.query(
        `INSERT INTO folder_revisions (workspace_id, folder_id, revision_number, snapshot_hash, notes)
         VALUES ($1, $2, 1, $3, 'Initial revision')`,
        [auth.workspace.id, folderRow.id, initialSnapshot],
      );

      // If source folder, process assignments and grant Google Drive permissions by employee email
      let employeeIdsToAssign: string[] = [];
      if (
        body.assigned_employee_ids &&
        Array.isArray(body.assigned_employee_ids)
      ) {
        employeeIdsToAssign = body.assigned_employee_ids.map((id) =>
          assertUuid(id, 'assigned_employee_id'),
        );
      } else if (assignedEmployeeId) {
        employeeIdsToAssign = [assignedEmployeeId];
      }

      // Deduplicate
      employeeIdsToAssign = [...new Set(employeeIdsToAssign)];
      if (!assignedEmployeeId && employeeIdsToAssign.length > 0) {
        assignedEmployeeId = employeeIdsToAssign[0]!;
        await c.query(
          'UPDATE storage_folders SET assigned_employee_id = $1 WHERE id = $2',
          [assignedEmployeeId, folderRow.id],
        );
        folderRow.assigned_employee_id = assignedEmployeeId;
      }

      const permissionGrants: StoragePermissionGrantData[] = [];

      for (const empId of employeeIdsToAssign) {
        // Verify employee exists and is active
        const empCheck = await c.query(
          "SELECT id, employee_code, full_name, google_email, user_id FROM employees WHERE workspace_id=$1 AND id=$2 AND employment_status='active'",
          [auth.workspace.id, empId],
        );
        if (empCheck.rows.length === 0) {
          fail(
            'VALIDATION_ERROR',
            `Employee ${empId} is not active in this workspace`,
            400,
          );
        }
        const empRow = empCheck.rows[0];
        const empGoogleEmail = await this.resolveEmployeeGoogleEmail(
          c,
          auth.workspace.id,
          empRow,
        );

        // Insert folder assignment
        await c.query(
          `INSERT INTO folder_assignments (workspace_id, folder_id, employee_id, status)
           VALUES ($1, $2, $3, 'assigned')
           ON CONFLICT (workspace_id, folder_id, employee_id) DO NOTHING`,
          [auth.workspace.id, folderRow.id, empId],
        );

        // Grant permission on Google Drive by employee's Google email (Requirement 6)
        let drivePermId = `perm_${crypto.randomBytes(6).toString('hex')}`;
        if (this.provider.grantPermission) {
          const permRes = await this.provider.grantPermission(
            {
              providerResourceId: providerFolderId,
              emailAddress: empGoogleEmail,
              role: permissionRole,
              type: 'user',
            },
            decryptedRefreshToken,
          );
          drivePermId = permRes.permissionId;
        }

        const accessLevel = permissionRole === 'writer' ? 'write' : 'read';

        // Upsert resource access grant with Google Drive permission metadata
        const grantInsert = await c.query(
          `INSERT INTO resource_access_grants (
             workspace_id, resource_type, resource_id, employee_id,
             access_level, drive_permission_id, drive_role, google_email, granted_by
           )
           VALUES ($1, 'storage_folder', $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (workspace_id, resource_type, resource_id, employee_id) DO UPDATE SET
             access_level = EXCLUDED.access_level,
             drive_permission_id = EXCLUDED.drive_permission_id,
             drive_role = EXCLUDED.drive_role,
             google_email = EXCLUDED.google_email,
             granted_by = EXCLUDED.granted_by,
             granted_at = clock_timestamp(),
             revoked_at = NULL,
             revoked_by = NULL
           RETURNING *`,
          [
            auth.workspace.id,
            folderRow.id,
            empId,
            accessLevel,
            drivePermId,
            permissionRole,
            empGoogleEmail,
            auth.user.id,
          ],
        );
        const gRow = grantInsert.rows[0];
        permissionGrants.push({
          id: gRow.id,
          workspace_id: gRow.workspace_id,
          resource_type: 'storage_folder',
          resource_id: folderRow.id,
          employee_id: empId,
          employee_name: empRow.full_name,
          google_email: empGoogleEmail,
          drive_role: permissionRole,
          access_level: accessLevel,
          drive_permission_id: drivePermId,
          inherited_from_resource_id: null,
          granted_by: auth.user.id,
          granted_at: gRow.granted_at.toISOString(),
          revoked_at: null,
        });
      }

      // If deliverable, update parent assignment and parent folder status
      if (folderType === 'deliverable' && parentFolderId) {
        if (assignmentId) {
          await c.query(
            `UPDATE folder_assignments
             SET output_delivered = true,
                 output_folder_id = $1,
                 output_delivered_at = clock_timestamp(),
                 status = 'delivered',
                 updated_at = clock_timestamp()
             WHERE workspace_id = $2 AND id = $3`,
            [folderRow.id, auth.workspace.id, assignmentId],
          );
        } else if (createdByEmployeeId) {
          await c.query(
            `UPDATE folder_assignments
             SET output_delivered = true,
                 output_folder_id = $1,
                 output_delivered_at = clock_timestamp(),
                 status = 'delivered',
                 updated_at = clock_timestamp()
             WHERE workspace_id = $2 AND folder_id = $3 AND employee_id = $4`,
            [
              folderRow.id,
              auth.workspace.id,
              parentFolderId,
              createdByEmployeeId,
            ],
          );
        }

        // Update parent status if needed
        await c.query(
          `UPDATE storage_folders
           SET status = 'deliverable_submitted',
               updated_at = clock_timestamp()
           WHERE workspace_id = $1 AND id = $2 AND status != 'approved' AND status != 'trashed'`,
          [auth.workspace.id, parentFolderId],
        );
      }

      // Record audit event
      await recordAuditEvent(c, {
        workspaceId: auth.workspace.id,
        actorUserId: auth.user.id,
        action: 'storage.folder_create',
        entityType: 'storage_folder',
        entityId: folderRow.id,
        requestId,
        metadata: {
          folder_type: folderType,
          name: folderRow.name,
          provider_folder_id: folderRow.provider_folder_id,
          provider_parent_id: folderRow.provider_parent_id,
          drive_owner_email: folderRow.drive_owner_email,
          parent_folder_id: parentFolderId,
          assigned_count: employeeIdsToAssign.length,
          permission_role: permissionRole,
        },
      });

      const responseData: StorageFolderData = {
        id: folderRow.id,
        workspace_id: folderRow.workspace_id,
        name: folderRow.name,
        provider: folderRow.provider,
        provider_folder_id: folderRow.provider_folder_id,
        provider_parent_id: folderRow.provider_parent_id,
        drive_owner_email: folderRow.drive_owner_email,
        drive_created_at: folderRow.drive_created_at
          ? folderRow.drive_created_at.toISOString()
          : folderRow.created_at.toISOString(),
        record_status: folderRow.record_status ?? 'active',
        drive_url: folderRow.drive_url,
        folder_type: folderRow.folder_type,
        status: folderRow.status,
        assigned_employee_id: folderRow.assigned_employee_id,
        parent_folder_id: folderRow.parent_folder_id,
        deliverable_count: 0,
        staff_download_confirmed: folderType === 'deliverable',
        owner_review_confirmed: false,
        notes: folderRow.notes,
        version: folderRow.version,
        created_at: folderRow.created_at.toISOString(),
        updated_at: folderRow.updated_at.toISOString(),
        permission_grants: permissionGrants,
      };

      if (idempotencyKey) {
        await completeIdempotency(c, {
          workspaceId: auth.workspace.id,
          actorUserId: auth.user.id,
          operationKey: idempotencyKey,
          responseCode: 201,
          sanitizedResponse: responseData as unknown as Record<string, unknown>,
        });
      }

      await c.query('COMMIT');
      return responseData;
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  }

  /**
   * 3. GET /api/v1/storage/folders/:id
   * Returns folder group detail with assignments, outputs, receipts, and dynamic delete_readiness.
   */
  async getFolder(
    auth: AuthenticatedContext,
    idParam: string,
  ): Promise<{ folder: StorageFolderDetailData; etag: string }> {
    const folderId = assertUuid(idParam, 'id');
    const c = await this.pool.connect();
    try {
      const folderRes = await c.query(
        `SELECT f.*, e.full_name AS assigned_employee_name
         FROM storage_folders f
         LEFT JOIN employees e ON e.workspace_id = f.workspace_id AND e.id = f.assigned_employee_id
         WHERE f.id = $1 AND f.workspace_id = $2`,
        [folderId, auth.workspace.id],
      );

      if (folderRes.rows.length === 0) {
        fail('NOT_FOUND', 'Folder not found', 404);
      }
      const folderRow = folderRes.rows[0];

      // Staff access check
      if (auth.workspace.role !== 'owner') {
        const staffEmployeeId = await this.getEmployeeId(c, auth);
        await this.assertStaffFolderAccess(
          c,
          folderId,
          auth.workspace.id,
          staffEmployeeId,
        );
      }

      // Query assignments
      const assignRes = await c.query(
        `SELECT a.*, e.full_name AS employee_name
         FROM folder_assignments a
         JOIN employees e ON e.workspace_id = a.workspace_id AND e.id = a.employee_id
         WHERE a.workspace_id = $1 AND a.folder_id = $2
         ORDER BY a.created_at ASC`,
        [auth.workspace.id, folderId],
      );

      const assignments: StorageAssignmentData[] = assignRes.rows.map(
        (row) => ({
          id: row.id,
          folder_id: row.folder_id,
          employee_id: row.employee_id,
          employee_name: row.employee_name,
          source_download_confirmed: row.source_download_confirmed,
          source_downloaded_at: row.source_downloaded_at
            ? row.source_downloaded_at.toISOString()
            : undefined,
          output_delivered: row.output_delivered,
          output_folder_id: row.output_folder_id,
          output_delivered_at: row.output_delivered_at
            ? row.output_delivered_at.toISOString()
            : undefined,
          status: row.status,
        }),
      );

      // Query child deliverables (outputs)
      const outputsRes = await c.query(
        `SELECT df.*, e.full_name AS submitted_by_employee_name
         FROM storage_folders df
         LEFT JOIN employees e ON e.workspace_id = df.workspace_id AND e.id = df.created_by_employee_id
         WHERE df.workspace_id = $1 AND df.parent_folder_id = $2
         ORDER BY df.created_at ASC`,
        [auth.workspace.id, folderId],
      );

      const outputs: StorageOutputData[] = outputsRes.rows.map((row) => ({
        id: row.id,
        parent_folder_id: row.parent_folder_id,
        assignment_id: row.assignment_id,
        submitted_by_employee_id: row.created_by_employee_id ?? '',
        submitted_by_employee_name: row.submitted_by_employee_name ?? 'Nhân sự',
        name: row.name,
        drive_url: row.drive_url,
        current_revision: row.current_revision_number ?? 1,
        owner_receipt_confirmed: row.owner_receipt_confirmed ?? false,
        owner_receipt_revision: row.owner_receipt_revision,
        owner_reviewed_at: row.owner_reviewed_at
          ? row.owner_reviewed_at.toISOString()
          : undefined,
        notes: row.notes,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at ? row.updated_at.toISOString() : undefined,
      }));

      // Query receipts
      const receiptsRes = await c.query(
        `SELECT r.*, u.username_normalized AS confirmed_by_name
         FROM folder_receipts r
         JOIN users u ON u.id = r.confirmed_by
         WHERE r.workspace_id = $1
           AND (r.folder_id = $2 OR r.folder_id IN (
             SELECT id FROM storage_folders WHERE workspace_id = $1 AND parent_folder_id = $2
           ))
         ORDER BY r.confirmed_at DESC`,
        [auth.workspace.id, folderId],
      );

      const receipts: StorageReceiptData[] = receiptsRes.rows.map((row) => ({
        id: row.id,
        folder_id: row.folder_id,
        receipt_type: row.receipt_type,
        revision_number: row.revision_number,
        confirmed_by: row.confirmed_by,
        confirmed_by_name: row.confirmed_by_name,
        confirmed_at: row.confirmed_at.toISOString(),
        notes: row.notes,
      }));

      // Compute dynamic Delete-Readiness (Doc 26, SCOPE-EXT-05-FILE-01)
      const totalAssignments = assignments.length;
      const confirmedDownloads = assignments.filter(
        (a) => a.source_download_confirmed,
      ).length;
      const deliveredAssignments = assignments.filter(
        (a) => a.output_delivered,
      ).length;
      const totalOutputs = outputs.length;
      const confirmedOutputs = outputs.filter(
        (o) => o.owner_receipt_confirmed,
      ).length;
      const staleOutputRevisions = outputs.filter(
        (o) =>
          !o.owner_receipt_confirmed ||
          o.owner_receipt_revision !== o.current_revision,
      ).length;

      const blockReasons: string[] = [];
      if (folderRow.status === 'trashed') {
        blockReasons.push('Nhóm thư mục đã nằm trong Thùng rác Google Drive.');
      } else {
        if (totalAssignments === 0) {
          blockReasons.push(
            'Chưa phân công nhân viên nào cho nhóm thư mục này.',
          );
        }
        if (confirmedDownloads < totalAssignments) {
          blockReasons.push(
            `Còn ${totalAssignments - confirmedDownloads} nhân viên chưa xác nhận tải thư mục nguồn.`,
          );
        }
        if (deliveredAssignments < totalAssignments) {
          blockReasons.push(
            `Còn ${totalAssignments - deliveredAssignments} nhân viên chưa nộp thư mục thành phẩm (Không được phép xóa từng phần / Partial Delete).`,
          );
        }
        if (confirmedOutputs < totalOutputs) {
          blockReasons.push(
            `Còn ${totalOutputs - confirmedOutputs} thư mục thành phẩm chưa được Owner duyệt xác nhận.`,
          );
        }
        if (staleOutputRevisions > 0) {
          blockReasons.push(
            `Có ${staleOutputRevisions} thành phẩm có biên nhận lạc hậu do revision đã thay đổi.`,
          );
        }
      }

      // Group snapshot hash: captures exact state of parent folder, assignments, and deliverables
      const groupSnapshotHash = crypto
        .createHash('sha256')
        .update(
          `${folderRow.id}:${folderRow.version}|` +
            assignments
              .map(
                (a) =>
                  `${a.id}:${a.status}:${a.source_download_confirmed}:${a.output_delivered}`,
              )
              .join(';') +
            '|' +
            outputs
              .map(
                (o) =>
                  `${o.id}:${o.current_revision}:${o.owner_receipt_confirmed}:${o.owner_receipt_revision}`,
              )
              .join(';'),
        )
        .digest('hex');

      const isReady =
        blockReasons.length === 0 &&
        totalAssignments > 0 &&
        deliveredAssignments === totalAssignments &&
        confirmedOutputs === totalOutputs &&
        staleOutputRevisions === 0 &&
        folderRow.status !== 'trashed';

      const deleteReadiness: StorageDeleteReadiness = {
        can_verify: true,
        is_ready: isReady,
        total_assignments: totalAssignments,
        confirmed_downloads: confirmedDownloads,
        delivered_assignments: deliveredAssignments,
        total_outputs: totalOutputs,
        confirmed_outputs: confirmedOutputs,
        stale_output_revisions: staleOutputRevisions,
        group_snapshot_hash: groupSnapshotHash,
        block_reasons: blockReasons,
      };

      const deliverableFoldersData: StorageFolderData[] = outputs.map((o) => ({
        id: o.id,
        workspace_id: folderRow.workspace_id,
        name: o.name,
        provider: folderRow.provider,
        drive_url: o.drive_url,
        folder_type: 'deliverable',
        status: o.owner_receipt_confirmed
          ? 'approved'
          : 'deliverable_submitted',
        parent_folder_id: folderId,
        deliverable_count: 0,
        staff_download_confirmed: true,
        owner_review_confirmed: o.owner_receipt_confirmed,
        owner_reviewed_at: o.owner_reviewed_at,
        notes: o.notes,
        version: 1,
        created_at: o.created_at,
        updated_at: o.updated_at,
      }));

      const files = await this.getFolderFilesInternal(
        c,
        auth.workspace.id,
        folderId,
      );
      const permissionGrants = await this.getResourcePermissionsInternal(
        c,
        auth.workspace.id,
        'storage_folder',
        folderId,
      );

      const detailData: StorageFolderDetailData = {
        id: folderRow.id,
        workspace_id: folderRow.workspace_id,
        name: folderRow.name,
        provider: folderRow.provider,
        provider_folder_id: folderRow.provider_folder_id,
        provider_parent_id: folderRow.provider_parent_id ?? null,
        drive_owner_email: folderRow.drive_owner_email ?? null,
        drive_created_at: folderRow.drive_created_at
          ? folderRow.drive_created_at.toISOString()
          : folderRow.created_at.toISOString(),
        record_status: folderRow.record_status ?? 'active',
        drive_url: folderRow.drive_url,
        folder_type: folderRow.folder_type,
        status: folderRow.status,
        assigned_employee_id: folderRow.assigned_employee_id,
        assigned_employee_name: folderRow.assigned_employee_name ?? undefined,
        parent_folder_id: folderRow.parent_folder_id,
        deliverable_count: outputs.length,
        staff_download_confirmed: folderRow.status !== 'ready_for_download',
        owner_review_confirmed: folderRow.owner_receipt_confirmed ?? false,
        owner_reviewed_at: folderRow.owner_reviewed_at
          ? folderRow.owner_reviewed_at.toISOString()
          : undefined,
        notes: folderRow.notes,
        version: folderRow.version,
        created_at: folderRow.created_at.toISOString(),
        updated_at: folderRow.updated_at
          ? folderRow.updated_at.toISOString()
          : undefined,
        deliverable_folders: deliverableFoldersData,
        deliverables: deliverableFoldersData,
        assignments,
        outputs,
        receipts,
        files,
        permission_grants: permissionGrants,
        delete_readiness: deleteReadiness,
      };

      return {
        folder: detailData,
        etag: `"${folderRow.version}"`,
      };
    } finally {
      c.release();
    }
  }

  /**
   * 4. GET /api/v1/storage/folders/:id/files
   * Returns list of file metadata associated with this folder.
   */
  async getFolderFiles(
    auth: AuthenticatedContext,
    idParam: string,
  ): Promise<StorageFileData[]> {
    const folderId = assertUuid(idParam, 'id');
    const c = await this.pool.connect();
    try {
      const folderRes = await c.query(
        "SELECT id FROM storage_folders WHERE id=$1 AND workspace_id=$2 AND COALESCE(record_status, 'active') != 'detached'",
        [folderId, auth.workspace.id],
      );
      if (folderRes.rows.length === 0) {
        fail('NOT_FOUND', 'Folder not found', 404);
      }

      if (auth.workspace.role !== 'owner') {
        const staffEmployeeId = await this.getEmployeeId(c, auth);
        await this.assertStaffFolderAccess(
          c,
          folderId,
          auth.workspace.id,
          staffEmployeeId,
        );
      }

      return await this.getFolderFilesInternal(c, auth.workspace.id, folderId);
    } finally {
      c.release();
    }
  }

  /**
   * 5. POST /api/v1/storage/folders/:id/receipts
   * Records download confirmation (Staff) or deliverable approval (Owner).
   */
  async createReceipt(
    auth: AuthenticatedContext,
    idParam: string,
    body: CreateStorageReceiptRequest,
    idempotencyKey?: string | undefined,
    requestId: string = crypto.randomUUID(),
  ): Promise<StorageReceiptData> {
    const folderId = assertUuid(idParam, 'id');
    const rawReceiptType = assertText(
      body.receipt_type,
      50,
      true,
      'receipt_type',
    );
    const receiptType =
      rawReceiptType === 'staff_source_ack'
        ? 'download'
        : rawReceiptType === 'owner_deliverable_review'
          ? 'deliverable_approval'
          : rawReceiptType;

    if (receiptType !== 'download' && receiptType !== 'deliverable_approval') {
      fail(
        'VALIDATION_ERROR',
        "receipt_type must be 'download' or 'deliverable_approval'",
        400,
      );
    }

    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');

      // Idempotency check
      if (idempotencyKey) {
        const fingerprint = computeRequestFingerprint(
          'POST',
          `/api/v1/storage/folders/${folderId}/receipts`,
          body,
        );
        const claim = await claimIdempotency(c, {
          workspaceId: auth.workspace.id,
          actorUserId: auth.user.id,
          operationKey: idempotencyKey,
          requestFingerprint: fingerprint,
        });
        if (claim.status === 'replay' && claim.sanitizedResponse) {
          await c.query('ROLLBACK');
          return claim.sanitizedResponse as unknown as StorageReceiptData;
        }
        if (claim.status === 'in_progress' || claim.status === 'mismatch') {
          await c.query('ROLLBACK');
          fail('CONFLICT', claim.error, 409);
        }
      }

      // Check folder exists
      const folderRes = await c.query(
        'SELECT * FROM storage_folders WHERE id=$1 AND workspace_id=$2 FOR UPDATE',
        [folderId, auth.workspace.id],
      );
      if (folderRes.rows.length === 0) {
        fail('NOT_FOUND', 'Folder not found', 404);
      }
      const folderRow = folderRes.rows[0];

      let targetFolderId = folderId;
      let revisionNumber = folderRow.current_revision_number ?? 1;
      let assignmentId: string | null = null;

      if (receiptType === 'download') {
        // Staff confirming source download
        if (auth.workspace.role !== 'owner') {
          const staffEmployeeId = await this.getEmployeeId(c, auth);
          const assignRes = await c.query(
            `SELECT id, status, output_delivered FROM folder_assignments
             WHERE workspace_id=$1 AND folder_id=$2 AND employee_id=$3 FOR UPDATE`,
            [auth.workspace.id, folderId, staffEmployeeId],
          );
          if (assignRes.rows.length === 0) {
            fail('FORBIDDEN', 'Staff is not assigned to this folder', 403);
          }
          assignmentId = assignRes.rows[0].id;

          await c.query(
            `UPDATE folder_assignments
             SET source_download_confirmed = true,
                 source_downloaded_at = clock_timestamp(),
                 status = CASE WHEN output_delivered THEN 'delivered' ELSE 'downloaded' END,
                 updated_at = clock_timestamp()
             WHERE id = $1`,
            [assignmentId],
          );
        } else {
          // Owner creating download receipt
          if (folderRow.assigned_employee_id) {
            const assignRes = await c.query(
              `SELECT id FROM folder_assignments WHERE workspace_id=$1 AND folder_id=$2 AND employee_id=$3`,
              [auth.workspace.id, folderId, folderRow.assigned_employee_id],
            );
            if (assignRes.rows.length > 0) {
              assignmentId = assignRes.rows[0].id;
              await c.query(
                `UPDATE folder_assignments
                 SET source_download_confirmed = true,
                     source_downloaded_at = clock_timestamp(),
                     updated_at = clock_timestamp()
                 WHERE id = $1`,
                [assignmentId],
              );
            }
          }
        }

        // Update folder status to 'downloaded' if 'ready_for_download'
        if (folderRow.status === 'ready_for_download') {
          await c.query(
            "UPDATE storage_folders SET status='downloaded', updated_at=clock_timestamp() WHERE id=$1",
            [folderId],
          );
        }
      } else {
        // 'deliverable_approval' requires Owner role
        requireRole(['owner'], auth);

        if (!body.output_id) {
          fail(
            'VALIDATION_ERROR',
            'output_id is required for deliverable_approval',
            400,
          );
        }
        const outputId = assertUuid(body.output_id, 'output_id');

        // Verify output deliverable folder belongs to this group
        const outputRes = await c.query(
          `SELECT * FROM storage_folders
           WHERE id=$1 AND workspace_id=$2 AND parent_folder_id=$3 FOR UPDATE`,
          [outputId, auth.workspace.id, folderId],
        );
        if (outputRes.rows.length === 0) {
          fail(
            'NOT_FOUND',
            'Deliverable output folder not found in this group',
            404,
          );
        }
        const outputRow = outputRes.rows[0];

        const targetRev =
          body.revision_number ?? outputRow.current_revision_number ?? 1;
        if (targetRev !== outputRow.current_revision_number) {
          fail(
            'PRECONDITION_FAILED',
            `Approved revision ${targetRev} does not match current revision ${outputRow.current_revision_number}`,
            412,
          );
        }

        targetFolderId = outputId;
        revisionNumber = targetRev;

        // Mark deliverable approved
        await c.query(
          `UPDATE storage_folders
           SET owner_receipt_confirmed = true,
               owner_receipt_revision = $1,
               owner_reviewed_at = clock_timestamp(),
               status = 'approved',
               updated_at = clock_timestamp()
           WHERE id = $2`,
          [targetRev, outputId],
        );

        // Check if all deliverables of parent are approved
        const unapprovedCheck = await c.query(
          `SELECT 1 FROM storage_folders
           WHERE workspace_id=$1 AND parent_folder_id=$2 AND (owner_receipt_confirmed IS NOT TRUE OR status != 'approved')`,
          [auth.workspace.id, folderId],
        );
        if (unapprovedCheck.rows.length === 0) {
          await c.query(
            "UPDATE storage_folders SET status='approved', updated_at=clock_timestamp() WHERE id=$1",
            [folderId],
          );
        }
      }

      // Insert receipt
      const receiptRes = await c.query(
        `INSERT INTO folder_receipts (
           workspace_id, folder_id, receipt_type, revision_number,
           confirmed_by, assignment_id, notes
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          auth.workspace.id,
          targetFolderId,
          receiptType,
          revisionNumber,
          auth.user.id,
          assignmentId,
          body.notes ? assertText(body.notes, 2000, false, 'notes') : null,
        ],
      );
      const receiptRow = receiptRes.rows[0];

      // Audit event
      await recordAuditEvent(c, {
        workspaceId: auth.workspace.id,
        actorUserId: auth.user.id,
        action: 'storage.receipt_create',
        entityType: 'folder_receipt',
        entityId: receiptRow.id,
        requestId,
        metadata: {
          folder_id: folderId,
          target_folder_id: targetFolderId,
          receipt_type: receiptType,
          revision_number: revisionNumber,
        },
      });

      const responseData: StorageReceiptData = {
        id: receiptRow.id,
        folder_id: receiptRow.folder_id,
        receipt_type: receiptRow.receipt_type,
        revision_number: receiptRow.revision_number,
        confirmed_by: receiptRow.confirmed_by,
        confirmed_at: receiptRow.confirmed_at.toISOString(),
        notes: receiptRow.notes,
      };

      if (idempotencyKey) {
        await completeIdempotency(c, {
          workspaceId: auth.workspace.id,
          actorUserId: auth.user.id,
          operationKey: idempotencyKey,
          responseCode: 201,
          sanitizedResponse: responseData as unknown as Record<string, unknown>,
        });
      }

      await c.query('COMMIT');
      return responseData;
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  }

  /**
   * 6. POST /api/v1/storage/folders/:id/trash-requests
   * Step 1 of Group Trash protocol (Owner only).
   */
  async createTrashRequest(
    auth: AuthenticatedContext,
    idParam: string,
    body: CreateTrashRequestRequest,
    ifMatch?: string | undefined,
    requestId: string = crypto.randomUUID(),
  ): Promise<CreateTrashRequestResponseData> {
    requireRole(['owner'], auth);
    const folderId = assertUuid(idParam, 'id');

    // Get folder detail to evaluate delete_readiness
    const { folder } = await this.getFolder(auth, folderId);

    if (folder.status === 'trashed') {
      fail('CONFLICT', 'Folder group is already trashed', 409);
    }

    // Version precondition check
    if (ifMatch) {
      const matchVersion = Number(ifMatch.replace(/["\s]/g, ''));
      if (isNaN(matchVersion) || matchVersion !== folder.version) {
        fail(
          'PRECONDITION_FAILED',
          `If-Match version ${ifMatch} does not match current version ${folder.version}`,
          412,
        );
      }
    }
    if (body.version !== undefined && body.version !== folder.version) {
      fail(
        'PRECONDITION_FAILED',
        `Request version ${body.version} does not match current version ${folder.version}`,
        412,
      );
    }

    // Strict Fail-Closed Delete-Readiness Check (Doc 26, SCOPE-EXT-05-FILE-01)
    const readiness = folder.delete_readiness;
    if (!readiness || !readiness.is_ready) {
      const reasons = readiness?.block_reasons ?? [
        'Điều kiện xóa chưa được đáp ứng',
      ];
      fail(
        'CANNOT_TRASH_INCOMPLETE_GROUP',
        `Không thể khởi tạo yêu cầu xóa: ${reasons.join('; ')}`,
        409,
      );
    }

    const groupSnapshotHash = readiness.group_snapshot_hash;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15-minute TTL

    const warning =
      'CẢNH BÁO NGUY HIỂM: Toàn bộ nhóm thư mục gốc và tất cả thành phẩm bàn giao liên quan sẽ được chuyển đồng thời vào Thùng rác của Google Drive (Google Drive Trash). Hệ thống không cho phép xóa lẻ từng phần.';

    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');

      const insertRes = await c.query(
        `INSERT INTO storage_trash_requests (
           workspace_id, folder_id, requested_by, status,
           group_snapshot_hash, deliverables_affected_count, warning, expires_at
         ) VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7)
         RETURNING *`,
        [
          auth.workspace.id,
          folderId,
          auth.user.id,
          groupSnapshotHash,
          folder.deliverable_count,
          warning,
          expiresAt,
        ],
      );
      const reqRow = insertRes.rows[0];

      // Audit event
      await recordAuditEvent(c, {
        workspaceId: auth.workspace.id,
        actorUserId: auth.user.id,
        action: 'storage.trash_request_create',
        entityType: 'storage_trash_request',
        entityId: reqRow.id,
        requestId,
        metadata: {
          folder_id: folderId,
          group_snapshot_hash: groupSnapshotHash,
          deliverables_affected: folder.deliverable_count,
        },
      });

      await c.query('COMMIT');

      return {
        trash_request_id: reqRow.id,
        folder_id: folderId,
        folder_name: folder.name,
        group_snapshot_hash: groupSnapshotHash,
        deliverables_affected_count: folder.deliverable_count,
        warning,
        expires_at: expiresAt.toISOString(),
      };
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  }

  /**
   * 7. POST /api/v1/storage/trash-requests/:id/confirm
   * Step 2 of Group Trash protocol (Owner only).
   */
  async confirmTrashRequest(
    auth: AuthenticatedContext,
    requestIdParam: string,
    body: ConfirmTrashRequest,
    userRequestId: string = crypto.randomUUID(),
  ): Promise<ConfirmTrashResponseData> {
    requireRole(['owner'], auth);
    const trashRequestId = assertUuid(requestIdParam, 'id');

    if (!body.acknowledged) {
      fail(
        'VALIDATION_ERROR',
        'Explicit acknowledgment required to confirm group trash',
        400,
      );
    }
    const submittedSnapshotHash = assertText(
      body.group_snapshot_hash,
      100,
      true,
      'group_snapshot_hash',
    );

    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');

      // Fetch pending trash request
      const reqRes = await c.query(
        'SELECT * FROM storage_trash_requests WHERE id=$1 AND workspace_id=$2 FOR UPDATE',
        [trashRequestId, auth.workspace.id],
      );
      if (reqRes.rows.length === 0) {
        fail('NOT_FOUND', 'Trash request not found', 404);
      }
      const trashReq = reqRes.rows[0];

      if (trashReq.status !== 'pending') {
        fail('CONFLICT', `Trash request is already ${trashReq.status}`, 409);
      }
      if (new Date() > new Date(trashReq.expires_at)) {
        await c.query(
          "UPDATE storage_trash_requests SET status='expired' WHERE id=$1",
          [trashRequestId],
        );
        fail(
          'GONE',
          'Trash request has expired. Please initiate a new request.',
          410,
        );
      }

      // Re-evaluate folder group readiness & snapshot hash in current state
      const { folder } = await this.getFolder(auth, trashReq.folder_id);
      const readiness = folder.delete_readiness;

      if (!readiness || !readiness.is_ready) {
        fail(
          'CONFLICT',
          'Folder group no longer satisfies deletion criteria',
          409,
        );
      }

      // Concurrency check: Ensure group state hasn't changed since request initiation
      if (
        readiness.group_snapshot_hash !== submittedSnapshotHash ||
        readiness.group_snapshot_hash !== trashReq.group_snapshot_hash
      ) {
        fail(
          'PRECONDITION_FAILED',
          'Folder group state has changed since trash request was initiated (revisions or assignments mismatch)',
          412,
        );
      }

      // 1. Identify all folders in group (root source folder + deliverable child folders)
      const allFoldersRes = await c.query<{
        id: string;
        name: string;
        provider_folder_id: string | null;
        status: string;
      }>(
        `SELECT id, name, provider_folder_id, status
         FROM storage_folders
         WHERE workspace_id = $1 AND (id = $2 OR parent_folder_id = $2)
         ORDER BY (CASE WHEN id = $2 THEN 0 ELSE 1 END), created_at ASC`,
        [auth.workspace.id, trashReq.folder_id],
      );
      const allFolders = allFoldersRes.rows;

      // 2. Fetch existing durable operations for these folders to enable idempotent resumption / reconciliation
      const existingOpsRes = await c.query<{
        folder_id: string;
        status: 'pending' | 'running' | 'completed' | 'failed' | 'unknown';
      }>(
        `SELECT DISTINCT ON (folder_id) folder_id, status
         FROM storage_operations
         WHERE workspace_id = $1 AND operation_type = 'trash_group' AND folder_id = ANY($2::uuid[])
         ORDER BY folder_id, created_at DESC`,
        [auth.workspace.id, allFolders.map((f) => f.id)],
      );
      const existingOpsMap = new Map<string, string>();
      for (const op of existingOpsRes.rows) {
        existingOpsMap.set(op.folder_id, op.status);
      }

      // 3. Process each folder durably
      const folderResults: Array<{
        folder_id: string;
        folder_name: string;
        status: 'completed' | 'failed' | 'unknown';
        error_message?: string | undefined;
      }> = [];

      for (const f of allFolders) {
        const prevStatus = existingOpsMap.get(f.id);

        // If this folder was already confirmed completed in a previous attempt, skip provider call (Idempotency)
        if (prevStatus === 'completed') {
          folderResults.push({
            folder_id: f.id,
            folder_name: f.name,
            status: 'completed',
          });
          continue;
        }

        // If previous status was 'unknown', we MUST reconcile with the provider before retrying
        if (prevStatus === 'unknown' && this.provider.reconcileFolderStatus) {
          let reconRes: StorageProviderResult;
          try {
            reconRes = await this.provider.reconcileFolderStatus(
              f.provider_folder_id,
            );
          } catch (reconErr: unknown) {
            reconRes = {
              success: false,
              status: 'unknown',
              errorMessage:
                reconErr instanceof Error
                  ? reconErr.message
                  : 'Provider reconciliation connection error',
            };
          }

          if (reconRes.status === 'completed') {
            // Folder is confirmed already trashed on provider! Durably record completed
            await c.query(
              `INSERT INTO storage_operations (
                 workspace_id, folder_id, operation_type, status,
                 requested_by, provider, completed_at
               ) VALUES ($1, $2, 'trash_group', 'completed', $3, 'google_drive', clock_timestamp())`,
              [auth.workspace.id, f.id, auth.user.id],
            );
            if (f.id !== trashReq.folder_id) {
              await c.query(
                `UPDATE storage_folders
                 SET status = 'trashed', version = version + 1, updated_at = clock_timestamp()
                 WHERE id = $1 AND workspace_id = $2`,
                [f.id, auth.workspace.id],
              );
            }
            folderResults.push({
              folder_id: f.id,
              folder_name: f.name,
              status: 'completed',
            });
            continue;
          } else if (reconRes.status === 'unknown') {
            // Still unknown after reconciliation, cannot proceed with blind retry
            folderResults.push({
              folder_id: f.id,
              folder_name: f.name,
              status: 'unknown',
              error_message:
                reconRes.errorMessage ||
                'Reconciliation returned unknown status',
            });
            continue;
          }
          // If reconcile returned 'failed' (meaning folder is not yet trashed on provider), proceed to retry trashFolder
        }

        // Record or update operation to 'running'
        const opRes = await c.query<{ id: string }>(
          `INSERT INTO storage_operations (
             workspace_id, folder_id, operation_type, status,
             requested_by, provider
           ) VALUES ($1, $2, 'trash_group', 'running', $3, 'google_drive')
           RETURNING id`,
          [auth.workspace.id, f.id, auth.user.id],
        );
        const opId = opRes.rows[0]!.id;

        // Call provider trash for this individual folder
        let providerRes: StorageProviderResult;
        try {
          providerRes = await this.provider.trashFolder(f.provider_folder_id);
        } catch (callErr: unknown) {
          providerRes = {
            success: false,
            status: 'unknown',
            errorMessage:
              callErr instanceof Error
                ? callErr.message
                : 'Provider request crashed or timed out',
          };
        }

        const effectiveStatus =
          providerRes.status || (providerRes.success ? 'completed' : 'failed');

        if (effectiveStatus === 'completed') {
          await c.query(
            `UPDATE storage_operations
             SET status = 'completed', completed_at = clock_timestamp()
             WHERE id = $1`,
            [opId],
          );
          // If this is a deliverable child folder, mark it as trashed in DB
          if (f.id !== trashReq.folder_id) {
            await c.query(
              `UPDATE storage_folders
               SET status = 'trashed', version = version + 1, updated_at = clock_timestamp()
               WHERE id = $1 AND workspace_id = $2`,
              [f.id, auth.workspace.id],
            );
          }
          folderResults.push({
            folder_id: f.id,
            folder_name: f.name,
            status: 'completed',
          });
        } else if (effectiveStatus === 'unknown') {
          await c.query(
            `UPDATE storage_operations
             SET status = 'unknown', error_message = $2
             WHERE id = $1`,
            [
              opId,
              providerRes.errorMessage || 'Provider operation status unknown',
            ],
          );
          folderResults.push({
            folder_id: f.id,
            folder_name: f.name,
            status: 'unknown',
            error_message:
              providerRes.errorMessage || 'Provider operation status unknown',
          });
        } else {
          await c.query(
            `UPDATE storage_operations
             SET status = 'failed', error_message = $2
             WHERE id = $1`,
            [
              opId,
              providerRes.errorMessage || 'Provider failed to trash folder',
            ],
          );
          folderResults.push({
            folder_id: f.id,
            folder_name: f.name,
            status: 'failed',
            error_message:
              providerRes.errorMessage || 'Provider failed to trash folder',
          });
        }
      }

      // 4. Invariant Check: Verify if 100% of folders in group reached 'completed' status
      const failedOrUnknown = folderResults.filter(
        (r) => r.status === 'failed' || r.status === 'unknown',
      );

      if (failedOrUnknown.length > 0) {
        // DO NOT mark the group trashed!
        // DO NOT mark trash request as confirmed!
        // COMMIT the durable operations and individual folder updates so external state and DB state remain synchronized!
        await c.query('COMMIT');

        const hasUnknown = failedOrUnknown.some((r) => r.status === 'unknown');
        const statusCode = hasUnknown ? 504 : 502;
        const errorCode = hasUnknown
          ? 'STORAGE_PROVIDER_TIMEOUT'
          : 'STORAGE_PROVIDER_PARTIAL_FAILURE';

        throw new AuthError(
          errorCode,
          `Google Drive Trash chưa hoàn tất toàn bộ nhóm (${failedOrUnknown.length}/${allFolders.length} thư mục gặp lỗi/chưa xác minh). Yêu cầu đã được lưu bền vững, vui lòng thử lại để hoàn tất hòa giải.`,
          statusCode,
          failedOrUnknown.map((f) => ({
            field: f.folder_id,
            message: `Thư mục "${f.folder_name}": ${f.status} (${f.error_message || 'chưa rõ'})`,
          })),
        );
      }

      // 5. Complete Group Trash: All folders verified completed
      await c.query(
        "UPDATE storage_trash_requests SET status='confirmed', confirmed_at=clock_timestamp() WHERE id=$1",
        [trashRequestId],
      );

      // Ensure root folder and all deliverables are marked trashed
      await c.query(
        `UPDATE storage_folders
         SET status = 'trashed',
             version = version + 1,
             updated_at = clock_timestamp()
         WHERE workspace_id = $1 AND (id = $2 OR parent_folder_id = $2) AND status != 'trashed'`,
        [auth.workspace.id, trashReq.folder_id],
      );

      // Audit event
      await recordAuditEvent(c, {
        workspaceId: auth.workspace.id,
        actorUserId: auth.user.id,
        action: 'storage.group_trashed',
        entityType: 'storage_folder',
        entityId: trashReq.folder_id,
        requestId: userRequestId,
        metadata: {
          trash_request_id: trashRequestId,
          group_snapshot_hash: submittedSnapshotHash,
          affected_deliverables_count: folder.deliverable_count,
          total_folders_trashed: allFolders.length,
        },
      });

      await c.query('COMMIT');

      return {
        folder_id: trashReq.folder_id,
        status: 'trashed',
        trashed_at: new Date().toISOString(),
      };
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  }

  /**
   * 8. GET /api/v1/storage/operations/:id
   * Retrieves durable storage operation status (Doc 26).
   */
  async getOperation(
    auth: AuthenticatedContext,
    operationIdParam: string,
  ): Promise<StorageOperationData> {
    const opId = assertUuid(operationIdParam, 'id');
    const c = await this.pool.connect();
    try {
      const res = await c.query(
        'SELECT * FROM storage_operations WHERE id=$1 AND workspace_id=$2',
        [opId, auth.workspace.id],
      );
      if (res.rows.length === 0) {
        fail('NOT_FOUND', 'Storage operation not found', 404);
      }
      const row = res.rows[0];

      if (auth.workspace.role !== 'owner') {
        const staffEmployeeId = await this.getEmployeeId(c, auth);
        await this.assertStaffFolderAccess(
          c,
          row.folder_id,
          auth.workspace.id,
          staffEmployeeId,
        );
      }

      return {
        id: row.id,
        workspace_id: row.workspace_id,
        folder_id: row.folder_id,
        operation_type: row.operation_type,
        status: row.status,
        requested_by: row.requested_by,
        provider: row.provider,
        error_message: row.error_message,
        created_at: row.created_at.toISOString(),
        completed_at: row.completed_at
          ? row.completed_at.toISOString()
          : undefined,
      };
    } finally {
      c.release();
    }
  }

  /**
   * 9. POST /api/v1/storage/folders/:id/files/upload-sessions
   * Initiates a Google Drive API v3 resumable video upload session (uploadType=resumable).
   */
  async initiateVideoUpload(
    auth: AuthenticatedContext,
    folderIdParam: string,
    body: InitiateVideoUploadRequest,
    idempotencyKey?: string | undefined,
    requestId: string = crypto.randomUUID(),
  ): Promise<StorageFileData> {
    const folderId = assertUuid(folderIdParam, 'folder_id');
    const name = assertText(body.name, 255, true, 'name');
    const mimeType = body.mime_type
      ? assertText(body.mime_type, 100, false, 'mime_type')
      : 'video/mp4';
    const sizeBytes = Number(body.size_bytes);
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      fail('VALIDATION_ERROR', 'size_bytes must be a positive number', 400);
    }

    const permissionRole: DrivePermissionRole =
      body.permission_role === 'writer' ? 'writer' : 'reader';

    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');

      if (idempotencyKey) {
        const fingerprint = computeRequestFingerprint(
          'POST',
          `/api/v1/storage/folders/${folderId}/files/upload-sessions`,
          body,
        );
        const claim = await claimIdempotency(c, {
          workspaceId: auth.workspace.id,
          actorUserId: auth.user.id,
          operationKey: idempotencyKey,
          requestFingerprint: fingerprint,
        });
        if (claim.status === 'replay' && claim.sanitizedResponse) {
          await c.query('ROLLBACK');
          return claim.sanitizedResponse as unknown as StorageFileData;
        }
        if (claim.status === 'in_progress' || claim.status === 'mismatch') {
          await c.query('ROLLBACK');
          fail('CONFLICT', claim.error, 409);
        }
      }

      const folderRes = await c.query(
        "SELECT * FROM storage_folders WHERE id=$1 AND workspace_id=$2 AND COALESCE(record_status, 'active') != 'detached'",
        [folderId, auth.workspace.id],
      );
      if (folderRes.rows.length === 0) {
        fail('NOT_FOUND', 'Folder not found', 404);
      }
      const folderRow = folderRes.rows[0];

      if (auth.workspace.role !== 'owner') {
        const staffEmployeeId = await this.getEmployeeId(c, auth);
        await this.assertStaffFolderAccess(
          c,
          folderId,
          auth.workspace.id,
          staffEmployeeId,
        );
      }

      let assignedEmployeeId: string | null = null;
      let assignedEmployeeName: string | undefined;
      let assignedEmployeeEmail: string | null = null;

      if (body.assigned_employee_id) {
        assignedEmployeeId = assertUuid(
          body.assigned_employee_id,
          'assigned_employee_id',
        );
        const empCheck = await c.query(
          "SELECT id, employee_code, full_name, google_email, user_id FROM employees WHERE workspace_id=$1 AND id=$2 AND employment_status='active'",
          [auth.workspace.id, assignedEmployeeId],
        );
        if (empCheck.rows.length === 0) {
          fail(
            'VALIDATION_ERROR',
            `Employee ${assignedEmployeeId} is not active in this workspace`,
            400,
          );
        }
        assignedEmployeeName = empCheck.rows[0].full_name;
        assignedEmployeeEmail = await this.resolveEmployeeGoogleEmail(
          c,
          auth.workspace.id,
          empCheck.rows[0],
        );
      }

      const providerFolderId =
        folderRow.provider_folder_id ??
        this.provider.parseFolderId(folderRow.drive_url);
      const driveOwnerEmail =
        folderRow.drive_owner_email ?? 'drive-admin@hoaiphuong.click';
      const decryptedRefreshToken =
        await this.getDecryptedWorkspaceRefreshToken(c, auth.workspace.id);

      let uploadSessionId = `resumable_${crypto.randomBytes(8).toString('hex')}`;
      let providerFileId = `gdrive_vid_${crypto.randomBytes(6).toString('hex')}`;

      if (this.provider.initiateResumableUpload) {
        const session = await this.provider.initiateResumableUpload(
          {
            folderId: providerFolderId,
            fileName: name,
            mimeType,
            sizeBytes,
          },
          decryptedRefreshToken,
        );
        uploadSessionId = session.sessionUri;
        providerFileId = session.providerFileId;
      }

      const driveUrl = `https://drive.google.com/file/d/${providerFileId}/view`;

      const insertRes = await c.query(
        `INSERT INTO storage_files (
           workspace_id, folder_id, provider_file_id, provider_revision_id,
           drive_url, parent_provider_folder_id, drive_owner_email, drive_created_at,
           name, size_bytes, mime_type, status,
           upload_status, upload_session_id, uploaded_bytes, upload_progress_pct,
           upload_retry_count, assigned_employee_id, review_status
         ) VALUES (
           $1, $2, $3, 'rev_1',
           $4, $5, $6, clock_timestamp(),
           $7, $8, $9, 'active',
           'resumable_session_created', $10, 0, 0,
           0, $11, 'pending_review'
         )
         RETURNING *`,
        [
          auth.workspace.id,
          folderId,
          providerFileId,
          driveUrl,
          providerFolderId,
          driveOwnerEmail,
          name,
          sizeBytes,
          mimeType,
          uploadSessionId,
          assignedEmployeeId,
        ],
      );
      const fileRow = insertRes.rows[0];

      // Record durable operation for video upload
      await c.query(
        `INSERT INTO storage_operations (
           workspace_id, folder_id, operation_type, status,
           requested_by, provider
         ) VALUES ($1, $2, 'upload_video', 'running', $3, 'google_drive')`,
        [auth.workspace.id, folderId, auth.user.id],
      );

      // If assigned_employee_id is provided, grant Google Drive permission on the file
      if (assignedEmployeeId && assignedEmployeeEmail) {
        let drivePermId = `perm_${crypto.randomBytes(6).toString('hex')}`;
        if (this.provider.grantPermission) {
          const permRes = await this.provider.grantPermission(
            {
              providerResourceId: providerFileId,
              emailAddress: assignedEmployeeEmail,
              role: permissionRole,
              type: 'user',
            },
            decryptedRefreshToken,
          );
          drivePermId = permRes.permissionId;
        }
        const accessLevel = permissionRole === 'writer' ? 'write' : 'read';
        await c.query(
          `INSERT INTO resource_access_grants (
             workspace_id, resource_type, resource_id, employee_id,
             access_level, drive_permission_id, drive_role, google_email, granted_by
           ) VALUES ($1, 'storage_file', $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (workspace_id, resource_type, resource_id, employee_id) DO UPDATE SET
             access_level = EXCLUDED.access_level,
             drive_permission_id = EXCLUDED.drive_permission_id,
             drive_role = EXCLUDED.drive_role,
             google_email = EXCLUDED.google_email,
             granted_by = EXCLUDED.granted_by,
             granted_at = clock_timestamp(),
             revoked_at = NULL`,
          [
            auth.workspace.id,
            fileRow.id,
            assignedEmployeeId,
            accessLevel,
            drivePermId,
            permissionRole,
            assignedEmployeeEmail,
            auth.user.id,
          ],
        );
      }

      await recordAuditEvent(c, {
        workspaceId: auth.workspace.id,
        actorUserId: auth.user.id,
        action: 'storage.video_upload_initiated',
        entityType: 'storage_file',
        entityId: fileRow.id,
        requestId,
        metadata: {
          folder_id: folderId,
          provider_file_id: providerFileId,
          upload_session_id: uploadSessionId,
          name,
          size_bytes: sizeBytes,
          assigned_employee_id: assignedEmployeeId,
        },
      });

      const responseData: StorageFileData = {
        id: fileRow.id,
        workspace_id: fileRow.workspace_id,
        folder_id: fileRow.folder_id,
        provider_file_id: fileRow.provider_file_id,
        provider_revision_id: fileRow.provider_revision_id,
        drive_url: fileRow.drive_url,
        parent_provider_folder_id: fileRow.parent_provider_folder_id,
        drive_owner_email: fileRow.drive_owner_email,
        drive_created_at: fileRow.drive_created_at
          ? fileRow.drive_created_at.toISOString()
          : null,
        name: fileRow.name,
        size_bytes: Number(fileRow.size_bytes),
        mime_type: fileRow.mime_type,
        status: fileRow.status,
        upload_status: fileRow.upload_status,
        upload_session_id: fileRow.upload_session_id,
        uploaded_bytes: Number(fileRow.uploaded_bytes ?? 0),
        upload_progress_pct: fileRow.upload_progress_pct ?? 0,
        upload_retry_count: fileRow.upload_retry_count ?? 0,
        upload_error_message: fileRow.upload_error_message ?? null,
        assigned_employee_id: fileRow.assigned_employee_id,
        assigned_employee_name: assignedEmployeeName,
        review_status: fileRow.review_status ?? 'pending_review',
        created_at: fileRow.created_at.toISOString(),
        updated_at: fileRow.updated_at
          ? fileRow.updated_at.toISOString()
          : undefined,
      };

      if (idempotencyKey) {
        await completeIdempotency(c, {
          workspaceId: auth.workspace.id,
          actorUserId: auth.user.id,
          operationKey: idempotencyKey,
          responseCode: 201,
          sanitizedResponse: responseData as unknown as Record<string, unknown>,
        });
      }

      await c.query('COMMIT');
      return responseData;
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  }

  /**
   * 10. POST /api/v1/storage/files/:id/upload-chunk
   * Uploads a resumable chunk to Google Drive, tracks progress, handles interruption & retry.
   */
  async uploadVideoChunk(
    auth: AuthenticatedContext,
    fileIdParam: string,
    body: UploadVideoChunkRequest,
    requestId: string = crypto.randomUUID(),
  ): Promise<StorageFileData> {
    const fileId = assertUuid(fileIdParam, 'file_id');
    const chunkSizeBytes = Number(body.chunk_size_bytes);
    if (!Number.isFinite(chunkSizeBytes) || chunkSizeBytes < 0) {
      fail('VALIDATION_ERROR', 'chunk_size_bytes must be non-negative', 400);
    }

    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');

      const fileRes = await c.query(
        `SELECT f.*, e.full_name AS assigned_employee_name
         FROM storage_files f
         LEFT JOIN employees e ON e.workspace_id = f.workspace_id AND e.id = f.assigned_employee_id
         WHERE f.id = $1 AND f.workspace_id = $2
           AND COALESCE(f.status, 'active') != 'detached'
         FOR UPDATE OF f`,
        [fileId, auth.workspace.id],
      );
      if (fileRes.rows.length === 0) {
        fail('NOT_FOUND', 'File not found', 404);
      }
      const fileRow = fileRes.rows[0];

      if (auth.workspace.role !== 'owner') {
        const staffEmployeeId = await this.getEmployeeId(c, auth);
        await this.assertStaffFolderAccess(
          c,
          fileRow.folder_id,
          auth.workspace.id,
          staffEmployeeId,
        );
      }

      const decryptedRefreshToken =
        await this.getDecryptedWorkspaceRefreshToken(c, auth.workspace.id);

      const totalSize = Number(fileRow.size_bytes ?? chunkSizeBytes);
      const currentUploaded = Number(fileRow.uploaded_bytes ?? 0);
      const offsetBytes =
        body.offset_bytes !== undefined
          ? Number(body.offset_bytes)
          : currentUploaded;
      const isRetry = body.retry === true;
      const simulateInterruption = body.simulate_interruption === true;

      let nextUploaded = Math.min(totalSize, offsetBytes + chunkSizeBytes);
      let progressPct =
        totalSize > 0
          ? Math.min(100, Math.round((nextUploaded / totalSize) * 100))
          : 100;
      let nextStatus: 'uploading' | 'interrupted' | 'completed' | 'failed' =
        body.is_final_chunk || nextUploaded >= totalSize
          ? 'completed'
          : 'uploading';
      let errorMsg: string | null = null;
      let providerFileId: string = fileRow.provider_file_id;
      let driveUrl: string =
        fileRow.drive_url ??
        `https://drive.google.com/file/d/${providerFileId}/view`;

      if (simulateInterruption) {
        nextUploaded = offsetBytes;
        progressPct =
          totalSize > 0
            ? Math.min(99, Math.round((offsetBytes / totalSize) * 100))
            : 0;
        nextStatus = 'interrupted';
        errorMsg =
          'Simulated network interruption during resumable video upload (HTTP 503 Service Unavailable). Client can resume from last committed byte offset.';
      } else if (
        this.provider.uploadResumableChunk &&
        fileRow.upload_session_id
      ) {
        try {
          const chunkRes = await this.provider.uploadResumableChunk(
            {
              sessionUri: fileRow.upload_session_id,
              providerFileId,
              chunkSizeBytes,
              offsetBytes,
              totalBytes: totalSize,
              retry: isRetry,
              ...(body.chunk_base64
                ? { chunkDataBase64: body.chunk_base64 }
                : {}),
            },
            decryptedRefreshToken,
          );
          nextUploaded = chunkRes.uploadedBytes;
          progressPct =
            totalSize > 0
              ? Math.min(100, Math.round((nextUploaded / totalSize) * 100))
              : 100;
          nextStatus =
            body.is_final_chunk || chunkRes.completed
              ? 'completed'
              : 'uploading';
          errorMsg = null;
          if (chunkRes.providerFileId) providerFileId = chunkRes.providerFileId;
          if (chunkRes.webViewLink) driveUrl = chunkRes.webViewLink;
        } catch (chunkErr: unknown) {
          const msg =
            chunkErr instanceof Error
              ? chunkErr.message
              : 'Network interruption during resumable video upload';
          if (msg.includes('RESUMABLE_UPLOAD_INTERRUPTED')) {
            nextUploaded = offsetBytes;
            progressPct =
              totalSize > 0
                ? Math.min(99, Math.round((offsetBytes / totalSize) * 100))
                : 0;
            nextStatus = 'interrupted';
            errorMsg = msg;
          } else {
            throw chunkErr;
          }
        }
      }

      if (nextStatus === 'completed') {
        nextUploaded = totalSize;
        progressPct = 100;
      }

      // If a live pending file ID was finalized into a real Google Drive file ID, sync any file-level permission grant
      if (
        nextStatus === 'completed' &&
        providerFileId !== fileRow.provider_file_id &&
        this.provider.grantPermission
      ) {
        const fileGrantsRes = await c.query(
          `SELECT id, google_email, drive_role
           FROM resource_access_grants
           WHERE workspace_id = $1 AND resource_type = 'storage_file' AND resource_id = $2 AND revoked_at IS NULL`,
          [auth.workspace.id, fileId],
        );
        for (const fg of fileGrantsRes.rows) {
          if (fg.google_email) {
            const permRes = await this.provider.grantPermission(
              {
                providerResourceId: providerFileId,
                emailAddress: fg.google_email,
                role: (fg.drive_role ?? 'reader') as DrivePermissionRole,
                type: 'user',
              },
              decryptedRefreshToken,
            );
            await c.query(
              'UPDATE resource_access_grants SET drive_permission_id = $1 WHERE id = $2',
              [permRes.permissionId, fg.id],
            );
          }
        }
      }

      const nextRetryCount =
        Number(fileRow.upload_retry_count ?? 0) + (isRetry ? 1 : 0);

      const updateRes = await c.query(
        `UPDATE storage_files
         SET provider_file_id = $1,
             drive_url = $2,
             uploaded_bytes = $3,
             upload_progress_pct = $4,
             upload_status = $5,
             upload_retry_count = $6,
             upload_error_message = $7,
             updated_at = clock_timestamp()
         WHERE id = $8
         RETURNING *`,
        [
          providerFileId,
          driveUrl,
          nextUploaded,
          progressPct,
          nextStatus,
          nextRetryCount,
          errorMsg,
          fileId,
        ],
      );
      const updated = updateRes.rows[0];

      if (nextStatus === 'completed') {
        await c.query(
          `UPDATE storage_operations
           SET status = 'completed', completed_at = clock_timestamp()
           WHERE workspace_id = $1 AND folder_id = $2 AND operation_type = 'upload_video' AND status = 'running'`,
          [auth.workspace.id, fileRow.folder_id],
        );
      }

      await recordAuditEvent(c, {
        workspaceId: auth.workspace.id,
        actorUserId: auth.user.id,
        action:
          nextStatus === 'interrupted'
            ? 'storage.video_upload_interrupted'
            : nextStatus === 'completed'
              ? 'storage.video_upload_completed'
              : 'storage.video_upload_chunk',
        entityType: 'storage_file',
        entityId: fileId,
        requestId,
        metadata: {
          folder_id: fileRow.folder_id,
          upload_status: nextStatus,
          uploaded_bytes: nextUploaded,
          upload_progress_pct: progressPct,
          upload_retry_count: nextRetryCount,
          retry: isRetry,
        },
      });

      await c.query('COMMIT');

      return {
        id: updated.id,
        workspace_id: updated.workspace_id,
        folder_id: updated.folder_id,
        provider_file_id: updated.provider_file_id,
        provider_revision_id: updated.provider_revision_id,
        drive_url: updated.drive_url,
        parent_provider_folder_id: updated.parent_provider_folder_id,
        drive_owner_email: updated.drive_owner_email,
        drive_created_at: updated.drive_created_at
          ? updated.drive_created_at.toISOString()
          : null,
        name: updated.name,
        size_bytes: Number(updated.size_bytes),
        mime_type: updated.mime_type,
        status: updated.status,
        upload_status: updated.upload_status,
        upload_session_id: updated.upload_session_id,
        uploaded_bytes: Number(updated.uploaded_bytes),
        upload_progress_pct: updated.upload_progress_pct,
        upload_retry_count: updated.upload_retry_count,
        upload_error_message: updated.upload_error_message ?? null,
        assigned_employee_id: updated.assigned_employee_id,
        assigned_employee_name: fileRow.assigned_employee_name ?? undefined,
        review_status: updated.review_status ?? 'pending_review',
        reviewed_by: updated.reviewed_by ?? null,
        reviewed_at: updated.reviewed_at
          ? updated.reviewed_at.toISOString()
          : null,
        review_notes: updated.review_notes ?? null,
        created_at: updated.created_at.toISOString(),
        updated_at: updated.updated_at
          ? updated.updated_at.toISOString()
          : undefined,
      };
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  }

  /**
   * 11. POST /api/v1/storage/files/:id/review
   * Updates review status (pending_review / approved / rejected) and optional staff assignment on a file (Owner only).
   */
  async reviewStorageFile(
    auth: AuthenticatedContext,
    fileIdParam: string,
    body: ReviewStorageFileRequest,
    requestId: string = crypto.randomUUID(),
  ): Promise<StorageFileData> {
    requireRole(['owner'], auth);
    const fileId = assertUuid(fileIdParam, 'file_id');
    const reviewStatus = assertText(
      body.review_status,
      50,
      true,
      'review_status',
    );
    if (
      reviewStatus !== 'pending_review' &&
      reviewStatus !== 'approved' &&
      reviewStatus !== 'rejected'
    ) {
      fail(
        'VALIDATION_ERROR',
        "review_status must be 'pending_review', 'approved', or 'rejected'",
        400,
      );
    }

    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');

      const fileRes = await c.query(
        "SELECT * FROM storage_files WHERE id=$1 AND workspace_id=$2 AND COALESCE(status, 'active') != 'detached' FOR UPDATE",
        [fileId, auth.workspace.id],
      );
      if (fileRes.rows.length === 0) {
        fail('NOT_FOUND', 'File not found', 404);
      }
      const fileRow = fileRes.rows[0];

      let assignedEmployeeId: string | null = fileRow.assigned_employee_id;
      if (body.assigned_employee_id !== undefined) {
        assignedEmployeeId = body.assigned_employee_id
          ? assertUuid(body.assigned_employee_id, 'assigned_employee_id')
          : null;
      }

      const notes = body.notes
        ? assertText(body.notes, 2000, false, 'notes')
        : null;

      const updateRes = await c.query(
        `UPDATE storage_files
         SET review_status = $1,
             reviewed_by = $2,
             reviewed_at = clock_timestamp(),
             review_notes = COALESCE($3, review_notes),
             assigned_employee_id = $4,
             updated_at = clock_timestamp()
         WHERE id = $5
         RETURNING *`,
        [reviewStatus, auth.user.id, notes, assignedEmployeeId, fileId],
      );
      const updated = updateRes.rows[0];

      let assignedEmployeeName: string | undefined;
      if (updated.assigned_employee_id) {
        const empRes = await c.query(
          'SELECT full_name FROM employees WHERE workspace_id=$1 AND id=$2',
          [auth.workspace.id, updated.assigned_employee_id],
        );
        assignedEmployeeName = empRes.rows[0]?.full_name;
      }

      await recordAuditEvent(c, {
        workspaceId: auth.workspace.id,
        actorUserId: auth.user.id,
        action: 'storage.file_review',
        entityType: 'storage_file',
        entityId: fileId,
        requestId,
        metadata: {
          folder_id: updated.folder_id,
          review_status: reviewStatus,
          assigned_employee_id: updated.assigned_employee_id,
          notes,
        },
      });

      await c.query('COMMIT');

      return {
        id: updated.id,
        workspace_id: updated.workspace_id,
        folder_id: updated.folder_id,
        provider_file_id: updated.provider_file_id,
        provider_revision_id: updated.provider_revision_id,
        drive_url: updated.drive_url,
        parent_provider_folder_id: updated.parent_provider_folder_id,
        drive_owner_email: updated.drive_owner_email,
        drive_created_at: updated.drive_created_at
          ? updated.drive_created_at.toISOString()
          : null,
        name: updated.name,
        size_bytes: updated.size_bytes ? Number(updated.size_bytes) : undefined,
        mime_type: updated.mime_type,
        status: updated.status,
        upload_status: updated.upload_status,
        upload_session_id: updated.upload_session_id,
        uploaded_bytes: Number(updated.uploaded_bytes ?? 0),
        upload_progress_pct: updated.upload_progress_pct ?? 100,
        upload_retry_count: updated.upload_retry_count ?? 0,
        upload_error_message: updated.upload_error_message ?? null,
        assigned_employee_id: updated.assigned_employee_id,
        assigned_employee_name: assignedEmployeeName,
        review_status: updated.review_status,
        reviewed_by: updated.reviewed_by,
        reviewed_at: updated.reviewed_at
          ? updated.reviewed_at.toISOString()
          : null,
        review_notes: updated.review_notes,
        created_at: updated.created_at.toISOString(),
        updated_at: updated.updated_at
          ? updated.updated_at.toISOString()
          : undefined,
      };
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  }

  /**
   * 12. GET /api/v1/storage/folders/:id/permissions (or /files/:id/permissions)
   * Lists Google Drive permission grants for a folder or file.
   */
  async listPermissions(
    auth: AuthenticatedContext,
    resourceType: 'storage_folder' | 'storage_file',
    resourceIdParam: string,
  ): Promise<StoragePermissionGrantData[]> {
    const resourceId = assertUuid(resourceIdParam, 'id');
    const c = await this.pool.connect();
    try {
      if (auth.workspace.role !== 'owner') {
        const staffEmployeeId = await this.getEmployeeId(c, auth);
        if (resourceType === 'storage_folder') {
          await this.assertStaffFolderAccess(
            c,
            resourceId,
            auth.workspace.id,
            staffEmployeeId,
          );
        }
      }
      return await this.getResourcePermissionsInternal(
        c,
        auth.workspace.id,
        resourceType,
        resourceId,
      );
    } finally {
      c.release();
    }
  }

  /**
   * 13. POST /api/v1/storage/folders/:id/permissions (or /files/:id/permissions)
   * Grants reader/writer Google Drive permission by employee's Google email (Owner only).
   * Strictly forbids anyone-with-link (Requirement 6).
   * Validates employee email, checks inherited permissions, and records audit log (Requirement 7).
   */
  async grantDrivePermission(
    auth: AuthenticatedContext,
    resourceType: 'storage_folder' | 'storage_file',
    resourceIdParam: string,
    body: GrantDrivePermissionRequest,
    requestId: string = crypto.randomUUID(),
  ): Promise<StoragePermissionGrantData> {
    requireRole(['owner'], auth);
    const resourceId = assertUuid(resourceIdParam, 'id');

    // Security Guardrail (Requirement 6): Strictly forbid anyone-with-link!
    const rawType = (body as unknown as Record<string, unknown>)['type'];
    if (
      rawType === 'anyone' ||
      rawType === 'anyoneWithLink' ||
      (body as unknown as Record<string, unknown>)['role'] === 'anyone'
    ) {
      fail(
        'ANYONE_PERMISSION_FORBIDDEN',
        'Không được phép bật quyền chia sẻ công khai (anyone-with-link). Quyền Google Drive bắt buộc cấp theo email Google của nhân viên.',
        400,
      );
    }

    const employeeId = assertUuid(body.employee_id, 'employee_id');
    const role = assertText(body.role, 20, true, 'role');
    if (role !== 'reader' && role !== 'writer') {
      fail('VALIDATION_ERROR', "role must be 'reader' or 'writer'", 400);
    }

    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');

      // Validate employee exists, is active in workspace, and has valid Google email
      const empRes = await c.query(
        "SELECT id, employee_code, full_name, google_email, user_id FROM employees WHERE workspace_id=$1 AND id=$2 AND employment_status='active'",
        [auth.workspace.id, employeeId],
      );
      if (empRes.rows.length === 0) {
        fail(
          'VALIDATION_ERROR',
          `Employee ${employeeId} is not active in this workspace`,
          400,
        );
      }
      const empRow = empRes.rows[0];
      const googleEmail = await this.resolveEmployeeGoogleEmail(
        c,
        auth.workspace.id,
        empRow,
      );
      assertEmail(googleEmail, 'employee_google_email');

      let providerResourceId: string;
      let folderIdForOp: string;
      let parentFolderIdForInheritance: string | null = null;

      if (resourceType === 'storage_folder') {
        const folderRes = await c.query(
          "SELECT * FROM storage_folders WHERE id=$1 AND workspace_id=$2 AND COALESCE(record_status, 'active') != 'detached'",
          [resourceId, auth.workspace.id],
        );
        if (folderRes.rows.length === 0) {
          fail('NOT_FOUND', 'Folder not found', 404);
        }
        providerResourceId =
          folderRes.rows[0].provider_folder_id ??
          this.provider.parseFolderId(folderRes.rows[0].drive_url);
        folderIdForOp = resourceId;
        parentFolderIdForInheritance = folderRes.rows[0].parent_folder_id;
      } else {
        const fileRes = await c.query(
          "SELECT * FROM storage_files WHERE id=$1 AND workspace_id=$2 AND COALESCE(status, 'active') != 'detached'",
          [resourceId, auth.workspace.id],
        );
        if (fileRes.rows.length === 0) {
          fail('NOT_FOUND', 'File not found', 404);
        }
        providerResourceId = fileRes.rows[0].provider_file_id;
        folderIdForOp = fileRes.rows[0].folder_id;
        parentFolderIdForInheritance = fileRes.rows[0].folder_id;
      }

      // Check inherited permission from parent folder (Requirement 7)
      let inheritedFromResourceId: string | null = null;
      if (parentFolderIdForInheritance) {
        const parentGrantRes = await c.query(
          `SELECT resource_id FROM resource_access_grants
           WHERE workspace_id = $1 AND resource_type = 'storage_folder'
             AND resource_id = $2 AND employee_id = $3 AND revoked_at IS NULL`,
          [auth.workspace.id, parentFolderIdForInheritance, employeeId],
        );
        if (parentGrantRes.rows.length > 0) {
          inheritedFromResourceId = parentFolderIdForInheritance;
        }
      }

      // Call Google Drive provider to grant permission by email
      const decryptedRefreshToken =
        await this.getDecryptedWorkspaceRefreshToken(c, auth.workspace.id);
      let drivePermId = `perm_${crypto.randomBytes(6).toString('hex')}`;
      if (this.provider.grantPermission) {
        const permRes = await this.provider.grantPermission(
          {
            providerResourceId,
            emailAddress: googleEmail,
            role,
            type: 'user',
          },
          decryptedRefreshToken,
        );
        drivePermId = permRes.permissionId;
      }

      const accessLevel = role === 'writer' ? 'write' : 'read';

      const grantRes = await c.query(
        `INSERT INTO resource_access_grants (
           workspace_id, resource_type, resource_id, employee_id,
           access_level, drive_permission_id, drive_role, google_email,
           inherited_from_resource_id, granted_by, granted_at, revoked_at, revoked_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, clock_timestamp(), NULL, NULL)
         ON CONFLICT (workspace_id, resource_type, resource_id, employee_id) DO UPDATE SET
           access_level = EXCLUDED.access_level,
           drive_permission_id = EXCLUDED.drive_permission_id,
           drive_role = EXCLUDED.drive_role,
           google_email = EXCLUDED.google_email,
           inherited_from_resource_id = EXCLUDED.inherited_from_resource_id,
           granted_by = EXCLUDED.granted_by,
           granted_at = clock_timestamp(),
           revoked_at = NULL,
           revoked_by = NULL
         RETURNING *`,
        [
          auth.workspace.id,
          resourceType,
          resourceId,
          employeeId,
          accessLevel,
          drivePermId,
          role,
          googleEmail,
          inheritedFromResourceId,
          auth.user.id,
        ],
      );
      const gRow = grantRes.rows[0];

      // If granting access to a source folder, also ensure folder_assignments is populated
      if (resourceType === 'storage_folder') {
        await c.query(
          `INSERT INTO folder_assignments (workspace_id, folder_id, employee_id, status)
           VALUES ($1, $2, $3, 'assigned')
           ON CONFLICT (workspace_id, folder_id, employee_id) DO NOTHING`,
          [auth.workspace.id, resourceId, employeeId],
        );
      } else {
        await c.query(
          'UPDATE storage_files SET assigned_employee_id = COALESCE(assigned_employee_id, $1), updated_at = clock_timestamp() WHERE id = $2',
          [employeeId, resourceId],
        );
      }

      await c.query(
        `INSERT INTO storage_operations (
           workspace_id, folder_id, operation_type, status,
           requested_by, provider, completed_at
         ) VALUES ($1, $2, 'grant_permission', 'completed', $3, 'google_drive', clock_timestamp())`,
        [auth.workspace.id, folderIdForOp, auth.user.id],
      );

      await recordAuditEvent(c, {
        workspaceId: auth.workspace.id,
        actorUserId: auth.user.id,
        action: 'storage.permission_grant',
        entityType: 'resource_access_grant',
        entityId: gRow.id,
        requestId,
        metadata: {
          resource_type: resourceType,
          resource_id: resourceId,
          employee_id: employeeId,
          google_email: googleEmail,
          drive_role: role,
          drive_permission_id: drivePermId,
          inherited_from_resource_id: inheritedFromResourceId,
        },
      });

      await c.query('COMMIT');

      return {
        id: gRow.id,
        workspace_id: gRow.workspace_id,
        resource_type: gRow.resource_type,
        resource_id: gRow.resource_id,
        employee_id: gRow.employee_id,
        employee_name: empRow.full_name,
        google_email: googleEmail,
        drive_role: role,
        access_level: accessLevel,
        drive_permission_id: drivePermId,
        inherited_from_resource_id: inheritedFromResourceId,
        granted_by: auth.user.id,
        granted_at: gRow.granted_at.toISOString(),
        revoked_at: null,
      };
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  }

  /**
   * 14. POST /api/v1/storage/folders/:id/permissions/revoke (or /files/:id/permissions/revoke)
   * Revokes Google Drive permission for an employee and logs audit event (Owner only).
   */
  async revokeDrivePermission(
    auth: AuthenticatedContext,
    resourceType: 'storage_folder' | 'storage_file',
    resourceIdParam: string,
    body: RevokeDrivePermissionRequest,
    requestId: string = crypto.randomUUID(),
  ): Promise<StoragePermissionGrantData> {
    requireRole(['owner'], auth);
    const resourceId = assertUuid(resourceIdParam, 'id');

    if (!body.employee_id && !body.grant_id) {
      fail(
        'VALIDATION_ERROR',
        'Either employee_id or grant_id is required to revoke permission',
        400,
      );
    }

    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');

      let grantQuery = `
        SELECT g.*, e.full_name AS employee_name
        FROM resource_access_grants g
        JOIN employees e ON e.workspace_id = g.workspace_id AND e.id = g.employee_id
        WHERE g.workspace_id = $1 AND g.resource_type = $2 AND g.resource_id = $3
      `;
      const grantParams: unknown[] = [
        auth.workspace.id,
        resourceType,
        resourceId,
      ];

      if (body.grant_id) {
        grantParams.push(assertUuid(body.grant_id, 'grant_id'));
        grantQuery += ` AND g.id = $${grantParams.length}`;
      } else if (body.employee_id) {
        grantParams.push(assertUuid(body.employee_id, 'employee_id'));
        grantQuery += ` AND g.employee_id = $${grantParams.length}`;
      }

      const grantRes = await c.query(grantQuery, grantParams);
      if (grantRes.rows.length === 0) {
        fail('NOT_FOUND', 'Permission grant not found', 404);
      }
      const gRow = grantRes.rows[0];

      // Fail closed if attempting to directly revoke an inherited file permission while parent folder grant is still active
      if (resourceType === 'storage_file' && gRow.inherited_from_resource_id) {
        const parentActiveRes = await c.query(
          `SELECT id FROM resource_access_grants
           WHERE workspace_id = $1
             AND resource_type = 'storage_folder'
             AND resource_id = $2
             AND employee_id = $3
             AND revoked_at IS NULL`,
          [
            auth.workspace.id,
            gRow.inherited_from_resource_id,
            gRow.employee_id,
          ],
        );
        if (parentActiveRes.rows.length > 0) {
          fail(
            'INHERITED_PERMISSION_ACTIVE_ON_PARENT',
            'Cannot revoke inherited file permission while parent folder permission is still active; revoke access on the parent folder instead',
            409,
          );
        }
      }

      let providerResourceId = resourceId;
      let folderIdForOp = resourceId;
      if (resourceType === 'storage_folder') {
        const fRes = await c.query(
          'SELECT provider_folder_id, drive_url FROM storage_folders WHERE id=$1 AND workspace_id=$2',
          [resourceId, auth.workspace.id],
        );
        if (fRes.rows.length > 0) {
          providerResourceId =
            fRes.rows[0].provider_folder_id ??
            this.provider.parseFolderId(fRes.rows[0].drive_url);
        }
      } else {
        const fRes = await c.query(
          'SELECT provider_file_id, folder_id FROM storage_files WHERE id=$1 AND workspace_id=$2',
          [resourceId, auth.workspace.id],
        );
        if (fRes.rows.length > 0) {
          providerResourceId = fRes.rows[0].provider_file_id;
          folderIdForOp = fRes.rows[0].folder_id;
        }
      }

      const decryptedRefreshToken =
        await this.getDecryptedWorkspaceRefreshToken(c, auth.workspace.id);
      if (this.provider.revokePermission) {
        try {
          const revokeRes = await this.provider.revokePermission(
            providerResourceId,
            gRow.drive_permission_id ?? '',
            decryptedRefreshToken,
          );
          if (!revokeRes || revokeRes.revoked !== true) {
            fail(
              'GOOGLE_DRIVE_REVOKE_PERMISSION_FAILED',
              'Google Drive provider did not confirm permission revocation',
              502,
            );
          }
        } catch (provErr: unknown) {
          if (provErr instanceof AuthError) {
            throw provErr;
          }
          fail(
            'GOOGLE_DRIVE_REVOKE_PERMISSION_FAILED',
            provErr instanceof Error
              ? provErr.message
              : 'Google Drive permission revocation failed',
            502,
          );
        }
      }

      const updRes = await c.query(
        `UPDATE resource_access_grants
         SET revoked_at = clock_timestamp(),
             revoked_by = $1
         WHERE id = $2
         RETURNING *`,
        [auth.user.id, gRow.id],
      );
      const updated = updRes.rows[0];

      // When revoking permission on a parent folder, cascade revocation to inherited child grants and folder assignments
      if (resourceType === 'storage_folder') {
        await c.query(
          `UPDATE resource_access_grants
           SET revoked_at = clock_timestamp(),
               revoked_by = $1
           WHERE workspace_id = $2
             AND inherited_from_resource_id = $3
             AND employee_id = $4
             AND revoked_at IS NULL`,
          [auth.user.id, auth.workspace.id, resourceId, updated.employee_id],
        );
        await c.query(
          `DELETE FROM folder_assignments
           WHERE workspace_id = $1
             AND folder_id = $2
             AND employee_id = $3
             AND COALESCE(output_delivered, false) = false`,
          [auth.workspace.id, resourceId, updated.employee_id],
        );
        await c.query(
          `UPDATE storage_folders
           SET assigned_employee_id = NULL,
               updated_at = clock_timestamp()
           WHERE workspace_id = $1
             AND id = $2
             AND assigned_employee_id = $3`,
          [auth.workspace.id, resourceId, updated.employee_id],
        );
      }

      await c.query(
        `INSERT INTO storage_operations (
           workspace_id, folder_id, operation_type, status,
           requested_by, provider, completed_at
         ) VALUES ($1, $2, 'revoke_permission', 'completed', $3, 'google_drive', clock_timestamp())`,
        [auth.workspace.id, folderIdForOp, auth.user.id],
      );

      await recordAuditEvent(c, {
        workspaceId: auth.workspace.id,
        actorUserId: auth.user.id,
        action: 'storage.permission_revoke',
        entityType: 'resource_access_grant',
        entityId: updated.id,
        requestId,
        metadata: {
          resource_type: resourceType,
          resource_id: resourceId,
          employee_id: updated.employee_id,
          google_email: updated.google_email,
          drive_permission_id: updated.drive_permission_id,
          reason: body.reason ?? null,
        },
      });

      await c.query('COMMIT');

      return {
        id: updated.id,
        workspace_id: updated.workspace_id,
        resource_type: updated.resource_type,
        resource_id: updated.resource_id,
        employee_id: updated.employee_id,
        employee_name: gRow.employee_name,
        google_email: updated.google_email ?? '',
        drive_role: (updated.drive_role ?? 'reader') as DrivePermissionRole,
        access_level: updated.access_level,
        drive_permission_id: updated.drive_permission_id,
        inherited_from_resource_id: updated.inherited_from_resource_id,
        granted_by: updated.granted_by,
        granted_at: updated.granted_at.toISOString(),
        revoked_at: updated.revoked_at
          ? updated.revoked_at.toISOString()
          : null,
      };
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  }

  /**
   * 15. POST /api/v1/storage/folders/:id/sync
   * Synchronizes file list, upload statuses, and Drive links for a folder (Requirement 8).
   */
  async syncFolderFiles(
    auth: AuthenticatedContext,
    folderIdParam: string,
    requestId: string = crypto.randomUUID(),
  ): Promise<{
    synced_count: number;
    files: StorageFileData[];
    provider_folder_id?: string | null;
    drive_url?: string;
  }> {
    const folderId = assertUuid(folderIdParam, 'id');
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');

      const folderRes = await c.query(
        "SELECT * FROM storage_folders WHERE id=$1 AND workspace_id=$2 AND COALESCE(record_status, 'active') != 'detached'",
        [folderId, auth.workspace.id],
      );
      if (folderRes.rows.length === 0) {
        fail('NOT_FOUND', 'Folder not found', 404);
      }
      const folderRow = folderRes.rows[0];

      if (auth.workspace.role !== 'owner') {
        const staffEmployeeId = await this.getEmployeeId(c, auth);
        await this.assertStaffFolderAccess(
          c,
          folderId,
          auth.workspace.id,
          staffEmployeeId,
        );
      }

      let providerFolderId: string =
        folderRow.provider_folder_id ??
        this.provider.parseFolderId(folderRow.drive_url) ??
        '';
      let folderDriveUrl: string = folderRow.drive_url;
      const decryptedRefreshToken =
        await this.getDecryptedWorkspaceRefreshToken(c, auth.workspace.id);

      // If this folder still has a simulated ID (gdrive_fld_*) and live Google Drive OAuth is active,
      // automatically provision the real folder on Google Drive and update its drive_url.
      if (
        (providerFolderId.startsWith('gdrive_fld_') ||
          providerFolderId.startsWith('gdrive_root_') ||
          String(folderDriveUrl || '').includes('gdrive_fld_')) &&
        isLiveGoogleDriveEnabled() &&
        decryptedRefreshToken &&
        !decryptedRefreshToken.startsWith('1//mock-') &&
        !decryptedRefreshToken.startsWith('1//0g-') &&
        this.provider.createDriveFolder
      ) {
        const connRes = await c.query(
          'SELECT google_email, root_folder_id FROM storage_drive_connections WHERE workspace_id = $1 AND status = $2',
          [auth.workspace.id, 'active'],
        );
        const driveOwnerEmail =
          connRes.rows[0]?.google_email ??
          folderRow.drive_owner_email ??
          'drive-admin@hoaiphuong.click';
        const rootDriveFolderId = connRes.rows[0]?.root_folder_id ?? null;
        const createdDrive = await this.provider.createDriveFolder(
          {
            name: folderRow.name,
            parentFolderId:
              folderRow.provider_parent_id &&
              !String(folderRow.provider_parent_id).startsWith('gdrive_')
                ? folderRow.provider_parent_id
                : rootDriveFolderId &&
                    !String(rootDriveFolderId).startsWith('gdrive_')
                  ? rootDriveFolderId
                  : null,
            ownerEmail: driveOwnerEmail,
          },
          decryptedRefreshToken,
        );
        providerFolderId = createdDrive.folderId;
        folderDriveUrl = createdDrive.webViewLink;
        await c.query(
          `UPDATE storage_folders
           SET provider_folder_id = $1,
               provider_parent_id = $2,
               drive_url = $3,
               drive_owner_email = $4,
               updated_at = clock_timestamp()
           WHERE id = $5`,
          [
            providerFolderId,
            createdDrive.parentId,
            folderDriveUrl,
            driveOwnerEmail,
            folderId,
          ],
        );
      }

      const remoteFiles = this.provider.listRemoteFiles
        ? await this.provider.listRemoteFiles(
            providerFolderId,
            decryptedRefreshToken,
          )
        : [];

      for (const rf of remoteFiles) {
        const existingRes = await c.query(
          'SELECT id FROM storage_files WHERE workspace_id=$1 AND folder_id=$2 AND provider_file_id=$3',
          [auth.workspace.id, folderId, rf.providerFileId],
        );
        if (existingRes.rows.length === 0) {
          await c.query(
            `INSERT INTO storage_files (
               workspace_id, folder_id, provider_file_id, provider_revision_id,
               drive_url, parent_provider_folder_id, drive_owner_email, drive_created_at,
               name, size_bytes, mime_type, status,
               upload_status, uploaded_bytes, upload_progress_pct, review_status
             ) VALUES (
               $1, $2, $3, $11,
               $4, $5, $6, $7,
               $8, $9, $10, 'active',
               'completed', $9, 100, 'pending_review'
             )`,
            [
              auth.workspace.id,
              folderId,
              rf.providerFileId,
              rf.webViewLink,
              providerFolderId,
              folderRow.drive_owner_email ?? 'drive-admin@hoaiphuong.click',
              new Date(rf.createdTime),
              rf.name,
              rf.sizeBytes,
              rf.mimeType,
              rf.providerRevisionId ?? 'rev_1',
            ],
          );
        } else {
          await c.query(
            `UPDATE storage_files
             SET drive_url = COALESCE(drive_url, $1),
                 updated_at = clock_timestamp()
             WHERE id = $2`,
            [rf.webViewLink, existingRes.rows[0].id],
          );
        }
      }

      await c.query(
        'UPDATE storage_drive_connections SET last_synced_at = clock_timestamp() WHERE workspace_id = $1',
        [auth.workspace.id],
      );

      await c.query(
        `INSERT INTO storage_operations (
           workspace_id, folder_id, operation_type, status,
           requested_by, provider, completed_at
         ) VALUES ($1, $2, 'sync_metadata', 'completed', $3, 'google_drive', clock_timestamp())`,
        [auth.workspace.id, folderId, auth.user.id],
      );

      const files = await this.getFolderFilesInternal(
        c,
        auth.workspace.id,
        folderId,
      );

      await recordAuditEvent(c, {
        workspaceId: auth.workspace.id,
        actorUserId: auth.user.id,
        action: 'storage.folder_sync',
        entityType: 'storage_folder',
        entityId: folderId,
        requestId,
        metadata: {
          provider_folder_id: providerFolderId,
          synced_count: files.length,
        },
      });

      await c.query('COMMIT');
      return {
        synced_count: files.length,
        files,
        provider_folder_id: providerFolderId,
        drive_url: folderDriveUrl,
      };
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  }

  /**
   * 16. DELETE /api/v1/storage/files/:id
   * Detaches a file record in Management Lite WITHOUT deleting the file on Google Drive (Requirement 9).
   */
  async detachFileRecord(
    auth: AuthenticatedContext,
    fileIdParam: string,
    requestId: string = crypto.randomUUID(),
  ): Promise<{
    file_id: string;
    provider_file_id: string;
    record_status: 'detached';
    detached: true;
    drive_data_preserved: true;
  }> {
    requireRole(['owner'], auth);
    const fileId = assertUuid(fileIdParam, 'file_id');
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');

      const res = await c.query(
        "SELECT * FROM storage_files WHERE id=$1 AND workspace_id=$2 AND COALESCE(status, 'active') != 'detached' FOR UPDATE",
        [fileId, auth.workspace.id],
      );
      if (res.rows.length === 0) {
        fail('NOT_FOUND', 'File not found', 404);
      }
      const fileRow = res.rows[0];

      // Mark record as detached locally; NEVER call Google Drive delete/trash!
      await c.query(
        "UPDATE storage_files SET status = 'detached', updated_at = clock_timestamp() WHERE id = $1",
        [fileId],
      );

      await recordAuditEvent(c, {
        workspaceId: auth.workspace.id,
        actorUserId: auth.user.id,
        action: 'storage.file_record_detached',
        entityType: 'storage_file',
        entityId: fileId,
        requestId,
        metadata: {
          folder_id: fileRow.folder_id,
          provider_file_id: fileRow.provider_file_id,
          drive_data_preserved: true,
        },
      });

      await c.query('COMMIT');

      return {
        file_id: fileId,
        provider_file_id: fileRow.provider_file_id,
        record_status: 'detached',
        detached: true,
        drive_data_preserved: true,
      };
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  }

  /**
   * 17. DELETE /api/v1/storage/folders/:id
   * Detaches a folder record in Management Lite WITHOUT deleting the folder on Google Drive (Requirement 9).
   */
  async detachFolderRecord(
    auth: AuthenticatedContext,
    folderIdParam: string,
    requestId: string = crypto.randomUUID(),
  ): Promise<{
    folder_id: string;
    provider_folder_id: string | null;
    record_status: 'detached';
    detached: true;
    drive_data_preserved: true;
  }> {
    requireRole(['owner'], auth);
    const folderId = assertUuid(folderIdParam, 'folder_id');
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');

      const res = await c.query(
        "SELECT * FROM storage_folders WHERE id=$1 AND workspace_id=$2 AND COALESCE(record_status, 'active') != 'detached' FOR UPDATE",
        [folderId, auth.workspace.id],
      );
      if (res.rows.length === 0) {
        fail('NOT_FOUND', 'Folder not found', 404);
      }
      const folderRow = res.rows[0];

      // Mark record_status = 'detached' locally; NEVER call Google Drive delete/trash!
      await c.query(
        "UPDATE storage_folders SET record_status = 'detached', updated_at = clock_timestamp() WHERE id = $1",
        [folderId],
      );

      await recordAuditEvent(c, {
        workspaceId: auth.workspace.id,
        actorUserId: auth.user.id,
        action: 'storage.folder_record_detached',
        entityType: 'storage_folder',
        entityId: folderId,
        requestId,
        metadata: {
          provider_folder_id: folderRow.provider_folder_id,
          drive_data_preserved: true,
        },
      });

      await c.query('COMMIT');

      return {
        folder_id: folderId,
        provider_folder_id: folderRow.provider_folder_id ?? null,
        record_status: 'detached',
        detached: true,
        drive_data_preserved: true,
      };
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  }
}
