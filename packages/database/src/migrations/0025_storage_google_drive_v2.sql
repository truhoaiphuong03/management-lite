-- Migration: 0025_storage_google_drive_v2
-- Scope: FILE-01 / FILE-02 Direct Google Drive API v3 Integration (OAuth 2.0 encrypted connection,
-- direct Drive folder creation metadata, resumable video upload sessions, email-based
-- reader/writer permission grants with inheritance tracking, and non-destructive record detach).

CREATE TABLE IF NOT EXISTS storage_drive_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'connected', 'disconnected', 'revoked', 'error')),
  google_email text NOT NULL,
  display_name text NULL,
  scope text NOT NULL DEFAULT 'https://www.googleapis.com/auth/drive.file',
  scopes text[] NOT NULL DEFAULT ARRAY['https://www.googleapis.com/auth/drive.file'],
  root_folder_id text NULL,
  root_folder_url text NULL,
  root_drive_folder_id text NULL,
  root_drive_folder_url text NULL,
  refresh_token_ciphertext bytea NULL,
  refresh_token_nonce bytea NULL,
  refresh_token_auth_tag bytea NULL,
  refresh_token_tag bytea NULL,
  ciphertext bytea NULL,
  nonce bytea NULL,
  auth_tag bytea NULL,
  key_version text NOT NULL DEFAULT 'v1',
  encryption_schema_version integer NOT NULL DEFAULT 1,
  connected_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  connected_by_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  connected_at timestamptz NULL DEFAULT clock_timestamp(),
  disconnected_at timestamptz NULL,
  last_synced_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_storage_drive_connections_workspace UNIQUE (workspace_id)
);

ALTER TABLE storage_drive_connections
  ADD COLUMN IF NOT EXISTS display_name text NULL,
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'https://www.googleapis.com/auth/drive.file',
  ADD COLUMN IF NOT EXISTS root_folder_id text NULL,
  ADD COLUMN IF NOT EXISTS root_folder_url text NULL,
  ADD COLUMN IF NOT EXISTS refresh_token_ciphertext bytea NULL,
  ADD COLUMN IF NOT EXISTS refresh_token_nonce bytea NULL,
  ADD COLUMN IF NOT EXISTS refresh_token_auth_tag bytea NULL,
  ADD COLUMN IF NOT EXISTS refresh_token_tag bytea NULL,
  ADD COLUMN IF NOT EXISTS connected_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disconnected_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT clock_timestamp();

ALTER TABLE storage_drive_connections
  ALTER COLUMN connected_by_user_id DROP NOT NULL,
  ALTER COLUMN ciphertext DROP NOT NULL,
  ALTER COLUMN nonce DROP NOT NULL,
  ALTER COLUMN auth_tag DROP NOT NULL;

ALTER TABLE storage_drive_connections
  DROP CONSTRAINT IF EXISTS storage_drive_connections_status_check;

ALTER TABLE storage_drive_connections
  ADD CONSTRAINT storage_drive_connections_status_check
  CHECK (status IN ('active', 'connected', 'disconnected', 'revoked', 'error'));

CREATE INDEX IF NOT EXISTS idx_storage_drive_connections_workspace
  ON storage_drive_connections (workspace_id, status);

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS google_email text NULL;

ALTER TABLE storage_folders
  ADD COLUMN IF NOT EXISTS provider_parent_id text NULL,
  ADD COLUMN IF NOT EXISTS drive_owner_email text NULL,
  ADD COLUMN IF NOT EXISTS drive_created_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS record_status text NOT NULL DEFAULT 'active';

ALTER TABLE storage_folders
  DROP CONSTRAINT IF EXISTS storage_folders_record_status_check;

ALTER TABLE storage_folders
  ADD CONSTRAINT storage_folders_record_status_check
  CHECK (record_status IN ('active', 'detached'));

ALTER TABLE storage_files
  ADD COLUMN IF NOT EXISTS drive_url text NULL,
  ADD COLUMN IF NOT EXISTS web_view_link text NULL,
  ADD COLUMN IF NOT EXISTS parent_provider_folder_id text NULL,
  ADD COLUMN IF NOT EXISTS drive_owner_email text NULL,
  ADD COLUMN IF NOT EXISTS drive_created_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS upload_status text NOT NULL DEFAULT 'completed',
  ADD COLUMN IF NOT EXISTS upload_session_id text NULL,
  ADD COLUMN IF NOT EXISTS resumable_session_uri text NULL,
  ADD COLUMN IF NOT EXISTS uploaded_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upload_progress_pct integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS upload_retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upload_error_message text NULL,
  ADD COLUMN IF NOT EXISTS last_error text NULL,
  ADD COLUMN IF NOT EXISTS assigned_employee_id uuid NULL,
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS reviewed_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS review_notes text NULL,
  ADD COLUMN IF NOT EXISTS uploaded_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT clock_timestamp();

ALTER TABLE storage_files
  DROP CONSTRAINT IF EXISTS storage_files_status_check;

ALTER TABLE storage_files
  ADD CONSTRAINT storage_files_status_check
  CHECK (status IN ('available', 'active', 'uploading', 'paused', 'failed', 'deleted', 'trashed', 'detached'));

ALTER TABLE storage_files
  DROP CONSTRAINT IF EXISTS storage_files_upload_status_check;

ALTER TABLE storage_files
  ADD CONSTRAINT storage_files_upload_status_check
  CHECK (upload_status IN ('pending', 'resumable_session_created', 'initiated', 'uploading', 'paused', 'interrupted', 'completed', 'failed'));

ALTER TABLE storage_files
  DROP CONSTRAINT IF EXISTS storage_files_uploaded_bytes_check;

ALTER TABLE storage_files
  ADD CONSTRAINT storage_files_uploaded_bytes_check
  CHECK (uploaded_bytes >= 0);

ALTER TABLE storage_files
  DROP CONSTRAINT IF EXISTS storage_files_retry_count_check;

ALTER TABLE storage_files
  ADD CONSTRAINT storage_files_retry_count_check
  CHECK (retry_count >= 0 AND upload_retry_count >= 0);

ALTER TABLE storage_files
  DROP CONSTRAINT IF EXISTS storage_files_review_status_check;

ALTER TABLE storage_files
  ADD CONSTRAINT storage_files_review_status_check
  CHECK (review_status IN ('pending_review', 'unreviewed', 'approved', 'rejected'));

ALTER TABLE storage_files
  DROP CONSTRAINT IF EXISTS fk_storage_files_assigned_employee;

ALTER TABLE storage_files
  ADD CONSTRAINT fk_storage_files_assigned_employee
  FOREIGN KEY (workspace_id, assigned_employee_id)
  REFERENCES employees (workspace_id, id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_storage_files_workspace_assignee
  ON storage_files (workspace_id, assigned_employee_id);

ALTER TABLE resource_access_grants
  DROP CONSTRAINT IF EXISTS fk_resource_access_grants_folder;

ALTER TABLE resource_access_grants
  DROP CONSTRAINT IF EXISTS resource_access_grants_resource_type_check;

ALTER TABLE resource_access_grants
  ADD CONSTRAINT resource_access_grants_resource_type_check
  CHECK (resource_type IN ('storage_folder', 'storage_file'));

ALTER TABLE resource_access_grants
  ADD COLUMN IF NOT EXISTS google_email text NULL,
  ADD COLUMN IF NOT EXISTS drive_role text NOT NULL DEFAULT 'reader',
  ADD COLUMN IF NOT EXISTS drive_permission_id text NULL,
  ADD COLUMN IF NOT EXISTS inherited_from_resource_id uuid NULL,
  ADD COLUMN IF NOT EXISTS granted_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS granted_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN IF NOT EXISTS revoked_by uuid NULL REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE resource_access_grants
  DROP CONSTRAINT IF EXISTS resource_access_grants_drive_role_check;

ALTER TABLE resource_access_grants
  ADD CONSTRAINT resource_access_grants_drive_role_check
  CHECK (drive_role IN ('reader', 'writer', 'commenter'));

ALTER TABLE storage_operations
  DROP CONSTRAINT IF EXISTS storage_operations_operation_type_check;

ALTER TABLE storage_operations
  ADD CONSTRAINT storage_operations_operation_type_check
  CHECK (operation_type IN ('trash_group', 'restore_group', 'sync_metadata', 'create_folder', 'upload_video', 'grant_permission', 'revoke_permission'));
