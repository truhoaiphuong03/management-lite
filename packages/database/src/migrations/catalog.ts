import type { MigrationFile } from '../migrator.js';
import { calculateChecksum } from '../migrator.js';

export const M00_SQL = `-- Migration: 0001_m00_prerequisites
-- Scope: PK-01 M00 PostgreSQL prerequisites
-- Authoritative: Canonical docs 20, 22, 51, 58

CREATE EXTENSION IF NOT EXISTS pgcrypto;
`;

export const M01_SQL = `-- Migration: 0002_m01_workspace_user_audit_idempotency
-- Scope: PK-01 M01 Workspace, Global User, Audit Events, Idempotency Records
-- Authoritative: Canonical docs 20, 21, 22, 50, 58

-- 1. Workspaces (Tenant container)
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_workspaces_id UNIQUE (id)
);

-- 2. Users (Global identity, no tenant data)
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username_normalized text NOT NULL,
  email_normalized text NOT NULL,
  status text NOT NULL DEFAULT 'pending_activation' CHECK (status IN ('pending_activation', 'active', 'suspended')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_users_username UNIQUE (username_normalized),
  CONSTRAINT uq_users_email UNIQUE (email_normalized)
);

-- 3. Idempotency Records (T1/T2: scoped to workspace, actor, operation_key)
CREATE TABLE IF NOT EXISTS idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation_key text NOT NULL,
  request_fingerprint text NOT NULL,
  state text NOT NULL CHECK (state IN ('claimed', 'completed', 'failed')),
  response_code integer NULL,
  sanitized_response jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT uq_idempotency_records UNIQUE (workspace_id, actor_user_id, operation_key)
);

CREATE INDEX IF NOT EXISTS ix_idempotency_expiry ON idempotency_records (expires_at);

-- 4. Audit Events (T3: append-only, tenant-isolated)
CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  actor_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  request_id text NOT NULL,
  metadata_sanitized jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_audit_cursor ON audit_events (workspace_id, created_at DESC, id DESC);

-- DB Guard: Audit Events is append-only. Prohibit UPDATE and DELETE
CREATE OR REPLACE FUNCTION prevent_audit_events_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only: % operation prohibited', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_events_immutable ON audit_events;
CREATE TRIGGER trg_audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_events_mutation();
`;

export const M02_SQL = `-- Migration: 0003_m02_auth_membership_session_outbox
-- Scope: AUTH-01A M02 Workspace Memberships, User Credentials, Auth Sessions, Activation Invites, Email Outbox
-- Authoritative: Canonical docs 03, 04, 18, 20, 21, 22, 36, 50, 58

-- 1. Workspace Memberships (Tenant membership & role)
CREATE TABLE IF NOT EXISTS workspace_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner', 'staff')),
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'suspended')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_workspace_memberships_workspace_user UNIQUE (workspace_id, user_id),
  CONSTRAINT uq_workspace_memberships_workspace_id UNIQUE (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS ix_workspace_memberships_user ON workspace_memberships (user_id);

-- 2. User Credentials (Argon2id password hashes, global identity credential)
CREATE TABLE IF NOT EXISTS user_credentials (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  password_hash text NOT NULL,
  credential_version integer NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Activation Invites (CSPRNG single-use 24h tokens)
CREATE TABLE IF NOT EXISTS activation_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  token_hash text NOT NULL,
  token_version integer NOT NULL DEFAULT 1 CHECK (token_version > 0),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'issued', 'used', 'revoked', 'expired')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_activation_invites_token_hash UNIQUE (token_hash),
  CONSTRAINT uq_activation_invites_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_activation_invites_membership FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_memberships(workspace_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_activation_invites_lookup ON activation_invites (workspace_id, user_id, status, expires_at);

-- 4. Auth Sessions (Server-side opaque sessions, idle + absolute timeouts)
CREATE TABLE IF NOT EXISTS auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  session_token_hash text NOT NULL,
  credential_version_at_issue integer NOT NULL CHECK (credential_version_at_issue > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  CONSTRAINT uq_auth_sessions_token_hash UNIQUE (session_token_hash),
  CONSTRAINT uq_auth_sessions_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_auth_sessions_membership FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_memberships(workspace_id, user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_auth_sessions_lookup ON auth_sessions (workspace_id, user_id, revoked_at, absolute_expires_at);

-- 5. Email Outbox (Durable queue for asynchronous email delivery)
CREATE TABLE IF NOT EXISTS email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  invite_id uuid NOT NULL,
  message_type text NOT NULL CHECK (message_type IN ('activation_invite')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz NULL,
  provider_message_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_email_outbox_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_email_outbox_invite FOREIGN KEY (workspace_id, invite_id)
    REFERENCES activation_invites(workspace_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS ix_email_queue ON email_outbox (status, next_attempt_at, lease_until, id);

-- 6. Email Delivery Attempts (Audit trail for delivery outcomes)
CREATE TABLE IF NOT EXISTS email_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  outbox_id uuid NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  outcome text NOT NULL CHECK (outcome IN ('queued', 'accepted', 'delivered', 'failed', 'unknown')),
  provider_message_id text NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  sanitized_error_code text NULL,
  CONSTRAINT uq_email_delivery_attempts UNIQUE (workspace_id, outbox_id, attempt_no),
  CONSTRAINT uq_email_delivery_attempts_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT fk_email_delivery_attempts_outbox FOREIGN KEY (workspace_id, outbox_id)
    REFERENCES email_outbox(workspace_id, id) ON DELETE RESTRICT
);
`;

export const M02B_SQL = `-- Migration: 0004_m02b_user_workspace_bindings
-- Scope: C06 Preauthorized Workspace Context Binding, System Admin Authority, Append-Lifecycle History
-- Authoritative: Canonical docs 03, 04, 18, 20, 21, 36, 37, 50, OWNER DECISION

-- 1. System Administrators (Platform Scope Authority - independent of workspace memberships)
CREATE TABLE IF NOT EXISTS system_administrators (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  granted_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  revoked_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_system_administrators_revocation CHECK (
    (status = 'active' AND revoked_at IS NULL AND revoked_by_user_id IS NULL) OR
    (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS ix_system_administrators_active
  ON system_administrators (user_id)
  WHERE status = 'active';

-- 2. User Workspace Bindings (Preauthorized Active Context per C06)
CREATE TABLE IF NOT EXISTS user_workspace_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  provisioned_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  revoked_by_user_id uuid NULL REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_workspace_bindings_workspace_id UNIQUE (workspace_id, id),
  CONSTRAINT ck_user_workspace_bindings_revocation_state CHECK (
    (status = 'active' AND revoked_at IS NULL AND revoked_by_user_id IS NULL) OR
    (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL)
  ),
  CONSTRAINT fk_user_workspace_bindings_membership FOREIGN KEY (workspace_id, user_id)
    REFERENCES workspace_memberships(workspace_id, user_id) ON DELETE RESTRICT
);

-- Global invariant: at most 1 active binding per user across all workspaces
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_workspace_bindings_single_active
  ON user_workspace_bindings (user_id)
  WHERE status = 'active';

-- Fast lookup index for session resolution and authentication
CREATE INDEX IF NOT EXISTS ix_user_workspace_bindings_lookup
  ON user_workspace_bindings (user_id, workspace_id)
  WHERE status = 'active';
`;

export const EMBEDDED_MIGRATIONS: MigrationFile[] = [
  {
    id: '0001_m00_prerequisites',
    sql: M00_SQL,
    checksum: calculateChecksum(M00_SQL),
  },
  {
    id: '0002_m01_workspace_user_audit_idempotency',
    sql: M01_SQL,
    checksum: calculateChecksum(M01_SQL),
  },
  {
    id: '0003_m02_auth_membership_session_outbox',
    sql: M02_SQL,
    checksum: calculateChecksum(M02_SQL),
  },
  {
    id: '0004_m02b_user_workspace_bindings',
    sql: M02B_SQL,
    checksum: calculateChecksum(M02B_SQL),
  },
];
