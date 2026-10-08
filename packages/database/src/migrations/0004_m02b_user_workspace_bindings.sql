-- Migration: 0004_m02b_user_workspace_bindings
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
