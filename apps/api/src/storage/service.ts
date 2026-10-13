/**
 * Storage Service (FILE-01 / Canonical STORAGE)
 *
 * Implements 8 API endpoints per Canonical Doc 02, 03, 05, 14, 20, 22, 26
 * and SCOPE-EXT-05-FILE-01.
 *
 * Invariants:
 * - Multi-tenant isolation: every query is scoped by workspace_id. Cross-tenant queries return 404.
 * - RBAC: Owner has full control; Staff can only access assigned folders, download receipts, and submit deliverables.
 * - Zero binary transfer: Google Drive handles binaries; Lite handles metadata, receipts, revisions, operations.
 * - Group Trash Protocol: 2-step verification, atomic whole-group trash, fail-closed delete_readiness, no partial delete.
 */

import crypto from 'node:crypto';
import type { DatabasePool } from '../../../../packages/database/src/pool.js';
import type { PoolClient } from 'pg';
import { recordAuditEvent } from '../../../../packages/database/src/audit.js';
import {
  claimIdempotency,
  completeIdempotency,
  computeRequestFingerprint,
} from '../../../../packages/database/src/idempotency.js';
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
} from '../../../../packages/contracts/src/storage.js';
import {
  type IStorageProvider,
  type StorageProviderResult,
  MockGoogleDriveProvider,
} from './provider.js';

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

export class StorageService {
  constructor(
    private readonly pool: DatabasePool,
    private readonly provider: IStorageProvider = new MockGoogleDriveProvider(),
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
               (SELECT COUNT(*)::int FROM storage_folders df WHERE df.workspace_id = f.workspace_id AND df.parent_folder_id = f.id) AS deliverable_count
        FROM storage_folders f
        LEFT JOIN employees e ON e.workspace_id = f.workspace_id AND e.id = f.assigned_employee_id
        WHERE f.workspace_id = $1
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

      return result.rows.map((row) => ({
        id: row.id,
        workspace_id: row.workspace_id,
        name: row.name,
        provider: row.provider,
        provider_folder_id: row.provider_folder_id,
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
      }));
    } finally {
      c.release();
    }
  }

  /**
   * 2. POST /api/v1/storage/folders
   * Creates a source folder (Owner only) or deliverable folder (Staff or Owner).
   */
  async createFolder(
    auth: AuthenticatedContext,
    body: CreateStorageFolderRequest,
    idempotencyKey?: string | undefined,
    requestId: string = crypto.randomUUID(),
  ): Promise<StorageFolderData> {
    const name = assertText(body.name, 200, true, 'name');
    const driveUrl = assertText(body.drive_url, 1000, true, 'drive_url');
    const folderType = assertText(body.folder_type, 50, true, 'folder_type');

    if (folderType !== 'source' && folderType !== 'deliverable') {
      fail(
        'VALIDATION_ERROR',
        "folder_type must be 'source' or 'deliverable'",
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
          'SELECT id, folder_type, status FROM storage_folders WHERE id=$1 AND workspace_id=$2',
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

      const providerFolderId = this.provider.parseFolderId(driveUrl);
      const initialStatus =
        folderType === 'source'
          ? 'ready_for_download'
          : 'deliverable_submitted';

      // Insert folder
      const insertRes = await c.query(
        `INSERT INTO storage_folders (
           workspace_id, name, provider, provider_folder_id, drive_url,
           folder_type, status, parent_folder_id, assigned_employee_id,
           created_by_employee_id, assignment_id, notes, current_revision_number, version
         ) VALUES ($1, $2, 'google_drive', $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, 1)
         RETURNING *`,
        [
          auth.workspace.id,
          name,
          providerFolderId,
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

      // If source folder, process assignments
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

      for (const empId of employeeIdsToAssign) {
        // Verify employee exists and is active
        const empCheck = await c.query(
          "SELECT id FROM employees WHERE workspace_id=$1 AND id=$2 AND employment_status='active'",
          [auth.workspace.id, empId],
        );
        if (empCheck.rows.length === 0) {
          fail(
            'VALIDATION_ERROR',
            `Employee ${empId} is not active in this workspace`,
            400,
          );
        }

        // Insert folder assignment
        await c.query(
          `INSERT INTO folder_assignments (workspace_id, folder_id, employee_id, status)
           VALUES ($1, $2, $3, 'assigned')
           ON CONFLICT (workspace_id, folder_id, employee_id) DO NOTHING`,
          [auth.workspace.id, folderRow.id, empId],
        );

        // Insert resource access grant
        await c.query(
          `INSERT INTO resource_access_grants (workspace_id, resource_type, resource_id, employee_id, access_level)
           VALUES ($1, 'storage_folder', $2, $3, 'read')
           ON CONFLICT (workspace_id, resource_type, resource_id, employee_id) DO NOTHING`,
          [auth.workspace.id, folderRow.id, empId],
        );
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
          parent_folder_id: parentFolderId,
          assigned_count: employeeIdsToAssign.length,
        },
      });

      const responseData: StorageFolderData = {
        id: folderRow.id,
        workspace_id: folderRow.workspace_id,
        name: folderRow.name,
        provider: folderRow.provider,
        provider_folder_id: folderRow.provider_folder_id,
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

      const detailData: StorageFolderDetailData = {
        id: folderRow.id,
        workspace_id: folderRow.workspace_id,
        name: folderRow.name,
        provider: folderRow.provider,
        provider_folder_id: folderRow.provider_folder_id,
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
        assignments,
        outputs,
        receipts,
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
        'SELECT id FROM storage_folders WHERE id=$1 AND workspace_id=$2',
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

      const filesRes = await c.query(
        `SELECT * FROM storage_files
         WHERE workspace_id = $1 AND folder_id = $2
         ORDER BY created_at DESC`,
        [auth.workspace.id, folderId],
      );

      return filesRes.rows.map((row) => ({
        id: row.id,
        workspace_id: row.workspace_id,
        folder_id: row.folder_id,
        provider_file_id: row.provider_file_id,
        provider_revision_id: row.provider_revision_id,
        name: row.name,
        size_bytes: row.size_bytes ? Number(row.size_bytes) : undefined,
        mime_type: row.mime_type,
        status: row.status,
        created_at: row.created_at.toISOString(),
      }));
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
    const receiptType = assertText(body.receipt_type, 50, true, 'receipt_type');

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
          providerRes.status ||
          (providerRes.success ? 'completed' : 'failed');

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
}
