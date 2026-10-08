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
];
