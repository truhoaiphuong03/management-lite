-- Migration: 0031_accounts_ecosystem_hierarchy
-- Scope: ACC-ECOSYSTEM v0.6.0 — 4-Tier Account Hierarchy (Phone/SIM -> Root Gmail -> TikTok/FB/YTB + Google Authenticator + Recovery Account), Health Status, and Encrypted Secret History.

ALTER TABLE managed_accounts
  DROP CONSTRAINT IF EXISTS managed_accounts_platform_check;

ALTER TABLE managed_accounts
  ADD CONSTRAINT managed_accounts_platform_check
  CHECK (platform IN ('tiktok', 'gmail', 'facebook', 'youtube', 'authenticator', 'recovery', 'ai', 'pm', 'other'));

ALTER TABLE managed_accounts
  ADD COLUMN IF NOT EXISTS health_status text NOT NULL DEFAULT 'healthy',
  ADD COLUMN IF NOT EXISTS phone_number text NULL,
  ADD COLUMN IF NOT EXISTS phone_note text NULL,
  ADD COLUMN IF NOT EXISTS parent_account_id uuid NULL,
  ADD COLUMN IF NOT EXISTS recovery_account_id uuid NULL,
  ADD COLUMN IF NOT EXISTS authenticator_account_id uuid NULL;

ALTER TABLE managed_accounts
  DROP CONSTRAINT IF EXISTS managed_accounts_health_status_check;

ALTER TABLE managed_accounts
  ADD CONSTRAINT managed_accounts_health_status_check
  CHECK (health_status IN ('healthy', 'verify_required', 'locked'));

ALTER TABLE managed_accounts
  DROP CONSTRAINT IF EXISTS ck_managed_accounts_no_self_parent,
  DROP CONSTRAINT IF EXISTS ck_managed_accounts_no_self_recovery,
  DROP CONSTRAINT IF EXISTS ck_managed_accounts_no_self_authenticator;

ALTER TABLE managed_accounts
  ADD CONSTRAINT ck_managed_accounts_no_self_parent CHECK (parent_account_id IS DISTINCT FROM id),
  ADD CONSTRAINT ck_managed_accounts_no_self_recovery CHECK (recovery_account_id IS DISTINCT FROM id),
  ADD CONSTRAINT ck_managed_accounts_no_self_authenticator CHECK (authenticator_account_id IS DISTINCT FROM id);

ALTER TABLE managed_accounts
  DROP CONSTRAINT IF EXISTS fk_managed_accounts_parent_account,
  DROP CONSTRAINT IF EXISTS fk_managed_accounts_recovery_account,
  DROP CONSTRAINT IF EXISTS fk_managed_accounts_authenticator_account;

ALTER TABLE managed_accounts
  ADD CONSTRAINT fk_managed_accounts_parent_account
    FOREIGN KEY (parent_account_id, workspace_id)
    REFERENCES managed_accounts (id, workspace_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT fk_managed_accounts_recovery_account
    FOREIGN KEY (recovery_account_id, workspace_id)
    REFERENCES managed_accounts (id, workspace_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT fk_managed_accounts_authenticator_account
    FOREIGN KEY (authenticator_account_id, workspace_id)
    REFERENCES managed_accounts (id, workspace_id)
    ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_managed_accounts_workspace_phone
  ON managed_accounts (workspace_id, phone_number)
  WHERE phone_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_managed_accounts_workspace_parent
  ON managed_accounts (workspace_id, parent_account_id)
  WHERE parent_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_managed_accounts_workspace_recovery
  ON managed_accounts (workspace_id, recovery_account_id)
  WHERE recovery_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_managed_accounts_workspace_authenticator
  ON managed_accounts (workspace_id, authenticator_account_id)
  WHERE authenticator_account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS account_secret_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  account_id uuid NOT NULL,
  secret_type text NOT NULL CHECK (secret_type IN ('password', 'api_key', 'recovery_code', 'totp_secret', 'two_fa_secret', 'email_password')),
  ciphertext bytea NOT NULL,
  nonce bytea NOT NULL,
  auth_tag bytea NOT NULL,
  key_version text NOT NULL DEFAULT 'v1',
  encryption_schema_version integer NOT NULL DEFAULT 1 CHECK (encryption_schema_version >= 1),
  secret_version integer NOT NULL DEFAULT 1 CHECK (secret_version >= 1),
  archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT fk_account_secret_history_account
    FOREIGN KEY (account_id, workspace_id)
    REFERENCES managed_accounts (id, workspace_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_account_secret_history_lookup
  ON account_secret_history (workspace_id, account_id, archived_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hp_app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON account_secret_history TO hp_app_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hp_app_test') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON account_secret_history TO hp_app_test;
  END IF;
END $$;
