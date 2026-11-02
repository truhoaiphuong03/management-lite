import {
  createSuccessEnvelope,
  createErrorEnvelope,
  sendJson,
} from '../envelope.js';
import { AuthError } from '../auth/service.js';
import { requireCsrf } from '../auth/guard.js';
import type {
  CreateStorageFolderRequest,
  CreateStorageReceiptRequest,
  CreateTrashRequestRequest,
  ConfirmTrashRequest,
  ConnectDriveOAuthRequest,
  GrantDrivePermissionRequest,
  RevokeDrivePermissionRequest,
  InitiateVideoUploadRequest,
  UploadVideoChunkRequest,
  ReviewStorageFileRequest,
} from '../../../../packages/contracts/src/storage.js';
import type { RouteRequestContext } from './router.js';

const STORAGE_FILE_ROUTE_RE =
  /^\/api\/v1\/storage\/files\/([a-zA-Z0-9_-]+)(?:\/(upload-chunk|review|permissions)(?:\/(revoke))?)?$/;
const STORAGE_FOLDER_ROUTE_RE =
  /^\/api\/v1\/storage(?:\/(folders|trash-requests|operations)(?:\/([a-zA-Z0-9_-]+)(?:\/(files|receipts|trash-requests|confirm|sync|permissions)(?:\/(upload-sessions|revoke))?)?)?)?$/;

export async function handleStorageRoutes(
  ctx: RouteRequestContext,
): Promise<boolean> {
  const {
    req,
    res,
    method,
    pathname,
    requestId,
    isProduction,
    csrfSecret,
    allowedOrigins,
    requireAuth,
    parseJsonBody,
    assertAllowedFields,
    authService,
    storageService,
  } = ctx;

  if (
    pathname !== '/api/v1/storage' &&
    !pathname.startsWith('/api/v1/storage/')
  ) {
    return false;
  }

  if (!authService || !storageService) {
    const body = createErrorEnvelope(
      'SERVICE_UNAVAILABLE',
      'Storage service is unavailable',
      requestId,
    );
    sendJson(res, 503, body);
    return true;
  }

  const sessionContext = await requireAuth(authService, req, isProduction);

  // OAuth 2.0 Google Drive Connection Endpoints
  if (pathname === '/api/v1/storage/drive/oauth/url' && method === 'GET') {
    const result = await storageService.getDriveOAuthUrl(sessionContext);
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  if (pathname === '/api/v1/storage/drive/connection' && method === 'GET') {
    const result = await storageService.getDriveConnection(sessionContext);
    sendJson(res, 200, createSuccessEnvelope(result, requestId), {
      'Cache-Control': 'no-store',
    });
    return true;
  }

  if (pathname === '/api/v1/storage/drive/oauth/callback' && method === 'GET') {
    if (sessionContext.workspace.role !== 'owner') {
      throw new AuthError(
        'FORBIDDEN',
        'Only workspace owner can complete Google Drive OAuth callback',
        403,
      );
    }
    const callbackUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const code = callbackUrl.searchParams.get('code') ?? '';
    const state = callbackUrl.searchParams.get('state') ?? '';
    const scope = callbackUrl.searchParams.get('scope') ?? '';
    const errorParam = callbackUrl.searchParams.get('error') ?? '';
    const acceptHeader = String(req.headers['accept'] ?? '');
    if (acceptHeader.includes('application/json')) {
      sendJson(
        res,
        200,
        createSuccessEnvelope(
          { code, state, scope, error: errorParam || null },
          requestId,
        ),
        { 'Cache-Control': 'no-store' },
      );
      return true;
    }
    const redirectTarget = `/storage?oauth_code=${encodeURIComponent(code)}&oauth_state=${encodeURIComponent(state)}${errorParam ? `&oauth_error=${encodeURIComponent(errorParam)}` : ''}`;
    res.writeHead(302, {
      Location: redirectTarget,
      'Cache-Control': 'no-store',
      'X-Request-Id': requestId,
    });
    res.end();
    return true;
  }

  if (
    (pathname === '/api/v1/storage/drive/connect' ||
      pathname === '/api/v1/storage/drive/oauth/callback') &&
    method === 'POST'
  ) {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    assertAllowedFields(body, [
      'code',
      'state',
      'redirect_uri',
      'google_email',
      'display_name',
      'refresh_token',
      'scope',
      'scopes',
      'root_folder_name',
    ]);
    const result = await storageService.connectDriveOAuth(
      sessionContext,
      body as unknown as ConnectDriveOAuthRequest,
      requestId,
    );
    sendJson(res, 200, createSuccessEnvelope(result, requestId), {
      'Cache-Control': 'no-store',
    });
    return true;
  }

  if (pathname === '/api/v1/storage/drive/disconnect' && method === 'POST') {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    assertAllowedFields(body, []);
    const result = await storageService.disconnectDriveOAuth(
      sessionContext,
      requestId,
    );
    sendJson(res, 200, createSuccessEnvelope(result, requestId), {
      'Cache-Control': 'no-store',
    });
    return true;
  }

  // Video Upload / File Management Endpoints (/api/v1/storage/files/:id/*)
  const fileRouteMatch = pathname.match(STORAGE_FILE_ROUTE_RE);
  if (fileRouteMatch) {
    const fileId = fileRouteMatch[1]!;
    const fileAction = fileRouteMatch[2];
    const fileSubAction = fileRouteMatch[3];

    if (!fileAction && method === 'DELETE') {
      requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
      const result = await storageService.detachFileRecord(
        sessionContext,
        fileId,
        requestId,
      );
      sendJson(res, 200, createSuccessEnvelope(result, requestId));
      return true;
    }

    if (fileAction === 'upload-chunk' && !fileSubAction && method === 'POST') {
      requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
      const body = await parseJsonBody<Record<string, unknown>>(
        req,
        16 * 1024 * 1024,
      );
      assertAllowedFields(body, [
        'chunk_size_bytes',
        'offset_bytes',
        'chunk_base64',
        'is_final_chunk',
        'simulate_interruption',
        'retry',
      ]);
      const result = await storageService.uploadVideoChunk(
        sessionContext,
        fileId,
        body as unknown as UploadVideoChunkRequest,
        requestId,
      );
      sendJson(res, 200, createSuccessEnvelope(result, requestId));
      return true;
    }

    if (fileAction === 'review' && !fileSubAction && method === 'POST') {
      requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
      const body = await parseJsonBody<Record<string, unknown>>(req);
      assertAllowedFields(body, [
        'review_status',
        'notes',
        'assigned_employee_id',
        'permission_role',
      ]);
      const result = await storageService.reviewStorageFile(
        sessionContext,
        fileId,
        body as unknown as ReviewStorageFileRequest,
        requestId,
      );
      sendJson(res, 200, createSuccessEnvelope(result, requestId));
      return true;
    }

    if (fileAction === 'permissions' && !fileSubAction && method === 'GET') {
      const result = await storageService.listPermissions(
        sessionContext,
        'storage_file',
        fileId,
      );
      sendJson(res, 200, createSuccessEnvelope(result, requestId));
      return true;
    }

    if (fileAction === 'permissions' && !fileSubAction && method === 'POST') {
      requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
      const body = await parseJsonBody<Record<string, unknown>>(req);
      assertAllowedFields(body, ['employee_id', 'role', 'type']);
      const result = await storageService.grantDrivePermission(
        sessionContext,
        'storage_file',
        fileId,
        body as unknown as GrantDrivePermissionRequest,
        requestId,
      );
      sendJson(res, 201, createSuccessEnvelope(result, requestId));
      return true;
    }

    if (
      fileAction === 'permissions' &&
      fileSubAction === 'revoke' &&
      method === 'POST'
    ) {
      requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
      const body = await parseJsonBody<Record<string, unknown>>(req);
      assertAllowedFields(body, ['employee_id', 'grant_id', 'reason']);
      const result = await storageService.revokeDrivePermission(
        sessionContext,
        'storage_file',
        fileId,
        body as unknown as RevokeDrivePermissionRequest,
        requestId,
      );
      sendJson(res, 200, createSuccessEnvelope(result, requestId));
      return true;
    }

    throw new AuthError(
      'NOT_FOUND',
      `Endpoint ${method} ${pathname} not found`,
      404,
    );
  }

  const storageRouteMatch = pathname.match(STORAGE_FOLDER_ROUTE_RE);
  if (!storageRouteMatch) {
    throw new AuthError(
      'NOT_FOUND',
      `Endpoint ${method} ${pathname} not found`,
      404,
    );
  }

  const resource = storageRouteMatch[1];
  const resourceId = storageRouteMatch[2];
  const subAction = storageRouteMatch[3];
  const subSubAction = storageRouteMatch[4];

  // 1. GET /api/v1/storage/folders
  if (resource === 'folders' && !resourceId && !subAction && method === 'GET') {
    const urlObj = new URL(req.url ?? '/', 'http://127.0.0.1');
    const folderType = urlObj.searchParams.get('folder_type') ?? undefined;
    const parentFolderId =
      urlObj.searchParams.get('parent_folder_id') ?? undefined;
    const queryParams: {
      folder_type?: string;
      parent_folder_id?: string;
    } = {};
    if (folderType) queryParams.folder_type = folderType;
    if (parentFolderId) queryParams.parent_folder_id = parentFolderId;
    const result = await storageService.listFolders(
      sessionContext,
      queryParams,
    );
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 2. POST /api/v1/storage/folders
  if (
    resource === 'folders' &&
    !resourceId &&
    !subAction &&
    method === 'POST'
  ) {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    assertAllowedFields(body, [
      'name',
      'drive_url',
      'create_on_drive',
      'folder_type',
      'assigned_employee_ids',
      'assigned_employee_id',
      'parent_folder_id',
      'assignment_id',
      'permission_role',
      'notes',
    ]);
    const idempotencyKey =
      typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : undefined;
    const result = await storageService.createFolder(
      sessionContext,
      body as unknown as CreateStorageFolderRequest,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 201, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 3. GET /api/v1/storage/folders/:id
  if (resource === 'folders' && resourceId && !subAction && method === 'GET') {
    const { folder, etag } = await storageService.getFolder(
      sessionContext,
      resourceId,
    );
    sendJson(res, 200, createSuccessEnvelope(folder, requestId), {
      ETag: etag,
    });
    return true;
  }

  // 3b. DELETE /api/v1/storage/folders/:id
  if (
    resource === 'folders' &&
    resourceId &&
    !subAction &&
    method === 'DELETE'
  ) {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const result = await storageService.detachFolderRecord(
      sessionContext,
      resourceId,
      requestId,
    );
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 4. GET /api/v1/storage/folders/:id/files
  if (
    resource === 'folders' &&
    resourceId &&
    subAction === 'files' &&
    !subSubAction &&
    method === 'GET'
  ) {
    const result = await storageService.getFolderFiles(
      sessionContext,
      resourceId,
    );
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 4b. POST /api/v1/storage/folders/:id/files/upload-sessions
  if (
    resource === 'folders' &&
    resourceId &&
    subAction === 'files' &&
    subSubAction === 'upload-sessions' &&
    method === 'POST'
  ) {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    assertAllowedFields(body, [
      'name',
      'size_bytes',
      'mime_type',
      'assigned_employee_id',
      'permission_role',
    ]);
    const idempotencyKey =
      typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : undefined;
    const result = await storageService.initiateVideoUpload(
      sessionContext,
      resourceId,
      body as unknown as InitiateVideoUploadRequest,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 201, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 4c. POST /api/v1/storage/folders/:id/sync
  if (
    resource === 'folders' &&
    resourceId &&
    subAction === 'sync' &&
    !subSubAction &&
    method === 'POST'
  ) {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    assertAllowedFields(body, []);
    const result = await storageService.syncFolderFiles(
      sessionContext,
      resourceId,
      requestId,
    );
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 4d. GET /api/v1/storage/folders/:id/permissions
  if (
    resource === 'folders' &&
    resourceId &&
    subAction === 'permissions' &&
    !subSubAction &&
    method === 'GET'
  ) {
    const result = await storageService.listPermissions(
      sessionContext,
      'storage_folder',
      resourceId,
    );
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 4e. POST /api/v1/storage/folders/:id/permissions
  if (
    resource === 'folders' &&
    resourceId &&
    subAction === 'permissions' &&
    !subSubAction &&
    method === 'POST'
  ) {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    assertAllowedFields(body, ['employee_id', 'role', 'type']);
    const result = await storageService.grantDrivePermission(
      sessionContext,
      'storage_folder',
      resourceId,
      body as unknown as GrantDrivePermissionRequest,
      requestId,
    );
    sendJson(res, 201, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 4f. POST /api/v1/storage/folders/:id/permissions/revoke
  if (
    resource === 'folders' &&
    resourceId &&
    subAction === 'permissions' &&
    subSubAction === 'revoke' &&
    method === 'POST'
  ) {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    assertAllowedFields(body, ['employee_id', 'grant_id', 'reason']);
    const result = await storageService.revokeDrivePermission(
      sessionContext,
      'storage_folder',
      resourceId,
      body as unknown as RevokeDrivePermissionRequest,
      requestId,
    );
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 5. POST /api/v1/storage/folders/:id/receipts
  if (
    resource === 'folders' &&
    resourceId &&
    subAction === 'receipts' &&
    !subSubAction &&
    method === 'POST'
  ) {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    assertAllowedFields(body, [
      'receipt_type',
      'output_id',
      'revision_number',
      'notes',
    ]);
    const idempotencyKey =
      typeof req.headers['idempotency-key'] === 'string'
        ? req.headers['idempotency-key']
        : undefined;
    const result = await storageService.createReceipt(
      sessionContext,
      resourceId,
      body as unknown as CreateStorageReceiptRequest,
      idempotencyKey,
      requestId,
    );
    sendJson(res, 201, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 6. POST /api/v1/storage/folders/:id/trash-requests
  if (
    resource === 'folders' &&
    resourceId &&
    subAction === 'trash-requests' &&
    !subSubAction &&
    method === 'POST'
  ) {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    assertAllowedFields(body, ['version', 'group_snapshot_hash']);
    const ifMatch =
      typeof req.headers['if-match'] === 'string'
        ? req.headers['if-match']
        : undefined;
    const result = await storageService.createTrashRequest(
      sessionContext,
      resourceId,
      body as unknown as CreateTrashRequestRequest,
      ifMatch,
      requestId,
    );
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 7. POST /api/v1/storage/trash-requests/:id/confirm
  if (
    resource === 'trash-requests' &&
    resourceId &&
    subAction === 'confirm' &&
    !subSubAction &&
    method === 'POST'
  ) {
    requireCsrf(req, sessionContext, csrfSecret, allowedOrigins);
    const body = await parseJsonBody<Record<string, unknown>>(req);
    assertAllowedFields(body, ['acknowledged', 'group_snapshot_hash']);
    const result = await storageService.confirmTrashRequest(
      sessionContext,
      resourceId,
      body as unknown as ConfirmTrashRequest,
      requestId,
    );
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  // 8. GET /api/v1/storage/operations/:id
  if (
    resource === 'operations' &&
    resourceId &&
    !subAction &&
    method === 'GET'
  ) {
    const result = await storageService.getOperation(
      sessionContext,
      resourceId,
    );
    sendJson(res, 200, createSuccessEnvelope(result, requestId));
    return true;
  }

  throw new AuthError(
    'NOT_FOUND',
    `Endpoint ${method} ${pathname} not found`,
    404,
  );
}
