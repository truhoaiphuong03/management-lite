/**
 * @management-lite/contracts - storage
 * Types and DTOs for File & Google Drive Folder Management (FILE-01 V0.2 / Canonical STORAGE)
 * Canonical references: 02_MODULE_REGISTRY.md, 03_DATA_DICTIONARY.md, 05_API_CONTRACTS.md,
 * 20_DBREADY_TABLES_AND_COLUMNS.md, 26_APIREADY_STATE_CONCURRENCY_AND_EXTERNAL.md
 */

export type StorageProvider = 'google_drive' | 'local' | string;

export type StorageFolderType = 'source' | 'deliverable' | string;

export type StorageFolderStatus =
  | 'ready_for_download'
  | 'downloaded'
  | 'deliverable_submitted'
  | 'approved'
  | 'trashed';

export type StorageReceiptType = 'download' | 'deliverable_approval' | string;

export interface StorageReceiptData {
  id: string;
  folder_id: string;
  receipt_type: StorageReceiptType;
  revision_number: number;
  confirmed_by: string;
  confirmed_by_name?: string | null | undefined;
  confirmed_at: string; // ISO 8601 UTC
  notes?: string | null | undefined;
}

/**
 * StorageAssignmentData: Tracks source download confirmation and deliverable handoff
 * for each individual employee assigned to the folder.
 */
export interface StorageAssignmentData {
  id: string;
  folder_id: string;
  employee_id: string;
  employee_name: string;
  source_download_confirmed: boolean;
  source_downloaded_at?: string | null | undefined;
  output_delivered: boolean;
  output_folder_id?: string | null | undefined;
  output_delivered_at?: string | null | undefined;
  status: 'assigned' | 'downloaded' | 'delivered';
}

/**
 * StorageOutputData: Tracks each deliverable folder created by an employee,
 * including its exact revision number and Owner receipt verification status.
 */
export interface StorageOutputData {
  id: string;
  parent_folder_id: string;
  assignment_id?: string | null | undefined;
  submitted_by_employee_id: string;
  submitted_by_employee_name: string;
  name: string;
  drive_url: string;
  current_revision: number;
  owner_receipt_confirmed: boolean;
  owner_receipt_revision?: number | null | undefined;
  owner_reviewed_at?: string | null | undefined;
  notes?: string | null | undefined;
  created_at: string; // ISO 8601 UTC
  updated_at?: string | null | undefined;
}

/**
 * StorageDeleteReadiness: Computed exclusively by backend to verify
 * all assignments and outputs satisfy deletion criteria prior to trashing.
 */
export interface StorageDeleteReadiness {
  can_verify: boolean;
  is_ready: boolean;
  total_assignments: number;
  confirmed_downloads: number;
  delivered_assignments: number;
  total_outputs: number;
  confirmed_outputs: number;
  stale_output_revisions: number;
  group_snapshot_hash: string;
  block_reasons: string[];
}

export interface StorageFolderData {
  id: string;
  workspace_id: string;
  name: string;
  provider: StorageProvider;
  provider_folder_id?: string | null | undefined;
  drive_url: string;
  folder_type: StorageFolderType;
  status: StorageFolderStatus;
  assigned_employee_id?: string | null | undefined;
  assigned_employee_name?: string | null | undefined;
  parent_folder_id?: string | null | undefined;
  deliverable_count: number;
  staff_download_confirmed: boolean;
  staff_downloaded_at?: string | null | undefined;
  owner_review_confirmed: boolean;
  owner_reviewed_at?: string | null | undefined;
  notes?: string | null | undefined;
  version: number;
  created_at: string; // ISO 8601 UTC
  updated_at?: string | null | undefined;
}

export interface StorageFolderDetailData extends StorageFolderData {
  deliverable_folders: StorageFolderData[];
  assignments: StorageAssignmentData[];
  outputs: StorageOutputData[];
  receipts: StorageReceiptData[];
  delete_readiness?: StorageDeleteReadiness | null | undefined;
}

export interface CreateStorageFolderRequest {
  name: string;
  drive_url: string;
  folder_type: StorageFolderType;
  assigned_employee_ids?: string[] | undefined;
  assigned_employee_id?: string | null | undefined;
  parent_folder_id?: string | null | undefined;
  assignment_id?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface CreateStorageReceiptRequest {
  receipt_type: StorageReceiptType;
  output_id?: string | null | undefined;
  revision_number?: number | undefined;
  notes?: string | null | undefined;
}

export interface CreateTrashRequestRequest {
  version: number;
  group_snapshot_hash?: string | undefined;
}

export interface CreateTrashRequestResponseData {
  trash_request_id: string;
  folder_id: string;
  folder_name: string;
  group_snapshot_hash: string;
  deliverables_affected_count: number;
  warning: string;
  expires_at: string; // ISO 8601 UTC
}

export interface ConfirmTrashRequest {
  acknowledged: boolean;
  group_snapshot_hash: string;
}

export interface ConfirmTrashResponseData {
  folder_id: string;
  status: 'trashed';
  trashed_at: string; // ISO 8601 UTC
}

export interface StorageFileData {
  id: string;
  workspace_id: string;
  folder_id: string;
  provider_file_id?: string | null | undefined;
  provider_revision_id?: string | null | undefined;
  name: string;
  size_bytes?: number | null | undefined;
  mime_type?: string | null | undefined;
  status: string;
  created_at: string; // ISO 8601 UTC
}

export interface StorageOperationData {
  id: string;
  workspace_id: string;
  folder_id: string;
  operation_type: 'trash_group' | 'restore_group' | string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'unknown';
  requested_by: string;
  provider: StorageProvider;
  error_message?: string | null | undefined;
  created_at: string; // ISO 8601 UTC
  completed_at?: string | null | undefined;
}
