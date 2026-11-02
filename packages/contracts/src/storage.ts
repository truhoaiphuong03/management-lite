export type StorageProvider = 'google_drive' | 'local' | string;
export type StorageFolderType = 'source' | 'deliverable' | string;
export type StorageFolderStatus =
  | 'draft'
  | 'assigned'
  | 'in_progress'
  | 'submitted'
  | 'approved'
  | 'trashed'
  | 'ready_for_download'
  | 'downloaded'
  | 'deliverable_submitted';

export type StorageReceiptType =
  | 'staff_source_ack'
  | 'owner_deliverable_review'
  | 'download'
  | 'deliverable_approval'
  | string;
export type StorageOperationStatus =
  'pending' | 'in_progress' | 'running' | 'completed' | 'failed' | 'unknown';
export type StorageTrashRequestStatus =
  'pending' | 'confirmed' | 'expired' | 'cancelled';

export type DrivePermissionRole = 'reader' | 'writer';
export type StorageFileUploadStatus =
  | 'initiated'
  | 'resumable_session_created'
  | 'uploading'
  | 'paused'
  | 'interrupted'
  | 'completed'
  | 'failed';
export type StorageFileReviewStatus =
  'unreviewed' | 'pending_review' | 'approved' | 'rejected';
export type StorageDriveConnectionStatus =
  'connected' | 'active' | 'disconnected' | 'revoked';

export interface StorageDriveConnectionData {
  id?: string | undefined;
  workspace_id?: string | undefined;
  connected: boolean;
  provider?: StorageProvider | undefined;
  oauth_mode?: 'mock' | 'live' | undefined;
  live_credentials_configured?: boolean | undefined;
  redirect_uri?: string | undefined;
  connection_id?: string | null | undefined;
  google_email: string | null;
  scopes: string[];
  root_folder_id?: string | null | undefined;
  root_folder_url?: string | null | undefined;
  root_drive_folder_id?: string | null | undefined;
  root_drive_folder_url?: string | null | undefined;
  token_encrypted_at_rest?: boolean | undefined;
  key_version?: number | undefined;
  status: StorageDriveConnectionStatus;
  connected_at: string | null;
  last_synced_at?: string | null | undefined;
  updated_at?: string | null | undefined;
}

export interface ConnectDriveOAuthRequest {
  code?: string | undefined;
  state?: string | undefined;
  redirect_uri?: string | undefined;
  google_email?: string | undefined;
  refresh_token?: string | undefined;
  scopes?: string[] | undefined;
  root_folder_name?: string | undefined;
}

export interface StoragePermissionGrantData {
  id: string;
  workspace_id: string;
  resource_type: 'storage_folder' | 'storage_file';
  resource_id: string;
  employee_id: string;
  employee_name?: string | null | undefined;
  employee_code?: string | null | undefined;
  google_email: string | null;
  access_level: 'read' | 'write' | 'admin';
  drive_role: DrivePermissionRole;
  drive_permission_id: string | null;
  inherited_from_resource_id: string | null;
  granted_by?: string | null | undefined;
  granted_at?: string | undefined;
  revoked_at: string | null;
  created_at?: string | undefined;
}

export interface GrantDrivePermissionRequest {
  employee_id: string;
  role?: DrivePermissionRole | undefined;
  type?: string | undefined;
}

export interface RevokeDrivePermissionRequest {
  employee_id?: string | undefined;
  grant_id?: string | undefined;
  reason?: string | undefined;
}

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
  reasons?: string[] | undefined;
  deliverables_total?: number | undefined;
  deliverables_confirmed?: number | undefined;
}

export interface StorageFolderRevisionData {
  id: string;
  folder_id: string;
  revision_number: number;
  drive_url: string;
  provider_folder_id: string | null;
  submitted_by_employee_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface StorageFolderReceiptData {
  id: string;
  folder_id: string;
  revision_id: string | null;
  revision_number: number | null;
  receipt_type: StorageReceiptType;
  actor_user_id: string;
  actor_employee_id: string | null;
  output_id: string | null;
  notes: string | null;
  confirmed_at: string;
}

export interface StorageFolderData {
  id: string;
  workspace_id: string;
  name: string;
  provider: StorageProvider;
  provider_folder_id?: string | null | undefined;
  provider_parent_id?: string | null | undefined;
  drive_owner_email?: string | null | undefined;
  drive_created_at?: string | null | undefined;
  record_status?: 'active' | 'detached' | undefined;
  drive_url: string;
  folder_type: StorageFolderType;
  status: StorageFolderStatus;
  assigned_employee_id?: string | null | undefined;
  assigned_employee_name?: string | null | undefined;
  assigned_employee_ids?: string[] | undefined;
  parent_folder_id?: string | null | undefined;
  created_by_employee_id?: string | null | undefined;
  assignment_id?: string | null | undefined;
  current_revision_id?: string | null | undefined;
  current_revision_number?: number | undefined;
  owner_receipt_confirmed?: boolean | undefined;
  owner_receipt_revision?: number | null | undefined;
  deliverable_count: number;
  staff_download_confirmed: boolean;
  staff_downloaded_at?: string | null | undefined;
  owner_review_confirmed: boolean;
  owner_reviewed_at?: string | null | undefined;
  notes?: string | null | undefined;
  version: number;
  created_at: string; // ISO 8601 UTC
  updated_at?: string | null | undefined;
  delete_readiness?: StorageDeleteReadiness | null | undefined;
  staff_source_acknowledged?: boolean | undefined;
  deliverables?: StorageFolderData[] | undefined;
  revisions?: StorageFolderRevisionData[] | undefined;
  receipts?: StorageReceiptData[] | undefined;
  permission_grants?: StoragePermissionGrantData[] | undefined;
  files?: StorageFileData[] | undefined;
  files_count?: number | undefined;
  assignments?: StorageAssignmentData[] | undefined;
  outputs?: StorageOutputData[] | undefined;
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
  drive_url?: string | undefined;
  create_on_drive?: boolean | undefined;
  folder_type: StorageFolderType;
  assigned_employee_ids?: string[] | undefined;
  assigned_employee_id?: string | null | undefined;
  parent_folder_id?: string | null | undefined;
  assignment_id?: string | null | undefined;
  permission_role?: DrivePermissionRole | undefined;
  notes?: string | null | undefined;
}

export interface InitiateVideoUploadRequest {
  name: string;
  size_bytes: number;
  mime_type?: string | undefined;
  assigned_employee_id?: string | null | undefined;
  permission_role?: DrivePermissionRole | undefined;
}

export interface UploadVideoChunkRequest {
  chunk_size_bytes: number;
  offset_bytes?: number | undefined;
  chunk_base64?: string | undefined;
  is_final_chunk?: boolean | undefined;
  simulate_interruption?: boolean | undefined;
  retry?: boolean | undefined;
}

export interface ReviewStorageFileRequest {
  review_status?: StorageFileReviewStatus | undefined;
  notes?: string | undefined;
  assigned_employee_id?: string | null | undefined;
  permission_role?: DrivePermissionRole | undefined;
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

export type TrashRequestResponseData = CreateTrashRequestResponseData;

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
  drive_url?: string | null | undefined;
  parent_provider_folder_id?: string | null | undefined;
  drive_owner_email?: string | null | undefined;
  drive_created_at?: string | null | undefined;
  name: string;
  size_bytes?: number | null | undefined;
  mime_type?: string | null | undefined;
  status: string;
  web_view_link?: string | null | undefined;
  upload_status?: StorageFileUploadStatus | undefined;
  upload_session_id?: string | null | undefined;
  uploaded_bytes?: number | undefined;
  upload_progress_pct?: number | undefined;
  upload_retry_count?: number | undefined;
  upload_error_message?: string | null | undefined;
  resumable_session_uri?: string | null | undefined;
  retry_count?: number | undefined;
  last_error?: string | null | undefined;
  assigned_employee_id?: string | null | undefined;
  assigned_employee_name?: string | null | undefined;
  assigned_employee_code?: string | null | undefined;
  review_status?: StorageFileReviewStatus | undefined;
  reviewed_by?: string | null | undefined;
  review_notes?: string | null | undefined;
  reviewed_at?: string | null | undefined;
  created_at: string; // ISO 8601 UTC
  updated_at?: string | null | undefined;
  permission_grants?: StoragePermissionGrantData[] | undefined;
}

export interface StorageOperationData {
  id: string;
  workspace_id: string;
  folder_id: string;
  operation_type: 'trash_group' | 'restore_group' | 'sync_metadata' | string;
  status:
    'pending' | 'running' | 'in_progress' | 'completed' | 'failed' | 'unknown';
  requested_by?: string | undefined;
  provider: StorageProvider;
  trash_request_id?: string | null | undefined;
  target_folder_ids?: string[] | undefined;
  error_code?: string | null | undefined;
  error_message?: string | null | undefined;
  started_at?: string | null | undefined;
  created_at: string; // ISO 8601 UTC
  completed_at?: string | null | undefined;
}
