-- Migration: 0011_m06_accounts
-- Scope: ACC-01 Managed Accounts, Secrets Vault (C05), Reauthentication Proofs, and Immutable Audit Events
-- Authoritative: Canonical docs 02, 18, 20, 22, 25, 36; SCOPE-EXT-04-ACC-01

-- 1. Managed Accounts (Metadata container, Owner-only)
CREATE TABLE IF NOT EXISTS managed_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  platform text NOT NULL CHECK (platform IN ('tiktok', 'gmail', 'ai', 'pm', 'other')),
  platform_account_id text,
  username text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  notes text,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_managed_accounts_id_workspace UNIQUE (id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_managed_accounts_workspace_status
  ON managed_accounts (workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_managed_accounts_workspace_platform
  ON managed_accounts (workspace_id, platform);

-- 2. Account Secrets (AEAD Encrypted Vault, AES-256-GCM, AAD-bound, Owner-only)
CREATE TABLE IF NOT EXISTS account_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL,
  secret_type text NOT NULL CHECK (secret_type IN ('password', 'api_key', 'recovery_code', 'totp_secret')),
  ciphertext bytea NOT NULL,
  nonce bytea NOT NULL,
  auth_tag bytea NOT NULL,
  key_version text NOT NULL DEFAULT 'v1',
  encryption_schema_version integer NOT NULL DEFAULT 1 CHECK (encryption_schema_version >= 1),
  secret_version integer NOT NULL DEFAULT 1 CHECK (secret_version >= 1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_account_secrets_account
    FOREIGN KEY (account_id, workspace_id)
    REFERENCES managed_accounts (id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT uq_account_secrets_workspace_account_type
    UNIQUE (workspace_id, account_id, secret_type)
);

CREATE INDEX IF NOT EXISTS idx_account_secrets_account
  ON account_secrets (account_id);

-- 3. Account Reauthentication Proofs (Single-use, 5-minute maximum TTL, Action-bound)
CREATE TABLE IF NOT EXISTS account_reauth_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  session_id uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('secret_write', 'secret_reveal')),
  proof_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_account_reauth_proofs_account
    FOREIGN KEY (account_id, workspace_id)
    REFERENCES managed_accounts (id, workspace_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_account_reauth_proofs_lookup
  ON account_reauth_proofs (proof_hash, workspace_id, user_id, action, account_id);

-- 4. Secret Access Events (Immutable Audit Trail for Secret Access/Mutation, Owner-only)
CREATE TABLE IF NOT EXISTS secret_access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('reveal', 'write', 'archive', 'restore')),
  request_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_secret_access_events_account
    FOREIGN KEY (account_id, workspace_id)
    REFERENCES managed_accounts (id, workspace_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_secret_access_events_account
  ON secret_access_events (workspace_id, account_id, created_at DESC);

-- Immutable Guard for secret_access_events: no UPDATE or DELETE allowed
CREATE OR REPLACE FUNCTION secret_access_events_immutable_guard()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'secret_access_events is an immutable audit trail and cannot be modified or deleted';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_secret_access_events_immutable ON secret_access_events;
CREATE TRIGGER trg_secret_access_events_immutable
  BEFORE UPDATE OR DELETE ON secret_access_events
  FOR EACH ROW
  EXECUTE FUNCTION secret_access_events_immutable_guard();

-- 5. Canonical Optional Entities: Contact Points & Links (Doc 20 / Doc 22)
CREATE TABLE IF NOT EXISTS contact_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('email', 'phone', 'url', 'other')),
  normalized_value text NOT NULL,
  display_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT uq_contact_points UNIQUE (workspace_id, type, normalized_value)
);

CREATE TABLE IF NOT EXISTS account_contact_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL,
  contact_point_id uuid NOT NULL REFERENCES contact_points(id) ON DELETE RESTRICT,
  relationship_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_account_contact_links_account
    FOREIGN KEY (account_id, workspace_id)
    REFERENCES managed_accounts (id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT uq_account_contact_links
    UNIQUE (workspace_id, account_id, contact_point_id, relationship_type)
);

CREATE TABLE IF NOT EXISTS account_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  source_account_id uuid NOT NULL,
  target_account_id uuid NOT NULL,
  relationship_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (source_account_id <> target_account_id),
  CONSTRAINT fk_account_relationships_source
    FOREIGN KEY (source_account_id, workspace_id)
    REFERENCES managed_accounts (id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_account_relationships_target
    FOREIGN KEY (target_account_id, workspace_id)
    REFERENCES managed_accounts (id, workspace_id)
    ON DELETE RESTRICT,
  CONSTRAINT uq_account_relationships
    UNIQUE (workspace_id, source_account_id, target_account_id, relationship_type)
);
