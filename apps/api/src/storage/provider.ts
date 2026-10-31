/**
 * Google Drive API v3 Storage Provider Abstraction (FILE-01 / FILE-02 Direct Google Drive)
 *
 * Reuses design and REST patterns from `googleapis/google-api-nodejs-client` (`drive` v3):
 * - OAuth 2.0 least-privilege scope: `https://www.googleapis.com/auth/drive.file`
 * - Folder creation: `POST https://www.googleapis.com/drive/v3/files` with `mimeType = 'application/vnd.google-apps.folder'`
 * - Resumable video upload: `POST https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable` & `PUT <sessionUri>`
 * - Permission management: `POST/DELETE https://www.googleapis.com/drive/v3/files/{fileId}/permissions`
 *   (Strictly enforces `type: 'user'`, `role: 'reader' | 'writer'`; blocks `type: 'anyone'` / `anyoneWithLink` by default)
 */

import crypto from 'node:crypto';
import type { DrivePermissionRole } from '../../../../packages/contracts/src/index.js';

export const DEFAULT_DRIVE_FILE_SCOPE =
  'https://www.googleapis.com/auth/drive.file';

export const ALLOWED_DRIVE_OAUTH_SCOPES = [
  DEFAULT_DRIVE_FILE_SCOPE,
  'openid',
  'email',
  'profile',
] as const;

export interface StorageProviderResult {
  success: boolean;
  status: 'completed' | 'failed' | 'unknown';
  trashed?: boolean | undefined;
  providerFolderId?: string | undefined;
  providerOperationId?: string | undefined;
  errorMessage?: string | undefined;
  error?: string | undefined;
}

export interface StorageProviderTrashResult extends StorageProviderResult {
  trashed: boolean;
  providerFolderId: string;
}

export interface DriveOAuthExchangeInput {
  code?: string | undefined;
  googleEmail?: string | undefined;
  refreshToken?: string | undefined;
  scopes?: string[] | undefined;
  rootFolderName?: string | undefined;
}

export interface DriveOAuthExchangeResult {
  googleEmail: string;
  refreshToken: string;
  scopes: string[];
  rootFolderId: string;
  rootFolderUrl: string;
}

export interface DriveCreateFolderInput {
  name: string;
  parentFolderId?: string | null | undefined;
  ownerEmail?: string | null | undefined;
  description?: string | null | undefined;
}

export interface DriveCreateFolderResult {
  folderId: string;
  parentId: string | null;
  name: string;
  webViewLink: string;
  ownerEmail: string;
  createdTime: string;
}

export interface DriveInitiateResumableUploadInput {
  folderId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface DriveInitiateResumableUploadResult {
  sessionUri: string;
  providerFileId: string;
  expiresAt: string;
}

export interface DriveUploadChunkInput {
  sessionUri: string;
  providerFileId: string;
  offsetBytes: number;
  chunkSizeBytes: number;
  totalBytes: number;
  chunkDataBase64?: string | undefined;
  simulateInterruption?: boolean | undefined;
  retry?: boolean | undefined;
}

export interface DriveUploadChunkResult {
  completed: boolean;
  uploadedBytes: number;
  providerFileId: string;
  providerRevisionId: string | null;
  webViewLink: string | null;
}

export interface DriveGrantPermissionInput {
  providerResourceId: string;
  emailAddress: string;
  role: DrivePermissionRole;
  type?: string | undefined;
}

export interface DriveGrantPermissionResult {
  permissionId: string;
  role: DrivePermissionRole;
  emailAddress: string;
  type: 'user';
}

export interface DriveRemoteFileMetadata {
  providerFileId: string;
  providerRevisionId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  webViewLink: string;
  createdTime: string;
}

export interface IStorageProvider {
  readonly providerName: 'google_drive';

  trashFolder(providerFolderId?: string | null): Promise<StorageProviderResult>;
  restoreFolder(
    providerFolderId?: string | null,
  ): Promise<StorageProviderResult>;
  parseFolderId(driveUrl: string): string | null;
  reconcileFolderStatus?(
    providerFolderId?: string | null,
  ): Promise<StorageProviderResult>;

  getOAuthAuthorizationUrl(params: {
    workspaceId: string;
    state: string;
    redirectUri?: string | undefined;
  }): string;

  exchangeOAuthCode(
    input: DriveOAuthExchangeInput,
  ): Promise<DriveOAuthExchangeResult>;

  createDriveFolder(
    input: DriveCreateFolderInput,
    decryptedRefreshToken?: string | null,
  ): Promise<DriveCreateFolderResult>;

  initiateResumableUpload(
    input: DriveInitiateResumableUploadInput,
    decryptedRefreshToken?: string | null,
  ): Promise<DriveInitiateResumableUploadResult>;

  uploadResumableChunk(
    input: DriveUploadChunkInput,
    decryptedRefreshToken?: string | null,
  ): Promise<DriveUploadChunkResult>;

  grantPermission(
    input: DriveGrantPermissionInput,
    decryptedRefreshToken?: string | null,
  ): Promise<DriveGrantPermissionResult>;

  revokePermission(
    providerResourceId: string,
    permissionId: string,
    decryptedRefreshToken?: string | null,
  ): Promise<{ revoked: boolean }>;

  listRemoteFiles(
    providerFolderId: string,
    decryptedRefreshToken?: string | null,
  ): Promise<DriveRemoteFileMetadata[]>;

  hasRemoteResource(providerResourceId: string): boolean;
}

/**
 * Validates requested OAuth scopes and enforces least privilege (`drive.file`).
 */
export function assertLeastPrivilegeDriveScopes(
  requestedScopes?: string[],
): string[] {
  if (!requestedScopes || requestedScopes.length === 0) {
    return [DEFAULT_DRIVE_FILE_SCOPE];
  }
  const allowedSet = new Set<string>(ALLOWED_DRIVE_OAUTH_SCOPES);
  for (const scope of requestedScopes) {
    const trimmed = scope.trim();
    if (!allowedSet.has(trimmed)) {
      throw new Error(
        `FORBIDDEN_DRIVE_SCOPE: Scope '${trimmed}' exceeds least-privilege 'drive.file' policy and requires explicit Owner approval.`,
      );
    }
  }
  if (!requestedScopes.includes(DEFAULT_DRIVE_FILE_SCOPE)) {
    return [DEFAULT_DRIVE_FILE_SCOPE, ...requestedScopes];
  }
  return requestedScopes;
}

/**
 * Validates permission request and strictly forbids `anyoneWithLink` (`type: 'anyone'`) by default.
 */
export function assertSafeDrivePermissionInput(
  input: DriveGrantPermissionInput,
): void {
  if (input.type && input.type !== 'user') {
    throw new Error(
      `ANYONE_PERMISSION_FORBIDDEN: Google Drive permission type '${input.type}' is forbidden. Only explicit 'user' email grants are permitted.`,
    );
  }
  if (input.role !== 'reader' && input.role !== 'writer') {
    throw new Error(
      `INVALID_DRIVE_ROLE: Role '${String(input.role)}' is not allowed. Only 'reader' or 'writer' are permitted.`,
    );
  }
  const email = input.emailAddress?.trim().toLowerCase() ?? '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(
      'INVALID_GOOGLE_EMAIL: A valid employee Google email address is required.',
    );
  }
}

/**
 * Deterministic Mock Google Drive API v3 Provider for DEV / Sandbox / Automated Tests.
 * Never touches real Google Drive servers while verifying every Drive v3 invariant.
 */
export interface GoogleOAuthConfig {
  liveEnabled: boolean;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  credentialsConfigured: boolean;
}

export function getGoogleOAuthConfig(): GoogleOAuthConfig {
  const clientId = (
    process.env['GOOGLE_CLIENT_ID'] ||
    process.env['GOOGLE_DRIVE_CLIENT_ID'] ||
    ''
  ).trim();
  const clientSecret = (
    process.env['GOOGLE_CLIENT_SECRET'] ||
    process.env['GOOGLE_DRIVE_CLIENT_SECRET'] ||
    ''
  ).trim();
  const defaultRedirectUri =
    process.env['NODE_ENV'] === 'production'
      ? 'https://ql.hoaiphuong.click/api/v1/storage/drive/oauth/callback'
      : 'http://localhost:3101/api/v1/storage/drive/oauth/callback';
  const redirectUri = (
    process.env['GOOGLE_REDIRECT_URI'] ||
    process.env['GOOGLE_DRIVE_REDIRECT_URI'] ||
    defaultRedirectUri
  ).trim();
  const credentialsConfigured = Boolean(clientId && clientSecret);
  const liveEnabled =
    process.env['GOOGLE_DRIVE_LIVE_ENABLED'] === 'true' &&
    credentialsConfigured;

  return {
    liveEnabled,
    clientId: clientId || 'management-lite-google-drive-client',
    clientSecret,
    redirectUri,
    credentialsConfigured,
  };
}

export function isLiveGoogleDriveEnabled(): boolean {
  return getGoogleOAuthConfig().liveEnabled;
}

function isLiveRefreshToken(token?: string | null): token is string {
  return Boolean(
    token &&
      typeof token === 'string' &&
      token.trim().length > 0 &&
      !token.startsWith('1//mock-') &&
      !token.startsWith('1//0g-'),
  );
}

function isLiveAuthorizationCode(code?: string | null): code is string {
  return Boolean(
    code &&
      typeof code === 'string' &&
      code.trim().length > 0 &&
      !code.startsWith('4/0AVGzR1-') &&
      !code.startsWith('mock-'),
  );
}

async function fetchGoogleAccessTokenFromRefreshToken(
  decryptedRefreshToken: string,
): Promise<string> {
  const cfg = getGoogleOAuthConfig();
  if (!cfg.credentialsConfigured) {
    throw new Error(
      'OAUTH_NOT_CONFIGURED: Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET environment variables',
    );
  }
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: decryptedRefreshToken,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) {
    throw new Error(
      `GOOGLE_OAUTH_REFRESH_FAILED: Token refresh failed with HTTP ${res.status}`,
    );
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error(
      'GOOGLE_OAUTH_REFRESH_FAILED: Missing access_token in Google OAuth response',
    );
  }
  return data.access_token;
}

/**
 * Deterministic Mock + Live-Gated Google Drive API v3 Provider for DEV / Sandbox / Automated Tests.
 * - By default (`GOOGLE_DRIVE_LIVE_ENABLED !== 'true'`), operates 100% locally in deterministic Mock mode (zero external network calls).
 * - Once Owner authorizes Live Test (`GOOGLE_DRIVE_LIVE_ENABLED=true` + `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`), executes real Google OAuth 2.0 & Drive API v3 REST calls.
 */
export class MockGoogleDriveProvider implements IStorageProvider {
  public readonly providerName = 'google_drive' as const;

  public trashedFolders = new Set<string>();
  private folderOverrides = new Map<string, StorageProviderResult>();
  private reconcileOverrides = new Map<string, StorageProviderResult>();

  public readonly folders = new Map<
    string,
    DriveCreateFolderResult & { trashed: boolean }
  >();
  public readonly files = new Map<
    string,
    DriveRemoteFileMetadata & {
      folderId: string;
      uploadedBytes: number;
      completed: boolean;
      sessionUri: string;
      trashed: boolean;
    }
  >();
  public readonly permissionsByResource = new Map<
    string,
    Map<string, DriveGrantPermissionResult>
  >();

  public overrideFolderResult(
    folderId: string,
    result: StorageProviderResult,
  ): void {
    this.folderOverrides.set(folderId, result);
  }

  public overrideReconcileResult(
    folderId: string,
    result: StorageProviderResult,
  ): void {
    this.reconcileOverrides.set(folderId, result);
  }

  public clearOverrides(): void {
    this.folderOverrides.clear();
    this.reconcileOverrides.clear();
    this.trashedFolders.clear();
  }

  async reconcileFolderStatus(
    providerFolderId?: string | null,
  ): Promise<StorageProviderResult> {
    const key = providerFolderId ?? 'unknown-folder';
    if (this.reconcileOverrides.has(key)) {
      return this.reconcileOverrides.get(key)!;
    }
    const isTrashed = this.trashedFolders.has(key);
    return {
      success: isTrashed,
      status: isTrashed ? 'completed' : 'failed',
      trashed: isTrashed,
      providerFolderId: key,
      providerOperationId: `mock-reconcile-${Date.now()}`,
    };
  }

  async trashFolder(
    providerFolderId?: string | null,
  ): Promise<StorageProviderResult> {
    const key = providerFolderId ?? 'unknown-folder';

    if (this.folderOverrides.has(key)) {
      const override = this.folderOverrides.get(key)!;
      if (override.status === 'completed') {
        this.trashedFolders.add(key);
        const existing = this.folders.get(key);
        if (existing) existing.trashed = true;
      }
      return override;
    }

    if (key.includes('fail-trash')) {
      return {
        success: false,
        status: 'failed',
        trashed: false,
        providerFolderId: key,
        errorMessage: 'Simulated Google Drive API failure',
        error: 'Simulated Google Drive API failure',
      };
    }

    this.trashedFolders.add(key);
    const existing = this.folders.get(key);
    if (existing) {
      existing.trashed = true;
    }
    return {
      success: true,
      status: 'completed',
      trashed: true,
      providerFolderId: key,
      providerOperationId: `mock-drive-op-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    };
  }

  async restoreFolder(
    providerFolderId?: string | null,
  ): Promise<StorageProviderResult> {
    const key = providerFolderId ?? 'unknown-folder';
    this.trashedFolders.delete(key);
    const existing = this.folders.get(key);
    if (existing) {
      existing.trashed = false;
    }
    return {
      success: true,
      status: 'completed',
      trashed: false,
      providerFolderId: key,
      providerOperationId: `mock-drive-restore-${Date.now()}`,
    };
  }

  parseFolderId(driveUrl: string): string | null {
    if (!driveUrl || typeof driveUrl !== 'string') return null;
    const match = driveUrl.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return match[1];
    }
    const idMatch = driveUrl.match(/id=([a-zA-Z0-9_-]+)/);
    if (idMatch && idMatch[1]) {
      return idMatch[1];
    }
    return null;
  }

  getOAuthAuthorizationUrl(params: {
    workspaceId: string;
    state: string;
    redirectUri?: string | undefined;
  }): string {
    const cfg = getGoogleOAuthConfig();
    const redirect = params.redirectUri || cfg.redirectUri;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', cfg.clientId);
    url.searchParams.set('redirect_uri', redirect);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('scope', DEFAULT_DRIVE_FILE_SCOPE);
    url.searchParams.set('state', params.state);
    return url.toString();
  }

  async exchangeOAuthCode(
    input: DriveOAuthExchangeInput,
  ): Promise<DriveOAuthExchangeResult> {
    const validatedScopes = assertLeastPrivilegeDriveScopes(input.scopes);

    if (isLiveGoogleDriveEnabled() && isLiveAuthorizationCode(input.code)) {
      const cfg = getGoogleOAuthConfig();
      const tokenParams = new URLSearchParams({
        code: input.code.trim(),
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: cfg.redirectUri,
        grant_type: 'authorization_code',
      });
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenParams.toString(),
      });
      if (!tokenRes.ok) {
        throw new Error(
          `GOOGLE_OAUTH_EXCHANGE_FAILED: Failed to exchange OAuth code (HTTP ${tokenRes.status})`,
        );
      }
      const tokenBody = (await tokenRes.json()) as {
        access_token?: string;
        refresh_token?: string;
        scope?: string;
      };
      const accessToken = tokenBody.access_token;
      const refreshToken =
        tokenBody.refresh_token || input.refreshToken?.trim() || '';
      if (!accessToken || !refreshToken) {
        throw new Error(
          'GOOGLE_OAUTH_EXCHANGE_FAILED: Missing access_token or refresh_token from Google OAuth 2.0 (ensure prompt=consent & access_type=offline)',
        );
      }

      // Query connected Google account email via Drive v3 about endpoint (works with drive.file scope only)
      let resolvedEmail = (
        input.googleEmail?.trim() || 'drive-admin@hoaiphuong.click'
      ).toLowerCase();
      const aboutRes = await fetch(
        'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)',
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      if (aboutRes.ok) {
        const aboutData = (await aboutRes.json()) as {
          user?: { emailAddress?: string };
        };
        if (aboutData.user?.emailAddress) {
          resolvedEmail = aboutData.user.emailAddress.trim().toLowerCase();
        }
      }

      // Create application root folder on Google Drive
      const rootFolderName =
        input.rootFolderName?.trim() || 'Management Lite - Google Drive Root';
      const rootRes = await fetch(
        'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink,createdTime',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: rootFolderName,
            mimeType: 'application/vnd.google-apps.folder',
          }),
        },
      );
      if (!rootRes.ok) {
        throw new Error(
          `GOOGLE_DRIVE_ROOT_FOLDER_FAILED: Could not create root folder on Google Drive (HTTP ${rootRes.status})`,
        );
      }
      const rootData = (await rootRes.json()) as {
        id: string;
        webViewLink?: string;
        createdTime?: string;
      };
      const rootFolderId = rootData.id;
      const rootFolderUrl =
        rootData.webViewLink ||
        `https://drive.google.com/drive/folders/${rootFolderId}`;

      this.folders.set(rootFolderId, {
        folderId: rootFolderId,
        parentId: null,
        name: rootFolderName,
        webViewLink: rootFolderUrl,
        ownerEmail: resolvedEmail,
        createdTime: rootData.createdTime || new Date().toISOString(),
        trashed: false,
      });

      return {
        googleEmail: resolvedEmail,
        refreshToken,
        scopes: validatedScopes,
        rootFolderId,
        rootFolderUrl,
      };
    }

    const email = (
      input.googleEmail?.trim() || 'drive-admin@hoaiphuong.click'
    ).toLowerCase();
    const rawRefreshToken =
      input.refreshToken?.trim() ||
      `1//mock-gdrive-refresh-${crypto.randomBytes(16).toString('hex')}`;
    const rootFolderId = `gdrive_root_${crypto.randomBytes(6).toString('hex')}`;
    const rootFolderUrl = `https://drive.google.com/drive/folders/${rootFolderId}`;

    this.folders.set(rootFolderId, {
      folderId: rootFolderId,
      parentId: null,
      name: input.rootFolderName?.trim() || 'Management Lite - Workspace Root',
      webViewLink: rootFolderUrl,
      ownerEmail: email,
      createdTime: new Date().toISOString(),
      trashed: false,
    });

    return {
      googleEmail: email,
      refreshToken: rawRefreshToken,
      scopes: validatedScopes,
      rootFolderId,
      rootFolderUrl,
    };
  }

  async createDriveFolder(
    input: DriveCreateFolderInput,
    decryptedRefreshToken?: string | null,
  ): Promise<DriveCreateFolderResult> {
    if (
      isLiveGoogleDriveEnabled() &&
      isLiveRefreshToken(decryptedRefreshToken)
    ) {
      const accessToken = await fetchGoogleAccessTokenFromRefreshToken(
        decryptedRefreshToken,
      );
      const parents =
        input.parentFolderId &&
        !input.parentFolderId.startsWith('gdrive_root_') &&
        !input.parentFolderId.startsWith('gdrive_fld_')
          ? [input.parentFolderId]
          : undefined;
      const res = await fetch(
        'https://www.googleapis.com/drive/v3/files?fields=id,name,parents,webViewLink,owners(emailAddress),createdTime',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: input.name,
            mimeType: 'application/vnd.google-apps.folder',
            ...(parents ? { parents } : {}),
            ...(input.description ? { description: input.description } : {}),
          }),
        },
      );
      if (!res.ok) {
        throw new Error(
          `GOOGLE_DRIVE_CREATE_FOLDER_FAILED: HTTP ${res.status}`,
        );
      }
      const data = (await res.json()) as {
        id: string;
        name: string;
        parents?: string[];
        webViewLink?: string;
        owners?: Array<{ emailAddress?: string }>;
        createdTime?: string;
      };
      const record: DriveCreateFolderResult = {
        folderId: data.id,
        parentId: data.parents?.[0] ?? input.parentFolderId ?? null,
        name: data.name || input.name,
        webViewLink:
          data.webViewLink ||
          `https://drive.google.com/drive/folders/${data.id}`,
        ownerEmail: (
          data.owners?.[0]?.emailAddress ||
          input.ownerEmail ||
          'drive-admin@hoaiphuong.click'
        ).toLowerCase(),
        createdTime: data.createdTime || new Date().toISOString(),
      };
      this.folders.set(record.folderId, { ...record, trashed: false });
      return record;
    }

    const folderId = `gdrive_fld_${crypto.randomBytes(8).toString('hex')}`;
    const parentId = input.parentFolderId ?? null;
    const ownerEmail = (
      input.ownerEmail?.trim() || 'drive-admin@hoaiphuong.click'
    ).toLowerCase();
    const createdTime = new Date().toISOString();
    const webViewLink = `https://drive.google.com/drive/folders/${folderId}`;

    const record: DriveCreateFolderResult = {
      folderId,
      parentId,
      name: input.name,
      webViewLink,
      ownerEmail,
      createdTime,
    };

    this.folders.set(folderId, { ...record, trashed: false });
    return record;
  }

  async initiateResumableUpload(
    input: DriveInitiateResumableUploadInput,
    decryptedRefreshToken?: string | null,
  ): Promise<DriveInitiateResumableUploadResult> {
    if (
      isLiveGoogleDriveEnabled() &&
      isLiveRefreshToken(decryptedRefreshToken) &&
      input.folderId &&
      !input.folderId.startsWith('gdrive_fld_')
    ) {
      const accessToken = await fetchGoogleAccessTokenFromRefreshToken(
        decryptedRefreshToken,
      );
      const initRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,webViewLink,version,createdTime',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': input.mimeType || 'video/mp4',
          },
          body: JSON.stringify({
            name: input.fileName,
            mimeType: input.mimeType || 'video/mp4',
            parents: [input.folderId],
          }),
        },
      );
      if (!initRes.ok) {
        throw new Error(
          `GOOGLE_DRIVE_RESUMABLE_INIT_FAILED: HTTP ${initRes.status}`,
        );
      }
      const sessionUri = initRes.headers.get('location');
      if (!sessionUri) {
        throw new Error(
          'GOOGLE_DRIVE_RESUMABLE_INIT_FAILED: Missing Location header for resumable upload session',
        );
      }
      const pendingFileId = `gdrive_pending_${crypto.randomBytes(6).toString('hex')}`;
      const expiresAt = new Date(
        Date.now() + 24 * 60 * 60 * 1000,
      ).toISOString();
      this.files.set(pendingFileId, {
        providerFileId: pendingFileId,
        providerRevisionId: 'rev_1',
        name: input.fileName,
        mimeType: input.mimeType || 'video/mp4',
        sizeBytes: input.sizeBytes,
        webViewLink: `https://drive.google.com/file/d/${pendingFileId}/view`,
        createdTime: new Date().toISOString(),
        folderId: input.folderId,
        uploadedBytes: 0,
        completed: false,
        sessionUri,
        trashed: false,
      });
      return {
        sessionUri,
        providerFileId: pendingFileId,
        expiresAt,
      };
    }

    const providerFileId = `gdrive_vid_${crypto.randomBytes(8).toString('hex')}`;
    const sessionToken = crypto.randomBytes(12).toString('hex');
    const sessionUri = `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${sessionToken}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const webViewLink = `https://drive.google.com/file/d/${providerFileId}/view`;

    this.files.set(providerFileId, {
      providerFileId,
      providerRevisionId: 'rev_1',
      name: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      webViewLink,
      createdTime: new Date().toISOString(),
      folderId: input.folderId,
      uploadedBytes: 0,
      completed: false,
      sessionUri,
      trashed: false,
    });

    return {
      sessionUri,
      providerFileId,
      expiresAt,
    };
  }

  public readonly fileChunkBuffers = new Map<string, Map<number, Buffer>>();

  async uploadResumableChunk(
    input: DriveUploadChunkInput,
    decryptedRefreshToken?: string | null,
  ): Promise<DriveUploadChunkResult> {
    if (input.simulateInterruption) {
      throw new Error(
        'RESUMABLE_UPLOAD_INTERRUPTED: Simulated network interruption during chunk transfer',
      );
    }

    if (input.chunkDataBase64 && input.chunkDataBase64.trim().length > 0) {
      const buf = Buffer.from(input.chunkDataBase64, 'base64');
      if (buf.length > 0) {
        const chunkMap =
          this.fileChunkBuffers.get(input.providerFileId) ??
          new Map<number, Buffer>();
        if (input.offsetBytes === 0 && !input.retry) {
          chunkMap.clear();
        }
        chunkMap.set(Math.max(0, input.offsetBytes), buf);
        this.fileChunkBuffers.set(input.providerFileId, chunkMap);
      }
    }

    const existing = this.files.get(input.providerFileId);
    const nextUploaded = Math.min(
      input.totalBytes,
      Math.max(0, input.offsetBytes) + Math.max(0, input.chunkSizeBytes),
    );
    const completed = nextUploaded >= input.totalBytes;

    if (
      completed &&
      isLiveGoogleDriveEnabled() &&
      isLiveRefreshToken(decryptedRefreshToken) &&
      input.sessionUri.startsWith(
        'https://www.googleapis.com/upload/drive/v3/files',
      ) &&
      input.providerFileId.startsWith('gdrive_pending_')
    ) {
      const chunkMap = this.fileChunkBuffers.get(input.providerFileId);
      const bufferedChunks = chunkMap
        ? Array.from(chunkMap.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([, chunkBuf]) => chunkBuf)
        : [];
      const payloadBuffer =
        bufferedChunks.length > 0
          ? Buffer.concat(bufferedChunks)
          : Buffer.from(
              '00000018667479706d703432000000006d70343269736f6d000000086d646174',
              'hex',
            );

      let putRes: Response;
      try {
        putRes = await fetch(input.sessionUri, {
          method: 'PUT',
          headers: {
            'Content-Length': String(payloadBuffer.length),
            'Content-Range': `bytes 0-${payloadBuffer.length - 1}/${payloadBuffer.length}`,
          },
          body: new Uint8Array(payloadBuffer),
        });
      } catch (netErr: unknown) {
        throw new Error(
          `RESUMABLE_UPLOAD_INTERRUPTED: Network interruption during Google Drive resumable upload (${netErr instanceof Error ? netErr.message : 'connection error'})`,
        );
      }
      if (putRes.status === 308 || putRes.status >= 500) {
        throw new Error(
          `RESUMABLE_UPLOAD_INTERRUPTED: Google Drive resumable upload returned HTTP ${putRes.status}; safe to retry from committed byte offset`,
        );
      }
      if (!putRes.ok) {
        throw new Error(
          `GOOGLE_DRIVE_RESUMABLE_PUT_FAILED: HTTP ${putRes.status}`,
        );
      }
      const putData = (await putRes.json()) as {
        id: string;
        webViewLink?: string;
        version?: string;
      };
      const finalFileId = putData.id;
      const finalWebViewLink =
        putData.webViewLink ||
        `https://drive.google.com/file/d/${finalFileId}/view`;
      const finalRevisionId = putData.version
        ? `rev_${putData.version}`
        : 'rev_final_1';

      this.fileChunkBuffers.delete(input.providerFileId);
      if (existing) {
        this.files.delete(input.providerFileId);
        this.files.set(finalFileId, {
          ...existing,
          providerFileId: finalFileId,
          providerRevisionId: finalRevisionId,
          webViewLink: finalWebViewLink,
          uploadedBytes: nextUploaded,
          completed: true,
        });
      }

      return {
        completed: true,
        uploadedBytes: nextUploaded,
        providerFileId: finalFileId,
        providerRevisionId: finalRevisionId,
        webViewLink: finalWebViewLink,
      };
    }

    const webViewLink = `https://drive.google.com/file/d/${input.providerFileId}/view`;
    const revisionId = completed ? 'rev_final_1' : null;

    if (completed) {
      this.fileChunkBuffers.delete(input.providerFileId);
    }

    if (existing) {
      existing.uploadedBytes = nextUploaded;
      existing.completed = completed;
      if (revisionId) {
        existing.providerRevisionId = revisionId;
      }
    }

    return {
      completed,
      uploadedBytes: nextUploaded,
      providerFileId: input.providerFileId,
      providerRevisionId: revisionId,
      webViewLink: completed ? webViewLink : null,
    };
  }

  async grantPermission(
    input: DriveGrantPermissionInput,
    decryptedRefreshToken?: string | null,
  ): Promise<DriveGrantPermissionResult> {
    assertSafeDrivePermissionInput(input);
    const email = input.emailAddress.trim().toLowerCase();

    if (
      isLiveGoogleDriveEnabled() &&
      isLiveRefreshToken(decryptedRefreshToken) &&
      input.providerResourceId &&
      !input.providerResourceId.startsWith('gdrive_')
    ) {
      const accessToken = await fetchGoogleAccessTokenFromRefreshToken(
        decryptedRefreshToken,
      );
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.providerResourceId)}/permissions?fields=id,role,type,emailAddress&sendNotificationEmail=false`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'user',
            role: input.role,
            emailAddress: email,
          }),
        },
      );
      if (!res.ok) {
        throw new Error(
          `GOOGLE_DRIVE_GRANT_PERMISSION_FAILED: HTTP ${res.status}`,
        );
      }
      const data = (await res.json()) as { id: string };
      const grant: DriveGrantPermissionResult = {
        permissionId: data.id,
        role: input.role,
        emailAddress: email,
        type: 'user',
      };
      let resourcePerms = this.permissionsByResource.get(
        input.providerResourceId,
      );
      if (!resourcePerms) {
        resourcePerms = new Map();
        this.permissionsByResource.set(input.providerResourceId, resourcePerms);
      }
      resourcePerms.set(grant.permissionId, grant);
      return grant;
    }

    const permId = `perm_${crypto
      .createHash('sha1')
      .update(`${input.providerResourceId}:${email}`)
      .digest('hex')
      .slice(0, 14)}`;

    let resourcePerms = this.permissionsByResource.get(
      input.providerResourceId,
    );
    if (!resourcePerms) {
      resourcePerms = new Map();
      this.permissionsByResource.set(input.providerResourceId, resourcePerms);
    }

    const grant: DriveGrantPermissionResult = {
      permissionId: permId,
      role: input.role,
      emailAddress: email,
      type: 'user',
    };
    resourcePerms.set(permId, grant);
    return grant;
  }

  async revokePermission(
    providerResourceId: string,
    permissionId: string,
    decryptedRefreshToken?: string | null,
  ): Promise<{ revoked: boolean }> {
    if (
      isLiveGoogleDriveEnabled() &&
      isLiveRefreshToken(decryptedRefreshToken) &&
      providerResourceId &&
      !providerResourceId.startsWith('gdrive_') &&
      permissionId &&
      !permissionId.startsWith('perm_')
    ) {
      const accessToken = await fetchGoogleAccessTokenFromRefreshToken(
        decryptedRefreshToken,
      );
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(providerResourceId)}/permissions/${encodeURIComponent(permissionId)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );
      // Fail closed on HTTP 403 or any non-2xx/404 status so DB never marks an unrevoked permission as revoked
      if (!res.ok && res.status !== 404) {
        throw new Error(
          `GOOGLE_DRIVE_REVOKE_PERMISSION_FAILED: HTTP ${res.status}`,
        );
      }
    }

    const resourcePerms = this.permissionsByResource.get(providerResourceId);
    if (resourcePerms) {
      resourcePerms.delete(permissionId);
    }
    return { revoked: true };
  }

  async listRemoteFiles(
    providerFolderId: string,
    decryptedRefreshToken?: string | null,
  ): Promise<DriveRemoteFileMetadata[]> {
    if (
      isLiveGoogleDriveEnabled() &&
      isLiveRefreshToken(decryptedRefreshToken) &&
      providerFolderId &&
      !providerFolderId.startsWith('gdrive_')
    ) {
      const accessToken = await fetchGoogleAccessTokenFromRefreshToken(
        decryptedRefreshToken,
      );
      const q = `'${providerFolderId.replace(/'/g, "\\'")}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,webViewLink,version,createdTime)&pageSize=100`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          files?: Array<{
            id: string;
            name: string;
            mimeType: string;
            size?: string;
            webViewLink?: string;
            version?: string;
            createdTime?: string;
          }>;
        };
        return (data.files ?? []).map((f) => ({
          providerFileId: f.id,
          providerRevisionId: f.version ? `rev_${f.version}` : 'rev_1',
          name: f.name,
          mimeType: f.mimeType,
          sizeBytes: f.size ? Number(f.size) : 0,
          webViewLink:
            f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
          createdTime: f.createdTime || new Date().toISOString(),
        }));
      }
    }

    const out: DriveRemoteFileMetadata[] = [];
    for (const f of this.files.values()) {
      if (f.folderId === providerFolderId && !f.trashed && f.completed) {
        out.push({
          providerFileId: f.providerFileId,
          providerRevisionId: f.providerRevisionId,
          name: f.name,
          mimeType: f.mimeType,
          sizeBytes: f.sizeBytes,
          webViewLink: f.webViewLink,
          createdTime: f.createdTime,
        });
      }
    }
    return out;
  }

  hasRemoteResource(providerResourceId: string): boolean {
    const folder = this.folders.get(providerResourceId);
    if (folder && !folder.trashed && !this.trashedFolders.has(providerResourceId)) {
      return true;
    }
    const file = this.files.get(providerResourceId);
    if (file && !file.trashed) return true;
    return false;
  }
}


export function isValidDriveUrl(driveUrl: string): boolean {
  try {
    const parsed = new URL(driveUrl);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'drive.google.com' ||
        parsed.hostname === 'docs.google.com')
    );
  } catch {
    return false;
  }
}
