-- Migration: 0012_m09_storage
-- Scope: FILE-01 Quản lý Tệp & Thư mục Google Drive (Canonical STORAGE)
-- Authoritative: Canonical docs 02, 03, 05, 14, 20, 22, 26; SCOPE-EXT-05-FILE-01

-- 1. Storage Folders (Canonical entity: storage_folders)
CREATE TABLE IF NOT EXISTS storage_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  name text NOT NULL,
  provider text NOT NULL DEFAULT 'google_drive',
  provider_folder_id text,
  drive_url text NOT NULL,
  folder_type text NOT NULL CHECK (folder_type IN ('source', 'deliverable')),
  status text NOT NULL DEFAULT 'ready_for_download' CHECK (status IN ('ready_for_download', 'downloaded', 'deliverable_submitted', 'approved', 'trashed')),
  parent_folder_id uuid,
  assigned_employee_id uuid,
  created_by_employee_id uuid,
  assignment_id uuid,
  current_revision_id uuid,
  current_revision_number integer NOT NULL DEFAULT 1 CHECK (current_revision_number >= 1),
  owner_receipt_confirmed boolean NOT NULL DEFAULT false,
  owner_receipt_revision integer,
  owner_reviewed_at timestamptz,
  notes text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_storage_folders_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_storage_folders_parent
    FOREIGN KEY (workspace_id, parent_folder_id)
    REFERENCES storage_folders (workspace_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_storage_folders_assigned_employee
    FOREIGN KEY (workspace_id, assigned_employee_id)
    REFERENCES employees (workspace_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_storage_folders_creator_employee
    FOREIGN KEY (workspace_id, created_by_employee_id)
    REFERENCES employees (workspace_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_storage_folders_workspace_status
  ON storage_folders (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_storage_folders_workspace_parent
  ON storage_folders (workspace_id, parent_folder_id);

CREATE INDEX IF NOT EXISTS idx_storage_folders_workspace_type
  ON storage_folders (workspace_id, folder_type);

-- 2. Folder Assignments (Per-employee tracking for source folder download and deliverables)
CREATE TABLE IF NOT EXISTS folder_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  folder_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  source_download_confirmed boolean NOT NULL DEFAULT false,
  source_downloaded_at timestamptz,
  output_delivered boolean NOT NULL DEFAULT false,
  output_folder_id uuid,
  output_delivered_at timestamptz,
  status text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned', 'downloaded', 'delivered')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_folder_assignments_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT uq_folder_assignments_folder_employee UNIQUE (workspace_id, folder_id, employee_id),
  CONSTRAINT fk_folder_assignments_folder
    FOREIGN KEY (workspace_id, folder_id)
    REFERENCES storage_folders (workspace_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_folder_assignments_employee
    FOREIGN KEY (workspace_id, employee_id)
    REFERENCES employees (workspace_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_folder_assignments_folder
  ON folder_assignments (workspace_id, folder_id);

CREATE INDEX IF NOT EXISTS idx_folder_assignments_employee
  ON folder_assignments (workspace_id, employee_id);

-- 3. Folder Revisions (Canonical entity: folder_revisions)
CREATE TABLE IF NOT EXISTS folder_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  folder_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number >= 1),
  snapshot_hash text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_folder_revisions_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT uq_folder_revisions_folder_rev UNIQUE (workspace_id, folder_id, revision_number),
  CONSTRAINT fk_folder_revisions_folder
    FOREIGN KEY (workspace_id, folder_id)
    REFERENCES storage_folders (workspace_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_folder_revisions_folder
  ON folder_revisions (workspace_id, folder_id);

-- 4. Folder Receipts (Canonical entity: folder_receipts)
CREATE TABLE IF NOT EXISTS folder_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  folder_id uuid NOT NULL,
  folder_revision_id uuid,
  receipt_type text NOT NULL CHECK (receipt_type IN ('download', 'deliverable_approval')),
  revision_number integer NOT NULL DEFAULT 1 CHECK (revision_number >= 1),
  confirmed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assignment_id uuid,
  notes text,
  confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_folder_receipts_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_folder_receipts_folder
    FOREIGN KEY (workspace_id, folder_id)
    REFERENCES storage_folders (workspace_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_folder_receipts_assignment
    FOREIGN KEY (workspace_id, assignment_id)
    REFERENCES folder_assignments (workspace_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_folder_receipts_folder
  ON folder_receipts (workspace_id, folder_id, receipt_type);

-- 5. Storage Files (Canonical entity: storage_files)
CREATE TABLE IF NOT EXISTS storage_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  folder_id uuid NOT NULL,
  provider_file_id text,
  provider_revision_id text,
  name text NOT NULL,
  size_bytes bigint,
  mime_type text,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'deleted', 'trashed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_storage_files_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_storage_files_folder
    FOREIGN KEY (workspace_id, folder_id)
    REFERENCES storage_folders (workspace_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_storage_files_folder
  ON storage_files (workspace_id, folder_id);

-- 6. Storage Trash Requests (Two-step group trash intent)
CREATE TABLE IF NOT EXISTS storage_trash_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  folder_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'expired', 'cancelled')),
  group_snapshot_hash text NOT NULL,
  deliverables_affected_count integer NOT NULL DEFAULT 0,
  warning text NOT NULL,
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_storage_trash_requests_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_storage_trash_requests_folder
    FOREIGN KEY (workspace_id, folder_id)
    REFERENCES storage_folders (workspace_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_storage_trash_requests_folder
  ON storage_trash_requests (workspace_id, folder_id, status);

-- 7. Storage Operations (Canonical entity: storage_operations - durable reconciliation)
CREATE TABLE IF NOT EXISTS storage_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  folder_id uuid NOT NULL,
  operation_type text NOT NULL CHECK (operation_type IN ('trash_group', 'restore_group')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'unknown')),
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'google_drive',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT uq_storage_operations_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_storage_operations_folder
    FOREIGN KEY (workspace_id, folder_id)
    REFERENCES storage_folders (workspace_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_storage_operations_folder
  ON storage_operations (workspace_id, folder_id);

-- 8. Resource Access Grants (Canonical entity: resource_access_grants)
CREATE TABLE IF NOT EXISTS resource_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  resource_type text NOT NULL CHECK (resource_type IN ('storage_folder')),
  resource_id uuid NOT NULL,
  employee_id uuid NOT NULL,
  access_level text NOT NULL DEFAULT 'read' CHECK (access_level IN ('read', 'write', 'admin')),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_resource_access_grants_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT uq_resource_access_grants_unique UNIQUE (workspace_id, resource_type, resource_id, employee_id),
  CONSTRAINT fk_resource_access_grants_folder
    FOREIGN KEY (workspace_id, resource_id)
    REFERENCES storage_folders (workspace_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_resource_access_grants_employee
    FOREIGN KEY (workspace_id, employee_id)
    REFERENCES employees (workspace_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_resource_access_grants_resource
  ON resource_access_grants (workspace_id, resource_type, resource_id);

CREATE INDEX IF NOT EXISTS idx_resource_access_grants_employee
  ON resource_access_grants (workspace_id, employee_id);
